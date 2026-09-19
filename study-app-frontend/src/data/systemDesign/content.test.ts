import { describe, expect, it } from "vitest";

import { markdownToSpeech } from "../../components/episodeSpeech";
import { SD_CONCEPTS } from "./index";
import { validateConcept } from "./validate";
import type { Concept, Exercise } from "./types";

/**
 * Content invariants, checked against every concept in the registry. This file
 * never changes when a concept is added, so it guards every future content PR
 * for free.
 */

const EM_DASH = "\u2014";

function sourceStrings(concept: Concept): string[] {
  const exerciseStrings = (exercise: Exercise) => [
    exercise.title,
    exercise.brief,
    exercise.simGuide ?? "",
    exercise.testModule,
    ...exercise.files.map((file) => file.name),
    ...exercise.files.map((file) => file.contents),
  ];
  return [
    concept.title,
    concept.blurb,
    concept.notes,
    ...exerciseStrings(concept.visualizer),
    ...exerciseStrings(concept.project),
    ...concept.quiz.mcq.flatMap((question) => [question.prompt, ...question.options]),
    ...concept.quiz.frq.flatMap((question) => [question.prompt, question.rubric]),
  ];
}

describe.each(SD_CONCEPTS.map((concept) => [concept.id, concept] as const))(
  "concept content: %s",
  (_id, concept) => {
    it("passes validateConcept with no reported problems", () => {
      expect(validateConcept(concept)).toEqual([]);
    });

    it("has exactly 3 mcq and 5 frq", () => {
      expect(concept.quiz.mcq).toHaveLength(3);
      expect(concept.quiz.frq).toHaveLength(5);
    });

    it("gives every mcq four options and a correctIndex in range", () => {
      for (const question of concept.quiz.mcq) {
        expect(question.options).toHaveLength(4);
        expect(question.correctIndex).toBeGreaterThanOrEqual(0);
        expect(question.correctIndex).toBeLessThanOrEqual(3);
      }
    });

    it("gives every frq a non-empty rubric", () => {
      for (const question of concept.quiz.frq) {
        expect(question.rubric.trim().length).toBeGreaterThan(0);
      }
    });

    it("keeps quiz question ids unique within the concept", () => {
      const ids = [...concept.quiz.mcq, ...concept.quiz.frq].map((question) => question.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("has notes between 600 and 1200 words", () => {
      const words = concept.notes.trim().split(/\s+/).length;
      expect(words).toBeGreaterThanOrEqual(600);
      expect(words).toBeLessThanOrEqual(1200);
    });

    it("gives both exercises at least one editable file", () => {
      for (const exercise of [concept.visualizer, concept.project]) {
        expect(exercise.files.some((file) => !file.readonly)).toBe(true);
      }
    });

    it("uses unique .py basenames for every exercise file", () => {
      for (const exercise of [concept.visualizer, concept.project]) {
        const names = exercise.files.map((file) => file.name);
        expect(new Set(names).size).toBe(names.length);
        for (const name of names) {
          expect(name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*\.py$/);
        }
      }
    });

    it("gives both exercises a test module that defines run_tests", () => {
      for (const exercise of [concept.visualizer, concept.project]) {
        expect(exercise.testModule.length).toBeGreaterThan(0);
        expect(exercise.testModule).toMatch(/def\s+run_tests\s*\(/);
      }
    });

    it("uses LF line endings everywhere", () => {
      for (const source of sourceStrings(concept)) {
        expect(source).not.toContain("\r");
      }
    });

    it("contains no em dash in any source string", () => {
      for (const source of sourceStrings(concept)) {
        expect(source).not.toContain(EM_DASH);
      }
    });

    it("produces read-aloud text with no markup left in it", () => {
      const spoken = markdownToSpeech(concept.notes);
      expect(spoken).not.toContain("`");
      expect(spoken).not.toContain("|");
      expect(spoken).not.toContain("#");
    });
  },
);
