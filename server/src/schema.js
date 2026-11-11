import { Schema, defineTypes } from "@colyseus/schema";

export class PlayerState extends Schema {}
defineTypes(PlayerState, {
  sessionId: "string", name: "string", x: "float32", y: "float32",
  hp: "number", maxHp: "number", level: "number", xp: "number",
  xpNext: "number", kills: "number", damage: "number", fireRate: "number",
  speed: "number", defence: "number", alive: "boolean", ready: "boolean",
  characterClass: "string", abilityCooldown: "number", bleedout: "number", weapon: "string", melee: "string", ammo: "number", currency: "number",
  killLeadSince: "number",
  aim: "number", facing: "number", bledOut: "boolean", owned: "string", armor: "number", isBot: "boolean",
  primary: "string", secondary: "string", activeSlot: "number", mag: "number", reloadLeft: "number", medkits: "number",
  isHost: "boolean", color: "string", charging: "boolean", stunned: "number", slowed: "number", ultKills: "number", ultCd: "number", ultReady: "boolean", ultActive: "number", shadow: "number", fire: "number", storm: "number", katanaKills: "number", robotCharges: "number", chargeCd: "number", skillT: "number",
  ride: "number", rideCd: "number",   // Midnight Carnival coaster: seat number + 1 while riding; seconds until they can ride again
  ack: "number",   // last movement input the server applied (client-side prediction replays the ones after it)
  cdr: "number",   // skill cooldown reduction from level-up upgrades (0 .. 0.6)
  hands: "number",   // Fast Hands picks (0..5): +15% reload speed, +20% magazine each
  reloadTotal: "number",   // length of the current reload (s), for the reload bar
  armorPct: "number",   // Body Armour: damage taken reduced by this fraction (0 .. 0.64)
  stats: "string"   // scoreboard numbers packed (server keeps them as plain props): bossDamage|revives|towerRepairs|structuresBuilt|damageDealt|damageTaken
});
// HARD LIMIT: a Schema class may have at most 64 synced fields. Field 65+ silently corrupts every patch it is in (Nov 10-11: armorPct was field 65 -> players invisible / frozen online). index.js checks this at boot and the tests check it too.
export function schemaFieldCounts() { const out = {}; for (const [k, C] of Object.entries({ PlayerState, ZombieState, LootState, StructureState, RobotState, VehicleState, PuddleState, GameState })) out[k] = Object.keys(C[Symbol.metadata] || {}).filter(x => !isNaN(+x)).length; return out; }
// Server-only player numbers (not sent to browsers): bonusDamage, rateMult, buffDamage, magSize, reviveProgress.

export class ZombieState extends Schema {}
defineTypes(ZombieState, {
  id: "string", kind: "string", x: "float32", y: "float32", hp: "number",
  maxHp: "number", speed: "number", damage: "number", radius: "number",
  attackCooldown: "number", targetId: "string", boss: "boolean", role: "string", slam: "number",
  act: "string", actLen: "number", aim: "number", hookId: "string", hookD: "number", enraged: "boolean", burn: "number" });

export class LootState extends Schema {}
defineTypes(LootState, { id: "string", kind: "string", x: "number", y: "number", amount: "number", rarity: "string" });

export class StructureState extends Schema {}
defineTypes(StructureState, {
  id: "string", kind: "string", x: "number", y: "number",
  hp: "number", maxHp: "number", ownerId: "string", aim: "number", deploy: "number", life: "number",   // life: seconds left (Astra's safehouse)
  fire: "boolean"   // turret: shooting right now (aim = at its target)
});
// Viktor's combat robots (his ultimate)
export class RobotState extends Schema {}
defineTypes(RobotState, { id: "string", kind: "string", x: "float32", y: "float32", hp: "number", maxHp: "number", ownerId: "string", aim: "number", act: "string", hx: "number", hy: "number", uses: "number", face: "number", tgt: "string" });

// Sofea's tank / helicopter (one per Sofea, id = her sessionId). phase: "call" (radio call) then "ride".
export class VehicleState extends Schema {}
defineTypes(VehicleState, { id: "string", kind: "string", phase: "string", x: "float32", y: "float32", hull: "number", aim: "number", left: "number", mv: "boolean", shots: "number", fire: "boolean" });   // fire: helicopter gun firing (held mouse)

// A spitter's acid puddle on the ground (hurts survivors standing in it).
export class PuddleState extends Schema {}
defineTypes(PuddleState, { id: "string", x: "number", y: "number", r: "number", life: "number", maxLife: "number" });

// Server-only game numbers (not sent): stageDuration, bossSpawned, bossDead, roomCode, dayTime, remaining, matchTime.
export class GameState extends Schema {}
defineTypes(GameState, {
  players: { map: PlayerState }, zombies: { map: ZombieState }, structures: { map: StructureState }, loot: { map: LootState }, puddles: { map: PuddleState }, robots: { map: RobotState }, vehicles: { map: VehicleState },
  stage: "number", elapsed: "number", phase: "string",
  hostId: "string", message: "string", totalKills: "number",
  towerHp: "number", towerMaxHp: "number", scrap: "number", electronics: "number",
  explosives: "number", fuel: "number", isNight: "boolean",
  generatorHp: "number", generatorMaxHp: "number", generatorFuel: "number",
  waveType: "string", countdown: "number", worldW: "number", worldH: "number", towerX: "number", towerY: "number", explore: "boolean", mapLayout: "string",
  bossPhase: "string", bossIntro: "string", introNeed: "number", introReady: "number", hookSpeed: "number", noCd: "boolean",
  mission: "string",   // the Deep Mine mission (wave 20), packed: step|fuel|placed|cartHp|gap|inserted|rune,rune,rune,rune (each: state.x.y.carrier); "" = no mission
  coasterS: "number", coasterWait: "number",   // the coaster train: how far round the loop its middle is; seconds left at a station (0 = moving)
  mapSite: "number", difficulty: "string", waveMode: "string", friendlyFire: "boolean", extraLoot: "boolean"   // lobby mission settings (host)
});
