import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createDailyQuiz, fetchFolderStats } from "../lib/api";
import { formatDate } from "../lib/format";
import type { FolderStats as FolderStatsData, ScorePoint, TopicStat } from "../lib/types";
import { Button } from "./Button";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { CrownIcon, ScoreRiseIcon, SproutIcon, TestsTakenIcon } from "../icons";
import { SkeletonFolderStats } from "./Skeletons";

// Shown above the stats, keyed on the backend's score trend. Always upbeat:
// a dip is framed as "this is what practice is for", never as failure.
const ENCOURAGEMENT: Record<FolderStatsData["encouragement"], { title: string; body: string }> = {
  empty: { title: "Your progress starts here", body: "Take a test in this folder and Kojo will start tracking what you know." },
  first: { title: "First test done, nice start", body: "Every test from here shows how far you have come. Keep going." },
  improving: { title: "You are getting better", body: "Your latest score beat your recent average. Keep the streak going." },
  dipping: { title: "Tough one, that is how you learn", body: "Lower scores show exactly what to practice next. Your weak topics are below." },
  steady: { title: "Holding steady", body: "Consistent work pays off. Hit your weak topics to push your score higher." },
};

const TOPIC_LIMIT = 6;

function pct(value: number | null): string {
  return value == null ? "-" : `${Math.round(value)}%`;
}

export function FolderStats({ folderId }: { folderId: number }) {
  const navigate = useNavigate();
  const [stats, setStats] = useState<FolderStatsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quizBusy, setQuizBusy] = useState(false);
  const [quizError, setQuizError] = useState<string | null>(null);

  async function openDailyQuiz() {
    setQuizBusy(true);
    setQuizError(null);
    try {
      const quiz = await createDailyQuiz(folderId);
      navigate(`/test/${quiz.test_id}`);
    } catch (err) {
      setQuizError(err instanceof Error ? err.message : "Could not make your quiz. Try again in a moment.");
      setQuizBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setError(null);
    fetchFolderStats(folderId)
      .then((data) => !cancelled && setStats(data))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Could not load your stats."));
    return () => {
      cancelled = true;
    };
  }, [folderId]);

  if (error) return <p className="muted small">{error}</p>;
  if (!stats) {
    return <SkeletonFolderStats />;
  }

  const message = ENCOURAGEMENT[stats.encouragement];
  if (stats.tests_taken === 0 && stats.topics.length === 0) {
    return (
      <EmptyState
        icon={<ScoreRiseIcon />}
        title={message.title}
        body={message.body}
        action={
          <Link to={`/create-test?folderId=${folderId}`}>
            <Button icon={<Plus size={16} />}>Take your first test</Button>
          </Link>
        }
      />
    );
  }

  const weak = stats.topics.filter((t) => t.status === "weak");
  const strong = stats.topics.filter((t) => t.status === "strong").sort((a, b) => b.accuracy - a.accuracy);
  const mastered = strong.length;

  return (
    <div className="folder-stats">
      <div className="folder-stats-message folder-stats-message--quiz">
        <div className="folder-stats-message-text">
          <strong>{message.title}</strong>
          <span className="muted">{message.body}</span>
        </div>
        <DailyQuizAction
          quiz={stats.today_quiz ?? null}
          hasTopics={stats.topics.length > 0}
          busy={quizBusy}
          onOpen={() => void openDailyQuiz()}
        />
      </div>
      {quizError ? <p className="folder-stats-quiz-error small">{quizError}</p> : null}

      <div className="folder-stats-tiles">
        <Card tone="soft" className="folder-stats-tile icon-hover">
          <span className="folder-stats-tile-label"><TestsTakenIcon size={18} /> Tests taken</span>
          <strong>{stats.tests_taken}</strong>
        </Card>
        <Card tone="soft" className="folder-stats-tile icon-hover">
          <span className="folder-stats-tile-label"><ScoreRiseIcon size={18} /> Latest score</span>
          <strong>{pct(stats.latest_score)}</strong>
          <span className="muted small">Average {pct(stats.average_score)}</span>
        </Card>
        <Card tone="soft" className="folder-stats-tile icon-hover">
          <span className="folder-stats-tile-label"><CrownIcon size={18} /> Topics mastered</span>
          <strong>{mastered}</strong>
          <span className="muted small">of {stats.topics.length} tracked</span>
        </Card>
      </div>

      {stats.score_progression.length > 0 ? (
        <Card className="folder-stats-chart-card">
          <h3 className="folder-stats-heading">Score progression</h3>
          {stats.score_progression.length === 1 ? (
            <p className="muted small">One test so far. Take another to see your trend.</p>
          ) : null}
          <ScoreChart points={stats.score_progression} />
        </Card>
      ) : null}

      <div className="folder-stats-topics">
        <TopicList
          title="Weak topics"
          tone="weak"
          topics={weak}
          empty={stats.topics.length ? "No weak topics right now. Nice work." : "Topics show up after a few answers on new tests and flashcards."}
        />
        <TopicList
          title="Strong topics"
          tone="strong"
          topics={strong}
          empty="Get a topic to 80% to see it here."
        />
      </div>
    </div>
  );
}

// One quiz per folder per day: make it, open it while it builds, then retake it.
function DailyQuizAction({
  quiz,
  hasTopics,
  busy,
  onOpen,
}: {
  quiz: FolderStatsData["today_quiz"];
  hasTopics: boolean;
  busy: boolean;
  onOpen: () => void;
}) {
  if (!hasTopics && !quiz) {
    return <span className="muted small folder-stats-quiz-hint">Daily quiz unlocks after your first tagged test.</span>;
  }
  const label = busy
    ? "Opening..."
    : !quiz
      ? "Start today's quiz"
      : quiz.generation_status === "generating"
        ? "Open today's quiz"
        : quiz.completed
          ? "Retake today's quiz"
          : "Take today's quiz";
  return (
    <div className="folder-stats-quiz" data-tour="folder-daily-quiz">
      {quiz?.completed ? (
        <span className="folder-stats-quiz-done icon-hover">
          <TestsTakenIcon size={18} active /> Done today
        </span>
      ) : null}
      <Button variant={quiz?.completed ? "secondary" : "primary"} onClick={onOpen} disabled={busy}>
        {label}
      </Button>
    </div>
  );
}

function TopicList({ title, tone, topics, empty }: { title: string; tone: "weak" | "strong"; topics: TopicStat[]; empty: string }) {
  return (
    <Card className={`folder-stats-topic-card folder-stats-topic-card--${tone} icon-hover`}>
      <h3 className="folder-stats-heading">
        {tone === "weak" ? <SproutIcon size={18} /> : <CrownIcon size={18} />} {title}
      </h3>
      {topics.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ul className="folder-stats-topic-list">
          {topics.slice(0, TOPIC_LIMIT).map((t) => (
            <li key={t.topic}>
              <div className="folder-stats-topic-row">
                <span className="folder-stats-topic-name">{t.topic}</span>
                <span className="folder-stats-topic-pct">{Math.round(t.accuracy * 100)}%</span>
              </div>
              <div className="folder-stats-bar" aria-hidden="true">
                <span style={{ width: `${Math.max(4, Math.round(t.accuracy * 100))}%` }} />
              </div>
              <span className="muted small">
                {t.answers} answer{t.answers === 1 ? "" : "s"}
                {t.flashcard_answers ? `, ${t.flashcard_answers} from flashcards` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {topics.length > TOPIC_LIMIT ? <p className="muted small">+{topics.length - TOPIC_LIMIT} more</p> : null}
    </Card>
  );
}

// Single-series line: 0-100% on one axis, oldest attempt on the left.
// Each point has a native tooltip and an sr-only table carries the values.
function ScoreChart({ points }: { points: ScorePoint[] }) {
  const recent = points.slice(-20);
  // Drawn at the container's real width so dots stay round and labels unscaled.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setW(Math.max(200, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const H = 200;
  const pad = { l: 40, r: 12, t: 12, b: 12 };
  const x = (i: number) => pad.l + (recent.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (recent.length - 1));
  const y = (score: number) => pad.t + ((100 - score) * (H - pad.t - pad.b)) / 100;
  const path = recent.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  const [hover, setHover] = useState<number | null>(null);
  const active = hover == null ? null : recent[hover];

  return (
    <div className="folder-stats-chart" ref={box}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Test scores over time">
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} className="folder-stats-grid" />
            <text x={pad.l - 8} y={y(g) + 4} textAnchor="end" className="folder-stats-axis">{g}%</text>
          </g>
        ))}
        <path d={path} className="folder-stats-line" />
        {recent.map((p, i) => (
          <g key={p.attempt_id} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
            <circle cx={x(i)} cy={y(p.score)} r={14} className="folder-stats-hit" />
            <circle cx={x(i)} cy={y(p.score)} r={hover === i ? 6 : 4} className="folder-stats-dot" />
          </g>
        ))}
      </svg>
      {active ? (
        <div
          className="folder-stats-tooltip"
          style={{ left: Math.min(Math.max(x(hover!), 90), W - 90), top: y(active.score) }}
        >
          <strong>{Math.round(active.score)}%</strong>
          <span>{active.test_title}</span>
          <span className="muted">{formatDate(active.created_at)}</span>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>Test scores</caption>
        <tbody>
          {recent.map((p) => (
            <tr key={p.attempt_id}><td>{p.test_title}</td><td>{formatDate(p.created_at)}</td><td>{Math.round(p.score)}%</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
