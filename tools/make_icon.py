"""
tools/make_icon.py — Génère DataAuditor.ico pour l'exécutable Windows.

Usage :
    pip install Pillow
    python tools/make_icon.py

Produit : tools/DataAuditor.ico  (multi-résolution : 16/32/48/256 px)
"""
import os
import struct
import zlib
from pathlib import Path

OUTPUT = Path(__file__).parent / "DataAuditor.ico"

# ── Palette de couleurs (cohérente avec le favicon SVG) ──────
BG      = (37,  99, 235)   # bleu  #2563eb
WHITE   = (255, 255, 255)
RED     = (239,  68,  68)  # rouge #ef4444
YELLOW  = (234, 179,   8)  # jaune #eab308
MUTED   = (148, 163, 184)  # gris clair


def _draw(size: int) -> list[list[tuple]]:
    """Dessine le logo DataAuditor en pixels pour une taille donnée."""
    img = [[BG] * size for _ in range(size)]

    def rect(x1, y1, x2, y2, color):
        for y in range(max(0, y1), min(size, y2 + 1)):
            for x in range(max(0, x1), min(size, x2 + 1)):
                img[y][x] = color

    def fill_alpha_rect(x1, y1, x2, y2, color, alpha=0.85):
        """Rectangle avec mélange alpha sur fond bleu."""
        for y in range(max(0, y1), min(size, y2 + 1)):
            for x in range(max(0, x1), min(size, x2 + 1)):
                bg = BG
                r = int(bg[0] + (color[0] - bg[0]) * alpha)
                g = int(bg[1] + (color[1] - bg[1]) * alpha)
                b = int(bg[2] + (color[2] - bg[2]) * alpha)
                img[y][x] = (r, g, b)

    s = size
    p = max(1, s // 16)   # padding unitaire

    # Deux colonnes de "données" (représentant ref et target)
    col_w  = s // 5
    col_h  = s - 4 * p
    gap    = s // 10
    col1_x = p * 2
    col2_x = col1_x + col_w + gap

    # Fond légèrement transparent des colonnes
    fill_alpha_rect(col1_x, 2 * p, col1_x + col_w, 2 * p + col_h, WHITE, 0.15)
    fill_alpha_rect(col2_x, 2 * p, col2_x + col_w, 2 * p + col_h, WHITE, 0.15)

    # Lignes d'en-tête des colonnes (blanc)
    rect(col1_x + p, 2 * p,       col1_x + col_w - p, 2 * p + max(1, s // 12), WHITE)
    rect(col2_x + p, 2 * p,       col2_x + col_w - p, 2 * p + max(1, s // 12), WHITE)

    # Lignes de données (blanc atténué)
    row_h = max(1, s // 14)
    row_gap = max(1, s // 20)
    for i in range(1, 5):
        y = 2 * p + max(1, s // 12) + (row_h + row_gap) * i
        if y + row_h > 2 * p + col_h:
            break
        fill_alpha_rect(col1_x + p, y, col1_x + col_w - p, y + row_h, WHITE, 0.45)
        fill_alpha_rect(col2_x + p, y, col2_x + col_w - p, y + row_h, WHITE, 0.45)

    # Ligne "écart" rouge dans la colonne cible (3ème ligne de données)
    ko_y = 2 * p + max(1, s // 12) + (row_h + row_gap) * 3
    if ko_y + row_h <= 2 * p + col_h:
        rect(col2_x + p, ko_y, col2_x + col_w - p, ko_y + row_h, RED)

    # Barre diagonale jaune (symbolise l'audit / détection d'écart)
    diag_len = max(2, s // 4)
    diag_x   = s - 2 * p - diag_len
    diag_y   = s - 2 * p - diag_len
    thickness = max(1, s // 14)
    for i in range(diag_len):
        for t in range(-thickness // 2, thickness // 2 + 1):
            xx = diag_x + i
            yy = diag_y + i + t
            if 0 <= xx < s and 0 <= yy < s:
                img[yy][xx] = YELLOW

    return img


def _pixels_to_rgba(img: list) -> bytes:
    """Convertit la grille de pixels RGB en bytes BGRA (format ICO)."""
    out = bytearray()
    for row in img:
        for r, g, b in row:
            out += bytes([b, g, r, 255])
    return bytes(out)


def _make_ico_image(size: int) -> bytes:
    """Génère un bloc d'image BMP pour l'ICO (DIB sans en-tête fichier)."""
    pixels = _draw(size)
    pixel_data = _pixels_to_rgba(pixels)

    # BITMAPINFOHEADER (40 bytes)
    width  = size
    height = size * 2    # convention ICO : hauteur × 2
    planes = 1
    bpp    = 32
    compression = 0
    image_size  = len(pixel_data)
    header = struct.pack("<IiiHHIIiiII",
        40, width, height, planes, bpp,
        compression, image_size, 0, 0, 0, 0)

    # Pixel data (lignes en ordre inverse pour BMP)
    rows_reversed = bytearray()
    for row in reversed(pixels):
        for r, g, b in row:
            rows_reversed += bytes([b, g, r, 255])

    # Masque AND (tout transparent = 0)
    mask_row_bytes = ((size + 31) // 32) * 4
    and_mask = bytes(mask_row_bytes * size)

    return header + bytes(rows_reversed) + and_mask


def build_ico(sizes=(256, 48, 32, 16)):
    """Construit un fichier .ICO multi-résolution."""
    images = {s: _make_ico_image(s) for s in sizes}

    # ICO header
    n = len(sizes)
    header = struct.pack("<HHH", 0, 1, n)

    # Directory entries (16 bytes chacun)
    offset = 6 + n * 16
    directory = bytearray()
    for s in sizes:
        data = images[s]
        w = 0 if s >= 256 else s   # 0 = 256 dans le format ICO
        h = 0 if s >= 256 else s
        directory += struct.pack("<BBBBHHII",
            w, h,    # width, height (0 pour 256+)
            0, 0,    # color count, reserved
            1, 32,   # planes, bit count
            len(data), offset)
        offset += len(data)

    # Assembler
    ico = header + bytes(directory)
    for s in sizes:
        ico += images[s]

    return ico


if __name__ == "__main__":
    print("Génération de DataAuditor.ico …")
    ico_data = build_ico(sizes=(256, 48, 32, 16))
    OUTPUT.write_bytes(ico_data)
    print(f"✓ Icône créée : {OUTPUT}  ({len(ico_data) / 1024:.0f} Ko)")
    print()
    print("Tailles incluses : 256×256, 48×48, 32×32, 16×16")
    print()
    print("Note : pour une meilleure qualité, convertissez static/favicon.svg")
    print("       en ICO avec un outil en ligne (ex. convertio.co) et remplacez")
    print("       tools/DataAuditor.ico avant le build PyInstaller.")
