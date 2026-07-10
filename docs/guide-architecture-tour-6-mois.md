# Guide rapide — Tour NVIDIA autonome 6 mois (sans onduleur)

Architecture : **Tour (Pinokio)** + **VPS OVH (watchdog)** + **Laptop Snapdragon (terminal)**.

Sans onduleur, la prise connectée + le watchdog VPS remplacent la protection électrique.

---

## Vue d'ensemble

```
[Laptop Snapdragon] ──Tailscale──┐
                                 ├── [VPS OVH] ── watchtower-watchdog.py
[Tour NVIDIA]      ──Tailscale──┘         │
     │                                    │ hard reset si gel
     └── Prise connectée ◄────────────────┘
```

| Machine | Rôle |
|---------|------|
| Tour | Pinokio + GPU NVIDIA + pinokio-remote |
| VPS OVH | Watchdog 24/7 + notifications Discord |
| Laptop | Navigateur (Pinokio) + Parsec (bureau) |

---

## SAMEDI — Survie matérielle (30 min)

### Étape 1 — BIOS (CRITIQUE, 5 min)

1. Redémarrez la tour → touche **Del** / **F2** / **F12** (selon carte mère)
2. Cherchez : **Restore on AC Power Loss** / **After Power Failure**
3. Réglez sur **Power On** (pas Last State)
4. Sauvegardez et quittez

**Test :** coupez le courant 10 secondes, rebranchez → la tour doit redémarrer seule.

### Étape 2 — Prise connectée (15 min)

1. Achetez une prise **Shelly Plug S** (API HTTP locale simple) ou Meross/Tuya
2. Branchez : **Mur → Prise connectée → Tour** (pas d'onduleur)
3. Configurez la prise sur le **même Wi-Fi** que la box (pour l'API locale Shelly)
4. Notez l'IP locale de la prise (app Shelly → Device Info)

### Étape 3 — Windows auto-login (10 min)

1. **Win+R** → `netplwiz` → décochez « Les utilisateurs doivent entrer un mot de passe »
2. Ou téléchargez **Sysinternals Autologon** : https://learn.microsoft.com/sysinternals/downloads/autologon
3. PowerShell Admin :

```powershell
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change monitor-timeout-ac 15
powercfg /hibernate off
```

4. Lancez `scripts/tower-watchdog/setup-tower.ps1` en Admin

### Étape 4 — Pinokio + test GPU (30–60 min)

1. Installez Pinokio : https://pinokio.computer
2. Installez un modèle vidéo (ex. Wan2GP) et lancez une génération test
3. Clonez ce repo sur la tour :

```powershell
git clone https://github.com/urdirditfurd/mon-site.git C:\pinokio-remote-setup
cd C:\pinokio-remote-setup\pinokio-remote
install.bat
```

4. Éditez `config.json` :
   - `password` : votre mot de passe
   - `serveo_name` : nom unique (ex. `mon-studio-ia-2026`)
5. Lancez `setup_autostart.bat`

---

## DIMANCHE — Réseau sécurisé (45 min)

### Étape 5 — Tailscale sur les 3 machines (20 min)

**Sur le VPS OVH :**

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

**Sur la tour Windows :** installez https://tailscale.com/download/windows → Connect

**Sur le laptop :** idem

**Vérification :**

```bash
# Depuis le VPS
tailscale status
ping 100.x.x.x   # IP Tailscale de la tour
```

Notez l'IP Tailscale de la tour (ex. `100.64.12.34`).

### Étape 6 — Parsec bureau à distance (10 min)

1. Tour : installez **Parsec** → créez compte → enable Hosting
2. Laptop : installez Parsec (Windows ARM ou client Web)
3. Testez la connexion via Tailscale ou Internet

### Étape 7 — Watchdog sur le VPS (15 min)

```bash
cd ~
git clone https://github.com/urdirditfurd/mon-site.git
cd mon-site/scripts/tower-watchdog
sudo cp config.example.json config.json
sudo nano config.json
```

Remplissez au minimum :

```json
{
  "tower": {
    "tailscale_ip": "100.64.12.34"
  },
  "checks": {
    "pinokio_remote_url": "http://100.64.12.34:8000/api/health"
  },
  "smart_plug": {
    "enabled": true,
    "provider": "shelly",
    "shelly_ip": "192.168.1.50"
  },
  "notifications": {
    "discord_webhook": "https://discord.com/api/webhooks/..."
  }
}
```

Installez le service :

```bash
sudo bash install-vps.sh
sudo systemctl restart tower-watchdog
journalctl -u tower-watchdog -f
```

### Étape 8 — Webhook Discord (5 min)

1. Discord → votre serveur → Paramètres → Intégrations → Webhooks → Nouveau
2. Copiez l'URL dans `config.json` → `discord_webhook`
3. Redémarrez : `sudo systemctl restart tower-watchdog`
4. Vous devez recevoir : « Watchdog démarré »

---

## Test final (15 min)

| Action | Résultat attendu |
|--------|------------------|
| Ouvrir `https://votre-nom.serveo.net` depuis le laptop | Login pinokio-remote OK |
| Parsec depuis le laptop | Bureau tour fluide |
| `ping 100.x.x.x` depuis VPS | Réponse |
| Couper prise 15s, rallumer | Tour reboot, autologin, Pinokio revient |
| Message Discord | Notification de coupure / retour |

---

## Que fait le watchdog ?

Toutes les 60 secondes, depuis le VPS :

1. **Ping** l'IP Tailscale de la tour
2. Si ping OK mais **Pinokio down** → tentative **SSH/Tailscale** pour relancer
3. Si SSH échoue → **hard reset** prise connectée (OFF 15s → ON)
4. Si **ping KO** longtemps → notification + éventuel hard reset
5. **Cooldown** 10 min entre resets + max 6/jour (évite les boucles)

---

## Accès quotidien depuis le laptop

| Besoin | Outil | URL / Commande |
|--------|-------|----------------|
| Interface Pinokio / modèles IA | pinokio-remote | `https://votre-nom.serveo.net` |
| Bureau Windows (debug) | Parsec | App Parsec |
| SSH maintenance | Tailscale SSH | `tailscale ssh tower-pc` |

---

## Dépannage rapide

| Symptôme | Cause probable | Action |
|----------|----------------|--------|
| Tour ne revient pas après coupure | BIOS mal configuré | Vérifier Power On |
| Pinokio inaccessible mais Parsec OK | Service crashé | Watchdog relance auto |
| Tout gelé, écran figé | Kernel panic | Hard reset prise (app ou watchdog) |
| serveo.net down | Tunnel SSH coupé | Passer à Cloudflare dans config pinokio-remote |
| Trop de resets | Instabilité électrique | Vérifier prise + câble Ethernet |

---

## Fichiers du repo

| Fichier | Où l'exécuter |
|---------|---------------|
| `pinokio-remote/install.bat` | Tour Windows |
| `pinokio-remote/setup_autostart.bat` | Tour Windows |
| `scripts/tower-watchdog/setup-tower.ps1` | Tour Windows (Admin) |
| `scripts/tower-watchdog/install-vps.sh` | VPS OVH (root) |
| `scripts/tower-watchdog/watchdog.py` | VPS OVH (systemd) |
