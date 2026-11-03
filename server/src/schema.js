import { Schema, defineTypes } from "@colyseus/schema";

export class PlayerState extends Schema {}
defineTypes(PlayerState, {
  sessionId: "string", name: "string", x: "number", y: "number",
  hp: "number", maxHp: "number", level: "number", xp: "number",
  xpNext: "number", kills: "number", damage: "number", fireRate: "number",
  speed: "number", defence: "number", alive: "boolean", ready: "boolean",
  characterClass: "string", abilityCooldown: "number", bleedout: "number", weapon: "string", melee: "string", ammo: "number", currency: "number",
  killLeadSince: "number", bossDamage: "number", revives: "number", damageDealt: "number",
  damageTaken: "number", towerRepairs: "number", structuresBuilt: "number",
  bonusDamage: "number", rateMult: "number", buffDamage: "number", aim: "number", facing: "number", bledOut: "boolean", owned: "string", armor: "number", isBot: "boolean",
  primary: "string", secondary: "string", activeSlot: "number", mag: "number", magSize: "number", reloadLeft: "number", medkits: "number",
  isHost: "boolean", color: "string", reviveProgress: "number", charging: "boolean", stunned: "number", slowed: "number", ultKills: "number", ultCd: "number", ultReady: "boolean", ultActive: "number", shadow: "number", fire: "number", storm: "number", katanaKills: "number", robotCharges: "number", chargeCd: "number", skillT: "number"
});

export class ZombieState extends Schema {}
defineTypes(ZombieState, {
  id: "string", kind: "string", x: "number", y: "number", hp: "number",
  maxHp: "number", speed: "number", damage: "number", radius: "number",
  attackCooldown: "number", targetId: "string", boss: "boolean", role: "string", slam: "number",
  act: "string", actLen: "number", aim: "number", hookId: "string", hookD: "number", enraged: "boolean", burn: "number" });

export class LootState extends Schema {}
defineTypes(LootState, { id: "string", kind: "string", x: "number", y: "number", amount: "number", rarity: "string" });

export class StructureState extends Schema {}
defineTypes(StructureState, {
  id: "string", kind: "string", x: "number", y: "number",
  hp: "number", maxHp: "number", ownerId: "string", aim: "number", deploy: "number"
});
// Viktor's combat robots (his ultimate)
export class RobotState extends Schema {}
defineTypes(RobotState, { id: "string", kind: "string", x: "number", y: "number", hp: "number", maxHp: "number", ownerId: "string", aim: "number", act: "string", hx: "number", hy: "number", uses: "number", face: "number", tgt: "string" });

// Sofea's tank / helicopter (one per Sofea, id = her sessionId). phase: "call" (radio call) then "ride".
export class VehicleState extends Schema {}
defineTypes(VehicleState, { id: "string", kind: "string", phase: "string", x: "number", y: "number", hull: "number", aim: "number", left: "number", mv: "boolean", shots: "number" });

// A spitter's acid puddle on the ground (hurts survivors standing in it).
export class PuddleState extends Schema {}
defineTypes(PuddleState, { id: "string", x: "number", y: "number", r: "number", life: "number", maxLife: "number" });

export class GameState extends Schema {}
defineTypes(GameState, {
  players: { map: PlayerState }, zombies: { map: ZombieState }, structures: { map: StructureState }, loot: { map: LootState }, puddles: { map: PuddleState }, robots: { map: RobotState }, vehicles: { map: VehicleState },
  stage: "number", elapsed: "number", stageDuration: "number",
  bossSpawned: "boolean", bossDead: "boolean", phase: "string",
  roomCode: "string", hostId: "string", message: "string", totalKills: "number",
  towerHp: "number", towerMaxHp: "number", scrap: "number", electronics: "number",
  explosives: "number", fuel: "number", dayTime: "number", isNight: "boolean",
  generatorHp: "number", generatorMaxHp: "number", generatorFuel: "number",
  waveType: "string", remaining: "number", matchTime: "number", countdown: "number", worldW: "number", worldH: "number", explore: "boolean", mapLayout: "string",
  bossPhase: "string", bossIntro: "string", introNeed: "number", introReady: "number", hookSpeed: "number", noCd: "boolean",
  mapSite: "number", difficulty: "string", waveMode: "string", friendlyFire: "boolean", extraLoot: "boolean"   // lobby mission settings (host)
});
