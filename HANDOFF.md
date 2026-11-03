# Survival Ascension — handoff (keep updated after every change)

Last updated: 2026-11-03 (latest commit: "Butcher hook much faster")

## Where things are
- Live game: Colyseus server on Render, client on Netlify, repo **urbentimer/survival-ascension-v4** (GitHub). Live = OLD; nothing from Viktor's rework onward is pushed yet.
- Claude's workspace copy: `/home/claude/sa` (git, branch `master`, ~72 commits). Exists only in the chat session it was made in.
- Backups: `survival-ascension-code.zip` sent to the user (code + game art, no raw ChatGPT sheets, no git history).
- Solo preview (playable, single-file): https://claude.ai/artifact/Ww26yfzXU93kuQVvFreUsy
- Progress infographic: https://claude.ai/artifact/TbZ6oNk2DjaePnKAAc7Auo (out of date: before Viktor rework / Raven / Dante / Hivemind)
- Art prompts doc: project file `claude/chatgpt-art-prompts.md`

## How we work
- User designs; often says "dont code yet" → discuss only. Code when told ("u can code now", "code it", "lets go").
- Art from ChatGPT on a flat magenta (#FF00FF) background, one action/weapon per sheet; Claude cuts it with tools/extract-*.py.
- Every change: `node tools/test-room.mjs` (server tests, all must pass; "bots aim and shoot" test is randomly flaky) → `node tools/build-preview.mjs` → Playwright check → commit → publish preview artifact.
- Don't push to the live repo until the user asks. GitHub isn't linked to Claude yet (add_repo fails) — user needs to link GitHub in claude.ai Settings → Connectors.
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
- Others (Briggs juggernaut, Elena medic, Sienna sniper, Hayes commander): old side-view art, old simple skills, no ultimate yet.

## Zombies & bosses
- Runners only attack the tower; walker/brute/spitter/mutant hunt the nearest visible player (and Viktor's machines if closer).
- Brute slam stuns; spitter lobs acid puddles; mutant charged whip lunge.
- Every death now shows a body (server sends "zdead").
- **Boss waves** 4, 8, 12...: horde → intro card (all players ack) → boss + walkers. Wave 4 = **The Butcher** (armoured front, cleaver quake rings, hook every 10–15s at 2600 px/s with lead aim, axe deflect, enraged spin, +60% HP per extra player). Other bosses: placeholders, no art.
- **Mini boss: The Hivemind** on waves 2, 6, 10, 14...: arrives at 40s with a warning card; wave can't end until it dies. ~760 HP at wave 2 solo (scales with wave + players). Bite (close), slam (red zone, damage + 0.8s stun), jump at far players (320–760px), spawns walkers every 8s. Death: +40 gold each + 4 gold piles. No dedicated death sheet yet.

## Solo preview test panel (Esc menu)
Jump to wave, spawn 5 of each zombie, spawn Hivemind, boss intro now, boss to 25%, kill boss (also kills Hivemind), hook speed toggle, unlock ultimate. In solo, ultimates are always unlocked.

## To do / ideas parked
- Push to GitHub (needs GitHub linked) and deploy live when the user says.
- Hivemind death sheet; Raven's whirlwind spin sheet; Dante launcher version 2 sheet (saved, unused).
- Other survivors' 8-direction sheets + kits; other bosses' art and moves; walker 8-direction sheet.
- Boss loot (Butcher's Locker), night vision size choice, update infographic.
