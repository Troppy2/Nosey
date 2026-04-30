import type {
  AttemptDetail,
  AttemptResult,
  AttemptSummary,
  AuthUser,
  Flashcard,
  FlashcardUpdate,
  Folder,
  KojoChatResponse,
  KojoConversation,
  QuestionCreate,
  QuestionEditable,
  QuestionUpdate,
  SubmittedAnswer,
  TestSummary,
  TestTake,
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
const TOKEN_KEY = "nosey_access_token";
const USER_KEY = "nosey_user";
const GUEST_TOKEN = "nosey_guest_token";

type RequestOptions = RequestInit & {
  allowMock?: boolean;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = new Headers(options.headers);

  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    if (response.status === 401 && localStorage.getItem(TOKEN_KEY)) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      window.location.href = "/";
    }
    let message = `Request failed: ${response.status}`;
    try {
      const body = await response.json();
      if (body?.detail) message = String(body.detail);
    } catch { /* ignore parse errors */ }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export function getStoredUser(): AuthUser | null {
  const value = localStorage.getItem(USER_KEY);
  return value ? (JSON.parse(value) as AuthUser) : null;
}

export function isGuestSession() {
  return localStorage.getItem(TOKEN_KEY) === GUEST_TOKEN;
}

export function setGuestSession(): AuthUser {
  const user: AuthUser = {
    id: 1,
    email: "guest@nosey.local",
    full_name: "Guest User",
  };
  localStorage.setItem(TOKEN_KEY, GUEST_TOKEN);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
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
  const res = await fetch(`${API_BASE_URL}/auth/google`, {
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
  input: Pick<Folder, "name" | "subject" | "description">,
): Promise<Folder> {
  return request<Folder>(`/folders/${folderId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
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

export async function createTest(input: {
  folderId: number;
  title: string;
  testType: string;
  files: File[];
  countMcq?: number;
  countFrq?: number;
  practiceTestFile?: File | null;
  isMathMode?: boolean;
}): Promise<{ test_id: number; title: string; questions_generated: number; message: string }> {
  if (isGuestSession()) {
    const tests = await fetchTests();
    if (tests.length >= 1) {
      throw new Error("Guest accounts can only create one practice test. Sign in to make more.");
    }
  }
  if (input.files.length === 0 && !input.practiceTestFile) {
    throw new Error("Add at least one document or a practice test file.");
  }
  if (input.files.length > 5) {
    throw new Error("You can upload at most 5 documents.");
  }
  const formData = new FormData();
  formData.append("title", input.title);
  formData.append("test_type", input.testType);
  if (input.countMcq !== undefined) formData.append("count_mcq", String(input.countMcq));
  if (input.countFrq !== undefined) formData.append("count_frq", String(input.countFrq));
  if (input.isMathMode) formData.append("is_math_mode", "true");
  input.files.forEach((file) => formData.append("notes_files", file));
  if (input.practiceTestFile) formData.append("practice_test_file", input.practiceTestFile);

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

export async function submitAttempt(testId: number, answers: SubmittedAnswer[]): Promise<AttemptResult> {
  try {
    return await request<AttemptResult>(`/tests/${testId}/attempts`, {
      method: "POST",
      body: JSON.stringify({ answers }),
    });
  } catch {
    throw new Error("Unable to submit attempt");
  }
}

export async function createFlashcard(folderId: number, data: { front: string; back: string }): Promise<Flashcard> {
  return request<Flashcard>(`/folders/${folderId}/flashcards`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function fetchFlashcards(folderId?: number): Promise<Flashcard[]> {
  try {
    const path = folderId ? `/folders/${folderId}/flashcards` : "/flashcards";
    return await request<Flashcard[]>(path);
  } catch {
    return [];
  }
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

export async function kojoChat(folderId: number, message: string): Promise<KojoChatResponse> {
  return request<KojoChatResponse>(`/kojo/folders/${folderId}/chat`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export async function fetchKojoConversation(folderId: number): Promise<KojoConversation | null> {
  try {
    return await request<KojoConversation>(`/kojo/folders/${folderId}/conversation`);
  } catch {
    return null;
  }
}

export async function fetchAttemptDetail(attemptId: number): Promise<AttemptDetail> {
  return request<AttemptDetail>(`/attempts/${attemptId}`);
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

export async function generateFlashcardsFromFile(folderId: number, files: File[], count = 10): Promise<Flashcard[]> {
  const formData = new FormData();
  files.forEach((f) => formData.append("notes_files", f));
  return request<Flashcard[]>(`/folders/${folderId}/flashcards/generate-from-file?count=${count}`, {
    method: "POST",
    body: formData,
  });
}
