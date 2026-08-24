# Activation Prospection (cabinets)

## Activer sur le VPS (1 commande)

```bash
ssh root@51.254.135.158
cd /root/mon-site && bash scripts/vps-prospection-update.sh
```

Puis dans le navigateur : **Ctrl+F5**

URL : **https://51-254-135-158.sslip.io/prospection**

## Vérifier que c’est conforme

Vous devez voir :
- Titre Accueil : **cabinets d’expertise comptable**
- Cible verrouillée : Cabinets d’expertise comptable (pas d’autres secteurs)
- **Pas** de champ « Créées depuis »
- Zone : **Île-de-France**, départements IDF, villes du 92 (Asnières, Gennevilliers, Colombes…)
- Signature : **Nom de la société**

API :
```bash
curl -s https://51-254-135-158.sslip.io/api/prospection/sectors
curl -s https://51-254-135-158.sslip.io/api/prospection/zones | head
curl -s https://51-254-135-158.sslip.io/api/health
```

## En cas de problème

```bash
pm2 restart prospection
pm2 logs prospection --lines 30
systemctl restart nginx
```
