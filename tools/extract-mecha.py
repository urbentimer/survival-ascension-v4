# Sofea's R mecha "Crimson Aegis" (ChatGPT sheets in tools/art/sofea-mecha):
#   python3 tools/extract-mecha.py
# Writes:
#   sprites/dir8/sofea-mecha.webp       8 rows (down, downRight, right, upRight, up, upLeft, left, downLeft) x 6 cols
#                                       (idle, walk 1-3, flame pose, saber slash), cells 112x88, body centre x=56, feet y=80
#   sprites/dir8/sofea-mecha-tf.webp    5 rows (down, front-left, left, right, up) x 8 frames of Sofea turning into the mecha,
#                                       same cells / anchor; all frames the same height (54px)
#   (sprites/fx/sofea-flame.webp: the flame jet, made by tools/bake-flamethrower.py)
#                                       0-7 ignite (grow), 8-13 loop, 14-21 cut off (shrink)
#   sprites/dir8/sofea-mecha.json       per direction: the flame nozzle offset from the feet anchor
# The mecha sheet's rows were drawn: down, down-right, right, up-right, up, left, down-left, down-left (no up-left),
# so up-left is up-right mirrored and the second down-left row is used.
import os, json
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'sofea-mecha')
A = os.path.join(here, '..', 'client', 'assets', 'sprites')
CW, CH, AX, FY = 112, 88, 56, 80   # same cells as the survivors' dir8 atlases
BODY_H = 54    # her normal size (was 162 = 3x; the user wants her to stay her size)

def blue_key(path):
    a = np.array(Image.open(os.path.join(ART, path)).convert('RGB')).astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bg = (b > 150) & (b - np.maximum(r, g) > 110)
    soft = (b > 110) & (b - np.maximum(r, g) > 55)
    for _ in range(2): bg |= ndimage.binary_dilation(bg) & soft
    lab, n = ndimage.label(~bg); sizes = ndimage.sum(~bg, lab, range(1, n + 1))
    keep = np.isin(lab, [i + 1 for i in range(n) if sizes[i] > 30])
    edge = keep & ndimage.binary_dilation(~keep, iterations=2)             # blue spill on the outline
    a[..., 2] = np.where(edge, np.minimum(b, np.maximum(r, g) + 20), b)
    return np.dstack([np.clip(a, 0, 255).astype(np.uint8), (keep * 255).astype(np.uint8)])

def bands(mask, axis, min_gap=6, min_len=8):
    occ = mask.any(axis); runs = []; s = None
    for i, v in enumerate(occ):
        if v and s is None: s = i
        if not v and s is not None:
            if i - s > min_len: runs.append([s, i])
            s = None
    if s is not None: runs.append([s, len(occ)])
    out = []
    for r in runs:
        if out and r[0] - out[-1][1] < min_gap: out[-1][1] = r[1]
        else: out.append(r)
    return out

def is_green(c): return (c[..., 1].astype(int) - np.maximum(c[..., 0], c[..., 2]).astype(int) > 50)

def grid(rgba, nrows, ncols, row_cols_from=None):
    """frames of an evenly spaced sheet, cut at the empty gaps (rows by occupancy, columns by occupancy inside each row)"""
    m = rgba[..., 3] > 0
    rows = bands(m[:, : (row_cols_from or m.shape[1])], 1)
    assert len(rows) == nrows, f'{len(rows)} rows'
    out = []
    for y0, y1 in rows:
        cols = bands(m[y0:y1], 0)
        while len(cols) > ncols:   # merge the closest
            gaps = [cols[i + 1][0] - cols[i][1] for i in range(len(cols) - 1)]; i = int(np.argmin(gaps)); cols[i][1] = cols[i + 1][1]; del cols[i + 1]
        assert len(cols) == ncols, f'{len(cols)} cols'
        out.append([rgba[y0:y1, x0:x1] for x0, x1 in cols])
    return out

def crop(c):
    ys, xs = np.where(c[..., 3] > 0); return c[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

def body_box(c):   # bbox without the saber glow
    m = (c[..., 3] > 0) & ~is_green(c); ys, xs = np.where(m)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1

def place(c, sc, cx_src, feet_src, flip=False):
    """scale a frame, put body centre at AX and feet at FY"""
    if flip: c = c[:, ::-1]; cx_src = c.shape[1] - cx_src
    im = Image.fromarray(np.ascontiguousarray(c)).resize((max(1, round(c.shape[1] * sc)), max(1, round(c.shape[0] * sc))), Image.LANCZOS)
    a = np.array(im); a[..., 3] = np.where(a[..., 3] > 100, 255, 0)
    x = round(AX - cx_src * sc); y = round(FY - feet_src * sc)
    out = np.zeros((CH, CW, 4), np.uint8)
    x0, y0, x1, y1 = max(0, x), max(0, y), min(CW, x + a.shape[1]), min(CH, y + a.shape[0])
    out[y0:y1, x0:x1] = a[y0 - y:y1 - y, x0 - x:x1 - x]
    return out

def save_webp(arr, path, q=82):
    Image.fromarray(arr).save(path, quality=q, method=6, alpha_quality=100); print('->', os.path.relpath(path), os.path.getsize(path) // 1024, 'KB')

# ---- mecha, 8 directions ----
mech = grid(blue_key('mecha.png'), 8, 6, row_cols_from=840)
SRC = [(0, 0), (1, 0), (2, 0), (3, 0), (4, 0), (3, 1), (5, 0), (7, 0)]   # (sheet row, mirrored)
DIRV = [(0, 1), (.7, .7), (1, 0), (.7, -.7), (0, -1), (-.7, -.7), (-1, 0), (-.7, .7)]
atlas = np.zeros((CH * 8, CW * 6, 4), np.uint8); nozzles = []
for d, (sr, mir) in enumerate(SRC):
    cells = [crop(c) for c in mech[sr]]
    bx0, by0, bx1, by1 = body_box(cells[0]); sc = BODY_H / (by1 - by0)
    for k, c in enumerate(cells):
        x0, y0, x1, y1 = body_box(c)
        # walk/attack frames: same feet line; body centre from the frame's torso (top 60% of the body, saber excluded)
        m = (c[..., 3] > 0) & ~is_green(c); top = m[y0:y0 + int((y1 - y0) * .6)]; xs = np.where(top.any(0))[0]
        cx = (xs.min() + xs.max()) / 2 if k else (x0 + x1) / 2
        if k == 0: cx0 = cx
        cx = cx0 if k < 4 else cx   # idle + walk share the idle centre (no sliding), attacks use their own
        atlas[d * CH:(d + 1) * CH, k * CW:(k + 1) * CW] = place(c, sc, cx, y1, bool(mir))
    # flame nozzle = the gold barrel pixel farthest along the facing, in the flame-pose frame
    f = atlas[d * CH:(d + 1) * CH, 4 * CW:5 * CW].astype(int); r, g, b = f[..., 0], f[..., 1], f[..., 2]
    gold = (f[..., 3] > 0) & (r > 150) & (g > 105) & (b < 110) & (r - b > 80)
    gold[:FY - int(BODY_H * .62)] = False   # not the gold headset / hair clips: the gun arm is below the head
    ys, xs = np.where(gold)
    if len(xs):
        vx, vy = DIRV[d]; s = (xs - AX) * vx + (ys - FY) * vy; sel = s >= np.percentile(s, 97)
        nozzles.append([round(float(xs[sel].mean()) - AX), round(float(ys[sel].mean()) - FY)])
    else: nozzles.append([round(DIRV[d][0] * 17), -24])
    print(f'dir {d}: sheet row {sr}{" mirrored" if mir else ""}, scale {sc:.3f}, nozzle {nozzles[-1]}')
save_webp(atlas, os.path.join(A, 'dir8', 'sofea-mecha.webp'))

# ---- transformation, 5 angles ----
TF = ['transform-down.png', 'transform-b.png', 'transform-a.png', 'transform-c.png', 'transform-up.png']
tfa = np.zeros((CH * 5, CW * 8, 4), np.uint8)
for row, src in enumerate(TF):
    rgba = blue_key(src); lab, n = ndimage.label(rgba[..., 3] > 0); pitch = rgba.shape[1] / 8
    objs = ndimage.find_objects(lab); cells = []
    for k in range(8):   # each blob goes to the column its centre is in (sparkles that cross the column line stay whole)
        ids = [i + 1 for i, s in enumerate(objs) if s and int(((s[1].start + s[1].stop) / 2) // pitch) == k]
        cells.append(crop(np.where(np.isin(lab, ids)[..., None], rgba, 0).astype(np.uint8)))
    for k, c in enumerate(cells):
        x0, y0, x1, y1 = body_box(c)
        t = k / 7; t = t * t * (3 - 2 * t)
        sc = (54 + (BODY_H - 54) * t) / (y1 - y0)
        m = (c[..., 3] > 0) & ~is_green(c); top = m[y0:y0 + int((y1 - y0) * .35)]; xs = np.where(top.any(0))[0]   # head centre
        tfa[row * CH:(row + 1) * CH, k * CW:(k + 1) * CW] = place(c, sc, (xs.min() + xs.max()) / 2, y1)
    print(f'transform {src}: ok')
save_webp(tfa, os.path.join(A, 'dir8', 'sofea-mecha-tf.webp'))

# (the flame jet is made by tools/bake-flamethrower.py from the Vefects fire VFX since Nov 5; the ChatGPT flame sheets in
#  tools/art/sofea-mecha/flame-*.png are no longer used)
FW, FH, NX = 208, 160, 4
json.dump({'cell': [CW, CH], 'anchor': [AX, FY], 'nozzle': nozzles, 'flame': {'cell': [FW, FH], 'nozzle': [NX, FH // 2], 'grow': [0, 8], 'loop': [8, 20], 'end': [20, 28]}},
          open(os.path.join(A, 'dir8', 'sofea-mecha.json'), 'w'))
