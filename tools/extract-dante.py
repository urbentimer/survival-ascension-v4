# Cuts Dante's (Demolitionist) effect sheets and skill cards. His shotgun/knife/bat/axe atlas uses extract-directions.py and
# his crate-placing animation uses extract-zombie-dirs.py (commands at the bottom).
#   fx/dante-blast.png   3 rows (260x170 cells): cone blast (5, apex at the LEFT middle), shockwave (4, left-aligned), knockback dust (4)
#   fx/dante-demo.png    7 rows (130x110 cells, bottom-centred): crate detonation (6), grenade flight (4), landing marker (3),
#                        big explosion (6), small explosion (5), smoke + scorch (4), demo crate armed/triggered (6)
#   icons/card-breacherBlast.png, icons/card-demoRipple.png
import os, importlib.util
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('xd', os.path.join(here, 'extract-directions.py'))
xd = importlib.util.module_from_spec(spec); spec.loader.exec_module(xd)
C = os.path.join(here, '..', 'client', 'assets'); FX = os.path.join(C, 'sprites', 'fx')
load = lambda n: np.array(Image.open(os.path.join(here, 'art', n + '.png')).convert('RGB')).astype(int)

def rgba(part, glow):
    fg = xd.foreground(part); r, g, b = part[..., 0], part[..., 1], part[..., 2]
    tint = (r - g > 25) & (b - g > 25)
    bg = (r > 205) & (b > 205) & (g < 95) & (abs(r - b) < 45)
    fg |= tint & ~bg
    out = part.copy(); p = tint & fg
    v = out[p].max(1, keepdims=True).astype(float); out[p] = np.clip(v * np.array(glow), 0, 255).astype(int)
    a = np.zeros(part.shape[:2] + (4,), np.uint8); a[..., :3] = np.clip(out, 0, 255); a[..., 3] = fg * 255
    dist = np.sqrt(((part[p] - np.array([255, 0, 255])) ** 2).sum(1)); a[..., 3][p] = np.clip(dist * 1.6, 40, 245).astype(np.uint8)
    return a

def row_bands(src, n):
    r, g, b = src[..., 0], src[..., 1], src[..., 2]
    ink = xd.foreground(src) | ((r - g > 25) & (b - g > 25) & ~((r > 205) & (b > 205) & (g < 95)))
    return xd.squeeze(xd.runs_of(ink.sum(1) > 1, 25, 6), n)

def cut_row(S, band, n, k, cell, ri, glow, mode='even', align='bottom'):
    W = band.shape[1]
    if mode == 'even': bounds = [[round(i * W / n), round((i + 1) * W / n)] for i in range(n)]
    else:
        r, g, b = band[..., 0], band[..., 1], band[..., 2]
        ink = xd.foreground(band) | ((r - g > 25) & (b - g > 25) & ~((r > 205) & (b > 205) & (g < 95)))
        runs = xd.squeeze(xd.runs_of(ink.sum(0) > 1, 30, 3), n)
        if len(runs) < n: return cut_row(S, band, n, k, cell, ri, glow, 'even', align)
        bounds = [[0 if i == 0 else (runs[i - 1][1] + runs[i][0]) // 2, W if i == n - 1 else (runs[i][1] + runs[i + 1][0]) // 2] for i in range(len(runs))]
    for ci, (xa, xb) in enumerate(bounds):
        a = rgba(band[:, xa:xb], glow); ys, xs = np.where(a[..., 3] > 0)
        if not len(ys): continue
        img = Image.fromarray(a[ys.min():ys.max() + 1, xs.min():xs.max() + 1])
        img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
        img = img.crop((0, 0, min(img.width, cell[0]), min(img.height, cell[1])))
        x = ci * cell[0] + (6 if align == 'left' else (cell[0] - img.width) // 2)
        y = ri * cell[1] + ((cell[1] - img.height) // 2 if align == 'left' else cell[1] - 4 - img.height)
        S.alpha_composite(img, (x, y))

FIRE = (1.0, .55, .2)
# E blast
src = load('dante-blast-fx'); rows = row_bands(src, 3); cell = (260, 170)
S = Image.new('RGBA', (cell[0] * 5, cell[1] * 3))
for ri, ((y0, y1), n, k, al, mode) in enumerate(zip(rows, [5, 4, 4], [.62, .62, .38], ['left', 'left', 'bottom'], ['runs', 'runs', 'even'])):
    cut_row(S, src[max(0, y0 - 10):y1 + 10], n, k, cell, ri, FIRE, mode, al)
S.save(os.path.join(FX, 'dante-blast.png')); print('dante-blast.png', S.size)
# Demo Ripple pieces + the crate (bottom row of the placing sheet)
src = load('dante-ripple-fx'); rows = row_bands(src, 6); cell = (130, 110)
S = Image.new('RGBA', (cell[0] * 6, cell[1] * 7))
spec_rows = [(6, .43, 'even'), (4, .34, 'even'), (3, .30, 'runs'), (6, .45, 'even'), (5, .34, 'even'), (4, .32, 'even')]
for ri, ((y0, y1), (n, k, mode)) in enumerate(zip(rows, spec_rows)):
    cut_row(S, src[max(0, y0 - 10):y1 + 10], n, k, cell, ri, FIRE, mode)
pl = load('dante-place'); cut_row(S, pl[1078:1199], 6, .43, cell, 6, (1.0, .35, .3), 'runs')
S.save(os.path.join(FX, 'dante-demo.png')); print('dante-demo.png', S.size)
# Rocket effects (for the launcher and Sky Barrage): 5 rows x 4, 140x130 cells
#   0 rocket flying (points RIGHT, centred), 1 rocket going up (bottom-centred), 2 rocket coming down (bottom = nose), 3 target marker, 4 launch smoke
src = load('dante-rocket-fx'); rows = row_bands(src, 5); cell = (140, 130)
S = Image.new('RGBA', (cell[0] * 4, cell[1] * 5))
for ri, ((y0, y1), k, al) in enumerate(zip(rows, [.42, .38, .38, .36, .34], ['left', 'bottom', 'bottom', 'bottom', 'bottom'])):
    cut_row(S, src[max(0, y0 - 10):y1 + 10], 4, k, cell, ri, (1.0, .22, .18) if ri == 3 else FIRE, 'even', al)
S.save(os.path.join(FX, 'dante-rocket.png')); print('dante-rocket.png', S.size)
Image.open(os.path.join(here, 'art', 'dante-card-sky.png')).convert('RGB').crop((43, 39, 1209, 1199)).resize((152, 152), Image.LANCZOS).save(os.path.join(C, 'icons', 'card-skyBarrage.png')); print('card skyBarrage')
# Scorch marks: 3 rows x 4, 180x110 cells, centred: 0 big craters (4 variations), 1 small scorches (4), 2 hot crater cooling (4)
src = load('dante-scorch'); rows = row_bands(src, 3); cell = (180, 110)
S = Image.new('RGBA', (cell[0] * 4, cell[1] * 3))
for ri, (y0, y1) in enumerate(rows):
    cut_row(S, src[max(0, y0 - 10):y1 + 10], 4, .5, cell, ri, (.34, .27, .22), 'even', 'left')   # soot edges blended with magenta -> dark brown
# 'left' align puts frames at the left edge: re-centre each frame horizontally
arr = np.array(S); out = Image.new('RGBA', S.size)
for ri in range(3):
    for ci in range(4):
        c = Image.fromarray(arr[ri * cell[1]:(ri + 1) * cell[1], ci * cell[0]:(ci + 1) * cell[0]]); bb = c.getbbox()
        if bb: c = c.crop(bb); out.alpha_composite(c, (ci * cell[0] + (cell[0] - c.width) // 2, ri * cell[1] + (cell[1] - c.height) // 2))
o = np.array(out).astype(int); r, g, b = o[..., 0], o[..., 1], o[..., 2]
pink = (o[..., 3] > 0) & (b - g > 8) & (r - g > 15)            # leftover magenta tint (orange embers have b < g, so they stay)
v = o[..., :3][pink].mean(1) * .55; o[..., 0][pink] = v * 1.12; o[..., 1][pink] = v * .95; o[..., 2][pink] = v * .85
out = Image.fromarray(np.clip(o, 0, 255).astype(np.uint8))
out.save(os.path.join(FX, 'dante-scorch.png')); print('dante-scorch.png', out.size)
cards = Image.open(os.path.join(here, 'art', 'dante-cards.png')).convert('RGB')
for name, box in [('breacherBlast', (24, 40, 863, 845)), ('demoRipple', (911, 40, 1750, 845))]:
    cards.crop(box).resize((152, 152), Image.LANCZOS).save(os.path.join(C, 'icons', f'card-{name}.png')); print('card', name)
# Atlas + placing animation:
#   python3 tools/extract-directions.py demolitionist launcher=tools/art/dante-launcher.png%219x149.9 rifle=tools/art/dante-rifle.png%219x149.9 shotgun=tools/art/dante-shotgun.png%219x149.9 knife=tools/art/dante-knife.png%219x149.9 bat=tools/art/dante-bat.png%219x149.9 axe=tools/art/dante-axe.png%219x149.9
#   (then grey out the pink smoke in the atlas: pixels with r-g>30 and b-g>30)
#   python3 tools/extract-zombie-dirs.py dante-sky tools/art/dante-sky.png rows=D,DR,R,UR,U,UL,L,DL cols=4 pitch=256 height=70 refcol=0 cellw=150 cellh=124 dedust=1
#   python3 tools/extract-zombie-dirs.py dante-place "tools/art/dante-place.png#170,0,1160,1072" rows=D,DR,R,UR,U,UL,L,DL cols=4 pitch=247 height=54 refcol=3 cellw=150 cellh=100
