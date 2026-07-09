/* Pinokio Remote – Dashboard JS */
(function () {
  'use strict';

  // ── Éléments DOM ────────────────────────────────────────────────
  const grid        = document.getElementById('serviceGrid');
  const loader      = document.getElementById('loader');
  const tunnelBadge = document.getElementById('tunnelBadge');
  const tunnelDot   = document.getElementById('tunnelDot');
  const tunnelLabel = document.getElementById('tunnelLabel');
  const iframeView  = document.getElementById('iframe-view');
  const svcFrame    = document.getElementById('svc-frame');
  const backBtn     = document.getElementById('backBtn');
  const newwinBtn   = document.getElementById('newwinBtn');
  const iframeTitle = document.getElementById('iframeTitle');
  const logoutBtn   = document.getElementById('logoutBtn');
  const toast       = document.getElementById('toast');
  const tunnelModal = document.getElementById('tunnelModal');
  const modalUrl    = document.getElementById('modalUrl');
  const copyUrlBtn  = document.getElementById('copyUrlBtn');
  const openUrlBtn  = document.getElementById('openUrlBtn');
  const closeModalBtn = document.getElementById('closeModalBtn');

  let _currentSvcUrl = '';
  let _tunnelUrl     = null;
  let _toastTimer    = null;

  // ── Toast ────────────────────────────────────────────────────────
  function showToast(msg, ms = 2800) {
    if (_toastTimer) clearTimeout(_toastTimer);
    toast.textContent = msg;
    toast.classList.add('show');
    _toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
  }

  // ── Tunnel ───────────────────────────────────────────────────────
  async function refreshTunnel() {
    try {
      const r = await fetch('/api/tunnel');
      if (!r.ok) return;
      const d = await r.json();
      if (d.active && d.url) {
        _tunnelUrl = d.url;
        tunnelDot.classList.add('active');
        tunnelLabel.textContent = d.url.replace(/^https?:\/\//, '');
        tunnelBadge.title = 'Cliquer pour afficher l\'URL publique';
      } else {
        _tunnelUrl = null;
        tunnelDot.classList.remove('active');
        tunnelLabel.textContent = 'Tunnel en démarrage…';
        setTimeout(refreshTunnel, 5000);
      }
    } catch (_) {}
  }

  tunnelBadge.addEventListener('click', () => {
    if (_tunnelUrl) {
      modalUrl.textContent = _tunnelUrl;
      tunnelModal.classList.add('visible');
    } else {
      showToast('Tunnel pas encore disponible, patientez…');
    }
  });

  copyUrlBtn.addEventListener('click', () => {
    if (_tunnelUrl) {
      navigator.clipboard.writeText(_tunnelUrl).then(() => showToast('✅ URL copiée !'));
    }
  });

  openUrlBtn.addEventListener('click', () => {
    if (_tunnelUrl) window.open(_tunnelUrl, '_blank');
  });

  closeModalBtn.addEventListener('click', () => tunnelModal.classList.remove('visible'));
  tunnelModal.addEventListener('click', (e) => {
    if (e.target === tunnelModal) tunnelModal.classList.remove('visible');
  });

  // ── Services ─────────────────────────────────────────────────────
  async function loadServices() {
    try {
      const r = await fetch('/api/services');
      if (r.status === 401) { window.location.replace('/login'); return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const services = await r.json();
      renderServices(services);
    } catch (e) {
      if (loader) {
        loader.innerHTML = '<span style="color:#ff4757">Erreur de connexion au serveur.</span>';
      }
    }
  }

  function renderServices(services) {
    if (loader) loader.remove();

    // Effacer les anciennes cartes mais pas le loader
    [...grid.querySelectorAll('.svc-card')].forEach(el => el.remove());

    if (!services.length) {
      grid.insertAdjacentHTML('beforeend',
        '<p style="color:var(--muted);grid-column:1/-1;padding:2rem">Aucun service configuré dans config.json.</p>');
      return;
    }

    // Trier : actifs en premier
    services.sort((a, b) => {
      if (a.status === b.status) return 0;
      return a.status === 'running' ? -1 : 1;
    });

    for (const svc of services) {
      const running = svc.status === 'running';
      const card = document.createElement('div');
      card.className = 'svc-card' + (running ? '' : ' stopped');
      card.dataset.path = svc.path;
      card.innerHTML = `
        <div class="card-top">
          <span class="svc-icon">${svc.icon || '🤖'}</span>
          <div class="status-dot ${svc.status}" title="${running ? 'En marche' : 'Non démarré'}"></div>
        </div>
        <h3>${escHtml(svc.name)}</h3>
        <p>${escHtml(svc.description || '')}</p>
        <div class="card-footer">
          <span class="port-badge">:${svc.port}</span>
          ${running
            ? '<span class="open-label">Ouvrir →</span>'
            : '<span class="stopped-label">Non démarré dans Pinokio</span>'}
        </div>
      `;
      if (running) {
        card.addEventListener('click', () => openService(svc));
        card.title = `Ouvrir ${svc.name}`;
      } else {
        card.title = `Démarrez "${svc.name}" dans Pinokio sur la tour puis rafraîchissez`;
      }
      grid.appendChild(card);
    }
  }

  // ── Iframe ───────────────────────────────────────────────────────
  function openService(svc) {
    _currentSvcUrl = `/proxy/${svc.path}/`;
    iframeTitle.textContent = `${svc.icon || ''} ${svc.name}`;
    svcFrame.src = _currentSvcUrl;
    iframeView.classList.add('visible');
    document.title = `${svc.name} — Pinokio Remote`;
  }

  backBtn.addEventListener('click', () => {
    iframeView.classList.remove('visible');
    svcFrame.src = 'about:blank';
    _currentSvcUrl = '';
    document.title = 'Pinokio Remote';
  });

  newwinBtn.addEventListener('click', () => {
    if (_currentSvcUrl) window.open(_currentSvcUrl, '_blank');
  });

  // ── Logout ───────────────────────────────────────────────────────
  logoutBtn.addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.replace('/login');
  });

  // ── Utilitaires ──────────────────────────────────────────────────
  function escHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Init & polling ───────────────────────────────────────────────
  loadServices();
  refreshTunnel();

  // Rafraîchissement auto du statut des services toutes les 30s
  setInterval(loadServices, 30_000);
  // Rafraîchissement du tunnel toutes les 8s jusqu'à ce qu'il soit actif
  setInterval(() => {
    if (!_tunnelUrl) refreshTunnel();
  }, 8_000);

})();
