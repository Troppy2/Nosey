from __future__ import annotations

import json
import re
from dataclasses import dataclass
from html import unescape
from typing import Optional

import httpx

from src.schemas.leetcode_schema import (
    LCCustomTestCase,
    LCGeneratedCustomProblem,
    LeetCodeExample,
    LeetCodeGradeResponse,
    LeetCodeHintResponse,
    LeetCodeProblemResponse,
    LeetCodeTopicTag,
)
from src.services.llm_service import LLMService
from src.utils.exceptions import LLMException, ResourceNotFoundException

_LEETCODE_GRAPHQL_URL = "https://leetcode.com/graphql"
_REQUEST_TIMEOUT_SECONDS = 30


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

        return LCGeneratedCustomProblem(
            title=str(data.get("title", "") or "").strip()[:300],
            topic=str(data.get("topic", "unknown") or "unknown").strip()[:120] or "unknown",
            difficulty=difficulty,
            description=str(data.get("description", "") or "").strip()[:20000],
            starter_code=str(data.get("starter_code", "") or code or "").strip()[:20000],
            test_cases=test_cases,
        )

    async def _fetch_problem(self, title_slug: str) -> _FetchedProblem:
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

        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.post(
                _LEETCODE_GRAPHQL_URL,
                headers={"content-type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        question = (data.get("data") or {}).get("question")
        if not question:
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

1. **Correctness** (1–2 sentences): Are the results correct? What passed/failed and why?
2. **What's wrong** (if any tests failed): Point to the specific bug or logic error in their code. Be precise — line numbers or variable names if possible.
3. **How to fix it** (if any tests failed): Give a concrete hint about what to change — but do NOT rewrite the whole solution for them.
4. **Optimality** (always): Even if all tests passed, comment on time and space complexity. Is this the most efficient approach? What would the optimal solution's complexity be? Suggest the direction if there's a better approach.
5. **One encouragement** (1 sentence): End with something genuinely encouraging.

Keep the response concise and structured. Use markdown formatting.

Respond now:"""
