"""Graph answers render as charts, never as TikZ source (GH #156)."""
from __future__ import annotations

import json
import re
from unittest.mock import AsyncMock

from src.services.llm_service import LLMService, render_answer_graph
from src.utils.latex_utils import TIKZ_FALLBACK, format_final_answer, normalize_latex, replace_tikz

_PMF_TIKZ = (
    "\\begin{tikzpicture} \\draw (0,0) -- (5,0); \\draw (0,0) rectangle (0.8,3.5); "
    "\\node at (0.4,-0.3) {0}; \\end{tikzpicture}"
)


def _fence(text: str, lang: str) -> dict:
    match = re.search(rf"```{lang}\n(.+?)\n```", text, re.DOTALL)
    assert match, text
    return json.loads(match.group(1))


def test_tikz_becomes_a_note_but_code_fences_and_cases_survive() -> None:
    assert replace_tikz(f"The PMF:\n\n{_PMF_TIKZ}\n\nDone.") == f"The PMF:\n\n{TIKZ_FALLBACK}\n\nDone."
    assert replace_tikz(f"$${_PMF_TIKZ}$$") == TIKZ_FALLBACK
    assert replace_tikz("cut \\begin{tikzpicture} \\draw (0,0)") == f"cut {TIKZ_FALLBACK}"
    fenced = f"```latex\n{_PMF_TIKZ}\n```"
    assert replace_tikz(fenced) == fenced
    assert TIKZ_FALLBACK in normalize_latex(_PMF_TIKZ)
    assert format_final_answer(_PMF_TIKZ) == TIKZ_FALLBACK
    assert format_final_answer("x = 4") == "$$x = 4$$"


def test_bar_graph_renders_correct_and_yours_as_one_chart() -> None:
    out = render_answer_graph({
        "type": "bar", "title": "PMF of X", "x_label": "x", "y_label": "P(X = x)",
        "correct": {"x": [0, 1, 2, 3, 4], "y": [0.41, 0.37, 0.16, 0.05, 0.01]},
        "student": {"x": [0, 1, 2, 3, 4], "y": ["0.41", 0.30, 0.16, 0.05, 0.01]},
    })
    assert out.startswith("**Graph: correct vs yours**")
    spec = _fence(out, "chart")
    assert [t["name"] for t in spec["data"]] == ["Correct", "Yours"]
    assert spec["data"][1]["y"][0] == 0.41 and spec["data"][0]["type"] == "bar"
    assert spec["layout"]["xaxis"] == {"title": "x"} and spec["layout"]["showlegend"] is True


def test_function_graph_uses_the_graph_fence() -> None:
    out = render_answer_graph({
        "type": "function", "correct": {"fn": "x^2 - 4", "domain": [-5, 5]}, "student": {"fn": "x^2 + 4"},
    })
    spec = _fence(out, "graph")
    assert [d["fn"] for d in spec["data"]] == ["x^2 - 4", "x^2 + 4"]
    assert spec["xAxis"]["domain"] == [-5.0, 5.0]
    assert "blue is yours" in out


def test_malformed_graphs_are_left_out() -> None:
    assert render_answer_graph(None) is None
    assert render_answer_graph({"type": "pie", "correct": {"x": [1], "y": [1]}}) is None
    assert render_answer_graph({"type": "bar", "correct": {"x": [1, 2], "y": [1]}}) is None
    assert render_answer_graph({"type": "bar", "correct": {"x": [1], "y": ["tall"]}}) is None
    assert render_answer_graph({"type": "function", "correct": {"fn": "alert('x'); window"}}) is None
    # A bad student series drops only the comparison, not the correct graph.
    out = render_answer_graph({"type": "line", "correct": {"x": [1, 2], "y": [1, 2]}, "student": {"x": []}})
    assert out.startswith("**Graph**") and len(_fence(out, "chart")["data"]) == 1


async def test_math_grade_feedback_carries_the_graph() -> None:
    svc = LLMService()
    svc._candidate_providers = AsyncMock(return_value=["claude"])  # type: ignore[method-assign]
    svc._complete_json_for_provider = AsyncMock(return_value={  # type: ignore[method-assign]
        "is_correct": True, "what_went_right": "Right PMF.", "what_went_wrong": "",
        "steps": [], "final_answers": [], "confidence": 0.9,
        "graph": {"type": "bar", "correct": {"x": [0, 1], "y": [0.5, 0.5]}, "student": None},
    })
    grade = await svc.grade_math_answer("Draw the PMF.", "fair coin", "0.5, 0.5")
    assert "```chart" in grade.feedback and "Graph" in grade.feedback
