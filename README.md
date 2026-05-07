# Nosey — AI Study Tool

An AI-powered study platform that generates personalized practice tests, flashcards, and interactive tutoring from your study materials.

## Project Summary

Nosey helps students study smarter by:

- **Generating Practice Tests** — Upload your notes or study materials (PDF, DOCX, TXT, Markdown) and let AI create custom multiple-choice and free-response practice questions tailored to your content.
- **Creating Flashcards** — Automatically generate flashcard sets from your materials with deduplication and difficulty tracking.
- **Interactive Tutoring** — Chat with Kojo, an in-app AI tutor that answers questions about your study materials in a natural conversation.
- **Grading & Feedback** — Receive instant grading on multiple-choice answers and detailed feedback on free-response answers.
- **Multi-Modal Support** — Create math-focused tests with LaTeX rendering, coding challenges with syntax highlighting, or traditional question sets.

Nosey works completely offline after deployment and never stores or shares your study materials.

---

## Getting Started

### Prerequisites

- **Node.js** (v18+) and npm or pnpm
- **Python 3.9+** with pip and virtualenv
- **PostgreSQL 16** (or a managed PostgreSQL service for deployment)
- **Docker** and **docker-compose** (optional, for containerized setup)

### How to Fork

1. Click the **Fork** button on the GitHub repository to create your own copy.
2. Clone your forked repository:
   ```bash
   git clone https://github.com/<your-username>/Nosey--AI-Study-Tool.git
   cd "Nosey--AI Study Tool"
   ```
3. Add the upstream repository so you can sync changes:
   ```bash
   git remote add upstream https://github.com/<original-owner>/Nosey--AI-Study-Tool.git
   ```

### How to Use Locally

#### 1. Set Up the Backend

```bash
# Create and activate Python virtual environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r study-app-backend/requirements.txt

# Set up your database connection and LLM API keys
# Copy the .env.example to .env and fill in your configuration
cp study-app-backend/.env.example study-app-backend/.env

# Apply database migrations
cd study-app-backend
alembic upgrade head
```

#### 2. Start the Backend

```bash
# From study-app-backend/
uvicorn src.main:app --reload --port 8000
```

The backend will be available at `http://localhost:8000`.

#### 3. Set Up the Frontend

```bash
# In a new terminal, from the project root
cd study-app-frontend
npm install

# Copy environment file
cp .env.example .env
```

#### 4. Start the Frontend

```bash
# From study-app-frontend/
npm run dev
```

The frontend will be available at `http://localhost:5173`.

#### 5. (Optional) Run with Docker

```bash
# From the project root
docker-compose up --build
```

Backend will run on `localhost:8000`, frontend on `localhost:80`.

---

## Features

- Multi-provider LLM routing with automatic fallback
- Google OAuth authentication
- Persistent folder-based organization
- Math mode with LaTeX rendering
- Coding mode with multiple language support
- Flashcard deduplication and difficulty tracking
- Conversation history and soft-delete restore for tutor chats
- Weakness detection based on attempt history
- Guest mode for immediate access (limited features)

---

## How to Contribute

We welcome contributions! Here's how to help:

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b bugfix/issue-description
```

### 2. Make Your Changes

- Follow the existing code style and patterns documented in `.claude/CLAUDE.md` (for backend developers).
- Test your changes locally before committing.
- For backend changes, ensure existing tests still pass.

### 3. Commit and Push

```bash
git add .
git commit -m "Brief description of your changes"
git push origin feature/your-feature-name
```

### 4. Open a Pull Request

- Go to the repository and click **New Pull Request**.
- Select your branch and provide a clear description of what you've changed and why.
- Link any related issues if applicable.

### Guidelines

- **Code Quality**: Keep code clean, readable, and well-documented.
- **No Sensitive Data**: Never commit API keys, passwords, or private credentials.
- **Database Changes**: If you modify the schema, create an Alembic migration and test it locally.
- **Testing**: Manual testing is required; document your test steps in the PR.
- **Documentation**: Update relevant docs in `.claude/` and this README if needed.

---

## Project Structure

```
Nosey--AI Study Tool/
├── study-app-backend/       # FastAPI Python backend
│   ├── src/
│   │   ├── main.py          # App entry and router registration
│   │   ├── config.py        # Configuration via environment variables
│   │   ├── models/          # Database ORM models
│   │   ├── routes/          # API routes
│   │   ├── services/        # Business logic
│   │   ├── repositories/    # Data access layer
│   │   └── migrations/      # Database migrations (Alembic)
│   └── requirements.txt
├── study-app-frontend/      # React + TypeScript frontend
│   ├── src/
│   │   ├── pages/           # Route pages
│   │   ├── components/      # UI components
│   │   ├── lib/             # API client and utilities
│   │   └── styles/          # Global CSS
│   └── package.json
├── docker-compose.yml       # Local containerized development
└── .claude/                 # Development documentation and context
```

---

## Key Technologies

| Component | Technology |
|-----------|-----------|
| Frontend | React 18, TypeScript, Vite |
| Backend | FastAPI (Python) |
| Database | PostgreSQL |
| Math Rendering | KaTeX |
| Code Editing | Monaco Editor |
| Authentication | Google OAuth 2.0 + JWT |
| Deployment | Docker, nginx |

---

## Support & Feedback

Have questions or found a bug? Please open an issue on GitHub. For feature requests, discuss in issues or pull requests.