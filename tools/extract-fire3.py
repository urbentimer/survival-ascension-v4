# The user's three ChatGPT fire loops (Nov 10): tools/art/fire3/fire-<small|medium|big>.gif, 8 frames each on black.
# -> client/assets/sprites/fx/fire3-<s|m|b>.webp: 8 frames in a row, black turned into transparency (alpha = brightness, colour un-multiplied),
#    so the flames can be drawn normally over bright snow as well as additively. Every frame is cut with the same box; the flame's base is
#    the bottom centre of each cell. Sizes below = cell size in game px.   python3 tools/extract-fire3.py
import os
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'fire3'); OUT = os.path.join(here, '..', 'client', 'assets', 'sprites', 'fx')
for name, key, width in [('small', 's', 84), ('medium', 'm', 116), ('big', 'b', 176)]:
    g = Image.open(os.path.join(ART, f'fire-{name}.gif')); fr = []
    for i in range(g.n_frames): g.seek(i); fr.append(np.array(g.convert('RGB')).astype(float))
    lum = np.max(fr, 0).max(2); ys, xs = np.where(lum > 46); x0, x1, y0, y1 = xs.min(), xs.max() + 1, max(0, ys.min() - 4), ys.max() + 1
    base = np.where((np.max(fr, 0).max(2) > 150).any(1))[0].max() + 1; y1 = min(y1, base + 6)   # the bright bottom edge of the flames = the base line
    sc = width / (x1 - x0); cw, ch = width, round((y1 - y0) * sc); sheet = Image.new('RGBA', (cw * len(fr), ch))
    for i, f in enumerate(fr):
        c = f[y0:y1, x0:x1]; a = np.clip((c.max(2) - 14) / 150, 0, 1); rgb = np.clip(c / np.maximum(a, .12)[..., None], 0, 255)
        fade = np.clip(np.minimum(np.arange(c.shape[1]), np.arange(c.shape[1])[::-1]) / 10, 0, 1)[None, :]; a = a * fade   # no hard cut at the sides
        im = Image.fromarray(np.dstack([rgb, a * 255]).astype(np.uint8)).resize((cw, ch), Image.LANCZOS); sheet.paste(im, (i * cw, 0))
    p = os.path.join(OUT, f'fire3-{key}.webp'); sheet.save(p, quality=80, alpha_quality=85, method=6); print(name, 'cell', cw, 'x', ch, 'frames', len(fr), os.path.getsize(p) // 1024, 'KB')
