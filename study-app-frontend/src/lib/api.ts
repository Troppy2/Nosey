import type {
  AdminStats,
  AdminSurveysResponse,
  AdminTokenResponse,
  AdminUserRow,
  AttemptDetail,
  AttemptResult,
  RedoAnswerResponse,
  AttemptSummary,
  ConversationFile,
  CreateTestResult,
  AuthUser,
  DraftAttemptAnswer,
  DraftAttemptResponse,
  InterviewChatMessage,
  ID,
  KojoClearResponse,
  KojoClearedConversation,
  Flashcard,
  FlashcardUpdate,
  Folder,
  KojoActionCard,
  KojoActionType,
  KojoBootstrap,
  KojoChatResponse,
  KojoTestRef,
  KojoConversation,
  KojoConversationSummary,
  KojoMemory,
  LCCustomProblem,
  LCGeneratedCustomProblem,
  LearningModule,
  LearningTrack,
  ModuleEpisode,
  CheckpointAnswerResult,
  QuizAttemptResult,
  LeetCodeComplexityCheckResponse,
  LeetCodeGradeResponse,
  LeetCodeHintResponse,
  LeetCodeProblemData,
  KojoRestoreResponse,
  MockCustomConfig,
  MockInterviewSession,
  MockInterviewFinishResponse,
  JDParseResponse,
  ResumeScreenResult,
  Stage1GradeResponse,
  Stage2MessageResponse,
  Stage3MessageResponse,
  ProviderStatus,
  QuestionCreate,
  QuestionEditable,
  QuestionGroup,
  QuestionUpdate,
  ResumableTestInfo,
  ReviewSummaryResponse,
  SavedJDParsed,
  SavedJobDescription,
  SlashCommand,
  SlashCommandInput,
  SubmittedAnswer,
  SurveyFeature,
  SystemDesignClientSubModule,
  SystemDesignProgress,
  SystemDesignQuizGradePayload,
  SystemDesignQuizResult,
  SystemDesignSubmission,
  TestBlueprint,
  TestSummary,
  TestTake,
  TokenUsageReport,
  UsageLimits,
} from "./types";
import { reportBackendHttpFailure, reportBackendNetworkFailure } from "./backendStatus";
import { getDeviceId } from "./deviceId";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "https://noesy.onrender.com";
const TOKEN_KEY = "nosey_access_token";
const USER_KEY = "nosey_user";
// Local mirror of users.onboarding_completed_at. Defined here rather than in
// the component so api.ts does not have to import from the component tree.
export const ONBOARDING_DONE_KEY = "nosey_onboarding_done";
const GUEST_TOKEN = "nosey_guest_token";

// Returns true if there is a non-guest JWT in localStorage whose `exp` claim
// has not yet passed. Guest tokens are excluded because they use a sentinel
// string value rather than a real JWT.
export function hasValidSession(): boolean {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token || token === GUEST_TOKEN) return false;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return typeof payload.exp === "number" && Date.now() / 1000 < payload.exp;
  } catch {
    return false;
  }
}

// True when someone is in an active session: a signed-in user, a guest, or
// the local-dev sentinel token. Anonymous visitors have no token and should be
// routed to the landing/login page rather than dropped onto a broken dashboard.
export function isAuthenticated(): boolean {
  return hasValidSession() || isGuestSession() || localStorage.getItem(TOKEN_KEY) !== null;
}

// Sanitizes a post-login redirect target so we only ever navigate to an
// internal, same-origin path. Prevents open-redirect abuse via a crafted
// `?redirect=` query param (e.g. `//evil.com`, `https://evil.com`, or a
// backslash trick). Anything that is not a plain root-relative path falls back
// to the dashboard.
export function sanitizeRedirect(raw: string | null | undefined): string {
  const fallback = "/dashboard";
  if (!raw) return fallback;
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  // Must be a root-relative path. Reject protocol-relative ("//host"),
  // backslash tricks ("/\\host" and "\\host"), and absolute URLs ("https://host").
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.includes("://")) return fallback;
  // Reject control characters (code points below 0x20) that could smuggle a
  // redirect past the checks.
  if (Array.from(value).some((c) => c.charCodeAt(0) < 0x20)) return fallback;
  return value;
}

type RequestOptions = RequestInit & {
  allowMock?: boolean;
};

// Wraps raw fetch so a failure to reach the server mounts the waiting screen
// instead of surfacing as a generic error. Two kinds of failure are reported:
// a network-level throw (no HTTP response at all), and a gateway status code
// (502/503/504), which is what Render's proxy returns while a free-tier
// instance is waking up. A 5xx like 500 or an app-generated 503 is not treated
// as down on its own: backendStatus re-checks /health before flipping, so a
// reachable app keeps its normal error handling. User-cancelled requests
// (AbortError from a stream/stop button) pass through untouched, they say
// nothing about the server.
async function guardedFetch(url: string, init: RequestInit): Promise<Response> {
  // Every backend call carries the device id: usage limits are enforced per
  // device as well as per account (see lib/deviceId.ts).
  const headers = new Headers(init.headers);
  headers.set("X-Device-Id", getDeviceId());
  try {
    const response = await fetch(url, { ...init, headers });
    reportBackendHttpFailure(response.status);
    return response;
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === "AbortError") throw err;
    reportBackendNetworkFailure();
    throw new Error("Unable to reach the server. It may be starting up, try again in a moment.");
  }
}

function formatApiErrorDetail(detail: unknown): string {
  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          const loc = Array.isArray(record.loc) ? record.loc.map(String).join(".") : "";
          const msg = typeof record.msg === "string" ? record.msg : null;
          if (loc && msg) {
            return `${loc}: ${msg}`;
          }
          if (msg) {
            return msg;
          }
          try {
            return JSON.stringify(item);
          } catch {
            return String(item);
          }
        }

        return String(item);
      })
      .filter((item) => item.length > 0);

    if (parts.length > 0) {
      return parts.join("; ");
    }
  }

  if (detail && typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    if (typeof record.message === "string") {
      return record.message;
    }
    if (typeof record.detail === "string") {
      return record.detail;
    }
    try {
      return JSON.stringify(detail);
    } catch {
      return String(detail);
    }
  }

  return String(detail);
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = new Headers(options.headers);

  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await guardedFetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401 && token && token !== GUEST_TOKEN) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      window.location.href = "/";
    }
    let message = `Request failed: ${response.status}`;
    try {
      const body = await response.json();
      if (body?.detail !== undefined) message = formatApiErrorDetail(body.detail);
    } catch { /* ignore parse errors */ }
    throw new Error(message);
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export function getStoredUser(): AuthUser | null {
  const value = localStorage.getItem(USER_KEY);
  return value ? (JSON.parse(value) as AuthUser) : null;
}

export function isGuestSession() {
  return getStoredUser()?.is_guest === true;
}

// Prefixes a localStorage key with the current user's ID so settings are
// isolated per user on a shared browser. Falls back to the bare key when no
// user is stored (e.g. during login or as a guest with no ID).
export function scopeKey(key: string): string {
  const user = getStoredUser();
  if (!user?.id) return key;
  return `${key}_u${user.id}`;
}

export async function guestSignIn(): Promise<AuthUser> {
  const data = await request<{ user_id: number; access_token: string; email: string; user: AuthUser }>("/auth/guest", { method: "POST" });
  localStorage.setItem(TOKEN_KEY, data.access_token);
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.user;
}

export function setGoogleSession() {
  const user: AuthUser = {
    id: 2,
    email: "signed.in@nosey.local",
    full_name: "Google User",
  };
  localStorage.setItem(TOKEN_KEY, "nosey_google_token");
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

export async function googleSignIn(idToken: string) {
  const res = await guardedFetch(`${API_BASE_URL}/auth/google`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token: idToken }),
  });

  if (!res.ok) {
    throw new Error(`Google sign-in failed: ${res.status}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    user_id: number;
    email: string;
    user: AuthUser;
  };

  localStorage.setItem(TOKEN_KEY, data.access_token);
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.user as AuthUser;
}

export function signOut() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// Fetches the current user fresh from the backend and refreshes the stored
// copy. Used to detect users whose age is null in the database (e.g. accounts
// created before the date-of-birth prompt existed) so they can be asked once.
export async function getMe(): Promise<AuthUser> {
  const user = await request<AuthUser>("/auth/me");
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

// Whether the first-run walkthrough has been finished or skipped.
//
// The account is the source of truth (users.onboarding_completed_at), so the
// answer survives a cleared cache, a second device, and a guest account being
// promoted to a real one. The localStorage mirror is only a same-tab cache so
// the walkthrough cannot flash on screen during the moment between mount and
// the /auth/me response.
export function hasCompletedOnboarding(): boolean {
  if (getStoredUser()?.onboarding_completed) return true;
  return localStorage.getItem(scopeKey(ONBOARDING_DONE_KEY)) === "true";
}

// Marks the walkthrough finished. Writes the local mirror first and never
// throws: a user who has just sat through the whole thing must not be shown it
// again because a network call failed, and the next successful /auth/me will
// reconcile the server copy anyway.
export async function completeOnboarding(): Promise<void> {
  localStorage.setItem(scopeKey(ONBOARDING_DONE_KEY), "true");
  try {
    const user = await request<AuthUser>("/auth/onboarding-complete", { method: "POST" });
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* Local mirror already set; the server catches up on the next sign-in. */
  }
}

// Clears both copies so the walkthrough can be replayed from Settings.
export async function resetOnboarding(): Promise<void> {
  localStorage.removeItem(scopeKey(ONBOARDING_DONE_KEY));
  const user = getStoredUser();
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify({ ...user, onboarding_completed: false, onboarding_completed_at: null }));
  }
}

// First-visit page tours. One per page, each runs once per account.
export type TourId =
  | "folders"
  | "folder-detail"
  | "create-test"
  | "learning-modes"
  | "flashcard-review"
  | "matching"
  | "manage-flashcards"
  | "kojo";

// Same-tab mirror of users.tours_seen, so a tour cannot replay in the moment
// before the POST lands. The account is the source of truth.
const TOURS_SEEN_KEY = "nosey_tours_seen";
// Unscoped list written while in a guest session. A guest who then signs in
// gets a new user id (and so a new scopeKey), and without this would be shown
// every tour they already sat through as a guest.
const GUEST_TOURS_SEEN_KEY = "nosey_guest_tours_seen";

function readTourList(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function addToTourList(key: string, id: string) {
  const list = readTourList(key);
  if (!list.includes(id)) localStorage.setItem(key, JSON.stringify([...list, id]));
}

// Whether the stored user copy knows about tours at all. A copy cached before
// tours_seen existed says nothing either way, so callers refresh via getMe()
// before deciding to show a tour to someone who may already be onboarded.
export function hasTourState(): boolean {
  return Array.isArray(getStoredUser()?.tours_seen);
}

export function hasSeenTour(id: TourId): boolean {
  if (getStoredUser()?.tours_seen?.includes(id)) return true;
  if (readTourList(scopeKey(TOURS_SEEN_KEY)).includes(id)) return true;
  return !isGuestSession() && readTourList(GUEST_TOURS_SEEN_KEY).includes(id);
}

// Records a tour as shown. Never throws, same reasoning as completeOnboarding:
// a failed POST must not replay a tour the user has already sat through.
export async function markTourSeen(id: TourId): Promise<void> {
  addToTourList(scopeKey(TOURS_SEEN_KEY), id);
  if (isGuestSession()) addToTourList(GUEST_TOURS_SEEN_KEY, id);
  try {
    const user = await request<AuthUser>("/auth/tours-seen", {
      method: "POST",
      body: JSON.stringify({ tour_id: id }),
    });
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* Local mirror already set. */
  }
}

// Settings > Replay page tips. Clears every copy, and waits for the server so
// the next /auth/me cannot hand the old list straight back.
export async function resetTours(): Promise<void> {
  localStorage.removeItem(scopeKey(TOURS_SEEN_KEY));
  localStorage.removeItem(GUEST_TOURS_SEEN_KEY);
  const user = await request<AuthUser>("/auth/tours-seen", { method: "DELETE" });
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

// Sets what the user wants to be called. Sending an empty string clears the
// preference and falls display back to the name on their Google account.
export async function updatePreferredName(name: string): Promise<AuthUser> {
  const user = await request<AuthUser>("/auth/preferred-name", {
    method: "POST",
    body: JSON.stringify({ preferred_name: name.trim() || null }),
  });
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

// The short name to greet someone by. A preferred name is used verbatim, since
// someone who asked to be called "JJ" did not ask to be called "JJ Something";
// a Google full name is still reduced to its first word, which is what the
// dashboard did before preferred names existed.
export function getGreetingName(): string {
  const user = getStoredUser();
  const preferred = user?.preferred_name?.trim();
  if (preferred) return preferred;

  const fullName = user?.full_name?.trim();
  if (fullName) return fullName.split(/\s+/)[0];

  const emailName = user?.email?.split("@")[0]?.trim();
  if (emailName) return emailName.charAt(0).toUpperCase() + emailName.slice(1);

  return "Unknown User";
}

export async function submitDateOfBirth(dob: string): Promise<AuthUser> {
  const user = await request<AuthUser>("/auth/date-of-birth", {
    method: "POST",
    body: JSON.stringify({ date_of_birth: dob }),
  });
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

export async function deleteAccount(): Promise<void> {
  await request<void>("/auth/account", { method: "DELETE" });
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function fetchFolders(): Promise<Folder[]> {
  try {
    return await request<Folder[]>("/folders");
  } catch {
    return [];
  }
}

export async function fetchFolder(folderId: number): Promise<Folder> {
  return request<Folder>(`/folders/${folderId}`);
}

export async function createFolder(input: Pick<Folder, "name" | "subject" | "description">): Promise<Folder> {
  if (isGuestSession()) {
    const folders = await fetchFolders();
    if (folders.length >= 1) {
      throw new Error("Guest accounts can only create one folder. Sign in to make more.");
    }
  }
  try {
    return await request<Folder>("/folders", {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (error) {
    throw error;
  }
}

export async function updateFolder(
  folderId: number,
  input: Partial<Pick<Folder, "name" | "subject" | "description" | "kojo_sync_default" | "kojo_allow_artifacts" | "kojo_auto_index" | "kojo_persona" | "is_archived">>,
): Promise<Folder> {
  return request<Folder>(`/folders/${folderId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function fetchArchivedFolders(): Promise<Folder[]> {
  try {
    return await request<Folder[]>("/folders/archived");
  } catch {
    return [];
  }
}

export async function unarchiveFolder(folderId: number): Promise<Folder> {
  return updateFolder(folderId, { is_archived: false });
}

export async function deleteFolder(folderId: number): Promise<void> {
  await request(`/folders/${folderId}`, {
    method: "DELETE",
  });
}

export async function fetchTests(folderId?: number): Promise<TestSummary[]> {
  try {
    if (folderId) {
      return await request<TestSummary[]>(`/folders/${folderId}/tests`);
    }
    return await request<TestSummary[]>("/tests");
  } catch {
    return [];
  }
}

export async function regenerateTest(
  testId: number,
  params?: {
    countMcq?: number;
    countFrq?: number;
    countTf?: number;
    countMs?: number;
    countRank?: number;
    difficulty?: string;
    topicFocus?: string;
    customInstructions?: string;
    provider?: string;
    enableFallback?: boolean;
  },
): Promise<CreateTestResult> {
  const body: Record<string, unknown> = {};
  if (params?.countMcq !== undefined) body.count_mcq = params.countMcq;
  if (params?.countFrq !== undefined) body.count_frq = params.countFrq;
  if (params?.countTf !== undefined) body.count_tf = params.countTf;
  if (params?.countMs !== undefined) body.count_ms = params.countMs;
  if (params?.countRank !== undefined) body.count_rank = params.countRank;
  if (params?.difficulty) body.difficulty = params.difficulty;
  if (params?.topicFocus) body.topic_focus = params.topicFocus;
  if (params?.customInstructions) body.custom_instructions = params.customInstructions;
  if (params?.provider) body.provider = params.provider;
  if (params?.enableFallback !== undefined) body.enable_fallback = params.enableFallback;
  return request(`/tests/${testId}/regenerate`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function createTest(input: {
  folderId: number;
  title: string;
  testType: string;
  // Inline uploads (older path). Create Test now uploads through the folder
  // pipeline first and passes fileIds / practiceTestFileId instead.
  files?: File[];
  fileIds?: number[];
  practiceTestFileId?: number | null;
  // recreate: rebuild the practice test's own questions. style: new questions
  // from the notes in the practice test's style.
  practiceTestMode?: "recreate" | "style";
  // Section indices from fetchPracticeSections; omitted means the whole document.
  practiceTestSections?: number[];
  // Picked problems as [start, end] offsets from fetchPracticeProblems (GH #138).
  practiceTestRanges?: [number, number][];
  // Questions the student checked in the review step; skips the server parse.
  practiceQuestions?: DraftQuestion[];
  countMcq?: number;
  countFrq?: number;
  countTf?: number;
  countMs?: number;
  countRank?: number;
  // Beta: some written questions become problems with a setup and parts.
  multiPart?: boolean;
  practiceTestFile?: File | null;
  isMathMode?: boolean;
  difficulty?: string;
  topicFocus?: string;
  isCodingMode?: boolean;
  codingLanguage?: string;
  customInstructions?: string;
  generationProvider?: string;
  enableFallback?: boolean;
}): Promise<CreateTestResult> {
  const MAX_NOTES_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024;
  if (isGuestSession()) {
    const tests = await fetchTests();
    if (tests.length >= 1) {
      throw new Error("Guest accounts can only create one practice test. Sign in to make more.");
    }
  }
  const files = input.files ?? [];
  const totalUploadBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalUploadBytes > MAX_NOTES_UPLOAD_TOTAL_BYTES) {
    throw new Error("Combined uploaded files exceed 100 MB.");
  }
  const formData = new FormData();
  formData.append("title", input.title);
  formData.append("test_type", input.testType);
  if (input.countMcq !== undefined) formData.append("count_mcq", String(input.countMcq));
  if (input.countFrq !== undefined) formData.append("count_frq", String(input.countFrq));
  if (input.countTf) formData.append("count_tf", String(input.countTf));
  if (input.countMs) formData.append("count_ms", String(input.countMs));
  if (input.countRank) formData.append("count_rank", String(input.countRank));
  if (input.multiPart) formData.append("multi_part", "true");
  if (input.isMathMode) formData.append("is_math_mode", "true");
  if (input.difficulty) formData.append("difficulty", input.difficulty);
  if (input.topicFocus) formData.append("topic_focus", input.topicFocus);
  if (input.isCodingMode) formData.append("is_coding_mode", "true");
  if (input.codingLanguage) formData.append("coding_language", input.codingLanguage);
  if (input.customInstructions) formData.append("custom_instructions", input.customInstructions);
  if (input.generationProvider) formData.append("provider", input.generationProvider);
  formData.append("enable_fallback", input.enableFallback === false ? "false" : "true");
  files.forEach((file) => formData.append("notes_files", file));
  if (input.practiceTestFile) formData.append("practice_test_file", input.practiceTestFile);
  input.fileIds?.forEach((id) => formData.append("file_ids", String(id)));
  if (input.practiceTestFileId != null) formData.append("practice_test_file_id", String(input.practiceTestFileId));
  if (input.practiceTestMode) formData.append("practice_test_mode", input.practiceTestMode);
  if (input.practiceTestSections?.length) {
    formData.append("practice_test_sections", input.practiceTestSections.join(","));
  }
  if (input.practiceTestRanges?.length) {
    formData.append("practice_test_ranges", input.practiceTestRanges.map(([a, b]) => `${a}-${b}`).join(","));
  }
  if (input.practiceQuestions?.length) {
    formData.append("practice_questions", JSON.stringify(input.practiceQuestions));
  }

  try {
    return await request(`/folders/${input.folderId}/tests`, {
      method: "POST",
      body: formData,
    });
  } catch (error) {
    throw error;
  }
}

export async function fetchQuestionsForEditing(testId: number): Promise<QuestionEditable[]> {
  return request<QuestionEditable[]>(`/tests/${testId}/edit`);
}

export async function addQuestion(testId: number, data: QuestionCreate): Promise<QuestionEditable> {
  return request<QuestionEditable>(`/tests/${testId}/questions`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateQuestion(
  testId: number,
  questionId: number,
  data: QuestionUpdate,
): Promise<QuestionEditable> {
  return request<QuestionEditable>(`/tests/${testId}/questions/${questionId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// A multi-part problem's setup, edited once for all its parts (GH #151).
// Editor "Prettier" (beta): reformatted versions of the questions whose layout
// changed, wording kept. Nothing is saved until each is applied.
export type PrettierProposal = {
  question_id: number;
  question_text: string;
  options: string[] | null;
  expected_answer: string | null;
};

export async function fetchPrettierProposals(testId: number): Promise<PrettierProposal[]> {
  return request<PrettierProposal[]>(`/tests/${testId}/questions/prettier`, { method: "POST" });
}

export async function updateQuestionGroup(
  testId: number,
  groupId: number,
  data: { stem: string; label?: string },
): Promise<QuestionGroup> {
  return request<QuestionGroup>(`/tests/${testId}/groups/${groupId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteQuestion(testId: number, questionId: number): Promise<void> {
  await request(`/tests/${testId}/questions/${questionId}`, { method: "DELETE" });
}

export async function updateTest(
  testId: number,
  input: { title?: string; description?: string | null },
): Promise<TestSummary> {
  return request<TestSummary>(`/tests/${testId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteTest(testId: number): Promise<void> {
  await request(`/tests/${testId}`, {
    method: "DELETE",
  });
}

export async function fetchTest(testId: number): Promise<TestTake> {
  try {
    return await request<TestTake>(`/tests/${testId}`);
  } catch {
    throw new Error("Unable to load test");
  }
}

export async function submitAttempt(
  testId: number,
  answers: SubmittedAnswer[],
  ocrEngine?: string,
): Promise<AttemptResult> {
  // Let the server's actual error through (payload too large, non-beta
  // rejection, etc.) rather than a generic message: STEM Scratch Pad
  // submissions can fail for reasons the student needs to read.
  return request<AttemptResult>(`/tests/${testId}/attempts`, {
    method: "POST",
    body: JSON.stringify({ answers, ...(ocrEngine ? { ocr_engine: ocrEngine } : {}) }),
  });
}

// One redo of an answer whose drawing could not be read (GH #149): a fixed
// drawing, a typed answer, or both. The server allows one per answer.
export async function redoAnswer(
  attemptId: number,
  questionId: number,
  body: { answer: string; work_image?: string | null },
): Promise<RedoAnswerResponse> {
  return request<RedoAnswerResponse>(`/attempts/${attemptId}/answers/${questionId}/redo`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Grade held answers without their drawing. No ids means all of them.
export async function skipUnreadableAnswers(attemptId: number, questionIds: number[] = []): Promise<RedoAnswerResponse> {
  return request<RedoAnswerResponse>(`/attempts/${attemptId}/answers/skip-unreadable`, {
    method: "POST",
    body: JSON.stringify({ question_ids: questionIds }),
  });
}

// Throws on failure: TakeTest retries and shows an unsaved notice (GH #137).
export async function saveDraftAttempt(testId: number, answers: DraftAttemptAnswer[]): Promise<DraftAttemptResponse> {
  return request<DraftAttemptResponse>(`/tests/${testId}/attempts/draft`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

// Browsers cap a keepalive request body at 64KB in total across in-flight
// keepalive requests; stay under it with headroom.
const KEEPALIVE_BODY_LIMIT = 60_000;

// Last-chance save when the page is closing or the test unmounts. A plain
// fetch is cancelled with the page; keepalive lets it finish. sendBeacon was
// used before but cannot send the Authorization header, so it always 401'd.
// Strokes are dropped if the body is too big: typed answers matter most, and
// the last autosave already holds the strokes up to a second ago.
export function saveDraftAttemptOnExit(testId: number, answers: DraftAttemptAnswer[]): void {
  const token = localStorage.getItem(TOKEN_KEY);
  let body = JSON.stringify({ answers });
  if (body.length > KEEPALIVE_BODY_LIMIT) {
    body = JSON.stringify({ answers: answers.map(({ work_strokes: _strokes, ...rest }) => rest) });
    if (body.length > KEEPALIVE_BODY_LIMIT) return;
  }
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  fetch(`${API_BASE_URL}/tests/${testId}/attempts/draft`, {
    method: "POST",
    headers,
    body,
    keepalive: true,
  }).catch(() => { /* page is going away; nothing to report to */ });
}

export async function getDraftAttempt(testId: number): Promise<DraftAttemptResponse | null> {
  try {
    return await request<DraftAttemptResponse>(`/tests/${testId}/attempts/draft`);
  } catch {
    return null;
  }
}

export async function getResumableTests(): Promise<ResumableTestInfo[]> {
  try {
    return await request<ResumableTestInfo[]>("/users/resumable-tests");
  } catch {
    return [];
  }
}

export async function createFlashcard(folderId: number, data: { front: string; back: string }): Promise<Flashcard> {
  return request<Flashcard>(`/folders/${folderId}/flashcards`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function generateFlashcards(
  folderId: number,
  input: { count?: number; prompt: string; sourceType?: "prompt" | "test"; testId?: number; provider?: string; enableFallback?: boolean },
): Promise<Flashcard[]> {
  const body: Record<string, unknown> = {
    source_type: input.sourceType ?? "prompt",
    count: input.count ?? 10,
    prompt: input.prompt,
    enable_fallback: input.enableFallback !== false,
  };
  if (input.testId !== undefined) body.test_id = input.testId;
  if (input.provider) body.provider = input.provider;
  return request<Flashcard[]>(`/folders/${folderId}/flashcards/generate`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchFlashcards(
  folderId?: number,
  opts?: { limit?: number; offset?: number },
): Promise<Flashcard[]> {
  try {
    let path = folderId ? `/folders/${folderId}/flashcards` : "/flashcards";
    // Pagination is only supported on the per-folder endpoint. Omit the params
    // entirely to keep the legacy "return everything" behavior (study mode and
    // the dashboard both rely on the full set).
    if (folderId && opts) {
      const params = new URLSearchParams();
      if (opts.limit != null) params.set("limit", String(opts.limit));
      if (opts.offset != null) params.set("offset", String(opts.offset));
      const qs = params.toString();
      if (qs) path += `?${qs}`;
    }
    return await request<Flashcard[]>(path);
  } catch {
    return [];
  }
}

export async function deleteAllFlashcards(folderId: number): Promise<void> {
  await request(`/folders/${folderId}/flashcards`, { method: "DELETE" });
}

export async function recordFlashcardAttempt(folderId: number, cardId: number, correct: boolean, timeMs: number) {
  try {
    await request(`/folders/${folderId}/flashcards/${cardId}/attempt`, {
      method: "POST",
      body: JSON.stringify({ correct, time_ms: timeMs }),
    });
  } catch {
    return;
  }
}

export async function fetchProviderStatus(): Promise<ProviderStatus> {
  return request<ProviderStatus>("/kojo/providers/status");
}

// ── Learning Modules ─────────────────────────────────────────────────────────

// Returns null when the folder has no track yet (backend 404s in that case).
export async function fetchLearningTrack(
  folderId: number,
  format: "article" | "podcast" | "lecture" = "article",
): Promise<LearningTrack | null> {
  try {
    return await request<LearningTrack>(`/folders/${folderId}/learning-track?format=${format}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Learning track not found")) {
      return null;
    }
    throw err;
  }
}

export async function createLearningTrack(
  folderId: number,
  moduleCount: number,
  options?: {
    provider?: string;
    customInstructions?: string;
    format?: "article" | "podcast" | "lecture";
  },
): Promise<LearningTrack> {
  return request<LearningTrack>(`/folders/${folderId}/learning-track`, {
    method: "POST",
    body: JSON.stringify({
      module_count: moduleCount,
      ...(options?.format ? { format: options.format } : {}),
      ...(options?.provider ? { provider: options.provider } : {}),
      ...(options?.customInstructions ? { custom_instructions: options.customInstructions } : {}),
    }),
  });
}

export async function deleteLearningTrack(
  folderId: number,
  format: "article" | "podcast" | "lecture" = "article",
): Promise<void> {
  await request(`/folders/${folderId}/learning-track?format=${format}`, { method: "DELETE" });
}

// Every ACTIVE track for a folder, at most one per format, so the hub can
// render all three format slots in one request.
export async function fetchActiveTracks(folderId: number): Promise<LearningTrack[]> {
  return request<LearningTrack[]>(`/folders/${folderId}/learning-tracks`);
}

// Archives the whole track (freeing the folder's active slot so a new track can
// be built) or restores it. Restore is refused server-side if an active track
// already exists.
export async function archiveLearningTrack(trackId: number, archived: boolean): Promise<LearningTrack> {
  return request<LearningTrack>(`/learning-tracks/${trackId}/archive`, {
    method: "PATCH",
    body: JSON.stringify({ archived }),
  });
}

// Archived tracks for a folder (newest first), for the hub's Archived section.
export async function fetchArchivedTracks(folderId: number): Promise<LearningTrack[]> {
  return request<LearningTrack[]>(`/folders/${folderId}/learning-tracks/archived`);
}

// The full track owning a module (active or archived), so the lesson page can
// render a lesson that belongs to an archived track.
export async function fetchTrackForModule(moduleId: number): Promise<LearningTrack> {
  return request<LearningTrack>(`/learning-modules/${moduleId}/track`);
}

// Permanently deletes a specific track by id (used to purge an archived track).
export async function deleteTrackById(trackId: number): Promise<void> {
  await request(`/learning-tracks/${trackId}`, { method: "DELETE" });
}

// Saves a user-edited lesson; the backend rebuilds the narration script and
// quiz from it before responding, so this call can take LLM-generation time.
export async function updateModuleLesson(moduleId: number, lessonContent: string): Promise<LearningModule> {
  return request<LearningModule>(`/learning-modules/${moduleId}`, {
    method: "PATCH",
    body: JSON.stringify({ lesson_content: lessonContent }),
  });
}

// Attaches (or clears, with null) the module's video link. Display only.
export async function updateModuleVideo(moduleId: number, videoUrl: string | null): Promise<LearningModule> {
  return request<LearningModule>(`/learning-modules/${moduleId}/video`, {
    method: "PATCH",
    body: JSON.stringify({ video_url: videoUrl }),
  });
}

export async function submitModuleQuiz(moduleId: number, answers: number[]): Promise<QuizAttemptResult> {
  return request<QuizAttemptResult>(`/learning-modules/${moduleId}/quiz-attempt`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

// The episode payload for a podcast/lecture module. correct_index and
// explanation are stripped server-side until each checkpoint is answered.
export async function fetchModuleEpisode(moduleId: number): Promise<ModuleEpisode> {
  return request<ModuleEpisode>(`/learning-modules/${moduleId}/episode`);
}

// Grades one checkpoint server-side. answer -1 means skipped (scores wrong).
export async function answerCheckpoint(
  moduleId: number,
  checkpointIndex: number,
  answer: number,
): Promise<CheckpointAnswerResult> {
  return request<CheckpointAnswerResult>(`/learning-modules/${moduleId}/checkpoint-answer`, {
    method: "POST",
    body: JSON.stringify({ checkpoint_index: checkpointIndex, answer }),
  });
}

export async function kojoChat(
  folderId: number,
  message: string,
  provider?: string,
  strictness?: string,
  conversationId?: number,
  customInstruction?: string,
): Promise<KojoChatResponse> {
  const body: Record<string, unknown> = { message };
  if (provider) body.provider = provider;
  if (strictness) body.strictness = strictness;
  if (conversationId !== undefined) body.conversation_id = conversationId;
  if (customInstruction) body.custom_instruction = customInstruction;
  return request<KojoChatResponse>(`/kojo/folders/${folderId}/chat`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Consumes a Kojo Server-Sent-Events stream. Calls onDelta for each token
// chunk as it arrives and resolves with the final KojoChatResponse once the
// server emits its "done" event. Rejects on an "error" event or transport
// failure. EventSource can't send the Authorization header, so this uses fetch
// with a manual ReadableStream reader over the same SSE framing.
// Handlers for a Kojo stream. Passing a bare function is shorthand for
// { onDelta }, so existing callers keep working. Set reasoning: true to ask the
// server for a visible reasoning pass, delivered via onReasoning.
export type KojoStreamHandlers =
  | ((delta: string) => void)
  | {
      onDelta: (delta: string) => void;
      onReasoning?: (delta: string) => void;
      reasoning?: boolean;
    };

function normalizeHandlers(h: KojoStreamHandlers) {
  return typeof h === "function" ? { onDelta: h, onReasoning: undefined, reasoning: false } : h;
}

async function consumeKojoStream(
  path: string,
  body: Record<string, unknown>,
  handlers: KojoStreamHandlers,
  signal?: AbortSignal,
): Promise<KojoChatResponse> {
  const { onDelta, onReasoning } = normalizeHandlers(handlers);
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await guardedFetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    if (response.status === 401 && token && token !== GUEST_TOKEN) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      window.location.href = "/";
    }
    let message = `Request failed: ${response.status}`;
    try {
      const errBody = await response.json();
      if (errBody?.detail !== undefined) message = formatApiErrorDetail(errBody.detail);
    } catch { /* ignore */ }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: KojoChatResponse | null = null;

  const handleEvent = (raw: string) => {
    // Each SSE record is one or more "data:" lines; we emit single-line JSON.
    const line = raw.split("\n").find((l) => l.startsWith("data:"));
    if (!line) return;
    const payload = line.slice(line.indexOf(":") + 1).trim();
    if (!payload) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    if (event.type === "delta") {
      onDelta(String(event.text ?? ""));
    } else if (event.type === "reasoning") {
      onReasoning?.(String(event.text ?? ""));
    } else if (event.type === "done") {
      done = {
        response: String(event.response ?? ""),
        conversation_id: event.conversation_id as ID,
        message_id: event.message_id as ID,
        flagged_uncertain: Boolean(event.flagged_uncertain),
        conversation_name: (event.conversation_name as string | null) ?? null,
      };
    } else if (event.type === "error") {
      throw new Error(String(event.message ?? "Kojo failed to respond. Try again."));
    }
  };

  let streamError: unknown = null;
  try {
    for (;;) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        handleEvent(raw);
      }
    }
    if (buffer.trim()) handleEvent(buffer);
  } catch (err) {
    // A transport failure mid-stream means the server dropped the connection,
    // so the backend may be down. Surfacing it flips the waiting screen (the
    // debounce in backendStatus absorbs a single blip).
    const name = (err as { name?: string } | null)?.name;
    if (name !== "AbortError") {
      reportBackendNetworkFailure();
      throw new Error("Connection lost while Kojo was answering. The server may be starting up, try again in a moment.");
    }
    throw err;
  }

  if (!done) throw new Error("Kojo stream ended before completing. Try again.");
  return done;
}

export async function kojoChatStream(
  folderId: number,
  message: string,
  handlers: KojoStreamHandlers,
  provider?: string,
  strictness?: string,
  conversationId?: number,
  customInstruction?: string,
  signal?: AbortSignal,
): Promise<KojoChatResponse> {
  const body: Record<string, unknown> = { message };
  if (provider) body.provider = provider;
  if (strictness) body.strictness = strictness;
  if (conversationId !== undefined) body.conversation_id = conversationId;
  if (customInstruction) body.custom_instruction = customInstruction;
  if (typeof handlers === "object" && handlers.reasoning) body.reasoning = true;
  return consumeKojoStream(`/kojo/folders/${folderId}/chat/stream`, body, handlers, signal);
}

export async function kojoChatGeneralStream(
  conversationId: number,
  message: string,
  handlers: KojoStreamHandlers,
  provider?: string,
  strictness?: string,
  customInstruction?: string,
  signal?: AbortSignal,
  context?: string,
  interviewerMode?: string,
  testRef?: KojoTestRef | null,
): Promise<KojoChatResponse> {
  const body: Record<string, unknown> = { message };
  if (provider) body.provider = provider;
  if (strictness) body.strictness = strictness;
  if (customInstruction) body.custom_instruction = customInstruction;
  if (context) body.context = context;
  if (interviewerMode) body.interviewer_mode = interviewerMode;
  if (testRef) {
    body.test_id = testRef.testId;
    body.question_id = testRef.questionId;
  }
  if (typeof handlers === "object" && handlers.reasoning) body.reasoning = true;
  return consumeKojoStream(`/kojo/conversations/${conversationId}/chat/stream`, body, handlers, signal);
}

// Regenerate the last assistant answer in a conversation (folder or general).
// The backend deletes the previous assistant turn and streams a fresh answer to
// the same prompt, so no duplicate user message is created.
export async function regenerateKojoStream(
  conversationId: number,
  handlers: KojoStreamHandlers,
  provider?: string,
  strictness?: string,
  customInstruction?: string,
  signal?: AbortSignal,
): Promise<KojoChatResponse> {
  const body: Record<string, unknown> = {};
  if (provider) body.provider = provider;
  if (strictness) body.strictness = strictness;
  if (customInstruction) body.custom_instruction = customInstruction;
  if (typeof handlers === "object" && handlers.reasoning) body.reasoning = true;
  return consumeKojoStream(`/kojo/conversations/${conversationId}/regenerate/stream`, body, handlers, signal);
}

// Single-round-trip initial load for a folder's chat: conversation list plus
// the most recent conversation's messages and files. Replaces the previous
// list -> by-id -> files waterfall. The backend auto-creates a conversation
// when the folder has none, so `active` is always present on success.
export async function bootstrapKojoFolder(folderId: number): Promise<KojoBootstrap | null> {
  try {
    return await request<KojoBootstrap>(`/kojo/folders/${folderId}/bootstrap`);
  } catch {
    return null;
  }
}

// Same single-round-trip initial load for the General (no folder) chat.
export async function bootstrapKojoGeneral(): Promise<KojoBootstrap | null> {
  try {
    return await request<KojoBootstrap>("/kojo/conversations/general/bootstrap");
  } catch {
    return null;
  }
}

export async function listKojoConversations(folderId: number): Promise<KojoConversationSummary[]> {
  try {
    return await request<KojoConversationSummary[]>(`/kojo/folders/${folderId}/conversations`);
  } catch {
    return [];
  }
}

export async function createKojoConversation(folderId: number): Promise<KojoConversationSummary> {
  return request<KojoConversationSummary>(`/kojo/folders/${folderId}/conversations`, {
    method: "POST",
  });
}

export async function fetchKojoConversationById(conversationId: number): Promise<KojoConversation | null> {
  try {
    return await request<KojoConversation>(`/kojo/conversations/${conversationId}`);
  } catch {
    return null;
  }
}

export async function deleteKojoConversation(conversationId: number): Promise<void> {
  await request(`/kojo/conversations/${conversationId}`, { method: "DELETE" });
}

export async function renameKojoConversation(
  conversationId: number,
  name: string,
): Promise<KojoConversationSummary> {
  return request<KojoConversationSummary>(`/kojo/conversations/${conversationId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export async function listGeneralKojoConversations(): Promise<KojoConversationSummary[]> {
  try {
    return await request<KojoConversationSummary[]>("/kojo/conversations/general");
  } catch {
    return [];
  }
}

export async function createGeneralKojoConversation(): Promise<KojoConversationSummary> {
  return request<KojoConversationSummary>("/kojo/conversations/general", { method: "POST" });
}

export async function kojoChatGeneral(
  conversationId: number,
  message: string,
  provider?: string,
  strictness?: string,
  customInstruction?: string,
  context?: string,
  interviewerMode?: string,
  testRef?: KojoTestRef | null,
): Promise<KojoChatResponse> {
  const body: Record<string, unknown> = { message };
  if (provider) body.provider = provider;
  if (strictness) body.strictness = strictness;
  if (customInstruction) body.custom_instruction = customInstruction;
  if (context) body.context = context;
  if (interviewerMode) body.interviewer_mode = interviewerMode;
  if (testRef) {
    body.test_id = testRef.testId;
    body.question_id = testRef.questionId;
  }
  return request<KojoChatResponse>(`/kojo/conversations/${conversationId}/chat`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// The signed-in account's own usage against its rolling-window limits.
export async function fetchUsageLimits(): Promise<UsageLimits> {
  return request<UsageLimits>("/usage/limits");
}

// Weekly user memory: a short server-generated recap of what the student has
// been studying. Regenerated on demand when older than ~7 days.
export async function fetchKojoMemory(): Promise<KojoMemory | null> {
  try {
    return await request<KojoMemory>("/kojo/memory");
  } catch {
    return null;
  }
}

// Regenerate the weekly memory. `force` regenerates even if still fresh (used by
// the Settings "Regenerate now" button); without it the server only rebuilds a
// stale memory, so it's cheap to call on entering chat mode.
export async function refreshKojoMemory(force = false): Promise<KojoMemory | null> {
  try {
    return await request<KojoMemory>(`/kojo/memory/refresh${force ? "?force=true" : ""}`, {
      method: "POST",
    });
  } catch {
    return null;
  }
}

export async function gradeLeetCodeSubmission(
  titleSlug: string,
  title: string,
  userCode: string,
  testResults: string,
  allPassed: boolean,
  topic: string,
  provider?: string,
  statement?: string,
  subtopic?: string | null,
): Promise<LeetCodeGradeResponse> {
  const body: Record<string, unknown> = {
    title_slug: titleSlug,
    title,
    user_code: userCode,
    test_results: testResults,
    all_passed: allPassed,
    topic,
  };
  if (provider) body.provider = provider;
  if (statement) body.statement = statement;
  if (subtopic) body.subtopic = subtopic;
  return request<LeetCodeGradeResponse>("/leetcode/grade", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function checkLeetCodeComplexity(
  titleSlug: string,
  title: string,
  userCode: string,
  timeClaim: string,
  timeReasoning: string,
  spaceClaim: string,
  spaceReasoning: string,
  topic: string,
  provider?: string,
  statement?: string,
  subtopic?: string | null,
): Promise<LeetCodeComplexityCheckResponse> {
  const body: Record<string, unknown> = {
    title_slug: titleSlug,
    title,
    user_code: userCode,
    time_claim: timeClaim,
    time_reasoning: timeReasoning,
    space_claim: spaceClaim,
    space_reasoning: spaceReasoning,
    topic,
  };
  if (provider) body.provider = provider;
  if (statement) body.statement = statement;
  if (subtopic) body.subtopic = subtopic;
  return request<LeetCodeComplexityCheckResponse>("/leetcode/complexity-check", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchKojoConversation(folderId: number): Promise<KojoConversation | null> {
  try {
    return await request<KojoConversation>(`/kojo/folders/${folderId}/conversation`);
  } catch {
    return null;
  }
}

export async function clearKojoConversation(folderId: number): Promise<KojoClearResponse> {
  return request<KojoClearResponse>(`/kojo/folders/${folderId}/clear`, {
    method: "POST",
  });
}

export async function restoreKojoConversation(folderId: number): Promise<KojoRestoreResponse> {
  return request<KojoRestoreResponse>(`/kojo/folders/${folderId}/restore`, {
    method: "POST",
  });
}

export async function fetchClearedKojoConversations(): Promise<KojoClearedConversation[]> {
  try {
    return await request<KojoClearedConversation[]>("/kojo/conversations/cleared");
  } catch {
    return [];
  }
}

// Warm-up for opening a past attempt: the attempt row starts this request on
// touch/hover so Results gets a head start on the round-trip. A warmed request
// is handed over once and only while fresh, so a later visit never shows a
// stale grade.
const ATTEMPT_PREFETCH_TTL_MS = 30_000;
const attemptDetailPrefetch = new Map<number, { promise: Promise<AttemptDetail>; at: number }>();

export function prefetchAttemptDetail(attemptId: number): void {
  const warm = attemptDetailPrefetch.get(attemptId);
  if (warm && Date.now() - warm.at < ATTEMPT_PREFETCH_TTL_MS) return;
  const promise = request<AttemptDetail>(`/attempts/${attemptId}`);
  promise.catch(() => attemptDetailPrefetch.delete(attemptId));
  attemptDetailPrefetch.set(attemptId, { promise, at: Date.now() });
}

export async function fetchAttemptDetail(attemptId: number): Promise<AttemptDetail> {
  const warm = attemptDetailPrefetch.get(attemptId);
  attemptDetailPrefetch.delete(attemptId);
  if (warm && Date.now() - warm.at < ATTEMPT_PREFETCH_TTL_MS) return warm.promise;
  return request<AttemptDetail>(`/attempts/${attemptId}`);
}

export async function fetchReviewSummary(attemptId: number): Promise<ReviewSummaryResponse> {
  return request<ReviewSummaryResponse>(`/attempts/${attemptId}/review-summary`, { method: "POST" });
}

export async function fetchLeetCodeProblem(titleSlug: string): Promise<LeetCodeProblemData> {
  return request<LeetCodeProblemData>(`/leetcode/problems/${titleSlug}`);
}

export async function fetchLeetCodeHint(
  titleSlug: string,
  title: string,
  message: string,
  userCode: string,
  topic: string,
  provider?: string,
  statement?: string,
  subtopic?: string | null,
): Promise<LeetCodeHintResponse> {
  const body: Record<string, unknown> = {
    title_slug: titleSlug,
    title,
    message,
    user_code: userCode,
    topic,
  };
  if (provider) body.provider = provider;
  if (statement) body.statement = statement;
  if (subtopic) body.subtopic = subtopic;
  return request<LeetCodeHintResponse>("/leetcode/hint", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchAttempts(testId: number): Promise<AttemptSummary[]> {
  try {
    return await request<AttemptSummary[]>(`/tests/${testId}/attempts`);
  } catch {
    return [];
  }
}

export async function updateFlashcard(folderId: number, cardId: number, data: FlashcardUpdate): Promise<Flashcard> {
  return request<Flashcard>(`/folders/${folderId}/flashcards/${cardId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteFlashcard(folderId: number, cardId: number): Promise<void> {
  await request(`/folders/${folderId}/flashcards/${cardId}`, { method: "DELETE" });
}

export async function generateFlashcardsFromFile(
  folderId: number,
  files: File[],
  count = 10,
  provider?: string,
  enableFallback = true,
): Promise<Flashcard[]> {
  const formData = new FormData();
  files.forEach((f) => formData.append("notes_files", f));
  const providerQuery = provider ? `&provider=${encodeURIComponent(provider)}` : "";
  const fallbackQuery = `&enable_fallback=${enableFallback ? "true" : "false"}`;
  return request<Flashcard[]>(`/folders/${folderId}/flashcards/generate-from-file?count=${count}${providerQuery}${fallbackQuery}`, {
    method: "POST",
    body: formData,
  });
}

// Folder file management
export interface FolderFile {
  id: number;
  folder_id: number;
  file_name: string;
  file_type: string;
  size_bytes: number;
  upload_status?: string | null;
  upload_error?: string | null;
  /** Shown on a ready file, e.g. when only part of a long PDF was read. */
  upload_note?: string | null;
  /** Parse progress: pages_done stays null while the file waits for the parse slot. */
  pages_done?: number | null;
  pages_total?: number | null;
  uploaded_at: string;
}

export async function fetchFolderFiles(folderId: number): Promise<FolderFile[]> {
  try {
    return await request<FolderFile[]>(`/folders/${folderId}/files`);
  } catch {
    return [];
  }
}

export interface FolderFileContent {
  id: number;
  file_name: string;
  file_type: string;
  content: string;
  truncated: boolean;
  shown_chars: number;
  total_chars: number;
}

export async function fetchFolderFileContent(folderId: number, fileId: number): Promise<FolderFileContent> {
  return request<FolderFileContent>(`/folders/${folderId}/files/${fileId}/content`);
}

export interface SkippedFile {
  file_name: string;
  reason: string;
  // Set when the file is an exact copy of one already in the folder.
  existing_file_id?: number | null;
}

export interface UploadResult {
  uploaded: FolderFile[];
  skipped: SkippedFile[];
}

// "practice_test" lets the server read math-heavy PDF pages with a vision model.
export type UploadPurpose = "notes" | "practice_test";

export async function uploadFolderFiles(
  folderId: number,
  files: File[],
  purpose?: UploadPurpose,
): Promise<UploadResult> {
  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));
  if (purpose) formData.append("purpose", purpose);
  return request<UploadResult>(`/folders/${folderId}/files`, {
    method: "POST",
    body: formData,
  });
}

export interface PracticeSection {
  index: number;
  title: string;
  question_count: number;
}

// The sections of an uploaded practice test the student can pick from. Empty
// when the document has fewer than two; the whole document is used then.
export async function fetchPracticeSections(folderId: number, fileId: number): Promise<PracticeSection[]> {
  return request<PracticeSection[]>(`/folders/${folderId}/files/${fileId}/sections`);
}

export interface PracticeProblem {
  index: number;
  label: string;
  title: string;
  chapter: string | null;
  preview: string;
  part_count: number;
  // An earlier problem in the same section with nearly the same wording (GH #165).
  similar_to?: string | null;
  start: number;
  end: number;
}

export interface PracticeProblems {
  // headings: found by text rules. ai: the AI index pass. none: nothing to pick.
  source: "headings" | "ai" | "none";
  problems: PracticeProblem[];
}

// A question read from a practice test, not saved until Create Test.
export interface DraftQuestion {
  kind: "mcq" | "frq";
  question_text: string;
  options?: string[] | null;
  correct_index?: number | null;
  expected_answer?: string | null;
  answer_inferred: boolean;
  // Multi-part problems (GH #151): set on each lettered part. The setup is
  // repeated on every part here and stored once when the test is created.
  part_label?: string | null;
  group_key?: string | null;
  group_label?: string;
  group_stem?: string;
}

export interface ParsedProblem {
  index: number;
  source_text: string;
  questions: DraftQuestion[];
  error: string | null;
}

// The problems of an uploaded practice test, for the Create Test picker (GH #138).
export async function fetchPracticeProblems(folderId: number, fileId: number): Promise<PracticeProblems> {
  return request<PracticeProblems>(`/folders/${folderId}/files/${fileId}/problems`);
}

// Reads only the picked problems into draft questions for the review step.
export async function parsePracticeProblems(
  folderId: number,
  fileId: number,
  problems: PracticeProblem[],
): Promise<ParsedProblem[]> {
  const result = await request<{ problems: ParsedProblem[] }>(`/folders/${folderId}/files/${fileId}/problems/parse`, {
    method: "POST",
    body: JSON.stringify({
      problems: problems.map((p) => ({ index: p.index, label: p.label, start: p.start, end: p.end })),
    }),
  });
  return result.problems;
}

// Redoes one problem from an instruction or the pasted problem text.
export async function fixPracticeProblem(
  folderId: number,
  fileId: number,
  problem: PracticeProblem,
  current: DraftQuestion[],
  message: string,
): Promise<DraftQuestion[]> {
  const result = await request<{ questions: DraftQuestion[] }>(`/folders/${folderId}/files/${fileId}/problems/fix`, {
    method: "POST",
    // index + label keep a fixed problem's parts in the same group (GH #151).
    body: JSON.stringify({
      start: problem.start,
      end: problem.end,
      current,
      message,
      index: problem.index,
      label: problem.label,
    }),
  });
  return result.questions;
}

export async function addFolderTextNote(
  folderId: number,
  title: string,
  content: string,
): Promise<FolderFile> {
  return request<FolderFile>(`/folders/${folderId}/files/text`, {
    method: "POST",
    body: JSON.stringify({ title: title || null, content }),
  });
}

export async function deleteFolderFile(folderId: number, fileId: number): Promise<void> {
  await request(`/folders/${folderId}/files/${fileId}`, { method: "DELETE" });
}

export async function reindexFolderFiles(folderId: number): Promise<{ reindexed: number; still_failed: number }> {
  return request(`/folders/${folderId}/files/reindex`, { method: "POST" });
}

export async function fetchSlashCommands(): Promise<SlashCommand[]> {
  try {
    return await request<SlashCommand[]>("/slash-commands");
  } catch {
    return [];
  }
}

export async function createSlashCommand(input: SlashCommandInput): Promise<SlashCommand> {
  return request<SlashCommand>("/slash-commands", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateSlashCommand(
  commandId: number,
  input: Partial<SlashCommandInput>,
): Promise<SlashCommand> {
  return request<SlashCommand>(`/slash-commands/${commandId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteSlashCommand(commandId: number): Promise<void> {
  await request(`/slash-commands/${commandId}`, { method: "DELETE" });
}

export async function fetchConversationFiles(conversationId: number): Promise<ConversationFile[]> {
  try {
    return await request<ConversationFile[]>(`/kojo/conversations/${conversationId}/files`);
  } catch {
    return [];
  }
}

export async function uploadConversationFiles(conversationId: number, files: File[]): Promise<ConversationFile[]> {
  const formData = new FormData();
  files.forEach((f) => formData.append("files", f));
  return request<ConversationFile[]>(`/kojo/conversations/${conversationId}/files`, {
    method: "POST",
    body: formData,
  });
}

export async function deleteConversationFile(conversationId: number, fileId: number): Promise<void> {
  await request(`/kojo/conversations/${conversationId}/files/${fileId}`, { method: "DELETE" });
}

export async function kojoTestBlueprint(
  folderId: number,
  message: string,
  provider?: string,
): Promise<TestBlueprint> {
  const body: Record<string, unknown> = { message };
  if (provider) body.provider = provider;
  return request<TestBlueprint>(`/kojo/folders/${folderId}/test-blueprint`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Kojo action cards (chat-proposed creations) ──────────────────────────────

export async function proposeKojoAction(
  conversationId: number,
  actionType: KojoActionType,
  message: string,
  provider?: string,
  messageId?: number,
): Promise<KojoActionCard> {
  const body: Record<string, unknown> = { action_type: actionType, message };
  if (provider) body.provider = provider;
  if (messageId !== undefined) body.message_id = messageId;
  return request<KojoActionCard>(`/kojo/conversations/${conversationId}/action-cards`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchKojoActionCards(conversationId: number): Promise<KojoActionCard[]> {
  try {
    return await request<KojoActionCard[]>(`/kojo/conversations/${conversationId}/action-cards`);
  } catch {
    return [];
  }
}

export async function resolveKojoActionCard(
  cardId: number,
  status: "confirmed" | "dismissed",
  extra?: { entityType?: string; entityId?: number; payload?: Record<string, unknown> },
): Promise<KojoActionCard> {
  const body: Record<string, unknown> = { status };
  if (extra?.entityType) body.entity_type = extra.entityType;
  if (extra?.entityId !== undefined) body.entity_id = extra.entityId;
  if (extra?.payload) body.payload = extra.payload;
  return request<KojoActionCard>(`/kojo/action-cards/${cardId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// ── LeetCode sync ─────────────────────────────────────────────────────────────

export type LCProgressData = {
  progress: Record<string, boolean>;
  activity_dates: string[];
  // Per-day solved tally keyed by YYYY-MM-DD. Optional so older payloads still parse.
  activity_counts?: Record<string, number>;
  // First-solve timestamp (ISO) per problem slug. Only present for problems solved
  // after the solved_at migration; server-set, never sent by the client on PUT.
  solved_at?: Record<string, string>;
};

export async function fetchLCProgress(tzOffset?: number): Promise<LCProgressData> {
  // Pass the client's timezone offset (Date.getTimezoneOffset(), minutes behind
  // UTC) so the server buckets the derived activity_counts into the same local
  // calendar days the heatmap renders.
  const query = tzOffset === undefined ? "" : `?tz_offset=${tzOffset}`;
  return request<LCProgressData>(`/leetcode/progress${query}`);
}

export async function syncLCProgress(data: LCProgressData): Promise<void> {
  await request("/leetcode/progress", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function fetchLCWorkspace(problemSlug: string): Promise<{ workspace: unknown } | null> {
  try {
    return await request<{ workspace: unknown }>(`/leetcode/workspace/${problemSlug}`);
  } catch {
    return null;
  }
}

export async function fetchLCWorkspaces(): Promise<Record<string, unknown>> {
  try {
    const result = await request<{ workspaces: Record<string, unknown> }>("/leetcode/workspaces");
    return result.workspaces ?? {};
  } catch {
    return {};
  }
}

export async function syncLCWorkspace(problemSlug: string, workspace: unknown): Promise<void> {
  await request(`/leetcode/workspace/${problemSlug}`, {
    method: "PUT",
    body: JSON.stringify({ workspace }),
  });
}

export async function fetchLCNotes(problemSlug: string): Promise<string> {
  try {
    const result = await request<{ notes: string }>(`/leetcode/notes/${problemSlug}`);
    return result.notes ?? "";
  } catch {
    return "";
  }
}

export async function syncLCNotes(problemSlug: string, notes: string): Promise<void> {
  await request(`/leetcode/notes/${problemSlug}`, {
    method: "PUT",
    body: JSON.stringify({ notes }),
  });
}

// ── Custom (user-authored) LeetCode problems ──────────────────────────────────

export async function fetchLCCustomProblems(): Promise<LCCustomProblem[]> {
  try {
    const result = await request<{ problems: LCCustomProblem[] }>("/leetcode/custom-problems");
    return result.problems ?? [];
  } catch {
    return [];
  }
}

export async function syncLCCustomProblem(
  slug: string,
  problem: Omit<LCCustomProblem, "slug">,
): Promise<LCCustomProblem> {
  return request<LCCustomProblem>(`/leetcode/custom-problems/${slug}`, {
    method: "PUT",
    body: JSON.stringify(problem),
  });
}

export async function deleteLCCustomProblem(slug: string): Promise<void> {
  await request(`/leetcode/custom-problems/${slug}`, { method: "DELETE" });
}

export async function generateLCCustomProblem(
  code: string,
  hint: string,
  provider?: string,
): Promise<LCGeneratedCustomProblem> {
  return request<LCGeneratedCustomProblem>("/leetcode/custom-problems/generate", {
    method: "POST",
    body: JSON.stringify({ code, hint, provider }),
  });
}

// Fetch (and lazily generate + cache) the KojoCode solution for a custom problem.
// First call generates + stores it server-side; later calls are a cheap cache hit.
export async function fetchKojoCodeSolution(
  slug: string,
  provider?: string,
): Promise<import("./types").KojoCodeSolution> {
  return request<import("./types").KojoCodeSolution>(
    `/leetcode/custom-problems/${slug}/solution`,
    {
      method: "POST",
      body: JSON.stringify({ provider }),
    },
  );
}

// Stream a batch of fresh custom problems from ONE backend LLM call. onProblem fires
// for each problem the moment it finishes streaming, so the UI can add them live.
// Resolves with the total once the server emits "done"; rejects on an "error" event or
// transport failure. Uses fetch + a manual SSE reader (EventSource can't send auth),
// mirroring consumeKojoStream.
export async function streamLCCustomProblems(
  topics: string[],
  difficulty: string,
  count: number,
  onProblem: (problem: LCGeneratedCustomProblem) => void,
  provider?: string,
  signal?: AbortSignal,
): Promise<{ count: number }> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await guardedFetch(`${API_BASE_URL}/leetcode/custom-problems/generate-stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ topics, difficulty, count, provider }),
    signal,
  });

  if (!response.ok || !response.body) {
    if (response.status === 401 && token && token !== GUEST_TOKEN) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      window.location.href = "/";
    }
    let message = `Request failed: ${response.status}`;
    try {
      const errBody = await response.json();
      if (errBody?.detail !== undefined) message = formatApiErrorDetail(errBody.detail);
    } catch { /* ignore */ }
    throw new Error(message);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let total = 0;
  let done = false;

  const handleEvent = (raw: string) => {
    const line = raw.split("\n").find((l) => l.startsWith("data:"));
    if (!line) return;
    const payload = line.slice(line.indexOf(":") + 1).trim();
    if (!payload) return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    if (event.type === "problem") {
      onProblem(event.problem as LCGeneratedCustomProblem);
    } else if (event.type === "done") {
      total = Number(event.count ?? 0);
      done = true;
    } else if (event.type === "error") {
      throw new Error(String(event.message ?? "Kojo failed to generate problems. Try again."));
    }
  };

  try {
    for (;;) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        handleEvent(raw);
      }
    }
    if (buffer.trim()) handleEvent(buffer);
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name !== "AbortError") {
      reportBackendNetworkFailure();
      throw new Error("Connection lost while Kojo was generating. The server may be starting up, try again in a moment.");
    }
    throw err;
  }

  if (!done) throw new Error("Kojo stream ended before completing. Try again.");
  return { count: total };
}

// One-time "Regenerate topics" backfill (beta): classify every custom problem that
// is missing a subtopic, setting only topic + subtopic. Returns how many were updated.
export async function reclassifyLCCustomProblems(): Promise<{ updated: number }> {
  return request<{ updated: number }>("/leetcode/custom-problems/reclassify", {
    method: "POST",
  });
}

// ── Streak challenge (Save My Streak, beta-only) ─────────────────────────────

export async function fetchLCStreakChallenge(): Promise<import("./types").LCStreakChallenge | null> {
  try {
    return await request<import("./types").LCStreakChallenge | null>("/leetcode/streak-challenge");
  } catch {
    return null;
  }
}

// Builds the rescue challenge. The backend reskins `seed` into a fresh problem aimed at
// the weak topic (the same generation the Daily KojoCode uses) and falls back to
// `problemSlug` from the catalog if the model is unreachable. Errors are thrown, not
// swallowed: this is user-initiated and the card needs something to show.
export async function createLCStreakChallenge(target: {
  problemSlug: string;
  topic?: string;
  subtopic?: string | null;
  targetDifficulty?: string;
  seedSlug?: string;
  seedTitle?: string;
  provider?: string;
}): Promise<import("./types").LCStreakChallenge> {
  const body: Record<string, unknown> = { problem_slug: target.problemSlug };
  if (target.topic) body.topic = target.topic;
  if (target.subtopic) body.subtopic = target.subtopic;
  if (target.targetDifficulty) body.target_difficulty = target.targetDifficulty;
  if (target.seedSlug) body.seed_slug = target.seedSlug;
  if (target.seedTitle) body.seed_title = target.seedTitle;
  if (target.provider) body.provider = target.provider;
  return request<import("./types").LCStreakChallenge>("/leetcode/streak-challenge", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// `today` is the client's local calendar day. The server bridges the streak gap up to
// it, and activity is keyed on local dates, so the server cannot derive it from UTC.
export async function completeLCStreakChallenge(today: string): Promise<void> {
  await request("/leetcode/streak-challenge/complete", {
    method: "POST",
    body: JSON.stringify({ today }),
  });
}

// ── Daily KojoCode (beta-only) ────────────────────────────────────────────────

export async function fetchLCDaily(): Promise<LCCustomProblem | null> {
  try {
    return await request<LCCustomProblem | null>("/leetcode/daily");
  } catch {
    return null;
  }
}

export async function createLCDaily(
  topic: string,
  targetDifficulty: string,
  seedSlug: string,
  seedTitle: string,
  provider?: string,
  subtopic?: string | null,
): Promise<LCCustomProblem> {
  // seed_title is what the backend actually reskins from: it stores no problem
  // statements and can't fetch them from LeetCode in prod, so it works from the model's
  // knowledge of the named catalog problem. seed_slug is still sent for logging/parity.
  const body: Record<string, unknown> = {
    topic,
    target_difficulty: targetDifficulty,
    seed_slug: seedSlug,
    seed_title: seedTitle,
  };
  if (provider) body.provider = provider;
  if (subtopic) body.subtopic = subtopic;
  return request<LCCustomProblem>("/leetcode/daily", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Struggle events + weakness scorer (beta-only) ─────────────────────────────

export type LCStruggleEventType =
  | "timer_expiry"
  | "solution_viewed"
  | "self_rated_easy"
  | "self_rated_medium"
  | "self_rated_hard"
  | "self_rated_brutal";

export async function logLCStruggleEvent(
  topic: string,
  eventType: LCStruggleEventType = "timer_expiry",
  problemSlug?: string,
  subtopic?: string | null,
): Promise<void> {
  try {
    await request("/leetcode/struggle-event", {
      method: "POST",
      body: JSON.stringify({
        topic,
        subtopic: subtopic ?? null,
        event_type: eventType,
        problem_slug: problemSlug ?? null,
      }),
    });
  } catch {
    // Best-effort signal, never blocks the flow it's fired from.
  }
}

export async function postLCTestRun(
  problemSlug: string,
  topic: string,
  difficulty: string,
  passed: boolean,
  subtopic?: string | null,
): Promise<void> {
  try {
    await request("/leetcode/test-run", {
      method: "POST",
      body: JSON.stringify({ problem_slug: problemSlug, topic, subtopic: subtopic ?? null, difficulty, passed }),
    });
  } catch {
    // Best-effort signal, never blocks the run/grade flow it's fired from.
  }
}

export async function fetchLCScores(
  sensitivity?: string,
  bankId?: number,
  resetAt?: string,
): Promise<import("./types").LCScoresResponse> {
  const params = new URLSearchParams();
  if (sensitivity) params.set("sensitivity", sensitivity);
  if (typeof bankId === "number") params.set("bank_id", String(bankId));
  if (resetAt) params.set("reset_at", resetAt);
  const query = params.toString();
  try {
    return await request<import("./types").LCScoresResponse>(
      `/leetcode/weakness${query ? `?${query}` : ""}`,
    );
  } catch {
    return { weakness: { topics: [] }, improvement: { topics: [] } };
  }
}

export async function fetchLCWeakness(
  sensitivity?: string,
  bankId?: number,
  resetAt?: string,
): Promise<import("./types").LCWeaknessTopic[]> {
  const result = await fetchLCScores(sensitivity, bankId, resetAt);
  return result.weakness.topics ?? [];
}

// ── Interview Prep Banks (beta-only) ──────────────────────────────────────────

export async function fetchLCPrepBanks(): Promise<import("./types").LCPrepBank[]> {
  try {
    return await request<import("./types").LCPrepBank[]>("/leetcode/banks");
  } catch {
    return [];
  }
}

export async function createLCPrepBank(name: string, target = ""): Promise<import("./types").LCPrepBank> {
  return request<import("./types").LCPrepBank>("/leetcode/banks", {
    method: "POST",
    body: JSON.stringify({ name, target }),
  });
}

export async function deleteLCPrepBank(bankId: number): Promise<void> {
  await request(`/leetcode/banks/${bankId}`, { method: "DELETE" });
}

export async function activateLCPrepBank(bankId: number): Promise<import("./types").LCPrepBank> {
  return request<import("./types").LCPrepBank>(`/leetcode/banks/${bankId}/activate`, { method: "POST" });
}

export async function addLCBankProblem(
  bankId: number,
  problemSlug: string,
): Promise<import("./types").LCPrepBank> {
  return request<import("./types").LCPrepBank>(`/leetcode/banks/${bankId}/problems`, {
    method: "POST",
    body: JSON.stringify({ problem_slug: problemSlug }),
  });
}

export async function bulkAddLCBankProblems(
  bankId: number,
  slugs: string[],
): Promise<import("./types").LCPrepBank> {
  return request<import("./types").LCPrepBank>(`/leetcode/banks/${bankId}/problems/bulk`, {
    method: "POST",
    body: JSON.stringify({ slugs }),
  });
}

export async function removeLCBankProblem(bankId: number, slug: string): Promise<void> {
  await request(`/leetcode/banks/${bankId}/problems/${slug}`, { method: "DELETE" });
}

// ── 3-Pass Drill schedule (beta-only) ─────────────────────────────────────────

export async function fetchLCDrills(): Promise<import("./types").LCDrillSchedule[]> {
  try {
    return await request<import("./types").LCDrillSchedule[]>("/leetcode/drills");
  } catch {
    return [];
  }
}

export async function createLCDrill(problemSlug: string): Promise<import("./types").LCDrillSchedule> {
  return request<import("./types").LCDrillSchedule>("/leetcode/drills", {
    method: "POST",
    body: JSON.stringify({ problem_slug: problemSlug }),
  });
}

export async function advanceLCDrill(
  slug: string,
  topic?: string,
  subtopic?: string | null,
): Promise<import("./types").LCDrillSchedule> {
  return request<import("./types").LCDrillSchedule>(`/leetcode/drills/${slug}/advance`, {
    method: "POST",
    body: JSON.stringify({ topic: topic ?? null, subtopic: subtopic ?? null }),
  });
}

// Re-run a cleared drill from pass 1 (offered right after a pass-3 clear). Resets the
// existing row server-side rather than adding a second.
export async function restartLCDrill(slug: string): Promise<import("./types").LCDrillSchedule> {
  return request<import("./types").LCDrillSchedule>(`/leetcode/drills/${slug}/restart`, {
    method: "POST",
  });
}

// Remove a problem from the 3-Pass Drill entirely (any pass). Idempotent server-side.
export async function deleteLCDrill(slug: string): Promise<void> {
  await request(`/leetcode/drills/${slug}`, { method: "DELETE" });
}

// ── Mock Interview ────────────────────────────────────────────────────────────

export async function createMockInterviewSession(
  company: string,
  stages: string[],
  level: string = "intern",
  custom?: { custom_company: string; jd_text: string; custom_config: MockCustomConfig },
): Promise<MockInterviewSession> {
  return request<MockInterviewSession>("/mock-interview", {
    method: "POST",
    body: JSON.stringify({ company, stages, level, ...(custom ?? {}) }),
  });
}

export async function parseJobDescription(
  jdText: string,
  availableTopics: string[],
  provider?: string,
): Promise<JDParseResponse> {
  return request<JDParseResponse>("/mock-interview/parse-jd", {
    method: "POST",
    body: JSON.stringify({ jd_text: jdText, available_topics: availableTopics, provider }),
  });
}

// ── Saved job descriptions ────────────────────────────────────────────────────
// A JD pasted once and reused: the raw text plus the parsed analysis live on the
// user's account, so picking a saved JD prefills the setup panel with no LLM call.

export async function listJobDescriptions(): Promise<SavedJobDescription[]> {
  return request<SavedJobDescription[]>("/job-descriptions");
}

export async function saveJobDescription(body: {
  name: string;
  company_name?: string | null;
  jd_text: string;
  parsed?: SavedJDParsed | null;
}): Promise<SavedJobDescription> {
  return request<SavedJobDescription>("/job-descriptions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateJobDescription(
  jdId: number,
  body: {
    name?: string;
    company_name?: string | null;
    jd_text?: string;
    parsed?: SavedJDParsed | null;
  },
): Promise<SavedJobDescription> {
  return request<SavedJobDescription>(`/job-descriptions/${jdId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteJobDescription(jdId: number): Promise<void> {
  await request<void>(`/job-descriptions/${jdId}`, { method: "DELETE" });
}

export async function getMockInterviewSession(sessionId: number): Promise<MockInterviewSession> {
  return request<MockInterviewSession>(`/mock-interview/${sessionId}`);
}

export async function listMockInterviewSessions(): Promise<MockInterviewSession[]> {
  return request<MockInterviewSession[]>("/mock-interview");
}

// Push the client's whole run snapshot. Called debounced from mockInterview.ts, so a
// refresh, a cleared cache, or a different device can pick the run back up.
export async function syncMockProgress(sessionId: number, progressJson: string): Promise<void> {
  await request<void>(`/mock-interview/${sessionId}/progress`, {
    method: "PUT",
    body: JSON.stringify({ progress_json: progressJson }),
  });
}

// The newest unfinished run for this user, or null. Used when the device has no local
// snapshot to offer a Resume from.
export async function fetchActiveMockSession(): Promise<MockInterviewSession | null> {
  return request<MockInterviewSession | null>("/mock-interview/active");
}

export async function screenResume(
  sessionId: number,
  input: { file?: File | null; text?: string | null },
  provider?: string,
): Promise<ResumeScreenResult> {
  const formData = new FormData();
  if (input.file) formData.append("resume_file", input.file);
  if (input.text && input.text.trim()) formData.append("resume_text", input.text);
  if (provider) formData.append("provider", provider);
  return request<ResumeScreenResult>(`/mock-interview/${sessionId}/resume/screen`, {
    method: "POST",
    body: formData,
  });
}

export type Stage1SubmissionItem = {
  slug: string;
  title: string;
  difficulty: string;
  code: string;
  time_used_ms: number;
  test_results: string;
  all_passed: boolean;
  tests_passed: number;
  tests_total: number;
};

// Resume deep dive: the interviewer grills the candidate on their own resume after the
// ATS scan. Same call shape as the Stage 2/3 chats, the client carries the transcript.
export async function sendResumeGrillMessage(
  sessionId: number,
  message: string | null,
  history: InterviewChatMessage[],
  coveredGoals: string[] = [],
  provider?: string,
): Promise<{ reply: string; is_done: boolean; covered_goals: string[] }> {
  return request<{ reply: string; is_done: boolean; covered_goals: string[] }>(
    `/mock-interview/${sessionId}/resume/grill/message`,
    {
      method: "POST",
      body: JSON.stringify({ message, history, covered_goals: coveredGoals, provider }),
    },
  );
}

export async function gradeStage1(
  sessionId: number,
  submissions: Stage1SubmissionItem[],
  provider?: string,
): Promise<Stage1GradeResponse> {
  return request<Stage1GradeResponse>(`/mock-interview/${sessionId}/stage1/grade`, {
    method: "POST",
    body: JSON.stringify({ submissions, provider }),
  });
}

export async function submitStage2(
  sessionId: number,
  code: string,
  problemTitle: string,
  problemSlug: string,
  provider?: string,
): Promise<{ feedback: string }> {
  return request<{ feedback: string }>(`/mock-interview/${sessionId}/stage2/submit`, {
    method: "POST",
    body: JSON.stringify({
      code,
      problem_title: problemTitle,
      problem_slug: problemSlug,
      provider,
    }),
  });
}

export async function sendStage2Message(
  sessionId: number,
  message: string | null,
  history: InterviewChatMessage[],
  coveredGoals: string[] = [],
  provider?: string,
): Promise<Stage2MessageResponse> {
  return request<Stage2MessageResponse>(`/mock-interview/${sessionId}/stage2/message`, {
    method: "POST",
    body: JSON.stringify({ message, history, covered_goals: coveredGoals, provider }),
  });
}

export async function sendStage3Message(
  sessionId: number,
  message: string | null,
  history: InterviewChatMessage[],
  coveredGoals: string[] = [],
  provider?: string,
): Promise<Stage3MessageResponse> {
  return request<Stage3MessageResponse>(`/mock-interview/${sessionId}/stage3/message`, {
    method: "POST",
    body: JSON.stringify({ message, history, covered_goals: coveredGoals, provider }),
  });
}

export async function finishMockInterview(
  sessionId: number,
  provider?: string,
): Promise<MockInterviewFinishResponse> {
  return request<MockInterviewFinishResponse>(`/mock-interview/${sessionId}/finish`, {
    method: "POST",
    body: JSON.stringify({ provider }),
  });
}

// Admin panel helpers
const ADMIN_TOKEN_KEY = "nosey_admin_token";
const ADMIN_TOKEN_EXPIRES_KEY = "nosey_admin_token_expires";

export function getAdminToken(): string | null {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  const expiresStr = localStorage.getItem(ADMIN_TOKEN_EXPIRES_KEY);
  if (!token || !expiresStr) return null;
  if (Date.now() >= parseInt(expiresStr, 10)) {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_TOKEN_EXPIRES_KEY);
    return null;
  }
  return token;
}

export function setAdminToken(token: string, expiresInSeconds: number): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
  localStorage.setItem(ADMIN_TOKEN_EXPIRES_KEY, String(Date.now() + expiresInSeconds * 1000));
}

export function clearAdminToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ADMIN_TOKEN_EXPIRES_KEY);
}

export function getAdminTokenExpiresAt(): number | null {
  const expiresStr = localStorage.getItem(ADMIN_TOKEN_EXPIRES_KEY);
  return expiresStr ? parseInt(expiresStr, 10) : null;
}

async function adminRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  if (!token) throw new Error("Admin session expired. Please re-authenticate.");
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  const response = await guardedFetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = await response.json();
      if (body?.detail) message = String(body.detail);
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function adminAuthenticate(): Promise<AdminTokenResponse> {
  const data = await request<AdminTokenResponse>("/admin/authenticate", { method: "POST" });
  setAdminToken(data.admin_token, data.expires_in_seconds);
  return data;
}

export async function fetchAdminStats(): Promise<AdminStats> {
  return adminRequest<AdminStats>("/admin/stats");
}

export async function fetchAdminTokenUsage(): Promise<TokenUsageReport> {
  return adminRequest<TokenUsageReport>("/admin/token-usage");
}

export async function fetchAdminUsers(): Promise<AdminUserRow[]> {
  return adminRequest<AdminUserRow[]>("/admin/users");
}

export async function setUserBeta(userId: ID, isBeta: boolean): Promise<AdminUserRow> {
  return adminRequest<AdminUserRow>(`/admin/users/${userId}/beta`, {
    method: "PATCH",
    body: JSON.stringify({ is_beta: isBeta }),
  });
}

export async function fetchAdminSurveys(): Promise<AdminSurveysResponse> {
  return adminRequest<AdminSurveysResponse>("/admin/surveys");
}

// Best-effort: a failed survey submit should never surface to the user.
export async function submitSurvey(payload: {
  feature: SurveyFeature;
  rating: number;
  comment?: string;
}): Promise<void> {
  await request<{ status: string }>("/surveys", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ── System Design mode ────────────────────────────────────────────────────────

export async function getSystemDesignProgress(): Promise<SystemDesignProgress> {
  return request<SystemDesignProgress>("/system-design/progress");
}

export async function markSystemDesignSubModule(
  conceptId: string,
  subModule: SystemDesignClientSubModule,
  done: boolean,
): Promise<void> {
  await request(`/system-design/progress/${encodeURIComponent(conceptId)}`, {
    method: "PUT",
    body: JSON.stringify({ subModule, done }),
  });
}

export async function getSystemDesignSubmission(exerciseId: string): Promise<SystemDesignSubmission> {
  return request<SystemDesignSubmission>(
    `/system-design/submissions/${encodeURIComponent(exerciseId)}`,
  );
}

export async function putSystemDesignSubmission(
  exerciseId: string,
  files: Record<string, string>,
  ranPassed: boolean,
): Promise<void> {
  await request(`/system-design/submissions/${encodeURIComponent(exerciseId)}`, {
    method: "PUT",
    body: JSON.stringify({ files, ranPassed }),
  });
}

export async function gradeSystemDesignQuiz(
  conceptId: string,
  payload: SystemDesignQuizGradePayload,
): Promise<SystemDesignQuizResult> {
  return request<SystemDesignQuizResult>(
    `/system-design/quiz/${encodeURIComponent(conceptId)}/grade`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}
