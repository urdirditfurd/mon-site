# LTX Studio

Application locale one-click pour générer des vidéos **LTX-Video 2B** via ComfyUI (CPU / Snapdragon X Elite).

## Lancement

1. Extraire dans `C:\ComfyUI-ARM\LTX_Studio\`
2. Double-cliquer `LTX_Studio.bat` (la console affiche **LTX Studio v8**)
3. L’interface s’ouvre sur [http://127.0.0.1:8191](http://127.0.0.1:8191)

## Preflight automatique

Avant ComfyUI, le launcher :

1. Désinstalle `torchaudio` et `xformers` (pip + suppression des dossiers, **sans jamais les importer**)
2. Installe un bloqueur `sitecustomize` pour intercepter tout `import torchaudio`
3. Vérifie `torch` CPU (`2.4.1`) et `numpy<2`
4. Lance ComfyUI : `--cpu --force-fp16 --port 8190 --disable-smart-memory`

LTX-Video n’a besoin ni de torchaudio ni de xformers.

## Logs

`C:\ComfyUI-ARM\LTX_Studio\logs\`
