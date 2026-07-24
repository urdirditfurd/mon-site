# Talking Wav2Lip — lip-sync gratuit pour video ia (Pinokio / local NVIDIA)

Application locale pour animer un portrait enfant avec l'audio des dialogues.

## Pipeline video ia

1. TTS Edge (dialogues)
2. Portrait personnage (Flux/Pollinations)
3. **Ce module** : image + audio → clip bouche sync (Wav2Lip)
4. Montage FFmpeg 1080p 24fps, musique -14 dB

## Install

```powershell
powershell -ExecutionPolicy Bypass -File C:\ConteFactory\pinokio\talking-wav2lip\INSTALL-LIPSYNC.ps1
```

Puis :

```powershell
C:\ConteFactory\pinokio\talking-wav2lip\LANCER-LIPSYNC.bat
```

Port : `http://127.0.0.1:7870`

## Note InfiniteTalk

InfiniteTalk (MeiGen) offre un meilleur lip-sync mais necessite Wan2.1-I2V-14B
(beaucoup plus lourd). Sur RTX 3080 10 Go, Wav2Lip reste le choix gratuit fiable.
Si tu installes InfiniteTalk Gradio, pointe `PINOKIO_LIPSYNC_URL` vers son port.
