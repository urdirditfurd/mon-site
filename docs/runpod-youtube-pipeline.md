# Pipeline YouTube long-form — Snapdragon → RunPod ComfyUI

## Architecture

```
Ton PC Snapdragon (Edge/Chrome)
        ↓  navigateur + scripts
RunPod RTX 4090 (ComfyUI + LTX-2 / Wan)
        ↓  clips 5–15 s
Montage (CapCut / DaVinci Resolve)
        ↓
YouTube
```

Ton Adreno X1-85 ne génère **pas** la vidéo. Il ouvre ComfyUI dans le cloud.

## Prérequis (actions utilisateur — obligatoires)

1. Compte RunPod : https://www.runpod.io  
2. Crédits : **minimum ~20–50 USD** pour tester (recommandé 50+)  
3. Clé API : https://console.runpod.io/user/settings → API Keys  
4. Dans un terminal (PC ou agent) :

```powershell
# Windows PowerShell (ton Snapdragon)
$env:RUNPOD_API_KEY="rpa_xxx"
```

```bash
# Linux / agent
export RUNPOD_API_KEY=rpa_xxx
```

Sans cette clé, **aucun Pod ne peut être créé**.

## Setup agent déjà fait

- Skills RunPod installées (`runpod`, `runpodctl`, `runpod-mcp`, …)
- `runpodctl` 2.9.0 installé
- MCP Cursor configuré → `https://mcp.getrunpod.io/` (Bearer `RUNPOD_API_KEY`)
- Scripts : `scripts/runpod/launch-comfyui-4090.sh`

## Lancer le Pod ComfyUI RTX 4090

### Option A — Console (plus simple sur Snapdragon)

1. Ouvre : https://console.runpod.io/hub/template/comfyui?id=cw3nka7d08  
2. GPU : **RTX 4090**  
3. Volume disque : **100 Go** (modèles LTX/Wan)  
4. Deploy On-Demand  
5. Attends READY (1ère fois peut prendre longtemps)  
6. Connect → **HTTP Port 8188**

### Option B — Script CLI

```bash
export RUNPOD_API_KEY=rpa_xxx
bash scripts/runpod/launch-comfyui-4090.sh
```

URL ComfyUI : `https://<POD_ID>-8188.proxy.runpod.net`

## Modèles à installer dans ComfyUI (Manager)

Dans ComfyUI → **Manager** → Model Manager / Install via URL :

| Rôle | Modèle | Usage |
|---|---|---|
| Volume / vitesse | **LTX-2 / LTX-2.3** (distilled FP8) | clips 5–15 s |
| Qualité alternative | **Wan 2.2** (I2V / T2V) | styles & motion |
| Images clés | Flux / SDXL (selon style) | storyboard → image→vidéo |

Place-les sous `/workspace/ComfyUI/models/` (chemins exacts selon le template).

Persistance : attache un **Network Volume** dans le même datacenter que le GPU pour ne pas re-télécharger à chaque Pod.

## Pipeline de production (20 min)

1. **Script** → découpe scènes / plans (LLM local ou cloud)  
2. **Images clés** → 1 frame par plan (personnage + style lock)  
3. **Image→Vidéo** → LTX-2 ou Wan, 5–15 s / plan  
4. **Chaînage** → dernière frame du plan N = départ du plan N+1  
5. **Export clips** → télécharge depuis ComfyUI / file browser (8080)  
6. **Montage** → CapCut ou DaVinci sur le Snapdragon  
7. **YouTube** upload  
8. **Stop Pod** immédiatement (sinon €€€)

## Coût & rythme (ordre de grandeur)

- RTX 4090 ≈ **0,40–0,80 USD/h** selon dispo  
- 1 vidéo ~10–20 min “plan par plan” = souvent **plusieurs heures GPU**  
- Plusieurs 20 min / jour ⇒ plusieurs GPUs ou sessions longues  

**Règle d’or :** stoppe le Pod dès la fin de session.

```bash
runpodctl pod list
runpodctl pod stop <POD_ID>
```

## Vérifications agent

```bash
runpodctl version          # ≥ 2.9
export RUNPOD_API_KEY=…
runpodctl user             # compte OK
runpodctl pod list         # liste (vide = OK)
```

## Liens

- Console pods : https://console.runpod.io/pods  
- Template ComfyUI : https://console.runpod.io/hub/template/comfyui?id=cw3nka7d08  
- API keys : https://console.runpod.io/user/settings  
- Doc agent setup : https://docs.runpod.io/agent-setup.md  
- Tutorial ComfyUI : https://docs.runpod.io/tutorials/pods/comfyui  
