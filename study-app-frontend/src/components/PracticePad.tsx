import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircleIcon, ChevronDownIcon, ChevronRightIcon, CrossCircleIcon, PencilIcon } from "../icons";
import { saveModulePractice } from "../lib/api";
import type { PadMode } from "../lib/practicePads";
import type { PracticeItemState } from "../lib/types";
import { Button } from "./Button";
import { FormError } from "./FormError";
import { MarkdownContent } from "./MarkdownContent";
import { useSettings } from "../lib/useSettings";
import {
  exportScratchPadPng,
  isScratchPadEmpty,
  parseScratchPadJson,
  ScratchPadModal,
  type PaperStyle,
  type ScratchPadData,
} from "./ScratchPad";
import { languageName } from "./PracticeTypePanel";
import "../styles/components/practice-pad.css";

// Ink autosaves this long after the last stroke, and again when the pad closes.
const SAVE_DEBOUNCE_MS = 1200;

type PracticePadProps = {
  moduleId: number;
  index: number;
  // Markdown of the problem statement, shown at the top of the scratch pad.
  problemText: string;
  state: PracticeItemState;
  onState: (next: PracticeItemState) => void;
  paperStyle: PaperStyle;
  onPaperStyleChange: (style: PaperStyle) => void;
  // The walkthrough blocks, already rendered. Not mounted until unlocked.
  walkthrough: ReactNode;
  // Set by the lesson's marker: "draw" is ink only; "text" / "code" add a
  // typed tab to the pad (the ink tab stays).
  mode?: PadMode;
  language?: string | null;
};

// A typed answer shorter than this (trimmed) is not work. Same as
// MIN_TYPED_CHARS in services/practice_progress.py.
const MIN_TYPED_CHARS = 3;

type PendingSave = { strokes?: string; typed?: string };

type PracticeQuizGateProps = {
  pads: { index: number; status: PracticeItemState["status"] }[];
  onJump: (padIndex: number) => void;
};

const STATUS_LABEL: Record<PracticeItemState["status"], string> = {
  open: "not done",
  done: "solved",
  gave_up: "gave up",
};

// Stands in for the quiz until every practice pad is solved or given up. Each
// chip is a problem: its state at a glance, and a jump to it.
export function PracticeQuizGate({ pads, onJump }: PracticeQuizGateProps) {
  const left = pads.filter((p) => p.status === "open");
  const next = left[0];
  if (!next) return null;
  const total = pads.length;
  return (
    <section className="practice-gate" aria-labelledby="practice-gate-title">
      <div className="practice-gate-head">
        <span className="practice-gate-icon" aria-hidden="true">
          <PencilIcon size={18} />
        </span>
        <div className="practice-gate-text">
          <h3 id="practice-gate-title">
            {total === 1 ? "Solve the practice problem to unlock the quiz" : "Solve the practice problems to unlock the quiz"}
          </h3>
          <p className="muted small">
            {left.length} of {total} left. Giving up counts as wrong.
          </p>
        </div>
      </div>

      {total > 1 ? (
        <ol className="practice-gate-steps">
          {pads.map((pad) => (
            <li key={pad.index}>
              <button
                type="button"
                className={`practice-gate-step is-${pad.status}`}
                onClick={() => onJump(pad.index)}
                aria-label={`Practice problem ${pad.index + 1}, ${STATUS_LABEL[pad.status]}`}
                title={`Problem ${pad.index + 1}: ${STATUS_LABEL[pad.status]}`}
              >
                {pad.status === "done" ? (
                  <CheckCircleIcon size={16} />
                ) : pad.status === "gave_up" ? (
                  <CrossCircleIcon size={16} />
                ) : null}
                <span>{pad.index + 1}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      <div className="practice-gate-action">
        <Button onClick={() => onJump(next.index)}>
          {left.length === total ? "Start" : "Continue with"} problem {next.index + 1}
        </Button>
      </div>
    </section>
  );
}

// A practice problem inside a lesson: work it on the scratch pad, then mark it
// done (needs ink) or give up (counts wrong). Either one is final and opens the
// walkthrough, which stays collapsed and unmounted until then.
export function PracticePad({
  moduleId,
  index,
  problemText,
  state,
  onState,
  paperStyle,
  onPaperStyleChange,
  walkthrough,
  mode = "draw",
  language = null,
}: PracticePadProps) {
  const typedMode = mode === "draw" ? null : mode;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const resolved = state.status !== "open";
  const [walkOpen, setWalkOpen] = useState(resolved);
  // Finishing or giving up opens the walkthrough; it can be folded again after.
  useEffect(() => {
    if (resolved) setWalkOpen(true);
  }, [resolved]);

  // The pad's drawing, held as the SAME object the canvas emitted. The canvas
  // recognises the echo of its own edit by array identity; handing it a
  // re-parsed copy instead made it adopt that copy as an outside reset and
  // drop any stroke drawn since (the "lines disappear" bug). Saved ink from
  // the server is only parsed in when it differs from what this pad produced.
  const [data, setData] = useState<ScratchPadData>(() => parseScratchPadJson(state.strokes));
  const producedJsonRef = useRef<string | null>(state.strokes);
  useEffect(() => {
    if (state.strokes === producedJsonRef.current) return;
    producedJsonRef.current = state.strokes;
    setData(parseScratchPadJson(state.strokes));
  }, [state.strokes]);

  // Typed answer, same echo guard as the ink: only adopt the server's copy
  // when it is not what this pad last produced.
  const [typed, setTyped] = useState<string>(state.typed ?? "");
  const { markdownAnswers } = useSettings();
  const producedTypedRef = useRef<string | null>(state.typed ?? null);
  useEffect(() => {
    const incoming = state.typed ?? null;
    if (incoming === producedTypedRef.current) return;
    producedTypedRef.current = incoming;
    setTyped(incoming ?? "");
  }, [state.typed]);

  const hasInk = !isScratchPadEmpty(data);
  const hasTyped = typed.trim().length >= MIN_TYPED_CHARS;
  const hasWork = hasInk || hasTyped;
  // A cropped picture of the work under the card, so solved pads show it.
  // Built only while the pad is closed: no offscreen render per stroke. The
  // export returns bare base64 (it feeds OCR), so add the data URL prefix.
  const preview = useMemo(() => {
    const png = !open && hasInk ? exportScratchPadPng(data, { faithful: true }) : null;
    return png ? `data:image/png;base64,${png}` : null;
  }, [data, hasInk, open]);

  // Unsaved ink / typing, flushed by the debounce, on close, on resolve and
  // on unmount. Only the fields that changed are sent.
  const pendingRef = useRef<PendingSave | null>(null);
  const timerRef = useRef<number | null>(null);

  async function flush(): Promise<boolean> {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (pending == null) return true;
    pendingRef.current = null;
    try {
      await saveModulePractice(moduleId, index, pending);
      return true;
    } catch (err) {
      // Keep it for the next try, under anything newer queued meanwhile.
      pendingRef.current = { ...pending, ...(pendingRef.current ?? {}) };
      setError(err instanceof Error ? err.message : "Couldn't save your work.");
      return false;
    }
  }

  useEffect(
    () => () => {
      // Leaving the page: send what is left without waiting on it.
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      const pending = pendingRef.current;
      if (pending != null) void saveModulePractice(moduleId, index, pending).catch(() => undefined);
    },
    [moduleId, index],
  );

  function queueSave(change: PendingSave) {
    pendingRef.current = { ...pendingRef.current, ...change };
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }

  // Ink stays in this component (and the autosave). The lesson page is not
  // told per stroke: that re-rendered every KaTeX block on the page while the
  // student was still drawing. It only hears about done / gave up.
  function handleInk(next: ScratchPadData) {
    setData(next);
    const strokes = JSON.stringify(next);
    producedJsonRef.current = strokes;
    queueSave({ strokes });
  }

  function handleTyped(next: string) {
    setTyped(next);
    producedTypedRef.current = next;
    queueSave({ typed: next });
  }

  async function resolve(status: "done" | "gave_up") {
    setBusy(true);
    setError(null);
    try {
      const pending = pendingRef.current ?? {};
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingRef.current = null;
      const saved = await saveModulePractice(moduleId, index, { ...pending, status });
      // The saved work is what this pad already shows; keep the live objects.
      producedJsonRef.current = saved.strokes;
      producedTypedRef.current = saved.typed ?? null;
      onState(saved);
      setOpen(false);
      setWalkOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that. Try again.");
    } finally {
      setBusy(false);
      setConfirmGiveUp(false);
    }
  }

  return (
    <div className={`practice-pad is-${state.status}`}>
      <div className="practice-pad-card">
        <div className="practice-pad-head">
          <span className="eyebrow">Practice problem {index + 1}</span>
          {state.status === "done" ? (
            <span className="practice-pad-status is-done">
              <CheckCircleIcon size={15} /> Solved
            </span>
          ) : state.status === "gave_up" ? (
            <span className="practice-pad-status is-gave-up">
              <CrossCircleIcon size={15} /> Gave up, counted wrong
            </span>
          ) : null}
        </div>

        {typedMode === "text" && hasTyped && !open && markdownAnswers ? (
          // Markdown answers on: the closed card shows the answer formatted. A div,
          // not a <button>, because the answer can hold links and folding callouts.
          <div
            role="button"
            tabIndex={0}
            className="practice-pad-typed practice-pad-typed--md"
            aria-label="Open your answer"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a, summary")) return;
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setOpen(true);
              }
            }}
          >
            <MarkdownContent content={typed} obsidian />
          </div>
        ) : typedMode && hasTyped && !open ? (
          <button
            type="button"
            className="practice-pad-typed"
            onClick={() => setOpen(true)}
            aria-label={typedMode === "code" ? "Open your code" : "Open your answer"}
          >
            {typedMode === "code" ? <pre>{typed.trimEnd()}</pre> : <p>{typed.trim()}</p>}
          </button>
        ) : null}

        {preview ? (
          <button type="button" className="practice-pad-preview" onClick={() => setOpen(true)} aria-label="Open your scratch work">
            <img src={preview} alt="Your scratch work" />
          </button>
        ) : null}

        <div className="practice-pad-actions">
          <Button variant={resolved ? "secondary" : "primary"} icon={<PencilIcon size={15} />} onClick={() => setOpen(true)} disabled={busy}>
            {resolved ? (hasWork ? "View your work" : "Open scratch pad") : hasWork ? "Continue on scratch pad" : "Solve on scratch pad"}
          </Button>
          {!resolved ? (
            <>
              <Button
                variant="secondary"
                icon={<CheckCircleIcon size={15} />}
                onClick={() => void resolve("done")}
                disabled={busy || !hasWork}
                title={hasWork ? "Mark this problem solved" : "Work the problem on the scratch pad first"}
              >
                I'm done
              </Button>
              {confirmGiveUp ? (
                <span className="practice-pad-confirm">
                  <span className="small muted">Counts as wrong.</span>
                  <Button variant="danger-outline" onClick={() => void resolve("gave_up")} disabled={busy}>
                    Give up
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmGiveUp(false)} disabled={busy}>
                    Keep trying
                  </Button>
                </span>
              ) : (
                <Button variant="ghost" onClick={() => setConfirmGiveUp(true)} disabled={busy}>
                  I give up
                </Button>
              )}
            </>
          ) : null}
        </div>
        {!resolved && !hasWork ? (
          <p className="small muted practice-pad-hint">
            {typedMode === "code"
              ? `Write your ${languageName(language ?? "python")} solution on the pad, then press I'm done to see the walkthrough.`
              : typedMode === "text"
                ? "Type your answer on the pad, then press I'm done to see the walkthrough."
                : "Write your work on the pad, then press I'm done to see the walkthrough."}
          </p>
        ) : null}
        <FormError message={error} />
      </div>

      <div className={`practice-walk ${resolved ? "" : "is-locked"}`}>
        <button
          type="button"
          className="practice-walk-toggle"
          onClick={() => setWalkOpen((v) => !v)}
          disabled={!resolved}
          aria-expanded={resolved && walkOpen}
        >
          {resolved && walkOpen ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
          <span>Walkthrough</span>
          {!resolved ? <span className="small muted practice-walk-note">Unlocks when you finish or give up</span> : null}
        </button>
        {resolved && walkOpen ? <div className="practice-walk-body">{walkthrough}</div> : null}
      </div>

      {open
        ? createPortal(
            <ScratchPadModal
              questionText={problemText}
              data={data}
              onChange={handleInk}
              paperStyle={paperStyle}
              onPaperStyleChange={onPaperStyleChange}
              typing={typedMode ? { mode: typedMode, language, value: typed, onChange: handleTyped } : undefined}
              onClose={() => {
                setOpen(false);
                void flush();
              }}
            />,
            document.body,
          )
        : null}
    </div>
  );
}
