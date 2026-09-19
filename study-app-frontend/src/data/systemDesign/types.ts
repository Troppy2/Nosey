/**
 * The shape of one System Design concept. Content is static and bundled with
 * the frontend: never in the database, never generated at runtime. The backend
 * stores user state only, keyed by the ids declared here.
 */

export type ConceptFile = {
  /** A Python module basename, e.g. "cache.py". Becomes a tab in the workspace. */
  name: string;
  /** Starter code. May be an empty string. */
  contents: string;
  /** Shown but not editable, e.g. a provided backing store the learner codes against. */
  readonly?: boolean;
};

export type ExerciseKind = "visualizer" | "project";

export type Exercise = {
  kind: ExerciseKind;
  title: string;
  /** Markdown: what to build, and the constraints it has to hold to. */
  brief: string;
  files: ConceptFile[];
  /** Ids into SD_MOCK_PACKAGES. "sim" is always available and need not be listed. */
  mockPackages: string[];
  /** The hidden test module. Authored, never shown, never editable. */
  testModule: string;
  /** Markdown: which sim.record(...) calls the learner adds, and where. */
  simGuide?: string;
};

export type QuizMcq = {
  id: string;
  prompt: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
};

export type QuizFrq = {
  id: string;
  prompt: string;
  /** Model-answer bullet points. Sent to the grader as the expected answer. */
  rubric: string;
};

export type ConceptVideo = { title: string; youtubeId: string };

export type Concept = {
  /** Matches the backend concept_id: lowercase, digits and hyphens only. */
  id: string;
  order: number;
  title: string;
  /** One line for the track list card. */
  blurb: string;
  /** Markdown, the read-aloud article. */
  notes: string;
  /** null until a link is supplied. The sub-module and its checkbox still work. */
  video: ConceptVideo | null;
  visualizer: Exercise;
  project: Exercise;
  quiz: { mcq: QuizMcq[]; frq: QuizFrq[] };
};
