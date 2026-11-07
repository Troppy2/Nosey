import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertIcon, CheckIcon, ChevronRightIcon, TrashIcon } from "../icons";
import type { KojoActionButton, KojoAskQuestion, KojoToolCard as Card } from "../lib/types";
import "../styles/components/kojo-tools.css";

type CardState = "pending" | "running" | "done" | "cancelled" | "error";

// Cards Kojo shows at the end of a tool turn (GH #205): a confirm card for a
// change it prepared, or a question card when it needs the student to choose.
export function KojoToolCard({
  card,
  state = "pending",
  error,
  disabled,
  onConfirm,
  onCancel,
  onAnswer,
}: {
  card: Card;
  state?: CardState;
  error?: string;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onAnswer: (text: string) => void;
}) {
  if (card.kind === "question") {
    return (
      <KojoQuestionCard
        questions={card.questions}
        answered={state === "done" || state === "cancelled"}
        disabled={disabled}
        onSubmit={onAnswer}
        onSkip={onCancel}
      />
    );
  }
  const settled = state === "done" || state === "cancelled";
  return (
    <div className={`kojo-confirm-card${card.danger ? " kojo-confirm-card--danger" : ""}`} role="group" aria-label={card.title}>
      <div className="kojo-confirm-title">
        {card.danger && <TrashIcon size={14} aria-hidden="true" />}
        <span>{card.title}</span>
      </div>
      {card.lines.length > 0 && (
        <ul className="kojo-confirm-lines">
          {card.lines.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {error && (
        <p className="kojo-confirm-error" role="alert">
          <AlertIcon size={12} aria-hidden="true" /> {error}
        </p>
      )}
      {settled ? (
        <p className="kojo-confirm-settled">
          {state === "done" ? (
            <>
              <CheckIcon size={12} aria-hidden="true" /> Done
            </>
          ) : (
            "Cancelled"
          )}
        </p>
      ) : (
        <div className="kojo-confirm-actions">
          <button type="button" className="kojo-confirm-btn kojo-confirm-btn--ghost" onClick={onCancel} disabled={state === "running"}>
            Cancel
          </button>
          <button
            type="button"
            className={`kojo-confirm-btn${card.danger ? " kojo-confirm-btn--danger" : ""}`}
            onClick={onConfirm}
            disabled={state === "running" || disabled}
          >
            {state === "running" ? "Working..." : card.danger ? "Delete" : "Confirm"}
          </button>
        </div>
      )}
    </div>
  );
}

type Answer = { picked: string[]; other: string };

function KojoQuestionCard({
  questions,
  answered,
  disabled,
  onSubmit,
  onSkip,
}: {
  questions: KojoAskQuestion[];
  answered: boolean;
  disabled?: boolean;
  onSubmit: (text: string) => void;
  onSkip: () => void;
}) {
  const [tab, setTab] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>(() => questions.map(() => ({ picked: [], other: "" })));
  const isDone = (a: Answer) => a.picked.length > 0 || a.other.trim().length > 0;
  const allDone = answers.every(isDone);
  const q = questions[tab];
  const a = answers[tab];

  function update(next: Partial<Answer>) {
    setAnswers((prev) => prev.map((x, i) => (i === tab ? { ...x, ...next } : x)));
  }

  function pick(label: string) {
    if (q.multi_select) {
      update({ picked: a.picked.includes(label) ? a.picked.filter((p) => p !== label) : [...a.picked, label] });
    } else {
      update({ picked: [label], other: "" });
      if (tab < questions.length - 1) window.setTimeout(() => setTab((t) => Math.min(t + 1, questions.length - 1)), 120);
    }
  }

  function submit() {
    const text = questions
      .map((question, i) => {
        const ans = answers[i];
        const parts = [...ans.picked, ...(ans.other.trim() ? [ans.other.trim()] : [])];
        return questions.length === 1 ? parts.join(", ") : `${question.question} ${parts.join(", ")}`;
      })
      .join("\n");
    onSubmit(text);
  }

  if (answered) {
    return <div className="kojo-ask-card kojo-ask-card--answered">Answered</div>;
  }

  return (
    <div className="kojo-ask-card" role="group" aria-label="Kojo's questions">
      {questions.length > 1 && (
        <div className="kojo-ask-tabs" role="tablist">
          {questions.map((question, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === tab}
              className={`kojo-ask-tab${i === tab ? " kojo-ask-tab--active" : ""}${isDone(answers[i]) ? " kojo-ask-tab--done" : ""}`}
              onClick={() => setTab(i)}
            >
              {isDone(answers[i]) && <CheckIcon size={11} aria-hidden="true" />}
              {question.header || `Q${i + 1}`}
            </button>
          ))}
        </div>
      )}
      <p className="kojo-ask-question">{q.question}</p>
      {q.multi_select && <p className="kojo-ask-hint">Pick any that apply</p>}
      <div className="kojo-ask-options" role={q.multi_select ? "group" : "radiogroup"}>
        {q.options.map((opt) => {
          const on = a.picked.includes(opt.label);
          return (
            <button
              key={opt.label}
              type="button"
              role={q.multi_select ? "checkbox" : "radio"}
              aria-checked={on}
              className={`kojo-ask-option${on ? " kojo-ask-option--on" : ""}`}
              onClick={() => pick(opt.label)}
            >
              <span className={`kojo-ask-mark${q.multi_select ? " kojo-ask-mark--box" : ""}`} aria-hidden="true">
                {on && <CheckIcon size={10} />}
              </span>
              <span className="kojo-ask-option-text">
                <span className="kojo-ask-option-label">{opt.label}</span>
                {opt.description && <span className="kojo-ask-option-desc">{opt.description}</span>}
              </span>
            </button>
          );
        })}
        <input
          className="kojo-ask-other"
          type="text"
          placeholder="Other..."
          value={a.other}
          maxLength={300}
          onChange={(e) => update({ other: e.target.value, picked: q.multi_select ? a.picked : [] })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && allDone && !disabled) submit();
          }}
          aria-label="Other answer"
        />
      </div>
      <div className="kojo-ask-footer">
        <button type="button" className="kojo-confirm-btn kojo-confirm-btn--ghost" onClick={onSkip}>
          Skip
        </button>
        {tab < questions.length - 1 ? (
          <button type="button" className="kojo-confirm-btn" onClick={() => setTab(tab + 1)} disabled={!isDone(a)}>
            Next <ChevronRightIcon size={12} aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="kojo-confirm-btn" onClick={submit} disabled={!allDone || disabled}>
            Submit
          </button>
        )}
      </div>
    </div>
  );
}

export function KojoActionButtons({ buttons }: { buttons: KojoActionButton[] }) {
  if (buttons.length === 0) return null;
  return (
    <div className="kojo-action-buttons">
      {buttons.map((b) => (
        <Link key={b.to + b.label} to={b.to} className="kojo-action-link">
          {b.label}
          <ChevronRightIcon size={12} aria-hidden="true" />
        </Link>
      ))}
    </div>
  );
}
