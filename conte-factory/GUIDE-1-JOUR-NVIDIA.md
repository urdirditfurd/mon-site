# Plan 1 jour — PC tour NVIDIA (trame d’origine)

> **Guide principal mis à jour :** voir [`PLAN-1-JOUR-COMPLET.md`](PLAN-1-JOUR-COMPLET.md)  
> Wan se lance **automatiquement** avec l’icône Bureau **video ia** — plus besoin de `LANCER-WAN-NVIDIA.bat`.

Objectif : pipeline YouTube contes **30 min+**  
`Script → Storyboard → Vidéo IA + Audio → Montage → Publication auto → Dashboard`

Moteur vidéo : **Wan 2.1** sur ta **carte NVIDIA** (beaucoup plus rapide qu’en CPU).

---

## Améliorations gardées (sans changer la trame)

| Module | Choix concret |
|---|---|
| 1. Script & anti-doublon | SQLite + hash + histoires intégrées / Mistral |
| 2. Storyboard + audio | Découpe scènes + **Edge-TTS** (voix douce FR) |
| 3. Moteur vidéo | **Wan 2.1** sur GPU NVIDIA (clips courts bouclés sur l’audio) |
| 4. Montage & publish | **FFmpeg** + upload YouTube auto |
| 5. Dashboard | Streamlit = icône Bureau **video ia** |

Sous-titres : optionnels (l’audio suffit pour démarrer).

---

## Matin — Phase 1 (Script & Audio) + moteur NVIDIA

### Étape A — Récupérer le projet

```powershell
cd $env:USERPROFILE
if (-not (Test-Path mon-site)) {
  git clone --branch cursor/conte-factory-pipeline-0391 --single-branch https://github.com/urdirditfurd/mon-site.git
} else {
  cd mon-site
  git pull
}
```

### Étape B — Installer Wan **NVIDIA** (une fois)

```powershell
irm https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/conte-factory-pipeline-0391/pinokio/wan-snapdragon-arm/INSTALL-NVIDIA.ps1 | iex
```

Tu dois voir `cuda True` et le nom de ta carte graphique.

### Étape C — Lancer le moteur vidéo

**Nouveau (recommandé) :** double-clic sur l’icône Bureau **video ia** — Wan démarre tout seul.

Sinon manuellement :

```powershell
& "$env:USERPROFILE\mon-site\conte-factory\scripts\DEMARRER-VIDEO-IA.bat"
```

Ouvre http://127.0.0.1:8501 (dashboard) et http://127.0.0.1:7860 (Wan).

### Étape D — Icône de suivi

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\mon-site\conte-factory\scripts\install-desktop-shortcut.ps1"
```

Double-clic **video ia** sur le Bureau.

### Étape E — Test audio + script (court)

Dans un **2ᵉ** PowerShell :

```powershell
cd $env:USERPROFILE\mon-site\conte-factory
.\.venv\Scripts\activate
python main.py --short --theme "un lapin courageux" --no-publish
```

Si Wan tourne, ça génère aussi les clips IA (test court, pas 30 min).

---

## Après-midi — Phase 2 (Visuels & montage 30 min)

1. Wan doit être **allumé** (LANCER-WAN-NVIDIA.bat)
2. Lance une vraie durée :

```powershell
cd $env:USERPROFILE\mon-site\conte-factory
.\.venv\Scripts\activate
python main.py --theme "retrouver la lune endormie"
```

3. Le MP4 arrive dans `conte-factory\data\exports\`
4. Optionnel : mets une musique douce `.mp3` dans `conte-factory\assets\music\`

**Ordre de grandeur GPU :** bien plus rapide que CPU.  
Pour 30 min : souvent **quelques heures** selon la carte (RTX 3060/4060/4070…), d’où le lancement possible le soir.

---

## Soir — Phase 3 (YouTube + nuit)

### YouTube (publication auto)

1. Crée un projet Google Cloud → active **YouTube Data API v3**
2. Télécharge `client_secrets.json` dans :
   `mon-site\conte-factory\secrets\`
3. Installe les libs :

```powershell
cd $env:USERPROFILE\mon-site\conte-factory
.\.venv\Scripts\pip.exe install google-api-python-client google-auth-oauthlib google-auth-httplib2
```

4. Dans `.env` : `CONTE_AUTO_PUBLISH=1` et `CONTE_YOUTUBE_PRIVACY=private` (d’abord en privé)

### Planifier la nuit (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\mon-site\conte-factory\scripts\install-windows-autostart.ps1"
```

Cela configure Wan + dashboard au login, et le pipeline complet à 02:00.

---

## Checklist « journée réussie »

- [ ] `nvidia-smi` marche
- [ ] INSTALL-NVIDIA OK (`cuda True`)
- [ ] http://127.0.0.1:7860 ouvert
- [ ] Icône **video ia** sur le Bureau
- [ ] Test `--short` OK
- [ ] Une vidéo longue lancée / en cours
- [ ] (Bonus) YouTube secrets en place

---

## Commandes utiles

| Besoin | Commande |
|---|---|
| Estimer le travail | `python main.py --estimate` |
| Test court | `python main.py --short --no-publish` |
| Vidéo 30 min | `python main.py` |
| Pause | `python main.py --pause` |
| Reprendre | `python main.py --resume-pipeline` |
| Reprendre un projet | `python main.py --resume 3` |

---

## Si quelque chose bloque

- **cuda False** → réinstalle les drivers NVIDIA, relance INSTALL-NVIDIA
- **Wan pas joignable** → LANCER-WAN-NVIDIA.bat doit rester ouvert
- **Trop long** → commence par `--short`, puis augmente
- **Pas de publish** → secrets YouTube manquants (la vidéo reste dans `data\exports`)
