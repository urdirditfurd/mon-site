"""Schémas liés à l'authentification et aux permissions."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    """Payload de connexion."""

    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)


class AuthUserResponse(BaseModel):
    """Informations utilisateur exposées via auth."""

    id: uuid.UUID
    email: EmailStr
    role: str
    is_active: bool


class LoginResponse(BaseModel):
    """Token d'accès Bearer."""

    access_token: str
    token_type: str
    expires_in_seconds: int
    user: AuthUserResponse
