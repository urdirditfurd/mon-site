const API = window.location.origin;
let themeColor = "#6d7ddf";
let authMode = "login";
let webUser = null;
let webEbay = null;
let multiuserEnabled = false;
const DESC_QUICK = ["#6d7ddf", "#242b52", "#22c55e", "#ef4444"];
const DESC_PALETTE = [
  "#6d7ddf", "#4452a8", "#242b52", "#1e1b4b", "#e6e6fa", "#c7d2fe",
  "#0ea5e9", "#0284c7", "#0369a1", "#14b8a6", "#0d9488", "#134e4a",
  "#22c55e", "#16a34a", "#15803d", "#84cc16", "#65a30d", "#3f6212",
  "#f59e0b", "#d97706", "#f97316", "#ea580c", "#ef4444", "#dc2626",
  "#ec4899", "#db2777", "#a855f7", "#8b5cf6", "#7c3aed", "#64748b",
  "#475569", "#334155", "#1f2937", "#111827", "#0f172a", "#ffffff",
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

function syncDescColorIndicators() {
  const hex = themeColor || "#6d7ddf";
  ["desc-theme-current", "desc-theme-current-mini"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.background = hex;
  });
  const hexEl = document.getElementById("desc-theme-hex");
  if (hexEl) hexEl.textContent = hex;
  const picker = document.getElementById("desc-color-picker");
  if (picker) picker.value = hex;
  document.querySelectorAll(".color-swatch").forEach((d) => {
    d.classList.toggle("active", (d.dataset.theme || "").toLowerCase() === hex.toLowerCase());
  });
}

function toggleDescColors(forceOpen) {
  const panel = document.getElementById("desc-colors-panel");
  const btn = document.getElementById("desc-colors-toggle");
  if (!panel) return;
  const open =
    typeof forceOpen === "boolean" ? forceOpen : panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !open);
  if (btn) btn.textContent = open ? "Masquer les couleurs" : "Afficher les couleurs";
  if (open) {
    document.getElementById("page-description")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function initDescPalette() {
  const swatchHtml = (colors) =>
    colors
      .map((c) => {
        const border = c.toLowerCase() === "#ffffff" ? "border border-zinc-300" : "";
        return `<button type="button" class="color-swatch ${border} ${
          themeColor.toLowerCase() === c.toLowerCase() ? "active" : ""
        }" style="background:${c}" data-theme="${c}" title="${c}" onclick="setTheme('${c}', this)"></button>`;
      })
      .join("");
  const quick = document.getElementById("desc-color-quick");
  if (quick) quick.innerHTML = swatchHtml(DESC_QUICK);
  const full = document.getElementById("desc-color-palette");
  if (full) full.innerHTML = swatchHtml(DESC_PALETTE);
  syncDescColorIndicators();
}

function detectThemeFromHtml(html) {
  const h = String(html || "");
  const g = h.match(/linear-gradient\([^)]*?,\s*(#[0-9a-fA-F]{3,8})\b/i);
  if (g?.[1]) return normalizeHex(g[1]);
  const c = h.match(/\bcolor:\s*(#[0-9a-fA-F]{6})\b/i);
  if (c?.[1]) return normalizeHex(c[1]);
  const bg = h.match(/\bbackground:\s*(#[0-9a-fA-F]{6})\b/i);
  if (bg?.[1]) return normalizeHex(bg[1]);
  return "#6d7ddf";
}

function normalizeHex(hex) {
  let h = String(hex || "#6d7ddf").trim();
  if (/^#[0-9a-fA-F]{3}$/.test(h)) {
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  return h.toLowerCase();
}

function replaceThemeInHtml(html, from, to) {
  if (!from || !to || from.toLowerCase() === to.toLowerCase()) return html;
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(html || "").replace(new RegExp(esc, "gi"), to);
}

function syncEditThemeIndicators() {
  const hex = normalizeHex(editThemeColor || "#6d7ddf");
  const cur = document.getElementById("edit-theme-current");
  if (cur) cur.style.background = hex;
  const hexEl = document.getElementById("edit-theme-hex");
  if (hexEl) hexEl.textContent = hex;
  const picker = document.getElementById("edit-color-picker");
  if (picker) picker.value = hex;
  document.querySelectorAll(".edit-color-swatch").forEach((d) => {
    d.classList.toggle("active", normalizeHex(d.dataset.theme || "") === hex);
  });
}

function initEditPalette() {
  const swatchHtml = (colors) =>
    colors
      .map((c) => {
        const border = c.toLowerCase() === "#ffffff" ? "border border-zinc-300" : "";
        return `<button type="button" class="edit-color-swatch ${border}" style="background:${c}" data-theme="${c}" title="${c}" onclick="setEditTheme('${c}', this)"></button>`;
      })
      .join("");
  const quick = document.getElementById("edit-color-quick");
  if (quick) quick.innerHTML = swatchHtml(DESC_QUICK);
  const full = document.getElementById("edit-color-palette");
  if (full) full.innerHTML = swatchHtml(DESC_PALETTE);
  syncEditThemeIndicators();
}

function setEditTheme(color, el) {
  const next = normalizeHex(color || "#6d7ddf");
  const prev = normalizeHex(editThemeColor || "#6d7ddf");
  if (editHtmlDraft && prev !== next) {
    editHtmlDraft = replaceThemeInHtml(editHtmlDraft, prev, next);
  }
  editThemeColor = next;
  document.querySelectorAll(".edit-color-swatch").forEach((d) => d.classList.remove("active"));
  (el || document.querySelector(`.edit-color-swatch[data-theme="${next}"]`))?.classList.add("active");
  syncEditThemeIndicators();
  renderEditModalPreview();
}

function extractImagesFromHtml(html) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = String(html || "");
  return [...wrapper.querySelectorAll("img")]
    .map((img) => img.getAttribute("src") || "")
    .map((src) => src.trim())
    .filter(Boolean);
}

function extractImageFitsFromHtml(html, count) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = String(html || "");
  const tags = [...wrapper.querySelectorAll("img")];
  const fits = [];
  for (let i = 0; i < count; i++) {
    const style = String(tags[i]?.getAttribute("style") || "").toLowerCase();
    fits.push(/object-fit\s*:\s*contain/i.test(style) ? "contain" : "cover");
  }
  return fits;
}

function applyImagePresentationToHtml(html, images, fits) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = String(html || "");
  const tags = [...wrapper.querySelectorAll("img")];
  tags.forEach((img, idx) => {
    if (images[idx]) img.setAttribute("src", images[idx]);
    const fit = fits[idx] === "contain" ? "contain" : "cover";
    let style = String(img.getAttribute("style") || "");
    if (/object-fit\s*:/i.test(style)) {
      style = style.replace(/object-fit\s*:\s*[^;]+;?/gi, `object-fit:${fit};`);
    } else {
      style = `${style.replace(/;?\s*$/, "")};object-fit:${fit};`.replace(/^;/, "");
    }
    // contain = moins zoomé : laisse un peu plus de hauteur visible
    if (fit === "contain") {
      if (/max-height\s*:/i.test(style)) {
        style = style.replace(/max-height\s*:\s*[^;]+;?/gi, "max-height:360px;");
      }
      if (!/background\s*:/i.test(style)) {
        style += "background:#f4f4f5;";
      }
    }
    img.setAttribute("style", style.replace(/;;+/g, ";").trim());
  });
  return wrapper.innerHTML;
}

function applyImageOrderToHtml(html, images) {
  return applyImagePresentationToHtml(html, images, editImageFits);
}

function renderEditImagesManager() {
  const box = document.getElementById("edit-images-list");
  if (!box) return;
  if (!editImageUrls.length) {
    box.innerHTML = `<div class="col-span-full text-sm text-zinc-400">Aucune image détectée dans cette annonce.</div>`;
    return;
  }
  box.innerHTML = editImageUrls
    .map((src, idx) => {
      const isMain = idx === 0;
      const fit = editImageFits[idx] === "contain" ? "contain" : "cover";
      const zoomLabel = fit === "contain" ? "Vue entière" : "Zoomée";
      return `<div class="rounded-xl overflow-hidden border bg-white ${isMain ? "ring-2 ring-brand-500 border-brand-200" : "border-zinc-200"}">
        <div class="w-full h-36 bg-zinc-100 flex items-center justify-center overflow-hidden">
          <img src="${escapeHtml(src)}" class="w-full h-full bg-zinc-50" style="object-fit:${fit}" alt="Image ${idx + 1}" />
        </div>
        <div class="p-2 space-y-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] ${isMain ? "text-brand-700 font-semibold" : "text-zinc-400"}">#${idx + 1}${isMain ? " · Principale" : ""} · ${zoomLabel}</span>
            <button type="button" onclick="promoteEditImage(${idx})" class="text-[11px] px-2 py-1 rounded border ${isMain ? "bg-brand-50 border-brand-200 text-brand-700" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}">Première</button>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" onclick="zoomEditImage(${idx}, -1)" class="px-2 py-1.5 rounded border text-sm font-semibold border-zinc-200 text-zinc-700 hover:bg-zinc-50" title="Dézoomer (voir toute la photo)">−</button>
            <button type="button" onclick="zoomEditImage(${idx}, 1)" class="px-2 py-1.5 rounded border text-sm font-semibold border-zinc-200 text-zinc-700 hover:bg-zinc-50" title="Zoomer (remplir le cadre)">+</button>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" onclick="moveEditImage(${idx}, -1)" class="px-2 py-1 rounded border text-xs ${idx === 0 ? "text-zinc-300 border-zinc-100 cursor-not-allowed" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}" ${idx === 0 ? "disabled" : ""}>← Gauche</button>
            <button type="button" onclick="moveEditImage(${idx}, 1)" class="px-2 py-1 rounded border text-xs ${idx === editImageUrls.length - 1 ? "text-zinc-300 border-zinc-100 cursor-not-allowed" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50"}" ${idx === editImageUrls.length - 1 ? "disabled" : ""}>Droite →</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

function renderEditModalPreview() {
  const preview = document.getElementById("modal-content");
  if (preview) preview.innerHTML = editHtmlDraft || "<p class='text-zinc-400'>Pas de description</p>";
  renderEditImagesManager();
}

function syncEditImagePresentation() {
  editHtmlDraft = applyImagePresentationToHtml(editHtmlDraft, editImageUrls, editImageFits);
  renderEditModalPreview();
}

function moveEditImage(index, delta) {
  const from = Number(index);
  const to = from + Number(delta);
  if (from < 0 || from >= editImageUrls.length || to < 0 || to >= editImageUrls.length) return;
  const next = [...editImageUrls];
  const nextFits = [...editImageFits];
  const [img] = next.splice(from, 1);
  const [fit] = nextFits.splice(from, 1);
  next.splice(to, 0, img);
  nextFits.splice(to, 0, fit || "cover");
  editImageUrls = next;
  editImageFits = nextFits;
  syncEditImagePresentation();
}

function promoteEditImage(index) {
  const idx = Number(index);
  if (idx <= 0 || idx >= editImageUrls.length) return;
  const next = [...editImageUrls];
  const nextFits = [...editImageFits];
  const [img] = next.splice(idx, 1);
  const [fit] = nextFits.splice(idx, 1);
  next.unshift(img);
  nextFits.unshift(fit || "cover");
  editImageUrls = next;
  editImageFits = nextFits;
  syncEditImagePresentation();
}

/** − = vue entière (moins zoomé), + = remplir le cadre (plus zoomé). */
function zoomEditImage(index, direction) {
  const idx = Number(index);
  if (idx < 0 || idx >= editImageUrls.length) return;
  while (editImageFits.length < editImageUrls.length) editImageFits.push("cover");
  editImageFits[idx] = Number(direction) < 0 ? "contain" : "cover";
  syncEditImagePresentation();
}

if (typeof localStorage !== "undefined" && localStorage.getItem("ebx-dark") === "1") {
  document.addEventListener("DOMContentLoaded", () => toggleDarkMode(true));
}

let titleData = null;
let titleTab = "keywords";
let selectedKeywords = [];
let kwPageIdx = 0;
const KW_PER_PAGE = 8;
let rankingsPeriod = "day";
let dashTrendPeriod = "day";
let dashMarketplace = "FR";
let competitorPeriod = "month";
let lastCompetitor = null;
let lastDesc = null;
let descImages = [];
let replaceImgIdx = 0;
let editHtmlDraft = "";
let editThemeColor = "#6d7ddf";
let editImageUrls = [];
/** Par image : "cover" (zoomée) | "contain" (vue entière). */
let editImageFits = [];

const PAGE_META = {
  dashboard: ["Dashboard", "Ce qui se passe en temps réel sur eBay"],
  analytics: ["Analytics", "Performance et tendances"],
  competitors: ["Compétiteurs", "Analysez n'importe quel vendeur eBay"],
  sniper: ["Product Sniper", "Import fournisseur vers Mes Listings"],
  "auto-publish": ["Auto-Publish", "Publication eBay après comparaison des prix concurrents"],
  listings: ["Mes Listings", "Annonces générées"],
  "title-builder": ["Title Builder", "Construisez un titre SEO eBay"],
  description: ["Description Builder", "Générez une description HTML en 1 clic"],
  sav: ["Notifications", "Inbox eBay (messages + ventes), pas les e-mails marketing"],
  settings: ["Paramètres", "Compte, eBay & Auto-Order"],
};

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function navigate(page, opts = {}) {
  if (page === "auto-order" || page === "rankings") {
    opts = { ...opts, scrollTo: page === "auto-order" ? "auto-order" : opts.scrollTo };
    page = "settings";
  }
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".nav-link").forEach((l) => l.classList.remove("active"));
  document.getElementById("page-" + page)?.classList.add("active");
  document.querySelector(`[data-page="${page}"]`)?.classList.add("active");
  const meta = PAGE_META[page] || [page, ""];
  document.getElementById("page-title").textContent = meta[0];
  document.getElementById("page-subtitle").textContent = meta[1];

  if (page === "dashboard") loadDashboard();
  if (page === "analytics") loadAnalytics();
  if (page === "competitors") loadCompetitorHistory();
  if (page === "listings") loadListings();
  if (page === "auto-publish") {
    loadAutoPublishHistory();
    startAutoPublishPoll();
  } else {
    stopAutoPublishPoll();
  }
  if (page === "sav") {
    loadSavInboxPage();
  }
  if (page === "settings") {
    loadSettings();
    loadSupplierConfig();
    loadOrders();
    markNotificationsRead({ types: ["sale"] });
    if (opts.scrollTo === "auto-order") {
      setTimeout(() => {
        document.getElementById("settings-auto-order")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    }
  }
}

document.querySelectorAll(".nav-link").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    navigate(link.dataset.page);
  });
});

document.getElementById("dash-trending-period")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-trend-period]");
  if (!btn) return;
  dashTrendPeriod = btn.dataset.trendPeriod;
  document.querySelectorAll("#dash-trending-period .trend-period-pill").forEach((b) => {
    b.classList.remove("active");
    b.classList.add("text-zinc-500");
  });
  btn.classList.add("active");
  btn.classList.remove("text-zinc-500");
  loadDashboard({ refreshTrend: false });
});

document.getElementById("dash-market")?.addEventListener("change", (e) => {
  dashMarketplace = String(e.target.value || "FR").toUpperCase();
  loadDashboard({ refreshTrend: true, period: dashTrendPeriod });
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
    const llmEl = document.getElementById("settings-llm");
    if (llmEl) llmEl.textContent = json.llm_url || "—";
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
  return formatMoney(n, "EUR", decimals);
}

function formatMoney(n, currency = "EUR", decimals = 0) {
  const v = Number(n) || 0;
  const cur = String(currency || "EUR").toUpperCase();
  const locale = cur === "USD" ? "en-US" : cur === "GBP" ? "en-GB" : "fr-FR";
  const code = cur === "USD" || cur === "GBP" ? cur : "EUR";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    }).format(v);
  } catch (_) {
    const sym = code === "USD" ? "$" : code === "GBP" ? "£" : "€";
    return `${v.toLocaleString(locale, { maximumFractionDigits: decimals })} ${sym}`;
  }
}

function currencyForMarket(market) {
  const m = String(market || "FR").toUpperCase();
  if (m === "US") return "USD";
  if (m === "GB") return "GBP";
  return "EUR";
}

function formatCaShort(n, currency = "EUR") {
  const v = Number(n) || 0;
  const cur = String(currency || "EUR").toUpperCase();
  const sym = cur === "USD" ? "$" : cur === "GBP" ? "£" : "€";
  if (v >= 1000) return Math.round(v / 1000) + "k " + sym;
  return formatMoney(v, cur, 0);
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

async function loadDashboard(opts = {}) {
  bindDashboardCalendarControls();
  const refresh = opts.refreshTrend ? "1" : "0";
  const period = opts.period || dashTrendPeriod || "day";
  const marketEl = document.getElementById("dash-market");
  if (opts.marketplace) dashMarketplace = String(opts.marketplace).toUpperCase();
  else if (marketEl?.value) dashMarketplace = String(marketEl.value).toUpperCase();
  const marketplace = dashMarketplace || "FR";
  if (marketEl && marketEl.value !== marketplace) marketEl.value = marketplace;

  const moneyCur = currencyForMarket(marketplace);
  const trendBox = document.getElementById("dash-trending");
  if (trendBox && (opts.refreshTrend || opts.marketplace)) {
    trendBox.innerHTML = `<p class="text-zinc-400 text-sm py-4">Chargement tendances ${escapeHtml(marketplace)}…</p>`;
  }

  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const abortTimer = setTimeout(() => ctrl?.abort?.(), 14000);
  let d = {};
  try {
    const res = await fetch(
      API +
        `/api/dashboard?trendPeriod=${encodeURIComponent(period)}&marketplace=${encodeURIComponent(
          marketplace
        )}&refresh=${refresh}`,
      {
        credentials: "same-origin",
        ...(ctrl ? { signal: ctrl.signal } : {}),
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        res.status === 401
          ? "HTTP 401 — redémarre le serveur (auth désactivée)"
          : `HTTP ${res.status}${body ? ": " + body.slice(0, 80) : ""}`
      );
    }
    const json = await res.json();
    d = json.data || {};
  } catch (err) {
    console.warn("[EBX] dashboard load:", err);
    const caEl = document.getElementById("dash-market-ca");
    if (caEl && caEl.textContent.includes("—")) caEl.textContent = formatMoney(180000, moneyCur, 2);
    const tickEl = document.getElementById("dash-market-tick");
    if (tickEl) tickEl.textContent = "↑ sync en cours…";
    if (trendBox) {
      trendBox.innerHTML = `<p class="text-amber-600 text-sm py-4">Dashboard lent / hors-ligne — réessaie Actualiser. (${escapeHtml(
        err.name === "AbortError" ? "délai dépassé" : err.message || "erreur"
      )})</p>`;
    }
    return;
  } finally {
    clearTimeout(abortTimer);
  }

  if (d.trendingPeriod) dashTrendPeriod = d.trendingPeriod;
  if (d.trendingMarketplace) {
    dashMarketplace = String(d.trendingMarketplace).toUpperCase();
    if (marketEl) marketEl.value = dashMarketplace;
  }
  const cur = d.marketPulse?.currency || currencyForMarket(dashMarketplace);

  document.querySelectorAll("#dash-trending-period .trend-period-pill").forEach((b) => {
    const on = b.dataset.trendPeriod === dashTrendPeriod;
    b.classList.toggle("active", on);
    b.classList.toggle("text-zinc-500", !on);
  });

  const titleEl = document.getElementById("dash-trending-title");
  if (titleEl) titleEl.textContent = `🔥 Produits Tendances eBay ${dashMarketplace}`;
  const sellersTitle = document.getElementById("dash-sellers-title");
  if (sellersTitle) sellersTitle.textContent = `Top Vendeurs ${dashMarketplace}`;

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
  let marketRevenueLive = Number(pulse.marketRevenue);
  if (!Number.isFinite(marketRevenueLive) || marketRevenueLive < 1000) {
    marketRevenueLive = dashMarketplace === "US" ? 650000 : 180000;
  }
  if (caEl) caEl.textContent = formatMoney(marketRevenueLive, cur, 2);
  if (tickEl) tickEl.textContent = `↑ +${formatMoney(pulse.tick ?? 12, cur, 2)} à l'instant`;
  if (labelEl) {
    labelEl.textContent = pulse.label || `estimation CA marché eBay ${dashMarketplace} aujourd'hui`;
  }
  if (shopEl) {
    const shop = Number(d.revenue) || 0;
    const src =
      d.revenueSource === "ebay_orders"
        ? "eBay sync"
        : d.revenueSource === "local_orders"
          ? "local"
          : "estim.";
    shopEl.textContent = `Ton CA boutique : ${formatMoney(shop, "EUR", 2)} (${src})`;
  }

  if (marketTickTimer) clearInterval(marketTickTimer);
  marketTickTimer = setInterval(() => {
    if (!caEl || !tickEl) return;
    const bump = 8 + Math.random() * 55;
    marketRevenueLive += bump;
    caEl.textContent = formatMoney(marketRevenueLive, cur, 2);
    tickEl.textContent = `↑ +${formatMoney(bump, cur, 2)} à l'instant`;
  }, 4500);

  const periodLabel =
    dashTrendPeriod === "week" ? "cette semaine" : dashTrendPeriod === "month" ? "ce mois" : "aujourd'hui";
  const trendMeta = document.getElementById("dash-trending-meta");
  if (trendMeta) {
    if (d.trendingLive) {
      trendMeta.innerHTML = `Niches ${escapeHtml(dashMarketplace)} · <span class="text-emerald-600 font-medium">${periodLabel}</span>${
        d.trendingCached ? (d.trendingStale ? " · cache (maj en fond)" : " · cache") : " · live eBay"
      }`;
    } else {
      trendMeta.textContent = `Aperçu ${dashMarketplace} — Actualiser pour tenter le live Browse eBay`;
    }
  }

  if (trendBox) {
    const items = d.trending || [];
    trendBox.innerHTML = items.length
      ? items
          .slice(0, 10)
          .map((t, i) => {
            const ca = t.ca != null ? t.ca : Math.round((Number(t.price) || 0) * (Number(t.sold) || 0));
            const img = productThumbHtml(t.image, t.title, "w-10 h-10");
            const soldRaw = Number(t.sold) || 0;
            const soldTxt =
              soldRaw > 0 ? `${soldRaw}${t.soldEstimated ? "~" : ""}` : "—";
            const title = t.url
              ? `<a href="${escapeHtml(t.url)}" target="_blank" rel="noopener" class="font-medium text-[#4452a8] hover:underline line-clamp-2 leading-snug">${escapeHtml(
                  t.title
                )}</a>`
              : `<p class="font-medium text-ink-900 line-clamp-2 leading-snug">${escapeHtml(t.title)}</p>`;
            const niche = t.category
              ? `<p class="text-[10px] text-zinc-400 truncate mt-0.5">${escapeHtml(t.category)}</p>`
              : "";
            return `<div class="grid grid-cols-[2rem_2.5rem_1fr] sm:grid-cols-[2rem_2.5rem_1fr_3.5rem_3.5rem_3.5rem] gap-2 items-center py-2.5 px-1 hover:bg-lunar-50 rounded-lg">
              <span class="w-7 h-7 rounded-md border border-[#6d7ddf]/40 text-[#4452a8] text-xs font-bold flex items-center justify-center">${
                i + 1
              }</span>
              ${img}
              <div class="min-w-0">${title}${niche}</div>
              <div class="hidden sm:block text-right text-sm font-semibold text-emerald-600">${soldTxt}</div>
              <div class="hidden sm:block text-right text-sm font-bold">${formatMoney(t.price, cur, 0)}</div>
              <div class="hidden sm:block text-right text-sm font-bold text-emerald-600">${
                ca > 0 ? formatCaShort(ca, cur) : "—"
              }</div>
            </div>`;
          })
          .join("")
      : `<p class="text-zinc-400 text-sm py-4">Aucune tendance ${escapeHtml(dashMarketplace)} — clique Actualiser.</p>`;
  }

  const trendUpdated = document.getElementById("dash-trending-updated");
  if (trendUpdated) {
    const ts = d.trendingUpdatedAt ? new Date(d.trendingUpdatedAt) : new Date();
    const hhmm = ts.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const day = ts.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
    trendUpdated.textContent = `Mis à jour ${day} ${hhmm}${
      d.trendingCached ? (d.trendingStale ? " (cache, maj fond)" : " (cache)") : ""
    } · ${dashMarketplace}`;
  }

  const seedsEl = document.getElementById("dash-trending-seeds");
  if (seedsEl) {
    const seeds = d.trendingSeeds || [];
    seedsEl.textContent = seeds.length
      ? `Niches ${dashMarketplace} (${periodLabel}) : ${seeds.slice(0, 8).join(" · ")}`
      : "";
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
  // Conservé pour l’UI compétiteurs uniquement (pas les classements tendances)
  if (period === "day") return 0.05;
  if (period === "week") return 0.28;
  return 1;
}

async function refreshDashboardTrending() {
  const btn = document.querySelector('button[onclick="refreshDashboardTrending()"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = "…";
  }
  try {
    await loadDashboard({ refreshTrend: true, period: dashTrendPeriod });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Actualiser";
    }
  }
}

async function loadRankings() {
  const res = await fetch(
    API + `/api/rankings?period=${encodeURIComponent(rankingsPeriod)}&refresh=0`
  );
  const json = await res.json();
  const src = document.getElementById("rankings-source");
  const periodLabel =
    rankingsPeriod === "day" ? "jour" : rankingsPeriod === "week" ? "semaine" : "mois";
  if (src) {
    src.innerHTML = json.live
      ? `<span class="inline-flex items-center gap-1.5"><span class="text-[10px] font-semibold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Live</span> ${escapeHtml(
          json.source || "eBay"
        )} · ${periodLabel}${json.cached ? " · cache" : ""}</span>`
      : "Fallback local (ajoutez EBAY_PROD_CLIENT_ID pour le live)";
  }
  const algoEl = document.getElementById("rankings-algo");
  if (algoEl && json.algo) algoEl.textContent = "Algo : " + json.algo;
  const list = document.getElementById("rankings-list");
  list.innerHTML = (json.data || [])
    .map((p, i) => {
      const rank = p.rank || i + 1;
      const rawSold = Number(p.sold) || 0;
      const soldLabel =
        rawSold > 0
          ? `${rawSold} vendus${p.soldEstimated ? " (estim.)" : ""}`
          : "Ventes n/a";
      const price = Number(p.price || 0);
      const was = Number(p.wasPrice) > price ? Number(p.wasPrice) : null;
      const ca = p.ca != null ? Number(p.ca) : Math.round(price * rawSold);
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
          <p class="text-sm text-emerald-600 font-medium">${soldLabel}</p>
          <p class="text-sm font-semibold">${price > 0 ? price.toFixed(2) + " €" : "—"}</p>
          ${was ? `<p class="text-xs text-zinc-400 line-through">${was.toFixed(2)} €</p>` : ""}
          <p class="text-[11px] text-zinc-400">CA ${ca > 0 ? formatCaShort(ca) : "—"}</p>
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

function setSnipeProgress(pct, label, detail = "") {
  const bar = document.getElementById("snipe-progress-bar");
  const pctEl = document.getElementById("snipe-progress-pct");
  const labelEl = document.getElementById("snipe-progress-label");
  const detailEl = document.getElementById("snipe-progress-detail");
  const n = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  if (bar) bar.style.width = `${n}%`;
  if (pctEl) pctEl.textContent = `${n}%`;
  if (labelEl && label) labelEl.textContent = label;
  if (detailEl && detail) detailEl.textContent = detail;
  const step =
    n >= 100 ? "done" : n >= 70 ? "price" : n >= 35 ? "source" : n >= 10 ? "scan" : null;
  document.querySelectorAll("#snipe-progress-steps [data-step]").forEach((el) => {
    const key = el.getAttribute("data-step");
    el.classList.remove("is-active", "is-done");
    if (!step) return;
    const order = ["scan", "source", "price", "done"];
    const cur = order.indexOf(step);
    const mine = order.indexOf(key);
    if (mine < cur) el.classList.add("is-done");
    else if (mine === cur) el.classList.add("is-active");
  });
}

async function runSnipe() {
  const btn = document.getElementById("snipe-btn");
  const candWrap = document.getElementById("snipe-candidates");
  const candList = document.getElementById("snipe-candidates-list");
  btn.disabled = true;
  if (candWrap) candWrap.classList.add("hidden");
  if (candList) candList.innerHTML = "";
  window.__snipeCandidates = [];
  document.getElementById("stat-scanned").textContent = "0";
  document.getElementById("stat-imported").textContent = "0";
  const errEl = document.getElementById("stat-errors");
  if (errEl) errEl.textContent = "0";
  const listedEl = document.getElementById("stat-listed");
  if (listedEl) listedEl.textContent = "0";
  setSnipeProgress(2, "Démarrage…", "Initialisation Auto-Snipe");

  const body = {
    query: document.getElementById("snipe-query")?.value || "gadgets",
    count: 1,
    marketplace: document.getElementById("snipe-market").value,
    ticket: "all",
    source: document.getElementById("snipe-source").value,
    autoList: false,
    testMode: false,
  };

  const renderCandidates = (items, replace = false) => {
    if (!candList || !Array.isArray(items) || !items.length) return;
    const seen = new Set();
    const base = replace ? [] : window.__snipeCandidates || [];
    const uniq = [];
    for (const c of [...base, ...items]) {
      const u = String(c.url || "");
      if (!u || seen.has(u)) continue;
      seen.add(u);
      uniq.push(c);
    }
    window.__snipeCandidates = uniq.slice(0, 3);
    if (candWrap) candWrap.classList.remove("hidden");
    candList.innerHTML = window.__snipeCandidates
      .map((c, idx) => {
        const src = escapeHtml(c.source || "fournisseur");
        const title = escapeHtml(c.title || "Produit");
        const url = escapeHtml(c.url || "#");
        const price =
          c.price != null && Number(c.price) > 0
            ? `${Number(c.price).toFixed(2)} €`
            : "prix n/a";
        const safeUrl = String(c.url || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        return `<div class="rounded-xl border border-[#d4d4f0] bg-[#f8f8ff] px-3 py-2.5">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[10px] font-semibold uppercase tracking-wide text-[#4452a8]">#${idx + 1} · ${src}</span>
            <span class="text-sm font-semibold text-ink-900">${escapeHtml(price)}</span>
          </div>
          <p class="text-sm font-medium mt-1">${title}</p>
          <a href="${url}" target="_blank" rel="noopener" class="text-[11px] text-[#6d7ddf] mt-0.5 block truncate underline">${url}</a>
          <button type="button" onclick="importSnipeOffer('${safeUrl}', this)" class="mt-2 text-xs btn-primary px-3 py-1.5">Importer dans Mes Listings</button>
        </div>`;
      })
      .join("");
  };

  const applyProgressFromLog = (msg) => {
    const m = String(msg || "");
    if (/\[INIT\]/i.test(m)) setSnipeProgress(8, "Initialisation", m.replace(/^\[[^\]]+\]\s*/, ""));
    else if (/\[CONFIG\]|\[PROTECT\]|\[RULE\]/i.test(m)) setSnipeProgress(14, "Préparation", m.replace(/^\[[^\]]+\]\s*/, ""));
    else if (/\[SCAN\]/i.test(m)) setSnipeProgress(22, "Scan demande eBay", m.replace(/^\[[^\]]+\]\s*/, ""));
    else if (/\[TARGET\]|\[VERO\]|\[HAZMAT\]/i.test(m)) setSnipeProgress(32, "Ciblage mot-clé", m.replace(/^\[[^\]]+\]\s*/, ""));
    else if (/\[SOURCE\]/i.test(m)) setSnipeProgress(42, "Comparaison sources", m.replace(/^\[[^\]]+\]\s*/, ""));
    else if (/\[amazon\]/i.test(m)) setSnipeProgress(52, "Recherche Amazon", m.replace(/^\[[^\]]+\]\s*/, ""));
    else if (/\[aliexpress\]/i.test(m)) setSnipeProgress(62, "Recherche AliExpress", m.replace(/^\[[^\]]+\]\s*/, ""));
    else if (/\[cdiscount\]/i.test(m)) setSnipeProgress(72, "Recherche Cdiscount", m.replace(/^\[[^\]]+\]\s*/, ""));
    else if (/\[LINK\]/i.test(m)) setSnipeProgress(88, "Classement des offres", m.replace(/^\[[^\]]+\]\s*/, ""));
    else if (/\[BEST\]/i.test(m)) setSnipeProgress(94, "Sélection des 3 meilleures", m.replace(/^\[[^\]]+\]\s*/, ""));
    else if (/\[ERROR\]/i.test(m)) setSnipeProgress(100, "Erreur", m.replace(/^\[[^\]]+\]\s*/, ""));
    else if (/\[DONE\]/i.test(m)) setSnipeProgress(100, "Terminé", m.replace(/^\[[^\]]+\]\s*/, ""));
  };

  try {
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
          if (ev.type === "progress") {
            setSnipeProgress(ev.pct, ev.label || "Calcul…", ev.detail || "");
          }
          if (ev.type === "log") {
            applyProgressFromLog(ev.message);
          }
          if (ev.type === "candidates" && Array.isArray(ev.items)) {
            renderCandidates(ev.items, true);
            setSnipeProgress(96, "Offres prêtes", `${ev.items.length} fiche(s) proposée(s)`);
          }
          if (ev.type === "stats" || ev.type === "done") {
            document.getElementById("stat-scanned").textContent = ev.scanned || ev.offers || 0;
            document.getElementById("stat-imported").textContent =
              ev.offers || (window.__snipeCandidates || []).length || 0;
            if (errEl) errEl.textContent = ev.errors || 0;
          }
          if (ev.type === "done") {
            const n = (window.__snipeCandidates || []).length;
            setSnipeProgress(
              100,
              n ? "Terminé" : "Aucune offre",
              n ? `${n} offre(s) à importer` : "Réessaie avec un autre mot-clé"
            );
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    setSnipeProgress(100, "Erreur réseau", err.message || "Échec Auto-Snipe");
  }
  btn.disabled = false;
}

async function importSnipeOffer(url, btn) {
  if (!url) return;
  const orig = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Import…";
  }
  try {
    const res = await fetch(API + "/api/generate-listing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productUrl: url, themeColor: "#6d7ddf", language: "fr" }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Import échoué");
    if (btn) btn.textContent = "Importé ✓";
    alert("Importé dans Mes Listings" + (json.data?.id ? ` (id ${json.data.id})` : "") + ".");
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = orig || "Importer";
    }
    alert(err.message);
  }
}

function formatPublishDate(value) {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return escapeHtml(String(value));
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function setAutoPublishProgress(pct, label, detail) {
  const bar = document.getElementById("ap-progress-bar");
  const pctEl = document.getElementById("ap-progress-pct");
  const lab = document.getElementById("ap-progress-label");
  const det = document.getElementById("ap-progress-detail");
  if (pct != null && Number.isFinite(Number(pct))) {
    const n = Math.max(0, Math.min(100, Number(pct)));
    if (bar) bar.style.width = n + "%";
    if (pctEl) pctEl.textContent = Math.round(n) + "%";
  }
  if (lab && label) lab.textContent = label;
  if (det && detail != null) det.textContent = detail;
}

function renderAutoPublishHistory(published) {
  const body = document.getElementById("auto-publish-history");
  if (!body) return;
  const rows = Array.isArray(published) ? published : [];
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="4" class="p-6 text-sm text-zinc-400 text-center">Aucun produit publié pour l’instant.</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((item) => {
      const title = escapeHtml(item.seo_title || item.title || "Produit");
      const price = Number(item.suggested_price || item.sell_price || item.price || 0);
      const priceTxt = price > 0 ? `${price.toFixed(2)} €` : "—";
      const date = formatPublishDate(item.published_at || item.date);
      const ebayId = String(item.ebay_listing_id || item.ebayListingId || "");
      const link = ebayId
        ? `<a class="text-[#6d7ddf] underline" target="_blank" rel="noopener" href="https://www.ebay.fr/itm/${escapeHtml(
            ebayId
          )}">#${escapeHtml(ebayId)}</a>`
        : "—";
      return `<tr class="border-b border-zinc-50">
        <td class="p-3 whitespace-nowrap text-zinc-500">${date}</td>
        <td class="p-3 font-medium">${title}</td>
        <td class="p-3 text-brand-600 font-semibold">${priceTxt}</td>
        <td class="p-3">${link}</td>
      </tr>`;
    })
    .join("");
}

function renderAutoPublishLog(log) {
  const body = document.getElementById("auto-publish-log");
  if (!body) return;
  const rows = Array.isArray(log) ? log : [];
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5" class="p-6 text-sm text-zinc-400 text-center">Aucune activité pipeline pour l’instant.</td></tr>`;
    return;
  }
  const badge = (status) => {
    const s = String(status || "");
    if (s === "published") return `<span class="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg text-xs">publié</span>`;
    if (s === "prepared") return `<span class="text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-lg text-xs">en file</span>`;
    if (s === "skipped") return `<span class="text-amber-700 bg-amber-50 px-2 py-0.5 rounded-lg text-xs">ignoré</span>`;
    return `<span class="text-red-700 bg-red-50 px-2 py-0.5 rounded-lg text-xs">erreur</span>`;
  };
  body.innerHTML = rows
    .slice(0, 80)
    .map((item) => {
      const title = escapeHtml(item.seo_title || "—");
      const price = Number(item.sell_price || 0);
      const priceTxt = price > 0 ? `${price.toFixed(2)} €` : "—";
      const net = item.net_pct != null && item.net_pct !== "" ? `${Number(item.net_pct).toFixed(1)} %` : "—";
      const date = formatPublishDate(item.published_at);
      const detail = escapeHtml(item.detail || "");
      return `<tr class="border-b border-zinc-50">
        <td class="p-3 whitespace-nowrap text-zinc-500">${date}</td>
        <td class="p-3">${badge(item.status)}</td>
        <td class="p-3 font-medium">${title}${detail ? `<div class="text-[11px] text-zinc-400 font-normal mt-0.5">${detail}</div>` : ""}</td>
        <td class="p-3 text-brand-600 font-semibold">${priceTxt}</td>
        <td class="p-3 text-zinc-500">${net}</td>
      </tr>`;
    })
    .join("");
}

let autoPublishPollTimer = null;
function stopAutoPublishPoll() {
  if (autoPublishPollTimer) {
    clearInterval(autoPublishPollTimer);
    autoPublishPollTimer = null;
  }
}
function startAutoPublishPoll() {
  stopAutoPublishPoll();
  autoPublishPollTimer = setInterval(() => {
    if (document.getElementById("page-auto-publish")?.classList.contains("active")) {
      loadAutoPublishHistory();
    }
  }, 20000);
}

async function loadAutoPublishHistory() {
  try {
    const res = await fetch(API + "/api/auto-publish/history");
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Historique indisponible");
    const data = json.data || {};
    const enabled = document.getElementById("auto-publish-enabled");
    if (enabled) enabled.checked = Boolean(data.enabled);
    const market = document.getElementById("auto-publish-market");
    if (market && data.marketplace) market.value = data.marketplace;
    const published = data.published || [];
    const pipe = data.pipeline || {};
    const pubEl = document.getElementById("ap-stat-published");
    if (pubEl) pubEl.textContent = String(pipe.publishedToday || published.length || 0);
    const queuedEl = document.getElementById("ap-stat-queued");
    if (queuedEl) queuedEl.textContent = String(pipe.queued || 0);
    const prepEl = document.getElementById("ap-stat-prepared");
    if (prepEl) prepEl.textContent = String(pipe.preparedToday || 0);
    const meta = document.getElementById("ap-pipeline-meta");
    if (meta) {
      const kws = (pipe.keywords || []).slice(0, 6).map((k) => k.query || k).filter(Boolean);
      const tick = pipe.lastTickAt ? formatPublishDate(pipe.lastTickAt) : "jamais";
      const sched = data.scheduler || {};
      const next = sched.nextFireAt ? formatPublishDate(sched.nextFireAt) : null;
      const intervalMin = data.intervalMin || 10;
      meta.textContent =
        (data.enabled ? "Automatisation ON · " : "Automatisation OFF — coche le toggle pour publier toutes les 10 min · ") +
        `cycle toutes les ${intervalMin} min` +
        (next && data.enabled ? ` · prochain ~ ${next}` : "") +
        (sched.fireCount != null ? ` · ticks ${sched.fireCount}` : "") +
        (sched.attemptCount != null ? `/${sched.attemptCount}` : "") +
        (sched.busy ? " · en cours…" : "") +
        ` · dernier cycle ${tick}` +
        (pipe.lastQuery ? ` · « ${pipe.lastQuery} »` : "") +
        (pipe.lastPhase ? ` · phase ${pipe.lastPhase}` : "") +
        (kws.length ? ` · demande : ${kws.join(", ")}` : "") +
        ` · ignorés/jour ${pipe.skippedToday || 0}` +
        " · Auto-Order n’impacte pas cette page";
      meta.className = data.enabled
        ? "text-xs text-zinc-500 rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3"
        : "text-xs text-amber-800 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3";
    }
    renderAutoPublishHistory(published);
    renderAutoPublishLog(data.log || []);
  } catch (err) {
    const body = document.getElementById("auto-publish-history");
    if (body) {
      body.innerHTML = `<tr><td colspan="4" class="p-6 text-sm text-red-600 text-center">${escapeHtml(
        err.message
      )}</td></tr>`;
    }
  }
}

async function saveAutoPublishSettings() {
  const enabled = Boolean(document.getElementById("auto-publish-enabled")?.checked);
  const marketplace = document.getElementById("auto-publish-market")?.value || "France";
  try {
    await fetch(API + "/api/auto-publish/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, marketplace }),
    });
    await loadAutoPublishHistory();
  } catch (err) {
    console.warn("[EBX] auto-publish settings:", err.message);
  }
}

async function runAutoPublish() {
  const btn = document.getElementById("auto-publish-btn");
  if (btn) btn.disabled = true;
  setAutoPublishProgress(4, "Démarrage…", "Publication du lot prêt, puis préparation du suivant");
  const marketplace = document.getElementById("auto-publish-market")?.value || "France";
  await saveAutoPublishSettings();
  try {
    const res = await fetch(API + "/api/auto-publish/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketplace, limit: 5 }),
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
          if (ev.type === "progress") {
            setAutoPublishProgress(ev.pct, ev.label || "Publication…", ev.detail || "");
          }
          if (ev.type === "log") {
            const m = String(ev.message || "");
            if (/\[INIT\]/i.test(m)) setAutoPublishProgress(8, "Initialisation", m.replace(/^\[[^\]]+\]\s*/, ""));
            else if (/\[DEMAND\]/i.test(m)) setAutoPublishProgress(20, "Demande eBay", m.replace(/^\[[^\]]+\]\s*/, ""));
            else if (/\[PREPARE\]/i.test(m)) setAutoPublishProgress(60, "Préparation fiches", m.replace(/^\[[^\]]+\]\s*/, ""));
            else if (/\[PUBLISH\]/i.test(m)) setAutoPublishProgress(40, "Publication", m.replace(/^\[[^\]]+\]\s*/, ""));
            else if (/\[PRICE\]/i.test(m)) setAutoPublishProgress(null, "Comparaison eBay", m.replace(/^\[[^\]]+\]\s*/, ""));
            else if (/\[OK\]/i.test(m)) setAutoPublishProgress(null, "Publié", m.replace(/^\[[^\]]+\]\s*/, ""));
            else if (/\[SKIP\]/i.test(m)) setAutoPublishProgress(null, "Ignoré", m.replace(/^\[[^\]]+\]\s*/, ""));
            else if (/\[DONE\]/i.test(m)) setAutoPublishProgress(100, "Terminé", m.replace(/^\[[^\]]+\]\s*/, ""));
            else if (/\[ERROR\]/i.test(m)) setAutoPublishProgress(null, "Erreur", m.replace(/^\[[^\]]+\]\s*/, ""));
          }
          if (ev.type === "stats" || ev.type === "done") {
            if (ev.published != null) {
              const el = document.getElementById("ap-stat-published");
              if (el) el.textContent = ev.published;
            }
            if (ev.prepared != null) {
              const el = document.getElementById("ap-stat-prepared");
              if (el) el.textContent = ev.prepared;
            }
          }
          if (ev.type === "done") {
            setAutoPublishProgress(
              100,
              "Cycle terminé",
              `${ev.published || 0} publié(s) · ${ev.prepared || 0} préparé(s) · ${ev.skipped || 0} ignoré(s)`
            );
          }
        } catch (_) {}
      }
    }
    await loadAutoPublishHistory();
  } catch (err) {
    setAutoPublishProgress(100, "Erreur réseau", err.message || "Échec Auto-Publish");
  }
  if (btn) btn.disabled = false;
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
  const allBtn = document.getElementById("orders-select-all");
  if (allBtn) allBtn.checked = false;
  updateOrdersBulkBar();
  document.getElementById("orders-body").innerHTML = (json.data || [])
    .map((o) => {
      const id = String(o.id).replace(/'/g, "\\'");
      const safeId = escapeHtml(String(o.id));
      return `<tr class="border-b border-zinc-50 align-top" data-order-id="${safeId}">
          <td class="p-3"><input type="checkbox" class="order-check rounded border-zinc-300" value="${safeId}" onchange="updateOrdersBulkBar()" /></td>
          <td class="p-3 font-mono text-[11px]">${safeId}${
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
            <button onclick="deleteOrder('${id}')" class="block text-xs text-red-600 px-2 py-1">Supprimer</button>
          </td>
        </tr>`;
    })
    .join("") || `<tr><td colspan="7" class="p-8 text-center text-zinc-300">Aucune commande — clique « Sync ventes eBay ».</td></tr>`;
  await markNotificationsRead({ types: ["sale"] });
}

function selectedOrderIds() {
  return [...document.querySelectorAll(".order-check:checked")].map((el) => el.value);
}

function updateOrdersBulkBar() {
  const n = selectedOrderIds().length;
  const btn = document.getElementById("orders-bulk-delete");
  if (!btn) return;
  btn.classList.toggle("hidden", n === 0);
  btn.textContent = n <= 1 ? "Supprimer la sélection" : `Supprimer (${n})`;
  const all = document.querySelectorAll(".order-check");
  const allBtn = document.getElementById("orders-select-all");
  if (allBtn && all.length) {
    allBtn.checked = n === all.length;
    allBtn.indeterminate = n > 0 && n < all.length;
  }
}

function toggleSelectAllOrders(checked) {
  document.querySelectorAll(".order-check").forEach((el) => {
    el.checked = checked;
  });
  updateOrdersBulkBar();
}

async function deleteOrder(id) {
  if (!confirm("Supprimer cette commande de la liste EBX ?")) return;
  try {
    const res = await fetch(API + "/api/auto-orders/" + encodeURIComponent(id), { method: "DELETE" });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    loadOrders();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteSelectedOrders() {
  const ids = selectedOrderIds();
  if (!ids.length) return;
  if (!confirm(`Supprimer ${ids.length} commande(s) de la liste EBX ?`)) return;
  try {
    const res = await fetch(API + "/api/auto-orders/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    loadOrders();
  } catch (err) {
    alert(err.message);
  }
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

async function loadListings(force = false) {
  const btn = document.getElementById("listings-refresh-btn");
  const tbody = document.getElementById("listings-body");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "…";
  }
  if (tbody && (force || !tbody.children.length)) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-zinc-400">Chargement…</td></tr>`;
  }

  const listingsPromise = fetch(API + "/api/listings").then((r) => r.json());
  const setupPromise = fetch(API + "/api/setup")
    .then((r) => r.json())
    .catch(() => null);

  let json;
  try {
    json = await listingsPromise;
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-500">${escapeHtml(err.message)}</td></tr>`;
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Rafraîchir";
    }
    return;
  }

  const rows = json.data || [];
  let ebayEnv = window.__ebxPublishEnv || "sandbox";

  const renderRows = () => {
    const allBtn = document.getElementById("listings-select-all");
    if (allBtn) allBtn.checked = false;
    updateListingsBulkBar();
    if (!tbody) return;
    tbody.innerHTML = rows.length
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
            let varAspect = "";
            let varValues = [];
            try {
              const vj = item.variations_json ? JSON.parse(item.variations_json) : null;
              if (vj?.aspect) varAspect = vj.aspect;
              if (Array.isArray(vj?.values)) varValues = vj.values;
            } catch (_) {}
            const variationsOk =
              Boolean(item.variations_active) ||
              (Boolean(item.ebay_listing_id) && varValues.length >= 2);
            const varianteBadge = item.ebay_listing_id
              ? variationsOk
                ? `<span class="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 font-semibold" title="Variations activées">Variante OK</span>`
                : `<span class="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-800 font-medium" title="Republie pour activer les variantes">Variante inactive</span>`
              : `<span class="inline-flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-zinc-50 text-zinc-400 font-medium">Variante à activer</span>`;
            return `
      <tr class="border-b border-zinc-50" data-listing-id="${item.id}">
        <td class="p-3"><input type="checkbox" class="listing-check rounded border-zinc-300" value="${item.id}" onchange="updateListingsBulkBar()" /></td>
        <td class="p-3 text-xs text-zinc-400">${new Date(item.created_at).toLocaleString("fr-FR")}</td>
        <td class="p-3 font-medium">${escapeHtml(item.seo_title || "—")}${published}${imgWarn}</td>
        <td class="p-3 text-brand-600 font-semibold">${item.suggested_price ? item.suggested_price.toFixed(2) + " €" : "—"}</td>
        <td class="p-3 text-right space-x-2 whitespace-nowrap">
          <button onclick="viewListing(${item.id})" class="text-xs bg-brand-50 text-brand-600 px-3 py-1.5 rounded-lg">Modifier</button>
          <button onclick="publishListing(${item.id}, this)" class="text-xs bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg">${
            item.ebay_listing_id ? "Republier" : "Publier eBay"
          }</button>
          ${varianteBadge}
          ${
            item.ebay_offer_id
              ? `<button onclick="endListingEbay(${item.id}, this)" class="text-xs bg-amber-50 text-amber-700 px-3 py-1.5 rounded-lg">Fin eBay</button>`
              : ""
          }
        </td>
      </tr>`;
          })
          .join("")
      : `<tr><td colspan="5" class="p-8 text-center text-zinc-300">Aucun listing.</td></tr>`;
  };

  renderRows();
  if (btn) {
    btn.disabled = false;
    btn.textContent = "Rafraîchir";
  }

  setupPromise.then((setup) => {
    if (!setup) return;
    const d = setup.data || setup;
    ebayEnv = d.ebayEnv || ebayEnv;
    window.__ebxPublishEnv = ebayEnv;
    const hint = document.getElementById("listings-publish-hint");
    if (!hint) return;
    const seller = d.seller?.userId
      ? ` Compte OAuth : ${d.seller.userId}.`
      : d.seller?.error
        ? ` (OAuth: ${d.seller.error})`
        : "";
    if (ebayEnv === "production") {
      if (!d.policiesProd || !d.refreshTokenProd) {
        hint.classList.remove("hidden");
        hint.className = "px-5 py-3 text-xs bg-amber-50 text-amber-900 border-b border-amber-100";
        hint.textContent =
          "Mode PRODUCTION incomplet : OAuth + policies Prod requis." + seller;
      } else {
        hint.classList.remove("hidden");
        hint.className = "px-5 py-3 text-xs bg-emerald-50 text-emerald-800 border-b border-emerald-100";
        hint.textContent = "Mode PRODUCTION — publications sur ton vrai compte eBay." + seller;
      }
    } else {
      hint.classList.remove("hidden");
      hint.className =
        "px-5 py-3 text-xs bg-amber-50 text-amber-900 border-b border-amber-100 font-medium";
      hint.textContent =
        "Mode SANDBOX — les annonces vont sur le compte TEST. Pour le réel : EBAY_ENV=production." +
        seller;
    }
  });
}

function selectedListingIds() {
  return [...document.querySelectorAll(".listing-check:checked")].map((el) => Number(el.value));
}

function updateListingsBulkBar() {
  const n = selectedListingIds().length;
  const btn = document.getElementById("listings-bulk-delete");
  if (!btn) return;
  btn.classList.toggle("hidden", n === 0);
  btn.textContent = n <= 1 ? "Supprimer la sélection" : `Supprimer (${n})`;
  const all = document.querySelectorAll(".listing-check");
  const allBtn = document.getElementById("listings-select-all");
  if (allBtn && all.length) {
    allBtn.checked = n === all.length;
    allBtn.indeterminate = n > 0 && n < all.length;
  }
}

function toggleSelectAllListings(checked) {
  document.querySelectorAll(".listing-check").forEach((el) => {
    el.checked = checked;
  });
  updateListingsBulkBar();
}

async function deleteSelectedListings() {
  const ids = selectedListingIds();
  if (!ids.length) return;
  if (!confirm(`Supprimer ${ids.length} listing(s) de EBX ?`)) return;
  try {
    const res = await fetch(API + "/api/listings/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    loadListings();
  } catch (err) {
    alert(err.message);
  }
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
    if (json.sellerUserId) msg += `\nCompte: ${json.sellerUserId} (${json.ebayEnv || "production"})`;
    if (json.autoProcessed) msg += `\nBot: ${json.autoProcessed} commande(s) préparée(s) auto.`;
    if (json.note) msg += `\n\n${json.note}`;
    alert(msg);
    loadOrders();
    refreshBotStatus();
    refreshNotifications(true);
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
  const order = ["scan", "extract", "ai", "save"];
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
  const language = document.getElementById("manual-language")?.value || "fr";
  const langLabels = { fr: "Français", en: "Anglais", de: "Allemand" };
  const btn = document.getElementById("manual-btn");
  const wrap = document.getElementById("manual-progress");
  const list = document.getElementById("manual-checklist");
  const bar = document.getElementById("manual-bar");
  const pct = document.getElementById("manual-pct");
  const label = document.getElementById("manual-status-label");
  const ready = document.getElementById("manual-ready");
  const saveBtn = document.getElementById("manual-save-btn");
  btn.disabled = true;
  wrap.classList.remove("hidden");
  ready.classList.add("hidden");
  if (saveBtn) saveBtn.classList.add("hidden");
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
    addCheck(`Langue de l'annonce : ${langLabels[language] || language}`);
    await new Promise((r) => setTimeout(r, 300));
    addCheck(`Plateforme détectée : ${/amazon/i.test(url) ? "Amazon" : /cdiscount/i.test(url) ? "Cdiscount" : "AliExpress"}`);

    label.textContent = "Extraction…";
    bar.style.width = "45%";
    pct.textContent = "45%";
    setManualStep("extract");
    const res = await fetch(API + "/api/generate-listing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productUrl: url, themeColor, language }),
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
    const usedLang = json.data?.language_label || langLabels[json.data?.language] || langLabels[language];
    addCheck(
      json.data?.title_rewritten
        ? "Titre réécrit (discret) — différent du fournisseur"
        : "Titre optimisé"
    );
    addCheck(`Titre eBay : ${title.length} caractères`);
    addCheck(`Description HTML générée (${usedLang})`);
    addCheck(`Prix de vente suggéré : ${price.toFixed(2)} €`);
    const costGuess = price / 1.8;
    const marginEst = price > 0 ? Math.round(((price - costGuess) / price) * 100) : 0;
    addCheck(`Marge estimée : ${marginEst}%`);
    addCheck("Enregistré dans Mes Listings (brouillon)");

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

    bar.style.width = "100%";
    pct.textContent = "100%";
    setManualStep("save");
    label.textContent = `Importé — ${price.toFixed(2)} €`;
    ready.classList.remove("hidden");
    ready.textContent = `Listing #${manualListingId || "?"} prêt dans Mes Listings — ${usedLang} — ${price.toFixed(2)} € (non publié sur eBay)`;
    if (saveBtn) saveBtn.classList.remove("hidden");
  } catch (err) {
    label.textContent = "Erreur";
    alert(err.message);
  } finally {
    btn.disabled = false;
  }
}

/** Sauvegarde le titre édité puis ouvre Mes Listings (pas de publish eBay). */
async function saveManualListing() {
  if (!manualListingId) return alert("Importe d'abord un produit");
  const saveBtn = document.getElementById("manual-save-btn");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Enregistrement…";
  }
  try {
    const seoEl = document.getElementById("manual-seo-title");
    if (seoEl?.value.trim()) {
      const res = await fetch(API + "/api/listings/" + manualListingId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seo_title: seoEl.value.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
    }
    setManualStep("save");
    document.getElementById("manual-status-label").textContent = "Dans Mes Listings";
    document.getElementById("manual-bar").style.width = "100%";
    document.getElementById("manual-pct").textContent = "100%";
    navigate("listings");
  } catch (err) {
    alert(err.message || "Impossible d'enregistrer le listing");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Enregistrer dans Mes Listings";
    }
  }
}

/** @deprecated — publication eBay uniquement depuis Mes Listings */
async function publishManualListing() {
  alert("La publication eBay se fait depuis Mes Listings (bouton Publier), pas depuis l'Import Manuel.");
  navigate("listings");
}

function countRealImagesHint(html) {
  const m = String(html || "").match(/<img\b/gi);
  return m ? m.length : 0;
}

let savSelectedId = null;
let savCache = [];
let notifCache = null;
let notifPollTimer = null;
let notifLastTotal = null;

function formatNotifWhen(raw) {
  if (!raw) return "";
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return String(raw).slice(0, 16);
  const ageH = Math.round((Date.now() - dt.getTime()) / 3600000);
  if (ageH < 1) return "à l'instant";
  if (ageH < 48) return `il y a ${ageH}h`;
  return `il y a ${Math.round(ageH / 24)}j`;
}

function setNavCount(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  const n = Number(count) || 0;
  el.textContent = n > 99 ? "99+" : String(n);
  el.classList.toggle("is-on", n > 0);
  el.setAttribute("aria-hidden", n > 0 ? "false" : "true");
}

function applyNotificationBadges(data) {
  const messages = Number(data?.messages?.unread ?? data?.messages?.open ?? 0);
  const sales = Number(data?.sales?.unread ?? data?.sales?.pending ?? 0);
  const total = Number(data?.total || messages + sales);
  setNavCount("nav-badge-sav", total);
  const dot = document.getElementById("notif-bell-dot");
  if (dot) {
    dot.textContent = total > 99 ? "99+" : String(total);
    dot.classList.toggle("is-on", total > 0);
  }
  const summary = document.getElementById("notif-summary");
  if (summary) {
    if (total === 0) summary.textContent = "Rien de nouveau";
    else {
      const parts = [];
      if (messages) parts.push(`${messages} message${messages > 1 ? "s" : ""}`);
      if (sales) parts.push(`${sales} vente${sales > 1 ? "s" : ""}`);
      summary.textContent = parts.join(" · ") + " non lu" + (total > 1 ? "s" : "");
    }
  }
  const list = document.getElementById("notif-list");
  if (list) {
    const items = data?.items || [];
    list.innerHTML = items.length
      ? items
          .map((it) => {
            const kind = it.type === "sale" ? "Vente" : "Message";
            const kindCls =
              it.type === "sale"
                ? "bg-emerald-50 text-emerald-700"
                : it.status === "escalated"
                  ? "bg-amber-50 text-amber-800"
                  : "bg-[#eef0fb] text-[#4452a8]";
            const key = escapeHtml(it.key || `${it.type}:${it.id}`);
            const page = escapeHtml(it.page === "auto-order" ? "settings" : it.page || "sav");
            return `<button type="button" class="notif-item w-full text-left px-4 py-3" data-notif-key="${key}" onclick="openNotificationItem('${key}', '${page}')">
              <div class="flex items-center justify-between gap-2">
                <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${kindCls}">${kind}</span>
                <span class="text-[10px] text-zinc-400">${escapeHtml(formatNotifWhen(it.at))}</span>
              </div>
              <p class="text-sm font-medium mt-1 truncate">${escapeHtml(it.title)}</p>
              <p class="text-[11px] text-zinc-400 mt-0.5 truncate">${escapeHtml(it.detail)}</p>
            </button>`;
          })
          .join("")
      : `<p class="px-4 py-8 text-sm text-zinc-400 text-center">Aucune notification non lue.</p>`;
  }
}

async function markNotificationsRead(opts = {}) {
  try {
    const res = await fetch(API + "/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Impossible de marquer comme lu");
    notifCache = json.data || {};
    notifLastTotal = Number(notifCache.total || 0);
    applyNotificationBadges(notifCache);
    return notifCache;
  } catch (err) {
    console.warn("[EBX] mark read:", err.message);
    return null;
  }
}

async function openNotificationItem(key, page) {
  await markNotificationsRead({ keys: [key] });
  toggleNotificationsPanel(false);
  if (page === "settings" || page === "auto-order") navigate("settings", { scrollTo: "auto-order" });
  else navigate(page || "sav");
}

async function markAllNotificationsRead() {
  await markNotificationsRead({ all: true });
}

async function refreshNotifications(force = false) {
  try {
    if (force === true || !window.__ebxLastSavSync || Date.now() - window.__ebxLastSavSync > 60000) {
      try {
        await fetch(API + "/api/sav/sync", { method: "POST" });
        window.__ebxLastSavSync = Date.now();
      } catch (_) {}
    }
    const res = await fetch(API + "/api/notifications");
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Notifications indisponibles");
    const data = json.data || {};
    const total = Number(data.total || 0);
    if (
      force !== true &&
      notifLastTotal != null &&
      total > notifLastTotal &&
      document.getElementById("page-sav") &&
      !document.getElementById("page-sav").classList.contains("active")
    ) {
      const delta = total - notifLastTotal;
      const bot = document.getElementById("bot-status");
      if (bot) {
        bot.textContent = `+${delta} notif.`;
        bot.classList.add("ring-2", "ring-red-300");
        setTimeout(() => bot.classList.remove("ring-2", "ring-red-300"), 4000);
      }
    }
    notifLastTotal = total;
    notifCache = data;
    applyNotificationBadges(data);
    return data;
  } catch (err) {
    console.warn("[EBX] notifications:", err.message);
    return null;
  }
}

async function toggleNotificationsPanel(force) {
  const panel = document.getElementById("notif-panel");
  if (!panel) return;
  const open = typeof force === "boolean" ? force : panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !open);
  if (open) {
    const data = await refreshNotifications(true);
    const snapshot = [...(data?.items || [])];
    if ((data?.total || 0) > 0) {
      // Badge disparaît dès la consultation ; on garde la liste affichée pour cette ouverture
      await markNotificationsRead({ all: true });
      if (snapshot.length) {
        const list = document.getElementById("notif-list");
        const summary = document.getElementById("notif-summary");
        if (summary) summary.textContent = "Consulté — badge effacé";
        if (list) {
          list.innerHTML = snapshot
            .map((it) => {
              const kind = it.type === "sale" ? "Vente" : "Message";
              const kindCls =
                it.type === "sale"
                  ? "bg-emerald-50 text-emerald-700"
                  : it.status === "escalated"
                    ? "bg-amber-50 text-amber-800"
                    : "bg-[#eef0fb] text-[#4452a8]";
              const key = escapeHtml(it.key || `${it.type}:${it.id}`);
              const page = escapeHtml(it.page || "sav");
              return `<button type="button" class="notif-item w-full text-left px-4 py-3" data-notif-key="${key}" onclick="openNotificationItem('${key}', '${page}')">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${kindCls}">${kind}</span>
                  <span class="text-[10px] text-zinc-400">${escapeHtml(formatNotifWhen(it.at))}</span>
                </div>
                <p class="text-sm font-medium mt-1 truncate">${escapeHtml(it.title)}</p>
                <p class="text-[11px] text-zinc-400 mt-0.5 truncate">${escapeHtml(it.detail)}</p>
              </button>`;
            })
            .join("");
        }
      }
    }
  }
}

function navigateFromNotif(page) {
  toggleNotificationsPanel(false);
  if (page === "settings" || page === "auto-order") navigate("settings", { scrollTo: "auto-order" });
  else navigate(page);
}

function startNotificationsPolling() {
  if (notifPollTimer) clearInterval(notifPollTimer);
  refreshNotifications(true);
  notifPollTimer = setInterval(() => refreshNotifications(false), 45000);
}

document.addEventListener("click", (e) => {
  const wrap = document.getElementById("notif-wrap");
  const panel = document.getElementById("notif-panel");
  if (!wrap || !panel || panel.classList.contains("hidden")) return;
  if (!wrap.contains(e.target)) panel.classList.add("hidden");
});

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
      : `<p class="p-6 text-sm text-zinc-300 text-center">Aucun message eBay pour l’instant. Clique Sync eBay — seules les questions acheteurs et My Messages apparaissent ici (pas les e-mails marketing).</p>`;
    if (savSelectedId && savCache.some((x) => x.id === savSelectedId)) {
      selectSav(savSelectedId);
    }
    await markNotificationsRead({ types: ["message"] });
    await refreshSavStatus();
    await loadSavSales();
  } catch (err) {
    alert("SAV: " + err.message);
  }
}

async function refreshSavStatus() {
  const el = document.getElementById("sav-ebay-status");
  if (!el) return;
  try {
    const res = await fetch(API + "/api/sav/status");
    const json = await res.json();
    const d = json.data || {};
    const when = d.lastSyncAt ? formatSavDate(d.lastSyncAt) : "jamais";
    if (d.connected) {
      el.className = "text-xs rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-emerald-800";
      el.textContent =
        `API connectée · compte ${d.sellerUserId || "eBay"} · dernier sync ${when} · ` +
        `${d.inboxCount || 0} message(s) · ${d.memberCount || 0} question(s) · ${d.myMessagesCount || 0} My Messages · ${d.pendingSales || 0} vente(s) à traiter. ` +
        (d.note || "");
    } else {
      el.className = "text-xs rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800";
      el.textContent =
        `eBay non lu (${d.sellerError || "OAuth"}) · dernier sync ${when}. ` +
        "Reconnecte le compte dans Paramètres. Les e-mails marketing eBay ne sont jamais importés.";
    }
  } catch (err) {
    el.className = "text-xs rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-red-700";
    el.textContent = "Impossible de vérifier la connexion eBay : " + err.message;
  }
}

async function loadSavSales() {
  const wrap = document.getElementById("sav-sales-wrap");
  const list = document.getElementById("sav-sales-list");
  if (!wrap || !list) return;
  try {
    const res = await fetch(API + "/api/auto-orders");
    const json = await res.json();
    const pending = (json.data || []).filter((o) => {
      const r = String(o.order_ref || "");
      return r && !/^AO-/i.test(r) && !/^DEMO/i.test(r) && o.status === "pending";
    });
    if (!pending.length) {
      wrap.classList.add("hidden");
      list.innerHTML = "";
      return;
    }
    wrap.classList.remove("hidden");
    list.innerHTML = pending
      .map((o) => {
        const title = escapeHtml(o.product || "Vente eBay");
        const amt = Number(o.amount || 0).toFixed(2);
        const when = escapeHtml(formatSavDate(o.created_at));
        const ref = escapeHtml(o.order_ref || "");
        return `<button type="button" class="w-full text-left px-4 py-3 hover:bg-brand-50" onclick="navigate('settings', { scrollTo: 'auto-order' })">
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-medium truncate">${title}</p>
            <span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 bg-emerald-100 text-emerald-800">vente</span>
          </div>
          <p class="text-[11px] text-zinc-400 mt-0.5">${amt} € · ${ref} · ${when}</p>
        </button>`;
      })
      .join("");
  } catch (_) {
    wrap.classList.add("hidden");
  }
}

async function loadSavInboxPage() {
  await refreshSavStatus();
  try {
    if (!window.__ebxLastSavSync || Date.now() - window.__ebxLastSavSync > 30000) {
      await fetch(API + "/api/sav/sync", { method: "POST" });
      window.__ebxLastSavSync = Date.now();
    }
  } catch (_) {}
  await loadSav();
  await refreshNotifications(false);
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
    window.__ebxLastSavSync = Date.now();
    alert(
      (json.live ? "Sync eBay OK. " : "API messages partielle. ") +
        `${json.fetched || 0} lu(s), ${json.created || 0} nouveau(x), ${json.updated || 0} mis à jour.\n` +
        `Questions: ${json.memberCount || 0} · My Messages: ${json.myMessagesCount || 0} · Ventes: ${json.salesFetched || 0}\n` +
        (json.connected === false ? "Compte eBay non lu — reconnecte OAuth dans Paramètres.\n" : "") +
        (json.note || "") +
        "\n\nLes e-mails marketing / pub eBay ne passent pas par cette API."
    );
    await loadSav();
    await refreshNotifications(false);
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
  const oauthStatus = document.getElementById("oauth-status");
  if (!box) return;
  try {
    const res = await fetch(API + "/api/accounts", { credentials: "same-origin" });
    const json = await res.json();
    if (res.status === 401) {
      box.innerHTML = `<p class="text-zinc-400 text-xs">Aucun compte eBay lié — utilise « Connecter mon eBay ».</p>`;
      return;
    }
    const rows = json.data || [];
    const active = rows.find((a) => a.is_active) || rows[0];
    if (oauthStatus) {
      oauthStatus.textContent = active
        ? `Statut : lié à ${active.user_id || active.label} (${active.env})`
        : "Statut : non connecté — clique « Connecter mon eBay »";
    }
    const sideEbay = document.getElementById("sidebar-ebay-status");
    if (sideEbay) sideEbay.textContent = active ? `eBay : ${active.user_id || active.label}` : "eBay non lié";
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
      : `<p class="text-zinc-400 text-xs">Aucun compte eBay lié — utilise « Connecter mon eBay » ci-dessus.</p>`;
  } catch (_) {
    box.innerHTML = "";
  }
}

async function connectEbayOAuth() {
  try {
    const marketplace = document.getElementById("oauth-market")?.value || "EBAY_FR";
    const env = document.getElementById("oauth-env")?.value || "production";
    const res = await fetch(
      `${API}/api/oauth/ebay/start?marketplace=${encodeURIComponent(marketplace)}&env=${encodeURIComponent(env)}`,
      { credentials: "same-origin" }
    );
    const json = await res.json();
    if (res.status === 401 || json.authRequired) {
      alert(json.error || "OAuth indisponible pour le moment.");
      return;
    }
    if (!json.success || !json.url) throw new Error(json.error || "OAuth indisponible");
    window.location.href = json.url;
  } catch (err) {
    alert(err.message);
  }
}

function showAuthGate(_show) {
  const gate = document.getElementById("auth-gate");
  if (!gate) return;
  // Inscription / connexion désactivées pour le moment
  gate.classList.add("hidden");
  gate.classList.remove("flex");
}

function setAuthTab(mode) {
  authMode = mode === "register" ? "register" : "login";
  const loginBtn = document.getElementById("auth-tab-login");
  const regBtn = document.getElementById("auth-tab-register");
  if (loginBtn && regBtn) {
    loginBtn.className =
      "flex-1 px-3 py-1.5 rounded-md " +
      (authMode === "login" ? "bg-[#6d7ddf] text-white font-medium" : "text-zinc-500");
    regBtn.className =
      "flex-1 px-3 py-1.5 rounded-md " +
      (authMode === "register" ? "bg-[#6d7ddf] text-white font-medium" : "text-zinc-500");
  }
  const submit = document.getElementById("auth-submit");
  if (submit) submit.textContent = authMode === "register" ? "Créer mon compte" : "Se connecter";
}

async function submitAuth() {
  const email = document.getElementById("auth-email")?.value.trim();
  const password = document.getElementById("auth-password")?.value || "";
  const errEl = document.getElementById("auth-error");
  if (errEl) {
    errEl.classList.add("hidden");
    errEl.textContent = "";
  }
  try {
    const res = await fetch(API + "/api/auth/" + (authMode === "register" ? "register" : "login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Auth échouée");
    await ensureWebSession();
    showAuthGate(false);
    loadDashboard();
    loadAccounts();
  } catch (err) {
    if (errEl) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    } else alert(err.message);
  }
}

async function logoutWebUser() {
  await fetch(API + "/api/auth/logout", { method: "POST", credentials: "same-origin" });
  webUser = null;
  webEbay = null;
  showAuthGate(false);
}

async function ensureWebSession() {
  showAuthGate(false);
  try {
    const res = await fetch(API + "/api/auth/me", { credentials: "same-origin" });
    const json = await res.json();
    multiuserEnabled = json.multiuser === true;
    webUser = json.user || null;
    webEbay = json.ebay || null;
    const emailEl = document.getElementById("sidebar-user-email");
    if (emailEl) emailEl.textContent = webUser?.email || "Mon compte";
    const sideEbay = document.getElementById("sidebar-ebay-status");
    if (sideEbay) {
      sideEbay.textContent = webEbay?.userId ? `eBay : ${webEbay.userId}` : "eBay non lié";
    }
    const oauthStatus = document.getElementById("oauth-status");
    if (oauthStatus && webEbay) {
      oauthStatus.textContent = `Statut : lié à ${webEbay.userId || webEbay.label} (${webEbay.env})`;
    }
    // Auth obligatoire désactivée pour le moment
    return true;
  } catch (_) {
    return true;
  }
}

async function addEbayAccount() {
  alert("Utilise « Connecter mon eBay » (OAuth) pour lier un compte.");
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
  const d = json.data;
  document.getElementById("edit-listing-id").value = String(d.id);
  const titleEl = document.getElementById("edit-seo-title");
  titleEl.value = d.seo_title || "";
  document.getElementById("edit-title-len").textContent = String((titleEl.value || "").length);
  titleEl.oninput = () => {
    document.getElementById("edit-title-len").textContent = String(titleEl.value.length);
  };
  document.getElementById("edit-price").value =
    d.suggested_price != null ? Number(d.suggested_price).toFixed(2) : "";
  const sub = document.getElementById("modal-subtitle");
  if (sub) sub.textContent = `Listing #${d.id}${d.ebay_listing_id ? " · déjà publié eBay" : " · brouillon local"}`;
  const srcLink = document.getElementById("edit-source-link");
  if (srcLink) {
    if (d.source_url) {
      srcLink.href = d.source_url;
      srcLink.classList.remove("hidden");
    } else {
      srcLink.classList.add("hidden");
    }
  }
  editHtmlDraft = d.html_description || "";
  editThemeColor = detectThemeFromHtml(editHtmlDraft);
  editImageUrls = extractImagesFromHtml(editHtmlDraft);
  editImageFits = extractImageFitsFromHtml(editHtmlDraft, editImageUrls.length);
  initEditPalette();
  syncEditThemeIndicators();
  renderEditModalPreview();
  const m = document.getElementById("modal");
  m.classList.remove("hidden");
  m.classList.add("flex");
}

async function saveListingEdits(opts = {}) {
  const quiet = !!opts.quiet;
  const id = document.getElementById("edit-listing-id")?.value;
  if (!id) return false;
  const seo_title = document.getElementById("edit-seo-title").value.trim();
  const suggested_price = Number(document.getElementById("edit-price").value);
  if (!seo_title) {
    alert("Titre requis");
    return false;
  }
  if (!(suggested_price > 0)) {
    alert("Prix invalide");
    return false;
  }
  const html_description =
    editHtmlDraft || document.getElementById("modal-content")?.innerHTML || undefined;
  const res = await fetch(API + "/api/listings/" + id, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seo_title, suggested_price, html_description }),
  });
  const json = await res.json();
  if (!json.success) {
    alert(json.error || "Erreur sauvegarde");
    return false;
  }
  if (!quiet) alert("Annonce enregistrée");
  loadListings();
  return true;
}

function showPublishError(message) {
  const text = String(message || "Erreur publication eBay (sans détail).").trim();
  try {
    localStorage.setItem("ebx-last-publish-error", text);
  } catch (_) {}
  const box = document.getElementById("error-modal-text");
  const modal = document.getElementById("error-modal");
  if (box && modal) {
    box.value = text;
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    return;
  }
  alert(text);
}

function closeErrorModal() {
  const modal = document.getElementById("error-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.classList.remove("flex");
}

function closeErrorModalIfBackdrop(event) {
  if (event?.target?.id === "error-modal") closeErrorModal();
}

async function copyErrorModalText() {
  const box = document.getElementById("error-modal-text");
  const text = box?.value || "";
  try {
    await navigator.clipboard.writeText(text);
    alert("Erreur copiée.");
  } catch (_) {
    box?.select();
    document.execCommand("copy");
    alert("Erreur copiée.");
  }
}

function extractPublishErrorMessage(json, fallback) {
  if (!json || typeof json !== "object") return fallback || "Erreur publication";
  const err = json.error;
  if (typeof err === "string" && err.trim() && !/^error$/i.test(err.trim())) return err.trim();
  if (err && typeof err === "object") {
    const nested = err.longMessage || err.message || err.error;
    if (nested) return String(nested);
  }
  if (json.raw && String(json.raw).trim()) return String(json.raw).trim();
  return fallback || "Erreur publication eBay (sans détail). Regarde la console serveur.";
}

async function publishListingFromModal() {
  const id = document.getElementById("edit-listing-id")?.value;
  if (!id) return;
  const saved = await saveListingEdits({ quiet: true });
  if (!saved) return;
  const envMode = window.__ebxPublishEnv || "sandbox";
  const warn =
    envMode === "production"
      ? "Publier sur eBay PRODUCTION (compte vendeur RÉEL) ?"
      : "Publier en SANDBOX ?";
  if (!confirm(warn)) return;
  const btn = document.getElementById("edit-publish-btn");
  const original = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Publication…";
  }
  try {
    const res = await fetch(API + "/api/publish-to-ebay/" + id, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variations: { enabled: false } }),
    });
    let json = {};
    try {
      json = await res.json();
    } catch (_) {
      showPublishError(`Réponse serveur invalide (HTTP ${res.status}). Le serveur tourne-t-il encore ?`);
      return;
    }
    if (!json.success) {
      showPublishError(extractPublishErrorMessage(json, `Erreur publication (HTTP ${res.status})`));
      return;
    }
    const lid = json.data?.listingId || json.listingId || "n/a";
    const v = json.data?.variations;
    const vars = Array.isArray(v?.values) ? v.values.join(" / ") : "";
    const note = json.data?.note || json.data?.differentiatedTitle
      ? `\n\n${json.data.note || `Titre ajusté : ${json.data.differentiatedTitle}`}`
      : "";
    alert(`Publié ! Listing ID: ${lid}${vars ? `\nVariations: ${vars}` : ""}${note}`);
    closeModal();
    loadListings();
  } catch (e) {
    showPublishError(e.message || "Erreur publication (réseau)");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = original || "Enregistrer & Publier";
    }
  }
}

function closeModal() {
  const m = document.getElementById("modal");
  m.classList.add("hidden");
  m.classList.remove("flex");
}

function closeModalIfBackdrop(event) {
  if (event?.target?.id === "modal") closeModal();
}

async function publishListing(id, btn) {
  const envMode = window.__ebxPublishEnv || "sandbox";
  const warn =
    envMode === "production"
      ? "Publier sur eBay PRODUCTION (compte vendeur RÉEL) ?\n\nL'annonce apparaîtra dans Vendre → Annonces actives de CE compte OAuth.\n\nAstuce : clique « Voir » pour modifier titre / prix / couleurs avant."
      : "ATTENTION : mode SANDBOX\n\nL'annonce ira sur le compte TEST (testuser),\nPAS sur ton vrai compte eBay.\n\nPour le réel : mets EBAY_ENV=production dans .env puis redémarre.\n\nContinuer en Sandbox ?";
  if (!confirm(warn)) return;
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "...";
  try {
    const res = await fetch(API + "/api/publish-to-ebay/" + id, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variations: { enabled: false } }),
    });
    let json = {};
    try {
      json = await res.json();
    } catch (_) {
      throw new Error(`Réponse serveur invalide (HTTP ${res.status})`);
    }
    if (!json.success) throw new Error(extractPublishErrorMessage(json, `HTTP ${res.status}`));
    const lid = json.data.listingId || "N/A";
    const penv = json.data.env || envMode;
    const seller = json.data.sellerUserId ? `\nCompte vendeur : ${json.data.sellerUserId}` : "";
    const isFr = /ebay_fr|france/i.test(String(window.__ebxMarketplace || "EBAY_FR"));
    const link =
      penv === "production"
        ? `https://www.ebay.${isFr ? "fr" : "com"}/itm/${lid}`
        : `https://www.sandbox.ebay.com/itm/${lid}`;
    const note =
      penv === "production"
        ? "Visible sur ton vrai eBay (Active listings)."
        : "Visible UNIQUEMENT sur sandbox.ebay.com (compte test) — pas sur ebay.com réel.";
    const extra = json.data?.note
      ? `\n\n${json.data.note}`
      : json.data?.differentiatedTitle
        ? `\n\nTitre ajusté anti-doublon : ${json.data.differentiatedTitle}`
        : "";
    alert(`Publié (${penv}) !${seller}\nListing ID: ${lid}\n\n${note}${extra}\n\nOuvre : ${link}`);
    loadListings();
  } catch (err) {
    showPublishError(err.message || "Erreur publication");
  } finally {
    btn.textContent = original;
    btn.disabled = false;
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
  (el || document.querySelector(`.color-swatch[data-theme="${color}"]`))?.classList.add("active");
  syncDescColorIndicators();
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
          originalTitle: lastDesc.original_title || lastDesc.product_name,
          images: descImages.length ? descImages : lastDesc.images || [],
          bullets: lastDesc.product?.bullets || [],
          benefits: lastDesc.product?.benefits || [],
          sections: lastDesc.product?.sections || [],
          specs: lastDesc.product?.specs || {},
          description: lastDesc.product?.description || lastDesc.product?.short_pitch || "",
          short_pitch: lastDesc.product?.short_pitch || "",
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
        product: {
          ...product,
          originalTitle: product.originalTitle || lastDesc?.original_title || product.title,
          images: descImages.length ? descImages : product.images || [],
        },
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
  const stripProv = (t) =>
    String(t || "")
      .replace(/\s*[-–—|/]\s*(AliExpress|Amazon(?:\.[a-z]+)?|Cdiscount|eBay)\s*[\d.]*\s*$/gi, "")
      .replace(/\b(AliExpress|Amazon(?:\.[a-z]+)?|Cdiscount|eBay)\b/gi, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  const cleanTitle = stripProv(data.seo_title || data.product_name || data.product?.title || "Produit");
  const product =
    data.product ||
    {
      title: cleanTitle,
      images: data.images || [],
      bullets: [],
      description: "",
      price: data.suggested_price,
      source: data.source || "generic",
      url: data.source_url || "",
    };
  product.title = stripProv(product.title || cleanTitle);
  let html = String(data.html_description || "")
    .replace(
      /Produit sélectionné pour sa qualité,\s*sa demande eBay et son potentiel de marge\.?/gi,
      "Produit sélectionné pour sa qualité et sa demande eBay."
    )
    .replace(/\s*et son potentiel de marge\.?/gi, ".")
    .replace(/(?:<br\s*\/?>\s*)?Source\s*:\s*[^<\n]+/gi, "")
    .replace(
      /<(?:div|li|p)([^>]*)>\s*(?:<strong>\s*)?Source\s*:?\s*(?:<\/strong>)?\s*[^<]*<\/(?:div|li|p)>/gi,
      ""
    )
    .replace(/<h1([^>]*)>([\s\S]*?)<\/h1>/gi, (_, attrs, inner) => {
      const plain = String(inner).replace(/<[^>]+>/g, " ");
      return `<h1${attrs}>${stripProv(plain)}</h1>`;
    });
  lastDesc = { ...data, seo_title: cleanTitle, product_name: cleanTitle, product, html_description: html };
  const previewHtml = html;
  descImages = (data.images && data.images.length ? data.images : product.images) || descImages || [];
  lastDesc.images = descImages;
  lastDesc.product.images = descImages;

  document.getElementById("desc-html").textContent = previewHtml;
  const preview = document.getElementById("desc-preview");
  preview.classList.remove("flex", "items-center", "justify-center", "text-zinc-300");
  preview.innerHTML = previewHtml;
  bindPreviewImages(preview);

  const banner = document.getElementById("desc-banner");
  banner.classList.remove("hidden");
  document.getElementById("desc-detected").textContent =
    "Produit détecté : " + cleanTitle.slice(0, 80);
  document.getElementById("desc-img-badge").textContent = `${descImages.length} images`;
  const enrich = data.enrichment || {};
  const sec = enrich.sections ?? (data.product?.sections || []).length;
  const ben = enrich.benefits ?? (data.product?.benefits || data.product?.bullets || []).length;
  const enrichEl = document.getElementById("desc-enrich-badge");
  if (enrichEl) {
    enrichEl.textContent =
      sec || ben
        ? `${sec || 0} sections · ${ben || 0} bénéfices`
        : "enrichissement faible — régénère après restart serveur";
  }
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
  loadSupplierConfig();
  loadOrders();
}

async function loadSetupStatus() {
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
        ["Amazon", suppliers.amazon?.connected, suppliers.amazon?.connected ? "Connecté" : "Non connecté"],
        ["AliExpress", suppliers.aliexpress?.connected, suppliers.aliexpress?.connected ? "Connecté" : "Extension / manuel"],
        ["Cdiscount", suppliers.cdiscount?.connected || suppliers.cdiscount?.enabled, suppliers.cdiscount?.connected ? "Connecté" : "Activé"],
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
    const darkChk = document.getElementById("settings-dark");
    if (darkChk) darkChk.checked = document.body.classList.contains("dark-mode");
  } catch (err) {
    console.warn("[EBX] setup:", err.message);
  }
}

function toggleHelpChat(force) {
  const panel = document.getElementById("help-chat-panel");
  if (!panel) return;
  const open = typeof force === "boolean" ? force : panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !open);
  if (open) document.getElementById("help-chat-input")?.focus();
}

async function sendHelpChat(event) {
  if (event) event.preventDefault();
  const input = document.getElementById("help-chat-input");
  const box = document.getElementById("help-chat-messages");
  const q = String(input?.value || "").trim();
  if (!q || !box) return;
  input.value = "";
  box.innerHTML += `<div class="help-msg help-msg-user">${escapeHtml(q)}</div>`;
  box.scrollTop = box.scrollHeight;
  const pending = document.createElement("div");
  pending.className = "help-msg help-msg-bot";
  pending.textContent = "…";
  box.appendChild(pending);
  box.scrollTop = box.scrollHeight;
  try {
    const res = await fetch(API + "/api/help-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: q }),
    });
    const json = await res.json();
    pending.textContent = json.reply || json.error || "Pas de réponse.";
  } catch (err) {
    pending.textContent = "Erreur : " + err.message;
  }
  box.scrollTop = box.scrollHeight;
}

checkHealth();
(async () => {
  document.getElementById("auth-tab-login")?.addEventListener("click", () => setAuthTab("login"));
  document.getElementById("auth-tab-register")?.addEventListener("click", () => setAuthTab("register"));
  setAuthTab("login");
  const ok = await ensureWebSession();
  if (ok) {
    loadDashboard();
    startNotificationsPolling();
  }
})();


// Expose handlers for onclick + bind as backup
["navigate","runTitleBuilder","generateFromUrl","runSnipe","analyzeCompetitor","copyTitle","copyHtml","setTheme","runBulking","runSubstitution","runManualImport","saveManualListing","publishManualListing","loadRankings","loadListings","loadOrders","loadSettings","viewListing","saveListingEdits","publishListingFromModal","publishListing","deleteListing","deleteSelectedListings","toggleSelectAllListings","updateListingsBulkBar","deleteOrder","deleteSelectedOrders","toggleSelectAllOrders","updateOrdersBulkBar","dedupeListings","scrubListingImages","closeModal","closeModalIfBackdrop","closeErrorModal","closeErrorModalIfBackdrop","copyErrorModalText","showPublishError","closeImgModal","pickImage","addKeyword","removeKeyword","kwPage","onTitleEdit","advanceOrder","viewCompetitorHistory","deleteCompetitorHistory","syncListing","endListingEbay","syncEbayOrders","addEbayAccount","activateEbayAccount","removeEbayAccount","loadAccounts","openSupplierOrder","copyShipAddress","processAutoOrderQueue","saveAutoOrderSettings","toggleSupplier","connectSupplier","loadSupplierConfig","toggleDarkMode","toggleDescColors","deleteSavSelected","selectSav","syncSavMessages","draftSavSelected","escalateSavSelected","sendSavSelected","autoDraftAllSav","loadSav","loadSavInboxPage","refreshSavStatus","loadSavSales","moveEditImage","promoteEditImage","zoomEditImage","setEditTheme","loadDashboard","refreshDashboardTrending","toggleNotificationsPanel","refreshNotifications","navigateFromNotif","startNotificationsPolling","markNotificationsRead","markAllNotificationsRead","openNotificationItem","toggleHelpChat","sendHelpChat","importSnipeOffer","runAutoPublish","loadAutoPublishHistory","saveAutoPublishSettings"].forEach((name) => {
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
