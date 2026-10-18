#!/usr/bin/env python3
"""Polices d'emojis (Noto Emoji, monochrome, licence OFL) pour l'écran.

Lit la liste des emojis dans server/src/deviceText.ts (entre EMOJIS-DEBUT et EMOJIS-FIN),
génère app/fonts/emoji_<taille>.c avec lv_font_conv, puis branche chaque police de texte
(fig_*.c) sur l'emoji de même taille comme police de secours (champ `fallback`) : la
hauteur de ligne du texte ne change pas, les emojis s'affichent dans la couleur du texte.

Usage (depuis gen_fonts.sh) : python3 gen_emoji.py <dossier node_modules> <dossier fonts>
"""
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
LIST = HERE.parent.parent / "server" / "src" / "deviceText.ts"
SIZES = [14, 16, 18, 20, 22, 24, 32]
# Police de texte → taille de l'emoji associé.
TEXT_FONTS = {
    "fig_m14": 14, "fig_m16": 16, "fig_m18": 18, "fig_s14": 14, "fig_s16": 16, "fig_s18": 18,
    "fig_s20": 20, "fig_s22": 22, "fig_b24": 24, "fig_b32": 32, "fig_b44": 32,  # 44 px : titres, rares
}


def emoji_codepoints() -> list[int]:
    text = LIST.read_text(encoding="utf-8")
    block = text.split("EMOJIS-DEBUT", 1)[1].split("EMOJIS-FIN", 1)[0]
    cps = sorted({ord(c) for lit in re.findall(r"'([^']*)'", block) for c in lit if ord(c) > 0x2000})
    return cps


def subsets(node_modules: Path) -> list[tuple[Path, list[tuple[int, int]]]]:
    pkg = node_modules / "@fontsource" / "noto-emoji"
    css = (pkg / "500.css").read_text(encoding="utf-8")
    out = []
    for block in css.split("@font-face")[1:]:
        woff = re.search(r"url\(\./files/([^)]+\.woff)\) format\('woff'\)", block)
        rng = re.search(r"unicode-range:\s*([^;]+);", block)
        if not woff or not rng:
            continue
        ranges = []
        for part in rng.group(1).split(","):
            part = part.strip().replace("U+", "")
            a, _, b = part.partition("-")
            ranges.append((int(a, 16), int(b or a, 16)))
        out.append((pkg / "files" / woff.group(1), ranges))
    return out


def main() -> None:
    node_modules, fonts = Path(sys.argv[1]), Path(sys.argv[2])
    wanted = emoji_codepoints()
    by_file: dict[Path, list[int]] = {}
    missing = []
    for cp in wanted:
        for f, ranges in subsets(node_modules):
            if any(a <= cp <= b for a, b in ranges):
                by_file.setdefault(f, []).append(cp)
                break
        else:
            missing.append(cp)
    if missing:
        print("  emojis absents de Noto Emoji :", " ".join(chr(c) for c in missing))
    args = []
    for f, cps in by_file.items():
        args += ["--font", str(f), "-r", ",".join(hex(c) for c in cps)]

    for size in SIZES:
        name = f"emoji_{size}"
        subprocess.run(
            ["npx", "lv_font_conv", "--bpp", "4", "--size", str(size), "--format", "lvgl", "--no-compress",
             "--lv-include", "lvgl.h", *args, "-o", str(fonts / f"{name}.c")],
            check=True, cwd=node_modules.parent,
        )
        print(f"  {name} ({len(wanted) - len(missing)} emojis)")

    for font, size in TEXT_FONTS.items():
        path = fonts / f"{font}.c"
        src = path.read_text(encoding="utf-8")
        decl = f"extern const lv_font_t emoji_{size};\n"
        src = re.sub(r"extern const lv_font_t emoji_\d+;\n", "", src)
        src = re.sub(r"\.fallback = (NULL|&emoji_\d+),", f".fallback = &emoji_{size},", src)
        if decl not in src:
            src = re.sub(r"(\n(?:#if LVGL_VERSION_MAJOR >= 8\n)?const lv_font_t " + font + r" = \{)", "\n" + decl + r"\1", src, count=1)
        path.write_text(src, encoding="utf-8")
    print("  polices de texte reliées aux emojis")


if __name__ == "__main__":
    main()
