# Barricade + electric fence as a FENCE LINE (Nov 6): both 96x43, same footprint (see LINE in SurvivalRoom.js / client).
#   barricade-line.png: two of the original sawhorses side by side (slight overlap)
#   fence-line.png:     the original fence (posts + wires) widened by repeating the wire section, then scaled to the barricade's height
# Sources: the original 1-panel sprites in tools/art/objects/. Run: python3 tools/make-fenceline.py
import os
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__)); SRC = os.path.join(here, 'art', 'objects'); OUT = os.path.join(here, '..', 'client', 'assets', 'sprites', 'objects')
W, H = 96, 43
b = Image.open(os.path.join(SRC, 'barricade.png')).convert('RGBA').crop((1, 1, 51, 43))   # 50x42 (its bbox)
line = Image.new('RGBA', (W, H)); ov = 2 * b.width - W
line.alpha_composite(b, (0, H - b.height)); line.alpha_composite(b, (b.width - ov, H - b.height))
line.save(os.path.join(OUT, 'barricade-line.png'))
f = Image.open(os.path.join(SRC, 'fence.png')).convert('RGBA').crop((1, 1, 47, 31))   # 46x30: post | wires | post
L, R = f.crop((0, 0, 12, 30)), f.crop((33, 0, 46, 30)); mid = f.crop((12, 0, 33, 30))
nat = Image.new('RGBA', (12 + mid.width * 2 + 13, 30)); nat.alpha_composite(L, (0, 0)); nat.alpha_composite(mid, (12, 0)); nat.alpha_composite(mid, (12 + mid.width, 0)); nat.alpha_composite(R, (12 + mid.width * 2, 0))
big = nat.resize((W, H), Image.LANCZOS); a = np.array(big); a[..., 3] = np.where(a[..., 3] > 100, 255, 0); Image.fromarray(a).save(os.path.join(OUT, 'fence-line.png'))
print('barricade-line', line.size, 'fence-line', big.size)
