# Conte Factory — trame d’origine

```
[1. Script & Déduplication] → [2. Storyboard] → [3. Vidéo IA + Audio] → [4. Montage & Publication]
                                                                                 ↓
                                                                        [5. Dashboard video ia]
```

## PC tour NVIDIA (ton cas)

→ **Guide simple 1 jour :** [GUIDE-1-JOUR-NVIDIA.md](./GUIDE-1-JOUR-NVIDIA.md)

```powershell
irm https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/conte-factory-pipeline-0391/pinokio/wan-snapdragon-arm/INSTALL-NVIDIA.ps1 | iex
& "$env:USERPROFILE\mon-site\pinokio\wan-snapdragon-arm\LANCER-WAN-NVIDIA.bat"
```

## PC sans NVIDIA (CPU / Snapdragon)

→ Ancien chemin : `INSTALL-SANS-PINOKIO.ps1` + `LANCER-WAN.bat` (plus lent).

## Réévaluation (avec GPU NVIDIA)

| Phase | Contenu | Charge sur tour NVIDIA |
|---|---|---|
| 1 | Script + SQLite + Edge-TTS | Faible — matin |
| 2 | Wan CUDA + FFmpeg 30 min | Moyenne/haute — après-midi/soir (heures, pas jours) |
| 3 | YouTube auto + dashboard + tâche 02:00 | Moyenne — soir |

Avec NVIDIA, viser **setup + test court le jour même**, et **première vraie 30 min** lancée le soir / la nuit.
