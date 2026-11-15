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

// Kojo's voice for the mock interview rounds. Mirrors InterviewerVoice in the
// backend's mock_interview_schema.py; the server rejects anything else.
export const VOICE_OPTIONS = [
  { value: "af_heart", label: "Heart (warm, US)" },
  { value: "af_bella", label: "Bella (bright, US)" },
  { value: "af_nicole", label: "Nicole (soft, US)" },
  { value: "af_sarah", label: "Sarah (calm, US)" },
  { value: "am_michael", label: "Michael (steady, US)" },
  { value: "am_fenrir", label: "Fenrir (deep, US)" },
  { value: "bf_emma", label: "Emma (UK)" },
  { value: "bm_george", label: "George (UK)" },
] as const;
export type AiVoiceId = (typeof VOICE_OPTIONS)[number]["value"];
/** An AI voice, the browser's default voice ("browser"), or one browser voice ("browser:<voiceURI>"). */
export type InterviewerVoiceId = AiVoiceId | "browser" | `browser:${string}`;
const VOICE_KEY = "nosey_mock_voice";

export const isBrowserVoice = (voice: string): voice is "browser" | `browser:${string}` =>
  voice === "browser" || voice.startsWith("browser:");

export function loadInterviewerVoice(): InterviewerVoiceId {
  try {
    const v = localStorage.getItem(VOICE_KEY);
    if (v && (VOICE_OPTIONS.some((o) => o.value === v) || isBrowserVoice(v))) return v as InterviewerVoiceId;
  } catch {
    /* storage blocked */
  }
  return "af_heart";
}

/** English voices the browser can speak with, kept fresh as the list loads (Chrome fills it late). */
export function useBrowserVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => readBrowserVoices());
  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;
    const update = () => setVoices(readBrowserVoices());
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}

function readBrowserVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
}

/** Speak with the browser's own voice. Returns false when the browser has none. */
export function speakWithBrowser(
  text: string,
  voice: InterviewerVoiceId | null,
  handlers: { onStart?: () => void; onEnd?: () => void } = {},
): boolean {
  if (typeof window === "undefined" || !window.speechSynthesis) return false;
  const utt = new SpeechSynthesisUtterance(text);
  const uri = voice && voice.startsWith("browser:") ? voice.slice("browser:".length) : null;
  const match = uri ? window.speechSynthesis.getVoices().find((v) => v.voiceURI === uri) : undefined;
  if (match) {
    utt.voice = match;
    utt.lang = match.lang;
  }
  utt.onstart = () => handlers.onStart?.();
  utt.onend = () => handlers.onEnd?.();
  utt.onerror = () => handlers.onEnd?.();
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utt);
  return true;
}

export function saveInterviewerVoice(voice: InterviewerVoiceId) {
  try {
    localStorage.setItem(VOICE_KEY, voice);
  } catch {
    /* storage blocked */
  }
}

export const dictationSupported = () => recognitionCtor() !== null || canRecordFallback;

// A recording this small is a mis-tap, not an answer.
const MIN_SEGMENT_BYTES = 3000;
// Past this the browser's own words are kept, so a slow server never stalls the round.
const IMPROVE_TIMEOUT_MS = 8000;

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Whether the server transcript should replace what the browser heard. A transcript
 *  that lost most of the words (a silent recording, a cut upload) is not an improvement. */
export function isBetterTranscript(heard: string, better: string): boolean {
  if (!better.trim()) return false;
  return wordCount(better) * 2 >= wordCount(heard);
}

/** Swap one dictated segment in the draft for its better transcript. If the segment
 *  was edited by hand since (no longer found), the draft is left as the user made it. */
export function replaceSegment(draft: string, heard: string, better: string): string {
  if (!heard) return draft ? `${draft} ${better}` : better;
  const at = draft.lastIndexOf(heard);
  if (at < 0) return draft;
  return draft.slice(0, at) + better + draft.slice(at + heard.length);
}

type DictationOptions = {
  /** The interviewer's last line, sent with the audio as a spelling hint. */
  hint?: string;
  /** A segment's server transcript arrived: `heard` is the browser text it replaces. */
  onImprove?: (heard: string, better: string) => void;
};

type ShadowRecording = { recorder: MediaRecorder; chunks: BlobPart[]; discard: boolean };

/** Plays interviewer lines through the chosen voice: an AI voice from the backend (falling
 *  back to the browser voice if that fails) or the browser's own voice. */
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
      const chosen = loadInterviewerVoice();
      const browserHandlers = {
        onStart: () => run === runRef.current && setSpeaking(true),
        onEnd: () => run === runRef.current && setSpeaking(false),
      };

      if (isBrowserVoice(chosen)) {
        speakWithBrowser(spoken, chosen, browserHandlers);
        return;
      }

      let blob: Blob | null = null;
      try {
        blob = await speakInterviewer(spoken, chosen);
      } catch {
        if (run !== runRef.current) return;
      }
      if (run !== runRef.current) return;

      if (!blob) {
        // The server voice failed: the browser voice is better than silence.
        speakWithBrowser(spoken, null, browserHandlers);
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

/** Live dictation. Browser speech recognition gives the live words; the same segment is
 *  recorded and transcribed by the server when the mic stops, and that better text
 *  replaces the browser's (onImprove). Without browser recognition: record, then transcribe. */
export function useDictation(onText: (text: string) => void, options: DictationOptions = {}) {
  const [listening, setListening] = useState(false);
  // Record-then-transcribe fallback: the audio is uploaded and not back yet.
  const [transcribing, setTranscribing] = useState(false);
  const [interim, setInterim] = useState("");
  // Words heard but not finalized yet. Flushed as text when recognition ends, so
  // stopping the mic never drops the end of a sentence.
  const interimRef = useRef("");
  const transcribingRef = useRef(false);
  // Callers of finish() waiting for the last words to land.
  const waitersRef = useRef<(() => void)[]>([]);
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
  const optionsRef = useRef(options);
  optionsRef.current = options;
  // The recording of the segment the browser is transcribing live.
  const shadowRef = useRef<ShadowRecording | null>(null);
  // Everything the browser emitted this segment, in order: what onImprove replaces.
  const heardRef = useRef<string[]>([]);

  const dropShadow = useCallback(() => {
    const shadow = shadowRef.current;
    shadowRef.current = null;
    if (!shadow) return;
    shadow.discard = true;
    if (shadow.recorder.state === "recording") shadow.recorder.stop();
  }, []);

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

  const settle = useCallback(() => {
    const waiters = waitersRef.current;
    waitersRef.current = [];
    waiters.forEach((resolve) => resolve());
  }, []);

  const stop = useCallback(() => {
    sessionRef.current += 1;
    stopMeter();
    recRef.current?.stop();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, [stopMeter]);

  /** Stop listening and resolve once every word said so far has landed in onText
   * (final recognition results, or the fallback's transcription). */
  const finish = useCallback((): Promise<void> => {
    const recording = recRef.current !== null || recorderRef.current?.state === "recording";
    if (!recording && !transcribingRef.current) return Promise.resolve();
    return new Promise<void>((resolve) => {
      // Live recognition settles in a few seconds; a segment that is also being
      // transcribed by the server gets that wait on top.
      const wait = transcribingRef.current || !recRef.current ? 30000 : shadowRef.current ? 4000 + IMPROVE_TIMEOUT_MS + 1000 : 4000;
      const timer = window.setTimeout(resolve, wait);
      waitersRef.current.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
      if (recording) stop();
    });
  }, [stop]);

  const start = useCallback(async () => {
    // Created or resumed inside the click, before any await, so it is allowed to run.
    if (typeof AudioContext !== "undefined") {
      if (!ctxRef.current || ctxRef.current.state === "closed") ctxRef.current = new AudioContext();
      if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
    }
    // Never stack recognisers: a second start on a live one throws and can wedge the mic.
    recRef.current?.abort();
    recRef.current = null;
    dropShadow();
    heardRef.current = [];
    stopMeter();
    const session = ++sessionRef.current;
    setError(null);
    interimRef.current = "";
    setInterim("");

    const emit = (text: string) => {
      heardRef.current.push(text);
      onTextRef.current(text);
    };

    // Send the recorded segment for a better transcript, then let finish() callers go.
    const improve = async (shadow: ShadowRecording) => {
      const heard = heardRef.current.join(" ");
      heardRef.current = [];
      try {
        if (shadow.discard) return;
        const blob = new Blob(shadow.chunks, { type: shadow.recorder.mimeType || "audio/webm" });
        if (blob.size < MIN_SEGMENT_BYTES) return;
        const better = await Promise.race([
          transcribeAnswer(blob, optionsRef.current.hint),
          new Promise<string>((resolve) => window.setTimeout(() => resolve(""), IMPROVE_TIMEOUT_MS)),
        ]);
        if (!shadow.discard && isBetterTranscript(heard, better)) optionsRef.current.onImprove?.(heard, better.trim());
      } catch {
        /* the browser's words stay in the draft */
      } finally {
        transcribingRef.current = false;
        setTranscribing(false);
        settle();
      }
    };

    const startShadow = async (forSession: number, forRec: Recognition) => {
      if (!canRecordFallback) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (forSession !== sessionRef.current || recRef.current !== forRec) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const recorder = new MediaRecorder(stream);
        const shadow: ShadowRecording = { recorder, chunks: [], discard: false };
        recorder.ondataavailable = (e) => shadow.chunks.push(e.data);
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          if (shadowRef.current === shadow) shadowRef.current = null;
          void improve(shadow);
        };
        shadowRef.current = shadow;
        recorder.start();
      } catch {
        /* no recording: the browser's words are used as they are */
      }
    };

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
        if (finalText.trim()) emit(finalText.trim());
        interimRef.current = live;
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
        // Some engines end without finalizing the last phrase: keep it anyway.
        const pending = interimRef.current.trim();
        interimRef.current = "";
        if (pending) emit(pending);
        stopMeter();
        setListening(false);
        setInterim("");
        const shadow = shadowRef.current;
        if (shadow && shadow.recorder.state === "recording") {
          // Its onstop sends the audio off and settles when the better text is in.
          transcribingRef.current = true;
          setTranscribing(true);
          shadow.recorder.stop();
        } else {
          settle();
        }
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
      void startShadow(session, rec);
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
        transcribingRef.current = true;
        setTranscribing(true);
        setInterim("Transcribing...");
        try {
          const text = await transcribeAnswer(new Blob(chunks, { type: "audio/webm" }), optionsRef.current.hint);
          if (text) onTextRef.current(text);
        } catch {
          setError("Could not transcribe that. Try again or type instead.");
        } finally {
          transcribingRef.current = false;
          setTranscribing(false);
          setInterim("");
          settle();
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setListening(true);
      void startMeter(session);
    } catch {
      setError("Microphone access is blocked. Allow it in the address bar, or type instead.");
    }
  }, [startMeter, stopMeter, settle, dropShadow]);

  useEffect(
    () => () => {
      sessionRef.current += 1;
      dropShadow();
      stopMeter();
      recRef.current?.abort();
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      void ctxRef.current?.close();
      ctxRef.current = null;
      settle();
    },
    [stopMeter, settle, dropShadow],
  );

  return { listening, transcribing, interim, error, level, start, stop, finish, supported: dictationSupported() };
}
