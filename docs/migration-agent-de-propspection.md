# Mise à jour Agent-de-propspection — secteurs vides

## Problème

Sur GitHub, `prospection.html` contient encore :

```html
<select id="sectorSelect"></select>
```

La liste est remplie par JavaScript via `/api/prospection/sectors`. En ouvrant le fichier téléchargé (double-clic), il n’y a pas de serveur → liste vide.

De plus, l’ancien `server/index.js` (ClipForge) ne démarre pas dans ce repo.

## Fichiers à remplacer (3)

Depuis la branche `cursor/prospection-ui-improvements-0325` de **mon-site** :

| Fichier sur Agent-de-propspection | URL à copier |
|-----------------------------------|--------------|
| `prospection.html` | https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/prospection-ui-improvements-0325/prospection.html |
| `prospection.js` | https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/prospection-ui-improvements-0325/prospection.js |
| `server/index.js` | https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/prospection-ui-improvements-0325/server/prospection-server.js |

## Méthode rapide (GitHub web)

1. Ouvrir chaque fichier sur **Agent-de-propspection**
2. Cliquer **Edit** (crayon)
3. Coller le contenu depuis les URLs ci-dessus
4. **Commit changes**

## Méthode terminal

```bash
git clone https://github.com/urdirditfurd/Agent-de-propspection.git
cd Agent-de-propspection

curl -o prospection.html \
  https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/prospection-ui-improvements-0325/prospection.html
curl -o prospection.js \
  https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/prospection-ui-improvements-0325/prospection.js
curl -o server/index.js \
  https://raw.githubusercontent.com/urdirditfurd/mon-site/cursor/prospection-ui-improvements-0325/server/prospection-server.js

git add prospection.html prospection.js server/index.js
git commit -m "fix: secteurs visibles + serveur minimal"
git push
```

## Utilisation

### Voir les secteurs (fichier local)

Téléchargez **prospection.html** et **prospection.js** dans le **même dossier**, ouvrez `prospection.html` → les 12 secteurs s’affichent.

### Lancer la prospection (recherche BODACC)

```bash
npm install
npm start
```

Puis : http://localhost:3000/prospection

> La recherche d’entreprises nécessite toujours le serveur Node.js.
