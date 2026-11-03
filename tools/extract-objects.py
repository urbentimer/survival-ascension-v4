# Cuts the 12 objects (3 rows x 4) out of the magenta sheet, cleans the pink fringe,
# scales each to its in-game size, adds a dark outline and saves one PNG per object.
import numpy as np, os, json
from PIL import Image
from scipy import ndimage
here = os.path.dirname(os.path.abspath(__file__))
src = np.array(Image.open(os.path.join(here, 'art', 'objects-source.jpg')).convert('RGB')).astype(int)
H, W, _ = src.shape
GRID = [['tower', 'generator', 'barricade', 'sandbags'],
        ['turret', 'mine', 'fence', 'flameTrap'],
        ['crate', 'medkit', 'ammo', 'weaponCase']]
# target width in game pixels
TARGET_W = {'tower': 104, 'generator': 62, 'barricade': 50, 'sandbags': 54, 'turret': 44, 'mine': 26,
            'fence': 46, 'flameTrap': 46, 'crate': 26, 'medkit': 22, 'ammo': 22, 'weaponCase': 30}
out_dir = os.path.join(here, '..', 'client', 'assets', 'sprites', 'objects'); os.makedirs(out_dir, exist_ok=True)

r, g, b = src[..., 0], src[..., 1], src[..., 2]
core = (r > 215) & (b > 215) & (g < 70)
soft = (r > 150) & (b > 150) & (g < 120) & (abs(r - b) < 110)
bg = core.copy()
for _ in range(3): bg = ndimage.binary_dilation(bg) & (core | soft)
fg = ~bg
lab, n = ndimage.label(fg, structure=np.ones((3, 3)))
sizes = ndimage.sum(fg, lab, range(1, n + 1)); boxes = ndimage.find_objects(lab)
cells = {}
for i in range(n):
    if sizes[i] < 30: continue
    bx = boxes[i]; cy = (bx[0].start + bx[0].stop) / 2; cx = (bx[1].start + bx[1].stop) / 2
    row = min(2, int(cy / (H / 3))); col = min(3, int(cx / (W / 4)))
    cells.setdefault((row, col), []).append(i + 1)
meta = {}
for (row, col), labels in sorted(cells.items()):
    name = GRID[row][col]
    m = np.isin(lab, labels); ys, xs = np.where(m)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    sub = m[y0:y1, x0:x1].copy(); rgb = src[y0:y1, x0:x1].copy()
    if name == 'tower':   # magenta seen through the lattice gaps (blended with the red metal) is background too
        sub &= ~soft[y0:y1, x0:x1]
        sub &= ~((rgb[..., 0] > 120) & (rgb[..., 2] > 110) & (rgb[..., 1] < 90) & (abs(rgb[..., 0] - rgb[..., 2]) < 70))
        top = np.zeros_like(sub); top[: int(sub.shape[0] * 0.16)] = True   # beacon halo (red glow + magenta = pink): the game draws its own glow
        sub &= ~(top & (rgb[..., 0] > 170) & (rgb[..., 2] > 80) & (rgb[..., 1] < 140))
    bgm = ~sub
    edge = sub & (np.roll(bgm, 1, 0) | np.roll(bgm, -1, 0) | np.roll(bgm, 1, 1) | np.roll(bgm, -1, 1))
    pink = edge & (rgb[..., 0] > rgb[..., 1] + 40) & (rgb[..., 2] > rgb[..., 1] + 40)
    rgb[pink] = (rgb[pink] * 0.35).astype(int)
    rgba = np.zeros(sub.shape + (4,), np.uint8); rgba[..., :3] = np.clip(rgb, 0, 255); rgba[..., 3] = sub * 255
    img = Image.fromarray(rgba)
    scale = TARGET_W[name] / img.width
    small = img.resize((TARGET_W[name], max(1, round(img.height * scale))), Image.LANCZOS)
    arr = np.array(small); al = arr[..., 3] > 110; arr[..., 3] = al * 255
    ring = np.zeros_like(al); ring[1:] |= al[:-1]; ring[:-1] |= al[1:]; ring[:, 1:] |= al[:, :-1]; ring[:, :-1] |= al[:, 1:]; ring &= ~al
    arr[ring] = (14, 10, 12, 255)
    out = Image.new('RGBA', (arr.shape[1] + 2, arr.shape[0] + 2)); out.paste(Image.fromarray(arr), (1, 1))
    out.save(os.path.join(out_dir, name + '.png'))
    meta[name] = {'w': out.width, 'h': out.height}
json.dump(meta, open(os.path.join(out_dir, 'objects.json'), 'w'), indent=1)
print(json.dumps(meta))
