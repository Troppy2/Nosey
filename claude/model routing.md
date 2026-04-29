# Model Routing Guide

Use this guide to pick the right model behavior for work in the Study App project.

## Default Rule
Choose the lightest model that can complete the task correctly. Escalate only when the task needs deeper reasoning, cross-file coordination, or risk-sensitive judgment.

## Routing Table
| Task Type | Preferred Model Behavior |
| --- | --- |
| File lookup, reading docs, summarizing existing code | Fast, lightweight reasoning |
| Single-file edits with clear local context | Fast or standard reasoning |
| API wiring, schema tweaks, service logic, endpoint changes | Standard reasoning with careful local validation |
| Auth, secrets, migrations, grading logic, data integrity | Strong reasoning |
| Multi-file refactors, architecture changes, or ambiguous bugs | Strong reasoning plus focused exploration |
| Code review, security review, regression risk analysis | Strong reasoning |

## Recommended Workflow
- Use a fast pass to inspect nearby files and identify the owning code path.
- Switch to stronger reasoning for changes that affect security, schema, or correctness guarantees.
- Use a read-only exploration step before editing when the target area is unclear.
- Keep model changes deliberate; do not bounce between models for trivial tasks.

## Project-Specific Guidance
- Prefer careful reasoning for anything involving Google OAuth, JWTs, uploads, grading, or generated answers.
- Prefer careful reasoning for database migrations and relationship changes.
- Prefer fast reasoning for documentation cleanup, naming, and straightforward copy updates.
- If a task can be solved by reading one or two nearby files, do that before escalating.

## Safety Check
If the task risks leaking secrets, exposing correct answers, or weakening validation, route it to stronger reasoning and validate the change before finishing.
