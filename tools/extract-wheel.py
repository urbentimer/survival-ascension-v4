# WHEEL OF FLAME art (Nov 8), from the user's ChatGPT sheets on black (drawn additive in game: black = invisible):
#   tools/art/pyre/fx-wheel-line.png  8 rows, each a long straight line of fire (flames rising up), looping frame to frame
#   tools/art/pyre/fx-wheel-hub.png   16 frames (2 rows x 8) of a burning rune circle (the hub the 4 lines spin round)
# Writes client/assets/sprites/fx/pyre-wheel-line.webp: 8 rows of LW x LH, the line's glowing base at y = LB in each row
#        client/assets/sprites/fx/pyre-wheel-hub.webp:  16 frames in a row, HW x HH each, the circle's centre at (HW/2, HC)
# Prints the numbers the client needs (PYW). Run: python3 tools/extract-wheel.py
import os
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'pyre'); FX = os.path.join(here, '..', 'client', 'assets', 'sprites', 'fx')
def load(n): return np.array(Image.open(os.path.join(ART, n + '.png')).convert('RGB')).astype(int)
def clean(a): a = a.copy(); a[a.max(2) < 10] = 0; return a.astype(np.uint8)

# --- the fire line: 8 bands; each row's base = its brightest horizontal line
a = load('fx-wheel-line'); H, W = a.shape[:2]; band = H / 8; LS = .38; UP, DOWN = 100, 16
occ = np.where((a.max(2) > 40).any(0))[0]; x0, x1 = occ.min(), occ.max() + 1
rows = []
for i in range(8):
    y0, y1 = round(i * band), round((i + 1) * band); m = a[y0:y1].max(2)
    base = y0 + int(np.argmax((m > 200).sum(1)))
    crop = np.zeros((UP + DOWN, x1 - x0, 3), int); s0 = max(0, base - UP); crop[s0 - (base - UP):, :] = a[s0:base + DOWN, x0:x1]
    rows.append(Image.fromarray(clean(crop)).resize((round((x1 - x0) * LS), round((UP + DOWN) * LS)), Image.LANCZOS))
LW, LH = rows[0].size; strip = Image.new('RGB', (LW, LH * 8))
for i, r in enumerate(rows): strip.paste(r, (0, i * LH))
strip.save(os.path.join(FX, 'pyre-wheel-line.webp'), quality=84, method=6)

# --- the hub: 2 rows x 8 cells; centre = where the cross's arms are (the brightest row / column inside the circle)
a = load('fx-wheel-hub'); H, W = a.shape[:2]; cw, ch = W / 8, H / 2; HS = .6; L, R, T, B = 130, 130, 190, 80
frames = []
for r in range(2):
    for c in range(8):
        cx0, cy0 = round(c * cw), round(r * ch); cell = a[cy0:round((r + 1) * ch), cx0:round((c + 1) * cw)]; m = cell.max(2) > 200
        lower = m.copy(); lower[:int(cell.shape[0] * .45)] = False   # the circle sits low in each cell (flames rise above it)
        yc, xc = int(np.argmax(lower.sum(1))), int(np.argmax(lower.sum(0)))
        out = np.zeros((T + B, L + R, 3), int)
        for yy in range(T + B):
            sy = yc - T + yy
            if 0 <= sy < cell.shape[0]:
                sx0, sx1 = max(0, xc - L), min(cell.shape[1], xc + R); out[yy, sx0 - (xc - L):sx1 - (xc - L)] = cell[sy, sx0:sx1]
        frames.append(Image.fromarray(clean(out)).resize((round((L + R) * HS), round((T + B) * HS)), Image.LANCZOS))
HW, HH = frames[0].size; hub = Image.new('RGB', (HW * 16, HH))
for i, f in enumerate(frames): hub.paste(f, (i * HW, 0))
hub.save(os.path.join(FX, 'pyre-wheel-hub.webp'), quality=84, method=6)
print(f"PYW = {{ lw: {LW}, lh: {LH}, lb: {round(UP * LS)}, hw: {HW}, hh: {HH}, hc: {round(T * HS)} }}")
