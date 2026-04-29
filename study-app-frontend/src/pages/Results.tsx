import { AlertTriangle, Brain, CheckCircle2, ChevronDown, RotateCcw, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { scoreTone } from "../lib/format";
import type { AnswerResult, AttemptResult } from "../lib/types";

export default function Results() {
  const { attemptId } = useParams();
  const stored = attemptId ? sessionStorage.getItem(`nosey_attempt_${attemptId}`) : null;
  if (!stored) {
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
  const attempt: AttemptResult = JSON.parse(stored) as AttemptResult;
  const tone = scoreTone(attempt.score);
  const missed = useMemo(() => attempt.answers.filter((answer) => !answer.is_correct), [attempt.answers]);

  return (
    <div className="page page-narrow">
      <Card className={`score-hero score-${tone}`}>
        <span className="eyebrow">Attempt {attempt.attempt_number}</span>
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
          <strong>{attempt.answers.filter((answer) => answer.flagged_uncertain).length}</strong>
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
          <div>
            <span>Feedback</span>
            <p>{answer.feedback ?? "No feedback returned for this answer."}</p>
          </div>
          {answer.confidence !== null && answer.confidence !== undefined ? <span className="pill">{Math.round(answer.confidence * 100)}% confidence</span> : null}
        </div>
      ) : null}
    </Card>
  );
}
