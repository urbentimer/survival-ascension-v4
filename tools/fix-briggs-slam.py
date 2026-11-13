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
blk = a[y0:y0 + 8 * ch].astype(int); r, g, bl, al = blk[..., 0], blk[..., 1], blk[..., 2], blk[..., 3]
pink = (al > 0) & (r > g + 25) & (bl > g + 25)
blk[..., 2] = np.where(pink, (g * .6).astype(int), bl); blk[..., 0] = np.where(pink, np.minimum(255, g + 45), r); blk[..., 1] = np.where(pink, g, g)
a[y0:y0 + 8 * ch] = blk.astype(np.uint8)
# (Nov 13) the E "throw" block: the art's left-facing rows fling the cover to the right too: rows UP-LEFT / LEFT / DOWN-LEFT = UP-RIGHT / RIGHT / DOWN-RIGHT mirrored
if 'throw' in meta['blocks']:
    t0 = meta['blocks'].index('throw') * 8 * ch
    for dst, src in ((5, 3), (6, 2), (7, 1)):
        rowpx = a[t0 + src * ch:t0 + (src + 1) * ch].copy()
        for c in range(4): a[t0 + dst * ch:t0 + (dst + 1) * ch, c * cw:(c + 1) * cw] = rowpx[:, c * cw:(c + 1) * cw][:, ::-1]
    tb = a[t0:t0 + 8 * ch].astype(int); r, g, bl, al = tb[..., 0], tb[..., 1], tb[..., 2], tb[..., 3]; pk = (al > 0) & (r > g + 25) & (bl > g + 25)
    tb[..., 2] = np.where(pk, (g * .6).astype(int), bl); tb[..., 0] = np.where(pk, np.minimum(255, g + 45), r); a[t0:t0 + 8 * ch] = tb.astype(np.uint8)
    print('throw block: left rows = mirrored right rows, pink fixed:', int(pk.sum()), 'px')
Image.fromarray(a).quantize(256, method=Image.FASTOCTREE, dither=Image.NONE).save(path, optimize=True)   # 256 colours like the other atlases (1.7 MB -> ~0.4 MB)
print('slam block: LEFT row = mirrored RIGHT, pink dust fixed:', int(pink.sum()), 'px')
