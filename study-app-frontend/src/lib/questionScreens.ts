import type { Question } from "./types";

// Multi-part problems (GH #151): the parts of one problem share a group and
// sit next to each other in display order, so they are shown on one screen
// under their setup. Every other question is a screen of its own.

export type QuestionScreens = {
  // Question indexes per screen, in order.
  screens: number[][];
  // The screen each question index belongs to.
  screenOf: number[];
};

export function buildScreens(questions: Question[]): QuestionScreens {
  const screens: number[][] = [];
  const screenOf: number[] = [];
  questions.forEach((question, index) => {
    const groupId = question.group?.id;
    const previous = index > 0 ? questions[index - 1] : undefined;
    const joinsPrevious = groupId != null && previous?.group?.id === groupId && screens.length > 0;
    if (joinsPrevious) {
      screens[screens.length - 1].push(index);
    } else {
      screens.push([index]);
    }
    screenOf.push(screens.length - 1);
  });
  return { screens, screenOf };
}

// The first question of the screen holding `index`: the anchor the page keeps
// its position on, so a saved position inside a problem lands at its top.
export function screenAnchor(built: QuestionScreens, index: number): number {
  const screen = built.screenOf[index];
  return screen === undefined ? index : built.screens[screen][0];
}

// A part with its setup in front, for anything that reads it on its own
// (Kojo's context, the scratch pad header).
export function fullQuestionText(question: Question): string {
  const stem = question.group?.stem?.trim();
  if (!stem) return question.question_text;
  const part = question.part_label ? `(${question.part_label}) ` : "";
  return `${stem}\n\n${part}${question.question_text}`;
}
