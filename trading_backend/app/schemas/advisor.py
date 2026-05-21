"""Schémas du conseiller IA conversationnel."""

from __future__ import annotations

from pydantic import BaseModel, Field


class AdvisorChatRequest(BaseModel):
    """Question utilisateur envoyée au conseiller IA."""

    message: str = Field(..., min_length=2, max_length=2000)


class AdvisorChatResponse(BaseModel):
    """Réponse structurée du conseiller IA."""

    answer: str
    suggested_actions: list[str]
    risk_flags: list[str]
    disclaimer: str
