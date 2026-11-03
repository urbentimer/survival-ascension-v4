# Briggs's rage sheet: the red aura was drawn glowing over magenta, so after cutting it looks hot pink.
# Turn the pink aura pixels back into a fiery red-orange (only in the "rage" block of the juggernaut atlas).
#   python3 tools/fix-rage-aura.py      (run after extract-directions.py juggernaut ...)
import json, os
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__)); d8 = os.path.join(here, '..', 'client', 'assets', 'sprites', 'dir8')
meta = json.load(open(os.path.join(d8, 'dir8.json')))['juggernaut']; b = meta['blocks'].index('rage'); ch = meta['cellH']
path = os.path.join(d8, 'juggernaut.png'); a = np.array(Image.open(path).convert('RGBA')).astype(int)
y0, y1 = b * 8 * ch, (b + 1) * 8 * ch; blk = a[y0:y1]
r, g, bl = blk[..., 0], blk[..., 1], blk[..., 2]
pink = (blk[..., 3] > 0) & (r > 120) & (bl > g + 40)
lum = (r * .6 + bl * .4)[pink]
blk[..., 0][pink] = np.minimum(255, lum * 1.05 + 30); blk[..., 1][pink] = np.minimum(200, g[pink] * .6 + lum * .32); blk[..., 2][pink] = np.minimum(80, g[pink] * .4 + 20)
a[y0:y1] = blk
Image.fromarray(a.astype(np.uint8)).quantize(256, method=Image.FASTOCTREE, dither=Image.NONE).save(path, optimize=True)
print('rage aura recoloured:', int(pink.sum()), 'pixels')
