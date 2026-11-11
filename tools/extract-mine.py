# THE DEEP MINE (grid map, Nov 11) pieces from the user's ChatGPT art in tools/art/mine (all on solid magenta #FF00FF, except the two GIFs):
#   shaft / lift / station / crusher / shack / crystal-big / collapsed / wrecks / portal / arch .png   one big piece per image
#   seals.png      the four seal crystals in a row (each in its own stone frame)
#   rocks.png      4x4 cave rock walls          props.png   4x4 mining props        machines.png  4x4 machines + vehicles
#   dungeon.png    4x4 boss dungeon pieces       marks.png   4x4 FLAT ground marks   tiles.png     4 ground textures in a row
#   cart.png       the mine cart, 5 views (D, DR, R, UR, U)
#   portal.gif     the portal swirl (8 frames, loops, black)       crystal.gif   a crystal shattering (12 frames, plays once, black)
#   python3 tools/extract-mine.py
# Writes client/assets/map/mn/<kind>.webp (bottom-centre = where it stands), tile-<name>.webp, the cart strip, the two effect strips,
# and client/mineArt.js (sizes, warm lights, blue crystal glows, fires, the portal's doorway).
import os, json
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'mine')
OUT = os.path.join(here, '..', 'client', 'assets', 'map', 'mn'); os.makedirs(OUT, exist_ok=True)
Q = 80

def key(a):   # only the flat magenta goes (r, b high, g low and r ~ b): the pinkish roof sheets on the station stay
    a = a.astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    keep = ~((r > 175) & (b > 175) & (g < 90) & (np.abs(r - b) < 50))
    keep = ndimage.binary_opening(keep, iterations=1)
    lab, n = ndimage.label(keep); sizes = ndimage.sum(keep, lab, range(1, n + 1)); keep = np.isin(lab, [i + 1 for i in range(n) if sizes[i] > 60])
    edge = keep & ndimage.binary_dilation(~keep, iterations=2); pink = edge & (r > g + 30) & (b > g + 30) & (np.abs(r - b) < 70)
    a[..., 0] = np.where(pink, g + 8, r); a[..., 2] = np.where(pink, g + 8, b)
    return np.dstack([np.clip(a, 0, 255).astype(np.uint8), (keep * 255).astype(np.uint8)])
def crop(c): ys, xs = np.where(c[..., 3] > 0); return c[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
def cells(rgba, rows, cols):   # every blob goes to the cell its centre is in
    H, W = rgba.shape[:2]
    lab, _ = ndimage.label(ndimage.binary_dilation(rgba[..., 3] > 0, iterations=4)); lab = np.where(rgba[..., 3] > 0, lab, 0); objs = ndimage.find_objects(lab); ph, pw = H / rows, W / cols
    out = [[[] for _ in range(cols)] for _ in range(rows)]
    for i, sl in enumerate(objs):
        if sl is None or (sl[0].stop - sl[0].start) * (sl[1].stop - sl[1].start) < 300: continue
        out[min(rows - 1, int((sl[0].start + sl[0].stop) / 2 // ph))][min(cols - 1, int((sl[1].start + sl[1].stop) / 2 // pw))].append(i + 1)
    return [[crop(np.where(np.isin(lab, ids)[..., None], rgba, 0).astype(np.uint8)) if ids else None for ids in row] for row in out]
def spots(a, kind, maxn, minsz=20):
    r, g, b, al = [a[..., i].astype(int) for i in range(4)]
    m = (al > 0) & ((r > 245) & (g > 205) & (r - b > 60) & (g - b > 20) if kind == 'light' else (r > 240) & (g > 215) & (b > 120) & (b < 235) if kind == 'loose' else (b > 235) & (g > 205) & (r < 200))   # lit lanterns (pale yellow-white) / glowing crystals (bright ice blue)
    m = ndimage.binary_opening(m, iterations=1); m = ndimage.binary_dilation(m, iterations=3); lab, n = ndimage.label(m)
    if not n: return []
    sizes = ndimage.sum(m, lab, range(1, n + 1)); cents = ndimage.center_of_mass(m, lab, range(1, n + 1)); out = []
    for i in np.argsort(-sizes):
        if sizes[i] < minsz: break
        cy, cx = cents[i]
        if any(abs(cx - x) < 30 and abs(cy - y) < 30 for x, y, _ in out): continue
        out.append((cx, cy, float(sizes[i])))
        if len(out) >= maxn: break
    return out
pieces = {}
def save(kind, c, width=None, scale=None, lights=0, blue=0, flat=False, loose=False):
    c = crop(c); sc = scale if scale else width / c.shape[1]
    if flat:   # marks blended with the magenta: pull every pinkish pixel back to neutral
        q = c.astype(int); pk = (q[..., 0] - q[..., 1] > 30) & (q[..., 2] - q[..., 1] > 20) & (np.abs(q[..., 0] - q[..., 2]) < 80); q[..., 0] = np.where(pk, q[..., 1] + 6, q[..., 0]); q[..., 2] = np.where(pk, q[..., 1], q[..., 2]); c = q.clip(0, 255).astype(np.uint8)
    im = Image.fromarray(np.ascontiguousarray(c)).resize((max(1, round(c.shape[1] * sc)), max(1, round(c.shape[0] * sc))), Image.LANCZOS)
    a = np.array(im); a[..., 3] = np.where(a[..., 3] > 90, 255, 0)
    if flat and kind not in ('mPlanks', 'mRopeM'):   # ground marks fade out over their last 16px (no hard outline): they melt into the floor (user, Nov 11: "make the surfaces blend")
        dist = ndimage.distance_transform_edt(np.pad(a[..., 3] > 0, 1))[1:-1, 1:-1]; k = np.clip(dist / 16, 0, 1); a[..., 3] = (k * k * (3 - 2 * k) * 255).astype(np.uint8)
    im = Image.fromarray(a); im.save(os.path.join(OUT, kind + '.webp'), quality=Q, method=6, alpha_quality=82)
    w, h = im.size; info = {'url': f'assets/map/mn/{kind}.webp', 'w': w, 'h': h}
    if lights: L = spots(a, 'loose' if loose else 'light', lights); info['lights'] = [[round(x - w / 2), round(y - h)] for x, y, s in L]
    if blue: B = spots(a, 'blue', blue, 30); info['blue'] = [[round(x - w / 2), round(y - h), round(min(2.2, .6 + s / 900), 2)] for x, y, s in B]
    if flat: info['flat'] = 1
    pieces[kind] = info; print(f'{kind:14s} {w}x{h}  lights {len(info.get("lights", []))} blue {len(info.get("blue", []))}'); return a
def load(name, halo=False):
    a = key(np.array(Image.open(os.path.join(ART, name)).convert('RGB')))
    if halo:   # lantern glows blended into the magenta (pink halos): neutralise pinkish pixels further in from the edge
        q = a.astype(int); near = (q[..., 3] > 0) & ndimage.binary_dilation(q[..., 3] == 0, iterations=7); pk = near & (q[..., 0] > q[..., 1] + 35) & (q[..., 2] > q[..., 1] + 35) & (np.abs(q[..., 0] - q[..., 2]) < 90)
        q[..., 2] = np.where(pk, q[..., 1] * .6, q[..., 2]); q[..., 0] = np.where(pk, np.maximum(q[..., 0], q[..., 1] + 40), q[..., 0]); a = q.clip(0, 255).astype(np.uint8)
    return a

# big pieces: (file, kind, width in game px, max lanterns, max crystal glows)
BIG = [('shaft', 'mShaft', 520, 4, 6), ('lift', 'mLift', 470, 8, 4), ('station', 'mStation', 600, 8, 3), ('crusher', 'mCrusher', 450, 4, 6), ('shack', 'mShack', 400, 6, 3),
       ('crystal-big', 'mCrystal', 380, 2, 8), ('collapsed', 'mCollapsed', 420, 3, 4), ('wrecks', 'mWrecks', 400, 3, 5), ('arch', 'mArch', 420, 2, 4)]
def unpink(a):   # the station's art has magenta-ish roof sheets and pink halos round its lanterns (the background bleeding in): turn them rust-brown
    q = a.astype(float); r, g, b = q[..., 0], q[..., 1], q[..., 2]; pk = (r > g + 45) & (b > g + 22) & (b > 80); lum = .35 * r + .4 * g + .25 * b
    q[..., 0] = np.where(pk, np.clip(lum * 1.45, 0, 255), r); q[..., 1] = np.where(pk, lum * .72, g); q[..., 2] = np.where(pk, lum * .5, b); return q.astype(np.uint8)
for f, k, w, nl, nb in BIG: save(k, unpink(load(f + '.png')) if k == 'mStation' else load(f + '.png'), w, lights=nl, blue=nb, loose=k in ('mStation', 'mShack', 'mShaft', 'mCollapsed'))
save('mStatue', load('statue.png'), 600, blue=0)   # the Mine Beast asleep in stone (the 4 runes on its plinth light up in code)
pieces['mStatue']['runes'] = [[-132, -92], [-43, -92], [46, -92], [133, -91]]   # the plinth's four rune carvings (one lights up per rune put in)
a = save('mPortal', load('portal.png'), 560, blue=6)
blk = (a[..., :3].max(2) < 16) & (a[..., 3] > 0); lab, n = ndimage.label(blk); sz = ndimage.sum(blk, lab, range(1, n + 1)); ys, xs = np.where(lab == 1 + int(np.argmax(sz)))
pieces['mPortal']['door'] = [round((xs.min() + xs.max()) / 2 - a.shape[1] / 2), int(ys.min() - a.shape[0]), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]   # centre x, top y (from the bottom centre), width, height
print('portal door', pieces['mPortal']['door'])
a = pieces['mShaft']; sh = np.array(Image.open(os.path.join(OUT, 'mShaft.webp')).convert('RGBA'))
blk = (sh[..., :3].max(2) < 22) & (sh[..., 3] > 0); lab, n = ndimage.label(blk); sz = ndimage.sum(blk, lab, range(1, n + 1)); ys, xs = np.where(lab == 1 + int(np.argmax(sz)))
pieces['mShaft']['door'] = [round((xs.min() + xs.max()) / 2 - sh.shape[1] / 2), int(ys.min() - sh.shape[0]), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]
print('shaft door', pieces['mShaft']['door'])
# the four seal crystals: one row, split where the columns go empty
s = load('seals.png'); cols = np.where((s[..., 3] > 0).any(0))[0]; runs = []; s0 = cols[0]
for i in range(1, len(cols)):
    if cols[i] - cols[i - 1] > 12: runs.append((s0, cols[i - 1])); s0 = cols[i]
runs.append((s0, cols[-1])); assert len(runs) == 4, runs
sc = 150 / max(b - a + 1 for a, b in runs)
for i, (x0, x1) in enumerate(runs): save(f'mSeal{i + 1}', s[:, x0:x1 + 1], scale=sc, blue=3)
# sheets (one scale per sheet, so the pieces keep their sizes relative to each other)
# the four rune stones (the plinth's symbols) + the rune shrine, one row of five
s = load('runes.png'); cols = np.where((s[..., 3] > 0).sum(0) > 2)[0]; runs = []; s0 = cols[0]
for i in range(1, len(cols)):
    if cols[i] - cols[i - 1] > 12: runs.append((s0, cols[i - 1])); s0 = cols[i]
runs.append((s0, cols[-1])); runs = [q for q in runs if q[1] - q[0] > 60]; assert len(runs) == 5, runs
for i, (x0, x1) in enumerate(runs[:4]): save(f'mRune{i + 1}', s[:, x0:x1 + 1], 74)
save('mShrine', s[:, runs[4][0]:runs[4][1] + 1], 190, lights=4)
R = cells(load('rocks.png'), 4, 4)
for r in range(4):
    for c in range(4): save(f'mRock{r * 4 + c + 1}', R[r][c], scale=.74, lights=2, blue=3)
P = cells(load('props.png', True), 4, 4)
PROPS = [['mLanternPost', 'mLanternPost2', 'mSkullSign', 'mSignpost'], ['mCrystalCrate', 'mOreCart', 'mBarrel', 'mTnt'], ['mToolRack', 'mWinch', 'mRopeCoil', 'mTimber'], ['mOrePile', 'mCrystalSmall', 'mFloodlight', 'mBanner']]
for r in range(4):
    for c in range(4): save(PROPS[r][c], P[r][c], scale=.5, lights=3, blue=3)
M = cells(load('machines.png', True), 4, 4)
MACH = [['mDrill', 'mExcavator', 'mCrystalCart', 'mLoco'], ['mConveyor', 'mGenerator', 'mFan', 'mPump'], ['mScaffold', 'mWinchFrame', 'mFurnace', 'mCrane'], ['mTrommel', 'mSilos', 'mFuelTank', 'mCrawler']]
for r in range(4):
    for c in range(4): save(MACH[r][c], M[r][c], scale=.74, lights=4, blue=3)
D = cells(load('dungeon.png'), 4, 4)
DUN = [['mPillar', 'mPillarBroken', 'mBrazier', 'mCandles'], ['mGate', 'mChains', 'mCage', 'mAltar'], ['mMiner', 'mMinerBroken', 'mTotem', 'mCoffin'], ['mBones', 'mRuneStone', 'mOffering', 'mClawWall']]
for r in range(4):
    for c in range(4): save(DUN[r][c], D[r][c], scale=.62, lights=3, blue=4)
K = cells(load('marks.png'), 4, 4)
MARKS = {(0, 0): 'mStones', (0, 2): 'mPuddles', (0, 3): 'mDirt', (1, 0): 'mShards', (1, 1): 'mGoldVein', (1, 2): 'mBlueCrack', (1, 3): 'mStain',
         (2, 0): 'mPlanks', (2, 1): 'mRopeM', (2, 2): 'mRocksM', (2, 3): 'mCrystalRocks', (3, 0): 'mHatch', (3, 1): 'mChevron', (3, 2): 'mGrate', (3, 3): 'mStripes'}
for (r, c), k in MARKS.items(): save(k, K[r][c], scale=.56, flat=True)
# hand-placed: the furnace's fire mouth; candle flames (warm), the brazier's coals (blue)
pieces['mFurnace']['fires'] = [[0, -38, .55, 0]]
pieces['mBrazier']['blue'] = [[0, -86, 1.6]]
for k in ('mSkullSign', 'mSignpost', 'mRopeCoil', 'mOrePile', 'mTrommel'): pieces[k].pop('lights', None)   # (bright paint / gold / rope, not lamps)

# the mine cart: 5 views (D, DR, R, UR, U) in one row of equal cells, each bottom-centred
cart = load('cart.png'); cols = np.where((cart[..., 3] > 0).any(0))[0]; runs = []; s0 = cols[0]
for i in range(1, len(cols)):
    if cols[i] - cols[i - 1] > 12: runs.append((s0, cols[i - 1])); s0 = cols[i]
runs.append((s0, cols[-1])); assert len(runs) == 5, runs
views = [crop(cart[:, a:b + 1]) for a, b in runs]; sc = 112 / views[2].shape[1]; CW = round(max(v.shape[1] for v in views) * sc) + 4; CH = round(max(v.shape[0] for v in views) * sc) + 2; strip = Image.new('RGBA', (CW * 5, CH))
for i, v in enumerate(views):
    im = Image.fromarray(np.ascontiguousarray(v)).resize((round(v.shape[1] * sc), round(v.shape[0] * sc)), Image.LANCZOS); q = np.array(im); q[..., 3] = np.where(q[..., 3] > 90, 255, 0); im = Image.fromarray(q); strip.paste(im, (i * CW + (CW - im.width) // 2, CH - im.height))
strip.save(os.path.join(OUT, 'mnCart.webp'), quality=84, method=6, alpha_quality=85); print('cart cell', CW, CH)

# the two GIF effects: frames side by side (black background: drawn with "lighter", so the black adds nothing)
def gif_strip(name, out, size):
    im = Image.open(os.path.join(ART, name)); n = im.n_frames; st = Image.new('RGB', (size * n, size))
    for i in range(n):
        im.seek(i); f = im.convert('RGB'); s0 = min(f.size); f = f.crop(((f.size[0] - s0) // 2, (f.size[1] - s0) // 2, (f.size[0] + s0) // 2, (f.size[1] + s0) // 2)).resize((size, size), Image.LANCZOS)
        a = np.array(f).astype(int); a = np.where(a.max(2, keepdims=True) < 10, 0, a); st.paste(Image.fromarray(a.astype(np.uint8)), (i * size, 0))
    st.save(os.path.join(OUT, out), quality=86, method=6); print(out, n, 'frames'); return n
NP = gif_strip('portal.gif', 'mnPortalFx.webp', 300); NS = gif_strip('crystal.gif', 'mnShatterFx.webp', 240)

# ground tiles: four squares in a row (black frames, magenta round them). An inner crop of each, made to wrap.
t = np.array(Image.open(os.path.join(ART, 'tiles.png')).convert('RGB')).astype(float); r_, g_, b_ = t[..., 0], t[..., 1], t[..., 2]
body = ~((r_ > 175) & (b_ > 175) & (g_ < 90)); rows = np.where(body.mean(1) > .5)[0]; y0, y1 = rows.min(), rows.max()
dark = t[y0:y1, :, :].max(2).mean(0) < 40; xs = np.where(body[(y0 + y1) // 2] & ~dark)[0]; runs = []; s0 = xs[0]
for i in range(1, len(xs)):
    if xs[i] - xs[i - 1] > 3: runs.append((s0, xs[i - 1])); s0 = xs[i]
runs.append((s0, xs[-1])); runs = [q for q in runs if q[1] - q[0] > 200]; assert len(runs) == 4, runs
def wrap(a, flatten=True):   # flatten the big light / dark areas, then blend each axis with a copy shifted half a tile
    h, w = a.shape[:2]
    if flatten: a = np.clip(a - ndimage.gaussian_filter(a, (h * .18, w * .18, 0), mode='wrap') + a.mean((0, 1)), 0, 255)
    for ax, n in ((1, w), (0, h)):
        k = np.clip((np.abs(np.arange(n) - n / 2) / (n / 2) - .35) / .5, 0, 1); k = k * k * (3 - 2 * k); k = k[None, :, None] if ax == 1 else k[:, None, None]; a = a * (1 - k) + np.roll(a, n // 2, ax) * k
    return a
TILES = ['stone', 'gravel', 'mud', 'planks']
for name, (x0, x1) in zip(TILES, runs):
    inset = 14; c = t[y0 + inset:y1 - inset, x0 + inset:x1 - inset]
    if name == 'planks':   # planks: rows repeat top to bottom; cut on whole rows so it tiles with no blend
        g = c.mean((1, 2)); g = g - g.mean(); ac = np.correlate(g, g, 'full')[len(g) - 1:]; per = 40 + int(np.argmax(ac[40:len(g) // 2]))
        c = wrap(c[:per * (len(c) // per)], flatten=False)
    else: c = wrap(c)
    im = Image.fromarray(c.clip(0, 255).astype(np.uint8)).resize((256, round(256 * c.shape[0] / c.shape[1])), Image.LANCZOS); im.save(os.path.join(OUT, f'tile-{name}.webp'), quality=84, method=6)
open(os.path.join(here, '..', 'client', 'mineArt.js'), 'w').write('// GENERATED by tools/extract-mine.py: Deep Mine piece sizes + lights / crystal glows / fires / the portal doorway (offsets from the bottom centre),\n'
    '// the cart strip and the two effect strips (portal swirl, crystal shatter)\n'
    'export const MN_ART = ' + json.dumps(pieces, separators=(',', ':')) + ';\nexport const MN_TILES = ' + json.dumps({t: f'assets/map/mn/tile-{t}.webp' for t in TILES}, separators=(',', ':')) + ';\n'
    f'export const MN_CART = {{"url":"assets/map/mn/mnCart.webp","w":{CW},"h":{CH}}};\n'
    f'export const MN_FX = {{"portal":{{"url":"assets/map/mn/mnPortalFx.webp","n":{NP},"s":300,"ms":110}},"shatter":{{"url":"assets/map/mn/mnShatterFx.webp","n":{NS},"s":240,"ms":90}}}};\n')
print('->', len(os.listdir(OUT)), 'files', sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)) // 1024, 'KB')
