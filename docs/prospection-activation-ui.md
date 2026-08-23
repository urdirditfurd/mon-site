# Activation de la nouvelle interface Prospection

## Important

**Seule l’interface change.** Le processus reste identique :
- même backend Node / API `/api/prospection/*`
- même logique de scan BODACC, filtres contacts, mémoire locale
- même PM2 / Nginx sur le VPS

## Activer sur le VPS (1 commande)

```bash
ssh root@51.254.135.158
cd /root/mon-site && bash scripts/vps-prospection-update.sh
```

Puis dans le navigateur : **Ctrl+F5** (vidage cache)

URL : https://51-254-135-158.sslip.io:3010/prospection

## Vérifier que c’est bien la nouvelle UI

Vous devez voir :
- **Accueil** avec le titre « Trouvez des clients à contacter… »
- Navigation **Accueil | Recherche**
- Bouton **Trouver des entreprises** (plus « Lancer le sondage »)
- Sur mobile : barre de navigation en bas

## En cas de problème

```bash
pm2 restart prospection
pm2 logs prospection --lines 30
curl -s https://51-254-135-158.sslip.io:3010/api/health
```

## Rollback (revenir à l’ancienne UI)

```bash
cd /root/mon-site
git checkout 21886bf -- agent-prospection/index.html agent-prospection/prospection.js
pm2 restart prospection
```

(Commit juste avant la refonte UX)
