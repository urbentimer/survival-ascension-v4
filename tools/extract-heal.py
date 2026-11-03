# Cuts the Support robot's heal ring: fx/heal-ring.png, 3 rows in 100x72 cells
#   row 0: turn on (4)   row 1: healing loop (8)   row 2: turn off (4)
# Usage: python3 tools/extract-heal.py   (source: tools/art/support-heal.png)
import os, importlib.util
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('xd', os.path.join(here, 'extract-directions.py'))
xd = importlib.util.module_from_spec(spec); spec.loader.exec_module(xd)
FX = os.path.join(here, '..', 'client', 'assets', 'sprites', 'fx')
src = np.array(Image.open(os.path.join(here, 'art', 'support-heal.png')).convert('RGB')).astype(int)
CELL, SCALE, GLOW = (100, 72), .40, (.45, .85, 1.0)

def rgba(part):
    fg = xd.foreground(part); r, g, b = part[..., 0], part[..., 1], part[..., 2]
    tint = (r - g > 25) & (b - g > 25)                 # glow blended into the magenta: keep it, recoloured cyan, see-through
    fg |= tint & (g > 40) & ~((r > 225) & (g < 40) & (b > 225))
    out = part.copy(); v = out[tint & fg].max(1, keepdims=True).astype(float); out[tint & fg] = np.clip(v * np.array(GLOW), 0, 255).astype(int)
    a = np.zeros(part.shape[:2] + (4,), np.uint8); a[..., :3] = np.clip(out, 0, 255); a[..., 3] = fg * 255
    p = tint & fg; a[..., 3][p] = np.clip((part[p][:, 1] - 30) * 2.0 + 40, 40, 230).astype(np.uint8)
    return a

rows = xd.squeeze(xd.runs_of(xd.foreground(src).sum(1) > 1, 30, 4), 3)
S = Image.new('RGBA', (CELL[0] * 8, CELL[1] * 3))
for ri, ((y0, y1), n) in enumerate(zip(rows, [4, 8, 4])):
    band = src[max(0, y0 - 20):y1 + 12]
    runs = [[round(i * src.shape[1] / 8) + 4, min(src.shape[1], round((i + 1) * src.shape[1] / 8) + 6)] for i in range(8)] if n == 8 else xd.squeeze(xd.runs_of(xd.foreground(band).sum(0) > 0, 20, 3), n)   # loop row: 8 evenly spaced frames
    for ci, (xa, xb) in enumerate(runs):
        a = rgba(band[:, xa:xb] if n == 8 else band[:, max(0, xa - 12):xb + 12]); ys, xs = np.where(a[..., 3] > 0)
        img = Image.fromarray(a[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
        img = img.resize((max(1, round(img.width * SCALE)), max(1, round(img.height * SCALE))), Image.LANCZOS)
        S.alpha_composite(img, (ci * CELL[0] + (CELL[0] - img.width) // 2, ri * CELL[1] + CELL[1] - 4 - img.height))
S.save(os.path.join(FX, 'heal-ring.png')); print('heal-ring.png', S.size, [len(r) for r in [rows]])
