from __future__ import annotations

import json
import re
from dataclasses import dataclass
from html import unescape
from typing import Optional

import httpx

from src.schemas.leetcode_schema import (
    LeetCodeExample,
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
    ) -> LeetCodeHintResponse:
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
