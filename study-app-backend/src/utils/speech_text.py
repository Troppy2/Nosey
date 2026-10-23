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
