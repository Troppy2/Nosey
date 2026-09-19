import { SD_SIM_SOURCE } from "../../lib/sdHarness";
import { caching } from "./caching/meta";
import { consistentHashing } from "./consistent-hashing/meta";
import type { Concept } from "./types";

export type {
  Concept,
  ConceptFile,
  ConceptVideo,
  Exercise,
  ExerciseKind,
  QuizFrq,
  QuizMcq,
} from "./types";

/** The track, in order. Content is static and bundled: never in the DB. */
export const SD_CONCEPTS: Concept[] = [caching, consistentHashing].sort((a, b) => a.order - b.order);

export function getConcept(id: string | undefined): Concept | null {
  if (!id) return null;
  return SD_CONCEPTS.find((concept) => concept.id === id) ?? null;
}

/**
 * Importable modules an exercise can be given, keyed by the id an Exercise
 * lists in mockPackages. sim is always written by the harness whether an
 * exercise asks for it or not.
 */
export const SD_MOCK_PACKAGES: Record<string, string> = {
  sim: SD_SIM_SOURCE,
};

/** Turn an exercise's mockPackages ids into the {filename: source} map the runner writes. */
export function resolveMockPackages(ids: string[]): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const id of ids) {
    const source = SD_MOCK_PACKAGES[id];
    if (source !== undefined) resolved[`${id}.py`] = source;
  }
  return resolved;
}

/** "<conceptId>:<visualizer|project>", the id the backend keys submissions by. */
export function exerciseId(conceptId: string, kind: "visualizer" | "project"): string {
  return `${conceptId}:${kind}`;
}
