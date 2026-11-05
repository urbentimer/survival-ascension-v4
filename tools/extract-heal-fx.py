# Cuts Astra's medic healing effect (3 rows x 6 frames of green neon on magenta, ChatGPT):
#   python3 tools/extract-heal-fx.py tools/art/astra2/heal-fx.png
# Writes sprites/fx/astra-heal.webp, one row per effect, 6 frames each:
#   row 0 ground circle (loop)  cells 176x96   centre of the oval = cell centre
#   row 1 rising aura (loop)    cells 144x208  bottom of the base ring = cell bottom - 14
#   row 2 heal burst (once)     cells 208x176  bottom of the ring      = cell bottom - 14
# The glow painted over the magenta is "un-mixed" (alpha = how much green there is: magenta has none), so it becomes a
# see-through neon glow instead of a pink halo. Every frame of a row is cut from the same window and scaled the same,
# so the loops don't wobble. Colours are graded to a bold deep-emerald neon; the client draws it normally + a light additive glow pass.
import sys, os
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__)); A = os.path.join(here, '..', 'client', 'assets')
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'art', 'astra2', 'heal-fx.png')
ROWS = [(176, 96, 'centre'), (144, 208, 'bottom'), (208, 176, 'bottom')]   # cell w, h, anchor

rgb = np.array(Image.open(src).convert('RGB')).astype(float) / 255
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
# pixel = a*fx + (1-a)*magenta(1,0,1); the effect is green/white so its green channel is ~1 -> a ~ green
a = np.clip(np.maximum(g * 1.04, 1 - np.minimum(r, b) / .95), 0, 1)
a[(r > .85) & (b > .85) & (g < .12)] = 0
fx = np.clip((rgb - (1 - a)[..., None] * np.array([1, 0, 1])) / np.maximum(a, 1e-3)[..., None], 0, 1)
fx[..., 0] = np.minimum(fx[..., 0], fx[..., 1] * .8)        # no pink / purple left in the halo
fx[..., 2] = np.minimum(fx[..., 2], fx[..., 1] * .95)
# BOLD grade (user's pick, Nov 4): deep emerald in the soft parts, white-hot core kept; the faint fog trimmed so it stays crisp
lum = fx.max(-1, keepdims=True)
deep = np.concatenate([np.zeros_like(lum), lum * .85, lum * .42], -1)
core = np.clip((lum - .8) / .2, 0, 1)
fx = deep * (1 - core) + fx * core
a = np.clip((a - .07) / .93 * 1.15, 0, 1)
rgba = np.dstack([fx * 255, a * 255]).astype(np.uint8)

H, W = a.shape; occ = (a > .25).sum(1) > 4; ys = np.where(occ)[0]
gaps = [i for i in np.where(np.diff(ys) > 25)[0]]
assert len(gaps) >= 2, f'expected 3 bands, found {len(gaps) + 1}'
cuts = [0] + [(ys[i] + ys[i + 1]) // 2 for i in gaps[:2]] + [H]
pitch = W / 6
atlas = Image.new('RGBA', (max(w for w, _, _ in ROWS) * 6, sum(h for _, h, _ in ROWS)))
oy = 0
for row, (y0, y1) in enumerate(zip(cuts[:-1], cuts[1:])):
    cw, ch, anchor = ROWS[row]
    band = rgba[y0:y1]; m = band[..., 3] > 10
    yy = np.where(m.any(1))[0]; t, bt = yy.min(), yy.max() + 1
    xs = []
    for c in range(6):
        cx = np.where(m[:, round(c * pitch):round((c + 1) * pitch)].any(0))[0]; xs.append((cx.min(), cx.max() + 1))
    wmax = max(x1 - x0 for x0, x1 in xs)
    sc = min((cw - 6) / wmax, (ch - (16 if anchor == 'bottom' else 6)) / (bt - t))
    for c in range(6):
        x0 = round(c * pitch); im = Image.fromarray(np.ascontiguousarray(band[t:bt, x0:round((c + 1) * pitch)]))
        # same window for every frame: centre the column's own slot (not each frame's bbox) so nothing slides
        im = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
        px = c * cw + (cw - im.width) // 2
        py = oy + ((ch - im.height) // 2 if anchor == 'centre' else ch - 14 - im.height + round((bt - t) * sc * 0) )
        cell = Image.new('RGBA', (cw, ch)); cell.alpha_composite(im, (px - c * cw, py - oy) if px - c * cw >= 0 and py - oy >= 0 else (0, 0))
        atlas.alpha_composite(cell, (c * cw, oy))
    print(f'row {row}: band {y0}-{y1}, scale {sc:.3f}, cell {cw}x{ch}')
    oy += ch
p = os.path.join(A, 'sprites', 'fx', 'astra-heal.webp'); atlas.save(p, quality=82, method=6)
print('->', p, os.path.getsize(p) // 1024, 'KB')
