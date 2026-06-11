"""Tests parseur RSS."""

from __future__ import annotations

from app.services.rss_news import items_from_entries, parse_feed_specs, parse_rss_or_atom

SAMPLE_RSS = """<?xml version="1.0"?>
<rss><channel>
<item>
  <title>La Fed laisse ses taux inchangés</title>
  <link>https://example.com/fed</link>
  <description>Décision attendue par les marchés.</description>
  <pubDate>Tue, 20 May 2026 14:00:00 GMT</pubDate>
</item>
</channel></rss>
"""


def test_parse_rss_item() -> None:
    items = parse_rss_or_atom(SAMPLE_RSS, {"label": "Test", "category": "macro"}, limit=5)
    assert len(items) == 1
    assert "Fed" in items[0]["title"]


def test_items_from_entries_source_label() -> None:
    raw = parse_rss_or_atom(SAMPLE_RSS, {"label": "BBC Business", "category": "finance"})
    posts = items_from_entries(raw)
    assert posts[0].source == "BBC Business · Finance"
    assert posts[0].impact_label == "finance"


def test_parse_date_naive_and_aware_sortable() -> None:
    from datetime import datetime, timezone

    from app.services.rss_news import _ensure_utc, _parse_date, items_from_entries

    naive = datetime(2026, 5, 21, 10, 0, 0)
    aware = datetime(2026, 5, 21, 11, 0, 0, tzinfo=timezone.utc)
    entries = [
        {"title": "A", "summary": "a", "published": "", "label": "Test", "category": "finance", "link": ""},
        {"title": "B", "summary": "b", "published": "Tue, 20 May 2026 14:00:00 GMT", "label": "Test", "category": "finance", "link": ""},
    ]
    posts = items_from_entries(entries)
    posts.sort(key=lambda p: _ensure_utc(p.generated_at), reverse=True)
    assert len(posts) == 2
    assert _ensure_utc(naive).tzinfo is not None
    assert _parse_date("Tue, 20 May 2026 14:00:00 GMT").tzinfo is not None
