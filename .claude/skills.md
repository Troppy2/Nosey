# Skills — Capabilities Implemented in Nosey

This documents every significant technical skill, algorithm, and system built into the codebase. Use this to understand what already exists before building something new.

---

## AI / LLM Skills

### Multi-Provider LLM Routing with Fallback
**Where**: `llm_service.py` → `_candidate_providers()`, `_generate_test_attempts()`, `_complete_json()`

A provider selection system that tries multiple LLM backends in order (Groq → Gemini → Claude → Ollama). If a provider fails (rate limit, network error, JSON parse error, etc.), the next one is tried automatically. Provider priority is user-configurable ("auto" vs. specific provider). Provider availability is checked on page load via `/kojo/providers/status`. The retry loop catches ALL exceptions uniformly — a `LLMException` from one provider does not exit the loop.

### Study Content Extraction (Two-Pass Generation)
**Where**: `llm_service.py` → `_extract_study_content()`, `_build_generation_prompt()`

Normal test generation uses two LLM calls: first extracts structured terms/concepts from raw notes (stripping metadata, authors, citations), then generates questions grounded in that structure. This produces better-quality questions than prompting directly on raw notes. Falls back gracefully to raw sentence extraction if the first pass fails.

### RAG (Retrieval-Augmented Generation)
**Where**: `llm_service.py` → `_retrieve_relevant_context()`, `_chunk_notes_for_retrieval()`, `_embed_text_for_retrieval()`

A lightweight retrieval system that chunks study notes into overlapping 160-word segments, embeds them using Blake2b hash-based token vectors (no external embedding model), and selects the top-6 chunks most semantically similar to the generation query (test type + difficulty + topic). Runs in a thread pool executor to avoid blocking the async event loop. Context window limited to 8,000 chars.

### Math Mode Generation and Validation
**Where**: `llm_service.py` → `_build_math_generation_prompt()`, `_is_valid_math_mcq()`, `_is_valid_math_frq()`

Specialized question generation for math content. Enforces KaTeX wrapping (`$...$` inline, `$$...$$` block) in all output. MCQ validator requires math content in the question AND all 4 answer options. FRQ validator blocks explanation questions ("Explain...", "Describe...") and requires computation questions ("Solve...", "Find...", "Evaluate..."). Computation detection uses two regexes: `_MATH_FRQ_CONCEPTUAL_RE` (block list) and `_MATH_FRQ_COMPUTE_RE` (allow list).

### Math Grading with Step-by-Step LaTeX
**Where**: `llm_service.py` → `grade_math_answer()`

Prompts the LLM to evaluate student math answers and return structured JSON with: `is_correct`, `what_went_right`, `what_went_wrong`, a `steps` array (each step has description + LaTeX expression), `final_answer` in LaTeX, and `confidence`. Accepts equivalent forms (e.g., `x=4` and `4` are treated as the same answer). Builds structured markdown feedback for the frontend.

### Code Generation and Grading
**Where**: `llm_service.py` → `_build_coding_generation_prompt()`, `grade_code_answer()`

Generates programming challenges with problem description, input/output format, and examples. Grading evaluates: correctness, logic soundness, edge case handling, time complexity. Returns structured JSON with `what_went_right`, `what_went_wrong`, `improvements` (list), `corrected_snippet`, and `time_complexity`. Lenient on minor syntax errors when logic is correct.

### FRQ Grading with Uncertainty Flags
**Where**: `llm_service.py` → `grade_frq_answer()`

LLM-based grading for free-response answers. Returns `is_correct`, `feedback`, `flagged_uncertain`, and `confidence` (0.0–1.0). `flagged_uncertain=True` signals the grader wasn't confident — shown to students as a caveat. If LLM unavailable, falls back to keyword overlap scoring using a threshold from config (`LLM_UNCERTAINTY_THRESHOLD=0.6`).

### Flashcard Generation with Deduplication
**Where**: `llm_service.py` → `generate_flashcards()`, `_dedupe_flashcards()`

Generates flashcards with awareness of existing cards. Sends existing card fronts/backs to the LLM as "do not repeat." After generation, deduplicates by normalized key (`front + back` lowercased, punctuation stripped). If initial generation has too many duplicates, automatically retries once with an even stronger "only new cards" instruction.

### Deterministic Math Fallback Questions
**Where**: `llm_service.py` → `_fallback_math_questions()`

When all LLM providers fail in math mode, generates algebra problems deterministically (`ax + b = c`) using Python's `Fraction` class for exact arithmetic. Produces real, correct math questions without any external dependency. Distractors are mathematically distinct wrong answers, not random noise.

### Practice Test Parsing
**Where**: `llm_service.py` → `parse_practice_test()`

Extracts questions from uploaded practice test documents. Handles both MCQ (extracts question + 4 options + correct index) and FRQ (extracts question + sample answer, or generates expected answer from context). Does not apply min-count filtering like test generation does — returns however many questions it finds.

### Parallel Async FRQ Grading
**Where**: `grading_service.py` → `GradingService.submit_attempt()`

All FRQ answers in a submitted attempt are graded concurrently using `asyncio.gather()`. MCQ is scored instantly without LLM. Combined results are stored atomically. Grading results include per-question feedback, is_correct, confidence, and flagged_uncertain.

### Weakness Detection
**Where**: `grading_service.py` → `get_weakness_detection()`

Identifies questions the user has failed in recent attempts, ranked by failure frequency. Used to highlight study gaps after multiple attempts.

---

## File Handling Skills

### Multi-Format Document Extraction
**Where**: `file_service.py` → `FileService.extract_from_files()`

Extracts text from PDF (pdfplumber + PyMuPDF fallback), DOCX (python-docx), TXT, and Markdown files. Runs in a process pool executor (multiprocessing) to avoid blocking the async event loop during CPU-intensive PDF parsing. Handles multi-file uploads by concatenating content with `---` separators.

### Persistent Folder Files
**Where**: `routes/folder_files.py`, `models/folder_file.py`, `file_service.py`

Study documents can be stored persistently in a folder (not just uploaded per-test). These "folder files" are automatically included as context for all test and flashcard generation in that folder. They're stored as raw content in the `FolderFile` table so they can be reused without re-uploading.

### Metadata Stripping
**Where**: `llm_service.py` → `_strip_metadata()`

Removes YAML frontmatter (`---...---`), document markers (`[filename]`, `--- Document 1: file.md ---`), and standalone horizontal rules before LLM processing. Collapses excess blank lines. Prevents author names, publication dates, and file paths from polluting the study content and appearing in generated questions.

---

## Backend Skills

### Repository Pattern
**Where**: `repositories/` directory

Database access is separated from business logic via Repository classes (`TestRepository`, `FolderRepository`, `FlashcardRepository`, `KojoRepository`, `AttemptRepository`). Services call repositories; repositories handle SQLAlchemy queries. This makes it easy to change queries without touching business logic.

### Pydantic Settings with Env Var Aliases
**Where**: `config.py`

Uses Pydantic `BaseSettings` with `Field(alias="ENV_VAR_NAME")` for all config. Complex types (CORS origins, allowed file types) have custom validators that parse both JSON arrays and comma-separated strings. Single `settings` instance imported everywhere.

### Async Database Sessions
**Where**: `database.py`, `dependencies.py`

Uses `sqlalchemy.ext.asyncio.AsyncSession` throughout. Sessions are created per-request via `Depends(get_session)` FastAPI dependency. All DB operations use `async with` and `await`.

### JWT Auth with Google OAuth
**Where**: `auth_service.py`, `routes/auth.py`, `dependencies.py`

Google ID token verified server-side using `google-auth` library. On success, user is created or updated in the database, and a JWT is issued using `python-jose`. JWT contains `user_id` and expiry. `get_current_user` dependency decodes the JWT and returns the User ORM object.

### Incremental Attempt Numbering
**Where**: `test_repository.py`

Each attempt for a test is numbered sequentially per user per test. The repository queries the max existing attempt number and increments. This gives a natural "Attempt 1", "Attempt 2", etc. display.

---

## Frontend Skills

### KaTeX Math Rendering
**Where**: `components/MarkdownContent.tsx`

Custom markdown renderer that intercepts `$...$` (inline) and `$$...$$` (block) patterns and renders them with KaTeX. Falls back to plain text if KaTeX throws. Used in test questions, answer options, grading feedback, and flashcard content.

### Math Keyboard Input
**Where**: `components/MathInput.tsx`, `components/MathKeyboard.tsx`

On-screen keyboard for entering math expressions without knowing LaTeX. Symbols and operators are organized by category. The input component previews the entered expression via KaTeX in real time. Used in `TakeTest.tsx` for math FRQ answers.

### Monaco Code Editor
**Where**: `TakeTest.tsx` (coding mode FRQ answers)

Embeds Monaco Editor (the VS Code editor engine) for code input during coding-mode tests. Supports syntax highlighting for the selected language. Falls back to textarea if Monaco doesn't load.

### Provider-Aware Dropdowns
**Where**: `FlashcardsManage.tsx`, `CreateTest.tsx`

Provider dropdowns fetch live provider status (`/kojo/providers/status`) on mount and disable unavailable options with explanatory labels ("offline", "no key"). If the user's saved provider preference becomes unavailable (e.g., API key removed), it auto-resets to "auto".

### Flashcard Flip Interface
**Where**: `Flashcards.tsx`

Card flip animation (CSS transform), front/back tracking, mark-correct/mark-difficult buttons. Cards sorted by difficulty score (hardest first). Streak and session tracking for motivation.

### Pill Toggle Switch (Settings)
**Where**: `Settings.tsx`, `styles.css` (`.settings-toggle-switch`)

Custom CSS pill-shaped toggle switch without any external library. Track (`56×30px`) with sliding thumb (`22×22px`). Muted green when off (`--green-light`), dark green when on (`--green-dark`). Smooth transition on both track color and thumb position.

### Conversation Restore Timer
**Where**: `Settings.tsx` → `getRestoreTimeLabel()`

Computes human-readable countdown to restore expiry ("2h 34m left", "Expired") from ISO timestamps. Updates are implicit on page load, not via interval — acceptable since the page isn't viewed constantly.

### Guest Mode Client Enforcement
**Where**: `api.ts` → `createFolder()`, `createTest()`

Before calling the API, checks `isGuestSession()` and fetches current counts. Throws a user-facing error if the guest limit is reached. This happens in the API client layer, not the UI component — consistent across any component that calls these functions.

### Stats Reset Baseline (localStorage Snapshot)
**Where**: `Settings.tsx` → `handleResetStats()`, `Dashboard.tsx`

"Reset Stats" snapshots current aggregate totals into localStorage. The dashboard reads this baseline and subtracts it from live data to show relative progress since last reset. The baseline includes: total attempts, cards reviewed, score sum, score count, and reset timestamp.

---

## Operational Skills

### Docker Multi-Stage Build (Frontend)
**Where**: `study-app-frontend/Dockerfile`

Two-stage build: Node 20 for `npm run build`, Nginx 1.27 for serving the compiled static assets. `VITE_API_BASE_URL` is baked into the bundle at build time via Docker build args. Custom `nginx.conf` handles client-side routing (all routes serve `index.html`).

### Health Check Endpoint
**Where**: `routes/health.py` → `GET /health`

Simple JSON `{"status": "ok"}` response used by docker-compose health check and monitoring systems. Backend container is considered healthy only after this returns 200. Other services that depend on the backend wait for this health check.

### Structured Logging
**Where**: `utils/logger.py`, used throughout services

All logging uses `get_logger(__name__)`. LLM calls log provider name, success/failure, token-related warnings. This makes provider fallback and failure patterns visible in logs without code changes.

### Alembic Migration Management
**Where**: `src/migrations/`

Five migrations covering the full schema evolution: initial schema → Kojo tables → math mode column → coding mode columns → folder files table. New schema changes require a new migration file. Migrations run automatically at container startup via `entrypoint.sh`.
