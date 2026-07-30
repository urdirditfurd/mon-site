const API = window.location.origin;
let themeColor = "#667eea";
let titleData = null;
let titleTab = "keywords";
let selectedKeywords = [];

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
    .replace(/>/g, "&gt;");
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

async function checkHealth() {
  const el = document.getElementById("api-status");
  try {
    const res = await fetch(API + "/api/health");
    const json = await res.json();
    el.className = "text-xs bg-green-50 text-green-600 px-2.5 py-1 rounded-full font-medium";
    el.textContent = "● API connectée";
    document.getElementById("settings-llm").textContent = json.llm_url || "—";
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

function loadAnalytics() {
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

async function loadRankings() {
  const res = await fetch(API + "/api/rankings");
  const json = await res.json();
  document.getElementById("rankings-body").innerHTML = (json.data || [])
    .map(
      (p) =>
        `<tr class="border-b border-zinc-50"><td class="p-3 font-semibold text-brand-600">${p.rank}</td><td class="p-3">${escapeHtml(p.title)}</td><td class="p-3 text-zinc-500">${escapeHtml(p.category)}</td><td class="p-3">${p.price.toFixed(2)} €</td><td class="p-3">${p.sold}</td></tr>`
    )
    .join("");
}

async function analyzeCompetitor() {
  const seller = document.getElementById("competitor-input").value.trim();
  if (!seller) return alert("Nom vendeur requis");
  const res = await fetch(API + "/api/competitors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seller }),
  });
  const json = await res.json();
  if (!json.success) return alert(json.error || "Erreur");
  const d = json.data;
  const box = document.getElementById("competitor-result");
  box.classList.remove("hidden");
  box.innerHTML = `
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="bg-white rounded-2xl border p-4"><p class="text-xs text-zinc-400">Chiffre d'Affaires / mois</p><p class="text-xl font-bold">${d.revenue.toFixed(2)} €</p></div>
      <div class="bg-white rounded-2xl border p-4"><p class="text-xs text-zinc-400">Annonces actives</p><p class="text-xl font-bold">${d.activeListings}</p></div>
      <div class="bg-white rounded-2xl border p-4"><p class="text-xs text-zinc-400">Prix moyen</p><p class="text-xl font-bold">${d.avgPrice.toFixed(2)} €</p></div>
      <div class="bg-white rounded-2xl border p-4"><p class="text-xs text-zinc-400">Taux de vente</p><p class="text-xl font-bold">${d.sellThrough}%</p></div>
    </div>
    <div class="bg-white rounded-2xl border overflow-hidden">
      <div class="p-4 border-b font-semibold">Meilleures ventes — ${escapeHtml(d.seller)}</div>
      <table class="w-full text-sm"><thead class="text-left text-zinc-400 border-b"><tr><th class="p-3">Produit</th><th class="p-3">Prix</th><th class="p-3">Vendus</th></tr></thead>
      <tbody>${d.bestsellers
        .map(
          (b) =>
            `<tr class="border-b border-zinc-50"><td class="p-3"><a class="text-brand-600 hover:underline" href="${b.url}" target="_blank">${escapeHtml(b.title)}</a></td><td class="p-3">${b.price.toFixed(2)} €</td><td class="p-3">${b.sold}</td></tr>`
        )
        .join("")}</tbody></table>
    </div>`;
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
    testMode: document.getElementById("snipe-test").checked,
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
          cons.innerHTML += `<div>${escapeHtml(ev.message)}</div>`;
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
        `<tr class="border-b border-zinc-50"><td class="p-3 font-mono text-xs">${o.id}</td><td class="p-3">${escapeHtml(o.product)}</td><td class="p-3">${escapeHtml(o.supplier)}</td><td class="p-3">${o.amount.toFixed(2)} €</td><td class="p-3"><span class="px-2 py-1 rounded-full text-xs ${colors[o.status] || ""}">${o.status}</span></td></tr>`
    )
    .join("");
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
  if (!query) return;
  const res = await fetch(API + "/api/title-builder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  titleData = json.data;
  selectedKeywords = [query];
  document.getElementById("title-results").classList.remove("hidden");
  document.getElementById("title-meta").textContent = `${titleData.analyzedListings} annonces analysées${titleData.live === false ? " (fallback)" : " (live)"}`;
  updateFinalTitle();
  renderKeywords();
}

function updateFinalTitle() {
  document.getElementById("final-title").value = selectedKeywords.join(" ").slice(0, 80);
}

function renderKeywords() {
  if (!titleData) return;
  const list = titleData[titleTab] || [];
  document.getElementById("kw-list").innerHTML = list
    .map(
      (k) =>
        `<button class="keyword-chip px-3 py-2 rounded-xl border text-left text-sm bg-zinc-50" onclick="addKeyword('${escapeHtml(k.keyword).replace(/'/g, "\\'")}')">
          <div class="font-medium">${escapeHtml(k.keyword)}</div>
          <div class="text-[10px] text-zinc-400">${k.searches} searches · ${k.sales} sales</div>
        </button>`
    )
    .join("");
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
  document.querySelectorAll(".kw-tab").forEach((b) => {
    b.className = "kw-tab px-3 py-1.5 rounded-lg text-sm text-zinc-500";
  });
  btn.className = "kw-tab px-3 py-1.5 rounded-lg text-sm bg-brand-50 text-brand-700";
  renderKeywords();
});

function setTheme(color) {
  themeColor = color;
}

async function generateFromUrl() {
  const productUrl = document.getElementById("desc-url").value.trim();
  if (!productUrl) return alert("URL requise");
  const btn = document.getElementById("desc-btn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"></span> Génération...';
  try {
    const res = await fetch(API + "/api/generate-listing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productUrl, themeColor }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Erreur");
    const html = json.data.html_description || "";
    document.getElementById("desc-html").textContent = html;
    document.getElementById("desc-preview").innerHTML = html;
    if (json.data.live === false && json.data.scrape_error) {
      console.warn("Scrape fallback:", json.data.scrape_error);
    }
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

function loadSettings() {
  checkHealth();
}

checkHealth();
loadDashboard();
