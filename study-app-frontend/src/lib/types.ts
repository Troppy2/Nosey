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
  kojo_sync_default?: boolean;
  kojo_allow_artifacts?: boolean;
  kojo_auto_index?: boolean;
  kojo_persona?: string | null;
  is_archived?: boolean;
  avoid_repeat_questions?: boolean;
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
  generation_status?: string;
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
  generation_status: string;
} & GenerationDiagnostics;

export type MCQOption = {
  id: ID;
  text: string;
  is_correct: null;
};

export type QuestionType = "MCQ" | "FRQ" | string;

export type Question = {
  id: ID;
  type: QuestionType;
  question_text: string;
  options: MCQOption[];
  expected_answer?: string | null;
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
  type: QuestionType;
  question_text: string;
  options: MCQOptionEditable[];
  expected_answer?: string | null;
};

export type QuestionCreate = {
  type: QuestionType;
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
  folder_id?: ID;
  folder_name?: string;
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
  test_id: ID;
  folder_id?: ID | null;
  test_title: string;
  answers: AnswerResult[];
};

export type DraftAttemptAnswer = {
  question_id: ID;
  user_answer: string;
};

export type DraftAttemptResponse = {
  attempt_id: ID;
  attempt_number: number;
  answers: DraftAttemptAnswer[];
  exited_at?: string | null;
};

export type ResumableTestInfo = {
  test_id: ID;
  test_title: string;
  attempt_id: ID;
  attempt_number: number;
  exited_at: string;
  answered_question_count: number;
  total_question_count: number;
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

export type TestCreationParams = {
  title: string;
  folderId: number;
  testType: string;
  countMcq: number;
  countFrq: number;
  countTf?: number;
  countMs?: number;
  countRank?: number;
  isMathMode: boolean;
  isCodingMode: boolean;
  codingLanguage: string;
  difficulty: "easy" | "medium" | "hard" | "mixed";
  topicFocus: string;
  customInstructions: string;
  advancedMode: boolean;
  savedAt: string;
};

export type AuthUser = {
  id: ID;
  email: string;
  full_name?: string | null;
  profile_picture_url?: string | null;
  is_guest?: boolean;
  is_admin?: boolean;
  email_verified?: boolean;
  date_of_birth?: string | null;
  age?: number | null;
  kojo_enabled?: boolean;
};

export type AdminUserRow = {
  id: ID;
  email: string;
  full_name: string | null;
  profile_picture_url: string | null;
  is_admin: boolean;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
};

export type FeatureTiming = {
  feature: string;
  avg_ms: number;
  call_count: number;
};

export type TokenUsageRow = {
  user_id: ID;
  total_tokens: number;
  call_count: number;
};

export type FeatureStat = {
  feature: string;
  call_count: number;
  error_count: number;
  avg_ms: number;
  error_rate: number;
};

export type ProviderStat = {
  provider: string;
  call_count: number;
  success_count: number;
  error_count: number;
  avg_ms: number;
  success_rate: number;
};

export type DailyCount = {
  date: string;
  count: number;
};

export type ErrorBreakdownRow = {
  error_type: string;
  feature: string;
  count: number;
};

export type AdminStats = {
  total_users: number;
  total_usage_events: number;
  total_tokens_used: number;
  active_users_7d: number;
  feature_timings: FeatureTiming[];
  tokens_per_user: TokenUsageRow[];
  feature_stats: FeatureStat[];
  provider_stats: ProviderStat[];
  daily_counts: DailyCount[];
  error_breakdown: ErrorBreakdownRow[];
};

export type AdminTokenResponse = {
  admin_token: string;
  expires_in_seconds: number;
  session_id: string;
};

export type ConversationFile = {
  id: ID;
  file_name: string;
  file_type: string;
  size_bytes: number;
  uploaded_at: string;
};

export type TestBlueprint = {
  title: string;
  test_type: "MCQ_only" | "FRQ_only" | "mixed";
  count_mcq: number;
  count_frq: number;
  difficulty: "easy" | "medium" | "hard" | "mixed";
  topic_focus: string | null;
  intro: string;
};

export type KojoMessageType = "chat" | "blueprint" | "blueprint_done" | "blueprint_cancelled";

export type KojoMessage = {
  id: ID;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  display?: string; // frontend-only: slash command label shown in bubble instead of raw prompt
  message_type?: KojoMessageType; // frontend-only: distinguishes blueprint messages
  blueprint?: TestBlueprint; // frontend-only: attached to blueprint messages
  blueprint_test_id?: ID; // frontend-only: set after successful generation
};

export type KojoConversation = {
  id: ID;
  folder_id?: ID | null;
  messages: KojoMessage[];
  created_at: string;
  cleared_at?: string | null;
};

export type KojoConversationSummary = {
  id: ID;
  name?: string | null;
  folder_id?: ID | null;
  created_at: string;
};

export type KojoChatResponse = {
  response: string;
  conversation_id: ID;
  message_id: ID;
  flagged_uncertain: boolean;
  conversation_name?: string | null;
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

export type ReviewSummaryResponse = {
  summary: string;
};

export type KojoClearedConversation = {
  conversation_id: ID;
  folder_id: ID;
  folder_name: string;
  cleared_at: string;
  restore_expires_at: string;
};

export type LeetCodeExample = {
  index: number;
  input_text: string;
  output_text: string;
  explanation_text?: string | null;
};

export type LeetCodeTopicTag = {
  name: string;
  slug: string;
};

export type LeetCodeProblemData = {
  title: string;
  title_slug: string;
  difficulty: string;
  content_html: string;
  examples: LeetCodeExample[];
  example_testcases: string[];
  python_snippet?: string | null;
  topic_tags: LeetCodeTopicTag[];
};

export type LeetCodeHintResponse = {
  response: string;
  flagged_uncertain: boolean;
};

// ── Custom (user-authored) LeetCode problems ────────────────────────────────────

export type LCCustomDifficulty = "Easy" | "Medium" | "Hard" | "unknown";

export type LCCustomTestCase = {
  input_text: string;
  output_text: string;
  explanation_text?: string | null;
};

export type LCCustomProblem = {
  slug: string;
  title: string;
  topic: string;
  difficulty: LCCustomDifficulty;
  description: string;
  url: string;
  starter_code: string;
  test_cases: LCCustomTestCase[];
  is_archived?: boolean;
};

// What the AI returns from /custom-problems/generate (no slug or url yet).
export type LCGeneratedCustomProblem = {
  title: string;
  topic: string;
  difficulty: LCCustomDifficulty;
  description: string;
  starter_code: string;
  test_cases: LCCustomTestCase[];
};

export type LeetCodeGradeResponse = {
  feedback: string;
  flagged_uncertain: boolean;
};

export type ProviderStatus = {
  gemini: boolean;
  groq: boolean;
  claude: boolean;
  ollama: boolean;
  ollama_model: string;
  ollama_model_available: boolean;
};

export type SlashCommand = {
  id: ID;
  user_id: ID;
  slash: string;
  label: string;
  description: string;
  prompt: string;
  is_pinned: boolean;
  position: number;
  created_at: string;
  updated_at: string;
};

export type SlashCommandInput = {
  slash: string;
  label: string;
  description: string;
  prompt: string;
  is_pinned?: boolean;
  position?: number;
};

// ── Mock Interview ────────────────────────────────────────────────────────────

export type MockInterviewSession = {
  id: ID;
  company: string;
  stages_config: string;
  status: string;
  resume_screen?: string | null;
  stage1_results?: string | null;
  stage2_script?: string | null;
  stage2_submission?: string | null;
  stage3_script?: string | null;
  stage3_answers?: string | null;
  overall_feedback?: string | null;
};

export type ResumeScreenResult = {
  ats_score: number;
  passes_oa: boolean;
  verdict: string;
  matched_keywords: string[];
  missing_keywords: string[];
  strengths: string[];
  gaps: string[];
  fixes: string[];
  summary: string;
};

export type Stage1QuestionResult = {
  slug: string;
  title: string;
  difficulty: string;
  code: string;
  time_used_ms: number;
  verdict: "strong" | "pass" | "borderline" | "needs_work";
  feedback: string;
};

export type Stage1GradeResponse = {
  results: Stage1QuestionResult[];
};

// Conversational interview types
export type InterviewChatMessage = {
  role: "user" | "interviewer";
  content: string;
};

export type CodingProblemInfo = {
  title: string;
  slug: string;
  difficulty: string;
  prompt: string;
};

export type Stage2MessageResponse = {
  reply: string;
  coding_problem?: CodingProblemInfo | null;
  is_done: boolean;
};

export type Stage3MessageResponse = {
  reply: string;
  is_done: boolean;
};

export type MockInterviewFinishResponse = {
  overall_feedback: string;
  resume_verdict?: string | null;
  stage1_verdict?: string | null;
  stage2_verdict?: string | null;
  stage3_verdict?: string | null;
  hiring_recommendation: string;
};
