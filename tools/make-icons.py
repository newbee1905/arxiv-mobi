#!/usr/bin/env python3
"""Generate the PWA/app icons without any image library.

Draws a rounded-square app tile with a page glyph, writing plain RGBA PNGs.
Re-run after changing the palette:  python3 tools/make-icons.py
"""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets" / "icons"
BG = (11, 99, 197, 255)        # accent blue
PAGE = (247, 248, 250, 255)    # paper
INK = (11, 99, 197, 255)       # bars on the page
ACCENT = (216, 168, 78, 255)   # sioyek-ish amber marker


def rounded_rect(px, size, x0, y0, x1, y1, r, colour):
    """Alpha-blend a rounded rectangle onto the pixel buffer."""
    for y in range(max(0, int(y0)), min(size, int(y1) + 1)):
        for x in range(max(0, int(x0)), min(size, int(x1) + 1)):
            # distance to the nearest corner centre, for the rounded parts
            cx = min(max(x, x0 + r), x1 - r)
            cy = min(max(y, y0 + r), y1 - r)
            dx, dy = x - cx, y - cy
            d = (dx * dx + dy * dy) ** 0.5
            if d <= r:
                a = 1.0
            elif d <= r + 1.2:          # cheap anti-aliasing band
                a = max(0.0, 1.0 - (d - r) / 1.2)
            else:
                continue
            i = (y * size + x) * 4
            sr, sg, sb, sa = colour
            a *= sa / 255
            for k, sc in enumerate((sr, sg, sb)):
                px[i + k] = int(px[i + k] * (1 - a) + sc * a)
            px[i + 3] = max(px[i + 3], int(255 * a))


def write_png(path, size, px):
    raw = bytearray()
    for y in range(size):
        raw.append(0)                                    # filter: none
        raw += px[y * size * 4:(y + 1) * size * 4]
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)
    print(f"{path.name}  {size}x{size}  {len(png)} bytes")


def build(size, maskable=False):
    px = bytearray(size * size * 4)
    pad = 0 if not maskable else size * 0.06
    rounded_rect(px, size, pad, pad, size - 1 - pad, size - 1 - pad,
                 size * (0.12 if maskable else 0.22), BG)
    # page
    m = size * (0.26 if maskable else 0.22)
    rounded_rect(px, size, m, m * 0.92, size - m, size - m * 0.92, size * 0.045, PAGE)
    # text bars
    left = m + size * 0.055
    right = size - m - size * 0.055
    top = m * 0.92 + size * 0.085
    gap = size * 0.105
    h = size * 0.048
    for i, frac in enumerate((1.0, 0.82, 0.93, 0.6)):
        y = top + i * gap
        colour = ACCENT if i == 3 else INK
        rounded_rect(px, size, left, y, left + (right - left) * frac, y + h,
                     h / 2, colour)
    return px


OUT.mkdir(parents=True, exist_ok=True)
for size, name, maskable in ((192, "icon-192.png", False),
                             (512, "icon-512.png", False),
                             (512, "icon-maskable-512.png", True),
                             (180, "apple-touch-icon.png", False)):
    write_png(OUT / name, size, build(size, maskable))
