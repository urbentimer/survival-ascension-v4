# THE CRUCIBLE (lava map for the Abomination, Nov 12) pieces from the user's ChatGPT art in tools/art/crucible (all on solid magenta #FF00FF):
#   crucible / falls / furnace / crane / spire / bridge / basalt .png   one big piece per image
#   rocks.png   4x4 volcanic rock walls      props.png   4x4 foundry props      machines.png  4x4 machines + structures
#   marks.png   4x4 FLAT ground marks         tiles.png   4 ground textures      lava.png      2 lava textures (molten, crusted)
#   python3 tools/extract-crucible.py
# Writes client/assets/map/kc/<kind>.webp (bottom-centre = where it stands), tile-<name>.webp, and client/crucibleArt.js
# (sizes, warm lights: lanterns and glowing lava, the crucible's doorway).
import os, json
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'crucible')
OUT = os.path.join(here, '..', 'client', 'assets', 'map', 'kc'); os.makedirs(OUT, exist_ok=True)
Q = 80

def key(a):   # only the flat magenta goes
    a = a.astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    keep = ~((r > 175) & (b > 175) & (g < 90) & (np.abs(r - b) < 50))
    keep = ndimage.binary_opening(keep, iterations=1)
    lab, n = ndimage.label(keep); sizes = ndimage.sum(keep, lab, range(1, n + 1)); keep = np.isin(lab, [i + 1 for i in range(n) if sizes[i] > 60])
    edge = keep & ndimage.binary_dilation(~keep, iterations=3); pink = edge & (r > g + 30) & (b > g + 30) & (np.abs(r - b) < 80)   # magenta bled into the outline: back to a dark neutral
    a[..., 0] = np.where(pink, g + 8, r); a[..., 2] = np.where(pink, g + 8, b)
    return np.dstack([np.clip(a, 0, 255).astype(np.uint8), (keep * 255).astype(np.uint8)])
def unpink(a):   # glows that blended into the magenta (pink / violet halos inside a piece, e.g. round a lantern or in the cage): warm them back to rust
    q = a.astype(float); r, g, b = q[..., 0], q[..., 1], q[..., 2]; pk = (r > g + 45) & (b > g + 30) & (b > 70) & (q[..., 3] > 0); lum = .35 * r + .4 * g + .25 * b
    q[..., 0] = np.where(pk, np.clip(lum * 1.4, 0, 255), r); q[..., 1] = np.where(pk, lum * .7, g); q[..., 2] = np.where(pk, lum * .5, b); return q.astype(np.uint8)
def crop(c): ys, xs = np.where(c[..., 3] > 0); return c[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
def cells(rgba, rows, cols):   # every blob goes to the cell its centre is in
    H, W = rgba.shape[:2]
    lab, _ = ndimage.label(ndimage.binary_dilation(rgba[..., 3] > 0, iterations=4)); lab = np.where(rgba[..., 3] > 0, lab, 0); objs = ndimage.find_objects(lab); ph, pw = H / rows, W / cols
    out = [[[] for _ in range(cols)] for _ in range(rows)]
    for i, sl in enumerate(objs):
        if sl is None or (sl[0].stop - sl[0].start) * (sl[1].stop - sl[1].start) < 300: continue
        out[min(rows - 1, int((sl[0].start + sl[0].stop) / 2 // ph))][min(cols - 1, int((sl[1].start + sl[1].stop) / 2 // pw))].append(i + 1)
    return [[crop(np.where(np.isin(lab, ids)[..., None], rgba, 0).astype(np.uint8)) if ids else None for ids in row] for row in out]
def spots(a, kind, maxn, minsz=20, sep=40):
    r, g, b, al = [a[..., i].astype(int) for i in range(4)]
    m = (al > 0) & (((r > 245) & (g > 205) & (r - b > 60) & (g - b > 20)) if kind == 'light' else ((r > 235) & (g > 120) & (b < 110) & (r - b > 150)))   # lanterns (pale yellow-white) / glowing lava (bright orange-yellow)
    m = ndimage.binary_opening(m, iterations=1); m = ndimage.binary_dilation(m, iterations=3); lab, n = ndimage.label(m)
    if not n: return []
    sizes = ndimage.sum(m, lab, range(1, n + 1)); cents = ndimage.center_of_mass(m, lab, range(1, n + 1)); out = []
    for i in np.argsort(-sizes):
        if sizes[i] < minsz: break
        cy, cx = cents[i]
        if any(abs(cx - x) < sep and abs(cy - y) < sep for x, y, _ in out): continue
        out.append((cx, cy, float(sizes[i])))
        if len(out) >= maxn: break
    return out
pieces = {}
def save(kind, c, width=None, scale=None, lights=0, lava=0, flat=False, sy=1.0, fade=True):
    c = crop(c); sc = scale if scale else width / c.shape[1]
    if flat:   # marks blended with the magenta: pull every pinkish pixel back to neutral
        q = c.astype(int); pk = (q[..., 0] - q[..., 1] > 30) & (q[..., 2] - q[..., 1] > 20) & (np.abs(q[..., 0] - q[..., 2]) < 80); q[..., 0] = np.where(pk, q[..., 1] + 6, q[..., 0]); q[..., 2] = np.where(pk, q[..., 1], q[..., 2]); c = q.clip(0, 255).astype(np.uint8)
    im = Image.fromarray(np.ascontiguousarray(c)).resize((max(1, round(c.shape[1] * sc)), max(1, round(c.shape[0] * sc * sy))), Image.LANCZOS)
    a = np.array(im); a[..., 3] = np.where(a[..., 3] > 90, 255, 0)
    if flat and fade:   # ground marks fade out over their last 14px: they melt into the floor
        dist = ndimage.distance_transform_edt(np.pad(a[..., 3] > 0, 1))[1:-1, 1:-1]; k = np.clip(dist / 14, 0, 1); a[..., 3] = (k * k * (3 - 2 * k) * 255).astype(np.uint8)
    im = Image.fromarray(a); im.save(os.path.join(OUT, kind + '.webp'), quality=Q, method=6, alpha_quality=82)
    w, h = im.size; info = {'url': f'assets/map/kc/{kind}.webp', 'w': w, 'h': h}
    L = (spots(a, 'light', lights) if lights else []) + (spots(a, 'lava', lava, 30, 55) if lava else [])
    if L: info['lights'] = [[round(x - w / 2), round(y - h)] for x, y, s in L]
    if flat: info['flat'] = 1
    pieces[kind] = info; print(f'{kind:14s} {w}x{h}  lights {len(info.get("lights", []))}'); return a
def load(name): return unpink(key(np.array(Image.open(os.path.join(ART, name)).convert('RGB'))))

# big pieces: (file, kind, width in game px, max lanterns, max lava glows, vertical stretch)
BIG = [('crucible', 'kCrucible', 620, 0, 8, 1), ('falls', 'kFalls', 1000, 0, 10, 1), ('furnace', 'kFurnace', 460, 3, 5, 1), ('crane', 'kCrane', 480, 3, 4, 1),
       ('spire', 'kSpire', 330, 0, 4, 1), ('basalt', 'kBasalt', 380, 0, 5, 1), ('bridge', 'kBridge', 900, 0, 0, 1.5)]   # the bridge: stretched a bit taller, so its deck is deep enough for a boss
for f, k, w, nl, nv, sy in BIG: save(k, load(f + '.png'), w, lights=nl, lava=nv, sy=sy)
# the crucible's doorway: the burst hole in the cauldron (deep red / orange inside), the biggest such blob in its lower middle
cr = np.array(Image.open(os.path.join(OUT, 'kCrucible.webp')).convert('RGBA')).astype(int); H, W = cr.shape[:2]
r, g, b = cr[..., 0], cr[..., 1], cr[..., 2]; hole = (cr[..., 3] > 0) & (r > 90) & (g < r * .55) & (b < 70); hole[:int(H * .45)] = False; hole[:, :int(W * .3)] = False; hole[:, int(W * .7):] = False
hole = ndimage.binary_closing(hole, iterations=3); lab, n = ndimage.label(hole); sz = ndimage.sum(hole, lab, range(1, n + 1)); ys, xs = np.where(lab == 1 + int(np.argmax(sz)))
pieces['kCrucible']['door'] = [round((xs.min() + xs.max()) / 2 - W / 2), int(ys.min() - H), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]
print('crucible door', pieces['kCrucible']['door'])
# sheets (one scale per sheet, so the pieces keep their sizes relative to each other)
R = cells(load('rocks.png'), 4, 4)
for rr in range(4):
    for cc in range(4): save(f'kRock{rr * 4 + cc + 1}', R[rr][cc], scale=.78, lava=2)
P = cells(load('props.png'), 4, 4)
PROPS = [['kBrazier', 'kLanternPost', 'kFirePillar', 'kTorch'], ['kAnvil', 'kCage', 'kChainRack', 'kIngots'], ['kOreCart', 'kBarrels', 'kCrates', 'kCoal'], ['kMould', 'kBellows', 'kSkeleton', 'kSign']]
for rr in range(4):
    for cc in range(4): save(PROPS[rr][cc], P[rr][cc], scale=.52, lights=2, lava=2)
M = cells(load('machines.png'), 4, 4)
MACH = [['kSmelter', 'kGears', 'kBoiler', 'kValves'], ['kConveyor', 'kHopper', 'kWaterTank', 'kWinch'], ['kHut', 'kWatchtower', 'kGirders', 'kPipes'], ['kGate', 'kHangCage', 'kStatue', 'kSlagCart']]
for rr in range(4):
    for cc in range(4): save(MACH[rr][cc], M[rr][cc], scale=.74, lights=2, lava=2)
K = cells(load('marks.png'), 4, 4)
MARKS = [['kCrack1', 'kCrack2', 'kCrack3', 'kCrack4'], ['kAsh', 'kPumice', 'kScorch', 'kCooled'], ['kGrate', 'kStain', 'kBones', 'kEmbers'], ['kChainM', 'kSignM', 'kShards', 'kPrints']]
for rr in range(4):
    for cc in range(4): k = MARKS[rr][cc]; save(k, K[rr][cc], scale=.56, flat=True, lava=3 if rr == 0 or k in ('kCooled', 'kEmbers') else 0, fade=k not in ('kGrate', 'kChainM', 'kSignM'))
for k in ('kSign', 'kIngots', 'kOreCart', 'kSlagCart', 'kBarrels'): pieces[k].pop('lights', None) if k in ('kSign', 'kBarrels') else None   # (yellow paint, not lamps)

# ground tiles: squares in a row (black frames, magenta round them). An inner crop of each, made to wrap.
def tiles_from(name, names, flatten=True):
    t = np.array(Image.open(os.path.join(ART, name)).convert('RGB')).astype(float); r_, g_, b_ = t[..., 0], t[..., 1], t[..., 2]
    body = ~((r_ > 175) & (b_ > 175) & (g_ < 90)); rows = np.where(body.mean(1) > .5)[0]; y0, y1 = rows.min(), rows.max()
    cols = np.where(body[y0:y1].mean(0) > .5)[0]; x0a, x1a = cols.min(), cols.max(); step = (x1a - x0a + 1) / len(names)   # equal squares side by side
    runs = [(int(x0a + i * step + 6), int(x0a + (i + 1) * step - 6)) for i in range(len(names))]
    def wrap(a, fl):   # flatten the big light / dark areas, then blend each axis with a copy shifted half a tile
        h, w = a.shape[:2]
        if fl: a = np.clip(a - ndimage.gaussian_filter(a, (h * .18, w * .18, 0), mode='wrap') + a.mean((0, 1)), 0, 255)
        for ax, n in ((1, w), (0, h)):
            k = np.clip((np.abs(np.arange(n) - n / 2) / (n / 2) - .35) / .5, 0, 1); k = k * k * (3 - 2 * k); k = k[None, :, None] if ax == 1 else k[:, None, None]; a = a * (1 - k) + np.roll(a, n // 2, ax) * k
        return a
    for nm, (x0, x1) in zip(names, runs):
        inset = 18; c = t[y0 + inset:y1 - inset, x0 + inset:x1 - inset]
        if nm == 'plates':   # riveted plates: a grid; cut on whole plates so it tiles with no blend
            g = c.mean((1, 2)); g = g - g.mean(); ac = np.correlate(g, g, 'full')[len(g) - 1:]; per = 80 + int(np.argmax(ac[80:len(g) // 2]))
            gx = c.mean((0, 2)); gx = gx - gx.mean(); acx = np.correlate(gx, gx, 'full')[len(gx) - 1:]; perx = 80 + int(np.argmax(acx[80:len(gx) // 2]))
            c = c[:per * max(1, len(c) // per), :perx * max(1, c.shape[1] // perx)]
        else: c = wrap(c, flatten and nm != 'molten')
        im = Image.fromarray(c.clip(0, 255).astype(np.uint8)).resize((256, round(256 * c.shape[0] / c.shape[1])), Image.LANCZOS); im.save(os.path.join(OUT, f'tile-{nm}.webp'), quality=84, method=6)
        print('tile', nm, im.size)
TILES = ['basalt', 'ash', 'cooled', 'plates']; LAVA = ['molten', 'crust']
tiles_from('tiles.png', TILES); tiles_from('lava.png', LAVA)
open(os.path.join(here, '..', 'client', 'crucibleArt.js'), 'w').write('// GENERATED by tools/extract-crucible.py: The Crucible piece sizes + warm lights (lanterns, glowing lava) and the crucible\'s doorway (offsets from the bottom centre)\n'
    'export const KC_ART = ' + json.dumps(pieces, separators=(',', ':')) + ';\nexport const KC_TILES = ' + json.dumps({t: f'assets/map/kc/tile-{t}.webp' for t in TILES + LAVA}, separators=(',', ':')) + ';\n')
print('->', len(os.listdir(OUT)), 'files', sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)) // 1024, 'KB')
