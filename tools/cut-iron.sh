#!/bin/sh
# IRON (Nov 16; replaced Briggs, same skills, class id "juggernaut") sprite atlas + lobby / face / cards / boomerang.
# Art: tools/art/iron (design.png + the sheets from tools/art/iron/PROMPTS-FULL.md). 76px tall (SPRITE_H; Nov 16, user: "he looks too tiny" at 62;
# everyone else ~54) in his own bigger cell (CELL 136 x 108, anchor 68, feet 100: the client's DIR8.juggernaut.cell must match).
# Quality: a little colour pop (ENHANCE), the two-step shrink (TWOSTEP: Lanczos to 2x + unsharp, box down), SHARPEN 110.
# Blocks: his 4 weapons, the Q "slam" cast, the E "throw" (pull the boomerang off his shield, wind-up, fling, follow-through), the R "fists"
# moveset (gauntlets: guard, walk x3, jab, haymaker) and the R "power" pose. Every sheet has 5 directions: the left side is mirrored.
# Then the lobby art / face: python3 tools/extract-heroes.py; python3 tools/extract-faces.py tools/art/faces (both redo every class).
B=tools/art/iron/prep
python3 tools/prep-iron.py
CELL=136,108,68,100 SPRITE_H=${SPRITE_H:-76} SHARPEN=${SHARPEN:-110} TWOSTEP=1 ENHANCE=${ENHANCE:-1.12,1.1,1.06,0} python3 tools/extract-directions.py juggernaut \
  shotgun=$B/1-shotgun.png%229x229 knife=$B/2-knife.png%229x229 bat=$B/3-bat.png%229x229 axe=$B/4-axe.png%229x229 \
  slam=$B/5-slam.png!4^3%280.5x280.4 throw=$B/6-throw.png!4%280.5x280.4 fists=$B/7-gauntlets.png%229x229 power=$B/8-power.png!4%280.5x280.4
python3 tools/finish-briggs.py
python3 tools/extract-briggs-wall.py
