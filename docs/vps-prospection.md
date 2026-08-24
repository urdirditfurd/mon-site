# Agent de prospection sur VPS OVH

## Problème « Serveur inaccessible — npm start requis »

Ce message apparaît quand le **backend Node.js** ne tourne pas. L’interface `/prospection` a besoin de `/api/health` et `/api/prospection/*`.

Sur le VPS, **ne pas** lancer `npm start` (serveur ClipForge lourd, port 3000 souvent occupé). Utiliser le **serveur léger prospection seul** :

```bash
npm run start:prospection
```

En production, PM2 + Nginx le font automatiquement (voir ci-dessous).

## Installation en une commande (recommandé)

Connectez-vous en SSH :

```bash
ssh root@51.254.135.158
```

Puis :

```bash
curl -fsSL "https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/prospection-contacts-stream-0325/scripts/vps-prospection-setup.sh" | bash
```

Cela installe :

| Composant | Rôle |
|---|---|
| **PM2** `prospection` | Node sur `127.0.0.1:3011`, redémarrage auto au boot |
| **Nginx** | Proxy public sur le port **3010** → Node |
| **Git** | Branche `cursor/prospection-contacts-stream-0325` dans `/root/mon-site` |

URL après install :

**http://51.254.135.158:3010/prospection**

## HTTPS (cadenas vert)

Let's Encrypt **ne délivre pas** de certificat pour une IP seule (`51.254.135.158`). Deux options :

### Option A — Domaine sslip.io (sans acheter de nom)

Une seule commande (depuis n'importe quel dossier, en root) :

```bash
curl -fsSL "https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/prospection-contacts-stream-0325/scripts/vps-prospection-https.sh" | bash
```

Ou manuellement :

```bash
cd /root/mon-site
ENABLE_HTTPS=1 PUBLIC_IP=51.254.135.158 PROSPECTION_DOMAIN=51-254-135-158.sslip.io bash scripts/vps-prospection-setup.sh
```

URL sécurisée :

**https://51-254-135-158.sslip.io/prospection**

(Safari / iPhone : **sans** `:3010` — le HTTPS doit être sur le port 443.)

### Option B — Votre propre domaine

1. Zone DNS OVH : enregistrement `A` `prospection` → `51.254.135.158`
2. Relancer le script :

```bash
ENABLE_HTTPS=1 PROSPECTION_DOMAIN=prospection.votredomaine.fr bash scripts/vps-prospection-setup.sh
```

## ClipForge et port 3000

ClipForge est déjà dans le sous-dossier `clipforge/` et **n’empêche pas** la prospection. Sur ce VPS, le port **3000** est utilisé par une autre application (EBX Dropshipping) : c’est normal.

La prospection tourne **à part** sur le port **3010**, sans Redis ni FFmpeg.

## Mise à jour après modification Git

```bash
cd /root/mon-site
bash scripts/vps-prospection-update.sh
```

## Vérification

```bash
pm2 status prospection
curl -s http://127.0.0.1:3011/api/health
curl -s http://127.0.0.1:3010/api/health
pm2 logs prospection --lines 30
```

Réponse attendue : `{"ok":true,"service":"agent-prospection"}`

## Dépannage

| Symptôme | Cause | Action |
|---|---|---|
| « Serveur inaccessible » | PM2 arrêté | `pm2 restart prospection` |
| Port 3010 fermé | Nginx ou firewall | `systemctl reload nginx`, ouvrir le port 3010 dans le pare-feu OVH |
| « Non sécurisé » en HTTP | Normal sans HTTPS | Activer `ENABLE_HTTPS=1` ou utiliser un domaine + certbot |
| `npm start` plante | ClipForge / port 3000 pris | Utiliser `npm run start:prospection` ou le script VPS |
