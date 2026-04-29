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

export type TestTake = {
  id: ID;
  title: string;
  description?: string | null;
  test_type: string;
  questions: Question[];
};

export type SubmittedAnswer = {
  question_id: ID;
  answer: string;
};

export type AnswerResult = {
  question_id: ID;
  user_answer: string;
  is_correct: boolean;
  feedback?: string | null;
  confidence?: number | null;
  flagged_uncertain: boolean;
  question_text?: string;
};

export type AttemptResult = {
  attempt_id: ID;
  attempt_number: number;
  score: number;
  correct_count: number;
  total: number;
  answers: AnswerResult[];
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
};

export type KojoChatResponse = {
  response: string;
  conversation_id: ID;
  message_id: ID;
  flagged_uncertain: boolean;
};
