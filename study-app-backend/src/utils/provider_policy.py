"""Who is allowed to pick an LLM model, and what a request actually uses.

Only admins and beta users may override the model. Every other user (including
guests) is pinned to the automatic provider chain, which is Ollama-first with a
Groq -> Gemini -> Claude fallback (Claude last, most expensive). This keeps the
per-user cost down: free users default to the local model and only escalate to
paid APIs when it fails.

Enforced server-side at every route that accepts a client-supplied provider, so
a hand-crafted request cannot force an expensive model. The frontend hides the
model selector for the same set of users, but that is UX only, not the boundary.
"""
from typing import Optional

from src.models.user import User


def user_can_override_provider(user: User) -> bool:
    """True only for admins and beta users."""
    return bool(getattr(user, "is_admin", False) or getattr(user, "is_beta", False))


def resolve_request_provider(user: User, requested: Optional[str]) -> Optional[str]:
    """The provider a request may actually use.

    Admin/beta users get exactly what they asked for (``auto`` or a specific
    model). Everyone else is forced onto ``"auto"`` regardless of what the
    client sent, so they default to Ollama and fall back through the paid
    providers (Claude last) only on failure.
    """
    if user_can_override_provider(user):
        return requested
    return "auto"


def resolve_ocr_engine(user: User, requested: Optional[str]) -> str:
    """The OCR engine a request may actually use (STEM Scratch Pad feature).

    Deliberately NOT resolve_request_provider: that function validates against
    the LLM provider set (groq/gemini/claude/ollama), so a request for
    engine="groq" would pass its validation and then fail to dispatch, since no
    such OCR engine exists. This validates against the real OCR registry
    instead and falls back to the default on an unknown value rather than
    raising - a bad client-supplied engine name should degrade a grading
    submission, not 400 it.
    """
    from src.services.ocr_service import valid_ocr_engines

    default = "claude"
    if not user_can_override_provider(user):
        return default
    candidate = (requested or default).strip().lower()
    return candidate if candidate in valid_ocr_engines() else default


def can_submit_scratch_pad_work(user: User) -> bool:
    """Whether this user may submit a scratch-pad drawing at all.

    Separate from resolve_ocr_engine: this gates the feature itself (STEM
    Scratch Pad is beta-only), while resolve_ocr_engine only gates which
    engine an already-permitted request may pick.
    """
    return user_can_override_provider(user)
