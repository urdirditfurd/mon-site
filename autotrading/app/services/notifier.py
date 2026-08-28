"""Notifications — in-app, Telegram (gratuit), email SMTP optionnel."""

from __future__ import annotations

import logging
import smtplib
from email.mime.text import MIMEText

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.entities import Notification

logger = logging.getLogger(__name__)


class NotificationService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        title: str,
        body: str,
        *,
        user_alias: str = "default",
        symbol: str | None = None,
        severity: str = "info",
        push_external: bool = True,
    ) -> Notification:
        notif = Notification(
            user_alias=user_alias,
            title=title,
            body=body,
            symbol=symbol,
            severity=severity,
        )
        self._session.add(notif)
        await self._session.flush()

        if push_external:
            sent = await self._send_telegram(f"🔔 {title}\n\n{body}")
            notif.sent_telegram = sent
            if settings.smtp_host:
                await self._send_email(title, body)

        await self._session.commit()
        await self._session.refresh(notif)
        return notif

    async def list_recent(self, user_alias: str = "default", limit: int = 20) -> list[Notification]:
        stmt = (
            select(Notification)
            .where(Notification.user_alias == user_alias)
            .order_by(Notification.created_at.desc())
            .limit(limit)
        )
        result = await self._session.execute(stmt)
        return list(result.scalars().all())

    async def mark_read(self, notification_id: str) -> None:
        stmt = select(Notification).where(Notification.id == notification_id)
        result = await self._session.execute(stmt)
        notif = result.scalar_one_or_none()
        if notif:
            notif.is_read = True
            await self._session.commit()

    async def _send_telegram(self, text: str) -> bool:
        if not settings.telegram_bot_token or not settings.telegram_chat_id:
            return False
        url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
        payload = {"chat_id": settings.telegram_chat_id, "text": text, "parse_mode": "HTML"}
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                return True
        except Exception as exc:
            logger.warning("Telegram notification failed: %s", exc)
            return False

    async def _send_email(self, subject: str, body: str) -> bool:
        if not settings.smtp_host or not settings.smtp_from:
            return False
        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"] = settings.smtp_from
        msg["To"] = settings.smtp_user or settings.smtp_from
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
                server.starttls()
                if settings.smtp_user and settings.smtp_password:
                    server.login(settings.smtp_user, settings.smtp_password)
                server.send_message(msg)
            return True
        except Exception as exc:
            logger.warning("Email notification failed: %s", exc)
            return False
