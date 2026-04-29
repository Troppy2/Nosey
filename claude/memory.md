# Study App Project Memory

## What This Project Is
- Self-hosted alternative to Quizlet for study notes, practice tests, and flashcards.
- Built around uploaded PDF/TXT notes, AI-generated questions, AI feedback, and spaced repetition.

## Canonical Stack
- Frontend: React + TypeScript
- Backend: FastAPI
- Database: PostgreSQL on Neon
- Backend deployment: Render
- Frontend deployment: Netlify
- Auth: Google OAuth 2.0
- AI: Ollama locally, Groq optionally

## Important Constraints
- Keep the backend async.
- Keep the architecture layered: routes, services, repositories, models.
- Avoid vector DB complexity for the MVP.
- Do not leak correct answers before grading.
- Do not store real secrets in tracked files.
- LLM output must stay grounded in uploaded notes and clearly flag uncertainty.

## Data Model Reminder
- Users own folders.
- Folders contain tests and flashcards.
- Tests contain questions, MCQ options, FRQ answers, notes, attempts, and answers.
- Flashcards track review history through flashcard attempts.

## AI Working Notes
- Read the three source docs in `claude/` before changing behavior.
- Prefer targeted edits over broad rewrites.
- If a rule changes, update this file and `claude.md` so future agents can find it quickly.
