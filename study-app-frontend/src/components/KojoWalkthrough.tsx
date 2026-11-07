import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { CloseIcon, PlayIcon, RetryIcon, SpeakerIcon } from "../icons";
import { fetchLecture, fetchSolutionWalkthrough, recordLectureAudio, recordWalkthroughAudio } from "../lib/api";
import type { LectureResponse, SolutionWalkthrough, WalkFrame, WalkInk } from "../lib/types";
import { VOICE_OPTIONS } from "../lib/voice";
import {
  buildLectureTimeline,
  buildTimeline,
  chapterStart,
  formatClock,
  segmentAt,
  spokenLines,
  type Scene,
  type Segment,
  type Timeline,
} from "../lib/walkthroughTimeline";
import { Dropdown } from "./Dropdown";
import "../styles/components/kojo-walkthrough.css";

// Kojo's NeetCode-style solution video for a KojoCode problem: reads and breaks the
// problem down, weighs the approaches, sketches it in ink, then types the code line by
// line while explaining it. Built from a cached script (POST /leetcode/walkthrough) and
// played on a fixed timeline, so it pauses, scrubs, seeks by chapter and changes speed
// like a real video. The problem text stays on screen beside it.

const VOICE_KEY = "nosey_walkthrough_voice";
const SPEEDS = ["0.75", "1", "1.25", "1.5", "2"] as const;
type Speed = (typeof SPEEDS)[number];
const VOICE_CHOICES = [{ value: "browser", label: "Browser voice (instant)" }, ...VOICE_OPTIONS.map((v) => ({ value: v.value, label: `AI: ${v.label}` }))];
type VoiceChoice = string;
const INK: Record<WalkInk, string> = { ink: "var(--walk-ink)", red: "#d6453d", blue: "#2f6fd6", green: "#2f9a55" };
// Speech that has not started this long after a segment opens no longer holds the video.
const SPEECH_START_TIMEOUT_MS = 6000;

// Chrome's Document Picture-in-Picture: a small always-on-top window the player moves
// into, so the user can code on the page while Kojo explains. Not in Firefox/Safari.
type PipApi = { requestWindow: (opts?: { width?: number; height?: number }) => Promise<Window> };
function pipApi(): PipApi | null {
  return (window as unknown as { documentPictureInPicture?: PipApi }).documentPictureInPicture ?? null;
}

/** Copies the app's styles into the pop-out window (inline rules in dev, links in prod). */
function copyStyles(target: Window) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const style = target.document.createElement("style");
      style.textContent = Array.from(sheet.cssRules).map((r) => r.cssText).join("\n");
      target.document.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = target.document.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        target.document.head.appendChild(link);
      }
    }
  }
}

type Clip = { url: string; dur: number };
type Recording =
  | { voice: VoiceChoice; status: "ready"; clips: Map<string, Clip> | null }
  | { voice: VoiceChoice; status: "recording" }
  | { voice: VoiceChoice; status: "error"; message: string };

function clipFromBase64(b64: string): Promise<Clip> {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
  return new Promise((resolve) => {
    const probe = new Audio();
    probe.preload = "metadata";
    const done = () => resolve({ url, dur: Number.isFinite(probe.duration) ? probe.duration : 0 });
    probe.onloadedmetadata = done;
    probe.onerror = done;
    probe.src = url;
  });
}

type Recorder = (voice: string, lines: string[]) => Promise<{ clips: string[] }>;
type Builder = (spoken?: Map<string, number>) => Timeline;

/** Records every spoken line of a video in one AI voice (cached on the server) and
 *  measures each clip, so the timeline matches the real audio. Browser voice needs none. */
function useRecording(audioKey: string, lines: string[], record: Recorder, voice: VoiceChoice, attempt: number): Recording {
  const [rec, setRec] = useState<Recording>(() =>
    voice === "browser" ? { voice, status: "ready", clips: null } : { voice, status: "recording" },
  );
  const recordRef = useRef(record);
  recordRef.current = record;
  const linesKey = lines.join("\n");
  useEffect(() => {
    if (voice === "browser") {
      setRec({ voice, status: "ready", clips: null });
      return;
    }
    let cancelled = false;
    const urls: string[] = [];
    setRec({ voice, status: "recording" });
    const wanted = linesKey.split("\n");
    recordRef.current(voice, wanted)
      .then(async (res) => {
        const made = await Promise.all(res.clips.map(clipFromBase64));
        made.forEach((c) => urls.push(c.url));
        if (cancelled) return;
        setRec({ voice, status: "ready", clips: new Map(wanted.map((line, i) => [line, made[i]])) });
      })
      .catch((e: unknown) => {
        if (!cancelled) setRec({ voice, status: "error", message: e instanceof Error ? e.message : "Kojo could not record the audio." });
      });
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [audioKey, linesKey, voice, attempt]);
  return rec;
}

function loadVoice(): VoiceChoice {
  try {
    const v = localStorage.getItem(VOICE_KEY);
    if (v && VOICE_CHOICES.some((o) => o.value === v)) return v;
  } catch {
    /* storage blocked */
  }
  return "af_heart";
}

// Straight pen segments: Kojo's boxes and arrows keep their corners (a spline turned
// them into blobs), and round shapes come out fine from their ~12 points.
function inkPath(points: number[]): string {
  if (points.length < 4) return "";
  let d = `M${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length; i += 2) d += ` L${points[i]} ${points[i + 1]}`;
  return d;
}

type Props = {
  slug: string;
  problemTitle: string;
  /** The problem text as shown in KojoCode (markdown or sanitized HTML, already rendered). */
  statement: ReactNode;
  /** Plain statement sent to the backend for official problems. Custom ones are read server side. */
  statementText: string;
  starterCode: string;
  provider?: string;
  onClose: () => void;
};

/** Hosts a Kojo video: an overlay on this page that can pop out into a Document
 *  Picture-in-Picture window. The player renders into one host element that moves
 *  between the two documents, so React state (and playback) survives the move. */
function usePopOutHost(windowTitle: string) {
  const [host] = useState(() => document.createElement("div"));
  const [pip, setPip] = useState<Window | null>(null);

  useEffect(() => {
    document.body.appendChild(host);
    return () => host.remove();
  }, [host]);

  useEffect(() => {
    if (pip) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [pip]);

  useEffect(() => {
    if (!pip) return;
    pip.document.body.appendChild(host);
    // Keys pressed in the pop-out drive the same shortcuts.
    const forward = (e: KeyboardEvent) => {
      if (e.key === " ") e.preventDefault();
      window.dispatchEvent(new CustomEvent("walk-key", { detail: e.key }));
    };
    const back = () => setPip(null);
    pip.addEventListener("keydown", forward);
    pip.addEventListener("pagehide", back);
    return () => {
      pip.removeEventListener("keydown", forward);
      pip.removeEventListener("pagehide", back);
      document.body.appendChild(host);
    };
  }, [pip, host]);

  // Closing the video also closes its pop-out.
  useEffect(() => () => pip?.close(), [pip]);

  async function popOut() {
    const api = pipApi();
    if (!api || pip) return;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    try {
      const win = await api.requestWindow({ width: 720, height: 520 });
      copyStyles(win);
      win.document.title = `Kojo: ${windowTitle}`;
      win.document.body.style.margin = "0";
      setPip(win);
    } catch {
      /* blocked or dismissed */
    }
  }
  function popIn() {
    pip?.close();
    setPip(null);
  }
  return { host, pip, popOut: pipApi() ? popOut : undefined, popIn };
}

function LoadingShell({ error, message, onRetry, onClose }: { error: string | null; message: string; onRetry: () => void; onClose: () => void }) {
  return (
    <div className="walk-shell walk-shell--loading">
      <button type="button" className="walk-close" onClick={onClose} aria-label="Close">
        <CloseIcon size={18} />
      </button>
      {error ? (
        <div className="walk-loading">
          <p>{error}</p>
          <button type="button" className="button button-primary" onClick={onRetry}>
            <RetryIcon size={15} /> Try again
          </button>
        </div>
      ) : (
        <div className="walk-loading">
          <Loader2 size={22} className="spin" />
          <p>{message}</p>
        </div>
      )}
    </div>
  );
}

export function KojoWalkthrough({ slug, problemTitle, statement, statementText, starterCode, provider, onClose }: Props) {
  const [walk, setWalk] = useState<SolutionWalkthrough | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { host, pip, popOut, popIn } = usePopOutHost(problemTitle);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchSolutionWalkthrough(slug, { title: problemTitle, statement: statementText, starterCode, provider })
      .then((res) => !cancelled && setWalk(res.walkthrough))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Kojo couldn't load the walkthrough."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, attempt]);

  const build = useCallback<Builder>((spoken) => buildTimeline(walk as SolutionWalkthrough, problemTitle, spoken), [walk, problemTitle]);
  const record = useCallback<Recorder>((voice, lines) => recordWalkthroughAudio(slug, voice, lines), [slug]);

  return createPortal(
    <div className={`walk-overlay${pip ? " walk-overlay--pip" : ""}`} role="dialog" aria-modal={!pip} aria-label={`Kojo's walkthrough of ${problemTitle}`}>
      {walk ? (
        <VideoPlayer
          audioKey={`walk:${slug}`}
          kicker="Kojo's walkthrough"
          title={problemTitle}
          build={build}
          record={record}
          statement={statement}
          onClose={onClose}
          popped={!!pip}
          onPopOut={popOut}
          onPopIn={popIn}
        />
      ) : (
        <LoadingShell
          error={error}
          message="Kojo is recording the walkthrough. The first time takes about 30 seconds; after that it opens instantly."
          onRetry={() => setAttempt((n) => n + 1)}
          onClose={onClose}
        />
      )}
    </div>,
    host,
  );
}

/** A Kojo pattern lecture (theory, spot it, template, worked problem). */
export function KojoLecture({ slug, onClose, onTryProblem }: { slug: string; onClose: () => void; onTryProblem?: (problemSlug: string) => void }) {
  const [data, setData] = useState<LectureResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { host, pip, popOut, popIn } = usePopOutHost(data?.title ?? "Lecture");

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchLecture(slug)
      .then((res) => !cancelled && setData(res))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Kojo couldn't load the lecture."));
    return () => {
      cancelled = true;
    };
  }, [slug, attempt]);

  const build = useCallback<Builder>(
    (spoken) => buildLectureTimeline((data as LectureResponse).lecture, (data as LectureResponse).problem_title, spoken),
    [data],
  );
  const record = useCallback<Recorder>((voice, lines) => recordLectureAudio(slug, voice, lines), [slug]);

  return createPortal(
    <div className={`walk-overlay${pip ? " walk-overlay--pip" : ""}`} role="dialog" aria-modal={!pip} aria-label={`Kojo's lecture on ${data?.title ?? "a pattern"}`}>
      {data ? (
        <VideoPlayer
          audioKey={`lecture:${slug}`}
          kicker="Kojo's lecture"
          title={data.lecture.title || data.title}
          build={build}
          record={record}
          headerAction={
            onTryProblem ? (
              <button type="button" className="walk-chip" onClick={() => onTryProblem(data.problem_slug)} title={`Open ${data.problem_title} in KojoCode`}>
                Try {data.problem_title}
              </button>
            ) : null
          }
          onClose={onClose}
          popped={!!pip}
          onPopOut={popOut}
          onPopIn={popIn}
        />
      ) : (
        <LoadingShell error={error} message="Loading Kojo's lecture..." onRetry={() => setAttempt((n) => n + 1)} onClose={onClose} />
      )}
    </div>,
    host,
  );
}

function VideoPlayer({
  audioKey,
  kicker,
  title,
  build,
  record,
  statement,
  headerAction,
  onClose,
  popped,
  onPopOut,
  onPopIn,
}: {
  audioKey: string;
  kicker: string;
  title: string;
  build: Builder;
  record: Recorder;
  /** Shown in a side panel when given (the problem text for walkthroughs). */
  statement?: ReactNode;
  headerAction?: ReactNode;
  onClose: () => void;
  popped: boolean;
  onPopOut?: () => void;
  onPopIn: () => void;
}) {
  const [voice, setVoiceState] = useState<VoiceChoice>(loadVoice);
  const [recordAttempt, setRecordAttempt] = useState(0);
  const lines = useMemo(() => spokenLines(build()), [build]);
  const rec = useRecording(audioKey, lines, record, voice, recordAttempt);
  const clips = rec.status === "ready" ? rec.clips : null;
  const recorded = rec.status === "ready";
  const durations = useMemo(
    () => (clips ? new Map([...clips].map(([line, c]) => [line, c.dur] as [string, number])) : undefined),
    [clips],
  );
  const { segments, total, chapters } = useMemo(() => build(durations), [build, durations]);
  const shellRef = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("1");
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [showProblemState, setShowProblem] = useState(true);
  const showProblem = showProblemState && statement !== undefined;
  const [waitingVoice, setWaitingVoice] = useState(false);

  // Speech for the current segment: "loading" and "speaking" hold the clock at the
  // segment's end (or start) so Kojo is never cut off mid-sentence.
  const speech = useRef<{ seg: number; state: "idle" | "loading" | "speaking" | "done"; since: number }>({ seg: -1, state: "idle", since: 0 });
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const runRef = useRef(0);

  const idx = segmentAt(segments, t);
  const seg = segments[idx];
  const local = Math.min(seg.dur, Math.max(0, t - seg.start));
  const progress = seg.dur > 0 ? local / seg.dur : 1;

  const stopSpeech = useCallback(() => {
    runRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    window.speechSynthesis?.cancel();
    speech.current = { seg: -1, state: "idle", since: 0 };
  }, []);

  const speakSegment = useCallback(
    (i: number) => {
      const s = segments[i];
      const run = ++runRef.current;
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
      if (muted || !s.say.trim()) {
        speech.current = { seg: i, state: "done", since: performance.now() };
        return;
      }
      speech.current = { seg: i, state: "loading", since: performance.now() };
      const rate = Number(speed);
      const finish = () => {
        if (run === runRef.current) speech.current = { ...speech.current, state: "done" };
      };
      const browserSpeak = () => {
        if (!window.speechSynthesis) return finish();
        const u = new SpeechSynthesisUtterance(s.say);
        u.rate = rate;
        u.onstart = () => run === runRef.current && (speech.current = { ...speech.current, state: "speaking" });
        u.onend = finish;
        u.onerror = finish;
        window.speechSynthesis.speak(u);
      };
      if (voice === "browser") return browserSpeak();
      // Only Kojo's recorded clips play: never another voice mid-video. A line with no
      // clip just runs silent with its caption.
      const clip = clips?.get(s.say.trim());
      if (!clip) return finish();
      const audio = new Audio(clip.url);
      audio.playbackRate = rate;
      audioRef.current = audio;
      audio.onplaying = () => run === runRef.current && (speech.current = { ...speech.current, state: "speaking" });
      audio.onended = finish;
      audio.onerror = finish;
      audio.play().catch(finish);
    },
    [segments, muted, speed, voice, clips],
  );

  // The clock. Advances with speed, holds while Kojo is still talking or loading audio.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = ((now - last) / 1000) * Number(speed);
      last = now;
      let next = tRef.current;
      const i = segmentAt(segments, next);
      const s = segments[i];
      if (speech.current.seg !== i) speakSegment(i);
      const sp = speech.current;
      const stalled = sp.state === "loading" && now - sp.since < SPEECH_START_TIMEOUT_MS;
      const talking = sp.state === "speaking" || stalled;
      setWaitingVoice(sp.state === "loading" && stalled);
      if (!(sp.state === "loading" && stalled && next - s.start < 0.05)) {
        next += dt;
        const end = s.start + s.dur;
        // Hold at the very end of a segment until its line is finished.
        if (next >= end && talking) next = end - 0.0001;
      }
      if (next >= total) {
        next = total;
        tRef.current = next;
        setT(next);
        setPlaying(false);
        return;
      }
      tRef.current = next;
      setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, segments, total, speakSegment]);

  // Pausing pauses the voice too; resuming picks it back up where it was.
  useEffect(() => {
    if (playing) {
      if (audioRef.current?.paused && speech.current.state === "speaking") void audioRef.current.play().catch(() => undefined);
      window.speechSynthesis?.resume();
    } else {
      audioRef.current?.pause();
      window.speechSynthesis?.pause();
      setWaitingVoice(false);
    }
  }, [playing]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = Number(speed);
  }, [speed]);
  useEffect(() => {
    if (muted) stopSpeech();
  }, [muted, stopSpeech]);
  useEffect(() => () => stopSpeech(), [stopSpeech]);

  const seek = useCallback(
    (to: number) => {
      stopSpeech();
      const clamped = Math.min(Math.max(0, to), total);
      tRef.current = clamped;
      setT(clamped);
    },
    [stopSpeech, total],
  );

  function togglePlay() {
    if (!recorded) return;
    if (!playing && tRef.current >= total) seek(0);
    setPlaying((p) => !p);
  }

  // A new voice means a new recording and new clip lengths. Pause, then pick up at the
  // start of the same line once the new timeline is ready.
  const resumeAt = useRef<number | null>(null);
  function changeVoice(v: VoiceChoice) {
    if (v === voice) return;
    resumeAt.current = segmentAt(segments, tRef.current);
    setPlaying(false);
    stopSpeech();
    setVoiceState(v);
    try {
      localStorage.setItem(VOICE_KEY, v);
    } catch {
      /* storage blocked */
    }
  }
  useEffect(() => {
    if (resumeAt.current === null || !recorded) return;
    const target = segments[Math.min(resumeAt.current, segments.length - 1)];
    resumeAt.current = null;
    tRef.current = target.start;
    setT(target.start);
  }, [segments, recorded]);

  function toggleFullscreen() {
    // Full screen the whole page, not the player: the speed and voice menus render in
    // a portal on <body>, which would be hidden outside a full-screen player element.
    // The overlay is fixed to the viewport, so the player still fills the screen.
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  useEffect(() => {
    const onKey = (raw: Event) => {
      // Popped out: only keys pressed in the pop-out window (forwarded as "walk-key") count,
      // so typing in the editor on the page never drives the video.
      const e = raw instanceof KeyboardEvent ? raw : new KeyboardEvent("keydown", { key: String((raw as CustomEvent).detail) });
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable || target?.closest("input, textarea, [contenteditable], .cm-editor, .monaco-editor, [role='listbox'], [role='combobox']")) return;
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") seek(tRef.current + 5);
      else if (e.key === "ArrowLeft") seek(tRef.current - 5);
      else if (e.key === "f" && !popped) toggleFullscreen();
      else if (e.key === "m") setMuted((m) => !m);
      else if (e.key === "c") setCaptions((c) => !c);
      else if (e.key === "Escape" && !document.fullscreenElement && !popped) onClose();
    };
    const evt = popped ? "walk-key" : "keydown";
    window.addEventListener(evt, onKey);
    return () => window.removeEventListener(evt, onKey);
  });

  const chapter = seg.chapter;
  const fresh = t === 0 && !playing;

  return (
    <div className={`walk-shell${showProblem ? "" : " walk-shell--wide"}`} ref={shellRef}>
      <header className="walk-head">
        <div className="walk-head-title">
          <span className="eyebrow">{kicker}</span>
          <strong>{title}</strong>
        </div>
        {headerAction}
        {!popped && statement !== undefined && (
          <button type="button" className="walk-chip" onClick={() => setShowProblem((v) => !v)} aria-pressed={showProblem}>
            {showProblem ? "Hide problem" : "Show problem"}
          </button>
        )}
        {popped ? (
          <button type="button" className="walk-chip" onClick={onPopIn} title="Put the video back on the page">
            Back to page
          </button>
        ) : (
          onPopOut && (
            <button type="button" className="walk-chip" onClick={onPopOut} title="Watch in a small window that stays on top while you code">
              Pop out
            </button>
          )
        )}
        <button type="button" className="walk-close" onClick={onClose} aria-label="Close video">
          <CloseIcon size={18} />
        </button>
      </header>

      <div className={`walk-body${popped ? " walk-body--popped" : ""}`}>
        {showProblem && !popped && (
          <aside className="walk-problem" aria-label="Problem">
            <h3>{title}</h3>
            <div className="walk-problem-text">{statement}</div>
          </aside>
        )}

        <section className="walk-video">
          <div className="walk-screen" onClick={togglePlay}>
            <Stage seg={seg} progress={progress} local={local} />
            {captions && seg.say && !fresh && (
              <p className="walk-caption" aria-live="polite">
                {seg.say}
              </p>
            )}
            {waitingVoice && playing && <span className="walk-buffer"><Loader2 size={18} className="spin" /></span>}
            {rec.status === "recording" && (
              <div className="walk-recording" onClick={(e) => e.stopPropagation()}>
                <Loader2 size={22} className="spin" />
                <p>Kojo is recording the audio in one voice. The first time takes up to a minute; after that it plays instantly.</p>
                <button type="button" className="walk-chip" onClick={() => changeVoice("browser")}>
                  Use the browser voice instead
                </button>
              </div>
            )}
            {rec.status === "error" && (
              <div className="walk-recording" onClick={(e) => e.stopPropagation()}>
                <p>{rec.message}</p>
                <div className="walk-recording-actions">
                  <button type="button" className="button button-primary" onClick={() => setRecordAttempt((n) => n + 1)}>
                    <RetryIcon size={15} /> Try again
                  </button>
                  <button type="button" className="walk-chip" onClick={() => changeVoice("browser")}>
                    Use the browser voice
                  </button>
                </div>
              </div>
            )}
            {fresh && recorded && (
              <button type="button" className="walk-bigplay" onClick={(e) => { e.stopPropagation(); togglePlay(); }} aria-label="Play video">
                <PlayIcon size={34} />
              </button>
            )}
          </div>

          <div className="walk-controls">
            <div className="walk-scrub">
              <input
                type="range"
                min={0}
                max={total}
                step={0.1}
                value={t}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label="Seek"
                style={{ "--walk-pct": `${(t / total) * 100}%` } as React.CSSProperties}
              />
              {chapters.map((_, c) => {
                if (c === 0) return null;
                const start = chapterStart(segments, c);
                return start === null ? null : <span key={c} className="walk-tick" style={{ left: `${(start / total) * 100}%` }} />;
              })}
            </div>
            <div className="walk-bar">
              <button type="button" className="walk-btn walk-btn--play" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
                {playing ? <span className="walk-pause-text">Pause</span> : <PlayIcon size={16} />}
              </button>
              <span className="walk-time">
                {formatClock(t)} / {formatClock(total)}
              </span>
              <div className="walk-chapters" role="tablist" aria-label="Chapters">
                {chapters.map((name, c) => {
                  const start = chapterStart(segments, c);
                  if (start === null) return null;
                  return (
                    <button
                      key={name}
                      type="button"
                      role="tab"
                      aria-selected={chapter === c}
                      className={`walk-chip${chapter === c ? " is-on" : ""}`}
                      onClick={() => seek(start)}
                    >
                      {c + 1}. {name}
                    </button>
                  );
                })}
              </div>
              <div className="walk-bar-right">
                <button type="button" className={`walk-btn${muted ? "" : " is-on"}`} onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute (m)" : "Mute (m)"}>
                  <SpeakerIcon size={16} />
                  {muted && <span className="walk-btn-slash" aria-hidden="true" />}
                </button>
                <button type="button" className={`walk-btn walk-btn--text${captions ? " is-on" : ""}`} onClick={() => setCaptions((c) => !c)} aria-pressed={captions} title="Captions (c)">
                  CC
                </button>
                {!popped && <Dropdown bare label="Playback speed" value={speed} options={SPEEDS.map((s) => ({ value: s, label: `${s}x` }))} onChange={setSpeed} className="walk-select" />}
                {!popped && (
                  <>
                    <Dropdown bare label="Kojo's voice" value={voice} options={VOICE_CHOICES} onChange={changeVoice} className="walk-select walk-select--voice" />
                    <button type="button" className="walk-btn walk-btn--text" onClick={toggleFullscreen} title="Full screen (f)">
                      Full screen
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Stage({ seg, progress, local }: { seg: Segment; progress: number; local: number }) {
  const scene = seg.scene;
  if (scene.type === "title") {
    const shown = scene.from + Math.ceil((scene.to - scene.from) * Math.min(1, progress * 1.4));
    return (
      <div className="walk-stage walk-stage--breakdown">
        <div className="walk-titlecard">
          <span className="walk-kicker">{scene.kicker}</span>
          <h2>{scene.title}</h2>
        </div>
        <ul className="walk-points">
          {scene.points.slice(0, shown).map((p, i) => (
            <li key={i} className="walk-pop">
              {p}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (scene.type === "cards") {
    return (
      <div className="walk-stage walk-stage--approaches">
        {scene.cards.slice(0, scene.current + 1).map((c, i) => (
          <article key={i} className={`walk-approach${i === scene.current ? " is-now walk-pop" : ""}${c.tone ? ` walk-approach--${c.tone}` : ""}`}>
            <div className="walk-approach-head">
              <strong>{c.title}</strong>
              {c.badge ? <span className="walk-verdict">{c.badge}</span> : null}
            </div>
            {c.pills?.length ? (
              <div className="walk-pills">
                {c.pills.map((p) => (
                  <span key={p}>{p}</span>
                ))}
              </div>
            ) : null}
            {c.body ? <p>{c.body}</p> : null}
            {i === scene.current && c.detail ? <p className="walk-why">{c.detail}</p> : null}
          </article>
        ))}
      </div>
    );
  }
  if (scene.type === "ink") {
    return <InkBoard frames={scene.frames} current={scene.current} progress={progress} />;
  }
  return <CodePane scene={scene} typeDur={seg.typeDur} local={local} />;
}

/** Types the current line and keeps it in view, like a screen recording that follows
 *  the cursor. Also holds the closing complexity card. */
function CodePane({ scene, typeDur, local }: { scene: Extract<Scene, { type: "code" }>; typeDur?: number; local: number }) {
  const preRef = useRef<HTMLPreElement>(null);
  const lineIdx = scene.current;
  const typing = typeDur !== undefined && lineIdx < scene.lines.length;
  const typed = typing ? Math.min(1, local / (typeDur as number)) : 1;

  // Follow the line being typed: keep it in the middle of the pane. Scrolls only the
  // pane (never the page) and only when the line would leave the comfortable zone.
  useEffect(() => {
    const pre = preRef.current;
    const line = pre?.querySelector<HTMLElement>(".walk-code-line.is-now") ?? pre?.lastElementChild;
    if (!pre || !(line instanceof HTMLElement)) return;
    const top = line.offsetTop - pre.offsetTop;
    const view = pre.clientHeight;
    if (top < pre.scrollTop + view * 0.2 || top + line.offsetHeight > pre.scrollTop + view * 0.75) {
      pre.scrollTo({ top: Math.max(0, top - view * 0.45), behavior: "smooth" });
    }
  }, [lineIdx, scene.lines]);

  return (
    <div className="walk-stage walk-stage--code">
      <pre className="walk-code" ref={preRef} aria-label={scene.label}>
        {scene.lines.map((c, i) => {
          if (i > lineIdx) return null;
          const text = i < lineIdx ? c.line : c.line.slice(0, Math.floor(c.line.length * typed));
          return (
            <div key={i} className={`walk-code-line${i === lineIdx ? " is-now" : ""}`}>
              <span className="walk-ln">{i + 1}</span>
              <code>
                {text}
                {i === lineIdx && typing ? <span className="walk-caret" /> : null}
              </code>
            </div>
          );
        })}
      </pre>
      {scene.complexity && (
        <div className="walk-complexity walk-pop">
          <span>Time {scene.complexity.time || "-"}</span>
          <span>Space {scene.complexity.space || "-"}</span>
        </div>
      )}
    </div>
  );
}

function InkBoard({ frames, current, progress }: { frames: WalkFrame[]; current: number; progress: number }) {
  let firstOnBoard = 0;
  for (let i = current; i > 0; i--) {
    if (frames[i].clear) {
      firstOnBoard = i;
      break;
    }
  }
  return (
    <div className="walk-stage walk-stage--ink">
      <svg viewBox="0 0 100 60" className="walk-ink" role="img" aria-label="Kojo's sketch">
        <defs>
          <pattern id="walk-grid" width="5" height="5" patternUnits="userSpaceOnUse">
            <path d="M5 0H0V5" fill="none" stroke="var(--walk-grid)" strokeWidth="0.15" />
          </pattern>
        </defs>
        <rect width="100" height="60" fill="url(#walk-grid)" />
        {frames.slice(0, current + 1).map((f, fi) => {
          // Only what is on the board since the last wipe.
          if (fi < firstOnBoard) return null;
          const units = f.strokes.length + f.labels.length;
          // Each stroke, then each label, takes an equal slice of the frame's time.
          const p = fi < current ? units : Math.min(1, progress * 1.15) * units;
          return (
            <g key={fi}>
              {f.strokes.map((s, si) => {
                const frac = Math.min(1, Math.max(0, p - si));
                if (frac <= 0) return null;
                return (
                  <path
                    key={si}
                    d={inkPath(s.points)}
                    pathLength={1}
                    fill="none"
                    stroke={INK[s.color]}
                    strokeWidth={0.55}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="1"
                    strokeDashoffset={1 - frac}
                  />
                );
              })}
              {f.labels.map((l, li) => {
                const frac = Math.min(1, Math.max(0, p - f.strokes.length - li));
                if (frac <= 0) return null;
                // Rewritten later: fade out as the new text starts, then gone.
                if (l.until !== undefined && current > l.until) return null;
                const erasing = l.until !== undefined && current === l.until ? Math.max(0, 1 - progress * 4) : 1;
                if (erasing <= 0) return null;
                return (
                  <text key={li} x={l.x} y={l.y} fill={INK[l.color]} className="walk-ink-label" style={{ opacity: frac * erasing }}>
                    {l.text.slice(0, Math.max(1, Math.ceil(l.text.length * frac)))}
                  </text>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
