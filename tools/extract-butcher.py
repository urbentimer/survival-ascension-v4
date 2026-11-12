# Cuts the Butcher boss extras (the walk / chop / hook-throw sheets use extract-zombie-dirs.py):
#   fx/butcher-hook.png      the flying meat hook (pointing right; the game rotates it)
#   fx/butcher-chain.png     one chain segment (repeated along the chain)
#   dir8/butcher-spin.png    8 frames: enraged whirlwind (no directions: he spins)
#   dir8/butcher-death.png   6 frames: death
#   fx/butcher-shock.png     4 rows x 6: crack, red (damage) ring, yellow (stun) ring, blue (slow) ring
#   portraits/butcher.webp   front view for the boss intro card
# Usage: python3 tools/extract-butcher.py   (reads tools/art/butcher-*.png)
# (Nov 12) He is 1.5x bigger and sharpened. The walk / chop / hook / stagger sheets (then saved as .webp q90, alpha 92):
#   SHARPEN=85 python3 tools/extract-zombie-dirs.py butcher tools/art/butcher-walk.png#150,0,1536,1024 height=192 cellw=345 cellh=278 name=butcher-walk
#   SHARPEN=85 python3 tools/extract-zombie-dirs.py butcher tools/art/butcher-chop.png#150,0,1536,1024 height=185 cellw=480 cellh=375 name=butcher-chop
#   SHARPEN=85 python3 tools/extract-zombie-dirs.py butcher tools/art/butcher-hook.png#90,0,1206,1024 height=189 cellw=630 cellh=375 pitch=186 name=butcher-hook
#   SHARPEN=85 python3 tools/extract-zombie-dirs.py butcher tools/art/butcher-stagger.png#140,0,1199,1312 height=197 cellw=390 cellh=300 cols=4 name=butcher-stagger
#   (before: height 128 / 123 / 126 / 131, cells 230x185, 320x250, 420x250, 260x200)
import os, json, importlib.util
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('xd', os.path.join(here, 'extract-directions.py'))
xd = importlib.util.module_from_spec(spec); spec.loader.exec_module(xd)
A = lambda n: np.array(Image.open(os.path.join(here, 'art', f'butcher-{n}.png')).convert('RGB')).astype(int)
C = os.path.join(here, '..', 'client', 'assets'); FX = os.path.join(C, 'sprites', 'fx'); D8 = os.path.join(C, 'sprites', 'zombies', 'dir8')
os.makedirs(FX, exist_ok=True)
meta = {}

def piece(src, keep_small=20, outline=True, tint=(0.85, 0.3, 0.3)):
    """Cut everything that isn't magenta out of src -> RGBA image (tight crop)."""
    fg = ndimage.binary_opening(xd.foreground(src), iterations=1)
    lab, n = ndimage.label(fg, structure=np.ones((3, 3)))
    sizes = ndimage.sum(fg, lab, range(1, n + 1))
    m = np.isin(lab, [i + 1 for i in range(n) if sizes[i] >= keep_small])
    ys, xs = np.where(m); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    sub = m[y0:y1, x0:x1]; rgb = src[y0:y1, x0:x1].copy()
    pink = sub & (rgb[..., 0] - rgb[..., 1] > 30) & (rgb[..., 2] - rgb[..., 1] > 30) & (rgb[..., 1] < 150)
    if tint == 'blue':   # pale dust blended with the magenta background -> blue-grey dust
        v = rgb[pink].mean(1, keepdims=True); rgb[pink] = np.clip(v * [0.78, 0.86, 1.0] + 20, 0, 255).astype(int)
    else: rgb[pink] = (rgb[pink] * tint).astype(int)              # magenta-tinted fringe -> dark red
    rgba = np.zeros(sub.shape + (4,), np.uint8); rgba[..., :3] = np.clip(rgb, 0, 255); rgba[..., 3] = sub * 255
    return Image.fromarray(rgba)

def shrink(img, k):   # (Nov 12) + an unsharp mask that only blurs the figure's own pixels
    img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
    a = np.array(img); al = a[..., 3] > 100; a[..., 3] = al * 255
    f = al.astype(np.float32); rgb = a[..., :3].astype(np.float32); sig = max(1.0, k) * .9
    bl = np.dstack([ndimage.gaussian_filter(rgb[..., i] * f, sig) for i in range(3)]) / np.maximum(ndimage.gaussian_filter(f, sig), 1e-3)[..., None]
    d = rgb - bl; d = np.where(np.abs(d) > 2, d, 0); a[..., :3] = np.where(al[..., None], np.clip(rgb + d * .85, 0, 255), rgb).astype(np.uint8)
    return Image.fromarray(a)

# --- hook + chain (right panel of the hook sheet) ---
hk = A('hook')
hook = shrink(piece(hk[262:352, 1300:1500]), 0.62); hook.save(os.path.join(FX, 'butcher-hook.png'))
chain = shrink(piece(hk[915:990, 1280:1480]), 0.36); chain.save(os.path.join(FX, 'butcher-chain.png'))
meta['hook'] = hook.size; meta['chain'] = chain.size

# --- spin (row 1, 8 frames) + death (row 2, 6 frames) ---
sd = A('spin-death'); fg = xd.foreground(sd)
rows = xd.squeeze(xd.runs_of(fg.sum(1) > 2, 20, 40), 2)
def strip(y0, y1, n, cell, name, scale, pitch=None, x0=0):
    band = sd[max(0, y0 - 6):y1 + 6]; f2 = xd.foreground(band)
    if pitch == 'body':   # frames found by where the body is (tall columns); split halfway between bodies
        bodies = xd.runs_of(f2.sum(0) > 90, 10, 20); cen = [(r0 + r1) // 2 for r0, r1 in bodies]
        cols = [[0 if i == 0 else (cen[i - 1] + cen[i]) // 2, band.shape[1] if i == len(cen) - 1 else (cen[i] + cen[i + 1]) // 2] for i in range(len(cen))]
    else: cols = xd.squeeze(xd.runs_of(f2.sum(0) > 1, 12, 20), n)
    out = Image.new('RGBA', (cell[0] * n, cell[1]))
    for i, (xa, xb) in enumerate(cols):
        img = shrink(piece(band[:, max(0, xa - 2):xb + 2]), scale)
        out.alpha_composite(img, (i * cell[0] + (cell[0] - img.width) // 2, cell[1] - 6 - img.height))
    out.save(os.path.join(D8, name)); return out
body_h = rows[0][1] - rows[0][0]
k = 145 * 1.5 / body_h      # standing frame ~218px tall in game (1.5x since Nov 12; same as the walk sheet incl. the cleaver)
strip(*rows[0], 8, (495, 345), 'butcher-spin.png', k, pitch='body')   # (saved as .webp for the game)
strip(*rows[1], 6, (495, 345), 'butcher-death.png', k)
meta['spin'] = meta['death'] = {'cellW': 495, 'cellH': 345, 'feetY': 339}

# --- shockwave rings: 4 rows x 6 (kept at sheet scale; the game scales each ring to its zone) ---
sh = A('shockwave'); fg = xd.foreground(sh)
rows = xd.squeeze(xd.runs_of(fg.sum(1) > 2, 18, 20), 4)
CW, CH = 300, 180
shock = Image.new('RGBA', (CW * 6, CH * 4)); widths = []
# frame columns are the same in every row: take them from the red ring row (cleanly separated), split halfway between
ref = sh[max(0, rows[1][0] - 8):rows[1][1] + 8]
rc = xd.squeeze(xd.runs_of(xd.foreground(ref).sum(0) > 1, 14, 6), 6)
bounds = [[0 if i == 0 else (rc[i - 1][1] + rc[i][0]) // 2, sh.shape[1] if i == 5 else (rc[i][1] + rc[i + 1][0]) // 2] for i in range(6)]
for r, (y0, y1) in enumerate(rows):
    band = sh[max(0, y0 - 8):y1 + 8]
    cols = bounds
    rw = []
    for c, (xa, xb) in enumerate(cols):
        img = piece(band[:, xa:xb], keep_small=6, tint='blue' if r == 3 else (0.85, 0.3, 0.3))
        if img.width > CW - 4: img = shrink(img, (CW - 4) / img.width)
        cx = CW // 2; cy = int(CH * .62)                                # ring centre sits here in the cell
        bottom = img.height; ring_half_h = img.width / 4               # rings are 2:1 ellipses: centre = bottom - width/4
        shock.alpha_composite(img, (c * CW + cx - img.width // 2, max(0, r * CH + int(cy - (bottom - ring_half_h)))))
        rw.append(img.width)
    widths.append(max(rw))
shock.save(os.path.join(FX, 'butcher-shock.png'))
meta['shock'] = {'cellW': CW, 'cellH': CH, 'centerY': int(CH * .62), 'ringWidths': widths}

# --- portrait (front view) ---
ds = A('design')
front = piece(ds[:, :ds.shape[1] // 3])
front = front.resize((round(front.width * 520 / front.height), 520), Image.LANCZOS)
front.save(os.path.join(C, 'portraits', 'butcher.webp'), quality=88)
meta['portrait'] = front.size
json.dump(meta, open(os.path.join(FX, 'butcher.json'), 'w'), indent=1, default=list)
print(json.dumps(meta, default=list))
