import { AlertTriangle, Brain, Calculator, CheckCircle2, ChevronDown, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { MarkdownContent } from "../components/MarkdownContent";
import { SelectionKojoAssistant } from "../components/SelectionKojoAssistant";
import { fetchAttemptDetail, fetchFolder } from "../lib/api";
import { scoreTone } from "../lib/format";
import type { AnswerResult, AttemptDetail } from "../lib/types";

export default function Results() {
  const { attemptId } = useParams();
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
  const [folderName, setFolderName] = useState("Selected text");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadAttempt() {
      if (!attemptId) {
        setError("No attempt id provided.");
        return;
      }

      const numericAttemptId = Number(attemptId);
      const stored = sessionStorage.getItem(`nosey_attempt_${attemptId}`);
      const fallbackAttempt = stored ? (JSON.parse(stored) as AttemptDetail) : null;

      try {
        const detail = await fetchAttemptDetail(numericAttemptId);
        setAttempt(detail);

        if (detail.folder_id) {
          fetchFolder(detail.folder_id)
            .then((folder) => setFolderName(folder.name))
            .catch(() => {
              setFolderName(detail.test_title || "Selected text");
            });
        } else {
          setFolderName(detail.test_title || "Selected text");
        }
        setError(null);
      } catch {
        if (fallbackAttempt) {
          setAttempt(fallbackAttempt);
          setFolderName(fallbackAttempt.test_title || "Selected text");
          setError(null);
          return;
        }
        setError("Unable to load this attempt.");
      }
    }

    loadAttempt();
  }, [attemptId]);

  if (error && !attempt) {
    return (
      <div className="page page-narrow">
        <EmptyState
          icon={<Brain />}
          title="No saved attempt"
          body={error}
          action={
            <Link to="/create-test">
              <Button>Make a Test</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (!attempt) {
    return (
      <div className="page centered-block">
        <span className="loader" />
      </div>
    );
  }

  const tone = scoreTone(attempt.score);
  const missed = attempt.answers.filter((answer) => !answer.is_correct);
  const hasMath = attempt.answers.some((a) => a.is_math);
  const content = (
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

      {hasMath && (
        <Card className="math-mode-notice">
          <Calculator size={18} />
          <span>Math mode — tap any question to see the full worked solution and step-by-step breakdown.</span>
        </Card>
      )}

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
          {attempt.answers.map((answer, i) => (
            <ReviewItem answer={answer} key={answer.question_id} number={i + 1} />
          ))}
        </div>
      </section>
    </div>
  );

  return (
    attempt.folder_id ? (
      <SelectionKojoAssistant folderId={attempt.folder_id} folderName={folderName}>
        {content}
      </SelectionKojoAssistant>
    ) : (
      content
    )
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
          <div className="review-question-markdown">
            <MarkdownContent content={answer.question_text ?? `Question ${answer.question_id}`} />
          </div>
        </div>
        <ChevronDown className={open ? "rotated" : ""} size={20} />
      </button>
      {open ? (
        <div className="review-detail">
          <div>
            <span>Your answer</span>
            <div className="math-answer-text review-answer-markdown">
              <MarkdownContent content={answer.user_answer} />
            </div>
          </div>
          <div className="math-explanation">
            <span>Feedback</span>
            <MarkdownContent content={answer.feedback ?? "No feedback returned for this answer."} />
          </div>
          {answer.confidence !== null && answer.confidence !== undefined ? (
            <span className="pill">{Math.round(answer.confidence * 100)}% confidence</span>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
