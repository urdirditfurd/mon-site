"""Ingestion de flux RSS/Atom pour alimenter l'accueil SentiQ."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import uuid
import xml.etree.ElementTree as ET
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from urllib.error import URLError
from urllib.request import Request, urlopen

from app.services.rss_feed_catalog import CATEGORY_LABELS, DEFAULT_RSS_FEEDS

logger = logging.getLogger(__name__)

_STRIP_TAGS = re.compile(r"<[^>]+>")


@dataclass(slots=True)
class RssNewsItem:
    id: uuid.UUID
    headline: str
    news_text: str
    source: str
    direction: str
    confidence: float
    impact_label: str
    generated_at: datetime
    url: str | None = None
    category: str = "finance"


def parse_feed_specs(raw: str) -> list[dict[str, str]]:
    """
    Parse NEWS_RSS_FEEDS.

    Formats acceptés (une entrée par ligne ou séparée par ;):
      - URL seule
      - label|category|url
    """

    if not raw.strip():
        return list(DEFAULT_RSS_FEEDS)

    feeds: list[dict[str, str]] = []
    chunks = re.split(r"[;\n]+", raw.strip())
    for chunk in chunks:
        part = chunk.strip()
        if not part:
            continue
        if "|" in part:
            pieces = [p.strip() for p in part.split("|")]
            if len(pieces) == 2:
                label, url = pieces
                category = "finance"
            else:
                label, category, url = pieces[0], pieces[1], pieces[2]
            feeds.append({"label": label, "category": category, "url": url})
        else:
            feeds.append({"label": _label_from_url(part), "category": "finance", "url": part})
    return feeds or list(DEFAULT_RSS_FEEDS)


def _label_from_url(url: str) -> str:
    host = re.sub(r"^https?://(www\.)?", "", url).split("/")[0]
    return host.replace(".com", "").replace(".co.uk", "").title()


def _clean_text(value: str) -> str:
    text = unescape(value or "")
    text = _STRIP_TAGS.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def _parse_date(value: str) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        return parsedate_to_datetime(value).astimezone(timezone.utc)
    except (TypeError, ValueError, IndexError):
        pass
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_rss_or_atom(xml_text: str, feed_meta: dict[str, str], limit: int = 15) -> list[dict[str, str]]:
    """Extrait title, link, summary, date depuis RSS 2.0 ou Atom."""

    root = ET.fromstring(xml_text)
    items: list[dict[str, str]] = []

    for node in root.iter():
        tag = _local(node.tag)
        if tag not in {"item", "entry"}:
            continue

        title = ""
        link = ""
        summary = ""
        published = ""

        for child in node:
            child_tag = _local(child.tag)
            if child_tag == "title":
                title = _clean_text("".join(child.itertext()))
            elif child_tag == "link":
                link = child.attrib.get("href") or _clean_text(child.text or "") or link
            elif child_tag in {"description", "summary", "content"} and not summary:
                summary = _clean_text("".join(child.itertext()))
            elif child_tag in {"pubDate", "published", "updated"} and not published:
                published = (child.text or "").strip()

        if not title:
            continue
        items.append(
            {
                "title": title,
                "link": link,
                "summary": summary or title,
                "published": published,
                "label": feed_meta.get("label", "RSS"),
                "category": feed_meta.get("category", "finance"),
            }
        )
        if len(items) >= limit:
            break

    return items


def fetch_feed_entries(feed_meta: dict[str, str], limit: int = 12) -> list[dict[str, str]]:
    url = feed_meta["url"]
    request = Request(
        url,
        headers={
            "User-Agent": "SentiQNewsBot/1.0 (+https://trading.agent-leads.fr)",
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml",
        },
    )
    try:
        with urlopen(request, timeout=20) as response:
            xml_text = response.read().decode("utf-8", errors="replace")
        return parse_rss_or_atom(xml_text, feed_meta, limit=limit)
    except (URLError, ET.ParseError, ValueError) as exc:
        logger.warning("Flux RSS indisponible %s: %s", url, exc)
        return []


def items_from_entries(entries: list[dict[str, str]]) -> list[RssNewsItem]:
    posts: list[RssNewsItem] = []
    for entry in entries:
        title = entry.get("title", "").strip()
        if not title:
            continue
        category = entry.get("category", "finance")
        label = entry.get("label", "RSS")
        summary = entry.get("summary", title)
        headline = title if len(title) <= 180 else f"{title[:177]}…"
        link = entry.get("link") or None
        digest = hashlib.sha256(f"{label}:{title}:{link}".encode()).hexdigest()
        cat_label = CATEGORY_LABELS.get(category, category.title())
        posts.append(
            RssNewsItem(
                id=uuid.uuid5(uuid.NAMESPACE_URL, digest),
                headline=headline,
                news_text=summary,
                source=f"{label} · {cat_label}",
                direction="neutral",
                confidence=0.0,
                impact_label=category,
                generated_at=_parse_date(entry.get("published", "")),
                url=link,
                category=category,
            )
        )
    return posts


class RssNewsIngester:
    """Poll plusieurs flux RSS et expose un cache trié par date."""

    def __init__(
        self,
        feed_specs: list[dict[str, str]],
        poll_seconds: int = 300,
        max_items: int = 120,
        recovery_delay_seconds: int = 10,
    ) -> None:
        self.feed_specs = feed_specs
        self.poll_seconds = poll_seconds
        self.recovery_delay_seconds = recovery_delay_seconds
        self._items: deque[RssNewsItem] = deque(maxlen=max_items)
        self._task: asyncio.Task[None] | None = None
        self._last_error: str | None = None
        self._last_fetch_at: datetime | None = None
        self._feeds_ok = 0

    @property
    def is_enabled(self) -> bool:
        return bool(self.feed_specs)

    @property
    def is_running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self) -> None:
        if not self.is_enabled or self.is_running:
            return
        await self.refresh()
        self._task = asyncio.create_task(self._run_loop(), name="rss-news-ingester")

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
            all_entries: list[dict[str, str]] = []
            ok = 0
            for spec in self.feed_specs:
                entries = await asyncio.to_thread(fetch_feed_entries, spec, 8)
                if entries:
                    ok += 1
                    all_entries.extend(entries)
            posts = items_from_entries(all_entries)
            posts.sort(key=lambda p: p.generated_at, reverse=True)
            self._items.clear()
            for post in posts:
                self._items.append(post)
            self._feeds_ok = ok
            self._last_error = None if posts else "Aucun article récupéré"
            self._last_fetch_at = datetime.now(timezone.utc)
            logger.info("RSS: %s flux OK, %s articles.", ok, len(posts))
            return len(posts)
        except Exception as exc:
            self._last_error = str(exc)
            logger.exception("Erreur ingestion RSS")
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
        return [_item_to_dict(item) for item in list(self._items)[:limit]]

    def health_snapshot(self) -> dict:
        return {
            "enabled": self.is_enabled,
            "running": self.is_running,
            "feeds_configured": len(self.feed_specs),
            "feeds_ok_last_run": self._feeds_ok,
            "items_cached": len(self._items),
            "last_error": self._last_error,
            "last_fetch_at": self._last_fetch_at.isoformat() if self._last_fetch_at else None,
            "sources": [
                {"label": f["label"], "category": f.get("category", "finance"), "url": f["url"]}
                for f in self.feed_specs
            ],
        }


def _item_to_dict(item: RssNewsItem) -> dict:
    payload = asdict(item)
    payload["generated_at"] = item.generated_at
    return payload
