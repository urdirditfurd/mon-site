# Short Video — passerelle YouTube + TikTok

Page : `/short-video`

Publie le même short (fichier MP4 ou lien) sur **YouTube Shorts** et **TikTok** en parallèle.

## Variables d'environnement

```bash
PUBLIC_BASE_URL=https://ton-domaine.com

# YouTube OAuth (Google Cloud Console)
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx

# TikTok OAuth (developers.tiktok.com) — optionnel si tu colles accessToken+openId
TIKTOK_CLIENT_KEY=xxx
TIKTOK_CLIENT_SECRET=xxx
```

## Redirect URIs à autoriser

- YouTube / Google : `https://ton-domaine.com/api/short-video/youtube/callback`
- TikTok : `https://ton-domaine.com/api/short-video/tiktok/callback`

## Scopes

- YouTube : `youtube.upload`, `youtube.readonly`
- TikTok : `user.info.basic`, `video.upload`, `video.publish`

> TikTok Content Posting API nécessite souvent une app approuvée. En attendant, utilise le mode manuel (accessToken + openId) dans l’UI.

## Workflow

1. Génère ta vidéo (KidsStoryteller ou autre)
2. Ouvre `/short-video`
3. Connecte YouTube (OAuth) et TikTok (OAuth ou tokens)
4. Dépose le MP4 **ou** colle le lien
5. Titre + hashtags → **Publier sur YouTube + TikTok**

## API

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/short-video/status` | État des connexions |
| GET | `/api/short-video/youtube/connect` | Démarre OAuth YouTube |
| DELETE | `/api/short-video/youtube` | Déconnecte YouTube |
| GET | `/api/short-video/tiktok/connect` | Démarre OAuth TikTok |
| POST | `/api/short-video/tiktok/manual` | Enregistre tokens TikTok |
| DELETE | `/api/short-video/tiktok` | Déconnecte TikTok |
| POST | `/api/short-video/publish` | Upload multipart + publication dual |
