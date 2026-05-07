# CORS Investigation Prompt for Claude Code

Investigate why the deployed app at https://nosey-eosin.vercel.app is reporting CORS failures when it talks to the Render backend.

Use the repository context first:
- Read .claude/CLAUDE.md
- Read .claude/model-routing.md
- Read .claude/skills.md
- Read .claude/memory.md
- Read .claude/session-notes.md
- Read .claude/projectsummary.md
- Inspect study-app-backend/src/config.py
- Inspect study-app-backend/src/main.py
- Inspect study-app-backend/src/routes/health.py
- Inspect study-app-frontend/src/lib/api.ts
- Inspect study-app-frontend/src/pages/TakeTest.tsx
- Inspect docker-compose.yml and both .env files if available

Investigation requirements:
1. Do not trust the browser error string alone. Confirm the exact request URL, request origin, method, and whether the failure is on the OPTIONS preflight or the real request.
2. Use Playwright MCP on the deployed frontend and inspect:
   - Console errors
   - Network requests for failed API calls
   - Response status codes
   - Access-Control-Allow-Origin / Access-Control-Allow-Credentials headers
   - The DOM for any UI fallback that might hide the real error
3. Use the Render MCP server access to inspect the backend deployment:
   - Startup logs
   - Request logs around the failing endpoint
   - Environment variables, especially CORS_ORIGINS and any backend URL env vars used by the frontend deployment
   - Whether the deployed backend is actually serving the same host the frontend is configured to call
4. Verify the deployed frontend bundle is not falling back to the wrong API host.
   - Check VITE_API_BASE_URL in the Vercel build/runtime config.
   - Check for any hard-coded or duplicate fetch/sendBeacon URLs that bypass the shared API client.
5. Check whether the backend is returning the correct CORS headers for the exact browser origin, not just a nearby domain.
   - Confirm scheme + host + port match exactly.
   - Confirm credentials mode is compatible with the header set.

Model-routing instructions:
- Read and follow .claude/model-routing.md before making any LLM-related assumptions.
- Keep the CORS investigation separate from LLM provider routing unless the logs explicitly show an LLM call path is responsible for the failure.
- If you need to explain or modify any provider-routing logic while debugging, do so only after you have evidence from logs or the browser trace.

What to return:
- The single most likely root cause, with evidence.
- Any secondary contributing causes, if present.
- Whether the issue is frontend config, backend config, deployment env, or request path mismatch.
- The exact code or deployment change required to fix it.
- If the codebase is already correct, say so and point to the failing deployment config or host mismatch instead.

If the codebase is not set up correctly, fix it locally with the smallest safe change and include the verification steps you used.