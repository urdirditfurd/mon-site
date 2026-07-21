# Conte Factory — trame d’origine (inchangée)

Objectif : publier automatiquement des **vidéos IA de 30 minutes et plus**, générées à partir d’un script, sans bloquer le serveur grâce à une découpe modulaire.

```
[1. Script & Déduplication]
        ↓
[2. Adaptation & Storyboard]
        ↓
[3. Moteur Vidéo & Audio]     ← vraie génération vidéo IA par scènes
        ↓
[4. Montage & Publication]    ← upload YouTube dès que le MP4 est prêt
        ↓
[5. Dashboard Matinal]
```

Sous-titres : **non requis** (l’audio porte la narration).

---

## Réévaluation du temps de création (trame conservée)

Ton plan initial en 3 phases reste la bonne structure.  
**Ce n’est pas un projet “1 journée”** si la contrainte de viabilité est bien : *une vraie vidéo IA ~30 min publiée*.

### Phase 1 — Script & Audio
**Charge :** faible  
**Contenu :** histoire (LLM) + SQLite anti-doublon + voix off (Edge-TTS / XTTS)  
**Blocage possible :** aucun critique  
**Statut dans ce repo :** déjà amorcé

### Phase 2 — Visuels IA & Assemblage
**Charge :** très élevée (cœur du projet)  
**Contenu :**
- découpage du script en N scènes
- génération **vidéo IA** par scène (API type FAL/Kling/Luma **ou** ComfyUI/AnimateDiff local GPU)
- file d’attente + reprises si une scène échoue
- FFmpeg : coller les clips + piste audio + musique

**Ordre de grandeur pour 30 min :**
- clips IA typiques = **5 à 10 s** chacun
- 30 min ≈ **180 à 360 clips** à générer
- coût API (ordre de grandeur Kling via FAL) : **~3× une vidéo de 10 min** → souvent **~90–120 €** par vidéo 30 min (variable selon modèle)
- temps machine : souvent **plusieurs heures** (file API + rendu), d’où le lancement de nuit

**Blocages possibles :**
- crédits API insuffisants
- limite de parallélisme FAL (souvent 2 au début)
- GPU local absent / trop faible si tu refuses l’API

### Phase 3 — Automatisation & Dashboard
**Charge :** moyenne  
**Contenu :** YouTube Data API (upload auto dès fin de montage) + Streamlit + Cron 02:00  
**Blocage possible :** OAuth Google / quotas YouTube (à brancher une fois)

---

## Verdict clair

| Objectif | Temps de mise en place (ordre de grandeur) |
|---|---|
| Pipeline complet **selon ta trame** (script → storyboard → **vidéo IA** → montage → **publish auto** → dashboard) | **~3 phases** comme dans ton plan initial — Phase 2 domine largement |
| Première **vraie** vidéo IA courte (2–5 min) bout-en-bout + publish | Fin de Phase 2 partielle + Phase 3 upload |
| Première **vraie** vidéo IA **~30 min** publiée | Phase 2 complète + budget API (ou GPU dédié) + une nuit de rendu |

**Conclusion :** on garde ta trame. On n’utilise pas le raccourci “images + zoom”.  
Le délai réaliste n’est pas “tout fini en une journée” : la Phase 2 (moteur vidéo IA longue durée) est le goulot. Les Phases 1 et 3 sont rapides en comparaison.

---

## Ce qu’il faut avoir avant de lancer Phase 2

1. Compte **FAL.ai** (crédits) **ou** VPS avec **GPU** + ComfyUI/AnimateDiff  
2. Clé YouTube Data API + `client_secrets.json` (pour la publication auto)  
3. Cron / lancement de nuit (le rendu 30 min ne doit pas saturer la journée)

---

## Enchaînement recommandé (trame originale)

```
Phase 1 : Script & Audio
  ├── Setup VPS (Python, FFmpeg, Git)
  ├── Histoire + SQLite anti-doublon
  └── TTS (Edge-TTS ou XTTS)

Phase 2 : Visuels IA & Assemblage
  ├── Génération vidéo IA scène par scène (API ou ComfyUI)
  ├── File d’attente + reprise sur erreur
  ├── FFmpeg : clips IA + audio + musique
  └── Test export ~30 min

Phase 3 : Automatisation & Dashboard
  ├── YouTube Data API → publish auto après montage
  ├── Dashboard Streamlit
  └── Cron 02:00
```

Le détail d’installation et les commandes : voir les modules dans ce dossier + `.env.example`.
