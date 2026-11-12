# Cuts the Hivemind mini boss's front-view action sheets and effects (its 8-direction crawl uses extract-zombie-dirs.py):
#   zombies/dir8/hivemind-act.png  3 rows (bite 5, slam 6, jump 6), 260x230 cells, feet on the cell bottom (jump keeps its height)
#   fx/hivemind-fx.png             4 rows x 5 (200x150 cells): slam crack ring, landing dust, green slime splash, zombie tearing free
#   portraits/hivemind.webp
#   python3 tools/extract-zombie-dirs.py hivemind tools/art/hive-crawl.png rows=D,DR,R,UR,U,UL,L,DL cols=6 pitch=219 height=105 cellw=210 cellh=150
# (Nov 12) THE ALPHA (1.545x) has its own sharp sheets, cut at its size: zombies/dir8/hivemind-alpha-act.webp (ALPHA_ONLY=1 python3 tools/extract-hivemind.py) and its crawl:
#   SHARPEN=85 python3 tools/extract-zombie-dirs.py hivemind tools/art/hive-crawl.png rows=D,DR,R,UR,U,UL,L,DL cols=6 pitch=219 height=162 cellw=325 cellh=232 name=hivemind-alpha   (then saved as .webp q90)
import os, importlib.util
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('xd', os.path.join(here, 'extract-directions.py'))
xd = importlib.util.module_from_spec(spec); spec.loader.exec_module(xd)
C = os.path.join(here, '..', 'client', 'assets')
load = lambda n: np.array(Image.open(os.path.join(here, 'art', n + '.png')).convert('RGB')).astype(int)

def cut(part, smoke=False):
    fg = xd.foreground(part); r, g, b = part[..., 0], part[..., 1], part[..., 2]
    out = part.copy()
    if smoke:   # dust blended into the magenta: keep it as see-through grey-brown
        tint = (r - g > 25) & (b - g > 25) & ~((r > 205) & (b > 205) & (g < 95))
        fg |= tint; v = out[tint].mean(1, keepdims=True); out[tint] = np.clip(v * np.array([1.0, .92, .82]), 0, 255).astype(int)
    edge = fg & ~np.pad(fg, 1)[2:, 1:-1] | fg & ~np.pad(fg, 1)[:-2, 1:-1] | fg & ~np.pad(fg, 1)[1:-1, 2:] | fg & ~np.pad(fg, 1)[1:-1, :-2]
    pink = edge & (r - g > 60) & (b - g > 60); out[pink] = (out[pink] * .35).astype(int)   # magenta fringe on the outline
    a = np.zeros(part.shape[:2] + (4,), np.uint8); a[..., :3] = np.clip(out, 0, 255); a[..., 3] = fg * 255
    if smoke: a[..., 3][tint] = 150
    return a

def frame_masks(src, n):
    """Split a row of n evenly spaced poses: every blob goes to the nearest of n evenly spaced centres."""
    from scipy import ndimage
    fg = xd.foreground(src); xs = np.where(fg.sum(0) > 2)[0]; x0, x1 = xs.min(), xs.max() + 1; pitch = (x1 - x0) / n
    lab, k = ndimage.label(ndimage.binary_dilation(fg, iterations=2)); out = [np.zeros_like(fg) for _ in range(n)]
    for i, sl in enumerate(ndimage.find_objects(lab)):
        cx = (sl[1].start + sl[1].stop) / 2; j = min(n - 1, max(0, int((cx - x0) // pitch)))
        out[j][sl] |= (lab[sl] == i + 1) & fg[sl]
    return out

atlas = Image.open(os.path.join(C, 'sprites', 'zombies', 'dir8', 'hivemind.png'))
H0 = atlas.crop((0, 0, 210, 150)).getbbox(); H0 = H0[3] - H0[1]        # crawl, facing down, frame 1: the size to match
W0 = atlas.crop((0, 0, 210, 150)).getbbox(); W0 = W0[2] - W0[0]       # ...matched by width (poses differ in height)
def sharp_resize(a, k):   # (Nov 12, the Alpha) premultiplied Lanczos, soft antialiased edge, unsharp mask on the colour
    from PIL import ImageFilter
    al0 = a[..., 3:4].astype(np.float32) / 255; pm = np.clip(a[..., :3].astype(np.float32) * al0, 0, 255).astype(np.uint8)
    w, h = max(1, round(a.shape[1] * k)), max(1, round(a.shape[0] * k))
    up = lambda x: np.array(Image.fromarray(np.ascontiguousarray(x)).resize((w, h), Image.LANCZOS)).astype(np.float32)
    A = np.clip(np.dstack([up(pm[..., i]) for i in range(3)]), 0, 255); al = np.clip(up(a[..., 3]), 0, 255) / 255
    rgb = np.where(al[..., None] > .02, A / np.maximum(al[..., None], .02), 0)
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=1.3 * max(1, k), percent=70, threshold=2))
    return Image.fromarray(np.dstack([np.array(img), (np.clip((al - .18) / .64, 0, 1) * 255).astype(np.uint8)]))
def act_sheet(F, path, sharp):   # F = how much bigger than the mini boss (the Alpha: 68 / 44)
    CW, CH = round(260 * F), round(230 * F); S = Image.new('RGBA', (CW * 6, CH * 3))
    for ri, (name, n) in enumerate([('bite', 5), ('slam', 6), ('jump', 6)]):
        src = load('hive-' + name); masks = frame_masks(src, n); full = cut(src)
        ground = max(np.where(m.any(1))[0].max() for m in masks) + 1
        def piece(m):
            a = full.copy(); a[..., 3] = np.where(m, a[..., 3], 0); ys, xs = np.where(m); return a[:ground + 2, xs.min():xs.max() + 1], ys.min()
        p0, _ = piece(masks[0]); w0 = p0.shape[1]; k = W0 / w0 * F
        for ci, m in enumerate(masks):
            a, top = piece(m); a = a[top:]                                   # keep the gap to the ground (jump frames float)
            if sharp: img = sharp_resize(a, k)
            else:
                img = Image.fromarray(a); img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)
                arr = np.array(img); arr[..., 3] = (arr[..., 3] > 110) * 255; img = Image.fromarray(arr)
            img = img.crop((0, max(0, img.height - CH), min(img.width, CW), img.height))
            S.alpha_composite(img, (ci * CW + max(0, (CW - img.width) // 2), ri * CH + CH - img.height))
        print(name, n, 'frames, scale', round(k, 3))
    if path.endswith('.webp'): S.save(path, quality=90, alpha_quality=92, method=6)
    else: S.save(path)
    print(os.path.basename(path), S.size)
ALPHA = 68 / 44   # the Alpha Hivemind's size (server: round(HIVE.radius 44 * alpha.size 1.55) = 68)
if os.environ.get('ALPHA_ONLY'):   # python3 tools/extract-hivemind.py with ALPHA_ONLY=1: just the Alpha's own sharp sheet (its crawl: see the header)
    act_sheet(ALPHA, os.path.join(C, 'sprites', 'zombies', 'dir8', 'hivemind-alpha-act.webp'), True); raise SystemExit
act_sheet(1, os.path.join(C, 'sprites', 'zombies', 'dir8', 'hivemind-act.png'), False)   # (the committed file was palette-compressed afterwards: re-running gives the same art, a bigger file)
act_sheet(ALPHA, os.path.join(C, 'sprites', 'zombies', 'dir8', 'hivemind-alpha-act.webp'), True)
# effects
src = load('hive-fx'); fg = xd.foreground(src)
r, g, b = src[..., 0], src[..., 1], src[..., 2]; ink = fg | ((r - g > 25) & (b - g > 25) & ~((r > 205) & (b > 205) & (g < 95)))
rows = xd.squeeze(xd.runs_of(ink.sum(1) > 1, 25, 6), 4); FW, FH = 200, 150
F = Image.new('RGBA', (FW * 5, FH * 4))
for ri, (y0, y1) in enumerate(rows):
    band = src[max(0, y0 - 8):y1 + 8]; W = band.shape[1]
    for ci in range(5):
        a = Image.fromarray(cut(band[:, round(ci * W / 5):round((ci + 1) * W / 5)], smoke=ri == 1)); bb = a.getbbox()
        if not bb: continue
        a = a.crop(bb); k = .62 if ri < 3 else .5; a = a.resize((max(1, round(a.width * k)), max(1, round(a.height * k))), Image.LANCZOS)
        F.alpha_composite(a.crop((0, 0, min(a.width, FW), min(a.height, FH))), (ci * FW + max(0, (FW - a.width) // 2), ri * FH + max(0, FH - 4 - a.height)))
F.save(os.path.join(C, 'sprites', 'fx', 'hivemind-fx.png')); print('fx', F.size)
p = Image.open(os.path.join(here, 'art', 'hive-portrait.png')).convert('RGB'); p.thumbnail((320, 320)); p.save(os.path.join(C, 'portraits', 'hivemind.webp'), quality=88); print('portrait')
