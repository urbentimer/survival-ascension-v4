# Iron's atlas, last step (Nov 16): extract-directions.py writes juggernaut.png -> stabilise the walk -> full-colour lossless WebP.
#   python3 tools/finish-briggs.py   (run by tools/cut-iron.sh)
# Walk stabiliser (v3, user: "make the animation smooth"): ChatGPT's walk frames drift sideways by up to ~3px at the head while the feet stay
# put, which reads as a wobble. For the shotgun / knife / fists blocks, each walk frame (cols 1-3) is shifted sideways so its head (the top
# 10px of the figure) lines up with the standing frame (col 0) of the same row; the up-down bob (1-2px, natural) is kept. Max shift 4px.
# (This replaced fix-briggs-slam.py / fix-briggs-upright.py / clean-briggs-throw.py: old Briggs art fixes, in git history.)
import os, json
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__)); d8 = os.path.join(here, '..', 'client', 'assets', 'sprites', 'dir8'); path = os.path.join(d8, 'juggernaut.png')
meta = json.load(open(os.path.join(d8, 'dir8.json')))['juggernaut']; cw, ch = meta['cellW'], meta['cellH']
a = np.array(Image.open(path).convert('RGBA'))
def headx(cell):
    m = cell[..., 3] > 100; ys, xs = np.where(m)
    return None if not len(ys) else xs[ys < ys.min() + 10].mean()
moved = []
for name in ('shotgun', 'knife', 'fists'):
    if name not in meta['blocks']: continue
    b = meta['blocks'].index(name)
    for r in range(8):
        y0 = (b * 8 + r) * ch; ref = headx(a[y0:y0 + ch, 0:cw])
        for c in (1, 2, 3):
            cell = a[y0:y0 + ch, c * cw:(c + 1) * cw]; hx = headx(cell)
            if ref is None or hx is None: continue
            dx = int(round(ref - hx))
            if dx and abs(dx) <= 4: a[y0:y0 + ch, c * cw:(c + 1) * cw] = np.roll(cell, dx, axis=1); moved.append(abs(dx))
print(f'walk stabiliser: {len(moved)} frames shifted (max {max(moved) if moved else 0}px)')
Image.fromarray(a).save(path.replace('.png', '.webp'), lossless=True, quality=100, method=6); os.remove(path); print('juggernaut.webp (lossless)')
