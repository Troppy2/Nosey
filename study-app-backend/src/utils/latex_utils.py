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
    # Find $$...$$ spans first (higher priority). Only add $...$ spans
    # that don't overlap with any $$...$$ span, to prevent duplication.
    double_spans: List[Tuple[int, int]] = []
    for m in re.finditer(r"\$\$[\s\S]*?\$\$", text):
        double_spans.append((m.start(), m.end()))
    spans: List[Tuple[int, int]] = list(double_spans)
    for m in re.finditer(r"\$(?:[^$\n]|\\\$)+\$", text):
        start, end = m.start(), m.end()
        if not any(a <= start < b for a, b in double_spans):
            spans.append((start, end))
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
        if a < last:
            # skip span that overlaps with one already emitted
            continue
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
    # Wrap LaTeX command sequences in $...$ when outside math delimiters.
    # Handles both \cmd{...} forms and bare Greek letters / common symbols.
    if not seg:
        return seg

    _BARE_SYMBOLS = (
        r"alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta"
        r"|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma"
        r"|tau|upsilon|phi|varphi|chi|psi|omega"
        r"|Alpha|Beta|Gamma|Delta|Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda"
        r"|Mu|Nu|Xi|Pi|Rho|Sigma|Tau|Upsilon|Phi|Chi|Psi|Omega"
        r"|pm|mp|times|div|cdot|circ|bullet|star|infty|nabla|partial"
        r"|forall|exists|in|notin|subset|supset|subseteq|supseteq|cup|cap"
        r"|leq|geq|neq|approx|equiv|sim|propto|perp|parallel"
        r"|to|rightarrow|leftarrow|Rightarrow|Leftarrow|leftrightarrow|Leftrightarrow"
        r"|cdots|ldots|vdots|ddots|hbar|ell|Re|Im|wp"
    )

    # First alternative: \cmd{...} with one or more braced groups (and optional ^/_ suffixes)
    # Second alternative: bare known Greek letters / symbols not followed by a letter or {
    cmd_re = re.compile(
        r"(\\[a-zA-Z@]+(?:\s*\{[^}]*\})+(?:[_\^](?:\{[^}]*\}|[^\s\\]))*"
        r"|\\(?:" + _BARE_SYMBOLS + r")(?![a-zA-Z{]))"
    )

    def _wrap(m: re.Match) -> str:
        return f"${m.group(0)}$"

    return cmd_re.sub(_wrap, seg)
