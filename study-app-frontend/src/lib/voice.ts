import { useCallback, useEffect, useRef, useState } from "react";
import { speakInterviewer, transcribeAnswer } from "./api";

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canRecordFallback =
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

export const dictationSupported = () => recognitionCtor() !== null || canRecordFallback;

/** Plays interviewer lines through the backend voice. Falls back to the browser voice if that fails. */
export function useInterviewerVoice() {
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  // The browser refused to start audio without a click (autoplay policy). The clip
  // is held and plays on the next tap or key press anywhere on the page.
  const [blocked, setBlocked] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const runRef = useRef(0);
  const unlockRef = useRef<(() => void) | null>(null);

  const clearUnlock = useCallback(() => {
    if (!unlockRef.current) return;
    document.removeEventListener("pointerdown", unlockRef.current, true);
    document.removeEventListener("keydown", unlockRef.current, true);
    unlockRef.current = null;
    setBlocked(false);
  }, []);

  const stop = useCallback(() => {
    runRef.current += 1;
    clearUnlock();
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, [clearUnlock]);

  const speak = useCallback(
    async (text: string) => {
      stop();
      // Markdown symbols are read aloud literally by TTS, so strip them first.
      const spoken = text.replace(/[*_#`>~]+/g, "").replace(/\s+/g, " ").trim();
      if (muted || !spoken) return;
      const run = runRef.current;

      let blob: Blob | null = null;
      for (let attempt = 0; attempt < 1 && !blob; attempt++) {
        try {
          blob = await speakInterviewer(spoken);
        } catch {
          if (run !== runRef.current) return;
        }
      }
      if (run !== runRef.current) return;

      if (!blob) {
        // Both server attempts failed: the browser voice is better than silence.
        if (window.speechSynthesis) {
          const utt = new SpeechSynthesisUtterance(spoken);
          utt.onstart = () => run === runRef.current && setSpeaking(true);
          utt.onend = () => run === runRef.current && setSpeaking(false);
          window.speechSynthesis.speak(utt);
        }
        return;
      }

      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onplaying = () => run === runRef.current && setSpeaking(true);
      audio.onended = () => run === runRef.current && setSpeaking(false);
      audio.onerror = () => run === runRef.current && setSpeaking(false);
      try {
        await audio.play();
      } catch (err) {
        if (run !== runRef.current) return;
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          const unlock = () => {
            clearUnlock();
            if (run === runRef.current) void audio.play().catch(() => setSpeaking(false));
          };
          unlockRef.current = unlock;
          document.addEventListener("pointerdown", unlock, true);
          document.addEventListener("keydown", unlock, true);
          setBlocked(true);
        } else {
          setSpeaking(false);
        }
      }
    },
    [muted, stop, clearUnlock],
  );

  useEffect(() => stop, [stop]);
  useEffect(() => {
    if (muted) stop();
  }, [muted, stop]);

  return { speak, stop, speaking, muted, setMuted, blocked };
}

/** Live dictation. Browser speech recognition when present, otherwise record and transcribe on stop. */
export function useDictation(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  // One AudioContext for the life of the bar. Making a new one per tap leaks them,
  // and after a handful the browser refuses audio input altogether.
  const ctxRef = useRef<AudioContext | null>(null);
  const meterRef = useRef<{ stream: MediaStream; raf: number } | null>(null);
  // Bumped on every start/stop so a mic stream that resolves late is released, not kept.
  const sessionRef = useRef(0);
  const recRef = useRef<Recognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stopMeter = useCallback(() => {
    const m = meterRef.current;
    meterRef.current = null;
    if (m) {
      cancelAnimationFrame(m.raf);
      m.stream.getTracks().forEach((t) => t.stop());
    }
    setLevel(0);
  }, []);

  // Live input level so the mic visibly follows the speaker's voice.
  const startMeter = useCallback(
    async (session: number) => {
      const ctx = ctxRef.current;
      if (!ctx || !navigator.mediaDevices?.getUserMedia) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (session !== sessionRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (ctx.state === "suspended") await ctx.resume();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        let smoothed = 0;
        const tick = () => {
          if (!meterRef.current || session !== sessionRef.current) {
            source.disconnect();
            return;
          }
          analyser.getByteTimeDomainData(data);
          let sum = 0;
          for (const v of data) sum += (v - 128) * (v - 128);
          const rms = Math.sqrt(sum / data.length) / 128;
          // Speech sits around 0.02 to 0.15 rms; lift it so normal talking reads clearly.
          smoothed = smoothed * 0.6 + Math.min(1, rms * 9) * 0.4;
          setLevel(smoothed);
          meterRef.current.raf = requestAnimationFrame(tick);
        };
        meterRef.current = { stream, raf: 0 };
        meterRef.current.raf = requestAnimationFrame(tick);
      } catch {
        /* metering is cosmetic; dictation still works without it */
      }
    },
    [],
  );

  const stop = useCallback(() => {
    sessionRef.current += 1;
    stopMeter();
    recRef.current?.stop();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, [stopMeter]);

  const start = useCallback(async () => {
    // Created or resumed inside the click, before any await, so it is allowed to run.
    if (typeof AudioContext !== "undefined") {
      if (!ctxRef.current || ctxRef.current.state === "closed") ctxRef.current = new AudioContext();
      if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
    }
    // Never stack recognisers: a second start on a live one throws and can wedge the mic.
    recRef.current?.abort();
    recRef.current = null;
    stopMeter();
    const session = ++sessionRef.current;
    setError(null);
    setInterim("");

    const Ctor = recognitionCtor();
    if (Ctor) {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";
      rec.onresult = (e) => {
        let finalText = "";
        let live = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else live += r[0].transcript;
        }
        if (finalText) onTextRef.current(finalText.trim());
        setInterim(live);
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setError("Microphone access is blocked. Allow it in the address bar, or type instead.");
        } else if (e.error === "audio-capture") {
          setError("No microphone found. Check your input device, or type instead.");
        } else if (e.error === "network") {
          setError("Speech recognition lost its connection. Tap the mic to try again.");
        }
      };
      rec.onend = () => {
        if (recRef.current !== rec) return;
        recRef.current = null;
        stopMeter();
        setListening(false);
        setInterim("");
      };
      recRef.current = rec;
      try {
        rec.start();
      } catch {
        recRef.current = null;
        setError("The mic is still closing. Tap it again in a second.");
        return;
      }
      setListening(true);
      void startMeter(session);
      return;
    }
    if (!canRecordFallback) {
      setError("Voice input is not supported in this browser. Use the keyboard.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setListening(false);
        setInterim("Transcribing...");
        try {
          const text = await transcribeAnswer(new Blob(chunks, { type: "audio/webm" }));
          if (text) onTextRef.current(text);
        } catch {
          setError("Could not transcribe that. Try again or type instead.");
        } finally {
          setInterim("");
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setListening(true);
      void startMeter(session);
    } catch {
      setError("Microphone access is blocked. Allow it in the address bar, or type instead.");
    }
  }, [startMeter, stopMeter]);

  useEffect(
    () => () => {
      sessionRef.current += 1;
      stopMeter();
      recRef.current?.abort();
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      void ctxRef.current?.close();
      ctxRef.current = null;
    },
    [stopMeter],
  );

  return { listening, interim, error, level, start, stop, supported: dictationSupported() };
}
