from __future__ import annotations

import re
from typing import List, Tuple


def _replace_bracketed_math(text: str) -> str:
    # \[ ... \] -> $$ ... $$ (display math)
    text = re.sub(r"\\\[(.*?)\\\]", r"$$\1$$", text, flags=re.S)
    # \( ... \) -> $ ... $ (inline math)
    text = re.sub(r"\\\((.*?)\\\)", r"$\1$", text, flags=re.S)
    # \begin{env} ... \end{env} -> $$ ... $$ (treat environments as display math)
    text = re.sub(r"\\begin\{([a-zA-Z*]+)\}(.*?)\\end\{\1\}", r"$$\2$$", text, flags=re.S)
    return text


def _math_spans(text: str) -> List[Tuple[int, int]]:
    # find $$...$$ and $...$ spans so we don't double-wrap
    spans: List[Tuple[int, int]] = []
    for m in re.finditer(r"\$\$[\s\S]*?\$\$", text):
        spans.append((m.start(), m.end()))
    for m in re.finditer(r"\$(?:[^$\n]|\\\$)+\$", text):
        spans.append((m.start(), m.end()))
    spans.sort()
    return spans


def _in_spans(idx: int, spans: List[Tuple[int, int]]) -> bool:
    for a, b in spans:
        if a <= idx < b:
            return True
    return False


def normalize_latex(text: str) -> str:
    """Normalize common LaTeX usage in free text.

    Heuristics applied:
    - Convert `\\[...]` -> `$$...$$`, `\\(...)` -> `$...$`, and environments to display math
    - Wrap bare LaTeX command sequences (e.g. `\frac{a}{b}`, `\sqrt{x}`) in `$...$` when they are
      not already inside `$...$` or `$$...$$`.

    This is intentionally conservative: it avoids attempting full TeX parsing and focuses on
    common cases that cause inconsistent rendering in the app.
    """
    if not text:
        return text

    text = _replace_bracketed_math(text)

    spans = _math_spans(text)

    # Process non-math segments and wrap obvious LaTeX commands
    parts: List[str] = []
    last = 0
    for a, b in spans:
        if last < a:
            parts.append(_wrap_commands_in_segment(text[last:a]))
        parts.append(text[a:b])
        last = b
    if last < len(text):
        parts.append(_wrap_commands_in_segment(text[last:]))

    out = "".join(parts)
    # clean up accidental multiple-dollar sequences
    out = out.replace("$$$$", "$$")
    out = out.replace("$$$", "$$")
    return out


def _wrap_commands_in_segment(seg: str) -> str:
    # Wrap LaTeX command sequences that look like \cmd{...} or \cmd^... in $...$
    if not seg:
        return seg

    # Regex matches a backslash command followed by one or more braced groups, optionally with ^/_
    cmd_re = re.compile(r"(\\[a-zA-Z@]+(?:\s*\{[^}]*\})+(?:[_\^](?:\{[^}]*\}|[^\s\\]))*)")

    def _wrap(m: re.Match) -> str:
        s = m.group(0)
        # avoid wrapping if immediately adjacent to $ (shouldn't happen in non-math segment)
        return f"${s}$"

    return cmd_re.sub(_wrap, seg)
