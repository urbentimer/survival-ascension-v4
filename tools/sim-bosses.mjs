// Real boss fights: a bot squad plays every boss wave with NO damage hacks (sim-waves finishes bosses with hitZombie 1e6 after 2 min).
// Reports whether the bots kill each boss, how long it takes, downs, and fails on a crash, NaN or a fight that never ends.
// Usage: node tools/sim-bosses.mjs [waves=4,8,...,48,50]   (SA_BOTS=n bots, default 7; SA_LEVEL=n gives every bot that many level-ups first)
// Run tools/test-room.mjs first: it builds tools/dist/room-test.mjs.
import { fileURLToPath } from "node:url"; import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url));
process.env.SA_QUIET = process.env.SA_QUIET ?? "1";   // before the import: the logbook reads it at load
const { SurvivalRoom } = await import(join(here, "dist/room-test.mjs"));
const WAVES = (process.argv[2] || "4,8,12,16,20,24,28,32,36,40,44,48,50").split(",").map(Number);
const BOTS = Number(process.env.SA_BOTS ?? 7), LEVEL = Number(process.env.SA_LEVEL ?? 0), LIMIT = 20 * 60 * 10;   // 10 min of game time per boss
const classes = ["engineer", "scout", "demolitionist", "assault", "juggernaut", "dispatcher", "operator", "sniper"];
const bad = [], rows = [];
for (const wave of WAVES) {
  const room = new SurvivalRoom(); room.onCreate({}); room._onBroadcast = () => {};
  const H = { sessionId: "H" }; room.onJoin(H, { name: "Host" }); const send = (c, t, d) => room._handlers[t](c, d);
  for (let i = 0; i < BOTS; i++) send(H, "addBot");
  let ci = 0; for (const p of room.state.players.values()) p.characterClass = classes[ci++ % classes.length];
  const host = room.state.players.get("H"); host.isBot = true; room.botBrain.set("H", { strafe: 1, nextThink: 0 });
  send(H, "start", {});
  for (const p of room.state.players.values()) for (let l = 0; l < LEVEL; l++) { p.xp = p.xpNext; room.applyUpgrade?.(p, "damage"); }   // a bit of progression (optional)
  room.jumpToWave(wave);
  let t = Date.now(), ticks = 0, downs = 0, bossAt = -1, boss = null, kind = room.bossKind(), peak = 0; const tickMs = [];
  const wasDown = new Set();
  while (room.state.phase === "playing" && ticks < LIMIT) {
    t += 50; room.lastTick = t - 50; const real = Date.now; Date.now = () => t;
    const c0 = performance.now(); try { room.tick(); } catch (e) { Date.now = real; console.log(`CRASH boss wave ${wave} (${kind}):`, e.stack.split("\n").slice(0, 4).join(" | ")); process.exit(1); }
    Date.now = real; tickMs.push(performance.now() - c0);
    for (const p of room.state.players.values()) {   // keep the squad fighting (we're measuring the boss, not the bots' survival), but count the downs
      if (!p.alive) { if (!wasDown.has(p.sessionId)) { downs++; wasDown.add(p.sessionId); } if (p.bleedout > 0) { p.alive = true; p.hp = p.maxHp; } } else wasDown.delete(p.sessionId);
      p.hp = Math.max(p.hp, p.maxHp * .4);
      for (const k of ["x", "y", "hp"]) if (!Number.isFinite(p[k])) bad.push(`wave ${wave}: player ${p.name} ${k}=${p[k]}`);
    }
    room.state.towerHp = Math.max(room.state.towerHp, 2000);
    if (room.state.bossPhase === "horde" && ticks > 20 * 50) { room.state.elapsed = Math.max(room.state.elapsed, 46); for (const z of room.state.zombies.values()) if (!z.boss) z.hp = 0; }   // the horde isn't the point: clear it after 50s
    if (room.state.bossPhase === "intro") for (const p of room.state.players.values()) send({ sessionId: p.sessionId }, "ackBoss");
    const b = [...room.state.zombies.values()].find(z => z.boss); if (b) { boss = b; if (bossAt < 0) bossAt = ticks; peak = Math.max(peak, b.maxHp); for (const k of ["x", "y", "hp"]) if (!Number.isFinite(b[k])) bad.push(`wave ${wave}: boss ${k}=${b[k]}`); }
    ticks++;
  }
  const fight = bossAt < 0 ? 0 : (ticks - bossAt) / 20, w = tickMs.sort((a, b) => a - b), p99 = w[Math.floor(w.length * .99)] || 0;
  const left = boss && room.state.zombies.has(boss.id) ? Math.round(boss.hp / boss.maxHp * 100) : 0;
  const okFight = room.state.phase !== "playing" && room.state.bossDead;
  rows.push(`wave ${String(wave).padStart(2)} ${kind.padEnd(12)} ${okFight ? "KILLED" : "NOT KILLED"} in ${Math.round(fight)}s of fighting (boss hp ${Math.round(peak)}), downs ${downs}, ended as ${room.state.phase}${left ? `, ${left}% hp left` : ""}, tick p99 ${p99.toFixed(1)}ms`);
  if (!okFight) bad.push(`wave ${wave} (${kind}): boss not killed in ${Math.round(fight)}s (${left}% left, phase ${room.state.phase}, bossPhase ${room.state.bossPhase})`);
  room._dispose?.();
}
console.log(rows.join("\n"));
console.log(bad.length ? "PROBLEMS:\n" + [...new Set(bad)].slice(0, 20).join("\n") : "BOSS SIM OK: every boss died to the bots, no crashes, no NaN");
process.exit(bad.length ? 1 : 0);
