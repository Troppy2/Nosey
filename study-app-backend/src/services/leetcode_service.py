from __future__ import annotations

import json
import re
from dataclasses import dataclass
from html import unescape
from typing import AsyncIterator, Optional

import httpx

from src.schemas.leetcode_schema import (
    LCCustomTestCase,
    LCGeneratedCustomProblem,
    LeetCodeComplexityCheckResponse,
    LeetCodeExample,
    LeetCodeGradeResponse,
    LeetCodeHintResponse,
    LeetCodeProblemResponse,
    LeetCodeTopicTag,
)
from src.services.llm_service import LLMService
from src.utils.exceptions import LLMException, ResourceNotFoundException
from src.utils.logger import get_logger

logger = get_logger(__name__)

_LEETCODE_GRAPHQL_URL = "https://leetcode.com/graphql"
_REQUEST_TIMEOUT_SECONDS = 30
# Shorter budget for the Daily KojoCode seed fetch specifically. That fetch is optional
# (failure just falls back to a title-only reskin), and it runs BEFORE a slow LLM call, so
# a full 30s of doomed waiting would be added to every daily whenever LeetCode is
# unreachable. Bounding it keeps the fallback fast instead of merely correct.
_SEED_FETCH_TIMEOUT_SECONDS = 8

# LeetCode's public GraphQL endpoint sits behind Cloudflare, which blocks requests that
# look automated. From a residential IP a bare request succeeds, but from a datacenter IP
# (Render, and any cloud host) it is served a challenge instead: the HTTP status is still
# 200, but the payload carries no "question" object, so the fetch surfaces as a 404 on a
# perfectly valid slug. Presenting browser-like headers is what gets the request through.
#
# This is best-effort and inherently fragile. Cloudflare can tighten at any time and these
# headers stop being enough, at which point every LeetCode fetch 404s again from prod.
# See the tracking issue linked in session-notes for the durable fix (seed-free daily
# generation, or a graceful fallback when the seed fetch fails).
_LEETCODE_BROWSER_HEADERS = {
    "content-type": "application/json",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "referer": "https://leetcode.com/problemset/",
    "origin": "https://leetcode.com",
    "accept": "application/json",
    "accept-language": "en-US,en;q=0.9",
}


@dataclass(frozen=True)
class _FetchedProblem:
    title: str
    title_slug: str
    difficulty: str
    content_html: str
    examples: list[LeetCodeExample]
    example_testcases: list[str]
    python_snippet: Optional[str]
    topic_tags: list[LeetCodeTopicTag]


class LeetCodeService:
    async def get_problem(self, title_slug: str) -> LeetCodeProblemResponse:
        problem = await self._fetch_problem(title_slug)
        return LeetCodeProblemResponse(
            title=problem.title,
            title_slug=problem.title_slug,
            difficulty=problem.difficulty,
            content_html=problem.content_html,
            examples=problem.examples,
            example_testcases=problem.example_testcases,
            python_snippet=problem.python_snippet,
            topic_tags=problem.topic_tags,
        )

    async def hint(
        self,
        title_slug: str,
        title: str,
        user_message: str,
        user_code: str,
        provider: Optional[str] = None,
        statement: str = "",
    ) -> LeetCodeHintResponse:
        if statement.strip():
            prompt = self._build_hint_prompt(
                title=title or "this problem",
                statement_html=statement,
                examples=[],
                user_message=user_message,
                user_code=user_code,
            )
        else:
            problem = await self._fetch_problem(title_slug)
            prompt = self._build_hint_prompt(
                title=title or problem.title,
                statement_html=problem.content_html,
                examples=problem.examples,
                user_message=user_message,
                user_code=user_code,
            )
        try:
            response = await LLMService().call_kojo(prompt, provider=provider)
        except Exception as exc:  # pragma: no cover - mirrors Kojo path
            raise LLMException("Kojo failed to generate a LeetCode hint. Try again.") from exc

        flagged = any(
            phrase in response.lower()
            for phrase in ("can't help", "cannot help", "not sure", "unsure")
        )
        return LeetCodeHintResponse(response=response, flagged_uncertain=flagged)

    async def grade(
        self,
        title_slug: str,
        title: str,
        user_code: str,
        test_results: str,
        all_passed: bool,
        provider: Optional[str] = None,
        statement: str = "",
    ) -> LeetCodeGradeResponse:
        if statement.strip():
            prompt = self._build_grade_prompt(
                title=title or "this problem",
                statement_html=statement,
                user_code=user_code,
                test_results=test_results,
                all_passed=all_passed,
            )
        else:
            problem = await self._fetch_problem(title_slug)
            prompt = self._build_grade_prompt(
                title=title or problem.title,
                statement_html=problem.content_html,
                user_code=user_code,
                test_results=test_results,
                all_passed=all_passed,
            )
        try:
            response = await LLMService().call_kojo(prompt, provider=provider)
        except Exception as exc:
            raise LLMException("Kojo failed to grade the submission. Try again.") from exc

        return LeetCodeGradeResponse(feedback=response, flagged_uncertain=False)

    async def grade_complexity(
        self,
        title_slug: str,
        title: str,
        user_code: str,
        time_claim: str,
        time_reasoning: str,
        space_claim: str,
        space_reasoning: str,
        provider: Optional[str] = None,
        statement: str = "",
    ) -> tuple[LeetCodeComplexityCheckResponse, str]:
        """Grade the student's self-assessed complexity.

        Returns the response plus the LLM's weakness_severity ("none" | "minor" |
        "major") so the route can log a small weakness signal without exposing that
        internal field to the client.
        """
        if statement.strip():
            statement_text = self._html_to_text(statement)
        else:
            problem = await self._fetch_problem(title_slug)
            title = title or problem.title
            statement_text = self._html_to_text(problem.content_html)

        try:
            grade = await LLMService().grade_complexity_answer(
                title=title or "this problem",
                statement=statement_text,
                user_code=user_code,
                time_claim=time_claim,
                time_reasoning=time_reasoning,
                space_claim=space_claim,
                space_reasoning=space_reasoning,
                provider=provider,
            )
        except Exception as exc:
            raise LLMException("Kojo failed to analyze the complexity. Try again.") from exc

        response = LeetCodeComplexityCheckResponse(
            actual_time_complexity=grade.actual_time_complexity,
            actual_space_complexity=grade.actual_space_complexity,
            time_correct=grade.time_correct,
            space_correct=grade.space_correct,
            feedback=grade.feedback,
            confidence=grade.confidence,
            flagged_uncertain=grade.flagged_uncertain,
        )
        return response, grade.weakness_severity

    async def generate_custom_problem(
        self,
        code: str,
        hint: str = "",
        provider: Optional[str] = None,
    ) -> LCGeneratedCustomProblem:
        """Turn user-pasted code into a full LeetCode-style problem (title, walkthrough,
        worked examples, runnable starter code, named-argument test cases)."""
        try:
            data = await LLMService().generate_custom_problem(code=code, hint=hint, provider=provider)
        except Exception as exc:
            raise LLMException("Kojo couldn't generate a problem from that code. Try again.") from exc

        return self._normalize_generated_problem(data, fallback_code=code)

    async def generate_solution_article(
        self,
        title: str,
        statement: str,
        starter_code: str,
        provider: Optional[str] = None,
    ) -> dict[str, object]:
        """Generate the optimal-approach KojoCode solution for a custom problem. Returns
        a normalized dict (summary, runnable solution_code, per-line code_comments,
        complexity + reasoning) ready to persist. `statement` may be Markdown or HTML;
        it is passed through to the model as-is. Single LLM call (fallback handled inside
        LLMService), no per-provider loop here."""
        try:
            data = await LLMService().generate_solution_article(
                title=title, statement=statement, starter_code=starter_code, provider=provider
            )
        except Exception as exc:
            raise LLMException("Kojo couldn't write a solution for this problem. Try again.") from exc

        return self._normalize_solution_article(data, fallback_code=starter_code)

    def _normalize_solution_article(
        self, data: dict[str, object], fallback_code: str = ""
    ) -> dict[str, object]:
        """Parse a generated solution-article JSON blob: keep only well-formed comment
        pairs and truncate every text field to its column limit."""
        raw_comments = data.get("code_comments")
        comments: list[dict[str, str]] = []
        if isinstance(raw_comments, list):
            for item in raw_comments:
                if not isinstance(item, dict):
                    continue
                code_line = str(item.get("code", "") or "")[:600]
                comment = str(item.get("comment", "") or "").strip()[:1000]
                if not code_line.strip() and not comment:
                    continue
                comments.append({"code": code_line, "comment": comment})

        return {
            "title": str(data.get("title", "") or "").strip()[:300],
            "approach_summary": str(data.get("approach_summary", "") or "").strip()[:8000],
            "solution_code": str(data.get("solution_code", "") or fallback_code or "").strip()[:20000],
            "code_comments": comments,
            "time_complexity": str(data.get("time_complexity", "") or "").strip()[:60],
            "space_complexity": str(data.get("space_complexity", "") or "").strip()[:60],
            "complexity_explanation": str(data.get("complexity_explanation", "") or "").strip()[:8000],
        }

    @staticmethod
    def _title_from_slug(slug: str) -> str:
        """Best-effort "course-schedule-ii" -> "Course Schedule Ii". Only used when a
        client sends a seed_slug without a seed_title (older frontend builds). Rough but
        close enough for the model to recognise the problem it names."""
        return " ".join(part.capitalize() for part in (slug or "").split("-") if part)

    async def generate_daily_problem(
        self,
        topic: str,
        target_difficulty: str,
        seed_slug: str = "",
        seed_title: str = "",
        subtopic: Optional[str] = None,
        provider: Optional[str] = None,
    ) -> LCGeneratedCustomProblem:
        """Reskin a seed problem into a fresh Daily KojoCode problem on the given topic
        (and, when targeting a weak area, subtopic) at the given difficulty.

        PREFERRED path: fetch the real LeetCode statement for seed_slug and reskin that,
        which is the best grounding available.

        FALLBACK path: if that fetch fails for any reason, reskin from the catalog TITLE
        alone and let the model work from its knowledge of the named problem. This matters
        because the fetch is unreliable from prod: Cloudflare blocks datacenter IPs and the
        block used to surface as a 404 on every daily generation (GH #75). The app stores
        no statements of its own (the catalog is metadata only, prep banks hold bare
        slugs), so the title is the strongest seed available without the network.

        The fallback swallows ALL fetch errors, so a daily is never blocked by LeetCode
        being unreachable and this method can no longer raise ResourceNotFoundException."""
        title = (seed_title or "").strip() or self._title_from_slug(seed_slug)
        seed_statement = ""
        if seed_slug:
            try:
                seed = await self._fetch_problem(seed_slug, timeout=_SEED_FETCH_TIMEOUT_SECONDS)
                seed_statement = self._html_to_text(seed.content_html)
                # The real title beats the catalog's, which beats one derived from a slug.
                title = seed.title or title
            except Exception as exc:  # noqa: BLE001 - the seed is optional by design
                # Covers the Cloudflare block, a bad slug, and any timeout or transport
                # error alike: all of them just mean "reskin from the title instead".
                logger.info(
                    "Daily seed fetch failed for %s (%s: %s). Falling back to title-only "
                    "reskin of %r.",
                    seed_slug,
                    type(exc).__name__,
                    exc,
                    title,
                )

        try:
            data = await LLMService().generate_daily_problem(
                topic=topic,
                subtopic=subtopic,
                target_difficulty=target_difficulty,
                seed_title=title,
                seed_statement=seed_statement,
                provider=provider,
            )
        except Exception as exc:
            raise LLMException("Kojo couldn't generate today's problem. Try again.") from exc

        return self._normalize_generated_problem(data, fallback_code="")

    async def stream_custom_problems(
        self,
        topics_text: str,
        difficulty: str,
        count: int,
        provider: Optional[str] = None,
    ) -> AsyncIterator[LCGeneratedCustomProblem]:
        """Generate `count` fresh problems in one streaming LLM call, yielding each as a
        fully normalized LCGeneratedCustomProblem the moment it finishes streaming (same
        clamping/truncation as the single-problem path). The route turns each into an SSE
        event. LLM failures propagate as LLMException for the route to surface."""
        try:
            async for data in LLMService().stream_custom_problems(
                topics_text=topics_text, difficulty=difficulty, count=count, provider=provider
            ):
                yield self._normalize_generated_problem(data)
        except LLMException:
            raise
        except Exception as exc:
            raise LLMException("Kojo couldn't generate problems right now. Try again.") from exc

    async def classify_custom_problems(
        self,
        problems: list[dict[str, str]],
        provider: Optional[str] = None,
    ) -> dict[str, dict[str, str]]:
        """Classify-only backfill for the "Regenerate topics" button. Given stored
        custom problems (each {slug, title, description, starter_code}), return
        {slug: {topic, subtopic}} WITHOUT touching their statements or test cases.
        Batched by the LLM layer; a slug missing from the result just keeps its
        existing labels."""
        if not problems:
            return {}
        try:
            return await LLMService().classify_custom_problems(problems, provider=provider)
        except Exception as exc:
            raise LLMException("Kojo couldn't regenerate topics right now. Try again.") from exc

    def _normalize_generated_problem(
        self, data: dict[str, object], fallback_code: str = ""
    ) -> LCGeneratedCustomProblem:
        """Shared parser for a generated-problem JSON blob (custom or daily): clamp the
        difficulty to the allowed set, keep only runnable test cases, and truncate all
        text fields to their column limits."""
        difficulty = str(data.get("difficulty", "unknown") or "unknown").strip().capitalize()
        if difficulty not in ("Easy", "Medium", "Hard"):
            difficulty = "unknown"

        raw_cases = data.get("test_cases")
        test_cases: list[LCCustomTestCase] = []
        if isinstance(raw_cases, list):
            for item in raw_cases:
                if not isinstance(item, dict):
                    continue
                input_text = str(item.get("input_text", "") or "").strip()
                output_text = str(item.get("output_text", "") or "").strip()
                if not input_text or not output_text:
                    continue
                explanation = item.get("explanation_text")
                test_cases.append(
                    LCCustomTestCase(
                        input_text=input_text[:4000],
                        output_text=output_text[:4000],
                        explanation_text=(str(explanation)[:4000] if explanation else None),
                    )
                )

        subtopic_raw = str(data.get("subtopic", "") or "").strip()[:120]
        return LCGeneratedCustomProblem(
            title=str(data.get("title", "") or "").strip()[:300],
            topic=str(data.get("topic", "unknown") or "unknown").strip()[:120] or "unknown",
            subtopic=subtopic_raw or None,
            difficulty=difficulty,
            description=str(data.get("description", "") or "").strip()[:20000],
            starter_code=str(data.get("starter_code", "") or fallback_code or "").strip()[:20000],
            test_cases=test_cases,
        )

    async def _fetch_problem(
        self, title_slug: str, timeout: float = _REQUEST_TIMEOUT_SECONDS
    ) -> _FetchedProblem:
        payload = {
            "query": (
                "query questionData($titleSlug: String!) { "
                "question(titleSlug: $titleSlug) { "
                "title titleSlug content difficulty exampleTestcases "
                "topicTags { name slug } "
                "codeSnippets { lang langSlug code } "
                "} }"
            ),
            "variables": {"titleSlug": title_slug},
        }

        # A per-problem referer is more convincing to Cloudflare than a generic one, since
        # it matches what a browser sitting on that problem's page would actually send.
        headers = {
            **_LEETCODE_BROWSER_HEADERS,
            "referer": f"https://leetcode.com/problems/{title_slug}/",
        }

        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.post(_LEETCODE_GRAPHQL_URL, headers=headers, json=payload)
            response.raise_for_status()
            try:
                data = response.json()
            except ValueError:
                # A Cloudflare challenge comes back as HTML with a 200, so the decode fails
                # here rather than at raise_for_status. Log a snippet: this is the signal
                # that the browser headers above have stopped being enough.
                logger.warning(
                    "LeetCode fetch for %s returned non-JSON (likely a Cloudflare block). "
                    "content-type=%s body[:200]=%r",
                    title_slug,
                    response.headers.get("content-type"),
                    response.text[:200],
                )
                raise ResourceNotFoundException("LeetCode problem")

        question = (data.get("data") or {}).get("question")
        if not question:
            # Distinguishes a genuinely bad slug from a block that returned valid JSON with
            # a null question. Without this the two are indistinguishable in prod logs.
            logger.warning(
                "LeetCode fetch for %s returned no question object. errors=%r",
                title_slug,
                data.get("errors"),
            )
            raise ResourceNotFoundException("LeetCode problem")

        topic_tags = [
            LeetCodeTopicTag(name=str(tag.get("name", "")), slug=str(tag.get("slug", "")))
            for tag in question.get("topicTags", [])
            if tag
        ]
        code_snippets = question.get("codeSnippets", [])
        python_snippet = next(
            (
                str(item.get("code", ""))
                for item in code_snippets
                if str(item.get("langSlug", "")) == "python3"
            ),
            None,
        )
        content_html = str(question.get("content", "") or "")

        return _FetchedProblem(
            title=str(question.get("title", "")),
            title_slug=str(question.get("titleSlug", title_slug)),
            difficulty=str(question.get("difficulty", "")),
            content_html=content_html,
            examples=self._parse_examples(content_html),
            example_testcases=self._parse_example_testcases(str(question.get("exampleTestcases", "") or "")),
            python_snippet=python_snippet,
            topic_tags=topic_tags,
        )

    def _parse_example_testcases(self, raw: str) -> list[str]:
        if not raw.strip():
            return []
        parts = [part.strip() for part in re.split(r"\n\s*\n", raw.strip()) if part.strip()]
        return parts if parts else [raw.strip()]

    def _parse_examples(self, content_html: str) -> list[LeetCodeExample]:
        examples: list[LeetCodeExample] = []

        # Old format: <pre>Input: ...\nOutput: ...</pre>
        pre_blocks = re.findall(r"<pre>(.*?)</pre>", content_html, flags=re.DOTALL | re.IGNORECASE)
        for index, raw_block in enumerate(pre_blocks, start=1):
            block_text = self._html_to_text(raw_block)
            input_match = re.search(r"Input:\s*(.+?)(?:\nOutput:|\Z)", block_text, flags=re.DOTALL)
            output_match = re.search(r"Output:\s*(.+?)(?:\nExplanation:|\Z)", block_text, flags=re.DOTALL)
            explanation_match = re.search(r"Explanation:\s*(.+?)\Z", block_text, flags=re.DOTALL)
            if not input_match or not output_match:
                continue
            examples.append(
                LeetCodeExample(
                    index=index,
                    input_text=input_match.group(1).strip(),
                    output_text=output_match.group(1).strip(),
                    explanation_text=explanation_match.group(1).strip() if explanation_match else None,
                )
            )

        if examples:
            return examples

        # New format: <div class="example-block"> with <span class="example-io">
        div_blocks = re.findall(
            r'<div[^>]+class="example-block"[^>]*>(.*?)</div>',
            content_html,
            flags=re.DOTALL | re.IGNORECASE,
        )
        for index, raw_block in enumerate(div_blocks, start=1):
            io_spans = re.findall(r'<span[^>]+class="example-io"[^>]*>(.*?)</span>', raw_block, flags=re.DOTALL | re.IGNORECASE)
            labels = re.findall(r'<strong[^>]*>\s*(Input|Output|Explanation)\s*:?\s*</strong>', raw_block, flags=re.IGNORECASE)
            if len(io_spans) < 2 or len(labels) < 2:
                continue
            label_map: dict[str, str] = {}
            for label, span in zip(labels, io_spans):
                label_map[label.lower()] = self._html_to_text(span).strip()
            if "input" not in label_map or "output" not in label_map:
                continue
            examples.append(
                LeetCodeExample(
                    index=index,
                    input_text=label_map["input"],
                    output_text=label_map["output"],
                    explanation_text=label_map.get("explanation"),
                )
            )

        return examples

    def _html_to_text(self, html: str) -> str:
        text = html
        text = re.sub(r"</?(strong|em|code|sup)[^>]*>", "", text, flags=re.IGNORECASE)
        text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(r"</p\s*>", "\n\n", text, flags=re.IGNORECASE)
        text = re.sub(r"</li\s*>", "\n", text, flags=re.IGNORECASE)
        text = re.sub(r"<li[^>]*>", "- ", text, flags=re.IGNORECASE)
        text = re.sub(r"<[^>]+>", "", text)
        return unescape(text).strip()

    def _build_hint_prompt(
        self,
        title: str,
        statement_html: str,
        examples: list[LeetCodeExample],
        user_message: str,
        user_code: str,
    ) -> str:
        condensed_statement = self._html_to_text(statement_html)[:9000]
        examples_block = "\n\n".join(
            [
                f"Example {example.index}\nInput: {example.input_text}\nOutput: {example.output_text}"
                + (f"\nExplanation: {example.explanation_text}" if example.explanation_text else "")
                for example in examples[:3]
            ]
        )
        return f"""You are Kojo, a supportive coding coach inside Nosey's LeetCode mode.
You are helping with the LeetCode problem "{title}".

OFFICIAL LEETCODE STATEMENT:
{condensed_statement}

OFFICIAL EXAMPLES:
{examples_block or "[No example text available]"}

STUDENT MESSAGE:
{user_message}

STUDENT CODE:
```python
{user_code.strip() or "# No code yet"}
```

STRICT RULES:
- Do NOT provide a full solution.
- Do NOT write the completed final code for the student.
- Do NOT give step-by-step code that effectively becomes the full answer.
- You MAY give:
  - a high-level approach
  - the right way to think about the data structure or algorithm
  - edge cases to consider
  - why their current direction is or is not working
  - a small nudge toward the next step
  - time and space complexity guidance
- If they ask for the exact code, refuse gently and give the next best hint instead.
- If their code has a bug, point to the bug and suggest what to inspect, but stop short of rewriting the whole answer.
- Keep the response focused, practical, and encouraging.

Respond with a coaching hint now:"""

    def _build_grade_prompt(
        self,
        title: str,
        statement_html: str,
        user_code: str,
        test_results: str,
        all_passed: bool,
    ) -> str:
        condensed_statement = self._html_to_text(statement_html)[:6000]
        verdict = "ALL TESTS PASSED" if all_passed else "SOME TESTS FAILED"
        return f"""You are Kojo, a supportive coding coach inside Nosey's LeetCode mode.
The student just ran their code against test cases for "{title}".

PROBLEM STATEMENT:
{condensed_statement}

STUDENT'S CODE:
```python
{user_code.strip() or "# No code"}
```

TEST RESULTS ({verdict}):
{test_results}

YOUR TASK — grade this submission and give actionable coaching feedback:

1. **Correctness** (1-2 sentences): Are the results correct? What passed/failed and why?
2. **What's wrong** (if any tests failed): Point to the specific bug or logic error in their code. Be precise, line numbers or variable names if possible.
3. **How to fix it** (if any tests failed): Give a concrete hint about what to change, but do NOT rewrite the whole solution for them.
4. **One encouragement** (1 sentence): End with something genuinely encouraging.

Do NOT state the time or space complexity of the solution, and do NOT tell them what the optimal complexity would be. The student assesses complexity themselves in a separate step, so revealing it here would defeat that exercise.

Keep the response concise and structured. Use markdown formatting.

Respond now:"""
