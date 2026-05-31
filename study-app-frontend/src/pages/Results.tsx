import { AlertTriangle, Brain, Calculator, CheckCircle2, ChevronDown, Loader2, RotateCcw, Sparkles, Target, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { SelectInput, TextInput } from "../components/Field";
import { MarkdownContent } from "../components/MarkdownContent";
import { SelectionKojoAssistant } from "../components/SelectionKojoAssistant";
import { createTest, fetchAttemptDetail, fetchFolder, fetchReviewSummary, isGuestSession } from "../lib/api";
import { scoreTone } from "../lib/format";
import type { AnswerResult, AttemptDetail } from "../lib/types";

export default function Results() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState<AttemptDetail | null>(null);
  const [folderName, setFolderName] = useState("Selected text");
  const [error, setError] = useState<string | null>(null);

  // Targeted practice modal state
  const [showTargetedModal, setShowTargetedModal] = useState(false);

  useEffect(() => {
    if (!showTargetedModal) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowTargetedModal(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showTargetedModal]);
  const [targetedTitle, setTargetedTitle] = useState("");
  const [targetedTestType, setTargetedTestType] = useState("mixed");
  const [targetedCountMcq, setTargetedCountMcq] = useState(5);
  const [targetedCountFrq, setTargetedCountFrq] = useState(3);
  const [targetedDifficulty, setTargetedDifficulty] = useState("mixed");
  const [isCreatingTargeted, setIsCreatingTargeted] = useState(false);
  const [targetedError, setTargetedError] = useState<string | null>(null);
  const [reviewSummary, setReviewSummary] = useState<string | null>(null);
  const [loadingReview, setLoadingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

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

  async function handleGenerateReview() {
    if (!attemptId) return;
    setLoadingReview(true);
    setReviewError(null);
    try {
      const result = await fetchReviewSummary(Number(attemptId));
      setReviewSummary(result.summary);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Unable to generate study notes.");
    } finally {
      setLoadingReview(false);
    }
  }

  async function handleCreateTargetedTest() {
    if (!attempt?.folder_id) return;
    setIsCreatingTargeted(true);
    setTargetedError(null);
    try {
      const topics = missed
        .map((a) => a.question_text ?? "")
        .filter(Boolean)
        .slice(0, 8)
        .join("; ");
      await createTest({
        folderId: attempt.folder_id,
        title: targetedTitle || `Targeted Practice , ${attempt.test_title}`,
        testType: targetedTestType,
        files: [],
        countMcq: targetedTestType !== "FRQ_only" ? targetedCountMcq : 0,
        countFrq: targetedTestType !== "MCQ_only" ? targetedCountFrq : 0,
        difficulty: targetedDifficulty,
        topicFocus: topics.slice(0, 200),
        customInstructions: `Target the user's weak areas from a previous attempt. Focus questions on: ${topics}`.slice(0, 500),
      });
      setShowTargetedModal(false);
      navigate(`/folders/${attempt.folder_id}`);
    } catch (err) {
      setTargetedError(err instanceof Error ? err.message : "Failed to create test.");
      setIsCreatingTargeted(false);
    }
  }

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
          <span>Math mode , tap any question to see the full worked solution and step-by-step breakdown.</span>
        </Card>
      )}

      {missed.length > 0 ? (
        <Card tone="soft" className="focus-card">
          <div className="focus-card-header">
            <AlertTriangle size={22} />
            <div>
              <h2>Focus on these next</h2>
              <p className="muted">Nosey found {missed.length} answer{missed.length === 1 ? "" : "s"} that deserve another pass.</p>
            </div>
            {!reviewSummary && (
              <Button
                variant="secondary"
                icon={loadingReview ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
                onClick={() => void handleGenerateReview()}
                disabled={loadingReview}
              >
                {loadingReview ? "Generating…" : "Study notes"}
              </Button>
            )}
          </div>
          {reviewError ? (
            <p className="muted small" style={{ color: "var(--red, #e53e3e)", marginTop: 8 }}>{reviewError}</p>
          ) : null}
          {reviewSummary ? (
            <div className="focus-card-summary">
              <MarkdownContent content={reviewSummary} />
            </div>
          ) : null}
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

      {missed.length > 0 && attempt.folder_id ? (
        <>
          <div className="targeted-practice-section">
            <div className="section-title">
              <h2>Missed Topics</h2>
              <Button
                icon={<Target size={16} />}
                onClick={() => {
                  setTargetedTitle(`Targeted Practice , ${attempt.test_title}`);
                  setShowTargetedModal(true);
                }}
              >
                Generate Targeted Test
              </Button>
            </div>
            <div className="targeted-topics-list">
              {missed.slice(0, 6).map((a, i) => (
                <div key={a.question_id} className="targeted-topic-item">
                  <XCircle size={15} className="targeted-topic-icon" />
                  <span className="targeted-topic-text">
                    {(a.question_text ?? `Question ${i + 1}`).slice(0, 110)}
                    {(a.question_text?.length ?? 0) > 110 ? "…" : ""}
                  </span>
                </div>
              ))}
              {missed.length > 6 && (
                <p className="muted small" style={{ margin: "4px 0 0" }}>
                  +{missed.length - 6} more weak areas will be included
                </p>
              )}
            </div>
          </div>

          {showTargetedModal && (
            <div className="modal-backdrop" onMouseDown={() => setShowTargetedModal(false)}>
              <div
                className="modal-card targeted-modal-card"
                role="dialog"
                aria-modal="true"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <h2>Create Targeted Practice Test</h2>
                <TextInput
                  label="Test title"
                  value={targetedTitle}
                  onChange={(e) => setTargetedTitle(e.target.value)}
                  placeholder="Targeted Practice Test"
                />
                <SelectInput
                  label="Test type"
                  value={targetedTestType}
                  onChange={(e) => setTargetedTestType(e.target.value)}
                >
                  <option value="mixed">Mixed (MCQ + FRQ)</option>
                  <option value="MCQ_only">Multiple Choice Only</option>
                  <option value="FRQ_only">Free Response Only</option>
                </SelectInput>
                {targetedTestType !== "FRQ_only" && (
                  <TextInput
                    label="MCQ questions"
                    type="number"
                    min={1}
                    max={20}
                    value={targetedCountMcq}
                    onChange={(e) =>
                      setTargetedCountMcq(Math.max(1, Math.min(20, Number(e.target.value))))
                    }
                  />
                )}
                {targetedTestType !== "MCQ_only" && (
                  <TextInput
                    label="FRQ questions"
                    type="number"
                    min={1}
                    max={10}
                    value={targetedCountFrq}
                    onChange={(e) =>
                      setTargetedCountFrq(Math.max(1, Math.min(10, Number(e.target.value))))
                    }
                  />
                )}
                <SelectInput
                  label="Difficulty"
                  value={targetedDifficulty}
                  onChange={(e) => setTargetedDifficulty(e.target.value)}
                >
                  <option value="mixed">Mixed</option>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </SelectInput>
                <div className="targeted-topics-preview">
                  <span className="field-label">
                    Targeting {missed.length} weak area{missed.length !== 1 ? "s" : ""}
                  </span>
                  <div className="targeted-chips">
                    {missed.slice(0, 4).map((a) => (
                      <span key={a.question_id} className="pill targeted-chip">
                        {(a.question_text ?? "").slice(0, 48)}
                        {(a.question_text?.length ?? 0) > 48 ? "…" : ""}
                      </span>
                    ))}
                    {missed.length > 4 && (
                      <span className="pill">+{missed.length - 4} more</span>
                    )}
                  </div>
                </div>
                {targetedError && <p className="targeted-error">{targetedError}</p>}
                <div className="button-row">
                  <Button variant="secondary" onClick={() => setShowTargetedModal(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCreateTargetedTest}
                    disabled={isCreatingTargeted || !targetedTitle.trim()}
                  >
                    {isCreatingTargeted ? "Creating…" : "Create Test"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}

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

  const guest = isGuestSession();

  return (
    attempt.folder_id && !guest ? (
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
