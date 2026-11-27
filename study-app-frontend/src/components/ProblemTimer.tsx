import { useEffect, useRef, useState } from "react";
import { RetryIcon, TimerIcon } from "../icons";
import {
  countdown,
  formatClock,
  pause,
  restart,
  resume,
  shownMs,
  stopwatch,
  TIMER_PRESETS,
  type ProblemTimer as Timer,
} from "../lib/problemTimer";
import { Button } from "./Button";
import { TextInput } from "./Field";
import "../styles/components/problem-timer.css";

type Tone = "idle" | "paused" | "calm" | "warn" | "alert" | "over";

/** A countdown drains its ring as time passes; the stopwatch shows a full ring. */
function TimerRing({ fraction, tone }: { fraction: number; tone: Tone }) {
  const size = 18;
  const stroke = 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(1, fraction)));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={`lc-ptimer-ring is-${tone}`} aria-hidden="true">
      <circle className="lc-ptimer-ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
      <circle
        className="lc-ptimer-ring-fill"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/** The editor's timer, LeetCode style: the clock with pause and restart in the toolbar, and
    a small dropdown to pick a countdown, a stopwatch, or stop. At zero a countdown keeps
    going as overtime and calls onZero once. */
export function ProblemTimer({
  timer,
  onChange,
  onZero,
}: {
  timer: Timer | null;
  onChange: (timer: Timer | null) => void;
  onZero: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Timer["mode"]>(timer?.mode ?? "timer");
  const [minutes, setMinutes] = useState("25");
  const [now, setNow] = useState(() => Date.now());
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const running = timer?.startedAt != null;

  useEffect(() => {
    setNow(Date.now());
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running, timer]);

  const shown = timer ? shownMs(timer, now) : 0;
  const reachedZero = timer?.mode === "timer" && shown <= 0;
  // Only a zero crossed just now opens Time's up (and records the signal). A countdown that
  // ran out while the page was closed shows its overtime quietly when you come back.
  // One notice per countdown even if the effect runs twice before the timer updates.
  const notified = useRef<string | null>(null);
  useEffect(() => {
    if (!timer || !reachedZero || timer.overNotified) return;
    const id = `${timer.totalMs}:${timer.startedAt}:${timer.elapsedMs}`;
    if (notified.current === id) return;
    notified.current = id;
    const overtime = -shownMs(timer, Date.now());
    onChange({ ...timer, overNotified: true });
    if (overtime < 5000) onZero();
    // Fires once when the countdown crosses zero; overNotified stops it repeating.
  }, [reachedZero, timer?.overNotified]);

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    box.current?.querySelector<HTMLElement>(".lc-ptimer-pop button[aria-pressed='true']")?.focus();
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  function start(next: Timer) {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  }

  const fraction = timer?.mode === "timer" && timer.totalMs ? shown / timer.totalMs : 1;
  const tone: Tone = !timer
    ? "idle"
    : !running
      ? "paused"
      : timer.mode === "stopwatch"
        ? "calm"
        : shown < 0
          ? "over"
          : fraction <= 0.2
            ? "alert"
            : fraction <= 0.34
              ? "warn"
              : "calm";
  const clock = timer ? formatClock(shown, timer.mode === "timer") : "Timer";
  const spoken = !timer
    ? "Set a timer"
    : timer.mode === "stopwatch"
      ? `Stopwatch ${clock}${running ? "" : ", paused"}. Change timer`
      : shown < 0
        ? `Overtime ${clock.slice(1)}. Change timer`
        : `${clock} left${running ? "" : ", paused"}. Change timer`;

  return (
    <div className="lc-ptimer" ref={box}>
      <div className={"lc-ptimer-bar is-" + tone}>
        <button
          ref={trigger}
          type="button"
          className="lc-ptimer-clock"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={spoken}
          title={spoken}
          onClick={() => {
            setMode(timer?.mode ?? mode);
            setOpen(!open);
          }}
        >
          {timer ? <TimerRing fraction={fraction} tone={tone} /> : <TimerIcon size={16} />}
          <span className="lc-ptimer-time">{clock}</span>
        </button>
        {timer ? (
          <>
            {/* Text, not a glyph: the custom icon set has no pause icon yet (rules/icons.md). */}
            <button
              type="button"
              className="lc-ptimer-btn lc-ptimer-btn--text"
              onClick={() => onChange(running ? pause(timer, Date.now()) : resume(timer, Date.now()))}
            >
              {running ? "Pause" : "Resume"}
            </button>
            <button type="button" className="lc-ptimer-btn" aria-label="Restart" title="Restart" onClick={() => onChange(restart(timer, Date.now()))}>
              <RetryIcon size={14} />
            </button>
          </>
        ) : null}
      </div>
      {open ? (
        <div className="lc-ptimer-pop" role="dialog" aria-label="Timer">
          {timer ? (
            // Phones keep only the clock in the toolbar; its controls live here.
            <div className="lc-ptimer-pop-controls">
              <Button variant="secondary" onClick={() => onChange(running ? pause(timer, Date.now()) : resume(timer, Date.now()))}>
                {running ? "Pause" : "Resume"}
              </Button>
              <Button variant="secondary" icon={<RetryIcon size={14} />} onClick={() => onChange(restart(timer, Date.now()))}>
                Restart
              </Button>
            </div>
          ) : null}
          <div className="lc-ptimer-modes" role="group" aria-label="Timer mode">
            {(["timer", "stopwatch"] as const).map((item) => (
              <button key={item} type="button" aria-pressed={mode === item} onClick={() => setMode(item)}>
                {item === "timer" ? "Timer" : "Stopwatch"}
              </button>
            ))}
          </div>
          {mode === "timer" ? (
            <>
              <div className="lc-ptimer-presets">
                {TIMER_PRESETS.map((preset) => (
                  <button key={preset.minutes} type="button" className="lc-ptimer-preset" onClick={() => start(countdown(preset.minutes, Date.now()))}>
                    <strong>{preset.minutes} min</strong>
                    <span>{preset.caption}</span>
                  </button>
                ))}
              </div>
              <form
                className="lc-ptimer-custom"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = Number(minutes);
                  if (Number.isFinite(value) && value > 0 && value <= 600) start(countdown(value, Date.now()));
                }}
              >
                <TextInput
                  label="Custom minutes"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={600}
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                />
                <Button type="submit" variant="secondary">Start</Button>
              </form>
            </>
          ) : (
            <div className="lc-ptimer-stopwatch">
              <p>Counts up from zero, so you see how long the problem takes.</p>
              <Button onClick={() => start(stopwatch(Date.now()))}>Start stopwatch</Button>
            </div>
          )}
          {timer ? (
            <Button
              variant="danger-outline"
              className="lc-ptimer-stop"
              onClick={() => {
                onChange(null);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              {timer.mode === "timer" ? "Stop timer" : "Stop stopwatch"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
