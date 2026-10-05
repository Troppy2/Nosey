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
# inline ones. Inside math a backslash pairs with the next character, so an
# escaped dollar ("$0.5 \times \$5000$") never closes the span early.
_SPAN_RE = re.compile(
    r"(?P<fence>```[\s\S]*?```)"
    r"|(?P<code>`[^`\n]*`)"
    r"|(?P<escaped>\\\$)"
    r"|(?P<display>\$\$(?:\\[\s\S]|[^\\])*?\$\$)"
    r"|(?P<bracket_display>\\\[[\s\S]*?\\\])"
    r"|(?P<inline>\$(?:\\[^\n]|[^$\n\\])+?\$)"
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
# letter or a brace, with the same optional ^/_ suffixes so "\epsilon_4" is
# wrapped whole rather than as "$\epsilon$_4". \begin and \end are excluded
# because an environment is handled as a whole by _ENVIRONMENT_RE; wrapping
# its two halves separately would produce $\begin{bmatrix}$ ...
# $\end{bmatrix}$, which renders as an error at both ends.
_COMMAND_RE = re.compile(
    r"(\\(?!begin\b|end\b)[a-zA-Z@]+(?:\s*\{[^}]*\})+(?:[_\^](?:\{[^}]*\}|[^\s\\]))*"
    r"|\\(?:" + _BARE_SYMBOLS + r")(?![a-zA-Z{])(?:[_\^](?:\{[^}]*\}|[A-Za-z0-9]))*)"
)


# One display equation on a line of its own, closed with the wrong delimiter:
# "$$ x $" or "$ x $$". The body may not hold another unescaped $, so a
# balanced line or two inline spans never match.
_HALF_OPEN_RE = re.compile(r"^(\s*)\$\$((?:\\.|[^$\\])+)\$(\s*)$")
_HALF_CLOSE_RE = re.compile(r"^(\s*)\$(?!\$)((?:\\.|[^$\\])+)\$\$(\s*)$")

_PROSE_CMD_RE = re.compile(r"\\[a-zA-Z]+")
_PROSE_PUNCT_RE = re.compile(r"[{}^_()\[\]&$*=+\-/<>|\\]")
_PROSE_WORD_RE = re.compile(r"[a-zA-Z]{4,}")


def _looks_like_prose(text: str) -> bool:
    """Three or more English words of four letters or more: a sentence, not maths."""
    stripped = _PROSE_PUNCT_RE.sub(" ", _PROSE_CMD_RE.sub(" ", text))
    return len(_PROSE_WORD_RE.findall(stripped)) >= 3


def balance_display_delimiters(text: str) -> str:
    """Close a display equation opened with $$ and closed with $, or the reverse.

    Models writing many equations in a row emit "$$ E(X) = ... $" on one line
    and "$$ ... $$" on the next. The renderer then pairs the first $$ with the
    one that opens the next line and renders the pair as a red KaTeX error.
    Only a line holding nothing but that one equation is touched; code, lines
    with backtick spans, and prose are left alone. Mirrors
    balanceDisplayDelimiters in the frontend's repairMathDelimiters.ts.
    """
    if not text or "$$" not in text:
        return text
    out: List[str] = []
    in_fence = False
    for line in text.split("\n"):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence or "`" in line:
            out.append(line)
            continue
        m = _HALF_OPEN_RE.match(line) or _HALF_CLOSE_RE.match(line)
        if m and not _looks_like_prose(m.group(2)):
            line = f"{m.group(1)}$${m.group(2)}$${m.group(3)}"
        out.append(line)
    return "\n".join(out)


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


_TEXT_CMD_RE = re.compile(r"\\text(?:bf|it|rm)?\{([^{}]*)\}")
_OUTER_DELIMS_RE = re.compile(r"^\s*\$\$?([\s\S]*?)\$?\$\s*$")
_MATH_HINT_RE = re.compile(r"[\\^_=+\-*/<>()\[\]{}|0-9]")


def format_final_answer(answer: str) -> str:
    """Markdown for a grader's final answer: display maths only when it is maths.

    Wrapping every final answer in $$...$$ rendered a word like TRUE as
    italic maths letters, and a sentence as one display line that never
    wraps and widened the whole Results card. A word stays plain text; a
    sentence (or anything already holding inline $...$) is prose with its
    maths delimited; only a bare expression becomes a display block.
    """
    text = answer.strip()
    if not text:
        return text
    if "$" in text:
        inner = _OUTER_DELIMS_RE.match(text)
        # "$$x = 4$$" or "$x = 4$" whole: the model delimited a plain
        # expression itself. Anything else with a $ in it is prose.
        if inner and "$" not in inner.group(1):
            text = inner.group(1).strip()
        else:
            return normalize_latex(text)
    unwrapped = _TEXT_CMD_RE.sub(lambda m: m.group(1), text)
    if _looks_like_prose(unwrapped):
        return normalize_latex(unwrapped)
    if not _MATH_HINT_RE.search(text) and " " not in text and len(text) > 1:
        # A single word: True, False, Yes, Undefined.
        return text
    return f"$${text}$$"


def normalize_latex(text: str) -> str:
    """Normalize common LaTeX usage in free text.

    - `\\[...\\]` becomes `$$...$$` and `\\(...\\)` becomes `$...$`.
    - A bare LaTeX command or environment in prose is wrapped in delimiters.
    - A display equation closed with the wrong delimiter is balanced.
    - Math that is already delimited, and anything inside a code fence or a
      backtick span, is returned byte for byte unchanged.
    """
    if not text:
        return text
    text = balance_display_delimiters(text)

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
            # fence, code, an escaped \$, display and inline math all pass
            # through verbatim. The escaped dollar is claimed here so it can
            # never open a false inline span that swallows the real one.
            out.append(match.group(0))
        last = match.end()

    if last < len(text):
        out.append(_wrap_prose(text[last:]))

    return "".join(out)
