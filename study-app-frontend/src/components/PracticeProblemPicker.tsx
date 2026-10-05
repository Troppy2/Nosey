import { Check, ChevronLeft, Pencil, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "./Button";
import { InlineLoading } from "./Loaders";
import { MarkdownContent } from "./MarkdownContent";
import {
  fixPracticeProblem,
  parsePracticeProblems,
  type DraftQuestion,
  type PracticeProblem,
} from "../lib/api";

// Choose which problems of a practice test go on the test, then check how
// Nosey read each one (GH #138). Only the picked problems are sent to the AI.

export type ReviewStatus = "pending" | "approved" | "error";

export interface ReviewedProblem {
  index: number;
  sourceText: string;
  questions: DraftQuestion[];
  status: ReviewStatus;
  error: string | null;
}

export interface PickerResult {
  chosen: number[];
  // Keyed by problem index. Empty in "Match its style" mode, which has no review.
  reviews: Record<number, ReviewedProblem>;
}

type Props = {
  folderId: number;
  fileId: number;
  problems: PracticeProblem[];
  // recreate: pick, then review. style: pick only.
  mode: "recreate" | "style";
  initial: PickerResult;
  onClose: () => void;
  onDone: (result: PickerResult) => void;
};

const QUICK_PICK = 5;
const LETTERS = "ABCDEF";

function questionMarkdown(q: DraftQuestion): string {
  if (q.kind === "mcq") {
    const options = (q.options ?? [])
      .map((o, i) => `${LETTERS[i]}. ${o}${i === q.correct_index ? " **(answer)**" : ""}`)
      .join("\n\n");
    return `${q.question_text}\n\n${options}`;
  }
  return `${q.question_text}\n\n**Answer:** ${q.expected_answer ?? ""}`;
}

function problemName(p: PracticeProblem): string {
  return p.title ? `${p.label} ${p.title}` : p.label;
}

export function PracticeProblemPicker({ folderId, fileId, problems, mode, initial, onClose, onDone }: Props) {
  const [step, setStep] = useState<"pick" | "review">("pick");
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(initial.chosen));
  const [query, setQuery] = useState("");
  const [reviews, setReviews] = useState<Record<number, ReviewedProblem>>(initial.reviews);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  // The problem whose Fix it box is open, its draft message, and whether it is sending.
  const [fixing, setFixing] = useState<number | null>(null);
  const [fixMessage, setFixMessage] = useState("");
  const [fixBusy, setFixBusy] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !reading && !fixBusy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, reading, fixBusy]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return problems;
    return problems.filter((p) => `${p.label} ${p.title} ${p.preview}`.toLowerCase().includes(q));
  }, [problems, query]);

  // Problems grouped by chapter, in document order.
  const groups = useMemo(() => {
    const out: { chapter: string; items: PracticeProblem[] }[] = [];
    for (const p of visible) {
      const chapter = p.chapter ?? "Problems";
      const last = out[out.length - 1];
      if (last && last.chapter === chapter) last.items.push(p);
      else out.push({ chapter, items: [p] });
    }
    return out;
  }, [visible]);

  function toggle(index: number) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function setMany(items: PracticeProblem[], on: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      for (const p of items) {
        if (on) next.add(p.index);
        else next.delete(p.index);
      }
      return next;
    });
  }

  function pickRandom() {
    const pool = [...visible];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    setChosen(new Set(pool.slice(0, QUICK_PICK).map((p) => p.index)));
  }

  const chosenList = problems.filter((p) => chosen.has(p.index));

  async function goToReview() {
    if (mode === "style") {
      onDone({ chosen: chosenList.map((p) => p.index), reviews: {} });
      return;
    }
    setStep("review");
    // Problems already read stay as they are; only new picks go to the AI.
    const toRead = chosenList.filter((p) => !reviews[p.index] || reviews[p.index].status === "error");
    if (toRead.length === 0) return;
    setReading(true);
    setReadError(null);
    try {
      const parsed = await parsePracticeProblems(folderId, fileId, toRead);
      setReviews((current) => {
        const next = { ...current };
        for (const item of parsed) {
          next[item.index] = {
            index: item.index,
            sourceText: item.source_text,
            questions: item.questions,
            status: item.error ? "error" : "pending",
            error: item.error,
          };
        }
        return next;
      });
    } catch (err) {
      setReadError(err instanceof Error ? err.message : "Nosey couldn't read those problems.");
    } finally {
      setReading(false);
    }
  }

  function setStatus(index: number, status: ReviewStatus) {
    setReviews((current) => ({ ...current, [index]: { ...current[index], status } }));
  }

  function openFix(index: number) {
    setFixing(index);
    setFixMessage("");
    setFixError(null);
  }

  async function sendFix(problem: PracticeProblem) {
    const message = fixMessage.trim();
    if (!message) return;
    setFixBusy(true);
    setFixError(null);
    try {
      const current = reviews[problem.index]?.questions ?? [];
      const questions = await fixPracticeProblem(folderId, fileId, problem, current, message);
      // A fix comes back for another look: the student confirms it with Looks right.
      setReviews((all) => ({
        ...all,
        [problem.index]: { ...all[problem.index], questions, status: "pending", error: null },
      }));
      setFixing(null);
      setFixMessage("");
    } catch (err) {
      setFixError(err instanceof Error ? err.message : "Nosey couldn't redo that problem.");
    } finally {
      setFixBusy(false);
    }
  }

  function acceptRest() {
    setReviews((current) => {
      const next = { ...current };
      for (const p of chosenList) {
        const r = next[p.index];
        if (r && r.status === "pending" && r.questions.length > 0) next[p.index] = { ...r, status: "approved" };
      }
      return next;
    });
  }

  const reviewed = chosenList.map((p) => reviews[p.index]).filter(Boolean);
  const approvedCount = reviewed.filter((r) => r.status === "approved").length;
  const pendingCount = reviewed.filter((r) => r.status === "pending").length;

  function finish() {
    const kept: Record<number, ReviewedProblem> = {};
    for (const p of chosenList) if (reviews[p.index]) kept[p.index] = reviews[p.index];
    onDone({ chosen: chosenList.map((p) => p.index), reviews: kept });
  }

  const busy = reading || fixBusy;

  return (
    <div className="modal-backdrop" onMouseDown={busy ? undefined : onClose}>
      <div
        className="modal-card pp-modal"
        role="dialog"
        aria-modal="true"
        aria-label={step === "pick" ? "Choose problems" : "Check problems"}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="pp-header">
          <div>
            <h2>{step === "pick" ? "Choose problems" : "Check how Nosey read them"}</h2>
            <p className="muted small">
              {step === "pick"
                ? `${problems.length} problems found. Only the ones you pick are read.`
                : "Mark each one Looks right, or Fix it: tell Nosey what's wrong or paste the problem."}
            </p>
          </div>
          <button type="button" className="pp-close" aria-label="Close" onClick={onClose} disabled={busy}>
            <X size={18} />
          </button>
        </header>

        {step === "pick" ? (
          <>
            <div className="pp-toolbar">
              <label className="pp-search">
                <Search size={14} />
                <input
                  type="search"
                  placeholder="Search problems"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search problems"
                />
              </label>
              <div className="pp-quick" role="group" aria-label="Quick pick">
                <button type="button" onClick={() => setMany(visible, true)}>All</button>
                <button type="button" onClick={() => setMany(visible, false)}>None</button>
                <button type="button" onClick={pickRandom}>Random {QUICK_PICK}</button>
              </div>
            </div>
            <div className="pp-body">
              {groups.length === 0 ? <p className="muted small">No problems match that search.</p> : null}
              {groups.map((group) => {
                const allOn = group.items.every((p) => chosen.has(p.index));
                return (
                  <section key={group.chapter} className="pp-group">
                    <div className="pp-group-head">
                      <span className="eyebrow">{group.chapter}</span>
                      <button type="button" onClick={() => setMany(group.items, !allOn)}>
                        {allOn ? "None" : "All"}
                      </button>
                    </div>
                    {group.items.map((p) => (
                      <label key={p.index} className={`pp-row ${chosen.has(p.index) ? "is-on" : ""}`}>
                        <input type="checkbox" checked={chosen.has(p.index)} onChange={() => toggle(p.index)} />
                        <span className="pp-row-main">
                          <span className="pp-row-title">
                            <strong>{p.label}</strong> {p.title}
                            {p.part_count > 1 ? <span className="muted small"> · {p.part_count} parts</span> : null}
                          </span>
                          <span className="pp-row-preview">{p.preview}</span>
                        </span>
                      </label>
                    ))}
                  </section>
                );
              })}
            </div>
            <footer className="pp-footer">
              <span className="muted small">{chosen.size} picked</span>
              <div className="button-row">
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button onClick={() => void goToReview()} disabled={chosen.size === 0}>
                  {mode === "style" ? `Use ${chosen.size} problem${chosen.size === 1 ? "" : "s"}` : "Next: check them"}
                </Button>
              </div>
            </footer>
          </>
        ) : (
          <>
            <div className="pp-body">
              {reading ? (
                <p className="practice-status">
                  <InlineLoading label={`Reading and solving ${chosenList.length} problem${chosenList.length === 1 ? "" : "s"}`} />
                </p>
              ) : null}
              {readError ? <p className="practice-status practice-status--error">{readError}</p> : null}
              {chosenList.map((p) => {
                const r = reviews[p.index];
                if (!r) return null;
                const done = r.status === "approved";
                return (
                  <article key={p.index} className={`pp-review ${done ? "is-done" : ""} ${r.status === "error" ? "is-error" : ""}`}>
                    <div className="pp-review-head">
                      <strong>{problemName(p)}</strong>
                      <span className={`pill pp-status pp-status--${r.status}`}>
                        {r.status === "approved" ? "Looks right" : r.status === "error" ? "Not read" : "To check"}
                      </span>
                    </div>
                    {r.error ? <p className="practice-status practice-status--error">{r.error}</p> : null}
                    {/* A multi-part problem's setup, shown once above its parts (GH #151). */}
                    {r.questions.find((q) => q.part_label && q.group_stem)?.group_stem ? (
                      <div className="pp-setup">
                        <span className="muted small">Setup</span>
                        <MarkdownContent content={r.questions.find((q) => q.part_label && q.group_stem)?.group_stem ?? ""} />
                      </div>
                    ) : null}
                    {r.questions.map((q, i) => (
                      <div key={i} className="pp-question">
                        <span className="muted small">
                          {q.part_label ? `Part (${q.part_label}) · ` : r.questions.length > 1 ? `Question ${i + 1} · ` : ""}
                          {q.kind === "mcq" ? "Multiple choice" : "Written"}
                          {q.answer_inferred ? " · Answer worked out by Nosey" : ""}
                        </span>
                        <MarkdownContent content={questionMarkdown(q)} />
                      </div>
                    ))}
                    <details className="pp-source">
                      <summary>Original text</summary>
                      <pre>{r.sourceText}</pre>
                    </details>
                    {fixing === p.index ? (
                      <div className="pp-fix">
                        <textarea
                          rows={4}
                          value={fixMessage}
                          onChange={(e) => setFixMessage(e.target.value)}
                          placeholder={'What\'s wrong? e.g. "part (a) is the column vector (1, 2, 1)". Or paste the whole problem.'}
                          aria-label={`Fix ${problemName(p)}`}
                          disabled={fixBusy}
                          autoFocus
                        />
                        {fixError ? <p className="practice-status practice-status--error">{fixError}</p> : null}
                        <div className="button-row">
                          <Button variant="secondary" onClick={() => setFixing(null)} disabled={fixBusy}>Cancel</Button>
                          <Button onClick={() => void sendFix(p)} disabled={fixBusy || !fixMessage.trim()}>
                            {fixBusy ? <InlineLoading label="Redoing" /> : "Redo this problem"}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="pp-review-actions">
                        <button
                          type="button"
                          className={`pp-action ${done ? "is-on" : ""}`}
                          onClick={() => setStatus(p.index, done ? "pending" : "approved")}
                          disabled={r.questions.length === 0 || busy}
                          aria-pressed={done}
                        >
                          <Check size={14} /> Looks right
                        </button>
                        <button type="button" className="pp-action" onClick={() => openFix(p.index)} disabled={busy}>
                          <Pencil size={14} /> Fix it
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
            <footer className="pp-footer">
              <button type="button" className="pp-back" onClick={() => setStep("pick")} disabled={busy}>
                <ChevronLeft size={14} /> Change picks
              </button>
              <div className="button-row">
                {pendingCount > 0 ? (
                  <Button variant="secondary" onClick={acceptRest} disabled={busy}>
                    Accept the rest ({pendingCount})
                  </Button>
                ) : null}
                <Button onClick={finish} disabled={busy || approvedCount === 0}>
                  Use {approvedCount} problem{approvedCount === 1 ? "" : "s"}
                </Button>
              </div>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
