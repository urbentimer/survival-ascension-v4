# Briggs's E pose sheet (Nov 15, STEEL BOOMERANG; it was the Manhole Frisbee's rip-and-fling): tools/art/briggs/throw-boomerang.png ->
# throw-pose-clean.png (then tools/cut-briggs.sh cuts it as the "throw" block, 4 columns).
# The art: 8 rows x 4 columns (271.5 x 181 cells): 1 pull it off his back, 2 wind-up, 3 FLING (also drawing the boomerang flying off to the
# RIGHT with speed lines), 4 catch. The game draws the flying boomerang itself and it never comes back (it fades out), so the block is:
#   0 = pull, 1 = wind-up, 2 = wind-up (held), 3 = fling with ONLY Briggs kept (the biggest piece; the boomerang + speed lines go)
# (the client plays 0-1-2 over the 0.34s cast and the fling for 0.24s after it). Some poses poke over the grid lines (reaching arms), so each
# body is lifted out as its own piece (the biggest one near its column) and re-centred in its new column. (The left rows are replaced by the
# mirrored right rows in tools/fix-briggs-slam.py anyway: the art flings to the right in every row.)
import os
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); B = os.path.join(here, 'art', 'briggs')
a = np.array(Image.open(os.path.join(B, 'throw-boomerang.png')).convert('RGB')); H, W = a.shape[:2]; cw, ch = W / 4, H / 8
r, g, b = [a[..., i].astype(int) for i in range(3)]; fg = ~((r - g > 60) & (b - g > 60) & (np.abs(r - b) < 90))
out = np.zeros_like(a); out[...] = (255, 0, 255)
PLAN = [0, 1, 1, 2]   # output column -> source column
for row in range(8):
    y0, y1 = round(row * ch), round((row + 1) * ch)
    for oc, sc in enumerate(PLAN):
        xa, xb = max(0, round(sc * cw) - 60), min(W, round((sc + 1) * cw) + 60); band = fg[y0:y1, xa:xb]
        lab, n = ndimage.label(ndimage.binary_closing(band, iterations=2)); sz = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
        cx = np.array([ndimage.center_of_mass(lab == i + 1)[1] + xa for i in range(n)]); mid = (sc + .5) * cw
        cand = [i for i in range(n) if abs(cx[i] - mid) < cw * .45]; body = 1 + max(cand, key=lambda i: sz[i])
        m = (lab == body) & band
        if sc != 2:   # pull / wind-up: the boomerang is in his hand, but keep any small loose bits sitting on him too (not for the fling: that's the flying boomerang)
            bb = ndimage.binary_dilation(lab == body, iterations=6); m |= band & bb
        ys, xs = np.where(m); dx = int(round((oc + .5) * cw - (xa + (xs.min() + xs.max()) / 2)))
        tx = xs + xa + dx; ok = (tx >= round(oc * cw)) & (tx < round((oc + 1) * cw))
        out[y0 + ys[ok], tx[ok]] = a[y0 + ys[ok], xs[ok] + xa]
        if sc == 2: print(f'row {row}: fling: kept Briggs only ({int(m.sum())} px), moved {dx:+d}px; {int((band & ~m).sum())} px of boomerang / speed lines gone')
Image.fromarray(out).save(os.path.join(B, 'throw-pose-clean.png'))
