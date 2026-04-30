import { BookOpen, Bot, Brain, Edit3, FolderOpen, History, Plus, Settings, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { KojoChat } from "../components/KojoChat";
import { deleteTest, fetchAttempts, fetchFolder, fetchTests, updateTest } from "../lib/api";
import { formatDate, formatPercent } from "../lib/format";
import type { AttemptSummary, Folder, TestSummary } from "../lib/types";

export default function FolderDetail() {
  const { folderId } = useParams();
  const [folder, setFolder] = useState<Folder | null>(null);
  const [tests, setTests] = useState<TestSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kojoOpen, setKojoOpen] = useState(false);

  const id = Number(folderId);

  useEffect(() => {
    if (!id) return;
    Promise.all([fetchFolder(id), fetchTests(id)])
      .then(([folderData, testData]) => {
        setFolder(folderData);
        setTests(testData);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Unable to load folder.");
      })
      .finally(() => setIsLoading(false));
  }, [id]);

  async function handleRenameTest(test: TestSummary) {
    const nextTitle = window.prompt("Rename practice test", test.title);
    if (!nextTitle?.trim()) return;
    try {
      const updated = await updateTest(test.id, { title: nextTitle.trim(), description: test.description });
      setTests((current) =>
        current.map((item) =>
          item.id === test.id
            ? { ...item, title: updated.title, description: updated.description ?? item.description }
            : item,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to rename that test.");
    }
  }

  async function handleDeleteTest(test: TestSummary) {
    if (!window.confirm(`Delete ${test.title}? This cannot be undone.`)) return;
    try {
      await deleteTest(test.id);
      setTests((current) => current.filter((item) => item.id !== test.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete that test.");
    }
  }

  if (isLoading) {
    return (
      <div className="page">
        <div className="centered-block">
          <span className="loader" />
        </div>
      </div>
    );
  }

  return (
    <div className={`page ${kojoOpen ? "page--kojo-open" : ""}`}>
      <header className="page-header">
        <div>
          <span className="eyebrow">{folder?.subject ?? "Folder"}</span>
          <h1>{folder?.name ?? "Folder"}</h1>
          {folder?.description ? <p className="muted">{folder.description}</p> : null}
        </div>
        <div className="toolbar">
          <Button
            variant="secondary"
            icon={<Bot size={18} />}
            onClick={() => setKojoOpen((o) => !o)}
          >
            {kojoOpen ? "Close Kojo" : "Ask Kojo"}
          </Button>
          <Link to={`/flashcards/${id}`}>
            <Button variant="secondary" icon={<Brain size={18} />}>
              Study Flashcards
            </Button>
          </Link>
          <Link to={`/folders/${id}/flashcards/manage`}>
            <Button variant="secondary" icon={<Settings size={18} />}>
              Manage Flashcards
            </Button>
          </Link>
          <Link to="/create-test">
            <Button icon={<Plus size={18} />}>New Test</Button>
          </Link>
        </div>
      </header>

      {kojoOpen && folder ? (
        <KojoChat folderId={id} folderName={folder.name} onClose={() => setKojoOpen(false)} />
      ) : null}

      {error ? <div className="form-error">{error}</div> : null}

      {tests.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title="No tests yet"
          body="Upload notes to generate a practice test for this folder."
          action={
            <Link to="/create-test">
              <Button>Create Test</Button>
            </Link>
          }
        />
      ) : (
        <section>
          <div className="section-title">
            <h2>Practice Tests</h2>
            <span className="muted small">
              {tests.length} test{tests.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="test-list">
            {tests.map((test) => (
              <TestRow key={test.id} test={test} onRename={handleRenameTest} onDelete={handleDeleteTest} />
            ))}
          </div>
        </section>
      )}

      <div className="folder-detail-footer">
        <FolderOpen size={18} style={{ color: folder?.color ?? "var(--green-dark)" }} />
        <span className="muted small">
          {folder?.test_count ?? 0} tests · {folder?.flashcard_count ?? 0} flashcards
        </span>
      </div>
    </div>
  );
}

function TestRow({
  test,
  onRename,
  onDelete,
}: {
  test: TestSummary;
  onRename: (test: TestSummary) => void;
  onDelete: (test: TestSummary) => void;
}) {
  const [showAttempts, setShowAttempts] = useState(false);
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);

  async function loadAttempts() {
    if (showAttempts) { setShowAttempts(false); return; }
    const data = await fetchAttempts(test.id);
    setAttempts(data);
    setShowAttempts(true);
  }

  return (
    <Card className="test-row">
      <Link className="test-row-main" to={`/test/${test.id}`}>
        <div>
          <h3>{test.title}</h3>
          <p className="muted small">
            {test.question_count} questions · {formatDate(test.created_at)}
          </p>
        </div>
        <div className="score-badge">{formatPercent(test.best_score)}</div>
      </Link>
      <div className="row-actions">
        {test.attempt_count > 0 ? (
          <button aria-label="View attempt history" onClick={loadAttempts} type="button">
            <History size={17} />
          </button>
        ) : null}
        <button aria-label={`Rename ${test.title}`} onClick={() => onRename(test)} type="button">
          <Edit3 size={17} />
        </button>
        <button aria-label={`Delete ${test.title}`} onClick={() => onDelete(test)} type="button">
          <Trash2 size={17} />
        </button>
      </div>
      {showAttempts && attempts.length > 0 ? (
        <div className="attempt-history">
          {attempts.map((a) => (
            <Link className="attempt-row" key={a.id} to={`/results/${a.id}`}>
              <span>Attempt {a.attempt_number}</span>
              <span>{formatPercent(a.score)} · {formatDate(a.created_at)}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
