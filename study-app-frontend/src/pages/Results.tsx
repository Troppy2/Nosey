import { AlertTriangle, Brain, Calculator, CheckCircle2, ChevronDown, Info, Loader2, PenLine, RotateCcw, Sparkles, Target, X, XCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { FeatureSurvey } from "../components/FeatureSurvey";
import { SelectInput, TextInput } from "../components/Field";
import { LoadingNotice } from "../components/Loaders";
import { MarkdownContent } from "../components/MarkdownContent";
import {
  exportScratchPadPng,
  isScratchPadEmpty,
  parseScratchPadJson,
  ScratchPadTrigger,
  type PaperStyle,
  type ScratchPadData,
} from "../components/ScratchPad";
import { SelectionKojoAssistant } from "../components/SelectionKojoAssistant";
import { SkeletonScoreSummary } from "../components/Skeletons";
import {
  createTest,
  fetchAttemptDetail,
  fetchFolder,
  fetchReviewSummary,
  fetchTest,
  isGuestSession,
  redoAnswer,
  scopeKey,
  skipUnreadableAnswers,
} from "../lib/api";
import { formatCodingProblem } from "../lib/codingProblemFormat";
import { isReadFromDrawing } from "../lib/drawnAnswer";
import { scoreTone } from "../lib/format";
import type { AnswerResult, AttemptDetail, RedoAnswerResponse } from "../lib/types";

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
  // Math/coding mode for the targeted test; defaults to the original test's.
  const [targetedMode, setTargetedMode] = useState<"general" | "math" | "coding">("general");
  const [targetedLanguage, setTargetedLanguage] = useState("Python");
  const [isCreatingTargeted, setIsCreatingTargeted] = useState(false);
  const [targetedError, setTargetedError] = useState<string | null>(null);
  const [reviewSummary, setReviewSummary] = useState<string | null>(null);
  const [loadingReview, setLoadingReview] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [skippingAll, setSkippingAll] = useState(false);
  const [skipAllError, setSkipAllError] = useState<string | null>(null);

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

  // Results land straight from the grading overlay, so the page skeleton is
  // shaped like what arrives: the green score hero, the stat row, the answers.
  if (!attempt) {
    return (
      <div className="page page-narrow">
        <SkeletonScoreSummary />
      </div>
    );
  }

  const tone = scoreTone(attempt.score);
  // A held answer (GH #149) is not graded yet, so it is not "missed".
  const held = attempt.answers.filter((answer) => answer.ocr_status === "needs_input");
  const missed = attempt.answers.filter((answer) => !answer.is_correct && answer.ocr_status !== "needs_input");
  const hasMath = attempt.answers.some((a) => a.is_math);

  // Merge a redo / skip response into the attempt in place: the score and the
  // regraded answers change, everything else stays.
  function applyRegrade(response: RedoAnswerResponse) {
    setAttempt((prev) => {
      if (!prev) return prev;
      const byId = new Map(response.answers.map((answer) => [answer.question_id, answer]));
      return {
        ...prev,
        score: response.score,
        correct_count: response.correct_count,
        total: response.total,
        is_provisional: response.is_provisional,
        answers: prev.answers.map((answer) => byId.get(answer.question_id) ?? answer),
      };
    });
    // The study notes were written from the old set of missed answers.
    setReviewSummary(null);
  }

  async function handleSkipAll() {
    if (!attempt) return;
    setSkippingAll(true);
    setSkipAllError(null);
    try {
      applyRegrade(await skipUnreadableAnswers(Number(attempt.id)));
    } catch (err) {
      setSkipAllError(err instanceof Error ? err.message : "Could not skip those answers.");
    } finally {
      setSkippingAll(false);
    }
  }

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
        title: targetedTitle || `Targeted Practice, ${attempt.test_title}`,
        isMathMode: targetedMode === "math",
        isCodingMode: targetedMode === "coding",
        codingLanguage: targetedMode === "coding" ? targetedLanguage : undefined,
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
        <span className="eyebrow">
          Attempt {attempt.attempt_number}
          {held.length > 0 ? <span className="pill score-provisional-pill">Provisional</span> : null}
        </span>
        <strong>{Math.round(attempt.score)}%</strong>
        <p>
          {attempt.correct_count} of {attempt.total} correct
          {held.length > 0 ? `, ${held.length} waiting on you` : ""}
        </p>
      </Card>

      {held.length > 0 ? (
        <Card className="needs-input-banner">
          <PenLine size={20} />
          <div>
            <h2>
              {held.length === 1 ? "1 answer needs" : `${held.length} answers need`} your input
            </h2>
            <p className="muted small">
              Kojo couldn't read some of your handwriting. Fix the drawing or type the answer below, once
              per question, and it gets graded. Your score updates when you do.
            </p>
            {skipAllError ? <p className="needs-input-error small">{skipAllError}</p> : null}
          </div>
          <Button variant="secondary" onClick={() => void handleSkipAll()} disabled={skippingAll}>
            {skippingAll ? "Grading..." : "Skip all"}
          </Button>
        </Card>
      ) : null}

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
          <span>Math mode, tap any question to see the full worked solution and step-by-step breakdown.</span>
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
          {loadingReview ? (
            <LoadingNotice
              compact
              title="Writing your study notes"
              estimate="Kojo is working through the answers you missed. About 15 seconds."
              slowNote="Still writing. A long list of missed answers takes Kojo a while to work through."
              slowAfterMs={18000}
            />
          ) : null}
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
                  setTargetedTitle(`Targeted Practice, ${attempt.test_title}`);
                  setShowTargetedModal(true);
                  // Start from the original test's mode; the picker can change it.
                  fetchTest(attempt.test_id)
                    .then((t) => {
                      setTargetedMode(t.is_coding_mode ? "coding" : t.is_math_mode ? "math" : "general");
                      if (t.coding_language) setTargetedLanguage(t.coding_language);
                    })
                    .catch(() => undefined);
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
                    {/* Rendered, not sliced: a hard character cut lands in the
                        middle of a $...$ pair on math questions and leaves raw
                        LaTeX on screen. CSS line-clamps the overflow instead. */}
                    <MarkdownContent content={a.question_text ?? `Question ${i + 1}`} />
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
                <div className="targeted-modal-header">
                  <div>
                    <h2>Targeted Practice</h2>
                    <p className="muted small">Focused on your weak areas</p>
                  </div>
                  <button
                    className="privacy-modal-close"
                    onClick={() => setShowTargetedModal(false)}
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="targeted-modal-fields">
                  <TextInput
                    label="Test title"
                    value={targetedTitle}
                    onChange={(e) => setTargetedTitle(e.target.value)}
                    placeholder="Targeted Practice Test"
                  />
                  <div className="targeted-row">
                    <SelectInput
                      label="Test type"
                      value={targetedTestType}
                      onChange={(e) => setTargetedTestType(e.target.value)}
                    >
                      <option value="mixed">Mixed</option>
                      <option value="MCQ_only">Multiple choice</option>
                      <option value="FRQ_only">Written</option>
                    </SelectInput>
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
                    <SelectInput
                      label="Mode"
                      value={targetedMode}
                      onChange={(e) => setTargetedMode(e.target.value as "general" | "math" | "coding")}
                    >
                      <option value="general">General</option>
                      <option value="math">Math</option>
                      <option value="coding">Coding</option>
                    </SelectInput>
                    {targetedMode === "coding" ? (
                      <SelectInput
                        label="Language"
                        value={targetedLanguage}
                        onChange={(e) => setTargetedLanguage(e.target.value)}
                      >
                        {["Python", "JavaScript", "TypeScript", "Java", "C++", "C", "C#", "Go", "Rust", "Swift", "Kotlin", "OCaml", "SQL"].map((lang) => (
                          <option key={lang} value={lang}>{lang}</option>
                        ))}
                      </SelectInput>
                    ) : null}
                  </div>
                  <div className="targeted-row">
                    {targetedTestType !== "FRQ_only" && (
                      <TextInput
                        label="Multiple choice questions"
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
                        label="Written questions"
                        type="number"
                        min={1}
                        max={10}
                        value={targetedCountFrq}
                        onChange={(e) =>
                          setTargetedCountFrq(Math.max(1, Math.min(10, Number(e.target.value))))
                        }
                      />
                    )}
                  </div>
                </div>

                <div className="targeted-topics-preview">
                  <span className="targeted-topics-label">
                    <Target size={13} />
                    Targeting {missed.length} weak area{missed.length !== 1 ? "s" : ""}
                  </span>
                  <div className="targeted-chips">
                    {missed.slice(0, 4).map((a) => (
                      <span key={a.question_id} className="targeted-chip">
                        {(a.question_text ?? "").slice(0, 52)}
                        {(a.question_text?.length ?? 0) > 52 ? "…" : ""}
                      </span>
                    ))}
                    {missed.length > 4 && (
                      <span className="targeted-chip targeted-chip-more">+{missed.length - 4} more</span>
                    )}
                  </div>
                </div>

                {targetedError && <p className="targeted-error">{targetedError}</p>}

                <div className="targeted-modal-actions">
                  <Button variant="secondary" fullWidth onClick={() => setShowTargetedModal(false)}>
                    Cancel
                  </Button>
                  <Button
                    fullWidth
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
          {reviewBlocks(attempt.answers).map((block, blockIndex) => {
            const items = block.answers.map((answer) => {
              const label = block.groupId != null ? `Part (${answer.part_label ?? "?"})` : `Question ${blockIndex + 1}`;
              return answer.ocr_status === "needs_input" ? (
                <NeedsInputItem
                  answer={answer}
                  attemptId={Number(attempt.id)}
                  key={answer.question_id}
                  label={label}
                  onRegraded={applyRegrade}
                />
              ) : (
                <ReviewItem answer={answer} key={answer.question_id} label={label} />
              );
            });
            if (block.groupId == null) return items;
            // A multi-part problem (GH #151): its setup once, then its parts.
            const first = block.answers[0];
            const right = block.answers.filter((a) => a.is_correct).length;
            return (
              <div className="review-problem" key={`group-${block.groupId}`}>
                <div className="review-problem-head">
                  <span className="small muted">
                    Question {blockIndex + 1}
                    {first.group_label ? `, problem ${first.group_label}` : ""} · {right} of {block.answers.length} parts right
                  </span>
                  {first.group_stem ? (
                    <div className="review-question-markdown">
                      <MarkdownContent content={first.group_stem} />
                    </div>
                  ) : null}
                </div>
                {items}
              </div>
            );
          })}
        </div>
      </section>

      {!isGuestSession() ? <FeatureSurvey feature="testing" trigger={!!attempt} /> : null}
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

// Multiple-select and ranking answers are stored as JSON arrays of option texts.
// Render them as a readable list instead of raw JSON.
function formatAnswerForDisplay(raw: string): string {
  if (!raw) return raw;
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item)).join(", ");
    } catch {
      // not a JSON array, render as-is
    }
  }
  return raw;
}

// Consecutive answers of one multi-part problem form a block (GH #151); any
// other answer is a block of its own.
function reviewBlocks(answers: AnswerResult[]): { groupId: AnswerResult["group_id"]; answers: AnswerResult[] }[] {
  const blocks: { groupId: AnswerResult["group_id"]; answers: AnswerResult[] }[] = [];
  for (const answer of answers) {
    const last = blocks[blocks.length - 1];
    if (answer.group_id != null && last && last.groupId === answer.group_id) {
      last.answers.push(answer);
    } else {
      blocks.push({ groupId: answer.group_id ?? null, answers: [answer] });
    }
  }
  return blocks;
}

// A long answer (a whole scratch pad read back) is capped so the feedback
// below it stays on screen; "Show more" opens it. GH #157.
function ClampedBox({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 4);
    measure();
    // KaTeX and fonts can change the height after the first paint.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [children]);

  return (
    <>
      <div className={`${className} review-clamp${expanded ? " expanded" : ""}${overflows && !expanded ? " clipped" : ""}`} ref={ref}>
        {children}
      </div>
      {overflows || expanded ? (
        <button className="review-clamp-toggle" onClick={() => setExpanded(!expanded)} type="button">
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </>
  );
}

function ReviewItem({ answer, label }: { answer: AnswerResult; label: string }) {
  const [open, setOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const Icon = answer.is_correct ? CheckCircle2 : XCircle;
  const reasoning = answer.reasoning?.trim();
  const [fullReadOpen, setFullReadOpen] = useState(false);
  const transcript = answer.work_transcript?.trim();
  // Draw-only answers are stored as their transcript, or just the working
  // lines of it (GH #157); show them as read handwriting, not typed text.
  const drawnOnly = isReadFromDrawing(answer.user_answer, transcript);
  const trimmed = drawnOnly && answer.user_answer.trim() !== transcript;

  return (
    <Card className={`review-item ${answer.is_correct ? "correct" : "incorrect"}`}>
      <button className="review-trigger" onClick={() => setOpen(!open)} type="button">
        <Icon size={22} />
        <div>
          <span className="small muted">{label}</span>
          <div className="review-question-markdown">
            {/* Lays out a run-on coding problem; anything else is unchanged. */}
            <MarkdownContent content={formatCodingProblem(answer.question_text ?? `Question ${answer.question_id}`)} />
          </div>
        </div>
        <ChevronDown className={open ? "rotated" : ""} size={20} />
      </button>
      {open ? (
        <div className="review-detail">
          {answer.flagged_uncertain ? (
            <div className="review-flagged-notice">
              <AlertTriangle size={16} />
              <span>
                This grade may be off. The auto-generated answer key for this question looks
                questionable, so Nosey flagged it for review. If you think your answer was right,
                read the explanation below and trust your own judgement.
              </span>
            </div>
          ) : null}
          {answer.answer_inferred ? (
            <div className="review-inferred-note">
              <Info size={15} />
              <span>
                Answer worked out by Nosey. Your practice test had no answer key for this question,
                so check it against your notes if it looks off.
              </span>
            </div>
          ) : null}
          <div>
            <span>{drawnOnly ? "Your answer (read from your drawing)" : "Your answer"}</span>
            <ClampedBox className={`review-answer-markdown ${drawnOnly ? "review-work-transcript" : "review-answer-text"}`}>
              <MarkdownContent content={formatAnswerForDisplay(answer.user_answer)} />
            </ClampedBox>
            {trimmed ? (
              <button className="review-full-read-toggle" onClick={() => setFullReadOpen(!fullReadOpen)} type="button">
                {fullReadOpen ? "Hide everything Kojo read" : "Show everything Kojo read"}
                <ChevronDown className={fullReadOpen ? "rotated" : ""} size={14} />
              </button>
            ) : null}
            {trimmed && fullReadOpen && transcript ? (
              <ClampedBox className="review-answer-markdown review-work-transcript review-full-read">
                <MarkdownContent content={transcript} />
              </ClampedBox>
            ) : null}
          </div>
          {transcript && !drawnOnly ? (
            <div>
              <span>What Kojo read from your work</span>
              <ClampedBox className="review-answer-markdown review-work-transcript">
                <MarkdownContent content={transcript} />
              </ClampedBox>
            </div>
          ) : null}
          <div className="math-explanation">
            <span>Feedback</span>
            <MarkdownContent content={answer.feedback ?? "No feedback returned for this answer."} />
          </div>
          {reasoning ? (
            <div className="answer-reasoning">
              <button
                className="answer-reasoning-trigger"
                onClick={() => setReasoningOpen(!reasoningOpen)}
                type="button"
              >
                <Brain size={15} />
                <span>AI-Reasoning</span>
                <ChevronDown className={reasoningOpen ? "rotated" : ""} size={15} />
              </button>
              {reasoningOpen ? (
                <div className="answer-reasoning-body">
                  <MarkdownContent content={reasoning} />
                </div>
              ) : null}
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

// A held answer (GH #149): OCR could not read the drawing, so the answer key is
// withheld and the student gets one redo, a fixed drawing or a typed answer.
function NeedsInputItem({
  answer,
  attemptId,
  label,
  onRegraded,
}: {
  answer: AnswerResult;
  attemptId: number;
  label: string;
  onRegraded: (response: RedoAnswerResponse) => void;
}) {
  const initialStrokes = useMemo(() => parseScratchPadJson(answer.work_strokes), [answer.work_strokes]);
  const [strokes, setStrokes] = useState<ScratchPadData>(initialStrokes);
  const [typed, setTyped] = useState(answer.user_answer ?? "");
  const [paperStyle, setPaperStyle] = useState<PaperStyle>(() => {
    try {
      return (localStorage.getItem(scopeKey("nosey_scratchpad_paper")) as PaperStyle | null) ?? "blank";
    } catch {
      return "blank";
    }
  });
  const [busy, setBusy] = useState<"redo" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const transcript = answer.work_transcript?.trim();
  const hasDrawing = !isScratchPadEmpty(strokes);
  const canSubmit = Boolean(typed.trim()) || hasDrawing;

  function changePaperStyle(style: PaperStyle) {
    setPaperStyle(style);
    try {
      localStorage.setItem(scopeKey("nosey_scratchpad_paper"), style);
    } catch {
      // A per-viewer convenience only.
    }
  }

  async function submitRedo() {
    setBusy("redo");
    setError(null);
    try {
      const workImage = hasDrawing ? exportScratchPadPng(strokes) : null;
      onRegraded(
        await redoAnswer(attemptId, Number(answer.question_id), {
          answer: typed.trim(),
          ...(workImage ? { work_image: workImage } : {}),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not grade this answer. Try again.");
      setBusy(null);
    }
  }

  async function skip() {
    setBusy("skip");
    setError(null);
    try {
      onRegraded(await skipUnreadableAnswers(attemptId, [Number(answer.question_id)]));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not skip this answer.");
      setBusy(null);
    }
  }

  return (
    <Card className="review-item needs-input">
      <div className="review-trigger needs-input-head">
        <PenLine size={22} />
        <div>
          <span className="small muted">{label}, needs your input</span>
          <div className="review-question-markdown">
            <MarkdownContent content={answer.question_text ?? `Question ${answer.question_id}`} />
          </div>
        </div>
      </div>
      <div className="review-detail">
        <div className="needs-input-notice">
          <Info size={15} />
          <span>
            {transcript
              ? "Kojo wasn't confident reading your handwriting. Check what it read, then fix your drawing or type the answer."
              : "Kojo couldn't read your handwriting. Fix your drawing or type the answer."}{" "}
            You get one redo, and the answer stays hidden until then.
          </span>
        </div>
        {transcript ? (
          <div>
            <span>What Kojo read</span>
            <div className="review-answer-markdown review-work-transcript">
              <MarkdownContent content={transcript} />
            </div>
          </div>
        ) : null}
        <div className="needs-input-fields">
          <ScratchPadTrigger
            questionText={
              answer.group_stem
                ? `${answer.group_stem}\n\n(${answer.part_label ?? "?"}) ${answer.question_text ?? ""}`
                : answer.question_text ?? ""
            }
            data={strokes}
            onChange={setStrokes}
            paperStyle={paperStyle}
            onPaperStyleChange={changePaperStyle}
          />
          <label className="needs-input-typed">
            <span>Or type your answer</span>
            <textarea
              className="field-input math-answer-textarea"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              maxLength={5000}
              rows={3}
              placeholder="Type your final answer"
            />
          </label>
        </div>
        {error ? <p className="needs-input-error small">{error}</p> : null}
        <div className="button-row">
          <Button onClick={() => void submitRedo()} disabled={!canSubmit || busy !== null}>
            {busy === "redo" ? "Grading..." : "Grade this answer"}
          </Button>
          <Button variant="secondary" onClick={() => void skip()} disabled={busy !== null}>
            {busy === "skip" ? "Grading..." : "Skip"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
