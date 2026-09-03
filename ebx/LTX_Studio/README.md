# LTX Studio

Application locale one-click pour générer des vidéos **LTX-Video 2B** via ComfyUI (CPU / Snapdragon).

## Prérequis

- Windows 11 (ARM64 Snapdragon OK avec Python x64)
- ComfyUI installé dans `C:\ComfyUI-ARM\ComfyUI-ARM-Windows\`
- Checkpoint `ltx-video-2b-v0.9.5.safetensors` + CLIP `t5xxl_fp16.safetensors`

## Lancement

1. Extraire ce dossier dans `C:\ComfyUI-ARM\LTX_Studio\`
2. Double-cliquer `LTX_Studio.bat`
3. Ouvrir [http://127.0.0.1:8191](http://127.0.0.1:8191) (s’ouvre automatiquement)

La fenêtre console doit rester ouverte.

- Interface Studio : port **8191**
- ComfyUI (API) : port **8190**

## Réparations automatiques

Au démarrage, le launcher :

1. Libère les ports 8190 / 8191
2. Répare `tokenizers` / `transformers` / `huggingface-hub` si CLIPTokenizer est cassé
3. Répare ou retire `torchaudio` si incompatible avec `torch` (erreur `torch_library_impl` / `0xc0000139`) — non requis pour LTX Video

## Logs

`C:\ComfyUI-ARM\LTX_Studio\logs\` (`boot.log`, `comfyui.log`)
