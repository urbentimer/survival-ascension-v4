# MIDNIGHT CARNIVAL (grid map, Nov 10) pieces from the user's ChatGPT art in tools/art/carnival (all on solid GREEN #00FF00: a carnival is full of pink / purple):
#   big-<name>.png  haunted (boss doorway), ferris, carousel, bigtop, funhouse, bumper, gate (wide), swing, station (coaster station, no track)
#   stalls.png 4x4, props.png 4x4, marks.png 4x4 (flat), tiles.png (4 squares), cart.png (the coaster cart: 5 views D, DR, R, UR, U)
#   python3 tools/extract-carnival.py  ->  client/assets/map/cv/<kind>.webp, tile-<name>.webp, cvCart.webp, client/carnivalArt.js
import os, json
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'carnival')
OUT = os.path.join(here, '..', 'client', 'assets', 'map', 'cv'); os.makedirs(OUT, exist_ok=True)
Q = 78
def key(a):
    a = a.astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    keep = ~((g > 140) & (g - np.maximum(r, b) > 70)); keep = ndimage.binary_opening(keep, iterations=1)
    lab, n = ndimage.label(keep); sizes = ndimage.sum(keep, lab, range(1, n + 1)); keep = np.isin(lab, [i + 1 for i in range(n) if sizes[i] > 60])
    spill = keep & (g > r + 12) & (g > b + 12) & ndimage.binary_dilation(~keep, iterations=3); a[..., 1] = np.where(spill, np.maximum(r, b) + 4, g)
    return np.dstack([np.clip(a, 0, 255).astype(np.uint8), (keep * 255).astype(np.uint8)])
def crop(c): ys, xs = np.where(c[..., 3] > 0); return c[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
def grid_cells(rgba, n):
    H, W = rgba.shape[:2]; lab, _ = ndimage.label(ndimage.binary_dilation(rgba[..., 3] > 0, iterations=3)); lab = np.where(rgba[..., 3] > 0, lab, 0); objs = ndimage.find_objects(lab); ph, pw = H / n, W / n
    cells = [[[] for _ in range(n)] for _ in range(n)]
    for i, sl in enumerate(objs):
        if sl is None: continue
        cells[min(n - 1, int((sl[0].start + sl[0].stop) / 2 // ph))][min(n - 1, int((sl[1].start + sl[1].stop) / 2 // pw))].append(i + 1)
    return [[crop(np.where(np.isin(lab, ids)[..., None], rgba, 0).astype(np.uint8)) if ids else None for ids in row] for row in cells]
def bulbs(a, maxn, apart):   # lit bulbs / lamps (warm yellow-white), spread out
    r, g, b, al = [a[..., i].astype(int) for i in range(4)]; m = (al > 0) & (r > 245) & (g > 205) & (b > 90) & (b < 215)
    m = ndimage.binary_dilation(m, iterations=2); lab, n = ndimage.label(m)
    if not n: return []
    sizes = ndimage.sum(m, lab, range(1, n + 1)); cents = ndimage.center_of_mass(m, lab, range(1, n + 1)); out = []
    for i in np.argsort(-sizes):
        cy, cx = cents[i]
        if sizes[i] < 12 or any(abs(cx - x) < apart and abs(cy - y) < apart for x, y in out): continue
        out.append((cx, cy))
        if len(out) >= maxn: break
    return out
pieces = {}
def save(kind, c, width, lights=0, flat=False):
    c = crop(c)
    if flat: q = c.astype(int); gr = (q[..., 1] > q[..., 0] + 14) & (q[..., 1] > q[..., 2] + 14); q[..., 1] = np.where(gr, np.maximum(q[..., 0], q[..., 2]) + 4, q[..., 1]); c = q.clip(0, 255).astype(np.uint8)
    sc = width / c.shape[1]; im = Image.fromarray(np.ascontiguousarray(c)).resize((round(c.shape[1] * sc), round(c.shape[0] * sc)), Image.LANCZOS)
    a = np.array(im); a[..., 3] = np.where(a[..., 3] > 90, 255, 0); im = Image.fromarray(a); im.save(os.path.join(OUT, kind + '.webp'), quality=Q, method=6, alpha_quality=82)
    w, h = im.size; info = {'url': f'assets/map/cv/{kind}.webp', 'w': w, 'h': h}
    if lights: info['lights'] = [[round(x - w / 2), round(y - h)] for x, y in bulbs(a, lights, 60 if w > 300 else 34)]
    if flat: info['flat'] = 1
    pieces[kind] = info; return a
def load(name): return key(np.array(Image.open(os.path.join(ART, name)).convert('RGB')))
BIG = {'haunted': (620, 9), 'ferris': (520, 9), 'carousel': (450, 8), 'bigtop': (520, 8), 'funhouse': (500, 8), 'bumper': (480, 8), 'gate': (760, 10), 'swing': (430, 8), 'station': (540, 7)}
for k, (w, nl) in BIG.items():
    a = save('cv' + k[0].upper() + k[1:], load('big-' + k + '.png'), w, nl)
    if k == 'haunted':
        blk = (a[..., :3].max(2) < 14) & (a[..., 3] > 0); lab, n = ndimage.label(blk); sz = ndimage.sum(blk, lab, range(1, n + 1)); ys, xs = np.where(lab == 1 + int(np.argmax(sz)))
        pieces['cvHaunted']['door'] = [round((xs.min() + xs.max()) / 2 - a.shape[1] / 2), int(ys.min() - a.shape[0]), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]; print('door', pieces['cvHaunted']['door'])
S = [[('cvPopcorn', 190), ('cvCandy', 190), ('cvHotdog', 190), ('cvDrinks', 190)], [('cvRingToss', 195), ('cvBalloons', 195), ('cvDarts', 190), ('cvPrize', 190)],
     [('cvFoodTrailer', 205), ('cvIceCream', 200), ('cvClaw', 185), ('cvWagon', 195)], [('cvNewsVan', 200), ('cvAmbulance', 200), ('cvLightTower', 150), ('cvTicket', 140)]]
g = grid_cells(load('stalls.png'), 4)
for r, row in enumerate(S):
    for c, (k, w) in enumerate(row): save(k, g[r][c], w, 3)
P = [[('cvBalloonBox', 110), ('cvSignpost', 120), ('cvLamp', 110), ('cvBanner', 125)], [('cvBench', 140), ('cvBin', 90), ('cvCrates', 130), ('cvHay', 140)],
     [('cvBarrier', 140), ('cvArrow', 120), ('cvBear', 110), ('cvJack', 100)], [('cvFireworks', 105), ('cvBarrel', 90), ('cvPoster', 110), None]]
g = grid_cells(load('props.png'), 4)
for r, row in enumerate(P):
    for c, it in enumerate(row):
        if it: save(it[0], g[r][c], it[1], 2)
pieces['cvBarrel']['fires'] = [[0, -62, .55, 0]]   # the burning barrel: the user's small fire loop over the painted flames
M = {(0, 0): ('cvCrackM', 150), (0, 1): ('cvPuddle', 160), (0, 2): ('cvBloodM', 140), (0, 3): ('cvStar', 190), (1, 0): ('cvTickets', 130), (1, 1): ('cvPopSpill', 120), (1, 2): ('cvConfetti', 140), (1, 3): ('cvPrints', 100),
     (2, 1): ('cvPlanks', 140), (2, 2): ('cvBunting', 140), (3, 0): ('cvOil', 150), (3, 1): ('cvLeaves', 130), (3, 2): ('cvRope', 130), (3, 3): ('cvPaint', 120)}
g = grid_cells(load('marks.png'), 4)
for (r, c), (k, w) in M.items(): save(k, g[r][c], w, flat=True)
# the coaster cart: 5 views (D, DR, R, UR, U) in one row of equal cells, each bottom-centred
cart = load('cart.png'); cols = np.where((cart[..., 3] > 0).any(0))[0]; runs = []; s0 = cols[0]
for i in range(1, len(cols)):
    if cols[i] - cols[i - 1] > 12: runs.append((s0, cols[i - 1])); s0 = cols[i]
runs.append((s0, cols[-1])); assert len(runs) == 5, runs
views = [crop(cart[:, a:b + 1]) for a, b in runs]; sc = 92 / views[0].shape[1]; CW = round(max(v.shape[1] for v in views) * sc) + 4; CH = round(max(v.shape[0] for v in views) * sc) + 2; strip = Image.new('RGBA', (CW * 5, CH))
for i, v in enumerate(views):
    im = Image.fromarray(np.ascontiguousarray(v)).resize((round(v.shape[1] * sc), round(v.shape[0] * sc)), Image.LANCZOS); q = np.array(im); q[..., 3] = np.where(q[..., 3] > 90, 255, 0); im = Image.fromarray(q); strip.paste(im, (i * CW + (CW - im.width) // 2, CH - im.height))
strip.save(os.path.join(OUT, 'cvCart.webp'), quality=82, method=6, alpha_quality=85); print('cart cell', CW, CH)
# ground tiles: the inside of each painted square, flattened and made to wrap
t = np.array(Image.open(os.path.join(ART, 'tiles.png')).convert('RGB')).astype(float); m = key(t)[..., 3] > 0; cols = np.where(m.sum(0) > m.shape[0] * .3)[0]; runs = []; s0 = cols[0]
for i in range(1, len(cols)):
    if cols[i] - cols[i - 1] > 8: runs.append((s0, cols[i - 1])); s0 = cols[i]
runs.append((s0, cols[-1])); assert len(runs) == 4, runs; rows = np.where(m.sum(1) > m.shape[1] * .3)[0]; y0, y1 = rows.min(), rows.max()
def wrap(a, flat=.18):
    h, w = a.shape[:2]; a = np.clip(a - ndimage.gaussian_filter(a, (h * flat, w * flat, 0), mode='wrap') + a.mean((0, 1)), 0, 255)
    for ax, n in ((1, w), (0, h)):
        k = np.clip((np.abs(np.arange(n) - n / 2) / (n / 2) - .35) / .5, 0, 1); k = k * k * (3 - 2 * k); k = k[None, :, None] if ax == 1 else k[:, None, None]; a = a * (1 - k) + np.roll(a, n // 2, ax) * k
    return a
TILES = ['grass', 'dirt', 'paving', 'wood']
for name, (a, b) in zip(TILES, runs):
    w = b - a; h = y1 - y0; sq = t[y0 + round(h * .1):y0 + round(h * .9), a + round(w * .1):a + round(w * .9)]
    if name == 'grass': sq = sq * [.8, .74, .72]   # trampled, night: far less bright green
    Image.fromarray(wrap(sq).clip(0, 255).astype(np.uint8)).resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, f'tile-{name}.webp'), quality=84, method=6)
open(os.path.join(here, '..', 'client', 'carnivalArt.js'), 'w').write('// GENERATED by tools/extract-carnival.py: Midnight Carnival piece sizes + lights / fires / the haunted house doorway, and the coaster cart strip\n'
    'export const CV_ART = ' + json.dumps(pieces, separators=(',', ':')) + ';\nexport const CV_TILES = ' + json.dumps({t: f'assets/map/cv/tile-{t}.webp' for t in TILES}, separators=(',', ':')) + ';\n'
    f'export const CV_CART = {{"url":"assets/map/cv/cvCart.webp","w":{CW},"h":{CH}}};\n')
print('SIZES', json.dumps({k: [v['w'], v['h']] for k, v in pieces.items()}, separators=(',', ':')))
print('FLATS', json.dumps([k for k, v in pieces.items() if v.get('flat')]))
print('->', len(os.listdir(OUT)), 'files', sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)) // 1024, 'KB')
