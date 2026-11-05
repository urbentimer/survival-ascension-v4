# Sofea's mecha flamethrower jet, baked from the Vefects "Free Fire VFX" textures (tools/art/vefects-fire), the way their
# Unity fire shader works: flame-shaped masks eroded by scrolling noise and pushed around by a distortion noise, many
# overlapping fire bursts that shoot out of the nozzle, swell, cool down (white-hot -> yellow -> orange -> red) and turn to smoke.
#   python3 tools/bake-flamethrower.py
# Writes client/assets/sprites/fx/sofea-flame.webp: 28 frames, cells 208x160, the nozzle = cell (4, 80), it blasts RIGHT,
# the jet is ~JET px long:  0-7 ignite (it shoots out), 8-19 seamless loop, 20-27 cut off (the tail flies away and burns out)
import os
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'vefects-fire')
OUT = os.path.join(here, '..', 'client', 'assets', 'sprites', 'fx', 'sofea-flame.webp')
CW, CH, NX, S = 208, 160, 4, 2   # tall cells: the jet fans out into a wide cone
W, H = CW * S, CH * S
JET = 168                     # jet length in cell px
LOOP, IGN, END = 12, 8, 8
rng = np.random.default_rng(5)

def tex(name): return np.asarray(Image.open(os.path.join(ART, name)).convert('L')).astype(np.float32) / 255
MASK, BLOB, NA, NB, ND = tex('T_VFX_Fire_Mask_01.png'), tex('T_VFX_Smoke_01.png'), tex('T_VFX_Noise_07.png'), tex('T_VFX_Noise_08.png'), tex('T_VFX_Noise_01.png')

def sample(t, u, v):   # bilinear, wrapping
    h, w = t.shape; x = (u % 1) * w - .5; y = (v % 1) * h - .5
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); fx = x - x0; fy = y - y0
    x0 %= w; y0 %= h; x1 = (x0 + 1) % w; y1 = (y0 + 1) % h
    return (t[y0, x0] * (1 - fx) + t[y0, x1] * fx) * (1 - fy) + (t[y1, x0] * (1 - fx) + t[y1, x1] * fx) * fy
def sample_clamp(t, u, v):
    ok = (u >= 0) & (u < 1) & (v >= 0) & (v < 1)
    return np.where(ok, sample(t, np.clip(u, 0, .999), np.clip(v, 0, .999)), 0)

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32); X = xx / S - NX; Y = yy / S - CH / 2   # cell px, nozzle at (0, 0)
L = X / JET                                                                            # 0 at the nozzle -> 1 at the end
N = 64   # bursts per loop
P = [dict(ph=i / N, life=.34 + .06 * rng.random(), dy=rng.uniform(-1, 1), s=rng.uniform(.85, 1.15), seed=rng.random(), rot=rng.uniform(0, 6.28)) for i in range(N)]

def frame(t, reach=1e9, tail=-1e9):
    """one frame at loop time t (0..1); reach/tail: only the part of the jet between tail and reach (cell px) burns"""
    heat = np.zeros((H, W), np.float32); smoke = np.zeros((H, W), np.float32)
    dist = sample(ND, xx / W * 1.4 - t * 3, yy / H * .8 + .3) - .5                     # distortion flowing out of the nozzle
    n1 = sample(NA, xx / W * 1.2 - t * 4, yy / H * .9); n2 = sample(NB, xx / W * 1.5 - t * 6, yy / H * 1.1 + .5)
    for p in P:
        for k in (-1, 0):
            age = (t - p['ph']) % 1 + k
            if age < 0 or age > p['life']: continue
            a = age / p['life']
            cx = a ** .85 * JET * 1.02                                    # flies out fast, slows a little
            if cx > reach + 6 or cx < tail - 6: continue
            r = (8 + .36 * cx) * p["s"]                                     # swells as it flies
            cy = p["dy"] * cx * .2                                         # each burst flies out at its own angle: a cone (~42 degrees with the bursts' size)
            u = (X - cx) / (2.2 * r) + .5 + dist * .18; v = (Y - cy) / (2 * r) + .5 + dist * .12
            c, s_ = np.cos(p['rot'] + a), np.sin(p['rot'] + a); du, dv = u - .5, v - .5; u, v = .5 + du * c - dv * s_, .5 + du * s_ + dv * c
            m = sample_clamp(BLOB if a > .5 else MASK, u, v)
            val = m * (.55 + 1.1 * n1 * n2)
            erode = .04 + .3 * a
            b = np.clip((val - erode) / (1 - erode), 0, 1) ** 1.2
            fade = np.clip(a / .06, 0, 1)
            heat += b * fade * (1.35 - a * 1.05)                          # cools as it flies
            smoke += b * np.clip((a - .55) / .45, 0, 1) * .8
    # the hot core right out of the nozzle
    core = np.exp(-(Y / (4 + 16 * L.clip(0))) ** 2) * np.clip(1 - L / .42, 0, 1) * (X > -1) * (.75 + .5 * n1)
    heat += core * 1.4
    heat *= .6
    win = np.clip((reach - X) / 10, 0, 1) * np.clip((X - tail) / 10, 0, 1)
    heat *= win; smoke *= win
    ramp = [(0, (.5, .06, .02)), (.22, (.92, .25, .03)), (.5, (1, .55, .08)), (.85, (1, .84, .32)), (1.35, (1, .98, .86))]
    col = np.zeros((H, W, 3), np.float32)
    for (h0, c0), (h1, c1) in zip(ramp[:-1], ramp[1:]):
        kk = np.clip((heat - h0) / (h1 - h0), 0, 1)[..., None]; sel = ((heat >= h0) | (h0 == 0))[..., None]
        col = np.where(sel, np.array(c0) * (1 - kk) + np.array(c1) * kk, col)
    fa = np.clip(heat * 2.6, 0, 1) ** 1.1; sa = np.clip(smoke * .9, 0, .75) * (1 - fa)
    col = (col * fa[..., None] + np.array([.16, .14, .15]) * sa[..., None]) / np.maximum(fa + sa, 1e-4)[..., None]
    rgba = np.dstack([np.clip(col, 0, 1) * 255, np.clip(fa + sa, 0, 1) * 255]).astype(np.uint8)
    return Image.fromarray(rgba).resize((CW, CH), Image.LANCZOS)

frames = []
for i in range(IGN): frames.append(frame(i / LOOP * .5, reach=(i + 1) / IGN * (JET + 20)))                     # shoots out
for i in range(LOOP): frames.append(frame(i / LOOP))                                                          # loop
for i in range(END): frames.append(frame((LOOP + i) / LOOP % 1, tail=(i + 1) / END * (JET + 30)))            # tail flies off
atlas = Image.new('RGBA', (CW * len(frames), CH))
for i, fr in enumerate(frames): atlas.alpha_composite(fr, (i * CW, 0))
atlas.save(OUT, quality=66, method=6, alpha_quality=80)
print('->', os.path.relpath(OUT), len(frames), 'frames', os.path.getsize(OUT) // 1024, 'KB')
