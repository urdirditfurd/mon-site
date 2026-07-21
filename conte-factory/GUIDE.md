# Conte Factory — guide simple (1 journée)

Objectif : produire des **contes longs** (jusqu’à 30 min+) pour YouTube, sans bloquer ton serveur, avec un tableau de bord le matin.

Ce dossier est une version **améliorée et réaliste** de ton plan. On garde l’idée (histoire → voix → images → montage → YouTube), mais on enlève ce qui ferait perdre la journée.

---

## Ce qu’on a changé (et pourquoi)

| Ton idée initiale | Version “1 jour” | Pourquoi |
|---|---|---|
| Vidéo IA image par image 30 min | **Images + effet zoom/pan** (Ken Burns) | Une vraie vidéo IA de 30 min crame le GPU et le temps |
| Whisper pour sous-titres | Sous-titres depuis le **script déjà découpé** | Plus rapide, gratuit, déjà synchronisé |
| Publication auto dès le jour 1 | **Fichier prêt + bouton manuel** | Évite une mauvaise vidéo en public |
| Tout dans un seul gros script | **6 modules + reprise possible** | Si ça plante à l’étape 4, tu ne recommences pas à zéro |
| GPU obligatoire | Mode **demo** sans compte | Tu valides le pipeline avant de payer des APIs |

---

## Vue d’ensemble (en français simple)

```
1. Inventer une histoire (et vérifier qu’elle n’existe pas déjà)
2. Couper l’histoire en scènes + idée d’image pour chaque scène
3. Faire lire l’histoire à voix haute (voix off)
4. Créer une image par scène
5. Coller images + voix + musique + sous-titres → fichier MP4
6. (Plus tard) Envoyer sur YouTube après validation
```

Le tableau de bord matinal te montre : dernière vidéo, erreurs, pause/reprise, bouton “créer”.

---

## Matin — Étape A : installer (15–20 min)

Sur ton VPS (ou ton PC Linux) :

```bash
cd ~/mon-site   # ou le dossier du projet
git pull
cd conte-factory
chmod +x scripts/install.sh
./scripts/install.sh
source .venv/bin/activate
```

Tu as besoin de : **Python**, **FFmpeg**, et une connexion internet (pour la voix Edge-TTS).

Optionnel mais agréable : place un fichier musique douce (`.mp3`) dans `assets/music/` (libre de droits).

---

## Matin — Étape B : test rapide (10–20 min)

Ne commence **pas** par 30 minutes. Fais un essai court :

```bash
source .venv/bin/activate
python main.py --short --theme "un lapin courageux"
```

Tu dois obtenir un MP4 dans `data/exports/`.

Ouvre le tableau de bord :

```bash
streamlit run dashboard.py --server.address 0.0.0.0 --server.port 8501
```

Puis ouvre dans le navigateur : `http://IP_DU_VPS:8501` (ou `localhost:8501` en local).

---

## Après-midi — Étape C : vraie vidéo ~30 min

1. Dans `.env`, garde au début :
   - `CONTE_IMAGE_MODE=demo` (rapide)
   - `CONTE_STORY_MODE=builtin` (pas de clé API)
   - `CONTE_AUTO_PUBLISH=0` (sécurité)
2. Lance :

```bash
python main.py --theme "retrouver la lune endormie"
```

3. Vérifie le fichier dans `data/exports/`.
4. Si tu veux de **vraies illustrations IA** sans carte bancaire :

```env
CONTE_IMAGE_MODE=pollinations
```

5. Si tu as Mistral :

```env
CONTE_STORY_MODE=mistral
MISTRAL_API_KEY=ta_cle
```

---

## Soir — Étape D : automatiser la nuit

1. Vérifie que le test manuel marche.
2. Ajoute le cron (exemple fourni) :

```bash
crontab -e
# colle le contenu de scripts/cron-example.txt (adapte le chemin)
```

Chaque nuit à 2h, une nouvelle vidéo est préparée. **Elle n’est pas publiée toute seule** tant que `CONTE_AUTO_PUBLISH=0`.

Le matin : ouvre le dashboard → regarde le rapport → uploade si OK.

---

## YouTube (quand tu es prêt)

1. Crée un projet Google Cloud + active YouTube Data API.
2. Télécharge `client_secrets.json` dans `conte-factory/secrets/`.
3. Installe les libs :

```bash
pip install google-api-python-client google-auth-oauthlib google-auth-httplib2
```

4. Dans le dashboard, clique **Uploader YouTube** sur une vidéo au statut `pret`.
   Ou : `python main.py --resume ID --only publish --publish`

La première fois, une fenêtre / URL d’autorisation Google s’ouvre.

---

## Commandes utiles

| Besoin | Commande |
|---|---|
| Test court | `python main.py --short` |
| Vidéo complète | `python main.py` |
| Reprendre après plantage | `python main.py --resume 3` |
| Pause | `python main.py --pause` |
| Reprendre la prod | `python main.py --resume-pipeline` |
| Dashboard | `streamlit run dashboard.py` |

---

## Organisation des fichiers d’un projet

```
data/videos/video_0001/
  story.json          ← histoire
  script.txt
  storyboard.json     ← scènes + prompts
  audio/              ← voix par scène + narration.mp3
  images/             ← une image par scène
  clips/              ← mini-vidéos zoom
  subtitles.srt
  publish.json        ← titre / description / tags
data/exports/         ← MP4 final
```

---

## Feuille de route “1 jour” (réaliste)

**Matin**
- Install + test `--short`
- Ouvrir le dashboard

**Après-midi**
- Lancer une vraie durée (30 min en mode demo)
- Passer les images en `pollinations` si le rendu te plaît
- Ajouter une musique de fond

**Soir**
- Brancher le cron
- (Optionnel) brancher YouTube en privé d’abord

**Pas pour le jour 1**
- AnimateDiff / Sora / ComfyUI sur 30 min
- Publication publique automatique sans relecture

---

## Astuce anti-blocage serveur

Chaque étape écrit sur le disque. Si le VPS redémarre pendant les images, tu fais :

```bash
python main.py --resume 12
```

Tu reprends sans régénérer l’histoire ni toute la voix.

Pour ne pas saturer le CPU la journée : laisse le cron à **2h du matin**, et utilise le bouton **Pause** le jour si besoin.
