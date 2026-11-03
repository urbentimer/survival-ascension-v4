// Stress test: a team of AI bots (one of each class + forced new ones) plays waves 1..N fast-forwarded.
// Fails on any exception, NaN / missing numbers in the game state, or a stuck wave.
// Usage: node tools/sim-waves.mjs [lastWave=9]   (run tools/test-room.mjs first: it builds tools/dist/room-test.mjs)
import { fileURLToPath } from "node:url"; import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const { SurvivalRoom } = await import(join(here, "dist/room-test.mjs"));
const LAST = Number(process.argv[2] || 9);
const room = new SurvivalRoom(); room.onCreate({}); const seenEv = {}; room._onBroadcast = (type, m) => { const k = type + (m?.k ? ":" + m.k : ""); seenEv[k] = (seenEv[k] || 0) + 1; };
const H = { sessionId: "H" }; room.onJoin(H, { name: "Host" });
const send = (c, t, d) => room._handlers[t](c, d);
for (let i = 0; i < 7; i++) send(H, "addBot");
const classes = ["engineer", "scout", "demolitionist", "assault", "medic", "juggernaut", "sniper", "commander"]; let ci = 0;
for (const p of room.state.players.values()) { p.characterClass = classes[ci++ % classes.length]; }
const host = room.state.players.get("H"); host.isBot = true; room.botBrain.set("H", { strafe: 1, nextThink: 0 });
send(H, "start", {});
const bad = [];
function scan(tag) {
  for (const [what, map] of [["player", room.state.players], ["zombie", room.state.zombies], ["robot", room.state.robots], ["structure", room.state.structures]])
    for (const e of map.values()) for (const k of ["x", "y", "hp"]) if (e[k] !== undefined && !Number.isFinite(e[k])) bad.push(`${tag}: ${what} ${e.id || e.sessionId} ${e.kind || e.characterClass} ${k}=${e[k]}`);
}
let t = Date.now(); const stats = {};
for (let wave = 1; wave <= LAST; wave++) {
  let ticks = 0;
  while (room.state.phase === "playing" && ticks < 20 * 600) {
    t += 50; room.lastTick = t - 50; const real = Date.now; Date.now = () => t;
    try { room.tick(); } catch (e) { Date.now = real; console.log(`CRASH wave ${room.state.stage}:`, e.stack.split("\n").slice(0, 4).join(" | ")); process.exit(1); }
    Date.now = real;
    for (const p of room.state.players.values()) { if (!p.alive && p.bleedout > 0) { p.alive = true; p.hp = p.maxHp; } p.hp = Math.max(p.hp, p.maxHp * .5); }   // keep the team alive so every wave plays out
    room.state.towerHp = Math.max(room.state.towerHp, 2000);
    if (ticks % 40 === 0) scan(`wave ${room.state.stage}`);
    if (room.state.waveType === "boss" && room.state.bossPhase === "intro") for (const p of room.state.players.values()) send({ sessionId: p.sessionId }, "ackBoss");
    if (room.state.waveType === "boss" && room.state.bossPhase === "fight" && ticks > 20 * 120) for (const z of room.state.zombies.values()) if (z.boss) room.hitZombie(z, host, 1e6);
    ticks++;
  }
  const kinds = {}; stats[wave] = { phase: room.state.phase, secs: Math.round(ticks / 20), kills: room.state.totalKills };
  console.log(`wave ${wave}: ${room.state.phase} after ${Math.round(ticks / 20)}s game time, total kills ${room.state.totalKills}, robots ${room.state.robots.size}, ult kills ${[...room.state.players.values()].map(p => p.characterClass[0] + (p.ultKills ?? "-")).join(" ")}`);
  if (room.state.phase !== "cleared") { bad.push(`wave ${wave} ended as ${room.state.phase}`); break; }
  send(H, "nextStage");
  if (room.state.phase !== "playing") { room.state.countdown = 0; for (let i = 0; i < 5 && room.state.phase !== "playing"; i++) { t += 100; room.lastTick = t - 100; const real = Date.now; Date.now = () => t; room.tick(); Date.now = real; } }
}
console.log("events:", Object.entries(seenEv).filter(([k]) => /hive|demo|sky|shadow|wreck|summon|zdead/.test(k)).map(([k, v]) => k + "=" + v).join(" "));
console.log(bad.length ? "PROBLEMS:\n" + [...new Set(bad)].slice(0, 20).join("\n") : "SIM OK: no crashes, no NaN");
room._dispose?.(); process.exit(bad.length ? 1 : 0);
