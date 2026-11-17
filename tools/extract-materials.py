# Boss gear MATERIAL icons (Nov 17, user's ChatGPT sheet tools/art/equipment/3-materials.png: 2 rows x 5 on magenta) -> separate icons.
#   python3 tools/extract-materials.py   ->  tools/art/equipment/icons/<name>.png (128x128, soft transparent edge, centred)
# Boss gear is a plan for later (tools/boss-gear-plan.md); when it's built, copy these into client/assets/icons/.
import os, importlib.util
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('xd', os.path.join(here, 'extract-directions.py')); xd = importlib.util.module_from_spec(spec); spec.loader.exec_module(xd)
NAMES = [['gold', 'iron-ore', 'silver-ore', 'titanium-ore', 'ess-butcher'], ['ess-hivemind', 'ess-screamer', 'ess-pyre', 'ess-minebeast', 'ess-abomination']]
SIZE, PAD = 128, 4
D = os.path.join(here, 'art', 'equipment'); out = os.path.join(D, 'icons'); os.makedirs(out, exist_ok=True)
src = np.array(Image.open(os.path.join(D, '3-materials.png')).convert('RGB')).astype(int)
fg = ndimage.binary_opening(xd.foreground(src), iterations=1)
cols = xd.squeeze(xd.runs_of(fg.sum(0) > 2, 20, 20), 5); rows = xd.squeeze(xd.runs_of(fg.sum(1) > 2, 20, 20), 2)
assert len(cols) == 5 and len(rows) == 2, (len(rows), len(cols))
for ri, (ya, yb) in enumerate(rows):
    for ci, (xa, xb) in enumerate(cols):
        cell = fg[ya:yb, xa:xb]; lab, n = ndimage.label(cell, structure=np.ones((3, 3)))
        sizes = ndimage.sum(cell, lab, range(1, n + 1)); keep = [i + 1 for i in range(n) if sizes[i] >= max(30, sizes.max() * 0.01)]
        m = ndimage.binary_fill_holes(np.isin(lab, keep)); ys, xs = np.where(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        sub = m[y0:y1, x0:x1]; rgb = src[ya + y0:ya + y1, xa + x0:xa + x1].astype(float)
        # edge pixels still tinted by the magenta: darken toward the black outline (the icons all have one)
        bg_ = ~sub; edge = sub & ndimage.binary_dilation(bg_, iterations=2)
        pink = edge & (rgb[..., 0] > rgb[..., 1] + 40) & (rgb[..., 2] > rgb[..., 1] + 40)
        rgb[pink] *= 0.25
        alpha = ndimage.gaussian_filter(sub.astype(float), 0.7)   # soft edge for a crisp UI look when scaled down
        rgba = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8); img = Image.fromarray(rgba, 'RGBA')
        k = (SIZE - 2 * PAD) / max(img.width, img.height)
        small = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
        canvas = Image.new('RGBA', (SIZE, SIZE)); canvas.alpha_composite(small, ((SIZE - small.width) // 2, (SIZE - small.height) // 2))
        canvas.save(os.path.join(out, NAMES[ri][ci] + '.png'))
print('materials ->', os.path.relpath(out), ':', ', '.join(n for r in NAMES for n in r))
