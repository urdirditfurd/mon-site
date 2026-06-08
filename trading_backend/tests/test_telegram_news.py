"""Tests du parseur Telegram public preview."""

from __future__ import annotations

from app.services.telegram_news import (
    _TelegramPreviewParser,
    normalize_channel_username,
    posts_from_raw,
)


SAMPLE_HTML = """
<html><body>
<div class="tgme_widget_message_wrap js-widget_message_wrap">
  <div class="tgme_widget_message_text js-message_text">Bitcoin franchit un nouveau seuil</div>
  <time datetime="2026-05-21T10:00:00+00:00"></time>
  <a class="tgme_widget_message_date" href="https://t.me/sentiq_actus/42">10:00</a>
</div>
<div class="tgme_widget_message_wrap js-widget_message_wrap">
  <div class="tgme_widget_message_text js-message_text">CAC 40 en hausse de 0,4%</div>
  <time datetime="2026-05-21T09:30:00+00:00"></time>
  <a class="tgme_widget_message_date" href="https://t.me/sentiq_actus/41">09:30</a>
</div>
</body></html>
"""


def test_normalize_channel_username() -> None:
    assert normalize_channel_username("@sentiq_actus") == "sentiq_actus"
    assert normalize_channel_username("https://t.me/sentiq_actus") == "sentiq_actus"
    assert normalize_channel_username("https://t.me/s/sentiq_actus") == "sentiq_actus"


def test_parser_extracts_messages() -> None:
    parser = _TelegramPreviewParser()
    parser.feed(SAMPLE_HTML)
    messages = parser.messages
    assert len(messages) == 2
    assert messages[0]["text"] == "CAC 40 en hausse de 0,4%"
    assert messages[1]["text"] == "Bitcoin franchit un nouveau seuil"
    assert "sentiq_actus/41" in messages[0]["url"]


def test_posts_from_raw_maps_sentiq_fields() -> None:
    parser = _TelegramPreviewParser()
    parser.feed(SAMPLE_HTML)
    posts = posts_from_raw(parser.messages, "sentiq_actus")
    assert len(posts) == 2
    assert posts[0].source == "Telegram @sentiq_actus"
    assert posts[0].impact_label == "telegram"
    assert posts[0].url is not None
