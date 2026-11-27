import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircleIcon, CrossCircleIcon } from "../../icons";
import { postTrailWriteup } from "../../lib/api";
import { toast } from "../../lib/toast";
import type { PTStepResult, PTWriteupGrade, PTWriteupPartKey } from "../../lib/types";
import { Button } from "../Button";
import { TextArea } from "../Field";
import { InlineLoading } from "../Loaders";
import "../../styles/components/trail-writeup.css";

/** The four parts Kojo reads, in order. Minimums keep it to real sentences. */
const PARTS: { key: PTWriteupPartKey; label: string; hint: string; min: number; max: number; rows: number }[] = [
  { key: "approach", label: "Approach in a sentence", hint: "Name the technique you used.", min: 12, max: 600, rows: 2 },
  { key: "how_it_works", label: "How your code works", hint: "Walk through what each part does.", min: 40, max: 1200, rows: 4 },
  { key: "complexity", label: "Time and space complexity", hint: "Both, and why.", min: 8, max: 400, rows: 2 },
  { key: "thought_process", label: "Your thought process", hint: "What made you pick this approach, and how you got there.", min: 40, max: 1200, rows: 4 },
];

type Draft = Record<PTWriteupPartKey, string>;
const EMPTY: Draft = { approach: "", how_it_works: "", complexity: "", thought_process: "" };

/** After a step's solve passes in time: explain it, Kojo grades it, Kojo walks on a pass. */
export function TrailWriteup({
  stepId,
  title,
  code,
  onDone,
}: {
  stepId: number;
  title: string;
  code: string;
  /** The settled step (passed or out of tries). */
  onDone: (result: PTStepResult) => void;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [grade, setGrade] = useState<PTWriteupGrade | null>(null);
  const [triesLeft, setTriesLeft] = useState(2);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => heading.current?.focus(), []);

  const short = PARTS.filter((p) => draft[p.key].trim().length < p.min);
  const ready = short.length === 0 && !busy;

  const send = async () => {
    if (!ready) return;
    setBusy(true);
    try {
      const res = await postTrailWriteup(stepId, {
        code,
        approach: draft.approach.trim(),
        how_it_works: draft.how_it_works.trim(),
        complexity: draft.complexity.trim(),
        thought_process: draft.thought_process.trim(),
      });
      setGrade(res.grade);
      setTriesLeft(res.tries_left);
      if (!res.result.needs_writeup) {
        onDone(res.result);
        return;
      }
      toast.info("Kojo wants a bit more", "Fix the parts marked below and send it again. One try left.");
    } catch (e) {
      toast.error("Kojo could not read that", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="modal-backdrop">
      <div className="modal-card pt-writeup" role="dialog" aria-modal="true" aria-labelledby="pt-writeup-title">
        <div className="pt-writeup-head">
          <p className="pt-writeup-kicker">Tests passed. Now explain it.</p>
          <h2 id="pt-writeup-title" ref={heading} tabIndex={-1}>
            {title}
          </h2>
          <p className="muted small">
            Kojo reads your explanation against your code. Every part needs to hold up for Kojo to walk on.
          </p>
        </div>
        <div className="pt-writeup-body">
          <section className="pt-writeup-code" aria-label="Your code">
            <span className="pt-writeup-label">Your code</span>
            <pre>
              <code>{code}</code>
            </pre>
          </section>
          <div className="pt-writeup-form">
            {PARTS.map((part) => {
              const feedback = grade?.[part.key];
              const len = draft[part.key].trim().length;
              return (
                <div key={part.key} className={`pt-writeup-part${feedback ? (feedback.ok ? " is-ok" : " is-weak") : ""}`}>
                  <TextArea
                    id={`pt-writeup-${part.key}`}
                    label={part.label}
                    rows={part.rows}
                    maxLength={part.max}
                    value={draft[part.key]}
                    disabled={busy}
                    onChange={(e) => setDraft((d) => ({ ...d, [part.key]: e.target.value }))}
                    aria-describedby={`pt-writeup-${part.key}-hint`}
                  />
                  <span id={`pt-writeup-${part.key}-hint`} className="pt-writeup-hint">
                    {len < part.min ? part.hint : `${len} of ${part.max}`}
                  </span>
                  {feedback ? (
                    <p className="pt-writeup-feedback">
                      {feedback.ok ? <CheckCircleIcon size={16} /> : <CrossCircleIcon size={16} />}
                      <span>{feedback.note}</span>
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <div className="pt-writeup-foot">
          {grade?.summary ? <p className="pt-writeup-summary">{grade.summary}</p> : <span />}
          <div className="pt-writeup-actions">
            {busy ? <InlineLoading label="Kojo is reading" /> : null}
            <Button onClick={send} disabled={!ready}>
              {triesLeft < 2 ? "Send it again" : "Send to Kojo"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
