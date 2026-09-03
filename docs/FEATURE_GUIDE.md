# Adding Features to Nosey

A practical guide for adding new features. Use this to decide which layers you need to touch and in what order.

---

## Decide What Layers You Need

Before writing any code, answer these three questions:

**1. Does the feature need data to survive a page refresh?**
- No: use React `useState` only.
- Yes, but only on this device: use `localStorage`.
- Yes, and across multiple devices / after clearing the browser: use the **database** (requires backend + migration).

**2. Does the feature need the server to do work** (LLM calls, file parsing, access control, aggregations)?
- No: frontend-only is fine.
- Yes: you need a **backend route + service**.

**3. Does the feature change the database schema** (new table, new column)?
- Yes: you need an **Alembic migration**.

---

## Frontend-Only Feature

Use this when: the feature is purely UI, or state only needs to live in the current browser session / localStorage.

Examples: UI toggles, localStorage preferences, client-side filtering.

**Checklist:**
- [ ] Add or update the page/component in `study-app-frontend/src/pages/` or `src/components/`
- [ ] Add CSS at the end of `src/styles/styles.css` (search for existing classes first - no duplicates)
- [ ] If the feature adds new data shapes, add types to `src/lib/types.ts`
- [ ] Wire any new route in `src/app/App.tsx`
- [ ] Add nav link to `src/components/Sidebar.tsx` if it needs top-level navigation
- [ ] Run `npx tsc --noEmit` - zero errors before calling it done

**localStorage keys** follow the convention `nosey_<feature>_<id>`. Example: `nosey_lc_progress`.

---

## Frontend + Backend Feature (no new DB columns)

Use this when: the feature needs a server action (LLM call, file access, auth check) but doesn't change the schema.

Examples: a new LLM endpoint, a new query over existing tables, a new action button that calls an API.

**Backend checklist:**
- [ ] Add the route to the appropriate file in `src/routes/` (or create a new file and register it in `main.py`)
- [ ] Add business logic to the matching service in `src/services/`
- [ ] Add DB queries to the matching repository in `src/repositories/` (keep raw SQL/ORM out of routes and services)
- [ ] Add request/response Pydantic schemas to `src/schemas/`
- [ ] Map exceptions: `ResourceNotFoundException` -> 404, `LLMException` -> 503, `ValidationException` / `StudyAppException` -> 400
- [ ] Use `user: User = Depends(get_current_user)` for any authenticated route

**Frontend checklist:**
- [ ] Add the API call function to `src/lib/api.ts` using the `request<T>()` wrapper (never call `fetch` directly in a component)
- [ ] Add the response type to `src/lib/types.ts`
- [ ] Build the UI in the page/component
- [ ] Run `npx tsc --noEmit` - zero errors

---

## Frontend + Backend + Database Feature

Use this when: the feature stores new data that must persist across devices or browser clears.

Examples: saving code workspaces, tracking progress, storing user-generated content.

**Order matters - do this in sequence:**

1. **Add the model** in `study-app-backend/src/models/`
   - Add the relationship to `User` (or the relevant parent model) in `src/models/user.py`
   - Export from `src/models/__init__.py`

2. **Generate the migration**
   ```bash
   cd study-app-backend
   alembic revision --autogenerate -m "describe_what_changed"
   ```
   - Review the generated file in `src/migrations/versions/` before applying
   - Watch for accidental DROP statements on unrelated tables (autogenerate can produce these)

3. **Apply the migration**
   ```bash
   alembic upgrade head
   ```

4. **Add the schema** (Pydantic request/response models in `src/schemas/`)

5. **Add the repository** (DB queries in `src/repositories/`)

6. **Add the service** (business logic in `src/services/`)

7. **Add the route** (FastAPI handler in `src/routes/`)

8. **Wire the frontend** - API function in `api.ts`, types in `types.ts`, UI in the component

---

## Feature Needs to Sync Across Devices

If something lives in `localStorage` today and you want it to survive on a second device or after clearing the browser, you need to push it to the database.

**The pattern used in this codebase (see LeetCode sync as the reference):**

- On mount: fetch from DB, merge with localStorage (union wins - don't lose local-only data)
- On change: write to localStorage immediately (fast, no latency), then fire a background DB write (debounced for frequent changes like code edits, immediate for structural changes like adding a tab)
- Skip DB calls for guest sessions (`isGuestSession()` check in `api.ts`)

**When to debounce vs. immediate sync:**
- Frequent keystroke-level changes (code typing): debounce 1-2 seconds
- Structural changes (add tab, delete item, toggle solved): sync immediately after the state update

---

## LLM Features

Read `.claude/design-patterns/model-routing.md` and `llm_service.py` in full before touching anything LLM-related.

Key rules:
- Never call `LLMService` inside a loop that iterates over providers - the service handles retries internally
- Never put `_extract_study_content` inside the provider loop - it runs once before generation
- Keep the two Groq models separate: `llama-3.3-70b-versatile` for JSON, `llama-3.1-8b-instant` for Kojo chat
- Never lower `_JSON_MAX_TOKENS` below 3000 for generation tasks
- Adding a new provider requires changes in 10 places - see `model-routing.md` for the full list

---

## Adding a Test Generation Parameter

Threading a new parameter through all layers requires 7 stops:

1. `routes/tests.py` - parse from form data
2. `TestService.create_test()` - add to signature + pass through
3. `LLMService.generate_test_questions()` - add to signature
4. `_generate_test_attempts()` - pass to prompt builders
5. `api.ts createTest()` - append to `FormData`
6. `types.ts` - add to interface if it's a new type
7. `CreateTest.tsx` - UI control + pass to API call

---

## CSS Rules

- All CSS goes in `study-app-frontend/src/styles/styles.css` - one file, no modules, no Tailwind
- Search the file for the class name before adding a new one (duplicates accumulate fast)
- Add new rules at the end of the file, grouped by component
- Use existing CSS variables: `var(--green-dark)`, `var(--ink)`, `var(--green-lightest)`, etc.
- Mobile breakpoints: `760px` (tablet/mobile), `560px` (small mobile), `480px` (very small)
- Never use em dashes (U+2014) anywhere in source files - use a comma, colon, or hyphen instead

---

## Quick Reference

| What you're building | Layers needed |
|---|---|
| UI toggle / display change | Frontend only |
| Preference that survives refresh | Frontend + localStorage |
| Preference that syncs across devices | Frontend + Backend + DB |
| New LLM action | Frontend + Backend |
| New user-owned data | Frontend + Backend + DB (migration) |
| Cross-device sync for existing localStorage data | Frontend + Backend + DB (migration) |
