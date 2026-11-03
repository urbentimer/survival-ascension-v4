# Survival Ascension: ChatGPT art prompts (2D pixel horror)

Direction: 2D pixel art matching the survivor character sheet (arcade run-and-gun style), scary/grotesque horror tone. 3D later.

## Status
- Done and in game: survivor portraits + side-view sprites (8), zombies (5 types, side view), structures/tower/generator/loot (12), item/hotbar icons (18; tools/extract-icons.py), map pieces (16; tools/extract-map.py).
- Marcus (Assault) done: gun 8 directions, knife 8 directions, bat 5 directions, fire axe 5 directions (left side mirrored). Katana still uses the knife frames.
- Zombies 8-direction (run/walk cycle): Runner done. Next: Brute, Spitter, Mutant (then Walker). Attacks and dead bodies still use the side-view sheet.
- Fire axe has a heavy swing: hold click 1s, release.
- Next: 8-direction zombies (above); one sheet per weapon for the other 7 survivors (gun + knife first); bosses; effects.
- Saved for the very end: katana sheets, and bat/axe sheets for the other survivors (prompt 8).
- NEW (Nov 2026): lobby splash art, see section 9 (background + one hero image per survivor).
- NEW (Nov 3): Astra redesign from concept boards, see section 10 (boards saved in tools/art/astra2).

## Rules for every prompt (so Claude can cut the art out cleanly)
- Attach the survivor character sheet as the style reference every time.
- Flat solid magenta background (#FF00FF), no gradient, no texture, no shadows on the background. (Pink-haired characters like Sofea: use flat green #00FF00 instead.)
- No text, labels, headers, name banners, arrows, borders or UI panels. (Small direction labels in a column on the far left are OK; Claude crops them off.)
- Strict grid, at least 40px empty space between frames (including between rows), feet on the same baseline per row.
- ONE WEAPON / ONE ZOMBIE PER IMAGE. Don't ask for a "master sheet" with everything in one image: the frames come out too small.
- If ChatGPT adds text, a dark background, or cramps frames: ask it to redo with "flat magenta background, no text, more space between frames".

## 0. Survivor direction sheets (one image per weapon)
Template (swap the name, role and weapon):
"Using the attached character sheet as the exact style reference, create a sprite sheet for ONLY the character [NAME] ([ROLE]) holding [WEAPON]: same face, hair, clothes, gear and weapon as in the reference, same pixel size and chunky black outlines. Top-down 3/4 view game, camera looks slightly down at the character.
Layout: 8 rows x 6 columns, all frames the same scale, feet on the same baseline within each row, at least 40px of empty space between every frame and between rows.
Rows (direction faced): 1 DOWN (facing camera), 2 DOWN-RIGHT, 3 RIGHT (side view), 4 UP-RIGHT, 5 UP (back to camera), 6 UP-LEFT, 7 LEFT, 8 DOWN-LEFT.
Columns: IDLE, WALK 1, WALK 2, WALK 3, ATTACK 1, ATTACK 2. For a gun: SHOOT 1, SHOOT 2 with a small muzzle flash. For the knife: stab, then slash with a small white slash arc. In every row the weapon and attack point in that row's direction.
Background: one flat solid pure magenta colour (#FF00FF), no gradient, no shadows. No text, no labels, no headers, no name banner, no arrows, no borders, no UI panels."
(5 rows, DOWN to UP only, also works: the game mirrors the right side for the left.)
Done: Marcus (Assault). To do: Briggs (Juggernaut, minigun), Elena (Medic, medkit launcher), Viktor (Engineer, tripod turret gun), Raven (Scout, rifle), Dante (Demolitionist, rocket launcher), Sienna (Sniper, sniper rifle), Hayes (Commander, rifle + radio).
Claude cuts each with: python3 tools/extract-directions.py <class> gun=<sheet> knife=<sheet> [bat=<sheet>] [axe=<sheet>] [katana=<sheet>]

## 1. Zombies
Side view (5 rows x 6 cols: WALK 1-3, ATTACK 1-2, DEAD) - done for all 5. Walker (office worker), Runner (tracksuit sprinter), Brute (bloated construction worker, 2x wide), Spitter (glowing green throat sacs, spits acid), Mutant (lab coat, extra deformed arm, purple-pink flesh). Grotesque, exaggerated cartoon proportions, glowing yellow-green eyes.

### 1b. 8-direction zombie run sheets (one image per zombie) - Runner done
The Runner sheet that worked: 8 rows x 6 run frames, rows top to bottom U, UR, R, DR, D, DL, L, UL (labels on the far left are fine).
"Using the attached zombie as the exact style reference, create an 8-direction sprite sheet of ONLY the [ZOMBIE] for a top-down 3/4 view game. 8 rows x 6 columns, same scale in every frame, feet on the same baseline in each row, clear empty space between frames and rows.
Rows (direction the zombie moves, top to bottom): UP (back to camera), UP-RIGHT, RIGHT, DOWN-RIGHT, DOWN (facing camera), DOWN-LEFT, LEFT, UP-LEFT.
Columns: a 6-frame walk/run cycle.
Flat solid magenta background (#FF00FF), no shadows. No text except small direction labels in a column on the far left."
Per zombie: Brute = slow heavy stomp, huge and wide; Spitter = hunched shuffle, throat sacs glowing; Mutant = fast lurching gallop with the extra arm.
Optional later: 2 attack frames per direction (lets attacks face 8 ways too).
Claude cuts each with: python3 tools/extract-zombie-dirs.py <kind> <sheet>#<crop>  (rows=... if the order differs)

## 2. Map pieces (4 x 4) - done
Row 1: asphalt, sidewalk, grass/dirt, concrete plaza tiles. Row 2: wrecked car, burnt-out car, overturned bus, police car. Row 3: ruined building, collapsed building, streetlight, dumpster. Row 4: blood stain, manhole, rubble pile, dead tree.
In game: roads = asphalt, lots = grass/dirt, sidewalks + tower plaza = concrete; same map for everyone (made on the server); street lights glow. Buildings, wrecks, trees, poles etc. are SOLID: they block walking and bullets.
Possible extra set later: more building types (house, gas station, shop with sign), fences/walls, barrels, crashed helicopter, sandbag checkpoint, ammo cache.

## 3. Structures (3 x 4 grid, top-down 3/4) - done
Row 1: radio tower, generator, wooden barricade, sandbag wall. Row 2: turret, landmine, electric fence, flame trap. Row 3: supply crate, medkit, ammo box, weapon case.

## 4. Bosses set 1 (4 x 4: WALK 1-2, ATTACK, DEAD; bosses ~2.5x survivor height)
The Butcher, Plague Brute, The Screamer, Abomination.

## 5. Bosses sets 2-3 + final
Set 2: Devourer, Stalker, Bone Crusher, Hive Mother. Set 3: Executioner, Colossus, Reaper, Undead King. Final: Apocalypse (multi-headed, glowing red core).

## 6. Icons (3 x 6 grid) - done
Knife, bat, fire axe, katana, pistol, SMG / rifle, shotgun, sniper, launcher, medkit, grenade / armour plate, scrap, electronics, explosives, fuel can, gold coins. (Grenade icon is ready for when grenades are added.) Claude cuts with: python3 tools/extract-icons.py <sheet>

## 7. Effects (4 x 4 grid)
Blood splats x4, green goo splats x4, explosion 4 frames, acid puddle + fire x2 + electric spark.

## 8. LAST: katana (Marcus), then bat / fire axe / katana for the other survivors (one image per weapon)
Same template as 0 (5 or 8 rows x 6 cols). Columns: IDLE, WALK 1-3, ATTACK 1 wind-up, ATTACK 2 hit + white motion arc; attacks point in each row's direction.
- Bat (nails, blood stains): two-handed; wind-up over the shoulder, wide horizontal swing.
- Fire axe (red, chipped): two-handed; raised overhead (this frame is also shown while charging the heavy swing), heavy downward chop.
- Katana (black handle, long thin blade): one-handed; drawn back at the hip, fast diagonal slash.
Until these exist, the game shows the knife frames for that melee weapon (damage/reach are the real weapon's).

## 9. Lobby splash art (character select screen) - NEW
The lobby uses these automatically once Claude drops them in as client/assets/hero/background.webp and client/assets/hero/<class>.webp. Until then it shows the drawn skyline and the in-game sprite at 5x.

### 9a. Background (1 image)
"Landscape image 1536x1024. Dark ruined military research outpost at dusk after a zombie apocalypse. Blood-red and orange sky, thick smoke, glowing embers, a tall radio tower silhouette on the right, broken fences and burning debris. Painterly game key art, dramatic lighting. The LEFT HALF and the BOTTOM THIRD must stay dark and simple (UI goes there). NO characters, NO text, NO logo, NO UI."

### 9b. Hero image, one per survivor (attach that survivor's portrait)
Survivors: Marcus (assault), Briggs (juggernaut), Sofea (operator), Viktor (engineer), Raven (scout), Dante (demolitionist), Sienna (sniper), Hayes (commander), Astra (dispatcher). Keep the framing identical for all 9.
"Portrait image 1024x1536. Hero splash art of THIS character (attached), same face, hair and outfit, painterly semi-realistic game art like the attached. Waist-up, body turned slightly to the left, holding their signature weapon, heroic pose, strong orange rim light. The top of the head sits about 8% from the top edge, and the body is cut at the hips by the bottom edge. Background: ONE flat solid colour #FF00FF (pure magenta), nothing else. Crisp clean outline: NO glow, haze, smoke or sparks around the character, and no pink or magenta anywhere on the character. No text."

### 9c. Face card, one per survivor (one chat for all, attach their hero image)
"Square image 1024x1024. Head-and-shoulders portrait of THIS character (attached): same face, hair, outfit and painterly game-art style. Face turned slightly to the left, eyes at the same height as the camera, serious confident expression. Orange rim light from the right, soft light on the face. The top of the head sits about 8% from the top edge, the chin is in the middle of the image, and the shoulders reach the bottom edge. Background: ONE flat solid colour #FF00FF (pure magenta), nothing else. Crisp clean outline: NO glow, smoke or sparks around the character, and no pink or magenta anywhere on the character. No text, no frame, no border."
Next ones: "Same style, same framing, same lighting and same size as the last one. Now this character (attached)."

### 9d. Making it move
- Free (in code now): slow drift/zoom, fog, flickering fire light, embers, hero breathing + mouse parallax.
- More depth: separate layers (background without the tower; foreground debris) = parallax.
- Real motion: turn a still into a 5s loop with an AI video tool (Higgsfield is connected in Claude) and play it as the background (costs credits + file size).

## 10. Astra redesign (from the user's concept boards, tools/art/astra2/ref-*.png)
Boards: ref-astra-rifle.png (MAIN look: idle/move/fire/grenade), ref-astra-radio.png (radio/signal/quick draw), ref-astra-bat.png (bat swipe), ref-police.png, ref-medic.png, ref-builder.png.
They are concept sheets (dark background, labels, tiny sprites, directions as columns): use them ONLY as the design reference. The game doesn't use grenade, quick draw, move-while-on-radio, hurt, death or spawn rows.

### 10a. Astra, first message (new chat, attach ALL 3 Astra boards)
"This is ASTRA from my zombie game. Use ONLY the character design from these 3 references (the RIFLE board is the main look): silver-white swept hair with dark roots, scar on the cheek, headset with boom mic, black tactical jacket with grey shoulder and sleeve panels, teal collar and teal trim lines, a heartbeat patch on the shoulder, black plate carrier with pouches and a radio on the chest, black gloves, dark cargo pants and boots. Weapons: black assault rifle with a red-dot sight, and a wooden baseball bat.
Same gritty, detailed pixel-art style and the same body proportions as the small sprites on the boards. IGNORE the layouts, labels, big paintings and dark backgrounds. For every image in this chat I'll ask for one sprite sheet; keep his look identical in all of them."

### 10b. Rifle sheet (rifle board)
"Sprite sheet of ONLY Astra with his rifle, top-down 3/4 view game, matching the IDLE, MOVE and FIRE poses from the rifle board. 8 rows x 6 columns.
Rows (direction he faces), top to bottom: DOWN, DOWN-RIGHT, RIGHT, UP-RIGHT, UP, UP-LEFT, LEFT, DOWN-LEFT.
Columns: IDLE, WALK 1, WALK 2, WALK 3, AIM, FIRE (small muzzle flash at the barrel). In every row the rifle points in that row's direction.
He fills about 85% of each cell's height, with 40px of empty space between all frames and rows. Feet on the same line in each row. Full detail in every frame.
Background: ONE flat solid colour #FF00FF (pure magenta), no shadows, no text, no labels, no grid lines, no dark panels."

### 10c. Radio call (radio board)
"Same rules, 8 rows x 4 columns, matching the RADIO and SIGNAL poses from the radio board: col 1 radio raised to his mouth, col 2 talking into it, col 3 pointing forward with his free hand to SIGNAL (rifle in the other hand), col 4 radio lowered, back to ready. Magenta #FF00FF background."

### 10d. Bat (bat board), knife, fire axe
Bat: "Same rules, 8 rows x 6 columns, Astra holding his baseball bat, matching the BAT SWIPE poses from the bat board: IDLE, WALK 1, WALK 2, WALK 3, WIND-UP (bat over the shoulder), SWING (wide swing with a white arc). Rifle slung on his back. Magenta #FF00FF background."
Knife: same, "a combat knife: STAB, then SLASH with a small white arc". Fire axe: "a red fire axe: RAISED OVERHEAD, then a heavy CHOP with a white arc".

### 10e. Police / medic / builder (one new chat each, attach that board)
First: "This is the [POLICE OFFICER / MEDIC / CONSTRUCTION BUILDER] from my zombie game. Use ONLY the character design from this reference (same face, outfit, gear and gritty pixel-art style as the small sprites). IGNORE the layout, the labels, the big painting and the dark background."
Then: "Sprite sheet of ONLY this character, top-down 3/4 view game. 8 rows x 6 columns. Rows: DOWN, DOWN-RIGHT, RIGHT, UP-RIGHT, UP, UP-LEFT, LEFT, DOWN-LEFT. Columns: IDLE, WALK 1, WALK 2, WALK 3, [ACTION 1], [ACTION 2]. Fills about 85% of each cell's height, with 40px of empty space between frames and rows, feet on the same line. Background: ONE flat solid colour #FF00FF, no shadows, no text, no labels, no grid lines."
Actions: Police = AIM, FIRE (muzzle flash). Medic = KNEEL with medkit open, HEAL (small green sparkle). Builder = HAMMER raised, HAMMER strike (small sparks).

### 10g. 8 REAL directions (paste into EVERY sheet prompt, after the rows line)
"IMPORTANT, 8 REAL DIRECTIONS: every row must show the character actually turned to face that direction, as seen from a top-down 3/4 camera. Never copy the same pose into another row:
- DOWN: facing the camera, face and chest visible.
- DOWN-RIGHT: 3/4 front view, turned to the right.
- RIGHT: full side profile facing right.
- UP-RIGHT: 3/4 back view, turned to the right; mostly back and shoulder visible, face hidden.
- UP: back to the camera, only the back of the head and the back of the vest.
- UP-LEFT: 3/4 back view, turned to the left.
- LEFT: full side profile facing left.
- DOWN-LEFT: 3/4 front view, turned to the left.
The weapon, muzzle flash and swing arc point the way that row faces. On the UP rows the rifle points up/away from the camera."
If it repeats: "Rows 4-6 are wrong: he's still facing the camera. Redo them so the UP-RIGHT, UP and UP-LEFT rows show his BACK, and the LEFT rows face left."
Fallback: 5 rows only (DOWN, DOWN-RIGHT, RIGHT, UP-RIGHT, UP); the game mirrors the right side for the left.

### 10f. Astra lobby art
Hero image (9b) + face card (9c), attaching the big painting from the RIFLE board.
Claude cuts: extract-directions.py dispatcher gun= knife= bat= axe= radio=...!4, same for astra-police / astra-doctor / astra-worker; extract-heroes.py; extract-faces.py.
