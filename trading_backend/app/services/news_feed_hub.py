"""Hub qui fusionne Telegram (canal réel) et simulateur (fallback dev)."""

from __future__ import annotations

from app.services.news_simulator import NewsSimulator
from app.services.telegram_news import TelegramNewsIngester


class NewsFeedHub:
    """Expose un flux unique pour l'UI et l'API."""

    def __init__(self, simulator: NewsSimulator, telegram: TelegramNewsIngester) -> None:
        self._simulator = simulator
        self._telegram = telegram

    @property
    def telegram(self) -> TelegramNewsIngester:
        return self._telegram

    @property
    def simulator(self) -> NewsSimulator:
        return self._simulator

    async def start(self) -> None:
        await self._simulator.start()
        await self._telegram.start()

    async def stop(self) -> None:
        await self._telegram.stop()
        await self._simulator.stop()

    def latest(self, limit: int = 10) -> list[dict]:
        if self._telegram.is_enabled:
            telegram_items = self._telegram.latest(limit=limit)
            if telegram_items:
                return telegram_items
        return self._simulator.latest(limit=limit)

    def health_snapshot(self) -> dict:
        return {
            "telegram": self._telegram.health_snapshot(),
            "simulator": self._simulator.health_snapshot(),
        }
