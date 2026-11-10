# WHITEOUT STATION (grid map, Nov 10) pieces from the user's ChatGPT art in tools/art/whiteout (all on solid magenta #FF00FF):
#   big-<name>.png   one big building per image (lab, labBurnt, dome, quarters, hangar, rig, plane, wall, gate)
#   labBurnt.gif     the burning lab ANIMATED (9 frames, 412px): used for wLabBurnt instead of the still picture
#   buildings.png    4x4 sheet with black grid lines: containers, generator, tank, round tank / snowcat, truck, forklift, buggy /
#                    watchtower, mast, dish, shed / sandbags, barrier, crates, gas rack
#   props.png        4x4 sheet: rocks, ice spikes, pines, rock arch / floodlight, lamp, windsock, beacon / shelf, pipes, barrels, big crate /
#                    (barrier again: unused), fence, sign, flag
#   tiles.png        4 ground tiles in a row (snow, ice, metal grating, concrete), drawn as loose tiles with snowy edges: the middle of
#                    each is cropped and made seamless here
#   python3 tools/extract-whiteout.py
# Writes client/assets/map/wo/<kind>.webp (scaled to in-game size, bottom-centre = where it stands), tile-<name>.webp (seamless 256px)
# and client/whiteoutArt.js: per kind its size, LIGHTS (lit windows / lamps: glow + night light), FIRES (light + crackle) and frames.
import os, json
import numpy as np
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'whiteout')
OUT = os.path.join(here, '..', 'client', 'assets', 'map', 'wo'); os.makedirs(OUT, exist_ok=True)
Q = 78

def key(a):   # magenta of any brightness -> transparent; specks dropped; pink spill on the outline pulled to neutral
    a = a.astype(int); r, g, b = a[..., 0], a[..., 1], a[..., 2]
    keep = ~((r - g > 40) & (b - g > 40) & (np.abs(r - b) < 90))
    keep = ndimage.binary_opening(keep, iterations=1)
    lab, n = ndimage.label(keep); sizes = ndimage.sum(keep, lab, range(1, n + 1)); keep = np.isin(lab, [i + 1 for i in range(n) if sizes[i] > 60])
    edge = keep & ndimage.binary_dilation(~keep, iterations=2); pink = edge & (r > g + 14) & (b > g + 14)
    a[..., 0] = np.where(pink, g + 8, r); a[..., 2] = np.where(pink, g + 8, b)
    return np.dstack([np.clip(a, 0, 255).astype(np.uint8), (keep * 255).astype(np.uint8)])

def crop(c):
    ys, xs = np.where(c[..., 3] > 0); return c[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

def grid_cells(rgba, n):   # n x n grid with drawn grid lines: the lines are erased, then each blob goes to the cell its centre is in
    H, W = rgba.shape[:2]; rgba = rgba.copy()
    for i in range(n + 1):
        y = round(i * H / n); x = round(i * W / n); rgba[max(0, y - 7):y + 7, :, 3] = 0; rgba[:, max(0, x - 7):x + 7, 3] = 0
    lab, _ = ndimage.label(rgba[..., 3] > 0); objs = ndimage.find_objects(lab); ph, pw = H / n, W / n
    cells = [[[] for _ in range(n)] for _ in range(n)]
    for i, sl in enumerate(objs):
        if sl is None or (sl[0].stop - sl[0].start) * (sl[1].stop - sl[1].start) < 80: continue
        cells[min(n - 1, int((sl[0].start + sl[0].stop) / 2 // ph))][min(n - 1, int((sl[1].start + sl[1].stop) / 2 // pw))].append(i + 1)
    return [[crop(np.where(np.isin(lab, ids)[..., None], rgba, 0).astype(np.uint8)) if ids else None for ids in row] for row in cells]

def spots(a, kind, maxn):   # lit windows / lamps (bright yellow; the orange paint stripes are redder) or fire: blob centres, biggest first
    r, g, b, al = [a[..., i].astype(int) for i in range(4)]
    if kind == 'fire': m = (al > 0) & (r > 235) & (g > 130) & (b < 110) & (r - b > 150)
    elif kind == 'red': m = (al > 0) & (r > 225) & (g < 90) & (b < 90)
    else: m = (al > 0) & (r > 232) & (g > 172) & (b < 150) & (r - b > 95)
    m = ndimage.binary_opening(m, iterations=1); m = ndimage.binary_dilation(m, iterations=3)
    lab, n = ndimage.label(m)
    if not n: return []
    sizes = ndimage.sum(m, lab, range(1, n + 1)); cents = ndimage.center_of_mass(m, lab, range(1, n + 1)); out = []
    for i in np.argsort(-sizes):
        if sizes[i] < 16: break
        cy, cx = cents[i]
        if any(abs(cx - x) < 26 and abs(cy - y) < 26 for x, y, _ in out): continue
        out.append((cx, cy, float(sizes[i])))
        if len(out) >= maxn: break
    return out

pieces = {}
def scaled(c, width):
    c = crop(c); sc = width / c.shape[1]
    im = Image.fromarray(np.ascontiguousarray(c)).resize((round(c.shape[1] * sc), round(c.shape[0] * sc)), Image.LANCZOS)
    a = np.array(im); a[..., 3] = np.where(a[..., 3] > 90, 255, 0); return a

def save(kind, c, width, lights=0, fires=0):
    a = scaled(c, width); im = Image.fromarray(a); im.save(os.path.join(OUT, kind + '.webp'), quality=Q, method=6, alpha_quality=80)
    w, h = im.size; info = {'url': f'assets/map/wo/{kind}.webp', 'w': w, 'h': h}   # literal url: the preview builder inlines it
    if lights: info['lights'] = [[round(x - w / 2), round(y - h)] for x, y, s in spots(a, 'light', lights)] + [[round(x - w / 2), round(y - h), 1] for x, y, s in spots(a, 'red', 2)]
    if fires: info['fires'] = [[round(x - w / 2), round(y - h), round(min(1.4, .45 + (s ** .5) / 30), 2)] for x, y, s in spots(a, 'fire', fires)]
    pieces[kind] = info
    print(f'{kind:12s} {w}x{h}  lights {len(info.get("lights", []))}  fires {len(info.get("fires", []))}')

def load(name): return key(np.array(Image.open(os.path.join(ART, name)).convert('RGB')))

# big buildings: one per image (game px widths; a survivor is ~54px tall)
BIG = {'lab': (400, 8), 'dome': (380, 5), 'quarters': (390, 10), 'hangar': (430, 10), 'rig': (440, 10), 'plane': (540, 3), 'wall': (520, 5), 'gate': (760, 12)}
for k, (w, nl) in BIG.items(): save('w' + k[0].upper() + k[1:], load('big-' + k + '.png'), w, nl)

# the burning lab: the user's animated GIF -> one row of frames, all cut with the same box so the building doesn't jump
g = Image.open(os.path.join(ART, 'labBurnt.gif')); frames = []
for i in range(g.n_frames): g.seek(i); frames.append(key(np.array(g.convert('RGB'))))
allm = np.any([f[..., 3] > 0 for f in frames], 0); ys, xs = np.where(allm); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
body = np.all([f[..., 3] > 0 for f in frames], 0); bx = np.where(body.any(0))[0]   # the building itself (in every frame): its width sets the scale, like the still lab
sc = 400 / (bx.max() - bx.min() + 1) * (1254 / 1254); fw, fh = round((x1 - x0) * sc), round((y1 - y0) * sc)
sheet = Image.new('RGBA', (fw * len(frames), fh))
for i, f in enumerate(frames):
    im = Image.fromarray(np.ascontiguousarray(f[y0:y1, x0:x1])).resize((fw, fh), Image.LANCZOS); a = np.array(im); a[..., 3] = np.where(a[..., 3] > 90, 255, 0); sheet.paste(Image.fromarray(a), (i * fw, 0))
sheet.save(os.path.join(OUT, 'wLabBurnt.webp'), quality=74, method=6, alpha_quality=80)
a0 = np.array(sheet)[:, :fw]; cxb = (bx.min() + bx.max() + 1) / 2 - x0   # the building's centre inside the frame (smoke hangs off to the right)
pieces['wLabBurnt'] = {'url': 'assets/map/wo/wLabBurnt.webp', 'w': fw, 'h': fh, 'frames': len(frames), 'ms': g.info.get('duration', 130), 'ax': round(cxb * sc),
                       'fires': [[round(x - cxb * sc), round(y - fh), round(min(1.4, .45 + (s ** .5) / 30), 2)] for x, y, s in spots(a0, 'fire', 4)], 'anim': 1}
print(f'wLabBurnt    {fw}x{fh} x {len(frames)} frames, centre x {round(cxb * sc)}, fires {len(pieces["wLabBurnt"]["fires"])}, {os.path.getsize(os.path.join(OUT, "wLabBurnt.webp")) // 1024} KB')

b = grid_cells(load('buildings.png'), 4)
BLD = [[('wContainers', 210, 0), ('wGenerator', 150, 0), ('wTank', 190, 0), ('wTankRound', 165, 0)],
       [('wSnowcat', 180, 2), ('wTruck', 205, 2), ('wForklift', 135, 1), ('wBuggy', 140, 2)],
       [('wWatchtower', 140, 3), ('wMast', 100, 1), ('wDish', 160, 0), ('wShed', 200, 1)],
       [('wSandbags', 190, 2), ('wBarrier', 150, 0), ('wCrates', 150, 0), ('wGasRack', 130, 0)]]
for r, row in enumerate(BLD):
    for c, (k, w, nl) in enumerate(row): save(k, b[r][c], w, nl)
p = grid_cells(load('props.png'), 4)
PROPS = [[('wRocks', 150, 0), ('wIce', 150, 0), ('wPines', 140, 0), ('wRockArch', 150, 0)],
         [('wFloodlight', 110, 2), ('wLamp', 84, 1), ('wWindsock', 90, 0), ('wBeacon', 90, 1)],
         [('wShelf', 140, 0), ('wPipes', 140, 0), ('wBarrels', 110, 0), ('wBigCrate', 140, 1)],
         [None, ('wFence', 150, 0), ('wSign', 110, 0), ('wFlag', 90, 0)]]
for r, row in enumerate(PROPS):
    for c, it in enumerate(row):
        if it: save(it[0], p[r][c], it[1], it[2])

# ground tiles: the art's 4 loose tiles -> a clean middle piece of each, made seamless, 256px (the game's spooky tint darkens them)
t = np.array(Image.open(os.path.join(ART, 'tiles.png')).convert('RGB')); m = key(t)[..., 3] > 0
cols = np.where(m.any(0))[0]; runs = []; s0 = cols[0]
for i in range(1, len(cols)):
    if cols[i] - cols[i - 1] > 8: runs.append((s0, cols[i - 1])); s0 = cols[i]
runs.append((s0, cols[-1])); assert len(runs) == 4, runs
rows = np.where(m.any(1))[0]; ty0, ty1 = rows.min(), rows.max()
def blend(a):   # organic textures: blend with a half-offset copy (edges come from the copy, which wraps)
    a = a.astype(float); h, w = a.shape[:2]; s = np.roll(np.roll(a, h // 2, 0), w // 2, 1)
    yy, xx = np.mgrid[0:h, 0:w]; d = np.minimum.reduce([xx, yy, w - 1 - xx, h - 1 - yy]) / (min(h, w) * .25)
    k = np.clip(d, 0, 1)[..., None]; return (a * k + s * (1 - k)).astype(np.uint8)
def mirror(a): top = np.concatenate([a, a[:, ::-1]], 1); return np.concatenate([top, top[::-1]], 0)   # built patterns: mirrored 2x2 = seamless with no ghosting
# (x0, y0, x1, y1) as fractions of each tile, method, brightness
TILES = {'snow': (.3, .25, .72, .67, blend, 1.0), 'ice': (.30, .22, .66, .58, mirror, .98), 'metal': (.135, .135, .5, .5, mirror, .92), 'concrete': (.2, .2, .5, .5, mirror, .95)}
for (name, (fx0, fy0, fx1, fy1, how, dim)), (c0, c1) in zip(TILES.items(), runs):
    w = c1 - c0; h = ty1 - ty0; sq = t[ty0 + round(fy0 * h):ty0 + round(fy1 * h), c0 + round(fx0 * w):c0 + round(fx1 * w)]
    im = Image.fromarray(np.clip(how(sq).astype(float) * dim, 0, 255).astype(np.uint8)).resize((256, 256), Image.LANCZOS)
    im.save(os.path.join(OUT, f'tile-{name}.webp'), quality=82, method=6)
JS = os.path.join(here, '..', 'client', 'whiteoutArt.js')
open(JS, 'w').write('// GENERATED by tools/extract-whiteout.py: Whiteout Station piece sizes + lights / fires (offsets from the bottom centre)\n'
                    'export const WO_ART = ' + json.dumps(pieces, separators=(',', ':')) + ';\n'
                    'export const WO_TILES = ' + json.dumps({t: f'assets/map/wo/tile-{t}.webp' for t in TILES}, separators=(',', ':')) + ';\n')
print('WO_SIZE = { ' + ', '.join(f'{k}: [{v["w"]}, {v["h"]}]' for k, v in pieces.items()) + ' };')
tot = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
print('->', os.path.relpath(OUT), len(os.listdir(OUT)), 'files', tot // 1024, 'KB')
