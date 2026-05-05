# Feature Fails — Known Breakages and Root Causes

A running log of features that broke, why they broke, and what was reverted or fixed. Use this before making sweeping changes to the LLM service.

---

## 2026-05-01 — Token Limit Increase Broke Kojo Chat

### What was changed
- `LLM_MAX_TOKENS` raised from `1000` → `8192` in `.env` and `config.py`
- Added `_GROQ_MAX_TOKENS = 32_768`, `_GEMINI_MAX_TOKENS = 8_192`, `_ANTHROPIC_MAX_TOKENS = 8_192` constants
- All provider text and JSON completion methods updated to use `min(settings.llm_max_tokens, _PROVIDER_MAX_TOKENS)`
- `_complete_groq` (JSON path) upgraded from `llama-3.1-8b-instant` → `llama-3.3-70b-versatile`

### What broke
Kojo chat (POST `/kojo/folders/:id/chat`) failed after these changes. The whole chat feature stopped working.

### What was reverted
- Removed the three `_*_MAX_TOKENS` constants entirely
- Reverted all `min(settings.llm_max_tokens, ...)` calls back to plain `settings.llm_max_tokens`
- Reverted `_complete_groq` back to `llama-3.1-8b-instant`
- Reverted `LLM_MAX_TOKENS` to `1000` in both `.env` and `config.py`

### What was kept (not reverted)
- The `except LLMException: raise` fix in `call_kojo` and `_generate_test_attempts` — these were separate bug fixes, not part of the token limit change
- Ollama model corrected to `gemma4:31b` (was `gemma4:31b-cloud` which doesn't exist in the API catalog)

### Lesson
Do not raise `LLM_MAX_TOKENS` globally — it affects both JSON generation (needs high tokens) and Kojo chat (works fine at low tokens). If you need more tokens for generation, use a separate constant scoped to the JSON completion methods only, not the text/chat methods.

### Fix applied (2026-05-01)
Added `_JSON_MAX_TOKENS = 8192` constant in `llm_service.py` (module level). Applied it only to `_complete_gemini`, `_complete_ollama`, `_complete_groq`, and `_complete_anthropic` (the JSON path methods). Text/Kojo methods (`_complete_text_*`) continue to use `settings.llm_max_tokens` (1000). Also restored `_complete_groq` model to `llama-3.3-70b-versatile` per CLAUDE.md.

---

## 2026-05-03 — Extreme Mode Generation Crashed on Missing `test_type`

### What happened
Submitting an Extreme practice test hit a backend `NameError` in `src/services/llm_service.py`. `_generate_test_attempts()` used `test_type` when building the generation prompt, but the helper signature did not accept that argument.

### Fix
- Added `test_type` to `_generate_test_attempts()`.
- Threaded `test_type` through every caller, including the practice-test-template path.

### Lesson
Mode-specific generation needs the selected mode all the way through the helper stack. Frontend controls can exist and still fail if the backend drops the mode before prompt assembly.

---

## 2026-05-01 — `gemma4:31b-cloud` Model Name Does Not Exist

### What happened
`.env` had `OLLAMA_MODEL=gemma4:31b-cloud`. The Ollama cloud API returned `403 Forbidden` for every request because the model name is wrong — the actual model in the catalog is `gemma4:31b` (no `-cloud` suffix).

### Fix
Changed `OLLAMA_MODEL=gemma4:31b-cloud` → `OLLAMA_MODEL=gemma4:31b`.

### How to check available models
```bash
curl -s -H "Authorization: Bearer <OLLAMA_API_KEY>" https://api.ollama.com/api/tags | python3 -m json.tool | grep '"name"'
```
Always verify the exact model name against the API catalog before setting `OLLAMA_MODEL`.

---

## 2026-05-03 — Stale Neon Connection Broke Auth Lookup

### What happened
`POST /folders/:id/tests` failed in `get_current_user` with `psycopg.OperationalError: server closed the connection unexpectedly` while selecting from `users`.

### Fix
- Enabled `pool_pre_ping=True` and `pool_recycle=1800` in `src/database.py` so dead pooled connections are detected and replaced before request handling.

### Lesson
Managed PostgreSQL / pooler setups can drop idle sessions underneath SQLAlchemy. Pre-ping is cheap insurance for auth-dependent request paths.
