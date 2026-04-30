import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import {
  addQuestion,
  deleteQuestion,
  fetchQuestionsForEditing,
  updateQuestion,
} from "../lib/api";
import type { MCQOptionInput, QuestionCreate, QuestionEditable } from "../lib/types";

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
    if (!confirm("Delete this question?")) return;
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="eyebrow">MCQ</span>
        <button
          type="button"
          onClick={handleDelete}
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

      {error && <div className="form-error" style={{ margin: 0 }}>{error}</div>}

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
        <span className="field-label">Options — select the correct answer</span>
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
  const [text, setText] = useState(question.question_text);
  const [answer, setAnswer] = useState(question.expected_answer ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const saved = await updateQuestion(testId, question.id, {
        question_text: text.trim(),
        expected_answer: answer.trim(),
      });
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this question?")) return;
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="eyebrow">FRQ</span>
        <button
          type="button"
          onClick={handleDelete}
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

      {error && <div className="form-error" style={{ margin: 0 }}>{error}</div>}

      <div className="field">
        <label className="field-label">Question</label>
        <textarea
          className="input textarea"
          style={{ minHeight: 80 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      <div className="field">
        <label className="field-label">Expected answer (used for grading)</label>
        <textarea
          className="input textarea"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
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

      {error && <div className="form-error" style={{ margin: 0 }}>{error}</div>}

      <div className="choice-grid">
        {(["MCQ", "FRQ"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`choice ${type === t ? "active" : ""}`}
            onClick={() => setType(t)}
          >
            {t === "MCQ" ? "Multiple choice" : "Free response"}
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
          <span className="field-label">Options — select the correct answer</span>
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

export default function QuestionEditor() {
  const { testId } = useParams<{ testId: string }>();
  const navigate = useNavigate();
  const id = Number(testId);

  const [questions, setQuestions] = useState<QuestionEditable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchQuestionsForEditing(id)
      .then(setQuestions)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load questions"))
      .finally(() => setLoading(false));
  }, [id]);

  function handleSaved(updated: QuestionEditable) {
    setQuestions((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
  }

  function handleDeleted(questionId: number) {
    setQuestions((prev) => prev.filter((q) => q.id !== questionId));
  }

  function handleAdded(q: QuestionEditable) {
    setQuestions((prev) => [...prev, q]);
  }

  return (
    <div className="page page-narrow">
      <Link className="back-link" to="/dashboard">
        <ArrowLeft size={16} />
        Dashboard
      </Link>

      <header className="page-header">
        <div>
          <span className="eyebrow">Advanced mode</span>
          <h1>Question editor</h1>
          <p className="muted">
            Edit, remove, or add questions. Changes save immediately. When you&apos;re done, take the test.
          </p>
        </div>
        <Button onClick={() => navigate(`/test/${id}`)}>Take Test</Button>
      </header>

      {error && <div className="form-error">{error}</div>}

      {loading ? (
        <p className="muted">Loading questions…</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {questions.length === 0 && !loading && (
            <Card className="form-panel">
              <p className="muted" style={{ textAlign: "center" }}>
                No questions yet. Add some below.
              </p>
            </Card>
          )}

          {questions.map((q) =>
            q.type === "MCQ" ? (
              <MCQCard
                key={q.id}
                question={q}
                testId={id}
                onSaved={handleSaved}
                onDeleted={handleDeleted}
              />
            ) : (
              <FRQCard
                key={q.id}
                question={q}
                testId={id}
                onSaved={handleSaved}
                onDeleted={handleDeleted}
              />
            )
          )}

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
