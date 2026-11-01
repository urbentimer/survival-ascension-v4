import { Schema, MapSchema, defineTypes } from "@colyseus/schema";

export class PlayerState extends Schema {}
defineTypes(PlayerState, {
  sessionId: "string", name: "string", x: "number", y: "number",
  hp: "number", maxHp: "number", level: "number", xp: "number",
  xpNext: "number", kills: "number", damage: "number", fireRate: "number",
  speed: "number", defence: "number", alive: "boolean", ready: "boolean",
  characterClass: "string", abilityCooldown: "number", bleedout: "number", weapon: "string", melee: "string", ammo: "number", currency: "number",
  killLeadSince: "number", bossDamage: "number", revives: "number", damageDealt: "number",
  damageTaken: "number", towerRepairs: "number", structuresBuilt: "number", headshots: "number",
  isHost: "boolean", color: "string", lastShot: "number", reviveProgress: "number", reviveTargetId: "string"
});

export class ZombieState extends Schema {}
defineTypes(ZombieState, {
  id: "string", kind: "string", x: "number", y: "number", hp: "number",
  maxHp: "number", speed: "number", damage: "number", radius: "number",
  attackCooldown: "number", targetId: "string", boss: "boolean"
});

export class LootState extends Schema {}
defineTypes(LootState, { id: "string", kind: "string", x: "number", y: "number", amount: "number", rarity: "string" });

export class StructureState extends Schema {}
defineTypes(StructureState, {
  id: "string", kind: "string", x: "number", y: "number",
  hp: "number", maxHp: "number", ownerId: "string"
});

export class GameState extends Schema {}
defineTypes(GameState, {
  players: { map: PlayerState }, zombies: { map: ZombieState }, structures: { map: StructureState }, loot: { map: LootState },
  stage: "number", elapsed: "number", stageDuration: "number",
  bossSpawned: "boolean", bossDead: "boolean", phase: "string",
  roomCode: "string", hostId: "string", message: "string", totalKills: "number",
  towerHp: "number", towerMaxHp: "number", scrap: "number", electronics: "number",
  explosives: "number", fuel: "number", dayTime: "number", isNight: "boolean",
  generatorHp: "number", generatorMaxHp: "number", generatorFuel: "number",
  waveType: "string", remaining: "number", matchTime: "number"
});
