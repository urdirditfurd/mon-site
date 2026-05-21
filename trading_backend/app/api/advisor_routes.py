"""Conseiller IA conversationnel pour l'onboarding et le pilotage trading."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user
from app.db.database import get_session
from app.models.trading_profile import TradingProfile
from app.models.user import User
from app.models.user_preference import UserPreference
from app.models.wallet import Wallet
from app.schemas.advisor import AdvisorChatRequest, AdvisorChatResponse

router = APIRouter(prefix="/advisor", tags=["Conseiller IA"])

DISCLAIMER = (
    "SentiQ fournit une aide logicielle et pédagogique. Ce n'est pas un conseil financier personnalisé; "
    "validez toujours les risques, la fiscalité et la conformité avant toute exécution réelle."
)


def _build_contextual_answer(
    *,
    message: str,
    wallet: Wallet | None,
    preference: UserPreference | None,
    profile: TradingProfile | None,
) -> AdvisorChatResponse:
    lowered = message.casefold()
    actions: list[str] = []
    risk_flags: list[str] = []

    available = wallet.solde_disponible if wallet is not None else "0.00"
    engaged = wallet.solde_engage if wallet is not None else "0.00"
    threshold = (
        preference.minimum_probability_threshold
        if preference is not None
        else profile.seuil_probabilite_min
        if profile is not None
        else "80.00"
    )
    broker = preference.broker_platform if preference is not None else "simulation"

    if any(word in lowered for word in {"binance", "coinbase", "alpaca", "interactive", "broker", "courtier"}):
        actions.append("Choisir une plateforme dans l'onboarding, puis rester en paper trading tant que les clés API ne sont pas validées.")
        risk_flags.append("Les clés API réelles doivent être restreintes, chiffrées et jamais saisies dans un chat.")
    if any(word in lowered for word in {"capital", "depot", "dépôt", "virement", "banque"}):
        actions.append("Utiliser le module capital pour simuler le dépôt; un vrai paiement devra passer par Stripe, GoCardless, Tink ou un PSP régulé.")
        risk_flags.append("Ne jamais demander les identifiants bancaires directs de l'utilisateur.")
    if any(word in lowered for word in {"risque", "perte", "drawdown", "stop"}):
        actions.append("Limiter le capital engagé et ajuster stop-loss, drawdown maximal et seuil de probabilité avant activation live.")
    if any(word in lowered for word in {"crypto", "btc", "bitcoin", "eth"}):
        actions.append("Activer Crypto uniquement si la plateforme sélectionnée supporte Binance ou Coinbase.")
        risk_flags.append("La volatilité crypto nécessite un seuil de probabilité plus strict et des tailles de position réduites.")

    if not actions:
        actions.extend(
            [
                "Finaliser l'onboarding: plateforme, marchés, secteurs et seuil de probabilité.",
                "Commencer en simulation/paper trading avant toute connexion broker réelle.",
            ]
        )

    answer = (
        f"État actuel: broker={broker}, seuil IA={threshold}%, disponible={available}, engagé={engaged}. "
        "Ma recommandation opérationnelle est de valider le parcours en simulation, de ne déclencher que les signaux "
        "au-dessus du seuil choisi, puis de connecter un broker réel seulement après revue des risques et des clés API."
    )

    return AdvisorChatResponse(
        answer=answer,
        suggested_actions=actions,
        risk_flags=risk_flags,
        disclaimer=DISCLAIMER,
    )


@router.post("/chat", response_model=AdvisorChatResponse)
async def chat_with_advisor(
    payload: AdvisorChatRequest,
    session: AsyncSession = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> AdvisorChatResponse:
    """Répond aux questions utilisateur avec le contexte wallet/préférences courant."""

    wallet = await session.scalar(select(Wallet).where(Wallet.user_id == current_user.id))
    preference = await session.scalar(select(UserPreference).where(UserPreference.user_id == current_user.id))
    profile = await session.scalar(select(TradingProfile).where(TradingProfile.user_id == current_user.id))
    return _build_contextual_answer(
        message=payload.message,
        wallet=wallet,
        preference=preference,
        profile=profile,
    )
