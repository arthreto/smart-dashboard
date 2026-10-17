# Mettre le serveur en ligne sur ton VPS

Le serveur (API + console web) tourne en **Node.js** derrière le **Nginx déjà
installé** sur ton VPS. Il ne touche pas à tes autres sites (phpMyAdmin, etc.) :
il ajoute simplement un site pour un sous-domaine, avec HTTPS gratuit (Let's Encrypt).
Les données sont dans une base SQLite (`/var/lib/smart-dashboard`), donc rien à
configurer dans MySQL.

## 1. Préparer le domaine

Choisis un sous-domaine, par exemple `dashboard.mon-domaine.fr`, et crée chez ton
registrar (OVH, Gandi, Cloudflare…) un enregistrement DNS :

| Type | Nom | Valeur |
|---|---|---|
| A | `dashboard` | l'adresse IPv4 de ton VPS |
| AAAA (optionnel) | `dashboard` | l'adresse IPv6 de ton VPS |

Attends que `ping dashboard.mon-domaine.fr` réponde avec l'IP du VPS (quelques
minutes en général). Les ports 80 et 443 doivent être ouverts (ils le sont déjà
si Nginx sert tes autres sites).

## 2. Installer (depuis Windows, en une commande)

Dans PowerShell, depuis le dossier du projet (`C:\Users\super\source\smart-dashboard`) :

```powershell
powershell -ExecutionPolicy Bypass -File deploy\envoyer-sur-vps.ps1 -Serveur utilisateur@IP-DU-VPS -Domaine dashboard.mon-domaine.fr -Email moi@exemple.fr
```

Le script :

1. crée une archive du projet (sans `node_modules`) et l'envoie par `scp` ;
2. lance `deploy/install.sh` sur le VPS avec `sudo`, qui :
   - installe Node.js 22 si besoin (NodeSource), Certbot et les outils de compilation ;
   - copie le projet dans `/opt/smart-dashboard`, compile l'API et la console ;
   - crée `/opt/smart-dashboard/server/.env` avec une **clé de chiffrement générée** ;
   - installe le service `smart-dashboard` (systemd, utilisateur dédié `smartdash`) ;
   - ajoute le site Nginx `smart-dashboard` et demande le certificat HTTPS ;
   - te demande de **choisir le mot de passe de la console** (avant la mise en ligne :
     personne ne peut créer le compte à ta place depuis Internet).

> Le VPS doit être sous Debian ou Ubuntu. Ton compte doit pouvoir utiliser `sudo`.

### Variante : à la main sur le VPS

```bash
# depuis ton PC : copie le dossier (WinSCP, FileZilla, scp…) vers le VPS, puis sur le VPS :
cd smart-dashboard
sudo bash deploy/install.sh dashboard.mon-domaine.fr moi@exemple.fr
```

## 3. Première connexion

Ouvre `https://dashboard.mon-domaine.fr`, connecte-toi avec le mot de passe choisi,
puis :

- **Appareil & réveils › Sécurité** : active la double authentification (TOTP, avec
  Google Authenticator, 1Password, l'app Mots de passe d'iPhone…) et choisis le
  code PIN de l'écran.
- **Intégrations** : renseigne les clés d'API → [INTEGRATIONS.md](INTEGRATIONS.md).
- **Appareil & réveils** : réveils, disposition de l'accueil, puis « Associer une
  tablette » pour obtenir un code d'appairage (valable 10 minutes).

## Mettre à jour

Relance simplement la même commande `envoyer-sur-vps.ps1` (ou `install.sh`) : le
projet est recompilé, le service redémarré, et **les données comme la
configuration sont conservées**.

## Commandes utiles sur le VPS

```bash
sudo systemctl status smart-dashboard          # état du service
sudo journalctl -u smart-dashboard -f          # journaux en direct
sudo systemctl restart smart-dashboard         # redémarrer
sudo nano /opt/smart-dashboard/server/.env     # configuration (puis redémarrer)

# Mot de passe de la console oublié (désactive aussi la double authentification)
cd /opt/smart-dashboard/server && sudo -u smartdash node dist/cli.js reset-password
```

## Sauvegardes

Deux choses suffisent pour tout restaurer :

- `/var/lib/smart-dashboard/` — la base SQLite (habitudes, historique, réglages, clés chiffrées) ;
- `/opt/smart-dashboard/server/.env` — surtout la ligne `SECRET_KEY` : **sans elle, les
  clés d'API enregistrées sont illisibles** (une copie est faite dans
  `/var/lib/smart-dashboard/.env.backup` à la première installation).

La console propose aussi un export JSON (Appareil & réveils › Sauvegarde), sans les secrets.

## Configuration (`server/.env`)

| Variable | Rôle | Valeur par défaut |
|---|---|---|
| `PUBLIC_URL` | adresse publique (sert aussi à l'URL de retour Spotify) | `https://<domaine>` |
| `SECRET_KEY` | clé AES-256 (base64, 32 octets) des secrets enregistrés | générée |
| `HOST`, `PORT` | écoute locale derrière Nginx | `127.0.0.1`, `8787` |
| `TZ` | fuseau des habitudes, réveils, agenda | `Europe/Paris` |
| `TZ_POSIX` | même fuseau au format POSIX pour la tablette | `CET-1CEST,M3.5.0,M10.5.0/3` |
| `DATA_DIR` | dossier de la base | `/var/lib/smart-dashboard` |
| `NODE_ENV` | `production` : cookies réservés au HTTPS, compte de la console créé seulement depuis le serveur | `production` |
| `TRUST_PROXY` | proxys de confiance pour l'adresse du visiteur (limites de tentatives) | `127.0.0.1,::1` (Nginx local) |

## En cas de problème

- **Certbot échoue** : le DNS ne pointe pas encore vers le VPS, ou le port 80 est
  fermé. Corrige puis lance `sudo certbot --nginx -d dashboard.mon-domaine.fr`.
- **502 Bad Gateway** : le service ne tourne pas → `sudo journalctl -u smart-dashboard -n 50`.
- **`npm ci` échoue sur `better-sqlite3`** : le VPS n'a pas pu télécharger le module
  précompilé ; le script installe `build-essential` et `python3` pour le compiler,
  relance-le simplement.
- **Nginx refuse la configuration** : `sudo nginx -t` indique la ligne fautive ; le
  site ajouté est `/etc/nginx/sites-available/smart-dashboard`.
