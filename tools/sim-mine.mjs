// Play-test of The Deep Mine (site 6): zombies dropped all over the map must reach the tower; hunters must reach survivors standing in far
// corners; nobody ends up inside rock or the cordoned dungeon; the carts run laps and stop at both stations.
// Usage: node tools/sim-mine.mjs   (run tools/test-room.mjs first: it builds tools/dist/room-test.mjs)
import { fileURLToPath } from "node:url"; import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
const { SurvivalRoom } = await import(join(here, "dist/room-test.mjs"));
process.env.SA_QUIET = "1";
const room = new SurvivalRoom(); room.onCreate({}); room._onBroadcast = () => {};
const H = { sessionId: "H" }; room.onJoin(H, { name: "Host" }); const send = (c, t, d) => room._handlers[t](c, d);
room.fixedSite = true; room.loadSite(6); send(H, "start", {});   /* (Nov 12: no map choice in the lobby any more) */ const p = room.state.players.get("H");
let t = Date.now(); const tick = n => { for (let i = 0; i < n; i++) { t += 50; room.lastTick = t - 50; const real = Date.now; Date.now = () => t; try { room.tick(); } finally { Date.now = real; } p.hp = p.maxHp; p.alive = true; room.state.towerHp = 10000; room.spawnClock = 1e9; room.state.elapsed = 5; } };
const W = 6000, HH = 4000, K = room.cordon, inDun = (x, y) => x > K.x - 30 && y > K.y - 45, problems = [];
let seed = 99; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const openSpot = () => { for (;;) { const x = 60 + rnd() * (W - 120), y = 60 + rnd() * (HH - 120); if (!inDun(x, y) && !room.blockedByMap(x, y, 20)) return { x, y }; } };
const mk = (x, y, role) => { room.spawnZombie(); const z = [...room.state.zombies.values()].pop(); z.x = x; z.y = y; z.kind = "walker"; z.role = role; z.speed = 260; z.hp = 1e7; z.maxHp = 1e7; z.damage = 0; z._from = [Math.round(x), Math.round(y)]; return z; };
// 1. 240 zombies from random open spots all over the mine walk to the tower
room.state.zombies.clear(); p.x = room.A.cx + 60; p.y = room.A.cy + 120; const zs = []; for (let i = 0; i < 240; i++) { const s = openSpot(); zs.push(mk(s.x, s.y, "tower")); }
tick(20 * 45); let late = zs.filter(z => Math.hypot(z.x - room.A.cx, z.y - room.A.cy) > 420);
console.log(`1. tower-bound zombies: ${zs.length - late.length}/${zs.length} reached the tower in 45s`); for (const z of late.slice(0, 12)) console.log(`   STUCK from ${z._from} now at ${Math.round(z.x)},${Math.round(z.y)}`); if (late.length) problems.push(`${late.length} zombies never reached the tower`);
// 2. hunters reach a survivor standing in each far part of the map
for (const [name, x, y] of [["top right", 5600, 600], ["snake loop", 4300, 1700], ["bottom left", 500, 3300], ["bottom middle", 2800, 3500], ["north of the dungeon", 4800, 2500], ["west of the dungeon", 3700, 3400], ["cart station deck", 850, 460], ["by the shaft", 2450, 1300]]) {
  room.state.zombies.clear(); p.x = x; p.y = y; room.solveCollisions(p); const hs = []; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; let s = { x: room.A.cx + Math.cos(a) * 900, y: room.A.cy + Math.sin(a) * 900 }; if (room.blockedByMap(s.x, s.y, 20)) s = openSpot(); hs.push(mk(s.x, s.y, "hunter")); }
  const need = Math.hypot(x - room.A.cx, y - room.A.cy) / 260 * 2.2 + 12; tick(Math.round(20 * need)); const far = hs.filter(z => Math.hypot(z.x - p.x, z.y - p.y) > 160);
  console.log(`2. hunters to a survivor ${name} (${Math.round(p.x)},${Math.round(p.y)}): ${hs.length - far.length}/${hs.length} got there in ${Math.round(need)}s`); for (const z of far.slice(0, 4)) console.log(`   STUCK from ${z._from} now at ${Math.round(z.x)},${Math.round(z.y)} role ${z.role}`); if (far.length) problems.push(`${far.length} hunters never reached a survivor ${name}`);
}
// 3. a survivor inside the dungeon (got off at the boss stop): zombies leave them alone and go for the tower instead of piling at the wall
room.state.zombies.clear(); const bs = room.coaster.T.stations[1]; p.x = bs.x; p.y = bs.y - 150; (room.coaster.held ||= new Set()).add("H"); room.coaster.next = 1; room.coaster.s = bs.s; room.coaster.wait = 5;
const ws = []; for (let i = 0; i < 20; i++) { const s = openSpot(); ws.push(mk(s.x, s.y, i % 2 ? "hunter" : "tower")); } tick(20 * 50);
const atWall = ws.filter(z => Math.hypot(z.x - room.A.cx, z.y - room.A.cy) > 420);
console.log(`3. survivor in the dungeon: ${ws.length - atWall.length}/${ws.length} zombies went to the tower instead; survivor still inside: ${room.inCordon(p)}; carts holding: ${room.state.coasterWait}`); for (const z of atWall.slice(0, 5)) console.log(`   zombie from ${z._from} at ${Math.round(z.x)},${Math.round(z.y)} role ${z.role}`);
if (atWall.length) problems.push(`${atWall.length} zombies hung around while the only survivor was in the dungeon`); if (!room.inCordon(p)) problems.push("the survivor at the boss stop was thrown out of the dungeon");
// 4. the spawn ring: every spawn point is open ground outside the dungeon
room.coaster.held.clear(); p.x = room.A.cx; p.y = room.A.cy + 130; let badSp = 0; for (let i = 0; i < 2000; i++) { const s = room.spawnPoint(); if (room.blockedByMap(s.x, s.y, 10) || inDun(s.x, s.y)) badSp++; } console.log(`4. spawn points: ${badSp}/2000 inside rock or the dungeon`); if (badSp > 20) problems.push(`${badSp} bad spawn points`);
// 5. the carts: 3 laps, stopping at both stations each lap, never stuck
room.state.zombies.clear(); const C = room.coaster; let stops = [0, 0], last = -1, t0 = t; for (let i = 0; i < 20 * 260; i++) { tick(1); if (C.wait > 0 && last !== C.next) { stops[C.next]++; last = C.next; } if (!(C.wait > 0)) last = -1; }
console.log(`5. carts in 260s: ${stops[0]} stops at the station, ${stops[1]} at the boss stop`); if (stops[0] < 3 || stops[1] < 3) problems.push("the carts aren't lapping");
console.log(problems.length ? "MINE SIM PROBLEMS:\n - " + problems.join("\n - ") : "MINE SIM OK"); room._dispose?.(); process.exit(problems.length ? 1 : 0);
