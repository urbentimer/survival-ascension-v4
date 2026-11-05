import { Client } from "https://cdn.jsdelivr.net/npm/colyseus.js@0.16.19/+esm";
import { GAME_CONFIG } from "./configs.js";
import { GAME_SERVER } from "./config.js";
import { mapBoxes, MAP_KINDS, PAINTED, paintedLayout } from "./mapLayout.js";   // same collision rules as the server (movement prediction)

const $ = id => document.getElementById(id);
const serverInput = new URLSearchParams(location.search).get("server");
const defaultEndpoint = location.protocol === "https:" ? `wss://${location.host}` : `ws://${location.hostname || "localhost"}:${GAME_CONFIG.serverPort}`;
const endpoint = serverInput || GAME_SERVER || defaultEndpoint;
const client = new Client(endpoint);
let room = null, myId = "", state = null, keys = {}, lastInput = 0, lastShoot = 0, dashReady = true, selectedClass = loadProfile().characterClass || "assault";
const canvas = $("arena"), ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
// Crash-proof drawing: count save/restore depth so a sprite that throws halfway can't leave the camera offset broken
// (that froze everyone's screen on wave 3), and never let a tiny negative radius throw.
let ctxDepth = 0;
{ const sv = ctx.save.bind(ctx), rs = ctx.restore.bind(ctx), el = ctx.ellipse.bind(ctx), ar = ctx.arc.bind(ctx);
  ctx.save = () => { ctxDepth++; sv(); }; ctx.restore = () => { if (ctxDepth > 0) { ctxDepth--; rs(); } };
  ctx.ellipse = (x, y, rx, ry, ...r) => el(x, y, Math.max(0, rx || 0), Math.max(0, ry || 0), ...r);
  ctx.arc = (x, y, rr, ...r) => ar(x, y, Math.max(0, rr || 0), ...r); }
function unwindTo(d) { while (ctxDepth > d) ctx.restore(); }
function loadProfile(){try{return JSON.parse(localStorage.getItem(GAME_CONFIG.profileStorageKey)||"{}");}catch{return {};}}
let lastProfileSave=0;
function saveProfile(me){if(!me||Date.now()-lastProfileSave<3000)return;lastProfileSave=Date.now();try{localStorage.setItem(GAME_CONFIG.profileStorageKey,JSON.stringify({level:me.level,xp:me.xp,xpNext:me.xpNext,maxHp:me.maxHp,damage:me.damage,fireRate:me.fireRate,speed:me.speed,defence:me.defence,currency:me.currency,characterClass:me.characterClass,weapon:me.weapon,melee:me.melee,highestWave:Math.max(Number(loadProfile().highestWave)||1,state?.stage||1)}));}catch{}}
const upgrades = [ ["damage","Heavy weapon","+20% weapon damage"], ["fireRate","Rapid fire","+20% firing speed"], ["health","Vitality","+20 maximum HP and heal"], ["defence","Body armour","+2 defence"], ["speed","Adrenaline","+10% movement speed"] ];
// ===================== GAME DATA (display only; the server has the final say) =====================
const WEAPON_INFO = {
  pistol:   { name: "Pistol",   slot: 3, mag: 12, reload: 1.0, infinite: true },
  smg:      { name: "SMG",      slot: 3, mag: 30, reload: 1.4, auto: true },
  rifle:    { name: "Rifle",    slot: 2, mag: 30, reload: 1.6, auto: true },
  shotgun:  { name: "Shotgun",  slot: 2, mag: 6,  reload: 2.0 },
  sniper:   { name: "Sniper",   slot: 2, mag: 5,  reload: 2.2 },
  launcher: { name: "Launcher", slot: 2, mag: 3,  reload: 2.6 },
};
const MELEE_INFO = { knife: { name: "Knife", cd: 0.35 }, bat: { name: "Bat", cd: 0.6 }, axe: { name: "Fire axe", cd: 0.9 }, katana: { name: "Katana", cd: 0.5 } };
const SKILLS = {
  assault: { name: "Combat Rush", cd: 25 },
  engineer: { name: "Robot Squad", cd: 25, icon: "robotSquad" }, scout: { name: "Shadow Pass", cd: 25, icon: "shadowPass" }, demolitionist: { name: "Sky Barrage", cd: 8, icon: "skyBarrage" },
  sniper: { name: "Dead Eye", cd: 24 }, juggernaut: { name: "Iron Bastion", cd: 30, icon: "ironBastion" }, operator: { name: "Steel Convoy", cd: 30, icon: "steelConvoy" },
  dispatcher: { name: "Emergency Medics", cd: 30, icon: "medicTeam" },
};
const BUILD_WHEEL = [
  { id: "barricade",  name: "Barricade",        cost: { scrap: 15 } },
  { id: "turret",     name: "Turret",           cost: { scrap: 35, electronics: 8 } },
  { id: "mine",       name: "Mine",             cost: { scrap: 8, explosives: 3 } },
  { id: "fence",      name: "Elec. fence",   cost: { scrap: 25, electronics: 5 } },
  { id: "flameTrap",  name: "Flame trap",       cost: { scrap: 20, fuel: 8 } },
  { id: "repairTower", name: "Repair tower",    cost: { scrap: 10 }, action: true },
  { id: "repairGen",   name: "Repair gen.", cost: { scrap: 15 }, action: true },
  { id: "refuelGen",   name: "Refuel gen.", cost: { fuel: 10 }, action: true },
];
// picture shown in the build wheel for each option
const WHEEL_PIC = { barricade: { obj: "barricade" }, turret: { obj: "turret" }, mine: { obj: "mine" }, fence: { obj: "fence" }, flameTrap: { obj: "flameTrap" },
  repairTower: { obj: "tower" }, repairGen: { obj: "generator" }, refuelGen: { icon: "fuel" } };
// icon for any item id (CSS classes .ic-<id> in index.html; ammo uses the rifle)
const ICON_ID = { heavyTurret: 1, robotSquad: 1, knife: 1, bat: 1, axe: 1, katana: 1, pistol: 1, smg: 1, rifle: 1, shotgun: 1, sniper: 1, launcher: 1, medkit: 1, grenade: 1, armor: 1, scrap: 1, electronics: 1, explosives: 1, fuel: 1, gold: 1, ammo: "rifle" };
const icon = id => { const k = ICON_ID[id] === 1 ? id : ICON_ID[id]; return k ? `<i class="ic ic-${k}" aria-hidden="true"></i>` : ""; };
// same icons as images for drawing on the canvas
const ICON_IMG = {};
for (const [k, url] of Object.entries({ gold: "assets/icons/gold.png", scrap: "assets/icons/scrap.png", electronics: "assets/icons/electronics.png", explosives: "assets/icons/explosives.png", fuel: "assets/icons/fuel.png" })) { const im = new Image(); im.src = url; ICON_IMG[k] = im; }
function drawIcon(k, x, y, size) { const im = ICON_IMG[k]; if (!im?.complete || !im.naturalWidth) return false; ctx.drawImage(im, x - size / 2, y - size / 2, size, size); return true; }
const RES_SHORT = { scrap: "scrap", electronics: "elec", explosives: "expl", fuel: "fuel" };
const SLOT_ORDER = [1, 2, 3, 5];
const WHEEL_R = 210;
const BUILD_RANGE = 160;

// ===================== SCREENS & CONNECTION =====================
function status(text, good = false) { $("connection").textContent = text; $("connection").style.borderColor = good ? "#4d9c68" : "#8a6852"; }
function message(text) { toast(text); }
function showOverlay(title, text) {
  $("shop").classList.add("hidden"); $("overlay").classList.remove("hidden");
  $("overlayTitle").textContent = title; $("overlayText").textContent = text;
  $("nextStage").classList.add("hidden"); $("restartGame").classList.add("hidden");
}
function hideOverlay() { $("overlay").classList.add("hidden"); }
function playerName() { return $("name").value.trim().slice(0, 18) || "Survivor"; }
function joinOptions() { return { name: playerName(), profile: { ...loadProfile(), characterClass: selectedClass } }; }
// The free Render server sleeps when nobody has played for ~15 min and takes up to a minute to wake up:
// keep retrying for ~90s (with a message) before giving up. A wrong room code fails straight away.
async function withWakeUp(label, attempt) {
  const t0 = Date.now();
  for (let i = 0; ; i++) {
    try { return await attempt(); }
    catch (e) {
      const msg = String(e?.message || ""), noRoom = /not found|invalid|locked|full/i.test(msg);
      if (noRoom || Date.now() - t0 > 90000) throw e;
      status(i ? `Waking up the server… ${Math.round((Date.now() - t0) / 1000)}s` : label);
      if (i === 0) message("The game server is waking up (it sleeps when nobody plays). This can take up to a minute — hang on…");
      await new Promise(r => setTimeout(r, 4000));
    }
  }
}
async function createRoom() {
  try { status("Connecting…"); room = await withWakeUp("Connecting…", () => client.create(GAME_CONFIG.roomName, joinOptions())); connected(); }
  catch (e) { status("Connection failed"); message((e.message ? e.message + ". " : "") + "Could not reach the game server. Try again in a minute."); }
}
async function joinRoom() {
  const code = $("roomCode").value.trim();
  if (!code) return message("Enter the invitation code first.");
  try { status("Joining…"); room = await withWakeUp("Joining…", () => client.joinById(code, joinOptions())); connected(); }
  catch (e) { status("Join failed"); message(e.message || "Could not join room. Check the code and server."); }
}
function connected() {
  myId = room.sessionId; status("Connected · " + room.roomId, true);
  toast("Room created. Press INVITE to send your friends the link."); renderLobbyRoom();
  room.onStateChange(s => { state = s; lastStateAt = performance.now(); try { recordSnapshots(); reconcile(); renderState(); audioWatch(); } catch (e) { reportError(e, "ui"); } });
  room.onMessage("shot", m => { if (m.id === myId && PRED.ok) { const me = me_(); if (me) { m.x += PRED.x + PRED.ex - me.x; m.y += PRED.y + PRED.ey - me.y; } } fx.push(m.w === "launcher" ? { ...m, type: "dante", k: "rocket", t: performance.now() } : { type: "shot", t: performance.now(), ...m }); const a = anim.get(m.id); if (a) a.shotAt = performance.now(); if (m.id && m.id[0] !== "p" && !state?.players?.has(m.id)) machineShotAt.set(m.id, performance.now()); shotSound(m); });
  room.onMessage("wreck", m => fx.push({ type: "wreck", t: performance.now(), ...m }));
  room.onMessage("laser", m => fx.push({ type: "laser", t: performance.now(), ...m }));
  room.onMessage("heal", m => { if (m.id && state?.players?.has(m.id)) regenPlay(m.id, m.k === "medkit"); else fx.push({ type: "healfx", t: performance.now(), ...m }); });   // healing effect on whoever was healed
  room.onMessage("summon", m => fx.push({ type: "summon", t: performance.now(), ...m }));
  room.onMessage("sky", m => { const t = performance.now(); skyAnim.set(m.id, { t0: t, a: m.a }); fx.push({ ...m, type: "dante", k: "sky", t }); });
  room.onMessage("demo", m => { const t = performance.now(); if (m.k === "place") danteAnim.set(m.id, { t0: t, a: m.a }); else { scorch(m.x, m.y, 1.4); playSfx("boom", m.x, m.y); DEMO.rings.forEach(rg => setTimeout(() => playSfx("boom", m.x, m.y, .8), (rg.at + DEMO.flight) * 1000)); for (const [x, y, ri, big] of m.pts || []) setTimeout(() => scorch(x, y, big ? .8 : 1, big ? "big" : "small"), (DEMO.rings[ri].at + DEMO.flight) * 1000); fx.push({ ...m, type: "dante", k: "ripple", t }); shake(12, 700); } });
  room.onMessage("shadow", m => { const t = performance.now(); fx.push({ ...m, type: "raven", k: m.k, t }); if (m.k === "dash") ravenDash.set(m.id, { t0: t, a: m.a }); if (m.k === "ignite" && m.id === myId) shake(4, 160); });
  room.onMessage("chop", m => { fx.push({ type: "chop", t: performance.now(), ...m }); const me = me_(); if (me && Math.hypot(me.x - m.x, me.y - m.y) < 420) shake(11, 380); });
  room.onMessage("deflect", m => {
    const now = performance.now(); fx.push({ type: "deflect", t: now, ...m }); hitStopUntil = now + (m.heavy ? 130 : 90); flashUntil = now + 140;
    const me = me_(); if (me && Math.hypot(me.x - m.x, me.y - m.y) < 600) shake(m.heavy ? 14 : 10, 320);
  });
  room.onMessage("clang", m => fx.push({ type: "clang", t: performance.now(), ...m }));
  room.onMessage("roar", m => { shake(12, 700); playSfx("roar", m?.x, m?.y); });
  room.onMessage("hooked", m => { if (m.id === myId) shake(7, 250); });
  room.onMessage("bossDead", m => { bossCorpses.push({ ...m, t: performance.now() }); shake(10, 500); });
  room.onMessage("spit", m => fx.push({ type: "spit", t: performance.now(), ...m }));
  room.onMessage("whip", m => { const me = me_(); if (me && Math.hypot(me.x - m.x, me.y - m.y) < 140) shake(6, 180); });
  room.onMessage("slam", m => { fx.push({ type: "slam", t: performance.now(), ...m }); playSfx("stomp", m.x, m.y); const me = me_(); if (me && Math.hypot(me.x - m.x, me.y - m.y) < m.r * 2.2) shake(9, 320); });
  room.onMessage("hive", m => onHive(m));
  room.onMessage("zdead", m => { if (m.k === "hivemind") { fx.push({ ...m, type: "hive", k: "death", t: performance.now() }); splat(m.x, m.y, 40, true); shake(10, 500); feel.hp.delete(m.id); feel.pos?.delete(m.id); return; } if (feel.pos?.has(m.id)) feel.last.set(m.id, performance.now()); else { const r = 14; splat(m.x, m.y, 10, false); addCorpse({ x: m.x, y: m.y, r, kind: m.k, facing: 1 }); } });
  room.onMessage("briggs", onBriggs); room.onMessage("astra", onAstra);
  room.onMessage("dash", m => { if (m.id !== myId) dashBeam(m.id, m.x0, m.y0, m.x1, m.y1); });   // yours is drawn the moment you dash
  room.onMessage("sofea", m => { const t = performance.now();
    if (m.k === "fire") { sofeaShotAt.set(m.id, t); for (const [ox, oy, bx, by] of m.pts) { fx.push({ type: "sofea", k: "proj", kind: m.kind, ox, oy, bx, by, dur: Math.hypot(bx - ox, by - oy) / m.sp, t }); const a = Math.atan2(by - oy, bx - ox), d = m.kind === "tank" ? SOF.tank.barrel : 26, lift = m.kind === "tank" ? SOF.tank.tur : SOF.heli.alt; fx.push({ type: "sofea", k: "muzzle", kind: m.kind, x: ox + Math.cos(a) * d, y: oy + Math.sin(a) * d - lift, a, t }); } if (m.id === myId) shake(m.kind === "tank" ? 5 : 3, 150); }
    else if (m.k === "slash") { mechaSlash.set(m.id, { t, a: m.a }); const pl = state?.players?.get(m.id); if (pl) playSfx("zap", pl.x, pl.y, .45); }
    else if (m.k === "leave" && m.kind === "mecha") { const pl = state?.players?.get(m.id), v = m.id === myId && pl ? aimAngle(pl) : (pl?.aim || 0); mechaOut.set(m.id, { t, row: rowOf(v) }); mechaSlash.delete(m.id); mechaFlame.delete(m.id); }
    else if (m.k === "board" && m.kind === "mecha") { fx.push({ type: "sofea", k: "dust", x: m.x, y: m.y + 14, s: .6, t }); playSfx("stomp", m.x, m.y); if (m.id === myId) shake(4, 160); }
    else if (m.k === "board" || (m.k === "leave" && m.ok)) fx.push({ type: "sofea", k: "dust", x: m.x, y: m.y + 14, s: m.kind === "tank" ? 1 : .8, t }); });
  room.onMessage("boom", m => { playSfx("boom", m.x, m.y, m.k === "hrocket" ? .75 : 1); if (m.k === "shell" || m.k === "hrocket") { scorch(m.x, m.y, m.k === "shell" ? 1 : .85); fx.push({ ...m, type: "sofea", kind: m.k, k: "boom", t: performance.now() }); shake(m.k === "shell" ? 8 : 6, 240); return; } scorch(m.x, m.y, m.k === "sky" ? 1.1 : .9); fx.push({ ...m, type: "dante", k: "boom", t: performance.now() }); shake(m.k === "sky" ? 9 : 7, 260); });
  room.onMessage("swing", m => { fx.push({ type: "swing", t: performance.now(), ...m }); if (m.fire || m.crit) fx.push({ ...m, type: "raven", k: m.fire ? "fireArc" : "crit", t: performance.now() }); const a = anim.get(m.id); if (a) { a.swingAt = performance.now(); a.heavy = !!m.heavy; } if (m.heavy) shake(m.id === myId ? 8 : 4, 220); });
  room.onLeave(code => {
    status("Disconnected"); room = null; state = null; toast(code === 4000 ? "The host removed you from the room." : "You left the room."); renderLobbyRoom();
    document.body.classList.remove("in-match"); closePanels(); $("gameArea").classList.add("hidden");
  });
  room.onError((code, msg) => message("Room error: " + msg));
}
document.addEventListener("click", e => { const b = e.target.closest?.("button"); if (b) b.blur(); });
$("create").onclick = createRoom; $("join").onclick = joinRoom;
// ---------- Boss intro card ----------
const BOSS_INFO = {
  butcher: { wave: 4, portrait: "assets/portraits/butcher.webp", name: "THE BUTCHER",
    lore: "Hunts survivors, ignores the tower. Huge and very tanky: keep moving and hit him from behind.",
    skills: [
      ["🔪", "Cleaver Quake", 'Smashes the ground. Three shockwaves:<span class="bi-rings"><i style="background:#ff5a4a">RED · damage</i><i style="background:#ffd75e">YELLOW · stun</i><i style="background:#9fc4e8">BLUE · slow</i></span>', "#ff5a4a"],
      ["🪝", "Meat Hook", "Every 10-15s he hooks the furthest survivor and drags them in: 0.5s helpless, then the cleaver. Only a FIRE AXE swing timed into the hook can DEFLECT it and stagger him.", "#ff9a3c"],
      ["🛡️", "Armoured Front", "Takes half damage from the front. Flank him: shots to his back do full damage.", "#9fc4e8"],
      ["💢", "Berserk (below 30%)", "Faster, hooks more often, and spins in a cleaver whirlwind. Get away from him.", "#ff3737"],
    ] },
};
let introAcked = false;
function renderBossIntro() {
  const phase = state.bossPhase, kind = state.bossIntro;
  if (phase !== "intro") introAcked = false;
  const show = phase === "intro" && !introAcked;
  $("bossIntro").classList.toggle("hidden", !show);
  $("bossWaitBanner").classList.toggle("hidden", !(phase === "intro" && introAcked));
  if (phase === "intro") $("bossWaitBanner").textContent = `Waiting for teammates… ${state.introReady || 0}/${state.introNeed || 1} ready`;
  if (!show || $("bossIntro").dataset.kind === kind) { if (show) $("bossIntroWait").textContent = `${state.introReady || 0}/${state.introNeed || 1} survivors ready`; return; }
  $("bossIntro").dataset.kind = kind;
  const info = BOSS_INFO[kind] || { wave: state.stage, name: String(kind).replace(/[A-Z]/g, m => " " + m).toUpperCase(), lore: "A new horror approaches. Nobody has survived it long enough to tell.", skills: [["❓", "Unknown", "Stay together and keep moving.", "#888"]] };
  $("bossIntroWave").textContent = `BOSS · WAVE ${state.stage}`;
  $("bossIntroName").textContent = info.name; $("bossIntroLore").textContent = info.lore;
  $("bossIntroImg").src = info.portrait || ""; $("bossIntroImg").hidden = !info.portrait;
  $("bossIntroSkills").innerHTML = info.skills.map(([ico, name, txt, c]) => `<li style="--c:${c}"><span class="ico" aria-hidden="true">${ico}</span><span><b>${escapeHtml(name)}</b>${txt}</span></li>`).join("");
  $("bossIntroWait").textContent = `${state.introReady || 0}/${state.introNeed || 1} survivors ready`;
  setTimeout(() => $("bossAck").focus(), 50);
}
function ackBoss() { if (!introAcked && state?.bossPhase === "intro") { introAcked = true; room?.send("ackBoss"); renderBossIntro(); } }
$("bossAck").onclick = ackBoss;
$("bossNow").onclick = () => { room?.send("debugBoss"); closePanels(); };
$("bossEnrage").onclick = () => { room?.send("debugBossHp", {}); closePanels(); };
$("hookSpd").onclick = () => room?.send("debugHookSpeed");
$("ultNow").onclick = () => { room?.send("debugUlt"); closePanels(); };
$("bossKill").onclick = () => { room?.send("debugBossHp", { kill: true }); closePanels(); };
$("exploreToggle").onclick = () => room?.send("explore", { on: !state?.explore });
$("skipButcher").onclick = () => { room?.send("debugBoss"); closePanels(); };
$("noCdToggle").onclick = () => room?.send("testNoCd");
function jumpToWave() { const n = Math.round(Number($("waveJumpN").value)); if (n >= 1 && n <= 50) { room?.send("debugWave", { n }); closePanels(); } }
$("waveJumpGo").onclick = jumpToWave;
$("waveJump").addEventListener("click", e => { const b = e.target.closest("[data-spawn]"); if (b) { room?.send("debugSpawn", { kind: b.dataset.spawn }); closePanels(); } });
$("waveJumpN").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); jumpToWave(); } });
$("nextStage").onclick = () => room?.send("nextStage"); $("restartGame").onclick = () => room?.send("restart");
$("resume").onclick = () => closePanels();
$("leave").onclick = () => { closePanels(); room?.leave(); };
$("lvlBadge").onclick = () => togglePanel("levelUp");

// ===================== RENDER (runs on every server update, ~20x a second) =====================
const feed = []; let lastMessage = "";
function inMatch() { return !!(room && state && state.phase !== "lobby"); }
function renderState() {
  if (!state || !room) return;
  const players = [...state.players.values()], me = state.players.get(myId), host = state.hostId === myId;
  saveProfile(me);
  if (me?.characterClass && me.characterClass !== selectedClass) setSelectedClass(me.characterClass, false);
  renderLobbyRoom();
  $("exploreToggle").classList.toggle("hidden", !host || state.phase !== "playing");
  $("waveJump").classList.toggle("hidden", !(SOLO_PREVIEW || state.hostId === myId) || state.phase === "lobby");   // the host can skip to any wave
  for (const el of $("waveJump").querySelectorAll(".spawn-row")) el.classList.toggle("hidden", !SOLO_PREVIEW);   // spawn / boss test buttons: preview only
  $("skipButcher").classList.toggle("hidden", SOLO_PREVIEW || !host || !["playing", "cleared"].includes(state.phase));
  $("noCdToggle").classList.toggle("hidden", !host || state.phase === "lobby"); $("noCdToggle").textContent = `Test: ultimates with no cooldown: ${state.noCd ? "ON" : "OFF"}`;
  if (SOLO_PREVIEW) $("hookSpd").textContent = (state.hookSpeed || 2100) >= 2100 ? "Hook speed: FAST (real)" : "Hook speed: SLOW (practice)";
  $("exploreToggle").textContent = state.explore ? "Explore mode: ON · click to start the waves" : "Explore mode: OFF · click to stop the waves";
  // switch between lobby page and full-screen game
  const playingNow = state.phase !== "lobby";
  document.body.classList.toggle("in-match", playingNow);
  $("gameArea").classList.toggle("hidden", !playingNow);
  if (!playingNow) { closePanels(); return; }
  renderHud(me, players);
  renderScoreboard(players);
  renderLevelUp(me);
  if (!$("equip").classList.contains("hidden")) renderEquip(me);
  // event feed from server messages
  if (state.message && state.message !== lastMessage) { lastMessage = state.message; feed.unshift({ text: state.message, t: Date.now() }); feed.length = Math.min(feed.length, 5); }
  $("feed").innerHTML = feed.filter(f => Date.now() - f.t < 7000).map(f => `<li style="opacity:${Date.now() - f.t > 5500 ? .35 : 1}">${escapeHtml(f.text)}</li>`).join("");
  // big screens: wave cleared + shop, downed, win/loss
  if (state.phase === "cleared") {
    showOverlay("WAVE " + state.stage + " CLEARED!", "Spend your gold before the next wave. Build and repair with right-click once it starts.");
    $("nextStage").textContent = "START NOW"; $("nextStage").classList.toggle("hidden", !host); renderShop(me);
  } else if (state.phase === "victory") {
    showOverlay("CAMPAIGN COMPLETE!", "You survived all 50 waves and defeated the final boss. Victory!" + (host ? "" : " Waiting for the host to start a new match."));
    $("restartGame").classList.toggle("hidden", !host);
  } else if (state.phase === "defeat") {
    showOverlay("TEAM DEFEATED", "The radio tower was destroyed or the entire team was downed." + (host ? "" : " Waiting for the host to start a new match."));
    $("restartGame").classList.toggle("hidden", !host);
  } else hideOverlay();
  // downed / bled out: no dark screen, the camera follows a teammate instead (spectate bar at the bottom)
  const watching = me && !me.alive && state.phase === "playing", tgt = watching ? viewTarget() : null;
  $("spectate").classList.toggle("hidden", !watching);
  if (watching) {
    $("specTitle").textContent = me.bledOut ? "YOU BLED OUT · back next wave" : `YOU ARE DOWN · bleed-out in ${Math.ceil(me.bleedout || 0)}s · a teammate can press F next to you`;
    $("specWho").textContent = tgt && tgt !== me ? `Watching ${tgt.isBot ? "🤖 " : ""}${tgt.name}` : "Nobody left standing";
    $("specHint").classList.toggle("hidden", aliveMates().length < 2);
  }
}

const pct = (v, max) => Math.max(0, Math.min(100, (v / (max || 1)) * 100)) + "%";
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
function renderHud(me, players) {
  // top left: wave, timer, zombies, day/night
  $("hudWave").textContent = state.stage;
  const hiveUp = [...state.zombies.values()].some(z => z.kind === "hivemind");
  $("hudTimer").textContent = state.explore ? "EXPLORE MODE" : state.waveType !== "boss" ? ((state.elapsed || 0) >= 90 && hiveUp ? "KILL THE HIVEMIND" : fmtTime(90 - (state.elapsed || 0)))
    : state.bossPhase === "horde" ? (state.elapsed < 45 ? "BOSS WAVE · horde " + fmtTime(45 - (state.elapsed || 0)) : "BOSS WAVE · clear the horde")
    : state.bossPhase === "intro" ? "THE BOSS IS COMING" : "BOSS FIGHT";
  renderBossIntro();
  $("hudZombies").textContent = state.zombies.size + (state.zombies.size === 1 ? " zombie" : " zombies");
  $("hudClock").textContent = state.isNight ? "NIGHT" : "DAY";
  // top centre: tower, generator, boss
  $("towerText").textContent = Math.ceil(state.towerHp || 0).toLocaleString() + " / " + (state.towerMaxHp || 10000).toLocaleString();
  $("towerBar").style.width = pct(state.towerHp, state.towerMaxHp);
  $("towerBar").style.background = (state.towerHp || 0) < (state.towerMaxHp || 10000) * 0.25 ? "#e45b4d" : "#58ce8b";
  $("genText").textContent = Math.ceil(state.generatorFuel || 0) + "% fuel · " + Math.ceil(state.generatorHp || 0) + " HP";
  $("genBar").style.width = pct(state.generatorHp, state.generatorMaxHp);
  const boss = [...state.zombies.values()].find(z => z.boss) || [...state.zombies.values()].find(z => z.kind === "hivemind");
  $("bossBox").classList.toggle("hidden", !boss);
  if (boss) {
    $("bossName").textContent = (boss.kind === "hivemind" ? "THE HIVEMIND · MINI BOSS" : BOSS_INFO[boss.kind]?.name || String(boss.kind).replace(/[A-Z]/g, m => " " + m).toUpperCase()) + (boss.enraged ? " · ENRAGED" : "");
    $("bossText").textContent = Math.ceil(boss.hp).toLocaleString(); $("bossBar").style.width = pct(boss.hp, boss.maxHp);
  }
  // top right: team list under the minimap
  $("team").innerHTML = players.map(p => `<div class="team-row"><i style="background:${p.color}"></i><span>${p.isBot ? "🤖 " : ""}${escapeHtml(p.name)}${p.sessionId === myId ? " (you)" : ""}</span>${p.alive ? `<span>${Math.ceil(p.hp)}</span>` : `<em>${p.bledOut ? "OUT" : "DOWN " + Math.ceil(p.bleedout || 0) + "s"}</em>`}<div class="hbar"><span style="width:${pct(p.alive ? p.hp : 0, p.maxHp)}"></span></div></div>`).join("");
  // bottom right: team resources
  $("resources").innerHTML = ["scrap", "electronics", "explosives", "fuel"].map(r => `<span title="${r}">${icon(r)}<b>${Math.floor(state[r] || 0)}</b></span>`).join("");
  if (!me) return;
  // bottom left: you
  $("hpText").textContent = Math.ceil(me.hp) + " / " + me.maxHp; $("hpBar").style.width = pct(me.hp, me.maxHp);
  $("hudLevel").textContent = "LV " + me.level; $("xpText").textContent = me.xp + " / " + me.xpNext + " XP"; $("xpBar").style.width = pct(me.xp, me.xpNext);
  $("hudGold").innerHTML = icon("gold") + (me.currency || 0) + "g"; $("hudDef").textContent = "DEF " + (me.defence || 0); $("hudClass").textContent = String(me.characterClass).toUpperCase();
  const pc = "hud-portrait p-" + me.characterClass; if ($("hudPortrait").className !== pc) $("hudPortrait").className = pc;
  // bottom centre: hotbar
  renderHotbar(me);
}

let hotbarHtml = "";
function renderHotbar(me) {
  const w = WEAPON_INFO[me.weapon], gunActive = me.activeSlot === 2 || me.activeSlot === 3;
  const gunSub = id => { const info = WEAPON_INFO[id]; if (!info) return ""; if (me.weapon === id && gunActive) return `${me.mag}/${info.infinite ? "∞" : me.ammo}`; return info.infinite ? "∞" : me.ammo + " spare"; };
  const skill = SKILLS[me.characterClass] || SKILLS.assault, eng = me.characterClass === "engineer", rav = me.characterClass === "scout", dan = me.characterClass === "demolitionist", jug = me.characterClass === "juggernaut", op = me.characterClass === "operator", ast = me.characterClass === "dispatcher", myV = op ? state.vehicles?.get(myId) : null, ch = me.robotCharges ?? 3;
  const kk = me.katanaKills || 0, tier = Math.min(5, Math.floor(kk / 50));
  const cd = eng ? Math.ceil(ch < 1 ? me.chargeCd || 0 : me.abilityCooldown || 0) : Math.ceil(me.abilityCooldown || 0);
  const reloadPct = me.reloadLeft > 0 && w ? (1 - me.reloadLeft / w.reload) * 100 : 0;
  const slots = [
    { n: 1, name: (MELEE_INFO[me.melee] || MELEE_INFO.knife).name, sub: rav && me.melee === "katana" ? (tier >= 5 ? "T5 MAX" : `T${tier} · ${kk % 50}/50`) : "melee", ic: icon(me.melee || "knife") },
    { n: 2, name: WEAPON_INFO[me.primary]?.name || "—", sub: gunSub(me.primary), ic: icon(me.primary) },
    { n: 3, name: WEAPON_INFO[me.secondary]?.name || "—", sub: gunSub(me.secondary), ic: icon(me.secondary) },
    { n: 5, key: "4", name: "Medkit", sub: "×" + (me.medkits || 0), empty: !me.medkits, ic: icon("medkit") },
    { n: 6, key: "E", card: eng ? "robotSquad" : rav ? "shadowPass" : dan ? "skyBarrage" : op ? "steelConvoy" : jug ? "ironBastion" : ast ? "medicTeam" : "", name: skill.name, sub: ast ? (me.skillT > 0 ? `MEDICS ${Math.ceil(me.skillT)}s` : me.abilityCooldown > 0 ? "cooldown" : "READY") : jug ? (me.skillT > 0 ? `DOME ${Math.ceil(me.skillT)}s` : me.abilityCooldown > 0 ? "cooldown" : "READY") : op ? (myV?.kind === "tank" ? (myV.phase === "call" ? "CALLING…" : `TANK ${Math.ceil(myV.left)}s`) : myV ? (myV.kind === "mecha" ? "in mecha" : "in helicopter") : me.abilityCooldown > 0 ? "cooldown" : "READY") : dan ? (me.abilityCooldown > 0 ? "cooldown" : "READY") : rav ? (me.shadow > 0 ? `HIDDEN ${Math.ceil(me.shadow)}s` : me.fire > 0 ? `FIRE ${Math.ceil(me.fire)}s` : me.abilityCooldown > 0 ? "cooldown" : "READY") : eng ? `${"●".repeat(ch)}${"○".repeat(Math.max(0, 3 - ch))}${ch < 3 ? " " + Math.ceil(me.chargeCd || 0) + "s" : ""}` : "skill", cd, ic: skill.icon ? icon(skill.icon) : `<i class="ic portrait p-${me.characterClass}" aria-hidden="true"></i>` },
    ULT[me.characterClass] ? { n: 7, key: "Q", card: ULT[me.characterClass].icon, name: ULT[me.characterClass].name, ic: icon(ULT[me.characterClass].icon),
        sub: (me.ultKills || 0) < 100 ? `${me.ultKills || 0}/100 kills` : me.ultReady ? "READY" : me.ultActive > 0 ? (dan ? "PRESS Q: BOOM" : op ? (myV?.phase === "call" ? "CALLING…" : `HELI ${Math.ceil(me.ultActive)}s`) : jug ? `RAGE ${Math.ceil(me.ultActive)}s` : ast ? `POLICE ${Math.ceil(me.ultActive)}s` : `ON ${Math.ceil(me.ultActive)}s`) : "ultimate", empty: (me.ultKills || 0) < 100, cd: (me.ultKills || 0) >= 100 && !me.ultReady ? Math.ceil(me.ultCd || 0) : 0, ready: me.ultReady }
      : { n: 7, key: "Q", name: "Ultimate", sub: "coming soon", empty: true, ic: `<i class="ic portrait p-${me.characterClass}" aria-hidden="true"></i>` },
  ];
  slots.unshift(slots.pop(), slots.pop());   // Q and E sit on the left, before 1 (knife)
  // cooldown clock: how much of the wait is left (1 = just used, 0 = ready)
  const eS = slots[1], qS = slots[0];
  if (eng) eS.frac = ch < 1 ? (me.chargeCd || 0) / 25 : (me.abilityCooldown || 0) / 3;
  if (dan) eS.frac = (me.abilityCooldown || 0) / 8;
  if (jug) { eS.active = me.skillT > 0 ? me.skillT / 15 : 0; eS.frac = eS.active ? 0 : (me.abilityCooldown || 0) / 30; if (eS.active) eS.cd = 0; }
  if (ast) { eS.active = me.skillT > 0 ? me.skillT / 20 : 0; eS.frac = eS.active ? 0 : (me.abilityCooldown || 0) / 30; if (eS.active) eS.cd = 0; }
  if (op) { eS.active = myV?.kind === "tank" ? (myV.phase === "call" ? 1 : myV.left / 30) : 0; eS.frac = eS.active ? 0 : (me.abilityCooldown || 0) / 30; if (eS.active) eS.cd = 0; }
  if (rav) { eS.active = me.shadow > 0 ? me.shadow / 20 : me.fire > 0 ? me.fire / 5 : 0; eS.frac = eS.active ? 0 : (me.abilityCooldown || 0) / 25; if (eS.active) eS.cd = 0; }
  const UL = ULT[me.characterClass] || {};
  if (qS.card) { qS.locked = (me.ultKills || 0) < 100; qS.active = me.ultActive > 0 ? me.ultActive / (UL.life || 40) : 0; qS.frac = !qS.locked && !me.ultReady && !qS.active ? Math.min(1, (me.ultCd || 0) / (UL.cd || 60)) : 0; if (qS.active) qS.cd = 0; }
  if (ast) {   // R: Safehouse, beside E
    const sh = [...(state.structures?.values() || [])].find(st => st.kind === "safehouse" && st.ownerId === myId), rc = me.chargeCd || 0;
    slots.splice(2, 0, { n: 9, key: "R", card: "safehouse", name: "Safehouse: 2 workers build 4 walls around you in 5s (you can't be hurt while they build); zombies can't get in (6 hits break it, the workers repair) for 45s", sub: sh ? (sh.deploy > 0 ? "BUILDING…" : `${Math.ceil(sh.hp)}/${sh.maxHp} · ${Math.ceil(sh.life)}s`) : rc > 0 ? "cooldown" : "READY", active: sh ? (sh.deploy > 0 ? 1 : sh.hp / 45) : 0, frac: !sh && rc > 0 ? rc / 90 : 0, cd: !sh && rc > 0 ? Math.ceil(rc) : 0 });
  }
  if (op) {   // R: Crimson Aegis mecha, beside E
    const mv = myV?.kind === "mecha" ? myV : null, rc = me.chargeCd || 0;
    slots.splice(2, 0, { n: 9, key: "R", card: "crimsonAegis", name: "Crimson Aegis: pilot a mecha for 30s. Hold click = flame jet, right click = lightsaber, R = step out. 100s cooldown", sub: mv ? (mv.phase === "call" ? "TRANSFORMING…" : `MECHA ${Math.ceil(mv.left)}s · R out`) : rc > 0 ? "cooldown" : "READY", active: mv ? (mv.phase === "call" ? 1 : mv.left / 30) : 0, frac: !mv && rc > 0 ? rc / 100 : 0, cd: !mv && rc > 0 ? Math.ceil(rc) : 0 });
  }
  if (jug) slots.splice(2, 0, { n: 8, key: "PASSIVE", card: "forcefulBlast", name: "Forceful Blast: shotgun hits knock zombies back (bosses too)", sub: "ON" });   // beside E
  const LOCK = `<svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="2.6"/><rect x="4.5" y="10" width="15" height="11" rx="2" fill="currentColor"/><rect x="11" y="13.5" width="2" height="4" rx="1" fill="#000"/></svg>`;
  const hb = slots.map(s => s.card ? `<div class="slot skillcard card-${s.card}${s.empty ? " empty" : ""}${s.ready ? " ult-ready" : ""}" title="${escapeHtml(s.name)}"><small>${s.key} · ${s.sub}</small>${s.locked ? `<div class="locked">${LOCK}</div>` : s.active ? `<div class="live" style="--p:${s.active.toFixed(2)}"></div>` : s.frac > 0 ? `<div class="clock" style="--p:${s.frac.toFixed(2)}"><span>${s.cd || ""}</span></div>` : ""}</div>` : `<div class="slot${s.n === me.activeSlot ? " active" : ""}${s.empty ? " empty" : ""}${s.ready ? " ult-ready" : ""}" title="${escapeHtml(s.name)}">${s.ic}<kbd>${s.key || s.n}</kbd><b>${escapeHtml(s.name)}</b><small>${s.sub}</small>${s.cd ? `<div class="cd">${s.cd}</div>` : ""}${s.n === me.activeSlot && reloadPct ? `<div class="reload" style="width:${reloadPct}%"></div>` : ""}</div>`).join("");
  if (hb !== hotbarHtml) { $("hotbar").innerHTML = hb; hotbarHtml = hb; }
  const dashLeft = Math.max(0, dashReadyAt - performance.now()) / 1000;
  $("dashChip").textContent = dashLeft > 0 ? `DASH ${dashLeft.toFixed(1)}s` : "DASH READY · Space"; $("dashChip").classList.toggle("ready", dashLeft <= 0);
  $("ammoLine").textContent = me.stunned > 0 ? `STUNNED! ${me.stunned.toFixed(1)}s` : me.slowed > 0 ? `SLOWED ${me.slowed.toFixed(1)}s` : jug && me.weapon === "shotgun" && me.ultActive > 0 && gunActive ? "RAGE: SHOTGUN SPAM · NO AMMO · hold click" : me.reloadLeft > 0 ? "RELOADING…" : gunActive && w ? `${me.mag} / ${w.infinite ? "∞" : me.ammo}${me.mag === 0 ? (ast ? "  ·  press C" : "  ·  press R") : ""}` : me.activeSlot === 5 ? "Click to use a medkit" : me.activeSlot === 1 && me.melee === "axe" ? "Hold click 1s, release: HEAVY SWING" : "";
}

function renderScoreboard(players) {
  const ranked = players.slice().sort((a, b) => b.kills - a.kills || (a.killLeadSince || Number.MAX_SAFE_INTEGER) - (b.killLeadSince || Number.MAX_SAFE_INTEGER) || String(a.name).localeCompare(String(b.name)));
  const rows = ranked.map((p, i) => `<tr class="${i === 0 && p.kills > 0 ? "leader" : ""}"><td>${i === 0 && p.kills > 0 ? "👑 " : ""}${i + 1}. ${escapeHtml(p.name)}${p.sessionId === myId ? " (YOU)" : ""}</td><td>${p.kills}</td><td>${Math.round(p.bossDamage || 0)}</td><td>${p.revives || 0}</td><td>${Math.round(p.towerRepairs || 0)}</td><td>${p.structuresBuilt || 0}</td><td>${Math.round(p.damageDealt || 0)}</td><td>${Math.round(p.damageTaken || 0)}</td></tr>`).join("");
  const done = ["cleared", "victory", "defeat"].includes(state.phase);
  const awardKeys = [["Zombie Slayer", "kills"], ["Boss Hunter", "bossDamage"], ["Lifesaver", "revives"], ["Guardian", "towerRepairs"], ["Master Engineer", "structuresBuilt"]];
  const awards = awardKeys.map(([label, key]) => { const w = players.slice().sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0))[0]; return w && Number(w[key]) > 0 ? `${label}: ${escapeHtml(w.name)}` : ""; }).filter(Boolean);
  $("scoreboard").innerHTML = `<h3>${done ? "MATCH RESULTS" : "LIVE KILL LEADERBOARD"}</h3><table><thead><tr><th>Survivor</th><th>Kills</th><th>Boss dmg</th><th>Revives</th><th>Tower repair</th><th>Builds</th><th>Damage dealt</th><th>Damage taken</th></tr></thead><tbody>${rows}</tbody></table>${done && awards.length ? `<div class="scorehint">${awards.join(" · ")}</div>` : ""}<div class="scorehint">Team kills: ${state.totalKills || 0} · Press TAB to toggle</div>`;
  $("scoreboard").classList.toggle("hidden", !scoreboardOpen || state.phase === "cleared");
}

// ===================== SHOP (break between waves) =====================
// [id, name, what it does, price] — prices must match SHOP on the server
const SHOP_ITEMS = [
  ["Weapons", [["smg", "SMG", "Fast full-auto spray", 35], ["shotgun", "Shotgun", "5 pellets, close range", 40], ["sniper", "Sniper rifle", "Huge damage, pierces 3", 70], ["launcher", "Launcher", "Explosive splash", 120]]],
  ["Gear", [["medkit", "Medkit", "Heals 60% · slot 5", 10], ["ammo", "Ammo +90", "Spare bullets", 5], ["armor", "Armour", "+2 defence", 30]]],
  ["Team supplies", [["scrap", "Scrap +40", "Build & repair", 15], ["electronics", "Electronics +8", "Turrets & fences", 20], ["fuel", "Fuel +30", "Generator & flame traps", 10], ["explosives", "Explosives +5", "Mines", 15]]],
];
let shopKey = "", shopGold = null, shopBought = "";
function renderShop(me) {
  const box = $("shop"); if (!me) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  const secs = Math.ceil(state.countdown || 0);
  const owned = (me.owned || "").split(","), gold = me.currency || 0;
  const key = [gold, me.owned, me.armor, me.medkits, state.scrap, state.electronics, state.fuel, state.explosives].join("|");
  if (key === shopKey && box.childElementCount) { const t = $("shopSecs"); if (t) t.textContent = secs; return; }
  shopKey = key;
  const goldChanged = shopGold !== null && gold !== shopGold; shopGold = gold;
  const have = { medkit: `${me.medkits || 0}/3`, armor: `${me.armor || 0}/5`, scrap: Math.floor(state.scrap || 0), electronics: Math.floor(state.electronics || 0), fuel: Math.floor(state.fuel || 0), explosives: Math.floor(state.explosives || 0) };
  const card = ([id, name, desc, price], group) => {
    const isOwned = group === "Weapons" && owned.includes(id), maxed = (id === "armor" && (me.armor || 0) >= 5) || (id === "medkit" && (me.medkits || 0) >= 3);
    const short = !isOwned && !maxed && gold < price, cls = isOwned ? "owned" : maxed ? "maxed" : short ? "short" : "ok";
    const tag = isOwned ? `<span class="tag done">OWNED ✓</span>` : maxed ? `<span class="tag done">MAX</span>` : `<span class="tag">${icon("gold")}${price}</span>`;
    const extra = short ? `<span class="need">need ${price - gold} more</span>` : have[id] !== undefined ? `<span class="have">${group === "Team supplies" ? "team has " : "you have "}${have[id]}</span>` : `<span class="have">&nbsp;</span>`;
    return `<button class="shop-card ${cls}${shopBought === id ? " bought" : ""}" data-buy="${id}" ${isOwned || maxed || short ? "disabled" : ""}>${icon(id)}<b>${name}</b><small>${desc}</small>${tag}${extra}</button>`;
  };
  shopBought = "";
  box.innerHTML = `<div class="shop-top"><div class="wallet${goldChanged ? " bump" : ""}">${icon("gold")}<div><small>YOUR GOLD</small><b>${gold}</b></div></div>
    <div class="shop-timer"><b id="shopSecs">${secs}</b><small>seconds until<br>wave ${state.stage + 1}</small></div></div>` +
    SHOP_ITEMS.map(([group, items]) => `<div class="shop-group"><span>${group.toUpperCase()}</span><div class="shop-items">${items.map(it => card(it, group)).join("")}</div></div>`).join("");
}
$("shop").addEventListener("click", e => { const b = e.target.closest("button[data-buy]"); if (b && !b.disabled) { shopBought = b.dataset.buy; room?.send("buy", { id: b.dataset.buy }); } });

// ===================== PANELS: level-up (U), equipment (E), menu (Esc) =====================
const PANELS = ["levelUp", "equip", "menu"];
function closePanels() { PANELS.forEach(id => $(id).classList.add("hidden")); }
function togglePanel(id) {
  const opening = $(id).classList.contains("hidden");
  closePanels();
  if (!opening) return;
  if (id === "levelUp") { const me = state?.players.get(myId); if (!me || me.xp < me.xpNext) return; levelUpBuiltFor = ""; }
  $(id).classList.remove("hidden"); firing = false;
  if (id === "equip") { equipKey = ""; renderEquip(state?.players.get(myId)); }
  if (id === "levelUp") renderLevelUp(state?.players.get(myId));
}
function anyPanelOpen() { return PANELS.some(id => !$(id).classList.contains("hidden")); }

let levelUpBuiltFor = "", levelUpWaitUntil = 0;
function pendingLevelUps(me) { let n = 0, xp = me.xp, next = me.xpNext; while (xp >= next && n < 9) { xp -= next; next = Math.floor(next * 1.35 + 8); n++; } return n; }
function renderLevelUp(me) {
  const ready = !!(me && state.phase === "playing" && me.xp >= me.xpNext);
  const n = ready ? pendingLevelUps(me) : 0;
  $("lvlBadge").classList.toggle("hidden", !ready);
  $("lvlBadge").textContent = `▲ LEVEL UP${n > 1 ? " ×" + n : ""} · press U`;
  if (!ready) { $("levelUp").classList.add("hidden"); levelUpBuiltFor = ""; return; }
  if ($("levelUp").classList.contains("hidden")) return;
  $("levelUpCount").textContent = n > 1 ? n + " upgrades ready" : "1 upgrade ready";
  $("levelUpHint").textContent = me.alive ? "Press 1–5 or click. U or Esc to close. The fight keeps going." : "You're down. Pick once a teammate revives you.";
  const key = me.level + "|" + me.alive;
  if (key !== levelUpBuiltFor) {
    levelUpBuiltFor = key; levelUpWaitUntil = 0;
    $("levelUpChoices").innerHTML = upgrades.map(([id, title, desc], i) => `<button class="button" data-upgrade="${id}"><kbd>${i + 1}</kbd><span><b>${title}</b><small>${desc}</small></span></button>`).join("");
  }
  const locked = !me.alive || Date.now() < levelUpWaitUntil;
  $("levelUpChoices").querySelectorAll("button").forEach(b => b.disabled = locked);
}
function pickUpgrade(id) {
  const me = state?.players.get(myId);
  if (!room || !me || !me.alive || me.xp < me.xpNext || Date.now() < levelUpWaitUntil) return;
  levelUpWaitUntil = Date.now() + 700; room.send("upgrade", { id });
}
$("levelUpChoices").addEventListener("click", e => { const b = e.target.closest("button[data-upgrade]"); if (b) pickUpgrade(b.dataset.upgrade); });

let equipKey = "";
function renderEquip(me) {
  if (!me) return;
  const key = [me.owned, me.primary, me.secondary, me.melee, me.medkits, me.armor, me.activeSlot, me.characterClass].join("|");
  if (key === equipKey) return; equipKey = key;
  const skill = SKILLS[me.characterClass] || SKILLS.assault;
  const row = (k, label, name, sub, ic = "") => `<div class="eq-row"><kbd>${k}</kbd>${ic || "<span></span>"}<div><small>${label}</small><b>${escapeHtml(name)}</b>${sub ? `<small>${sub}</small>` : ""}</div></div>`;
  $("equipped").innerHTML =
    row(1, "MELEE", MELEE_INFO[me.melee]?.name || "Knife", "", icon(me.melee || "knife")) +
    row(2, "PRIMARY", WEAPON_INFO[me.primary]?.name || "—", "", icon(me.primary)) +
    row(3, "SECONDARY", WEAPON_INFO[me.secondary]?.name || "—", "", icon(me.secondary)) +
    row(4, "SKILL", skill.name, skill.cd + "s cooldown", `<i class="ic portrait p-${me.characterClass}" aria-hidden="true"></i>`) +
    row(5, "QUICK ITEM", "Medkit ×" + (me.medkits || 0), "heals 60%", icon("medkit")) +
    row("🛡", "ARMOUR", (me.armor || 0) + " plate" + (me.armor === 1 ? "" : "s"), "defence " + (me.defence || 0), icon("armor"));
  // backpack: everything you own but don't have equipped right now
  const owned = (me.owned || "").split(",").filter(Boolean);
  const items = [
    ...owned.filter(id => id !== me.primary && id !== me.secondary && WEAPON_INFO[id]).map(id => ({ kind: "weapon", id, name: WEAPON_INFO[id].name, sub: WEAPON_INFO[id].slot === 2 ? "primary" : "secondary" })),
    ...Object.keys(MELEE_INFO).filter(id => id !== me.melee).map(id => ({ kind: "melee", id, name: MELEE_INFO[id].name, sub: "melee" })),
  ];
  const cells = [];
  for (let i = 0; i < 20; i++) {
    const it = items[i];
    cells.push(it ? `<button class="bag-slot" data-kind="${it.kind}" data-id="${it.id}" title="${escapeHtml(it.name)}: double-click to equip">${icon(it.id)}${escapeHtml(it.name)}<small>${it.sub}</small></button>` : `<div class="bag-slot" aria-hidden="true"></div>`);
  }
  $("bag").innerHTML = cells.join(""); $("bagCount").textContent = items.length + " / 20";
}
// Backpack: click = select (shows what it is), double-click = equip it and put it in your hand.
const bagName = b => b.textContent.replace(/(primary|secondary|melee)$/, "");
$("bag").addEventListener("click", e => {
  const b = e.target.closest("button.bag-slot"); if (!b) return;
  $("bag").querySelectorAll(".bag-slot.sel").forEach(x => x.classList.remove("sel")); b.classList.add("sel");
  $("bagInfo").textContent = bagName(b) + " · double-click to equip.";
});
$("bag").addEventListener("dblclick", e => {
  const b = e.target.closest("button.bag-slot"); if (!b || !room) return;
  if (b.dataset.kind === "weapon") room.send("weapon", { id: b.dataset.id }); else room.send("meleeEquip", { id: b.dataset.id });
  $("bagInfo").textContent = "Equipped " + bagName(b) + ".";
});

// ===================== INPUT =====================
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function aimAngle(me) { const v = V(me); return Math.atan2(mouse.y - v.y, mouse.x - v.x); }
function aimDist(me) { const v = V(me); return Math.round(Math.hypot(mouse.y - v.y, mouse.x - v.x)); }   // rockets fly to the mouse
let mouse = { x: W / 2, y: H / 2, sx: W / 2, sy: H / 2 };
const fx = [];
let audioContext = null, sfxOn = true, musicOn = true, sfxBus = null, musicBus = null;
// ===================== SOUND =====================
// Sound effects + music (Web Audio). Files: assets/audio (the user's ChatGPT audio pack; originals in tools/art/audio).
// The browser only allows sound after the first click/key, so the context starts then. Each sound has a voice limit (max
// playing at once) and a minimum gap, so 8 players + police shooting doesn't become a wall of noise; positional sounds
// fade out with distance from you (gone at 900px).
const SFX = {
  turret:   { url: "assets/sfx/turret-shoot.mp3", vol: .45, max: 3 },
  rifle:    { url: "assets/audio/rifle_shot.mp3", vol: .3, max: 5, gap: 35 },
  gatling:  { url: "assets/audio/heli_gatling.mp3", vol: .25 },
  fire:     { url: "assets/audio/fire_loop.mp3", vol: .32 },   // Vefects fire loop: crackling near the fires on painted maps (fireAmbience)
  // hero voice lines (VOICE below says which skill plays which)
  vAstraQ:  { url: "assets/audio/voice_astra_q.mp3", vol: .85, max: 2 },
  vAstraE:  { url: "assets/audio/voice_astra_e.mp3", vol: .85, max: 2 },   // Sofea's helicopter gun: looped while she holds fire (heliLoop)
  pistol:   { url: "assets/audio/pistol_shot.mp3", vol: .32, max: 4, gap: 40 },
  shotgun:  { url: "assets/audio/shotgun_blast.mp3", vol: .4, max: 3, gap: 60 },
  boom:     { url: "assets/audio/explosion.mp3", vol: .5, max: 4, gap: 60 },
  zhit:     { url: "assets/audio/zombie_hit.mp3", vol: .2, max: 3, gap: 70 },
  groan:    { url: "assets/audio/zombie_groan.mp3", vol: .16, max: 1 },
  roar:     { url: "assets/audio/brute_roar.mp3", vol: .5, max: 1, gap: 1500 },
  stomp:    { url: "assets/audio/heavy_footstep.mp3", vol: .65, max: 2, gap: 150 },
  zap:      { url: "assets/audio/electric_aoe.mp3", vol: .55, max: 2 },
  build:    { url: "assets/audio/wall_construction.mp3", vol: .5, max: 2, gap: 300 },
  repair:   { url: "assets/audio/tower_repair.mp3", vol: .55, max: 1, gap: 400 },
  alarm:    { url: "assets/audio/tower_low_health_alarm.mp3", vol: .45, max: 1 },
  revive:   { url: "assets/audio/revive_success.mp3", vol: .55, max: 2 },
  pickup:   { url: "assets/audio/pickup.mp3", vol: .4, max: 2, gap: 60 },
  wave:     { url: "assets/audio/wave_start.mp3", vol: .6, max: 1 },
  thunder:  { url: "assets/audio/thunder.mp3", vol: .55, max: 1 },
  victory:  { url: "assets/audio/victory.mp3", vol: .6, max: 1 },
  gameover: { url: "assets/audio/game_over.mp3", vol: .65, max: 1 },
  select:   { url: "assets/audio/ui_select.mp3", vol: .35, max: 2, gap: 60 },
  pause:    { url: "assets/audio/ui_pause.mp3", vol: .5, max: 1 },
};
// Voice lines: class -> skill key -> SFX name. Played when the skill starts (your own at full volume, others by distance).
const VOICE = { dispatcher: { Q: "vAstraQ", E: "vAstraE" } };
function playVoice(id, key) { const p = state?.players?.get(id), name = p && VOICE[p.characterClass]?.[key]; if (!name) return; const v = V(p); playSfx(name, id === myId ? undefined : v.x, id === myId ? undefined : v.y); }
// Music loops (empty in the solo preview: it has to stay under 16 MB). Crossfade 1s between scenes.
const MUSIC = { menu: "assets/audio/music_main_menu.mp3", day: "assets/audio/music_day_exploration.mp3", night: "assets/audio/music_night_wave.mp3", boss: "assets/audio/music_boss_battle.mp3" };
const MUSIC_VOL = .28, MUSIC_FADE = 1;
function sfxContext() {
  if (!audioContext) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; audioContext = new AC();
    sfxBus = audioContext.createGain(); sfxBus.gain.value = sfxOn ? 1 : 0; sfxBus.connect(audioContext.destination);
    musicBus = audioContext.createGain(); musicBus.gain.value = musicOn ? 1 : 0; musicBus.connect(audioContext.destination);
  }
  if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  warmAudio(); return audioContext;
}
function warmAudio() { if (audioContext) for (const s of [...Object.values(SFX), ...Object.values(musicTracks)]) decoded(s, audioContext); }   // decode everything early so no sound is silent the first time
function loadRaw(s) {
  if (!s.url) return;
  if (s.url.startsWith("data:")) { try { const bin = atob(s.url.split(",")[1]), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); s.raw = u.buffer; } catch {} }   // preview: inlined
  else fetch(s.url).then(r => r.arrayBuffer()).then(b => { s.raw = b; warmAudio(); }).catch(() => {});
}
function decoded(s, ac) {   // the AudioBuffer once ready (decoding starts on first use)
  if (s.buf) return s.buf;
  if (s.raw && !s.decoding) { s.decoding = true; ac.decodeAudioData(s.raw.slice(0)).then(b => { s.buf = b; }).catch(() => {}); }
  return null;
}
for (const s of Object.values(SFX)) loadRaw(s);
const musicTracks = Object.fromEntries(Object.entries(MUSIC).map(([k, url]) => [k, { url }]));
for (const t of Object.values(musicTracks)) loadRaw(t);
// play one sound. x, y = where it happens (optional: omitted = not positional). mult scales the volume.
function playSfx(name, x, y, mult = 1) {
  if (!sfxOn) return; const s = SFX[name], ac = audioContext; if (!s || !ac || ac.state !== "running") return;
  const buf = decoded(s, ac); if (!buf) return;
  const now = performance.now(); if (now - (s.lastAt || 0) < (s.gap || 0) || (s.playing || 0) >= (s.max || 4)) return;
  let vol = s.vol * mult; const me = V(me_());
  if (me && Number.isFinite(x)) { const d = Math.hypot(x - me.x, y - me.y); vol *= Math.max(0, 1 - d / 900); }   // quieter far away
  if (vol < .02) return;
  const src = ac.createBufferSource(), g = ac.createGain(); src.buffer = buf; g.gain.value = vol; src.connect(g); g.connect(sfxBus);
  s.playing = (s.playing || 0) + 1; s.lastAt = now; src.onended = () => { s.playing--; }; src.start();
  return buf.duration;
}
addEventListener("pointerdown", sfxContext, { once: true }); addEventListener("keydown", sfxContext, { once: true });
function turretSound(id, x, y) { playSfx("turret", x, y); }   // the server fires the turret once per clip length, so every attack = one burst sound
const music = { want: "", cur: null };   // cur = { name, src, gain }
function musicScene() {   // which music fits right now
  if (!room || !state || state.phase === "lobby") return "menu";
  if (state.phase === "defeat" || state.phase === "victory") return "";
  const hive = [...state.zombies.values()].some(z => z.kind === "hivemind");
  if (hive || (state.waveType === "boss" && (state.bossPhase === "intro" || state.bossPhase === "fight"))) return "boss";
  return state.isNight ? "night" : "day";
}
function updateMusic() {   // called every frame: crossfades to the scene's track
  const ac = audioContext; if (!ac || ac.state !== "running") return;
  const want = musicScene(); if (want === music.want && (music.cur || !want)) return;
  const t = want && musicTracks[want], buf = t && decoded(t, ac);
  if (want && !buf) return;   // still loading: try again next frame
  music.want = want;
  if (music.cur) { const old = music.cur; old.gain.gain.setTargetAtTime(0, ac.currentTime, MUSIC_FADE / 3); setTimeout(() => { try { old.src.stop(); } catch {} }, MUSIC_FADE * 1500); music.cur = null; }
  if (!want) return;
  const src = ac.createBufferSource(), gain = ac.createGain(); src.buffer = buf; src.loop = true; src.loopStart = .03; src.loopEnd = buf.duration - .03;   // skip the mp3's silent padding so the loop is seamless
  gain.gain.value = 0; gain.gain.setTargetAtTime(MUSIC_VOL, ac.currentTime, MUSIC_FADE / 3); src.connect(gain); gain.connect(musicBus); src.start(0, .03);
  music.cur = { name: want, src, gain };
}
function setMusicOn(on) { musicOn = on; if (musicBus) musicBus.gain.setTargetAtTime(on ? 1 : 0, audioContext.currentTime, .2); $("musicToggle").textContent = "Music: " + (on ? "ON" : "OFF"); $("setAmbient").checked = on; savePrefs(); }
function setSfxOn(on) { sfxOn = on; if (sfxBus) sfxBus.gain.setTargetAtTime(on ? 1 : 0, audioContext.currentTime, .05); $("sfxToggle").textContent = "Sound effects: " + (on ? "ON" : "OFF"); $("setSfx").checked = on; savePrefs(); }
$("musicToggle").onclick = () => setMusicOn(!musicOn);
$("sfxToggle").onclick = () => setSfxOn(!sfxOn);
// Game-state changes -> sounds (wave start / cleared / defeat, night, tower repairs and alarm, revives, pickups, building, brutes)
const aw = { phase: null, stage: 0, night: false, tower: 0, gen: 0, fuel: 0, alive: new Map(), loot: new Map(), structs: new Map(), brutes: new Set(), alarmAt: 0, groanAt: 0 };
function audioWatch() {
  const s = state; if (!s) return; const now = performance.now(), me = V(me_()), same = aw.phase === s.phase && aw.stage === s.stage;
  if (aw.phase !== null) {
    if (s.phase === "playing" && !same) playSfx("wave");
    else if (s.phase === "cleared" && aw.phase === "playing") playSfx("victory", undefined, undefined, .8);
    else if (s.phase === "victory" && aw.phase !== "victory") playSfx("victory");
    else if (s.phase === "defeat" && aw.phase !== "defeat") playSfx("gameover");
    if (s.isNight && !aw.night && s.phase === "playing") playSfx("thunder");
    if (same && (s.towerHp > aw.tower + 3 || s.generatorHp > aw.gen + 3 || s.generatorFuel > aw.fuel + 3)) playSfx("repair");
    if (s.phase === "playing" && s.towerHp < s.towerMaxHp * .25 && s.towerHp < aw.tower && now - aw.alarmAt > 10000) { aw.alarmAt = now; playSfx("alarm"); }
    for (const p of s.players.values()) if (same && s.phase === "playing" && aw.alive.get(p.sessionId) === false && p.alive) playSfx("revive", p.x, p.y);
    if (me) for (const [id, l] of aw.loot) if (!s.loot.has(id) && Math.hypot(l.x - me.x, l.y - me.y) < 90) playSfx("pickup");
    for (const st of s.structures.values()) {
      const was = aw.structs.get(st.id);
      if (!was && (st.kind === "fence" || st.kind === "safehouse")) playSfx("build", st.x, st.y);
      else if (was && st.kind === "safehouse" && was.deploy > 0 && st.deploy <= 0) playSfx("build", st.x, st.y);   // finished
    }
    for (const z of s.zombies.values()) if (z.kind === "brute" && !aw.brutes.has(z.id) && me && Math.hypot(z.x - me.x, z.y - me.y) < 700) playSfx("roar", z.x, z.y, .7);
    if (s.phase === "playing" && me && now > aw.groanAt) {   // now and then a nearby zombie groans
      aw.groanAt = now + 5000 + Math.random() * 6000; let near = null, nd = 450;
      for (const z of s.zombies.values()) { const d = Math.hypot(z.x - me.x, z.y - me.y); if (d < nd && !z.boss) { nd = d; near = z; } }
      if (near) playSfx("groan", near.x, near.y);
    }
  }
  aw.phase = s.phase; aw.stage = s.stage; aw.night = !!s.isNight; aw.tower = s.towerHp; aw.gen = s.generatorHp; aw.fuel = s.generatorFuel;
  aw.alive.clear(); for (const p of s.players.values()) aw.alive.set(p.sessionId, p.alive);
  aw.loot.clear(); for (const l of s.loot.values()) aw.loot.set(l.id, { x: l.x, y: l.y });
  aw.structs.clear(); for (const st of s.structures.values()) aw.structs.set(st.id, { deploy: st.deploy });
  aw.brutes.clear(); for (const z of s.zombies.values()) if (z.kind === "brute") aw.brutes.add(z.id);
}
window.__saAudio = () => ({ ctx: audioContext?.state, music: music.cur?.name || "", played: Object.keys(SFX).filter(k => SFX[k].lastAt), ready: Object.keys(SFX).filter(k => SFX[k].raw).length });   // read-only hook for tests
// Sofea's helicopter gatling: press = wind-up (0-0.4s), hold = loop 0.45-4.2s, release = the clip's own spin-down (4.2s to the end)
// while the loop fades out fast. Volume follows the distance.
const heliLoops = new Map();   // heli id -> { src, gain }
function heliLoop(p, on) {
  const ac = audioContext, s = SFX.gatling, cur = heliLoops.get(p.sessionId);
  const me = V(me_()), d = me ? Math.hypot(p.x - me.x, p.y - me.y) : 0, vol = s.vol * (p.sessionId === myId ? 1 : .6) * Math.max(0, 1 - d / 900);
  if (on && !cur && ac && ac.state === "running" && sfxOn) {
    const buf = decoded(s, ac); if (!buf) return;
    const src = ac.createBufferSource(), gain = ac.createGain(); src.buffer = buf; src.loop = true; src.loopStart = .45; src.loopEnd = Math.min(4.2, buf.duration - .05);
    gain.gain.value = vol; src.connect(gain); gain.connect(sfxBus); src.start(); heliLoops.set(p.sessionId, { src, gain });
  } else if (cur && on) cur.gain.gain.setTargetAtTime(vol, ac.currentTime, .05);
  else if (cur && !on) {
    const now = ac.currentTime, buf = cur.src.buffer, src = cur.src, g = cur.gain.gain.value;
    cur.gain.gain.setTargetAtTime(0, now, .02); setTimeout(() => { try { src.stop(); } catch {} }, 150); heliLoops.delete(p.sessionId);
    if (sfxOn && buf && buf.duration > 4.3 && g > .01) {   // spin-down: the opposite of the wind-up
      const tail = ac.createBufferSource(), tg = ac.createGain(); tail.buffer = buf; tg.gain.value = 0; tg.gain.setTargetAtTime(g, now, .01);
      tail.connect(tg); tg.connect(sfxBus); tail.start(now, 4.2);
    }
  }
}
// fires on a painted map: one looping crackle, louder the closer you are to a fire (fades in / out)
let fireLoop = null;
function fireAmbience() {
  const ac = audioContext, pm = state?.phase === "playing" && paintedMap(), me = pm && V(me_() || {});
  let k = 0; if (pm && me) for (const [x, y, sc] of pm.fires) k = Math.max(k, Math.max(0, 1 - Math.hypot(x - me.x, y - me.y) / 420) * Math.min(1, sc + .2));
  const vol = SFX.fire.vol * k;
  if (!fireLoop && vol > .01 && ac && ac.state === "running" && sfxOn) {
    const buf = decoded(SFX.fire, ac); if (!buf) return;
    const src = ac.createBufferSource(), gain = ac.createGain(); src.buffer = buf; src.loop = true; src.loopStart = .06; src.loopEnd = buf.duration - .06;
    gain.gain.value = 0; src.connect(gain); gain.connect(sfxBus); src.start(0, Math.random() * 5); fireLoop = { src, gain };
  }
  if (!fireLoop) return;
  if (vol <= .005 || !sfxOn) { const f = fireLoop; fireLoop = null; f.gain.gain.setTargetAtTime(0, ac.currentTime, .2); setTimeout(() => { try { f.src.stop(); } catch {} }, 1200); return; }
  fireLoop.gain.gain.setTargetAtTime(vol, ac.currentTime, .25);
}
function stopLostHeliLoops() {   // every frame: landed / left -> stop; off screen (not drawn) -> keep the volume and on/off up to date here
  for (const id of [...heliLoops.keys()]) { const v = state?.vehicles?.get(id), p = state?.players?.get(id);
    if (!v || v.kind !== "heli" || v.phase !== "ride" || !p) heliLoop({ sessionId: id, x: 0, y: 0 }, false); else heliLoop(V(p), heliFiring(p)); }
}
// gunshot sound for a "shot" message (yours loudest, teammates' quieter, police / robots quieter still)
function shotSound(m) {
  if (m.w === "launcher") return;   // the rocket's explosion makes the noise
  if (m.w === "minigun") return turretSound(m.id, m.x, m.y);
  const name = m.w === "shotgun" ? "shotgun" : m.w === "pistol" ? "pistol" : "rifle";
  playSfx(name, m.x, m.y, m.id === myId ? 1 : state?.players?.has(m.id) ? .6 : .45);
}
let scoreboardOpen = false, firing = false, wheel = null, lastWheelScroll = 0;
const me_ = () => state?.players.get(myId);
function selectSlot(n, cycle = true) { if (room && inMatch()) room.send("slot", { n, cycle }); }

// mouse: left = use, right (hold) = build wheel, wheel = cycle slots
canvas.addEventListener("mousedown", e => {
  if (!inMatch()) return;
  if (e.button === 0 && me_() && !me_().alive) { switchSpectate(1); return; }
  if (e.button === 0) {
    e.preventDefault(); if (wheel) return;
    if (squadWheel) return;
    const me = me_();
    if (state.vehicles?.get(myId)) { firing = true; clickShotAt = performance.now(); return; }   // in a vehicle the mouse is the gun's trigger, whatever slot is selected
    if (me?.activeSlot === 5) room.send("attack", {});
    else if (me?.activeSlot === 1 && me.melee === "axe") { if (!axeChargeAt) { axeChargeAt = performance.now(); room.send("charge", { on: true }); } }
    else { firing = true; clickShotAt = performance.now(); }
  }
  if (e.button === 2 && state.vehicles?.get(myId)) { e.preventDefault(); const v = state.vehicles.get(myId), me = me_();   // in a vehicle: no build wheel; the mecha swings its saber
    if (v.kind === "mecha" && v.phase === "ride" && me && !anyPanelOpen()) room.send("mechaSlash", { a: aimAngle(me) }); return; }
  if (e.button === 2) { e.preventDefault(); firing = false; wheel = { x: mouse.x, y: mouse.y, cx: Math.max(WHEEL_R + 30, Math.min(W - WHEEL_R - 30, mouse.sx)), cy: Math.max(WHEEL_R + 30, Math.min(H - WHEEL_R - 30, mouse.sy)), pick: -1 }; }
});
window.addEventListener("mouseup", e => {
  if (e.button === 0) { firing = false; releaseAxe(); }
  if (e.button === 2 && wheel) { resolveWheel(); wheel = null; }
});
window.addEventListener("blur", () => { firing = false; wheel = null; if (axeChargeAt) { axeChargeAt = 0; room?.send("charge", { on: false }); } });
$("gameArea").addEventListener("contextmenu", e => e.preventDefault());
window.addEventListener("mousemove", e => {
  const r = canvas.getBoundingClientRect(); if (!r.width) return;
  mouse.sx = (e.clientX - r.left) * W / r.width; mouse.sy = (e.clientY - r.top) * H / r.height;
  mouse.x = mouse.sx + cam.x; mouse.y = mouse.sy + cam.y;
  if (wheel) wheel.pick = wheelPick();
});
$("gameArea").addEventListener("wheel", e => {
  if (!inMatch() || wheel || anyPanelOpen()) return;
  e.preventDefault();
  const now = performance.now(); if (now - lastWheelScroll < 110) return; lastWheelScroll = now;
  const me = me_(); if (!me) return;
  const i = SLOT_ORDER.indexOf(me.activeSlot), dir = e.deltaY > 0 ? 1 : -1;
  selectSlot(SLOT_ORDER[(Math.max(0, i) + dir + SLOT_ORDER.length) % SLOT_ORDER.length], false);
}, { passive: false });

// keyboard
window.addEventListener("keydown", e => {
  if (e.target.closest?.("input,select,textarea")) return;
  const k = e.key.toLowerCase();
  if (!inMatch()) return;
  if (k === "enter" && state?.bossPhase === "intro" && !introAcked) { e.preventDefault(); ackBoss(); return; }
  if (k === "escape") { e.preventDefault(); if (anyPanelOpen()) closePanels(); else { togglePanel("menu"); playSfx("pause"); } return; }
  if (k === "tab") { e.preventDefault(); scoreboardOpen = !scoreboardOpen; return; }
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
  if (me_() && !me_().alive && [" ", "arrowleft", "arrowright"].includes(k) && !e.repeat) { switchSpectate(k === "arrowleft" ? -1 : 1); return; }
  if (!$("levelUp").classList.contains("hidden") && /^[1-5]$/.test(k)) { pickUpgrade(upgrades[Number(k) - 1][0]); return; }
  if (e.repeat && !"wasd ".includes(k) && !k.startsWith("arrow")) return;
  keys[k === " " ? "space" : k] = true;
  if (k === " ") dashQueued = true;   // a quick tap still counts
  if (["1", "2", "3", "4"].includes(k)) selectSlot(k === "4" ? 5 : Number(k));   // 4 = medkit (slot 5 on the server)
  else if (k === "e") { const me = me_(); if (me?.characterClass === "engineer") openSquadWheel();
    else if (me?.characterClass === "scout" && (me.shadow > 0 || me.fire > 0)) { feed.unshift({ text: me.shadow > 0 ? "You're hidden: attack to strike with a burning katana" : `Katana burning: ${Math.ceil(me.fire)}s left`, t: Date.now() }); feed.length = Math.min(feed.length, 5); }
    else if (me?.characterClass === "scout" && me.abilityCooldown > 0) { feed.unshift({ text: `Shadow Pass ready in ${Math.ceil(me.abilityCooldown)}s`, t: Date.now() }); feed.length = Math.min(feed.length, 5); }
    else room.send("ability", { a: aimAngle(me), d: aimDist(me) }); }
  else if (k === "q") { const me = me_(); if (me?.characterClass === "demolitionist" && me.ultActive > 0) room.send("ult", { a: aimAngle(me) }); else if (ULT[me?.characterClass]) { if ((me.ultKills || 0) < 100) { feed.unshift({ text: `${ULT[me.characterClass].name} unlocks at 100 kills (${me.ultKills || 0}/100)`, t: Date.now() }); feed.length = Math.min(feed.length, 5); } else if (!me.ultReady) { feed.unshift({ text: me.ultActive > 0 ? `${ULT[me.characterClass].name} is active (${Math.ceil(me.ultActive)}s left)` : `${ULT[me.characterClass].name} ready in ${Math.ceil(me.ultCd || 0)}s`, t: Date.now() }); feed.length = Math.min(feed.length, 5); } else room.send("ult", { a: aimAngle(me) }); } }
  else if (k === "r") { if (["dispatcher", "operator"].includes(me_()?.characterClass) && !e.repeat) room.send("skill2"); }   // R = 3rd skill (Astra: Safehouse, Sofea: Crimson Aegis mecha; others get theirs later). Reloading is automatic
  else if (k === "c") room.send("reload");   // C: reload early (top up a half-empty magazine)
  else if (k === "f" && !e.repeat) tryRevive();
  else if (k === "t") togglePanel("equip");
  else if (k === "u") togglePanel("levelUp");
  else if (k === "v" && SOLO_PREVIEW) { const i = (VISION_STEPS.indexOf(NIGHT.playerR / W) + 1) % VISION_STEPS.length; NIGHT.playerR = Math.round(VISION_STEPS[i] * W); feed.unshift({ text: `Test: night vision ${Math.round(VISION_STEPS[i] * 100)}% (${NIGHT.playerR}px) · V to switch`, t: Date.now() }); feed.length = Math.min(feed.length, 5); }
  else if (k === "g" && SOLO_PREVIEW) room.send("debugGold");
  else if ((k === "]" || k === "[") && state && (SOLO_PREVIEW || state.hostId === myId)) room.send("debugWave", { n: Math.max(1, Math.min(50, (state.stage || 1) + (k === "]" ? 1 : -1))) });
  else if (k === "n" && SOLO_PREVIEW) { forceNight = !forceNight; feed.unshift({ text: forceNight ? "Test: night view ON (press N to turn off)" : "Test: night view OFF", t: Date.now() }); feed.length = Math.min(feed.length, 5); }
});
window.addEventListener("keyup", e => { const k = e.key.toLowerCase(); keys[k === " " ? "space" : k] = false; if (k === "e") closeSquadWheel(); if (k === "f" && reviving) { reviving = null; room?.send("reviveStop"); } });
// Revive: hold F next to a downed teammate for 5s (the server times it; letting go or walking off cancels). reviving = what we show.
let reviving = null;   // { id, t0 }
function tryRevive() {
  const me = me_(); if (!me?.alive || !state) return;
  const target = [...state.players.values()].find(p => !p.alive && !p.bledOut && Math.hypot(p.x - me.x, p.y - me.y) < 85);
  if (target) { room.send("revive", { targetId: target.sessionId }); reviving = { id: target.sessionId, t0: performance.now() }; }
}
function drawReviveRing() {   // progress ring around the teammate you're reviving
  if (!reviving || !state) return; const me = V(me_()), t = V(state.players.get(reviving.id));
  if (!me || !t || !me_()?.alive || state.players.get(reviving.id)?.alive || Math.hypot(t.x - me.x, t.y - me.y) > 85) { reviving = null; return; }   // done, or walked off (the server cancels too)
  const k = Math.min(1, (performance.now() - reviving.t0) / 5000);
  ctx.save(); ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.beginPath(); ctx.arc(t.x, t.y - 4, 26, 0, 7); ctx.stroke();
  ctx.strokeStyle = "#7dff9a"; ctx.shadowColor = "#7dff9a"; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(t.x, t.y - 4, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
  ctx.shadowBlur = 0; ctx.fillStyle = "#eaffef"; ctx.font = "bold 11px monospace"; ctx.textAlign = "center"; ctx.fillText(`REVIVING ${Math.ceil(5 - k * 5)}s`, t.x, t.y - 38); ctx.restore();
}

// build wheel: hold right-click, move toward an option, release
function wheelPick() {
  if (!wheel) return -1;
  const dx = mouse.sx - wheel.cx, dy = mouse.sy - wheel.cy;
  if (Math.hypot(dx, dy) < 30) return -1;
  const step = Math.PI * 2 / BUILD_WHEEL.length;
  return ((Math.round((Math.atan2(dy, dx) + Math.PI / 2) / step) % BUILD_WHEEL.length) + BUILD_WHEEL.length) % BUILD_WHEEL.length;
}
function canAfford(cost) { return Object.entries(cost).every(([r, n]) => (state?.[r] || 0) >= n); }
function buildSpot(me) {
  const dx = wheel.x - me.x, dy = wheel.y - me.y, d = Math.hypot(dx, dy);
  return d <= BUILD_RANGE ? { x: wheel.x, y: wheel.y } : { x: me.x + dx / d * BUILD_RANGE, y: me.y + dy / d * BUILD_RANGE };
}
function resolveWheel() {
  const me = me_(); const opt = BUILD_WHEEL[wheel.pick];
  if (!me || !opt || !room || !canAfford(opt.cost)) return;
  if (opt.id === "repairTower") room.send("repairTower", { amount: 250 });
  else if (opt.id === "repairGen") room.send("repairGenerator");
  else if (opt.id === "refuelGen") room.send("refuelGenerator");
  else { const spot = buildSpot(me); room.send("build", { kind: opt.id, x: Math.round(spot.x), y: Math.round(spot.y) }); }
}
function drawBuildWheel() {
  const me = V(me_()); if (!wheel || !me) return;
  const spot = buildSpot(me), R = WHEEL_R, step = Math.PI * 2 / BUILD_WHEEL.length;
  ctx.save();
  // range ring + placement ghost (in the world, under the camera)
  ctx.save(); ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
  ctx.strokeStyle = "rgba(242,139,54,.35)"; ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(me.x, me.y, BUILD_RANGE, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  const opt = BUILD_WHEEL[wheel.pick];
  if (!opt || !opt.action) { if (!(opt && drawObj(opt.id, spot.x, spot.y + (STRUCT_BASE[opt.id] || 14), { alpha: .6 }))) { ctx.fillStyle = "rgba(242,139,54,.25)"; ctx.strokeStyle = "#f28b36"; ctx.lineWidth = 2; ctx.fillRect(spot.x - 14, spot.y - 14, 28, 28); ctx.strokeRect(spot.x - 14, spot.y - 14, 28, 28); } }
  ctx.restore();
  // wheel
  ctx.fillStyle = "rgba(8,12,14,.82)"; ctx.beginPath(); ctx.arc(wheel.cx, wheel.cy, R + 14, 0, 7); ctx.fill();
  BUILD_WHEEL.forEach((o, i) => {
    const a = i * step - Math.PI / 2, x = wheel.cx + Math.cos(a) * R * .74, y = wheel.cy + Math.sin(a) * R * .74;
    const ok = canAfford(o.cost), sel = i === wheel.pick;
    if (sel) { ctx.fillStyle = ok ? "rgba(242,139,54,.35)" : "rgba(200,60,60,.3)"; ctx.beginPath(); ctx.moveTo(wheel.cx, wheel.cy); ctx.arc(wheel.cx, wheel.cy, R + 12, a - step / 2, a + step / 2); ctx.closePath(); ctx.fill(); }
    ctx.textAlign = "center"; ctx.globalAlpha = ok ? 1 : .45;
    // picture of what you build / do
    const pic = WHEEL_PIC[o.id], img = pic && (pic.obj ? objImgs[pic.obj] : ICON_IMG[pic.icon]);
    if (img?.complete && img.naturalWidth) { const k = Math.min(46 / img.width, 40 / img.height) * (sel ? 1.15 : 1); ctx.imageSmoothingEnabled = false; ctx.drawImage(img, x - img.width * k / 2, y - 22 - img.height * k, img.width * k, img.height * k); }
    ctx.fillStyle = sel ? "#ffd2a8" : "#eef2f0"; ctx.font = "bold 15px Inter, system-ui, sans-serif"; ctx.strokeStyle = "#000c"; ctx.lineWidth = 3; ctx.strokeText(o.name, x, y - 3); ctx.fillText(o.name, x, y - 3);
    ctx.fillStyle = ok ? "#ffd27a" : "#ff8a7a"; ctx.font = "bold 13px ui-monospace, monospace";
    const parts = Object.entries(o.cost);
    if (parts.every(([r]) => ICON_IMG[r]?.naturalWidth)) {   // "40 [scrap icon]  8 [chip icon]"
      ctx.textAlign = "left"; const widths = parts.map(([, n]) => ctx.measureText(String(n)).width + 22);
      let cx = x - (widths.reduce((a, b) => a + b, 0) + (parts.length - 1) * 8) / 2;
      parts.forEach(([r, n], j) => { ctx.fillText(String(n), cx, y + 17); drawIcon(r, cx + widths[j] - 9, y + 12, 19); cx += widths[j] + 8; });
      ctx.textAlign = "center";
    } else ctx.fillText(parts.map(([r, n]) => n + " " + RES_SHORT[r]).join(" · "), x, y + 17);
    ctx.globalAlpha = 1;
  });
  ctx.fillStyle = "#c3ccc9"; ctx.font = "bold 13px Inter, system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(wheel.pick < 0 ? "release to cancel" : "release to " + (BUILD_WHEEL[wheel.pick].action ? "use" : "build"), wheel.cx, wheel.cy + 4);
  ctx.restore();
}

// what gets sent to the server each frame
let lastMelee = 0, clickShotAt = 0, dashReadyAt = 0, dashQueued = false;
// Fire axe: press = start charging, release = swing. Held 1 second or more = heavy swing.
let axeChargeAt = 0;
const AXE_CHARGE_MS = 1000;
function releaseAxe() {
  if (!axeChargeAt) return;
  const held = performance.now() - axeChargeAt; axeChargeAt = 0;
  const me = me_();
  if (!room || !me?.alive || me.activeSlot !== 1 || me.melee !== "axe" || state?.phase !== "playing") { room?.send("charge", { on: false }); return; }
  room.send("attack", { a: aimAngle(me), heavy: held >= AXE_CHARGE_MS }); lastMelee = performance.now();
}
// Auto-update: every minute, look at the live index.html; if it loads a newer client.js?v=..., reload when not in a room, else say so.
{ const mine = (document.querySelector('script[src*="client.js"]')?.getAttribute("src") || "").match(/v=([\w-]+)/)?.[1];
  if (mine && typeof __SOLO__ === "undefined") setInterval(async () => {
    try {
      const html = await (await fetch("./index.html?t=" + Date.now(), { cache: "no-store" })).text(), live = html.match(/client\.js\?v=([\w-]+)/)?.[1];
      if (!live || live === mine) return;
      if (!room) location.reload();   // not in a room (e.g. the update restarted the server and dropped us): load the new version
      else if (!window.__saUpdateToast) { window.__saUpdateToast = 1; toast("A new version of the game is out: refresh the page after this game."); }
    } catch {}
  }, 60000);
}
// true only in the solo preview build (tools/build-preview.mjs defines __SOLO__): enables test keys like N = night view
const SOLO_PREVIEW = typeof __SOLO__ !== "undefined" && __SOLO__ === true;
const DASH_CD_MS = 5000;   // matches DASH_COOLDOWN on the server
function sendControls(t) {
  if (!room || !state || state.phase !== "playing") return;
  const me = me_(); if (!me?.alive) return;
  const ride = state.vehicles?.get(myId);
  if (t - lastInput > 45) {
    const dx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0), dy = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
    const dt = Math.min(100, t - lastInput), seq = ++PRED.seq; lastInput = t;
    if (ride) room.send("input", { dx, dy, a: aimAngle(me), s: seq, f: (ride.kind === "heli" || ride.kind === "mecha") && heliTrigger() ? 1 : 0 });   // in a vehicle the gun follows the mouse (no prediction: the server drives it)
    else { room.send("input", { dx, dy, s: seq, dt: Math.round(dt) }); predictInput(me, { seq, dx, dy, dt: dt / 1000 }); }
  }
  if (ride) {   // Sofea's tank / helicopter: hold or click to fire (the server allows one shot every 1.5s)
    const clicked = clickShotAt && performance.now() - clickShotAt < 300;
    if (ride.phase === "ride" && ride.kind === "tank" && !anyPanelOpen() && (firing || clicked) && t - lastShoot > 120) { room.send("attack", { a: aimAngle(me), d: aimDist(me) }); lastShoot = t; clickShotAt = 0; }
    dashQueued = false; return;
  }
  if (!wheel && !squadWheel && !anyPanelOpen() && !(me.stunned > 0)) {
    const clicked = clickShotAt && performance.now() - clickShotAt < 300; // a quick click counts even if the button is already released
    if (me.activeSlot === 1) {
      const cd = (MELEE_INFO[me.melee] || MELEE_INFO.knife).cd * 1000;
      if (me.melee !== "axe" && (firing || clicked) && t - lastMelee > cd) { room.send("attack", { a: aimAngle(me) }); lastMelee = t; clickShotAt = 0; }
    } else if (me.activeSlot === 2 || me.activeSlot === 3) {
      const rage = me.characterClass === "juggernaut" && me.weapon === "shotgun" && me.ultActive > 0;   // War Cry: shotgun spam (hold to fire, 3x faster, no ammo)
      const auto = WEAPON_INFO[me.weapon]?.auto || rage, ready = t - lastShoot >= Math.max(55, 1000 / ((me.fireRate || 1) * (rage ? 3 : 1)));
      // full-auto (rifle, SMG): keep firing while held. Semi-auto: one shot per click.
      if (ready && ((auto && firing) || clicked)) { room.send("attack", { a: aimAngle(me), d: aimDist(me) }); lastShoot = t; clickShotAt = 0; }
    }
  }
  if (dashQueued && !dashReady) dashQueued = false;   // tapped while on cooldown: ignore
  if (dashQueued && dashReady) {
    dashQueued = false;
    dashReady = false; dashReadyAt = performance.now() + DASH_CD_MS; setTimeout(() => dashReady = true, DASH_CD_MS);
    const dx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0), dy = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
    const seq = ++PRED.seq, from = V(me); room.send("dash", { dx, dy, s: seq }); predictInput(me, { seq, dx, dy, dash: true });
    if (from && PRED.ok) dashBeam(myId, from.x, from.y, PRED.x, PRED.y);
  }
}
// --- Pixel-art world renderer: hand-drawn Canvas sprites, buildings and props ---
function px(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)));}
function block(x,y,w,h,base,shade,light){px(x,y,w,h,base);px(x,y,w,3,light);px(x,y+h-3,w,3,shade);px(x,y,3,h,light);px(x+w-3,y,3,h,shade);}
// ---------- VIKTOR: Heavy Turret (E) + Robot Squad (Q) ----------
const ULT = { engineer: { name: "Heavy Turret", icon: "heavyTurret", life: 40, cd: 60 }, scout: { name: "Blade Storm", icon: "bladeStorm", life: 10, cd: 60 }, demolitionist: { name: "Demo Ripple", icon: "demoRipple", life: 30, cd: 60 }, operator: { name: "Sky Reign", icon: "skyReign", life: 30, cd: 60 }, juggernaut: { name: "War Cry", icon: "warCry", life: 10, cd: 60 }, dispatcher: { name: "Police Backup", icon: "policeBackup", life: 30, cd: 60 } };
const vImgs = {};
for (const [k, url] of Object.entries({ turret: "assets/sprites/zombies/dir8/viktor-turret.png", assault: "assets/sprites/zombies/dir8/robot-assault.png",
  support: "assets/sprites/zombies/dir8/robot-support.png", hunter: "assets/sprites/zombies/dir8/robot-hunter.png", deploy: "assets/sprites/fx/turret-deploy.png",
  turretDead: "assets/sprites/fx/turret-dead.png", robotsDead: "assets/sprites/fx/robots-dead.png", fx: "assets/sprites/fx/viktor-fx.png" })) { const im = new Image(); im.src = url; vImgs[k] = im; }
const machineShotAt = new Map(), robotMove = new Map();
const rowOf = a => ROW_OF_OCT[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
function vFrame(im, cw, ch, col, row, x, y, fy, alpha = 1) {
  if (!im?.naturalWidth) return; ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = alpha;
  ctx.drawImage(im, col * cw, row * ch, cw, ch, Math.round(x - cw / 2), Math.round(y - fy), cw, ch); ctx.restore();
}
function machineHp(m, w, y) {
  if (m.hp >= m.maxHp) return;
  ctx.fillStyle = "#1a1a1a"; ctx.fillRect(m.x - w / 2, y, w, 4); ctx.fillStyle = "#f2a15b"; ctx.fillRect(m.x - w / 2, y, w * Math.max(0, m.hp / m.maxHp), 4);
}
function drawHeavyTurret(st) {
  const now = performance.now();
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(st.x, st.y + 4, 30, 9, 0, 0, 7); ctx.fill(); ctx.restore();
  if (st.deploy > 0) { vFrame(vImgs.deploy, 170, 130, Math.min(5, Math.floor((1 - st.deploy / 1.0) * 6)), 0, st.x, st.y + 6, 124); return; }
  const since = now - (machineShotAt.get(st.id) || 0), col = since < 70 ? 2 : since < 140 ? 1 : since < 220 ? 3 : 0;
  vFrame(vImgs.turret, 170, 130, col, rowOf(st.aim || 0), st.x, st.y + 6, 124);
  machineHp(st, 46, st.y - 86);
}
// Support robot's heal ring under the survivor it's visiting: turns on, pulses slowly while it stays, turns off when it leaves.
// Viktor's support robot healing someone: the regen effect loops on them (regenKeep)
function drawHealRings() {
  for (const r of state?.robots?.values() || []) if (r.kind === "support" && r.act === "heal" && r.tgt) regenKeep(r.tgt);
}
function drawRobot(r) {
  if (ASTRA_UNITS.has(r.kind)) return drawAstraUnit(r);
  const now = performance.now(); let mv = robotMove.get(r.id);
  if (!mv) { mv = { x: r.x, y: r.y, at: 0, dist: 0 }; robotMove.set(r.id, mv); }
  const step = Math.hypot(r.x - mv.x, r.y - mv.y); if (step > .4) { mv.at = now; mv.dist += step; mv.x = r.x; mv.y = r.y; }
  const moving = now - mv.at < 160;
  let col = moving ? 1 + Math.floor(mv.dist / 14) % 3 : 0;
  if (r.act === "shoot") col = Math.floor(now / 80) % 2 ? 5 : 4;
  else if (r.act === "charge") col = 4; else if (r.act === "fire") col = 5;
  else if (r.act === "heal") col = 4; else if (r.act === "buff" && !moving) col = 5;
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(r.x, r.y + 3, 15, 5, 0, 0, 7); ctx.fill(); ctx.restore();
  vFrame(vImgs[r.kind], 110, 90, col, rowOf(r.aim || 0), r.x, r.y + 4, 84);
  machineHp(r, 30, r.y - 50);
}
// ---------- THE HIVEMIND (mini boss on waves 2, 6, 10...) ----------
const hImgs = {};
for (const [k, url] of Object.entries({ crawl: "assets/sprites/zombies/dir8/hivemind.png", act: "assets/sprites/zombies/dir8/hivemind-act.png", fx: "assets/sprites/fx/hivemind-fx.png" })) { const im = new Image(); im.src = url; hImgs[k] = im; }
const HV = { slamWind: .55, slamR: 210, flat: .62, jumpUp: .3, jumpLand: .9 };   // matches the server
const hiveMove = new Map();
function hiveFx(row, col, x, y, alpha = 1, scale = 1) {   // 200x150 cells, bottom-centre at (x, y)
  const im = hImgs.fx; if (!im?.naturalWidth) return; ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.drawImage(im, col * 200, row * 150, 200, 150, -100, -146, 200, 150); ctx.restore();
}
function drawHivemind(z) {
  const now = performance.now(), feet = (z.radius || 44) * .8, t = actTime(z);
  let mv = hiveMove.get(z.id); if (!mv) { mv = { x: z.x, y: z.y, dist: 0, at: 0 }; hiveMove.set(z.id, mv); }
  const step = Math.hypot(z.x - mv.x, z.y - mv.y); if (step > .3) { mv.dist += step; mv.at = now; } mv.x = z.x; mv.y = z.y;
  const flashAt = feel.flash.get(z.id), filter = flashAt && now - flashAt < 90 ? "brightness(2.2)" : "";
  let lift = 0;
  if (z.act === "jump" && t > HV.jumpUp && t < HV.jumpLand) lift = Math.sin(Math.PI * (t - HV.jumpUp) / (HV.jumpLand - HV.jumpUp)) * 70;
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.beginPath(); const sh = 1 - lift / 140; ctx.ellipse(z.x, z.y + feet, 70 * sh, 16 * sh, 0, 0, 7); ctx.fill(); ctx.restore();
  if (z.act === "slam" && t < HV.slamWind + .05) {   // danger zone fills up during the wind-up
    const k = Math.min(1, t / HV.slamWind); ctx.save(); ctx.fillStyle = `rgba(255,70,55,${.08 + .16 * k})`; ctx.strokeStyle = `rgba(255,70,55,${.4 + .5 * k})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(z.x, z.y + feet, HV.slamR, HV.slamR * HV.flat, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  const act = hImgs.act, crawl = hImgs.crawl, flip = Math.cos(z.aim || 0) < -.2;
  let row = -1, col = 0;
  if (z.act === "bite") { row = 0; col = Math.min(4, Math.floor(t / (.95 / 5))); }
  else if (z.act === "slam") { row = 1; col = t < .2 ? 0 : t < HV.slamWind ? 1 : t < HV.slamWind + .12 ? 2 : t < HV.slamWind + .35 ? 3 : t < 1.1 ? 4 : 5; }
  else if (z.act === "jump") { row = 2; col = t < HV.jumpUp ? 0 : t < .5 ? 1 : t < .7 ? 2 : t < HV.jumpLand ? 3 : t < 1.05 ? 4 : 5; }
  ctx.save(); ctx.imageSmoothingEnabled = false; if (filter) ctx.filter = filter; ctx.translate(Math.round(z.x), Math.round(z.y + feet - (row === 2 ? 0 : lift)));
  if (row >= 0 && act?.naturalWidth) { if (flip) ctx.scale(-1, 1); ctx.drawImage(act, col * 260, row * 230, 260, 230, -130, -226, 260, 230); }
  else if (crawl?.naturalWidth) {
    const r8 = ROW_OF_OCT[((Math.round((z.aim || 0) / (Math.PI / 4)) % 8) + 8) % 8], c = now - mv.at < 200 ? Math.floor(mv.dist / 14) % 6 : 0;
    ctx.drawImage(crawl, c * 210, r8 * 150, 210, 150, -105, -144, 210, 150);
  }
  ctx.restore();
}
function onHive(m) {
  const t = performance.now();
  if (m.k === "arrive") { shake(8, 900); const el = $("hiveWarn"); if (el) { el.classList.remove("show"); void el.offsetWidth; el.classList.add("show"); } }
  else if (m.k === "slam") { fx.push({ ...m, type: "hive", k: "slam", t }); shake(9, 320); playSfx("zap", m.x, m.y); }
  else if (m.k === "land") { fx.push({ ...m, type: "hive", k: "land", t }); shake(11, 380); playSfx("stomp", m.x, m.y); }
  else if (m.k === "spawn") fx.push({ ...m, type: "hive", k: "spawn", t });
}
function drawHiveFx(f, age) {   // false when finished
  const s = age / 1000;
  if (f.k === "slam" || f.k === "land") {
    if (s > 1.2) return false; const sc = f.r / 150;
    if (s < .5) hiveFx(0, Math.min(4, Math.floor(s / .1)), f.x, f.y + 40 * sc, 1 - s * .6, sc * 1.4);
    hiveFx(1, Math.min(4, Math.floor(s / .22)), f.x, f.y + 34, 1 - s / 1.2, f.k === "land" ? 1.3 : 1);
    if (f.k === "land" && s < .7) hiveFx(2, Math.min(4, Math.floor(s / .14)), f.x, f.y + 36, 1, 1);
    return true;
  }
  if (f.k === "spawn") {   // a zombie tears free from a lump of flesh (the real zombie is already there)
    if (s > .9) return false; hiveFx(3, Math.min(4, Math.floor(s / .18)), f.x, f.y + 20, 1 - Math.max(0, s - .6) / .3, .7);
    if (s < .5) hiveFx(2, Math.min(4, Math.floor(s / .1)), f.x, f.y + 20, .9, .6); return true;
  }
  if (f.k === "death") {   // collapses into a heap, slime spreads, fades
    if (s > 4) return false; const im = hImgs.act; const a = s > 2.8 ? 1 - (s - 2.8) / 1.2 : 1;
    hiveFx(2, Math.min(4, Math.floor(s / .15)), f.x, f.y + 40, a, 1.6);
    if (im?.naturalWidth) { ctx.save(); ctx.globalAlpha = a; ctx.imageSmoothingEnabled = false; ctx.translate(f.x, f.y + 35 + Math.min(1, s) * 8); ctx.scale(1, Math.max(.45, 1 - s * .4));
      ctx.drawImage(im, 3 * 260, 230, 260, 230, -130, -226, 260, 230); ctx.restore(); }
    if (s < 1) hiveFx(1, Math.min(4, Math.floor(s / .2)), f.x, f.y + 36, 1 - s, 1.4);
    return true;
  }
  return false;
}
// ---------- DANTE (Demolitionist): rocket launcher, Sky Barrage (E), Demo Ripple (Q) ----------
const dImgs = {};
for (const [k, url] of Object.entries({ place: "assets/sprites/zombies/dir8/dante-place.png", sky: "assets/sprites/zombies/dir8/dante-sky.png", rocket: "assets/sprites/fx/dante-rocket.png", demo: "assets/sprites/fx/dante-demo.png", scorch: "assets/sprites/fx/dante-scorch.png" })) { const im = new Image(); im.src = url; dImgs[k] = im; }
const danteAnim = new Map();   // player id -> { t0, a }: plays the crate-placing frames
const skyAnim = new Map();     // player id -> { t0, a }: Sky Barrage (launcher pointed at the sky)
const DEMO = { flight: 0.45, flat: 0.62, rings: [{ at: 0 }, { at: 0.4 }, { at: 0.8 }] };   // ring timing (matches the server; grenade spots come from the server)
function demoFrame(row, col, x, y, alpha = 1, scale = 1, rot = 0) {   // 130x110 cells, bottom-centre at (x, y)
  const im = dImgs.demo; if (!im?.naturalWidth) return; ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = alpha; ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.scale(scale, scale);
  ctx.drawImage(im, col * 130, row * 110, 130, 110, -65, -106, 130, 110); ctx.restore();
}
function rocketFrame(row, col, x, y, alpha = 1, scale = 1, rot = 0, left = false) {   // 140x130 cells: bottom-centre at (x, y), or left-middle for the flying rocket
  const im = dImgs.rocket; if (!im?.naturalWidth) return; ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = alpha; ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.scale(scale, scale);
  ctx.drawImage(im, col * 140, row * 130, 140, 130, left ? -100 : -70, left ? -65 : -126, 140, 130); ctx.restore();
}
function drawDantePlacing(p, now) {
  const s = skyAnim.get(p.sessionId), sa = s ? now - s.t0 : 1e9;
  if (sa < 620 && dImgs.sky.naturalWidth) {   // launcher at the sky: brace, three quick shots, lower it
    const col = sa < 70 ? 0 : sa < 520 ? 1 + Math.floor((sa - 70) / 75) % 2 : 3;
    ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(dImgs.sky, col * 150, octRow(s.a) * 124, 150, 124, -75, SPR.feet - 118, 150, 124); ctx.restore(); return true;
  }
  const d = danteAnim.get(p.sessionId), age = d ? now - d.t0 : 1e9; if (age > 520 || !dImgs.place.naturalWidth) return false;
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(dImgs.place, Math.min(3, Math.floor(age / 130)) * 150, octRow(d.a) * 100, 150, 100, -75, SPR.feet - 94, 150, 100); ctx.restore(); return true;
}
function drawDemoCrate(st) {
  if (st.deploy > 0.55) return;   // Dante is still putting it down (his placing frames show the crate)
  const now = performance.now(), armed = st.deploy <= 0;
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(st.x, st.y + 2, 22, 7, 0, 0, 7); ctx.fill(); ctx.restore();
  if (armed) {   // pulsing red danger ring on the ground
    const k = .5 + .5 * Math.sin(now / 160); ctx.save(); ctx.strokeStyle = `rgba(255,60,50,${.25 + .35 * k})`; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.ellipse(st.x, st.y, 110, 110 * DEMO.flat, 0, 0, 7); ctx.stroke(); ctx.restore();
  }
  demoFrame(6, armed ? Math.floor(now / 180) % 4 : 0, st.x, st.y + 6);
}
// ---------- BRIGGS: Iron Bastion (E) + War Cry (Q) ----------
const bImg = new Image(); bImg.src = "assets/sprites/fx/briggs-fx.png";
const BFX = { cw: 220, ch: 150 }, briggsAnim = new Map();   // id -> { k, t0, hitAt }
function bfxFrame(col, row, x, y, sc = 1, alpha = 1, flip = false) {   // (x, y) = bottom-centre of the frame
  if (!bImg.naturalWidth) return; ctx.save(); ctx.imageSmoothingEnabled = sc > 1.6; /* the big War Cry ring is scaled up a lot: smooth it */ ctx.globalAlpha = alpha; ctx.translate(Math.round(x), Math.round(y)); if (flip) ctx.scale(-1, 1);
  ctx.drawImage(bImg, col * BFX.cw, row * BFX.ch, BFX.cw, BFX.ch, -BFX.cw * sc / 2, -BFX.ch * sc, BFX.cw * sc, BFX.ch * sc); ctx.restore();
}
function onBriggs(m) {
  const t = performance.now(), a = briggsAnim.get(m.id) || {}, me = me_(), near = me && Math.hypot((m.x ?? me.x) - me.x, (m.y ?? me.y) - me.y) < 900;
  if (m.k === "bastion") { briggsAnim.set(m.id, { ...a, k: "bastion", t0: t, domeAt: t + 300 }); setTimeout(() => near && shake(7, 220), 300); }
  else if (m.k === "cry") {   // the roar lands 0.18s in: hit-stop, big shake, the shockwave ring
    briggsAnim.set(m.id, { ...a, k: "cry", t0: t });
    setTimeout(() => { fx.push({ type: "briggs", k: "ring", x: m.x, y: m.y, r: m.r, t: performance.now() }); if (near) { hitStopUntil = performance.now() + 70; shake(16, 520); } }, 180);
  }
  else if (m.k === "hit") briggsAnim.set(m.id, { ...a, hitAt: t, hitFlip: Math.random() < .5 });
  else if (m.k === "shatter") { fx.push({ type: "briggs", k: "shatter", x: m.x, y: m.y, t }); if (near) shake(10, 360); }
}
function briggsCast(p, now) {   // fist slam (E) / roar (Q) poses, 4 frames each
  const a = briggsAnim.get(p.sessionId); if (!a?.k) return null; const s = (now - a.t0) / 1000;
  if (a.k === "bastion" && s < .48) return { block: 4, col: Math.min(3, Math.floor(s / .12)) };
  if (a.k === "cry" && s < .62) return { block: 5, col: s < .08 ? 0 : s < .18 ? 1 : s < .5 ? 2 : 3 };
  return null;
}
// War Cry fire aura: back flames behind him + a burning ring in front, only while the Q buff lasts.
// What makes it look alive: frames swap fast (70ms), each player's fire runs on its own clock, the size/brightness
// flickers on two out-of-step waves, an additive glow pass makes the core burn bright, and embers float up.
const fireImg = new Image(); fireImg.src = "assets/sprites/fx/briggs-fire.webp";
const FIRE = { cw: 180, ch: 150, ms: 70, sc: .47 };
function bFireFrame(col, row, x, y, sx, sy, alpha, add) {   // (x, y) = bottom-centre
  ctx.save(); ctx.globalAlpha = alpha; if (add) ctx.globalCompositeOperation = "lighter"; ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fireImg, col * FIRE.cw, row * FIRE.ch, FIRE.cw, FIRE.ch, Math.round(x - FIRE.cw * sx / 2), Math.round(y - FIRE.ch * sy), FIRE.cw * sx, FIRE.ch * sy); ctx.restore();
}
function briggsFire(p, now, front) {
  if (!fireImg.naturalWidth) return;
  const id = p.sessionId || "", seed = (id.charCodeAt(0) || 0) * 37 + (id.charCodeAt(1) || 0) * 11, t = now + seed;
  const a = briggsAnim.get(p.sessionId), grow = a?.k === "cry" ? Math.min(1, Math.max(.15, (now - a.t0 - 120) / 260)) : 1;   // bursts up with the roar
  const ending = p.ultActive < .6 ? Math.max(0, p.ultActive / .6) : 1;   // dies down in the last half second
  const k = grow * ending, f = Math.floor(t / FIRE.ms) % 6, nf = (f + 1) % 6, mix = (t % FIRE.ms) / FIRE.ms;
  const flick = 1 + .05 * Math.sin(t / 47) + .035 * Math.sin(t / 23 + 1.3), sx = FIRE.sc * k * (1 + .02 * Math.sin(t / 61)), sy = FIRE.sc * k * flick;
  const feet = p.y + SPR.feet;
  if (!front) {
    ctx.save(); ctx.globalCompositeOperation = "lighter";   // warm light on the ground, pulsing
    const gl = ctx.createRadialGradient(p.x, feet, 2, p.x, feet, 70 * k); gl.addColorStop(0, `rgba(255,140,40,${.35 * flick * k})`); gl.addColorStop(1, "rgba(255,60,0,0)");
    ctx.fillStyle = gl; ctx.beginPath(); ctx.ellipse(p.x, feet, 70 * k, 26 * k, 0, 0, 7); ctx.fill(); ctx.restore();
    bFireFrame(f, 0, p.x, feet + 6, sx, sy, (1 - mix) * k + .0, false); bFireFrame(nf, 0, p.x, feet + 6, sx, sy, mix * k, false);   // cross-fade = smooth motion
    bFireFrame(f, 0, p.x, feet + 6, sx * 1.04, sy * 1.06, .3 * flick * k, true);   // bright additive glow pass
    return;
  }
  bFireFrame(f, 1, p.x, feet + 24, sx * 1.1, sy * .72, .85 * k, false); bFireFrame(f, 1, p.x, feet + 24, sx * 1.1, sy * .72, .2 * flick * k, true);   // squashed low so his legs stay visible
  ctx.save(); ctx.globalCompositeOperation = "lighter";   // embers drifting up
  for (let i = 0; i < 9; i++) {
    const ph = ((t / 1100 + i / 9) % 1), ex = p.x + Math.sin(i * 12.9 + seed) * 28 * k + Math.sin(t / 180 + i) * 5, ey = feet + 4 - ph * 80 * k;
    ctx.fillStyle = i % 3 ? `rgba(255,${150 + (i * 13) % 80},40,${(1 - ph) * .9 * k})` : `rgba(255,240,170,${(1 - ph) * k})`;
    const sz = i % 3 ? 2 : 3; ctx.fillRect(Math.round(ex), Math.round(ey), sz, sz);
  }
  ctx.restore();
}
function briggsDome(p, now) {   // the steel dome over him: forms, then a slow glowing loop; sparks where he gets hit
  const a = briggsAnim.get(p.sessionId) || {}, x = p.x, y = p.y + SPR.feet + 8, form = now - (a.domeAt || 0);
  if (form >= 0 && form < 300) return bfxFrame(Math.min(2, Math.floor(form / 100)), 0, x, y, .56, .85);
  if (now - (a.hitAt || 0) < 300) return bfxFrame(1 + Math.min(4, Math.floor((now - a.hitAt) / 60)), 1, x, y, .56, .8, a.hitFlip);
  bfxFrame(3 + Math.floor(now / 160) % 3, 0, x, y, .56, .78);
}
function drawBriggsFx(f, age) {   // false when finished
  const s = age / 1000;
  if (f.k === "ring") { if (s > .55) return false; const sc = (f.r || 350) * 2 / 200; ctx.save(); ctx.filter = "hue-rotate(60deg) saturate(1.2)"; /* the old pink shockwave -> fiery orange to match the aura */ bfxFrame(Math.min(5, Math.floor(s / .09)), 3, f.x, f.y + SPR.feet + BFX.ch * sc / 2, sc, .7 * (1 - Math.max(0, s - .35) / .2)); ctx.restore(); return true; }
  if (f.k === "shatter") { if (s > .6) return false; bfxFrame(Math.min(5, Math.floor(s / .1)), 2, f.x, f.y + SPR.feet + 8, .62); return true; }
  return false;
}
// ---------- ASTRA (dispatcher): E medics, Q police, R safehouse ----------
const aImgs = {};
for (const [k, url] of Object.entries({ police: "assets/sprites/dir8/astra-police.png", doctor: "assets/sprites/dir8/astra-doctor.png", worker: "assets/sprites/dir8/astra-worker.png", fx: "assets/sprites/fx/astra-fx.png", wallH: "assets/sprites/fx/astra-wall-h.png", wallV: "assets/sprites/fx/astra-wall-v.png" })) { const im = new Image(); im.src = url; aImgs[k] = im; }
const ASTRA_UNITS = new Set(["police", "doctor", "worker"]), SAFE = { half: 130, wall: 24, build: 5, life: 45, hits: 6 }, astraCall = new Map();   // matches the server
function onAstra(m) {
  const t = performance.now();
  if (m.k === "call") { astraCall.set(m.id, t); playVoice(m.id, m.s); }   // radio call: "Medic!" on E, "Cover me!" on Q
  else if (m.k === "cancel") astraCall.delete(m.id);
  else if (m.k === "arrive" || m.k === "leave") fx.push({ type: "astra", k: m.k, x: m.x, y: m.y, t });
  else if (m.k === "safeDown" || m.k === "safeCancel") fx.push({ type: "astra", k: "dismantle", x: m.x, y: m.y, t });
  else if (m.k === "wallHit") { fx.push({ type: "astra", k: "hit", x: m.x, y: m.y, t }); playSfx("zhit", m.x, m.y, 1.4); safeFlash.set(Math.round(m.x / 400) + "," + Math.round(m.y / 400), t); }
  else if (m.k === "wallFix") { fx.push({ type: "astra", k: "fix", x: m.x, y: m.y, t }); playSfx("repair", m.x, m.y, .6); }
  else if (m.k === "built") { fx.push({ type: "astra", k: "lock", x: m.x, y: m.y, t }); const me = me_(); if (me && Math.hypot(m.x - me.x, m.y - me.y) < 700) shake(6, 220); }
}
function astraFx(col, row, x, y, alpha = 1, sc = 1) {   // 96x64 cells: row 0 arrival beacon (centred on y), row 1 heal pulse (bottom on y)
  const im = aImgs.fx; if (!im.naturalWidth) return; ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = false;
  ctx.drawImage(im, col * 96, row * 64, 96, 64, Math.round(x - 48 * sc), Math.round(y - (row ? 64 : 32) * sc), 96 * sc, 64 * sc); ctx.restore();
}
function drawAstraFx(f, age) {   // false when finished
  if (f.k === "arrive" || f.k === "leave") { if (age > 400) return false; const c = Math.min(3, Math.floor(age / 100)); astraFx(f.k === "arrive" ? c : 3 - c, 0, f.x, f.y + 14, .9, .7); return true; }
  if (f.k === "lock") { if (age > 380) return false; ctx.save(); ctx.strokeStyle = `rgba(120,240,255,${1 - age / 380})`; ctx.lineWidth = 4; ctx.strokeRect(f.x - SAFE.half, f.y - SAFE.half, SAFE.half * 2, SAFE.half * 2); ctx.restore(); return true; }
  if (f.k === "hit") { if (age > 300) return false; const k = age / 300; ctx.save(); ctx.globalAlpha = 1 - k; ctx.fillStyle = "#cfc6b4"; for (let i = 0; i < 5; i++) { const a = i * 1.3 + f.x; ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * 18 * k, f.y - 10 + Math.sin(a) * 10 * k, 3 * (1 - k) + 1, 0, 7); ctx.fill(); } ctx.restore(); return true; }   // chips of concrete
  if (f.k === "fix") { if (age > 800) return false; ctx.save(); ctx.globalAlpha = 1 - age / 800; ctx.font = "bold 14px monospace"; ctx.textAlign = "center"; ctx.fillStyle = "#7dff9a"; ctx.strokeStyle = "#0b2a14"; ctx.lineWidth = 3; ctx.strokeText("+1", f.x, f.y - age / 30); ctx.fillText("+1", f.x, f.y - age / 30); ctx.restore(); return true; }   // a builder patched the wall
  if (f.k === "dismantle") { if (age > 600) return false; for (const pc of safePieces(f.x, f.y, 3, 1 - age / 600)) pc.draw(); return true; }
  return false;
}
const safeFlash = new Map();   // recent wall hits (bar flashes red)
function safeHpBar(st, cx, y) {   // 6 pips above the north wall: how many more hits the walls can take
  const n = st.maxHp || SAFE.hits, w = 14, gap = 3, x0 = cx - (n * (w + gap) - gap) / 2, hit = performance.now() - Math.max(0, ...[...safeFlash.values()]) < 160;
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(x0 - 3, y - 3, n * (w + gap) - gap + 6, 12);
  for (let i = 0; i < n; i++) { ctx.fillStyle = i < st.hp ? (hit ? "#ff8a7a" : st.hp <= 2 ? "#ff6b5b" : "#8ff0ff") : "rgba(255,255,255,.12)"; ctx.fillRect(x0 + i * (w + gap), y, w, 6); }
  ctx.restore();
}
function drawAstraShield() {   // Astra can't be hurt while his safehouse is being built: a cyan shield ring
  if (!state) return; const now = performance.now();
  for (const st of state.structures.values()) {
    if (st.kind !== "safehouse" || !(st.deploy > 0)) continue; const p = V(state.players.get(st.ownerId)); if (!p || !p.alive || !inView(p.x, p.y)) continue;
    ctx.save(); ctx.globalAlpha = .55 + .2 * Math.sin(now / 160); ctx.strokeStyle = "#8ff0ff"; ctx.lineWidth = 2.5; ctx.shadowColor = "#8ff0ff"; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.ellipse(p.x, p.y - 8, 24, 30, 0, 0, 7); ctx.stroke(); ctx.restore();
  }
}
function safeFrame(st) { return st.deploy > 0 ? (st.deploy > SAFE.build / 2 ? 0 : 1) : 2; }   // foundation, scaffold, complete
function safeAlpha(st) { return st.deploy <= 0 && st.life < 5 && Math.floor(performance.now() / 200) % 2 ? .45 : 1; }   // last 5 seconds: flashes
// The 4 walls as depth-sorted pieces (north/south: 4 tiles across; east/west: 3 tiles down), so people inside and outside sort right.
function safePieces(cx, cy, frame, alpha, st = null) {
  const H = SAFE.half, T = SAFE.wall, out = [], h = aImgs.wallH, v = aImgs.wallV;
  const nH = Math.max(2, Math.round(2 * H / 90)), tw = 2 * H / nH;   // north/south walls: tiles across
  const tileH = (x, base, i) => out.push({ y: base, draw: () => { if (!h.naturalWidth) return; const w = tw, hh = 46; ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = false; ctx.drawImage(h, frame * 112, 0, 112, 56, Math.round(x - w / 2), Math.round(base - hh), w, hh); ctx.restore();
    if (st && i === Math.floor(nH / 2) && base < cy) { ctx.save(); ctx.font = "bold 12px monospace"; ctx.textAlign = "center"; ctx.fillStyle = st.deploy > 0 ? "#ffd84d" : st.life < 5 ? "#ff6b5b" : "#8ff0ff"; ctx.fillText(st.deploy > 0 ? `BUILDING… ${Math.ceil(st.deploy)}s` : `SAFEHOUSE ${Math.ceil(st.life)}s`, cx, base - 66); ctx.restore(); if (st.deploy <= 0) safeHpBar(st, cx, base - 58); } } });
  for (let i = 0; i < nH; i++) { const x = cx - H + tw / 2 + i * tw; tileH(x, cy - H + T, i); tileH(x, cy + H, i); }
  const nV = Math.max(2, Math.round((2 * H - 2 * T) / 104)), len = (2 * H - 2 * T) / nV;
  for (const x of [cx - H + T / 2, cx + H - T / 2]) for (let i = 0; i < nV; i++) { const base = cy - H + T + (i + 1) * len;
    out.push({ y: base, draw: () => { if (!v.naturalWidth) return; const sc = len / 104, w = 48 * sc; ctx.save(); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = false; ctx.drawImage(v, frame * 48, 0, 48, 104, Math.round(x - w / 2), Math.round(base - len), w, len); ctx.restore(); } }); }
  return out;
}
function drawAstraGround() {   // safehouse floor / footprint + green heal pulses under patients
  const now = performance.now();
  for (const st of state.structures.values()) {
    if (st.kind !== "safehouse" || !inView(st.x, st.y, 260)) continue;
    const H = SAFE.half; ctx.save();
    if (st.deploy > 0) { ctx.setLineDash([10, 8]); ctx.strokeStyle = "rgba(120,240,255,.7)"; ctx.lineWidth = 2; ctx.strokeRect(st.x - H, st.y - H, H * 2, H * 2); }
    else { ctx.fillStyle = "rgba(90,210,255,.07)"; ctx.fillRect(st.x - H + SAFE.wall, st.y - H + SAFE.wall, 2 * (H - SAFE.wall), 2 * (H - SAFE.wall)); if (st.life < 5 || st.hp <= 1) { ctx.strokeStyle = `rgba(255,90,80,${.4 + .4 * (Math.floor(now / 200) % 2)})`; ctx.lineWidth = 3; ctx.strokeRect(st.x - H, st.y - H, H * 2, H * 2); } }
    ctx.restore();
  }
  for (const [, h] of healing()) regenKeep(h.tgt);   // Astra's medic: the regen effect loops on the patient
}
// ALL healing (Astra's medic, Viktor's support robot, medkits) shows one effect: sprites/fx/regen.png (the user's "health regen"
// sheet, tools/art/regen): 51 frames 128x128 in a row, two green arcs rise round the body, close over the head, collapse into a
// spark and a "+" fades; the arcs' base (cell y 111) sits at the feet. Healing that goes on loops it; a medkit plays it once.
const regenImg = new Image(); regenImg.src = "assets/sprites/fx/regen.png";
const REGEN = { n: 51, ms: 30, cell: 128, feet: 111, sc: .9 }, regens = new Map();   // player id -> when its effect started
const regenLen = () => REGEN.n * REGEN.ms;
function regenPlay(id, restart = false) { const now = performance.now(), t = regens.get(id); if (restart || t === undefined || now - t > regenLen() * .7) regens.set(id, now); }
function regenKeep(id) { const now = performance.now(), t = regens.get(id); if (t === undefined || now - t >= regenLen()) regens.set(id, now); }   // continuous healing: start again when one finishes
function drawRegen(p, age, front) {   // front: the arcs' near halves + the spark / cross; behind: a soft layer so the body stays visible
  if (!regenImg.naturalWidth) return;
  const f = Math.min(REGEN.n - 1, Math.floor(age / REGEN.ms)), C = REGEN.cell, sc = REGEN.sc, x = p.x - C * sc / 2, y = p.y + SPR.feet - REGEN.feet * sc;
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = front ? .95 : .5;
  ctx.drawImage(regenImg, f * C, 0, C, C, x, y, C * sc, C * sc);
  if (front) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = .35; ctx.drawImage(regenImg, f * C, 0, C, C, x, y, C * sc, C * sc); }   // glow
  ctx.restore();
}
const healSeen = new Map();   // doctor id -> { tgt, t: when this heal started (burst), last: last frame seen healing }
function healing() {   // doctors healing right now, with when each heal started
  const now = performance.now(), live = new Set();
  if (state.robots) for (const r of state.robots.values()) {
    if (r.kind !== "doctor" || r.act !== "heal" || !r.tgt) continue;
    live.add(r.id); let h = healSeen.get(r.id);
    if (!h || h.tgt !== r.tgt || now - h.last > 1000) { h = { tgt: r.tgt, t: now, last: now }; healSeen.set(r.id, h); }   // a new patient (or back after a break): burst again
    h.last = now;
  }
  for (const [id, h] of healSeen) if (!live.has(id) && now - h.last > 1000) healSeen.delete(id);
  return [...healSeen].filter(([id]) => live.has(id));
}
function healOverlays(items) {   // the regen effect on everyone being healed, sorted with them
  const now = performance.now();
  for (const [id, t] of regens) {
    const age = now - t; if (age >= regenLen()) { regens.delete(id); continue; }
    const p0 = state.players.get(id), pt = V(p0); if (!pt || !p0.alive || !inView(pt.x, pt.y, 120)) continue;
    items.push({ y: pt.y + 11, draw: () => drawRegen(pt, age, false) });
    items.push({ y: pt.y + 13, draw: () => drawRegen(pt, age, true) });
  }
}
function drawAstraUnit(r) {   // police / doctors / workers: 8-direction sheets like the survivors (idle, walk x3, action x2)
  const now = performance.now(), im = aImgs[r.kind]; let mv = robotMove.get(r.id);
  if (!mv) { mv = { x: r.x, y: r.y, at: 0, dist: 0 }; robotMove.set(r.id, mv); }
  const step = Math.hypot(r.x - mv.x, r.y - mv.y); if (step > .4) { mv.at = now; mv.dist += step; mv.x = r.x; mv.y = r.y; }
  let col = now - mv.at < 160 ? 1 + Math.floor(mv.dist / 14) % 3 : 0;
  if (r.act === "shoot") col = now - (machineShotAt.get(r.id) || 0) < 90 ? 5 : 4;
  else if (r.act === "heal" || r.act === "build") col = 4 + Math.floor(now / 220) % 2;
  const oct = ((Math.round((r.aim || 0) / (Math.PI / 4)) % 8) + 8) % 8;
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(r.x, r.y + 17, 13, 4, 0, 0, 7); ctx.fill(); ctx.restore();
  if (im?.naturalWidth) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(im, col * D8.cellW, ROW_OF_OCT[oct] * D8.cellH, D8.cellW, D8.cellH, Math.round(r.x - D8.anchorX), Math.round(r.y + SPR.feet - D8.feetY), D8.cellW, D8.cellH); ctx.restore(); }
  if (r.kind !== "worker") machineHp(r, 26, r.y - 44);
}
// ---------- SOFEA: tank (E) + helicopter (Q) ----------
const sImgs = {};
for (const [k, url] of Object.entries({ tank: "assets/sprites/zombies/dir8/sofea-tank.png", heli: "assets/sprites/zombies/dir8/sofea-heli.png", fx: "assets/sprites/fx/sofea-fx.png", gun: "assets/sprites/fx/sofea-gun.webp",
  mecha: "assets/sprites/dir8/sofea-mecha.webp", mechaTf: "assets/sprites/dir8/sofea-mecha-tf.webp", flame: "assets/sprites/fx/sofea-flame.webp" })) { const im = new Image(); im.src = url; sImgs[k] = im; }
const SOF = { tank: { cw: 180, ch: 150, lift: 10, tur: 16, barrel: 70 }, heli: { cw: 190, ch: 150, alt: 46 }, fx: 128 };   // tank sheet: col 0 = hull, col 1 = cannon out (one whole tank per direction)
const sofeaShotAt = new Map();
function sofeaCell(im, cw, ch, col, row, x, y, alpha = 1, sc = 1) {
  if (!im?.naturalWidth) return; ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = alpha;
  ctx.drawImage(im, col * cw, row * ch, cw, ch, Math.round(x - cw * sc / 2), Math.round(y - ch * sc / 2), cw * sc, ch * sc); ctx.restore();
}
// Sofea calling on the radio, or riding her tank / helicopter, instead of the normal walking sprite. p = smoothed player.
function drawSofea(p, img, now) {
  const v = state?.vehicles?.get(p.sessionId);
  if (!v) { const o = mechaOut.get(p.sessionId); if (!o || now - o.t > MECHA.outMs) return false; drawMechaTf(p, o.row, 1 - (now - o.t) / MECHA.outMs); return true; }   // stepping out: the transformation backwards
  const aim = p.sessionId === myId ? aimAngle(p) : v.aim;
  if (v.kind === "mecha") { drawMecha(p, v, aim, now); return true; }
  if (v.phase === "call") {   // radio call: reach, radio, confirm, release
    const col = Math.min(3, Math.floor((1 - v.left / .8) * 4)), row = ROW_OF_OCT[((Math.round(aim / (Math.PI / 4)) % 8) + 8) % 8];
    ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, col * D8.cellW, (4 * 8 + row) * D8.cellH, D8.cellW, D8.cellH, -D8.anchorX, SPR.feet - D8.feetY, D8.cellW, D8.cellH); ctx.restore();
    return true;
  }
  const fired = now - (sofeaShotAt.get(p.sessionId) || 0);
  if (v.kind === "tank") {
    const T = SOF.tank, gy = p.y + T.lift;
    ctx.save(); ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(p.x, gy + 18, 62, 26, 0, 0, 7); ctx.fill(); ctx.restore();
    const face = v.mv && fired > 900 ? v.hull : aim, kick = fired < 120 ? 3 * (1 - fired / 120) : 0;   // the whole tank swings to where she aims; it recoils when it fires
    const tread = v.mv ? (Math.floor(now / 70) % 2 ? 1 : 0) : 0;
    sofeaCell(sImgs.tank, T.cw, T.ch, 1, rowOf(face), p.x - Math.cos(face) * kick, gy - tread - Math.sin(face) * kick);
  } else {
    const H = SOF.heli, bob = Math.sin(now / 380) * 3;
    ctx.save(); ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(p.x, p.y + 16, 46, 16, 0, 0, 7); ctx.fill(); ctx.restore();
    if (v.phase === "ride") heliGunFx(p, aim, now, bob, true);   // cone + tracers + impacts under / in front of the body
    sofeaCell(sImgs.heli, H.cw, H.ch, Math.floor(now / 45) % 4, rowOf(aim), p.x, p.y - H.alt + bob);
    if (v.phase === "ride") heliGunFx(p, aim, now, bob, false);   // muzzle flash on top
  }
  return true;
}
// ---- Sofea's R mecha "Crimson Aegis" (art: tools/extract-mecha.py) ----
// sofea-mecha.webp: 8 rows (dir8 order) x 6 cols (idle, walk 1-3, flame pose, saber slash), cells 224x192, feet at (112, 186)
// sofea-mecha-tf.webp: 5 rows (front, front-left, left, right, back) x 8 frames of the transformation, same cells
// sofea-flame.webp: 22 frames 208x112 pointing RIGHT, nozzle at (4, 56): 0-7 ignite, 8-13 loop, 14-21 cut off
const MECHA = { cw: 160, ch: 128, ax: 80, fy: 120, call: 1, outMs: 650, range: 190, saber: 155, swing: 900,   // 80px tall = 1.5x a survivor
  nozzle: [[-4, -24], [23, -32], [28, -47], [27, -49], [-2, -45], [-28, -49], [-29, -47], [-22, -31]],   // per direction, from the feet
  tfRow: [0, 0, 3, 4, 4, 4, 2, 1] };   // which transformation angle each facing uses
const mechaOut = new Map(), mechaSlash = new Map(), mechaFlame = new Map(), mechaCall = new Map(), mechaLate = [];
// draws frame f of a strip, cross-fading into frame f2 by k (0..1): smooth in-betweens for the transformation / flame
function blendCells(im, sx, sy, cw, ch, f, f2, k, dx, dy, dw = cw, dh = ch) {
  ctx.drawImage(im, sx + f * cw, sy, cw, ch, dx, dy, dw, dh);
  if (k > .04 && f2 !== f) { const a = ctx.globalAlpha; ctx.globalAlpha = a * k; ctx.drawImage(im, sx + f2 * cw, sy, cw, ch, dx, dy, dw, dh); ctx.globalAlpha = a; }
}   // per player: stepping out, last saber swing, flame state
const mechaFiring = (p, v) => v.phase === "ride" && (p.sessionId === myId ? heliTrigger() && performance.now() - (mechaSlash.get(myId)?.t || 0) > MECHA.swing : !!v.fire);
function drawMechaTf(p, row, u) {   // u: 0 = Sofea, 1 = mecha
  const im = sImgs.mechaTf; if (!im?.naturalWidth) return;
  u = Math.max(0, Math.min(1, u)); const t = u * 7, f = Math.floor(t), tr = MECHA.tfRow[row], feet = Math.round(p.y + SPR.feet);
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.32)"; ctx.beginPath(); ctx.ellipse(p.x, feet - 1, 14 + 11 * u, 4 + 3 * u, 0, 0, 7); ctx.fill();
  if (u > .05 && u < .97) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = .55 * Math.sin(u * Math.PI); const g = ctx.createRadialGradient(p.x, feet - 34, 3, p.x, feet - 34, 48); g.addColorStop(0, "#ffb27a"); g.addColorStop(1, "rgba(255,60,40,0)"); ctx.fillStyle = g; ctx.fillRect(p.x - 52, feet - 86, 104, 92); }
  ctx.restore();
  ctx.save(); ctx.imageSmoothingEnabled = false; blendCells(im, 0, tr * MECHA.ch, MECHA.cw, MECHA.ch, f, Math.min(7, f + 1), t - f, Math.round(p.x - MECHA.ax), feet - MECHA.fy); ctx.restore();
}
function drawMecha(p, v, aim, now) {
  const row = rowOf(aim);
  if (v.phase === "call") {   // timed here (not from the synced v.left, which only updates ~20 times a second) so it plays smoothly
    let c = mechaCall.get(p.sessionId); if (!c) { c = now - Math.max(0, 1 - v.left / MECHA.call) * MECHA.call * 1000; mechaCall.set(p.sessionId, c); }
    drawMechaTf(p, row, (now - c) / (MECHA.call * 1000)); return; }
  mechaCall.delete(p.sessionId);
  const im = sImgs.mecha, feet = Math.round(p.y + SPR.feet), sl = mechaSlash.get(p.sessionId), sAge = sl ? now - sl.t : 1e9;
  const fire = mechaFiring(p, v); let fs = mechaFlame.get(p.sessionId);
  if (!fs) { fs = { on: false, at: 0 }; mechaFlame.set(p.sessionId, fs); }
  if (fire !== fs.on) { fs.on = fire; fs.at = now; }
  const swingRow = sAge < MECHA.swing ? rowOf(sl.a) : row;
  // atlas columns (v2 robot-head art): 0-1 idle, 2-5 walk, 6-7 flamethrower, 8-11 saber (wind-up, mid, follow-through, recover)
  let col, bob = 0;
  if (sAge < 760) col = sAge < 110 ? 8 : sAge < 260 ? 9 : sAge < 520 ? 10 : 11;
  else if (fire || now - fs.at < 200) col = 6 + Math.floor(now / 110) % 2;   // braced, a little recoil
  else if (v.mv) col = 2 + Math.floor(now / 120) % 4;
  else col = Math.floor(now / 520) % 2;
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(p.x, feet - 1, 25, 7, 0, 0, 7); ctx.fill(); ctx.restore();
  const flameBehind = Math.sin(aim) < -.35;
  if (flameBehind) drawMechaFlame(p, aim, row, feet, fs, now);
  if (im?.naturalWidth) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(im, col * MECHA.cw, swingRow * MECHA.ch, MECHA.cw, MECHA.ch, Math.round(p.x - MECHA.ax), feet - MECHA.fy + bob, MECHA.cw, MECHA.ch); ctx.restore(); }
  if (!flameBehind) mechaLate.push(() => drawMechaFlame(p, aim, row, feet, fs, now));   // over the zombies it's burning (drawn after all sprites)
  if (sAge < 480) drawSaberSweep(p, sl.a, sAge, feet);
}
function drawMechaFlame(p, aim, row, feet, fs, now) {   // the jet from her arm's nozzle to the ground 190px out where she aims
  const im = sImgs.flame; if (!im?.naturalWidth) return;
  const age = now - fs.at; let t, f, f2;   // t = position in frames; each frame cross-fades into the next
  // sofea-flame.webp (tools/bake-flamethrower.py, Vefects fire VFX): 0-7 ignite, 8-19 loop, 20-27 cut off; 208x160 cells, nozzle at (4, 80)
  if (fs.on) { if (age < 200) { t = age / 25; f = Math.floor(t); f2 = Math.min(8, f + 1); } else { t = (age - 200) / 40; f = 8 + Math.floor(t) % 12; f2 = 8 + (Math.floor(t) + 1) % 12; } }
  else { if (age > 300 || !fs.at) return; t = age / 37; f = 20 + Math.min(7, Math.floor(t)); f2 = Math.min(27, f + 1); }
  const [nx, ny] = MECHA.nozzle[row], ox = p.x + nx, oy = feet + ny;
  const tx = p.x + Math.cos(aim) * MECHA.range, ty = p.y + Math.sin(aim) * MECHA.range * .92;   // ground point at the end of the cone
  const L = Math.max(60, Math.hypot(tx - ox, ty - oy)), ang = Math.atan2(ty - oy, tx - ox), sc = L / 190;   // the full jet is ~190px long in the art
  ctx.save(); ctx.translate(ox, oy); ctx.rotate(ang);
  ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = .35;   // hot glow on the ground under the jet
  const g = ctx.createRadialGradient(L * .6, 0, 4, L * .6, 0, L * .55); g.addColorStop(0, "#ff9a3c"); g.addColorStop(1, "rgba(255,80,20,0)"); ctx.fillStyle = g; ctx.fillRect(0, -L * .6, L * 1.2, L * 1.2);
  ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
  blendCells(im, 0, 0, 208, 160, f, f2, t - Math.floor(t), -4 * sc, -80 * sc, 208 * sc, 160 * sc);   // a wide cone (~42 degrees, like the damage)
  ctx.restore();
}
function drawSaberSweep(p, a, age, feet) {   // a bright green crescent sweeping 120 degrees, 155px
  const u = Math.min(1, age / 260), fade = age < 260 ? 1 : Math.max(0, 1 - (age - 260) / 220), cy = feet - 70, R = MECHA.saber;
  const a0 = a - Math.PI / 3, a1 = a0 + (Math.PI * 2 / 3) * u;
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
  for (const [w, c, al] of [[18, "#1fff6a", .22], [8, "#5dff9a", .55], [3, "#eafff0", .95]]) {
    ctx.globalAlpha = al * fade; ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.ellipse(p.x, cy + 40, R * .92, R * .62, 0, Math.max(a0, a1 - 1.3), a1); ctx.stroke();
  }
  ctx.restore();
}
// Sofea's helicopter machine gun (fires the whole ride; the server hits every zombie in a 90-degree cone, 420px, where she aims).
// sprites/fx/sofea-gun.webp (tools/extract-heli-gun.py): row 0 muzzle flash 128x64 (tip at 6,32), row 1 tracers 192x40, row 2 impact 96x72.
const HGUN = { cone: Math.PI / 2, range: 250, every: 16 }, heliShots = new Map();   // per helicopter: { at, snd, list: [{ t, tx, ty }] }
function heliMuzzle(p, a, bob) { return { x: p.x + Math.cos(a) * 50, y: p.y - SOF.heli.alt + bob + 12 + Math.sin(a) * 28 }; }
const heliTrigger = () => firing && !anyPanelOpen() && !wheel;   // you're holding the helicopter gun's trigger (left mouse)
function heliFiring(p) { const v = state?.vehicles?.get(p.sessionId); return !!v && v.phase === "ride" && (p.sessionId === myId ? heliTrigger() : !!v.fire); }   // yours: instant; others: from the server
function heliGunFx(p, a, now, bob, under) {
  const im = sImgs.gun, mz = heliMuzzle(p, a, bob); let g = heliShots.get(p.sessionId);
  if (!g) { g = { at: 0, snd: 0, list: [] }; heliShots.set(p.sessionId, g); }
  const on = heliFiring(p); heliLoop(p, on);
  if (!under) {   // flickering muzzle flash pointing where she aims (only while firing)
    if (!on) return;
    if (!im?.naturalWidth) return; const f = 3 + Math.floor(Math.random() * 5);
    ctx.save(); ctx.translate(mz.x, mz.y); ctx.rotate(a); ctx.drawImage(im, f * 128, 0, 128, 64, -4, -20, 80, 40); ctx.restore(); return;
  }
  if (on && now - g.at > HGUN.every) {   // a burst: 2 tracers (slight spread), mostly at zombies in the cone, otherwise at the ground
    g.at = now; const inCone = [];
    for (const z0 of state.zombies.values()) { const z = V(z0), d = Math.hypot(z.x - p.x, z.y - p.y); let da = Math.atan2(z.y - p.y, z.x - p.x) - a; da = Math.atan2(Math.sin(da), Math.cos(da)); if (d < HGUN.range && Math.abs(da) < HGUN.cone / 2) inCone.push(z); }
    for (let k = 0; k < 2; k++) {
      let tx, ty;
      if (inCone.length && Math.random() < .75) { const z = inCone[Math.floor(Math.random() * inCone.length)]; tx = z.x + (Math.random() - .5) * 18; ty = z.y + (Math.random() - .5) * 12; }
      else { const aa = a + (Math.random() - .5) * HGUN.cone * .8, d = 50 + Math.random() * (HGUN.range - 60); tx = p.x + Math.cos(aa) * d; ty = p.y + Math.sin(aa) * d; }
      g.list.push({ t: now + k * 8, tx, ty, imp: Math.random() < .5, f0: Math.floor(Math.random() * 3) }); if (g.list.length > 80) g.list.shift();
    }
  }
  if (!im?.naturalWidth) return;
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  for (const s of g.list) {   // tracers + a bright bullet streak racing along each one
    const age = now - s.t; if (age < 0 || age > 110) continue;
    const L = Math.hypot(s.tx - mz.x, s.ty - mz.y), ang = Math.atan2(s.ty - mz.y, s.tx - mz.x), f = Math.min(7, s.f0 + Math.floor(age / 14));
    ctx.save(); ctx.translate(mz.x, mz.y); ctx.rotate(ang); ctx.globalAlpha = .85; ctx.drawImage(im, f * 192, 64, 192, 40, 0, -8, L, 16);
    const u = Math.min(1, age / 55), hx = L * u; if (u < 1) { ctx.globalAlpha = 1; ctx.fillStyle = "#fff3c4"; ctx.fillRect(hx - 20, -1.6, 20, 3.2); ctx.fillStyle = "#ffb347"; ctx.fillRect(hx - 38, -1.1, 18, 2.2); }
    ctx.restore();
  }
  ctx.restore();
  for (const s of g.list) {   // dust + sparks where about half of them hit
    const age = now - s.t; if (!s.imp || age < 55 || age > 360) continue;
    const f = Math.min(7, Math.floor((age - 55) / 38)); ctx.drawImage(im, f * 96, 104, 96, 72, s.tx - 20, s.ty - 28, 40, 30);
  }
}
function drawSofeaFx(f, age) {   // false when finished
  const s = age / 1000, F = SOF.fx;
  if (f.k === "proj") {   // cannon shell / helicopter rocket flying to its target (the blast comes from the server's "boom")
    const u = s / f.dur; if (u > 1) return false;
    const lift = f.kind === "heli" ? SOF.heli.alt * (1 - u) : SOF.tank.tur - SOF.tank.lift + 4 * (1 - u);
    const x = f.ox + (f.bx - f.ox) * u, y = f.oy + (f.by - f.oy) * u - lift, a = Math.atan2(f.by - f.oy + lift, f.bx - f.ox);
    const im = sImgs.fx; if (!im?.naturalWidth) return true;
    const row = f.kind === "heli" ? 1 : 0, col = Math.floor(age / 60) % 6;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.imageSmoothingEnabled = false; ctx.drawImage(im, col * F, row * F, F, F, -F / 2, -F / 2, F, F); ctx.restore();
    return true;
  }
  if (f.k === "boom") {   // tank shell: big explosion; rocket: small one (flash, fireball, smoke, embers / crater)
    const big = f.kind !== "hrocket", len = big ? .9 : .7; if (s > len) return false; const sc = (f.r || 100) / (big ? 82 : 64);
    sofeaCell(sImgs.fx, F, F, Math.min(5, Math.floor(s / (len / 6))), big ? 3 : 4, f.x, f.y - F * sc / 2 + 10, s > len - .15 ? (len - s) / .15 : 1, sc);
    return true;
  }
  if (f.k === "muzzle") {   // cannon blast / rocket launch puff at the barrel, rotated to the shot
    const big = f.kind === "tank", len = .24; if (s > len) return false; const im = sImgs.fx; if (!im?.naturalWidth) return true;
    const col = (big ? 0 : 3) + Math.min(2, Math.floor(s / (len / 3))), sc = big ? .8 : .55;
    ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.a); ctx.imageSmoothingEnabled = false; ctx.drawImage(im, col * F, 2 * F, F, F, -F * sc / 2, -F * sc / 2, F * sc, F * sc); ctx.restore();
    return true;
  }
  if (f.k === "dust") { if (s > .6) return false; sofeaCell(sImgs.fx, F, F, Math.min(5, Math.floor(s / .1)), 5, f.x, f.y, 1, f.s || 1); return true; }
  return false;
}
function drawDanteFx(f, age) {   // false when finished
  const s = age / 1000;
  if (f.k === "rocket") {   // a launcher rocket flying in a straight line to where it will explode
    const fl = f.fl || .3, u = s / fl; if (u > 1) return false; const a = f.a[0], len = f.len[0];
    if (s < .3) rocketFrame(4, Math.min(3, Math.floor(s / .075)), f.x + Math.cos(a) * 22, f.y + Math.sin(a) * 14 + 16, 1 - s / .3, .6);
    rocketFrame(0, Math.floor(age / 60) % 4, f.x + Math.cos(a) * (18 + (len - 18) * u), f.y + Math.sin(a) * (18 + (len - 18) * u), 1, .62, a, true);
    return true;
  }
  if (f.k === "boom") {   // rocket / sky rocket explosion (damage is on the server)
    if (s > 1.1) return false; const sc = Math.max(.7, (f.r || 80) / 70);
    if (s < .45) demoFrame(3, Math.min(5, Math.floor(s / .075)), f.x, f.y + 10, 1, sc); else demoFrame(5, Math.min(3, Math.floor((s - .45) / .16)), f.x, f.y + 10, 1 - (s - .45) / .65, sc * .9);
    return true;
  }
  if (f.k === "sky") {   // 3 rockets go up from Dante one by one, then dive onto their spots (markers blink while they fall)
    const total = (f.pts.length - 1) * f.gap + f.fl; if (s > total + .05) return false;
    f.pts.forEach(([x, y], i) => {
      const t = s - i * f.gap; if (t < 0) return;
      const up = .38;   // seconds going up (rest of the flight: coming down)
      if (t < up) { const k = t / up; rocketFrame(1, Math.min(3, Math.floor(k * 4)), f.x + (i - 1) * 6, f.y - 30 - k * 260, 1 - k * .6, .7); }
      if (t < f.fl) {
        rocketFrame(3, Math.floor(age / 90) % 4, x, y + 12, .85, .8);
        if (t > up) { const k = (t - up) / (f.fl - up); rocketFrame(2, Math.min(3, Math.floor(k * 4)), x, y - (1 - k) * 340, 1, .7); }
      }
    });
    return true;
  }
  if (f.k === "ripple") {
    if (s > 2.6) return false;
    if (s < .5) demoFrame(0, 3 + Math.min(2, Math.floor(s / .16)), f.x, f.y + 6);        // the crate bursts
    if (s < .45) demoFrame(3, Math.min(5, Math.floor(s / .075)), f.x, f.y + 10, 1, 1.7); // big blast at the crate
    else if (s < 1.6) demoFrame(5, Math.min(3, Math.floor((s - .45) / .28)), f.x, f.y + 10, 1 - (s - .45) / 1.2, 1.3);
    for (const [tx, ty, ri, big] of f.pts || []) {   // each grenade flies out of the crate in an arc to its (scattered) spot, then blows
      const ring = DEMO.rings[ri], u = (s - ring.at) / DEMO.flight, sc = big ? (ri === 0 ? 1 : .85) : .6;
      if (u < 0) continue;
      if (u < 1) {
        demoFrame(2, Math.min(2, Math.floor(u * 3)), tx, ty + 6, .9, sc);
        const dist = Math.hypot(tx - f.x, ty - f.y), gx = f.x + (tx - f.x) * u, gy = f.y + (ty - f.y) * u - Math.sin(Math.PI * u) * (36 + dist * .22);
        demoFrame(1, Math.floor(age / 70) % 4, gx, gy + 40 * sc, 1, sc * .8, Math.atan2(ty - f.y, tx - f.x));
      } else {
        const e = (u - 1) * DEMO.flight;
        if (!big) { if (e < .4) demoFrame(4, Math.min(4, Math.floor(e / .08)), tx, ty + 8, 1, .85); else if (e < 1.1) demoFrame(5, 3, tx, ty + 8, 1 - (e - .4) / .7, .7); }
        else { if (e < .45) demoFrame(3, Math.min(5, Math.floor(e / .075)), tx, ty + 8, 1, sc); else if (e < 1.2) demoFrame(5, Math.min(3, Math.floor((e - .45) / .2)), tx, ty + 8, 1 - (e - .45) / .75, sc * .9); }
      }
    }
    return true;
  }
  return false;
}
// ---------- RAVEN (Scout): Shadow Pass dash, invisibility, burning katana, Blade Storm ----------
const rImgs = {};
for (const [k, url] of Object.entries({ dash: "assets/sprites/zombies/dir8/raven-dash.png", shadow: "assets/sprites/fx/raven-shadow.png", fire: "assets/sprites/fx/raven-fire.png" })) { const im = new Image(); im.src = url; rImgs[k] = im; }
const ravenDash = new Map();   // player id -> { t0, a }: plays the dash frames
const octRow = a => ROW_OF_OCT[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
function ravenHidden(p) { ctx.globalAlpha = p.sessionId === myId ? .38 : .1; ctx.filter = "saturate(.4) brightness(.75) hue-rotate(20deg)"; }
function shadowFrame(row, col, x, y, alpha = 1, flip = false, scale = 1) {   // 140x100 cells, bottom-centre at (x, y)
  const im = rImgs.shadow; if (!im?.naturalWidth) return; ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = alpha; ctx.translate(x, y); if (flip) ctx.scale(-1, 1); ctx.scale(scale, scale);
  ctx.drawImage(im, col * 140, row * 100, 140, 100, -70, -96, 140, 100); ctx.restore();
}
function fireFrame(row, col, x, y, alpha = 1, scale = 1) {   // 120x90 cells, bottom-centre at (x, y)
  const im = rImgs.fire; if (!im?.naturalWidth) return; ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = alpha; ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.drawImage(im, col * 120, row * 90, 120, 90, -60, -86, 120, 90); ctx.restore();
}
function drawRavenSpecial(p, img, now) {
  const d = ravenDash.get(p.sessionId), age = d ? now - d.t0 : 1e9;
  if (age < 300 && rImgs.dash.naturalWidth) {   // Shadow Pass dash frames
    ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(rImgs.dash, Math.min(3, Math.floor(age / 75)) * 150, octRow(d.a) * 100, 150, 100, -75, SPR.feet - 94, 150, 100); ctx.restore(); return true;
  }
  if (p.storm > 0 && p.alive) {   // Blade Storm: spinning through all 8 directions with the slash frame, purple blades circling
    const spin = now / 55, row = ROW_OF_OCT[Math.floor(spin) % 8], block = Math.max(0, dir8Block(p) || DIR8.scout.blocks.indexOf("katana"));
    shadowFrame(0, 2, p.x, p.y + 22, .55, false, 1.3);
    ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 5 * D8.cellW, (block * 8 + row) * D8.cellH, D8.cellW, D8.cellH, -D8.anchorX, SPR.feet - D8.feetY, D8.cellW, D8.cellH); ctx.restore();
    const im = rImgs.shadow;
    if (im?.naturalWidth) for (let i = 0; i < 3; i++) {
      const ang = now / 110 + i * Math.PI * 2 / 3; ctx.save(); ctx.translate(p.x + Math.cos(ang) * 62, p.y - 6 + Math.sin(ang) * 34); ctx.rotate(ang + Math.PI / 2); ctx.globalAlpha = .85; ctx.imageSmoothingEnabled = false;
      ctx.drawImage(im, 140, 100, 140, 100, -50, -36, 100, 72); ctx.restore();
      if (p.fire > 0) fireFrame(1, 1, p.x + Math.cos(ang + .5) * 60, p.y + Math.sin(ang + .5) * 34 + 20, .7, .6);
    }
    return true;
  }
  return false;
}
function drawBurning(z, stacks) {   // a zombie on fire: bigger flames for more burn stacks
  const now = performance.now(), off = (z.id?.charCodeAt?.(z.id.length - 1) || 0) * 37;
  fireFrame(2, Math.floor((now + off) / 90) % 6, z.x, z.y + (z.radius || 14) * 0.9, .9, .55 + .12 * Math.min(5, stacks));
}
function drawRavenFx(f, age) {   // false when finished
  if (f.k === "dash") {
    if (age > 520) return false;
    shadowFrame(0, Math.min(3, Math.floor(age / 80)), f.x, f.y + 20, 1 - age / 520);
    const flip = Math.cos(f.a) < 0;
    for (const u of [.25, .5, .75]) { const k = age / 520; shadowFrame(2, Math.min(3, Math.floor(age / 130)), f.x + Math.cos(f.a) * f.len * u, f.y + Math.sin(f.a) * f.len * u + 18, (1 - k) * .8, flip); }
    return true;
  }
  if (f.k === "vanish") { if (age > 480) return false; shadowFrame(3, Math.min(3, Math.floor(age / 120)), f.x, f.y + 20); return true; }
  if (f.k === "ignite") {
    if (age > 520) return false;
    if (age < 320) shadowFrame(4, Math.min(3, Math.floor(age / 80)), f.x, f.y + 20);
    fireFrame(0, Math.min(4, Math.floor(age / 100)), f.x, f.y + 20, 1, 1.1); return true;
  }
  if (f.k === "fireArc") {
    if (age > 220) return false; const im = rImgs.fire; if (!im?.naturalWidth) return false;
    ctx.save(); ctx.translate(f.x + Math.cos(f.a) * 34, f.y + Math.sin(f.a) * 22); ctx.rotate(f.a); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, Math.min(3, Math.floor(age / 55)) * 120, 90, 120, 90, -40, -45, 110, 82); ctx.restore(); return true;
  }
  if (f.k === "crit") {
    if (age > 500) return false; const k = age / 500;
    ctx.save(); ctx.globalAlpha = 1 - k; ctx.font = "bold 14px monospace"; ctx.textAlign = "center"; ctx.fillStyle = "#d9b8ff"; ctx.shadowColor = "#7a3cff"; ctx.shadowBlur = 8;
    ctx.fillText("CRIT!", f.x + Math.cos(f.a) * 40, f.y - 30 - 16 * k); ctx.restore(); return true;
  }
  return false;
}
function drawViktorFx(f, age) {   // false when finished
  const F = vImgs.fx;
  if (f.type === "wreck") {
    if (age > 4500) return false;
    const a = age > 3200 ? 1 - (age - 3200) / 1300 : 1, fr = Math.min(3, Math.floor(age / 140));
    if (f.kind === "turret") vFrame(vImgs.turretDead, 170, 130, fr, 0, f.x, f.y + 6, 124, a);
    else vFrame(vImgs.robotsDead, 110, 90, fr, { assault: 0, support: 1, hunter: 2 }[f.kind] || 0, f.x, f.y + 4, 84, a);
    return true;
  }
  if (!F?.naturalWidth) return age < 400;
  ctx.save(); ctx.imageSmoothingEnabled = false;
  if (f.type === "laser") {
    if (age > 260) { ctx.restore(); return false; }
    ctx.translate(f.x, f.y); ctx.rotate(f.a); ctx.globalAlpha = 1 - age / 260;
    ctx.drawImage(F, 2 * 180 + 20, 30, 140, 50, 0, -12, f.len, 24);                       // beam stretched to the hit
    ctx.drawImage(F, 4 * 180, 0, 180, 110, f.len - 80, -30, 100, 60);                     // impact burst
  } else if (f.type === "healfx") {   // (a heal with no player to follow: the regen effect at that spot)
    if (age > regenLen()) { ctx.restore(); return false; }
    drawRegen({ x: f.x, y: f.y }, age, true);
  } else if (f.type === "summon") {
    if (age > 700) { ctx.restore(); return false; }
    ctx.drawImage(F, Math.min(5, Math.floor(age / 115)) * 180, 330, 180, 110, f.x - 60, f.y - 52, 120, 73);
  }
  ctx.restore(); return true;
}
// Hold E: robot wheel. Point at a robot and release E to summon it (one per cooldown, up to 3 alive).
// Tap E: summon the same robot as last time.
const SQUAD_KINDS = [["assault", "Assault", "Hunts zombies anywhere"], ["support", "Support", "Heals each survivor once"], ["hunter", "Hunter", "Laser, guards its area"]];
let squadWheel = null, lastRobot = "assault";
try { const sv = localStorage.getItem("sa-robot"); if (sv) lastRobot = sv; } catch {}
function openSquadWheel() {
  const me = me_(); if (!me || squadWheel) return;
  squadWheel = { cx: Math.max(190, Math.min(W - 190, mouse.sx)), cy: Math.max(190, Math.min(H - 190, mouse.sy)), t0: performance.now(), aimX: mouse.x, aimY: mouse.y }; firing = false;
}
function squadSliceAt() {
  if (!squadWheel) return -1; const dx = mouse.sx - squadWheel.cx, dy = mouse.sy - squadWheel.cy;
  if (Math.hypot(dx, dy) < 34) return -1;
  return ((Math.round((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI * 2 / 3)) % 3) + 3) % 3;
}
function closeSquadWheel() {
  if (!squadWheel) return; const w = squadWheel; squadWheel = null; const me = me_();
const sel = (() => { const dx = mouse.sx - w.cx, dy = mouse.sy - w.cy; return Math.hypot(dx, dy) < 34 ? -1 : ((Math.round((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI * 2 / 3)) % 3) + 3) % 3; })();
  const kind = sel >= 0 ? SQUAD_KINDS[sel][0] : performance.now() - w.t0 < 250 ? lastRobot : null;
  if (!kind) return;
  const ch = me?.robotCharges ?? 3;
  if (ch < 1 || (me?.abilityCooldown || 0) > 0) { feed.unshift({ text: ch < 1 ? `No robot charges: next in ${Math.ceil(me.chargeCd || 0)}s` : `Next robot in ${Math.ceil(me.abilityCooldown)}s`, t: Date.now() }); feed.length = Math.min(feed.length, 5); return; }
  lastRobot = kind; try { localStorage.setItem("sa-robot", kind); } catch {}
  room?.send("ability", { kind, a: me ? aimAngle(me) : undefined });
}
function drawSquadWheel() {
  if (!squadWheel) return; const { cx, cy } = squadWheel, R = 150, sel = squadSliceAt(), me = me_();
  const alive = state?.robots ? [...state.robots.values()].filter(r => r.ownerId === myId).length : 0, ch = me?.robotCharges ?? 3, ready = ch >= 1 && !((me?.abilityCooldown || 0) > 0);
  ctx.save(); ctx.fillStyle = "rgba(8,12,14,.86)"; ctx.beginPath(); ctx.arc(cx, cy, R + 16, 0, 7); ctx.fill();
  SQUAD_KINDS.forEach(([k, name, desc], i) => {
    const a = i * Math.PI * 2 / 3 - Math.PI / 2, x = cx + Math.cos(a) * R * .66, y = cy + Math.sin(a) * R * .66;
    if (i === sel) { ctx.fillStyle = ready ? "rgba(242,139,54,.35)" : "rgba(200,60,60,.3)"; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R + 14, a - Math.PI / 3, a + Math.PI / 3); ctx.closePath(); ctx.fill(); }
    ctx.globalAlpha = ready ? 1 : .5;
    const im = vImgs[k]; if (im?.naturalWidth) { ctx.imageSmoothingEnabled = false; ctx.drawImage(im, 0, 0, 110, 90, x - 55 * 1.15, y - 84 * 1.15 + 18, 110 * 1.15, 90 * 1.15); }
    ctx.textAlign = "center"; ctx.fillStyle = i === sel ? "#ffd2a8" : "#eef2f0"; ctx.font = "bold 15px Inter, system-ui, sans-serif"; ctx.fillText(name, x, y + 34);
    ctx.fillStyle = "#9aa8ad"; ctx.font = "11px Inter, system-ui, sans-serif"; ctx.fillText(desc, x, y + 49); ctx.globalAlpha = 1;
  });
  ctx.fillStyle = "#c3ccc9"; ctx.font = "bold 12px Inter, system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText(`${alive}/3 robots · ${ch} charge${ch === 1 ? "" : "s"}`, cx, cy - 4);
  ctx.font = "11px Inter, system-ui, sans-serif"; ctx.fillStyle = ready ? "#ffd27a" : "#ff8a7a";
  ctx.fillText(ready ? (alive >= 3 ? "replaces your oldest" : "release E to summon") : ch < 1 ? `next charge in ${Math.ceil(me.chargeCd || 0)}s` : `ready in ${Math.ceil(me.abilityCooldown)}s`, cx, cy + 12);
  ctx.restore();
}
// ---------- THE BUTCHER (boss art: tools/extract-zombie-dirs.py + tools/extract-butcher.py) ----------
const butcherImgs = {};
for (const [k, url] of Object.entries({ walk: "assets/sprites/zombies/dir8/butcher-walk.webp", chop: "assets/sprites/zombies/dir8/butcher-chop.webp", hook: "assets/sprites/zombies/dir8/butcher-hook.webp",
  spin: "assets/sprites/zombies/dir8/butcher-spin.png", stagger: "assets/sprites/zombies/dir8/butcher-stagger.png",
  hookBreak: "assets/sprites/fx/hook-break.png", burst: "assets/sprites/fx/deflect-burst.png", deflected: "assets/sprites/fx/deflected.png", death: "assets/sprites/zombies/dir8/butcher-death.png", hookFx: "assets/sprites/fx/butcher-hook.png",
  chain: "assets/sprites/fx/butcher-chain.png", shock: "assets/sprites/fx/butcher-shock.png" })) { const im = new Image(); im.src = url; butcherImgs[k] = im; }
const BCELL = { walk: { w: 230, h: 185, ax: 115, fy: 179 }, chop: { w: 320, h: 250, ax: 160, fy: 244 }, hook: { w: 420, h: 250, ax: 210, fy: 244 }, spin: { w: 330, h: 230, ax: 165, fy: 224 }, stagger: { w: 260, h: 200, ax: 130, fy: 194 } };
const SHOCK = { w: 300, h: 180, cy: 111, widths: [238, 273, 263, 271] };
const BT = { hookAim: .5, get hookSpeed() { return state?.hookSpeed || 2600; }, hookRange: 480, chopAfter: .65, rings: [95, 185, 275], offset: 55 };   // match BUTCHER on the server
const bossCorpses = [];
const bossMove = new Map(), stompDust = [];   // boss walk tracking + dust puffs from his footsteps
function drawStompDust() {
  const now = performance.now();
  for (let i = stompDust.length - 1; i >= 0; i--) {
    const d = stompDust[i], k = (now - d.t) / 450; if (k >= 1) { stompDust.splice(i, 1); continue; }
    ctx.save(); ctx.globalAlpha = .45 * (1 - k); ctx.fillStyle = "#8a8378";
    for (let j = 0; j < 4; j++) { const a = j * 1.6 + d.x; ctx.beginPath(); ctx.ellipse(d.x + Math.cos(a) * (6 + 16 * k), d.y + Math.sin(a) * (2 + 5 * k), 5 + 4 * k, 3 + 2 * k, 0, 0, 7); ctx.fill(); }
    ctx.restore();
  }
}
const bAct = new Map();   // boss id -> { act, start } (local clock, so animations play smoothly between server updates)
function actTime(z) {
  let st = bAct.get(z.id); const now = performance.now();
  if (!st || st.act !== z.act) { st = { act: z.act, start: now - Math.max(0, (z.actLen || 0) - (z.slam || 0)) * 1000 }; bAct.set(z.id, st); }
  return (now - st.start) / 1000;
}
function bFrame(sheet, frame, row, x, y, feet, filter) {
  const im = butcherImgs[sheet], C = BCELL[sheet]; if (!im?.naturalWidth) return;
  ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.imageSmoothingEnabled = false; if (filter) ctx.filter = filter;
  ctx.drawImage(im, frame * C.w, row * C.h, C.w, C.h, -C.ax, feet - C.fy, C.w, C.h); ctx.restore();
}
function drawChain(x0, y0, x1, y1, withHook = true) {
  const ch = butcherImgs.chain, hk = butcherImgs.hookFx, a = Math.atan2(y1 - y0, x1 - x0), len = Math.hypot(x1 - x0, y1 - y0);
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.translate(x0, y0); ctx.rotate(a);
  if (ch?.naturalWidth) for (let d = 0; d < len - 20; d += ch.width - 6) ctx.drawImage(ch, d, -ch.height / 2);
  if (withHook && hk?.naturalWidth) ctx.drawImage(hk, len - hk.width * .55, -hk.height / 2);
  ctx.restore();
}
function drawButcher(z) {
  const now = performance.now(), t = actTime(z), feet = z.radius * .8, row = ROW_OF_OCT[((Math.round((z.aim || 0) / (Math.PI / 4)) % 8) + 8) % 8];
  const flashAt = feel.flash.get(z.id), flash = flashAt && now - flashAt < 90;
  const filter = flash ? "brightness(2.2)" : z.enraged ? `drop-shadow(0 0 ${6 + 4 * Math.sin(now / 90)}px rgba(255,30,30,.9))` : "";
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.beginPath(); ctx.ellipse(z.x, z.y + feet, 46, 12, 0, 0, 7); ctx.fill(); ctx.restore();
  const handX = z.x + Math.cos(z.aim || 0) * 34, handY = z.y - 52 + Math.sin(z.aim || 0) * 18;
  if (z.act === "chop") {
    const W = Math.max(.2, (z.actLen || 1.35) - BT.chopAfter);
    if (t < W + .05) {   // the three danger zones light up on the ground during the wind-up
      const k = Math.min(1, t / W), cx = z.x + Math.cos(z.aim) * BT.offset, cy = z.y + Math.sin(z.aim) * BT.offset + feet;
      ctx.save();
      [[BT.rings[2], "120,170,230"], [BT.rings[1], "255,215,90"], [BT.rings[0], "255,70,55"]].forEach(([r, c], i) => {
        ctx.fillStyle = `rgba(${c},${.07 + .13 * k + (i === 2 ? .08 : 0)})`; ctx.strokeStyle = `rgba(${c},${.35 + .5 * k})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(cx, cy, r, r * .55, 0, 0, 7); ctx.fill(); ctx.stroke();
      });
      ctx.restore();
    }
    const f = t < W * .3 ? 0 : t < W * .85 ? 1 : t < W ? 2 : t < W + .22 ? 3 : t < W + .42 ? 4 : 5;
    bFrame("chop", f, row, z.x, z.y, feet, filter);
  } else if (z.act === "hook" || z.act === "hookback" || z.act === "pull") {
    let f = 0, d = 0;
    if (z.act === "hook") {
      if (t < BT.hookAim) {   // aiming: swinging the chain + red aiming line
        f = 1 + Math.floor(t / .12) % 2;
        const k = t / BT.hookAim; ctx.save(); ctx.setLineDash([10, 8]); ctx.lineDashOffset = -now / 25; ctx.lineWidth = 3 + 3 * k;
        ctx.strokeStyle = `rgba(255,50,40,${.35 + .5 * k})`; ctx.beginPath(); ctx.moveTo(z.x, z.y); ctx.lineTo(z.x + Math.cos(z.aim) * BT.hookRange, z.y + Math.sin(z.aim) * BT.hookRange); ctx.stroke(); ctx.restore();
      } else { f = 3; d = Math.min(BT.hookRange, (t - BT.hookAim) * BT.hookSpeed); }
    } else if (z.act === "hookback") { f = 4; d = (z.hookD || 0) * Math.max(0, 1 - t / Math.max(.1, z.actLen || .4)); }
    else f = 4;
    bFrame("hook", f, row, z.x, z.y, feet, filter);
    if (z.act === "pull") { const v = V(state.players.get(z.hookId)); if (v) drawChain(handX, handY, v.x, v.y - 22); }
    else if (d > 10) drawChain(handX, handY, z.x + Math.cos(z.aim) * d, z.y - 30 + Math.sin(z.aim) * d);
  } else if (z.act === "stagger") {   // knocked back by a deflect
    const L = z.actLen || 1.5, f = t < .12 ? 1 : t < L - .35 ? 2 : 3;
    const wob = t < L - .35 ? Math.sin(now / 60) * 3 : 0;
    bFrame("stagger", f, row, z.x + wob, z.y, feet, filter);
    if (t < L - .2) { ctx.save(); ctx.font = "bold 14px monospace"; ctx.textAlign = "center"; ctx.fillStyle = "#ffe27a"; ctx.shadowColor = "#000"; ctx.shadowBlur = 3;
      for (let i = 0; i < 3; i++) { const a = now / 220 + i * 2.1; ctx.fillText("✦", z.x + Math.cos(a) * 26, z.y - 150 + Math.sin(a) * 6); } ctx.restore(); }
  } else if (z.act === "spin") {
    const f = t < .15 ? 1 : t < .3 ? 2 : 3 + Math.floor(t * 16) % 5;
    bFrame("spin", f, 0, z.x, z.y, feet, filter);
  } else {
    let st = bossMove.get(z.id); if (!st) { st = { x: z.x, y: z.y, movedAt: 0, dist: 0 }; bossMove.set(z.id, st); }
    const step = Math.hypot(z.x - st.x, z.y - st.y);
    if (step > .3) { st.movedAt = now; st.dist += step; st.x = z.x; st.y = z.y; }
    const moving = now - st.movedAt < 180;
    // frames follow the distance walked (feet don't slide), one full 6-frame cycle per ~90px; heavy stomp: body dips + sways on each footfall
    const cyc = st.dist / 90, frame = moving ? Math.floor(cyc * 6) % 6 : 0, ph = cyc * Math.PI * 2;
    const dip = moving ? Math.abs(Math.sin(ph)) * 4 : 0, sway = moving ? Math.sin(ph) * 2 : 0;
    if (moving && Math.floor(cyc * 2) !== st.lastFoot) { st.lastFoot = Math.floor(cyc * 2); stompDust.push({ x: z.x + (st.lastFoot % 2 ? 16 : -16), y: z.y + feet, t: now }); }
    bFrame("walk", frame, row, z.x + sway, z.y + dip, feet, filter);
  }
}
// Hook deflected: clash burst + hook snapping (drawn along the hook's path) + "DEFLECTED!" popping above the survivor.
let hitStopUntil = 0, flashUntil = 0;
function drawDeflect(f, age) {   // false when finished
  const I = butcherImgs; if (age > 1500) return false;
  ctx.save(); ctx.imageSmoothingEnabled = false;
  if (I.hookBreak?.naturalWidth && age < 520) {
    const fr = Math.min(5, Math.floor(age / 85)), back = age / 520 * 26;
    ctx.save(); ctx.translate(f.x - Math.cos(f.a) * (20 + back), f.y - Math.sin(f.a) * (20 + back)); ctx.rotate(f.a);
    if (Math.cos(f.a) < 0) ctx.scale(1, -1);
    ctx.drawImage(I.hookBreak, fr * 120, 0, 120, 80, -90, -40, 120, 80); ctx.restore();
  }
  if (I.burst?.naturalWidth && age < 460) { const fr = Math.min(5, Math.floor(age / 75)), s = f.heavy ? 1.3 : 1; ctx.drawImage(I.burst, fr * 180, 0, 180, 160, f.x - 90 * s, f.y - 80 * s, 180 * s, 160 * s); }
  const p = V(state.players.get(f.id)), tx = p ? p.x : f.x, ty = (p ? p.y : f.y) - 92 - Math.min(1, age / 1500) * 22;
  if (I.deflected?.naturalWidth) {
    const big = age < 140, sc = big ? 0.75 + age / 140 * .25 : 0.62, fr = big || f.heavy ? 1 : 0;
    ctx.globalAlpha = age > 1100 ? 1 - (age - 1100) / 400 : 1;
    ctx.drawImage(I.deflected, fr * 370, 0, 370, 150, tx - 185 * sc, ty - 75 * sc, 370 * sc, 150 * sc);
  }
  ctx.restore(); return true;
}
function drawBossCorpse(c) {
  const age = (performance.now() - c.t) / 1000, im = butcherImgs.death, C = BCELL.spin;
  if (age > 14) { bossCorpses.splice(bossCorpses.indexOf(c), 1); return; }
  if (c.kind !== "butcher" || !im?.naturalWidth) return;
  const f = Math.min(5, Math.floor(age / .2));
  ctx.save(); ctx.globalAlpha = age > 11 ? 1 - (age - 11) / 3 : 1; ctx.imageSmoothingEnabled = false;
  ctx.drawImage(im, f * C.w, 0, C.w, C.h, c.x - C.ax, c.y + 32 - C.fy, C.w, C.h); ctx.restore();
}
// Cleaver Quake on the ground: the crack, then the red, yellow and blue shockwaves one after another.
// ---------- Dash: an energy-beam trail, one style + colour per hero (after the user's "Energy Beams FX" pack, MIT:
// lance / gold beads / violet lightning / toxic hex / crimson pulse rings / glacier shards / prism / plasma / amber drill /
// nova; their Godot shaders are re-drawn here in canvas). Trail from where you left to where you landed, fading in ~0.5s.
const DASH_FX = {
  assault:       { c: [43, 217, 255], core: [255, 255, 255], style: "lance" },    // Marcus: Cyan Lance
  juggernaut:    { c: [255, 128, 40], core: [255, 226, 190], style: "drill" },    // Briggs: Amber Drill
  operator:      { c: [255, 51, 84], core: [255, 219, 209], style: "pulse" },     // Sofea: Crimson Pulse
  engineer:      { c: [90, 150, 255], core: [225, 238, 255], style: "plasma" },   // Viktor: Plasma Storm
  scout:         { c: [153, 92, 255], core: [240, 230, 255], style: "storm" },    // Raven: Violet Storm
  demolitionist: { c: [255, 166, 31], core: [255, 241, 196], style: "solar" },    // Dante: Solar Gold
  sniper:        { c: [168, 237, 255], core: [255, 255, 255], style: "glacier" }, // Sienna: Glacier Shard
  dispatcher:    { c: [107, 255, 74], core: [235, 255, 224], style: "hex" },      // Astra: Toxic Hex (his medics' green)
  slasher:       { c: [240, 236, 222], core: [255, 255, 255], style: "nova" },    // Arshan: Nova White
};
const DASH_MS = 520, dashBeams = [];
function dashBeam(id, x0, y0, x1, y1) {
  const p = state?.players?.get(id); if (!p || Math.hypot(x1 - x0, y1 - y0) < 6) return;
  dashBeams.push({ x0, y0: y0 - 14, x1, y1: y1 - 14, t: performance.now(), fx: DASH_FX[p.characterClass] || DASH_FX.assault, seed: Math.random() * 100 });
  if (dashBeams.length > 24) dashBeams.shift();
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
function drawDashBeams() {
  const now = performance.now();
  for (let i = dashBeams.length - 1; i >= 0; i--) {
    const b = dashBeams[i], age = now - b.t; if (age > DASH_MS) { dashBeams.splice(i, 1); continue; }
    if (!inView(b.x1, b.y1, 120)) continue;
    const u = age / DASH_MS, fade = Math.pow(1 - u, 1.4), grow = Math.min(1, age / 70), C = b.fx.c, K = b.fx.core, st = b.fx.style;
    const dx = b.x1 - b.x0, dy = b.y1 - b.y0, L = Math.hypot(dx, dy) * grow, a = Math.atan2(dy, dx), t = now / 1000;
    ctx.save(); ctx.translate(b.x0, b.y0); ctx.rotate(a); ctx.globalCompositeOperation = "lighter";
    const taper = (w0, w1, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, -w0); ctx.lineTo(L, -w1); ctx.arc(L, 0, w1, -Math.PI / 2, Math.PI / 2); ctx.lineTo(0, w0); ctx.closePath(); ctx.fill(); };
    // glow, beam, core (thin where they left, thick where they are)
    const g = ctx.createLinearGradient(0, 0, L, 0); g.addColorStop(0, rgba(C, 0)); g.addColorStop(.35, rgba(C, .22 * fade)); g.addColorStop(1, rgba(C, .42 * fade)); taper(3, 17 * (1 - u * .4), g);
    const g2 = ctx.createLinearGradient(0, 0, L, 0); g2.addColorStop(0, rgba(C, .1 * fade)); g2.addColorStop(1, rgba(C, .85 * fade)); taper(1.5, 7 * (1 - u * .5), g2);
    if (st === "prism") { const pg = ctx.createLinearGradient(0, 0, L, 0); ["#ff4d6d", "#ffb347", "#fff35c", "#5cff8a", "#5cc8ff", "#b07cff"].forEach((c, k) => pg.addColorStop(k / 5, c)); ctx.globalAlpha = fade * .8; taper(1, 4, pg); ctx.globalAlpha = 1; }
    const g3 = ctx.createLinearGradient(0, 0, L, 0); g3.addColorStop(0, rgba(K, .15 * fade)); g3.addColorStop(1, rgba(K, fade)); taper(.6, 2.6 * (1 - u * .5), g3);
    // each style's pattern along the beam
    const n = Math.max(2, Math.round(L / 12));
    ctx.lineWidth = 1.6; ctx.strokeStyle = rgba(K, .8 * fade); ctx.fillStyle = rgba(K, .9 * fade);
    if (st === "lance" || st === "solar" || st === "nova") for (let k = 1; k < n; k++) {   // travelling beads
      const x = ((k / n + t * 1.6) % 1) * L, r = (st === "solar" ? 2.6 : 1.8) * (.6 + .4 * x / L); ctx.beginPath(); ctx.arc(x, Math.sin(t * 6 + k) * (st === "solar" ? 2 : 0), r, 0, 7); ctx.fill(); }
    if (st === "lance" || st === "pulse" || st === "nova" || st === "plasma") for (let k = 0; k < 3; k++) {   // rings (crescents) sliding up the beam
      const q = (k / 3 + t * (st === "pulse" ? 2.2 : 1.4)) % 1, x = q * L, r = (4 + 9 * q) * (1 - u * .3);
      ctx.strokeStyle = rgba(st === "pulse" ? C : K, .7 * fade * (1 - q * .5)); ctx.lineWidth = st === "pulse" ? 2.4 : 1.4; ctx.beginPath(); ctx.ellipse(x, 0, r * .35, r, 0, -Math.PI / 2, Math.PI / 2); ctx.stroke(); }
    if (st === "storm" || st === "plasma") for (let k = 0; k < 2; k++) {   // crackling lightning, re-drawn every 45ms
      const sd = Math.floor(now / 45) + k * 7 + b.seed; ctx.strokeStyle = rgba(k ? C : K, .85 * fade); ctx.lineWidth = k ? 2 : 1.2; ctx.beginPath(); ctx.moveTo(0, 0);
      for (let j = 1; j <= 7; j++) { const r = Math.sin(sd * 12.9898 + j * 78.233) * 43758.5453, off = (r - Math.floor(r) - .5) * 14 * (j / 7); ctx.lineTo(L * j / 7, j === 7 ? 0 : off); } ctx.stroke(); }
    if (st === "hex") for (let k = 1; k < n; k++) {   // little hexagons drifting off the beam
      const q = (k / n + t * .9) % 1, x = q * L, y = Math.sin(k * 2.3 + t * 3) * 6 * q, r = 2.2 + 2 * q; ctx.strokeStyle = rgba(k % 2 ? C : K, .8 * fade); ctx.lineWidth = 1.2; ctx.beginPath();
      for (let j = 0; j < 6; j++) { const aa = j * Math.PI / 3 + t; ctx[j ? "lineTo" : "moveTo"](x + Math.cos(aa) * r, y + Math.sin(aa) * r); } ctx.closePath(); ctx.stroke(); }
    if (st === "glacier") for (let k = 1; k < n; k++) {   // ice shards flaking off
      const x = k / n * L, s = (k % 2 ? 1 : -1), h = 3 + 5 * (k / n); ctx.fillStyle = rgba(k % 2 ? K : C, .75 * fade); ctx.beginPath(); ctx.moveTo(x - 3, 0); ctx.lineTo(x + 2, s * h); ctx.lineTo(x + 4, 0); ctx.fill(); }
    if (st === "drill") for (let k = 0; k < 2; k++) {   // a spinning double helix
      ctx.strokeStyle = rgba(k ? C : K, .8 * fade); ctx.lineWidth = 1.6; ctx.beginPath();
      for (let j = 0; j <= 16; j++) { const x = j / 16 * L, y = Math.sin(j * .9 - t * 14 + k * Math.PI) * (2 + 6 * j / 16); ctx[j ? "lineTo" : "moveTo"](x, y); } ctx.stroke(); }
    // where they left: an expanding shock ring; where they landed: a star flare
    ctx.strokeStyle = rgba(C, .7 * fade); ctx.lineWidth = 2 * (1 - u) + .5; ctx.beginPath(); ctx.ellipse(0, 0, 4 + 22 * u, (4 + 22 * u) * .55, 0, 0, 7); ctx.stroke();
    if (age < 260) { const k = 1 - age / 260, fr = ctx.createRadialGradient(L, 0, 0, L, 0, 18); fr.addColorStop(0, rgba(K, .9 * k)); fr.addColorStop(.4, rgba(C, .5 * k)); fr.addColorStop(1, rgba(C, 0)); ctx.fillStyle = fr; ctx.fillRect(L - 18, -18, 36, 36);
      ctx.strokeStyle = rgba(K, .8 * k); ctx.lineWidth = 1.4; ctx.beginPath(); for (let j = 0; j < 4; j++) { const aa = j * Math.PI / 4 + t * 3; ctx.moveTo(L - Math.cos(aa) * 14 * k, -Math.sin(aa) * 14 * k); ctx.lineTo(L + Math.cos(aa) * 14 * k, Math.sin(aa) * 14 * k); } ctx.stroke(); }
    ctx.restore();
  }
}
function drawGroundFx() {
  drawDashBeams();
  const sh = butcherImgs.shock; if (!sh?.naturalWidth) return;
  const now = performance.now();
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; if (f.type !== "chop") continue;
    const age = (now - f.t) / 1000; if (age > 2.6) { fx.splice(i, 1); continue; }
    ctx.save(); ctx.imageSmoothingEnabled = false;
    const draw = (row, frame, r, alpha = 1) => {
      const sc = (r * 2) / SHOCK.widths[row]; ctx.globalAlpha = alpha; ctx.filter = row === 3 ? "hue-rotate(-40deg) saturate(1.3)" : "none";   // slow ring: lavender dust -> icy blue
      ctx.drawImage(sh, frame * SHOCK.w, row * SHOCK.h, SHOCK.w, SHOCK.h, f.x - SHOCK.w * sc / 2, f.y + 26 - SHOCK.cy * sc, SHOCK.w * sc, SHOCK.h * sc);
    };
    draw(0, Math.min(5, Math.floor(age / .07)), f.r[0] * 1.1, age > 1.6 ? Math.max(0, 1 - (age - 1.6)) : 1);   // crack (stays as a scar for a moment)
    for (let k = 0; k < 3; k++) { const a = age - k * (f.d || .12); if (a >= 0 && a < .42) draw(k + 1, Math.min(5, Math.floor(a / .07)), f.r[k]); }
    ctx.restore();
  }
}
// ---------- Spitter acid: flying glob (8 directions, grows as it flies), splash, and puddles on the ground ----------
const acidFly = new Image(); acidFly.src = "assets/sprites/fx/acid-fly.png";        // 8 rows x 6 frames, 64px cells
const acidSplash = new Image(); acidSplash.src = "assets/sprites/fx/acid-splash.png"; // 6 frames, 120x60 (frame 6 = puddle)
function drawSpit(f, age) {   // returns false when finished
  if (!acidFly.naturalWidth) return age < f.ms + 600;
  const dur = f.ms, k = Math.min(1, age / dur), dist = Math.hypot(f.tx - f.sx, f.ty - f.sy), arc = Math.min(130, dist * .35);
  if (k < 1) {
    const x = f.sx + (f.tx - f.sx) * k, y = f.sy + (f.ty - f.sy) * k - Math.sin(Math.PI * k) * arc;
    const vx = f.tx - f.sx, vy = (f.ty - f.sy) - Math.cos(Math.PI * k) * Math.PI * arc;   // direction of travel along the arc
    const row = ROW_OF_OCT[((Math.round(Math.atan2(vy, vx) / (Math.PI / 4)) % 8) + 8) % 8], fr = Math.min(5, Math.floor(k * 6));
    ctx.save(); ctx.globalAlpha = .35; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(f.sx + (f.tx - f.sx) * k, f.sy + (f.ty - f.sy) * k + 26, 7 + 6 * k, 3 + 2 * k, 0, 0, 7); ctx.fill(); ctx.restore();   // shadow on the ground
    ctx.imageSmoothingEnabled = false; ctx.drawImage(acidFly, fr * 64, row * 64, 64, 64, x - 32, y - 32, 64, 64);
    return true;
  }
  const s = age - dur; if (s > 450 || !acidSplash.naturalWidth) return false;
  const fr = Math.min(4, Math.floor(s / 90));
  ctx.imageSmoothingEnabled = false; ctx.drawImage(acidSplash, fr * 120, 0, 120, 60, f.tx - 75, f.ty + 26 - 66, 150, 75);
  return true;
}
function drawPuddles() {
  if (!state.puddles) return;
  const t = performance.now();
  for (const pu of state.puddles.values()) {
    if (!inView(pu.x, pu.y, pu.r)) continue;
    const a = Math.min(1, pu.life) * (pu.maxLife - pu.life < .35 ? (pu.maxLife - pu.life) / .35 : 1), ry = pu.r * .6, cy = pu.y + 6;
    ctx.save(); ctx.globalAlpha = .55 * a; ctx.fillStyle = "rgba(150,220,40,.35)"; ctx.beginPath(); ctx.ellipse(pu.x, cy, pu.r, ry, 0, 0, 7); ctx.fill();   // the danger area
    ctx.globalAlpha = a; ctx.imageSmoothingEnabled = false;
    if (acidSplash.naturalWidth) ctx.drawImage(acidSplash, 5 * 120, 0, 120, 60, pu.x - pu.r * 1.15, cy - ry * 1.25, pu.r * 2.3, ry * 2.3);
    for (let i = 0; i < 4; i++) {   // bubbles
      const ph = (t / 900 + i * .27 + pu.x * .01) % 1, bx = pu.x + Math.cos(i * 2.3 + pu.y) * pu.r * .5, by = cy + Math.sin(i * 1.7 + pu.x) * ry * .45 - ph * 6;
      ctx.globalAlpha = a * (1 - ph); ctx.fillStyle = "#d8ff6a"; ctx.beginPath(); ctx.arc(bx, by, 1.5 + ph * 2.5, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
}
// ---------- Zombie sprites (art: client/assets/sprites/zombies/<kind>.png: WALK 1-3, ATTACK 1-2, DEAD) ----------
const ZOMBIE_URLS = {
  walker: "assets/sprites/zombies/walker.png", runner: "assets/sprites/zombies/runner.png", brute: "assets/sprites/zombies/brute.png",
  spitter: "assets/sprites/zombies/spitter.png", mutant: "assets/sprites/zombies/mutant.png",
};
const ZSPR = { cellW: 104, cellH: 80, anchorX: 46 };
const ZTYPE = { // walk speed (ms per frame), how tall the art is (for the health bar)
  walker: { walk: 190, h: 58 }, runner: { walk: 105, h: 58 }, brute: { walk: 250, h: 104 }, spitter: { walk: 200, h: 56 }, mutant: { walk: 150, h: 74 },
};
// 8-direction zombie art (client/assets/sprites/zombies/dir8/<kind>.png, cut by tools/extract-zombie-dirs.py):
// rows down, down-right, right, up-right, up, up-left, left, down-left; 6 walk/run frames. Attacks and bodies still use the side-view sheet.
const ZDIR8_URLS = { runner: "assets/sprites/zombies/dir8/runner.png", brute: "assets/sprites/zombies/dir8/brute.png", spitter: "assets/sprites/zombies/dir8/spitter.png", mutant: "assets/sprites/zombies/dir8/mutant.png" };
const ZD8_CELLS = { runner: { cellW: 100, cellH: 84, anchorX: 50, feetY: 78 }, brute: { cellW: 150, cellH: 124, anchorX: 75, feetY: 118 }, spitter: { cellW: 130, cellH: 104, anchorX: 65, feetY: 98 }, mutant: { cellW: 180, cellH: 124, anchorX: 90, feetY: 118 } };   // from dir8.json
// frames per sheet row: walk cycle length, and (if the sheet has them) its own attack frames
// mutant sheet = its slash: 0 ready, 1 wind-up, 2 swing, 3 swing + arc, 4 claw marks (drawn as an effect), 5 recover.
// It has no walk cycle, so it lurches on its "ready" frame.
const ZD8_ANIM = { runner: { walk: 6 }, brute: { walk: 6 }, spitter: { walk: 4, attack: [4, 5] },
  mutant: { lurch: true, idle: 7 } };
// Mutant charged whip (sheet columns): 0 coil, 1 full charge, 2 launch, 3 whip peak, 4 follow-through, 5 overextended, 6 recover, 7 ready.
// Times match MUTANT on the server (charge .38s, hit .47s, total .9s). Claw marks come from the older sheet (column 4).
const WHIP_T = { total: .9, frames: [[0, 0], [.17, 1], [.38, 2], [.45, 3], [.53, 4], [.64, 5], [.77, 6]] };
const mutantClaw = new Image(); mutantClaw.src = "assets/sprites/zombies/dir8/mutant-claw.png";
const whipStart = new Map();
function drawMutantWhip(z, img8, info) {
  const now = performance.now();
  if (!whipStart.has(z.id)) whipStart.set(z.id, now - (WHIP_T.total - z.slam) * 1000);
  const t = (now - whipStart.get(z.id)) / 1000;
  let frame = 0; for (const [t0, f] of WHIP_T.frames) if (t >= t0) frame = f;
  const tg = state.players.get(z.targetId), face = tg ? Math.atan2(tg.y - z.y, tg.x - z.x) : zombieAngle(z);
  const row = ROW_OF_OCT[((Math.round(face / (Math.PI / 4)) % 8) + 8) % 8], feet = z.radius ? z.radius * 0.8 : 12, C = ZD8_CELLS.mutant;
  ctx.save(); ctx.translate(Math.round(z.x), Math.round(z.y)); ctx.imageSmoothingEnabled = false;
  const charging = t < .38, flash = feel.flash.get(z.id);
  if (flash && now - flash < 90) ctx.filter = "brightness(2.6)";
  else if (charging) { const g = .5 + .5 * Math.sin(now / 45); ctx.filter = `drop-shadow(0 0 ${4 + 5 * g}px rgba(255,40,70,.95)) brightness(${1 + .25 * g})`; }   // glowing red while it coils: your warning
  const shake = charging ? (Math.random() - .5) * 2.5 : 0;
  ctx.drawImage(img8, frame * C.cellW, row * C.cellH, C.cellW, C.cellH, -C.anchorX + shake, feet - C.feetY, C.cellW, C.cellH);
  if (t > .46 && t < .78 && mutantClaw.naturalWidth) {   // claw marks rip across in front of it
    const k = (t - .46) / .32; ctx.filter = "none"; ctx.globalAlpha = 1 - k * k;
    ctx.drawImage(mutantClaw, 0, row * C.cellH, C.cellW, C.cellH, -C.anchorX + Math.cos(face) * 44, feet - C.feetY - 8 + Math.sin(face) * 26, C.cellW, C.cellH);
  }
  ctx.restore();
  return { feet, h: info.h };
}
const ATTACK_CD = { spitter: 2.6, mutant: 0.85 };   // seconds between attacks (matches the server)
const FACE_TARGET = { spitter: 1, mutant: 1 };      // turn toward the survivor they attack
const zAtk = new Map();   // zombie id -> { cd, at }: when (local time) its current attack started, for smooth timing
function attackAge(z) {
  let st = zAtk.get(z.id); const cd = z.attackCooldown ?? 0, now = performance.now();
  if (!st) { st = { cd, at: -1e9 }; zAtk.set(z.id, st); }
  if (cd > st.cd + .2) st.at = now - Math.max(0, (ATTACK_CD[z.kind] || 1) - cd) * 1000;   // cooldown jumped up = a new attack
  st.cd = cd; return (now - st.at) / 1000;
}
const ZSIDE_SCALE = { brute: 1.5 };
// Brute ground slam animation (8 directions x 6: ready, raise, wind-up, slam, shockwave, recover). Timings match SLAM on the server.
const SLAM_URL = "assets/sprites/zombies/dir8/brute-slam.png", SLAM_CELL = { cellW: 230, cellH: 150, anchorX: 115, feetY: 144 };
const SLAM_T = { windup: 0.8, total: 1.45, radius: 140 };
const slamImg = new Image(); slamImg.src = SLAM_URL;
const slamStart = new Map();   // zombie id -> when (local time) we saw its slam start   // the old side-view frames (attacks, bodies) drawn bigger to match
const zdir8 = {};
for (const [k, url] of Object.entries(ZDIR8_URLS)) { const img = new Image(); img.src = url; zdir8[k] = img; }
const zang = new Map();   // zombie id -> { x, y, a }: which way it's moving
function zombieAngle(z) {
  let st = zang.get(z.id);
  if (!st) { st = { x: z.x, y: z.y, a: Math.atan2(towerY() - z.y, towerX() - z.x) }; zang.set(z.id, st); }
  const dx = z.x - st.x, dy = z.y - st.y;
  if (dx * dx + dy * dy > 4) { st.a = Math.atan2(dy, dx); st.x = z.x; st.y = z.y; }
  return st.a;
}
const zombieImgs = {};
for (const [k, url] of Object.entries(ZOMBIE_URLS)) { const img = new Image(); img.src = url; zombieImgs[k] = img; }
const zface = new Map(); // zombie id -> last facing (1 right, -1 left)
function zombieFacing(z) {
  // face the player they're chasing, otherwise the radio tower
  const t = state.players.get(z.targetId), cx = towerX();
  const tx = t && Math.hypot(t.x - z.x, t.y - z.y) < 380 ? t.x : cx;
  let f = zface.get(z.id) || 1;
  if (Math.abs(tx - z.x) > 6) f = tx > z.x ? 1 : -1;
  zface.set(z.id, f); return f;
}
function drawZombieSprite(z, img, alpha = 1, forceFrame = -1, facing = 0) {
  const now = performance.now(), info = ZTYPE[z.kind] || ZTYPE.walker;
  const f = facing || zombieFacing(z);
  let frame = forceFrame;
  if (frame < 0) {
    const max = ATTACK_CD[z.kind] || 1.0, since = max - (z.attackCooldown ?? -9);
    if (since >= 0 && since < 0.16) frame = 3; else if (since >= 0 && since < 0.38) frame = 4;
    else { const seed = (parseInt(String(z.id).replace(/\D/g, ""), 10) || 0) * 97; frame = Math.floor((now + seed) / info.walk) % 3; }
  }
  const feet = z.radius ? z.radius * 0.8 : 12;
  const sc = ZSIDE_SCALE[z.kind] || 1;
  ctx.save(); ctx.translate(Math.round(z.x), Math.round(z.y) + feet); ctx.scale(f * sc, sc); ctx.translate(0, -feet); ctx.globalAlpha = alpha; ctx.imageSmoothingEnabled = false;
  const flash = feel.flash.get(z.id);
  if (flash && now - flash < 90) ctx.filter = "brightness(2.6)";
  ctx.drawImage(img, frame * ZSPR.cellW, 0, ZSPR.cellW, ZSPR.cellH, -ZSPR.anchorX, feet - ZSPR.cellH, ZSPR.cellW, ZSPR.cellH);
  ctx.restore();
  return { feet, h: info.h };
}
function drawZombieDir8(z, img8, side) {
  const now = performance.now(), info = ZTYPE[z.kind] || ZTYPE.walker, a = zombieAngle(z);
  if (z.kind === "mutant" && z.slam > 0 && img8.naturalWidth) return drawMutantWhip(z, img8, info);
  if (z.kind === "brute" && z.slam > 0 && slamImg.naturalWidth) {          // brute ground slam
    if (!slamStart.has(z.id)) slamStart.set(z.id, now - (SLAM_T.total - z.slam) * 1000);
    const t = (now - slamStart.get(z.id)) / 1000;
    const frame = t < .25 ? 0 : t < .5 ? 1 : t < SLAM_T.windup ? 2 : t < SLAM_T.windup + .15 ? 3 : t < SLAM_T.windup + .38 ? 4 : 5;
    const row = ROW_OF_OCT[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8], feet = z.radius ? z.radius * 0.8 : 12, C = SLAM_CELL;
    ctx.save(); ctx.translate(Math.round(z.x), Math.round(z.y)); ctx.imageSmoothingEnabled = false;
    const flash = feel.flash.get(z.id); if (flash && now - flash < 90) ctx.filter = "brightness(2.6)";
    ctx.drawImage(slamImg, frame * C.cellW, row * C.cellH, C.cellW, C.cellH, -C.anchorX, feet - C.feetY, C.cellW, C.cellH);
    ctx.restore();
    return { feet, h: info.h };
  }
  slamStart.delete(z.id); whipStart.delete(z.id);
  const anim = ZD8_ANIM[z.kind] || { walk: 6 };
  const since = attackAge(z), attacking = since >= 0 && since < (anim.dur || (anim.attack ? 0.45 : 0.38));
  let face = a;
  if (FACE_TARGET[z.kind]) { const t = state.players.get(z.targetId); if (t && Math.hypot(t.x - z.x, t.y - z.y) < 500) face = Math.atan2(t.y - z.y, t.x - z.x); }
  if (attacking && !anim.attack && !anim.slash && side?.naturalWidth) return drawZombieSprite(z, side, 1, since < 0.16 ? 3 : 4, Math.cos(a) < 0 ? -1 : 1);   // attack: side-view frames
  const row = ROW_OF_OCT[((Math.round(face / (Math.PI / 4)) % 8) + 8) % 8];
  const seed = (parseInt(String(z.id).replace(/\D/g, ""), 10) || 0) * 97;
  let frame = 0, bob = 0;
  if (attacking && anim.slash) for (const [t0, f] of anim.slash) { if (since >= t0) frame = f; }
  else if (attacking && anim.attack) frame = anim.attack[since < 0.2 ? 0 : 1];
  else if (anim.lurch) { frame = anim.idle || 0; bob = Math.abs(Math.sin((now + seed) / 95)) * 4; }   // galloping lurch on the ready frame
  else frame = Math.floor((now + seed) / (info.walk * .55)) % anim.walk;
  const feet = z.radius ? z.radius * 0.8 : 12;
  ctx.save(); ctx.translate(Math.round(z.x), Math.round(z.y)); ctx.imageSmoothingEnabled = false;
  const flash = feel.flash.get(z.id); if (flash && now - flash < 90) ctx.filter = "brightness(2.6)";
  const C = ZD8_CELLS[z.kind] || ZD8_CELLS.runner;
  ctx.drawImage(img8, frame * C.cellW, row * C.cellH, C.cellW, C.cellH, -C.anchorX, feet - C.feetY - bob, C.cellW, C.cellH);
  if (anim.claw !== undefined && attacking && since > .14 && since < .46) {   // claw marks flash in front of it
    const k = (since - .14) / .32; ctx.filter = "none"; ctx.globalAlpha = 1 - k * k;
    ctx.drawImage(img8, anim.claw * C.cellW, row * C.cellH, C.cellW, C.cellH, -C.anchorX + Math.cos(face) * 38, feet - C.feetY - 10 + Math.sin(face) * 24, C.cellW, C.cellH);
  }
  ctx.restore();
  return { feet, h: info.h };
}
function drawZombieAny(z) {
  if (z.kind === "hivemind") return drawHivemind(z);
  if (z.kind === "butcher" && butcherImgs.walk.naturalWidth) return drawButcher(z);
  const img = zombieImgs[z.kind], img8 = zdir8[z.kind];
  if (!img || !img.complete || !img.naturalWidth) { drawZombie(z); drawHitFlash(z); return; }   // bosses (no art yet) use the old drawing
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(z.x, z.y + (z.radius || 14) * 0.8, (z.radius || 14) * 1.05, 4, 0, 0, 7); ctx.fill(); ctx.restore();
  if (z.kind === "brute" && z.slam > 0) {   // danger zone: fills up during the wind-up so you can get out
    const st = slamStart.get(z.id), t = st ? (performance.now() - st) / 1000 : SLAM_T.total - z.slam, k = Math.max(0, Math.min(1, t / SLAM_T.windup));
    if (t < SLAM_T.windup + .1) {
      ctx.save(); const cy = z.y + (z.radius || 14) * 0.8;
      ctx.fillStyle = `rgba(255,70,50,${.10 + .18 * k})`; ctx.strokeStyle = `rgba(255,90,60,${.5 + .4 * k})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(z.x, cy, SLAM_T.radius, SLAM_T.radius * .5, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = `rgba(255,110,60,.35)`; ctx.beginPath(); ctx.ellipse(z.x, cy, SLAM_T.radius * k, SLAM_T.radius * .5 * k, 0, 0, 7); ctx.fill();
      ctx.restore();
    }
  }
  const { feet, h } = img8?.complete && img8.naturalWidth ? drawZombieDir8(z, img8, img) : drawZombieSprite(z, img);
  if (z.hp < z.maxHp) { // small health bar once hurt
    const w = Math.max(24, (z.radius || 14) * 2), y = z.y + feet - h - 6;
    ctx.fillStyle = "#241f1c"; ctx.fillRect(z.x - w / 2, y, w, 4); ctx.fillStyle = "#b5c26b"; ctx.fillRect(z.x - w / 2, y, w * Math.max(0, z.hp / z.maxHp), 4);
  }
}
// Bodies stay on the ground for a few seconds after a kill, then fade.
const corpses = [];
function addCorpse(p) { if (!zombieImgs[p.kind]) return; corpses.push({ ...p, t: performance.now() }); if (corpses.length > 40) corpses.shift(); }
function drawCorpses() {
  const now = performance.now();
  for (let i = corpses.length - 1; i >= 0; i--) {
    const c = corpses[i], age = now - c.t; if (age > 6000) { corpses.splice(i, 1); continue; }
    if (!inView(c.x, c.y)) continue;
    const img = zombieImgs[c.kind]; if (!img?.complete) continue;
    drawZombieSprite({ id: "dead", kind: c.kind, x: c.x, y: c.y, radius: c.r }, img, age > 4500 ? 1 - (age - 4500) / 1500 : 1, 5, c.facing);
  }
}
function drawZombie(z){
  const brute=z.kind==='brute'||z.boss, runner=z.kind==='runner', spit=z.kind==='spitter', mutant=z.kind==='mutant';
  const skin=z.boss?'#9c4544':brute?'#777568':runner?'#9a9a67':spit?'#6c8754':mutant?'#94618b':'#778b76';
  const sc=z.boss?1.55:brute?1.25:1;
  ctx.save();ctx.translate(Math.round(z.x),Math.round(z.y));ctx.scale(sc,sc);
  // cast shadow and torn boots
  px(-z.radius-5, z.radius-1, z.radius*2+10,5,'#101516');
  px(-z.radius*.72,z.radius-5,9,8,'#171b1b');px(z.radius*.25,z.radius-5,10,8,'#171b1b');
  // ragged trousers and torso silhouette
  px(-z.radius*.58,0,z.radius*1.16,z.radius+5,'#303332');
  px(-z.radius*.85,-z.radius*.48,z.radius*1.7,z.radius*1.12,skin);
  px(-z.radius*.72,-z.radius*.35,z.radius*1.44,5,'#b3a38a');
  px(-z.radius*.95,-z.radius*.28,7,z.radius*.82,skin);px(z.radius*.75,-z.radius*.22,7,z.radius*.78,skin);
  // torn sleeves, exposed wounds and armor scraps
  px(-z.radius*.78,2,7,5,'#4a3731');px(z.radius*.28,5,8,4,'#4a3731');
  px(-z.radius*.34,z.radius*.1,7,5,'#b44b3e');px(z.radius*.12,-z.radius*.1,6,4,'#252a28');
  // oversized pixel head, jaw and hair
  px(-z.radius*.57,-z.radius*1.08,z.radius*1.14,z.radius*.76,skin);
  px(-z.radius*.5,-z.radius*1.13,z.radius,5,'#252b28');
  px(-z.radius*.48,-z.radius*.48,z.radius*.96,5,'#342d29');
  px(-z.radius*.32,-z.radius*.77,5,4,'#f3c56c');px(z.radius*.12,-z.radius*.77,5,4,'#f3c56c');
  px(-z.radius*.24,-z.radius*.55,9,3,'#1a1b19');
  if(spit){px(-z.radius*.65,-z.radius*.18,8,9,'#91c75a');px(z.radius*.4,-z.radius*.1,8,8,'#91c75a');}
  if(brute){px(-z.radius*.95,-z.radius*.4,8,13,'#5b625d');px(z.radius*.72,-z.radius*.38,8,13,'#5b625d');px(-z.radius*.55,-z.radius*1.2,8,8,'#6d302e');px(z.radius*.22,-z.radius*1.2,8,8,'#6d302e');}
  if(mutant){px(-z.radius*.8,-z.radius*1.25,8,8,'#b9d65e');px(z.radius*.45,-z.radius*1.25,8,8,'#b9d65e');}
  if(z.boss){px(-16,-z.radius*1.5,10,16,'#c58c46');px(7,-z.radius*1.55,10,18,'#c58c46');px(-5,-z.radius*1.2,10,5,'#e8c46d');}
  ctx.restore();
  // compact pixel health strip
  px(z.x-z.radius,z.y-z.radius-16,z.radius*2,5,'#171b1b');px(z.x-z.radius+1,z.y-z.radius-15,(z.radius*2-2)*Math.max(0,z.hp/z.maxHp),3,z.boss?'#ef4945':'#a8c76b');
  if(z.boss){ctx.fillStyle='#f4e7ce';ctx.font='bold 12px monospace';ctx.textAlign='center';ctx.fillText(String(z.kind).toUpperCase(),z.x,z.y-z.radius-22);}
}
// Which way the sprite looks: your own character reacts instantly to your keys/aim; others use the server value.
function survivorPose(p){
  let facing=p.facing||1,aim=p.aim||0;
  if(p.sessionId===myId&&state.phase==="playing"){
    const h=(keys.d||keys.arrowright?1:0)-(keys.a||keys.arrowleft?1:0),v=(keys.s||keys.arrowdown?1:0)-(keys.w||keys.arrowup?1:0);
    if(h)facing=h;
    if(firing){aim=aimAngle(p);if(!h)facing=Math.cos(aim)<0?-1:1;}
    else if(h||v)aim=Math.atan2(v,h);
  }
  return {facing,aim};
}
// ---------- Game feel: hit flash, damage numbers, splats, screen shake, hurt flash ----------
// All of it is worked out on this screen from changes in the game state, so it shows for every
// source of damage (your shots, teammates, turrets, mines) without extra network traffic.
const feel={hp:new Map(),last:new Map(),flash:new Map(),nums:[],parts:[],stains:[],shakeUntil:0,shakePow:0,hurtUntil:0,myHp:null};
function shake(power,ms){const now=performance.now();if(now+ms>feel.shakeUntil)feel.shakeUntil=now+ms;feel.shakePow=Math.max(feel.shakePow*(now<feel.shakeUntil?1:0),power);}
function shakeOffset(){const now=performance.now();if(now>feel.shakeUntil||matchMedia("(prefers-reduced-motion: reduce)").matches){feel.shakePow=0;return{x:0,y:0};}const k=feel.shakePow;return{x:(Math.random()-.5)*k,y:(Math.random()-.5)*k};}
function updateFeel(){
 if(!state)return;const now=performance.now(),seen=new Set();
 for(const z of state.zombies.values()){
  seen.add(z.id);const prev=feel.hp.get(z.id);
  if(prev!==undefined&&z.hp<prev-0.5){const dmg=prev-z.hp;feel.flash.set(z.id,now);feel.last.set(z.id,now);playSfx("zhit",z.x,z.y);
   const n=feel.nums.find(n=>n.id===z.id&&now-n.t<120);if(n){n.v+=dmg;n.t=now;}else feel.nums.push({id:z.id,x:z.x+(Math.random()-.5)*14,y:z.y-z.radius-8,v:dmg,t:now,boss:z.boss});
   if(z.boss&&dmg>=40)shake(3,120);}
  feel.hp.set(z.id,z.hp);feel.pos=feel.pos||new Map();feel.pos.set(z.id,{x:z.x,y:z.y,r:z.radius,boss:z.boss,low:z.hp<z.maxHp*.35,kind:z.kind,facing:zface.get(z.id)||1});
 }
 // Zombies that vanished right after being hit (or while low) died: splat them.
 for(const id of [...feel.hp.keys()])if(!seen.has(id)){const p=feel.pos?.get(id);
  if(p&&(now-(feel.last.get(id)||0)<400||p.low)){splat(p.x,p.y,p.boss?34:10,p.boss);addCorpse(p);}
  zface.delete(id);
  feel.hp.delete(id);feel.last.delete(id);feel.flash.delete(id);feel.pos?.delete(id);}
 // You got hurt: red edge flash + small shake.
 const me=state.players.get(myId);
 if(me&&feel.myHp!==null&&me.hp<feel.myHp-0.5&&state.phase==="playing"){feel.hurtUntil=now+220;shake(4,140);}
 feel.myHp=me?me.hp:null;
}
function splat(x,y,count,big){
 for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,s=40+Math.random()*(big?220:120);feel.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,t:performance.now(),life:350+Math.random()*250,c:Math.random()<.6?'#6f8a3c':'#2f3b22',sz:big?4:3});}
 feel.stains.push({x,y,r:(big?26:10)+Math.random()*6,t:performance.now()});if(feel.stains.length>60)feel.stains.shift();
 if(big)shake(9,420);
}
// Burnt craters left by rockets and grenades (art: fx/dante-scorch.png). They don't stay long: 5s, then fade over 2s.
// kind "hot": rocket / crate blast (starts glowing, cools down); "big": big grenade; "small": small grenade.
const scorches = [];
function scorch(x, y, s = 1, kind = "hot") { scorches.push({ x, y, s, kind, v: Math.floor(Math.random() * 4), flip: Math.random() < .5, t: performance.now() }); if (scorches.length > 70) scorches.shift(); }
function drawScorches() {
  const now = performance.now(), im = dImgs.scorch; if (!im?.naturalWidth) return;
  for (let i = scorches.length - 1; i >= 0; i--) {
    const c = scorches[i], age = (now - c.t) / 1000; if (age > 7) { scorches.splice(i, 1); continue; }
    const row = c.kind === "hot" ? 2 : c.kind === "big" ? 0 : 1, col = c.kind === "hot" ? Math.min(3, Math.floor(age / .7)) : c.v;
    const sc = c.s * (c.kind === "small" ? .55 : .7);
    ctx.save(); ctx.globalAlpha = Math.min(1, age * 6) * (age > 5 ? 1 - (age - 5) / 2 : 1); ctx.imageSmoothingEnabled = false;
    ctx.translate(c.x, c.y + 6); if (c.flip) ctx.scale(-1, 1); ctx.scale(sc, sc);
    ctx.drawImage(im, col * 180, row * 110, 180, 110, -90, -55, 180, 110); ctx.restore();
  }
}
function drawStains(){drawScorches();const now=performance.now();for(let i=feel.stains.length-1;i>=0;i--){const s=feel.stains[i],age=(now-s.t)/1000;if(age>25){feel.stains.splice(i,1);continue;}
 ctx.save();ctx.globalAlpha=.32*(1-age/25);ctx.fillStyle='#3b4a24';ctx.beginPath();ctx.ellipse(s.x,s.y+4,s.r,s.r*.6,0,0,7);ctx.fill();ctx.restore();}}
function drawHitFlash(z){const t=feel.flash.get(z.id);if(!t)return;const age=performance.now()-t;if(age>90)return;
 ctx.save();ctx.globalAlpha=.75*(1-age/90);ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(z.x,z.y-z.radius*.3,z.radius*(z.boss?1.4:1.05),0,7);ctx.fill();ctx.restore();}
function drawFeel(){
 const now=performance.now(),dt=1/60;
 for(let i=feel.parts.length-1;i>=0;i--){const p=feel.parts[i],age=now-p.t;if(age>p.life){feel.parts.splice(i,1);continue;}
  p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.9;p.vy*=.9;ctx.globalAlpha=1-age/p.life;ctx.fillStyle=p.c;ctx.fillRect(p.x-p.sz/2,p.y-p.sz/2,p.sz,p.sz);}
 ctx.globalAlpha=1;ctx.textAlign='center';
 for(let i=feel.nums.length-1;i>=0;i--){const n=feel.nums[i],age=now-n.t;if(age>700){feel.nums.splice(i,1);continue;}
  const k=age/700,big=n.v>=40;ctx.globalAlpha=1-k*k;ctx.font=`bold ${big?16:12}px monospace`;ctx.lineWidth=3;ctx.strokeStyle='#0b0f10';
  const txt=String(Math.round(n.v)),y=n.y-k*26;ctx.strokeText(txt,n.x,y);ctx.fillStyle=n.boss?'#ff8a6a':big?'#ffd27a':'#f3ead6';ctx.fillText(txt,n.x,y);}
 ctx.globalAlpha=1;
}
function drawHurt(){const now=performance.now();if(now>feel.hurtUntil)return;const k=(feel.hurtUntil-now)/220;
 const g=ctx.createRadialGradient(W/2,H/2,H*.35,W/2,H/2,H*.75);g.addColorStop(0,'rgba(200,30,30,0)');g.addColorStop(1,`rgba(200,30,30,${.45*k})`);ctx.fillStyle=g;ctx.fillRect(0,0,W,H);}

// Bullet tracers, muzzle flashes and launcher blasts (sent by the server for every player's shots).
const TRACER={pistol:'#ffe7a3',smg:'#ffd27a',rifle:'#ffcf66',shotgun:'#ffb05a',sniper:'#bff3ff',launcher:'#ff8a3d'};
function drawShotFx(){
  const now=performance.now();
  for(let i=fx.length-1;i>=0;i--){const f=fx[i],age=now-f.t;if(!['spit','chop','clang','deflect','wreck','laser','healfx','summon','raven','dante','hive','sofea','briggs','astra'].includes(f.type)&&age>(f.type==='boom'?380:f.type==='slam'?520:f.type==='swing'?(f.heavy?280:160):140)){fx.splice(i,1);continue;}
   if(f.type==='chop')continue;
   if(f.type==='wreck'||f.type==='laser'||f.type==='healfx'||f.type==='summon'){if(!drawViktorFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='raven'){if(!drawRavenFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='dante'){if(!drawDanteFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='sofea'){if(!drawSofeaFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='briggs'){if(!drawBriggsFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='astra'){if(!drawAstraFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='hive'){if(!drawHiveFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='deflect'){if(!drawDeflect(f,age))fx.splice(i,1);continue;}   // drawn on the ground (drawGroundFx)
   if(f.type==='clang'){if(age>320){fx.splice(i,1);continue;}const k=age/320;ctx.save();ctx.globalAlpha=1-k;ctx.strokeStyle='#fff6d0';ctx.lineWidth=2;for(let j=0;j<6;j++){const a=j*1.05+f.x;ctx.beginPath();ctx.moveTo(f.x+Math.cos(a)*4,f.y+Math.sin(a)*4);ctx.lineTo(f.x+Math.cos(a)*(8+16*k),f.y+Math.sin(a)*(8+16*k));ctx.stroke();}ctx.font='bold 11px monospace';ctx.textAlign='center';ctx.fillStyle='#d8e4ff';ctx.fillText('ARMOR',f.x,f.y-12-10*k);ctx.restore();continue;}
   if(f.type==='spit'){if(drawSpit(f,age))continue;fx.splice(i,1);continue;}
   if(f.type==='slam'){const k=age/520;ctx.save();ctx.globalAlpha=.7*(1-k);ctx.strokeStyle='#e8d2a6';ctx.lineWidth=6*(1-k)+2;ctx.beginPath();ctx.ellipse(f.x,f.y+20,f.r*(.3+.8*k),f.r*.5*(.3+.8*k),0,0,7);ctx.stroke();ctx.restore();continue;}
   ctx.save();
   if(f.type==='shot'){const k=1-age/140;ctx.globalAlpha=k;ctx.strokeStyle=TRACER[f.w]||'#ffcf66';ctx.lineWidth=f.w==='sniper'?3:2;ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=8;
    f.a.forEach((a,j)=>{const ox=f.x+Math.cos(a)*16,oy=f.y+Math.sin(a)*16;ctx.beginPath();ctx.moveTo(ox,oy);ctx.lineTo(f.x+Math.cos(a)*f.len[j],f.y+Math.sin(a)*f.len[j]);ctx.stroke();});
    if(age<60){ctx.fillStyle='#fff3c4';ctx.beginPath();ctx.arc(f.x+Math.cos(f.a[0])*20,f.y+Math.sin(f.a[0])*20,5,0,7);ctx.fill();}}
   else if(f.type==='swing'){const life=f.heavy?280:160;if(age>life){ctx.restore();fx.splice(i,1);continue;}const k=age/life;ctx.globalAlpha=.8*(1-k);ctx.strokeStyle=f.heavy?'#ffd9a0':'#f3f6f2';ctx.lineWidth=f.heavy?9:4;ctx.shadowColor='#ffffff';ctx.shadowBlur=10;ctx.beginPath();ctx.arc(f.x,f.y,f.r*(.75+.25*k),f.a-f.arc*(1-k*.4),f.a+f.arc*(1-k*.4));ctx.stroke();}
   else{const k=age/380;ctx.globalAlpha=1-k;ctx.strokeStyle='#ff8a3d';ctx.lineWidth=4;ctx.shadowColor='#ff8a3d';ctx.shadowBlur=16;ctx.beginPath();ctx.arc(f.x,f.y,f.r*(.35+.65*k),0,7);ctx.stroke();ctx.fillStyle='rgba(255,170,80,.25)';ctx.fill();}
   ctx.restore();}
}
function drawCrosshair(){
  const me=V(state?.players.get(myId));if(!me||!me.alive||state.phase!=='playing'||wheel)return;
  ctx.save();const a=aimAngle(me);
  ctx.strokeStyle='rgba(255,181,109,.28)';ctx.setLineDash([4,6]);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(me.x+Math.cos(a)*22,me.y-4+Math.sin(a)*22);ctx.lineTo(me.x+Math.cos(a)*90,me.y-4+Math.sin(a)*90);ctx.stroke();ctx.setLineDash([]);
  ctx.strokeStyle=firing?'#ffd08a':'#ffb56d';ctx.lineWidth=2;ctx.beginPath();ctx.arc(mouse.x,mouse.y,firing?7:9,0,7);ctx.stroke();
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ctx.beginPath();ctx.moveTo(mouse.x+dx*12,mouse.y+dy*12);ctx.lineTo(mouse.x+dx*17,mouse.y+dy*17);ctx.stroke();}
  ctx.restore();
}
// ---------- Side-view survivor sprites for heroes without 8-direction art (client/assets/sprites/<class>.png, 3 rows x 3 frames: idle / walk / shoot) ----------
const SPRITE_URLS = {   // heroes with 8-direction art (dir8 below) don't need these
  sniper: "assets/sprites/sniper.png",
};
const SPR = { cellW: 128, cellH: 72, anchorX: 44, scale: 0.82, feet: 17 };
const sprites = {};
for (const [cls, url] of Object.entries(SPRITE_URLS)) { const img = new Image(); img.src = url; sprites[cls] = img; }
const anim = new Map(); // per player: last position, when they last moved / shot
function animState(p) {
  const now = performance.now(); let a = anim.get(p.sessionId);
  if (!a) { a = { x: p.x, y: p.y, movedAt: 0, shotAt: 0 }; anim.set(p.sessionId, a); }
  if (Math.hypot(p.x - a.x, p.y - a.y) > 0.4) { a.movedAt = now; a.x = p.x; a.y = p.y; }
  return a;
}
// Melee weapon / medkit in hand when that slot is selected (the sprite art only shows guns).
function drawHeldItem(p, pose) {
  if (!p.alive || (p.activeSlot !== 1 && p.activeSlot !== 5)) return;
  if (p.activeSlot === 1 && dir8[p.characterClass]?.naturalWidth && dir8Block(p) > 0) return;
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y) - 2); ctx.rotate(pose.aim); if (Math.cos(pose.aim) < 0) ctx.scale(1, -1);
  if (p.activeSlot === 1) { const m = p.melee;
    if (m === "bat") px(6, -2, 24, 5, "#8a5a32"); else if (m === "axe") { px(6, -1, 20, 3, "#6b4a2b"); px(22, -6, 7, 10, "#b9c2bd"); }
    else if (m === "katana") { px(6, -1, 6, 3, "#2a2a2a"); px(12, -1, 22, 2, "#e6ecea"); } else px(6, -1, 12, 2, "#d6dcda"); }
  else { px(8, -5, 11, 10, "#e9e4d6"); px(12, -4, 3, 8, "#d9443b"); px(9, -1, 9, 2, "#d9443b"); }
  ctx.restore();
}
function drawSurvivorLabels(p) {
  if (p.alive && p.shadow > 0 && p.sessionId !== myId) return;   // an invisible Raven shows no name to others
  if (p.alive && p.slowed > 0) {   // slowed: cold blue mist at the feet
    ctx.save(); ctx.globalAlpha = .55; ctx.fillStyle = "#9fc4e8"; ctx.beginPath(); ctx.ellipse(p.x, p.y + 14, 18, 6, 0, 0, 7); ctx.fill(); ctx.restore();
  }
  if (p.alive && p.stunned > 0) {   // stunned: little stars circling the head
    const t = performance.now() / 260;
    ctx.save(); ctx.font = "bold 13px monospace"; ctx.textAlign = "center"; ctx.fillStyle = "#ffe27a"; ctx.shadowColor = "#000"; ctx.shadowBlur = 3;
    for (let i = 0; i < 3; i++) { const a = t + i * 2.1; ctx.fillText("✦", p.x + Math.cos(a) * 14, p.y - 52 + Math.sin(a) * 4); }
    ctx.restore();
  }
  // Fire axe charge ring: fills over 1 second, pulses orange when the heavy swing is ready
  const mine = p.sessionId === myId && axeChargeAt && p.activeSlot === 1 && p.melee === "axe";
  if (p.alive && (mine || p.charging)) {
    const k = mine ? Math.min(1, (performance.now() - axeChargeAt) / AXE_CHARGE_MS) : 1, full = k >= 1;
    ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.45)";
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 14, 20, 8, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = full ? `rgba(255,${150 + 60 * Math.sin(performance.now() / 70)},60,1)` : "#ffd9a0";
    if (full) { ctx.shadowColor = "#ff9a3c"; ctx.shadowBlur = 12; }
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 14, 20, 8, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = "#f2ead9"; ctx.font = "11px monospace"; ctx.textAlign = "center";
  const rideV = state?.vehicles?.get(p.sessionId), nameLift = rideV?.kind === "mecha" ? 46 + 26 * (rideV.phase === "ride" ? 1 : Math.max(0, 1 - rideV.left)) : rideV?.phase === "ride" ? (rideV.kind === "heli" ? 116 : 76) : 46;   // above Sofea's tank / helicopter / mecha
  ctx.fillText(p.name + (p.sessionId === myId ? " (YOU)" : ""), p.x, p.y - nameLift);
  if (!p.alive) { ctx.fillStyle = "#ff7568"; ctx.fillText(p.bledOut ? "BLED OUT · BACK NEXT WAVE" : "DOWN " + Math.ceil(p.bleedout || 0) + "s · F TO REVIVE", p.x, p.y + 32); }
}
// ---------- 8-direction survivor sprites (art: client/assets/sprites/dir8/<class>.png) ----------
// Made by tools/extract-directions.py: one block of 8 rows per weapon (order in "blocks").
// Rows: down, down-right, right, up-right, up, up-left, left, down-left.
// Columns: idle, walk 1-3, attack 1 (stab / wind-up / shoot), attack 2 (slash / hit / muzzle flash).
// Add a line here when a new survivor's sheets are ready. Melee weapons without art use the knife.
const DIR8 = {
  assault: { url: "assets/sprites/dir8/assault.png", blocks: ["gun", "knife", "bat", "axe"] },
  engineer: { url: "assets/sprites/dir8/engineer.png", blocks: ["gun", "knife"] },
  scout: { url: "assets/sprites/dir8/scout.png", blocks: ["gun", "katana", "fire"] },
  juggernaut: { url: "assets/sprites/dir8/juggernaut.png", blocks: ["shotgun", "knife", "bat", "axe", "bastion", "warcry"] },   // Briggs: "bastion" / "warcry" = his E / Q cast poses (4 frames)
  operator: { url: "assets/sprites/dir8/operator.png", blocks: ["gun", "knife", "bat", "axe", "radio"] },   // Sofea: "radio" = her call for the tank / helicopter (4 frames)
  dispatcher: { url: "assets/sprites/dir8/dispatcher.png", blocks: ["gun", "knife", "bat", "axe", "radio"],   // Astra: "radio" = his call for medics / police / workers (3 frames)
    // his sheets' diagonals were drawn facing the wrong way: row -> [row to use, mirrored?]. The rifle has real up-right / up-left
    // frames now (tools/add-astra-diagonals.py); knife / bat / axe / radio still borrow the back view (bat's up-left is fine)
    fix: { gun: { 7: [1, 1] }, all: { 3: [4, 0], 5: [4, 1], 7: [1, 1] }, bat: { 3: [5, 1] } } },
  demolitionist: { url: "assets/sprites/dir8/demolitionist.png", blocks: ["launcher", "rifle", "shotgun", "knife", "bat", "axe"] },   // guns by name; other guns use the rifle   // Raven: "fire" = her burning katana
};
const D8 = { cellW: 112, cellH: 88, anchorX: 56, feetY: 80 };
const dir8 = {};
for (const [cls, d] of Object.entries(DIR8)) { const img = new Image(); img.src = d.url; dir8[cls] = img; }
// 8 compass directions (0 = right, going clockwise on screen) -> sheet row
const ROW_OF_OCT = [2, 1, 0, 7, 6, 5, 4, 3];
function dir8Block(p) {
  const blocks = DIR8[p.characterClass]?.blocks || [];
  if (p.activeSlot !== 1) { const g = blocks.indexOf(p.weapon); return g >= 0 ? g : blocks.includes("gun") ? blocks.indexOf("gun") : Math.max(0, blocks.indexOf("rifle")); }
  if (p.melee === "katana" && p.fire > 0 && blocks.includes("fire")) return blocks.indexOf("fire");
  const b = blocks.indexOf(p.melee); return b >= 0 ? b : blocks.indexOf("knife");
}
function drawSurvivorDir8(p, pose, img) {
  const now = performance.now(), a = animState(p);
  if (p.characterClass === "scout" && drawRavenSpecial(p, img, now)) return true;
  if (p.characterClass === "demolitionist" && drawDantePlacing(p, now)) return true;
  if (p.characterClass === "operator" && p.alive && drawSofea(p, img, now)) return true;
  const oct = ((Math.round(pose.aim / (Math.PI / 4)) % 8) + 8) % 8; let row = ROW_OF_OCT[oct];
  const holdingGun = p.activeSlot === 2 || p.activeSlot === 3, shotAge = now - a.shotAt;
  const block = Math.max(0, dir8Block(p)), melee = p.activeSlot === 1 && !["gun", "launcher", "rifle", "shotgun"].includes(DIR8[p.characterClass].blocks[block]), swingAge = now - (a.swingAt || 0);
  let col = 0;                                                                   // idle
  if (melee && a.heavy && swingAge < 420) col = 5;                              // axe heavy swing: hold the hit frame longer
  else if (melee && swingAge < 300) col = swingAge < 120 ? 4 : 5;               // stab / wind-up, then slash / hit
  else if (melee && p.charging) col = 4;                                        // axe raised while charging
  else if (holdingGun && shotAge < 320) col = shotAge < 90 ? 5 : 4;             // shooting (5 = muzzle flash)
  else if (now - a.movedAt < 160) col = 1 + Math.floor(now / 130) % 3;          // walking
  let blk = block;
  if (p.characterClass === "juggernaut") {
    const c = briggsCast(p, now);
    if (c) { blk = c.block; col = c.col; }
    if (p.ultActive > 0 && p.alive) briggsFire(p, now, false);   // War Cry: back flames behind him, his normal frames on top
  }
  if (p.characterClass === "dispatcher") { const s = now - (astraCall.get(p.sessionId) || -1e9); if (s < 450) { blk = 4; col = Math.min(3, Math.floor(s / 112.5)); } }   // radio call (E / Q / R): raise, talk, signal, lower
  let flip = 0; const fix = DIR8[p.characterClass].fix, rowFix = fix && (fix[DIR8[p.characterClass].blocks[blk]] || fix.all);
  if (rowFix?.[row]) [row, flip] = rowFix[row];
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y));
  if (!p.alive) { ctx.rotate(Math.PI / 2 * 0.9); ctx.globalAlpha = .55; ctx.filter = "grayscale(1)"; }
  else if (p.shadow > 0) ravenHidden(p);
  if (flip) ctx.scale(-1, 1);   // mirrored diagonal (the cell is centred on the feet, so it flips in place)
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, col * D8.cellW, (blk * 8 + row) * D8.cellH, D8.cellW, D8.cellH, -D8.anchorX, SPR.feet - D8.feetY, D8.cellW, D8.cellH);
  ctx.restore();
  if (p.characterClass === "juggernaut" && p.ultActive > 0 && p.alive) briggsFire(p, now, true);   // burning ring in front
  if (p.characterClass === "juggernaut" && p.skillT > 0 && p.alive) briggsDome(p, now);
  return true;
}

function drawSurvivorSprite(p, pose) {
  const d8 = dir8[p.characterClass];
  if (d8 && d8.complete && d8.naturalWidth) return drawSurvivorDir8(p, pose, d8);
  const img = sprites[p.characterClass];
  if (!img || !img.complete || !img.naturalWidth) return false;
  const now = performance.now(), a = animState(p);
  const holdingGun = p.activeSlot === 2 || p.activeSlot === 3;
  const shotAge = now - a.shotAt;
  let row = 0, frame = Math.floor(now / 420) % 3;                       // idle
  if (holdingGun && shotAge < 320) { row = 2; frame = shotAge < 90 ? 2 : shotAge < 200 ? 1 : 0; }   // shooting (frame 2 = muzzle flash)
  else if (now - a.movedAt < 160) { row = 1; frame = Math.floor(now / 130) % 3; }                    // walking
  ctx.save();
  ctx.translate(Math.round(p.x), Math.round(p.y));
  if (!p.alive) { ctx.rotate(pose.facing * Math.PI / 2 * 0.9); ctx.globalAlpha = .55; ctx.filter = "grayscale(1)"; }
  ctx.scale(pose.facing * SPR.scale, SPR.scale);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, frame * SPR.cellW, row * SPR.cellH, SPR.cellW, SPR.cellH, -SPR.anchorX, SPR.feet / SPR.scale - SPR.cellH, SPR.cellW, SPR.cellH);
  ctx.restore();
  return true;
}

function drawSurvivor(p){
  const pose=survivorPose(p);
  // soft shadow under everyone
  ctx.save();ctx.fillStyle='rgba(0,0,0,.35)';ctx.beginPath();ctx.ellipse(p.x,p.y+17,14,4,0,0,7);ctx.fill();ctx.restore();
  if(drawSurvivorSprite(p,pose)){drawHeldItem(p,pose);drawSurvivorLabels(p);return;}
  ctx.save();ctx.translate(Math.round(p.x),Math.round(p.y));ctx.scale(pose.facing,1);
  const c=p.alive?(p.color||'#69c9d1'):'#555b59';
  // feet, legs, tactical trousers
  px(-10,8,8,10,'#161d20');px(3,8,8,10,'#161d20');px(-9,3,7,9,'#394342');px(3,3,7,9,'#394342');
  // backpack and armored torso
  px(-13,-10,6,16,'#263b3b');block(-9,-12,18,23,'#344d48','#172522','#80968a');
  px(-7,-8,14,4,c);px(-5,0,10,4,'#202b2b');px(-15,-8,5,12,'#59645e');px(10,-8,5,12,'#59645e');
  // head, helmet, visor and face pixels
  px(-7,-23,14,12,'#b68a68');px(-9,-25,18,6,'#202a2b');px(-5,-18,10,3,'#263b3b');px(-5,-16,3,2,'#e4d6b9');px(3,-16,3,2,'#e4d6b9');
  // shoulder insignia and weapon
  px(-12,-9,4,4,'#e5a14e');px(8,-9,4,4,'#e5a14e');
  if(!p.alive){px(-15,-29,30,3,'#e34b43');}
  ctx.restore();
  // weapon arm points where you aim (or where you walk)
  if(p.alive){ctx.save();ctx.translate(Math.round(p.x),Math.round(p.y)-4);ctx.rotate(pose.aim);if(Math.cos(pose.aim)<0)ctx.scale(1,-1);
   if(p.activeSlot===1){const m=p.melee;if(m==='bat')px(6,-2,24,5,'#8a5a32');else if(m==='axe'){px(6,-1,20,3,'#6b4a2b');px(22,-6,7,10,'#b9c2bd');}else if(m==='katana'){px(6,-1,6,3,'#2a2a2a');px(12,-1,22,2,'#e6ecea');}else px(6,-1,12,2,'#d6dcda');}
   else if(p.activeSlot===5){px(8,-5,11,10,'#e9e4d6');px(12,-4,3,8,'#d9443b');px(9,-1,9,2,'#d9443b');}
   else{const long=p.weapon==='sniper'||p.weapon==='launcher';px(6,-2,long?22:16,4,'#252b2b');px(long?26:20,-3,5,5,'#aeb7ad');if(p.weapon==='launcher')px(6,-4,14,8,'#3d4a45');if(p.weapon==='shotgun')px(6,-3,18,6,'#3b2f26');}
   ctx.restore();}
  drawSurvivorLabels(p);
}
// ================= OBJECT ART (client/assets/sprites/objects/<name>.png) =================
const OBJ_URLS = {
  tower: "assets/sprites/objects/tower.png", generator: "assets/sprites/objects/generator.png", barricade: "assets/sprites/objects/barricade.png",
  turret: "assets/sprites/objects/turret.png", mine: "assets/sprites/objects/mine.png",
  fence: "assets/sprites/objects/fence.png", flameTrap: "assets/sprites/objects/flameTrap.png", crate: "assets/sprites/objects/crate.png",
  medkit: "assets/sprites/objects/medkit.png", ammo: "assets/sprites/objects/ammo.png", weaponCase: "assets/sprites/objects/weaponCase.png",
};
const objImgs = {};
for (const [k, url] of Object.entries(OBJ_URLS)) { const img = new Image(); img.src = url; objImgs[k] = img; }
const GEN_OFF = { x: 118, y: 6 };     // generator sits beside the tower (matches the server)
// Draw an object with its bottom-centre at (x, baseY).
function drawObj(name, x, baseY, opts = {}) {
  const img = objImgs[name]; if (!img || !img.complete || !img.naturalWidth) return false;
  ctx.save(); ctx.imageSmoothingEnabled = false;
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  if (opts.filter) ctx.filter = opts.filter;
  ctx.translate(Math.round(x), Math.round(baseY)); if (opts.flip) ctx.scale(-1, 1); if (opts.scale) ctx.scale(opts.scale, opts.scale);
  ctx.drawImage(img, -Math.round(img.width / 2), -img.height);
  ctx.restore(); return true;
}
const powered = () => (state?.generatorFuel || 0) > 0 && (state?.generatorHp || 0) > 0;
function drawTower(cx, cy) {
  if (!drawObj("tower", cx, cy + 40)) return;
  const img = objImgs.tower, t = performance.now();
  const on = Math.sin(t / 260) > -0.2, bx = cx, by = cy + 40 - img.height + 14;
  if (on) { const g = ctx.createRadialGradient(bx, by, 1, bx, by, 26); g.addColorStop(0, "rgba(255,90,60,.85)"); g.addColorStop(1, "rgba(255,40,40,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, 26, 0, 7); ctx.fill(); }
  if ((state.towerHp || 0) < (state.towerMaxHp || 1) * 0.25 && Math.sin(t / 120) > 0) { ctx.fillStyle = "rgba(255,60,40,.12)"; ctx.fillRect(cx - 60, cy - 140, 120, 180); } // flashing when critical
}
function drawGenerator(x, y) {
  const broken = (state.generatorHp || 0) <= 0, empty = (state.generatorFuel || 0) <= 0;
  drawObj("generator", x, y + 18, { filter: broken ? "grayscale(1) brightness(.6)" : empty ? "saturate(.4) brightness(.8)" : undefined });
  if (!broken && !empty && Math.random() < 0.06) feel.parts.push({ x: x + 10, y: y - 40, vx: (Math.random() - .5) * 10, vy: -25, t: performance.now(), life: 900, c: "#6d6a72", sz: 4 });
}
const LOOT_ART = { scrap: "crate", medkit: "medkit", ammo: "ammo", weapon: "weaponCase" };
function drawLoot(item) {
  const bob = Math.sin(performance.now() / 300 + item.x) * 2;
  if (item.kind === "weapon") { const c = item.rarity === "Legendary" ? "255,170,40" : item.rarity === "Epic" ? "190,110,255" : item.rarity === "Rare" ? "90,170,255" : "220,220,220"; const g = ctx.createRadialGradient(item.x, item.y, 2, item.x, item.y, 24); g.addColorStop(0, `rgba(${c},.45)`); g.addColorStop(1, `rgba(${c},0)`); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(item.x, item.y, 24, 0, 7); ctx.fill(); }
  // soft pulsing light on the ground so drops stand out
  const pulse = .5 + .5 * Math.sin(performance.now() / 260 + item.x), lc = item.kind === "gold" ? "255,210,90" : item.kind === "medkit" ? "255,120,110" : "150,220,255";
  ctx.save(); ctx.globalAlpha = .35 + .25 * pulse; ctx.fillStyle = `rgba(${lc},.55)`; ctx.beginPath(); ctx.ellipse(item.x, item.y + 12, 22, 8, 0, 0, 7); ctx.fill(); ctx.restore();
  if (LOOT_ART[item.kind] && drawObj(LOOT_ART[item.kind], item.x, item.y + 12 + bob, { scale: 1.8 })) return;
  if (item.kind === "gold" && drawIcon("gold", item.x, item.y + bob - 6, 36)) return;
  px(item.x - 6, item.y - 4 + bob, 12, 8, "#e5c66a"); px(item.x - 6, item.y - 4 + bob, 12, 2, "#fff0a8"); px(item.x - 6, item.y + 3 + bob, 12, 1, "#8a6a1e");
}
const STRUCT_BASE = { barricade: 20, turret: 16, fence: 18, mine: 8, flameTrap: 14 };
function drawStructure(st) {
  if (st.kind === "heavyTurret") return drawHeavyTurret(st);
  if (st.kind === "demoCharge") return drawDemoCrate(st);
  const base = st.y + (STRUCT_BASE[st.kind] || 14), on = powered(), t = performance.now();
  let flip = false;
  if (st.kind === "turret") { let best = 260, tx = null; for (const z of state.zombies.values()) { const d = Math.hypot(z.x - st.x, z.y - st.y); if (d < best) { best = d; tx = z.x; } } if (tx !== null) flip = tx < st.x; }
  const filter = (st.kind === "fence" || st.kind === "turret" || st.kind === "flameTrap") && !on ? "grayscale(1) brightness(.7)" : st.kind === "fence" && Math.random() < 0.25 ? "brightness(1.5)" : undefined;
  if (!drawObj(st.kind, st.x, base, { flip, filter })) return;
  if (st.kind === "flameTrap" && on) { const f = 0.6 + Math.sin(t / 70 + st.x) * 0.25; const g = ctx.createRadialGradient(st.x, st.y + 4, 2, st.x, st.y + 4, 30); g.addColorStop(0, `rgba(255,140,40,${.45 * f})`); g.addColorStop(1, "rgba(255,80,20,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(st.x, st.y + 4, 30, 0, 7); ctx.fill(); }
  if (st.kind === "mine") { if (Math.sin(t / 200 + st.x) > 0.3) { ctx.fillStyle = "rgba(255,60,40,.8)"; ctx.fillRect(st.x - 1, base - 13, 3, 3); } }
  if (st.hp < st.maxHp && st.kind !== "mine") { const w = 34; ctx.fillStyle = "#241f1c"; ctx.fillRect(st.x - w / 2, base - 52, w, 4); ctx.fillStyle = "#c9a35a"; ctx.fillRect(st.x - w / 2, base - 52, w * Math.max(0, st.hp / st.maxHp), 4); }
}

// ================= CAMERA + WORLD =================
// The map is bigger than the screen. The camera follows you smoothly and leans ahead
// in the direction you're walking. World size comes from the server (worldW / worldH).
const worldW = () => state?.worldW || 3600, worldH = () => state?.worldH || 2280;
const towerX = () => state?.towerX || worldW() / 2, towerY = () => state?.towerY || worldH() / 2;   // the radio tower (painted maps: where it's painted)
const paintedMap = () => { const s = state?.mapLayout; return s && s.startsWith("P:") ? PAINTED[s.slice(2)] || null : null; };
const cam = { x: 0, y: 0, ready: false, last: 0 };
window.__saCam = cam; window.__saPred = () => { const m = me_(); return { id: myId, px: PRED.x, ex: PRED.ex, sx: m?.x, ack: m?.ack, seq: PRED.seq, n: PRED.pending.length, sp: m?.speed }; }; if (SOLO_PREVIEW) window.__saState = () => ({ state, me: me_(), scorches, corpses }); // read-only hook used by automated smoothness tests
// ===================== OWN-PLAYER PREDICTION =====================
// Your survivor moves the instant you press a key (same speed + wall rules as the server), instead of waiting a round trip.
// Every input has a number; the server sends back the last number it applied (player.ack). On each update we start from the
// server's position and replay the inputs it hasn't applied yet. Small differences fade out over ~0.1s instead of snapping.
const PRED = { seq: 0, pending: [], x: 0, y: 0, ok: false, ex: 0, ey: 0, grid: null, src: null };
const P_BODY_R = 12, P_TOWER_HALF = 34, P_GEN_H = 20, P_SOLID = { barricade: 20, turret: 16, fence: 18 }, P_DASH = 50;
function predGrid() {
  const src = state?.mapLayout || ""; if (PRED.src === src && PRED.grid) return PRED.grid;
  const pm = paintedMap(), layout = pm ? paintedLayout(pm) : src ? src.split(";").map(r => { const [k, x, y, f] = r.split(",").map(Number); return { kind: MAP_KINDS[k], x, y, flip: f === 1 }; }).filter(d => d.kind) : [];
  const grid = new Map();
  for (const b of mapBoxes(layout)) for (let gx = Math.floor((b.x - b.hw) / 160); gx <= Math.floor((b.x + b.hw) / 160); gx++) for (let gy = Math.floor((b.y - b.hh) / 160); gy <= Math.floor((b.y + b.hh) / 160); gy++) {
    const k = gx + "," + gy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b);
  }
  PRED.src = src; PRED.grid = grid; return grid;
}
function predSolve(p) {   // same as the server's solveCollisions for a survivor
  const WW = worldW(), WH = worldH(), cx = towerX(), cy = towerY(), boxes = [{ x: cx, y: cy, hw: P_TOWER_HALF, hh: P_TOWER_HALF }, { x: cx + GEN_OFF.x, y: cy + GEN_OFF.y, hw: P_GEN_H, hh: P_GEN_H }];
  for (const st of state.structures.values()) { if (P_SOLID[st.kind]) boxes.push({ x: st.x, y: st.y, hw: P_SOLID[st.kind], hh: P_SOLID[st.kind] }); else if (st.kind === "heavyTurret") boxes.push({ x: st.x, y: st.y - 4, hw: 20, hh: 12 }); }
  const grid = predGrid(), gx = Math.floor(p.x / 160), gy = Math.floor(p.y / 160), seen = new Set();
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const b of grid.get((gx + i) + "," + (gy + j)) || []) if (!seen.has(b)) { seen.add(b); boxes.push(b); }
  for (let pass = 0; pass < 2; pass++) for (const b of boxes) {
    const qx = Math.max(b.x - b.hw, Math.min(p.x, b.x + b.hw)), qy = Math.max(b.y - b.hh, Math.min(p.y, b.y + b.hh));
    let dx = p.x - qx, dy = p.y - qy, d = Math.hypot(dx, dy); if (d >= P_BODY_R) continue;
    if (d < .001) { const ex = [[b.x - b.hw - P_BODY_R - p.x, 0], [b.x + b.hw + P_BODY_R - p.x, 0], [0, b.y - b.hh - P_BODY_R - p.y], [0, b.y + b.hh + P_BODY_R - p.y]].sort((m, n) => Math.hypot(...m) - Math.hypot(...n))[0]; p.x += ex[0]; p.y += ex[1]; }
    else { p.x = qx + dx / d * P_BODY_R; p.y = qy + dy / d * P_BODY_R; }
    p.x = Math.max(18, Math.min(WW - 18, p.x)); p.y = Math.max(18, Math.min(WH - 18, p.y));
  }
}
function predApply(p, inp, me) {   // one input -> moved position (mirrors the server's "input" / "dash" handlers)
  let mx, my;
  if (inp.dash) { let dx = inp.dx, dy = inp.dy; if (!dx && !dy) dx = me.facing || 1; const m = Math.hypot(dx, dy); mx = dx / m * P_DASH; my = dy / m * P_DASH; }
  else {
    if (!inp.dx && !inp.dy) return;
    const m = Math.hypot(inp.dx, inp.dy), sp = me.speed * (me.charging ? .6 : 1) * (me.slowed > 0 ? .5 : 1) * (me.characterClass === "juggernaut" && me.skillT > 0 ? .7 : 1);
    mx = inp.dx / m * sp * inp.dt; my = inp.dy / m * sp * inp.dt;
  }
  const steps = Math.max(1, Math.ceil(Math.hypot(mx, my) / 8)), WW = worldW(), WH = worldH();
  for (let i = 0; i < steps; i++) { p.x = Math.max(18, Math.min(WW - 18, p.x + mx / steps)); p.y = Math.max(18, Math.min(WH - 18, p.y + my / steps)); predSolve(p); }
}
// not while the SERVER is moving you (Raven's dash) or holding you still (Briggs's slam / roar wind-up): then you're drawn from
// the server's smooth updates instead, and prediction picks up again right after
const serverDriven = me => performance.now() - (ravenDash.get(myId)?.t0 ?? -1e9) < 450 || (me.characterClass === "juggernaut" && !!briggsCast(me, performance.now()));
const predicting = me => !!(me && me.alive && state?.phase === "playing" && !state.vehicles?.get(myId) && !(me.stunned > 0) && !serverDriven(me));
function predictInput(me, inp) {
  if (!predicting(me)) { PRED.ok = false; PRED.pending.length = 0; return; }
  if (!PRED.ok) { PRED.x = me.x; PRED.y = me.y; PRED.ok = true; PRED.ex = PRED.ey = 0; }
  PRED.pending.push(inp); if (PRED.pending.length > 60) PRED.pending.shift();
  const p = { x: PRED.x, y: PRED.y }; predApply(p, inp, me); PRED.x = p.x; PRED.y = p.y;
}
function reconcile() {   // on every server update: server position + the inputs it hasn't applied yet
  const me = me_(); if (!predicting(me)) { PRED.ok = false; PRED.pending.length = 0; return; }
  const ack = me.ack || 0; PRED.pending = PRED.pending.filter(i => i.seq > ack);
  const p = { x: me.x, y: me.y }; for (const inp of PRED.pending) predApply(p, inp, me);
  if (!PRED.ok) { PRED.x = p.x; PRED.y = p.y; PRED.ok = true; PRED.ex = PRED.ey = 0; return; }
  const ox = PRED.x + PRED.ex, oy = PRED.y + PRED.ey;   // where you're drawn now
  PRED.x = p.x; PRED.y = p.y;
  if (Math.hypot(ox - p.x, oy - p.y) > 90) { PRED.ex = PRED.ey = 0; return; }   // hooked / knocked far: jump
  PRED.ex = ox - p.x; PRED.ey = oy - p.y;   // otherwise glide the difference away
}
let predLast = 0;
function predDraw(now) {   // the drawn position this frame (null = not predicting)
  if (!PRED.ok) return null;
  const k = Math.exp(-Math.min(.1, (now - predLast) / 1000) / .08); predLast = now; PRED.ex *= k; PRED.ey *= k;
  const me = me_(), q = { x: PRED.x, y: PRED.y };   // + the keys held since the last input packet (that packet covers the same time, so nothing is counted twice)
  const dx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0), dy = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
  if ((dx || dy) && predicting(me)) predApply(q, { dx, dy, dt: Math.max(0, Math.min(.1, (now - lastInput) / 1000)) }, me);
  return { x: q.x + PRED.ex, y: q.y + PRED.ey };
}
// Smooth movement (snapshot interpolation): the server sends positions 20x a second.
// We remember the last few positions with the time they arrived, and draw everything
// ~70ms in the past, sliding evenly between two known positions. Motion is perfectly
// steady, and the camera locks onto your drawn position: no lag, no lean, no wobble.
const smooth = new Map(), INTERP_DELAY = 100;   // two updates of slack: a late packet doesn't make everything stop
window.__saSmooth = smooth;   // read-only hook for the smoothness tests
let snapT = 0;
function recordSnapshots() {
  if (!state) return;
  // even out arrival jitter: each update is stamped ~50ms after the last one, drifting slowly toward when it really arrived
  const arrived = performance.now(), expect = snapT + 50, now = !snapT || Math.abs(arrived - expect) > 120 ? arrived : expect + (arrived - expect) * .2; snapT = now;
  const seen = new Set();
  const rec = (key, e) => {
    seen.add(key); let sm = smooth.get(key);
    if (!sm || sm.src !== e) {
      sm = { x: e.x, y: e.y, src: e, buf: [] };
      sm.proxy = new Proxy(e, { get: (t, prop) => prop === "x" ? sm.x : prop === "y" ? sm.y : Reflect.get(t, prop) });
      smooth.set(key, sm);
    }
    const last = sm.buf[sm.buf.length - 1];
    if (last && Math.hypot(e.x - last.x, e.y - last.y) > 220) sm.buf.length = 0;   // teleport / respawn: don't slide across the map
    sm.buf.push({ t: now, x: e.x, y: e.y }); if (sm.buf.length > 6) sm.buf.shift();
  };
  for (const p of state.players.values()) rec("p" + p.sessionId, p);
  for (const z of state.zombies.values()) rec("z" + z.id, z);
  for (const key of smooth.keys()) if (!seen.has(key)) smooth.delete(key);
}
function updateSmooth() {
  const now = performance.now(), rt = now - INTERP_DELAY;
  for (const sm of smooth.values()) {
    const b = sm.buf; if (!b.length) continue;
    if (rt <= b[0].t) { sm.x = b[0].x; sm.y = b[0].y; continue; }
    let i = b.length - 1; while (i > 0 && b[i - 1].t > rt) i--;
    const p1 = b[i], p0 = b[i - 1] || p1;
    if (rt >= p1.t) {   // the next update is late: keep gliding on the last velocity for up to 60ms, then hold
      const ex = Math.min(rt - p1.t, 60) / Math.max(1, p1.t - p0.t); sm.x = p1.x + (p1.x - p0.x) * ex; sm.y = p1.y + (p1.y - p0.y) * ex; continue;
    }
    const f = (rt - p0.t) / Math.max(1, p1.t - p0.t);
    sm.x = p0.x + (p1.x - p0.x) * f; sm.y = p0.y + (p1.y - p0.y) * f;
  }
  const mine = smooth.get("p" + myId), pd = predDraw(now); if (mine && pd) { mine.x = pd.x; mine.y = pd.y; }   // you: the predicted position, no delay
}
// V(entity) = the same entity, but with its smoothed on-screen position.
function V(e) { if (!e) return e; return smooth.get(e.sessionId !== undefined ? "p" + e.sessionId : "z" + e.id)?.proxy || e; }
// Spectating: while you're down, the camera follows a living teammate (Space / arrows / click to switch).
let specIdx = 0;
const aliveMates = () => state ? [...state.players.values()].filter(p => p.alive && p.sessionId !== myId).sort((a, b) => a.sessionId < b.sessionId ? -1 : 1) : [];
function viewTarget() {
  const me = me_(); if (!me || me.alive || state.phase !== "playing") return me;
  const mates = aliveMates(); if (!mates.length) return me;
  specIdx = ((specIdx % mates.length) + mates.length) % mates.length; return mates[specIdx];
}
function switchSpectate(d) { specIdx += d; }
function updateCamera(t) {
  cam.last = t;
  if (!state) { cam.ready = false; return; }
  updateSmooth();
  const me = V(viewTarget());
  const fx_ = me ? me.x : towerX(), fy_ = me ? me.y : towerY();
  cam.x = Math.max(0, Math.min(worldW() - W, fx_ - W / 2));
  cam.y = Math.max(0, Math.min(worldH() - H, fy_ - H / 2));
  cam.ready = true;
  mouse.x = mouse.sx + cam.x; mouse.y = mouse.sy + cam.y;   // aim in world coordinates
}
const inView = (x, y, pad = 80) => x > cam.x - pad && x < cam.x + W + pad && y > cam.y - pad && y < cam.y + H + pad;

// Road layout (shared by the map and the minimap): two main avenues through the tower, plus side streets.
function roads() {
  const cx = worldW() / 2, cy = worldH() / 2;
  return {
    h: [{ y: cy, w: 146, main: true }, { y: cy - 720, w: 96 }, { y: cy + 720, w: 96 }],
    v: [{ x: cx, w: 164, main: true }, { x: cx - 1150, w: 96 }, { x: cx + 1150, w: 96 }],
  };
}
// ---------- Map art (client/assets/map, cut by tools/extract-map.py) ----------
const MAP_URLS = {
  car: "assets/map/car.png", burntCar: "assets/map/burntCar.png", bus: "assets/map/bus.png", police: "assets/map/police.png",
  building: "assets/map/building.png", ruin: "assets/map/ruin.png", streetlight: "assets/map/streetlight.png", dumpster: "assets/map/dumpster.png",
  blood: "assets/map/blood.png", manhole: "assets/map/manhole.png", rubble: "assets/map/rubble.png", tree: "assets/map/tree.png",
};
const TILE_URLS = { asphalt: "assets/map/tile-asphalt.webp", grass: "assets/map/tile-grass.webp", plaza: "assets/map/tile-plaza.webp" };
const mapImgs = {}, tileImgs = {}, patterns = {};
for (const [k, url] of Object.entries(MAP_URLS)) { const img = new Image(); img.src = url; mapImgs[k] = img; }
for (const [k, url] of Object.entries(TILE_URLS)) { const img = new Image(); img.src = url; tileImgs[k] = img; }
// Spooky look for the ground and map pieces only (players, zombies, tower and structures keep their colours):
// darker, less colourful, with a cold blue-green cast. Made once per picture, then reused.
const SPOOKY = { filter: "brightness(.58) saturate(.5) contrast(1.1)", tint: "rgba(16,42,58,.30)" };
const spookyCache = new Map();
function spooky(img) {
  if (!img?.complete || !img.naturalWidth) return null;
  if (spookyCache.has(img)) return spookyCache.get(img);
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d"); g.filter = SPOOKY.filter; g.drawImage(img, 0, 0); g.filter = "none";
  g.globalCompositeOperation = "source-atop"; g.fillStyle = SPOOKY.tint; g.fillRect(0, 0, c.width, c.height);
  spookyCache.set(img, c); return c;
}
function pattern(k, scale = 1) {
  const id = k + scale; if (patterns[id]) return patterns[id];
  const img = spooky(tileImgs[k]); if (!img) return null;
  const p = ctx.createPattern(img, "repeat"); if (scale !== 1) p.setTransform(new DOMMatrix().scale(scale));
  return (patterns[id] = p);
}
function drawMapObj(d) {
  const img = spooky(mapImgs[d.kind]); if (!img) return;
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.translate(Math.round(d.x), Math.round(d.y)); if (d.flip) ctx.scale(-1, 1);
  ctx.drawImage(img, -Math.round(img.width / 2), -img.height); ctx.restore();
}
// Map layout comes from the server (state.mapLayout, made by server/src/mapLayout.js) so everyone has the same city
// and the server knows what's solid. Format: "kind,x,y,flip;..." with kind = index in MAP_KINDS (same order as the server).
const MAP_FLAT = { blood: 1, manhole: 1 };
let decor = null, decorSrc = "";
function syncDecor() {
  const src = state?.mapLayout || ""; if (src === decorSrc) return; decorSrc = src;
  decor = src.startsWith("P:") ? [] : src ? src.split(";").map(r => { const [k, x, y, f] = r.split(",").map(Number); return { kind: MAP_KINDS[k], x, y, flip: f === 1 }; }).filter(d => d.kind) : [];
}
const STREETLIGHT_LAMP = { x: 0.36, y: -0.83 };   // lamp position relative to the sprite (x from centre, y from the base), in sprite widths/heights
function drawDecor(d) {
  if (MAP_URLS[d.kind]) return drawMapObj(d);
  if (d.kind === "car") {
    const w = d.rot ? 24 : 48, h = d.rot ? 48 : 24, body = d.tint < .33 ? "#5b3a2e" : d.tint < .66 ? "#3e4a52" : "#4f4a3a";
    block(d.x - w / 2, d.y - h / 2, w, h, body, "#1d1e1c", "#7d6d5a"); px(d.x - w / 2 + 5, d.y - h / 2 + 5, w - 10, h - 10, "#262b2c");
    px(d.x - 3, d.y - 3, 6, 6, "#c0762f");
  } else if (d.kind === "rubble") {
    for (let i = 0; i < 6; i++) px(d.x + ((i * 7) % 19) - 9, d.y + ((i * 11) % 13) - 6, 5 + (i % 3), 4, i % 2 ? "#4a4f4b" : "#35393a");
  } else if (d.kind === "barrel") { block(d.x - 7, d.y - 9, 14, 18, "#6d3b26", "#2c1a12", "#a35a34"); px(d.x - 7, d.y - 3, 14, 2, "#2c1a12"); }
  else { block(d.x - 11, d.y - 11, 22, 22, "#5c625c", "#292f2d", "#a5a08a"); px(d.x - 6, d.y - 5, 12, 3, "#c08a48"); }
}

function drawWorld(){
  const pm = state && paintedMap(); if (pm) return drawPaintedWorld(pm);
  const x0 = Math.floor(cam.x / 32) * 32, y0 = Math.floor(cam.y / 32) * 32;
  const grassP = pattern("grass"), asphaltP = pattern("asphalt"), plazaP = pattern("plaza"), walkP = pattern("plaza", .5);
  if (grassP && asphaltP && plazaP && state) return drawWorldArt(grassP, asphaltP, plazaP, walkP);
  // (fallback while the art loads) ground: asphalt tiles (only the visible ones)
  for (let y = y0; y < cam.y + H + 32; y += 32) for (let x = x0; x < cam.x + W + 32; x += 32) {
    px(x, y, 31, 31, ((x / 32 + y / 32) % 3 === 0) ? '#202729' : '#1b2224'); px(x + 2, y + 2, 27, 1, '#293234');
    const hsh = ((x * 73856093) ^ (y * 19349663)) >>> 0; if (hsh % 9 === 0) { px(x + (hsh % 20), y + (hsh % 23), 8, 2, '#343b38'); px(x + (hsh % 20) + 3, y + (hsh % 23) + 2, 2, 5, '#101617'); }
  }
  if (!state) return;
  const WW = worldW(), WH = worldH(), R = roads();
  // roads + lane markings
  for (const r of R.h) { px(0, r.y - r.w / 2, WW, r.w, '#343a39'); px(0, r.y - r.w / 2 + 4, WW, r.w - 8, '#282f30'); for (let x = Math.floor(cam.x / 54) * 54 + 12; x < cam.x + W; x += 54) px(x, r.y - 2, 24, 4, r.main ? '#a78d5e' : '#7f7457'); }
  for (const r of R.v) { px(r.x - r.w / 2, 0, r.w, WH, '#343a39'); px(r.x - r.w / 2 + 5, 0, r.w - 10, WH, '#282f30'); for (let y = Math.floor(cam.y / 54) * 54 + 10; y < cam.y + H; y += 54) px(r.x - 2, y, 4, 24, r.main ? '#a78d5e' : '#7f7457'); }
  // map edge: crumbling wall so you can see where the world ends
  ctx.fillStyle = '#0c1012'; ctx.fillRect(-60, -60, WW + 120, 60); ctx.fillRect(-60, WH, WW + 120, 60); ctx.fillRect(-60, 0, 60, WH); ctx.fillRect(WW, 0, 60, WH);
  px(0, 0, WW, 4, '#3d4441'); px(0, WH - 4, WW, 4, '#3d4441'); px(0, 0, 4, WH, '#3d4441'); px(WW - 4, 0, 4, WH, '#3d4441');
  syncDecor();
  for (const d of decor) if (inView(d.x, d.y)) drawDecor(d);
  drawWorldObjects([]);
}
// ---------- Painted maps (one picture is the ground: mapLayout.js PAINTED) ----------
const PAINT_URLS = { "fallen-dynasty": "assets/map/fallen-dynasty.webp" }, paintImgs = {};
for (const [k, url] of Object.entries(PAINT_URLS)) { const im = new Image(); im.src = url; paintImgs[k] = im; }
function drawPaintedWorld(pm) {
  const WW = worldW(), WH = worldH(), im = paintImgs[pm.art];
  syncDecor();   // (empties the city decor: minimap / night lights)
  ctx.fillStyle = "#0b0d12"; ctx.fillRect(cam.x - 2, cam.y - 2, W + 4, H + 4);
  if (im?.naturalWidth) {   // only the part on screen
    const sx = Math.max(0, Math.floor(cam.x)), sy = Math.max(0, Math.floor(cam.y)), sw = Math.min(WW, Math.ceil(cam.x + W)) - sx, sh = Math.min(WH, Math.ceil(cam.y + H)) - sy;
    if (sw > 0 && sh > 0) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(im, sx, sy, sw, sh, sx, sy, sw, sh); ctx.restore(); }
  }
  drawPaintedGround(pm);
  drawWorldObjects([]);
}
// living scenery on the painting: flickering lamps, car headlights, the tower's warning lights, fires with smoke
// fire-loop.webp (tools/bake-fire.py, from the Vefects fire VFX textures): row 0 = 16 looping fire frames 72x104 (base at the
// bottom centre), then a soft smoke puff 48x48 at (0, 104)
const mapFireImg = new Image(); mapFireImg.src = "assets/sprites/fx/fire-loop.webp";
const MFIRE = { n: 16, w: 72, h: 104, fps: 15, puff: 48 };
function drawFireSprite(x, y, sc, phase, t, alpha = 1) {   // one burning fire: the flipbook, cross-faded frame to frame, with a bright additive pass
  if (!mapFireImg.naturalWidth) return;
  const ft = t * MFIRE.fps + phase, f = Math.floor(ft) % MFIRE.n, f2 = (f + 1) % MFIRE.n, w = MFIRE.w * sc, h = MFIRE.h * sc;
  ctx.globalAlpha = alpha; blendCells(mapFireImg, 0, 0, MFIRE.w, MFIRE.h, f, f2, ft - Math.floor(ft), x - w / 2, y - h, w, h);
  const op = ctx.globalCompositeOperation; ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = alpha * .45;
  ctx.drawImage(mapFireImg, f * MFIRE.w, 0, MFIRE.w, MFIRE.h, x - w / 2, y - h, w, h); ctx.globalCompositeOperation = op; ctx.globalAlpha = 1;
}
function drawPaintedGround(pm) {
  const t = performance.now() / 1000;
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  pm.lights.forEach(([x, y], i) => {   // street lamps: a soft glow that breathes; now and then one stutters
    if (!inView(x, y, 40)) return;
    const stutter = Math.sin(t * 9 + i * 7.3) > .985 || (i % 5 === 2 && Math.sin(t * 1.7 + i) > .97) ? .25 : 1, k = (.55 + .15 * Math.sin(t * 2.1 + i * 1.7)) * stutter;
    const g = ctx.createRadialGradient(x, y, 1, x, y, 30); g.addColorStop(0, `rgba(255,214,140,${.38 * k})`); g.addColorStop(1, "rgba(255,180,90,0)"); ctx.fillStyle = g; ctx.fillRect(x - 30, y - 30, 60, 60);
    const gg = ctx.createRadialGradient(x, y + 34, 2, x, y + 34, 46); gg.addColorStop(0, `rgba(255,190,110,${.12 * k})`); gg.addColorStop(1, "rgba(255,170,90,0)");   // pool on the wet road
    ctx.save(); ctx.translate(x, y + 34); ctx.scale(1, .45); ctx.fillStyle = gg; ctx.fillRect(-46, -46, 92, 92); ctx.restore();
  });
  pm.beams.forEach(([x, y, a], i) => {   // flickering headlight beams
    if (!inView(x, y, 140)) return;
    const fl = Math.sin(t * 3.5 + i * 2.3) + Math.sin(t * 13 + i * 5), al = fl < -1.2 ? .05 : .2 + Math.max(0, Math.sin(t * 2.4 + i)) * .12;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.globalAlpha = al;
    const lg = ctx.createLinearGradient(0, 0, 120, 0); lg.addColorStop(0, "rgba(255,244,200,.9)"); lg.addColorStop(.6, "rgba(255,230,160,.2)"); lg.addColorStop(1, "rgba(255,220,120,0)");
    ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(120, -34); ctx.lineTo(120, 34); ctx.lineTo(0, 5); ctx.fill(); ctx.restore();
  });
  pm.beacons.forEach(([x, y], i) => {   // tower warning lights blink in turn
    if (!inView(x, y, 30)) return;
    const on = Math.sin(t * 3.2 - i * .9) > .2 ? 1 : .25, g = ctx.createRadialGradient(x, y, 0, x, y, 16);
    g.addColorStop(0, `rgba(255,70,50,${.85 * on})`); g.addColorStop(1, "rgba(255,30,30,0)"); ctx.fillStyle = g; ctx.fillRect(x - 16, y - 16, 32, 32);
  });
  if ((state.towerHp || 0) < (state.towerMaxHp || 1) * .25 && Math.sin(t * 8) > 0) { ctx.fillStyle = "rgba(255,60,40,.10)"; ctx.fillRect(towerX() - 70, towerY() - 280, 140, 320); }   // tower critical
  pm.fires.forEach(([x, y, sc], i) => {   // the glow each fire throws around it (pulses with the flames)
    if (!inView(x, y, 120)) return;
    const k = .8 + .2 * Math.sin(t * 7 + i * 1.9) + .1 * Math.sin(t * 17 + i);
    const g = ctx.createRadialGradient(x, y - 40 * sc, 4, x, y - 40 * sc, 120 * sc); g.addColorStop(0, `rgba(255,150,50,${.38 * k})`); g.addColorStop(1, "rgba(255,90,20,0)"); ctx.fillStyle = g; ctx.fillRect(x - 120 * sc, y - 160 * sc, 240 * sc, 240 * sc);
  });
  ctx.restore();
  ctx.save();
  pm.fires.forEach(([x, y, sc], i) => {   // a tall smoke plume first (behind), then a roaring fire: a big flame and licks either side
    if (!inView(x, y - 120, 200)) return;
    if (mapFireImg.naturalWidth) for (let j = 0; j < 9; j++) {
      const u = (t * .07 + j / 9 + i * .13) % 1, px_ = x + Math.sin(u * 3 + i + j) * 14 * sc + u * 44 * sc, py_ = y - 50 * sc - u * 190 * sc, r = (26 + u * 80) * sc;
      ctx.globalAlpha = .7 * Math.sin(u * Math.PI) * (1 - u * .3); ctx.drawImage(mapFireImg, 0, MFIRE.h, MFIRE.puff, MFIRE.puff, px_ - r / 2, py_ - r / 2, r, r);
    }
    drawFireSprite(x - 20 * sc, y + 4, sc * 1.15, i * 5 + 3, t, .9);
    drawFireSprite(x + 22 * sc, y + 5, sc * 1.05, i * 5 + 9, t, .85);
    drawFireSprite(x - 4 * sc, y + 8, sc * 1.75, i * 5, t);
    drawFireSprite(x + 8 * sc, y + 10, sc * 1.3, i * 5 + 12, t, .8);
  });
  ctx.restore();
}
// over everything (painted maps): rain, drifting blossom petals, embers floating up from the fires
function drawPaintedOverlay(pm) {
  const t = performance.now() / 1000;
  ctx.save();
  ctx.strokeStyle = "rgba(170,190,230,.16)"; ctx.lineWidth = 1; ctx.beginPath();
  for (let i = 0; i < 90; i++) {   // rain streaks (screen-wide, slanted)
    const x = cam.x + ((i * 137.7 + t * 90) % (W + 60)) - 30, y = cam.y + ((i * 91.3 + t * 620 + (i % 7) * 40) % (H + 40)) - 20;
    ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 14);
  }
  ctx.stroke();
  for (let i = 0; i < 26; i++) {   // cherry blossom petals tumbling across
    const x = cam.x + ((i * 211.3 + t * (18 + i % 5 * 4)) % (W + 40)) - 20, y = cam.y + ((i * 127.9 + t * (10 + i % 3 * 5) + Math.sin(t * .8 + i) * 18) % (H + 40)) - 20;
    ctx.save(); ctx.translate(x, y); ctx.rotate(t * (1 + i % 3) + i); ctx.globalAlpha = .7; ctx.fillStyle = i % 3 ? "#f2a6c8" : "#ffd0e4"; ctx.fillRect(-2.5, -1.5, 5, 3); ctx.restore();
  }
  ctx.globalCompositeOperation = "lighter";
  pm.fires.forEach(([x, y, sc], i) => {   // embers
    if (!inView(x, y - 60, 120)) return;
    for (let j = 0; j < 6; j++) {
      const u = (t * (.35 + j * .05) + j * .17 + i * .31) % 1, ex = x + Math.sin(u * 6 + j * 2 + i) * 16 * sc + u * 20, ey = y - u * 120 * sc;
      ctx.globalAlpha = .9 * (1 - u); ctx.fillStyle = j % 2 ? "#ffb347" : "#ffe08a"; ctx.fillRect(ex, ey, 2, 2);
    }
  });
  ctx.restore();
}
function drawWorldArt(grassP, asphaltP, plazaP, walkP) {
  const WW = worldW(), WH = worldH(), cx = WW / 2, cy = WH / 2, R = roads();
  const vx = cam.x - 2, vy = cam.y - 2, vw = W + 4, vh = H + 4;
  const fill = (p, x, y, w, h) => { const ax = Math.max(x, vx), ay = Math.max(y, vy), bx = Math.min(x + w, vx + vw), by = Math.min(y + h, vy + vh); if (bx > ax && by > ay) { ctx.fillStyle = p; ctx.fillRect(ax, ay, bx - ax, by - ay); } };
  // overgrown lots, then sidewalks, roads and the concrete plaza around the tower
  fill(grassP, 0, 0, WW, WH);

  const SW = 26;
  for (const r of R.h) fill(walkP, 0, r.y - r.w / 2 - SW, WW, r.w + SW * 2);
  for (const r of R.v) fill(walkP, r.x - r.w / 2 - SW, 0, r.w + SW * 2, WH);
  ctx.save(); ctx.beginPath(); ctx.roundRect(cx - 300, cy - 250, 600, 470, 40); ctx.clip(); fill(plazaP, cx - 300, cy - 250, 600, 470); ctx.restore();
  for (const r of R.h) { fill(asphaltP, 0, r.y - r.w / 2, WW, r.w); px(0, r.y - r.w / 2 - 3, WW, 3, "#4f5a5a"); px(0, r.y + r.w / 2, WW, 3, "#323b3c"); }
  for (const r of R.v) { fill(asphaltP, r.x - r.w / 2, 0, r.w, WH); px(r.x - r.w / 2 - 3, 0, 3, WH, "#4f5a5a"); px(r.x + r.w / 2, 0, 3, WH, "#323b3c"); }
  // lane markings (skip the crossing in the middle of the plaza)
  for (const r of R.h) for (let x = Math.floor(cam.x / 54) * 54 + 12; x < cam.x + W; x += 54) if (!(r.main && Math.abs(x - cx) < 300)) px(x, r.y - 2, 24, 4, r.main ? "#7d6d4c" : "#665e4b");
  for (const r of R.v) for (let y = Math.floor(cam.y / 54) * 54 + 10; y < cam.y + H; y += 54) if (!(r.main && Math.abs(y - cy) < 250)) px(r.x - 2, y, 4, 24, r.main ? "#7d6d4c" : "#665e4b");
  // map edge
  ctx.fillStyle = "#0c1012"; ctx.fillRect(-60, -60, WW + 120, 60); ctx.fillRect(-60, WH, WW + 120, 60); ctx.fillRect(-60, 0, 60, WH); ctx.fillRect(WW, 0, 60, WH);
  px(0, 0, WW, 4, "#3d4441"); px(0, WH - 4, WW, 4, "#3d4441"); px(0, 0, 4, WH, "#3d4441"); px(WW - 4, 0, 4, WH, "#3d4441");
  syncDecor();
  const tall = [];
  for (const d of decor) { if (!inView(d.x, d.y - 60, 200)) continue; if (MAP_FLAT[d.kind]) drawMapObj(d); else tall.push({ y: d.y - 6, draw: () => drawMapObj(d) }); }
  drawWorldObjects(tall);
}
function drawWorldObjects(extra) {
  const WW = worldW(), WH = worldH(), cx = towerX(), cy = towerY();
  // ---- objects + characters, depth-sorted so things further down the screen are drawn in front ----
  const items = extra;
  if (!paintedMap()) items.push({ y: cy + 34, draw: () => drawTower(cx, cy) });   // painted maps: the tower is in the picture
  items.push({ y: cy + GEN_OFF.y + 16, draw: () => drawGenerator(cx + GEN_OFF.x, cy + GEN_OFF.y) });
  for (const item of state.loot.values()) if (inView(item.x, item.y)) items.push({ y: item.y - 30, draw: () => drawLoot(item) });
  for (const st of state.structures.values()) if (st.kind === "safehouse") { if (inView(st.x, st.y, 260)) safePieces(st.x, st.y, safeFrame(st), safeAlpha(st), st).forEach(pc => items.push(pc)); } else if (inView(st.x, st.y)) items.push({ y: st.y + (st.kind === "mine" || st.kind === "flameTrap" ? -40 : 10), draw: () => drawStructure(st) });
  drawStains();
  drawPuddles();
  drawGroundFx();
  drawAstraGround();
  drawStompDust();
  drawHealRings();
  drawCorpses();
  for (const z0 of state.zombies.values()) { const z = V(z0); if (inView(z.x, z.y, 220)) items.push({ y: z.y + 10, draw: () => { drawZombieAny(z); if (z0.burn > 0) drawBurning(z, z0.burn); } }); }
  if (state.robots) for (const r0 of state.robots.values()) { const r = r0; if (inView(r.x, r.y, 80)) items.push({ y: r.y + 6, draw: () => drawRobot(r) }); }
  for (const c of bossCorpses) if (inView(c.x, c.y, 200)) items.push({ y: c.y - 20, draw: () => drawBossCorpse(c) });
  for (const p0 of state.players.values()) { const p = V(p0); if (inView(p.x, p.y, 120)) { const air = state.vehicles?.get(p0.sessionId)?.kind === "heli"; items.push({ y: air ? 1e7 + p.y : p.y + 12, draw: () => drawSurvivor(p) }); } }   // the helicopter flies above everything
  healOverlays(items);
  items.sort((a, b) => a.y - b.y).forEach(it => { const d = ctxDepth; ctx.save(); try { it.draw(); } catch (e) { reportError(e, "draw"); } unwindTo(d); });
  const pmOver = paintedMap(); if (pmOver) { const d = ctxDepth; ctx.save(); try { drawPaintedOverlay(pmOver); } catch (e) { reportError(e, "draw"); } unwindTo(d); }   // rain, petals, embers over everything
  for (const f of mechaLate.splice(0)) { const d = ctxDepth; ctx.save(); try { f(); } catch (e) { reportError(e, "draw"); } unwindTo(d); }     // a sprite that throws can't leave its save() open   // one broken sprite can't stop the rest
  ctx.fillStyle = '#e9d7b2'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.fillText('RADIO TOWER', cx, cy + 104);
  const leader0 = [...state.players.values()].sort((a, b) => b.kills - a.kills || (a.killLeadSince || Number.MAX_SAFE_INTEGER) - (b.killLeadSince || Number.MAX_SAFE_INTEGER) || String(a.name).localeCompare(String(b.name)))[0], leader = V(leader0);
  if (leader && leader.kills > 0) { ctx.save(); ctx.font = 'bold 22px serif'; ctx.textAlign = 'center'; ctx.shadowColor = '#ffd84d'; ctx.shadowBlur = 12; ctx.fillStyle = '#ffd84d'; ctx.fillText('♛', leader.x, leader.y - 60); ctx.restore(); }
  drawShotFx();
  drawReviveRing(); drawAstraShield();
  drawCrosshair();
}

let vignette = null;
// ---------- Night: darkness everywhere except around players and under street lights ----------
// Each player only sees their own light (no shared vision). playerR = 20% of the screen width (V toggles 30% in the solo preview).
const NIGHT = { playerR: 240, lightR: 125, lightAlpha: .55, dark: .95 };
const VISION_STEPS = [0.2, 0.3];
const darkCv = document.createElement("canvas"); darkCv.width = W; darkCv.height = H; const dctx = darkCv.getContext("2d");
let nightK = 0, nightLast = 0, forceNight = false;   // forceNight: N key in the solo preview, to test the look
const isNightView = () => !!state && (state.isNight || forceNight);
function lightHole(x, y, r, a) {
  const g = dctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(.55, `rgba(0,0,0,${a})`); g.addColorStop(1, "rgba(0,0,0,0)");
  dctx.fillStyle = g; dctx.fillRect(x - r, y - r, r * 2, r * 2);
}
function drawNight() {
  const now = performance.now(), dt = Math.min(.1, (now - (nightLast || now)) / 1000); nightLast = now;
  nightK += ((isNightView() ? 1 : 0) - nightK) * Math.min(1, dt * 1.5);          // fade in/out over ~2 seconds
  if (nightK < .01) return;
  ctx.fillStyle = `rgba(4,8,15,${.25 * nightK})`; ctx.fillRect(0, 0, W, H);     // cold blue tint
  dctx.globalCompositeOperation = "source-over"; dctx.clearRect(0, 0, W, H);
  dctx.fillStyle = `rgba(2,4,8,${NIGHT.dark * nightK})`; dctx.fillRect(0, 0, W, H);
  dctx.globalCompositeOperation = "destination-out";
  const sl = mapImgs.streetlight;
  if (decor && sl?.naturalWidth) for (const d of decor) {
    if (d.kind !== "streetlight" || !inView(d.x, d.y, NIGHT.lightR)) continue;
    lightHole(d.x + (d.flip ? -1 : 1) * STREETLIGHT_LAMP.x * sl.width - cam.x, d.y - 24 - cam.y, NIGHT.lightR, NIGHT.lightAlpha);
  }
  const pmN = paintedMap();
  if (pmN) {   // painted map: its lamps and fires light the night
    for (const [x, y] of pmN.lights) if (inView(x, y, NIGHT.lightR)) lightHole(x - cam.x, y + 20 - cam.y, NIGHT.lightR * .7, NIGHT.lightAlpha);
    for (const [x, y, sc] of pmN.fires) if (inView(x, y, 200)) lightHole(x - cam.x, y - cam.y, 150 * sc, .85);
    for (const [x, y] of pmN.beacons.slice(0, 1)) lightHole(x - cam.x, y + 200 - cam.y, 170, .7);   // the tower compound's floodlights
  }
  const me = V(me_()), view = V(viewTarget());
  if (me) lightHole(me.x - cam.x, me.y - 10 - cam.y, me.alive ? NIGHT.playerR : NIGHT.playerR * .5, me.alive ? 1 : .8);   // only YOUR light (smaller while downed)
  if (view && view !== me) lightHole(view.x - cam.x, view.y - 10 - cam.y, NIGHT.playerR, 1);   // spectating: see around the teammate you're watching
  for (const f of fx) if (f.type === "boom" && now - f.t < 400) lightHole(f.x - cam.x, f.y - cam.y, 220, .8 * (1 - (now - f.t) / 400));   // explosions light things up
  ctx.drawImage(darkCv, 0, 0);
  // zombies out in the dark: only a faint pair of glowing eyes gives them away
  if (nightK > .5) {
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (const z0 of state.zombies.values()) {
      const z = V(z0); if (z.kind === "mutant" || !inView(z.x, z.y, 0) || litAt(z.x, z.y)) continue;   // mutants have no glowing eyes: you don't see them coming
      const blink = Math.sin(now / 900 + z.x * .7) > .93 ? .15 : 1, ex = z.x - cam.x, ey = z.y - cam.y - (z.boss ? 58 : z.kind === "brute" ? 66 : 30), sp = z.boss ? 6 : 3;
      ctx.fillStyle = `rgba(200,255,110,${.75 * blink * nightK})`; ctx.shadowColor = "#b8ff6a"; ctx.shadowBlur = 6;
      ctx.fillRect(ex - sp - 1, ey, 2, 2); ctx.fillRect(ex + sp - 1, ey, 2, 2);
    }
    ctx.restore();
  }
}
// Is a world point visible at night? (used to hide zombies on the minimap)
function litAt(x, y) {
  if (!isNightView()) return true;
  const me = me_(); return !!me && Math.hypot(me.x - x, me.y - y) < NIGHT.playerR * (me.alive ? .9 : .45);
}

// Screen-space layer: night tint, arrows to things that are off screen, minimap.
function drawScreen() {
  if (!state) return;
  // dark vignette around the screen edges (always)
  if (!vignette) { vignette = ctx.createRadialGradient(W / 2, H / 2, H * .38, W / 2, H / 2, W * .62); vignette.addColorStop(0, "rgba(0,0,0,0)"); vignette.addColorStop(1, "rgba(2,6,10,.55)"); }
  ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H);
  drawNight();
  // street lights glow (warm, stronger at night)
  const sl = mapImgs.streetlight;
  if (decor && sl?.naturalWidth) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const k = .45 + .55 * nightK, flick = .92 + .08 * Math.sin(performance.now() / 90);
    for (const d of decor) {
      if (d.kind !== 'streetlight' || !inView(d.x, d.y - 60, 160)) continue;
      const lx = d.x + (d.flip ? -1 : 1) * STREETLIGHT_LAMP.x * sl.width - cam.x, ly = d.y + STREETLIGHT_LAMP.y * sl.height - cam.y;
      let g = ctx.createRadialGradient(lx, ly, 2, lx, ly, 46); g.addColorStop(0, `rgba(255,190,110,${.55 * k * flick})`); g.addColorStop(1, 'rgba(255,150,60,0)');
      ctx.fillStyle = g; ctx.fillRect(lx - 46, ly - 46, 92, 92);
      const gx = lx, gy = d.y - cam.y - 4;
      g = ctx.createRadialGradient(gx, gy, 4, gx, gy, 90); g.addColorStop(0, `rgba(255,170,80,${.22 * k * flick})`); g.addColorStop(1, 'rgba(255,140,60,0)');
      ctx.save(); ctx.translate(gx, gy); ctx.scale(1, .45); ctx.translate(-gx, -gy); ctx.fillStyle = g; ctx.fillRect(gx - 90, gy - 90, 180, 180); ctx.restore();
    }
    ctx.restore();
  }
  const targets = [{ x: towerX(), y: towerY(), label: 'TOWER', color: '#f2a15b' }];
  for (const p of state.players.values()) if (!p.alive && !p.bledOut && p.sessionId !== myId) targets.push({ x: p.x, y: p.y, label: 'REVIVE ' + p.name.toUpperCase(), color: '#ff7568' });
  for (const z of state.zombies.values()) if (z.boss || z.kind === "hivemind") targets.push({ x: z.x, y: z.y, label: z.boss ? 'BOSS' : 'HIVEMIND', color: '#ff3737' });
  for (const tg of targets) {
    const sx = tg.x - cam.x, sy = tg.y - cam.y;
    if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
    const ang = Math.atan2(sy - H / 2, sx - W / 2), m = 46;
    const k = Math.min((W / 2 - m) / Math.abs(Math.cos(ang) || 1e-6), (H / 2 - m) / Math.abs(Math.sin(ang) || 1e-6));
    const ax = W / 2 + Math.cos(ang) * k, ay = H / 2 + Math.sin(ang) * k;
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang);
    ctx.fillStyle = tg.color; ctx.globalAlpha = .9; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -10); ctx.lineTo(-3, 0); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fill(); ctx.restore();
    const d = Math.round(Math.hypot(tg.x - (cam.x + W / 2), tg.y - (cam.y + H / 2)) / 10);
    ctx.save(); ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = tg.color; ctx.strokeStyle = '#000a'; ctx.lineWidth = 3;
    const lx = ax - Math.cos(ang) * 26, ly = ay - Math.sin(ang) * 22 + 3; ctx.strokeText(tg.label + ' ' + d + 'm', lx, ly); ctx.fillText(tg.label + ' ' + d + 'm', lx, ly); ctx.restore();
  }
  // minimap: whole world, your view as a box
  const mini = $('minimap'), m = mini.getContext('2d'), MW = 360, MH = 228, sx = MW / worldW(), sy = MH / worldH(), R = roads();
  m.imageSmoothingEnabled = false; m.clearRect(0, 0, MW, MH); m.fillStyle = '#11191a'; m.fillRect(0, 0, MW, MH);
  const pmM = paintedMap(), pmI = pmM && paintImgs[pmM.art];
  if (pmI?.naturalWidth) { m.globalAlpha = .75; m.imageSmoothingEnabled = true; m.drawImage(pmI, 0, 0, MW, MH); m.globalAlpha = 1; m.imageSmoothingEnabled = false; }
  else { m.fillStyle = '#353e3d'; for (const r of R.h) m.fillRect(0, (r.y - r.w / 2) * sy, MW, Math.max(2, r.w * sy)); for (const r of R.v) m.fillRect((r.x - r.w / 2) * sx, 0, Math.max(2, r.w * sx), MH); }
  if (decor) { m.fillStyle = '#4a4440'; for (const d of decor) if (d.kind === 'building' || d.kind === 'ruin') m.fillRect((d.x - 70) * sx, (d.y - 110) * sy, 140 * sx, 100 * sy); }
  m.fillStyle = '#d58b45'; m.fillRect(towerX() * sx - 5, towerY() * sy - 5, 10, 10);
  for (const st of state.structures.values()) { m.fillStyle = '#c19a5c'; m.fillRect(st.x * sx - 2, st.y * sy - 2, 4, 4); }
  for (const z of state.zombies.values()) { if (!z.boss && !litAt(z.x, z.y)) continue; m.fillStyle = z.boss ? '#ff3737' : '#a9bd78'; const r = z.boss ? 4 : 2; m.fillRect(z.x * sx - r / 2, z.y * sy - r / 2, r, r); }
  for (const pl of state.players.values()) { m.fillStyle = pl.alive ? pl.color : '#ff7568'; m.fillRect(pl.x * sx - 3, pl.y * sy - 3, 6, 6); }
  m.strokeStyle = '#ffffffaa'; m.lineWidth = 1; m.strokeRect(cam.x * sx + .5, cam.y * sy + .5, W * sx, H * sy);
}

// A drawing bug must never freeze the game: errors are caught, sent to the server log (Render), and the next frame still runs.
const reportedErrors = new Set();
function reportError(e, where, lv = "error") {
  const me = state && me_(), msg = `${where}: ${e?.message || e}${e?.stack ? " | " + String(e.stack).split("\n").slice(1, 5).map(s => s.trim().replace(/https?:\/\/[^/]+\//, "")).join(" < ") : ""}${me ? ` [${me.alive ? "alive" : "down"}${state.vehicles?.get(myId) ? ", in vehicle" : ""}]` : ""}`;
  if (reportedErrors.has(msg) || reportedErrors.size > 25) return; reportedErrors.add(msg);
  console.error("[game]", msg); try { room?.send("clientError", { m: msg.slice(0, 900), lv, ua: navigator.userAgent.replace(/^Mozilla\/5\.0 /, "") }); } catch { /* not connected */ }
}
addEventListener("error", e => reportError(e.error || e.message, "window"));
addEventListener("unhandledrejection", e => reportError(e.reason, "promise"));
// Stall detector: in a game the server sends updates ~20 times a second. 6s of silence = lag / connection trouble.
let lastStateAt = performance.now(), stallReported = false;
setInterval(() => {
  if (!room || !state || state.phase !== "playing") { lastStateAt = performance.now(); return; }
  const gap = performance.now() - lastStateAt;
  if (gap > 6000 && !stallReported) { stallReported = true; reportError(`no updates from the server for ${Math.round(gap / 1000)}s`, "connection", "warn"); }
  if (gap < 1000) stallReported = false;
}, 2000);
function frame(t){
  if (performance.now() < hitStopUntil) { requestAnimationFrame(frame); return; }   // deflect hit-stop: freeze for a split second
  requestAnimationFrame(frame);
  unwindTo(0); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.filter = "none";   // start every frame clean
  try {
    sendControls(t); updateFeel(); updateCamera(t); updateMusic(); stopLostHeliLoops(); fireAmbience();
    ctx.clearRect(0, 0, W, H);
    const off = shakeOffset();
    ctx.save(); ctx.translate(off.x - Math.round(cam.x), off.y - Math.round(cam.y)); drawWorld(); drawFeel(); ctx.restore();
    drawScreen(); drawBuildWheel(); drawSquadWheel(); drawHurt();
    if (performance.now() < flashUntil) { ctx.fillStyle = `rgba(255,248,220,${(flashUntil - performance.now()) / 140 * .55})`; ctx.fillRect(0, 0, W, H); }
  } catch (e) { unwindTo(0); ctx.setTransform(1, 0, 0, 1, 0, 0); reportError(e, "frame"); }
}
requestAnimationFrame(frame);
// ===================== LOBBY / CHARACTER SELECT SCREEN =====================
// Roster: who you can pick (Sofea was removed; Arshan shows as the locked "???" tile until he's ready).
const ROSTER = [
  { id: "assault", name: "MARCUS", role: "ASSAULT", cat: "assault", hp: 110, dmg: 17, spd: 190, def: 0, desc: "Balanced frontline fighter. Fast rifle fire and a damage rush when the horde closes in.",
    skills: [{ k: "E", n: "Combat Rush", cd: 25, t: "+50% damage for 6 seconds." }], gear: ["rifle", "pistol", "knife"] },
  { id: "juggernaut", name: "BRIGGS", role: "JUGGERNAUT", cat: "tank", hp: 160, dmg: 14, spd: 150, def: 5, desc: "Shotgun tank who thrives in the thick of combat, protecting the team and crushing hordes.",
    skills: [{ k: "E", n: "Iron Bastion", cd: 30, card: "ironBastion", t: "A steel dome for 15s: nothing gets through. It shatters outward and knocks zombies back." },
             { k: "Q", n: "War Cry", cd: 60, card: "warCry", t: "Taunts every zombie within 350px, halves damage taken and boosts teammates' damage +25%. Shotgun spam, no ammo, for 10s." },
             { k: "PASSIVE", n: "Forceful Blast", card: "forcefulBlast", t: "Shotgun shots knock back every zombie, bosses too." }], gear: ["shotgun", "pistol", "knife"] },
  { id: "operator", name: "SOFEA", role: "OPERATOR", cat: "specialist", hp: 115, dmg: 15, spd: 180, def: 0, desc: "Heavy-metal specialist. Calls in her own tank and a gunship, and pilots the Crimson Aegis mecha straight into the horde.",
    skills: [{ k: "E", n: "Steel Convoy", card: "steelConvoy", cd: 30, t: "Drive a tank for 30s: cannon on click, run zombies over, takes much less damage." },
             { k: "Q", n: "Sky Reign", card: "skyReign", cd: 60, t: "Fly a gunship for 30s over everything: its machine gun shreds every zombie in a 90° cone where you aim. Zombies can't reach you." },
             { k: "R", n: "Crimson Aegis", card: "crimsonAegis", cd: 100, t: "Transform into the Crimson Aegis mecha for 30s. Hold click: flame jet (190px cone). Right click: lightsaber sweep (155px, 80 dmg). R again to step out." }], gear: ["rifle", "pistol", "knife"] },
  { id: "engineer", name: "VIKTOR", role: "ENGINEER", cat: "specialist", hp: 110, dmg: 15, spd: 175, def: 1, desc: "Builds his own army: three kinds of combat robot and a heavy minigun turret.",
    skills: [{ k: "E", n: "Robot Squad", card: "robotSquad", cd: 25, t: "Deploy an assault, support or hunter robot. 3 charges, +1 every 25s." },
             { k: "Q", n: "Heavy Turret", card: "heavyTurret", cd: 60, t: "A heavy minigun turret that shreds everything for 40s." }], gear: ["rifle", "pistol", "knife"] },
  { id: "scout", name: "RAVEN", role: "SCOUT", cat: "assault", hp: 90, dmg: 15, spd: 225, def: 0, desc: "Katana only. Dashes through the horde, vanishes, then strikes with a burning blade.",
    skills: [{ k: "E", n: "Shadow Pass", card: "shadowPass", cd: 25, t: "Dash through zombies and vanish. Your next attack ignites the katana." },
             { k: "Q", n: "Blade Storm", card: "bladeStorm", cd: 60, t: "A whirlwind of katana slashes around you." }], gear: ["katana"] },
  { id: "demolitionist", name: "DANTE", role: "DEMOLITIONIST", cat: "assault", hp: 105, dmg: 18, spd: 175, def: 0, desc: "If it's standing, it's a target. Rockets land wherever you click.",
    skills: [{ k: "E", n: "Sky Barrage", card: "skyBarrage", cd: 8, t: "3 rockets up, 3 down around your mouse." },
             { k: "Q", n: "Demo Ripple", card: "demoRipple", cd: 60, t: "Plant the crate, press Q again: rings of grenades." }], gear: ["launcher", "pistol", "knife"] },
  { id: "sniper", name: "SIENNA", role: "SNIPER", cat: "specialist", hp: 95, dmg: 21, spd: 165, def: 0, desc: "Precision long-range damage. Picks off the biggest threats first.",
    skills: [{ k: "E", n: "Dead Eye", cd: 24, t: "A huge shot at the nearest zombie in sight." }], gear: ["rifle", "pistol", "knife"] },
  { id: "dispatcher", name: "ASTRA", role: "EMERGENCY CMDR", cat: "support", hp: 120, dmg: 15, spd: 180, def: 0, isNew: true, desc: "Calm field leader who always has backup on the way: medics, police and a safehouse.",
    skills: [{ k: "E", n: "Emergency Medics", card: "medicTeam", cd: 30, t: "A medic for 20s: heals you first, then each injured ally once (5 HP/s, up to 6s each), then follows you." },
             { k: "Q", n: "Police Backup", card: "policeBackup", cd: 60, t: "An armed officer for every living teammate: each one guards his player for 30s." },
             { k: "R", n: "Safehouse", card: "safehouse", cd: 90, t: "Workers build 4 walls around you in 5s (you can't be hurt meanwhile), then stay to repair (6 hits break it). Zombies can't get in for 45s." }], gear: ["rifle", "pistol", "knife"] },
];
const ROLE_ICON = { assault: '<path d="M3 12h13l5-3v6l-5-3M7 12v4"/>', tank: '<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z"/>', support: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>', specialist: '<path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19"/>' };
const GEAR = { rifle: "Rifle · full auto, 30 rounds", pistol: "Pistol · infinite ammo", shotgun: "Shotgun · 6 shells, wide spread", launcher: "Launcher · rockets explode where you click", knife: "Knife · fast stabs", katana: "Katana · upgrades with kills", bat: "Bat", axe: "Fire axe · hold for a heavy swing" };
// literal paths so the single-file preview build can embed them
const HERO_ART = { assault: "assets/hero/assault.webp", juggernaut: "assets/hero/juggernaut.webp", engineer: "assets/hero/engineer.webp", scout: "assets/hero/scout.webp",
  demolitionist: "assets/hero/demolitionist.webp", sniper: "assets/hero/sniper.webp", dispatcher: "assets/hero/dispatcher.webp", operator: "assets/hero/operator.webp" };
const SITE_NAMES = [["ASCENSION SITE 01", "Research Outpost"], ["ASCENSION SITE 02", "Old Town Streets"], ["ASCENSION SITE 03", "Crossroads Ruins"], ["FALLEN DYNASTY", "China · Burning Plaza"]];
const SETTING_OPTS = { difficulty: ["easy", "normal", "hard"], waveMode: ["campaign", "ascension"] };
const ls = { view: "lobby", cat: "all", tab: "abilities", hideCode: false, toastAt: 0 };
const rosterOf = id => ROSTER.find(r => r.id === id) || ROSTER[0];
const heroDef = () => rosterOf(selectedClass);
const setHtml = (id, html) => { const el = $(id); if (el._h !== html) { el._h = html; el.innerHTML = html; } };   // only touch the DOM when something changed (state updates ~20x/s)
function toast(text) { const t = $("lobbyMessage"); t.textContent = text; t.classList.add("show"); ls.toastAt = Date.now(); setTimeout(() => { if (Date.now() - ls.toastAt >= 2900) t.classList.remove("show"); }, 3000); }
function inviteText() { const code = room?.roomId || ""; let url = location.origin + location.pathname; if (/^https?:/.test(url)) url += "?room=" + encodeURIComponent(code); else url = ""; return { code, url }; }
async function copyText(text, done) { try { await navigator.clipboard.writeText(text); toast(done); } catch { toast(text); } }

function setSelectedClass(id, send = true) {
  if (!ROSTER.some(r => r.id === id)) id = "assault";
  selectedClass = id; renderRoster(); renderHero(); renderSide();
  if (send && room) room.send("chooseClass", { id });
}
function renderRoster() {
  const list = ROSTER.filter(r => ls.cat === "all" || r.cat === ls.cat);
  $("characterGrid").innerHTML = list.map(r => `<button class="ls-tile p-${r.id}${r.id === selectedClass ? " on" : ""}${r.isNew ? " new" : ""}" data-class="${r.id}" aria-pressed="${r.id === selectedClass}"><b>${r.name}</b><small>${r.role}</small></button>`).join("")
    + (ls.cat === "all" ? `<div class="ls-tile lock" title="Next survivor: coming soon"><span>🔒</span><b>???</b><small>&nbsp;</small></div>` : "");
}
function bars(v, lo, hi) { const n = Math.max(1, Math.min(5, Math.round(1 + (v - lo) / (hi - lo) * 4))); return `<span class="ls-bar">${[0, 1, 2, 3, 4].map(i => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`; }
function renderHero() {
  const r = heroDef();
  $("heroName").textContent = r.name; $("heroRole").textContent = r.role; $("heroDesc").textContent = r.desc;
  $("heroStats").innerHTML = [["HP", r.hp, 90, 160, '<path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.7A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11Z"/>'], ["DMG", r.dmg, 14, 21, '<path d="M12 2v6M12 16v6M2 12h6M16 12h6"/><circle cx="12" cy="12" r="3"/>'], ["SPD", r.spd, 150, 225, '<path d="M13 4 4 14h7l-1 6 9-10h-7z"/>'], ["DEF", r.def, 0, 5, '<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z"/>']]
    .map(([k, v, lo, hi, ic]) => `<div class="ls-stat" title="${k} ${v}"><svg viewBox="0 0 24 24">${ic}</svg><span>${k}</span>${bars(v, lo, hi)}</div>`).join("");
  // hero art: ChatGPT splash art (tools/extract-heroes.py) when there is one, else the animated in-game sprite
  const art = $("heroArt"), src = HERO_ART[r.id];
  art.hidden = !src; $("heroSprite").hidden = !!src;
  if (src && art.getAttribute("src") !== src) { art.classList.remove("in"); art.src = src; requestAnimationFrame(() => requestAnimationFrame(() => art.classList.add("in"))); }
}
function skillIcon(s, r) { return s.card ? `<div class="icon card-${s.card}"></div>` : `<div class="icon"><svg viewBox="0 0 24 24">${ROLE_ICON[r.cat]}</svg></div>`; }
function gearIcon(id) { return `<span class="gi">${icon(id === "katana" ? "katana" : id) || ""}</span>`; }
function renderSide() {
  const r = heroDef(); document.querySelectorAll(".ls-tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === ls.tab));
  const clock = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  if (ls.tab === "abilities") {
    const rows = r.skills.map(s => `<div class="ls-ab">${skillIcon(s, r)}<div><div class="t"><span class="k">${s.k}</span><span class="n">${s.n.toUpperCase()}</span>${s.cd ? `<span class="cd">${clock}${s.cd}s</span>` : ""}</div><p>${s.t}</p></div></div>`);
    if (!r.skills.some(s => s.k === "Q")) rows.push(`<div class="ls-ab" style="opacity:.55"><div class="icon"><svg viewBox="0 0 24 24"><path d="M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z"/></svg></div><div><div class="t"><span class="k">Q</span><span class="n">ULTIMATE</span></div><p>Coming soon.</p></div></div>`);
    $("sideBody").innerHTML = rows.join("");
  } else if (ls.tab === "gear") {
    $("sideBody").innerHTML = r.gear.map(g => `<div class="ls-gear">${gearIcon(g) || '<span class="gi"></span>'}<div><b>${(WEAPON_INFO[g]?.name || MELEE_INFO[g]?.name || g).toUpperCase()}</b><small>${GEAR[g] || ""}</small></div></div>`).join("")
      + `<div class="ls-gear">${gearIcon("medkit")}<div><b>MEDKIT ×1</b><small>Press 4 to heal. More drop from zombies.</small></div></div><p style="margin:4px 2px;color:var(--mut);font-size:12px">More guns and melee weapons in the shop between waves.</p>`;
  } else {
    $("sideBody").innerHTML = `<div class="ls-skins"><div class="ls-skin on p-${r.id}">DEFAULT</div><div class="ls-skin locked p-${r.id}">BATTLE-WORN</div><div class="ls-skin locked p-${r.id}">NIGHT OPS</div><div class="ls-skin locked p-${r.id}">INFERNO</div></div><p style="margin:4px 2px;color:var(--mut);font-size:12px">New skins coming soon.</p>`;
  }
}
function renderPages() {
  const r = heroDef();
  $("loadoutPage").innerHTML = `<h2>LOADOUT · ${r.name}</h2><p>What ${r.name[0] + r.name.slice(1).toLowerCase()} starts every match with. Buy more in the shop between waves (gold drops from zombies).</p>
    <h4>STARTING GEAR</h4><div class="ls-grid">${r.gear.map(g => `<div class="ls-gear">${gearIcon(g) || '<span class="gi"></span>'}<div><b>${(WEAPON_INFO[g]?.name || MELEE_INFO[g]?.name || g).toUpperCase()}</b><small>${GEAR[g] || ""}</small></div></div>`).join("")}</div>
    <h4>ALL GUNS</h4><div style="overflow-x:auto"><table class="ls-wtable"><tr><th>GUN</th><th>MAGAZINE</th><th>RELOAD</th><th>FIRE</th></tr>${Object.entries(WEAPON_INFO).map(([k, w]) => `<tr class="${r.gear.includes(k) ? "mine" : ""}"><td>${w.name}</td><td>${w.infinite ? "∞" : w.mag}</td><td>${w.reload}s</td><td>${w.auto ? "full auto" : "single"}</td></tr>`).join("")}</table></div>
    <h4>MELEE</h4><div class="ls-grid">${Object.entries(MELEE_INFO).map(([k, m]) => `<div class="ls-gear">${gearIcon(k)}<div><b>${m.name.toUpperCase()}</b><small>${GEAR[k] || ""} · ${m.cd}s per swing</small></div></div>`).join("")}</div>`;
  $("skillsPage").innerHTML = `<h2>SKILLS</h2><p>Every operator's skills. E = skill, Q = ultimate (unlocks after 100 kills), R = Astra's third skill.</p><div class="ls-grid">${ROSTER.map(o => `<div class="ls-op"><div class="h"><i class="p-${o.id}"></i><div><b>${o.name}</b><small>${o.role}</small></div></div>${o.skills.map(s => `<div class="ls-ab" style="grid-template-columns:52px 1fr">${skillIcon(s, o).replace('class="icon"', 'class="icon" style="width:52px;height:52px"').replace('class="icon" style="background', 'class="icon" style="width:52px;height:52px;background')}<div><div class="t"><span class="k">${s.k}</span><span class="n" style="font-size:17px">${s.n.toUpperCase()}</span>${s.cd ? `<span class="cd">${s.cd}s</span>` : ""}</div><p>${s.t}</p></div></div>`).join("")}</div>`).join("")}</div>`;
  $("manualPage").innerHTML = `<h2>FIELD MANUAL</h2>
    <h4>OBJECTIVE</h4><p>Protect the radio tower in the middle of the map. If it falls, the team loses. Every 4th wave is a boss fight; the Hivemind mini boss shows up between them. Campaign mode ends with the final boss on wave 50; Ascension mode never ends.</p>
    <h4>CONTROLS</h4><div class="ls-keys">${[["W A S D", "Walk"], ["Mouse", "Aim · hold left click to shoot"], ["1 / 2 / 3", "Melee / primary / secondary"], ["4", "Medkit"], ["E", "Skill"], ["Q", "Ultimate (after 100 kills)"], ["R", "3rd skill (Astra: Safehouse)"], ["C", "Reload early (reloading is automatic when empty)"], ["Space", "Dash"], ["F", "Revive a downed teammate"], ["T", "Equipment"], ["Right click", "Build wheel (hold)"], ["U", "Level-up picker"], ["Tab", "Scoreboard"], ["Esc", "Menu"]].map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join("")}</div>
    <h4>TEAMWORK</h4><p>Stand next to a downed teammate and hold F for 5 seconds to revive them. If nobody gets there in time they sit out until the next wave. When you're down you can watch your teammates fight.</p>
    <h4>BUILD & REPAIR</h4><p>Hold right click for the build wheel: barricades, turrets, mines, electric fences and flame traps. Turrets, fences and traps need the generator: keep it fuelled and repaired.</p>
    <h4>LEVELLING & SHOP</h4><p>Kills give XP. Each level lets you pick an upgrade (press U). Between waves the shop opens: spend gold on guns, melee weapons and medkits.</p>`;
}
function setView(v) {
  ls.view = v; document.querySelectorAll(".ls-nav button").forEach(b => b.classList.toggle("on", b.dataset.view === v));
  document.querySelectorAll(".ls-view").forEach(s => s.hidden = s.dataset.view !== v);
  if (v !== "lobby") renderPages();
}
// ---- room panel, mission settings, party, ready button (from the server state) ----
function renderLobbyRoom() {
  const inRoom = !!(room && state), players = inRoom ? [...state.players.values()] : [], host = inRoom && state.hostId === myId, me = inRoom ? state.players.get(myId) : null;
  $("lsConnect").hidden = inRoom; $("lsRoom").hidden = !inRoom; $("ls").classList.toggle("guest", !host);
  $("lsHostNote").textContent = !inRoom ? "create a room" : host ? "host" : "host only";
  if (inRoom) {
    $("codeDisplay").textContent = ls.hideCode ? "•".repeat(Math.min(9, room.roomId.length)) : room.roomId;
    $("roomCount").textContent = `${players.length} / 8 PLAYERS`;
    const rows = players.map(p => `<div class="ls-pl"><span class="cr">${p.isHost ? "♛" : ""}</span><i class="av p-${p.characterClass || "assault"}"></i><span class="nm">${escapeHtml(p.name)}${p.isBot ? "<small>AI</small>" : p.sessionId === myId ? "<small>YOU</small>" : ""}</span><span class="st${p.ready ? " ok" : ""}">${p.ready ? "READY" : "NOT READY"}<i class="dot">${p.ready ? "✓" : ""}</i>${host && !p.isHost ? `<button class="x" data-kick="${p.sessionId}" data-bot="${p.isBot ? 1 : ""}" title="Remove">×</button>` : ""}</span></div>`);
    for (let i = players.length; i < 8; i++) rows.push(`<button class="ls-pl empty" data-invite="1" title="${host ? "Click to add an AI teammate (or use INVITE to bring friends)" : "Copy the invite link"}"><span class="plus">+</span><span>Invite player</span>${host ? "<small>+ AI</small>" : ""}</button>`);
    setHtml("lobbyPlayers", rows.join(""));
    setHtml("lsParty", players.map(p => { const o = rosterOf(p.characterClass); return `<div class="ls-pc${p.ready ? " ok" : ""}"><div class="top"><div class="av p-${o.id}"></div><div><b>${escapeHtml(p.name)}</b><small>${o.name}</small></div></div>${p.isHost ? '<span class="cr">♛</span>' : ""}${host && !p.isHost ? `<button class="x" data-kick="${p.sessionId}" data-bot="${p.isBot ? 1 : ""}" title="Remove">–</button>` : ""}<div class="rs">${p.ready ? "✓ READY" : "○ NOT READY"}</div></div>`; }).join(""));
    const humans = players.filter(p => !p.isBot), readyN = humans.filter(p => p.ready).length, all = readyN === humans.length;
    const btn = $("startGame"); btn.disabled = false; btn.classList.toggle("on", !host && !!me?.ready);
    if (host) { $("readyLabel").textContent = all ? "START MISSION" : "START ANYWAY"; $("readySub").textContent = `${readyN} / ${humans.length} READY`; }
    else { $("readyLabel").textContent = me?.ready ? "READY!" : "READY UP"; $("readySub").textContent = me?.ready ? "click to cancel · waiting for the host" : `${readyN} / ${humans.length} READY`; }
    // mission settings
    const site = state.mapSite || 0; $("mapName").textContent = SITE_NAMES[site][0]; $("mapSub").textContent = SITE_NAMES[site][1];
    $("setDifficulty").textContent = (state.difficulty || "normal").toUpperCase();
    $("setWaveMode").textContent = state.waveMode === "ascension" ? "ASCENSION (∞)" : "CAMPAIGN (50)";
    $("setFriendlyFire").textContent = state.friendlyFire ? "ON" : "OFF"; $("setExtraLoot").textContent = state.extraLoot ? "ON" : "OFF";
    $("setNoCd").checked = !!state.noCd;
    if (ls.mapSrc !== state.mapLayout) { ls.mapSrc = state.mapLayout; drawMapThumb(); }
  } else {
    setHtml("lsParty", ""); $("readyLabel").textContent = "CREATE A ROOM"; $("readySub").textContent = "or join a friend's room"; $("startGame").classList.remove("on");
  }
}
function drawMapThumb() {   // a little satellite view of the chosen map (from the layout the server sent)
  const c = $("lsMapThumb"), g = c.getContext("2d"), W = c.width, H = c.height, WW = 3600, WH = 2280, s = W / WW, oy = (H - WH * s) / 2;
  const src = ls.mapSrc || "", pm = src.startsWith("P:") ? PAINTED[src.slice(2)] : null;
  if (pm) {   // painted map: the picture itself (the tower's patch of it, as wide as the box)
    const im = paintImgs[pm.art]; g.fillStyle = "#1b1f1a"; g.fillRect(0, 0, W, H);
    if (!im?.naturalWidth) { im?.addEventListener("load", drawMapThumb, { once: true }); return; }
    const k = W / pm.w, sh = H / k, sy = Math.max(0, Math.min(pm.h - sh, pm.tower[1] - sh * .62));
    g.imageSmoothingEnabled = true; g.drawImage(im, 0, sy, pm.w, sh, 0, 0, W, H);
    g.fillStyle = "#ff4a2a"; g.shadowColor = "#ff4a2a"; g.shadowBlur = 10; g.beginPath(); g.arc(pm.tower[0] * k, (pm.tower[1] - sy) * k, 4, 0, 7); g.fill(); g.shadowBlur = 0;
    return;
  }
  g.fillStyle = "#1b1f1a"; g.fillRect(0, 0, W, H);
  const grad = g.createRadialGradient(W * .7, 0, 10, W * .7, 0, W); grad.addColorStop(0, "rgba(255,90,30,.25)"); grad.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = grad; g.fillRect(0, 0, W, H);
  g.fillStyle = "#2c2f2c"; g.fillRect(0, oy + WH / 2 * s - 6, W, 12); g.fillRect(W / 2 - 7, 0, 14, H);
  for (const r of (ls.mapSrc || "").split(";")) {
    const [k, x, y] = r.split(",").map(Number), kind = MAP_KINDS[k]; if (!kind) continue;
    const big = /building|ruin/.test(kind), tree = kind === "tree", car = /car|bus|police/i.test(kind);
    g.fillStyle = big ? "#4a3f39" : tree ? "#2f4a2a" : car ? "#5a5a60" : "#3a3a36"; const z = big ? 14 : tree ? 6 : car ? 6 : 3;
    g.fillRect(x * s - z / 2, oy + y * s - z / 2, z, z * (big ? .8 : 1));
  }
  g.fillStyle = "#ff4a2a"; g.shadowColor = "#ff4a2a"; g.shadowBlur = 10; g.beginPath(); g.arc(W / 2, oy + WH / 2 * s, 4, 0, 7); g.fill(); g.shadowBlur = 0;
}
// ---- animated hero sprite (until splash art exists) + embers ----
let lsAnimOn = true;
function lsFrame(t) {
  requestAnimationFrame(lsFrame);
  if (document.body.classList.contains("in-match")) return;
  const r = heroDef(), c = $("heroSprite"), img = dir8[r.id];
  if (!c.hidden && img?.naturalWidth) {
    const g = c.getContext("2d"); g.clearRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = false;
    const col = lsAnimOn ? [0, 0, 1, 2, 3, 0][Math.floor(t / 380) % 6] : 0, row = 7, sc = 5;   // facing down-left, idle with a few steps
    g.drawImage(img, col * D8.cellW, row * D8.cellH, D8.cellW, D8.cellH, c.width / 2 - D8.anchorX * sc, c.height - D8.feetY * sc - 6, D8.cellW * sc, D8.cellH * sc);
  }
  const e = $("lsEmbers"); if (!lsAnimOn) { if (e.width) { e.getContext("2d").clearRect(0, 0, e.width, e.height); } return; }
  if (e.width !== innerWidth || e.height !== innerHeight) { e.width = innerWidth; e.height = innerHeight; }
  const g = e.getContext("2d"); g.clearRect(0, 0, e.width, e.height); ls.embers = ls.embers || [];
  while (ls.embers.length < 70) ls.embers.push({ x: Math.random() * e.width, y: e.height + Math.random() * e.height * .6, v: 20 + Math.random() * 50, s: 1 + Math.random() * 2.5, w: Math.random() * 6, a: .4 + Math.random() * .6 });
  const dt = Math.min(.05, (t - (ls.last || t)) / 1000); ls.last = t;
  g.globalCompositeOperation = "lighter";
  for (const p of ls.embers) {
    p.y -= p.v * dt; p.x += Math.sin(t / 900 + p.w) * 12 * dt;
    if (p.y < -10) { p.y = e.height + 10; p.x = Math.random() * e.width; }
    const k = Math.min(1, p.y / e.height + .2) * p.a; g.fillStyle = `rgba(255,${120 + (p.w * 20) | 0},40,${k})`; g.fillRect(p.x, p.y, p.s, p.s);
  }
  g.globalCompositeOperation = "source-over";
}
requestAnimationFrame(lsFrame);
// mouse parallax: the hero and the scene lean a little toward the mouse
addEventListener("pointermove", e => { if (!lsAnimOn || document.body.classList.contains("in-match")) return; const dx = e.clientX / innerWidth - .5, dy = e.clientY / innerHeight - .5;
  $("lsHero").style.transform = `translate(${dx * -14}px,${dy * -8}px)`; $("lsScene").style.translate = `${dx * 18}px ${dy * 10}px`; });
// background splash art (assets/hero/background.webp from ChatGPT) replaces the drawn skyline when it exists
{ const im = new Image(); im.onload = () => { $("lsBgArt").src = im.src; $("lsBgArt").hidden = false; }; im.src = "assets/hero/background.webp"; }   // ChatGPT background over the drawn skyline

// ---- wiring ----
document.querySelectorAll(".ls-nav button").forEach(b => b.onclick = () => setView(b.dataset.view));
document.querySelectorAll(".ls-filters button").forEach(b => b.onclick = () => { ls.cat = b.dataset.cat; document.querySelectorAll(".ls-filters button").forEach(x => x.classList.toggle("on", x === b)); renderRoster(); });
document.querySelectorAll(".ls-tabs button").forEach(b => b.onclick = () => { ls.tab = b.dataset.tab; renderSide(); });
$("characterGrid").addEventListener("click", e => { const t = e.target.closest(".ls-tile[data-class]"); if (t) setSelectedClass(t.dataset.class, true); });
$("rosterPrev").onclick = () => $("characterGrid").scrollBy({ left: -372 }); $("rosterNext").onclick = () => $("characterGrid").scrollBy({ left: 372 });
addEventListener("keydown", e => {   // ← → pick the previous / next operator (lobby only, not while typing)
  if (document.body.classList.contains("in-match") || ls.view !== "lobby" || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || "")) return;
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const list = ROSTER.filter(r => ls.cat === "all" || r.cat === ls.cat), i = list.findIndex(r => r.id === selectedClass), n = list[(i + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length];
  if (n) { setSelectedClass(n.id, true); document.querySelector(`.ls-tile[data-class="${n.id}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }); }
});
$("copy").onclick = () => room && copyText(room.roomId, "Room code copied");
$("lsEye").onclick = () => { ls.hideCode = !ls.hideCode; renderLobbyRoom(); };
const invite = () => { if (!room) return toast("Create a room first, then invite your friends."); const { code, url } = inviteText(); copyText(url ? `Join my Survival Ascension squad! ${url}  (room code ${code})` : code, url ? "Invite link copied: paste it to your friends" : "Room code copied"); };
$("lsInvite").onclick = invite; $("lsFriends").onclick = invite;
$("lobbyPlayers").addEventListener("click", e => {
  const k = e.target.closest("[data-kick]"); if (k) { room?.send(k.dataset.bot ? "removeBot" : "kick", { id: k.dataset.kick }); return; }
  if (e.target.closest("[data-invite]")) { if (room && state?.hostId === myId) { room.send("addBot"); toast("AI teammate added"); } else invite(); }
});
$("lsParty").addEventListener("click", e => { const k = e.target.closest("[data-kick]"); if (k) room?.send(k.dataset.bot ? "removeBot" : "kick", { id: k.dataset.kick }); });
$("lsRename").onclick = () => {
  const cur = room && state ? state.players.get(myId)?.name : $("name").value;
  if (!room) { $("name").focus(); $("name").select(); return; }
  const box = document.createElement("input"); box.maxLength = 18; box.value = cur || ""; box.className = "ls-renamebox"; box.style.cssText = "position:absolute;left:14px;right:14px;top:46px;z-index:3";
  const panel = $("lsRename").closest(".ls-panel"); panel.style.position = "relative"; panel.appendChild(box); box.focus(); box.select();
  let closed = false; const done = ok => { if (closed) return; closed = true; if (ok && box.value.trim()) { room.send("setName", { name: box.value.trim() }); $("name").value = box.value.trim(); } box.remove(); };   // Enter then blur: only once
  box.onkeydown = e => { if (e.key === "Enter") done(true); if (e.key === "Escape") done(false); }; box.onblur = () => done(true);
};
const sendSettings = d => { if (room && state?.hostId === myId) room.send("settings", d); };
$("mapPrev").onclick = () => sendSettings({ map: ((state?.mapSite || 0) + SITE_NAMES.length - 1) % SITE_NAMES.length });
$("mapNext").onclick = () => sendSettings({ map: ((state?.mapSite || 0) + 1) % SITE_NAMES.length });
document.querySelectorAll(".ls-set").forEach(b => b.onclick = () => {
  if (!room) return toast("Create a room first."); if (state?.hostId !== myId) return toast("Only the host can change the mission settings.");
  const k = b.dataset.set;
  if (SETTING_OPTS[k]) { const o = SETTING_OPTS[k], cur = state[k] || o[0]; sendSettings({ [k]: o[(o.indexOf(cur) + 1) % o.length] }); }
  else sendSettings({ [k]: !state[k] });
});
$("startGame").onclick = () => {
  if (!room) { $("name").focus(); return toast("Type your name, then CREATE ROOM (or join with a code)."); }
  if (state?.hostId === myId) room.send("start"); else room.send("ready");
};
$("exploreGame").onclick = () => { if (room && state?.hostId === myId) room.send("start", { explore: true }); };
$("lsSettingsBtn").onclick = () => { $("lsSettings").hidden = !$("lsSettings").hidden; $("lsConfirm").hidden = true; };
$("lsLeave").onclick = () => { if (!room) return toast("You're not in a room."); $("lsConfirm").hidden = false; $("lsSettings").hidden = true; };
$("lsLeaveNo").onclick = () => { $("lsConfirm").hidden = true; }; $("lsLeaveYes").onclick = () => { $("lsConfirm").hidden = true; room?.leave(); };
document.addEventListener("pointerdown", e => { if (!e.target.closest(".ls-pop,.ls-icons")) { $("lsSettings").hidden = true; $("lsConfirm").hidden = true; } });
$("setNoCd").onchange = () => room?.send("testNoCd");
$("setSfx").onchange = () => setSfxOn($("setSfx").checked);
$("setAmbient").onchange = () => setMusicOn($("setAmbient").checked);
document.addEventListener("click", e => { if (!inMatch() && e.target.closest?.("button, [data-class], [data-hero], .ls-hero, .ls-card")) { sfxContext(); playSfx("select"); } });   // lobby clicks
$("setMotion").onchange = () => { lsAnimOn = $("setMotion").checked; $("ls").classList.toggle("still", !lsAnimOn); savePrefs(); };
function savePrefs() { try { localStorage.setItem("sa-prefs", JSON.stringify({ sfx: sfxOn, music: musicOn, motion: lsAnimOn })); } catch {} }
try { const pr = JSON.parse(localStorage.getItem("sa-prefs") || "{}"); if (pr.sfx === false) { sfxOn = false; $("setSfx").checked = false; $("sfxToggle").textContent = "Sound effects: OFF"; } if (pr.music === false) { musicOn = false; $("setAmbient").checked = false; $("musicToggle").textContent = "Music: OFF"; } if (pr.motion === false) { lsAnimOn = false; $("setMotion").checked = false; $("ls").classList.add("still"); } } catch {}
{ const q = new URLSearchParams(location.search).get("room"); if (q) { $("roomCode").value = q; toast("Type your name and press JOIN to enter your friend's room."); } }   // invite links
setSelectedClass(selectedClass, false); renderLobbyRoom(); drawMapThumb();
