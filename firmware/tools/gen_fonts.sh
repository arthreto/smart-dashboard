#!/usr/bin/env bash
# Régénère les polices LVGL (Figtree + icônes Tabler) dans app/fonts/.
# Prérequis : Node.js et Python 3. Usage : bash tools/gen_fonts.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../app/fonts"
WORK="${TMPDIR:-/tmp}/sd-fonts"
mkdir -p "$WORK" "$OUT"
cd "$WORK"
if [ ! -d node_modules/lv_font_conv ]; then
  npm init -y >/dev/null
  npm install --no-audit --no-fund lv_font_conv@1.5.3 @fontsource/figtree@5 @tabler/icons-webfont@3.49.0 >/dev/null
fi
FIG="node_modules/@fontsource/figtree/files"
ICO="node_modules/@tabler/icons-webfont/dist/fonts"
# Texte : latin + ponctuation française (’ « » … › − €) et, depuis le sous-ensemble
# latin-ext, les lettres accentuées d'Europe centrale (noms dans l'agenda, titres de films…).
TEXT="0x20-0x7E,0xA0-0xFF,0x152-0x153,0x2013-0x2014,0x2018-0x201A,0x201C-0x201E,0x2022,0x2026,0x2039-0x203A,0x20AC,0x2122,0x2212"
TEXT_EXT="0x100-0x113,0x116-0x127,0x12a-0x12b,0x12e-0x130,0x132-0x137,0x139-0x13e,0x141-0x148,0x14a-0x14d,0x150-0x151,0x154-0x161,0x164-0x165,0x16a-0x17e"
DIGITS="0x20,0x25,0x2B,0x2C-0x3A,0xB0,0x2013,0x6A,0x6B,0x4D"

conv() { # nom taille police plages [police-latin-ext]
  local extra=()
  if [ -n "${5:-}" ]; then extra=(--font "$5" -r "$TEXT_EXT"); fi
  npx lv_font_conv --bpp 4 --size "$2" --format lvgl --no-compress --lv-include lvgl.h \
    --font "$3" -r "$4" "${extra[@]}" -o "$OUT/$1.c" --force-fast-kern-format
  echo "  $1 ($2 px)"
}

echo "Texte :"
conv fig_m14 14 "$FIG/figtree-latin-500-normal.woff" "$TEXT" "$FIG/figtree-latin-ext-500-normal.woff"
conv fig_m16 16 "$FIG/figtree-latin-500-normal.woff" "$TEXT" "$FIG/figtree-latin-ext-500-normal.woff"
conv fig_m18 18 "$FIG/figtree-latin-500-normal.woff" "$TEXT" "$FIG/figtree-latin-ext-500-normal.woff"
conv fig_s14 14 "$FIG/figtree-latin-600-normal.woff" "$TEXT" "$FIG/figtree-latin-ext-600-normal.woff"
conv fig_s16 16 "$FIG/figtree-latin-600-normal.woff" "$TEXT" "$FIG/figtree-latin-ext-600-normal.woff"
conv fig_s18 18 "$FIG/figtree-latin-600-normal.woff" "$TEXT" "$FIG/figtree-latin-ext-600-normal.woff"
conv fig_s20 20 "$FIG/figtree-latin-600-normal.woff" "$TEXT" "$FIG/figtree-latin-ext-600-normal.woff"
conv fig_s22 22 "$FIG/figtree-latin-600-normal.woff" "$TEXT" "$FIG/figtree-latin-ext-600-normal.woff"
conv fig_b24 24 "$FIG/figtree-latin-700-normal.woff" "$TEXT" "$FIG/figtree-latin-ext-700-normal.woff"
conv fig_b32 32 "$FIG/figtree-latin-700-normal.woff" "$TEXT" "$FIG/figtree-latin-ext-700-normal.woff"
conv fig_b44 44 "$FIG/figtree-latin-700-normal.woff" "$TEXT" "$FIG/figtree-latin-ext-700-normal.woff"
echo "Chiffres :"
conv fig_l54 54 "$FIG/figtree-latin-300-normal.woff" "$DIGITS"
conv fig_l72 72 "$FIG/figtree-latin-300-normal.woff" "$DIGITS"
conv fig_l96 96 "$FIG/figtree-latin-300-normal.woff" "$DIGITS"
conv fig_l124 124 "$FIG/figtree-latin-300-normal.woff" "$DIGITS"
conv fig_l176 176 "$FIG/figtree-latin-300-normal.woff" "$DIGITS"
conv fig_bd54 54 "$FIG/figtree-latin-700-normal.woff" "$DIGITS"
# Chiffres centrés verticalement (sinon collés au texte du dessus).
python3 "$HERE/balance_digits.py" "$OUT"/fig_l54.c "$OUT"/fig_l72.c "$OUT"/fig_l96.c "$OUT"/fig_l124.c "$OUT"/fig_l176.c "$OUT"/fig_bd54.c

# Icônes : contour (tabler-icons) + pleines (tabler-icons-filled).
OUTLINE="0xeac1,0xea67,0xea53,0xea04,0xeafc,0xeafa,0xea8a,0xea59,0xec38,0xeb52,0xecfa,0xeae2,0xeb30,0xeaf8,0xea76,0xea72,0xea73,0xecd9,0xea74,0xec2c,0xea5e,0xf000,0xeb72,0xeabe,0xeb51,0xeb4f,0xea35,0xea60,0xea61,0xea5f,0xeb0b,0xea2d,0xeb5c,0xea97,0xeaed,0xea46,0xeff0,0xea39,0xf6d7,0xec82,0xed4f,0xea77,0xec44,0xeae8,0xeb09,0xec07,0xea37,0xeae5,0xeb6a,0xeb45,0xea2c,0xeb55,0xeb20,0xeb13,0xea8c,0xea70,0xeb43,0xebf2,0xea9a,0xeac7,0xed3e,0xea8b,0xea25,0xeb2e,0xea38,0xea52,0xea33,0xebd9,0xecf5,0xeceb,0xece9,0xeb05,0xeb06,0xec17,0xec74,0xeb41,0xecea,0xed07,0xeaef"
FILLED="0xf691,0xf690,0xf694,0xf693,0xf67c,0xf669,0xf6a9,0xf684,0xf673,0x100c6,0xf680,0xf6af,0xfa49"
echo "Icônes :"
for s in 16 20 24 28 40; do
  npx lv_font_conv --bpp 4 --size "$s" --format lvgl --no-compress --lv-include lvgl.h \
    --font "$ICO/tabler-icons.woff" -r "$OUTLINE" --font "$ICO/tabler-icons-filled.woff" -r "$FILLED" \
    -o "$OUT/icons_$s.c"
  echo "  icons_$s"
done
echo "Polices générées dans $OUT"
