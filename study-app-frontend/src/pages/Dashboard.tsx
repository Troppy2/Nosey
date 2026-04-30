import { BookOpen, Brain, Edit3, FolderOpen, Plus, Trash2, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { deleteTest, fetchFlashcards, fetchFolders, fetchTests, updateTest } from "../lib/api";
import { formatDate, formatPercent } from "../lib/format";
import type { Flashcard, Folder, TestSummary } from "../lib/types";

const TYPE_START_DELAY_MS = 3000;
const TYPE_ROTATE_INTERVAL_MS = 5 * 60 * 1000;
const TYPE_STEP_MS = 28;

const OTHER_MESSAGES = [
  "Stop doom scrolling and get to studying bud",
  "Studying first doom scrolling later!",
  "Did you drink water yet?",
  "Time to lock in man",
  "Look who it is",
  "Put ur phone away and start practicing",
  "Time to study perchance",
  "Put your phone on DND and get to work!",
];

function getTimeOfDayMessage(now = new Date()) {
  const hour = now.getHours();
  if (hour < 12) return "Good morning, my goat, time to study!";
  if (hour < 18) return "Good afternoon my goat study time!";
  return "Good evening my goat study time!";
}

function getMessageQueue() {
  return [getTimeOfDayMessage(), ...OTHER_MESSAGES];
}

export default function Dashboard() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tests, setTests] = useState<TestSummary[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [displayTitle, setDisplayTitle] = useState("Your study cockpit");
  const displayTitleRef = useRef(displayTitle);

  useEffect(() => {
    displayTitleRef.current = displayTitle;
  }, [displayTitle]);

  useEffect(() => {
    Promise.all([fetchFolders(), fetchTests(), fetchFlashcards()])
      .then(([folderData, testData, flashcardData]) => {
        setFolders(folderData);
        setTests(testData);
        setFlashcards(flashcardData);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Unable to load your study data.");
      })
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    let isActive = true;
    const timers = new Set<number>();

    function clearTimers() {
      timers.forEach((timerId) => window.clearTimeout(timerId));
      timers.clear();
    }

    function typeText(targetText: string, onComplete?: () => void) {
      let index = 0;

      function step() {
        if (!isActive) return;
        setDisplayTitle(targetText.slice(0, index));
        if (index <= targetText.length) {
          const timerId = window.setTimeout(() => {
            index += 1;
            step();
          }, TYPE_STEP_MS);
          timers.add(timerId);
        } else if (onComplete) {
          onComplete();
        }
      }

      step();
    }

    function eraseAndType(nextText: string) {
      const currentText = displayTitleRef.current;

      function erase(index: number) {
        if (!isActive) return;
        setDisplayTitle(currentText.slice(0, index));
        if (index > 0) {
          const timerId = window.setTimeout(() => erase(index - 1), TYPE_STEP_MS);
          timers.add(timerId);
        } else {
          typeText(nextText);
        }
      }

      erase(currentText.length);
    }

    const startTimer = window.setTimeout(() => {
      if (!isActive) return;
      eraseAndType(getMessageQueue()[0]);

      let messageIndex = 1;
      const rotate = () => {
        if (!isActive) return;
        const queue = getMessageQueue();
        eraseAndType(queue[messageIndex % queue.length]);
        messageIndex += 1;
        const rotateTimer = window.setTimeout(rotate, TYPE_ROTATE_INTERVAL_MS);
        timers.add(rotateTimer);
      };

      const rotateTimer = window.setTimeout(rotate, TYPE_ROTATE_INTERVAL_MS);
      timers.add(rotateTimer);
    }, TYPE_START_DELAY_MS);

    timers.add(startTimer);

    return () => {
      isActive = false;
      clearTimers();
    };
  }, []);

  const stats = useMemo(() => {
    const attempts = tests.reduce((sum, test) => sum + test.attempt_count, 0);
    const scored = tests.filter((test) => typeof test.best_score === "number");
    const average =
      scored.length > 0
        ? Math.round(scored.reduce((sum, test) => sum + (test.best_score ?? 0), 0) / scored.length)
        : null;
    return [
      { label: "Tests Taken", value: attempts.toString(), icon: BookOpen },
      { label: "Cards Reviewed", value: flashcards.reduce((sum, card) => sum + card.attempt_count, 0).toString(), icon: Brain },
      { label: "Average Score", value: average ? `${average}%` : "New", icon: TrendingUp },
    ];
  }, [flashcards, tests]);

  const weakCards = [...flashcards].sort((a, b) => b.difficulty - a.difficulty).slice(0, 3);

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
      setError(null);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Unable to rename that test.");
    }
  }

  async function handleDeleteTest(test: TestSummary) {
    if (!window.confirm(`Delete ${test.title}? This cannot be undone.`)) return;
    try {
      await deleteTest(test.id);
      setTests((current) => current.filter((item) => item.id !== test.id));
      setError(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete that test.");
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Dashboard</span>
          <h1 aria-live="polite">{displayTitle || " "}</h1>
          <p className="muted">Recent tests, active folders, and weak concepts in one place.</p>
        </div>
        <Link to="/create-test">
          <Button icon={<Plus size={18} />}>New Test</Button>
        </Link>
      </header>

      {error ? <div className="form-error">{error}</div> : null}

      {isLoading ? (
        <div className="centered-block">
          <span className="loader" />
        </div>
      ) : (
        <>
          <section className="grid grid-3 stat-grid">
            {stats.map((stat) => {
              const Icon = stat.icon;
              return (
                <Card key={stat.label} interactive tone="soft" className="stat-card">
                  <div>
                    <Icon size={23} />
                    <span>{stat.label}</span>
                  </div>
                  <strong>{stat.value}</strong>
                </Card>
              );
            })}
          </section>

          <div className="dashboard-layout">
            <div className="dashboard-main">
              <section>
                <div className="section-title">
                  <h2>Folders</h2>
                  <Link className="text-link" to="/folders">
                    View all
                  </Link>
                </div>
                <div className="grid grid-2">
                  {folders.slice(0, 4).map((folder) => (
                    <Link key={folder.id} to={`/folders/${folder.id}`}>
                      <Card interactive className="folder-mini">
                        <FolderOpen size={25} style={{ color: folder.color ?? "var(--green-dark)" }} />
                        <div>
                          <h3>{folder.name}</h3>
                          <p className="muted small">{folder.subject ?? "General"}</p>
                          <div className="mini-meta">
                            <span>{folder.test_count} tests</span>
                            <span>{folder.flashcard_count} cards</span>
                          </div>
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>

              <section>
                <div className="section-title">
                  <h2>Recent Tests</h2>
                  <Link className="text-link" to="/create-test">
                    Create one
                  </Link>
                </div>
                {tests.length === 0 ? (
                  <EmptyState
                    icon={<BookOpen />}
                    title="No tests yet"
                    body="Upload notes to generate your first practice test."
                    action={
                      <Link to="/create-test">
                        <Button>Create Test</Button>
                      </Link>
                    }
                  />
                ) : (
                  <div className="test-list">
                    {tests.slice(0, 4).map((test) => (
                      <Card key={test.id} interactive className="test-row">
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
                          <button aria-label={`Rename ${test.title}`} onClick={() => handleRenameTest(test)} type="button">
                            <Edit3 size={17} />
                          </button>
                          <button aria-label={`Delete ${test.title}`} onClick={() => handleDeleteTest(test)} type="button">
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <aside>
              <div className="section-title">
                <h2>Review These</h2>
                <Link className="text-link" to="/flashcards">
                  Study
                </Link>
              </div>
              <div className="weak-stack">
                {weakCards.length === 0 ? (
                  <EmptyState
                    icon={<Brain />}
                    title="No flashcards yet"
                    body="Create a test or add flashcards to see weak topics here."
                    action={
                      <Link to="/create-test">
                        <Button variant="secondary">Create Test</Button>
                      </Link>
                    }
                  />
                ) : (
                  weakCards.map((card) => (
                    <Card key={card.id} tone="dark" interactive className="weak-card">
                      <span className="pill dark-pill">Difficulty {card.difficulty}</span>
                      <h3>{card.front}</h3>
                      <p>{Math.round((card.success_rate ?? 0) * 100)}% recall rate</p>
                    </Card>
                  ))
                )}
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
