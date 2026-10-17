#!/usr/bin/env python3
"""Recentre verticalement les grandes polices de chiffres générées par lv_font_conv.

Ces polices ne contiennent que des chiffres : lv_font_conv réserve pourtant sous la
ligne de base la place des lettres à jambage, et presque rien au-dessus des chiffres.
Résultat : un grand « 18:00 » paraît collé au texte placé au-dessus et laisse un vide
en dessous. On abaisse donc la ligne de base pour que l'espace soit le même en haut et
en bas des chiffres, sans changer la hauteur de ligne (la mise en page ne bouge pas)
ni couper les glyphes qui descendent sous la ligne (virgule, barre oblique…).

Usage : balance_digits.py police.c [police.c …]
"""
import re
import sys

DIGITS = [ord(c) for c in "0123456789"]


def balance(path):
    src = open(path, encoding="utf-8").read()
    line_h = int(re.search(r"\.line_height = (\d+)", src).group(1))
    base = int(re.search(r"\.base_line = (\d+)", src).group(1))
    glyphs = [tuple(int(v) for v in m) for m in re.findall(
        r"\{\.bitmap_index = \d+, \.adv_w = \d+, \.box_w = \d+, \.box_h = (\d+), \.ofs_x = -?\d+, \.ofs_y = (-?\d+)\}", src)]
    # Correspondance glyphe ↔ caractère (table « sparse tiny » : glyphe = début + rang).
    start = int(re.search(r"\.range_start = (\d+)", src).group(1))
    first = int(re.search(r"\.glyph_id_start = (\d+)", src).group(1))
    lst = re.search(r"unicode_list_0\[\] = \{([^}]*)\}", src)
    offsets = [int(v, 16) for v in re.findall(r"0x[0-9a-fA-F]+", lst.group(1))] if lst else []
    by_char = {start + o: glyphs[first + i] for i, o in enumerate(offsets) if first + i < len(glyphs)}
    digit_top = max(h + oy for (h, oy) in (by_char[c] for c in DIGITS if c in by_char))
    # Le « j » (pour « 23 j ») n'est jamais affiché dans ces polices : on l'ignore.
    lowest = max([-oy for (c, (h, oy)) in by_char.items() if h > 0 and c != ord("j")] + [0])
    top_gap = line_h - base - digit_top
    shift = max(0, min((base - top_gap) // 2, base - lowest))
    if shift == 0:
        return
    src = src.replace(f".base_line = {base},", f".base_line = {base - shift},", 1)
    open(path, "w", encoding="utf-8").write(src)
    print(f"  {path.rsplit('/', 1)[-1]} : chiffres abaissés de {shift} px")


for p in sys.argv[1:]:
    balance(p)
