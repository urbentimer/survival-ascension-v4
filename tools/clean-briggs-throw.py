# Briggs's E pose sheet (Nov 13, Manhole Frisbee): tools/art/briggs/throw-pose.png -> throw-pose-clean.png (then tools/cut-briggs.sh cuts it).
# The art's 4th frame (the fling) also drew the flying cover (always flying to the RIGHT, with speed lines and rocks), and Briggs himself pokes
# past his column's left edge (his reaching arm makes him wide). The game draws the cover in flight itself, so in that column only Briggs is
# kept (the biggest piece) and he's moved right to sit centred in his column; the cover, rocks and speed lines go back to magenta.
import os
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); B = os.path.join(here, 'art', 'briggs')
a = np.array(Image.open(os.path.join(B, 'throw-pose.png')).convert('RGB')); H, W = a.shape[:2]; cw, ch = W / 4, H / 8
r, g, b = [a[..., i].astype(int) for i in range(3)]; fg = ~((r - g > 60) & (b - g > 60) & (np.abs(r - b) < 90))
X3 = round(3 * cw)
for row in range(8):
    y0, y1 = round(row * ch), round((row + 1) * ch); xa = X3 - 70   # (look a bit into column 3: the body crosses the line)
    band = fg[y0:y1, xa:W]; lab, n = ndimage.label(ndimage.binary_closing(band, iterations=2))
    cx = np.array([ndimage.center_of_mass(lab == i + 1)[1] for i in range(n)]); sz = ndimage.sum(np.ones_like(lab), lab, range(1, n + 1))
    cand = [i for i in range(n) if cx[i] + xa > X3 - 10]; body = 1 + max(cand, key=lambda i: sz[i])
    m = (lab == body) & band; ys, xs = np.where(m); bx0, bx1 = xs.min(), xs.max()
    sub = a[y0:y1, xa:W].copy(); piece = np.zeros_like(sub); piece[m] = sub[m]
    clear = np.zeros_like(band); clear[:, X3 - xa:] = True; clear |= ndimage.binary_dilation(m, iterations=4)   # ALL of column 4 (incl. the soft pink fringes) + the body (and its fringe) wherever it is
    a[y0:y1, xa:W][clear] = (255, 0, 255)
    dx = int(round((X3 + cw / 2) - (xa + (bx0 + bx1) / 2)))   # centre him in column 4
    ys2, xs2 = np.where(m); tx = xs2 + xa + dx; ok = (tx >= X3) & (tx < W)
    a[y0 + ys2[ok], tx[ok]] = piece[ys2[ok], xs2[ok]]
    print(f'row {row}: fling frame: kept Briggs only ({int(m.sum())} px), moved {dx:+d}px; {int((band & ~m).sum())} px of cover / rocks / speed lines gone')
Image.fromarray(a).save(os.path.join(B, 'throw-pose-clean.png'))
