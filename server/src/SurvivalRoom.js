import { Room } from "@colyseus/core";
import { MapSchema } from "@colyseus/schema";
import { GameState, PlayerState, ZombieState, StructureState, LootState, PuddleState, RobotState, VehicleState } from "./schema.js";
import { buildMapLayout, buildDynastyLayout, buildWhiteoutLayout, buildRefineryLayout, buildCarnivalLayout, buildMineLayout, buildCrucibleLayout, KC_SPOT, mineTrack, mineCordon, MN_SPOT, coasterTrack, coasterAt, coasterSeat, COASTER, mapBoxes, statueBodyBoxes, trackNearest, packLayout, paintedOf, paintedLayout } from "./mapLayout.js";
import { log } from "./logbook.js";

// The world: about 9x the area of one screen. The camera follows each player around it.
const ARENA = { width: 3600, height: 2280 };
const SPAWN_RING = [850, 1150];   // zombies appear this far from the radio tower (out of view)
// Two kinds of zombie (z.role):
//  "tower"  - RUNNERS: sprint for the radio tower and never attack survivors.
//  "hunter" - walkers, brutes, spitters, mutants: always go after the nearest survivor (anywhere on the map);
//             only if every survivor is down do they head for the tower.
// Bosses (and the Hivemind) hunt survivors only.
const TOWER_KINDS = { runner: 1 };
// Brute GROUND SLAM: when a survivor is close, the brute stops, winds up (danger circle on the ground),
// then slams: damage + stun to every survivor inside the radius.
// Spitter ACID: lobs a glob at where the survivor stands (so it can be dodged). It lands as a big puddle that
// burns anyone standing in it for a few seconds. Puddles are ellipses (ry = r * 0.6) to match the 3/4 view.
const ACID = { minRange: 140, maxRange: 430, hold: 380, backOff: 170, speed: 330, cooldown: 2.6, splash: 34, radius: 85, life: 5, dpsMult: 1.4 };
// ---------- THE BUTCHER (wave 4 boss) ----------
// Tanky, hunts survivors only (never the tower). Armoured front: 50% less damage from the front, full from behind.
// CHOP: cleaver smash -> 3 ground shockwaves: red = damage, yellow = stun, blue = slow (bands, measured on the flat ground ellipse).
// HOOK: every 10-15s throws a meat hook at the furthest survivor in range; a hit drags them in, holds them 0.5s and he chops.
// ENRAGED (<30% HP): faster, hooks every 8-10s, and a whirlwind spin every ~8s.
const BUTCHER = {
  speed: 130, armour: 0.5, armourArc: 1.05,
  chop: { trigger: 150, windup: .7, comboWindup: .38, after: .65, cd: 2.6, offset: 55, rings: [95, 185, 275], ringDelay: .12, stun: 1.0, slow: 2.0 },
  hook: { range: 480, minRange: 170, aim: .5, lock: .08, speed: 2100, cd: [10, 15], enragedCd: [8, 10], first: 5, hitR: 34, pullSpeed: 640, hold: .55, dmg: 8 },
  spin: { every: 8, dur: 3, radius: 115, tick: .35, dmgMult: .35, speedMult: .8 },   // slower while spinning so you can run from it
  enrageAt: .3, enrageSpeed: 1.05,
};
// DEFLECT: only the FIRE AXE. Swing it toward the incoming hook as it arrives (tip within `reach` of you),
// or up to `window` seconds before it touches you -> the hook breaks and the Butcher staggers (armour down).
const DEFLECT = { window: .25, reach: 95, arc: 1.25, stagger: 1.5, heavyStagger: 2.5 };
// THE HIVEMIND: mini boss on the waves between the big boss waves (2, 6, 10, 14...). It crawls in partway through the wave;
// the wave only ends once it's dead. Bites up close, slams the ground (damage + stun), leaps at survivors far away,
// and keeps tearing zombies out of its body. Comes back tougher every time.
const HIVE = {
  hp: 700, speed: 46, radius: 44, dmg: 20, arriveAt: 40, gold: 40,
  bite:  { range: 120, windup: .45, total: .95, cd: 1.3, reach: 135, arc: 1.05, mult: 1.4 },
  slam:  { range: 200, windup: .55, total: 1.35, cd: 7, radius: 210, mult: 1.1, stun: .8, flat: .62 },
  jump:  { min: 320, max: 760, total: 1.2, up: .3, land: .9, cd: 9, radius: 150, mult: 1.25 },
  spawn: { every: 8, first: 5, max: 4 },
  alpha: { hp: 3.0, size: 1.55, dmg: 1.25, speed: 1.1, spawnEvery: 6, brood: [.66, .33], broodN: [1, 2] },   // (Nov 12) THE ALPHA HIVEMIND, Fallen Dynasty's boss (wave 8): a giant Hivemind that tears off normal Hiveminds at 66% and 33%
};
const isHiveWave = stage => stage % 4 === 2 && chapterOf(stage).boss !== "hivemind";   // (not just before the Alpha Hivemind's own boss wave)
// THE PYRE PRIEST: boss of wave 8 (user's design + art, Nov 6). A burning cultist swinging a giant censer on a chain.
// Hunts SURVIVORS only (never the tower, robots or turrets). Walks at 212 (only Raven, 225, outruns him; enraged 237).
//   LAMP STRIKE   his basic attack: up close, a quick smash with the burning lamp in front of him (a 120-degree arc, 150px), every 1.3s.
//   CENSER SWING   someone within 200px: 0.7s wind-up (spinning red ring = the range), then a full 360 spin: damage, knockback,
//                  sets them on fire. The dash dodge goes straight through it.
//   FIREWALK       every 16s, for 8s: every step leaves a burning patch (6s; 9s enraged); standing in it sets you on fire.
//   SERMON OF ASH  every 15s: kneels for 2.6s; 5 glowing circles land on / around the survivors and erupt into fire pillars
//                  1s later. While he kneels, hits from BEHIND him do double damage.
//   WHEEL OF FLAME every 75s (first at 12s): a burning cross around him - 4 lines of fire (12, 3, 6 and 9 o'clock, 620px long)
//                  that turn CLOCKWISE for 60s (a full turn every 18s, 2s warning first) and FOLLOW HIM as he hunts. Walk clockwise
//                  with them to stay clear; touching a line hurts and sets you on fire. It dies with him.
//   ON FIRE        players burn for 3s (re-lit while standing in fire): damage over time, armour applies, the dash dodge ignores it.
//   Enraged below 35%: faster, every cooldown x0.75, longer-lasting fire patches, bigger pillars.
const PYRE = {
  hp: 2400, speed: 212, radius: 64,   // radius 40 -> 64 (Nov 12: drawn 1.65x bigger, as tall as the pyramid door)   // speed: 230 -> 184 (-20%) -> 212 (+15%), Nov 8
  dmg: 26, enrageAt: .35, enrageSpeed: 1.12, enrageCd: .75,
  swing:  { trigger: 260, windup: .7, hit: .95, total: 1.6, r: 260, flat: .6,   // r + trigger: 200 until Nov 8 (+30%)
            mult: 1.3, push: 110, cd: 5 },   // flat: the ring is a ground ellipse (matches the art)
  walk:   { first: 6, every: 16, life: 8, step: 38, patch: 6, patchEnraged: 9, r: 36 },
  strike: { trigger: 95, windup: .3, hit: .34, total: .7, r: 175, arc: Math.PI / 3, mult: 1, push: 45, cd: 1.3 },   // basic attack; arc: half-angle in front
  sermon: { first: 9, cd: 15, total: 2.6, mark: .5, warn: 1, n: 7, aimed: 3, spread: [110, 400], gap: 110, r: 72, mult: 1.2, back: 2 },   // n pillars: one on each of the `aimed` closest survivors, the rest at random spots around him
  wheel:  { first: 12, gap: 15, cast: 1.2, warn: 2, life: 60, len: 620, hw: 14, turn: 18, enrageTurn: 14, mult: .45, every: .6 },   // gap: rest after one ends; hw: half width
  burn:   { len: 3, dps: .25 },   // fraction of his damage per second
};
// ---------- THE SCREAMER (boss, wave 12, Nov 10) ----------
// A ranged boss: keeps 180-320px from his target and backs off when you close in.
//   SHRIEK (basic)        60° cone in front (~300px): damage + knockback. 3+ survivors in his face -> it goes all round him.
//   ECHO RINGS            3 sound rings (5 enraged) roll out from his feet 0.6s apart to 520px; each = damage + slow. Dash through one (i-frames).
//   RESONANCE             marks 2 survivors; 3s later each mark bursts (140px) and hurts everyone inside: the marked one walks away from the team.
//   DEAFENING WAIL        2.5s wind-up, then a wail across the map: anyone he can SEE = big damage + 1.5s stun. Cover = buildings, the tower,
//                         the generator, a barricade, Astra's safehouse. During the wind-up his throat takes x2 from the front; 8% of his HP
//                         in that window and he CHOKES (2s stagger, wail cancelled).
//   CALL OF THE HORDE     at 66% and 33% HP: runners pour in from the map edges (4 + 2 per survivor), +30% speed for 10s, and they hunt survivors.
//   Enraged below 35%: faster, cooldowns x0.75, 5 rings per cast.
const SCREAMER = {
  hp: 2300, speed: 150, radius: 68, dmg: 24, keep: [220, 360], enrageAt: .35, enrageSpeed: 1.15, enrageCd: .75,   // (Nov 12) drawn 2x: radius 36 -> 68, keeps a little further back
  shriek: { trigger: 340, windup: .45, hit: .5, total: .95, r: 340, arc: .52, mult: 1, push: 120, cd: 2.6, crowd: 3, crowdR: 95, allR: 230 },   // r / trigger 300 -> 340, allR 170 -> 230 (Nov 12, with his size)
  rings:  { first: 6, cd: 10, n: 3, enrN: 5, gap: .6, speed: 380, max: 520, w: 30, mult: .6, slow: 1.2 },
  mark:   { first: 10, cd: 14, n: 2, delay: 3, r: 140, mult: 1.1, cast: .7 },
  wail:   { first: 15, cd: 22, wind: 2.5, total: 3.6, mult: 1.4, stun: 1.5, choke: .08, chokeLen: 2, throat: 2, maxD: 1400 },
  horde:  { at: [.66, .33], n: 4, per: 2, frenzy: 1.3, life: 10, cast: 1.6 },
};
// ---------- THE ABOMINATION (boss, wave 16, Nov 10) ----------
// Five bodies fused into one black lava creature. Slow and heavy... until he tears into THE FIVE.
//   FLAIL SLAM   his giant arm smashes a long line in front of him.
//   GUT ROLL     curls into a ball and rolls in a straight line; crushes barricades. Rolls into a building / the tower / the map edge = DAZED 3s (x1.5 damage).
//   LAVA SPEW    a cone of lava, then 3 burning puddles left behind.
//   THE SUNDERING at 45% HP: stops (can't be hurt) and slowly separates into FIVE spawn (4.2s).
//   THE FIVE     5 fast hunters, each with its own HP, each after a different survivor; they pounce. Every one that falls makes the rest faster.
const ABOM = {
  hp: 3900, speed: 74, radius: 88, dmg: 22, splitAt: .45,   // (Nov 12) drawn 2x bigger: radius 46 -> 88, slam / roll / spew reach grew with him
  slam: { trigger: 250, windup: .7, hit: .75, total: 1.5, len: 350, hw: 75, mult: 1.1, push: 110, cd: 3.2 },
  roll: { first: 8, cd: 15, wind: 1.0, speed: 540, max: 950, hitR: 88, mult: 1.2, push: 90, daze: 3, end: .5, dazeMult: 1.5 },
  spew: { first: 4, cd: 9, trigger: 700, wind: .6, dur: 1.3, total: 2.2, len: 840, arc: .21, every: .2, mult: .3, puddles: [170, 330, 490, 650, 800], pr: 66, life: 7, pmult: .22, pevery: .5 },   // (Nov 12) len 420 -> 840 (user: twice as long now he's twice the size), arc .36 -> .21 so it is a long jet, not a wider wall (the far end is ~350px across); walls block it
  sunder: { len: 3.4, fan: [[-150, 46], [-87, 24], [-6, 20], [78, 24], [150, 46]] },   // fan = where the five stand in the last painted frame (client ABM_FAN), so the live ones appear exactly there (x1.5 since Nov 12: the Five are drawn 1.5x)
  spawn: { hpFrac: .13, speed: 232, radius: 30, dmgMult: .7, rage: .09, lunge: { trigger: 200, wind: .4, leap: .28, dist: 230, total: 1.0, r: 70, mult: 1, cd: 2.0 } },   // radius 20 -> 30, landing r 58 -> 70 (Nov 12, 1.5x)
};
const PATH_CELL = 40;   // boss path-finding grid
const HOOK_SPEED_TEST = 520;                          // solo preview default (slow, to practise deflecting)
// ---------- VIKTOR (Engineer) ----------
// E (skill): ROBOT. Summons ONE robot (assault / support / hunter) where Viktor aims; 25s cooldown. Up to 3 alive:
//   a 4th replaces the oldest. Robots are independent: each guards its own spot and never strays more than
//   ROBOT_LEASH px from it. They stay until destroyed. Zombies attack them.
// Q (ultimate): HEAVY TURRET. Unlocks at 100 of Viktor's own kills (bosses don't count) and stays unlocked.
//   Deploys in 1s (vulnerable), spins to the nearest zombie, minigun, no generator. One at a time.
//   Q again 30s after deploying replaces it; once it's destroyed, wait 30s. (Solo preview: unlocked from the start.)
const HEAVY_TURRET = { cd: 25, hp: 650, deploy: 1.0, range: 680, rate: .52, dmg: 16, radius: 22 };
const ULT_KILLS = 100, ULT_CD = 60, ULT_LIFE = 40,   // Heavy Turret: lasts 40s, then the 60s cooldown starts
      ROBOT_CD = 25, ROBOT_GAP = 3, ROBOT_LEASH = 300, ROBOT_MAX = 3, ROBOT_CHARGES = 3;   // Viktor: 3 robot charges, 3s between summons, +1 charge every 25s
// Assault: 5 per hit (a wave-1 walker, 38 HP, takes 8). Hunter: 7 per laser (6 hits), every 2.2s, only at zombies inside its circle.
// Assault hunts zombies anywhere; support visits survivors in turn (5s each, 3 visits, then breaks); hunter holds a 300px patch.
const ROBOT = {
  assault: { hp: 250, speed: 85, range: 230, rate: .6, dmg: 5 },
  support: { hp: 150, speed: 185, range: 230, heal: 7, buff: 0.15, visit: 5, visits: 3, near: 80 },
  hunter:  { hp: 90, speed: 155, range: 650, rate: 2.2, dmg: 7, pierce: 1, cone: 180 },   // range = laser length; targets come only from its circle
};
const ROBOT_R = 13;
const BOSS_HP_PER_PLAYER = 0.6;                      // boss health +60% for every survivor after the first (bots count)
const BOSS_WAVE = { horde: 45, introWait: 25, escortEvery: 3.2, escortMax: 14, straggleGrace: 15, straggleMax: 3 };   // straggle: 15s after the horde ends, 3 or fewer left -> they vanish and the boss comes anyway
const ringZone = (dx, dy) => hyp(dx, dy / 0.55);   // distance on the flat ground ellipse the shockwaves are drawn as
const SLAM = { trigger: 115, radius: 140, windup: 0.8, total: 1.45, cooldown: 5.5, stun: 1.3, dmgMult: 1.5 };
// How far past its body edge a zombie can hit (brutes have long, heavy arms).
const ATTACK_REACH = { brute: 48, mutant: 52 }, DEFAULT_REACH = 22;
// MUTANT: the scary one. Fast, tough, hits hard, and its claw slash is an area attack (everyone in a wide arc in front)
// that it does WHILE running, without stopping.
// Its attack is a CHARGED WHIP: coil (glows, slows down: your warning) -> lunge forward -> whip slash hits everyone
// in a wide arc -> brief recovery. Times in seconds from the start of the attack (z.slam counts down from total).
const MUTANT = { trigger: 150, charge: .38, lungeEnd: .56, hit: .47, total: .9, cooldown: 1.0, chargeSpeed: .35, lungeSpeed: 430, arc: 1.2, dmgMult: 1.25, night: 1.15 };   // Nov 9: 1.6 -> 1.25, night x1.15 (others x1.3): a whip at wave 14 took 45% of a hero
const HIT_CAP = .4;   // no single hit from an ordinary zombie (not a boss) takes more than 40% of your max HP: late waves scale damage forever and brutes/mutants one-shot otherwise
// Which zombies make up each wave: % of walker, runner, brute, spitter, mutant (adds up to 100).
// Waves 1-16 are hand-tuned (runners from wave 1, brutes from wave 3 at 20%, spitters from 5, mutants from 9).
// From 17 on, waves cycle through themes (rush, siege, mutant horde, boss) and walkers slowly thin out.
const WAVE_MIX = {
  1: [85, 15, 0, 0, 0],   2: [75, 25, 0, 0, 0],   3: [55, 25, 20, 0, 0],  4: [60, 25, 15, 0, 0],
  5: [50, 25, 15, 10, 0], 6: [45, 30, 15, 10, 0], 7: [40, 25, 20, 15, 0], 8: [45, 25, 15, 15, 0],
  9: [35, 25, 20, 10, 10], 10: [30, 30, 15, 15, 10], 11: [30, 25, 20, 10, 15], 12: [35, 25, 15, 15, 10],
  13: [25, 30, 20, 10, 15], 14: [25, 25, 20, 15, 15], 15: [20, 30, 20, 15, 15], 16: [30, 25, 15, 15, 15],
};
const MIX_KINDS = ["walker", "runner", "brute", "spitter", "mutant"];
function waveMix(stage) {
  if (WAVE_MIX[stage]) return WAVE_MIX[stage];
  const w = Math.round(25 - (Math.min(stage, 49) - 17) * 15 / 32);   // walkers: 25% at wave 17 -> 10% at wave 49
  const rest = 100 - w;
  const theme = [                                                     // shares of the non-walker part
    [.40, .20, .15, .25],   // rush: lots of runners
    [.15, .40, .30, .15],   // siege: brutes + spitters
    [.20, .15, .15, .50],   // mutant horde
    [.25, .25, .25, .25],   // boss wave: even mix
  ][(stage - 17) % 4];
  const m = [w, ...theme.map(t => Math.round(t * rest))]; m[4] += 100 - m.reduce((a, b) => a + b, 0);
  return m;
}
function pickKind(stage) {
  const m = waveMix(stage); let r = Math.random() * 100;
  for (let i = 0; i < 5; i++) { r -= m[i]; if (r < 0) return MIX_KINDS[i]; }
  return "walker";
}
const COLORS = ["#68d5e8", "#e8bd68", "#c58be8", "#82d49a", "#e88787", "#8eabed", "#e5a36b", "#d2d879"];
// Levels (Nov 5): XP is shared, every kill gives its XP to the whole team, so everyone levels together whatever the team size.
// A full 50-wave run makes ~38-40k team XP (sims); 30k reaches the cap, so level 30 lands around wave 43-50. Every run starts at level 1.
const MAX_LEVEL = 30, xpForLevel = L => 30 + 72 * (L - 1);
// Skill cooldown reduction (level-up upgrade): -10% per pick, max -60% (Nov 5: was -5% / -35%). Every skill timer (E, Q, R, Viktor's charges) starts x(1-cdr) shorter (tickCdr).
const CDR = { step: 0.10, max: 0.60 };
// Fast Hands (level-up upgrade, Nov 5): per pick +15% reload speed and +20% magazine size, up to 5 picks (+75% / +100%).
const HANDS = { reload: 0.15, mag: 0.20, max: 5 };
// Body Armour (level-up upgrade, Nov 6): PERCENT damage reduction by weight class, 8 picks to the cap. Heroes' built-in flat
// defence (Briggs 5, Viktor 1) still comes off after the percent. The shop no longer sells armour.
const ARMOR_CLASS = { juggernaut: "heavy", slasher: "heavy", dispatcher: "medium", operator: "medium", assault: "medium", engineer: "medium", demolitionist: "light", sniper: "light", scout: "light" };
const ARMOR = { heavy: .08, medium: .06, light: .04, picks: 8 };
const armorStep = p => ARMOR[ARMOR_CLASS[p.characterClass] || "medium"], armorCap = p => armorStep(p) * ARMOR.picks;
const magCap = (p, w) => Math.round(w.mag * (1 + HANDS.mag * (p.hands || 0)));   // XP from level L to L+1: 30, 102, 174 ... 2046 (29 -> 30); 30,006 in total
const UPGRADES = {
  damage: p => { p.bonusDamage = (p.bonusDamage || 0) + 20; applyLoadout(p); }, // +20% damage
  fireRate: p => { p.rateMult = Math.min(3, (p.rateMult || 1) * 1.2); applyLoadout(p); },
  health: p => { p.maxHp += 20; p.hp = Math.min(p.maxHp, p.hp + 35); },
  defence: p => { p.armorPct = Math.min(armorCap(p), Math.round(((p.armorPct || 0) + armorStep(p)) * 100) / 100); },   // Body Armour: percent, by weight class
  speed: p => { p.speed = Math.min(300, p.speed * 1.1); },
  cooldown: p => { p.cdr = Math.min(CDR.max, Math.round(((p.cdr || 0) + CDR.step) * 100) / 100); },
  hands: p => { p.hands = Math.min(HANDS.max, (p.hands || 0) + 1); p.magSize = magCap(p, WEAPONS[p.weapon] || WEAPONS.rifle); }
};
// Class identity: base HP/speed/defence plus multipliers that apply to ANY weapon.
const CLASS_STATS = {
  assault:       { hp: 110, speed: 190, defence: 0, dmgMult: 1.10, rateMult: 1.10 },
  juggernaut:    { hp: 160, speed: 150, defence: 5, dmgMult: 0.93, rateMult: 0.85 },
  engineer:      { hp: 110, speed: 175, defence: 1, dmgMult: 0.97, rateMult: 1.00 },
  scout:         { hp:  90, speed: 225, defence: 0, dmgMult: 1.03, rateMult: 1.20 },
  demolitionist: { hp: 105, speed: 175, defence: 0, dmgMult: 1.17, rateMult: 0.85 },
  sniper:        { hp:  95, speed: 165, defence: 0, dmgMult: 1.43, rateMult: 0.65 },
  operator:      { hp: 115, speed: 180, defence: 0, dmgMult: 1.00, rateMult: 1.00 },
  slasher:       { hp: 135, speed: 175, defence: 0, dmgMult: 1.00, rateMult: 1.00 },
  dispatcher:    { hp: 120, speed: 180, defence: 0, dmgMult: 1.00, rateMult: 1.00 }
};
// Weapons are balanced around ~20 damage/second on a single zombie; each has a different strength.
const WEAPONS = {
  // slot: "secondary" = key 3 (sidearms), "primary" = key 2. mag = shots per magazine, reload = seconds.
  // auto: hold the mouse to keep firing (otherwise one shot per click). jitter = random spread in radians.
  pistol:   { slot: "secondary", dmg: 11, rate: 3.5, range: 400, mag: 12, reload: 1.0, infinite: true },          // semi-auto, never runs dry. Nov 9: was 14 dmg / 4 per s / 450 range (out-damaged the SMG for free)
  smg:      { slot: "secondary", dmg:  8, rate: 8.0, range: 380, mag: 30, reload: 1.4, auto: true, jitter: 0.07 }, // full-auto spray, short range. Nov 9: was 6 dmg / 360 range
  rifle:    { slot: "primary",   dmg: 15, rate: 4.5, range: 520, mag: 30, reload: 1.6, auto: true, jitter: 0.03 }, // full-auto, accurate
  shotgun:  { slot: "primary",   dmg: 12, rate: 1.1, range: 390, mag: 6,  reload: 2.0, pellets: 5, spread: 0.21, pelletMult: 1, pierce: 2, falloff: { near: 100, min: 0.5 } },
            // pump, 5-pellet cone. Nov 9: range 260 -> 390, each pellet goes through 2 zombies, and a pellet does FULL damage (2x the old) within
            // 100px, falling to half at max range (the old damage): devastating point blank, same as before far away
  sniper:   { slot: "primary",   dmg: 80, rate: 0.8, range: 760, mag: 5,  reload: 2.2, pierce: 3, bigMult: 1.5 },  // bolt-action, goes through up to 3 zombies.
            // Nov 9: dmg 55 -> 80 (one-shots walkers till ~wave 10, runners all run) + bigMult: x1.5 on bosses and brutes (the big-target gun)
  launcher: { slot: "primary",   dmg: 35, rate: 0.6, range: 560, mag: 3,  reload: 2.6, splash: 80 } // explodes on first hit
};
// Melee (key 1): swing in an arc toward the mouse. cd = seconds between swings, arc = half-angle in radians.
const MELEE = {
  // Melee is a last resort: a walker (38 HP) takes ~5 knife stabs.
  knife:  { dmg:  8, cd: 0.35, range: 60, arc: 1.0 },
  bat:    { dmg: 14, cd: 0.60, range: 72, arc: 1.2 },
  axe:    { dmg: 26, cd: 0.90, range: 70, arc: 0.9 },
  katana: { dmg: 18, cd: 0.50, range: 82, arc: 1.3 },
  chainaxe: { dmg: 48, cd: 0.85, range: 160, arc: 0.87, targets: 4, walls: true }   // Arshan only: 100-degree sweep, 160px, up to 4
};
const MELEE_ORDER = ["knife", "bat", "axe", "katana"];
// RAVEN (Scout): katana specialist. Starts with only her katana (stronger than anyone else's); can buy guns.
// Katana tiers: one every 50 katana kills: 1 +25% dmg, 2 hits up to 5 + wider arc, 3 bleed, 4 +30% slash speed, 5 every 4th slash crits x2.5.
// E SHADOW PASS: 350px dash slashing everything in the path -> invisible up to 20s (zombies ignore her; attacking ends it)
//   -> her katana burns for 5s (hits stack burns on zombies: 3s, up to 5 stacks) -> then the 25s cooldown starts.
// Q BLADE STORM (100 kills): spins for 10s slashing everything around her, then a 60s cooldown.
const RAVEN = {
  katana: { dmg: 27, cd: 0.42, range: 96, arc: 1.4, targets: 3 },
  dash: { dist: 350, time: 0.22, mult: 2, width: 26 },
  shadow: 20, fire: 5, cd: 25,
  burn: { len: 3, dps: 8, max: 5 },
  bleed: { len: 3, frac: 0.3 },
  storm: { len: 10, cd: 60, radius: 118, every: 0.25, mult: 0.55 },
  tierKills: 50, tiers: ["", "Honed Edge", "Wide Cut", "Bleed", "Swift Blade", "Ghost Steel"], critEvery: 4, crit: 2.5,
};
function ravenKatana(p) {
  const t = p.katanaTier || 0, k = RAVEN.katana;
  return { dmg: k.dmg * (t >= 1 ? 1.25 : 1), cd: k.cd * (t >= 4 ? 0.77 : 1), range: k.range, arc: k.arc + (t >= 2 ? 0.3 : 0), targets: t >= 2 ? 5 : k.targets };
}
// DANTE (Demolitionist): starts with a rocket launcher. Rockets fly in a straight line to where you click (or max range / a wall)
//   and explode there (any survivor's launcher works this way).
// E SKY BARRAGE (8s cd): fires 3 rockets into the sky one by one (0.15s apart); they come down at random spots around the mouse and explode.
// Q DEMO RIPPLE (100 kills): first Q places a demo charge crate (arms in 1s); Q again detonates it any time (or it blows by itself after
//   30s, or if Dante goes down). Big blast at the crate, then 3 rings of grenades fly out and explode: 4 big, 8, then 36 small. 60s cooldown.
// SOFEA (operator): E = Steel Convoy (drive a tank 30s), Q = Sky Reign (fly a rocket helicopter 30s), R = Crimson Aegis (pilot a mecha 30s).
// Both start with a 0.8s radio call. Ride time starts when she boards; the cooldown starts when she gets out.
const SOFEA = {
  call: 0.8, protect: 0.75,
  tank: { life: 30, cd: 30, speed: 140, taken: 0.65, rate: 1.5, body: 34, reach: 30, hw: 50, hh: 32,
          shot: { dmg: 65, min: 30, r: 110, speed: 600, range: 650 }, crush: { dmg: 55, boss: 10, gap: 0.75, minSpeed: 40, push: 30 } },
  // helicopter: flies over everything (only the map edge stops it); its machine gun fires while she HOLDS the left mouse button, hitting every
  // zombie in a 90-degree cone (250px) the way she aims, 10 times a second (dmg grows with the wave like her tank's cannon)
  heli: { life: 30, cd: 60, speed: 230, taken: 0.8, body: 30,
          gun: { cone: Math.PI / 2, range: 250, every: 0.1, dmg: 10, bossMult: 0.5 } },   // 100 dps per zombie on wave 1
  // mecha (R): she transforms (1s) and pilots it on foot-speed WASD. HOLD left click = flame jet (190px, 60-degree cone, 12 dmg to every
  // zombie in it every 0.25s); right click = lightsaber sweep (120px, 150 degrees, 80 dmg once per zombie, the swing takes 0.9s).
  // Flame pulses and swings share one attack timer. Both stop at walls. She takes normal damage; no run-over. 100s cooldown from getting out.
  mecha: { life: 30, cd: 100, call: 1, speed: 150, taken: 1, body: 20, reach: 8,   // 1.5x a survivor
           flame: { range: 190, cone: 60 * Math.PI / 180, every: 0.25, dmg: 12 },   // cone 42 -> 60 degrees (Nov 5)
           saber: { range: 120, cone: 150 * Math.PI / 180, dmg: 80, swing: 0.9, hitAt: 0.25 } },   // sweep (Nov 5: 155px / 120 deg -> 230px / 150 deg -> 30% smaller: 160px -> 120px, user: too big)
};
// BRIGGS (juggernaut): E = Iron Bastion (steel dome: can't be hurt for 15s), Q = War Cry (taunt + half damage + team buff, 10s)
const BRIGGS = {
  bastion: { cast: 0.4, life: 15, cd: 30, slow: 0.7, shatter: { r: 150, push: 60, dmg: 40 } },
  blast: { push: 24, bossMult: 0.5 },
  rage: { rateMult: 3 },   // during War Cry: shotgun fires 3x faster and uses no ammo   // passive Forceful Blast: every shotgun pellet that hits shoves the zombie back (bosses too, less)
  cry: { cast: 0.3, life: 10, cd: 60, tauntR: 350, bossTaunt: 3, taken: 0.5, buffR: 400, buff: 0.25, impact: { r: 210, push: 45, dmg: 30 } },
};
function briggsLoadout(p) { p.owned = "shotgun,pistol"; p.primary = "shotgun"; p.secondary = "pistol"; p.weapon = "shotgun"; p.activeSlot = 2; }
// ARSHAN (slasher): chain-axe. E = Reaper's Reach (throw the hook up to 1100px, latch an enemy or a wall, pull HIMSELF there),
// Q = Crimson Cyclone (12s of the red-hot axe circling him, 260px, 24 dmg per target every 0.25s).
// Astra (dispatcher): E = 1 medic (5 HP/s, each person once), Q = 1 officer per living player, R = safehouse (4 walls zombies can't cross).
// Lobby mission settings. Sites = map layouts (same city style, different streets).
const DEFAULT_SITE = 0;   // (Nov 12) every match starts at Ascension: maps follow the fixed order below (no map choice in the lobby any more)
// (Nov 12, user) THE MAP ORDER: 4 waves per map, its boss on the 4th wave; beat it and the team moves on to the next map.
// After the sixth map it starts over (harder: everything scales with the wave). Wave 50 is still the Apocalypse.
const CHAPTERS = [
  { site: 0, boss: "butcher", name: "ASCENSION" },                    // waves 1-4    Ascension
  { site: 3, boss: "hivemind", name: "FALLEN DYNASTY" },                   // waves 5-8    Fallen Dynasty: the ALPHA HIVEMIND (a giant one that tears off more Hiveminds)
  { site: 4, boss: "screamer", name: "WHITEOUT STATION" },                   // waves 9-12   Whiteout Station
  { site: 5, boss: "pyre", name: "SCORCHED REFINERY" },                       // waves 13-16  Scorched Refinery (he walks out of the pyramid)
  { site: 6, boss: "minebeast", mission: true, name: "THE DEEP MINE" },   // waves 17-20  The Deep Mine: wave 20 is the rune mission and the Mine Beast
  { site: 7, boss: "abomination", name: "THE CRUCIBLE" },                   // waves 21-24  THE CRUCIBLE: the lava map (he bursts out of the Great Crucible)
];
const chapterOf = stage => CHAPTERS[Math.floor((Math.max(1, stage) - 1) / 4) % CHAPTERS.length];
const SITES = [{ seed: 1337 }, { seed: 4242 }, { seed: 90210 }, { style: "dynasty", seed: 8888, w: 4400, h: 2800 }, { style: "whiteout", seed: 2040, w: 4400, h: 2800 }, { style: "refinery", seed: 7070, w: 4400, h: 2800 }, { style: "mine", seed: 6060, w: 6000, h: 4000 }, { style: "crucible", seed: 2424, w: 6000, h: 4000 }];   // crucible: The Crucible (Nov 12), the lava map for the Abomination (waves 21-24)   // mine: The Deep Mine (Nov 11), a big underground map ridden on mine carts, with the boss dungeon and the portal;   // (Nov 11) Midnight Carnival removed from the lobby (user). Its ride engine (this.coaster, coasterTrack...) stays for the mine-cart map;   // carnival: Midnight Carnival, a bigger map with a rideable coaster;   // refinery: Scorched Refinery, open desert, bosses walk out of the pyramid;   // whiteout: Whiteout Station, a tight maze of Antarctic lab buildings (buildWhiteoutLayout);   // dynasty: Fallen Dynasty, a bigger map built from Chinese-city pieces (mapLayout.js buildDynastyLayout)
const DIFFICULTY = { easy: { hp: 0.75, dmg: 0.7 }, normal: { hp: 1, dmg: 1 }, hard: { hp: 1.35, dmg: 1.3 } };
const FRIENDLY_FIRE = 0.35;   // with friendly fire on, bullets that cross a teammate hurt them (35%)
const PICKABLE = ["assault", "juggernaut", "operator", "engineer", "scout", "demolitionist", "sniper", "dispatcher"];   // Elena (medic) and Hayes (commander) were removed; Arshan (slasher) not pickable yet
const ASTRA = {
  call: 0.45,   // the shared radio call before anyone arrives
  medic: { n: 1, life: 20, cd: 30, hp: 100, speed: 165, heal: 5, range: 70, stuck: 2, session: 6,   // session: longest single treatment (s)
           burst: .30, burstR: 300,          // on arrival: everyone alive within 300px of Astra (him too) heals 30% of their max HP, once (Nov 6)
           revive: 2.5, reviveR: 60, reviveHp: .35 },   // TOP priority: walks to the nearest downed teammate and revives them in 2.5s (up with 35% HP)
  police: { life: 30, cd: 60, hp: 110, speed: 150, dmg: 5, perHeavy: .15, burst: 5, gap: .08, every: 2, range: 440, leash: 600, threat: 250, astra: 2 },   // Nov 6: 5-round bursts every 2s, 5 dmg; Astra gets 2 officers, every teammate 1
  catchUp: { far: 250, mult: 1.35 },   // police / medic walk slower than Astra (180) so they trail behind him; when far behind they hurry
  // hits: zombie attacks the walls take before they break (each attack = 1, whoever hits); builders stay inside at half speed
  // and each repairs 1 every repairEvery seconds (much slower than zombies hit: it's catch-up)
  safe: { cd: 90, build: 5, hits: 6, perArmor: 1, repairEvery: 5, stay: .5, life: 45, half: 130, wall: 24, search: 90, worker: 200 },   // 260x260 outside, 212x212 inside, 24px walls
};
const policeDmgMult = p => 1 + ASTRA.police.perHeavy * ((p?.bonusDamage || 0) / 20);   // Nov 12: each Heavy Weapon pick Astra takes = +15% officer damage (his own guns get +20%)
// Deployables (Nov 12, user): a cap PER PLAYER per type; building one more removes your oldest of that type. Viktor (engineer) gets +1 turret.
const BUILD_CAP = { barricade: 10, turret: 3, mine: 8, fence: 4, flameTrap: 4 };
const buildCap = (p, kind) => (BUILD_CAP[kind] || 0) + (kind === "turret" && p?.characterClass === "engineer" ? 1 : 0);
const safeBuildTime = p => Math.round(ASTRA.safe.build * (1 - (p.cdr || 0)) * 100) / 100;   // Nov 11: skill-cooldown upgrades shorten the build too (5s -> 2s at the 60% cap)
const safeHits = p => ASTRA.safe.hits + ASTRA.safe.perArmor * Math.round((p.armorPct || 0) / armorStep(p));   // +1 wall hit per Body Armour pick (6 -> 14 at 8 picks; Nov 12, was +2)
const ASTRA_UNITS = new Set(["police", "doctor", "worker"]);
const ARSHAN = {
  hook: { wind: 0.15, speed: 1400, range: 1100, hitR: 10, dmg: 70, pull: 900, stop: 20, wallStop: 24, maxT: 3, cd: 12, missCd: 4 },
  spin: { wind: 0.6, life: 12, cd: 60, r: 260, dmg: 24, every: 0.25, speed: 130 },
};
function arshanLoadout(p) { p.owned = ""; p.primary = ""; p.secondary = ""; p.weapon = ""; p.melee = "chainaxe"; p.activeSlot = 1; p.mag = 0; p.magSize = 0; }
const DANTE = {
  sky: { cd: 8, range: 520, n: 3, gap: 0.15, flight: 0.85, spread: 80, dmg: 90, r: 75, push: 18 },
  rocketSpeed: 950,
  demo: { arm: 1, life: 30, cd: 60, place: 46, flight: 0.45,
    core: { dmg: 300, r: 110 },
    // grenades land scattered around each ring (not a perfect circle); the last ripple mixes big and small blasts
    rings: [{ n: 4, R: 90, dmg: 160, r: 70, at: 0.0 }, { n: 8, R: 180, dmg: 110, r: 60, at: 0.4 }, { n: 16, R: 300, dmg: 75, r: 46, at: 0.8, small: true, bigEvery: 3, bigDmg: 120, bigR: 62 }],
    flat: 0.62, bossMult: 0.5, push: 22 },
};
function danteLoadout(p) { p.owned = "launcher,pistol"; p.primary = "launcher"; p.secondary = "pistol"; p.weapon = "launcher"; p.activeSlot = 2; }
function siennaLoadout(p) { p.owned = "sniper,pistol"; p.primary = "sniper"; p.secondary = "pistol"; p.weapon = "sniper"; p.activeSlot = 2; }   // Nov 9: her own gun (was the rifle)
function sofeaLoadout(p) { p.owned = "smg,pistol"; p.primary = ""; p.secondary = "smg"; p.weapon = "smg"; p.activeSlot = 3; }   // Nov 9: SMG instead of the rifle (the shop still sells primaries)
function ravenLoadout(p) { p.owned = ""; p.primary = ""; p.secondary = ""; p.weapon = ""; p.melee = "katana"; p.activeSlot = 1; p.mag = 0; p.magSize = 0; }
function ravenReset(p) { p.shadow = 0; p.fire = 0; p.storm = 0; p.dashT = 0; p.katanaKills = 0; p.katanaTier = 0; }
// Fire axe heavy swing: hold the mouse 1 second, release -> wide, hard swing that hits everything in front and knocks zombies back.
const AXE_HEAVY = { charge: 1.0, dmgMult: 2.5, range: 100, arc: 1.7, knockback: 36, moveMult: 0.6 };
const MAX_MEDKITS = 3;
// Things players and bots can't walk through (half-width of their square). Mines and flame traps are floor traps.
// Barricade + electric fence are FENCE LINES built ACROSS the way you face. st.aim = the builder's facing, snapped to 8 directions
// (art for each, tools/extract-line8.py: facing down-right gives a "/" line, right gives a vertical one).
// The line runs at aim + 90deg. Footprint = a strip along the line: half length L, half thickness T (L matches each sprite's length).
// They block vehicles only; survivors walk through every deployable. Turrets: a plain 16x16 (half) box.
const LINES = { barricade: 8, fence: 8 };
// MINE (Nov 8): a zombie within `trigger` sets it off; the blast hits EVERY zombie within r: dmg at the centre down to edge at the rim,
// pushes them back a little, doesn't go through walls. Credit (kills / XP) goes to whoever placed it.
const MINE = { trigger: 42, r: 100, dmg: 220, edge: 110, push: 14 };   // facings each one snaps to
const snapFace = (a, n) => { const s = Math.PI * 2 / n; let r = Math.round(a / s) * s; if (r <= -Math.PI) r += Math.PI * 2; if (r > Math.PI) r -= Math.PI * 2; return r; };
const LINE_L = [38, 40, 46, 40];   // half length by facing (k % 4): right/left (vertical line), "/" diagonal, down/up (horizontal), backslash diagonal
function lineOf(st) {   // { c, s: the line's direction, L, T } or null
  const k = ((Math.round(st.aim / (Math.PI / 4)) % 8) + 8) % 8, la = st.aim + Math.PI / 2;
  return { c: Math.cos(la), s: Math.sin(la), L: LINE_L[k % 4], T: 16 };
}
const footBox = st => { if (LINES[st.kind]) { const l = lineOf(st); return [Math.abs(l.c) * l.L + Math.abs(l.s) * l.T, Math.abs(l.s) * l.L + Math.abs(l.c) * l.T]; } return st.kind === "turret" ? [16, 16] : null; };   // axis box (vehicles)
const nearFoot = (st, z, pa, pt) => {   // z within pa (along the line) / pt (across it) of the footprint
  const l = lineOf(st), dx = z.x - st.x, dy = z.y - st.y;
  return Math.abs(dx * l.c + dy * l.s) < l.L + pa && Math.abs(dy * l.c - dx * l.s) < l.T + pt;
};
const GEN_OFF = { x: 118, y: 6, h: 20 };   // the generator sits beside the tower and is solid too
const DEAD_EYE = { mult: 12 };   // Sienna's E: 12x one shot of the gun she holds (see deadEye)
const STATION_R = { tower: 125, gen: 90 };
const STATION_STEP = { tower: { amt: 250, cost: 10 }, gen: { amt: 300, cost: 15 }, fuel: { amt: 25, cost: 10 } };   // per F press (scrap / scrap / fuel)   // Nov 9: repair / refuel only standing next to it (the client shows an F prompt there)
const TOWER_HALF = 34;      // the radio tower's concrete base in the centre of the map
const BODY_R = 12;          // a survivor's collision radius
const BUILD_RANGE = 160;
const DASH_DISTANCE = 140, DASH_COOLDOWN = 5, DASH_IFRAMES = 0.25;   // Nov 6: a real dodge (was 50px, no i-frames)   // seconds // you can place structures up to this far from yourself
// Recalculate damage/fire rate from weapon + class + upgrades + temporary buffs.
// Upgrades are stored separately, so switching weapons never erases them.
// Marcus E: Combat Rush. +50% damage and +25% attack speed (guns and melee) for 6s, 15s cooldown (counts from the press).
// Marcus Q: Frag Barrage (100 kills, then 20s cooldown; the cooldown applies in test mode too). A concussion blast around him (hurts + shoves zombies away), he hops back
// away from his aim, and throws 3 grenades in a fan toward the mouse; each lands (0.55s, 0.08s apart) and blows with a big knockback.
const MARCUS = { rush: { cd: 15, t: 6, dmg: 50, rate: 1.25 },
  frag: { cd: 20, n: 3, fan: 0.35, min: 140, max: 380, flight: 0.55, gap: 0.08, dmg: 110, r: 85, push: 60, bossMult: 0.5,
          blast: { r: 150, dmg: 40, push: 90 }, hop: { dist: 170, t: 0.22 } } };
function applyLoadout(p) {
  const c = CLASS_STATS[p.characterClass] || CLASS_STATS.assault;
  const w = WEAPONS[p.weapon] || WEAPONS.rifle;
  // bonusDamage / buffDamage are percentages (+20 = +20% damage)
  p.damage = Math.round(w.dmg * (1 + ((p.bonusDamage || 0) + (p.buffDamage || 0)) / 100) * c.dmgMult * 10) / 10;
  p.fireRate = Math.min(14, w.rate * c.rateMult * (p.rateMult || 1) * (p.buffRate || 1));
}
function applyClassBase(p) {
  const c = CLASS_STATS[p.characterClass] || CLASS_STATS.assault;
  p.maxHp = c.hp; p.hp = c.hp; p.speed = c.speed; p.defence = c.defence;
  applyLoadout(p);
}
// Shop (open during the break between waves). Gold is earned per match from kills and gold pickups.
const STARTER_WEAPONS = "pistol,rifle";
const SHOP = {
  smg:         { price: 35,  label: "SMG",            type: "weapon" },
  shotgun:     { price: 40,  label: "Shotgun",        type: "weapon" },
  sniper:      { price: 70,  label: "Sniper rifle",   type: "weapon" },
  launcher:    { price: 120, label: "Launcher",       type: "weapon" },
  medkit:      { price: 10,  label: "Medkit (quick item, max 3)" },
  ammo:        { price: 5,   label: "Ammo +90" },
  scrap:       { price: 15,  label: "Scrap +40 (team)" },
  electronics: { price: 20,  label: "Electronics +8 (team)" },
  fuel:        { price: 10,  label: "Fuel +30 (team)" },
  explosives:  { price: 15,  label: "Explosives +5 (team)" }
};
const KILL_GOLD = { brute: 3, mutant: 5, spitter: 2 };
const BREAK_SECONDS = 60;   // Nov 9: the break between waves lasts until EVERY player presses Ready (bots always are) - at most 60s
const BREAK_GO = 3;          // ...then a 3s "here they come" before the wave
const BOT_NAMES = ["Ava", "Rex", "Juno", "Kai", "Mira", "Odin", "Zed", "Nova"];
const rand = (a, b) => a + Math.random() * (b - a);
const hyp = (x, y) => Math.sqrt(x * x + y * y);   // not Math.hypot: 3x slower in V8, and these run tens of thousands of times a second
const distance = (a, b) => hyp(a.x - b.x, a.y - b.y);

// WAVE 20: THE DEEP MINE mission (Nov 11). Four runes wait at shrines out in the mine. Carry one to the cart station, fuel the carts with crystal
// shards, ride into the cordoned boss dungeon, hop off at the boss stop and put the rune in the statue's plinth; ride back; repeat. The fourth rune
// wakes the Mine Beast: it chases the carts for one lap (every hit pushes it back; if it reaches them it smashes them), then the carts roll back
// into the dungeon and everyone is pulled through the portal: wave cleared.
const LAYOUTS = new Map();   // a site's layout is always the same: built once per server (the mine takes ~250ms), so loading a map mid-game (the wave 20 mission) doesn't stall a tick
function siteLayout(i) { let L = LAYOUTS.get(i); if (!L) { const S = SITES[i], W = S.w || ARENA.width, H = S.h || ARENA.height; L = S.style === "dynasty" ? buildDynastyLayout(W, H, S.seed) : S.style === "whiteout" ? buildWhiteoutLayout(W, H, S.seed) : S.style === "refinery" ? buildRefineryLayout(W, H, S.seed) : S.style === "carnival" ? buildCarnivalLayout(W, H, S.seed) : S.style === "mine" ? buildMineLayout(W, H, S.seed) : S.style === "crucible" ? buildCrucibleLayout(W, H, S.seed) : buildMapLayout(W, H, S.seed); LAYOUTS.set(i, L); } return L; }
const DEEP = { wave: 20, site: 6, fuelCost: 5, fuelMax: 10, leave: 5, speed: 1.5, chaseSpeed: 1.12, awake: 7, gap0: 520, gapMax: 640, catchGap: 140, bounce: 420, gain: 45, stagger: 110, cartHp: 5,
  shardEvery: 4, shardCap: 16, drop: .4, takeR: 130, insertR: 210, zEvery: 1.3, zCap: [10, 5], flash: 3.2 };   // gain: px/s the Beast closes in; zCap: [base, per player] zombies alive at once
// THE MINE BEAST (the mission's boss): fought on foot inside the dungeon once the fourth rune wakes it. It can't be killed: empty its bar and it
// drops to a knee ("flee": get in the carts), then it chases them for a lap. Skills: DRILL STRIKE (two jabs), CRYSTAL SPINES (a fan of crystals that
// stick in the floor and shatter), CAVE-IN (rocks fall on marked circles, the lights go out), BURROW (dives, tunnels after someone, erupts under a
// marked circle), DRILL CHARGE (winds up, then charges down a marked lane: enough damage during the wind-up staggers it instead).
const PLATE = { dr: .25, hp: 30 };   // (Nov 12) THE PYRE PLATE: the Pyre Priest's armour. Drops when he dies, one per survivor; equip it in the backpack (T). For the rest of the run:
                                     // 25% less damage from everything (on top of Body Armour), +30 max HP, and you can't be set on fire. p.armor: 0 none, 1 in the backpack, 2 worn.
const BEAST = { hp: 3300, speed: 92, radius: 62, dmg: 22, gap: 2.4,
  strike: { range: 185, len: 1.15, hits: [.42, .7], reach: 225, half: 85, mult: [.9, 1.15], push: 150, cd: 1.2 },
  spines: { first: 5, cd: 10, len: 1.25, at: .6, n: 5, fan: 1.0, min: 220, max: 560, fly: .5, fuse: 1.5, r: 85, mult: 1 },
  cavein: { first: 10, cd: 17, len: 1.9, at: .5, delay: 1.35, r: 95, mult: 1.2, perPlayer: 2, extra: 3, dark: 5 },
  burrow: { first: 16, cd: 19, dive: 1.0, under: 3.4, speed: 204, warn: .9, r: 150, mult: 1.6, emerge: 1.0 },
  charge: { first: 24, cd: 16, wind: 1.8, speed: 512, len: 950, half: 95, mult: 1.7, push: 170, skid: .55, breakPct: .04 },
  stagger: 3.2, staggerMult: 1.5, fleeWait: 10,
  crystals: { n: 4, hpPct: .045, mult: 2, back: 2.0, stagger: 5.5 },   // Nov 12: the crystals on its back: hits from BEHIND (attacker > 115 deg off its facing) do x2 and chip them; all 4 broken = a long stagger
  phase2: { at: .5, speed: 1.15, cd: .75, extraRocks: 2 },   // Nov 12: below 50% HP: enraged (red crystals, which grow back), faster, shorter cooldowns, more rocks, chained attacks
  boulder: { r: 58, life: 16, cap: 5, stun: 3 },
  shield: { at: [.66, .33], plunge: 1.3, regen: .0015, pressure: 60, punish: .1, ovR: 150, ov: 3, stun: 6, express: 2.4, zEvery: 2.2, zCap: 6 } };   // Nov 12 (user): CRYSTAL SHIELD at 66% / 33%: it can't be hurt and slowly heals, fed by ONE rune shrine out in the mine. One survivor rides the cart there (the cart waits at that stop until they're back on), overloads it (F, stay 3s) and the shield shatters: 6s stun (+50%). Every 60s it's up: +10% HP.   // Nov 12: the cave-in rocks that miss leave boulders; charging into one stuns it (3s, it takes +50%)
const COASTER_NEAR = 300;   // how close to a coaster station (its platform / steps) you must be to board or queue
export function warmLayouts() { for (let i = 0; i < SITES.length; i++) if (!paintedOf(SITES[i])) siteLayout(i); }   // build every map once at boot, before anyone joins (the free Render server has 0.15 CPU: building them inside the first room stalled it for seconds)
export class SurvivalRoom extends Room {
  maxClients = 8;
  patchRate = 50;

  onCreate(options = {}) {
    // Every message handler is guarded: a bug logs an error (with the player and the message) instead of breaking the room.
    const onMsg = this.onMessage.bind(this);
    const PAUSE_BLOCK = new Set(["input", "dash", "coaster", "shoot", "attack", "charge", "melee", "ability", "ult", "skill2", "mechaSlash", "deep", "reload", "weapon", "meleeEquip", "slot",
      "revive", "reviveStop", "repairTower", "refuelGenerator", "repairGenerator", "build"]);   // (Nov 12) nobody can act while the host has the game paused
    this.onMessage = (type, cb) => onMsg(type, (client, data) => {
      if (this.state?.paused && PAUSE_BLOCK.has(type)) return;
      try { cb(client, data); } catch (e) { this.logErr(`message "${type}"`, e, client); }
    });
    // Unknown message types are ignored instead of kicking the player (Colyseus' default). A newer page talking to an older
    // server (the website updates before the game server during a deploy) used to disconnect people, e.g. "debugLevel" (Nov 5).
    const unknownSeen = new Set();
    onMsg("*", (client, type) => { if (unknownSeen.size < 50 && !unknownSeen.has(type)) { unknownSeen.add(type); this.log("warn", "room", `ignored unknown message "${type}" (page newer than the server?)`, client); } });
    this.autoDispose = true;
    this.solo = !!options.solo;   // set only by the single-player preview build (enables test helpers)
    this.axeSwing = new Map();
    this.setState(new GameState());
    this.state.players = new MapSchema();
    this.state.zombies = new MapSchema();
    this.state.structures = new MapSchema();
    this.state.robots = new MapSchema(); this.robotSeq = 0; this.robotFire = new Map(); this.supportMem = new Map(); this.shadowDash = new Map(); this.stormTick = new Map(); this.dots = new Map(); this.katanaMark = new Set(); this.slashCount = new Map(); this.ripples = []; this.hiveMem = new Map(); this.ultInfo = new Map(); this.state.vehicles = new MapSchema(); this.vmemory = new Map(); this.downHp = new Map(); this.briggs = new Map(); this.taunt = new Map(); this.hooks = new Map(); this.spins = new Map(); this.astra = new Map(); this.docRes = new Map(); this.unitMem = new Map(); this.safeBoxes = []; this.safeHit = new Map(); this.moveBudget = new Map(); this.inQ = new Map();
    this.state.noCd = true;   // test mode: Q unlocked from the start (no 100 kills needed). Cooldowns always apply (Nov 6). Host can switch it off in the Esc menu
    this.state.loot = new MapSchema();
    this.state.hookSpeed = BUTCHER.hook.speed;   // the preview starts at the real speed too (toggle: slow practice speed)
    this.state.puddles = new MapSchema(); this.spits = []; this.puddleSeq = 0;
    // the city: buildings, wrecks, trees... (solid) — same layout every match, sent to every player
    this.state.mapSite = 0; this.state.difficulty = "normal"; this.state.waveMode = "campaign"; this.state.friendlyFire = false; this.state.extraLoot = false;
    const site = Number.isInteger(options?.site) && options.site >= 0 && options.site < SITES.length ? options.site : DEFAULT_SITE;   // (tests pass site: 0 = a city)
    this.loadSite(site); siteLayout(DEEP.site);   // (the mission's map is built now, not mid-game)
    this.onCreateRest(options);
  }
  loadSite(i) {   // build the chosen map and its collision grid
    this.pathGrids = new Map(); this.flowCache = new Map();
    this.state.mapSite = i;
    const P = paintedOf(SITES[i]); this.painted = P;   // painted map: the world is the picture's size, the tower stands on the painted one
    const S = SITES[i], W = S.w || ARENA.width, H = S.h || ARENA.height;
    this.A = P ? { width: P.w, height: P.h, cx: P.tower[0], cy: P.tower[1], sx: P.start[0], sy: P.start[1], sh: 60 } : { width: W, height: H, cx: W / 2, cy: H / 2, sx: W / 2, sy: H / 2, sh: 100 };
    if (S.style === "mine") { const tx = MN_SPOT.tower[0] * W / 6000, ty = MN_SPOT.tower[1] * H / 4000; this.A = { width: W, height: H, cx: tx, cy: ty, sx: tx, sy: ty, sh: 100 }; }
    if (S.style === "crucible") { const [tx, ty] = KC_SPOT.tower; this.A = { width: W, height: H, cx: tx, cy: ty, sx: tx, sy: ty, sh: 100 }; }   // The Crucible: the tower stands in the middle strip, below the crucible   // The Deep Mine: the tower stands in the scavenge zone, top left   // sx, sy, sh: where survivors appear
    this.flow = !!P || ["dynasty", "whiteout", "refinery", "carnival", "mine", "crucible"].includes(S.style);   // maps with walls and big buildings: every zombie walks the flow field (no dead ends)
    this.state.worldW = this.A.width; this.state.worldH = this.A.height; this.state.towerX = this.A.cx; this.state.towerY = this.A.cy;
    const layout = P ? paintedLayout(P) : siteLayout(i);
    this.minePieces = S.style === "mine" ? { shrines: layout.filter(d => d.kind === "mShrine"), statue: layout.find(d => d.kind === "mStatue"), portal: layout.find(d => d.kind === "mPortal"), crystals: layout.filter(d => /^mCrystal/.test(d.kind)) } : null; if (S.style !== "mine") { this.mine = null; this.state.mission = ""; }
    this.cordon = S.style === "mine" ? mineCordon(W, H) : null;   // The Deep Mine: nobody gets into the boss dungeon except by cart (cordonCheck)
    const pyr = !P && layout.find(d => d.kind === "rPyramid" || d.kind === "cvHaunted" || d.kind === "mShaft" || d.kind === "kCrucible"); this.bossDoor = pyr ? { x: pyr.x, y: pyr.y - ({ rPyramid: 118, mShaft: 128, kCrucible: 150 }[pyr.kind] || 74) } : null;   // the Deep Mine: bosses climb out of the DANGER shaft
    if (this.state.players) for (const q of this.state.players.values()) { q.ride = 0; q.rideCd = 0; }
    const CT = S.style === "carnival" ? coasterTrack(W, H) : S.style === "mine" ? mineTrack(W, H) : null; this.coaster = CT ? { T: CT, K: CT.cfg || COASTER, s: CT.stations[0].s, wait: (CT.cfg || COASTER).wait, next: 0, riders: new Map(), cd: new Map(), queue: new Map() } : null;   // Midnight Carnival: the train starts at the first station
    this.state.coasterS = CT ? this.coaster.s : 0; this.state.coasterWait = CT ? this.coaster.K.wait : 0;   // Scorched Refinery: bosses walk out of the pyramid
    this.state.mapLayout = P ? "P:" + SITES[i].painted : packLayout(layout);   // clients build the painted map's boxes from PAINTED themselves
    this.siteBoxes = mapBoxes(layout); this.statueBody = statueBodyBoxes(layout); this.statueBroken = false; this.refreshMapBoxes();
    if (this.state.players) for (const p of this.state.players.values()) { p.x = this.A.sx + rand(-170, 170); p.y = this.A.sy + rand(-this.A.sh, this.A.sh); this.solveCollisions(p); }   // everyone onto the new map
  }
  onCreateRest(options) {
    this.steer = new Map();                 // zombie/bot id -> which way they go around obstacles
    this.state.stage = 1;
    this.state.elapsed = 0;
    this.state.stageDuration = 90;
    this.state.bossSpawned = false;
    this.state.bossDead = false;
    this.state.phase = "lobby";
    this.state.roomCode = this.roomId;
    this.log("info", "room", `room created${options.solo ? " (solo preview)" : ""}`);
    this.state.hostId = "";
    this.state.message = "Waiting for survivors. Host can start when ready.";
    this.state.totalKills = 0;
    this.state.towerMaxHp = 10000; this.state.towerHp = 10000;
    this.state.scrap = 100; this.state.electronics = 20; this.state.explosives = 10; this.state.fuel = 100;
    this.state.dayTime = 0; this.state.isNight = false;
    this.state.generatorMaxHp = 1200; this.state.generatorHp = 1200; this.state.generatorFuel = 100;
    this.state.waveType = "normal"; this.state.remaining = 0; this.state.matchTime = 0; this.state.countdown = 0;
    this.spawnClock = 0;
    this.structureSequence = 0;
    this.lootSequence = 0;
    this.zombieSequence = 0;
    this.lastInputs = new Map();
    this.enraged = new Set(); this.zStuck = new Map(); this.away = new Set();   // away: survivors whose connection dropped (30s to reconnect)
    this.lastMoveAt = new Map(); this.lastAimAt = new Map(); this.downs = new Map(); this.lastDashAt = new Map(); this.dodgeUntil = new Map(); this.inBreak = false; this.botBrain = new Map(); this.mags = new Map(); this.lastMelee = new Map(); this.fragHops = new Map(); this.cdrMem = new Map(); this.pyreFx = { patches: [], pillars: [], wheel: null }; this.scrFx = { rings: [], marks: [], frenzy: new Map() }; this.abFx = { puddles: [] }; this.pBurn = new Map(); this.lastItem = new Map(); this.chargeAt = new Map(); this.slamReady = new Map(); this.puddleDps = new Map(); this.acidTouch = new Map(); this.lungeAng = new Map(); this.bossMem = new Map(); this.introAcks = new Set();
    this.lastTick = Date.now();
    this.setSimulationInterval(() => this.tick(), 50);

    this.onMessage("pause", (client, data) => {   // (Nov 12) the host's Esc menu: the WHOLE game stops (zombies, attacks, damage, timers) until they close it
      if (!(this.solo || client.sessionId === this.state.hostId)) return; this.setPaused(!!data?.on && ["playing", "cleared"].includes(this.state.phase));
    });
    this.onMessage("start", (client, data) => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== "lobby") return;
      if (this.state.players.size < 1) return;
      this.state.explore = !!data?.explore;
      for (const p of this.state.players.values()) if (p.characterClass === "scout") { ravenLoadout(p); ravenReset(p); applyLoadout(p); }
      for (const p of this.state.players.values()) if (p.characterClass === "slasher") { arshanLoadout(p); applyLoadout(p); }
      for (const p of this.state.players.values()) if (p.characterClass === "juggernaut") { briggsLoadout(p); this.mags.delete(p.sessionId + ":shotgun"); this.loadMag(p); applyLoadout(p); }
      for (const p of this.state.players.values()) if (p.characterClass === "sniper") { siennaLoadout(p); this.mags.delete(p.sessionId + ":sniper"); this.loadMag(p); applyLoadout(p); }
      for (const p of this.state.players.values()) if (p.characterClass === "operator") { sofeaLoadout(p); this.mags.delete(p.sessionId + ":smg"); this.loadMag(p); applyLoadout(p); }
      for (const p of this.state.players.values()) if (p.characterClass === "demolitionist") { danteLoadout(p); this.mags.delete(p.sessionId + ":launcher"); this.loadMag(p); applyLoadout(p); }
      this.state.phase = "playing";
      this.state.elapsed = 0;
      this.state.message = "Wave 1/50: protect the radio tower!";
      this.beginWave();
      if (this.state.explore) this.state.message = "EXPLORE MODE: no zombies. Walk around freely. Host: Esc menu to start the waves.";
    });

    // Movement. Inputs from the game client carry a sequence number (s) and the time they cover (dt): they're queued and
    // applied at a steady rate in tick() (see drainInputs), so a player's position advances evenly every tick however
    // unevenly their packets arrive, and teammates see them move smoothly. Inputs without s (tests) apply at once.
    this.onMessage("input", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      if (p.ride > 0) { const seq = Number(data?.s); if (Number.isFinite(seq) && seq > (p.ack || 0)) p.ack = seq; const a = Number(data?.a); if (data?.a != null && Number.isFinite(a)) p.aim = a; return; }   // on the coaster: you only aim
      const veh = this.state.vehicles.get(client.sessionId);
      if (veh) {   // Sofea in her tank / helicopter: WASD drives it, the mouse aims the gun (not predicted: applied at once)
        const seq = Number(data?.s); if (Number.isFinite(seq) && seq > (p.ack || 0)) p.ack = seq;
        if (!p.alive || this.state.phase !== "playing") return;
        const t = Date.now(), dtv = Math.min(0.1, Math.max(0, (t - (this.lastInputs.get(client.sessionId) || t - 50)) / 1000)); this.lastInputs.set(client.sessionId, t);
        const a = Number(data?.a); if (data?.a != null && Number.isFinite(a)) { veh.aim = a; p.aim = a; }
        if (veh.phase === "ride") this.moveVehicle(p, veh, clamp(Number(data?.dx) || 0, -1, 1), clamp(Number(data?.dy) || 0, -1, 1), dtv);
        if (veh.kind === "heli" || veh.kind === "mecha") this.vmem(p).fireUntil = data?.f ? t + 300 : 0;   // helicopter gun / mecha flame: fires while she holds the left mouse button (each input says so; stops if they stop coming)
        return;
      }
      if (this.queueInput(client.sessionId, data, false)) return;
      this.applyMove(client.sessionId, p, data);
    });

    // Dash: a short 50px hop in the movement direction, once every 5 seconds (queued in order with the movement inputs).
    this.onMessage("dash", (client, data) => {
      const p = this.state.players.get(client.sessionId); if (!p || p.ride > 0) return;
      if (!this.queueInput(client.sessionId, data, true)) this.applyDash(client.sessionId, p, data);
    });
    // Midnight Carnival: F at a station while the train is stopped = get on (or off). One lap per ride, then COASTER.cd seconds before the next.
    this.onMessage("coaster", client => {
      const C = this.coaster, sid = client.sessionId, p = this.state.players.get(sid); if (!C || !p || !p.alive || !["playing", "cleared"].includes(this.state.phase)) return;
      if (this.mine && (this.mine.step === "awake" || (this.mine.step === "fight" && !this.mine.shield && !(p.ride > 0) && !C.T.stations.some(q => q.shrine !== undefined)))) return;   // (the Mine Beast fight is on foot: no hiding in the carts... except ONE rider on a shield run)
      if (this.mine?.step === "fight" && !(p.ride > 0) && C.riders.size) { this.state.message = "Only ONE rider: the rest of you hold the Beast off!"; return; }
      if (p.ride > 0) { if (C.wait > 0) this.coasterOff(sid); return; }
      if (this.state.vehicles.has(sid) || C.cd.has(sid)) return;
      const si = C.T.stations.findIndex(st => Math.hypot(p.x - st.x, p.y - (st.y + 40)) < COASTER_NEAR); if (si < 0) return;
      if (C.wait > 0 && si === C.next) { this.coasterBoard(sid); return; }
      if (C.queue.get(sid) === si) { C.queue.delete(sid); this.broadcast("coaster", { k: "unqueue", id: sid }); return; }   // F again: stop waiting
      C.queue.set(sid, si); this.broadcast("coaster", { k: "queue", id: sid });   // the train isn't here: you'll hop on when it stops at this station
    });

    this.onMessage("shoot", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || this.state.phase !== "playing") return;
      // Aimed shot: the client sends the angle toward the mouse cursor.
      const aim = Number(data?.a);
      if (data?.a === undefined || data?.a === null || !Number.isFinite(aim)) return;
      if (this.state.vehicles.has(p.sessionId)) { this.vehicleFire(p, aim, Number(data?.d)); return; }
      this.fireWeapon(p, aim, Number(data?.d));
    });

    this.onMessage("chooseClass", (client,data) => {
      const p=this.state.players.get(client.sessionId); const id=String(data?.id||"");
      const classes=this.allowAllClasses ? Object.keys(CLASS_STATS) : PICKABLE;   // Sofea (operator) was removed from the roster; Arshan (slasher) isn't pickable yet (tests can allow all)
      if(!p || this.state.phase!=="lobby" || !classes.includes(id)) return;
      p.characterClass=id;
      applyClassBase(p); p.robotCharges = ROBOT_CHARGES; p.chargeCd = 0;
      this.state.message=`${p.name} selected ${id.toUpperCase()}.`;
    });
    this.onMessage("ability", (client, data) => {
      const p=this.state.players.get(client.sessionId); if(!p?.alive||this.state.phase!=="playing"||p.abilityCooldown>0)return;
      const a = Number(data?.a); if (data?.a != null && Number.isFinite(a)) { p.aim = a; this.lastAimAt.set(client.sessionId, Date.now()); }   // skills go where the mouse points
      this.useAbility(p, data);
    });
    this.onMessage("weapon", (client,data) => {
      const p=this.state.players.get(client.sessionId);const w=String(data?.id||"");
      if(!p?.alive||!WEAPONS[w]||!p.owned.split(",").includes(w)){if(p&&WEAPONS[w])this.state.message=`${p.name}: buy the ${w} in the shop first.`;return;}this.storeMag(p);p[WEAPONS[w].slot]=w;this.setSlot(p,WEAPONS[w].slot==="primary"?2:3);
    });
    this.onMessage("gear", (client, data) => { const p = this.state.players.get(client.sessionId); if (p && String(data?.id) === "pyreplate") this.wearPlate(p, data?.on !== false); });   // (Nov 12) backpack: put on / take off the Pyre Plate
    this.onMessage("meleeEquip",(client,data)=>{
      const p=this.state.players.get(client.sessionId),id=String(data?.id||"");
      if(p&&(["knife","bat","axe","katana"].includes(id)||(id==="chainaxe"&&p.characterClass==="slasher"))){p.melee=id;p.charging=false;if(p.alive)this.setSlot(p,1);}
    });
    const playing = id => { const p = this.state.players.get(id); return p && p.alive && this.state.phase === "playing" && !this.state.vehicles.has(id) ? p : null; };   // in a vehicle: normal actions are off
    const angle = data => { const a = Number(data?.a); return data?.a === undefined || data?.a === null || !Number.isFinite(a) ? null : a; };
    // Left click: attack with whatever is in your hand (gun, melee or quick item).
    this.onMessage("attack", (client, data) => { const rider = this.state.vehicles.has(client.sessionId) && this.state.players.get(client.sessionId);
      if (rider) { const a = angle(data); if (rider.alive && a !== null) this.vehicleFire(rider, a, Number(data?.d)); return; }   // Sofea: left click fires the tank cannon / rockets
      const p = playing(client.sessionId), a = angle(data); if (p && (a !== null || p.activeSlot === 5)) this.attack(p, a ?? 0, !!data?.heavy, Number(data?.d)); });
    // Fire axe: start/stop charging a heavy swing (the swing itself comes with the "attack" on release).
    this.onMessage("charge", (client, data) => { const p = playing(client.sessionId); if (!p) return;
      if (data?.on && p.activeSlot === 1 && p.melee === "axe") { if (!p.charging) this.chargeAt.set(p.sessionId, Date.now()); p.charging = true; }
      else p.charging = false; });
    this.onMessage("melee", (client, data) => { const p = playing(client.sessionId); if (!p) return;
      let a = angle(data); if (a === null) { const z = [...this.state.zombies.values()].sort((m, n) => distance(p, m) - distance(p, n))[0]; a = z ? Math.atan2(z.y - p.y, z.x - p.x) : (p.aim || 0); }
      this.meleeAttack(p, a); });
    this.onMessage("slot", (client, data) => { const p = this.state.players.get(client.sessionId); if (p && p.alive) this.setSlot(p, Number(data?.n), !!data?.cycle); });
    this.onMessage("explore", (client, data) => { if (client.sessionId === this.state.hostId && this.state.phase === "playing") this.setExplore(!!data?.on); });
    // Solo preview only: jump straight to any wave (1-50) to test it.
    this.onMessage("debugWave", (client, data) => {
      const n = Math.round(Number(data?.n)); if (!(this.solo || this.state.hostId === client.sessionId) || !(n >= 1 && n <= 50) || this.state.phase === "lobby") return;   // the host can skip to any wave
      this.jumpToWave(n); this.state.message = (this.solo ? "Test: jumped" : "The host skipped") + ` to wave ${n}` + (this.state.waveType === "boss" ? " (BOSS WAVE)" : "");
    });
    // Solo preview only: spawn 5 of one zombie type close to you (to look at new art).
    this.onMessage("debugSpawn", (client, data) => {
      const p = this.state.players.get(client.sessionId), kind = String(data?.kind || "");
      if (!(this.solo || client.sessionId === this.state.hostId) || !p || this.state.phase !== "playing" || !["walker", "runner", "brute", "spitter", "mutant", "hivemind", "pyre", "screamer", "abomination"].includes(kind)) return;
      if (kind === "abomination") { this.spawnZombie(true, "abomination"); const z = [...this.state.zombies.values()].pop(); z.x = clamp(p.x + 520, 60, this.A.width - 60); z.y = p.y; this.solveZombie(z); this.state.message = "Test: the Abomination"; return; }
      if (kind === "screamer") { this.spawnZombie(true, "screamer"); const z = [...this.state.zombies.values()].pop(); z.x = clamp(p.x + 520, 60, this.A.width - 60); z.y = p.y; this.solveZombie(z); this.state.message = "Test: the Screamer"; return; }
      if (kind === "pyre") { this.spawnZombie(true, "pyre"); const z = [...this.state.zombies.values()].pop(); z.x = clamp(p.x + 450, 60, this.A.width - 60); z.y = p.y; this.solveZombie(z); this.state.message = "Test: the Pyre Priest"; return; }   // preview: the boss right away
      if (kind === "hivemind") { const was = this.state.explore; this.state.explore = false; const z = this.spawnHivemind(); this.state.explore = was; if (z) { z.x = clamp(p.x + 380, 60, this.A.width - 60); z.y = p.y; this.solveZombie(z); } return; }
      const was = this.state.explore; this.state.explore = false;
      for (let i = 0; i < 5; i++) {
        this.spawnZombie(false, kind);
        const z = [...this.state.zombies.values()].pop(), a = Math.random() * Math.PI * 2, d = 320 + Math.random() * 120;
        z.x = clamp(p.x + Math.cos(a) * d, 30, this.A.width - 30); z.y = clamp(p.y + Math.sin(a) * d, 30, this.A.height - 30); this.solveZombie(z);
      }
      this.state.explore = was;
      this.state.message = `Test: 5 ${kind}s spawned near you`;
    });
    // Q: Viktor's robot squad. data.kinds = up to 3 of "assault" | "support" | "hunter"
    this.onMessage("ult", (client, data) => { const p = this.state.players.get(client.sessionId); if (!p?.alive || this.state.phase !== "playing") return;
      const a = Number(data?.a); if (data?.a != null && Number.isFinite(a)) { p.aim = a; this.lastAimAt.set(client.sessionId, Date.now()); }
      this.useUlt(p, data); });
    this.onMessage("debugUlt", client => { const p = this.state.players.get(client.sessionId); if ((this.solo || client.sessionId === this.state.hostId) && p) { p.ultKills = ULT_KILLS; this.state.message = "Test: ultimate unlocked (100 kills)"; } });
    this.onMessage("ackBoss", client => {
      const p = this.state.players.get(client.sessionId); if (!p || this.state.bossPhase !== "intro") return;
      this.introAcks.add(client.sessionId); this.state.introReady = this.introAcks.size;
    });
    // Skip the horde and go straight to the Butcher intro. Solo preview, or the host in an online room.
    this.onMessage("debugMorph", client => {   // test: the Abomination at the moment he tears into the Five (starts his boss wave if he isn't here)
      const p = this.state.players.get(client.sessionId); if ((!this.solo && client.sessionId !== this.state.hostId) || !p || !["playing", "cleared"].includes(this.state.phase)) return;
      let z = [...this.state.zombies.values()].find(o => o.kind === "abomination");
      if (!z) { this.morphOnArrival = true; this.skipToBoss(24); return; }   /* (Nov 12: his wave is 24 now) */   // not here: his boss card first, then he arrives already tearing apart
      if (z.act === "sunder") return; z.hp = z.maxHp * ABOM.splitAt; z.act = ""; const m = this.bossMem.get(z.id); if (m) m.roll = null;
    });
    this.onMessage("deep", client => { const p = this.state.players.get(client.sessionId); if (this.mine && p?.alive && this.state.phase === "playing" && !(p.ride > 0)) this.mineUse(p); });   // F in the mine mission: take a rune / put it in the statue
    this.onMessage("debugMine", (client, data) => {   // test menu: start the mine mission (wave 20); {k: "rune"} = a rune goes straight in, {k: "fuel"} = full fuel
      if ((!this.solo && client.sessionId !== this.state.hostId) || !["playing", "cleared"].includes(this.state.phase)) return;
      const k = data?.k, pct = Number(data?.pct) > 0 && Number(data?.pct) < 1 ? Number(data.pct) : 0;   // Nov 12 (the new Esc menu): {k: "boss", pct: .66 / .33} = the Beast at that HP (its shield run comes up); {k: "chase"} / {k: "escape"} = straight to the end of the mission
      if (!this.mine) { this.jumpToWave(this.state.stage > 20 ? Math.ceil((this.state.stage - 20) / 24) * 24 + 20 : 20); if (!this.solo) this.state.message = "Host skipped to the mine mission"; if (!this.mine || !["boss", "chase", "escape"].includes(k)) return; }
      const m = this.mine;
      if (k === "boss") { this.beastHpOnArrival = pct; if (m.step === "runes") this.mineAwaken(); else if (m.step === "fight" && pct) this.beastSetHp(pct); return; }
      if (k === "chase" || k === "escape") { if (m.step === "runes") this.mineAwaken(); if (m.step === "awake") this.mineFight(); if (m.step === "fight") { const z = this.state.zombies.get(m.beast); if (z) this.mineFlee(z); } if (m.step === "flee") this.mineChase(); if (k === "escape" && m.step === "chase") this.mineEscape(); return; }
      if (data?.k === "fuel") this.mine.fuel = DEEP.fuelMax; else if (data?.k === "rune" && this.mine.step === "runes") { const r = this.mine.runes.find(q => q.st !== 3); if (r) this.mineInsert(r); }
    });
    this.onMessage("debugBoss", (client, data) => {   // {wave}: a boss wave (4, 8, ... 48); none = this wave's boss, else the Butcher
      if ((!this.solo && client.sessionId !== this.state.hostId) || !["playing", "cleared"].includes(this.state.phase)) return;
      const w = Math.round(Number(data?.wave)), pct = Number(data?.pct);   // Nov 12 (the new Esc menu): {pct: .66 / .33} = the boss arrives (or is set) at that much HP
      const here = [...this.state.zombies.values()].find(q => q.boss); if (pct > 0 && pct < 1 && here && this.state.bossPhase === "fight" && this.state.stage === w) { here.hp = here.maxHp * pct; this.state.message = `Test: the boss at ${Math.round(pct * 100)}% HP`; return; }
      this.bossHpOnArrival = pct > 0 && pct < 1 ? pct : 0; this.skipToBoss(w);
    });

    // Solo preview only: kill the boss (to watch it die) or knock it to 25% HP (to see it enrage).
    this.onMessage("debugBossHp", (client, data) => {
      const p = this.state.players.get(client.sessionId), z = [...this.state.zombies.values()].find(q => q.boss) || [...this.state.zombies.values()].find(q => q.kind === "hivemind");
      if (!(this.solo || client.sessionId === this.state.hostId) || !p || !z) return;
      if (data?.kill) this.killZombie(z, p); else z.hp = Math.min(z.hp, z.maxHp * .25);
    });
    this.onMessage("clientError", (client, data) => {   // errors from players' browsers (drawing, UI, connection) -> the game log
      const n = (this.errCount = (this.errCount || 0) + 1); if (n > 300) return;
      this.log(data?.lv === "warn" ? "warn" : "error", "client", String(data?.m || ""), client, { browser: String(data?.ua || "").slice(0, 80) });
    });
    this.onMessage("testNoCd", client => { if (client.sessionId !== this.state.hostId && !this.solo) return; this.state.noCd = !this.state.noCd; this.state.message = this.state.noCd ? "TEST MODE: ultimates unlocked from the start (cooldowns still apply)" : "Test mode off: ultimates unlock at 100 kills"; });
    this.onMessage("debugHookSpeed", client => { if (this.solo || client.sessionId === this.state.hostId) this.state.hookSpeed = this.state.hookSpeed === BUTCHER.hook.speed ? HOOK_SPEED_TEST : BUTCHER.hook.speed; });
    // Test tool (preview, or the host online): exactly enough XP for one more level; the player still picks the upgrade
    this.onMessage("debugLevel", client => {
      const p = this.state.players.get(client.sessionId); if (!p || !(this.solo || client.sessionId === this.state.hostId) || this.state.phase === "lobby") return;
      let banked = p.xp, L = p.level || 1; while (L < MAX_LEVEL && banked >= xpForLevel(L)) { banked -= xpForLevel(L); L++; }   // levels already waiting to be picked
      if (L >= MAX_LEVEL) { this.state.message = `${p.name} is already at the max level (${MAX_LEVEL})`; return; }
      p.xp += xpForLevel(L) - banked; this.state.message = `Test: ${p.name} has XP for level ${L + 1}`;
    });
    this.onMessage("debugGold", client => { const p = this.state.players.get(client.sessionId); if (this.solo && p) { p.currency += 200; this.state.message = "Test: +200 gold (G)"; } });
    this.onMessage("skill2", client => { const p = this.state.players.get(client.sessionId); if (!p?.alive || this.state.phase !== "playing") return;
      if (p.characterClass === "dispatcher") this.astraCast(p, "R");   // Astra's R: safehouse
      else if (p.characterClass === "operator") this.mechaKey(p); });   // Sofea's R: get in / out of the mecha
    // Sofea's mecha: right click = lightsaber swing
    this.onMessage("mechaSlash", (client, data) => { const p = this.state.players.get(client.sessionId), a = Number(data?.a);
      if (p?.alive && this.state.phase === "playing" && data?.a != null && Number.isFinite(a)) this.mechaSlash(p, a); });
    // ---- lobby: name, READY UP, mission settings (host) ----
    this.onMessage("setName", (client, data) => { const p = this.state.players.get(client.sessionId), n = cleanName(data?.name); if (p && n && this.state.phase === "lobby") p.name = n; });
    this.onMessage("breakReady", (client, data) => { const p = this.state.players.get(client.sessionId); if (p && this.state.phase === "cleared") p.ready = data?.on == null ? !p.ready : !!data.on; });   // between waves
    this.onMessage("ready", (client, data) => { const p = this.state.players.get(client.sessionId); if (p && this.state.phase === "lobby" && !p.isHost) p.ready = data?.on == null ? !p.ready : !!data.on; });
    this.onMessage("kick", (client, data) => {   // host removes a player from the lobby
      if (client.sessionId !== this.state.hostId || this.state.phase !== "lobby" || !data?.id || data.id === client.sessionId) return;
      const target = this.state.players.get(String(data.id)); if (!target || target.isBot) return;
      const c = this.clients?.find?.(x => x.sessionId === target.sessionId); this.state.message = `${target.name} was removed by the host.`;
      if (c) c.leave(4000); else this.state.players.delete(target.sessionId);
    });
    this.onMessage("settings", (client, data) => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== "lobby" || !data) return;
      // (Nov 12) no map choice any more: every match starts at Ascension and follows the map order (CHAPTERS)
      if (DIFFICULTY[data.difficulty]) this.state.difficulty = data.difficulty;
      if (data.waveMode === "campaign" || data.waveMode === "ascension") this.state.waveMode = data.waveMode;
      if (typeof data.friendlyFire === "boolean") this.state.friendlyFire = data.friendlyFire;
      if (typeof data.extraLoot === "boolean") this.state.extraLoot = data.extraLoot;
    });
    this.onMessage("reload", client => { const p = playing(client.sessionId); if (p) this.startReload(p); });
    this.onMessage("upgrade", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive) return;
      this.applyUpgrade(p, data?.id);
    });

    this.onMessage("revive", (client, data) => {
      const rescuer=this.state.players.get(client.sessionId);
      const target=this.state.players.get(String(data?.targetId||""));
      if(!rescuer?.alive||this.state.vehicles.has(client.sessionId)||!target||target.alive||target.bledOut||distance(rescuer,target)>85)return;
      if(rescuer.reviveTargetId===target.sessionId)return;   // already reviving them (held key / repeat): keep the progress
      rescuer.reviveTargetId=target.sessionId;rescuer.reviveProgress=0;
      this.state.message=`${rescuer.name} is reviving ${target.name}...`;
    });
    this.onMessage("reviveStop", client => { const r = this.state.players.get(client.sessionId); if (r) { r.reviveTargetId = ""; r.reviveProgress = 0; } });   // let go of F
    // Repair / refuel (F next to the tower / generator). Nov 9: you only pay for what's missing - near full costs less, full costs nothing -
    // and with too little for a full step you get what you can afford. STATION_STEP: one press = up to `amt` for `cost`.
    const station = (client, need, kind, amt, cost, apply, done) => {
      const p = this.state.players.get(client.sessionId);
      if (!p?.alive || this.state.vehicles.has(client.sessionId) || need < 1) return;
      if (p.characterClass === "operator") cost /= 2;   // Sofea's trait (Mechanic): repairs and refuels cost her half
      const have = this.state[kind], gain = Math.min(amt, need, have * amt / cost); if (gain <= 0) return;   // what you can afford
      const pay = Math.max(1, Math.ceil(cost * gain / amt - 1e-9)); if (pay > have) return;
      this.state[kind] -= pay; apply(gain, p); this.state.message = done(p, gain);
    };
    this.onMessage("repairTower", (client) => {
      const p = this.state.players.get(client.sessionId); if (!p || hyp(p.x - this.A.cx, p.y - this.A.cy) > STATION_R.tower) return;   // next to the tower
      station(client, this.state.towerMaxHp - this.state.towerHp, "scrap", STATION_STEP.tower.amt, STATION_STEP.tower.cost,
        (g, p) => { this.state.towerHp = Math.min(this.state.towerMaxHp, this.state.towerHp + g); p.towerRepairs += g; }, (p, g) => `${p.name} repaired the radio tower (+${Math.round(g)} HP).`);
    });
    this.onMessage("refuelGenerator", (client) => {
      const p = this.state.players.get(client.sessionId); if (!p || !this.nearGen(p)) return;
      station(client, 100 - this.state.generatorFuel, "fuel", STATION_STEP.fuel.amt, STATION_STEP.fuel.cost,
        g => { this.state.generatorFuel = Math.min(100, this.state.generatorFuel + g); }, p => `${p.name} refuelled the generator.`);
    });
    this.onMessage("repairGenerator", (client) => {
      const p = this.state.players.get(client.sessionId); if (!p || !this.nearGen(p)) return;
      station(client, this.state.generatorMaxHp - this.state.generatorHp, "scrap", STATION_STEP.gen.amt, STATION_STEP.gen.cost,
        g => { this.state.generatorHp = Math.min(this.state.generatorMaxHp, this.state.generatorHp + g); }, p => `${p.name} repaired the generator.`);
    });
    this.onMessage("build", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      const kind = String(data?.kind || "");
      const costs = { barricade:{scrap:15,hp:450}, turret:{scrap:35,electronics:8,hp:300}, mine:{scrap:8,explosives:3,hp:1}, fence:{scrap:25,electronics:5,hp:250}, flameTrap:{scrap:20,fuel:8,hp:180} };
      const cfg = costs[kind];
      if (!p?.alive || this.state.vehicles.has(client.sessionId) || !cfg || !["playing", "cleared"].includes(this.state.phase)) return;   // Nov 12: no team cap any more: each player has a cap per type (BUILD_CAP)
      if (this.state.scrap < (cfg.scrap||0) || this.state.electronics < (cfg.electronics||0) || this.state.explosives < (cfg.explosives||0) || this.state.fuel < (cfg.fuel||0)) return;
      { let tx = Number.isFinite(Number(data?.x)) ? Number(data.x) : p.x, ty = Number.isFinite(Number(data?.y)) ? Number(data.y) : p.y; const td = hyp(tx - p.x, ty - p.y);
        if (td > BUILD_RANGE) { tx = p.x + (tx - p.x) / td * BUILD_RANGE; ty = p.y + (ty - p.y) / td * BUILD_RANGE; }
        if (this.blockedByMap(tx, ty, 12)) { this.state.message = `${p.name}: can't build inside that.`; return; } }
      this.state.scrap -= cfg.scrap||0; this.state.electronics -= cfg.electronics||0; this.state.explosives -= cfg.explosives||0; this.state.fuel -= cfg.fuel||0;
      const st = new StructureState(); st.id = `s${++this.structureSequence}`; st.kind = kind;
      let bx = Number.isFinite(Number(data?.x)) ? Number(data.x) : p.x, by = Number.isFinite(Number(data?.y)) ? Number(data.y) : p.y;
      const bd = hyp(bx - p.x, by - p.y);
      if (bd > BUILD_RANGE) { bx = p.x + (bx - p.x) / bd * BUILD_RANGE; by = p.y + (by - p.y) / bd * BUILD_RANGE; }
      st.x = clamp(bx, 30, this.A.width-30); st.y = clamp(by, 30, this.A.height-30);
      st.hp = cfg.hp; st.maxHp = cfg.hp; st.ownerId = p.sessionId;
      if (kind === "turret") st.aim = Number.isFinite(Number(data?.face)) ? Number(data.face) : bd > 20 ? Math.atan2(by - p.y, bx - p.x) : 0;   // faces away from you until it has a target
      if (LINES[kind]) st.aim = snapFace(Number.isFinite(Number(data?.face)) ? Number(data.face) : bd > 20 ? Math.atan2(by - p.y, bx - p.x) : (p.aim || 0), LINES[kind]);   // across the way you face (face: what the client's preview showed)
      const mineOf = [...this.state.structures.values()].filter(o => o.kind === kind && o.ownerId === p.sessionId).sort((u, v) => parseInt(u.id.slice(1)) - parseInt(v.id.slice(1)));
      let replaced = 0; while (mineOf.length >= buildCap(p, kind)) { const old = mineOf.shift(); this.state.structures.delete(old.id); this.broadcast("buildGone", { x: Math.round(old.x), y: Math.round(old.y), kind }); replaced++; }   // at your cap: your OLDEST one of that type goes
      this.state.structures.set(st.id, st); p.structuresBuilt++;
      this.state.message = replaced ? `${p.name} built a ${kind} (replaced their oldest: max ${buildCap(p, kind)}).` : `${p.name} built a ${kind}.`;
    });
    // Host-only: after a win or loss, bring everyone back to the lobby for a fresh match.
    this.onMessage("restart", client => {
      if (client.sessionId !== this.state.hostId || !["victory", "defeat"].includes(this.state.phase)) return;
      this.resetMatch();
    });
    // Shop: only during the break between waves.
    this.onMessage("buy", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      const id = String(data?.id || ""), item = SHOP[id];
      if (!p || !item || this.state.phase !== "cleared") return;
      if (item.type === "weapon" && p.owned.split(",").includes(id)) return;
      if (item.max && p.armor >= item.max) return;
      if (id === "medkit" && p.medkits >= MAX_MEDKITS) return;
      if (p.currency < item.price) { this.state.message = `${p.name} needs ${item.price - p.currency} more gold for ${item.label}.`; return; }
      p.currency -= item.price;
      const s = this.state;
      if (item.type === "weapon") { this.unlockWeapon(p, id); this.storeMag(p); p[WEAPONS[id].slot] = id; this.setSlot(p, WEAPONS[id].slot === "primary" ? 2 : 3); }
      else if (id === "medkit") p.medkits += 1;
      else if (id === "ammo") p.ammo += 90;
      else if (id === "scrap") s.scrap += 40;
      else if (id === "electronics") s.electronics += 8;
      else if (id === "fuel") s.fuel += 30;
      else if (id === "explosives") s.explosives += 5;
      s.message = `${p.name} bought ${item.label}.`;
    });

    // AI teammates: the host can add or remove bots in the lobby (bots fill empty slots).
    this.onMessage("addBot", client => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== "lobby" || this.state.players.size >= 8) return;
      const used = new Set([...this.state.players.values()].map(p => p.name));
      const name = "Bot " + (BOT_NAMES.find(n => !used.has("Bot " + n)) || "X");
      const id = "bot-" + Math.random().toString(36).slice(2, 8);
      this.onJoin({ sessionId: id }, { name });
      const b = this.state.players.get(id);
      b.isBot = true; b.ready = true;
      const classes = PICKABLE;
      b.characterClass = classes[Math.floor(Math.random() * classes.length)];
      applyClassBase(b);
      this.botBrain.set(id, { strafe: Math.random() < 0.5 ? 1 : -1, nextThink: 0 });
      this.state.message = `${name} (${b.characterClass}) joined as an AI teammate.`;
    });
    this.onMessage("removeBot", (client, data) => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== "lobby") return;
      const bot = data?.id ? [...this.state.players.values()].find(p => p.isBot && p.sessionId === data.id) : [...this.state.players.values()].reverse().find(p => p.isBot);
      if (bot) { this.state.players.delete(bot.sessionId); this.botBrain.delete(bot.sessionId); this.state.message = `${bot.name} left.`; }
    });

    // Host can skip the countdown and start the next wave right away.
    this.onMessage("nextStage", client => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== "cleared") return;
      this.startNextWave();
    });
  }

  travel(site) {   // (Nov 12) on to the next map in the order: what the team built and anything on the ground stay behind (an unclaimed Pyre Plate is handed out first)
    const s = this.state; this.handOutPlates(); this.dismountAll();
    s.structures.clear(); s.loot.clear(); s.puddles.clear(); s.robots.clear(); s.zombies.clear(); this.astra.clear(); this.unitMem.clear(); this.safeBoxes = []; this.spits = []; this.ripples = []; this.pBurn.clear();
    this.loadSite(site); s.towerHp = s.towerMaxHp; s.generatorHp = s.generatorMaxHp;
    for (const p of s.players.values()) if (!p.alive) { p.alive = true; p.bledOut = false; p.bleedout = 0; p.hp = Math.round(p.maxHp * .5); }   // the downed are carried along
    const ch = chapterOf(s.stage + (s.phase === "cleared" ? 1 : 0)), n = CHAPTERS.indexOf(ch) + 1;
    this.broadcast("travel", { site, n, standIn: !!ch.standIn }); this.log("info", "game", `the team moved on to map ${n} (site ${site})`);
  }
  dropPlates(z) {   // the Pyre Priest's armour falls around his body: one per survivor who hasn't got one (anything left unclaimed is handed out when the next wave starts)
    const need = [...this.state.players.values()].filter(p => !p.armor); if (!need.length) return; this.platesOut = true;
    need.forEach((p, i) => { const it = new LootState(), a = i / need.length * Math.PI * 2 + rand(-.3, .3); it.id = `l${++this.lootSequence}`; it.kind = "pyreplate"; it.amount = 1; it.rarity = "Legendary";
      const P = clamp(z.x + Math.cos(a) * 70, 40, this.A.width - 40), Q = clamp(z.y + Math.sin(a) * 45, 40, this.A.height - 40); it.x = P; it.y = Q; this.state.loot.set(it.id, it); });
    this.broadcast("plateDrop", { x: Math.round(z.x), y: Math.round(z.y), n: need.length });
    this.state.message = "THE PYRE PLATE dropped! Grab one each, then equip it in your backpack (T).";
  }
  givePlate(p, found) {   // into the backpack (bots put it straight on)
    if (p.armor) return; p.armor = 1; if (p.isBot) this.wearPlate(p, true);
    if (found) { this.state.message = p.isBot ? `${p.name} put on the Pyre Plate.` : `${p.name} got the PYRE PLATE! Press T and double-click it to wear it.`; this.broadcast("plateGot", { id: p.sessionId }); }
  }
  wearPlate(p, on) {   // worn: -25% damage, +30 max HP, fireproof (for the rest of the run)
    if (!p.armor || (p.armor === 2) === on) return; p.armor = on ? 2 : 1;
    if (on) { p.maxHp += PLATE.hp; if (p.alive) p.hp = Math.min(p.maxHp, p.hp + PLATE.hp); this.pBurn.delete(p.sessionId); } else { p.maxHp = Math.max(1, p.maxHp - PLATE.hp); p.hp = Math.min(p.hp, p.maxHp); }
  }
  handOutPlates() {   // the next wave: whoever didn't pick theirs up still gets it (nobody misses out)
    if (!this.platesOut) return; this.platesOut = false;
    for (const it of [...this.state.loot.values()]) if (it.kind === "pyreplate") this.state.loot.delete(it.id);
    for (const p of this.state.players.values()) if (!p.armor) this.givePlate(p, false);
  }
  beginBreak() {   // the wave is over: every zombie left dies (no stragglers), the ground clears; nobody's ready yet. Survivors can walk around + build.
    this.inBreak = true; this.state.countdown = BREAK_SECONDS; for (const p of this.state.players.values()) p.ready = false;
    const next = chapterOf(this.state.stage + 1); if (next.site !== this.state.mapSite && !this.mine && !this.fixedSite) { this.travel(next.site); this.state.message = `Boss down! Welcome to ${next.name}: wave ${this.state.stage + 1} starts here.`; }   // (Nov 12) the boss is down: on to the next map for the break
    this.state.zombies.clear(); this.state.puddles.clear(); this.spits = []; this.dots.clear(); this.taunt.clear(); this.sweepZombieMemory();
    this.pyreFx = { patches: [], pillars: [], wheel: null }; this.scrFx = { rings: [], marks: [], frenzy: new Map() }; this.abFx = { puddles: [] }; this.pBurn.clear();
  }
  startNextWave() {
    const s = this.state;
    this.inBreak = false; s.countdown = 0; for (const p of s.players.values()) p.ready = false;
    this.handOutPlates();
    s.stage++;
    s.elapsed = 0;
    s.bossSpawned = false;
    s.bossDead = false;
    s.zombies.clear(); this.sweepZombieMemory();
    s.phase = "playing";
    this.downs.clear();
    for (const p of s.players.values()) { p.hp = p.maxHp; p.alive = true; p.bledOut = false; p.bleedout = 0; }
    s.message = `Wave ${s.stage}/50: the infected are getting stronger!`;
    this.beginWave();
  }

  resetMatch() {
    this.away.clear();
    const s = this.state;
    s.stage = 1; s.elapsed = 0; s.matchTime = 0; s.totalKills = 0;
    s.bossSpawned = false; s.bossDead = false; s.waveType = "normal"; s.remaining = 0;
    s.towerHp = s.towerMaxHp;
    s.scrap = 100; s.electronics = 20; s.explosives = 10; s.fuel = 100;
    s.generatorHp = s.generatorMaxHp; s.generatorFuel = 100;
    s.dayTime = 0; s.isNight = false; s.explore = false; s.bossPhase = ""; s.bossIntro = "";
    s.zombies.clear(); this.pyreFx = { patches: [], pillars: [], wheel: null }; this.scrFx = { rings: [], marks: [], frenzy: new Map() }; this.abFx = { puddles: [] }; this.pBurn.clear(); s.structures.clear(); s.loot.clear(); s.puddles.clear(); s.robots.clear(); s.vehicles.clear(); this.vmemory.clear(); this.briggs.clear(); this.taunt.clear(); this.hooks.clear(); this.spins.clear(); this.astra.clear(); this.docRes.clear(); this.unitMem.clear(); this.safeBoxes = []; this.ultInfo.clear(); this.spits = []; this.ripples = [];
    this.enraged.clear(); this.spawnClock = 0; this.downs.clear(); this.inBreak = false; s.countdown = 0;
    for (const p of s.players.values()) {
      p.x = this.A.sx + rand(-170, 170); p.y = this.A.sy + rand(-this.A.sh, this.A.sh); this.solveCollisions(p);
      p.level = 1; p.xp = 0; p.xpNext = 30;
      p.kills = 0; p.killLeadSince = 0; p.bossDamage = 0; p.revives = 0; p.damageDealt = 0; p.damageTaken = 0;
      p.towerRepairs = 0; p.structuresBuilt = 0; p.headshots = 0;
      p.bonusDamage = 0; p.rateMult = 1; p.buffDamage = 0; p.buffRate = 1; p.cdr = 0; p.hands = 0; p.armorPct = 0;
      p.currency = 0; p.owned = STARTER_WEAPONS; p.armor = 0; p.primary = "rifle"; p.secondary = "pistol"; p.activeSlot = 2; p.weapon = "rifle"; p.medkits = 1; p.reloadLeft = 0; p.stunned = 0; p.slowed = 0; p.ultKills = 0; p.ultCd = 0; p.ultReady = false; p.robotCharges = ROBOT_CHARGES; p.chargeCd = 0;
      this.mags.delete(p.sessionId + ":rifle"); this.mags.delete(p.sessionId + ":pistol"); this.loadMag(p);
      p.ammo = 240; p.abilityCooldown = 0; p.bleedout = 0; p.reviveProgress = 0; p.reviveTargetId = "";
      p.alive = true; p.bledOut = false; p.lastShot = 0; p.facing = 1; p.aim = 0;
      applyClassBase(p);
    }
    if (this.mine || this.mineBack) this.endMine(false);
    if (s.mapSite !== CHAPTERS[0].site) this.loadSite(CHAPTERS[0].site);   // a new match: back to Ascension
    s.phase = "lobby";
    s.message = "New match! Pick your survivors, then the host starts.";
  }

  // Test helper: restart at wave n (clears zombies, revives everyone).
  jumpToWave(n) {
    this.dismountAll();
    this.state.zombies.clear(); this.state.puddles.clear(); this.spits = []; this.state.stage = n; this.state.phase = "playing"; this.state.explore = false;
    this.inBreak = false; this.state.countdown = 0; this.enraged.clear();
    for (const p of this.state.players.values()) if (!p.alive) { p.alive = true; p.bledOut = false; p.hp = p.maxHp; }
    this.beginWave();
  }
  beginWave() {
    this.bossOverAt = 0;
    this.state.elapsed = 0; this.spawnClock = 0.2; this.state.bossSpawned = false; this.state.bossDead = false; this.hiveSpawned = false; this.hiveNag = false;
    this.state.waveType = this.state.stage % 4 === 0 || this.state.stage === 50 ? "boss" : "normal";
    this.state.bossPhase = ""; this.state.bossIntro = "";
    if (this.mine || this.mineBack) this.endMine(false);   // (a test jump out of the mission)
    const ch = chapterOf(this.state.stage); if (ch.site !== this.state.mapSite && !this.fixedSite) this.travel(ch.site);   // (fixedSite: tests that look at one map)   // a new map (or a test jump): go there first
    if (ch.mission && this.state.stage % 4 === 0) { this.startMine(); return; }
    // Boss waves: first a horde (walkers on wave 4); once it's cleared, the boss intro card; when everyone is ready, the boss.
    if (this.state.waveType === "boss") { this.state.bossPhase = "horde"; this.state.message = `BOSS WAVE ${this.state.stage}: clear the horde... something big is coming.`; }
    else this.state.message = `Wave ${this.state.stage}/50 — survive for 90 seconds.` + (isHiveWave(this.state.stage) ? " Something is stirring..." : "");
  }
  skipToBoss(w) {   // straight to a boss wave's intro card (the horde is skipped)
    const want = w >= 4 && w <= 48 && w % 4 === 0 ? w : 0;
    if (this.state.waveType !== "boss" || this.state.phase !== "playing" || (want && this.state.stage !== want)) this.jumpToWave(want || 4);
    else if (["intro", "fight"].includes(this.state.bossPhase)) return;   // already there
    if (!this.solo) this.state.message = "Host skipped to the boss fight";
    this.state.zombies.clear(); this.state.elapsed = BOSS_WAVE.horde; this.state.bossPhase = "horde"; this.state.explore = false;
  }
  bossKind() { return this.state.stage === 50 ? "apocalypse" : chapterOf(this.state.stage).boss; }
  bossWaveTick(dt, now) {
    const s = this.state;
    if (s.bossPhase === "horde") {
      if (this.spawnClock <= 0 && s.elapsed < BOSS_WAVE.horde) {
        this.spawnZombie(false);   // the horde uses the wave's normal mix; once the boss is out, only walkers come
        const early = { 4: 1.3 }[s.stage]; this.spawnClock = (early || Math.max(0.3, 1.15 - s.stage * 0.018)) / this.spawnScale();
      }
      if (s.elapsed >= BOSS_WAVE.horde + BOSS_WAVE.straggleGrace && s.zombies.size > 0 && s.zombies.size <= BOSS_WAVE.straggleMax && ![...s.zombies.values()].some(z => z.boss))
        s.zombies.clear();   // a last straggler stuck far away doesn't hold the boss back (sims: the wave could hang forever)
      if (s.elapsed >= BOSS_WAVE.horde && s.zombies.size === 0) {
        s.bossPhase = "intro"; s.bossIntro = this.bossKind(); this.introAcks = new Set(); this.introUntil = now + BOSS_WAVE.introWait * 1000;
        s.introNeed = [...s.players.values()].filter(p => !p.isBot).length; s.introReady = 0;
        s.message = "Horde cleared... the boss is coming!";
      }
    } else if (s.bossPhase === "intro") {
      if (s.introReady >= s.introNeed || now >= this.introUntil) this.spawnBoss();
    } else if (s.bossPhase === "fight") {
      if (this.spawnClock <= 0) { if (s.zombies.size < BOSS_WAVE.escortMax) this.spawnZombie(false, "walker"); this.spawnClock = BOSS_WAVE.escortEvery; }
    }
  }
  spawnBoss() {
    const s = this.state; s.bossPhase = "fight"; s.bossIntro = ""; s.bossSpawned = true; this.spawnClock = BOSS_WAVE.escortEvery;
    this.log("info", "boss", `boss fight started on wave ${s.stage}`);
    if (this.bossKind() === "hivemind") this.spawnHivemind(true); else this.spawnZombie(true);
    const z = [...s.zombies.values()].find(q => q.boss), alive = [...s.players.values()].filter(p => p.alive);
    if (z && alive.length) {   // walk in from ~650px away from the team, not from the far side of the map
      const cx = alive.reduce((a, p) => a + p.x, 0) / alive.length, cy = alive.reduce((a, p) => a + p.y, 0) / alive.length, ang = Math.random() * Math.PI * 2;
      z.x = clamp(cx + Math.cos(ang) * 650, 60, this.A.width - 60); z.y = clamp(cy + Math.sin(ang) * 650, 60, this.A.height - 60); this.solveZombie(z);
    }
    if (this.bossHpOnArrival && z) { z.hp = z.maxHp * this.bossHpOnArrival; this.bossHpOnArrival = 0; }   // (test menu: the boss arrives at 66% / 33%)
    if (this.morphOnArrival) { this.morphOnArrival = false; if (z?.kind === "abomination") { z.hp = z.maxHp * ABOM.splitAt; if (alive.length) { z.x = clamp(alive[0].x + 480, 60, this.A.width - 60); z.y = alive[0].y; this.solveZombie(z); } } }   // test button: skip to the split
    if (z && this.bossDoor) { z.x = this.bossDoor.x; z.y = this.bossDoor.y; z.aim = Math.PI / 2; this.solveZombie(z); this.broadcast("pyramid", { x: Math.round(z.x), y: Math.round(z.y) }); }
    this.broadcast("roar", { x: Math.round(z?.x || 0), y: Math.round(z?.y || 0) });
    s.message = z?.kind === "hivemind" ? "THE ALPHA HIVEMIND HAS ARRIVED!" : `${String(z?.kind || "boss").replace(/[A-Z]/g, m => " " + m).toUpperCase()} HAS ARRIVED!`;
  }

  watchSocket(client) {   /* log WHY a socket closed (1001 page reloaded/closed, 1006 network cut, 1009 message too big, 4002 server error) */
    try { const ws = client?.ref; if (!ws?.on) return; const ip = String(ws._socket?.remoteAddress || "");
      ws.on("close", (code, reason) => { if (code !== 4000 && code !== 1000) this.log("warn", "socket", `socket closed: code ${code}${reason?.length ? " (" + String(reason).slice(0, 80) + ")" : ""}, ${ws.bufferedAmount || 0} bytes unsent`, client); });
      ws.on("error", e => this.log("warn", "socket", `socket error: ${e?.code || ""} ${e?.message || e}`, client)); } catch {}
  }
  onJoin(client, options = {}) {
    this.watchSocket(client);
    if (this.state.players.size >= 8) throw new Error("This room is full (8/8).");
    if (this.pyreFx?.wheel && client.send) setTimeout(() => { try { if (this.pyreFx.wheel) client.send("pyre", this.wheelMsg(Date.now())); } catch {} }, 1500);   // joined mid-wheel: show it
    const p = new PlayerState();
    p.sessionId = client.sessionId;
    p.name = cleanName(options.name) || `Survivor ${this.state.players.size + 1}`;
    p.x = this.A.sx + rand(-170, 170); p.y = this.A.sy + rand(-this.A.sh, this.A.sh); this.solveCollisions(p);
    p.hp = 100; p.maxHp = 100; p.level = 1; p.xp = 0; p.xpNext = 30;
    p.characterClass = "assault"; p.abilityCooldown = 0; p.bleedout = 0; p.weapon = "rifle"; p.melee = "knife"; p.ammo = 240; p.currency = 0; p.owned = STARTER_WEAPONS; p.armor = 0; p.isBot = false; p.primary = "rifle"; p.secondary = "pistol"; p.activeSlot = 2; p.medkits = 1; p.reloadLeft = 0; p.stunned = 0; p.slowed = 0; p.ultKills = 0; p.ultCd = 0; p.ultReady = false; p.robotCharges = ROBOT_CHARGES; p.chargeCd = 0;
    p.kills = 0; p.killLeadSince = 0; p.bossDamage = 0; p.revives = 0; p.damageDealt = 0; p.damageTaken = 0; p.towerRepairs = 0; p.structuresBuilt = 0; p.headshots = 0; p.bonusDamage = 0; p.rateMult = 1; p.buffDamage = 0; p.buffRate = 1; p.cdr = 0; p.hands = 0; p.armorPct = 0; p.facing = 1; p.aim = 0; p.bledOut = false; p.charging = false;
    const profile=options.profile&&typeof options.profile==="object"?options.profile:{};
    p.level = 1; p.xp = 0; p.xpNext = xpForLevel(1); p.currency = 0;   // every run starts at level 1 (upgrades don't carry over either)
    const classIds=PICKABLE;
    if(classIds.includes(profile.characterClass)) p.characterClass=profile.characterClass;
    applyClassBase(p);
    this.loadMag(p);
    p.alive = true; p.isHost = this.state.players.size === 0; p.ready = p.isHost;   // lobby READY UP (the host counts as ready)
    p.color = COLORS[this.state.players.size % COLORS.length]; p.lastShot = 0; p.reviveProgress = 0; p.reviveTargetId = "";
    this.state.players.set(client.sessionId, p);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    this.log("info", "join", `${p.name} joined (${this.state.players.size} in room${this.solo ? ", solo preview" : ""})`, client);
    this.state.message = `${p.name} joined (${this.state.players.size}/8).`;
  }

  onDispose() { this.log("info", "room", `room closed (reached wave ${this.state.stage}, ${this.state.totalKills || 0} kills)`); }
  // A dropped connection mid-match (wifi blip, phone screen off, Render hiccup) keeps the survivor's seat for 30s: the client reconnects
  // with its token and carries on with the same hero, level and gear. While away they stand still and can't be hurt or targeted.
  async onLeave(client, consented) {
    const p = this.state.players.get(client.sessionId);
    if (p && !consented && !p.isBot && this.state.phase !== "lobby" && typeof this.allowReconnection === "function") {
      this.away.add(client.sessionId); this.lastInputs.delete(client.sessionId); this.inQ?.delete(client.sessionId); p.charging = false; p.reviveTargetId = ""; p.reviveProgress = 0;
      this.state.message = `${p.name} lost connection... holding their spot for 30s.`; this.log("warn", "leave", `${p.name} lost connection: 30s to come back`, client);
      this.broadcast("away", { id: client.sessionId, on: true });   // clients: "RECONNECTING…" tag + faded sprite
      try { const back = await this.allowReconnection(client, 30); this.watchSocket(back || client); this.away.delete(client.sessionId); this.broadcast("away", { id: client.sessionId, on: false }); this.state.message = `${p.name} is back!`; this.log("info", "join", `${p.name} reconnected`, client);
        if (this.pyreFx?.wheel) setTimeout(() => { try { if (this.pyreFx.wheel) (back || client).send("pyre", this.wheelMsg(Date.now())); } catch {} }, 1500); return; }
      catch { this.away.delete(client.sessionId); this.broadcast("away", { id: client.sessionId, on: false }); if (!this.state.players.has(client.sessionId)) return; }   // never came back (or the match was reset meanwhile)
    }
    if (p) this.log(consented ? "info" : "warn", "leave", consented ? `${p.name} left` : `${p.name} lost connection (closed the tab, network drop or the page froze)`, client);
    if (p) this.state.message = `${p.name} left the room.`;
    this.state.players.delete(client.sessionId); this.state.vehicles.delete(client.sessionId); this.vmemory.delete(client.sessionId); this.hooks.delete(client.sessionId); this.spins.delete(client.sessionId);
    this.lastInputs.delete(client.sessionId); this.inQ?.delete(client.sessionId);
    if (this.state.hostId === client.sessionId) {
      const next = [...this.state.players.values()].find(p => !p.isBot);
      this.state.hostId = next ? next.sessionId : "";
      if (next) { next.isHost = true; next.ready = true; }
      this.setPaused(false);   // the new host decides when to pause
    }
    if (![...this.state.players.values()].some(p => !p.isBot)) { this.state.players.clear(); this.botBrain.clear(); }
    if (this.state.players.size === 0) this.state.phase = "lobby";
  }

  // Explore mode (host): waves stop, all zombies vanish, the wave timer freezes; day/night keeps going.
  setExplore(on) {
    this.state.explore = !!on;
    if (on) { this.state.zombies.clear(); this.state.message = "EXPLORE MODE: waves stopped. Walk around freely."; }
    else {
      if (this.state.bossPhase === "fight" && !this.state.bossDead && ![...this.state.zombies.values()].some(z => z.boss)) this.spawnBoss();
      this.state.message = "Waves resumed!";
    }
  }
  spawnZombie(boss = false, forceKind = "") {
    if (this.state.explore) return;
    // appear somewhere on a ring around the radio tower, out of the players' view
    const { x, y } = this.spawnPoint();

    const kind = forceKind ? forceKind : boss ? this.bossKind() : pickKind(this.state.stage);
    const scale = 1 + (this.state.stage - 1) * 0.08;
    const base = { walker:38, runner:25, brute:105, spitter:42, mutant:140, butcher:2000, pyre:PYRE.hp, plagueBrute:1500, screamer:SCREAMER.hp, abomination:1700, devourer:1500, stalker:1000, boneCrusher:1800, hiveMother:1900, executioner:1600, colossus:2500, reaper:1800, undeadKing:2400, apocalypse:6500 }[kind] || 900;
    const z = new ZombieState();
    z.id = `z${++this.zombieSequence}`; z.kind = kind; z.x = x; z.y = y;
    z.maxHp = base * scale * (boss ? 1 + BOSS_HP_PER_PLAYER * Math.max(0, this.state.players.size - 1) : 1);
    z.hp = z.maxHp; z.speed = ({walker:57,runner:125,brute:34,spitter:28,mutant:105}[kind] || (boss?42:55)) * (this.state.isNight?1.2:1);
    z.damage = ({walker:8,runner:7,brute:18,spitter:6,mutant:16}[kind] || (boss?28:10)) * scale * (this.state.isNight ? (kind === "mutant" ? MUTANT.night : 1.3) : 1);
    const D = DIFFICULTY[this.state.difficulty] || DIFFICULTY.normal; z.maxHp *= D.hp; z.hp = z.maxHp; z.damage *= D.dmg;   // lobby difficulty
    z.radius = boss ? 42 : kind === "brute" ? 33 : kind === "mutant" ? 18 : 14; z.attackCooldown = 0;   // brutes are 50% bigger than before
    this.solveZombie(z);   // don't appear inside a building
    z.targetId = ""; z.boss = boss;
    z.role = boss || TOWER_KINDS[kind] ? "tower" : "hunter"; z.slam = 0; z.act = ""; z.hookId = ""; z.enraged = false;
    if (kind === "butcher") { z.speed = BUTCHER.speed * (this.state.isNight ? 1.1 : 1); z.radius = 40; }
    if (kind === "pyre") { z.speed = PYRE.speed; z.radius = PYRE.radius; z.damage = PYRE.dmg * scale * (this.state.isNight ? 1.2 : 1) * D.dmg; z.role = "hunter"; }   // hunts survivors only
    if (kind === "screamer") { z.speed = SCREAMER.speed; z.radius = SCREAMER.radius; z.damage = SCREAMER.dmg * scale * (this.state.isNight ? 1.2 : 1) * D.dmg; z.role = "hunter"; }
    if (kind === "abomination") { z.maxHp *= ABOM.hp / 1700; z.hp = z.maxHp; z.speed = ABOM.speed; z.radius = ABOM.radius; z.damage = ABOM.dmg * scale * (this.state.isNight ? 1.2 : 1) * D.dmg; z.role = "hunter"; }
    if (kind === "spitter") z.attackCooldown = 0.6 + Math.random() * 1.6;   // spitters don't all fire at once
    this.state.zombies.set(z.id, z);
  }

  // One shot from player p toward angle aim. Used by humans and AI bots alike.
  fireWeapon(p, aim, dist) {
    const now = Date.now();
    if (p.stunned > 0 || !WEAPONS[p.weapon] || p.storm > 0 || this.shadowDash.has(p.sessionId) || (p.characterClass === "slasher" && this.arshanBusy(p))) return;
    if (p.shadow > 0) this.breakShadow(p);   // attacking ends Raven's invisibility
    const rage = this.shotgunRage(p, now);   // Briggs's War Cry: shotgun spam, no ammo
    if (rage && p.reloadLeft > 0) p.reloadLeft = 0;
    if (p.reloadLeft > 0) return;
    if (now - p.lastShot < 1000 / (p.fireRate * (rage ? BRIGGS.rage.rateMult : 1))) return;
    const w = WEAPONS[p.weapon] || WEAPONS.rifle;
    if (p.mag <= 0 && !rage) {
      if (!w.infinite && p.ammo <= 0) { // out of spare ammo: fall back to the pistol
        p.secondary = "pistol"; this.setSlot(p, 3); this.event(`${p.name} is out of ammo, switching to pistol.`);
      } else this.startReload(p);
      return;
    }
    p.lastShot = now;
    if (!rage) { p.mag -= 1; if (p.mag <= 0) this.startReload(p); }   // automatic reload the moment the magazine runs dry (R is everyone's 3rd skill now)
    p.aim = aim;
    this.lastAimAt.set(p.sessionId, now);
    if (!this.recentlyMoved(p.sessionId)) p.facing = Math.cos(aim) < 0 ? -1 : 1;
    const tracers = [];
    const angles = w.pellets
      ? Array.from({ length: w.pellets }, (_, i) => aim + (i / (w.pellets - 1) - 0.5) * 2 * w.spread)
      : [aim + (w.jitter ? rand(-w.jitter, w.jitter) : 0)];
    for (const a of angles) {
      const wall = this.wallDist(p.x, p.y, a, w.range);          // buildings, cars... stop bullets
      const along = this.rayHits(p, a, wall);
      let end = wall;
      if (w.splash) {   // rocket: flies straight to the aimed spot (or max range / a wall), then explodes there
        const want = Number.isFinite(dist) && dist > 20 ? dist : w.range;
        end = Math.max(20, Math.min(wall - 4, want));
        const bx = p.x + Math.cos(a) * end, by = p.y + Math.sin(a) * end;
        this.ripples.push({ kind: "rocket", owner: p.sessionId, x: bx, y: by, t: now, at: end / DANTE.rocketSpeed, dmg: p.damage, r: w.splash, flat: 1, push: 10, wallSafe: true });
      } else {
        const hits = along.slice(0, w.pierce || 1);
        for (const h of hits) {
          if (p.characterClass === "juggernaut" && p.weapon === "shotgun" && this.state.zombies.has(h.z.id)) {   // Briggs: Forceful Blast
            const B = BRIGGS.blast, k = (1 - 0.5 * Math.min(1, h.t / w.range)) * (h.z.boss ? B.bossMult : 1);
            this.steerMove(h.z, h.z.id, a, B.push * k, q => this.solveZombie(q));
          }
          const fo = w.falloff ? 1 - (1 - w.falloff.min) * Math.max(0, Math.min(1, (h.t - w.falloff.near) / (w.range - w.falloff.near))) : 1;   // shotgun: full up close
          const big = w.bigMult && (h.z.boss || h.z.kind === "brute") ? w.bigMult : 1;   // sniper: bosses + brutes take more
          this.hitZombie(h.z, p, p.damage * (w.pelletMult || 1) * fo * big);
        }
        if (hits.length) end = hits[hits.length - 1].t;
        if (this.state.friendlyFire) {   // lobby setting: a bullet that crosses a teammate first hurts them (35%)
          const dx = Math.cos(a), dy = Math.sin(a); let ff = null, ft = end;
          for (const q of this.state.players.values()) {
            if (q === p || !q.alive) continue; const vx = q.x - p.x, vy = q.y - p.y, t = vx * dx + vy * dy;
            if (t > 0 && t < ft && Math.abs(vx * dy - vy * dx) <= BODY_R + 2) { ff = q; ft = t; }
          }
          if (ff) { if (!this.untouchable(ff)) { const dealt = this.armorHit(ff, p.damage * (w.pelletMult || 1) * FRIENDLY_FIRE); ff.hp -= dealt; ff.damageTaken += dealt; if (ff.hp <= 0) this.downPlayer(ff); } end = ft; }
        }
      }
      tracers.push(Math.round(end));
    }
    this.broadcast("shot", { id: p.sessionId, x: Math.round(p.x), y: Math.round(p.y - 4), a: angles, len: tracers, w: p.weapon, ...(w.splash ? { fl: Math.round(tracers[0] / DANTE.rocketSpeed * 1000) / 1000 } : {}) });
  }

  // ---------- slots, reload, melee, quick item ----------
  event(text) { this.state.message = text; }

  // Switch hotbar slot: 1 melee, 2 primary gun, 3 secondary gun, 5 quick item.
  // Pressing 1/2/3 again while already on it cycles to your next owned melee/primary/secondary.
  setSlot(p, n, cycle = false) {
    if (![1, 2, 3, 5].includes(n)) return;
    const owned = p.owned.split(",");
    if (cycle && n === p.activeSlot) {
      if (n === 1) p.melee = MELEE_ORDER[(MELEE_ORDER.indexOf(p.melee) + 1) % MELEE_ORDER.length];
      if (n === 2 || n === 3) {
        const kind = n === 2 ? "primary" : "secondary";
        const list = Object.keys(WEAPONS).filter(id => WEAPONS[id].slot === kind && owned.includes(id));
        if (list.length > 1) p[kind] = list[(list.indexOf(p[kind]) + 1) % list.length];
      }
    }
    if ((n === 2 && !p.primary) || (n === 3 && !p.secondary)) return;   // Raven starts with no guns
    this.storeMag(p);
    p.activeSlot = n;
    if (n === 2) p.weapon = p.primary;
    if (n === 3) p.weapon = p.secondary;
    this.loadMag(p);
    applyLoadout(p);
    if ((n === 2 || n === 3) && p.mag <= 0) this.startReload(p);   // switched to an empty gun: reload it straight away
  }
  storeMag(p) { if (p.weapon) this.mags.set(p.sessionId + ":" + p.weapon, p.mag); p.reloadLeft = 0; }
  loadMag(p) {
    const w = WEAPONS[p.weapon] || WEAPONS.rifle;
    const saved = this.mags.get(p.sessionId + ":" + p.weapon);
    p.magSize = magCap(p, w); p.mag = saved === undefined ? p.magSize : Math.min(saved, p.magSize);
  }
  startReload(p) {
    const w = WEAPONS[p.weapon] || WEAPONS.rifle;
    if (p.reloadLeft > 0 || p.activeSlot === 1 || p.activeSlot === 5 || p.mag >= magCap(p, w)) return;
    if (!w.infinite && p.ammo <= 0) { this.event(`${p.name} has no spare ammo for the ${p.weapon}.`); return; }
    p.reloadLeft = w.reload / (1 + HANDS.reload * (p.hands || 0)); p.reloadTotal = p.reloadLeft;   // Fast Hands: faster reloads
  }
  finishReload(p) {
    const w = WEAPONS[p.weapon] || WEAPONS.rifle;
    const need = magCap(p, w) - p.mag, take = w.infinite ? need : Math.min(need, p.ammo);
    p.mag += take; if (!w.infinite) p.ammo -= take;
  }
  meleeAttack(p, aim, wantHeavy = false) {
    if (p.stunned > 0) return;
    const now = Date.now();
    // heavy only counts if the server saw the axe charging for (almost) the full second
    const heavy = wantHeavy && p.melee === "axe" && p.charging && now - (this.chargeAt.get(p.sessionId) || now) >= AXE_HEAVY.charge * 1000 - 60;
    p.charging = false;
    const raven = p.characterClass === "scout" && p.melee === "katana";
    if (raven && (p.storm > 0 || this.shadowDash.has(p.sessionId))) return;   // busy spinning / dashing
    if (p.characterClass === "slasher" && this.arshanBusy(p)) return;   // Arshan: hooking / cyclone
    const base = raven ? ravenKatana(p) : MELEE[p.melee] || MELEE.knife;
    const m = heavy ? { ...base, dmg: base.dmg * AXE_HEAVY.dmgMult, range: AXE_HEAVY.range, arc: AXE_HEAVY.arc } : base;
    if (now - (this.lastMelee.get(p.sessionId) || 0) < m.cd * 1000 / (p.buffRate || 1)) return;   // Combat Rush: swings 25% faster
    this.lastMelee.set(p.sessionId, now);
    p.aim = aim; this.lastAimAt.set(p.sessionId, now);
    if (p.shadow > 0) this.breakShadow(p);   // attacking ends Raven's invisibility (and lights her katana)
    if (p.melee === "axe") {   // fire axe: can deflect the Butcher's hook
      this.axeSwing.set(p.sessionId, { t: now, aim, heavy });
      for (const z of this.state.zombies.values()) {
        if (z.kind !== "butcher" || z.act !== "hook" || (z.actLen - z.slam) < BUTCHER.hook.aim || !(z.hookD > 0)) continue;
        const tx = z.x + Math.cos(z.aim) * z.hookD, ty = z.y + Math.sin(z.aim) * z.hookD;
        if (hyp(tx - p.x, ty - p.y) <= DEFLECT.reach && this.canDeflect(p, z, now, 1)) this.deflectHook(z, p, now);
      }
    }
    if (!this.recentlyMoved(p.sessionId)) p.facing = Math.cos(aim) < 0 ? -1 : 1;
    const c = CLASS_STATS[p.characterClass] || CLASS_STATS.assault;
    let dmg = Math.round(m.dmg * (1 + ((p.bonusDamage || 0) + (p.buffDamage || 0)) / 100) * c.dmgMult);
    let crit = false;
    if (raven && (p.katanaTier || 0) >= 5) { const n = (this.slashCount.get(p.sessionId) || 0) + 1; this.slashCount.set(p.sessionId, n); if (n % RAVEN.critEvery === 0) { dmg = Math.round(dmg * RAVEN.crit); crit = true; } }
    let left = raven ? m.targets : (m.targets || Infinity);
    const inRange = [...this.state.zombies.values()].map(z => [z, distance(p, z)]).sort((a, b) => a[1] - b[1]);
    for (const [z, d] of inRange) {
      if (d > m.range + z.radius || left <= 0) continue;
      if (m.walls && !this.lineClear(p, z)) continue;   // the chain-axe doesn't swing through walls
      let diff = Math.atan2(z.y - p.y, z.x - p.x) - aim; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) <= m.arc || d < z.radius + 10) {
        if (heavy && !z.boss && d > 0.1) {   // knock back (before the hit, so a killed zombie doesn't matter)
          const ka = Math.atan2(z.y - p.y, z.x - p.x);
          z.x = clamp(z.x + Math.cos(ka) * AXE_HEAVY.knockback, 5, this.A.width - 5); z.y = clamp(z.y + Math.sin(ka) * AXE_HEAVY.knockback, 5, this.A.height - 5); this.solveZombie(z);
        }
        if (raven) { left--; this.katanaHit(z, p, dmg); } else { if (m.targets) left--; this.hitZombie(z, p, dmg); }
      }
    }
    this.broadcast("swing", { id: p.sessionId, x: Math.round(p.x), y: Math.round(p.y - 4), a: aim, r: m.range, arc: m.arc, m: p.melee, heavy, fire: raven && p.fire > 0, crit });
  }
  useQuickItem(p) {
    const now = Date.now();
    if (now - (this.lastItem.get(p.sessionId) || 0) < 1000) return;
    if (p.medkits <= 0) { this.event(`${p.name} has no medkits. Buy them in the shop.`); return; }
    if (p.hp >= p.maxHp) return;
    this.lastItem.set(p.sessionId, now);
    p.medkits -= 1; p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.6));
    this.broadcast("heal", { x: Math.round(p.x), y: Math.round(p.y), id: p.sessionId, k: "medkit" });   // the healing effect on them
    this.event(`${p.name} used a medkit.`);
  }
  // Left mouse button: does whatever is in your hand.
  attack(p, aim, heavy = false, dist) {
    if (p.stunned > 0) return;
    if (p.activeSlot === 1) this.meleeAttack(p, aim, heavy);
    else if (p.activeSlot === 5) this.useQuickItem(p);
    else this.fireWeapon(p, aim, dist);
  }

  useAbility(p, data) {
      const cls=p.characterClass;
      if (cls === "operator") { if (p.stunned <= 0) this.callVehicle(p, "tank"); return; }
      if (cls === "dispatcher") { this.astraCast(p, "E"); return; }   // cooldown starts on the press (refunded if the call fails)
      if (cls === "juggernaut") { if (!(p.skillT > 0)) this.ironBastion(p); return; }
      if (cls === "slasher") { if (!this.arshanBusy(p) && p.stunned <= 0) this.throwHook(p); return; }   // cooldown set when the hook ends   // cooldown starts when the dome breaks   // cooldown starts when she gets out
      if (cls === "demolitionist") { if (p.stunned > 0) return; p.abilityCooldown = DANTE.sky.cd; this.skyBarrage(p, Number(data?.d)); return; }
      if (cls === "scout") { if (p.shadow > 0 || p.fire > 0 || p.storm > 0 || this.shadowDash.has(p.sessionId)) return; this.startShadowPass(p); return; }   // cooldown starts when the flaming katana ends
      if (cls === "engineer") { if ((p.robotCharges ?? ROBOT_CHARGES) < 1) return; p.robotCharges = (p.robotCharges ?? ROBOT_CHARGES) - 1; if (!(p.chargeCd > 0)) p.chargeCd = ROBOT_CD; }
      const cooldown=cls==="engineer"?ROBOT_GAP:cls==="scout"?18:cls==="demolitionist"?32:cls==="sniper"?24:cls==="juggernaut"?28:cls==="assault"?MARCUS.rush.cd:25;
    p.abilityCooldown=cooldown;
    if(cls==="engineer") this.summonRobot(p, data?.kind);
    else if(cls==="scout"){p.speed+=75;setTimeout(()=>{if(this.state.players.has(p.sessionId))p.speed=Math.max(150,p.speed-75);},3500);}
    else if(cls==="demolitionist"){for(const z of [...this.state.zombies.values()])if(distance(p,z)<175){z.hp-=260;if(z.hp<=0)this.killZombie(z,p);}}
    else if(cls==="sniper") this.deadEye(p);
    else if(cls==="juggernaut"){p.defence+=8;setTimeout(()=>{if(this.state.players.has(p.sessionId))p.defence=Math.max(0,p.defence-8);},5000);}
    else {p.buffDamage=MARCUS.rush.dmg;p.buffRate=MARCUS.rush.rate;p.skillT=MARCUS.rush.t;applyLoadout(p);this.broadcast("rush",{id:p.sessionId});}   // ends in updateMarcus
    this.state.message=`${p.name} used ${cls.toUpperCase()} ability!`;
  }

  applyUpgrade(p, id) {
    if (!UPGRADES[id] || p.xp < p.xpNext || (p.level || 1) >= MAX_LEVEL || (id === "cooldown" && (p.cdr || 0) >= CDR.max - 1e-9) || (id === "hands" && (p.hands || 0) >= HANDS.max) || (id === "defence" && (p.armorPct || 0) >= armorCap(p) - 1e-9)) return false;
    p.xp -= p.xpNext;
    p.level++;
    p.xpNext = xpForLevel(p.level); if (p.level >= MAX_LEVEL) p.xp = 0;
    UPGRADES[id](p);
    this.state.message = `${p.name} upgraded: ${String(id)}.`;
    return true;
  }

  // Solid map pieces (buildings, wrecks, trees...) near a point.
  refreshMapBoxes() { this.setMapBoxes(this.statueBroken ? this.siteBoxes : this.siteBoxes.concat(this.statueBody || [])); }   // the Deep Mine statue's body is solid only until the Beast bursts out
  setMapBoxes(boxes) {   // 160px cells -> solid boxes touching that cell (fast lookups); tests plant their own walls with it
    this.mapGrid = new Map();
    for (const b of boxes) for (let gx = Math.floor((b.x - b.hw) / 160); gx <= Math.floor((b.x + b.hw) / 160); gx++) for (let gy = Math.floor((b.y - b.hh) / 160); gy <= Math.floor((b.y + b.hh) / 160); gy++) {
      const k = (gx + 8) * 4096 + (gy + 8); let cell = this.mapGrid.get(k); if (!cell) this.mapGrid.set(k, cell = []); cell.push(b);
    }
  }
  mapBoxesNear(x, y) {   // the solid pieces around (x, y); hot path (every move, every ray step): integer cell keys, no Set, a stamp dedupes boxes
    const gx = Math.floor(x / 160), gy = Math.floor(y / 160), out = [], st = this.boxStamp = (this.boxStamp || 0) + 1, grid = this.mapGrid;
    if (!grid) return out;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const cell = grid.get((gx + i + 8) * 4096 + (gy + j + 8)); if (cell) for (const b of cell) if (b._s !== st) { b._s = st; out.push(b); } }
    return out;
  }
  // Is this point inside (or within pad of) a solid map piece?
  blockedByMap(x, y, pad = 0) {
    for (const b of this.mapBoxesNear(x, y)) if (Math.abs(x - b.x) < b.hw + pad && Math.abs(y - b.y) < b.hh + pad) return true;
    return false;
  }
  // Push an entity (circle of radius r) out of solid boxes {x, y, hw, hh}.
  pushOut(p, boxes, r) {
    for (let pass = 0; pass < 2; pass++) for (const b of boxes) {
      const cx = clamp(p.x, b.x - b.hw, b.x + b.hw), cy = clamp(p.y, b.y - b.hh, b.y + b.hh);
      let dx = p.x - cx, dy = p.y - cy, d = hyp(dx, dy);
      if (d >= r) continue;
      if (d < 0.001) { // centre is inside the box: push out the shortest way
        const exits = [[b.x - b.hw - r - p.x, 0], [b.x + b.hw + r - p.x, 0], [0, b.y - b.hh - r - p.y], [0, b.y + b.hh + r - p.y]];
        const [ex, ey] = exits.sort((m, n) => hyp(...m) - hyp(...n))[0];
        p.x += ex; p.y += ey;
      } else { p.x = cx + dx / d * r; p.y = cy + dy / d * r; }
      p.x = clamp(p.x, 18, this.A.width - 18); p.y = clamp(p.y, 18, this.A.height - 18);
    }
  }
  // Survivors: blocked by the tower base, the generator and the map pieces. Deployables (barricades, turrets, fences...) don't block them.
  solveCollisions(p) {
    const boxes = [{ x: this.A.cx, y: this.A.cy, hw: TOWER_HALF, hh: TOWER_HALF }, { x: this.A.cx + GEN_OFF.x, y: this.A.cy + GEN_OFF.y, hw: GEN_OFF.h, hh: GEN_OFF.h }];
    for (const b of this.mapBoxesNear(p.x, p.y)) boxes.push(b);
    this.pushOut(p, boxes, BODY_R);
  }
  // Zombies: blocked by the map pieces only (they attack barricades/the tower instead of walking around them).
  // Spitter lobs a glob of acid at (tx, ty). It flies for a moment (players can dodge), then lands as a puddle.
  spit(z, tx, ty, atTower = false) {
    const sx = z.x, sy = z.y - 26, flight = Math.max(.35, hyp(tx - sx, ty - sy) / ACID.speed);
    this.spits.push({ tx, ty, land: Date.now() + flight * 1000, dmg: z.damage, atTower });
    this.broadcast("spit", { sx: Math.round(sx), sy: Math.round(sy), tx: Math.round(tx), ty: Math.round(ty), ms: Math.round(flight * 1000) });
  }
  acidLand(s) {
    if (s.atTower) { this.state.towerHp = Math.max(0, this.state.towerHp - s.dmg * 1.5); if (this.state.towerHp <= 0) { this.state.phase = "defeat"; this.state.message = "THE RADIO TOWER HAS BEEN DESTROYED — TEAM DEFEATED."; } return; }
    for (const m of [...this.state.robots.values(), ...this.state.structures.values()]) if (((this.state.robots.has(m.id) && m.kind !== "worker") || m.kind === "heavyTurret") && hyp(m.x - s.tx, m.y - s.ty) < ACID.splash + 14) this.damageMachine(m, s.dmg * 2);
    for (const p of this.state.players.values()) {   // direct hit
      if (!p.alive || this.untouchable(p) || hyp(p.x - s.tx, p.y - s.ty) > ACID.splash) continue;
      const dealt = this.armorHit(p, s.dmg, { boss: false }); p.hp -= dealt; p.damageTaken += dealt; if (p.hp <= 0) this.downPlayer(p);   // spitters are ordinary zombies: capped
    }
    const pu = new PuddleState(); pu.id = "a" + (++this.puddleSeq); pu.x = Math.round(s.tx); pu.y = Math.round(s.ty);
    pu.r = ACID.radius; pu.life = ACID.life; pu.maxLife = ACID.life;
    this.puddleDps.set(pu.id, s.dmg * ACID.dpsMult); this.state.puddles.set(pu.id, pu);
  }
  updateAcid(dt) {
    const now = Date.now();
    for (let i = this.spits.length - 1; i >= 0; i--) if (now >= this.spits[i].land) { this.acidLand(this.spits[i]); this.spits.splice(i, 1); }
    const burn = new Map();   // player -> strongest puddle they stand in (puddles don't stack)
    for (const pu of [...this.state.puddles.values()]) {
      pu.life -= dt;
      if (pu.life <= 0) { this.state.puddles.delete(pu.id); this.puddleDps.delete(pu.id); continue; }
      const dps = this.puddleDps.get(pu.id) || 8;
      for (const p of this.state.players.values()) {
        if (!p.alive) continue;
        const dx = (p.x - pu.x) / pu.r, dy = (p.y - pu.y) / (pu.r * 0.6);
        if (dx * dx + dy * dy <= 1 && dps > (burn.get(p) || 0)) burn.set(p, dps);
      }
    }
    for (const [p, dps] of burn) { if (this.untouchable(p)) continue; const dealt = dps * dt * (1 - (p.armorPct || 0)) * (p.armor === 2 ? 1 - PLATE.dr : 1); p.hp -= dealt; p.damageTaken += dealt; this.acidTouch.set(p.sessionId, now); if (p.hp <= 0) this.downPlayer(p); }
  }
  // Zombies gently push apart so packs spread out instead of stacking into one blob (spatial grid keeps it cheap).
  separateZombies() {   // keep the crowd from stacking: 64px buckets (integer keys), plain numbers read once per zombie
    const grid = new Map(), C = 64, K = 4096;
    for (const z of this.state.zombies.values()) { const k = (Math.floor(z.x / C) + 8) * K + Math.floor(z.y / C) + 8; let cell = grid.get(k); if (!cell) grid.set(k, cell = []); cell.push(z); }
    for (const z of this.state.zombies.values()) {
      if (z.slam > 0) continue;
      let zx = z.x, zy = z.y; const zr = Math.min(z.radius, 30), gx = Math.floor(zx / C) + 8, gy = Math.floor(zy / C) + 8; let moved = false;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const cell = grid.get((gx + i) * K + gy + j); if (!cell) continue; for (const o of cell) {
        if (o === z) continue;
        const dx = zx - o.x, dy = zy - o.y, min = zr + Math.min(o.radius, 30); const min2 = min * min * .5625, d2 = dx * dx + dy * dy;   // .75² : they may overlap a little
        if (d2 >= min2) continue;
        const d = Math.sqrt(d2), push = (min * .75 - d) * .25, ux = d > .01 ? dx / d : Math.random() - .5, uy = d > .01 ? dy / d : Math.random() - .5;
        zx = clamp(zx + ux * push, 5, this.A.width - 5); zy = clamp(zy + uy * push, 5, this.A.height - 5); moved = true;
      } }
      if (moved) { z.x = zx; z.y = zy; }
    }
  }
  // ---------- Viktor: Heavy Turret + Robot Squad ----------
  deployHeavyTurret(p) {
    for (const st of [...this.state.structures.values()]) if (st.kind === "heavyTurret" && st.ownerId === p.sessionId) this.destroyMachine(st, "turret");   // one at a time
    const st = new StructureState(); st.id = `s${++this.structureSequence}`; st.kind = "heavyTurret";
    const a = p.aim || 0; st.x = clamp(p.x + Math.cos(a) * 46, 30, this.A.width - 30); st.y = clamp(p.y + Math.sin(a) * 46, 30, this.A.height - 30);
    if (this.blockedByMap(st.x, st.y, 16)) { st.x = p.x; st.y = p.y + 30; }
    st.hp = st.maxHp = HEAVY_TURRET.hp; st.ownerId = p.sessionId; st.aim = a; st.deploy = HEAVY_TURRET.deploy;
    this.state.structures.set(st.id, st); this.state.message = `${p.name} deployed a HEAVY TURRET!`;
  }
  // Test mode (host toggle, on by default for now): ultimates are unlocked and have no cooldown (still can't stack while one is running)
  ultState(p, now = Date.now()) { return this.ultStateRaw(p, now); }   // cooldowns always apply (Nov 6: test mode only unlocks Q now)
  ultStateRaw(p, now = Date.now()) {
    const info = this.ultInfo.get(p.sessionId) || { summonedAt: 0, readyAt: 0 };
    if (p.characterClass === "dispatcher") { const m = this.amemOf(p), alive = this.unitsOf(p.sessionId, "police").length > 0 || m.cast?.k === "Q", active = alive ? Math.max(0, (m.polUntil || now + ASTRA.police.life * 1000) - now) : 0; return { info, alive, active, left: Math.max(0, (info.readyAt || 0) - now) }; }   // Q cooldown counts from the press (Nov 6)
    if (p.characterClass === "assault") return { info, alive: false, active: 0, left: Math.max(0, info.readyAt - now) };
    if (p.characterClass === "slasher") { const sp = this.spins.get(p.sessionId), alive = !!sp, active = alive ? Math.max(0, sp.until - now) : 0; return { info, alive, active, left: alive ? active + ARSHAN.spin.cd * 1000 : Math.max(0, info.readyAt - now) }; }
    if (p.characterClass === "juggernaut") { const active = Math.max(0, info.summonedAt + BRIGGS.cry.life * 1000 - now), alive = active > 0; return { info, alive, active, left: alive ? active + BRIGGS.cry.cd * 1000 : Math.max(0, info.readyAt - now) }; }
    if (p.characterClass === "operator") {   // Sofea's helicopter: Q can't be used while it's up; the 60s cooldown starts when she lands
      const v = this.state.vehicles.get(p.sessionId), alive = v?.kind === "heli", active = !alive ? 0 : (v.phase === "call" ? SOFEA.heli.life : v.left) * 1000;
      return { info, alive, active, left: alive ? active + SOFEA.heli.cd * 1000 : Math.max(0, info.readyAt - now) };
    }
    const scout = p.characterClass === "scout", dante = p.characterClass === "demolitionist";
    const alive = scout ? p.storm > 0 : dante ? !!this.demoOf(p) || this.ripples.some(r => r.owner === p.sessionId && r.kind === "demo") : [...this.state.structures.values()].filter(st => st.kind === "heavyTurret" && st.ownerId === p.sessionId).length;
    const active = !alive ? 0 : scout ? p.storm * 1000 : dante ? Math.max(0, info.summonedAt + DANTE.demo.life * 1000 - now) : Math.max(0, info.summonedAt + ULT_LIFE * 1000 - now);   // while it's up, Q can't be used
    const left = alive ? active + (scout ? RAVEN.storm.cd : dante ? DANTE.demo.cd : ULT_CD) * 1000 : Math.max(0, info.readyAt - now);
    return { info, alive, left, active };
  }
  useUlt(p, data) {
    if (p.characterClass === "assault") {   // Marcus: Frag Barrage (instant; the cooldown starts right away)
      const now = Date.now(), { info, left } = this.ultState(p, now); if ((p.ultKills || 0) < ULT_KILLS || left > 0 || p.stunned > 0 || !p.alive) return;
      info.summonedAt = now; info.readyAt = now + MARCUS.frag.cd * 1000; this.ultInfo.set(p.sessionId, info); this.fragBarrage(p, Number(data?.d)); return;
    }
    if (!["engineer", "scout", "demolitionist", "operator", "juggernaut", "slasher", "dispatcher"].includes(p.characterClass) || (p.ultKills || 0) < ULT_KILLS) return;
    if (p.characterClass === "dispatcher") {   // police: Q is blocked while the squad is out; the 60s cooldown starts when the last officer leaves
      const now = Date.now(), { info, left } = this.ultState(p, now); if (left > 0) return;
      if (this.unitsOf(p.sessionId, "police").length) return;   // one squad at a time
      if (this.astraCast(p, "Q")) { info.summonedAt = now; info.readyAt = now + ASTRA.police.cd * 1000; this.ultInfo.set(p.sessionId, info); } return;   // cooldown starts on the press
    }
    if (p.characterClass === "slasher") {
      const now = Date.now(), { info, left } = this.ultState(p, now); if (left > 0 || p.stunned > 0 || this.arshanBusy(p)) return;
      info.summonedAt = now; info.readyAt = 0; this.ultInfo.set(p.sessionId, info); this.startCyclone(p, now); return;
    }
    if (p.characterClass === "juggernaut") {
      const now = Date.now(), { info, left } = this.ultState(p, now); if (left > 0 || p.stunned > 0) return;
      info.summonedAt = now; info.readyAt = now + (BRIGGS.cry.life + BRIGGS.cry.cd) * 1000; this.ultInfo.set(p.sessionId, info); this.warCry(p, now); return;
    }
    if (p.characterClass === "operator") {
      const now = Date.now(), { info, left } = this.ultState(p, now); if (left > 0 || p.stunned > 0 || !this.callVehicle(p, "heli")) return;
      info.summonedAt = now; info.readyAt = 0; this.ultInfo.set(p.sessionId, info); return;
    }
    if (p.characterClass === "demolitionist") { const c = this.demoOf(p); if (c) { if (c.deploy <= 0) this.detonateDemo(c); return; } }   // second Q: blow it
    const now = Date.now(), { info, left } = this.ultState(p, now); if (left > 0) return;
    if (p.characterClass === "demolitionist") { this.placeDemo(p); info.summonedAt = now; info.readyAt = 0; this.ultInfo.set(p.sessionId, info); return; }
    if (p.characterClass === "scout") { if (this.shadowDash.has(p.sessionId)) return; p.storm = RAVEN.storm.len; this.stormTick.set(p.sessionId, 0); this.state.message = `${p.name} unleashed BLADE STORM!`; }
    else this.deployHeavyTurret(p);
    info.summonedAt = now; info.readyAt = 0; this.ultInfo.set(p.sessionId, info);
  }
  // ---------- DANTE ----------
  skyBarrage(p, dist) {   // 3 rockets up, one by one; they come down at random spots around the aimed point
    const K = DANTE.sky, a = p.aim || 0, d = Math.max(60, Math.min(K.range, Number.isFinite(dist) ? dist : K.range * .6));
    const cx = clamp(p.x + Math.cos(a) * d, 20, this.A.width - 20), cy = clamp(p.y + Math.sin(a) * d, 20, this.A.height - 20), now = Date.now(), pts = [];
    for (let i = 0; i < K.n; i++) {
      const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * K.spread;
      const x = clamp(cx + Math.cos(ang) * rr, 10, this.A.width - 10), y = clamp(cy + Math.sin(ang) * rr, 10, this.A.height - 10);
      pts.push([Math.round(x), Math.round(y)]);
      this.ripples.push({ kind: "sky", owner: p.sessionId, x, y, t: now, at: i * K.gap + K.flight, dmg: K.dmg, r: K.r, flat: 1, push: K.push, scaled: true });
    }
    p.lastShot = now;
    this.broadcast("sky", { id: p.sessionId, x: Math.round(p.x), y: Math.round(p.y), a: Math.round(a * 100) / 100, pts, gap: K.gap, fl: K.flight });
  }
  demoOf(p) { for (const st of this.state.structures.values()) if (st.kind === "demoCharge" && st.ownerId === p.sessionId) return st; return null; }
  placeDemo(p) {
    const st = new StructureState(), a = p.aim || 0; st.id = `s${++this.structureSequence}`; st.kind = "demoCharge";
    st.x = clamp(p.x + Math.cos(a) * DANTE.demo.place, 30, this.A.width - 30); st.y = clamp(p.y + Math.sin(a) * DANTE.demo.place * .7 + 8, 30, this.A.height - 30);
    if (this.blockedByMap(st.x, st.y, 14)) { st.x = p.x; st.y = p.y + 10; }
    st.hp = st.maxHp = 1; st.ownerId = p.sessionId; st.aim = a; st.deploy = DANTE.demo.arm;
    this.state.structures.set(st.id, st);
    this.broadcast("demo", { k: "place", id: p.sessionId, a: Math.round(a * 100) / 100 });
    this.state.message = `${p.name} planted a DEMO CHARGE! Press Q again to blow it.`;
  }
  detonateDemo(st) {
    const owner = this.state.players.get(st.ownerId), now = Date.now(), D = DANTE.demo, seed = Math.random() * Math.PI * 2;
    this.state.structures.delete(st.id);
    this.ripples.push({ kind: "demo", owner: st.ownerId, x: st.x, y: st.y, t: now, at: 0, dmg: D.core.dmg, r: D.core.r, scaled: true, bossMult: D.bossMult, push: D.push, flat: D.flat });
    const pts = [];   // [x, y, ring, big] for the client to fly each grenade to
    D.rings.forEach((ring, ri) => {
      for (let i = 0; i < ring.n; i++) {
        const ang = seed + (i + rand(-.35, .35)) / ring.n * Math.PI * 2, R = ring.R * rand(.75, 1.2);
        const gx = clamp(st.x + Math.cos(ang) * R, 10, this.A.width - 10), gy = clamp(st.y + Math.sin(ang) * R * D.flat, 10, this.A.height - 10);
        const big = !ring.small || (ring.bigEvery && i % ring.bigEvery === 0);
        this.ripples.push({ kind: "demo", owner: st.ownerId, x: gx, y: gy, t: now, at: ring.at + D.flight, dmg: ring.small && big ? ring.bigDmg : ring.dmg, r: ring.small && big ? ring.bigR : ring.r, scaled: true, bossMult: D.bossMult, push: D.push, flat: D.flat });
        pts.push([Math.round(gx), Math.round(gy), ri, big ? 1 : 0]);
      }
    });
    this.broadcast("demo", { k: "boom", x: Math.round(st.x), y: Math.round(st.y), pts });
    if (owner) this.state.message = `${owner.name}: DEMO RIPPLE!`;
  }
  updateDante(dt, now) {
    const scale = 1 + (this.state.stage - 1) * 0.08, D = DANTE.demo;
    for (const st of [...this.state.structures.values()]) {
      if (st.kind !== "demoCharge") continue;
      if (st.deploy > 0) st.deploy = Math.max(0, st.deploy - dt);
      const owner = this.state.players.get(st.ownerId), info = this.ultInfo.get(st.ownerId);
      if (!owner || !owner.alive || (info && now - info.summonedAt >= D.life * 1000)) this.detonateDemo(st);   // Dante went down / 30s: it blows itself
    }
    if (this.ripples.length) {
      const left = [];
      for (const e of this.ripples) {
        if (now - e.t < e.at * 1000) { left.push(e); continue; }
        const owner = this.state.players.get(e.owner) || null, flat = e.flat || 1, ep = { x: e.x, y: e.y - 4 };
        for (const z of [...this.state.zombies.values()]) {
          const d = hyp(z.x - e.x, (z.y - e.y) / flat); if (d > e.r + z.radius) continue;
          if (e.wallSafe && !this.lineClear(ep, z)) continue;   // rocket blasts don't go through walls
          if (!z.boss && d > 0.1 && e.push) this.steerMove(z, z.id, Math.atan2(z.y - e.y, z.x - e.x), e.push, q => this.solveZombie(q));
          const dmg = (e.fall != null ? e.dmg - (e.dmg - e.fall) * Math.min(1, d / e.r) : e.dmg) * (e.scaled ? scale : 1) * (z.boss ? e.bossMult || 1 : 1);   // fall: damage at the edge
          if (owner) this.hitZombie(z, owner, dmg); else { z.hp -= dmg; if (z.hp <= 0) this.killZombie(z, null); }
        }
        if (e.kind !== "demo") { this.broadcast("boom", { x: Math.round(e.x), y: Math.round(e.y), r: e.r, k: e.kind }); continue; }
        if (!left.some(x => x.owner === e.owner && x.kind === "demo") && !this.ripples.some(x => x !== e && x.kind === "demo" && x.owner === e.owner && now - x.t < x.at * 1000)) {   // last blast: cooldown starts
          const info = this.ultInfo.get(e.owner) || { summonedAt: 0 }; info.readyAt = now + D.cd * 1000; this.ultInfo.set(e.owner, info);
        }
      }
      this.ripples = left;
    }
    for (const p of this.state.players.values()) {
      if (p.characterClass !== "demolitionist") continue;
      if (this.solo && (p.ultKills || 0) < ULT_KILLS) p.ultKills = ULT_KILLS;   // preview: ultimate unlocked for testing
      const { left, active, alive } = this.ultState(p, now), c = this.demoOf(p);
      p.ultCd = alive ? D.cd : Math.ceil(left / 100) / 10; p.ultActive = c ? Math.max(0.1, Math.ceil(active / 100) / 10) : 0;
      p.ultReady = (p.ultKills || 0) >= ULT_KILLS && left <= 0;
    }
  }
  // ---------- ARSHAN: Reaper's Reach (E) + Crimson Cyclone (Q) ----------
  arshanBusy(p) { return this.hooks.has(p.sessionId) || this.spins.has(p.sessionId); }
  throwHook(p) {
    const now = Date.now(), a = p.aim || 0;
    this.hooks.set(p.sessionId, { phase: "wind", t0: now, a, ox: p.x, oy: p.y, d: 0, hx: p.x, hy: p.y, zid: "", stuck: 0 });
    p.skillT = ARSHAN.hook.maxT; p.charging = false;
    this.broadcast("arshan", { k: "throw", id: p.sessionId, a: Math.round(a * 1000) / 1000, x: Math.round(p.x), y: Math.round(p.y), sp: ARSHAN.hook.speed, w: ARSHAN.hook.wind });
  }
  endHook(p, h, now, cd) {
    this.hooks.delete(p.sessionId); p.skillT = 0; p.abilityCooldown = cd;
    this.broadcast("arshan", { k: "end", id: p.sessionId, x: Math.round(h.hx), y: Math.round(h.hy) });
  }
  updateHooks(dt, now) {
    const H = ARSHAN.hook;
    for (const [id, h] of [...this.hooks]) {
      const p = this.state.players.get(id);
      if (!p) { this.hooks.delete(id); continue; }
      const latched = h.phase === "pull";
      if (!p.alive || p.stunned > 0 || now - h.t0 > H.maxT * 1000 || this.state.phase !== "playing") { this.endHook(p, h, now, latched || h.hitAny ? H.cd : H.missCd); continue; }
      p.skillT = Math.max(0, H.maxT - (now - h.t0) / 1000);
      if (h.phase === "wind") { if (now - h.t0 >= H.wind * 1000) { h.phase = "out"; h.ox = p.x; h.oy = p.y; } continue; }
      if (h.phase === "out") {   // the hook flies straight; swept test against zombies and walls this tick
        const d0 = h.d, d1 = Math.min(H.range, d0 + H.speed * dt), c = Math.cos(h.a), s = Math.sin(h.a);
        const wall = this.wallDist(h.ox, h.oy, h.a, H.range);
        let best = null;
        for (const z of this.state.zombies.values()) {
          const vx = z.x - h.ox, vy = z.y - h.oy, t = vx * c + vy * s;
          if (t < d0 - z.radius || t > d1 + z.radius || t > wall) continue;
          if (Math.abs(vx * s - vy * c) <= z.radius + H.hitR && (!best || t < best.t)) best = { z, t };
        }
        if (best) {   // latch an enemy: 70 damage once, then pull Arshan to it (a kill releases without pulling)
          const z = best.z, c2 = CLASS_STATS.slasher, scale = 1 + (this.state.stage - 1) * 0.08;
          h.hx = z.x; h.hy = z.y; h.zid = z.id; h.hitAny = true;
          this.hitZombie(z, p, H.dmg * (1 + ((p.bonusDamage || 0) + (p.buffDamage || 0)) / 100) * c2.dmgMult * scale);
          this.broadcast("arshan", { k: "latch", id, x: Math.round(z.x), y: Math.round(z.y), z: z.id });
          if (!this.state.zombies.has(z.id) || distance(p, z) <= z.radius + BODY_R + H.stop) { this.endHook(p, h, now, H.cd); continue; }
          h.phase = "pull"; continue;
        }
        if (wall <= d1 && wall < H.range) {   // a wall / building / wreck: latch it and pull himself there
          h.hx = h.ox + c * wall; h.hy = h.oy + s * wall; h.phase = "pull"; h.wall = true;
          this.broadcast("arshan", { k: "latch", id, x: Math.round(h.hx), y: Math.round(h.hy) });
          continue;
        }
        h.d = d1; h.hx = h.ox + c * d1; h.hy = h.oy + s * d1;
        if (d1 >= H.range) this.endHook(p, h, now, H.missCd);   // missed: reel it back in
        continue;
      }
      // pull: Arshan flies toward the hook point (a latched zombie keeps moving; he follows it), never through walls
      let tx = h.hx, ty = h.hy, stop = H.wallStop;
      if (h.zid) {
        const z = this.state.zombies.get(h.zid);
        if (!z || !this.lineClear(p, z) || distance(p, z) > H.range) { this.endHook(p, h, now, H.cd); continue; }
        tx = h.hx = z.x; ty = h.hy = z.y; stop = z.radius + BODY_R + H.stop;
      }
      const dist = hyp(tx - p.x, ty - p.y);
      if (dist <= stop + 1) { this.endHook(p, h, now, H.cd); continue; }
      const step = Math.min(H.pull * dt, dist - stop), ox = p.x, oy = p.y;
      this.moveWithCollision(p, (tx - p.x) / dist * step, (ty - p.y) / dist * step);
      if (hyp(p.x - ox, p.y - oy) < step * 0.3) { if (++h.stuck >= 3) { this.endHook(p, h, now, H.cd); continue; } } else h.stuck = 0;
      p.facing = tx > p.x ? 1 : -1; this.lastMoveAt.set(id, now);
    }
  }
  startCyclone(p, now) {
    const S = ARSHAN.spin; this.spins.set(p.sessionId, { start: now + S.wind * 1000, until: now + (S.wind + S.life) * 1000, nextTick: now + S.wind * 1000 });
    p.charging = false;
    this.broadcast("arshan", { k: "spin", id: p.sessionId, w: S.wind, life: S.life, r: S.r });
    this.state.message = `${p.name}: CRIMSON CYCLONE!`;
  }
  endCyclone(p, now) {
    this.spins.delete(p.sessionId); const info = this.ultInfo.get(p.sessionId) || { summonedAt: 0 }; info.readyAt = now + ARSHAN.spin.cd * 1000; this.ultInfo.set(p.sessionId, info);
    this.broadcast("arshan", { k: "spinEnd", id: p.sessionId });
  }
  updateArshan(dt, now) {
    this.updateHooks(dt, now);
    const S = ARSHAN.spin, scale = 1 + (this.state.stage - 1) * 0.08;
    for (const [id, sp] of [...this.spins]) {
      const p = this.state.players.get(id);
      if (!p) { this.spins.delete(id); continue; }
      if (!p.alive || p.stunned > 0 || now >= sp.until) { this.endCyclone(p, now); continue; }   // a stun cancels it (cooldown starts)
      let ticks = 0;
      while (now >= sp.nextTick && sp.nextTick < sp.until && ticks++ < 3) {   // every 0.25s: each zombie inside the circle (and in sight) takes a hit
        sp.nextTick += S.every * 1000;
        const c = CLASS_STATS.slasher, dmg = S.dmg * (1 + ((p.bonusDamage || 0) + (p.buffDamage || 0)) / 100) * c.dmgMult * scale;
        for (const z of [...this.state.zombies.values()]) if (distance(p, z) <= S.r + z.radius * 0.5 && this.lineClear(p, z)) this.hitZombie(z, p, dmg);
      }
    }
    for (const p of this.state.players.values()) {
      if (p.characterClass !== "slasher") continue;
      if (this.solo && (p.ultKills || 0) < ULT_KILLS) p.ultKills = ULT_KILLS;   // preview: ultimate unlocked for testing
      const { left, active, alive } = this.ultState(p, now);
      p.ultCd = alive ? S.cd : Math.ceil(left / 100) / 10; p.ultActive = alive ? Math.max(0.1, Math.ceil(active / 100) / 10) : 0;
      p.ultReady = (p.ultKills || 0) >= ULT_KILLS && left <= 0 && !this.hooks.has(p.sessionId);
    }
  }
  // ---------- BRIGGS: Iron Bastion (E) + War Cry (Q) ----------
  bmemOf(p) { let m = this.briggs.get(p.sessionId); if (!m) { m = { castUntil: 0, domeAt: 0, cryUntil: 0, buffUntil: 0, hitAt: 0 }; this.briggs.set(p.sessionId, m); } return m; }
  // a fist slam into the ground, then the dome: 15s of no damage, no stun, no knockback; he can still fight, 30% slower
  ironBastion(p) {
    const now = Date.now(), m = this.bmemOf(p), B = BRIGGS.bastion;
    m.castUntil = now + B.cast * 1000; m.domeAt = now; p.skillT = B.life; p.charging = false;
    this.broadcast("briggs", { k: "bastion", id: p.sessionId, a: Math.round((p.aim || 0) * 100) / 100 });
    this.state.message = `${p.name}: IRON BASTION!`;
  }
  shatterBastion(p, now) {
    const S = BRIGGS.bastion.shatter, scale = 1 + (this.state.stage - 1) * 0.08;
    p.skillT = 0; p.abilityCooldown = BRIGGS.bastion.cd; this.bmemOf(p).safeUntil = now + 500;
    for (const z of [...this.state.zombies.values()]) {
      const d = distance(p, z); if (d > S.r + z.radius) continue;
      if (!z.boss) this.steerMove(z, z.id, Math.atan2(z.y - p.y, z.x - p.x), S.push, q => this.solveZombie(q));
      this.hitZombie(z, p, S.dmg * scale);
    }
    this.broadcast("briggs", { k: "shatter", id: p.sessionId, x: Math.round(p.x), y: Math.round(p.y) });
  }
  // a short roar (0.3s), then BOOM: shockwave knocks back + hurts what's close, everything within 350px charges him
  warCry(p, now) {
    const C = BRIGGS.cry, m = this.bmemOf(p), scale = 1 + (this.state.stage - 1) * 0.08;
    m.castUntil = now + C.cast * 1000; m.cryUntil = now + C.life * 1000; p.charging = false;
    for (const z of [...this.state.zombies.values()]) {
      const d = distance(p, z);
      if (d <= C.tauntR + z.radius) this.taunt.set(z.id, { id: p.sessionId, until: now + (z.boss ? C.bossTaunt : C.life) * 1000 });
      if (d <= C.impact.r + z.radius) {
        if (!z.boss) this.steerMove(z, z.id, Math.atan2(z.y - p.y, z.x - p.x), C.impact.push, q => this.solveZombie(q));
        this.hitZombie(z, p, C.impact.dmg * scale);
      }
    }
    for (const a of this.state.players.values()) if (a.alive && distance(a, p) <= C.buffR) this.bmemOf(a).buffUntil = now + C.life * 1000;
    this.broadcast("briggs", { k: "cry", id: p.sessionId, x: Math.round(p.x), y: Math.round(p.y), r: C.tauntR });
    this.state.message = `${p.name}: WAR CRY!`;
  }
  shotgunRage(p, now = Date.now()) { if (p.characterClass !== "juggernaut" || p.weapon !== "shotgun") return false; const m = this.briggs.get(p.sessionId); return !!m && m.cryUntil > now; }
  cryBuff(p) { const m = this.briggs.get(p.sessionId); return m && m.buffUntil > Date.now() ? 1 + BRIGGS.cry.buff : 1; }
  tauntTarget(z, now) {   // a zombie Briggs roared at goes for him (while he's alive and the taunt lasts)
    const t = this.taunt.get(z.id); if (!t) return null;
    const p = t.until > now ? this.state.players.get(t.id) : null;
    if (!p?.alive) { this.taunt.delete(z.id); return null; }
    return p;
  }
  // Cooldown reduction: every skill timer STARTS shorter (x(1 - cdr)) and then counts down normally, so the HUD shows the real
  // time left. Each tick we spot timers that were just (re)started (the value went up) and shrink them once:
  // E (abilityCooldown), Viktor's robot charges (chargeCd), every Q (ultInfo.readyAt, once the Q itself has ended),
  // Sofea's mecha (mechaReady), Astra's safehouse (safeReady).
  tickCdr(dt, now) {
    for (const p of this.state.players.values()) {
      const k = 1 - (p.cdr || 0); let m = this.cdrMem.get(p.sessionId); if (!m) { m = {}; this.cdrMem.set(p.sessionId, m); }
      if (p.abilityCooldown > (m.e ?? 0) + 1e-6 && k < 1) p.abilityCooldown *= k;
      m.e = p.abilityCooldown;
      if (p.characterClass === "engineer") { if (p.chargeCd > (m.c ?? 0) + 1e-6 && k < 1) p.chargeCd *= k; m.c = p.chargeCd; }
      const info = this.ultInfo.get(p.sessionId);
      if (info) {
        if (info.readyAt !== m.q) { m.qPending = info.readyAt > now; m.q = info.readyAt; }
        // Astra's Q cooldown runs from the press: shrink it straight away; other Qs once they've ended
        if (m.qPending && (p.characterClass === "dispatcher" || !this.ultStateRaw(p, now).alive)) { m.qPending = false; if (info.readyAt > now && k < 1) { info.readyAt = now + (info.readyAt - now) * k; } m.q = info.readyAt; }
      }
      const vm = this.vmemory.get(p.sessionId);
      if (vm) { if ((vm.mechaReady || 0) !== (m.mecha || 0)) { if (vm.mechaReady > now && k < 1) vm.mechaReady = now + (vm.mechaReady - now) * k; m.mecha = vm.mechaReady; } }
      const am = this.astra?.get(p.sessionId);
      if (am) { if ((am.safeReady || 0) !== (m.safe || 0)) { if (am.safeReady > now && k < 1) am.safeReady = now + (am.safeReady - now) * k; m.safe = am.safeReady; } }
    }
  }
  fragBarrage(p, dist) {
    const F = MARCUS.frag, now = Date.now(), a = p.aim || 0, scale = 1 + (this.state.stage - 1) * 0.08;
    const d = Math.max(F.min, Math.min(F.max, Number.isFinite(dist) && dist > 0 ? dist : F.max * .7)), x0 = p.x, y0 = p.y, pts = [];
    for (const z of [...this.state.zombies.values()]) {   // concussion blast around him
      const zd = distance(p, z); if (zd > F.blast.r + z.radius) continue;
      if (!z.boss) this.steerMove(z, z.id, Math.atan2(z.y - p.y, z.x - p.x), F.blast.push, q => this.solveZombie(q));
      this.hitZombie(z, p, F.blast.dmg * scale);
    }
    for (let i = 0; i < F.n; i++) {   // 3 grenades in a fan
      const ga = a + (i - (F.n - 1) / 2) * F.fan;
      const x = clamp(x0 + Math.cos(ga) * d, 10, this.A.width - 10), y = clamp(y0 + Math.sin(ga) * d, 10, this.A.height - 10);
      pts.push([Math.round(x), Math.round(y)]);
      this.ripples.push({ kind: "frag", owner: p.sessionId, x, y, t: now, at: F.flight + i * F.gap, dmg: F.dmg, r: F.r, push: F.push, bossMult: F.bossMult, scaled: true });
    }
    this.fragHops.set(p.sessionId, { vx: -Math.cos(a) * F.hop.dist / F.hop.t, vy: -Math.sin(a) * F.hop.dist / F.hop.t, left: F.hop.t });   // hop back
    p.facing = Math.cos(a) < 0 ? -1 : 1;
    this.broadcast("frag", { id: p.sessionId, x: Math.round(x0), y: Math.round(y0), a: Math.round(a * 100) / 100, pts, fl: F.flight, gap: F.gap, br: F.blast.r });
    this.state.message = `${p.name}: FRAG BARRAGE!`;
  }
  updateMarcus(dt, now = Date.now()) {   // Combat Rush timer (skillT = seconds left, the HUD + aura read it), Frag Barrage hop + Q HUD
    for (const p of this.state.players.values()) {
      if (p.characterClass !== "assault") continue;
      if (p.skillT > 0) { p.skillT = Math.max(0, p.skillT - dt); if (p.skillT <= 0 || !p.alive) { p.skillT = 0; p.buffDamage = 0; p.buffRate = 1; applyLoadout(p); } }
      const hop = this.fragHops.get(p.sessionId);
      if (hop) { const st = Math.min(dt, hop.left); if (p.alive) this.moveWithCollision(p, hop.vx * st, hop.vy * st); hop.left -= st; if (hop.left <= 0) this.fragHops.delete(p.sessionId); }
      if (this.solo && (p.ultKills || 0) < ULT_KILLS) p.ultKills = ULT_KILLS;   // preview: ultimate unlocked for testing
      const { left } = this.ultState(p, now);
      p.ultCd = Math.ceil(left / 100) / 10; p.ultActive = 0; p.ultReady = (p.ultKills || 0) >= ULT_KILLS && left <= 0;
    }
  }
  updateBriggs(dt, now) {
    for (const p of this.state.players.values()) {
      if (p.characterClass !== "juggernaut") continue;
      if (this.solo && (p.ultKills || 0) < ULT_KILLS) p.ultKills = ULT_KILLS;   // preview: ultimate unlocked for testing
      if (p.skillT > 0) { p.stunned = 0; p.slowed = 0; p.skillT = Math.max(0, p.skillT - dt); if (p.skillT <= 0 || !p.alive) this.shatterBastion(p, now); }
      const { left, active, alive } = this.ultState(p, now);
      p.ultCd = alive ? BRIGGS.cry.cd : Math.ceil(left / 100) / 10; p.ultActive = alive ? Math.max(0.1, Math.ceil(active / 100) / 10) : 0;
      p.ultReady = (p.ultKills || 0) >= ULT_KILLS && left <= 0;
    }
  }
  // ---------- SOFEA: tank (E) + helicopter (Q) ----------
  vmem(p) { let m = this.vmemory.get(p.sessionId); if (!m) { m = { shotAt: 0, crush: new Map(), movingUntil: 0, protectUntil: 0, safe: { x: p.x, y: p.y } }; this.vmemory.set(p.sessionId, m); } return m; }
  vehicleFits(x, y, r) {
    const cx = this.A.cx, cy = this.A.cy;
    return x > r + 20 && y > r + 20 && x < this.A.width - r - 20 && y < this.A.height - r - 20 && !this.blockedByMap(x, y, r)
      && !(Math.abs(x - cx) < TOWER_HALF + r && Math.abs(y - cy) < TOWER_HALF + r) && !(Math.abs(x - cx - GEN_OFF.x) < GEN_OFF.h + r && Math.abs(y - cy - GEN_OFF.y) < GEN_OFF.h + r);
  }
  // nearest clear spot around (x, y) within `max` px (rings of 12 points), or null
  clearSpot(x, y, r, max, ok = () => true) {
    if (this.vehicleFits(x, y, r) && ok(x, y)) return { x, y };
    for (let d = 30; d <= max; d += 30) for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2, px_ = x + Math.cos(a) * d, py_ = y + Math.sin(a) * d;
      if (this.vehicleFits(px_, py_, r) && ok(px_, py_)) return { x: px_, y: py_ };
    }
    return null;
  }
  // E / Q: radio call (0.8s), then the vehicle arrives and she boards it. Returns false (no cooldown used) if it can't come.
  callVehicle(p, kind) {
    if (this.state.vehicles.has(p.sessionId) || !p.alive || p.ride > 0 || (this.inCordon(p) && this.mine?.step !== "fight")) return false;   // not from a cart seat, and not inside the mine's boss dungeon
    const spot = kind === "heli" ? { x: p.x, y: p.y } : this.clearSpot(p.x, p.y, SOFEA[kind].body + 6, 160);
    if (!spot) { this.state.message = `${p.name}: no room for the ${kind} here.`; return false; }
    const v = new VehicleState(); v.id = p.sessionId; v.kind = kind; v.phase = "call"; v.x = spot.x; v.y = spot.y;
    v.hull = (p.facing || 1) < 0 ? Math.PI : 0; v.aim = p.aim || 0; v.left = SOFEA[kind].call ?? SOFEA.call; v.mv = false; v.shots = 0; v.fire = false;
    this.state.vehicles.set(v.id, v); const m = this.vmem(p); m.shotAt = 0; m.crush.clear(); m.safe = { x: p.x, y: p.y }; m.fireUntil = 0; m.wait = 0; m.swing = 0; m.slashHit = 0; m.slashWant = 0;
    p.charging = false; if (p.reloadLeft > 0) p.reloadLeft = 0;
    this.broadcast("sofea", { k: "call", id: p.sessionId, kind });
    this.state.message = kind === "tank" ? `${p.name}: "Requesting armour!"` : kind === "mecha" ? `${p.name}: "Crimson Aegis, online!"` : `${p.name}: "Air support, inbound!"`;
    return true;
  }
  moveVehicle(p, v, dx, dy, dt) {
    const K = SOFEA[v.kind], mag = hyp(dx, dy), now = Date.now();
    if (mag < 0.01 || dt <= 0) return;
    const ox = p.x, oy = p.y, step = K.speed * dt, n = Math.max(1, Math.ceil(step / 8));
    for (let i = 0; i < n; i++) {
      p.x = clamp(p.x + dx / mag * step / n, K.body, this.A.width - K.body); p.y = clamp(p.y + dy / mag * step / n, K.body, this.A.height - K.body);
      this.solveVehicle(p, v);
    }
    const moved = hyp(p.x - ox, p.y - oy);
    v.x = p.x; v.y = p.y; if (v.kind === "tank") v.hull = Math.atan2(dy, dx);
    if (moved / dt >= SOFEA.tank.crush.minSpeed) { this.vmem(p).movingUntil = now + 160; if (v.kind === "tank") this.tankCrush(p, v, now, ox, oy); }
    if (dx) p.facing = dx > 0 ? 1 : -1; this.lastMoveAt.set(p.sessionId, now);
  }
  // tank / mecha: blocked by the tower, generator, solid structures and map pieces; the helicopter flies over all of it
  solveVehicle(p, v) {
    if (v.kind === "heli" && this.cordon && this.mine && this.mine.step !== "runes") { const K = this.cordon; p.x = Math.max(p.x, K.x + 70); p.y = Math.max(p.y, K.y + 70); return; }   // the Mine Beast fight: the helicopter stays inside the dungeon
    if (v.kind === "heli") { if (this.cordon) this.pushOut(p, [{ x: (this.cordon.x - 25 + this.A.width) / 2, y: (this.cordon.y - 40 + this.A.height) / 2, hw: (this.A.width - this.cordon.x + 25) / 2, hh: (this.A.height - this.cordon.y + 40) / 2 }], SOFEA.heli.body); return; }   // the helicopter flies over everything, except into the mine's boss dungeon (user, Nov 11)
    const boxes = [{ x: this.A.cx, y: this.A.cy, hw: TOWER_HALF, hh: TOWER_HALF }];
    {   // tank and mecha
      boxes.push({ x: this.A.cx + GEN_OFF.x, y: this.A.cy + GEN_OFF.y, hw: GEN_OFF.h, hh: GEN_OFF.h });
      for (const st of this.state.structures.values()) { const f = footBox(st); if (f) boxes.push({ x: st.x, y: st.y, hw: f[0], hh: f[1] }); }
      for (const st of this.state.structures.values()) if (st.kind === "heavyTurret") boxes.push({ x: st.x, y: st.y - 4, hw: 20, hh: 12 });
    }
    for (const b of this.mapBoxesNear(p.x, p.y)) boxes.push(b);
    this.pushOut(p, boxes, SOFEA[v.kind].body);
  }
  // tank tracks: zombies inside the hull's footprint (checked along the move, so fast moves can't skip) get run over
  tankCrush(p, v, now, ox, oy) {
    const C = SOFEA.tank.crush, K = SOFEA.tank, m = this.vmem(p), scale = 1 + (this.state.stage - 1) * 0.08, c = Math.cos(v.hull), s = Math.sin(v.hull);
    for (const z of [...this.state.zombies.values()]) {
      let hit = false;
      for (const f of [0, 0.5, 1]) {
        const vx = ox + (v.x - ox) * f, vy = oy + (v.y - oy) * f, rx = z.x - vx, ry = z.y - vy;
        if (Math.abs(rx * c + ry * s) < K.hw + z.radius * .6 && Math.abs(-rx * s + ry * c) < K.hh + z.radius * .6) { hit = true; break; }
      }
      if (!hit || now - (m.crush.get(z.id) || 0) < C.gap * 1000) continue;
      m.crush.set(z.id, now);
      if (!z.boss) { const a = Math.atan2(z.y - v.y, z.x - v.x); this.steerMove(z, z.id, a, C.push, q => this.solveZombie(q)); }
      this.hitZombie(z, p, (z.boss ? C.boss : C.dmg) * scale);
    }
  }
  vehicleFire(p, a, dist) {
    const v = this.state.vehicles.get(p.sessionId); if (!v || v.phase !== "ride" || v.left <= 0 || !p.alive) return;
    if (v.kind === "heli" || v.kind === "mecha") { v.aim = a; p.aim = a; this.vmem(p).fireUntil = Date.now() + 400; return; }   // bots: keep the helicopter gun / flame firing (players hold the mouse: "input" f)
    const K = SOFEA[v.kind], W = K.shot, now = Date.now(), m = this.vmem(p);
    if (now - m.shotAt < K.rate * 1000) return;
    m.shotAt = now; v.aim = a; p.aim = a; v.shots++; this.lastAimAt.set(p.sessionId, now);
    const want = Number.isFinite(dist) && dist > 20 ? Math.min(dist, W.range) : W.range, pts = [];
    {   // the tank cannon (the helicopter has its machine gun instead: heliGun)
      const ox = v.x, oy = v.y;
      let end = Math.max(20, Math.min(this.wallDist(ox, oy, a, want) - 4, want));
      const first = this.rayHits({ x: ox, y: oy }, a, end)[0]; if (first) end = Math.max(20, first.t);   // it blows up on the first zombie it hits, not behind it
      const bx = ox + Math.cos(a) * end, by = oy + Math.sin(a) * end;
      this.ripples.push({ kind: "shell", owner: p.sessionId, x: bx, y: by, t: now, at: end / W.speed, dmg: W.dmg, fall: W.min, r: W.r, flat: 1, push: 8, wallSafe: true, scaled: true });
      pts.push([Math.round(ox), Math.round(oy), Math.round(bx), Math.round(by)]);
    }
    this.broadcast("sofea", { k: "fire", id: p.sessionId, kind: v.kind, a: Math.round(a * 100) / 100, pts, sp: W.speed });
  }
  heliGun(p, v, dt) {   // the machine gun (while she holds fire): every 0.1s, every zombie in the 90-degree cone in front of her aim takes a hit
    const G = SOFEA.heli.gun, m = this.vmem(p); v.fire = Date.now() < (m.fireUntil || 0);
    if (!v.fire) { m.gunT = 0; return; }
    m.gunT = (m.gunT || 0) + dt;
    const scale = 1 + (this.state.stage - 1) * 0.08;
    while (m.gunT >= G.every) {
      m.gunT -= G.every;
      for (const z of [...this.state.zombies.values()]) {
        const d = hyp(z.x - v.x, z.y - v.y); if (d - z.radius * .5 > G.range) continue;
        let da = Math.atan2(z.y - v.y, z.x - v.x) - v.aim; da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) > G.cone / 2 && d > z.radius) continue;
        this.hitZombie(z, p, G.dmg * scale * (z.boss ? G.bossMult : 1));
      }
    }
  }
  // ---- R: Crimson Aegis (mecha) ----
  mechaReadyIn(p, now = Date.now()) { return Math.max(0, (this.vmem(p).mechaReady || 0) - now); }
  mechaKey(p) {   // R on foot: summon it (if R is ready and there's room); R inside: step out early
    const v = this.state.vehicles.get(p.sessionId), now = Date.now();
    if (v) { if (v.kind === "mecha" && v.phase === "ride") this.dismount(p, v, now); return; }
    if (p.stunned > 0 || p.hp <= 0 || this.mechaReadyIn(p, now) > 0) return;
    this.callVehicle(p, "mecha");
  }
  mechaSlash(p, a) {   // right click: queued if the flame is mid-pulse (shared attack timer), dropped if not used within 0.4s
    const v = this.state.vehicles.get(p.sessionId); if (v?.kind !== "mecha" || v.phase !== "ride") return;
    const m = this.vmem(p); m.slashWant = 0.4; m.slashWantA = a;
  }
  zombiesInCone(v, a, range, cone) {   // every zombie in the cone that she can see (walls block it)
    const out = [];
    for (const z of this.state.zombies.values()) {
      const d = hyp(z.x - v.x, z.y - v.y); if (d - z.radius * .5 > range) continue;
      let da = Math.atan2(z.y - v.y, z.x - v.x) - a; da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > cone / 2 && d > z.radius + 6) continue;
      if (!this.lineClear(v, z)) continue;
      out.push(z);
    }
    return out;
  }
  mechaWeapons(p, v, dt) {   // timers in seconds (wait = shared attack timer)
    const M = SOFEA.mecha, m = this.vmem(p), scale = 1 + (this.state.stage - 1) * 0.08;
    m.wait = Math.max(0, (m.wait || 0) - dt); m.swing = Math.max(0, (m.swing || 0) - dt); m.slashWant = Math.max(0, (m.slashWant || 0) - dt);
    if (m.slashHit > 0 && (m.slashHit -= dt) <= 0) {   // the blade crosses: one hit per zombie per swing
      m.slashHit = 0;
      for (const z of this.zombiesInCone(v, m.slashA, M.saber.range, M.saber.cone)) this.hitZombie(z, p, M.saber.dmg * scale);
    }
    if (m.slashWant > 0 && m.wait <= 0) {
      const a = m.slashWantA; m.slashWant = 0; m.slashA = a; v.aim = a; p.aim = a;
      m.wait = m.swing = M.saber.swing; m.slashHit = M.saber.hitAt;
      this.broadcast("sofea", { k: "slash", id: p.sessionId, a: Math.round(a * 100) / 100 });
    }
    v.fire = Date.now() < (m.fireUntil || 0) && m.swing <= 0;
    if (v.fire && m.wait <= 0) {
      m.wait = M.flame.every;
      for (const z of this.zombiesInCone(v, v.aim, M.flame.range, M.flame.cone)) this.hitZombie(z, p, M.flame.dmg * scale);
    }
  }
  // get out: next to the vehicle on clear ground, 0.75s of protection, cooldown starts (not if the call never finished)
  dismount(p, v, now) {
    this.state.vehicles.delete(v.id);
    const m = this.vmem(p);
    if (v.phase === "ride") {
      const zfree = (x, y) => ![...this.state.zombies.values()].some(z => hyp(z.x - x, z.y - y) < z.radius + BODY_R);
      const side = v.kind === "tank" ? { x: v.x - Math.sin(v.hull) * 52, y: v.y + Math.cos(v.hull) * 52 } : { x: v.x, y: v.y };
      const spot = this.clearSpot(side.x, side.y, BODY_R + 2, 180, zfree) || this.clearSpot(v.x, v.y, BODY_R + 2, 240) || (this.vehicleFits(m.safe.x, m.safe.y, BODY_R) ? m.safe : { x: this.A.cx, y: this.A.cy + TOWER_HALF + 40 });
      p.x = spot.x; p.y = spot.y; this.solveCollisions(p);
      if (v.kind === "tank") p.abilityCooldown = SOFEA.tank.cd;
      else if (v.kind === "mecha") m.mechaReady = now + SOFEA.mecha.cd * 1000;
      else { const info = this.ultInfo.get(p.sessionId) || { summonedAt: 0, readyAt: 0 }; info.readyAt = now + SOFEA.heli.cd * 1000; this.ultInfo.set(p.sessionId, info); }
      m.protectUntil = now + SOFEA.protect * 1000;
    } else if (v.kind === "heli") { const info = this.ultInfo.get(p.sessionId); if (info) info.summonedAt = 0; }
    this.broadcast("sofea", { k: "leave", id: p.sessionId, kind: v.kind, x: Math.round(v.x), y: Math.round(v.y), ok: v.phase === "ride" ? 1 : 0 });
  }
  dismountAll() { const now = Date.now(); for (const v of [...this.state.vehicles.values()]) { const p = this.state.players.get(v.id); if (p) this.dismount(p, v, now); else this.state.vehicles.delete(v.id); } }
  updateSofea(dt, now) {
    for (const v of [...this.state.vehicles.values()]) {
      const p = this.state.players.get(v.id);
      if (!p) { this.state.vehicles.delete(v.id); continue; }
      if (!p.alive) { this.dismount(p, v, now); continue; }
      if (v.phase === "call") {
        v.left = Math.max(0, v.left - dt);
        if (v.left <= 0) {
          v.phase = "ride"; v.left = SOFEA[v.kind].life;
          if (v.kind !== "heli") { p.x = v.x; p.y = v.y; } else { v.x = p.x; v.y = p.y; }
          this.vmem(p).safe = { x: p.x, y: p.y };
          this.broadcast("sofea", { k: "board", id: p.sessionId, kind: v.kind, x: Math.round(v.x), y: Math.round(v.y) });
        }
        continue;
      }
      p.stunned = 0; p.slowed = 0; p.charging = false;   // vehicles shrug off stuns and slows
      v.x = p.x; v.y = p.y; v.mv = now < this.vmem(p).movingUntil;
      if (v.kind === "heli") this.heliGun(p, v, dt);
      else if (v.kind === "mecha") this.mechaWeapons(p, v, dt);
      v.left = Math.max(0, v.left - dt);
      if (v.left <= 0) this.dismount(p, v, now);
    }
    for (const p of this.state.players.values()) {
      if (p.characterClass !== "operator") continue;
      if (this.solo && (p.ultKills || 0) < ULT_KILLS) p.ultKills = ULT_KILLS;   // preview: ultimate unlocked for testing
      if (!this.state.vehicles.has(p.sessionId) && p.alive && !this.blockedByMap(p.x, p.y, BODY_R)) this.vmem(p).safe = { x: p.x, y: p.y };
      const { left, active, alive } = this.ultState(p, now);
      p.ultCd = alive ? SOFEA.heli.cd : Math.ceil(left / 100) / 10; p.ultActive = alive ? Math.max(0.1, Math.ceil(active / 100) / 10) : 0;
      p.ultReady = (p.ultKills || 0) >= ULT_KILLS && left <= 0;
      p.chargeCd = Math.ceil(this.mechaReadyIn(p, now) / 100) / 10;   // HUD: R cooldown
    }
  }
  // damage taken while riding: tank 65%, helicopter 80%, none for 0.75s after getting out
  vehicleGuard(now) {
    const g = new Map();
    for (const p of this.state.players.values()) {
      if (!p.alive) continue;
      if (p.characterClass === "juggernaut") {   // dome: nothing gets through (and no hook drag / knockback); War Cry: half damage
        const bm = this.briggs.get(p.sessionId), dome = p.skillT > 0 || (bm && now < (bm.safeUntil || 0));
        const k = dome ? 0 : bm && now < bm.cryUntil ? BRIGGS.cry.taken : 1;
        if (k < 1) g.set(p, { hp: p.hp, k, x: dome ? p.x : null, y: p.y, dome });
        continue;
      }
      if (p.characterClass !== "operator") continue;
      const v = this.state.vehicles.get(p.sessionId), m = this.vmemory.get(p.sessionId);
      const k = m && now < m.protectUntil ? 0 : v?.phase === "ride" ? SOFEA[v.kind].taken : 1;   // mecha: 1 (normal damage)
      if (k < 1) g.set(p, { hp: p.hp, k });
    }
    return g;
  }
  applyVehicleGuard(g) {
    const now = Date.now();
    for (const [p, { hp, k, x, y, dome }] of g) {
      if (x != null) { p.x = x; p.y = y; p.stunned = 0; p.slowed = 0; }   // in the dome: nothing moves him
      const after = p.alive ? p.hp : (this.downHp.get(p.sessionId) ?? 0);
      if (after >= hp) continue;
      if (dome) { const bm = this.bmemOf(p); if (now - bm.hitAt > 160) { bm.hitAt = now; this.broadcast("briggs", { k: "hit", id: p.sessionId }); } }
      const fixed = hp - (hp - after) * k;
      if (fixed > 0 && !p.alive) { p.alive = true; p.bleedout = 0; p.bledOut = false; this.downs.set(p.sessionId, Math.max(0, (this.downs.get(p.sessionId) || 1) - 1)); this.state.message = ""; }
      if (fixed > 0) p.hp = fixed;
    }
  }

  // ---------- ASTRA (dispatcher): E medics, Q police, R safehouse ----------
  amemOf(p) { let m = this.astra.get(p.sessionId); if (!m) { m = { cast: null, safeReady: 0, medUntil: 0, polUntil: 0, polOut: false }; this.astra.set(p.sessionId, m); } return m; }
  unitsOf(id, kind) { const out = []; for (const r of this.state.robots.values()) if (r.ownerId === id && r.kind === kind) out.push(r); return out; }
  safeOf(p) { for (const st of this.state.structures.values()) if (st.kind === "safehouse" && st.ownerId === p.sessionId) return st; return null; }
  sheltered(q) { for (const b of this.safeBoxes) if (Math.abs(q.x - b.x) <= b.hw && Math.abs(q.y - b.y) <= b.hh) return true; return false; }
  astraNo(p, msg) { if (!p.isBot) this.state.message = `${p.name}: ${msg}`; return false; }
  // n separate free spots near (cx, cy) for summoned people, or null (then the cast is refused and no cooldown is used)
  freeSpots(cx, cy, n) {
    const out = [];
    for (let d = 46; d <= 226 && out.length < n; d += 30) for (let i = 0; i < 12 && out.length < n; i++) {
      const a = (i + d / 60) / 12 * Math.PI * 2, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      if (!this.vehicleFits(x, y, ROBOT_R + 2) || out.some(o => hyp(o.x - x, o.y - y) < 30)) continue;
      out.push({ x, y });
    }
    return out.length >= n ? out : null;
  }
  safeFits(cx, cy, self = null) {
    const H = ASTRA.safe.half, X = this.A.cx, Y = this.A.cy, over = (b, pad = 0) => Math.abs(b.x - cx) < b.hw + H + pad && Math.abs(b.y - cy) < b.hh + H + pad;
    if (cx - H < 12 || cy - H < 12 || cx + H > this.A.width - 12 || cy + H > this.A.height - 12) return false;
    if (over({ x: X, y: Y, hw: TOWER_HALF, hh: TOWER_HALF }) || over({ x: X + GEN_OFF.x, y: Y + GEN_OFF.y, hw: GEN_OFF.h, hh: GEN_OFF.h })) return false;
    for (const st of this.state.structures.values()) {
      if (st === self) continue;
      if (st.kind === "safehouse" ? over({ x: st.x, y: st.y, hw: H, hh: H }) : over({ x: st.x, y: st.y, hw: 16, hh: 16 })) return false;
    }
    for (const z of this.state.zombies.values()) if (z.boss && over({ x: z.x, y: z.y, hw: z.radius, hh: z.radius })) return false;
    // scenery (houses, cars, trees) may sit under the walls: the map is busy and a strict rule refused half the spots. Zombies are still blocked.
    return true;
  }
  safeSite(p) {   // centred on Astra; else the nearest centre within 120px that still has him inside the yard
    const S = ASTRA.safe, inner = S.half - S.wall - BODY_R, c = [];
    for (let dx = -S.search; dx <= S.search; dx += 20) for (let dy = -S.search; dy <= S.search; dy += 20) if (hyp(dx, dy) <= S.search) c.push([dx, dy]);
    c.sort((a, b) => hyp(...a) - hyp(...b));
    for (const [dx, dy] of c) { const cx = p.x + dx, cy = p.y + dy; if (Math.abs(dx) < inner && Math.abs(dy) < inner && this.safeFits(cx, cy)) return { x: cx, y: cy }; }
    return null;
  }
  // E / Q / R: check there's room, then the 0.45s radio call; the people arrive in updateAstra. false = refused, no cooldown used.
  astraCast(p, k) {
    const m = this.amemOf(p), now = Date.now();
    if (m.cast || p.stunned > 0 || !p.alive) return false;   // one radio call at a time: repeated key presses can't double up
    if (k === "E") { if (this.unitsOf(p.sessionId, "doctor").length) return this.astraNo(p, "the medics are still on duty"); if (!this.freeSpots(p.x, p.y, ASTRA.medic.n)) return this.astraNo(p, "no room for the medics here"); }
    if (k === "Q" && !this.freeSpots(p.x, p.y, 1)) return this.astraNo(p, "no room for the police here");
    let site = null;
    if (k === "R") {
      if (this.safeOf(p)) return this.astraNo(p, "your safehouse is still up");
      if (now < m.safeReady) return false;
      site = this.safeSite(p); if (!site) return this.astraNo(p, "no room for a safehouse here");
    }
    m.cast = { k, at: now + ASTRA.call * 1000, site };
    if (k === "E") p.abilityCooldown = ASTRA.medic.cd;          // every cooldown starts the moment the skill is used (Nov 6);
    if (k === "R") m.safeReady = now + ASTRA.safe.cd * 1000;    // finishCast refunds it if the call fails (downed, no room)
    this.broadcast("astra", { k: "call", id: p.sessionId, s: k });
    return true;
  }
  spawnUnit(p, kind, at, extra = {}) {
    const r = new RobotState(); r.id = `a${++this.robotSeq}`; r.kind = kind; r.ownerId = p.sessionId;
    r.x = at.x; r.y = at.y; r.hx = at.x; r.hy = at.y; r.hp = r.maxHp = extra.hp || 9999; r.aim = Math.atan2(at.y - p.y, at.x - p.x); r.face = r.aim; r.act = ""; r.tgt = ""; r.uses = 0;
    this.state.robots.set(r.id, r); this.unitMem.set(r.id, { ...extra, born: Date.now() });
    this.broadcast("astra", { k: "arrive", kind, x: Math.round(r.x), y: Math.round(r.y) });
    return r;
  }
  removeUnit(r) {
    if (!this.state.robots.has(r.id)) return;
    this.state.robots.delete(r.id);
    for (const [pid, did] of this.docRes) if (did === r.id) this.docRes.delete(pid);
    this.unitMem.delete(r.id);
    this.broadcast("astra", { k: "leave", kind: r.kind, x: Math.round(r.x), y: Math.round(r.y) });
  }
  finishCast(p, m, now) {
    const c = m.cast; m.cast = null;
    const refund = () => { if (c.k === "E") p.abilityCooldown = 0; if (c.k === "R") m.safeReady = 0; if (c.k === "Q") { const i = this.ultInfo.get(p.sessionId); if (i) { i.summonedAt = 0; i.readyAt = 0; } } };
    if (!p.alive) { refund(); this.broadcast("astra", { k: "cancel", id: p.sessionId }); if (c.k === "Q") { const info = this.ultInfo.get(p.sessionId); if (info) { info.summonedAt = 0; info.readyAt = 0; } } return; }   // downed mid-call: nothing spent
    if (c.k === "E") {
      const spots = this.freeSpots(p.x, p.y, ASTRA.medic.n); if (!spots) { refund(); return this.astraNo(p, "no room for the medics here"); }
      spots.forEach((s, i) => this.spawnUnit(p, "doctor", s, { hp: ASTRA.medic.hp, until: now + ASTRA.medic.life * 1000, idx: i }));
      m.medUntil = now + ASTRA.medic.life * 1000;
      const M = ASTRA.medic;   // arrival: a burst of healing for everyone close to Astra
      for (const q of this.state.players.values()) {
        if (!q.alive || distance(p, q) > M.burstR) continue;
        q.hp = Math.min(q.maxHp, q.hp + q.maxHp * M.burst); this.broadcast("heal", { x: Math.round(q.x), y: Math.round(q.y), id: q.sessionId, k: "medkit" });
      }
      this.broadcast("astra", { k: "burst", x: Math.round(p.x), y: Math.round(p.y), r: M.burstR });
      this.state.message = `${p.name} called in the EMERGENCY MEDICS!`;
    } else if (c.k === "Q") {
      // one officer per living teammate, TWO for Astra himself; each arrives next to the player he guards
      const info = this.ultInfo.get(p.sessionId) || { summonedAt: 0, readyAt: 0 }, guards = [], spots = [];
      for (const q of this.state.players.values()) {
        if (!q.alive) continue; const n = q === p ? ASTRA.police.astra : 1, ss = this.freeSpots(q.x, q.y, n) || this.freeSpots(p.x, p.y, n) || Array(n).fill(null);
        for (let i = 0; i < n; i++) { guards.push(q); spots.push(ss[i] || null); }
      }
      if (!guards.length || spots.some(s => !s)) { info.summonedAt = 0; info.readyAt = 0; this.ultInfo.set(p.sessionId, info); return this.astraNo(p, "no room for the police here"); }
      spots.forEach((s, i) => this.spawnUnit(p, "police", s, { hp: ASTRA.police.hp, until: now + ASTRA.police.life * 1000, slot: i, guard: guards[i].sessionId, nextBurst: now + rand(100, 1500), burstLeft: 0, nextShot: 0, think: 0 }));
      for (const r of this.unitsOf(p.sessionId, "police")) r.hp = r.maxHp = ASTRA.police.hp * this.summonScale();
      m.polUntil = now + ASTRA.police.life * 1000; m.polOut = true; info.summonedAt = now; this.ultInfo.set(p.sessionId, info);
      this.state.message = `${p.name} called POLICE BACKUP!`;
    } else if (c.k === "R") {
      let site = c.site && this.safeFits(c.site.x, c.site.y) ? c.site : this.safeSite(p);   // check again: things move during the call
      if (!site) { refund(); return this.astraNo(p, "no room for a safehouse here"); }
      const st = new StructureState(); st.id = `sh${++this.robotSeq}`; st.kind = "safehouse"; st.x = Math.round(site.x); st.y = Math.round(site.y); st.ownerId = p.sessionId;
      st.deploy = st.total = safeBuildTime(p); st.hp = st.maxHp = safeHits(p); st.life = ASTRA.safe.life; st.aim = 0; this.state.structures.set(st.id, st);
      const H = ASTRA.safe.half - 30, spots = this.freeSpots(p.x, p.y, 2) || [{ x: p.x - 20, y: p.y }, { x: p.x + 20, y: p.y }];
      this.spawnUnit(p, "worker", spots[0], { site: st.id, goal: { x: st.x + H, y: st.y - H } });   // worker A: north + east walls
      this.spawnUnit(p, "worker", spots[1], { site: st.id, goal: { x: st.x - H, y: st.y + H } });   // worker B: south + west walls
      this.state.message = `${p.name} is building a SAFEHOUSE!`;
    }
  }
  summonScale() { return 1 + (this.state.stage - 1) * 0.06; }   // same wave scaling as Viktor's machines
  safeTouch(z) {   // the safehouse wall box this zombie is pressed against (or null)
    const r = Math.min(z.radius, 34) * .8 + 14;
    for (const b of this.safeBoxes) {
      const qx = clamp(z.x, b.x - b.hw, b.x + b.hw), qy = clamp(z.y, b.y - b.hh, b.y + b.hh);
      if (hyp(z.x - qx, z.y - qy) < r) return { b, x: qx, y: qy };
    }
    return null;
  }
  hitSafe(w, z) {
    const st = w.b.st; if (!st || !this.state.structures.has(st.id)) return;
    st.hp = Math.max(0, st.hp - 1); this.safeHit.set(st.id, { x: w.x, y: w.y });
    this.broadcast("astra", { k: "wallHit", x: Math.round(w.x), y: Math.round(w.y), hp: st.hp });
    if (st.hp <= 0) {   // broken: gone at once
      this.state.structures.delete(st.id); this.safeBoxes = this.safeBoxes.filter(b => b !== w.b);
      this.broadcast("astra", { k: "safeDown", x: st.x, y: st.y });
      const owner = this.state.players.get(st.ownerId); if (owner) this.state.message = `${owner.name}'s safehouse was BROKEN!`;
    }
  }
  cancelSafe(st, refund) {
    for (const r of [...this.state.robots.values()]) if (r.kind === "worker" && this.unitMem.get(r.id)?.site === st.id) this.removeUnit(r);
    this.state.structures.delete(st.id); this.broadcast("astra", { k: "safeCancel", x: st.x, y: st.y });
    const m = this.astra.get(st.ownerId); if (refund && m) m.safeReady = 0;
  }
  updateSafehouses(dt, now) {
    const H = ASTRA.safe.half;
    for (const st of [...this.state.structures.values()]) {
      if (st.kind !== "safehouse") continue;
      const owner = this.state.players.get(st.ownerId);
      if (st.deploy > 0) {
        if (!owner || owner.bledOut) { this.cancelSafe(st, false); continue; }   // owner gone: pending build cancelled
        if (!this.safeFits(st.x, st.y, st)) { this.cancelSafe(st, true); this.astraNo(owner, "safehouse blocked (refunded)"); continue; }   // a boss walked in: cancel + refund
        st.deploy = Math.max(0, st.deploy - dt);
        if (st.deploy > 0) continue;
        for (const z of this.state.zombies.values()) {   // finished: small zombies inside are moved outside (no damage)
          const r = Math.min(z.radius, 34) * .8;
          if (Math.abs(z.x - st.x) < H + r && Math.abs(z.y - st.y) < H + r) { this.pushOut(z, [{ x: st.x, y: st.y, hw: H, hh: H }], r); this.pushOut(z, this.mapBoxesNear(z.x, z.y), r); }
        }
        this.broadcast("astra", { k: "built", x: st.x, y: st.y });
        continue;
      }
      st.life = Math.max(0, st.life - dt);
      if (st.life <= 0 || st.hp <= 0) { this.state.structures.delete(st.id); this.broadcast("astra", { k: "safeDown", x: st.x, y: st.y }); }
    }
    this.safeBoxes = [];
    for (const st of this.state.structures.values()) if (st.kind === "safehouse" && st.deploy <= 0) this.safeBoxes.push({ x: st.x, y: st.y, hw: H, hh: H, st });
  }
  keepOutOfSafehouses() {   // bosses jump / get pulled too: nothing hostile ends a tick inside a finished safehouse
    if (!this.safeBoxes.length) return;
    for (const z of this.state.zombies.values()) for (const b of this.safeBoxes) {
      const r = Math.min(z.radius, 34) * .8;
      if (Math.abs(z.x - b.x) < b.hw + r && Math.abs(z.y - b.y) < b.hh + r) this.pushOut(z, [b], r);
    }
  }
  shelterGuard() {   // inside a finished safehouse, or Astra while his is being built: nothing can hurt them this tick
    const g = [], building = new Set();
    for (const st of this.state.structures.values()) if (st.kind === "safehouse" && st.deploy > 0) building.add(st.ownerId);
    if (this.safeBoxes.length || building.size) for (const p of this.state.players.values()) if (p.alive && (building.has(p.sessionId) || this.sheltered(p))) g.push({ p, hp: p.hp, x: p.x, y: p.y, st: p.stunned, sl: p.slowed });
    return g;
  }
  applyShelter(g) {   // undo anything a zombie did this tick to a sheltered survivor (hits, slams, hook drags, stuns)
    for (const { p, hp, x, y, st, sl } of g) {
      p.x = x; p.y = y; p.stunned = Math.min(p.stunned, st); p.slowed = Math.min(p.slowed, sl);
      if (!p.alive) { p.alive = true; p.bleedout = 0; p.bledOut = false; this.downs.set(p.sessionId, Math.max(0, (this.downs.get(p.sessionId) || 1) - 1)); this.state.message = ""; }
      if (p.hp < hp) p.hp = hp;
    }
  }
  leaderOf(owner) {   // police follow Astra; while he's down, the nearest living teammate
    if (owner.alive) return owner;
    let best = null, bd = Infinity;
    for (const q of this.state.players.values()) if (q.alive) { const d = distance(q, owner); if (d < bd) { bd = d; best = q; } }
    return best || owner;
  }
  // The medic treats each person ONCE per call (no stacking): Astra first, then the nearest injured ally, then the next...
  // A treatment lasts until they're at full HP (max ASTRA.medic.session seconds). Nobody left to treat: he follows Astra.
  // Someone at full HP when he looks keeps their turn for later (if they get hurt during his 20s).
  updateDoctor(r, mem, owner, now, dt) {
    const M = ASTRA.medic, ok = q => q && q.alive && q.hp < q.maxHp;
    mem.done = mem.done || new Set(); mem.skip = mem.skip || {};
    // TOP PRIORITY: a downed teammate (nearest first) -> walk over and revive them
    let down = mem.down ? this.state.players.get(mem.down) : null;
    if (down && (down.alive || down.bledOut || !this.state.players.has(down.sessionId))) { down = null; mem.down = ""; mem.revT = 0; }
    if (!down) {
      const c = [...this.state.players.values()].filter(q => !q.alive && !q.bledOut && !(mem.skip[q.sessionId] > now)).sort((a, b) => distance(r, a) - distance(r, b));
      if (c[0]) { down = c[0]; mem.down = down.sessionId; mem.revT = 0; mem.best = distance(r, down); mem.progAt = now; if (mem.patient) { if (this.docRes.get(mem.patient) === r.id) this.docRes.delete(mem.patient); mem.patient = ""; } }
    }
    if (down) {
      const d = distance(r, down); r.tgt = down.sessionId; r.aim = Math.atan2(down.y - r.y, down.x - r.x);
      if (d < mem.best - 8) { mem.best = d; mem.progAt = now; }
      if (d > M.reviveR && now - mem.progAt > M.stuck * 1000 * 2) { mem.skip[down.sessionId] = now + 3000; mem.down = ""; mem.revT = 0; return; }   // can't reach them
      if (d <= M.reviveR) {
        r.act = "heal"; mem.revT = (mem.revT || 0) + dt; mem.progAt = now;
        if (mem.revT >= M.revive) {
          down.alive = true; down.bleedout = 0; down.hp = Math.max(30, Math.round(down.maxHp * M.reviveHp)); down.reviveProgress = 0;
          this.state.message = `The medic revived ${down.name}!`; this.broadcast("heal", { x: Math.round(down.x), y: Math.round(down.y), id: down.sessionId, k: "medkit" });
          mem.down = ""; mem.revT = 0;
        }
        return;
      }
      r.act = ""; this.unitStep(r, down, M.speed, dt); return;
    }
    let pt = mem.patient ? this.state.players.get(mem.patient) : null;
    const release = () => { if (this.docRes.get(mem.patient) === r.id) this.docRes.delete(mem.patient); mem.patient = ""; pt = null; };
    if (mem.patient && (!ok(pt) || mem.healT >= M.session)) { if (mem.healT > 0) mem.done.add(mem.patient); release(); }   // full (or treated long enough): done with them
    if (!pt) {
      const c = [...this.state.players.values()].filter(q => ok(q) && !mem.done.has(q.sessionId) && !this.docRes.has(q.sessionId) && !(mem.skip[q.sessionId] > now));
      c.sort((a, b) => (b.sessionId === r.ownerId) - (a.sessionId === r.ownerId) || distance(r, a) - distance(r, b) || (a.sessionId < b.sessionId ? -1 : 1));   // Astra first, then nearest
      pt = c[0] || null;
      if (pt) { this.docRes.set(pt.sessionId, r.id); mem.patient = pt.sessionId; mem.best = distance(r, pt); mem.progAt = now; mem.healT = 0; }
    }
    r.act = ""; r.tgt = "";
    let goal;
    if (pt) {
      const d = distance(r, pt);
      if (d < mem.best - 8) { mem.best = d; mem.progAt = now; }
      if (d > M.range && now - mem.progAt > M.stuck * 1000) { if (mem.healT > 0) mem.done.add(pt.sessionId); else mem.skip[pt.sessionId] = now + 2000; release(); return; }   // can't get there: try someone else
      r.aim = Math.atan2(pt.y - r.y, pt.x - r.x);
      if (d <= M.range && this.lineClear(r, pt)) { pt.hp = Math.min(pt.maxHp, pt.hp + M.heal * dt); mem.healT += dt; r.act = "heal"; r.tgt = pt.sessionId; mem.progAt = now; }
      goal = d > 46 ? pt : r;
    } else {   // everyone treated (or nobody hurt): follow Astra
      const a = (mem.idx || 0) * 2.1 + 1, lead = this.leaderOf(owner);
      goal = { x: lead.x + Math.cos(a) * 60, y: lead.y + Math.sin(a) * 45 };
    }
    this.unitStep(r, goal, M.speed, dt);
  }
  unitStep(r, goal, speed, dt) {
    const gd = distance(r, goal); if (gd <= 8) return;
    if (gd > ASTRA.catchUp.far) speed *= ASTRA.catchUp.mult;
    const a = Math.atan2(goal.y - r.y, goal.x - r.x); this.steerMove(r, r.id, a, Math.min(gd, speed * dt), e => this.solveRobot(e));
    if (!r.act) r.aim = a;
  }
  updatePolice(r, mem, owner, now, dt) {   // each officer guards ONE player (mem.guard); if that player is down or gone: the nearest living one
    const P = ASTRA.police, g = this.state.players.get(mem.guard), lead = g?.alive ? g : this.leaderOf(g || owner);
    let z = mem.target ? this.state.zombies.get(mem.target) : null;
    if (z && (distance(r, z) > P.range || distance(z, lead) > P.leash || !this.lineClear(r, z))) z = null;
    if (!z || now >= mem.think) {   // pick: zombies threatening a teammate first, then the nearest one in sight
      mem.think = now + 230 + Math.random() * 60;
      const mates = [...this.state.players.values()].filter(q => q.alive && distance(q, lead) < P.leash);
      let best = null, bd = Infinity, threat = false;
      for (const c of this.state.zombies.values()) {
        const d = distance(r, c); if (d > P.range || distance(c, lead) > P.leash) continue;
        const t = mates.some(q => distance(q, c) < P.threat);
        if ((t && !threat) || ((t === threat) && d < bd)) { if (!this.lineClear(r, c)) continue; best = c; bd = d; threat = t; }
      }
      z = best; mem.target = z?.id || "";
    }
    r.act = now - (mem.shotAt || 0) < 200 ? "shoot" : "";
    if (z) {
      r.aim = Math.atan2(z.y - r.y, z.x - r.x);
      if (now >= mem.nextBurst) { mem.burstLeft = P.burst; mem.nextShot = now; mem.nextBurst = now + P.every * 1000; }
      if (mem.burstLeft > 0 && now >= mem.nextShot) {
        mem.burstLeft--; mem.nextShot = now + P.gap * 1000; mem.shotAt = now; r.act = "shoot";
        const a = r.aim + rand(-.04, .04), len = this.machineShot(r.x, r.y - 12, a, P.range, P.dmg * this.summonScale() * policeDmgMult(owner), 1, owner);
        this.broadcast("shot", { id: r.id, x: Math.round(r.x + Math.cos(a) * 16), y: Math.round(r.y - 14), a: [a], len: [Math.round(len)], w: "rifle" });
      }
    } else mem.burstLeft = 0;
    const sa = mem.slot * 2.4 + 2.2, sr = 70;   // a spot ~70px beside / behind the player he guards (officers on the same player spread out)
    this.unitStep(r, { x: lead.x + Math.cos(sa) * sr, y: lead.y + Math.sin(sa) * sr * .8 }, P.speed, dt);
  }
  updateWorker(r, mem, now, dt) {   // build the safehouse, then STAY inside (half speed) and slowly repair it until it's gone
    const S = ASTRA.safe, st = this.state.structures.get(mem.site);
    if (!st) {   // broken / expired / cancelled: walk off and go home
      mem.leaveAt = mem.leaveAt || now + 900; if (now >= mem.leaveAt) return this.removeUnit(r);
      r.act = ""; const a = Math.atan2(r.y - (mem.sy ?? r.y + 1), r.x - (mem.sx ?? r.x)); this.unitStep(r, { x: r.x + Math.cos(a) * 40, y: r.y + Math.sin(a) * 40 }, S.worker * S.stay, dt); return;
    }
    mem.sx = st.x; mem.sy = st.y;
    if (st.deploy > 0) {
      const d = distance(r, mem.goal);
      if (d > 14) { r.act = ""; this.unitStep(r, mem.goal, S.worker * 1.6, dt); }   // they hurry to their wall, then build (8 seconds)
      else { r.act = "build"; r.aim = Math.atan2(st.y - r.y, st.x - r.x); }
      return;
    }
    const In = S.half - S.wall - 14, hit = this.safeHit.get(st.id);
    if (st.hp < st.maxHp) {   // damaged: go to where it was hit (inside) and patch it up, 1 every repairEvery seconds
      const spot = hit ? { x: clamp(hit.x, st.x - In, st.x + In) + (mem.goal.x > st.x ? 10 : -10), y: clamp(hit.y, st.y - In, st.y + In) } : mem.goal;
      if (distance(r, spot) > 40) { r.act = ""; this.unitStep(r, spot, S.worker * S.stay, dt); return; }   // close enough (players often stand right at the wall)
      if (distance(r, spot) > 12) this.unitStep(r, spot, S.worker * S.stay, dt);
      r.act = "build"; r.aim = hit ? Math.atan2(hit.y - r.y, hit.x - r.x) : r.aim; mem.rep = (mem.rep || 0) + dt;
      if (mem.rep >= S.repairEvery) { mem.rep = 0; st.hp = Math.min(st.maxHp, st.hp + 1); this.broadcast("astra", { k: "wallFix", x: Math.round(r.x), y: Math.round(r.y - 30), hp: st.hp }); }
    } else {   // all fixed: wait at his corner
      mem.rep = 0; r.act = "";
      const corner = { x: clamp(mem.goal.x, st.x - In, st.x + In), y: clamp(mem.goal.y, st.y - In, st.y + In) };
      if (distance(r, corner) > 12) this.unitStep(r, corner, S.worker * S.stay, dt);
    }
  }
  updateAstra(dt, now) {
    this.updateSafehouses(dt, now);
    for (const p of this.state.players.values()) {
      if (p.characterClass !== "dispatcher") continue;
      const m = this.amemOf(p);
      if (m.cast && now >= m.cast.at) this.finishCast(p, m, now);
      else if (m.cast && !p.alive) { m.cast = null; this.broadcast("astra", { k: "cancel", id: p.sessionId }); }
    }
    for (const r of [...this.state.robots.values()]) {
      if (!ASTRA_UNITS.has(r.kind)) continue;
      const owner = this.state.players.get(r.ownerId), mem = this.unitMem.get(r.id);
      if (!mem) { this.state.robots.delete(r.id); continue; }
      if (r.kind === "worker") { this.updateWorker(r, mem, now, dt); continue; }
      if (!owner || owner.bledOut || now >= mem.until) { this.removeUnit(r); continue; }   // time's up / Astra fully out: they go home
      if (r.kind === "doctor") this.updateDoctor(r, mem, owner, now, dt); else this.updatePolice(r, mem, owner, now, dt);
    }
    for (const p of this.state.players.values()) {   // HUD: skillT = medics' time left, chargeCd = safehouse cooldown, ult = police
      if (p.characterClass !== "dispatcher") continue;
      const m = this.amemOf(p), docs = this.unitsOf(p.sessionId, "doctor").length;
      p.skillT = docs ? Math.ceil(Math.max(0, m.medUntil - now) / 100) / 10 : 0;
      p.chargeCd = Math.ceil(Math.max(0, m.safeReady - now) / 100) / 10;
      if (m.polOut && !this.unitsOf(p.sessionId, "police").length) m.polOut = false;   // (the cooldown has been running since the press)
      const { left, active, alive } = this.ultState(p, now); p.ultCd = Math.ceil(left / 100) / 10; p.ultActive = Math.ceil(active / 100) / 10; p.ultReady = (p.ultKills || 0) >= ULT_KILLS && left <= 0;
    }
  }
  // ---------- RAVEN ----------
  startShadowPass(p) {
    if (p.ride > 0) return;   // (not from a cart seat: the cart would snap her straight back)
    const a = p.aim || 0, len = Math.max(0, Math.min(RAVEN.dash.dist, this.wallDist(p.x, p.y, a, RAVEN.dash.dist + BODY_R + 2, true) - BODY_R - 2));
    this.shadowDash.set(p.sessionId, { fx: p.x, fy: p.y, tx: p.x + Math.cos(a) * len, ty: p.y + Math.sin(a) * len, t0: Date.now(), hit: new Set(), a, px: p.x, py: p.y });
    p.dashT = RAVEN.dash.time; p.aim = a;
    this.broadcast("shadow", { k: "dash", id: p.sessionId, x: Math.round(p.x), y: Math.round(p.y), a: Math.round(a * 100) / 100, len: Math.round(len) });
  }
  breakShadow(p) {   // invisibility ends (attacked, or 20s ran out): the katana catches fire for 5s
    p.shadow = 0; p.fire = RAVEN.fire;
    this.broadcast("shadow", { k: "ignite", id: p.sessionId, x: Math.round(p.x), y: Math.round(p.y) });
  }
  katanaHit(z, p, dmg) {   // a hit from Raven's katana (slash, dash or storm): burns while it's on fire, bleeds from tier 3
    if (!this.state.zombies.has(z.id)) return;
    this.katanaMark.add(z.id);
    const now = Date.now(), d = this.dots.get(z.id) || { owner: p.sessionId, burn: 0, burnUntil: 0, bleed: 0, bleedUntil: 0 };
    d.owner = p.sessionId;
    if (p.fire > 0) { d.burn = Math.min(RAVEN.burn.max, (now < d.burnUntil ? d.burn : 0) + 1); d.burnUntil = now + RAVEN.burn.len * 1000; }
    if ((p.katanaTier || 0) >= 3) { d.bleed = Math.max(now < d.bleedUntil ? d.bleed : 0, dmg * RAVEN.bleed.frac / RAVEN.bleed.len); d.bleedUntil = now + RAVEN.bleed.len * 1000; }
    if (d.burn || d.bleed) this.dots.set(z.id, d);
    z.burn = now < d.burnUntil ? d.burn : 0;
    this.hitZombie(z, p, dmg);
  }
  updateRaven(dt, now) {
    const scale = 1 + (this.state.stage - 1) * 0.08;
    for (const p of this.state.players.values()) {
      if (p.characterClass !== "scout") continue;
      if (this.solo && (p.ultKills || 0) < ULT_KILLS) p.ultKills = ULT_KILLS;   // preview: ultimate unlocked for testing
      const sd = this.shadowDash.get(p.sessionId);
      if (sd) {   // the dash: slide along the line, slashing everything once
        const t = Math.min(1, (now - sd.t0) / (RAVEN.dash.time * 1000));
        p.x = sd.fx + (sd.tx - sd.fx) * t; p.y = sd.fy + (sd.ty - sd.fy) * t; p.dashT = Math.max(0, RAVEN.dash.time * (1 - t));
        const k = ravenKatana(p), c = CLASS_STATS.scout || CLASS_STATS.assault;
        const dmg = Math.round(k.dmg * RAVEN.dash.mult * (1 + ((p.bonusDamage || 0) + (p.buffDamage || 0)) / 100) * c.dmgMult);
        const sx = p.x - sd.px, sy = p.y - sd.py, sl = hyp(sx, sy) || 1;   // everything along the bit of path covered this tick
        for (const z of [...this.state.zombies.values()]) {
          if (sd.hit.has(z.id)) continue;
          const u = Math.max(0, Math.min(1, ((z.x - sd.px) * sx + (z.y - sd.py) * sy) / (sl * sl)));
          if (hyp(z.x - (sd.px + sx * u), z.y - (sd.py + sy * u)) < z.radius + RAVEN.dash.width) { sd.hit.add(z.id); this.katanaHit(z, p, dmg); }
        }
        sd.px = p.x; sd.py = p.y;
        if (t >= 1) { this.shadowDash.delete(p.sessionId); this.solveCollisions(p); p.dashT = 0; p.shadow = RAVEN.shadow; this.broadcast("shadow", { k: "vanish", id: p.sessionId, x: Math.round(p.x), y: Math.round(p.y) }); }
      }
      if (p.shadow > 0) { p.shadow = Math.max(0, p.shadow - dt); if (p.shadow <= 0) this.breakShadow(p); }
      else if (p.fire > 0) { p.fire = Math.max(0, p.fire - dt); if (p.fire <= 0) p.abilityCooldown = RAVEN.cd; }
      if (p.storm > 0) {
        p.storm = Math.max(0, p.storm - dt);
        const tk = (this.stormTick.get(p.sessionId) || 0) - dt;
        if (tk <= 0 && p.alive) {
          const k = ravenKatana(p), c = CLASS_STATS.scout || CLASS_STATS.assault;
          const dmg = Math.round(k.dmg * RAVEN.storm.mult * (1 + ((p.bonusDamage || 0) + (p.buffDamage || 0)) / 100) * c.dmgMult);
          for (const z of [...this.state.zombies.values()]) if (distance(p, z) < RAVEN.storm.radius + z.radius) this.katanaHit(z, p, dmg);
          this.stormTick.set(p.sessionId, RAVEN.storm.every);
        } else this.stormTick.set(p.sessionId, tk);
        if (p.storm <= 0) { const info = this.ultInfo.get(p.sessionId) || { summonedAt: 0 }; info.readyAt = now + RAVEN.storm.cd * 1000; this.ultInfo.set(p.sessionId, info); }
      }
      const { left, active, alive } = this.ultState(p, now);
      p.ultCd = alive ? RAVEN.storm.cd : Math.ceil(left / 100) / 10; p.ultActive = Math.ceil(active / 100) / 10; p.ultReady = (p.ultKills || 0) >= ULT_KILLS && left <= 0;
    }
    // burns and bleeds
    for (const [id, d] of this.dots) {
      const z = this.state.zombies.get(id), owner = this.state.players.get(d.owner);
      if (!z || !owner) { this.dots.delete(id); if (z) z.burn = 0; continue; }
      let dmg = 0;
      if (d.burn && now < d.burnUntil) dmg += d.burn * RAVEN.burn.dps * scale * dt; else { d.burn = 0; }
      if (d.bleed && now < d.bleedUntil) dmg += d.bleed * dt; else d.bleed = 0;
      z.burn = d.burn;
      if (!d.burn && !d.bleed) { this.dots.delete(id); continue; }
      if (dmg > 0) this.hitZombie(z, owner, dmg);
    }
  }
  summonRobot(p, kind) {
    if (p.characterClass !== "engineer") return;
    kind = ROBOT[kind] ? kind : "assault";
    const mine = [...this.state.robots.values()].filter(r => r.ownerId === p.sessionId);
    if (mine.length >= ROBOT_MAX) this.state.robots.delete(mine[0].id);   // oldest goes
    const r = new RobotState(), a = p.aim || 0;
    r.id = `r${++this.robotSeq}`; r.kind = kind; r.ownerId = p.sessionId;
    r.x = clamp(p.x + Math.cos(a) * 60, 20, this.A.width - 20); r.y = clamp(p.y + Math.sin(a) * 60, 20, this.A.height - 20);
    r.hp = r.maxHp = ROBOT[kind].hp; r.uses = ROBOT[kind].visits || 0; r.aim = a; r.face = a; /* hunter: its 70-degree firing cone points where Viktor aimed */ r.act = ""; this.solveRobot(r); r.hx = r.x; r.hy = r.y;
    this.state.robots.set(r.id, r);
    this.broadcast("summon", { x: Math.round(r.x), y: Math.round(r.y) });
    this.state.message = `${p.name} deployed a ${kind.toUpperCase()} robot!`;
  }
  solveRobot(r) { this.pushOut(r, this.mapBoxesNear(r.x, r.y), ROBOT_R); }
  // A turret or robot breaks: wreck animation, and robots start the owner's ult timer when the last one goes.
  destroyMachine(m, type) {
    if (ASTRA_UNITS.has(m.kind)) { this.removeUnit(m); return; }
    if (type === "turret") this.state.structures.delete(m.id); else this.state.robots.delete(m.id);
    this.broadcast("wreck", { kind: type === "turret" ? "turret" : m.kind, x: Math.round(m.x), y: Math.round(m.y) });
    if (type === "turret") { const info = this.ultInfo.get(m.ownerId) || { summonedAt: 0 }; info.readyAt = Date.now() + ULT_CD * 1000; this.ultInfo.set(m.ownerId, info); }
  }
  damageMachine(m, dmg) {
    m.hp -= dmg;
    if (m.hp <= 0) this.destroyMachine(m, m.kind === "heavyTurret" ? "turret" : "robot");
  }
  // shoot along a line from (x,y) at angle a: hits up to `pierce` zombies before a wall. Returns the shot length.
  machineShot(x, y, a, range, dmg, pierce, owner) {
    const wall = this.wallDist(x, y, a, range), hits = this.rayHits({ x, y }, a, wall).slice(0, pierce);
    for (const h of hits) this.hitZombie(h.z, owner, dmg);
    return hits.length ? hits[hits.length - 1].t : wall;
  }
  nearestZombie(x, y, range, needLine = true) {
    let best = null, bd = range;
    for (const z of this.state.zombies.values()) { const d = hyp(z.x - x, z.y - y); if (d < bd && (!needLine || this.lineClear({ x, y }, z))) { bd = d; best = z; } }
    return best;
  }
  updateMachines(dt, now) {
    const scale = 1 + (this.state.stage - 1) * 0.06;
    for (const st of [...this.state.structures.values()]) {
      if (st.kind !== "heavyTurret") continue;
      const life = this.ultInfo.get(st.ownerId);
      if (life && now - life.summonedAt >= ULT_LIFE * 1000) { this.destroyMachine(st, "turret"); continue; }   // time's up: breaks down, cooldown starts
      if (st.deploy > 0) { st.deploy = Math.max(0, st.deploy - dt); continue; }
      const owner = this.state.players.get(st.ownerId) || null;
      const z = this.nearestZombie(st.x, st.y - 20, HEAVY_TURRET.range); if (!z) continue;
      st.aim = Math.atan2(z.y - (st.y - 20), z.x - st.x);
      const last = this.robotFire.get(st.id) || 0;
      if (now - last >= HEAVY_TURRET.rate * 1000) {
        this.robotFire.set(st.id, now);
        // one attack = one burst = one play of the turret sound (0.52s); drawn as 3 tracers
        const a = st.aim, len = this.machineShot(st.x, st.y - 20, a, HEAVY_TURRET.range, HEAVY_TURRET.dmg * scale, 1, owner), sp = [-.04, 0, .04].map(d => a + d + rand(-.015, .015));
        this.broadcast("shot", { id: st.id, x: Math.round(st.x + Math.cos(a) * 30), y: Math.round(st.y - 24 + Math.sin(a) * 16), a: sp, len: sp.map(() => Math.round(len)), w: "minigun" });
      }
    }
    for (const r of [...this.state.robots.values()]) {
      const owner = this.state.players.get(r.ownerId);
      if (!owner) { this.state.robots.delete(r.id); continue; }
      if (ASTRA_UNITS.has(r.kind)) continue;   // Astra's people have their own brains (updateAstra)
      const R = ROBOT[r.kind], home = { x: r.hx, y: r.hy };
      let goal = home; r.act = "";
      if (r.kind === "assault") {
        const z = this.nearestZombie(r.x, r.y, 1e9, false);   // goes looking for the nearest zombie, anywhere
        if (z) {
          const d = distance(r, z); r.aim = Math.atan2(z.y - r.y, z.x - r.x);
          goal = d > 110 ? z : r;
          if (d < R.range && this.lineClear(r, z) && now - (this.robotFire.get(r.id) || 0) >= R.rate * 1000) {
            this.robotFire.set(r.id, now); r.act = "shoot";
            const len = this.machineShot(r.x, r.y - 12, r.aim + rand(-.06, .06), R.range, R.dmg * scale, 1, owner);
            this.broadcast("shot", { id: r.id, x: Math.round(r.x + Math.cos(r.aim) * 14), y: Math.round(r.y - 12), a: [r.aim], len: [Math.round(len)], w: "smg" });
          } else if (now - (this.robotFire.get(r.id) || 0) < 200) r.act = "shoot";
        }
      } else if (r.kind === "support") {
        // walks to the nearest survivor it hasn't helped yet, supports them for 5s (heal + the +15% damage aura), then looks for another.
        // Each survivor only once. Breaks down after 3 visits, or when there's nobody left it hasn't helped.
        const m = this.supportMem.get(r.id) || { done: 0, t: 0, target: "", seen: new Set() }; this.supportMem.set(r.id, m); r.tgt = "";
        let tg = this.state.players.get(m.target);
        if (!tg?.alive) {
          tg = [...this.state.players.values()].filter(q => q.alive && !m.seen.has(q.sessionId)).sort((a, b) => distance(a, r) - distance(b, r))[0];
          if (!tg) { if (m.done > 0) { this.supportMem.delete(r.id); this.destroyMachine(r, "robot"); continue; } }
          else { m.target = tg.sessionId; m.t = 0; }
        }
        if (tg) {
          const d = distance(r, tg); goal = d > R.near * .6 ? tg : r; r.aim = Math.atan2(tg.y - r.y, tg.x - r.x);
          if (d < R.near) {
            m.t += dt; r.act = tg.hp < tg.maxHp ? "heal" : "buff"; r.tgt = tg.sessionId;   // client draws the heal ring under them
            tg.hp = Math.min(tg.maxHp, tg.hp + R.heal * dt);
            if (now - (this.robotFire.get(r.id) || 0) > 900) { this.robotFire.set(r.id, now); this.broadcast("heal", { x: Math.round(tg.x), y: Math.round(tg.y), id: tg.sessionId }); }
            if (m.t >= R.visit) {
              m.done++; m.seen.add(tg.sessionId); m.target = ""; m.t = 0; r.uses = R.visits - m.done;
              if (m.done >= R.visits) { this.supportMem.delete(r.id); this.destroyMachine(r, "robot"); continue; }
            }
          }
        }
      } else if (r.kind === "hunter") {
        // only shoots zombies inside its circle (the same 300px ground oval the player sees, flattened .6 for perspective)
        let z = null, bd = 1;
        for (const c of this.state.zombies.values()) {
          const e = hyp((c.x - r.hx) / ROBOT_LEASH, (c.y - r.hy) / (ROBOT_LEASH * .6));
          let off = Math.atan2(c.y - r.hy, c.x - r.hx) - (r.face ?? 0); off = Math.atan2(Math.sin(off), Math.cos(off));   // inside the 70-degree cone?
          if (e <= 1 && Math.abs(off) <= R.cone * Math.PI / 360 && hyp(c.x - r.x, c.y - r.y) < bd * 1e4 && this.lineClear(r, c)) { const d = hyp(c.x - r.x, c.y - r.y) / 1e4; if (d < bd) { bd = d; z = c; } }
        }
        if (z) {
          r.aim = Math.atan2(z.y - (r.y - 14), z.x - r.x);
          const since = now - (this.robotFire.get(r.id) || 0);
          if (since >= R.rate * 1000) {
            this.robotFire.set(r.id, now);
            const len = this.machineShot(r.x, r.y - 14, r.aim, R.range, R.dmg * scale, R.pierce, owner);
            this.broadcast("laser", { x: Math.round(r.x + Math.cos(r.aim) * 16), y: Math.round(r.y - 16 + Math.sin(r.aim) * 8), a: Math.round(r.aim * 100) / 100, len: Math.round(len) });
          }
          r.act = since > R.rate * 1000 - 350 ? "charge" : since < 220 ? "fire" : "";
        } else r.aim = r.face ?? r.aim;   // idle: head looks back down its cone
      }
      const gd = distance(r, goal);
      if (gd > 8) { const a = Math.atan2(goal.y - r.y, goal.x - r.x); this.steerMove(r, r.id, a, Math.min(gd, R.speed * dt), e => this.solveRobot(e)); if (!r.act || r.act === "buff") r.aim = a; }
      const hd = hyp(r.x - r.hx, r.y - r.hy);   // the hunter never strays more than ROBOT_LEASH from its spot
      if (r.kind === "hunter" && hd > ROBOT_LEASH) { r.x = r.hx + (r.x - r.hx) / hd * ROBOT_LEASH; r.y = r.hy + (r.y - r.hy) / hd * ROBOT_LEASH; }
    }
    // robots keep a little space from survivors and from each other (so they never cover Viktor)
    for (const r of this.state.robots.values()) {
      for (const o of [...this.state.players.values(), ...this.state.robots.values()]) {
        if (o === r || (o.sessionId && !o.alive)) continue;
        const min = o.sessionId ? 36 : 26, d = distance(r, o); if (d >= min) continue;
        const ux = d > .01 ? (r.x - o.x) / d : Math.random() - .5, uy = d > .01 ? (r.y - o.y) / d : Math.random() - .5;
        r.x += ux * (min - d) * .5; r.y += uy * (min - d) * .5; this.solveRobot(r);
      }
    }
    // ult HUD numbers for every Viktor
    for (const p of this.state.players.values()) {
      if (p.characterClass !== "engineer") continue;
      if (this.solo && (p.ultKills || 0) < ULT_KILLS) p.ultKills = ULT_KILLS;   // preview: ultimate unlocked for testing
      const { left, active, alive } = this.ultState(p, now); p.ultCd = alive ? ULT_CD : Math.ceil(left / 100) / 10; p.ultActive = Math.ceil(active / 100) / 10; p.ultReady = (p.ultKills || 0) >= ULT_KILLS && left <= 0;
    }
  }
  // support robots near a survivor: +15% damage
  supportBuff(p) {
    if (!p || !Number.isFinite(p.x) || !this.state.robots.size) return 1;
    for (const r of this.state.robots.values()) if (r.kind === "support" && distance(r, p) < ROBOT.support.range) return 1 + ROBOT.support.buff;
    return 1;
  }
  // ---------- The Butcher's brain ----------
  bmem(z, now) {
    let m = this.bossMem.get(z.id);
    if (!m) { m = { chopReady: now + 1000, hookReady: now + BUTCHER.hook.first * 1000, spinReady: 0, combo: false, spinTick: 0, stuck: 0 }; this.bossMem.set(z.id, m); }
    return m;
  }
  startAct(z, act, len, aim) { z.act = act; z.actLen = len; z.slam = len; if (aim !== undefined) z.aim = aim; }
  // ---------- The Hivemind (mini boss) ----------
  spawnHivemind(alpha = false) {
    this.log("info", "boss", `the ${alpha ? "Alpha " : ""}Hivemind arrived on wave ${this.state.stage}`);
    this.hiveSpawned = true; const was = this.state.explore; if (alpha) this.state.explore = false; this.spawnZombie(false, "hivemind"); this.state.explore = was;
    const z = [...this.state.zombies.values()].pop(); if (!z || z.kind !== "hivemind") return null;
    const scale = 1 + (this.state.stage - 1) * 0.08, n = this.state.players.size, A = HIVE.alpha;
    z.maxHp = z.hp = HIVE.hp * scale * (1 + BOSS_HP_PER_PLAYER * Math.max(0, n - 1));
    z.speed = HIVE.speed; z.radius = HIVE.radius; z.damage = HIVE.dmg * scale; z.role = "hunter"; z.boss = false;
    if (alpha) { z.boss = true; z.maxHp = z.hp = z.maxHp * A.hp * (DIFFICULTY[this.state.difficulty] || DIFFICULTY.normal).hp; z.radius = Math.round(HIVE.radius * A.size); z.damage *= A.dmg; z.speed = HIVE.speed * A.speed; this.solveZombie(z); }
    this.hiveMem.set(z.id, { biteReady: 0, slamReady: Date.now() + 2500, jumpReady: Date.now() + 3000, spawnAt: Date.now() + HIVE.spawn.first * 1000, brood: 0 });
    this.state.message = alpha ? "THE ALPHA HIVEMIND HAS ARRIVED!" : "THE HIVEMIND HAS ARRIVED!";
    this.broadcast("hive", { k: "arrive", id: z.id, x: Math.round(z.x), y: Math.round(z.y), a: alpha ? 1 : 0 });
    return z;
  }
  armorHit(p, raw, z) { if (z && !z.boss) raw = Math.min(raw, p.maxHp * HIT_CAP); return Math.max(1, Math.round(raw * (1 - (p.armorPct || 0)) * (p.armor === 2 ? 1 - PLATE.dr : 1) - (p.defence || 0))); }   // percent armour first, then flat defence; z given = an ordinary zombie's hit is capped (HIT_CAP)
  hiveHurt(p, dmg) { if (!p.alive || this.untouchable(p)) return; const dealt = this.armorHit(p, dmg); p.hp -= dealt; p.damageTaken += dealt; if (p.hp <= 0) this.downPlayer(p); }
  hiveThink(z, dt, now, players) {
    const H = HIVE, m = this.hiveMem.get(z.id) || { biteReady: 0, slamReady: 0, jumpReady: 0, spawnAt: now + 5000, brood: 0 }; this.hiveMem.set(z.id, m);
    const sc = (z.radius || H.radius) / H.radius;   // the Alpha is bigger: its bite, slam and landing reach further
    if (z.boss && (m.brood || 0) < H.alpha.brood.length && z.hp <= z.maxHp * H.alpha.brood[m.brood || 0] && z.act !== "jump") {   // THE BROOD: it tears a whole Hivemind out of its body
      const k = H.alpha.broodN[m.brood || 0]; m.brood = (m.brood || 0) + 1;
      for (let i = 0; i < k; i++) { const h = this.spawnHivemind(false); if (!h) continue; const a = Math.random() * Math.PI * 2; h.x = clamp(z.x + Math.cos(a) * (z.radius + 70), 60, this.A.width - 60); h.y = clamp(z.y + Math.sin(a) * (z.radius + 50), 60, this.A.height - 60); this.solveZombie(h); }
      this.state.message = k > 1 ? "THE ALPHA TEARS OFF TWO MORE HIVEMINDS!" : "THE ALPHA TEARS OFF A HIVEMIND!"; this.broadcast("hive", { k: "brood", x: Math.round(z.x), y: Math.round(z.y) });
    }
    if (now >= m.spawnAt && z.act !== "jump") {   // tears zombies out of its body
      const n = Math.min(H.spawn.max, 1 + Math.floor(this.state.stage / 8)), was = this.state.explore; this.state.explore = false;
      for (let i = 0; i < n; i++) {
        this.spawnZombie(false, "walker"); const w = [...this.state.zombies.values()].pop(), a = Math.random() * Math.PI * 2;
        w.x = clamp(z.x + Math.cos(a) * (z.radius + 22), 20, this.A.width - 20); w.y = clamp(z.y + Math.sin(a) * (z.radius + 22) * .7, 20, this.A.height - 20); w.attackCooldown = 1.2; this.solveZombie(w);
        this.broadcast("hive", { k: "spawn", x: Math.round(w.x), y: Math.round(w.y) });
      }
      this.state.explore = was; m.spawnAt = now + (z.boss ? H.alpha.spawnEvery : H.spawn.every) * 1000;
    }
    if (z.act) {
      const t0 = z.actLen - z.slam; z.slam = Math.max(0, z.slam - dt); const t1 = z.actLen - z.slam;
      if (z.act === "bite" && t0 < H.bite.windup && t1 >= H.bite.windup) {
        for (const p of this.state.players.values()) {
          if (!p.alive) continue; const d = distance(z, p); if (d > H.bite.reach * sc + BODY_R) continue;
          let diff = Math.atan2(p.y - z.y, p.x - z.x) - z.aim; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          if (Math.abs(diff) <= H.bite.arc || d < z.radius + 14) this.hiveHurt(p, z.damage * H.bite.mult);
        }
      }
      if (z.act === "slam" && t0 < H.slam.windup && t1 >= H.slam.windup) {
        for (const p of this.state.players.values()) if (p.alive && hyp(p.x - z.x, (p.y - z.y) / H.slam.flat) < H.slam.radius * sc) { this.hiveHurt(p, z.damage * H.slam.mult); p.stunned = Math.max(p.stunned || 0, H.slam.stun); p.charging = false; }
        this.broadcast("hive", { k: "slam", x: Math.round(z.x), y: Math.round(z.y), r: Math.round(H.slam.radius * sc) });
      }
      if (z.act === "jump") {
        const J = H.jump;
        if (t1 > J.up && t0 < J.land) { const k = Math.min(1, (t1 - J.up) / (J.land - J.up)); z.x = m.jx0 + (m.jx1 - m.jx0) * k; z.y = m.jy0 + (m.jy1 - m.jy0) * k; }
        if (t0 < J.land && t1 >= J.land) {
          this.solveZombie(z);
          for (const p of this.state.players.values()) if (p.alive && hyp(p.x - z.x, (p.y - z.y) / H.slam.flat) < J.radius * sc) this.hiveHurt(p, z.damage * J.mult);
          this.broadcast("hive", { k: "land", x: Math.round(z.x), y: Math.round(z.y), r: Math.round(J.radius * sc) });
        }
      }
      if (z.slam <= 0) z.act = "";
      return;
    }
    if (!players.length) {   // nobody reachable: crawl toward the radio tower instead of freezing
      const tw = { x: this.A.cx, y: this.A.cy }, ta = Math.atan2(tw.y - z.y, tw.x - z.x); z.aim = ta; z.targetId = "";
      if (distance(z, tw) > z.radius + TOWER_HALF + 20) this.bossMove(z, tw, z.speed * dt);
      return;
    }
    const near = players.reduce((a, b) => distance(z, a) < distance(z, b) ? a : b), d = distance(z, near), a = Math.atan2(near.y - z.y, near.x - z.x);
    z.targetId = near.sessionId; z.aim = a;
    if (d < H.bite.range + z.radius && now >= m.biteReady) { this.startAct(z, "bite", H.bite.total, a); m.biteReady = now + H.bite.cd * 1000; return; }
    if (d < H.slam.range * sc && now >= m.slamReady) { this.startAct(z, "slam", H.slam.total, a); m.slamReady = now + H.slam.cd * 1000; return; }
    if (d > H.jump.min && d < H.jump.max && now >= m.jumpReady) {   // leap at a survivor far away: lands just short of them
      const land = Math.max(0, d - z.radius - 30);
      m.jx0 = z.x; m.jy0 = z.y; m.jx1 = clamp(z.x + Math.cos(a) * land, 40, this.A.width - 40); m.jy1 = clamp(z.y + Math.sin(a) * land, 40, this.A.height - 40);
      if (this.blockedByMap(m.jx1, m.jy1, z.radius * .6)) m.jumpReady = now + 1500;
      else { this.startAct(z, "jump", H.jump.total, a); m.jumpReady = now + H.jump.cd * 1000; this.broadcast("hive", { k: "jump", id: z.id, x0: Math.round(m.jx0), y0: Math.round(m.jy0), x1: Math.round(m.jx1), y1: Math.round(m.jy1) }); return; }
    }
    if (d > z.radius + 40) this.bossMove(z, near, z.speed * dt);
  }
  // ---------- THE ABOMINATION + THE FIVE ----------
  abmem(z, now) {
    let m = this.bossMem.get(z.id); const A = ABOM;
    if (!m) { m = { slamReady: now + 1500, rollReady: now + A.roll.first * 1000, spewReady: now + A.spew.first * 1000, roll: null, spewTick: 0, spewDone: false }; this.bossMem.set(z.id, m); }
    return m;
  }
  abomWall(z, x, y) {   // would his rolling body be inside something solid here? (map edge, map pieces, tower, generator, safehouses)
    const pad = z.radius * .55; if (x < 50 || y < 50 || x > this.A.width - 50 || y > this.A.height - 50 || this.blockedByMap(x, y, pad)) return true;
    if (Math.abs(x - this.A.cx) < TOWER_HALF + pad && Math.abs(y - this.A.cy) < TOWER_HALF + pad) return true;
    if (Math.abs(x - this.A.cx - GEN_OFF.x) < GEN_OFF.h + pad && Math.abs(y - this.A.cy - GEN_OFF.y) < GEN_OFF.h + pad) return true;
    return this.safeBoxes.some(b => Math.abs(x - b.x) < b.hw + pad && Math.abs(y - b.y) < b.hh + pad);
  }
  abomTargets() { return [...this.state.players.values()].filter(p => p.alive && !this.untouchable(p) && !(p.shadow > 0)); }
  abomThink(z, dt, now, taunted) {
    const A = ABOM, m = this.abmem(z, now);
    if (z.act !== "sunder" && z.hp <= z.maxHp * A.splitAt) {   // THE SUNDERING
      m.roll = null; this.startAct(z, "sunder", A.sunder.len, Math.PI / 2); this.state.message = "THE ABOMINATION IS TEARING ITSELF APART: GET BACK!";
      this.broadcast("abom", { k: "sunder", id: z.id, len: A.sunder.len }); return;
    }
    if (z.act) {
      const t0 = z.actLen - z.slam; z.slam = Math.max(0, z.slam - dt); const t1 = z.actLen - z.slam, act = z.act, at = x => t0 < x && t1 >= x;
      if (act === "sunder") { if (z.slam <= 0) this.abomSplit(z); return; }
      if (act === "slam" && at(A.slam.hit)) {
        const c = Math.cos(z.aim), sn = Math.sin(z.aim);
        for (const p of this.state.players.values()) {
          if (!p.alive || this.untouchable(p)) continue; const dx = p.x - z.x, dy = p.y - z.y, along = dx * c + dy * sn, side = Math.abs(-dx * sn + dy * c);
          if (along < -20 || along > A.slam.len + BODY_R || side > A.slam.hw + BODY_R) continue;
          this.hiveHurt(p, z.damage * A.slam.mult); const sgn = (-dx * sn + dy * c) >= 0 ? 1 : -1; this.moveWithCollision(p, -sn * sgn * A.slam.push, c * sgn * A.slam.push);
        }
        this.broadcast("abom", { k: "slamHit", x: Math.round(z.x + c * A.slam.len * .55), y: Math.round(z.y + sn * A.slam.len * .55) });
      }
      if (act === "roll" && m.roll && t1 >= A.roll.wind) {
        const R = m.roll, step = Math.min(A.roll.speed * dt, R.left), nx = z.x + Math.cos(R.a) * step, ny = z.y + Math.sin(R.a) * step;
        const daze = () => { m.roll = null; this.startAct(z, "daze", A.roll.daze); this.state.message = "THE ABOMINATION IS DAZED: hit it now!"; this.broadcast("abom", { k: "daze", id: z.id, x: Math.round(z.x), y: Math.round(z.y), len: A.roll.daze }); };
        z.x = nx; z.y = ny; R.left -= step;
        for (const p of this.state.players.values()) {
          if (!p.alive || R.hit.has(p.sessionId) || this.untouchable(p) || distance(z, p) > A.roll.hitR + BODY_R) continue;
          R.hit.add(p.sessionId); this.hiveHurt(p, z.damage * A.roll.mult); const side = (-(p.x - z.x) * Math.sin(R.a) + (p.y - z.y) * Math.cos(R.a)) >= 0 ? 1 : -1;
          this.moveWithCollision(p, -Math.sin(R.a) * side * A.roll.push, Math.cos(R.a) * side * A.roll.push);
        }
        for (const st of this.state.structures.values()) if (["barricade", "fence", "mine", "flameTrap", "turret"].includes(st.kind) && distance(z, st) < A.roll.hitR + 10) { st.hp -= 400; if (st.hp <= 0) this.state.structures.delete(st.id); }   // deployables in his path get crushed
        if (R.left <= 0) { this.solveZombie(z); return daze(); }   // Nov 10 (user): the roll goes through everything but survivors, and always ends with him dazed
        return;
      }
      if (act === "spew" && t1 >= A.spew.wind && t1 <= A.spew.wind + A.spew.dur) {
        if (now >= m.spewTick) {
          m.spewTick = now + A.spew.every * 1000;
          for (const p of this.state.players.values()) {
            if (!p.alive || this.untouchable(p)) continue; const dx = p.x - z.x, dy = p.y - z.y, d = hyp(dx, dy); if (d > A.spew.len + BODY_R) continue;
            const off = Math.atan2(dy, dx) - z.aim; if (Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) > A.spew.arc || !this.lineClear(z, p)) continue;   // hiding behind a wall works (it reaches 840px now)
            this.hiveHurt(p, z.damage * A.spew.mult);
          }
        }
        if (!m.spewDone && t1 >= A.spew.wind + A.spew.dur * .5) {
          m.spewDone = true; const list = [];
          const wall = this.wallDist(z.x, z.y, z.aim, A.spew.len); for (const d of A.spew.puddles) { const x = Math.round(z.x + Math.cos(z.aim) * d), y = Math.round(z.y + Math.sin(z.aim) * d); if (d > wall || this.blockedByMap(x, y, 4)) continue;   /* no puddles past a wall */ this.abFx.puddles.push({ x, y, r: A.spew.pr, until: now + A.spew.life * 1000, dmg: z.damage * A.spew.pmult, hit: new Map() }); list.push([x, y]); }
          if (list.length) this.broadcast("abom", { k: "puddles", list, r: A.spew.pr, life: A.spew.life });
        }
      }
      if (z.act === act && z.slam <= 0) z.act = "";
      return;
    }
    const can = this.abomTargets(), pool = taunted && can.includes(taunted) ? [taunted] : can.length ? can : [...this.state.players.values()].filter(p => p.alive);
    if (!pool.length) return;
    const near = pool.reduce((a, b) => distance(z, a) < distance(z, b) ? a : b), d = distance(z, near), a = Math.atan2(near.y - z.y, near.x - z.x);
    z.targetId = near.sessionId; z.aim = a;
    if (can.length) {
      if (now >= m.rollReady && d > 180 && d < A.roll.max) {
        m.rollReady = now + A.roll.cd * 1000; let len = Math.min(A.roll.max, d + 320);
        while (len > 120 && this.abomWall(z, z.x + Math.cos(a) * len, z.y + Math.sin(a) * len)) len -= 20;   // he rolls THROUGH buildings, but never stops inside one (or off the map)
        m.roll = { a, left: len, hit: new Set() };
        this.startAct(z, "roll", 30, a); this.broadcast("abom", { k: "roll", id: z.id, x: Math.round(z.x), y: Math.round(z.y), a: Math.round(a * 100) / 100, len: Math.round(m.roll.left), wind: A.roll.wind, hw: A.roll.hitR }); return;
      }
      if (now >= m.spewReady && d < A.spew.trigger) {
        m.spewReady = now + A.spew.cd * 1000; m.spewDone = false; m.spewTick = 0; this.startAct(z, "spew", A.spew.total, a);
        this.broadcast("abom", { k: "spew", id: z.id, a: Math.round(a * 100) / 100, len: A.spew.len, arc: A.spew.arc, wind: A.spew.wind, dur: A.spew.dur }); return;
      }
      if (now >= m.slamReady && d < A.slam.trigger + z.radius) {
        m.slamReady = now + A.slam.cd * 1000; this.startAct(z, "slam", A.slam.total, a);
        this.broadcast("abom", { k: "slam", id: z.id, a: Math.round(a * 100) / 100, len: A.slam.len, hw: A.slam.hw, wind: A.slam.hit }); return;
      }
    }
    if (d > z.radius + 30) this.bossMove(z, near, z.speed * dt);
    this.pushOut(z, [{ x: this.A.cx, y: this.A.cy, hw: TOWER_HALF, hh: TOWER_HALF }], z.radius * .7);
  }
  abomSplit(z) {   // the big body is gone: five spawn stand where it tore apart
    if (!this.state.zombies.has(z.id)) return;
    const S = ABOM.spawn, was = this.state.explore, targets = this.abomTargets(), ids = []; this.state.explore = false;
    ABOM.sunder.fan.forEach(([ox, oy], i) => {
      this.spawnZombie(true, "abomSpawn"); const sp = [...this.state.zombies.values()].pop(); if (sp?.kind !== "abomSpawn") return;
      sp.maxHp = sp.hp = z.maxHp * S.hpFrac; sp.speed = S.speed; sp.radius = S.radius; sp.damage = z.damage * S.dmgMult; sp.role = "hunter"; sp.boss = true; sp.aim = Math.PI / 2;
      sp.x = clamp(z.x + ox, 30, this.A.width - 30); sp.y = clamp(z.y + oy, 30, this.A.height - 30); this.solveZombie(sp);
      this.bossMem.set(sp.id, { lungeReady: Date.now() + 1400 + i * 250, tgt: targets.length ? targets[i % targets.length].sessionId : "" }); ids.push(sp.id);
    });
    this.state.explore = was;
    this.state.zombies.delete(z.id); this.dots.delete(z.id); this.taunt.delete(z.id); this.forgetZombie(z.id);
    this.state.message = "THE FIVE: each one hunts a different survivor!"; this.broadcast("abom", { k: "split", id: z.id, x: Math.round(z.x), y: Math.round(z.y), ids });
  }
  abomSpawnThink(z, dt, now, taunted) {
    const L = ABOM.spawn.lunge; let m = this.bossMem.get(z.id); if (!m) { m = { lungeReady: now + 800, tgt: "" }; this.bossMem.set(z.id, m); }
    if (z.act === "lunge") {
      const t0 = z.actLen - z.slam; z.slam = Math.max(0, z.slam - dt); const t1 = z.actLen - z.slam;
      if (t1 > L.wind && t0 < L.wind + L.leap) { const step = (m.leap || L.dist) / L.leap * dt; z.x = clamp(z.x + Math.cos(z.aim) * step, 20, this.A.width - 20); z.y = clamp(z.y + Math.sin(z.aim) * step, 20, this.A.height - 20); this.solveZombie(z); }
      if (t0 < L.wind + L.leap && t1 >= L.wind + L.leap) {
        for (const p of this.state.players.values()) if (p.alive && !this.untouchable(p) && distance(z, p) < L.r + BODY_R) this.hiveHurt(p, z.damage * L.mult);
        this.broadcast("abom", { k: "land", x: Math.round(z.x), y: Math.round(z.y), r: L.r });
      }
      if (z.slam <= 0) z.act = ""; return;
    }
    const can = this.abomTargets(); let tgt = taunted && can.includes(taunted) ? taunted : can.find(p => p.sessionId === m.tgt);
    if (!tgt) { const pool = can.length ? can : [...this.state.players.values()].filter(p => p.alive); if (!pool.length) return; tgt = pool.reduce((a, b) => distance(z, a) < distance(z, b) ? a : b); if (can.length) m.tgt = tgt.sessionId; }
    const d = distance(z, tgt), a = Math.atan2(tgt.y - z.y, tgt.x - z.x); z.targetId = tgt.sessionId; z.aim = a;
    if (can.length && d < L.trigger && now >= m.lungeReady && this.lineClear(z, tgt)) {
      m.lungeReady = now + L.cd * 1000 * (z.enraged ? .7 : 1); m.leap = clamp(d - 12, 30, L.dist); this.startAct(z, "lunge", L.total, a);   // lands on you, not past you
      this.broadcast("abom", { k: "lunge", id: z.id, x: Math.round(z.x), y: Math.round(z.y), a: Math.round(a * 100) / 100, dist: Math.round(m.leap), wind: L.wind, r: L.r }); return;
    }
    if (d > z.radius + 26) this.bossMove(z, tgt, z.speed * dt);
  }
  abomPuddles(now) {   // lava left by the spew: burns whoever stands in it
    const S = ABOM.spew;
    this.abFx.puddles = this.abFx.puddles.filter(q => {
      if (now >= q.until) return false;
      for (const p of this.state.players.values()) {
        if (!p.alive || this.untouchable(p) || this.state.vehicles.get(p.sessionId)?.kind === "heli" || hyp(p.x - q.x, (p.y + 14 - q.y) / .7) > q.r) continue;
        if (now < (q.hit.get(p.sessionId) || 0)) continue; q.hit.set(p.sessionId, now + S.pevery * 1000); this.hiveHurt(p, q.dmg); p.slowed = Math.max(p.slowed || 0, .6);
      }
      return true;
    });
  }
  // ---------- THE SCREAMER ----------
  smem(z, now) {
    let m = this.bossMem.get(z.id); const S = SCREAMER;
    if (!m) { m = { shriekReady: now + 1500, ringsReady: now + S.rings.first * 1000, markReady: now + S.mark.first * 1000, wailReady: now + S.wail.first * 1000, hordeDone: 0, ringsLeft: 0, ringAt: 0, wailTaken: 0, crowd: false }; this.bossMem.set(z.id, m); }
    return m;
  }
  screamerChoke(z, m) {   // the team burst his throat during the wind-up: the wail is cancelled
    if (z.act !== "wail") return;
    this.startAct(z, "choke", SCREAMER.wail.chokeLen); m.wailTaken = 0;
    this.state.message = "THE SCREAMER IS CHOKING!"; this.broadcast("scream", { k: "choke", id: z.id, len: SCREAMER.wail.chokeLen });
  }
  // Can the Screamer see this survivor? Buildings, the tower, the generator, Astra's safehouse walls and barricades block the wail.
  wailCover(z, p) {
    const d = distance(z, p); if (d < 1) return false; const a = Math.atan2(p.y - z.y, p.x - z.x);
    if (this.wallDist(z.x, z.y, a, d) < d - 6) return true;
    const boxes = [{ x: this.A.cx, y: this.A.cy, hw: TOWER_HALF, hh: TOWER_HALF }, { x: this.A.cx + GEN_OFF.x, y: this.A.cy + GEN_OFF.y, hw: GEN_OFF.h, hh: GEN_OFF.h }, ...this.safeBoxes];
    if (this.boxRayDist(z.x, z.y, a, d, boxes) < d - 6) return true;
    for (const st of this.state.structures.values()) {   // a barricade line crossing the line of sight (segment vs segment)
      if (st.kind !== "barricade" || st.hp <= 0) continue; const l = lineOf(st);
      const ax = st.x - l.c * l.L, ay = st.y - l.s * l.L, bx = st.x + l.c * l.L, by = st.y + l.s * l.L;
      const cross = (ux, uy, vx, vy) => ux * vy - uy * vx, rx = p.x - z.x, ry = p.y - z.y, sx = bx - ax, sy = by - ay, den = cross(rx, ry, sx, sy);
      if (Math.abs(den) < 1e-6) continue;
      const t = cross(ax - z.x, ay - z.y, sx, sy) / den, u = cross(ax - z.x, ay - z.y, rx, ry) / den;
      if (t > 0 && t < 1 && u >= -.15 && u <= 1.15) return true;
    }
    return false;
  }
  botCover(b, z) {   // nearest spot out of the Screamer's sight: behind the tower, the generator or a map piece near the bot
    const cands = [{ x: this.A.cx, y: this.A.cy, h: TOWER_HALF }, { x: this.A.cx + GEN_OFF.x, y: this.A.cy + GEN_OFF.y, h: GEN_OFF.h }];
    for (const bx of this.mapBoxesNear(b.x, b.y)) cands.push({ x: bx.x, y: bx.y, h: Math.min(bx.hw, bx.hh) });
    let best = null, bd = 420;
    for (const c of cands) {
      const d0 = hyp(c.x - z.x, c.y - z.y) || 1, spot = { x: c.x + (c.x - z.x) / d0 * (c.h + 34), y: c.y + (c.y - z.y) / d0 * (c.h + 34) }, d = distance(b, spot);
      if (d < bd && !this.blockedByMap(spot.x, spot.y, 10)) { bd = d; best = spot; }
    }
    return best;
  }
  screamerTargets() { return [...this.state.players.values()].filter(p => p.alive && !this.untouchable(p) && !(p.shadow > 0)); }
  screamerThink(z, dt, now, taunted) {
    const S = SCREAMER, m = this.smem(z, now), cdk = z.enraged ? S.enrageCd : 1, F = this.scrFx;
    if (!z.enraged && z.hp / z.maxHp < S.enrageAt) { z.enraged = true; z.speed *= S.enrageSpeed; this.state.message = "THE SCREAMER IS ENRAGED!"; this.broadcast("roar", { x: Math.round(z.x), y: Math.round(z.y) }); }
    this.screamerHazards(z, now);
    // CALL OF THE HORDE at 66% / 33% (each once), even mid-attack it waits for the current act to end
    const hpk = z.hp / z.maxHp;
    if (!z.act && m.hordeDone < S.horde.at.length && hpk < S.horde.at[m.hordeDone]) {
      m.hordeDone++; this.startAct(z, "call", S.horde.cast, z.aim);
      const n = S.horde.n + S.horde.per * [...this.state.players.values()].filter(p => p.alive).length, was = this.state.explore; this.state.explore = false;
      for (let i = 0; i < n; i++) { this.spawnZombie(false, "runner"); const r = [...this.state.zombies.values()].pop(); if (r?.kind !== "runner") continue; r.role = "hunter"; r.speed *= S.horde.frenzy; F.frenzy.set(r.id, now + S.horde.life * 1000); }
      this.state.explore = was; this.state.message = "CALL OF THE HORDE: runners incoming!"; this.broadcast("scream", { k: "call", id: z.id, len: S.horde.cast }); return;
    }
    if (z.act) {
      const t0 = z.actLen - z.slam; z.slam = Math.max(0, z.slam - dt); const t1 = z.actLen - z.slam, act = z.act, at = x => t0 < x && t1 >= x;
      if (act === "shriek" && at(S.shriek.hit)) {
        const R = m.crowd ? S.shriek.allR : S.shriek.r;
        for (const p of this.state.players.values()) {
          if (!p.alive || this.untouchable(p)) continue; const dx = p.x - z.x, dy = p.y - z.y, d = hyp(dx, dy); if (d > R + BODY_R) continue;
          if (!m.crowd) { const off = Math.atan2(dy, dx) - z.aim; if (Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) > S.shriek.arc) continue; }
          this.hiveHurt(p, z.damage * S.shriek.mult); const a = Math.atan2(dy, dx); this.moveWithCollision(p, Math.cos(a) * S.shriek.push, Math.sin(a) * S.shriek.push);
        }
      }
      if (act === "pulse" && m.ringsLeft > 0 && now >= m.ringAt) {   // one ring every 0.6s while he pulses
        m.ringsLeft--; m.ringAt = now + S.rings.gap * 1000; const x = Math.round(z.x), y = Math.round(z.y + z.radius * .55);
        F.rings.push({ owner: z.id, x, y, t0: now, hit: new Set() }); this.broadcast("scream", { k: "ring", id: z.id, x, y, sp: S.rings.speed, max: S.rings.max, big: z.enraged ? 1 : 0 });
      }
      if (act === "mark" && at(S.mark.cast * .6)) {
        const pool = this.screamerTargets(); if (pool.length) {
          // marks go on the survivors with the most teammates around them (that's who the burst hurts most)
          const crowd = p => pool.filter(q => q !== p && distance(p, q) < S.mark.r * 1.6).length;
          const picks = pool.sort((a, b) => crowd(b) - crowd(a) || Math.random() - .5).slice(0, S.mark.n);
          for (const p of picks) F.marks.push({ owner: z.id, id: p.sessionId, at: now + S.mark.delay * 1000 });
          this.state.message = "RESONANCE: marked survivors, get away from your team!";
          this.broadcast("scream", { k: "mark", id: z.id, ids: picks.map(p => p.sessionId), delay: S.mark.delay, r: S.mark.r });
        }
      }
      if (act === "wail" && at(S.wail.wind)) {   // the wail lands: everyone he can see
        const hit = [];
        for (const p of this.state.players.values()) {
          if (!p.alive || this.untouchable(p) || distance(z, p) > S.wail.maxD || this.wailCover(z, p)) continue;
          this.hiveHurt(p, z.damage * S.wail.mult); p.stunned = Math.max(p.stunned || 0, S.wail.stun); p.charging = false; hit.push(p.sessionId);
        }
        this.broadcast("scream", { k: "wail", id: z.id, x: Math.round(z.x), y: Math.round(z.y), hit, stun: S.wail.stun });
      }
      if (z.act === act && z.slam <= 0) { if (act === "wail") m.wailTaken = 0; z.act = ""; }
      return;
    }
    // targets: survivors he can hurt (Briggs' taunt still pulls him)
    const can = this.screamerTargets(), pool = taunted && can.includes(taunted) ? [taunted] : can.length ? can : [...this.state.players.values()].filter(p => p.alive);
    if (!pool.length) return;
    const near = pool.reduce((a, b) => distance(z, a) < distance(z, b) ? a : b), d = distance(z, near), a = Math.atan2(near.y - z.y, near.x - z.x);
    z.targetId = near.sessionId; z.aim = a;
    if (can.length) {
      if (now >= m.wailReady && d < S.wail.maxD * .8) { m.wailReady = now + S.wail.cd * cdk * 1000; m.wailTaken = 0; this.startAct(z, "wail", S.wail.total, a); this.state.message = "THE SCREAMER IS ABOUT TO WAIL: TAKE COVER!"; this.broadcast("scream", { k: "wailWind", id: z.id, wind: S.wail.wind }); return; }
      if (now >= m.markReady && can.length) { m.markReady = now + S.mark.cd * cdk * 1000; this.startAct(z, "mark", S.mark.cast, a); this.broadcast("scream", { k: "markCast", id: z.id, len: S.mark.cast }); return; }
      if (now >= m.ringsReady && d < S.rings.max) {
        const n = z.enraged ? S.rings.enrN : S.rings.n; m.ringsReady = now + S.rings.cd * cdk * 1000; m.ringsLeft = n; m.ringAt = now + 250;
        this.startAct(z, "pulse", .25 + (n - 1) * S.rings.gap + .35, a); return;
      }
      if (d < S.shriek.trigger + z.radius && now >= m.shriekReady) {
        m.shriekReady = now + S.shriek.cd * cdk * 1000; m.crowd = can.filter(p => distance(z, p) < S.shriek.crowdR + z.radius).length >= S.shriek.crowd;
        this.startAct(z, "shriek", S.shriek.total, a); this.broadcast("scream", { k: "shriek", id: z.id, a: Math.round(a * 100) / 100, r: m.crowd ? S.shriek.allR : S.shriek.r, arc: m.crowd ? Math.PI : S.shriek.arc, wind: S.shriek.windup }); return;
      }
    }
    // keep his distance: back away when you close in, walk in when you're far, otherwise circle
    const [lo, hi] = S.keep; let tx = near.x, ty = near.y;
    if (d < lo) { tx = z.x - Math.cos(a) * 220; ty = z.y - Math.sin(a) * 220; }
    else if (d < hi) { const side = (m.side ||= Math.random() < .5 ? 1 : -1); tx = z.x + Math.cos(a + side * Math.PI / 2) * 120; ty = z.y + Math.sin(a + side * Math.PI / 2) * 120; if (Math.random() < dt / 4) m.side = -side; }
    tx = clamp(tx, 60, this.A.width - 60); ty = clamp(ty, 60, this.A.height - 60);
    const x0 = z.x, y0 = z.y; this.bossMove(z, { x: tx, y: ty }, z.speed * dt * (d < hi && d >= lo ? .55 : 1));
    if (d < lo && hyp(z.x - x0, z.y - y0) < z.speed * dt * .2) m.side = -(m.side || 1);   // backed into a wall: circle the other way next time
    this.pushOut(z, [{ x: this.A.cx, y: this.A.cy, hw: TOWER_HALF, hh: TOWER_HALF }], z.radius * .7);
  }
  screamerHazards(z, now) {   // echo rings roll outward; resonance marks burst; called runners calm down
    const S = SCREAMER, F = this.scrFx;
    if (F.rings.length) F.rings = F.rings.filter(r => {
      if (r.owner !== z.id) return true;
      const rad = (now - r.t0) / 1000 * S.rings.speed; if (rad > S.rings.max + S.rings.w) return false;
      for (const p of this.state.players.values()) {
        if (!p.alive || r.hit.has(p.sessionId) || this.untouchable(p)) continue;   // a dash through the ring (i-frames) dodges it
        const d = hyp(p.x - r.x, (p.y + 16 - r.y) / .6);
        if (Math.abs(d - rad) < S.rings.w / 2 + BODY_R * .7) { r.hit.add(p.sessionId); this.hiveHurt(p, z.damage * S.rings.mult); p.slowed = Math.max(p.slowed || 0, S.rings.slow); }
      }
      return true;
    });
    if (F.marks.length) F.marks = F.marks.filter(mk => {
      if (mk.owner !== z.id || now < mk.at) return true;
      const t = this.state.players.get(mk.id); if (!t) return false;
      const x = Math.round(t.x), y = Math.round(t.y);
      for (const p of this.state.players.values()) if (p.alive && !this.untouchable(p) && hyp(p.x - x, (p.y - y) / .75) < S.mark.r + BODY_R) this.hiveHurt(p, z.damage * S.mark.mult);
      this.broadcast("scream", { k: "burst", id: mk.id, x, y, r: S.mark.r }); return false;
    });
    for (const [id, until] of F.frenzy) { if (now < until) continue; const r = this.state.zombies.get(id); if (r) r.speed /= S.horde.frenzy; F.frenzy.delete(id); }
  }
  // ---------- THE PYRE PRIEST ----------
  pmem(z, now) {
    let m = this.bossMem.get(z.id);
    if (!m) { m = { swingReady: now + 1500, walkReady: now + PYRE.walk.first * 1000, walkUntil: 0, sermonReady: now + PYRE.sermon.first * 1000, wheelReady: now + PYRE.wheel.first * 1000, lastDrop: null }; this.bossMem.set(z.id, m); }
    return m;
  }
  pyreTargets() { return [...this.state.players.values()].filter(p => p.alive && !this.untouchable(p) && !(p.shadow > 0)); }
  ignite(p, z) {   // set a survivor on fire (or keep them burning)
    if (!p.alive || this.untouchable(p)) return;
    const was = this.pBurn.get(p.sessionId);
    if (p.armor !== 2) this.pBurn.set(p.sessionId, { until: Date.now() + PYRE.burn.len * 1000, dps: z.damage * PYRE.burn.dps });   // (the Pyre Plate can't catch fire)
    if (!was || was.until < Date.now()) this.broadcast("pyre", { k: "ignite", id: p.sessionId, len: PYRE.burn.len });
  }
  pyreHit(p, z, mult) { if (!p.alive || this.untouchable(p)) return false; this.hiveHurt(p, z.damage * mult); this.ignite(p, z); return true; }
  pyreThink(z, dt, now, taunted) {
    const P = PYRE, m = this.pmem(z, now), cdk = z.enraged ? P.enrageCd : 1;
    if (!z.enraged && z.hp / z.maxHp < P.enrageAt) {
      z.enraged = true; z.speed *= P.enrageSpeed; this.state.message = "THE PYRE PRIEST IS ENRAGED!"; this.broadcast("roar", { x: Math.round(z.x), y: Math.round(z.y) });
      const wh = this.pyreFx.wheel; if (wh && wh.owner === z.id) { wh.a = this.wheelAngle(wh, now); wh.t0 = now; wh.w = Math.PI * 2 / P.wheel.enrageTurn; this.broadcast("pyre", this.wheelMsg(now)); }   // spins faster
    }
    // FIREWALK: a burning patch every few steps while it lasts
    if (now < m.walkUntil) {
      if (!m.lastDrop || hyp(z.x - m.lastDrop.x, z.y - m.lastDrop.y) >= P.walk.step) {
        const life = z.enraged ? P.walk.patchEnraged : P.walk.patch, x = Math.round(z.x), y = Math.round(z.y + z.radius * .55);
        this.pyreFx.patches.push({ x, y, until: now + life * 1000, owner: z.id }); m.lastDrop = { x: z.x, y: z.y };
        this.broadcast("pyre", { k: "patch", x, y, life });
      }
    }
    if (z.act) {
      const t0 = z.actLen - z.slam; z.slam = Math.max(0, z.slam - dt); const t1 = z.actLen - z.slam, act = z.act, at = x => t0 < x && t1 >= x;
      if (act === "swing" && at(P.swing.hit)) {
        for (const p of this.state.players.values()) {
          if (hyp(p.x - z.x, (p.y - z.y) / P.swing.flat) > P.swing.r + BODY_R) continue;
          if (!this.pyreHit(p, z, P.swing.mult)) continue;
          const a = Math.atan2(p.y - z.y, p.x - z.x); this.moveWithCollision(p, Math.cos(a) * P.swing.push, Math.sin(a) * P.swing.push);
        }
      }
      if (act === "strike" && at(P.strike.hit)) {   // the lamp comes down in front of him
        for (const p of this.state.players.values()) {
          const dx = p.x - z.x, dy = p.y - z.y; if (hyp(dx, dy) > P.strike.r + BODY_R) continue;
          const off = Math.atan2(dy, dx) - z.aim; if (Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) > P.strike.arc) continue;
          if (!p.alive || this.untouchable(p)) continue;
          this.hiveHurt(p, z.damage * P.strike.mult); const a = Math.atan2(dy, dx); this.moveWithCollision(p, Math.cos(a) * P.strike.push, Math.sin(a) * P.strike.push);
        }
      }
      if (act === "sermon" && at(P.sermon.mark)) {
        const S = P.sermon, tg = this.pyreTargets().sort((a, b) => distance(z, a) - distance(z, b)).slice(0, S.aimed), pts = [];
        const put = (x, y) => pts.push([Math.round(clamp(x, 20, this.A.width - 20)), Math.round(clamp(y, 20, this.A.height - 20))]);
        for (const p of tg) put(p.x, p.y + 16);   // one under each of the 3 closest survivors (their feet)
        for (let tries = 0; pts.length < S.n && tries < 80; tries++) {   // the rest: random spots around him, not on top of each other
          const a = Math.random() * Math.PI * 2, d = S.spread[0] + Math.random() * (S.spread[1] - S.spread[0]), x = z.x + Math.cos(a) * d, y = z.y + z.radius * .55 + Math.sin(a) * d * .7;
          if (tries < 60 && pts.some(([px, py]) => hyp(px - x, py - y) < S.gap)) continue;
          put(x, y);
        }
        for (const [x, y] of pts) this.pyreFx.pillars.push({ x, y, at: now + P.sermon.warn * 1000, owner: z.id });
        if (pts.length) this.broadcast("pyre", { k: "sermon", id: z.id, pts, warn: P.sermon.warn, r: P.sermon.r, big: z.enraged ? 1 : 0 });
      }
      if (z.act === act && z.slam <= 0) z.act = "";
      this.pyreHazards(z, now);
      return;
    }
    this.pyreHazards(z, now);
    // hunts survivors only: the nearest one it can hurt (Briggs' taunt still pulls it), otherwise the nearest at all
    const can = this.pyreTargets(), pool = taunted && can.includes(taunted) ? [taunted] : can.length ? can : [...this.state.players.values()].filter(p => p.alive);
    if (!pool.length) return;
    const near = pool.reduce((a, b) => distance(z, a) < distance(z, b) ? a : b), d = distance(z, near), a = Math.atan2(near.y - z.y, near.x - z.x);
    z.targetId = near.sessionId; z.aim = a;
    if (can.length) {
      if (now >= m.walkReady) { m.walkReady = now + P.walk.every * cdk * 1000; m.walkUntil = now + P.walk.life * 1000; m.lastDrop = null; this.broadcast("pyre", { k: "firewalk", id: z.id, life: P.walk.life }); }
      if (d < P.swing.trigger + z.radius && now >= m.swingReady) { m.swingReady = now + P.swing.cd * cdk * 1000; this.startAct(z, "swing", P.swing.total, a); this.broadcast("pyre", { k: "swing", id: z.id, x: Math.round(z.x), y: Math.round(z.y), r: P.swing.r, wind: P.swing.windup }); return; }
      if (now >= m.wheelReady && !this.pyreFx.wheel && d < 900) { m.wheelReady = now + (P.wheel.life + P.wheel.gap * cdk) * 1000; this.startAct(z, "wheel", P.wheel.cast, a); this.plantWheel(z, now); return; }
      if (now >= m.sermonReady && d < 900) { m.sermonReady = now + P.sermon.cd * cdk * 1000; this.startAct(z, "sermon", P.sermon.total, a); return; }
      if (d < P.strike.trigger + z.radius && now >= (m.strikeReady || 0)) {   // nothing big ready and you're in his face: Lamp Strike
        m.strikeReady = now + P.strike.cd * cdk * 1000; this.startAct(z, "strike", P.strike.total, a);
        this.broadcast("pyre", { k: "strike", id: z.id, a: Math.round(a * 100) / 100, r: P.strike.r, wind: P.strike.windup }); return;
      }
    }
    if (d > z.radius + 30) this.bossMove(z, near, z.speed * dt);
    this.pushOut(z, [{ x: this.A.cx, y: this.A.cy, hw: TOWER_HALF, hh: TOWER_HALF }], z.radius * .7);   // walks round the radio tower, not through it
  }
  // SIENNA's DEAD EYE (E, Nov 9): one huge AIMED shot where the mouse points = 12x a shot of her gun. Its damage, reach and how many zombies it
  // goes through come from the gun: sniper pierces 3 (+50% on bosses / brutes), shotgun fires a slug worth all 5 pellets that pierces 2,
  // launcher a round that blows up on the first zombie (12x its blast), others hit 1. Holding a melee weapon: it uses her gun (primary first).
  deadEye(p) {
    const held = WEAPONS[p.weapon] && p.activeSlot !== 1 ? p.weapon : WEAPONS[p.primary] ? p.primary : WEAPONS[p.secondary] ? p.secondary : "pistol";
    const w = WEAPONS[held], c = CLASS_STATS[p.characterClass] || CLASS_STATS.assault, a = p.aim || 0, now = Date.now();
    const dmg = w.dmg * (w.pellets || 1) * (1 + ((p.bonusDamage || 0) + (p.buffDamage || 0)) / 100) * c.dmgMult * DEAD_EYE.mult;
    const wall = this.wallDist(p.x, p.y, a, w.range), hits = this.rayHits(p, a, wall).slice(0, w.splash ? 1 : (w.pierce || 1));
    for (const h of hits) {
      if (w.splash) { this.ripples.push({ kind: "rocket", owner: p.sessionId, x: h.z.x, y: h.z.y, t: now, at: 0, dmg, r: w.splash, flat: 1, push: 14, wallSafe: true }); continue; }
      this.hitZombie(h.z, p, dmg * (w.bigMult && (h.z.boss || h.z.kind === "brute") ? w.bigMult : 1));
    }
    const len = hits.length ? hits[hits.length - 1].t : wall;
    this.broadcast("deadeye", { id: p.sessionId, x: Math.round(p.x), y: Math.round(p.y), a: +a.toFixed(3), len: Math.round(len), w: held, hits: hits.map(h => Math.round(h.t)) });
  }
  nearGen(p) { return hyp(p.x - (this.A.cx + GEN_OFF.x), p.y - (this.A.cy + GEN_OFF.y)) <= STATION_R.gen; }
  // WHEEL OF FLAME: 4 lines from a fixed centre turning clockwise (screen y points down, so a growing angle = clockwise)
  wheelAngle(wh, now) { return wh.a + wh.w * (now - wh.t0) / 1000; }
  wheelMsg(now) { const wh = this.pyreFx.wheel, W = PYRE.wheel; return { k: "wheel", id: wh.owner, x: Math.round(wh.x), y: Math.round(wh.y), a: +this.wheelAngle(wh, now).toFixed(4), w: +wh.w.toFixed(4), warn: Math.max(0, (wh.fireAt - now) / 1000), life: (wh.until - now) / 1000, len: W.len, hw: W.hw }; }
  plantWheel(z, now) {
    const W = PYRE.wheel; this.pyreFx.wheel = { owner: z.id, x: z.x, y: z.y + z.radius * .8, a: -Math.PI / 2, t0: now, w: Math.PI * 2 / (z.enraged ? W.enrageTurn : W.turn), fireAt: now + W.warn * 1000, until: now + (W.warn + W.life) * 1000, hit: new Map() };
    this.broadcast("pyre", this.wheelMsg(now)); this.state.message = "WHEEL OF FLAME - walk clockwise!";
  }
  onWheel(wh, p, now) {   // is this survivor's feet on one of the 4 lines?
    const dx = p.x - wh.x, dy = p.y + 16 - wh.y, a = this.wheelAngle(wh, now);
    for (let k = 0; k < 4; k++) {
      const c = Math.cos(a + k * Math.PI / 2), s = Math.sin(a + k * Math.PI / 2), along = dx * c + dy * s;
      if (along > -BODY_R && along < PYRE.wheel.len && Math.abs(dy * c - dx * s) < PYRE.wheel.hw + BODY_R * .6) return true;
    }
    return false;
  }
  pyreHazards(z, now) {   // pillars erupt after their warning; standing in a fire patch keeps you burning; the wheel's lines burn
    const P = PYRE, F = this.pyreFx, wh = F.wheel;
    if (wh && wh.owner === z.id) {
      wh.x = z.x; wh.y = z.y + z.radius * .8;   // the wheel turns round his feet, wherever he goes
      if (now >= wh.until) F.wheel = null;
      else if (now >= wh.fireAt) for (const p of this.state.players.values()) {
        if (!p.alive || now < (wh.hit.get(p.sessionId) || 0) || !this.onWheel(wh, p, now)) continue;
        if (this.pyreHit(p, z, P.wheel.mult)) wh.hit.set(p.sessionId, now + P.wheel.every * 1000);
      }
    }
    if (F.pillars.length) F.pillars = F.pillars.filter(h => {
      if (h.owner !== z.id || now < h.at) return true;
      for (const p of this.state.players.values()) if (hyp(p.x - h.x, (p.y + 16 - h.y) / .7) < P.sermon.r + BODY_R) this.pyreHit(p, z, P.sermon.mult);
      return false;
    });
    if (F.patches.length) {
      F.patches = F.patches.filter(h => h.until > now);
      for (const p of this.state.players.values()) if (p.alive && F.patches.some(h => h.owner === z.id && hyp(p.x - h.x, (p.y + 16 - h.y) / .7) < P.walk.r + BODY_R * .6)) this.ignite(p, z);
    }
  }
  tickBurn(dt, now) {   // survivors on fire (Pyre Priest)
    if (!this.pBurn.size) return;
    for (const [sid, b] of this.pBurn) {
      const p = this.state.players.get(sid);
      if (!p || !p.alive || now >= b.until) { this.pBurn.delete(sid); continue; }
      if (this.untouchable(p)) continue;
      if (p.armor === 2) { this.pBurn.delete(sid); continue; }   // the Pyre Plate: fireproof
      const dealt = b.dps * dt * (1 - (p.armorPct || 0)); p.hp -= dealt; p.damageTaken += dealt;
      if (p.hp <= 0) { this.pBurn.delete(sid); this.downPlayer(p); }
    }
  }
  butcherThink(z, dt, now, players) {
    const B = BUTCHER, m = this.bmem(z, now);
    if (!z.enraged && z.hp / z.maxHp < B.enrageAt) {
      z.enraged = true; z.speed *= B.enrageSpeed; m.spinReady = now + 1200;
      this.state.message = "THE BUTCHER IS ENRAGED!"; this.broadcast("roar", { x: Math.round(z.x), y: Math.round(z.y) });
    }
    if (z.act) {
      const t0 = z.actLen - z.slam; z.slam = Math.max(0, z.slam - dt); const t1 = z.actLen - z.slam, act = z.act;
      this["butcher_" + act](z, t0, t1, dt, m, now, players);
      if (z.act === act && z.slam <= 0) { z.act = ""; z.hookId = ""; }
      return;
    }
    if (!players.length) {   // nobody he can reach (Sofea flying, Raven hidden, everyone in a safehouse): he goes for the radio tower instead of standing still
      const tw = { x: this.A.cx, y: this.A.cy }, ta = Math.atan2(tw.y - z.y, tw.x - z.x), td = distance(z, tw); z.aim = ta; z.targetId = "";
      if (td > z.radius + TOWER_HALF + 20) this.bossMove(z, tw, z.speed * dt);
      else if (now >= m.chopReady) { m.chopReady = now + BUTCHER.chop.cd * 1000; this.state.towerHp = Math.max(0, this.state.towerHp - z.damage * 2); this.broadcast("chop", { x: Math.round(z.x + Math.cos(ta) * 55), y: Math.round(z.y + Math.sin(ta) * 55), r: BUTCHER.chop.rings, d: BUTCHER.chop.ringDelay });
        if (this.state.towerHp <= 0) { this.state.phase = "defeat"; this.state.message = "THE RADIO TOWER HAS BEEN DESTROYED — TEAM DEFEATED."; } }
      return;
    }
    const near = players.reduce((a, b) => distance(z, a) < distance(z, b) ? a : b), d = distance(z, near), a = Math.atan2(near.y - z.y, near.x - z.x);
    z.targetId = near.sessionId;
    if (z.enraged && now >= m.spinReady) { this.startAct(z, "spin", B.spin.dur, a); m.spinTick = 0; return; }
    if (d < B.chop.trigger && now >= m.chopReady) { m.combo = false; m.chopW = B.chop.windup; this.startAct(z, "chop", B.chop.windup + B.chop.after, a); return; }
    if (now >= m.hookReady) {
      const cands = players.filter(p => { const pd = distance(z, p); return pd >= B.hook.minRange && pd <= B.hook.range && this.lineClear(z, p) && !this.sheltered(p); });
      if (cands.length) {
        const far = cands.reduce((a, b) => distance(z, a) > distance(z, b) ? a : b);
        m.hookTarget = far.sessionId; z.targetId = far.sessionId; z.hookD = 0; m.lastTX = m.lastTY = undefined; m.vx = m.vy = 0;
        const cd = z.enraged ? B.hook.enragedCd : B.hook.cd; m.hookReady = now + rand(cd[0], cd[1]) * 1000;
        this.startAct(z, "hook", B.hook.aim + B.hook.range / this.hookSpd() + .05, Math.atan2(far.y - z.y, far.x - z.x)); return;
      }
    }
    z.aim = a;
    if (d > z.radius + 30) this.bossMove(z, near, z.speed * dt);   // walks around buildings and cars instead of getting wedged
  }
  butcher_chop(z, t0, t1, dt, m, now) {
    const C = BUTCHER.chop, W = m.chopW || C.windup;
    const cx = z.x + Math.cos(z.aim) * C.offset, cy = z.y + Math.sin(z.aim) * C.offset;
    for (let i = 0; i < 3; i++) {
      const at = W + i * C.ringDelay; if (!(t0 < at && t1 >= at)) continue;
      if (i === 0) this.broadcast("chop", { x: Math.round(cx), y: Math.round(cy), r: C.rings, d: C.ringDelay });
      const inner = i ? C.rings[i - 1] : 0, outer = C.rings[i];
      for (const p of this.state.players.values()) {
        if (!p.alive || this.untouchable(p)) continue; const zd = ringZone(p.x - cx, p.y - cy); if (zd < inner || zd >= outer) continue;
        if (i === 0) { const dealt = this.armorHit(p, z.damage); p.hp -= dealt; p.damageTaken += dealt; if (p.hp <= 0) this.downPlayer(p); }
        else if (i === 1) { p.stunned = Math.max(p.stunned || 0, C.stun); p.charging = false; }
        else p.slowed = Math.max(p.slowed || 0, C.slow);
      }
    }
    if (z.slam <= 0) { m.chopReady = now + C.cd * 1000; m.combo = false; }
  }
  butcher_hook(z, t0, t1, dt, m, now) {
    const H = BUTCHER.hook, target = this.state.players.get(m.hookTarget);
    if (t1 < H.aim) {   // aiming: tracks the target and LEADS them (aims where they'll be when the hook arrives); locks just before the throw
      if (target?.alive && t1 < H.aim - H.lock) {
        const vx = m.lastTX !== undefined && dt > 0 ? (target.x - m.lastTX) / dt : 0, vy = m.lastTY !== undefined && dt > 0 ? (target.y - m.lastTY) / dt : 0;
        m.vx = (m.vx || 0) * .6 + vx * .4; m.vy = (m.vy || 0) * .6 + vy * .4;
        const lead = distance(z, target) / this.hookSpd() + (H.aim - t1);
        z.aim = Math.atan2(target.y + m.vy * lead - z.y, target.x + m.vx * lead - z.x);
      }
      if (target) { m.lastTX = target.x; m.lastTY = target.y; }
      return;
    }
    if (t0 < H.aim) m.wall = Math.min(this.wallDist(z.x, z.y - 30, z.aim, H.range), this.wallDist(z.x, z.y, z.aim, H.range), this.boxRayDist(z.x, z.y, z.aim, H.range, this.safeBoxes));   // buildings and Astra's safehouse stop the hook                                                  // thrown: where would it hit a wall?
    const reach = Math.min(H.range, m.wall ?? H.range), d0 = z.hookD || 0, d1 = Math.min(reach, (t1 - H.aim) * this.hookSpd());
    z.hookD = d1;
    const dx = Math.cos(z.aim), dy = Math.sin(z.aim);
    let hit = null, best = Infinity;
    for (const p of this.state.players.values()) {
      if (!p.alive || this.untouchable(p)) continue; const vx = p.x - z.x, vy = p.y - z.y, along = vx * dx + vy * dy;
      if (along < d0 - H.hitR || along > d1 + H.hitR) continue;
      if (Math.abs(vx * dy - vy * dx) <= H.hitR + BODY_R && along < best) { best = along; hit = p; }
    }
    if (hit && this.canDeflect(hit, z, now, DEFLECT.window)) { this.deflectHook(z, hit, now); return; }
    if (hit) {
      z.hookId = hit.sessionId; z.hookD = best; hit.stunned = Math.max(hit.stunned || 0, .3); hit.charging = false;
      const dealt = this.armorHit(hit, H.dmg); hit.hp -= dealt; hit.damageTaken += dealt;
      if (hit.hp <= 0) { this.downPlayer(hit); this.startAct(z, "hookback", .35); return; }
      this.broadcast("hooked", { id: hit.sessionId }); m.stuck = 0;
      this.startAct(z, "pull", 2.5); return;
    }
    if (d1 >= reach) this.startAct(z, "hookback", Math.max(.25, Math.min(.5, reach / (this.hookSpd() * 1.6))));   // missed: reel the chain back in
  }
  butcher_hookback() {}
  butcher_stagger() {}
  hookSpd() { return this.state.hookSpeed || BUTCHER.hook.speed; }
  // ---------- Midnight Carnival: the coaster (track + maths in mapLayout.js) ----------
  coasterBoard(sid) {
    const C = this.coaster, p = this.state.players.get(sid); C.queue.delete(sid); if (!p || !p.alive || p.ride > 0) return false;
    const used = new Set([...C.riders.values()].map(r => r.seat)); let seat = 0; while (used.has(seat)) seat++; if (seat >= C.K.seats) return false;
    C.riders.set(sid, { seat, done: 0, from: C.next }); C.held?.delete(sid); p.ride = seat + 1; this.broadcast("coaster", { k: "on", id: sid }); return true;
  }
  coasterOff(sid) {   // off the train: onto the ground in front of the station it's stopped at (or under the track if they were knocked off), and the cooldown starts
    const C = this.coaster, p = this.state.players.get(sid); if (!C || !C.riders.has(sid)) return; C.riders.delete(sid);
    const atBoss = C.wait > 0 && (C.T.stations[C.next]?.boss || C.T.stations[C.next]?.shrine !== undefined); if (atBoss) (C.held ||= new Set()).add(sid); else if (!this.mine) C.cd.set(sid, Date.now() + C.K.cd * 1000);   // the boss stop (the mine): no cooldown, and the carts wait there until you're back on
    if (!p) return; p.ride = 0;
    const [dx0, dy0] = MN_SPOT.dungeon, cord = c => C.K.along && c.x > dx0 * this.A.width / 6000 - 40 && c.y > dy0 * this.A.height / 4000 - 40;   // (the mine: knocked off inside the cordoned dungeon = back on the station deck)
    if (C.wait > 0 && C.T.stations[C.next]?.shrine !== undefined) { const st = C.T.stations[C.next], sh = this.shieldShrine(st.shrine) || st; p.x = st.x + (sh.x - st.x) * .4 + rand(-20, 20); p.y = st.y + (sh.y - st.y) * .4 + rand(-10, 10); }   // the shield run's stop: off toward the shrine
    else if (C.wait > 0 || cord(coasterAt(C.T, C.s))) { const st = C.T.stations[C.wait > 0 ? C.next : 0]; if (C.K.along) { p.x = st.x + rand(-110, 150); p.y = (st.off || 1) < 0 ? st.y - 160 + rand(0, 14) : st.y + 42 + rand(0, 10); } else { p.x = st.x + rand(-70, 150); p.y = st.y - 44 + rand(0, 10); } }   // the mine: onto the station's deck, in front of the carts   // onto the platform; they walk down the steps else { const c = coasterAt(C.T, C.s); p.x = c.x; p.y = c.y + 34; }
    this.solveCollisions(p); this.broadcast("coaster", { k: "off", id: sid });
  }
  updateCoaster(dt) {
    const C = this.coaster, T = C.T, now = Date.now();
    const holding = () => { const stn = T.stations[C.next]; if (!C.held?.size || !(stn?.boss || stn?.shrine !== undefined)) return 0; let n = 0; for (const sid of [...C.held]) { const q = this.state.players.get(sid); if (!q || !q.alive || q.ride > 0 || (stn.boss && this.cordon && !(q.x > this.cordon.x && q.y > this.cordon.y))) C.held.delete(sid); else n++; } return n; };   // (the shield run's stop waits for its rider too)   // who got off at the boss stop and isn't back yet (downed / gone = not waited for)
    if (C.wait > 0) { C.hold = holding(); const gate = this.mine ? this.mineGate(C) : 0; if (gate === 1) C.wait = Math.max(C.wait, DEEP.leave + dt); else if (gate === 2) C.wait = Math.min(C.wait, 2); else if (gate === 3) C.wait = Math.min(C.wait, dt);   // 3 = go now (the shield run)   // the mine mission: 1 = the carts stay put, 2 = nothing to wait for
      C.wait -= dt; if (C.wait <= 0) { if (C.hold) C.wait = .25; else { if (this.mine) this.mineDepart(C); C.wait = 0; C.next = (C.next + 1) % T.stations.length; C.s = (C.s + 2) % T.L; if (this.mine?.step === "chase" || C.express) C.next = T.stations.findIndex(q => q.boss); } } }   // leaving: just past the platform, so with ONE station the next stop is a whole lap away
    else { C.hold = 0; let left = (((T.stations[C.next].s - C.s) % T.L) + T.L) % T.L; 
      const step = Math.min(C.K.speed * (this.mine ? (this.mine.step === "chase" ? DEEP.chaseSpeed : DEEP.speed) * (C.express ? BEAST.shield.express : 1) : 1), Math.max(70, left * 1.6)) * dt, go = Math.min(step, left);   // (the shield run's way back: express)   // slows into the station
      for (const r of C.riders.values()) r.done += go;
      if (step >= left && this.mine?.step === "chase") { C.s = T.stations[C.next].s; C.wait = 99; this.mineEscape(); }   // the chase lap is done: back in the dungeon, through the portal
      else if (step >= left) { C.s = T.stations[C.next].s; C.wait = C.K.wait; if (T.stations[C.next].boss && C.express) { C.express = false; for (const sid of [...C.riders.keys()]) this.coasterOff(sid); C.held?.clear(); if (!this.mine?.shield) this.dropShieldStop(); }   /* back from the shield run: off you get */ for (const [sid, r] of [...C.riders]) if (!T.stations[C.next].boss && (r.done >= T.L - 40 || T.stations[r.from]?.boss)) this.coasterOff(sid);
        const st = T.stations[C.next]; for (const [sid, si] of [...C.queue]) { const p = this.state.players.get(sid); if (!p || !p.alive) { C.queue.delete(sid); continue; } if (si === C.next && Math.hypot(p.x - st.x, p.y - (st.y + 40)) < COASTER_NEAR + 60) this.coasterBoard(sid); } }   // whoever was waiting here gets on   // one lap: off you get
      else C.s = (C.s + step) % T.L; }
    for (const [sid, r] of [...C.riders]) { const p = this.state.players.get(sid); if (!p || !p.alive) { C.riders.delete(sid); if (p) p.ride = 0; continue; } const q = coasterSeat(T, C.s, r.seat); p.x = q.x; p.y = q.y; }
    for (const [sid, until] of [...C.cd]) { const p = this.state.players.get(sid), left = Math.ceil((until - now) / 1000); if (!p || left <= 0) { C.cd.delete(sid); if (p) p.rideCd = 0; } else if (p.rideCd !== left) p.rideCd = left; }
    this.state.coasterS = Math.round(C.s * 10) / 10; const w = C.hold && C.wait <= .26 ? 1000 + C.hold : C.wait > 0 ? Math.ceil(C.wait * 4) / 4 : 0; if (this.state.coasterWait !== w) this.state.coasterWait = w;   // 1000 + n: the carts are holding at the boss stop for n survivors (no new schema field)
  }
  // ---------- WAVE 20: the Deep Mine mission (see DEEP) ----------
  startMine() {
    const s = this.state; this.dismountAll();
    if (SITES[s.mapSite].style !== "mine") {   // onto the mine map for this wave; what the team built is put away and comes back afterwards
      this.mineBack = { site: s.mapSite, structures: [...s.structures.values()].filter(st => !(st.life > 0)).map(st => ({ id: st.id, kind: st.kind, x: st.x, y: st.y, hp: st.hp, maxHp: st.maxHp, ownerId: st.ownerId, aim: st.aim || 0, deploy: st.deploy || 0 })) };
      s.structures.clear(); s.loot.clear(); s.puddles.clear(); s.robots.clear(); this.astra.clear(); this.unitMem.clear(); this.safeBoxes = []; this.spits = []; this.ripples = [];
      this.loadSite(DEEP.site);
    } else this.loadSite(s.mapSite);   // already on the mine: everyone back to camp, the carts back at the station
    const P = this.minePieces, hpRef = 38 * (1 + (s.stage - 1) * .08) * (DIFFICULTY[s.difficulty] || DIFFICULTY.normal).hp;
    this.mine = { step: "runes", t: 0, fuel: 0, placed: 0, inserted: false, cartHp: DEEP.cartHp, gap: DEEP.gap0, runes: P.shrines.slice(0, 4).map(d => ({ st: 0, x: d.x, y: d.y + 34, by: "" })), shardClock: 0, zClock: 4, towerHp: s.towerHp, hpRef, beast: "" };
    s.waveType = "mission"; s.bossPhase = ""; s.bossIntro = ""; this.spawnClock = 1e9;
    for (let i = 0; i < 8; i++) this.mineShard();
    s.message = `WAVE ${s.stage}: THE DEEP MINE. Put four runes in the statue.`; this.mineSync(); this.broadcast("deep", { k: "start" });
  }
  endMine(won) {   // the mission is over (won, a test jump, or a new match): back to the map the team came from, their structures back in place
    const s = this.state, back = this.mineBack; this.mine = null; this.mineBack = null; s.mission = "";
    for (const z of [...s.zombies.values()]) if (z.kind === "minebeast") s.zombies.delete(z.id);
    for (const item of [...s.loot.values()]) if (item.kind === "shard") s.loot.delete(item.id);
    if (this.coaster) { for (const sid of this.coaster.riders.keys()) { const p = s.players.get(sid); if (p) p.ride = 0; } this.coaster.riders.clear(); this.coaster.held?.clear(); }
    if (back) { this.loadSite(back.site); for (const o of back.structures) { const st = new StructureState(); Object.assign(st, o); st.fire = false; s.structures.set(st.id, st); } }
    else if (SITES[s.mapSite].style === "mine") this.loadSite(s.mapSite);
    if (s.waveType === "mission") s.waveType = "normal";
  }
  mineSync() { const m = this.mine, str = !m ? "" : [m.step, m.fuel, m.placed, m.cartHp, Math.round(m.gap / 10) * 10, m.inserted ? 1 : 0, m.runes.map(r => `${r.st}.${Math.round(r.x)}.${Math.round(r.y)}.${r.by}`).join(","), m.crystals ?? BEAST.crystals.n, m.shield ? `${m.shield.i}.${Math.round(m.shield.ov / BEAST.shield.ov * 100)}.${Math.ceil(BEAST.shield.pressure - m.shield.t)}.${m.shield.by}` : "", (this.coaster?.T.stations.find(q => q.shrine !== undefined)?.shrine) ?? ""].join("|"); if (this.state.mission !== str) this.state.mission = str; }
  mineShard(x, y) {   // a crystal shard (cart fuel): where a zombie fell, or lying near one of the mine's crystals
    const s = this.state; if ([...s.loot.values()].filter(q => q.kind === "shard").length >= DEEP.shardCap) return;
    if (x === undefined) { const cr = this.minePieces.crystals; for (let t = 0; t < 12; t++) { const c = cr[Math.floor(Math.random() * cr.length)], a = Math.random() * Math.PI * 2, d = 70 + Math.random() * 90; x = c.x + Math.cos(a) * d; y = c.y - 20 + Math.sin(a) * d * .7; if (!this.blockedByMap(x, y, 16) && !this.inCordon({ x, y })) break; x = undefined; } if (x === undefined) return; }
    if (this.inCordon({ x, y })) return;
    const item = new LootState(); item.id = `l${++this.lootSequence}`; item.kind = "shard"; item.amount = 1; item.rarity = "Rare"; item.x = x + rand(-14, 14); item.y = y + rand(-10, 10); s.loot.set(item.id, item);
  }
  mineUse(p) {   // F: put the rune you carry into the statue (inside the dungeon, at its plinth), or take a rune from a shrine / off the ground
    const m = this.mine;
    if (m.step === "fight" && m.shield) { const sh = this.shieldShrine(m.shield.i); if (sh && hyp(p.x - sh.x, p.y - sh.y) < BEAST.shield.ovR && m.shield.by !== p.sessionId) { m.shield.by = p.sessionId; m.shield.ov = 0; this.state.message = `${p.name} is overloading the shrine: stay close!`; this.broadcast("deep", { k: "overload", id: p.sessionId }); this.mineSync(); } return; }   // the shield run: F at the glowing shrine, then stay close for 3s
    if (m.step !== "runes") return; const mine = m.runes.find(r => r.st === 1 && r.by === p.sessionId), ST = this.minePieces.statue;
    if (mine) { if (!m.inserted && this.inCordon(p) && hyp(p.x - ST.x, p.y - (ST.y + 20)) < DEEP.insertR) this.mineInsert(mine); return; }
    let best = null, bd = DEEP.takeR; for (const r of m.runes) if (r.st === 0 || r.st === 2) { const d = hyp(p.x - r.x, p.y - r.y); if (d < bd) { bd = d; best = r; } }
    if (best) { best.st = 1; best.by = p.sessionId; this.broadcast("deep", { k: "take", id: p.sessionId }); this.state.message = `${p.name} has a rune! Get it to the cart station.`; this.mineSync(); }
  }
  mineInsert(r) {
    const m = this.mine, s = this.state; r.st = 3; r.by = ""; m.placed++; m.inserted = true; this.broadcast("deep", { k: "rune", n: m.placed });
    if (m.placed >= 4) this.mineAwaken();
    else s.message = `Rune ${m.placed}/4 is in. Ride back and find the next one.`;
    this.mineSync();
  }
  mineGate(C) {   // what the carts do while stopped: 1 = stay, 2 = nothing to wait for (leave soon), 0 = their normal wait
    const m = this.mine, boss = !!C.T.stations[C.next]?.boss, carried = [...C.riders.keys()].some(sid => m.runes.some(r => r.st === 1 && r.by === sid));
    const stn = C.T.stations[C.next];
    if (m.step === "fight" && stn?.shrine !== undefined) return C.riders.size ? (m.shield ? 1 : 3) : C.held?.size ? 1 : 2;   // the shield run's stop: wait while the rider is off (or still aboard with the shield up); once they're back on (or gone), head back
    if (m.step === "fight" && boss && m.shield && C.riders.size) return 3;   // ONE rider aboard at the boss stop: off to the shrine RIGHT AWAY (Nov 12: no waiting)
    if (m.step === "awake" || m.step === "fight" || m.step === "flee" || m.step === "escaped") return 1;
    if (m.step === "chase") return 2;
    if (!boss) return carried && m.fuel >= DEEP.fuelCost ? 0 : 1;   // the station: they leave once a rune is aboard and they're fuelled
    return carried && !m.inserted ? 1 : C.riders.size ? 2 : 1;   // the boss stop: wait for the rune to go in (and for whoever hopped off: C.hold), then go
  }
  mineDepart(C) { const m = this.mine; if (C.T.stations[C.next]?.shrine !== undefined) C.express = true; if (m.step === "runes" && !C.T.stations[C.next]?.boss) { m.fuel = Math.max(0, m.fuel - DEEP.fuelCost); m.inserted = false; this.state.message = "The carts are rolling: next stop, the boss dungeon."; } }
  mineAwaken() {   // the fourth rune is in (or the test button): EVERYONE is pulled into the dungeon in front of the statue while it breaks its chains
    const m = this.mine, s = this.state, C = this.coaster, ST = this.minePieces.statue, bi = C.T.stations.findIndex(q => q.boss); this.dismountAll();
    for (const r of m.runes) { r.st = 3; r.by = ""; } m.placed = 4; m.inserted = true; m.step = "awake"; m.t = DEEP.awake; m.haz = [];
    for (const z of [...s.zombies.values()]) s.zombies.delete(z.id); this.sweepZombieMemory(); for (const item of [...s.loot.values()]) if (item.kind === "shard") s.loot.delete(item.id);
    for (const sid of C.riders.keys()) { const p = s.players.get(sid); if (p) p.ride = 0; } C.riders.clear(); C.held?.clear(); C.queue.clear(); C.cd.clear(); C.s = C.T.stations[bi].s; C.next = bi; C.wait = DEEP.leave; C.hold = 0;
    const ps = [...s.players.values()]; ps.forEach((p, i) => { p.x = ST.x + (i - (ps.length - 1) / 2) * 76 + rand(-8, 8); p.y = ST.y + 250 + (i % 2) * 44 + rand(0, 10); p.rideCd = 0; this.shadowDash?.delete(p.sessionId); this.solveCollisions(p); if (p.alive) p.hp = p.maxHp; });
    s.message = "THE MINE BEAST IS BREAKING ITS CHAINS!"; this.broadcast("deep", { k: "awake", len: DEEP.awake }); this.mineSync();
  }
  mineFight() {   // the stone has burst off: the fight, on foot, inside the dungeon
    this.statueBroken = true; this.refreshMapBoxes();   // the stone shell is gone: only the plinth still blocks
    const m = this.mine, s = this.state, ST = this.minePieces.statue, D = DIFFICULTY[s.difficulty] || DIFFICULTY.normal, scale = 1 + (s.stage - 1) * .08;
    const z = new ZombieState(); z.id = `z${++this.zombieSequence}`; z.kind = "minebeast"; z.x = ST.x; z.y = ST.y + 110; z.speed = BEAST.speed; z.radius = BEAST.radius; z.attackCooldown = 0; z.targetId = ""; z.boss = true; z.role = "mine"; z.slam = 0; z.act = ""; z.hookId = ""; z.enraged = false; z.aim = Math.PI / 2;
    z.maxHp = BEAST.hp * scale * (1 + BOSS_HP_PER_PLAYER * Math.max(0, s.players.size - 1)) * D.hp; z.hp = z.maxHp; z.damage = BEAST.dmg * scale * D.dmg;
    s.zombies.set(z.id, z); m.beast = z.id; m.step = "fight"; m.haz = []; m.crystals = BEAST.crystals.n; m.boulders = []; this.bossMem.delete(z.id);
    this.beastBoxes = mapBoxes([this.minePieces.statue, this.minePieces.portal].filter(Boolean));
    s.message = "THE MINE BEAST IS AWAKE!"; this.broadcast("deep", { k: "fight" }); this.broadcast("roar", { x: Math.round(z.x), y: Math.round(z.y) }); this.mineSync();
    if (this.beastHpOnArrival) { const pct = this.beastHpOnArrival; this.beastHpOnArrival = 0; this.beastSetHp(pct); }   // (test menu: straight to its 66% / 33% shield run)
  }
  mineFlee(z) {   // its bar is empty: it drops to a knee. Everyone gets to the carts (F at the boss stop); then it comes after them
    const m = this.mine; if (m.step !== "fight") return; this.dismountAll(); m.step = "flee"; m.t = BEAST.fleeWait; m.haz = []; m.boulders = []; m.shield = null; this.dropShieldStop(); z.boss = false; z.hp = 1; this.startAct(z, "stagger", BEAST.fleeWait + 2);
    this.state.message = "IT WON'T STAY DOWN: GET IN THE CARTS!"; this.broadcast("deep", { k: "flee", len: BEAST.fleeWait }); this.mineSync();
  }
  beastSetHp(pct) {   // (test menu) the Beast at 66% / 33%: the matching shield run comes up next
    const m = this.mine, z = m && this.state.zombies.get(m.beast); if (!z || z.kind !== "minebeast" || m.step !== "fight") return;
    if (m.shield) { m.shield = null; this.dropShieldStop(); } z.hp = z.maxHp * (pct - .001); m.shieldsDone = pct <= .34 ? 1 : 0; z.act = ""; z.slam = 0; const bm = this.bossMem.get(z.id); if (bm) bm.next = 0; this.mineSync();
  }
  mineChase() {   // everyone left in the dungeon is put in the carts (the downed are pulled aboard), and it comes after them
    const m = this.mine, s = this.state, C = this.coaster, ST = this.minePieces.statue;
    for (const p of s.players.values()) { if (!p.alive && !p.bledOut && this.inCordon(p)) { p.alive = true; p.hp = Math.max(1, p.maxHp * .3); p.bleedout = 0; } if (p.alive && !(p.ride > 0) && (this.inCordon(p) || C.held?.has(p.sessionId))) this.coasterBoard(p.sessionId); }
    if (!C.riders.size) { this.mineEscape(); return; }   // (nobody left in there: nothing to chase)
    let z = s.zombies.get(m.beast); if (!z) { z = new ZombieState(); z.id = `z${++this.zombieSequence}`; z.kind = "minebeast"; z.x = ST.x; z.y = ST.y + 40; z.attackCooldown = 0; z.targetId = ""; z.role = "mine"; z.hookId = ""; z.enraged = false; z.aim = Math.PI / 2; s.zombies.set(z.id, z); }
    z.maxHp = 1e8; z.hp = 1e8; z.speed = 0; z.damage = 0; z.radius = 70; z.boss = false; z.slam = 0; z.act = ""; m.haz = [];
    m.beast = z.id; m.step = "chase"; m.gap = DEEP.gap0; m.t = 0; C.wait = Math.min(C.wait, .1); C.held?.clear();
    s.message = "IT'S COMING AFTER THE CARTS: SHOOT IT TO HOLD IT BACK!"; this.broadcast("deep", { k: "chase" }); this.broadcast("roar", { x: Math.round(z.x), y: Math.round(z.y) });
  }
  // ---------- the Mine Beast's fight (see BEAST) ----------
  beastMove(z, dx, dy) {   // it walks over the dungeon's small things (braziers, candles, statues of miners); only the walls, its plinth and the portal stop it
    const K = this.cordon, x0 = z.x, y0 = z.y; z.x = clamp(z.x + dx, K.x + 25 + 85, this.A.width - 90); z.y = clamp(z.y + dy, K.y + 10 + 150, this.A.height - 75);
    this.pushOut(z, this.beastBoxes || [], BEAST.radius); return hyp(z.x - x0, z.y - y0);
  }
  beastHazards(now) {   // planted crystals shattering, rocks landing (the stray cave-in rocks stay as boulders)
    const m = this.mine; if (!m.haz?.length) return;
    m.haz = m.haz.filter(h => { if (now < h.at) return true; for (const p of this.state.players.values()) if (p.alive && hyp(p.x - h.x, (p.y - h.y) / .75) < h.r + BODY_R) this.hiveHurt(p, h.dmg); if (h.boulder && this.mine?.step === "fight") this.addBoulder(h.x, h.y, now); return false; });
  }
  addBoulder(x, y, now) {   // a fallen rock that stays a while: harmless to walk past, but the Beast's charge smashes into it and stuns itself
    const m = this.mine, B = BEAST.boulder; m.boulders ||= []; m.bSeq = (m.bSeq || 0) + 1;
    if (m.boulders.some(b => hyp(b.x - x, b.y - y) < B.r * 1.6) || this.blockedByMap(x, y, 30)) return;
    const b = { id: m.bSeq, x: Math.round(x), y: Math.round(y), until: now + B.life * 1000 }; m.boulders.push(b); this.broadcast("deep", { k: "boulder", id: b.id, x: b.x, y: b.y, life: B.life });
    while (m.boulders.length > B.cap) { const o = m.boulders.shift(); this.broadcast("deep", { k: "boulderGone", id: o.id }); }
  }
  beastCrystals(z) { const m = this.mine; return m ? (m.crystals ?? BEAST.crystals.n) : 0; }
  beastCrystalHit(z, p, dmg, bm) {   // hits from behind land on the crystals on its back: double damage; break all of them and it reels for a long time
    const C = BEAST.crystals, m = this.mine; if (!m || m.step !== "fight" || !p || !Number.isFinite(p.x) || !bm) return dmg;
    if ((m.crystals ?? C.n) <= 0 || z.act === "under" || z.act === "dive" || z.act === "erupt") return dmg;
    let off = Math.abs(Math.atan2(p.y - z.y, p.x - z.x) - (z.aim || 0)) % (Math.PI * 2); if (off > Math.PI) off = Math.PI * 2 - off;
    if (off < C.back) return dmg;
    dmg *= C.mult; m.crystals ??= C.n; bm.crHp ??= z.maxHp * C.hpPct; bm.crHp -= dmg; const now = Date.now();
    if (now - (bm.critAt || 0) > 140) { bm.critAt = now; this.broadcast("deep", { k: "crit", x: Math.round(z.x), y: Math.round(z.y) }); }
    if (bm.crHp <= 0) { m.crystals--; bm.crHp = z.maxHp * C.hpPct; this.broadcast("deep", { k: "crystal", left: m.crystals, x: Math.round(z.x), y: Math.round(z.y), red: z.enraged ? 1 : 0 }); this.mineSync();
      if (m.crystals <= 0) { this.startAct(z, "stagger", C.stagger); bm.next = Date.now() + (C.stagger + 1) * 1000; this.state.message = "ALL ITS CRYSTALS ARE BROKEN: THE BEAST IS REELING!"; this.broadcast("deep", { k: "broke" }); }
      else this.state.message = `A CRYSTAL SHATTERED! ${m.crystals} left on its back.`; }
    return dmg;
  }
  shieldShrine(i) { const P = this.minePieces.shrines[i]; return P ? { x: P.x, y: P.y + 34 } : null; }   // (where you stand to overload it)
  shieldStop(i) {   // the cart stop next to that shrine: added to the track while the shield run is on (the carts wait there until the rider is back on)
    const C = this.coaster, T = C.T, sh = this.shieldShrine(i); if (!sh) return -1; let k = T.stations.findIndex(q => q.shrine !== undefined);
    if (k >= 0 && T.stations[k].shrine === i) return k; if (k >= 0) T.stations.splice(k, 1);
    const q = trackNearest(T, sh.x, sh.y), cur = T.stations[C.next]; T.stations.push({ s: q.s, x: Math.round(q.x), y: Math.round(q.y), off: 1, shrine: i }); T.stations.sort((a, b) => a.s - b.s); C.next = Math.max(0, T.stations.indexOf(cur));   // (indices shift: keep pointing at the same stop)
    return T.stations.findIndex(st => st.shrine === i);
  }
  dropShieldStop() { const C = this.coaster; if (!C) return; const T = C.T, k = T.stations.findIndex(q => q.shrine !== undefined); if (k < 0) return; const cur = T.stations[C.next]; T.stations.splice(k, 1); C.next = Math.max(0, T.stations.indexOf(cur)); if (C.next < 0 || !T.stations[C.next]) C.next = T.stations.findIndex(st => st.boss); C.express = false; }
  startShield(z, bm, now) {   // it drives its drills into the floor: a crystal shield, fed by one rune shrine out in the mine
    const B = BEAST.shield, m = this.mine, s = this.state, C = this.coaster;
    if (!m.shieldPick) { const bs = C.T.stations.find(q => q.boss).s, L = C.T.L; m.shieldPick = this.minePieces.shrines.map((d, i) => ({ i, f: ((trackNearest(C.T, d.x, d.y + 34).s - bs) % L + L) % L })).sort((a, b) => a.f - b.f).slice(0, 2).map(o => o.i); }   // the two shrines nearest the boss stop down the line
    const i = m.shieldPick[(m.shieldsDone || 0) % m.shieldPick.length]; m.shieldsDone = (m.shieldsDone || 0) + 1; m.shield = { i, t: 0, by: "", ov: 0 }; this.shieldStop(i);
    this.startAct(z, "plunge", B.plunge); bm.next = now + (B.plunge + BEAST.gap) * 1000; const sh = this.shieldShrine(i);
    s.message = "IT'S SHIELDED! ONE survivor: ride the cart (F at the boss stop) to the glowing shrine and overload it. The rest: hold it off!";
    this.broadcast("deep", { k: "shield", x: Math.round(z.x), y: Math.round(z.y), sx: Math.round(sh.x), sy: Math.round(sh.y) }); this.mineSync();
  }
  shieldTick(z, dt, now) {
    const B = BEAST.shield, m = this.mine, S = m.shield, s = this.state; z.hp = Math.min(z.maxHp, z.hp + z.maxHp * B.regen * dt); S.t += dt;
    if (S.t >= B.pressure) { S.t = 0; z.hp = Math.min(z.maxHp, z.hp + z.maxHp * B.punish); s.message = "Too slow: the shield grows stronger, it HEALED! Overload the shrine!"; this.broadcast("deep", { k: "shieldPulse", x: Math.round(z.x), y: Math.round(z.y) }); }
    if (S.by) { const p = s.players.get(S.by), sh = this.shieldShrine(S.i);
      if (!p || !p.alive || p.ride > 0 || !sh || hyp(p.x - sh.x, p.y - sh.y) > B.ovR + 30) { S.by = ""; S.ov = 0; }
      else { S.ov += dt; if (S.ov >= B.ov) { this.breakShield(z, p); return; } } }
    this.mineSync();
  }
  breakShield(z, p) {
    const B = BEAST.shield, m = this.mine, sh = this.shieldShrine(m.shield.i), bm = this.bossMem.get(z.id); m.shield = null;
    this.startAct(z, "stagger", B.stun); if (bm) bm.next = Date.now() + (B.stun + 1) * 1000;
    this.state.message = `${p?.name || "Someone"} overloaded the shrine: THE SHIELD SHATTERED! Hit it now!`;
    this.broadcast("deep", { k: "shieldBreak", x: Math.round(z.x), y: Math.round(z.y), sx: Math.round(sh?.x || 0), sy: Math.round(sh?.y || 0) }); this.mineSync();
  }
  beastThink(z, dt, now) {
    const B = BEAST, s = this.state, m = this.mine; this.beastHazards(now);
    if (z.hp <= 1) { this.mineFlee(z); return; }
    if (m.boulders?.length) m.boulders = m.boulders.filter(b => { if (now < b.until) return true; this.broadcast("deep", { k: "boulderGone", id: b.id }); return false; });
    const E = z.enraged ? B.phase2 : null, cdk = E ? E.cd : 1;   // phase 2: shorter cooldowns
    let bm = this.bossMem.get(z.id); if (!bm) { bm = { next: now + 2500, strikeReady: 0, spinesReady: now + B.spines.first * 1000, caveReady: now + B.cavein.first * 1000, burrowReady: now + B.burrow.first * 1000, chargeReady: now + B.charge.first * 1000, prey: null, windDmg: 0 }; this.bossMem.set(z.id, bm); }
    if (m.shield) this.shieldTick(z, dt, now);
    const targets = [...s.players.values()].filter(p => p.alive && !(p.shadow > 0) && this.inCordon(p)), near = () => { let best = null, bd = 1e9; for (const p of targets) { const d = hyp(p.x - z.x, p.y - z.y); if (d < bd) { bd = d; best = p; } } return best; };
    if (z.act) {
      const act = z.act, t0 = z.actLen - z.slam; z.slam = Math.max(0, z.slam - dt); const t1 = z.actLen - z.slam, at = x => t0 < x && t1 >= x, ca = Math.cos(z.aim), sa = Math.sin(z.aim);
      if (act === "strike") B.strike.hits.forEach((h, i) => { if (!at(h * B.strike.len)) return;   // a jab: a short lane in front
        for (const p of s.players.values()) { const dx = p.x - z.x, dy = p.y - z.y, al = dx * ca + dy * sa, pe = -dx * sa + dy * ca; if (!p.alive || al < -30 || al > B.strike.reach || Math.abs(pe) > B.strike.half) continue; this.hiveHurt(p, z.damage * B.strike.mult[i]); if (i === 1 && p.alive) this.moveWithCollision(p, ca * B.strike.push, sa * B.strike.push); }
        this.broadcast("deep", { k: "jab", i, x: Math.round(z.x + ca * 150), y: Math.round(z.y + sa * 110) }); });
      else if (act === "throw" && at(B.spines.at * B.spines.len)) {   // a fan of crystals: they stick in the floor, then shatter
        const prey = bm.prey?.alive ? bm.prey : near(), a = prey ? Math.atan2(prey.y - z.y, prey.x - z.x) : z.aim, d0 = clamp(prey ? hyp(prey.x - z.x, prey.y - z.y) : 300, B.spines.min, B.spines.max), K = this.cordon, pts = [];
        for (let i = 0; i < B.spines.n; i++) { const ga = a + (i - (B.spines.n - 1) / 2) * B.spines.fan / (B.spines.n - 1), d = d0 + rand(-50, 50), x = clamp(z.x + Math.cos(ga) * d, K.x + 70, this.A.width - 60), y = clamp(z.y + Math.sin(ga) * d, K.y + 90, this.A.height - 50);
          pts.push([Math.round(x), Math.round(y)]); this.mine.haz.push({ x, y, r: B.spines.r, dmg: z.damage * B.spines.mult, at: now + (B.spines.fly + B.spines.fuse) * 1000 }); }
        this.broadcast("deep", { k: "spines", x: Math.round(z.x), y: Math.round(z.y), pts, fly: B.spines.fly, fuse: B.spines.fuse, r: B.spines.r });
      } else if (act === "roar" && at(B.cavein.at * B.cavein.len)) {   // the roof comes down: a rock on every survivor, more around them
        const K = this.cordon, pts = [], put = (x, y) => { x = clamp(x, K.x + 70, this.A.width - 60); y = clamp(y, K.y + 90, this.A.height - 50); pts.push([Math.round(x), Math.round(y)]); this.mine.haz.push({ x, y, r: B.cavein.r, dmg: z.damage * B.cavein.mult, at: now + B.cavein.delay * 1000 }); };
        for (const p of targets) { put(p.x, p.y); for (let i = 1; i < B.cavein.perPlayer; i++) { const a = Math.random() * 7, d = 150 + Math.random() * 170; put(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * .8); } }
        for (let i = 0; i < B.cavein.extra + (E ? E.extraRocks : 0); i++) { const a = Math.random() * 7, d = 200 + Math.random() * 380; put(z.x + Math.cos(a) * d, z.y + Math.sin(a) * d * .8); this.mine.haz[this.mine.haz.length - 1].boulder = true; }   // the stray rocks stay as boulders
        this.broadcast("deep", { k: "cavein", x: Math.round(z.x), y: Math.round(z.y), pts, delay: B.cavein.delay, r: B.cavein.r, dark: B.cavein.dark });
      } else if (act === "wind") {   // winding up the charge: enough damage now breaks it
        if (bm.windDmg >= z.maxHp * B.charge.breakPct) { this.startAct(z, "stagger", B.stagger); bm.next = now + (B.stagger + 1) * 1000; s.message = "CHARGE BROKEN: THE BEAST IS STAGGERED!"; this.broadcast("deep", { k: "broke" }); return; }
        if (z.slam > .45 && bm.prey?.alive) z.aim = Math.atan2(bm.prey.y - z.y, bm.prey.x - z.x);
        if (z.slam <= 0) { this.startAct(z, "charge", B.charge.len / B.charge.speed); bm.hit = new Set(); return; }
      } else if (act === "charge") {
        const want = B.charge.speed * (E ? E.speed : 1) * dt, moved = this.beastMove(z, ca * want, sa * want);
        const hitB = (m.boulders || []).find(b => hyp(b.x - (z.x + ca * 70), (b.y - (z.y + sa * 40)) / .8) < B.boulder.r + 60);
        if (hitB) { m.boulders = m.boulders.filter(b => b !== hitB); this.broadcast("deep", { k: "bsmash", id: hitB.id, x: hitB.x, y: hitB.y }); this.startAct(z, "stagger", B.boulder.stun); bm.next = now + (B.boulder.stun + 1) * 1000; s.message = "IT SMASHED INTO A BOULDER: THE BEAST IS STUNNED!"; return; }
        for (const p of s.players.values()) if (p.alive && !bm.hit.has(p.sessionId) && hyp(p.x - z.x, p.y - z.y) < B.charge.half + BODY_R) { bm.hit.add(p.sessionId); this.hiveHurt(p, z.damage * B.charge.mult); const side = (-(p.x - z.x) * sa + (p.y - z.y) * ca) >= 0 ? 1 : -1; if (p.alive) this.moveWithCollision(p, -sa * side * B.charge.push, ca * side * B.charge.push); }
        if (z.slam <= 0 || moved < want * .4) { this.startAct(z, "skid", B.charge.skid); return; }
      } else if (act === "dive") { if (z.slam <= 0) { this.startAct(z, "under", B.burrow.under); return; } }
      else if (act === "under") {   // tunnelling after its prey
        const p = bm.prey?.alive ? bm.prey : near(), d = p ? hyp(p.x - z.x, p.y - z.y) : 0; if (p && d > 1) { const st = Math.min(d, B.burrow.speed * (E ? E.speed : 1) * dt); this.beastMove(z, (p.x - z.x) / d * st, (p.y - z.y) / d * st); z.aim = Math.atan2(p.y - z.y, p.x - z.x); }
        if (z.slam <= 0 || (p && d < 46)) { this.startAct(z, "erupt", B.burrow.warn); this.broadcast("deep", { k: "erupt", x: Math.round(z.x), y: Math.round(z.y), r: B.burrow.r, warn: B.burrow.warn }); return; }
      } else if (act === "erupt") { if (z.slam <= 0) {
        for (const p of s.players.values()) if (p.alive && hyp(p.x - z.x, (p.y - z.y) / .75) < B.burrow.r + BODY_R) { this.hiveHurt(p, z.damage * B.burrow.mult); const a = Math.atan2(p.y - z.y, p.x - z.x); if (p.alive) this.moveWithCollision(p, Math.cos(a) * 120, Math.sin(a) * 120); }
        this.startAct(z, "emerge", B.burrow.emerge, Math.PI / 2); this.broadcast("deep", { k: "burst", x: Math.round(z.x), y: Math.round(z.y) }); return; } }
      if (z.slam <= 0 && z.act === act) {
        z.act = "";
        if (E && act === "skid") { bm.caveReady = now + (B.cavein.len + B.cavein.cd * cdk) * 1000; bm.next = now + (B.cavein.len + B.gap * .6) * 1000; this.startAct(z, "roar", B.cavein.len, Math.PI / 2); this.broadcast("deep", { k: "chain" }); }   // phase 2: the charge goes straight into a cave-in roar
        else if (E && act === "emerge") { const q = near(); if (q) { bm.prey = q; bm.spinesReady = now + (B.spines.len + B.spines.cd * cdk) * 1000; bm.next = now + (B.spines.len + B.gap * .6) * 1000; this.startAct(z, "throw", B.spines.len, Math.atan2(q.y - z.y, q.x - z.x)); this.broadcast("deep", { k: "chain" }); } }   // ...and bursting out of the floor goes into a crystal throw
      }
      return;
    }
    if (!z.enraged && z.hp <= z.maxHp * B.phase2.at) {   // PHASE 2: it roars, its crystals grow back blood red, and it gets faster and meaner
      z.enraged = true; z.speed = B.speed * B.phase2.speed; m.crystals = B.crystals.n; bm.crHp = z.maxHp * B.crystals.hpPct; this.mineSync();
      bm.caveReady = now + (B.cavein.len + B.cavein.cd * B.phase2.cd) * 1000; bm.next = now + (B.cavein.len + B.gap) * 1000; this.startAct(z, "roar", B.cavein.len, Math.PI / 2);
      s.message = "THE MINE BEAST IS ENRAGED! Its crystals grew back: shoot its BACK."; this.broadcast("deep", { k: "phase2", x: Math.round(z.x), y: Math.round(z.y) }); return;
    }
    if (!m.shield && (m.shieldsDone || 0) < B.shield.at.length && z.hp <= z.maxHp * B.shield.at[m.shieldsDone || 0]) { this.startShield(z, bm, now); return; }   // CRYSTAL SHIELD
    const prey = near(); if (!prey) return; const d = hyp(prey.x - z.x, prey.y - z.y), a = Math.atan2(prey.y - z.y, prey.x - z.x); z.aim = a; z.targetId = prey.sessionId;
    const pick = () => targets[Math.floor(Math.random() * targets.length)], skill = (key, act, len, cd, extra) => { bm[key] = now + (len + cd * cdk) * 1000; bm.next = now + (len + B.gap) * 1000; this.startAct(z, act, len); if (extra) extra(); };
    if (now >= bm.next) {
      if (now >= bm.chargeReady && d > 240) return skill("chargeReady", "wind", B.charge.wind, B.charge.cd, () => { bm.prey = prey; bm.windDmg = 0; this.broadcast("deep", { k: "wind", len: B.charge.wind, reach: B.charge.len, half: B.charge.half }); });
      if (now >= bm.burrowReady) return skill("burrowReady", "dive", B.burrow.dive, B.burrow.cd + B.burrow.under, () => { bm.prey = pick(); z.aim = Math.PI / 2; });
      if (now >= bm.caveReady) return skill("caveReady", "roar", B.cavein.len, B.cavein.cd, () => { z.aim = Math.PI / 2; });
      if (now >= bm.spinesReady && d > 190) return skill("spinesReady", "throw", B.spines.len, B.spines.cd, () => { bm.prey = prey; });
    }
    if (d < B.strike.range && now >= bm.strikeReady) { bm.strikeReady = now + (B.strike.len + B.strike.cd) * 1000; this.startAct(z, "strike", B.strike.len); return; }
    if (d > 120) this.beastMove(z, Math.cos(a) * z.speed * dt, Math.sin(a) * z.speed * dt);
  }
  mineHunter(prey) {   // one zombie out of the dark, 640-860px from someone on foot outside the dungeon
    const s = this.state; const before = this.zombieSequence; this.spawnZombie(); const z = this.zombieSequence !== before ? s.zombies.get(`z${this.zombieSequence}`) : null;
        if (z) { const p = prey[Math.floor(Math.random() * prey.length)]; z.role = "hunter"; let ok = false;
          for (let t = 0; t < 14 && !ok; t++) { const a = Math.random() * Math.PI * 2, d = 640 + Math.random() * 220, x = clamp(p.x + Math.cos(a) * d, 30, this.A.width - 30), y = clamp(p.y + Math.sin(a) * d, 30, this.A.height - 30); if (!this.blockedByMap(x, y, 24) && !this.inCordon({ x: x + 40, y: y + 40 })) { z.x = x; z.y = y; ok = true; } }
          if (!ok) s.zombies.delete(z.id); }
  }
  mineEscape() { const m = this.mine; if (m.step === "escaped") return; m.step = "escaped"; m.t = DEEP.flash; this.state.message = "THROUGH THE PORTAL!"; this.broadcast("deep", { k: "escaped" }); this.mineSync(); }
  mineTick(dt, now) {
    const m = this.mine, s = this.state, C = this.coaster; s.towerHp = Math.max(s.towerHp, m.towerHp);   // (the radio tower isn't a target on this mission)
    const humans = [...s.players.values()].filter(p => !p.isBot);
    if (!humans.length && s.elapsed > 3 && m.step !== "escaped") this.mineEscape();   // a team of bots can't ride: they're waved through (the sims)
    for (const r of m.runes) if (r.st === 1) {   // a carried rune goes with its carrier; if they go down or leave it lies where they were
      const c = s.players.get(r.by); if (c && c.alive) { r.x = c.x; r.y = c.y; continue; }
      r.st = 2; r.by = ""; if (this.inCordon(r) || this.blockedByMap(r.x, r.y, 10)) { const st = C.T.stations[0]; r.x = st.x; r.y = st.y + 60; }
      s.message = "The rune was dropped! Pick it up (F)."; this.broadcast("deep", { k: "drop" });
    }
    if (m.step === "runes") {
      m.shardClock -= dt; if (m.shardClock <= 0) { m.shardClock = DEEP.shardEvery; this.mineShard(); }
      m.zClock -= dt; const prey = [...s.players.values()].filter(p => p.alive && !(p.ride > 0) && !this.inCordon(p));
      if (m.zClock <= 0 && prey.length && s.zombies.size < DEEP.zCap[0] + DEEP.zCap[1] * s.players.size) {   // the horde comes out of the dark around whoever is on foot
        m.zClock = DEEP.zEvery / this.spawnScale(); this.mineHunter(prey);
      } else if (m.zClock <= 0) m.zClock = .5;
    } else if (m.step === "fight" && m.shield) {   // the shield run: the dark comes for the rider out in the mine
      m.zClock = (m.zClock || 0) - dt; const prey = [...s.players.values()].filter(p => p.alive && !(p.ride > 0) && !this.inCordon(p)), out = [...s.zombies.values()].filter(z => z.kind !== "minebeast").length;
      if (m.zClock <= 0 && prey.length && out < BEAST.shield.zCap) { m.zClock = BEAST.shield.zEvery / this.spawnScale(); this.mineHunter(prey); } else if (m.zClock <= 0) m.zClock = .5;
    } else if (m.step === "awake") { m.t -= dt; if (m.t <= 0) this.mineFight(); }
    else if (m.step === "flee") { m.t -= dt; const alive = [...s.players.values()].filter(p => p.alive); if (m.t <= 0 || (alive.length && alive.every(p => p.ride > 0))) this.mineChase(); }
    else if (m.step === "chase") {
      const z = s.zombies.get(m.beast); if (!z) { this.mineEscape(); return; }
      const dmg = z.maxHp - z.hp; z.hp = z.maxHp; m.t += dt;
      m.acc = (m.acc || 0) + dmg; m.need ||= m.hpRef * 4 * Math.max(1, C.riders.size) ** .8;   // enough damage staggers it back; each stagger takes 25% more than the last (a strong team isn't safe, a weak one still gets its staggers)
      while (m.acc >= m.need) { m.acc -= m.need; m.need *= 1.25; m.gap = Math.min(DEEP.gapMax, m.gap + DEEP.stagger); this.broadcast("deep", { k: "stagger" }); }
      if (C.wait <= 0) m.gap -= DEEP.gain * dt;
      if (m.gap <= DEEP.catchGap) { m.cartHp--; m.gap = DEEP.bounce; this.broadcast("deep", { k: "smash", hp: m.cartHp }); s.message = m.cartHp > 0 ? `THE BEAST HIT THE CARTS! ${m.cartHp} hit${m.cartHp === 1 ? "" : "s"} left.` : "THE MINE BEAST SMASHED THE CARTS: TEAM DEFEATED.";
        if (m.cartHp <= 0) { s.phase = "defeat"; this.mineSync(); return; } }
      const q = coasterAt(C.T, C.s - 170 - m.gap); z.x = q.x; z.y = q.y; z.aim = q.a;
    } else if (m.step === "escaped") { m.t -= dt; if (m.t <= 0) { this.endMine(true); s.phase = "cleared"; this.beginBreak(); s.message = `Wave ${s.stage} survived: you escaped the Deep Mine! Host can launch the next wave.`; return; } }
    this.mineSync();
  }
  cordonCheck() {   // The Deep Mine: anyone in the boss dungeon who didn't come by cart (a dash through the wall, a knockback, a boss's leap) is put back outside
    const K = this.cordon, inside = e => this.inCordon(e), held = this.coaster?.held;
    const out = e => { const toN = e.y - (K.y - 40), toW = e.x - (K.x - 25); if (toN < toW) e.y = K.y - 40 - 34; else e.x = K.x - 25 - 34; };
    if (!(this.mine && this.mine.step !== "runes")) for (const p of this.state.players.values()) if (!(p.ride > 0) && !held?.has(p.sessionId) && !this.state.vehicles.has(p.sessionId) && inside(p)) { out(p); this.shadowDash?.delete(p.sessionId); this.solveCollisions(p); }
    for (const z of this.state.zombies.values()) if (z.kind !== "minebeast" && inside(z)) { out(z); this.solveZombie(z); }
  }
  inCordon(e) { const K = this.cordon; return !!K && e.x > K.x + 25 && e.y > K.y + 10; }   // inside the mine's boss dungeon: nothing outside can reach you (and you can't be chased in)
  untouchable(p) { const v = this.state.vehicles.get(p.sessionId); return (this.inCordon(p) && !(this.mine && (this.mine.step === "fight" || this.mine.step === "flee"))) || (v?.kind === "heli" && v.phase === "ride" && !this.bossUp) || (p.ride > 0 && (!this.bossUp || this.mine?.shield)) || this.sheltered(p) || (this.dodgeUntil.get(p.sessionId) || 0) > Date.now() || this.away.has(p.sessionId); }   // up in the helicopter / inside a safehouse / mid-dash / reconnecting
  boxRayDist(x, y, a, range, boxes) {   // distance along the ray to the first box, or range
    const dx = Math.cos(a), dy = Math.sin(a); let best = range;
    for (const b of boxes || []) {
      if (Math.abs(x - b.x) <= b.hw && Math.abs(y - b.y) <= b.hh) continue;   // starting inside: ignore
      let t0 = 0, t1 = best;
      for (const [o, d, lo, hi] of [[x, dx, b.x - b.hw, b.x + b.hw], [y, dy, b.y - b.hh, b.y + b.hh]]) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { t0 = Infinity; break; } continue; }
        let ta = (lo - o) / d, tb = (hi - o) / d; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) break;
      }
      if (t0 <= t1 && t0 < best) best = t0;
    }
    return best;
  }
  // Did survivor p swing the fire axe toward the hook (from Butcher z) in the last `win` seconds?
  canDeflect(p, z, now, win) {
    const sw = this.axeSwing.get(p.sessionId); if (!sw || now - sw.t > win * 1000) return false;
    let diff = Math.atan2(z.y - p.y, z.x - p.x) - sw.aim; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    return Math.abs(diff) <= DEFLECT.arc;
  }
  deflectHook(z, p, now) {
    const sw = this.axeSwing.get(p.sessionId), heavy = !!sw?.heavy; this.axeSwing.delete(p.sessionId);
    const ang = Math.atan2(z.y - p.y, z.x - p.x), cx = p.x + Math.cos(ang) * 30, cy = p.y - 22 + Math.sin(ang) * 18;
    const m = this.bmem(z, now), cd = z.enraged ? BUTCHER.hook.enragedCd : BUTCHER.hook.cd;
    m.hookReady = now + rand(cd[0], cd[1]) * 1000; m.chopReady = Math.max(m.chopReady || 0, now + 600);
    z.hookId = ""; z.hookD = 0;
    this.startAct(z, "stagger", heavy ? DEFLECT.heavyStagger : DEFLECT.stagger, z.aim);
    this.broadcast("deflect", { id: p.sessionId, x: Math.round(cx), y: Math.round(cy), a: Math.round(z.aim * 100) / 100, heavy });
    this.state.message = `${p.name} DEFLECTED the hook!`;
  }
  butcher_pull(z, t0, t1, dt, m) {
    const H = BUTCHER.hook, p = this.state.players.get(z.hookId);
    if (!p || !p.alive) { z.act = ""; z.hookId = ""; return; }
    if (this.untouchable(p) || !this.lineClear(z, p)) { z.hookId = ""; this.startAct(z, "hookback", .3); return; }   // chain blocked by a wall / they reached a safehouse: it lets go
    const ang = Math.atan2(p.y - z.y, p.x - z.x), d = distance(z, p); z.aim = ang;
    p.stunned = Math.max(p.stunned || 0, .25);
    const stop = z.radius + BODY_R + 14;
    if (d > stop) {
      const step = Math.min(d - stop, H.pullSpeed * dt), bx = p.x, by = p.y;
      this.moveWithCollision(p, -Math.cos(ang) * step, -Math.sin(ang) * step);
      m.stuck = hyp(p.x - bx, p.y - by) < step * .3 ? m.stuck + dt : 0;
    }
    z.hookD = distance(z, p);
    if (distance(z, p) <= stop + 2 || m.stuck > .3) {   // arrived (or snagged on something): hold them and CHOP
      p.stunned = Math.max(p.stunned || 0, H.hold); z.hookId = "";
      m.combo = true; m.chopW = BUTCHER.chop.comboWindup;
      this.startAct(z, "chop", BUTCHER.chop.comboWindup + BUTCHER.chop.after, ang);
    }
  }
  butcher_spin(z, t0, t1, dt, m, now, players) {
    const S = BUTCHER.spin;
    if (players.length) {
      const near = players.reduce((a, b) => distance(z, a) < distance(z, b) ? a : b), a = Math.atan2(near.y - z.y, near.x - z.x);
      z.aim = a; if (distance(z, near) > 20) this.bossMove(z, near, z.speed * S.speedMult * dt);
    }
    m.spinTick -= dt;
    if (m.spinTick <= 0 && t1 > .3) {
      m.spinTick = S.tick;
      for (const p of this.state.players.values()) {
        if (!p.alive || this.untouchable(p) || distance(z, p) > S.radius + BODY_R) continue;
        const dealt = this.armorHit(p, z.damage * S.dmgMult); p.hp -= dealt; p.damageTaken += dealt; if (p.hp <= 0) this.downPlayer(p);
      }
    }
    if (z.slam <= 0) m.spinReady = now + S.every * 1000;
  }
  // Mutant whip lands: hits every survivor in a wide arc in front of it.
  mutantWhip(z, ang) {
    const reach = z.radius + ATTACK_REACH.mutant + BODY_R;
    for (const p of this.state.players.values()) {
      if (!p.alive || this.untouchable(p)) continue; const pd = distance(z, p); if (pd > reach) continue;
      let diff = Math.atan2(p.y - z.y, p.x - z.x) - ang; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > MUTANT.arc && pd > z.radius + BODY_R + 4) continue;
      const dealt = this.armorHit(p, z.damage * MUTANT.dmgMult, z); p.hp -= dealt; p.damageTaken += dealt; if (p.hp <= 0) this.downPlayer(p);
    }
    this.broadcast("whip", { x: Math.round(z.x), y: Math.round(z.y), a: Math.round(ang * 100) / 100 });
  }
  // Brute ground slam lands: damage + stun everyone in the radius.
  bruteSlam(z) {
    for (const p of this.state.players.values()) {
      if (!p.alive || this.untouchable(p) || distance(p, z) > SLAM.radius + BODY_R) continue;
      const dealt = this.armorHit(p, z.damage * SLAM.dmgMult, z); p.hp -= dealt; p.damageTaken += dealt;
      p.stunned = Math.max(p.stunned || 0, SLAM.stun); p.charging = false;
      if (p.hp <= 0) this.downPlayer(p);
    }
    this.broadcast("slam", { x: Math.round(z.x), y: Math.round(z.y), r: SLAM.radius });
  }
  solveZombie(z) { const b = this.mapBoxesNear(z.x, z.y); this.pushOut(z, this.safeBoxes.length ? [...b, ...this.safeBoxes] : b, Math.min(z.radius, 34) * 0.8); }   // + Astra's safehouse walls
  // ---------- boss path-finding: a 40px grid over the map, flow field toward the target (walks AROUND buildings) ----------
  wideClear(a, b, r) {   // can a body of radius r walk straight from a to b?
    const d = distance(a, b); if (d < 1) return true; const nx = -(b.y - a.y) / d * r, ny = (b.x - a.x) / d * r;
    return [[0, 0], [nx, ny], [-nx, -ny]].every(([ox, oy]) => this.lineClear({ x: a.x + ox, y: a.y + oy }, { x: b.x + ox, y: b.y + oy }, true))
      && !this.safeBoxes.some(bx => this.boxRayDist(a.x, a.y, Math.atan2(b.y - a.y, b.x - a.x), d, [{ ...bx, hw: bx.hw + r, hh: bx.hh + r }]) < d);
  }
  pathGrid(r) {   // which 40px cells a body of radius r can't stand in (map pieces, tower, generator); cached per map
    const k = Math.round(r); let g = this.pathGrids?.get(k); if (g) return g;
    const C = PATH_CELL, GW = Math.ceil(this.A.width / C), GH = Math.ceil(this.A.height / C), blocked = new Uint8Array(GW * GH), X = this.A.cx, Y = this.A.cy;
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      const x = (gx + .5) * C, y = (gy + .5) * C;
      blocked[gy * GW + gx] = this.blockedByMap(x, y, r * .85) || (Math.abs(x - X) < TOWER_HALF + r && Math.abs(y - Y) < TOWER_HALF + r) || (Math.abs(x - X - GEN_OFF.x) < GEN_OFF.h + r && Math.abs(y - Y - GEN_OFF.y) < GEN_OFF.h + r) ? 1 : 0;
    }
    g = { GW, GH, blocked }; (this.pathGrids || (this.pathGrids = new Map())).set(k, g); return g;
  }
  flowField(t, r) {   // steps-to-target for every cell (BFS from the target's cell), rebuilt at most every 0.4s per target cell
    const C = PATH_CELL, g = this.pathGrid(r), { GW, GH } = g, tx = clamp(Math.floor(t.x / C), 0, GW - 1), ty = clamp(Math.floor(t.y / C), 0, GH - 1);
    const key = (ty * GW + tx) * 64 + Math.round(r), now = Date.now(), cache = this.flowCache || (this.flowCache = new Map()), hit = cache.get(key);
    if (hit && now - hit.at < 400) return hit;
    // one blocked map for this field: the map pieces + Astra's safehouse walls (no per-cell closure in the hot loop)
    let bad = g.blocked;
    if (this.safeBoxes.length) {
      bad = new Uint8Array(g.blocked);
      for (const b of this.safeBoxes) { const hw = b.hw + r, hh = b.hh + r, x0 = clamp(Math.floor((b.x - hw) / C), 0, GW - 1), x1 = clamp(Math.floor((b.x + hw) / C), 0, GW - 1), y0 = clamp(Math.floor((b.y - hh) / C), 0, GH - 1), y1 = clamp(Math.floor((b.y + hh) / C), 0, GH - 1);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) bad[y * GW + x] = 1; }
    }
    const dist = hit?.dist || new Float32Array(GW * GH); dist.fill(Infinity); const q = this.flowQ && this.flowQ.length >= GW * GH ? this.flowQ : (this.flowQ = new Int32Array(GW * GH)); let qh = 0, qt = 0;
    const start = ty * GW + tx; dist[start] = 0; q[qt++] = start;
    while (qh < qt) {
      const k = q[qh++], x = k % GW, y = (k - x) / GW, d0 = dist[k];
      const up = y > 0, dn = y < GH - 1, lf = x > 0, rt = x < GW - 1;
      const bU = up ? bad[k - GW] : 1, bD = dn ? bad[k + GW] : 1, bL = lf ? bad[k - 1] : 1, bR = rt ? bad[k + 1] : 1;
      if (up && !bU && d0 + 1 < dist[k - GW]) { dist[k - GW] = d0 + 1; q[qt++] = k - GW; }
      if (dn && !bD && d0 + 1 < dist[k + GW]) { dist[k + GW] = d0 + 1; q[qt++] = k + GW; }
      if (lf && !bL && d0 + 1 < dist[k - 1]) { dist[k - 1] = d0 + 1; q[qt++] = k - 1; }
      if (rt && !bR && d0 + 1 < dist[k + 1]) { dist[k + 1] = d0 + 1; q[qt++] = k + 1; }
      // diagonals: never cut a corner (it would walk into it)
      if (up && lf && !bU && !bL && !bad[k - GW - 1] && d0 + 1.414 < dist[k - GW - 1]) { dist[k - GW - 1] = d0 + 1.414; q[qt++] = k - GW - 1; }
      if (up && rt && !bU && !bR && !bad[k - GW + 1] && d0 + 1.414 < dist[k - GW + 1]) { dist[k - GW + 1] = d0 + 1.414; q[qt++] = k - GW + 1; }
      if (dn && lf && !bD && !bL && !bad[k + GW - 1] && d0 + 1.414 < dist[k + GW - 1]) { dist[k + GW - 1] = d0 + 1.414; q[qt++] = k + GW - 1; }
      if (dn && rt && !bD && !bR && !bad[k + GW + 1] && d0 + 1.414 < dist[k + GW + 1]) { dist[k + GW + 1] = d0 + 1.414; q[qt++] = k + GW + 1; }
    }
    const f = hit || { at: now, dist, GW, GH }; f.at = now; cache.set(key, f);
    if (cache.size > 160) for (const [k, v] of cache) { if (now - v.at > 2000) cache.delete(k); if (cache.size <= 120) break; }   // drop fields nobody asked for lately
    return f;
  }
  nextWaypoint(z, t, r) {   // down the flow field from z: the furthest of the next 8 steps that z can walk to in a straight line
    const C = PATH_CELL, f = this.flowField(t, r), { GW, GH, dist } = f;
    let x = clamp(Math.floor(z.x / C), 0, GW - 1), y = clamp(Math.floor(z.y / C), 0, GH - 1), pick = null;
    for (let step = 0; step < 8; step++) {
      let best = null, bd = dist[y * GW + x];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        if (dx && dy && (dist[y * GW + nx] === Infinity || dist[ny * GW + x] === Infinity)) continue;   // no cutting round a corner (it would walk into it)
        const d = dist[ny * GW + nx]; if (d < bd) { bd = d; best = [nx, ny]; }
      }
      if (!best) break; [x, y] = best; const wp = { x: (x + .5) * C, y: (y + .5) * C };
      if (!pick || this.wideClear(z, wp, r)) pick = wp; else break;
    }
    return pick;
  }
  // Boss walking: straight at the target when the way is clear; otherwise toward a waypoint on the flow field, kept until reached
  // (so he commits to one way round a building instead of flip-flopping), sliding along walls.
  bossMove(z, t, dist) {
    const r = Math.round(Math.min(z.radius || 14, 34) * .8 / 4) * 4, now = Date.now(); let m = this.bossPath?.get(z.id);
    if (!m) { m = { wp: null, until: 0, clear: false, checkAt: 0 }; (this.bossPath || (this.bossPath = new Map())).set(z.id, m); }
    if (now >= m.checkAt) { m.clear = this.wideClear(z, t, r); m.checkAt = now + (m.clear ? 150 : 250); }   // the straight-line test is the dear part: not every tick for every zombie
    if (m.clear) { m.wp = null; this.steerMove(z, z.id, Math.atan2(t.y - z.y, t.x - z.x), dist, e => this.solveZombie(e)); return; }
    if (!m.wp || distance(z, m.wp) < 14 || now > m.until) { m.wp = this.nextWaypoint(z, t, r); m.until = now + 1500; }
    if (!m.wp) { this.steerMove(z, z.id, Math.atan2(t.y - z.y, t.x - z.x), dist, e => this.solveZombie(e)); return; }
    const a = Math.atan2(m.wp.y - z.y, m.wp.x - z.x), x0 = z.x, y0 = z.y, step = Math.min(dist, distance(z, m.wp));
    z.x = clamp(z.x + Math.cos(a) * step, 5, this.A.width - 5); z.y = clamp(z.y + Math.sin(a) * step, 5, this.A.height - 5); this.solveZombie(z);
    if (hyp(z.x - x0, z.y - y0) < step * .3) m.wp = null;   // blocked (another zombie, a new structure): plan again next tick
  }
  // Walk toward angle `ang`; if something solid is in the way, slide around it (keeps going round the same side for a while).
  steerMove(e, key, ang, dist, solve) {
    const st = this.steer.get(key) || { side: Math.random() < .5 ? 1 : -1, until: 0, off: 0 }; this.steer.set(key, st);
    const now = Date.now(), x0 = e.x, y0 = e.y;
    const tryDir = (a) => {
      e.x = clamp(x0 + Math.cos(a) * dist, 5, this.A.width - 5); e.y = clamp(y0 + Math.sin(a) * dist, 5, this.A.height - 5); solve(e);
      return hyp(e.x - x0, e.y - y0);
    };
    const offs = now < st.until ? [0, st.off] : [0];   // straight first: a remembered sidestep must not keep a zombie circling once the way is clear
    for (const o of [...offs, .6 * st.side, 1.1 * st.side, 1.6 * st.side, -.6 * st.side, -1.1 * st.side]) {
      const moved = tryDir(ang + o);
      const forward = (e.x - x0) * Math.cos(ang) + (e.y - y0) * Math.sin(ang);
      if (moved > dist * .55 && (o === 0 ? forward > dist * .5 : true)) {
        if (o !== 0 && o !== st.off) { st.off = o; st.side = Math.sign(o); }
        if (o !== 0) st.until = now + 700;
        return;
      }
    }
    st.side = -st.side; st.until = 0;    // boxed in: try the other side next time
  }
  // Move in small steps so fast moves (dash) can't skip through a wall.
  moveWithCollision(p, dx, dy) {
    const steps = Math.max(1, Math.ceil(hyp(dx, dy) / 8));
    for (let i = 0; i < steps; i++) {
      p.x = clamp(p.x + dx / steps, 18, this.A.width - 18); p.y = clamp(p.y + dy / steps, 18, this.A.height - 18);
      this.solveCollisions(p);
    }
  }

  unlockWeapon(p, id) {
    const owned = new Set(p.owned.split(",").filter(Boolean));
    owned.add(id); p.owned = [...owned].join(",");
  }

  // ---------- AI teammate brain (runs every server tick for each bot) ----------
  botThink(b, dt, now) {
    if (b.stunned > 0) return;
    const brain = this.botBrain.get(b.sessionId) || { strafe: 1 };
    const s = this.state, center = { x: this.A.cx, y: this.A.cy };
    // Level-ups: bots pick a random upgrade.
    while ((b.level || 1) < MAX_LEVEL && b.xp >= b.xpNext) this.applyUpgrade(b, Object.keys(UPGRADES)[Math.floor(Math.random() * Object.keys(UPGRADES).length)]);
    const zs = [...s.zombies.values()];
    const seen = zs.filter(z => distance(b, z) < 700 && this.lineClear(b, z));
    const pool = seen.length ? seen : zs;
    const near = pool.length ? pool.reduce((a, z) => distance(b, z) < distance(b, a) ? z : a) : null;
    const nearD = near ? distance(b, near) : Infinity;
    if (this.hooks.has(b.sessionId)) { this.botBrain.set(b.sessionId, brain); return; }   // Arshan bot mid-hook: the chain is pulling him
    const ride = s.vehicles.get(b.sessionId);
    if (ride) { if (ride.phase === "ride") this.botVehicle(b, ride, near, nearD, brain, dt); this.botBrain.set(b.sessionId, brain); return; }
    // Rescue: go to the nearest downed teammate unless a zombie is right on top of us.
    const downed = [...s.players.values()].filter(p => !p.alive && !p.bledOut && p !== b)
      .sort((m, n) => distance(b, m) - distance(b, n))[0];
    let mx = 0, my = 0;
    if (b.reviveTargetId) { /* hold still while reviving */ }
    else if (downed && nearD > 90) {
      if (distance(b, downed) > 55) { mx = downed.x - b.x; my = downed.y - b.y; }
      else { b.reviveTargetId = downed.sessionId; b.reviveProgress = 0; s.message = `${b.name} is reviving ${downed.name}...`; }
    } else if (near) {
      const ax = (b.x - near.x) / nearD, ay = (b.y - near.y) / nearD;
      const melee = b.activeSlot === 1, close = melee ? 55 : 150, far = melee ? 85 : 330;   // Raven (katana only) fights up close
      if (nearD < close) { mx = ax; my = ay; }                     // too close: back off
      else if (nearD > far) { mx = -ax; my = -ay; }                // too far: move in
      else { mx = -ay * brain.strafe * 0.7; my = ax * brain.strafe * 0.7; } // in range: circle-strafe
      const fromTower = distance(b, center);
      if (fromTower > 280) { mx += (center.x - b.x) / fromTower; my += (center.y - b.y) / fromTower; }
    } else if (distance(b, center) > 140) { mx = center.x - b.x; my = center.y - b.y; }
    // Boss: keep ~260px away, and get out of a cleaver chop's shockwave before it lands.
    const boss = zs.find(z => z.boss);
    if (boss && !b.reviveTargetId) {
      const bd = distance(b, boss);
      if (bd < 240) { mx += (b.x - boss.x) / bd * 1.6; my += (b.y - boss.y) / bd * 1.6; }
      if (boss.act === "chop") {
        const cx = boss.x + Math.cos(boss.aim) * BUTCHER.chop.offset, cy = boss.y + Math.sin(boss.aim) * BUTCHER.chop.offset, zd = ringZone(b.x - cx, b.y - cy);
        if (zd < BUTCHER.chop.rings[2] + 20) { const dd = hyp(b.x - cx, b.y - cy) || 1; mx = (b.x - cx) / dd * 3; my = (b.y - cy) / dd * 3; }
      }
      if (boss.kind === "screamer" && boss.act === "wail" && !this.wailCover(boss, b)) {   // the wail is coming: hide behind the tower (the far side from him)
        const cov = this.botCover(b, boss); if (cov) { const dd = hyp(cov.x - b.x, cov.y - b.y) || 1; mx = (cov.x - b.x) / dd * 3; my = (cov.y - b.y) / dd * 3; }
      }
      if (boss.kind === "screamer") {   // a resonance mark on me: walk away from my teammates
        if (this.scrFx.marks.some(mk => mk.id === b.sessionId)) for (const o of s.players.values()) { if (o === b || !o.alive) continue; const od = distance(b, o); if (od < 260) { mx += (b.x - o.x) / (od || 1) * 2; my += (b.y - o.y) / (od || 1) * 2; } }
      }
    }
    // Keep a little personal space from other survivors so bots don't stack on top of each other.
    for (const o of s.players.values()) {
      if (o === b || !o.alive) continue;
      const d = distance(b, o);
      if (d < 46 && d > 0.01) { mx += (b.x - o.x) / d * 1.4; my += (b.y - o.y) / d * 1.4; }
      else if (d <= 0.01) { mx += rand(-1, 1); my += rand(-1, 1); }
    }
    // Swap strafe direction when hugging a wall.
    if (b.x < 40 || b.x > this.A.width - 40 || b.y < 40 || b.y > this.A.height - 40) brain.strafe *= -1;
    const mag = hyp(mx, my);
    if (mag > 0.01) {
      this.steerMove(b, b.sessionId, Math.atan2(my, mx), b.speed * 0.9 * (b.slowed > 0 ? 0.5 : 1) * dt, e => this.solveCollisions(e));
      if (Math.abs(mx) > 0.05) { b.facing = mx > 0 ? 1 : -1; this.lastMoveAt.set(b.sessionId, now); }
    }
    // Aim like a person: react after a short delay, swing the aim over (no snapping),
    // wobble a little, and don't fire every possible moment.
    const w = WEAPONS[b.weapon] || WEAPONS.rifle;
    if (near && near.id !== brain.target) { brain.target = near.id; brain.reactAt = now + rand(280, 650); }
    if (near) {
      const want = Math.atan2(near.y - b.y, near.x - b.x);
      if (brain.aim === undefined) brain.aim = want;
      let diff = Math.atan2(Math.sin(want - brain.aim), Math.cos(want - brain.aim));
      const turn = 4.5 * dt; brain.aim += Math.max(-turn, Math.min(turn, diff));
      brain.wobble = (brain.wobble || 0) * 0.88 + rand(-0.09, 0.09);
      diff = Math.atan2(Math.sin(want - brain.aim), Math.cos(want - brain.aim));
      const ready = now >= (brain.reactAt || 0) && Math.abs(diff) < 0.25;
      if (ready && nearD < w.range && seen.includes(near) && !b.reviveTargetId && now - b.lastShot >= 1000 / b.fireRate && Math.random() < 0.6) {
        this.fireWeapon(b, brain.aim + brain.wobble + rand(-0.2, 0.2), nearD);
      }
    }
    if (b.hp < b.maxHp * 0.4 && b.medkits > 0) this.useQuickItem(b);
    // Class ability when zombies are close.
    if (b.characterClass === "slasher") {   // Arshan bot: chain-axe up close, hook to far zombies, cyclone in a crowd
      if (near && nearD < 170 && b.activeSlot === 1 && !this.arshanBusy(b)) this.meleeAttack(b, Math.atan2(near.y - b.y, near.x - b.x));
      const crowd = zs.filter(z => distance(b, z) < 260).length;
      if (b.ultReady && crowd >= 5) this.useUlt(b);
      else if (near && b.abilityCooldown <= 0 && nearD > 320 && nearD < 1000 && seen.includes(near) && !this.arshanBusy(b)) { b.aim = Math.atan2(near.y - b.y, near.x - b.x); this.useAbility(b); }
    }
    if (b.characterClass === "assault" && b.ultReady && near && nearD < 200 && zs.filter(z => distance(b, z) < 220).length >= 4) { b.aim = Math.atan2(near.y - b.y, near.x - b.x); this.useUlt(b, { d: Math.max(160, nearD + 60) }); }   // Marcus bot: frag the crowd and hop out
    if (b.characterClass === "juggernaut") {   // Briggs bot: dome when it gets hairy, War Cry into a crowd
      const crowd = zs.filter(z => distance(b, z) < 350).length;
      if (b.ultReady && crowd >= 4) this.useUlt(b);
      else if (b.abilityCooldown <= 0 && !(b.skillT > 0) && nearD < 170 && (b.hp < b.maxHp * 0.75 || crowd >= 3)) this.useAbility(b);
    }
    if (b.characterClass === "dispatcher") {   // Astra bot: medics when someone's hurt, police in a crowd, safehouse when it gets bad
      const crowd = zs.filter(z => distance(b, z) < 450).length, m = this.amemOf(b);
      if (b.ultReady && crowd >= 5) this.useUlt(b);
      else if (b.abilityCooldown <= 0 && [...this.state.players.values()].some(q => q.alive && q.hp < q.maxHp * .7)) this.useAbility(b);
      else if (!this.safeOf(b) && (Date.now() >= m.safeReady) && b.hp < b.maxHp * .5 && zs.filter(z => distance(b, z) < 250).length >= 4) this.astraCast(b, "R");
    }
    if (b.characterClass === "operator") {   // Sofea bot: tank when they get close, helicopter when there's a crowd
      if (b.ultReady && nearD < 400 && zs.filter(z => distance(b, z) < 450).length >= 6) this.useUlt(b);
      else if (b.abilityCooldown <= 0 && nearD < 260) this.useAbility(b);
      else if (!this.state.vehicles.has(b.sessionId) && this.mechaReadyIn(b) <= 0 && nearD < 220 && zs.filter(z => distance(b, z) < 300).length >= 4) this.mechaKey(b);
    }
    if (b.abilityCooldown <= 0 && nearD < 200 && b.characterClass !== "demolitionist" && b.characterClass !== "operator" && b.characterClass !== "juggernaut" && b.characterClass !== "slasher" && b.characterClass !== "dispatcher" && (b.characterClass !== "engineer" || (b.robotCharges ?? 3) >= 1)) this.useAbility(b);
    if (b.characterClass === "engineer" && b.ultReady && nearD < 400) this.useUlt(b);
    if (b.characterClass === "demolitionist") {   // Dante bot: blast when they get close; plant the charge in a crowd and blow it when they swarm it
      if (near && nearD < 450 && nearD > 90 && b.abilityCooldown <= 0) { b.aim = Math.atan2(near.y - b.y, near.x - b.x); this.useAbility(b, { d: nearD }); }
      const c = this.demoOf(b);
      if (!c && b.ultReady && nearD < 260) this.useUlt(b);
      else if (c && c.deploy <= 0 && [...this.state.zombies.values()].filter(z => hyp(z.x - c.x, z.y - c.y) < 200).length >= 4) this.useUlt(b);
    }
    if (b.characterClass === "scout") {   // Raven bot: katana when close, storm when crowded
      if (near && nearD < 105 && b.activeSlot === 1) this.meleeAttack(b, Math.atan2(near.y - b.y, near.x - b.x));
      if (b.ultReady && nearD < 130) this.useUlt(b);
    }
    this.botBrain.set(b.sessionId, brain);
  }

  // Bot driving Sofea's vehicle: the tank rolls into the nearest zombies, the helicopter keeps its distance and circles; both fire at the nearest.
  botVehicle(b, v, near, nearD, brain, dt) {
    const center = { x: this.A.cx, y: this.A.cy }; let mx = 0, my = 0;
    if (near) {
      const ax = (near.x - b.x) / nearD, ay = (near.y - b.y) / nearD;
      if (v.kind === "tank") { mx = ax; my = ay; }
      else if (v.kind === "mecha") {   // walks into flame range, slashes when they're close
        if (nearD > 150) { mx = ax; my = ay; } else if (nearD < 70) { mx = -ax; my = -ay; }
        if (nearD < SOFEA.mecha.saber.range - 20 && Math.random() < dt * 1.5) this.mechaSlash(b, Math.atan2(near.y - b.y, near.x - b.x));
      }
      else if (nearD < 220) { mx = -ax; my = -ay; } else if (nearD > 420) { mx = ax; my = ay; } else { mx = -ay * brain.strafe; my = ax * brain.strafe; }
      const ft = distance(b, center); if (ft > 520) { mx += (center.x - b.x) / ft; my += (center.y - b.y) / ft; }
      if (nearD < (v.kind === "heli" ? SOFEA.heli.gun.range + 150 : v.kind === "mecha" ? SOFEA.mecha.flame.range + 10 : SOFEA.tank.shot.range)) this.vehicleFire(b, Math.atan2(near.y - b.y, near.x - b.x) + rand(-.08, .08), nearD);
    } else if (distance(b, center) > 200) { mx = center.x - b.x; my = center.y - b.y; }
    const ox = b.x, oy = b.y; this.moveVehicle(b, v, mx, my, dt);
    if (hyp(b.x - ox, b.y - oy) < 0.5 && (mx || my)) brain.strafe = -(brain.strafe || 1);
  }

  // Zombies along a straight line from the player, nearest first.
  // How far a straight line from (x, y) at angle a goes before hitting a solid map piece (or `range` if nothing).
  wallDist(x, y, a, range, move = false) {   // distance along the ray to the first solid map piece, or range (hot path: bullets, bot sight, path-finding). move: count lava too (shots and sight fly over it)
    const dx = Math.cos(a), dy = Math.sin(a), st = this.rayStamp = (this.rayStamp || 0) + 1, grid = this.mapGrid; let best = range;
    if (!grid) return best;
    for (let t = 0; t <= range + 160; t += 120) {
      const px = x + dx * t, py = y + dy * t, gx = Math.floor(px / 160), gy = Math.floor(py / 160);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const cell = grid.get((gx + i + 8) * 4096 + (gy + j + 8)); if (!cell) continue;
        for (const b of cell) {
          if (b._r === st) continue; b._r = st; if (b.low && !move) continue;
          // ray vs box (slab test)
          let t0 = 0, t1 = best;
          if (Math.abs(dx) < 1e-9) { if (x < b.x - b.hw || x > b.x + b.hw) continue; }
          else { let ta = (b.x - b.hw - x) / dx, tb = (b.x + b.hw - x) / dx; if (ta > tb) { const q = ta; ta = tb; tb = q; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
          if (Math.abs(dy) < 1e-9) { if (y < b.y - b.hh || y > b.y + b.hh) continue; }
          else { let ta = (b.y - b.hh - y) / dy, tb = (b.y + b.hh - y) / dy; if (ta > tb) { const q = ta; ta = tb; tb = q; } if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) continue; }
          if (t0 < best) best = t0;
        }
      }
      if (t > best) break;
    }
    return best;
  }
  // Nothing solid between a and b?
  lineClear(a, b, move = false) { const d = distance(a, b); return this.wallDist(a.x, a.y, Math.atan2(b.y - a.y, b.x - a.x), d, move) >= d - 1; }
  rayHits(p, a, range) {
    const dx = Math.cos(a), dy = Math.sin(a), out = [];
    for (const z of this.state.zombies.values()) {
      const vx = z.x - p.x, vy = z.y - p.y;
      const t = vx * dx + vy * dy;
      if (t < 0 || t > range) continue;
      if (Math.abs(vx * dy - vy * dx) <= z.radius + 6) out.push({ z, t });
    }
    return out.sort((m, n) => m.t - n.t);
  }

  recentlyMoved(id) { return Date.now() - (this.lastMoveAt.get(id) || 0) < 250; }

  // A player drops: shorter bleed-out each time they go down in the same wave (30s, 25s ... min 10s).
  downPlayer(target) {
    if (!target.alive) { target.hp = 0; return; }
    if (target.ride > 0) this.coasterOff(target.sessionId);   // knocked off the coaster   // already down (several zombies bit them in the same tick): one down, not five shorter bleed-outs
    this.log("info", "player", `${target.name} went down (wave ${this.state.stage})`, target.sessionId);
    this.downHp.set(target.sessionId, target.hp); target.hp = 0; target.alive = false;
    const downs = (this.downs.get(target.sessionId) || 0) + 1;
    this.downs.set(target.sessionId, downs);
    target.bleedout = Math.max(10, 35 - downs * 5);
    this.state.message = `${target.name} is down! Revive within ${target.bleedout}s.`;
  }

  hitZombie(z, p, dmg) {
    if (!this.state.zombies.has(z.id)) return;
    if (p?.sessionId) dmg *= this.supportBuff(p) * this.cryBuff(p);
    if (z.kind === "minebeast") { const bm = this.bossMem.get(z.id); if (z.act === "under") return; if (this.mine?.shield) { const t = Date.now(); if (bm && t - (bm.shHit || 0) > 160) { bm.shHit = t; this.broadcast("deep", { k: "shieldHit", x: Math.round(z.x), y: Math.round(z.y) }); } return; }   /* shielded: nothing gets through */ if (z.act === "stagger") dmg *= BEAST.staggerMult; dmg = this.beastCrystalHit(z, p, dmg, bm); if (bm && z.act === "wind") bm.windDmg = (bm.windDmg || 0) + dmg; }   // underground: can't be hurt; staggered: takes more; winding up a charge: the damage counts toward breaking it
    if (z.kind === "abomination") {
      if (z.act === "sunder") return;   // tearing apart: can't be hurt
      if (z.act === "daze") dmg *= ABOM.roll.dazeMult;
      const floor = z.maxHp * ABOM.splitAt * .98; if (z.hp - dmg < floor) dmg = Math.max(0, z.hp - floor);   // he never dies as one: the Sundering always plays
    }
    if (z.kind === "butcher" && z.act !== "stagger" && p && Number.isFinite(p.x)) {   // armoured front: half damage from the front (not while staggered)
      let diff = Math.atan2(p.y - z.y, p.x - z.x) - (z.aim || 0); diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) < BUTCHER.armourArc) {
        dmg *= BUTCHER.armour;
        const now = Date.now(); if (now - (this.clangAt || 0) > 140) { this.clangAt = now; this.broadcast("clang", { x: Math.round(z.x + Math.cos(z.aim || 0) * 30), y: Math.round(z.y - 40) }); }
      }
    }
    if (z.kind === "pyre" && z.act === "sermon") {   // kneeling: hits from behind him do double damage
      let diff = Math.atan2(p.y - z.y, p.x - z.x) - z.aim; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > Math.PI / 2) dmg *= PYRE.sermon.back;
    }
    if (z.kind === "screamer" && z.act === "wail" && z.actLen - z.slam < SCREAMER.wail.wind) {   // winding up the wail: his glowing throat is the weak spot
      const W = SCREAMER.wail; let diff = p && Number.isFinite(p.x) ? Math.atan2(p.y - z.y, p.x - z.x) - (z.aim || 0) : Math.PI; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) < Math.PI / 2) dmg *= W.throat;
      const m = this.bossMem.get(z.id); if (m) { m.wailTaken = (m.wailTaken || 0) + dmg; if (m.wailTaken >= z.maxHp * W.choke) this.screamerChoke(z, m); }
    }
    z.hp -= dmg;
    p.damageDealt += dmg;
    if (z.boss) p.bossDamage += dmg;
    if (z.hp <= 0) this.killZombie(z, p);
  }

  // Stuck watchdog (sims: 3 zombies wedged in a corner held a boss wave open forever). A walking zombie that hasn't moved 24px in 4s
  // switches to the flow field; if that doesn't free it within 5s it comes back in from a spawn point.
  stuckWatch(z, now, walking) {
    let m = this.zStuck.get(z.id);
    if (!m) { m = { x: z.x, y: z.y, at: now, flowUntil: 0 }; this.zStuck.set(z.id, m); return false; }
    if (!walking || hyp(z.x - m.x, z.y - m.y) > 24) { m.x = z.x; m.y = z.y; m.at = now; return now < m.flowUntil; }
    if (now - m.at > 4000) {
      if (now < m.flowUntil || now < m.flowUntil + 1500) {   // the flow field didn't free it either: re-enter the map
        const sp = this.spawnPoint(); z.x = sp.x; z.y = sp.y; this.solveZombie(z); this.bossPath?.delete(z.id); this.steer.delete(z.id);
        m.x = z.x; m.y = z.y; m.at = now; m.flowUntil = 0; return false;
      }
      m.flowUntil = now + 5000; m.at = now; this.bossPath?.delete(z.id); return true;
    }
    return now < m.flowUntil;
  }
  // Nov 9: the spawn formula was tuned for a full squad; 4-player sims died around wave 38-46 and solo runs by wave 6.
  // Smaller squads meet fewer zombies (boss HP already scales per player): 1-2 players x0.7, 3-4 x0.85, 5+ x1.
  spawnScale() { const n = this.state.players.size; return n <= 2 ? .7 : n <= 4 ? .85 : 1; }
  spawnPoint() {   // where zombies come in: the streets leaving a painted map, or a ring around the tower
    if (this.painted) {
      const sp = this.painted.spawns, tot = sp.reduce((t, q) => t + q[2], 0); let r = Math.random() * tot, q = sp[0];
      for (const c of sp) { r -= c[2]; if (r <= 0) { q = c; break; } }
      return { x: clamp(q[0] + rand(-24, 24), 20, this.A.width - 20), y: clamp(q[1] + rand(-24, 24), 20, this.A.height - 20) };
    }
    let q = null;
    for (let i = 0; i < 24; i++) {   // on maps packed with big buildings (Whiteout Station) most of the ring is solid: take a spot in a lane, not inside a building
      const ang = Math.random() * Math.PI * 2, dist = rand(SPAWN_RING[0], SPAWN_RING[1]);
      q = { x: clamp(this.A.cx + Math.cos(ang) * dist, 20, this.A.width - 20), y: clamp(this.A.cy + Math.sin(ang) * dist, 20, this.A.height - 20) };
      if (!this.flow || !this.blockedByMap(q.x, q.y, 26)) break;
    }
    return q;
  }
  forgetZombie(id) {   // per-zombie bookkeeping that would otherwise pile up for the life of the room (7,000+ kills a match)
    this.steer.delete(id); this.slamReady.delete(id); this.lungeAng.delete(id); this.enraged.delete(id); this.bossMem.delete(id); this.bossPath?.delete(id); this.zStuck?.delete(id); this.hiveMem.delete(id);
  }
  sweepZombieMemory() {   // after zombies.clear(): drop every id that's gone
    for (const m of [this.steer, this.slamReady, this.lungeAng, this.bossMem, this.bossPath, this.zStuck, this.hiveMem, this.dots, this.taunt]) if (m) for (const k of m.keys()) if (typeof k === "string" && k[0] === "z" && !this.state.zombies.has(k)) m.delete(k);
    for (const k of this.enraged) if (!this.state.zombies.has(k)) this.enraged.delete(k);
  }
  killZombie(z, killer) {
    if (z.kind === "minebeast") { z.hp = 1; return; }   // it can't be killed: at 1 HP the fight ends and it drops to a knee (beastThink)
    if (z.kind === "abomination") { z.hp = Math.max(1, Math.min(z.maxHp * ABOM.splitAt * .98, z.hp > 0 ? z.hp : Infinity)); return; }   // damage that skipped hitZombie (traps, blasts): he never dies as one, the Sundering always plays first (abomThink starts it)
    this.state.zombies.delete(z.id);
    const bossKill = z.boss && !(z.kind === "abomSpawn" && [...this.state.zombies.values()].some(o => o.kind === "abomSpawn"));   // the Five: only the last one is the boss kill
    if (z.kind === "abomSpawn" && !bossKill) { const left = [...this.state.zombies.values()].filter(o => o.kind === "abomSpawn"); for (const o of left) o.speed *= 1 + ABOM.spawn.rage; if (left.length === 1) left[0].enraged = true; this.state.message = `${left.length} of the Five left${left.length === 1 ? ": it's ENRAGED" : ": they're getting faster"}!`; } this.dots.delete(z.id); this.taunt.delete(z.id); this.forgetZombie(z.id);
    if (this.pyreFx.wheel?.owner === z.id) this.pyreFx.wheel = null;   // the Wheel of Flame dies with him
    if (z.kind === "screamer") { this.scrFx.rings = this.scrFx.rings.filter(r => r.owner !== z.id); this.scrFx.marks = this.scrFx.marks.filter(m => m.owner !== z.id); }   // his rings and marks die with him
    this.scrFx.frenzy.delete(z.id);
    this.broadcast("zdead", { id: z.id, x: Math.round(z.x), y: Math.round(z.y), k: z.kind });
    if (z.kind === "hivemind") {   // mini boss down: everyone gets paid, gold spills out
      this.hiveMem.delete(z.id);
      for (const p of this.state.players.values()) p.currency += HIVE.gold;
      for (let i = 0; i < 4; i++) { const item = new LootState(); item.id = `l${++this.lootSequence}`; item.kind = "gold"; item.amount = 15; item.rarity = "Rare"; item.x = z.x + rand(-50, 50); item.y = z.y + rand(-30, 30); this.state.loot.set(item.id, item); }
      this.state.message = `THE HIVEMIND IS DEAD! +${HIVE.gold} gold each.`;
    }   // every death shows a body (even one-shot kills)
    if (killer) {
      killer.kills++;
      if (!z.boss && ["engineer", "scout", "demolitionist", "operator", "juggernaut", "slasher"].includes(killer.characterClass) && Number.isFinite(killer.ultKills)) { killer.ultKills = Math.min(ULT_KILLS, (killer.ultKills || 0) + 1); }
      if (killer.characterClass === "scout" && this.katanaMark.has(z.id)) {   // katana kills level up Raven's katana
        killer.katanaKills = (killer.katanaKills || 0) + 1; const t = Math.min(5, Math.floor(killer.katanaKills / RAVEN.tierKills));
        if (t > (killer.katanaTier || 0)) { killer.katanaTier = t; this.state.message = `${killer.name}'s katana: ${RAVEN.tiers[t].toUpperCase()} unlocked!`; this.broadcast("katanaTier", { id: killer.sessionId, t }); }
      }
      killer.killLeadSince = Date.now();
      const gain = z.boss ? 35 : z.kind === "brute" ? 9 : 5;   // shared XP: the whole team gets it
      for (const q of this.state.players.values()) if ((q.level || 1) < MAX_LEVEL) q.xp += gain;
      killer.currency += z.boss ? 25 : (KILL_GOLD[z.kind] || 1);
      killer.hp = Math.min(killer.maxHp, killer.hp + (z.boss ? 25 : 1));
    }
    this.state.totalKills++;
    if (this.mine?.step === "runes" && Math.random() < DEEP.drop) this.mineShard(z.x, z.y);   // the mine mission: zombies drop crystal shards (cart fuel)
    if(Math.random()<(bossKill?1:this.state.extraLoot?.45:.28)){const item=new LootState();item.id=`l${++this.lootSequence}`;const roll=Math.random();item.kind=bossKill||roll>.92?"weapon":roll<.25?"ammo":roll<.48?"medkit":roll<.72?"scrap":"gold";item.x=z.x;item.y=z.y;item.amount=item.kind==="medkit"?35:item.kind==="ammo"?60:item.kind==="gold"?15:item.kind==="scrap"?8:0;item.rarity=bossKill?"Legendary":roll>.97?"Epic":roll>.9?"Rare":"Common";this.state.loot.set(item.id,item);}
    this.state.scrap += bossKill ? 35 : 2; if (Math.random()<0.12) this.state.electronics += 1; if (Math.random()<0.08) this.state.fuel += 1;
    if (bossKill) {
      this.state.bossDead = true; this.state.bossPhase = "";
      for (const p of this.state.players.values()) p.currency += 40;   // everyone gets paid for a boss
      this.broadcast("bossDead", { kind: z.kind, x: Math.round(z.x), y: Math.round(z.y) });
      if (z.kind === "pyre") this.dropPlates(z);   // (Nov 12) his armour, one piece per survivor
      // let everyone watch it die for a few seconds before the wave ends
      this.bossOverAt = Date.now() + 4500;
      this.state.message = this.state.stage === 50 ? "THE APOCALYPSE HAS FALLEN!" : z.kind === "abomSpawn" ? "THE ABOMINATION IS DEAD!" : z.kind === "hivemind" ? "THE ALPHA HIVEMIND IS DEAD!" : `${String(z.kind).replace(/[A-Z]/g, m => " " + m).toUpperCase()} IS DEAD!`;
    }
  }

  // ---------- game log ----------
  log(level, kind, msg, client = null, extra = {}) {
    const p = client ? this.state.players.get(client.sessionId || client) : null;
    return log(level, kind, msg, { room: this.state.roomCode || this.roomId, wave: this.state.phase === "lobby" ? 0 : this.state.stage, phase: this.state.phase, player: p?.name, cls: p?.characterClass, ...extra });
  }
  logErr(where, e, client = null) {   // the same error is logged at most 3 times per room (with its stack)
    const key = where + (e?.message || e); this.errSeen = this.errSeen || new Map(); const n = (this.errSeen.get(key) || 0) + 1; this.errSeen.set(key, n);
    if (n <= 3) this.log("error", "server", `${where}: ${e?.stack || e}`, client);
    else if (n === 4) this.log("warn", "server", `${where}: same error keeps happening (not logging it again)`, client);
  }
  queueInput(sid, data, dash) {   // true = queued for drainInputs
    const seq = Number(data?.s); if (!Number.isFinite(seq)) return false;
    let q = this.inQ.get(sid); if (!q) this.inQ.set(sid, q = { list: [], credit: 0 });
    if (q.list.length < 12) q.list.push({ dx: data?.dx, dy: data?.dy, dt: data?.dt, s: seq, dash });   // a flood beyond ~0.6s is dropped (the client gets corrected)
    return true;
  }
  drainInputs(dt) {   // each tick, apply about one tick's worth of each player's queued inputs (a bit more if they've fallen behind)
    for (const [sid, q] of this.inQ) {
      const p = this.state.players.get(sid); if (!p) { this.inQ.delete(sid); continue; }
      const backlog = q.list.reduce((t, i) => t + (i.dash ? 0 : clamp(Number(i.dt) || 50, 0, 100) / 1000), 0);
      q.credit += dt * (backlog > 0.16 ? 1.5 : 1);   // > ~3 inputs waiting: catch up
      while (q.list.length && (q.credit > 0 || q.list[0].dash)) {
        const i = q.list.shift(); if (!i.dash) q.credit -= clamp(Number(i.dt) || 50, 0, 100) / 1000;
        if (i.s > (p.ack || 0)) p.ack = i.s;
        if (i.dash) this.applyDash(sid, p, i); else this.applyMove(sid, p, i);
      }
      if (!q.list.length) q.credit = Math.min(q.credit, 0);   // ran dry: don't bank time (the next packet then waits a tick, which becomes the jitter buffer)
    }
  }
  applyMove(sid, p, data) {
    if (!p.alive || !["playing", "cleared"].includes(this.state.phase) || this.state.vehicles.has(sid)) return;   // the break: walk around and build
    if (p.stunned > 0 || this.shadowDash.has(sid) || this.hooks?.has(sid)) { this.lastInputs.set(sid, Date.now()); return; }   // stunned / mid-dash / Arshan's hook pull: can't steer
    const dx = Math.max(-1, Math.min(1, Number(data?.dx) || 0));
    const dy = Math.max(-1, Math.min(1, Number(data?.dy) || 0));
    const mag = hyp(dx, dy) || 1;
    const now = Date.now();
    const previous = this.lastInputs.get(sid) || (now - 50);
    this.lastInputs.set(sid, now);
    // Move by the time the CLIENT measured (so its prediction matches exactly, however unevenly the messages arrive),
    // but never more than real time allows: a budget that refills with real time, capped at 0.25s (no speed hacks).
    const bud = Math.min(0.25, (this.moveBudget.get(sid) ?? 0.1) + Math.max(0, (now - previous) / 1000));
    const want = Number.isFinite(Number(data?.dt)) ? clamp(Number(data.dt) / 1000, 0, 0.1) : Math.min(0.1, Math.max(0, (now - previous) / 1000));
    const dt = Math.min(want, bud); this.moveBudget.set(sid, bud - dt);
    const sp = p.speed * (p.charging ? AXE_HEAVY.moveMult : 1) * (p.slowed > 0 ? 0.5 : 1) * (p.characterClass === "juggernaut" && p.skillT > 0 ? BRIGGS.bastion.slow : 1) * (this.spins?.has(p.sessionId) ? ARSHAN.spin.speed / p.speed : 1);   // Briggs's dome: 30% slower; Arshan's cyclone: 130 px/s
    if (this.bmemOf(p).castUntil > now) { this.lastInputs.set(sid, now); return; }   // Briggs mid-cast (fist slam / roar)
    this.moveWithCollision(p, dx / mag * sp * dt, dy / mag * sp * dt);
    // Face the way you walk (left/right). Gun follows movement unless you're shooting.
    if (dx !== 0) { p.facing = dx > 0 ? 1 : -1; this.lastMoveAt.set(sid, now); }
    if ((dx !== 0 || dy !== 0) && now - (this.lastAimAt.get(sid) || 0) > 400) p.aim = Math.atan2(dy, dx);
  }
  applyDash(sid, p, data) {
    if (!p.alive || this.state.phase !== "playing" || p.stunned > 0 || this.state.vehicles.has(sid) || (p.characterClass === "slasher" && this.arshanBusy(p))) return;
    const now = Date.now();
    if (now - (this.lastDashAt.get(sid) || 0) < DASH_COOLDOWN * 1000) return;
    let dx = Math.max(-1, Math.min(1, Number(data?.dx) || 0)), dy = Math.max(-1, Math.min(1, Number(data?.dy) || 0));
    if (!dx && !dy) dx = p.facing || 1;
    const mag = hyp(dx, dy);
    this.lastDashAt.set(sid, now); this.dodgeUntil.set(sid, now + DASH_IFRAMES * 1000);   // 0.25s nothing can hurt you
    const x0 = p.x, y0 = p.y;
    this.moveWithCollision(p, dx / mag * DASH_DISTANCE, dy / mag * DASH_DISTANCE);
    this.broadcast("dash", { id: sid, x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(p.x), y1: Math.round(p.y) });   // everyone sees the energy trail
    if (dx) p.facing = dx > 0 ? 1 : -1;
  }
  tick() {
    try { this.tickInner(); } catch (e) { this.logErr("game tick", e); }   // a bug skips one tick instead of freezing the room
    for (const p of this.state.players.values()) { const v = `${Math.round(p.bossDamage || 0)}|${p.revives || 0}|${Math.round(p.towerRepairs || 0)}|${p.structuresBuilt || 0}|${Math.round(p.damageDealt || 0)}|${Math.round(p.damageTaken || 0)}`; if (p.stats !== v) p.stats = v; }   // the scoreboard numbers, packed into one synced field (PlayerState is at the 64-field limit)
    if (this.state.phase !== this.logPhase || (this.state.phase === "playing" && this.state.stage !== this.logStage)) {   // wave start / cleared / defeat / victory
      const ph = this.state.phase, alive = [...this.state.players.values()].filter(p => p.alive).length;
      if (this.logPhase !== undefined) this.log(ph === "defeat" ? "warn" : "info", "game", ph === "playing" ? `wave ${this.state.stage} started (${this.state.waveType}, ${this.state.players.size} players)` : ph === "cleared" ? `wave ${this.state.stage} cleared (${alive} alive)` : ph === "defeat" ? `TEAM DEFEATED on wave ${this.state.stage}: ${this.state.message}` : ph === "victory" ? "VICTORY: all 50 waves" : `phase: ${ph}`);
      this.logPhase = ph; this.logStage = this.state.stage;
    }
  }
  setPaused(on) {
    const s = this.state; if (!!s.paused === on) return; const now = Date.now();
    if (on) { s.paused = true; this.pausedAt = now; for (const p of s.players.values()) { p.charging = false; this.inQ?.get(p.sessionId) && (this.inQ.get(p.sessionId).list.length = 0); } this.log("info", "game", "paused by the host"); return; }
    s.paused = false; const ms = now - (this.pausedAt || now); this.lastTick = now; this.shiftClock(ms); this.log("info", "game", `resumed after ${Math.round(ms / 1000)}s`);
  }
  shiftClock(ms) {   // after a pause: push the room's wall-clock timers (boss attack timers, falling-rock marks, burning patches, the intro card...) forward by how long it was paused
    if (!(ms > 0)) return; const T = 1e12, seen = new Set();
    const bump = (o, d = 0) => { if (!o || typeof o !== "object" || d > 3 || seen.has(o) || !(o.constructor === Object || Array.isArray(o) || o instanceof Map)) return; seen.add(o);
      if (o instanceof Map) { for (const v of o.values()) bump(v, d + 1); return; }
      if (Array.isArray(o)) { for (const v of o) bump(v, d + 1); return; }
      for (const k in o) { const v = o[k]; if (typeof v === "number") { if (v > T) o[k] = v + ms; } else if (v && typeof v === "object" && (v.constructor === Object || Array.isArray(v) || v instanceof Map)) bump(v, d + 1); } };   // plain data only (never a synced schema object)
    for (const k of ["introUntil", "bossOverAt"]) if (this[k] > T) this[k] += ms;
    for (const o of [this.bossMem, this.unitMem, this.hiveMem, this.pyreFx, this.scrFx, this.abFx, this.mine?.haz, this.mine?.shield]) bump(o);
  }
  tickInner() {
    const now = Date.now();
    if (this.state.paused) { this.lastTick = now; return; }   // paused by the host: nothing moves, nothing hurts
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.drainInputs(dt);
    for (const p of this.state.players.values()) if (p.charging && (!p.alive || p.activeSlot !== 1 || p.melee !== "axe" || this.state.phase !== "playing")) p.charging = false;
    // Break between waves: 20-second countdown (shop open), then the next wave starts by itself.
    if (this.state.phase !== "playing" && this.state.vehicles.size) this.dismountAll();   // wave over / match over: everyone gets out
    if (this.coaster && (this.state.phase === "playing" || this.state.phase === "cleared")) this.updateCoaster(dt);
    if (this.cordon) this.cordonCheck();
    if (this.state.phase !== "playing") for (const st of this.state.structures.values()) if (st.fire) st.fire = false;   // the wave is over (zombies wiped): turrets stop shooting at where their last target was
    if (this.state.phase === "cleared") {
      if (!this.inBreak) this.beginBreak();
      if (this.state.countdown > BREAK_GO && [...this.state.players.values()].every(p => p.isBot || p.ready)) this.state.countdown = BREAK_GO;   // everyone's ready
      this.state.countdown = Math.max(0, this.state.countdown - dt);
      if (this.state.countdown <= 0) this.startNextWave();
      return;
    }
    if (this.state.phase !== "playing") return;
    if (this.bossOverAt && now >= this.bossOverAt) {   // boss died a few seconds ago: wave over
      this.bossOverAt = 0; this.state.zombies.clear(); this.state.puddles.clear(); this.spits = [];
      this.state.phase = this.state.stage === 50 && this.state.waveMode !== "ascension" ? "victory" : "cleared"; if (this.state.phase === "cleared") this.beginBreak();
      this.state.message = this.state.stage === 50 && this.state.waveMode !== "ascension" ? "THE APOCALYPSE HAS FALLEN — CAMPAIGN VICTORY!" : `Boss defeated! Wave ${this.state.stage} cleared.`;
      return;
    }
    const guard = this.vehicleGuard(now);
    if (!this.state.explore) this.state.elapsed += dt;   // explore mode: timer frozen, no spawns (zombies were cleared when it was turned on)
    this.state.matchTime += dt;
    this.tickCdr(dt, now);   // cooldown reduction: shrink skill timers that just started
    this.tickBurn(dt, now);
    for(const p of this.state.players.values()) if(p.abilityCooldown>0)p.abilityCooldown=Math.max(0,p.abilityCooldown-dt);
    if (this.state.noCd) for (const p of this.state.players.values()) if ((p.ultKills || 0) < ULT_KILLS) p.ultKills = ULT_KILLS;
    for (const p of this.state.players.values()) {   // Viktor's robot charges refill one at a time, every 25s
      if (p.characterClass !== "engineer") continue;
      if (p.robotCharges == null) p.robotCharges = ROBOT_CHARGES;
      if (p.robotCharges >= ROBOT_CHARGES) { p.chargeCd = 0; continue; }
      p.chargeCd = Math.max(0, (p.chargeCd || ROBOT_CD) - dt);
      if (p.chargeCd <= 0) { p.robotCharges++; p.chargeCd = p.robotCharges < ROBOT_CHARGES ? ROBOT_CD : 0; }
    }
    for(const p of this.state.players.values()) { if(p.stunned>0)p.stunned=Math.max(0,p.stunned-dt); if(p.slowed>0)p.slowed=Math.max(0,p.slowed-dt); }
    this.updateAcid(dt);
    this.updateMachines(dt, now);
    this.updateRaven(dt, now);
    this.updateDante(dt, now);
    this.updateSofea(dt, now);
    this.updateMarcus(dt); this.updateBriggs(dt, now);
    this.updateArshan(dt, now);
    this.updateAstra(dt, now);
    this.separateZombies();
    for(const p of this.state.players.values()) if(p.reloadLeft>0){p.reloadLeft=Math.max(0,p.reloadLeft-dt);if(p.reloadLeft===0)this.finishReload(p);}
    for(const b of this.state.players.values()) if(b.isBot&&b.alive) this.botThink(b, dt, now);
    for(const rescuer of this.state.players.values()) if(rescuer.reviveTargetId){
      const target=this.state.players.get(rescuer.reviveTargetId);
      if(!rescuer.alive||!target||target.alive||target.bledOut||distance(rescuer,target)>85){rescuer.reviveTargetId="";rescuer.reviveProgress=0;}
      else {rescuer.reviveProgress+=dt;if(rescuer.reviveProgress>=(rescuer.characterClass==="dispatcher"?2.5:5)){ /* Astra's trait (Field Commander): revives in 2.5s */target.alive=true;target.bleedout=0;target.hp=Math.max(30,Math.round(target.maxHp*.35));rescuer.revives++;rescuer.reviveTargetId="";rescuer.reviveProgress=0;this.state.message=`${rescuer.name} revived ${target.name}!`;}}
    }
    for(const p of this.state.players.values()) if(!p.alive&&!p.bledOut&&p.bleedout>0&&!this.sheltered(p)){p.bleedout=Math.max(0,p.bleedout-dt);if(p.bleedout===0){p.bledOut=true;p.reviveProgress=0;this.state.message=`${p.name} bled out and sits out until the next wave.`;this.log("info","player",`${p.name} bled out`,p.sessionId);}}
    for(const p of this.state.players.values()) if(p.alive) for(const item of [...this.state.loot.values()]) if(distance(p,item)<30){
      if(item.kind==="ammo")p.ammo+=item.amount;else if(item.kind==="medkit"){if(p.medkits<MAX_MEDKITS)p.medkits++;else p.hp=Math.min(p.maxHp,p.hp+item.amount);}else if(item.kind==="scrap")this.state.scrap+=item.amount;else if(item.kind==="gold")p.currency+=item.amount;else if(item.kind==="shard"){if(this.mine)this.mine.fuel=Math.min(DEEP.fuelMax,this.mine.fuel+1);}else if(item.kind==="pyreplate"){if(p.armor)continue;this.givePlate(p,true);}else if(item.kind==="weapon"){   // Nov 9: never switches the gun in your HANDS. Not holding that slot: it goes into the slot (one press of 2 / 3
        // equips it); holding a gun of that slot: it waits in your bag (press 2 / 3 again to swap).
        const found=item.rarity==="Legendary"?"launcher":item.rarity==="Epic"?"sniper":"shotgun", slot=WEAPONS[found].slot, had=p.owned.split(",").includes(found);
        p.ammo+=30; this.unlockWeapon(p,found); const slotN=slot==="primary"?2:3; if(!had&&p.activeSlot!==slotN) p[slot]=found;
        this.state.message=had?`${p.name} found a ${item.rarity} ${found} (+30 ammo)`:`${p.name} found a ${item.rarity} ${found}! Press ${slot==="primary"?2:3} to switch to it.`;}
      this.state.loot.delete(item.id);
    }
    this.state.dayTime = (this.state.dayTime + dt) % 180;   // 2 minutes of day, 1 minute of night
    this.state.isNight = this.state.dayTime >= 120;
    this.spawnClock -= dt;
    if (this.state.waveType === "normal" && isHiveWave(this.state.stage) && !this.hiveSpawned && !this.state.explore && this.state.elapsed >= HIVE.arriveAt) this.spawnHivemind();
    if (this.state.waveType === "mission") { if (this.mine) this.mineTick(dt, now); }
    else if (this.state.waveType === "boss") this.bossWaveTick(dt, now);
    else if (this.spawnClock <= 0 && this.state.elapsed < 90) {
      this.spawnZombie();
      // Waves 1-6 are a warm-up that ramps up smoothly; wave 7+ uses the normal formula. Small squads get fewer (spawnScale).
      const early = { 1: 2.6, 2: 2.0, 3: 1.6, 4: 1.3, 5: 1.1, 6: 0.95 }[this.state.stage], sc = this.spawnScale();   // warm-up waves: ~35 / 45 / 56 / 69 / 82 / 95 zombies (full squad)
      if (!early && Math.random() < Math.min(.65,.15 + this.state.stage*.01) * sc) this.spawnZombie();
      this.spawnClock = (early || Math.max(0.24, 1.15 - this.state.stage * 0.018)) / sc;
    }
    if (this.state.generatorFuel > 0 && this.state.generatorHp > 0) this.state.generatorFuel = Math.max(0,this.state.generatorFuel-dt*0.025);
    else if (this.state.generatorHp <= 0 || this.state.generatorFuel <= 0) this.state.generatorHp = Math.max(0,this.state.generatorHp-dt*0.1);
    const zList = this.state.structures.size ? [...this.state.zombies.values()] : null, powered = this.state.generatorFuel > 0 && this.state.generatorHp > 0;   // one list for every deployable this tick
    const credit = st => this.state.players.get(st.ownerId) || this.state.players.values().next().value || null;
    for (const st of this.state.structures.values()) {
      if (st.kind === "turret" && powered) {
        let target = null, bd = 260;   // nearest zombie in range it can see
        for (const z of zList) { const d = distance(st, z); if (d < bd && this.lineClear(st, z)) { bd = d; target = z; } }
        if (!!target !== st.fire) st.fire = !!target; if (target) st.aim = Math.atan2(target.y - st.y, target.x - st.x);   // the client turns it + plays its firing loop
        if (target) { target.hp -= 18 * dt; if (target.hp <= 0) this.killZombie(target, credit(st)); }
      } else if (st.kind === "turret") st.fire = false;   // no power
      if (st.kind === "fence" && powered) {
        for (const z of zList) if (this.state.zombies.has(z.id) && nearFoot(st, z, 26, 30)) { z.hp -= 12 * dt; if (z.hp <= 0) this.killZombie(z, credit(st)); }
      }
      if (st.kind === "flameTrap" && powered) {
        for (const z of zList) if (this.state.zombies.has(z.id) && distance(st, z) < 65) { z.hp -= 20 * dt; if (z.hp <= 0) this.killZombie(z, credit(st)); }
      }
      if (st.kind === "mine" && st.hp > 0 && zList.some(z => this.state.zombies.has(z.id) && distance(st, z) < MINE.trigger)) {   // stepped on: a blast hits everything around it
        st.hp = 0; this.state.structures.delete(st.id);
        this.ripples.push({ kind: "mine", owner: st.ownerId, x: st.x, y: st.y, t: Date.now(), at: 0, dmg: MINE.dmg, fall: MINE.edge, r: MINE.r, flat: 1, push: MINE.push, wallSafe: true });
      }
    }

    const players = [...this.state.players.values()].filter(p => p.alive);
    const machines = [...[...this.state.robots.values()].filter(r => r.kind !== "worker"), ...[...this.state.structures.values()].filter(st => st.kind === "heavyTurret")];
    const flying = id => (this.state.vehicles.get(id)?.kind === "heli" && this.state.vehicles.get(id).phase === "ride") || this.state.players.get(id)?.ride > 0;   // up in the helicopter / on the coaster
    this.bossUp = false; for (const z of this.state.zombies.values()) if (z.boss) { this.bossUp = true; break; }   // a boss can reach Sofea's helicopter (ordinary zombies can't): see untouchable()
    const seenBoss = players.filter(p => !(p.shadow > 0) && !this.away.has(p.sessionId) && !this.inCordon(p));
    const seen = players.filter(p => !(p.shadow > 0) && !flying(p.sessionId) && !this.away.has(p.sessionId) && !this.inCordon(p));   // invisible Raven / Sofea up in her helicopter / someone reconnecting: zombies can't get them
    const shelter = this.shelterGuard();   // survivors inside a finished safehouse: zombies outside can't touch them
    if (this.abFx.puddles.length) this.abomPuddles(now);
    const barricades = []; for (const st of this.state.structures.values()) if (st.kind === "barricade") barricades.push(st);
    const seenXY = seen.map(p => [p.x, p.y, p]), seenBossXY = seenBoss.map(p => [p.x, p.y, p]), machXY = machines.map(m => [m.x, m.y, m]);   // plain numbers: the nearest-survivor search below runs once per zombie per tick
    for (const z of [...this.state.zombies.values()]) {
      if (z.kind === "minebeast") { if (this.mine?.step === "fight") this.beastThink(z, dt, now); continue; }   // the Mine Beast: its own fight; in the chase the mission drives it (mineTick)
      const taunted = this.tauntTarget(z, now);
      if (z.kind === "butcher") { this.butcherThink(z, dt, now, taunted ? [taunted] : seenBoss); continue; }
      if (z.kind === "hivemind") { this.hiveThink(z, dt, now, taunted ? [taunted] : seen); continue; }
      if (z.kind === "pyre") { this.pyreThink(z, dt, now, taunted); continue; }
      if (z.kind === "screamer") { this.screamerThink(z, dt, now, taunted); continue; }
      if (z.kind === "abomination") { this.abomThink(z, dt, now, taunted); continue; }
      if (z.kind === "abomSpawn") { this.abomSpawnThink(z, dt, now, taunted); continue; }
      if(z.boss&&!this.enraged.has(z.id)&&z.hp/z.maxHp<.3){this.enraged.add(z.id);z.speed*=1.35;z.damage*=1.25;this.state.message="The boss is ENRAGED!";}
      if (!players.length) break;
      const zx = z.x, zy = z.y; let nearestPlayer = null, nd = Infinity;
      for (const q of (z.boss ? seenBossXY : seenXY)) { const dx = q[0] - zx, dy = q[1] - zy, d2 = dx * dx + dy * dy; if (d2 < nd) { nd = d2; nearestPlayer = q[2]; } }
      const tower = {x: this.A.cx, y: this.A.cy};
      let target = taunted ? taunted : z.boss ? nearestPlayer   // War Cry: Briggs first; bosses hunt survivors only
        : z.role === "hunter" ? (nearestPlayer || tower) : tower;
      if (z.role === "hunter" && !z.boss && !taunted && machXY.length) {   // hunters also go for Viktor's turret and robots if they're closer
        let bd = (target.x - zx) ** 2 + (target.y - zy) ** 2;
        for (const m of machXY) { const dx = m[0] - zx, dy = m[1] - zy, md = dx * dx + dy * dy; if (md < bd) { bd = md; target = m[2]; } }
      }
      const isMachine = !!target.maxHp && !target.sessionId;
      z.targetId = target.sessionId || "";
      const tv = target.sessionId && this.state.vehicles.get(target.sessionId), d = distance(z, target) - (tv?.phase === "ride" ? SOFEA[tv.kind].reach || 0 : 0);   // the tank / mecha is big: they hit its side
      const a = Math.atan2(target.y - z.y, target.x - z.x);
      if (z.kind === "mutant") {
        if (z.slam > 0) {                                  // mid-attack
          const t0 = MUTANT.total - z.slam; z.slam = Math.max(0, z.slam - dt); const t1 = MUTANT.total - z.slam;
          if (t1 < MUTANT.charge) { this.lungeAng.set(z.id, a); this.steerMove(z, z.id, a, z.speed * MUTANT.chargeSpeed * dt, e => this.solveZombie(e)); }   // coiling: creeps in, keeps aiming
          else if (t1 < MUTANT.lungeEnd && d > z.radius + 6) this.steerMove(z, z.id, this.lungeAng.get(z.id) ?? a, MUTANT.lungeSpeed * dt, e => this.solveZombie(e));   // LUNGE
          if (t0 < MUTANT.hit && t1 >= MUTANT.hit) this.mutantWhip(z, this.lungeAng.get(z.id) ?? a);
          continue;
        }
        if (target.sessionId && d < MUTANT.trigger && now >= (this.slamReady.get(z.id) || 0)) {
          z.slam = MUTANT.total; this.lungeAng.set(z.id, a); this.slamReady.set(z.id, now + (MUTANT.total + MUTANT.cooldown) * 1000); continue;
        }
      }
      if (z.kind === "brute") {
        if (z.slam > 0) {                                  // mid-slam: stand still; hit at the end of the wind-up
          const before = SLAM.total - z.slam; z.slam = Math.max(0, z.slam - dt);
          if (before < SLAM.windup && SLAM.total - z.slam >= SLAM.windup) this.bruteSlam(z);
          continue;
        }
        if (target.sessionId && d < SLAM.trigger && now >= (this.slamReady.get(z.id) || 0)) {
          z.slam = SLAM.total; this.slamReady.set(z.id, now + (SLAM.total + SLAM.cooldown) * 1000); continue;
        }
      }
      const wall = this.safeBoxes.length && target && this.sheltered(target) ? this.safeTouch(z) : null;
      if (wall) {   // its prey is inside Astra's safehouse: hit the wall (1 per attack, 6 breaks it)
        z.attackCooldown = Math.max(0, z.attackCooldown - dt);
        if (z.attackCooldown <= 0) { this.hitSafe(wall, z); z.attackCooldown = z.boss ? 0.8 : 1.0; }
        continue;
      }
      const barricade = barricades.length ? barricades.find(st => st.hp > 0 && nearFoot(st, z, 10, 12)) : null;   // touching the line anywhere along it
      if (barricade) {
        z.attackCooldown = Math.max(0, z.attackCooldown - dt);
        if(z.attackCooldown<=0){barricade.hp-=z.damage;z.attackCooldown=1;if(barricade.hp<=0)this.state.structures.delete(barricade.id);}
      } else if (z.kind === "spitter" && d < ACID.hold) {
        // Spitters keep their distance and lob acid from range.
        if (d < ACID.backOff) this.steerMove(z, z.id, a + Math.PI, z.speed * dt, e => this.solveZombie(e));
      } else if (d > (z.kind === "mutant" ? z.radius + 10 : z.radius + (ATTACK_REACH[z.kind] || DEFAULT_REACH) - 4)) {
        if (this.flow || this.stuckWatch(z, now, true)) this.bossMove(z, target, z.speed * dt);   // maps with walls and dead ends (or a zombie wedged on one): walk the flow field like the bosses
        else this.steerMove(z, z.id, a, z.speed * dt, e => this.solveZombie(e));   // mutants keep closing in while they slash
      } else this.stuckWatch(z, now, false);
      z.attackCooldown = Math.max(0, z.attackCooldown - dt);   // stops at 0: no network traffic while it just walks
      if (d < z.radius + (ATTACK_REACH[z.kind] || DEFAULT_REACH) && z.attackCooldown <= 0) {
        if (isMachine) {
          if (this.state.robots.has(target.id) || this.state.structures.has(target.id)) this.damageMachine(target, z.damage * (z.kind === "mutant" ? 1.6 : 1));
        } else if (z.kind === "mutant" && target.sessionId) {
          // mutants only hurt survivors with their charged whip (above)
        } else if (target.sessionId) {
          if (!target.alive) continue;   // went down a moment ago (another zombie got them this tick): pick a new target next tick
          if (this.untouchable(target) || (!z.boss && flying(target.sessionId))) { z.attackCooldown = .25; continue; }   // dodged (mid-dash) / sheltered / up in the helicopter (only bosses reach it): the bite misses
          const dealt = this.armorHit(target, z.damage, z); target.hp-=dealt; target.damageTaken+=dealt;
          if(target.hp<=0)this.downPlayer(target);
        } else {
          this.state.towerHp=Math.max(0,this.state.towerHp-z.damage*(z.boss?2:1));
          if(this.state.towerHp<=0){this.state.phase="defeat";this.state.message="THE RADIO TOWER HAS BEEN DESTROYED — TEAM DEFEATED.";}
        }
        z.attackCooldown = z.boss ? 0.8 : 1.0;
      }
      if (z.kind === "spitter" && d >= ACID.minRange && d < ACID.maxRange && z.attackCooldown <= 0 && this.lineClear(z, target) && !(target.sessionId && this.sheltered(target))) {
        this.spit(z, target.x, target.y, !target.sessionId && !isMachine); z.attackCooldown = ACID.cooldown;
      }
    }
    this.keepOutOfSafehouses(); this.applyShelter(shelter);
    this.applyVehicleGuard(guard);
    const hiveAlive = [...this.state.zombies.values()].some(z => z.kind === "hivemind");
    if (this.state.elapsed >= 90 && hiveAlive && !this.hiveNag) { this.hiveNag = true; this.state.message = "Kill THE HIVEMIND to end the wave!"; }
    if (this.state.elapsed >= 90 && !hiveAlive && !this.bossUp && this.state.waveType === "normal" && this.state.phase === "playing") {   // a test-spawned boss (Esc menu) holds the wave open: the 90s timer used to wipe him mid-fight
      this.state.phase = this.state.stage >= 50 && this.state.waveMode !== "ascension" ? "victory" : "cleared"; if (this.state.phase === "cleared") this.beginBreak();
      this.state.message = `Wave ${this.state.stage} survived! Host can launch the next wave.`;
    }
    if ([...this.state.players.values()].every(p=>!p.alive) && this.state.players.size>0 && this.state.phase==="playing") {
      this.state.phase="defeat"; this.state.message="THE ENTIRE TEAM HAS FALLEN.";
    }
  }
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function cleanName(v) { return String(v || "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 18); }
