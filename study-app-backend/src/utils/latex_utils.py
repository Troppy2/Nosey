r"""Normalize the LaTeX a model emits into the single dialect the frontend renders.

The frontend (MarkdownContent.tsx) understands $...$ for inline math and
$$...$$ for display math. Models are inconsistent: they mix in \(...\) and
\[...\], and they sometimes drop a bare \frac{a}{b} into prose with no
delimiters at all. This module converts those into the canonical form.

The one rule that matters: this is a *delimiter* normalizer, never a content
rewriter. It must never change what is inside math, never touch code, and
never emit an odd number of $$ delimiters. An odd $$ is catastrophic: the
renderer pairs the stray one with the next $$ further down the article and
swallows every paragraph in between into a single red KaTeX error block.

That is exactly what the previous implementation did. It rewrote
\begin{env}...\end{env} to $$...$$, which deleted the environment (so
\begin{bmatrix} 1 \\ 2 \\ 3 \end{bmatrix} became the bare text 1 \\ 2 \\ 3)
and, when the environment was already inside $$...$$, left behind three
delimiters where there had been two.
"""
from __future__ import annotations

import re
from typing import List

# Spans that are already unambiguous and must survive byte for byte. Order is
# significant: a fenced block is matched before anything inside it can be, and
# $$...$$ is matched before $...$ so a display block is never read as two
# inline ones.
_SPAN_RE = re.compile(
    r"(?P<fence>```[\s\S]*?```)"
    r"|(?P<code>`[^`\n]*`)"
    r"|(?P<display>\$\$[\s\S]*?\$\$)"
    r"|(?P<bracket_display>\\\[[\s\S]*?\\\])"
    r"|(?P<inline>\$(?:[^$\n])+?\$)"
    r"|(?P<bracket_inline>\\\([\s\S]*?\\\))"
)

# A complete LaTeX environment. Kept whole and wrapped in display delimiters
# when it turns up outside math; never unwrapped, never stripped.
_ENVIRONMENT_RE = re.compile(r"\\begin\{([a-zA-Z*]+)\}[\s\S]*?\\end\{\1\}")

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

# First alternative: \cmd{...} with one or more braced groups (and optional
# ^/_ suffixes). Second: a bare known Greek letter or symbol not followed by a
# letter or a brace. \begin and \end are excluded because an environment is
# handled as a whole by _ENVIRONMENT_RE; wrapping its two halves separately
# would produce $\begin{bmatrix}$ ... $\end{bmatrix}$, which renders as an
# error at both ends.
_COMMAND_RE = re.compile(
    r"(\\(?!begin\b|end\b)[a-zA-Z@]+(?:\s*\{[^}]*\})+(?:[_\^](?:\{[^}]*\}|[^\s\\]))*"
    r"|\\(?:" + _BARE_SYMBOLS + r")(?![a-zA-Z{]))"
)


def _wrap_prose(segment: str) -> str:
    """Add delimiters to undelimited LaTeX in a stretch of ordinary prose.

    Environments are wrapped whole in $$...$$. Everything else that looks like
    a command gets $...$. Text with no LaTeX in it comes back unchanged.
    """
    if not segment:
        return segment

    out: List[str] = []
    last = 0
    for match in _ENVIRONMENT_RE.finditer(segment):
        out.append(_COMMAND_RE.sub(lambda m: f"${m.group(0)}$", segment[last:match.start()]))
        out.append(f"$${match.group(0)}$$")
        last = match.end()
    out.append(_COMMAND_RE.sub(lambda m: f"${m.group(0)}$", segment[last:]))
    return "".join(out)


def normalize_latex(text: str) -> str:
    """Normalize common LaTeX usage in free text.

    - `\\[...\\]` becomes `$$...$$` and `\\(...\\)` becomes `$...$`.
    - A bare LaTeX command or environment in prose is wrapped in delimiters.
    - Math that is already delimited, and anything inside a code fence or a
      backtick span, is returned byte for byte unchanged.
    """
    if not text:
        return text

    out: List[str] = []
    last = 0
    for match in _SPAN_RE.finditer(text):
        if match.start() > last:
            out.append(_wrap_prose(text[last:match.start()]))

        kind = match.lastgroup
        if kind == "bracket_display":
            out.append("$$" + match.group(0)[2:-2] + "$$")
        elif kind == "bracket_inline":
            out.append("$" + match.group(0)[2:-2] + "$")
        else:
            # fence, code, display and inline math all pass through verbatim.
            out.append(match.group(0))
        last = match.end()

    if last < len(text):
        out.append(_wrap_prose(text[last:]))

    return "".join(out)
