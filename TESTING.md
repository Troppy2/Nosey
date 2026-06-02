# Running Tests Locally

Run these two checks before committing or opening a PR. They mirror exactly what CI runs.

---

## 1. Backend — pytest

CI command: `pytest --tb=short -q`

```bash
cd study-app-backend
pip install -r requirements.txt
```

pytest needs env vars to start the app. Copy the block below into your shell (fake values are fine for most tests):

```bash
export DATABASE_URL="postgresql+psycopg://user:password@localhost:5432/study_app"
export JWT_SECRET="ci-test-secret-key-minimum-32-chars-long"
export GOOGLE_CLIENT_ID="ci-test-client-id"
export GOOGLE_CLIENT_SECRET="ci-test-client-secret"
export ENVIRONMENT="test"
```

Then run:

```bash
pytest --tb=short -q
```

**Windows (PowerShell):**

```powershell
$env:DATABASE_URL    = "postgresql+psycopg://user:password@localhost:5432/study_app"
$env:JWT_SECRET      = "ci-test-secret-key-minimum-32-chars-long"
$env:GOOGLE_CLIENT_ID      = "ci-test-client-id"
$env:GOOGLE_CLIENT_SECRET  = "ci-test-client-secret"
$env:ENVIRONMENT     = "test"

pytest --tb=short -q
```

Tests live in `study-app-backend/tests/`. pytest is configured by `pytest.ini` with `asyncio_mode = auto`, so async tests run without extra flags.

**If a test needs a real DB:** tests that hit actual database queries will fail unless PostgreSQL is running and the `DATABASE_URL` points to it. Tests that use the in-process `AsyncClient(app=app)` pattern (like `test_health.py`) do not need a running DB.

---

## 2. Frontend — TypeScript type check

CI command: `npx tsc -p tsconfig.app.json`

There is no Jest or Vitest suite. The only frontend CI check is the TypeScript compiler.

```bash
cd study-app-frontend
npm ci
npx tsc -p tsconfig.app.json
```

This exits 0 on success and prints all type errors on failure. Fix every reported error before pushing -- CI will fail on any type error, including in files you did not touch if a change you made broke a downstream type.

A passing build (`npm run build`) also catches type errors since it runs `tsc -b` internally:

```bash
npm run build
```

---

## Quick checklist before pushing

- [ ] `cd study-app-backend && pytest --tb=short -q` passes (or failures are pre-existing and unrelated to your change)
- [ ] `cd study-app-frontend && npx tsc -p tsconfig.app.json` exits with no errors
