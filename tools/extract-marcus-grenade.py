# Marcus's Frag Barrage grenade (Nov 19, user's sheet tools/art/marcus-grenade.png, magenta): 6 frames in a row: the smoke-frag canister (with a
# smoke trail), the flash, the blast (debris + first smoke), the big grey smoke cloud, thinning over a scorch mark, the last wisps.
#   python3 tools/extract-marcus-grenade.py
# -> client/assets/sprites/fx/marcus-blast.webp (frames 2-6 on a shared ground point; the blast frame = his 85px blast circle, 170px across)
#    client/assets/sprites/fx/marcus-grenade.webp (the canister alone, 26x26, centred; the code draws its smoke trail)
# Uses the helpers (magenta unmixing, valley cuts, premultiplied shrink, atlas) from tools/extract-sienna-fx.py.
import os
here = os.path.dirname(os.path.abspath(__file__)); src = open(os.path.join(here, 'extract-sienna-fx.py')).read()
exec(src[:src.index('# 1. Cryo grenade burst')])
R = os.path.join(here, 'art')
B = frames('marcus-grenade.png', 6)
bw = lambda f: box(f)[1] - box(f)[0]
def degreen(f):   # the grey smoke was drawn see-through over the magenta: unmixing it leaves it greenish, so green-leaning pixels go back to grey
    f = f.copy(); r, g, b = f[..., 0], f[..., 1], f[..., 2]; m = (g > r + 3) & (g > b + 3); v = (r + g + b) / 3 * 1.05
    for c in range(3): f[..., c] = np.where(m, np.clip(v, 0, 255), f[..., c])
    return f
B = [B[0]] + [(degreen(f), xy) for f, xy in B[1:]]
SC = 170 / bw(B[2][0])
atlas('marcus-blast.webp', B[1:], [ground(f, x0, y0, bw(f) * .12) for f, (x0, y0) in B[1:]], SC)
can = B[0][0]; m = can[..., 3] > 90; lab, n = ndimage.label(m); big = 1 + int(np.argmax(ndimage.sum(m, lab, range(1, n + 1))))
ys, xs = np.where(lab == big); keep = ndimage.binary_dilation(lab == big, iterations=2); can = can.copy(); can[..., 3] *= keep
can = can[max(0, ys.min() - 2):ys.max() + 3, max(0, xs.min() - 2):xs.max() + 3]
g = shrink(can, 22 / max(can.shape[:2])); cell = Image.new('RGBA', (26, 26)); cell.alpha_composite(g, ((26 - g.width) // 2, (26 - g.height) // 2))
cell.save(os.path.join(FX, 'marcus-grenade.webp'), quality=94, alpha_quality=100, method=6); print('marcus-grenade.webp: 26x26 (the canister, centred)')

# (Nov 19, user: "ultra realistic like Vex") the BLAST is replaced by tools/art/marcus-blast-real.png: realistic fire + smoke on PURE BLACK,
# 6 frames (flash, fireball, fireball rolling into smoke, the big smoke cloud lit from below, thinning, wisps). Black is unmixed (opacity =
# brightness, x1.4 so the grey smoke stays thick); every frame is cut round its own middle (they're drawn centred on one point). The canister above
# stays the pixel one. Overwrites marcus-blast.webp (6 frames now) and prints MBLAST.
a = np.array(Image.open(os.path.join(R, 'marcus-blast-real.png')).convert('RGB')).astype(np.float32)
mx = a.max(axis=2); al = np.clip((mx - 8) / 247 * 1.4, 0, 1); rgb = np.where(al[..., None] > 1e-3, np.clip((a - 8 * (1 - al[..., None])) / np.maximum(al[..., None], 1e-3), 0, 255), 0)
F = np.dstack([rgb, al * 255]); H, W = al.shape; col = ndimage.gaussian_filter(al, 3).sum(axis=0)
cuts = [0] + [valley(col, W * k / 6, W / 6 * .3) for k in range(1, 6)] + [W]
fr = []
for i in range(6):
    seg = F[:, cuts[i]:cuts[i + 1]]; m = seg[..., 3] > 10; ys, xs = np.where(m); fr.append((seg, (xs.min(), xs.max() + 1, ys.min(), ys.max() + 1), cuts[i]))
k3 = fr[2][1]; SCR = 170 / (k3[1] - k3[0])
cx = [(b[0] + b[1]) / 2 for _, b, _ in fr]; half = max(max(cx[i] - fr[i][1][0], fr[i][1][1] - cx[i]) for i in range(6)) + 4
top = min(b[2] for _, b, _ in fr) - 4; bot = max(b[3] for _, b, _ in fr) + 4; b4 = fr[3][1]; gyS = (b4[2] + b4[3]) / 2 + (b4[3] - b4[2]) * .18
cells = []
for i, (seg, b, off) in enumerate(fr):
    c0 = int(round(cx[i] - half)); cell = np.zeros((bot - top, int(2 * half), 4)); s0 = max(0, c0); s1 = min(seg.shape[1], c0 + int(2 * half))
    cell[:, s0 - c0:s1 - c0] = seg[top:bot, s0:s1]; cells.append(shrink(cell, SCR))
CW = max(c.width for c in cells); CH = max(c.height for c in cells); out = Image.new('RGBA', (CW * 6, CH))
for i, c in enumerate(cells): out.alpha_composite(c, (i * CW, 0))
out.save(os.path.join(FX, 'marcus-blast.webp'), quality=92, alpha_quality=95, method=6)
print('marcus-blast.webp (realistic): MBLAST =', {'cw': CW, 'ch': CH, 'gx': round(half * SCR), 'gy': round((gyS - top) * SCR)})
