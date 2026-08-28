# Wan / LTX Image-to-Video — RAPIDE (RTX 3080 10 Go)

Cible : **1–2 minutes max par scène**.

## Params plafonnés
| Param | Valeur |
|-------|--------|
| Backend | `ltx` (défaut) ou `wan` (Fun 1.3B) |
| Steps | **16** (max 20) |
| Résolution | **848×480** (upscale 1080p au montage) |
| Frames | **81** (~3.4 s @ 24 fps) |
| CFG | 5.5 (Wan) / 3.5 (LTX) |
| VRAM | `CONTE_I2V_LOWVRAM=1` + SDPA |

## Install
```powershell
powershell -ExecutionPolicy Bypass -File INSTALL-I2V.ps1
powershell -ExecutionPolicy Bypass -File ..\..\conte-factory\scripts\SWITCH-TO-I2V.ps1
.\LANCER-I2V.bat
```

Port : http://127.0.0.1:7861

Si LTX échoue : mets `WAN_I2V_BACKEND=wan` dans `.env`.
