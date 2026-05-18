"""Schémas Pydantic pour les utilisateurs."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr


class UserCreateRequest(BaseModel):
    """Payload de création d'un utilisateur."""

    email: EmailStr


class UserResponse(BaseModel):
    """Réponse API représentant un utilisateur."""

    id: uuid.UUID
    email: EmailStr
    created_at: datetime
