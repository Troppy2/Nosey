import { ChevronDown, Pause, Play, RotateCcw, Square } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { toast } from "../lib/toast";
import { formatClock, useTestTimer, type TimerMode } from "../lib/useTestTimer";
import "../styles/components/test-timer.css";

const PRESET_MINUTES = [15, 30, 60];

// The timer pill in the test toolbar. A countdown drains the pill like a fuse,
// turns amber in its last fifth, and past zero counts overtime in red.
export function TestTimer({ storageKey }: { storageKey: string }) {
  const timer = useTestTimer(storageKey);
  const [menuOpen, setMenuOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const { state, running, idle, overtime, fraction } = timer;
  const isCountdown = state.mode === "countdown";

  timer.onTimeUp(() => toast.info("Time's up", "The clock keeps counting overtime. Submit when you're ready."));

  // Close the menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return undefined;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const shownMs = isCountdown ? timer.remainingMs : timer.elapsedMs;
  const clock = formatClock(shownMs);
  const tone = overtime ? "over" : isCountdown && fraction !== null && fraction <= 0.2 ? "low" : "ok";
  const status = running ? "running" : idle ? "idle" : "paused";
  const fillStyle = { "--tt-fill": `${(fraction ?? 0) * 100}%` } as CSSProperties;

  function choose(mode: TimerMode, minutes?: number) {
    timer.configure(mode, minutes ? minutes * 60_000 : undefined);
    setMenuOpen(false);
  }

  const durationMinutes = Math.round(state.durationMs / 60_000);
  const label = isCountdown
    ? overtime
      ? `${clock.main} minutes ${clock.seconds} seconds over time`
      : `${clock.main} minutes ${clock.seconds} seconds left`
    : `${clock.main} minutes ${clock.seconds} seconds elapsed`;

  return (
    <div ref={wrapRef} className="tt-wrap">
      <div
        className={`tt tt--${status} tt--${tone}${isCountdown ? " tt--countdown" : ""}`}
        style={fillStyle}
        role="timer"
        aria-label={`Test timer, ${status}: ${label}`}
      >
        <span className="tt-dot" aria-hidden="true" />
        <span className="tt-clock" aria-hidden="true">
          {overtime ? <span className="tt-sign">+</span> : null}
          {clock.main}
          <span className="tt-colon">:</span>
          <span className="tt-sec">{clock.seconds}</span>
        </span>
        <span className="tt-controls">
          <button
            type="button"
            className="tt-btn tt-btn--main"
            onClick={running ? timer.pause : timer.start}
            aria-label={running ? "Pause timer" : idle ? "Start timer" : "Resume timer"}
            title={running ? "Pause" : idle ? "Start" : "Resume"}
          >
            {running ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            type="button"
            className="tt-btn"
            onClick={timer.restart}
            aria-label="Restart timer"
            title="Restart from the beginning"
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            className="tt-btn"
            onClick={timer.stop}
            disabled={idle}
            aria-label="Stop and reset timer"
            title="Stop and reset"
          >
            <Square size={12} />
          </button>
          <button
            type="button"
            className={`tt-btn tt-btn--menu${menuOpen ? " is-open" : ""}`}
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-label="Timer settings"
            title="Stopwatch or countdown"
          >
            <ChevronDown size={14} />
          </button>
        </span>
      </div>

      {menuOpen ? (
        <div className="tt-menu" role="dialog" aria-label="Timer settings">
          <div className="tt-modes" role="radiogroup" aria-label="Timer type">
            {(["stopwatch", "countdown"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={state.mode === mode}
                className={`choice${state.mode === mode ? " active" : ""}`}
                onClick={() => (mode === "stopwatch" ? choose("stopwatch") : choose("countdown", durationMinutes))}
              >
                {mode === "stopwatch" ? "Stopwatch" : "Countdown"}
              </button>
            ))}
          </div>
          {isCountdown ? (
            <div className="tt-presets">
              {PRESET_MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`tt-preset${durationMinutes === m ? " is-active" : ""}`}
                  onClick={() => choose("countdown", m)}
                >
                  {m} min
                </button>
              ))}
              <form
                className="tt-custom"
                onSubmit={(e) => {
                  e.preventDefault();
                  const m = Math.round(Number(customMinutes));
                  if (m >= 1 && m <= 600) {
                    choose("countdown", m);
                    setCustomMinutes("");
                  }
                }}
              >
                <input
                  type="number"
                  min={1}
                  max={600}
                  inputMode="numeric"
                  placeholder={PRESET_MINUTES.includes(durationMinutes) ? "Custom" : String(durationMinutes)}
                  value={customMinutes}
                  onChange={(e) => setCustomMinutes(e.target.value)}
                  aria-label="Custom minutes"
                />
                <button type="submit" className="tt-preset" disabled={!customMinutes}>
                  Set
                </button>
              </form>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
