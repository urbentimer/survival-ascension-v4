# Cuts the map-pieces sheet (4 x 4 on magenta):
#   row 1: ground tiles  -> client/assets/map/tile-<name>.png   (made seamless: 256x256)
#   rows 2-4: objects    -> client/assets/map/<name>.png        (scaled to in-game size, dark outline)
# Usage: python3 tools/extract-map.py tools/art/map-pieces-source.png
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage
import importlib.util
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('xd', os.path.join(here, 'extract-directions.py'))
xd = importlib.util.module_from_spec(spec); spec.loader.exec_module(xd)

GRID = [['asphalt', 'sidewalk', 'grass', 'plaza'],
        ['car', 'burntCar', 'bus', 'police'],
        ['building', 'ruin', 'streetlight', 'dumpster'],
        ['blood', 'manhole', 'rubble', 'tree']]
TARGET_W = {'car': 112, 'burntCar': 108, 'bus': 150, 'police': 112, 'building': 170, 'ruin': 160,
            'streetlight': 120, 'dumpster': 84, 'blood': 64, 'manhole': 54, 'rubble': 92, 'tree': 128}
TILE = 192                       # one tile in game pixels (asphalt/grass made seamless; plaza mirrored 2x2 at 128)
out = os.path.join(here, '..', 'client', 'assets', 'map'); os.makedirs(out, exist_ok=True)
src = np.array(Image.open(sys.argv[1]).convert('RGB')).astype(int)
fg = ndimage.binary_opening(xd.foreground(src), iterations=1)
cols = xd.squeeze(xd.runs_of(fg.sum(0) > 2, 25, 30), 4)
rows = xd.squeeze(xd.runs_of(fg.sum(1) > 2, 25, 30), 4)
assert len(cols) == 4 and len(rows) == 4, (rows, cols)

def seamless(img):
    # blend the tile with a half-offset copy of itself; the copy supplies the edges, which then wrap perfectly
    a = np.asarray(img).astype(float); h, w = a.shape[:2]
    rolled = np.roll(np.roll(a, h // 2, 0), w // 2, 1)
    yy = 1 - np.abs(np.linspace(-1, 1, h))[:, None]; xx = 1 - np.abs(np.linspace(-1, 1, w))[None, :]
    wgt = np.clip(np.minimum(yy, xx) * 3.2, 0, 1)[..., None]
    return Image.fromarray(np.clip(a * wgt + rolled * (1 - wgt), 0, 255).astype(np.uint8))

def mirror4(img):
    w, h = img.size; t = Image.new(img.mode, (w * 2, h * 2))
    t.paste(img, (0, 0)); t.paste(img.transpose(Image.FLIP_LEFT_RIGHT), (w, 0))
    t.paste(img.transpose(Image.FLIP_TOP_BOTTOM), (0, h)); t.paste(img.transpose(Image.ROTATE_180), (w, h))
    return t

for ri, (ya, yb) in enumerate(rows):
    for ci, (xa, xb) in enumerate(cols):
        name = GRID[ri][ci]
        cell = fg[ya:yb, xa:xb]
        lab, n = ndimage.label(cell, structure=np.ones((3, 3)))
        sizes = ndimage.sum(cell, lab, range(1, n + 1))
        if ri == 0:   # ground tile: the big opaque square, trimmed a few px to lose the fringe
            m = lab == int(np.argmax(sizes)) + 1; ys, xs = np.where(m)
            y0, y1, x0, x1 = ys.min() + 4, ys.max() - 3, xs.min() + 4, xs.max() - 3
            rgb = src[ya + y0:ya + y1, xa + x0:xa + x1].astype(np.uint8)
            if name == 'asphalt':   # paint out the white lane dashes (the game draws its own markings)
                f = rgb.astype(int); lum = f.mean(2)
                bright = (lum > ndimage.median_filter(lum, size=31) + 28) | ((f[..., 0] > f[..., 1] + 25) & (f[..., 2] > f[..., 1] + 25))
                lab_, n_ = ndimage.label(ndimage.binary_closing(bright, iterations=3))
                if n_:   # only long thin blobs = lane dashes (not the small stones)
                    for i, sl in enumerate(ndimage.find_objects(lab_)):
                        hh, ww = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
                        if not (ww > 40 and hh < 30): lab_[sl][lab_[sl] == i + 1] = 0
                bright = ndimage.binary_dilation(lab_ > 0, iterations=4)
                med = ndimage.median_filter(f, size=(41, 41, 1))
                f[bright] = med[bright]; rgb = np.clip(f, 0, 255).astype(np.uint8)
            if name == 'sidewalk':  # keep only the slabs above the curb (the bottom part is road)
                prof = rgb.astype(int).mean((1, 2)); h = rgb.shape[0]
                rgb = rgb[: int(h * 0.62)]
            size = 128 if name in ('plaza', 'sidewalk') else TILE
            tile = Image.fromarray(rgb).resize((size, size if name != 'sidewalk' else round(size * rgb.shape[0] / rgb.shape[1])), Image.LANCZOS)
            tile = mirror4(tile) if name == 'plaza' else seamless(tile) if name in ('asphalt', 'grass') else tile
            tile.save(os.path.join(out, f'tile-{name}.webp'), quality=88)
            continue
        keep = [i + 1 for i in range(n) if sizes[i] >= max(25, sizes.max() * 0.004)]
        m = np.isin(lab, keep); ys, xs = np.where(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        sub = m[y0:y1, x0:x1].copy(); rgb = src[ya + y0:ya + y1, xa + x0:xa + x1].copy()
        # magenta mixed into glows / gaps (pinkish): background. The game adds its own light glow.
        pinkish = (rgb[..., 0] > 120) & (rgb[..., 2] > 110) & (rgb[..., 1] < np.minimum(rgb[..., 0], rgb[..., 2]) - 45)
        if name == 'police': pinkish &= ~((rgb[..., 2] > rgb[..., 0] + 20))     # keep the blue light bar
        sub &= ~pinkish
        bg_ = ~sub
        edge = sub & (np.roll(bg_, 1, 0) | np.roll(bg_, -1, 0) | np.roll(bg_, 1, 1) | np.roll(bg_, -1, 1))
        pink = edge & (rgb[..., 0] > rgb[..., 1] + 40) & (rgb[..., 2] > rgb[..., 1] + 40)
        rgb[pink] = (rgb[pink] * 0.3).astype(int)
        rgba = np.zeros(sub.shape + (4,), np.uint8); rgba[..., :3] = np.clip(rgb, 0, 255); rgba[..., 3] = sub * 255
        img = Image.fromarray(rgba)
        k = TARGET_W[name] / img.width
        small = img.resize((TARGET_W[name], max(1, round(img.height * k))), Image.LANCZOS)
        a = np.array(small); al = a[..., 3] > 110; a[..., 3] = al * 255
        if name not in ('blood',):   # 1px dark outline like the other art
            ring = np.zeros_like(al); ring[1:] |= al[:-1]; ring[:-1] |= al[1:]; ring[:, 1:] |= al[:, :-1]; ring[:, :-1] |= al[:, 1:]; ring &= ~al
            a = np.pad(a, ((1, 1), (1, 1), (0, 0))); ring = np.pad(ring, 1); ring2 = np.zeros_like(ring)
            ring2[1:] |= np.pad(al, 1)[:-1]; ring2[:-1] |= np.pad(al, 1)[1:]; ring2[:, 1:] |= np.pad(al, 1)[:, :-1]; ring2[:, :-1] |= np.pad(al, 1)[:, 1:]
            ring2 &= ~np.pad(al, 1); a[ring2] = (14, 10, 12, 255)
        Image.fromarray(a).save(os.path.join(out, name + '.png'))
print('map pieces ->', os.path.relpath(out))
