#!/bin/sh
# Briggs (juggernaut) sprite atlas. Nov 16: the REMAKE (a new person, same skills: tools/art/briggs/REMAKE-PROMPTS.md, art in
# tools/art/briggs/remake). Cut 62px tall (SPRITE_H; everyone else is 54: he's the stocky tank). Quality (Nov 16, user: "sharpen his graphics"):
# a little colour pop (ENHANCE sat/contrast/brightness), the two-step shrink (TWOSTEP: Lanczos to 2x + unsharp, then box down), SHARPEN 110.
# Blocks: his 4 weapons (the axe uses the bat sheet until it has its own), the Q "slam" cast, the E "throw" (Steel Boomerang: pull it from
# behind the shield, wind-up, fling, follow-through), the R "fists" moveset (gauntlets: guard, walk x3, jab, haymaker) and the R "power" pose.
# Every sheet has 5 directions (DOWN, DOWN-RIGHT, RIGHT, UP-RIGHT, UP): the left side is mirrored. "^3" = size by column 3 (a standing frame).
# Also writes the lobby art / face sources (then: python3 tools/extract-heroes.py; python3 tools/extract-faces.py tools/art/faces) and the 4 cards.
B=tools/art/briggs/remake/prep
python3 tools/prep-briggs-remake.py
SPRITE_H=${SPRITE_H:-62} SHARPEN=${SHARPEN:-110} TWOSTEP=1 ENHANCE=${ENHANCE:-1.12,1.1,1.06,0} python3 tools/extract-directions.py juggernaut shotgun=$B/D-shotgun.png%229x229 knife=$B/E-knife.png%229x229 \
  bat=$B/F-bat.png%229x229 axe=$B/F-bat.png%229x229 slam=$B/H-slam.png!4^3%192x256 throw=$B/I-throw.png!4%280.5x280.4 \
  fists=$B/J-gauntlets.png%229x229 power=$B/K-power.png!4%280.5x280.4
python3 tools/finish-briggs.py
python3 tools/extract-briggs-wall.py
