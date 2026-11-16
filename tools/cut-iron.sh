#!/bin/sh
# IRON (Nov 16; replaced Briggs, same skills, class id "juggernaut") sprite atlas + lobby / face / cards / boomerang.
# Art: tools/art/iron/v3 (the chibi military Iron, prompts tools/art/iron/PROMPTS-V3.md). 54px tall like the others (user: "same size as Juno"),
# the normal 112 x 88 cell. No bat / axe sheets: the client uses his knife block for them.
# Quality (Nov 16, user: detailed art looks choppy this small): SMOOTH=1 (two bilateral passes on the big art: camo / scratches -> flat areas),
# SHARPEN 60, a bit more colour (ENHANCE 1.18 sat). (Was: TWOSTEP + SHARPEN 110, which kept every speck.)
# Blocks: shotgun, knife, the Q "slam" cast, the E "throw" (pull the boomerang off his shield, wind-up, fling, follow-through), the R "fists"
# moveset (gauntlets: guard, walk x3, jab, haymaker) and the R "power" pose. Every sheet has 5 directions: the left side is mirrored.
# Then the lobby art / face: python3 tools/extract-heroes.py; python3 tools/extract-faces.py tools/art/faces (both redo every class).
B=tools/art/iron/v3/prep
python3 tools/prep-iron.py
SPRITE_H=${SPRITE_H:-54} SMOOTH=1 SHARPEN=${SHARPEN:-60} ENHANCE=${ENHANCE:-1.18,1.08,1.04,0} python3 tools/extract-directions.py juggernaut \
  shotgun=$B/1-shotgun.png%229x229 knife=$B/2-knife.png%229x229 \
  slam=$B/5-slam.png!4^3%280.5x280.4 throw=$B/6-throw.png!4%280.5x280.4 fists=$B/7-gauntlets.png%229x229 power=$B/8-power.png!4%280.5x280.4
python3 tools/finish-briggs.py
python3 tools/extract-briggs-wall.py
