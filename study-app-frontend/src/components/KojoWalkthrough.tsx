import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { CloseIcon, PlayIcon, RetryIcon, SpeakerIcon } from "../icons";
import { fetchSolutionWalkthrough, recordWalkthroughAudio } from "../lib/api";
import type { SolutionWalkthrough, WalkFrame, WalkInk } from "../lib/types";
import { VOICE_OPTIONS } from "../lib/voice";
import {
  CHAPTERS,
  buildTimeline,
  chapterStart,
  formatClock,
  segmentAt,
  spokenLines,
  type ChapterIndex,
  type Segment,
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

/** Records every line of the walkthrough in one AI voice (cached on the server) and
 *  measures each clip, so the timeline matches the real audio. Browser voice needs none. */
function useRecording(slug: string, walk: SolutionWalkthrough, problemTitle: string, voice: VoiceChoice, attempt: number): Recording {
  const [rec, setRec] = useState<Recording>(() =>
    voice === "browser" ? { voice, status: "ready", clips: null } : { voice, status: "recording" },
  );
  useEffect(() => {
    if (voice === "browser") {
      setRec({ voice, status: "ready", clips: null });
      return;
    }
    let cancelled = false;
    const urls: string[] = [];
    setRec({ voice, status: "recording" });
    const lines = spokenLines(walk, problemTitle);
    recordWalkthroughAudio(slug, voice, lines)
      .then(async (res) => {
        const made = await Promise.all(res.clips.map(clipFromBase64));
        made.forEach((c) => urls.push(c.url));
        if (cancelled) return;
        setRec({ voice, status: "ready", clips: new Map(lines.map((line, i) => [line, made[i]])) });
      })
      .catch((e: unknown) => {
        if (!cancelled) setRec({ voice, status: "error", message: e instanceof Error ? e.message : "Kojo could not record the audio." });
      });
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [slug, walk, problemTitle, voice, attempt]);
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

export function KojoWalkthrough({ slug, problemTitle, statement, statementText, starterCode, provider, onClose }: Props) {
  const [walk, setWalk] = useState<SolutionWalkthrough | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

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

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="walk-overlay" role="dialog" aria-modal="true" aria-label={`Kojo's walkthrough of ${problemTitle}`}>
      {walk ? (
        <WalkPlayer slug={slug} walk={walk} problemTitle={problemTitle} statement={statement} onClose={onClose} />
      ) : (
        <div className="walk-shell walk-shell--loading">
          <button type="button" className="walk-close" onClick={onClose} aria-label="Close">
            <CloseIcon size={18} />
          </button>
          {error ? (
            <div className="walk-loading">
              <p>{error}</p>
              <button type="button" className="button button-primary" onClick={() => setAttempt((n) => n + 1)}>
                <RetryIcon size={15} /> Try again
              </button>
            </div>
          ) : (
            <div className="walk-loading">
              <Loader2 size={22} className="spin" />
              <p>Kojo is recording the walkthrough. The first time takes about 30 seconds; after that it opens instantly.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WalkPlayer({
  slug,
  walk,
  problemTitle,
  statement,
  onClose,
}: {
  slug: string;
  walk: SolutionWalkthrough;
  problemTitle: string;
  statement: ReactNode;
  onClose: () => void;
}) {
  const [voice, setVoiceState] = useState<VoiceChoice>(loadVoice);
  const [recordAttempt, setRecordAttempt] = useState(0);
  const rec = useRecording(slug, walk, problemTitle, voice, recordAttempt);
  const clips = rec.status === "ready" ? rec.clips : null;
  const recorded = rec.status === "ready";
  const durations = useMemo(
    () => (clips ? new Map([...clips].map(([line, c]) => [line, c.dur] as [string, number])) : undefined),
    [clips],
  );
  const { segments, total } = useMemo(() => buildTimeline(walk, problemTitle, durations), [walk, problemTitle, durations]);
  const shellRef = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>("1");
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [showProblem, setShowProblem] = useState(true);
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
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [role='listbox'], [role='combobox']")) return;
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") seek(tRef.current + 5);
      else if (e.key === "ArrowLeft") seek(tRef.current - 5);
      else if (e.key === "f") toggleFullscreen();
      else if (e.key === "m") setMuted((m) => !m);
      else if (e.key === "c") setCaptions((c) => !c);
      else if (e.key === "Escape" && !document.fullscreenElement) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const chapter = seg.chapter as ChapterIndex;
  const fresh = t === 0 && !playing;

  return (
    <div className={`walk-shell${showProblem ? "" : " walk-shell--wide"}`} ref={shellRef}>
      <header className="walk-head">
        <div className="walk-head-title">
          <span className="eyebrow">Kojo's walkthrough</span>
          <strong>{problemTitle}</strong>
        </div>
        <button type="button" className="walk-chip" onClick={() => setShowProblem((v) => !v)} aria-pressed={showProblem}>
          {showProblem ? "Hide problem" : "Show problem"}
        </button>
        <button type="button" className="walk-close" onClick={onClose} aria-label="Close walkthrough">
          <CloseIcon size={18} />
        </button>
      </header>

      <div className="walk-body">
        {showProblem && (
          <aside className="walk-problem" aria-label="Problem">
            <h3>{problemTitle}</h3>
            <div className="walk-problem-text">{statement}</div>
          </aside>
        )}

        <section className="walk-video">
          <div className="walk-screen" onClick={togglePlay}>
            <Stage walk={walk} segments={segments} idx={idx} progress={progress} local={local} problemTitle={problemTitle} />
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
              <button type="button" className="walk-bigplay" onClick={(e) => { e.stopPropagation(); togglePlay(); }} aria-label="Play walkthrough">
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
              {([1, 2, 3] as ChapterIndex[]).map((c) => {
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
                {CHAPTERS.map((name, c) => {
                  const start = chapterStart(segments, c as ChapterIndex);
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
                <Dropdown bare label="Playback speed" value={speed} options={SPEEDS.map((s) => ({ value: s, label: `${s}x` }))} onChange={setSpeed} className="walk-select" />
                <Dropdown bare label="Kojo's voice" value={voice} options={VOICE_CHOICES} onChange={changeVoice} className="walk-select walk-select--voice" />
                <button type="button" className="walk-btn walk-btn--text" onClick={toggleFullscreen} title="Full screen (f)">
                  Full screen
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Stage({
  walk,
  segments,
  idx,
  progress,
  local,
  problemTitle,
}: {
  walk: SolutionWalkthrough;
  segments: Segment[];
  idx: number;
  progress: number;
  local: number;
  problemTitle: string;
}) {
  const seg = segments[idx];
  if (seg.kind === "intro" || seg.kind === "breakdown") {
    const step = seg.kind === "intro" ? -1 : seg.index;
    const shownPoints =
      step < 0 ? 0 : Math.ceil(((step + Math.min(1, progress * 1.4)) / Math.max(1, walk.breakdown.length)) * walk.key_points.length);
    return (
      <div className="walk-stage walk-stage--breakdown">
        <div className="walk-titlecard">
          <span className="walk-kicker">Kojo explains</span>
          <h2>{problemTitle}</h2>
        </div>
        <ul className="walk-points">
          {walk.key_points.slice(0, shownPoints).map((p, i) => (
            <li key={i} className="walk-pop">
              {p}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (seg.kind === "approach") {
    return (
      <div className="walk-stage walk-stage--approaches">
        {walk.approaches.slice(0, seg.index + 1).map((a, i) => (
          <article key={i} className={`walk-approach${i === seg.index ? " is-now walk-pop" : ""} walk-approach--${a.verdict.replace(" ", "-")}`}>
            <div className="walk-approach-head">
              <strong>{a.name}</strong>
              <span className="walk-verdict">{a.verdict}</span>
            </div>
            <div className="walk-pills">
              <span>Time {a.time || "-"}</span>
              <span>Space {a.space || "-"}</span>
            </div>
            <p>{a.idea}</p>
            {i === seg.index ? <p className="walk-why">{a.why}</p> : null}
          </article>
        ))}
      </div>
    );
  }
  if (seg.kind === "frame") {
    return <InkBoard frames={walk.frames} current={seg.index} progress={progress} />;
  }
  return <CodePane walk={walk} seg={seg} local={local} />;
}

/** The code chapter: types the current line and keeps it in view, like a screen
 *  recording that follows the cursor. Also holds the closing complexity card. */
function CodePane({ walk, seg, local }: { walk: SolutionWalkthrough; seg: Segment; local: number }) {
  const preRef = useRef<HTMLPreElement>(null);
  const lineIdx = seg.kind === "code" ? seg.index : walk.code.length;
  const typed = seg.kind === "code" ? Math.min(1, local / seg.typeDur) : 1;

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
  }, [lineIdx]);

  return (
    <div className="walk-stage walk-stage--code">
      <pre className="walk-code" ref={preRef} aria-label="Solution code">
        {walk.code.map((c, i) => {
          if (i > lineIdx) return null;
          const text = i < lineIdx ? c.line : c.line.slice(0, Math.floor(c.line.length * typed));
          return (
            <div key={i} className={`walk-code-line${i === lineIdx ? " is-now" : ""}`}>
              <span className="walk-ln">{i + 1}</span>
              <code>
                {text}
                {i === lineIdx && seg.kind === "code" ? <span className="walk-caret" /> : null}
              </code>
            </div>
          );
        })}
      </pre>
      {seg.kind === "complexity" && (
        <div className="walk-complexity walk-pop">
          <span>Time {walk.time_complexity || "-"}</span>
          <span>Space {walk.space_complexity || "-"}</span>
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
