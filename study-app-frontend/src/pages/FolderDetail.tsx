import { BookOpen, Bot, Brain, ChevronDown, ChevronUp, Edit3, Files, FolderOpen, History, Info, Loader2, Plus, RotateCcw, ScrollText, Settings, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmModal, RenameModal } from "../components/ConfirmModal";
import { EmptyState } from "../components/EmptyState";
import { FileManager } from "../components/FileManager";
import { KojoChat } from "../components/KojoChat";
import { SelectionKojoAssistant } from "../components/SelectionKojoAssistant";
import { deleteTest, fetchAttempts, fetchFlashcards, fetchFolder, fetchTests, reindexFolderFiles, updateFolder, updateTest } from "../lib/api";
import { formatDate, formatPercent } from "../lib/format";
import type { AttemptSummary, Flashcard, Folder, TestCreationParams, TestSummary } from "../lib/types";

const PERSONA_DESCRIPTIONS: Record<string, string> = {
  balanced: "Conversational and thorough. Explains concepts clearly, gives examples, and checks understanding without being overwhelming.",
  concise: "Short, direct answers only. No elaboration unless you ask. Best when you just need a quick fact or definition.",
  tutorial: "Step-by-step teacher mode. Breaks concepts into structured lessons with explanations and worked examples.",
  socratic: "Answers questions with guiding questions. Pushes you to reason through problems yourself instead of just telling you the answer.",
};

export default function FolderDetail() {
  const { folderId } = useParams();
  const [folder, setFolder] = useState<Folder | null>(null);
  const [tests, setTests] = useState<TestSummary[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kojoOpen, setKojoOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [kojoSettingsOpen, setKojoSettingsOpen] = useState(false);
  const [renamingTest, setRenamingTest] = useState<TestSummary | null>(null);
  const [deletingTest, setDeletingTest] = useState<TestSummary | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [reindexMessage, setReindexMessage] = useState<string | null>(null);
  const [formDraft, setFormDraft] = useState<TestCreationParams | null>(null);
  const [viewingPromptTest, setViewingPromptTest] = useState<TestSummary | null>(null);
  const [viewingPromptParams, setViewingPromptParams] = useState<TestCreationParams | null>(null);

  const id = Number(folderId);

  useEffect(() => {
    if (!id) return;
    Promise.all([fetchFolder(id), fetchTests(id), fetchFlashcards(id)])
      .then(([folderData, testData, cardData]) => {
        setFolder(folderData);
        setTests(testData);
        setFlashcards(cardData);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Unable to load folder.");
      })
      .finally(() => setIsLoading(false));
  }, [id]);

  // Poll while any test is still generating
  useEffect(() => {
    const hasGenerating = tests.some((t) => t.generation_status === "generating");
    if (!hasGenerating) return;
    const pollId = setInterval(() => {
      fetchTests(id).then(setTests).catch(() => {});
    }, 4000);
    return () => clearInterval(pollId);
  }, [id, tests]);

  useEffect(() => {
    if (!id) return;
    try {
      const raw = localStorage.getItem(`nosey_create_test_form_${id}`);
      if (!raw) return;
      const draft = JSON.parse(raw) as TestCreationParams;
      if (draft.title?.trim() || draft.topicFocus?.trim() || draft.customInstructions?.trim()) {
        setFormDraft(draft);
      }
    } catch {
      // ignore malformed draft
    }
  }, [id]);

  function clearFormDraft() {
    localStorage.removeItem(`nosey_create_test_form_${id}`);
    setFormDraft(null);
  }

  function openPromptViewer(test: TestSummary) {
    try {
      const raw = localStorage.getItem(`nosey_test_params_${test.id}`);
      if (!raw) return;
      setViewingPromptParams(JSON.parse(raw) as TestCreationParams);
      setViewingPromptTest(test);
    } catch {
      // ignore
    }
  }

  async function commitRename(nextTitle: string) {
    if (!renamingTest) return;
    const test = renamingTest;
    setRenamingTest(null);
    try {
      const updated = await updateTest(test.id, { title: nextTitle, description: test.description });
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

  async function commitDelete() {
    if (!deletingTest) return;
    const test = deletingTest;
    setDeletingTest(null);
    try {
      await deleteTest(test.id);
      setTests((current) => current.filter((item) => item.id !== test.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete that test.");
    }
  }

  async function updateKojoSetting(patch: Partial<Pick<Folder, "kojo_sync_default" | "kojo_allow_artifacts" | "kojo_auto_index" | "kojo_persona">>) {
    if (!folder) return;
    try {
      const updated = await updateFolder(id, patch);
      setFolder(updated);
    } catch {
      // non-critical — silently ignore
    }
  }

  async function handleReindex() {
    setReindexing(true);
    setReindexMessage(null);
    try {
      const result = await reindexFolderFiles(id);
      let msg: string;
      if (result.reindexed === 0 && result.still_failed === 0) {
        msg = "All files are already indexed.";
      } else if (result.reindexed > 0 && result.still_failed === 0) {
        msg = `${result.reindexed} file${result.reindexed === 1 ? "" : "s"} re-indexed successfully.`;
      } else if (result.reindexed > 0) {
        msg = `${result.reindexed} re-indexed. ${result.still_failed} still failed — re-upload those files.`;
      } else {
        msg = `${result.still_failed} file${result.still_failed === 1 ? "" : "s"} could not be re-indexed. Re-upload them to fix.`;
      }
      setReindexMessage(msg);
      setTimeout(() => setReindexMessage(null), 5000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Re-index failed.";
      setReindexMessage(msg);
      setTimeout(() => setReindexMessage(null), 5000);
    } finally {
      setReindexing(false);
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

  const pageContent = (
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
            icon={<Files size={18} />}
            onClick={() => setFilesOpen(true)}
          >
            Manage Files
          </Button>
          <Button
            variant="secondary"
            icon={<Bot size={18} />}
            onClick={() => setKojoOpen((o) => !o)}
          >
            {kojoOpen ? "Close Kojo" : "Ask Kojo"}
          </Button>
          <Button
            variant="secondary"
            icon={kojoSettingsOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            onClick={() => setKojoSettingsOpen((o) => !o)}
          >
            Chat Settings
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
          <Link to={`/create-test?folderId=${id}`}>
            <Button icon={<Plus size={18} />}>New Test</Button>
          </Link>
        </div>
      </header>

      {kojoOpen && folder ? (
        <KojoChat folderId={id} folderName={folder.name} onClose={() => setKojoOpen(false)} />
      ) : null}

      {filesOpen ? (
        <FileManager folderId={id} onClose={() => setFilesOpen(false)} />
      ) : null}

      {kojoSettingsOpen && folder ? (
        <div className="folder-kojo-settings">
          <div className="folder-kojo-settings-header">
            <Bot size={16} />
            <span>Kojo Chat Settings</span>
            <span className="muted small">Controls how Kojo behaves with this folder</span>
          </div>
          <div className="folder-kojo-settings-body">
            <label className="folder-kojo-toggle-row">
              <div className="folder-kojo-toggle-info">
                <span className="folder-kojo-toggle-label">Sync folder into Chat Kojo by default</span>
                <span className="folder-kojo-toggle-desc">Kojo will use this folder's notes as context automatically when you open Chat mode.</span>
              </div>
              <button
                type="button"
                className={`folder-kojo-toggle${folder.kojo_sync_default !== false ? " folder-kojo-toggle--on" : ""}`}
                onClick={() => void updateKojoSetting({ kojo_sync_default: !(folder.kojo_sync_default !== false) })}
                aria-checked={folder.kojo_sync_default !== false}
                role="switch"
              >
                <span className="folder-kojo-toggle-thumb" />
              </button>
            </label>

            <label className="folder-kojo-toggle-row">
              <div className="folder-kojo-toggle-info">
                <span className="folder-kojo-toggle-label">Allow Kojo to create study artifacts</span>
                <span className="folder-kojo-toggle-desc">Permits Kojo to generate tests and flashcards from this folder's content.</span>
              </div>
              <button
                type="button"
                className={`folder-kojo-toggle${folder.kojo_allow_artifacts !== false ? " folder-kojo-toggle--on" : ""}`}
                onClick={() => void updateKojoSetting({ kojo_allow_artifacts: !(folder.kojo_allow_artifacts !== false) })}
                aria-checked={folder.kojo_allow_artifacts !== false}
                role="switch"
              >
                <span className="folder-kojo-toggle-thumb" />
              </button>
            </label>

            <label className="folder-kojo-toggle-row">
              <div className="folder-kojo-toggle-info">
                <span className="folder-kojo-toggle-label">Auto-index new files</span>
                <span className="folder-kojo-toggle-desc">Newly uploaded files are indexed for Kojo immediately.</span>
              </div>
              <button
                type="button"
                className={`folder-kojo-toggle${folder.kojo_auto_index !== false ? " folder-kojo-toggle--on" : ""}`}
                onClick={() => void updateKojoSetting({ kojo_auto_index: !(folder.kojo_auto_index !== false) })}
                aria-checked={folder.kojo_auto_index !== false}
                role="switch"
              >
                <span className="folder-kojo-toggle-thumb" />
              </button>
            </label>

            <div className="folder-kojo-reindex-row">
              <div className="folder-kojo-toggle-info">
                <span className="folder-kojo-toggle-label">Re-index files</span>
                <span className="folder-kojo-toggle-desc">Retry indexing for files that failed or were not auto-indexed.</span>
              </div>
              <div className="folder-kojo-reindex-action">
                <Button
                  type="button"
                  variant="secondary"
                  icon={<RotateCcw size={15} />}
                  onClick={() => void handleReindex()}
                  disabled={reindexing}
                >
                  {reindexing ? "Re-indexing…" : "Re-index"}
                </Button>
                {reindexMessage ? <span className="folder-kojo-reindex-msg muted small">{reindexMessage}</span> : null}
              </div>
            </div>

            <div className="folder-kojo-persona-row">
              <div className="folder-kojo-toggle-info">
                <span className="folder-kojo-toggle-label">Default persona style</span>
                <span className="folder-kojo-toggle-desc">How Kojo responds in chat sessions for this folder.</span>
              </div>
              <div className="folder-kojo-persona-field">
                <select
                  className="folder-kojo-persona-select"
                  value={folder.kojo_persona ?? "balanced"}
                  onChange={(e) => void updateKojoSetting({ kojo_persona: e.target.value })}
                >
                  <option value="balanced">Balanced</option>
                  <option value="concise">Concise</option>
                  <option value="tutorial">Tutorial</option>
                  <option value="socratic">Socratic</option>
                </select>
                <span className="folder-kojo-persona-tooltip-wrap">
                  <Info size={15} className="folder-kojo-persona-info-icon" />
                  <span className="folder-kojo-persona-tooltip">
                    {PERSONA_DESCRIPTIONS[folder.kojo_persona ?? "balanced"]}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {error ? <div className="form-error">{error}</div> : null}

      <section>
        <div className="section-title">
          <h2>Flashcards</h2>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span className="muted small">
              {flashcards.length} card{flashcards.length === 1 ? "" : "s"}
            </span>
            <Link to={`/folders/${id}/flashcards/manage`}>
              <Button variant="ghost" icon={<Settings size={15} />} style={{ minHeight: 36, padding: "6px 12px", fontSize: "0.85rem" }}>
                Manage
              </Button>
            </Link>
          </div>
        </div>
        {flashcards.length === 0 ? (
          <EmptyState
            icon={<Brain />}
            title="No flashcards yet"
            body="Generate flashcards from your notes or add them manually."
            action={
              <Link to={`/folders/${id}/flashcards/manage`}>
                <Button variant="secondary" icon={<Plus size={16} />}>Add Flashcards</Button>
              </Link>
            }
          />
        ) : (
          <>
            <div className="flashcard-preview-grid">
              {flashcards.slice(0, 6).map((card) => (
                <div key={card.id} className="flashcard-preview-card card">
                  <span className="eyebrow">Front</span>
                  <p>{card.front}</p>
                </div>
              ))}
            </div>
            {flashcards.length > 6 && (
              <p className="muted small" style={{ marginTop: 10 }}>
                +{flashcards.length - 6} more cards ·{" "}
                <Link to={`/folders/${id}/flashcards/manage`} style={{ color: "var(--green-dark)", fontWeight: 700 }}>
                  View all
                </Link>
              </p>
            )}
          </>
        )}
      </section>

      {(() => {
        const failedTests = tests.filter((t) => t.generation_status === "failed");
        const activeTests = tests.filter((t) => t.generation_status !== "failed");
        const hasDrafts = failedTests.length > 0 || formDraft !== null;
        return (
          <>
            {activeTests.length === 0 && failedTests.length === 0 ? (
              <EmptyState
                icon={<BookOpen />}
                title="No tests yet"
                body="Upload notes to generate a practice test for this folder."
                action={
                  <Link to={`/create-test?folderId=${id}`}>
                    <Button>Create Test</Button>
                  </Link>
                }
              />
            ) : activeTests.length > 0 ? (
              <section>
                <div className="section-title">
                  <h2>Practice Tests</h2>
                  <span className="muted small">
                    {activeTests.length} test{activeTests.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="test-list">
                  {activeTests.map((test) => (
                    <TestRow key={test.id} test={test} onRename={setRenamingTest} onDelete={setDeletingTest} onViewPrompt={openPromptViewer} />
                  ))}
                </div>
              </section>
            ) : null}

            {hasDrafts && (
              <section className="draft-section">
                <div className="section-title">
                  <h2>Drafts</h2>
                  <span className="muted small">
                    {failedTests.length + (formDraft ? 1 : 0)} item{failedTests.length + (formDraft ? 1 : 0) === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="draft-list">
                  {failedTests.map((test) => (
                    <div key={test.id} className="draft-card card">
                      <div className="draft-card-info">
                        <span className="draft-card-title">{test.title}</span>
                        <span className="muted small draft-card-status">Generation failed</span>
                      </div>
                      <div className="draft-card-actions">
                        <Link to={`/create-test?folderId=${id}&regenerateTestId=${test.id}`}>
                          <Button variant="secondary" icon={<RotateCcw size={14} />}>Regenerate</Button>
                        </Link>
                        <button aria-label={`Delete ${test.title}`} onClick={() => setDeletingTest(test)} type="button">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {formDraft && (
                    <div className="draft-card card">
                      <div className="draft-card-info">
                        <span className="draft-card-title">{formDraft.title || "Untitled draft"}</span>
                        <span className="muted small draft-card-status">
                          Unsaved form · {formatDate(formDraft.savedAt)}
                        </span>
                      </div>
                      <div className="draft-card-actions">
                        <Link to={`/create-test?folderId=${id}`}>
                          <Button variant="secondary" icon={<Edit3 size={14} />}>Continue</Button>
                        </Link>
                        <button aria-label="Clear draft" onClick={clearFormDraft} type="button">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )}
          </>
        );
      })()}

      <div className="folder-detail-footer">
        <FolderOpen size={18} style={{ color: folder?.color ?? "var(--green-dark)" }} />
        <span className="muted small">
          {folder?.test_count ?? 0} tests · {folder?.flashcard_count ?? 0} flashcards
        </span>
      </div>
    </div>
  );

  const modals = (
    <>
      {renamingTest ? (
        <RenameModal
          title="Rename practice test"
          initialValue={renamingTest.title}
          onSave={commitRename}
          onCancel={() => setRenamingTest(null)}
        />
      ) : null}
      {deletingTest ? (
        <ConfirmModal
          title="Delete test"
          message={`Delete "${deletingTest.title}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={commitDelete}
          onCancel={() => setDeletingTest(null)}
        />
      ) : null}
      {viewingPromptTest && viewingPromptParams ? (
        <PromptModal
          test={viewingPromptTest}
          params={viewingPromptParams}
          onClose={() => { setViewingPromptTest(null); setViewingPromptParams(null); }}
        />
      ) : null}
    </>
  );

  return folder ? (
    <>
      <SelectionKojoAssistant folderId={id} folderName={folder.name}>
        {pageContent}
      </SelectionKojoAssistant>
      {modals}
    </>
  ) : (
    <>
      {pageContent}
      {modals}
    </>
  );
}

function TestRow({
  test,
  onRename,
  onDelete,
  onViewPrompt,
}: {
  test: TestSummary;
  onRename: (test: TestSummary) => void;
  onDelete: (test: TestSummary) => void;
  onViewPrompt?: (test: TestSummary) => void;
}) {
  const [showAttempts, setShowAttempts] = useState(false);
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const hasPrompt = !!localStorage.getItem(`nosey_test_params_${test.id}`);

  async function loadAttempts() {
    if (showAttempts) { setShowAttempts(false); return; }
    const data = await fetchAttempts(test.id);
    setAttempts(data);
    setShowAttempts(true);
  }

  const isGenerating = test.generation_status === "generating";
  const isFailed = test.generation_status === "failed";

  return (
    <Card className={`test-row${showAttempts ? " test-row--attempts-open" : ""}`}>
      {isGenerating ? (
        <div className="test-row-main" style={{ cursor: "default", opacity: 0.75 }}>
          <div>
            <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {test.title}
              <Loader2 size={15} className="spin" style={{ color: "var(--green-dark)" }} />
            </h3>
            <p className="muted small">Generating questions…</p>
          </div>
        </div>
      ) : isFailed ? (
        <div className="test-row-main" style={{ cursor: "default" }}>
          <div>
            <h3>{test.title}</h3>
            <p className="muted small" style={{ color: "var(--red, #e53e3e)" }}>
              Generation failed — delete and try again
            </p>
          </div>
        </div>
      ) : (
        <Link className="test-row-main" to={`/test/${test.id}`}>
          <div>
            <h3>{test.title}</h3>
            <p className="muted small">
              {test.question_count} questions · {formatDate(test.created_at)}
            </p>
          </div>
          <div className="score-badge">{formatPercent(test.best_score)}</div>
        </Link>
      )}
      <div className="row-actions">
        {!isGenerating && test.attempt_count > 0 ? (
          <button
            aria-label="View attempt history"
            className={`attempt-toggle-btn${showAttempts ? " attempt-toggle-btn--active" : ""}`}
            onClick={loadAttempts}
            title="Attempt history"
            type="button"
          >
            <History size={17} />
          </button>
        ) : null}
        {!isGenerating && !isFailed && hasPrompt && onViewPrompt ? (
          <button
            aria-label="View creation prompt"
            onClick={() => onViewPrompt(test)}
            title="View creation prompt"
            type="button"
          >
            <ScrollText size={17} />
          </button>
        ) : null}
        {!isGenerating && (
          <button aria-label={`Rename ${test.title}`} onClick={() => onRename(test)} type="button">
            <Edit3 size={17} />
          </button>
        )}
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

const TEST_TYPE_LABELS: Record<string, string> = {
  MCQ_only: "Multiple choice",
  FRQ_only: "Free response",
  mixed: "Mixed",
  Extreme: "Extreme MCQ",
};

function PromptModal({
  test,
  params,
  onClose,
}: {
  test: TestSummary;
  params: TestCreationParams;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const mode = params.isCodingMode
    ? `Coding (${params.codingLanguage})`
    : params.isMathMode
      ? "Math"
      : "Standard";

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="prompt-modal modal-card" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="prompt-modal-header">
          <div>
            <h2>Creation prompt</h2>
            <p className="muted small">{test.title}</p>
          </div>
          <button className="prompt-modal-close" onClick={onClose} type="button" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="prompt-modal-body">
          <div className="prompt-modal-grid">
            <div className="prompt-modal-field">
              <span className="prompt-modal-label">Test type</span>
              <span className="prompt-modal-value">{TEST_TYPE_LABELS[params.testType] ?? params.testType}</span>
            </div>
            <div className="prompt-modal-field">
              <span className="prompt-modal-label">Mode</span>
              <span className="prompt-modal-value">{mode}</span>
            </div>
            {params.advancedMode && (
              <>
                <div className="prompt-modal-field">
                  <span className="prompt-modal-label">Difficulty</span>
                  <span className="prompt-modal-value" style={{ textTransform: "capitalize" }}>{params.difficulty}</span>
                </div>
                <div className="prompt-modal-field">
                  <span className="prompt-modal-label">Questions</span>
                  <span className="prompt-modal-value">
                    {params.testType !== "FRQ_only" ? `${params.countMcq} MCQ` : ""}
                    {params.testType === "mixed" ? " · " : ""}
                    {params.testType !== "MCQ_only" && params.testType !== "Extreme" ? `${params.countFrq} FRQ` : ""}
                  </span>
                </div>
              </>
            )}
          </div>
          {params.topicFocus && (
            <div className="prompt-modal-section">
              <span className="prompt-modal-label">Topic focus</span>
              <p className="prompt-modal-text">{params.topicFocus}</p>
            </div>
          )}
          {params.customInstructions && (
            <div className="prompt-modal-section">
              <span className="prompt-modal-label">Custom instructions</span>
              <p className="prompt-modal-text">{params.customInstructions}</p>
            </div>
          )}
          {!params.topicFocus && !params.customInstructions && (
            <p className="muted small" style={{ marginTop: 8 }}>No custom instructions or topic focus were set for this test.</p>
          )}
          <p className="muted small prompt-modal-date">Created {formatDate(params.savedAt)}</p>
        </div>
      </div>
    </div>
  );
}
