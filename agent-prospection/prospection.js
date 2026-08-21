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

  const STORAGE_KEY = "prospection-sender";
  const TEMPLATE_KEY = "prospection-mail-template";
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
  let selectedKeys = new Set();
  let editedMails = {};
  let streamAbort = null;
  let runToken = 0;
  let searchDone = false;

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

  function openMailto(company, body) {
    if (!company.email) return false;
    const mailto = `mailto:${company.email}?subject=${encodeURIComponent(mailSubject(company))}&body=${encodeURIComponent(body)}`;
    const a = document.createElement("a");
    a.href = mailto;
    a.target = "_blank";
    a.rel = "noopener";
    a.click();
    return true;
  }

  function contactBlock(company) {
    if (company.hasContact && (company.email || company.phone)) {
      const bits = [];
      if (company.email) bits.push(`<a href="mailto:${escapeHtml(company.email)}">${escapeHtml(company.email)}</a>`);
      if (company.phone) bits.push(`<a href="tel:${escapeHtml(company.phone.replace(/\s/g, ""))}">${escapeHtml(company.phone)}</a>`);
      return `<div class="contact-row"><strong>Contact validé</strong> · ${bits.join(" · ")}<div class="meta">Source : ${escapeHtml(company.contactSource || "web public")}</div></div>`;
    }
    return "";
  }

  function renderCompany(company) {
    const key = companyKey(company);
    const checked = selectedKeys.has(key) ? "checked" : "";
    const canMail = Boolean(company.hasContact && company.email);
    const chip = `<span class="chip ok">prêt à contacter</span>`;
    const directors = (company.directors || []).length
      ? `<div>Dirigeant : ${escapeHtml(company.directors.join(", "))}</div>`
      : "";
    const rawActivity = company.activity || "";
    const shortActivity = rawActivity.length > 160 ? `${rawActivity.slice(0, 160)}…` : rawActivity;
    const activity = company.nafLabel
      ? `${escapeHtml(shortActivity)} (${escapeHtml(company.naf)} ${escapeHtml(company.nafLabel)})`
      : escapeHtml(shortActivity);
    const links = [];
    if (company.website) links.push(`<a class="btn btn-ghost" href="${escapeHtml(company.website)}" target="_blank" rel="noopener">Site</a>`);
    if (company.sireneUrl) links.push(`<a class="btn btn-ghost" href="${escapeHtml(company.sireneUrl)}" target="_blank" rel="noopener">Annuaire</a>`);
    if (canMail) {
      links.push(`<button class="btn btn-ghost" type="button" data-edit-mail="${escapeHtml(key)}">Modifier le mail</button>`);
      links.push(`<button class="btn btn-primary" type="button" data-send-one="${escapeHtml(key)}">Envoyer le mail</button>`);
    } else if (company.phone) {
      links.push(`<a class="btn btn-primary" href="tel:${escapeHtml(company.phone.replace(/\s/g, ""))}">Appeler</a>`);
    }

    const mailContent = getMailForCompany(company);
    const editId = `mail-edit-${escapeHtml(key).replace(/[^a-zA-Z0-9]/g, "_")}`;

    return `<li class="company-card" data-key="${escapeHtml(key)}">
      <div class="company-card-header">
        ${canMail ? `<input type="checkbox" class="select-cb" data-select="${escapeHtml(key)}" ${checked}>` : ""}
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
        <textarea data-mail-key="${escapeHtml(key)}" style="width:100%;min-height:140px;font-size:.82rem">${escapeHtml(mailContent)}</textarea>
        <div class="actions">
          <button class="btn btn-ghost" type="button" data-save-mail="${escapeHtml(key)}">Enregistrer</button>
          ${canMail ? `<button class="btn btn-primary" type="button" data-send-one="${escapeHtml(key)}">Envoyer ce mail</button>` : ""}
        </div>
      </div>
    </li>`;
  }

  function updateSelectionUI() {
    const mailable = companies.filter((c) => c.hasContact && c.email);
    selectedCount.textContent = String(selectedKeys.size);
    massMailBar.style.display = mailable.length && searchDone ? "flex" : "none";
    massSendBtn.disabled = selectedKeys.size === 0;
    selectAllCb.checked = mailable.length > 0 && mailable.every((c) => selectedKeys.has(companyKey(c)));
  }

  function renderList() {
    if (!companies.length) {
      companyList.innerHTML = `<li class="empty">Choisissez un secteur, laissez Auto, puis lancez le sondage. Seuls les contacts validés apparaîtront ici, prêts à être contactés.</li>`;
      csvBtn.disabled = true;
      massMailBar.style.display = "none";
      return;
    }
    companyList.innerHTML = companies.map(renderCompany).join("");
    csvBtn.disabled = false;
    const withMail = companies.filter((c) => c.email).length;
    statsBox.innerHTML = `
      <div class="stat"><b>${companies.length}</b> contacts validés</div>
      <div class="stat"><b>${withMail}</b> e-mails prêts</div>
    `;
    updateSelectionUI();
  }

  function upsertCompany(company) {
    if (!company || !company.hasContact) return;
    const key = companyKey(company);
    const index = companies.findIndex((row) => companyKey(row) === key);
    if (index >= 0) companies[index] = company;
    else companies.push(company);
    renderList();
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
      companies = (event.companies || companies).filter((c) => c.hasContact);
      searchDone = true;
      renderList();
      const summary = event.summary || {};
      const daysLabel = summary.auto ? `auto → ${summary.daysUsed || "?"} j` : `${summary.days || "?"} j`;
      statsBox.innerHTML = `
        <div class="stat"><b>${summary.withContact || companies.length}</b> contacts validés</div>
        <div class="stat"><b>${summary.scanned || 0}</b> scannées</div>
        <div class="stat">Fenêtre : <b>${daysLabel}</b></div>
      `;
      setProgress(100, `${summary.withContact || companies.length} contact(s) validé(s) — mails prêts`);
      hideProgressSoon();
      if (companies.some((c) => c.email)) {
        massMailBar.style.display = "flex";
        log(`Sondage terminé — ${companies.filter((c) => c.email).length} e-mail(s) prêts à envoyer.`, { quiet: true });
      } else if (!companies.length) {
        log("Aucun contact validé. Essayez Tous les secteurs ou France entière.", { quiet: true });
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
      setProgress(0, "Serveur inaccessible — npm start requis");
      return;
    }

    const myToken = ++runToken;
    if (streamAbort) {
      streamAbort.abort();
      streamAbort = null;
    }

    companies = [];
    selectedKeys.clear();
    editedMails = {};
    searchDone = false;
    renderList();
    statsBox.innerHTML = "";
    logBox.textContent = "";
    logBox.classList.remove("visible");
    runBtn.textContent = "Relancer";
    setProgress(3, "Démarrage du sondage…");

    const daysValue = daysSelect.value || "auto";
    const isAuto = daysValue === "auto";
    const params = new URLSearchParams({
      sector,
      days: daysValue,
      limit: isAuto ? "18" : "40",
      department: departmentInput.value.trim(),
      senderName: senderName.value.trim(),
      senderEmail: senderEmail.value.trim(),
      senderPhone: senderPhone.value.trim()
    });
    if (isAuto) params.set("targetContacts", "15");

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
    if (!companies.length) {
      log("Lancez d’abord un sondage.", { quiet: true });
      return;
    }
    mailPreviewContent.textContent = getMailForCompany(companies[0]);
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
    log(`Mail prêt pour ${company.name}`, { quiet: true });
  }

  async function sendMass() {
    const toSend = companies.filter((c) => c.hasContact && c.email && selectedKeys.has(companyKey(c)));
    if (!toSend.length) {
      log("Sélectionnez au moins un contact avec e-mail.", { quiet: true });
      return;
    }
    const ok = window.confirm(`Ouvrir ${toSend.length} mail(s) personnalisé(s) dans votre client mail ?\n(un onglet / fenêtre par entreprise)`);
    if (!ok) return;
    let sent = 0;
    for (const company of toSend) {
      openMailto(company, getMailForCompany(company));
      sent += 1;
      await new Promise((r) => setTimeout(r, 450));
    }
    log(`${sent} mail(s) ouverts — vérifiez avant d’envoyer.`, { quiet: true });
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
    const sendBtn = event.target.closest("[data-send-one]");
    if (sendBtn) {
      sendOne(sendBtn.getAttribute("data-send-one"));
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
        log("Mail enregistré.", { quiet: true });
      }
    }
  });

  selectAllCb.addEventListener("change", () => {
    const mailable = companies.filter((c) => c.hasContact && c.email);
    if (selectAllCb.checked) mailable.forEach((c) => selectedKeys.add(companyKey(c)));
    else selectedKeys.clear();
    renderList();
  });

  massEditBtn.addEventListener("click", () => {
    companyList.querySelectorAll(".mail-edit-area").forEach((area) => {
      const key = area.id.replace("mail-edit-", "");
      const company = companies.find((c) => companyKey(c).replace(/[^a-zA-Z0-9]/g, "_") === key);
      if (company && company.email) area.classList.add("visible");
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

  loadSender();
  loadTemplate();
  loadSectors();
  warnIfFileModeWithoutServer();
})();
