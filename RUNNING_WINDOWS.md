# Running the Project Locally

This file describes how to start Ollama, the backend, and the frontend on Windows using PowerShell.

## Prerequisites
- Install Ollama from https://ollama.com.
- Python 3.11, with a project virtualenv at `.venv` created from the project root.
- Node.js and npm, or pnpm, for the frontend.
- PowerShell 7 or Windows PowerShell 5.1.

---

## 1) Start Ollama

Open PowerShell and run:

```powershell
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

```powershell
ollama pull llama3.1:8b
ollama run llama3.1:8b
```

By default the backend expects Ollama at `http://localhost:11434`, but when `OLLAMA_API_KEY` is present the backend will prefer `https://api.ollama.com` and treat the configured model (e.g. `gemma`) as a cloud model.

---

## 2) Start the Backend

From the project root, either activate the venv then change to the backend folder, or change first then activate relative to the workspace root.

Option A - activate from workspace root:

```powershell
.\.venv\Scripts\Activate.ps1
Set-Location study-app-backend
```

Option B - from inside the backend folder:

```powershell
Set-Location study-app-backend
..\.venv\Scripts\Activate.ps1
```

Then (first time) install dependencies and apply migrations.

Check and install Python dependencies (recommended):

From the project root, create the virtualenv if it doesn't exist:

```powershell
py -3.11 -m venv .venv
```

- Activate the virtualenv:

```powershell
.\.venv\Scripts\Activate.ps1
# or, from inside study-app-backend:
# Set-Location study-app-backend; ..\.venv\Scripts\Activate.ps1
```

- Upgrade pip and install the backend requirements:

```powershell
..\.venv\Scripts\python.exe -m pip install --upgrade pip
..\.venv\Scripts\python.exe -m pip install -r requirements.txt
# or, after changing into study-app-backend:
# ..\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

- Verify installed packages have no conflicts:

```powershell
..\.venv\Scripts\python.exe -m pip check
```

- If you see issues, recreate the venv and reinstall:

```powershell
Remove-Item -Recurse -Force .venv
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
..\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

After dependencies are installed, apply migrations:

```powershell
Set-Location study-app-backend
alembic upgrade head
```

Start the server (use 8001 if 8000 is already in use):

```powershell
# from inside study-app-backend
Set-Location study-app-backend
..\.venv\Scripts\Activate.ps1
pip install -r requirements.txt

..\.venv\Scripts\python.exe -m uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

API base: `http://localhost:8000` (docs at `/docs`).

If port 8000 is preferred but in use, free it first:

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen
Stop-Process -Id <PID>
```

Edit env vars in [study-app-backend/.env](study-app-backend/.env) if needed.

---

## 3) Start the Frontend

There are two frontend folders in this repo; run whichever you want to use.

Study app frontend (Vite):

```powershell
Set-Location study-app-frontend
npm install
npm run dev
```

Nosey UI demo (pnpm workspace):

```powershell
Set-Location Nosey_UI_Frontend_Demo
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

```powershell
Set-Location study-app-backend

$env:LOCUST_TOKEN = "<paste-jwt-here>"
.\.venv\Scripts\locust.exe -f tests\locust_load_testing.py --host http://localhost:8000
```

Then open **http://localhost:8089** in your browser, set the number of users and spawn rate, and click **Start**.

### Run headless (no UI)

Useful for CI or quick one-off checks:

```powershell
Set-Location study-app-backend

$env:LOCUST_TOKEN = "<paste-jwt-here>"
$env:LOCUST_FOLDER = "3"
.\.venv\Scripts\locust.exe -f tests\locust_load_testing.py --host http://localhost:8000 --headless -u 20 -r 5 --run-time 60s
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
- If the backend fails at import time with syntax errors, ensure your Python version is 3.13 and the virtualenv is active.
- If Ollama calls timeout, confirm `ollama serve` is running and the pulled model exists.
- If migrations fail, verify `DATABASE_URL` in [study-app-backend/.env](study-app-backend/.env) points to a running Postgres and then run `alembic upgrade head`.
- If PowerShell blocks venv activation, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in the current shell and try again.
- If `python` is not found, use the venv interpreter directly: `..\.venv\Scripts\python.exe -m uvicorn src.main:app --reload --host 0.0.0.0 --port 8000`.
- If port 8000 is in use, use `Get-NetTCPConnection -LocalPort 8000 -State Listen` to find the process ID, then stop it with `Stop-Process -Id <PID>`.

---

That’s it: start Ollama first, pull or run the model, then start the backend and frontend.
