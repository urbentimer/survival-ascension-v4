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
  else if (w === "launcher") ok(hit[0] > 0 && hit[1] > 0 && hit[2] === 0 && events.some(e => e.type === "boom"), "launcher rocket flies to the aimed spot and explodes there, hitting everything within 80px");
  else ok(hit[0] > 0 && hit[1] === 0, `${w} hits only the first zombie in the line`);
  ok(backwards === 0, `${w}: shooting the opposite way misses`);
  room._dispose(); }
{ const { room, A, send, P } = makeRoom(); const p = P(A); freeze(p); p.owned += ",shotgun"; send(A, "weapon", { id: "shotgun" });
  const zs = [placeZombie(room, 760, 330), placeZombie(room, 780, 380), placeZombie(room, 760, 430)];
  p.lastShot = 0; send(A, "shoot", { a: 0 }); ok(zs.filter(z => z.hp < 500).length >= 2, "shotgun cone hits several zombies spread out in front");
  room._dispose(); }
{ const { room, events, A, send, P } = makeRoom(); const p = P(A); freeze(p); placeZombie(room, 700, 380); const ammo = p.ammo;
  p.lastShot = 0; send(A, "shoot", {}); p.lastShot = 0; send(A, "shoot", { a: "oops" });
  ok(p.ammo === ammo && !events.length, "shots without a valid aim are ignored (no ammo used)");
  send(A, "shoot", { a: 0 }); send(A, "shoot", { a: 0 }); ok(events.length === 1, "fire-rate limit still applies to aimed shots");
  room._dispose(); }

// 3. dash
{ const { room, A, send, P } = makeRoom(); const p = P(A); freeze(p);
  p.x = 300; p.y = 600; send(A, "dash", { dx: 1, dy: 0 }); ok(Math.round(p.x - 300) === 50, "dash moves 50px"); const x = p.x;
  send(A, "dash", { dx: 1, dy: 0 }); ok(p.x === x, "dash has a cooldown");
  room.lastDashAt.set("A", Date.now() - 4000); send(A, "dash", { dx: 1, dy: 0 }); ok(p.x === x, "still on cooldown after 4s");
  room.lastDashAt.set("A", Date.now() - 5100); send(A, "dash", { dx: 1, dy: 0 }); ok(p.x > x, "ready again after 5s"); room._dispose(); }

// 4. countdown between waves
{ const { room, A, send } = makeRoom(); room.state.elapsed = 90; room.lastTick = Date.now() - 50; room.tick();
  ok(room.state.phase === "cleared", "wave ends after 90s");
  room.lastTick = Date.now() - 50; room.tick(); ok(room.state.countdown > 19 && room.state.countdown <= 20, "20-second break countdown starts (shop open)");
  for (let i = 0; i < 260 && room.state.phase === "cleared"; i++) { room.lastTick = Date.now() - 100; room.tick(); }
  ok(room.state.phase === "playing" && room.state.stage === 2, "next wave starts by itself when the countdown ends");
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
  for (let i = 0; i < 7; i++) send(A, "buy", { id: "armor" }); ok(p.armor === 4 && p.currency === 25, "armour stops when gold runs out (4 plates)");
  p.currency = 500; send(A, "buy", { id: "armor" }); send(A, "buy", { id: "armor" }); ok(p.armor === 5, "armour capped at 5 plates");
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
  send(A, "slot", { n: 3 }); ok(p.weapon === "pistol" && p.damage === 18.5, `...and carries over to the pistol (${p.damage})`);
  ok(p.ammo === 240, "you start with 240 spare ammo");
  room._dispose(); }
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.state.scrap = 999;
  p.x = 300; p.y = 200; send(A, "build", { kind: "barricade", x: 360, y: 200 });
  for (let i = 0; i < 30; i++) send(A, "input", { dx: 1, dy: 0 }), room.lastInputs.set("A", Date.now() - 50);
  ok(p.x < 360 - 20, `walking into a barricade stops you (x=${Math.round(p.x)}, wall starts at 340)`);
  p.x = 320; p.y = 200; room.lastDashAt.clear(); send(A, "dash", { dx: 1, dy: 0 }); ok(p.x < 340, `dash can't go through it either (x=${Math.round(p.x)})`);
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
  ok(shots > 10 && hitRate < 0.85 && hitRate > 0.1, "bots now miss sometimes (not perfect aim) but still help");
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
  { const g3 = events.filter(e => e.type === "demo" && e.k === "boom").pop().pts.find(g => g[2] === 2); zs.r3.x = g3[0]; zs.r3.y = g3[1]; }   // stand where an outer grenade lands
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
  room.state.stage = 6; room.beginWave(); room.state.elapsed = 41; room.spawnClock = 9999; tick(1); ok(hive() && hive().maxHp > h.maxHp, "wave 6: it's back, tougher");
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
  { room.mapBoxesNear = () => [{ x: p.x + 60, y: p.y, hw: 10, hh: 60 }]; const h = a1.hp; hold(8); ok(a1.hp === h, "the flame doesn't go through a wall"); room.mapBoxesNear = () => []; send(A, "input", { a: 0, f: 0 }); tick(10); }
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
// 33c. Fallen Dynasty: a bigger map built from Chinese-city pieces (same system as the city), flow-field zombies
{ const { room, A, send, P } = makeRoom(); const p = P(A); room.state.phase = "lobby";
  send(A, "settings", { map: 3 });
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
  room.state.phase = "lobby"; send(A, "settings", { map: 0 }); ok(room.state.worldW === 3600 && room.state.towerX === 1800 && !room.flow, "back to a city site: the city map again");
  room._dispose(); }
// 34. test mode (host toggle): ultimates unlocked, no cooldown after they end
{ const { room, A, B, send, P } = makeRoom(); const p = P(A); const tick = (n, ms = 50) => { for (let i = 0; i < n; i++) { room.lastTick = Date.now() - ms; room.tick(); } };
  room.state.phase = "lobby"; send(A, "chooseClass", { id: "scout" }); room.state.phase = "playing"; p.ultKills = 0;
  send(B, "testNoCd"); ok(!room.state.noCd, "only the host can switch test mode");
  send(A, "testNoCd"); tick(1); ok(room.state.noCd && p.ultReady, "test mode: the ultimate is unlocked straight away");
  send(A, "ult", {}); ok(p.storm > 0, "...Blade Storm starts"); p.storm = 0.01; tick(3); ok(p.ultReady && p.ultCd === 0, "...and is ready again as soon as it ends (no cooldown)");
  room._dispose(); }
// 35. game log: a crash in the game tick or a message handler is logged and the room keeps running
{ const { room, A, send } = makeRoom(); const logged = []; room.log = (lv, kind, msg) => logged.push([lv, kind, msg]);
  const inner = room.tickInner.bind(room); room.tickInner = () => { throw new Error("test boom"); };
  let threw = false; try { room.tick(); } catch { threw = true; }
  ok(!threw && logged.some(([lv, k, m]) => lv === "error" && /game tick: Error: test boom/.test(m)), "a crash in the game tick is logged (with its stack) instead of killing the room");
  room.tickInner = inner; room.tick(); ok(room.state.phase === "playing", "...and the next tick runs normally");
  send(A, "clientError", { m: "frame: x is not a function" }); ok(logged.some(([lv, k, m]) => k === "client" && /x is not a function/.test(m)), "errors from a player's browser go into the log");
  room._dispose(); }
// 36. BRIGGS (juggernaut): shotgun, Iron Bastion (E: 15s dome, can't be hurt), War Cry (Q: taunt, half damage, team buff, impact)
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
  send(A, "ult", {}); tick(1);
  ok(far.targetId === "A" && near.targetId === "A", "Q: War Cry: zombies within 350px (even tower runners) charge Briggs");
  ok(near.hp < 500 && near.x > nx + 20 && far.hp === 500, "...the shockwave hurts and knocks back the close ones");
  ok(room.cryBuff(q) > 1.2, "...teammates nearby hit 25% harder");
  room.briggs.get("A").safeUntil = 0; const hb = p.hp; near.damage = 40; near.speed = 0; near.x = p.x + 30; near.attackCooldown = 0; tick(1); ok(Math.abs((hb - p.hp) - (40 - p.defence) / 2) < 1, `...and he takes half damage (${(hb - p.hp).toFixed(1)} of ${40 - p.defence})`);
  room.state.zombies.clear(); p.x = 900; p.y = 900; const zz = placeZombie(room, p.x + 120, p.y, 9999), bb = placeZombie(room, p.x + 100, p.y + 100, 1e6); bb.boss = true;
  p.reloadLeft = 0; p.mag = 6; p.lastShot = 0; room.fireWeapon(p, 0, 120); const zx = zz.x;
  ok(zx > p.x + 120 + 40, `passive Forceful Blast: shotgun hits shove zombies back (${Math.round(zx - p.x - 120)}px)`);
  p.lastShot = 0; p.mag = 6; const bx0 = bb.x; room.fireWeapon(p, Math.PI / 4, 141); ok(bb.x > bx0 + 10, `...bosses too (${Math.round(bb.x - bx0)}px)`);
  p.activeSlot = 2; p.weapon = "shotgun"; p.mag = 1; p.reloadLeft = 0; let shots = 0; const t0 = Date.now(); room.broadcast = ((orig) => (t, m) => { if (t === "shot") shots++; return orig.call(room, t, m); })(room.broadcast);
  for (let i = 0; i < 6; i++) { p.lastShot = Date.now() - 1000 / (p.fireRate * 3) - 5; room.fireWeapon(p, 0, 100); }
  ok(shots === 6 && p.mag === 1, `War Cry: shotgun fires 3x faster and uses no ammo (${shots} shots, mag still ${p.mag})`);
  room.ultInfo.get("A").summonedAt -= 10500; tick(1); ok(!p.ultReady && p.ultCd > 50, `after 10s the 60s cooldown runs (${p.ultCd}s left)`);
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
  room.state.zombies.clear(); p.abilityCooldown = 0; const wx = 1000; room.mapGrid = new Map(); room.mapBoxesNear = () => [{ x: wx + 50, y: 900, hw: 50, hh: 200 }]; p.x = 400; p.y = 900;
  send(A, "ability", { a: 0 }); fast(40); ok(!room.hooks.has("A") && p.x > 900 && p.x < wx, `...or hooks a wall and pulls him up to it (x=${Math.round(p.x)}, wall at ${wx})`);
  // miss
  room.mapBoxesNear = () => []; p.abilityCooldown = 0; send(A, "ability", { a: Math.PI }); p.x = 2000; fast(40); ok(!room.hooks.has("A") && p.abilityCooldown > 2.5 && p.abilityCooldown <= 4, `a miss reels back: 4s cooldown (${p.abilityCooldown.toFixed(1)}s)`);
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
  room.mapBoxesNear = () => []; room.mapGrid = new Map();   // open ground for this test
  const call = () => { const m = room.amemOf(p); if (m.cast) m.cast.at = 0; tick(1); };
  room.state.phase = "lobby"; send(A, "chooseClass", { id: "dispatcher" }); send(A, "start", {}); room.state.phase = "playing"; room.spawnClock = 9999; room.state.zombies.clear();
  ok(p.maxHp === 120 && p.speed === 180 && p.primary === "rifle", "Astra: 120 HP, speed 180, rifle");
  p.x = 1000; p.y = 700; q.x = 1060; q.y = 700; events.length = 0;
  send(A, "ability", {}); ok(events.some(e => e.type === "astra" && e.k === "call" && e.s === "E") && !room.unitsOf("A", "doctor").length, "E: 0.45s radio call first");
  call(); const docs = room.unitsOf("A", "doctor"); ok(docs.length === 1 && p.abilityCooldown === 30, `...then exactly 1 doctor, E cooldown 30s (${docs.length})`);
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
  send(A, "ult", {}); call(); const cops = room.unitsOf("A", "police"); ok(cops.length === 2, `Q: one officer per living player (2 players -> ${cops.length})`);
  ok(new Set(cops.map(r => room.unitMem.get(r.id).guard)).size === 2, "...each officer guards a different player");
  { const cq = cops.find(r => room.unitMem.get(r.id).guard === "B"); q.x = 1500; q.y = 900; tick(80); const dq = Math.hypot(cq.x - q.x, cq.y - q.y); ok(dq < 140, `...and stays with that player (${Math.round(dq)}px from B)`); q.x = 1060; q.y = 700; tick(60); }
  send(A, "ult", {}); call(); ok(room.unitsOf("A", "police").length === 2, "...no second squad while they're out");
  const z = placeZombie(room, p.x + 300, p.y, 400); const k0 = p.kills; for (let i = 0; i < 40; i++) { for (const r of room.unitsOf("A", "police")) { const m = room.unitMem.get(r.id); m.nextBurst = Math.min(m.nextBurst, Date.now()); m.nextShot = 0; } tick(1); }
  ok(!room.state.zombies.has(z.id) && p.kills > k0, `police shoot zombies (7 dmg bullets in bursts of 3) and Astra gets the kill (${p.kills - k0})`);
  ok(q.hp === q.maxHp, "...they never shoot teammates");
  for (const r of room.unitsOf("A", "police")) room.unitMem.get(r.id).until = 0; tick(1); tick(1);
  ok(!room.unitsOf("A", "police").length && !p.ultReady && p.ultCd > 59, `after 30s they go home and the 60s cooldown starts (${p.ultCd}s)`);
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
  ok(room.state.mapSite === 1 && room.state.mapLayout !== lay0 && room.mapGrid.size > 0, "host picks Site 02: a different map layout");
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
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED"); process.exit(fails ? 1 : 0);
