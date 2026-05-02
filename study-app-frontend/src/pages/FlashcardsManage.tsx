import { ArrowLeft, Edit3, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { TextInput } from "../components/Field";
import {
  createFlashcard,
  deleteFlashcard,
  fetchFlashcards,
  fetchFolderFiles,
  fetchProviderStatus,
  generateFlashcards,
  generateFlashcardsFromFile,
  updateFlashcard,
} from "../lib/api";
import type { Flashcard, ProviderStatus } from "../lib/types";

const GENERATION_PROVIDER_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "groq", label: "Groq" },
  { value: "gemini", label: "Google" },
  { value: "claude", label: "Anthropic" },
  { value: "ollama", label: "Ollama" },
];

export default function FlashcardsManage() {
  const { folderId } = useParams();
  const id = Number(folderId);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [newFront, setNewFront] = useState("");
  const [newBack, setNewBack] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generatingMore, setGeneratingMore] = useState(false);
  const [generateCount, setGenerateCount] = useState(10);
  const [folderFileCount, setFolderFileCount] = useState(0);
  const [generationProvider, setGenerationProvider] = useState(() => localStorage.getItem("nosey_generation_provider") || "auto");
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchFlashcards(id).then(setCards);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    fetchFolderFiles(id).then((files) => {
      if (active) setFolderFileCount(files.length);
    });
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    fetchProviderStatus().then(setProviderStatus).catch(() => {});
  }, []);

  useEffect(() => {
    if (!providerStatus) return;
    const unavailable =
      (generationProvider === "groq" && !providerStatus.groq) ||
      (generationProvider === "gemini" && !providerStatus.gemini) ||
      (generationProvider === "claude" && !providerStatus.claude) ||
      (generationProvider === "ollama" && !providerStatus.ollama);
    if (unavailable) {
      setGenerationProvider("auto");
      localStorage.setItem("nosey_generation_provider", "auto");
    }
  }, [providerStatus, generationProvider]);

  function startEdit(card: Flashcard) {
    setEditingId(card.id);
    setEditFront(card.front);
    setEditBack(card.back);
  }

  async function saveEdit(card: Flashcard) {
    if (!editFront.trim() || !editBack.trim()) return;
    try {
      const updated = await updateFlashcard(id, card.id, { front: editFront.trim(), back: editBack.trim() });
      setCards((prev) => prev.map((c) => (c.id === card.id ? updated : c)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    }
  }

  async function handleDelete(card: Flashcard) {
    if (!window.confirm("Delete this flashcard?")) return;
    try {
      await deleteFlashcard(id, card.id);
      setCards((prev) => prev.filter((c) => c.id !== card.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete.");
    }
  }

  async function handleAdd() {
    if (!newFront.trim() || !newBack.trim()) return;
    try {
      const card = await createFlashcard(id, { front: newFront.trim(), back: newBack.trim() });
      setCards((prev) => [card, ...prev]);
      setNewFront("");
      setNewBack("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add card.");
    }
  }

  async function handleDeleteAllFlashcards() {
    if (cards.length === 0 || deletingAll) return;
    setDeletingAll(true);
    setError(null);
    try {
      await Promise.all(cards.map((card) => deleteFlashcard(id, card.id)));
      setCards([]);
      setShowDeleteAllModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete all flashcards.");
    } finally {
      setDeletingAll(false);
    }
  }

  async function handleGenerateFromFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setGenerating(true);
    setError(null);
    try {
      const generated = await generateFlashcardsFromFile(id, files, 10, generationProvider, localStorage.getItem("nosey_question_fallback") !== "false");
      setCards((prev) => [...generated, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate flashcards.");
    } finally {
      setGenerating(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleGenerateMore() {
    setGeneratingMore(true);
    setError(null);
    try {
      const generated = await generateFlashcards(id, {
        count: generateCount,
        prompt:
          "Create fresh flashcards using the folder's saved files and the current flashcards as context. Do not repeat existing cards, and focus on new concepts, definitions, examples, or comparisons that are not already covered.",
        provider: generationProvider,
        enableFallback: localStorage.getItem("nosey_question_fallback") !== "false",
      });
      setCards((prev) => {
        const seen = new Set(prev.map((card) => `${card.front.trim().toLowerCase()}::${card.back.trim().toLowerCase()}`));
        const fresh = generated.filter((card) => {
          const key = `${card.front.trim().toLowerCase()}::${card.back.trim().toLowerCase()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return [...fresh, ...prev];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate more flashcards.");
    } finally {
      setGeneratingMore(false);
    }
  }

  return (
    <div className="page page-narrow">
      <header className="page-header">
        <div>
          <Link className="back-link" to={`/folders/${id}`}>
            <ArrowLeft size={16} />
            Back to folder
          </Link>
          <h1>Manage Flashcards</h1>
          <p className="muted">{cards.length} card{cards.length === 1 ? "" : "s"}</p>
        </div>
        <div className="toolbar">
          <input
            accept=".pdf,.docx,.txt,.md"
            multiple
            onChange={handleGenerateFromFile}
            ref={fileRef}
            style={{ display: "none" }}
            type="file"
          />
          <Button
            icon={<Upload size={18} />}
            onClick={() => fileRef.current?.click()}
            variant="secondary"
          >
            {generating ? "Generating..." : "Generate from file"}
          </Button>
          <Button
            icon={<Plus size={18} />}
            onClick={handleGenerateMore}
            variant="secondary"
            disabled={generatingMore}
          >
            {generatingMore ? "Generating..." : "Generate more"}
          </Button>
          <Button
            icon={<Trash2 size={18} />}
            onClick={() => setShowDeleteAllModal(true)}
            variant="danger"
            disabled={cards.length === 0 || deletingAll}
          >
            Delete All Flashcards
          </Button>
        </div>
      </header>

      <div className="toolbar" style={{ justifyContent: "flex-end", marginTop: -8, marginBottom: 12 }}>
        <label className="muted small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Cards to add
          <input
            type="number"
            min={1}
            max={50}
            value={generateCount}
            onChange={(e) => setGenerateCount(Math.max(1, Math.min(50, Number(e.target.value))))}
            className="input"
            style={{ width: 92, padding: "8px 10px" }}
          />
        </label>
        <label className="muted small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          AI model
          <select
            className="input select"
            value={generationProvider}
            onChange={(e) => {
              setGenerationProvider(e.target.value);
              localStorage.setItem("nosey_generation_provider", e.target.value);
            }}
            style={{ width: 160, padding: "8px 10px" }}
          >
            {GENERATION_PROVIDER_OPTIONS.map((option) => {
              let label = option.label;
              let disabled = false;
              if (providerStatus) {
                if (option.value === "ollama") {
                  disabled = !providerStatus.ollama;
                  if (disabled) label += " (offline)";
                } else if (option.value === "groq") {
                  disabled = !providerStatus.groq;
                  if (disabled) label += " (no key)";
                } else if (option.value === "gemini") {
                  disabled = !providerStatus.gemini;
                  if (disabled) label += " (no key)";
                } else if (option.value === "claude") {
                  disabled = !providerStatus.claude;
                  if (disabled) label += " (no key)";
                }
              }
              return (
                <option key={option.value} value={option.value} disabled={disabled}>
                  {label}
                </option>
              );
            })}
          </select>
        </label>
        <span className="muted small" style={{ alignSelf: "center" }}>
          {folderFileCount > 0
            ? `${folderFileCount} saved file${folderFileCount === 1 ? "" : "s"} will be used as source context.`
            : "No saved files in this folder yet. Nosey will generate from the existing flashcards and any uploaded file you choose."}
        </span>
      </div>

      {error ? <div className="form-error">{error}</div> : null}

      <Card tone="soft" className="add-card-form">
        <h3>Add a card</h3>
        <TextInput
          label="Front (question / term)"
          value={newFront}
          onChange={(e) => setNewFront(e.target.value)}
          placeholder="What is photosynthesis?"
        />
        <TextInput

          label="Back (answer / definition)"
          value={newBack}
          onChange={(e) => setNewBack(e.target.value)}
          placeholder="The process plants use to convert light into energy..."
        />
        <Button
          disabled={!newFront.trim() || !newBack.trim()}
          icon={<Plus size={18} />}
          onClick={handleAdd}
        >
          Add Card
        </Button>
      </Card>

      <section>
        <div className="section-title">
          <h2>All Cards</h2>
        </div>
        {cards.length === 0 ? (
          <p className="muted small">No flashcards yet. Add one above or generate from a file.</p>
        ) : (
          <div className="flashcard-manage-list">
            {cards.map((card) =>
              editingId === card.id ? (
                <Card key={card.id} className="flashcard-manage-item editing">
                  <TextInput
                    label="Front"
                    value={editFront}
                    onChange={(e) => setEditFront(e.target.value)}
                  />
                  <TextInput
                    label="Back"
                    value={editBack}
                    onChange={(e) => setEditBack(e.target.value)}
                  />
                  <div className="button-row">
                    <Button onClick={() => saveEdit(card)}>Save</Button>
                    <Button variant="secondary" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </Card>
              ) : (
                <Card key={card.id} className="flashcard-manage-item">
                  <div className="flashcard-manage-content">
                    <div>
                      <span className="eyebrow">Front</span>
                      <p>{card.front}</p>
                    </div>
                    <div>
                      <span className="eyebrow">Back</span>
                      <p>{card.back}</p>
                    </div>
                  </div>
                  <div className="row-actions">
                    <button aria-label="Edit card" onClick={() => startEdit(card)} type="button">
                      <Edit3 size={17} />
                    </button>
                    <button aria-label="Delete card" onClick={() => handleDelete(card)} type="button">
                      <Trash2 size={17} />
                    </button>
                  </div>
                </Card>
              )
            )}
          </div>
        )}
      </section>

      {showDeleteAllModal ? (
        <div className="modal-backdrop" onMouseDown={() => setShowDeleteAllModal(false)}>
          <div className="modal-card" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <h2>Delete All Flashcards?</h2>
            <p className="muted">
              This will permanently remove all flashcards in this class folder. Are you sure?
            </p>
            <div className="button-row">
              <Button
                type="button"
                variant="danger"
                onClick={handleDeleteAllFlashcards}
                disabled={deletingAll}
              >
                {deletingAll ? "Deleting..." : "Yes"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowDeleteAllModal(false)}
                disabled={deletingAll}
              >
                No
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
