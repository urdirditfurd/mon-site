"""Create or update a demo admin account with trading funds."""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _decimal(value: str) -> Decimal:
    try:
        amount = Decimal(value)
    except Exception as exc:  # pragma: no cover - argparse guard
        raise argparse.ArgumentTypeError(f"invalid decimal value: {value}") from exc
    if amount < Decimal("0"):
        raise argparse.ArgumentTypeError("value must be >= 0")
    return amount.quantize(Decimal("0.01"))


async def _run(
    *,
    email: str,
    password: str,
    seed_total: Decimal,
    seed_engaged: Decimal,
    threshold: Decimal,
    keep_existing_password: bool,
) -> int:
    from sqlalchemy import select

    from app.core.security import hash_password
    from app.db.database import AsyncSessionLocal
    from app.models.trading_profile import TradingProfile
    from app.models.user import User
    from app.models.wallet import Wallet

    target_engaged = min(seed_engaged, seed_total)

    async with AsyncSessionLocal() as session:
        user = await session.scalar(select(User).where(User.email == email))
        created_user = user is None
        if user is None:
            user = User(
                email=email,
                password_hash=hash_password(password),
                role="admin",
                is_active=True,
            )
            session.add(user)
            await session.flush()
        else:
            user.role = "admin"
            user.is_active = True
            if not keep_existing_password:
                user.password_hash = hash_password(password)

        wallet = await session.scalar(select(Wallet).where(Wallet.user_id == user.id))
        if wallet is None:
            wallet = Wallet(
                user_id=user.id,
                solde_total=Decimal("0.00"),
                solde_disponible=Decimal("0.00"),
                solde_engage=Decimal("0.00"),
            )
            session.add(wallet)

        profile = await session.scalar(select(TradingProfile).where(TradingProfile.user_id == user.id))
        if profile is None:
            profile = TradingProfile(
                user_id=user.id,
                seuil_probabilite_min=threshold,
                is_trading_active=True,
                max_orders_per_day=20,
                stop_loss_pct=Decimal("2.50"),
                max_drawdown_pct=Decimal("12.00"),
                last_risk_reset_date=date.today(),
                orders_today=0,
                cumulative_pnl_today=Decimal("0.00"),
                equity_peak=Decimal("0.00"),
                equity_current=Decimal("0.00"),
            )
            session.add(profile)

        if wallet.solde_total < seed_total:
            topup = seed_total - wallet.solde_total
            wallet.solde_total += topup
            wallet.solde_disponible += topup

        if wallet.solde_engage < target_engaged:
            needed = target_engaged - wallet.solde_engage
            if wallet.solde_disponible < needed:
                topup = needed - wallet.solde_disponible
                wallet.solde_total += topup
                wallet.solde_disponible += topup
            wallet.solde_disponible -= needed
            wallet.solde_engage += needed

        minimum_total = wallet.solde_disponible + wallet.solde_engage
        if wallet.solde_total < minimum_total:
            wallet.solde_total = minimum_total

        profile.seuil_probabilite_min = threshold
        profile.is_trading_active = True
        profile.risk_block_reason = None
        profile.last_risk_reset_date = date.today()
        profile.orders_today = 0
        profile.cumulative_pnl_today = Decimal("0.00")
        profile.equity_current = wallet.solde_total
        profile.equity_peak = wallet.solde_total

        await session.commit()

        print("[seed] done")
        print(f"[seed] user_created={created_user}")
        print(f"[seed] email={user.email}")
        print(f"[seed] role={user.role}")
        print(f"[seed] trading_active={profile.is_trading_active}")
        print(f"[seed] seuil_probabilite_min={profile.seuil_probabilite_min}")
        print(f"[seed] wallet_total={wallet.solde_total}")
        print(f"[seed] wallet_disponible={wallet.solde_disponible}")
        print(f"[seed] wallet_engage={wallet.solde_engage}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Seed a zero-tech demo admin account")
    parser.add_argument("--email", default="admin@trading-ia.com")
    parser.add_argument("--password", default="Admin!ChangeMe2026")
    parser.add_argument("--seed-total", type=_decimal, default=Decimal("10000.00"))
    parser.add_argument("--seed-engaged", type=_decimal, default=Decimal("2500.00"))
    parser.add_argument("--threshold", type=_decimal, default=Decimal("75.00"))
    parser.add_argument(
        "--keep-existing-password",
        action="store_true",
        help="Do not overwrite password if user already exists",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    return asyncio.run(
        _run(
            email=args.email,
            password=args.password,
            seed_total=args.seed_total,
            seed_engaged=args.seed_engaged,
            threshold=args.threshold,
            keep_existing_password=args.keep_existing_password,
        )
    )


if __name__ == "__main__":
    raise SystemExit(main())
