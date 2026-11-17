# Vex's skill effects (Nov 17) -> client/assets/sprites/fx/vex-*.webp
#   python3 tools/extract-vex-fx.py   (run by tools/cut-vex.sh)
# Sources (tools/art/vex, the user's ChatGPT sheets on magenta, 6 frames in a row each, soft "realistic" smoke):
#   6-cloud.png   E Toxic Vial: the vial lands, shatters, the cloud billows, biggest (frame 3), thins, last wisps  -> vex-cloud.webp
#   7-mistfx.png  R Antidote Mist: the vial shatters, flash, the green-gold ring rolls out with + sparkles, fades      -> vex-mist.webp
#   8-pop.png     Chain Reaction puff / the Catalyst pops: a toxic bubble swells, pops, splash ring, puddle           -> vex-pop.webp
# Same method as Sienna's (tools/extract-sienna-fx.py): frames cut along the emptiest lines, the magenta "unmixed" (soft see-through edges),
# then any purple left in the thin smoke becomes a pale toxic green (no pink / purple in the art). Every frame sits on a shared GROUND point.
import os, importlib.util
import numpy as np
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('sfx', os.path.join(here, 'extract-sienna-fx.py'))
src = open(os.path.join(here, 'extract-sienna-fx.py')).read().split('# 1. Cryo grenade burst')[0]   # its helpers only (the file runs Sienna's cuts below that line)
G = {'__file__': os.path.join(here, 'extract-sienna-fx.py')}; exec(compile(src, 'extract-sienna-fx-helpers', 'exec'), G)
G['R'] = os.path.join(here, 'art', 'vex')
base_unmix = G['unmix']
def unmix_green(rgb):
    out = base_unmix(rgb); F = out[..., :3]; r, g, b = F[..., 0], F[..., 1], F[..., 2]
    t = np.clip((np.minimum(r, b) - g + 6) / 30, 0, 1)   # purplish (red and blue above green): pull it to a pale toxic green of the same brightness
    t = np.maximum(t, np.clip((r - g - 8) / 25, 0, 1) * np.clip((b - g * .55) / 30, 0, 1))   # and pinkish-beige haze too (gold / yellow have little blue: kept)
    L = (r + g + b) / 3; tgt = np.dstack([L * .78, np.minimum(255, L * 1.12), L * .5])
    out[..., :3] = F * (1 - t[..., None]) + tgt * t[..., None]
    return out
G['unmix'] = unmix_green
frames, atlas, box = G['frames'], G['atlas'], G['box']
def grounds(fr, up=.11):   # each frame's ground point: the middle of its solid bottom band, a bit above the very bottom (the puddle is a flat oval)
    out = []
    for f, (x0, y0) in fr:
        bx0, bx1, by0, by1 = box(f, 40); m = f[..., 3] > 40; ys, xs = np.where(m); sel = ys > by1 - max(10, (by1 - by0) * .15)
        out.append((x0 + xs[sel].mean(), y0 + by1 - (bx1 - bx0) * up))
    return out
res = {}
for name, out, want, key in (('6-cloud.png', 'vex-cloud.webp', 230, 3), ('7-mistfx.png', 'vex-mist.webp', 330, 3), ('8-pop.png', 'vex-pop.webp', 150, 3)):
    fr = frames(name, 6); bx0, bx1, _, _ = box(fr[key][0], 40); sc = want / (bx1 - bx0)   # the key frame's solid width = `want` px in game
    res[out] = atlas(out, fr, grounds(fr), sc)
print('client VEXFX:', {k.split('-')[1].split('.')[0]: dict(zip(('cw', 'ch', 'gx', 'gy'), v)) for k, v in res.items()})
