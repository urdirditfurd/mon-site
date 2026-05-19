"""Générateur asynchrone de fausses news financières."""

from __future__ import annotations

import asyncio
import random
import uuid
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from app.services.nlp_mock import MockNLPEngine


@dataclass(slots=True)
class NewsSignal:
    """Structure interne d'une news analysée."""

    id: uuid.UUID
    headline: str
    source: str
    direction: str
    confidence: float
    impact_label: str
    generated_at: datetime


class NewsSimulator:
    """Simule un flux d'actualités en continu."""

    def __init__(
        self,
        interval_seconds: int = 5,
        max_items: int = 100,
        recovery_delay_seconds: int = 2,
    ) -> None:
        self.interval_seconds = interval_seconds
        self.recovery_delay_seconds = recovery_delay_seconds
        self._items: deque[NewsSignal] = deque(maxlen=max_items)
        self._queue: asyncio.Queue[NewsSignal] = asyncio.Queue()
        self._task: asyncio.Task[None] | None = None
        self._last_error: str | None = None
        self._nlp_engine = MockNLPEngine()
        self._sources = ["Reuters", "Bloomberg", "Financial Times", "TechWire"]

        self._headlines = [
            "Le patron de Nvidia annonce une nouvelle puce IA",
            "Résultats trimestriels supérieurs aux attentes chez Apple",
            "La FED évoque un ralentissement de la hausse des taux",
            "Microsoft signe un contrat cloud majeur en Europe",
            "Alerte inflation: les coûts de production repartent à la hausse",
            "Une big tech annonce un plan de licenciement massif",
            "Tensions géopolitiques: incertitude sur les marchés",
            "Guidance prudente d'un leader des semi-conducteurs",
            "BlackRock confirme une stratégie d'expansion sur l'IA",
            "Downgrade d'un acteur cloud après un trimestre décevant",
            "OpenAI conclut un partenariat stratégique industriel",
            "Retard de production sur une génération de GPU",
        ]

    async def start(self) -> None:
        """Démarre le simulateur en tâche de fond."""

        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._run_loop(), name="news-simulator-loop")

    async def stop(self) -> None:
        """Arrête proprement le simulateur."""

        if not self._task:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass

    async def _run_loop(self) -> None:
        """Produit une nouvelle fausse actualité toutes les X secondes."""

        while True:
            try:
                signal = self._generate_news_signal()
                self._items.append(signal)
                await self._queue.put(signal)
                self._last_error = None
                await asyncio.sleep(self.interval_seconds)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._last_error = str(exc)
                await asyncio.sleep(self.recovery_delay_seconds)

    def _generate_news_signal(self) -> NewsSignal:
        """Génère une news puis l'analyse via le moteur NLP mock."""

        headline = random.choice(self._headlines)
        source = random.choice(self._sources)
        analysis = self._nlp_engine.analyze(headline)

        return NewsSignal(
            id=uuid.uuid4(),
            headline=headline,
            source=source,
            direction=analysis.direction,
            confidence=analysis.confidence,
            impact_label=analysis.impact_label,
            generated_at=datetime.now(timezone.utc),
        )

    def latest(self, limit: int = 10) -> list[dict]:
        """Retourne les dernières news (plus récente en premier)."""

        limited = list(self._items)[-limit:]
        limited.reverse()
        return [asdict(item) for item in limited]

    async def next_signal(self) -> NewsSignal:
        """Bloque jusqu'à réception d'une nouvelle actualité."""

        return await self._queue.get()

    @property
    def is_running(self) -> bool:
        """Indique si la boucle de génération est active."""

        return bool(self._task and not self._task.done())

    def health_snapshot(self) -> dict:
        """Retourne un état runtime du simulateur."""

        return {
            "running": self.is_running,
            "queue_size": self._queue.qsize(),
            "items_buffered": len(self._items),
            "last_error": self._last_error,
        }
