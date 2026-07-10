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
    connectWebSocket();
    setInterval(loadDashboard, 60000);
  } catch (e) {
    document.getElementById("recommendations").innerHTML =
      `<p class="empty">Connexion au serveur… (${e.message})</p>`;
    setTimeout(() => location.reload(), 5000);
  }
})();
