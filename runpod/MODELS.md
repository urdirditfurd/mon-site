# Modèles ComfyUI sur le Pod (RTX 4090)

Les modèles **ne sont pas inclus** dans le template ComfyUI. Il faut les télécharger.

## Méthode A — automatique (recommandée dans l’UI)

1. Ouvre ComfyUI : `https://<POD_ID>-8188.proxy.runpod.net`
2. Menu **Workflow** → **Browse Templates** → onglet **Video**
3. Ouvre **LTX-2.3 I2V** (ou T2V)
4. Accepte le pop-up **Download models** / Missing Models
5. Attends la fin des téléchargements, puis **Refresh** (touche R)

Pour Wan : template **Wan 2.2** / **TI2V 5B** (meilleur pour 24 Go VRAM).

## Méthode B — fichiers attendus (déjà lancés via SSH sur le Pod)

### LTX-2.3 (24 Go VRAM)

| Fichier | Dossier |
|---|---|
| `ltx-2.3-22b-distilled-fp8.safetensors` | `models/checkpoints/` |
| `ltx-2.3-22b-dev-fp8.safetensors` | `models/checkpoints/` |
| `gemma_3_12B_it_fp4_mixed.safetensors` | `models/text_encoders/` |
| `ltx-2.3-spatial-upscaler-x2-1.1.safetensors` | `models/latent_upscale_models/` |
| `ltx_2.3_22b_distilled_1.1_lora_…bf16.safetensors` | `models/loras/` |
| `gemma-3-12b-it-abliterated_lora_rank64_bf16.safetensors` | `models/loras/` |

Sources :
- https://huggingface.co/Lightricks/LTX-2.3-fp8
- https://huggingface.co/Comfy-Org/ltx-2
- https://huggingface.co/Lightricks/LTX-2.3

### Wan 2.2 TI2V 5B (adapté 4090)

| Fichier | Dossier |
|---|---|
| `wan2.2_ti2v_5B_fp16.safetensors` | `models/diffusion_models/` |
| `umt5_xxl_fp8_e4m3fn_scaled.safetensors` | `models/text_encoders/` |
| `wan2.2_vae.safetensors` | `models/vae/` |

Source : https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged

> Wan **14B I2V** est trop lourd pour un usage confortable en 24 Go ; préfère **TI2V 5B**.

## Vérifier que c’est prêt

Dans ComfyUI :
- nodes Load Checkpoint / Load Diffusion Model → les noms apparaissent
- sinon F5 / R pour refresh, ou redémarrer ComfyUI

Log téléchargement Pod :
`/workspace/model-downloads/install.log`

## Persistance

Ces fichiers sont sur le volume du Pod. Si tu **supprimes** le Pod, tu perds les modèles.
Pour garder : Network Volume RunPod (même datacenter, ex. EU-RO-1).
