"""Topic tags on questions and flashcards (folder stats, migration 071)."""
from __future__ import annotations

import re
from typing import Optional

TOPIC_MAX_LEN = 80
_SPACE_RE = re.compile(r"\s+")
_EDGE_PUNCT = " .,;:-_\"'`*#"
_SMALL_WORDS = {"a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "vs"}


def normalize_topic(value: object) -> Optional[str]:
    """Trimmed, single-spaced, capitalised topic, or None when empty.

    Only the first letter of each lowercase word is raised, so acronyms and
    proper casing the model wrote ("DNA Replication", "pH Scale") survive.
    Stats still group case-insensitively.
    """
    if value is None:
        return None
    text = _SPACE_RE.sub(" ", str(value)).strip(_EDGE_PUNCT)
    if not text:
        return None
    words = []
    for index, word in enumerate(text.split(" ")):
        if word.islower() and not (index and word in _SMALL_WORDS):
            word = word[0].upper() + word[1:]
        words.append(word)
    return " ".join(words)[:TOPIC_MAX_LEN].strip() or None
