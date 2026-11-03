# Uneven ChatGPT sheets (rows of different heights / frames that shrink down the sheet) -> a uniform grid where
# every frame has the same body height, bottom-aligned and centred in its cell. Then cut it with a fixed %pitch.
#   python3 tools/even-grid.py <in.png> <out.png> <rows> <cols> [cellW cellH]
import sys
import numpy as np
from PIL import Image
from scipy import ndimage
src, dst, R, C = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
CW, CH = (int(sys.argv[5]), int(sys.argv[6])) if len(sys.argv) > 6 else (260, 200)
im = Image.open(src).convert('RGBA'); a = np.array(im)
fg = a[..., 3] > 128
if fg.all():   # no alpha: key green or magenta
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    fg = ~(((g > 170) & (g - np.maximum(r, b) > 90)) | ((r > 200) & (b > 200) & (g < 90)))
def bands(prof, n):   # n runs: split at real empty gaps when there are exactly n-1 of them, else at the emptiest lines
    occ = prof > 3; idx = np.where(occ)[0]; lo, hi = idx.min(), idx.max() + 1
    gaps, st = [], None
    for y in range(lo, hi):
        if not occ[y]: st = y if st is None else st
        elif st is not None: gaps.append((st, y)); st = None
    if len(gaps) == n - 1:
        cuts = [lo] + [(g0 + g1) // 2 for g0, g1 in gaps]; return list(zip(cuts, cuts[1:] + [hi]))
    cuts = [lo]
    for k in range(1, n):
        guess = lo + (hi - lo) * k / n; w = int((hi - lo) / n * .35)
        seg = prof[int(guess - w):int(guess + w)]; cuts.append(int(guess - w + np.argmin(seg)))
    return list(zip(cuts, cuts[1:] + [hi]))
rows = bands(fg.sum(1), R); cols = bands(fg.sum(0), C); frames = []; out = Image.new("RGBA", (CW * C, CH * R))   # columns line up across the whole sheet
for ri, (y0, y1) in enumerate(rows):
    for ci, (x0, x1) in enumerate(cols):
        m = fg[y0:y1, x0:x1]; lab, n = ndimage.label(m, np.ones((3, 3)))
        if not n: continue
        sizes = ndimage.sum(m, lab, range(1, n + 1)); keep = np.isin(lab, [i + 1 for i in range(n) if sizes[i] > 30])
        ys, xs = np.where(keep); crop = a[y0:y1, x0:x1][ys.min():ys.max() + 1, xs.min():xs.max() + 1].copy()
        crop[..., 3] = keep[ys.min():ys.max() + 1, xs.min():xs.max() + 1] * 255
        k = crop[..., 3] > 0; edge = k & ~ndimage.binary_erosion(k, iterations=2); c = crop[..., :3].astype(int)
        purple = edge & (c[..., 0] > c[..., 1] + 30) & (c[..., 2] > c[..., 1] + 30) & (c[..., 2] > c[..., 0] - 40)   # magenta fringe from an old key
        crop[..., :3][purple] = (c[purple] * .3).astype(np.uint8)
        body = keep.sum(1); frames.append((ri, ci, Image.fromarray(crop), ys.max() - ys.min() + 1))
H = np.median([f[3] for f in frames if f[1] == 0]); target = CH * .82
for ri, ci, fr, h in frames:
    rowh = np.median([f[3] for f in frames if f[0] == ri and f[1] == 0] or [h]); sc = target / rowh   # same scale for the whole row
    fr = fr.resize((max(1, round(fr.width * sc)), max(1, round(fr.height * sc))), Image.LANCZOS)
    out.alpha_composite(fr.crop((0, 0, min(fr.width, CW), min(fr.height, CH))), (ci * CW + max(0, (CW - fr.width) // 2), ri * CH + max(0, CH - 4 - fr.height)))
out.save(dst)   # transparent background
print('even grid', R, 'x', C, 'cells', CW, 'x', CH, '->', dst)
