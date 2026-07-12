import { ArrowLeft, Puzzle, RotateCcw, Timer, Trophy, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { MarkdownContent } from "../components/MarkdownContent";
import { Skeleton } from "../components/Skeletons";
import { fetchFlashcards, fetchFolders, recordFlashcardAttempt, scopeKey } from "../lib/api";
import { useSettings } from "../lib/useSettings";
import type { Flashcard, Folder } from "../lib/types";

type Tile = {
  key: string;
  cardId: number;
  side: "front" | "back";
  text: string;
};

type Phase = "loading" | "playing" | "roundClear" | "complete";

const MISMATCH_MS = 700;
const ROUND_CLEAR_MS = 950;

// Split every card in the folder into rounds of 6 to 10 pairs so the player
// works through the whole deck. Cards arrive sorted easiest first, so later
// rounds naturally hold the harder cards (difficulty ramps as you progress).
function planRoundSizes(total: number): number[] {
  if (total <= 10) return total > 0 ? [total] : [];
  const rounds = Math.ceil(total / 10);
  const base = Math.floor(total / rounds);
  let remainder = total % rounds;
  const sizes: number[] = [];
  for (let i = 0; i < rounds; i += 1) {
    sizes.push(base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder -= 1;
  }
  return sizes;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function Matching() {
  const { folderId } = useParams();
  const numericFolderId = folderId ? Number(folderId) : null;
  const { betaMode } = useSettings();

  const [folder, setFolder] = useState<Folder | null>(null);
  const [rounds, setRounds] = useState<Flashcard[][]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [roundIndex, setRoundIndex] = useState(0);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [matchedCards, setMatchedCards] = useState<Set<number>>(new Set());
  const [mismatchKeys, setMismatchKeys] = useState<string[]>([]);
  const [moves, setMoves] = useState(0);
  const [firstTryMatches, setFirstTryMatches] = useState(0);
  const [totalCards, setTotalCards] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [finalTime, setFinalTime] = useState(0);
  const [bestTime, setBestTime] = useState<number | null>(null);
  const [newRecord, setNewRecord] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const startRef = useRef(0);
  const selectStartRef = useRef(0);
  const mistakesRef = useRef<Record<number, number>>({});
  const lockRef = useRef(false);

  const bestKey = numericFolderId != null ? scopeKey(`nosey_matching_best_${numericFolderId}`) : "";

  // Build the tile board for a round: one front tile and one back tile per card,
  // all shuffled together.
  const buildTiles = useCallback((cards: Flashcard[]): Tile[] => {
    const next: Tile[] = [];
    for (const card of cards) {
      next.push({ key: `${card.id}-front`, cardId: card.id, side: "front", text: card.front });
      next.push({ key: `${card.id}-back`, cardId: card.id, side: "back", text: card.back });
    }
    return shuffle(next);
  }, []);

  const startRound = useCallback(
    (index: number, roundList: Flashcard[][]) => {
      const cards = roundList[index] ?? [];
      setTiles(buildTiles(cards));
      setMatchedCards(new Set());
      setSelectedKey(null);
      setMismatchKeys([]);
      mistakesRef.current = {};
      lockRef.current = false;
      setPhase("playing");
    },
    [buildTiles],
  );

  // Load folder + cards, plan the rounds, kick off round one.
  useEffect(() => {
    if (numericFolderId == null) return;
    let active = true;
    setPhase("loading");
    Promise.all([fetchFolders().catch(() => [] as Folder[]), fetchFlashcards(numericFolderId)])
      .then(([folders, cards]) => {
        if (!active) return;
        setFolder(folders.find((f) => f.id === numericFolderId) ?? null);
        // Easiest first so difficulty ramps up across rounds.
        const ordered = [...cards].sort((a, b) => a.difficulty - b.difficulty);
        const sizes = planRoundSizes(ordered.length);
        const built: Flashcard[][] = [];
        let cursor = 0;
        for (const size of sizes) {
          built.push(shuffle(ordered.slice(cursor, cursor + size)));
          cursor += size;
        }
        setRounds(built);
        setTotalCards(ordered.length);
        const storedBest = localStorage.getItem(bestKey);
        setBestTime(storedBest !== null ? Number(storedBest) : null);
        if (built.length === 0) {
          setPhase("complete");
          return;
        }
        setRoundIndex(0);
        setMoves(0);
        setFirstTryMatches(0);
        setNewRecord(false);
        startRef.current = Date.now();
        setElapsed(0);
        startRound(0, built);
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : "Could not load this class.");
        setPhase("complete");
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericFolderId]);

  // Live timer, frozen once the game completes.
  useEffect(() => {
    if (phase === "loading" || phase === "complete") return;
    const id = window.setInterval(() => {
      setElapsed(Date.now() - startRef.current);
    }, 200);
    return () => window.clearInterval(id);
  }, [phase]);

  const finishGame = useCallback(() => {
    const total = Date.now() - startRef.current;
    setFinalTime(total);
    setElapsed(total);
    setPhase("complete");
    if (bestTime == null || total < bestTime) {
      setBestTime(total);
      setNewRecord(true);
      if (bestKey) localStorage.setItem(bestKey, String(total));
    }
  }, [bestTime, bestKey]);

  const handlePlayAgain = useCallback(() => {
    // Reshuffle the same deck into fresh rounds and reset the run.
    const reshuffled = rounds.map((round) => shuffle(round));
    setRounds(reshuffled);
    setRoundIndex(0);
    setMoves(0);
    setFirstTryMatches(0);
    setNewRecord(false);
    startRef.current = Date.now();
    setElapsed(0);
    startRound(0, reshuffled);
  }, [rounds, startRound]);

  const advanceRound = useCallback(() => {
    const next = roundIndex + 1;
    if (next >= rounds.length) {
      finishGame();
      return;
    }
    setRoundIndex(next);
    startRound(next, rounds);
  }, [roundIndex, rounds, startRound, finishGame]);

  function handleTileTap(tile: Tile) {
    if (lockRef.current) return;
    if (matchedCards.has(tile.cardId)) return;

    if (selectedKey == null) {
      setSelectedKey(tile.key);
      selectStartRef.current = Date.now();
      return;
    }

    if (selectedKey === tile.key) {
      setSelectedKey(null);
      return;
    }

    const first = tiles.find((t) => t.key === selectedKey);
    if (!first) {
      setSelectedKey(tile.key);
      selectStartRef.current = Date.now();
      return;
    }

    setMoves((m) => m + 1);

    if (first.cardId === tile.cardId) {
      // Correct pair. Record it as a flashcard attempt for the difficulty system.
      const clean = (mistakesRef.current[tile.cardId] ?? 0) === 0;
      if (clean) setFirstTryMatches((n) => n + 1);
      if (numericFolderId != null) {
        void recordFlashcardAttempt(
          numericFolderId,
          tile.cardId,
          clean,
          Math.max(Date.now() - selectStartRef.current, 0),
        ).catch(() => {});
      }
      setSelectedKey(null);
      setMatchedCards((prev) => new Set(prev).add(tile.cardId));
      const roundSize = rounds[roundIndex]?.length ?? 0;
      if (matchedCards.size + 1 === roundSize) {
        lockRef.current = true;
        setPhase("roundClear");
        window.setTimeout(advanceRound, ROUND_CLEAR_MS);
      }
      return;
    }

    // Wrong pair. Flash both, penalize both cards, then reset.
    mistakesRef.current[first.cardId] = (mistakesRef.current[first.cardId] ?? 0) + 1;
    mistakesRef.current[tile.cardId] = (mistakesRef.current[tile.cardId] ?? 0) + 1;
    lockRef.current = true;
    setMismatchKeys([first.key, tile.key]);
    window.setTimeout(() => {
      setMismatchKeys([]);
      setSelectedKey(null);
      lockRef.current = false;
    }, MISMATCH_MS);
  }

  const accuracy = totalCards > 0 ? Math.round((firstTryMatches / totalCards) * 100) : 0;
  const roundCount = rounds.length;

  if (numericFolderId == null) return <Navigate to="/flashcards" replace />;
  if (!betaMode) return <Navigate to={`/flashcards/${numericFolderId}`} replace />;

  // The board itself is the loading state: face-down tiles shimmering in the
  // real board grid while the deck shuffles, under the spinning puzzle piece.
  if (phase === "loading") {
    return (
      <div className="page page-narrow">
        <div className="match-loading match-loading--with-board">
          <Puzzle size={30} />
          <p className="muted">Shuffling the board.</p>
        </div>
        <div className="match-board" data-count={12} role="status" aria-label="Shuffling the board">
          {Array.from({ length: 12 }, (_, i) => (
            <div className="skel-match-tile" key={i} aria-hidden="true">
              <Skeleton width={`${[64, 48, 72, 44, 58, 68, 40, 62, 52, 70, 46, 60][i]}%`} height="0.8rem" />
              <Skeleton width="34%" height="0.65rem" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="page page-narrow">
        <EmptyState
          icon={<Puzzle />}
          title="Could not start matching"
          body={loadError}
          action={
            <Link to={`/flashcards/${numericFolderId}`}>
              <Button>Back to modes</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (phase === "complete" && totalCards === 0) {
    return (
      <div className="page page-narrow">
        <EmptyState
          icon={<Puzzle />}
          title="Nothing to match yet"
          body="This class has no flashcards. Add or generate some, then come back to play."
          action={
            <Link to={`/flashcards/${numericFolderId}`}>
              <Button>Back to modes</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (phase === "complete") {
    return (
      <div className="page page-narrow">
        <Card className="match-results">
          <span className="match-results-badge">
            <Trophy size={44} />
          </span>
          <h1>Board cleared</h1>
          <p className="muted">
            You matched all {totalCards} card{totalCards === 1 ? "" : "s"} across {roundCount} round
            {roundCount === 1 ? "" : "s"}.
          </p>

          {newRecord ? <span className="match-record-flag">New best time</span> : null}

          <div className="match-stat-row">
            <div className="match-stat">
              <span className="match-stat-label">Time</span>
              <span className="match-stat-value">{formatTime(finalTime)}</span>
            </div>
            <div className="match-stat">
              <span className="match-stat-label">Moves</span>
              <span className="match-stat-value">{moves}</span>
            </div>
            <div className="match-stat">
              <span className="match-stat-label">First-try</span>
              <span className="match-stat-value">{accuracy}%</span>
            </div>
            <div className="match-stat">
              <span className="match-stat-label">Best</span>
              <span className="match-stat-value">{bestTime != null ? formatTime(bestTime) : "-"}</span>
            </div>
          </div>

          <div className="button-row">
            <Button icon={<RotateCcw size={18} />} onClick={handlePlayAgain}>
              Play again
            </Button>
            <Link to={`/flashcards/${numericFolderId}`}>
              <Button variant="secondary">Back to modes</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const roundSize = rounds[roundIndex]?.length ?? 0;
  const clearedThisRound = matchedCards.size;

  return (
    <div className="match-screen">
      <header className="match-header">
        <div className="match-header-row">
          <Link
            className="flash-back-btn"
            to={`/flashcards/${numericFolderId}`}
            aria-label="Back to modes"
            title="Back to modes"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="match-header-title">
            <span className="eyebrow">Matching</span>
            <h1>{folder?.name ?? "Matching"}</h1>
          </div>
          <div className="match-round-pill">
            Round {roundIndex + 1}
            <span>/ {roundCount}</span>
          </div>
        </div>

        <div className="match-hud">
          <span className="match-hud-item">
            <Timer size={15} />
            <span className="match-hud-value">{formatTime(elapsed)}</span>
          </span>
          <span className="match-hud-item">
            <Zap size={15} />
            <span className="match-hud-value">{moves}</span>
            <span className="match-hud-unit">moves</span>
          </span>
          <span className="match-hud-item">
            <Trophy size={15} />
            <span className="match-hud-value">{bestTime != null ? formatTime(bestTime) : "-"}</span>
            <span className="match-hud-unit">best</span>
          </span>
        </div>
        <div className="progress-track match-progress">
          <div
            className="progress-fill"
            style={{ width: `${roundSize ? (clearedThisRound / roundSize) * 100 : 0}%` }}
          />
        </div>
      </header>

      <main className={`match-board-wrap ${phase === "roundClear" ? "is-clearing" : ""}`}>
        <div className="match-board" data-count={tiles.length}>
          {tiles.map((tile) => {
            const isMatched = matchedCards.has(tile.cardId);
            const isSelected = selectedKey === tile.key;
            const isMismatch = mismatchKeys.includes(tile.key);
            return (
              <button
                key={tile.key}
                type="button"
                className={`match-tile match-tile--${tile.side}${isSelected ? " is-selected" : ""}${
                  isMatched ? " is-matched" : ""
                }${isMismatch ? " is-mismatch" : ""}`}
                onClick={() => handleTileTap(tile)}
                disabled={isMatched}
                aria-pressed={isSelected}
              >
                <span className="match-tile-side">{tile.side === "front" ? "Term" : "Definition"}</span>
                <span className="match-tile-text">
                  <MarkdownContent content={tile.text} />
                </span>
              </button>
            );
          })}
        </div>
        {phase === "roundClear" ? (
          <div className="match-round-toast">
            Round {roundIndex + 1} cleared{roundIndex + 1 < roundCount ? ". Next up." : "."}
          </div>
        ) : null}
      </main>

      <p className="match-hint">Tap a term, then tap its matching definition.</p>
    </div>
  );
}
