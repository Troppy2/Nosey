import { ArrowLeft, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { FormError } from "../components/FormError";
import { Card } from "../components/Card";
import { ConfirmModal } from "../components/ConfirmModal";
import { LoadingNotice } from "../components/Loaders";
import { SkeletonList } from "../components/Skeletons";
import {
  addQuestion,
  deleteQuestion,
  fetchQuestionsForEditing,
  fetchTest,
  fetchPrettierProposals,
  updateQuestion,
  updateQuestionGroup,
  type PrettierProposal,
} from "../lib/api";
import { MarkdownContent } from "../components/MarkdownContent";
import { useSettings } from "../lib/useSettings";
import type { MCQOptionInput, QuestionCreate, QuestionEditable, QuestionGroup, TestTake } from "../lib/types";

// Matches TakeTest's poll while a test generates in the background.
const GENERATION_POLL_MS = 1800;

const TYPE_LABELS: Record<string, string> = {
  MCQ: "Multiple choice",
  FRQ: "Written",
  TF: "True / False",
  MS: "Multiple select",
  RANK: "Ranking",
};

type DraftOption = { text: string; is_correct: boolean };

function blankOptions(): DraftOption[] {
  return [
    { text: "", is_correct: true },
    { text: "", is_correct: false },
    { text: "", is_correct: false },
    { text: "", is_correct: false },
  ];
}

function MCQCard({
  question,
  testId,
  onSaved,
  onDeleted,
}: {
  question: QuestionEditable;
  testId: number;
  onSaved: (q: QuestionEditable) => void;
  onDeleted: (id: number) => void;
}) {
  const [text, setText] = useState(question.question_text);
  const [options, setOptions] = useState<DraftOption[]>(
    question.options.map((o) => ({ text: o.text, is_correct: o.is_correct }))
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setOptionText(i: number, value: string) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, text: value } : o)));
  }

  function setCorrect(i: number) {
    setOptions((prev) => prev.map((o, idx) => ({ ...o, is_correct: idx === i })));
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const saved = await updateQuestion(testId, question.id, {
        question_text: text.trim(),
        options: options as MCQOptionInput[],
      });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteQuestion(testId, question.id);
      onDeleted(question.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setDeleting(false);
    }
  }

  return (
    <Card className="form-panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {confirmDelete ? (
        <ConfirmModal
          title="Delete Question"
          message="Delete this question? This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => { setConfirmDelete(false); void handleDelete(); }}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="eyebrow">
          {question.part_label ? `Part (${question.part_label}) · ` : ""}Multiple choice
        </span>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          disabled={deleting}
          style={{
            background: "none",
            cursor: "pointer",
            color: "var(--error)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: "0.8rem",
            fontWeight: 600,
            opacity: deleting ? 0.5 : 1,
          }}
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>

      <FormError message={error} style={{ margin: 0 }} />

      <div className="field">
        <label className="field-label">Question</label>
        <textarea
          className="input textarea"
          style={{ minHeight: 80 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className="field-label">Options: select the correct answer</span>
        {options.map((opt, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              type="radio"
              name={`correct-${question.id}`}
              checked={opt.is_correct}
              onChange={() => setCorrect(i)}
              style={{ accentColor: "var(--green-dark)", flexShrink: 0, width: 16, height: 16 }}
            />
            <input
              className="input"
              style={{ minHeight: 40, padding: "8px 12px" }}
              value={opt.text}
              onChange={(e) => setOptionText(i, e.target.value)}
              placeholder={`Option ${i + 1}`}
            />
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button onClick={handleSave} disabled={saving || !text.trim()}>
          <Save size={14} />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Card>
  );
}

// Written questions, and the text of the beta types (True / False, Multiple
// select, Ranking), whose answers this editor cannot change yet.
function FRQCard({
  question,
  testId,
  onSaved,
  onDeleted,
}: {
  question: QuestionEditable;
  testId: number;
  onSaved: (q: QuestionEditable) => void;
  onDeleted: (id: number) => void;
}) {
  const isWritten = question.type === "FRQ";
  const [text, setText] = useState(question.question_text);
  const [answer, setAnswer] = useState(question.expected_answer ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const saved = await updateQuestion(testId, question.id, {
        question_text: text.trim(),
        ...(isWritten ? { expected_answer: answer.trim() } : {}),
      });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteQuestion(testId, question.id);
      onDeleted(question.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setDeleting(false);
    }
  }

  return (
    <Card className="form-panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {confirmDelete ? (
        <ConfirmModal
          title="Delete Question"
          message="Delete this question? This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={() => { setConfirmDelete(false); void handleDelete(); }}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="eyebrow">
          {question.part_label ? `Part (${question.part_label}) · ` : ""}
          {TYPE_LABELS[question.type] ?? "Written"}
        </span>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          disabled={deleting}
          style={{
            background: "none",
            cursor: "pointer",
            color: "var(--error)",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: "0.8rem",
            fontWeight: 600,
            opacity: deleting ? 0.5 : 1,
          }}
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>

      <FormError message={error} style={{ margin: 0 }} />

      <div className="field">
        <label className="field-label">Question</label>
        <textarea
          className="input textarea"
          style={{ minHeight: 80 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      {isWritten ? (
        <div className="field">
          <label className="field-label">Expected answer (used for grading)</label>
          <textarea
            className="input textarea"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
        </div>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>
          Only the question text can be edited for this question type.
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button onClick={handleSave} disabled={saving || !text.trim()}>
          <Save size={14} />
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Card>
  );
}

function AddQuestionPanel({
  testId,
  onAdded,
}: {
  testId: number;
  onAdded: (q: QuestionEditable) => void;
}) {
  const [type, setType] = useState<"MCQ" | "FRQ">("MCQ");
  const [text, setText] = useState("");
  const [options, setOptions] = useState<DraftOption[]>(blankOptions());
  const [answer, setAnswer] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setOptionText(i: number, value: string) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, text: value } : o)));
  }

  function setCorrect(i: number) {
    setOptions((prev) => prev.map((o, idx) => ({ ...o, is_correct: idx === i })));
  }

  async function handleAdd() {
    setError(null);
    setAdding(true);
    try {
      const payload: QuestionCreate =
        type === "MCQ"
          ? { type: "MCQ", question_text: text.trim(), options: options as MCQOptionInput[] }
          : { type: "FRQ", question_text: text.trim(), options: [], expected_answer: answer.trim() };
      const created = await addQuestion(testId, payload);
      onAdded(created);
      setText("");
      setOptions(blankOptions());
      setAnswer("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add question");
    } finally {
      setAdding(false);
    }
  }

  const canAdd = text.trim() && (type === "FRQ" ? answer.trim() : options.every((o) => o.text.trim()));

  return (
    <Card className="form-panel" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <span className="eyebrow">Add question</span>

      <FormError message={error} style={{ margin: 0 }} />

      <div className="choice-grid">
        {(["MCQ", "FRQ"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`choice ${type === t ? "active" : ""}`}
            onClick={() => setType(t)}
          >
            {t === "MCQ" ? "Multiple choice" : "Written"}
          </button>
        ))}
      </div>

      <div className="field">
        <label className="field-label">Question</label>
        <textarea
          className="input textarea"
          style={{ minHeight: 72 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter question text…"
        />
      </div>

      {type === "MCQ" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="field-label">Options: select the correct answer</span>
          {options.map((opt, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="radio"
                name="new-correct"
                checked={opt.is_correct}
                onChange={() => setCorrect(i)}
                style={{ accentColor: "var(--green-dark)", flexShrink: 0, width: 16, height: 16 }}
              />
              <input
                className="input"
                style={{ minHeight: 40, padding: "8px 12px" }}
                value={opt.text}
                onChange={(e) => setOptionText(i, e.target.value)}
                placeholder={`Option ${i + 1}`}
              />
            </div>
          ))}
        </div>
      ) : (
        <div className="field">
          <label className="field-label">Expected answer</label>
          <textarea
            className="input textarea"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Write the expected or model answer…"
          />
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button onClick={handleAdd} disabled={adding || !canAdd}>
          <Plus size={14} />
          {adding ? "Adding…" : "Add question"}
        </Button>
      </div>
    </Card>
  );
}

// Shown while the test is still generating: questions can still be rewritten
// or dropped by MCQ verification until it finishes, so they are not editable yet.
// A multi-part problem's setup (GH #151), shown above its parts and saved
// once for all of them.
function GroupSetupCard({
  group,
  testId,
  onSaved,
}: {
  group: QuestionGroup;
  testId: number;
  onSaved: (group: QuestionGroup) => void;
}) {
  const [stem, setStem] = useState(group.stem);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      onSaved(await updateQuestionGroup(testId, Number(group.id), { stem }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the setup");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="form-panel editor-group-setup">
      <span className="eyebrow">{group.label ? `Problem ${group.label}` : "Problem"} · Setup shared by its parts</span>
      <textarea
        className="field-input"
        rows={4}
        value={stem}
        onChange={(e) => setStem(e.target.value)}
        aria-label={`Setup for problem ${group.label}`}
      />
      <FormError message={error} />
      <div className="button-row">
        <Button
          variant="secondary"
          icon={<Save size={16} />}
          onClick={() => void handleSave()}
          disabled={saving || stem.trim() === group.stem.trim()}
        >
          {saving ? "Saving..." : "Save setup"}
        </Button>
      </div>
    </Card>
  );
}

function QuestionPreview({ question, number }: { question: QuestionEditable; number: number }) {
  return (
    <Card className="form-panel editor-preview">
      <span className="eyebrow">
        {number}. {TYPE_LABELS[question.type] ?? "Question"}
      </span>
      <p className="editor-preview-text">{question.question_text}</p>
      {question.options.length > 0 ? (
        <ol className="editor-preview-options" type="A">
          {question.options.map((option) => (
            <li key={option.id} className={option.is_correct ? "is-correct" : undefined}>
              {option.text}
            </li>
          ))}
        </ol>
      ) : question.expected_answer ? (
        <p className="muted small" style={{ margin: 0 }}>Answer: {question.expected_answer}</p>
      ) : null}
    </Card>
  );
}

// Prettier review (beta): each reformatted question, before and after. The
// student applies or skips each; applied ones save through the normal route.
function PrettierReview({
  testId,
  proposals,
  questions,
  onApplied,
  onDone,
}: {
  testId: number;
  proposals: PrettierProposal[];
  questions: QuestionEditable[];
  onApplied: (updated: QuestionEditable) => void;
  onDone: (questionId: number) => void;
}) {
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const number = (qid: number) => questions.findIndex((q) => q.id === qid) + 1;

  async function apply(p: PrettierProposal) {
    const q = questions.find((x) => x.id === p.question_id);
    if (!q) return;
    const options = p.options && q.type === "MCQ"
      ? p.options.map((text, i) => ({ text, is_correct: q.options[i]?.is_correct ?? false }))
      : undefined;
    onApplied(await updateQuestion(testId, q.id, {
      question_text: p.question_text,
      ...(options ? { options } : {}),
      ...(p.expected_answer != null && q.type !== "MCQ" ? { expected_answer: p.expected_answer } : {}),
    }));
    onDone(p.question_id);
  }

  async function run(target: number | "all", list: PrettierProposal[]) {
    setBusy(target);
    setError(null);
    try {
      for (const p of list) await apply(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that change");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="form-panel prettier-review">
      <div className="prettier-review-head">
        <div>
          <strong>{proposals.length} question{proposals.length === 1 ? "" : "s"} tidied up</strong>
          <p className="muted small">Formatting only, the wording is unchanged. Apply the ones you like.</p>
        </div>
        <div className="button-row">
          <Button variant="secondary" onClick={() => proposals.forEach((p) => onDone(p.question_id))} disabled={busy !== null}>
            Skip all
          </Button>
          <Button onClick={() => void run("all", proposals)} disabled={busy !== null}>
            {busy === "all" ? "Applying..." : "Apply all"}
          </Button>
        </div>
      </div>
      <FormError message={error} />
      {proposals.map((p) => (
        <article key={p.question_id} className="prettier-item">
          <div className="prettier-item-head">
            <span className="eyebrow">Question {number(p.question_id)}</span>
            <div className="button-row">
              <Button variant="secondary" onClick={() => onDone(p.question_id)} disabled={busy !== null}>Skip</Button>
              <Button onClick={() => void run(p.question_id, [p])} disabled={busy !== null}>
                {busy === p.question_id ? "Applying..." : "Apply"}
              </Button>
            </div>
          </div>
          <div className="prettier-after">
            <MarkdownContent content={p.question_text} />
            {p.options ? (
              <ol type="A">{p.options.map((o, i) => <li key={i}><MarkdownContent content={o} /></li>)}</ol>
            ) : null}
            {p.expected_answer ? (
              <div className="prettier-answer">
                <span className="muted small">Answer</span>
                <MarkdownContent content={p.expected_answer} />
              </div>
            ) : null}
          </div>
        </article>
      ))}
    </Card>
  );
}

export default function QuestionEditor() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const id = Number(testId);

  const [test, setTest] = useState<TestTake | null>(null);
  const [questions, setQuestions] = useState<QuestionEditable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { betaMode } = useSettings();
  const [proposals, setProposals] = useState<PrettierProposal[] | null>(null);
  const [prettying, setPrettying] = useState(false);
  const [prettierNote, setPrettierNote] = useState<string | null>(null);
  // Bumped when Prettier rewrites a question so its card reloads its fields.
  const [revision, setRevision] = useState<Record<number, number>>({});

  const generating = test?.generation_status === "generating";

  async function handlePrettier() {
    setPrettying(true);
    setPrettierNote(null);
    setError(null);
    try {
      const found = await fetchPrettierProposals(id);
      if (found.length === 0) setPrettierNote("Everything already looks good. Nothing to tidy.");
      setProposals(found.length ? found : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prettier couldn't run right now");
    } finally {
      setPrettying(false);
    }
  }

  function handlePrettierApplied(updated: QuestionEditable) {
    handleSaved(updated);
    setRevision((prev) => ({ ...prev, [updated.id]: (prev[updated.id] ?? 0) + 1 }));
  }

  function handlePrettierDone(questionId: number) {
    setProposals((prev) => {
      const rest = (prev ?? []).filter((p) => p.question_id !== questionId);
      return rest.length ? rest : null;
    });
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchTest(id), fetchQuestionsForEditing(id)])
      .then(([meta, editable]) => {
        if (cancelled) return;
        setTest(meta);
        setQuestions(editable);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load questions");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Question editor mode lands here right after Create Test, while the test is
  // still generating: poll until it finishes, then the cards become editable.
  useEffect(() => {
    if (!generating) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const [meta, editable] = await Promise.all([fetchTest(id), fetchQuestionsForEditing(id)]);
        if (cancelled) return;
        setTest(meta);
        setQuestions(editable);
      } catch {
        // Transient failure; keep polling.
      }
    }, GENERATION_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [generating, id]);

  function handleSaved(updated: QuestionEditable) {
    setQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
  }

  function handleDeleted(questionId: number) {
    setQuestions((prev) => prev.filter((q) => q.id !== questionId));
  }

  function handleAdded(q: QuestionEditable) {
    setQuestions((prev) => [...prev, q]);
  }

  function handleGroupSaved(group: QuestionGroup) {
    setQuestions((prev) => prev.map((q) => (q.group?.id === group.id ? { ...q, group } : q)));
  }

  const expected = test?.expected_question_count;
  const backTo = test?.folder_id ? `/folders/${test.folder_id}` : "/dashboard";

  return (
    <div className="page page-narrow">
      <Link className="back-link" to={backTo}>
        <ArrowLeft size={16} />
        {test?.folder_name ?? "Folder"}
      </Link>

      <header className="page-header">
        <div>
          <span className="eyebrow">Advanced mode</span>
          <h1>Question editor</h1>
          <p className="muted">
            Edit, remove, or add questions. Each card saves on its own. When you&apos;re done, take the test.
          </p>
        </div>
        <div className="button-row">
          {betaMode && !generating && questions.length > 0 ? (
            <Button variant="secondary" onClick={() => void handlePrettier()} disabled={prettying || proposals !== null}>
              <Sparkles size={16} />
              {prettying ? "Tidying..." : "Prettier"}
            </Button>
          ) : null}
          <Button onClick={() => navigate(`/test/${id}`)}>Take Test</Button>
        </div>
      </header>

      <FormError message={error} />
      {prettierNote ? <p className="muted small">{prettierNote}</p> : null}
      {proposals ? (
        <PrettierReview
          testId={id}
          proposals={proposals}
          questions={questions}
          onApplied={handlePrettierApplied}
          onDone={handlePrettierDone}
        />
      ) : null}
      {test?.generation_status === "failed" ? (
        <FormError message={`Generation failed: ${test.generation_error ?? "no questions were made."}`} />
      ) : null}

      {loading ? (
        <SkeletonList rows={4} label="Loading questions" />
      ) : generating ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <LoadingNotice
            compact
            title="Generating questions"
            estimate={`${questions.length}${expected ? ` of ${expected}` : ""} ready. You can edit them once generation finishes.`}
          />
          {questions.map((q, i) => (
            <QuestionPreview key={q.id} question={q} number={i + 1} />
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {questions.length === 0 && (
            <Card className="form-panel">
              <p className="muted" style={{ textAlign: "center" }}>
                No questions yet. Add some below.
              </p>
            </Card>
          )}

          {questions.map((q, i) => {
            const card = q.type === "MCQ" ? (
              <MCQCard
                key={`${q.id}-${revision[q.id] ?? 0}`}
                question={q}
                testId={id}
                onSaved={handleSaved}
                onDeleted={handleDeleted}
              />
            ) : (
              <FRQCard
                key={`${q.id}-${revision[q.id] ?? 0}`}
                question={q}
                testId={id}
                onSaved={handleSaved}
                onDeleted={handleDeleted}
              />
            );
            // First part of a multi-part problem: its setup goes above it.
            const opensGroup = q.group && questions[i - 1]?.group?.id !== q.group.id;
            if (!opensGroup || !q.group) return card;
            return [
              <GroupSetupCard key={`group-${q.group.id}`} group={q.group} testId={id} onSaved={handleGroupSaved} />,
              card,
            ];
          })}

          <AddQuestionPanel testId={id} onAdded={handleAdded} />

          <div className="button-row split">
            <span className="muted small">{questions.length} question{questions.length !== 1 ? "s" : ""}</span>
            <Button onClick={() => navigate(`/test/${id}`)}>Take Test</Button>
          </div>
        </div>
      )}
    </div>
  );
}
