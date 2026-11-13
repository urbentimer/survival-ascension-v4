# Briggs's Q pose ("slam" block, Nov 13): run after extract-directions.py juggernaut (see tools/cut-briggs.sh).
# 1) the LEFT row was drawn with his shotgun in the roar frame: use the RIGHT row mirrored instead (cells are centred on the feet)
# 2) the rock dust under the slam was blended with the magenta background: turn the pinkish pixels brown
import json, os
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__)); d8 = os.path.join(here, '..', 'client', 'assets', 'sprites', 'dir8')
meta = json.load(open(os.path.join(d8, 'dir8.json')))['juggernaut']; b = meta['blocks'].index('slam'); cw, ch = meta['cellW'], meta['cellH']
path = os.path.join(d8, 'juggernaut.png'); im = Image.open(path).convert('RGBA'); a = np.array(im)
y0 = b * 8 * ch
right = a[y0 + 2 * ch:y0 + 3 * ch].copy()
for c in range(4):
    cell = right[:, c * cw:(c + 1) * cw][:, ::-1]; a[y0 + 6 * ch:y0 + 7 * ch, c * cw:(c + 1) * cw] = cell
# (Nov 13) the E "throw" block: the art's left-facing rows fling the cover to the right too: rows UP-LEFT / LEFT / DOWN-LEFT = UP-RIGHT / RIGHT / DOWN-RIGHT mirrored
if 'throw' in meta['blocks']:
    t0 = meta['blocks'].index('throw') * 8 * ch
    for dst, src in ((5, 3), (6, 2), (7, 1)):
        rowpx = a[t0 + src * ch:t0 + (src + 1) * ch].copy()
        for c in range(4): a[t0 + dst * ch:t0 + (dst + 1) * ch, c * cw:(c + 1) * cw] = rowpx[:, c * cw:(c + 1) * cw][:, ::-1]
    print('throw block: left rows = mirrored right rows')
# (Nov 13) the R "fists" block: the art's UP-LEFT / DOWN-LEFT rows throw their punches to the RIGHT: their jab / haymaker (cols 4-5) = UP-RIGHT / DOWN-RIGHT's mirrored
if 'fists' in meta['blocks']:
    f0 = meta['blocks'].index('fists') * 8 * ch
    for dst, src in ((5, 3), (7, 1)):
        for c in (4, 5): a[f0 + dst * ch:f0 + (dst + 1) * ch, c * cw:(c + 1) * cw] = a[f0 + src * ch:f0 + (src + 1) * ch, c * cw:(c + 1) * cw][:, ::-1]
    print('fists block: up-left / down-left punches = mirrored up-right / down-right')
# rock dust / sparks blended with the magenta background in the skill sheets: pinkish pixels -> warm brown / orange
for name in ('slam', 'throw', 'fists', 'power'):
    if name not in meta['blocks']: continue
    t0 = meta['blocks'].index(name) * 8 * ch; tb = a[t0:t0 + 8 * ch].astype(int); r, g, bl, al = tb[..., 0], tb[..., 1], tb[..., 2], tb[..., 3]; pk = (al > 0) & (r > g + 25) & (bl > g + 25)
    tb[..., 2] = np.where(pk, (g * .6).astype(int), bl); tb[..., 0] = np.where(pk, np.minimum(255, g + 45), r); a[t0:t0 + 8 * ch] = tb.astype(np.uint8); print(f'{name}: pink fixed {int(pk.sum())} px')
Image.fromarray(a).save(path.replace('.png', '.webp'), lossless=True, quality=100, method=6); os.remove(path)   # (Nov 13, user: highest quality) full colour, lossless WebP (was a 256-colour PNG): juggernaut.webp
print('slam block: LEFT row = mirrored RIGHT')
