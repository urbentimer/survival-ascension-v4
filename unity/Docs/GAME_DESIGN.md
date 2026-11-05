# Survival Ascension: game design reference (for the 3D version)

Everything here comes from the live browser game (Nov 2026). The server already does all the rules below, so the Unity version only has to SHOW them and send the controls. Numbers are in the server's units: 1 Unity unit = 30 px.

## Heroes

### MARCUS (ASSAULT)

Balanced frontline fighter. Fast rifle fire and a damage rush when the horde closes in.

- HP 110, damage 17, speed 190 px/s, defence 0
- Starting gear: rifle, pistol, knife
- **E: Combat Rush** (25s cooldown): +50% damage for 6 seconds.

### BRIGGS (JUGGERNAUT)

Shotgun tank who thrives in the thick of combat, protecting the team and crushing hordes.

- HP 160, damage 14, speed 150 px/s, defence 5
- Starting gear: shotgun, pistol, knife
- **E: Iron Bastion** (30s cooldown): A steel dome for 15s: nothing gets through. It shatters outward and knocks zombies back.
- **Q: War Cry** (60s cooldown): Taunts every zombie within 350px, halves damage taken and boosts teammates' damage +25%. Shotgun spam, no ammo, for 10s.
- **PASSIVE: Forceful Blast**: Shotgun shots knock back every zombie, bosses too.

### SOFEA (OPERATOR)

Heavy-metal specialist. Calls in her own tank and a gunship, and pilots the Crimson Aegis mecha straight into the horde.

- HP 115, damage 15, speed 180 px/s, defence 0
- Starting gear: rifle, pistol, knife
- **E: Steel Convoy** (30s cooldown): Drive a tank for 30s: cannon on click, run zombies over, takes much less damage.
- **Q: Sky Reign** (60s cooldown): Fly a gunship for 30s over everything: its machine gun shreds every zombie in a 90° cone where you aim. Zombies can't reach you.
- **R: Crimson Aegis** (100s cooldown): Transform into the Crimson Aegis mecha for 30s. Hold click: flame jet (190px, 60° cone). Right click: a lightsaber sweep (120px, 80 dmg). R again to step out.

### VIKTOR (ENGINEER)

Builds his own army: three kinds of combat robot and a heavy minigun turret.

- HP 110, damage 15, speed 175 px/s, defence 1
- Starting gear: rifle, pistol, knife
- **E: Robot Squad** (25s cooldown): Deploy an assault, support or hunter robot. 3 charges, +1 every 25s.
- **Q: Heavy Turret** (60s cooldown): A heavy minigun turret that shreds everything for 40s.

### RAVEN (SCOUT)

Katana only. Dashes through the horde, vanishes, then strikes with a burning blade.

- HP 90, damage 15, speed 225 px/s, defence 0
- Starting gear: katana
- **E: Shadow Pass** (25s cooldown): Dash through zombies and vanish. Your next attack ignites the katana.
- **Q: Blade Storm** (60s cooldown): A whirlwind of katana slashes around you.

### DANTE (DEMOLITIONIST)

If it's standing, it's a target. Rockets land wherever you click.

- HP 105, damage 18, speed 175 px/s, defence 0
- Starting gear: launcher, pistol, knife
- **E: Sky Barrage** (8s cooldown): 3 rockets up, 3 down around your mouse.
- **Q: Demo Ripple** (60s cooldown): Plant the crate, press Q again: rings of grenades.

### SIENNA (SNIPER)

Precision long-range damage. Picks off the biggest threats first.

- HP 95, damage 21, speed 165 px/s, defence 0
- Starting gear: rifle, pistol, knife
- **E: Dead Eye** (24s cooldown): A huge shot at the nearest zombie in sight.

### ASTRA (EMERGENCY CMDR)

Calm field leader who always has backup on the way: medics, police and a safehouse.

- HP 120, damage 15, speed 180 px/s, defence 0
- Starting gear: rifle, pistol, knife
- **E: Emergency Medics** (30s cooldown): A medic for 20s: heals you first, then each injured ally once (5 HP/s, up to 6s each), then follows you.
- **Q: Police Backup** (60s cooldown): An armed officer for every living teammate: each one guards his player for 30s.
- **R: Safehouse** (90s cooldown): Workers build 4 walls around you in 5s (you can't be hurt meanwhile), then stay to repair (6 hits break it). Zombies can't get in for 45s.

## Zombies and bosses (the server spawns and runs them; the 3D version needs a model for each)

| Kind | Notes |
|---|---|
| walker | slow, the most common |
| runner | fast, weak |
| brute | big, slow, hits hard, ground slam |
| spitter | keeps its distance, spits acid puddles |
| mutant | lunges with a whip attack |
| THE HIVEMIND | mini boss on waves 2, 6, 10...: bites, slams, leaps, tears zombies out of its body |
| THE BUTCHER | boss (wave 4 and later boss waves): meat cleaver chops, chain hook pull, spin, enrage |

Waves: 90 seconds each, a boss wave every 4th wave, 50 waves. Defend the RADIO TOWER (10,000 HP) in the middle; the generator sits beside it.

## Maps

- 3 city sites (same art style, different random layouts from a seed): roads, buildings, ruins, cars, buses, police cars, dumpsters, rubble, trees, street lights.
- FALLEN DYNASTY (China, burning plaza): one painted picture, 1672 x 941 px. Reference: Reference/maps/fallen-dynasty.png.

## 3D art checklist (what to make or buy, roughly in order)

1. **One hero** to start (suggest Marcus or Sofea): rigged humanoid + idle, run, shoot, melee, dash, downed. Mixamo has free animations for any humanoid rig.
2. **Zombies**: walker, runner, brute (+ slam), spitter, mutant. A free zombie pack from the Asset Store covers most of these.
3. **Radio tower + generator**, then city props: building, ruin, car, burnt car, bus, police car, dumpster, rubble, tree, street light.
4. **The other heroes**, their skill props (Sofea's tank, helicopter, Crimson Aegis mecha; Viktor's robots and turret; Astra's medic / police / workers / safehouse...).
5. **Bosses**: the Hivemind, the Butcher.
6. **Effects**: the Vefects fire pack (import it straight into Unity: it's made for URP), muzzle flashes, blood, heal (Reference/effects), dash trails (Reference/effects).

Reference/ has every hero's art, face card and Sofea's mecha sheets: use them as references for modellers or for AI image-to-3D tools.
