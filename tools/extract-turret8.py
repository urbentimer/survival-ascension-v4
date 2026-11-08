# TURRET in 8 directions + a 2-frame firing loop (Nov 8), from the user's ChatGPT sheets in tools/art/turret/ (flat magenta):
#   idle.png, fire1.png (big muzzle flash + recoil + casing), fire2.png (small flash + smoke)   [idle-alt.png: an unused near-copy]
#   each 2 rows x 4:  row 1 aims D, DR, R, UR   row 2 aims U, UL, L, DL
# Writes client/assets/sprites/objects/turret8.png: 8 columns (aim r, dr, d, dl, l, ul, u, ur = 0, 45, 90 ... deg, screen y down)
#   x 3 rows (idle, fire1, fire2); every cell CW x CH with the turret's ground point (between its tripod feet) at (AX, FY).
#   Frames are lined up on the ammo box (it never moves), so nothing jumps between idle and firing.
# Prints the numbers the client needs (TURRET_ART): cell size, anchor, and the muzzle tip per direction (from fire1's flash).
import os, importlib.util
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'turret')
spec = importlib.util.spec_from_file_location('xd', os.path.join(here, 'extract-directions.py')); xd = importlib.util.module_from_spec(spec); spec.loader.exec_module(xd)
OUT = os.path.join(here, '..', 'client', 'assets', 'sprites', 'objects', 'turret8.png')
SHEET_DIRS = [['d', 'dr', 'r', 'ur'], ['u', 'ul', 'l', 'dl']]
ORDER = ['r', 'dr', 'd', 'dl', 'l', 'ul', 'u', 'ur']
SCALE = 0.2   # source ~290px tall -> ~58px in game

def cells(name):   # {dir: (rgba crop, box anchor (x, y) in the crop, crop origin)}
    a = np.array(Image.open(os.path.join(ART, name + '.png')).convert('RGB')).astype(int)
    fg = xd.foreground(a); lab, n = ndimage.label(fg, structure=np.ones((3, 3)))
    sizes = ndimage.sum(fg, lab, range(1, n + 1)); order = np.argsort(-sizes)
    bodies = [i + 1 for i in order[:8]]; objs = ndimage.find_objects(lab)
    cen = {b: ((objs[b - 1][1].start + objs[b - 1][1].stop) / 2, (objs[b - 1][0].start + objs[b - 1][0].stop) / 2) for b in bodies}
    owner = {b: b for b in bodies}
    for i in range(1, n + 1):   # casings / sparks: to the nearest body
        if i in owner or sizes[i - 1] < 12: continue
        sl = objs[i - 1]; cx, cy = (sl[1].start + sl[1].stop) / 2, (sl[0].start + sl[0].stop) / 2
        owner[i] = min(bodies, key=lambda b: (cen[b][0] - cx) ** 2 + (cen[b][1] - cy) ** 2)
    out = {}
    for b in bodies:
        m = np.isin(lab, [i for i, o in owner.items() if o == b]); ys, xs = np.where(m)
        r, c = int(cen[b][1] > a.shape[0] / 2), min(3, int(cen[b][0] / (a.shape[1] / 4)))
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        rgb, mm = a[y0:y1, x0:x1].copy(), m[y0:y1, x0:x1]
        pink = (np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]) > 25   # smoke / sparks tinted by the magenta background -> grey
        rgb[pink] = np.repeat(((rgb[pink].sum(1) / 3) * .9)[:, None], 3, 1)
        R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        olive = mm & (R > 80) & (R < 190) & (G > 70) & (G < 180) & (B < 120) & (R - B > 25) & (np.abs(R - G) < 35)
        oy, ox = np.where(olive)
        flash = mm & (R > 240) & (G > 200) & (B > 120)   # the white-hot core of a muzzle flash
        fy, fx = np.where(flash)
        out[SHEET_DIRS[r][c]] = dict(rgba=np.dstack([rgb, mm * 255]).astype(np.uint8), box=(ox.min(), oy.max()), mask=mm, olive=olive,
                                     flash=(fx.mean(), fy.mean()) if len(fx) > 20 else None)
    assert len(out) == 8, (name, sorted(out))
    return out

S = {n: cells(n) for n in ['idle', 'fire1', 'fire2']}
# the ground point relative to the ammo box, from the idle frames: centre of the tripod's feet (bottom rows, not the box)
offs = []
for d, c in S['idle'].items():
    m = c['mask'] & ~c['olive']; ys, xs = np.where(m); bot = ys.max(); sel = ys > bot - 25
    offs.append(((xs[sel].min() + xs[sel].max()) / 2 - c['box'][0], bot - c['box'][1]))
gx, gy = np.median([o[0] for o in offs]), np.median([o[1] for o in offs])
# place everything relative to the ground point; find the cell size that fits all 24 frames
ext = []
for n in S:
    for d, c in S[n].items():
        h, w = c['mask'].shape; ax, ay = c['box'][0] + gx, c['box'][1] + gy
        ext.append((-ax, w - ax, -ay, h - ay))
L, R_, T, B_ = min(e[0] for e in ext), max(e[1] for e in ext), min(e[2] for e in ext), max(e[3] for e in ext)
CW, CH = int(np.ceil((R_ - L) * SCALE)) + 4, int(np.ceil((B_ - T) * SCALE)) + 4
AX, FY = int(round(-L * SCALE)) + 2, int(round(-T * SCALE)) + 2
atlas = Image.new('RGBA', (CW * 8, CH * 3)); muzzle = []
for row, n in enumerate(['idle', 'fire1', 'fire2']):
    for col, d in enumerate(ORDER):
        c = S[n][d]; ax, ay = c['box'][0] + gx, c['box'][1] + gy
        im = Image.fromarray(c['rgba']); im = im.resize((max(1, round(im.width * SCALE)), max(1, round(im.height * SCALE))), Image.LANCZOS)
        q = np.array(im); q[..., 3] = np.where(q[..., 3] > 110, 255, 0); im = Image.fromarray(q)
        atlas.alpha_composite(im, (col * CW + AX - int(round(ax * SCALE)), row * CH + FY - int(round(ay * SCALE))))
        if n == 'fire1': muzzle.append([round((c['flash'][0] - ax) * SCALE), round((c['flash'][1] - ay) * SCALE)] if c['flash'] else [0, -30])
atlas.save(OUT)
atlas.crop((1 * CW, 0, 2 * CW, CH)).crop(atlas.crop((1 * CW, 0, 2 * CW, CH)).getbbox()).save(os.path.join(os.path.dirname(OUT), 'turret.png'))   # idle, aiming down-right: wheel icon + placement preview (old art: tools/art/objects/turret-old.png)
print(f"TURRET_ART = {{ cw: {CW}, ch: {CH}, ax: {AX}, fy: {FY}, muzzle: {muzzle} }}   // muzzle: flash centre per aim (r, dr, d ... ur) from the ground point")
