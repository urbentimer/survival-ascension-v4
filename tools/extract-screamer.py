# THE SCREAMER (boss, wave 12), from the user's ChatGPT art in tools/art/screamer/ (Nov 9):
#   walk / shriek .png         5 rows (D, DR, R, UR, U) x 4 columns on flat magenta (frames found by gaps)
#   wail (6) / choke (4) / death (6) .png   1 row, front view, magenta
#   portrait.png               black background (boss intro card)
#   fx-*.png                   8 frames in a row on pure black (drawn additive in game: black = invisible); frames found by gaps
# Writes (python3 tools/extract-screamer.py):
#   client/assets/sprites/zombies/dir8/screamer-<walk|shriek>.webp   4 cols x 5 rows, cells CW x CH, feet at (AX, FY) (600 x 480, (300, 430) since Nov 12: 2x)
#   client/assets/sprites/zombies/dir8/screamer-<wail|choke|death>.webp   1 row, same cells, scaled to match the walk
#   client/assets/sprites/fx/screamer-<ring|ring2|mark|burst|wail>.webp     8 frames in a row, black background
#   client/assets/portraits/screamer.webp
# Each frame is anchored on its torso (x: median of the body's middle band, so the shoulder horns don't pull it) and its feet (y).
import os, importlib.util
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'screamer')
spec = importlib.util.spec_from_file_location('xd', os.path.join(here, 'extract-directions.py')); xd = importlib.util.module_from_spec(spec); spec.loader.exec_module(xd)
C = os.path.join(here, '..', 'client', 'assets'); D8 = os.path.join(C, 'sprites', 'zombies', 'dir8'); FX = os.path.join(C, 'sprites', 'fx')
R = 2   # (Nov 12) he is drawn 2x in game: the sheets are cut at that size straight from the source art (no browser stretch / blur); client SCR.r
SCALE, CW, CH, AX, FY = 0.64 * R, 300 * R, 240 * R, 150 * R, 215 * R   # the walk's DOWN frame ends up ~340px tall (170 before Nov 12); cells 600 x 480, feet (300, 430)

def load(n): return np.array(Image.open(os.path.join(ART, n + '.png')).convert('RGB')).astype(int)

def keyed(a):   # magenta -> transparent (the shared rules), specks dropped
    fg = xd.foreground(a); lab, n = ndimage.label(fg); sz = ndimage.sum(fg, lab, range(1, n + 1))
    fg = np.isin(lab, [i + 1 for i in range(n) if sz[i] >= 30])
    rgb = a.copy()
    # despill: glow pixels next to the magenta keep a pink cast; pull red/blue down toward green where it's pinkish
    pink = fg & (rgb[..., 0] > rgb[..., 1] + 40) & (rgb[..., 2] > rgb[..., 1] + 40)
    edge = fg & ~ndimage.binary_erosion(fg, iterations=2)
    m = pink & edge; lo = np.minimum(rgb[..., 0], rgb[..., 2])
    rgb[..., 0] = np.where(m, np.minimum(rgb[..., 0], rgb[..., 1] + 30), rgb[..., 0]); rgb[..., 2] = np.where(m, np.minimum(rgb[..., 2], np.maximum(rgb[..., 1] + 60, lo)), rgb[..., 2])
    # glow that blended with the magenta turns purple: bright, saturated violet pixels -> his cyan (the skin's mauve shading is far less saturated)
    vio = fg & (rgb[..., 2] > 140) & (rgb[..., 2] - rgb[..., 1] > 45) & (rgb[..., 0] > rgb[..., 1] - 15)
    b = rgb[..., 2]; rgb[..., 0] = np.where(vio, b * .25, rgb[..., 0]); rgb[..., 1] = np.where(vio, b * .9, rgb[..., 1])
    return fg, np.dstack([np.clip(rgb, 0, 255).astype(np.uint8), (fg * 255).astype(np.uint8)])

def bands(occ, n, min_gap=0):   # the n runs of occupied pixels (closest runs merged until there are n)
    runs, x = [], 0
    while x < len(occ):
        if occ[x]:
            s0 = x
            while x < len(occ) and occ[x]: x += 1
            runs.append([s0, x])
        x += 1
    runs = [r for r in runs if r[1] - r[0] > 3]
    while len(runs) > n:
        gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]; i = int(np.argmin(gaps)); runs[i][1] = runs[i + 1][1]; del runs[i + 1]
    assert len(runs) == n, (n, runs)
    return runs

def anchor(m):
    ys, xs = np.where(m); top, bot = ys.min(), ys.max(); h = bot - top
    band = (ys > top + h * .35) & (ys < top + h * .75)
    return float(np.median(xs[band])), bot

def resize_sharp(rgba, sc):   # (Nov 12) premultiplied Lanczos (no magenta fringe), soft antialiased edge, unsharp mask on the colour
    from PIL import ImageFilter
    a = rgba[..., 3:4].astype(np.float32) / 255; pm = np.clip(rgba[..., :3].astype(np.float32) * a, 0, 255).astype(np.uint8)
    w, h = max(1, round(rgba.shape[1] * sc)), max(1, round(rgba.shape[0] * sc))
    up = lambda x: np.array(Image.fromarray(np.ascontiguousarray(x)).resize((w, h), Image.LANCZOS)).astype(np.float32)
    A = np.clip(np.dstack([up(pm[..., i]) for i in range(3)]), 0, 255); al = np.clip(up(rgba[..., 3]), 0, 255) / 255
    rgb = np.where(al[..., None] > .02, A / np.maximum(al[..., None], .02), 0)
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=1.4 * max(1, sc), percent=65, threshold=2))
    return Image.fromarray(np.dstack([np.array(img), (np.clip((al - .18) / .64, 0, 1) * 255).astype(np.uint8)]))

def place(rgba, m, sc):
    hx, fy = anchor(m)
    im = resize_sharp(np.ascontiguousarray(rgba), sc)
    cell = Image.new('RGBA', (CW, CH)); ox, oy = round(AX - hx * sc), round(FY - fy * sc)
    if ox < 0 or oy < 0 or ox + im.width > CW or oy + im.height > CH: print('   clipped', ox, oy, im.size)
    cell.paste(im, (ox, oy), im); return cell

HEIGHT = {}
def sheet(name, rows=5, cols=4):
    a = load(name); fg, rgba = keyed(a); atlas = Image.new('RGBA', (CW * cols, CH * rows)); sc = SCALE
    for r, (y0, y1) in enumerate(bands(fg.any(1), rows)):
        for c, (x0, x1) in enumerate(bands(fg[y0:y1].any(0), cols)):
            m = fg[y0:y1, x0:x1]
            if r == 0 and c == 0:
                ys = np.where(m.any(1))[0]; HEIGHT[name] = ys.max() - ys.min()
                if name != 'walk': sc = SCALE * HEIGHT['walk'] / HEIGHT[name]   # single-row sheets were drawn bigger: match the walk
                print(name, 'first frame', HEIGHT[name], 'px tall -> scale', round(sc, 3), '->', round(HEIGHT[name] * sc), 'px')
            atlas.alpha_composite(place(rgba[y0:y1, x0:x1], m, sc), (c * CW, r * CH))
    out = os.path.join(D8, f'screamer-{name}.webp'); atlas.save(out, quality=90, alpha_quality=92, method=6)
    print(' ', name, atlas.size, '->', os.path.getsize(out) // 1024, 'KB')

sheet('walk'); sheet('shriek')
sheet('wail', rows=1, cols=6); sheet('choke', rows=1, cols=4); sheet('death', rows=1, cols=6)

# effects on black: each frame found by its own gap, centred in an equal cell (the frames grow, so they aren't evenly spaced)
def fx(name, out_name, size):
    a = load(name); lum = a.max(2); H, W = a.shape[:2]
    occ = lum > 30; ys = np.where(occ.any(1))[0]; y0, y1 = max(0, ys.min() - 8), min(H, ys.max() + 8)
    try: runs = bands(occ[y0:y1].any(0), 8)
    except AssertionError: runs = None
    if runs is None or max(r[1] - r[0] for r in runs) > 1.5 * W / 8:   # frames touch (glow overlaps): fall back to 8 equal slots
        fw = W / 8; runs = [[round(i * fw), round((i + 1) * fw)] for i in range(8)]; print('  ', name, 'equal slots')
    cw = max(r[1] - r[0] for r in runs) + 16
    frames = []
    for x0, x1 in runs:
        cx = (x0 + x1) // 2; f = np.zeros((y1 - y0, cw, 3), np.uint8)
        s0, s1 = max(0, cx - cw // 2), min(W, cx - cw // 2 + cw); piece = a[y0:y1, s0:s1].copy()
        lo, hi = x0 - s0, x1 - s0; piece[:, :max(0, lo)] = 0; piece[:, hi:] = 0   # only this frame's pixels
        piece[piece.max(2) < 12] = 0; f[:, (s0 - (cx - cw // 2)):(s0 - (cx - cw // 2)) + piece.shape[1]] = piece; frames.append(f)
    img = Image.fromarray(np.concatenate(frames, 1)); k = size / cw
    if k < 1: img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
    path = os.path.join(FX, f'screamer-{out_name}.webp'); img.save(path, quality=84, method=6)
    print(out_name, img.size, 'frame', img.width // 8, 'x', img.height, '->', os.path.getsize(path) // 1024, 'KB')
for src, dst, size in [('fx-ring', 'ring', 300), ('fx-ring-enraged', 'ring2', 300), ('fx-mark', 'mark', 220), ('fx-burst', 'burst', 240), ('fx-wail', 'wail', 300)]: fx(src, dst, size)

# portrait: black background -> transparent (only the black connected to the border)
p = load('portrait'); dark = p.max(2) <= 14; lab, n = ndimage.label(dark)
edge = set(np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]])) - {0}; bg = np.isin(lab, list(edge))
im = Image.fromarray(np.dstack([p, np.where(bg, 0, 255)]).astype(np.uint8)); im = im.crop(im.getbbox())
im.thumbnail((560, 560), Image.LANCZOS); im.save(os.path.join(C, 'portraits', 'screamer.webp'), quality=86, alpha_quality=90, method=6)
print('portrait', im.size)
