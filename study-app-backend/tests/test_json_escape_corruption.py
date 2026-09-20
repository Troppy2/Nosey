"""
Regression tests for the Ollama-only lesson corruption.

Symptom (reported 2026-09-19, only ever seen on the cheap Ollama model): a
generated lesson renders as one unbroken blob with visible "\\n\\n" and "##"
inside the prose, and its LaTeX loses the leading backslash so $\\text{Range}$
renders as an italic "textRange".

Causal chain, each link tested below:

  1. Ollama wraps its JSON object in conversational prose, so the direct
     json.loads fails and _loads_json falls back to extracting the object.
  2. The old extraction regex could only balance ONE level of nesting, so a
     payload with LaTeX braces inside a NESTED object (a quiz question holding
     $\\text{Range}$) was truncated and failed to parse.
  3. _loads_json then raised, and _complete_ollama caught it and applied two
     crude repairs of its own. The second, raw.replace(backslash, 2*backslash),
     doubled EVERY backslash, so the valid JSON escape for a newline decoded to
     the two literal characters backslash + n in the value.
  4. That corrupted prose was persisted as lesson_content.

Other providers never had those extra fallbacks, which is exactly why this was
an Ollama-only complaint.
"""
from __future__ import annotations

import json

import pytest

from src.services.llm_service import LLMService, _extract_json_object

B = chr(92)  # a single backslash, spelled out so the test source stays readable


def wire(body: str) -> str:
    """A model reply: a JSON object buried in conversational prose."""
    return f"Sure, here is the module:\n{body}\nHope this helps!"


# The shape generate_module_content actually asks for: lesson + tts_script +
# nested question objects, with LaTeX in both the lesson and a question.
MODULE_BODY = (
    '{"lesson": "# Measures of Spread' + B + 'n' + B + 'nIn statistics.' + B + 'n' + B + 'n'
    '## The Range' + B + 'n' + B + 'n$$' + B + B + 'text{Max} - ' + B + B + 'text{Min}$$",'
    '"tts_script": "Measures of spread.",'
    '"questions": [{"question": "What is $' + B + B + 'text{Range}$?",'
    '"options": ["Max minus min", "The mean"], "correct_index": 0}]}'
)


class TestExtractJsonObject:
    """Link 2: brace balancing must ignore braces inside string literals."""

    def test_extracts_a_plain_object_from_prose(self):
        assert _extract_json_object(wire('{"a": 1}')) == '{"a": 1}'

    def test_survives_latex_braces_inside_a_nested_object(self):
        # The exact case the old one-level regex truncated.
        extracted = _extract_json_object(wire(MODULE_BODY))
        assert extracted is not None
        assert extracted.endswith("}")
        assert json.loads(extracted)["questions"][0]["correct_index"] == 0

    def test_ignores_braces_inside_strings(self):
        raw = '{"v": "a { b } c"}'
        assert _extract_json_object(raw) == raw

    def test_ignores_an_escaped_quote_inside_a_string(self):
        # A lone escaped quote must not be read as the end of the string, or
        # the brace counter resumes inside what is still string content.
        raw = '{"v": "she said ' + B + '" then {"}'
        assert _extract_json_object(raw) == raw

    def test_returns_none_when_there_is_no_object(self):
        assert _extract_json_object("no json here") is None
        assert _extract_json_object('{"unclosed": 1') is None


class TestLessonSurvivesProseWrappedJson:
    """Links 1 to 4 together, through the public parser."""

    svc = LLMService()

    def test_module_payload_parses_with_real_newlines_and_intact_latex(self):
        parsed = self.svc._loads_json(wire(MODULE_BODY))
        lesson = parsed["lesson"]

        # The actual bug: real newlines, never the two-character sequence.
        assert "\n" in lesson
        assert B + "n" not in lesson, "newlines came back as literal backslash-n"

        # Markdown structure survived, so it renders as headed sections rather
        # than one blob.
        assert lesson.startswith("# Measures of Spread")
        assert "\n\n## The Range\n\n" in lesson

        # LaTeX kept its command backslash, so KaTeX renders Max, not "textMax".
        assert B + "text{Max}" in lesson
        assert "text{Max}" not in lesson.replace(B + "text{Max}", "")

    def test_nested_question_latex_survives(self):
        parsed = self.svc._loads_json(wire(MODULE_BODY))
        assert parsed["questions"][0]["question"] == "What is $" + B + "text{Range}$?"


class TestOllamaNoLongerRepairsByCorrupting:
    """Link 3: the two crude fallbacks are gone for good.

    They are the difference between "this provider failed, try the next one"
    and "this provider returned prose that looks fine and is quietly ruined".
    """

    def test_source_does_not_reapply_the_corrupting_transforms(self):
        import inspect

        from src.services import llm_service

        source = inspect.getsource(llm_service.LLMService._complete_ollama)
        # Strip comments: the explanation of the old bug names both transforms.
        code = "\n".join(
            line for line in source.splitlines() if not line.strip().startswith("#")
        )
        assert "unicode_escape" not in code
        assert 'replace("' + B + B + '"' not in code

    def test_unparseable_payload_raises_instead_of_returning_mangled_text(self):
        from src.utils.exceptions import LLMException

        svc = LLMService()
        with pytest.raises((ValueError, LLMException)):
            svc._loads_json("totally unparseable, no object at all")


class TestTheOldFallbackWouldHaveCorruptedThis:
    """Pins the mechanism itself, so the bug cannot be reintroduced as a
    'harmless' retry without this test explaining what it costs."""

    def test_doubling_every_backslash_turns_newline_escapes_into_literal_text(self):
        body = '{"lesson": "a' + B + 'nb"}'
        assert json.loads(body)["lesson"] == "a\nb"

        corrupted = json.loads(body.replace(B, B + B))["lesson"]
        assert corrupted == "a" + B + "nb"
        assert "\n" not in corrupted
