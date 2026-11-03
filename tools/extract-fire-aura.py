# Cuts Briggs's War Cry fire aura sheet (2 rows x 6 frames on magenta):
#   python3 tools/extract-fire-aura.py tools/art/briggs/fire-aura.png
# Writes sprites/fx/briggs-fire.png: 6 columns x 2 rows of 180x150 cells.
#   row 0 = back flames (drawn BEHIND Briggs), row 1 = front ground ring (drawn IN FRONT of him).
# Every frame is cut from the same fixed window of its column and scaled the same, so the loop doesn't wobble.
# The glow painted over the magenta is "un-mixed" (alpha from how far it is from magenta) so it becomes a soft
# see-through orange glow instead of pink.
import sys, os
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__)); A = os.path.join(here, '..', 'client', 'assets')
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'art', 'briggs', 'fire-aura.png')
CW, CH = 180, 150

rgb = np.array(Image.open(src).convert('RGB')).astype(float) / 255
r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
# pixel = a*fire + (1-a)*magenta(1,0,1). Fire has almost no blue, magenta has no green, so:
a = np.clip(np.maximum(1 - b / .92, g * 1.15), 0, 1)
a[(r > .85) & (b > .85) & (g < .25)] = 0                     # clean background
safe = np.maximum(a, 1e-3)[..., None]
fire = np.clip((rgb - (1 - a)[..., None] * np.array([1, 0, 1])) / safe, 0, 1)
fire[..., 2] = np.minimum(fire[..., 2], fire[..., 1])        # never let any blue/pink survive
# at game size the thin yellow cores vanish and the dark-red edges read pink over the blue-grey floor: push it all toward orange
fire[..., 1] = np.maximum(fire[..., 1], .36 * fire[..., 0]); fire[..., 2] = np.minimum(fire[..., 2], .5 * fire[..., 1])
fire = np.clip(fire * 1.12, 0, 1)
a[a < .06] = 0
rgba = np.dstack([fire * 255, a * 255]).astype(np.uint8)

H, W = a.shape; occ = (a > .3).sum(1) > 3; ys = np.where(occ)[0]
gaps = np.where(np.diff(ys) > 20)[0]; split = (ys[gaps[0]] + ys[gaps[0] + 1]) // 2 if len(gaps) else H // 2
bands = [(max(0, ys[0] - 6), split), (split, min(H, ys[-1] + 6))]
pitch = W / 6
atlas = Image.new('RGBA', (CW * 6, CH * 2))
for row, (y0, y1) in enumerate(bands):
    band = rgba[y0:y1]; occb = band[..., 3] > 20
    yy = np.where(occb.any(1))[0]; t, bt = yy.min(), yy.max() + 1
    widths = []
    for c in range(6):
        xs = np.where(occb[:, round(c * pitch):round((c + 1) * pitch)].any(0))[0]; widths.append(xs.max() - xs.min() + 1)
    sc = min((CW - 6) / max(widths), (CH - 4) / (bt - t))
    for c in range(6):
        x0, x1 = round(c * pitch), round((c + 1) * pitch)
        im = Image.fromarray(np.ascontiguousarray(band[t:bt, x0:x1]))
        im = im.resize((max(1, round(im.width * sc)), max(1, round(im.height * sc))), Image.LANCZOS)
        cx = c * CW + (CW - im.width) // 2
        cy = row * CH + (CH - 2 - im.height if row == 0 else (CH - im.height) // 2)   # back flames sit on the cell bottom; the ring is centred
        atlas.alpha_composite(im, (cx, cy))
p = os.path.join(A, 'sprites', 'fx', 'briggs-fire.png'); atlas.save(p, optimize=True)
print('fire aura:', bands, 'scale', round(sc, 3), '->', p, os.path.getsize(p) // 1024, 'KB')
