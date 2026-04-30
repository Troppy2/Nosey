import { AlertTriangle, Brain, CheckCircle2, ChevronDown, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { fetchAttemptDetail } from "../lib/api";
import { scoreTone } from "../lib/format";
import type { AnswerResult, AttemptDetail, AttemptResult } from "../lib/types";

type DisplayAttempt = AttemptResult | AttemptDetail;

export default function Results() {
  const { attemptId } = useParams();
  const [attempt, setAttempt] = useState<DisplayAttempt | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!attemptId) { setLoading(false); return; }
    const stored = sessionStorage.getItem(`nosey_attempt_${attemptId}`);
    if (stored) {
      setAttempt(JSON.parse(stored) as AttemptResult);
      setLoading(false);
      return;
    }
    fetchAttemptDetail(Number(attemptId))
      .then(setAttempt)
      .catch(() => setAttempt(null))
      .finally(() => setLoading(false));
  }, [attemptId]);

  if (loading) {
    return (
      <div className="page centered-block">
        <span className="loader" />
      </div>
    );
  }

  if (!attempt) {
    return (
      <div className="page page-narrow">
        <EmptyState
          icon={<Brain />}
          title="No saved attempt"
          body="Take a test first to see a result breakdown here."
          action={
            <Link to="/create-test">
              <Button>Make a Test</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const attemptNumber = "attempt_number" in attempt ? attempt.attempt_number : (attempt as AttemptDetail).attempt_number;
  const testTitle = "test_title" in attempt ? (attempt as AttemptDetail).test_title : null;
  const tone = scoreTone(attempt.score);
  const missed = useMemo(() => attempt.answers.filter((a) => !a.is_correct), [attempt.answers]);

  return (
    <div className="page page-narrow">
      <Card className={`score-hero score-${tone}`}>
        {testTitle ? <span className="eyebrow">{testTitle}</span> : null}
        <span className="eyebrow">Attempt {attemptNumber}</span>
        <strong>{Math.round(attempt.score)}%</strong>
        <p>
          {attempt.correct_count} of {attempt.total} correct
        </p>
      </Card>

      <div className="grid grid-3 result-stats">
        <Card>
          <span>Correct</span>
          <strong>{attempt.correct_count}</strong>
        </Card>
        <Card>
          <span>Needs Review</span>
          <strong>{attempt.total - attempt.correct_count}</strong>
        </Card>
        <Card>
          <span>Flagged</span>
          <strong>{attempt.answers.filter((a) => a.flagged_uncertain).length}</strong>
        </Card>
      </div>

      {missed.length > 0 ? (
        <Card tone="soft" className="focus-card">
          <AlertTriangle size={22} />
          <div>
            <h2>Focus on these next</h2>
            <p className="muted">Nosey found {missed.length} answer that deserves another pass.</p>
          </div>
        </Card>
      ) : null}

      <div className="button-row result-actions">
        <Link to="/flashcards">
          <Button icon={<Brain size={18} />}>Study Weak Topics</Button>
        </Link>
        <Link to="/create-test">
          <Button variant="secondary" icon={<RotateCcw size={18} />}>
            Try Another Test
          </Button>
        </Link>
      </div>

      <section>
        <div className="section-title">
          <h2>Answer Review</h2>
        </div>
        <div className="review-list">
          {attempt.answers.map((answer, index) => (
            <ReviewItem answer={answer} key={answer.question_id} number={index + 1} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ReviewItem({ answer, number }: { answer: AnswerResult; number: number }) {
  const [open, setOpen] = useState(false);
  const Icon = answer.is_correct ? CheckCircle2 : XCircle;

  return (
    <Card className={`review-item ${answer.is_correct ? "correct" : "incorrect"}`}>
      <button className="review-trigger" onClick={() => setOpen(!open)} type="button">
        <Icon size={22} />
        <div>
          <span className="small muted">Question {number}</span>
          <h3>{answer.question_text ?? `Question ${answer.question_id}`}</h3>
        </div>
        <ChevronDown className={open ? "rotated" : ""} size={20} />
      </button>
      {open ? (
        <div className="review-detail">
          <div>
            <span>Your answer</span>
            <p>{answer.user_answer}</p>
          </div>
          {!answer.is_correct && answer.correct_answer ? (
            <div>
              <span>Correct answer</span>
              <p>{answer.correct_answer}</p>
            </div>
          ) : null}
          {answer.feedback ? (
            <div>
              <span>Feedback</span>
              <p>{answer.feedback}</p>
            </div>
          ) : null}
          {answer.confidence !== null && answer.confidence !== undefined ? (
            <span className="pill">{Math.round(answer.confidence * 100)}% confidence</span>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
