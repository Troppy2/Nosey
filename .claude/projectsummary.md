# Nosey — AI Study Tool: Project Summary

## What This Is

Nosey is a full-stack AI-powered study platform. Students upload notes or documents, and the app generates practice tests, flashcards, and interactive quiz sessions grounded in that material. An in-app AI tutor ("Kojo") answers questions about the uploaded content in a chat interface. The system supports multiple LLM providers simultaneously with intelligent fallback.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, React Router 6 |
| Backend | FastAPI (Python), SQLAlchemy ORM, Alembic migrations |
| Database | PostgreSQL 16 |
| File parsing | pdfplumber, PyMuPDF, python-docx |
| Math rendering | KaTeX (frontend), LaTeX-aware prompting (backend) |
| Code editing | Monaco Editor |
| Auth | Google OAuth 2.0 + JWT (python-jose) |
| Deployment | Docker + docker-compose (backend:8000, frontend:80/nginx) |
| HTTP client | httpx (async, used for all LLM provider calls) |

---

## Feature Inventory

### Test Generation
- AI generates MCQ and FRQ questions from uploaded study materials
- Test types: `MCQ_only`, `FRQ_only`, `mixed`
- Advanced creation options: math mode, coding mode, difficulty (easy/medium/hard/mixed), topic focus, custom instructions
- Practice test parsing: upload an existing test PDF and extract its questions directly
- Per-question editing: add, update, delete questions after creation
- Route: `POST /folders/{id}/tests`

### Grading
- MCQ: instant correctness check
- FRQ: LLM-graded with natural language feedback, confidence score, uncertainty flag
- Math FRQ: step-by-step LaTeX solution shown alongside grading
- Code FRQ: correctness, logic check, time complexity, corrected snippet returned
- Fallback grading: keyword overlap scoring when LLM is unavailable
- Parallel async grading for all FRQs in one attempt submission

### Flashcards
- Manual create/edit/delete via `FlashcardsManage` page
- AI generation: from a test, from a prompt, from an uploaded file
- Deduplication: generated cards compared to existing cards (normalized key matching)
- Difficulty tracking: dynamic difficulty scores from attempt history
- Weak card detection and filtering

### Kojo (AI Tutor)
- Per-folder conversation context (each folder has its own conversation thread)
- Conversation history persisted in database (`kojo_conversations`, `kojo_messages`)
- Clear conversation with 5-hour restore window (soft-delete pattern)
- Cleared conversations viewable and restorable from Settings page
- Provider-selectable: user can pick which LLM powers Kojo responses

### Folder & File Management
- Folders organize tests + flashcards by subject
- Folder files: persistent study documents stored per folder (used as context for all generation tasks in that folder)
- File types supported: PDF, DOCX, TXT, MD (validated server-side)
- Max 30 upload files per test creation, max 50MB per file

### Authentication
- Google OAuth via `google-auth` library, verified on backend
- JWT issued on successful verification, stored in localStorage (`nosey_access_token`)
- Guest mode: limited to 1 folder + 1 test (enforced in `api.ts` before the API call)

### Settings Page
- Google sign-in / sign-out
- Study stats reset (baseline snapshot saved to localStorage)
- Question fallback toggle: enable/disable LLM fallback when providers fail (`nosey_question_fallback` localStorage key)
- LLM provider selector per operation (generation + Kojo use separate provider preferences)
- Kojo conversation restore interface

### Math Mode
- KaTeX rendering in frontend for `$inline$` and `$$block$$` math
- Backend prompts enforce LaTeX formatting in all question/answer text
- MCQ options validated: all 4 must contain math content
- FRQ validated: must be computation-focused (Solve/Find/Evaluate), not explanation-focused
- Fallback math questions: deterministic algebra problems (ax + b = c) for zero-dependency fallback

### Coding Mode
- Language-selectable: user picks the programming language
- MCQ: syntax, complexity, CS concepts
- FRQ: full coding challenges with input/output spec and examples
- Grading: code evaluated for correctness, logic, edge cases — lenient on minor syntax errors
- Monaco Editor in the frontend for code input

### Dashboard
- Aggregate stats: tests taken, cards reviewed, average score (with reset baseline)
- Activity feed: recent test attempts
- Resetable stats anchored by a localStorage baseline snapshot

---

## Database Entity Relationships

```
User
└── Folder (name, subject, description)
    ├── FolderFile (file_name, file_type, size_bytes, content)
    ├── Test (title, test_type, is_math_mode, is_coding_mode, coding_language)
    │   ├── Note (filename, file_type, content — the raw study material)
    │   ├── Question (question_text, question_type, display_order)
    │   │   ├── MCQOption (option_text, is_correct, display_order)
    │   │   └── FRQAnswer (expected_answer)
    │   └── UserAttempt (attempt_number, correct_count, total_questions, score)
    │       └── UserAnswer (user_answer, is_correct, feedback, confidence, flagged_uncertain)
    ├── Flashcard (front, back, source, difficulty)
    │   └── FlashcardAttempt (correct, time_ms, attempt_number)
    └── KojoConversation (cleared_at, created_at)
        └── KojoMessage (role: 'user'|'assistant', content)
```

---

## Migration History (Alembic)

| Migration | Description |
|-----------|-------------|
| `001_initial_schema` | Users, Folders, Tests, Questions, Attempts, Flashcards |
| `002_kojo_tables` | KojoConversation, KojoMessage — the Kojo chatbot tables |
| `003_math_mode` | `is_math_mode` column on Test |
| `004_coding_mode` | `is_coding_mode`, `coding_language` columns on Test |
| `005_folder_files` | FolderFile table for persistent folder-level documents |

---

## Deployment

```bash
# Development (separate terminals)
cd study-app-backend && uvicorn src.main:app --reload --port 8000
cd study-app-frontend && npm run dev  # port 5173

# Docker (production-like)
docker-compose up --build
# Backend: localhost:8000
# Frontend: localhost:80
```

The backend `entrypoint.sh` runs Alembic migrations then starts uvicorn. The frontend Docker build bakes `VITE_API_BASE_URL` into the static bundle at build time.

---

## Important Constants & Limits

| Constant | Value | Location |
|----------|-------|----------|
| Max upload files per test | 30 | `utils/validators.py` |
| Max file size | 50MB | `config.py` (MAX_FILE_SIZE_BYTES) |
| Allowed file types | pdf, docx, txt, md | `config.py` (ALLOWED_FILE_TYPES) |
| LLM max tokens | 4096 | `config.py` (LLM_MAX_TOKENS) |
| LLM timeout | 300s | `config.py` (LLM_TIMEOUT_SECONDS) |
| FRQ grading uncertainty threshold | 0.6 | `config.py` (LLM_UNCERTAINTY_THRESHOLD) |
| RAG chunk size | 160 words | `llm_service.py` (_RETRIEVAL_CHUNK_WORDS) |
| RAG overlap | 40 words | `llm_service.py` (_RETRIEVAL_CHUNK_OVERLAP_WORDS) |
| RAG top-k | 6 chunks | `llm_service.py` (_RETRIEVAL_TOP_K) |
| Extract char limit | 10,000 | `llm_service.py` (_EXTRACT_CHAR_LIMIT) |
| Generate char limit | 8,000 | `llm_service.py` (_GENERATE_CHAR_LIMIT) |
| Kojo restore window | 5 hours | `kojo_service.py` |
| Guest max folders | 1 | `api.ts` (createFolder) |
| Guest max tests | 1 | `api.ts` (createTest) |
