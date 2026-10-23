"""Spoken-text cleaning shared with the frontend narration player.

Mirrors notationToSpeech, markdownToSpeech and splitForSpeech in
study-app-frontend/src/components/episodeSpeech.ts. Narration clips are cached by the hash
of the exact text the player asks for, so pre-generating them on the server only pays off if
both sides cut and clean the text identically. Change one, change the other (the parity test
in tests/test_speech_text.py compares them).
"""
import re


def _sub(pattern: str, repl, text: str, flags: int = 0) -> str:
    # ASCII mode so the word-character and word-boundary classes behave like JavaScript's (the only
    # differences left are exotic Unicode spaces, which at worst cost a cache miss, never wrong audio).
    return re.sub(pattern, repl, text, flags=flags | re.ASCII)


GREEK_NAMES = {
    "alpha": "alpha",
    "beta": "beta",
    "gamma": "gamma",
    "delta": "delta",
    "epsilon": "epsilon",
    "zeta": "zeta",
    "eta": "eta",
    "theta": "theta",
    "iota": "iota",
    "kappa": "kappa",
    "lambda": "lambda",
    "mu": "mu",
    "nu": "nu",
    "xi": "xi",
    "omicron": "omicron",
    "pi": "pi",
    "rho": "rho",
    "sigma": "sigma",
    "tau": "tau",
    "upsilon": "upsilon",
    "phi": "phi",
    "chi": "chi",
    "psi": "psi",
    "omega": "omega",
    "varepsilon": "epsilon",
    "vartheta": "theta",
    "varphi": "phi",
    "varrho": "rho",
    "varsigma": "sigma",
    "Gamma": "capital gamma",
    "Delta": "capital delta",
    "Theta": "capital theta",
    "Lambda": "capital lambda",
    "Xi": "capital xi",
    "Pi": "capital pi",
    "Sigma": "capital sigma",
    "Upsilon": "capital upsilon",
    "Phi": "capital phi",
    "Psi": "capital psi",
    "Omega": "capital omega",
}
GREEK_UNICODE = {
    "α": "alpha",
    "β": "beta",
    "γ": "gamma",
    "δ": "delta",
    "ε": "epsilon",
    "ζ": "zeta",
    "η": "eta",
    "θ": "theta",
    "ι": "iota",
    "κ": "kappa",
    "λ": "lambda",
    "μ": "mu",
    "ν": "nu",
    "ξ": "xi",
    "π": "pi",
    "ρ": "rho",
    "σ": "sigma",
    "ς": "sigma",
    "τ": "tau",
    "υ": "upsilon",
    "φ": "phi",
    "χ": "chi",
    "ψ": "psi",
    "ω": "omega",
    "ϕ": "phi",
    "ϵ": "epsilon",
    "ϑ": "theta",
    "Γ": "capital gamma",
    "Δ": "capital delta",
    "Λ": "capital lambda",
    "Ξ": "capital xi",
    "Π": "capital pi",
    "Σ": "capital sigma",
    "Φ": "capital phi",
    "Ψ": "capital psi",
}
MATH_SYMBOLS = {
    "≤": " less than or equal to ",
    "≥": " greater than or equal to ",
    "≠": " not equal to ",
    "≈": " approximately equal to ",
    "±": " plus or minus ",
    "÷": " divided by ",
    "√": " the square root of ",
    "∑": " the sum of ",
    "∫": " the integral of ",
    "∞": " infinity ",
    "∈": " is in ",
    "∉": " is not in ",
    "⊂": " is a subset of ",
    "⊆": " is a subset of or equal to ",
    "∪": " union ",
    "∩": " intersection ",
    "∀": " for all ",
    "∃": " there exists ",
    "∂": " partial ",
    "∇": " nabla ",
    "°": " degrees ",
    "∝": " is proportional to ",
    "≡": " is congruent to ",
    "⇒": " implies ",
    "⇔": " if and only if ",
}
LATEX_SYMBOLS = {
    "pm": " plus or minus ",
    "div": " divided by ",
    "approx": " approximately equal to ",
    "in": " is in ",
    "notin": " is not in ",
    "subset": " is a subset of ",
    "subseteq": " is a subset of or equal to ",
    "cup": " union ",
    "cap": " intersection ",
    "forall": " for all ",
    "exists": " there exists ",
    "partial": " partial ",
    "nabla": " nabla ",
    "propto": " is proportional to ",
    "equiv": " is congruent to ",
    "Rightarrow": " implies ",
    "Leftrightarrow": " if and only if ",
    "to": " to ",
    "rightarrow": " to ",
    "leftarrow": " from ",
}


def notation_to_speech(text: str) -> str:
    out = text

    def complexity(m: re.Match) -> str:
        fn, inner = m.group(1), m.group(2)
        name = "big theta" if fn == "Θ" else "big omega" if fn == "Ω" else "O" if fn == "O" else fn
        return f"{name} of {inner}"

    out = _sub(r"(?<!\w)(O|Θ|Theta|Ω|Omega)\(([^()]*)\)", complexity, out)
    out = _sub(r"\\frac\{([^{}]+)\}\{([^{}]+)\}", r" \1 over \2 ", out)
    out = _sub(r"\\sqrt\{?\(?([\w+\-^ ]+)\)?\}?", r" the square root of \1 ", out)
    out = _sub(r"\\sum\b", " the sum of ", out)
    out = _sub(r"\\int\b", " the integral of ", out)
    out = _sub(r"\\infty\b", " infinity ", out)
    out = _sub(r"\\pi\b", " pi ", out)
    out = _sub(
        r"\\([a-zA-Z]+)(?![a-zA-Z])",
        lambda m: f" {GREEK_NAMES[m.group(1)]} " if m.group(1) in GREEK_NAMES else LATEX_SYMBOLS.get(m.group(1), m.group(0)),
        out,
    )
    out = re.sub(r"[\u0370-\u03ff\u1f00-\u1fff]", lambda m: f" {GREEK_UNICODE[m.group(0)]} " if m.group(0) in GREEK_UNICODE else m.group(0), out)
    out = re.sub(r"[≤≥≠≈±÷√∑∫∞∈∉⊂⊆∪∩∀∃∂∇°∝≡⇒⇔]", lambda m: MATH_SYMBOLS[m.group(0)], out)
    out = _sub(r"\\cdot\b|\\times\b|×|·", " times ", out)
    out = _sub(r"\\le(q)?\b", " less than or equal to ", out)
    out = _sub(r"\\ge(q)?\b", " greater than or equal to ", out)
    out = _sub(r"\\ne(q)?\b", " not equal to ", out)
    out = _sub(r"\\[a-zA-Z]+", " ", out)
    out = _sub(r"(\w)\^\{?2\}?(?!\w)", r"\1 squared", out)
    out = _sub(r"(\w)\^\{?3\}?(?!\w)", r"\1 cubed", out)
    out = _sub(r"(\w)\^\{?([\w+\-]+)\}?", r"\1 to the power of \2", out)
    out = _sub(r"\b(\w)_\{?(\w+)\}?", r"\1 sub \2", out)
    out = _sub(r"<=", " less than or equal to ", out)
    out = _sub(r">=", " greater than or equal to ", out)
    out = _sub(r"!==?", " not equal to ", out)
    out = _sub(r"===?", " equals ", out)
    out = _sub(r"(\s)=(\s)", r"\1equals\2", out)
    out = _sub(r"(\s)\+(\s)", r"\1plus\2", out)
    out = _sub(r"(\s)\*(\s)", r"\1times\2", out)
    out = _sub(r"->|→", " to ", out)
    out = _sub(r"\bn!", "n factorial", out)
    out = _sub(r"\b(\w+)\[(\w+)\]", r"\1 at index \2", out)
    out = _sub(r"\b([a-zA-Z_]\w*)\(\)", r"the \1 function", out)
    out = _sub(r"\b([a-zA-Z_]\w*)\(([^()]*)\)", r"\1 of \2", out)
    out = _sub(r"[{}]", " ", out)
    return out


def markdown_to_speech(markdown: str) -> str:
    text = markdown
    text = _sub(r"```[\s\S]*?```", " Here, see the code example on screen. ", text)
    text = _sub(r"\$\$([\s\S]*?)\$\$", r" \1 ", text)
    text = _sub(r"\$([^$\n]+)\$", r" \1 ", text)
    text = _sub(r"^#{1,6}\s*", "", text, re.M)
    text = _sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = _sub(r"\*([^*]+)\*", r"\1", text)
    text = _sub(r"`([^`]+)`", r"\1", text)
    text = _sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = _sub(r"^[-*+]\s+", "", text, re.M)
    text = _sub(r"^\d+\.\s+", "", text, re.M)
    text = _sub(r"\|", " ", text)
    text = notation_to_speech(text)
    return _sub(r"\s+", " ", text).strip()


def split_for_speech(text: str, max_len: int = 600) -> list[str]:
    sentences = re.findall(r"[^.!?]+[.!?]+|[^.!?]+\Z", text) or [text]
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if len(current + sentence) > max_len and current:
            chunks.append(current.strip())
            current = sentence
        else:
            current += sentence
    if current.strip():
        chunks.append(current.strip())
    return chunks
