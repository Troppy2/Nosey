import { ArrowLeft, ArrowRight, Calculator, Check, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { TextArea } from "../components/Field";
import { MathInput } from "../components/MathInput";
import { fetchTest, submitAttempt } from "../lib/api";
import type { Question, SubmittedAnswer, TestTake } from "../lib/types";

export default function TakeTest() {
  const { testId } = useParams();
  const navigate = useNavigate();
  const numericTestId = Number(testId ?? 42);
  const [test, setTest] = useState<TestTake | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTest(numericTestId)
      .then(setTest)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Unable to load this test."));
  }, [numericTestId]);

  const question = test?.questions[index];
  const answeredCount = Object.values(answers).filter(Boolean).length;
  const progress = test ? ((index + 1) / test.questions.length) * 100 : 0;
  const canSubmit = test ? answeredCount === test.questions.length : false;
  const isMathMode = Boolean(test?.is_math_mode);

  const submittedAnswers = useMemo<SubmittedAnswer[]>(
    () =>
      Object.entries(answers)
        .filter(([, answer]) => answer.trim())
        .map(([question_id, answer]) => ({ question_id: Number(question_id), answer })),
    [answers],
  );

  async function handleSubmit() {
    if (!test || !canSubmit) return;
    setIsSubmitting(true);
    try {
      const result = await submitAttempt(test.id, submittedAnswers);
      sessionStorage.setItem(`nosey_attempt_${result.attempt_id}`, JSON.stringify(result));
      navigate(`/results/${result.attempt_id}`);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Unable to submit this test.");
      setIsSubmitting(false);
    }
  }

  if (!test || !question) {
    if (error) {
      return (
        <div className="page page-narrow">
          <EmptyState
            icon={<ArrowLeft />}
            title="Test not available"
            body={error}
            action={
              <Link to="/dashboard">
                <Button>Back to Dashboard</Button>
              </Link>
            }
          />
        </div>
      );
    }
    return (
      <div className="page centered-block">
        <span className="loader" />
      </div>
    );
  }

  const isLast = index === test.questions.length - 1;

  return (
    <div className="test-screen">
      <div className="test-progress">
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <header>
          <Link className="back-link" to="/dashboard">
            <ArrowLeft size={16} />
            Dashboard
          </Link>
          <div>
            <strong>
              {test.title}
              {isMathMode && (
                <span className="math-mode-badge">
                  <Calculator size={12} />
                  Math
                </span>
              )}
            </strong>
            <span>
              Question {index + 1} of {test.questions.length} · {answeredCount} answered
            </span>
          </div>
        </header>
      </div>

      <main className="question-wrap">
        <Card className="question-card">
          <span className="pill">{question.type === "MCQ" ? "Multiple choice" : "Free response"}</span>
          <h1>{question.question_text}</h1>
          {question.type === "MCQ" ? (
            <MCQQuestion question={question} answer={answers[question.id]} onAnswer={(answer) => setAnswers({ ...answers, [question.id]: answer })} />
          ) : isMathMode ? (
            <MathInput
              value={answers[question.id] ?? ""}
              onChange={(val) => setAnswers({ ...answers, [question.id]: val })}
            />
          ) : (
            <TextArea
              label="Your answer"
              value={answers[question.id] ?? ""}
              onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}
              placeholder="Use the details from your notes..."
            />
          )}
        </Card>

        <div className="question-nav">
          <Button variant="secondary" disabled={index === 0} icon={<ArrowLeft size={18} />} onClick={() => setIndex(index - 1)}>
            Previous
          </Button>
          {isLast ? (
            <Button disabled={!canSubmit || isSubmitting} icon={<Send size={18} />} onClick={handleSubmit}>
              {isSubmitting ? "Submitting..." : "Submit"}
            </Button>
          ) : (
            <Button icon={<ArrowRight size={18} />} onClick={() => setIndex(index + 1)}>
              Next
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}

function MCQQuestion({
  question,
  answer,
  onAnswer,
}: {
  question: Question;
  answer?: string;
  onAnswer: (answer: string) => void;
}) {
  return (
    <div className="option-grid">
      {question.options.map((option, optionIndex) => {
        const selected = answer === option.text;
        return (
          <button className={`option-button ${selected ? "selected" : ""}`} key={option.id} onClick={() => onAnswer(option.text)} type="button">
            <span>{String.fromCharCode(65 + optionIndex)}</span>
            <strong>{option.text}</strong>
            {selected ? <Check size={18} /> : null}
          </button>
        );
      })}
    </div>
  );
}
