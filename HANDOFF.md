# Survival Ascension — handoff (keep updated after every change)

Last updated: 2026-11-03 (latest commit: "Sofea sprites brightened")

## Where things are
- Live game: Colyseus server on Render, client on Netlify, repo **urbentimer/survival-ascension-v4** (GitHub). Live = `main` (Viktor rework, Raven, Dante, Hivemind went live 2026-11-03). Server: wss://survival-ascension-sg.onrender.com (Render SINGAPORE, service srv-dbkkpufb9u1s73fmj99g; client/config.js). Old Virginia service srv-dbjm617b9u1s73eejs20 (survival-ascension-v4) is no longer used. Players open https://lucent-lamington-40beed.netlify.app (auto-deploys from main; Render auto-deploy is on too).
- Claude's workspace copy: `/home/claude/sa` (git, branch `master`, ~72 commits). Exists only in the chat session it was made in.
- **Backup on GitHub: branch `claude/game-backup`** of urbentimer/survival-ascension-v4 (everything except raw ChatGPT sheets in tools/art). `main` = what's live; don't touch it until the user says to go live.
- Push routine: work in `/home/claude/sa`, then copy the tree (minus .git, node_modules, tools/dist, tools/art) into the clone `/home/claude/survival-ascension-v4` on `claude/game-backup`, commit, push. A new chat: clone the repo, check out `claude/game-backup`.
- Older backup: `survival-ascension-code.zip` sent to the user.
- Solo preview (playable, single-file): https://claude.ai/artifact/Ww26yfzXU93kuQVvFreUsy
- Progress infographic: https://claude.ai/artifact/TbZ6oNk2DjaePnKAAc7Auo (v4, updated 2026-11-03: live, Viktor/Raven/Dante, Hivemind)
- Art prompts doc: project file `claude/chatgpt-art-prompts.md`

- Connectors linked: Render (workspace tea-dbjk0fk9v7es73ab4tp0, service srv-dbkkpufb9u1s73fmj99g Singapore) and Netlify (site 3d671c3a-862a-48d6-8db6-42e536b9c8a8). Use them to check deploys/logs instead of asking for screenshots.
- Free Render server sleeps after ~15 min idle; the client retries create/join for ~90s ("Waking up the server…").

## How we work
- User designs; often says "dont code yet" → discuss only. Code when told ("u can code now", "code it", "lets go").
- Art from ChatGPT on a flat magenta (#FF00FF) background, one action/weapon per sheet; Claude cuts it with tools/extract-*.py.
- Every change: `node tools/test-room.mjs` (server tests, all must pass; "bots aim and shoot" test is randomly flaky), `node tools/sim-waves.mjs 9` (bots of every class play 9 waves fast: no crash / NaN) → `node tools/build-preview.mjs` → Playwright check → commit → publish preview artifact.
- **LIVE MODE (from 2026-11-03): every change goes to `main`** (user wants friends to try every change). Render (server, rootDir server) and Netlify (client folder) deploy from `main`. Keep `claude/game-backup` = `main`.
- Sprite PNGs are palette-quantized (256 colours) to keep the preview under 16 MB (now ~13.5 MB).

## Controls / HUD
- WASD move, Space dash, mouse aim/click attack, 1 melee, 2 primary, 3 secondary, 4 medkit, E skill, Q ultimate (unlocks at 100 non-boss kills), T equipment, R reload.
- Hotbar order: Q card, E card, 1, 2, 3, 4. Skill cards: locked = dark + padlock; cooldown = dark clock wipe; active = gold bar.
- E and Q aim at the mouse (client sends angle + distance).

## Characters
- **Marcus (assault)**: gun/knife/bat/axe art. Fire axe: hold 1s heavy swing; only the axe can deflect the Butcher's hook.
- **Viktor (engineer)**: E = robot wheel (hold E, pick, release; tap = last kind). 3 charges, 3s between summons, +1 charge every 25s, max 3 robots (4th replaces oldest).
  - Assault robot: hunts zombies anywhere, speed 85, 5 dmg/hit.
  - Hunter robot: stays within 300px of its spot, only shoots inside a 180° half-circle it faces (no marker drawn), 7 dmg / 2.2s, 90 HP.
  - Support robot: visits each survivor ONCE (5s heal + 15% dmg buff, heal-ring art), breaks after 3 visits or when nobody is left.
  - Q = Heavy Turret: lasts 40s, range 680, fires a 3-tracer burst every 0.52s (16 dmg) synced to the turret sound (assets/sfx/turret-shoot.mp3); 60s cooldown after it ends/dies.
- **Raven (scout)**: katana only at start (27 dmg, hits 3, 96 reach), can buy guns. Katana tiers every 50 katana kills (Honed Edge, Wide Cut, Bleed, Swift Blade, Ghost Steel).
  - E Shadow Pass: 350px dash slashing the path → invisible up to 20s (zombies ignore) → attack or timeout → katana on fire 5s; burns stack (3s, up to 5) → 25s cooldown.
  - Q Blade Storm: 10s spin hitting everything around her, 60s cooldown.
- **Dante (demolitionist)**: starts with rocket launcher + pistol. Rockets fly straight to the click point (or max range/wall) and explode (all launchers work this way). Art: launcher, rifle, shotgun, knife, bat, axe; other guns use rifle frames.
  - E Sky Barrage: 3 rockets up one by one (0.15s apart), land at random spots within 80px of the mouse, 90 dmg each, 8s cooldown.
  - Q Demo Ripple: Q places crate (arms 1s), Q again detonates (auto after 30s or if Dante goes down): 300 core blast, then scattered grenades 4 / 8 / 16 (every 3rd of the last ring big). 60s cooldown. Bosses take half.
  - Rockets/grenades leave scorch craters (hot → cool, gone after 7s).
- **Sofea (operator)** — made by the user's cousin with the character kit (source art in tools/art/sofea, cut by tools/extract-sofea.py + `PINK_HAIR=1 SPRITE_H=60 ENHANCE=1.25,1.2,1.12,1 extract-directions.py operator gun=...%148 knife= bat= axe= radio=...!4` (her source art is realistic/slim and dark, unlike the chunky chibi survivors: brightened, sharpened and 10% taller to read in game; the real fix is chibi-style redraws)). 115 HP, speed 180, rifle + pistol + knife; art for knife/bat/axe/rifle + radio call.
  - E Steel Convoy: 0.8s radio call, tank arrives (needs a clear spot within 160px, else no cooldown used), she drives it 30s. WASD drives (140 px/s), turret follows the mouse, click = cannon shell every 1.5s (65 → 30 at the 110px edge, flies 600 px/s to the click). Driving into zombies runs them over (55, 10 on bosses, once per 0.75s each, 30px push). Takes 35% less damage. Then she gets out beside it (0.75s protection) and E cools down 30s.
  - Q Sky Reign: radio call, helicopter, flies 30s at 230 px/s over zombies (ground zombies can't reach her). Click = 2 rockets every 1.5s (65 → 25 at 100px, 700 px/s, range 800). 60s cooldown after landing.
  - While riding: no dash / melee / medkit / build / repair / revive. Vehicles: state.vehicles (VehicleState, id = her sessionId, phase call/ride). Vehicle damage grows with the wave like Dante's skills. Everyone gets out when the wave ends.
- Character select: 5 per row (9 survivors + a "Next survivor · coming soon" card); E/Q names shown on the reworked survivors' cards.
- Briggs (juggernaut) kit planned, PAUSED until the user can make art again: E Iron Bastion (15s steel-and-gold dome, invulnerable, can attack, 30% slower, only him, zombies pile on, shatters with knockback, 45s cd), Q War Cry (taunt ~350px, 50% less damage 10s, teammates +25% dmg, 60s cd), shotgun start. ChatGPT prompts were written in chat (10 sheets).
- Others (Briggs juggernaut, Elena medic, Sienna sniper, Hayes commander): old side-view art, old simple skills, no ultimate yet.

## Downed / spectating
- When you're down or bled out there is no dark screen: a small bar shows the bleed-out timer and the camera follows a living teammate (bots too). Space / ← → / click switches who you watch. Night light follows the watched teammate.

## Zombies & bosses
- Runners only attack the tower; walker/brute/spitter/mutant hunt the nearest visible player (and Viktor's machines if closer).
- Brute slam stuns; spitter lobs acid puddles; mutant charged whip lunge.
- Every death now shows a body (server sends "zdead").
- **Boss waves** 4, 8, 12...: horde → intro card (all players ack) → boss + walkers. Wave 4 = **The Butcher** (armoured front, cleaver quake rings, hook every 10–15s at 2600 px/s with lead aim, axe deflect, enraged spin, +60% HP per extra player). Other bosses: placeholders, no art.
- **Mini boss: The Hivemind** on waves 2, 6, 10, 14...: arrives at 40s with a warning card; wave can't end until it dies. ~760 HP at wave 2 solo (scales with wave + players). Bite (close), slam (red zone, damage + 0.8s stun), jump at far players (320–760px), spawns walkers every 8s. Death: +40 gold each + 4 gold piles. No dedicated death sheet yet.

## Online host buttons (Esc menu)
- **Test: ultimates with no cooldown** (ON by default while testing): ultimates unlocked at once and ready again as soon as they end. Turn OFF for real games (state.noCd).
- **Skip to Butcher fight (host)**: host only, online rooms. Jumps to wave 4, clears zombies, revives everyone, goes to the Butcher intro.

## Solo preview test panel (Esc menu)
Jump to wave, spawn 5 of each zombie, spawn Hivemind, boss intro now, boss to 25%, kill boss (also kills Hivemind), hook speed toggle, unlock ultimate. In solo, ultimates are always unlocked.

## To do / ideas parked
- Hivemind death sheet; Raven's whirlwind spin sheet; Dante launcher version 2 sheet (saved, unused).
- Other survivors' 8-direction sheets + kits; other bosses' art and moves; walker 8-direction sheet.
- Boss loot (Butcher's Locker), night vision size choice.
