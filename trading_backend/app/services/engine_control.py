"""Pilotage global du moteur de trading (pause/reprise)."""

from __future__ import annotations

from datetime import datetime, timezone


class EngineControl:
    """État runtime global du moteur (indépendant du kill switch utilisateur)."""

    def __init__(self) -> None:
        self._paused = False
        self._reason: str | None = None
        self._updated_at = datetime.now(timezone.utc)

    def pause(self, reason: str) -> None:
        self._paused = True
        self._reason = reason
        self._updated_at = datetime.now(timezone.utc)

    def resume(self) -> None:
        self._paused = False
        self._reason = None
        self._updated_at = datetime.now(timezone.utc)

    @property
    def is_paused(self) -> bool:
        return self._paused

    @property
    def reason(self) -> str | None:
        return self._reason

    @property
    def updated_at(self) -> datetime:
        return self._updated_at

    def snapshot(self) -> dict:
        return {
            "is_paused": self._paused,
            "reason": self._reason,
            "updated_at": self._updated_at,
        }
