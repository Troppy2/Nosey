import { ArrowLeft, Check, ListChecks, Puzzle, RotateCcw, Sparkles, Target, Trophy } from "lucide-react";
import type { CSSProperties } from "react";
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

type Phase = "loading" | "setup" | "playing" | "roundClear" | "complete";
type DeckId = "struggling" | "unseen" | "all" | "custom";

const MISMATCH_MS = 700;
const ROUND_CLEAR_MS = 950;

/** Board sizes, in pairs. A board must fit the viewport without scrolling, so
 *  this is a hard ceiling rather than a suggestion: 6 pairs is 12 tiles, which
 *  is the most that stays readable at laptop height. */
const BOARD_SIZES = [4, 5, 6] as const;
const DEFAULT_BOARD_SIZE = 5;

/** A card counts as struggling on evidence, not on one unlucky tap: it has to
 *  have been attempted at least twice and missed more than half the time.
 *  Never-attempted cards are not struggling, they are unseen, and they get
 *  their own deck. */
const STRUGGLING_MIN_ATTEMPTS = 2;
const STRUGGLING_MAX_RATE = 0.5;

/** Tile counts are always even and bounded by BOARD_SIZES, so the column count
 *  can be chosen to divide evenly and never leave a ragged final row. */
const COLUMNS_FOR_TILES: Record<number, number> = { 4: 2, 6: 3, 8: 4, 10: 5, 12: 4 };

function columnsForTiles(count: number): number {
  return COLUMNS_FOR_TILES[count] ?? Math.max(2, Math.ceil(Math.sqrt(count)));
}

/** Grid shape as CSS custom properties. The board's size ceilings are derived
 *  from these, so the tiles stay card-shaped instead of stretching to fill a
 *  tall viewport. */
function boardVars(tileCount: number): Record<string, number> {
  const cols = columnsForTiles(tileCount);
  return { "--match-cols": cols, "--match-rows": Math.max(1, Math.ceil(tileCount / cols)) };
}

function isStruggling(card: Flashcard): boolean {
  return (
    card.attempt_count >= STRUGGLING_MIN_ATTEMPTS &&
    card.success_rate != null &&
    card.success_rate < STRUGGLING_MAX_RATE
  );
}

function isUnseen(card: Flashcard): boolean {
  return card.attempt_count === 0;
}

// Split a deck into rounds of at most `size` pairs. Sizes are balanced rather
// than greedy, so a 11-card deck at size 5 gives 6 + 5 instead of 5 + 5 + 1,
// and no round is left as a lonely single pair.
function planRoundSizes(total: number, size: number): number[] {
  if (total <= 0) return [];
  if (total <= size) return [total];
  const rounds = Math.ceil(total / size);
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

/** Plain-text preview of a card front, for the picker list. */
function preview(text: string, max = 90): string {
  const flat = text.replace(/[#*_`>\[\]]/g, "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}...` : flat;
}

export default function Matching() {
  const { folderId } = useParams();
  const numericFolderId = folderId ? Number(folderId) : null;
  const { betaMode } = useSettings();

  const [folder, setFolder] = useState<Folder | null>(null);
  const [allCards, setAllCards] = useState<Flashcard[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");

  // Setup choices.
  const [deckId, setDeckId] = useState<DeckId>("struggling");
  const [boardSize, setBoardSize] = useState<number>(DEFAULT_BOARD_SIZE);
  const [customIds, setCustomIds] = useState<Set<number>>(new Set());

  // Run state.
  const [rounds, setRounds] = useState<Flashcard[][]>([]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [matchedCards, setMatchedCards] = useState<Set<number>>(new Set());
  const [mismatchKeys, setMismatchKeys] = useState<string[]>([]);
  const [moves, setMoves] = useState(0);
  const [firstTryMatches, setFirstTryMatches] = useState(0);
  const [deckCount, setDeckCount] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [finalTime, setFinalTime] = useState(0);
  const [bestTime, setBestTime] = useState<number | null>(null);
  const [newRecord, setNewRecord] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missedIds, setMissedIds] = useState<number[]>([]);

  const startRef = useRef(0);
  const selectStartRef = useRef(0);
  const mistakesRef = useRef<Record<number, number>>({});
  // Missed cards for the whole run, not just the current round, so the results
  // screen can offer to drill exactly what went wrong.
  const runMissesRef = useRef<Set<number>>(new Set());
  const lockRef = useRef(false);

  const bestKey = numericFolderId != null ? scopeKey(`nosey_matching_best_${numericFolderId}`) : "";
  const sizeKey = scopeKey("nosey_matching_board_size");

  const struggling = useMemo(() => allCards.filter(isStruggling), [allCards]);
  const unseen = useMemo(() => allCards.filter(isUnseen), [allCards]);

  const decks = useMemo(
    () => [
      {
        id: "struggling" as DeckId,
        title: "Cards you keep missing",
        blurb: "Attempted twice or more, right less than half the time. Worst first.",
        icon: Target,
        count: struggling.length,
      },
      {
        id: "unseen" as DeckId,
        title: "Cards you have not tried",
        blurb: "Never attempted in any mode.",
        icon: Sparkles,
        count: unseen.length,
      },
      {
        id: "all" as DeckId,
        title: "The whole class",
        blurb: "Every card, easiest first so it ramps up.",
        icon: Puzzle,
        count: allCards.length,
      },
      {
        id: "custom" as DeckId,
        title: "Pick them yourself",
        blurb: "Choose exactly which cards go on the board.",
        icon: ListChecks,
        count: customIds.size,
      },
    ],
    [struggling.length, unseen.length, allCards.length, customIds.size],
  );

  const buildDeck = useCallback(
    (id: DeckId): Flashcard[] => {
      switch (id) {
        case "struggling":
          // Worst success rate first, so the hardest cards are seen while the
          // player is still fresh.
          return [...struggling].sort((a, b) => (a.success_rate ?? 0) - (b.success_rate ?? 0));
        case "unseen":
          return shuffle(unseen);
        case "custom":
          return shuffle(allCards.filter((c) => customIds.has(c.id)));
        case "all":
        default:
          // Easiest first so difficulty ramps across rounds.
          return [...allCards].sort((a, b) => a.difficulty - b.difficulty);
      }
    },
    [allCards, struggling, unseen, customIds],
  );

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

  // Start a run from an explicit list of cards.
  const startRun = useCallback(
    (cards: Flashcard[]) => {
      const sizes = planRoundSizes(cards.length, boardSize);
      const built: Flashcard[][] = [];
      let cursor = 0;
      for (const size of sizes) {
        built.push(shuffle(cards.slice(cursor, cursor + size)));
        cursor += size;
      }
      setRounds(built);
      setDeckCount(cards.length);
      setRoundIndex(0);
      setMoves(0);
      setFirstTryMatches(0);
      setNewRecord(false);
      setMissedIds([]);
      runMissesRef.current = new Set();
      startRef.current = Date.now();
      setElapsed(0);
      if (built.length === 0) {
        setPhase("setup");
        return;
      }
      startRound(0, built);
    },
    [boardSize, startRound],
  );

  // Load the class and its cards, then stop at the setup screen. The game no
  // longer auto-starts: choosing the deck is the point.
  useEffect(() => {
    if (numericFolderId == null) return;
    let active = true;
    setPhase("loading");
    Promise.all([fetchFolders().catch(() => [] as Folder[]), fetchFlashcards(numericFolderId)])
      .then(([folders, cards]) => {
        if (!active) return;
        setFolder(folders.find((f) => f.id === numericFolderId) ?? null);
        setAllCards(cards);
        const storedBest = localStorage.getItem(bestKey);
        setBestTime(storedBest !== null ? Number(storedBest) : null);
        const storedSize = Number(localStorage.getItem(sizeKey));
        if (BOARD_SIZES.includes(storedSize as (typeof BOARD_SIZES)[number])) setBoardSize(storedSize);
        // Land on a deck that actually has cards in it.
        const strugglingCount = cards.filter(isStruggling).length;
        const unseenCount = cards.filter(isUnseen).length;
        setDeckId(strugglingCount >= 2 ? "struggling" : unseenCount >= 2 ? "unseen" : "all");
        setPhase("setup");
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(err instanceof Error ? err.message : "Could not load this class.");
        setPhase("setup");
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericFolderId]);

  // Live timer, frozen once the run completes.
  useEffect(() => {
    if (phase === "loading" || phase === "setup" || phase === "complete") return;
    const id = window.setInterval(() => setElapsed(Date.now() - startRef.current), 200);
    return () => window.clearInterval(id);
  }, [phase]);

  const finishGame = useCallback(() => {
    const total = Date.now() - startRef.current;
    setFinalTime(total);
    setElapsed(total);
    setMissedIds([...runMissesRef.current]);
    setPhase("complete");
    if (bestTime == null || total < bestTime) {
      setBestTime(total);
      setNewRecord(true);
      if (bestKey) localStorage.setItem(bestKey, String(total));
    }
  }, [bestTime, bestKey]);

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

    mistakesRef.current[first.cardId] = (mistakesRef.current[first.cardId] ?? 0) + 1;
    mistakesRef.current[tile.cardId] = (mistakesRef.current[tile.cardId] ?? 0) + 1;
    runMissesRef.current.add(first.cardId);
    runMissesRef.current.add(tile.cardId);
    lockRef.current = true;
    setMismatchKeys([first.key, tile.key]);
    window.setTimeout(() => {
      setMismatchKeys([]);
      setSelectedKey(null);
      lockRef.current = false;
    }, MISMATCH_MS);
  }

  const accuracy = deckCount > 0 ? Math.round((firstTryMatches / deckCount) * 100) : 0;
  const roundCount = rounds.length;
  const activeDeck = decks.find((d) => d.id === deckId);
  const selectedTile = selectedKey ? tiles.find((t) => t.key === selectedKey) ?? null : null;

  if (numericFolderId == null) return <Navigate to="/flashcards" replace />;
  if (!betaMode) return <Navigate to={`/flashcards/${numericFolderId}`} replace />;

  if (phase === "loading") {
    return (
      <div className="match-screen">
        <div className="match-rail">
          <Skeleton width="140px" height="1rem" />
        </div>
        <div className="progress-track match-progress">
          <div className="progress-fill" style={{ width: "0%" }} />
        </div>
        <div className="match-board-wrap">
          <div className="match-board" style={boardVars(10) as unknown as CSSProperties} role="status" aria-label="Loading">
            {Array.from({ length: 10 }, (_, i) => (
              <div className="skel-match-tile" key={i} aria-hidden="true">
                <Skeleton width={`${[64, 48, 72, 44, 58, 68, 40, 62, 52, 70][i]}%`} height="0.8rem" />
                <Skeleton width="34%" height="0.65rem" />
              </div>
            ))}
          </div>
        </div>
        <p className="match-strip muted">Loading your cards.</p>
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

  if (phase === "setup" && allCards.length < 2) {
    return (
      <div className="page page-narrow">
        <EmptyState
          icon={<Puzzle />}
          title="Not enough cards to match"
          body="Matching needs at least two flashcards in this class. Add or generate some, then come back."
          action={
            <Link to={`/flashcards/${numericFolderId}`}>
              <Button>Back to modes</Button>
            </Link>
          }
        />
      </div>
    );
  }

  // ---------------- Setup ----------------
  if (phase === "setup") {
    const chosen = buildDeck(deckId);
    const canStart = chosen.length >= 2;
    const roundPlan = planRoundSizes(chosen.length, boardSize);

    return (
      <div className="match-setup-screen">
        <div className="match-setup">
          <div className="match-setup-head">
            <Link
              className="flash-back-btn"
              to={`/flashcards/${numericFolderId}`}
              aria-label="Back to modes"
              title="Back to modes"
            >
              <ArrowLeft size={18} />
            </Link>
            <p className="match-setup-folder">{folder?.name ?? "Matching"}</p>
          </div>

          <h1 className="match-setup-title">What do you want to drill?</h1>

          <div className="match-deck-grid">
            {decks.map((deck) => {
              const Icon = deck.icon;
              const isPicker = deck.id === "custom";
              const empty = deck.count < 2 && !isPicker;
              return (
                <button
                  key={deck.id}
                  type="button"
                  className={`match-deck${deckId === deck.id ? " is-active" : ""}`}
                  disabled={empty}
                  onClick={() => setDeckId(deck.id)}
                >
                  <Icon size={18} className="match-deck-icon" />
                  <span className="match-deck-title">{deck.title}</span>
                  <span className="match-deck-blurb">{deck.blurb}</span>
                  <span className="match-deck-count">
                    {empty
                      ? "Nothing here yet"
                      : isPicker && deck.count === 0
                        ? "Choose cards"
                        : `${deck.count} card${deck.count === 1 ? "" : "s"}`}
                  </span>
                </button>
              );
            })}
          </div>

          {deckId === "custom" ? (
            <div className="match-picker">
              <div className="match-picker-head">
                <span>
                  {customIds.size} of {allCards.length} chosen
                </span>
                <div className="match-picker-actions">
                  <button type="button" onClick={() => setCustomIds(new Set(allCards.map((c) => c.id)))}>
                    Select all
                  </button>
                  <button type="button" onClick={() => setCustomIds(new Set())}>
                    Clear
                  </button>
                </div>
              </div>
              {/* The only scrolling surface in the whole mode, and it is a list,
                  not the board. */}
              <ul className="match-picker-list">
                {allCards.map((card) => {
                  const on = customIds.has(card.id);
                  return (
                    <li key={card.id}>
                      <button
                        type="button"
                        className={`match-picker-item${on ? " is-on" : ""}`}
                        onClick={() =>
                          setCustomIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(card.id)) next.delete(card.id);
                            else next.add(card.id);
                            return next;
                          })
                        }
                        aria-pressed={on}
                      >
                        <span className="match-picker-check">{on ? <Check size={13} /> : null}</span>
                        <span className="match-picker-text">{preview(card.front)}</span>
                        {isStruggling(card) ? <span className="match-picker-flag">missed</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <div className="match-size">
            <span className="match-size-label">Pairs on the board</span>
            <div className="match-size-options" role="group" aria-label="Pairs on the board">
              {BOARD_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`match-size-btn${boardSize === size ? " is-active" : ""}`}
                  aria-pressed={boardSize === size}
                  onClick={() => {
                    setBoardSize(size);
                    localStorage.setItem(sizeKey, String(size));
                  }}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          <div className="match-setup-foot">
            <Button disabled={!canStart} onClick={() => startRun(chosen)}>
              Start matching
            </Button>
            <p className="match-setup-note">
              {canStart
                ? `${chosen.length} cards, ${roundPlan.length} round${roundPlan.length === 1 ? "" : "s"}.`
                : "Choose at least two cards."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---------------- Results ----------------
  if (phase === "complete") {
    const missedCards = allCards.filter((c) => missedIds.includes(c.id));
    return (
      <div className="page page-narrow">
        <Card className="match-results">
          <span className="match-results-badge">
            <Trophy size={44} />
          </span>
          <h1>Board cleared</h1>
          <p className="muted">
            {deckCount} card{deckCount === 1 ? "" : "s"} from {activeDeck?.title.toLowerCase() ?? "your deck"},
            across {roundCount} round{roundCount === 1 ? "" : "s"}.
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
            {missedCards.length >= 2 ? (
              <Button icon={<Target size={18} />} onClick={() => startRun(shuffle(missedCards))}>
                Drill the {missedCards.length} you missed
              </Button>
            ) : (
              <Button icon={<RotateCcw size={18} />} onClick={() => startRun(buildDeck(deckId))}>
                Play again
              </Button>
            )}
            <Button variant="secondary" onClick={() => setPhase("setup")}>
              Change deck
            </Button>
            <Link to={`/flashcards/${numericFolderId}`}>
              <Button variant="secondary">Back to modes</Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // ---------------- Board ----------------
  const roundSize = rounds[roundIndex]?.length ?? 0;
  const clearedThisRound = matchedCards.size;

  return (
    <div className="match-screen">
      {/* One thin rail. Every pixel not spent here is a pixel the board gets. */}
      <header className="match-rail">
        <Link
          className="match-rail-back"
          to={`/flashcards/${numericFolderId}`}
          aria-label="Back to modes"
          title="Back to modes"
        >
          <ArrowLeft size={17} />
        </Link>
        <span className="match-rail-deck">{activeDeck?.title ?? "Matching"}</span>
        <span className="match-rail-round">
          Round {roundIndex + 1} of {roundCount}
        </span>
        <span className="match-rail-spacer" />
        <span className="match-rail-stat">{formatTime(elapsed)}</span>
        <span className="match-rail-stat match-rail-stat--quiet">{moves} moves</span>
      </header>

      <div className="progress-track match-progress">
        <div
          className="progress-fill"
          style={{ width: `${roundSize ? (clearedThisRound / roundSize) * 100 : 0}%` }}
        />
      </div>

      <main className={`match-board-wrap ${phase === "roundClear" ? "is-clearing" : ""}`}>
        <div className="match-board" style={boardVars(tiles.length) as unknown as CSSProperties}>
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

      {/* The hint line doubles as the reader: tiles clamp long definitions, and
          the one you have selected is shown here in full. */}
      <div className={`match-strip${selectedTile ? " is-reading" : ""}`} aria-live="polite">
        {selectedTile ? (
          <>
            <span className="match-strip-side">{selectedTile.side === "front" ? "Term" : "Definition"}</span>
            <span className="match-strip-text">
              <MarkdownContent content={selectedTile.text} />
            </span>
          </>
        ) : (
          <span className="muted">Tap a term, then tap its matching definition.</span>
        )}
      </div>
    </div>
  );
}
