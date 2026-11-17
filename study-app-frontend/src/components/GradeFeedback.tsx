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

const STEP_WRAPPERS = [/^\$\$([\s\S]*)\$\$$/, /^\\\[([\s\S]*)\\\]$/, /^\$([^$]*)\$$/];

/** A step's expression as display maths, or null when it is not maths.
 * Graders sometimes delimit it themselves (stray "$$" on screen) or put a
 * sentence in it (rendered as maths with the spaces gone). The description
 * already says it in words, so prose is dropped. Mirrors
 * clean_step_expression in latex_utils.py, which cleans new grades; this
 * also repairs grades saved before that. */
export function stepExpressionMarkdown(raw: string): string | null {
  let text = raw.trim();
  for (const pattern of STEP_WRAPPERS) {
    const match = text.match(pattern);
    if (match) {
      text = match[1].trim();
      break;
    }
  }
  if (!text || text.includes("$")) return null;
  const words = text
    .replace(/\\text\{([^{}]*)\}/g, " $1 ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .match(/[a-zA-Z]{4,}/g);
  if (words && words.length >= 3) return null;
  return `$$${text}$$`;
}

function StepList({ steps }: { steps: FeedbackStep[] }) {
  return (
    <ol className="gf-steps">
      {steps.map((step, index) => {
        const maths = step.expression ? stepExpressionMarkdown(step.expression) : null;
        return (
          <li key={index}>
            <MarkdownContent content={step.description} />
            {maths ? <MarkdownContent content={maths} /> : null}
          </li>
        );
      })}
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
