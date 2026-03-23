"""
tools/make_pwa_icons.py — Génère les icônes PNG pour le PWA manifest.

Usage :
    python tools/make_pwa_icons.py

Produit :
    static/icons/icon-192.png
    static/icons/icon-512.png
    static/icons/icon-maskable-512.png  (avec marge "safe zone" pour masques)

Aucune dépendance externe — PNG écrit en Python pur (zlib + struct).
"""
import os
import struct
import zlib
from pathlib import Path

OUT_DIR = Path(__file__).parent.parent / "static" / "icons"

# ── Palette ──────────────────────────────────────────────────
BG     = (37,  99, 235, 255)   # bleu  #2563eb
WHITE  = (255, 255, 255, 255)
W_DIM  = (255, 255, 255, 100)  # blanc semi-transparent
RED    = (239,  68,  68, 255)  # #ef4444
YELLOW = (234, 179,   8, 255)  # #eab308
TRANS  = (  0,   0,   0,   0)  # transparent


def _blend(fg: tuple, bg: tuple) -> tuple:
    """Alpha-composite fg over bg (all RGBA)."""
    a = fg[3] / 255
    return (
        int(fg[0] * a + bg[0] * (1 - a)),
        int(fg[1] * a + bg[1] * (1 - a)),
        int(fg[2] * a + bg[2] * (1 - a)),
        255,
    )


def _draw(size: int, safe_zone: float = 0.0) -> list:
    """
    Dessine le logo sur une grille RGBA `size × size`.

    safe_zone : fraction du bord réservée (0.0 = plein cadre, 0.1 = 10 % de marge)
                → utilisé pour les icônes maskable (safe zone = 10 %)
    """
    img = [[BG] * size for _ in range(size)]
    margin = int(size * safe_zone)

    def rect(x1, y1, x2, y2, color):
        for y in range(max(0, y1), min(size, y2 + 1)):
            for x in range(max(0, x1), min(size, x2 + 1)):
                img[y][x] = _blend(color, img[y][x]) if color[3] < 255 else color

    inner = size - 2 * margin
    p     = max(1, inner // 16)
    s     = inner

    ox = margin  # origin x
    oy = margin  # origin y

    col_w  = s // 5
    col_h  = s - 4 * p
    gap    = max(1, s // 10)
    col1_x = ox + 2 * p
    col2_x = col1_x + col_w + gap

    # Fond colonnes
    rect(col1_x, oy + 2 * p, col1_x + col_w, oy + 2 * p + col_h, (255, 255, 255, 30))
    rect(col2_x, oy + 2 * p, col2_x + col_w, oy + 2 * p + col_h, (255, 255, 255, 30))

    # En-têtes
    hdr_h = max(1, s // 12)
    rect(col1_x + p, oy + 2 * p,
         col1_x + col_w - p, oy + 2 * p + hdr_h, WHITE)
    rect(col2_x + p, oy + 2 * p,
         col2_x + col_w - p, oy + 2 * p + hdr_h, WHITE)

    # Lignes de données
    row_h   = max(1, s // 14)
    row_gap = max(1, s // 20)
    for i in range(1, 5):
        y = oy + 2 * p + hdr_h + (row_h + row_gap) * i
        if y + row_h > oy + 2 * p + col_h:
            break
        rect(col1_x + p, y, col1_x + col_w - p, y + row_h, W_DIM)
        rect(col2_x + p, y, col2_x + col_w - p, y + row_h, W_DIM)

    # Ligne KO rouge (3ème ligne)
    ko_y = oy + 2 * p + hdr_h + (row_h + row_gap) * 3
    if ko_y + row_h <= oy + 2 * p + col_h:
        rect(col2_x + p, ko_y, col2_x + col_w - p, ko_y + row_h, RED)

    # Barre diagonale jaune
    dlen  = max(2, s // 4)
    thick = max(1, s // 14)
    dx    = ox + s - 2 * p - dlen
    dy    = oy + s - 2 * p - dlen
    for i in range(dlen):
        for t in range(-thick // 2, thick // 2 + 1):
            xx, yy = dx + i, dy + i + t
            if 0 <= xx < size and 0 <= yy < size:
                img[yy][xx] = YELLOW

    return img


# ── PNG writer (pur Python) ──────────────────────────────────

def _make_png(img: list, size: int) -> bytes:
    """Encode une grille RGBA en PNG binaire."""

    def _chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return (struct.pack(">I", len(data)) + body
                + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF))

    # IHDR: width, height, bit-depth=8, color-type=6(RGBA), compress=0, filter=0, interlace=0
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)

    # Raw scanlines: filter-byte 0 (None) + RGBA pixels
    raw = bytearray()
    for row in img:
        raw += b"\x00"
        for r, g, b, a in row:
            raw += bytes([r, g, b, a])

    idat = zlib.compress(bytes(raw), level=9)

    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", idat)
        + _chunk(b"IEND", b"")
    )


# ── Entrée principale ────────────────────────────────────────

def build_icons():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    specs = [
        ("icon-192.png",          192, 0.00),
        ("icon-512.png",          512, 0.00),
        ("icon-maskable-512.png", 512, 0.10),  # safe zone 10 %
    ]

    for filename, size, safe_zone in specs:
        img  = _draw(size, safe_zone)
        data = _make_png(img, size)
        path = OUT_DIR / filename
        path.write_bytes(data)
        print(f"✓  {path.relative_to(OUT_DIR.parent.parent)}  ({len(data) // 1024} Ko)")

    print()
    print("Icônes PWA générées dans static/icons/")


if __name__ == "__main__":
    print("Génération des icônes PWA …")
    build_icons()
