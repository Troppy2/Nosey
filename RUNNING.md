# Running the Project Locally

This file describes how to start Ollama, the backend, and the frontend on macOS.

## Prerequisites
- Install Ollama (https://ollama.com).
- Python 3.9, project virtualenv at `.venv` (created from project root).
- Node.js and npm (or pnpm) for the frontend.

---

## 1) Start Ollama

Open a terminal and run:

```bash
ollama serve    # for local Ollama server
```

If you're using Ollama Cloud (recommended for hosted models such as "Gemma"), set these environment variables in `study-app-backend/.env`:

```env
# Use Ollama Cloud API
OLLAMA_API_KEY=your_ollama_cloud_api_key
OLLAMA_BASE_URL=https://api.ollama.com
OLLAMA_MODEL=gemma
```

If you prefer a local Ollama instance, pull or run the model locally (only needed once per machine/model):

```bash
ollama pull llama3.1:8b
ollama run llama3.1:8b
```

By default the backend expects Ollama at `http://localhost:11434`, but when `OLLAMA_API_KEY` is present the backend will prefer `https://api.ollama.com` and treat the configured model (e.g. `gemma`) as a cloud model.

---

## 2) Start the Backend

From the project root, either activate the venv then change to the backend folder, or change first then activate relative to the workspace root.

Option A — activate from workspace root:

```bash
source .venv/bin/activate
cd study-app-backend
```

Option B — from inside the backend folder:

```bash
cd study-app-backend
source ../.venv/bin/activate
```

Then (first time) install dependencies and apply migrations.

Check and install Python dependencies (recommended):

- From the project root, create the virtualenv if it doesn't exist:

```bash
python3 -m venv .venv
```

- Activate the virtualenv (use `python3` if `python` is not available):

```bash
source .venv/bin/activate
# or, from inside study-app-backend:
# cd study-app-backend && source ../.venv/bin/activate
```

- Upgrade pip and install the backend requirements:

```bash
python -m pip install --upgrade pip
pip install -r study-app-backend/requirements.txt
or pip install -r requirements.txt
```

- Verify installed packages have no conflicts:

```bash
python -m pip check
```

- If you see issues, recreate the venv and reinstall:

```bash
rm -rf .venv
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

After dependencies are installed, apply migrations:

```bash
cd study-app-backend
alembic upgrade head
```

Start the server (use 8001 if 8000 is already in use). Run this from the project root so Uvicorn can find the backend package:

```bash
source .venv/bin/activate
- uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
uvicorn --app-dir study-app-backend src.main:app --reload --host 0.0.0.0 --port 8000
```

API base: `http://localhost:8000` (docs at `/docs`).

If port 8000 is preferred but in use, free it first:

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
kill <PID>
```

Edit env vars in [study-app-backend/.env](study-app-backend/.env) if needed.

---

## 3) Start the Frontend

There are two frontend folders in this repo; run whichever you want to use.

Study app frontend (Vite):

```bash
cd study-app-frontend
npm install
npm run dev
```

Nosey UI demo (pnpm workspace):

```bash
cd Nosey_UI_Frontend_Demo
pnpm install
pnpm run dev
```

Default Vite port is usually `5173` — check the CLI output.

---

## 4) Load Testing with Locust

Locust is already installed in the venv (`locust>=2.29` in `requirements.txt`).

### Get a token

Log into the app in your browser, open **DevTools → Application → Local Storage**, find the JWT value, and copy it (no angle brackets).

### Start the backend first

Make sure `uvicorn` is running on port 8000 before running Locust (see step 2).

### Run Locust (web UI)

```bash
cd study-app-backend

LOCUST_TOKEN="<paste-jwt-here>" \
  .venv/bin/locust -f tests/locust_load_testing.py --host http://localhost:8000
```

Then open **http://localhost:8089** in your browser, set the number of users and spawn rate, and click **Start**.

### Run headless (no UI)

Useful for CI or quick one-off checks:

```bash
cd study-app-backend

LOCUST_TOKEN="<paste-jwt-here>" \
LOCUST_FOLDER="3" \
  .venv/bin/locust -f tests/locust_load_testing.py --host http://localhost:8000 \
  --headless -u 20 -r 5 --run-time 60s
```

`LOCUST_FOLDER` is an optional existing folder ID to avoid creating new folders on every run.

### User types

| Class | Weight | What it does |
|---|---|---|
| `BrowsingUser` | 10 | Reads folders, tests, flashcards — simulates most traffic |
| `ActiveUser` | 5 | Reads + saves draft attempts + records flashcard attempts |
| `LLMUser` | 1 | Kojo chat — very low weight, use carefully (hits real API) |

> **Note:** Test generation and flashcard generation from files are intentionally excluded from automatic tasks to avoid burning API credits at scale.

---

## Troubleshooting
- If the backend fails at import time with syntax errors, ensure your Python version is 3.9 and the virtualenv is active.
- If Ollama calls timeout, confirm `ollama serve` is running and the pulled model exists.
- If migrations fail, verify `DATABASE_URL` in [study-app-backend/.env](study-app-backend/.env) points to a running Postgres and then run `alembic upgrade head`.

---

That’s it — start Ollama first, pull/run the model, then start backend and frontend.
