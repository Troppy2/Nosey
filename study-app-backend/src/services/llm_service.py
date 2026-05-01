from __future__ import annotations

import asyncio
import hashlib
import json
from math import sqrt
import re
from fractions import Fraction
from dataclasses import dataclass

import httpx

from src.config import settings
from src.schemas.attempt_schema import FRQGrade
from src.utils.logger import get_logger
from typing import Any, Optional

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
_RETRIEVAL_EMBEDDING_DIM = 384
_RETRIEVAL_CHUNK_WORDS = 160
_RETRIEVAL_CHUNK_OVERLAP_WORDS = 40
_RETRIEVAL_TOP_K = 6
_AI_SERVICES_UNAVAILABLE_MESSAGE = (
    "An error has occurred. Test generation can't happen right now because AI services are unavailable."
)

# Matches any meaningful math content: numbers, operators, LaTeX commands, KaTeX delimiters
_MATH_CONTENT_RE = re.compile(
    r"\$|\d+[\./]\d+|[+\-*/=^<>%]|\\(?:frac|sqrt|int|sum|lim|sin|cos|tan|log|ln|pi|theta|alpha|beta|infty|vec|hat)"
    r"|\b(?:solve|simplify|evaluate|calculate|compute|differentiate|integrate|factor|expand)\b",
    re.IGNORECASE,
)


class LLMService:
    def __init__(self) -> None:
        self._last_generation_meta: dict[str, object] = {
            "fallback_used": False,
            "fallback_reason": None,
            "note_grounded": True,
            "retrieval_enabled": False,
            "retrieval_total_chunks": 0,
            "retrieval_selected_chunks": 0,
            "retrieval_top_k": 0,
            "retrieval_query": "",
        }

    def get_last_generation_meta(self) -> dict[str, object]:
        return dict(self._last_generation_meta)

    def _set_last_generation_meta(self, meta: dict[str, object]) -> None:
        merged = dict(self._last_generation_meta)
        merged.update(meta)
        self._last_generation_meta = merged

    async def generate_test_questions(
        self,
        notes: str,
        test_type: str,
        count_mcq: int = 10,
        count_frq: int = 5,
        is_math_mode: bool = False,
        difficulty: str = "mixed",
        topic_focus: Optional[str] = None,
        is_coding_mode: bool = False,
        coding_language: Optional[str] = None,
        custom_instructions: Optional[str] = None,
        provider: Optional[str] = None,
    ) -> tuple[list[GeneratedMCQ], list[GeneratedFRQ]]:
        if test_type == "MCQ_only":
            count_frq = 0
        elif test_type == "FRQ_only":
            count_mcq = 0

        # Strip file metadata (YAML frontmatter, doc markers) before any LLM pass.
        cleaned = self._strip_metadata(notes)
        retrieval_query = self._build_retrieval_query(
            test_type=test_type,
            is_math_mode=is_math_mode,
            is_coding_mode=is_coding_mode,
            coding_language=coding_language,
            difficulty=difficulty,
            topic_focus=topic_focus,
            custom_instructions=custom_instructions,
        )
        # Run CPU-bound RAG retrieval in a thread pool to avoid blocking the event loop
        loop = asyncio.get_event_loop()
        generation_notes, retrieval_meta = await loop.run_in_executor(
            None, self._retrieve_relevant_context, cleaned, retrieval_query, _RETRIEVAL_TOP_K
        )
        diagnostics: dict[str, object] = {
            "fallback_used": False,
            "fallback_reason": None,
            "note_grounded": True,
            "retrieval_query": retrieval_query,
            **retrieval_meta,
        }

        provider_candidates = await self._candidate_providers(provider)
        if not provider_candidates:
            from src.utils.exceptions import LLMException
            raise LLMException(
                "No AI provider is available. Add an API key in Settings or start Ollama."
            )

        if is_coding_mode:
            lang = coding_language or "Python"
            prompt = self._build_coding_generation_prompt(
                generation_notes,
                count_mcq,
                count_frq,
                test_type,
                lang,
                difficulty=difficulty,
                topic_focus=topic_focus,
                custom_instructions=custom_instructions,
            )
            return await self._generate_test_attempts(
                prompt=prompt,
                provider_candidates=provider_candidates,
                notes=cleaned,
                count_mcq=count_mcq,
                count_frq=count_frq,
                diagnostics=diagnostics,
            )

        if is_math_mode:
            prompt = self._build_math_generation_prompt(
                generation_notes,
                count_mcq,
                count_frq,
                test_type,
                difficulty=difficulty,
                topic_focus=topic_focus,
                custom_instructions=custom_instructions,
            )
            try:
                return await self._generate_test_attempts(
                    prompt=prompt,
                    provider_candidates=provider_candidates,
                    notes=cleaned,
                    count_mcq=count_mcq,
                    count_frq=count_frq,
                    diagnostics=diagnostics,
                    math_mode=True,
                )
            except Exception:
                diagnostics.update({
                    "fallback_used": True,
                    "fallback_reason": "llm_exception_math",
                    "note_grounded": False,
                })
                self._set_last_generation_meta(diagnostics)
                return self._fallback_math_questions(cleaned, count_mcq, count_frq)

        try:
            mcq, frq = await self._generate_test_attempts(
                prompt=None,
                provider_candidates=provider_candidates,
                notes=cleaned,
                count_mcq=count_mcq,
                count_frq=count_frq,
                diagnostics=diagnostics,
                generation_notes=generation_notes,
                difficulty=difficulty,
                topic_focus=topic_focus,
                custom_instructions=custom_instructions,
            )
        except Exception:
            mcq, frq = [], []

        if len(mcq) < count_mcq or len(frq) < count_frq:
            diagnostics.update({
                "fallback_used": True,
                "fallback_reason": "llm_output_invalid_or_insufficient",
                "note_grounded": False,
            })
            self._set_last_generation_meta(diagnostics)
            fallback_mcq, fallback_frq = self._fallback_questions(cleaned, count_mcq, count_frq)
            mcq = (mcq + fallback_mcq)[:count_mcq]
            frq = (frq + fallback_frq)[:count_frq]

        return mcq, frq

    async def _extract_study_content(self, notes: str, provider: Optional[str] = None) -> _StudyContent:
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
            data = await self._complete_json(prompt, provider=provider)
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
        self,
        study: _StudyContent,
        count_mcq: int,
        count_frq: int,
        difficulty: str = "mixed",
        topic_focus: Optional[str] = None,
        custom_instructions: Optional[str] = None,
    ) -> str:
        context_header = f'SUBJECT: "{study.title}"\n\n' if study.title else ""

        difficulty_map = {
            "easy": "straightforward recall questions — definitions, simple identification",
            "medium": "application questions — use the concept, connect ideas",
            "hard": "analysis and synthesis — compare, evaluate, multi-step reasoning",
            "mixed": "a mix of easy recall, medium application, and hard analysis questions",
        }
        difficulty_line = f"DIFFICULTY: {difficulty_map.get(difficulty, difficulty_map['mixed'])}\n\n"

        topic_line = f'TOPIC FOCUS: Only generate questions about "{topic_focus}".\n\n' if topic_focus else ""
        custom_line = f"CUSTOM INSTRUCTIONS: {custom_instructions}\n\n" if custom_instructions else ""

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
                "  - Vary question style according to the difficulty level above\n"
            )

        frq_instructions = ""
        if count_frq > 0:
            frq_instructions = (
                f"Generate exactly {count_frq} FRQ questions.\n"
                "FRQ rules:\n"
                "  - Ask the student to explain, compare, or apply a concept from the list above\n"
                "  - Each expected_answer must be a complete, accurate explanation (2–4 sentences)\n"
                "  - Do NOT ask students to list titles, authors, or sources\n"
                "  - Match difficulty level above\n"
            )

        return (
            "You are building a study test. Use ONLY the terms, definitions, and concepts "
            "below as source material — do not invent facts.\n\n"
            f"{context_header}"
            f"{difficulty_line}"
            f"{topic_line}"
            f"{custom_line}"
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
        provider: Optional[str] = None,
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
        provider_candidates = await self._candidate_providers(provider)
        if not provider_candidates:
            from src.utils.exceptions import LLMException

            raise LLMException(_AI_SERVICES_UNAVAILABLE_MESSAGE)

        last_error: Optional[Exception] = None
        for candidate in provider_candidates:
            try:
                data = await self._complete_json(prompt, provider=candidate)
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
                if not (count_mcq == 0 and count_frq == 0):
                    mcq = mcq[: max(0, int(count_mcq))]
                    frq = frq[: max(0, int(count_frq))]
                if mcq or frq or (count_mcq == 0 and count_frq == 0):
                    logger.info("Parsed practice test: %d MCQ, %d FRQ", len(mcq), len(frq))
                    return mcq, frq
                logger.warning("Provider %s returned no practice-test questions; trying next provider", candidate)
            except Exception as exc:
                last_error = exc
                logger.warning("Practice test parsing failed with %s; trying next provider: %s", candidate, exc)

        logger.warning("parse_practice_test: all providers failed, returning empty result")
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

    def _build_coding_generation_prompt(
        self,
        notes: str,
        count_mcq: int,
        count_frq: int,
        test_type: str,
        language: str,
        difficulty: str = "mixed",
        topic_focus: Optional[str] = None,
        custom_instructions: Optional[str] = None,
    ) -> str:
        difficulty_map = {
            "easy": "basic syntax and single-function problems",
            "medium": "multi-step algorithms and data structure usage",
            "hard": "complex algorithms, optimization, and system design",
            "mixed": "a range from basic to advanced",
        }
        difficulty_line = f"DIFFICULTY: {difficulty_map.get(difficulty, difficulty_map['mixed'])}\n"
        topic_line = f'TOPIC FOCUS: Only generate problems about "{topic_focus}".\n' if topic_focus else ""
        custom_line = f"CUSTOM INSTRUCTIONS: {custom_instructions}\n" if custom_instructions else ""

        mcq_block = ""
        if count_mcq > 0 and test_type != "FRQ_only":
            mcq_block = (
                f"Generate exactly {count_mcq} MCQ coding questions.\n"
                "MCQ rules:\n"
                f"  - Questions about {language} syntax, built-in functions, time/space complexity, or CS concepts\n"
                "  - 4 answer options, only one is correct\n"
                "  - Vary from conceptual to tricky code-reading questions\n"
            )
        frq_block = ""
        if count_frq > 0 and test_type != "MCQ_only":
            frq_block = (
                f"Generate exactly {count_frq} coding challenge questions.\n"
                "Coding challenge rules:\n"
                f"  - Each question must be a programming task solvable in {language}\n"
                "  - question_text must include: problem description, input format, output format, and 1-2 examples\n"
                f"  - expected_answer must include: complete working {language} solution with brief comments\n"
                "  - Vary: functions, loops, data structures, algorithms\n"
            )
        return (
            f"You are generating {language} programming practice questions based on the following CS notes.\n\n"
            f"{difficulty_line}"
            f"{topic_line}"
            f"{custom_line}\n"
            f"{mcq_block}\n"
            f"{frq_block}\n"
            "Return JSON only with keys mcq and frq.\n"
            "mcq items: {question_text, options: [4 strings], correct_index: 0-3}\n"
            "frq items: {question_text, expected_answer}\n\n"
            f"CS NOTES:\n{notes[:_GENERATE_CHAR_LIMIT]}"
        )

    async def grade_code_answer(
        self,
        question: str,
        expected_answer: str,
        user_code: str,
        language: str = "Python",
    ) -> FRQGrade:
        prompt = f"""You are a CS instructor grading a coding assignment.

LANGUAGE: {language}

PROBLEM:
{question}

REFERENCE SOLUTION:
{expected_answer}

STUDENT'S CODE:
{user_code}

Evaluate the student's code for:
1. Correctness — does it solve the problem as described?
2. Logic — is the approach sound even if syntax is slightly off?
3. Edge cases — does it handle the given examples?

Return JSON only with these exact keys:
{{
  "is_correct": true or false,
  "what_went_right": "what the student did well (empty string if nothing)",
  "what_went_wrong": "specific bugs or issues (empty string if correct)",
  "improvements": ["suggestion 1", "suggestion 2"],
  "corrected_snippet": "short corrected version or key fix (empty string if fully correct)",
  "time_complexity": "O(?) with brief explanation",
  "confidence": 0.0 to 1.0,
  "flagged_uncertain": true or false
}}

Be lenient on minor syntax errors if the logic is correct. Accept equivalent solutions.
"""
        try:
            data = await self._complete_json(prompt)
            is_correct = bool(data.get("is_correct", False))
            what_right = str(data.get("what_went_right", "")).strip()
            what_wrong = str(data.get("what_went_wrong", "")).strip()
            improvements = data.get("improvements", [])
            corrected = str(data.get("corrected_snippet", "")).strip()
            complexity = str(data.get("time_complexity", "")).strip()
            confidence = max(0.0, min(1.0, float(data.get("confidence", 0.5))))
            flagged = bool(data.get("flagged_uncertain", False))

            sections: list[str] = []
            if what_right:
                sections.append(f"**What you did well:** {what_right}")
            if what_wrong:
                sections.append(f"**Issues found:** {what_wrong}")
            if isinstance(improvements, list) and improvements:
                items = "\n".join(f"- {s}" for s in improvements if isinstance(s, str))
                sections.append(f"**Suggestions:**\n{items}")
            if corrected:
                sections.append(f"**Key fix:**\n```{language.lower()}\n{corrected}\n```")
            if complexity:
                sections.append(f"**Time complexity:** {complexity}")

            feedback = "\n\n".join(sections)
            return FRQGrade(
                is_correct=is_correct,
                feedback=feedback[:4000],
                flagged_uncertain=flagged,
                confidence=confidence,
            )
        except Exception as exc:
            logger.warning("LLM code grading failed; using fallback: %s", exc)
            return self._fallback_grade(expected_answer, user_code)

    def _build_math_generation_prompt(
        self,
        notes: str,
        count_mcq: int,
        count_frq: int,
        test_type: str,
        difficulty: str = "mixed",
        topic_focus: Optional[str] = None,
        custom_instructions: Optional[str] = None,
    ) -> str:
        latex_rule = (
            "KATEX RENDERING RULES — follow exactly:\n"
            "  - This interface renders math using KaTeX. Wrap ALL math in dollar signs.\n"
            "  - Inline math: $expression$ — e.g. $\\frac{dx}{dt}$, $x^{2} + y^{2}$, $\\sqrt{x}$\n"
            "  - Block/display math: $$expression$$ — use for standalone equations\n"
            "  - Example question: 'Find $\\frac{dx}{dt}$ when $x = t^{3} + t$ at $t = 2$'\n"
            "  - Example MCQ option: '$3t^{2} + 1$' or '$\\frac{1}{2}$'\n"
            "  - Do NOT write bare math like x^2 or x² — always wrap in $...$\n"
            "  - Do NOT write fractions as a/b — write $\\frac{a}{b}$\n"
        )
        strict_math_rules = (
            "STRICT CONTENT RULES:\n"
            "  - Generate ONLY mathematical computation problems — the student must compute a specific numerical or algebraic answer\n"
            "  - Every question MUST require calculation or algebraic manipulation, not memorization or explanation\n"
            "  - ABSOLUTELY BANNED question types: 'Explain...', 'Describe...', 'What is the formula for...', 'How do you find...', 'Why does...', 'Define...'\n"
            "  - If the notes describe a formula (e.g. arc length), generate a problem that USES that formula on specific numbers — do not ask the student to state the formula\n"
            "  - If the notes contain non-mathematical text, IGNORE it entirely\n"
            "  - If math content is sparse, infer solvable problems from the mathematical topics mentioned\n"
        )
        mcq_block = ""
        if count_mcq > 0 and test_type != "FRQ_only":
            mcq_block = (
                f"Generate exactly {count_mcq} MCQ math problems.\n"
                "MCQ rules:\n"
                "  - Each question must be a concrete calculation or problem-solving question\n"
                "  - All 4 answer options must be plausible numeric or algebraic expressions wrapped in $...$\n"
                "  - Only one option is correct\n"
                "  - Vary difficulty: some straightforward, some multi-step\n"
            )
        frq_block = ""
        if count_frq > 0 and test_type != "MCQ_only":
            frq_block = (
                f"Generate exactly {count_frq} FRQ math problems.\n"
                "FRQ rules:\n"
                "  - Every question MUST be a specific computation the student must perform — a number or expression is the answer\n"
                "  - BANNED question starters: 'Explain', 'Describe', 'What is', 'What are', 'Define', 'How do you', 'Why', 'State'\n"
                "  - REQUIRED starters (use one): 'Find', 'Solve', 'Evaluate', 'Compute', 'Differentiate', 'Integrate', 'Simplify', 'Calculate'\n"
                "  - BAD example (NEVER do this): 'Explain how to find the tangent line using parametric equations.'\n"
                "  - GOOD example: 'Find $\\frac{dy}{dx}$ for the curve $x = t^{2} + 1$, $y = t^{3} - t$ at $t = 2$.'\n"
                "  - GOOD example: 'Evaluate $\\int_{0}^{3} (2x^{2} + 3x) \\, dx$.'\n"
                "  - GOOD example: 'Solve for $x$: $3x^{2} - 5x + 2 = 0$.'\n"
                "  - expected_answer must show the full worked solution with numbered steps and a final numerical or algebraic result\n"
                "  - Write all math wrapped in $...$\n"
                "  - Vary: derivatives, integrals, algebraic equations, limits, arc length, area under curve, optimization\n"
            )
        difficulty_map = {
            "easy": "basic calculations and single-step problems",
            "medium": "multi-step problems requiring intermediate algebraic or calculus skills",
            "hard": "challenging problems requiring deep reasoning, proof, or advanced techniques",
            "mixed": "a variety from basic to challenging",
        }
        difficulty_line = f"DIFFICULTY: {difficulty_map.get(difficulty, difficulty_map['mixed'])}\n"
        topic_line = f'TOPIC FOCUS: Only generate problems about "{topic_focus}".\n' if topic_focus else ""
        custom_line = f"CUSTOM INSTRUCTIONS: {custom_instructions}\n" if custom_instructions else ""

        return (
            "You are generating math practice problems based on the following study notes.\n"
            "Create problems that test mathematical understanding and calculation skills.\n\n"
            f"{difficulty_line}"
            f"{topic_line}"
            f"{custom_line}"
            f"{strict_math_rules}\n"
            f"{latex_rule}\n"
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
    {{"step": 1, "description": "step description", "expression": "LaTeX math expression for this step"}},
    {{"step": 2, ...}}
  ],
  "final_answer": "the correct final answer in LaTeX",
  "confidence": 0.0 to 1.0,
  "flagged_uncertain": true or false
}}

Rules:
- Accept equivalent forms (e.g. x=4 and 4 are equivalent for "solve for x: ... = 4")
- steps must walk through the complete solution from start to finish
- Write ALL math expressions in LaTeX notation: \\frac{{dy}}{{dx}} = 3t^{{2}} + 1
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

            # Build structured markdown+LaTeX feedback (rendered by MarkdownContent)
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
                            line += f"  $${expr}$$"
                        sections.append(line)

            if final_answer:
                sections.append(f"\n**Final answer:** $${final_answer}$$")

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
        self,
        content: str,
        count: int,
        prompt: Optional[str] = None,
        existing_flashcards: Optional[list[str]] = None,
        provider: Optional[str] = None,
    ) -> list[GeneratedFlashcard]:
        existing_flashcards = [item.strip() for item in (existing_flashcards or []) if item and item.strip()]
        existing_block = ""
        if existing_flashcards:
            existing_lines = "\n".join(f"- {item}" for item in existing_flashcards[:80])
            existing_block = (
                "EXISTING FLASHCARDS TO AVOID DUPLICATING OR REPHRASING:\n"
                f"{existing_lines}\n\n"
            )
        llm_prompt = (
            f"Generate {count} flashcards that are new, specific, and clearly different from any existing cards. Return JSON only with key flashcards, "
            "an array of objects with front and back.\n"
            f"{existing_block}"
            f"TOPIC: {prompt or 'Use the provided study content'}\nCONTENT:\n{content[:12000]}"
        )
        provider_candidates = await self._candidate_providers(provider)
        if not provider_candidates:
            return self._fallback_flashcards(content, count, prompt)
        for candidate in provider_candidates:
            try:
                data = await self._complete_json(llm_prompt, provider=candidate)
                parsed = self._parse_generated_flashcards(data)
                unique = self._dedupe_flashcards(parsed, existing_flashcards)
                if len(unique) < count:
                    retry_prompt = llm_prompt + "\nGenerate only cards that are entirely new compared with the existing list above."
                    retry_data = await self._complete_json(retry_prompt, provider=candidate)
                    unique = self._dedupe_flashcards(
                        unique + self._parse_generated_flashcards(retry_data),
                        existing_flashcards,
                    )
                if unique:
                    return unique[:count]
            except Exception as exc:
                logger.warning("Flashcard generation failed with %s; trying next provider: %s", candidate, exc)
        logger.warning("LLM flashcard generation failed; using fallback")
        return self._fallback_flashcards(content, count, prompt)

    async def _with_retry(self, fn, label: str):
        """Retry a cloud LLM call on 429 with exponential backoff (max 3 attempts)."""
        delay = 1.0
        for attempt in range(3):
            try:
                return await fn()
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 429 and attempt < 2:
                    logger.warning("%s rate-limited; retrying in %.0fs (attempt %d/3)", label, delay, attempt + 1)
                    await asyncio.sleep(delay)
                    delay *= 2
                    continue
                if exc.response.status_code == 429:
                    from src.utils.exceptions import LLMException
                    raise LLMException(
                        f"{label} rate limit reached. Wait a moment and try again, or switch to a different provider."
                    ) from exc
                from src.utils.exceptions import LLMException
                raise LLMException(f"{label} request failed ({exc.response.status_code})") from exc

    def _normalize_generation_provider(self, provider: Optional[str]) -> str:
        value = (provider or getattr(settings, "llm_provider", "auto") or "auto").strip().lower()
        aliases = {
            "google": "gemini",
            "anthropic": "claude",
        }
        return aliases.get(value, value)

    async def _candidate_providers(self, provider: Optional[str] = None) -> list[str]:
        normalized = self._normalize_generation_provider(provider)
        if normalized != "auto":
            return [normalized]

        providers: list[str] = []
        if settings.groq_api_key:
            providers.append("groq")
        if settings.google_ai_api_key:
            providers.append("gemini")
        if settings.anthropic_api_key:
            providers.append("claude")

        status = await self.check_providers_status()
        if status.get("ollama"):
            providers.append("ollama")
        return providers

    async def _generate_test_attempts(
        self,
        prompt: Optional[str],
        provider_candidates: list[str],
        notes: str,
        count_mcq: int,
        count_frq: int,
        diagnostics: dict[str, object],
        generation_notes: Optional[str] = None,
        math_mode: bool = False,
        difficulty: str = "mixed",
        topic_focus: Optional[str] = None,
        custom_instructions: Optional[str] = None,
    ) -> tuple[list[GeneratedMCQ], list[GeneratedFRQ]]:
        from src.utils.exceptions import LLMException

        last_error: Optional[Exception] = None
        best_mcq: list[GeneratedMCQ] = []
        best_frq: list[GeneratedFRQ] = []

        for candidate in provider_candidates:
            try:
                if prompt is None:
                    study = await self._extract_study_content(generation_notes or notes, provider=candidate)
                    prompt_to_use = self._build_generation_prompt(
                        study,
                        count_mcq,
                        count_frq,
                        difficulty=difficulty,
                        topic_focus=topic_focus,
                        custom_instructions=custom_instructions,
                    )
                else:
                    prompt_to_use = prompt

                data = await self._complete_json(prompt_to_use, provider=candidate)
                mcq, frq = self._parse_generated_test(
                    data,
                    count_mcq,
                    count_frq,
                    notes,
                    math_mode=math_mode,
                    diagnostics=diagnostics,
                    allow_fallback=False,
                )
                if len(mcq) >= count_mcq and len(frq) >= count_frq:
                    self._set_last_generation_meta(diagnostics)
                    return mcq[:count_mcq], frq[:count_frq]
                if len(mcq) + len(frq) > len(best_mcq) + len(best_frq):
                    best_mcq, best_frq = mcq, frq
                logger.warning(
                    "Provider %s returned insufficient test output (%d MCQ, %d FRQ of %d/%d requested); trying next provider",
                    candidate, len(mcq), len(frq), count_mcq, count_frq,
                )
            except LLMException:
                raise
            except Exception as exc:
                last_error = exc
                logger.warning("Provider %s failed test generation; trying next provider: %s", candidate, exc)

        if best_mcq or best_frq:
            self._set_last_generation_meta(diagnostics)
            return best_mcq[:count_mcq], best_frq[:count_frq]

        raise LLMException(
            "Practice test could not be generated. The selected AI provider may be rate-limited or temporarily unavailable. "
            "Try a different provider or try again in a moment."
        ) from last_error

    async def _complete_json_for_provider(self, prompt: str, provider: str) -> dict[str, object]:
        from src.utils.exceptions import LLMException

        if provider == "gemini":
            if not settings.google_ai_api_key:
                raise LLMException("Google AI is not configured. Add your Google AI API key in Settings.")
            return await self._complete_gemini(prompt)
        if provider == "groq":
            if not settings.groq_api_key:
                raise LLMException("Groq is not configured. Add your Groq API key in Settings.")
            return await self._complete_groq(prompt)
        if provider == "claude":
            if not settings.anthropic_api_key:
                raise LLMException("Anthropic is not configured. Add your Anthropic API key in Settings.")
            return await self._complete_anthropic(prompt)
        if provider == "ollama":
            return await self._complete_ollama(prompt)
        raise LLMException(f"Unsupported LLM provider: {provider}")

    async def call_kojo(self, prompt: str, provider: Optional[str] = None) -> str:
        from src.utils.exceptions import LLMException

        _TEXT_DISPATCH: dict[str, Any] = {
            "gemini": self._complete_text_gemini,
            "groq": self._complete_text_groq,
            "ollama": self._complete_text_ollama,
            "claude": self._complete_text_anthropic,
        }

        normalized = self._normalize_generation_provider(provider)

        if normalized != "auto":
            fn = _TEXT_DISPATCH.get(normalized)
            if fn is None:
                raise LLMException(f"Unsupported LLM provider: {normalized}")
            try:
                return await fn(prompt)
            except LLMException:
                raise
            except Exception as exc:
                raise LLMException(f"Kojo error: {exc}") from exc

        # auto: try all available providers in order with fallback
        candidates = await self._candidate_providers("auto")
        if not candidates:
            raise LLMException(
                "No AI provider is available. Add an API key in Settings or start Ollama."
            )

        last_error: Optional[Exception] = None
        for candidate in candidates:
            fn = _TEXT_DISPATCH.get(candidate)
            if fn is None:
                continue
            try:
                return await fn(prompt)
            except LLMException:
                raise
            except Exception as exc:
                last_error = exc
                logger.warning("Kojo provider %s failed; trying next: %s", candidate, exc)

        raise LLMException(
            "Kojo failed to generate a response — all providers are unavailable. Try again."
        ) from last_error

    async def _complete_text_gemini(self, prompt: str) -> str:
        async def _do() -> str:
            async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
                response = await client.post(
                    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
                    params={"key": settings.google_ai_api_key},
                    json={
                        "contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": {
                            "maxOutputTokens": settings.llm_max_tokens,
                            "temperature": 0.7,
                        },
                    },
                )
                response.raise_for_status()
            return str(response.json()["candidates"][0]["content"]["parts"][0]["text"]).strip()
        return await self._with_retry(_do, "Gemini")

    async def check_providers_status(self) -> dict:
        ollama_ok = False
        ollama_model_available = False
        if settings.ollama_api_key:
            # Cloud Ollama — API key present means the service is reachable
            ollama_ok = True
            ollama_model_available = bool(settings.ollama_model)
        else:
            try:
                async with httpx.AsyncClient(timeout=5) as client:
                    r = await client.get(f"{settings.ollama_base_url.rstrip('/')}/api/tags")
                    if r.status_code == 200:
                        ollama_ok = True
                        models = [m.get("name", "") for m in r.json().get("models", [])]
                        model_base = settings.ollama_model.split(":")[0]
                        ollama_model_available = any(
                            m == settings.ollama_model or m.startswith(model_base)
                            for m in models
                        )
            except Exception:
                pass
        return {
            "gemini": bool(settings.google_ai_api_key),
            "groq": bool(settings.groq_api_key),
            "claude": bool(settings.anthropic_api_key),
            "ollama": ollama_ok,
            "ollama_model": settings.ollama_model,
            "ollama_model_available": ollama_model_available,
        }

    async def _complete_text_ollama(self, prompt: str) -> str:
        from src.utils.exceptions import LLMException
        try:
            headers = {}
            if settings.ollama_api_key:
                headers["Authorization"] = f"Bearer {settings.ollama_api_key}"
            async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
                response = await client.post(
                    f"{settings.ollama_base_url.rstrip('/')}/api/generate",
                    headers=headers,
                    json={
                        "model": settings.ollama_model,
                        "prompt": prompt,
                        "stream": False,
                        "options": {"num_predict": settings.llm_max_tokens},
                    },
                )
                response.raise_for_status()
            return str(response.json().get("response", "")).strip()
        except httpx.ConnectError:
            raise LLMException(
                f"Ollama is not running at {settings.ollama_base_url}. "
                "Open a terminal and run: ollama serve"
            )
        except httpx.TimeoutException:
            raise LLMException(
                f"Ollama timed out — '{settings.ollama_model}' may still be loading. Try again in a moment."
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise LLMException(
                    f"Ollama model '{settings.ollama_model}' not found. "
                    f"Run: ollama pull {settings.ollama_model}"
                )
            raise LLMException(f"Ollama error ({exc.response.status_code})") from exc

    async def _complete_text_groq(self, prompt: str) -> str:
        async def _do() -> str:
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
        return await self._with_retry(_do, "Groq")

    async def _complete_text_anthropic(self, prompt: str) -> str:
        async def _do() -> str:
            async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
                response = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": settings.anthropic_api_key or "",
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": settings.anthropic_model,
                        "max_tokens": settings.llm_max_tokens,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                )
                response.raise_for_status()
            return str(response.json()["content"][0]["text"]).strip()
        return await self._with_retry(_do, "Claude")

    async def _complete_anthropic(self, prompt: str) -> dict[str, object]:
        async def _do() -> dict[str, object]:
            async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
                response = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": settings.anthropic_api_key or "",
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": settings.anthropic_model,
                        "max_tokens": settings.llm_max_tokens,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                )
                response.raise_for_status()
            content = str(response.json()["content"][0]["text"]).strip()
            return self._loads_json(content)
        return await self._with_retry(_do, "Claude")

    async def _complete_json(self, prompt: str, provider: Optional[str] = None) -> dict[str, object]:
        from src.utils.exceptions import LLMException

        normalized = self._normalize_generation_provider(provider)
        if normalized != "auto":
            return await self._complete_json_for_provider(prompt, normalized)

        candidates = await self._candidate_providers("auto")
        if not candidates:
            raise LLMException(_AI_SERVICES_UNAVAILABLE_MESSAGE)

        last_error: Optional[Exception] = None
        for candidate in candidates:
            try:
                return await self._complete_json_for_provider(prompt, candidate)
            except Exception as exc:
                last_error = exc
                logger.warning("%s JSON generation failed; trying next provider: %s", candidate, exc)
        raise LLMException(_AI_SERVICES_UNAVAILABLE_MESSAGE) from last_error

    async def _complete_gemini(self, prompt: str) -> dict[str, object]:
        async def _do() -> dict[str, object]:
            async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
                response = await client.post(
                    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
                    params={"key": settings.google_ai_api_key},
                    json={
                        "contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": {
                            "maxOutputTokens": settings.llm_max_tokens,
                            "temperature": 0.2,
                            "responseMimeType": "application/json",
                        },
                    },
                )
                response.raise_for_status()
            content = str(response.json()["candidates"][0]["content"]["parts"][0]["text"]).strip()
            return self._loads_json(content)
        return await self._with_retry(_do, "Gemini")

    async def _complete_ollama(self, prompt: str) -> dict[str, object]:
        from src.utils.exceptions import LLMException
        try:
            headers = {}
            if settings.ollama_api_key:
                headers["Authorization"] = f"Bearer {settings.ollama_api_key}"
            async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
                response = await client.post(
                    f"{settings.ollama_base_url.rstrip('/')}/api/generate",
                    headers=headers,
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
        except httpx.ConnectError:
            raise LLMException(
                f"Ollama is not running at {settings.ollama_base_url}. "
                "Open a terminal and run: ollama serve"
            )
        except httpx.TimeoutException:
            raise LLMException(
                f"Ollama timed out — '{settings.ollama_model}' may still be loading. Try again in a moment."
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                raise LLMException(
                    f"Ollama model '{settings.ollama_model}' not found. "
                    f"Run: ollama pull {settings.ollama_model}"
                )
            raise LLMException(f"Ollama error ({exc.response.status_code})") from exc

    async def _complete_groq(self, prompt: str) -> dict[str, object]:
        async def _do() -> dict[str, object]:
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
        return await self._with_retry(_do, "Groq")

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

    def _is_valid_math_mcq(self, item: object) -> bool:
        if not self._is_valid_mcq(item):
            return False
        question = str(item.get("question_text", ""))  # type: ignore[union-attr]
        options = [str(o) for o in item.get("options", [])]  # type: ignore[union-attr]
        if not _MATH_CONTENT_RE.search(question):
            return False
        return bool(options[:4]) and all(_MATH_CONTENT_RE.search(option) for option in options[:4])

    _MATH_FRQ_CONCEPTUAL_RE = re.compile(
        r"^(explain|describe|what\s+is|what\s+are|define|how\s+do\s+you|why\s+(is|does|do|are|would)|state\s+the|"
        r"discuss|summarize|list\s+the|name\s+the)",
        re.IGNORECASE,
    )
    _MATH_FRQ_COMPUTE_RE = re.compile(
        r"^(find|solve|evaluate|compute|differentiate|integrate|simplify|calculate|determine\s+the\s+value|"
        r"use|apply|given|let|for\s+the\s+(curve|function|equation)|if\s+f)",
        re.IGNORECASE,
    )

    def _is_valid_math_frq(self, item: object) -> bool:
        if not self._is_valid_frq(item):
            return False
        question = str(item.get("question_text", "")).strip()
        answer = str(item.get("expected_answer", "")).strip()
        if self._MATH_FRQ_CONCEPTUAL_RE.search(question):
            return False
        has_math = bool(_MATH_CONTENT_RE.search(question) or _MATH_CONTENT_RE.search(answer))
        is_computation = bool(self._MATH_FRQ_COMPUTE_RE.search(question))
        return has_math or is_computation

    def _parse_generated_test(
        self,
        data: dict[str, object],
        count_mcq: int,
        count_frq: int,
        notes: str,
        math_mode: bool = False,
        diagnostics: Optional[dict[str, object]] = None,
        allow_fallback: bool = True,
    ) -> tuple[list[GeneratedMCQ], list[GeneratedFRQ]]:
        mcq_raw = data.get("mcq", [])
        frq_raw = data.get("frq", [])
        mcq: list[GeneratedMCQ] = []
        frq: list[GeneratedFRQ] = []
        mcq_validator = self._is_valid_math_mcq if math_mode else self._is_valid_mcq
        frq_validator = self._is_valid_math_frq if math_mode else self._is_valid_frq
        if isinstance(mcq_raw, list):
            for item in mcq_raw:
                if mcq_validator(item):
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
                if frq_validator(item):
                    frq.append(
                        GeneratedFRQ(
                            question_text=str(item.get("question_text", "")).strip(),  # type: ignore[union-attr]
                            expected_answer=str(item.get("expected_answer", "")).strip(),  # type: ignore[union-attr]
                        )
                    )
        if len(mcq) < count_mcq or len(frq) < count_frq:
            if not allow_fallback:
                return mcq[:count_mcq], frq[:count_frq]
            if diagnostics is not None:
                diagnostics.update({
                    "fallback_used": True,
                    "fallback_reason": "llm_output_invalid_or_insufficient",
                    "note_grounded": False,
                })
            fallback_builder = self._fallback_math_questions if math_mode else self._fallback_questions
            fallback_mcq, fallback_frq = fallback_builder(notes, count_mcq, count_frq)
            mcq = (mcq + fallback_mcq)[:count_mcq]
            frq = (frq + fallback_frq)[:count_frq]
        return mcq[:count_mcq], frq[:count_frq]

    def _build_retrieval_query(
        self,
        test_type: str,
        is_math_mode: bool,
        is_coding_mode: bool,
        coding_language: Optional[str],
        difficulty: str,
        topic_focus: Optional[str],
        custom_instructions: Optional[str],
    ) -> str:
        parts = [
            f"test type {test_type}",
            f"difficulty {difficulty}",
        ]
        if is_math_mode:
            parts.append("math equations algebra calculus problem solving")
        if is_coding_mode:
            parts.append(f"coding programming {coding_language or 'Python'}")
        if topic_focus:
            parts.append(topic_focus)
        if custom_instructions:
            parts.append(custom_instructions)
        return " | ".join(parts)

    def _retrieve_relevant_context(
        self,
        notes: str,
        query: str,
        top_k: int = _RETRIEVAL_TOP_K,
    ) -> tuple[str, dict[str, object]]:
        chunks = self._chunk_notes_for_retrieval(notes)
        meta: dict[str, object] = {
            "retrieval_enabled": True,
            "retrieval_total_chunks": len(chunks),
            "retrieval_selected_chunks": 0,
            "retrieval_top_k": 0,
        }
        if not chunks:
            return notes[:_GENERATE_CHAR_LIMIT], meta

        query_vec = self._embed_text_for_retrieval(query)
        scored: list[tuple[float, int, str]] = []
        for idx, chunk in enumerate(chunks):
            chunk_vec = self._embed_text_for_retrieval(chunk)
            score = self._cosine_similarity(query_vec, chunk_vec)
            scored.append((score, idx, chunk))

        scored.sort(key=lambda item: item[0], reverse=True)
        take = max(1, min(top_k, len(scored)))
        selected = sorted(scored[:take], key=lambda item: item[1])
        meta["retrieval_selected_chunks"] = len(selected)
        meta["retrieval_top_k"] = take

        context_parts = [f"[Retrieved chunk {idx + 1}]\n{chunk}" for _, idx, chunk in selected]
        context = "\n\n".join(context_parts).strip()
        if not context:
            context = notes
        return context[:_GENERATE_CHAR_LIMIT], meta

    def _chunk_notes_for_retrieval(
        self,
        notes: str,
        chunk_words: int = _RETRIEVAL_CHUNK_WORDS,
        overlap_words: int = _RETRIEVAL_CHUNK_OVERLAP_WORDS,
    ) -> list[str]:
        cleaned = self._strip_metadata(notes)
        words = cleaned.split()
        if not words:
            return []
        if len(words) <= chunk_words:
            return [cleaned]

        chunks: list[str] = []
        step = max(1, chunk_words - overlap_words)
        start = 0
        while start < len(words):
            chunk = " ".join(words[start:start + chunk_words]).strip()
            if chunk:
                chunks.append(chunk)
            start += step
        return chunks

    def _embed_text_for_retrieval(self, text: str, dimensions: int = _RETRIEVAL_EMBEDDING_DIM) -> list[float]:
        tokens = self._tokenize_for_retrieval(text)
        if not tokens:
            return [0.0] * dimensions

        vector = [0.0] * dimensions
        for token in tokens:
            digest = hashlib.blake2b(token.encode("utf-8", errors="ignore"), digest_size=8).digest()
            hashed = int.from_bytes(digest, "big", signed=False)
            index = hashed % dimensions
            sign = 1.0 if ((hashed >> 1) & 1) == 0 else -1.0
            vector[index] += sign

        norm = sqrt(sum(value * value for value in vector))
        if norm > 0:
            return [value / norm for value in vector]
        return vector

    def _tokenize_for_retrieval(self, text: str) -> list[str]:
        return [
            token
            for token in re.findall(r"[A-Za-z0-9_]+|[+\-*/^=]", text.lower())
            if token.strip()
        ]

    def _cosine_similarity(self, left: list[float], right: list[float]) -> float:
        return sum(a * b for a, b in zip(left, right))

    @staticmethod
    def _format_fraction_latex(value: Fraction) -> str:
        value = value.limit_denominator()
        if value.denominator == 1:
            return str(value.numerator)
        return f"\\frac{{{value.numerator}}}{{{value.denominator}}}"

    def _fallback_math_questions(
        self, notes: str, count_mcq: int, count_frq: int
    ) -> tuple[list[GeneratedMCQ], list[GeneratedFRQ]]:
        # Build deterministic algebra problems so math mode never falls back to generic reading-comprehension prompts.
        mcq: list[GeneratedMCQ] = []
        frq: list[GeneratedFRQ] = []

        for index in range(count_mcq):
            a = (index % 5) + 2
            b = (index % 7) + 1
            correct = Fraction(-b, a)
            distractors = [
                Fraction(b, a),
                Fraction(-b, a + 1),
                Fraction(-(b + 1), a),
                Fraction(-b - a, a),
            ]
            wrong_options: list[Fraction] = []
            for option in distractors:
                if option != correct and option not in wrong_options:
                    wrong_options.append(option)
                if len(wrong_options) == 3:
                    break
            while len(wrong_options) < 3:
                wrong_options.append(Fraction(-(b + len(wrong_options) + 2), a))
            all_answers = [correct, *wrong_options]
            correct_index = index % 4
            ordered_answers = all_answers[correct_index:] + all_answers[:correct_index]
            mcq.append(
                GeneratedMCQ(
                    question_text=f"Solve for $x$: $0 = {a}x + {b}$.",
                    options=[
                        f"$x = {self._format_fraction_latex(answer)}$"
                        for answer in ordered_answers
                    ],
                    correct_index=0 if correct_index == 0 else 4 - correct_index,
                )
            )

        for index in range(count_frq):
            a = (index % 4) + 2
            b = (index % 6) + 1
            c = (index % 5) + 5
            solution = Fraction(c - b, a)
            solution_latex = self._format_fraction_latex(solution)
            frq.append(
                GeneratedFRQ(
                    question_text=f"Solve for $x$: ${a}x + {b} = {c}$.",
                    expected_answer=(
                        "1. Subtract "
                        f"${b}$ from both sides: ${a}x = {c - b}$.\n"
                        f"2. Divide both sides by ${a}$: $x = \\frac{{{c - b}}}{{{a}}}$.\n"
                        f"3. Simplify: $x = {solution_latex}$."
                    ),
                )
            )

        if not mcq and not frq:
            logger.info("Math fallback produced no questions (requested 0 MCQ and 0 FRQ)")
        return mcq, frq

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
        self, content: str, count: int, prompt: Optional[str] = None
    ) -> list[GeneratedFlashcard]:
        snippets = self._sentences(content or prompt or "Study this topic")
        return [
            GeneratedFlashcard(
                front=f"What should you remember about item {index + 1}?",
                back=snippets[index % len(snippets)],
            )
            for index in range(count)
        ]

    def _parse_generated_flashcards(self, data: dict[str, object]) -> list[GeneratedFlashcard]:
        cards = data.get("flashcards", [])
        if not isinstance(cards, list):
            raise ValueError("flashcards was not a list")
        return [
            GeneratedFlashcard(front=str(card.get("front", "")).strip(), back=str(card.get("back", "")).strip())
            for card in cards
            if isinstance(card, dict) and card.get("front") and card.get("back")
        ]

    def _dedupe_flashcards(
        self, cards: list[GeneratedFlashcard], existing_flashcards: list[str]
    ) -> list[GeneratedFlashcard]:
        seen = {self._flashcard_key(item) for item in existing_flashcards}
        unique: list[GeneratedFlashcard] = []
        for card in cards:
            key = self._flashcard_key(f"{card.front}\n{card.back}")
            if not key or key in seen:
                continue
            seen.add(key)
            unique.append(card)
        return unique

    def _flashcard_key(self, text: str) -> str:
        return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", text.lower())).strip()

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
