"""Générateur asynchrone de fausses news financières."""

from __future__ import annotations

import asyncio
import random
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone


@dataclass(slots=True)
class NewsSignal:
    """Structure interne d'une news analysée."""

    headline: str
    direction: str
    confidence: float
    generated_at: datetime


class NewsSimulator:
    """Simule un flux d'actualités en continu."""

    def __init__(self, interval_seconds: int = 5, max_items: int = 100) -> None:
        self.interval_seconds = interval_seconds
        self._items: deque[NewsSignal] = deque(maxlen=max_items)
        self._task: asyncio.Task[None] | None = None

        self._positive_headlines = [
            "Le patron de Nvidia annonce une nouvelle puce IA",
            "Résultats trimestriels supérieurs aux attentes chez Apple",
            "La FED évoque un ralentissement de la hausse des taux",
            "Microsoft signe un contrat cloud majeur en Europe",
        ]
        self._negative_headlines = [
            "Alerte inflation: les coûts de production repartent à la hausse",
            "Une big tech annonce un plan de licenciement massif",
            "Tensions géopolitiques: incertitude sur les marchés",
            "Guidance prudente d'un leader des semi-conducteurs",
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
            self._items.append(self._generate_news_signal())
            await asyncio.sleep(self.interval_seconds)

    def _generate_news_signal(self) -> NewsSignal:
        """Génère un signal aléatoire achat/vente + probabilité."""

        direction = random.choice(["buy", "sell"])
        if direction == "buy":
            headline = random.choice(self._positive_headlines)
            confidence = round(random.uniform(65.0, 98.0), 2)
        else:
            headline = random.choice(self._negative_headlines)
            confidence = round(random.uniform(60.0, 95.0), 2)

        return NewsSignal(
            headline=headline,
            direction=direction,
            confidence=confidence,
            generated_at=datetime.now(timezone.utc),
        )

    def latest(self, limit: int = 10) -> list[dict]:
        """Retourne les dernières news (plus récente en premier)."""

        limited = list(self._items)[-limit:]
        limited.reverse()
        return [asdict(item) for item in limited]
