# Bakes looping fire + smoke flipbooks from the Vefects "Free Fire VFX" textures (tools/art/vefects-fire), the way their
# Unity particle shader builds the flames: flame-shaped masks, eroded by two scrolling noises, pushed around by a
# distortion noise, coloured bottom -> top (deep orange -> bright yellow, white-hot where several overlap), several
# overlapping particles that rise, grow and fade. Every particle and noise repeats after one loop, so the strip loops seamlessly.
#   python3 tools/bake-fire.py
# Writes client/assets/sprites/fx/fire-loop.webp: row 0 = fire (F frames, FW x FH, base of the fire at the bottom centre),
#                                                  row 1 = smoke puff (one soft grey cloud, SW x SW, used as a particle)
import os
import numpy as np
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__)); ART = os.path.join(here, 'art', 'vefects-fire')
OUT = os.path.join(here, '..', 'client', 'assets', 'sprites', 'fx', 'fire-loop.webp')
F, FW, FH, S = 16, 72, 104, 3            # frames, frame size in game px, supersampling
W, H = FW * S, FH * S
rng = np.random.default_rng(11)

def tex(name):
    a = np.asarray(Image.open(os.path.join(ART, name)).convert('L')).astype(np.float32) / 255
    return a
MASK, NA, NB, ND = tex('T_VFX_Fire_Mask_01.png'), tex('T_VFX_Noise_07.png'), tex('T_VFX_Noise_08.png'), tex('T_VFX_Noise_01.png')

def sample(t, u, v):   # bilinear, wrapping (noises tile)
    h, w = t.shape; x = (u % 1) * w - .5; y = (v % 1) * h - .5
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); fx = x - x0; fy = y - y0
    x0 %= w; y0 %= h; x1 = (x0 + 1) % w; y1 = (y0 + 1) % h
    return (t[y0, x0] * (1 - fx) + t[y0, x1] * fx) * (1 - fy) + (t[y1, x0] * (1 - fx) + t[y1, x1] * fx) * fy

def sample_clamp(t, u, v):
    ok = (u >= 0) & (u < 1) & (v >= 0) & (v < 1)
    return np.where(ok, sample(t, np.clip(u, 0, .999), np.clip(v, 0, .999)), 0)

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32); U = xx / W; V = yy / H    # V: 0 top, 1 bottom
# particles: phase (when in the loop it's born), life (fraction of the loop), x offset, size, wobble
N = 14
P = [dict(ph=i / N, life=.5 + .12 * rng.random(), x=rng.uniform(-.17, .17), s=rng.uniform(.6, .82), rot=rng.uniform(-.5, .5), seed=rng.random()) for i in range(N)]
# the fire's silhouette: wide at the base, a pointed top (keeps the particles from making a blobby column)
base_w = .40 * np.clip(V - .02, 0, 1) ** .75 + .04
env = np.clip(1 - np.abs(U - .5) / base_w, 0, 1) ** .8 * np.clip((V - .02) / .25, 0, 1)
frames = []
for f in range(F):
    t = f / F; heat = np.zeros((H, W), np.float32)
    for p in P:
        for k in (-1, 0):   # the copy born last loop is still alive at the start of this one
            age = (t - p['ph']) % 1 + k
            if age < 0 or age > p['life']: continue
            a = age / p['life']                                   # 0 born -> 1 gone
            size = p['s'] * (.6 + .4 * np.sin(min(1, a * 2) * np.pi / 2)) * (1 - .35 * a)
            cx, by = .5 + p['x'] * (1 - a), 1.0 - a * .62           # rises and narrows toward the middle
            pu = (U - cx) / size + .5; pv = (V - by) / (size * 1.5) + 1   # particle-local UV (mask: flame base at its bottom)
            c, s_ = np.cos(p['rot'] * a), np.sin(p['rot'] * a); du, dv = pu - .5, pv - 1; pu, pv = .5 + du * c - dv * s_, 1 + du * s_ + dv * c
            dist = sample(ND, U * 1.3 + p['seed'], V * 1.0 + t * 2) - .5   # distortion scrolling up (whole tiles per loop: seamless)
            m = sample_clamp(MASK, pu + dist * .22, pv + dist * .12)
            n1 = sample(NA, U * .7 + p['seed'] * 3, V * .6 + t * 2); n2 = sample(NB, U * .8 - p['seed'], V * .7 + t * 3)
            val = m * (.35 + 1.3 * n1 * n2)
            fade = np.clip(1 - (a - .5) / .5, 0, 1) * np.clip(a / .1, 0, 1)
            erode = .1 + .45 * a                                  # older particles burn away (dissolve), softly
            heat += np.clip((val - erode) / (1 - erode), 0, 1) ** 1.3 * fade
    h = heat * env * 1.35
    # colour by heat: faint deep red edges -> orange -> yellow -> white-hot core; alpha from the heat
    ramp = [(0, (.55, .06, .02)), (.25, (.95, .28, .03)), (.55, (1, .58, .08)), (.9, (1, .85, .35)), (1.4, (1, .98, .85))]
    col = np.zeros((H, W, 3), np.float32)
    for (h0, c0), (h1, c1) in zip(ramp[:-1], ramp[1:]):
        k = np.clip((h - h0) / (h1 - h0), 0, 1)[..., None]; sel = ((h >= h0) | (h0 == 0))[..., None]
        col = np.where(sel, np.array(c0) * (1 - k) + np.array(c1) * k, col)
    al = np.clip(h * 2.2, 0, 1) ** 1.2
    rgba = np.dstack([np.clip(col, 0, 1) * 255, al * 255]).astype(np.uint8)
    frames.append(Image.fromarray(rgba).resize((FW, FH), Image.LANCZOS))
# smoke puff: the soft cloud texture, greyed, round falloff
SW = 48
sm = tex('T_VFX_Smoke_01.png'); yy2, xx2 = np.mgrid[0:sm.shape[0], 0:sm.shape[1]] / sm.shape[0]
sm = sm * np.clip(1 - np.hypot(xx2 - .5, yy2 - .5) * 2, 0, 1)
puff = Image.fromarray(np.dstack([np.full(sm.shape, 70), np.full(sm.shape, 66), np.full(sm.shape, 72), np.clip(sm * 1.4, 0, 1) * 255]).astype(np.uint8)).resize((SW, SW), Image.LANCZOS)
atlas = Image.new('RGBA', (FW * F, FH + SW))
for i, fr in enumerate(frames): atlas.alpha_composite(fr, (i * FW, 0))
atlas.alpha_composite(puff, (0, FH))
atlas.save(OUT, quality=82, method=6, alpha_quality=90)
print('->', os.path.relpath(OUT), atlas.size, os.path.getsize(OUT) // 1024, 'KB')
