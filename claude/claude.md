# Claude Agent Guide for Study App

This folder contains the project-specific guidance that every AI agent should read before making changes.

## Project in One Sentence
Study App is a self-hosted Quizlet alternative for uploading study notes, generating practice tests and flashcards, and grading answers with AI feedback.

## Source Documents
Read these files first when working in this project:
- [StudyApp_SystemDesign.md](StudyApp_SystemDesign.md)
- [StudyApp_Backend_ImplementationPrompt.md](StudyApp_Backend_ImplementationPrompt.md)
- [StudyApp_Setup_and_Secrets.md](StudyApp_Setup_and_Secrets.md)

## Where to Implement
Use the backend workspace at `../study-app-backend/` for all implementation work.

Primary implementation targets:
- App entry and middleware: `../study-app-backend/src/main.py`
- Settings and environment parsing: `../study-app-backend/src/config.py`
- Database engine/session wiring: `../study-app-backend/src/database.py`
- Dependency injection and auth dependency: `../study-app-backend/src/dependencies.py`
- ORM models: `../study-app-backend/src/models/`
- Repository layer: `../study-app-backend/src/repositories/`
- Service layer: `../study-app-backend/src/services/`
- API routes: `../study-app-backend/src/routes/`
- Utilities (exceptions, logging, validators): `../study-app-backend/src/utils/`
- Tests: `../study-app-backend/tests/`

Schema and migration targets:
- Alembic config and migration scripts: `../study-app-backend/alembic.ini` and `../study-app-backend/src/migrations/`
- Environment template: `../study-app-backend/.env.example`

Implementation rule:
- Do not add backend implementation code under `claude/`; this folder is documentation and agent guidance only.

## Non-Negotiable Rules
- Keep the backend async-first with FastAPI and PostgreSQL.
- Preserve the layered architecture: routes, services, repositories, models.
- Do not introduce a vector database or distributed architecture for the MVP.
- Do not reveal correct answers in the test-taking API before grading.
- Treat secrets as sensitive and never place real credentials in tracked files.
- Keep AI behavior guardrailed: answer only from uploaded notes and flag uncertainty.

## Core Stack
- Frontend: React + TypeScript
- Backend: FastAPI in Python
- Database: PostgreSQL
- Deployment: Render for backend, Netlify for frontend
- Auth: Google OAuth 2.0
- AI: Ollama locally, Groq as optional hosted fallback

## Data and Domain Model
- Users own folders.
- Folders contain tests and flashcards.
- Tests contain questions, MCQ options, FRQ answers, notes, attempts, and answers.
- Flashcards track spaced repetition history through flashcard attempts.
- The canonical schema is the 11-table design described in the system design document.

## Working Rules for Agents
- Start by reading the three source documents in this folder.
- Prefer the smallest correct change over a broad refactor.
- If a request touches auth, migrations, grading, or data modeling, inspect the nearby implementation before editing.
- Keep responses and code honest about uncertainty and unsupported answers.
- If you discover a durable project rule that future agents should follow, update this file and the memory file together.

## Quick Sanity Checks
- No secret values are committed.
- No correct answers leak in pre-grading responses.
- New schema changes still match the documented relationships and constraints.
- New backend code uses await for database and I/O operations.

## If You Are Unsure
- Read the nearest design section first.
- Follow the existing project patterns instead of inventing new ones.
- Choose the safest implementation that matches the docs.
