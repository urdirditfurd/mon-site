"""Lecture d'un canal Telegram public (spectateur) pour alimenter l'accueil SentiQ."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import uuid
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from urllib.error import URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

_CHANNEL_RE = re.compile(r"(?:https?://)?(?:t\.me|telegram\.me)/(?:s/)?@?([A-Za-z0-9_]+)")


@dataclass(slots=True)
class TelegramPost:
    """Message extrait d'un canal Telegram."""

    id: uuid.UUID
    headline: str
    news_text: str
    source: str
    direction: str
    confidence: float
    impact_label: str
    generated_at: datetime
    url: str | None = None


def normalize_channel_username(value: str) -> str:
    """Accepte @sentiq_actus, sentiq_actus ou https://t.me/sentiq_actus."""

    raw = value.strip()
    if not raw:
        return ""
    match = _CHANNEL_RE.search(raw)
    if match:
        return match.group(1)
    return raw.lstrip("@").split("/")[0]


class _TelegramPreviewParser(HTMLParser):
    """Parse la page publique https://t.me/s/<channel>."""

    def __init__(self) -> None:
        super().__init__()
        self._messages: list[dict[str, str]] = []
        self._current: dict[str, str] | None = None
        self._capture_text = False
        self._text_parts: list[str] = []

    @property
    def messages(self) -> list[dict[str, str]]:
        return list(reversed(self._messages))

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {k: v or "" for k, v in attrs}
        if tag == "div" and "tgme_widget_message_wrap" in attrs_dict.get("class", ""):
            self._current = {}
            self._text_parts = []
        elif self._current is not None and tag == "div" and "tgme_widget_message_text" in attrs_dict.get("class", ""):
            self._capture_text = True
        elif self._current is not None and tag == "time" and attrs_dict.get("datetime"):
            self._current["datetime"] = attrs_dict["datetime"]
        elif self._current is not None and tag == "a" and "tgme_widget_message_date" in attrs_dict.get("class", ""):
            self._current["url"] = attrs_dict.get("href", "")

    def handle_data(self, data: str) -> None:
        if self._capture_text and self._current is not None:
            self._text_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "div" and self._capture_text:
            self._capture_text = False
            if self._current is not None:
                text = unescape("".join(self._text_parts)).strip()
                text = re.sub(r"\s+", " ", text)
                if text:
                    self._current["text"] = text
                self._text_parts = []
        elif tag == "div" and self._current is not None and "text" in self._current:
            self._messages.append(self._current)
            self._current = None


def fetch_public_channel_posts(channel: str, limit: int = 20) -> list[dict[str, str]]:
    """
    Lit les derniers messages d'un canal PUBLIC via la preview web Telegram.

    Fonctionne en mode spectateur (sans poster) tant que le canal est public.
    """

    username = normalize_channel_username(channel)
    if not username:
        return []

    url = f"https://t.me/s/{username}"
    request = Request(
        url,
        headers={
            "User-Agent": "SentiQNewsBot/1.0 (+https://trading.agent-leads.fr)",
            "Accept-Language": "fr-FR,fr;q=0.9",
        },
    )
    try:
        with urlopen(request, timeout=15) as response:
            html = response.read().decode("utf-8", errors="replace")
    except URLError as exc:
        logger.warning("Telegram preview indisponible pour @%s: %s", username, exc)
        return []

    parser = _TelegramPreviewParser()
    parser.feed(html)
    return parser.messages[-limit:]


def posts_from_raw(raw_messages: list[dict[str, str]], channel: str) -> list[TelegramPost]:
    """Convertit les messages bruts en objets SentiQ."""

    username = normalize_channel_username(channel)
    source = f"Telegram @{username}"
    posts: list[TelegramPost] = []

    for item in raw_messages:
        text = item.get("text", "").strip()
        if not text:
            continue
        headline = text if len(text) <= 180 else f"{text[:177]}…"
        parsed_dt = _parse_datetime(item.get("datetime", ""))
        digest = hashlib.sha256(f"{username}:{text}:{item.get('url', '')}".encode()).hexdigest()
        posts.append(
            TelegramPost(
                id=uuid.uuid5(uuid.NAMESPACE_URL, digest),
                headline=headline,
                news_text=text,
                source=source,
                direction="neutral",
                confidence=0.0,
                impact_label="telegram",
                generated_at=parsed_dt,
                url=item.get("url") or None,
            )
        )
    posts.sort(key=lambda p: p.generated_at, reverse=True)
    return posts


def _parse_datetime(value: str) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)


class TelegramNewsIngester:
    """Poll un canal Telegram public et expose un cache local pour l'API /news/live."""

    def __init__(
        self,
        channel_username: str,
        poll_seconds: int = 90,
        max_items: int = 100,
        recovery_delay_seconds: int = 5,
    ) -> None:
        self.channel_username = normalize_channel_username(channel_username)
        self.poll_seconds = poll_seconds
        self.recovery_delay_seconds = recovery_delay_seconds
        self._items: deque[TelegramPost] = deque(maxlen=max_items)
        self._task: asyncio.Task[None] | None = None
        self._last_error: str | None = None
        self._last_fetch_at: datetime | None = None

    @property
    def is_enabled(self) -> bool:
        return bool(self.channel_username)

    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self) -> None:
        if not self.is_enabled or self.is_running:
            return
        await self.refresh()
        self._task = asyncio.create_task(self._run_loop(), name="telegram-news-ingester")

    async def stop(self) -> None:
        if not self._task:
            return
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def refresh(self) -> int:
        if not self.is_enabled:
            return 0
        try:
            raw = await asyncio.to_thread(fetch_public_channel_posts, self.channel_username, 25)
            posts = posts_from_raw(raw, self.channel_username)
            self._items.clear()
            for post in posts:
                self._items.append(post)
            self._last_error = None
            self._last_fetch_at = datetime.now(timezone.utc)
            logger.info("Telegram @%s: %s messages chargés.", self.channel_username, len(posts))
            return len(posts)
        except Exception as exc:
            self._last_error = str(exc)
            logger.exception("Erreur ingestion Telegram @%s", self.channel_username)
            return 0

    async def _run_loop(self) -> None:
        while True:
            try:
                await self.refresh()
                await asyncio.sleep(self.poll_seconds)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self._last_error = str(exc)
                await asyncio.sleep(self.recovery_delay_seconds)

    def latest(self, limit: int = 10) -> list[dict]:
        limited = list(self._items)[:limit]
        return [_post_to_dict(item) for item in limited]

    def health_snapshot(self) -> dict[str, str | bool | int | None]:
        return {
            "enabled": self.is_enabled,
            "running": self.is_running,
            "channel": self.channel_username or None,
            "items_cached": len(self._items),
            "last_error": self._last_error,
            "last_fetch_at": self._last_fetch_at.isoformat() if self._last_fetch_at else None,
        }


def _post_to_dict(post: TelegramPost) -> dict:
    payload = asdict(post)
    payload["generated_at"] = post.generated_at
    return payload
