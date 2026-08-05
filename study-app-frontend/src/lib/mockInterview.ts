// Persistence for an in-progress Mock Interview.
//
// The interview flow spans several routes (setup, stage1, stage2, stage3,
// summary). Previously all cross-page state lived only in React Router's
// location.state, so a refresh wiped everything (Stage 1 even re-rolled to new
// problems). This module snapshots the whole run to localStorage, user-scoped
// via scopeKey, so any page can rehydrate on reload and the setup screen can
// offer a "Resume" entry point.
//
// localStorage is the fast path, not the source of truth: every save also pushes
// the snapshot to the server (debounced, flushed on tab hide/close), and
// hydrateMockProgress takes whichever copy is newer on mount. This is the same
// shape as KojoCode's code-workspace sync, and it is what lets a run survive a
// cleared cache or move to another device.

import { getMockInterviewSession, isGuestSession, scopeKey, syncMockProgress } from "./api";
import type { CompanyKey, InterviewLevel, InterviewProblem } from "../data/mockInterviewProblems";
import type {
  CodingProblemInfo,
  InterviewChatMessage,
  MockCustomConfig,
  ResumeScreenResult,
  Stage1QuestionResult,
} from "./types";

// A company selection is one of the built-in keys or "custom" (built from a job
// description). Kept as a union so localStorage snapshots survive both.
export type MockCompany = CompanyKey | "custom";

export type MockStageKey = "resume" | "stage1" | "stage2" | "stage3" | "summary";

export type ResumeProgress = {
  inputText: string;
  fileName: string | null;
  result: ResumeScreenResult | null;
  completed: boolean;
  // Resume deep dive (the grill that follows the scan). Optional because runs from
  // before this round existed, and runs that skipped it, have none.
  grillMessages?: InterviewChatMessage[];
  grillCoveredGoals?: string[];
  grillDone?: boolean;
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
  coveredGoals?: string[];
};

export type Stage3Progress = {
  messages: InterviewChatMessage[];
  isDone: boolean;
  coveredGoals?: string[];
};

export type MockProgress = {
  sessionId: number;
  company: MockCompany;
  level?: InterviewLevel;
  customCompany?: string;
  customConfig?: MockCustomConfig;
  selectedStages: string[];
  updatedAt: number;
  resume?: ResumeProgress;
  stage1?: Stage1Progress;
  stage2?: Stage2Progress;
  stage3?: Stage3Progress;
};

export type ActiveMockPointer = {
  sessionId: number;
  company: MockCompany;
  level?: InterviewLevel;
  customCompany?: string;
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

// Debounced cloud push. Stage pages save on nearly every keystroke, so pushing on
// each save would hammer the API; the snapshot is coalesced and sent once things go
// quiet, and flushed immediately when the tab is hidden or closed.
const CLOUD_SYNC_DELAY_MS = 1500;
let cloudTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCloud: { sessionId: number; body: string } | null = null;
let flushListenersBound = false;

function pushPendingCloudSync(): void {
  if (!pendingCloud) return;
  const { sessionId, body } = pendingCloud;
  pendingCloud = null;
  if (cloudTimer) {
    clearTimeout(cloudTimer);
    cloudTimer = null;
  }
  // Best effort: localStorage already has the snapshot, so a failed push just means
  // this device stays ahead of the server until the next save.
  syncMockProgress(sessionId, body).catch(() => {});
}

function bindFlushListeners(): void {
  if (flushListenersBound || typeof window === "undefined") return;
  flushListenersBound = true;
  window.addEventListener("beforeunload", pushPendingCloudSync);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") pushPendingCloudSync();
  });
}

function scheduleCloudSync(record: MockProgress): void {
  if (isGuestSession()) return;
  bindFlushListeners();
  // Only one push is ever pending. If it belongs to a different session (the user
  // navigated between runs inside the debounce window) flush it first, otherwise
  // that session's last edit would be dropped on the floor.
  if (pendingCloud && pendingCloud.sessionId !== record.sessionId) {
    pushPendingCloudSync();
  }
  pendingCloud = { sessionId: record.sessionId, body: JSON.stringify(record) };
  if (cloudTimer) clearTimeout(cloudTimer);
  cloudTimer = setTimeout(pushPendingCloudSync, CLOUD_SYNC_DELAY_MS);
}

export function saveMockProgress(progress: MockProgress): void {
  const record: MockProgress = { ...progress, updatedAt: Date.now() };
  try {
    localStorage.setItem(progressKey(progress.sessionId), JSON.stringify(record));
    const pointer: ActiveMockPointer = {
      sessionId: record.sessionId,
      company: record.company,
      level: record.level,
      customCompany: record.customCompany,
      selectedStages: record.selectedStages,
      updatedAt: record.updatedAt,
    };
    localStorage.setItem(scopeKey(ACTIVE_KEY), JSON.stringify(pointer));
  } catch {
    // Storage full or unavailable. The cloud push below still runs, so the run is
    // not lost, it just will not survive a reload offline.
  }
  scheduleCloudSync(record);
}

// Reconcile local and server snapshots for one session and return the winner.
// Newer updatedAt wins outright: both copies describe the same forward-only run, so
// the later write is strictly more complete. A server win is written back to
// localStorage so the rest of the page can keep reading locally as before.
export async function hydrateMockProgress(sessionId: number): Promise<MockProgress | null> {
  const local = loadMockProgress(sessionId);
  if (isGuestSession()) return local;
  let remote: MockProgress | null = null;
  try {
    const session = await getMockInterviewSession(sessionId);
    if (!session?.progress_json) return local;
    const parsed = JSON.parse(session.progress_json) as MockProgress;
    if (!parsed || parsed.sessionId !== sessionId) return local;
    if (local && local.updatedAt >= (parsed.updatedAt ?? 0)) return local;
    remote = parsed;
  } catch {
    // Offline, or the session is gone: carry on with whatever is local.
    return local;
  }

  // Caching the winner locally is an optimisation, so a full storage quota must not
  // cost us the newer snapshot we just fetched.
  try {
    localStorage.setItem(progressKey(sessionId), JSON.stringify(remote));
    const pointer: ActiveMockPointer = {
      sessionId: remote.sessionId,
      company: remote.company,
      level: remote.level,
      customCompany: remote.customCompany,
      selectedStages: remote.selectedStages,
      updatedAt: remote.updatedAt,
    };
    localStorage.setItem(scopeKey(ACTIVE_KEY), JSON.stringify(pointer));
  } catch {
    // Storage unavailable. The run still resumes, it just re-fetches next time.
  }
  return remote;
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
