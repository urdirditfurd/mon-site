const API = window.location.origin;
let themeColor = "#6d7ddf";
const DESC_PALETTE = [
  "#6d7ddf", "#4452a8", "#242b52", "#e6e6fa", "#22c55e", "#16a34a",
  "#0ea5e9", "#0284c7", "#f59e0b", "#ef4444", "#ec4899", "#8b5cf6",
  "#14b8a6", "#84cc16", "#f97316", "#64748b", "#111827", "#a855f7",
];

function formatSavDate(raw) {
  if (!raw) return "Date —";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return String(raw).slice(0, 19);
  return dt.toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function toggleDarkMode(force) {
  const root = document.documentElement;
  const body = document.body;
  const next = typeof force === "boolean" ? force : !body.classList.contains("dark-mode");
  body.classList.toggle("dark-mode", next);
  root.classList.toggle("dark", next);
  localStorage.setItem("ebx-dark", next ? "1" : "0");
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = next ? "☀️" : "🌙";
  const chk = document.getElementById("settings-dark");
  if (chk) chk.checked = next;
}

function initDescPalette() {
  const render = (el, sizeClass) => {
    if (!el) return;
    el.innerHTML = DESC_PALETTE.map(
      (c) =>
        `<button type="button" class="color-swatch ${sizeClass} ${
          themeColor.toLowerCase() === c.toLowerCase() ? "active" : ""
        }" style="background:${c}" data-theme="${c}" title="${c}" onclick="setTheme('${c}', this)"></button>`
    ).join("");
  };
  render(document.getElementById("desc-color-palette"), "");
  render(document.getElementById("desc-color-palette-mini"), "");
}

if (typeof localStorage !== "undefined" && localStorage.getItem("ebx-dark") === "1") {
  document.addEventListener("DOMContentLoaded", () => toggleDarkMode(true));
}

let titleData = null;
let titleTab = "keywords";
let selectedKeywords = [];
let kwPageIdx = 0;
const KW_PER_PAGE = 8;
let rankingsPeriod = "month";
let competitorPeriod = "month";
let lastCompetitor = null;
let lastDesc = null;
let descImages = [];
let replaceImgIdx = 0;

const PAGE_META = {
  dashboard: ["Dashboard", "Ce qui se passe en temps réel sur eBay"],
  analytics: ["Analytics", "Performance et tendances"],
  rankings: ["Classements", "Meilleures ventes eBay"],
  competitors: ["Compétiteurs", "Analysez n'importe quel vendeur eBay"],
  sniper: ["Product Sniper", "Auto-Snipe — listing automatique"],
  "auto-order": ["Auto-Order", "Commandes fournisseurs automatisées"],
  listings: ["Mes Listings", "Historique des générations"],
  "title-builder": ["Title Builder", "Construisez un titre SEO eBay"],
  description: ["Description Builder", "Générez une description HTML en 1 clic"],
  sav: ["SAV", "Messages eBay — brouillons IA & escalade"],
  settings: ["Paramètres", "Configuration locale EBX"],
};

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function navigate(page) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));
  document.getElementById("page-" + page)?.classList.add("active");
  document.querySelector(`[data-page="${page}"]`)?.classList.add("active");
  const meta = PAGE_META[page] || [page, ""];
  document.getElementById("page-title").textContent = meta[0];
  document.getElementById("page-subtitle").textContent = meta[1];

  if (page === "dashboard") loadDashboard();
  if (page === "analytics") loadAnalytics();
  if (page === "rankings") loadRankings();
  if (page === "competitors") loadCompetitorHistory();
  if (page === "auto-order") {
    loadSupplierConfig();
    loadOrders();
  }
  if (page === "listings") loadListings();
  if (page === "sav") loadSav();
  if (page === "settings") loadSettings();
}

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    navigate(link.dataset.page);
  });
});

document.getElementById("rankings-period")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-period]");
  if (!btn) return;
  rankingsPeriod = btn.dataset.period;
  document.querySelectorAll("#rankings-period .period-pill").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  loadRankings();
});

document.getElementById("sniper-tabs")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-stab]");
  if (!btn) return;
  document.querySelectorAll(".sniper-tab").forEach((b) => {
    b.classList.remove("active");
    b.classList.add("text-zinc-500", "bg-zinc-100");
  });
  btn.classList.add("active");
  btn.classList.remove("text-zinc-500", "bg-zinc-100");
  const tab = btn.dataset.stab;
  document.getElementById("sniper-auto").classList.toggle("hidden", tab !== "auto");
  document.getElementById("sniper-bulking").classList.toggle("hidden", tab !== "bulking");
  document.getElementById("sniper-sub").classList.toggle("hidden", tab !== "sub");
  document.getElementById("sniper-manual")?.classList.toggle("hidden", tab !== "manual");
});

document.querySelectorAll(".desc-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".desc-tab").forEach((b) => {
      b.classList.remove("active");
      b.classList.add("text-zinc-500");
    });
    btn.classList.add("active");
    btn.classList.remove("text-zinc-500");
    const tab = btn.dataset.dtab;
    document.getElementById("desc-preview-wrap").classList.toggle("hidden", tab !== "preview");
    document.getElementById("desc-html-wrap").classList.toggle("hidden", tab !== "html");
  });
});

document.getElementById("snipe-real")?.addEventListener("change", (e) => {
  if (e.target.checked) document.getElementById("snipe-test").checked = false;
});
document.getElementById("snipe-test")?.addEventListener("change", (e) => {
  if (e.target.checked) document.getElementById("snipe-real").checked = false;
});

async function checkHealth() {
  const el = document.getElementById("api-status");
  try {
    const res = await fetch(API + "/api/health");
    const json = await res.json();
    el.className = "text-xs bg-green-50 text-green-600 px-2.5 py-1 rounded-full font-medium";
    el.textContent = "● API connectée";
    document.getElementById("settings-llm").textContent = json.llm_url || "—";
    const mode = document.getElementById("settings-mode");
    if (mode) mode.textContent = json.mode || "live+fallback";
  } catch {
    el.className = "text-xs bg-red-50 text-red-500 px-2.5 py-1 rounded-full font-medium";
    el.textContent = "● API hors ligne";
  }
  refreshBotStatus();
}

async function refreshBotStatus() {
  const el = document.getElementById("bot-status");
  if (!el) return;
  try {
    const res = await fetch(API + "/api/bot-status");
    const json = await res.json();
    const d = json.data || {};
    el.textContent = d.label || "Auto-Order";
    el.title = d.autoOrderMode
      ? "Bot Auto-Order activé — traite la file de commandes"
      : "Bot Auto-Order désactivé — active-le dans Auto-Order. « En attente » = commandes pending.";
    el.className = d.autoOrderMode
      ? "text-xs bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full font-semibold cursor-pointer"
      : "text-xs bg-[#6d7ddf]/15 text-[#4452a8] px-2.5 py-1 rounded-full font-semibold cursor-pointer";
    el.onclick = () => navigate("auto-order");
  } catch (_) {}
}

let dashCalendarEvents = [];
let calViewYear = new Date().getFullYear();
let calViewMonth = new Date().getMonth(); // 0-based
let calSelectedEvent = null;
let marketTickTimer = null;

function formatEuro(n, decimals = 0) {
  const v = Number(n) || 0;
  return (
    v.toLocaleString("fr-FR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }) + " €"
  );
}

function formatCaShort(n) {
  const v = Number(n) || 0;
  if (v >= 1000) return Math.round(v / 1000) + "k €";
  return formatEuro(v, 0);
}

function productThumbHtml(image, title, sizeClass = "w-12 h-12") {
  const src = image || "";
  const letter = escapeHtml(String(title || "?").slice(0, 1).toUpperCase());
  const fallback = `<div class="${sizeClass} rounded-lg bg-lunar-200 flex items-center justify-center text-sm font-bold text-[#4452a8]">${letter}</div>`;
  if (!src) return fallback;
  // referrerpolicy: eBay/Amazon bloquent souvent le hotlink sinon (carrés gris)
  return `<img src="${escapeHtml(
    src
  )}" alt="" loading="lazy" referrerpolicy="no-referrer" class="${sizeClass} rounded-lg object-cover bg-zinc-100" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'${sizeClass} rounded-lg bg-lunar-200 flex items-center justify-center text-sm font-bold text-[#4452a8]',textContent:'${letter}'}))" />`;
}

function bindDashboardCalendarControls() {
  const prev = document.getElementById("cal-prev");
  const next = document.getElementById("cal-next");
  const today = document.getElementById("cal-today");
  if (prev && !prev.dataset.bound) {
    prev.dataset.bound = "1";
    prev.addEventListener("click", () => {
      calViewMonth -= 1;
      if (calViewMonth < 0) {
        calViewMonth = 11;
        calViewYear -= 1;
      }
      calSelectedEvent = null;
      renderDashCalendar();
    });
  }
  if (next && !next.dataset.bound) {
    next.dataset.bound = "1";
    next.addEventListener("click", () => {
      calViewMonth += 1;
      if (calViewMonth > 11) {
        calViewMonth = 0;
        calViewYear += 1;
      }
      calSelectedEvent = null;
      renderDashCalendar();
    });
  }
  if (today && !today.dataset.bound) {
    today.dataset.bound = "1";
    today.addEventListener("click", () => {
      const now = new Date();
      calViewYear = now.getFullYear();
      calViewMonth = now.getMonth();
      calSelectedEvent = null;
      renderDashCalendar();
    });
  }
}

/** Map jour du mois → événement (utilise month/day locaux, pas ISO UTC). */
function eventsForViewMonth() {
  const byDay = {};
  for (const e of dashCalendarEvents) {
    const year = e.year || Number(String(e.date || "").slice(0, 4)) || calViewYear;
    if (year !== calViewYear) continue;
    const startMonth = Number(e.month);
    const startDay = Number(e.day);
    if (!startMonth || !startDay) continue;
    const duration = Math.max(1, Number(e.durationDays) || 1);
    for (let i = 0; i < duration; i++) {
      const d = new Date(year, startMonth - 1, startDay + i);
      if (d.getFullYear() !== calViewYear || d.getMonth() !== calViewMonth) continue;
      const day = d.getDate();
      // Garder l'événement principal sur le 1er jour ; les suivants restent marqués
      if (!byDay[day] || i === 0) byDay[day] = { ...e, isStart: i === 0 };
    }
  }
  return byDay;
}

function renderCalCountdown(ev) {
  const countdown = document.getElementById("dash-cal-countdown");
  if (!countdown) return;
  if (!ev) {
    countdown.innerHTML = `<span class="text-zinc-500">Navigue dans le mois — les icônes marquent Assomption, Automne, Halloween…</span>`;
    return;
  }
  const days = ev.daysUntil;
  let when;
  if (ev.phase === "live") when = `En cours · ${escapeHtml(ev.name)}`;
  else if (typeof days === "number" && days > 0) when = `Il reste ${days} jour${days > 1 ? "s" : ""} avant ${escapeHtml(ev.name)}`;
  else if (typeof days === "number" && days === 0) when = `C'est aujourd'hui · ${escapeHtml(ev.name)}`;
  else if (typeof days === "number" && days < 0) when = `${escapeHtml(ev.name)} · passé il y a ${Math.abs(days)} j`;
  else when = escapeHtml(ev.name);
  const dateLabel = ev.date
    ? new Date(ev.year || calViewYear, (ev.month || 1) - 1, ev.day || 1).toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
      })
    : "";
  countdown.innerHTML = `<div class="flex items-start gap-2">
    <span class="text-lg leading-none">${ev.icon || "📅"}</span>
    <div>
      <p class="font-semibold">${when}</p>
      <p class="text-[11px] text-emerald-700/80 mt-0.5">${escapeHtml(dateLabel)}${dateLabel && ev.niche ? " · " : ""}${escapeHtml(ev.niche || "")}</p>
      <p class="text-[11px] text-emerald-800/70 mt-0.5">${escapeHtml(ev.tip || "")}</p>
    </div>
  </div>`;
}

function renderDashCalendar() {
  const grid = document.getElementById("dash-cal-grid");
  const label = document.getElementById("cal-month-label");
  if (!grid || !label) return;

  const monthNames = [
    "Janvier",
    "Février",
    "Mars",
    "Avril",
    "Mai",
    "Juin",
    "Juillet",
    "Août",
    "Septembre",
    "Octobre",
    "Novembre",
    "Décembre",
  ];
  label.textContent = `${monthNames[calViewMonth]} ${calViewYear}`;

  const now = new Date();
  const first = new Date(calViewYear, calViewMonth, 1);
  const startPad = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
  const eventByDay = eventsForViewMonth();

  let html = "";
  for (let i = 0; i < startPad; i++) html += `<span class="h-10"></span>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const isToday =
      day === now.getDate() && calViewMonth === now.getMonth() && calViewYear === now.getFullYear();
    const ev = eventByDay[day];
    let cls =
      "h-10 rounded-lg text-[11px] flex flex-col items-center justify-center relative font-medium text-zinc-700 cursor-default";
    if (ev) cls += " cursor-pointer";
    if (isToday) cls += " ring-2 ring-emerald-500 bg-emerald-50 text-emerald-800 font-bold";
    else if (ev && ev.isStart) cls += " bg-[#6d7ddf]/20 text-[#4452a8] font-semibold";
    else if (ev) cls += " bg-[#6d7ddf]/10 text-[#4452a8]";
    else cls += " hover:bg-lunar-100";
    const tip = ev ? ` title="${escapeHtml(ev.name)} — ${escapeHtml(ev.tip || "")}"` : "";
    const icon = ev
      ? `<span class="text-sm leading-none ${ev.isStart ? "" : "opacity-50"}" aria-hidden="true">${ev.icon || "•"}</span>`
      : `<span class="text-sm leading-none opacity-0" aria-hidden="true">·</span>`;
    html += `<button type="button" data-cal-day="${day}" class="${cls}"${tip}>
      <span class="leading-none text-[11px]">${day}</span>
      ${icon}
    </button>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll("[data-cal-day]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const d = Number(btn.dataset.calDay);
      const ev = eventByDay[d];
      if (!ev) return;
      calSelectedEvent = ev;
      renderCalCountdown(ev);
    });
  });

  // Footer : événement sélectionné, sinon prochain à venir, sinon 1er du mois affiché
  const monthEvents = Object.values(eventByDay).filter((e) => e.isStart);
  const upcoming = dashCalendarEvents.find((e) => e.phase === "live" || e.phase === "prep" || e.phase === "upcoming");
  const focus =
    calSelectedEvent ||
    monthEvents.find((e) => e.phase === "live" || e.phase === "prep" || e.phase === "upcoming") ||
    upcoming ||
    monthEvents[0] ||
    null;
  renderCalCountdown(focus);
}

async function loadDashboard() {
  bindDashboardCalendarControls();
  const res = await fetch(API + "/api/dashboard");
  const json = await res.json();
  const d = json.data || {};

  const greet = document.getElementById("dash-greeting");
  if (greet) {
    const name = d.greetName && d.greetName !== "vendeur" ? d.greetName : "vendeur";
    greet.textContent = `Bonjour, ${name}`;
  }

  const pulse = d.marketPulse || {};
  const caEl = document.getElementById("dash-market-ca");
  const tickEl = document.getElementById("dash-market-tick");
  const labelEl = document.getElementById("dash-market-label");
  const shopEl = document.getElementById("dash-shop-ca");
  // Jamais le CA boutique ici : 16 € chez toi = ton CA sync, pas le marché EBX (~200k)
  let marketRevenueLive = Number(pulse.marketRevenue);
  if (!Number.isFinite(marketRevenueLive) || marketRevenueLive < 1000) {
    marketRevenueLive = 180000;
  }
  if (caEl) caEl.textContent = formatEuro(marketRevenueLive, 2);
  if (tickEl) tickEl.textContent = `↑ +${formatEuro(pulse.tick ?? 12, 2)} à l'instant`;
  if (labelEl) {
    labelEl.textContent = pulse.label || "estimation CA marché eBay FR aujourd'hui";
  }
  if (shopEl) {
    const shop = Number(d.revenue) || 0;
    const src =
      d.revenueSource === "ebay_orders"
        ? "eBay sync"
        : d.revenueSource === "local_orders"
          ? "local"
          : "estim.";
    shopEl.textContent = `Ton CA boutique : ${formatEuro(shop, 2)} (${src})`;
  }

  if (marketTickTimer) clearInterval(marketTickTimer);
  marketTickTimer = setInterval(() => {
    if (!caEl || !tickEl) return;
    const bump = 8 + Math.random() * 55;
    marketRevenueLive += bump;
    caEl.textContent = formatEuro(marketRevenueLive, 2);
    tickEl.textContent = `↑ +${formatEuro(bump, 2)} à l'instant`;
  }, 4500);

  const trendMeta = document.getElementById("dash-trending-meta");
  if (trendMeta) {
    trendMeta.innerHTML = d.trendingLive
      ? `Top ventes du marché — <span class="text-emerald-600 font-medium">Données en temps réel</span>`
      : "Top ventes du marché — Seed / fallback";
  }

  const trendBox = document.getElementById("dash-trending");
  if (trendBox) {
    const items = d.trending || [];
    trendBox.innerHTML = items.length
      ? items
          .slice(0, 8)
          .map((t, i) => {
            const ca = t.ca != null ? t.ca : Math.round((Number(t.price) || 0) * (Number(t.sold) || 0));
            const img = productThumbHtml(t.image, t.title, "w-10 h-10");
            const title = t.url
              ? `<a href="${escapeHtml(t.url)}" target="_blank" rel="noopener" class="font-medium text-[#4452a8] hover:underline line-clamp-2 leading-snug">${escapeHtml(
                  t.title
                )}</a>`
              : `<p class="font-medium text-ink-900 line-clamp-2 leading-snug">${escapeHtml(t.title)}</p>`;
            return `<div class="grid grid-cols-[2rem_2.5rem_1fr] sm:grid-cols-[2rem_2.5rem_1fr_3.5rem_3.5rem_3.5rem] gap-2 items-center py-2.5 px-1 hover:bg-lunar-50 rounded-lg">
              <span class="w-7 h-7 rounded-md border border-[#6d7ddf]/40 text-[#4452a8] text-xs font-bold flex items-center justify-center">${
                i + 1
              }</span>
              ${img}
              <div class="min-w-0">${title}</div>
              <div class="hidden sm:block text-right text-sm font-semibold text-emerald-600">${t.sold || "—"}</div>
              <div class="hidden sm:block text-right text-sm font-bold">${formatEuro(t.price, 0)}</div>
              <div class="hidden sm:block text-right text-sm font-bold text-emerald-600">${formatCaShort(ca)}</div>
            </div>`;
          })
          .join("")
      : `<p class="text-zinc-400 text-sm py-4">Aucune tendance.</p>`;
  }

  const nicheBox = document.getElementById("dash-niches");
  if (nicheBox) {
    const niches = d.niches || [];
    nicheBox.innerHTML = niches.length
      ? niches
          .map((n) => {
            const thumb = n.image
              ? `<img src="${escapeHtml(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="w-9 h-9 rounded-lg object-cover" onerror="this.style.display='none'" />`
              : "";
            return `<div class="flex items-center gap-2.5">
            <span class="w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0 overflow-hidden" style="background:${escapeHtml(
              n.color || "#e6e6fa"
            )}">${thumb || n.icon || "📈"}</span>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium truncate">${escapeHtml(n.name)}</p>
              <p class="text-[11px] text-zinc-400">${escapeHtml(n.caLabel || "")} CA</p>
            </div>
            <span class="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full shrink-0">+${
              n.growth
            }%</span>
          </div>`;
          })
          .join("")
      : `<p class="text-zinc-400 text-sm">—</p>`;
  }

  dashCalendarEvents = d.calendar || [];
  renderDashCalendar();

  const sellersBox = document.getElementById("dash-sellers");
  if (sellersBox) {
    const sellers = d.topSellers || [];
    sellersBox.innerHTML = sellers.length
      ? sellers
          .map(
            (s) => `<button type="button" data-seller="${escapeHtml(s.name)}" class="dash-seller-btn w-full flex items-center gap-2.5 text-left hover:bg-lunar-50 rounded-xl px-1 py-1.5 transition">
            <span class="w-8 h-8 rounded-full bg-[#6d7ddf]/15 text-[#4452a8] flex items-center justify-center text-xs font-bold shrink-0">${escapeHtml(
              String(s.name || "?").slice(0, 1).toUpperCase()
            )}</span>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium truncate">${escapeHtml(s.name)}</p>
              <p class="text-[11px] text-emerald-600">${Number(s.feedback).toFixed(1)}% positif</p>
            </div>
            <span class="text-sm font-bold text-ink-900 shrink-0">${Number(s.sales).toLocaleString("fr-FR")}</span>
            <span class="text-[10px] text-zinc-400">ventes</span>
          </button>`
          )
          .join("")
      : `<p class="text-zinc-400 text-sm">Aucun vendeur.</p>`;
    sellersBox.querySelectorAll(".dash-seller-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = document.getElementById("competitor-input");
        if (input) input.value = btn.dataset.seller || "";
        navigate("competitors");
      });
    });
  }

  const feed = document.getElementById("pilotage-feed");
  if (feed) {
    const alerts = (d.pilotage || []).slice(0, 3);
    feed.innerHTML = alerts.length
      ? alerts
          .map((a) => {
            const color =
              a.level === "ok"
                ? "border-emerald-100 bg-emerald-50 text-emerald-900"
                : a.level === "warn"
                  ? "border-amber-100 bg-amber-50 text-amber-900"
                  : "border-zinc-100 bg-zinc-50 text-zinc-700";
            return `<div class="rounded-xl border px-3 py-2 ${color}"><p class="font-medium text-xs">${escapeHtml(
              a.title
            )}</p><p class="text-[11px] mt-0.5 opacity-80">${escapeHtml(a.detail)}</p></div>`;
          })
          .join("")
      : `<p class="text-zinc-400 text-xs">Aucune alerte.</p>`;
  }
}

async function loadAnalytics() {
  try {
    const res = await fetch(API + "/api/dashboard");
    const d = (await res.json()).data || {};
    const src =
      d.revenueSource === "ebay_orders"
        ? "Sync eBay (réel)"
        : "Aucune vente sync — 0 €";
    document.getElementById("analytics-kpis").innerHTML = [
      ["CA boutique", `${Number(d.revenue || 0).toFixed(2)} €`],
      ["Commandes", d.orders || 0],
      ["En attente", d.pendingOrders || 0],
    ]
      .map(
        ([l, v]) =>
          `<div class="bg-white rounded-2xl border p-5"><p class="text-xs text-zinc-400">${l}</p><p class="text-2xl font-bold mt-1">${v}</p><p class="text-[10px] text-zinc-400 mt-2">${src}</p></div>`
      )
      .join("");
    const orders = Number(d.orders || 0);
    const pending = Number(d.pendingOrders || 0);
    const margin = Number(d.margin || 0);
    const published = Number(d.published || 0);
    const listings = Number(d.listings || 0);
    const rows = [
      ["Marge estimée (sur ventes sync)", Math.min(100, Math.max(0, margin))],
      ["Commandes livrées / total", orders ? Math.round(((d.delivered || 0) / orders) * 100) : 0],
      ["En attente / commandes", orders ? Math.round((pending / orders) * 100) : 0],
      ["Listings publiés / total", listings ? Math.round((published / listings) * 100) : 0],
    ];
    document.getElementById("analytics-bars").innerHTML = rows
      .map(
        ([label, pct]) =>
          `<div><div class="flex justify-between text-sm mb-1"><span>${label}</span><span class="text-zinc-400">${pct}%</span></div><div class="h-2 bg-zinc-100 rounded-full overflow-hidden"><div class="h-full bg-brand-500 rounded-full" style="width:${pct}%"></div></div></div>`
      )
      .join("");
  } catch (_) {
    document.getElementById("analytics-kpis").innerHTML = "";
    document.getElementById("analytics-bars").innerHTML = "";
  }
}

function periodFactor(period) {
  if (period === "day") return 0.05;
  if (period === "week") return 0.28;
  return 1;
}

async function loadRankings() {
  const res = await fetch(API + `/api/rankings?period=${rankingsPeriod}`);
  const json = await res.json();
  const factor = periodFactor(rankingsPeriod);
  const src = document.getElementById("rankings-source");
  if (src) {
    src.innerHTML = json.live
      ? `<span class="inline-flex items-center gap-1.5"><span class="text-[10px] font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Live</span> ${escapeHtml(json.source || "eBay")}</span>`
      : "Fallback local (ajoutez EBAY_PROD_CLIENT_ID pour le live)";
  }
  const algoEl = document.getElementById("rankings-algo");
  if (algoEl && json.algo) algoEl.textContent = "Algo : " + json.algo;
  const list = document.getElementById("rankings-list");
  list.innerHTML = (json.data || [])
    .map((p, i) => {
      const rank = p.rank || i + 1;
      const sold = Math.max(1, Math.round((p.sold || 10) * factor));
      const price = Number(p.price || 0);
      const oldPrice = price > 0 ? (price * 1.35).toFixed(2) : null;
      const img = productThumbHtml(p.image, p.title, "w-14 h-14");
      const rankClass = rank <= 3 ? `rank-${rank}` : "text-zinc-400";
      const href = p.url || "#";
      return `<a href="${escapeHtml(href)}" target="_blank" class="flex items-center gap-4 p-4 hover:bg-zinc-50 transition">
        <span class="w-8 text-center font-bold text-lg ${rankClass}">${rank}</span>
        ${img}
        <div class="flex-1 min-w-0">
          <p class="font-medium text-sm truncate">${escapeHtml(p.title)}</p>
          <p class="text-xs text-zinc-400 mt-0.5">${escapeHtml(p.category || "eBay")}</p>
        </div>
        <div class="text-right shrink-0">
          <p class="text-sm text-emerald-600 font-medium">${sold} vendus</p>
          <p class="text-sm font-semibold">${price.toFixed(2)} €</p>
          ${oldPrice ? `<p class="text-xs text-zinc-400 line-through">${oldPrice} €</p>` : ""}
        </div>
      </a>`;
    })
    .join("") || `<p class="p-8 text-center text-zinc-300">Aucun classement.</p>`;
}

async function loadCompetitorHistory() {
  const res = await fetch(API + "/api/competitors/history");
  const json = await res.json();
  const box = document.getElementById("competitor-history");
  const rows = json.data || [];
  if (!rows.length) {
    box.innerHTML = `<p class="text-sm text-zinc-400 col-span-2">Aucune analyse récente.</p>`;
    return;
  }
  box.innerHTML = rows
    .map((r) => {
      let revenue = "—";
      try {
        const p = JSON.parse(r.payload || "{}");
        if (p.revenue != null) revenue = `${Number(p.revenue).toFixed(2)} €/mois`;
      } catch (_) {}
      return `<div class="bg-white border rounded-2xl p-4 flex items-center gap-3">
        <span class="text-xl">🇫🇷</span>
        <div class="flex-1 min-w-0">
          <p class="font-medium truncate">${escapeHtml(r.seller_name)}</p>
          <p class="text-xs text-emerald-600">${revenue}</p>
        </div>
        <button onclick="viewCompetitorHistory(${r.id})" class="text-xs px-3 py-1.5 bg-brand-50 text-brand-700 rounded-lg">Voir les stats</button>
        <button onclick="deleteCompetitorHistory(${r.id})" class="text-zinc-300 hover:text-red-500 text-lg leading-none" title="Supprimer">🗑</button>
      </div>`;
    })
    .join("");
}

async function viewCompetitorHistory(id) {
  const res = await fetch(API + "/api/competitors/history/" + id);
  const json = await res.json();
  if (!json.success) return alert(json.error || "Erreur");
  renderCompetitor(json.data);
}

async function deleteCompetitorHistory(id) {
  await fetch(API + "/api/competitors/history/" + id, { method: "DELETE" });
  loadCompetitorHistory();
}

async function analyzeCompetitor() {
  const seller = document.getElementById("competitor-input").value.trim();
  if (!seller) return alert("Nom vendeur requis");
  const btn = document.getElementById("competitor-btn");
  btn.disabled = true;
  btn.textContent = "Analyse...";
  try {
    const res = await fetch(API + "/api/competitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seller, marketplace: document.getElementById("competitor-market")?.value || "FR" }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Erreur");
    renderCompetitor(json.data);
    loadCompetitorHistory();
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Analyser";
  }
}

function renderCompetitor(d) {
  lastCompetitor = d;
  competitorPeriod = "month";
  const box = document.getElementById("competitor-result");
  box.classList.remove("hidden");
  const ebayUrl = `https://www.ebay.fr/usr/${encodeURIComponent(d.seller)}`;
  const location = d.location || "France";
  box.innerHTML = `
    <div class="bg-white rounded-2xl border p-5 flex flex-wrap items-center gap-4">
      <div class="flex-1">
        <div class="flex items-center gap-2"><span class="text-xl">🇫🇷</span><h3 class="text-xl font-bold">${escapeHtml(d.seller)}</h3>
                ${d.live === false ? '<span class="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">estimé</span>' : '<span class="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">Live</span>'}
          ${d.source || d.api ? `<span class="text-[10px] text-zinc-400">${escapeHtml(d.source || d.api || "")}</span>` : ""}
        </div>
        <p class="text-sm text-zinc-400 mt-1">${escapeHtml(location)}</p>
      </div>
      <a href="${ebayUrl}" target="_blank" class="px-4 py-2 border rounded-xl text-sm font-medium">Voir sur eBay</a>
    </div>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div class="bg-emerald-600 text-white rounded-2xl p-5 col-span-2 lg:col-span-1">
        <div class="flex gap-1 mb-2 text-[10px] font-medium">
          <button data-cp="day" class="cp-pill px-2 py-0.5 rounded-full bg-white/20">Jour</button>
          <button data-cp="week" class="cp-pill px-2 py-0.5 rounded-full bg-white/20">Semaine</button>
          <button data-cp="month" class="cp-pill px-2 py-0.5 rounded-full bg-white">Mois</button>
        </div>
        <p class="text-xs opacity-80">Chiffre d'Affaires</p>
        <p class="text-2xl font-bold mt-1" id="comp-revenue">${Number(d.revenue || 0).toFixed(2)} €</p>
        <p class="text-[10px] opacity-70 mt-1" id="comp-revenue-label">/ mois (estimé)</p>
      </div>
      <div class="bg-white rounded-2xl border p-4"><p class="text-xs text-zinc-400">Annonces actives</p><p class="text-xl font-bold mt-1">${d.activeListings || 0}</p></div>
      <div class="bg-white rounded-2xl border p-4"><p class="text-xs text-zinc-400">Prix moyen</p><p class="text-xl font-bold mt-1">${Number(d.avgPrice || 0).toFixed(2)} €</p></div>
      <div class="bg-white rounded-2xl border p-4"><p class="text-xs text-zinc-400">Taux de vente</p><p class="text-xl font-bold mt-1 text-emerald-600">${d.sellThrough || 0}%</p></div>
      <div class="bg-white rounded-2xl border p-4"><p class="text-xs text-zinc-400">Ventes réussies</p><p class="text-xl font-bold mt-1">${d.successfulSales || 0}</p></div>
      <div class="bg-white rounded-2xl border p-4"><p class="text-xs text-zinc-400">Objets vendus</p><p class="text-xl font-bold mt-1">${d.totalSold || 0}</p></div>
      <div class="bg-white rounded-2xl border p-4"><p class="text-xs text-zinc-400">Abonnés</p><p class="text-xl font-bold mt-1">${d.followers || 0}</p></div>
    </div>
    <div class="bg-white rounded-2xl border overflow-hidden">
      <div class="p-4 border-b flex items-center justify-between">
        <div class="font-semibold">Meilleures ventes — ${escapeHtml(d.seller)}</div>
        <div class="flex gap-1 text-xs" id="best-period">
          <button data-bp="day" class="bp-pill px-2 py-1 rounded-full bg-zinc-100">Jour</button>
          <button data-bp="week" class="bp-pill px-2 py-1 rounded-full bg-zinc-100">Semaine</button>
          <button data-bp="month" class="bp-pill px-2 py-1 rounded-full bg-emerald-600 text-white">Mois</button>
        </div>
      </div>
      <div id="comp-bestsellers" class="divide-y"></div>
      <div class="p-3 text-center border-t"><button id="comp-more" class="text-sm text-emerald-600 font-medium">Voir plus</button></div>
    </div>`;

  box.querySelectorAll(".cp-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      competitorPeriod = btn.dataset.cp;
      box.querySelectorAll(".cp-pill").forEach((b) => {
        b.classList.remove("bg-white");
        b.classList.add("bg-white/20");
      });
      btn.classList.add("bg-white");
      btn.classList.remove("bg-white/20");
      const f = periodFactor(competitorPeriod);
      const labels = { day: "/ jour (estimé)", week: "/ semaine (estimé)", month: "/ mois (estimé)" };
      document.getElementById("comp-revenue").textContent =
        (Number(d.revenue || 0) * f).toFixed(2) + " €";
      document.getElementById("comp-revenue-label").textContent = labels[competitorPeriod];
    });
  });

  let showAll = false;
  const renderBest = (period) => {
    const f = periodFactor(period);
    const items = d.bestsellers || [];
    const visible = showAll ? items : items.slice(0, 4);
    document.getElementById("comp-bestsellers").innerHTML = visible
      .map((b, i) => {
        const sold = Math.max(1, Math.round((b.sold || 5) * f));
        const price = Number(b.price || 0);
        const img = productThumbHtml(b.image, b.title, "w-12 h-12");
        return `<a href="${escapeHtml(b.url || "#")}" target="_blank" class="flex items-center gap-4 p-4 hover:bg-zinc-50">
          <span class="w-6 font-bold text-emerald-600">${i + 1}</span>
          ${img}
          <div class="flex-1 min-w-0"><p class="text-sm font-medium truncate">${escapeHtml(b.title)}</p></div>
          <div class="text-right"><p class="text-sm text-emerald-600">${sold} vendus</p><p class="text-sm font-semibold">${price.toFixed(2)} €</p></div>
        </a>`;
      })
      .join("");
  };
  renderBest("month");

  box.querySelectorAll(".bp-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      box.querySelectorAll(".bp-pill").forEach((b) => {
        b.className = "bp-pill px-2 py-1 rounded-full bg-zinc-100";
      });
      btn.className = "bp-pill px-2 py-1 rounded-full bg-emerald-600 text-white";
      renderBest(btn.dataset.bp);
    });
  });

  document.getElementById("comp-more")?.addEventListener("click", () => {
    showAll = !showAll;
    document.getElementById("comp-more").textContent = showAll ? "Voir moins" : "Voir plus";
    const active = box.querySelector(".bp-pill.bg-emerald-600")?.dataset.bp || "month";
    renderBest(active);
  });
}

function colorizeLog(msg) {
  const safe = escapeHtml(msg);
  if (/\[ERROR\]/i.test(msg)) return `<div class="err">${safe}</div>`;
  if (/\[WARN\]/i.test(msg)) return `<div class="warn">${safe}</div>`;
  if (/\[OK\]|\[DONE\]|\[SIMULATION\]|Listé|importé/i.test(msg)) return `<div class="ok">${safe}</div>`;
  if (/\[INIT\]|\[CONFIG\]|\[SCAN\]|\[PROTECT\]/i.test(msg)) return `<div class="info">${safe}</div>`;
  return `<div class="ok">${safe}</div>`;
}

async function runSnipe() {
  const btn = document.getElementById("snipe-btn");
  const cons = document.getElementById("snipe-console");
  btn.disabled = true;
  cons.innerHTML = "";
  const body = {
    query: document.getElementById("snipe-query")?.value || "gadgets",
    count: Number(document.getElementById("snipe-count").value),
    margin: Number(document.getElementById("snipe-margin").value),
    marketplace: document.getElementById("snipe-market").value,
    ticket: document.getElementById("snipe-ticket").value,
    source: document.getElementById("snipe-source").value,
    autoList: document.getElementById("snipe-autolist").checked,
    testMode: false,
  };

  const res = await fetch(API + "/api/auto-snipe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const line = part.replace(/^data:\s*/, "").trim();
      if (!line) continue;
      try {
        const ev = JSON.parse(line);
        if (ev.type === "log") {
          cons.innerHTML += colorizeLog(ev.message);
          cons.scrollTop = cons.scrollHeight;
        }
        if (ev.type === "stats" || ev.type === "done") {
          document.getElementById("stat-scanned").textContent = ev.scanned || 0;
          document.getElementById("stat-imported").textContent = ev.imported || 0;
          document.getElementById("stat-listed").textContent = ev.listed || 0;
          document.getElementById("stat-errors").textContent = ev.errors || 0;
        }
      } catch (_) {}
    }
  }
  btn.disabled = false;
}

async function loadOrders() {
  const res = await fetch(API + "/api/auto-orders");
  const json = await res.json();
  const colors = {
    pending: "bg-amber-50 text-amber-700",
    ordered: "bg-blue-50 text-blue-700",
    shipped: "bg-green-50 text-green-700",
    delivered: "bg-green-100 text-green-800",
  };
  document.getElementById("orders-body").innerHTML = (json.data || [])
    .map((o) => {
      const id = String(o.id).replace(/'/g, "\\'");
      return `<tr class="border-b border-zinc-50 align-top">
          <td class="p-3 font-mono text-[11px]">${escapeHtml(o.id)}${
            o.fromEbay ? `<div class="text-[10px] text-emerald-600 mt-1">eBay</div>` : ""
          }</td>
          <td class="p-3"><div class="font-medium">${escapeHtml(o.product)}</div>
            ${
              o.shipText
                ? `<pre class="text-[10px] text-zinc-500 mt-1 whitespace-pre-wrap max-w-xs">${escapeHtml(
                    o.shipText
                  )}</pre>`
                : `<div class="text-[10px] text-zinc-300 mt-1">Adresse après Sync eBay</div>`
            }
          </td>
          <td class="p-3">${escapeHtml(o.supplier || "—")}</td>
          <td class="p-3">${Number(o.amount || 0).toFixed(2)} €</td>
          <td class="p-3"><span class="px-2 py-1 rounded-full text-xs ${colors[o.status] || ""}">${escapeHtml(
            o.status
          )}</span></td>
          <td class="p-3 space-y-1 whitespace-nowrap">
            <button onclick="openSupplierOrder('${id}')" class="block text-xs bg-brand-50 text-brand-700 px-2 py-1 rounded-lg">Ouvrir fournisseur</button>
            <button onclick="copyShipAddress('${id}')" class="block text-xs bg-zinc-50 text-zinc-600 px-2 py-1 rounded-lg">Copier adresse</button>
            <button onclick="advanceOrder('${id}')" class="block text-xs text-brand-600 px-2 py-1">Avancer statut</button>
          </td>
        </tr>`;
    })
    .join("") || `<tr><td colspan="6" class="p-8 text-center text-zinc-300">Aucune commande — clique « Sync ventes eBay ».</td></tr>`;
}

async function advanceOrder(id) {
  await fetch(API + "/api/auto-orders/" + encodeURIComponent(id) + "/advance", { method: "POST" });
  loadOrders();
}

async function openSupplierOrder(id) {
  try {
    const res = await fetch(API + "/api/auto-orders/" + encodeURIComponent(id) + "/open-supplier", {
      method: "POST",
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    if (json.data.shipText) {
      try {
        await navigator.clipboard.writeText(json.data.shipText);
      } catch (_) {}
    }
    window.open(json.data.url, "_blank", "noopener");
    alert(
      "Fournisseur ouvert." +
        (json.data.shipText
          ? "\nAdresse acheteur copiée — colle-la à la livraison chez le fournisseur, puis paie."
          : "\nPas d'adresse : clique d'abord « Sync ventes eBay ».") +
        (json.data.checklist ? "\n\n" + json.data.checklist.join("\n") : "")
    );
    loadOrders();
  } catch (err) {
    alert("Erreur: " + err.message);
  }
}

async function copyShipAddress(id) {
  try {
    const res = await fetch(API + "/api/auto-orders/" + encodeURIComponent(id));
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const text = json.data.shipText || json.data.notes || "";
    if (!text) return alert("Pas d'adresse — Sync ventes eBay d'abord.");
    await navigator.clipboard.writeText(text);
    alert("Adresse copiée.");
  } catch (err) {
    alert(err.message);
  }
}

async function loadListings() {
  const res = await fetch(API + "/api/listings");
  const json = await res.json();
  const rows = json.data || [];
  let ebayEnv = "sandbox";
  try {
    const setup = await (await fetch(API + "/api/setup")).json();
    const d = setup.data || setup;
    ebayEnv = d.ebayEnv || "sandbox";
    const hint = document.getElementById("listings-publish-hint");
    if (hint) {
      const seller = d.seller?.userId ? ` Compte OAuth : ${d.seller.userId}.` : d.seller?.error ? ` (OAuth: ${d.seller.error})` : "";
      if (ebayEnv === "production") {
        if (!d.policiesProd || !d.refreshTokenProd) {
          hint.classList.remove("hidden");
          hint.className =
            "px-5 py-3 text-xs bg-amber-50 text-amber-900 border-b border-amber-100";
          hint.textContent =
            "Mode PRODUCTION incomplet : il faut EBAY_REFRESH_TOKEN_PROD + policies *_PROD (npm run oauth:prod puis policies:prod)." +
            seller;
        } else {
          hint.classList.remove("hidden");
          hint.className =
            "px-5 py-3 text-xs bg-emerald-50 text-emerald-800 border-b border-emerald-100";
          hint.textContent =
            "Mode PRODUCTION — publications sur ton vrai compte eBay." + seller;
        }
      } else {
        hint.classList.remove("hidden");
        hint.className =
          "px-5 py-3 text-xs bg-amber-50 text-amber-900 border-b border-amber-100 font-medium";
        hint.textContent =
          "Mode SANDBOX — les annonces vont sur le compte TEST (testuser), PAS sur ton vrai eBay. Pour le réel : EBAY_ENV=production dans .env, redémarre le serveur." +
          seller;
      }
    }
  } catch (_) {}
  window.__ebxPublishEnv = ebayEnv;
  document.getElementById("listings-body").innerHTML = rows.length
    ? rows
        .map((item) => {
          const published = item.ebay_listing_id
            ? `<div class="text-[11px] mt-1 ${
                item.publish_env === "production" ? "text-emerald-600" : "text-amber-600"
              }">
                ${item.publish_env === "production" ? "Prod" : "Sandbox"}:
                <a class="underline" target="_blank" rel="noopener"
                   href="${
                     item.publish_env === "production"
                       ? "https://www.ebay.com/itm/"
                       : "https://www.sandbox.ebay.com/itm/"
                   }${encodeURIComponent(item.ebay_listing_id)}">${escapeHtml(
                     item.ebay_listing_id
                   )}</a>
              </div>`
            : `<div class="text-[11px] text-zinc-300 mt-1">Non publié</div>`;
          const imgWarn =
            !item.has_images && !item.ebay_listing_id
              ? `<div class="text-[11px] text-rose-500 mt-1">Sans image — republier tentera de récupérer depuis la source</div>`
              : "";
          return `
      <tr class="border-b border-zinc-50">
        <td class="p-3 text-xs text-zinc-400">${new Date(item.created_at).toLocaleString("fr-FR")}</td>
        <td class="p-3 font-medium">${escapeHtml(item.seo_title || "—")}${published}${imgWarn}</td>
        <td class="p-3 text-brand-600 font-semibold">${item.suggested_price ? item.suggested_price.toFixed(2) + " €" : "—"}</td>
        <td class="p-3 text-right space-x-2 whitespace-nowrap">
          <button onclick="viewListing(${item.id})" class="text-xs bg-brand-50 text-brand-600 px-3 py-1.5 rounded-lg">Voir</button>
          <button onclick="publishListing(${item.id}, this)" class="text-xs bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg">${
            item.ebay_listing_id ? "Republier" : "Publier eBay"
          }</button>
          <button onclick="syncListing(${item.id}, this)" class="text-xs bg-zinc-50 text-zinc-600 px-3 py-1.5 rounded-lg">Sync</button>
          ${
            item.ebay_offer_id
              ? `<button onclick="endListingEbay(${item.id}, this)" class="text-xs bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg">Fin eBay</button>`
              : ""
          }
          <button onclick="deleteListing(${item.id})" class="text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded-lg">Suppr.</button>
        </td>
      </tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="p-8 text-center text-zinc-300">Aucun listing.</td></tr>`;
}

async function syncListing(id, btn) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "...";
  try {
    const res = await fetch(API + "/api/listings/" + id + "/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ margin: 35, quantity: 10 }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const m = json.data.margin || {};
    alert(
      `Sync OK\nPrix: ${json.data.price} | Marge nette ~${m.netPct || "?"}%` +
        (json.data.offerUpdate ? "\nOffre eBay mise à jour." : "\n(pas d'offer_id — prix local seulement)")
    );
    loadListings();
  } catch (err) {
    alert("Erreur sync: " + err.message);
    btn.textContent = original;
    btn.disabled = false;
  }
}

async function endListingEbay(id, btn) {
  if (!confirm("Mettre fin à l'annonce sur eBay (withdraw offer) ?")) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "...";
  try {
    const res = await fetch(API + "/api/listings/" + id + "/end", { method: "POST" });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    alert("Annonce terminée côté eBay (offer withdraw).");
    loadListings();
  } catch (err) {
    alert("Erreur: " + err.message);
    btn.textContent = original;
    btn.disabled = false;
  }
}

async function syncEbayOrders() {
  try {
    const res = await fetch(API + "/api/auto-orders/sync-ebay", { method: "POST" });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    let msg = `Sync eBay: ${json.fetched} lue(s), ${json.created} nouvelle(s), ${json.updated || 0} maj.`;
    if (json.autoProcessed) msg += `\nBot: ${json.autoProcessed} commande(s) préparée(s) auto.`;
    alert(msg);
    loadOrders();
    refreshBotStatus();
    if (document.getElementById("page-dashboard")?.classList.contains("active")) loadDashboard();
  } catch (err) {
    alert("Sync ventes: " + err.message);
  }
}

let supplierCfgCache = null;

async function loadSupplierConfig() {
  try {
    const res = await fetch(API + "/api/auto-orders/config");
    const json = await res.json();
    supplierCfgCache = json.data || {};
    const c = supplierCfgCache;
    const mode = document.getElementById("ao-mode");
    if (mode) mode.checked = Boolean(c.autoOrderMode);
    const max = document.getElementById("ao-max");
    if (max) max.value = c.maxPerDay || 50;
    const ali = document.getElementById("ao-ali-mode");
    if (ali) ali.value = c.aliMode || "chrome_extension";
    const nOk = document.getElementById("ao-notify-ok");
    if (nOk) nOk.checked = c.notifyOnOrder !== false;
    const nErr = document.getElementById("ao-notify-err");
    if (nErr) nErr.checked = c.notifyOnError !== false;
    const autoSync = document.getElementById("ao-autosync");
    if (autoSync) autoSync.checked = c.autoProcessOnSync !== false;

    const box = document.getElementById("supplier-cards");
    if (box) {
      const keys = ["amazon", "aliexpress", "cdiscount"];
      box.innerHTML = keys
        .map((k) => {
          const s = c[k] || {};
          const soon = s.comingSoon;
          return `<div class="rounded-xl border p-4 space-y-3 ${soon ? "opacity-60" : ""}">
            <div class="flex justify-between items-start gap-2">
              <div>
                <p class="font-medium text-sm">${escapeHtml(s.label || k)}</p>
                <p class="text-[11px] text-zinc-400">Délai: ${escapeHtml(s.delay || "—")}</p>
              </div>
              <span class="text-[10px] px-2 py-0.5 rounded-full ${
                soon ? "bg-zinc-100 text-zinc-500" : s.connected ? "bg-emerald-100 text-emerald-700" : "bg-amber-50 text-amber-700"
              }">${soon ? "Bientôt" : s.connected ? "Connecté" : "Non connecté"}</span>
            </div>
            ${
              soon
                ? `<p class="text-xs text-zinc-400">Bientôt disponible</p>`
                : `<div class="space-y-2">
              <label class="flex items-center justify-between gap-2 text-xs"><span>Activé</span>
                <input type="checkbox" class="toggle" ${s.enabled !== false ? "checked" : ""} onchange="toggleSupplier('${k}','enabled',this.checked)" /></label>
              <label class="flex items-center justify-between gap-2 text-xs"><span>Auto commande</span>
                <input type="checkbox" class="toggle" ${s.auto ? "checked" : ""} onchange="toggleSupplier('${k}','auto',this.checked)" /></label>
              <button type="button" onclick="connectSupplier('${k}')" class="w-full text-xs px-3 py-1.5 rounded-lg border ${
                s.connected ? "bg-emerald-50 text-emerald-700" : "bg-[#6d7ddf]/10 text-[#4452a8]"
              }">${s.connected ? "Déconnecter" : "Se connecter"}</button>
            </div>`
            }
          </div>`;
        })
        .join("");
    }
    refreshBotStatus();
  } catch (_) {}
}

async function saveAutoOrderSettings() {
  if (!supplierCfgCache) supplierCfgCache = {};
  supplierCfgCache.autoOrderMode = Boolean(document.getElementById("ao-mode")?.checked);
  supplierCfgCache.maxPerDay = Number(document.getElementById("ao-max")?.value) || 50;
  supplierCfgCache.aliMode = document.getElementById("ao-ali-mode")?.value || "chrome_extension";
  supplierCfgCache.notifyOnOrder = Boolean(document.getElementById("ao-notify-ok")?.checked);
  supplierCfgCache.notifyOnError = Boolean(document.getElementById("ao-notify-err")?.checked);
  supplierCfgCache.autoProcessOnSync = Boolean(document.getElementById("ao-autosync")?.checked);
  await fetch(API + "/api/auto-orders/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(supplierCfgCache),
  });
  refreshBotStatus();
}

async function toggleSupplier(key, field, value) {
  if (!supplierCfgCache) supplierCfgCache = {};
  supplierCfgCache[key] = { ...(supplierCfgCache[key] || {}), [field]: value };
  await fetch(API + "/api/auto-orders/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(supplierCfgCache),
  });
}

async function connectSupplier(key) {
  if (!supplierCfgCache) await loadSupplierConfig();
  const s = supplierCfgCache[key] || {};
  const next = !s.connected;
  if (next) {
    alert(
      key === "aliexpress"
        ? "AliExpress: mode Extension Chrome. Marqué connecté — le bot ouvrira le checkout + copie l'adresse."
        : "Compte fournisseur marqué connecté. Le bot utilisera cette source en priorité (paiement reste à valider)."
    );
  }
  await toggleSupplier(key, "connected", next);
  loadSupplierConfig();
}

async function processAutoOrderQueue() {
  try {
    const res = await fetch(API + "/api/auto-orders/process-queue", { method: "POST" });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const pack = json.data?.pack || [];
    const log = document.getElementById("ao-bot-log");
    if (log) {
      log.classList.remove("hidden");
      log.textContent =
        json.data.note +
        (json.data.remainingToday != null ? ` · Reste aujourd'hui: ${json.data.remainingToday}` : "");
    }
    if (!pack.length) {
      alert(json.data?.note || "Aucune commande pending.");
      return loadOrders();
    }
    if (pack[0].shipText) {
      try {
        await navigator.clipboard.writeText(pack[0].shipText);
      } catch (_) {}
    }
    for (const p of pack.slice(0, 5)) {
      window.open(p.url, "_blank", "noopener");
    }
    alert(
      `Bot: ${pack.length} commande(s) préparée(s).\nAdresse de la 1ère copiée.\nOnglets fournisseur ouverts — colle l'adresse et paie.`
    );
    loadOrders();
    refreshBotStatus();
  } catch (err) {
    alert("File d'attente: " + err.message);
  }
}

let manualListingId = null;

function setManualStep(doneUpTo) {
  const order = ["scan", "extract", "ai", "publish"];
  const idx = order.indexOf(doneUpTo);
  document.querySelectorAll("#manual-steps [data-step]").forEach((el) => {
    const i = order.indexOf(el.dataset.step);
    const dot = el.querySelector(".step-dot");
    if (i <= idx) {
      dot.className = "step-dot w-6 h-6 rounded-full bg-emerald-500 text-white text-center leading-6 text-xs";
      dot.textContent = "✓";
    } else {
      dot.className = "step-dot w-6 h-6 rounded-full bg-zinc-200 text-center leading-6 text-xs";
      dot.textContent = String(i + 1);
    }
  });
}

async function runManualImport() {
  const url = document.getElementById("manual-url")?.value.trim();
  if (!url) return alert("Colle une URL fournisseur");
  const btn = document.getElementById("manual-btn");
  const wrap = document.getElementById("manual-progress");
  const list = document.getElementById("manual-checklist");
  const bar = document.getElementById("manual-bar");
  const pct = document.getElementById("manual-pct");
  const label = document.getElementById("manual-status-label");
  const ready = document.getElementById("manual-ready");
  const pubBtn = document.getElementById("manual-publish-btn");
  btn.disabled = true;
  wrap.classList.remove("hidden");
  ready.classList.add("hidden");
  pubBtn.classList.add("hidden");
  manualListingId = null;
  list.innerHTML = "";
  const addCheck = (t) => {
    list.innerHTML += `<li class="flex items-center gap-2 text-emerald-700"><span class="text-emerald-500">✓</span> ${escapeHtml(t)}</li>`;
  };
  try {
    label.textContent = "Scan produit…";
    bar.style.width = "20%";
    pct.textContent = "20%";
    setManualStep("scan");
    addCheck("Analyse de l'URL…");
    await new Promise((r) => setTimeout(r, 300));
    addCheck(`Plateforme détectée : ${/amazon/i.test(url) ? "Amazon" : /cdiscount/i.test(url) ? "Cdiscount" : "AliExpress"}`);

    label.textContent = "Extraction…";
    bar.style.width = "45%";
    pct.textContent = "45%";
    setManualStep("extract");
    const res = await fetch(API + "/api/generate-listing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productUrl: url, themeColor }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Import échoué");
    addCheck("Connexion au fournisseur…");
    addCheck("Produit détecté");
    const imgCount = (json.data?.images || []).length || countRealImagesHint(json.data?.html_description);
    addCheck(`Images récupérées : ${imgCount}`);

    label.textContent = "Optimisation IA…";
    bar.style.width = "80%";
    pct.textContent = "80%";
    setManualStep("ai");
    const title = json.data?.seo_title || "";
    const orig = json.data?.original_title || json.data?.product_name || "";
    const price = Number(json.data?.suggested_price || 0);
    addCheck(
      json.data?.title_rewritten
        ? "Titre réécrit (discret) — différent du fournisseur"
        : "Titre optimisé"
    );
    addCheck(`Titre eBay : ${title.length} caractères`);
    addCheck("Description HTML générée");
    addCheck(`Prix de vente suggéré : ${price.toFixed(2)} €`);
    const costGuess = price / 1.8;
    const marginEst = price > 0 ? Math.round(((price - costGuess) / price) * 100) : 0;
    addCheck(`Marge estimée : ${marginEst}%`);

    manualListingId = json.data?.id;
    const review = document.getElementById("manual-review");
    const origEl = document.getElementById("manual-orig-title");
    const seoEl = document.getElementById("manual-seo-title");
    const lenEl = document.getElementById("manual-title-len");
    const thumbs = document.getElementById("manual-thumbs");
    if (review) review.classList.remove("hidden");
    if (origEl) origEl.textContent = orig || "—";
    if (seoEl) {
      seoEl.value = title;
      seoEl.oninput = () => {
        if (lenEl) lenEl.textContent = String(seoEl.value.length);
      };
      // Suggestions variations LED vs générique
      const v1 = document.getElementById("manual-var-v1");
      const v2 = document.getElementById("manual-var-v2");
      const aspect = document.getElementById("manual-var-aspect");
      const t = `${title} ${orig}`.toLowerCase();
      if (v1 && v2) {
        if (/led|bande|strip|n[eé]on|chaud|froid|kelvin/i.test(t)) {
          if (aspect) aspect.value = "Couleur";
          v1.value = "Blanc chaud";
          v2.value = "Blanc froid";
        } else if (/coque|case|silicone/i.test(t)) {
          if (aspect) aspect.value = "Couleur";
          v1.value = "Noir";
          v2.value = "Transparent";
        } else if (/cable|câble|usb|hdmi/i.test(t)) {
          if (aspect) aspect.value = "Longueur";
          v1.value = "1 m";
          v2.value = "2 m";
        }
      }
    }
    if (lenEl) lenEl.textContent = String(title.length);
    if (thumbs) {
      const imgs = json.data?.images || json.data?.product?.images || [];
      thumbs.innerHTML = imgs.length
        ? imgs
            .slice(0, 6)
            .map(
              (src, i) =>
                `<img src="${escapeHtml(src)}" alt="" referrerpolicy="no-referrer" class="w-14 h-14 rounded-lg object-cover border ${
                  i === 0 ? "border-[#6d7ddf] ring-2 ring-[#6d7ddf]/30" : "border-zinc-200"
                }" title="${i === 0 ? "Image principale" : "Galerie"}" />`
            )
            .join("")
        : `<span class="text-xs text-zinc-400">Pas d'image — vérifie l'URL</span>`;
    }

    label.textContent = `Prêt à publier — ${price.toFixed(2)} € (80%)`;
    ready.classList.remove("hidden");
    ready.textContent = `Listing discret prêt — titre réécrit — ${price.toFixed(2)} €`;
    pubBtn.classList.remove("hidden");
    setManualStep("ai");
  } catch (err) {
    label.textContent = "Erreur";
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

async function publishManualListing() {
  if (!manualListingId) return alert("Importe d'abord un produit");
  try {
    const seoEl = document.getElementById("manual-seo-title");
    if (seoEl?.value.trim()) {
      await fetch(API + "/api/listings/" + manualListingId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seo_title: seoEl.value.trim() }),
      });
    }
    const varEnabled = document.getElementById("manual-var-enabled")?.checked !== false;
    const aspect = document.getElementById("manual-var-aspect")?.value.trim() || "Couleur";
    const v1 = document.getElementById("manual-var-v1")?.value.trim() || "Blanc chaud";
    const v2 = document.getElementById("manual-var-v2")?.value.trim() || "Blanc froid";
    setManualStep("publish");
    document.getElementById("manual-bar").style.width = "100%";
    document.getElementById("manual-pct").textContent = "100%";
    const res = await fetch(API + "/api/publish-to-ebay/" + manualListingId, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variations: {
          enabled: varEnabled,
          aspect,
          values: [v1, v2].filter(Boolean),
        },
      }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    document.getElementById("manual-status-label").textContent = "Publié";
    const vars = (json.data?.variations?.values || []).join(" / ");
    alert(
      "Publié sur eBay — listingId: " +
        (json.data?.listingId || "ok") +
        (vars ? `\nVariations: ${vars}` : "")
    );
    navigate("listings");
  } catch (err) {
    alert("Publication: " + err.message);
  }
}

function countRealImagesHint(html) {
  const m = String(html || "").match(/<img\b/gi);
  return m ? m.length : 0;
}

let savSelectedId = null;
let savCache = [];

async function loadSav() {
  try {
    const res = await fetch(API + "/api/sav");
    const json = await res.json();
    savCache = json.data || [];
    const list = document.getElementById("sav-list");
    if (!list) return;
    list.innerHTML = savCache.length
      ? savCache
          .map((m) => {
            const badge =
              m.status === "escalated"
                ? "bg-amber-100 text-amber-800"
                : m.status === "sent"
                  ? "bg-emerald-100 text-emerald-800"
                  : m.status === "draft"
                    ? "bg-brand-100 text-brand-800"
                    : "bg-zinc-100 text-zinc-600";
            return `<button type="button" data-sav-id="${m.id}" onclick="selectSav(${m.id})" class="w-full text-left px-4 py-3 hover:bg-brand-50 ${
              savSelectedId === m.id ? "bg-brand-50" : ""
            }">
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm font-medium truncate">${escapeHtml(m.subject || "(sans sujet)")}</p>
                <span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${badge}">${escapeHtml(m.status)}</span>
              </div>
              <p class="text-[11px] text-zinc-400 mt-0.5 truncate">${escapeHtml(m.sender)} · ${escapeHtml(
              m.item_title || ""
            )}</p>
              <p class="text-[10px] text-[#6d7ddf] mt-0.5">${escapeHtml(
                formatSavDate(m.received_at || m.created_at)
              )}</p>
            </button>`;
          })
          .join("")
      : `<p class="p-6 text-sm text-zinc-300 text-center">Aucun message — Sync ou Brouillons auto.</p>`;
    if (savSelectedId && savCache.some((x) => x.id === savSelectedId)) {
      selectSav(savSelectedId);
    }
  } catch (err) {
    alert("SAV: " + err.message);
  }
}

function selectSav(id) {
  savSelectedId = id;
  const m = savCache.find((x) => x.id === id);
  const empty = document.getElementById("sav-detail-empty");
  const detail = document.getElementById("sav-detail");
  const list = document.getElementById("sav-list");
  if (list) {
    list.querySelectorAll("button[data-sav-id]").forEach((btn) => {
      btn.classList.toggle("bg-brand-50", Number(btn.dataset.savId) === id);
    });
  }
  if (!m) {
    empty?.classList.remove("hidden");
    detail?.classList.add("hidden");
    return;
  }
  empty?.classList.add("hidden");
  detail?.classList.remove("hidden");
  document.getElementById("sav-subject").textContent = m.subject || "(sans sujet)";
  document.getElementById("sav-status-badge").textContent = m.status;
  document.getElementById("sav-meta").textContent = `${m.sender || ""} · ${m.item_title || ""} · #${m.message_id || m.id}`;
  const receivedEl = document.getElementById("sav-received");
  if (receivedEl) {
    const raw = m.received_at || m.created_at || "";
    let label = "Date eBay : —";
    if (raw) {
      const dt = new Date(raw);
      label = Number.isNaN(dt.getTime())
        ? `Date eBay : ${raw}`
        : `Reçu sur eBay : ${dt.toLocaleString("fr-FR")}`;
      const ageH = Math.round((Date.now() - dt.getTime()) / 3600000);
      if (!Number.isNaN(dt.getTime()) && ageH >= 0) {
        label += ageH < 48 ? ` · il y a ${ageH}h` : ` · il y a ${Math.round(ageH / 24)}j`;
      }
    }
    receivedEl.textContent = label;
  }
  document.getElementById("sav-body").textContent = m.body || "";
  document.getElementById("sav-draft").value = m.draft || "";
  const note = document.getElementById("sav-escalate-note");
  if (m.escalate) {
    note.classList.remove("hidden");
    note.textContent = "Escalade: " + (m.escalate_reason || "relire avant envoi");
  } else {
    note.classList.add("hidden");
  }
}


async function deleteSavSelected() {
  if (!savSelectedId) return alert("Sélectionne un message");
  if (!confirm("Supprimer ce message de l'inbox EBX ?")) return;
  try {
    const res = await fetch(API + "/api/sav/" + savSelectedId, { method: "DELETE" });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    savSelectedId = null;
    document.getElementById("sav-detail")?.classList.add("hidden");
    document.getElementById("sav-detail-empty")?.classList.remove("hidden");
    await loadSav();
  } catch (err) {
    alert(err.message);
  }
}

async function syncSavMessages() {
  try {
    const res = await fetch(API + "/api/sav/sync", { method: "POST" });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    alert(
      (json.live ? "Sync live: " : "Démo/fallback: ") +
        `${json.fetched || 0} lu(s), ${json.created || 0} nouveau(x).\n` +
        (json.note || "")
    );
    await loadSav();
  } catch (err) {
    alert(err.message);
  }
}

async function autoDraftAllSav() {
  try {
    const res = await fetch(API + "/api/sav/auto-draft-all", { method: "POST" });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    alert(`${json.drafted} brouillon(s) généré(s).`);
    await loadSav();
  } catch (err) {
    alert(err.message);
  }
}

async function draftSavSelected() {
  if (!savSelectedId) return alert("Sélectionne un message");
  try {
    const res = await fetch(API + "/api/sav/" + savSelectedId + "/draft", { method: "POST" });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    document.getElementById("sav-draft").value = json.data.draft || "";
    await loadSav();
    selectSav(savSelectedId);
  } catch (err) {
    alert(err.message);
  }
}

async function escalateSavSelected() {
  if (!savSelectedId) return;
  try {
    await fetch(API + "/api/sav/" + savSelectedId + "/escalate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Escalade manuelle" }),
    });
    await loadSav();
    selectSav(savSelectedId);
  } catch (err) {
    alert(err.message);
  }
}

async function sendSavSelected(force) {
  if (!savSelectedId) return;
  const draft = document.getElementById("sav-draft").value;
  try {
    const res = await fetch(API + "/api/sav/" + savSelectedId + "/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft, force: Boolean(force) }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    alert(json.data.live ? "Envoyé sur eBay." : "Marqué envoyé (démo).");
    await loadSav();
    selectSav(savSelectedId);
  } catch (err) {
    alert(err.message);
  }
}

async function loadAccounts() {
  const box = document.getElementById("accounts-list");
  if (!box) return;
  try {
    const res = await fetch(API + "/api/accounts");
    const json = await res.json();
    const rows = json.data || [];
    box.innerHTML = rows.length
      ? rows
          .map(
            (a) => `<div class="flex items-center justify-between gap-2 p-3 rounded-xl border ${
              a.is_active ? "bg-emerald-50 border-emerald-100" : "bg-white"
            }">
            <div><p class="font-medium">${escapeHtml(a.label || a.user_id)}</p>
            <p class="text-xs text-zinc-400">${escapeHtml(a.user_id || "")} · ${escapeHtml(a.env)} · ${escapeHtml(
              a.marketplace
            )}${a.is_active ? " · ACTIF" : ""}</p></div>
            <div class="flex gap-2">
              ${
                a.is_active
                  ? ""
                  : `<button onclick="activateEbayAccount(${a.id})" class="text-xs bg-brand-50 text-brand-700 px-2 py-1 rounded-lg">Activer</button>`
              }
              <button onclick="removeEbayAccount(${a.id})" class="text-xs bg-red-50 text-red-600 px-2 py-1 rounded-lg">Suppr.</button>
            </div>
          </div>`
          )
          .join("")
      : `<p class="text-zinc-400 text-xs">Aucun compte multi enregistré — utilise le .env ou ajoute un token ci-dessus.</p>`;
  } catch (_) {
    box.innerHTML = "";
  }
}

async function addEbayAccount() {
  const label = document.getElementById("acc-label")?.value.trim();
  const marketplace = document.getElementById("acc-market")?.value || "EBAY_US";
  const refreshToken = document.getElementById("acc-token")?.value.trim();
  if (!refreshToken) return alert("Colle un refresh token");
  const res = await fetch(API + "/api/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, marketplace, refreshToken, env: "production" }),
  });
  const json = await res.json();
  if (!json.success) return alert(json.error || "Erreur");
  document.getElementById("acc-token").value = "";
  alert("Compte ajouté: " + (json.data?.userId || "OK"));
  loadAccounts();
}

async function activateEbayAccount(id) {
  const res = await fetch(API + "/api/accounts/" + id + "/activate", { method: "POST" });
  const json = await res.json();
  if (!json.success) return alert(json.error || "Erreur");
  alert("Compte actif: " + json.data.userId);
  loadAccounts();
  loadSettings();
}

async function removeEbayAccount(id) {
  if (!confirm("Supprimer ce compte de la liste locale ?")) return;
  await fetch(API + "/api/accounts/" + id, { method: "DELETE" });
  loadAccounts();
}

async function deleteListing(id) {
  if (!confirm("Supprimer ce listing local ?")) return;
  await fetch(API + "/api/listings/" + id, { method: "DELETE" });
  loadListings();
}

async function dedupeListings() {
  const res = await fetch(API + "/api/listings/dedupe", { method: "POST" });
  const json = await res.json();
  if (!json.success) return alert(json.error || "Erreur");
  alert(`${json.removed} doublon(s) supprimé(s) — ${json.remaining} restant(s)`);
  loadListings();
}

async function scrubListingImages() {
  const res = await fetch(API + "/api/listings/scrub-images", { method: "POST" });
  const json = await res.json();
  if (!json.success) return alert(json.error || "Erreur");
  alert(`${json.fixed} listing(s) : images aléatoires (picsum) retirées`);
  loadListings();
}

async function viewListing(id) {
  const res = await fetch(API + "/api/listings/" + id);
  const json = await res.json();
  if (!json.success) return alert("Impossible de charger");
  document.getElementById("modal-title").textContent = json.data.seo_title || "Listing";
  document.getElementById("modal-content").innerHTML = json.data.html_description || "";
  const m = document.getElementById("modal");
  m.classList.remove("hidden");
  m.classList.add("flex");
}

function closeModal() {
  const m = document.getElementById("modal");
  m.classList.add("hidden");
  m.classList.remove("flex");
}

async function publishListing(id, btn) {
  const envMode = window.__ebxPublishEnv || "sandbox";
  const warn =
    envMode === "production"
      ? "Publier sur eBay PRODUCTION (compte vendeur RÉEL) ?\n\nL'annonce apparaîtra dans Vendre → Annonces actives de CE compte OAuth."
      : "ATTENTION : mode SANDBOX\n\nL'annonce ira sur le compte TEST (testuser),\nPAS sur ton vrai compte eBay.\n\nPour le réel : mets EBAY_ENV=production dans .env puis redémarre.\n\nContinuer en Sandbox ?";
  if (!confirm(warn)) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "...";
  try {
    const titleHint = btn?.closest("tr")?.querySelector("td")?.textContent || "";
    const res = await fetch(API + "/api/publish-to-ebay/" + id, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variations: {
          enabled: true,
          aspect: "Couleur",
          values: /led|bande|strip/i.test(titleHint)
            ? ["Blanc chaud", "Blanc froid"]
            : ["Option A", "Option B"],
        },
      }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const lid = json.data.listingId || "N/A";
    const penv = json.data.env || envMode;
    const seller = json.data.sellerUserId ? `\nCompte vendeur : ${json.data.sellerUserId}` : "";
    const link =
      penv === "production"
        ? `https://www.ebay.com/itm/${lid}`
        : `https://www.sandbox.ebay.com/itm/${lid}`;
    const note =
      penv === "production"
        ? "Visible sur ton vrai eBay (Active listings)."
        : "Visible UNIQUEMENT sur sandbox.ebay.com (compte test) — pas sur ebay.com réel.";
    alert(`Publié (${penv}) !${seller}\nListing ID: ${lid}\n\n${note}\n\nOuvre : ${link}`);
    loadListings();
  } catch (err) {
    btn.textContent = original;
    btn.disabled = false;
    alert("Erreur: " + err.message);
  }
}

async function runTitleBuilder() {
  const query = document.getElementById("title-query").value.trim();
  if (!query) return alert("Saisis un mot-clé");
  const btn = document.getElementById("title-btn");
  btn.disabled = true;
  btn.textContent = "Analyse...";
  try {
    const exclude = document.getElementById("title-exclude").value.trim();
    const res = await fetch(API + "/api/title-builder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        marketplace: document.getElementById("title-market").value,
        exclude,
      }),
    });
    const json = await res.json();
    if (!json.success && json.error) throw new Error(json.error);
    titleData = json.data;
    if (!titleData) throw new Error("Aucune donnée renvoyée");
    selectedKeywords = [query];
    kwPageIdx = 0;
    document.getElementById("title-results").classList.remove("hidden");
    document.getElementById("title-meta").textContent = `${titleData.analyzedListings || 0} annonces analysées${
      titleData.live === false ? " (fallback)" : " (live)"
    }${
      titleData.seo
        ? ` · Score SEO ${titleData.seo.score}/100 (${titleData.seo.grade})`
        : ""
    }`;
    if (titleData.suggestedTitle) {
      selectedKeywords = titleData.suggestedTitle.split(/\s+/).filter(Boolean);
    }
    updateFinalTitle();
    renderKeywords();
  } catch (err) {
    alert("Title Builder: " + err.message);
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Générer";
  }
}

function updateFinalTitle() {
  const t = selectedKeywords.join(" ").slice(0, 80);
  const input = document.getElementById("final-title");
  const count = document.getElementById("title-count");
  input.value = t;
  count.textContent = `${t.length}/80`;
  count.className =
    t.length >= 80
      ? "text-xs text-red-500 font-semibold"
      : t.length >= 70
        ? "text-xs text-amber-600 font-medium"
        : "text-xs text-zinc-400";
  const chips = document.getElementById("title-chips");
  if (chips) {
    chips.innerHTML = selectedKeywords.length
      ? selectedKeywords
          .map(
            (k, i) =>
              `<button type="button" data-remove-kw="${i}" class="text-xs px-2 py-1 rounded-lg bg-brand-50 text-brand-700 border border-brand-100 hover:bg-red-50">${escapeHtml(k)} ×</button>`
          )
          .join("")
      : `<span class="text-xs text-zinc-400">Aucun mot-clé — clique dans le tableau</span>`;
  }
}

function onTitleEdit() {
  const raw = document.getElementById("final-title").value.slice(0, 80);
  document.getElementById("final-title").value = raw;
  selectedKeywords = raw.trim() ? raw.trim().split(/\s+/) : [];
  const count = document.getElementById("title-count");
  count.textContent = `${raw.length}/80`;
  count.className =
    raw.length >= 80 ? "text-xs text-red-500 font-semibold" : raw.length >= 70 ? "text-xs text-amber-600" : "text-xs text-zinc-400";
  const chips = document.getElementById("title-chips");
  if (chips) {
    chips.innerHTML = selectedKeywords
      .map(
        (k, i) =>
          `<button type="button" data-remove-kw="${i}" class="text-xs px-2 py-1 rounded-lg bg-brand-50 text-brand-700 border border-brand-100">${escapeHtml(k)} ×</button>`
      )
      .join("");
  }
}

function renderKeywords() {
  if (!titleData) return;
  const list = titleData[titleTab] || [];
  const start = kwPageIdx * KW_PER_PAGE;
  const page = list.slice(start, start + KW_PER_PAGE);
  const maxPage = Math.max(1, Math.ceil(list.length / KW_PER_PAGE));
  document.getElementById("kw-page-label").textContent = `Page ${kwPageIdx + 1} / ${maxPage}`;
  document.getElementById("kw-list").innerHTML = page
    .map((k) => {
      const selected = selectedKeywords.includes(k.keyword);
      return `<tr class="keyword-row border-b border-zinc-50 cursor-pointer ${selected ? "bg-brand-50" : ""}" data-add-kw="${escapeHtml(k.keyword)}">
          <td class="p-3 font-medium text-brand-700">${selected ? "✓ " : ""}${escapeHtml(k.keyword)}</td>
          <td class="p-3 text-zinc-500">${Number(k.searches || 0).toLocaleString("fr-FR")}</td>
          <td class="p-3 text-zinc-500">${Number(k.sales || 0).toLocaleString("fr-FR")}</td>
        </tr>`;
    })
    .join("");
}

function kwPage(dir) {
  if (!titleData) return;
  const list = titleData[titleTab] || [];
  const maxPage = Math.max(0, Math.ceil(list.length / KW_PER_PAGE) - 1);
  kwPageIdx = Math.min(maxPage, Math.max(0, kwPageIdx + dir));
  renderKeywords();
}

function addKeyword(kw) {
  const word = String(kw || "").trim();
  if (!word) return;
  if (!selectedKeywords.includes(word)) selectedKeywords.push(word);
  updateFinalTitle();
  renderKeywords();
}

function removeKeyword(idx) {
  const i = Number(idx);
  if (!Number.isFinite(i) || i < 0) return;
  selectedKeywords.splice(i, 1);
  updateFinalTitle();
  renderKeywords();
}

// Délégation d'événements (évite les onclick cassés par les guillemets)
document.getElementById("kw-list")?.addEventListener("click", (e) => {
  const row = e.target.closest("[data-add-kw]");
  if (!row) return;
  addKeyword(row.getAttribute("data-add-kw"));
});

document.getElementById("title-chips")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-remove-kw]");
  if (!btn) return;
  removeKeyword(btn.getAttribute("data-remove-kw"));
});


function copyTitle() {
  navigator.clipboard.writeText(document.getElementById("final-title").value);
  alert("Titre copié");
}

document.getElementById("kw-tabs")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".kw-tab");
  if (!btn) return;
  titleTab = btn.dataset.tab;
  kwPageIdx = 0;
  document.querySelectorAll(".kw-tab").forEach((b) => {
    b.className = "kw-tab px-3 py-1.5 rounded-lg text-sm text-zinc-500";
  });
  btn.className = "kw-tab px-3 py-1.5 rounded-lg text-sm bg-brand-50 text-brand-700";
  renderKeywords();
});

function setTheme(color, el) {
  themeColor = color;
  document.querySelectorAll(".theme-dot, .color-swatch").forEach((d) => d.classList.remove("active"));
  (el || document.querySelector(`.theme-dot[data-theme="${color}"], .color-swatch[data-theme="${color}"]`))?.classList.add("active");
  const picker = document.getElementById("desc-color-picker");
  if (picker) picker.value = color;
  document.querySelectorAll(`.color-swatch[data-theme="${color}"]`).forEach((d) => d.classList.add("active"));
  if (lastDesc) {
    const tip = document.getElementById("desc-theme-status");
    if (tip) tip.textContent = "Thème mis à jour…";
    regenerateDescTheme().then(() => {
      if (tip) tip.textContent = "Thème appliqué · " + color;
    });
  } else {
    const tip = document.getElementById("desc-theme-status");
    if (tip) tip.textContent = color;
  }
}

async function regenerateDescTheme() {
  const product =
    lastDesc?.product ||
    (lastDesc
      ? {
          title: lastDesc.product_name || lastDesc.seo_title || "Produit",
          images: descImages.length ? descImages : lastDesc.images || [],
          bullets: [],
          description: "",
          price: lastDesc.suggested_price,
          source: lastDesc.source || "generic",
        }
      : null);
  if (!product) return;
  try {
    const res = await fetch(API + "/api/rebuild-description", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: { ...product, images: descImages.length ? descImages : product.images || [] },
        themeColor,
      }),
    });
    const json = await res.json();
    if (json.success) applyDescResult({ ...lastDesc, ...json.data, product: json.data.product || product });
  } catch (err) {
    console.error(err);
    alert("Impossible d'appliquer le thème: " + err.message);
  }
}

function applyDescResult(data) {
  const product =
    data.product ||
    {
      title: data.product_name || data.seo_title || "Produit",
      images: data.images || [],
      bullets: [],
      description: "",
      price: data.suggested_price,
      source: data.source || "generic",
      url: data.source_url || "",
    };
  lastDesc = { ...data, product };
  const html = data.html_description || "";
  descImages = (data.images && data.images.length ? data.images : product.images) || descImages || [];
  lastDesc.images = descImages;
  lastDesc.product.images = descImages;

  document.getElementById("desc-html").textContent = html;
  const preview = document.getElementById("desc-preview");
  preview.classList.remove("flex", "items-center", "justify-center", "text-zinc-300");
  preview.innerHTML = html;
  bindPreviewImages(preview);

  const banner = document.getElementById("desc-banner");
  banner.classList.remove("hidden");
  document.getElementById("desc-detected").textContent =
    "Produit détecté : " + (data.product_name || data.seo_title || "").slice(0, 80);
  document.getElementById("desc-img-badge").textContent = `${descImages.length} images`;
  document.getElementById("desc-source-badge").textContent = data.source || "generic";
}

function bindPreviewImages(preview) {
  preview.querySelectorAll("img").forEach((img, idx) => {
    img.style.cursor = "pointer";
    img.style.outline = "2px solid transparent";
    img.style.transition = "outline .15s";
    img.title = "Cliquer pour changer l'image";
    img.onmouseenter = () => {
      img.style.outline = "2px solid #6d7ddf";
    };
    img.onmouseleave = () => {
      img.style.outline = "2px solid transparent";
    };
    img.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openImgModal(idx);
    };
  });
}

function openImgModal(idx) {
  replaceImgIdx = Number(idx) || 0;
  const grid = document.getElementById("img-grid");
  const hint = document.getElementById("img-modal-hint");
  if (hint) hint.textContent = `Image #${replaceImgIdx + 1} de l’aperçu — choisis un visuel puis « Utiliser »`;

  // Déduplique aussi côté client
  const uniq = [];
  const seen = new Set();
  for (const src of descImages || []) {
    const key = String(src).replace(/\._[^.\/]+_\./g, ".").split("?")[0].toLowerCase();
    const id = (key.match(/\/images\/i\/([a-z0-9]+)/i) || [])[1] || key;
    if (seen.has(id)) continue;
    seen.add(id);
    uniq.push(src);
  }
  descImages = uniq;

  if (!descImages.length) {
    grid.innerHTML = `<p class="text-sm text-zinc-400 col-span-full">Aucune image scrapée — régénère avec une URL Amazon valide.</p>`;
  } else {
    grid.innerHTML = descImages
      .map(
        (src, i) =>
          `<div class="rounded-xl overflow-hidden border bg-zinc-50 ${i === replaceImgIdx ? "ring-2 ring-brand-500" : ""}">
            <img src="${escapeHtml(src)}" class="w-full h-36 object-cover" alt="Proposition ${i + 1}" />
            <div class="p-2 flex items-center justify-between gap-2">
              <span class="text-[11px] text-zinc-400">#${i + 1}</span>
              <button type="button" data-pick-img="${i}" class="btn-primary !px-3 !py-1.5 text-xs">Utiliser</button>
            </div>
          </div>`
      )
      .join("");
  }
  const m = document.getElementById("img-modal");
  m.classList.remove("hidden");
  m.classList.add("flex");
}

function closeImgModal() {
  const m = document.getElementById("img-modal");
  m.classList.add("hidden");
  m.classList.remove("flex");
}

async function pickImage(i) {
  const idx = Number(i);
  if (!descImages[idx]) return;
  const chosen = descImages[idx];
  const imgs = [...descImages];
  // Remplace le slot cliqué dans l'aperçu (ou met en principal)
  const slot = Math.min(replaceImgIdx, Math.max(0, imgs.length - 1));
  imgs.splice(idx, 1);
  imgs.splice(slot, 0, chosen);
  // Assure que l'image choisie est aussi en première (visuel principal du template)
  descImages = [chosen, ...imgs.filter((u) => u !== chosen)];
  closeImgModal();
  const tip = document.getElementById("desc-theme-status");
  if (tip) tip.textContent = "Image mise à jour…";
  await regenerateDescTheme();
  if (tip) tip.textContent = "Image appliquée";
}

document.getElementById("img-grid")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-pick-img]");
  if (!btn) return;
  pickImage(btn.getAttribute("data-pick-img"));
});

async function generateFromUrl() {
  const productUrl = document.getElementById("desc-url").value.trim();
  if (!productUrl) return alert("URL requise");
  const btn = document.getElementById("desc-btn");
  btn.disabled = true;
  btn.innerHTML =
    '<span class="spinner inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span> Analyse et génération en cours...';
  try {
    const res = await fetch(API + "/api/generate-listing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productUrl, themeColor }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Erreur");
    applyDescResult(json.data);
  } catch (err) {
    alert("Erreur: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Générer la description";
  }
}

function copyHtml() {
  navigator.clipboard.writeText(document.getElementById("desc-html").textContent);
  alert("HTML copié");
}

async function runBulking() {
  const raw = document.getElementById("bulk-urls").value.trim();
  const urls = raw.split(/\n+/).map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u));
  const cons = document.getElementById("bulk-console");
  const btn = document.getElementById("bulk-btn");
  if (!urls.length) return alert("Ajoutez au moins une URL");
  btn.disabled = true;
  cons.innerHTML = "";
  const margin = Number(document.getElementById("bulk-margin").value) || 25;
  for (const url of urls) {
    cons.innerHTML += colorizeLog(`[IMPORT] ${url.slice(0, 80)}`);
    try {
      const res = await fetch(API + "/api/generate-listing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productUrl: url, themeColor }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "fail");
      const price = json.data.suggested_price
        ? Number((json.data.suggested_price * (1 + margin / 100) / 1.8).toFixed(2))
        : null;
      cons.innerHTML += colorizeLog(
        `[OK] ${String(json.data.seo_title || "").slice(0, 60)} — id ${json.data.id}${price ? " ~" + price + "€" : ""}`
      );
    } catch (err) {
      cons.innerHTML += colorizeLog(`[ERROR] ${err.message}`);
    }
    cons.scrollTop = cons.scrollHeight;
  }
  cons.innerHTML += colorizeLog(`[DONE] Bulking terminé — ${urls.length} URL(s)`);
  btn.disabled = false;
}

async function runSubstitution() {
  const oldUrl = document.getElementById("sub-old").value.trim();
  const newUrl = document.getElementById("sub-new").value.trim();
  if (!newUrl) return alert("URL fournisseur requise");
  const btn = document.getElementById("sub-btn");
  btn.disabled = true;
  btn.textContent = "Substitution...";
  try {
    const res = await fetch(API + "/api/generate-listing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productUrl: newUrl, themeColor }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Erreur");
    const box = document.getElementById("sub-result");
    box.classList.remove("hidden");
    box.innerHTML = `<p class="font-medium text-emerald-700 mb-1">Substitution prête</p>
      <p><span class="text-zinc-400">Ancien :</span> ${escapeHtml(oldUrl || "(non fourni)")}</p>
      <p><span class="text-zinc-400">Nouveau :</span> ${escapeHtml(json.data.seo_title || "")}</p>
      <p><span class="text-zinc-400">Listing local #${json.data.id}</span> — ${json.data.suggested_price?.toFixed?.(2) || "—"} €</p>
      <button onclick="navigate('listings')" class="mt-3 text-brand-600 text-sm font-medium">Voir dans Mes Listings →</button>`;
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Substituer";
  }
}

function loadSettings() {
  checkHealth();
  loadSetupStatus();
  loadAccounts();
}

async function loadSetupStatus() {
  const box = document.getElementById("setup-checklist");
  const sample = document.getElementById("setup-browse-sample");
  if (!box) return;
  box.innerHTML = `<p class="text-sm text-zinc-400">Vérification…</p>`;
  try {
    const res = await fetch(API + "/api/setup");
    const json = await res.json();
    const d = json.data || {};
    const nameEl = document.getElementById("settings-profile-name");
    const emailEl = document.getElementById("settings-profile-email");
    const envEl = document.getElementById("settings-env");
    const oauthEl = document.getElementById("settings-oauth");
    if (nameEl) nameEl.textContent = d.seller?.userId || "Non connecté";
    if (emailEl) emailEl.textContent = d.seller?.email || "—";
    if (envEl) envEl.textContent = d.ebayEnv === "production" ? "Production (réel)" : "Hors production";
    if (oauthEl) oauthEl.textContent = d.seller?.ok ? "Connecté" : d.seller?.error || "À configurer";

    const conn = document.getElementById("settings-connectivity");
    if (conn) {
      let suppliers = {};
      try {
        const cfg = await (await fetch(API + "/api/auto-orders/config")).json();
        suppliers = cfg.data || {};
      } catch (_) {}
      const cards = [
        ["eBay", d.seller?.ok, d.seller?.userId || "OAuth"],
        ["Browse API", d.browse?.ok, d.browse?.api || d.browse?.error || "—"],
        ["Amazon", suppliers.amazon?.connected, suppliers.amazon?.enabled === false ? "Désactivé" : suppliers.amazon?.connected ? "Connecté" : "Non connecté"],
        ["AliExpress", suppliers.aliexpress?.connected, suppliers.aliexpress?.connected ? "Connecté" : "Extension / manuel"],
        ["Cdiscount", suppliers.cdiscount?.connected || suppliers.cdiscount?.enabled, suppliers.cdiscount?.comingSoon ? "Bientôt" : suppliers.cdiscount?.connected ? "Connecté" : "Activé"],
        ["LLM local", d.llm?.ok, d.llm?.ok ? "OK" : "Optionnel"],
      ];
      conn.innerHTML = cards
        .map(
          ([label, ok, detail]) =>
            `<div class="p-3 rounded-xl border ${ok ? "bg-emerald-50 border-emerald-100" : "bg-zinc-50 border-zinc-100"}">
              <p class="font-medium text-sm">${label}</p>
              <p class="text-xs text-zinc-500 mt-0.5">${escapeHtml(String(detail || ""))}</p>
            </div>`
        )
        .join("");
    }

    const rows = [
      [
        "Compte vendeur OAuth",
        d.seller?.ok,
        d.seller?.ok
          ? d.seller.userId + (d.seller.email ? ` (${d.seller.email})` : "")
          : d.seller?.error || "npm run oauth:prod",
      ],
      ["Browse API (live)", d.prodKeys && d.browse?.ok, d.browse?.ok ? d.browse.api : d.browse?.error || "EBAY_PROD_*"],
      ["Refresh token Production", d.refreshTokenProd, d.refreshTokenProd ? "OK" : "npm run oauth:prod"],
      ["Policies Production", d.policiesProd, d.policiesProd ? "OK" : "npm run policies:prod"],
      ["LLM local (optionnel)", d.llm?.ok, d.llm?.ok ? "LM Studio OK" : "Non requis"],
    ];
    box.innerHTML = rows
      .map(
        ([label, ok, detail]) =>
          `<div class="flex items-start gap-3 p-3 rounded-xl border ${ok ? "bg-green-50 border-green-100" : "bg-amber-50 border-amber-100"}">
            <span class="text-lg leading-none">${ok ? "✅" : "⚠️"}</span>
            <div class="min-w-0"><p class="text-sm font-medium">${label}</p><p class="text-xs text-zinc-500 truncate">${escapeHtml(String(detail || ""))}</p></div>
          </div>`
      )
      .join("");
    if (sample) {
      if (d.browse?.sample) {
        sample.classList.remove("hidden");
        sample.textContent = "Exemple live : " + d.browse.sample;
      } else {
        sample.classList.add("hidden");
      }
    }
    const mode = document.getElementById("settings-mode");
    if (mode) mode.textContent = d.browse?.ok ? "live browse-api" : "fallback / scrape";
    const darkChk = document.getElementById("settings-dark");
    if (darkChk) darkChk.checked = document.body.classList.contains("dark-mode");
  } catch (err) {
    box.innerHTML = `<p class="text-sm text-red-500">Impossible de charger le statut : ${escapeHtml(err.message)}</p>`;
  }
}

checkHealth();
loadDashboard();


// Expose handlers for onclick + bind as backup
["navigate","runTitleBuilder","generateFromUrl","runSnipe","analyzeCompetitor","copyTitle","copyHtml","setTheme","runBulking","runSubstitution","runManualImport","publishManualListing","loadRankings","loadListings","loadOrders","loadSettings","viewListing","publishListing","deleteListing","dedupeListings","scrubListingImages","closeModal","closeImgModal","pickImage","addKeyword","removeKeyword","kwPage","onTitleEdit","advanceOrder","viewCompetitorHistory","deleteCompetitorHistory","syncListing","endListingEbay","syncEbayOrders","addEbayAccount","activateEbayAccount","removeEbayAccount","loadAccounts","openSupplierOrder","copyShipAddress","processAutoOrderQueue","saveAutoOrderSettings","toggleSupplier","connectSupplier","loadSupplierConfig","toggleDarkMode","deleteSavSelected","selectSav","syncSavMessages","draftSavSelected","escalateSavSelected","sendSavSelected","autoDraftAllSav","loadSav"].forEach((name) => {
  if (typeof globalThis[name] === "function") window[name] = globalThis[name];
});

document.addEventListener("DOMContentLoaded", () => {
  initDescPalette();
  const map = [
    ["title-btn", "runTitleBuilder"],
    ["desc-btn", "generateFromUrl"],
    ["snipe-btn", "runSnipe"],
    ["competitor-btn", "analyzeCompetitor"],
  ];
  for (const [id, fn] of map) {
    const el = document.getElementById(id);
    // Ne pas re-binder si onclick HTML est déjà présent (évite double exécution)
    if (el && el.getAttribute("onclick")) continue;
    if (el && typeof window[fn] === "function" && !el.dataset.bound) {
      el.addEventListener("click", (e) => {
        e.preventDefault();
        window[fn]();
      });
      el.dataset.bound = "1";
    }
  }
});
