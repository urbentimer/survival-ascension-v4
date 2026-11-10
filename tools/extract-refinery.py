# SCORCHED REFINERY (grid map, Nov 10) pieces from the user's ChatGPT art in tools/art/refinery (all on solid magenta #FF00FF):
#   big-<name>.png   one big structure per image (towers, tank, tankBurnt, control, pumpjack, tanker, pipeRack, loading, pyramid)
#   buildings.png    4x4 sheet with black grid lines. Rows 1-2 repeat the big pieces small (only the derrick is used: the flare stack);
#                    row 3: horizontal tank, generator, cooling fans, gas sphere; row 4: tanker truck, bulldozer, pickup, containers
#   props.png        4x4: barrels, crates, IBC tank, pipe bend / transformer, light tower, barriers, pipe stack / valve, fence, sign,
#                    stairs / cable spool, concrete blocks, sandbags, rubble
#   marks.png        4x4 FLAT ground marks (walked over). The soft ones blended with the magenta (purple fringes) are skipped.
#   tiles.png        4 ground textures in a row: sand, cracked earth, concrete slabs, asphalt (clean parts cropped and made seamless)
#   python3 tools/extract-refinery.py
# Writes client/assets/map/rf/<kind>.webp (bottom-centre = where it stands), tile-<name>.webp and client/refineryArt.js
# (sizes, lights, hand-placed fires [x, y, size, loop], the pyramid's doorway).
import os, json
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'refinery')
OUT = os.path.join(here, '..', 'client', 'assets', 'map', 'rf'); os.makedirs(OUT, exist_ok=True)
Q = 80

def key(a):
    a = a.astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    keep = ~((r - g > 40) & (b - g > 40) & (np.abs(r - b) < 90))
    keep = ndimage.binary_opening(keep, iterations=1)
    lab, n = ndimage.label(keep); sizes = ndimage.sum(keep, lab, range(1, n + 1)); keep = np.isin(lab, [i + 1 for i in range(n) if sizes[i] > 60])
    edge = keep & ndimage.binary_dilation(~keep, iterations=2); pink = edge & (r > g + 14) & (b > g + 14)
    a[..., 0] = np.where(pink, g + 8, r); a[..., 2] = np.where(pink, g + 8, b)
    return np.dstack([np.clip(a, 0, 255).astype(np.uint8), (keep * 255).astype(np.uint8)])
def crop(c): ys, xs = np.where(c[..., 3] > 0); return c[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
def grid_cells(rgba, n):
    H, W = rgba.shape[:2]; rgba = rgba.copy()
    for i in range(n + 1):
        y = round(i * H / n); x = round(i * W / n); rgba[max(0, y - 7):y + 7, :, 3] = 0; rgba[:, max(0, x - 7):x + 7, 3] = 0
    lab, _ = ndimage.label(ndimage.binary_dilation(rgba[..., 3] > 0, iterations=5)); lab = np.where(rgba[..., 3] > 0, lab, 0); objs = ndimage.find_objects(lab); ph, pw = H / n, W / n
    cells = [[[] for _ in range(n)] for _ in range(n)]
    for i, sl in enumerate(objs):
        if sl is None: continue
        cells[min(n - 1, int((sl[0].start + sl[0].stop) / 2 // ph))][min(n - 1, int((sl[1].start + sl[1].stop) / 2 // pw))].append(i + 1)
    return [[crop(np.where(np.isin(lab, ids)[..., None], rgba, 0).astype(np.uint8)) if ids else None for ids in row] for row in cells]
def spots(a, kind, maxn):
    r, g, b, al = [a[..., i].astype(int) for i in range(4)]
    m = (al > 0) & ((r > 225) & (g < 90) & (b < 90) if kind == 'red' else (r > 240) & (g > 225) & (b > 150) & (b < 235))   # red beacons / lit lamps (pale yellow-white, brighter than the yellow paint)
    m = ndimage.binary_opening(m, iterations=1); m = ndimage.binary_dilation(m, iterations=3); lab, n = ndimage.label(m)
    if not n: return []
    sizes = ndimage.sum(m, lab, range(1, n + 1)); cents = ndimage.center_of_mass(m, lab, range(1, n + 1)); out = []
    for i in np.argsort(-sizes):
        if sizes[i] < 20: break
        cy, cx = cents[i]
        if any(abs(cx - x) < 26 and abs(cy - y) < 26 for x, y, _ in out): continue
        out.append((cx, cy, float(sizes[i])))
        if len(out) >= maxn: break
    return out
pieces = {}
def save(kind, c, width, lights=0, flat=False):
    c = crop(c); sc = width / c.shape[1]
    if flat:   # soft marks blended with the magenta: pull every pinkish pixel back to neutral
        q = c.astype(int); pk = (q[..., 0] - q[..., 1] > 16) & (q[..., 2] - q[..., 1] > -6) & ~((q[..., 0] > 90) & (q[..., 2] < 60)); q[..., 0] = np.where(pk, q[..., 1] + 6, q[..., 0]); q[..., 2] = np.where(pk, q[..., 1], q[..., 2]); c = q.clip(0, 255).astype(np.uint8)
    im = Image.fromarray(np.ascontiguousarray(c)).resize((round(c.shape[1] * sc), round(c.shape[0] * sc)), Image.LANCZOS)
    a = np.array(im); a[..., 3] = np.where(a[..., 3] > 90, 255, 0); im = Image.fromarray(a); im.save(os.path.join(OUT, kind + '.webp'), quality=Q, method=6, alpha_quality=82)
    w, h = im.size; info = {'url': f'assets/map/rf/{kind}.webp', 'w': w, 'h': h}
    if lights: info['lights'] = [[round(x - w / 2), round(y - h)] for x, y, s in spots(a, 'light', lights)] + [[round(x - w / 2), round(y - h), 1] for x, y, s in spots(a, 'red', 4)]
    if flat: info['flat'] = 1
    pieces[kind] = info; print(f'{kind:12s} {w}x{h}  lights {len(info.get("lights", []))}'); return a
def load(name): return key(np.array(Image.open(os.path.join(ART, name)).convert('RGB')))

BIG = {'towers': (430, 0), 'tank': (400, 6), 'tankBurnt': (400, 4), 'control': (410, 8), 'pumpjack': (390, 0), 'tanker': (520, 0), 'pipeRack': (560, 6), 'loading': (430, 8)}
for k, (w, nl) in BIG.items(): save('r' + k[0].upper() + k[1:], load('big-' + k + '.png'), w, nl)
a = save('rPyramid', load('big-pyramid.png'), 840)
blk = (a[..., :3].max(2) < 14) & (a[..., 3] > 0); lab, n = ndimage.label(blk); sz = ndimage.sum(blk, lab, range(1, n + 1)); ys, xs = np.where(lab == 1 + int(np.argmax(sz)))
pieces['rPyramid']['door'] = [round((xs.min() + xs.max()) / 2 - a.shape[1] / 2), int(ys.min() - a.shape[0]), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]   # centre x, top y (from the bottom centre), width, height
print('pyramid door', pieces['rPyramid']['door'])
b = grid_cells(load('buildings.png'), 4)
for (r, c), (k, w, nl) in {(0, 1): ('rFlare', 210, 0), (2, 0): ('rHTank', 215, 0), (2, 1): ('rGenerator', 200, 0), (2, 2): ('rCooler', 210, 0), (2, 3): ('rSphere', 200, 0),
                           (3, 0): ('rTruck', 215, 0), (3, 1): ('rDozer', 195, 0), (3, 2): ('rPickup', 185, 0), (3, 3): ('rContainers', 205, 0)}.items(): save(k, b[r][c], w, nl)
p = grid_cells(load('props.png'), 4)
PROPS = [[('rBarrels', 110, 0), ('rCrates', 135, 0), ('rIbc', 120, 0), ('rPipeBend', 130, 0)], [('rTransformer', 140, 0), ('rLight', 100, 4), ('rBarrier', 150, 0), ('rPipes', 140, 0)],
         [('rValve', 130, 0), ('rFence', 150, 0), ('rSign', 105, 0), ('rStairs', 130, 0)], [('rSpool', 110, 0), ('rBlocks', 130, 0), ('rSandbags', 130, 0), ('rRubble', 130, 0)]]
for r, row in enumerate(PROPS):
    for c, (k, w, nl) in enumerate(row): save(k, p[r][c], w, nl)
m = grid_cells(load('marks.png'), 4)
for (r, c), (k, w) in {(0, 0): ('rOil1', 150), (0, 1): ('rOil2', 150), (0, 3): ('rCrack', 140), (1, 0): ('rTracks1', 150), (1, 1): ('rTracks2', 150), (1, 2): ('rStripes', 140), (1, 3): ('rArrow', 150),
                       (2, 0): ('rHeli', 230), (2, 1): ('rHazard', 170), (2, 2): ('rFlameMark', 150), (3, 1): ('rDebris', 140), (3, 2): ('rBlood', 120)}.items(): save(k, m[r][c], w, flat=True)
# fires placed by hand: [x, y (base of the flame, from the bottom centre), size, loop 0 small / 1 medium / 2 big]
pieces['rTankBurnt']['fires'] = [[82, -268, 1.1, 2], [-84, -196, .6, 0], [70, -6, .75, 1]]
pieces['rFlare']['fires'] = [[2, -pieces['rFlare']['h'] + 12, 1.0, 1]]
pieces['rTanker']['fires'] = [[84, -70, .85, 2], [40, -200, .6, 1]]

# ground tiles (the art's four are not seamless and have stones / stains / road markings): a clean part of each, made to wrap
t = np.array(Image.open(os.path.join(ART, 'tiles.png')).convert('RGB')).astype(float); H, W = t.shape[:2]
def wrap(a):   # flatten the big light / dark areas, then blend each axis with a copy shifted half a tile
    h, w = a.shape[:2]; a = np.clip(a - ndimage.gaussian_filter(a, (h * .18, w * .18, 0), mode='wrap') + a.mean((0, 1)), 0, 255)
    for ax, n in ((1, w), (0, h)):
        k = np.clip((np.abs(np.arange(n) - n / 2) / (n / 2) - .35) / .5, 0, 1); k = k * k * (3 - 2 * k); k = k[None, :, None] if ax == 1 else k[:, None, None]; a = a * (1 - k) + np.roll(a, n // 2, ax) * k
    return a
def mirror(a): top = np.concatenate([a, a[:, ::-1]], 1); return np.concatenate([top, top[::-1]], 0)
# name: (x0, y0, x1, y1 as fractions of the whole picture), method, output size
TILES = {'sand': ((.078, .50, .198, .72), wrap, (256, 150)), 'cracked': ((.265, .16, .485, .82), wrap, (272, 272)), 'concrete': ((.535, .09, .618, .375), wrap, (230, 262)), 'asphalt': ((.789, .10, .866, .62), wrap, (150, 336))}
for name, ((x0, y0, x1, y1), how, size) in TILES.items():
    im = Image.fromarray(how(t[round(y0 * H):round(y1 * H), round(x0 * W):round(x1 * W)]).clip(0, 255).astype(np.uint8)).resize(size, Image.LANCZOS); im.save(os.path.join(OUT, f'tile-{name}.webp'), quality=84, method=6)
open(os.path.join(here, '..', 'client', 'refineryArt.js'), 'w').write('// GENERATED by tools/extract-refinery.py: Scorched Refinery piece sizes + lights / fires / the pyramid doorway (offsets from the bottom centre)\n'
    'export const RF_ART = ' + json.dumps(pieces, separators=(',', ':')) + ';\nexport const RF_TILES = ' + json.dumps({t: f'assets/map/rf/tile-{t}.webp' for t in TILES}, separators=(',', ':')) + ';\n')
print('->', len(os.listdir(OUT)), 'files', sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)) // 1024, 'KB')
