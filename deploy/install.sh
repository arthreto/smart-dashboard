#!/usr/bin/env bash
# Installation (ou mise à jour) du Smart Dashboard sur un VPS Debian/Ubuntu
# qui a déjà Nginx. À lancer depuis le dossier du projet copié sur le VPS :
#
#   sudo bash deploy/install.sh dashboard.mon-domaine.fr moi@exemple.fr
#
# Ce que fait le script :
#   1. installe Node.js 22 (si besoin), Certbot et les outils de compilation ;
#   2. copie le projet dans /opt/smart-dashboard, compile l'API et la console ;
#   3. crée /opt/smart-dashboard/server/.env (clé de chiffrement générée) ;
#   4. te fait choisir le mot de passe de la console (la première fois), AVANT la mise en ligne ;
#   5. installe le service systemd « smart-dashboard » ;
#   6. ajoute un site Nginx pour ton domaine (sans toucher aux autres) + HTTPS Certbot.
#
# Relancer le script plus tard met à jour l'application en gardant les données.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
APP_DIR=/opt/smart-dashboard
DATA_DIR=/var/lib/smart-dashboard
SERVICE=smart-dashboard
APP_USER=smartdash
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mErreur : %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "lance ce script avec sudo."
[ -n "$DOMAIN" ] || die "indique ton domaine. Exemple : sudo bash deploy/install.sh dashboard.mon-domaine.fr moi@exemple.fr"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "nom de domaine invalide : $DOMAIN"
[ -f "$SRC_DIR/server/package.json" ] || die "lance le script depuis le dossier du projet (deploy/install.sh)."
command -v apt-get >/dev/null || die "ce script prévoit un VPS Debian ou Ubuntu (apt)."

say "Paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
PKGS=(curl ca-certificates rsync build-essential python3 openssl certbot python3-certbot-nginx)
# Nginx est déjà là sur ton VPS : on ne l'installe que s'il manque (un second Nginx
# ne pourrait pas démarrer, le port 80 étant déjà pris).
command -v nginx >/dev/null || PKGS+=(nginx)
apt-get install -y -qq "${PKGS[@]}" >/dev/null

NODE_MAJOR=0
if command -v node >/dev/null; then NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"; fi
if [ "$NODE_MAJOR" -lt 20 ]; then
  say "Installation de Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
  hash -r
fi
NODE_BIN="$(command -v node)"
echo "Node.js $(node -v) ($NODE_BIN), npm $(npm -v)"

say "Utilisateur système et dossiers"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" "$DATA_DIR"
chown "$APP_USER:$APP_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"

say "Copie du projet dans $APP_DIR"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  # Fichiers appartenant à root : le service peut les lire mais pas les modifier.
  rsync -a --delete --chown=root:root --chmod=D755,F644 \
    --exclude node_modules --exclude 'server/dist' --exclude 'web/dist' \
    --exclude 'server/data' --exclude 'server/.env' --exclude 'firmware' --exclude '.git' \
    "$SRC_DIR/" "$APP_DIR/"
fi
# Fins de ligne Windows éventuelles (projet copié depuis un PC).
find "$APP_DIR/deploy" -type f \( -name '*.sh' -o -name '*.service' -o -name '*.conf' \) -exec sed -i 's/\r$//' {} +

say "Compilation de l'API"
cd "$APP_DIR/server"
npm ci --no-audit --no-fund
npm run build
say "Compilation de la console web"
cd "$APP_DIR/web"
npm ci --no-audit --no-fund
npm run build
cd "$APP_DIR/server"
npm prune --omit=dev --no-audit --no-fund >/dev/null

ENV_FILE="$APP_DIR/server/.env"
if [ ! -f "$ENV_FILE" ]; then
  say "Création de la configuration ($ENV_FILE)"
  {
    echo "PUBLIC_URL=https://$DOMAIN"
    echo "SECRET_KEY=$(openssl rand -base64 32)"
    echo "HOST=127.0.0.1"
    echo "PORT=8787"
    echo "TZ=Europe/Paris"
    echo "TZ_POSIX=CET-1CEST,M3.5.0,M10.5.0/3"
    echo "DATA_DIR=$DATA_DIR"
    echo "NODE_ENV=production"
    echo "LOG_LEVEL=info"
  } >"$ENV_FILE"
else
  sed -i "s#^PUBLIC_URL=.*#PUBLIC_URL=https://$DOMAIN#" "$ENV_FILE"
fi
chown root:"$APP_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"
# Sauvegarde de la clé : sans elle, les clés d'API enregistrées sont illisibles.
if [ ! -f "$DATA_DIR/.env.backup" ]; then
  install -m 600 -o "$APP_USER" -g "$APP_USER" "$ENV_FILE" "$DATA_DIR/.env.backup"
fi

say "Compte de la console"
# Créé ici, avant la mise en ligne : personne ne peut « prendre » la console entre
# l'installation et ta première visite. (Rien n'est demandé si le compte existe déjà.)
for essai in 1 2 3; do
  if runuser -u "$APP_USER" -- bash -c "cd '$APP_DIR/server' && '$NODE_BIN' dist/cli.js ensure-admin"; then break; fi
  [ "$essai" -lt 3 ] || die "compte de la console non créé : relance le script."
  echo "Recommence."
done

say "Service systemd"
sed "s#/usr/bin/node#$NODE_BIN#" "$APP_DIR/deploy/smart-dashboard.service" >/etc/systemd/system/$SERVICE.service
chmod 644 /etc/systemd/system/$SERVICE.service
systemctl daemon-reload
systemctl enable $SERVICE >/dev/null
systemctl restart $SERVICE
sleep 2
systemctl is-active --quiet $SERVICE || { journalctl -u $SERVICE -n 30 --no-pager; die "le service ne démarre pas (voir ci-dessus)."; }
curl -fsS http://127.0.0.1:8787/api/health >/dev/null && echo "API OK sur 127.0.0.1:8787"

say "Site Nginx pour $DOMAIN"
if [ -d /etc/nginx/sites-available ]; then
  SITE=/etc/nginx/sites-available/smart-dashboard
  LINK=/etc/nginx/sites-enabled/smart-dashboard
else
  SITE=/etc/nginx/conf.d/smart-dashboard.conf
  LINK=""
fi
# (Ré)écrit le site s'il n'existe pas ou si le domaine a changé ; sinon on garde la
# version complétée par Certbot (bloc HTTPS).
if [ ! -f "$SITE" ] || ! grep -q "server_name $DOMAIN;" "$SITE"; then
  sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/deploy/nginx-smart-dashboard.conf" >"$SITE"
  [ -f /proc/net/if_inet6 ] || sed -i '/listen \[::\]/d' "$SITE"  # VPS sans IPv6
fi
if [ -n "$LINK" ]; then ln -sf "$SITE" "$LINK"; fi
nginx -t
systemctl reload nginx

say "Certificat HTTPS (Let's Encrypt)"
if grep -q "ssl_certificate" "$SITE"; then
  echo "HTTPS déjà configuré pour $DOMAIN."
else
  echo "Le domaine $DOMAIN doit déjà pointer vers l'IP de ce VPS (enregistrement DNS A/AAAA)."
  CERTBOT=(certbot --nginx -d "$DOMAIN" --redirect --keep-until-expiring)
  if [ -n "$EMAIL" ]; then CERTBOT+=(--non-interactive --agree-tos -m "$EMAIL"); fi
  "${CERTBOT[@]}" || echo "⚠ Certbot a échoué : vérifie le DNS puis relance « sudo certbot --nginx -d $DOMAIN --redirect »."
fi

say "Terminé"
cat <<EOF
Console : https://$DOMAIN
  - Connecte-toi avec le mot de passe choisi.
  - Intégrations : renseigne Spotify, Roblox, Pathé, iCloud (voir docs/INTEGRATIONS.md).
  - Tablette : Appareil & réveils → « Associer une tablette ».

Commandes utiles :
  sudo systemctl status $SERVICE        # état du service
  sudo journalctl -u $SERVICE -f        # journaux en direct
Mise à jour : relance deploy/envoyer-sur-vps.ps1 depuis ton PC (les données sont conservées).
Données : $DATA_DIR (base SQLite, cache d'images). Sauvegarde aussi $ENV_FILE.
EOF
