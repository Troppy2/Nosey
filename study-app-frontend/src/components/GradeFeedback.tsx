import type { ReactNode } from "react";
import type { AnswerResult, FeedbackSections, FeedbackStep } from "../lib/types";
import { CollapsibleSection } from "./CollapsibleSection";
import { MarkdownContent } from "./MarkdownContent";
import "../styles/components/grade-feedback.css";

export type GradeState = "right" | "check" | "wrong";

// Right with a note and a flag means the final value was right but the work
// had a flaw (a bad line, or a value never labeled or finished).
export function gradeState(answer: Pick<AnswerResult, "is_correct" | "flagged_uncertain">, sections: FeedbackSections): GradeState {
  if (!answer.is_correct) return "wrong";
  return answer.flagged_uncertain && sections.note ? "check" : "right";
}

const VERDICT: Record<GradeState, string> = {
  right: "Right",
  check: "Right, check your work",
  wrong: "Wrong",
};

function Row({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`gf-row${className ? ` ${className}` : ""}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function StepList({ steps }: { steps: FeedbackStep[] }) {
  return (
    <ol className="gf-steps">
      {steps.map((step, index) => (
        <li key={index}>
          <MarkdownContent content={step.description} />
          {step.expression ? <MarkdownContent content={`$$${step.expression}$$`} /> : null}
        </li>
      ))}
    </ol>
  );
}

/** Graded feedback laid out as a ledger (spec-grading-feedback-v2, option C):
 * a verdict rail, then note / fix / key steps / answer, full solution folded. */
export function GradeFeedback({ answer, sections }: { answer: AnswerResult; sections: FeedbackSections }) {
  const state = gradeState(answer, sections);
  const reasoning = answer.reasoning?.trim();
  const hasSolution = sections.steps.length > 0 || Boolean(reasoning);

  return (
    <section className={`gf gf--${state}`} aria-label="Feedback">
      <p className="gf-verdict">{VERDICT[state]}</p>
      <dl className="gf-list">
        {sections.note ? (
          <Row label="Note">
            <MarkdownContent content={sections.note} />
          </Row>
        ) : null}
        {sections.what_to_fix ? (
          <Row label="Fix" className="gf-fix">
            <MarkdownContent content={sections.what_to_fix} />
          </Row>
        ) : null}
        {sections.key_steps.length > 0 ? (
          <Row label="Key steps">
            <StepList steps={sections.key_steps} />
          </Row>
        ) : null}
        {sections.graph ? (
          <Row label="Graph">
            <MarkdownContent content={sections.graph} />
          </Row>
        ) : null}
        {sections.final_answer ? (
          <Row label="Answer" className="gf-answer">
            <MarkdownContent content={sections.final_answer} />
          </Row>
        ) : null}
      </dl>
      {hasSolution ? (
        <CollapsibleSection title={answer.is_correct ? "Reasoning" : "Full solution"}>
          {sections.steps.length > 0 ? <StepList steps={sections.steps} /> : <MarkdownContent content={reasoning ?? ""} />}
        </CollapsibleSection>
      ) : null}
    </section>
  );
}
