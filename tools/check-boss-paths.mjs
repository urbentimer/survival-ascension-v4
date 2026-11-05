// Butcher path check: puts him next to every building with a player on the other side; he must reach them within 15s (game time).
//   node tools/test-room.mjs (builds dist/room-test.mjs) then: node tools/check-boss-paths.mjs
import { build } from "esbuild"; import { fileURLToPath } from "node:url"; import { dirname, join } from "node:path";
process.env.SA_QUIET = "1";
let fake = 1.8e12; Date.now = () => fake;   // game time: 50ms per tick
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { SurvivalRoom } = await import(join(here, "dist/room-test.mjs"));
const room = new SurvivalRoom(); room.onCreate({ site: 0 }); room._onBroadcast = () => {};
const A = { sessionId: "A" }; room.onJoin(A, { name: "H" }); room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear();
const p = room.state.players.get("A"); p.hp = p.maxHp = 1e6;
const boxes = new Set(); for (const v of room.mapGrid.values()) for (const b of v) if (b.hw > 40 && b.hh > 30) boxes.add(b);
let stuckCases = 0, n = 0;
for (const b of [...boxes]) for (const side of [0, 1, 2, 3]) {
  room.state.zombies.clear(); room.bossMem.clear(); room.steer.clear();
  room.spawnZombie(true, "butcher"); const z = [...room.state.zombies.values()].pop(); z.hp = z.maxHp = 1e9;
  const sx = [1, -1, 0, 0][side], sy = [0, 0, 1, -1][side];
  z.x = b.x + sx * (b.hw + 30); z.y = b.y + sy * (b.hh + 30); p.x = b.x - sx * (b.hw + 120); p.y = b.y - sy * (b.hh + 120);
  if (room.blockedByMap(z.x, z.y, 20) || room.blockedByMap(p.x, p.y, 14) || p.x < 40 || p.y < 40 || p.x > 3560 || p.y > 2240 || z.x < 40 || z.y < 40 || z.x > 3560 || z.y > 2240) continue;
  n++; const start = Math.hypot(p.x - z.x, p.y - z.y); let minD = start, still = 0, lx = z.x, ly = z.y;
  for (let i = 0; i < 300; i++) { room.state.elapsed = 10; room.state.phase = "playing"; fake += 50; room.lastTick = fake - 50; room.tick(); p.x = b.x - sx * (b.hw + 120); p.y = b.y - sy * (b.hh + 120); p.hp = 1e6; p.alive = true; p.stunned = 0;
    const d = Math.hypot(p.x - z.x, p.y - z.y); minD = Math.min(minD, d); if (!z.act && Math.hypot(z.x - lx, z.y - ly) < .5) still++; lx = z.x; ly = z.y; }
  const f = room.flowField(p, 27.2), C = 40, cx = Math.floor(z.x / C), cy = Math.floor(z.y / C); let reach = false;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const k = (cy + dy) * f.GW + cx + dx; if (k >= 0 && k < f.dist.length && f.dist[k] < Infinity) reach = true; }
  if (minD > 180 && !reach) { n--; continue; }   // walled-in spot: no path exists at all
  if (minD > 180) { stuckCases++; if (stuckCases < 6) console.log(`stuck: box ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.hw*2)}x${Math.round(b.hh*2)} side ${side}: closest ${Math.round(minD)} (start ${Math.round(start)}), still ticks ${still}, act=${z.act}`); }
}
console.log(`${stuckCases} / ${n} cases the Butcher never got to the player in 15s`); process.exit(0);
