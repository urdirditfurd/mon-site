"""Authentification Bearer + contrôle d'accès par rôles."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Callable

from fastapi import Depends, HTTPException, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import AsyncSessionLocal, get_session
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode(value + padding)


def hash_password(password: str) -> str:
    """Hash PBKDF2-SHA256 du mot de passe."""

    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return f"pbkdf2_sha256${_b64url_encode(salt)}${_b64url_encode(digest)}"


def verify_password(password: str, password_hash: str) -> bool:
    """Vérifie un mot de passe contre le hash stocké."""

    try:
        algorithm, salt_b64, digest_b64 = password_hash.split("$", 2)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False

    salt = _b64url_decode(salt_b64)
    expected = _b64url_decode(digest_b64)
    provided = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return hmac.compare_digest(expected, provided)


def create_access_token(user: User) -> tuple[str, int]:
    """Crée un token signé contenant user_id et rôle."""

    expires_delta = timedelta(minutes=settings.auth_token_expiry_minutes)
    expires_at = datetime.now(timezone.utc) + expires_delta

    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": str(user.id),
        "role": user.role,
        "exp": int(expires_at.timestamp()),
        "iat": int(datetime.now(timezone.utc).timestamp()),
    }

    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    signature = hmac.new(
        settings.auth_secret_key.encode("utf-8"),
        signing_input,
        hashlib.sha256,
    ).digest()
    token = f"{header_b64}.{payload_b64}.{_b64url_encode(signature)}"
    return token, int(expires_delta.total_seconds())


def decode_access_token(token: str) -> dict:
    """Valide un token et retourne son payload."""

    try:
        header_b64, payload_b64, signature_b64 = token.split(".")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalide.") from exc

    signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
    expected_sig = hmac.new(
        settings.auth_secret_key.encode("utf-8"),
        signing_input,
        hashlib.sha256,
    ).digest()
    provided_sig = _b64url_decode(signature_b64)
    if not hmac.compare_digest(expected_sig, provided_sig):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Signature token invalide.")

    payload = json.loads(_b64url_decode(payload_b64))
    expires_at = payload.get("exp")
    if not isinstance(expires_at, int):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Payload token invalide.")
    if datetime.now(timezone.utc).timestamp() >= expires_at:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expiré.")
    return payload


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Retourne l'utilisateur authentifié."""

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentification requise.")

    payload = decode_access_token(credentials.credentials)
    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalide.") from exc

    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilisateur introuvable.")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Utilisateur désactivé.")
    return user


def require_roles(*allowed_roles: str) -> Callable:
    """Dépendance FastAPI: valide que l'utilisateur possède un rôle autorisé."""

    async def dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission insuffisante.")
        return current_user

    return dependency


def ensure_user_access(
    *,
    current_user: User,
    target_user_id: uuid.UUID,
    allow_roles: tuple[str, ...] = ("admin", "compliance"),
) -> None:
    """Autorise l'accès si self ou rôle privilégié."""

    if current_user.id == target_user_id:
        return
    if current_user.role in allow_roles:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès interdit à cet utilisateur.")


async def authenticate_websocket(
    websocket: WebSocket,
    *,
    required_roles: tuple[str, ...] | None = None,
) -> User:
    """Authentifie une connexion websocket via query `token` ou header Bearer."""

    raw_token = websocket.query_params.get("token")
    if not raw_token:
        auth_header = websocket.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            raw_token = auth_header[7:].strip()
    if not raw_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token websocket requis.")

    payload = decode_access_token(raw_token)
    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token websocket invalide.") from exc

    async with AsyncSessionLocal() as session:
        user = await session.get(User, user_id)
        if user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utilisateur introuvable.")
        if not user.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Utilisateur désactivé.")
        if required_roles and user.role not in required_roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission websocket insuffisante.")
        return user
