# Vidéo IA Qwen

Workflow local : découpe un script en **N segments** Wan/Qwen, génère chaque clip, puis assemble un MP4 de **20 s à 2 min**.

## Lien de test

```text
http://localhost:3000/video-ia-qwen
```

```bash
cd mon-site
npm start
```

## Moteurs

| Mode | Usage |
|------|--------|
| **Démo** | FFmpeg local, sans GPU ni crédits — valide le chaînage |
| **API Qwen** | DashScope (`QWEN_API_KEY` ou clé dans l’UI) |
| **Pinokio** | Wan2GP sur `http://127.0.0.1:7860` |

## Variables d’environnement (optionnel)

```bash
export QWEN_API_KEY=sk-...
# ou DASHSCOPE_API_KEY
export QWEN_DASHSCOPE_BASE=https://dashscope-intl.aliyuncs.com/api/v1
export PINOKIO_WAN_URL=http://127.0.0.1:7860
```

## API

- `GET /api/qwen/health`
- `POST /api/qwen/plan`
- `POST /api/qwen/jobs`
- `GET /api/qwen/jobs/:id`
- `GET /api/qwen/jobs/:id/download`
