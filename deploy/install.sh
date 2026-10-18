#!/usr/bin/env bash
# Installation (ou mise à jour) du Smart Dashboard sur un VPS Debian/Ubuntu qui
# héberge déjà d'autres sites. À lancer depuis le dossier du projet copié sur le VPS.
#
#   sudo bash deploy/install.sh --verifier dashboard.mon-domaine.fr
#       → ne modifie RIEN : analyse le VPS et affiche ce qui serait ajouté.
#   sudo bash deploy/install.sh dashboard.mon-domaine.fr moi@exemple.fr
#       → installe (ou met à jour), après avoir affiché le plan et demandé confirmation.
#
# Options : --oui (pas de confirmation), --sans-nginx (ne touche pas du tout à Nginx :
# tu ajoutes toi-même le proxy vers l'application, par exemple dans ton panneau).
#
# Ce qui est AJOUTÉ (rien n'est supprimé ni remplacé ailleurs) :
#   - l'application dans /opt/smart-dashboard, ses données dans /var/lib/smart-dashboard,
#     un utilisateur système « smartdash » et un service systemd « smart-dashboard »
#     qui n'écoute qu'en local (127.0.0.1), invisible depuis Internet ;
#   - Node.js 22 PRIVÉ dans /opt/smart-dashboard/node si le Node du système est absent ou
#     trop ancien : le Node du système (et tes autres applis) n'est jamais modifié ;
#   - un fichier de site Nginx pour TON sous-domaine uniquement, et son certificat HTTPS.
#     nginx.conf, tes autres sites, MySQL/phpMyAdmin ne sont pas touchés. Si la
#     configuration Nginx ne passe pas « nginx -t », le fichier ajouté est retiré.
set -euo pipefail

APP_DIR=/opt/smart-dashboard
DATA_DIR=/var/lib/smart-dashboard
SERVICE=smart-dashboard
APP_USER=smartdash
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mErreur : %s\033[0m\n' "$*" >&2; exit 1; }

MODE=install
ASSUME_YES=0
NO_NGINX=0
ARGS=()
for a in "$@"; do
  case "$a" in
    --verifier | --check) MODE=check ;;
    --oui | --yes) ASSUME_YES=1 ;;
    --sans-nginx) NO_NGINX=1 ;;
    -*) die "option inconnue : $a" ;;
    *) ARGS+=("$a") ;;
  esac
done
DOMAIN="${ARGS[0]:-}"
EMAIL="${ARGS[1]:-}"

[ "$(id -u)" -eq 0 ] || die "lance ce script avec sudo (même la vérification : il doit lire la configuration Nginx)."
[ -n "$DOMAIN" ] || die "indique ton sous-domaine. Exemple : sudo bash deploy/install.sh --verifier dashboard.mon-domaine.fr"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "nom de domaine invalide : $DOMAIN"
[ -f "$SRC_DIR/server/package.json" ] || die "lance le script depuis le dossier du projet (deploy/install.sh)."

# ============================================================================ analyse
# (lecture seule : rien n'est modifié dans cette partie)

port_owner() { # nom du programme qui écoute sur le port TCP $1 (vide si libre)
  command -v ss >/dev/null || return 0
  local line
  line="$(ss -ltnpH "( sport = :$1 )" 2>/dev/null | head -1)"
  [ -z "$line" ] && return
  local name
  name="$(grep -o 'users:(("[^"]*"' <<<"$line" | head -1 | cut -d'"' -f2)"
  echo "${name:-inconnu}"
}

port_is_ours() { # vrai si le port $1 est tenu par notre propre service (mise à jour)
  command -v ss >/dev/null || return 1
  local pid user
  pid="$(ss -ltnpH "( sport = :$1 )" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)"
  [ -n "$pid" ] || return 1
  user="$(ps -o user= -p "$pid" 2>/dev/null | tr -d ' ')"
  [ "$user" = "$APP_USER" ] && return 0
  [ "$(systemctl show -p MainPID --value "$SERVICE" 2>/dev/null)" = "$pid" ]
}

pkg_missing() { dpkg -s "$1" >/dev/null 2>&1 && return 1 || return 0; }

command -v ss >/dev/null || warn "commande « ss » absente : les ports utilisés ne peuvent pas être vérifiés"
HAS_APT=0
command -v apt-get >/dev/null && command -v dpkg >/dev/null && HAS_APT=1
OS_NAME="$(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-inconnu}" || echo inconnu)"

# Panneaux d'administration qui gèrent eux-mêmes Nginx (y écrire à la main serait écrasé).
PANEL=""
[ -d /www/server/panel ] && PANEL="aaPanel"
[ -d /usr/local/psa ] && PANEL="Plesk"
[ -d /usr/local/hestia ] && PANEL="HestiaCP"
[ -d /usr/local/vesta ] && PANEL="VestaCP"
[ -d /usr/local/CyberCP ] && PANEL="CyberPanel"
[ -d /usr/local/ispconfig ] && PANEL="ISPConfig"
command -v clpctl >/dev/null && PANEL="CloudPanel"

P80="$(port_owner 80)"
P443="$(port_owner 443)"
NGINX_BIN="$(command -v nginx || true)"
for b in /usr/sbin/nginx /www/server/nginx/sbin/nginx /usr/local/nginx/sbin/nginx; do
  [ -z "$NGINX_BIN" ] && [ -x "$b" ] && NGINX_BIN="$b"
done
NGINX_CONF=""
if [ -n "$NGINX_BIN" ]; then
  NGINX_CONF="$("$NGINX_BIN" -V 2>&1 | grep -o -- '--conf-path=[^ ]*' | cut -d= -f2 || true)"
  NGINX_CONF="${NGINX_CONF:-/etc/nginx/nginx.conf}"
fi
NGINX_DUMP=""
NGINX_TEST_OK=1
if [ -n "$NGINX_BIN" ]; then
  "$NGINX_BIN" -t >/dev/null 2>&1 || NGINX_TEST_OK=0
  NGINX_DUMP="$("$NGINX_BIN" -T 2>/dev/null || true)"
  if [ -z "$NGINX_DUMP" ] && [ -d "$(dirname "$NGINX_CONF")" ]; then
    # « nginx -T » indisponible : on relit directement les fichiers de configuration.
    NGINX_DUMP="$(find "$(dirname "$NGINX_CONF")" -follow -type f \( -name '*.conf' -o -path '*sites-enabled*' \) 2>/dev/null |
      while read -r f; do echo "# configuration file $f:"; cat "$f"; done)"
  fi
fi

# Où ajouter le site : là où nginx.conf va déjà chercher les sites.
SITE=""
LINK=""
NGINX_WHY=""  # raison de ne pas toucher à Nginx (vide = on peut)
if [ "$NO_NGINX" -eq 1 ]; then
  NGINX_WHY="option --sans-nginx"
elif [ -n "$PANEL" ]; then
  NGINX_WHY="ton Nginx est géré par $PANEL"
elif [ -z "$NGINX_BIN" ]; then
  if [ -n "$P80" ]; then NGINX_WHY="le port 80 est utilisé par « $P80 », pas par Nginx"; fi
elif [ "$NGINX_CONF" != /etc/nginx/nginx.conf ]; then
  NGINX_WHY="Nginx installé hors du standard ($NGINX_CONF)"
elif [ "$NGINX_TEST_OK" -eq 0 ]; then
  NGINX_WHY="ta configuration Nginx actuelle a déjà une erreur (« sudo nginx -t » pour la voir)"
elif [ -n "$P80" ] && [ "$P80" != nginx ]; then
  NGINX_WHY="le port 80 est utilisé par « $P80 » (Docker, Apache… ?), pas par le Nginx du système"
elif grep -Eq '^[[:space:]]*include[[:space:]]+(/etc/nginx/)?sites-enabled/\*' "$NGINX_CONF"; then
  SITE=/etc/nginx/sites-available/smart-dashboard
  LINK=/etc/nginx/sites-enabled/smart-dashboard
elif grep -Eq '^[[:space:]]*include[[:space:]]+(/etc/nginx/)?conf\.d/\*\.conf' "$NGINX_CONF"; then
  SITE=/etc/nginx/conf.d/smart-dashboard.conf
else
  NGINX_WHY="nginx.conf n'inclut ni sites-enabled/ ni conf.d/"
fi
INSTALL_NGINX=0
[ -z "$NGINX_BIN" ] && [ -z "$NGINX_WHY" ] && { INSTALL_NGINX=1; SITE=/etc/nginx/sites-available/smart-dashboard; LINK=/etc/nginx/sites-enabled/smart-dashboard; }
MANAGE_NGINX=0
[ -z "$NGINX_WHY" ] && MANAGE_NGINX=1

# Noms de domaine déclarés par les sites existants (« fichier<TAB>nom » par ligne).
SERVER_NAMES=""
if [ -n "$NGINX_DUMP" ]; then
  SERVER_NAMES="$(awk '
    /^# configuration file / { f = $4; sub(/:$/, "", f); next }
    {
      l = $0; sub(/#.*/, "", l)
      while (match(l, /(^|[[:space:];{])server_name[[:space:]]+[^;]*/)) {
        part = substr(l, RSTART, RLENGTH); l = substr(l, RSTART + RLENGTH)
        sub(/.*server_name[[:space:]]+/, "", part)
        n = split(part, w, /[[:space:]]+/)
        for (i = 1; i <= n; i++) if (w[i] != "") print f "\t" w[i]
      }
    }' <<<"$NGINX_DUMP" || true)"
fi
DOMAIN_TAKEN="$(awk -F'\t' -v d="$DOMAIN" '$2 == d && $1 !~ /smart-dashboard/ {print $1}' <<<"$SERVER_NAMES" | sort -u | tr '\n' ' ' || true)"
N_SITES="$(awk -F'\t' '$2 != "_" && $2 != "" {print $2}' <<<"$SERVER_NAMES" | sort -u | grep -c . || true)"

# Node.js : celui du système s'il est assez récent, sinon un Node privé à l'application.
NODE_SYS=""
command -v node >/dev/null && NODE_SYS="$(node -v 2>/dev/null || true)"
NODE_SYS_MAJOR="$(sed -E 's/^v([0-9]+).*/\1/' <<<"${NODE_SYS:-v0}")"
if [ -x "$APP_DIR/node/bin/node" ]; then
  NODE_PLAN="private-existing"
elif [ -n "$NODE_SYS" ] && [ "$NODE_SYS_MAJOR" -ge 20 ]; then
  NODE_PLAN="system"
else
  NODE_PLAN="private"
fi

# Port local de l'application (8787, ou le suivant libre ; conservé lors des mises à jour).
ENV_FILE="$APP_DIR/server/.env"
PORT=""
[ -f "$ENV_FILE" ] && PORT="$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2 || true)"
if [ -z "$PORT" ]; then
  for p in $(seq 8787 8799); do
    if [ -z "$(port_owner "$p")" ]; then PORT=$p; break; fi
  done
fi
PORT_OWNER=""
[ -n "$PORT" ] && PORT_OWNER="$(port_owner "$PORT")"

# Certbot
CERTBOT_BIN="$(command -v certbot || true)"
CERTBOT_PLUGIN=0
[ -n "$CERTBOT_BIN" ] && "$CERTBOT_BIN" plugins 2>/dev/null | grep -q '^\* nginx' && CERTBOT_PLUGIN=1

# Paquets à ajouter (seulement ceux qui manquent).
APT_PKGS=()
if [ "$HAS_APT" -eq 1 ]; then
  for p in curl ca-certificates rsync build-essential python3 openssl xz-utils; do
    pkg_missing "$p" && APT_PKGS+=("$p")
  done
  if [ "$MANAGE_NGINX" -eq 1 ]; then
    [ "$INSTALL_NGINX" -eq 1 ] && APT_PKGS+=(nginx)
    if [ -z "$CERTBOT_BIN" ]; then
      APT_PKGS+=(certbot python3-certbot-nginx)
    elif [ "$CERTBOT_PLUGIN" -eq 0 ] && ! pkg_missing certbot && pkg_missing python3-certbot-nginx; then
      APT_PKGS+=(python3-certbot-nginx)
    fi
  fi
fi

# DNS : le sous-domaine pointe-t-il vers ce VPS ?
DNS_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1; exit}' || true)"
MY_IPS="$(hostname -I 2>/dev/null || true)"
PUBLIC_IP="$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || true)"

DISK_MB="$(df -Pm "$(dirname "$APP_DIR")" | awk 'NR==2 {print $4}')"
RAM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"

# ---------------------------------------------------------------------------- rapport
BLOCKERS=()
say "Analyse du VPS (rien n'est modifié)"
[ "$HAS_APT" -eq 1 ] && ok "Système : $OS_NAME" || { bad "Système : $OS_NAME (il faut Debian ou Ubuntu)"; BLOCKERS+=("système non Debian/Ubuntu"); }
[ "${DISK_MB:-0}" -ge 1500 ] && ok "Espace disque libre : $DISK_MB Mo" || warn "Espace disque libre : ${DISK_MB:-?} Mo (prévois au moins 1,5 Go)"
[ "${RAM_MB:-0}" -ge 900 ] && ok "Mémoire : $RAM_MB Mo" || warn "Mémoire : ${RAM_MB:-?} Mo (la compilation peut être lente sous 1 Go)"
[ -n "$PANEL" ] && warn "Panneau d'administration détecté : $PANEL"
if [ -n "$NGINX_BIN" ]; then
  ok "Nginx : $("$NGINX_BIN" -v 2>&1 | sed 's/^nginx version: //') ($NGINX_CONF)"
else
  warn "Nginx : absent du système"
fi
[ -n "$P80" ] && ok "Port 80 : utilisé par $P80" || ok "Port 80 : libre"
[ -n "$P443" ] && ok "Port 443 : utilisé par $P443"
[ -n "$NGINX_DUMP" ] && ok "Sites Nginx existants : ${N_SITES:-0} nom(s) de domaine — ils ne seront pas modifiés"
if [ -n "$DOMAIN_TAKEN" ]; then
  bad "$DOMAIN est déjà déclaré dans : $DOMAIN_TAKEN"
  BLOCKERS+=("sous-domaine déjà utilisé par un autre site : choisis-en un autre (ex. tableau.$(cut -d. -f2- <<<"$DOMAIN"))")
else
  ok "$DOMAIN n'est utilisé par aucun site existant"
fi
case "$NODE_PLAN" in
  system) ok "Node.js : $NODE_SYS déjà installé, utilisé tel quel" ;;
  private-existing) ok "Node.js : Node privé de l'application ($("$APP_DIR/node/bin/node" -v)), le Node du système n'est pas utilisé" ;;
  private) ok "Node.js : ${NODE_SYS:-absent} sur le système → Node 22 PRIVÉ dans $APP_DIR/node (celui du système reste intact)" ;;
esac
if [ -z "$PORT" ]; then
  bad "Aucun port libre entre 8787 et 8799 pour l'application"
  BLOCKERS+=("aucun port local libre (8787-8799)")
elif [ -n "$PORT_OWNER" ] && [ "$PORT_OWNER" != node ] && ! port_is_ours "$PORT"; then
  bad "Port $PORT déjà utilisé par $PORT_OWNER"
  BLOCKERS+=("port $PORT pris par $PORT_OWNER")
else
  ok "Application : écoutera sur 127.0.0.1:$PORT (accessible seulement via Nginx)"
fi
if [ -n "$DNS_IP" ]; then
  if grep -qw -- "$DNS_IP" <<<"$MY_IPS $PUBLIC_IP"; then
    ok "DNS : $DOMAIN → $DNS_IP (ce VPS)"
  else
    warn "DNS : $DOMAIN → $DNS_IP, mais ce VPS semble être ${PUBLIC_IP:-$MY_IPS} (proxy Cloudflare ? sinon corrige le DNS)"
  fi
else
  warn "DNS : $DOMAIN ne pointe encore nulle part (crée l'enregistrement A, sinon pas de HTTPS)"
fi
[ -d "$APP_DIR" ] && ok "Installation existante : mise à jour (données et configuration conservées)"

say "Ce que l'installation ajoutera"
echo "  • $APP_DIR (application) et $DATA_DIR (données), utilisateur système $APP_USER"
echo "  • service systemd « $SERVICE » sur 127.0.0.1:${PORT:-?}"
[ "$NODE_PLAN" = private ] && echo "  • Node.js 22 dans $APP_DIR/node (téléchargé depuis nodejs.org, somme SHA-256 vérifiée)"
if [ "${#APT_PKGS[@]}" -gt 0 ]; then echo "  • paquets : ${APT_PKGS[*]}"; else echo "  • aucun paquet système à ajouter"; fi
if [ "$MANAGE_NGINX" -eq 1 ]; then
  echo "  • site Nginx : $SITE${LINK:+ (+ lien dans sites-enabled)}, pour $DOMAIN seulement"
  echo "  • rechargement de Nginx (reload, sans coupure) après « nginx -t » ; retiré si le test échoue"
  echo "  • certificat HTTPS Let's Encrypt pour $DOMAIN seulement"
else
  echo "  • RIEN dans Nginx ($NGINX_WHY) : tu ajouteras toi-même un proxy"
  echo "      $DOMAIN  →  http://127.0.0.1:${PORT:-8787}   (voir docs/DEPLOIEMENT.md)"
fi
echo "  Rien d'autre n'est modifié : nginx.conf, tes autres sites, MySQL/phpMyAdmin restent tels quels."

if [ "${#BLOCKERS[@]}" -gt 0 ]; then
  say "À corriger avant d'installer"
  for b in "${BLOCKERS[@]}"; do bad "$b"; done
  [ "$MODE" = check ] && exit 1
  die "installation annulée, rien n'a été modifié."
fi
if [ "$MODE" = check ]; then
  say "Vérification terminée : rien n'a été modifié"
  echo "  Tout est bon. Pour installer : relance sans --verifier."
  exit 0
fi

if [ "$ASSUME_YES" -eq 0 ]; then
  [ -t 0 ] || die "confirmation impossible (pas de terminal) : relance avec --oui."
  printf "\nContinuer l'installation ? [o/N] "
  read -r reponse
  [[ "$reponse" =~ ^[oOyY] ]] || die "installation annulée, rien n'a été modifié."
fi

# ============================================================================ installation

say "Paquets système"
export DEBIAN_FRONTEND=noninteractive
if [ "${#APT_PKGS[@]}" -gt 0 ]; then
  apt-get update -qq
  apt-get install -y -qq --no-upgrade "${APT_PKGS[@]}" >/dev/null
  echo "Ajoutés : ${APT_PKGS[*]}"
else
  echo "Rien à ajouter."
fi

say "Node.js"
case "$NODE_PLAN" in
  system) NODE_DIR="$(dirname "$(command -v node)")" ;;
  private-existing) NODE_DIR="$APP_DIR/node/bin" ;;
  private)
    case "$(uname -m)" in
      x86_64) ARCH=x64 ;;
      aarch64 | arm64) ARCH=arm64 ;;
      *) die "processeur $(uname -m) non prévu : installe Node.js 22 toi-même puis relance." ;;
    esac
    BASE=https://nodejs.org/dist/latest-v22.x
    SUMS="$(curl -fsSL "$BASE/SHASUMS256.txt")" || die "impossible de joindre nodejs.org"
    FILE="$(awk -v a="linux-$ARCH.tar.xz" '$2 ~ a"$" {print $2; exit}' <<<"$SUMS")"
    SUM="$(awk -v f="$FILE" '$2 == f {print $1}' <<<"$SUMS")"
    [ -n "$FILE" ] && [ -n "$SUM" ] || die "version de Node.js introuvable sur nodejs.org"
    TMP="$(mktemp -d)"
    curl -fsSL -o "$TMP/$FILE" "$BASE/$FILE"
    echo "$SUM  $TMP/$FILE" | sha256sum -c --quiet - || die "somme de contrôle de Node.js invalide"
    mkdir -p "$APP_DIR/node"
    tar -xJf "$TMP/$FILE" -C "$APP_DIR/node" --strip-components=1
    rm -rf "$TMP"
    NODE_DIR="$APP_DIR/node/bin"
    ;;
esac
export PATH="$NODE_DIR:$PATH"
NODE_BIN="$NODE_DIR/node"
echo "Node.js $("$NODE_BIN" -v) ($NODE_BIN), npm $(npm -v)"

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
    --exclude 'server/data' --exclude 'server/.env' --exclude 'firmware' --exclude '.git' --exclude '/node' \
    "$SRC_DIR/" "$APP_DIR/"
fi
# Fins de ligne Windows éventuelles (projet copié depuis un PC).
find "$APP_DIR/deploy" -type f \( -name '*.sh' -o -name '*.service' -o -name '*.conf' \) -exec sed -i 's/\r$//' {} +

# Installe les dépendances exactes du projet ; si le fichier de versions ne convient pas
# à ce processeur ou à cette version de npm, retombe sur une installation classique.
deps() {
  npm ci --no-audit --no-fund --loglevel=error ||
    { warn "npm ci impossible, installation classique des dépendances"; npm install --no-audit --no-fund --loglevel=error; }
}

say "Compilation de l'API"
cd "$APP_DIR/server"
deps
npm run build
# Modules natifs (base SQLite, images) : vérifiés tout de suite plutôt qu'au démarrage.
native_ok() { "$NODE_BIN" -e "new (require('better-sqlite3'))(':memory:'); require('sharp')" >/dev/null 2>&1; }
if ! native_ok; then
  warn "modules natifs à recompiler pour ce serveur ($(uname -m), Node $("$NODE_BIN" -v))"
  npm rebuild better-sqlite3 sharp --loglevel=error || true
  native_ok || die "better-sqlite3 ou sharp ne se charge pas : envoie-moi la sortie de « cd $APP_DIR/server && node -e \"require('better-sqlite3'); require('sharp')\" »."
fi
say "Compilation de la console web"
cd "$APP_DIR/web"
deps
npm run build
cd "$APP_DIR/server"
npm prune --omit=dev --no-audit --no-fund --loglevel=error >/dev/null

if [ ! -f "$ENV_FILE" ]; then
  say "Création de la configuration ($ENV_FILE)"
  {
    echo "PUBLIC_URL=https://$DOMAIN"
    echo "SECRET_KEY=$(openssl rand -base64 32)"
    echo "HOST=127.0.0.1"
    echo "PORT=$PORT"
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

# Mise à jour depuis la version à un seul compte : la base est convertie (comptes, foyers)
# au premier lancement. Le service est arrêté pour que personne n'écrive dedans pendant la
# conversion, et une copie de l'ancienne base est gardée au cas où.
if [ -f "$DATA_DIR/smart-dashboard.db" ] && [ ! -f "$DATA_DIR/main.db" ]; then
  say "Conversion des données au format multi-comptes"
  systemctl stop $SERVICE 2>/dev/null || true
  SAUVEGARDE="$DATA_DIR/avant-comptes-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$SAUVEGARDE"
  for f in smart-dashboard.db smart-dashboard.db-wal smart-dashboard.db-shm; do
    [ -f "$DATA_DIR/$f" ] && cp -a "$DATA_DIR/$f" "$SAUVEGARDE/"
  done
  chown -R "$APP_USER:$APP_USER" "$SAUVEGARDE"
  chmod 700 "$SAUVEGARDE"
  echo "  Copie de l'ancienne base : $SAUVEGARDE"
  echo "  Après la mise à jour, connecte-toi avec l'identifiant « admin » et ton mot de passe habituel."
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
for _ in 1 2 3 4 5; do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 2
done
systemctl is-active --quiet $SERVICE || { journalctl -u $SERVICE -n 30 --no-pager; die "le service ne démarre pas (voir ci-dessus)."; }
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null && echo "API OK sur 127.0.0.1:$PORT"

if [ "$MANAGE_NGINX" -eq 0 ]; then
  say "Nginx : non modifié ($NGINX_WHY)"
  cat <<EOF
Ajoute un proxy pour $DOMAIN vers http://127.0.0.1:$PORT (avec HTTPS), par exemple
dans ton panneau : « Reverse proxy » / « Proxy » → http://127.0.0.1:$PORT.
Le détail est dans docs/DEPLOIEMENT.md, section « Nginx géré autrement ».
EOF
else
  say "Site Nginx pour $DOMAIN"
  # (Ré)écrit le site s'il n'existe pas ou si le domaine a changé ; sinon on garde la
  # version complétée par Certbot (bloc HTTPS).
  NEW_SITE=0
  if [ ! -f "$SITE" ] || ! grep -q "server_name $DOMAIN;" "$SITE"; then
    [ -f "$SITE" ] && cp "$SITE" "$SITE.bak"
    sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__PORT__/$PORT/g" "$APP_DIR/deploy/nginx-smart-dashboard.conf" >"$SITE"
    [ -f /proc/net/if_inet6 ] || sed -i '/listen \[::\]/d' "$SITE"  # VPS sans IPv6
    NEW_SITE=1
  fi
  NEW_LINK=0
  if [ -n "$LINK" ] && [ ! -L "$LINK" ]; then ln -s "$SITE" "$LINK"; NEW_LINK=1; fi
  if ! nginx -t; then
    # On remet Nginx exactement comme avant : tes sites continuent de fonctionner.
    [ "$NEW_LINK" -eq 1 ] && rm -f "$LINK"
    if [ "$NEW_SITE" -eq 1 ]; then
      if [ -f "$SITE.bak" ]; then mv "$SITE.bak" "$SITE"; else rm -f "$SITE"; fi
    fi
    die "la configuration Nginx ne passe pas le test : le site ajouté a été retiré, Nginx n'a pas été rechargé."
  fi
  rm -f "$SITE.bak"
  if systemctl is-active --quiet nginx; then systemctl reload nginx; else systemctl enable --now nginx; fi

  say "Certificat HTTPS (Let's Encrypt)"
  if grep -q "ssl_certificate" "$SITE"; then
    echo "HTTPS déjà configuré pour $DOMAIN."
  elif ! command -v certbot >/dev/null || ! certbot plugins 2>/dev/null | grep -q '^\* nginx'; then
    echo "⚠ Certbot (module nginx) indisponible : installe-le puis lance « sudo certbot --nginx -d $DOMAIN --redirect »."
  else
    echo "Le domaine $DOMAIN doit déjà pointer vers l'IP de ce VPS (enregistrement DNS A/AAAA)."
    # --nginx ne modifie que le bloc server_name $DOMAIN (notre fichier).
    CERTBOT=(certbot --nginx -d "$DOMAIN" --redirect --keep-until-expiring)
    if [ -n "$EMAIL" ]; then CERTBOT+=(--non-interactive --agree-tos -m "$EMAIL"); fi
    "${CERTBOT[@]}" || echo "⚠ Certbot a échoué : vérifie le DNS puis relance « sudo certbot --nginx -d $DOMAIN --redirect »."
  fi
fi

say "Terminé"
cat <<EOF
Console : https://$DOMAIN
  - Connecte-toi avec ton identifiant administrateur (« admin » après une mise à jour) et ton mot de passe.
  - Administration › Clés API & services : renseigne l'app Spotify du serveur (voir docs/INTEGRATIONS.md).
  - Services : connecte les comptes de ton foyer (Spotify, iCloud, Pathé, Roblox, météo).
  - Mes écrans › « Ajouter un écran » : associe chaque tablette avec son code.
  - Administration › Comptes & invitations : invite d'autres personnes (chacune a son propre foyer).

Commandes utiles :
  sudo systemctl status $SERVICE        # état du service
  sudo journalctl -u $SERVICE -f        # journaux en direct
  cd $APP_DIR/server && sudo -u $APP_USER $NODE_BIN dist/cli.js users            # liste des comptes
  cd $APP_DIR/server && sudo -u $APP_USER $NODE_BIN dist/cli.js reset-password   # mot de passe oublié
Mise à jour : relance deploy/envoyer-sur-vps.ps1 depuis ton PC (les données sont conservées).
Données : $DATA_DIR (main.db + households/*.db, captures, cache d'images). Sauvegarde aussi $ENV_FILE.
EOF
