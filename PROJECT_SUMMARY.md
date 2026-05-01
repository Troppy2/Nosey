# Nosey — AI Study Tool: Project Summary

---

## Backend Architecture (Layered)

```
┌──────────────────────────────────────────────────────────────┐
│                        Client (Browser)                      │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTP / REST
┌───────────────────────────▼──────────────────────────────────┐
│                    FastAPI Application                        │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                    Routes Layer                         │ │
│  │  auth · folders · folder_files · tests · attempts       │ │
│  │  flashcards · kojo · health                             │ │
│  └───────────────────────┬─────────────────────────────────┘ │
│  ┌───────────────────────▼─────────────────────────────────┐ │
│  │                   Services Layer                        │ │
│  │  auth_service · folder_service · file_service           │ │
│  │  test_service · grading_service · flashcard_service     │ │
│  │  kojo_service · llm_service                             │ │
│  └──────────────┬────────────────────┬──────────────────── ┘ │
│  ┌──────────────▼────────┐  ┌────────▼──────────────────────┐│
│  │   Repositories Layer  │  │       External LLMs           ││
│  │  (SQLAlchemy ORM)     │  │  Gemini · Groq · Ollama       ││
│  └──────────────┬────────┘  └───────────────────────────────┘│
│  ┌──────────────▼────────────────────────────────────────────┐│
│  │              PostgreSQL Database                          ││
│  └───────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

---

## Project Tree

```
Nosey--AI Study Tool/
├── PROJECT_SUMMARY.md
├── README.md
├── RUNNING.md
├── package.json                        # Root monorepo scripts
│
├── study-app-backend/
│   ├── .env.example
│   ├── requirements.txt
│   ├── alembic/                        # DB migrations
│   ├── tests/
│   │   └── test_file_service.py
│   └── src/
│       ├── main.py                     # App entry, CORS, router registration
│       ├── config.py                   # Pydantic settings (env vars)
│       ├── database.py                 # Async SQLAlchemy session
│       ├── dependencies.py             # Auth dependency injection
│       ├── routes/
│       │   ├── auth.py
│       │   ├── folders.py
│       │   ├── folder_files.py
│       │   ├── tests.py
│       │   ├── attempts.py
│       │   ├── flashcards.py
│       │   ├── kojo.py
│       │   └── health.py
│       ├── services/
│       │   ├── auth_service.py
│       │   ├── file_service.py
│       │   ├── folder_service.py
│       │   ├── test_service.py
│       │   ├── grading_service.py
│       │   ├── flashcard_service.py
│       │   ├── kojo_service.py
│       │   └── llm_service.py
│       ├── schemas/
│       │   ├── auth_schema.py
│       │   ├── folder_schema.py
│       │   ├── test_schema.py
│       │   ├── attempt_schema.py
│       │   ├── flashcard_schema.py
│       │   └── kojo_schema.py
│       ├── models/                     # SQLAlchemy ORM models (15 files)
│       │   ├── user.py
│       │   ├── folder.py
│       │   ├── folder_file.py
│       │   ├── note.py
│       │   ├── test.py
│       │   ├── question.py
│       │   ├── mcq_option.py
│       │   ├── frq_answer.py
│       │   ├── user_attempt.py
│       │   ├── user_answer.py
│       │   ├── flashcard.py
│       │   ├── kojo_conversation.py
│       │   └── kojo_message.py
│       ├── repositories/               # Data access layer (6 files)
│       └── utils/
│           ├── exceptions.py
│           ├── validators.py
│           └── logger.py
│
└── study-app-frontend/
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    └── src/
        ├── main.tsx                    # React root
        ├── app/
        │   └── App.tsx                 # Router + route definitions
        ├── components/
        │   ├── AppShell.tsx
        │   ├── Button.tsx
        │   ├── Card.tsx
        │   ├── Field.tsx
        │   ├── EmptyState.tsx
        │   ├── FileManager.tsx
        │   ├── KojoChat.tsx
        │   ├── MarkdownContent.tsx
        │   ├── MathInput.tsx
        │   └── MathKeyboard.tsx
        ├── pages/
        │   ├── Landing.tsx
        │   ├── Dashboard.tsx
        │   ├── Folders.tsx
        │   ├── FolderDetail.tsx
        │   ├── CreateTest.tsx
        │   ├── TakeTest.tsx
        │   ├── Results.tsx
        │   ├── QuestionEditor.tsx
        │   ├── Flashcards.tsx
        │   ├── FlashcardsManage.tsx
        │   └── Settings.tsx
        ├── lib/
        │   ├── api.ts
        │   ├── types.ts
        │   └── format.ts
        └── styles/
            └── styles.css
```

---

## Backend

### `src/main.py`
FastAPI app entry point. Registers all routers, sets CORS middleware (`allow_origins=["*"]` — dev only), and mounts the app at the root.

### `src/config.py`
Pydantic `BaseSettings` class that reads from `.env`. Covers: `DATABASE_URL`, `SECRET_KEY`, `GOOGLE_CLIENT_ID`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OLLAMA_BASE_URL`, JWT expiry, and file size/count limits.

### `src/database.py`
Async SQLAlchemy engine + `AsyncSession` factory. Exposes `get_session` as a FastAPI dependency.

### `src/dependencies.py`
`get_current_user` dependency — decodes the JWT from `Authorization: Bearer`, looks up the user in DB. Used on every authenticated route.

---

### Routes

#### `routes/auth.py` — prefix `/auth`
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/google` | Verifies Google ID token, upserts user, returns JWT + user object |

#### `routes/folders.py` — prefix `/folders`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/folders` | List all folders for the authenticated user |
| POST | `/folders` | Create a new folder |
| GET | `/folders/{folder_id}` | Get single folder |
| PATCH | `/folders/{folder_id}` | Update folder name/subject/description |
| DELETE | `/folders/{folder_id}` | Delete folder and cascade contents |

#### `routes/folder_files.py` — prefix `/folders`
Persists uploaded study files as `FolderFile` records (stores extracted text content). Max 30 files per folder, 10 MB per file.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/folders/{folder_id}/files` | List files saved to a folder |
| POST | `/folders/{folder_id}/files` | Upload one or more files (PDF/DOCX/TXT/MD), extracts and stores text |
| DELETE | `/folders/{folder_id}/files/{file_id}` | Remove a saved file |

#### `routes/tests.py`
| Method | Path | Description |
|--------|------|-------------|
| POST | `/folders/{folder_id}/tests` | Create test — multipart form with notes files + generation params |
| GET | `/tests` | List all tests for the user (across all folders) |
| GET | `/folders/{folder_id}/tests` | List tests in a specific folder |
| GET | `/tests/{test_id}` | Get test with questions for taking |
| PATCH | `/tests/{test_id}` | Update test title/description |
| DELETE | `/tests/{test_id}` | Delete test |
| GET | `/tests/{test_id}/progress` | Get per-question weakness detection stats |
| GET | `/tests/{test_id}/edit` | Get questions in editable form |
| POST | `/tests/{test_id}/questions` | Add a question manually |
| PUT | `/tests/{test_id}/questions/{question_id}` | Update a question |
| DELETE | `/tests/{test_id}/questions/{question_id}` | Delete a question |

Test creation form fields: `title`, `test_type`, `notes_files[]`, `practice_test_file`, `count_mcq` (0–50), `count_frq` (0–50), `is_math_mode`, `difficulty` (easy/medium/hard/mixed), `topic_focus` (200 chars max), `is_coding_mode`, `coding_language`, `custom_instructions` (500 chars max).

#### `routes/attempts.py`
| Method | Path | Description |
|--------|------|-------------|
| POST | `/tests/{test_id}/attempts` | Submit answers, triggers grading, returns full result |
| GET | `/tests/{test_id}/attempts` | List attempt history (scores + timestamps) |
| GET | `/attempts/{attempt_id}` | Get full attempt detail with per-answer feedback |
| GET | `/tests/{test_id}/attempts/{attempt_id}` | Alias of above |

#### `routes/flashcards.py`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/flashcards` | All flashcards for user across all folders |
| GET | `/folders/{folder_id}/flashcards` | Flashcards in a folder |
| POST | `/folders/{folder_id}/flashcards` | Create a single flashcard manually |
| POST | `/folders/{folder_id}/flashcards/generate` | AI-generate flashcards from a prompt or from an existing test |
| POST | `/folders/{folder_id}/flashcards/generate-from-file` | AI-generate flashcards from uploaded file(s) |
| GET | `/folders/{folder_id}/flashcards/weak` | Get cards below a success-rate threshold (default 0.5) |
| PATCH | `/folders/{folder_id}/flashcards/{flashcard_id}` | Update front/back text |
| DELETE | `/folders/{folder_id}/flashcards/{flashcard_id}` | Delete a flashcard |
| POST | `/folders/{folder_id}/flashcards/{flashcard_id}/attempt` | Record a study attempt (correct: bool, time_ms: int) |

#### `routes/kojo.py` — prefix `/kojo`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/kojo/providers/status` | Check which LLM providers are reachable |
| POST | `/kojo/folders/{folder_id}/chat` | Send a message to Kojo; builds context from folder notes and responds |
| GET | `/kojo/folders/{folder_id}/conversation` | Get current conversation history |
| POST | `/kojo/folders/{folder_id}/clear` | Archive and clear the conversation |
| POST | `/kojo/folders/{folder_id}/restore` | Restore the most recently cleared conversation |
| GET | `/kojo/conversations/cleared` | List all archived conversations |

#### `routes/health.py`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness check — returns `{"status": "ok"}` |

---

### Services

#### `auth_service.py`
Verifies Google ID token via `google-auth` library. Upserts user record in DB. Generates and validates JWTs with `PyJWT` (24-hour expiry, HS256).

#### `file_service.py`
Extracts text from uploaded files. PDF uses a dual-engine approach: PyMuPDF primary, pdfplumber fallback. DOCX via python-docx. TXT/MD read directly. Parallel processing up to 4 workers for multi-page PDFs. Validates file type and enforces max size (10 MB).

#### `folder_service.py`
CRUD operations for folders. Enforces guest limits (1 folder max). Cascade-deletes all related tests, flashcards, and files.

#### `test_service.py`
Orchestrates test creation: extracts text from uploaded notes or saved folder files, calls `llm_service` to generate questions, persists `Test`, `Question`, `MCQOption`, and `FRQAnswer` records. Also handles listing, editing, and deletion.

#### `grading_service.py`
Grades submitted attempts. MCQ: exact string match against correct option. FRQ: calls `llm_service` for semantic evaluation with confidence score. Coding: LLM evaluates logic and syntax. Math: LLM verifies step-by-step work. Persists `UserAttempt` and `UserAnswer` records. Weakness detection: aggregates per-question attempt history and categorizes as weak (<50%), review (<80%), or strong (≥80%).

#### `flashcard_service.py`
CRUD for flashcards. Records attempts and updates `attempt_count`/`correct_count`. AI generation calls `llm_service` with deduplication against existing cards. Weak card query filters by computed success rate.

#### `kojo_service.py`
Manages `KojoConversation` and `KojoMessage` records per user+folder. Builds LLM context by extracting relevant sections from folder notes using keyword matching (caps context window at ~8–12K chars). Clear/restore archives the current message list into a soft-deleted state.

#### `llm_service.py`
Central LLM integration layer. Supports three providers:
- **Gemini** — primary for structured JSON generation (question generation, grading)
- **Groq** — fallback with rate-limit handling
- **Ollama** — local inference, catches connection errors gracefully

Responsibilities:
- Generate MCQ + FRQ questions from study content (math-aware, coding-aware)
- Parse existing practice test documents into question objects
- Grade FRQ/coding/math answers with confidence scoring
- Generate flashcards with deduplication
- Produce Kojo conversational responses with folder-context injection
- `check_providers_status()` — pings all three providers and reports availability

---

### Schemas

| File | Key Models |
|------|-----------|
| `auth_schema.py` | `GoogleAuthRequest`, `AuthResponse`, `UserResponse` |
| `folder_schema.py` | `FolderCreate`, `FolderUpdate`, `FolderResponse` |
| `test_schema.py` | `CreateTestResponse`, `TestSummary`, `TestTakeResponse`, `TestResponse`, `QuestionEditable`, `QuestionCreate`, `QuestionUpdate`, `WeaknessResponse` |
| `attempt_schema.py` | `SubmitAttemptRequest`, `AttemptResult`, `AttemptSummary`, `AttemptDetail`, `AnswerResult`, `FRQGrade` |
| `flashcard_schema.py` | `FlashcardCreate`, `FlashcardUpdate`, `FlashcardResponse`, `FlashcardGenerateRequest`, `FlashcardAttemptCreate` |
| `kojo_schema.py` | `KojoChatRequest`, `KojoChatResponse`, `KojoConversationDTO`, `KojoClearResponse`, `KojoRestoreResponse`, `KojoClearedConversationDTO` |

---

### Models (ORM)

| Model | Table | Key Fields |
|-------|-------|-----------|
| `User` | `users` | `id`, `email`, `full_name`, `google_id` |
| `Folder` | `folders` | `id`, `user_id`, `name`, `subject`, `description` |
| `FolderFile` | `folder_files` | `id`, `folder_id`, `file_name`, `file_type`, `size_bytes`, `content` |
| `Note` | `notes` | `id`, `folder_id`, `test_id`, `content` (raw extracted text used for test generation) |
| `Test` | `tests` | `id`, `folder_id`, `user_id`, `title`, `test_type`, `is_math_mode`, `is_coding_mode` |
| `Question` | `questions` | `id`, `test_id`, `question_text`, `question_type` (mcq/frq), `difficulty`, `order` |
| `MCQOption` | `mcq_options` | `id`, `question_id`, `option_text`, `is_correct` |
| `FRQAnswer` | `frq_answers` | `id`, `question_id`, `answer_text` (expected answer) |
| `UserAttempt` | `user_attempts` | `id`, `test_id`, `user_id`, `score`, `created_at` |
| `UserAnswer` | `user_answers` | `id`, `attempt_id`, `question_id`, `answer_text`, `is_correct`, `feedback` |
| `Flashcard` | `flashcards` | `id`, `folder_id`, `user_id`, `front`, `back`, `attempt_count`, `correct_count` |
| `KojoConversation` | `kojo_conversations` | `id`, `user_id`, `folder_id`, `is_cleared` |
| `KojoMessage` | `kojo_messages` | `id`, `conversation_id`, `role` (user/assistant), `content` |

---

### Utils

#### `utils/exceptions.py`
Custom exception hierarchy: `StudyAppException` (base) → `ResourceNotFoundException`, `ValidationException`, `LLMException`. Routes catch these and map them to HTTP status codes.

#### `utils/validators.py`
Constants: `MAX_UPLOAD_FILE_SIZE_BYTES` (10 MB), `MAX_UPLOAD_DOCUMENTS` (30). Allowed MIME types and extensions for file upload. `normalize_filename()` helper.

#### `utils/logger.py`
Standard Python logging setup with consistent format across services.

---

## Frontend

**Stack:** React 18, TypeScript, React Router v6, Vite. No external state manager — all state is local hooks. Styling via a single hand-written CSS file.

**Key dependencies:**
- `katex` — math rendering
- `@monaco-editor/react` — code editor for coding-mode questions
- `lucide-react` — icons
- `react-router-dom` — client-side routing

---

### Routes (`App.tsx`)

All routes except `/` are wrapped in `AppShell` (the persistent sidebar layout).

| Path | Page Component |
|------|---------------|
| `/` | `Landing` |
| `/dashboard` | `Dashboard` |
| `/folders` | `Folders` |
| `/folders/:folderId` | `FolderDetail` |
| `/create-test` | `CreateTest` |
| `/test/:testId` | `TakeTest` |
| `/test/:testId/edit` | `QuestionEditor` |
| `/results/:attemptId` | `Results` |
| `/flashcards` | `Flashcards` (all folders) |
| `/flashcards/:folderId` | `Flashcards` (single folder) |
| `/folders/:folderId/flashcards/manage` | `FlashcardsManage` |
| `/settings` | `Settings` |
| `*` | Redirect to `/` |

---

### Pages

#### `Landing.tsx`
Auth screen. Google Sign-In button (uses Google Identity Services SDK to get an ID token, then calls `POST /auth/google`). Also has a guest mode button that sets a local guest token. Redirects to `/dashboard` on success.

#### `Dashboard.tsx`
Home screen after login. Shows a typewriter greeting animation, recent tests, and recent flashcard decks. Entry point to navigate to folders or start studying.

#### `Folders.tsx`
Lists all user folders (fetches `GET /folders`). Create/edit/delete folder dialogs inline. Each folder card links to `/folders/:folderId`.

#### `FolderDetail.tsx`
Shows all tests and flashcard decks inside a folder. Hosts the `KojoChat` panel and `FileManager` component. Test cards show best score and attempt count. Flashcard deck shows card count and weak-card count.

#### `CreateTest.tsx`
Multi-step test creation form. Fields:
- Folder selector
- Title
- Test type (MCQ / FRQ / Mixed)
- File upload (notes or practice test file)
- Advanced: MCQ count, FRQ count, difficulty, topic focus, math mode toggle, coding mode toggle (+ language picker), custom instructions

Submits as `multipart/form-data` to `POST /folders/{folderId}/tests`.

#### `TakeTest.tsx`
Renders questions one at a time or all at once depending on test type. MCQ shows radio buttons. FRQ shows a textarea. Math mode renders KaTeX and includes `MathInput`/`MathKeyboard`. Coding mode renders a Monaco editor with language selection. Submits answers to `POST /tests/{testId}/attempts` and navigates to `/results/:attemptId`.

#### `Results.tsx`
Fetches `GET /attempts/{attemptId}`. Shows score, per-question breakdown with correct answer, user answer, and LLM feedback. FRQ shows confidence score. Coding shows evaluation notes.

#### `QuestionEditor.tsx`
Fetches `GET /tests/{testId}/edit`. Lists all questions with inline edit forms. Supports adding new questions (`POST /tests/{testId}/questions`), editing (`PUT /tests/{testId}/questions/{questionId}`), and deleting (`DELETE /tests/{testId}/questions/{questionId}`).

#### `Flashcards.tsx`
Flashcard study interface. Flip animation on click. Records attempts via `POST /folders/{folderId}/flashcards/{cardId}/attempt`. Shows success rate per card. Filter by weak cards only.

#### `FlashcardsManage.tsx`
CRUD interface for flashcards in a folder. Create manually, generate from prompt, generate from an existing test, or generate from uploaded files. Edit front/back inline. Delete cards. Calls the full flashcard API surface.

#### `Settings.tsx`
User profile display (name, email). Sign out button. No backend write currently.

---

### Components

#### `AppShell.tsx`
Persistent layout wrapper. Left sidebar with navigation links (Dashboard, Folders, Flashcards, Settings). Renders children via React Router `<Outlet>`. Handles auth guard — redirects unauthenticated users to `/`.

#### `KojoChat.tsx`
Full AI tutor chat UI embedded in `FolderDetail`. Features:
- Provider selector (Gemini / Groq / Ollama) with availability indicators from `GET /kojo/providers/status`
- Message thread with markdown + KaTeX rendering via `MarkdownContent`
- Uncertainty badge on responses flagged by the LLM
- Clear conversation (archives history) and restore last cleared conversation
- Fullscreen toggle
- Calls `POST /kojo/folders/{folderId}/chat`

#### `FileManager.tsx`
Drag-and-drop + click-to-upload file manager for a folder's saved study documents. Lists files with name, type, and size. Delete button per file. Calls `GET/POST/DELETE /folders/{folderId}/files`.

#### `MarkdownContent.tsx`
Renders markdown text with inline and block KaTeX math (delimiters: `$...$` and `$$...$$`). Used in Kojo messages and question/answer display.

#### `MathInput.tsx`
Controlled textarea that renders a live KaTeX preview below as the user types. Used in math-mode FRQ answers during test-taking.

#### `MathKeyboard.tsx`
On-screen keyboard with common math symbols and LaTeX shortcuts. Inserts text at cursor position in `MathInput`. Organized by category (operators, fractions, Greek letters, etc.).

#### `Button.tsx`
Reusable button with variant props (primary, secondary, ghost, danger) and loading state spinner.

#### `Card.tsx`
Generic container with consistent padding, border, and shadow. Used across dashboards and lists.

#### `Field.tsx`
Form field wrapper that pairs a `<label>` with its input and optional error/helper text.

#### `EmptyState.tsx`
Centered empty-state display with icon, heading, and call-to-action. Used when lists have no items.

---

### `lib/api.ts`
Centralized fetch wrapper. All API calls go through `request<T>(path, options)` which:
- Injects `Authorization: Bearer <token>` from `localStorage`
- Sets `Content-Type: application/json` unless body is `FormData`
- On 401, clears local storage and redirects to `/`
- Throws with the backend `detail` message on non-2xx

Auth helpers: `googleSignIn`, `signOut`, `getStoredUser`, `isGuestSession`, `setGuestSession`.

Token/user stored under keys `nosey_access_token` and `nosey_user` in `localStorage`. Guest mode uses the sentinel string `nosey_guest_token` as the token value. Guest limits (1 folder, 1 test) are enforced client-side in `createFolder` and `createTest` before the API call.

---

### `lib/types.ts`
All shared TypeScript interfaces mirroring backend schemas: `AuthUser`, `Folder`, `TestSummary`, `TestTake`, `Question`, `MCQOption`, `AttemptResult`, `AttemptDetail`, `AnswerResult`, `Flashcard`, `KojoChatResponse`, `KojoConversation`, `KojoClearedConversation`, `ProviderStatus`, `SubmittedAnswer`, `QuestionEditable`, `QuestionCreate`, `QuestionUpdate`, `FlashcardUpdate`.

---

### `lib/format.ts`
Pure utility functions: `formatDate`, `formatPercent`, `scoreToGrade`, `scoreColor` (for conditional styling based on score thresholds).

---

### `styles/styles.css`
Single global stylesheet (~48 KB). Defines: CSS custom properties (color tokens, spacing, typography scale), component classes for buttons/cards/fields/badges, layout utilities, animation keyframes (flip, typewriter, fade), math keyboard grid layout, Kojo chat bubble styles, and responsive breakpoints.
