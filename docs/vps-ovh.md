# ClipForge sur VPS OVH

## Peut-on héberger 2 sites sur le même VPS ?

**Oui.** Un VPS OVH peut héberger autant de sites que la RAM/CPU le permettent.
La méthode standard : **Nginx** en reverse proxy, un domaine par site.

Exemple :

| Domaine | Application | Port interne |
|---|---|---|
| `clipforge.tondomaine.com` | ClipForge (Node.js) | `3000` |
| `autre-site.tondomaine.com` | Autre site (Node, PHP, static…) | `8080` ou fichiers |

Nginx écoute sur le port **80/443** public et redirige vers le bon service selon le nom de domaine.

## Installation initiale (Ubuntu/Debian)

```bash
# Connexion SSH
ssh ubuntu@IP_DE_TON_VPS

# Outils système
sudo apt update
sudo apt install -y git curl nginx ffmpeg python3-pip

# yt-dlp (obligatoire pour YouTube)
sudo pip3 install -U yt-dlp

# Node.js 22 (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# PM2 (garde ClipForge allumé)
sudo npm install -g pm2

# Clone du projet
cd ~
git clone https://github.com/urdirditfurd/mon-site.git
cd mon-site
npm install
npm run check

# Lancer ClipForge en arrière-plan
pm2 start server/index.js --name clipforge
pm2 save
pm2 startup
```

## Nginx — site 1 : ClipForge

Crée `/etc/nginx/sites-available/clipforge` :

```nginx
server {
    listen 80;
    server_name clipforge.tondomaine.com;

    client_max_body_size 900M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
    }
}
```

Active le site :

```bash
sudo ln -s /etc/nginx/sites-available/clipforge /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

HTTPS (Let's Encrypt) :

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d clipforge.tondomaine.com
```

## Nginx — site 2 : autre application

Crée `/etc/nginx/sites-available/autre-site` :

```nginx
server {
    listen 80;
    server_name autre-site.tondomaine.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Ou pour un site **statique** :

```nginx
server {
    listen 80;
    server_name autre-site.tondomaine.com;
    root /var/www/autre-site;
    index index.html;
}
```

Active :

```bash
sudo ln -s /etc/nginx/sites-available/autre-site /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## DNS OVH

Dans la zone DNS de ton domaine, ajoute pour chaque site :

```
clipforge    A    IP_DE_TON_VPS
autre-site   A    IP_DE_TON_VPS
```

## Mise à jour après modification Git

```bash
cd ~/mon-site
chmod +x scripts/vps-update.sh
./scripts/vps-update.sh
```

Ou manuellement :

```bash
cd ~/mon-site
git pull origin main
npm install
npm run check
pm2 restart clipforge
```

## Vérification

```bash
curl http://127.0.0.1:3000/api/health
pm2 status
pm2 logs clipforge --lines 50
```
