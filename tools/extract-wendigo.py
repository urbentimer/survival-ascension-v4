# THE WENDIGO (boss, wave 8), from the user's ChatGPT art in tools/art/wendigo/ (Nov 5):
#   walk / roots / claw / crows / spikes .png   8 rows (D, DR, R, UR, U, UL, L, DL) x 4 columns on magenta, thin white grid lines
#   death.png                                  1 row x 6, front view, magenta
#   portrait.png                               black background (boss intro card)
#   fx-roots / fx-slash / fx-crows / fx-spikes  8 x 4 = 32 frames each on a light "transparency" checkerboard
# Writes (python3 tools/extract-wendigo.py):
#   client/assets/sprites/zombies/dir8/wendigo-<sheet>.webp   4 cols x 5 rows (D, DR, R, UR, U; left = mirrored), CELL 360x150, feet at (180, 136)
#   client/assets/sprites/zombies/dir8/wendigo-death.webp      6 frames, 300x200 cells, feet at (150, 188)
#   client/assets/sprites/fx/wendigo-<fx>.webp                 16 frames (every 2nd), 8 x 2, 176x176 cells, ground at (88, 160)
#   client/assets/portraits/wendigo.webp
import os, importlib.util
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'wendigo')
spec = importlib.util.spec_from_file_location('xd', os.path.join(here, 'extract-directions.py')); xd = importlib.util.module_from_spec(spec); spec.loader.exec_module(xd)
C = os.path.join(here, '..', 'client', 'assets'); D8 = os.path.join(C, 'sprites', 'zombies', 'dir8'); FX = os.path.join(C, 'sprites', 'fx')
CW, CH, AX, FY = 360, 150, 180, 136
def load(n): return np.array(Image.open(os.path.join(ART, n + '.png')).convert('RGB')).astype(int)

def lines(white, axis, n):   # the grid lines: runs of mostly-white rows/cols -> n cells between them
    occ = white.mean(axis=axis) > .45
    idx = [i for i in range(len(occ)) if occ[i]]
    groups = []
    for i in idx:
        if groups and i - groups[-1][-1] <= 3: groups[-1].append(i)
        else: groups.append([i])
    cuts = [0] + [ (g[0] + g[-1]) // 2 for g in groups if 5 < (g[0] + g[-1]) // 2 < len(occ) - 5 ] + [len(occ)]
    cells = [(cuts[i], cuts[i + 1]) for i in range(len(cuts) - 1) if cuts[i + 1] - cuts[i] > 40]
    assert len(cells) == n, (axis, n, cells)
    return cells

def keyed(a):   # magenta -> transparent (shared rules with the other sheets), drop specks and the white grid lines
    fg = xd.foreground(a) & ~((a.min(2) > 215) & (a.max(2) - a.min(2) < 30))
    lab, n = ndimage.label(fg); sz = ndimage.sum(fg, lab, range(1, n + 1))
    fg = np.isin(lab, [i + 1 for i in range(n) if sz[i] >= 25])
    return np.dstack([np.clip(a, 0, 255).astype(np.uint8), (fg * 255).astype(np.uint8)])

def sheet(name):
    a = load(name); white = a.min(2) > 200
    rows, cols = lines(white, 1, 8), lines(white, 0, 4)
    rgba = keyed(a); atlas = Image.new('RGBA', (CW * 4, CH * 5))
    for r, (y0, y1) in enumerate(rows[:5]):   # D, DR, R, UR, U: the game mirrors DR/R/UR for the left side
        # anchor from column 0 (the neutral pose in every sheet): body centre x, body bottom
        x0, x1 = cols[0]; m = rgba[y0 + 3:y1 - 2, x0 + 3:x1 - 2, 3] > 0
        lab, n = ndimage.label(m); sz = ndimage.sum(m, lab, range(1, n + 1)); body = lab == (int(np.argmax(sz)) + 1)
        ys, xs = np.where(body); bx, by = (xs.min() + xs.max()) / 2, ys.max()
        for c, (cx0, cx1) in enumerate(cols):
            cell = Image.fromarray(np.ascontiguousarray(rgba[y0 + 3:y1 - 2, cx0 + 3:cx1 - 2]))
            out = Image.new('RGBA', (CW, CH)); out.paste(cell, (round(AX - bx), round(FY - by)), cell)
            atlas.alpha_composite(out, (c * CW, r * CH))
    atlas.save(os.path.join(D8, f'wendigo-{name}.webp'), quality=78, alpha_quality=85, method=6)
    print(name, '->', os.path.getsize(os.path.join(D8, f'wendigo-{name}.webp')) // 1024, 'KB')
    return a, rows, cols

walk_a, walk_rows, walk_cols = sheet('walk')
for n in ['roots', 'claw', 'crows', 'spikes']: sheet(n)

# death: front view, scaled to the walk's front (row 0) width
def body_w(rgba):
    m = rgba[..., 3] > 0; lab, n = ndimage.label(m); sz = ndimage.sum(m, lab, range(1, n + 1)); ys, xs = np.where(lab == (int(np.argmax(sz)) + 1))
    return xs.max() - xs.min(), xs, ys
w_rgba = keyed(walk_a)[walk_rows[0][0] + 3:walk_rows[0][1] - 2, walk_cols[0][0] + 3:walk_cols[0][1] - 2]
front_w = body_w(w_rgba)[0]
d = load('death'); dk = keyed(d); dcols = lines(d.min(2) > 200, 0, 6)
first = dk[:, dcols[0][0] + 3:dcols[0][1] - 2]; dw, dxs, dys = body_w(first); s = front_w / dw * 1.1
bx, by = (dxs.min() + dxs.max()) / 2 * s, dys.max() * s
DW, DH, DAX, DFY = 300, 200, 150, 188
atlas = Image.new('RGBA', (DW * 6, DH))
for c, (x0, x1) in enumerate(dcols):
    cell = Image.fromarray(np.ascontiguousarray(dk[:, x0 + 3:x1 - 2])); cell = cell.resize((round(cell.width * s), round(cell.height * s)), Image.LANCZOS)
    q = np.array(cell); q[..., 3] = np.where(q[..., 3] > 100, 255, 0); cell = Image.fromarray(q)
    out = Image.new('RGBA', (DW, DH)); out.paste(cell, (round(DAX - bx), round(DFY - by)), cell); atlas.alpha_composite(out, (c * DW, 0))
atlas.save(os.path.join(D8, 'wendigo-death.webp'), quality=86, alpha_quality=90, method=6); print('death scale', round(s, 3))

# effects on the light checkerboard: background = bright, grey (no colour), connected to the frame border.
def fx(name):
    a = load(name); H, W = a.shape[:2]; ch, cw = H / 4, W / 8
    FC = 176; out = Image.new('RGBA', (FC * 8, FC * 2)); k = 0
    for i in range(0, 32, 2):
        r, c = divmod(i, 8); y0, y1, x0, x1 = round(r * ch) + 4, round((r + 1) * ch) - 3, round(c * cw) + 4, round((c + 1) * cw) - 3
        p = a[y0:y1, x0:x1]; lo, hi = p.min(2), p.max(2)
        bgish = (lo >= 226) & (hi - lo <= 18)
        lab, n = ndimage.label(bgish); edge = set(np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]])) - {0}
        bg = np.isin(lab, list(edge))
        pocket = (lo >= 238) & (hi - lo <= 7); pl, pn = ndimage.label(pocket); psz = ndimage.sum(pocket, pl, range(1, pn + 1))
        bg |= np.isin(pl, [i + 1 for i in range(pn) if psz[i] >= 40])   # checker showing through gaps between tentacles / crows
        # soft parts fade out (colour-to-alpha against white): the light edge next to the background, and the pale pink glow
        # haze connected to it (pink: green ~ blue; dust is beige: green > blue, so it stays solid)
        band = ndimage.binary_dilation(bg, iterations=2) & ~bg
        haze = (lo >= 140) & (p[..., 1] - p[..., 2] < 14) & ~bg
        haze = ndimage.binary_propagation(bg, mask=bg | haze) & haze
        alpha = np.where(bg, 0, 255).astype(float)
        soft = (band & (lo > 170)) | haze; alpha[soft] = np.clip((255 - lo[soft]) / (255 - 120) * 255, 0, 255)
        rgb = p.astype(float).copy()
        f = alpha[..., None] / 255
        rgb = np.where(soft[..., None], np.clip((rgb - (1 - f) * 255) / np.maximum(f, .05), 0, 255), rgb)
        tile = Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8)).resize((FC, FC), Image.LANCZOS)
        out.alpha_composite(tile, ((k % 8) * FC, (k // 8) * FC)); k += 1
    path = os.path.join(FX, f'wendigo-{name[3:]}.webp'); out.save(path, quality=78, alpha_quality=80, method=6)
    print(name, '->', os.path.getsize(path) // 1024, 'KB')
for n in ['fx-roots', 'fx-slash', 'fx-crows', 'fx-spikes']: fx(n)

# portrait: black background -> transparent (only the black connected to the border)
p = load('portrait'); dark = p.max(2) <= 14; lab, n = ndimage.label(dark)
edge = set(np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]])) - {0}; bg = np.isin(lab, list(edge))
im = Image.fromarray(np.dstack([p, np.where(bg, 0, 255)]).astype(np.uint8)); im = im.crop(im.getbbox())
im.thumbnail((560, 560), Image.LANCZOS); im.save(os.path.join(C, 'portraits', 'wendigo.webp'), quality=86, alpha_quality=90, method=6)
print('portrait', im.size)
