# Fallen Dynasty (grid map, Nov 5) pieces from the user's ChatGPT art in tools/art/dynasty2 (all on solid blue #0000FF):
#   big-<name>.png   one big building per image (shop, shopBurnt, apartment, ruin, gate, wall, pavilion, pagoda, fountain)
#   buildings.png    4x4 sheet: row 3 = (pagoda), market stall, sandbags, stone lion; row 4 = army truck, taxi, burnt car, bus
#   props.png        4x4 sheet: trees, lamps / lanterns / banner, crates / barrels / rubble / cart, flat ground bits
#   tiles.png        4 ground textures in a row: asphalt, plaza slabs, cobblestones, grass
#   python3 tools/extract-dynasty.py
# Writes client/assets/map/dyn/<kind>.webp (scaled to in-game size, bottom-centre = where it stands), tile-<name>.webp
# (seamless, 256px) and dyn.json: per kind its size, LIGHTS (lit lanterns / windows, from the art: glow + night light) and
# FIRES (burning spots on the burnt buildings: animated flames in game), as offsets from the bottom centre.
import os, json
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'dynasty2')
OUT = os.path.join(here, '..', 'client', 'assets', 'map', 'dyn'); os.makedirs(OUT, exist_ok=True)
Q = 78

def blue_key(a):
    a = a.astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    bg = (b > 150) & (b - np.maximum(r, g) > 105)
    soft = (b > 100) & (b - np.maximum(r, g) > 50)
    for _ in range(2): bg |= ndimage.binary_dilation(bg) & soft
    lab, n = ndimage.label(~bg); sizes = ndimage.sum(~bg, lab, range(1, n + 1))
    keep = np.isin(lab, [i + 1 for i in range(n) if sizes[i] > 40])
    edge = keep & ndimage.binary_dilation(~keep, iterations=2)           # blue spill on the outline
    a[..., 2] = np.where(edge, np.minimum(b, np.maximum(r, g) + 25), b)
    return np.dstack([np.clip(a, 0, 255).astype(np.uint8), (keep * 255).astype(np.uint8)])

def crop(c):
    ys, xs = np.where(c[..., 3] > 0); return c[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

def grid_cells(rgba, n):   # n x n even grid: each blob goes to the cell its centre is in
    lab, _ = ndimage.label(rgba[..., 3] > 0); objs = ndimage.find_objects(lab); ph, pw = rgba.shape[0] / n, rgba.shape[1] / n
    cells = [[[] for _ in range(n)] for _ in range(n)]
    for i, sl in enumerate(objs):
        if sl is None: continue
        cells[min(n - 1, int((sl[0].start + sl[0].stop) / 2 // ph))][min(n - 1, int((sl[1].start + sl[1].stop) / 2 // pw))].append(i + 1)
    return [[crop(np.where(np.isin(lab, ids)[..., None], rgba, 0).astype(np.uint8)) if ids else None for ids in row] for row in cells]

def spots(a, kind, maxn):   # lit lanterns / windows (warm, bright) or fire (very bright yellow-orange): blob centres, biggest first
    r, g, b, al = [a[..., i].astype(int) for i in range(4)]
    if kind == 'fire': m = (al > 0) & (r > 235) & (g > 150) & (b < 120) & (r - b > 150)
    else: m = (al > 0) & (r > 220) & (g > 110) & (b < 140) & (r - b > 110)
    m = ndimage.binary_opening(m, iterations=1); m = ndimage.binary_dilation(m, iterations=3)
    lab, n = ndimage.label(m)
    if not n: return []
    sizes = ndimage.sum(m, lab, range(1, n + 1)); cents = ndimage.center_of_mass(m, lab, range(1, n + 1))
    order = np.argsort(-sizes); out = []
    for i in order:
        if sizes[i] < 18: break
        cy, cx = cents[i]
        if any(abs(cx - x) < 22 and abs(cy - y) < 22 for x, y, _ in out): continue
        out.append((cx, cy, float(sizes[i])))
        if len(out) >= maxn: break
    return out

pieces = {}
def save(kind, c, width, lights=0, fires=0, flat=False):
    c = crop(c); sc = width / c.shape[1]
    im = Image.fromarray(np.ascontiguousarray(c)).resize((round(c.shape[1] * sc), round(c.shape[0] * sc)), Image.LANCZOS)
    a = np.array(im); a[..., 3] = np.where(a[..., 3] > 90, 255, 0); im = Image.fromarray(a)
    im.save(os.path.join(OUT, kind + '.webp'), quality=Q, method=6, alpha_quality=80)
    w, h = im.size; info = {'url': f'assets/map/dyn/{kind}.webp', 'w': w, 'h': h}   # literal url: the preview builder inlines it
    if lights: info['lights'] = [[round(x - w / 2), round(y - h)] for x, y, s in spots(a, 'light', lights)]
    if fires: info['fires'] = [[round(x - w / 2), round(y - h), round(min(1.4, .45 + (s ** .5) / 30), 2)] for x, y, s in spots(a, 'fire', fires)]
    if flat: info['flat'] = 1
    pieces[kind] = info
    print(f'{kind:13s} {w}x{h}  lights {len(info.get("lights", []))}  fires {len(info.get("fires", []))}')

def load(name): return blue_key(np.array(Image.open(os.path.join(ART, name)).convert('RGB')))

# big buildings: one per image (game px widths; a survivor is ~54px tall)
BIG = {'shop': (400, 6, 0), 'shopBurnt': (400, 3, 3), 'apartment': (380, 0, 4), 'ruin': (360, 0, 3), 'gate': (640, 4, 0),
       'wall': (520, 2, 0), 'pavilion': (300, 3, 0), 'pagoda': (330, 6, 0), 'fountain': (360, 4, 0)}
for k, (w, nl, nf) in BIG.items(): save('d' + k[0].upper() + k[1:], load('big-' + k + '.png'), w, nl, nf)
# the buildings sheet: rows 3-4 (the rest have big versions)
b = grid_cells(load('buildings.png'), 4)
for (r, c), (k, w, nl) in {(2, 1): ('dMarket', 210, 2), (2, 2): ('dSandbags', 200, 0), (2, 3): ('dLion', 100, 0),
                           (3, 0): ('dTruck', 240, 0), (3, 1): ('dTaxi', 170, 0), (3, 2): ('dBurntCar', 170, 0), (3, 3): ('dBus', 270, 0)}.items():
    save(k, b[r][c], w, nl)
p = grid_cells(load('props.png'), 4)
PROPS = [[('dCherry', 170, 0), ('dBamboo', 110, 0), ('dDeadTree', 150, 0), ('dBonsai', 90, 0)],
         [('dLamp', 90, 1), ('dLanterns', 190, 4), ('dBanner', 90, 0), ('dStoneLamp', 64, 1)],
         [('dCrates', 110, 0), ('dBarrels', 100, 0), ('dRubble', 120, 0), ('dCart', 130, 0)],
         [('dBlood', 90, 0), ('dManhole', 70, 0), ('dPuddle', 120, 0), ('dPetals', 110, 0)]]
for r, row in enumerate(PROPS):
    for c, (k, w, nl) in enumerate(row): save(k, p[r][c], w, nl, flat=(r == 3))

# ground tiles: 4 in a row -> seamless 256px
t = np.array(Image.open(os.path.join(ART, 'tiles.png')).convert('RGB'))
H, W = t.shape[:2]; pw = W / 4
def seamless(a):   # blend with a half-offset copy (edges come from the copy, which wraps)
    a = a.astype(float); h, w = a.shape[:2]; s = np.roll(np.roll(a, h // 2, 0), w // 2, 1)
    yy, xx = np.mgrid[0:h, 0:w]; d = np.minimum.reduce([xx, yy, w - 1 - xx, h - 1 - yy]) / (min(h, w) * .25)
    k = np.clip(d, 0, 1)[..., None]; return (a * k + s * (1 - k)).astype(np.uint8)
for i, name in enumerate(['asphalt', 'plaza', 'cobble', 'grass']):
    sq = t[6:H - 6, round(i * pw) + 6:round((i + 1) * pw) - 6]; n = min(sq.shape[:2]); sq = sq[:n, :n]
    im = Image.fromarray(seamless(sq)).resize((256, 256), Image.LANCZOS)
    im.save(os.path.join(OUT, f'tile-{name}.webp'), quality=82, method=6)
json.dump(pieces, open(os.path.join(OUT, 'dyn.json'), 'w'), separators=(',', ':'))
JS = os.path.join(here, '..', 'client', 'dynastyArt.js')   # the client imports this (sizes, lights, fires)
open(JS, 'w').write('// GENERATED by tools/extract-dynasty.py: Fallen Dynasty piece sizes + lights / fires (offsets from the bottom centre)\n'
                    'export const DYN_ART = ' + json.dumps(pieces, separators=(',', ':')) + ';\n'
                    'export const DYN_TILES = ' + json.dumps({t: f'assets/map/dyn/tile-{t}.webp' for t in ['asphalt', 'plaza', 'cobble', 'grass']}, separators=(',', ':')) + ';\n')
tot = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print('->', os.path.relpath(OUT), len(os.listdir(OUT)), 'files', tot // 1024, 'KB')
