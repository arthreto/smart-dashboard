#!/usr/bin/env bash
# Compile (si besoin) puis lance l'émulateur de l'écran.
# Sous Windows : à exécuter dans Ubuntu (WSL2), voir docs/EMULATEUR.md.
#
#   bash firmware/tools/emulateur.sh --demo                 données d'exemple, sans serveur
#   bash firmware/tools/emulateur.sh                        assistant d'appairage avec ton serveur
#   bash firmware/tools/emulateur.sh --reset                oublie l'appairage
#   bash firmware/tools/emulateur.sh --screenshots captures captures PPM de tous les écrans
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="${SD_BUILD_DIR:-$HOME/.cache/smart-dashboard-sim-build}"

need=()
command -v cmake >/dev/null || need+=(cmake)
command -v g++ >/dev/null || need+=(build-essential)
command -v git >/dev/null || need+=(git)
command -v pkg-config >/dev/null || need+=(pkg-config)
pkg-config --exists sdl2 2>/dev/null || need+=(libsdl2-dev)
[ -f /usr/include/curl/curl.h ] || [ -f /usr/include/x86_64-linux-gnu/curl/curl.h ] || need+=(libcurl4-openssl-dev)
[ -f /usr/include/openssl/evp.h ] || need+=(libssl-dev)
command -v ffmpeg >/dev/null || need+=(ffmpeg)  # caméra simulée (galerie)
if [ ${#need[@]} -gt 0 ]; then
  echo "==> Installation des outils manquants : ${need[*]}"
  sudo apt-get update -qq
  sudo apt-get install -y "${need[@]}"
fi

# Le dossier de compilation reste côté Linux (bien plus rapide que /mnt/c).
echo "==> Compilation (première fois : quelques minutes, LVGL est téléchargé)"
# Projet déplacé (autre dossier) : l'ancien dossier de compilation ne sert plus.
if [ -f "$BUILD/CMakeCache.txt" ] && ! grep -qxF "CMAKE_HOME_DIRECTORY:INTERNAL=$HERE" "$BUILD/CMakeCache.txt"; then
  echo "==> Le projet a changé de dossier : nouvelle compilation"
  rm -rf "$BUILD"
fi
cmake -S "$HERE" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$BUILD" -j"$(nproc)"

# Sous WSL (Windows) : fenêtre X11 et rendu logiciel, la combinaison la plus fiable
# (avec l'accélération 3D, la fenêtre peut apparaître dans la barre des tâches mais rester vide).
if grep -qi microsoft /proc/version 2>/dev/null; then
  export SDL_VIDEODRIVER="${SDL_VIDEODRIVER:-x11}"
  export SDL_RENDER_DRIVER="${SDL_RENDER_DRIVER:-software}"
  export LIBGL_ALWAYS_SOFTWARE=1
  [ -n "${DISPLAY:-}" ] || export DISPLAY=:0
fi

echo "==> Lancement de l'émulateur"
echo "    B : bouton du boîtier · R : tester une alarme · L : verrouiller · S : capture · Échap : fermer"
exec "$BUILD/smart_dashboard_sim" "$@"
