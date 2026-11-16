#!/bin/sh
# SIENNA (Nov 16; the user's new chibi military sniper, class id "sniper") sprite atlas + effects + lobby / face / cards.
# Art: tools/art/sienna (prompts tools/art/sienna/PROMPTS.md). 57px tall like Iron (her on-screen bulk = Marcus's), but a WIDER cell (176 x 88,
# feet at 88,80; the client reads DIR8.sniper.cell): the Q perch frames have a long ice muzzle blast that has to fit when she aims left too.
# Quality like Iron: SMOOTH=1 (two bilateral passes before the shrink), SHARPEN 60, ENHANCE 1.18 saturation.
# Blocks: sniper (stand, walk x3, FIRE = col 4 with the flash, smoke), knife (stand, walk x3, wind-up, slash), the E "throw" (grenade in hand,
# wind-up, release, follow-through), the R "dash" (crouch, leap, land in an ice puff, stand: sized by col 3) and the Q "perch" (aim, FIRE, smoke;
# only her left / right / diagonal rows are used: aiming straight up / down on the tower uses the sniper block). Every sheet has 5 directions:
# the left side is mirrored. Then: walk stabiliser + lossless WebP, the effects (tools/extract-sienna-fx.py), lobby art and face.
B=tools/art/sienna/prep
python3 tools/prep-sienna.py
CELL=176,88,88,80 SPRITE_H=${SPRITE_H:-57} SMOOTH=1 SHARPEN=${SHARPEN:-60} ENHANCE=${ENHANCE:-1.18,1.08,1.04,0} python3 tools/extract-directions.py sniper \
  sniper=$B/1-sniper.png%229x229 knife=$B/2-knife.png%229x229 \
  throw=$B/3-throw.png!4%280.5x280.4 dash=$B/4-dash.png!4^3%280.5x280.4 perch=$B/5-perch.png!3%512x204.8
python3 tools/finish-briggs.py sniper sniper knife
python3 tools/extract-sienna-fx.py
python3 tools/extract-heroes.py tools/art/hero && python3 tools/extract-faces.py tools/art/faces
rm -f client/assets/hero/commander.webp client/assets/hero/medic.webp client/assets/portraits/commander.webp client/assets/portraits/medic.webp
