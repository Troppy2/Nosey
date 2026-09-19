import type { Concept, Exercise } from "./types";

/**
 * Asserts a Concept is well formed. Used by content.test.ts and by nothing else
 * at runtime: content is authored, reviewed and bundled, so a broken concept is
 * a build-time failure rather than something to degrade around in the UI.
 */

const CONCEPT_ID_PATTERN = /^[a-z0-9-]{1,80}$/;
const MODULE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*\.py$/;
// U+2014, built from its code point so this file itself stays free of one.
const EM_DASH = String.fromCharCode(0x2014);
const MIN_NOTES_WORDS = 600;
const MAX_NOTES_WORDS = 1200;

function validateExercise(exercise: Exercise, label: string): string[] {
  const problems: string[] = [];

  if (!exercise.title.trim()) problems.push(`${label}: title is empty`);
  if (!exercise.brief.trim()) problems.push(`${label}: brief is empty`);
  if (!exercise.files.length) problems.push(`${label}: has no files`);
  if (!exercise.files.some((file) => !file.readonly)) {
    problems.push(`${label}: has no editable file`);
  }

  const names = exercise.files.map((file) => file.name);
  if (new Set(names).size !== names.length) {
    problems.push(`${label}: duplicate file names`);
  }
  for (const name of names) {
    if (!MODULE_NAME_PATTERN.test(name)) {
      problems.push(`${label}: "${name}" is not a plain Python module basename`);
    }
    if (name === "_sd_tests.py" || name === "sim.py") {
      problems.push(`${label}: "${name}" is reserved by the harness`);
    }
  }

  if (!exercise.testModule.trim()) {
    problems.push(`${label}: testModule is empty`);
  } else if (!/def\s+run_tests\s*\(/.test(exercise.testModule)) {
    problems.push(`${label}: testModule does not define run_tests()`);
  }

  return problems;
}

export function validateConcept(concept: Concept): string[] {
  const problems: string[] = [];

  if (!CONCEPT_ID_PATTERN.test(concept.id)) {
    problems.push(`id "${concept.id}" is not lowercase letters, digits and hyphens`);
  }
  if (!Number.isInteger(concept.order) || concept.order < 1) {
    problems.push("order must be a positive integer");
  }
  if (!concept.title.trim()) problems.push("title is empty");
  if (!concept.blurb.trim()) problems.push("blurb is empty");

  const words = concept.notes.trim() ? concept.notes.trim().split(/\s+/).length : 0;
  if (words < MIN_NOTES_WORDS || words > MAX_NOTES_WORDS) {
    problems.push(`notes are ${words} words, expected ${MIN_NOTES_WORDS} to ${MAX_NOTES_WORDS}`);
  }

  if (concept.visualizer.kind !== "visualizer") problems.push("visualizer has the wrong kind");
  if (concept.project.kind !== "project") problems.push("project has the wrong kind");
  problems.push(...validateExercise(concept.visualizer, "visualizer"));
  problems.push(...validateExercise(concept.project, "project"));

  if (concept.quiz.mcq.length !== 3) {
    problems.push(`quiz has ${concept.quiz.mcq.length} mcq, expected 3`);
  }
  if (concept.quiz.frq.length !== 5) {
    problems.push(`quiz has ${concept.quiz.frq.length} frq, expected 5`);
  }
  for (const question of concept.quiz.mcq) {
    if (question.options.length !== 4) {
      problems.push(`mcq "${question.id}" has ${question.options.length} options, expected 4`);
    }
    if (question.correctIndex < 0 || question.correctIndex > 3) {
      problems.push(`mcq "${question.id}" has a correctIndex out of range`);
    }
    if (!question.prompt.trim()) problems.push(`mcq "${question.id}" has an empty prompt`);
    if (question.options.some((option) => !option.trim())) {
      problems.push(`mcq "${question.id}" has an empty option`);
    }
  }
  for (const question of concept.quiz.frq) {
    if (!question.prompt.trim()) problems.push(`frq "${question.id}" has an empty prompt`);
    if (!question.rubric.trim()) problems.push(`frq "${question.id}" has an empty rubric`);
  }

  const ids = [...concept.quiz.mcq, ...concept.quiz.frq].map((question) => question.id);
  if (new Set(ids).size !== ids.length) problems.push("quiz question ids are not unique");

  if (concept.video && !concept.video.youtubeId.trim()) {
    problems.push("video is set but has no youtubeId");
  }

  // Cheapest possible enforcement of .claude/rules/no-emdash.md for content.
  const sources = [
    concept.title,
    concept.blurb,
    concept.notes,
    concept.visualizer.brief,
    concept.project.brief,
  ];
  if (sources.some((source) => source.includes(EM_DASH))) {
    problems.push("content contains an em dash");
  }

  return problems;
}
