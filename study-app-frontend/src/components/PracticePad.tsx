import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckCircleIcon, ChevronDownIcon, ChevronRightIcon, CrossCircleIcon, PencilIcon } from "../icons";
import { saveModulePractice } from "../lib/api";
import type { PracticeItemState } from "../lib/types";
import { Button } from "./Button";
import { FormError } from "./FormError";
import {
  exportScratchPadPng,
  isScratchPadEmpty,
  parseScratchPadJson,
  ScratchPadModal,
  type PaperStyle,
  type ScratchPadData,
} from "./ScratchPad";
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
};

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
}: PracticePadProps) {
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

  const data = useMemo(() => parseScratchPadJson(state.strokes), [state.strokes]);
  const hasWork = !isScratchPadEmpty(data);
  // A cropped picture of the work under the card, so solved pads show it.
  // The export returns bare base64 (it feeds OCR), so add the data URL prefix.
  const preview = useMemo(() => {
    const png = hasWork ? exportScratchPadPng(data, { faithful: true }) : null;
    return png ? `data:image/png;base64,${png}` : null;
  }, [data, hasWork]);

  // Unsaved ink, flushed by the debounce, on close, on resolve and on unmount.
  const pendingRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  async function flush(): Promise<boolean> {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const strokes = pendingRef.current;
    if (strokes == null) return true;
    pendingRef.current = null;
    try {
      await saveModulePractice(moduleId, index, { strokes });
      return true;
    } catch (err) {
      pendingRef.current = strokes;
      setError(err instanceof Error ? err.message : "Couldn't save your work.");
      return false;
    }
  }

  useEffect(
    () => () => {
      // Leaving the page: send what is left without waiting on it.
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      const strokes = pendingRef.current;
      if (strokes != null) void saveModulePractice(moduleId, index, { strokes }).catch(() => undefined);
    },
    [moduleId, index],
  );

  function handleInk(next: ScratchPadData) {
    const strokes = JSON.stringify(next);
    onState({ ...state, strokes });
    pendingRef.current = strokes;
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }

  async function resolve(status: "done" | "gave_up") {
    setBusy(true);
    setError(null);
    try {
      const strokes = pendingRef.current ?? undefined;
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingRef.current = null;
      const saved = await saveModulePractice(moduleId, index, { strokes, status });
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
          <p className="small muted practice-pad-hint">Write your work on the pad, then press I'm done to see the walkthrough.</p>
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
