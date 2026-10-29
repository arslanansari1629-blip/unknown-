#!/usr/bin/env python3
"""Generate the PWA icons with the Python standard library only."""
import math, struct, zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / 'public' / 'icons'
ROOT.mkdir(parents=True, exist_ok=True)

BG = (10, 14, 20, 255)
PANEL = (16, 23, 32, 255)
GREEN = (52, 211, 153, 255)
BLUE = (56, 189, 248, 255)

def inside_poly(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside

def render(size):
    s = size / 512.0
    bolt = [(282,72),(128,292),(228,292),(202,440),(384,196),(272,196)]
    bolt = [(x*s, y*s) for x,y in bolt]
    cx, cy, r = 386*s, 126*s, 26*s
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            # rounded square mask
            rad = 112*s
            dx = max(rad - x, x - (size - rad), 0)
            dy = max(rad - y, y - (size - rad), 0)
            if dx*dx + dy*dy > rad*rad:
                row.extend((0,0,0,0)); continue
            color = BG
            # inner panel
            m = 32*s
            if m <= x < size-m and m <= y < size-m:
                color = PANEL
            if inside_poly(x+0.5, y+0.5, bolt):
                color = GREEN
            if (x-cx)**2 + (y-cy)**2 <= r*r:
                color = BLUE
            row.extend(color)
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag+data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    return png

for size, name in [(192,'icon-192.png'),(512,'icon-512.png'),(180,'apple-touch-icon.png')]:
    (ROOT / name).write_bytes(render(size))
    print('wrote', name)
