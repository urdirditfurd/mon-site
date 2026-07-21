# Conte Factory

Pipeline **trame d’origine** : script → storyboard → **vidéo IA** → montage → **publication auto** → dashboard.

Lis d’abord la réévaluation du temps : [GUIDE.md](./GUIDE.md)

```bash
./scripts/install.sh
source .venv/bin/activate
cp .env.example .env   # renseigne FAL_KEY (+ secrets YouTube)
python main.py --estimate
python main.py --theme "un lapin courageux"
streamlit run dashboard.py
```
