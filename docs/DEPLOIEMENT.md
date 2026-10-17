# Mettre le serveur en ligne sur ton VPS

Le serveur (API + console web) tourne en **Node.js** derrière le **Nginx déjà
installé** sur ton VPS, à côté de tes sites existants. Il ne touche pas à tes autres
sites (phpMyAdmin, etc.) : il ajoute seulement un site pour un sous-domaine, avec
HTTPS gratuit (Let's Encrypt). Une **vérification sans aucune modification** permet
de voir tout ce qui serait ajouté avant d'installer (étape 2).
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

## 2. Vérifier ton VPS (ne modifie rien)

Ton VPS a déjà Nginx et d'autres sites : avant d'installer quoi que ce soit, lance
la **vérification**. Elle envoie le projet sur le VPS, analyse la configuration
(Nginx, sites existants, ports, Node.js, DNS) et affiche exactement ce qui serait
ajouté — **sans rien modifier**.

Dans PowerShell, depuis le dossier du projet (`C:\Users\super\source\smart-dashboard`) :

```powershell
powershell -ExecutionPolicy Bypass -File deploy\envoyer-sur-vps.ps1 -Serveur utilisateur@IP-DU-VPS -Domaine dashboard.mon-domaine.fr -Verifier
```

Exemple de résultat :

```
==> Analyse du VPS (rien n'est modifié)
  ✓ Système : Ubuntu 24.04 LTS
  ✓ Nginx : nginx/1.24.0 (/etc/nginx/nginx.conf)
  ✓ Port 80 : utilisé par nginx
  ✓ Sites Nginx existants : 3 nom(s) de domaine — ils ne seront pas modifiés
  ✓ dashboard.mon-domaine.fr n'est utilisé par aucun site existant
  ✓ Node.js : v18.19.0 sur le système → Node 22 PRIVÉ dans /opt/smart-dashboard/node (celui du système reste intact)
  ✓ Application : écoutera sur 127.0.0.1:8787 (accessible seulement via Nginx)
  ✓ DNS : dashboard.mon-domaine.fr → 51.xx.xx.xx (ce VPS)
```

Si un point est marqué ✗ (sous-domaine déjà utilisé, port pris…), corrige-le puis
relance la vérification.

### Ce qui est ajouté sur ton VPS (et rien d'autre)

| Ajout | Détail |
|---|---|
| `/opt/smart-dashboard` | l'application |
| `/var/lib/smart-dashboard` | ses données (base SQLite) |
| utilisateur système `smartdash` | le service tourne avec ce compte limité, pas en root |
| service `smart-dashboard` | écoute seulement sur `127.0.0.1` (port 8787, ou le suivant libre) : invisible depuis Internet |
| Node.js | celui du système s'il est en version 20 ou plus ; sinon un **Node 22 privé** dans `/opt/smart-dashboard/node`. Le Node du système et tes autres applis Node ne sont jamais modifiés |
| paquets manquants seulement | `rsync`, `build-essential`, `certbot`… (aucun paquet déjà installé n'est mis à jour) |
| **un** fichier de site Nginx | `/etc/nginx/sites-available/smart-dashboard` (ou `conf.d/smart-dashboard.conf`), pour ton sous-domaine uniquement |
| certificat HTTPS | Let's Encrypt, pour ton sous-domaine uniquement |

Ne sont **pas** touchés : `nginx.conf`, tes autres sites, phpMyAdmin, MySQL. Nginx est
seulement *rechargé* (sans coupure), et uniquement si `nginx -t` valide la
configuration ; sinon le fichier ajouté est retiré et tout reste comme avant.

## 3. Installer

Même commande, sans `-Verifier` et avec ton e-mail (pour le certificat HTTPS) :

```powershell
powershell -ExecutionPolicy Bypass -File deploy\envoyer-sur-vps.ps1 -Serveur utilisateur@IP-DU-VPS -Domaine dashboard.mon-domaine.fr -Email moi@exemple.fr
```

Le script réaffiche le plan et **demande confirmation** (`o` pour continuer). Ensuite
il compile l'application, crée la configuration (avec une clé de chiffrement
générée) et te demande de **choisir le mot de passe de la console** — avant la mise
en ligne, pour que personne ne puisse créer le compte à ta place.

> Le VPS doit être sous Debian ou Ubuntu, et ton compte doit pouvoir utiliser `sudo`.

### Variante : à la main sur le VPS

```bash
# depuis ton PC : copie le dossier (WinSCP, FileZilla, scp…) vers le VPS, puis sur le VPS :
cd smart-dashboard
sudo bash deploy/install.sh --verifier dashboard.mon-domaine.fr        # ne modifie rien
sudo bash deploy/install.sh dashboard.mon-domaine.fr moi@exemple.fr    # installe
```

### Nginx géré autrement (panneau, Docker…)

Si ton Nginx est géré par un panneau (aaPanel, Plesk, CloudPanel, HestiaCP…), tourne
dans Docker, ou si tu préfères écrire la configuration toi-même, le script le détecte
(ou ajoute `-SansNginx`) : il installe l'application **sans toucher à Nginx**. Il te
reste à créer le site toi-même :

- **Dans un panneau** : crée le site `dashboard.mon-domaine.fr`, active HTTPS, puis
  ajoute un *reverse proxy* vers `http://127.0.0.1:8787`.
- **À la main** : un fichier de site comme celui-ci, puis `sudo nginx -t` et
  `sudo systemctl reload nginx`, puis `sudo certbot --nginx -d dashboard.mon-domaine.fr` :

```nginx
server {
    listen 80;
    server_name dashboard.mon-domaine.fr;
    client_max_body_size 20m;
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

(Le port exact est affiché par la vérification ; il est aussi dans
`/opt/smart-dashboard/server/.env`, ligne `PORT=`.)

## 4. Première connexion

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
configuration sont conservées** (le site Nginx déjà en place n'est pas réécrit).

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
