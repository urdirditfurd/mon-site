"""Bus in-memory de monitoring temps réel (dashboard/websocket)."""

from __future__ import annotations

import asyncio
from collections import deque
from datetime import datetime, timezone


class MonitoringHub:
    """Diffuse des événements runtime vers le dashboard et websocket."""

    def __init__(self, max_recent_events: int = 300) -> None:
        self._recent_events: deque[dict] = deque(maxlen=max_recent_events)
        self._subscribers: set[asyncio.Queue[dict]] = set()

    def publish_event(
        self,
        *,
        channel: str,
        event_type: str,
        severity: str,
        message: str,
        payload: dict | None = None,
    ) -> dict:
        """Publie un événement runtime dans l'historique et vers les abonnés."""

        event = {
            "channel": channel,
            "event_type": event_type,
            "severity": severity,
            "message": message,
            "payload": payload,
            "created_at": datetime.now(timezone.utc),
        }
        self._recent_events.append(event)
        for queue in list(self._subscribers):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                continue
        return event

    def subscribe(self, max_queue_size: int = 100) -> asyncio.Queue[dict]:
        """Ajoute un abonné websocket."""

        queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=max_queue_size)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict]) -> None:
        """Supprime un abonné websocket."""

        self._subscribers.discard(queue)

    def recent_events(self, limit: int = 20) -> list[dict]:
        """Retourne les derniers événements runtime (plus récents d'abord)."""

        items = list(self._recent_events)[-limit:]
        items.reverse()
        return items

    @property
    def subscriber_count(self) -> int:
        """Nombre de connexions websocket actives."""

        return len(self._subscribers)
