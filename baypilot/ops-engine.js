/**
 * Pilotage DFY : onboarding, P&L, rapport hebdo.
 * Pas d'achat fournisseur autonome — le rapport le rappelle.
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_ONBOARDING = {
  contractSigned: false,
  ebayOauth: false,
  policies: false,
  firstListing: false,
  savInbox: false,
  autoPublishArmed: false,
};

const ONBOARDING_STEPS = [
  ["contractSigned", "Faire signer le mandat + CGV (tu opères son eBay)"],
  ["ebayOauth", "Lier le compte eBay OAuth en production"],
  ["policies", "Créer les Business Policies (livraison / paiement / retours)"],
  ["firstListing", "Publier à la main 1 listing validé (photos, titre, marge ≥ 5 %)"],
  ["savInbox", "Vérifier l'inbox questions + My Messages"],
  ["autoPublishArmed", "Armer Auto-Publish seulement après 5 listings OK"],
];

const EBAY_FEE_RATE = 0.13;

function isRealEbayOrderRef(ref) {
  const r = String(ref || "");
  if (!r || /^AO-/i.test(r) || /^DEMO/i.test(r)) return false;
  return r.length >= 12 || /^\d{2}-\d+-\d+/.test(r);
}

function defaultOpsState(overrides = {}) {
  return {
    onboarding: { ...DEFAULT_ONBOARDING, ...(overrides.onboarding || {}) },
    feeEur: Number(overrides.feeEur) || 1800,
    notes: String(overrides.notes || ""),
    updatedAt: overrides.updatedAt || null,
  };
}

function loadOpsState(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return defaultOpsState();
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return defaultOpsState({
      onboarding: raw.onboarding,
      feeEur: raw.feeEur,
      notes: raw.notes,
      updatedAt: raw.updatedAt,
    });
  } catch (_) {
    return defaultOpsState();
  }
}

function saveOpsState(filePath, state) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const next = defaultOpsState({
    ...state,
    onboarding: state.onboarding,
    feeEur: state.feeEur,
    notes: state.notes,
    updatedAt: new Date().toISOString(),
  });
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2));
  return next;
}

function mergeOnboarding(stored = {}, live = {}) {
  const base = { ...DEFAULT_ONBOARDING, ...stored };
  return {
    ...base,
    ebayOauth: Boolean(base.ebayOauth || live.ebayOauth),
    policies: Boolean(base.policies || live.policies),
    firstListing: Boolean(base.firstListing || (Number(live.publishedCount) || 0) > 0),
    savInbox: Boolean(base.savInbox || (Number(live.savCount) || 0) > 0),
    autoPublishArmed: Boolean(base.autoPublishArmed),
  };
}

function nextOnboardingStep(onboarding = {}) {
  const merged = { ...DEFAULT_ONBOARDING, ...onboarding };
  for (const [key, label] of ONBOARDING_STEPS) {
    if (!merged[key]) return { key, label, done: false };
  }
  return { key: "done", label: "Onboarding terminé — tu peux scaler ce client", done: true };
}

function isAutoPublishArmed(state) {
  return Boolean(state?.onboarding?.autoPublishArmed);
}

function costForOrder(order, listings = []) {
  const url = String(order?.source_url || "");
  if (url) {
    const hit = listings.find((l) => String(l.source_url || "") === url && Number(l.cost_price) > 0);
    if (hit) return Number(hit.cost_price);
  }
  const amount = Number(order?.amount) || 0;
  return Number((amount * 0.55).toFixed(2));
}

function startOfWeek(now = new Date()) {
  const d = new Date(now);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function inCurrentWeek(iso, now = new Date()) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= startOfWeek(now).getTime();
}

function computePnl({ listings = [], orders = [], feeRate = EBAY_FEE_RATE } = {}) {
  const ebayOrders = orders.filter((o) => isRealEbayOrderRef(o.order_ref));
  const gmv = ebayOrders.reduce((s, o) => s + (Number(o.amount) || 0), 0);
  const cogs = ebayOrders.reduce((s, o) => s + costForOrder(o, listings), 0);
  const fees = gmv * feeRate;
  const net = gmv - cogs - fees;
  const pending = ebayOrders.filter((o) => o.status === "pending").length;
  const published = listings.filter((l) => String(l.ebay_listing_id || "").trim()).length;
  const queued = listings.filter((l) => !String(l.ebay_listing_id || "").trim()).length;
  return {
    orders: ebayOrders.length,
    pendingOrders: pending,
    gmv: Number(gmv.toFixed(2)),
    cogs: Number(cogs.toFixed(2)),
    fees: Number(fees.toFixed(2)),
    net: Number(net.toFixed(2)),
    netPct: gmv > 0 ? Number(((net / gmv) * 100).toFixed(1)) : 0,
    published,
    queued,
    avgTicket: ebayOrders.length ? Number((gmv / ebayOrders.length).toFixed(2)) : 0,
    paymentNote: "Paiement fournisseur toujours manuel — BayPilot prépare la commande, tu valides le paiement.",
  };
}

function buildWeeklyReport({
  client = {},
  listings = [],
  orders = [],
  sav = [],
  publishLog = [],
  opsState = null,
  live = {},
  now = new Date(),
} = {}) {
  const state = opsState || defaultOpsState({ feeEur: client.feeEur });
  const onboarding = mergeOnboarding(state.onboarding, live);
  const next = nextOnboardingStep(onboarding);
  const pnl = computePnl({ listings, orders });
  const weekOrders = orders.filter(
    (o) => isRealEbayOrderRef(o.order_ref) && inCurrentWeek(o.created_at, now)
  );
  const weekGmv = weekOrders.reduce((s, o) => s + (Number(o.amount) || 0), 0);
  const weekPublished = publishLog.filter((row) => inCurrentWeek(row.published_at, now) && row.status === "published");
  const unansweredSav = sav.filter((m) => {
    const st = String(m.status || "").toLowerCase();
    return st === "new" || st === "unanswered" || st === "pending";
  });
  const thinMargin = listings.filter((l) => {
    const sell = Number(l.suggested_price) || 0;
    const cost = Number(l.cost_price) || 0;
    if (sell <= 0 || cost <= 0) return false;
    const netPct = ((sell * (1 - EBAY_FEE_RATE) - cost) / sell) * 100;
    return netPct < 5;
  });

  const actions = [];
  if (!next.done) actions.push({ level: "warn", text: `Onboarding : ${next.label}` });
  if (pnl.pendingOrders > 0) {
    actions.push({
      level: "warn",
      text: `${pnl.pendingOrders} vente(s) à traiter — préparer chez le fournisseur, payer à la main, avancer le statut.`,
    });
  }
  if (unansweredSav.length > 0) {
    actions.push({ level: "warn", text: `${unansweredSav.length} message(s) acheteur sans réponse.` });
  }
  if (thinMargin.length > 0) {
    actions.push({
      level: "warn",
      text: `${thinMargin.length} listing(s) sous 5 % net — à retirer ou re-pricer.`,
    });
  }
  if (!onboarding.autoPublishArmed) {
    actions.push({
      level: "info",
      text: "Auto-Publish désarmé (sécurité DFY). Ne l'arme qu'après 5 listings validés.",
    });
  }
  if (actions.length === 0) {
    actions.push({ level: "ok", text: "Rien de bloquant — envoie le rapport au client." });
  }

  const from = startOfWeek(now).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);

  return {
    product: "BayPilot",
    client: {
      id: client.id || null,
      name: client.name || "Client",
      marketplace: client.marketplace || "EBAY_FR",
      feeEur: Number(state.feeEur) || 1800,
    },
    period: { from, to },
    onboarding,
    nextStep: next,
    kpis: {
      weekGmv: Number(weekGmv.toFixed(2)),
      weekOrders: weekOrders.length,
      weekPublished: weekPublished.length,
      unansweredSav: unansweredSav.length,
      pendingOrders: pnl.pendingOrders,
      allTime: pnl,
    },
    actions,
    paymentNeverAutonomous: true,
  };
}

function reportToHtml(report) {
  const rows = (report.actions || [])
    .map((a) => `<li><strong>${a.level}</strong> — ${escapeHtml(a.text)}</li>`)
    .join("");
  const k = report.kpis || {};
  const all = k.allTime || {};
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Rapport ${escapeHtml(report.client?.name || "")}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;color:#1a1f3d}
  h1{font-size:1.4rem} .kpis{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
  .card{border:1px solid #d4d4f0;border-radius:12px;padding:12px 14px}
  .muted{color:#64748b;font-size:12px}
</style></head><body>
  <p class="muted">BayPilot · ${escapeHtml(report.period?.from)} → ${escapeHtml(report.period?.to)}</p>
  <h1>${escapeHtml(report.client?.name || "Client")}</h1>
  <p>Honoraires : <strong>${report.client?.feeEur || 0} € / mois</strong> · ${escapeHtml(report.client?.marketplace || "")}</p>
  <div class="kpis">
    <div class="card">CA semaine<br><strong>${k.weekGmv || 0} €</strong></div>
    <div class="card">Ventes semaine<br><strong>${k.weekOrders || 0}</strong></div>
    <div class="card">Publiés semaine<br><strong>${k.weekPublished || 0}</strong></div>
    <div class="card">SAV ouvert<br><strong>${k.unansweredSav || 0}</strong></div>
    <div class="card">CA cumulé<br><strong>${all.gmv || 0} €</strong></div>
    <div class="card">Net estimé cumulé<br><strong>${all.net || 0} € (${all.netPct || 0} %)</strong></div>
  </div>
  <h2>À faire cette semaine</h2>
  <ul>${rows}</ul>
  <p class="muted">Le paiement fournisseur n'est jamais automatique. Prochaine étape onboarding : ${escapeHtml(report.nextStep?.label || "")}</p>
</body></html>`;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = {
  DEFAULT_ONBOARDING,
  ONBOARDING_STEPS,
  EBAY_FEE_RATE,
  isRealEbayOrderRef,
  defaultOpsState,
  loadOpsState,
  saveOpsState,
  mergeOnboarding,
  nextOnboardingStep,
  isAutoPublishArmed,
  costForOrder,
  computePnl,
  buildWeeklyReport,
  reportToHtml,
  startOfWeek,
};
