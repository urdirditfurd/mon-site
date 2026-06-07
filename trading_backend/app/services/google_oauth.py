"""Vérification des jetons Google Sign-In (OAuth 2.0)."""

from __future__ import annotations

import json
import secrets
import urllib.error
import urllib.parse
import urllib.request


class GoogleOAuthError(Exception):
    """Erreur de validation d'un jeton Google."""


def verify_google_id_token(id_token: str, client_id: str) -> dict[str, str]:
    """
    Valide un ID token Google via l'endpoint tokeninfo.

    Retourne email, sub, name, picture si valide.
    """

    if not id_token or not client_id:
        raise GoogleOAuthError("Jeton Google ou client_id manquant.")

    query = urllib.parse.urlencode({"id_token": id_token})
    url = f"https://oauth2.googleapis.com/tokeninfo?{query}"
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise GoogleOAuthError("Jeton Google invalide ou expiré.") from exc
    except urllib.error.URLError as exc:
        raise GoogleOAuthError("Impossible de contacter Google pour vérifier le jeton.") from exc

    audience = payload.get("aud") or payload.get("azp")
    if audience != client_id:
        raise GoogleOAuthError("Jeton Google émis pour une autre application.")

    email = payload.get("email")
    if not email:
        raise GoogleOAuthError("E-mail absent du jeton Google.")

    email_verified = str(payload.get("email_verified", "")).lower()
    if email_verified not in {"true", "1"}:
        raise GoogleOAuthError("E-mail Google non vérifié.")

    return {
        "email": email.lower(),
        "sub": payload.get("sub", ""),
        "name": payload.get("name", ""),
        "picture": payload.get("picture", ""),
    }


def generate_oauth_password() -> str:
    """Mot de passe aléatoire pour comptes créés via OAuth (non utilisé en login classique)."""

    return secrets.token_urlsafe(48)
