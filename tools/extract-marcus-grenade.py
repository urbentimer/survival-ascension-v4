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
