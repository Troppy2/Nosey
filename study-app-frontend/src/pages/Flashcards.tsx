import { AlertCircle, ArrowLeft, CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { fetchFlashcards, recordFlashcardAttempt } from "../lib/api";
import type { Flashcard } from "../lib/types";

export default function Flashcards() {
  const { folderId } = useParams();
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [studied, setStudied] = useState<Set<number>>(new Set());
  const [startedAt, setStartedAt] = useState(Date.now());

  useEffect(() => {
    fetchFlashcards(folderId ? Number(folderId) : undefined).then((data) => {
      setCards(data);
      setIndex(0);
      setStudied(new Set());
      setFlipped(false);
      setStartedAt(Date.now());
    });
  }, [folderId]);

  const sortedCards = useMemo(() => [...cards].sort((a, b) => b.difficulty - a.difficulty), [cards]);
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

  if (!current && cards.length === 0) {
    return (
      <div className="page page-narrow">
        <EmptyState
          icon={<AlertCircle />}
          title="No flashcards yet"
          body="Create a test or add cards in the backend to start reviewing."
          action={
            <Link to="/create-test">
              <Button>Create Test</Button>
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
        <Link className="back-link" to="/dashboard">
          <ArrowLeft size={16} />
          Dashboard
        </Link>
        <div>
          <h1>Flashcards</h1>
          <p className="muted">{remaining} cards remaining</p>
        </div>
        <Button variant="secondary" icon={<RotateCcw size={18} />} onClick={reset}>
          Reset
        </Button>
      </header>

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
    </div>
  );
}
