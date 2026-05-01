export type ID = number;

export type Folder = {
  id: ID;
  name: string;
  subject?: string | null;
  description?: string | null;
  created_at: string;
  updated_at: string;
  test_count: number;
  flashcard_count: number;
  color?: string;
};

export type TestSummary = {
  id: ID;
  folder_id?: ID;
  title: string;
  description?: string | null;
  test_type: "MCQ_only" | "FRQ_only" | "mixed" | string;
  question_count: number;
  best_score?: number | null;
  attempt_count: number;
  created_at: string;
};

export type TestUpdate = {
  title?: string;
  description?: string | null;
};

export type GenerationDiagnostics = {
  fallback_used: boolean;
  fallback_reason?: string | null;
  note_grounded: boolean;
  retrieval_enabled: boolean;
  retrieval_total_chunks: number;
  retrieval_selected_chunks: number;
  retrieval_top_k: number;
};

export type CreateTestResult = {
  test_id: ID;
  title: string;
  questions_generated: number;
  message: string;
} & GenerationDiagnostics;

export type MCQOption = {
  id: ID;
  text: string;
  is_correct: null;
};

export type Question = {
  id: ID;
  type: "MCQ" | "FRQ" | string;
  question_text: string;
  options: MCQOption[];
};

export type MCQOptionEditable = {
  id: ID;
  text: string;
  is_correct: boolean;
};

export type MCQOptionInput = {
  text: string;
  is_correct: boolean;
};

export type QuestionEditable = {
  id: ID;
  type: "MCQ" | "FRQ" | string;
  question_text: string;
  options: MCQOptionEditable[];
  expected_answer?: string | null;
};

export type QuestionCreate = {
  type: "MCQ" | "FRQ";
  question_text: string;
  options: MCQOptionInput[];
  expected_answer?: string | null;
};

export type QuestionUpdate = {
  question_text?: string;
  options?: MCQOptionInput[];
  expected_answer?: string;
};

export type TestTake = {
  id: ID;
  title: string;
  description?: string | null;
  test_type: string;
  is_math_mode?: boolean;
  is_coding_mode?: boolean;
  coding_language?: string | null;
  questions: Question[];
};

export type SubmittedAnswer = {
  question_id: ID;
  answer: string;
};

export type AnswerResult = {
  question_id: ID;
  question_text?: string | null;
  user_answer: string;
  correct_answer?: string | null;
  is_correct: boolean;
  feedback?: string | null;
  confidence?: number | null;
  flagged_uncertain: boolean;
  is_math?: boolean;
};

export type AttemptResult = {
  attempt_id: ID;
  attempt_number: number;
  score: number;
  correct_count: number;
  total: number;
  answers: AnswerResult[];
};

export type AttemptSummary = {
  id: ID;
  attempt_number: number;
  score: number;
  correct_count: number;
  total: number;
  created_at: string;
};

export type AttemptDetail = AttemptSummary & {
  test_title: string;
  answers: AnswerResult[];
};

export type FlashcardUpdate = {
  front: string;
  back: string;
};

export type Flashcard = {
  id: ID;
  folder_id: ID;
  front: string;
  back: string;
  source?: string | null;
  difficulty: number;
  created_at: string;
  updated_at: string;
  attempt_count: number;
  correct_count: number;
  success_rate?: number | null;
  last_attempted?: string | null;
};

export type AuthUser = {
  id: ID;
  email: string;
  full_name?: string | null;
  profile_picture_url?: string | null;
};

export type KojoMessage = {
  id: ID;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type KojoConversation = {
  id: ID;
  folder_id: ID;
  messages: KojoMessage[];
  created_at: string;
  cleared_at?: string | null;
};

export type KojoChatResponse = {
  response: string;
  conversation_id: ID;
  message_id: ID;
  flagged_uncertain: boolean;
};

export type KojoClearResponse = {
  conversation_id: ID;
  folder_id: ID;
  cleared_at: string;
  restore_expires_at: string;
};

export type KojoRestoreResponse = {
  folder_id: ID;
  restored: boolean;
};

export type KojoClearedConversation = {
  conversation_id: ID;
  folder_id: ID;
  folder_name: string;
  cleared_at: string;
  restore_expires_at: string;
};

export type ProviderStatus = {
  gemini: boolean;
  groq: boolean;
  claude: boolean;
  ollama: boolean;
  ollama_model: string;
  ollama_model_available: boolean;
};
