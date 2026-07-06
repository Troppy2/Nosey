import { AlertCircle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, FolderOpen, RotateCcw, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmModal } from "../components/ConfirmModal";
import { EmptyState } from "../components/EmptyState";
import { FeatureSurvey } from "../components/FeatureSurvey";
import { MarkdownContent } from "../components/MarkdownContent";
import { deleteFlashcard, fetchFlashcards, fetchFolders, isGuestSession, recordFlashcardAttempt, scopeKey } from "../lib/api";
import type { Flashcard, Folder } from "../lib/types";

export default function Flashcards() {
  const { folderId } = useParams();
  const [searchParams] = useSearchParams();
  const cardParam = searchParams.get("card");
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
        setStartedAt(Date.now());
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((currentIndex) => Math.min(currentIndex + 1, cards.length - 1));
        setFlipped(false);
        setStartedAt(Date.now());
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cards.length, showDeleteAllModal]);

  useEffect(() => {
    setSelectedFolderId(folderId ? Number(folderId) : null);
  }, [folderId]);

  // Persist card index so returning to a session resumes at the same card
  useEffect(() => {
    if (selectedFolderId != null && index > 0) {
      localStorage.setItem(scopeKey(`nosey_flashcard_index_${selectedFolderId}`), String(index));
    }
  }, [index, selectedFolderId]);

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
      const saved = localStorage.getItem(scopeKey(`nosey_flashcard_index_${selectedFolderId}`));
      const savedIndex = saved !== null ? Math.min(Number(saved), data.length - 1) : 0;
      setIndex(Math.max(savedIndex, 0));
      setStudied(new Set());
      setFlipped(false);
      setStartedAt(Date.now());
    });
  }, [selectedFolderId]);

  // Deep link from the dashboard "Review These" cards: jump straight to that card
  // once the folder's cards have loaded (overrides the resumed/saved index).
  useEffect(() => {
    if (!cardParam || cards.length === 0) return;
    const targetId = Number(cardParam);
    const targetIndex = [...cards]
      .sort((a, b) => b.difficulty - a.difficulty)
      .findIndex((card) => card.id === targetId);
    if (targetIndex >= 0) {
      setIndex(targetIndex);
      setFlipped(false);
      setStartedAt(Date.now());
    }
  }, [cardParam, cards]);

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

  function goTo(nextIndex: number) {
    setIndex(Math.min(Math.max(nextIndex, 0), cards.length - 1));
    setFlipped(false);
    setStartedAt(Date.now());
  }

  function reset() {
    setIndex(0);
    setStudied(new Set());
    setFlipped(false);
    setStartedAt(Date.now());
    if (selectedFolderId != null) {
      localStorage.removeItem(scopeKey(`nosey_flashcard_index_${selectedFolderId}`));
    }
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
        {!isGuestSession() ? <FeatureSurvey feature="flashcards" trigger={complete} /> : null}
      </div>
    );
  }

  return (
    <div className="flash-screen">
      <header className="flash-header">
        <div className="flash-header-row">
          <Link className="flash-back-btn" to="/flashcards" aria-label="Back to class folders" title="Back to class folders">
            <ArrowLeft size={18} />
          </Link>
          <div className="flash-header-title">
            <h1>{selectedFolder?.name ?? "Flashcards"}</h1>
            <p className="flash-header-sub">
              {remaining} card{remaining === 1 ? "" : "s"} remaining
            </p>
          </div>
          <div className="flash-header-actions">
            <button
              className="flash-icon-btn"
              onClick={reset}
              type="button"
              aria-label="Restart session"
              title="Restart session"
            >
              <RotateCcw size={17} />
            </button>
            <button
              className="flash-icon-btn flash-icon-btn--danger"
              onClick={() => setShowDeleteAllModal(true)}
              disabled={cards.length === 0 || deletingAll}
              type="button"
              aria-label="Delete all flashcards"
              title="Delete all flashcards"
            >
              <Trash2 size={17} />
            </button>
          </div>
        </div>
        <div className="progress-track flash-progress">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </header>

      {actionError ? <div className="form-error flash-error">{actionError}</div> : null}

      <main className="flash-wrap">
        <div className="flash-meta">
          <span className="pill">
            Card {index + 1} of {cards.length}
          </span>
          <span className="pill">Difficulty {current.difficulty}</span>
        </div>
        <button className={`flip-card ${flipped ? "flipped" : ""}`} onClick={() => setFlipped(!flipped)} type="button">
          <div className="flip-inner">
            <Card className="flip-face flip-front">
              <span className="eyebrow">Question</span>
              <div className="flashcard-face-md">
                <MarkdownContent content={current.front} />
              </div>
            </Card>
            <Card className="flip-face flip-back">
              <span className="eyebrow">Answer</span>
              <div className="flashcard-face-md">
                <MarkdownContent content={current.back} />
              </div>
            </Card>
          </div>
        </button>

        <div className="flash-controls">
          <button
            className="flash-nav-btn"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            type="button"
            aria-label="Previous card"
          >
            <ChevronLeft size={20} />
          </button>
          <p className="flash-hint">{flipped ? "How well did you know it?" : "Tap the card to flip it"}</p>
          <button
            className="flash-nav-btn"
            onClick={() => goTo(index + 1)}
            disabled={index >= cards.length - 1}
            type="button"
            aria-label="Next card"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="flash-confidence-zone">
          {flipped ? (
            <div className="confidence-row">
              <button className="confidence confidence--hard" onClick={() => mark(false)} type="button">
                <span className="confidence-icon"><XCircle size={20} /></span>
                <span className="confidence-label">Hard</span>
                <span className="confidence-sub">Study again</span>
              </button>
              <button className="confidence confidence--medium" onClick={() => mark(false)} type="button">
                <span className="confidence-icon"><AlertCircle size={20} /></span>
                <span className="confidence-label">Medium</span>
                <span className="confidence-sub">Almost</span>
              </button>
              <button className="confidence confidence--easy" onClick={() => mark(true)} type="button">
                <span className="confidence-icon"><CheckCircle2 size={20} /></span>
                <span className="confidence-label">Easy</span>
                <span className="confidence-sub">Got it</span>
              </button>
            </div>
          ) : null}
        </div>

        <p className="flash-kbd-hint">Space flips the card. Arrow keys move between cards.</p>
      </main>

      {showDeleteAllModal ? (
        <ConfirmModal
          title="Delete All Flashcards"
          message="This permanently removes all flashcards in this folder. This cannot be undone."
          confirmLabel={deletingAll ? "Deleting…" : "Delete All"}
          danger
          onConfirm={() => void handleDeleteAllFlashcards()}
          onCancel={() => setShowDeleteAllModal(false)}
        />
      ) : null}
    </div>
  );
}
