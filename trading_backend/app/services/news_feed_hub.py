"""Hub qui fusionne RSS, Telegram et simulateur (fallback dev)."""

from __future__ import annotations

from app.services.news_simulator import NewsSimulator
from app.services.rss_news import RssNewsIngester
from app.services.telegram_news import TelegramNewsIngester


class NewsFeedHub:
    """Expose un flux unique pour l'UI et l'API."""

    def __init__(
        self,
        simulator: NewsSimulator,
        rss: RssNewsIngester,
        telegram: TelegramNewsIngester,
    ) -> None:
        self._simulator = simulator
        self._rss = rss
        self._telegram = telegram

    @property
    def rss(self) -> RssNewsIngester:
        return self._rss

    @property
    def telegram(self) -> TelegramNewsIngester:
        return self._telegram

    @property
    def simulator(self) -> NewsSimulator:
        return self._simulator

    async def start(self) -> None:
        await self._simulator.start()
        await self._rss.start()
        await self._telegram.start()

    async def stop(self) -> None:
        await self._telegram.stop()
        await self._rss.stop()
        await self._simulator.stop()

    def latest(self, limit: int = 10) -> list[dict]:
        if self._rss.is_enabled:
            rss_items = self._rss.latest(limit=limit)
            if rss_items:
                return rss_items
        if self._telegram.is_enabled:
            telegram_items = self._telegram.latest(limit=limit)
            if telegram_items:
                return telegram_items
        return self._simulator.latest(limit=limit)

    def health_snapshot(self) -> dict:
        return {
            "rss": self._rss.health_snapshot(),
            "telegram": self._telegram.health_snapshot(),
            "simulator": self._simulator.health_snapshot(),
        }
