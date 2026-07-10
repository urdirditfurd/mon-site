"""Orchestrateur — scan marché mondial, persistance, heartbeat 24/7."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.entities import MarketScan
from app.services.analyzer import analyze_snapshot
from app.services.market_data import fetch_market_snapshot
from app.services.notifier import NotificationService
from app.services.position_monitor import PositionMonitor
from app.services.recommender import build_recommendations
from app.services.universe import get_universe

logger = logging.getLogger(__name__)


class MarketScanner:
    def __init__(self) -> None:
        self._last_scan_at: datetime | None = None
        self._latest_recommendations = []
        self._running = False
        self._lock = asyncio.Lock()

    @property
    def last_scan_at(self) -> datetime | None:
        return self._last_scan_at

    @property
    def latest_recommendations(self):
        return self._latest_recommendations

    @property
    def is_running(self) -> bool:
        return self._running

    async def run_full_scan(self) -> int:
        async with self._lock:
            self._running = True
            try:
                return await self._scan()
            finally:
                self._running = False

    async def _scan(self) -> int:
        universe = get_universe()
        snapshots = []
        analyses = []

        # Fetch en parallèle par lots de 5 pour respecter rate limits gratuits
        batch_size = 5
        for i in range(0, len(universe), batch_size):
            batch = universe[i : i + batch_size]
            results = await asyncio.gather(
                *[fetch_market_snapshot(asset) for asset in batch],
                return_exceptions=True,
            )
            for asset, result in zip(batch, results):
                if isinstance(result, Exception) or result is None:
                    logger.warning("Scan ignoré pour %s", asset.symbol)
                    continue
                snapshots.append(result)
                analyses.append(analyze_snapshot(result))
            await asyncio.sleep(1.0)

        self._latest_recommendations = build_recommendations(snapshots, analyses)
        self._last_scan_at = datetime.now(UTC)

        async with AsyncSessionLocal() as session:
            for snap, analysis in zip(snapshots, analyses):
                scan = MarketScan(
                    symbol=snap.symbol,
                    asset_type=snap.asset_type,
                    name=snap.name,
                    price=snap.price,
                    currency=snap.currency,
                    change_pct_24h=snap.change_pct_24h,
                    buy_probability=analysis.buy_probability,
                    sell_probability=analysis.sell_probability,
                    signal=analysis.signal,
                    confidence=analysis.confidence,
                    reasoning=analysis.reasoning,
                )
                session.add(scan)
            await session.commit()

            if self._latest_recommendations:
                top = self._latest_recommendations[0]
                notifier = NotificationService(session)
                await notifier.create(
                    title=f"💡 Meilleure opportunité : {top.name}",
                    body=(
                        f"{top.beginner_summary}\n\n"
                        f"Probabilité : {top.buy_probability}% | Gain estimé : +{top.expected_gain_pct}% | "
                        f"Risque : {top.risk_level}."
                    ),
                    symbol=top.symbol,
                    severity="info",
                    push_external=True,
                )

        logger.info(
            "Scan terminé : %d actifs, %d recommandations",
            len(snapshots),
            len(self._latest_recommendations),
        )
        return len(snapshots)


class RuntimeScheduler:
    """Heartbeat 24/7 — scan marché + surveillance positions."""

    def __init__(self) -> None:
        self.scanner = MarketScanner()
        self._scan_task: asyncio.Task | None = None
        self._position_task: asyncio.Task | None = None
        self._watchdog_task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        self._stop.clear()
        self._scan_task = asyncio.create_task(self._market_loop(), name="market-scan-loop")
        self._position_task = asyncio.create_task(self._position_loop(), name="position-monitor-loop")
        self._watchdog_task = asyncio.create_task(self._watchdog_loop(), name="watchdog-loop")
        logger.info("Scheduler démarré (scan=%ss, positions=%ss)", settings.market_scan_interval_seconds, settings.position_check_interval_seconds)

    async def stop(self) -> None:
        self._stop.set()
        for task in (self._scan_task, self._position_task, self._watchdog_task):
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    async def _market_loop(self) -> None:
        await self.scanner.run_full_scan()
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(
                    self._stop.wait(),
                    timeout=settings.market_scan_interval_seconds,
                )
                break
            except asyncio.TimeoutError:
                await self.scanner.run_full_scan()

    async def _position_loop(self) -> None:
        while not self._stop.is_set():
            try:
                async with AsyncSessionLocal() as session:
                    monitor = PositionMonitor(session)
                    closed = await monitor.check_all_open_positions()
                    if closed:
                        logger.info("Positions clôturées : %d", closed)
            except Exception as exc:
                logger.exception("Erreur surveillance positions: %s", exc)
            try:
                await asyncio.wait_for(
                    self._stop.wait(),
                    timeout=settings.position_check_interval_seconds,
                )
                break
            except asyncio.TimeoutError:
                continue

    async def _watchdog_loop(self) -> None:
        while not self._stop.is_set():
            try:
                if self._scan_task and self._scan_task.done():
                    exc = self._scan_task.exception()
                    if exc:
                        logger.error("Scan loop crashed, restart: %s", exc)
                    self._scan_task = asyncio.create_task(self._market_loop(), name="market-scan-loop")
                if self._position_task and self._position_task.done():
                    exc = self._position_task.exception()
                    if exc:
                        logger.error("Position loop crashed, restart: %s", exc)
                    self._position_task = asyncio.create_task(self._position_loop(), name="position-monitor-loop")
            except Exception as exc:
                logger.exception("Watchdog error: %s", exc)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=settings.watchdog_interval_seconds)
                break
            except asyncio.TimeoutError:
                continue
