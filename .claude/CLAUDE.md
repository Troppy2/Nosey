# CLAUDE.md — Working Instructions for This Codebase

Read `.claude/projectsummary.md`, `.claude/model-routing.md`, and `.claude/memory.md` for deep context. This file covers how to work in this codebase day-to-day.

Before making LLM service changes, read `.claude/feature-fails.md` to avoid repeating known breakages.

---

## Project Layout

```
Nosey--AI Study Tool/
├── study-app-backend/         # FastAPI Python backend
│   ├── src/
│   │   ├── main.py            # App entry, router registration, CORS
│   │   ├── config.py          # All settings via Pydantic BaseSettings
│   │   ├── database.py        # SQLAlchemy async session
│   │   ├── dependencies.py    # get_current_user FastAPI dependency
│   │   ├── models/            # SQLAlchemy ORM models
│   │   ├── schemas/           # Pydantic request/response schemas
│   │   ├── routes/            # FastAPI routers (one file per domain)
│   │   ├── services/          # Business logic (LLM, test, flashcard, etc.)
│   │   ├── repositories/      # DB access layer (one per model)
│   │   ├── migrations/        # Alembic migration versions
│   │   └── utils/             # logger, exceptions, validators
│   ├── .env                   # Local environment (real keys stored separately)
│   ├── requirements.txt
│   └── Dockerfile
│
├── study-app-frontend/        # React + TypeScript frontend
│   ├── src/
│   │   ├── pages/             # One component per route
│   │   ├── components/        # Reusable UI components
│   │   ├── lib/
│   │   │   ├── api.ts         # All backend API calls
│   │   │   └── types.ts       # TypeScript interfaces
│   │   ├── styles/styles.css  # Global CSS (no CSS modules — one file)
│   │   └── main.tsx           # Entry point
│   ├── .env                   # VITE_API_BASE_URL, VITE_GOOGLE_CLIENT_ID
│   └── Dockerfile
│
├── docker-compose.yml
└── .claude/                   # This folder
```

---

## Backend Conventions

### Adding a Route
1. Create or add to the appropriate file in `src/routes/`
2. Use FastAPI dependency injection: `session: AsyncSession = Depends(get_session)`, `user: User = Depends(get_current_user)`
3. Exception mapping in route handler:
   - `ResourceNotFoundException` → HTTP 404
   - `LLMException` → HTTP 503
   - `StudyAppException` / `ValidationException` → HTTP 400
4. Register router in `src/main.py` if new file

### Service Layer
- Services are instantiated per-request (no shared state): `TestService()`, `LLMService()`, etc.
- Services take `session: AsyncSession` as a parameter, not at construction time (except LLMService which takes no session)
- LLMService is the only service that talks to external APIs

### Model Changes
- Always create an Alembic migration for any column/table change
- Run: `alembic revision --autogenerate -m "description_of_change"`
- Review the generated file before applying
- Apply: `alembic upgrade head`

### Error Types
```python
from src.utils.exceptions import (
    LLMException,           # AI provider failed → 503
    ResourceNotFoundException,  # Entity not found → 404
    ValidationException,    # Bad input data → 400
    StudyAppException,      # Generic app error → 400
)
```

### Configuration
All config in `src/config.py` via Pydantic `BaseSettings`. Add new env vars there with `Field(alias="ENV_VAR_NAME")`. Access everywhere via `from src.config import settings`.

---

## Frontend Conventions

### Adding a Page
1. Create `src/pages/MyPage.tsx`
2. Add route in `src/app/App.tsx` (or wherever the router is configured)
3. Add nav link in `AppShell.tsx` if it needs top-level navigation

### Styles
- All CSS is in `src/styles/styles.css` — one global file, no CSS modules, no Tailwind
- Use existing CSS variables: `var(--green-dark)`, `var(--ink)`, `var(--green-lightest)`, etc.
- Existing utility classes: `.page`, `.page-narrow`, `.page-header`, `.toolbar`, `.muted`, `.small`, `.eyebrow`, `.pill`, `.card`, `.button-row`, `.row-actions`
- Add new styles at the end of the file, grouped by component

### API Calls
- All backend calls go through `src/lib/api.ts` — add new functions there
- The `request<T>()` wrapper handles auth headers, JSON parsing, and 401 redirect automatically
- For file uploads, pass `FormData` as body (the wrapper detects it and skips Content-Type)
- Error messages come from `response.json().detail` (FastAPI format)

### Types
- All shared types live in `src/lib/types.ts`
- Add new response types there when you add new API endpoints

### State Management
- No Redux, no Zustand — React `useState` + `useEffect` only
- User preferences in localStorage (provider choice, fallback toggle, stats baseline)
- Don't introduce a global state library without discussion

---

## LLM Work

When touching `llm_service.py`:

1. **Never put study extraction inside the provider loop.** Extraction (`_extract_study_content`) must run once before `_generate_test_attempts`'s provider loop. Per-provider extraction wastes rate-limited API quota.

2. **Never re-raise LLMException inside the provider loop.** The loop uses `except Exception as exc` to catch all failures and continue to the next provider. If you add `except LLMException: raise`, a rate-limit error on one provider will skip all remaining providers.

3. **Keep the two Groq models separate.** `_complete_groq()` uses `llama-3.3-70b-versatile` (complex JSON). `_complete_text_groq()` uses `llama-3.1-8b-instant` (Kojo chat). Don't merge them.

4. **Token budget matters.** `LLM_MAX_TOKENS=4096` is the minimum for reliable test generation. Generating 10 MCQ + 5 FRQ as JSON needs ~2000-3000 tokens. Never lower this below 3000 for generation. Kojo chat is separately fine at lower budgets since it's plain text.

5. **New providers need to be added in 10 places.** See `model-routing.md` for the full checklist.

---

## Testing Approach

There is no automated test suite currently. Testing is manual via the running app. When verifying backend changes:
- Check logs for LLM call patterns (provider used, token counts implied by response completeness)
- Verify FRQ count is non-zero when requesting mixed or FRQ_only tests
- Verify provider fallback works by temporarily making one provider fail

---

## Running Locally

```bash
# Backend
cd study-app-backend
pip install -r requirements.txt
alembic upgrade head
uvicorn src.main:app --reload --port 8000

# Frontend
cd study-app-frontend
npm install
npm run dev   # runs on http://localhost:5173

# Docker
docker-compose up --build
```

Frontend talks to backend at `VITE_API_BASE_URL` (default `http://localhost:8000`). Set this in `study-app-frontend/.env`.

---

## Key Files to Read First for Any Task

| Task | Read First |
|------|-----------|
| Adding LLM feature | `llm_service.py` (all of it) |
| Adding a test parameter | `routes/tests.py`, `test_service.py`, `llm_service.generate_test_questions()` |
| Adding a flashcard feature | `routes/flashcards.py`, `flashcard_service.py` |
| Changing Kojo behavior | `kojo_service.py`, `routes/kojo.py`, `KojoChat.tsx` |
| Changing auth | `auth_service.py`, `routes/auth.py`, `dependencies.py` |
| Adding a frontend page | `App.tsx`, `AppShell.tsx`, `api.ts`, `types.ts` |
| Changing DB schema | `models/*.py`, then run `alembic revision --autogenerate` |
| Changing styles | `styles/styles.css` — search for relevant class name first |

---

## Sensitive Files

- `study-app-backend/.env` — contains fake keys for development. Real keys are stored outside this repo in a separate env file.
- Never commit real API keys.
- `JWT_SECRET` in `.env` is used to sign auth tokens — changing it invalidates all existing sessions.
