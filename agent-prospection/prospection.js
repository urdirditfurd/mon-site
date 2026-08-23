(() => {
  const sectorSelect = document.getElementById("sectorSelect");
  const daysSelect = document.getElementById("daysSelect");
  const departmentInput = document.getElementById("departmentInput");
  const senderName = document.getElementById("senderName");
  const senderEmail = document.getElementById("senderEmail");
  const senderPhone = document.getElementById("senderPhone");
  const runBtn = document.getElementById("runBtn");
  const csvBtn = document.getElementById("csvBtn");
  const logBox = document.getElementById("logBox");
  const statsBox = document.getElementById("statsBox");
  const companyList = document.getElementById("companyList");
  const mailTemplate = document.getElementById("mailTemplate");
  const previewMailBtn = document.getElementById("previewMailBtn");
  const saveTemplateBtn = document.getElementById("saveTemplateBtn");
  const mailPreview = document.getElementById("mailPreview");
  const mailPreviewContent = document.getElementById("mailPreviewContent");
  const massMailBar = document.getElementById("massMailBar");
  const selectAllCb = document.getElementById("selectAllCb");
  const selectedCount = document.getElementById("selectedCount");
  const massEditBtn = document.getElementById("massEditBtn");
  const massSendBtn = document.getElementById("massSendBtn");
  const progressWrap = document.getElementById("progressWrap");
  const progressBar = document.getElementById("progressBar");
  const progressPct = document.getElementById("progressPct");
  const progressLabel = document.getElementById("progressLabel");
  const statusLine = document.getElementById("statusLine");
  const filterTabs = document.getElementById("filterTabs");
  const countTodo = document.getElementById("countTodo");
  const countDone = document.getElementById("countDone");
  const countAll = document.getElementById("countAll");
  const historyBtn = document.getElementById("historyBtn");
  const historyPanel = document.getElementById("historyPanel");
  const historyList = document.getElementById("historyList");
  const historyClearBtn = document.getElementById("historyClearBtn");
  const historyCloseBtn = document.getElementById("historyCloseBtn");
  const viewDashboard = document.getElementById("viewDashboard");
  const viewProspection = document.getElementById("viewProspection");
  const navDashboard = document.getElementById("navDashboard");
  const navProspection = document.getElementById("navProspection");
  const dashGoProspection = document.getElementById("dashGoProspection");
  const dashMetrics = document.getElementById("dashMetrics");
  const dashRuns = document.getElementById("dashRuns");
  const dashContacts = document.getElementById("dashContacts");

  const STORAGE_KEY = "prospection-sender";
  const TEMPLATE_KEY = "prospection-mail-template";
  const CONTACTED_KEY = "prospection-contacted";
  const SCAN_MEMORY_KEY = "prospection-scan-memory";
  const FILTER_KEY = "prospection-filter";
  const SCAN_RUNS_KEY = "prospection-scan-runs";
  const VIEW_KEY = "prospection-view";
  const FALLBACK_SECTORS = [
    { id: "tous", label: "Tous les secteurs" },
    { id: "restauration", label: "Restauration, cafés, bars" },
    { id: "btp", label: "BTP / artisanat du bâtiment" },
    { id: "commerce", label: "Commerce de détail" },
    { id: "immobilier", label: "Immobilier" },
    { id: "informatique", label: "Informatique / digital" },
    { id: "conseil", label: "Conseil, gestion, juridique" },
    { id: "sante", label: "Santé / médical" },
    { id: "beaute", label: "Beauté / coiffure" },
    { id: "transport", label: "Transport / logistique" },
    { id: "enseignement", label: "Formation / enseignement" },
    { id: "cinema", label: "Cinéma / audiovisuel / production" },
    { id: "arts", label: "Arts, spectacles, sport" },
    { id: "services", label: "Services aux entreprises" }
  ];
  const IS_FILE_MODE = window.location.protocol === "file:";
  const API_PREFIX = IS_FILE_MODE ? "http://localhost:3000" : "";

  let companies = [];
  let companyMemory = {};
  let selectedKeys = new Set();
  let editedMails = {};
  let contactedMap = {};
  let listFilter = "todo";
  let streamAbort = null;
  let runToken = 0;
  let searchDone = false;
  let scanRuns = [];
  let currentView = "dashboard";
  let scanStartedAt = null;

  function loadContacted() {
    try {
      contactedMap = JSON.parse(localStorage.getItem(CONTACTED_KEY) || "{}") || {};
    } catch {
      contactedMap = {};
    }
  }

  function saveContacted() {
    localStorage.setItem(CONTACTED_KEY, JSON.stringify(contactedMap));
  }

  function loadScanMemory() {
    try {
      companyMemory = JSON.parse(localStorage.getItem(SCAN_MEMORY_KEY) || "{}") || {};
    } catch {
      companyMemory = {};
    }
  }

  function loadScanRuns() {
    try {
      const rows = JSON.parse(localStorage.getItem(SCAN_RUNS_KEY) || "[]");
      scanRuns = Array.isArray(rows) ? rows : [];
    } catch {
      scanRuns = [];
    }
  }

  function saveScanRuns() {
    if (scanRuns.length > 40) scanRuns = scanRuns.slice(0, 40);
    localStorage.setItem(SCAN_RUNS_KEY, JSON.stringify(scanRuns));
  }

  function daysLabelFromValue(days) {
    const n = Number(days);
    if (n >= 700) return "Moins de 2 ans";
    if (n >= 300) return "Moins d’1 an";
    return `${n || "?"} j`;
  }

  function formatDateTime(iso) {
    if (!iso) return "n.c.";
    try {
      return new Date(iso).toLocaleString("fr-FR", {
        dateStyle: "short",
        timeStyle: "short"
      });
    } catch {
      return String(iso);
    }
  }

  function formatDuration(ms) {
    const total = Math.max(0, Math.round(Number(ms) || 0) / 1000);
    if (total < 60) return `${Math.round(total)} s`;
    const min = Math.floor(total / 60);
    const sec = Math.round(total % 60);
    return sec ? `${min} min ${sec} s` : `${min} min`;
  }

  function departmentLabel(code) {
    if (!code) return "France entière";
    const opt = [...departmentInput.options].find((o) => o.value === code);
    return opt ? opt.textContent : code;
  }

  function sectorLabel(id) {
    const opt = [...sectorSelect.options].find((o) => o.value === id);
    return opt ? opt.textContent : (id || "n.c.");
  }

  function recordScanRun(summary, incoming) {
    const endedAt = new Date().toISOString();
    const startedAt = scanStartedAt || endedAt;
    const durationMs = Math.max(0, new Date(endedAt) - new Date(startedAt));
    const days = summary.daysUsed || summary.days || daysSelect.value;
    const newTodo = incoming.filter((c) => !isContacted(companyKey(c))).length;
    const already = incoming.filter((c) => isContacted(companyKey(c))).length;
    scanRuns.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      startedAt,
      endedAt,
      durationMs,
      sector: selectedSector(),
      sectorLabel: sectorLabel(selectedSector()),
      days: Number(days) || null,
      daysLabel: daysLabelFromValue(days),
      department: departmentInput.value.trim(),
      departmentLabel: departmentLabel(departmentInput.value.trim()),
      scanned: Number(summary.scanned || 0),
      contactsFound: incoming.length,
      newTodo,
      alreadySeen: already,
      todoAfter: companies.filter((c) => !isContacted(companyKey(c))).length,
      doneAfter: companies.filter((c) => isContacted(companyKey(c))).length
    });
    saveScanRuns();
    scanStartedAt = null;
  }

  function setAppView(view) {
    currentView = view === "prospection" ? "prospection" : "dashboard";
    localStorage.setItem(VIEW_KEY, currentView);
    const onDash = currentView === "dashboard";
    if (viewDashboard) viewDashboard.hidden = !onDash;
    if (viewProspection) viewProspection.hidden = onDash;
    if (navDashboard) navDashboard.classList.toggle("active", onDash);
    if (navProspection) navProspection.classList.toggle("active", !onDash);
    if (onDash) renderDashboard();
  }

  function renderDashboard() {
    if (!dashMetrics || !dashRuns || !dashContacts) return;
    const todo = companies.filter((c) => !isContacted(companyKey(c))).length;
    const done = companies.filter((c) => isContacted(companyKey(c))).length;
    const totalScanned = Object.keys(companyMemory).length;
    const lastRun = scanRuns[0];
    const totalScanTime = scanRuns.reduce((sum, row) => sum + (Number(row.durationMs) || 0), 0);
    const firstContactAt = contactedEntries().slice(-1)[0]?.at;
    const lastContactAt = contactedEntries()[0]?.at;

    dashMetrics.innerHTML = `
      <div class="dash-metric">
        <span class="label">Entreprises contactées</span>
        <div class="value">${done}</div>
        <div class="sub">${lastContactAt ? `Dernier contact : ${formatDateTime(lastContactAt)}` : "Aucun contact pour l’instant"}</div>
      </div>
      <div class="dash-metric">
        <span class="label">À contacter</span>
        <div class="value">${todo}</div>
        <div class="sub">${totalScanned} entreprise(s) en mémoire</div>
      </div>
      <div class="dash-metric">
        <span class="label">Sondages réalisés</span>
        <div class="value">${scanRuns.length}</div>
        <div class="sub">${lastRun ? `Dernier : ${formatDateTime(lastRun.endedAt)}` : "Aucun sondage encore"}</div>
      </div>
      <div class="dash-metric">
        <span class="label">Temps agent</span>
        <div class="value" style="font-size:1.35rem">${formatDuration(totalScanTime)}</div>
        <div class="sub">${firstContactAt ? `Depuis le ${formatDateTime(firstContactAt)}` : "Cumul des sondages"}</div>
      </div>
    `;

    if (!scanRuns.length) {
      dashRuns.innerHTML = `<li class="dash-empty">Aucun sondage enregistré. Lancez une prospection pour voir ici la date, la durée, le secteur et les résultats.</li>`;
    } else {
      dashRuns.innerHTML = scanRuns.slice(0, 8).map((run) => `
        <li class="dash-item">
          <strong>${escapeHtml(run.sectorLabel || "Secteur")}</strong>
          <div class="meta">
            ${formatDateTime(run.startedAt)} → ${formatDateTime(run.endedAt)} · ${formatDuration(run.durationMs)}<br>
            Fenêtre : ${escapeHtml(run.daysLabel || daysLabelFromValue(run.days))} · Zone : ${escapeHtml(run.departmentLabel || "France")}<br>
            ${run.scanned || 0} scannée(s) · ${run.contactsFound || 0} contact(s) trouvé(s) · ${run.newTodo || 0} nouvelle(s) à traiter
          </div>
        </li>
      `).join("");
    }

    const recentContacts = contactedEntries().slice(0, 8);
    if (!recentContacts.length) {
      dashContacts.innerHTML = `<li class="dash-empty">Aucune entreprise marquée contactée. Dès que vous ouvrez Message ou Mail, elle apparaît ici.</li>`;
    } else {
      dashContacts.innerHTML = recentContacts.map((row) => {
        const channel = row.channel === "mail" ? "Mail" : (row.channel === "sms" ? "Message" : (row.channel || "manuel"));
        return `<li class="dash-item">
          <strong>${escapeHtml(row.name || row.key)}</strong>
          <div class="meta">
            ${formatDateTime(row.at)} · ${escapeHtml(channel)}
            ${row.email ? `<br>${escapeHtml(row.email)}` : ""}
            ${row.phone ? `<br>${escapeHtml(row.phone)}` : ""}
          </div>
        </li>`;
      }).join("");
    }
  }

  function saveScanMemory() {
    const keys = Object.keys(companyMemory);
    // Garde les 400 plus récentes pour ne pas saturer localStorage.
    if (keys.length > 400) {
      const ranked = keys
        .map((key) => ({ key, at: companyMemory[key]?.lastSeenAt || "" }))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)));
      const keep = new Set(ranked.slice(0, 400).map((row) => row.key));
      companyMemory = Object.fromEntries(
        Object.entries(companyMemory).filter(([key]) => keep.has(key))
      );
    }
    localStorage.setItem(SCAN_MEMORY_KEY, JSON.stringify(companyMemory));
  }

  function isContacted(key) {
    return Boolean(contactedMap[key]);
  }

  function rememberCompany(company, { fromScan } = {}) {
    if (!company || !company.hasContact) return;
    const key = companyKey(company);
    const prev = companyMemory[key] || {};
    companyMemory[key] = {
      ...prev,
      ...company,
      // Ne pas écraser un meilleur contact déjà mémorisé par un vide.
      email: company.email || prev.email || "",
      phone: company.phone || prev.phone || "",
      website: company.website || prev.website || "",
      contactSource: company.contactSource || prev.contactSource || "",
      lastSeenAt: new Date().toISOString(),
      scanCount: Number(prev.scanCount || 0) + (fromScan ? 1 : 0)
    };
    saveScanMemory();
  }

  function rebuildCompaniesList() {
    companies = Object.values(companyMemory)
      .filter((c) => c && c.hasContact && (c.email || c.phone))
      .map((c) => ({ ...c }))
      .sort((a, b) => {
        const aDone = isContacted(companyKey(a)) ? 1 : 0;
        const bDone = isContacted(companyKey(b)) ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone; // à contacter d'abord
        return String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || ""));
      });
  }

  function markContacted(company, channel) {
    const key = companyKey(company);
    contactedMap[key] = {
      name: company.name || key,
      siren: company.siren || "",
      activity: company.activity || company.nafLabel || "",
      email: company.email || "",
      phone: company.phone || "",
      address: company.address || "",
      channel: channel || (company.phone ? "sms" : "mail"),
      source: company.contactSource || "",
      at: new Date().toISOString()
    };
    saveContacted();
    rememberCompany(company, { fromScan: false });
    renderDashboard();
  }

  function unmarkContacted(key) {
    delete contactedMap[key];
    saveContacted();
    renderDashboard();
  }

  function contactedEntries() {
    return Object.entries(contactedMap)
      .map(([key, row]) => ({ key, ...(row || {}) }))
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  }

  function renderHistory() {
    const rows = contactedEntries();
    if (!rows.length) {
      historyList.innerHTML = `<li class="history-empty">Aucune entreprise contactée pour l’instant.</li>`;
      return;
    }
    historyList.innerHTML = rows.map((row) => {
      const when = row.at ? new Date(row.at).toLocaleString("fr-FR") : "n.c.";
      const channelLabel = row.channel === "mail" ? "Mail" : (row.channel === "sms" ? "Message" : (row.channel || "manuel"));
      const bits = [
        row.siren ? `SIREN ${escapeHtml(row.siren)}` : "",
        row.email ? escapeHtml(row.email) : "",
        row.phone ? escapeHtml(row.phone) : "",
        escapeHtml(channelLabel),
        escapeHtml(when)
      ].filter(Boolean);
      return `<li class="history-item" data-history-key="${escapeHtml(row.key)}">
        <strong>${escapeHtml(row.name || row.key)}</strong>
        <span class="meta">${bits.join(" · ")}</span>
        <button class="btn btn-ghost" type="button" data-history-remove="${escapeHtml(row.key)}">Retirer</button>
      </li>`;
    }).join("");
  }

  function toggleHistory(force) {
    const open = typeof force === "boolean" ? force : historyPanel.hidden;
    historyPanel.hidden = !open;
    historyPanel.classList.toggle("visible", open);
    if (open) renderHistory();
  }

  function loadFilter() {
    const saved = localStorage.getItem(FILTER_KEY);
    if (saved === "todo" || saved === "done" || saved === "all") listFilter = saved;
  }

  function saveFilter() {
    localStorage.setItem(FILTER_KEY, listFilter);
  }

  function setListFilter(filter, { closeHistory = true, scrollToList = false } = {}) {
    if (filter !== "todo" && filter !== "done" && filter !== "all") return;
    listFilter = filter;
    saveFilter();
    if (closeHistory) toggleHistory(false);
    renderList();
    if (scrollToList && filteredCompanies().length) {
      companyList.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function renderStats(extra = {}) {
    const todo = companies.filter((c) => !isContacted(companyKey(c))).length;
    const done = companies.filter((c) => isContacted(companyKey(c))).length;
    const withMail = companies.filter((c) => c.email && !isContacted(companyKey(c))).length;
    if (!companies.length) {
      statsBox.innerHTML = "";
      return;
    }
    const scanned = extra.scanned;
    const daysLabel = extra.daysLabel;
    const todoLabel = extra.todoLabel || "à contacter";
    const parts = [
      `<button type="button" class="stat stat-action${listFilter === "todo" ? " active" : ""}" data-filter="todo" title="Afficher les entreprises à contacter">
        <b>${todo}</b> ${todoLabel}
      </button>`,
      `<button type="button" class="stat stat-action${listFilter === "done" ? " active" : ""}" data-filter="done" title="Afficher les entreprises déjà contactées">
        <b>${done}</b> déjà contactées
      </button>`
    ];
    if (searchDone && withMail) {
      parts.push(`<span class="stat"><b>${withMail}</b> e-mails prêts</span>`);
    }
    if (typeof scanned === "number") {
      parts.push(`<span class="stat"><b>${scanned}</b> scannées (run)</span>`);
    }
    if (daysLabel) {
      parts.push(`<span class="stat">Fenêtre : <b>${daysLabel}</b></span>`);
    }
    parts.push(`<button type="button" class="stat stat-action${listFilter === "all" ? " active" : ""}" data-filter="all" title="Afficher toutes les entreprises en mémoire">
      <b>${companies.length}</b> en mémoire
    </button>`);
    statsBox.innerHTML = parts.join("");
  }

  function loadSender() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      senderName.value = saved.name || "";
      senderEmail.value = saved.email || "";
      senderPhone.value = saved.phone || "";
    } catch {
      // ignore
    }
  }

  function saveSender() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      name: senderName.value.trim(),
      email: senderEmail.value.trim(),
      phone: senderPhone.value.trim()
    }));
  }

  function setProgress(percent, label) {
    const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    progressWrap.classList.add("active");
    progressBar.style.width = `${value}%`;
    progressPct.textContent = `${value}%`;
    if (label) {
      progressLabel.textContent = label;
      statusLine.textContent = label;
    }
  }

  function hideProgressSoon() {
    setTimeout(() => {
      if (!runBtn.textContent.includes("Relancer")) {
        progressWrap.classList.remove("active");
      }
    }, 1800);
  }

  function log(message, { quiet } = {}) {
    if (quiet) {
      statusLine.textContent = message;
      return;
    }
    const stamp = new Date().toLocaleTimeString("fr-FR");
    const line = `[${stamp}] ${message}`;
    logBox.textContent = `${logBox.textContent ? `${logBox.textContent}\n` : ""}${line}`.trim();
    logBox.classList.add("visible");
    logBox.scrollTop = logBox.scrollHeight;
    statusLine.textContent = message;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function companyKey(c) {
    return c.siren || c.name;
  }

  function fillTemplate(template, company) {
    return template
      .replace(/\{entreprise\}/g, company.name || "")
      .replace(/\{dirigeant\}/g, (company.directors || [])[0] || "Madame, Monsieur")
      .replace(/\{activite\}/g, company.activity || "")
      .replace(/\{adresse\}/g, company.address || "")
      .replace(/\[Votre nom\]/g, senderName.value.trim() || "")
      .replace(/\[Votre email\]/g, senderEmail.value.trim() || "")
      .replace(/\[Votre téléphone\]/g, senderPhone.value.trim() || "");
  }

  function getMailForCompany(company) {
    const key = companyKey(company);
    if (editedMails[key]) return editedMails[key];
    return fillTemplate(mailTemplate.value, company);
  }

  function mailSubject(company) {
    return `Proposition d’accompagnement comptable — ${company.name}`;
  }

  function openExternal(href) {
    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function openMailto(company, body) {
    if (!company.email) return false;
    const mailto = `mailto:${company.email}?subject=${encodeURIComponent(mailSubject(company))}&body=${encodeURIComponent(body)}`;
    openExternal(mailto);
    return true;
  }

  function phoneDigits(phone) {
    return String(phone || "").replace(/\D/g, "");
  }

  function intlPhone(phone) {
    let digits = phoneDigits(phone);
    if (!digits) return "";
    if (digits.startsWith("0") && digits.length === 10) digits = `33${digits.slice(1)}`;
    return digits;
  }

  /** Ouvre l’app Messages avec le texte de prospection en brouillon. */
  function openSmsDraft(company, body) {
    const intl = intlPhone(company.phone);
    if (!intl) return false;
    // iOS : ?body= — Android : ?&body= — on tente les deux formes usuelles.
    const encoded = encodeURIComponent(body);
    const href = `sms:+${intl}?&body=${encoded}`;
    openExternal(href);
    return true;
  }

  function contactBlock(company) {
    if (company.hasContact && (company.email || company.phone)) {
      const bits = [];
      if (company.email) bits.push(`<a href="mailto:${escapeHtml(company.email)}">${escapeHtml(company.email)}</a>`);
      if (company.phone) bits.push(`<a href="tel:${escapeHtml(company.phone.replace(/\s/g, ""))}">${escapeHtml(company.phone)}</a>`);
      return `<div class="contact-row"><strong>Contact validé</strong> · ${bits.join(" · ")}<div class="meta">Source : ${escapeHtml(company.contactSource || "web public")} — à recouper avec l’Annuaire / Pappers (SIREN)</div></div>`;
    }
    return "";
  }

  function filteredCompanies() {
    if (listFilter === "todo") return companies.filter((c) => !isContacted(companyKey(c)));
    if (listFilter === "done") return companies.filter((c) => isContacted(companyKey(c)));
    return companies;
  }

  function updateFilterTabs() {
    const todo = companies.filter((c) => !isContacted(companyKey(c))).length;
    const done = companies.filter((c) => isContacted(companyKey(c))).length;
    countTodo.textContent = `(${todo})`;
    countDone.textContent = `(${done})`;
    countAll.textContent = `(${companies.length})`;
    filterTabs.querySelectorAll(".filter-tab").forEach((tab) => {
      const active = tab.getAttribute("data-filter") === listFilter;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function primaryActions(company, key, mailContent) {
    const canMail = Boolean(company.hasContact && company.email);
    const canSms = Boolean(company.hasContact && company.phone);
    const links = [];
    // S'adapte à ce que l'agent a trouvé : téléphone → Message, sinon e-mail → Mail.
    if (canSms && canMail) {
      links.push(`<button class="btn btn-primary" type="button" data-open-sms="${escapeHtml(key)}">Message</button>`);
      links.push(`<button class="btn btn-primary" type="button" data-send-one="${escapeHtml(key)}">Mail</button>`);
      links.push(`<button class="btn btn-ghost" type="button" data-edit-mail="${escapeHtml(key)}">Voir / modifier</button>`);
    } else if (canSms) {
      links.push(`<button class="btn btn-primary" type="button" data-open-sms="${escapeHtml(key)}">Message</button>`);
      links.push(`<button class="btn btn-ghost" type="button" data-edit-mail="${escapeHtml(key)}">Voir / modifier</button>`);
    } else if (canMail) {
      links.push(`<button class="btn btn-primary" type="button" data-send-one="${escapeHtml(key)}">Mail</button>`);
      links.push(`<button class="btn btn-ghost" type="button" data-edit-mail="${escapeHtml(key)}">Voir / modifier</button>`);
    }
    return { canMail, canSms, links };
  }

  function renderCompany(company) {
    const key = companyKey(company);
    const done = isContacted(key);
    const checked = selectedKeys.has(key) ? "checked" : "";
    const chip = done
      ? `<span class="chip done">déjà contacté</span>`
      : (Number(company.scanCount || 0) > 1
        ? `<span class="chip ok">à contacter · déjà scannée</span>`
        : `<span class="chip ok">à contacter</span>`);
    const directors = (company.directors || []).length
      ? `<div>Dirigeant : ${escapeHtml(company.directors.join(", "))}</div>`
      : "";
    const rawActivity = company.activity || "";
    const shortActivity = rawActivity.length > 160 ? `${rawActivity.slice(0, 160)}…` : rawActivity;
    const activity = company.nafLabel
      ? `${escapeHtml(shortActivity)} (${escapeHtml(company.naf)} ${escapeHtml(company.nafLabel)})`
      : escapeHtml(shortActivity);

    const mailContent = getMailForCompany(company);
    const editId = `mail-edit-${escapeHtml(key).replace(/[^a-zA-Z0-9]/g, "_")}`;
    const { canMail, canSms, links } = primaryActions(company, key, mailContent);

    if (done) {
      links.push(`<button class="btn btn-ghost" type="button" data-unmark="${escapeHtml(key)}">Remettre à contacter</button>`);
    } else {
      links.push(`<button class="btn btn-ghost" type="button" data-mark="${escapeHtml(key)}">Marquer contacté</button>`);
    }
    if (company.website) {
      links.push(`<a class="btn btn-ghost" href="${escapeHtml(company.website)}" target="_blank" rel="noopener" title="Site rattaché à cette entreprise">Site</a>`);
    }
    if (company.sireneUrl) links.push(`<a class="btn btn-ghost" href="${escapeHtml(company.sireneUrl)}" target="_blank" rel="noopener">Annuaire</a>`);
    if (company.pappersUrl) links.push(`<a class="btn btn-ghost" href="${escapeHtml(company.pappersUrl)}" target="_blank" rel="noopener">Pappers</a>`);

    return `<li class="company-card${done ? " contacted" : ""}" data-key="${escapeHtml(key)}">
      <div class="company-card-header">
        ${canMail && !done ? `<input type="checkbox" class="select-cb" data-select="${escapeHtml(key)}" ${checked}>` : ""}
        <h3>${escapeHtml(company.name)}${chip}</h3>
      </div>
      <div class="meta">
        <div>Activité : ${activity}</div>
        <div>Création : ${escapeHtml(company.createdAt || company.publishedAt || "n.c.")}${company.siren ? ` · SIREN ${escapeHtml(company.siren)}` : ""}</div>
        <div>Adresse : ${escapeHtml(company.address || `${company.postalCode || ""} ${company.city || ""}`.trim() || "n.c.")}</div>
        ${directors}
      </div>
      ${contactBlock(company)}
      <div class="actions">${links.join("")}</div>
      <div class="mail-edit-area" id="${editId}">
        <label class="field" style="margin-bottom:8px"><span>Message personnalisé (brouillon ${canSms ? "Messages" : "mail"})</span></label>
        <textarea data-mail-key="${escapeHtml(key)}">${escapeHtml(mailContent)}</textarea>
        <div class="actions">
          <button class="btn btn-ghost" type="button" data-save-mail="${escapeHtml(key)}">Enregistrer</button>
          ${canSms ? `<button class="btn btn-primary" type="button" data-open-sms="${escapeHtml(key)}">Message</button>` : ""}
          ${canMail ? `<button class="btn btn-primary" type="button" data-send-one="${escapeHtml(key)}">Mail</button>` : ""}
        </div>
      </div>
    </li>`;
  }

  function updateSelectionUI() {
    const visible = filteredCompanies();
    const mailable = visible.filter((c) => c.hasContact && c.email && !isContacted(companyKey(c)));
    selectedCount.textContent = String(selectedKeys.size);
    massMailBar.style.display = mailable.length && searchDone && listFilter !== "done" ? "flex" : "none";
    massSendBtn.disabled = selectedKeys.size === 0;
    selectAllCb.checked = mailable.length > 0 && mailable.every((c) => selectedKeys.has(companyKey(c)));
  }

  function emptyMessage() {
    if (!companies.length) {
      return "Choisissez un secteur et une période (moins d’1 an ou moins de 2 ans), puis lancez le sondage. Les contacts validés restent en mémoire.";
    }
    if (listFilter === "todo") {
      const todo = companies.filter((c) => !isContacted(companyKey(c))).length;
      if (todo > 0) {
        return `Il y a <strong>${todo}</strong> entreprise(s) à contacter en mémoire. Cliquez sur le compteur orange « ${todo} à contacter » ci-dessus pour les afficher.`;
      }
      return "Plus aucune entreprise à contacter en mémoire. Relancez un sondage pour en trouver de nouvelles, ou ouvrez « Déjà contactées » / Historique.";
    }
    if (listFilter === "done") {
      return "Aucune entreprise marquée contactée. Dès que vous ouvrez Message/Mail, elle passe ici automatiquement.";
    }
    return "Aucun contact à afficher.";
  }

  function renderList() {
    updateFilterTabs();
    const visible = filteredCompanies();
    if (!visible.length) {
      companyList.innerHTML = `<li class="empty">${emptyMessage()}</li>`;
      csvBtn.disabled = !companies.length;
      renderStats();
      updateSelectionUI();
      return;
    }
    companyList.innerHTML = visible.map(renderCompany).join("");
    csvBtn.disabled = false;
    renderStats();
    updateSelectionUI();
  }

  function upsertCompany(company) {
    if (!company || !company.hasContact) return;
    if (!company.email && !company.phone) return;
    const key = companyKey(company);
    const already = isContacted(key);
    rememberCompany(company, { fromScan: true });
    const index = companies.findIndex((row) => companyKey(row) === key);
    const merged = companyMemory[key] || company;
    if (index >= 0) companies[index] = { ...merged };
    else companies.push({ ...merged });
    // Re-trier : non contactées d'abord
    companies.sort((a, b) => {
      const aDone = isContacted(companyKey(a)) ? 1 : 0;
      const bDone = isContacted(companyKey(b)) ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || ""));
    });
    renderList();
    if (already) {
      log(`${company.name} — déjà contactée (signalée automatiquement).`, { quiet: true });
    }
  }

  function renderSectorOptions(sectors) {
    const current = sectorSelect.value || "cinema";
    const list = [...sectors];
    if (!list.some((s) => s.id === "tous")) list.unshift({ id: "tous", label: "Tous les secteurs" });
    sectorSelect.innerHTML = list.map((sector) => (
      `<option value="${escapeHtml(sector.id)}">${escapeHtml(sector.label)}</option>`
    )).join("");
    sectorSelect.value = [...sectorSelect.options].some((o) => o.value === current) ? current : "cinema";
  }

  async function loadSectors() {
    try {
      const response = await fetch(`${API_PREFIX}/api/prospection/sectors`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      renderSectorOptions(data.sectors?.length ? data.sectors : FALLBACK_SECTORS);
    } catch {
      renderSectorOptions(FALLBACK_SECTORS);
    }
  }

  async function isServerReady({ retries = 4, delayMs = 750 } = {}) {
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        const response = await fetch(`${API_PREFIX}/api/health`, { cache: "no-store" });
        if (response.ok) return true;
      } catch {
        // réseau instable ou serveur momentanément indisponible
      }
      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return false;
  }

  async function warnIfFileModeWithoutServer() {
    if (!IS_FILE_MODE) return;
    const ready = await isServerReady();
    const banner = document.getElementById("fileModeBanner");
    if (banner) banner.hidden = ready;
  }

  async function refreshServerStatus({ silent } = {}) {
    const offlineBanner = document.getElementById("serverOfflineBanner");
    if (IS_FILE_MODE || !offlineBanner) return false;
    if (!silent) {
      statusLine.textContent = "Vérification de la connexion au serveur…";
    }
    const ready = await isServerReady();
    offlineBanner.hidden = ready;
    if (ready) {
      statusLine.textContent = "Serveur connecté — prêt pour le sondage.";
    } else if (!silent) {
      statusLine.textContent = "Connexion impossible pour le moment — vérifiez le réseau ou réessayez.";
    }
    return ready;
  }

  function startServerWatch() {
    if (IS_FILE_MODE) return;
    window.addEventListener("online", () => {
      refreshServerStatus();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refreshServerStatus({ silent: true });
    });
    window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      refreshServerStatus({ silent: true });
    }, 45000);
  }

  function selectedSector() {
    return sectorSelect.value;
  }

  function handleEvent(event) {
    if (event.type === "progress") {
      setProgress(event.percent, event.label || progressLabel.textContent);
      return;
    }
    if (event.type === "status") {
      log(event.message, { quiet: true });
      return;
    }
    if (event.type === "company" || event.type === "contact") {
      upsertCompany(event.company);
      return;
    }
    if (event.type === "done") {
      const incoming = (event.companies || []).filter((c) => c.hasContact && (c.email || c.phone));
      incoming.forEach((c) => rememberCompany(c, { fromScan: true }));
      rebuildCompaniesList();
      searchDone = true;
      listFilter = "todo";
      saveFilter();
      renderList();
      const summary = event.summary || {};
      const daysLabel = daysLabelFromValue(summary.daysUsed || summary.days);
      const todo = companies.filter((c) => !isContacted(companyKey(c))).length;
      const done = companies.filter((c) => isContacted(companyKey(c))).length;
      const newThisRun = incoming.filter((c) => !isContacted(companyKey(c))).length;
      const alreadyThisRun = incoming.filter((c) => isContacted(companyKey(c))).length;
      recordScanRun(summary, incoming);
      renderStats({
        scanned: summary.scanned || 0,
        daysLabel: daysLabel
      });
      renderDashboard();
      setProgress(100, `${todo} à contacter · ${done} déjà contactées`);
      hideProgressSoon();
      if (alreadyThisRun) {
        log(`Sondage : ${alreadyThisRun} déjà contactée(s) signalée(s) auto · ${newThisRun} à traiter.`, { quiet: true });
      } else if (todo) {
        log(`Sondage terminé — ${todo} entreprise(s) à contacter en mémoire.`, { quiet: true });
      } else if (!companies.length) {
        log("Aucun contact validé. Essayez Tous les secteurs, Moins de 2 ans, ou France entière.", { quiet: true });
      } else {
        log("Toutes les entreprises en mémoire sont déjà contactées.", { quiet: true });
      }
      runBtn.textContent = "Lancer le sondage";
      return;
    }
    if (event.type === "error") {
      setProgress(0, event.message || "Erreur");
      runBtn.textContent = "Lancer le sondage";
    }
  }

  function consumeSseChunk(buffer, chunk) {
    const next = `${buffer}${chunk}`;
    const parts = next.split(/\n\n/);
    const rest = parts.pop() || "";
    for (const part of parts) {
      const dataLine = part
        .split("\n")
        .map((line) => line.trimEnd())
        .find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const raw = dataLine.replace(/^data:\s?/, "");
      if (!raw || raw === "[DONE]") continue;
      try {
        handleEvent(JSON.parse(raw));
      } catch {
        // ignore malformed chunks
      }
    }
    return rest;
  }

  async function run() {
    saveSender();
    const sector = selectedSector();
    if (!sector) return;
    if (!(await isServerReady())) {
      setProgress(0, "Serveur inaccessible — backend prospection arrêté");
      await refreshServerStatus();
      return;
    }

    const myToken = ++runToken;
    if (streamAbort) {
      streamAbort.abort();
      streamAbort = null;
    }

    // Ne pas effacer la mémoire : on garde les non contactées déjà scannées
    // et on signale automatiquement les déjà contactées.
    selectedKeys.clear();
    editedMails = {};
    searchDone = false;
    listFilter = "todo";
    saveFilter();
    rebuildCompaniesList();
    renderList();
    const keptTodo = companies.filter((c) => !isContacted(companyKey(c))).length;
    const keptDone = companies.filter((c) => isContacted(companyKey(c))).length;
    if (keptTodo || keptDone) {
      renderStats({ todoLabel: "encore à contacter" });
    }
    logBox.textContent = "";
    logBox.classList.remove("visible");
    if (keptTodo || keptDone) {
      log(`Mémoire : ${keptTodo} à contacter · ${keptDone} déjà contactées — recherche de nouveaux contacts…`, { quiet: true });
    }
    runBtn.textContent = "Relancer";
    setProgress(3, "Démarrage du sondage…");

    const daysValue = daysSelect.value === "730" ? "730" : "365";
    daysSelect.value = daysValue;
    scanStartedAt = new Date().toISOString();
    const params = new URLSearchParams({
      sector,
      days: daysValue,
      limit: daysValue === "730" ? "50" : "40",
      department: departmentInput.value.trim(),
      senderName: senderName.value.trim(),
      senderEmail: senderEmail.value.trim(),
      senderPhone: senderPhone.value.trim()
    });

    const controller = new AbortController();
    streamAbort = controller;
    try {
      const response = await fetch(`${API_PREFIX}/api/prospection/stream?${params.toString()}`, {
        headers: { Accept: "text/event-stream" },
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (myToken !== runToken) break;
        buffer = consumeSseChunk(buffer, decoder.decode(value, { stream: true }));
      }
      if (myToken === runToken && buffer.trim()) consumeSseChunk(`${buffer}\n\n`, "");
    } catch (error) {
      if (error?.name !== "AbortError" && myToken === runToken) {
        setProgress(0, `Connexion interrompue : ${error instanceof Error ? error.message : "inconnue"}`);
      }
    } finally {
      if (myToken === runToken) {
        streamAbort = null;
        runBtn.textContent = "Lancer le sondage";
      }
    }
  }

  function exportCsv() {
    const header = ["nom", "activite", "siren", "creation", "adresse", "email", "telephone", "dirigeant", "source_contact", "statut"];
    const rows = companies.map((c) => [
      c.name, c.activity, c.siren, c.createdAt, c.address, c.email, c.phone,
      (c.directors || []).join(" | "), c.contactSource,
      isContacted(companyKey(c)) ? "deja_contacte" : "a_contacter"
    ]);
    const csv = [header, ...rows]
      .map((line) => line.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "prospection-contacts.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function loadTemplate() {
    const saved = localStorage.getItem(TEMPLATE_KEY);
    if (saved) mailTemplate.value = saved;
  }

  function saveTemplate() {
    localStorage.setItem(TEMPLATE_KEY, mailTemplate.value);
    log("Modèle sauvegardé.", { quiet: true });
  }

  function previewMail() {
    const pool = filteredCompanies().length ? filteredCompanies() : companies;
    if (!pool.length) {
      log("Lancez d’abord un sondage.", { quiet: true });
      return;
    }
    mailPreviewContent.textContent = getMailForCompany(pool[0]);
    mailPreview.classList.add("visible");
  }

  function sendOne(key) {
    const company = companies.find((c) => companyKey(c) === key);
    if (!company || !company.email) {
      log("Pas d’e-mail public pour cette entreprise.", { quiet: true });
      return;
    }
    const body = getMailForCompany(company);
    openMailto(company, body);
    markContacted(company, "mail");
    selectedKeys.delete(key);
    renderList();
    log(`Brouillon mail ouvert pour ${company.name} — relisez puis envoyez.`, { quiet: true });
  }

  function openMessage(key) {
    const company = companies.find((c) => companyKey(c) === key);
    if (!company || !company.phone) {
      log("Pas de téléphone public pour cette entreprise.", { quiet: true });
      return;
    }
    const body = getMailForCompany(company);
    const ok = openSmsDraft(company, body);
    if (!ok) {
      log("Impossible d’ouvrir Messages pour ce numéro.", { quiet: true });
      return;
    }
    markContacted(company, "sms");
    selectedKeys.delete(key);
    renderList();
    log(`Brouillon Messages ouvert pour ${company.name} — relisez puis envoyez.`, { quiet: true });
  }

  async function sendMass() {
    const toSend = companies.filter((c) => c.hasContact && c.email && selectedKeys.has(companyKey(c)) && !isContacted(companyKey(c)));
    if (!toSend.length) {
      log("Sélectionnez au moins un contact avec e-mail à contacter.", { quiet: true });
      return;
    }
    const ok = window.confirm(`Ouvrir ${toSend.length} mail(s) personnalisé(s) en brouillon ?\n(un onglet / fenêtre par entreprise — à relire puis envoyer)`);
    if (!ok) return;
    let sent = 0;
    for (const company of toSend) {
      openMailto(company, getMailForCompany(company));
      markContacted(company, "mail");
      selectedKeys.delete(companyKey(company));
      sent += 1;
      await new Promise((r) => setTimeout(r, 450));
    }
    renderList();
    log(`${sent} brouillon(s) mail ouverts — vérifiez avant d’envoyer.`, { quiet: true });
  }

  filterTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-filter]");
    if (!tab) return;
    setListFilter(tab.getAttribute("data-filter"), { scrollToList: true });
  });

  statsBox.addEventListener("click", (event) => {
    const stat = event.target.closest("[data-filter]");
    if (!stat) return;
    setListFilter(stat.getAttribute("data-filter"), { scrollToList: true });
  });

  statsBox.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const stat = event.target.closest("[data-filter]");
    if (!stat) return;
    event.preventDefault();
    setListFilter(stat.getAttribute("data-filter"), { scrollToList: true });
  });

  companyList.addEventListener("change", (event) => {
    const cb = event.target.closest("[data-select]");
    if (!cb) return;
    const key = cb.getAttribute("data-select");
    if (cb.checked) selectedKeys.add(key);
    else selectedKeys.delete(key);
    updateSelectionUI();
  });

  companyList.addEventListener("click", (event) => {
    const smsBtn = event.target.closest("[data-open-sms]");
    if (smsBtn) {
      openMessage(smsBtn.getAttribute("data-open-sms"));
      return;
    }
    const sendBtn = event.target.closest("[data-send-one]");
    if (sendBtn) {
      sendOne(sendBtn.getAttribute("data-send-one"));
      return;
    }
    const markBtn = event.target.closest("[data-mark]");
    if (markBtn) {
      const key = markBtn.getAttribute("data-mark");
      const company = companies.find((c) => companyKey(c) === key);
      if (company) {
        markContacted(company, "manuel");
        selectedKeys.delete(key);
        renderList();
        log(`${company.name} marquée déjà contactée.`, { quiet: true });
      }
      return;
    }
    const unmarkBtn = event.target.closest("[data-unmark]");
    if (unmarkBtn) {
      const key = unmarkBtn.getAttribute("data-unmark");
      unmarkContacted(key);
      renderList();
      log("Remise dans « À contacter ».", { quiet: true });
      return;
    }
    const editBtn = event.target.closest("[data-edit-mail]");
    if (editBtn) {
      const key = editBtn.getAttribute("data-edit-mail");
      const safeId = `mail-edit-${key.replace(/[^a-zA-Z0-9]/g, "_")}`;
      const area = document.getElementById(safeId);
      if (area) area.classList.toggle("visible");
      return;
    }
    const saveBtn = event.target.closest("[data-save-mail]");
    if (saveBtn) {
      const key = saveBtn.getAttribute("data-save-mail");
      const textarea = companyList.querySelector(`textarea[data-mail-key="${key}"]`);
      if (textarea) {
        editedMails[key] = textarea.value;
        log("Message enregistré.", { quiet: true });
      }
    }
  });

  selectAllCb.addEventListener("change", () => {
    const mailable = filteredCompanies().filter((c) => c.hasContact && c.email && !isContacted(companyKey(c)));
    if (selectAllCb.checked) mailable.forEach((c) => selectedKeys.add(companyKey(c)));
    else selectedKeys.clear();
    renderList();
  });

  massEditBtn.addEventListener("click", () => {
    companyList.querySelectorAll(".mail-edit-area").forEach((area) => {
      const key = area.id.replace("mail-edit-", "");
      const company = companies.find((c) => companyKey(c).replace(/[^a-zA-Z0-9]/g, "_") === key);
      if (company && company.email && !isContacted(companyKey(company))) area.classList.add("visible");
    });
  });

  massSendBtn.addEventListener("click", () => { sendMass(); });
  runBtn.addEventListener("click", run);
  csvBtn.addEventListener("click", exportCsv);
  previewMailBtn.addEventListener("click", previewMail);
  saveTemplateBtn.addEventListener("click", saveTemplate);
  [senderName, senderEmail, senderPhone].forEach((input) => input.addEventListener("change", saveSender));

  const scrollTopBtn = document.getElementById("scrollTopBtn");
  window.addEventListener("scroll", () => {
    scrollTopBtn.classList.toggle("visible", window.scrollY > 400);
  }, { passive: true });
  scrollTopBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  function seedDemoCompanies() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") !== "1") return;
    const demoRows = [
      {
        name: "Lune Prod SARL",
        siren: "900111222",
        activity: "Production de films",
        naf: "5911C",
        nafLabel: "Production de films",
        createdAt: "2026-06-01",
        address: "12 rue du Soleil, 75011 Paris",
        city: "Paris",
        postalCode: "75011",
        directors: ["Alice Martin"],
        phone: "06 12 34 56 78",
        email: "",
        hasContact: true,
        contactSource: "démo téléphone"
      },
      {
        name: "Soleil Édition",
        siren: "900333444",
        activity: "Édition audiovisuelle",
        naf: "5913A",
        nafLabel: "Édition",
        createdAt: "2026-07-15",
        address: "8 avenue Orange, 75010 Paris",
        city: "Paris",
        postalCode: "75010",
        directors: ["Bruno Dupont"],
        phone: "",
        email: "contact@soleil-edition.example",
        hasContact: true,
        contactSource: "démo e-mail"
      }
    ];
    demoRows.forEach((c) => rememberCompany(c, { fromScan: true }));
    rebuildCompaniesList();
    searchDone = true;
    renderList();
    log("Mode démo — mémoire + Message/Mail adaptatif.", { quiet: true });
  }

  historyBtn.addEventListener("click", () => toggleHistory());
  historyCloseBtn.addEventListener("click", () => toggleHistory(false));
  historyClearBtn.addEventListener("click", () => {
    if (!contactedEntries().length && !Object.keys(companyMemory).length && !scanRuns.length) return;
    if (!window.confirm("Vider l’historique des contactées, la mémoire des entreprises scannées et les sondages du tableau de bord ?")) return;
    contactedMap = {};
    companyMemory = {};
    scanRuns = [];
    saveContacted();
    saveScanMemory();
    saveScanRuns();
    rebuildCompaniesList();
    renderHistory();
    renderList();
    renderDashboard();
    log("Historique, mémoire des scans et tableau de bord vidés.", { quiet: true });
  });
  historyList.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-history-remove]");
    if (!btn) return;
    const key = btn.getAttribute("data-history-remove");
    unmarkContacted(key);
    renderHistory();
    renderList();
  });

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => setAppView(btn.getAttribute("data-view")));
  });
  if (dashGoProspection) {
    dashGoProspection.addEventListener("click", () => setAppView("prospection"));
  }

  const serverRetryBtn = document.getElementById("serverRetryBtn");
  if (serverRetryBtn) {
    serverRetryBtn.addEventListener("click", () => {
      refreshServerStatus();
    });
  }

  loadSender();
  loadTemplate();
  loadContacted();
  loadScanMemory();
  loadScanRuns();
  loadFilter();
  loadSectors();
  warnIfFileModeWithoutServer();
  refreshServerStatus();
  startServerWatch();
  rebuildCompaniesList();
  if (companies.length) {
    const todoCount = companies.filter((c) => !isContacted(companyKey(c))).length;
    if (todoCount > 0) {
      listFilter = "todo";
      saveFilter();
    }
    searchDone = true;
  }
  renderList();
  seedDemoCompanies();
  setAppView("dashboard");
})();
