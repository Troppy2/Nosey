import { AlertCircle, ArrowLeft, CheckCircle2, FolderOpen, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { deleteFlashcard, fetchFlashcards, fetchFolders, recordFlashcardAttempt } from "../lib/api";
import type { Flashcard, Folder } from "../lib/types";

export default function Flashcards() {
  const { folderId } = useParams();
  const initialFolderId = folderId ? Number(folderId) : null;
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(initialFolderId);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [studied, setStudied] = useState<Set<number>>(new Set());
  const [startedAt, setStartedAt] = useState(Date.now());
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetchFolders().then(setFolders).catch(() => setFolders([]));
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      if (target && (target.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT")) {
        return;
      }
      if (showDeleteAllModal) {
        return;
      }

      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        setFlipped((currentFlipped) => !currentFlipped);
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((currentIndex) => Math.max(currentIndex - 1, 0));
        setFlipped(false);
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((currentIndex) => Math.min(currentIndex + 1, cards.length - 1));
        setFlipped(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cards.length, showDeleteAllModal]);

  useEffect(() => {
    setSelectedFolderId(folderId ? Number(folderId) : null);
  }, [folderId]);

  useEffect(() => {
    if (selectedFolderId == null) {
      setCards([]);
      setIndex(0);
      setStudied(new Set());
      setFlipped(false);
      setStartedAt(Date.now());
      return;
    }

    fetchFlashcards(selectedFolderId).then((data) => {
      setCards(data);
      setIndex(0);
      setStudied(new Set());
      setFlipped(false);
      setStartedAt(Date.now());
    });
  }, [selectedFolderId]);

  const sortedCards = [...cards].sort((a, b) => b.difficulty - a.difficulty);
  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const current = sortedCards[index];
  const progress = cards.length ? ((index + 1) / cards.length) * 100 : 0;
  const complete = cards.length > 0 && studied.size === cards.length;
  const remaining = Math.max(cards.length - studied.size, 0);

  async function mark(correct: boolean) {
    if (!current) return;
    await recordFlashcardAttempt(current.folder_id, current.id, correct, Date.now() - startedAt);
    const nextStudied = new Set(studied).add(current.id);
    setStudied(nextStudied);
    setStartedAt(Date.now());
    setFlipped(false);
    if (index < cards.length - 1) setIndex(index + 1);
  }

  function reset() {
    setIndex(0);
    setStudied(new Set());
    setFlipped(false);
    setStartedAt(Date.now());
  }

  async function handleDeleteAllFlashcards() {
    if (cards.length === 0 || deletingAll) return;
    setDeletingAll(true);
    setActionError(null);
    try {
      await Promise.all(cards.map((card) => deleteFlashcard(card.folder_id, card.id)));
      setCards([]);
      setShowDeleteAllModal(false);
      reset();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to delete all flashcards.");
    } finally {
      setDeletingAll(false);
    }
  }

  if (selectedFolderId == null) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <span className="eyebrow">Review</span>
            <h1>Flashcard Classes</h1>
            <p className="muted">Pick a class folder to start reviewing its flashcards.</p>
          </div>
        </header>

        {folders.length === 0 ? (
          <EmptyState
            icon={<FolderOpen />}
            title="No class folders yet"
            body="Create a class folder first, then generate or add flashcards in that folder."
            action={
              <Link to="/folders">
                <Button>Go to Folders</Button>
              </Link>
            }
          />
        ) : (
          <section className="folder-grid flash-folder-grid">
            {folders.map((folder) => (
              <Card key={folder.id} interactive className="folder-card flash-folder-card">
                <Link className="folder-card-main" to={`/flashcards/${folder.id}`}>
                  <span className="folder-dot" style={{ background: folder.color ?? "var(--green-dark)" }} />
                  <div>
                    <FolderOpen size={34} style={{ color: folder.color ?? "var(--green-dark)" }} />
                    <h2>{folder.name}</h2>
                    <p className="muted">{folder.subject ?? "Class folder"}</p>
                  </div>
                  <div className="folder-card-footer">
                    <span>{folder.flashcard_count} cards</span>
                    <span>Review</span>
                  </div>
                </Link>
              </Card>
            ))}
          </section>
        )}
      </div>
    );
  }

  if (cards.length === 0 || !current) {
    return (
      <div className="page page-narrow">
        <EmptyState
          icon={<AlertCircle />}
          title={`No flashcards available for ${selectedFolder?.name ?? "this class"}`}
          body="There is nothing available for this class right now. Try another class folder."
          action={
            <Link to="/flashcards">
              <Button>Back to Class Folders</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (complete) {
    return (
      <div className="page page-narrow">
        <Card className="complete-card">
          <CheckCircle2 size={54} />
          <h1>Session complete</h1>
          <p>You reviewed {cards.length} cards. The toughest cards stay near the top next time.</p>
          <div className="button-row">
            <Button icon={<RotateCcw size={18} />} onClick={reset}>
              Study Again
            </Button>
            <Link to="/dashboard">
              <Button variant="secondary">Dashboard</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flash-screen">
      <header className="flash-header">
        <Link className="back-link" to="/flashcards">
          <ArrowLeft size={16} />
          Class folders
        </Link>
        <div>
          <h1>{selectedFolder?.name ?? "Flashcards"}</h1>
          <p className="muted">{remaining} cards remaining</p>
        </div>
        <Button
          variant="danger"
          onClick={() => setShowDeleteAllModal(true)}
          disabled={cards.length === 0 || deletingAll}
        >
          Delete All Flashcards
        </Button>
        <Button variant="secondary" icon={<RotateCcw size={18} />} onClick={reset}>
          Reset
        </Button>
      </header>

      {actionError ? <div className="form-error">{actionError}</div> : null}

      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <main className="flash-wrap">
        <div className="flash-meta">
          Card {index + 1} of {cards.length} · Difficulty {current.difficulty}
        </div>
        <button className={`flip-card ${flipped ? "flipped" : ""}`} onClick={() => setFlipped(!flipped)} type="button">
          <div className="flip-inner">
            <Card className="flip-face flip-front">
              <span className="eyebrow">Question</span>
              <h2>{current.front}</h2>
            </Card>
            <Card className="flip-face flip-back">
              <span className="eyebrow">Answer</span>
              <p>{current.back}</p>
            </Card>
          </div>
        </button>
        <p className="muted small">Click the card to flip it.</p>

        {flipped ? (
          <div className="confidence-row">
            <button className="confidence hard" onClick={() => mark(false)} type="button">
              <XCircle size={21} />
              Hard
            </button>
            <button className="confidence medium" onClick={() => mark(false)} type="button">
              <AlertCircle size={21} />
              Medium
            </button>
            <button className="confidence easy" onClick={() => mark(true)} type="button">
              <CheckCircle2 size={21} />
              Easy
            </button>
          </div>
        ) : null}
      </main>

      {showDeleteAllModal ? (
        <div className="modal-backdrop" onMouseDown={() => setShowDeleteAllModal(false)}>
          <div className="modal-card" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <h2>Delete All Flashcards?</h2>
            <p className="muted">Are you sure? This permanently removes all flashcards in this class.</p>
            <div className="button-row">
              <Button type="button" variant="danger" onClick={handleDeleteAllFlashcards} disabled={deletingAll}>
                {deletingAll ? "Deleting..." : "Yes"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowDeleteAllModal(false)} disabled={deletingAll}>
                No
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
