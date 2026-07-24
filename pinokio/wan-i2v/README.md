# Wan Image-to-Video — vraie animation (pas Wav2Lip / diaporama)
#
# Pipeline: TTS → image scene Pixar → Wan I2V 1.3B → FFmpeg
# Port Gradio: http://127.0.0.1:7861
#
# Install:
#   powershell -ExecutionPolicy Bypass -File INSTALL-I2V.ps1
#   .\LANCER-I2V.bat
#
# Modele: engineerA314/Wan2.1-Fun-V1.1-1.3B-InP-Diffusers
# RTX 3080 10 Go: float16 + CPU offload, ~49–65 frames (~3–4 s) / scene
