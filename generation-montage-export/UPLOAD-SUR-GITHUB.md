# Mettre à jour votre repo generation-montage

Votre page blanche vient du fait que **`video-factory.html` seul** n'inclut pas le CSS.

## À faire sur GitHub

1. Ouvrez https://github.com/urdirditfurd/generation-montage
2. **Supprimez** `video-factory.html` (optionnel, pour éviter la confusion)
3. **Uploadez** depuis ce dossier :
   - `index.html` ← **fichier principal à ouvrir** (design sombre inclus)
   - `README.md`
4. Sur votre PC : double-clic sur **`index.html`** (pas video-factory.html)

## Avec le serveur (génération vidéo)

Clonez le repo complet mon-site ou copiez tout le projet :

```bash
git clone https://github.com/urdirditfurd/mon-site.git
cd mon-site
git checkout cursor/fiction-studio-mvp-b827
npm install
npm start
```

Puis : http://localhost:3000/studio
