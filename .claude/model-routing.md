# Model Routing — LLM Provider Architecture

## Overview

All LLM calls go through `study-app-backend/src/services/llm_service.py`. The service uses raw `httpx` async HTTP calls for every provider — **no provider SDK packages are used** (even though groq/anthropic/google-generativeai are in requirements.txt, the live code uses httpx directly). This is intentional: unified timeout/retry handling, no import overhead.

Auto compact context when you have reached 75%
---

## Provider Registry

| Provider Key | Model (JSON gen) | Model (Text/Chat) | Max Output Tokens | API Endpoint |
|-------------|-----------------|-------------------|-------------------|-------------|
| `groq` | `llama-3.3-70b-versatile` | `llama-3.1-8b-instant` | **32,768** (`_GROQ_MAX_TOKENS`) | `https://api.groq.com/openai/v1/chat/completions` |
| `gemini` | `gemini-2.0-flash` | `gemini-2.0-flash` | **8,192** (`_GEMINI_MAX_TOKENS`) | `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent` |
| `claude` | `claude-haiku-4-5-20251001` | `claude-haiku-4-5-20251001` | **8,192** (`_ANTHROPIC_MAX_TOKENS`) | `https://api.anthropic.com/v1/messages` |
| `ollama` | `gemma4:31b` | `gemma4:31b` | `settings.llm_max_tokens` (default 8192) | `OLLAMA_BASE_URL/api/generate` (cloud: api.ollama.com) |

**Important model split for Groq**: `_complete_groq()` (structured JSON) uses `llama-3.3-70b-versatile`. `_complete_text_groq()` (Kojo chat plain text) uses `llama-3.1-8b-instant`. The 8b model is fast enough for chat; the 70b model is needed for reliably generating complex nested JSON with 10+ question objects.

---

## Provider Selection Flow

```
User selects provider in UI  →  stored in localStorage
  ├─ "auto"  → _candidate_providers("auto") → ordered list of available providers
  └─ specific  → [that provider] only, no fallback

_candidate_providers("auto") order:
  1. groq   (if GROQ_API_KEY set)
  2. gemini  (if GOOGLE_AI_API_KEY set)
  3. claude  (if ANTHROPIC_API_KEY set)
  4. ollama  (if check_providers_status() reports it available)
```

`_normalize_generation_provider()` handles aliases: `"google"` → `"gemini"`, `"anthropic"` → `"claude"`.

---

## Two Call Paths

Every LLM operation goes through one of two internal methods:

### `_complete_json(prompt, provider)` → `dict`
Used for: test generation, flashcard generation, study content extraction, practice test parsing.

```python
# With specific provider: routes directly to _complete_json_for_provider()
# With auto: iterates _candidate_providers(), tries each until one succeeds
```

### `_complete_text_*(prompt)` → `str`
Used for: Kojo chat responses. One method per provider: `_complete_text_groq`, `_complete_text_gemini`, `_complete_text_anthropic`, `_complete_text_ollama`.

---

## Retry Logic

`_with_retry(fn, label)` wraps any provider call that may 429:
- Attempt 1: immediate
- 429 on attempt 1 → wait 1s → attempt 2
- 429 on attempt 2 → wait 2s → attempt 3
- 429 on attempt 3 → raises `LLMException` with human-readable message

Only `_complete_gemini`, `_complete_groq`, `_complete_anthropic` use `_with_retry`. Ollama calls do not (connect errors / 404s are handled directly, not retried).

---

## Test Generation Provider Loop (`_generate_test_attempts`)

```
1. Extract study content ONCE (auto-provider, before loop)
   └─ _extract_study_content() → _StudyContent(title, terms, concepts)
   └─ _build_generation_prompt() → full prompt string

2. For each provider in provider_candidates:
   ├─ _complete_json(shared_prompt, provider=candidate) → data dict
   ├─ _parse_generated_test(data, ...) → (mcq_list, frq_list)
   ├─ If len(mcq) >= count_mcq AND len(frq) >= count_frq → RETURN (success)
   ├─ Else: store as best_mcq/best_frq if better than previous
   └─ Any exception → log warning, continue to next provider

3. After loop:
   ├─ If best_mcq or best_frq exist:
   │   ├─ enable_fallback=True → return partial results (outer caller fills remainder)
   │   └─ enable_fallback=False → raise LLMException
   └─ If nothing at all → raise LLMException("Practice test could not be generated...")
```

**Critical design note**: Study content extraction was moved out of the loop in a recent fix. Previously, each provider iteration called `_extract_study_content(provider=candidate)`, meaning if Gemini was rate-limited, it burned 3 retries on extraction AND 3 more on generation (6 wasted calls). Now extraction uses auto-provider selection once.

**Critical design note**: `except LLMException: raise` was removed from the loop in the same fix. Previously, a rate-limit `LLMException` from Gemini exited the entire loop (skipping Ollama). Now all exceptions are caught uniformly with `except Exception`, and the loop always continues to the next provider.

---

## Fallback Questions (when all providers fail)

When `enable_fallback=True` and generation fails entirely:

### Normal Mode: `_fallback_questions(notes, count_mcq, count_frq)`
Generic comprehension questions using sentences extracted from the notes. Low quality — the point is to not block the user entirely. MCQ: "Which statement is supported by the notes?" FRQ: "Explain this idea from the notes: [sentence]"

### Math Mode: `_fallback_math_questions(notes, count_mcq, count_frq)`
Deterministic algebra problems: `ax + b = c` style (no LLM needed). Quality is reasonable — actual math problems, not generic text. Uses `Fraction` for exact arithmetic.

### Flashcard Fallback: `_fallback_flashcards(content, count, prompt)`
Generic sentence-based cards. Very low quality.

When `enable_fallback=False`, `LLMException` is raised instead, and the route handler converts it to HTTP 503.

---

## Ollama — Local vs. Cloud

Ollama supports both local and cloud operation, detected by environment:

```python
# Cloud (OLLAMA_API_KEY is set):
#   - Check: skips local /api/tags ping, marks as available if key present
#   - Auth: Authorization: Bearer <OLLAMA_API_KEY> header
#   - Base URL: https://api.ollama.com (set in OLLAMA_BASE_URL)
#   - Model: gemma4:31b-cloud (set in OLLAMA_MODEL)

# Local (no OLLAMA_API_KEY):
#   - Check: GET OLLAMA_BASE_URL/api/tags, verifies model exists in response
#   - Auth: no auth header
#   - Base URL: http://localhost:11434
#   - Model: mistral:7b-instruct-q3_K_M (default)
```

The cloud Ollama model (`gemma4:31b-cloud`) has known issues with JSON truncation at `num_predict=LLM_MAX_TOKENS`. Set `LLM_MAX_TOKENS=4096` or higher to avoid mid-JSON cuts.

---

## Provider Status Check

`GET /kojo/providers/status` → `check_providers_status()`

```python
{
  "gemini": bool(GOOGLE_AI_API_KEY),     # key present = available
  "groq": bool(GROQ_API_KEY),            # key present = available
  "claude": bool(ANTHROPIC_API_KEY),     # key present = available
  "ollama": bool,                         # live ping OR api key present
  "ollama_model": str,                   # current model name
  "ollama_model_available": bool,         # model loaded in ollama
}
```

Frontend (`FlashcardsManage`, `CreateTest`, `Settings`) uses this to disable unavailable options in provider dropdowns and auto-fallback the user to "auto" if their saved preference is no longer available.

---

## localStorage Provider Keys

| Key | Used By | Values |
|-----|---------|--------|
| `nosey_generation_provider` | CreateTest, FlashcardsManage | `auto`, `groq`, `gemini`, `claude`, `ollama` |
| `kojo_llm_provider` | KojoChat | `auto`, `groq`, `gemini`, `claude`, `ollama` |
| `nosey_question_fallback` | CreateTest, FlashcardsManage | `"true"` (default), `"false"` |

---

## Adding a New Provider

1. Add API key field to `config.py` (Pydantic `Field` with `alias="MY_KEY"`)
2. Add to `.env` and `.env.example`
3. Add `_complete_json_for_provider()` branch: `if provider == "myprovider": return await self._complete_myprovider(prompt)`
4. Implement `_complete_myprovider(prompt)` → `dict` (uses `_loads_json` for response parsing)
5. Implement `_complete_text_myprovider(prompt)` → `str` for Kojo chat
6. Add to `_candidate_providers()` auto-list if key is present
7. Add to `check_providers_status()` return dict
8. Add to `GENERATION_PROVIDER_OPTIONS` in `FlashcardsManage.tsx` and `CreateTest.tsx`
9. Add provider status check in frontend dropdown disable logic
10. Add to `_TEXT_DISPATCH` dict in `call_kojo()`
