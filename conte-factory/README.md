# Conte Factory

Trame d’origine : script → storyboard → **vidéo IA Wan 2.1 (Pinokio)** → montage → **publication auto** → dashboard **video ia**.

- Réévaluation + guide : [GUIDE.md](./GUIDE.md)
- App Pinokio : [`../pinokio/wan-snapdragon-arm`](../pinokio/wan-snapdragon-arm)

```bash
./scripts/install.sh
cp .env.example .env
# Windows — icône Bureau « video ia » :
#   powershell -ExecutionPolicy Bypass -File scripts\install-desktop-shortcut.ps1
# Linux :
./scripts/install-desktop-shortcut.sh

python main.py --estimate
# Pinokio → Wan Snapdragon ARM → Run, puis :
python main.py --theme "un lapin courageux"
```
