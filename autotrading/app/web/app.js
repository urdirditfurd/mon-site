const API = "/api";

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 4000);
}

function riskClass(level) {
  if (level === "faible") return "risk-faible";
  if (level === "élevé") return "risk-élevé";
  return "";
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR");
}

async function fetchJSON(path, opts = {}) {
  const res = await fetch(`${API}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

function renderRecommendations(recs) {
  const el = document.getElementById("recommendations");
  if (!recs.length) {
    el.innerHTML = '<p class="empty">Aucune opportunité forte pour l\'instant. Revenez après le prochain scan.</p>';
    return;
  }
  el.innerHTML = recs.map((r) => `
    <article class="rec-item">
      <div class="rec-header">
        <span class="rec-rank">${r.rank}</span>
        <div>
          <div class="rec-title">${r.name}</div>
          <div class="rec-symbol">${r.symbol} · ${r.asset_type.toUpperCase()}</div>
        </div>
        <div style="text-align:right">
          <strong>${r.buy_probability}%</strong>
          <div class="rec-symbol">probabilité</div>
        </div>
      </div>
      <div class="prob-bar"><div class="prob-fill" style="width:${r.buy_probability}%"></div></div>
      <div class="tags">
        <span class="tag ${riskClass(r.risk_level)}">Risque ${r.risk_level}</span>
        <span class="tag">Gain estimé +${r.expected_gain_pct}%</span>
        <span class="tag">${r.horizon}</span>
        <span class="tag">${r.price.toFixed(2)} $</span>
      </div>
      <p class="rec-summary">${r.beginner_summary}</p>
      <button class="btn btn-sm btn-primary" onclick="followTrade('${r.symbol}')">✅ Suivre ce trade</button>
      <button class="btn btn-sm btn-outline" onclick="stageBrokerTrade('${r.symbol}', ${r.buy_probability})">🔗 Préparer ordre courtier</button>
    </article>
  `).join("");
}

function renderPositions(positions) {
  const el = document.getElementById("positions");
  if (!positions.length) {
    el.innerHTML = '<p class="empty">Aucune position. Cliquez « Suivre » sur une opportunité.</p>';
    return;
  }
  el.innerHTML = positions.map((p) => {
    const pnl = p.pnl_pct != null ? p.pnl_pct : 0;
    const pnlClass = pnl >= 0 ? "pnl-pos" : "pnl-neg";
    return `
    <article class="pos-item">
      <div class="rec-header">
        <div>
          <div class="rec-title">${p.symbol}</div>
          <div class="rec-symbol">Entrée : ${p.entry_price.toFixed(2)} → Actuel : ${(p.current_price || 0).toFixed(2)}</div>
        </div>
        <span class="${pnlClass}">${pnl >= 0 ? "+" : ""}${pnl}%</span>
      </div>
      <div class="tags">
        <span class="tag">TP +${p.take_profit_pct}%</span>
        <span class="tag">SL -${p.stop_loss_pct}%</span>
      </div>
    </article>`;
  }).join("");
}

function renderNotifications(notifs) {
  const el = document.getElementById("notifications");
  if (!notifs.length) {
    el.innerHTML = '<p class="empty">Aucune notification pour l\'instant.</p>';
    return;
  }
  el.innerHTML = notifs.map((n) => `
    <article class="notif-item ${n.is_read ? "" : "unread"}">
      <div class="rec-title">${n.title}</div>
      <p class="rec-summary">${n.body}</p>
      <div class="notif-time">${formatDate(n.created_at)}</div>
    </article>
  `).join("");
}

function renderUniverse(items) {
  const el = document.getElementById("universe");
  el.innerHTML = items.map((a) => `
    <div class="universe-chip">${a.symbol}<span>${a.name}</span></div>
  `).join("");
}

async function loadDashboard() {
  const data = await fetchJSON("/dashboard");
  document.getElementById("disclaimer").textContent = data.disclaimer;
  document.getElementById("last-scan").textContent = `Dernier scan : ${formatDate(data.last_scan_at)}`;
  renderRecommendations(data.top_opportunities);
  renderPositions(data.open_positions);
  renderNotifications(data.recent_notifications);
}

async function followTrade(symbol) {
  try {
    await fetchJSON("/positions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol }),
    });
    toast(`Position suivie sur ${symbol} — nous vous alerterons !`);
    await loadDashboard();
  } catch (e) {
    toast(`Erreur : ${e.message}`);
  }
}

window.followTrade = followTrade;

async function stageBrokerTrade(symbol, probability) {
  const amount = parseFloat(document.getElementById("broker-max")?.value || "100");
  try {
    await fetchJSON("/broker/orders/stage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol, side: "buy", amount_usd: amount, commit_message: `Signal ${probability}%` }),
    });
    toast(`Ordre ${symbol} préparé — approuvez-le ci-dessous`);
    await loadPendingOrders();
  } catch (e) {
    toast(`Erreur : ${e.message}`);
  }
}
window.stageBrokerTrade = stageBrokerTrade;

async function loadBrokerData() {
  const [exchanges, settings, accounts] = await Promise.all([
    fetchJSON("/broker/exchanges"),
    fetchJSON("/broker/settings"),
    fetchJSON("/broker/accounts").catch(() => []),
  ]);
  document.getElementById("france-notice").innerHTML =
    `<span class="broker-warn">⚠️ ${settings.france_notice}</span>`;
  const sel = document.getElementById("broker-exchange");
  sel.innerHTML = exchanges.map((e) =>
    `<option value="${e.id}">${e.name}${e.recommended_fr ? " ★ FR" : ""}${e.deprecated_fr ? " (éviter FR)" : ""}</option>`
  ).join("");
  const accEl = document.getElementById("broker-accounts");
  if (!accounts.length) {
    accEl.innerHTML = '<p class="empty">Aucun courtier connecté.</p>';
  } else {
    accEl.innerHTML = accounts.map((a) => `
      <article class="pos-item">
        <div class="rec-title">${a.label || a.exchange_id}</div>
        <div class="rec-symbol">Mode : ${a.mode} · Max : ${a.max_order_usd} USD · Auto : ${a.auto_execute ? "oui" : "non"}</div>
      </article>`).join("");
  }
}

async function loadPendingOrders() {
  const orders = await fetchJSON("/broker/orders/pending").catch(() => []);
  const el = document.getElementById("pending-orders");
  if (!orders.length) {
    el.innerHTML = '<p class="empty">Aucun ordre en attente.</p>';
    return;
  }
  el.innerHTML = orders.map((o) => `
    <article class="pos-item">
      <div class="rec-header">
        <div>
          <div class="rec-title">${o.side.toUpperCase()} ${o.symbol}</div>
          <div class="rec-symbol">${o.amount_usd} USD @ ${o.price_at_stage.toFixed(2)} · ${o.probability}%</div>
        </div>
        <span class="tag">${o.status}</span>
      </div>
      <p class="rec-summary">${o.signal_reason || o.commit_message}</p>
      <div class="hero-actions">
        <button class="btn btn-sm btn-primary" onclick="approveOrder('${o.id}')">✅ Approuver & exécuter</button>
        <button class="btn btn-sm btn-outline" onclick="rejectOrder('${o.id}')">❌ Rejeter</button>
      </div>
    </article>`).join("");
}

async function approveOrder(id) {
  try {
    await fetchJSON(`/broker/orders/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    toast("Ordre approuvé et envoyé au courtier");
    await loadPendingOrders();
  } catch (e) { toast(e.message); }
}
async function rejectOrder(id) {
  try {
    await fetchJSON(`/broker/orders/${id}/reject`, { method: "POST" });
    toast("Ordre rejeté");
    await loadPendingOrders();
  } catch (e) { toast(e.message); }
}
window.approveOrder = approveOrder;
window.rejectOrder = rejectOrder;

document.getElementById("btn-test-broker")?.addEventListener("click", async () => {
  const body = {
    exchange_id: document.getElementById("broker-exchange").value,
    api_key: document.getElementById("broker-key").value,
    api_secret: document.getElementById("broker-secret").value,
    passphrase: document.getElementById("broker-pass").value,
    mode: document.getElementById("broker-mode").value,
  };
  const res = await fetch("/api/broker/test-connection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  toast(data.ok ? "Connexion OK !" : `Échec : ${data.error}`);
});

document.getElementById("btn-connect-broker")?.addEventListener("click", async () => {
  try {
    await fetchJSON("/broker/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        exchange_id: document.getElementById("broker-exchange").value,
        api_key: document.getElementById("broker-key").value,
        api_secret: document.getElementById("broker-secret").value,
        passphrase: document.getElementById("broker-pass").value,
        mode: document.getElementById("broker-mode").value,
        max_order_usd: parseFloat(document.getElementById("broker-max").value),
        label: document.getElementById("broker-exchange").selectedOptions[0].text,
      }),
    });
    toast("Courtier connecté !");
    await loadBrokerData();
  } catch (e) { toast(e.message); }
});

document.getElementById("btn-refresh").addEventListener("click", async () => {
  const btn = document.getElementById("btn-refresh");
  btn.disabled = true;
  btn.textContent = "⏳ Analyse en cours…";
  try {
    await fetchJSON("/scan/trigger", { method: "POST" });
    toast("Marché analysé avec succès !");
    await loadDashboard();
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "🔄 Actualiser l'analyse";
  }
});

function connectWebSocket() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/api/ws`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "welcome" && msg.recommendations?.length) {
      renderRecommendations(msg.recommendations);
    }
  };
  ws.onclose = () => setTimeout(connectWebSocket, 5000);
}

(async () => {
  try {
    const universe = await fetchJSON("/universe");
    renderUniverse(universe);
    await loadDashboard();
    await loadBrokerData();
    await loadPendingOrders();
    connectWebSocket();
    setInterval(loadDashboard, 60000);
  } catch (e) {
    document.getElementById("recommendations").innerHTML =
      `<p class="empty">Connexion au serveur… (${e.message})</p>`;
    setTimeout(() => location.reload(), 5000);
  }
})();
