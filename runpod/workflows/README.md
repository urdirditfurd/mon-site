# Workflows ComfyUI — production YouTube

Place ici les JSON de workflows exportés depuis ComfyUI (File → Export).

## Pipeline cible

1. `01_keyframe_image.json` — texte/référence → image clé (personnage lock)
2. `02_i2v_ltx.json` — image → clip 5–15 s (LTX-2)
3. `03_i2v_wan.json` — alternative Wan
4. `04_chain_extend.json` — dernière frame → plan suivant

## Règles de cohérence

- Toujours **image→vidéo** (pas texte→vidéo seul) pour la cohérence personnage
- Même seed / mêmes refs sur une scène
- Overlay 4–8 frames entre plans pour transitions
- Exporter chaque plan en MP4 nommé `scene_XXX_shot_YYY.mp4`

## Montage local (Snapdragon)

Télécharge les MP4 → CapCut / DaVinci → voix + musique → YouTube.
