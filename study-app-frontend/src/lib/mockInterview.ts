// Local persistence for an in-progress Mock Interview.
//
// The interview flow spans several routes (setup, stage1, stage2, stage3,
// summary). Previously all cross-page state lived only in React Router's
// location.state, so a refresh wiped everything (Stage 1 even re-rolled to new
// problems). This module snapshots the whole run to localStorage, user-scoped
// via scopeKey, so any page can rehydrate on reload and the setup screen can
// offer a "Resume" entry point.

import { scopeKey } from "./api";
import type { CompanyKey, InterviewProblem } from "../data/mockInterviewProblems";
import type {
  CodingProblemInfo,
  InterviewChatMessage,
  ResumeScreenResult,
  Stage1QuestionResult,
} from "./types";

export type MockStageKey = "resume" | "stage1" | "stage2" | "stage3" | "summary";

export type ResumeProgress = {
  inputText: string;
  fileName: string | null;
  result: ResumeScreenResult | null;
  completed: boolean;
};

export type Stage1QuestionProgress = {
  slug: string;
  title: string;
  difficulty: string;
  topics: string[];
  code: string;
  notes: string;
  timeUsedMs: number;
  // Epoch ms when this question's clock is running, 0 when paused. Persisting
  // an absolute timestamp keeps the OA clock honest across a reload (time does
  // not pause while the candidate is away, just like a real assessment).
  startedAt: number;
  isExpired: boolean;
  ranOnce: boolean;
  lastTestsPassed: number;
  lastTestsTotal: number;
  lastAllPassed: boolean;
};

export type Stage1Progress = {
  problems: InterviewProblem[];
  questions: Stage1QuestionProgress[];
  currentIdx: number;
  submitted: boolean;
  results?: Stage1QuestionResult[];
};

export type Stage2Progress = {
  messages: InterviewChatMessage[];
  codingProblem: CodingProblemInfo | null;
  code: string;
  codeFeedback: string | null;
  submitted: boolean;
};

export type Stage3Progress = {
  messages: InterviewChatMessage[];
  isDone: boolean;
};

export type MockProgress = {
  sessionId: number;
  company: CompanyKey;
  selectedStages: string[];
  updatedAt: number;
  resume?: ResumeProgress;
  stage1?: Stage1Progress;
  stage2?: Stage2Progress;
  stage3?: Stage3Progress;
};

export type ActiveMockPointer = {
  sessionId: number;
  company: CompanyKey;
  selectedStages: string[];
  updatedAt: number;
};

const ACTIVE_KEY = "nosey_mock_active";

function progressKey(sessionId: number): string {
  return scopeKey(`nosey_mock_${sessionId}`);
}

export function loadMockProgress(sessionId: number): MockProgress | null {
  try {
    const raw = localStorage.getItem(progressKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MockProgress;
    if (!parsed || parsed.sessionId !== sessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveMockProgress(progress: MockProgress): void {
  try {
    const record: MockProgress = { ...progress, updatedAt: Date.now() };
    localStorage.setItem(progressKey(progress.sessionId), JSON.stringify(record));
    const pointer: ActiveMockPointer = {
      sessionId: record.sessionId,
      company: record.company,
      selectedStages: record.selectedStages,
      updatedAt: record.updatedAt,
    };
    localStorage.setItem(scopeKey(ACTIVE_KEY), JSON.stringify(pointer));
  } catch {
    // Storage full or unavailable. Progress just will not survive a reload.
  }
}

export function clearMockProgress(sessionId: number): void {
  try {
    localStorage.removeItem(progressKey(sessionId));
    const active = getActiveMockSession();
    if (active && active.sessionId === sessionId) {
      localStorage.removeItem(scopeKey(ACTIVE_KEY));
    }
  } catch {
    // ignore
  }
}

export function getActiveMockSession(): ActiveMockPointer | null {
  try {
    const raw = localStorage.getItem(scopeKey(ACTIVE_KEY));
    if (!raw) return null;
    return JSON.parse(raw) as ActiveMockPointer;
  } catch {
    return null;
  }
}

export function clearActiveMockSession(): void {
  try {
    localStorage.removeItem(scopeKey(ACTIVE_KEY));
  } catch {
    // ignore
  }
}

// Routes the user to the correct page for a resumed session based on how far
// the saved progress got.
export function resumeRouteFor(progress: MockProgress): string {
  const { sessionId, selectedStages, resume, stage1, stage2, stage3 } = progress;
  if (selectedStages.includes("resume") && !resume?.completed) {
    return `/mock-interview/${sessionId}/resume`;
  }
  if (selectedStages.includes("stage1") && !stage1?.submitted) {
    return `/mock-interview/${sessionId}/stage1`;
  }
  if (selectedStages.includes("stage1") && stage1?.submitted && stage1?.results && !stage2 && !stage3) {
    // Stage 1 graded but no later stage started yet.
    if (selectedStages.includes("stage2")) return `/mock-interview/${sessionId}/stage2`;
    if (selectedStages.includes("stage3")) return `/mock-interview/${sessionId}/stage3`;
    return `/mock-interview/${sessionId}/summary`;
  }
  if (selectedStages.includes("stage2") && !stage2?.submitted) {
    return `/mock-interview/${sessionId}/stage2`;
  }
  if (selectedStages.includes("stage3") && !stage3?.isDone) {
    return `/mock-interview/${sessionId}/stage3`;
  }
  return `/mock-interview/${sessionId}/summary`;
}
