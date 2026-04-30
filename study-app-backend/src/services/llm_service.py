from __future__ import annotations

import json
import re
from dataclasses import dataclass

import httpx

from src.config import settings
from src.schemas.attempt_schema import FRQGrade
from src.utils.logger import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class GeneratedMCQ:
    question_text: str
    options: list[str]
    correct_index: int


@dataclass(frozen=True)
class GeneratedFRQ:
    question_text: str
    expected_answer: str


@dataclass(frozen=True)
class GeneratedFlashcard:
    front: str
    back: str


@dataclass(frozen=True)
class _ExtractedTerm:
    term: str
    definition: str


@dataclass(frozen=True)
class _StudyContent:
    title: str
    terms: list[_ExtractedTerm]
    concepts: list[str]


_EXTRACT_CHAR_LIMIT = 10_000
_GENERATE_CHAR_LIMIT = 8_000


class LLMService:
    async def generate_test_questions(
        self,
        notes: str,
        test_type: str,
        count_mcq: int = 10,
        count_frq: int = 5,
        is_math_mode: bool = False,
    ) -> tuple[list[GeneratedMCQ], list[GeneratedFRQ]]:
        if test_type == "MCQ_only":
            count_frq = 0
        elif test_type == "FRQ_only":
            count_mcq = 0

        # Strip file metadata (YAML frontmatter, doc markers) before any LLM pass.
        cleaned = self._strip_metadata(notes)

        if is_math_mode:
            try:
                prompt = self._build_math_generation_prompt(cleaned, count_mcq, count_frq, test_type)
                data = await self._complete_json(prompt)
                return self._parse_generated_test(data, count_mcq, count_frq, cleaned)
            except Exception as exc:
                logger.warning("Math question generation failed; using fallback: %s", exc)
                return self._fallback_questions(cleaned, count_mcq, count_frq)

        # Pass 1: extract structured study content from the cleaned notes.
        study = await self._extract_study_content(cleaned)

        # Pass 2: generate questions from the clean structured content.
        prompt = self._build_generation_prompt(study, count_mcq, count_frq)
        try:
            data = await self._complete_json(prompt)
            return self._parse_generated_test(data, count_mcq, count_frq, cleaned)
        except Exception as exc:
            logger.warning("LLM test generation failed; using deterministic fallback: %s", exc)
            return self._fallback_questions(cleaned, count_mcq, count_frq)

    async def _extract_study_content(self, notes: str) -> _StudyContent:
        prompt = (
            "Analyze the study notes below and return JSON with exactly these keys:\n"
            "- title: the subject or chapter title (string, empty string if none found)\n"
            "- terms: array of objects with 'term' (string) and 'definition' (string) "
            "for every vocabulary term, key concept, or defined idea in the notes\n"
            "- concepts: array of strings, each a core fact, rule, or idea worth testing "
            "(not the same as terms — these are statements, not definitions)\n\n"
            "RULES:\n"
            "- DO NOT include authors, publication dates, page numbers, URLs, or citation info\n"
            "- DO NOT include the title itself as a term or concept\n"
            "- Extract as many terms and concepts as exist in the notes — be thorough\n"
            "- Keep each definition and concept concise but complete\n\n"
            "Return JSON only. Example format:\n"
            '{"title":"Cell Biology","terms":[{"term":"Mitosis",'
            '"definition":"Process of cell division producing two genetically identical cells"}],'
            '"concepts":["The cell cycle has four phases: G1, S, G2, and M"]}\n\n'
            f"NOTES:\n{notes[:_EXTRACT_CHAR_LIMIT]}"
        )
        try:
            data = await self._complete_json(prompt)
            title = str(data.get("title", "")).strip()
            raw_terms = data.get("terms", [])
            raw_concepts = data.get("concepts", [])
            terms = [
                _ExtractedTerm(term=str(t.get("term", "")).strip(), definition=str(t.get("definition", "")).strip())
                for t in (raw_terms if isinstance(raw_terms, list) else [])
                if isinstance(t, dict) and t.get("term") and t.get("definition")
            ]
            concepts = [
                str(c).strip()
                for c in (raw_concepts if isinstance(raw_concepts, list) else [])
                if isinstance(c, str) and c.strip()
            ]
            if terms or concepts:
                logger.info("Extracted %d terms and %d concepts from notes", len(terms), len(concepts))
                return _StudyContent(title=title, terms=terms, concepts=concepts)
        except Exception as exc:
            logger.warning("Study content extraction failed; falling back to raw notes: %s", exc)

        # Extraction failed — treat raw sentences as concepts so generation still works.
        return _StudyContent(title="", terms=[], concepts=self._sentences(notes)[:40])

    def _build_generation_prompt(
        self, study: _StudyContent, count_mcq: int, count_frq: int
    ) -> str:
        context_header = f'SUBJECT: "{study.title}"\n\n' if study.title else ""

        terms_block = ""
        if study.terms:
            lines = "\n".join(
                f"  - {t.term}: {t.definition}" for t in study.terms[:60]
            )
            terms_block = f"TERMS AND DEFINITIONS:\n{lines}\n\n"

        concepts_block = ""
        if study.concepts:
            lines = "\n".join(f"  - {c}" for c in study.concepts[:40])
            concepts_block = f"KEY CONCEPTS AND FACTS:\n{lines}\n\n"

        mcq_instructions = ""
        if count_mcq > 0:
            mcq_instructions = (
                f"Generate exactly {count_mcq} MCQ questions.\n"
                "MCQ rules:\n"
                "  - Each question must test understanding of a SPECIFIC term, definition, or concept above\n"
                "  - Wrong answer options must be plausible but clearly incorrect\n"
                "  - Do NOT ask 'what is the title of...' or reference authors/sources\n"
                "  - Vary question style: some ask for the definition, some apply the concept\n"
            )

        frq_instructions = ""
        if count_frq > 0:
            frq_instructions = (
                f"Generate exactly {count_frq} FRQ questions.\n"
                "FRQ rules:\n"
                "  - Ask the student to explain, compare, or apply a concept from the list above\n"
                "  - Each expected_answer must be a complete, accurate explanation (2–4 sentences)\n"
                "  - Do NOT ask students to list titles, authors, or sources\n"
            )

        return (
            "You are building a study test. Use ONLY the terms, definitions, and concepts "
            "below as source material — do not invent facts.\n\n"
            f"{context_header}"
            f"{terms_block}"
            f"{concepts_block}"
            f"{mcq_instructions}\n"
            f"{frq_instructions}\n"
            "Return JSON only with keys mcq and frq.\n"
            "mcq items: {question_text, options: [4 strings], correct_index: 0-3}\n"
            "frq items: {question_text, expected_answer}\n"
        )

    async def parse_practice_test(
        self,
        content: str,
        count_mcq: int = 0,
        count_frq: int = 0,
    ) -> tuple[list[GeneratedMCQ], list[GeneratedFRQ]]:
        """Extract questions from an uploaded practice test document."""
        cleaned = self._strip_metadata(content)
        prompt = (
            "Read the following practice test document and extract every question you find.\n"
            "For multiple-choice questions: extract the question text, all answer options (exactly 4), "
            "and which option is correct (0-indexed as correct_index).\n"
            "For free-response/short-answer questions: extract the question text and any provided "
            "sample answer or answer key (as expected_answer). If no sample answer is given, "
            "write a concise expected answer based on the question context.\n\n"
            "Return JSON only with keys mcq and frq.\n"
            "mcq items: {question_text, options: [4 strings], correct_index: 0-3}\n"
            "frq items: {question_text, expected_answer}\n\n"
            f"PRACTICE TEST:\n{cleaned[:_EXTRACT_CHAR_LIMIT]}"
        )
        try:
            data = await self._complete_json(prompt)
            mcq_raw = data.get("mcq", [])
            frq_raw = data.get("frq", [])
            mcq: list[GeneratedMCQ] = []
            frq: list[GeneratedFRQ] = []
            if isinstance(mcq_raw, list):
                for item in mcq_raw:
                    if self._is_valid_mcq(item):
                        options = [str(o) for o in item["options"]][:4]  # type: ignore[index]
                        mcq.append(GeneratedMCQ(
                            question_text=str(item.get("question_text", "")),  # type: ignore[union-attr]
                            options=options,
                            correct_index=max(0, min(3, int(item.get("correct_index", 0)))),  # type: ignore[union-attr]
                        ))
            if isinstance(frq_raw, list):
                for item in frq_raw:
                    if self._is_valid_frq(item):
                        frq.append(GeneratedFRQ(
                            question_text=str(item.get("question_text", "")),  # type: ignore[union-attr]
                            expected_answer=str(item.get("expected_answer", "")),  # type: ignore[union-attr]
                        ))
            if count_mcq > 0:
                mcq = mcq[:count_mcq]
            if count_frq > 0:
                frq = frq[:count_frq]
            logger.info("Parsed practice test: %d MCQ, %d FRQ", len(mcq), len(frq))
            return mcq, frq
        except Exception as exc:
            logger.warning("Practice test parsing failed: %s", exc)
            return [], []

    async def grade_frq_answer(
        self,
        notes: str,
        question: str,
        expected_answer: str,
        user_answer: str,
    ) -> FRQGrade:
        prompt = f"""
You are a grading assistant. Grade ONLY from the provided notes.

NOTES:
{notes[:12000]}

QUESTION:
{question}

EXPECTED ANSWER:
{expected_answer}

USER ANSWER:
{user_answer}

Return JSON only:
{{"is_correct": true/false, "feedback": "brief explanation", "flagged_uncertain": true/false, "confidence": 0.0-1.0}}
If the notes do not support grading, set flagged_uncertain true and confidence 0.0.
"""
        try:
            data = await self._complete_json(prompt)
            return FRQGrade(
                is_correct=bool(data.get("is_correct", False)),
                feedback=str(data.get("feedback", ""))[:2000],
                flagged_uncertain=bool(data.get("flagged_uncertain", False)),
                confidence=max(0.0, min(1.0, float(data.get("confidence", 0.0)))),
            )
        except Exception as exc:
            logger.warning("LLM FRQ grading failed; using simple fallback: %s", exc)
            return self._fallback_grade(expected_answer, user_answer)

    def _build_math_generation_prompt(
        self, notes: str, count_mcq: int, count_frq: int, test_type: str
    ) -> str:
        mcq_block = ""
        if count_mcq > 0 and test_type != "FRQ_only":
            mcq_block = (
                f"Generate exactly {count_mcq} MCQ math problems.\n"
                "MCQ rules:\n"
                "  - Each question must be a concrete calculation or problem-solving question\n"
                "  - All 4 answer options must be plausible numeric or algebraic expressions\n"
                "  - Only one option is correct\n"
                "  - Vary difficulty: some straightforward, some multi-step\n"
            )
        frq_block = ""
        if count_frq > 0 and test_type != "MCQ_only":
            frq_block = (
                f"Generate exactly {count_frq} FRQ math problems.\n"
                "FRQ rules:\n"
                "  - Ask the student to solve a problem and show their work\n"
                "  - expected_answer must include the complete worked solution with numbered steps\n"
                "  - Use phrases like 'Solve for x:', 'Simplify:', 'Find the value of:'\n"
                "  - Vary question types: equations, simplification, word problems\n"
            )
        return (
            "You are generating math practice problems based on the following study notes.\n"
            "Create problems that test mathematical understanding and calculation skills.\n\n"
            f"{mcq_block}\n"
            f"{frq_block}\n"
            "Return JSON only with keys mcq and frq.\n"
            "mcq items: {question_text, options: [4 strings], correct_index: 0-3}\n"
            "frq items: {question_text, expected_answer}\n\n"
            f"MATH NOTES:\n{notes[:_GENERATE_CHAR_LIMIT]}"
        )

    async def grade_math_answer(
        self,
        question: str,
        expected_answer: str,
        user_answer: str,
    ) -> FRQGrade:
        prompt = f"""You are grading a math problem. Evaluate the student's answer carefully.

QUESTION:
{question}

CORRECT SOLUTION:
{expected_answer}

STUDENT'S ANSWER:
{user_answer}

Determine if the student's final answer is mathematically correct (even if written differently).
Then return JSON only with these exact keys:
{{
  "is_correct": true or false,
  "what_went_right": "brief description of what the student did correctly (empty string if nothing)",
  "what_went_wrong": "brief description of the error (empty string if correct)",
  "steps": [
    {{"step": 1, "description": "step description", "expression": "math expression or equation for this step"}},
    {{"step": 2, ...}}
  ],
  "final_answer": "the correct final answer",
  "confidence": 0.0 to 1.0,
  "flagged_uncertain": true or false
}}

Rules:
- Accept equivalent forms (e.g. x=4 and 4 are equivalent for "solve for x: ... = 4")
- steps must walk through the complete solution from start to finish
- Be specific in what_went_right and what_went_wrong
"""
        try:
            data = await self._complete_json(prompt)
            is_correct = bool(data.get("is_correct", False))
            what_right = str(data.get("what_went_right", "")).strip()
            what_wrong = str(data.get("what_went_wrong", "")).strip()
            steps_raw = data.get("steps", [])
            final_answer = str(data.get("final_answer", "")).strip()
            confidence = max(0.0, min(1.0, float(data.get("confidence", 0.5))))
            flagged = bool(data.get("flagged_uncertain", False))

            # Build structured markdown feedback
            sections: list[str] = []
            if what_right:
                sections.append(f"**What you got right:** {what_right}")
            if what_wrong:
                sections.append(f"**What to fix:** {what_wrong}")

            if isinstance(steps_raw, list) and steps_raw:
                sections.append("\n**Step-by-step solution:**")
                for item in steps_raw:
                    if not isinstance(item, dict):
                        continue
                    num = item.get("step", "")
                    desc = str(item.get("description", "")).strip()
                    expr = str(item.get("expression", "")).strip()
                    if desc:
                        line = f"**Step {num}:** {desc}"
                        if expr:
                            line += f"\n`{expr}`"
                        sections.append(line)

            if final_answer:
                sections.append(f"\n**Final answer:** `{final_answer}`")

            feedback = "\n\n".join(sections)
            return FRQGrade(
                is_correct=is_correct,
                feedback=feedback[:4000],
                flagged_uncertain=flagged,
                confidence=confidence,
            )
        except Exception as exc:
            logger.warning("LLM math grading failed; using fallback: %s", exc)
            return self._fallback_grade(expected_answer, user_answer)

    async def generate_flashcards(
        self, content: str, count: int, prompt: str | None = None
    ) -> list[GeneratedFlashcard]:
        llm_prompt = (
            f"Generate {count} flashcards. Return JSON only with key flashcards, "
            "an array of objects with front and back.\n"
            f"TOPIC: {prompt or 'Use the provided study content'}\nCONTENT:\n{content[:12000]}"
        )
        try:
            data = await self._complete_json(llm_prompt)
            cards = data.get("flashcards", [])
            if not isinstance(cards, list):
                raise ValueError("flashcards was not a list")
            parsed = [
                GeneratedFlashcard(front=str(card.get("front", "")), back=str(card.get("back", "")))
                for card in cards
                if isinstance(card, dict) and card.get("front") and card.get("back")
            ]
            return parsed[:count] or self._fallback_flashcards(content, count, prompt)
        except Exception as exc:
            logger.warning("LLM flashcard generation failed; using fallback: %s", exc)
            return self._fallback_flashcards(content, count, prompt)

    async def call_kojo(self, prompt: str) -> str:
        try:
            if settings.groq_api_key:
                return await self._complete_text_groq(prompt)
            return await self._complete_text_ollama(prompt)
        except Exception as exc:
            from src.utils.exceptions import LLMException
            raise LLMException(f"Kojo error: {exc}") from exc

    async def _complete_text_ollama(self, prompt: str) -> str:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            response = await client.post(
                f"{settings.ollama_base_url.rstrip('/')}/api/generate",
                json={
                    "model": settings.ollama_model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"num_predict": settings.llm_max_tokens},
                },
            )
            response.raise_for_status()
        return str(response.json().get("response", "")).strip()

    async def _complete_text_groq(self, prompt: str) -> str:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                json={
                    "model": "llama-3.1-8b-instant",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.7,
                    "max_tokens": settings.llm_max_tokens,
                },
            )
            response.raise_for_status()
        return str(response.json()["choices"][0]["message"]["content"]).strip()

    async def _complete_json(self, prompt: str) -> dict[str, object]:
        if settings.groq_api_key:
            return await self._complete_groq(prompt)
        return await self._complete_ollama(prompt)

    async def _complete_ollama(self, prompt: str) -> dict[str, object]:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            response = await client.post(
                f"{settings.ollama_base_url.rstrip('/')}/api/generate",
                json={
                    "model": settings.ollama_model,
                    "prompt": prompt,
                    "stream": False,
                    "format": "json",
                    "options": {"num_predict": settings.llm_max_tokens},
                },
            )
            response.raise_for_status()
            payload = response.json()
        return self._loads_json(str(payload.get("response", "{}")))

    async def _complete_groq(self, prompt: str) -> dict[str, object]:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            response = await client.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                json={
                    "model": "llama-3.1-8b-instant",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.2,
                    "max_tokens": settings.llm_max_tokens,
                    "response_format": {"type": "json_object"},
                },
            )
            response.raise_for_status()
            payload = response.json()
        content = payload["choices"][0]["message"]["content"]
        return self._loads_json(str(content))

    def _loads_json(self, raw: str) -> dict[str, object]:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", raw, flags=re.DOTALL)
            if match is None:
                raise
            parsed = json.loads(match.group(0))
        if not isinstance(parsed, dict):
            raise ValueError("LLM response was not a JSON object")
        return parsed

    def _is_valid_mcq(self, item: object) -> bool:
        if not isinstance(item, dict):
            return False
        options = item.get("options")
        if not isinstance(options, list) or len(options) < 4:
            return False
        question = str(item.get("question_text", ""))
        if re.search(r"which statement is supported", question, re.IGNORECASE):
            return False
        for text in [question] + [str(o) for o in options]:
            if "---" in text or text.strip().startswith("#") or len(text) > 400:
                return False
            if re.match(r"^[a-z][a-z_]+:\s", text.strip()):
                return False
        return bool(question.strip())

    def _is_valid_frq(self, item: object) -> bool:
        if not isinstance(item, dict):
            return False
        question = str(item.get("question_text", "")).strip()
        answer = str(item.get("expected_answer", "")).strip()
        if not question or not answer:
            return False
        if re.match(r"explain this idea from the notes:", question, re.IGNORECASE):
            return False
        if "---" in question[:100] or question.startswith("#"):
            return False
        return True

    def _parse_generated_test(
        self, data: dict[str, object], count_mcq: int, count_frq: int, notes: str
    ) -> tuple[list[GeneratedMCQ], list[GeneratedFRQ]]:
        mcq_raw = data.get("mcq", [])
        frq_raw = data.get("frq", [])
        mcq: list[GeneratedMCQ] = []
        frq: list[GeneratedFRQ] = []
        if isinstance(mcq_raw, list):
            for item in mcq_raw:
                if self._is_valid_mcq(item):
                    options = [str(o) for o in item["options"]][:4]  # type: ignore[index]
                    mcq.append(
                        GeneratedMCQ(
                            question_text=str(item.get("question_text", "Study question")),  # type: ignore[union-attr]
                            options=options,
                            correct_index=max(0, min(3, int(item.get("correct_index", 0)))),  # type: ignore[union-attr]
                        )
                    )
        if isinstance(frq_raw, list):
            for item in frq_raw:
                if self._is_valid_frq(item):
                    frq.append(
                        GeneratedFRQ(
                            question_text=str(item.get("question_text", "")).strip(),  # type: ignore[union-attr]
                            expected_answer=str(item.get("expected_answer", "")).strip(),  # type: ignore[union-attr]
                        )
                    )
        if len(mcq) < count_mcq or len(frq) < count_frq:
            fallback_mcq, fallback_frq = self._fallback_questions(notes, count_mcq, count_frq)
            mcq = (mcq + fallback_mcq)[:count_mcq]
            frq = (frq + fallback_frq)[:count_frq]
        return mcq[:count_mcq], frq[:count_frq]

    def _fallback_questions(
        self, notes: str, count_mcq: int, count_frq: int
    ) -> tuple[list[GeneratedMCQ], list[GeneratedFRQ]]:
        snippets = self._sentences(notes)
        if not snippets:
            snippets = ["Review the uploaded notes and identify the most important idea."]
        mcq = [
            GeneratedMCQ(
                question_text=f"Which statement is supported by the notes? ({index + 1})",
                options=[
                    snippets[index % len(snippets)],
                    "A detail that is not established in the uploaded notes.",
                    "A conclusion unrelated to the provided material.",
                    "An unsupported definition not found in the notes.",
                ],
                correct_index=0,
            )
            for index in range(count_mcq)
        ]
        frq = [
            GeneratedFRQ(
                question_text=f"Explain this idea from the notes: {snippets[index % len(snippets)][:120]}",
                expected_answer=snippets[index % len(snippets)],
            )
            for index in range(count_frq)
        ]
        return mcq, frq

    def _fallback_grade(self, expected_answer: str, user_answer: str) -> FRQGrade:
        expected_terms = {word.lower() for word in re.findall(r"[A-Za-z]{4,}", expected_answer)}
        user_terms = {word.lower() for word in re.findall(r"[A-Za-z]{4,}", user_answer)}
        overlap = len(expected_terms & user_terms)
        confidence = overlap / max(1, min(len(expected_terms), 8))
        is_correct = confidence >= settings.llm_uncertainty_threshold
        return FRQGrade(
            is_correct=is_correct,
            feedback="Graded with keyword overlap because the LLM was unavailable.",
            flagged_uncertain=True,
            confidence=max(0.0, min(1.0, confidence)),
        )

    def _fallback_flashcards(
        self, content: str, count: int, prompt: str | None = None
    ) -> list[GeneratedFlashcard]:
        snippets = self._sentences(content or prompt or "Study this topic")
        return [
            GeneratedFlashcard(
                front=f"What should you remember about item {index + 1}?",
                back=snippets[index % len(snippets)],
            )
            for index in range(count)
        ]

    def _strip_metadata(self, notes: str) -> str:
        # Remove [filename] document markers added by the repository
        cleaned = re.sub(r"^\[.+\]\s*$", "", notes, flags=re.MULTILINE)
        # Remove single-line --- label --- markers (e.g. --- Document 1: file.md ---)
        cleaned = re.sub(r"^---[^-\n].+---\s*$", "", cleaned, flags=re.MULTILINE)
        # Remove YAML frontmatter blocks (--- ... ---), possibly multiple in one string
        cleaned = re.sub(r"(?sm)^---\s*\n.*?\n---\s*$", "", cleaned)
        # Remove any remaining standalone horizontal rule lines
        cleaned = re.sub(r"^[-*=]{3,}\s*$", "", cleaned, flags=re.MULTILINE)
        # Collapse excess blank lines
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
        return cleaned.strip()

    def _sentences(self, content: str) -> list[str]:
        content = self._strip_metadata(content)
        raw = [s.strip() for s in re.split(r"(?<=[.!?])\s+", content) if s.strip()]
        return [
            s[:500]
            for s in raw
            if len(s) > 20
            and not s.startswith("#")
            and "---" not in s
            and not re.match(r"^[a-z][a-z_]+:\s", s)
        ][:50]
