#!/bin/sh
# VEX (Nov 17; the user's chibi toxicologist, class id "toxicologist") sprite atlas + effects + lobby / face / cards.
# Art: tools/art/vex (prompts tools/art/vex/PROMPTS.md). Sized like Sienna (57px tall, the same wide 176 x 88 cell: his dart flies off the muzzle).
# Blocks: dartrifle (stand, walk x3, FIRE = col 4 with the green puff, recoil), knife (stand, walk x3, wind-up, slash), the E "throw" (vial in hand,
# wind-up, release, follow-through), the R "mist" (pulls the gold vial, raises it, smashes it crouching, back up in sparkles) and the Q "pandemic"
# (pulls the gas mask on, mask on, walk x3, FIRE with the mask). 5 directions each, the left side mirrored. Then the effects (extract-vex-fx.py).
B=tools/art/vex
python3 tools/prep-vex.py
CELL=176,88,88,80 SPRITE_H=${SPRITE_H:-57} SMOOTH=1 SHARPEN=${SHARPEN:-60} ENHANCE=${ENHANCE:-1.18,1.08,1.04,0} python3 tools/extract-directions.py toxicologist \
  dartrifle=$B/1-rifle.png%229x229 knife=$B/2-knife.png%229x229 throw=$B/3-throw.png!4%280.5x280.4 mist=$B/4-mist.png!4%280.5x280.4 pandemic=$B/5-pandemic.png%229x229
python3 tools/finish-briggs.py toxicologist dartrifle knife pandemic
python3 tools/extract-vex-fx.py
python3 tools/extract-heroes.py tools/art/hero && python3 tools/extract-faces.py tools/art/faces
rm -f client/assets/hero/commander.webp client/assets/hero/medic.webp client/assets/portraits/commander.webp client/assets/portraits/medic.webp
