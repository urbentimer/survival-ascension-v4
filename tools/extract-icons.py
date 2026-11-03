# Cuts the item/hotbar icon sheet (3 rows x 6 columns on magenta) into separate icons:
#   client/assets/icons/<name>.png  (64x64, transparent, centred)
# Usage: python3 tools/extract-icons.py tools/art/icons-source.png
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util
spec = importlib.util.spec_from_file_location('xd', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'extract-directions.py'))
xd = importlib.util.module_from_spec(spec); spec.loader.exec_module(xd)

NAMES = [['knife', 'bat', 'axe', 'katana', 'pistol', 'smg'],
         ['rifle', 'shotgun', 'sniper', 'launcher', 'medkit', 'grenade'],
         ['armor', 'scrap', 'electronics', 'explosives', 'fuel', 'gold']]
SIZE, PAD = 64, 3
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'client', 'assets', 'icons'); os.makedirs(out, exist_ok=True)
src = np.array(Image.open(sys.argv[1]).convert('RGB')).astype(int)
fg = xd.foreground(src)
fg = ndimage.binary_opening(fg, iterations=1)            # drop single stray pixels
cols = xd.squeeze(xd.runs_of(fg.sum(0) > 2, 20, 20), 6)
rows = xd.squeeze(xd.runs_of(fg.sum(1) > 2, 20, 20), 3)
assert len(cols) == 6 and len(rows) == 3, (len(rows), len(cols))
for ri, (ya, yb) in enumerate(rows):
    for ci, (xa, xb) in enumerate(cols):
        cell = fg[ya:yb, xa:xb]
        lab, n = ndimage.label(cell, structure=np.ones((3, 3)))
        sizes = ndimage.sum(cell, lab, range(1, n + 1))
        keep = [i + 1 for i in range(n) if sizes[i] >= max(30, sizes.max() * 0.01)]
        m = np.isin(lab, keep); ys, xs = np.where(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        sub = m[y0:y1, x0:x1]; rgb = src[ya + y0:ya + y1, xa + x0:xa + x1].copy()
        bg_ = ~sub
        edge = sub & (np.roll(bg_, 1, 0) | np.roll(bg_, -1, 0) | np.roll(bg_, 1, 1) | np.roll(bg_, -1, 1))
        pink = edge & (rgb[..., 0] > rgb[..., 1] + 40) & (rgb[..., 2] > rgb[..., 1] + 40)
        rgb[pink] = (rgb[pink] * 0.3).astype(int)
        rgba = np.zeros(sub.shape + (4,), np.uint8); rgba[..., :3] = np.clip(rgb, 0, 255); rgba[..., 3] = sub * 255
        img = Image.fromarray(rgba)
        k = (SIZE - 2 * PAD) / max(img.width, img.height)
        small = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
        a = np.array(small); a[..., 3] = (a[..., 3] > 100) * 255; small = Image.fromarray(a)
        canvas = Image.new('RGBA', (SIZE, SIZE)); canvas.alpha_composite(small, ((SIZE - small.width) // 2, (SIZE - small.height) // 2))
        canvas.save(os.path.join(out, NAMES[ri][ci] + '.png'))
print('icons ->', os.path.relpath(out), ':', ', '.join(n for r in NAMES for n in r))
