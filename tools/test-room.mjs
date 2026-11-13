// Controlled server test: runs SurvivalRoom directly (no network) and places zombies by hand.
// Usage: node tools/test-room.mjs   (bundles the room first with esbuild)
import { build } from "esbuild";
process.env.SA_QUIET = "1";   // no game-log lines in the test output
import { fileURLToPath } from "node:url"; import { dirname, join } from "node:path";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const out = join(here, "dist/room-test.mjs");
await build({ entryPoints: [join(root, "server/src/SurvivalRoom.js")], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "warning",
  plugins: [{ name: "shim", setup(b) { b.onResolve({ filter: /^@colyseus\/core$/ }, () => ({ path: join(here, "solo/room-shim.js") }));
    b.onResolve({ filter: /^@colyseus\/schema$/ }, () => ({ path: join(root, "server/node_modules/@colyseus/schema/build/esm/index.mjs") })); } }] });
const { SurvivalRoom } = await import(out);
const { ZombieState } = await import(out).then(() => import(join(root, "server/node_modules/@colyseus/schema/build/esm/index.mjs"))).then(() => ({}));
let fails = 0; const ok = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); if (!cond) fails++; };
const W = ms => new Promise(r => setTimeout(r, ms));

function makeRoom(withMap = false) {
  const room = new SurvivalRoom(); room.onCreate({ site: 0 }); room.state.noCd = false;   // tests check the real cooldowns
  room.fixedSite = true;   // (Nov 12) most tests stay on one map: the map order (moving on after each boss) has its own test
  if (!withMap) room.mapGrid = new Map();   // most tests use an empty map (fixed test positions may sit inside buildings)
  const events = []; room._onBroadcast = (type, m) => events.push({ type, ...m });
  const A = { sessionId: "A" }, B = { sessionId: "B" };
  room.onJoin(A, { name: "Host" }); room.onJoin(B, { name: "Friend" });
  room._handlers.start(A, {});
  room.spawnClock = 9999; room.state.zombies.clear(); // no random spawns
  return { room, events, A, B, send: (c, t, d) => room._handlers[t](c, d), P: c => room.state.players.get(c.sessionId) };
}
function placeZombie(room, x, y, hp = 500) {
  room.spawnZombie(false); const z = [...room.state.zombies.values()].pop();
  z.x = x; z.y = y; z.hp = z.maxHp = hp; z.speed = 0; z.damage = 0; return z;
}
const freeze = (P) => { P.x = 600; P.y = 380; };

// 0. the client's copy of the map layout (used for movement prediction) must match the server's
{ const { readFileSync } = await import("node:fs");
  ok(readFileSync(join(root, "server/src/mapLayout.js"), "utf8") === readFileSync(join(root, "client/mapLayout.js"), "utf8"), "client/mapLayout.js is identical to server/src/mapLayout.js"); }

// 1. facing from movement
{ const { room, A, send, P } = makeRoom(); freeze(P(A));
  send(A, "input", { dx: -1, dy: 0 }); ok(P(A).facing === -1, "walking left flips character to face left");
  send(A, "input", { dx: 1, dy: 0 }); ok(P(A).facing === 1, "walking right faces right");
  await W(300); P(A).lastShot = 0; placeZombie(room, 450, 380);
  send(A, "shoot", { a: Math.PI }); ok(P(A).facing === -1, "standing still + shooting left turns to face the aim");
  room._dispose(); }

// 1b. queued movement (the real client sends s + dt): applied at a steady rate in the tick, ack follows what was applied
{ const { room, A, send, P } = makeRoom(); const p = P(A); freeze(p); p.x = 600; p.y = 600; const x0 = p.x, sp = p.speed;
  const T = () => { room.lastInputs.set("A", Date.now() - 50); room.lastTick = Date.now() - 50; room.tick(); };   // one tick, 50ms of real time
  for (let s = 1; s <= 3; s++) send(A, "input", { dx: 1, dy: 0, s, dt: 50 });   // 3 inputs arrive at once (network bunching)
  ok(p.x === x0 && (p.ack || 0) === 0, "queued inputs don't move you until the tick");
  T(); ok(Math.abs(p.x - x0 - sp * .05) < 1 && p.ack === 1, `one tick applies one input's worth (${Math.round(p.x - x0)}px, ack ${p.ack})`);
  T(); ok(p.ack === 2, "next tick: the next input"); T();
  ok(p.ack === 3 && Math.abs(p.x - x0 - sp * .15) < 2, `all 3 applied, total = 150ms of walking (${Math.round(p.x - x0)}px)`);
  for (let s = 4; s <= 9; s++) send(A, "input", { dx: 1, dy: 0, s, dt: 50 }); T(); ok(p.ack === 5, `fallen behind: catches up faster (ack ${p.ack})`);
  T(); T(); T(); T(); room.lastDashAt.clear(); send(A, "input", { dx: 0, dy: 1, s: 10, dt: 50 }); send(A, "dash", { dx: 0, dy: 1, s: 11 }); const y0 = p.y;
  T(); ok(p.ack === 11 && p.y - y0 > 55, "a dash queued behind a step goes in the same tick, in order");
  room._dispose(); }

// 2. aimed shots per weapon
for (const w of ["pistol", "smg", "rifle", "shotgun", "sniper", "launcher"]) {
  const { room, events, A, send, P } = makeRoom(); const p = P(A); freeze(p);
  p.owned = "pistol,smg,rifle,shotgun,sniper,launcher"; send(A, "weapon", { id: w });
  const z1 = placeZombie(room, 700, 380), z2 = placeZombie(room, 760, 380), z3 = placeZombie(room, 820, 380), side = placeZombie(room, 600, 250);
  const flush = () => { for (const e of room.ripples) e.t -= 5000; room.lastTick = Date.now() - 50; room.tick(); };   // rockets explode after flying
  p.lastShot = 0; send(A, "shoot", { a: 0, d: 120 }); flush();
  const hit = [z1, z2, z3].map(z => Math.round(500 - z.hp));
  p.lastShot = 0; const sideBefore = side.hp; send(A, "shoot", { a: Math.PI, d: 120 }); flush();
  const backwards = Math.round(sideBefore - side.hp) + [z1, z2, z3].reduce((s, z) => s, 0);
  console.log(`      ${w.padEnd(8)} hits along line: ${hit.join(" / ")}   ammo left ${p.ammo}`);
  if (w === "sniper") ok(hit[0] > 0 && hit[1] > 0 && hit[2] > 0, "sniper pierces through 3 zombies in a line");
  else if (w === "shotgun") ok(hit[0] > 0 && hit[1] > 0 && hit[2] === 0, "shotgun pellets pierce 2 zombies in a line, not 3");
  else if (w === "launcher") ok(hit[0] > 0 && hit[1] > 0 && hit[2] === 0 && events.some(e => e.type === "boom"), "launcher rocket flies to the aimed spot and explodes there, hitting everything within 80px");
  else ok(hit[0] > 0 && hit[1] === 0, `${w} hits only the first zombie in the line`);
  ok(backwards === 0, `${w}: shooting the opposite way misses`);
  room._dispose(); }
{ const { room, A, send, P } = makeRoom(); const p = P(A); freeze(p); p.owned += ",shotgun"; send(A, "weapon", { id: "shotgun" });
  const zs = [placeZombie(room, 760, 330), placeZombie(room, 780, 380), placeZombie(room, 760, 430)];
  p.lastShot = 0; send(A, "shoot", { a: 0 }); ok(zs.filter(z => z.hp < 500).length >= 2, "shotgun cone hits several zombies spread out in front");
  { const W = room.state.zombies; W.clear(); const mk = (x, y) => { room.spawnZombie(false, "walker"); const z = [...W.values()].pop(); z.x = x; z.y = y; z.hp = z.maxHp = 5000; z.speed = 0; return z; };
    const close = mk(p.x + 60, p.y), behind = mk(p.x + 90, p.y); p.lastShot = 0; p.mag = 6; send(A, "shoot", { a: 0 });
    const dClose = 5000 - close.hp; ok(dClose >= p.damage * 5 - .01 && behind.hp < 5000, `point blank: all 5 pellets at full damage (${Math.round(dClose)}) and they pierce into the zombie behind`);
    W.clear(); const far = mk(p.x + 370, p.y); p.lastShot = 0; p.mag = 6; send(A, "shoot", { a: 0 }); const dFar = 5000 - far.hp;
    ok(dFar > 0 && dFar < p.damage * 5 * .6, `reaches 370px (was 260), about half damage per pellet out there (${Math.round(dFar)})`); }
  room._dispose(); }
{ const { room, events, A, send, P } = makeRoom(); const p = P(A); freeze(p); placeZombie(room, 700, 380); const ammo = p.ammo;
  p.lastShot = 0; send(A, "shoot", {}); p.lastShot = 0; send(A, "shoot", { a: "oops" });
  ok(p.ammo === ammo && !events.length, "shots without a valid aim are ignored (no ammo used)");
  send(A, "shoot", { a: 0 }); send(A, "shoot", { a: 0 }); ok(events.length === 1, "fire-rate limit still applies to aimed shots");
  room._dispose(); }

// 3. dash
{ const { room, A, send, P } = makeRoom(); const p = P(A); freeze(p);
  p.x = 300; p.y = 600; send(A, "dash", { dx: 1, dy: 0 }); ok(Math.round(p.x - 300) === 140, `dash moves 140px (${Math.round(p.x - 300)})`); const x = p.x;
  send(A, "dash", { dx: 1, dy: 0 }); ok(p.x === x, "dash has a cooldown");
  room.lastDashAt.set("A", Date.now() - 4000); send(A, "dash", { dx: 1, dy: 0 }); ok(p.x === x, "still on cooldown after 4s");
  room.lastDashAt.set("A", Date.now() - 5100); send(A, "dash", { dx: 1, dy: 0 }); ok(p.x > x, "ready again after 5s"); room._dispose(); }

// 4. countdown between waves
{ const { room, A, send, P } = makeRoom(); for (let i = 0; i < 4; i++) room.spawnZombie(false, "walker"); room.state.elapsed = 90; room.lastTick = Date.now() - 50; room.tick();
  ok(room.state.phase === "cleared" && room.state.zombies.size === 0, "wave ends after 90s: every zombie left dies");
  { const p = P(A); p.x = room.A.cx - 60; p.y = room.A.cy + 230; const x0 = p.x; room.mapBoxesNear = () => [];   /* below the tower + generator: a random start beside them made this flaky */ for (let i = 0; i < 6; i++) { send(A, "input", { dx: 1, dy: 0 }); room.lastInputs.set("A", Date.now() - 50); }
    ok(p.x > x0 + 20, `the break: you can walk around (moved ${Math.round(p.x - x0)}px)`); }
  room.lastTick = Date.now() - 50; room.tick(); ok(room.state.countdown > 59 && room.state.countdown <= 60, "break: up to 60s (shop open)");
  for (let i = 0; i < 20; i++) { room.lastTick = Date.now() - 100; room.tick(); } ok(room.state.phase === "cleared", "nobody ready: still on break after 2s");
  send(A, "breakReady", { on: true }); room.lastTick = Date.now() - 100; room.tick(); ok(room.state.phase === "cleared" && room.state.countdown > 50, "one of two ready: still waiting");
  send({ sessionId: "B" }, "breakReady", { on: true }); room.lastTick = Date.now() - 100; room.tick(); ok(room.state.countdown <= 3, `everyone ready: 3s to go (${room.state.countdown.toFixed(1)})`);
  for (let i = 0; i < 60 && room.state.phase === "cleared"; i++) { room.lastTick = Date.now() - 100; room.tick(); }
  ok(room.state.phase === "playing" && room.state.stage === 2 && ![...room.state.players.values()].some(p => p.ready), "next wave starts (ready flags reset)");
  room.hiveSpawned = true; room.state.elapsed = 90; room.lastTick = Date.now() - 50; room.tick(); room.lastTick = Date.now() - 50; room.tick();   // (wave 2's Hivemind: tested in 31)
  send({ sessionId: "B" }, "nextStage"); ok(room.state.phase === "cleared", "non-host cannot skip the countdown");
  send(A, "nextStage"); ok(room.state.phase === "playing" && room.state.stage === 3, "host START NOW skips the countdown");
  room._dispose(); }

// 4b. revive: hold F (the key repeats -> many "revive" messages) for 5s next to a downed teammate; letting go cancels
{ const { room, A, B, send, P } = makeRoom(); const f = P(B), r = P(A); freeze(r); f.x = r.x + 40; f.y = r.y; room.downPlayer(f);
  const T = n => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - 50; room.state.elapsed = 1; room.tick(); } };
  send(A, "revive", { targetId: "B" }); for (let i = 0; i < 18; i++) { T(5); send(A, "revive", { targetId: "B" }); }   // 4.5s of holding (key repeat)
  ok(!f.alive && r.reviveProgress > 4, `holding F keeps the progress (${r.reviveProgress.toFixed(1)}s)`);
  T(12); ok(f.alive && r.revives === 1, "...and after 5s they're back up");
  room.downPlayer(f); send(A, "revive", { targetId: "B" }); T(40); send(A, "reviveStop"); T(80); ok(!f.alive && r.reviveTargetId === "", "letting go of F cancels the revive");
  room._dispose(); }

// 5. bleed-out
{ const { room, A, B, send, P } = makeRoom(); const f = P(B); freeze(P(A));
  room.downPlayer(f); ok(!f.alive && f.bleedout === 30, "first down: 30s bleed-out");
  for (let i = 0; i < 320 && !f.bledOut; i++) { room.lastTick = Date.now() - 100; room.state.elapsed = 1; room.tick(); }
  ok(f.bledOut, "after the timer runs out the player is bled out");
  P(A).x = f.x; P(A).y = f.y; send(A, "revive", { targetId: "B" }); ok(P(A).reviveTargetId === "", "a bled-out player can't be revived");
  ok(room.state.phase === "playing", "game continues while a teammate is alive");
  room.startNextWave(); ok(f.alive && !f.bledOut, "bled-out player returns at the next wave");
  room.downPlayer(f); f.alive = true; room.downPlayer(f); ok(f.bleedout === 25, "second down in the same wave: 25s");
  room._dispose(); }


// 6. easier waves 1-3
{ const { room } = makeRoom(); const counts = {};
  for (const stage of [1, 2, 3, 4, 5, 6, 7]) { room.state.stage = stage; room.state.zombies.clear(); room.state.elapsed = 0; room.spawnClock = 0; let n = 0;
    for (let t = 0; t < 900; t++) { room.state.elapsed = t / 10; room.spawnClock -= 0.1; if (room.spawnClock <= 0 && room.state.elapsed < 90) { const before = room.state.zombies.size; room.spawnZombie(); /* mimic tick */
        const early = { 1: 2.6, 2: 2.0, 3: 1.6, 4: 1.3, 5: 1.1, 6: 0.95 }[stage]; if (!early && Math.random() < Math.min(.65, .15 + stage * .01)) room.spawnZombie();
        room.spawnClock = early || Math.max(0.24, 1.15 - stage * 0.018); n += room.state.zombies.size - before; } }
    counts[stage] = n; }
  console.log(`      zombies per wave (approx): ${JSON.stringify(counts)}  (smooth warm-up)`);
  ok(counts[1] <= 40 && counts[2] <= 50 && counts[3] <= 60 && counts[4] > counts[3], "waves 1-3 have far fewer zombies; wave 4 ramps up");
  room._dispose(); }

// 7. gold + shop
{ const { room, A, B, send, P } = makeRoom(); const p = P(A); freeze(p);
  const z = placeZombie(room, 700, 380, 1); p.lastShot = 0; send(A, "shoot", { a: 0 });
  ok(p.currency === 1, "a walker kill pays 1 gold");
  p.currency = 200; send(A, "buy", { id: "shotgun" }); ok(p.currency === 200, "shop is closed during a wave");
  send(A, "weapon", { id: "sniper" }); ok(p.weapon === "rifle", "can't equip a weapon you don't own");
  room.state.phase = "cleared";
  send(A, "buy", { id: "shotgun" }); ok(p.currency === 160 && p.weapon === "shotgun" && p.owned.includes("shotgun"), "buying the shotgun unlocks and equips it (-40 gold)");
  send(A, "buy", { id: "shotgun" }); ok(p.currency === 160, "can't buy a weapon twice");
  const scrap = room.state.scrap; send(A, "buy", { id: "scrap" }); ok(room.state.scrap === scrap + 40 && p.currency === 145, "team scrap +40 for 15 gold");
  send(A, "buy", { id: "armor" }); ok(p.currency === 145 && !(p.armor > 0), "armour isn't sold in the shop (it's a level-up upgrade now)");
  p.currency = 500;
  const mk = p.medkits; send(A, "buy", { id: "medkit" }); send(A, "buy", { id: "medkit" }); send(A, "buy", { id: "medkit" }); ok(p.medkits === 3 && mk === 1, "shop medkits go to the quick slot, max 3");
  room.state.phase = "victory"; send(A, "restart"); ok(p.currency === 0 && p.owned === "pistol,rifle" && p.armor === 0, "new match resets gold, weapons and armour");
  room._dispose(); }

// 8. AI teammates
{ const room = new SurvivalRoom(); room.onCreate({ site: 0 }); room.mapGrid = new Map(); room._onBroadcast = () => {};
  const A = { sessionId: "A" }, B = { sessionId: "B" }; room.onJoin(A, { name: "Host" }); room.onJoin(B, { name: "Friend" });
  const send = (c, t, d) => room._handlers[t](c, d);
  send(B, "addBot"); ok(room.state.players.size === 2, "only the host can add bots");
  send(A, "addBot"); send(A, "addBot"); const bots = [...room.state.players.values()].filter(p => p.isBot);
  ok(bots.length === 2 && bots[0].name !== bots[1].name, `host adds bots: ${bots.map(b => b.name + " (" + b.characterClass + ")").join(", ")}`);
  send(A, "removeBot"); ok([...room.state.players.values()].filter(p => p.isBot).length === 1, "host can remove a bot");
  for (let i = 0; i < 10; i++) send(A, "addBot"); ok(room.state.players.size === 8, "bots never push the room past 8");
  send(A, "start"); room.spawnClock = 9999; room.state.zombies.clear();
  const CX = room.state.worldW / 2, CY = room.state.worldH / 2;
  for (let i = 0; i < 6; i++) { const z = placeZombie(room, CX - 300 + i * 120, CY - 300, 60); z.speed = 0; z.damage = 0; }
  for (let i = 0; i < 200; i++) { await W(50); room.tick(); }
  const botKills = [...room.state.players.values()].filter(p => p.isBot).reduce((s, b) => s + b.kills, 0);
  ok(botKills >= 4, `bots aim and shoot zombies (${botKills} of 6 killed)`);
  const host = room.state.players.get("A"); host.x = CX - 300; host.y = CY + 250; room.downPlayer(host);
  room.state.zombies.clear(); let revived = false;
  for (let i = 0; i < 300 && !revived; i++) { await W(50); room.tick(); revived = host.alive; }
  ok(revived, "a bot walks over and revives a downed player");
  room.onLeave(A); ok(room.state.hostId === "B", "host passes to the human, not a bot");
  room.onLeave(B); ok(room.state.players.size === 0, "when the last human leaves, bots leave too");
  room._dispose(); }

// 9. hotbar slots, magazines, reload, melee, quick item, build range
{ const { room, A, send, P } = makeRoom(); const p = P(A); freeze(p);
  ok(p.activeSlot === 2 && p.weapon === "rifle" && p.mag === 30, "you start on slot 2 with a full rifle magazine (30)");
  send(A, "slot", { n: 3 }); ok(p.weapon === "pistol" && p.mag === 12, "key 3 switches to the pistol (12-round mag)");
  send(A, "slot", { n: 2 }); ok(p.weapon === "rifle", "key 2 switches back to the rifle");
  p.owned += ",shotgun,sniper"; send(A, "slot", { n: 2, cycle: true }); ok(p.weapon === "shotgun", "pressing 2 again cycles to your next owned primary");
  send(A, "slot", { n: 2, cycle: true }); ok(p.weapon === "sniper", "...and again");
  send(A, "slot", { n: 2, cycle: true }); ok(p.weapon === "rifle", "...back to the rifle");
  send(A, "slot", { n: 1 }); send(A, "slot", { n: 1, cycle: true }); ok(p.activeSlot === 1 && p.melee === "bat", "pressing 1 again cycles melee weapons");
  // magazine + reload
  send(A, "slot", { n: 2 }); placeZombie(room, 760, 380, 99999);
  for (let i = 0; i < 30; i++) { p.lastShot = 0; send(A, "attack", { a: 0 }); }
  ok(p.mag === 0, "30 shots empty the rifle magazine");
  ok(p.reloadLeft > 1.5, "...and the last shot starts a 1.6s reload by itself (no key needed)");
  const reserve = p.ammo; for (let i = 0; i < 20; i++) { room.lastTick = Date.now() - 100; room.tick(); }
  ok(p.mag === 30 && p.ammo === reserve - 30 && p.reloadLeft === 0, "reload refills the mag from spare ammo");
  for (let i = 0; i < 5; i++) { p.lastShot = 0; send(A, "attack", { a: 0 }); } send(A, "reload"); ok(p.reloadLeft > 0, "C reloads a part-empty magazine early");
  send(A, "slot", { n: 3 }); ok(p.reloadLeft === 0, "switching weapons cancels a reload");
  send(A, "slot", { n: 2 }); ok(p.mag === 25, "each gun remembers its own magazine");
  { p.reloadLeft = 0; room.mags.set("A:pistol", 0); send(A, "slot", { n: 3 }); ok(p.mag === 0 && p.reloadLeft > 0, "switching to an empty gun reloads it straight away"); p.reloadLeft = 0; send(A, "slot", { n: 2 }); }
  p.ammo = 0; p.mag = 0; p.lastShot = 0; send(A, "attack", { a: 0 }); ok(p.activeSlot === 3 && p.weapon === "pistol", "out of spare ammo: switches to the pistol");
  p.mag = 0; p.lastShot = 0; send(A, "attack", { a: 0 }); for (let i = 0; i < 12; i++) { room.lastTick = Date.now() - 100; room.tick(); } ok(p.mag === 12, "the pistol never runs out (infinite spare ammo)");
  room._dispose(); }
{ const { room, A, send, P } = makeRoom(); const p = P(A); freeze(p); send(A, "slot", { n: 1 });
  const front = placeZombie(room, 640, 380), behind = placeZombie(room, 560, 380), far = placeZombie(room, 700, 380);
  send(A, "attack", { a: 0 }); ok(front.hp < 500 && behind.hp === 500 && far.hp === 500, "melee hits only zombies in front of you, in reach");
  const hp = front.hp; send(A, "attack", { a: 0 }); ok(front.hp === hp, "melee has a swing cooldown");
  room._dispose(); }
{ const { room, A, send, P } = makeRoom(); const p = P(A); freeze(p); send(A, "slot", { n: 5 }); p.hp = 20;
  send(A, "attack", {}); ok(p.medkits === 0 && p.hp === 20 + Math.round(p.maxHp * 0.6), "slot 5 + click uses a medkit (+60% health)");
  room.state.lastItemReset = 1; room.lastItem.clear(); send(A, "attack", {}); ok(p.hp === 20 + Math.round(p.maxHp * 0.6), "no medkits left: nothing happens");
  room._dispose(); }
{ const { room, A, send, P } = makeRoom(); const p = P(A); freeze(p); room.state.scrap = 500;
  send(A, "build", { kind: "barricade", x: 700, y: 380 }); const near = [...room.state.structures.values()].pop();
  ok(near.x === 700 && near.y === 380, "builds where you point (within range)");
  send(A, "build", { kind: "barricade", x: 1150, y: 380 }); const far = [...room.state.structures.values()].pop();
  ok(Math.round(Math.hypot(far.x - 600, far.y - 380)) === 160, "pointing too far builds at max range (160px)");
  room._dispose(); }

// 11. big map: zombies spawn on a ring around the tower, out of view
{ const { room } = makeRoom(); const cx = room.state.worldW / 2, cy = room.state.worldH / 2; let near = 0, far = 0;
  for (let i = 0; i < 200; i++) { room.spawnZombie(false); const z = [...room.state.zombies.values()].pop(); const d = Math.hypot(z.x - cx, z.y - cy); if (d < 600) near++; else far++; }
  ok(room.state.worldW === 3600 && room.state.worldH === 2280, "the map is 3600 x 2280 (about 9x the old area)");
  ok(near === 0 && far === 200, "zombies spawn 850-1150px from the tower, never on top of you");
  room._dispose(); }

// 10. full-auto rebalance, % upgrades, solid structures, human-like bots
{ const { room, A, send, P } = makeRoom(); const p = P(A); freeze(p);
  ok(p.damage === 16.5 && p.fireRate > 4.5, `rifle is full-auto: ${p.damage} dmg x ${p.fireRate.toFixed(1)}/s (assault), more than the pistol`);
  p.xp = 999; send(A, "upgrade", { id: "damage" }); ok(p.damage === 19.8, `damage upgrade is +20% (${p.damage})`);
  send(A, "slot", { n: 3 }); ok(p.weapon === "pistol" && p.damage === 14.5, `...and carries over to the pistol (${p.damage})`);
  ok(p.ammo === 240, "you start with 240 spare ammo");
  room._dispose(); }
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.state.scrap = 999;
  p.x = 300; p.y = 200; send(A, "build", { kind: "barricade", x: 360, y: 200 });
  for (let i = 0; i < 40; i++) send(A, "input", { dx: 1, dy: 0 }), room.lastInputs.set("A", Date.now() - 50);
  ok(p.x > 380, `survivors walk straight through deployables (x=${Math.round(p.x)}, the barricade is at 340-380)`);
  p.x = 320; p.y = 200; room.lastDashAt.clear(); send(A, "dash", { dx: 1, dy: 0 }); ok(p.x > 380, `...and dash through them (x=${Math.round(p.x)})`);
  p.x = 300; p.y = 160; for (let i = 0; i < 40; i++) send(A, "input", { dx: 1, dy: 0 }), room.lastInputs.set("A", Date.now() - 50);
  ok(p.x > 380, "you can walk around it");
  p.x = room.state.worldW / 2; p.y = room.state.worldH / 2; room.solveCollisions(p); ok(Math.hypot(p.x - room.state.worldW / 2, p.y - room.state.worldH / 2) >= 34, "the radio tower base is solid too");
  send(A, "build", { kind: "mine", x: 500, y: 600 }); p.x = 470; p.y = 600; for (let i = 0; i < 20; i++) send(A, "input", { dx: 1, dy: 0 }), room.lastInputs.set("A", Date.now() - 50);
  ok(p.x > 520, "mines can be walked over");
  room._dispose(); }
{ const room = new SurvivalRoom(); room.onCreate({ site: 0 }); room.mapGrid = new Map(); let shots = 0; room._onBroadcast = (t, m) => { if (t === "shot" && m.id.startsWith("bot")) shots++; };
  const A = { sessionId: "A" }; room.onJoin(A, { name: "Host" }); room._handlers.addBot(A); room._handlers.addBot(A);
  for (const b of room.state.players.values()) if (b.isBot) { b.characterClass = "assault"; b.weapon = "rifle"; b.primary = "rifle"; b.activeSlot = 2; }
  room._handlers.start(A); room.spawnClock = 9999; room.state.zombies.clear();
  for (let i = 0; i < 4; i++) { room.spawnZombie(false); const z = [...room.state.zombies.values()].pop(); z.x = room.state.worldW / 2 - 400 + i * 260; z.y = room.state.worldH / 2 - 350; z.hp = z.maxHp = 9999; z.speed = 0; z.damage = 0; }
  for (let i = 0; i < 100; i++) { await W(50); room.tick(); }
  const bots = [...room.state.players.values()].filter(p => p.isBot), dealt = bots.reduce((s, b) => s + b.damageDealt, 0);
  const hitRate = dealt / (shots * 9.9);
  console.log(`      bots fired ${shots} shots in 5s, hit rate ${(hitRate * 100).toFixed(0)}%`);
  ok(shots > 10 && hitRate < 0.95 && hitRate > 0.1, "bots now miss sometimes (not perfect aim) but still help");   // 25 shots: 87% happens by chance
  room._dispose(); }
// 12. bots keep personal space
{ const room = new SurvivalRoom(); room.onCreate({ site: 0 }); room.mapGrid = new Map(); room._onBroadcast = () => {};
  const A = { sessionId: "A" }; room.onJoin(A, { name: "Host" }); room._handlers.addBot(A); room._handlers.addBot(A);
  room._handlers.start(A); room.spawnClock = 9999; room.state.zombies.clear();
  const bots = [...room.state.players.values()].filter(p => p.isBot); bots[1].x = bots[0].x; bots[1].y = bots[0].y;
  for (let i = 0; i < 40; i++) { await W(50); room.tick(); }
  const d = Math.hypot(bots[0].x - bots[1].x, bots[0].y - bots[1].y);
  ok(d > 30, `bots spread apart instead of stacking (${Math.round(d)}px apart)`);
  room._dispose(); }
{ const { room, A, send, P } = makeRoom(); const p = P(A); freeze(p); send(A, "slot", { n: 1 });
  const z = placeZombie(room, 640, 380, 38); room.lastMelee.clear(); send(A, "attack", { a: 0 });
  ok(z.hp > 25 && room.state.zombies.has(z.id), `knife does little damage now (walker 38 -> ${Math.round(z.hp)} HP)`);
  room._dispose(); }
// 13. fire axe heavy swing: hold 1s -> wide, hard, knocks back; a quick click is a normal swing
{ const { room, A, send, P } = makeRoom(); const p = P(A); freeze(p); p.melee = "axe"; p.owned += ",axe"; send(A, "slot", { n: 1 }); p.melee = "axe";
  const q = placeZombie(room, 650, 380); send(A, "charge", { on: true }); send(A, "attack", { a: 0, heavy: true });
  ok(500 - q.hp < 40 && !p.charging, `releasing early = normal swing (${Math.round(500 - q.hp)} dmg), charge cleared`);
  room.lastMelee.clear(); room.state.zombies.clear();
  const zs = [placeZombie(room, 680, 380), placeZombie(room, 650, 320), placeZombie(room, 650, 440), placeZombie(room, 690, 400)];
  send(A, "charge", { on: true }); ok(p.charging, "pressing with the axe starts charging");
  room.chargeAt.set(A.sessionId, Date.now() - 1050);
  const x0 = zs[0].x; send(A, "attack", { a: 0, heavy: true });
  const hit = zs.filter(z => z.hp < 500).length, dmg = 500 - zs[0].hp;
  ok(hit === 4, `heavy swing hits all ${hit}/4 zombies in front`);
  ok(dmg >= 60, `heavy swing does big damage (${Math.round(dmg)})`);
  ok(zs[0].x > x0 + 20, `heavy swing knocks zombies back (${Math.round(zs[0].x - x0)}px)`);
  room.lastMelee.clear(); send(A, "charge", { on: true }); send(A, "attack", { a: 0, heavy: true });
  ok(500 - zs[0].hp - dmg < 40, "a heavy swing needs the full second of charge (server checks)");
  send(A, "slot", { n: 1 }); room.chargeAt.clear(); p.melee = "knife"; send(A, "charge", { on: true }); ok(!p.charging, "only the axe can charge");
  room._dispose(); }
// 14. explore mode: no zombies, frozen wave timer; can be switched off again
{ const room = new SurvivalRoom(); room.onCreate({ site: 0 }); room._onBroadcast = () => {};
  const A = { sessionId: "A" }; room.onJoin(A, { name: "Host" }); room._handlers.start(A, { explore: true });
  for (let i = 0; i < 30; i++) { room.lastTick = Date.now() - 100; room.spawnClock = 0; room.tick(); }
  ok(room.state.explore && room.state.zombies.size === 0 && room.state.elapsed === 0, "explore mode: no zombies spawn and the wave timer stays frozen");
  room._handlers.explore(A, { on: false }); room.spawnClock = 0; room.lastTick = Date.now() - 100; room.tick();
  ok(!room.state.explore && room.state.zombies.size > 0 && room.state.elapsed > 0, "turning explore off brings the waves back");
  room._handlers.explore(A, { on: true }); ok(room.state.zombies.size === 0, "turning it on mid-wave clears all zombies");
  const B = { sessionId: "B" }; room.onJoin(B, { name: "Guest" }); room._handlers.explore(B, { on: false }); ok(room.state.explore, "only the host can switch explore mode");
  room._dispose(); }
// 15. map pieces are solid: survivors, zombies and bots can't walk through them; can't build inside them
{ const { room, A, send, P } = makeRoom(true); const p = P(A);
  const lay = room.state.mapLayout.split(";").map(r => r.split(",").map(Number));
  ok(lay.length > 150, `map layout is sent to players (${lay.length} pieces)`);
  const bld = [...new Set([...room.mapGrid.values()].flat())].find(b => b.hw >= 70);   // a building
  p.x = bld.x - bld.hw - 40; p.y = bld.y;
  for (let i = 0; i < 40; i++) { room.lastInputs.set(A.sessionId, Date.now() - 50); send(A, "input", { dx: 1, dy: 0 }); }
  ok(p.x <= bld.x - bld.hw - 11, `walking into a building stops you (x=${Math.round(p.x)}, wall at ${Math.round(bld.x - bld.hw)})`);
  p.x = bld.x - bld.hw - 30; p.y = bld.y; room.lastDashAt?.clear?.(); send(A, "dash", { dx: 1, dy: 0 });
  ok(p.x <= bld.x - bld.hw - 11, "dashing into it doesn't get you through either");
  room.state.scrap = 999; const n = room.state.structures.size; p.x = bld.x - bld.hw - 60; p.y = bld.y;
  send(A, "build", { kind: "barricade", x: bld.x - bld.hw + 20, y: bld.y }); ok(room.state.structures.size === n && room.state.scrap === 999, "can't build inside a building (and nothing is charged)");
  // a zombie behind the building (seen from the tower) walks around it toward the tower
  room.state.zombies.clear(); room.spawnClock = 9999;
  const TX = room.state.worldW / 2, TY = room.state.worldH / 2, bd = Math.hypot(bld.x - TX, bld.y - TY), ux = (bld.x - TX) / bd, uy = (bld.y - TY) / bd;
  const reach = Math.abs(ux) * bld.hw + Math.abs(uy) * bld.hh;
  const z = placeZombie(room, bld.x + ux * (reach + 30), bld.y + uy * (reach + 30)); z.speed = 60; z.damage = 0; z.role = "tower";
  for (const pl of room.state.players.values()) { pl.x = 40; pl.y = 40; }
  let inside = false;
  for (let i = 0; i < 160; i++) { room.lastTick = Date.now() - 50; room.tick(); if (Math.abs(z.x - bld.x) < bld.hw - 4 && Math.abs(z.y - bld.y) < bld.hh - 4) inside = true; }
  ok(!inside, "zombies never walk through buildings");
  const passed = bd - Math.hypot(z.x - TX, z.y - TY);
  ok(passed > reach, `...and find their way around toward the tower (got ${Math.round(passed)}px past the building's middle)`);
  room._dispose(); }
// 16. map pieces stop bullets (and launcher blasts); a clear shot still hits
{ const { room, A, send, P } = makeRoom(true); const p = P(A);
  const bld = [...new Set([...room.mapGrid.values()].flat())].find(b => b.hw >= 70);
  p.x = bld.x - bld.hw - 60; p.y = bld.y; room.state.zombies.clear(); room.spawnClock = 9999;
  const hidden = placeZombie(room, bld.x + bld.hw + 40, bld.y);   // behind the building
  p.lastShot = 0; send(A, "attack", { a: 0 }); ok(hidden.hp === 500, "bullets don't go through a building");
  p.owned += ",launcher"; send(A, "weapon", { id: "launcher" }); p.lastShot = 0; send(A, "attack", { a: 0 }); ok(hidden.hp === 500, "launcher blasts don't reach through it either");
  send(A, "weapon", { id: "rifle" }); send(A, "slot", { n: 2 });
  const open = placeZombie(room, p.x - 120, p.y); p.lastShot = 0; p.mag = 30; send(A, "attack", { a: Math.PI }); ok(open.hp < 500, "a clear shot still hits");
  room._dispose(); }
// 17. zombies go for the tower first; they only fight a survivor right in their way
{ const { room, A, B, P } = makeRoom(); const CX = room.state.worldW / 2, CY = room.state.worldH / 2;
  const p = P(A); p.x = CX + 400; p.y = CY - 200; P(B).x = CX - 600; P(B).y = CY + 500;
  const z = placeZombie(room, CX + 600, CY - 200); z.speed = 60; z.role = "tower";
  const d0 = Math.hypot(z.x - CX, z.y - CY);
  for (let i = 0; i < 20; i++) { room.lastTick = Date.now() - 50; room.tick(); }
  ok(Math.hypot(z.x - CX, z.y - CY) < d0 - 30 && z.targetId === "", "a TOWER zombie walks past a survivor 200px away and heads for the tower");
  const h = placeZombie(room, p.x + 450, p.y); h.role = "hunter"; h.speed = 60; const hd0 = Math.hypot(h.x - p.x, h.y - p.y);
  for (let i = 0; i < 10; i++) { room.lastTick = Date.now() - 50; room.tick(); }
  ok(h.targetId === A.sessionId && Math.hypot(h.x - p.x, h.y - p.y) < hd0 - 10, "a HUNTER zombie goes after a survivor 450px away");
  room.state.zombies.delete(h.id);
  p.x = z.x - 60; p.y = z.y; const hp = p.hp; z.damage = 5; z.attackCooldown = 0;
  for (let i = 0; i < 20; i++) { room.lastTick = Date.now() - 50; room.tick(); }
  ok(z.targetId === "" && p.hp === hp, "...and never attacks a survivor, even one standing right next to it");
  room.state.zombies.clear(); const t0 = room.state.towerHp;
  const sp = placeZombie(room, CX + 180, CY); sp.kind = "spitter"; sp.role = "tower"; sp.speed = 28; sp.damage = 6; sp.attackCooldown = 0; p.x = CX - 900; P(B).x = CX - 900;
  for (let i = 0; i < 3; i++) { room.lastTick = Date.now() - 50; room.tick(); }
  await W(800); room.lastTick = Date.now() - 50; room.tick();
  ok(room.state.towerHp < t0, "spitters spit acid at the tower from range");
  room._dispose(); }
// 18. each wave is a mix of tower zombies and hunters (about half each)
{ const { room } = makeRoom(); room.state.stage = 20; let wrong = 0, n = 0;
  for (let i = 0; i < 400; i++) room.spawnZombie(); for (const z of room.state.zombies.values()) { n++; if ((z.kind === "runner") !== (z.role === "tower")) wrong++; }
  ok(n === 400 && wrong === 0, "only runners go for the tower; walkers, brutes, spitters and mutants all hunt survivors");
  room._dispose(); }
// 19. runners always go for the tower; solo test helper can jump to any wave (and only in solo)
{ const { room } = makeRoom(); room.state.stage = 15; for (let i = 0; i < 300; i++) room.spawnZombie();
  const runners = [...room.state.zombies.values()].filter(z => z.kind === "runner");
  ok(runners.length > 50 && runners.every(z => z.role === "tower"), `every runner is a tower zombie (${runners.length} runners)`);
  room._dispose(); }
{ const room = new SurvivalRoom(); room.onCreate({ solo: true, site: 0 }); room._onBroadcast = () => {}; room.mapGrid = new Map();
  const A = { sessionId: "A" }; room.onJoin(A, { name: "Host" }); room._handlers.start(A, {});
  room._handlers.debugWave(A, { n: 12 }); ok(room.state.stage === 12 && room.state.waveType === "boss" && room.state.bossPhase === "horde", "solo: jump to wave 12 starts the boss wave (horde first)");
  room._handlers.debugWave(A, { n: 6 }); ok(room.state.stage === 6 && room.state.waveType === "normal" && room.state.zombies.size === 0, "solo: jump to wave 6");
  room._dispose(); }
{ const { room, A, B } = makeRoom(); room._handlers.debugWave(B, { n: 30 }); ok(room.state.stage === 1, "online: only the host can skip waves");
  room._handlers.debugWave(A, { n: 7 }); ok(room.state.stage === 7, "...the host skips to wave 7");
  room._handlers.debugGold(A); ok(room.state.players.get("A").currency === 0, "online rooms ignore the gold cheat"); room._dispose(); }
// 20. wave mixes: runners from wave 1, ~20% brutes in wave 3, every wave a different mix
{ const { room } = makeRoom(); const mixOf = st => { room.state.zombies.clear(); room.state.stage = st; for (let i = 0; i < 1000; i++) room.spawnZombie(); const c = {}; for (const z of room.state.zombies.values()) c[z.kind] = (c[z.kind] || 0) + 1; return c; };
  const w1 = mixOf(1), w3 = mixOf(3);
  ok((w1.runner || 0) > 90 && !w1.brute, `wave 1 has runners (${w1.runner} of 1000), no brutes`);
  ok(w3.brute > 160 && w3.brute < 240, `wave 3 is about 20% brutes (${w3.brute} of 1000)`);
  room._dispose(); }
// 21. freshly spawned zombies really hurt you (regression), and brutes hit from further away
{ const { room, A, B, P } = makeRoom(); const p = P(A); room.state.zombies.clear(); room.spawnClock = 9999; P(B).x = 60; P(B).y = 60;   // the other survivor far away
  room.spawnZombie(false, "walker"); const w = [...room.state.zombies.values()].pop(); w.role = "hunter"; w.x = p.x + 30; w.y = p.y;
  for (let i = 0; i < 10; i++) { room.lastTick = Date.now() - 50; room.tick(); }
  ok(p.hp < p.maxHp, `a normal spawned zombie damages you (${Math.round(p.maxHp - p.hp)} dmg)`);
  room.state.zombies.clear(); p.hp = p.maxHp;
  room.spawnZombie(false, "brute"); const b = [...room.state.zombies.values()].pop(); b.role = "hunter"; b.speed = 0; b.x = p.x + 33 + 40; b.y = p.y; room.slamReady.set(b.id, Date.now() + 99999);   // no slam: test the punch
  for (let i = 0; i < 6; i++) { room.lastTick = Date.now() - 50; room.tick(); }
  ok(p.hp < p.maxHp, "a brute hits you from 40px past its body (walkers only reach about 22px)");
  const t0 = room.state.towerHp; room.state.zombies.clear(); for (const pl of room.state.players.values()) { pl.x = 60; pl.y = 60; }
  room.spawnZombie(false, "runner"); const t = [...room.state.zombies.values()].pop(); t.x = room.state.worldW / 2 + 20; t.y = room.state.worldH / 2;
  for (let i = 0; i < 6; i++) { room.lastTick = Date.now() - 50; room.tick(); }
  ok(room.state.towerHp < t0, "zombies at the tower damage it");
  room._dispose(); }
// 22. hunters chase survivors anywhere on the map; brute ground slam damages + stuns everyone nearby
{ const { room, A, B, P } = makeRoom(); const p = P(A), q = P(B); room.state.zombies.clear(); room.spawnClock = 9999;
  p.x = 300; p.y = 300; q.x = 3300; q.y = 2000;
  room.spawnZombie(false, "walker"); const w = [...room.state.zombies.values()].pop(); w.x = 1500; w.y = 900;
  room.lastTick = Date.now() - 50; room.tick(); ok(w.targetId === A.sessionId, "a walker hunts the nearest survivor even 1300px away");
  room.state.zombies.clear(); p.x = 1000; p.y = 1000; q.x = 1000 + 300; q.y = 1000; p.hp = p.maxHp; q.hp = q.maxHp;
  room.spawnZombie(false, "brute"); const b = [...room.state.zombies.values()].pop(); b.x = p.x + 90; b.y = p.y; b.speed = 0;
  room.lastTick = Date.now() - 50; room.tick(); ok(b.slam > 0 && p.hp === p.maxHp, "a brute next to you starts a ground slam (wind-up, no damage yet)");
  for (let i = 0; i < 20; i++) { room.lastTick = Date.now() - 50; room.tick(); }
  ok(p.hp < p.maxHp && p.stunned > 0, `the slam hits and stuns you (${Math.round(p.maxHp - p.hp)} dmg, ${p.stunned.toFixed(1)}s stun)`);
  ok(q.hp === q.maxHp && !(q.stunned > 0), "a survivor 300px away is safe");
  const x0 = p.x; room.lastInputs.set(A.sessionId, Date.now() - 50); room._handlers.input(A, { dx: -1, dy: 0 }); ok(p.x === x0, "stunned: you can't move");
  p.lastShot = 0; const m = p.mag; room._handlers.attack(A, { a: 0 }); ok(p.mag === m, "stunned: you can't shoot");
  for (let i = 0; i < 40; i++) { room.lastTick = Date.now() - 50; room.tick(); }
  ok(!(p.stunned > 0), "the stun wears off");
  room._dispose(); }
// 23. spitters lob acid from far away; it lands as a big puddle that burns whoever stands in it
{ const { room, A, B, P } = makeRoom(); const p = P(A), q = P(B); room.state.zombies.clear(); room.spawnClock = 9999;
  p.x = 1000; p.y = 1000; q.x = 3000; q.y = 2000; p.hp = p.maxHp;
  room.spawnZombie(false, "spitter"); const sp = [...room.state.zombies.values()].pop(); sp.x = p.x + 380; sp.y = p.y; sp.speed = 0; sp.attackCooldown = 0;
  room.lastTick = Date.now() - 50; room.tick();
  ok(room.spits.length === 1 && room.state.puddles.size === 0, "a spitter 380px away lobs acid (it's in the air, nothing hit yet)");
  await W(1300); room.lastTick = Date.now() - 50; room.tick();
  const pu = [...room.state.puddles.values()][0];
  ok(pu && pu.r >= 80 && Math.hypot(pu.x - p.x, pu.y - p.y) < 2, `it lands where you stood as a big puddle (radius ${pu?.r}px, ${pu?.maxLife}s)`);
  ok(p.hp < p.maxHp, `standing there hurts (${Math.round(p.maxHp - p.hp)} dmg so far)`);
  const h1 = p.hp; for (let i = 0; i < 20; i++) { room.lastTick = Date.now() - 100; room.tick(); }
  ok(p.hp < h1 - 5, `the puddle keeps burning while you stand in it (${Math.round(h1 - p.hp)} more)`);
  p.x += 200; const h2 = p.hp; for (let i = 0; i < 10; i++) { room.lastTick = Date.now() - 100; room.tick(); }
  ok(Math.abs(p.hp - h2) < 0.01, "step out of the puddle and it stops");
  for (let i = 0; i < 60; i++) { room.lastTick = Date.now() - 100; room.tick(); }
  ok(room.state.puddles.size <= 2, "puddles dry up after a few seconds");
  room.state.puddles.clear(); p.x = 1000; p.y = 1000; p.hp = p.maxHp; room.state.zombies.clear();
  for (let i = 0; i < 4; i++) room.acidLand({ tx: p.x + 40, ty: p.y, dmg: 6, atTower: false });   // 4 puddles on the same spot (no direct hit)
  for (let i = 0; i < 10; i++) { room.lastTick = Date.now() - 100; room.tick(); }
  ok(p.maxHp - p.hp < 10, `standing in 4 puddles burns like 1 (${(p.maxHp - p.hp).toFixed(1)} dmg in 1s)`);
  room._dispose(); }
// 24. mutants: tough, fast, and their slash hits everyone in front of them while they keep moving
{ const { room, A, B, P } = makeRoom(); const p = P(A), q = P(B); room.state.zombies.clear(); room.spawnClock = 9999;
  room.spawnZombie(false, "mutant"); const m = [...room.state.zombies.values()].pop();
  ok(m.maxHp >= 140 && m.speed >= 105 && m.damage >= 16, `mutants are tough (${Math.round(m.maxHp)} HP), fast (${m.speed}) and hit hard (${Math.round(m.damage)})`);
  p.x = 1000; p.y = 1000; q.x = 1000; q.y = 1048; p.hp = p.maxHp; q.hp = q.maxHp;   // two survivors side by side
  m.x = 1120; m.y = 1024; const x0 = m.x;
  room.lastTick = Date.now() - 50; room.tick();
  ok(m.slam > 0 && p.hp === p.maxHp, "a mutant 120px away starts its charged slash (coiling, no damage yet)");
  for (let i = 0; i < 14; i++) { room.lastTick = Date.now() - 50; room.tick(); }
  ok(m.x < x0 - 40, `...lunges forward (${Math.round(x0 - m.x)}px)`);
  ok(p.hp < p.maxHp && q.hp < q.maxHp, `...and the whip hits both survivors standing together (${Math.round(p.maxHp - p.hp)} + ${Math.round(q.maxHp - q.hp)} dmg)`);
  room._dispose(); }
// 25. THE BUTCHER: wave 4 = walker horde -> intro card (waits for everyone) -> boss
{ const { room, A, B, P, send } = makeRoom(); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room.state.stage = 4; room.beginWave(); room.spawnClock = 0;
  for (let i = 0; i < 300; i++) { room.lastTick = Date.now() - 100; room.tick(); if (room.state.elapsed > 20) break; }
  room.state.zombies.clear(); for (let i = 0; i < 300; i++) room.spawnZombie();
  const kinds = new Set([...room.state.zombies.values()].map(z => z.kind));
  ok(room.state.bossPhase === "horde" && kinds.size > 1 && ![...room.state.zombies.values()].some(z => z.boss), `wave 4 horde uses the normal mix (${[...kinds].join(", ")}), no boss yet`);
  room.state.elapsed = 46; room.state.zombies.clear(); tick(1);
  ok(room.state.bossPhase === "intro" && room.state.bossIntro === "butcher" && room.state.introNeed === 2, "horde cleared -> the Butcher intro card (waiting for 2 players)");
  send(A, "ackBoss"); tick(1); ok(room.state.bossPhase === "intro" && room.state.introReady === 1, "one player clicked I UNDERSTAND: still waiting");
  send(B, "ackBoss"); tick(1);
  const bz = [...room.state.zombies.values()].find(z => z.boss);
  ok(room.state.bossPhase === "fight" && bz?.kind === "butcher", "everyone ready -> THE BUTCHER arrives");
  room.spawnClock = 0; for (let i = 0; i < 8; i++) { room.lastTick = Date.now() - 50; room.spawnClock = 0; room.tick(); }
  ok([...room.state.zombies.values()].filter(z => !z.boss).every(z => z.kind === "walker") && room.state.zombies.size > 1, "once the boss is out, only walkers join him");
  ok(bz.maxHp > 3500, `he's tanky: ${Math.round(bz.maxHp)} HP with 2 players (about ${Math.round(bz.maxHp / 1.6)} solo)`);
  // players only: ignores the tower
  room.state.zombies.clear(); room.state.zombies.set(bz.id, bz); const p = P(A), q = P(B);
  p.x = 1000; p.y = 1000; q.x = 300; q.y = 300; bz.x = 1300; bz.y = 1000; bz.hp = bz.maxHp; room.bossMem.clear();
  const tw = room.state.towerHp; tick(20);
  ok(bz.x < 1300 - 30 && room.state.towerHp === tw, "he walks after survivors, never the tower");
  // armour: front half damage, back full
  bz.act = ""; bz.aim = Math.PI; p.x = bz.x - 200; p.y = bz.y; const h0 = bz.hp; room.hitZombie(bz, p, 100); const front = h0 - bz.hp;
  p.x = bz.x + 200; const h1 = bz.hp; room.hitZombie(bz, p, 100); const back = h1 - bz.hp;
  ok(front === 50 && back === 100, `armoured front: ${front} dmg from the front, ${back} from behind`);
  // chop: 3 shockwave bands
  p.alive = q.alive = true; p.hp = p.maxHp; q.hp = q.maxHp; const r3 = { alive: true, sessionId: "C" };
  room.bossMem.clear(); const m = room.bmem(bz, Date.now()); m.chopReady = 0; m.hookReady = Date.now() + 99999;
  bz.x = 1500; bz.y = 1000; p.x = 1500 - 90; p.y = 1000; q.x = 1500 + 55 + 140; q.y = 1000;   // p right in front, q in the stun band (behind)
  tick(1); ok(bz.act === "chop", "a survivor close by -> he starts a cleaver chop (wind-up)");
  const cx = bz.x + Math.cos(bz.aim) * 55; q.x = cx + 140; q.y = bz.y;
  const pHp = p.hp; tick(25);
  ok(p.hp < pHp, `inner red ring damages (${Math.round(pHp - p.hp)})`);
  ok(q.hp === q.maxHp && q.stunned > 0, "middle yellow ring stuns (no damage)");
  // slow band
  p.stunned = q.stunned = 0; room.bossMem.clear(); const m2 = room.bmem(bz, Date.now()); m2.chopReady = 0; m2.hookReady = Date.now() + 99999; bz.act = "";
  p.x = bz.x - 100; p.y = bz.y; tick(1); const cx2 = bz.x + Math.cos(bz.aim) * 55, cy2 = bz.y + Math.sin(bz.aim) * 55; q.x = cx2 + 230; q.y = cy2; tick(25);
  ok(q.slowed > 0 && !(q.stunned > 0), "outer blue ring slows");
  // hook: furthest survivor in range gets dragged in, held, chopped
  bz.act = ""; p.stunned = q.stunned = p.slowed = q.slowed = 0; p.hp = p.maxHp; q.hp = q.maxHp;
  bz.x = 1500; bz.y = 1000; p.x = 1500 - 300; p.y = 1000; q.x = 1500 + 420; q.y = 1000; room.bossMem.clear(); const m3 = room.bmem(bz, Date.now()); m3.hookReady = 0; m3.chopReady = Date.now() + 99999;
  tick(1); ok(bz.act === "hook" && m3.hookTarget === "B", "hook: he aims at the furthest survivor in range");
  ok(m3.hookReady - Date.now() >= 9900 && m3.hookReady - Date.now() <= 15100, `hook cooldown ${((m3.hookReady - Date.now()) / 1000).toFixed(1)}s (10-15s)`);
  let pulled = false, held = false; const qx0 = q.x;
  for (let i = 0; i < 60; i++) { room.lastTick = Date.now() - 50; room.tick(); if (bz.act === "pull") pulled = true; if (pulled && bz.act === "chop" && q.stunned > 0.3) held = true; }
  ok(pulled && q.x < qx0 - 250, `a hit drags them in (${Math.round(qx0 - q.x)}px)`);
  ok(held && q.hp < q.maxHp - 30, `...holds them and chops: ${Math.round(q.maxHp - q.hp)} dmg total (${Math.round(100 * (q.maxHp - q.hp) / q.maxHp)}% of HP)`);
  // enrage + spin
  bz.act = ""; bz.hp = bz.maxHp * .25; p.x = bz.x - 60; p.y = bz.y; p.hp = p.maxHp; p.stunned = 0; room.bossMem.clear(); const m4 = room.bmem(bz, Date.now()); m4.chopReady = Date.now() + 99999; m4.hookReady = Date.now() + 99999;
  tick(1); room.bossMem.get(bz.id).spinReady = 0; tick(30);
  ok(bz.enraged && p.hp < p.maxHp, `below 30%: enraged whirlwind spin hurts anyone nearby (${Math.round(p.maxHp - p.hp)} dmg)`);
  room._dispose(); }
// 26. the hook is fast and leads a running target: hits ~always
{ let hits = 0; const N = 10;
  for (let n = 0; n < N; n++) {
    const { room, A, B, P } = makeRoom(); room.state.zombies.clear(); room.spawnClock = 9999;
    room.spawnZombie(true, "butcher"); const bz = [...room.state.zombies.values()].pop(); bz.x = 1500; bz.y = 1100;
    const p = P(A), q = P(B); p.x = 400; p.y = 400; q.x = 1500 + 400; q.y = 1100; q.speed = 190;
    const m = room.bmem(bz, Date.now()); m.hookReady = 0; m.chopReady = Date.now() + 99999;
    const dir = n % 2 ? 1 : -1;
    for (let i = 0; i < 20; i++) { room.lastInputs.set("B", Date.now() - 50); room._handlers.input(B, { dx: 0, dy: dir }); room.lastTick = Date.now() - 50; room.tick(); if (bz.act === "pull" || bz.act === "chop") break; }
    if (bz.act === "pull" || bz.act === "chop" || q.x < 1800) hits++;
    room._dispose();
  }
  ok(hits >= 9, `the hook hits a survivor running sideways ${hits}/${N} times`); }
// 27. fire axe deflects the hook (and nothing else does)
for (const weapon of ["axe", "bat", "rifle"]) {
  const { room, A, B, P, send } = makeRoom(); room.state.zombies.clear(); room.spawnClock = 9999; room.state.hookSpeed = 520;
  room.spawnZombie(true, "butcher"); const bz = [...room.state.zombies.values()].pop(); bz.x = 1500; bz.y = 1100;
  const p = P(A), q = P(B); q.x = 300; q.y = 300; p.x = 1900; p.y = 1100;
  if (weapon === "rifle") send(A, "slot", { n: 2 }); else { p.melee = weapon; send(A, "slot", { n: 1 }); p.melee = weapon; }
  const m = room.bmem(bz, Date.now()); m.hookReady = 0; m.chopReady = Date.now() + 99999;
  let deflected = false, events = []; room._onBroadcast = (t) => events.push(t);
  for (let i = 0; i < 40 && !deflected; i++) {
    room.lastTick = Date.now() - 50; room.tick();
    const tipX = bz.x + Math.cos(bz.aim) * (bz.hookD || 0);
    if (bz.act === "hook" && bz.hookD > 0 && Math.abs(p.x - tipX) < 80) { room.lastMelee.clear(); p.lastShot = 0; send(A, "attack", { a: Math.PI }); }
    if (events.includes("deflect")) deflected = true;
    if (bz.act === "pull") break;
  }
  if (weapon === "axe") {
    ok(deflected && bz.act === "stagger" && !(p.stunned > 0.3), "a timed fire-axe swing DEFLECTS the hook: he staggers, you stay free");
    const h0 = bz.hp; p.x = bz.x - 200; p.y = bz.y; bz.aim = Math.PI; room.hitZombie(bz, p, 100); ok(h0 - bz.hp === 100, "while staggered his armour is down (full damage from the front)");
  } else ok(!deflected && bz.act === "pull", `the ${weapon} can't deflect it: you get hooked`);
  room._dispose(); }
// 28. VIKTOR: E = robot squad (25s), Q = heavy turret ultimate (100 kills), zombies attack machines
{ const { room, A, B, P, send } = makeRoom(); const p = P(A), q = P(B); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  p.characterClass = "engineer"; p.x = 1000; p.y = 1000; p.aim = 0; q.x = 300; q.y = 300; room.state.zombies.clear(); room.spawnClock = 9999;
  p.robotCharges = 3; p.chargeCd = 0;
  send(A, "ability", { kind: "hunter" }); tick(1);
  ok(room.state.robots.size === 1 && [...room.state.robots.values()][0].kind === "hunter" && p.robotCharges === 2 && p.abilityCooldown > 2.8 && p.abilityCooldown <= 3, "E: starts with 3 charges, summons ONE picked robot, 3s gap");
  send(A, "ability", { kind: "support" }); ok(room.state.robots.size === 1, "...and has to wait the 3s gap before the next");
  tick(62); send(A, "ability", { kind: "assault" }); tick(62); send(A, "ability", { kind: "assault" });
  ok(room.state.robots.size === 3 && p.robotCharges === 0, `3 robots out fast, charges used up (${p.robotCharges} left)`);
  tick(62); send(A, "ability", { kind: "assault" }); ok(room.state.robots.size === 3 && [...room.state.robots.values()][0].kind === "hunter", "no charges: can't summon even after the 3s gap");
  const cd0 = p.chargeCd; tick(Math.ceil(cd0 / 0.05) + 2);
  ok(p.robotCharges === 1 && p.chargeCd > 24, `a charge comes back 25s after the first summon, and the next one starts (${p.robotCharges} charge)`);
  p.abilityCooldown = 0; send(A, "ability", { kind: "support" });
  const kinds = [...room.state.robots.values()].map(r => r.kind).join();
  ok(room.state.robots.size === 3 && kinds === "assault,assault,support", `max 3 robots: the 4th replaces the oldest (${kinds})`);
  const ar = [...room.state.robots.values()].find(r => r.kind === "assault"); const far = placeZombie(room, ar.x + 700, ar.y, 99999); far.speed = 0;
  p.x = ar.x - 900; const ax0 = ar.x; tick(110);
  ok(ar.x - ax0 > 300 && Math.abs(p.x - (ax0 - 900)) < 1, `assault robot goes looking for zombies on its own (moved ${Math.round(ar.x - ax0)}px toward one, Viktor stayed put)`);
  room.state.zombies.clear();
  { const wz = placeZombie(room, 2500, 300, 38); wz.speed = 0; let n = 0; while (room.state.zombies.has(wz.id) && n < 10) { room.hitZombie(wz, p, 5); n++; } ok(n >= 7, `an assault robot needs ~8 hits to kill a wave-1 walker (${n})`); }
  { const hrb = [...room.state.robots.values()].filter(r => r.ownerId === A); for (const r of hrb) room.state.robots.delete(r.id);
    p.robotCharges = 3; p.abilityCooldown = 0; p.x = 1000; p.y = 1000; send(A, "ability", { kind: "hunter" }); const hu = [...room.state.robots.values()].find(r => r.kind === "hunter");
    const fz = placeZombie(room, hu.hx + 280, hu.hy + 200, 99999); fz.speed = 0; p.x = hu.hx - 900; tick(80);
    ok(Math.hypot(hu.x - hu.hx, hu.y - hu.hy) <= 301, `hunter robot stays within 300px of its spot (${Math.round(Math.hypot(hu.x - hu.hx, hu.y - hu.hy))}px)`); room.state.zombies.clear();
    hu.face = 0; const zside = placeZombie(room, hu.hx - 150, hu.hy + 40, 99999); zside.speed = 0; tick(60);
    ok(zside.hp === 99999, "hunter ignores a zombie inside its circle but outside its 180-degree cone"); room.state.zombies.clear();
    const zin = placeZombie(room, hu.hx + 220, hu.hy, 99999), zout = placeZombie(room, hu.hx + 380, hu.hy, 99999); zin.speed = zout.speed = 0; room.state.zombies.delete(zin.id);
    tick(60); const outHp = zout.hp; room.state.zombies.set(zin.id, zin); tick(60);
    ok(outHp === 99999 && zin.hp < 99999, "hunter shoots zombies inside its cone, not outside its circle"); room.state.zombies.clear(); }
  { p.x = 1000; p.y = 1000; q.x = 1400; q.y = 1000; q.alive = true; p.hp = 50; q.hp = 50; p.robotCharges = 3; p.abilityCooldown = 0;
    send(A, "ability", { kind: "support" }); const su = [...room.state.robots.values()].find(r => r.kind === "support" && room.state.robots.has(r.id) && r.uses === 3);
    const seen = new Set(); let t = 0; while (room.state.robots.has(su.id) && t < 1200) { tick(1); t++; for (const pl of [p, q]) if (Math.hypot(su.x - pl.x, su.y - pl.y) < 80) seen.add(pl.sessionId); }
    ok(!room.state.robots.has(su.id) && seen.size === 2 && p.hp > 50 && q.hp > 50, `support robot heals each survivor once (2 here), then breaks (${(t * .05).toFixed(1)}s)`); }
  room.state.zombies.clear(); p.x = 1000; p.y = 1000;
  send(A, "ult"); ok(![...room.state.structures.values()].some(st => st.kind === "heavyTurret"), "Q is locked before 100 kills");
  p.ultKills = 99; const k = placeZombie(room, p.x + 30, p.y, 1); room.hitZombie(k, p, 5); ok(p.ultKills === 100, "kills count toward the ultimate");
  tick(1); send(A, "ult"); const ht = [...room.state.structures.values()].find(st => st.kind === "heavyTurret");
  ok(ht && ht.deploy > 0, "Q: Viktor deploys the Heavy Turret");
  room.state.zombies.clear(); const z = placeZombie(room, ht.x + 200, ht.y, 400); z.speed = 0;
  tick(10); const h0 = z.hp; tick(16); ok(z.hp < h0, "the turret shoots zombies after deploying");
  tick(1); send(A, "ult"); ok([...room.state.structures.values()].filter(st => st.kind === "heavyTurret").length === 1 && ht === [...room.state.structures.values()].find(st => st.kind === "heavyTurret"), "can't redeploy it while it's up");
  // zombies attack robots and the turret
  room.state.zombies.clear(); const rb = [...room.state.robots.values()];
  const w = placeZombie(room, rb[0].x + 25, rb[0].y, 500); w.role = "hunter"; w.damage = 9999; p.x = 3000; p.y = 2000; q.x = 3000; q.y = 2100;
  tick(4); ok(!room.state.robots.has(rb[0].id), "zombies attack and destroy robots");
  ok(p.ultActive > 38 && !p.ultReady, `turret is up for 40s (${p.ultActive}s left)`);
  room.ultInfo.get(A.sessionId).summonedAt = Date.now() - 40001; tick(1);
  ok(!room.state.structures.has(ht.id) && p.ultCd > 58 && !p.ultReady && !p.ultActive, `after 40s the turret breaks down -> ${p.ultCd}s cooldown starts`);
  room.ultInfo.get(A.sessionId).readyAt = 0; p.ultKills = 100; tick(1); send(A, "ult"); const ht2 = [...room.state.structures.values()].find(st => st.kind === "heavyTurret");
  room.damageMachine(ht2, 99999); tick(1);
  ok(!room.state.structures.has(ht2.id) && p.ultCd > 58 && !p.ultReady, `turret destroyed early -> ${p.ultCd}s cooldown starts then`);
  room.ultInfo.get(A.sessionId).readyAt = Date.now() - 1; tick(1); ok(p.ultReady, "...then Q is ready again (stays unlocked)");
  room._dispose(); }
// 29. RAVEN (Scout): katana only, Shadow Pass (E), flaming katana + burns, Blade Storm (Q), katana tiers
{ const room = new SurvivalRoom(); room.onCreate({ site: 0 }); room.state.noCd = false; room.mapGrid = new Map(); const events = []; room._onBroadcast = (type, m) => events.push({ type, ...m });
  const A = { sessionId: "A" }, B = { sessionId: "B" }; room.onJoin(A, { name: "Raven" }); room.onJoin(B, { name: "Friend" });
  const send = (c, t, d) => room._handlers[t](c, d), p = room.state.players.get("A"), q = room.state.players.get("B");
  send(A, "chooseClass", { id: "scout" });
  room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear();
  const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  ok(p.activeSlot === 1 && p.melee === "katana" && !p.primary && !p.secondary && p.owned === "", "Raven starts with only her katana");
  send(A, "slot", { n: 2 }); ok(p.activeSlot === 1, "...no gun to switch to (she can buy one)");
  p.x = 1000; p.y = 1000; q.x = 300; q.y = 300;
  const zs = [0, .2, -.2, .35].map(o => placeZombie(room, p.x + 60 * Math.cos(o), p.y + 60 * Math.sin(o), 1000));
  room.lastMelee.clear(); send(A, "attack", { a: 0 });
  const hit = zs.filter(z => z.hp < 1000);
  ok(hit.length === 3 && Math.abs((1000 - hit[0].hp) - 27) < 3, `katana: ~27 dmg, up to 3 zombies per slash (${hit.length} hit, ${Math.round(1000 - hit[0].hp)} dmg)`);
  room.state.zombies.clear();
  // E: Shadow Pass
  const path = placeZombie(room, p.x + 200, p.y + 5, 1000), x0 = p.x; p.aim = 0;
  send(A, "ability", {}); ok(room.shadowDash.has("A"), "E: Shadow Pass starts a dash");
  room.shadowDash.get("A").t0 -= 400; tick(1);
  ok(Math.round(p.x - x0) === 350 && path.hp < 1000, `...350px dash (${Math.round(p.x - x0)}px), slashing the zombie in the path (${Math.round(1000 - path.hp)} dmg)`);
  ok(p.shadow > 19, "...then she's invisible for 20s");
  const hunter = placeZombie(room, p.x + 100, p.y, 1000); hunter.role = "hunter"; hunter.speed = 60; tick(2);
  ok(hunter.targetId !== "A", `zombies ignore invisible Raven (target: ${hunter.targetId || "tower"})`);
  send(A, "ability", {}); ok(p.shadow > 0 && !room.shadowDash.has("A"), "E again does nothing while it's running");
  room.lastMelee.clear(); hunter.x = p.x + 50; hunter.y = p.y; send(A, "attack", { a: 0 });
  ok(p.shadow === 0 && p.fire === 5, "attacking makes her visible again and her katana catches fire (5s)");
  ok(hunter.burn === 1, "a flaming hit sets the zombie on fire");
  room.lastMelee.clear(); send(A, "attack", { a: 0 }); ok(hunter.burn === 2, "hitting it again makes the burn stronger (2 stacks)");
  const hb = hunter.hp; tick(20); ok(hb - hunter.hp > 15, `the burn keeps hurting it (${Math.round(hb - hunter.hp)} dmg in 1s)`);
  tick(95); ok(p.fire === 0 && p.abilityCooldown > 24, `after 5s the fire goes out, then the 25s cooldown starts (${p.abilityCooldown.toFixed(1)}s)`);
  room.state.zombies.clear(); p.abilityCooldown = 0; send(A, "ability", {}); room.shadowDash.get("A").t0 -= 400; tick(1);
  p.shadow = 0.04; tick(2); ok(p.shadow === 0 && p.fire > 4.8, "if she never attacks, invisibility runs out and the katana catches fire anyway");
  // Q: Blade Storm
  p.fire = 0; p.ultKills = 99; send(A, "ult"); ok(!(p.storm > 0), "Q is locked before 100 kills");
  p.ultKills = 100; tick(1); send(A, "ult"); ok(p.storm === 10, "Q: Blade Storm for 10s");
  const ring = [0, 2, 4].map(o => placeZombie(room, p.x + 90 * Math.cos(o), p.y + 90 * Math.sin(o), 1000)), far = placeZombie(room, p.x + 300, p.y, 1000);
  tick(20); ok(ring.every(z => z.hp < 1000) && far.hp === 1000, "...slashes everything around her, not far away");
  room.lastMelee.clear(); const fh = far.hp; far.x = p.x + 60; ring.forEach(z => room.state.zombies.delete(z.id)); far.x = p.x + 300;
  p.storm = 0.04; tick(2); ok(p.storm === 0 && p.ultCd > 58 && !p.ultReady, `after 10s the storm ends and the 60s cooldown starts (${p.ultCd}s)`);
  // tiers
  room.state.zombies.clear(); p.katanaKills = 49; p.storm = 0; placeZombie(room, p.x + 50, p.y, 1); room.lastMelee.clear(); send(A, "attack", { a: 0 });
  ok(p.katanaKills === 50 && p.katanaTier === 1, `50 katana kills -> katana tier 1 (Honed Edge)`);
  room._dispose(); }
// 30. DANTE (Demolitionist): shotgun, Breacher Blast (E), Demo Ripple (Q)
{ const room = new SurvivalRoom(); room.onCreate({ site: 0 }); room.state.noCd = false; room.mapGrid = new Map(); const events = []; room._onBroadcast = (type, m) => events.push({ type, ...m });
  const A = { sessionId: "A" }, B = { sessionId: "B" }; room.onJoin(A, { name: "Dante" }); room.onJoin(B, { name: "Friend" });
  const send = (c, t, d) => room._handlers[t](c, d), p = room.state.players.get("A"), q = room.state.players.get("B");
  send(A, "chooseClass", { id: "demolitionist" }); room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear();
  const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  ok(p.weapon === "launcher" && p.activeSlot === 2 && p.owned.includes("launcher"), "Dante starts with his rocket launcher");
  p.x = 1000; p.y = 1000; q.x = 300; q.y = 300; p.aim = 0;
  const flush = () => { for (const e of room.ripples) e.t -= 5000; tick(1); };
  const near = placeZombie(room, p.x + 200, p.y, 1000), far = placeZombie(room, p.x + 260, p.y, 1000), past = placeZombie(room, p.x + 420, p.y, 1000);
  p.lastShot = 0; send(A, "attack", { a: 0, d: 230 }); ok(near.hp === 1000, "the rocket is still flying (no instant hit)");
  flush(); ok(near.hp < 1000 && far.hp < 1000 && past.hp === 1000, "...then explodes where he aimed, not at the first zombie (and not past it)");
  room.state.zombies.clear();
  const zs3 = [0, 1, 2, 3, 4].map(i => placeZombie(room, p.x + 300 + (i - 2) * 30, p.y + (i % 2) * 30, 1000));
  send(A, "ability", { a: 0, d: 300 }); const sky = events.filter(e => e.type === "sky").pop();
  ok(sky && sky.pts.length === 3 && sky.pts.every(([x, y]) => Math.hypot(x - (p.x + 300), y - p.y) <= 81), "E: Sky Barrage sends 3 rockets up, landing at random spots around the aimed point");
  ok(room.ripples.filter(e => e.kind === "sky").map(e => e.at).join() === "0.85,1,1.15", "...fired one by one, 0.15s apart");
  ok(zs3.every(z => z.hp === 1000), "...nothing explodes until they come down"); flush();
  ok(zs3.filter(z => z.hp < 1000).length >= 3, `...then they blow up the zombies there (${zs3.filter(z => z.hp < 1000).length}/5 hit)`);
  ok(p.abilityCooldown > 7.8, "...8s cooldown");
  room.state.zombies.clear();
  // Q: Demo Ripple
  p.ultKills = 99; send(A, "ult"); ok(!room.demoOf(p), "Q is locked before 100 kills");
  p.ultKills = 100; tick(1); send(A, "ult"); const crate = room.demoOf(p);
  ok(crate && crate.deploy > 0, "Q: Dante plants the demo charge");
  send(A, "ult"); ok(room.demoOf(p), "...it needs a second to arm before it can blow");
  tick(25); p.x = 600; p.y = 600;
  const zs = { core: placeZombie(room, crate.x + 20, crate.y, 2000), r1: placeZombie(room, crate.x + 90, crate.y, 2000), r3: placeZombie(room, crate.x - 300, crate.y, 2000), far: placeZombie(room, crate.x + 700, crate.y, 2000) };
  tick(2); ok(room.demoOf(p) && zs.core.hp === 2000, "it waits for Dante's signal");
  send(A, "ult"); ok(!room.demoOf(p), "Q again: BOOM");
  tick(1); ok(zs.core.hp <= 1700, `the crate blast hits hard (${Math.round(2000 - zs.core.hp)} dmg)`);
  { const pts = events.filter(e => e.type === "demo" && e.k === "boom").pop().pts, g1 = pts.find(g => g[2] === 0), g3 = pts.find(g => g[2] === 2); zs.r1.x = g1[0]; zs.r1.y = g1[1]; zs.r3.x = g3[0]; zs.r3.y = g3[1]; }   // stand where an inner / outer grenade lands (they scatter randomly)
  const r1hp = zs.r1.hp; for (const e of room.ripples) e.t -= 2000; tick(1);
  const demo = events.filter(e => e.type === "demo" && e.k === "boom").pop();
  ok(demo && [0, 1, 2].map(r => demo.pts.filter(g => g[2] === r).length).join() === "4,8,16", "the ripples throw 4, 8 and 16 grenades");
  ok(zs.r1.hp < r1hp && zs.r3.hp < 2000 && zs.far.hp === 2000, `the grenade rings ripple out (ring 1: ${Math.round(r1hp - zs.r1.hp)}, ring 3: ${Math.round(2000 - zs.r3.hp)} dmg; far: untouched)`);
  ok(p.ultCd > 58 && !p.ultReady, `after the last ring the 60s cooldown starts (${p.ultCd}s)`);
  room.ultInfo.get("A").readyAt = 0; tick(1); send(A, "ult"); const c2 = room.demoOf(p); room.ultInfo.get("A").summonedAt -= 30001; tick(1);
  ok(c2 && !room.demoOf(p), "left alone, the charge blows itself after 30s");
  room._dispose(); }
// 31. THE HIVEMIND: mini boss on waves 2, 6, 10... (between the boss waves)
{ const { room, events, A, B, P } = makeRoom(); const p = P(A), q = P(B); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  const hive = () => [...room.state.zombies.values()].find(z => z.kind === "hivemind");
  room.state.elapsed = 39; tick(1); ok(!hive(), "wave 1: no Hivemind");
  room.state.stage = 2; room.beginWave(); room.spawnClock = 9999; room.state.elapsed = 39.9; tick(4);
  const h = hive(); ok(h && events.some(e => e.type === "hive" && e.k === "arrive"), "wave 2: THE HIVEMIND crawls in partway through the wave");
  ok(h.maxHp > 1200 && h.maxHp < 1400, `...with ${Math.round(h.maxHp)} HP (2 survivors)`);
  room.state.zombies.clear(); room.state.zombies.set(h.id, h); room.spawnClock = 9999;
  room.state.elapsed = 95; tick(2); ok(room.state.phase === "playing", "the wave doesn't end while it's alive");
  // moves
  h.x = 1000; h.y = 1000; p.x = 1100; p.y = 1000; q.x = 3000; q.y = 2000; p.hp = p.maxHp; room.hiveMem.get(h.id).spawnAt = Date.now() + 1e6; room.hiveMem.get(h.id).biteReady = 0;
  tick(1); ok(h.act === "bite", "it bites survivors up close"); tick(12); ok(p.hp < p.maxHp, `...and the bite hurts (${Math.round(p.maxHp - p.hp)} dmg)`);
  p.hp = p.maxHp; h.act = ""; room.hiveMem.get(h.id).biteReady = Date.now() + 1e6; room.hiveMem.get(h.id).slamReady = 0; p.x = 1150; tick(1);
  ok(h.act === "slam", "it slams the ground"); tick(14); ok(p.hp < p.maxHp && p.stunned > 0, "...the slam hurts and stuns");
  h.act = ""; p.stunned = 0; room.hiveMem.get(h.id).slamReady = Date.now() + 1e6; room.hiveMem.get(h.id).jumpReady = 0; p.x = h.x + 500; p.y = h.y; const hx = h.x; tick(1);
  ok(h.act === "jump", "it leaps at survivors far away"); tick(30); ok(h.x - hx > 350, `...and lands near them (${Math.round(h.x - hx)}px)`);
  const nz = room.state.zombies.size; room.hiveMem.get(h.id).spawnAt = 0; h.act = ""; tick(1); ok(room.state.zombies.size > nz && events.some(e => e.type === "hive" && e.k === "spawn"), "it tears zombies out of its body");
  const gold = p.currency; room.hitZombie(h, p, 1e6); ok(!hive() && p.currency >= gold + 40, "killing it pays everyone gold");
  room.state.zombies.clear(); tick(2); ok(room.state.phase === "cleared", "...and then the wave can end");
  room.state.phase = "playing"; room.inBreak = false; room.state.stage = 3; room.beginWave(); room.state.elapsed = 50; room.spawnClock = 9999; tick(1); ok(!hive(), "wave 3: no Hivemind");
  room.state.stage = 10; room.beginWave(); room.state.elapsed = 41; room.spawnClock = 9999; tick(1); ok(hive() && hive().maxHp > h.maxHp, "wave 10: it's back, tougher (not on wave 6: the Alpha Hivemind is wave 8's boss)");
  room._dispose(); }
// 32. online: the host can skip to the Butcher fight (other players can't)
{ const { room, A, B } = makeRoom(); room.state.stage = 2; room.beginWave(); room.state.elapsed = 20;
  room._handlers.debugBoss(B); ok(room.state.stage === 2, "a non-host player can't skip to the Butcher");
  room._handlers.debugBoss(A); ok(room.state.stage === 4 && room.state.waveType === "boss" && room.state.bossPhase === "horde" && room.state.zombies.size === 0, "the host skips straight to the Butcher (intro next)");
  room._dispose(); }
// 33. SOFEA (operator): E = tank 30s (cannon + run-over), Q = helicopter 30s (machine gun cone, flies over buildings), then cooldowns
{ const { room, events, A, B, send, P } = makeRoom(); const p = P(A), q = P(B); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room.state.phase = "lobby"; room.allowAllClasses = true; p.characterClass = "operator"; send(A, "chooseClass", { id: "operator" }); room.state.phase = "playing";
  ok(p.characterClass === "operator" && p.maxHp === 115 && p.speed === 180, "Sofea: 115 HP, speed 180");
  p.x = 900; p.y = 900; q.x = 3000; q.y = 2000;
  send(A, "ability", { a: 0 }); const v = room.state.vehicles.get("A");
  ok(v && v.kind === "tank" && v.phase === "call", "E: radio call for the tank");
  tick(18); ok(v.phase === "ride" && Math.abs(v.left - 30) < 0.2 && p.abilityCooldown === 0, `...then she's driving it for 30s (${v.left.toFixed(1)}s left)`);
  send(A, "ability", {}); ok(room.state.vehicles.size === 1, "E again does nothing while she's in it");
  const x0 = p.x; for (let i = 0; i < 10; i++) { room.lastInputs.set("A", Date.now() - 100); send(A, "input", { dx: 1, dy: 0, a: 0 }); }
  ok(p.x - x0 > 120 && p.x - x0 < 150 && Math.abs(v.x - p.x) < 1, `WASD drives the tank at ~140 px/s (${Math.round(p.x - x0)}px in 1s)`);
  // run-over
  const z = placeZombie(room, p.x + 60, p.y, 500); const hp0 = z.hp;
  for (let i = 0; i < 3; i++) { room.lastInputs.set("A", Date.now() - 100); send(A, "input", { dx: 1, dy: 0, a: 0 }); }
  ok(z.hp < hp0 && hp0 - z.hp <= 60, `driving into a zombie runs it over (${Math.round(hp0 - z.hp)} dmg, not again within 0.75s)`);
  room.state.zombies.clear();
  // cannon
  const t = placeZombie(room, p.x + 300, p.y, 500); events.length = 0;
  send(A, "attack", { a: 0, d: 300 }); send(A, "attack", { a: 0, d: 300 }); room.ripples.forEach(r => r.t -= 3000);
  ok(events.filter(e => e.type === "sofea" && e.k === "fire").length === 1, "left click fires the cannon (once per 1.5s)");
  tick(12); ok(t.hp < 500 - 60 && t.hp > 500 - 80, `the shell flies to the click and explodes (${Math.round(500 - t.hp)} dmg)`);
  room.state.zombies.clear();
  // armour: 35% less damage
  const hpA = p.hp, bz = placeZombie(room, p.x + 40, p.y, 9999); bz.attackCooldown = 0; bz.damage = 20; bz.role = "hunter"; tick(1);
  ok(p.hp < hpA && Math.abs((hpA - p.hp) - 20 * 0.65) < 1.5, `the tank takes 35% off hits (${(hpA - p.hp).toFixed(1)} of 20)`);
  room.state.zombies.clear();
  // ride ends -> out next to it, cooldown 30s
  v.left = 0.05; tick(2); ok(!room.state.vehicles.has("A") && p.abilityCooldown > 29, `after 30s she gets out and E cools down 30s (${p.abilityCooldown.toFixed(1)}s)`);
  ok(!room.blockedByMap(p.x, p.y, 10) && p.alive, "...on clear ground");
  // helicopter
  q.hp = q.maxHp; p.hp = p.maxHp; p.ultKills = 100; tick(1); ok(p.ultReady, "Q unlocks at 100 kills");
  send(A, "ult", { a: 0 }); const h = room.state.vehicles.get("A"); ok(h && h.kind === "heli", "Q: radio call for the helicopter"); tick(18);
  ok(h.phase === "ride", "...she flies it");
  const zz = placeZombie(room, p.x + 30, p.y, 500); zz.attackCooldown = 0; zz.role = "hunter"; zz.damage = 20; const hpH = p.hp; tick(3);
  ok(p.hp === hpH, "zombies on the ground can't reach the helicopter");
  room.state.zombies.clear(); h.aim = 0; const r1 = placeZombie(room, p.x + 120, p.y, 500), r2 = placeZombie(room, p.x + 100, p.y + 80, 500), back = placeZombie(room, p.x - 150, p.y, 500), far = placeZombie(room, p.x + 380, p.y, 500), long = placeZombie(room, p.x + 240, p.y, 500);
  const hold = (n, a = 0) => { for (let i = 0; i < n; i++) { send(A, "input", { dx: 0, dy: 0, a, f: 1 }); tick(1); } };
  tick(20); ok(r1.hp === 500 && !h.fire, "the helicopter gun doesn't fire unless she holds the mouse");
  hold(20); ok(500 - r1.hp > 50 && 500 - r2.hp > 50 && h.fire, `holding fire: it hits everything in the 90-degree cone (${Math.round(500 - r1.hp)}, ${Math.round(500 - r2.hp)} dmg in 1s)`);
  { send(A, "input", { dx: 0, dy: 0, a: 0, f: 0 }); const h1 = r1.hp; tick(20); ok(r1.hp === h1 && !h.fire, "...let go: it stops at once"); }
  ok(back.hp === 500 && far.hp === 500 && long.hp < 500, "...reaches 250px (hits a zombie 240px away), nothing behind her or at 380px");
  hold(10, Math.PI); ok(back.hp < 500, "...the cone turns with her aim");
  { room.state.zombies.clear(); const x0 = p.x; room.mapBoxesNear = () => [{ x: x0 + 60, y: p.y, hw: 30, hh: 200 }]; for (let i = 0; i < 10; i++) send(A, "input", { dx: 1, dy: 0, a: 0 }), room.lastInputs.set("A", Date.now() - 50);
    ok(p.x > x0 + 100, `she flies straight over buildings (x ${Math.round(x0)} -> ${Math.round(p.x)}, building at ${Math.round(x0 + 30)}-${Math.round(x0 + 90)})`); delete room.mapBoxesNear; }
  h.left = 0.05; tick(2); ok(!room.state.vehicles.has("A") && p.ultCd > 59, `after 30s she lands; Q cools down 60s (${p.ultCd}s)`);
  // can't call the tank with no room / while downed the vehicle goes
  send(A, "ability", {}); ok(!room.state.vehicles.has("A"), "E is on cooldown");
  p.abilityCooldown = 0; send(A, "ability", {}); tick(18); room.vmemory.get("A").protectUntil = 0; p.hp = 1; const killer = placeZombie(room, p.x + 30, p.y, 9999); killer.attackCooldown = 0; killer.damage = 500; killer.role = "hunter"; tick(3);
  ok(!p.alive && !room.state.vehicles.has("A"), "if she goes down, the tank goes away (normal downed rules)");
  room._dispose(); }
// 33b. SOFEA R: Crimson Aegis mecha (transform 1s, 30s ride, flame held / saber right click, shared timer, 100s cooldown from getting out)
{ const { room, events, A, B, send, P } = makeRoom(); const p = P(A), q = P(B); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room.state.phase = "lobby"; room.allowAllClasses = true; send(A, "chooseClass", { id: "operator" }); room.state.phase = "playing";
  p.x = 900; p.y = 900; q.x = 3000; q.y = 2000; room.mapBoxesNear = () => []; room.state.zombies.clear(); room.spawnClock = 9999;
  send(A, "skill2"); const v = room.state.vehicles.get("A");
  ok(v && v.kind === "mecha" && v.phase === "call" && Math.abs(v.left - 1) < .01, "R on foot: she starts transforming (1s)");
  tick(21); ok(v.phase === "ride" && Math.abs(v.left - 30) < 0.2, `...then she pilots the mecha for 30s (${v.left.toFixed(1)}s left)`);
  send(A, "ability", {}); send(A, "ult", {}); ok(room.state.vehicles.get("A") === v, "E / Q do nothing while she's in it");
  const x0 = p.x; for (let i = 0; i < 10; i++) { room.lastInputs.set("A", Date.now() - 100); send(A, "input", { dx: 1, dy: 0, a: 0 }); }
  ok(p.x - x0 > 135 && p.x - x0 < 160, `WASD walks it at 150 px/s (${Math.round(p.x - x0)}px in 1s)`);
  // no run-over
  { const z = placeZombie(room, p.x + 40, p.y, 500); z.damage = 0; for (let i = 0; i < 3; i++) { room.lastInputs.set("A", Date.now() - 100); send(A, "input", { dx: 1, dy: 0, a: 0 }); } ok(z.hp === 500, "walking into a zombie does no run-over damage"); room.state.zombies.clear(); }
  // flame: held, cone 42 degrees, 190px, 12 dmg every 0.25s
  const mk = (dx, dy) => { const z = placeZombie(room, p.x + dx, p.y + dy, 500); z.damage = 0; z.speed = 0; return z; };
  const a1 = mk(120, 0), a2 = mk(180, 20), wide = mk(100, 70), far = mk(240, 0), back = mk(-120, 0);
  const hold = (n, a = 0) => { for (let i = 0; i < n; i++) { send(A, "input", { dx: 0, dy: 0, a, f: 1 }); tick(1); } };
  tick(10); ok(a1.hp === 500 && !v.fire, "no flame unless she holds left click");
  hold(20); ok(a1.hp === 500 - 48 && a2.hp === 500 - 48 && v.fire, `holding: 12 dmg every 0.25s to everything in the cone (${500 - a1.hp}, ${500 - a2.hp} dmg in 1s)`);
  ok(wide.hp === 500 && far.hp === 500 && back.hp === 500, "...60 degrees wide, 190px long (not 35 degrees off, 240px away or behind her)");
  { send(A, "input", { dx: 0, dy: 0, a: 0, f: 0 }); const h = a1.hp; tick(10); ok(a1.hp === h && !v.fire, "...let go: it stops"); }
  // walls block it
  { room.setMapBoxes([{ x: p.x + 60, y: p.y, hw: 10, hh: 60 }]); const h = a1.hp; hold(8); ok(a1.hp === h, "the flame doesn't go through a wall"); room.setMapBoxes([]); send(A, "input", { a: 0, f: 0 }); tick(10); }
  // saber: right click, 155px 120 degrees, 80 dmg once per zombie, 0.9s swing, shares the timer with the flame
  room.state.zombies.clear(); const s1 = mk(90, 0), s2 = mk(25, 85), s3 = mk(170, 0), s4 = mk(-100, 0); events.length = 0;
  send(A, "mechaSlash", { a: 0 }); tick(8);
  ok(events.some(e => e.type === "sofea" && e.k === "slash") && s1.hp === 420 && s2.hp === 420, `right click: the saber sweeps 150 degrees for 80 (${500 - s1.hp}, ${500 - s2.hp})`);
  ok(s3.hp === 500 && s4.hp === 500, "...120px reach, nothing behind her");
  hold(8); ok(s1.hp === 420, "...once per swing; no flame until the 0.9s swing is over");
  hold(6); ok(s1.hp < 420, "...then the flame carries on");
  // damage taken: normal
  room.state.zombies.clear(); send(A, "input", { a: 0, f: 0 });
  { const hp = p.hp, z = placeZombie(room, p.x + 26, p.y, 9999); z.attackCooldown = 0; z.damage = 20; z.role = "hunter"; tick(1); ok(Math.abs((hp - p.hp) - 20) < 1.5, `she takes normal damage in it (${(hp - p.hp).toFixed(1)} of 20)`); room.state.zombies.clear(); }
  // R again: out early, cooldown 100s from getting out
  p.hp = p.maxHp; tick(1); send(A, "skill2"); tick(1);
  ok(!room.state.vehicles.has("A") && p.chargeCd > 99, `R again: she steps out; R cools down 100s (${p.chargeCd}s)`);
  send(A, "skill2"); ok(!room.state.vehicles.has("A"), "...R does nothing during the cooldown");
  room.vmemory.get("A").mechaReady = 0; send(A, "skill2"); tick(21); const v2 = room.state.vehicles.get("A"); v2.left = 0.05; tick(2);
  ok(!room.state.vehicles.has("A") && p.chargeCd > 99, "after 30s the ride ends and the 100s cooldown starts");
  room._dispose(); }
// 33d. Whiteout Station (Nov 10): a tight maze of Antarctic lab buildings, same piece system as Fallen Dynasty
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.state.phase = "lobby";
  room.fixedSite = true; room.loadSite(4);
  ok(room.state.mapSite === 4 && room.state.worldW === 4400 && room.state.worldH === 2800 && room.flow, "host picks Whiteout Station: 4400x2800, flow-field zombies");
  const lay = room.state.mapLayout.split(";").map(r => r.split(",").map(Number)), kinds = new Set(lay.map(r => r[0]));
  ok(lay.length > 100 && kinds.size > 25 && lay.every(r => r[0] >= 44), `built from its own pieces (${lay.length} pieces, ${kinds.size} kinds)`);
  ok(!room.blockedByMap(p.x, p.y, 0) && Math.hypot(p.x - 2200, p.y - 1400) < 260, "everyone starts in the open yard by the tower");
  ok(room.blockedByMap(2200, 120) && room.blockedByMap(600, 60) && !room.blockedByMap(2200, 300), "the perimeter wall and gate are solid right up to the map's top edge");
  // every open spot is reachable from the tower (no sealed pockets), and a boss-sized body can reach every lane
  const C = 20, GW = 220, GH = 140, flood = R => { const g = new Uint8Array(GW * GH); for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (room.blockedByMap(i * C + 10, j * C + 10, R)) g[j * GW + i] = 1;
    const q = [Math.floor(1510 / C) * GW + 110]; g[q[0]] = 2; for (let h = 0; h < q.length; h++) { const c = q[h], i = c % GW, j = (c - i) / GW; for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) if (a >= 0 && b >= 0 && a < GW && b < GH && !g[b * GW + a]) { g[b * GW + a] = 2; q.push(b * GW + a); } } return g; };
  const g0 = flood(16); ok(!g0.includes(0), `no sealed pockets: every open spot connects to the tower (${g0.filter(v => v === 0).length} cut off)`);
  const g1 = flood(28); ok(!g1.includes(0), `a boss's path body fits everywhere a survivor can go: no lane too narrow for him (${g1.filter(v => v === 0).length} cut off)`);
  const big = lay.filter(r => [44, 46, 47, 52].includes(r[0])), ys = new Set(big.map(r => Math.round(r[2] / 40))); ok(big.length >= 12 && ys.size >= 9, `buildings are scattered, not lined up in rows (${big.length} big buildings on ${ys.size} different lines)`);
  room._dispose(); }
// 33g. turrets stop shooting when the wave ends (user, Nov 10: they kept firing at where their last zombie was)
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.state.phase = "playing"; room.state.zombies.clear(); room.spawnClock = 1e9; room.state.scrap = 9999; room.state.electronics = 9999;
  p.x = 1000; p.y = 1000; send(A, "build", { kind: "turret", x: 1060, y: 1000 }); const st = [...room.state.structures.values()].find(o => o.kind === "turret");
  room.spawnZombie(true ? undefined : 0); const z = [...room.state.zombies.values()][0];
  if (st && z) { z.x = st.x + 120; z.y = st.y; z.hp = 1e6; z.speed = 0; room.lastTick = Date.now() - 50; room.tick(); }
  ok(st?.fire === true, `a turret fires at a zombie in range (${!!st}, ${!!z})`);
  room.state.phase = "cleared"; room.state.zombies.clear(); room.lastTick = Date.now() - 50; room.tick(); ok(st?.fire === false, "the wave ends: the turret stops firing");
  room._dispose(); }
// 33f. (Midnight Carnival: removed Nov 11)
// 33e. Scorched Refinery (Nov 10): open desert map, bosses walk out of the pyramid
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.state.phase = "lobby"; room.fixedSite = true; room.loadSite(5);
  ok(room.state.mapSite === 5 && room.state.worldW === 4400 && room.flow && room.bossDoor?.x === 2200, "host picks Scorched Refinery: 4400x2800, the pyramid's doorway is known");
  const lay = room.state.mapLayout.split(";").map(r => r.split(",").map(Number)); ok(lay.length > 120 && lay.every(r => r[0] >= 84), `built from its own pieces (${lay.length})`);
  ok(room.blockedByMap(2200, 500) && !room.blockedByMap(2200, 840) && !room.blockedByMap(2200, 1000) && !room.blockedByMap(p.x, p.y, 0), "the pyramid is solid; its steps, the road down from it and the yard are open");
  const C = 20, GW = 220, GH = 140, flood = R => { const g = new Uint8Array(GW * GH); for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (room.blockedByMap(i * C + 10, j * C + 10, R)) g[j * GW + i] = 1;
    const q = [Math.floor(1510 / C) * GW + 110]; g[q[0]] = 2; for (let h = 0; h < q.length; h++) { const c = q[h], i = c % GW, j = (c - i) / GW; for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) if (a >= 0 && b >= 0 && a < GW && b < GH && !g[b * GW + a]) { g[b * GW + a] = 2; q.push(b * GW + a); } } return g; };
  ok(!flood(16).includes(0) && !flood(28).includes(0), "no sealed pockets, and a boss fits wherever a survivor does");
  room.state.phase = "playing"; room.jumpToWave(4); room.state.zombies.clear(); room.spawnBoss(); const z = [...room.state.zombies.values()].find(o => o.boss);
  ok(z && Math.abs(z.x - 2200) < 60 && z.y > 700 && z.y < 820 && !room.blockedByMap(z.x, z.y, 0), `the boss walks out of the pyramid (${Math.round(z?.x)},${Math.round(z?.y)})`);
  room._dispose(); }
// 33h. The Deep Mine (Nov 11): a 6000x4000 underground map, the tower in the scavenge zone (top left), a long mine-cart loop, bosses climb out of the shaft
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.state.phase = "lobby"; room.fixedSite = true; room.loadSite(6);
  ok(room.state.mapSite === 6 && room.state.worldW === 6000 && room.state.worldH === 4000 && room.flow && room.state.towerX === 1450 && room.state.towerY === 1330, "host picks The Deep Mine: 6000x4000, the tower in the scavenge zone, flow-field zombies");
  const lay = room.state.mapLayout.split(";").map(r => r.split(",").map(Number)); ok(lay.length > 200 && lay.every(r => r[0] >= 186), `built from its own pieces (${lay.length})`);
  ok(!room.blockedByMap(p.x, p.y, 0) && Math.hypot(p.x - 1450, p.y - 1330) < 260, "everyone starts by the tower");
  const C = 20, GW = 300, GH = 200, flood = R => { const g = new Uint8Array(GW * GH); for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (room.blockedByMap(i * C + 10, j * C + 10, R)) g[j * GW + i] = 1;
    const q = [Math.floor(1450 / C) * GW + Math.floor(1450 / C)]; g[q[0]] = 2; for (let h = 0; h < q.length; h++) { const c = q[h], i = c % GW, j = (c - i) / GW; for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) if (a >= 0 && b >= 0 && a < GW && b < GH && !g[b * GW + a]) { g[b * GW + a] = 2; q.push(b * GW + a); } } return g; };
  const f16 = flood(16), f28 = flood(28), outside = (g, v) => g.filter((x, n) => x === v && !((n % GW) * C >= 3880 && Math.floor(n / GW) * C >= 2700)).length;
  ok(!outside(f16, 0) && !outside(f28, 0), `no sealed pockets outside the boss dungeon, and a boss fits wherever a survivor does (${outside(f16, 0)} / ${outside(f28, 0)} cut off)`);
  ok(f16[Math.floor(3400 / C) * GW + Math.floor(5000 / C)] === 0 && f16[Math.floor(3800 / C) * GW + Math.floor(4300 / C)] === 0, "the boss dungeon is cordoned off: nobody can walk in (only the carts go in)");
  const T = room.coaster?.T, st = T?.stations[0]; ok(T && T.L > 18000 && T.cfg?.H === 0 && st.x === 850 && st.y === 400, `the mine-cart loop: one station top left, ${Math.round(T?.L)}px long (${Math.round(T?.L / (T?.cfg?.speed || 1))}s a lap)`);
  ok(!room.blockedByMap(850, 640, 0) && !room.blockedByMap(850, 448, 0) && room.blockedByMap(640, 520, 0) && room.blockedByMap(850, 388, 0), "the station: up its steps onto the deck (open); the skirts beside the steps and the back rail are solid");
  room.state.phase = "playing"; room.state.zombies.clear(); room.spawnClock = 1e9; const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  p.x = 850; p.y = 650; room.coaster.wait = 5; send(A, "coaster"); ok(p.ride === 1, "F at the station while the carts are in: you get in");
  tick(140); const c0 = { x: p.x, y: p.y }; tick(40); ok(Math.hypot(p.x - c0.x, p.y - c0.y) > 400 && p.ride === 1, `the carts roll off along the track with you in them (${Math.round(Math.hypot(p.x - c0.x, p.y - c0.y))}px in 2s)`);
  p.hp = 1e6; tick(Math.ceil(T.L / T.cfg.speed * 20) + 200); ok(p.ride === 0 && !room.blockedByMap(p.x, p.y, 0) && Math.abs(p.x - 850) < 260 && p.y > 400 && p.y < 520, `one lap later you get out onto the station's deck (${Math.round(p.x)},${Math.round(p.y)})`);
  // the boss stop (user, Nov 11): hop off in the dungeon, the carts wait until you're back on, then take you back to the station
  room.coaster.cd.clear(); p.rideCd = 0; p.x = 850; p.y = 650; for (let i = 0; i < 2000 && !(room.coaster.wait > 0 && room.coaster.next === 0); i++) tick(1); send(A, "coaster");
  for (let i = 0; i < 3000 && !(room.coaster.wait > 0 && room.coaster.next === 1); i++) tick(1); const bs = T.stations[1];
  ok(p.ride > 0 && T.stations.length === 2 && bs.boss && Math.hypot(p.x - bs.x, p.y - bs.y) < 260, `the carts stop at the boss stop inside the dungeon (${bs.x},${bs.y})`);
  send(A, "coaster"); ok(p.ride === 0 && p.x > 3880 && p.y > 2700 && !room.blockedByMap(p.x, p.y, 0) && !(p.rideCd > 0), `hop off there: you're on the platform in the dungeon, no cooldown (${Math.round(p.x)},${Math.round(p.y)})`);
  const sHold = room.coaster.s; tick(600); ok(room.coaster.s === sHold && room.coaster.wait > 0 && room.state.coasterWait === 1001, "30s later the carts are still waiting for you (\"waiting for 1\")");
  send(A, "coaster"); tick(200); ok(p.ride > 0 && room.coaster.s !== sHold, "hop back on: the carts leave");
  for (let i = 0; i < 3000 && p.ride > 0; i++) tick(1); ok(p.ride === 0 && Math.abs(p.x - 850) < 260 && p.y > 400 && p.y < 520, `they take you back to the station (${Math.round(p.x)},${Math.round(p.y)})`);
  // nobody gets into the boss dungeon except by cart (user, Nov 11): not Sofea's helicopter, not a dash through the wall, not a zombie
  room.state.zombies.clear(); p.hp = p.maxHp; p.x = 4600; p.y = 2600; p.characterClass = "operator"; const okH = room.callVehicle(p, "heli"); for (let i = 0; i < 100 && room.state.vehicles.get(p.sessionId)?.phase !== "ride"; i++) tick(1);
  const hv = room.state.vehicles.get(p.sessionId); for (let i = 0; i < 200; i++) { room.moveVehicle(p, hv, 0, 1, .05); } tick(1);
  ok(okH && hv?.phase === "ride" && p.y < 2775 && p.y > 2600, `Sofea's helicopter can't fly over the dungeon wall (stopped at y ${Math.round(p.y)})`);
  for (let i = 0; i < 400; i++) room.moveVehicle(p, hv, 1, 1, .05); ok(!(p.x > 3965 && p.y > 2820), `...nor slide in along it (${Math.round(p.x)},${Math.round(p.y)})`);
  room.state.vehicles.delete(p.sessionId); p.x = 4500; p.y = 3500; tick(1); ok(!(p.x > 3965 && p.y > 2820) && !room.blockedByMap(p.x, p.y, 0), `someone who ends up inside without the cart (a dash through the wall) is put back outside (${Math.round(p.x)},${Math.round(p.y)})`);
  const zi = placeZombie(room, 5200, 3600, 500); zi.speed = 0; tick(1); ok(!(zi.x > 3965 && zi.y > 2820), `a zombie that gets inside is put back outside too (${Math.round(zi.x)},${Math.round(zi.y)})`); room.state.zombies.clear();
  room.jumpToWave(4); room.state.zombies.clear(); room.spawnBoss(); const z = [...room.state.zombies.values()].find(o => o.boss);
  ok(z && Math.abs(z.x - 2450) < 60 && Math.abs(z.y - 952) < 40 && !room.blockedByMap(z.x, z.y, 0), `the boss climbs out of the DANGER shaft (${Math.round(z?.x)},${Math.round(z?.y)})`);
  room._dispose(); }
// 33i. WAVE 20: the Deep Mine mission (Nov 11): runes -> fuel -> ride -> statue, four times; the Mine Beast fight in the dungeon; it chases the carts for a lap; the portal
{ const { room, A, B, send, P } = makeRoom(); const p = P(A), q = P(B); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); for (const o of [p, q]) { o.hp = o.maxHp; if (!o.alive) { o.alive = true; o.bledOut = false; o.bleedout = 0; } } } };
  room.state.phase = "lobby"; room.fixedSite = true; room.loadSite(4); room.state.phase = "playing"; room.state.scrap = 9999; p.x = 2200; p.y = 1700; send(A, "build", { kind: "barricade", x: 2260, y: 1700 }); const nSt = room.state.structures.size;
  room.jumpToWave(20); const m = room.mine, C = room.coaster, T = C?.T;
  ok(m && room.state.mapSite === 6 && room.state.waveType === "mission" && room.state.mission.startsWith("runes|0|0|") && room.state.structures.size === 0 && Math.hypot(p.x - 1450, p.y - 1330) < 300, `wave 20 takes the team to the Deep Mine: mission on, 4 runes at their shrines (${room.state.mission.slice(0, 40)}...)`);
  tick(200); ok(room.state.phase === "playing" && C.wait > 0 && C.next === 0, "the wave doesn't end on a timer, and the carts wait at the station");
  const ride = () => { for (let i = 0; i < 4000 && !(C.wait > 0 && C.next === 1); i++) tick(1); }, home = () => { for (let i = 0; i < 4000 && !(C.wait > 0 && C.next === 0 && !(p.ride > 0)); i++) tick(1); };
  for (let n = 1; n <= 4; n++) {
    const r = m.runes.find(o => o.st === 0); p.x = r.x; p.y = r.y + 40; send(A, "deep"); const got = r.st === 1 && r.by === "A";
    p.x = 850; p.y = 470; room.coaster.cd.clear(); send(A, "coaster"); const s0 = C.s; tick(200); const stayed = C.s === s0 && p.ride > 0;
    m.fuel = 5; tick(140); const left = C.s !== s0; ride(); send(A, "coaster"); const off = p.ride === 0 && room.inCordon(p);
    if (n === 1) { ok(got, "F at a shrine: you take its rune"); ok(stayed, "a rune aboard but no fuel: the carts don't leave"); ok(left && m.fuel === 0, "5 shards of fuel: they leave (and the fuel is used)"); ok(off, "hop off at the boss stop, inside the dungeon");
      send(A, "deep"); ok(m.placed === 0, "F far from the statue does nothing"); }
    const ST = room.minePieces.statue; p.x = ST.x; p.y = ST.y + 40; send(A, "deep");
    if (n === 1) { ok(m.placed === 1 && r.st === 3 && m.inserted, "F at the statue's plinth: the rune goes in (1/4)"); const b0 = C.s; tick(100); ok(C.s === b0, "the carts wait while you're off"); }
    if (n < 4) { p.x = T.stations[1].x; p.y = T.stations[1].y - 150; send(A, "coaster"); home(); if (n === 1) ok(p.ride === 0 && Math.abs(p.x - 850) < 260 && !room.inCordon(p), `they take you back to the station (${Math.round(p.x)},${Math.round(p.y)})`); }
  }
  ok(m.placed === 4 && m.step === "awake" && room.inCordon(p) && room.inCordon(q) && !(p.ride > 0), "the fourth rune wakes the Mine Beast: the whole team is pulled into the dungeon in front of the statue"); tick(Math.ceil(7 / .05) + 5);
  const z = [...room.state.zombies.values()].find(o => o.kind === "minebeast"); ok(m.step === "fight" && z?.boss && z.hp > 5000, `the fight: the Mine Beast, a boss with its own health bar (${Math.round(z?.hp)} HP)`);
  // its skills, one at a time (the team kept alive by the test's tick)
  const bm = () => room.bossMem.get(z.id), ev = []; room._onBroadcast = (t, d) => { if (t === "deep") ev.push(d.k); }; const idle = () => { z.act = ""; z.slam = 0; const b = bm(); if (b) { b.next = 1e15; b.strikeReady = 1e15; } room.mine.haz = []; };
  tick(2); idle(); p.x = z.x; p.y = z.y + 150; q.x = z.x + 600; q.y = z.y + 500; bm().strikeReady = 0; p.maxHp = 1e5; p.hp = 1e5; let hp0 = p.hp, lost = 0; tick(1); const st1 = z.act; for (let i = 0; i < 30; i++) { room.lastTick = Date.now() - 50; room.tick(); lost += hp0 - p.hp; p.hp = hp0; }
  ok(st1 === "strike" && ev.filter(k => k === "jab").length === 2 && lost > 0, `DRILL STRIKE: two jabs at whoever is in front (${Math.round(lost)} dmg)`);
  idle(); p.hp = p.maxHp; p.x = z.x + 400; p.y = z.y + 300; bm().next = 0; bm().spinesReady = 0; bm().chargeReady = bm().burrowReady = bm().caveReady = 1e15; tick(20); const hz = room.mine.haz.length; idle(); room.mine.haz = [];
  ok(ev.includes("spines") && hz === 5, "CRYSTAL SPINES: five crystals stick in the floor in a fan, then shatter");
  bm().next = 0; bm().caveReady = 0; bm().spinesReady = 1e15; tick(25); ok(ev.includes("cavein") && room.mine.haz.length >= 4 + 3, `CAVE-IN: rocks fall on marked circles (${room.mine.haz.length}; q alive ${q.alive} in ${room.inCordon(q)} at ${Math.round(q.x)},${Math.round(q.y)}; z ${Math.round(z.x)},${Math.round(z.y)})`); idle();
  bm().next = 0; bm().burrowReady = 0; bm().caveReady = 1e15; p.x = z.x + 500; p.y = z.y + 420; q.x = p.x + 30; q.y = p.y; tick(1); const dv = z.act; tick(25); const un = z.act, hpU = z.hp; room.hitZombie(z, p, 500); const safe = z.hp === hpU; for (let i = 0; i < 200 && z.act !== "emerge"; i++) tick(1);
  ok(dv === "dive" && un === "under" && safe && ev.includes("erupt") && ev.includes("burst") && Math.hypot(z.x - p.x, z.y - p.y) < 200, "BURROW: it dives, tunnels to a survivor (can't be hurt underground) and erupts under a marked circle"); idle();
  { const MK = (await import(join(root, "server/src/mapLayout.js"))).MAP_KINDS, kindIdx = n => MK.indexOf(n), L = room.state.mapLayout.split(";").map(r => r.split(",").map(Number)), K = (name) => L.filter(r => r[0] === kindIdx(name)); const cd = K("mCandles")[0], br = K("mBrazier")[0], mi = K("mMiner")[0] || K("mMinerBroken")[0], ST = room.minePieces.statue;
    ok(cd && br && mi && !room.blockedByMap(cd[1], cd[2] - 8, 0) && !room.blockedByMap(br[1], br[2] - 30, 0) && !room.blockedByMap(mi[1], mi[2] - 40, 0), "the dungeon's small things (candles, braziers, kneeling miners) don't block anyone");
    { const was = room.statueBroken; room.statueBroken = false; room.refreshMapBoxes(); ok(room.blockedByMap(ST.x, ST.y - 400, 0) && room.blockedByMap(room.minePieces.portal.x, room.minePieces.portal.y - 350, 0), "while the statue stands nobody can walk out of sight behind it (or the portal)"); room.statueBroken = was; room.refreshMapBoxes(); }
    idle(); p.characterClass = "operator"; p.x = z.x + 300; p.y = z.y + 250; const got = room.callVehicle(p, "heli"); for (let i = 0; i < 100 && room.state.vehicles.get(p.sessionId)?.phase !== "ride"; i++) tick(1); const hv = room.state.vehicles.get(p.sessionId); for (let i = 0; i < 300; i++) room.moveVehicle(p, hv, -1, -1, .05);
    ok(got && hv?.phase === "ride" && room.inCordon(p), `Sofea can call her helicopter in the fight, and it stays inside the dungeon (${Math.round(p.x)},${Math.round(p.y)})`); room.dismount(p, hv, Date.now()); p.x = z.x + 300; p.y = z.y + 250; idle(); }
  bm().next = 0; bm().chargeReady = 0; bm().burrowReady = 1e15; p.x = z.x - 700; p.y = z.y; q.x = z.x - 650; q.y = z.y + 300; tick(1); const wd = z.act; tick(40); const ch = z.act, x0 = z.x; tick(12); ok(wd === "wind" && ch === "charge" && z.x < x0 - 200, `DRILL CHARGE: it winds up, then charges down the lane (${Math.round(x0 - z.x)}px in .6s)`); for (let i = 0; i < 60 && z.act; i++) tick(1); idle();
  bm().next = 0; bm().chargeReady = 0; p.x = z.x + 600; p.y = z.y; q.x = z.x + 600; q.y = z.y + 60; tick(3); room.hitZombie(z, p, z.maxHp * .05); tick(1); ok(z.act === "stagger" && ev.includes("broke"), "enough damage during the wind-up breaks the charge: it staggers"); idle();
  z.aim = Math.atan2(p.y - z.y, p.x - z.x); const hpS = z.hp; z.act = "stagger"; z.slam = 2; room.hitZombie(z, p, 100); ok(Math.abs(hpS - z.hp - 150) < 1, "staggered: it takes 50% more damage (hit from the front)"); idle();
  { /* Nov 12: crystal weak spots on its back, phase 2 at 50%, boulders from the cave-in, charging into a boulder stuns it */
    const M = room.mine; ev.length = 0; z.aim = 0; p.x = z.x + 300; p.y = z.y; let h0 = z.hp; room.hitZombie(z, p, 100); const front = h0 - z.hp; p.x = z.x - 300; h0 = z.hp; room.hitZombie(z, p, 100); const back = h0 - z.hp;
    ok(Math.abs(front - 100) < 1 && Math.abs(back - 200) < 1, `CRYSTALS: a hit from behind lands on the crystals on its back for double damage (${front} front, ${back} back)`);
    for (let i = 0; i < 600 && M.crystals > 0; i++) { z.act = ""; room.hitZombie(z, p, 40); }
    ok(M.crystals === 0 && z.act === "stagger" && Math.abs(z.slam - 5.5) < .01 && ev.filter(k => k === "crystal").length === 4 && room.state.mission.split("|")[7] === "0", "break all 4 crystals and it reels for 5.5s (and the count reaches the HUD)");
    idle(); h0 = z.hp; room.hitZombie(z, p, 100); ok(Math.abs(h0 - z.hp - 100) < 1, "with its crystals gone, hits from behind are normal again");
    idle(); z.hp = z.maxHp * .49; tick(1); ok(z.enraged && z.act === "roar" && M.crystals === 4 && ev.includes("phase2") && z.speed > 100, `PHASE 2 below 50%: it roars, enrages, its crystals grow back and it's faster (speed ${Math.round(z.speed)})`); M.shieldsDone = 9;   /* (the shield run is tested on its own below) */
    idle(); z.act = "skid"; z.actLen = .55; z.slam = .01; tick(1); ok(z.act === "roar" && ev.includes("chain"), "phase 2: a charge goes straight into a cave-in roar");
    idle(); z.act = "emerge"; z.actLen = 1; z.slam = .01; p.x = z.x + 300; p.y = z.y + 200; tick(1); ok(z.act === "throw", "phase 2: bursting out of the floor goes straight into a crystal throw");
    idle(); M.boulders = []; ev.length = 0; bm().next = 0; bm().caveReady = 0; bm().spinesReady = bm().burrowReady = bm().chargeReady = 1e15; for (let i = 0; i < 70 && !ev.includes("cavein"); i++) tick(1); for (const h of M.haz) h.at = 0; tick(1);   /* (hazards land on real time: make them land now) */
    ok(M.boulders.length > 0 && ev.includes("boulder"), `BOULDERS: the cave-in's stray rocks stay on the floor (${M.boulders.length}; ev ${ev.join(",")}; haz ${M.haz.length} act ${z.act})`); idle();
    { const S0 = room.minePieces.statue; z.x = S0.x + 400; z.y = S0.y + 330; }   /* (out in the open: the earlier tests can leave it in a corner) */
    M.boulders = [{ id: 999, x: Math.round(z.x - 250), y: Math.round(z.y), until: Date.now() + 1e6 }]; ev.length = 0; room.startAct(z, "charge", 2, Math.PI); bm().hit = new Set(); for (let i = 0; i < 20 && z.act === "charge"; i++) tick(1);
    ok(z.act === "stagger" && z.slam > 2.4 && ev.includes("bsmash") && !M.boulders.length, `its charge smashes into a boulder: it's stunned for 3s (${z.act} ${z.slam?.toFixed(2)})`);
    const hB = z.hp; z.aim = Math.atan2(p.y - z.y, p.x - z.x); M.crystals = 0; room.hitZombie(z, p, 100); ok(Math.abs(hB - z.hp - 150) < 1, "...and takes 50% more while stunned"); M.crystals = 4; idle(); }
  { /* Nov 12: the CRYSTAL SHIELD run: at 66% / 33% it's shielded (immune, heals), fed by one shrine; ONE rider takes the cart there (it waits until they're back on), overloads it (F, 3s): the shield shatters, 6s stun; express back */
    const M = room.mine, BS = () => T.stations.find(q => q.boss), SS = () => T.stations.find(q => q.shrine !== undefined); ev.length = 0; M.shieldsDone = 0; idle(); z.hp = z.maxHp * .6; tick(1);
    ok(z.act === "plunge" && M.shield && ev.includes("shield") && SS() && T.stations.length === 3, `SHIELD at 66%: it plunges its drills in, a shield goes up, and a cart stop appears by the glowing shrine (${T.stations.length} stops)`);
    idle(); let h1 = z.hp; room.hitZombie(z, p, 500); ok(z.hp >= h1, "shielded: it can't be hurt"); h1 = z.hp; tick(20); ok(z.hp > h1, `...and it slowly heals (${Math.round(z.hp - h1)} HP in 1s)`);
    idle(); h1 = z.hp; M.shield.t = 59.99; tick(1); ok(z.hp - h1 > z.maxHp * .09 && ev.includes("shieldPulse"), "60s with the shield up: it heals 10%");
    for (let i = 0; i < 200 && !(C.wait > 0 && T.stations[C.next]?.boss); i++) tick(1); idle(); const st = BS(); p.x = st.x; p.y = st.y - 150; q.x = st.x + 60; q.y = st.y - 150; send(A, "coaster"); send(B, "coaster");
    ok(p.ride > 0 && !(q.ride > 0), "ONE rider: the first one in rides, the second can't");
    let arrived = false; for (let i = 0; i < 900 && !arrived; i++) { idle(); tick(1); arrived = !(p.ride > 0); } const sh = room.shieldShrine(M.shield.i), stop = SS();
    ok(arrived && C.wait > 0 && T.stations[C.next] === stop && Math.hypot(p.x - sh.x, p.y - sh.y) < 420, `the cart takes them to the shrine's stop and lets them off (${Math.round(Math.hypot(p.x - sh.x, p.y - sh.y))}px from the shrine)`);
    const sS = C.s; for (let i = 0; i < 300; i++) { idle(); tick(1); } ok(C.s === sS && C.wait > 0, "the cart waits there until the rider is back on");
    p.x = sh.x; p.y = sh.y; send(A, "deep"); ok(M.shield?.by === "A", "F at the glowing shrine: overloading (stay close)");
    for (let i = 0; i < 70 && M.shield; i++) { p.x = sh.x; p.y = sh.y; tick(1); } ok(!M.shield && z.act === "stagger" && z.slam > 5 && ev.includes("shieldBreak"), `3s later THE SHIELD SHATTERS: it's stunned for 6s (${z.act} ${z.slam?.toFixed(1)})`);
    p.x = stop.x; p.y = stop.y + 40; send(A, "coaster"); ok(p.ride > 0, "back on the cart at the shrine stop");
    let home = false; for (let i = 0; i < 1500 && !home; i++) { idle(); tick(1); home = !(p.ride > 0); } ok(home && room.inCordon(p) && T.stations.length === 2 && !C.express, "express back to the boss stop: off you get, and the extra stop is gone");
    M.shieldsDone = 9; idle(); }
  room.hitZombie(z, p, 1e9); tick(1); ok(m.step === "flee" && room.state.zombies.has(z.id) && !z.boss, "its bar is empty: it can't be killed, it drops to a knee (get in the carts)");
  p.x = T.stations[1].x; p.y = T.stations[1].y - 150; send(A, "coaster"); const rode = p.ride > 0; tick(Math.ceil(10 / .05) + 10);
  ok(rode && m.step === "chase" && q.ride > 0, "F at the boss stop gets you aboard; when the time is up everyone left is put in the carts and it comes after them");
  tick(100); const g0 = m.gap; ok(g0 < 500 && C.wait === 0, `it closes in on the carts (${Math.round(g0)}px behind)`);
  room.hitZombie(z, p, 2000); tick(1); ok(m.gap > g0 + 100 && z.hp === z.maxHp, `shooting it shoves it back (${Math.round(g0)} -> ${Math.round(m.gap)}px) and can't kill it`);
  m.gap = 141; tick(2); ok(m.cartHp === 4 && m.gap > 380, "if it reaches the carts it smashes them (4 hits left) and falls back");
  for (let i = 0; i < 3000 && m.step === "chase"; i++) { tick(1); m.gap = Math.max(m.gap, 300); } ok(m.step === "escaped", "one lap later the carts roll back into the dungeon: through the portal");
  tick(80); ok(room.state.phase === "cleared" && !room.mine && room.state.mapSite === 4 && room.state.mission === "" && room.state.structures.size === nSt && p.ride === 0, `wave cleared: back on your own map, what you built is back (${room.state.structures.size} structure)`);
  send(A, "ready"); send(B, "ready"); room.startNextWave(); ok(room.state.stage === 21 && room.state.waveType === "normal" && room.state.mapSite === 4, "wave 21 carries on as normal");
  // the carts smashed = defeat; a dropped rune can be picked up again
  room.jumpToWave(20); const m2 = room.mine, r2 = m2.runes[0]; p.x = r2.x; p.y = r2.y + 40; send(A, "deep"); p.x = 1500; p.y = 1700; tick(2); p.alive = false; tick(2); ok(r2.st === 2 && Math.hypot(r2.x - 1500, r2.y - 1700) < 60, "the carrier goes down: the rune lies where they fell");
  p.alive = true; q.x = r2.x; q.y = r2.y; send(B, "deep"); ok(r2.st === 1 && r2.by === "B", "a teammate picks it up");
  room.mineAwaken(); ok(m2.step === "awake" && m2.placed === 4 && room.inCordon(p) && room.inCordon(q), "the test button: straight to the awakening, everyone teleported to the statue"); tick(150); ok(m2.step === "fight", "...then the fight"); { const S2 = room.minePieces.statue; ok(!room.blockedByMap(S2.x, S2.y - 400, 0) && !room.blockedByMap(S2.x + 190, S2.y - 450, 0) && room.blockedByMap(S2.x, S2.y - 152, 0), "once the Beast is out, the spot where the statue stood is walkable (only the plinth still blocks)"); }
  room.mineChase(); m2.gap = 100; m2.cartHp = 1; tick(2); ok(room.state.phase === "defeat", "the last hit on the carts ends the run");
  room._dispose(); }
// 33c. Fallen Dynasty: a bigger map built from Chinese-city pieces (same system as the city), flow-field zombies
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.state.phase = "lobby";
  room.fixedSite = true; room.loadSite(3);
  ok(room.state.mapSite === 3 && room.state.worldW === 4400 && room.state.worldH === 2800 && !room.state.mapLayout.startsWith("P:"), "host picks Fallen Dynasty: a bigger map (4400x2800) made of pieces");
  ok(room.state.towerX === 2200 && room.state.towerY === 1400 && room.flow, "the radio tower is in the middle; zombies use the flow field there");
  const kinds = new Set(room.state.mapLayout.split(";").map(r => Number(r.split(",")[0])));
  ok(kinds.size > 20, `it uses the new pieces (${kinds.size} kinds)`);
  ok(!room.blockedByMap(p.x, p.y, 0) && Math.hypot(p.x - 2200, p.y - 1400) < 260, `everyone moves onto the new map by the tower (${Math.round(p.x)},${Math.round(p.y)})`);
  ok(room.blockedByMap(2200 - 520, 238) && !room.blockedByMap(2200, 250), "the city wall is solid, the temple gate's arch is open");
  room.state.phase = "playing"; room.state.zombies.clear(); room.spawnClock = 1e9; room.state.elapsed = 10;
  const z = placeZombie(room, 300, 2500, 500); z.kind = "walker"; z.role = "tower"; z.speed = 120; z.damage = 0;
  for (let i = 0; i < 600; i++) { room.lastTick = Date.now() - 50; room.tick(); }
  ok(Math.hypot(z.x - 2200, z.y - 1400) < 150, `a zombie from the far corner finds its way round the buildings to the tower (${Math.round(z.x)},${Math.round(z.y)})`);
  room.state.phase = "lobby"; room.fixedSite = true; room.loadSite(0); ok(room.state.worldW === 3600 && room.state.towerX === 1800 && !room.flow, "back to a city site: the city map again");
  room._dispose(); }
// 34. test mode (host toggle): ultimates unlocked, no cooldown after they end
{ const { room, A, B, send, P } = makeRoom(); const p = P(A); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room.state.phase = "lobby"; send(A, "chooseClass", { id: "scout" }); room.state.phase = "playing"; p.ultKills = 0;
  send(B, "testNoCd"); ok(!room.state.noCd, "only the host can switch test mode");
  send(A, "testNoCd"); tick(1); ok(room.state.noCd && p.ultReady, "test mode: the ultimate is unlocked straight away (no 100 kills)");
  send(A, "ult", {}); ok(p.storm > 0, "...Blade Storm starts"); p.storm = 0.01; tick(3); ok(!p.ultReady && p.ultCd > 55, `...and when it ends the real cooldown still applies in test mode (${p.ultCd}s)`);
  room._dispose(); }
// 35. game log: a crash in the game tick or a message handler is logged and the room keeps running
{ const { room, A, send } = makeRoom(); const logged = []; room.log = (lv, kind, msg) => logged.push([lv, kind, msg]);
  const inner = room.tickInner.bind(room); room.tickInner = () => { throw new Error("test boom"); };
  let threw = false; try { room.tick(); } catch { threw = true; }
  ok(!threw && logged.some(([lv, k, m]) => lv === "error" && /game tick: Error: test boom/.test(m)), "a crash in the game tick is logged (with its stack) instead of killing the room");
  room.tickInner = inner; room.tick(); ok(room.state.phase === "playing", "...and the next tick runs normally");
  send(A, "clientError", { m: "frame: x is not a function" }); ok(logged.some(([lv, k, m]) => k === "client" && /x is not a function/.test(m)), "errors from a player's browser go into the log");
  send(A, "bugReport", { text: "  the boss got   stuck  ", tags: ["boss", "<b>"], ctx: { wave: 4 } }); const bug = logged.find(([lv, k]) => k === "bug");
  ok(bug && bug[0] === "warn" && bug[2] === "the boss got stuck" && /boss/.test(JSON.stringify(bug)), "REPORT BUG: the note lands in the game log (kind bug) with its tags and context");
  send(A, "bugReport", { text: "x" }); ok(logged.filter(([, k]) => k === "bug").length === 1, "...an empty one is ignored");
  room._dispose(); }
// 36. BRIGGS (juggernaut): shotgun, Iron Bastion (E: 15s dome, can't be hurt), Unbreakable (Q, Nov 13: roar + 30s shield: 1000px taunt incl. bosses, zombies 0 dmg, a boss 15% once per 3s, stored damage blasts out at the end + 3s stun)
{ const { room, events, A, B, send, P } = makeRoom(); const p = P(A), q = P(B); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room.state.phase = "lobby"; send(A, "chooseClass", { id: "juggernaut" }); send(A, "start", {}); room.state.phase = "playing";
  ok(p.maxHp === 160 && p.weapon === "shotgun", "Briggs: 160 HP, starts with the shotgun");
  p.x = 900; p.y = 900; q.x = 3000; q.y = 2000;
  send(A, "ability", { a: 0 }); ok(p.skillT > 14.9 && events.some(e => e.type === "briggs" && e.k === "bastion"), "E: Iron Bastion dome for 15s");
  const z = placeZombie(room, p.x + 30, p.y, 9999); z.role = "hunter"; z.damage = 40; z.attackCooldown = 0; const hp0 = p.hp; tick(3);
  ok(p.hp === hp0 && events.some(e => e.type === "briggs" && e.k === "hit"), "zombies hit the dome: no damage (sparks)");
  p.stunned = 1; const x0 = p.x; room.moveWithCollision(p, 80, 0); tick(1); ok(p.stunned === 0, "...and no stun inside the dome");
  room.briggs.get("A").castUntil = 0; room.lastInputs.set("A", Date.now() - 1000); const xa = p.x; for (let i = 0; i < 10; i++) { room.lastInputs.set("A", Date.now() - 100); send(A, "input", { dx: 1, dy: 0 }); }
  ok(Math.abs((p.x - xa) - 150 * 0.7) < 3, `he walks 30% slower in it (${Math.round(p.x - xa)}px/s)`);
  const zhp = z.hp; p.skillT = 0.01; tick(2); ok(p.skillT === 0 && p.abilityCooldown > 29 && z.hp < zhp && events.some(e => e.type === "briggs" && e.k === "shatter"), `the dome shatters (hits + pushes zombies) and E cools down 30s (${p.abilityCooldown.toFixed(0)}s)`);
  room.state.zombies.clear();
  // War Cry
  q.hp = q.maxHp; p.hp = p.maxHp; p.ultKills = 100; tick(1); ok(p.ultReady, "Q unlocks at 100 kills");
  q.x = p.x + 200; q.y = p.y; const far = placeZombie(room, p.x + 300, p.y, 500); far.role = "tower"; const near = placeZombie(room, p.x + 100, p.y, 500); near.role = "tower"; const nx = near.x;
  const vfar = placeZombie(room, p.x + 900, p.y, 500); vfar.role = "tower"; vfar.speed = 0; const out = placeZombie(room, p.x + 1300, p.y, 500); out.role = "tower"; out.speed = 0; const boss = placeZombie(room, p.x, p.y + 800, 1e6); boss.boss = true; boss.speed = 0;
  send(A, "ult", {}); tick(1);
  ok(far.targetId === "A" && near.targetId === "A" && vfar.targetId === "A" && boss.targetId === "A" && out.targetId !== "A", `Q: Unbreakable: every zombie AND boss within 1000px charges Briggs (900px: ${vfar.targetId}, boss: ${boss.targetId}, 1300px: ${out.targetId || "-"})`);
  ok(room.fortressOn(p) && events.some(e => e.type === "briggs" && e.k === "cry" && e.fort) && p.ultActive > 29, `...and he's in his shield (30s: ${p.ultActive}s)`);
  const late = placeZombie(room, p.x + 600, p.y - 300, 500); late.role = "tower"; late.speed = 0; room.bmemOf(p).fortTaunt = 0; tick(1); ok(late.targetId === "A", "...zombies that come later are taunted too (every second)");
  room.state.zombies.delete(vfar.id); room.state.zombies.delete(out.id); room.state.zombies.delete(boss.id); room.state.zombies.delete(late.id);
  ok(near.hp < 500 && near.x > nx + 20 && far.hp === 500, "...the shockwave hurts and knocks back the close ones");
  ok(room.cryBuff(q) > 1.2, "...teammates nearby hit 25% harder");
  room.briggs.get("A").safeUntil = 0; const hb = p.hp, st0 = room.bmemOf(p).fortStored || 0; near.damage = 40; near.speed = 0; near.x = p.x + 30; near.attackCooldown = 0; tick(1);
  ok(p.hp === hb && (room.bmemOf(p).fortStored || 0) - st0 > 30, `...zombies do NO damage to him, but the shield stores the hit (${Math.round(room.bmemOf(p).fortStored)} stored)`);
  { const zi = placeZombie(room, p.x + 15, p.y + 5, 500); zi.speed = 60; zi.damage = 30; room.bmemOf(p).fortTaunt = 0; tick(2); const [cx, cy, rx, ry] = room.fortRing(zi, p), q = ((zi.x - cx) / rx) ** 2 + ((zi.y - cy) / ry) ** 2;
    const s1 = room.bmemOf(p).fortStored; zi.attackCooldown = 0; tick(1); ok(q >= .99 && room.bmemOf(p).fortStored > s1 && p.hp === hb, `...nothing gets inside his 8 shields (pushed out to ${Math.round(Math.hypot(zi.x - p.x, zi.y - p.y))}px) but they still hit the shield from there (stored)`); room.state.zombies.delete(zi.id); }
  { room.state.zombies.clear(); const bz = placeZombie(room, p.x + 24, p.y, 1e6); bz.boss = true; bz.damage = 100; bz.speed = 0; bz.attackCooldown = 0; const h1 = p.hp; tick(1);
    const d1 = h1 - p.hp; ok(Math.abs(d1 - (100 - p.defence) * 0.15) < 1.5, `...a boss's hit does 85% less (${d1.toFixed(1)} of ${100 - p.defence})`);
    bz.attackCooldown = 0; const h2 = p.hp; tick(1); ok(p.hp === h2, "...and the same boss can't hurt him again for 3s");
    room.bmemOf(p).fortBossCd.set(bz.id, Date.now() - 1); bz.attackCooldown = 0; const h3 = p.hp; tick(1); ok(h3 - p.hp > 10, `...after 3s it can (${(h3 - p.hp).toFixed(1)})`);
    room.state.zombies.delete(bz.id); p.hp = p.maxHp; }
  room.state.zombies.set(near.id, near);
  { p.stunned = 1; tick(1); ok(p.stunned === 0, "...and can't be stunned in the shield"); }
  room.state.zombies.clear(); p.x = 900; p.y = 900; const zz = placeZombie(room, p.x + 120, p.y, 9999), bb = placeZombie(room, p.x + 100, p.y + 100, 1e6); bb.boss = true;
  p.reloadLeft = 0; p.mag = 6; p.lastShot = 0; room.fireWeapon(p, 0, 120); const zx = zz.x;
  ok(zx > p.x + 120 + 40, `passive Forceful Blast: shotgun hits shove zombies back (${Math.round(zx - p.x - 120)}px)`);
  p.lastShot = 0; p.mag = 6; const bx0 = bb.x; room.fireWeapon(p, Math.PI / 4, 141); ok(bb.x > bx0 + 10, `...bosses too (${Math.round(bb.x - bx0)}px)`);
  p.activeSlot = 2; p.weapon = "shotgun"; p.mag = 1; p.reloadLeft = 0; let shots = 0; const t0 = Date.now(); room.broadcast = ((orig) => (t, m) => { if (t === "shot") shots++; return orig.call(room, t, m); })(room.broadcast);
  for (let i = 0; i < 6; i++) { p.lastShot = Date.now() - 1000 / (p.fireRate * 3) - 5; room.fireWeapon(p, 0, 100); }
  ok(shots === 6 && p.mag === 1, `War Cry: shotgun fires 3x faster and uses no ammo (${shots} shots, mag still ${p.mag})`);
  room.ultInfo.get("A").summonedAt -= 10500; room.bmemOf(p).cryUntil -= 10500; tick(1); ok(!room.shotgunRage(p) && room.fortressOn(p) && p.ultActive > 15, `after 10s the rage ends but the shield stays (${p.ultActive}s left)`);
  { const m = room.bmemOf(p); room.state.zombies.clear(); const z1 = placeZombie(room, p.x + 60, p.y, 1e5), z2 = placeZombie(room, p.x + 470, p.y, 1e5), zb = placeZombie(room, p.x - 50, p.y + 40, 1e6); zb.boss = true; [z1, z2, zb].forEach(q => { q.damage = 0; q.speed = 60; });
    m.fortStored = 900; room.ultInfo.get("A").summonedAt -= 20000; m.fortUntil = Date.now() - 1; events.length = 0; tick(1);
    const bl = events.find(e => e.type === "briggs" && e.k === "blast");
    ok(!room.fortressOn(p) && bl && bl.dmg === 900 && z1.hp <= 1e5 - 900 && zb.hp <= 1e6 - 900 && z2.hp === 1e5, `after 30s the shield DEFLECTS what it stored: 900 to everything within its 400px shockwave (zombie ${1e5 - z1.hp}, boss ${1e6 - zb.hp}, 470px away ${1e5 - z2.hp})`);
    const x1 = z1.x, xb = zb.x, x2 = z2.x; z1.attackCooldown = 0; tick(10); ok(z1.x === x1 && zb.x === xb && room.zStun.has(z1.id) && room.zStun.has(zb.id) && !room.zStun.has(z2.id), `...and stuns them 3s: they don't move (the far one isn't stunned) [${(z1.x - x1).toFixed(1)} ${(zb.x - xb).toFixed(1)}]`);
    room.zStun.set(z1.id, Date.now() - 1); tick(2); ok(z1.x !== x1, "...then they move again");
    ok(!p.ultReady && p.ultCd > 50, `...and the 60s cooldown runs (${p.ultCd}s left)`); }
  room._dispose(); }
// 37. ARSHAN (slasher): chain-axe, Reaper's Reach (E: hook + self-pull), Crimson Cyclone (Q: 260px spin, 12s)
{ const { room, events, A, B, send, P } = makeRoom(); const p = P(A), q = P(B); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  const fast = n => { for (let i = 0; i < n; i++) { const h = room.hooks.get("A"); if (h) h.t0 -= 50; tick(1); } };   // hook timers use real time: wind them on with the fake ticks
  room.state.phase = "lobby"; room.allowAllClasses = true; send(A, "chooseClass", { id: "slasher" }); send(A, "start", {}); room.state.phase = "playing";
  ok(p.maxHp === 135 && p.melee === "chainaxe" && p.activeSlot === 1 && !p.primary, "Arshan: 135 HP, chain-axe only");
  p.x = 900; p.y = 900; q.x = 3000; q.y = 2000;
  const zs = [0, 1, 2, 3, 4].map(i => placeZombie(room, p.x + 100 + i * 8, p.y - 40 + i * 20, 500));
  room.lastMelee.set("A", 0); room.meleeAttack(p, 0); const hitN = zs.filter(z => z.hp < 500).length;
  ok(hitN === 4 && Math.round(500 - zs[0].hp) === 48, `chain-axe: 48 dmg, 160px reach, max 4 per swing (${hitN} hit)`);
  room.state.zombies.clear();
  // E on a zombie far away
  const far = placeZombie(room, p.x + 700, p.y, 500); const x0 = p.x; events.length = 0;
  send(A, "ability", { a: 0 }); ok(room.hooks.has("A"), "E: Reaper's Reach throws the hook");
  fast(14); ok(far.hp <= 500 - 69 && events.some(e => e.type === "arshan" && e.k === "latch"), `...hooks the zombie 700px away (${Math.round(500 - far.hp)} dmg)`);
  fast(30); ok(!room.hooks.has("A") && p.x > x0 + 600 && Math.abs(far.x - (x0 + 700)) < 1, `...and pulls ARSHAN to it (he moved ${Math.round(p.x - x0)}px, the zombie didn't)`);
  ok(p.abilityCooldown > 11, `12s cooldown after a latch (${p.abilityCooldown.toFixed(0)}s)`);
  // E at a wall
  room.state.zombies.clear(); p.abilityCooldown = 0; const wx = 1000; room.setMapBoxes([{ x: wx + 50, y: 900, hw: 50, hh: 200 }]); p.x = 400; p.y = 900;
  send(A, "ability", { a: 0 }); fast(40); ok(!room.hooks.has("A") && p.x > 900 && p.x < wx, `...or hooks a wall and pulls him up to it (x=${Math.round(p.x)}, wall at ${wx})`);
  // miss
  room.mapBoxesNear = () => []; room.spawnClock = 1e9; room.state.zombies.clear(); p.abilityCooldown = 0; send(A, "ability", { a: Math.PI }); p.x = 2000; fast(40);   // no zombie spawning into the hook's path (it made this flaky) ok(!room.hooks.has("A") && p.abilityCooldown > 2.5 && p.abilityCooldown <= 4, `a miss reels back: 4s cooldown (${p.abilityCooldown.toFixed(1)}s)`);
  // Q
  p.ultKills = 100; tick(1); send(A, "ult", {}); ok(room.spins.has("A"), "Q: Crimson Cyclone");
  const z1 = placeZombie(room, p.x + 240, p.y, 1e4), z2 = placeZombie(room, p.x + 400, p.y, 1e4);
  const sp = room.spins.get("A"); sp.start -= 600; sp.nextTick -= 600; sp.until -= 600; tick(1);
  for (let i = 0; i < 4; i++) { sp.nextTick -= 250; tick(1); }
  ok(z1.hp < 1e4 && z2.hp === 1e4, `...hits everything within 260px every 0.25s (${Math.round(1e4 - z1.hp)} dmg), not beyond`);
  send(A, "ability", { a: 0 }); ok(!room.hooks.has("A"), "...E can't be used while spinning");
  sp.until = Date.now() - 1; tick(1); ok(!room.spins.has("A") && p.ultCd > 59, `after 12s the 60s cooldown starts (${p.ultCd}s)`);
  room._dispose(); }
// 38. ASTRA (dispatcher): E = 1 medic (5 HP/s, each person once), Q = 1 officer per living player, R = safehouse (walls zombies can't cross)
{ const { room, events, A, B, send, P } = makeRoom(); const p = P(A), q = P(B); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room.setMapBoxes([]);   // open ground for this test
  const call = () => { const m = room.amemOf(p); if (m.cast) m.cast.at = 0; tick(1); };
  room.state.phase = "lobby"; send(A, "chooseClass", { id: "dispatcher" }); send(A, "start", {}); room.state.phase = "playing"; room.spawnClock = 9999; room.state.zombies.clear();
  ok(p.maxHp === 120 && p.speed === 180 && p.primary === "rifle", "Astra: 120 HP, speed 180, rifle");
  p.x = 1000; p.y = 700; q.x = 1060; q.y = 700; events.length = 0;
  send(A, "ability", {}); ok(events.some(e => e.type === "astra" && e.k === "call" && e.s === "E") && !room.unitsOf("A", "doctor").length && p.abilityCooldown === 30, "E: 0.45s radio call first; the 30s cooldown starts on the press");
  call(); const docs = room.unitsOf("A", "doctor"); ok(docs.length === 1 && p.abilityCooldown > 29 && p.abilityCooldown < 30, `...then exactly 1 doctor (${docs.length}), cooldown already running (${p.abilityCooldown.toFixed(2)}s)`);
  send(A, "ability", {}); p.abilityCooldown = 0; send(A, "ability", {}); call(); ok(room.unitsOf("A", "doctor").length === 1, "...can't call a second doctor while one is on duty");
  q.hp = 10; p.hp = 10; tick(14); const h0 = q.hp, a0 = p.hp; tick(20);
  ok(Math.abs((p.hp - a0) - 5) < 0.5 && q.hp - h0 < 1, `the medic treats Astra first at 5 HP/s, the teammate waits (${(p.hp - a0).toFixed(1)}, ${(q.hp - h0).toFixed(1)})`);
  ok(room.docRes.size === 1, "...one patient at a time (reservation)");
  tick(110); ok(p.hp > 35 && p.hp < 45, `...one treatment lasts up to 6s (Astra 10 -> ${Math.round(p.hp)})`);
  tick(30); const h1 = q.hp; tick(20); ok(q.hp - h1 > 4 && q.hp - h1 <= 5.5, `...then he goes to the next ally (${(q.hp - h1).toFixed(1)} HP/s)`);
  tick(140); const h2 = q.hp; tick(20); ok(q.hp === h2, "...and stops after their 6s too");
  q.hp = 50; p.hp = 50; tick(40); ok(q.hp === 50 && p.hp === 50, `each person is treated only ONCE per call (no stacking) (${Math.round(q.hp)}, ${Math.round(p.hp)})`);
  { const d = room.unitsOf("A", "doctor")[0]; p.x = 1400; tick(60); const dd = Math.hypot(d.x - p.x, d.y - p.y); ok(dd < 120, `everyone treated: he follows Astra (${Math.round(dd)}px)`); p.x = 1000; tick(60); }
  q.hp = 50; q.alive = false; tick(10); ok(q.hp === 50, "...doctors can't revive a downed player"); q.alive = true;
  for (const r of room.unitsOf("A", "doctor")) room.unitMem.get(r.id).until = 0; tick(1); ok(!room.unitsOf("A", "doctor").length, "doctors leave after 20s");
  // Q
  q.hp = q.maxHp; p.hp = p.maxHp; p.ultKills = 100; tick(1); ok(p.ultReady, "Q unlocks at 100 kills");
  send(A, "ult", {}); call(); const cops = room.unitsOf("A", "police"); const gA = cops.filter(r => room.unitMem.get(r.id).guard === "A").length; ok(cops.length === 3 && gA === 2, `Q: 2 officers guard Astra, 1 per teammate (2 players -> ${cops.length}, Astra ${gA})`);
  ok(new Set(cops.map(r => room.unitMem.get(r.id).guard)).size === 2, "...both players are guarded");
  { const cq = cops.find(r => room.unitMem.get(r.id).guard === "B"); q.x = 1500; q.y = 900; tick(80); const dq = Math.hypot(cq.x - q.x, cq.y - q.y); ok(dq < 140, `...and stays with that player (${Math.round(dq)}px from B)`); q.x = 1060; q.y = 700; tick(60); }
  send(A, "ult", {}); call(); ok(room.unitsOf("A", "police").length === 3, "...no second squad while they're out");
  const z = placeZombie(room, p.x + 300, p.y, 400); const k0 = p.kills; for (let i = 0; i < 40; i++) { for (const r of room.unitsOf("A", "police")) { const m = room.unitMem.get(r.id); m.nextBurst = Math.min(m.nextBurst, Date.now()); m.nextShot = 0; } tick(1); }
  ok(!room.state.zombies.has(z.id) && p.kills > k0, `police shoot zombies (5 dmg bullets in bursts of 5 every 2s) and Astra gets the kill (${p.kills - k0})`);
  ok(q.hp === q.maxHp, "...they never shoot teammates");
  for (const r of room.unitsOf("A", "police")) room.unitMem.get(r.id).until = 0; tick(1); tick(1);
  ok(!room.unitsOf("A", "police").length && !p.ultReady && p.ultCd > 59, `after 30s they go home; the 60s cooldown has been running since the press (${p.ultCd}s on the test clock)`);
  // R
  room.state.zombies.clear(); p.x = 1000; p.y = 700; const inside = placeZombie(room, p.x + 60, p.y + 30, 300);
  send(A, "skill2", {}); call(); const st = room.safeOf(p); const wk = room.unitsOf("A", "worker");
  ok(st && st.deploy > 4.9 && wk.length === 2 && st.hp === 6, "R: safehouse construction (5s), 2 workers, walls take 6 hits");
  { const hz = placeZombie(room, p.x + 25, p.y, 1e4); hz.role = "hunter"; hz.damage = 30; hz.attackCooldown = 0; const ph = p.hp; tick(20); ok(p.hp === ph, `Astra can't be hurt while it's being built (${ph - p.hp} dmg)`); room.state.zombies.delete(hz.id); }
  ok(p.chargeCd > 89, `...90s cooldown starts at deployment (${p.chargeCd}s)`);
  tick(60); ok(st.deploy > 0, "...still building after 4s"); tick(25); ok(st.deploy === 0 && room.safeBoxes.length === 1, "...all 4 walls finish together after 5s");
  ok(Math.abs(inside.x - st.x) >= 130 || Math.abs(inside.y - st.y) >= 130, "...a zombie caught inside is moved outside (no damage)");
  ok(inside.hp === 300, "...unhurt");
  tick(20); ok(room.unitsOf("A", "worker").length === 2, "...the workers stay inside after building");
  const out = placeZombie(room, st.x + 130 + 20, p.y, 1e4); out.role = "hunter"; out.damage = 40; out.speed = 200; out.attackCooldown = 0;
  p.x = st.x + 95; p.y = st.y; const hp0 = p.hp; tick(40);
  ok(Math.abs(out.x - st.x) >= 130 && p.hp === hp0, `zombies can't get in or hurt him inside (zombie stuck at the wall, ${hp0 - p.hp} dmg)`);
  q.x = st.x + 300; q.y = st.y; room.moveWithCollision(q, -230, 0); ok(Math.abs(q.x - (st.x + 70)) < 2, "teammates walk straight through the walls");
  p.reloadLeft = 0; p.mag = 30; p.lastShot = 0; p.activeSlot = 2; p.weapon = "rifle"; const ohp = out.hp; room.fireWeapon(p, Math.atan2(out.y - p.y, out.x - p.x), 100); ok(out.hp < ohp, "...and shoot out through them");
  { for (const z0 of [...room.state.zombies.values()]) if (z0 !== out) room.state.zombies.delete(z0.id); st.hp = 6; const h0 = st.hp; out.attackCooldown = 0; tick(21); ok(st.hp === h0 - 2, `a zombie whose prey is inside hits the wall: 1 per attack, 1 per second (${h0} -> ${st.hp} in 1s)`); }
  { const wk2 = room.unitsOf("A", "worker"); room.state.zombies.clear(); placeZombie(room, 3000, 2000, 1e6); const h1 = st.hp; tick(160); ok(st.hp > h1 && st.hp <= h1 + 2, `...the workers walk over (half speed) and patch it up slowly, +1 per 5s each (${h1} -> ${st.hp} in 8s)`);
    ok(wk2.every(r => room.unitMem.get(r.id).rep !== undefined), "...both workers repair"); }
  { const zz = placeZombie(room, st.x + 130 + 20, p.y, 1e4); zz.role = "hunter"; zz.speed = 200; zz.damage = 40; st.hp = 2; zz.attackCooldown = 0; tick(50);
    ok(!room.safeOf(p) && !room.safeBoxes.length, `6 hits in total break the walls (broke with ${st.hp} left)`); room.state.zombies.clear(); }
  tick(2); for (const r of room.unitsOf("A", "worker")) room.unitMem.get(r.id).leaveAt = 1; tick(1); ok(!room.unitsOf("A", "worker").length, "...and the workers go home");
  { const m2 = room.amemOf(p); m2.safeReady = 0; send(A, "skill2", {}); call(); const s2 = room.safeOf(p); tick(110); ok(s2 && s2.deploy === 0, "a new safehouse");
    s2.life = 0.01; tick(1); ok(!room.safeOf(p) && !room.safeBoxes.length, "after 45s the walls all disappear together"); }
  { /* Nov 11: downed teammates inside a finished safehouse don't bleed out; cooldown reduction shortens the build; +2 wall hits per Body Armour pick */
    const m3 = room.amemOf(p); m3.safeReady = 0; room.state.zombies.clear(); p.cdr = 0.3; p.armorPct = 0.18; send(A, "skill2", {}); call(); const s3 = room.safeOf(p);
    ok(s3 && Math.abs(s3.deploy - 3.5) < .06 && s3.total === 3.5, `30% cooldown reduction: the safehouse builds in 3.5s, not 5s (${s3?.deploy?.toFixed(2)}s)`);
    ok(s3 && s3.hp === 9 && s3.maxHp === 9, `3 Body Armour picks: the walls take 9 hits, not 6 (${s3?.hp})`);
    tick(80); ok(s3 && s3.deploy === 0, "...and it finishes after 3.5s");
    const q2 = [...room.state.players.values()].find(x => x.sessionId !== p.sessionId) || p; const was = { x: q2.x, y: q2.y };
    q2.x = s3.x + 20; q2.y = s3.y + 10; q2.alive = false; q2.bledOut = false; q2.bleedout = 20; tick(40);
    ok(Math.abs(q2.bleedout - 20) < .01, `a downed player inside the safehouse doesn't bleed out (${q2.bleedout.toFixed(2)}s left after 2s)`);
    q2.x = s3.x + 400; tick(40); ok(q2.bleedout < 19, `...outside it the clock runs again (${q2.bleedout.toFixed(2)}s)`);
    q2.alive = true; q2.bleedout = 0; q2.x = was.x; q2.y = was.y; p.cdr = 0; p.armorPct = 0; s3.life = 0.01; tick(1); }
  // no room: boss in the way -> refused, no cooldown
  const m = room.amemOf(p); m.safeReady = 0; room.state.zombies.clear(); const boss = placeZombie(room, p.x + 60, p.y, 1e5); boss.boss = true; boss.radius = 40;
  send(A, "skill2", {}); call(); ok(!room.safeOf(p) && m.safeReady === 0, "R with a boss in the way: refused, no cooldown used");
  room._dispose(); }
// 39. LOBBY: rename, READY UP, mission settings (host only): map site, difficulty, wave mode, friendly fire, extra loot; Sofea not pickable
{ const room = new SurvivalRoom(); room.onCreate({ site: 0 }); room.state.noCd = false; const events = []; room._onBroadcast = (t, m) => events.push({ type: t, ...m });
  const A = { sessionId: "A" }, B = { sessionId: "B" }; room.onJoin(A, { name: "Host" }); room.onJoin(B, { name: "Friend" });
  const send = (c, t, d) => room._handlers[t](c, d), p = room.state.players.get("A"), q = room.state.players.get("B");
  ok(p.ready && !q.ready, "host counts as ready, a new player starts NOT READY");
  send(B, "ready", {}); ok(q.ready, "READY UP toggles"); send(B, "ready", {}); ok(!q.ready, "...and back");
  send(B, "setName", { name: "Gemma<>" }); ok(q.name === "Gemma", "players can rename themselves in the lobby (cleaned)");
  const lay0 = room.state.mapLayout; send(B, "settings", { map: 1, difficulty: "hard" }); ok(room.state.mapSite === 0 && room.state.difficulty === "normal", "only the host can change mission settings");
  send(A, "settings", { map: 1, difficulty: "hard", waveMode: "ascension", friendlyFire: true, extraLoot: true });
  ok(room.state.mapSite === 0 && room.state.mapLayout === lay0, "(Nov 12) no map choice: the match always starts at Ascension");
  ok(room.state.difficulty === "hard" && room.state.waveMode === "ascension" && room.state.friendlyFire && room.state.extraLoot, "difficulty / wave mode / friendly fire / extra loot saved");
  send(A, "settings", { difficulty: "nightmare" }); ok(room.state.difficulty === "hard", "...bad values are ignored");
  send(A, "chooseClass", { id: "slasher" }); ok(p.characterClass !== "slasher", "Arshan can't be picked yet");
  send(A, "chooseClass", { id: "operator" }); ok(p.characterClass === "operator", "Sofea is back on the roster"); send(A, "chooseClass", { id: "assault" });
  for (let i = 0; i < 6; i++) send(A, "addBot", {}); ok(![...room.state.players.values()].some(b => b.isBot && b.characterClass === "slasher") && [...room.state.players.values()].filter(b => b.isBot).every(b => b.ready), "bots never pick Arshan and are always ready");
  room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear();
  room.spawnZombie(false, "walker"); const z = [...room.state.zombies.values()].pop(); ok(Math.abs(z.maxHp - 38 * 1.35) < .5, `hard: zombies have +35% HP (${z.maxHp.toFixed(1)})`);
  p.x = 1000; p.y = 1000; q.x = 1100; q.y = 1000; q.alive = true; const hq = q.hp; p.activeSlot = 2; p.weapon = "rifle"; p.mag = 30; p.reloadLeft = 0; p.lastShot = 0; p.stunned = 0;
  room.fireWeapon(p, 0, 100); ok(q.hp < hq, `friendly fire: a bullet through a teammate hurts them (${Math.round(hq - q.hp)} dmg)`);
  room.state.stage = 50; room.state.phase = "playing"; room.state.waveType = "normal"; room.state.elapsed = 95; room.hiveSpawned = true; room.lastTick = Date.now() - 50; room.tick(); ok(room.state.phase === "cleared", "Ascension (∞): wave 50 doesn't end the game");
  room._dispose(); }
// 40. Fixes (Nov 3 night): Butcher never freezes; hook stopped by safehouse walls; Sofea's shots hit the first zombie; shorter night
{ const { room, events, A, B, send, P } = makeRoom(); const p = P(A), q = P(B); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room.mapBoxesNear = () => []; room.mapGrid = new Map();
  // Butcher with nobody reachable walks to the tower
  for (const pl of [p, q]) { pl.x = 400; pl.y = 400; pl.shadow = 30; }
  room.spawnZombie(true, "butcher"); const bz = [...room.state.zombies.values()].pop(); bz.x = 900; bz.y = 600; bz.hp = bz.maxHp = 1e6; const d0 = Math.hypot(bz.x - 1800, bz.y - 1140);
  tick(30); ok(Math.hypot(bz.x - 1800, bz.y - 1140) < d0 - 80, `Butcher with nobody to reach walks to the radio tower instead of freezing (${Math.round(d0 - Math.hypot(bz.x - 1800, bz.y - 1140))}px)`);
  room.state.zombies.clear(); p.shadow = 0; q.shadow = 0;
  // hook stops at a safehouse wall
  room.safeBoxes = [{ x: 1000, y: 1000, hw: 130, hh: 130 }];
  ok(Math.abs(room.boxRayDist(700, 1000, 0, 480, room.safeBoxes) - 170) < 1, "the Butcher's hook stops at Astra's safehouse wall");
  p.x = 1000; p.y = 1000; ok(room.untouchable(p), "...and can't grab anyone inside"); room.safeBoxes = [];
  // Sofea: shell explodes on the first zombie in the way
  room.allowAllClasses = true; room.state.phase = "lobby"; send(A, "chooseClass", { id: "operator" }); room.state.phase = "playing";
  p.x = 600; p.y = 600; room.callVehicle(p, "tank"); const v = room.state.vehicles.get("A"); v.phase = "ride"; v.left = 20; v.x = p.x; v.y = p.y;
  const near = placeZombie(room, 800, 600, 500); room.ripples = []; room.vmem(p).shotAt = 0;
  room.vehicleFire(p, 0, 600); const rp = room.ripples[room.ripples.length - 1];
  ok(rp && Math.abs(rp.x - 800) < 30, `Sofea's shell explodes on the first zombie it hits (at x=${Math.round(rp?.x)}, zombie at 800, mouse at 1200)`);
  // night is 1 minute of a 3 minute day
  room.state.dayTime = 170; tick(1); ok(room.state.isNight, "night"); room.state.dayTime = 179.99; tick(2); ok(!room.state.isNight && room.state.dayTime < 5, "night lasts 1 minute, then day again");
  room._dispose(); }
// 41. MARCUS Combat Rush (E): +50% damage, +25% attack speed (guns + melee) for 6s, 15s cooldown
{ const { room, A, send, P } = makeRoom(); const p = P(A); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear(); p.x = 1000; p.y = 1000;
  ok(p.characterClass === "assault", "Marcus is the assault");
  const dmg0 = p.damage, rate0 = p.fireRate; p.abilityCooldown = 0; send(A, "ability", {});
  ok(Math.abs(p.damage / dmg0 - 1.5) < .03 && Math.abs(p.fireRate / rate0 - 1.25) < .01 && p.abilityCooldown === 15 && p.skillT === 6,
     `E: damage x${(p.damage / dmg0).toFixed(2)}, fire rate x${(p.fireRate / rate0).toFixed(2)}, cooldown ${p.abilityCooldown}s, lasts ${p.skillT}s`);
  p.activeSlot = 1; p.melee = "knife"; room.lastMelee.set("A", Date.now() - 300); const z = placeZombie(room, 1030, 1000, 999); const hp0 = z.hp; room.meleeAttack(p, 0);
  ok(z.hp < hp0, "...knife swings 25% faster (0.35s -> 0.28s between swings)");
  tick(125); ok(p.skillT === 0 && Math.abs(p.damage - dmg0) < .01 && Math.abs(p.fireRate - rate0) < .01 && p.abilityCooldown > 8.5 && p.abilityCooldown < 9.5,
     `after 6s it wears off (cooldown left ${p.abilityCooldown.toFixed(1)}s of 15)`);
  room._dispose(); }
// 42. MARCUS Frag Barrage (Q): concussion blast + hop back away from the aim + 3 grenades in a fan with big knockback, 30s cooldown
{ const { room, events, A, send, P } = makeRoom(); const p = P(A); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room.mapBoxesNear = () => []; room.mapGrid = new Map();
  room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear(); room.state.noCd = false; p.x = 1000; p.y = 1000; p.ultKills = 0;
  send(A, "ult", { a: 0, d: 300 }); ok(!room.fragHops.has("A"), "Q is locked until 100 kills");
  p.ultKills = 100; const close = placeZombie(room, 1060, 1000, 9999), far = [placeZombie(room, 1330, 1000, 9999), placeZombie(room, 1000 + Math.cos(.35) * 330, 1000 + Math.sin(.35) * 330, 9999)];
  const c0 = close.x, hp0 = close.hp; send(A, "ult", { a: 0, d: 300 });
  ok(close.x > c0 + 40 && close.hp < hp0, `the blast around him shoves a close zombie away (${Math.round(close.x - c0)}px) and hurts it`);
  tick(6); ok(p.x < 1000 - 120, `he hops back away from his aim (${Math.round(1000 - p.x)}px)`);
  const f0 = far.map(z => [z.x, z.y, z.hp]); for (const r of room.ripples) r.t -= 1000; tick(2);   // ripples run on the wall clock
  ok(far.every((z, i) => z.hp < f0[i][2] && Math.hypot(z.x - f0[i][0], z.y - f0[i][1]) > 30), `the grenades blow where he aimed (fan: middle + side grenade both hit, knocked back ${far.map((z, i) => Math.round(Math.hypot(z.x - f0[i][0], z.y - f0[i][1]))).join(", ")}px)`);
  ok(events.some(e => e.type === "frag") && p.ultCd > 18 && p.ultCd <= 20 && !p.ultReady, `20s cooldown (${p.ultCd}s)`);
  room.state.noCd = true; tick(1); const n0 = events.filter(e => e.type === "frag").length; send(A, "ult", { a: 0, d: 300 });
  ok(p.ultCd > 18 && !p.ultReady && events.filter(e => e.type === "frag").length === n0, "...even in test mode (no-cooldown ultimates) it stays on cooldown: no spamming");
  room._dispose(); }
// 43. Levels: shared team XP (every kill gives XP to everyone), xp needed 30 + 72 per level, cap at 30, every run starts at level 1
{ const { room, A, B, send, P } = makeRoom(); const p = P(A), q = P(B);
  ok(p.level === 1 && p.xp === 0 && p.xpNext === 30, "a new player starts at level 1 (30 XP to level 2)");
  room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear();
  const z = placeZombie(room, p.x + 30, p.y, 1); room.hitZombie(z, p, 50);
  ok(p.xp === 5 && q.xp === 5, `a kill gives its XP to the whole team (killer ${p.xp}, teammate ${q.xp})`);
  let tot = 0; for (let L = 1; L < 30; L++) tot += 30 + 72 * (L - 1); ok(tot > 29000 && tot < 31000, `level 30 takes ${tot} XP in total`);
  p.xp = tot + 500; let n = 0; while (p.xp >= p.xpNext && n < 50) { if (!room.applyUpgrade(p, "health")) break; n++; }
  ok(p.level === 30 && n === 29 && p.xp === 0, `levels stop at 30 (${p.level}, ${n} upgrades)`);
  const z2 = placeZombie(room, p.x + 30, p.y, 1); room.hitZombie(z2, p, 50); ok(p.xp === 0 && !room.applyUpgrade(p, "damage"), "no XP or upgrades past level 30");
  room._dispose(); }
// 44. Boss wave: a last straggler (3 or fewer) 15s after the horde ends doesn't hold the boss back
{ const { room, A, P } = makeRoom(); const p = P(A); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room._handlers.start(A, {}); room.jumpToWave(4); room.spawnClock = 9999; room.state.zombies.clear(); p.x = 1000; p.y = 1000;
  ok(room.state.waveType === "boss" && room.state.bossPhase === "horde", "wave 4 is a boss wave, horde first");
  room.state.elapsed = 46; placeZombie(room, 3000, 2200, 9999); placeZombie(room, 3050, 2200, 9999); room.spawnClock = 9999; tick(2);
  ok(room.state.bossPhase === "horde" && room.state.zombies.size === 2, "right after the horde: the stragglers still have to be killed");
  room.state.elapsed = 61; room.spawnClock = 9999; tick(2);
  ok(room.state.bossPhase === "intro" && room.state.zombies.size === 0, `15s later with 2 left: they vanish and the boss intro starts (${room.state.bossPhase})`);
  room._dispose(); }
// 45. Level-up upgrade "Quick recovery": -10% skill cooldowns per pick, max -60% (every skill timer starts shorter)
{ const { room, A, send, P } = makeRoom(); const p = P(A); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear(); room.state.noCd = false;
  p.xp = 99999; for (let i = 0; i < 9; i++) send(A, "upgrade", { id: "cooldown" });
  ok(Math.abs(p.cdr - .6) < 1e-9 && p.level === 7, `6 picks reach the -60% cap, more are refused (cdr ${p.cdr}, level ${p.level})`);
  p.abilityCooldown = 0; send(A, "ability", {}); tick(1);
  ok(Math.abs(p.abilityCooldown - 15 * .4) < .1, `E (Combat Rush, 15s) starts at ${p.abilityCooldown.toFixed(1)}s (15 x 0.4 = 6s)`);
  const e0 = p.abilityCooldown; tick(20); ok(Math.abs((e0 - p.abilityCooldown) - 1) < .02, "...and counts down at normal speed (the HUD shows real seconds)");
  p.ultKills = 100; send(A, "ult", { a: 0, d: 300 }); tick(1);
  ok(p.ultCd > 7.5 && p.ultCd <= 8.05, `Q (Frag Barrage, 20s) starts at ${p.ultCd}s (20 x 0.4 = 8s)`);
  room._dispose(); }
// 46. Test tool "Level +1": the host gets exactly the XP for one more level (stacks with levels already waiting), nothing at 30, not for non-hosts
{ const { room, A, B, send, P } = makeRoom(); const p = P(A), q = P(B);
  room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear();
  send(A, "debugLevel"); ok(p.xp === 30, `one press: XP for level 2 (${p.xp}/30)`);
  send(A, "debugLevel"); ok(p.xp === 30 + 102, `second press before picking: XP for level 3 too (${p.xp})`);
  send(A, "upgrade", { id: "damage" }); send(A, "upgrade", { id: "damage" }); ok(p.level === 3 && p.xp === 0, `two picks -> level 3 (${p.level})`);
  send(B, "debugLevel"); ok(q.xp === 0, "a non-host can't use it online");
  p.level = 30; p.xp = 0; send(A, "debugLevel"); ok(p.xp === 0, "nothing at level 30");
  room._dispose(); }
// 48. Level-up upgrade "Fast Hands": +15% reload speed and +20% magazine per pick, max 5 picks
{ const { room, A, send, P } = makeRoom(); const p = P(A); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear();
  p.activeSlot = 2; p.weapon = "rifle"; p.primary = "rifle"; room.loadMag(p); const base = p.magSize;
  p.mag = 0; room.startReload(p); const r0 = p.reloadLeft; p.reloadLeft = 0; room.finishReload(p);
  p.xp = 99999; for (let i = 0; i < 7; i++) send(A, "upgrade", { id: "hands" });
  ok(p.hands === 5 && p.level === 6, `5 picks max, more are refused (hands ${p.hands}, level ${p.level})`);
  ok(p.magSize === base * 2, `magazine +100% (${base} -> ${p.magSize})`);
  p.mag = 0; p.reloadLeft = 0; room.startReload(p); ok(Math.abs(p.reloadLeft - r0 / 1.75) < .01 && p.reloadTotal === p.reloadLeft, `reload 1.75x faster (${r0.toFixed(2)}s -> ${p.reloadLeft.toFixed(2)}s)`);
  p.reloadLeft = .01; tick(2); ok(p.mag === base * 2, `a reload fills the bigger magazine (${p.mag})`);
  room._dispose(); }
// 49. Astra (Nov 6): E, Q and R cooldowns all start on the press; refunded if the call fails
{ const { room, A, send, P } = makeRoom(); const p = P(A); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room.allowAllClasses = true; room.state.phase = "lobby"; send(A, "chooseClass", { id: "dispatcher" }); send(A, "start", {}); room.state.phase = "playing"; room.spawnClock = 9999; room.state.zombies.clear(); room.state.noCd = false;
  p.x = 1000; p.y = 700; p.ultKills = 100;
  send(A, "ult", { a: 0 }); const info = room.ultInfo.get("A"); ok(info && info.readyAt - Date.now() > 59000, "Q: the 60s cooldown starts on the press");
  const call = () => { const mm = room.amemOf(p); if (mm.cast) mm.cast.at = 0; tick(1); };
  call(); ok(room.unitsOf("A", "police").length >= 1, "...the officer still arrives");
  const m = room.amemOf(p); m.safeReady = 0; p.x = 2000; p.y = 1400; send(A, "skill2", {}); ok(m.safeReady - Date.now() > 89000, `R: the 90s cooldown starts on the press (${Math.round((m.safeReady - Date.now()) / 1000)}s, call ${!!m.cast})`); call();
  // downed during the radio call: refunded
  p.abilityCooldown = 0; for (const r of room.unitsOf("A", "doctor")) room.removeUnit(r); room.amemOf(p).cast = null; send(A, "ability", {}); ok(p.abilityCooldown === 30, "E: cooldown on the press");
  p.alive = false; call(); ok(p.abilityCooldown === 0, "...refunded when Astra goes down before the medic arrives");
  room._dispose(); }
// 50. Astra's E (Nov 6): arrival burst (30% max HP to everyone within 300px, once) + the medic revives downed teammates first
{ const { room, A, B, send, P } = makeRoom(); const p = P(A), q = P(B); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room.mapBoxesNear = () => []; room.mapGrid = new Map();
  room.allowAllClasses = true; room.state.phase = "lobby"; send(A, "chooseClass", { id: "dispatcher" }); send(A, "start", {}); room.state.phase = "playing"; room.spawnClock = 9999; room.state.zombies.clear();
  const call = () => { const mm = room.amemOf(p); if (mm.cast) mm.cast.at = 0; tick(1); };
  p.x = 1000; p.y = 700; q.x = 1200; q.y = 700; p.hp = 20; q.hp = 20; const far = { hp: 0 };
  send(A, "ability", {}); call();
  ok(Math.abs(p.hp - (20 + p.maxHp * .3)) < 1 && Math.abs(q.hp - (20 + q.maxHp * .3)) < 1, `arrival: Astra and a teammate 200px away both heal 30% of max HP (${Math.round(p.hp)}, ${Math.round(q.hp)})`);
  for (const r of room.unitsOf("A", "doctor")) room.removeUnit(r);
  // revive: teammate down 350px away
  q.x = 1350; q.y = 700; q.alive = false; q.bleedout = 30; q.hp = 0; p.hp = p.maxHp * .5; p.abilityCooldown = 0; room.amemOf(p).cast = null;
  send(A, "ability", {}); call(); const qh0 = q.hp;
  ok(!q.alive && qh0 === 0, "the downed teammate isn't healed by the burst (out of range / down)");
  let up = 0; for (let i = 0; i < 160 && !q.alive; i++) { tick(1); up = i; }
  ok(q.alive && q.hp >= Math.round(q.maxHp * .35) - 1, `the medic goes straight to the downed teammate and revives them (${(up / 20).toFixed(1)}s, ${Math.round(q.hp)} HP)`);
  room._dispose(); }
// 51. Dash dodge (Nov 6): 140px and 0.25s where nothing can hurt you
{ const { room, A, send, P } = makeRoom(); const p = P(A); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room.mapBoxesNear = () => []; room.mapGrid = new Map();
  room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear(); p.x = 1000; p.y = 1000; p.hp = p.maxHp = 500;
  send(A, "dash", { dx: 1, dy: 0 }); const z = placeZombie(room, p.x + 20, p.y, 999); z.kind = "walker"; z.attackCooldown = 0;
  tick(2); ok(p.hp === 500, "a zombie right next to you can't bite during the dodge");
  room.hiveHurt(p, 50); ok(p.hp === 500, "boss attacks miss too");
  room.dodgeUntil.set("A", Date.now() - 1); room.hiveHurt(p, 50); ok(p.hp < 500, `after 0.25s you can be hurt again (${Math.round(500 - p.hp)} dmg)`);
  room._dispose(); }
// 52. Body Armour (Nov 6): percent damage reduction by weight class, 8 picks to the cap; the shop doesn't sell armour
{ const { room, A, B, send, P } = makeRoom(); const p = P(A), q = P(B);
  room.allowAllClasses = true; room.state.phase = "lobby"; send(A, "chooseClass", { id: "juggernaut" }); send(B, "chooseClass", { id: "scout" }); send(A, "start", {}); room.state.phase = "playing"; room.spawnClock = 9999; room.state.zombies.clear();
  p.xp = q.xp = 99999; for (let i = 0; i < 10; i++) { send(A, "upgrade", { id: "defence" }); send(B, "upgrade", { id: "defence" }); }
  ok(Math.abs(p.armorPct - .64) < 1e-9 && Math.abs(q.armorPct - .32) < 1e-9 && p.level === 9, `8 picks: Briggs (heavy) -64%, Raven (light) -32%, more refused (${p.armorPct}, ${q.armorPct}, level ${p.level})`);
  p.hp = p.maxHp = 1000; q.hp = q.maxHp = 1000; room.hiveHurt(p, 100); room.hiveHurt(q, 100);
  ok(1000 - p.hp === Math.round(100 * .36 - p.defence) && 1000 - q.hp === 68, `a 100 hit: Briggs takes ${1000 - p.hp} (36 - his 5 defence), Raven ${1000 - q.hp}`);
  const g0 = p.currency = 999; send(A, "buy", { id: "armor" }); ok(p.currency === 999, "the shop doesn't sell armour any more");
  room._dispose(); }
// 53. THE PYRE PRIEST (wave 8 boss): hunts survivors only; Censer Swing (dodgeable), Firewalk, Sermon of Ash (x2 from behind), burning
{ const { room, A, B, send, P } = makeRoom(); const p = P(A), q = P(B);
  room.mapBoxesNear = () => []; room.mapGrid = new Map();
  room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear();
  room.state.stage = 16; ok(room.bossKind() === "pyre", "wave 16's boss is the Pyre Priest (the Refinery's boss, Nov 12)");
  room.spawnZombie(true, "pyre"); const z = [...room.state.zombies.values()].pop(); z.x = 1500; z.y = 1200;
  ok(z.boss && z.role === "hunter" && z.speed === 212, `a boss that hunts survivors, speed ${z.speed} (184 + 15%)`);
  let T = Date.now(); const real = Date.now; const think = sec => { for (let i = 0; i < sec * 20; i++) { T += 50; Date.now = () => T; try { room.pyreThink(z, .05, T, null); room.tickBurn(.05, T); } finally { Date.now = real; } } };
  const m = room.pmem(z, T); m.walkReady = m.sermonReady = m.wheelReady = T + 1e9;
  // hunts: walks to the nearest survivor, ignoring the tower
  p.x = 1900; p.y = 1200; q.x = 3500; q.y = 2500; p.hp = p.maxHp = q.hp = q.maxHp = 500; m.swingReady = T + 1e9;
  think(.5); ok(z.x > 1560 && z.targetId === "A", `walks straight at the nearest survivor (${Math.round(z.x - 1500)}px in 0.5s)`);
  // swing: hit + knockback + burning; a dodging survivor takes nothing
  z.x = 1500; z.y = 1200; p.x = 1650; p.y = 1200; m.swingReady = 0; think(.05); ok(z.act === "swing", "someone close: Censer Swing");
  q.x = 1500; q.y = 1330; room.dodgeUntil.set("B", T + 5000);
  think(1.0); ok(p.hp < 500 && p.x > 1700 && room.pBurn.has("A"), `the spin hits, knocks back (${Math.round(p.x - 1650)}px) and sets them on fire`);
  ok(q.hp === 500 && !room.pBurn.has("B"), "a survivor dashing through it takes nothing");
  const h0 = p.hp; think(1.2); ok(p.hp < h0, `burning keeps hurting (${(h0 - p.hp).toFixed(1)} in 1.2s)`);
  think(3); ok(!room.pBurn.has("A"), "the fire goes out after 3s");
  // firewalk: patches behind him; standing in one sets you on fire
  room.dodgeUntil.delete("B"); z.act = ""; m.swingReady = T + 1e9; m.walkReady = 0; p.x = 2600; p.y = 1200; q.x = 3500; q.y = 2500; z.x = 1500; z.y = 1200;
  think(2); const pt = room.pyreFx.patches.length; ok(pt >= 8, `Firewalk leaves burning patches as he walks (${pt} in 2s)`);
  const patch = room.pyreFx.patches[0]; q.x = patch.x; q.y = patch.y - 16; think(.1); ok(room.pBurn.has("B"), "standing in a patch sets you on fire");
  // sermon: kneels, pillars land on survivors and erupt after 1s; double damage from behind
  m.walkUntil = 0; room.pyreFx.patches = []; room.pBurn.clear(); z.act = ""; z.x = 1500; z.y = 1200; p.x = 1800; p.y = 1200; q.x = 1200; q.y = 1200; p.hp = q.hp = 500; m.sermonReady = 0;
  think(.6); ok(z.act === "sermon" && room.pyreFx.pillars.length === 7 && p.hp === 500, `Sermon of Ash: kneels, 7 pillars marked, no damage yet (${room.pyreFx.pillars.length})`);
  { const pl = room.pyreFx.pillars, onP = pl.filter(c => Math.hypot(c.x - p.x, c.y - p.y - 16) < 2).length, onQ = pl.filter(c => Math.hypot(c.x - q.x, c.y - q.y - 16) < 2).length;
    const rest = pl.filter(c => Math.hypot(c.x - p.x, c.y - p.y - 16) >= 2 && Math.hypot(c.x - q.x, c.y - q.y - 16) >= 2);
    ok(onP === 1 && onQ === 1 && rest.length === 5 && rest.every(c => { const d = Math.hypot(c.x - z.x, (c.y - z.y - z.radius * .55) / .7); return d >= 105 && d <= 405; }), "one pillar under each survivor (3 closest), the other 5 at random spots around him"); }
  const face = z.aim, hz = z.hp; room.hitZombie(z, z.aim === Math.atan2(p.y - z.y, p.x - z.x) ? q : p, 100);
  ok(Math.abs((hz - z.hp) - 200) < 1, `kneeling: a hit from behind does double (100 -> ${Math.round(hz - z.hp)})`);
  const hz2 = z.hp; room.hitZombie(z, z.aim === Math.atan2(p.y - z.y, p.x - z.x) ? p : q, 100); ok(Math.abs((hz2 - z.hp) - 100) < 1, "...from the front it's normal");
  think(1.0); ok(p.hp < 500 && q.hp < 500 && room.pyreFx.pillars.length === 0, `1s later the pillars erupt on both survivors (${Math.round(500 - p.hp)}, ${Math.round(500 - q.hp)} dmg)`);
  // wheel of flame: 4 lines from where he stands, turning clockwise for 60s; walking with them is safe; it dies with him
  z.act = ""; m.sermonReady = T + 1e9; room.pBurn.clear(); z.x = 1500; z.y = 1200; p.x = 1800; p.y = 1200; q.x = 1200; q.y = 1200; p.hp = q.hp = 500; m.wheelReady = 0;
  think(.05); const wh = room.pyreFx.wheel; ok(z.act === "wheel" && wh && Math.abs(room.wheelAngle(wh, T) + Math.PI / 2) < .01, "Wheel of Flame: around him, first line at 12 o'clock");
  ok(Math.abs((wh.until - wh.fireAt) / 1000 - 60) < .01, "it burns for 60s");
  const a1 = room.wheelAngle(wh, T + 1000); ok(a1 > -Math.PI / 2, "it turns clockwise (screen angle grows)");
  m.swingReady = m.walkReady = T + 1e9; const stand = { sessionId: "S", alive: true, x: wh.x + 300, y: wh.y - 16 }; ok(room.onWheel(wh, stand, T) && room.onWheel(wh, { ...stand, x: wh.x + 300, y: wh.y - 316 }, T) === false, "a line at 3 o'clock touches someone east of the centre, not north-east");
  // a survivor riding just behind a line at 300px (walking clockwise at its speed) stays clear for 20s; one standing still gets hit
  const hp0 = p.hp; let hitWalker = 0, hitStill = 0;
  for (let i = 0; i < 400; i++) { T += 50; const ang = room.wheelAngle(wh, T) - .3; p.x = wh.x + Math.cos(ang) * 300; p.y = wh.y + Math.sin(ang) * 300 - 16; q.x = wh.x - 250; q.y = wh.y - 16;
    Date.now = () => T; try { room.pyreHazards(z, T); } finally { Date.now = real; } if (p.hp < hp0) hitWalker++; }
  ok(hitWalker === 0 && q.hp < 500, `walk clockwise with it and you're safe (${Math.round(500 - q.hp)} dmg to the one standing still)`);
  ok(Math.abs(2 * Math.PI * 300 / 18 - 105) < 1, "at 300px a line moves ~105px/s: easy to keep pace");
  z.x = 2000; z.y = 900; room.pyreHazards(z, T); ok(wh.x === 2000 && Math.abs(wh.y - (900 + z.radius * .8)) < .01, "the wheel follows him");
  T = wh.until + 50; Date.now = () => T; try { room.pyreHazards(z, T); } finally { Date.now = real; } ok(!room.pyreFx.wheel, "gone after 60s");
  m.wheelReady = 0; z.act = ""; z.x = 1500; z.y = 1200; think(.05); ok(room.pyreFx.wheel, "cast again"); room.killZombie(z, p); ok(!room.pyreFx.wheel, "it dies with him");
  room.state.zombies.set(z.id, z); z.hp = z.maxHp * .3; z.act = ""; z.enraged = false; think(.05); ok(z.enraged, "enraged below 35%");
  room._dispose(); }
// 54. barricade + electric fence are fence lines in 8 facings (across the way you face) with the same footprint: zombies stop anywhere along a barricade, the fence shocks along its length
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.mapBoxesNear = () => []; room.mapGrid = new Map();
  room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear(); room.state.scrap = room.state.electronics = 999;
  p.x = 1000; p.y = 1000; send(A, "build", { kind: "barricade", x: 1000, y: 1100 }); send(A, "build", { kind: "fence", x: 1000, y: 1300 });
  const [bar, fen] = [...room.state.structures.values()].slice(-2);
  room.spawnZombie(false, "walker"); const z = [...room.state.zombies.values()].pop(); z.x = bar.x + 40; z.y = bar.y + 20; z.speed = 0;   // near the barricade's right end
  const h0 = bar.hp; for (let i = 0; i < 30; i++) { room.lastTick = Date.now() - 50; room.tick(); } ok(bar.hp < h0, `a zombie at the end of the barricade line hits it (${h0} -> ${Math.round(bar.hp)})`);
  z.x = fen.x - 60; z.y = fen.y; z.hp = 500; room.state.generatorFuel = 100; for (let i = 0; i < 10; i++) { room.lastTick = Date.now() - 50; room.tick(); }
  ok(z.hp < 500, `the fence shocks a zombie 60px along it (${Math.round(500 - z.hp)} dmg)`);
  ok(Math.abs(bar.aim - Math.PI / 2) < 1e-9 && Math.abs(fen.aim - Math.PI / 2) < 1e-9, "built while facing down: horizontal lines (aim = the facing, snapped)");
  // facing right: the line goes up-down (across the way you face)
  room.state.zombies.clear(); p.x = 2000; p.y = 1000; send(A, "build", { kind: "barricade", x: 2100, y: 1010 }); const vb = [...room.state.structures.values()].pop();
  ok(vb.aim === 0, "built while facing right: a vertical line");
  room.spawnZombie(false, "walker"); const z2 = [...room.state.zombies.values()].pop(); z2.x = vb.x + 20; z2.y = vb.y + 40; z2.speed = 0;
  const v0 = vb.hp; for (let i = 0; i < 30; i++) { room.lastTick = Date.now() - 50; room.tick(); } ok(vb.hp < v0, "a zombie at its lower end hits it");
  z2.x = vb.x + 60; z2.y = vb.y; const v1 = vb.hp; for (let i = 0; i < 30; i++) { room.lastTick = Date.now() - 50; room.tick(); } ok(vb.hp === v1, "one 60px to the side doesn't");
  // the barricade has 8 facings: facing down-right gives a "/" line; the fence only snaps to 4
  room.state.zombies.clear(); vb.hp = 0; room.state.structures.delete(vb.id); p.x = 3000; p.y = 1000; send(A, "build", { kind: "barricade", x: 3090, y: 1090 }); const db = [...room.state.structures.values()].pop();
  ok(Math.abs(db.aim - Math.PI / 4) < 1e-9, "facing down-right: a diagonal barricade");
  room.spawnZombie(false, "walker"); const z3 = [...room.state.zombies.values()].pop(); z3.speed = 0; z3.x = db.x + 28; z3.y = db.y - 28;   // up-right, on the "/" line
  let d0 = db.hp; for (let i = 0; i < 30; i++) { room.lastTick = Date.now() - 50; room.tick(); } ok(db.hp < d0, "a zombie on the diagonal (up-right end) hits it");
  z3.x = db.x + 30; z3.y = db.y + 30; d0 = db.hp; for (let i = 0; i < 30; i++) { room.lastTick = Date.now() - 50; room.tick(); } ok(db.hp === d0, "one 42px off the diagonal (down-right) doesn't");
  p.x = 3000; p.y = 1400; send(A, "build", { kind: "fence", x: 3090, y: 1490 }); const df = [...room.state.structures.values()].pop(); ok(Math.abs(df.aim - Math.PI / 4) < 1e-9, "the fence has 8 facings too (diagonal)");
  send(A, "build", { kind: "barricade", x: 3090, y: 1490, face: -Math.PI / 2 + .1 }); ok(Math.abs([...room.state.structures.values()].pop().aim + Math.PI / 2) < 1e-9, "the facing the client's placement preview showed wins (face, snapped)");
  room.spawnZombie(false, "walker"); const z4 = [...room.state.zombies.values()].pop(); z4.speed = 0; z4.x = df.x - 35; z4.y = df.y + 35; z4.hp = 500; room.state.generatorFuel = 100;
  for (let i = 0; i < 10; i++) { room.lastTick = Date.now() - 50; room.tick(); } ok(z4.hp < 500, "a diagonal fence shocks along its line (down-left end)");
  room._dispose(); }
// 54b. Pyre Priest's basic attack: Lamp Strike in front of him (not behind), between the big skills
{ const { room, A, B, send, P } = makeRoom(); room.mapBoxesNear = () => []; room.mapGrid = new Map(); room.lineClear = () => true;
  room._handlers.start(A, {}); room.spawnClock = 1e9; room.state.zombies.clear();
  const p = P(A), q = P(B); q.x = 100; q.y = 100; let T = Date.now() + 5000, real = Date.now;
  room.spawnZombie(false, "pyre"); const z = [...room.state.zombies.values()].pop(); z.x = 1500; z.y = 1200; p.x = 1600; p.y = 1200; p.hp = p.maxHp = 5000; p.armorPct = 0; p.defence = 0;
  const m = room.pmem(z, T); m.swingReady = m.walkReady = m.sermonReady = m.wheelReady = T + 1e9;
  const think = s => { for (let i = 0; i < s / .05; i++) { T += 50; Date.now = () => T; try { room.pyreThink(z, .05, T, null); } finally { Date.now = real; } } };
  think(.05); ok(z.act === "strike", "up close with nothing big ready: Lamp Strike");
  think(.5); ok(p.hp < 5000, `the lamp hits the survivor in front of him (${Math.round(5000 - p.hp)} dmg)`);
  const h1 = p.hp; z.act = ""; m.strikeReady = 0; p.x = 1600; p.y = 1200; think(.05); const aim = z.aim; p.x = 1440; p.y = 1200; think(.5);   // he aimed right, you stepped behind him
  ok(Math.abs(aim) < .01 && p.hp === h1, "step behind him while he winds up: it misses");
  room._dispose(); }
// 54c. Sofea starts with the SMG (not the rifle); 3 swaps SMG <-> pistol; 2 does nothing until she buys a primary
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.state.phase = "lobby"; send(A, "chooseClass", { id: "operator" }); send(A, "start", {}); room.state.phase = "playing";
  ok(p.weapon === "smg" && p.activeSlot === 3 && p.owned === "smg,pistol" && !p.owned.includes("rifle") && p.mag > 0, `Sofea starts with the SMG, loaded (${p.weapon}, mag ${p.mag})`);
  send(A, "slot", { n: 2 }); ok(p.weapon === "smg", "2 (no primary) keeps the SMG");
  send(A, "slot", { n: 3, cycle: true }); ok(p.weapon === "pistol", "3 again swaps to the pistol");
  room._dispose(); }
// 54d. Sienna starts with the sniper; it hits 80 base and +50% on bosses / brutes
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.state.phase = "lobby"; send(A, "chooseClass", { id: "sniper" }); send(A, "start", {}); room.state.phase = "playing";
  ok(p.weapon === "sniper" && p.activeSlot === 2 && p.owned.includes("sniper") && !p.owned.includes("rifle") && p.mag === 5, `Sienna starts with the sniper rifle (${p.weapon}, mag ${p.mag}, ${p.damage} dmg)`);
  room.mapBoxesNear = () => []; room.mapGrid = new Map(); room.lineClear = () => true; room.state.zombies.clear(); room.spawnClock = 1e9; freeze(p); p.x = 1000; p.y = 1000;
  const mk = (kind, x) => { room.spawnZombie(false, kind); const z = [...room.state.zombies.values()].pop(); z.x = x; z.y = 1000; z.hp = z.maxHp = 9999; z.speed = 0; return z; };
  const w1 = mk("walker", 1200); p.lastShot = 0; send(A, "shoot", { a: 0 }); const dw = 9999 - w1.hp; room.state.zombies.clear();
  const b1 = mk("brute", 1200); p.lastShot = 0; p.mag = 5; send(A, "shoot", { a: 0 }); const db = 9999 - b1.hp;
  ok(Math.abs(dw - p.damage) < .6 && Math.abs(db - p.damage * 1.5) < .6, `walker takes ${Math.round(dw)}, a brute takes x1.5 (${Math.round(db)})`);
  // Dead Eye (E): aimed, 12x the held gun's shot, pierce from the gun
  room.state.zombies.clear(); const z1 = mk("walker", 1200), z2 = mk("walker", 1260), z3 = mk("walker", 1320), z4 = mk("walker", 1380), off = mk("walker", 1000); off.y = 800;
  let de = 0; const ob = room.broadcast; room.broadcast = (t, m) => { if (t === "deadeye") de++; return ob.call(room, t, m); };
  p.abilityCooldown = 0; send(A, "ability", { a: 0 });
  const per = 9999 - z1.hp;
  ok(de === 1 && Math.abs(per - p.damage * 12) < 2 && z2.hp < 9999 && z3.hp < 9999 && z4.hp === 9999 && off.hp === 9999, `Dead Eye: aimed (the zombie off to the side is safe), 12x the sniper (${Math.round(per)}), through 3 like the sniper`);
  for (const z of [z1, z2, z3]) z.hp = 9999; send(A, "slot", { n: 3 }); p.abilityCooldown = 0; send(A, "ability", { a: 0 });
  ok(p.weapon === "pistol" && Math.abs((9999 - z1.hp) - p.damage * 12) < 2 && z2.hp === 9999, `holding the pistol: 12x the pistol (${Math.round(9999 - z1.hp)}), hits just 1`);
  z1.hp = 9999; send(A, "slot", { n: 1 }); p.abilityCooldown = 0; send(A, "ability", { a: 0 });
  ok(p.activeSlot === 1 && Math.abs((9999 - z1.hp) - per) < 2, `holding the knife: it uses her sniper (${Math.round(9999 - z1.hp)})`);
  room._dispose(); }
// 54e. repair / refuel only next to the tower / generator (the client's F prompt)
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.state.phase = "playing"; room.state.scrap = room.state.fuel = 999;
  room.state.towerHp = 5000; room.state.generatorHp = 500; room.state.generatorFuel = 20; const cx = room.A.cx, cy = room.A.cy;
  p.x = cx + 600; p.y = cy; send(A, "repairTower", { amount: 250 }); send(A, "repairGenerator"); send(A, "refuelGenerator");
  ok(room.state.towerHp === 5000 && room.state.generatorHp === 500 && room.state.generatorFuel === 20, "far away: nothing happens");
  p.x = cx - 70; p.y = cy; send(A, "repairTower", { amount: 250 }); ok(room.state.towerHp === 5250 && room.state.scrap === 989, "next to the tower: +250 HP for 10 scrap");
  p.x = cx + 118 + 50; p.y = cy + 6; send(A, "repairGenerator"); send(A, "refuelGenerator");
  ok(room.state.generatorHp === 800 && room.state.generatorFuel === 45, "next to the generator: repair (+300) and refuel (+25%)");
  // no waste: full = free and nothing happens; nearly full = pay only for what's missing; short on supplies = what you can afford
  room.state.generatorFuel = 100; const f0 = room.state.fuel; send(A, "refuelGenerator"); ok(room.state.fuel === f0, "tank full: refuelling costs nothing");
  room.state.generatorFuel = 95; send(A, "refuelGenerator"); ok(room.state.fuel === f0 - 2 && room.state.generatorFuel === 100, `5%% missing: 2 fuel, not 10 (${f0 - room.state.fuel})`);
  p.x = cx - 70; p.y = cy; room.state.towerHp = room.state.towerMaxHp - 50; let s0 = room.state.scrap; send(A, "repairTower", { amount: 250 });
  ok(room.state.scrap === s0 - 2 && room.state.towerHp === room.state.towerMaxHp, `tower 50 HP short: 2 scrap, not 10 (${s0 - room.state.scrap})`);
  s0 = room.state.scrap; send(A, "repairTower", { amount: 250 }); ok(room.state.scrap === s0, "full tower: nothing spent");
  room.state.towerHp = 5000; room.state.scrap = 4; send(A, "repairTower", { amount: 250 }); ok(room.state.scrap === 0 && room.state.towerHp === 5100, `only 4 scrap: +100 HP for 4 (${room.state.towerHp})`);
  room._dispose(); }
// 54f. picking up a weapon never switches what you're holding (it goes in your bag; 2 cycles to it)
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.state.phase = "playing"; room.spawnClock = 1e9; room.state.zombies.clear(); room.state.loot.clear();
  room.spawnZombie(false, "walker"); const z = [...room.state.zombies.values()].pop(); z.x = p.x + 5; z.y = p.y;
  const rnd = Math.random, seq = [.1, .95]; let ri = 0; Math.random = () => ri < seq.length ? seq[ri++] : .5; try { room.killZombie(z, p); } finally { Math.random = rnd; }   // .95 = a Rare weapon drop
  const lw = [...room.state.loot.values()].find(l => l.kind === "weapon"), held = p.weapon, ammo = p.ammo; room.lastTick = Date.now() - 50; room.tick();
  ok(lw && !room.state.loot.has(lw.id) && p.weapon === held && p.owned.includes("shotgun") && p.ammo === ammo + 30, `found a shotgun: still holding the ${held}, it's in the bag (+30 ammo)`);
  send(A, "slot", { n: 2, cycle: true }); ok(p.weapon === "shotgun", "press 2 to cycle to it");
  send(A, "slot", { n: 3 }); room.spawnZombie(false, "walker"); const z2 = [...room.state.zombies.values()].pop(); z2.x = p.x + 5; z2.y = p.y;   // now holding the pistol, find a sniper
  { const rnd = Math.random, seq = [.1, .98]; let ri = 0; Math.random = () => ri < seq.length ? seq[ri++] : .5; try { room.killZombie(z2, p); } finally { Math.random = rnd; } }
  room.lastTick = Date.now() - 50; room.tick(); ok(p.weapon === "pistol" && p.primary === "sniper", `holding the pistol: still the pistol, and the sniper is ready in slot 2 (${p.primary})`);
  send(A, "slot", { n: 2, cycle: true }); ok(p.weapon === "sniper", "one press of 2 equips it");
  room._dispose(); }
// 55. the turret tells the clients where it aims and when it fires (8-direction art + firing loop)
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.mapBoxesNear = () => []; room.mapGrid = new Map(); room.lineClear = () => true;
  room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear(); room.state.scrap = room.state.electronics = 999; room.state.generatorFuel = 100; room.state.generatorHp = 500;
  p.x = 1000; p.y = 1000; send(A, "build", { kind: "turret", x: 1000, y: 1100, face: Math.PI / 2 }); const tu = [...room.state.structures.values()].pop();
  ok(tu.kind === "turret" && Math.abs(tu.aim - Math.PI / 2) < 1e-9 && !tu.fire, "placed facing away from you, not firing");
  room.spawnZombie(false, "walker"); const z = [...room.state.zombies.values()].pop(); z.x = tu.x - 150; z.y = tu.y; z.speed = 0; z.hp = 9999;
  room.lastTick = Date.now() - 50; room.tick(); ok(tu.fire && Math.abs(Math.abs(tu.aim) - Math.PI) < .01, `fires and aims at the zombie on its left (aim ${tu.aim.toFixed(2)})`);
  room.state.generatorFuel = 0; room.lastTick = Date.now() - 50; room.tick(); ok(!tu.fire, "no power: stops firing");
  room._dispose(); }
// 56. a mine's blast hits every zombie around it (more at the centre), not just the one that stepped on it
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.mapBoxesNear = () => []; room.mapGrid = new Map(); room.lineClear = () => true;
  room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear(); room.state.scrap = room.state.explosives = 999;
  p.x = 1000; p.y = 800; send(A, "build", { kind: "mine", x: 1000, y: 900 }); const mine = [...room.state.structures.values()].pop();
  const at = [[20, 0], [-70, 0], [0, 95], [150, 0]].map(([dx, dy]) => { room.spawnZombie(false, "walker"); const z = [...room.state.zombies.values()].pop(); z.x = mine.x + dx; z.y = mine.y + dy; z.speed = 0; z.hp = z.maxHp = 5000; return z; });
  let booms = 0; room.broadcast = ((orig) => (t, m) => { if (t === "boom" && m.k === "mine") booms++; return orig.call(room, t, m); })(room.broadcast);
  for (let i = 0; i < 3; i++) { room.lastTick = Date.now() - 50; room.tick(); }
  const dmg = at.map(z => Math.round(5000 - z.hp));
  ok(!room.state.structures.has(mine.id) && booms === 1, "one zombie steps on it: it blows up once (boom broadcast for the explosion)");
  ok(dmg[0] > 0 && dmg[1] > 0 && dmg[2] > 0 && dmg[3] === 0, `the blast hits the 3 zombies within 100px, not the one at 150px (${dmg.join(", ")})`);
  ok(dmg[0] > dmg[1] && dmg[1] > dmg[2], "more damage nearer the centre");
  room._dispose(); }
// 57. (Nov 9 audit) going down is one event: five zombies biting in the same tick don't shorten the bleed-out five times
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.mapBoxesNear = () => []; room.mapGrid = new Map();
  room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear(); p.x = 1000; p.y = 1000; p.hp = 1; p.armor = 0;
  for (let i = 0; i < 5; i++) { room.spawnZombie(false, "walker"); const z = [...room.state.zombies.values()].pop(); z.x = p.x + 20 * Math.cos(i * 1.2); z.y = p.y + 20 * Math.sin(i * 1.2); z.attackCooldown = 0; z.damage = 50; }
  room.lastTick = Date.now() - 50; room.tick();
  ok(!p.alive && p.bleedout === 30 && room.downs.get("A") === 1, `down once: 30s bleed-out, 1 down counted (bleedout ${p.bleedout}, downs ${room.downs.get("A")})`);
  room.lastTick = Date.now() - 50; room.tick(); ok(!p.alive && p.bleedout > 29.8 && room.downs.get("A") === 1, "the next tick's bites don't count as going down again");
  room._dispose(); }
// 58. stuck watchdog: a zombie wedged on nothing for 4s walks the flow field, 5s more and it comes back in from a spawn point
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.mapBoxesNear = () => []; room.mapGrid = new Map();
  room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear(); p.x = 1000; p.y = 1000;
  room.spawnZombie(false, "walker"); const z = [...room.state.zombies.values()].pop(); z.x = 1600; z.y = 1000; z.speed = 0;   // can't move at all: looks exactly like being wedged
  let t = Date.now(); const step = (ms) => { for (let i = 0; i < ms / 50; i++) { t += 50; room.lastTick = t - 50; const real = Date.now; Date.now = () => t; try { room.tick(); } finally { Date.now = real; } } };
  step(3000); ok(Math.round(z.x) === 1600 && !(room.zStuck.get(z.id)?.flowUntil > 0), "3s without moving: nothing yet");
  step(1500); ok(room.zStuck.get(z.id)?.flowUntil > 0, "4s: switched to the flow field");
  step(5500); ok(Math.hypot(z.x - 1600, z.y - 1000) > 300, `still stuck 5s later: re-entered from a spawn point (now at ${Math.round(z.x)},${Math.round(z.y)})`);
  room._dispose(); }
// 59. build: the 20 cap counts deployables only, and nothing can be built in the lobby
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.mapBoxesNear = () => []; room.mapGrid = new Map();
  room.state.phase = "lobby"; room.state.scrap = 9999; send(A, "build", { kind: "barricade", x: p.x + 40, y: p.y }); ok(room.state.structures.size === 0, "lobby: no building");
  room.state.phase = "playing"; room.spawnClock = 9999; room.state.zombies.clear(); room.state.scrap = 9999;
  room.deployHeavyTurret(p); send(A, "setName", {});   // Viktor's heavy turret is a structure too
  for (let i = 0; i < 20; i++) send(A, "build", { kind: "barricade", x: p.x + 40 + i * 3, y: p.y });
  const deployables = [...room.state.structures.values()].filter(st => st.kind === "barricade").length;
  ok(deployables === 10 && room.state.structures.size === 11, `barricades (per-player cap 10) sit next to the heavy turret, which doesn't count (${deployables} + heavy turret = ${room.state.structures.size})`);
  send(A, "build", { kind: "barricade", x: p.x + 40, y: p.y + 60 }); ok([...room.state.structures.values()].filter(st => st.kind === "barricade").length === 10 && [...room.state.structures.values()].some(st => st.kind === "heavyTurret"), "one more replaces the oldest barricade (still 10), the heavy turret stays");
  room._dispose(); }
// 60. THE SCREAMER (wave 12): keeps his distance, shriek cone, echo rings (dash dodges), resonance, wail vs cover, choke, call of the horde, enrage
{ const { room, A, B, send, P } = makeRoom(); const p = P(A), q = P(B); room.setMapBoxes([]); room.lineClear = () => true;
  room.spawnClock = 1e9; room.state.zombies.clear(); const ev = []; room._onBroadcast = (t, m) => { if (t === "scream") ev.push(m); };
  let t = Date.now(); const step = (ms) => { for (let i = 0; i < ms / 50; i++) { t += 50; room.lastTick = t - 50; const real = Date.now; Date.now = () => t; try { room.tick(); } finally { Date.now = real; } } };
  const fresh = () => { room.state.zombies.clear(); room.bossMem.clear(); room.scrFx = { rings: [], marks: [], frenzy: new Map() }; ev.length = 0;
    room.spawnZombie(true, "screamer"); const z = [...room.state.zombies.values()].pop(); z.x = 1500; z.y = 1000; z.hp = z.maxHp = 50000; return z; };
  const far = (pl) => { pl.x = 3400; pl.y = 2400; };
  const heal = () => { for (const pl of [p, q]) { pl.alive = true; pl.hp = pl.maxHp = 5000; pl.stunned = 0; pl.slowed = 0; } };
  heal();
  { const z = fresh(); const m = room.smem(z, t); m.shriekReady = m.ringsReady = m.markReady = m.wailReady = t + 1e9; p.x = 1600; p.y = 1000; far(q);
    const d0 = Math.hypot(z.x - p.x, z.y - p.y); step(1000); const d1 = Math.hypot(z.x - p.x, z.y - p.y);
    ok(z.kind === "screamer" && z.role === "hunter" && d1 > d0 + 60, `keeps his distance: backs off when you close in (${Math.round(d0)} -> ${Math.round(d1)}px)`); }
  { const z = fresh(); const m = room.smem(z, t); m.ringsReady = m.markReady = m.wailReady = t + 1e9; m.shriekReady = 0; p.x = 1700; p.y = 1000; q.x = 1250; q.y = 1000; heal();
    z.speed = 0; step(1200); const hp = p.hp, hq = q.hp;
    ok(ev.some(e => e.k === "shriek") && p.maxHp - hp > 0 && q.hp === q.maxHp, `shriek: hits the survivor in front (${Math.round(p.maxHp - hp)} dmg), not the one behind him`); }
  { const z = fresh(); const m = room.smem(z, t); m.shriekReady = m.markReady = m.wailReady = t + 1e9; m.ringsReady = 0; z.speed = 0; heal();
    p.x = 1500 + 250; p.y = 1000 - 16; q.x = 1500; q.y = 1000 + 300 * .6 - 16; room.dodgeUntil.set("B", t + 1e9);   // B dashes the whole time
    step(3000);
    ok(ev.filter(e => e.k === "ring").length === 3 && p.hp < p.maxHp && p.slowed > 0, `echo rings: 3 rings, each hit hurts + slows (${Math.round(p.maxHp - p.hp)} dmg)`);
    ok(q.hp === q.maxHp, "dashing through a ring (i-frames) dodges it"); room.dodgeUntil.delete("B"); }
  { const z = fresh(); const m = room.smem(z, t); m.shriekReady = m.ringsReady = m.wailReady = t + 1e9; m.markReady = 0; z.speed = 0; heal();
    p.x = 1800; p.y = 1000; q.x = 1840; q.y = 1000; step(900);
    const mk = ev.find(e => e.k === "mark"); ok(mk && mk.ids.length === 2, "resonance: marks 2 survivors");
    step(3200); ok(ev.filter(e => e.k === "burst").length === 2 && p.hp < p.maxHp && q.hp < q.maxHp, `...3s later both marks burst, hurting everyone near them (${Math.round(p.maxHp - p.hp)} / ${Math.round(q.maxHp - q.hp)})`); }
  { const z = fresh(); const m = room.smem(z, t); m.shriekReady = m.ringsReady = m.markReady = t + 1e9; m.wailReady = 0; z.speed = 0; heal();
    room.setMapBoxes([{ x: 1500, y: 1250, hw: 60, hh: 30 }]);   // a building between him and B
    p.x = 1900; p.y = 1000; q.x = 1500; q.y = 1450; step(400);
    ok(ev.some(e => e.k === "wailWind") && z.act === "wail", "deafening wail: 2.5s wind-up, everyone warned");
    step(2600); const w = ev.find(e => e.k === "wail");
    ok(w && w.hit.includes("A") && !w.hit.includes("B") && p.stunned > 0 && q.hp === q.maxHp, `the wail hits who he can see (A ${Math.round(p.maxHp - p.hp)} dmg + stun); B behind the building is safe`);
    room.setMapBoxes([]); }
  { const z = fresh(); const m = room.smem(z, t); m.shriekReady = m.ringsReady = m.markReady = t + 1e9; m.wailReady = 0; z.speed = 0; heal();
    p.x = 1900; p.y = 1000; far(q); room.state.structures.clear(); room.state.scrap = 999;
    send(A, "build", { kind: "barricade", x: 1700, y: 1000, face: 0 }); step(300); const hp = p.hp; step(2800);
    ok(!ev.find(e => e.k === "wail")?.hit.includes("A") && p.hp === hp, "a barricade between you and him is cover too"); room.state.structures.clear(); }
  { const z = fresh(); const m = room.smem(z, t); m.shriekReady = m.ringsReady = m.markReady = t + 1e9; m.wailReady = 0; z.speed = 0; heal();
    p.x = 1800; p.y = 1000; far(q); step(300); z.aim = 0;
    const hp0 = z.hp; room.hitZombie(z, p, 1000); const front = hp0 - z.hp;
    ok(front === 2000, `his throat takes x2 during the wind-up (1000 -> ${front})`);
    room.hitZombie(z, p, z.maxHp * .04); ok(z.act === "choke" && ev.some(e => e.k === "choke"), "8% of his HP in that window: he CHOKES, the wail is cancelled");
    const hp = p.hp; step(2500); ok(!ev.some(e => e.k === "wail") && p.hp === hp, "...and no wail comes"); }
  { const z = fresh(); const m = room.smem(z, t); m.shriekReady = m.ringsReady = m.markReady = m.wailReady = t + 1e9; z.speed = 0; heal(); far(p); far(q);
    room.state.zombies.forEach(zz => { if (!zz.boss) room.state.zombies.delete(zz.id); }); z.hp = z.maxHp * .6; step(200);
    const run = [...room.state.zombies.values()].filter(zz => zz.kind === "runner");
    ok(ev.some(e => e.k === "call") && run.length === 4 + 2 * 2 && run.every(r => r.role === "hunter"), `call of the horde at 66%: ${run.length} runners that hunt survivors (4 + 2 per survivor)`);
    step(200); z.hp = z.maxHp * .3; step(2000); ok(ev.filter(e => e.k === "call").length === 2 && z.enraged, "second call at 33%, and below 35% he's enraged"); }
  room._dispose(); }
// 61. traits: Astra revives in 2.5s (Field Commander), Sofea pays half for repairs / refuels (Mechanic)
{ const { room, A, B, send, P } = makeRoom(); const r = P(A), f = P(B); room.setMapBoxes([]);
  r.characterClass = "dispatcher"; r.x = 1000; r.y = 1000; f.x = 1030; f.y = 1000; room.downPlayer(f);
  let t = Date.now(); const T = n => { for (let i = 0; i < n; i++) { t += 100; room.lastTick = t - 100; const real = Date.now; Date.now = () => t; try { room.tick(); } finally { Date.now = real; } } };
  send(A, "revive", { targetId: "B" }); T(26); ok(f.alive, "Astra (Field Commander): revives a downed teammate in 2.5s");
  r.characterClass = "operator"; r.x = room.A.cx + 60; r.y = room.A.cy; room.state.towerHp = room.state.towerMaxHp - 250; room.state.scrap = 100;
  send(A, "repairTower"); ok(room.state.scrap === 95 && room.state.towerHp === room.state.towerMaxHp, `Sofea (Mechanic): a full 250 HP tower repair costs her 5 scrap, not 10 (paid ${100 - room.state.scrap})`);
  r.characterClass = "assault"; room.state.towerHp = room.state.towerMaxHp - 250; send(A, "repairTower"); ok(room.state.scrap === 85, "anyone else pays the normal 10");
  room._dispose(); }
// 62. THE ABOMINATION (wave 16): slam line, gut roll + daze, lava spew + puddles, the Sundering into THE FIVE
{ const { room, A, B, send, P } = makeRoom(); const p = P(A), q = P(B); room.setMapBoxes([]); room.lineClear = () => true;
  room.spawnClock = 1e9; room.state.zombies.clear(); const ev = []; room._onBroadcast = (t, m) => { if (t === "abom") ev.push(m); };
  let t = Date.now(); const step = (ms) => { for (let i = 0; i < ms / 50; i++) { t += 50; room.lastTick = t - 50; const real = Date.now; Date.now = () => t; try { room.tick(); } finally { Date.now = real; } } };
  const fresh = () => { room.state.zombies.clear(); room.bossMem.clear(); room.abFx = { puddles: [] }; ev.length = 0;
    room.spawnZombie(true, "abomination"); const z = [...room.state.zombies.values()].pop(); z.x = 1500; z.y = 1500; return z; };
  const only = (z, k) => { const m = room.abmem(z, t); m.slamReady = m.rollReady = m.spewReady = t + 1e9; m[k] = 0; return m; };
  const heal = () => { for (const pl of [p, q]) { pl.alive = true; pl.hp = pl.maxHp = 9000; pl.slowed = 0; } }; const far = pl => { pl.x = 3600; pl.y = 2400; };
  { const z = fresh(); only(z, "slamReady"); z.speed = 0; heal(); p.x = 1700; p.y = 1500; q.x = 1500; q.y = 1740; step(1000);
    ok(ev.some(e => e.k === "slam") && p.hp < p.maxHp && q.hp === q.maxHp, `flail slam: hits the line in front (${Math.round(p.maxHp - p.hp)} dmg), not beside him`); }
  { const z = fresh(); only(z, "rollReady"); heal(); p.x = 1900; p.y = 1500; far(q); const x0 = z.x; step(900); const curl = z.x; step(1200);
    ok(ev.some(e => e.k === "roll") && curl === x0 && z.x > x0 + 300 && p.hp < p.maxHp, `gut roll: 1s curl, then he rolls through you (${Math.round(z.x - x0)}px, ${Math.round(p.maxHp - p.hp)} dmg)`); }
  { const z = fresh(); only(z, "rollReady"); heal(); p.x = 2100; p.y = 1500; far(q); room.setMapBoxes([{ x: 1800, y: 1500, hw: 30, hh: 200 }]); p.x = 2100; step(2200);
    ok(z.x > 1860 && z.act !== "daze" || z.act === "daze" && z.x > 1860, `rolls THROUGH a building (x ${Math.round(z.x)})`); step(1500);
    ok(z.act === "daze" && ev.some(e => e.k === "daze") && !room.blockedByMap(z.x, z.y, 10), "the roll always ends with him DAZED, never inside a building"); const h = z.hp; room.hitZombie(z, p, 100); ok(Math.round(h - z.hp) === 150, "dazed: takes x1.5 damage"); room.setMapBoxes([]); }
  { const z = fresh(); only(z, "spewReady"); z.speed = 0; heal(); p.x = 1700; p.y = 1500; q.x = 1500; q.y = 1250; step(1500); const d1 = p.maxHp - p.hp;
    ok(ev.some(e => e.k === "spew") && d1 > 0 && q.hp === q.maxHp && room.abFx.puddles.length === 5, `lava spew: burns the cone (${Math.round(d1)} dmg), leaves 5 puddles`);
    room.abmem(z, t).spewReady = t + 1e9; step(1500); p.x = z.x + 330; p.y = z.y - 14; const h = p.hp; step(1200); ok(p.hp < h && p.slowed > 0, "standing in a lava puddle burns and slows"); step(8000); ok(room.abFx.puddles.length === 0, "puddles cool after 7s"); }
  { const z = fresh(); only(z, "spewReady"); z.speed = 0; heal(); p.x = 2150; p.y = 1500; far(q); room.setMapBoxes([{ x: 1850, y: 1500, hw: 30, hh: 120 }]); const stub = room.lineClear; delete room.lineClear; step(1500);
    ok(ev.some(e => e.k === "spew") && p.hp === p.maxHp, "the 840px lava jet doesn't go through walls (no puddles past it either)"); room.setMapBoxes([]); room.lineClear = stub;
    const z2 = fresh(); only(z2, "spewReady"); z2.speed = 0; heal(); p.x = 2150; p.y = 1500; step(1500); ok(p.hp < p.maxHp, `...but reaches ${p.x - z2.x}px in the open`); }
  { const z = fresh(); only(z, "none"); z.speed = 0; heal(); p.x = 1900; p.y = 1500; q.x = 1900; q.y = 1700; const max = z.maxHp;
    room.hitZombie(z, p, max * 5); ok(z.hp > 0 && z.hp <= max * .45, "one huge hit can't kill him: he stops at the split point");
    step(100); ok(z.act === "sunder" && ev.some(e => e.k === "sunder"), "at 45% HP: THE SUNDERING starts"); const h = z.hp; room.hitZombie(z, p, 500); ok(z.hp === h, "...and he can't be hurt while he tears apart");
    step(4300); const five = [...room.state.zombies.values()].filter(o => o.kind === "abomSpawn");
    ok(!room.state.zombies.has(z.id) && five.length === 5 && five.every(o => o.boss && Math.abs(o.maxHp - max * .13) < 1) && !room.state.bossDead, `he's gone: 5 spawn, each with its own ${Math.round(max * .13)} HP`);
    const tg = new Set(five.map(o => room.bossMem.get(o.id).tgt)); ok(tg.size === 2, "they spread over the survivors");
    const d0 = Math.hypot(five[0].x - 1900, five[0].y - 1500); step(1000); ok(five.some(o => Math.hypot(o.x - 1500, o.y - 1500) > 150), "the Five are fast");
    step(3000); ok(ev.some(e => e.k === "lunge") && ev.some(e => e.k === "land") && (p.hp < p.maxHp || q.hp < q.maxHp), "they pounce");
    const sp0 = five[1].speed; room.hitZombie(five[0], p, 1e6); ok(!room.state.bossDead && five[1].speed > sp0, "one falls: not a boss kill yet, the rest speed up");
    for (const o of five.slice(1, 4)) room.hitZombie(o, p, 1e6); ok(five[4].enraged && !room.state.bossDead, "the last one is enraged");
    room.hitZombie(five[4], p, 1e6); ok(room.state.bossDead, "all five down: the boss is dead"); }
  room.state.phase = "playing"; room.state.bossDead = false; room.state.waveType = "normal"; room.bossOverAt = 0;
  { const z = fresh(); room.state.elapsed = 500; step(300); ok(room.state.phase === "playing" && room.state.zombies.has(z.id), "a test-spawned boss holds a normal wave open past 90s (it used to vanish)"); }
  { const z = fresh(); z.speed = 0; far(p); far(q); z.hp = -50; room.killZombie(z, p); ok(room.state.zombies.has(z.id) && z.hp > 0, "killed by something else (trap, blast): he doesn't vanish"); step(200); step(200); ok(z.act === "sunder", "...the Sundering plays first"); step(4400);
    ok(!room.state.zombies.has(z.id) && [...room.state.zombies.values()].filter(o => o.kind === "abomSpawn").length === 5, "...then the Five"); }
  { const z = fresh(); z.speed = 0; heal(); only(z, "slamReady"); p.characterClass = "operator"; p.x = 1650; p.y = 1500; far(q); room.state.vehicles.clear?.(); const ok1 = room.callVehicle(p, "heli"); for (let i = 0; i < 100 && room.state.vehicles.get(p.sessionId)?.phase !== "ride"; i++) step(50);
    const v = room.state.vehicles.get(p.sessionId); p.x = 1650; p.y = 1500; if (v) { v.x = p.x; v.y = p.y; } p.hp = p.maxHp; ev.length = 0; room.abmem(z, t).slamReady = 0; z.act = ""; z.slam = 0; step(2600);
    ok(ok1 && v?.phase === "ride" && ev.some(e => e.k === "slam") && p.hp < p.maxHp, `bosses attack Sofea in her helicopter (${Math.round(p.maxHp - p.hp)} dmg)`);
    room.state.zombies.clear(); room.bossOverAt = 0; room.state.elapsed = 0; step(100); ok(room.untouchable(p), "no boss around: ordinary zombies still can't reach the helicopter"); room.state.vehicles.delete(p.sessionId); }
  { const z0 = fresh(); room.state.zombies.clear(); room.state.phase = "playing"; room.bossOverAt = 0; room.state.elapsed = 0; room.state.hostId = A.sessionId; send(A, "debugMorph"); step(300); ok(room.state.stage === 24 && room.state.bossPhase === "intro" && room.state.bossIntro === "abomination", `debugMorph: his boss card first (${room.state.bossPhase}, wave ${room.state.stage})`);
    for (const pl of room.state.players.values()) send({ sessionId: pl.sessionId }, "ackBoss"); step(400); const z = [...room.state.zombies.values()].find(o => o.kind === "abomination"); ok(z?.act === "sunder", "...then he arrives already tearing apart");
    send(A, "debugMorph"); ok(z.act === "sunder", "debugMorph again: nothing breaks"); }
  room._dispose(); }
{ /* NETWORK SCHEMA: at most 64 synced fields per class (field 65+ silently corrupts patches: Nov 10-11 players invisible/frozen online), and a real encode -> decode round trip of a player */
  const SC = await import(join(root, "server/src/schema.js")), SS = await import(join(root, "server/node_modules/@colyseus/schema/build/esm/index.mjs"));
  const counts = SC.schemaFieldCounts(); ok(Object.values(counts).every(n => n <= 64), `every synced class has <= 64 fields (${Object.entries(counts).map(([k, n]) => k.replace("State", "") + " " + n).join(", ")})`);
  const st = new SC.GameState(); st.players = new SS.MapSchema(); const mk = id => { const p = new SC.PlayerState(); p.sessionId = id; p.name = id; p.alive = true; p.x = 100; p.y = 200; st.players.set(id, p); return p; };
  const a = mk("A"); const enc = new SS.Encoder(st), dec = SS.Reflection.decode(SS.Reflection.encode(enc)); dec.decode(enc.encodeAll()); enc.discardChanges();
  const names = Object.values(SC.PlayerState[Symbol.metadata]).map(f => f?.name).filter(Boolean), same = (u, v) => typeof v === "number" ? Math.abs((u ?? 0) - v) < 1e-4 : JSON.stringify(u ?? null) === JSON.stringify(v ?? null);
  const b = mk("B"); for (const p of [a, b]) for (const n of names) { const t = SC.PlayerState[Symbol.metadata][names.indexOf(n)]?.type; if (n === "sessionId") continue; p[n] = t === "string" ? "v" + n : t === "boolean" ? true : typeof t === "string" ? 7 : p[n]; }
  dec.decode(enc.encode()); enc.discardChanges(); a.x = 321; b.alive = false; dec.decode(enc.encode());
  const bad = [...st.players].flatMap(([id, p]) => names.filter(n => typeof p[n] !== "object" && p[n] !== undefined && !same(dec.state.players.get(id)?.[n], p[n])).map(n => id + "." + n));
  ok(!bad.length, `every player field reaches the browser intact after a change (${bad.slice(0, 6).join(", ") || "all " + names.length + " fields ok"})`);
}
{ /* Nov 12: Astra's officers scale with his Heavy Weapon picks, +15% per pick (captures the damage each officer bullet is fired with) */
  const room = new SurvivalRoom(); room.onCreate({ site: 0 }); room._onBroadcast = () => {}; room.state.noCd = false; room.onJoin({ sessionId: "A" }, { name: "Astra" }); room._handlers.chooseClass({ sessionId: "A" }, { id: "dispatcher" });
  room._handlers.start({ sessionId: "A" }, {}); room.spawnClock = 9999; room.state.zombies.clear(); const p = room.state.players.get("A");
  const shots = []; const orig = room.machineShot.bind(room); room.machineShot = (x, y, a, r, dmg, pc, o) => { shots.push(dmg); return orig(x, y, a, r, dmg, pc, o); };
  const fire = bonus => { p.bonusDamage = bonus; shots.length = 0; room.state.zombies.clear(); for (const r of [...room.state.robots.values()]) room.removeUnit(r); room.amemOf(p).polReady = 0; room.amemOf(p).polOut = false;
    room.amemOf(p).cast = null; room.astraCast(p, "Q"); const mc = room.amemOf(p); if (mc.cast) mc.cast.at = 0; room.lastTick = Date.now() - 50; room.tick();
    for (const r of room.unitsOf("A", "police")) room.unitMem.get(r.id).nextBurst = 0;
    placeZombie(room, p.x + 160, p.y, 1e6); for (let i = 0; i < 80 && !shots.length; i++) { room.lastTick = Date.now() - 50; room.tick(); } return shots[0] || 0; };
  const d0 = fire(0), d2 = fire(40);
  ok(d0 > 0 && Math.abs(d2 / d0 - 1.3) < .01, `2 Heavy Weapon picks: Astra's officers hit 30% harder (${d0.toFixed(2)} -> ${d2.toFixed(2)} per bullet)`); room._dispose(); }
{ /* Nov 12: deployable caps PER PLAYER per type (turret 3, fence 4, flame trap 4, mine 8, barricade 10); one more replaces your oldest; Viktor +1 turret */
  const room = new SurvivalRoom(); room.onCreate({ site: 0 }); room._onBroadcast = () => {}; const A = { sessionId: "A" }, B = { sessionId: "B" };
  room.onJoin(A, { name: "Ann" }); room.onJoin(B, { name: "Vik" }); room._handlers.chooseClass(B, { id: "engineer" }); room._handlers.start(A, {}); room.spawnClock = 9999; room.state.zombies.clear();
  const s = room.state; s.scrap = s.electronics = s.explosives = s.fuel = 1e5; const a = s.players.get("A"), b = s.players.get("B"); a.x = 1000; a.y = 1000; b.x = 1600; b.y = 1000;
  const build = (c, p, kind, i) => room._handlers.build(c, { kind, x: p.x + 40 + (i % 5) * 40, y: p.y + 60 + Math.floor(i / 5) * 40 });
  const own = (id, kind) => [...s.structures.values()].filter(st => st.kind === kind && st.ownerId === id);
  for (let i = 0; i < 3; i++) build(A, a, "turret", i); const first = own("A", "turret").map(t => t.id);
  ok(own("A", "turret").length === 3, "a player can have 3 turrets");
  build(A, a, "turret", 3); const now4 = own("A", "turret").map(t => t.id);
  ok(now4.length === 3 && !now4.includes(first[0]) && now4.includes(first[1]), "a 4th turret replaces your OLDEST one (still 3)");
  for (let i = 0; i < 4; i++) build(B, b, "turret", i); ok(own("B", "turret").length === 4 && own("A", "turret").length === 3, "Viktor can have 4 turrets; the caps are per player (Ann still has 3)");
  for (let i = 0; i < 12; i++) build(A, a, "barricade", i); ok(own("A", "barricade").length === 10, `barricades cap at 10 per player (${own("A", "barricade").length})`);
  for (let i = 0; i < 10; i++) build(A, a, "mine", i); ok(own("A", "mine").length === 8, "mines cap at 8");
  for (let i = 0; i < 6; i++) { build(A, a, "fence", i); build(A, a, "flameTrap", i + 6); } ok(own("A", "fence").length === 4 && own("A", "flameTrap").length === 4, "fences and flame traps cap at 4");
  ok([...s.structures.values()].length > 20, `no team-wide 20 cap any more (${s.structures.size} out)`); room._dispose(); }
// 63. (Nov 12) the new Esc menu's developer tools: the host (not just the solo preview) skips to any boss at 66% / 33%, the Mine Beast at its shield runs, the chase, the escape
{ const { room, A, B, send, P } = makeRoom(); const p = P(A), q = P(B); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); for (const o of [p, q]) { o.hp = o.maxHp; if (!o.alive) { o.alive = true; o.bledOut = false; o.bleedout = 0; } } } };
  const boss = () => [...room.state.zombies.values()].find(z => z.boss);
  room.state.stage = 2; room.beginWave(); room.state.elapsed = 20;
  send(B, "debugBoss", { wave: 8, pct: .66 }); ok(room.state.stage === 2, "a non-host can't use the boss skips");
  send(A, "debugBoss", { wave: 8, pct: .66 }); ok(room.state.stage === 8 && room.state.bossPhase === "horde", "the host skips to the Pyre Priest (wave 8)");
  room.spawnBoss(); const z8 = boss(); ok(z8 && Math.abs(z8.hp / z8.maxHp - .66) < .01, `...and he arrives at 66% HP (${Math.round(z8.hp / z8.maxHp * 100)}%)`);
  send(A, "debugBoss", { wave: 8, pct: .33 }); ok(boss() === z8 && Math.abs(z8.hp / z8.maxHp - .33) < .01, "33% while he's already here: his HP is just set (no restart)");
  send(B, "debugUlt"); ok(q.ultKills === 0 || q.ultKills === undefined || q.ultKills < 100, "a non-host can't unlock their ultimate");
  send(A, "debugUlt"); ok(p.ultKills >= 100, "the host can");
  room.state.zombies.clear(); room.state.bossPhase = ""; room.state.phase = "playing";
  send(A, "debugMine", { k: "boss", pct: .66 }); const m = room.mine;
  ok(m && m.step === "awake", "SKIP TO MINE BEAST 66%: the mission starts and the Beast wakes up");
  tick(Math.ceil(7 / .05) + 8); const z = [...room.state.zombies.values()].find(o => o.kind === "minebeast");
  ok(m.step === "fight" && z && z.hp < z.maxHp * .66, `...it starts the fight just under 66% (${Math.round(z?.hp / z?.maxHp * 100)}%)`);
  for (let i = 0; i < 60 && !m.shield; i++) tick(1); ok(!!m.shield, "...so its first shield run comes straight up");
  send(A, "debugMine", { k: "boss", pct: .33 }); ok(!m.shield && z.hp < z.maxHp * .33 && m.shieldsDone === 1, "33% during the fight: the old shield is cleared, HP set just under 33%");
  for (let i = 0; i < 60 && !m.shield; i++) tick(1); ok(!!m.shield && m.shieldsDone === 2, "...and the second shield run comes up");
  send(A, "debugMine", { k: "chase" }); ok(m.step === "chase" || m.step === "escaped", `SKIP TO THE CHASE (${m.step})`);
  send(A, "debugMine", { k: "escape" }); ok(m.step === "escaped", "SKIP TO THE ESCAPE: through the portal");
  room._dispose(); }
{ const { room, A, send } = makeRoom(); room.state.stage = 3; room.beginWave(); room.state.elapsed = 20;
  send(A, "debugMine", { k: "escape" }); ok(room.mine && room.mine.step === "escaped", "SKIP TO THE ESCAPE from an ordinary wave: the mission starts and goes straight to the portal"); room._dispose(); }
// 64. (Nov 12) THE HOST PAUSE: Esc menu open = the whole game stops (no moving, no damage, no timers); only the host can pause; leaving unpauses
{ const { room, A, B, send, P } = makeRoom(); const p = P(A), q = P(B); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room.state.stage = 3; room.beginWave(); room.spawnClock = 9999; p.x = 900; p.y = 900; q.x = 1500; q.y = 900; const z = placeZombie(room, 930, 900, 500); z.speed = 60; z.damage = 30;
  send(B, "pause", { on: true }); ok(!room.state.paused, "a non-host can't pause");
  send(A, "pause", { on: true }); ok(room.state.paused, "the host pauses the game");
  const hp0 = p.hp, zx = z.x, el0 = room.state.elapsed; tick(60); ok(p.hp === hp0 && z.x === zx && room.state.elapsed === el0, `paused: zombies freeze, nobody takes damage, the wave clock stops (hp ${hp0} -> ${p.hp})`);
  const qx = q.x; send(B, "input", { dx: 1, dy: 0, s: 1, dt: 50 }); tick(3); send(B, "attack", { a: 0 }); ok(q.x === qx, "paused: players can't move or shoot");
  const bm = { next: Date.now() + 3000 }; room.bossMem.set("zz", bm); const was = bm.next; room.pausedAt = Date.now() - 5000;
  send(A, "pause", { on: false }); ok(!room.state.paused && bm.next >= was + 4900, "unpaused: the boss timers are pushed back by the pause (no instant attacks)"); room.bossMem.delete("zz");
  tick(20); ok(p.hp < hp0 || z.x !== zx, "...and the game carries on");
  send(A, "pause", { on: true }); room.onLeave(A, true); ok(!room.state.paused && room.state.hostId === "B", "the host leaves while paused: the game unpauses for the new host");
  room._dispose(); }
// 65. (Nov 12) THE PYRE PLATE: the Pyre Priest drops one per survivor; pick it up, wear it (T): -25% damage, +30 max HP, fireproof; unclaimed ones are handed out
{ const { room, A, B, send, P } = makeRoom(); const p = P(A), q = P(B); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room.state.stage = 16; room.beginWave(); room.state.zombies.clear(); room.spawnZombie(true); const pz = [...room.state.zombies.values()].find(o => o.boss);
  ok(pz?.kind === "pyre", "wave 16: the Pyre Priest"); pz.x = 1200; pz.y = 900; p.x = 600; p.y = 600; q.x = 2400; q.y = 1600; room.killZombie(pz, p);
  const plates = [...room.state.loot.values()].filter(l => l.kind === "pyreplate"); ok(plates.length === 2, `he drops the PYRE PLATE: one per survivor (${plates.length})`);
  p.x = plates[0].x; p.y = plates[0].y; tick(1); ok(p.armor === 1 && room.state.loot.size >= 1, "walk over one: it's in your backpack");
  p.x = plates[1].x; p.y = plates[1].y; tick(1); ok([...room.state.loot.values()].some(l => l.kind === "pyreplate"), "...and you can't take a second one (it's left for your teammate)");
  const hp0 = p.maxHp; send(A, "gear", { id: "pyreplate", on: true }); ok(p.armor === 2 && p.maxHp === hp0 + 30, `wear it: +30 max HP (${hp0} -> ${p.maxHp})`);
  const base = room.armorHit(q, 100), worn = room.armorHit(p, 100); ok(worn === Math.max(1, Math.round(100 * (1 - (p.armorPct || 0)) * .75 - (p.defence || 0))) && worn < base, `it takes 25% off every hit (${base} -> ${worn})`);
  room.pBurn.set(p.sessionId, { until: Date.now() + 5000, dps: 20 }); const h1 = p.hp; room.tickBurn(.5, Date.now()); ok(p.hp === h1 && !room.pBurn.has(p.sessionId), "fireproof: it can't burn");
  send(A, "gear", { id: "pyreplate", on: false }); ok(p.armor === 1 && p.maxHp === hp0, "take it off: back in the backpack"); send(A, "gear", { id: "pyreplate", on: true });
  ok(q.armor === 0, "your teammate hasn't picked theirs up yet"); room.state.phase = "cleared"; room.inBreak = true; room.startNextWave();
  ok(q.armor === 1 && ![...room.state.loot.values()].some(l => l.kind === "pyreplate"), "the next wave starts: the unclaimed plate is handed out (nobody misses out)");
  room._dispose(); }
// 66. (Nov 12) THE MAP ORDER: Ascension -> Fallen Dynasty -> Whiteout -> Refinery -> The Deep Mine -> (the Crucible, stand-in): 4 waves each, the boss on the 4th, then on to the next map
{ const { room, A, B, send, P } = makeRoom(); room.fixedSite = false; const p = P(A); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  ok(room.state.mapSite === 0, "the match starts at Ascension");
  const bossOf = w => { room.state.stage = w; return room.bossKind(); };
  ok(bossOf(4) === "butcher" && bossOf(8) === "hivemind" && bossOf(12) === "screamer" && bossOf(16) === "pyre" && bossOf(20) === "minebeast" && bossOf(24) === "abomination" && bossOf(28) === "butcher" && bossOf(50) === "apocalypse", "bosses by wave: Butcher 4, Alpha Hivemind 8, Screamer 12, Pyre Priest 16, Mine Beast 20, Abomination 24, then round 2");
  room.state.stage = 3; room.beginWave(); ok(room.state.mapSite === 0, "waves 1-4 stay on Ascension");
  room.state.scrap = 9999; room.state.phase = "playing"; send(A, "build", { kind: "barricade", x: p.x + 60, y: p.y }); const built = room.state.structures.size;
  room.state.stage = 4; room.state.phase = "cleared"; room.beginBreak(); ok(room.state.mapSite === 3 && built > 0 && room.state.structures.size === 0 && room.state.towerHp === room.state.towerMaxHp, `boss down (wave 4): the break is already on FALLEN DYNASTY (built things stay behind, a fresh tower)`);
  room.startNextWave(); ok(room.state.stage === 5 && room.state.mapSite === 3, "wave 5 is on Fallen Dynasty");
  room.jumpToWave(9); ok(room.state.mapSite === 4, "a jump to wave 9: Whiteout Station"); room.jumpToWave(13); ok(room.state.mapSite === 5, "wave 13: Scorched Refinery");
  room.jumpToWave(17); ok(room.state.mapSite === 6 && room.state.waveType === "normal" && !room.mine, "wave 17: The Deep Mine, an ordinary wave first");
  room.jumpToWave(20); ok(room.state.mapSite === 6 && room.mine && room.state.waveType === "mission", "wave 20: the rune mission on the Mine");
  room.jumpToWave(21); ok(room.state.mapSite === 7 && !room.mine && room.state.worldW === 6000 && room.bossDoor?.x === 3000, "wave 21: on to THE CRUCIBLE (6000x4000, the boss comes out of the Great Crucible)");
  room.jumpToWave(25); ok(room.state.mapSite === 0, "wave 25: round 2 starts back at Ascension");
  room.resetMatch?.(); ok(room.state.mapSite === 0, "a new match: Ascension");
  room._dispose(); }
// 67. (Nov 12) THE ALPHA HIVEMIND (wave 8, Fallen Dynasty): a bigger Hivemind boss that tears off Hiveminds at 66% / 33%; no mini Hivemind on wave 6
{ const { room, A, B, send, P } = makeRoom(); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room.state.stage = 6; room.beginWave(); room.state.elapsed = 41; room.spawnClock = 9999; tick(1); ok(![...room.state.zombies.values()].some(z => z.kind === "hivemind"), "wave 6: no mini Hivemind (the Alpha is coming)");
  room.state.stage = 8; room.beginWave(); room.state.zombies.clear(); room.spawnBoss(); const z = [...room.state.zombies.values()].find(o => o.boss);
  room.state.stage = 10; const mini = room.spawnHivemind(); room.state.stage = 8;
  ok(z?.kind === "hivemind" && z.radius > 60 && z.maxHp > mini.maxHp * 2.5, `wave 8's boss: the ALPHA HIVEMIND, bigger and far tougher (r ${z?.radius}, ${Math.round(z?.maxHp)} HP)`); room.state.zombies.delete(mini.id);
  const count = () => [...room.state.zombies.values()].filter(o => o.kind === "hivemind" && !o.boss).length;
  z.hp = z.maxHp * .6; room.hiveThink(z, .05, Date.now(), []); ok(count() === 1, "66%: it tears off a Hivemind");
  z.hp = z.maxHp * .3; room.hiveThink(z, .05, Date.now(), []); ok(count() === 3, "33%: two more");
  room.killZombie(z, P(A)); ok(room.state.bossDead && room.bossOverAt > 0, "kill the Alpha: the boss wave is won");
  room._dispose(); }
// 68. (Nov 12) the Mine Beast's shield run: the rider can't be hurt, and the cart leaves the moment they're on
{ const { room, A, B, send, P } = makeRoom(); const p = P(A), q = P(B);
  room.mine = { step: "fight", shield: { i: 0, t: 0, by: "", ov: 0 } }; room.bossUp = true; p.ride = 1;
  ok(room.untouchable(p), "on the cart during the shield run: can't be hurt"); p.ride = 0; ok(!room.untouchable(p), "...off the cart: you can"); room.mine = null; room._dispose(); }
// 69. (Nov 12) THE CRUCIBLE (lava map): two lava rivers you can't walk on (shots fly over), bridges across, everything reachable from the tower
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.fixedSite = true; room.loadSite(7);
  ok(room.state.mapSite === 7 && room.state.worldW === 6000 && room.state.worldH === 4000 && room.flow && room.A.cx === 3000 && room.A.cy === 2350, "The Crucible: 6000x4000, flow-field zombies, the tower in the middle strip");
  const lava = room.siteBoxes.filter(b => b.low); ok(lava.length > 100, `its lava rivers are solid strips (${lava.length})`);
  const L = lava[40]; ok(room.blockedByMap(L.x, L.y, 0), "you can't stand on the lava");
  ok(room.wallDist(L.x - L.hw - 200, L.y, 0, 600) === 600 && room.wallDist(L.x - L.hw - 200, L.y, 0, 600, true) < 600, "shots fly over it (walking doesn't)");
  const g = room.pathGrid(46), C = 40, cell = (x, y) => Math.floor(y / C) * g.GW + Math.floor(x / C), seen = new Uint8Array(g.GW * g.GH), q = [cell(3000, 2500)]; seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) { const c = q[h], i = c % g.GW, j = (c - i) / g.GW; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= g.GW || b >= g.GH) continue; const n = b * g.GW + a; if (!seen[n] && !g.blocked[n]) { seen[n] = 1; q.push(n); } } }
  ok(seen[cell(700, 2400)] && seen[cell(5300, 2400)], "a boss-sized body gets from the tower to both outer strips (over the bridges)");
  room._dispose(); }
// 70. (Nov 12) BETA MODE (Esc menu, host): everyone takes 1/100 of all damage and can't be downed; the downed get back up
{ const { room, A, B, send, P } = makeRoom(); const p = P(A), q = P(B); const tick = () => { room.lastTick = Date.now() - 50; room.tick(); };
  send(B, "betaMode"); ok(!room.state.beta, "only the host can turn on beta mode");
  q.hp = 0; q.alive = false; send(A, "betaMode"); ok(room.state.beta && q.alive && q.hp === q.maxHp, "the host turns it on: anyone who was down gets back up");
  const inner = room.tickInner; room.tickInner = function () { inner.call(this); p.hp -= 40; };   // something hits you for 40 during a tick
  p.hp = p.maxHp; const h0 = p.hp; tick(); room.tickInner = inner; const lost = h0 - p.hp;
  ok(Math.abs(lost - .4) < .01, `a 40 hit during a tick only takes 1/100 (${lost.toFixed(2)} HP)`);
  room.state.zombies.clear(); p.hp = 5; room.downPlayer(p); ok(p.alive && p.hp >= 1, "a hit that would down you doesn't");
  let big = 0; room._bhp = 0; p._bhp = p.hp = p.maxHp; p.hp -= 5000; room.downPlayer(p); big = p.maxHp - p.hp; ok(p.alive && big > 40 && big < 60, `a 5000 hit counts as 50 (${Math.round(big)})`);
  const t0 = room.state.towerHp = room.state.towerMaxHp; room.towerHit(500); ok(Math.abs(t0 - room.state.towerHp - 5) < .01, "the radio tower takes 1/100 too (500 -> 5)");
  send(A, "betaMode"); ok(!room.state.beta, "the host turns it off"); p.hp = 5; room.downPlayer(p); ok(!p.alive, "...and downs work again");
  room.towerHit(500); ok(Math.abs(t0 - 5 - 500 - room.state.towerHp) < .01, "...and the tower takes full damage again");
  room._dispose(); }
// 71. (Nov 13) START AT WAVE (lobby, host): it picks the map (loaded in the lobby), the match starts on that wave, a new match goes back there
{ const room = new SurvivalRoom(); room.onCreate({ site: 0 }); room._onBroadcast = () => {};
  const A = { sessionId: "A" }, B = { sessionId: "B" }; room.onJoin(A, { name: "Host" }); room.onJoin(B, { name: "Friend" });
  const send = (c, t, d) => room._handlers[t](c, d);
  ok(room.state.startWave === 1 && room.state.mapSite === 0, "a new room starts at wave 1 on Ascension");
  send(B, "settings", { startWave: 13 }); ok(room.state.startWave === 1 && room.state.mapSite === 0, "only the host can pick the start wave");
  send(A, "settings", { startWave: 13 }); ok(room.state.startWave === 13 && room.state.mapSite === 5, `wave 13 -> the Scorched Refinery is loaded in the lobby (site ${room.state.mapSite})`);
  send(A, "settings", { startWave: 0 }); send(A, "settings", { startWave: 51 }); send(A, "settings", { startWave: 7.5 }); ok(room.state.startWave === 13, "...bad values are ignored");
  send(A, "settings", { startWave: 8 }); ok(room.state.mapSite === 3, "wave 8 -> Fallen Dynasty");
  send(A, "start", {}); ok(room.state.phase === "playing" && room.state.stage === 8 && room.state.waveType === "boss" && room.state.mapSite === 3, `the match starts on wave 8, the boss wave (${room.state.stage} ${room.state.waveType})`);
  room.state.phase = "defeat"; send(A, "restart"); ok(room.state.phase === "lobby" && room.state.stage === 1 && room.state.mapSite === 3 && room.state.startWave === 8, "a new match keeps the start wave and its map");
  send(A, "settings", { startWave: 20 }); send(A, "start", {}); ok(room.state.stage === 20 && room.state.mapSite === 6 && !!room.state.mission, "wave 20 starts the Deep Mine mission");
  room.state.phase = "victory"; send(A, "restart"); send(A, "settings", { startWave: 1 }); send(A, "start", {}); ok(room.state.stage === 1 && room.state.mapSite === 0 && !room.state.mission, "back to wave 1: Ascension, normal start");
  room._dispose(); }
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
