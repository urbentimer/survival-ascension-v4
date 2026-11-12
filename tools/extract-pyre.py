# THE PYRE PRIEST (boss, wave 8), from the user's ChatGPT art in tools/art/pyre/ (Nov 6):
#   walk / swing / sermon .png   5 rows (D, DR, R, UR, U) x 4 columns on flat magenta, no grid lines (frames found by gaps)
#   death.png                    1 row x 6, front view, magenta
#   portrait.png                 black background (boss intro card)
#   fx-*.png                     8 frames in a row on pure black (drawn additive in game: black = invisible)
# Writes (python3 tools/extract-pyre.py):
#   client/assets/sprites/zombies/dir8/pyre-<walk|swing|sermon>.webp  4 cols x 5 rows, cells 495x305, feet at (248, 261) (1.65x since Nov 12)
#       every frame is anchored on its OWN head (x) and feet (y), so nothing jitters between frames; the game mirrors DR/R/UR for the left
#   client/assets/sprites/zombies/dir8/pyre-death.webp                 6 frames, cells 300x185, same anchor (scaled to match the walk)
#   client/assets/sprites/fx/pyre-<pillar|pillar-enraged|trail|ember|swing>.webp   8 frames in a row, black background
#   client/assets/portraits/pyre.webp
import os, importlib.util
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'pyre')
spec = importlib.util.spec_from_file_location('xd', os.path.join(here, 'extract-directions.py')); xd = importlib.util.module_from_spec(spec); spec.loader.exec_module(xd)
C = os.path.join(here, '..', 'client', 'assets'); D8 = os.path.join(C, 'sprites', 'zombies', 'dir8'); FX = os.path.join(C, 'sprites', 'fx')
R = 1.65   # (Nov 12) he is drawn 1.65x in game: the sheets are cut at that size (0.99x the source art, so no browser stretch / blur); client PY.r
SCALE, CW, CH, AX, FY = 0.6 * R, round(300 * R), round(185 * R), round(150 * R), round(158 * R)   # cells 495 x 305, feet (248, 261)

def load(n): return np.array(Image.open(os.path.join(ART, n + '.png')).convert('RGB')).astype(int)

def keyed(a):   # magenta -> transparent (the shared rules), specks dropped
    fg = xd.foreground(a); lab, n = ndimage.label(fg); sz = ndimage.sum(fg, lab, range(1, n + 1))
    fg = np.isin(lab, [i + 1 for i in range(n) if sz[i] >= 30])
    return fg, np.dstack([np.clip(a, 0, 255).astype(np.uint8), (fg * 255).astype(np.uint8)])

def bands(occ, n):   # the n runs of occupied pixels (closest runs merged until there are n)
    runs, x = [], 0
    while x < len(occ):
        if occ[x]:
            s0 = x
            while x < len(occ) and occ[x]: x += 1
            runs.append([s0, x])
        x += 1
    while len(runs) > n:
        gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]; i = int(np.argmin(gaps)); runs[i][1] = runs[i + 1][1]; del runs[i + 1]
    assert len(runs) == n, (n, runs)
    return runs

def anchor(m):   # head x (centre of the top 40px: the halo / hood) and feet y (lowest pixel under the head)
    ys, xs = np.where(m); top = ys.min()
    hx = xs[ys < top + 40].mean()
    near = np.abs(xs - hx) < 45
    return hx, ys[near].max()

def resize_sharp(rgba, sc):   # (Nov 12) premultiplied Lanczos (no magenta fringe), soft antialiased edge, light unsharp mask on the colour
    from PIL import ImageFilter
    a = rgba[..., 3:4].astype(np.float32) / 255; pm = np.clip(rgba[..., :3].astype(np.float32) * a, 0, 255).astype(np.uint8)
    w, h = max(1, round(rgba.shape[1] * sc)), max(1, round(rgba.shape[0] * sc))
    up = lambda x: np.array(Image.fromarray(np.ascontiguousarray(x)).resize((w, h), Image.LANCZOS)).astype(np.float32)
    A = np.clip(np.dstack([up(pm[..., i]) for i in range(3)]), 0, 255); al = np.clip(up(rgba[..., 3]), 0, 255) / 255
    rgb = np.where(al[..., None] > .02, A / np.maximum(al[..., None], .02), 0)
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=1.2, percent=55, threshold=2))
    return Image.fromarray(np.dstack([np.array(img), (np.clip((al - .18) / .64, 0, 1) * 255).astype(np.uint8)]))

def place(rgba, m, sc=SCALE):
    hx, fy = anchor(m)
    im = resize_sharp(np.ascontiguousarray(rgba), sc)
    cell = Image.new('RGBA', (CW, CH)); ox, oy = round(AX - hx * sc), round(FY - fy * sc)
    if ox < 0 or oy < 0 or ox + im.width > CW or oy + im.height > CH: print('   clipped', ox, oy, im.size)
    cell.paste(im, (ox, oy), im); return cell

HEIGHT = {}   # standing height (source px) of each sheet's first frame, to match the death sheet's scale to the walk
def sheet(name, rows=5, cols=4):
    a = load(name); fg, rgba = keyed(a); atlas = Image.new('RGBA', (CW * cols, CH * rows)); sc = SCALE
    for r, (y0, y1) in enumerate(bands(fg.any(1), rows)):
        for c, (x0, x1) in enumerate(bands(fg[y0:y1].any(0), cols)):
            m = fg[y0:y1, x0:x1]
            if r == 0 and c == 0:
                ys = np.where(m.any(1))[0]; HEIGHT[name] = ys.max() - ys.min()
                if name == 'death': sc = SCALE * HEIGHT['walk'] / HEIGHT['death']
            atlas.alpha_composite(place(rgba[y0:y1, x0:x1], m, sc), (c * CW, r * CH))
    out = os.path.join(D8, f'pyre-{name}.webp'); atlas.save(out, quality=90, alpha_quality=92, method=6)
    print(name, '->', os.path.getsize(out) // 1024, 'KB')

for n in ['walk', 'swing', 'sermon']: sheet(n)
sheet('death', rows=1, cols=6)

# effects on black: crop to the rows anything is drawn on, keep 8 equal frames; tiny noise -> pure black
def fx(name, out_name):
    a = load(name); lum = a.max(2); H, W = a.shape[:2]; fw = W / 8
    ys = np.where((lum > 24).any(1))[0]; y0, y1 = max(0, ys.min() - 6), min(H, ys.max() + 6)
    frames = []
    for i in range(8):
        f = a[y0:y1, round(i * fw):round(i * fw) + int(fw)].copy(); f[f.max(2) < 10] = 0; frames.append(f)
    w = min(f.shape[1] for f in frames); img = np.concatenate([f[:, :w] for f in frames], 1).astype(np.uint8)
    path = os.path.join(FX, f'pyre-{out_name}.webp'); Image.fromarray(img).save(path, quality=84, method=6)
    print(out_name, Image.fromarray(img).size, 'frame', w, 'x', y1 - y0, '->', os.path.getsize(path) // 1024, 'KB')
for src, dst in [('fx-pillar', 'pillar'), ('fx-pillar-enraged', 'pillar-enraged'), ('fx-trail', 'trail'), ('fx-ember', 'ember'), ('fx-swing', 'swing')]: fx(src, dst)

# portrait: black background -> transparent (only the black connected to the border)
p = load('portrait'); dark = p.max(2) <= 14; lab, n = ndimage.label(dark)
edge = set(np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]])) - {0}; bg = np.isin(lab, list(edge))
im = Image.fromarray(np.dstack([p, np.where(bg, 0, 255)]).astype(np.uint8)); im = im.crop(im.getbbox())
im.thumbnail((560, 560), Image.LANCZOS); im.save(os.path.join(C, 'portraits', 'pyre.webp'), quality=86, alpha_quality=90, method=6)
print('portrait', im.size)
