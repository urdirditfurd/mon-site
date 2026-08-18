(() => {
  const sectorSelect = document.getElementById("sectorSelect");
  const sectorCustom = document.getElementById("sectorCustom");
  const daysSelect = document.getElementById("daysSelect");
  const limitSelect = document.getElementById("limitSelect");
  const departmentInput = document.getElementById("departmentInput");
  const senderName = document.getElementById("senderName");
  const senderEmail = document.getElementById("senderEmail");
  const senderPhone = document.getElementById("senderPhone");
  const runBtn = document.getElementById("runBtn");
  const csvBtn = document.getElementById("csvBtn");
  const logBox = document.getElementById("logBox");
  const statsBox = document.getElementById("statsBox");
  const companyList = document.getElementById("companyList");

  const STORAGE_KEY = "prospection-sender";
  let companies = [];
  let eventSource = null;

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
    const current = logBox.textContent === "En attente d’un secteur…" ? "" : `${logBox.textContent}\n`;
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

  function contactBlock(company) {
    if (company.email || company.phone) {
      const bits = [];
      if (company.email) bits.push(`<a href="mailto:${escapeHtml(company.email)}">${escapeHtml(company.email)}</a>`);
      if (company.phone) bits.push(`<a href="tel:${escapeHtml(company.phone.replace(/\s/g, ""))}">${escapeHtml(company.phone)}</a>`);
      return `<div class="contact-row"><strong>Contact</strong>${bits.join(" · ")}<div class="meta">Source : ${escapeHtml(company.contactSource || "web public")}</div></div>`;
    }
    return `<div class="contact-row missing"><strong>Contact non publié</strong><span class="meta">Aucun e-mail / téléphone trouvé en source ouverte. Utilisez l’adresse postale ou l’annuaire officiel.</span></div>`;
  }

  function renderCompany(company) {
    const chip = company.hasContact
      ? `<span class="chip ok">contact</span>`
      : `<span class="chip">à qualifier</span>`;
    const directors = (company.directors || []).length ? `<div>Dirigeant : ${escapeHtml(company.directors.join(", "))}</div>` : "";
    const activity = company.nafLabel
      ? `${escapeHtml(company.activity)} (${escapeHtml(company.naf)} ${escapeHtml(company.nafLabel)})`
      : escapeHtml(company.activity);
    const links = [];
    if (company.proposal && company.proposal.mailto) {
      links.push(`<a class="btn btn-primary" href="${company.proposal.mailto}">Envoyer la proposition</a>`);
    } else {
      links.push(`<button class="btn btn-ghost" type="button" data-copy="${escapeHtml(company.siren || company.name)}">Copier la proposition</button>`);
    }
    if (company.sireneUrl) links.push(`<a class="btn btn-ghost" href="${escapeHtml(company.sireneUrl)}" target="_blank" rel="noopener">Annuaire officiel</a>`);
    if (company.bodaccUrl) links.push(`<a class="btn btn-ghost" href="${escapeHtml(company.bodaccUrl)}" target="_blank" rel="noopener">Annonce BODACC</a>`);
    if (company.website) links.push(`<a class="btn btn-ghost" href="${escapeHtml(company.website)}" target="_blank" rel="noopener">Site</a>`);
    return `<li class="company-card" data-key="${escapeHtml(company.siren || company.name)}">
      <h3>${escapeHtml(company.name)}${chip}</h3>
      <div class="meta">
        <div>Activité : ${activity}</div>
        <div>Création : ${escapeHtml(company.createdAt || company.publishedAt || "n.c.")}${company.siren ? ` · SIREN ${escapeHtml(company.siren)}` : ""}</div>
        <div>Adresse : ${escapeHtml(company.address || `${company.postalCode || ""} ${company.city || ""}`.trim() || "n.c.")}</div>
        ${directors}
      </div>
      ${contactBlock(company)}
      <div class="actions">${links.join("")}</div>
    </li>`;
  }

  function renderList() {
    if (!companies.length) {
      companyList.innerHTML = `<li class="empty">Aucun résultat pour le moment. Choisissez un secteur puis lancez l’agent.</li>`;
      csvBtn.disabled = true;
      return;
    }
    companyList.innerHTML = companies.map(renderCompany).join("");
    csvBtn.disabled = false;
    const withContact = companies.filter((c) => c.hasContact).length;
    statsBox.innerHTML = `
      <div class="stat"><b>${companies.length}</b> entreprises</div>
      <div class="stat"><b>${withContact}</b> avec e-mail ou téléphone</div>
    `;
  }

  function upsertCompany(company) {
    const key = company.siren || company.name;
    const index = companies.findIndex((row) => (row.siren || row.name) === key);
    if (index >= 0) companies[index] = company;
    else companies.push(company);
    renderList();
  }

  async function loadSectors() {
    const response = await fetch("/api/prospection/sectors");
    const data = await response.json();
    sectorSelect.innerHTML = (data.sectors || []).map((sector) => (
      `<option value="${escapeHtml(sector.id)}">${escapeHtml(sector.label)}</option>`
    )).join("");
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
          ? `Contact trouvé pour ${event.company.name}`
          : `Pas de contact public pour ${event.company.name}`);
      }
      return;
    }
    if (event.type === "done") {
      companies = event.companies || companies;
      renderList();
      const summary = event.summary || {};
      statsBox.innerHTML = `
        <div class="stat"><b>${summary.found || companies.length}</b> entreprises</div>
        <div class="stat"><b>${summary.withContact || 0}</b> avec contact</div>
        <div class="stat">BODACC brut : <b>${summary.totalBodacc || 0}</b></div>
      `;
      log(`Terminé — ${summary.found || 0} entreprises, ${summary.withContact || 0} contacts publics.`);
      runBtn.disabled = false;
      return;
    }
    if (event.type === "error") {
      log(`Erreur : ${event.message}`);
      runBtn.disabled = false;
    }
  }

  function run() {
    saveSender();
    const sector = selectedSector();
    if (!sector) {
      log("Choisissez un secteur.");
      return;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    companies = [];
    renderList();
    statsBox.innerHTML = "";
    logBox.textContent = "";
    runBtn.disabled = true;
    const params = new URLSearchParams({
      sector,
      days: daysSelect.value,
      limit: limitSelect.value,
      department: departmentInput.value.trim(),
      senderName: senderName.value.trim(),
      senderEmail: senderEmail.value.trim(),
      senderPhone: senderPhone.value.trim()
    });
    log(`Démarrage — secteur « ${sector} ».`);
    eventSource = new EventSource(`/api/prospection/stream?${params.toString()}`);
    eventSource.onmessage = (message) => {
      try {
        handleEvent(JSON.parse(message.data));
      } catch (error) {
        log(`Événement illisible : ${error instanceof Error ? error.message : "inconnue"}`);
      }
    };
    eventSource.onerror = () => {
      if (runBtn.disabled) log("Connexion interrompue. Relancez si la liste est incomplète.");
      runBtn.disabled = false;
      eventSource.close();
    };
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

  companyList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    const key = button.getAttribute("data-copy");
    const company = companies.find((row) => (row.siren || row.name) === key);
    if (!company || !company.proposal) return;
    navigator.clipboard.writeText(`${company.proposal.subject}\n\n${company.proposal.body}`);
    log(`Proposition copiée pour ${company.name}.`);
  });

  runBtn.addEventListener("click", run);
  csvBtn.addEventListener("click", exportCsv);
  [senderName, senderEmail, senderPhone].forEach((input) => input.addEventListener("change", saveSender));

  loadSender();
  loadSectors().catch((error) => log(`Impossible de charger les secteurs : ${error.message}`));
})();
