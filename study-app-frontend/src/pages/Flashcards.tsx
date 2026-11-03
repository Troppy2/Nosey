import { FolderIcon } from "../icons";
import { AlertIcon, ArrowLeftIcon, CheckCircleIcon, ChevronLeftIcon, ChevronRightIcon, CrossCircleIcon, RetryIcon, TrashIcon } from "../icons";
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { FormError } from "../components/FormError";
import { Card } from "../components/Card";
import { ConfirmModal } from "../components/ConfirmModal";
import { EmptyState } from "../components/EmptyState";
import { FeatureSurvey } from "../components/FeatureSurvey";
import { MarkdownContent } from "../components/MarkdownContent";
import { SkeletonFlashcard, SkeletonFolderGrid } from "../components/Skeletons";
import { deleteFlashcard, fetchFlashcards, fetchFolders, isGuestSession, recordFlashcardAttempt } from "../lib/api";
import { formatNextInterval, type FlashcardRating } from "../lib/flashcardSchedule";
import { toast } from "../lib/toast";
import type { Flashcard, Folder } from "../lib/types";
import { usePageTour } from "../components/tours/usePageTour";

const RATING_KEYS: Record<string, FlashcardRating> = { "1": "hard", "2": "medium", "3": "easy" };

type PendingRating = { folderId: number; cardId: number; rating: FlashcardRating; timeMs: number };

function getCardStatePill(card: Flashcard, lapsed: boolean): string {
  if (lapsed) return "Again soon";
  if (card.is_due) return "Due";
  if (card.is_new) return "New";
  if (card.interval_days) return `Next in ${card.interval_days}d`;
  if (card.due_at) {
    const days = Math.max(1, Math.round((new Date(card.due_at).getTime() - Date.now()) / (86400 * 1000)));
    return `Next in ${days}d`;
  }
  return "Next in 1d";
}

function formatRelativeSoonestDue(cardsList: Flashcard[]): string {
  const futureDues = cardsList
    .filter((c) => c.due_at && new Date(c.due_at).getTime() > Date.now())
    .map((c) => new Date(c.due_at!).getTime());
  if (futureDues.length === 0) return "in 1 day";
  const minTime = Math.min(...futureDues);
  const diffMs = minTime - Date.now();
  const diffMins = Math.round(diffMs / (60 * 1000));
  if (diffMins <= 60) return `in ${Math.max(1, diffMins)} minute${diffMins === 1 ? "" : "s"}`;
  const diffHours = Math.round(diffMs / (3600 * 1000));
  if (diffHours < 24) return `in ${Math.max(1, diffHours)} hour${diffHours === 1 ? "" : "s"}`;
  const diffDays = Math.round(diffMs / (86400 * 1000));
  return `in ${Math.max(1, diffDays)} day${diffDays === 1 ? "" : "s"}`;
}

export default function Flashcards() {
  const { folderId } = useParams();
  const [searchParams] = useSearchParams();
  const cardParam = searchParams.get("card");
  const initialFolderId = folderId ? Number(folderId) : null;
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(initialFolderId);
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [sessionSize, setSessionSize] = useState(0);
  const [clearedCardIds, setClearedCardIds] = useState<Set<number>>(new Set());
  const [lapsedInSession, setLapsedInSession] = useState<Set<number>>(new Set());
  const [flipped, setFlipped] = useState(false);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [loadingCards, setLoadingCards] = useState(initialFolderId != null);
  const activeToastIdRef = useRef<number | null>(null);
  // Ratings the server has not accepted yet. They outlive the toast, so a
  // toast timing out never drops one; the next Retry resends all of them.
  const pendingRatingsRef = useRef<PendingRating[]>([]);
  // Id of the card just rated. Blocks a second rating of the same card before
  // the queue update re-renders (fast double press or click).
  const ratingCardIdRef = useRef<number | null>(null);

  useEffect(() => {
    fetchFolders()
      .then(setFolders)
      .catch(() => setFolders([]))
      .finally(() => setLoadingFolders(false));
  }, []);

  const current = queue[0] ?? null;

  // Rotates the queue without rating: -1 brings the last card to the front, 1 sends the current card to the back.
  function step(direction: -1 | 1) {
    setQueue((q) => {
      if (q.length <= 1) return q;
      return direction === 1 ? [...q.slice(1), q[0]] : [q[q.length - 1], ...q.slice(0, -1)];
    });
    setFlipped(false);
    setStartedAt(Date.now());
  }

  // Swaps in the card the server sent back so interval hints, the due/new
  // counts and the "Next review" line use the fresh schedule.
  function applyServerCard(updated: Flashcard) {
    const swap = (list: Flashcard[]) => list.map((c) => (c.id === updated.id ? updated : c));
    setCards(swap);
    setQueue(swap);
  }

  function showRetryToast() {
    if (activeToastIdRef.current != null) {
      toast.dismiss(activeToastIdRef.current);
    }
    const count = pendingRatingsRef.current.length;
    activeToastIdRef.current = toast.error(
      count === 1 ? "Couldn't save that rating" : `Couldn't save ${count} ratings`,
      undefined,
      { label: "Retry", onClick: () => void retryPendingRatings() },
    );
  }

  async function sendRating(entry: PendingRating): Promise<boolean> {
    try {
      const updated = await recordFlashcardAttempt(entry.folderId, entry.cardId, entry.rating, entry.timeMs);
      applyServerCard(updated);
      return true;
    } catch {
      pendingRatingsRef.current.push(entry);
      return false;
    }
  }

  // Resends in order, one at a time, so two ratings of the same card reach
  // the scheduler in the order they were given.
  async function retryPendingRatings() {
    activeToastIdRef.current = null;
    const batch = pendingRatingsRef.current;
    pendingRatingsRef.current = [];
    let failed = false;
    for (const entry of batch) {
      if (!(await sendRating(entry))) failed = true;
    }
    if (failed) showRetryToast();
  }

  function mark(rating: FlashcardRating) {
    if (!current || ratingCardIdRef.current === current.id) return;
    ratingCardIdRef.current = current.id;
    const cardToSave = current;
    const timeMs = Date.now() - startedAt;

    setFlipped(false);
    setStartedAt(Date.now());

    if (rating === "hard") {
      setLapsedInSession((prev) => new Set(prev).add(cardToSave.id));
      setQueue((prevQueue) => {
        const remaining = prevQueue.slice(1);
        const insertIdx = Math.min(4, remaining.length);
        return [
          ...remaining.slice(0, insertIdx),
          cardToSave,
          ...remaining.slice(insertIdx),
        ];
      });
    } else {
      setClearedCardIds((prev) => new Set(prev).add(cardToSave.id));
      setQueue((prevQueue) => prevQueue.slice(1));
    }

    void sendRating({ folderId: cardToSave.folder_id, cardId: cardToSave.id, rating, timeMs }).then((ok) => {
      if (!ok) showRetryToast();
    });
  }

  // The queue changed, so whatever card is in front now can be rated, even
  // the same hard card again when it is the only one left.
  useEffect(() => {
    ratingCardIdRef.current = null;
  }, [queue]);

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

      const isArrow = event.key.startsWith("Arrow");
      // A held key repeats keydown: let arrows scroll through cards, but never
      // re-flip or re-rate from auto-repeat.
      if (event.repeat && !isArrow) {
        return;
      }

      const rating = RATING_KEYS[event.key];
      if (flipped && rating) {
        event.preventDefault();
        mark(rating);
        return;
      }

      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        setFlipped((currentFlipped) => !currentFlipped);
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
        event.preventDefault();
        step(-1);
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowUp") {
        event.preventDefault();
        step(1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [flipped, showDeleteAllModal, current, startedAt]);

  useEffect(() => {
    setSelectedFolderId(folderId ? Number(folderId) : null);
  }, [folderId]);

  useEffect(() => {
    if (selectedFolderId == null) {
      setCards([]);
      setQueue([]);
      setSessionSize(0);
      setClearedCardIds(new Set());
      setLapsedInSession(new Set());
      setFlipped(false);
      setStartedAt(Date.now());
      setLoadingCards(false);
      return;
    }

    setLoadingCards(true);
    fetchFlashcards(selectedFolderId)
      .then((data) => {
        setCards(data);
        setSessionSize(data.length);
        setClearedCardIds(new Set());
        setLapsedInSession(new Set());
        setFlipped(false);
        setStartedAt(Date.now());

        if (cardParam) {
          const targetId = Number(cardParam);
          const targetIndex = data.findIndex((c) => c.id === targetId);
          if (targetIndex > 0) {
            setQueue([data[targetIndex], ...data.slice(0, targetIndex), ...data.slice(targetIndex + 1)]);
            return;
          }
        }
        setQueue(data);
      })
      .finally(() => setLoadingCards(false));
  }, [selectedFolderId, cardParam]);

  const selectedFolder = folders.find((folder) => folder.id === selectedFolderId) ?? null;
  const progress = sessionSize ? (clearedCardIds.size / sessionSize) * 100 : 0;
  const complete = cards.length > 0 && queue.length === 0;
  const dueCount = cards.filter((c) => c.is_due).length;
  const newCount = cards.filter((c) => c.is_new).length;

  function reset() {
    setQueue(cards);
    setClearedCardIds(new Set());
    setLapsedInSession(new Set());
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
      setQueue([]);
      setSessionSize(0);
      setShowDeleteAllModal(false);
      reset();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to delete all flashcards.");
    } finally {
      setDeletingAll(false);
    }
  }

  usePageTour("flashcard-review", selectedFolderId != null && !loadingCards && !!current && !complete);

  if (selectedFolderId == null) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <h1>Flashcard Classes</h1>
            <p className="muted">Pick a class folder to start reviewing its flashcards.</p>
          </div>
        </header>

        {loadingFolders ? (
          <SkeletonFolderGrid count={4} label="Loading your class folders" />
        ) : folders.length === 0 ? (
          <EmptyState
            icon={<FolderIcon />}
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
                  <div>
                    <FolderIcon size={34} style={{ color: folder.color ?? "var(--green-dark)" }} />
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

  // The deck is the page, so stand in for the card face rather than telling the
  // user the class is empty before we know that it is.
  if (loadingCards) {
    return (
      <div className="page page-narrow">
        <SkeletonFlashcard />
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="page page-narrow">
        <EmptyState
          icon={<AlertIcon />}
          title={`No flashcards available for ${selectedFolder?.name ?? "this class"}`}
          body="There is nothing available for this class right now. Try another class folder."
          action={
            <Link to={selectedFolderId != null ? `/flashcards/${selectedFolderId}` : "/flashcards"}>
              <Button>Back to Modes</Button>
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
          <CheckCircleIcon size={54} />
          <h1>Session complete</h1>
          <p>Done for now. Next review: {formatRelativeSoonestDue(cards)}.</p>
          <div className="button-row">
            <Button icon={<RetryIcon size={18} />} onClick={reset}>
              Study all cards again
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

  if (!current) {
    return null;
  }

  return (
    <div className="flash-screen">
      <header className="flash-header">
        <div className="flash-header-row">
          <Link className="flash-back-btn" to={selectedFolderId != null ? `/flashcards/${selectedFolderId}` : "/flashcards"} aria-label="Back to modes" title="Back to modes">
            <ArrowLeftIcon size={18} />
          </Link>
          <div className="flash-header-title">
            <h1>{selectedFolder?.name ?? "Flashcards"}</h1>
            <p className="flash-header-sub">
              {dueCount} due, {newCount} new
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
              <RetryIcon size={17} />
            </button>
            <button
              className="flash-icon-btn flash-icon-btn--danger"
              onClick={() => setShowDeleteAllModal(true)}
              disabled={cards.length === 0 || deletingAll}
              type="button"
              aria-label="Delete all flashcards"
              title="Delete all flashcards"
            >
              <TrashIcon size={17} />
            </button>
          </div>
        </div>
        <div className="progress-track flash-progress">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <FormError message={actionError} className="flash-error" />

      <main className="flash-wrap">
        <div className="flash-meta">
          <span className="pill">
            Card {Math.min(clearedCardIds.size + 1, sessionSize)} of {sessionSize}
          </span>
          <span className="pill">{getCardStatePill(current, lapsedInSession.has(current.id))}</span>
        </div>
        <button data-tour="review-card" className={`flip-card ${flipped ? "flipped" : ""}`} onClick={() => setFlipped(!flipped)} type="button">
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

        <div className="flash-controls" data-tour="review-nav">
          <button
            className="flash-nav-btn"
            onClick={() => step(-1)}
            disabled={queue.length <= 1}
            type="button"
            aria-label="Previous card"
          >
            <ChevronLeftIcon size={20} />
          </button>
          <p className="flash-hint">{flipped ? "How well did you know it? Press 1, 2, or 3" : "Tap the card or press Space to flip"}</p>
          <button
            className="flash-nav-btn"
            onClick={() => step(1)}
            disabled={queue.length <= 1}
            type="button"
            aria-label="Next card"
          >
            <ChevronRightIcon size={20} />
          </button>
        </div>

        <div className="flash-confidence-zone">
          {flipped ? (
            <div className="confidence-row" data-tour="review-confidence">
              <button
                className="confidence confidence--hard"
                onClick={() => mark("hard")}
                type="button"
                aria-label={`Hard, repeat in ${formatNextInterval(current, "hard")}`}
              >
                <span className="confidence-icon"><CrossCircleIcon size={20} /></span>
                <span className="confidence-label">Hard</span>
                <span className="confidence-sub">{formatNextInterval(current, "hard")}</span>
              </button>
              <button
                className="confidence confidence--medium"
                onClick={() => mark("medium")}
                type="button"
                aria-label={`Medium, repeat in ${formatNextInterval(current, "medium")}`}
              >
                <span className="confidence-icon"><AlertIcon size={20} /></span>
                <span className="confidence-label">Medium</span>
                <span className="confidence-sub">{formatNextInterval(current, "medium")}</span>
              </button>
              <button
                className="confidence confidence--easy"
                onClick={() => mark("easy")}
                type="button"
                aria-label={`Easy, repeat in ${formatNextInterval(current, "easy")}`}
              >
                <span className="confidence-icon"><CheckCircleIcon size={20} /></span>
                <span className="confidence-label">Easy</span>
                <span className="confidence-sub">{formatNextInterval(current, "easy")}</span>
              </button>
            </div>
          ) : null}
        </div>

        <p className="flash-kbd-hint">Space flips. 1 Hard, 2 Medium, 3 Easy when flipped. Arrow keys move.</p>
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
