// BOSS GEAR (Nov 17, the user's plan: tools/boss-gear-plan.md, project doc claude/boss-gear-plan.md). Shared by the server and the client:
// client/gearData.js is an exact copy (the tests check it). Pure data + small helpers, no imports.
//   - every boss kill bursts into 10-12 items: exactly 1 legendary (one of its 3), 1-2 epics (of its 5), the rest half lower gear, half materials
//   - gear is kept in the player's browser (one loadout for whichever survivor they play); the client sends what's equipped, the server applies it
//   - each enhance level (+1..+10) adds 5% of the item's base stats; specials don't change
// Stat keys (scale with + level): hp max HP, arm armour (1.5% less damage each, max 40%), dmg % damage, mel % melee damage, rate % fire rate,
// spd % move speed, cdr % faster skill recharge, rng % gun range.
// Special keys (sp, don't scale): see SPECIALS below. soon: the special isn't in the game yet (its card says so).
export const GEAR_VERSION = 1;
export const SLOTS = ["head", "outfit", "gloves", "boots", "gunmod", "trophy"];
export const SLOT_NAME = { head: "Head", outfit: "Outfit", gloves: "Gloves", boots: "Boots", gunmod: "Gun Mod", trophy: "Trophy" };
export const BOSSES = {
  butcher: { name: "The Butcher", ess: "Butcher's Bone" },
  hivemind: { name: "The Alpha Hivemind", ess: "Jade Resin" },
  screamer: { name: "The Screamer", ess: "Frozen Echo" },
  pyre: { name: "The Pyre Priest", ess: "Ember Core" },
  minebeast: { name: "The Mine Beast", ess: "Rune Shard" },
  abomination: { name: "The Abomination", ess: "Slag Core" },
};
export const BAND = t => t >= 10 ? "Legendary" : t >= 8 ? "Epic" : t >= 6 ? "Rare" : t >= 4 ? "Uncommon" : "Common";
export const BAND_COLOR = { Common: "#c9d1cf", Uncommon: "#7fd36a", Rare: "#5fb4ff", Epic: "#c58bff", Legendary: "#ffc94d" };
export const KIND_NAME = { DEF: "Defence", ATK: "Attack", UTIL: "Utility" };
const I = (id, boss, t, name, slot, kind, st, sp, txt) => ({ id, boss, t, name, slot, kind, st: st || {}, sp: sp || {}, txt });
export const ITEMS = [
  // THE BUTCHER: meat, hooks and cleavers (melee, healing, HP)
  I("bu-stained-apron", "butcher", 1, "Stained Apron", "outfit", "DEF", { hp: 8 }, null, "+8 max HP"),
  I("bu-gloves", "butcher", 2, "Butcher's Gloves", "gloves", "ATK", { mel: 4 }, null, "+4% melee damage"),
  I("bu-rubber-boots", "butcher", 3, "Rubber Boots", "boots", "UTIL", { spd: 3 }, null, "+3% move speed"),
  I("bu-pig-mask", "butcher", 4, "Pig Mask", "head", "DEF", { hp: 16 }, null, "+16 max HP"),
  I("bu-sharpened-sight", "butcher", 5, "Sharpened Sight", "gunmod", "ATK", { dmg: 6 }, null, "+6% damage"),
  I("bu-chain-apron", "butcher", 6, "Chain Apron", "outfit", "DEF", { arm: 2, hp: 12 }, null, "+2 armour, +12 max HP"),
  I("bu-hook-charm", "butcher", 7, "Meat Hook Charm", "trophy", "UTIL", {}, { mheal: 3 }, "Melee kills heal 3 HP"),
  I("bu-hook-gauntlets", "butcher", 8, "Hook Gauntlets", "gloves", "ATK", { mel: 10, rate: 6 }, null, "+10% melee damage, +6% fire rate"),
  I("bu-slaughter-vest", "butcher", 8, "Slaughterhouse Vest", "outfit", "DEF", { arm: 3, hp: 20 }, null, "+3 armour, +20 max HP"),
  I("bu-locker-boots", "butcher", 8, "Meat Locker Boots", "boots", "UTIL", { spd: 8 }, { slowRes: .3 }, "+8% move speed, slows on you last 30% shorter"),
  I("bu-bone-saw", "butcher", 9, "Bone Saw Barrel", "gunmod", "ATK", { dmg: 12 }, { prc: 1 }, "+12% damage, shots go through 1 more zombie"),
  I("bu-blood-hood", "butcher", 9, "Blood-Soaked Hood", "head", "DEF", { hp: 25 }, { mheal: 2 }, "+25 max HP, melee kills heal 2 HP"),
  I("bu-cleaver", "butcher", 10, "The Butcher's Cleaver", "trophy", "ATK", { dmg: 10 }, { mheal: 6, crit: .1 }, "+10% damage. Melee kills heal 6 HP, and 1 hit in 10 cleaves for double damage"),
  I("bu-apron", "butcher", 10, "The Butcher's Apron", "outfit", "DEF", { arm: 6, hp: 40 }, { bleed: 1 }, "+6 armour, +40 max HP. Zombies that bite you bleed (10 damage over 2s)"),
  I("bu-meat-hook", "butcher", 10, "The Meat Hook", "gunmod", "ATK", { dmg: 15 }, { soon: "hook" }, "+15% damage. Every 8s your next shot hooks a zombie and drags it to you, stunned for 1s"),
  // THE ALPHA HIVEMIND: chitin, silk and jade (armour, fire rate, faster skills)
  I("hv-silk-wraps", "hivemind", 1, "Silk Wraps", "gloves", "ATK", { rate: 3 }, null, "+3% fire rate"),
  I("hv-jade-beads", "hivemind", 2, "Jade Bead Charm", "trophy", "UTIL", { cdr: 4 }, null, "Skills recharge 4% faster"),
  I("hv-shin-guards", "hivemind", 3, "Chitin Shin Guards", "boots", "DEF", { arm: 1 }, null, "+1 armour"),
  I("hv-hive-mask", "hivemind", 4, "Hive Mask", "head", "DEF", { arm: 1, hp: 8 }, null, "+1 armour, +8 max HP"),
  I("hv-larva-ammo", "hivemind", 5, "Larva Sac Ammo", "gunmod", "ATK", { rate: 6 }, null, "+6% fire rate"),
  I("hv-chitin-vest", "hivemind", 6, "Chitin Vest", "outfit", "DEF", { arm: 3 }, null, "+3 armour"),
  I("hv-antenna", "hivemind", 7, "Antenna Headset", "head", "UTIL", { hp: 10 }, { soon: "xray" }, "See zombies through walls close to you, +10 max HP"),
  I("hv-swarm-gloves", "hivemind", 8, "Swarm Gloves", "gloves", "ATK", { rate: 10 }, null, "+10% fire rate"),
  I("hv-jade-armour", "hivemind", 8, "Jade Scale Armour", "outfit", "DEF", { arm: 4, hp: 15 }, null, "+4 armour, +15 max HP"),
  I("hv-silk-boots", "hivemind", 8, "Silk Runner Boots", "boots", "UTIL", { spd: 9 }, null, "+9% move speed"),
  I("hv-hive-heart", "hivemind", 9, "Hive Heart", "trophy", "UTIL", { cdr: 12 }, null, "Skills recharge 12% faster"),
  I("hv-stinger", "hivemind", 9, "Stinger Rounds", "gunmod", "ATK", { dmg: 10 }, { poison: 1 }, "+10% damage, your hits poison zombies (a little damage over time)"),
  I("hv-alpha-crown", "hivemind", 10, "Alpha Crown", "head", "DEF", { arm: 4, hp: 30 }, { thorns: 15 }, "+4 armour, +30 max HP. Zombies that bite you take 15 damage back"),
  I("hv-brood-sac", "hivemind", 10, "The Brood Mother's Sac", "trophy", "UTIL", { cdr: 15 }, { soon: "larvae" }, "Skills recharge 15% faster. Every 20s, 3 friendly larvae hatch and fight for you for 10s"),
  I("hv-jade-gauntlets", "hivemind", 10, "Jade Emperor Gauntlets", "gloves", "ATK", { rate: 18 }, { chain: 5 }, "+18% fire rate. Every 5th hit jumps to 2 more zombies nearby"),
  // THE SCREAMER: ice and sound (anti-stun, range, slows)
  I("sc-wool-scarf", "screamer", 1, "Wool Scarf", "outfit", "DEF", { hp: 8 }, null, "+8 max HP"),
  I("sc-earmuffs", "screamer", 2, "Earmuffs", "head", "DEF", {}, { stunRes: .2 }, "Stuns on you last 20% shorter"),
  I("sc-snow-boots", "screamer", 3, "Snow Boots", "boots", "UTIL", { spd: 3 }, null, "+3% move speed"),
  I("sc-frosted-lens", "screamer", 4, "Frosted Lens", "gunmod", "ATK", { dmg: 5, rng: 10 }, null, "+5% damage, +10% range"),
  I("sc-thermal-gloves", "screamer", 5, "Thermal Gloves", "gloves", "ATK", { rate: 5 }, null, "+5% fire rate"),
  I("sc-parka-plate", "screamer", 6, "Parka Plate", "outfit", "DEF", { arm: 2, hp: 16 }, null, "+2 armour, +16 max HP"),
  I("sc-echo-charm", "screamer", 7, "Echo Charm", "trophy", "UTIL", { cdr: 10 }, null, "Skills recharge 10% faster"),
  I("sc-noise-helmet", "screamer", 8, "Noise-Cancel Helmet", "head", "DEF", { hp: 16 }, { scream: 1 }, "Screams can't stun you, +16 max HP"),
  I("sc-arctic-parka", "screamer", 8, "Arctic Parka", "outfit", "DEF", { arm: 3, hp: 20 }, null, "+3 armour, +20 max HP"),
  I("sc-tuning-scope", "screamer", 8, "Tuning Fork Scope", "gunmod", "ATK", { dmg: 10, rng: 15 }, null, "+10% damage, +15% range"),
  I("sc-glacier-boots", "screamer", 9, "Glacier Boots", "boots", "UTIL", { spd: 8 }, { trail: 1 }, "+8% move speed, and a frost trail that slows zombies 20%"),
  I("sc-frostbite-gloves", "screamer", 9, "Frostbite Gloves", "gloves", "ATK", { rate: 8 }, { chillHit: 1 }, "+8% fire rate, your hits make zombies 15% slower for 1s"),
  I("sc-vocal-cord", "screamer", 10, "The Screamer's Vocal Cord", "trophy", "UTIL", { cdr: 10 }, { shout: 20 }, "Skills recharge 10% faster. Every 20s you let out a scream that stuns zombies around you for 1s"),
  I("sc-banshee-veil", "screamer", 10, "The Banshee Veil", "head", "DEF", { hp: 35 }, { scream: 1, stunRes: 1 }, "+35 max HP. Screams and stuns can't touch you"),
  I("sc-whiteout-coat", "screamer", 10, "The Whiteout Coat", "outfit", "DEF", { arm: 5, hp: 30 }, { aura: 1 }, "+5 armour, +30 max HP. Zombies near you are 20% slower (a cold aura)"),
  // THE PYRE PRIEST: fire (burns, fire resistance)
  I("py-ash-cloth", "pyre", 1, "Ash Cloth", "outfit", "DEF", { hp: 8 }, null, "+8 max HP"),
  I("py-ember-gloves", "pyre", 2, "Ember Gloves", "gloves", "ATK", { dmg: 4 }, null, "+4% damage"),
  I("py-sand-treads", "pyre", 3, "Sand Treads", "boots", "UTIL", { spd: 4 }, null, "+4% move speed"),
  I("py-prayer-beads", "pyre", 4, "Prayer Beads", "trophy", "UTIL", { cdr: 5 }, null, "Skills recharge 5% faster"),
  I("py-incendiary", "pyre", 5, "Incendiary Rounds", "gunmod", "ATK", {}, { burn: 1 }, "Your hits set zombies on fire (a small burn)"),
  I("py-priest-hood", "pyre", 6, "Priest's Hood", "head", "DEF", { hp: 20 }, { fireRes: .3 }, "+20 max HP, fire hurts you 30% less"),
  I("py-forged-grips", "pyre", 7, "Flame-Forged Grips", "gloves", "ATK", { dmg: 10 }, null, "+10% damage"),
  I("py-pyre-plate", "pyre", 8, "Pyre Plate", "outfit", "DEF", { arm: 4 }, { fireproof: 1 }, "Fireproof: you can't catch fire. +4 armour"),
  I("py-desert-boots", "pyre", 8, "Desert Walker Boots", "boots", "UTIL", { spd: 9 }, { groundFire: 1 }, "+9% move speed, fire on the ground can't hurt you"),
  I("py-cinder-mask", "pyre", 8, "Cinder Mask", "head", "DEF", { hp: 22 }, { fireRes: .4 }, "+22 max HP, fire hurts you 40% less"),
  I("py-sun-idol", "pyre", 9, "Sun Idol", "trophy", "ATK", { dmg: 12, rate: 6 }, null, "+12% damage, +6% fire rate"),
  I("py-phoenix-gloves", "pyre", 9, "Phoenix Gloves", "gloves", "ATK", { dmg: 12 }, { phoenix: 1 }, "+12% damage, kills sometimes burst into flame"),
  I("py-pyre-crown", "pyre", 10, "The Pyre Crown", "head", "DEF", { hp: 40 }, { pyreRing: 8 }, "+40 max HP. When you're hit, a ring of fire bursts round you (once every 8s)"),
  I("py-eternal-flame", "pyre", 10, "The Eternal Flame", "gunmod", "ATK", { dmg: 18 }, { burn: 1, flame: .1 }, "+18% damage. Every shot sets zombies on fire, and burning zombies take 10% more damage"),
  I("py-censer", "pyre", 10, "The Priest's Censer", "trophy", "UTIL", { cdr: 15 }, { censer: 1 }, "Skills recharge 15% faster. Using a skill bursts a ring of fire round you"),
  // THE MINE BEAST: stone and runes (armour, pierce, range)
  I("mb-miner-gloves", "minebeast", 1, "Miner's Gloves", "gloves", "ATK", { rate: 3 }, null, "+3% fire rate"),
  I("mb-steel-toe", "minebeast", 2, "Steel-Toe Boots", "boots", "DEF", { arm: 1 }, null, "+1 armour"),
  I("mb-miner-helmet", "minebeast", 3, "Miner's Helmet", "head", "DEF", { hp: 10 }, { light: 1 }, "+10 max HP and a light in the dark"),
  I("mb-ore-charm", "minebeast", 4, "Ore Chunk Charm", "trophy", "UTIL", {}, { gold: .1 }, "+10% gold from kills"),
  I("mb-drill-bit", "minebeast", 5, "Drill Bit Barrel", "gunmod", "ATK", {}, { prc: 1 }, "Shots go through 1 more zombie"),
  I("mb-ore-vest", "minebeast", 6, "Ore-Plated Vest", "outfit", "DEF", { arm: 3 }, null, "+3 armour"),
  I("mb-rune-stone", "minebeast", 7, "Rune Stone", "trophy", "UTIL", { cdr: 12 }, null, "Skills recharge 12% faster"),
  I("mb-rune-boots", "minebeast", 8, "Rune Boots", "boots", "UTIL", { spd: 10 }, null, "+10% move speed"),
  I("mb-granite-plate", "minebeast", 8, "Granite Plate", "outfit", "DEF", { arm: 5 }, null, "+5 armour"),
  I("mb-foreman-helmet", "minebeast", 8, "Foreman's Helmet", "head", "DEF", { hp: 20, arm: 1 }, { light: 1 }, "+20 max HP, +1 armour and a light in the dark"),
  I("mb-crystal-scope", "minebeast", 9, "Crystal Scope", "gunmod", "ATK", { dmg: 15, rng: 20 }, null, "+15% damage, +20% range"),
  I("mb-pickaxe-grips", "minebeast", 9, "Pickaxe Grips", "gloves", "ATK", { mel: 12, rate: 8 }, null, "+12% melee damage, +8% fire rate"),
  I("mb-beast-horn", "minebeast", 10, "The Beast's Horn", "trophy", "DEF", { arm: 5 }, { horn: 15 }, "+5 armour. Every 15s your next shot is a rock spike that stuns for 1s"),
  I("mb-rune-heart", "minebeast", 10, "The Rune Heart", "trophy", "UTIL", { cdr: 18 }, { runes: 2 }, "Skills recharge 18% faster. Glowing runes under your feet heal teammates near you 2 HP a second"),
  I("mb-beast-hide", "minebeast", 10, "The Beast's Hide", "outfit", "DEF", { arm: 7, hp: 30 }, { block: 10 }, "+7 armour, +30 max HP. Every 10s the next hit on you is blocked"),
  // THE ABOMINATION: flesh and molten iron (healing, HP, melee)
  I("ab-rag-bandages", "abomination", 1, "Rag Bandages", "outfit", "DEF", {}, { reg: .5 }, "Heal 0.5 HP a second"),
  I("ab-iron-knuckles", "abomination", 2, "Iron Knuckles", "gloves", "ATK", { mel: 5 }, null, "+5% melee damage"),
  I("ab-lava-treads", "abomination", 3, "Lava Treads", "boots", "UTIL", { spd: 4 }, { lavaRes: .5 }, "+4% move speed, lava hurts you 50% less"),
  I("ab-foundry-mask", "abomination", 4, "Foundry Mask", "head", "DEF", { arm: 2 }, null, "+2 armour"),
  I("ab-molten-slugs", "abomination", 5, "Molten Slugs", "gunmod", "ATK", { dmg: 8 }, null, "+8% damage"),
  I("ab-mutant-hide", "abomination", 6, "Mutant Hide", "outfit", "DEF", { hp: 30 }, { reg: 1 }, "+30 max HP, heal 1 HP a second"),
  I("ab-crucible-gauntlets", "abomination", 7, "Crucible Gauntlets", "gloves", "ATK", { dmg: 12 }, null, "+12% damage"),
  I("ab-iron-lung", "abomination", 8, "Iron Lung", "trophy", "DEF", { hp: 40 }, null, "+40 max HP"),
  I("ab-slag-boots", "abomination", 8, "Slag Boots", "boots", "UTIL", { spd: 8 }, { lavaRes: 1 }, "+8% move speed, lava can't hurt you"),
  I("ab-flesh-vest", "abomination", 8, "Stitched Flesh Vest", "outfit", "DEF", { hp: 35 }, { reg: 1 }, "+35 max HP, heal 1 HP a second"),
  I("ab-forge-helm", "abomination", 9, "Forge Helm", "head", "DEF", { arm: 4, hp: 20 }, null, "+4 armour, +20 max HP"),
  I("ab-molten-core", "abomination", 9, "Molten Core Barrel", "gunmod", "ATK", { dmg: 14 }, { molten: 10 }, "+14% damage, every 10th shot is a molten slug that splashes"),
  I("ab-heart", "abomination", 10, "The Abomination's Heart", "trophy", "DEF", {}, { reg: 2, heart: 1 }, "Heal 2 HP a second. Once a match, when you would go down you get back up with 50% HP"),
  I("ab-iron-maw", "abomination", 10, "The Iron Maw", "gloves", "ATK", { mel: 20, rate: 10 }, { mheal: 8 }, "+20% melee damage, +10% fire rate. Melee kills heal 8 HP"),
  I("ab-flesh-crown", "abomination", 10, "The Flesh Crown", "head", "DEF", { hp: 50 }, { crown: 30 }, "+50 max HP, and +1 more max HP for every 20 kills in a match (up to +30)"),
];
export const ITEM = Object.fromEntries(ITEMS.map(it => [it.id, it]));
// what a special does, in a few words (the stats tab's ACTIVE SPECIALS cards); soon = not in the game yet
export const SPECIALS = {
  mheal: v => `Melee kills heal ${v} HP`, crit: () => "1 hit in 10 does double damage", bleed: () => "Biters bleed", prc: v => `Shots go through ${v} more`,
  slowRes: v => `Slows ${Math.round(v * 100)}% shorter`, stunRes: v => v >= 1 ? "Can't be stunned" : `Stuns ${Math.round(v * 100)}% shorter`, scream: () => "Screams can't stun you",
  poison: () => "Hits poison", thorns: v => `Biters take ${v} back`, chain: v => `Every ${v}th hit jumps`, trail: () => "Frost trail", chillHit: () => "Hits slow 15%",
  shout: v => `Stunning scream every ${v}s`, aura: () => "Cold aura (20% slower)", burn: () => "Hits burn", flame: () => "Burning zombies +10% damage", fireRes: v => `Fire ${Math.round(v * 100)}% less`,
  fireproof: () => "Fireproof", groundFire: () => "Ground fire can't hurt you", phoenix: () => "Kills may burst into flame", pyreRing: v => `Fire ring when hit (every ${v}s)`, censer: () => "Skills burst a fire ring",
  light: () => "Light in the dark", gold: v => `+${Math.round(v * 100)}% gold from kills`, horn: v => `Stun spike every ${v}s`, runes: v => `Runes heal teammates ${v} HP/s`, block: v => `Blocks a hit every ${v}s`,
  reg: v => `Heal ${v} HP a second`, lavaRes: v => v >= 1 ? "Lava can't hurt you" : `Lava ${Math.round(v * 100)}% less`, molten: v => `Every ${v}th shot splashes`, heart: () => "Get back up once a match", crown: v => `+1 HP per 20 kills (up to +${v})`,
};
export const SOON = { hook: "Hook shot", larvae: "Friendly larvae", xray: "See through walls" };
export const STAT_KEYS = ["hp", "arm", "dmg", "mel", "rate", "spd", "cdr", "rng"];
export const ENH_STEP = 0.05;   // each + adds 5% of the base stats (+10 = +50%)
export const ENH = {   // next level: [success %, ore, ore count, gold]; +8..+10 on epics / legendaries also take 1 of that boss's essence. A fail uses the materials, the item keeps its level
  1: [100, "iron", 1, 50], 2: [95, "iron", 2, 100], 3: [90, "iron", 3, 150], 4: [85, "iron", 4, 200],
  5: [70, "silver", 1, 250], 6: [60, "silver", 2, 300], 7: [50, "silver", 3, 350],
  8: [40, "titanium", 1, 400], 9: [30, "titanium", 2, 450], 10: [20, "titanium", 3, 500],
};
export function enhanceCost(item, lvl) { const e = ENH[lvl + 1]; if (!e) return null; const c = { chance: e[0], gold: e[3], [e[1]]: e[2] }; if (item.t >= 8 && lvl + 1 >= 8) c["ess:" + item.boss] = 1; return c; }
export const MATS = {   // weight among the material drops, how many come in one stack
  gold: { name: "Gold", w: 40, n: [25, 75], use: "Every enhance costs gold" },
  iron: { name: "Iron Ore", w: 30, n: [1, 3], use: "Enhances gear from +1 to +4" },
  silver: { name: "Silver Ore", w: 17, n: [1, 2], use: "Enhances gear from +5 to +7" },
  titanium: { name: "Titanium Ore", w: 9, n: [1, 1], use: "Enhances gear from +8 to +10" },
  ess: { name: "Boss Essence", w: 4, n: [1, 1], use: "Enhances that boss's epics and legendaries from +8" },
};
export const matName = m => m.startsWith("ess:") ? (BOSSES[m.slice(4)]?.ess || "Boss Essence") : (MATS[m]?.name || m);
export const PILE = [10, 12], EPICS = [1, 2], MAT_SHARE = 0.5, RATIO = 0.75;
export const LOOT_LIFE = 30;   // seconds a burst item stays on the ground
// One boss kill's loot burst: [{ g: itemId } | { m: material, n }]. R = random 0..1
export function rollBurst(boss, R = Math.random) {
  const all = ITEMS.filter(it => it.boss === boss); if (!all.length) return [];
  const pick = list => list[Math.floor(R() * list.length) % list.length];
  const legs = all.filter(it => it.t === 10), epics = all.filter(it => it.t === 8 || it.t === 9), low = all.filter(it => it.t <= 7);
  const n = PILE[0] + Math.floor(R() * (PILE[1] - PILE[0] + 1)), ne = EPICS[0] + Math.floor(R() * (EPICS[1] - EPICS[0] + 1));
  const out = [{ g: pick(legs).id }]; for (let i = 0; i < ne; i++) out.push({ g: pick(epics).id });
  const lw = low.map(it => RATIO ** (it.t - 1)), lt = lw.reduce((a, b) => a + b, 0), mt = Object.values(MATS).reduce((a, m) => a + m.w, 0);
  while (out.length < n) {
    if (R() < MAT_SHARE) { let r = R() * mt, key = "gold"; for (const [k, m] of Object.entries(MATS)) { r -= m.w; if (r <= 0) { key = k; break; } }
      const M = MATS[key], amt = M.n[0] + Math.floor(R() * (M.n[1] - M.n[0] + 1)); out.push({ m: key === "ess" ? "ess:" + boss : key, n: amt }); }
    else { let r = R() * lt, it = low[0]; for (let i = 0; i < low.length; i++) { r -= lw[i]; if (r <= 0) { it = low[i]; break; } } out.push({ g: it.id }); }
  }
  return out;
}
export function itemStats(item, lvl = 0) {   // its stats at that + level
  const out = {}; for (const [k, v] of Object.entries(item.st)) out[k] = v + Math.round(v * ENH_STEP * lvl + 1e-9); return out;
}
// What a loadout adds up to: list = [{ id, l }] (one per slot). Unknown ids, bad levels and a second item for a slot are dropped.
export function gearTotals(list) {
  const st = {}, sp = {}, used = new Set(), items = [];
  for (const g of Array.isArray(list) ? list.slice(0, 12) : []) {
    const it = ITEM[g?.id]; const l = Math.round(Number(g?.l) || 0);
    if (!it || used.has(it.slot) || !(l >= 0 && l <= 10)) continue; used.add(it.slot); items.push({ id: it.id, l });
    for (const [k, v] of Object.entries(itemStats(it, l))) st[k] = (st[k] || 0) + v;
    for (const [k, v] of Object.entries(it.sp)) {
      if (k === "soon") continue;
      if (["slowRes", "stunRes", "fireRes", "lavaRes"].includes(k)) sp[k] = Math.min(1, (sp[k] || 0) + v);
      else if (typeof v === "number" && ["mheal", "reg", "prc", "gold", "thorns", "runes", "crit", "flame"].includes(k)) sp[k] = (sp[k] || 0) + v;
      else sp[k] = v;
    }
  }
  return { st, sp, items };
}
export const ARMOUR_PER = 0.015, ARMOUR_MAX = 0.4;   // each armour point = 1.5% less damage taken, at most 40%
export const armourCut = arm => Math.min(ARMOUR_MAX, Math.max(0, arm || 0) * ARMOUR_PER);
