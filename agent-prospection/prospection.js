(() => {
  const sectorSelect = document.getElementById("sectorSelect");
  const sectorCustom = document.getElementById("sectorCustom");
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

  const STORAGE_KEY = "prospection-sender";
  const TEMPLATE_KEY = "prospection-mail-template";
  const FALLBACK_SECTORS = [
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
  let selectedKeys = new Set();
  let editedMails = {};
  let streamAbort = null;

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

  function log(message) {
    const stamp = new Date().toLocaleTimeString("fr-FR");
    const line = `[${stamp}] ${message}`;
    const current = logBox.textContent === "En attente d\u2019un secteur\u2026" ? "" : `${logBox.textContent}\n`;
    logBox.textContent = `${current}${line}`.trim();
    logBox.scrollTop = logBox.scrollHeight;
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
      .replace(/\{adresse\}/g, company.address || "");
  }

  function getMailForCompany(company) {
    const key = companyKey(company);
    if (editedMails[key]) return editedMails[key];
    return fillTemplate(mailTemplate.value, company);
  }

  function contactBlock(company) {
    if (company.hasContact && (company.email || company.phone)) {
      const bits = [];
      if (company.email) bits.push(`<a href="mailto:${escapeHtml(company.email)}">${escapeHtml(company.email)}</a>`);
      if (company.phone) bits.push(`<a href="tel:${escapeHtml(company.phone.replace(/\s/g, ""))}">${escapeHtml(company.phone)}</a>`);
      return `<div class="contact-row"><strong>Contact v\u00e9rifi\u00e9</strong>${bits.join(" \u00b7 ")}<div class="meta">Source : ${escapeHtml(company.contactSource || "web public")} \u00b7 confiance ${escapeHtml(company.contactConfidence || "medium")}</div></div>`;
    }
    return `<div class="contact-row missing"><strong>Contact non v\u00e9rifi\u00e9</strong><span class="meta">Aucun e-mail / t\u00e9l\u00e9phone publi\u00e9 trouv\u00e9 (pas de conjecture MX). Pappers / PagesJaunes / site officiel vides.</span></div>`;
  }

  function renderCompany(company) {
    const key = companyKey(company);
    const checked = selectedKeys.has(key) ? "checked" : "";
    const canSelect = Boolean(company.hasContact && company.email);
    const chip = company.hasContact
      ? `<span class="chip ok">v\u00e9rifi\u00e9</span>`
      : `<span class="chip">sans contact public</span>`;
    const directors = (company.directors || []).length ? `<div>Dirigeant : ${escapeHtml(company.directors.join(", "))}</div>` : "";
    const rawActivity = company.activity || "";
    const shortActivity = rawActivity.length > 180 ? `${rawActivity.slice(0, 180)}\u2026` : rawActivity;
    const activity = company.nafLabel
      ? `${escapeHtml(shortActivity)} (${escapeHtml(company.naf)} ${escapeHtml(company.nafLabel)})`
      : escapeHtml(shortActivity);
    const links = [];
    if (company.sireneUrl) links.push(`<a class="btn btn-ghost" href="${escapeHtml(company.sireneUrl)}" target="_blank" rel="noopener">Annuaire officiel</a>`);
    if (company.pappersUrl) links.push(`<a class="btn btn-ghost" href="${escapeHtml(company.pappersUrl)}" target="_blank" rel="noopener">Pappers</a>`);
    if (company.bodaccUrl) links.push(`<a class="btn btn-ghost" href="${escapeHtml(company.bodaccUrl)}" target="_blank" rel="noopener">Annonce BODACC</a>`);
    if (company.website) links.push(`<a class="btn btn-ghost" href="${escapeHtml(company.website)}" target="_blank" rel="noopener">Site</a>`);
    if (canSelect) links.push(`<button class="btn btn-ghost" type="button" data-edit-mail="${escapeHtml(key)}">Voir / modifier le mail</button>`);

    const mailContent = getMailForCompany(company);
    const editId = `mail-edit-${escapeHtml(key).replace(/[^a-zA-Z0-9]/g, "_")}`;

    return `<li class="company-card" data-key="${escapeHtml(key)}">
      <div class="company-card-header">
        ${canSelect ? `<input type="checkbox" class="select-cb" data-select="${escapeHtml(key)}" ${checked}>` : ""}
        <h3>${escapeHtml(company.name)}${chip}</h3>
      </div>
      <div class="meta">
        <div>Activit\u00e9 : ${activity}</div>
        <div>Cr\u00e9ation : ${escapeHtml(company.createdAt || company.publishedAt || "n.c.")}${company.siren ? ` \u00b7 SIREN ${escapeHtml(company.siren)}` : ""}</div>
        <div>Adresse : ${escapeHtml(company.address || `${company.postalCode || ""} ${company.city || ""}`.trim() || "n.c.")}</div>
        ${directors}
      </div>
      ${contactBlock(company)}
      <div class="actions">${links.join("")}</div>
      <div class="mail-edit-area" id="${editId}">
        <textarea data-mail-key="${escapeHtml(key)}" style="width:100%;min-height:140px;font-size:.82rem">${escapeHtml(mailContent)}</textarea>
        <div class="actions">
          <button class="btn btn-ghost" type="button" data-save-mail="${escapeHtml(key)}">Enregistrer les modifications</button>
          ${company.email ? `<a class="btn btn-primary" href="mailto:${escapeHtml(company.email)}?subject=${encodeURIComponent("Proposition d\u2019accompagnement comptable \u2014 " + company.name)}&body=${encodeURIComponent(mailContent)}">Envoyer ce mail</a>` : ""}
        </div>
      </div>
    </li>`;
  }

  function updateSelectionUI() {
    const contactCompanies = companies.filter((c) => c.hasContact && c.email);
    selectedCount.textContent = String(selectedKeys.size);
    massMailBar.style.display = contactCompanies.length ? "flex" : "none";
    massSendBtn.disabled = selectedKeys.size === 0;
    selectAllCb.checked = contactCompanies.length > 0 && contactCompanies.every((c) => selectedKeys.has(companyKey(c)));
  }

  function renderList() {
    if (!companies.length) {
      companyList.innerHTML = `<li class="empty">Aucun r\u00e9sultat pour le moment. Choisissez un secteur puis lancez l\u2019agent.</li>`;
      csvBtn.disabled = true;
      massMailBar.style.display = "none";
      return;
    }
    companyList.innerHTML = companies.map(renderCompany).join("");
    csvBtn.disabled = false;
    const withContact = companies.filter((c) => c.hasContact).length;
    statsBox.innerHTML = `
      <div class="stat"><b>${companies.length}</b> entreprises</div>
      <div class="stat"><b>${withContact}</b> contacts v\u00e9rifi\u00e9s</div>
    `;
    updateSelectionUI();
  }

  function upsertCompany(company) {
    const key = companyKey(company);
    const index = companies.findIndex((row) => companyKey(row) === key);
    if (index >= 0) companies[index] = company;
    else companies.push(company);
    renderList();
  }

  function renderSectorOptions(sectors) {
    sectorSelect.innerHTML = sectors.map((sector) => (
      `<option value="${escapeHtml(sector.id)}">${escapeHtml(sector.label)}</option>`
    )).join("");
  }

  async function loadSectors() {
    try {
      const response = await fetch(`${API_PREFIX}/api/prospection/sectors`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      renderSectorOptions(data.sectors?.length ? data.sectors : FALLBACK_SECTORS);
    } catch (error) {
      renderSectorOptions(FALLBACK_SECTORS);
      if (!IS_FILE_MODE) {
        log(`Secteurs disponibles (API indisponible : ${error.message})`);
      }
    }
  }

  async function isServerReady() {
    try {
      const response = await fetch(`${API_PREFIX}/api/health`, { cache: "no-store" });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function warnIfFileModeWithoutServer() {
    if (!IS_FILE_MODE) return;
    const ready = await isServerReady();
    const banner = document.getElementById("fileModeBanner");
    if (banner) banner.hidden = ready;
    if (ready) {
      log("Fichier local détecté — serveur trouvé sur http://localhost:3000");
      return;
    }
    log("Fichier HTML ouvert sans serveur. Lancez : npm install && npm start");
    log("Puis ouvrez http://localhost:3000/prospection (recommandé).");
  }

  function selectedSector() {
    const custom = sectorCustom.value.trim();
    return custom || sectorSelect.value;
  }

  function handleEvent(event) {
    if (event.type === "status") {
      log(event.message);
      return;
    }
    if (event.type === "company" || event.type === "contact") {
      upsertCompany(event.company);
      if (event.type === "contact") {
        log(event.company.hasContact
          ? `Contact v\u00e9rifi\u00e9 pour ${event.company.name}`
          : `Pas de contact public v\u00e9rifi\u00e9 pour ${event.company.name}`);
      }
      return;
    }
    if (event.type === "done") {
      companies = event.companies || companies;
      renderList();
      const summary = event.summary || {};
      statsBox.innerHTML = `
        <div class="stat"><b>${summary.found || companies.length}</b> entreprises</div>
        <div class="stat"><b>${summary.withContact || 0}</b> contacts v\u00e9rifi\u00e9s</div>
        <div class="stat">BODACC brut : <b>${summary.totalBodacc || 0}</b></div>
      `;
      log(`Termin\u00e9 \u2014 ${summary.found || 0} entreprises, ${summary.withContact || 0} contacts publics.`);
      runBtn.disabled = false;
      return;
    }
    if (event.type === "error") {
      log(`Erreur : ${event.message}`);
      runBtn.disabled = false;
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
      } catch (error) {
        log(`\u00c9v\u00e9nement illisible : ${error instanceof Error ? error.message : "inconnue"}`);
      }
    }
    return rest;
  }

  async function run() {
    saveSender();
    const sector = selectedSector();
    if (!sector) {
      log("Choisissez un secteur.");
      return;
    }
    if (!(await isServerReady())) {
      log("Serveur inaccessible.");
      log("Dans le dossier du projet : npm install && npm start");
      log("Puis ouvrez http://localhost:3000/prospection");
      return;
    }
    if (streamAbort) {
      streamAbort.abort();
      streamAbort = null;
    }
    companies = [];
    selectedKeys.clear();
    editedMails = {};
    renderList();
    statsBox.innerHTML = "";
    logBox.textContent = "";
    runBtn.disabled = true;
    const params = new URLSearchParams({
      sector,
      days: daysSelect.value,
      limit: "40",
      department: departmentInput.value.trim(),
      senderName: senderName.value.trim(),
      senderEmail: senderEmail.value.trim(),
      senderPhone: senderPhone.value.trim()
    });
    log(`D\u00e9marrage \u2014 secteur \u00ab ${sector} \u00bb.`);
    const controller = new AbortController();
    streamAbort = controller;
    try {
      // fetch + ReadableStream traverse mieux Cloudflare que EventSource (moins de buffering).
      const response = await fetch(`${API_PREFIX}/api/prospection/stream?${params.toString()}`, {
        headers: { Accept: "text/event-stream" },
        cache: "no-store",
        signal: controller.signal
      });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer = consumeSseChunk(buffer, decoder.decode(value, { stream: true }));
      }
      if (buffer.trim()) consumeSseChunk(`${buffer}\n\n`, "");
    } catch (error) {
      if (error?.name !== "AbortError") {
        log(`Connexion interrompue : ${error instanceof Error ? error.message : "inconnue"}`);
        log("V\u00e9rifiez que npm start tourne, puis relancez.");
      }
    } finally {
      if (streamAbort === controller) streamAbort = null;
      runBtn.disabled = false;
    }
  }

  function exportCsv() {
    const header = ["nom", "activite", "siren", "creation", "adresse", "email", "telephone", "dirigeant", "source_contact"];
    const rows = companies.map((c) => [
      c.name, c.activity, c.siren, c.createdAt, c.address, c.email, c.phone,
      (c.directors || []).join(" | "), c.contactSource
    ]);
    const csv = [header, ...rows]
      .map((line) => line.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(";"))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "prospection-entreprises.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function loadTemplate() {
    const saved = localStorage.getItem(TEMPLATE_KEY);
    if (saved) mailTemplate.value = saved;
  }

  function saveTemplate() {
    localStorage.setItem(TEMPLATE_KEY, mailTemplate.value);
    log("Mod\u00e8le de mail sauvegard\u00e9.");
  }

  function previewMail() {
    if (!companies.length) {
      log("Lancez d\u2019abord une recherche pour pr\u00e9visualiser le mail.");
      return;
    }
    const filled = fillTemplate(mailTemplate.value, companies[0]);
    mailPreviewContent.textContent = filled;
    mailPreview.classList.add("visible");
  }

  companyList.addEventListener("change", (event) => {
    const cb = event.target.closest("[data-select]");
    if (!cb) return;
    const key = cb.getAttribute("data-select");
    if (cb.checked) selectedKeys.add(key);
    else selectedKeys.delete(key);
    updateSelectionUI();
  });

  companyList.addEventListener("click", (event) => {
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
        log(`Mail modifi\u00e9 pour ${key}.`);
      }
    }
  });

  selectAllCb.addEventListener("change", () => {
    const contactCompanies = companies.filter((c) => c.hasContact && c.email);
    if (selectAllCb.checked) {
      contactCompanies.forEach((c) => selectedKeys.add(companyKey(c)));
    } else {
      selectedKeys.clear();
    }
    renderList();
  });

  massEditBtn.addEventListener("click", () => {
    const areas = companyList.querySelectorAll(".mail-edit-area");
    const anyVisible = [...areas].some((a) => a.classList.contains("visible"));
    areas.forEach((a) => {
      const key = a.id.replace("mail-edit-", "");
      const company = companies.find((c) => companyKey(c).replace(/[^a-zA-Z0-9]/g, "_") === key);
      if (company && company.hasContact) {
        if (anyVisible) a.classList.remove("visible");
        else a.classList.add("visible");
      }
    });
  });

  massSendBtn.addEventListener("click", () => {
    const toSend = companies.filter((c) => c.hasContact && c.email && selectedKeys.has(companyKey(c)));
    if (!toSend.length) {
      log("Aucun contact v\u00e9rifi\u00e9 s\u00e9lectionn\u00e9. Les e-mails conjecturaux ne sont plus propos\u00e9s.");
      return;
    }
    let sent = 0;
    for (const company of toSend) {
      const body = getMailForCompany(company);
      const subject = `Proposition d\u2019accompagnement comptable \u2014 ${company.name}`;
      const mailto = `mailto:${company.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      const a = document.createElement("a");
      a.href = mailto;
      a.target = "_blank";
      a.rel = "noopener";
      a.click();
      sent += 1;
    }
    log(`${sent} mail(s) pr\u00eats (contacts v\u00e9rifi\u00e9s uniquement). V\u00e9rifiez encore une fois avant d\u2019envoyer.`);
  });

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

  loadSender();
  loadTemplate();
  loadSectors();
  warnIfFileModeWithoutServer();
})();
