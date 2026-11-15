import { useMemo, useState } from "react";
import { appealRemake, remakeAnswer, revealAnswer, scopeKey } from "../lib/api";
import { toast } from "../lib/toast";
import type { AnswerResult, RemakeResponse } from "../lib/types";
import { Button } from "./Button";
import { ConfirmModal } from "./ConfirmModal";
import { MarkdownContent } from "./MarkdownContent";
import { ProgressBar, useStagedProgress, type ProgressStage } from "./Progress";
import {
  emptyScratchPad,
  exportScratchPadPng,
  isScratchPadEmpty,
  ScratchPadTrigger,
  type PaperStyle,
  type ScratchPadData,
} from "./ScratchPad";
import "../styles/components/remake.css";

type Props = {
  answer: AnswerResult;
  attemptId: number;
  onUpdated: (response: RemakeResponse) => void;
};

function isObjective(answer: AnswerResult): boolean {
  return Boolean(answer.options?.length) && ["MCQ", "TF", "MS", "RANK"].includes(answer.question_type ?? "");
}

// The first pick, as the option text, so it can be shown greyed out.
function firstPick(answer: AnswerResult): string {
  const raw = answer.user_answer.trim();
  const options = answer.options ?? [];
  if (raw.length === 1 && /[a-z]/i.test(raw)) {
    const index = raw.toLowerCase().charCodeAt(0) - 97;
    if (options[index]) return options[index];
  }
  return raw;
}

function parseList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Step 1 for multiple choice, true/false, multiple select and ranking. */
function PickAgain({ answer, value, onChange }: { answer: AnswerResult; value: string; onChange: (v: string) => void }) {
  const options = answer.options ?? [];
  const type = answer.question_type;
  const first = firstPick(answer).toLowerCase();

  if (type === "RANK") {
    const order = parseList(value).length ? parseList(value) : options;
    const move = (index: number, delta: number) => {
      const next = [...order];
      const target = index + delta;
      if (target < 0 || target >= next.length) return;
      [next[index], next[target]] = [next[target], next[index]];
      onChange(JSON.stringify(next));
    };
    return (
      <ol className="rm-rank">
        {order.map((option, index) => (
          <li key={option}>
            <MarkdownContent content={option} />
            <span className="rm-rank-moves">
              <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>Up</button>
              <button type="button" aria-label="Move down" disabled={index === order.length - 1} onClick={() => move(index, 1)}>Down</button>
            </span>
          </li>
        ))}
      </ol>
    );
  }

  const multi = type === "MS";
  const selected = multi ? parseList(value) : [value];
  const firstPicks = multi ? parseList(answer.user_answer).map((v) => v.toLowerCase()) : [first];
  const toggle = (option: string) => {
    if (!multi) return onChange(option);
    const next = selected.includes(option) ? selected.filter((v) => v !== option) : [...selected, option];
    onChange(JSON.stringify(next));
  };

  return (
    <div className="rm-options" role={multi ? "group" : "radiogroup"} aria-label="Pick again">
      {options.map((option) => {
        const isSelected = selected.includes(option);
        const wasFirst = firstPicks.includes(option.toLowerCase());
        return (
          <button
            type="button"
            key={option}
            role={multi ? "checkbox" : "radio"}
            aria-checked={isSelected}
            className={`rm-option${isSelected ? " rm-option--selected" : ""}${wasFirst ? " rm-option--first" : ""}`}
            onClick={() => toggle(option)}
          >
            <span className={multi ? "rm-check" : "rm-dot"} aria-hidden="true" />
            <span className="rm-option-text">
              <MarkdownContent content={option} />
            </span>
            {wasFirst ? <span className="rm-option-tag">your first pick</span> : null}
          </button>
        );
      })}
    </div>
  );
}

const REMAKE_STAGES: ProgressStage[] = [
  { label: "Reading your remake", seconds: 2 },
  { label: "Kojo is checking your answer and reflection", seconds: 9 },
];

/** Quiz remakes on Results (spec-quiz-remakes.md, layout B): one remake per
 * wrong answer for half credit, "Show answer" to give it up, and one appeal
 * after a remake that got no credit. */
export function RemakePanel({ answer, attemptId, onUpdated }: Props) {
  const objective = isObjective(answer);
  const canDraw = Boolean(answer.work_transcript) && !objective;
  const [open, setOpen] = useState(false);
  const [confirmReveal, setConfirmReveal] = useState(false);
  const [newAnswer, setNewAnswer] = useState("");
  const [strokes, setStrokes] = useState<ScratchPadData>(emptyScratchPad);
  const [paperStyle, setPaperStyle] = useState<PaperStyle>(() => {
    try {
      return (localStorage.getItem(scopeKey("nosey_scratchpad_paper")) as PaperStyle | null) ?? "blank";
    } catch {
      return "blank";
    }
  });
  const [wrong, setWrong] = useState("");
  const [right, setRight] = useState("");
  const [appealing, setAppealing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"remake" | "appeal" | "reveal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const progress = useStagedProgress(REMAKE_STAGES, { running: busy === "remake" || busy === "appeal", done: false });
  const hasDrawing = !isScratchPadEmpty(strokes);
  const questionText = useMemo(
    () =>
      answer.group_stem
        ? `${answer.group_stem}\n\n(${answer.part_label ?? "?"}) ${answer.question_text ?? ""}`
        : answer.question_text ?? "",
    [answer.group_stem, answer.part_label, answer.question_text],
  );
  const hasAnswer = objective
    ? answer.question_type === "MS" || answer.question_type === "RANK"
      ? parseList(newAnswer).length > 0
      : Boolean(newAnswer)
    : Boolean(newAnswer.trim()) || hasDrawing;
  const canSubmit = hasAnswer && Boolean(wrong.trim()) && Boolean(right.trim()) && busy === null;

  function changePaperStyle(style: PaperStyle) {
    setPaperStyle(style);
    try {
      localStorage.setItem(scopeKey("nosey_scratchpad_paper"), style);
    } catch {
      // A per-viewer convenience only.
    }
  }

  function done(response: RemakeResponse, kind: "remake" | "appeal") {
    onUpdated(response);
    const credited = response.answer.remake_status === "credited";
    if (credited) toast.success("Half credit back", kind === "appeal" ? "Kojo looked again and agreed." : undefined);
    else toast.info(kind === "appeal" ? "No credit stands" : "No credit this time");
  }

  async function submitRemake() {
    setBusy("remake");
    setError(null);
    try {
      const workImage = hasDrawing ? exportScratchPadPng(strokes) : null;
      const response = await remakeAnswer(attemptId, Number(answer.question_id), {
        answer: newAnswer.trim(),
        ...(workImage ? { work_image: workImage } : {}),
        what_wrong: wrong.trim(),
        what_right: right.trim(),
      });
      done(response, "remake");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kojo couldn't check your remake. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function submitAppeal() {
    setBusy("appeal");
    setError(null);
    try {
      done(await appealRemake(attemptId, Number(answer.question_id), reason.trim()), "appeal");
      setAppealing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kojo couldn't look again right now. Try again.");
    } finally {
      setBusy(null);
    }
  }

  async function reveal() {
    setBusy("reveal");
    try {
      onUpdated(await revealAnswer(attemptId, Number(answer.question_id)));
      setConfirmReveal(false);
    } catch (err) {
      toast.error("Couldn't show the answer", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  const working = busy === "remake" || busy === "appeal";
  const progressBlock = working ? (
    <ProgressBar
      value={progress.percent}
      label={REMAKE_STAGES[Math.min(progress.activeStage, REMAKE_STAGES.length - 1)].label}
    />
  ) : null;

  // ── Graded remake ──────────────────────────────────────────────────────
  if (answer.remake_status) {
    const credited = answer.remake_status === "credited";
    const feedback = answer.remake_feedback;
    const canAppeal = !credited && !answer.remake_appeal_status;
    return (
      <section className={`rm rm--graded rm--${credited ? "credited" : "none"}`} aria-label="Remake">
        <dl className="rm-list">
          <div className="rm-row rm-row--verdict">
            <dt>Remake</dt>
            <dd>
              {credited ? "Half credit back" : "No credit this time"}
              {answer.remake_appeal_status === "credited" ? " (after Kojo looked again)" : null}
              {answer.remake_appeal_status === "upheld" ? " (Kojo looked again, it stands)" : null}
            </dd>
          </div>
          {feedback?.note ? (
            <div className="rm-row">
              <dt>Note</dt>
              <dd><MarkdownContent content={feedback.note} /></dd>
            </div>
          ) : null}
          {feedback?.what_to_fix ? (
            <div className="rm-row rm-row--fix">
              <dt>Still off</dt>
              <dd><MarkdownContent content={feedback.what_to_fix} /></dd>
            </div>
          ) : null}
        </dl>
        {canAppeal && !appealing ? (
          <Button variant="secondary" onClick={() => setAppealing(true)}>Ask Kojo to look again</Button>
        ) : null}
        {canAppeal && appealing ? (
          <div className="rm-form">
            <label className="rm-field">
              <span>Why should Kojo look again?</span>
              <textarea
                className="input textarea"
                value={reason}
                maxLength={2000}
                rows={3}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Point at the line or idea Kojo missed"
              />
            </label>
            {progressBlock}
            {error ? <p className="rm-error">{error}</p> : null}
            <div className="rm-actions">
              <Button onClick={() => void submitAppeal()} disabled={!reason.trim() || busy !== null}>
                Ask Kojo to look again
              </Button>
              <Button variant="ghost" onClick={() => setAppealing(false)} disabled={busy !== null}>Cancel</Button>
            </div>
            <p className="rm-hint">One appeal. Kojo's second answer is final.</p>
          </div>
        ) : null}
      </section>
    );
  }

  if (!answer.remake_available) return null;

  // ── Open remake ────────────────────────────────────────────────────────
  if (!open) {
    return (
      <section className="rm rm--offer" aria-label="Remake">
        <div className="rm-actions">
          <Button onClick={() => setOpen(true)}>Remake for half credit</Button>
          <Button variant="ghost" onClick={() => setConfirmReveal(true)}>Show answer</Button>
        </div>
        {confirmReveal ? (
          <ConfirmModal
            title="Show the answer?"
            message="You won't be able to remake this question for half credit."
            confirmLabel="Show answer"
            busy={busy === "reveal"}
            busyLabel="Showing"
            onConfirm={() => void reveal()}
            onCancel={() => setConfirmReveal(false)}
          />
        ) : null}
      </section>
    );
  }

  return (
    <section className="rm rm--form" aria-label="Remake for half credit">
      <p className="rm-title">Remake for half credit</p>
      <ol className="rm-steps">
        <li>
          <span className="rm-step-label">{objective ? "Pick again" : "Redo the work"}</span>
          {objective ? (
            <PickAgain answer={answer} value={newAnswer} onChange={setNewAnswer} />
          ) : (
            <>
              <textarea
                className="input textarea"
                value={newAnswer}
                maxLength={5000}
                rows={4}
                onChange={(e) => setNewAnswer(e.target.value)}
                placeholder="Work it through and end with your answer"
                aria-label="Redo the work"
              />
              {canDraw ? (
                <ScratchPadTrigger
                  questionText={questionText}
                  data={strokes}
                  onChange={setStrokes}
                  paperStyle={paperStyle}
                  onPaperStyleChange={changePaperStyle}
                />
              ) : null}
            </>
          )}
        </li>
        <li>
          <span className="rm-step-label">What I got wrong</span>
          <textarea
            className="input textarea"
            value={wrong}
            maxLength={2000}
            rows={3}
            onChange={(e) => setWrong(e.target.value)}
            placeholder="Name the exact mistake: the idea, step or number"
            aria-label="What I got wrong"
          />
        </li>
        <li>
          <span className="rm-step-label">What I got right</span>
          <textarea
            className="input textarea"
            value={right}
            maxLength={2000}
            rows={2}
            onChange={(e) => setRight(e.target.value)}
            aria-label="What I got right"
          />
        </li>
      </ol>
      {progressBlock}
      {error ? <p className="rm-error">{error}</p> : null}
      <div className="rm-actions">
        <Button onClick={() => void submitRemake()} disabled={!canSubmit}>Submit remake</Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy !== null}>Cancel</Button>
      </div>
      <p className="rm-hint">One try. A right answer and a reflection that names the mistake earn half a point.</p>
    </section>
  );
}
