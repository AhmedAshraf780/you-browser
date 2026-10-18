#!/usr/bin/env python3
"""Generate build/icon.png (512x512) with stdlib only: deep-navy rounded
square with an ice-blue eclipse ring and orbit dot.
Re-run: python3 scripts/make-icon.py"""
import struct
import zlib
import math
import os

SIZE = 512
BG = (0, 0, 16)            # abyss
RING = (138, 180, 255)     # ice blue
DOT = (232, 236, 255)      # pale orbit dot
CORNER_R = 116
RING_R = 128
RING_W = 30
GLOW = 90                  # soft halo falloff px
OUT = os.path.join(os.path.dirname(__file__), '..', 'build', 'icon.png')

CX = CY = SIZE // 2
# orbit dot sits on the ring, upper-right
DOT_X = CX + int(RING_R * 0.72)
DOT_Y = CY - int(RING_R * 0.70)
DOT_R = 30


def in_rounded_rect(x, y):
    dx = min(x, SIZE - 1 - x)
    dy = min(y, SIZE - 1 - y)
    if dx >= CORNER_R or dy >= CORNER_R:
        return True
    cx = CORNER_R - 1 - dx
    cy = CORNER_R - 1 - dy
    return cx * cx + cy * cy <= CORNER_R * CORNER_R


def main():
    raw = bytearray()
    for y in range(SIZE):
        raw.append(0)  # filter byte: none
        for x in range(SIZE):
            if not in_rounded_rect(x, y):
                raw.extend((0, 0, 0, 0))
                continue
            d_ring = abs(math.hypot(x - CX, y - CY) - RING_R)
            d_dot = math.hypot(x - DOT_X, y - DOT_Y)
            if d_dot <= DOT_R:
                raw.extend((*DOT, 255))
            elif d_ring <= RING_W / 2:
                raw.extend((*RING, 255))
            elif d_ring <= RING_W / 2 + GLOW:
                # soft halo fading into the abyss
                a = max(0.0, 1.0 - (d_ring - RING_W / 2) / GLOW) * 0.22
                r = round(BG[0] + (RING[0] - BG[0]) * a)
                g = round(BG[1] + (RING[1] - BG[1]) * a)
                b = round(BG[2] + (RING[2] - BG[2]) * a)
                raw.extend((r, g, b, 255))
            else:
                raw.extend((*BG, 255))

    def chunk(tag, data):
        out = struct.pack('>I', len(data)) + tag + data
        return out + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b'')
    )
    os.makedirs(os.path.dirname(OUT) or '.', exist_ok=True)
    with open(OUT, 'wb') as f:
        f.write(png)
    print(f'wrote {OUT} ({len(png) // 1024} KB)')


if __name__ == '__main__':
    main()
