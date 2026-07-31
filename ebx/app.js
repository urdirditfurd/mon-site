const API = window.location.origin;
let themeColor = "#667eea";
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
  dashboard: ["Dashboard", "Vue d'ensemble de votre activité"],
  analytics: ["Analytics", "Performance et tendances"],
  rankings: ["Classements", "Meilleures ventes eBay"],
  competitors: ["Compétiteurs", "Analysez n'importe quel vendeur eBay"],
  sniper: ["Product Sniper", "Auto-Snipe — listing automatique"],
  "auto-order": ["Auto-Order", "Commandes fournisseurs automatisées"],
  listings: ["Mes Listings", "Historique des générations"],
  "title-builder": ["Title Builder", "Construisez un titre SEO eBay"],
  description: ["Description Builder", "Générez une description HTML en 1 clic"],
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
  if (page === "auto-order") loadOrders();
  if (page === "listings") loadListings();
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
}

async function loadDashboard() {
  const res = await fetch(API + "/api/dashboard");
  const json = await res.json();
  const d = json.data || {};
  document.getElementById("dash-cards").innerHTML = [
    ["CA estimé", `${(d.revenue || 0).toFixed(2)} €`],
    ["Commandes", d.orders || 0],
    ["Listings", d.listings || 0],
    ["Marge", `${d.margin || 0}%`],
  ]
    .map(
      ([label, value]) =>
        `<div class="bg-white rounded-2xl border border-zinc-200 p-5"><p class="text-xs text-zinc-400">${label}</p><p class="text-2xl font-bold mt-1">${value}</p></div>`
    )
    .join("");
}

async function loadAnalytics() {
  try {
    const res = await fetch(API + "/api/dashboard");
    const d = (await res.json()).data || {};
    document.getElementById("analytics-kpis").innerHTML = [
      ["CA", `${(d.revenue || 0).toFixed(0)} €`],
      ["Commandes", d.orders || 0],
      ["En attente", d.pendingOrders || 0],
    ]
      .map(
        ([l, v]) =>
          `<div class="bg-white rounded-2xl border p-5"><p class="text-xs text-zinc-400">${l}</p><p class="text-2xl font-bold mt-1">${v}</p></div>`
      )
      .join("");
  } catch (_) {
    document.getElementById("analytics-kpis").innerHTML = "";
  }
  const rows = [
    ["Conversion", 64],
    ["Sell-through", 42],
    ["Marge moyenne", 71],
    ["Snipes réussis", 55],
  ];
  document.getElementById("analytics-bars").innerHTML = rows
    .map(
      ([label, pct]) =>
        `<div><div class="flex justify-between text-sm mb-1"><span>${label}</span><span class="text-zinc-400">${pct}%</span></div><div class="h-2 bg-zinc-100 rounded-full overflow-hidden"><div class="h-full bg-brand-500 rounded-full" style="width:${pct}%"></div></div></div>`
    )
    .join("");
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
    src.textContent = json.live
      ? `Données live (${json.source || "eBay"})`
      : "Fallback local (ajoutez EBAY_PROD_CLIENT_ID pour le live)";
  }
  const list = document.getElementById("rankings-list");
  list.innerHTML = (json.data || [])
    .map((p, i) => {
      const rank = p.rank || i + 1;
      const sold = Math.max(1, Math.round((p.sold || 10) * factor));
      const price = Number(p.price || 0);
      const oldPrice = price > 0 ? (price * 1.35).toFixed(2) : null;
      const img = p.image
        ? `<img src="${escapeHtml(p.image)}" class="w-14 h-14 rounded-lg object-cover bg-zinc-100" alt="" />`
        : `<div class="w-14 h-14 rounded-lg bg-zinc-100 flex items-center justify-center text-zinc-300 text-xs">—</div>`;
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
      body: JSON.stringify({ seller, marketplace: "FR" }),
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
          ${d.live === false ? '<span class="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">fallback</span>' : '<span class="text-[10px] bg-green-50 text-green-700 px-2 py-0.5 rounded-full">live</span>'}
        </div>
        <p class="text-sm text-zinc-400 mt-1">${escapeHtml(location)}</p>
      </div>
      <a href="${ebayUrl}" target="_blank" class="px-4 py-2 border rounded-xl text-sm font-medium">Voir sur eBay</a>
    </div>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div class="bg-brand-600 text-white rounded-2xl p-5 col-span-2 lg:col-span-1">
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
          <button data-bp="month" class="bp-pill px-2 py-1 rounded-full bg-brand-600 text-white">Mois</button>
        </div>
      </div>
      <div id="comp-bestsellers" class="divide-y"></div>
      <div class="p-3 text-center border-t"><button id="comp-more" class="text-sm text-brand-600 font-medium">Voir plus</button></div>
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
        return `<a href="${escapeHtml(b.url || "#")}" target="_blank" class="flex items-center gap-4 p-4 hover:bg-zinc-50">
          <span class="w-6 font-bold text-brand-600">${i + 1}</span>
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
      btn.className = "bp-pill px-2 py-1 rounded-full bg-brand-600 text-white";
      renderBest(btn.dataset.bp);
    });
  });

  document.getElementById("comp-more")?.addEventListener("click", () => {
    showAll = !showAll;
    document.getElementById("comp-more").textContent = showAll ? "Voir moins" : "Voir plus";
    const active = box.querySelector(".bp-pill.bg-brand-600")?.dataset.bp || "month";
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
  const testMode = document.getElementById("snipe-test").checked;
  const realMode = document.getElementById("snipe-real").checked;
  const body = {
    query: document.getElementById("snipe-query")?.value || "gadgets",
    count: Number(document.getElementById("snipe-count").value),
    margin: Number(document.getElementById("snipe-margin").value),
    marketplace: document.getElementById("snipe-market").value,
    ticket: document.getElementById("snipe-ticket").value,
    source: document.getElementById("snipe-source").value,
    autoList: document.getElementById("snipe-autolist").checked,
    testMode: realMode ? false : testMode,
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
    shipped: "bg-indigo-50 text-indigo-700",
    delivered: "bg-green-50 text-green-700",
  };
  document.getElementById("orders-body").innerHTML = (json.data || [])
    .map(
      (o) =>
        `<tr class="border-b border-zinc-50">
          <td class="p-3 font-mono text-xs">${escapeHtml(o.id)}</td>
          <td class="p-3">${escapeHtml(o.product)}</td>
          <td class="p-3">${escapeHtml(o.supplier)}</td>
          <td class="p-3">${Number(o.amount || 0).toFixed(2)} €</td>
          <td class="p-3"><span class="px-2 py-1 rounded-full text-xs ${colors[o.status] || ""}">${escapeHtml(o.status)}</span></td>
          <td class="p-3"><button onclick="advanceOrder('${escapeHtml(o.id)}')" class="text-xs text-brand-600">Avancer</button></td>
        </tr>`
    )
    .join("") || `<tr><td colspan="6" class="p-8 text-center text-zinc-300">Aucune commande.</td></tr>`;
}

async function advanceOrder(id) {
  await fetch(API + "/api/auto-orders/" + encodeURIComponent(id) + "/advance", { method: "POST" });
  loadOrders();
}

async function loadListings() {
  const res = await fetch(API + "/api/listings");
  const json = await res.json();
  const rows = json.data || [];
  document.getElementById("listings-body").innerHTML = rows.length
    ? rows
        .map(
          (item) => `
      <tr class="border-b border-zinc-50">
        <td class="p-3 text-xs text-zinc-400">${new Date(item.created_at).toLocaleString("fr-FR")}</td>
        <td class="p-3 font-medium">${escapeHtml(item.seo_title || "—")}</td>
        <td class="p-3 text-brand-600 font-semibold">${item.suggested_price ? item.suggested_price.toFixed(2) + " €" : "—"}</td>
        <td class="p-3 text-right space-x-2">
          <button onclick="viewListing(${item.id})" class="text-xs bg-brand-50 text-brand-600 px-3 py-1.5 rounded-lg">Voir</button>
          <button onclick="publishListing(${item.id}, this)" class="text-xs bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg">Publier eBay</button>
        </td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="4" class="p-8 text-center text-zinc-300">Aucun listing.</td></tr>`;
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
  if (!confirm("Publier ce listing sur eBay Sandbox ?")) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "...";
  try {
    const res = await fetch(API + "/api/publish-to-ebay/" + id, { method: "POST" });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    btn.textContent = "Publié";
    alert("Publié ! Listing ID: " + (json.data.listingId || "N/A"));
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
    }`;
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
  document.getElementById("final-title").value = t;
  document.getElementById("title-count").textContent = `${t.length}/80`;
}

function onTitleEdit() {
  const t = document.getElementById("final-title").value.slice(0, 80);
  document.getElementById("title-count").textContent = `${t.length}/80`;
}

function renderKeywords() {
  if (!titleData) return;
  const list = titleData[titleTab] || [];
  const start = kwPageIdx * KW_PER_PAGE;
  const page = list.slice(start, start + KW_PER_PAGE);
  const maxPage = Math.max(1, Math.ceil(list.length / KW_PER_PAGE));
  document.getElementById("kw-page-label").textContent = `Page ${kwPageIdx + 1} / ${maxPage}`;
  document.getElementById("kw-list").innerHTML = page
    .map(
      (k) =>
        `<tr class="keyword-row border-b border-zinc-50 cursor-pointer" onclick="addKeyword(${JSON.stringify(k.keyword)})">
          <td class="p-3 font-medium text-brand-700">${escapeHtml(k.keyword)}</td>
          <td class="p-3 text-zinc-500">${Number(k.searches || 0).toLocaleString("fr-FR")}</td>
          <td class="p-3 text-zinc-500">${Number(k.sales || 0).toLocaleString("fr-FR")}</td>
        </tr>`
    )
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
  if (!selectedKeywords.includes(kw)) selectedKeywords.push(kw);
  updateFinalTitle();
}

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
  document.querySelectorAll(".theme-dot").forEach((d) => d.classList.remove("active"));
  (el || document.querySelector(`.theme-dot[data-theme="${color}"]`))?.classList.add("active");
  if (lastDesc) regenerateDescTheme();
}

async function regenerateDescTheme() {
  if (!lastDesc?.product) return;
  try {
    const res = await fetch(API + "/api/rebuild-description", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        product: { ...lastDesc.product, images: descImages.length ? descImages : lastDesc.product.images },
        themeColor,
      }),
    });
    const json = await res.json();
    if (json.success) applyDescResult(json.data);
  } catch (_) {}
}

function applyDescResult(data) {
  lastDesc = data;
  const html = data.html_description || "";
  descImages = data.images || descImages || [];
  document.getElementById("desc-html").textContent = html;
  const preview = document.getElementById("desc-preview");
  preview.classList.remove("flex", "items-center", "justify-center", "text-zinc-300");
  preview.innerHTML = html;
  bindPreviewImages(preview);

  const banner = document.getElementById("desc-banner");
  banner.classList.remove("hidden");
  document.getElementById("desc-detected").textContent =
    "Produit détecté : " + (data.product_name || data.seo_title || "").slice(0, 80);
  document.getElementById("desc-img-badge").textContent = `${(data.images || []).length} images`;
  document.getElementById("desc-source-badge").textContent = data.source || "generic";
}

function bindPreviewImages(preview) {
  preview.querySelectorAll("img").forEach((img, idx) => {
    img.style.cursor = "pointer";
    img.title = "Changer l'image";
    img.onclick = () => openImgModal(idx);
  });
}

function openImgModal(idx) {
  replaceImgIdx = idx;
  const grid = document.getElementById("img-grid");
  grid.innerHTML = (descImages || [])
    .map(
      (src, i) =>
        `<button onclick="pickImage(${i})" class="rounded-xl overflow-hidden border hover:ring-2 ring-brand-400">
          <img src="${escapeHtml(src)}" class="w-full h-32 object-cover" alt="" />
        </button>`
    )
    .join("") || `<p class="text-sm text-zinc-400">Aucune image disponible</p>`;
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
  if (!descImages[i]) return;
  const chosen = descImages[i];
  const imgs = [...descImages];
  imgs.splice(i, 1);
  imgs.unshift(chosen);
  descImages = imgs;
  closeImgModal();
  await regenerateDescTheme();
}

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
    const rows = [
      ["Browse API Production (live)", d.prodKeys && d.browse?.ok, d.browse?.ok ? d.browse.api : d.browse?.error || "Ajoute EBAY_PROD_* dans .env"],
      ["Clés Sandbox (publish)", d.sandboxKeys, d.sandboxKeys ? "OK" : "EBAY_CLIENT_ID / SECRET"],
      ["User token eBay", d.userToken, d.userToken ? "OK" : "EBAY_USER_TOKEN (portail)"],
      ["Business policies", d.policies, d.policies ? "OK" : "node create-policies.js"],
      ["LLM local (optionnel)", d.llm?.ok, d.llm?.ok ? "LM Studio OK" : "Non requis pour scraper"],
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
  } catch (err) {
    box.innerHTML = `<p class="text-sm text-red-500">Impossible de charger le statut : ${escapeHtml(err.message)}</p>`;
  }
}

checkHealth();
loadDashboard();


// Expose handlers for onclick + bind as backup
["navigate","runTitleBuilder","generateFromUrl","runSnipe","analyzeCompetitor","copyTitle","copyHtml","setTheme","runBulking","runSubstitution","loadRankings","loadListings","loadOrders","loadSettings","viewListing","publishListing","closeModal","closeImgModal","pickImage","addKeyword","kwPage","onTitleEdit","advanceOrder","viewCompetitorHistory","deleteCompetitorHistory"].forEach((name) => {
  if (typeof globalThis[name] === "function") window[name] = globalThis[name];
});

document.addEventListener("DOMContentLoaded", () => {
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
