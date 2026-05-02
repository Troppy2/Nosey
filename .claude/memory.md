# Memory — Key Decisions, Patterns, and Non-Obvious Facts

This file captures architectural decisions, non-obvious invariants, and things that would otherwise require re-reading multiple files to understand. Read this before making significant changes.

---

## Architecture Decisions

### No LLM SDK packages — httpx everywhere
Even though `anthropic`, `groq`, and `google-generativeai` are in `requirements.txt`, none of their Python client objects are used in `llm_service.py`. All LLM calls go through raw `httpx.AsyncClient`. This was a deliberate choice: unified timeout control (`LLM_TIMEOUT_SECONDS`), a single retry wrapper (`_with_retry`), and consistent error handling. Don't refactor to use SDK clients — it would break the unified architecture.

### Guest mode is client-side enforced
Guest mode limits (1 folder, 1 test) are checked in `api.ts` before the API call, not on the server. The server doesn't distinguish guests — it treats them as real users with token `"nosey_guest_token"`. If you add server-side limits, you'd need to identify guest sessions server-side via the token value.

### localStorage for user preferences
User settings (provider choice, question fallback toggle, stats baseline) are stored in localStorage, not the database. This is intentional — no auth complexity, no server round-trip, instant persistence. Consistent with how the codebase was started. Don't add a user preferences table without discussing it first.

### Stats baseline snapshot pattern
Dashboard stats (tests taken, cards reviewed, average score) aren't separately tracked — they're computed from all data. "Reset stats" creates a baseline snapshot in localStorage (`nosey_stats_reset_baseline`) and the dashboard subtracts it. This means stats are always derivable from data, and reset doesn't destroy history.

### Kojo soft-delete restore pattern
When a Kojo conversation is "cleared," it's not deleted — `cleared_at` is set. The conversation is restorable for 5 hours. After 5 hours, the restore endpoint returns `restored: false`. The frontend Settings page shows restorable conversations with a countdown timer.

### Test is created in DB before LLM generation
`TestService.create_test()` creates the Test row in the database first, then calls the LLM. If LLM generation fails and raises (fallback disabled), the test exists in the DB with 0 questions. This is acceptable — the route handler propagates the exception as 503, and the empty test is visible to the user. Don't add complex rollback logic — keep it simple.

### Two-pass question generation (normal mode)
Normal (non-math, non-coding) test generation uses two LLM calls:
1. `_extract_study_content()` — extracts structured terms/concepts from notes
2. `_build_generation_prompt()` + `_complete_json()` — generates questions from the structured content

The extraction pass catches most file metadata noise before generation. If extraction fails, it falls back to raw sentences from the notes.

### Extraction happens once, not per-provider
Study content extraction (`_extract_study_content`) runs once with auto-provider selection before the provider retry loop in `_generate_test_attempts`. Previously it ran per-provider, which burned rate-limited quota (e.g., 3 Gemini retries for extraction + 3 more for generation = 6 wasted calls when rate-limited). Don't revert this.

### LLMException must NOT break the provider retry loop
The `except LLMException: raise` inside `_generate_test_attempts` was removed. All exceptions — including `LLMException` (e.g., rate limits) — are now caught uniformly by `except Exception`, and the loop continues to the next provider. Reverting this would cause rate-limit errors on one provider to skip all remaining providers.

---

## Non-Obvious Invariants

### LLM_MAX_TOKENS must be ≥ 4096 for test generation
At 1000 tokens (the old default), generating 10 MCQ + 5 FRQ as JSON caused truncation. MCQ fills the first ~2000 tokens of the response; FRQ never starts. The JSON also gets cut mid-structure (Ollama JSON parse errors). Current default: 4096. This also applies to flashcard generation with existing cards context.

### Groq uses different models for JSON vs. text
- `_complete_groq()` (JSON generation): `llama-3.3-70b-versatile` — large model needed for complex nested JSON
- `_complete_text_groq()` (Kojo text): `llama-3.1-8b-instant` — smaller/faster, sufficient for conversational text
Don't unify these to the same model without testing — the 8b model consistently produced 0 FRQs in structured generation.

### Math FRQ validator rejects "explain/describe/what is" prefixes
`_MATH_FRQ_CONCEPTUAL_RE` regex blocks FRQs starting with Explain, Describe, What is, What are, Define, How do you, Why, State. Only computation questions pass (`_MATH_FRQ_COMPUTE_RE`). This means math prompts must explicitly ban those starters or the validator will reject the output and trigger fallback. The prompt already does this — don't remove the FRQ rules from the math prompt.

### FRQ fallback validator blocks "explain this idea from the notes:"
`_is_valid_frq()` explicitly rejects the phrase "explain this idea from the notes:" — this is the exact text used by `_fallback_questions()`. This prevents fallback content from being accepted as legitimate AI output if somehow mixed.

### MCQ validator blocks "which statement is supported"
Similarly, `_is_valid_mcq()` blocks "which statement is supported" — the exact fallback question format. Clean separation between fallback and real output.

### RAG uses hash-based embeddings, not a vector model
The retrieval system (`_retrieve_relevant_context`) doesn't use any embedding model. It uses Blake2b hash-based token vectors for cosine similarity. Fast, zero-dependency, but semantic accuracy is low. Good for filtering obviously irrelevant chunks; doesn't understand synonym relationships. This is a known limitation — don't replace with a real embedding model without also adding a dependency and startup cost discussion.

### File extraction uses multiprocessing for PDFs
`FileService.extract_from_files()` uses Python `multiprocessing` for PDF extraction (pdfplumber/PyMuPDF). This is to avoid blocking the async event loop during CPU-intensive parsing. Don't convert this to async without proper testing — PDF parsing is CPU-bound.

### Provider status check is cheap except for Ollama
For Gemini, Groq, Claude: `check_providers_status()` just checks if the API key env var is set — no network call. For Ollama (local): it pings `OLLAMA_BASE_URL/api/tags`. For Ollama (cloud, API key set): it skips the ping and returns `True`. Fetching provider status on every page load is fine for the cloud providers; it's only slightly slow for local Ollama due to the network ping.

### Kojo context is built from FolderFile content
When Kojo responds, it uses the study materials stored in `FolderFile` rows (the persistent folder files), not from uploaded-for-this-test files. If a user wants Kojo to know about something, they must upload it to the folder's file manager (not just to a test).

---

## Frontend Patterns

### Provider preferences read at call site, not component mount
All provider localStorage reads happen at the moment the API call is made:
```typescript
// In FlashcardsManage.tsx
const generated = await generateFlashcards(id, {
  ...
  provider: generationProvider,  // state synced to localStorage on change
  enableFallback: localStorage.getItem("nosey_question_fallback") !== "false",  // read at call time
});
```
The fallback toggle is always read fresh from localStorage at call time, not stored in component state. This ensures Settings page changes propagate without a page reload.

### Settings page toggle is a CSS-only pill switch
The question fallback toggle in Settings uses a hand-rolled CSS pill switch (`.settings-toggle-track` + `.settings-toggle-thumb`) rather than a lucide-react icon toggle. The icon approach (ToggleLeft/ToggleRight) was replaced because the icons were too small and state was unclear. Don't revert to the icon approach.

### API error messages come from `body.detail`
The `request()` wrapper in `api.ts` parses `response.json().detail` for error messages. FastAPI's HTTPException always uses `detail`. When adding new error responses on the backend, always use `detail` field — don't use `message` or other keys.

### Guest mode guest token is a hardcoded string
`const GUEST_TOKEN = "nosey_guest_token"` in `api.ts`. The token check `isGuestSession()` compares localStorage value to this literal. The backend accepts this token as a valid bearer token (it's treated as user ID 1 in the mock flow). This is a demo-only mechanism.

---

## Common Gotchas

### Adding a new test/flashcard generation parameter
If you add a new parameter to test generation, it must be threaded through ALL of:
1. `routes/tests.py` — parse from form data
2. `TestService.create_test()` — add to signature and pass through
3. `LLMService.generate_test_questions()` — add to signature
4. `_generate_test_attempts()` — may need to be passed to prompt builders
5. `api.ts createTest()` — add to FormData append logic
6. `types.ts` (if it's a new type/interface field)
7. `CreateTest.tsx` — UI control + pass to API call

Flashcard generation parameters similarly thread through:
`routes/flashcards.py` → `FlashcardService` → `LLMService.generate_flashcards()`

### Alembic migrations must be created for model changes
Any `src/models/*.py` change that alters columns, tables, or relationships needs an Alembic migration in `src/migrations/versions/`. Run `alembic revision --autogenerate -m "description"` then review the generated file.

### FRQ grading is async parallel
In `GradingService`, all FRQ answers in an attempt are graded with `asyncio.gather()`. Don't add anything to the grading path that isn't safe to run concurrently for multiple questions at once.

### Math mode fallback uses Fraction for exact arithmetic
`_fallback_math_questions()` uses Python's `fractions.Fraction` class to generate exact correct and distractor answers. This avoids floating-point errors in the displayed options. Don't convert to float math here.
