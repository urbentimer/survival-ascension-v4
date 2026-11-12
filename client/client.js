import { Client } from "https://cdn.jsdelivr.net/npm/colyseus.js@0.16.19/+esm";
import { GAME_CONFIG } from "./configs.js";
import { GAME_SERVER } from "./config.js";
import { mapBoxes, statueBodyBoxes, trackNearest, MAP_KINDS, MAP_FLAT, PAINTED, paintedLayout, dynastyGround, whiteoutGround, refineryGround, carnivalGround, mineGround, crucibleGround, crucibleRivers, mineTrack, MN_SPOT, coasterTrack, coasterAt, coasterCart, coasterSeat, COASTER } from "./mapLayout.js";
import { MN_ART, MN_TILES, MN_CART, MN_FX } from "./mineArt.js";
import { MB } from "./mineBeastArt.js";   // the Mine Beast's sheets + effects (tools/extract-minebeast.py)   // The Deep Mine pieces, the mine cart, the portal swirl + crystal shatter (tools/extract-mine.py)
import { CV_ART, CV_TILES, CV_CART } from "./carnivalArt.js";   // Midnight Carnival pieces + the coaster cart (tools/extract-carnival.py)
import { RF_ART, RF_TILES } from "./refineryArt.js";
import { KC_ART, KC_TILES } from "./crucibleArt.js";   // The Crucible pieces + tiles (tools/extract-crucible.py)   // Scorched Refinery pieces (tools/extract-refinery.py)
import { WO_ART, WO_TILES } from "./whiteoutArt.js";   // Whiteout Station pieces (tools/extract-whiteout.py)
import { DYN_ART, DYN_TILES } from "./dynastyArt.js";   // Fallen Dynasty pieces: urls, sizes, lantern lights, fires (tools/extract-dynasty.py)   // same collision rules as the server (movement prediction)

const $ = id => document.getElementById(id);
// (Nov 12) THE GAME CLOCK: every animation / timer in this file reads gnow(), which stops while the host has the game paused
// (zombies freeze mid-step, fires and effects hold still) and carries on from the same moment when they unpause.
const _realNow = () => performance.now(); let gPauseAt = 0, gPauseOff = 0;
function gnow() { return (gPauseAt || _realNow()) - gPauseOff; }
function gamePause(on) { if (on && !gPauseAt) gPauseAt = _realNow(); else if (!on && gPauseAt) { gPauseOff += _realNow() - gPauseAt; gPauseAt = 0; } }
const serverInput = new URLSearchParams(location.search).get("server");
const defaultEndpoint = location.protocol === "https:" ? `wss://${location.host}` : `ws://${location.hostname || "localhost"}:${GAME_CONFIG.serverPort}`;
const endpoint = serverInput || GAME_SERVER || defaultEndpoint;
const client = new Client(endpoint);
let room = null, myId = "", state = null, keys = {}, lastInput = 0, lastShoot = 0, dashReady = true, selectedClass = loadProfile().characterClass || "assault";
const canvas = $("arena"), W = canvas.width, H = canvas.height; let ctx = canvas.getContext("2d");   // let: the ground cache paints chunks through the same helpers
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
const upgrades = [ ["damage","Heavy weapon","+20% weapon damage"], ["fireRate","Rapid fire","+20% firing speed"], ["health","Vitality","+20 maximum HP and heal"], ["defence","Body armour","ARMOR_TEXT"], ["speed","Adrenaline","+10% movement speed"], ["cooldown","Quick recovery","-10% skill cooldowns (max -60%)"], ["hands","Fast Hands","+15% reload speed, +20% magazine size (max 5)"] ];
const ARMOR_STEP = { juggernaut: .08, slasher: .08, dispatcher: .06, operator: .06, assault: .06, engineer: .06, demolitionist: .04, sniper: .04, scout: .04 };   // matches the server (Body Armour by weight class)
const upgradeChoices = me => upgrades.filter(([id]) => (id !== "cooldown" || (me?.cdr || 0) < .6 - 1e-9) && (id !== "hands" || (me?.hands || 0) < 5) && (id !== "defence" || (me?.armorPct || 0) < (ARMOR_STEP[me?.characterClass] || .06) * 8 - 1e-9))
  .map(u => { if (u[0] !== "defence") return u; const st = ARMOR_STEP[me?.characterClass] || .06, cls = st > .07 ? "heavy" : st < .05 ? "light" : "medium";
    return [u[0], u[1], `−${Math.round(st * 100)}% damage taken (${cls} hero, max −${Math.round(st * 800)}%)`]; });   // capped upgrades leave the list
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
  assault: { name: "Combat Rush", cd: 15 },
  engineer: { name: "Robot Squad", cd: 25, icon: "robotSquad" }, scout: { name: "Shadow Pass", cd: 25, icon: "shadowPass" }, demolitionist: { name: "Sky Barrage", cd: 8, icon: "skyBarrage" },
  sniper: { name: "Dead Eye", cd: 24 }, juggernaut: { name: "Iron Bastion", cd: 30, icon: "ironBastion" }, operator: { name: "Steel Convoy", cd: 30, icon: "steelConvoy" },
  dispatcher: { name: "Emergency Medics", cd: 30, icon: "medicTeam" },
};
const BUILD_CAP = { barricade: 10, turret: 3, mine: 8, fence: 4, flameTrap: 4 };   // per player, per type (matches the server); Viktor +1 turret. One more replaces your oldest.
const buildCap = (me, kind) => (BUILD_CAP[kind] || 0) + (kind === "turret" && me?.characterClass === "engineer" ? 1 : 0);
const ownedOf = kind => state ? [...state.structures.values()].filter(st => st.kind === kind && st.ownerId === myId).length : 0;
const BUILD_WHEEL = [
  { id: "barricade",  name: "Barricade",        cost: { scrap: 15 } },
  { id: "turret",     name: "Turret",           cost: { scrap: 35, electronics: 8 } },
  { id: "mine",       name: "Mine",             cost: { scrap: 8, explosives: 3 } },
  { id: "fence",      name: "Elec. fence",   cost: { scrap: 25, electronics: 5 } },
  { id: "flameTrap",  name: "Flame trap",       cost: { scrap: 20, fuel: 8 } },
];   // (repair tower / repair + refuel generator: an F prompt when you stand next to them, Nov 9: stationPrompt)
// picture shown in the build wheel for each option
const WHEEL_PIC = { barricade: { obj: "barricade" }, turret: { obj: "turret" }, mine: { obj: "mine" }, fence: { obj: "fence" }, flameTrap: { obj: "flameTrap" } };
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
function status(text, good = false) { txt("connection", text); $("connection").style.borderColor = good ? "#4d9c68" : "#8a6852"; }
function message(text) { toast(text); }
// DOM writes only when the value changed: the HUD re-renders on every server patch (20/s); rewriting identical text or HTML
// still costs the browser a style/layout pass that competes with the canvas frame.
const domCache = new Map();
function txt(id, v) { v = String(v); if (domCache.get("t" + id) === v) return; domCache.set("t" + id, v); $(id).textContent = v; }
function html(id, v) { if (domCache.get("h" + id) === v) return; domCache.set("h" + id, v); $(id).innerHTML = v; }
function sty(id, prop, v) { const k = "s" + id + prop; if (domCache.get(k) === v) return; domCache.set(k, v); $(id).style[prop] = v; }
function showOverlay(title, text) {
  $("shop").classList.add("hidden"); $("breakBtns").classList.add("hidden"); $("overlay").classList.remove("hidden");
  txt("overlayTitle", title); txt("overlayText", text);
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
const RECON_KEY = "sa-recon";   // sessionStorage: this tab's reconnection token, so a refresh rejoins the match it was in (the server holds the seat 30s)
const rememberSeat = () => { try { if (!SOLO_PREVIEW && room?.reconnectionToken) sessionStorage.setItem(RECON_KEY, JSON.stringify({ token: room.reconnectionToken, at: Date.now() })); } catch {} };
const forgetSeat = () => { try { sessionStorage.removeItem(RECON_KEY); } catch {} };
function connected() {
  try { const d = JSON.parse(sessionStorage.getItem("sa-drop") || "null"); if (d) { sessionStorage.removeItem("sa-drop"); setTimeout(() => { try { room?.send("clientError", { m: `earlier drop: close code ${d.code} in ${d.ph}, ${Math.round((Date.now() - d.at) / 1000)}s ago, tab ${d.vis}, online ${navigator.onLine}, ${navigator.connection?.effectiveType || "?"} rtt ${navigator.connection?.rtt ?? "?"}`, lv: "warn", ua: navigator.userAgent.replace(/^Mozilla\/5\.0 /, "") }); } catch {} }, 800); } } catch {}
  myId = room.sessionId; status("Connected · " + room.roomId, true); rememberSeat();
  toast("Room created. Press INVITE to send your friends the link."); renderLobbyRoom();
  room.onStateChange(s => { state = s; lastStateAt = gnow(); try { recordSnapshots(); reconcile(); renderState(); audioWatch(); } catch (e) { reportError(e, "ui"); } });
  awayIds.clear(); room.onMessage("away", m => { if (m.on) awayIds.add(m.id); else awayIds.delete(m.id); });   // a teammate's connection dropped / came back
  room.onMessage("deadeye", m => { fx.push({ type: "deadeye", ...m, t: gnow() }); playSfx("rifle", m.x, m.y, 1); playSfx("boom", m.x, m.y, .35); if (m.id === myId) shake(4, 160); });   // Sienna's Dead Eye
  room.onMessage("shot", m => { if (m.id === myId && PRED.ok) { const me = me_(); if (me) { m.x += PRED.x + PRED.ex - me.x; m.y += PRED.y + PRED.ey - me.y; } } fx.push(m.w === "launcher" ? { ...m, type: "dante", k: "rocket", t: gnow() } : { type: m.w === "shotgun" ? "shotgun" : "shot", t: gnow(), seed: Math.random() * 100, ...m }); const a = anim.get(m.id); if (a) a.shotAt = gnow(); if (m.id && m.id[0] !== "p" && !state?.players?.has(m.id)) machineShotAt.set(m.id, gnow()); shotSound(m); });
  room.onMessage("wreck", m => fx.push({ type: "wreck", t: gnow(), ...m }));
  room.onMessage("laser", m => fx.push({ type: "laser", t: gnow(), ...m }));
  room.onMessage("heal", m => { if (m.id && state?.players?.has(m.id)) regenPlay(m.id, m.k === "medkit"); else fx.push({ type: "healfx", t: gnow(), ...m }); });   // healing effect on whoever was healed
  room.onMessage("summon", m => fx.push({ type: "summon", t: gnow(), ...m }));
  room.onMessage("sky", m => { const t = gnow(); skyAnim.set(m.id, { t0: t, a: m.a }); fx.push({ ...m, type: "dante", k: "sky", t }); });
  room.onMessage("demo", m => { const t = gnow(); if (m.k === "place") danteAnim.set(m.id, { t0: t, a: m.a }); else { scorch(m.x, m.y, 1.4); playSfx("boom", m.x, m.y); DEMO.rings.forEach(rg => setTimeout(() => playSfx("boom", m.x, m.y, .8), (rg.at + DEMO.flight) * 1000)); for (const [x, y, ri, big] of m.pts || []) setTimeout(() => scorch(x, y, big ? .8 : 1, big ? "big" : "small"), (DEMO.rings[ri].at + DEMO.flight) * 1000); fx.push({ ...m, type: "dante", k: "ripple", t }); shake(12, 700); } });
  room.onMessage("shadow", m => { const t = gnow(); fx.push({ ...m, type: "raven", k: m.k, t }); if (m.k === "dash") ravenDash.set(m.id, { t0: t, a: m.a }); if (m.k === "ignite" && m.id === myId) shake(4, 160); });
  room.onMessage("chop", m => { fx.push({ type: "chop", t: gnow(), ...m }); const me = me_(); if (me && Math.hypot(me.x - m.x, me.y - m.y) < 420) shake(11, 380); });
  room.onMessage("deflect", m => {
    const now = gnow(); fx.push({ type: "deflect", t: now, ...m }); hitStopUntil = now + (m.heavy ? 130 : 90); flashUntil = now + 140;
    const me = me_(); if (me && Math.hypot(me.x - m.x, me.y - m.y) < 600) shake(m.heavy ? 14 : 10, 320);
  });
  room.onMessage("clang", m => fx.push({ type: "clang", t: gnow(), ...m }));
  room.onMessage("roar", m => { shake(12, 700); playSfx("roar", m?.x, m?.y); });
  room.onMessage("hooked", m => { if (m.id === myId) shake(7, 250); });
  room.onMessage("deep", m => { try { onDeep(m); } catch (e) { reportError(e, "deep"); } });
  room.onMessage("coaster", m => { if (m.id !== myId) return; coastQueued = m.k === "queue"; if (m.k === "on" || m.k === "off") playSfx(m.k === "on" ? "stomp" : "zap", undefined, undefined, .5);
    if (m.k === "queue") feed.unshift({ text: mineMap() ? "Wait here: you'll hop in when the carts stop" : "Wait here: you'll hop on when the train stops", t: Date.now() }); if (m.k === "on") feed.unshift({ text: mineMap() ? "In the mine cart! One lap of the mine: shoot from the cart." : "On the coaster! One lap, shoot from the cart. F at a station to get off.", t: Date.now() }); feed.length = Math.min(feed.length, 5); });
  room.onMessage("pyramid", m => { pyrBurst = gnow(); shake(13, 1100); playSfx("boom", m.x, m.y, .9); });
  room.onMessage("bossDead", m => { bossCorpses.push({ ...m, t: gnow() }); shake(10, 500); });
  room.onMessage("spit", m => fx.push({ type: "spit", t: gnow(), ...m }));
  room.onMessage("whip", m => { const me = me_(); if (me && Math.hypot(me.x - m.x, me.y - m.y) < 140) shake(6, 180); });
  room.onMessage("slam", m => { fx.push({ type: "slam", t: gnow(), ...m }); playSfx("stomp", m.x, m.y); const me = me_(); if (me && Math.hypot(me.x - m.x, me.y - m.y) < m.r * 2.2) shake(9, 320); });
  room.onMessage("hive", m => onHive(m));
  room.onMessage("travel", () => { shake(6, 500); feed.unshift({ text: "NEW MAP: get ready, the next wave starts here", t: Date.now() }); feed.length = Math.min(feed.length, 5); });   // (Nov 12) on to the next map (its title card shows when the wave starts)
  room.onMessage("plateDrop", m => { fx.push({ type: "plateBurst", x: m.x, y: m.y, t: gnow() }); shake(8, 600); });   // the Pyre Plate falls out of him
  room.onMessage("plateGot", m => { const p = state?.players.get(m.id); if (p) fx.push({ type: "plateGot", id: m.id, x: p.x, y: p.y, t: gnow() }); if (m.id === myId) { equipKey = ""; flashUntil = gnow() + 120; } });
  room.onMessage("pyre", onPyre); room.onMessage("scream", onScreamer); room.onMessage("abom", onAbom);
  room.onMessage("zdead", m => { if (m.k === "abomSpawn") { const t = gnow(); fx.push({ type: "abom", k: "sdead", x: m.x, y: m.y, t }); fx.push({ type: "abom", k: "ember", x: m.x, y: m.y - 45, sc: 1.2, from: 8, t }); shake(6, 260); playSfx("boom", m.x, m.y, .5); }
    if (m.k === "screamer") { fx.push({ type: "scream", k: "death", x: m.x, y: m.y, t: gnow() }); shake(9, 450); scrWail.delete(m.id); playSfx("roar", m.x, m.y, .7); }
    if (m.k === "pyre") { fx.push({ type: "pyre", k: "death", x: m.x, y: m.y, t: gnow() }); splat(m.x, m.y, 30, true); shake(9, 450); pyreMove.delete(m.id); pyreWalk.delete(m.id); if (pyreWheel?.id === m.id) pyreWheel = null; feel.hp.delete(m.id); return; } if (m.k === "hivemind") { fx.push({ ...m, type: "hive", k: "death", t: gnow() }); splat(m.x, m.y, 40, true); shake(10, 500); feel.hp.delete(m.id); feel.pos?.delete(m.id); return; } if (feel.pos?.has(m.id)) feel.last.set(m.id, gnow()); else { const r = 14; splat(m.x, m.y, 10, false); addCorpse({ x: m.x, y: m.y, r, kind: m.k, facing: 1 }); } });
  room.onMessage("briggs", onBriggs); room.onMessage("astra", onAstra);
  room.onMessage("frag", m => { const t = gnow(); fragHop.set(m.id, t); fx.push({ ...m, type: "dante", k: "frag", t }); shake(m.id === myId ? 6 : 3, 200); });   // Marcus Frag Barrage
  room.onMessage("rush", m => rushStart.set(m.id, gnow()));   // Marcus Combat Rush started: burst ring + screen flash
  room.onMessage("dash", m => { if (m.id !== myId) dashBeam(m.id, m.x0, m.y0, m.x1, m.y1); });   // yours is drawn the moment you dash
  room.onMessage("sofea", m => { const t = gnow();
    if (m.k === "fire") { sofeaShotAt.set(m.id, t); for (const [ox, oy, bx, by] of m.pts) { fx.push({ type: "sofea", k: "proj", kind: m.kind, ox, oy, bx, by, dur: Math.hypot(bx - ox, by - oy) / m.sp, t }); const a = Math.atan2(by - oy, bx - ox), d = m.kind === "tank" ? SOF.tank.barrel : 26, lift = m.kind === "tank" ? SOF.tank.tur : SOF.heli.alt; fx.push({ type: "sofea", k: "muzzle", kind: m.kind, x: ox + Math.cos(a) * d, y: oy + Math.sin(a) * d - lift, a, t }); } if (m.id === myId) shake(m.kind === "tank" ? 5 : 3, 150); }
    else if (m.k === "slash") { mechaSlash.set(m.id, { t, a: m.a, flip: !mechaSlash.get(m.id)?.flip }); const pl = state?.players?.get(m.id); if (pl) playSfx("zap", pl.x, pl.y, .45); }
    else if (m.k === "leave" && m.kind === "mecha") { const pl = state?.players?.get(m.id), v = m.id === myId && pl ? aimAngle(pl) : (pl?.aim || 0); mechaOut.set(m.id, { t, row: rowOf(v) }); mechaSlash.delete(m.id); mechaFlame.delete(m.id); }
    else if (m.k === "board" && m.kind === "mecha") { fx.push({ type: "sofea", k: "dust", x: m.x, y: m.y + 14, s: .6, t }); playSfx("stomp", m.x, m.y); if (m.id === myId) shake(4, 160); }
    else if (m.k === "board" || (m.k === "leave" && m.ok)) fx.push({ type: "sofea", k: "dust", x: m.x, y: m.y + 14, s: m.kind === "tank" ? 1 : .8, t }); });
  room.onMessage("buildGone", m => { fx.push({ type: "sofea", k: "dust", x: m.x, y: m.y + 10, s: .8, t: gnow() }); playSfx("zap", m.x, m.y, .4); });   // your oldest deployable of a type was replaced (per-player cap)
  room.onMessage("boom", m => { playSfx("boom", m.x, m.y, m.k === "hrocket" ? .75 : 1); if (m.k === "shell" || m.k === "hrocket") { scorch(m.x, m.y, m.k === "shell" ? 1 : .85); fx.push({ ...m, type: "sofea", kind: m.k, k: "boom", t: gnow() }); shake(m.k === "shell" ? 8 : 6, 240); return; } scorch(m.x, m.y, m.k === "sky" ? 1.1 : .9); fx.push({ ...m, type: "dante", k: "boom", t: gnow() }); shake(m.k === "sky" ? 9 : m.k === "mine" ? 5 : 7, 260); });   // mine: the same fireball
  room.onMessage("swing", m => { fx.push({ type: "swing", t: gnow(), ...m }); if (m.fire || m.crit) fx.push({ ...m, type: "raven", k: m.fire ? "fireArc" : "crit", t: gnow() }); const a = anim.get(m.id); if (a) { a.swingAt = gnow(); a.heavy = !!m.heavy; } if (m.heavy) shake(m.id === myId ? 8 : 4, 220); });
  room.onLeave(code => {
    const dropped = code !== 1000 && code !== 4000 && state && state.phase !== "lobby" && !SOLO_PREVIEW && room?.reconnectionToken;   // 1000 = you left on purpose, 4000 = kicked
    try { if (code !== 1000 && code !== 4000) sessionStorage.setItem("sa-drop", JSON.stringify({ code, at: Date.now(), vis: document.visibilityState, ph: state?.phase })); } catch {}
    if (dropped) { dropInfo = { code, at: Date.now(), vis: document.visibilityState }; reconnectRoom(room.reconnectionToken); return; }   // a wifi blip / sleeping phone: the server holds your spot for 30s
    forgetSeat(); status("Disconnected"); room = null; state = null; toast(code === 4000 ? "The host removed you from the room." : "You left the room."); renderLobbyRoom();
    document.body.classList.remove("in-match"); closePanels(); $("gameArea").classList.add("hidden");
  });
  room.onError((code, msg) => message("Room error: " + msg));
}
// Connection dropped mid-match: try to get back in with the reconnection token (the server keeps the seat for 30s), a few times.
let reconnecting = false, dropInfo = null;   /* why the last connection closed: reported to the server log after reconnecting */
async function reconnectRoom(token) {
  if (reconnecting) return; reconnecting = true; room = null;
  const feedMsg = t => { feed.unshift({ text: t, t: Date.now() }); feed.length = Math.min(feed.length, 5); };
  status("Reconnecting…"); feedMsg("Connection lost. Reconnecting…");
  for (let i = 0; i < 6; i++) {
    try { room = await client.reconnect(token); connected(); reconnecting = false; feedMsg("Reconnected."); if (dropInfo) { try { room.send("clientError", { m: `connection dropped: close code ${dropInfo.code}, back after ${Date.now() - dropInfo.at}ms, tab ${dropInfo.vis}`, lv: "warn", ua: navigator.userAgent.replace(/^Mozilla\/5\.0 /, "") }); } catch {} dropInfo = null; } toast("Reconnected"); return; }
    catch (e) { console.warn("[reconnect]", i + 1, e?.message || e); await new Promise(r => setTimeout(r, 1500 + i * 1200)); }
  }
  reconnecting = false; forgetSeat(); status("Disconnected"); state = null; toast("Couldn't reconnect. Create or join a room to play again."); renderLobbyRoom();
  document.body.classList.remove("in-match"); closePanels(); $("gameArea").classList.add("hidden");
}
// Page refreshed mid-match (F5, a phone reloading the tab): rejoin the same room with the saved token instead of starting over.
async function rejoinAfterRefresh() {
  let saved = null; try { saved = JSON.parse(sessionStorage.getItem(RECON_KEY) || "null"); } catch {}
  if (SOLO_PREVIEW || !saved?.token || Date.now() - saved.at > 20 * 60 * 1000) return;
  status("Rejoining your match…");
  try { room = await client.reconnect(saved.token); connected(); toast("Back in your match."); }
  catch (e) { forgetSeat(); status("Not connected"); console.warn("[rejoin]", e?.message || e); }
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
  pyre: { wave: 16, portrait: "assets/portraits/pyre.webp", name: "THE PYRE PRIEST",
    lore: "A burning cultist swinging a giant censer on a chain. He hunts survivors, never the tower, and he never stops coming.",
    skills: [
      ["🏮", "Lamp Strike", "His basic attack: up close he smashes the burning lamp down in front of him every second or so. Get beside or behind him.", "#ffb347"],
      ["🔥", "Censer Swing", "When you get close, a spinning red ring shows his reach. Then he spins the censer all the way round: damage, knockback, and you catch fire. Dash through it or get out.", "#ff7a2a"],
      ["👣", "Firewalk", "For 8s every step he takes leaves burning ground. Don't stand in it: it sets you on fire.", "#ffb02a"],
      ["🙏", "Sermon of Ash", "He kneels and 7 glowing circles appear: under the 3 closest survivors and at random spots around him. 1s later they erupt into fire pillars. While he kneels, hit him from BEHIND for double damage.", "#ff4a2a"],
      ["☸️", "Wheel of Flame", "4 lines of fire (12, 3, 6, 9 o'clock) spin CLOCKWISE around him for 60s and follow him everywhere. Walk clockwise with them to stay clear.", "#ffc04a"],
      ["💢", "Enraged (below 35%)", "Faster, attacks come back sooner, the wheel spins faster, the fire lasts longer and the pillars get bigger.", "#ff3737"],
      ["🛡️", "Reward: THE PYRE PLATE", "Kill him and his armour drops: one piece each. Wear it (T) for the rest of the run: 25% less damage, +30 max HP, and you can't catch fire.", "#ffc531"],
    ] },
  hivemind: { wave: 8, portrait: "assets/portraits/hivemind.webp", name: "THE ALPHA HIVEMIND",
    lore: "The oldest Hivemind in the walled city: twice the size of the others, and it carries a brood inside it.",
    skills: [
      ["🦷", "Crushing Bite", "Up close it lunges and bites everything in front of it. Its reach is longer than it looks: stay at range.", "#ff7a5a"],
      ["💥", "Ground Slam", "A red circle fills up under it, then it slams: damage and a short stun. Get out of the circle before it fills.", "#ff4a3a"],
      ["🦘", "Leap", "Far away? It jumps at you and lands just short. The landing hurts everyone around it: spread out.", "#ffb347"],
      ["🧟", "Spawning", "Every few seconds it tears zombies out of its own body. Clear them or they swarm you.", "#b5c26b"],
      ["🐛", "The Brood", "At 66% health it tears off a whole Hivemind; at 33%, two more. Focus the Alpha: killing it ends the fight.", "#ffd36b"],
    ] },
  screamer: { wave: 12, portrait: "assets/portraits/screamer.webp", name: "THE SCREAMER",
    lore: "The city's old radio voice, now a walking loudspeaker. He hates being close: he backs away and attacks from range.",
    skills: [
      ["📢", "Shriek", "His basic attack: a cone of sound in front of him knocks you back. Crowd him with 3+ and it hits all around him. Flank him.", "#3df2ff"],
      ["〰️", "Echo Rings", "Rings of sound roll out from his feet. Each one hurts and slows you. DASH through a ring to dodge it.", "#7fe7ff"],
      ["🎯", "Resonance", "Marks 2 survivors. 3s later each mark explodes and hurts everyone near it. Marked? Walk AWAY from your team.", "#b8f6ff"],
      ["🔊", "Deafening Wail", "His throat swells for 2.5s: TAKE COVER behind a building, the tower, the generator or a barricade. Anyone he can see gets hit and stunned. Or shoot his glowing throat (×2 damage) hard enough and he CHOKES.", "#3df2ff"],
      ["🏃", "Call of the Horde", "At 66% and 33% health he calls a pack of frenzied runners that hunt you down.", "#ffd36b"],
      ["💢", "Enraged (below 35%)", "Faster, more rings, everything comes back sooner.", "#ff3737"],
    ] },
  abomination: { wave: 24, portrait: "assets/portraits/abomination.webp", name: "THE ABOMINATION",
    lore: "Five bodies fused into one lump of black rock and lava. Slow and heavy... until it tears itself apart.",
    skills: [
      ["💥", "Flail Slam", "His giant arm smashes a long line in front of him. Step out of the marked line.", "#ff8a3d"],
      ["🌑", "Gut Roll", "Curls into a ball and rolls down a marked lane, crushing your deployables. He rolls THROUGH buildings, so walls won't save you: step out of the lane. Where he stops he's DAZED for 3s (×1.5 damage): that's your opening.", "#ffb36b"],
      ["🌋", "Lava Spew", "A cone of lava, then burning puddles on the ground that slow you. Don't fight in them.", "#ff5a1f"],
      ["🩸", "The Sundering", "At 45% health he stops, can't be hurt, and tears into FIVE. You have about 3 seconds to back off and spread out: they run at you the moment they're free.", "#ffd36b"],
      ["🐾", "The Five", "Five fast hunters, each with its own health, each chasing a different survivor and pouncing. Every one you kill makes the rest faster. Kill all five.", "#ff3737"],
    ] },
};
let introAcked = false;
function renderBossIntro() {
  const phase = state.bossPhase, kind = state.bossIntro;
  if (phase !== "intro") introAcked = false;
  const show = phase === "intro" && !introAcked;
  $("bossIntro").classList.toggle("hidden", !show);
  $("bossWaitBanner").classList.toggle("hidden", !(phase === "intro" && introAcked));
  if (phase === "intro") txt("bossWaitBanner", `Waiting for teammates… ${state.introReady || 0}/${state.introNeed || 1} ready`);
  if (!show || $("bossIntro").dataset.kind === kind) { if (show) txt("bossIntroWait", `${state.introReady || 0}/${state.introNeed || 1} survivors ready`); return; }
  $("bossIntro").dataset.kind = kind;
  const info = BOSS_INFO[kind] || { wave: state.stage, name: String(kind).replace(/[A-Z]/g, m => " " + m).toUpperCase(), lore: "A new horror approaches. Nobody has survived it long enough to tell.", skills: [["❓", "Unknown", "Stay together and keep moving.", "#888"]] };
  txt("bossIntroWave", `BOSS · WAVE ${state.stage}`);
  txt("bossIntroName", info.name); txt("bossIntroLore", info.lore);
  $("bossIntroImg").src = info.portrait || ""; $("bossIntroImg").hidden = !info.portrait;
  html("bossIntroSkills", info.skills.map(([ico, name, txt, c]) => `<li style="--c:${c}"><span class="ico" aria-hidden="true">${ico}</span><span><b>${escapeHtml(name)}</b>${txt}</span></li>`).join(""));
  txt("bossIntroWait", `${state.introReady || 0}/${state.introNeed || 1} survivors ready`);
  setTimeout(() => $("bossAck").focus(), 50);
}
function ackBoss() { if (!introAcked && state?.bossPhase === "intro") { introAcked = true; room?.send("ackBoss"); renderBossIntro(); } }
$("bossAck").onclick = ackBoss;
// ===== ESC MENU (Nov 12: the user's design): PAUSED on the left; DEVELOPER TOOLS (any host) on the right: BOSSES / DEEP MINE / TESTING =====
const BOSS_NAMES = { 4: "The Butcher", 8: "The Alpha Hivemind", 12: "The Screamer", 16: "The Pyre Priest", 20: "The Mine Beast", 24: "The Abomination" };   // (Nov 12: the map order)
let pmToastAt = 0;
function pmToast(text) { const el = $("pmToast"); if (!el) return; txt("pmToastT", text); el.classList.remove("hidden"); pmToastAt = Date.now(); setTimeout(() => { if (Date.now() - pmToastAt >= 2350) el.classList.add("hidden"); }, 2400); }
function pmDo(msg, data, text, close = true) { room?.send(msg, data); if (text) pmToast(text); if (close) closePanels(); }
let pmTabNow = "bosses"; try { pmTabNow = localStorage.getItem("sa-pmTab") || "bosses"; } catch {}
function pmTab(t) { pmTabNow = t; try { localStorage.setItem("sa-pmTab", t); } catch {} for (const b of document.querySelectorAll(".pm-tab")) b.classList.toggle("on", b.dataset.tab === t); for (const p of document.querySelectorAll(".pm-pane")) p.classList.toggle("hidden", p.dataset.pane !== t); }
for (const b of document.querySelectorAll(".pm-tab")) b.onclick = () => pmTab(b.dataset.tab);
pmTab(pmTabNow);
const PM_FACES = { butcher: "assets/portraits/butcher.webp", hivemind: "assets/portraits/hivemind.webp", pyre: "assets/portraits/pyre.webp", screamer: "assets/portraits/screamer.webp", abomination: "assets/portraits/abomination.webp", minebeast: "assets/portraits/minebeast.webp" };   // (whole strings: the preview build inlines them)
for (const img of document.querySelectorAll("img[data-face]")) img.src = PM_FACES[img.dataset.face];   // the bosses' real portraits
document.querySelector("#pmDev").addEventListener("click", e => { const b = e.target.closest("button[data-act]"); if (!b || b.disabled) return; const pct = Number(b.dataset.pct) || 0, w = Number(b.dataset.wave) || 20, at = pct ? ` at ${Math.round(pct * 100)}%` : "";
  if (b.dataset.act === "boss") pmDo("debugBoss", pct ? { wave: w, pct } : { wave: w }, `Skipped to ${BOSS_NAMES[w]}${at}`);
  else if (b.dataset.act === "beast") pmDo("debugMine", pct ? { k: "boss", pct } : { k: "boss" }, `Skipped to The Mine Beast${at}`); });
$("bossNow").onclick = () => pmDo("debugBoss", undefined, "Boss intro now");
$("bossEnrage").onclick = () => pmDo("debugBossHp", {}, "The boss is down to 25%");
$("bossKill").onclick = () => pmDo("debugBossHp", { kill: true }, "Boss killed");
$("hookSpd").onclick = () => pmDo("debugHookSpeed", undefined, "Butcher hook speed switched", false);
$("ultNow").onclick = () => pmDo("debugUlt", undefined, "Ultimate unlocked");
$("levelPlus").onclick = () => pmDo("debugLevel", undefined, "XP for one more level", false);   // (the level-up menu then opens as usual)
$("exploreToggle").onclick = () => pmDo("explore", { on: !state?.explore }, state?.explore ? "Explore mode off: the waves are back" : "Explore mode on: no waves", false);
$("betaToggle").onclick = () => pmDo("betaMode", undefined, state?.beta ? "Beta mode off: normal health" : "Beta mode on: everyone has 100× health", false);   // (Nov 12) host only
$("noCdToggle").onclick = () => pmDo("testNoCd", undefined, state?.noCd ? "Ultimates unlock at 100 kills again" : "Ultimates unlocked from the start", false);
$("skipMorph").onclick = () => pmDo("debugMorph", undefined, "Skipped to the Abomination's split");
$("skipMine").onclick = () => pmDo("debugMine", undefined, "Started the Deep Mine mission");
$("mineFuel").onclick = () => pmDo("debugMine", { k: "fuel" }, "Mine carts: full fuel");
$("mineRune").onclick = () => pmDo("debugMine", { k: "rune" }, "Next rune put in");
$("skipBeast").onclick = () => pmDo("debugMine", { k: "boss" }, "Skipped to The Mine Beast");
$("mineChase").onclick = () => pmDo("debugMine", { k: "chase" }, "Skipped to the chase");
$("mineEscape").onclick = () => pmDo("debugMine", { k: "escape" }, "Skipped to the escape");
function jumpToWave() { const n = Math.round(Number($("waveJumpN").value)); if (n >= 1 && n <= 50) pmDo("debugWave", { n }, `Skipped to wave ${n}`); }
$("waveJumpGo").onclick = jumpToWave;
$("pmSpawn").addEventListener("click", e => { const b = e.target.closest("[data-spawn]"); if (b) pmDo("debugSpawn", { kind: b.dataset.spawn }, `Spawned: ${b.textContent.trim().toLowerCase()}`); });
$("waveJumpN").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); jumpToWave(); } });
$("pmCopy").onclick = () => { const code = room?.roomId || ""; if (code) copyText(code, "Room code copied"); pmToast("Room code copied"); };
$("pmControls").onclick = () => { $("pmCtl").classList.remove("hidden"); $("pmDev").classList.add("hidden"); };
$("pmCtlBack").onclick = () => { $("pmCtl").classList.add("hidden"); pmRender(true); };
let leaveSure = 0;
for (const b of document.querySelectorAll("#menu button.cf")) b.insertAdjacentHTML("beforeend", '<i class="pm-gl" aria-hidden="true"></i>');   // the shine layer: gloss line, bevel, the light sweep on hover
let uiSndAt = 0, uiHover = null;
function uiSound(k) {   // the menu's own little sounds, made in code (through the sound effects volume): a soft tick on hover, a click on press, a brighter one on gold buttons
  const ac = audioContext; if (!sfxOn || !ac || !sfxBus || ac.state !== "running") return; const t = ac.currentTime;
  if (k === "hover") { if (t - uiSndAt < .045) return; uiSndAt = t; }
  const tone = (type, f0, f1, peak, len, at = 0) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.connect(g); g.connect(sfxBus);
    o.frequency.setValueAtTime(f0, t + at); o.frequency.exponentialRampToValueAtTime(f1, t + at + len); g.gain.setValueAtTime(.0001, t + at); g.gain.exponentialRampToValueAtTime(peak, t + at + .004); g.gain.exponentialRampToValueAtTime(.0001, t + at + len); o.start(t + at); o.stop(t + at + len + .02); };
  if (k === "hover") return tone("sine", 2400, 1800, .022, .04);
  tone("triangle", 320, 110, .13, .11); tone("sine", 1500, 1300, .045, .06);
  if (k === "gold") { tone("sine", 1320, 1320, .05, .12, .03); tone("sine", 1980, 1980, .04, .18, .08); }
}
$("menu").addEventListener("pointerover", e => { const b = e.target.closest?.("button.cf"); if (b === uiHover) return; uiHover = b; if (b && !b.disabled) uiSound("hover"); });
$("menu").addEventListener("pointerdown", e => { const b = e.target.closest?.("button.cf"); if (b && !b.disabled) uiSound(b.matches(".pm-resume,.pm-gold,.pm-tab,.pm-fill") ? "gold" : "click"); });
function pmFit() { const w = $("pmDev").classList.contains("hidden") && $("pmCtl").classList.contains("hidden") ? 370 : 1290, h = 810, z = Math.min(1, (innerWidth - 24) / w, (innerHeight - 24) / h); document.querySelector(".pm-wrap").style.setProperty("--pmz", Math.max(.55, z).toFixed(3)); }
addEventListener("resize", pmFit);
$("menu").addEventListener("click", e => { if (e.target === $("menu")) closePanels(); });   // a click on the dimmed backdrop closes it
function pmRender(force) {   // who sees what, which buttons work right now
  if (!state || !room) return; const host = SOLO_PREVIEW || state.hostId === myId, ph = state.phase, play = ph === "playing" || ph === "cleared", M = state.mission || "", ctl = !$("pmCtl").classList.contains("hidden");
  $("pmDev").classList.toggle("hidden", !host || ph === "lobby" || ctl); txt("pmCode", SOLO_PREVIEW ? "SOLO" : room.roomId || "····");
  for (const b of document.querySelectorAll("#pmDev [data-act], #skipMorph, #bossNow, #skipMine, #skipBeast, #mineChase, #mineEscape")) b.disabled = !play;
  const boss = [...state.zombies.values()].some(z => z.boss || z.kind === "hivemind"); $("bossEnrage").disabled = $("bossKill").disabled = !boss;
  $("skipMine").disabled = !play || !!M; $("mineFuel").disabled = $("mineRune").disabled = ph !== "playing" || !M.startsWith("runes"); $("skipBeast").disabled = !play || (!!M && !M.startsWith("runes"));
  $("mineChase").disabled = $("mineEscape").disabled = !play || /^(chase|escaped)/.test(M);
  for (const b of document.querySelectorAll(".pm-boss [data-act='beast']")) b.disabled = !play || (!!M && !/^(runes|fight)/.test(M));
  $("betaToggle").classList.toggle("off", !state.beta); $("betaToggle").disabled = !host; txt("betaSub", host ? "100× HEALTH" : "HOST ONLY");   // (Nov 12)
  $("exploreToggle").disabled = ph !== "playing"; $("exploreToggle").classList.toggle("off", !state.explore); $("noCdToggle").classList.toggle("off", !state.noCd);
  $("waveJumpGo").disabled = $("levelPlus").disabled = $("ultNow").disabled = ph === "lobby"; for (const b of document.querySelectorAll("#pmSpawn button")) b.disabled = ph !== "playing";
  txt("hookSpdT", (state.hookSpeed || 2100) >= 2100 ? "HOOK SPEED" : "HOOK: SLOW");
  if (Date.now() > leaveSure && $("leave").classList.contains("sure")) { $("leave").classList.remove("sure"); txt("leaveTxt", "LEAVE ROOM"); }
  if (force) pmFit();
}
$("nextStage").onclick = () => room?.send("nextStage");
// BETWEEN WAVES (Nov 9): the break lasts until everyone's READY (60s max). The shop window can be minimized to a bar so you can move and build.
let breakMin = false;
const toggleBreakReady = () => { const me = me_(); room?.send("breakReady", { on: !me?.ready }); };
$("breakReady").onclick = toggleBreakReady; $("bbReady").onclick = toggleBreakReady;
$("breakMin").onclick = () => { breakMin = true; }; $("bbShop").onclick = () => { breakMin = false; }; $("restartGame").onclick = () => room?.send("restart");
$("resume").onclick = () => closePanels();
$("leave").onclick = () => { if (Date.now() < leaveSure) { leaveSure = 0; $("leave").classList.remove("sure"); txt("leaveTxt", "LEAVE ROOM"); closePanels(); room?.leave(); return; } leaveSure = Date.now() + 3000; $("leave").classList.add("sure"); txt("leaveTxt", "SURE? CLICK AGAIN"); setTimeout(() => pmRender(), 3050); };   // two clicks: no leaving by accident
$("lvlBadge").onclick = () => togglePanel("levelUp");

// ===================== RENDER (runs on every server update, ~20x a second) =====================
const feed = []; let lastMessage = "";
function inMatch() { return !!(room && state && state.phase !== "lobby"); }
let lastPhaseSeen = "";
function renderState() {
  if (!state || !room) return;
  const players = [...state.players.values()], me = state.players.get(myId), host = state.hostId === myId;
  saveProfile(me);
  if (me?.characterClass && me.characterClass !== selectedClass) setSelectedClass(me.characterClass, false);
  if (state.phase === "lobby" || lastPhaseSeen !== state.phase) renderLobbyRoom();   // the lobby page is hidden mid-match: no point rebuilding it on every patch
  lastPhaseSeen = state.phase;
  if (!$("menu").classList.contains("hidden")) pmRender();
  // switch between lobby page and full-screen game
  const playingNow = state.phase !== "lobby";
  document.body.classList.toggle("in-match", playingNow);
  $("gameArea").classList.toggle("hidden", !playingNow);
  if (!playingNow) { closePanels(); mapCardKey = -1; return; }
  if (state.phase === "playing" && state.stage) showMapCard(state.stage);   // (Nov 12) the map's title at the start of the match / on arrival
  renderHud(me, players);
  renderScoreboard(players);
  renderLevelUp(me);
  if (!$("equip").classList.contains("hidden")) renderEquip(me);
  // event feed from server messages
  if (state.message && state.message !== lastMessage) { lastMessage = state.message; feed.unshift({ text: state.message, t: Date.now() }); feed.length = Math.min(feed.length, 5); }
  html("feed", feed.filter(f => Date.now() - f.t < 7000).map(f => `<li style="opacity:${Date.now() - f.t > 5500 ? .35 : 1}">${escapeHtml(f.text)}</li>`).join(""));
  // big screens: wave cleared + shop, downed, win/loss
  const brk = state.phase === "cleared", humans = [...state.players.values()].filter(p => !p.isBot), nReady = humans.filter(p => p.ready).length, secs = Math.ceil(state.countdown || 0);
  const go = brk && humans.length && nReady === humans.length, info = go ? `Here they come in ${secs}s!` : `Ready ${nReady}/${humans.length} · next wave in ${secs}s`;
  if (!brk) breakMin = false;
  $("breakBar").classList.toggle("hidden", !(brk && breakMin));
  document.body.classList.toggle("break-cursor", brk);   // the break: a normal mouse pointer (the crosshair is only drawn mid-wave)
  for (const id of ["breakReady", "bbReady"]) { txt(id, me?.ready ? "✓ READY" : "READY"); $(id).classList.toggle("is-ready", !!me?.ready); }
  if (brk && breakMin) { hideOverlay(); txt("bbTitle", `WAVE ${state.stage} CLEARED`); txt("bbInfo", info); }
  else if (brk) {
    showOverlay("WAVE " + state.stage + " CLEARED!", `Shop, then press READY. The next wave starts when everyone is ready (60s max). ${info}. Minimize this to move around and build first; press F next to the tower or generator to repair it.`);
    $("breakBtns").classList.remove("hidden"); txt("nextStage", "START NOW"); $("nextStage").classList.toggle("hidden", !host); renderShop(me);
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
    txt("specTitle", me.bledOut ? "YOU BLED OUT · back next wave" : inSafehouse(me) ? `YOU ARE DOWN · SAFE in the safehouse: bleed-out paused (${Math.ceil(me.bleedout || 0)}s) · a teammate can press F next to you` : `YOU ARE DOWN · bleed-out in ${Math.ceil(me.bleedout || 0)}s · a teammate can press F next to you`);
    txt("specWho", tgt && tgt !== me ? `Watching ${tgt.isBot ? "🤖 " : ""}${tgt.name}` : "Nobody left standing");
    $("specHint").classList.toggle("hidden", aliveMates().length < 2);
  }
}

const pct = (v, max) => Math.max(0, Math.min(100, (v / (max || 1)) * 100)) + "%";
function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
function renderHud(me, players) {
  // top left: wave, timer, zombies, day/night
  txt("hudWave", state.stage);
  const hiveUp = [...state.zombies.values()].some(z => z.kind === "hivemind");
  txt("hudTimer", state.explore ? "EXPLORE MODE" : state.waveType === "mission" ? "MISSION" : state.waveType !== "boss" ? ((state.elapsed || 0) >= 90 && hiveUp ? "KILL THE HIVEMIND" : fmtTime(90 - (state.elapsed || 0)))
    : state.bossPhase === "horde" ? (state.elapsed < 45 ? "BOSS WAVE · horde " + fmtTime(45 - (state.elapsed || 0)) : "BOSS WAVE · clear the horde")
    : state.bossPhase === "intro" ? "THE BOSS IS COMING" : "BOSS FIGHT");
  renderBossIntro();
  txt("hudZombies", state.zombies.size + (state.zombies.size === 1 ? " zombie" : " zombies"));
  txt("hudClock", state.isNight ? "NIGHT" : "DAY");
  // top centre: tower, generator, boss
  txt("towerText", Math.ceil(state.towerHp || 0).toLocaleString() + " / " + (state.towerMaxHp || 10000).toLocaleString());
  sty("towerBar", "width", pct(state.towerHp, state.towerMaxHp));
  sty("towerBar", "background", (state.towerHp || 0) < (state.towerMaxHp || 10000) * 0.25 ? "#e45b4d" : "#58ce8b");
  txt("genText", Math.ceil(state.generatorFuel || 0) + "% fuel · " + Math.ceil(state.generatorHp || 0) + " HP");
  sty("genBar", "width", pct(state.generatorHp, state.generatorMaxHp));
  const boss = [...state.zombies.values()].find(z => z.boss) || [...state.zombies.values()].find(z => z.kind === "hivemind");
  $("bossBox").classList.toggle("hidden", !boss);
  if (boss?.kind === "abomSpawn") {   // the Five: one bar for all of them
    const five = [...state.zombies.values()].filter(z => z.kind === "abomSpawn"), hp = five.reduce((a, z) => a + Math.max(0, z.hp), 0);
    txt("bossName", `THE FIVE · ${five.length} LEFT` + (five.length === 1 ? " · ENRAGED" : "")); txt("bossText", Math.ceil(hp).toLocaleString()); sty("bossBar", "width", pct(hp, boss.maxHp * 5));
  } else if (boss) {
    txt("bossName", (boss.kind === "minebeast" ? "THE MINE BEAST" + (deepState()?.step === "fight" ? " · CRYSTALS " + "◆".repeat(Math.max(0, deepState().crystals)) + "◇".repeat(Math.max(0, 4 - deepState().crystals)) + (deepState().sh ? " · SHIELDED" : "") : "") : boss.kind === "hivemind" ? (boss.boss ? "THE ALPHA HIVEMIND" : "THE HIVEMIND · MINI BOSS") : BOSS_INFO[boss.kind]?.name || String(boss.kind).replace(/[A-Z]/g, m => " " + m).toUpperCase()) + (boss.enraged ? " · ENRAGED" : ""));
    txt("bossText", Math.ceil(boss.hp).toLocaleString()); sty("bossBar", "width", pct(boss.hp, boss.maxHp));
  }
  { const pk = boss?.kind === "abomSpawn" ? "abomination" : boss?.kind, src = BOSS_INFO[pk]?.portrait || (pk === "minebeast" ? "assets/portraits/minebeast.webp" : pk === "hivemind" ? "assets/portraits/hivemind.webp" : ""), f = $("bossFace");   // the boss's face next to its bar (Nov 12)
    if (f && f.dataset.k !== (pk || "")) { f.dataset.k = pk || ""; f.hidden = !src; if (src) f.src = src; $("bossBox").classList.toggle("has-face", !!src); const em = document.querySelector("#bossBox .enrage-mark"); if (em) em.style.left = pk === "minebeast" ? "50%" : "30%"; } }
  // top right: team list under the minimap
  html("team", players.map(p => `<div class="team-row"><i style="background:${p.color}"></i><span>${p.isBot ? "🤖 " : ""}${escapeHtml(p.name)}${p.sessionId === myId ? " (you)" : ""}</span>${p.alive ? `<span>${Math.ceil(p.hp)}</span>` : `<em>${p.bledOut ? "OUT" : "DOWN " + Math.ceil(p.bleedout || 0) + "s"}</em>`}<div class="hbar"><span style="width:${pct(p.alive ? p.hp : 0, p.maxHp)}"></span></div></div>`).join(""));
  // bottom right: team resources
  html("resources", ["scrap", "electronics", "explosives", "fuel"].map(r => `<span title="${r}">${icon(r)}<b>${Math.floor(state[r] || 0)}</b></span>`).join(""));
  if (!me) return;
  // bottom left: you
  txt("hpText", Math.ceil(me.hp) + " / " + me.maxHp); sty("hpBar", "width", pct(me.hp, me.maxHp));
  { const bt = $("betaTag"); if (bt && bt.classList.contains("hidden") === !!state.beta) bt.classList.toggle("hidden", !state.beta); }   // BETA MODE: 100x health badge
  const maxLv = me.level >= MAX_LEVEL; txt("hudLevel", "LV " + me.level); txt("xpText", maxLv ? "MAX LEVEL" : me.xp + " / " + me.xpNext + " XP"); sty("xpBar", "width", maxLv ? "100%" : pct(me.xp, me.xpNext));
  html("hudGold", icon("gold") + (me.currency || 0) + "g"); txt("hudDef", "DEF " + (me.defence || 0)); txt("hudClass", String(me.characterClass).toUpperCase());
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
  const reloadPct = me.reloadLeft > 0 && w ? (1 - me.reloadLeft / (me.reloadTotal || w.reload)) * 100 : 0;
  const slots = [
    { n: 1, name: (MELEE_INFO[me.melee] || MELEE_INFO.knife).name, sub: rav && me.melee === "katana" ? (tier >= 5 ? "T5 MAX" : `T${tier} · ${kk % 50}/50`) : "melee", ic: icon(me.melee || "knife") },
    { n: 2, name: WEAPON_INFO[me.primary]?.name || "—", sub: gunSub(me.primary), ic: icon(me.primary) },
    { n: 3, name: WEAPON_INFO[me.secondary]?.name || "—", sub: gunSub(me.secondary), ic: icon(me.secondary) },
    { n: 5, key: "4", name: "Medkit", sub: "×" + (me.medkits || 0), empty: !me.medkits, ic: icon("medkit") },
    { n: 6, key: "E", card: eng ? "robotSquad" : rav ? "shadowPass" : dan ? "skyBarrage" : op ? "steelConvoy" : jug ? "ironBastion" : ast ? "medicTeam" : "", name: skill.name, sub: ast ? (me.skillT > 0 ? `MEDICS ${Math.ceil(me.skillT)}s` : me.abilityCooldown > 0 ? "cooldown" : "READY") : jug ? (me.skillT > 0 ? `DOME ${Math.ceil(me.skillT)}s` : me.abilityCooldown > 0 ? "cooldown" : "READY") : op ? (myV?.kind === "tank" ? (myV.phase === "call" ? "CALLING…" : `TANK ${Math.ceil(myV.left)}s`) : myV ? (myV.kind === "mecha" ? "in mecha" : "in helicopter") : me.abilityCooldown > 0 ? "cooldown" : "READY") : dan ? (me.abilityCooldown > 0 ? "cooldown" : "READY") : rav ? (me.shadow > 0 ? `HIDDEN ${Math.ceil(me.shadow)}s` : me.fire > 0 ? `FIRE ${Math.ceil(me.fire)}s` : me.abilityCooldown > 0 ? "cooldown" : "READY") : eng ? `${"●".repeat(ch)}${"○".repeat(Math.max(0, 3 - ch))}${ch < 3 ? " " + Math.ceil(me.chargeCd || 0) + "s" : ""}` : me.characterClass === "assault" && me.skillT > 0 ? `RUSH ${Math.ceil(me.skillT)}s` : "skill", cd: me.characterClass === "assault" && me.skillT > 0 ? 0 : cd, ic: skill.icon ? icon(skill.icon) : `<i class="ic portrait p-${me.characterClass}" aria-hidden="true"></i>` },
    ULT[me.characterClass] ? { n: 7, key: "Q", card: ULT[me.characterClass].noCard ? "" : ULT[me.characterClass].icon, name: ULT[me.characterClass].name, ic: icon(ULT[me.characterClass].icon),
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
    slots.splice(2, 0, { n: 9, key: "R", card: "safehouse", name: "Safehouse: 2 workers build 4 walls around you in 5s (faster with Quick Recovery; you can't be hurt while they build); zombies can't get in (6 hits break it, +1 per Body Armour pick; the workers repair) for 45s. Downed teammates inside don't bleed out", sub: sh ? (sh.deploy > 0 ? "BUILDING…" : `${Math.ceil(sh.hp)}/${sh.maxHp} · ${Math.ceil(sh.life)}s`) : rc > 0 ? "cooldown" : "READY", active: sh ? (sh.deploy > 0 ? 1 : sh.life / 45) : 0, frac: !sh && rc > 0 ? rc / 90 : 0, cd: !sh && rc > 0 ? Math.ceil(rc) : 0 });
  }
  if (op) {   // R: Crimson Aegis mecha, beside E
    const mv = myV?.kind === "mecha" ? myV : null, rc = me.chargeCd || 0;
    slots.splice(2, 0, { n: 9, key: "R", card: "crimsonAegis", name: "Crimson Aegis: pilot a mecha for 30s. Hold click = flame jet, right click = lightsaber, R = step out. 100s cooldown", sub: mv ? (mv.phase === "call" ? "TRANSFORMING…" : `MECHA ${Math.ceil(mv.left)}s · R out`) : rc > 0 ? "cooldown" : "READY", active: mv ? (mv.phase === "call" ? 1 : mv.left / 30) : 0, frac: !mv && rc > 0 ? rc / 100 : 0, cd: !mv && rc > 0 ? Math.ceil(rc) : 0 });
  }
  if (jug) slots.splice(2, 0, { n: 8, key: "TRAIT", card: "forcefulBlast", name: "Forceful Blast: shotgun hits knock zombies back (bosses too)", sub: "ON" });   // beside E
  const LOCK = `<svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="2.6"/><rect x="4.5" y="10" width="15" height="11" rx="2" fill="currentColor"/><rect x="11" y="13.5" width="2" height="4" rx="1" fill="#000"/></svg>`;
  const hb = slots.map(s => s.card ? `<div class="slot skillcard card-${s.card}${s.empty ? " empty" : ""}${s.ready ? " ult-ready" : ""}" title="${escapeHtml(s.name)}"><small>${s.key} · ${s.sub}</small>${s.locked ? `<div class="locked">${LOCK}</div>` : s.active ? `<div class="live" style="--p:${s.active.toFixed(2)}"></div>` : s.frac > 0 ? `<div class="clock" style="--p:${s.frac.toFixed(2)}"><span>${s.cd || ""}</span></div>` : ""}</div>` : `<div class="slot${s.n === me.activeSlot ? " active" : ""}${s.empty ? " empty" : ""}${s.ready ? " ult-ready" : ""}" title="${escapeHtml(s.name)}">${s.ic}<kbd>${s.key || s.n}</kbd><b>${escapeHtml(s.name)}</b><small>${s.sub}</small>${s.cd ? `<div class="cd">${s.cd}</div>` : ""}${s.n === me.activeSlot && reloadPct ? `<div class="reload" style="width:${reloadPct}%"></div>` : ""}</div>`).join("");
  if (hb !== hotbarHtml) { html("hotbar", hb); hotbarHtml = hb; }
  const dashLeft = Math.max(0, dashReadyAt - gnow()) / 1000;
  txt("dashChip", dashLeft > 0 ? `DASH ${dashLeft.toFixed(1)}s` : "DASH READY · Space"); $("dashChip").classList.toggle("ready", dashLeft <= 0);
  txt("ammoLine", me.stunned > 0 ? `STUNNED! ${me.stunned.toFixed(1)}s` : me.slowed > 0 ? `SLOWED ${me.slowed.toFixed(1)}s` : jug && me.weapon === "shotgun" && me.ultActive > 0 && gunActive ? "RAGE: SHOTGUN SPAM · NO AMMO · hold click" : me.reloadLeft > 0 ? "RELOADING…" : gunActive && w ? `${me.mag} / ${w.infinite ? "∞" : me.ammo}${me.mag === 0 ? (ast ? "  ·  press C" : "  ·  press R") : ""}` : me.activeSlot === 5 ? "Click to use a medkit" : me.activeSlot === 1 && me.melee === "axe" ? "Hold click 1s, release: HEAVY SWING" : "");
}

function renderScoreboard(players) {
  $("scoreboard").classList.toggle("hidden", !scoreboardOpen || state.phase === "cleared");
  if ($("scoreboard").classList.contains("hidden")) return;   // nothing to see: don't rebuild the table 20 times a second
  const ranked = players.slice().sort((a, b) => b.kills - a.kills || (a.killLeadSince || Number.MAX_SAFE_INTEGER) - (b.killLeadSince || Number.MAX_SAFE_INTEGER) || String(a.name).localeCompare(String(b.name)));
  const ST = p => { const a = String(p.stats || "").split("|").map(Number); return { kills: p.kills || 0, bossDamage: a[0] || 0, revives: a[1] || 0, towerRepairs: a[2] || 0, structuresBuilt: a[3] || 0, damageDealt: a[4] || 0, damageTaken: a[5] || 0 }; };   // packed by the server (PlayerState field limit)
  const rows = ranked.map((p, i) => `<tr class="${i === 0 && p.kills > 0 ? "leader" : ""}"><td>${i === 0 && p.kills > 0 ? "👑 " : ""}${i + 1}. ${escapeHtml(p.name)}${p.sessionId === myId ? " (YOU)" : ""}</td><td>${p.kills}</td><td>${ST(p).bossDamage}</td><td>${ST(p).revives}</td><td>${ST(p).towerRepairs}</td><td>${ST(p).structuresBuilt}</td><td>${ST(p).damageDealt}</td><td>${ST(p).damageTaken}</td></tr>`).join("");
  const done = ["cleared", "victory", "defeat"].includes(state.phase);
  const awardKeys = [["Zombie Slayer", "kills"], ["Boss Hunter", "bossDamage"], ["Lifesaver", "revives"], ["Guardian", "towerRepairs"], ["Master Engineer", "structuresBuilt"]];
  const awards = awardKeys.map(([label, key]) => { const w = players.slice().sort((a, b) => ST(b)[key] - ST(a)[key])[0]; return w && ST(w)[key] > 0 ? `${label}: ${escapeHtml(w.name)}` : ""; }).filter(Boolean);
  html("scoreboard", `<h3>${done ? "MATCH RESULTS" : "LIVE KILL LEADERBOARD"}</h3><table><thead><tr><th>Survivor</th><th>Kills</th><th>Boss dmg</th><th>Revives</th><th>Tower repair</th><th>Builds</th><th>Damage dealt</th><th>Damage taken</th></tr></thead><tbody>${rows}</tbody></table>${done && awards.length ? `<div class="scorehint">${awards.join(" · ")}</div>` : ""}<div class="scorehint">Team kills: ${state.totalKills || 0} · Press TAB to toggle</div>`);
  $("scoreboard").classList.toggle("hidden", !scoreboardOpen || state.phase === "cleared");
}

// ===================== SHOP (break between waves) =====================
// [id, name, what it does, price] — prices must match SHOP on the server
const SHOP_ITEMS = [
  ["Weapons", [["smg", "SMG", "Fast full-auto spray", 35], ["shotgun", "Shotgun", "5 pellets that pierce 2, brutal up close", 40], ["sniper", "Sniper rifle", "Huge damage, pierces 3, +50% vs bosses & brutes", 70], ["launcher", "Launcher", "Explosive splash", 120]]],
  ["Gear", [["medkit", "Medkit", "Heals 60% · slot 5", 10], ["ammo", "Ammo +90", "Spare bullets", 5],]],
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
    <div class="shop-timer"><b id="shopSecs">${secs}</b><small>seconds at most<br>until wave ${state.stage + 1}</small></div></div>` +
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
  if (id === "levelUp") { const me = state?.players.get(myId); if (!me || me.xp < me.xpNext || me.level >= MAX_LEVEL) return; levelUpBuiltFor = ""; }
  $(id).classList.remove("hidden"); firing = false;
  if (id === "equip") { equipKey = ""; renderEquip(state?.players.get(myId)); }
  if (id === "levelUp") renderLevelUp(state?.players.get(myId));
  if (id === "menu") { $("pmCtl").classList.add("hidden"); pmTab(pmTabNow); pmRender(true); }
}
function anyPanelOpen() { return PANELS.some(id => !$(id).classList.contains("hidden")); }

let levelUpBuiltFor = "", levelUpWaitUntil = 0;
const MAX_LEVEL = 30, xpForLevel = L => 30 + 72 * (L - 1);   // matches the server (shared team XP, cap 30)
function pendingLevelUps(me) { let n = 0, xp = me.xp, L = me.level || 1; while (L < MAX_LEVEL && xp >= xpForLevel(L) && n < 9) { xp -= xpForLevel(L); L++; n++; } return n; }
function renderLevelUp(me) {
  const ready = !!(me && state.phase === "playing" && me.xp >= me.xpNext && me.level < MAX_LEVEL);
  const n = ready ? pendingLevelUps(me) : 0;
  $("lvlBadge").classList.toggle("hidden", !ready);
  txt("lvlBadge", `▲ LEVEL UP${n > 1 ? " ×" + n : ""} · press U`);
  if (!ready) { $("levelUp").classList.add("hidden"); levelUpBuiltFor = ""; return; }
  if ($("levelUp").classList.contains("hidden")) return;
  txt("levelUpCount", n > 1 ? n + " upgrades ready" : "1 upgrade ready");
  $("levelUpHint").textContent = me.alive ? `Press 1–${upgradeChoices(me).length} or click. U or Esc to close. The fight keeps going.` : "You're down. Pick once a teammate revives you.";
  const key = me.level + "|" + me.alive;
  if (key !== levelUpBuiltFor) {
    levelUpBuiltFor = key; levelUpWaitUntil = 0;
    html("levelUpChoices", upgradeChoices(me).map(([id, title, desc], i) => `<button class="button" data-upgrade="${id}"><kbd>${i + 1}</kbd><span><b>${title}</b><small>${desc}</small></span></button>`).join(""));
  }
  const locked = !me.alive || Date.now() < levelUpWaitUntil;
  $("levelUpChoices").querySelectorAll("button").forEach(b => b.disabled = locked);
}
function pickUpgrade(id) {
  const me = state?.players.get(myId);
  if (!room || !me || !me.alive || me.xp < me.xpNext || me.level >= MAX_LEVEL || Date.now() < levelUpWaitUntil) return;
  levelUpWaitUntil = Date.now() + 700; room.send("upgrade", { id });
}
$("levelUpChoices").addEventListener("click", e => { const b = e.target.closest("button[data-upgrade]"); if (b) pickUpgrade(b.dataset.upgrade); });

let equipKey = "";
function renderEquip(me) {
  if (!me) return;
  const key = [me.owned, me.primary, me.secondary, me.melee, me.medkits, me.armor, me.activeSlot, me.characterClass, me.maxHp].join("|");
  if (key === equipKey) return; equipKey = key;
  const skill = SKILLS[me.characterClass] || SKILLS.assault;
  const row = (k, label, name, sub, ic = "") => `<div class="eq-row"><kbd>${k}</kbd>${ic || "<span></span>"}<div><small>${label}</small><b>${escapeHtml(name)}</b>${sub ? `<small>${sub}</small>` : ""}</div></div>`;
  $("equipped").innerHTML =
    row(1, "MELEE", MELEE_INFO[me.melee]?.name || "Knife", "", icon(me.melee || "knife")) +
    row(2, "PRIMARY", WEAPON_INFO[me.primary]?.name || "—", "", icon(me.primary)) +
    row(3, "SECONDARY", WEAPON_INFO[me.secondary]?.name || "—", "", icon(me.secondary)) +
    row(4, "SKILL", skill.name, skill.cd + "s cooldown", `<i class="ic portrait p-${me.characterClass}" aria-hidden="true"></i>`) +
    row(5, "QUICK ITEM", "Medkit ×" + (me.medkits || 0), "heals 60%", icon("medkit")) +
    row("🛡", "ARMOUR", "−" + Math.round((me.armorPct || 0) * 100) + "% damage taken", (ARMOR_STEP[me.characterClass] ? ARMOR_STEP[me.characterClass] * 100 : 6) + "% per pick · max " + Math.round((ARMOR_STEP[me.characterClass] || .06) * 800) + "%" + (me.defence ? " · +" + me.defence + " defence" : ""), icon("armor"));
  const plateImg = `<img class="ic plate-ic" src="${plateIconUrl()}" alt="" aria-hidden="true">`;
  if (me.armor === 2) $("equipped").insertAdjacentHTML("beforeend", `<div class="eq-row plate-row" data-gear="pyreplate" title="Double-click to take it off"><kbd>🔥</kbd>${plateImg}<div><small>WORN · PYRE PLATE</small><b>−25% damage · +30 max HP</b><small>fireproof: you can't catch fire</small></div></div>`);
  // backpack: everything you own but don't have equipped right now
  const owned = (me.owned || "").split(",").filter(Boolean);
  const items = [
    ...(me.armor === 1 ? [{ kind: "gear", id: "pyreplate", name: "Pyre Plate", sub: "armour · legendary" }] : []),
    ...owned.filter(id => id !== me.primary && id !== me.secondary && WEAPON_INFO[id]).map(id => ({ kind: "weapon", id, name: WEAPON_INFO[id].name, sub: WEAPON_INFO[id].slot === 2 ? "primary" : "secondary" })),
    ...Object.keys(MELEE_INFO).filter(id => id !== me.melee).map(id => ({ kind: "melee", id, name: MELEE_INFO[id].name, sub: "melee" })),
  ];
  const cells = [];
  for (let i = 0; i < 20; i++) {
    const it = items[i];
    cells.push(it ? `<button class="bag-slot${it.kind === "gear" ? " legendary" : ""}" data-kind="${it.kind}" data-id="${it.id}" title="${escapeHtml(it.name)}: double-click to equip">${it.kind === "gear" ? plateImg : icon(it.id)}${escapeHtml(it.name)}<small>${it.sub}</small></button>` : `<div class="bag-slot" aria-hidden="true"></div>`);
  }
  html("bag", cells.join("")); txt("bagCount", items.length + " / 20");
}
// Backpack: click = select (shows what it is), double-click = equip it and put it in your hand.
const bagName = b => b.textContent.replace(/(primary|secondary|melee|armour · legendary)$/, "");
$("bag").addEventListener("click", e => {
  const b = e.target.closest("button.bag-slot"); if (!b) return;
  $("bag").querySelectorAll(".bag-slot.sel").forEach(x => x.classList.remove("sel")); b.classList.add("sel");
  $("bagInfo").textContent = bagName(b) + " · double-click to equip.";
});
$("equipped").addEventListener("dblclick", e => { const r = e.target.closest("[data-gear]"); if (r && room) { room.send("gear", { id: r.dataset.gear, on: false }); $("bagInfo").textContent = "Took off the Pyre Plate (it's in your backpack)."; } });
$("bag").addEventListener("dblclick", e => {
  const b = e.target.closest("button.bag-slot"); if (!b || !room) return;
  if (b.dataset.kind === "gear") room.send("gear", { id: b.dataset.id, on: true }); else if (b.dataset.kind === "weapon") room.send("weapon", { id: b.dataset.id }); else room.send("meleeEquip", { id: b.dataset.id });
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
// Music loops (the published preview fetches them as files next to the page). Crossfade 1s between scenes.
const MUSIC = { menu: "assets/audio/music_main_menu.mp3", day: "assets/audio/music_day_exploration.mp3", night: "assets/audio/music_night_wave.mp3", boss: "assets/audio/music_boss_battle.mp3",
  pyre: "assets/audio/music_boss_pyre.mp3",   // (Nov 12) the Pyre Priest's own theme: a 3:00.8 loop cut from the user's first track (58 bars at 77 BPM, one-bar crossfade back to the start); the user tried a second track, then chose this one again
  abom: "assets/audio/music_boss_abom.mp3",   // (Nov 12) the Abomination's own theme: a 2:54 loop (29 six-second phrases at 120 BPM, 6/8) cut from the user's track, starting 6s before its big hit
  butcher: "assets/audio/music_boss_butcher.mp3",   // (Nov 12) the Butcher's own theme: the user's 2:11 song (its 1-bar silence cut) with its build + big peak played twice: an 87-bar 3:10 loop at 110 BPM, starting a bar before the peak
  hive: "assets/audio/music_boss_hive.mp3",   // (Nov 12) the Hivemind's own theme (mini-boss waves + the Alpha): the user's 7:22 song, one pass of its repeating 66-bar section (95 BPM, 2:47), one-bar crossfade; starts a bar before the big build
  mine: "assets/audio/music_boss_mine.mp3",   // (Nov 12) the Mine Beast's own theme: the user's 3:30 song with its 30s breakdown cut out (a 3:00 loop, 2-beat crossfade at 1:58), starting a bar before its big entry
  scream: "assets/audio/music_boss_scream.mp3" };   // (Nov 12) the Screamer's own theme: the user's 62.48s song, cut at its exact repeat length (it plays as a perfect loop), starting on the 3-beat build into its big entry
const MUSIC_LOOP = { pyre: { pad: .5, len: 180.834 }, abom: { pad: .5, len: 174.0001 }, scream: { pad: .5, len: 62.48 }, mine: { pad: .5, len: 7935820 / 44100 }, butcher: { pad: .5, len: 8370975 / 44100 }, hive: { pad: .5, len: 7353141 / 44100 } };   // tracks with exact loop points: the file carries 0.5s of the loop's end before it and of its start after it, so the loop is seamless whatever the MP3 decoder does at the edges
const MUSIC_VOL = .28, MUSIC_FADE = 1;
function sfxContext() {
  if (!audioContext) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; audioContext = new AC();
    deafF = audioContext.createBiquadFilter(); deafF.type = "lowpass"; deafF.frequency.value = 22000; deafF.connect(audioContext.destination);   // the Screamer's wail muffles everything (deafen)
    sfxBus = audioContext.createGain(); sfxBus.gain.value = sfxOn ? 1 : 0; sfxBus.connect(deafF);
    musicBus = audioContext.createGain(); musicBus.gain.value = musicOn ? 1 : 0; musicBus.connect(deafF);
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
const musicTracks = Object.fromEntries(Object.entries(MUSIC).map(([k, url]) => [k, { url, ...(MUSIC_LOOP[k] || {}) }]));
for (const t of Object.values(musicTracks)) loadRaw(t);
// play one sound. x, y = where it happens (optional: omitted = not positional). mult scales the volume.
function playSfx(name, x, y, mult = 1) {
  if (!sfxOn) return; const s = SFX[name], ac = audioContext; if (!s || !ac || ac.state !== "running") return;
  const buf = decoded(s, ac); if (!buf) return;
  const now = gnow(); if (now - (s.lastAt || 0) < (s.gap || 0) || (s.playing || 0) >= (s.max || 4)) return;
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
  const pyre = [...state.zombies.values()].some(z => z.kind === "pyre" && z.boss) || (state.waveType === "boss" && state.bossIntro === "pyre");
  if (pyre) return "pyre";   // the Pyre Priest's own theme (card + fight)
  if ([...state.zombies.values()].some(z => (z.kind === "abomination" || z.kind === "abomSpawn") && z.boss) || (state.waveType === "boss" && state.bossIntro === "abomination")) return "abom";   // the Abomination (and the Five)
  if ([...state.zombies.values()].some(z => z.kind === "screamer" && z.boss) || (state.waveType === "boss" && state.bossIntro === "screamer")) return "scream";   // the Screamer's own theme (card + fight)
  if ([...state.zombies.values()].some(z => z.kind === "butcher" && z.boss) || (state.waveType === "boss" && state.bossIntro === "butcher")) return "butcher";   // the Butcher's own theme (card + fight)
  { const D = state.mission && deepState(); if (D && (D.step === "awake" || D.step === "fight" || D.step === "flee" || D.step === "chase")) return "mine"; }   // the Mine Beast: from the moment it wakes until you're through the portal
  if ([...state.zombies.values()].some(z => z.kind === "hivemind") || (state.waveType === "boss" && state.bossIntro === "hivemind")) return "hive";   // (Nov 12) the Hivemind's own theme: the mini boss and the Alpha
  if (state.waveType === "boss" && (state.bossPhase === "intro" || state.bossPhase === "fight")) return "boss";
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
  const src = ac.createBufferSource(), gain = ac.createGain(); src.buffer = buf; src.loop = true;
  if (t.pad && t.pad + t.len <= buf.duration) { src.loopStart = t.pad; src.loopEnd = t.pad + t.len; } else { src.loopStart = .03; src.loopEnd = buf.duration - .03; }   // exact loop points, else skip the mp3's silent padding
  gain.gain.value = 0; gain.gain.setTargetAtTime(MUSIC_VOL, ac.currentTime, MUSIC_FADE / 3); src.connect(gain); gain.connect(musicBus); src.start(0, src.loopStart);
  music.cur = { name: want, src, gain };
}
function setMusicOn(on) { musicOn = on; if (musicBus) musicBus.gain.setTargetAtTime(on ? 1 : 0, audioContext.currentTime, .2); $("musicToggle").classList.toggle("off", !on); $("setAmbient").checked = on; savePrefs(); }
function setSfxOn(on) { sfxOn = on; if (sfxBus) sfxBus.gain.setTargetAtTime(on ? 1 : 0, audioContext.currentTime, .05); $("sfxToggle").classList.toggle("off", !on); $("setSfx").checked = on; savePrefs(); }
$("musicToggle").onclick = () => setMusicOn(!musicOn);
$("sfxToggle").onclick = () => setSfxOn(!sfxOn);
// Game-state changes -> sounds (wave start / cleared / defeat, night, tower repairs and alarm, revives, pickups, building, brutes)
const aw = { phase: null, stage: 0, night: false, tower: 0, gen: 0, fuel: 0, alive: new Map(), loot: new Map(), structs: new Map(), brutes: new Set(), alarmAt: 0, groanAt: 0 };
function audioWatch() {
  const s = state; if (!s) return; const now = gnow(), me = V(me_()), same = aw.phase === s.phase && aw.stage === s.stage;
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
  const ac = audioContext, fires = state?.phase === "playing" && (paintedMap()?.fires || (dynastyMap() ? dynFires : null)), me = fires && V(me_() || {});
  let k = 0; if (fires && me) for (const [x, y, sc] of fires) k = Math.max(k, Math.max(0, 1 - Math.hypot(x - me.x, y - me.y) / 420) * Math.min(1, sc + .2));
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
let scoreboardOpen = false, firing = false, wheel = null, placing = null, lastWheelScroll = 0;   // placing: { id } a picked deployable following the mouse
const me_ = () => state?.players.get(myId);
function selectSlot(n, cycle = true) { if (room && inMatch()) room.send("slot", { n, cycle }); }

// mouse: left = use, right (hold) = build wheel, wheel = cycle slots. After picking a deployable: left = place it, right = cancel
canvas.addEventListener("mousedown", e => {
  if (!inMatch()) return;
  if (e.button === 0 && me_() && !me_().alive) { switchSpectate(1); return; }
  if (placing && (e.button === 0 || e.button === 2)) { e.preventDefault(); firing = false; if (e.button === 0) placeIt(); else placing = null; return; }
  if (e.button === 0) {
    e.preventDefault(); if (wheel) return;
    if (squadWheel) return;
    const me = me_();
    if (state.vehicles?.get(myId)) { firing = true; clickShotAt = gnow(); return; }   // in a vehicle the mouse is the gun's trigger, whatever slot is selected
    if (me?.activeSlot === 5) room.send("attack", {});
    else if (me?.activeSlot === 1 && me.melee === "axe") { if (!axeChargeAt) { axeChargeAt = gnow(); room.send("charge", { on: true }); } }
    else { firing = true; clickShotAt = gnow(); }
  }
  if (e.button === 2 && state.vehicles?.get(myId)) { e.preventDefault(); const v = state.vehicles.get(myId), me = me_();   // in a vehicle: no build wheel; the mecha swings its saber
    if (v.kind === "mecha" && v.phase === "ride" && me && !anyPanelOpen()) room.send("mechaSlash", { a: aimAngle(me) }); return; }
  if (e.button === 2) { e.preventDefault(); firing = false; placing = null; wheel = { x: mouse.x, y: mouse.y, cx: Math.max(WHEEL_R + 30, Math.min(W - WHEEL_R - 30, mouse.sx)), cy: Math.max(WHEEL_R + 30, Math.min(H - WHEEL_R - 30, mouse.sy)), pick: -1 }; }
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
  const now = gnow(); if (now - lastWheelScroll < 110) return; lastWheelScroll = now;
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
  if (k === "escape" && placing) { e.preventDefault(); placing = null; return; }   // stop placing a deployable
  if (k === "escape") { e.preventDefault(); if (anyPanelOpen()) closePanels(); else { togglePanel("menu"); playSfx("pause"); } return; }
  if (k === "tab") { e.preventDefault(); scoreboardOpen = !scoreboardOpen; return; }
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
  if (me_() && !me_().alive && [" ", "arrowleft", "arrowright"].includes(k) && !e.repeat) { switchSpectate(k === "arrowleft" ? -1 : 1); return; }
  if (!$("levelUp").classList.contains("hidden") && /^[1-7]$/.test(k)) { const c = upgradeChoices(me_())[Number(k) - 1]; if (c) pickUpgrade(c[0]); return; }
  if (e.repeat && !"wasd ".includes(k) && !k.startsWith("arrow")) return;
  keys[k === " " ? "space" : k] = true;
  if (k === " ") dashQueued = true;   // a quick tap still counts
  if (["1", "2", "3", "4"].includes(k)) selectSlot(k === "4" ? 5 : Number(k));   // 4 = medkit (slot 5 on the server)
  else if (k === "e") { const me = me_(); if (me?.characterClass === "engineer") openSquadWheel();
    else if (me?.characterClass === "scout" && (me.shadow > 0 || me.fire > 0)) { feed.unshift({ text: me.shadow > 0 ? "You're hidden: attack to strike with a burning katana" : `Katana burning: ${Math.ceil(me.fire)}s left`, t: Date.now() }); feed.length = Math.min(feed.length, 5); }
    else if (me?.characterClass === "scout" && me.abilityCooldown > 0) { feed.unshift({ text: `Shadow Pass ready in ${Math.ceil(me.abilityCooldown)}s`, t: Date.now() }); feed.length = Math.min(feed.length, 5); }
    else room.send("ability", { a: aimAngle(me), d: aimDist(me) }); }
  else if (k === "q") { const me = me_(); if (me?.characterClass === "demolitionist" && me.ultActive > 0) room.send("ult", { a: aimAngle(me) }); else if (ULT[me?.characterClass]) { if ((me.ultKills || 0) < 100) { feed.unshift({ text: `${ULT[me.characterClass].name} unlocks at 100 kills (${me.ultKills || 0}/100)`, t: Date.now() }); feed.length = Math.min(feed.length, 5); } else if (!me.ultReady) { feed.unshift({ text: me.ultActive > 0 ? `${ULT[me.characterClass].name} is active (${Math.ceil(me.ultActive)}s left)` : `${ULT[me.characterClass].name} ready in ${Math.ceil(me.ultCd || 0)}s`, t: Date.now() }); feed.length = Math.min(feed.length, 5); } else room.send("ult", { a: aimAngle(me), d: aimDist(me) }); } }
  else if (k === "r") { if (["dispatcher", "operator"].includes(me_()?.characterClass) && !e.repeat) room.send("skill2"); }   // R = 3rd skill (Astra: Safehouse, Sofea: Crimson Aegis mecha; others get theirs later). Reloading is automatic
  else if (k === "c") room.send("reload");   // C: reload early (top up a half-empty magazine)
  else if (k === "b" && !e.repeat && state?.phase === "cleared") breakMin = !breakMin;   // shop window <-> minimized bar
  else if (k === "f" && !e.repeat) { if (!tryRevive() && !deepUse() && !coasterUse()) stationUse(); }   // F: revive a downed teammate first, else repair / refuel what you're next to
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
  if (target) { room.send("revive", { targetId: target.sessionId }); reviving = { id: target.sessionId, t0: gnow() }; }
  return !!target;
}
// TOWER / GENERATOR (Nov 9): stand next to one and press (or hold) F. Tower: 10 scrap = +250 HP. Generator: repairs (15 scrap, +300 HP)
// and/or refuels (10 fuel, +25%), whichever it needs. Same ranges as the server (STATION_R).
const STATION = { tower: 125, gen: 90, every: 300 };   // the server checks the same distances
function nearStation(me) {
  if (!me?.alive || !state || state.vehicles?.get(myId)) return null;
  const dt = Math.hypot(me.x - towerX(), me.y - towerY()), dg = Math.hypot(me.x - towerX() - GEN_OFF.x, me.y - towerY() - GEN_OFF.y);
  return dg <= STATION.gen && dg < dt ? "gen" : dt <= STATION.tower ? "tower" : null;
}
const STEP = { tower: { amt: 250, cost: 10 }, gen: { amt: 300, cost: 15 }, fuel: { amt: 25, cost: 10 } };   // matches the server's STATION_STEP
function stationCost(need, kind, step) {   // what one press costs: only the missing part (you never pay for nothing); null = full
  if (need < 1) return null; const have = state[kind] || 0, gain = Math.min(step.amt, need, have * step.amt / step.cost);
  return { pay: Math.max(1, Math.ceil(step.cost * Math.min(step.amt, need) / step.amt - 1e-9)), afford: gain > 0 && Math.ceil(step.cost * gain / step.amt - 1e-9) <= have };
}
function stationPlan(st) {   // what F does right now: [{ msg, label, cost, ok, why }]
  const half = me_()?.characterClass === "operator";   // Sofea's trait (Mechanic): half price
  const row = (msg, label, need, kind, step, fullWhy) => { const c = stationCost(need, kind, half ? { ...step, cost: step.cost / 2 } : step);
    return { msg, label, cost: c ? `${c.pay} ${kind}` : "", ok: !!c && c.afford, why: !c ? fullWhy : `need ${kind}` }; };
  if (st === "tower") return [row("repairTower", "Repair tower", state.towerMaxHp - state.towerHp, "scrap", STEP.tower, "full health")];
  return [row("repairGenerator", "Repair generator", state.generatorMaxHp - state.generatorHp, "scrap", STEP.gen, "full health"),
          row("refuelGenerator", "Refuel", 100 - state.generatorFuel, "fuel", STEP.fuel, "tank full")];
}
let lastStationUse = 0;
function stationUse() {
  const st = nearStation(me_()); if (!st || !room) return false; lastStationUse = gnow();
  for (const a of stationPlan(st)) if (a.ok) room.send(a.msg, a.data);
  return true;
}
function drawStationPrompt() {   // "[F] Repair tower · 10 scrap" over your head when you're next to it (hold F to keep going)
  const meS = me_(), st = nearStation(meS); if (!st || wheel || placing) return;
  if (keys.f && !reviving && gnow() - lastStationUse > STATION.every) stationUse();
  const me = V(meS), plan = stationPlan(st), x = me.x - Math.round(cam.x), y0 = me.y - Math.round(cam.y) - 78;
  ctx.save(); ctx.font = "bold 12px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.lineWidth = 3; ctx.strokeStyle = "#000c";
  plan.forEach((a, i) => { const t = a.ok ? `[F] ${a.label} · ${a.cost}` : `${a.label}: ${a.why}`, y = y0 - (plan.length - 1 - i) * 16;
    ctx.fillStyle = a.ok ? "#ffd27a" : "#9aa3a0"; ctx.strokeText(t, x, y); ctx.fillText(t, x, y); });
  ctx.restore();
}
function drawReviveRing() {   // progress ring around the teammate you're reviving
  if (!reviving || !state) return; const me = V(me_()), t = V(state.players.get(reviving.id));
  if (!me || !t || !me_()?.alive || state.players.get(reviving.id)?.alive || Math.hypot(t.x - me.x, t.y - me.y) > 85) { reviving = null; return; }   // done, or walked off (the server cancels too)
  const L = me_()?.characterClass === "dispatcher" ? 2.5 : 5, k = Math.min(1, (gnow() - reviving.t0) / (L * 1000));   // Astra's trait: Field Commander
  ctx.save(); ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.beginPath(); ctx.arc(t.x, t.y - 4, 26, 0, 7); ctx.stroke();
  ctx.strokeStyle = "#7dff9a"; ctx.shadowColor = "#7dff9a"; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(t.x, t.y - 4, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
  ctx.shadowBlur = 0; ctx.fillStyle = "#eaffef"; ctx.font = "bold 11px monospace"; ctx.textAlign = "center"; ctx.fillText(`REVIVING ${Math.ceil(L - k * L)}s`, t.x, t.y - 38); ctx.restore();
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
function buildSpot(me) {   // the mouse, kept within BUILD_RANGE of you (the server clamps the same way)
  const dx = mouse.x - me.x, dy = mouse.y - me.y, d = Math.hypot(dx, dy);
  return d <= BUILD_RANGE ? { x: mouse.x, y: mouse.y } : { x: me.x + dx / d * BUILD_RANGE, y: me.y + dy / d * BUILD_RANGE };
}
const spotFace = (me, spot) => Math.hypot(spot.x - me.x, spot.y - me.y) > 20 ? Math.atan2(spot.y - me.y, spot.x - me.x) : me.aim || 0;   // lines go across this
function resolveWheel() {   // let go of right-click: actions happen now; a deployable follows the mouse until you left-click (placeIt)
  const me = me_(); const opt = BUILD_WHEEL[wheel.pick];
  if (!me || !opt || !room) return;
  if (!canAfford(opt.cost)) { feed.unshift({ text: `Not enough resources for ${opt.name}`, t: Date.now() }); feed.length = Math.min(feed.length, 5); return; }
  placing = { id: opt.id };
}
function placeProblem(me, spot, opt) {   // why it can't go here (the same checks as the server), or ""
  if (!canAfford(opt.cost)) return "not enough resources";
  const grid = predGrid(), gx = Math.floor(spot.x / 160), gy = Math.floor(spot.y / 160);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const b of grid.get((gx + i) + "," + (gy + j)) || []) if (Math.abs(spot.x - b.x) < b.hw + 12 && Math.abs(spot.y - b.y) < b.hh + 12) return "blocked";
  return "";
}
function placeIt() {
  const me = V(me_()), opt = BUILD_WHEEL.find(o => o.id === placing?.id); if (!me || !opt || !room) { placing = null; return; }
  const spot = buildSpot(me), why = placeProblem(me, spot, opt);
  if (why) { feed.unshift({ text: `Can't place the ${opt.name.toLowerCase()} here: ${why}`, t: Date.now() }); feed.length = Math.min(feed.length, 5); return; }
  room.send("build", { kind: opt.id, x: Math.round(spot.x), y: Math.round(spot.y), face: +spotFace(me, spot).toFixed(3) }); placing = null;
}
const PLACE_RANGE = { turret: 260, mine: 100, flameTrap: 65 };   // what it reaches (the server's numbers; mine: its blast)
function drawPlacement(me) {   // a picked deployable follows the mouse: see-through, turned the way it'll be built, green = OK / red = can't
  const opt = BUILD_WHEEL.find(o => o.id === placing.id), spot = buildSpot(me), face = spotFace(me, spot), bad = placeProblem(me, spot, opt), col = bad ? "255,90,80" : "120,255,150", t = gnow();
  ctx.save(); ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
  ctx.strokeStyle = "rgba(242,139,54,.4)"; ctx.setLineDash([6, 6]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(me.x, me.y, BUILD_RANGE, 0, 7); ctx.stroke();
  if (PLACE_RANGE[opt.id]) { ctx.strokeStyle = `rgba(${col},.45)`; ctx.beginPath(); ctx.arc(spot.x, spot.y, PLACE_RANGE[opt.id], 0, 7); ctx.stroke(); }
  ctx.setLineDash([]); ctx.fillStyle = `rgba(${col},${.16 + .06 * Math.sin(t / 150)})`; ctx.strokeStyle = `rgba(${col},.85)`; ctx.lineWidth = 2;
  if (opt.id === "barricade" || opt.id === "fence") {   // its footprint: a strip along the line (server lineOf)
    const k = ((Math.round(face / (Math.PI / 4)) % 8) + 8) % 8, L = [38, 40, 46, 40][k % 4]; ctx.save(); ctx.translate(spot.x, spot.y); ctx.rotate(k * Math.PI / 4 + Math.PI / 2);
    ctx.beginPath(); ctx.roundRect(-L, -16, L * 2, 32, 8); ctx.fill(); ctx.stroke(); ctx.restore();
  } else { ctx.beginPath(); ctx.ellipse(spot.x, spot.y + 6, 22, 12, 0, 0, 7); ctx.fill(); ctx.stroke(); }
  const [img, feet] = structSprite(opt.id, face);
  drawObj(img, spot.x, spot.y + feet, { alpha: .72, filter: bad ? "sepia(1) saturate(4) hue-rotate(-40deg) brightness(.8)" : undefined });
  ctx.font = "bold 12px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.lineWidth = 3; ctx.strokeStyle = "#000c";
  const line1 = bad ? `Can't place: ${bad}` : `${opt.name}: left-click to place`, line2 = "right-click / Esc to cancel";
  ctx.fillStyle = bad ? "#ff8a7a" : "#bfffcf"; ctx.strokeText(line1, spot.x, spot.y - 62); ctx.fillText(line1, spot.x, spot.y - 62);
  ctx.fillStyle = "#c3ccc9"; ctx.font = "11px Inter, system-ui, sans-serif"; ctx.strokeText(line2, spot.x, spot.y - 48); ctx.fillText(line2, spot.x, spot.y - 48);
  ctx.restore();
}
function drawBuildWheel() {
  const meS = me_(), me = V(meS);
  if (placing && (!meS?.alive || state.vehicles?.get(myId) || state.phase !== "playing" && state.phase !== "cleared")) placing = null;   // died / got in a vehicle / match over
  if (placing && me && !wheel) drawPlacement(me);
  drawStationPrompt(); if (!drawDeepPrompt()) drawCoasterPrompt();
  if (!wheel || !me) return;
  const R = WHEEL_R, step = Math.PI * 2 / BUILD_WHEEL.length;
  ctx.save();
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
    { const n = ownedOf(o.id), cap = buildCap(meS, o.id), full = n >= cap; ctx.font = "bold 11px ui-monospace, monospace"; ctx.fillStyle = full ? "#ffb35c" : "#9fb0ab"; const tx = full ? `${n}/${cap} · replaces oldest` : `${n}/${cap}`; ctx.strokeText(tx, x, y + 33); ctx.fillText(tx, x, y + 33); }   // your count / your cap for this type
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
  ctx.fillText(wheel.pick < 0 ? "release to cancel" : "release to " + "pick", wheel.cx, wheel.cy + 4);
  ctx.restore();
}

// what gets sent to the server each frame
let lastMelee = 0, clickShotAt = 0, dashReadyAt = 0, dashQueued = false;
// Fire axe: press = start charging, release = swing. Held 1 second or more = heavy swing.
let axeChargeAt = 0;
const AXE_CHARGE_MS = 1000;
function releaseAxe() {
  if (!axeChargeAt) return;
  const held = gnow() - axeChargeAt; axeChargeAt = 0;
  const me = me_();
  if (!room || !me?.alive || me.activeSlot !== 1 || me.melee !== "axe" || state?.phase !== "playing") { room?.send("charge", { on: false }); return; }
  room.send("attack", { a: aimAngle(me), heavy: held >= AXE_CHARGE_MS }); lastMelee = gnow();
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
  if (!room || !state || (state.phase !== "playing" && state.phase !== "cleared")) return;   // the break: you can walk (the server ignores shots then)
  if (state.paused) { dashQueued = false; return; }   // paused by the host: no moving, no shooting
  const me = me_(); if (!me?.alive) return;
  const ride = state.vehicles?.get(myId);
  if (t - lastInput > 45) {
    const dx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0), dy = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
    const dt = Math.min(100, t - lastInput), seq = ++PRED.seq; lastInput = t;
    if (ride) room.send("input", { dx, dy, a: aimAngle(me), s: seq, f: (ride.kind === "heli" || ride.kind === "mecha") && heliTrigger() ? 1 : 0 });   // in a vehicle the gun follows the mouse (no prediction: the server drives it)
    else { room.send("input", { dx, dy, s: seq, dt: Math.round(dt) }); predictInput(me, { seq, dx, dy, dt: dt / 1000 }); }
  }
  if (ride) {   // Sofea's tank / helicopter: hold or click to fire (the server allows one shot every 1.5s)
    const clicked = clickShotAt && gnow() - clickShotAt < 300;
    if (ride.phase === "ride" && ride.kind === "tank" && !anyPanelOpen() && (firing || clicked) && t - lastShoot > 120) { room.send("attack", { a: aimAngle(me), d: aimDist(me) }); lastShoot = t; clickShotAt = 0; }
    dashQueued = false; return;
  }
  if (!wheel && !squadWheel && !anyPanelOpen() && !(me.stunned > 0)) {
    const clicked = clickShotAt && gnow() - clickShotAt < 300; // a quick click counts even if the button is already released
    if (me.activeSlot === 1) {
      const cd = (MELEE_INFO[me.melee] || MELEE_INFO.knife).cd * 1000 / (me.characterClass === "assault" && me.skillT > 0 ? 1.25 : 1);   // Combat Rush: +25% attack speed
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
    dashReady = false; dashReadyAt = gnow() + DASH_CD_MS; setTimeout(() => dashReady = true, DASH_CD_MS);
    const dx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0), dy = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
    const seq = ++PRED.seq, from = V(me); room.send("dash", { dx, dy, s: seq }); predictInput(me, { seq, dx, dy, dash: true });
    if (from && PRED.ok) dashBeam(myId, from.x, from.y, PRED.x, PRED.y);
  }
}
// --- Pixel-art world renderer: hand-drawn Canvas sprites, buildings and props ---
function px(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)));}
function block(x,y,w,h,base,shade,light){px(x,y,w,h,base);px(x,y,w,3,light);px(x,y+h-3,w,3,shade);px(x,y,3,h,light);px(x+w-3,y,3,h,shade);}
// ---------- VIKTOR: Heavy Turret (E) + Robot Squad (Q) ----------
const ULT = { assault: { name: "Frag Barrage", icon: "grenade", noCard: true, life: 1, cd: 20 }, engineer: { name: "Heavy Turret", icon: "heavyTurret", life: 40, cd: 60 }, scout: { name: "Blade Storm", icon: "bladeStorm", life: 10, cd: 60 }, demolitionist: { name: "Demo Ripple", icon: "demoRipple", life: 30, cd: 60 }, operator: { name: "Sky Reign", icon: "skyReign", life: 30, cd: 60 }, juggernaut: { name: "War Cry", icon: "warCry", life: 10, cd: 60 }, dispatcher: { name: "Police Backup", icon: "policeBackup", life: 30, cd: 60 } };
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
  const now = gnow();
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
  const now = gnow(); let mv = robotMove.get(r.id);
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
// ---------- THE PYRE PRIEST (boss of wave 8; art: tools/extract-pyre.py) ----------
// Sheets: 4 cols x 5 rows (D, DR, R, UR, U; the left side is the right side mirrored), 300x185 cells, feet at (150, 158).
// Effects: 8 frames in a row on black, drawn additive ("lighter"). Timings match PYRE on the server.
const pyImgs = {};
for (const [k, url] of Object.entries({ walk: "assets/sprites/zombies/dir8/pyre-walk.webp", swing: "assets/sprites/zombies/dir8/pyre-swing.webp", sermon: "assets/sprites/zombies/dir8/pyre-sermon.webp",
  death: "assets/sprites/zombies/dir8/pyre-death.webp", pillar: "assets/sprites/fx/pyre-pillar.webp", pillarBig: "assets/sprites/fx/pyre-pillar-enraged.webp",
  trail: "assets/sprites/fx/pyre-trail.webp", ember: "assets/sprites/fx/pyre-ember.webp", ring: "assets/sprites/fx/pyre-swing.webp",
  wline: "assets/sprites/fx/pyre-wheel-line.webp", whub: "assets/sprites/fx/pyre-wheel-hub.webp" })) { const im = new Image(); im.src = url; pyImgs[k] = im; }
// Wheel of Flame art (tools/extract-wheel.py): wline = 8 rows of a long fire line (lw x lh, glowing base at y lb);
// whub = 16 frames of the burning rune (hw x hh, its centre at (hw/2, hc)). The flames always rise UP whichever way a line points (drawPyreWheel)
const PYW = { lw: 582, lh: 44, lb: 38, hw: 156, hh: 162, hc: 114, hubR: 70, hubScale: 1.45 };
const PY = { sc: 1.65, r: 1.65, cw: 495, ch: 305, ax: 248, fy: 261, step: 30,   /* (Nov 12) cw..fy are sheet pixels: the sheets are cut at r = 1.65x (the size he is drawn), so draws scale by sc / r = 1 */ swingR: 260, flat: .6, wind: .7, spin: .55, sermon: 2.6, wheelCast: 1.2, strikeWind: .3, back: Math.PI / 2, ringW: 250 };   // ringW: the fire ring's width in its art
const pyreMove = new Map(), pyreWalk = new Map(), pyreBurn = new Map();   // per boss: walk cycle; firewalk end; per player: burning until
let pyreWheel = null;   // the Wheel of Flame: { id, a, w, warn, life, len, hw, t } (angle a at time t, turning w rad/s clockwise, centred on his feet)
function pyRow(a) {   // facing -> sheet row (D, DR, R, UR, U) + mirror for the left side
  const r8 = ROW_OF_OCT[((Math.round((a || 0) / (Math.PI / 4)) % 8) + 8) % 8];
  return r8 === 5 ? [3, true] : r8 === 6 ? [2, true] : r8 === 7 ? [1, true] : [r8, false];
}
function pyFx(key, frame, x, y, sc, ay = 1, alpha = 1) {   // one additive effect frame; (x, y) = the frame's anchor (ay: 1 = bottom, .5 = centre)
  const im = pyImgs[key]; if (!im?.naturalWidth) return; const fw = im.naturalWidth / 8, fh = im.naturalHeight, f = Math.max(0, Math.min(7, frame)), f0 = Math.floor(f);
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = alpha;
  blendCells(im, 0, 0, fw, fh, f0, Math.min(7, f0 + 1), f - f0, x - fw * sc / 2, y - fh * sc * ay, fw * sc, fh * sc);
  ctx.restore();
}
function pyreAura(z, feet, now, front) {   // the scary part: smoke, heat and embers around him
  const t = now / 1000, en = z.enraged ? 1 : 0, gy = z.y + feet;
  ctx.save(); ctx.translate(z.x, gy); ctx.scale(PY.sc, PY.sc); ctx.translate(-z.x, -gy);   // (Nov 12) he's 1.65x bigger: so is his aura
  if (!front) {
    let g = ctx.createRadialGradient(z.x, gy, 6, z.x, gy, 80);   // (Nov 12, user: "I want him to look clear") just a soft contact shadow under his feet: no dark pool, no dark halo behind him
    g.addColorStop(0, "rgba(10,2,0,.42)"); g.addColorStop(.6, "rgba(10,2,0,.2)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(z.x, gy, 80, 26, 0, 0, 7); ctx.fill();
    ctx.globalCompositeOperation = "lighter"; const beat = .5 + .5 * Math.sin(t * 5.3) * Math.sin(t * 2.1);
    g = ctx.createRadialGradient(z.x, gy - 40, 6, z.x, gy - 40, 95 + beat * 15);   // heat glow
    g.addColorStop(0, `rgba(255,${110 - en * 40},30,${.22 + beat * .12 + en * .1})`); g.addColorStop(1, "rgba(120,20,0,0)");
    ctx.fillStyle = g; ctx.fillRect(z.x - 120, gy - 160, 240, 200);
    ctx.lineWidth = 2; ctx.strokeStyle = `rgba(255,${80 - en * 50},30,${.25 + beat * .3})`; ctx.setLineDash([3, 9]); ctx.lineDashOffset = -t * 30;   // flickering heat ring
    ctx.beginPath(); ctx.ellipse(z.x, gy, 70 + beat * 6, 26 + beat * 2, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  } else {
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 14 + en * 8; i++) {   // embers rising off him (the dark smoke puffs that drifted over his body are gone: he stays clear)
      if (i % 3 === 0) continue;
      const ph = (t * (.45 + (i % 5) * .07) + i * .173) % 1, sd = Math.sin(i * 91.7) * 4371.3, r = sd - Math.floor(sd);
      const x = z.x + (r - .5) * 90 + Math.sin(t * 2 + i) * 8, y = gy - 20 - ph * 150;
      ctx.fillStyle = `rgba(255,${140 + (i % 4) * 25},50,${.75 * (1 - ph)})`; ctx.fillRect(x, y, 2, 2 + (1 - ph) * 3);
    }
  }
  ctx.restore();
}
function drawPyre(z) {
  const now = gnow(), feet = z.radius * .8, t = actTime(z), gy = z.y + feet;
  let mv = pyreMove.get(z.id); if (!mv) { mv = { x: z.x, y: z.y, dist: 0, at: 0 }; pyreMove.set(z.id, mv); }
  const step = Math.hypot(z.x - mv.x, z.y - mv.y); if (step > .3 && step < 60) { mv.dist += step; mv.at = now; } mv.x = z.x; mv.y = z.y;
  pyreAura(z, feet, now, false);
  if (now < (pyreWalk.get(z.id) || 0)) {   // FIREWALK: flames licking at his feet
    ctx.save(); ctx.globalCompositeOperation = "lighter"; const g = ctx.createRadialGradient(z.x, gy, 4, z.x, gy, 60 * PY.sc);
    g.addColorStop(0, "rgba(255,170,40,.55)"); g.addColorStop(1, "rgba(255,60,0,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(z.x, gy, 60 * PY.sc, 22 * PY.sc, 0, 0, 7); ctx.fill(); ctx.restore();
  }
  if (z.act === "swing" && t < PY.wind + .05) {   // telegraph: a spinning red ring = how far the censer reaches
    const k = Math.min(1, t / PY.wind), R = PY.swingR; ctx.save();
    ctx.fillStyle = `rgba(255,50,20,${.06 + .14 * k})`; ctx.beginPath(); ctx.ellipse(z.x, gy, R, R * PY.flat, 0, 0, 7); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = `rgba(255,70,40,${.5 + .5 * k})`; ctx.setLineDash([22, 14]); ctx.lineDashOffset = -now / 6;
    ctx.beginPath(); ctx.ellipse(z.x, gy, R, R * PY.flat, 0, 0, 7); ctx.stroke(); ctx.restore();
  }
  if (z.act === "sermon") {   // kneeling: his back is the weak spot (double damage), shown as a gold wedge behind him
    const back = (z.aim || 0) + Math.PI, pulse = .5 + .5 * Math.sin(now / 120); ctx.save();
    ctx.fillStyle = `rgba(255,210,80,${.1 + .1 * pulse})`; ctx.strokeStyle = `rgba(255,220,100,${.45 + .35 * pulse})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(z.x, gy); ctx.ellipse(z.x, gy, 150, 150 * .62, 0, back - PY.back, back + PY.back); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.font = "bold 13px monospace"; ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = "#1a0b0b"; ctx.fillStyle = `rgba(255,225,110,${.7 + .3 * pulse})`;
    const lx = z.x + Math.cos(back) * 105, ly = gy + Math.sin(back) * 60; ctx.strokeText("BACK ×2", lx, ly); ctx.fillText("BACK ×2", lx, ly); ctx.restore();
  }
  // pick the frame: walk cycle by distance walked (cross-faded), swing spins through every direction, sermon kneels
  let sheet = "walk", f = 0, f2 = 0, k = 0, face = z.aim || 0;
  if (z.act === "swing") {
    sheet = "swing";
    if (t < PY.wind) { const u = t / PY.wind * 1.99; f = Math.floor(u); f2 = f + 1; k = u - f; }
    else if (t < PY.wind + PY.spin) { f = f2 = 2; face += (t - PY.wind) / PY.spin * Math.PI * 2; }   // the 360: censer out, turning all the way round
    else { const u = Math.min(1, (t - PY.wind - PY.spin) / .3); f = 3; f2 = 0; k = u; }
  } else if (z.act === "strike") {   // Lamp Strike (basic attack): the swing sheet's wind-up, then straight into the follow-through (no spin)
    sheet = "swing";
    if (t < PY.strikeWind) { const u = t / PY.strikeWind * 1.99; f = Math.floor(u); f2 = f + 1; k = u - f; }
    else { const u = Math.min(1, (t - PY.strikeWind) / .4); f = 3; f2 = 0; k = Math.max(0, u - .5) * 2; }
  } else if (z.act === "sermon" || z.act === "wheel") {   // kneels to pray / to plant the Wheel of Flame
    sheet = "sermon"; const T = z.act === "wheel" ? PY.wheelCast : PY.sermon;
    f = t < .25 ? 0 : t < .45 ? 1 : t < T - .35 ? 2 : 3; f2 = Math.min(3, f + 1);
    k = t < .25 ? t / .25 : t < .45 ? (t - .25) / .2 : t < T - .35 ? 0 : 0;
  } else if (now - mv.at < 160) { const u = mv.dist / (PY.step * PY.sc); f = Math.floor(u) % 4; f2 = (f + 1) % 4; k = abCrisp(u - Math.floor(u)); }   // frames hold, then a quick cross-fade (no blurry double image)
  const [row, flip] = pyRow(face), im = pyImgs[sheet]?.naturalWidth ? pyImgs[sheet] : pyImgs.walk;
  const flashAt = feel.flash.get(z.id), flashing = flashAt && now - flashAt < 90;
  if (z.enraged) bossGlow(z.x, gy - 75 * PY.sc, "255,60,20", 120 * PY.sc, .5 + .2 * Math.sin(now / 90));   // red halo (was a drop-shadow filter on a 300x185 sprite every frame)
  else if (z.act === "sermon" && f === 2) bossGlow(z.x, gy - 60 * PY.sc, "255,170,40", 130 * PY.sc, .6);
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.translate(Math.round(z.x), Math.round(gy)); ctx.scale(PY.sc / PY.r, PY.sc / PY.r); if (flip) ctx.scale(-1, 1);   // (Nov 12) 1.65x: as tall as the pyramid's doorway
  flashDraw(flashing, () => blendCells(im, 0, row * PY.ch, PY.cw, PY.ch, f, f2, k, -PY.ax, -PY.fy));
  ctx.restore();
  pyreAura(z, feet, now, true);
}
function onPyre(m) {   // "wheel" is re-sent when he enrages (spins faster): only a fresh one shakes the screen
  const t = gnow();
  if (m.k === "patch") fx.push({ type: "pyre", k: "patch", x: m.x, y: m.y, life: m.life, t, seed: Math.random() * 8 });
  else if (m.k === "sermon") for (const [x, y] of m.pts || []) fx.push({ type: "pyre", k: "pillar", x, y, warn: m.warn, r: m.r, big: m.big, t });
  else if (m.k === "swing") fx.push({ type: "pyre", k: "ring", id: m.id, x: m.x, y: m.y, r: m.r, wind: m.wind, t });
  else if (m.k === "strike") fx.push({ type: "pyre", k: "strike", id: m.id, a: m.a, r: m.r, wind: m.wind, t });
  else if (m.k === "firewalk") pyreWalk.set(m.id, t + m.life * 1000);
  else if (m.k === "wheel") { const fresh = !pyreWheel || pyreWheel.id !== m.id || m.warn > 1.5; pyreWheel = { ...m, t }; if (fresh) { shake(5, 300); playSfx("boom", m.x, m.y, .5); } }
  else if (m.k === "ignite") { pyreBurn.set(m.id, t + m.len * 1000); const p = state?.players?.get(m.id); if (p) fx.push({ type: "pyre", k: "ember", id: m.id, t }); }
}
function wheelState(now) {   // { e: seconds since planted, a: current angle, k: fire strength 0..1 } or null when it's gone
  const W = pyreWheel; if (!W) return null; const e = (now - W.t) / 1000, zr = state?.zombies?.get(W.id);
  if (e > W.warn + W.life || !zr) { pyreWheel = null; return null; }
  const v = V(zr) || zr, on = e - W.warn;   // centred on his feet (smoothed, like his sprite)
  W.x = v.x; W.y = v.y + zr.radius * .8; return { e, a: W.a + W.w * e, k: on < 0 ? 0 : Math.min(1, on / .3, (W.warn + W.life - e) / 1) };
}
function drawPyreWheel(now) {   // 4 lines of fire at 12, 3, 6 and 9 o'clock, turning clockwise round him
  const s = wheelState(now), W = pyreWheel; if (!s || !inView(W.x, W.y, W.len + 60)) return;
  const L = W.len, hw = W.hw; ctx.save(); ctx.lineCap = "round";
  for (let i = 0; i < 4; i++) {   // the scorched track under each line
    const c = Math.cos(s.a + i * Math.PI / 2), sn = Math.sin(s.a + i * Math.PI / 2), x2 = W.x + c * L, y2 = W.y + sn * L;
    if (s.k <= 0) {   // warning: red dashed lines, pulsing faster as it's about to light
      const p = .5 + .5 * Math.sin(now / (60 + 120 * (1 - s.e / W.warn)));
      ctx.strokeStyle = `rgba(255,60,30,${.12 + .1 * p})`; ctx.lineWidth = hw * 2; ctx.beginPath(); ctx.moveTo(W.x, W.y); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.strokeStyle = `rgba(255,90,40,${.55 + .4 * p})`; ctx.lineWidth = 3; ctx.setLineDash([18, 12]); ctx.lineDashOffset = -now / 8;
      ctx.beginPath(); ctx.moveTo(W.x, W.y); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]); continue;
    }
    ctx.globalCompositeOperation = "source-over"; ctx.strokeStyle = `rgba(20,4,2,${.45 * s.k})`; ctx.lineWidth = hw * 2.2; ctx.beginPath(); ctx.moveTo(W.x, W.y); ctx.lineTo(x2, y2); ctx.stroke();   // scorched track
    ctx.globalCompositeOperation = "lighter"; const fl = .85 + .15 * Math.sin(now / 50 + i * 2);   // a glowing crack under the flames
    for (const [w, col] of [[hw * 1.4, `rgba(255,70,10,${.22 * s.k * fl})`], [3, `rgba(255,220,140,${.6 * s.k})`]]) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(W.x, W.y); ctx.lineTo(x2, y2); ctx.stroke(); }
  }
  ctx.restore();
  const line = pyImgs.wline, hub = pyImgs.whub;
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  if (s.k > 0 && line.naturalWidth) for (let i = 0; i < 4; i++) {
    const a = s.a + i * Math.PI / 2, c = Math.cos(a), sn = Math.sin(a), len = Math.min(L - PYW.hubR, PYW.lw);
    const ft = now / 85 + i * 2, rows = [Math.floor(ft) % 8, (Math.floor(ft) + 1) % 8], k = ft - Math.floor(ft);   // its 8 frames cross-faded (no flicker)
    for (const [row, al] of [[rows[0], 1], [rows[1], k]]) {
      ctx.globalAlpha = s.k * al * .85;
      if (Math.abs(c) >= .3) {   // one continuous strip whose base follows the line while its flames stay upright (a shear: x along the line, y straight up)
        ctx.save(); ctx.translate(W.x + c * PYW.hubR, W.y + sn * PYW.hubR); ctx.transform(c, sn, 0, 1, 0, 0);
        ctx.drawImage(line, (i * 97) % (PYW.lw - len + 1), row * PYW.lh, len, PYW.lh, 0, -PYW.lb, len, PYW.lh); ctx.restore();
      } else for (let d = PYW.hubR; d < L; d += 13) {   // (nearly) up-down: a dense column of narrow upright flames
        const x = W.x + c * d + Math.sin(d * 1.7 + i) * 3, y = W.y + sn * d; if (!inView(x, y, 60)) continue;
        const u = ((d * 2.3 + i * 131) % (PYW.lw - 20) + (PYW.lw - 20)) % (PYW.lw - 20);
        ctx.drawImage(line, u, row * PYW.lh, 20, PYW.lh, x - 10, y - PYW.lb, 20, PYW.lh);
      }
    }
  }
  ctx.restore();
  if (s.k > 0) { ctx.save(); const t = now / 1000;   // soft roaring flames along the lines: the same fire-loop art as the map fires (smooth flipbook + glow pass)
    for (let i = 0; i < 4; i++) { const a = s.a + i * Math.PI / 2, c = Math.cos(a), sn = Math.sin(a);
      for (let d = PYW.hubR + 8, j = 0; d < L - 8; j++, d += 17 + 7 * Math.abs(Math.sin(j * 12.9898 + i * 3.1))) {   // dense, uneven spacing: one wall of fire, not a row of candles
        const r1 = Math.abs(Math.sin(j * 78.233 + i * 1.7)), x = W.x + c * d + (r1 - .5) * 8, y = W.y + sn * d + (r1 - .5) * 4; if (!inView(x, y, 70)) continue;
        const sc = .4 + .26 * r1 + .07 * Math.sin(t * 1.7 + j * 1.3);   // mixed sizes, each one breathing
        drawFireSprite(x, y + 3, sc, j * 3.7 + i * 5, t, s.k * (d > L - 60 ? (L - d) / 60 : 1));
      } }
    ctx.restore(); }
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  if (hub.naturalWidth) {   // the burning rune at the centre (faint while it's only a warning)
    ctx.globalAlpha = s.k > 0 ? s.k : .35 + .25 * Math.sin(now / 90); const f = Math.floor(now / 75) % 16, sc = PYW.hubScale;   // big enough to show round him
    ctx.drawImage(hub, f * PYW.hw, 0, PYW.hw, PYW.hh, W.x - PYW.hw / 2 * sc, W.y - PYW.hc * sc, PYW.hw * sc, PYW.hh * sc);
  }
  ctx.restore();
  ctx.save();   // seconds left, and arrows showing which way to walk (clockwise)
  ctx.globalCompositeOperation = "source-over"; ctx.lineWidth = 2.5; ctx.strokeStyle = `rgba(255,${s.k ? 200 : 90},80,.75)`;
  for (const R of [130, 330, 530]) for (let i = 0; i < 4; i++) {
    const a0 = s.a + i * Math.PI / 2 + .45, a1 = a0 + Math.min(.6, 70 / R); ctx.beginPath(); ctx.arc(W.x, W.y, R, a0, a1); ctx.stroke();
    const hx = W.x + Math.cos(a1) * R, hy = W.y + Math.sin(a1) * R, tg = a1 + Math.PI / 2;   // arrow head pointing clockwise
    ctx.beginPath(); ctx.moveTo(hx + Math.cos(tg) * 9, hy + Math.sin(tg) * 9); ctx.lineTo(hx + Math.cos(tg + 2.5) * 9, hy + Math.sin(tg + 2.5) * 9); ctx.lineTo(hx + Math.cos(tg - 2.5) * 9, hy + Math.sin(tg - 2.5) * 9); ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle; ctx.fill();
  }
  const left = Math.ceil(W.warn + W.life - s.e); ctx.font = "bold 16px monospace"; ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = "#1a0b0b"; ctx.fillStyle = "#ffd27a";
  ctx.strokeText(left + "s", W.x, W.y + 82); ctx.fillText(left + "s", W.x, W.y + 82); ctx.restore();   // under the rune
}
function drawPyreGround() {   // burning patches, the pillars' warning circles and the Wheel of Flame (under everyone)
  const now = gnow(); drawPyreWheel(now);
  for (const f of fx) {
    if (f.type !== "pyre") continue; const s = (now - f.t) / 1000;
    if (f.k === "patch" && s < f.life) {
      const a = Math.min(1, s / .3, (f.life - s) / .8); pyFx("trail", (s * 9 + f.seed) % 8, f.x, f.y + 14, .42, .82, a);
    }
    if (f.k === "pillar" && s < f.warn) {
      const k = s / f.warn, R = f.r; ctx.save();
      ctx.fillStyle = `rgba(255,${120 - 70 * k},30,${.12 + .2 * k})`; ctx.strokeStyle = `rgba(255,${170 - 110 * k},40,${.6 + .4 * k})`; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(f.x, f.y, R, R * .62, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(255,150,50,.3)"; ctx.beginPath(); ctx.ellipse(f.x, f.y, R * k, R * .62 * k, 0, 0, 7); ctx.fill(); ctx.restore();
    }
  }
}
function drawPyreFx(f, age) {   // false when finished
  const s = age / 1000;
  if (f.k === "patch") return s < f.life;   // drawn on the ground by drawPyreGround
  if (f.k === "strike") {   // Lamp Strike: a fiery arc sweeps across the front of him as the lamp comes down
    const e = s - f.wind; if (e > .32) return false; const zr = state?.zombies?.get(f.id); if (!zr) return false;
    const v = V(zr) || zr, gy = v.y + zr.radius * .55, R = f.r * .85;
    if (e < 0) return true;
    if (!f.hit) { f.hit = true; playSfx("stomp", v.x, v.y, .55); }
    const sweep = Math.min(1, e / .12), fade = 1 - Math.max(0, e - .12) / .2, a0 = f.a - Math.PI / 3, a1 = a0 + Math.PI * 2 / 3 * sweep;
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round"; ctx.translate(v.x, gy - 20); ctx.scale(1, .62);
    for (const [w, col] of [[26, `rgba(255,70,10,${.35 * fade})`], [12, `rgba(255,160,50,${.6 * fade})`], [4, `rgba(255,240,190,${.9 * fade})`]]) {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(0, 0, R, a0, a1); ctx.stroke();
    }
    ctx.restore(); return true;
  }
  if (f.k === "pillar") {   // after the warning: a roaring pillar of fire
    const e = s - f.warn; if (e < 0) return true; if (e > .9) return false;
    if (e < .05 && !f.boomed) { f.boomed = true; shake(4, 160); playSfx("boom", f.x, f.y, .45); }
    pyFx(f.big ? "pillarBig" : "pillar", e / .9 * 8, f.x, f.y + 22, f.big ? .8 : .7, .97); return true;
  }
  if (f.k === "ring") {   // the censer's fire ring, following him, from the start of the spin
    const e = s - f.wind; if (e < 0) return true; if (e > .85) return false;
    const zr = state?.zombies?.get(f.id), z = zr && (V(zr) || zr), x = z ? z.x : f.x, y = z ? z.y + z.radius * .8 : f.y + 32;
    pyFx("ring", e / .85 * 8, x, y + 6, f.r * 2 / PY.ringW, .5); return true;   // scaled so the ring = the hit area
  }
  if (f.k === "ember") {   // catching fire: a burst of sparks on the survivor
    if (s > .55) return false; const p = state?.players?.get(f.id); if (!p) return false; const v = V(p) || p;
    pyFx("ember", s / .55 * 8, v.x, v.y - 18, .45, .5); return true;
  }
  if (f.k === "death") {   // collapses, the censer rolls away, burns down to ash
    if (s > 4) return false; const im = pyImgs.death; if (!im?.naturalWidth) return true;
    const u = Math.min(5, s / .3), fr = Math.floor(u), a = s > 2.8 ? 1 - (s - 2.8) / 1.2 : 1;
    ctx.save(); ctx.globalAlpha = a; ctx.imageSmoothingQuality = "high"; const fx0 = Math.round(f.x), fy0 = Math.round(f.y + 32 * PY.sc); ctx.translate(fx0, fy0); ctx.scale(PY.sc / PY.r, PY.sc / PY.r);
    blendCells(im, 0, 0, PY.cw, PY.ch, fr, Math.min(5, fr + 1), u - fr, -PY.ax, -PY.fy); ctx.restore(); return true;
  }
  return false;
}
// ===================== THE SCREAMER (wave 12 boss) =====================
// Art: tools/extract-screamer.py. walk/shriek: 4 cols x 5 rows (D, DR, R, UR, U; the left is mirrored), wail 6 / choke 4 / death 6: one row,
// front view. Cells 300x240, feet at (150, 215). Effects: 8 frames in a row on black, drawn additive. Timings match SCREAMER on the server.
const scrImgs = {};
for (const [k, url] of Object.entries({ walk: "assets/sprites/zombies/dir8/screamer-walk.webp", shriek: "assets/sprites/zombies/dir8/screamer-shriek.webp",
  wail: "assets/sprites/zombies/dir8/screamer-wail.webp", choke: "assets/sprites/zombies/dir8/screamer-choke.webp", death: "assets/sprites/zombies/dir8/screamer-death.webp",
  ring: "assets/sprites/fx/screamer-ring.webp", ring2: "assets/sprites/fx/screamer-ring2.webp", mark: "assets/sprites/fx/screamer-mark.webp",
  burst: "assets/sprites/fx/screamer-burst.webp", blast: "assets/sprites/fx/screamer-wail.webp" })) { const im = new Image(); im.src = url; scrImgs[k] = im; }
// per effect: half width of its ring in the art (to scale it to the real hit area) and where its ground line sits (0 top .. 1 bottom)
const SCR = { cw: 600, ch: 480, ax: 300, fy: 430, r: 2, sc: 2, step: 26,   /* (Nov 12) sc: drawn 2x; cw..fy are sheet pixels (cut at r = 2x), so draws scale by sc / r = 1 */ wind: .45, wail: 2.5, wailLen: 3.6, ringW: 30,
  fx: { ring: [104, .51], ring2: [118, .59], mark: [103, .6], burst: [105, .79], blast: [120, .72] } };
const scrMove = new Map(), scrWail = new Map(), scrShriek = new Map(), scrMarks = new Map();   // per boss: walk cycle / wail wind-up / last shriek; per player: resonance mark
let deafF = null, deafUntil = 0;
function sFx(key, frame, x, y, scale, alpha = 1) {   // one additive effect frame, (x, y) = its ground point, scale fits its ring to a radius
  const im = scrImgs[key], F = SCR.fx[key]; if (!im?.naturalWidth || !F) return; const fw = im.naturalWidth / 8, fh = im.naturalHeight, f = Math.max(0, Math.min(7, frame)), f0 = Math.floor(f);
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  blendCells(im, 0, 0, fw, fh, f0, Math.min(7, f0 + 1), f - f0, x - fw * scale / 2, y - fh * scale * F[1], fw * scale, fh * scale);
  ctx.restore();
}
const sFit = (key, r) => r / SCR.fx[key][0];   // scale so the effect's ring = r px (half width)
function deafen(sec) {   // the wail got you: muffled sound + a ringing tone, fading back over `sec`
  const now = gnow(); deafUntil = now + sec * 1000; const ac = audioContext; if (!ac || !deafF || !sfxOn) return;
  const t = ac.currentTime; deafF.frequency.cancelScheduledValues(t); deafF.frequency.setValueAtTime(350, t); deafF.frequency.exponentialRampToValueAtTime(22000, t + sec);
  const o = ac.createOscillator(), g = ac.createGain(); o.type = "sine"; o.frequency.value = 3900; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.05, t + .05); g.gain.exponentialRampToValueAtTime(.0001, t + sec);
  o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + sec + .1);
}
// Can he see you? (the same cover as the server: buildings, tower, generator, barricades, Astra's safehouse) - drives the "SAFE / EXPOSED" hint
function scrCover(z, p) {
  const d = Math.hypot(p.x - z.x, p.y - z.y); if (d < 1) return false; const ux = (p.x - z.x) / d, uy = (p.y - z.y) / d, grid = predGrid(), tx = towerX(), ty = towerY();
  const solid = [{ x: tx, y: ty, hw: 34, hh: 34 }, { x: tx + GEN_OFF.x, y: ty + GEN_OFF.y, hw: 20, hh: 20 }];   // server: GEN_OFF.h = 20
  for (const st of state.structures.values()) if (st.kind === "safehouse") solid.push({ x: st.x, y: st.y, hw: 40, hh: 40 });
  for (let k = 12; k < d - 8; k += 14) {
    const x = z.x + ux * k, y = z.y + uy * k, gx = Math.floor(x / 160), gy = Math.floor(y / 160);
    for (const b of grid.get(gx + "," + gy) || []) if (Math.abs(x - b.x) < b.hw && Math.abs(y - b.y) < b.hh) return true;
    for (const b of solid) if (Math.abs(x - b.x) < b.hw && Math.abs(y - b.y) < b.hh) return true;
  }
  for (const st of state.structures.values()) {   // barricade lines (segment vs segment)
    if (st.kind !== "barricade") continue; const kk = ((Math.round(st.aim / (Math.PI / 4)) % 8) + 8) % 8, la = st.aim + Math.PI / 2, L = [38, 40, 46, 40][kk % 4], c = Math.cos(la), sn = Math.sin(la);
    const ax = st.x - c * L, ay = st.y - sn * L, sx = 2 * c * L, sy = 2 * sn * L, rx = p.x - z.x, ry = p.y - z.y, den = rx * sy - ry * sx; if (Math.abs(den) < 1e-6) continue;
    const t = ((ax - z.x) * sy - (ay - z.y) * sx) / den, u = ((ax - z.x) * ry - (ay - z.y) * rx) / den; if (t > 0 && t < 1 && u >= -.15 && u <= 1.15) return true;
  }
  return false;
}
function onScreamer(m) {
  const t = gnow(), me = me_(), near = me && Math.hypot(me.x - (m.x ?? me.x), me.y - (m.y ?? me.y)) < 700;
  const feedMsg = text => { feed.unshift({ text, t: Date.now() }); feed.length = Math.min(feed.length, 5); };
  if (m.k === "shriek") { scrShriek.set(m.id, { ...m, t }); fx.push({ type: "scream", k: "shriek", id: m.id, a: m.a, r: m.r, arc: m.arc, wind: m.wind, t }); }
  else if (m.k === "ring") { fx.push({ type: "scream", k: "ring", x: m.x, y: m.y, sp: m.sp, max: m.max, big: m.big, t }); playSfx("zap", m.x, m.y, .35); }
  else if (m.k === "mark") { for (const id of m.ids || []) scrMarks.set(id, { t, delay: m.delay, r: m.r }); if (m.ids?.includes(myId)) { feedMsg("YOU'RE MARKED: get away from your team!"); playSfx("alarm", undefined, undefined, .6); shake(3, 200); } }
  else if (m.k === "burst") { scrMarks.delete(m.id); fx.push({ type: "scream", k: "burst", x: m.x, y: m.y, r: m.r, t }); playSfx("boom", m.x, m.y, .5); if (near) shake(5, 220); }
  else if (m.k === "wailWind") { scrWail.set(m.id, { t, wind: m.wind }); playSfx("roar", undefined, undefined, .5); }
  else if (m.k === "wail") { scrWail.delete(m.id); fx.push({ type: "scream", k: "wail", x: m.x, y: m.y, t }); shake(12, 650); playSfx("roar", m.x, m.y, 1); playSfx("boom", m.x, m.y, .6);
    if (m.hit?.includes(myId)) { deafen(2.6); flashUntil = t + 140; feedMsg("DEAFENED: you were in his sight"); } else if (me?.alive) feedMsg("You were in cover: the wail missed you"); }
  else if (m.k === "choke") { scrWail.delete(m.id); fx.push({ type: "scream", k: "choke", id: m.id, t }); playSfx("zhit", undefined, undefined, 1); feedMsg("THE SCREAMER IS CHOKING: hit him now!"); }
  else if (m.k === "call") { shake(8, 500); playSfx("roar", undefined, undefined, .8); }
}
function drawScreamer(z) {
  const now = gnow(), feet = z.radius * .8, t = actTime(z), gy = z.y + feet, en = z.enraged ? 1 : 0, S = SCR.sc;
  let mv = scrMove.get(z.id); if (!mv) { mv = { x: z.x, y: z.y, dist: 0, at: 0 }; scrMove.set(z.id, mv); }
  const step = Math.hypot(z.x - mv.x, z.y - mv.y); if (step > .3 && step < 60) { mv.dist += step; mv.at = now; } mv.x = z.x; mv.y = z.y;
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.42)"; ctx.beginPath(); ctx.ellipse(z.x, gy, 48 * S, 13 * S, 0, 0, 7); ctx.fill(); ctx.restore();
  // telegraphs on the ground
  if (z.act === "shriek" && t < SCR.wind + .05) {   // the shriek's cone (or a full circle when you crowd him)
    const sh = scrShriek.get(z.id), k = Math.min(1, t / SCR.wind), R = sh?.r || 300, arc = sh?.arc ?? .52, a = sh?.a ?? z.aim;
    ctx.save(); ctx.translate(z.x, gy); ctx.scale(1, .62); ctx.fillStyle = `rgba(61,242,255,${.06 + .16 * k})`; ctx.strokeStyle = `rgba(150,250,255,${.4 + .5 * k})`; ctx.lineWidth = 2.5;
    ctx.beginPath(); if (arc < Math.PI) { ctx.moveTo(0, 0); ctx.arc(0, 0, R, a - arc, a + arc); ctx.closePath(); } else ctx.arc(0, 0, R, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  const ww = scrWail.get(z.id), winding = z.act === "wail" && t < SCR.wail;
  if (winding) {   // the wail is coming: sound pressure building up round him + his throat is the weak spot
    const k = Math.min(1, t / SCR.wail), pulse = .5 + .5 * Math.sin(now / (110 - 60 * k));
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) { const u = ((now / 900 + i / 3) % 1), R = 150 + u * 520; ctx.strokeStyle = `rgba(61,242,255,${(.35 + .4 * k) * (1 - u)})`; ctx.beginPath(); ctx.ellipse(z.x, gy, R, R * .6, 0, 0, 7); ctx.stroke(); }
    ctx.restore();
  }
  // frame
  let sheet = "walk", f = 0, f2 = 0, k = 0, face = z.aim || 0, single = false, shakeX = 0;
  if (z.act === "shriek") { sheet = "shriek"; if (t < .25) { f = 0; f2 = 1; k = t / .25; } else if (t < SCR.wind) { f = 1; f2 = 2; k = (t - .25) / (SCR.wind - .25); } else if (t < .78) f = f2 = 2; else { f = 3; f2 = 0; k = Math.min(1, (t - .78) / .2); } }
  else if (z.act === "pulse") { sheet = "shriek"; f = f2 = ((t - .25) % .6 + .6) % .6 < .28 ? 2 : 1; }
  else if (z.act === "mark") { sheet = "shriek"; f = t < .2 ? 0 : t < .5 ? 2 : 3; f2 = f; }
  else if (z.act === "wail" || z.act === "call") {
    sheet = "wail"; single = true; const T = z.act === "call" ? 1.6 : SCR.wailLen, W = z.act === "call" ? .35 : SCR.wail;
    if (t < W * .2) { f = 0; f2 = 1; k = t / (W * .2); } else if (t < W * .55) { f = 1; f2 = 2; k = (t - W * .2) / (W * .35); } else if (t < W) { f = f2 = 2; shakeX = (Math.random() - .5) * 3 * (t / W); }
    else if (t < T - .35) { f = f2 = Math.floor(now / 85) % 2 ? 4 : 3; shakeX = (Math.random() - .5) * 4; } else { f = 5; f2 = 5; }
  } else if (z.act === "choke") { sheet = "choke"; single = true; const u = Math.min(3.99, t / 2 * 4); f = Math.floor(u); f2 = Math.min(3, f + 1); k = u - f; }
  else if (now - mv.at < 160) { const u = mv.dist / (SCR.step * S); f = Math.floor(u) % 4; f2 = (f + 1) % 4; k = abCrisp(u - Math.floor(u)); }
  const [row, flip] = single ? [0, false] : pyRow(face), im = scrImgs[sheet]?.naturalWidth ? scrImgs[sheet] : scrImgs.walk;
  // his glowing throat (brighter while he winds up the wail), plus a red halo when enraged
  const beat = .5 + .5 * Math.sin(now / 260), th = winding ? Math.min(1, t / SCR.wail) : 0;
  bossGlow(z.x + (flip ? -1 : 1) * (row === 2 ? 14 * S : 0), gy - 118 * S, "61,242,255", (46 + 60 * th + 8 * beat) * S * .8, .35 + .25 * beat + .4 * th);
  if (en) bossGlow(z.x, gy - 85 * S, "255,40,40", 110 * S, .35 + .15 * Math.sin(now / 90));
  const flashAt = feel.flash.get(z.id), flashing = flashAt && now - flashAt < 90;
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.translate(Math.round(z.x + shakeX * S), Math.round(gy)); ctx.scale(S / SCR.r, S / SCR.r); if (flip) ctx.scale(-1, 1);
  flashDraw(flashing, () => blendCells(im, 0, row * SCR.ch, SCR.cw, SCR.ch, f, f2, k, -SCR.ax, -SCR.fy));
  ctx.restore();
  if (winding) {   // over his head: the throat is the weak spot right now
    const pulse = .5 + .5 * Math.sin(now / 90), lx = z.x, ly = gy - 175 * S - 30;
    ctx.save(); ctx.font = "bold 14px monospace"; ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = "#04161a"; ctx.fillStyle = `rgba(160,250,255,${.7 + .3 * pulse})`;
    ctx.strokeText("▼ THROAT ×2 ▼", lx, ly); ctx.fillText("▼ THROAT ×2 ▼", lx, ly); ctx.restore();
  }
}
function drawScreamerGround() {   // echo rings rolling outward + the resonance marks under the marked survivors (under everyone)
  const now = gnow();
  for (const f of fx) {
    if (f.type !== "scream" || f.k !== "ring") continue;
    const R = (now - f.t) / 1000 * f.sp; if (R > f.max + SCR.ringW) continue; const fade = R > f.max - 80 ? Math.max(0, (f.max + SCR.ringW - R) / (80 + SCR.ringW)) : 1, key = f.big ? "ring2" : "ring";
    sFx(key, 3 + ((now / 70) % 3), f.x, f.y, sFit(key, Math.max(12, R)), fade);   // a crisp ring frame, shimmering, scaled to the ring's real radius
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = `rgba(160,250,255,${.25 * fade})`; ctx.lineWidth = SCR.ringW * .6; ctx.beginPath(); ctx.ellipse(f.x, f.y, Math.max(1, R), Math.max(1, R * .6), 0, 0, 7); ctx.stroke(); ctx.restore();
  }
  for (const [id, mk] of scrMarks) {
    const e = (now - mk.t) / 1000; if (e > mk.delay + .3) { scrMarks.delete(id); continue; }
    const p = state?.players?.get(id); if (!p || !p.alive) continue; const v = V(p) || p, k = Math.min(1, e / mk.delay), mine = id === myId;
    ctx.save(); ctx.fillStyle = `rgba(61,242,255,${.06 + .12 * k})`; ctx.strokeStyle = `rgba(${mine ? "255,120,90" : "150,250,255"},${.45 + .45 * k})`; ctx.lineWidth = 2; ctx.setLineDash([10, 8]); ctx.lineDashOffset = -now / 20;
    ctx.beginPath(); ctx.ellipse(v.x, v.y + 14, mk.r, mk.r * .75, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();   // = the burst's reach: keep teammates out of it
    sFx("mark", 7 - k * 6.9, v.x, v.y + 14, sFit("mark", 34 + 10 * k), .6 + .4 * k);   // the rune at his feet (the sheet played backwards: it charges up)
    ctx.save(); ctx.font = "bold 14px monospace"; ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = "#04161a"; ctx.fillStyle = mine ? "#ffb08a" : "#bff8ff";
    const txt_ = Math.max(0, mk.delay - e).toFixed(1) + "s"; ctx.strokeText(txt_, v.x, v.y - 58); ctx.fillText(txt_, v.x, v.y - 58); ctx.restore();
  }
}
function drawScreamerFx(f, age) {   // false when finished
  const s = age / 1000;
  if (f.k === "ring") return (s * f.sp) < f.max + SCR.ringW;   // drawn on the ground by drawScreamerGround
  if (f.k === "shriek") {   // after the wind-up: arcs of sound fly out across the cone
    const e = s - f.wind; if (e < 0) return true; if (e > .45) return false;
    const zr = state?.zombies?.get(f.id), z = zr ? (V(zr) || zr) : null; if (!z) return false;
    const ox = z.x + Math.cos(f.a) * 24, oy = z.y - 60 + Math.sin(f.a) * 12, full = f.arc >= Math.PI;
    if (!f.hit) { f.hit = true; playSfx("roar", z.x, z.y, .35); }
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.translate(ox, oy + 40); ctx.scale(1, .62); ctx.lineCap = "round";
    for (let i = 0; i < 4; i++) {
      const u = e / .45 + i * .14; if (u > 1) continue; const R = 30 + u * f.r, a = (1 - u) * (.9 - i * .15);
      for (const [w, c] of [[14, `rgba(61,242,255,${.25 * a})`], [5, `rgba(170,250,255,${.7 * a})`], [1.6, `rgba(255,255,255,${.9 * a})`]]) {
        ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); if (full) ctx.arc(0, 0, R, 0, 7); else ctx.arc(0, 0, R, f.a - f.arc, f.a + f.arc); ctx.stroke();
      }
    }
    ctx.restore(); return true;
  }
  if (f.k === "burst") { if (s > .8) return false; sFx("burst", s / .8 * 8, f.x, f.y + 14, sFit("burst", f.r)); return true; }
  if (f.k === "wail") { if (s > 1.2) return false; sFx("blast", s / 1.2 * 8, f.x, f.y + 54, sFit("blast", 300)); return true; }
  if (f.k === "choke") {   // cyan sparks spitting out of his throat
    if (s > 1.4) return false; const zr = state?.zombies?.get(f.id), z = zr ? (V(zr) || zr) : null; if (!z) return false;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 14; i++) { const ph = (s * 1.6 + i * .071) % 1, sd = Math.sin(i * 77.1) * 999, r = sd - Math.floor(sd), x = z.x + (r - .5) * 100 * ph, y = z.y - 150 + ph * 140; ctx.fillStyle = `rgba(150,250,255,${.9 * (1 - ph)})`; ctx.fillRect(x, y, 4, 4); }   // (2x: from his throat)
    ctx.restore(); return true;
  }
  if (f.k === "death") {   // the throat bursts, he staggers and collapses, the glow fades out
    if (s > 4) return false; const im = scrImgs.death; if (!im?.naturalWidth) return true;
    const u = Math.min(5, s / .3), fr = Math.floor(u), a = s > 2.8 ? 1 - (s - 2.8) / 1.2 : 1;
    if (s < .4) bossGlow(f.x, f.y - 120, "61,242,255", 240, 1 - s / .4);
    ctx.save(); ctx.globalAlpha = a; ctx.imageSmoothingQuality = "high"; ctx.translate(Math.round(f.x), Math.round(f.y + 54)); ctx.scale(SCR.sc / SCR.r, SCR.sc / SCR.r);   // feet at y + radius(68) * .8
    blendCells(im, 0, 0, SCR.cw, SCR.ch, fr, Math.min(5, fr + 1), u - fr, -SCR.ax, -SCR.fy); ctx.restore(); return true;
  }
  return false;
}
function drawScreamerScreen() {   // screen space: TAKE COVER banner + whether YOU are safe; the deafness after a hit
  const now = gnow(), me = V(me_());
  for (const [id, w] of scrWail) {
    const zr = state?.zombies?.get(id); if (!zr) { scrWail.delete(id); continue; }
    const left = w.wind - (now - w.t) / 1000; if (left < -.2) { scrWail.delete(id); continue; }
    const z = V(zr) || zr, safe = me && me.alive ? scrCover(z, me) : true, pulse = .5 + .5 * Math.sin(now / 90);
    ctx.save(); ctx.textAlign = "center";
    ctx.font = "bold 30px monospace"; ctx.lineWidth = 6; ctx.strokeStyle = "#021014"; ctx.fillStyle = safe ? "#8dffb0" : `rgba(255,${120 + 80 * pulse},110,1)`;
    const big = safe ? "SAFE · YOU'RE IN COVER" : "TAKE COVER " + Math.max(0, left).toFixed(1) + "s";
    ctx.strokeText(big, W / 2, 132); ctx.fillText(big, W / 2, 132);
    ctx.font = "bold 13px monospace"; ctx.lineWidth = 4; ctx.fillStyle = "#bff8ff";
    for (const [i, sub] of ["Hide behind a building, the tower, the generator or a barricade", "or shoot his glowing throat (×2) to make him choke"].entries()) { ctx.strokeText(sub, W / 2, 154 + i * 17); ctx.fillText(sub, W / 2, 154 + i * 17); }
    if (!safe && me?.alive) {   // red edges when he can see you
      const g = ctx.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, W * .7); g.addColorStop(0, "rgba(255,40,40,0)"); g.addColorStop(1, `rgba(255,40,40,${.22 + .12 * pulse})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }
  if (now < deafUntil) {   // deafened: a cold ringing haze at the edges, fading out
    const k = (deafUntil - now) / 2600; const g = ctx.createRadialGradient(W / 2, H / 2, H * .2, W / 2, H / 2, W * .65);
    g.addColorStop(0, "rgba(190,250,255,0)"); g.addColorStop(1, `rgba(150,240,255,${.45 * k})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}
function screamerLights(now) {   // night: his throat glows, and the rings and bursts light the dark
  if (!state?.zombies) return;
  for (const z of state.zombies.values()) if (z.kind === "screamer" && inView(z.x, z.y, 360)) { const v = V(z) || z; lightHole(v.x - cam.x, v.y - 150 - cam.y, 260 + Math.sin(now / 260) * 14, .8); }   // (2x)
  for (const f of fx) if (f.type === "scream") {
    const s = (now - f.t) / 1000;
    if (f.k === "ring") { const R = s * f.sp; if (R < f.max) lightHole(f.x - cam.x, f.y - cam.y, Math.min(260, R + 40), .35); }
    if (f.k === "burst" && s < .6) lightHole(f.x - cam.x, f.y - 30 - cam.y, 170, .8 * (1 - s / .6));
    if (f.k === "wail" && s < 1) lightHole(f.x - cam.x, f.y - 60 - cam.y, 320, .9 * (1 - s));
  }
}
// ===================== THE ABOMINATION + THE FIVE (wave 16 boss) =====================
// Art: tools/extract-abomination.py. Boss cells 340x260, feet (170, 236): slam / spew = 4 cols x 5 rows (D, DR, R, UR, U; left mirrored),
// roll 6 / dazed 4 = one row, morph = 6 frames of 460x260. Spawn cells 240x210, feet (120, 182): run / lunge 4 x 5, dead 5 frames of 280.
// Effects: 24 frames in a row on black (3 sets of 8: start / loop / end), drawn additive. Timings match ABOM on the server.
// Walk sheet (Nov 10): 4 cols (stand, step, step, stand); idle = col 0. The spew sheet's cols: stand, step, spewing, drool (col 1 unused).
const abImgs = {};
for (const [k, url] of Object.entries({ walk: "assets/sprites/zombies/dir8/abom-walk.webp", slam: "assets/sprites/zombies/dir8/abom-slam.webp", spew: "assets/sprites/zombies/dir8/abom-spew.webp", roll: "assets/sprites/zombies/dir8/abom-roll.webp",
  dazed: "assets/sprites/zombies/dir8/abom-dazed.webp", morph: "assets/sprites/zombies/dir8/abom-morph.webp", srun: "assets/sprites/zombies/dir8/abomspawn-run.webp",
  slunge: "assets/sprites/zombies/dir8/abomspawn-lunge.webp", sdead: "assets/sprites/zombies/dir8/abomspawn-dead.webp",
  fxLava: "assets/sprites/fx/abom-lava.webp", fxSlam: "assets/sprites/fx/abom-slam.webp", fxEmber: "assets/sprites/fx/abom-ember.webp" })) { const im = new Image(); im.src = url; abImgs[k] = im; }
const ABM = { bw: 680, bh: 520, bax: 340, bfy: 472, mw: 920, sw: 360, sh: 315, sax: 180, sfy: 273, r: 2, sr: 1.5, lava: "255,90,31", sc: 2, ssc: 1.5 };   // (Nov 12) the sheets are cut at r / sr x (= the size they are drawn): cell numbers are in sheet pixels, so draws scale by sc / r (= 1)   // (Nov 12) sc: he is drawn 2x (he looked small on The Crucible), ssc: the Five 1.5x (the Sundering shrinks 2x -> 1.5x as he parts, so the hand-over still lines up)
const abFlames = [];   // this frame's ground fires [x, y, scale, loop, phase, alpha] (lava puddles, slam scorch lines): drawn by drawAbomFlames
const abMove = new Map(), abTele = new Map(), abPuddles = [];   // walk cycles; latest telegraph per boss / spawn; lava puddles
function aFx(key, frame, x, y, scale, alpha = 1, rot = 0, left = false, sy = 1) {   // one additive frame of a 24-frame strip; (x, y) = its centre (or its left-middle with `left`); sy squashes its height
  const im = abImgs[key]; if (!im?.naturalWidth) return; const fw = im.naturalWidth / 24, fh = im.naturalHeight, f = Math.max(0, Math.min(23, frame)), f0 = Math.floor(f); scale *= 200 / fw;   // (Nov 12) the strips are full resolution now: `scale` stays "x a 200px-wide frame"
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = Math.max(0, Math.min(1, alpha)); ctx.translate(x, y); if (rot) ctx.rotate(rot);
  blendCells(im, 0, 0, fw, fh, f0, Math.min(23, f0 + 1), f - f0, left ? 0 : -fw * scale / 2, -fh * scale * sy / 2, fw * scale, fh * scale * sy); ctx.restore();
}
function onAbom(m) {
  const t = gnow(), feedMsg = text => { feed.unshift({ text, t: Date.now() }); feed.length = Math.min(feed.length, 5); };
  if (m.k === "slam" || m.k === "roll" || m.k === "spew" || m.k === "lunge") abTele.set(m.id, { ...m, t });
  if (m.k === "slamHit") { fx.push({ type: "abom", k: "slamfx", x: m.x, y: m.y, sc: 2, t }); fx.push({ type: "abom", k: "scorch", x: m.x, y: m.y, t }); shake(9, 380); playSfx("boom", m.x, m.y, .8); }
  else if (m.k === "roll") playSfx("roar", m.x, m.y, .5);
  else if (m.k === "daze") { fx.push({ type: "abom", k: "slamfx", x: m.x, y: m.y + 40, sc: 2.2, t }); shake(11, 450); playSfx("boom", m.x, m.y, .9); feedMsg("THE ABOMINATION IS DAZED: hit it now (×1.5)!"); }
  else if (m.k === "spew") fx.push({ type: "abom", k: "lava", id: m.id, a: m.a, len: m.len, wind: m.wind, dur: m.dur, t });
  else if (m.k === "puddles") { for (const [x, y] of m.list) abPuddles.push({ x, y, r: m.r, t, life: m.life * 1000 }); }
  else if (m.k === "sunder") { abTele.set(m.id, { ...m, t }); shake(6, 600); playSfx("roar", undefined, undefined, .9); feedMsg("He's tearing apart: back off and spread out!"); }
  else if (m.k === "split") { shake(7, 350); playSfx("roar", m.x, m.y, .9); }   // no burst here: the morph already ends on the five live sprites, so the hand-over is seamless
  else if (m.k === "land") { fx.push({ type: "abom", k: "slamfx", x: m.x, y: m.y + 16, sc: .9, from: 8, t }); const me = me_(); if (me && Math.hypot(me.x - m.x, me.y - m.y) < 300) shake(4, 160); playSfx("stomp", m.x, m.y, .5); }
}
const abCrisp = k => { k = Math.max(0, Math.min(1, (k - .55) / .45)); return k * k * (3 - 2 * k); };   // (Nov 12) walk cycles: each frame holds, then a quick cross-fade (a slow 50/50 blend read as a blurry double image)
function drawAbomination(z) {
  const now = gnow(), t = actTime(z), gy = z.y + z.radius * .8, tele = abTele.get(z.id), S = ABM.sc;
  let mv = abMove.get(z.id); if (!mv) { mv = { x: z.x, y: z.y, dist: 0, at: 0 }; abMove.set(z.id, mv); }
  const step = Math.hypot(z.x - mv.x, z.y - mv.y); if (step > .3 && step < 80) { mv.dist += step; mv.at = now; } mv.x = z.x; mv.y = z.y;
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.beginPath(); ctx.ellipse(z.x, gy, (z.act === "roll" ? 52 : 70) * S, 17 * S, 0, 0, 7); ctx.fill(); ctx.restore();
  if (z.act === "sunder") return drawAbomSunder(z, t, gy, now, tele);
  // telegraphs
  if (z.act === "slam" && tele?.k === "slam" && t < tele.wind) { const k = t / tele.wind;
    ctx.save(); ctx.translate(z.x, z.y); ctx.rotate(tele.a); ctx.fillStyle = `rgba(255,90,31,${.08 + .2 * k})`; ctx.strokeStyle = `rgba(255,170,90,${.45 + .5 * k})`; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.rect(0, -tele.hw, tele.len, tele.hw * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = `rgba(255,120,50,${.25 * k})`; ctx.fillRect(0, -tele.hw, tele.len * k, tele.hw * 2); ctx.restore(); }
  if (z.act === "spew" && tele?.k === "spew" && t < tele.wind) { const k = t / tele.wind;
    ctx.save(); ctx.translate(z.x, z.y); ctx.fillStyle = `rgba(255,90,31,${.07 + .18 * k})`; ctx.strokeStyle = `rgba(255,170,90,${.4 + .5 * k})`; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, tele.len, tele.a - tele.arc, tele.a + tele.arc); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
  // frame
  let sheet = "slam", f = 0, f2 = 0, k = 0, single = false, cw = ABM.bw, ax = ABM.bax, lift = 0, sx = 0, n = 4;
  if (z.act === "slam") { if (t < .35) { f = 0; f2 = 1; k = t / .35; } else if (t < .68) f = f2 = 1; else if (t < 1.15) { f = f2 = 2; } else { f = 3; f2 = 0; k = Math.min(1, (t - 1.15) / .3); } }
  else if (z.act === "spew") { sheet = "spew"; const W = tele?.wind || .6, D = tele?.dur || 1.3; if (t < W) { f = f2 = 0; sx = (Math.random() - .5) * 3 * t / W; } else if (t < W + D) { f = f2 = 2; sx = (Math.random() - .5) * 2; } else f = f2 = 3; }
  else if (z.act === "roll" || z.act === "unroll") { sheet = "roll"; single = true; n = 6;
    if (z.act === "unroll") { f = 4; f2 = 5; k = Math.min(1, t / .35); }
    else if (t < .5) { f = 0; f2 = 1; k = t / .5; } else if (t < 1) { f = 1; f2 = 2; k = (t - .5) / .5; }
    else { const u = mv.dist / (46 * S); f = 2 + Math.floor(u) % 3; f2 = 2 + (Math.floor(u) + 1) % 3; k = abCrisp(u - Math.floor(u)); lift = Math.abs(Math.sin(mv.dist / (60 * S))) * 7 * S; } }
  else if (z.act === "daze") { sheet = "dazed"; single = true; const L = z.actLen || 3; if (t < .35) f = f2 = 0; else if (t > L - .5) { f = 2; f2 = 3; k = Math.min(1, (t - (L - .5)) / .4); } else { f = f2 = Math.floor(t / .45) % 2 ? 2 : 1; } }
  else { sheet = "walk"; if (now - mv.at < 200) { const u = mv.dist / (26 * S); f = Math.floor(u) % 4; f2 = (f + 1) % 4; k = abCrisp(u - Math.floor(u)); } }
  const [row, flip] = single ? [0, false] : pyRow(z.aim || 0), im = abImgs[sheet];
  const beat = .5 + .5 * Math.sin(now / 300), sund = 0;
  bossGlow(z.x, gy - 85 * S, ABM.lava, (80 + 70 * sund + 8 * beat) * S, .3 + .2 * beat + .4 * sund);
  const flashAt = feel.flash.get(z.id), flashing = flashAt && now - flashAt < 90;
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.translate(Math.round(z.x + sx), Math.round(gy - lift)); ctx.scale(S / ABM.r, S / ABM.r); if (flip) ctx.scale(-1, 1);
  flashDraw(flashing, () => blendCells(im, 0, row * ABM.bh, cw, ABM.bh, f, f2, k, -ax, -ABM.bfy)); ctx.restore();
  const label = z.act === "daze" ? "DAZED · ×1.5 DAMAGE" : "";
  if (label) { ctx.save(); ctx.font = "bold 14px monospace"; ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = "#1a0803"; ctx.fillStyle = z.act === "daze" ? "#ffe08a" : "#ff9d6b"; ctx.strokeText(label, z.x, gy - 175 * S - 30); ctx.fillText(label, z.x, gy - 175 * S - 30); ctx.restore(); }
}
// THE SUNDERING (3.4s): the user's 6-frame strip IS the whole animation (Nov 10). Frames 0-2 share a pose (slow cross-fades while he swells
// and heats up); the tear (2 -> 3) and the final parting (4 -> 5) are bigger pose changes, so each gets a short hot flash to carry the cut.
// The last 0.3s fades the painted five into the five live sprites standing on the same spots (ABM_FAN = ABOM.sunder.fan), so when the
// server swaps him for the Five there is no jump and they simply start running.
const ABM_FAN = [[-150, 46], [-87, 24], [-6, 20], [78, 24], [150, 46]];   // = ABOM.sunder.fan: the painted five's feet at 1.5x (x * 1.5, y * 1.5 + 15 so their feet meet the live sprites' feet)
function drawAbomSunder(z, t, gy, now, tele) {
  const sm = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }, L = z.actLen || 3.4, im = abImgs.morph, run = abImgs.srun, bump = (c, w) => Math.max(0, 1 - Math.abs(t - c) / w);
  const heat = sm(t / 1.3), flash = Math.max(sm(bump(1.5, .45)), .55 * sm(bump(2.55, .4))), hand = sm((t - (L - .32)) / .3), cool = sm((t - 2.7) / .7);
  const M = ABM.sc - (ABM.sc - ABM.ssc) * sm((t - 2.3) / .55);   // his scale: 2x, easing to the Five's 1.5x during the final parting (frames 4 -> 5)
  if (tele && !tele.snap && t >= 1.45) { tele.snap = true; fx.push({ type: "abom", k: "ember", x: z.x, y: gy - 70 * M, sc: 1.25 * M, from: 8, t: now }); shake(11, 420); playSfx("boom", z.x, z.y, .9); }
  if (tele && !tele.snap2 && t >= 2.5) { tele.snap2 = true; fx.push({ type: "abom", k: "ember", x: z.x, y: gy - 55 * M, sc: M, from: 8, t: now }); shake(6, 260); playSfx("stomp", z.x, z.y, .6); }
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.beginPath(); ctx.ellipse(z.x, gy, (70 + 55 * sm((t - 1.4) / 1.2)) * M, 17 * M, 0, 0, 7); ctx.fill(); ctx.restore();
  bossGlow(z.x, gy - 80 * M, ABM.lava, (90 + 70 * heat + 50 * flash - 80 * cool) * M, Math.min(1, .35 + .4 * heat + .3 * flash) * (1 - .65 * cool));
  if (t < 1.5) aFx("fxEmber", t / 1.5 * 8, z.x, gy - 80 * M, (1.2 + .4 * heat) * M, .4 + .5 * heat);   // sparks gathering before the tear
  if (t < 2.9) { const fa = Math.min(1, t / .5) * (1 - sm((t - 2.2) / .7)), tt = now / 1000; drawSmoke3(z.x, gy - 30 * M, 1.9 * M, 2.2, tt, fa * .7); drawFire3(2, z.x, gy + 10 * M, 1.25 * M, 1.3, tt, fa * .9); drawFire3(1, z.x - 78 * M, gy + 4 * M, .8 * M, 4.1, tt, fa * .8); drawFire3(1, z.x + 80 * M, gy + 4 * M, .8 * M, 6.2, tt, fa * .8); }   // the ground burns under him
  const keys = [[0, 0], [.55, 1], [1.15, 2], [1.7, 3], [2.25, 4], [2.85, 5], [99, 5]]; let a = 0; while (a < keys.length - 2 && t >= keys[a + 1][0]) a++;
  const span = keys[a + 1][0] - keys[a][0], k = sm((t - keys[a][0] - span * .25) / (span * .75)), settled = sm((t - 1.6) / .5);   // each frame holds for a beat, then eases into the next
  const jx = (Math.random() - .5) * (1 + 4 * heat) * (1 - settled) * M, pulse = M + M * .03 * heat * (1 - settled) * Math.sin(t * (9 + 10 * heat)) + .04 * flash * M;
  if (im.naturalWidth && hand < 1) { ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.globalAlpha = 1 - hand; ctx.translate(Math.round(z.x + jx), Math.round(gy)); ctx.scale(pulse / ABM.r, pulse / ABM.r);
    const draw = () => blendCells(im, 0, 0, ABM.mw, ABM.bh, keys[a][1], keys[a + 1][1], k, -ABM.mw / 2, -ABM.bfy); draw();
    if (flash > .02) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = (1 - hand) * flash * .8; draw(); } ctx.restore(); }   // one hot pass: bright, but the figures stay readable
  if (hand > 0 && run.naturalWidth) for (const [ox, oy] of [...ABM_FAN].sort((u, v) => u[1] - v[1])) {   // the live sprites fade in on their own spots, back row first
    ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.globalAlpha = hand; ctx.translate(Math.round(z.x + ox), Math.round(z.y + oy + 24)); ctx.scale(ABM.ssc / ABM.sr, ABM.ssc / ABM.sr); ctx.drawImage(run, 0, 0, ABM.sw, ABM.sh, -ABM.sax, -ABM.sfy, ABM.sw, ABM.sh); ctx.restore(); }   // feet at y + radius(30) * .8, like drawAbomSpawn
  ctx.save(); ctx.font = "bold 14px monospace"; ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = "#1a0803"; ctx.fillStyle = "#ff9d6b"; ctx.globalAlpha = 1 - hand; ctx.strokeText("CAN'T BE HURT", z.x, gy - 175 * M - 30); ctx.fillText("CAN'T BE HURT", z.x, gy - 175 * M - 30); ctx.restore();
}
function drawAbomSpawn(z) {
  const now = gnow(), t = actTime(z), gy = z.y + z.radius * .8, tele = abTele.get(z.id), L = { wind: .4, leap: .28 }, F = ABM.ssc;
  let mv = abMove.get(z.id); if (!mv) { mv = { x: z.x, y: z.y, dist: 0, at: 0 }; abMove.set(z.id, mv); }
  const step = Math.hypot(z.x - mv.x, z.y - mv.y); if (step > .3 && step < 80) { mv.dist += step; mv.at = now; } mv.x = z.x; mv.y = z.y;
  let sheet = "srun", f = 0, f2 = 0, k = 0, lift = 0;
  if (z.act === "lunge") { sheet = "slunge"; if (t < L.wind) { f = f2 = 0; } else if (t < L.wind + L.leap) { const u = (t - L.wind) / L.leap; f = u < .5 ? 1 : 2; f2 = f; lift = Math.sin(Math.PI * u) * 30 * F; } else { f = f2 = 3; } }
  else if (now - mv.at < 160) { const u = mv.dist / (24 * F); f = Math.floor(u) % 4; f2 = (f + 1) % 4; k = abCrisp(u - Math.floor(u)); }
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.beginPath(); ctx.ellipse(z.x, gy, (30 - lift / F * .3) * F, (9 - lift / F * .08) * F, 0, 0, 7); ctx.fill(); ctx.restore();
  if (z.act === "lunge" && tele?.k === "lunge" && t < L.wind + L.leap) {   // where it will land
    const lx = tele.x + Math.cos(tele.a) * tele.dist, ly = tele.y + Math.sin(tele.a) * tele.dist, kk = Math.min(1, t / (L.wind + L.leap));
    ctx.save(); ctx.fillStyle = `rgba(255,90,31,${.1 + .22 * kk})`; ctx.strokeStyle = `rgba(255,170,90,${.5 + .45 * kk})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(lx, ly + 18, tele.r, tele.r * .7, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore(); }
  const [row, flip] = pyRow(z.aim || 0), im = abImgs[sheet];
  bossGlow(z.x, gy - 55 * F, z.enraged ? "255,40,30" : ABM.lava, (z.enraged ? 62 : 44) * F, z.enraged ? .6 + .2 * Math.sin(now / 80) : .3);
  const flashAt = feel.flash.get(z.id), flashing = flashAt && now - flashAt < 90;
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.translate(Math.round(z.x), Math.round(gy - lift)); ctx.scale(F / ABM.sr, F / ABM.sr); if (flip) ctx.scale(-1, 1);
  flashDraw(flashing, () => blendCells(im, 0, row * ABM.sh, ABM.sw, ABM.sh, f, f2, k, -ABM.sax, -ABM.sfy)); ctx.restore();
  // each of the Five has its own health bar
  const w = 60, hb = gy - 125 * F - 10 - lift, hk = Math.max(0, Math.min(1, z.hp / z.maxHp)); ctx.fillStyle = "rgba(0,0,0,.65)"; ctx.fillRect(z.x - w / 2 - 1, hb, w + 2, 6); ctx.fillStyle = z.enraged ? "#ff3b30" : "#ff8a3d"; ctx.fillRect(z.x - w / 2, hb + 1, w * hk, 4);
}
function drawAbomGround() {   // lava puddles + the roll lane (under everyone)
  const now = gnow();
  for (let i = abPuddles.length - 1; i >= 0; i--) {
    const q = abPuddles[i], e = now - q.t; if (e > q.life || state?.phase !== "playing") { abPuddles.splice(i, 1); continue; } if (!inView(q.x, q.y, 120)) continue;
    const a = e < 300 ? e / 300 : e > q.life - 900 ? (q.life - e) / 900 : 1, pulse = .5 + .5 * Math.sin(now / 240 + q.x);
    ctx.save(); ctx.globalAlpha = .55 * a; ctx.fillStyle = "#1c0d08"; ctx.beginPath(); ctx.ellipse(q.x, q.y, q.r, q.r * .7, 0, 0, 7); ctx.fill(); ctx.restore();
    aFx("fxSlam", 6 + pulse, q.x, q.y - 4, q.r / 88, .85 * a);   // the cracked-lava disc from the slam art, glowing
    abFlames.push([q.x, q.y + 8, .6 * a, 1, q.x * .01, a], [q.x - q.r * .5, q.y - 2, .55 * a, 0, q.y * .013, a], [q.x + q.r * .5, q.y + 2, .55 * a, 0, q.x * .017 + 2, a]);   // it burns (drawn with the sprites, so you walk behind / in front of the flames)
    ctx.save(); ctx.strokeStyle = `rgba(255,150,70,${.5 * a})`; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.ellipse(q.x, q.y, q.r, q.r * .7, 0, 0, 7); ctx.stroke(); ctx.restore();
  }
  for (const [id, m] of abTele) {
    const e = (now - m.t) / 1000; if (e > 8) { abTele.delete(id); continue; } if (m.k !== "roll") continue;
    const z = state?.zombies?.get(id); if (!z || z.act !== "roll") continue; const k = Math.min(1, e / m.wind);
    ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.a); ctx.fillStyle = `rgba(255,90,31,${.07 + .15 * k})`; ctx.strokeStyle = `rgba(255,170,90,${.4 + .5 * k})`; ctx.lineWidth = 2.5; ctx.setLineDash([16, 10]); ctx.lineDashOffset = -now / 14;
    ctx.beginPath(); ctx.rect(0, -m.hw, m.len, m.hw * 2); ctx.fill(); ctx.stroke(); ctx.restore();
  }
}
function drawAbomFlames() { const t = gnow() / 1000; for (const [x, y, sc, k, ph, a] of abFlames) if (inView(x, y, 140)) { if (k) drawSmoke3(x, y - 14, sc * .95, ph, t, a * .8); drawFire3(k, x, y, sc, ph, t, a); } abFlames.length = 0; }   // after the ground, before the sprites
function drawAbomFx(f, age) {   // false when finished
  const s = age / 1000;
  if (f.k === "slamfx") { const from = f.from || 0, T = from ? 1.0 : 1.7; if (s > T) return false; aFx("fxSlam", from + s / T * (24 - from), f.x, f.y, f.sc); return true; }
  if (f.k === "scorch") { if (s > 1.6) return false; const a = s < .15 ? s / .15 : Math.max(0, 1 - (s - .5) / 1.1); drawSmoke3(f.x, f.y, 1.3, f.x * .01, gnow() / 1000, a * .8); drawFire3(2, f.x, f.y + 26, 1.25 * (.7 + .3 * a), f.x * .01, gnow() / 1000, a); return true; }   // the ground burns for a moment where the arm landed
  if (f.k === "ember") { const from = f.from || 0, T = 1.5; if (s > T) return false; aFx("fxEmber", from + s / T * (24 - from), f.x, f.y, f.sc); return true; }
  if (f.k === "lava") {   // the stream: start set while it reaches out, loop set while he spews, end set as it dies
    const e = s - f.wind; if (e < 0) return true; if (e > f.dur + .45) return false;
    const zr = state?.zombies?.get(f.id), z = zr ? (V(zr) || zr) : null; if (!z || (zr.act !== "spew" && e < f.dur)) return false;
    const fr = e < .3 ? e / .3 * 8 : e < f.dur ? 8 + ((e - .3) / .09) % 8 : 16 + Math.min(7.9, (e - f.dur) / .45 * 8);
    const S = ABM.sc, ox = z.x + Math.cos(f.a) * 34 * S, oy = z.y + z.radius * .8 - 99 * S + Math.sin(f.a) * 18 * S, tx = z.x + Math.cos(f.a) * f.len, ty = z.y + Math.sin(f.a) * f.len;   // from his mouth to the far end of the cone on the ground
    const rot = Math.atan2(ty - oy, tx - ox), len = Math.hypot(tx - ox, ty - oy), sc = len / 200, sy = .62;   // (Nov 12) twice as long, not twice as fat: the height is squashed to match the narrower cone
    aFx("fxLava", fr, ox, oy, sc, 1, rot, true, sy); aFx("fxLava", (fr + 3) % 8 + (fr >= 16 ? 16 : fr >= 8 ? 8 : 0), ox, oy, sc * .92, .6, rot + .09, true, sy); aFx("fxLava", (fr + 5) % 8 + (fr >= 16 ? 16 : fr >= 8 ? 8 : 0), ox, oy, sc * .92, .6, rot - .09, true, sy);
    if (!f.snd) { f.snd = true; playSfx("flame", z.x, z.y, .8); }
    return true;
  }
  if (f.k === "sdead") {   // a Spawn crumbles into cooling rock
    if (s > 5) return false; const im = abImgs.sdead; if (!im?.naturalWidth) return true; const u = Math.min(4, s / .22), fr = Math.floor(u), a = s > 3.8 ? 1 - (s - 3.8) / 1.2 : 1, cw = im.naturalWidth / 5;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(Math.round(f.x), Math.round(f.y + 24)); ctx.scale(ABM.ssc / ABM.sr, ABM.ssc / ABM.sr); blendCells(im, 0, 0, cw, ABM.sh, fr, Math.min(4, fr + 1), u - fr, -cw / 2, -ABM.sfy); ctx.restore(); return true;
  }
  return false;
}
function abomLights(now) {
  if (!state?.zombies) return;
  for (const z of state.zombies.values()) { if (z.kind !== "abomination" && z.kind !== "abomSpawn") continue; if (!inView(z.x, z.y, 360)) continue; const v = V(z) || z; lightHole(v.x - cam.x, v.y - (z.kind === "abomination" ? 110 : 60) - cam.y, z.kind === "abomination" ? 320 : 130, .8); }   // (Nov 12) bigger with him (2x / the Five 1.5x)
  for (const q of abPuddles) if (inView(q.x, q.y, 150)) lightHole(q.x - cam.x, q.y - cam.y, q.r + 50, .6);
}
function drawPyreBurning() {   // survivors on fire: flames dancing on them
  if (!pyreBurn.size) return; const now = gnow();
  for (const [id, until] of pyreBurn) {
    if (now > until) { pyreBurn.delete(id); continue; }
    const p = state?.players?.get(id); if (!p || !p.alive) continue; const v = V(p) || p, left = (until - now) / 1000;
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = Math.min(1, left / .4);
    for (let i = 0; i < 7; i++) {
      const ph = (now / 420 + i * .143) % 1, x = v.x + Math.sin(i * 2.4 + now / 160) * 10, y = v.y + 8 - ph * 46;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 9 * (1 - ph) + 3); g.addColorStop(0, `rgba(255,220,120,${.9 * (1 - ph)})`); g.addColorStop(1, "rgba(255,60,0,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 9 * (1 - ph) + 3, 0, 7); ctx.fill();
    }
    ctx.restore();
  }
}
function drawPyreDread() {   // screen space: an orange heat haze creeps in at the edges when he's close to you
  const me = me_(); if (!me || !me.alive || !state?.zombies) return; let best = 1e9;
  for (const z of state.zombies.values()) if (z.kind === "pyre") best = Math.min(best, Math.hypot(z.x - me.x, z.y - me.y));
  if (best > 420) return; const k = 1 - best / 420, fl = .85 + .15 * Math.sin(gnow() / 70) * Math.sin(gnow() / 23);
  const g = ctx.createRadialGradient(W / 2, H / 2, H * .38, W / 2, H / 2, W * .68);
  g.addColorStop(0, "rgba(120,25,0,0)"); g.addColorStop(1, `rgba(130,30,0,${.32 * k * fl})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
function pyreLights(now) {   // night: the priest, his fire patches and pillars light up the dark
  if (!state?.zombies) return;
  for (const z of state.zombies.values()) if (z.kind === "pyre" && inView(z.x, z.y, 200)) { const v = V(z) || z; lightHole(v.x - cam.x, v.y - 30 - cam.y, 190 + Math.sin(now / 90) * 8, .9); }
  for (const f of fx) if (f.type === "pyre") {
    const s = (now - f.t) / 1000;
    if (f.k === "patch" && s < f.life && inView(f.x, f.y, 80)) lightHole(f.x - cam.x, f.y - cam.y, 70, .55);
    if (f.k === "pillar" && s > f.warn && s < f.warn + .9) lightHole(f.x - cam.x, f.y - 60 - cam.y, 160, .9);
  }
  const ws = wheelState(now), W = pyreWheel; if (ws && ws.k > 0) for (let i = 0; i < 4; i++) for (let d = 0; d < W.len; d += 110) {   // the wheel lights its lines
    const x = W.x + Math.cos(ws.a + i * Math.PI / 2) * d, y = W.y + Math.sin(ws.a + i * Math.PI / 2) * d; if (inView(x, y, 80)) lightHole(x - cam.x, y - cam.y, 75, .6 * ws.k);
  }
}
// ---------- THE HIVEMIND (mini boss on waves 2, 6, 10...) ----------
const hImgs = {};
for (const [k, url] of Object.entries({ crawl: "assets/sprites/zombies/dir8/hivemind.png", act: "assets/sprites/zombies/dir8/hivemind-act.png", fx: "assets/sprites/fx/hivemind-fx.png",
  aCrawl: "assets/sprites/zombies/dir8/hivemind-alpha.webp", aAct: "assets/sprites/zombies/dir8/hivemind-alpha-act.webp" })) { const im = new Image(); im.src = url; hImgs[k] = im; }
const HV = { slamWind: .55, slamR: 210, flat: .62, jumpUp: .3, jumpLand: .9 };   // matches the server
const hiveMove = new Map();
function hiveFx(row, col, x, y, alpha = 1, scale = 1) {   // 200x150 cells, bottom-centre at (x, y)
  const im = hImgs.fx; if (!im?.naturalWidth) return; ctx.save(); ctx.imageSmoothingEnabled = scale > 1.05; ctx.imageSmoothingQuality = "high"; ctx.globalAlpha = alpha;   // (Nov 12) scaled up for the Alpha: smooth, not blocky ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.drawImage(im, col * 200, row * 150, 200, 150, -100, -146, 200, 150); ctx.restore();
}
function drawHivemind(z) {
  const now = gnow(), feet = (z.radius || 44) * .8, t = actTime(z), sc = (z.radius || 44) / 44;   // sc > 1: the Alpha Hivemind (Fallen Dynasty's boss) is drawn bigger
  let mv = hiveMove.get(z.id); if (!mv) { mv = { x: z.x, y: z.y, dist: 0, at: 0 }; hiveMove.set(z.id, mv); }
  const step = Math.hypot(z.x - mv.x, z.y - mv.y); if (step > .3) { mv.dist += step; mv.at = now; } mv.x = z.x; mv.y = z.y;
  const flashAt = feel.flash.get(z.id), flashing = flashAt && now - flashAt < 90;
  let lift = 0;
  if (z.act === "jump" && t > HV.jumpUp && t < HV.jumpLand) lift = Math.sin(Math.PI * (t - HV.jumpUp) / (HV.jumpLand - HV.jumpUp)) * 70;
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.beginPath(); const sh = 1 - lift / 140; ctx.ellipse(z.x, z.y + feet, 70 * sh * sc, 16 * sh * sc, 0, 0, 7); ctx.fill(); ctx.restore();
  if (z.act === "slam" && t < HV.slamWind + .05) {   // danger zone fills up during the wind-up
    const k = Math.min(1, t / HV.slamWind); ctx.save(); ctx.fillStyle = `rgba(255,70,55,${.08 + .16 * k})`; ctx.strokeStyle = `rgba(255,70,55,${.4 + .5 * k})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(z.x, z.y + feet, HV.slamR * sc, HV.slamR * sc * HV.flat, 0, 0, 7); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  const big = sc > 1.05 && hImgs.aAct?.naturalWidth && hImgs.aCrawl?.naturalWidth;   // (Nov 12) the Alpha has its own sheets, cut sharp at its size (no 1.55x pixel stretch)
  const act = big ? hImgs.aAct : hImgs.act, crawl = big ? hImgs.aCrawl : hImgs.crawl, flip = Math.cos(z.aim || 0) < -.2;
  const AC = big ? { w: 402, h: 355, ax: 201, fy: 349 } : { w: 260, h: 230, ax: 130, fy: 226 }, CC = big ? { w: 325, h: 232, ax: 162, fy: 226 } : { w: 210, h: 150, ax: 105, fy: 144 };
  let row = -1, col = 0;
  if (z.act === "bite") { row = 0; col = Math.min(4, Math.floor(t / (.95 / 5))); }
  else if (z.act === "slam") { row = 1; col = t < .2 ? 0 : t < HV.slamWind ? 1 : t < HV.slamWind + .12 ? 2 : t < HV.slamWind + .35 ? 3 : t < 1.1 ? 4 : 5; }
  else if (z.act === "jump") { row = 2; col = t < HV.jumpUp ? 0 : t < .5 ? 1 : t < .7 ? 2 : t < HV.jumpLand ? 3 : t < 1.05 ? 4 : 5; }
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.translate(Math.round(z.x), Math.round(z.y + feet - (row === 2 ? 0 : lift)));
  if (sc > 1.05) { if (z.boss) { ctx.save(); ctx.scale(sc, sc); alphaAura(z, now); ctx.restore(); } if (!big) ctx.scale(sc, sc); else ctx.imageSmoothingEnabled = true; }   // its own sheets are drawn 1:1
  if (row >= 0 && act?.naturalWidth) { if (flip) ctx.scale(-1, 1); flashDraw(flashing, () => ctx.drawImage(act, col * AC.w, row * AC.h, AC.w, AC.h, -AC.ax, -AC.fy, AC.w, AC.h)); }
  else if (crawl?.naturalWidth) {
    const r8 = ROW_OF_OCT[((Math.round((z.aim || 0) / (Math.PI / 4)) % 8) + 8) % 8], c = now - mv.at < 200 ? Math.floor(mv.dist / (14 * (big ? sc : 1))) % 6 : 0;
    flashDraw(flashing, () => ctx.drawImage(crawl, c * CC.w, r8 * CC.h, CC.w, CC.h, -CC.ax, -CC.fy, CC.w, CC.h));
  }
  ctx.restore();
}
function alphaAura(z, now) {   // the Alpha: a sickly green glow pulsing under it (drawn in its scaled space, at its feet)
  const k = .55 + .45 * Math.sin(now / 260); ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.scale(1, .32);
  const g = ctx.createRadialGradient(0, 0, 8, 0, 0, 120); g.addColorStop(0, `rgba(150,255,90,${.32 * k})`); g.addColorStop(.6, `rgba(90,200,60,${.12 * k})`); g.addColorStop(1, "rgba(60,160,40,0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 120, 0, 7); ctx.fill(); ctx.restore();
}
function onHive(m) {
  const t = gnow();
  if (m.k === "brood") { shake(12, 700); playSfx("stomp", m.x, m.y); const el = $("hiveWarn"); if (el) { el.classList.remove("show"); void el.offsetWidth; el.classList.add("show"); } return; }
  if (m.k === "arrive") { shake(8, 900); const el = $("hiveWarn"); if (el) { txt("hiveWarnK", m.a ? "BOSS · FALLEN DYNASTY" : "MINI BOSS"); txt("hiveWarnT", m.a ? "THE ALPHA HIVEMIND HAS ARRIVED" : "THE HIVEMIND HAS ARRIVED");
      txt("hiveWarnS", m.a ? "Kill it to win the wave. At 66% and 33% health it tears off more Hiveminds." : "It bites, slams, leaps and spawns zombies. The wave won't end until it dies."); el.classList.remove("show"); void el.offsetWidth; el.classList.add("show"); } }
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
  const now = gnow(), armed = st.deploy <= 0;
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
  const t = gnow(), a = briggsAnim.get(m.id) || {}, me = me_(), near = me && Math.hypot((m.x ?? me.x) - me.x, (m.y ?? me.y) - me.y) < 900;
  if (m.k === "bastion") { briggsAnim.set(m.id, { ...a, k: "bastion", t0: t, domeAt: t + 300 }); setTimeout(() => near && shake(7, 220), 300); }
  else if (m.k === "cry") {   // the roar lands 0.18s in: hit-stop, big shake, the shockwave ring
    briggsAnim.set(m.id, { ...a, k: "cry", t0: t });
    setTimeout(() => { fx.push({ type: "briggs", k: "ring", x: m.x, y: m.y, r: m.r, t: gnow() }); if (near) { hitStopUntil = gnow() + 70; shake(16, 520); } }, 180);
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
// ---------- Marcus: Combat Rush (E) aura. Behind him: red ground glow + a body haze. In front: rising embers + a heat outline.
// Starts with a shock ring; fades out over the last half second (skillT = seconds left, synced).
const rushStart = new Map();
function marcusRush(p, now, front) {
  const t = now / 1000, fade = Math.min(1, p.skillT / .5), born = now - (rushStart.get(p.sessionId) || -1e9);
  const fy = p.y + SPR.feet, cy = fy - 26, beat = .5 + .5 * Math.sin(t * 9);
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  if (!front) {
    let g = ctx.createRadialGradient(p.x, fy - 2, 2, p.x, fy - 2, 56);   // ground glow
    g.addColorStop(0, `rgba(255,60,30,${.85 * fade})`); g.addColorStop(.6, `rgba(220,20,20,${.4 * fade})`); g.addColorStop(1, "rgba(120,0,0,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x, fy - 2, 56, 20, 0, 0, Math.PI * 2); ctx.fill();
    g = ctx.createRadialGradient(p.x, cy, 4, p.x, cy, 46 + beat * 8);   // body haze, breathing with the beat
    g.addColorStop(0, `rgba(255,40,30,${(.5 + beat * .18) * fade})`); g.addColorStop(1, "rgba(150,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(p.x - 56, cy - 56, 112, 112);
    ctx.lineWidth = 2.5; ctx.strokeStyle = `rgba(255,70,50,${(.5 + beat * .4) * fade})`;   // spinning dashed ground ring
    ctx.setLineDash([10, 7]); ctx.lineDashOffset = -t * 40; ctx.beginPath(); ctx.ellipse(p.x, fy - 2, 30 + beat * 3, 11 + beat, 0, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  } else {
    for (let i = 0; i < 24; i++) {   // embers / flame licks rising off him
      const ph = (t * .9 + i * .137) % 1, sd = Math.sin(i * 12.9898) * 43758.5453, r = sd - Math.floor(sd);
      const x = p.x + (r - .5) * 38 + Math.sin(t * 3 + i) * 5, y = fy - 4 - ph * 72, a = (1 - ph) * fade, sz = (1 - ph) * 4 + 1;
      ctx.fillStyle = `rgba(255,${80 + (i % 3) * 50},40,${a})`; ctx.beginPath(); ctx.ellipse(x, y, sz * .7, sz * 1.8, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (born < 450) {   // activation: a red shock ring bursting out
      const k = born / 450; ctx.lineWidth = 6 * (1 - k) + 1; ctx.strokeStyle = `rgba(255,50,40,${1 - k})`;
      ctx.beginPath(); ctx.ellipse(p.x, fy - 2, 20 + k * 90, 7 + k * 32, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = `rgba(255,90,60,${.5 * (1 - k)})`; ctx.beginPath(); ctx.arc(p.x, cy, 18 + k * 30, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}
// Screen pulse for the Marcus player: a red heartbeat around the edges + a flash when it starts.
function drawRushScreen() {
  const me = me_(); if (!me || me.characterClass !== "assault" || !(me.skillT > 0) || !me.alive) return;
  const now = gnow(), fade = Math.min(1, me.skillT / .5), born = now - (rushStart.get(me.sessionId) || -1e9);
  const ph = (now / 600) % 1, beat = Math.max(Math.exp(-ph * 9), .8 * Math.exp(-Math.abs(ph - .22) * 14));   // lub-dub every 0.6s
  const flash = born < 350 ? 1 - born / 350 : 0, a = (.16 + .2 * beat) * fade + .35 * flash;
  const g = ctx.createRadialGradient(W / 2, H / 2, H * (.42 - .05 * beat), W / 2, H / 2, W * .66);
  g.addColorStop(0, "rgba(220,20,20,0)"); g.addColorStop(1, `rgba(220,20,20,${a})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
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
  const t = gnow();
  if (m.k === "call") { astraCall.set(m.id, t); playVoice(m.id, m.s); }   // radio call: "Medic!" on E, "Cover me!" on Q
  else if (m.k === "cancel") astraCall.delete(m.id);
  else if (m.k === "arrive" || m.k === "leave") fx.push({ type: "astra", k: m.k, x: m.x, y: m.y, t });
  else if (m.k === "burst") fx.push({ type: "astra", k: "burst", x: m.x, y: m.y, r: m.r, t });   // medic arrives: healing wave around Astra
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
  if (f.k === "burst") {   // a green healing wave rolling out to the edge of the heal radius
    if (age > 700) return false; const k = age / 700, R = f.r * (.15 + .85 * Math.sqrt(k));
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(90,255,150,${.16 * (1 - k)})`; ctx.beginPath(); ctx.ellipse(f.x, f.y + 16, R, R * .55, 0, 0, 7); ctx.fill();
    ctx.lineWidth = 5 * (1 - k) + 1.5; ctx.strokeStyle = `rgba(140,255,180,${.85 * (1 - k)})`; ctx.beginPath(); ctx.ellipse(f.x, f.y + 16, R, R * .55, 0, 0, 7); ctx.stroke();
    ctx.restore(); return true;
  }
  if (f.k === "lock") { if (age > 380) return false; ctx.save(); ctx.strokeStyle = `rgba(120,240,255,${1 - age / 380})`; ctx.lineWidth = 4; ctx.strokeRect(f.x - SAFE.half, f.y - SAFE.half, SAFE.half * 2, SAFE.half * 2); ctx.restore(); return true; }
  if (f.k === "hit") { if (age > 300) return false; const k = age / 300; ctx.save(); ctx.globalAlpha = 1 - k; ctx.fillStyle = "#cfc6b4"; for (let i = 0; i < 5; i++) { const a = i * 1.3 + f.x; ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * 18 * k, f.y - 10 + Math.sin(a) * 10 * k, 3 * (1 - k) + 1, 0, 7); ctx.fill(); } ctx.restore(); return true; }   // chips of concrete
  if (f.k === "fix") { if (age > 800) return false; ctx.save(); ctx.globalAlpha = 1 - age / 800; ctx.font = "bold 14px monospace"; ctx.textAlign = "center"; ctx.fillStyle = "#7dff9a"; ctx.strokeStyle = "#0b2a14"; ctx.lineWidth = 3; ctx.strokeText("+1", f.x, f.y - age / 30); ctx.fillText("+1", f.x, f.y - age / 30); ctx.restore(); return true; }   // a builder patched the wall
  if (f.k === "dismantle") { if (age > 600) return false; for (const pc of safePieces(f.x, f.y, 3, 1 - age / 600)) pc.draw(); return true; }
  return false;
}
const safeFlash = new Map();   // recent wall hits (bar flashes red)
function safeHpBar(st, cx, y) {   // 6 pips above the north wall: how many more hits the walls can take
  const n = st.maxHp || SAFE.hits, gap = n > 12 ? 2 : 3, w = Math.min(14, (220 - gap * (n - 1)) / n), x0 = cx - (n * (w + gap) - gap) / 2, hit = gnow() - Math.max(0, ...[...safeFlash.values()]) < 160;
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(x0 - 3, y - 3, n * (w + gap) - gap + 6, 12);
  for (let i = 0; i < n; i++) { ctx.fillStyle = i < st.hp ? (hit ? "#ff8a7a" : st.hp <= 2 ? "#ff6b5b" : "#8ff0ff") : "rgba(255,255,255,.12)"; ctx.fillRect(x0 + i * (w + gap), y, w, 6); }
  ctx.restore();
}
function drawAstraShield() {   // Astra can't be hurt while his safehouse is being built: a cyan shield ring
  if (!state) return; const now = gnow();
  for (const st of state.structures.values()) {
    if (st.kind !== "safehouse" || !(st.deploy > 0)) continue; const p = V(state.players.get(st.ownerId)); if (!p || !p.alive || !inView(p.x, p.y)) continue;
    ctx.save(); ctx.globalAlpha = .55 + .2 * Math.sin(now / 160); ctx.strokeStyle = "#8ff0ff"; ctx.lineWidth = 2.5; ctx.shadowColor = "#8ff0ff"; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.ellipse(p.x, p.y - 8, 24, 30, 0, 0, 7); ctx.stroke(); ctx.restore();
  }
}
function inSafehouse(p) { if (!state || !p) return false; for (const st of state.structures.values()) if (st.kind === "safehouse" && !(st.deploy > 0) && Math.abs(p.x - st.x) <= SAFE.half && Math.abs(p.y - st.y) <= SAFE.half) return true; return false; }   // a finished safehouse: downed players inside don't bleed out
function safeFrame(st) { return st.deploy > 0 ? (st.deploy > (st.total || SAFE.build) / 2 ? 0 : 1) : 2; }   // foundation, scaffold, complete
function safeAlpha(st) { return st.deploy <= 0 && st.life < 5 && Math.floor(gnow() / 200) % 2 ? .45 : 1; }   // last 5 seconds: flashes
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
  const now = gnow();
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
function regenPlay(id, restart = false) { const now = gnow(), t = regens.get(id); if (restart || t === undefined || now - t > regenLen() * .7) regens.set(id, now); }
function regenKeep(id) { const now = gnow(), t = regens.get(id); if (t === undefined || now - t >= regenLen()) regens.set(id, now); }   // continuous healing: start again when one finishes
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
  const now = gnow(), live = new Set();
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
  const now = gnow();
  for (const [id, t] of regens) {
    const age = now - t; if (age >= regenLen()) { regens.delete(id); continue; }
    const p0 = state.players.get(id), pt = V(p0); if (!pt || !p0.alive || !inView(pt.x, pt.y, 120)) continue;
    items.push({ y: pt.y + 11, draw: () => drawRegen(pt, age, false) });
    items.push({ y: pt.y + 13, draw: () => drawRegen(pt, age, true) });
  }
}
function drawAstraUnit(r) {   // police / doctors / workers: 8-direction sheets like the survivors (idle, walk x3, action x2)
  const now = gnow(), im = aImgs[r.kind]; let mv = robotMove.get(r.id);
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
const MECHA = { cw: 160, ch: 128, ax: 80, fy: 120, call: 1, outMs: 650, range: 190, saber: 120, swing: 900,   // 80px tall = 1.5x a survivor
  nozzle: [[-4, -24], [23, -32], [28, -47], [27, -49], [-2, -45], [-28, -49], [-29, -47], [-22, -31]],   // per direction, from the feet
  tfRow: [0, 1, 4, 5, 5, 5, 3, 2] };   // which transformation row each facing uses (tf rows: down, down-right, down-left, left, right, up)
const mechaOut = new Map(), mechaSlash = new Map(), mechaFlame = new Map(), mechaCall = new Map(), mechaLate = [];
// draws frame f of a strip, cross-fading into frame f2 by k (0..1): smooth in-betweens for the transformation / flame
function blendCells(im, sx, sy, cw, ch, f, f2, k, dx, dy, dw = cw, dh = ch) {
  ctx.drawImage(im, sx + f * cw, sy, cw, ch, dx, dy, dw, dh);
  if (k > .04 && f2 !== f) { const a = ctx.globalAlpha; ctx.globalAlpha = a * k; ctx.drawImage(im, sx + f2 * cw, sy, cw, ch, dx, dy, dw, dh); ctx.globalAlpha = a; }
}   // per player: stepping out, last saber swing, flame state
const mechaFiring = (p, v) => v.phase === "ride" && (p.sessionId === myId ? heliTrigger() && gnow() - (mechaSlash.get(myId)?.t || 0) > MECHA.swing : !!v.fire);
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
  else if (fire || now - fs.at < 200) { col = 6; if (fire) bob = Math.floor(now / 60) % 2; }   // one braced pose (the saber stays still), a 1px recoil shake
  else if (v.mv) col = 2 + Math.floor(now / 120) % 4;
  else col = Math.floor(now / 520) % 2;
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(p.x, feet - 1, 25, 7, 0, 0, 7); ctx.fill(); ctx.restore();
  const flameBehind = Math.sin(aim) < -.35;
  if (flameBehind) drawMechaFlame(p, aim, row, feet, fs, now);
  if (im?.naturalWidth) { ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(im, col * MECHA.cw, swingRow * MECHA.ch, MECHA.cw, MECHA.ch, Math.round(p.x - MECHA.ax), feet - MECHA.fy + bob, MECHA.cw, MECHA.ch); ctx.restore(); }
  if (!flameBehind) mechaLate.push(() => drawMechaFlame(p, aim, row, feet, fs, now));   // over the zombies it's burning (drawn after all sprites)
  if (sAge < 640) { const s0 = sl; mechaLate.push(() => drawSaberSweep(p, s0.a, now - s0.t, feet, s0.flip)); }   // over the zombies it cuts
}
// sofea-flame.webp (tools/bake-flamethrower.py v3, from the Vefects fire VFX): row 0 = 36 frames 336x240 (nozzle at (6, 120),
// jet ~285px of art): 0-7 ignite, 8-27 seamless loop, 28-35 cut off; row 1 (y 240) = each frame's soft glow at half size (168x120)
const JETFX = { cw: 336, ch: 240, nx: 6, len: 285, loop: [8, 20], end: 28, wide: 1.5 };   // wide: stretched sideways so the art's ~42-degree cone covers the 60-degree damage cone
function drawMechaFlame(p, aim, row, feet, fs, now) {   // the jet from her arm's nozzle to the ground 190px out where she aims
  const im = sImgs.flame, J = JETFX; if (!im?.naturalWidth) return;
  const age = now - fs.at; let t, f, f2;   // t = position in frames; each frame cross-fades into the next
  if (fs.on) { if (age < 200) { t = age / 25; f = Math.floor(t); f2 = Math.min(J.loop[0], f + 1); }
    else { t = (age - 200) / 38; f = J.loop[0] + Math.floor(t) % J.loop[1]; f2 = J.loop[0] + (Math.floor(t) + 1) % J.loop[1]; } }
  else { if (age > 300 || !fs.at) return; t = age / 37; f = J.end + Math.min(7, Math.floor(t)); f2 = Math.min(J.end + 7, f + 1); }
  const [nx, ny] = MECHA.nozzle[row], ox = p.x + nx, oy = feet + ny;
  const tx = p.x + Math.cos(aim) * MECHA.range, ty = p.y + Math.sin(aim) * MECHA.range * .92;   // ground point at the end of the cone
  const L = Math.max(60, Math.hypot(tx - ox, ty - oy)), ang = Math.atan2(ty - oy, tx - ox), sc = L / J.len, k = t - Math.floor(t);
  const flick = .85 + .15 * Math.sin(now / 37) * Math.sin(now / 71);
  ctx.save(); ctx.translate(ox, oy); ctx.rotate(ang); ctx.scale(1, J.wide);
  ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = .3 * flick;   // hot light on the ground under the jet
  const g = ctx.createRadialGradient(L * .6, 0, 4, L * .6, 0, L * .6); g.addColorStop(0, "#ff9a3c"); g.addColorStop(1, "rgba(255,80,20,0)"); ctx.fillStyle = g; ctx.fillRect(0, -L * .65, L * 1.25, L * 1.3);
  ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
  blendCells(im, 0, 0, J.cw, J.ch, f, f2, k, -J.nx * sc, -J.ch / 2 * sc, J.cw * sc, J.ch * sc);   // the fire (a wide cone, ~42 degrees like the damage)
  ctx.globalCompositeOperation = "lighter";   // fake bloom: the baked glow, bigger and additive, then a faint bright copy of the flame
  ctx.globalAlpha = .55 * flick; ctx.drawImage(im, f * J.cw / 2, J.ch, J.cw / 2, J.ch / 2, -J.nx * sc - J.cw * sc * .05, -J.ch * .55 * sc, J.cw * sc * 1.1, J.ch * sc * 1.1);
  ctx.globalAlpha = .22; ctx.drawImage(im, f * J.cw, 0, J.cw, J.ch, -J.nx * sc, -J.ch / 2 * sc, J.cw * sc, J.ch * sc);
  ctx.restore();
}
// sofea-slash.webp (tools/extract-saber-slash.py, the user's green energy arc): 8 frames 256x256, the arc bulges UP, its pivot
// (her shoulder) at cell (128, 200), the arc's top ~147px above it. Turned to where she swings, scaled to the saber reach;
// every other swing is mirrored, so she slashes right-to-left, then left-to-right.
const slashImg = new Image(); slashImg.src = "assets/sprites/fx/sofea-slash.webp";
const SLASH = { n: 8, c: 256, px: 128, py: 200, reach: 147, start: 90, ms: 60 };
function drawSaberSweep(p, a, age, feet, flip) {
  if (!slashImg.naturalWidth) return;
  const t = (age - SLASH.start) / SLASH.ms; if (t < 0 || t >= SLASH.n) return;
  const f = Math.floor(t), f2 = Math.min(SLASH.n - 1, f + 1), k = (MECHA.saber * .96) / SLASH.reach, C = SLASH.c;
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.translate(p.x, feet - 38); ctx.rotate(a + Math.PI / 2); ctx.scale(flip ? -k : k, k * .9);   // drawn smaller than the art: crisp
  blendCells(slashImg, 0, 0, C, C, f, f2, t - f, -SLASH.px, -SLASH.py, C, C);
  ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = .5; ctx.drawImage(slashImg, f * C, 0, C, C, -SLASH.px, -SLASH.py, C, C);   // glow
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
  if (f.k === "frag") {   // Marcus: concussion ring around him, then 3 grenades arc out to their spots (the blasts come as "boom")
    const total = (f.pts.length - 1) * f.gap + f.fl; if (s > Math.max(total, .5)) return false;
    if (s < .5) {   // shock ring + dust where he stood
      const k = s / .5, R = (f.br || 150) * (.25 + .75 * Math.sqrt(k));
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineWidth = 8 * (1 - k) + 1.5; ctx.strokeStyle = `rgba(255,190,120,${.9 * (1 - k)})`;
      ctx.beginPath(); ctx.ellipse(f.x, f.y + 14, R, R * .42, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 3 * (1 - k) + .5; ctx.strokeStyle = `rgba(255,255,255,${.8 * (1 - k)})`; ctx.beginPath(); ctx.ellipse(f.x, f.y + 14, R * .82, R * .34, 0, 0, Math.PI * 2); ctx.stroke();
      if (s < .12) { ctx.fillStyle = `rgba(255,220,170,${.6 * (1 - s / .12)})`; ctx.beginPath(); ctx.arc(f.x, f.y, 34, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
      demoFrame(5, Math.min(3, Math.floor(s / .13)), f.x, f.y + 22, .55 * (1 - k), .8);
    }
    f.pts.forEach(([tx, ty], i) => {
      const u = (s - i * f.gap) / f.fl; if (u < 0 || u >= 1) return;
      const dist = Math.hypot(tx - f.x, ty - f.y), gx = f.x + (tx - f.x) * u, gy = f.y - 18 + (ty - f.y + 18) * u - Math.sin(Math.PI * u) * (40 + dist * .25);
      demoFrame(2, Math.min(2, Math.floor(u * 3)), tx, ty + 6, .8, .7);   // landing marker
      demoFrame(1, Math.floor(age / 70) % 4, gx, gy + 32, 1, .65, Math.atan2(ty - f.y, tx - f.x));   // the grenade, spinning
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
const fragHop = new Map();   // Marcus id -> when he threw Frag Barrage (the server hops him back: no prediction for a moment)
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
  const now = gnow(), off = (z.id?.charCodeAt?.(z.id.length - 1) || 0) * 37;
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
  squadWheel = { cx: Math.max(190, Math.min(W - 190, mouse.sx)), cy: Math.max(190, Math.min(H - 190, mouse.sy)), t0: gnow(), aimX: mouse.x, aimY: mouse.y }; firing = false;
}
function squadSliceAt() {
  if (!squadWheel) return -1; const dx = mouse.sx - squadWheel.cx, dy = mouse.sy - squadWheel.cy;
  if (Math.hypot(dx, dy) < 34) return -1;
  return ((Math.round((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI * 2 / 3)) % 3) + 3) % 3;
}
function closeSquadWheel() {
  if (!squadWheel) return; const w = squadWheel; squadWheel = null; const me = me_();
const sel = (() => { const dx = mouse.sx - w.cx, dy = mouse.sy - w.cy; return Math.hypot(dx, dy) < 34 ? -1 : ((Math.round((Math.atan2(dy, dx) + Math.PI / 2) / (Math.PI * 2 / 3)) % 3) + 3) % 3; })();
  const kind = sel >= 0 ? SQUAD_KINDS[sel][0] : gnow() - w.t0 < 250 ? lastRobot : null;
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
  spin: "assets/sprites/zombies/dir8/butcher-spin.webp", stagger: "assets/sprites/zombies/dir8/butcher-stagger.webp",
  hookBreak: "assets/sprites/fx/hook-break.png", burst: "assets/sprites/fx/deflect-burst.png", deflected: "assets/sprites/fx/deflected.png", death: "assets/sprites/zombies/dir8/butcher-death.webp", hookFx: "assets/sprites/fx/butcher-hook.png",
  chain: "assets/sprites/fx/butcher-chain.png", shock: "assets/sprites/fx/butcher-shock.png" })) { const im = new Image(); im.src = url; butcherImgs[k] = im; }
const BCELL = { walk: { w: 345, h: 278, ax: 172, fy: 272 }, chop: { w: 480, h: 375, ax: 240, fy: 369 }, hook: { w: 630, h: 375, ax: 315, fy: 369 }, spin: { w: 495, h: 345, ax: 247, fy: 339 }, stagger: { w: 390, h: 300, ax: 195, fy: 294 } };   // (Nov 12) 1.5x bigger, cut at that size (tools/extract-butcher.py header)
const SHOCK = { w: 300, h: 180, cy: 111, widths: [238, 273, 263, 271] };
const BT = { hookAim: .5, get hookSpeed() { return state?.hookSpeed || 2600; }, hookRange: 480, chopAfter: .65, rings: [105, 205, 300], offset: 80 };   // match BUTCHER on the server
const bossCorpses = [];
const bossMove = new Map(), stompDust = [];   // boss walk tracking + dust puffs from his footsteps
function drawStompDust() {
  const now = gnow();
  for (let i = stompDust.length - 1; i >= 0; i--) {
    const d = stompDust[i], k = (now - d.t) / 450; if (k >= 1) { stompDust.splice(i, 1); continue; }
    ctx.save(); ctx.globalAlpha = .45 * (1 - k); ctx.fillStyle = "#8a8378";
    for (let j = 0; j < 4; j++) { const a = j * 1.6 + d.x; ctx.beginPath(); ctx.ellipse(d.x + Math.cos(a) * (9 + 24 * k), d.y + Math.sin(a) * (3 + 7.5 * k), 7.5 + 6 * k, 4.5 + 3 * k, 0, 0, 7); ctx.fill(); }   // (1.5x with the Butcher)
    ctx.restore();
  }
}
const bAct = new Map();   // boss id -> { act, start } (local clock, so animations play smoothly between server updates)
function actTime(z) {
  let st = bAct.get(z.id); const now = gnow();
  if (!st || st.act !== z.act) { st = { act: z.act, start: now - Math.max(0, (z.actLen || 0) - (z.slam || 0)) * 1000 }; bAct.set(z.id, st); }
  return (now - st.start) / 1000;
}
function bFrame(sheet, frame, row, x, y, feet, flash) {
  const im = butcherImgs[sheet], C = BCELL[sheet]; if (!im?.naturalWidth) return;
  ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.imageSmoothingEnabled = false;
  flashDraw(flash, () => ctx.drawImage(im, frame * C.w, row * C.h, C.w, C.h, -C.ax, feet - C.fy, C.w, C.h)); ctx.restore();
}
function drawChain(x0, y0, x1, y1, withHook = true) {
  const ch = butcherImgs.chain, hk = butcherImgs.hookFx, a = Math.atan2(y1 - y0, x1 - x0), len = Math.hypot(x1 - x0, y1 - y0);
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.translate(x0, y0); ctx.rotate(a);
  if (ch?.naturalWidth) for (let d = 0; d < len - 20; d += ch.width - 6) ctx.drawImage(ch, d, -ch.height / 2);
  if (withHook && hk?.naturalWidth) ctx.drawImage(hk, len - hk.width * .55, -hk.height / 2);
  ctx.restore();
}
function drawButcher(z) {
  const now = gnow(), t = actTime(z), feet = z.radius * .8, row = ROW_OF_OCT[((Math.round((z.aim || 0) / (Math.PI / 4)) % 8) + 8) % 8];
  const flashAt = feel.flash.get(z.id), flash = flashAt && now - flashAt < 90, filter = flash;   // bFrame(..., flash): additive flash, no ctx.filter
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.beginPath(); ctx.ellipse(z.x, z.y + feet, 69, 18, 0, 0, 7); ctx.fill(); ctx.restore();
  if (z.enraged) bossGlow(z.x, z.y - 60, "255,30,30", 165, .5 + .2 * Math.sin(now / 90));   // enraged: red halo behind him
  const handX = z.x + Math.cos(z.aim || 0) * 51, handY = z.y - 78 + Math.sin(z.aim || 0) * 27;   // (1.5x)
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
    else if (d > 10) drawChain(handX, handY, z.x + Math.cos(z.aim) * d, z.y - 45 + Math.sin(z.aim) * d);
  } else if (z.act === "stagger") {   // knocked back by a deflect
    const L = z.actLen || 1.5, f = t < .12 ? 1 : t < L - .35 ? 2 : 3;
    const wob = t < L - .35 ? Math.sin(now / 60) * 4.5 : 0;
    bFrame("stagger", f, row, z.x + wob, z.y, feet, filter);
    if (t < L - .2) { ctx.save(); ctx.font = "bold 14px monospace"; ctx.textAlign = "center"; ctx.fillStyle = "#ffe27a"; ctx.shadowColor = "#000"; ctx.shadowBlur = 3;
      for (let i = 0; i < 3; i++) { const a = now / 220 + i * 2.1; ctx.fillText("✦", z.x + Math.cos(a) * 39, z.y - 215 + Math.sin(a) * 9); } ctx.restore(); }
  } else if (z.act === "spin") {
    const f = t < .15 ? 1 : t < .3 ? 2 : 3 + Math.floor(t * 16) % 5;
    bFrame("spin", f, 0, z.x, z.y, feet, filter);
  } else {
    let st = bossMove.get(z.id); if (!st) { st = { x: z.x, y: z.y, movedAt: 0, dist: 0 }; bossMove.set(z.id, st); }
    const step = Math.hypot(z.x - st.x, z.y - st.y);
    if (step > .3) { st.movedAt = now; st.dist += step; st.x = z.x; st.y = z.y; }
    const moving = now - st.movedAt < 180;
    // frames follow the distance walked (feet don't slide), one full 6-frame cycle per ~90px; heavy stomp: body dips + sways on each footfall
    const cyc = st.dist / 135, frame = moving ? Math.floor(cyc * 6) % 6 : 0, ph = cyc * Math.PI * 2;   // (1.5x: a longer stride)
    const dip = moving ? Math.abs(Math.sin(ph)) * 6 : 0, sway = moving ? Math.sin(ph) * 3 : 0;
    if (moving && Math.floor(cyc * 2) !== st.lastFoot) { st.lastFoot = Math.floor(cyc * 2); stompDust.push({ x: z.x + (st.lastFoot % 2 ? 24 : -24), y: z.y + feet, t: now }); }
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
  const age = (gnow() - c.t) / 1000, im = butcherImgs.death, C = BCELL.spin;
  if (age > 14) { bossCorpses.splice(bossCorpses.indexOf(c), 1); return; }
  if (c.kind !== "butcher" || !im?.naturalWidth) return;
  const f = Math.min(5, Math.floor(age / .2));
  ctx.save(); ctx.globalAlpha = age > 11 ? 1 - (age - 11) / 3 : 1; ctx.imageSmoothingEnabled = false;
  ctx.drawImage(im, f * C.w, 0, C.w, C.h, c.x - C.ax, c.y + 48 - C.fy, C.w, C.h); ctx.restore();   // feet at y + radius(60) * .8
}
// Cleaver Quake on the ground: the crack, then the red, yellow and blue shockwaves one after another.
// Raven's katana slash (sprites/fx/raven-slash.webp, tools/extract-raven-slash.py, the user's violet crescent): 24 frames
// 128x128 in 8 x 3, on black (drawn additively: black = nothing). The crescent bulges RIGHT = the swing direction; Raven at (.38, .55).
const ravenSlashImg = new Image(); ravenSlashImg.src = "assets/sprites/fx/raven-slash.webp";
const RSLASH = { n: 24, c: 128, ms: 17, ax: .38, ay: .55, reach: 73 };
let ravenSlashFlip = false;
function drawRavenSlash(f, age) {   // false when finished; every other swing is mirrored (a cut one way, then back)
  const R = RSLASH, t = age / R.ms; if (t >= R.n) return false;
  if (f.flip === undefined) { f.flip = ravenSlashFlip; ravenSlashFlip = !ravenSlashFlip; }
  const i = Math.floor(t), i2 = Math.min(R.n - 1, i + 1), k = (f.r || 96) * 1.15 / R.reach, C = R.c;
  ctx.save(); ctx.translate(f.x, f.y - 6); ctx.rotate(f.a); ctx.scale(k, f.flip ? -k : k); ctx.globalCompositeOperation = "lighter"; ctx.imageSmoothingEnabled = true;
  const cell = n => [(n % 8) * C, Math.floor(n / 8) * C];
  const [sx, sy] = cell(i), [sx2, sy2] = cell(i2);
  ctx.globalAlpha = 1 - (t - i) * .5; ctx.drawImage(ravenSlashImg, sx, sy, C, C, -R.ax * C, -R.ay * C, C, C);
  ctx.globalAlpha = (t - i) * .5 + .15; ctx.drawImage(ravenSlashImg, sx2, sy2, C, C, -R.ax * C, -R.ay * C, C, C);
  ctx.restore(); return true;
}
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
const DASH_MS = 520, dashBeams = [], dodgeAt = new Map();   // dodgeAt: when each player last dashed (0.25s untouchable)
function dashBeam(id, x0, y0, x1, y1) {
  const p = state?.players?.get(id); if (p) dodgeAt.set(id, gnow()); if (!p || Math.hypot(x1 - x0, y1 - y0) < 6) return;
  dashBeams.push({ x0, y0: y0 - 14, x1, y1: y1 - 14, t: gnow(), fx: DASH_FX[p.characterClass] || DASH_FX.assault, seed: Math.random() * 100 });
  if (p.characterClass === "assault") marcusDash.set(id, { t0: gnow(), a: Math.atan2(y1 - y0, x1 - x0) });   // his dash body frames
  if (dashBeams.length > 24) dashBeams.shift();
}
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
function drawDashBeams() {
  const now = gnow();
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
  drawPyreGround(); drawScreamerGround(); drawAbomGround(); drawAbomFlames();
  drawDashBeams();
  const sh = butcherImgs.shock; if (!sh?.naturalWidth) return;
  const now = gnow();
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
  const t = gnow();
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
  const now = gnow();
  if (!whipStart.has(z.id)) whipStart.set(z.id, now - (WHIP_T.total - z.slam) * 1000);
  const t = (now - whipStart.get(z.id)) / 1000;
  let frame = 0; for (const [t0, f] of WHIP_T.frames) if (t >= t0) frame = f;
  const tg = state.players.get(z.targetId), face = tg ? Math.atan2(tg.y - z.y, tg.x - z.x) : zombieAngle(z);
  const row = ROW_OF_OCT[((Math.round(face / (Math.PI / 4)) % 8) + 8) % 8], feet = z.radius ? z.radius * 0.8 : 12, C = ZD8_CELLS.mutant;
  const charging = t < .38, flash = feel.flash.get(z.id), flashing = flash && now - flash < 90, g = .5 + .5 * Math.sin(now / 45);
  if (charging) bossGlow(z.x, z.y - 14, "255,40,70", 40 + 10 * g, .45 + .35 * g);   // glowing red while it coils: your warning (a mutant horde used to be a drop-shadow filter per mutant per frame)
  ctx.save(); ctx.translate(Math.round(z.x), Math.round(z.y)); ctx.imageSmoothingEnabled = false;
  const shake = charging ? (Math.random() - .5) * 2.5 : 0;
  const cell = () => ctx.drawImage(img8, frame * C.cellW, row * C.cellH, C.cellW, C.cellH, -C.anchorX + shake, feet - C.feetY, C.cellW, C.cellH);
  flashDraw(flashing, cell);
  if (charging && !flashing) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = .3 * g; cell(); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; }   // brightens as it coils
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
  let st = zAtk.get(z.id); const cd = z.attackCooldown ?? 0, now = gnow();
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
  const now = gnow(), info = ZTYPE[z.kind] || ZTYPE.walker;
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
  flashDraw(flash && now - flash < 90, () => ctx.drawImage(img, frame * ZSPR.cellW, 0, ZSPR.cellW, ZSPR.cellH, -ZSPR.anchorX, feet - ZSPR.cellH, ZSPR.cellW, ZSPR.cellH));
  ctx.restore();
  return { feet, h: info.h };
}
function drawZombieDir8(z, img8, side) {
  const now = gnow(), info = ZTYPE[z.kind] || ZTYPE.walker, a = zombieAngle(z);
  if (z.kind === "mutant" && z.slam > 0 && img8.naturalWidth) return drawMutantWhip(z, img8, info);
  if (z.kind === "brute" && z.slam > 0 && slamImg.naturalWidth) {          // brute ground slam
    if (!slamStart.has(z.id)) slamStart.set(z.id, now - (SLAM_T.total - z.slam) * 1000);
    const t = (now - slamStart.get(z.id)) / 1000;
    const frame = t < .25 ? 0 : t < .5 ? 1 : t < SLAM_T.windup ? 2 : t < SLAM_T.windup + .15 ? 3 : t < SLAM_T.windup + .38 ? 4 : 5;
    const row = ROW_OF_OCT[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8], feet = z.radius ? z.radius * 0.8 : 12, C = SLAM_CELL;
    ctx.save(); ctx.translate(Math.round(z.x), Math.round(z.y)); ctx.imageSmoothingEnabled = false;
    const flash = feel.flash.get(z.id);
    flashDraw(flash && now - flash < 90, () => ctx.drawImage(slamImg, frame * C.cellW, row * C.cellH, C.cellW, C.cellH, -C.anchorX, feet - C.feetY, C.cellW, C.cellH));
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
  const flash = feel.flash.get(z.id);
  const C = ZD8_CELLS[z.kind] || ZD8_CELLS.runner;
  flashDraw(flash && now - flash < 90, () => ctx.drawImage(img8, frame * C.cellW, row * C.cellH, C.cellW, C.cellH, -C.anchorX, feet - C.feetY - bob, C.cellW, C.cellH));
  if (anim.claw !== undefined && attacking && since > .14 && since < .46) {   // claw marks flash in front of it
    const k = (since - .14) / .32; ctx.filter = "none"; ctx.globalAlpha = 1 - k * k;
    ctx.drawImage(img8, anim.claw * C.cellW, row * C.cellH, C.cellW, C.cellH, -C.anchorX + Math.cos(face) * 38, feet - C.feetY - 10 + Math.sin(face) * 24, C.cellW, C.cellH);
  }
  ctx.restore();
  return { feet, h: info.h };
}
function drawZombieAny(z) {
  if (z.kind === "minebeast") return drawMineBeast(z);
  if (z.kind === "hivemind") return drawHivemind(z);
  if (z.kind === "butcher" && butcherImgs.walk.naturalWidth) return drawButcher(z);
  if (z.kind === "pyre" && pyImgs.walk.naturalWidth) return drawPyre(z);
  if (z.kind === "screamer" && scrImgs.walk.naturalWidth) return drawScreamer(z);
  if (z.kind === "abomination" && abImgs.slam.naturalWidth) return drawAbomination(z);
  if (z.kind === "abomSpawn" && abImgs.srun.naturalWidth) return drawAbomSpawn(z);
  const img = zombieImgs[z.kind], img8 = zdir8[z.kind];
  if (!img || !img.complete || !img.naturalWidth) { drawZombie(z); drawHitFlash(z); return; }   // bosses (no art yet) use the old drawing
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(z.x, z.y + (z.radius || 14) * 0.8, (z.radius || 14) * 1.05, 4, 0, 0, 7); ctx.fill(); ctx.restore();
  if (z.kind === "brute" && z.slam > 0) {   // danger zone: fills up during the wind-up so you can get out
    const st = slamStart.get(z.id), t = st ? (gnow() - st) / 1000 : SLAM_T.total - z.slam, k = Math.max(0, Math.min(1, t / SLAM_T.windup));
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
function addCorpse(p) { if (!zombieImgs[p.kind]) return; corpses.push({ ...p, t: gnow() }); if (corpses.length > 40) corpses.shift(); }
function drawCorpses() {
  const now = gnow();
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
function shake(power,ms){const now=gnow();if(now+ms>feel.shakeUntil)feel.shakeUntil=now+ms;feel.shakePow=Math.max(feel.shakePow*(now<feel.shakeUntil?1:0),power);}
function shakeOffset(){const now=gnow();if(now>feel.shakeUntil||matchMedia("(prefers-reduced-motion: reduce)").matches){feel.shakePow=0;return{x:0,y:0};}const k=feel.shakePow;return{x:(Math.random()-.5)*k,y:(Math.random()-.5)*k};}
function updateFeel(){
 if(!state)return;const now=gnow(),seen=new Set();
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
 for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,s=40+Math.random()*(big?220:120);feel.parts.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,t:gnow(),life:350+Math.random()*250,c:Math.random()<.6?'#6f8a3c':'#2f3b22',sz:big?4:3});}
 feel.stains.push({x,y,r:(big?26:10)+Math.random()*6,t:gnow()});if(feel.stains.length>60)feel.stains.shift();
 if(big)shake(9,420);
}
// Burnt craters left by rockets and grenades (art: fx/dante-scorch.png). They don't stay long: 5s, then fade over 2s.
// kind "hot": rocket / crate blast (starts glowing, cools down); "big": big grenade; "small": small grenade.
const scorches = [];
function scorch(x, y, s = 1, kind = "hot") { scorches.push({ x, y, s, kind, v: Math.floor(Math.random() * 4), flip: Math.random() < .5, t: gnow() }); if (scorches.length > 70) scorches.shift(); }
function drawScorches() {
  const now = gnow(), im = dImgs.scorch; if (!im?.naturalWidth) return;
  for (let i = scorches.length - 1; i >= 0; i--) {
    const c = scorches[i], age = (now - c.t) / 1000; if (age > 7) { scorches.splice(i, 1); continue; }
    const row = c.kind === "hot" ? 2 : c.kind === "big" ? 0 : 1, col = c.kind === "hot" ? Math.min(3, Math.floor(age / .7)) : c.v;
    const sc = c.s * (c.kind === "small" ? .55 : .7);
    ctx.save(); ctx.globalAlpha = Math.min(1, age * 6) * (age > 5 ? 1 - (age - 5) / 2 : 1); ctx.imageSmoothingEnabled = false;
    ctx.translate(c.x, c.y + 6); if (c.flip) ctx.scale(-1, 1); ctx.scale(sc, sc);
    ctx.drawImage(im, col * 180, row * 110, 180, 110, -90, -55, 180, 110); ctx.restore();
  }
}
function drawStains(){drawScorches();const now=gnow();for(let i=feel.stains.length-1;i>=0;i--){const s=feel.stains[i],age=(now-s.t)/1000;if(age>25){feel.stains.splice(i,1);continue;}
 ctx.save();ctx.globalAlpha=.32*(1-age/25);ctx.fillStyle='#3b4a24';ctx.beginPath();ctx.ellipse(s.x,s.y+4,s.r,s.r*.6,0,0,7);ctx.fill();ctx.restore();}}
function drawHitFlash(z){const t=feel.flash.get(z.id);if(!t)return;const age=gnow()-t;if(age>90)return;
 ctx.save();ctx.globalAlpha=.75*(1-age/90);ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(z.x,z.y-z.radius*.3,z.radius*(z.boss?1.4:1.05),0,7);ctx.fill();ctx.restore();}
function drawFeel(){
 const now=gnow(),dt=1/60;
 for(let i=feel.parts.length-1;i>=0;i--){const p=feel.parts[i],age=now-p.t;if(age>p.life){feel.parts.splice(i,1);continue;}
  p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=.9;p.vy*=.9;ctx.globalAlpha=1-age/p.life;ctx.fillStyle=p.c;ctx.fillRect(p.x-p.sz/2,p.y-p.sz/2,p.sz,p.sz);}
 ctx.globalAlpha=1;ctx.textAlign='center';
 for(let i=feel.nums.length-1;i>=0;i--){const n=feel.nums[i],age=now-n.t;if(age>700){feel.nums.splice(i,1);continue;}
  const k=age/700,big=n.v>=40;ctx.globalAlpha=1-k*k;ctx.font=`bold ${big?16:12}px monospace`;ctx.lineWidth=3;ctx.strokeStyle='#0b0f10';
  const txt=String(Math.round(n.v)),y=n.y-k*26;ctx.strokeText(txt,n.x,y);ctx.fillStyle=n.boss?'#ff8a6a':big?'#ffd27a':'#f3ead6';ctx.fillText(txt,n.x,y);}
 ctx.globalAlpha=1;
}
function drawHurt(){const now=gnow();if(now>feel.hurtUntil)return;const k=(feel.hurtUntil-now)/220;
 const g=ctx.createRadialGradient(W/2,H/2,H*.35,W/2,H/2,H*.75);g.addColorStop(0,'rgba(200,30,30,0)');g.addColorStop(1,`rgba(200,30,30,${.45*k})`);ctx.fillStyle=g;ctx.fillRect(0,0,W,H);}

// SIENNA's DEAD EYE (Nov 9): a thick glacier-blue beam down the aimed line, a muzzle flare, and a burst on every zombie it went through
function drawDeadEye(f, age) {
  if (age > 520) return false;
  const k = age / 520, c = Math.cos(f.a), s = Math.sin(f.a), x0 = f.x + c * 20, y0 = f.y + s * 20, x1 = f.x + c * f.len, y1 = f.y + s * f.len;
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
  for (const [w, col] of [[18 * (1 - k) + 4, `rgba(120,200,255,${.35 * (1 - k)})`], [7 * (1 - k) + 2, `rgba(190,240,255,${.8 * (1 - k)})`], [2.5, `rgba(255,255,255,${1 - k})`]]) {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  if (age < 140) { const g = ctx.createRadialGradient(x0, y0, 2, x0, y0, 46); g.addColorStop(0, `rgba(255,255,255,${1 - age / 140})`); g.addColorStop(1, "rgba(120,200,255,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x0, y0, 46, 0, 7); ctx.fill(); }
  for (const t of f.hits || []) {   // a burst of ice-blue shards on each zombie it hit
    const hx = f.x + c * t, hy = f.y + s * t - 16, r = 10 + 34 * k;
    ctx.fillStyle = `rgba(170,230,255,${.55 * (1 - k)})`; ctx.beginPath(); ctx.arc(hx, hy, r * .6, 0, 7); ctx.fill();
    ctx.strokeStyle = `rgba(230,250,255,${1 - k})`; ctx.lineWidth = 2;
    for (let q = 0; q < 8; q++) { const qa = q * Math.PI / 4 + f.a; ctx.beginPath(); ctx.moveTo(hx + Math.cos(qa) * r * .35, hy + Math.sin(qa) * r * .35); ctx.lineTo(hx + Math.cos(qa) * r, hy + Math.sin(qa) * r); ctx.stroke(); }
  }
  ctx.restore(); return true;
}
// SHOTGUN (Nov 9): a muzzle blast cone (a burst of fire the width of the spread + a puff of smoke) and a pellet spray
// (5 glowing pellets that fly out to where each stopped - its last zombie or a wall - with a spark puff there, plus loose sparks in the cone)
function drawShotgunFx(f, age) {   // false when finished
  if (age > 650) return false;
  const n = f.a.length, aim = f.a[(n - 1) >> 1], mx = f.x + Math.cos(aim) * 18, my = f.y + Math.sin(aim) * 18, rnd = i => { const v = Math.sin(f.seed * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
  if (age < 120) {   // MUZZLE BLAST: a fan of fire as wide as the pellet spread, white-hot at the barrel
    const k = age / 120, L = 44 + 46 * Math.min(1, age / 40), spread = (f.a[n - 1] - f.a[0]) / 2 + .22;
    const g = ctx.createRadialGradient(mx, my, 2, mx, my, L); g.addColorStop(0, `rgba(255,250,220,${1 - k})`); g.addColorStop(.35, `rgba(255,200,90,${.85 * (1 - k)})`); g.addColorStop(1, "rgba(255,90,20,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(mx, my); ctx.arc(mx, my, L, aim - spread, aim + spread); ctx.closePath(); ctx.fill();
    for (let j = 0; j < 5; j++) {   // ragged tongues of flame
      const ta = aim + (rnd(j) - .5) * spread * 2, tl = L * (.7 + .5 * rnd(j + 9)), w = .07 + .05 * rnd(j + 4);
      ctx.fillStyle = `rgba(255,${150 + 80 * rnd(j + 2)},60,${.7 * (1 - k)})`; ctx.beginPath(); ctx.moveTo(mx + Math.cos(ta - w) * 6, my + Math.sin(ta - w) * 6);
      ctx.lineTo(mx + Math.cos(ta) * tl, my + Math.sin(ta) * tl); ctx.lineTo(mx + Math.cos(ta + w) * 6, my + Math.sin(ta + w) * 6); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = `rgba(255,255,235,${1 - k})`; ctx.beginPath(); ctx.arc(mx, my, 10 * (1 - k) + 3, 0, 7); ctx.fill();
  }
  for (let j = 0; j < 7; j++) {   // loose sparks thrown into the cone
    const life = 150 + 80 * rnd(j + 20); if (age > life) continue; const k = age / life, sa = aim + (rnd(j + 30) - .5) * .7, d = 20 + (60 + 90 * rnd(j + 40)) * Math.sqrt(k);
    const x = mx + Math.cos(sa) * d, y = my + Math.sin(sa) * d; ctx.strokeStyle = `rgba(255,${190 + 50 * rnd(j)},110,${1 - k})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x - Math.cos(sa) * 6, y - Math.sin(sa) * 6); ctx.lineTo(x, y); ctx.stroke();
  }
  f.a.forEach((a, j) => {   // PELLET SPRAY: each pellet flies out to where it stopped, a bright streak with a fading trail, then sparks there
    const len = f.len[j], fly = 40 + 70 * len / 390, c = Math.cos(a), s = Math.sin(a);
    if (age < fly + 60) {
      const p = Math.min(1, age / fly), head = 18 + (len - 18) * p, tail = Math.max(18, head - 46), fade = age < fly ? 1 : 1 - (age - fly) / 60;
      const g = ctx.createLinearGradient(f.x + c * tail, f.y + s * tail, f.x + c * head, f.y + s * head); g.addColorStop(0, "rgba(255,150,60,0)"); g.addColorStop(1, `rgba(255,235,170,${.95 * fade})`);
      ctx.strokeStyle = g; ctx.lineWidth = 3.2; ctx.beginPath(); ctx.moveTo(f.x + c * tail, f.y + s * tail); ctx.lineTo(f.x + c * head, f.y + s * head); ctx.stroke();
      if (age < fly) { ctx.fillStyle = "rgba(255,250,220,.95)"; ctx.beginPath(); ctx.arc(f.x + c * head, f.y + s * head, 2.4, 0, 7); ctx.fill(); }
    }
    const e = age - fly; if (e < 0 || e > 200) return;   // impact: a little spark puff where it stopped
    const k = e / 200, hx = f.x + c * len, hy = f.y + s * len;
    ctx.fillStyle = `rgba(255,200,110,${.5 * (1 - k)})`; ctx.beginPath(); ctx.arc(hx, hy, 3 + 7 * k, 0, 7); ctx.fill();
    for (let q = 0; q < 4; q++) { const sa = a + Math.PI + (rnd(j * 7 + q) - .5) * 2.4, d = 4 + 14 * k; ctx.strokeStyle = `rgba(255,220,140,${1 - k})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(hx + Math.cos(sa) * d * .4, hy + Math.sin(sa) * d * .4); ctx.lineTo(hx + Math.cos(sa) * d, hy + Math.sin(sa) * d); ctx.stroke(); }
  });
  ctx.globalCompositeOperation = "source-over";   // a puff of gun smoke drifting off the barrel
  for (let j = 0; j < 4; j++) {
    const st = 30 + j * 25; if (age < st) continue; const k = Math.min(1, (age - st) / 560), d = 14 + 26 * k + 10 * j, sa = aim + (rnd(j + 50) - .5) * .5;
    ctx.fillStyle = `rgba(150,145,140,${.22 * (1 - k)})`; ctx.beginPath(); ctx.arc(mx + Math.cos(sa) * d, my + Math.sin(sa) * d - 12 * k, 6 + 14 * k, 0, 7); ctx.fill();
  }
  ctx.restore(); return true;
}
// Bullet tracers, muzzle flashes and launcher blasts (sent by the server for every player's shots).
const TRACER={pistol:'#ffe7a3',smg:'#ffd27a',rifle:'#ffcf66',shotgun:'#ffb05a',sniper:'#bff3ff',launcher:'#ff8a3d'};
function drawShotFx(){
  const now=gnow();
  drawPyreBurning();
  for(let i=fx.length-1;i>=0;i--){const f=fx[i],age=now-f.t;if(!['spit','chop','clang','deflect','wreck','laser','healfx','summon','raven','dante','hive','sofea','briggs','astra','pyre','scream','abom','shotgun','deadeye'].includes(f.type)&&age>(f.type==='boom'?380:f.type==='slam'?520:f.type==='swing'?(f.m==='katana'?420:f.heavy?280:160):140)){fx.splice(i,1);continue;}
   if(f.type==='chop')continue;
   if(f.type==='wreck'||f.type==='laser'||f.type==='healfx'||f.type==='summon'){if(!drawViktorFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='raven'){if(!drawRavenFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='dante'){if(!drawDanteFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='sofea'){if(!drawSofeaFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='briggs'){if(!drawBriggsFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='astra'){if(!drawAstraFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='hive'){if(!drawHiveFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='plateBurst'||f.type==='plateGot'){if(!drawPlateFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='pyre'){if(!drawPyreFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='scream'){if(!drawScreamerFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='abom'){if(!drawAbomFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='shotgun'){if(!drawShotgunFx(f,age))fx.splice(i,1);continue;}
   if(f.type==='deadeye'){if(!drawDeadEye(f,age))fx.splice(i,1);continue;}
   if(f.type==='deflect'){if(!drawDeflect(f,age))fx.splice(i,1);continue;}   // drawn on the ground (drawGroundFx)
   if(f.type==='clang'){if(age>320){fx.splice(i,1);continue;}const k=age/320;ctx.save();ctx.globalAlpha=1-k;ctx.strokeStyle='#fff6d0';ctx.lineWidth=2;for(let j=0;j<6;j++){const a=j*1.05+f.x;ctx.beginPath();ctx.moveTo(f.x+Math.cos(a)*4,f.y+Math.sin(a)*4);ctx.lineTo(f.x+Math.cos(a)*(8+16*k),f.y+Math.sin(a)*(8+16*k));ctx.stroke();}ctx.font='bold 11px monospace';ctx.textAlign='center';ctx.fillStyle='#d8e4ff';ctx.fillText('ARMOR',f.x,f.y-12-10*k);ctx.restore();continue;}
   if(f.type==='spit'){if(drawSpit(f,age))continue;fx.splice(i,1);continue;}
   if(f.type==='slam'){const k=age/520;ctx.save();ctx.globalAlpha=.7*(1-k);ctx.strokeStyle='#e8d2a6';ctx.lineWidth=6*(1-k)+2;ctx.beginPath();ctx.ellipse(f.x,f.y+20,f.r*(.3+.8*k),f.r*.5*(.3+.8*k),0,0,7);ctx.stroke();ctx.restore();continue;}
   ctx.save();
   if(f.type==='shot'){const k=1-age/140,col=TRACER[f.w]||'#ffcf66',lw=f.w==='sniper'?3:2;ctx.lineCap='round';
    ctx.beginPath();for(let j=0;j<f.a.length;j++){const a=f.a[j];ctx.moveTo(f.x+Math.cos(a)*16,f.y+Math.sin(a)*16);ctx.lineTo(f.x+Math.cos(a)*f.len[j],f.y+Math.sin(a)*f.len[j]);}
    ctx.globalAlpha=k*.35;ctx.strokeStyle=col;ctx.lineWidth=lw+5;ctx.stroke();   // the glow: a wide soft pass (no shadowBlur: that was a blur per bullet, every frame)
    ctx.globalAlpha=k;ctx.lineWidth=lw;ctx.stroke();
    if(age<60){ctx.fillStyle='#fff3c4';ctx.beginPath();ctx.arc(f.x+Math.cos(f.a[0])*20,f.y+Math.sin(f.a[0])*20,5,0,7);ctx.fill();}}
   else if(f.type==='swing'&&f.m==='katana'&&ravenSlashImg.naturalWidth){if(!drawRavenSlash(f,age)){ctx.restore();fx.splice(i,1);continue;}}
   else if(f.type==='swing'){const life=f.heavy?280:160;if(age>life){ctx.restore();fx.splice(i,1);continue;}const k=age/life,lw=f.heavy?9:4;ctx.lineCap='round';ctx.beginPath();ctx.arc(f.x,f.y,f.r*(.75+.25*k),f.a-f.arc*(1-k*.4),f.a+f.arc*(1-k*.4));
    ctx.globalAlpha=.3*(1-k);ctx.strokeStyle='#ffffff';ctx.lineWidth=lw+8;ctx.stroke();ctx.globalAlpha=.8*(1-k);ctx.strokeStyle=f.heavy?'#ffd9a0':'#f3f6f2';ctx.lineWidth=lw;ctx.stroke();}
   else{const k=age/380;ctx.beginPath();ctx.arc(f.x,f.y,f.r*(.35+.65*k),0,7);ctx.globalAlpha=.35*(1-k);ctx.strokeStyle='#ff8a3d';ctx.lineWidth=14;ctx.stroke();ctx.globalAlpha=1-k;ctx.lineWidth=4;ctx.stroke();ctx.fillStyle='rgba(255,170,80,.25)';ctx.fill();}
   ctx.restore();}
}
function drawCrosshair(){
  const me=V(state?.players.get(myId));if(!me||!me.alive||state.phase!=='playing'||wheel)return;
  ctx.save();const a=aimAngle(me);
  ctx.strokeStyle='rgba(255,181,109,.28)';ctx.setLineDash([4,6]);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(me.x+Math.cos(a)*22,me.y-4+Math.sin(a)*22);ctx.lineTo(me.x+Math.cos(a)*90,me.y-4+Math.sin(a)*90);ctx.stroke();ctx.setLineDash([]);
  ctx.restore();   // (the ring itself is drawn last, on top of the night: drawReticle)
}
function drawReticle(){   // Nov 12: the crosshair is always visible, even in the dark: drawn in screen space after the night layer, with a dark outline under it
  const me=V(state?.players.get(myId));if(!me||!me.alive||state.phase!=='playing'||wheel)return;
  const x=mouse.sx,y=mouse.sy,r=firing?7:9,ticks=()=>{ctx.beginPath();ctx.arc(x,y,r,0,7);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){ctx.moveTo(x+dx*12,y+dy*12);ctx.lineTo(x+dx*17,y+dy*17);}ctx.stroke();};
  ctx.save();ctx.lineCap='round';
  ctx.strokeStyle='rgba(0,0,0,.7)';ctx.lineWidth=4.5;ticks();
  ctx.shadowColor='rgba(255,170,80,.75)';ctx.shadowBlur=nightK>.2?6:0;ctx.strokeStyle=firing?'#ffe0a8':'#ffbf7a';ctx.lineWidth=2;ticks();
  ctx.shadowBlur=0;ctx.fillStyle='#fff3dc';ctx.fillRect(Math.round(x)-1,Math.round(y)-1,2,2);
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
  const now = gnow(); let a = anim.get(p.sessionId);
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
    const t = gnow() / 260;
    ctx.save(); ctx.font = "bold 13px monospace"; ctx.textAlign = "center"; ctx.fillStyle = "#ffe27a"; ctx.shadowColor = "#000"; ctx.shadowBlur = 3;
    for (let i = 0; i < 3; i++) { const a = t + i * 2.1; ctx.fillText("✦", p.x + Math.cos(a) * 14, p.y - 52 + Math.sin(a) * 4); }
    ctx.restore();
  }
  // Fire axe charge ring: fills over 1 second, pulses orange when the heavy swing is ready
  const mine = p.sessionId === myId && axeChargeAt && p.activeSlot === 1 && p.melee === "axe";
  if (p.alive && (mine || p.charging)) {
    const k = mine ? Math.min(1, (gnow() - axeChargeAt) / AXE_CHARGE_MS) : 1, full = k >= 1;
    ctx.save(); ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.45)";
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 14, 20, 8, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = full ? `rgba(255,${150 + 60 * Math.sin(gnow() / 70)},60,1)` : "#ffd9a0";
    if (full) { ctx.shadowColor = "#ff9a3c"; ctx.shadowBlur = 12; }
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 14, 20, 8, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
    ctx.restore();
  }
  const rideV = state?.vehicles?.get(p.sessionId), nameLift = rideV?.kind === "mecha" ? 46 + 26 * (rideV.phase === "ride" ? 1 : Math.max(0, 1 - rideV.left)) : rideV?.phase === "ride" ? (rideV.kind === "heli" ? 116 : 76) : 46;   // above Sofea's tank / helicopter / mecha
  drawLabel(p.name + (p.sessionId === myId ? " (YOU)" : ""), p.x, p.y - nameLift, "#f2ead9");
  if (awayIds.has(p.sessionId)) drawLabel("RECONNECTING…", p.x, p.y - nameLift - 13, "#9fd8ff");   // their connection dropped: the server holds the seat 30s
  if (!p.alive) { const safe = !p.bledOut && inSafehouse(p); drawLabel(p.bledOut ? "BLED OUT · BACK NEXT WAVE" : safe ? "DOWN · SAFE (PAUSED " + Math.ceil(p.bleedout || 0) + "s) · F TO REVIVE" : "DOWN " + Math.ceil(p.bleedout || 0) + "s · F TO REVIVE", p.x, p.y + 32, safe ? "#8ff0ff" : "#ff7568"); }
}
// Name tags: text is rasterised once per (string, colour) and blitted after that (fillText for every survivor every frame added up).
const labelCache = new Map();
function drawLabel(text, x, y, color) {
  const key = color + "|" + text; let c = labelCache.get(key);
  if (!c) {
    if (labelCache.size > 200) labelCache.clear();
    const m = document.createElement("canvas"), g = m.getContext("2d"); g.font = "11px monospace"; const w = Math.ceil(g.measureText(text).width) + 4;
    m.width = w; m.height = 16; const g2 = m.getContext("2d"); g2.font = "11px monospace"; g2.textAlign = "center"; g2.textBaseline = "alphabetic"; g2.fillStyle = color; g2.fillText(text, w / 2, 12);
    c = m; labelCache.set(key, c);
  }
  ctx.drawImage(c, Math.round(x - c.width / 2), Math.round(y - 12));
}
const awayIds = new Set();   // survivors whose connection dropped (server "away" messages)
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
  operator: { url: "assets/sprites/dir8/operator.png", blocks: ["gun", "knife", "bat", "axe", "radio"],   // Sofea: "radio" = her call for the tank / helicopter (4 frames)
    fix: { all: { 2: [6, 1] } } },   // (Nov 12) her right-facing walk barely moves its feet: facing right = her left row, mirrored
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
// Marcus's dash body (user's sheet, tools/extract-marcus-dash.py): 5 frames x 8 directions, dir8-sized cells; plays for 300ms.
const marcusDashImg = new Image(); marcusDashImg.src = "assets/sprites/dir8/assault-dash.webp";
const marcusDash = new Map();   // player id -> { t0, a }
function drawMarcusDash(p, now) {
  const d = marcusDash.get(p.sessionId), age = d ? now - d.t0 : 1e9;
  if (age >= 300 || !p.alive || !marcusDashImg.naturalWidth) return false;
  if (p.skillT > 0) marcusRush(p, now, false);   // keep the Combat Rush aura on while dashing
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y)); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(marcusDashImg, Math.min(4, Math.floor(age / 60)) * D8.cellW, octRow(d.a) * D8.cellH, D8.cellW, D8.cellH, -D8.anchorX, SPR.feet - D8.feetY, D8.cellW, D8.cellH);
  ctx.restore();
  if (p.skillT > 0) marcusRush(p, now, true);
  return true;
}
function drawSurvivorDir8(p, pose, img) {
  const now = gnow(), a = animState(p);
  if (p.characterClass === "assault" && drawMarcusDash(p, now)) return true;
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
  const rush = p.characterClass === "assault" && p.skillT > 0 && p.alive; if (rush) marcusRush(p, now, false);
  let flip = 0; const fix = DIR8[p.characterClass].fix, rowFix = fix && (fix[DIR8[p.characterClass].blocks[blk]] || fix.all);
  if (rowFix?.[row]) [row, flip] = rowFix[row];
  ctx.save(); ctx.translate(Math.round(p.x), Math.round(p.y));
  if (!p.alive) { ctx.rotate(Math.PI / 2 * 0.9); ctx.globalAlpha = .55; ctx.filter = "grayscale(1)"; }
  else if (p.shadow > 0) ravenHidden(p);
  else if (awayIds.has(p.sessionId)) ctx.globalAlpha = .55;   // reconnecting: faded out, frozen where they stood
  if (flip) ctx.scale(-1, 1);   // mirrored diagonal (the cell is centred on the feet, so it flips in place)
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, col * D8.cellW, (blk * 8 + row) * D8.cellH, D8.cellW, D8.cellH, -D8.anchorX, SPR.feet - D8.feetY, D8.cellW, D8.cellH);
  ctx.restore();
  if (p.characterClass === "juggernaut" && p.ultActive > 0 && p.alive) briggsFire(p, now, true);   // burning ring in front
  if (p.characterClass === "juggernaut" && p.skillT > 0 && p.alive) briggsDome(p, now);
  if (rush) marcusRush(p, now, true);
  return true;
}

function drawSurvivorSprite(p, pose) {
  const d8 = dir8[p.characterClass];
  if (d8 && d8.complete && d8.naturalWidth) return drawSurvivorDir8(p, pose, d8);
  const img = sprites[p.characterClass];
  if (!img || !img.complete || !img.naturalWidth) return false;
  const now = gnow(), a = animState(p);
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
  const dodge=gnow()-(dodgeAt.get(p.sessionId)||-1e9)<250;   // 0.25s dash dodge: see-through flicker (nothing can hurt them)
  if(dodge){ctx.save();ctx.globalAlpha=.45+.25*Math.sin(gnow()/22);}
  if(p.armor===2&&p.alive)plateAura(p,false);
  const drew=drawSurvivorSprite(p,pose); if(drew){drawHeldItem(p,pose);}
  if(p.armor===2&&p.alive)plateAura(p,true);
  if(dodge)ctx.restore();
  if(drew){drawSurvivorLabels(p);return;}
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
  tower: "assets/sprites/objects/tower.png", generator: "assets/sprites/objects/generator.png", barricade: "assets/sprites/objects/barricade-d.png", fence: "assets/sprites/objects/fence-d.png",
  turret: "assets/sprites/objects/turret.png", mine: "assets/sprites/objects/mine.png",
  barricade_r: "assets/sprites/objects/barricade-r.png", barricade_dr: "assets/sprites/objects/barricade-dr.png", barricade_d: "assets/sprites/objects/barricade-d.png", barricade_dl: "assets/sprites/objects/barricade-dl.png", barricade_l: "assets/sprites/objects/barricade-l.png", barricade_ul: "assets/sprites/objects/barricade-ul.png", barricade_u: "assets/sprites/objects/barricade-u.png", barricade_ur: "assets/sprites/objects/barricade-ur.png", fence_r: "assets/sprites/objects/fence-r.png", fence_dr: "assets/sprites/objects/fence-dr.png", fence_d: "assets/sprites/objects/fence-d.png", fence_dl: "assets/sprites/objects/fence-dl.png", fence_l: "assets/sprites/objects/fence-l.png", fence_ul: "assets/sprites/objects/fence-ul.png", fence_u: "assets/sprites/objects/fence-u.png", fence_ur: "assets/sprites/objects/fence-ur.png", flameTrap: "assets/sprites/objects/flameTrap.png", crate: "assets/sprites/objects/crate.png",
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
  const img = objImgs.tower, t = gnow();
  const on = Math.sin(t / 260) > -0.2, bx = cx, by = cy + 40 - img.height + 14;
  if (on) { const g = ctx.createRadialGradient(bx, by, 1, bx, by, 26); g.addColorStop(0, "rgba(255,90,60,.85)"); g.addColorStop(1, "rgba(255,40,40,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, 26, 0, 7); ctx.fill(); }
  if ((state.towerHp || 0) < (state.towerMaxHp || 1) * 0.25 && Math.sin(t / 120) > 0) { ctx.fillStyle = "rgba(255,60,40,.12)"; ctx.fillRect(cx - 60, cy - 140, 120, 180); } // flashing when critical
}
function drawGenerator(x, y) {
  const broken = (state.generatorHp || 0) <= 0, empty = (state.generatorFuel || 0) <= 0;
  drawObj("generator", x, y + 18, { filter: broken ? "grayscale(1) brightness(.6)" : empty ? "saturate(.4) brightness(.8)" : undefined });
  if (!broken && !empty && Math.random() < 0.06) feel.parts.push({ x: x + 10, y: y - 40, vx: (Math.random() - .5) * 10, vy: -25, t: gnow(), life: 900, c: "#6d6a72", sz: 4 });
}
const LOOT_ART = { scrap: "crate", medkit: "medkit", ammo: "ammo", weapon: "weaponCase" };
// ---------- (Nov 12) THE PYRE PLATE: the Pyre Priest's armour, all drawn in code ----------
let plateUrl = "";
function plateIconUrl() {   // the plate as a small picture for the backpack / equipment panel (drawn once)
  if (plateUrl) return plateUrl; const c = document.createElement("canvas"); c.width = c.height = 64; drawPlateIcon(32, 34, 22, .6, 0, c.getContext("2d")); return plateUrl = c.toDataURL();
}
function plateShape(g, s) {   // a cuirass with pauldrons, centred on 0,0, about 2s wide
  g.beginPath(); g.moveTo(-s * .62, -s * .78); g.quadraticCurveTo(0, -s * .58, s * .62, -s * .78); g.lineTo(s * .74, -s * .2); g.quadraticCurveTo(s * .66, s * .55, 0, s * .95); g.quadraticCurveTo(-s * .66, s * .55, -s * .74, -s * .2); g.closePath();
}
function drawPlateIcon(x, y, s, glow = 1, now = gnow(), g = ctx) {
  const pulse = .75 + .25 * Math.sin(now / 180);
  g.save(); g.translate(x, y);
  if (glow > 0) { g.save(); g.globalCompositeOperation = "lighter"; const h = g.createRadialGradient(0, 0, s * .2, 0, 0, s * 1.9); h.addColorStop(0, `rgba(255,150,40,${.45 * glow * pulse})`); h.addColorStop(1, "rgba(255,80,0,0)"); g.fillStyle = h; g.fillRect(-s * 2, -s * 2, s * 4, s * 4); g.restore(); }
  for (const sx of [-1, 1]) { g.save(); g.scale(sx, 1); g.beginPath(); g.ellipse(s * .78, -s * .6, s * .42, s * .3, -.5, 0, 7); const pg = g.createLinearGradient(0, -s, 0, -s * .3); pg.addColorStop(0, "#5a4a40"); pg.addColorStop(1, "#1c1512"); g.fillStyle = pg; g.fill(); g.lineWidth = Math.max(1.5, s * .08); g.strokeStyle = "#0b0706"; g.stroke();
    g.beginPath(); g.ellipse(s * .78, -s * .62, s * .3, s * .14, -.5, Math.PI, 0); g.strokeStyle = `rgba(255,170,60,${.9 * pulse})`; g.lineWidth = Math.max(1, s * .05); g.stroke(); g.restore(); }   // pauldrons with a molten rim
  plateShape(g, s); const bg = g.createLinearGradient(0, -s, 0, s); bg.addColorStop(0, "#6b5a4e"); bg.addColorStop(.45, "#2e2420"); bg.addColorStop(1, "#140e0c"); g.fillStyle = bg; g.fill(); g.lineWidth = Math.max(2, s * .1); g.strokeStyle = "#0b0706"; g.stroke();
  g.save(); plateShape(g, s); g.clip();
  g.strokeStyle = `rgba(255,${150 + 60 * pulse | 0},50,${.95})`; g.lineWidth = Math.max(1.2, s * .07); g.shadowColor = "#ff8a1a"; g.shadowBlur = s * .5;   // molten seams
  g.beginPath(); g.moveTo(0, -s * .6); g.lineTo(0, s * .9); g.moveTo(-s * .5, -s * .05); g.quadraticCurveTo(0, s * .16, s * .5, -s * .05); g.moveTo(-s * .4, s * .42); g.quadraticCurveTo(0, s * .58, s * .4, s * .42); g.stroke();
  g.shadowBlur = 0; g.fillStyle = "rgba(255,255,255,.14)"; g.beginPath(); g.ellipse(-s * .28, -s * .42, s * .2, s * .34, -.4, 0, 7); g.fill();   // a highlight on the iron
  g.restore();
  g.beginPath(); g.arc(0, -s * .22, s * .2, 0, 7); const gem = g.createRadialGradient(-s * .05, -s * .28, 1, 0, -s * .22, s * .2); gem.addColorStop(0, "#fff4c0"); gem.addColorStop(.45, "#ffb02a"); gem.addColorStop(1, "#c03a08"); g.fillStyle = gem; g.fill(); g.lineWidth = Math.max(1, s * .06); g.strokeStyle = "#2a0d04"; g.stroke();   // the ember heart
  g.restore();
}
function plateEmbers(x, y, w, h, n, seed, now, big = 1) {   // little embers rising and fading (deterministic: no per-frame random)
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < n; i++) { const r = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453, f = r - Math.floor(r), sp = 900 + f * 900, u = ((now + f * 5000) % sp) / sp;
    const ex = x + (f - .5) * w + Math.sin(now / 300 + i) * 4, ey = y - u * h, a = (1 - u) * .9, sz = (1.4 + f * 1.6) * big;
    ctx.fillStyle = `rgba(255,${140 + (f * 90 | 0)},40,${a})`; ctx.fillRect(Math.round(ex - sz / 2), Math.round(ey - sz / 2), sz, sz); }
  ctx.restore();
}
function plateAura(p, front) {   // worn: a warm ring at the feet (behind) and embers drifting up (in front)
  const now = gnow(), seed = (p.sessionId || "").length * 7.31 + (p.sessionId?.charCodeAt?.(0) || 1);
  if (!front) { const k = .6 + .4 * Math.sin(now / 240); ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.translate(p.x, p.y + 17); ctx.scale(1, .32);
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 34); g.addColorStop(0, `rgba(255,140,40,${.35 * k})`); g.addColorStop(1, "rgba(255,80,0,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 34, 0, 7); ctx.fill(); ctx.restore(); return; }
  plateEmbers(p.x, p.y + 6, 30, 46, 6, seed, now);
}
function drawPlateFx(f, age) {   // false when finished
  if (f.type === "plateBurst") { if (age > 1400) return false; const k = age / 1400;
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 1 - k; ctx.strokeStyle = "#ffb347"; ctx.lineWidth = 6 * (1 - k) + 1; ctx.beginPath(); ctx.ellipse(f.x, f.y + 10, 30 + 160 * k, (30 + 160 * k) * .45, 0, 0, 7); ctx.stroke(); ctx.restore();
    plateEmbers(f.x, f.y + 10, 160, 140, 26, f.x, gnow(), 1.6); return true; }
  if (f.type === "plateGot") { if (age > 1100) return false; const p = state?.players.get(f.id), x = p ? p.x : f.x, y = p ? p.y : f.y, k = age / 1100;
    ctx.save(); ctx.globalCompositeOperation = "lighter"; const g = ctx.createLinearGradient(0, y - 120, 0, y + 20); g.addColorStop(0, "rgba(255,170,60,0)"); g.addColorStop(1, `rgba(255,150,40,${.55 * (1 - k)})`);
    ctx.fillStyle = g; ctx.fillRect(x - 22 * (1 - k * .5), y - 120, 44 * (1 - k * .5), 140); ctx.restore(); plateEmbers(x, y + 10, 50, 110, 14, f.t, gnow(), 1.3);
    if (k < .7) { ctx.save(); ctx.globalAlpha = 1 - k / .7; drawPlateIcon(x, y - 46 - 26 * k, 12, .8); ctx.restore(); } return true; }
  return false;
}
function drawLoot(item) {
  if (item.kind === "pyreplate") {   // a legendary drop: a pillar of light, the plate floating and turning in it, embers
    const now = gnow(), x = item.x, bob = Math.sin(now / 320 + item.x) * 4, y = item.y - 22 + bob, k = .7 + .3 * Math.sin(now / 200 + item.y);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const beam = ctx.createLinearGradient(0, item.y - 190, 0, item.y + 12); beam.addColorStop(0, "rgba(255,180,60,0)"); beam.addColorStop(.7, `rgba(255,160,50,${.22 * k})`); beam.addColorStop(1, `rgba(255,140,40,${.45 * k})`);
    ctx.fillStyle = beam; ctx.fillRect(x - 16, item.y - 190, 32, 202);
    ctx.translate(x, item.y + 10); ctx.scale(1, .36); const ring = ctx.createRadialGradient(0, 0, 6, 0, 0, 46); ring.addColorStop(0, `rgba(255,170,60,${.55 * k})`); ring.addColorStop(1, "rgba(255,90,0,0)"); ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(0, 0, 46, 0, 7); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(x, y); ctx.scale(.75 + .25 * Math.cos(now / 520), 1); drawPlateIcon(0, 0, 15, 1, now); ctx.restore();
    plateEmbers(x, item.y + 4, 36, 90, 8, item.x * .37, now);
    return;
  }
  if (item.kind === "shard") { const t = gnow() / 1000, x = item.x, y = item.y + Math.sin(t * 3 + item.x) * 3, k = .7 + .3 * Math.sin(t * 5 + item.y);   // the mine mission: a crystal shard (cart fuel)
    ctx.save(); ctx.globalCompositeOperation = "lighter"; const g = ctx.createRadialGradient(x, y, 2, x, y, 30); g.addColorStop(0, `rgba(110,205,255,${.55 * k})`); g.addColorStop(1, "rgba(40,120,255,0)"); ctx.fillStyle = g; ctx.fillRect(x - 30, y - 30, 60, 60); ctx.restore();
    ctx.save(); ctx.translate(x, y); ctx.fillStyle = "#0b2740"; ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(9, -2); ctx.lineTo(3, 12); ctx.lineTo(-6, 9); ctx.lineTo(-9, -3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#58c4ff"; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(6, -2); ctx.lineTo(2, 9); ctx.lineTo(-4, 7); ctx.lineTo(-6, -2); ctx.closePath(); ctx.fill(); ctx.fillStyle = "#d6f3ff"; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(-6, -2); ctx.lineTo(-1, -1); ctx.closePath(); ctx.fill(); ctx.restore(); return; }
  const bob = Math.sin(gnow() / 300 + item.x) * 2;
  if (item.kind === "weapon") { const c = item.rarity === "Legendary" ? "255,170,40" : item.rarity === "Epic" ? "190,110,255" : item.rarity === "Rare" ? "90,170,255" : "220,220,220"; const g = ctx.createRadialGradient(item.x, item.y, 2, item.x, item.y, 24); g.addColorStop(0, `rgba(${c},.45)`); g.addColorStop(1, `rgba(${c},0)`); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(item.x, item.y, 24, 0, 7); ctx.fill(); }
  // soft pulsing light on the ground so drops stand out
  const pulse = .5 + .5 * Math.sin(gnow() / 260 + item.x), lc = item.kind === "gold" ? "255,210,90" : item.kind === "medkit" ? "255,120,110" : "150,220,255";
  ctx.save(); ctx.globalAlpha = .35 + .25 * pulse; ctx.fillStyle = `rgba(${lc},.55)`; ctx.beginPath(); ctx.ellipse(item.x, item.y + 12, 22, 8, 0, 0, 7); ctx.fill(); ctx.restore();
  if (LOOT_ART[item.kind] && drawObj(LOOT_ART[item.kind], item.x, item.y + 12 + bob, { scale: 1.8 })) return;
  if (item.kind === "gold" && drawIcon("gold", item.x, item.y + bob - 6, 36)) return;
  px(item.x - 6, item.y - 4 + bob, 12, 8, "#e5c66a"); px(item.x - 6, item.y - 4 + bob, 12, 2, "#fff0a8"); px(item.x - 6, item.y + 3 + bob, 12, 1, "#8a6a1e");
}
const STRUCT_BASE = { turret: 16, mine: 8, flameTrap: 14 };   // image bottom below the centre (barricade + fence lines: structSprite)
// Barricade / electric fence lines go ACROSS the way you face. st.aim = the builder's facing (server snapFace); both have art for
// 8 facings (tools/extract-line8.py, 110x110 cells; facing right -> a vertical line, down-right -> "/")
const LINE_DIRS = ["r", "dr", "d", "dl", "l", "ul", "u", "ur"];   // facing 0, 45, 90 ... degrees (screen y down)
function structSprite(kind, face) {   // [image, how far below the centre the image's bottom goes]
  if (kind === "barricade" || kind === "fence") return [kind + "_" + LINE_DIRS[((Math.round(face / (Math.PI / 4)) % 8) + 8) % 8], 45];
  return [kind, STRUCT_BASE[kind] || 14];
}
// TURRET (Nov 8): 8 aims x (idle, fire 1, fire 2) from the user's ChatGPT sheets (tools/extract-turret8.py prints these numbers).
// The server sets st.aim (at its target) + st.fire; while firing it loops fire1 -> fire2 -> idle, with a tracer on the flash frame.
const TURRET_ART = { cw: 105, ch: 85, ax: 52, fy: 80, muzzle: [[29, -37], [23, -22], [2, -18], [-22, -26], [-29, -40], [-20, -55], [1, -61], [26, -51]] };   // muzzle per aim r, dr, d ... ur (from the ground point)
const turretAtlas = new Image(); turretAtlas.src = "assets/sprites/objects/turret8.png";
const turretSnd = new Map();   // turret id -> when its shooting sound last started
function turretFrame(st, now) {   // { k: aim 0..7, row: 0 idle / 1 big flash / 2 small flash, gx, gy: ground point }
  const k = ((Math.round((st.aim || 0) / (Math.PI / 4)) % 8) + 8) % 8, firing = st.fire && powered() && state?.phase === "playing" && state.zombies.size > 0;
  return { k, row: firing ? [1, 2, 0][Math.floor(now / 65 + st.x * .37) % 3] : 0, firing, gx: st.x, gy: st.y + 14 };
}
function drawTurret(st) {
  const now = gnow(), f = turretFrame(st, now), A = TURRET_ART;
  if (!turretAtlas.complete || !turretAtlas.naturalWidth) return false;
  ctx.save(); ctx.imageSmoothingEnabled = false; if (!powered()) ctx.filter = "grayscale(1) brightness(.7)";
  ctx.drawImage(turretAtlas, f.k * A.cw, f.row * A.ch, A.cw, A.ch, Math.round(f.gx - A.ax), Math.round(f.gy - A.fy), A.cw, A.ch); ctx.restore();
  if (!f.firing) return true;
  const [mx, my] = A.muzzle[f.k], x0 = f.gx + mx, y0 = f.gy + my, a = st.aim || 0;
  if (f.row === 1) {   // tracer to the zombie it's shooting (the nearest one along its aim)
    let tgt = null, best = 275;
    for (const z of state.zombies.values()) { const d = Math.hypot(z.x - st.x, z.y - st.y); if (d < best && Math.abs(Math.atan2(Math.sin(Math.atan2(z.y - st.y, z.x - st.x) - a), Math.cos(Math.atan2(z.y - st.y, z.x - st.x) - a))) < .5) { best = d; tgt = z; } }
    const v = tgt && (V(tgt) || tgt), x1 = v ? v.x : st.x + Math.cos(a) * 240, y1 = v ? v.y - 18 : st.y + Math.sin(a) * 240;
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,190,80,.35)"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = "rgba(255,245,200,.85)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.restore();
  }
  if (now - (turretSnd.get(st.id) || 0) > 520) { turretSnd.set(st.id, now); playSfx("turret", st.x, st.y, .7); }   // one burst per clip length
  return true;
}
function turretLights(now) {   // night: muzzle flashes light the dark
  for (const st of state?.structures?.values() || []) { if (st.kind !== "turret") continue; const f = turretFrame(st, now);
    if (f.firing && f.row && inView(f.gx, f.gy, 80)) { const [mx, my] = TURRET_ART.muzzle[f.k]; lightHole(f.gx + mx - cam.x, f.gy + my - cam.y, f.row === 1 ? 85 : 55, f.row === 1 ? .75 : .45); } }
}
function drawStructure(st) {
  if (st.kind === "heavyTurret") return drawHeavyTurret(st);
  if (st.kind === "demoCharge") return drawDemoCrate(st);
  const [img, feet] = structSprite(st.kind, st.aim || 0), base = st.y + feet, on = powered(), t = gnow();
  const filter = (st.kind === "fence" || st.kind === "flameTrap") && !on ? "grayscale(1) brightness(.7)" : st.kind === "fence" && Math.random() < 0.25 ? "brightness(1.5)" : undefined;
  if (!(st.kind === "turret" ? drawTurret(st) : drawObj(img, st.x, base, { filter }))) return;
  if (st.kind === "flameTrap" && on) { const f = 0.6 + Math.sin(t / 70 + st.x) * 0.25; const g = ctx.createRadialGradient(st.x, st.y + 4, 2, st.x, st.y + 4, 30); g.addColorStop(0, `rgba(255,140,40,${.45 * f})`); g.addColorStop(1, "rgba(255,80,20,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(st.x, st.y + 4, 30, 0, 7); ctx.fill(); }
  if (st.kind === "mine") { if (Math.sin(t / 200 + st.x) > 0.3) { ctx.fillStyle = "rgba(255,60,40,.8)"; ctx.fillRect(st.x - 1, base - 13, 3, 3); } }
  if (st.hp < st.maxHp && st.kind !== "mine") { const w = 34, top = img.includes("_") ? 80 : st.kind === "turret" ? 68 : 52; ctx.fillStyle = "#241f1c"; ctx.fillRect(st.x - w / 2, base - top, w, 4); ctx.fillStyle = "#c9a35a"; ctx.fillRect(st.x - w / 2, base - top, w * Math.max(0, st.hp / st.maxHp), 4); }
}

// ================= CAMERA + WORLD =================
// The map is bigger than the screen. The camera follows you smoothly and leans ahead
// in the direction you're walking. World size comes from the server (worldW / worldH).
const worldW = () => state?.worldW || 3600, worldH = () => state?.worldH || 2280;
const towerX = () => state?.towerX || worldW() / 2, towerY = () => state?.towerY || worldH() / 2;   // the radio tower (painted maps: where it's painted)
const paintedMap = () => { const s = state?.mapLayout; return s && s.startsWith("P:") ? PAINTED[s.slice(2)] || null : null; };
const cam = { x: 0, y: 0, ready: false, last: 0 };
window.__saCam = cam; window.__saRoom = () => room; window.__saPred = () => { const m = me_(); return { id: myId, px: PRED.x, ex: PRED.ex, sx: m?.x, ack: m?.ack, seq: PRED.seq, n: PRED.pending.length, sp: m?.speed }; }; if (SOLO_PREVIEW) window.__saState = () => ({ state, me: me_(), scorches, corpses, room }); // read-only hook used by automated smoothness tests
// ===================== OWN-PLAYER PREDICTION =====================
// Your survivor moves the instant you press a key (same speed + wall rules as the server), instead of waiting a round trip.
// Every input has a number; the server sends back the last number it applied (player.ack). On each update we start from the
// server's position and replay the inputs it hasn't applied yet. Small differences fade out over ~0.1s instead of snapping.
const PRED = { seq: 0, pending: [], x: 0, y: 0, ok: false, ex: 0, ey: 0, grid: null, src: null };
const P_BODY_R = 12, P_TOWER_HALF = 34, P_GEN_H = 20, P_DASH = 140;   // matches DASH_DISTANCE on the server
function predGrid() {
  const src = state?.mapLayout || "", st = deepState()?.step, broken = st === "fight" || st === "flee" || st === "chase" || st === "escaped"; if (PRED.src === src && PRED.broken === broken && PRED.grid) return PRED.grid;   // the mine statue's body stops blocking once the Beast is out (as on the server)
  const pm = paintedMap(), layout = pm ? paintedLayout(pm) : src ? src.split(";").map(r => { const [k, x, y, f] = r.split(",").map(Number); return { kind: MAP_KINDS[k], x, y, flip: f === 1 }; }).filter(d => d.kind) : [];
  const grid = new Map();
  for (const b of broken ? mapBoxes(layout) : mapBoxes(layout).concat(statueBodyBoxes(layout))) for (let gx = Math.floor((b.x - b.hw) / 160); gx <= Math.floor((b.x + b.hw) / 160); gx++) for (let gy = Math.floor((b.y - b.hh) / 160); gy <= Math.floor((b.y + b.hh) / 160); gy++) {
    const k = gx + "," + gy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b);
  }
  PRED.src = src; PRED.broken = broken; PRED.grid = grid; return grid;
}
function predSolve(p) {   // same as the server's solveCollisions for a survivor (deployables don't block survivors)
  const WW = worldW(), WH = worldH(), cx = towerX(), cy = towerY(), boxes = [{ x: cx, y: cy, hw: P_TOWER_HALF, hh: P_TOWER_HALF }, { x: cx + GEN_OFF.x, y: cy + GEN_OFF.y, hw: P_GEN_H, hh: P_GEN_H }];
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
const serverDriven = me => gnow() - (ravenDash.get(myId)?.t0 ?? -1e9) < 450 || gnow() - (fragHop.get(myId) ?? -1e9) < 380 || (me.characterClass === "juggernaut" && !!briggsCast(me, gnow()));
const predicting = me => !!(me && me.alive && (state?.phase === "playing" || state?.phase === "cleared") && !state.vehicles?.get(myId) && !(me.stunned > 0) && !(me.ride > 0) && !serverDriven(me));
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
  const arrived = gnow(), expect = snapT + 50, now = !snapT || Math.abs(arrived - expect) > 120 ? arrived : expect + (arrived - expect) * .2; snapT = now;
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
  const now = gnow(), rt = now - INTERP_DELAY;
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
  coastSync(); if (coast) for (const p of state.players.values()) if (p.ride > 0) { const sm = smooth.get("p" + p.sessionId), q = coasterSeat(coast.T, coast.s, p.ride - 1); if (sm) { sm.x = q.x; sm.y = q.y; } }   // coaster riders sit in OUR copy of the train (no jitter against it)
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
  let fx_ = me ? me.x : towerX(), fy_ = me ? me.y : towerY();
  if (state.mission && deepState()?.step === "awake") { /* (held on the statue, below) */ } else if (state.mission && me && me.ride > 0) { const D = deepState(); if (D?.step === "chase") for (const z of state.zombies.values()) if (z.kind === "minebeast") { const k = .45, tx = Math.max(-300, Math.min(300, (z.x - me.x) * k)), ty = Math.max(-190, Math.min(190, (z.y - me.y) * k)); deepCam.x += (tx - deepCam.x) * .06; deepCam.y += (ty - deepCam.y) * .06; } } else { deepCam.x *= .92; deepCam.y *= .92; }
  if (state.mission && me) { const D = deepState(); if (D?.step === "awake") { const st = (decor || []).find(d => d.kind === "mStatue"); if (st) { deepCam.x += (st.x - me.x - deepCam.x) * .08; deepCam.y += (st.y - 150 - me.y - deepCam.y) * .08; } } }   // the awakening: the camera goes to the statue
  fx_ += deepCam.x; fy_ += deepCam.y;   // the mine chase: the camera leans back toward the Beast so you can see it coming
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
Object.assign(DYN_ART, WO_ART, RF_ART, CV_ART, MN_ART, KC_ART);   // one table for every piece-built map (kinds "d..." = Fallen Dynasty, "w..." = Whiteout Station)
for (const [k, a] of Object.entries(DYN_ART)) MAP_URLS[k] = a.url;
for (const [k, url] of Object.entries(WO_TILES)) TILE_URLS["w" + k] = url;
for (const [k, url] of Object.entries(RF_TILES)) TILE_URLS["r" + k] = url;
for (const [k, url] of Object.entries(CV_TILES)) TILE_URLS["c" + k] = url;
for (const [k, url] of Object.entries(MN_TILES)) TILE_URLS["m" + k] = url;
for (const [k, url] of Object.entries(KC_TILES)) TILE_URLS["k" + k] = url;
const cartImg = new Image(); if (CV_CART.url) cartImg.src = CV_CART.url;
const mineCartImg = new Image(); mineCartImg.src = MN_CART.url; const portalFxImg = new Image(); portalFxImg.src = MN_FX.portal.url; const shatterFxImg = new Image(); shatterFxImg.src = MN_FX.shatter.url;
for (const [k, url] of Object.entries(DYN_TILES)) TILE_URLS["d" + k] = url;
for (const [k, url] of Object.entries(MAP_URLS)) { const img = new Image(); img._snow = !!WO_ART[k]; img._raw = !!RF_ART[k] || !!CV_ART[k]; img._mine = !!MN_ART[k]; img._lava = !!KC_ART[k]; img.src = url; mapImgs[k] = img; }
for (const [k, url] of Object.entries(TILE_URLS)) { const img = new Image(); img._snow = k[0] === "w" && !!WO_TILES[k.slice(1)]; img._raw = (k[0] === "r" && !!RF_TILES[k.slice(1)]) || (k[0] === "c" && !!CV_TILES[k.slice(1)]); img._mine = k[0] === "m" && !!MN_TILES[k.slice(1)]; img._lava = k[0] === "k" && !!KC_TILES[k.slice(1)]; if (k === "kmolten" || k === "kcrust") img._raw = true; /* Scorched Refinery + Midnight Carnival: no tint (user, Nov 11) */ img.src = url; tileImgs[k] = img; }
// Spooky look for the ground and map pieces only (players, zombies, tower and structures keep their colours):
// darker, less colourful, with a cold blue-green cast. Made once per picture, then reused.
const SPOOKY = { filter: "brightness(.58) saturate(.5) contrast(1.1)", tint: "rgba(16,42,58,.30)" };
const SPOOKY_CARN = { filter: "brightness(.6) saturate(.78) contrast(1.12)", tint: "rgba(22,14,58,.32)" };   // Midnight Carnival (user, Nov 11): a NIGHT carnival, dark tint like the city maps but keeping more colour so the bulbs and paint still read   // Midnight Carnival: a light night tint, so the bulbs and colours still pop
const SPOOKY_MINE = { filter: "brightness(.84) saturate(.9) contrast(1.06)", tint: "rgba(14,20,42,.16)" };   // The Deep Mine: a light cold tint; the gloom comes from the cave darkness (drawNight) with the lanterns and crystals lighting it
const SPOOKY_LAVA = { filter: "brightness(.8) saturate(.95) contrast(1.08)", tint: "rgba(34,8,4,.14)" };   // The Crucible: a little darker and warmer (the gloom is the volcano's darkness, lit by the lava)
const SPOOKY_SNOW = { filter: "brightness(.74) saturate(.72) contrast(1.06)", tint: "rgba(18,44,70,.18)" };   // Whiteout Station (user: "a little brighter"): its pieces and tiles (img._snow) get a much lighter tint
const spookyCache = new Map();
function spooky(img) {
  if (!img?.complete || !img.naturalWidth) return null;
  if (img._raw) return img;   // Scorched Refinery (user: bright, no tint): its art is drawn as it is
  if (spookyCache.has(img)) return spookyCache.get(img);
  const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const S = img._snow ? SPOOKY_SNOW : img._mine ? SPOOKY_MINE : img._lava ? SPOOKY_LAVA : img._carn ? SPOOKY_CARN : SPOOKY, g = c.getContext("2d"); g.filter = S.filter; g.drawImage(img, 0, 0); g.filter = "none";
  g.globalCompositeOperation = "source-atop"; g.fillStyle = S.tint; g.fillRect(0, 0, c.width, c.height);
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
let decor = null, decorSrc = "", dynFires = [], dynLights = [];   // Fallen Dynasty: every fire / lantern light on the map (world positions)
const SITE_STYLE = ["city", "city", "city", "dynasty", "whiteout", "refinery", "mine", "crucible"];   // (Nov 12: The Crucible, the lava map)   // (Nov 11: Midnight Carnival removed)
const carnivalMap = () => SITE_STYLE[state?.mapSite || 0] === "carnival";   // lobby sites (server SITES)
const whiteoutMap = () => SITE_STYLE[state?.mapSite || 0] === "whiteout";
const refineryMap = () => SITE_STYLE[state?.mapSite || 0] === "refinery";
const mineMap = () => SITE_STYLE[state?.mapSite || 0] === "mine";
const crucibleMap = () => SITE_STYLE[state?.mapSite || 0] === "crucible";
const softGround = () => whiteoutMap() || refineryMap() || carnivalMap() || mineMap() || crucibleMap();   // ground patches with soft irregular edges
const fire3Piece = k => k[0] === "w" || (k[0] === "r" && !!RF_ART[k]) || !!CV_ART[k] || !!MN_ART[k];   // pieces that burn with the user's fire loops + smoke
const dynastyMap = () => { const st = SITE_STYLE[state?.mapSite || 0]; return st === "dynasty" || st === "whiteout" || st === "refinery" || st === "carnival" || st === "mine" || st === "crucible"; };   // any map built from cut-out pieces (Fallen Dynasty, Whiteout Station)
function syncDecor() {
  const src = state?.mapLayout || ""; if (src === decorSrc) return; decorSrc = src;
  dynFires = []; dynLights = [];
  decor = src.startsWith("P:") ? [] : src ? src.split(";").map(r => { const [k, x, y, f] = r.split(",").map(Number); return { kind: MAP_KINDS[k], x, y, flip: f === 1 }; }).filter(d => d.kind) : [];
  for (const d of decor) { const a = DYN_ART[d.kind]; if (!a) continue; const f = d.flip ? -1 : 1;
    for (const [x, y, sc] of a.fires || []) dynFires.push([d.x + x * f, d.y + y, sc]);
    for (const [x, y] of a.lights || []) dynLights.push([d.x + x * f, d.y + y]);
    for (const [x, y, sc] of a.blue || []) if (sc >= .8) dynLights.push([d.x + x * f, d.y + y, 1]); }   // The Deep Mine: the bigger crystals light the dark too (blue)
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
  if (state && dynastyMap()) return drawDynastyWorld();
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
// ---------- Fallen Dynasty (Nov 5): a city of Chinese pieces on straight roads (mapLayout.js buildDynastyLayout / dynastyGround) ----------
let dynGroundCache = null;
function drawDynastyWorld() {
  const WW = worldW(), WH = worldH();
  const rf = refineryMap(), cv = carnivalMap(), mn = mineMap(), kc = crucibleMap(), wo = softGround(), T = kc ? "k" : mn ? "m" : cv ? "c" : rf ? "r" : wo ? "w" : "d", base = kc ? "kbasalt" : mn ? "mgravel" : cv ? "cgrass" : rf ? "rsand" : wo ? "wsnow" : "dgrass";
  syncDecor();   // Whiteout Station's ground (foundation pads, ponds) is worked out from where the pieces stand
  if (!dynGroundCache || dynGroundCache.w !== WW || dynGroundCache.wo !== T || dynGroundCache.src !== decorSrc) dynGroundCache = { w: WW, wo: T, src: decorSrc, g: kc ? crucibleGround(WW, WH, decor) : mn ? mineGround(WW, WH, decor) : cv ? carnivalGround(WW, WH, decor) : rf ? refineryGround(WW, WH, decor) : wo ? whiteoutGround(WW, WH, decor) : dynastyGround(WW, WH) };
  const ready = [base, ...new Set(dynGroundCache.g.map(g => T + g.tile))].filter(k => pattern(k)).length;   // the cache key changes as tile art finishes loading
  drawGroundCached("dyn" + T + WW + "x" + WH + ":" + ready + ":" + decorSrc.length, (vx, vy, vw, vh) => {
    const fill = (p, x, y, w, h) => { const ax = Math.max(x, vx), ay = Math.max(y, vy), bx = Math.min(x + w, vx + vw), by = Math.min(y + h, vy + vh); if (bx > ax && by > ay) { ctx.fillStyle = p; ctx.fillRect(ax, ay, bx - ax, by - ay); } };
    const grass = pattern(base); ctx.fillStyle = "#14161c"; ctx.fillRect(vx, vy, vw, vh); if (grass) fill(grass, 0, 0, WW, WH);
    if (mn) { mineGroundBlend(dynGroundCache.g, grass, vx, vy, vw, vh); for (const d of decor) if (/^mChasm/.test(d.kind)) { const [w, h] = d.kind === "mChasm" ? [660, 250] : [250, 620]; if (d.x - w / 2 < vx + vw + 30 && d.x + w / 2 > vx - 30 && d.y - h / 2 < vy + vh + 30 && d.y + h / 2 > vy - 30) drawChasm(d, w, h); }
      mineRails(vx, vy, vw, vh, WW, WH); }   // The Deep Mine: every surface faded softly into the next, then chasms, then the rails over everything (on a chasm they run on a timber bridge)
    else for (const g of dynGroundCache.g) {
      const p = pattern(T + g.tile); if (wo) { if (p && grass && g.x < vx + vw + 60 && g.x + g.w > vx - 60 && g.y < vy + vh + 60 && g.y + g.h > vy - 60) softPatch(g, p, grass); continue; }
      if (p) fill(p, g.x, g.y, g.w, g.h);
      if (g.road) { const horiz = g.w > g.h; if (horiz) { px(g.x, g.y - 3, g.w, 3, "#4b4554"); px(g.x, g.y + g.h, g.w, 3, "#2a2630"); } else { px(g.x - 3, g.y, 3, g.h, "#4b4554"); px(g.x + g.w, g.y, 3, g.h, "#2a2630"); } } }
    ctx.fillStyle = "#0c0b10"; ctx.fillRect(-60, -60, WW + 120, 60); ctx.fillRect(-60, WH, WW + 120, 60); ctx.fillRect(-60, 0, 60, WH); ctx.fillRect(WW, 0, 60, WH);   // map edge
  });
  if (kc) { const d = ctxDepth; ctx.save(); try { drawLava(); } catch (e) { reportError(e, "draw"); } unwindTo(d); }   // The Crucible: the lava rivers flow (animated: drawn every frame over the cached ground, under the bridges)
  syncDecor();
  const tall = [];
  for (const d of decor) {
    const a = DYN_ART[d.kind], w = a ? a.w : 160, h = a ? a.h : 160; if (!inView(d.x, d.y - h / 2, Math.max(w, h) / 2 + 40)) continue;
    if (/^mChasm/.test(d.kind)) continue;   // (drawn into the ground)
    if (d.kind === "mRuneCircle") { drawRuneCircle(d); continue; }
    if (d.kind === "mStop") { drawBossStop(d); continue; }
    if (d.kind === "mStatue") { tall.push({ y: d.y - 6, draw: () => { drawDeepStatue(d, a); if (!deepState()) statueFx(d, a); } }); continue; }
    if (/^mSeal/.test(d.kind) && deepState() && Number(d.kind.slice(5)) <= deepState().placed) { const im = mapImgs[d.kind]; if (im?.naturalWidth) tall.push({ y: d.y - 6, draw: () => ctx.drawImage(darkCopy(im), Math.round(d.x - im.width / 2), d.y - im.height) }); continue; }   // a seal whose rune is in: shattered, dark
    if (d.kind === "mShrine") { tall.push({ y: d.y - 6, draw: () => { drawMapObj(d); shrineFx(d); dynPieceFx(d, a); } }); continue; }
    if (d.kind === "mWardGate") { tall.push({ y: d.flip ? d.y + 130 : d.y + 40, draw: () => drawWard(d) }); continue; }
    if (d.kind === "cvStation" || d.kind === "mStation") { drawMapObj(d); const img = spooky(mapImgs[d.kind]), rh = Math.round(a.h * (d.kind === "mStation" ? .25 : .33));   // the coaster station: its floor is walked on (drawn now); only its canopy roof is drawn over people and the train
      if (img) tall.push({ y: d.kind === "mStation" ? d.y - 104 : d.y - 6, /* the mine station: its roof goes over the carts parked under it (their riders sit below the eave), but not over people on the deck */ draw: () => ctx.drawImage(img, 0, 0, a.w, rh, Math.round(d.x - a.w / 2), d.y - a.h, a.w, rh) }); dynPieceFx(d, a); continue; }
    if (MAP_FLAT[d.kind]) drawMapObj(d); else tall.push({ y: d.kind === "kCrucible" ? d.y - 190 : a?.door ? d.y + a.door[1] + a.door[3] - 10 : d.y - 6,   /* the Great Crucible: the boss stands in its burst front, drawn over it */ draw: () => { if (a?.frames) drawAnimPiece(d, a); else drawMapObj(d); if (d.kind === "mPortal") portalFx(d, a); else if (a?.door) pyramidFx(d, a); if (/^mSeal/.test(d.kind)) sealFx(d, a); dynPieceFx(d, a); } });
  }
  if (mineMap() && deepFx.boulders?.length) for (const b of deepFx.boulders) if (inView(b.x, b.y - 50, 120)) tall.push({ y: b.y, draw: () => drawBoulder(b) });   // the Beast fight's fallen boulders
  if (coast) { try { coasterTall(tall); } catch (e) { reportError(e, "draw"); } }   // a coaster bug must never hide the whole world
  drawWorldObjects(tall);
  if (coast) { const d = ctxDepth; ctx.save(); try { drawStationSigns(); drawDeepWorld(); if (state.mission) { drawBeastFx(); drawShieldBeam(gnow(), gnow() / 1000); } } catch (e) { reportError(e, "draw"); } unwindTo(d); }
}
// ---------- The Crucible (Nov 12): the two lava rivers, drawn in code from the lava tiles (mapLayout.js crucibleRivers: same shape the server makes solid) ----------
// A scorched dark rim, a band of cracked crust, the molten core flowing downstream, a hot glow on the core's edges, bubbles swelling and popping.
let lavaRivers = null;
function drawLava() {
  if (!lavaRivers) lavaRivers = crucibleRivers();
  const molten = pattern("kmolten"), crust = pattern("kcrust"); if (!molten || !crust) return;
  const t = gnow() / 1000, ya = cam.y - 160, yb = cam.y + H + 160;
  for (const r of lavaRivers) {
    const P = r.pts.filter(p => p.y >= ya && p.y <= yb); if (P.length < 2) continue;
    if (P.every(p => p.x + p.w * 1.4 < cam.x || p.x - p.w * 1.4 > cam.x + W)) continue;
    const edge = (p, side, k, n) => p.x + side * (p.w * k + n * (Math.sin(p.y * .045 + side * 1.7 + r.i) * 5 + Math.sin(p.y * .13 + side) * 3));   // banks with a little wobble
    const shape = (k, n = 1) => { ctx.beginPath(); P.forEach((p, i) => { const x = edge(p, -1, k, n); if (i) ctx.lineTo(x, p.y); else ctx.moveTo(x, p.y); }); for (let i = P.length - 1; i >= 0; i--) ctx.lineTo(edge(P[i], 1, k, n), P[i].y); ctx.closePath(); };
    ctx.fillStyle = "rgba(12,4,2,.6)"; shape(1.16, 1.6); ctx.fill();   // scorched rim
    crust.setTransform(new DOMMatrix().translate(r.i * 90, t * 7)); ctx.fillStyle = crust; shape(1); ctx.fill();   // the crust drifts slowly
    const pulse = .5 + .5 * Math.sin(t * 1.7 + r.i);
    molten.setTransform(new DOMMatrix().translate(Math.sin(t * .35 + r.i) * 8 + r.i * 40, t * 30)); ctx.fillStyle = molten; shape(.7 + .03 * pulse, .6); ctx.fill();   // the core flows downstream
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineJoin = "round";
    for (const side of [-1, 1]) { ctx.beginPath(); P.forEach((p, i) => { const x = edge(p, side, .7 + .03 * pulse, .6); if (i) ctx.lineTo(x, p.y); else ctx.moveTo(x, p.y); });
      ctx.strokeStyle = `rgba(255,150,40,${.18 + .12 * pulse})`; ctx.lineWidth = 14; ctx.stroke(); ctx.strokeStyle = `rgba(255,220,120,${.22 + .15 * pulse})`; ctx.lineWidth = 3; ctx.stroke(); }
    for (const p of P) {   // bubbles: each 20px row has its own slow rhythm
      const h = Math.sin(p.y * 12.9898 + r.i * 78.233) * 43758.5453, f = h - Math.floor(h); if (f > .35) continue;
      const per = 2.2 + f * 6, u = ((t + f * 17) % per) / per; if (u > .3) continue;
      const bx = p.x + (f * 2.9 % 1 - .5) * p.w * 1.1, k = u / .3, R = 3 + k * (6 + f * 18);
      ctx.fillStyle = `rgba(255,${200 + 40 * (1 - k) | 0},110,${.75 * (1 - k * k)})`; ctx.beginPath(); ctx.arc(bx, p.y, R, 0, 7); ctx.fill();
      if (k > .8) { ctx.strokeStyle = `rgba(255,230,150,${(1 - k) * 4})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, p.y, R * 1.4, 0, 7); ctx.stroke(); }   // pop!
    }
    ctx.restore();
  }
}
function lavaLights() {   // the rivers light the dark all along their length
  if (!lavaRivers) return; const t = gnow() / 1000;
  for (const r of lavaRivers) for (let i = 0; i < r.pts.length; i += 6) { const p = r.pts[i]; if (!inView(p.x, p.y, 320)) continue; lightHole(p.x - cam.x, p.y - cam.y, p.w * 2.2 + 30 * Math.sin(t * 1.3 + i), .78); }
}
// ---------- Midnight Carnival: the coaster. The track is DRAWN here (it bends freely); the train's place comes from state.coasterS ----------
let coast = null, coastLast = 0, CO = COASTER;   // CO: the ride's numbers (the coaster, or the mine train: T.cfg)
function coastSync() {   // every frame: glide our copy of the train toward where the server says it is
  if (!state || !(carnivalMap() || mineMap())) { coast = null; return; }
  const WW = worldW(), WH = worldH(), now = gnow(), dt = Math.min(.1, (now - coastLast) / 1000); coastLast = now;
  if (!coast || coast.w !== WW || coast.mn !== mineMap()) { const mn = mineMap(); coast = { w: WW, mn, T: mn ? mineTrack(WW, WH) : coasterTrack(WW, WH), s: state.coasterS || 0 }; CO = coast.T.cfg || COASTER; coastQueued = false; feed.unshift({ text: mn ? "Ride the mine carts: walk to the CART STATION (top left, teal dot on the minimap) and press F" : "Ride the coaster: walk to a COASTER station (teal dots on the minimap) and press F", t: Date.now() }); feed.length = Math.min(feed.length, 5); }
  if (coast.mn) { const D = deepState(), want = D ? D.ss : -1, T = coast.T, k = T.stations.findIndex(q => q.shrine !== undefined);   // the shield run's extra cart stop by the glowing shrine (as on the server)
    if (k >= 0 && T.stations[k].shrine !== want) T.stations.splice(k, 1);
    if (want >= 0 && !T.stations.some(q => q.shrine === want)) { const d = deepPieces().shrines[want]; if (d) { const q = trackNearest(T, d.x, d.y + 34); T.stations.push({ s: q.s, x: Math.round(q.x), y: Math.round(q.y), off: 1, shrine: want }); T.stations.sort((a, b) => a.s - b.s); } } }
  const L = coast.T.L; let e = ((state.coasterS || 0) - coast.s) % L; if (e > L / 2) e -= L; if (e < -L / 2) e += L;
  coast.s = Math.abs(e) > 400 ? state.coasterS : ((coast.s + e * Math.min(1, dt * 10)) % L + L) % L;
}
const coastStation = () => { if (!coast || !(state.coasterWait > 0)) return null; return coast.T.stations.find(st => Math.abs(st.s - state.coasterS) < 6) || null; };   // the station the train is stopped at
const COASTER_NEAR = 300, coastNear = me => coast?.T.stations.find(q => Math.hypot(me.x - q.x, me.y - (q.y + 40)) < COASTER_NEAR);
let coastQueued = false;   // you pressed F at a station before the train got there: you'll hop on when it stops
function coasterUse() {   // F at a coaster station: get on (train here) / wait for it (train coming) / get off (riding, at a station)
  const me = me_(); if (!coast || !me?.alive || !room) return false;
  if (me.ride > 0) { if (coastStation()) room.send("coaster"); return true; }
  if (me.rideCd > 0 || !coastNear(me)) return false;
  room.send("coaster"); return true;
}
function coastEta(st) {   // seconds until the train next stops at this station
  const T = coast.T, i = T.stations.indexOf(st); let s = coast.s, t = state.coasterWait >= 1000 ? 8 : state.coasterWait > 0 ? state.coasterWait : 0;   // (1000 + n = holding at the boss stop: unknown, guess 8s)
  let ahead = ((st.s - s) % T.L + T.L) % T.L; if (ahead < 6 && state.coasterWait > 0) return 0;
  const stops = T.stations.filter(q => { const d = ((q.s - s) % T.L + T.L) % T.L; return d > 6 && d < ahead - 6; }).length;
  return Math.max(1, Math.round(t + ahead / CO.speed + stops * CO.wait + 1));
}
function drawCoasterPrompt() {   // screen space, over your head (like the repair prompts)
  const me = me_(); if (!coast || !me?.alive) return; const v = V(me), st = coastStation(); let text = "", col = "#ffe08a";
  const RW = coast.mn ? "MINE CART" : "COASTER", rw = coast.mn ? "mine cart" : "coaster";
  const hold = state.coasterWait >= 1000 ? state.coasterWait - 1000 : 0;
  const Dq = deepState(), run = Dq?.step === "fight" && (Dq.sh || Dq.ss >= 0);   // the shield run: the cart is in play during the fight
  if (state.mission && (me.ride > 0 && !st || ["awake", "fight"].includes(Dq?.step) && !run)) return;   // (the mine mission: the objective pop-up says what to do)
  if (run) { const near = coastNear(me); if (me.ride > 0) { if (!st) return; text = st.shrine !== undefined ? "[F] Hop off · overload the shrine" : "[F] Hop off"; } else if (near && near === st) text = st.boss ? (Dq.sh ? "[F] RIDE TO THE SHRINE · one rider only" : "") : Dq.sh ? "" : "[F] GET BACK IN THE MINE CART"; if (!text) return; }
  else
  if (me.ride > 0) { text = st ? (st.boss ? "[F] Hop off here · the carts wait until you're back on" : "[F] Get off here") : hold ? `Waiting for ${hold} to get back on…` : `Riding the ${rw} · aim and shoot!`; col = st ? "#ffe08a" : "#9fe3ff"; }
  else { const near = coastNear(me); if (!near) return;
    if (me.rideCd > 0) { text = `${coast.mn ? "Mine cart" : "Coaster"}: ride again in ${Math.ceil(me.rideCd)}s`; col = "#ff9d6b"; }
    else if (st === near) { const D = deepState(), go = D && D.step === "runes" && !st.boss ? (D.runes.some(r => r.st === 1 && state.players.get(r.by)?.ride > 0) ? (D.fuel >= DEEP_UI.fuelCost ? "" : ` · needs fuel ${D.fuel}/${DEEP_UI.fuelCost}`) : " · leaves with a rune aboard") : null;
      text = hold ? `[F] GET BACK IN THE ${RW} · waiting for ${hold}` : go ? `[F] GET IN THE ${RW}${go}` : D && st.boss ? `[F] GET BACK IN THE ${RW}` : `[F] GET IN THE ${RW} · leaves in ${Math.ceil(state.coasterWait)}s`; }
    else if (coastQueued) { text = `Waiting for the ${coast.mn ? "carts" : "train"} · ${coastEta(near)}s   ([F] cancel)`; col = "#9fe3ff"; }
    else text = `[F] Wait for the ${rw} · arrives in ${coastEta(near)}s`; }
  const x = v.x - Math.round(cam.x), y = v.y - Math.round(cam.y) - 96;
  ctx.save(); ctx.font = "bold 15px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; const w = ctx.measureText(text).width + 22;
  ctx.fillStyle = "rgba(10,6,4,.72)"; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 17, w, 25, 7); ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = col; ctx.fillText(text, x, y + 1); ctx.restore();
}
function drawStationSigns() {   // world space, over each station: "COASTER · train here / arrives in Ns", so you can find them and see when it comes
  if (!coast) return; const t = gnow() / 1000, here = coastStation();
  for (const st of coast.T.stations) { if (!inView(st.x, st.y, 300)) continue;
    const x = st.x, y = st.y - (st.boss ? 300 : coast.mn ? 196 : 150) + Math.sin(t * 3 + st.x) * 4, txt = (st.boss ? "BOSS STOP · " : st.shrine !== undefined ? "SHRINE STOP · " : "") + (here === st ? (state.coasterWait >= 1000 ? `WAITING FOR ${state.coasterWait - 1000}` : coast.mn ? "CARTS HERE · press F" : "TRAIN HERE · press F") : `${coast.mn ? "CARTS" : "TRAIN"} IN ${coastEta(st)}s`);
    ctx.save(); ctx.font = "bold 14px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; const w = ctx.measureText(txt).width + 26;
    ctx.fillStyle = here === st ? "rgba(255,190,60,.92)" : "rgba(20,12,8,.78)"; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 16, w, 24, 12); ctx.fill();
    ctx.fillStyle = here === st ? "#2a1405" : "#ffe08a"; ctx.fillText(txt, x, y + 1);
    ctx.beginPath(); ctx.moveTo(x - 7, y + 8); ctx.lineTo(x + 7, y + 8); ctx.lineTo(x, y + 16); ctx.closePath(); ctx.fillStyle = here === st ? "rgba(255,190,60,.92)" : "rgba(20,12,8,.78)"; ctx.fill(); ctx.restore(); }
}
const atStation = q => coast.T.stations.some(st => Math.abs(q.x - st.x) < 262 && Math.abs(q.y - st.y) < 70);
const cartKey = c => atStation(c) ? c.y - CO.H + 6 : c.y + 15;   // the cart's depth; its riders are drawn straight after it
const CART_RIM = [.52, .5, .46, .5, .52], CART_RIM_MN = [.56, .58, .55, .58, .56];   // per view (D, DR, R, UR, U): how far up the cart (from its bottom, as a share of its height) the tub's rim is
function drawRider(p, rimY) {   // a survivor sitting INSIDE a cart: drawn over the cart, everything below the tub's rim cut off (head, shoulders and arms show)
  ctx.save(); ctx.beginPath(); ctx.rect(p.x - 80, rimY - 260, 160, 260); ctx.clip(); drawSurvivor(p); ctx.restore();
}
function coasterTall(tall) {   // the track's pieces and the carts go into the depth-sorted list at rail height, so the cart hides its riders' legs and things in front cover it
  const T = coast.T, P = T.pts, n = P.length, H = CO.H;
  // depth: out in the park the track sorts at its GROUND line (+14), so whoever walks under it is drawn under it; along a station's platform it is part of the floor (people on the deck stand in front of the rails)
  if (!coast.mn) for (let i = 0; i < n; i++) { const p = P[i]; if (!inView(p.x, p.y - H / 2, 90)) continue; tall.push({ y: atStation(p) ? -1e6 : p.y + 14, draw: () => drawTrackSeg(p, P[(i + 1) % n], i) }); }
  for (let i = CO.carts - 1; i >= 0; i--) { const c = coasterCart(T, coast.s, i); if (inView(c.x, c.y - H, 140)) tall.push({ y: cartKey(c), draw: () => drawCart(c, i) }); }
}
function drawTrackSeg(p0, p1, i) {
  const H = CO.H, dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len * .6, line = (x0, y0, x1, y1, w, c) => { ctx.lineWidth = w; ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
  ctx.save(); ctx.lineCap = "round";
  ctx.fillStyle = "rgba(0,0,0,.2)"; ctx.beginPath(); ctx.ellipse((p0.x + p1.x) / 2, (p0.y + p1.y) / 2 + 3, len * .75, 8, Math.atan2(dy, dx), 0, 7); ctx.fill();   // its shadow on the ground
  if (i % 4 === 0) {   // a trestle bent: two white legs and a brace
    const ax = p0.x + nx * 18, ay = p0.y + ny * 18, bx = p0.x - nx * 18, by = p0.y - ny * 18;
    for (const [x, y] of [[ax, ay], [bx, by]]) { line(x, y, x, y - H, 7, "#241b16"); line(x, y, x, y - H, 4, "#e6dfcd"); }
    line(ax, ay - 6, bx, by - H + 8, 3, "#241b16"); line(ax, ay - 6, bx, by - H + 8, 1.5, "#cfc6b0"); line(bx, by - 6, ax, ay - H + 8, 3, "#241b16"); line(bx, by - 6, ax, ay - H + 8, 1.5, "#cfc6b0");
  }
  line(p0.x, p0.y - H + 7, p1.x, p1.y - H + 7, 17, "#241b16"); line(p0.x, p0.y - H + 7, p1.x, p1.y - H + 7, 13, i % 2 ? "#d9d0ba" : "#cdc3ab");   // the deck beam
  ctx.lineCap = "butt"; line(p0.x + nx * 22, p0.y - H + ny * 22, p0.x - nx * 22, p0.y - H - ny * 22, 5, "#5a3d27"); line((p0.x + p1.x) / 2 + nx * 22, (p0.y + p1.y) / 2 - H + ny * 22, (p0.x + p1.x) / 2 - nx * 22, (p0.y + p1.y) / 2 - H - ny * 22, 5, "#6b4a2e");   // sleepers
  ctx.lineCap = "round"; for (const sg of [-1, 1]) { line(p0.x + nx * 15 * sg, p0.y - H + ny * 15 * sg, p1.x + nx * 15 * sg, p1.y - H + ny * 15 * sg, 4, "#23272d"); line(p0.x + nx * 15 * sg, p0.y - H + ny * 15 * sg - .5, p1.x + nx * 15 * sg, p1.y - H + ny * 15 * sg - .5, 1.6, "#c3ccd6"); }   // rails
  if (i % 3 === 0) { const on = (i * 7 + Math.floor(gnow() / 400)) % 11 !== 0, bx = p0.x, by = p0.y - H + 15; ctx.fillStyle = on ? "#ffd98a" : "#6a5a3a"; ctx.beginPath(); ctx.arc(bx, by, 2.4, 0, 7); ctx.fill();   // a string of bulbs under the deck (one in eleven is dark, and it moves along)
    if (on) { ctx.globalCompositeOperation = "lighter"; const g = ctx.createRadialGradient(bx, by, 0, bx, by, 11); g.addColorStop(0, "rgba(255,190,90,.5)"); g.addColorStop(1, "rgba(255,150,40,0)"); ctx.fillStyle = g; ctx.fillRect(bx - 11, by - 11, 22, 22); } }
  ctx.restore();
}
function drawCart(c, i) {   // views in the strip: driving down, down-right, right, up-right, up (left ones mirrored)
  const mn = coast.mn, img = mn ? mineCartImg : cartImg, CI = mn ? MN_CART : CV_CART, k = mn ? 1 : .82;
  if (!img.naturalWidth) return; const ax = Math.cos(c.a), ay = Math.sin(c.a), v = Math.round(Math.atan2(Math.abs(ax), ay) / (Math.PI / 4)), moving = !(state.coasterWait > 0), jit = moving ? Math.sin(gnow() / 38 + i * 2) * (mn ? 1.1 : .8) : 0;
  const flip = mn && (v === 1 || v === 3) ? ax > 0 : ax < 0;   // (the mine cart's three-quarter views were drawn facing left)
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.translate(Math.round(c.x), Math.round(c.y - CO.H + 8 + jit)); if (flip) ctx.scale(-1, 1);
  if (mn) { ctx.fillStyle = "rgba(0,0,0,.32)"; ctx.beginPath(); ctx.ellipse(0, -4, CI.w * .42, 12, 0, 0, 7); ctx.fill(); }   // its shadow on the rails
  ctx.drawImage(img, v * CI.w, 0, CI.w, CI.h, -CI.w / 2 * k, -CI.h * k, CI.w * k, CI.h * k); ctx.restore();
  if (mn && i === 0 && moving) { const hx = c.x + ax * 70, hy = c.y - 30 + ay * 46; ctx.save(); ctx.globalCompositeOperation = "lighter"; const g = ctx.createRadialGradient(hx, hy, 4, hx, hy, 90); g.addColorStop(0, "rgba(255,210,130,.32)"); g.addColorStop(1, "rgba(255,170,80,0)"); ctx.fillStyle = g; ctx.fillRect(hx - 90, hy - 90, 180, 180); ctx.restore(); }   // the front cart's lamps light the rails ahead
  // its riders, drawn straight after it (so nothing can come between), the back seat first
  const rim = Math.round(c.y - CO.H + 8 + jit) - CI.h * k * (mn ? CART_RIM_MN : CART_RIM)[v], riders = [];
  for (const p0 of state.players.values()) if (p0.ride > 0 && (p0.ride - 1) >> 1 === i) { const p = V(p0); if (p) riders.push(p); }
  riders.sort((a, b) => a.y - b.y); for (const p of riders) drawRider(p, rim);
}
// The Deep Mine (Nov 11, user: "make the surfaces blend with each other"): each patch of slate / mud / planks and the dungeon floor is painted
// through a heavily blurred mask of its shape (a shadow-blur silhouette, so it works in every browser), and big soft grime blotches
// lie across everything, so no surface has an edge: one fades into the next. All in world coordinates, so ground chunks join up.
let mbA = null, mbB = null;
function mineMasked(shape, blur, paint, vx, vy, vw, vh) {   // paint(g) draws the surface (world coords) on g; it's kept only inside the blurred shape
  if (!mbA || mbA.width !== vw || mbA.height !== vh) { mbA = document.createElement("canvas"); mbB = document.createElement("canvas"); mbA.width = mbB.width = vw; mbA.height = mbB.height = vh; }
  const a = mbA.getContext("2d"), b = mbB.getContext("2d");
  a.setTransform(1, 0, 0, 1, 0, 0); a.clearRect(0, 0, vw, vh); a.setTransform(1, 0, 0, 1, -vx, -vy); a.globalCompositeOperation = "source-over"; a.imageSmoothingEnabled = false; paint(a);
  b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, vw, vh); b.setTransform(1, 0, 0, 1, -vx - 30000, -vy); b.shadowColor = "#000"; b.shadowBlur = blur; b.shadowOffsetX = 30000; b.fillStyle = "#000"; shape(b); b.shadowColor = "transparent";
  a.setTransform(1, 0, 0, 1, 0, 0); a.globalCompositeOperation = "destination-in"; a.drawImage(mbB, 0, 0); a.globalCompositeOperation = "source-over";
  ctx.drawImage(mbA, vx, vy);
}
function mineGroundBlend(G, base, vx, vy, vw, vh) {
  const WARM = { stone: "rgba(70,46,34,.26)", mud: "rgba(30,20,14,.12)", planks: "rgba(20,12,8,.18)" };
  for (const g of G) { const pad = g.tile === "dungeon" ? 90 : 70; if (g.x > vx + vw + pad || g.x + g.w < vx - pad || g.y > vy + vh + pad || g.y + g.h < vy - pad) continue;
    if (g.tile === "dungeon") { const r = { x: g.x - 40, y: g.y - 40, w: g.w + 120, h: g.h + 120, tile: "dungeon" };
      mineMasked(c => c.fillRect(g.x + 30, g.y + 30, g.w + 60, g.h + 60), 90, c => { const m = ctx; ctx = c; try { mineDungeonFloor(r, vx, vy, vw, vh); } finally { ctx = m; } }, vx, vy, vw, vh); continue; }
    const p = pattern("m" + g.tile); if (!p) continue; const sh = softShape(g).path;
    mineMasked(c => c.fill(sh), g.tile === "planks" ? 26 : 56, c => { c.fillStyle = p; c.fillRect(vx, vy, vw, vh); c.globalCompositeOperation = "source-atop"; c.fillStyle = WARM[g.tile] || "rgba(0,0,0,0)"; c.fillRect(vx, vy, vw, vh); c.globalCompositeOperation = "source-over"; }, vx, vy, vw, vh);
  }
  const CELL = 420; for (let gy = Math.floor((vy - 300) / CELL); gy * CELL < vy + vh + 300; gy++) for (let gx = Math.floor((vx - 300) / CELL); gx * CELL < vx + vw + 300; gx++) {   // grime: big soft light and dark blotches over everything
    const h = mnHash(gx * 13 + 7, gy * 17 + 3), x = (gx + mnHash(gx, gy * 3)) * CELL, y = (gy + mnHash(gx * 5, gy)) * CELL, r = 180 + h * 220, dark = h < .62;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, dark ? `rgba(8,5,4,${.16 + h * .14})` : `rgba(150,120,95,${.03 + (h - .62) * .1})`); gr.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
}
// ---------- The Deep Mine (Nov 11): rails, chasms, the dungeon floor, the rune circle, the portal swirl, the seal crystals ----------
const mnHash = (a, b) => { let h = (Math.round(a) * 374761393 + Math.round(b) * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
let mineRailCache = null;
function mineRailPts(WW, WH) {   // the track's points, each marked if it runs over a chasm (a bridge there)
  if (mineRailCache && mineRailCache.w === WW && mineRailCache.src === decorSrc) return mineRailCache.P;
  const T = mineTrack(WW, WH), ch = (decor || []).filter(d => /^mChasm/.test(d.kind)).map(d => d.kind === "mChasm" ? [d.x, d.y, 360, 150] : [d.x, d.y, 150, 345]);
  const P = T.pts.map(p => ({ x: p.x, y: p.y, br: ch.some(([x, y, rx, ry]) => ((p.x - x) / rx) ** 2 + ((p.y - y) / ry) ** 2 < 1) }));
  mineRailCache = { w: WW, src: decorSrc, P }; return P;
}
function mineRails(vx, vy, vw, vh, WW, WH) {   // ground-level rails: a dark gravel bed, wooden sleepers, two steel rails (a timber trestle over a chasm)
  const P = mineRailPts(WW, WH), n = P.length, inR = p => p.x > vx - 70 && p.x < vx + vw + 70 && p.y > vy - 70 && p.y < vy + vh + 70;
  const runs = []; let run = null;
  for (let i = 0; i <= n; i++) { const p = P[i % n]; if (inR(p)) { if (!run) { run = [P[(i - 1 + n) % n]]; runs.push(run); } run.push(p); } else if (run) { run.push(p); run = null; } }
  ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
  const nrm = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
  for (const R of runs) {
    ctx.beginPath(); R.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.strokeStyle = "rgba(14,10,9,.38)"; ctx.lineWidth = 64; ctx.stroke(); ctx.strokeStyle = "rgba(60,48,40,.35)"; ctx.lineWidth = 50; ctx.stroke();   // the gravel bed
    for (let i = 0; i < R.length - 1; i++) { const p = R[i], q = R[i + 1]; if (!p.br) continue; const [nx, ny] = nrm(p, q);   // the bridge: two long beams, cross braces, posts dropping into the dark
      for (const sg of [-1, 1]) { ctx.strokeStyle = "#140d09"; ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(p.x + nx * 30 * sg, p.y + ny * 30 * sg); ctx.lineTo(q.x + nx * 30 * sg, q.y + ny * 30 * sg); ctx.stroke(); ctx.strokeStyle = "#5e4029"; ctx.lineWidth = 6; ctx.stroke(); }
      if (i % 2 === 0) { for (const sg of [-1, 1]) { const px = p.x + nx * 30 * sg, py = p.y + ny * 30 * sg, gp = ctx.createLinearGradient(0, py, 0, py + 60); gp.addColorStop(0, "#3a281a"); gp.addColorStop(1, "rgba(10,7,5,0)"); ctx.fillStyle = gp; ctx.fillRect(px - 3.5, py, 7, 60); } ctx.strokeStyle = "#2c1d13"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p.x + nx * 28, p.y + ny * 28); ctx.lineTo(q.x - nx * 28, q.y - ny * 28); ctx.stroke(); } }
    for (let i = 0; i < R.length - 1; i++) { const p = R[i], q = R[i + 1], [nx, ny] = nrm(p, q), L = p.br ? 36 : 27, hsh = mnHash(p.x, p.y);   // sleepers
      ctx.strokeStyle = "#160f0b"; ctx.lineWidth = 11; ctx.beginPath(); ctx.moveTo(p.x + nx * L, p.y + ny * L); ctx.lineTo(p.x - nx * L, p.y - ny * L); ctx.stroke();
      ctx.strokeStyle = hsh < .33 ? "#4a3322" : hsh < .66 ? "#553b27" : "#3f2c1e"; ctx.lineWidth = 7; ctx.stroke(); }
    for (const sg of [-1, 1]) { const line = (w, c, off = 0) => { ctx.beginPath(); for (let i = 0; i < R.length; i++) { const p = R[i], q = R[Math.min(i + 1, R.length - 1)], o = R[Math.max(i - 1, 0)], [nx, ny] = nrm(o, q); const x = p.x + nx * 14 * sg, y = p.y + ny * 14 * sg + off; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.strokeStyle = c; ctx.lineWidth = w; ctx.stroke(); };
      line(6, "#101215"); line(3.2, "#5f646c"); line(1.3, "#c4cad2", -1); }   // the rails
  }
  ctx.restore();
}
function drawChasm(d, w, h) {   // a deep crack in the cave floor: a rocky lip, the far wall falling away into black, a cold glow far below
  if (!d._ch) { let seed = (Math.round(d.x) * 7919 + Math.round(d.y) * 104729) % 2147483647 || 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, N = 64, p1 = rnd() * 7, p2 = rnd() * 7, pts = [];
    for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2, r = 1 + .1 * Math.sin(3 * a + p1) + .06 * Math.sin(7 * a + p2) + (rnd() - .5) * .09; pts.push([d.x + Math.cos(a) * w / 2 * .92 * r, d.y + Math.sin(a) * h / 2 * .92 * r]); }
    const path = new Path2D(), lip = new Path2D(); pts.forEach(([x, y], i) => i ? path.lineTo(x, y) : path.moveTo(x, y)); path.closePath();
    pts.forEach(([x, y], i) => { const X = d.x + (x - d.x) * 1.09 + (rnd() - .5) * 10, Y = d.y + (y - d.y) * 1.12 + (rnd() - .5) * 8; i ? lip.lineTo(X, Y) : lip.moveTo(X, Y); }); lip.closePath();
    const rocks = []; for (let i = 0; i < N; i += 2 + Math.floor(rnd() * 3)) { const [x, y] = pts[i]; rocks.push([d.x + (x - d.x) * (1.06 + rnd() * .1), d.y + (y - d.y) * (1.08 + rnd() * .12), 5 + rnd() * 9, rnd()]); }
    d._ch = { path, lip, rocks }; }
  const { path, lip, rocks } = d._ch, x0 = d.x - w / 2, y0 = d.y - h / 2;
  ctx.save(); ctx.fillStyle = "rgba(10,8,7,.55)"; ctx.fill(lip); ctx.fillStyle = "#2b221e"; ctx.save(); ctx.translate(0, -3); ctx.fill(lip); ctx.restore();
  ctx.fillStyle = "#020204"; ctx.fill(path); ctx.save(); ctx.clip(path);
  const D = Math.min(w, h) * .34, g = ctx.createLinearGradient(0, y0, 0, y0 + h * .55); g.addColorStop(0, "#5c4a40"); g.addColorStop(.3, "#3a2e28"); g.addColorStop(1, "#120d0c"); ctx.fillStyle = g; ctx.fillRect(x0 - 20, y0 - 20, w + 40, h + 40);   // the far wall: the rock face under the north rim...
  ctx.strokeStyle = "rgba(0,0,0,.4)"; ctx.lineWidth = 2; for (let k = 1; k < 6; k++) { const yy = y0 + h * .04 + k * D / 5; ctx.beginPath(); ctx.moveTo(x0, yy); for (let xx = x0; xx <= x0 + w; xx += 26) ctx.lineTo(xx, yy + Math.sin(xx * .05 + k * 1.7) * 5); ctx.stroke(); }   // ...with its strata
  ctx.fillStyle = "rgba(255,230,200,.05)"; for (let xx = x0; xx < x0 + w; xx += 34) ctx.fillRect(xx + (xx * 7 % 13), y0 + h * .05, 3, D * .9);   // drips down the rock
  ctx.save(); ctx.translate(0, D); const gd = ctx.createLinearGradient(0, y0, 0, y0 + 46); gd.addColorStop(0, "rgba(2,2,4,0)"); gd.addColorStop(1, "#020204"); ctx.fillStyle = "#020204"; ctx.fill(path); ctx.restore();   // ...falling away into the black
  ctx.save(); ctx.translate(0, D - 46); ctx.fillStyle = gd; ctx.fill(path); ctx.restore();
  ctx.globalCompositeOperation = "lighter"; const gl = ctx.createRadialGradient(d.x, d.y + h * .2, 6, d.x, d.y + h * .2, Math.max(w, h) * .4); gl.addColorStop(0, "rgba(40,120,220,.22)"); gl.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = gl; ctx.fillRect(x0, y0, w, h);   // a faint glow far below
  ctx.restore();
  ctx.strokeStyle = "#0b0807"; ctx.lineWidth = 4; ctx.stroke(path); ctx.strokeStyle = "rgba(170,140,115,.35)"; ctx.lineWidth = 1.5; ctx.save(); ctx.translate(0, 2); ctx.stroke(path); ctx.restore();
  for (const [x, y, r, k] of rocks) { ctx.fillStyle = "#14100e"; ctx.beginPath(); ctx.ellipse(x + 1, y + 2, r, r * .7, k * 3, 0, 7); ctx.fill(); ctx.fillStyle = k < .5 ? "#4d3e36" : "#5d4b41"; ctx.beginPath(); ctx.ellipse(x, y, r * .85, r * .6, k * 3, 0, 7); ctx.fill(); }
  ctx.restore();
}
function mineDungeonFloor(g, vx, vy, vw, vh) {   // the boss dungeon's floor: big dark carved slabs, some joints glowing with faint blue runes
  const ax = Math.max(g.x, vx), ay = Math.max(g.y, vy), bx = Math.min(g.x + g.w, vx + vw), by = Math.min(g.y + g.h, vy + vh); if (bx <= ax || by <= ay) return;
  ctx.save(); ctx.beginPath(); ctx.rect(ax, ay, bx - ax, by - ay); ctx.clip();
  const p = pattern("mstone"); ctx.fillStyle = p || "#2b2833"; ctx.fillRect(ax, ay, bx - ax, by - ay); ctx.fillStyle = "rgba(16,20,40,.58)"; ctx.fillRect(ax, ay, bx - ax, by - ay);
  const SW = 128, SH = 92;
  for (let r = Math.floor((ay - g.y) / SH) - 1; r * SH + g.y < by + SH; r++) for (let c = Math.floor((ax - g.x) / SW) - 2; c * SW + g.x < bx + SW; c++) {
    const x = g.x + c * SW + (r % 2 ? SW / 2 : 0), y = g.y + r * SH, hh = mnHash(c * 3 + 11, r * 7 + 5);
    ctx.fillStyle = hh < .3 ? "rgba(255,255,255,.035)" : hh > .8 ? "rgba(0,0,0,.18)" : "rgba(0,0,0,.06)"; ctx.fillRect(x + 3, y + 3, SW - 6, SH - 6);
    ctx.strokeStyle = "#07080e"; ctx.lineWidth = 4; ctx.strokeRect(x, y, SW, SH); ctx.strokeStyle = "rgba(150,150,190,.10)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + 3, y + SH - 3); ctx.lineTo(x + 3, y + 3); ctx.lineTo(x + SW - 3, y + 3); ctx.stroke();
    if (hh > .86) { ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + SW * .2, y + SH * .3); ctx.lineTo(x + SW * .45, y + SH * .55); ctx.lineTo(x + SW * .4, y + SH * .85); ctx.stroke(); }   // a crack
    if (hh > .1 && hh < .24) { ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = "rgba(70,160,255,.42)"; ctx.lineWidth = 2; ctx.shadowColor = "#3aa0ff"; ctx.shadowBlur = 6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + SW, y); ctx.stroke(); ctx.restore(); }   // a rune-lit joint
    if (hh > .45 && hh < .5) { ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = "rgba(90,180,255,.5)"; ctx.lineWidth = 2; const mx = x + SW / 2, my = y + SH / 2; ctx.beginPath(); ctx.moveTo(mx, my - 16); ctx.lineTo(mx, my + 16); ctx.moveTo(mx, my - 6); ctx.lineTo(mx - 9, my - 14); ctx.moveTo(mx, my - 6); ctx.lineTo(mx + 9, my - 14); ctx.moveTo(mx, my + 4); ctx.lineTo(mx - 9, my - 4); ctx.moveTo(mx, my + 4); ctx.lineTo(mx + 9, my - 4); ctx.stroke(); ctx.restore(); }   // a carved rune
  }
  ctx.restore();
}
function drawRuneCircle(d) {   // where the Mine Beast's statue will stand: a great carved circle of glowing runes, slowly turning
  if (!inView(d.x, d.y, 320)) return; const t = gnow() / 1000, k = .75 + .25 * Math.sin(t * 1.3);
  ctx.save(); ctx.translate(d.x, d.y); ctx.scale(.72, .56 * .72);   /* (sized to the statue: Nov 11, the statue came down to the Beast's own size) */
  ctx.fillStyle = "rgba(4,6,14,.55)"; ctx.beginPath(); ctx.arc(0, 0, 252, 0, 7); ctx.fill();
  ctx.globalCompositeOperation = "lighter";
  const gl = ctx.createRadialGradient(0, 0, 10, 0, 0, 250); gl.addColorStop(0, `rgba(60,150,255,${.22 * k})`); gl.addColorStop(1, "rgba(20,60,140,0)"); ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, 250, 0, 7); ctx.fill();
  ctx.strokeStyle = `rgba(90,180,255,${.55 * k})`; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, 238, 0, 7); ctx.stroke();
  ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 204, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, 112, 0, 7); ctx.stroke();
  ctx.save(); ctx.rotate(t * .06); for (let i = 0; i < 28; i++) { ctx.rotate(Math.PI * 2 / 28); const s = i % 3; ctx.beginPath(); ctx.moveTo(-5, -232); ctx.lineTo(0, -212); ctx.lineTo(5, -232); if (s === 1) { ctx.moveTo(0, -232); ctx.lineTo(0, -210); } if (s === 2) { ctx.moveTo(-6, -222); ctx.lineTo(6, -222); } ctx.stroke(); } ctx.restore();   // the runes round the rim
  ctx.save(); ctx.rotate(-t * .04); ctx.strokeStyle = `rgba(90,180,255,${.38 * k})`; ctx.beginPath(); for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + i * Math.PI * 4 / 5; i ? ctx.lineTo(Math.cos(a) * 200, Math.sin(a) * 200) : ctx.moveTo(Math.cos(a) * 200, Math.sin(a) * 200); } ctx.stroke(); ctx.restore();   // a five-pointed seal
  ctx.restore();
}
function drawWard(d) {   // the rune-ward sealing a way into the boss dungeon: a shimmering curtain of blue light with runes drifting up it (the carts pass through)
  if (!inView(d.x, d.y, 260)) return; const t = gnow() / 1000, H = 150, k = .75 + .25 * Math.sin(t * 2.4);
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  const quad = d.flip ? [[d.x, d.y - 100], [d.x, d.y + 110]] : [[d.x - 98, d.y], [d.x + 98, d.y]], [[x0, y0], [x1, y1]] = quad;
  const g = ctx.createLinearGradient(0, Math.max(y0, y1), 0, Math.min(y0, y1) - H); g.addColorStop(0, `rgba(90,190,255,${.42 * k})`); g.addColorStop(.6, `rgba(60,140,255,${.18 * k})`); g.addColorStop(1, "rgba(40,100,255,0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1, y1 - H); ctx.lineTo(x0, y0 - H); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = `rgba(150,220,255,${.8 * k})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();   // its foot line
  ctx.lineWidth = 1.6; for (let i = 0; i < 7; i++) { const u = (t * .32 + i / 7) % 1, f = (i * .37 + .1) % 1, x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f - u * H; ctx.globalAlpha = Math.sin(u * Math.PI) * .9; ctx.strokeStyle = "#bfe8ff";   // runes drifting up
    ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7); ctx.moveTo(x, y - 2); ctx.lineTo(x - 5, y - 7); ctx.moveTo(x, y - 2); ctx.lineTo(x + 5, y - 7); ctx.moveTo(x - 4, y + 3); ctx.lineTo(x + 4, y + 3); ctx.stroke(); }
  ctx.restore();
}
function statueFx(d, a) {   // the sleeping Mine Beast: its plinth's runes glow faintly (later: one lights up bright per rune put in), a thin mist round its feet
  const t = gnow() / 1000; ctx.save(); ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 5; i++) { const u = (t * .05 + i / 5) % 1, x = d.x - 260 + ((i * 137 + t * 9) % 520), y = d.y - 12 - Math.sin(u * Math.PI) * 10; ctx.globalAlpha = .12 * Math.sin(u * Math.PI); const g = ctx.createRadialGradient(x, y, 2, x, y, 70); g.addColorStop(0, "rgba(160,190,230,1)"); g.addColorStop(1, "rgba(160,190,230,0)"); ctx.fillStyle = g; ctx.fillRect(x - 70, y - 40, 140, 80); }
  ctx.restore();
}
function drawBossStop(d) {   // the carts' stop in the boss dungeon: a low stone platform behind the rails, its edge lit by a line of runes
  if (!inView(d.x, d.y, 260)) return; const w = 300, h = 74, x = d.x - w / 2, y = d.y - h, t = gnow() / 1000;
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(x - 6, y + 8, w + 12, h + 4);
  ctx.fillStyle = pattern("mstone") || "#3b3742"; ctx.fillRect(x, y, w, h); ctx.fillStyle = "rgba(170,175,210,.16)"; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#0a0b12"; ctx.lineWidth = 3; for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(x + i * w / 5, y); ctx.lineTo(x + i * w / 5, y + h); ctx.stroke(); } ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = "#24222e"; ctx.fillRect(x, y + h - 14, w, 14); ctx.fillStyle = "rgba(200,200,235,.35)"; ctx.fillRect(x, y, w, 3); ctx.strokeStyle = "#08080d"; ctx.lineWidth = 4; ctx.strokeRect(x, y, w, h);   // its front edge, the lit top edge
  ctx.globalCompositeOperation = "lighter"; for (let i = 0; i < 9; i++) { const rx = x + 18 + i * (w - 36) / 8, k = .5 + .5 * Math.sin(t * 3 - i * .7); ctx.fillStyle = `rgba(110,200,255,${.35 + .45 * k})`; ctx.fillRect(rx - 4, y + h - 8, 8, 3); }
  ctx.restore();
}
function shrineFx(d) {   // a rune shrine: its rune floats and turns over the pedestal, glowing (in the mission: only until someone takes it)
  const i = Math.max(0, decor.filter(q => q.kind === "mShrine").indexOf(d)) % 4, D = deepState(); if (D && D.runes[i] && D.runes[i].st !== 0) return; const img = mapImgs["mRune" + (i + 1)], t = gnow() / 1000; if (!img?.naturalWidth) return;
  const x = d.x, y = d.y - 128 + Math.sin(t * 1.8 + i) * 7, sq = .75 + .25 * Math.cos(t * 1.2 + i);
  ctx.save(); ctx.globalCompositeOperation = "lighter"; const g = ctx.createRadialGradient(x, y - 40, 4, x, y - 40, 90); g.addColorStop(0, "rgba(100,200,255,.45)"); g.addColorStop(1, "rgba(40,120,255,0)"); ctx.fillStyle = g; ctx.fillRect(x - 90, y - 130, 180, 180); ctx.restore();
  ctx.save(); ctx.translate(x, y); ctx.scale(sq, 1); ctx.drawImage(img, -img.width / 2, -img.height); ctx.restore();
}
function portalFx(d, a) {   // the portal: the user's swirl turning inside the black arch, light spilling down the steps
  const [dx, dy, w, h] = a.door, f0 = d.flip ? -1 : 1, x = d.x + dx * f0, y = d.y + dy, cx = x, cy = y + h * .5, t = gnow() / 1000;
  ctx.save(); ctx.beginPath(); ctx.moveTo(x - w / 2 + 2, y + h); ctx.lineTo(x - w / 2 + 2, y + w / 2); ctx.ellipse(x, y + w / 2 + 2, w / 2 - 2, w / 2, 0, Math.PI, Math.PI * 2); ctx.lineTo(x + w / 2 - 2, y + h); ctx.closePath(); ctx.clip();
  ctx.globalCompositeOperation = "lighter";
  if (portalFxImg.naturalWidth) { const F = MN_FX.portal, ft = t * 1000 / F.ms, fi = Math.floor(ft) % F.n, f2 = (fi + 1) % F.n, k = ft - Math.floor(ft), S = Math.max(w, h) * 1.18;
    ctx.translate(cx, cy); ctx.rotate(t * .3); ctx.globalAlpha = 1 - k * .5; ctx.drawImage(portalFxImg, fi * F.s, 0, F.s, F.s, -S / 2, -S / 2, S, S); ctx.globalAlpha = k * .5; ctx.drawImage(portalFxImg, f2 * F.s, 0, F.s, F.s, -S / 2, -S / 2, S, S); }
  ctx.restore();
  ctx.save(); ctx.globalCompositeOperation = "lighter"; const p = .8 + .2 * Math.sin(t * 2.1);
  const g = ctx.createRadialGradient(cx, cy, 6, cx, cy, w * .9); g.addColorStop(0, `rgba(160,220,255,${.35 * p})`); g.addColorStop(1, "rgba(40,110,255,0)"); ctx.fillStyle = g; ctx.fillRect(cx - w, cy - w, w * 2, w * 2);
  const s = ctx.createRadialGradient(cx, y + h + 40, 10, cx, y + h + 40, 190); s.addColorStop(0, `rgba(70,160,255,${.28 * p})`); s.addColorStop(1, "rgba(30,90,200,0)"); ctx.fillStyle = s; ctx.fillRect(cx - 190, y + h - 150, 380, 340);   // on the steps
  for (let i = 0; i < 8; i++) { const u = (t * .35 + i / 8) % 1, ang = i * 2.4 + t * .5, r = (1 - u) * w * .55; ctx.globalAlpha = Math.sin(u * Math.PI) * .9; ctx.fillStyle = "#cfeeff"; ctx.fillRect(cx + Math.cos(ang) * r - 1.5, cy + Math.sin(ang) * r * 1.3 - 1.5, 3, 3); }   // motes drawn in
  ctx.restore();
}
function sealFx(d, a) {   // a seal crystal: breathing blue halo, a ring of runes turning at its foot, sparks rising
  const t = gnow() / 1000, sd = (d.x * 7 + d.y) % 10, b = a.blue?.[0] || [0, -130], f0 = d.flip ? -1 : 1, x = d.x + b[0] * f0, y = d.y + b[1], k = .7 + .3 * Math.sin(t * 2.2 + sd);
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(x, y, 4, x, y, 96); g.addColorStop(0, `rgba(120,210,255,${.42 * k})`); g.addColorStop(1, "rgba(40,120,255,0)"); ctx.fillStyle = g; ctx.fillRect(x - 96, y - 96, 192, 192);
  ctx.strokeStyle = `rgba(120,205,255,${.6 * k})`; ctx.lineWidth = 2; ctx.setLineDash([7, 9]); ctx.lineDashOffset = -t * 24; ctx.beginPath(); ctx.ellipse(d.x, d.y - 10, 70, 22, 0, 0, 7); ctx.stroke(); ctx.lineDashOffset = t * 16; ctx.beginPath(); ctx.ellipse(d.x, d.y - 10, 54, 16, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  for (let i = 0; i < 6; i++) { const u = (t * .45 + i / 6 + sd * .1) % 1; ctx.globalAlpha = Math.sin(u * Math.PI); ctx.fillStyle = i % 2 ? "#bfe9ff" : "#7fd0ff"; ctx.fillRect(x + Math.sin(i * 2.3 + t) * 34 - 1.5, y + 40 - u * 140, 3, 3); }
  ctx.restore();
}
// ---------- WAVE 20: the Deep Mine mission (server: DEEP / mineTick). state.mission = step|fuel|placed|cartHp|gap|inserted|runes ----------
const DEEP_UI = { fuelCost: 5, takeR: 130, insertR: 210, ovR: 150 };   // ovR: the shield run's overload reach (server BEAST.shield.ovR)
let deepSrc = null, deepCache = null;
function deepState() {   // the mission, unpacked (null = no mission running)
  const src = state?.mission || ""; if (src === deepSrc) return deepCache; deepSrc = src; if (!src) return (deepCache = null);
  const [step, fuel, placed, cartHp, gap, ins, runes, crys, sh, ss] = src.split("|"), shp = sh ? sh.split(".") : null;
  return (deepCache = { step, fuel: +fuel, placed: +placed, cartHp: +cartHp, gap: +gap, inserted: ins === "1", crystals: crys === undefined ? 4 : +crys, sh: shp ? { i: +shp[0], ov: +shp[1], t: +shp[2], by: shp[3] || "" } : null, ss: ss === undefined || ss === "" ? -1 : +ss, runes: (runes || "").split(",").map(r => { const [st, x, y, by] = r.split("."); return { st: +st, x: +x, y: +y, by: by || "" }; }) });
}
const deepFx = { start: -1e9, rune: -1e9, runeN: 0, awake: -1e9, awakeLen: 7, chase: -1e9, smash: -1e9, escaped: -1e9, shatter: [] };
function onDeep(m) {
  const now = gnow();
  if (m.k === "start") { deepFx.start = now; deepFx.awake = deepFx.chase = deepFx.escaped = -1e9; deepFx.shatter = []; deepObj.id = ""; }
  else if (m.k === "take") playSfx("pickup", undefined, undefined, .8);
  else if (m.k === "rune") { deepFx.rune = now; deepFx.runeN = m.n; deepFx.shatter.push({ i: m.n - 1, t: now }); shake(6, 500); playSfx("zap", undefined, undefined, 1); }
  else if (m.k === "awake") { deepFx.awake = now; deepFx.awakeLen = m.len || 7; shake(5, 1200); }
  else if (m.k === "chase") { deepFx.chase = now; shake(14, 900); }
  else if (m.k === "stagger") { deepFx.stagger = now; playSfx("zap", undefined, undefined, .5); }
  else if (m.k === "smash") { deepFx.smash = now; shake(18, 700); playSfx("stomp", undefined, undefined, 1); }
  else if (m.k === "escaped") deepFx.escaped = now;
  else onBeastMsg(m, now);
}
const deepPieces = () => { const sh = [], o = { shrines: sh, statue: null, seals: [], portal: null }; for (const d of decor || []) { if (d.kind === "mShrine") sh.push(d); else if (d.kind === "mStatue") o.statue = d; else if (/^mSeal/.test(d.kind)) o.seals.push(d); else if (d.kind === "mPortal") o.portal = d; } return o; };
const deepInDungeon = e => { const WW = worldW(), WH = worldH(); return e.x > (MN_SPOT.dungeon[0] + 85) * WW / 6000 && e.y > (MN_SPOT.dungeon[1] + 120) * WH / 4000; };
// What YOU should do right now: { id (changes = a new pop-up), title, sub, at: where the arrow points }
function deepObjective() {
  const D = deepState(), me = me_(); if (!D || !me || !coast) return null; const now = gnow();
  if (now - deepFx.start < 5000 && D.step === "runes") return { id: "intro", title: "WAVE 20 · THE DEEP MINE", sub: "Put 4 runes in the statue. Then outrun what wakes up." };
  const st0 = coast.T.stations[0], bs = coast.T.stations[1], P = deepPieces(), mine = D.runes.find(r => r.st === 1 && r.by === myId), other = D.runes.find(r => r.st === 1 && r.by !== myId), inD = deepInDungeon(me), n = D.placed + 1;
  const station = { x: st0.x, y: st0.y + 60, label: "CARTS" }, stop = { x: bs.x, y: bs.y - 60, label: "CARTS" };
  if (D.step === "escaped") return { id: "esc", title: "YOU ESCAPED!", sub: "Through the portal…" };
  if (D.step === "awake") return { id: "aw", title: "IT'S BREAKING ITS CHAINS!", sub: "Get ready to fight." };
  if (D.step === "fight" && (D.sh || D.ss >= 0)) {   // THE SHIELD RUN: one rider to the glowing shrine, the rest hold it off
    const shp = P.shrines[D.sh ? D.sh.i : D.ss], shAt = shp ? { x: shp.x, y: shp.y + 20, label: "SHRINE" } : null, rs = coast.T.stations.find(q => q.shrine !== undefined), rsAt = rs ? { x: rs.x, y: rs.y + 30, label: "CART" } : null, heal = D.sh ? ` · it heals in ${Math.max(0, D.sh.t)}s` : "";
    if (me.ride > 0) return D.sh ? { id: "sr-ride", title: "RIDING TO THE SHRINE", sub: "You can't be hurt while you ride. The cart drops you at its stop: then press F at the glowing shrine." + heal } : { id: "sr-back", title: "HEADING BACK", sub: "Safe in the cart. Express to the boss dungeon: hop off and fight!" };
    if (!inD) return D.sh ? (D.sh.by === myId ? { id: "sr-ov", small: 1, title: `OVERLOADING · ${D.sh.ov}%`, sub: "Stay close to the shrine!" } : { id: "sr-go", title: "OVERLOAD THE SHRINE", sub: "Stand at the glowing shrine, press F and stay 3s." + heal, at: shAt })
      : { id: "sr-home", title: "THE SHIELD IS DOWN!", sub: "Get back in the cart: it leaves as soon as you're on.", at: rsAt };
    if (D.sh) { const out = [...state.players.values()].some(q => q.alive && q.sessionId !== myId && (q.ride > 0 || !deepInDungeon(q)));
      return out ? { id: "sr-hold", small: 1, title: "HOLD IT OFF", sub: "A teammate is on the shield run." + heal } : { id: "sr-start", title: "IT'S SHIELDED!", sub: "ONE survivor rides the cart (F at the boss stop): it leaves at once, and riders can't be hurt. The rest hold it off." + heal, at: stop }; } }
  if (D.step === "fight") { let bz = null; for (const z of state.zombies.values()) if (z.kind === "minebeast") bz = z; const act = bz?.act;
    return act === "wind" ? { id: "f-wind", small: 1, title: "SHOOT IT NOW!", sub: "Enough damage breaks its charge. Or get out of the red lane." } : act === "dive" || act === "under" || act === "erupt" ? { id: "f-under", small: 1, title: "IT'S UNDER THE FLOOR", sub: "Keep moving. Get out of the red circle." }
      : act === "stagger" ? { id: "f-stag", small: 1, title: "IT'S STAGGERED!", sub: "Hit it with everything." } : act === "roar" ? { id: "f-cave", small: 1, title: "CAVE-IN!", sub: "Get out of the red circles." } : act === "throw" ? { id: "f-spine", small: 1, title: "CRYSTALS!", sub: "Get away from the blue circles before they burst." }
      : { id: "fight", small: now - (deepFx.fight || 0) > 6000 ? 1 : 0, title: "FIGHT THE MINE BEAST", sub: "Empty its health bar. Stay out of the red marks." }; }
  if (D.step === "flee") return me.ride > 0 ? { id: "fl2", title: "HOLD ON", sub: "Leaving when everyone is aboard." } : { id: "fl1", title: "IT WON'T STAY DOWN!", sub: "Get in the carts: press F.", at: stop };
  if (D.step === "chase") return me.ride > 0 ? { id: "ch1", title: "SHOOT THE BEAST!", sub: "Every hit pushes it back. Don't let it reach the carts." } : { id: "ch2", title: "THE BEAST IS LOOSE", sub: "It's chasing the carts. Stay alive." };
  if (me.ride > 0) {
    if (state.coasterWait > 0 && coastStation() === st0) return mine ? (D.fuel < DEEP_UI.fuelCost ? { id: "s-fuel", title: `THE CARTS NEED FUEL · ${D.fuel}/${DEEP_UI.fuelCost}`, sub: "Someone must pick up blue shards. Zombies drop them." } : { id: "s-go", title: "HOLD ON", sub: "The carts are leaving for the boss dungeon." })
      : { id: "s-norune", title: "NO RUNE ABOARD", sub: "The carts only leave with a rune. Find one first.", at: null };
    if (coastStation() === bs) return mine && !D.inserted ? { id: "b-off", title: "HOP OFF: PRESS F", sub: "Then carry the rune to the statue." } : D.inserted ? { id: "b-wait", title: "RUNE IS IN", sub: "Leaving when everyone is back on." } : { id: "b-wait2", title: "AT THE BOSS STOP", sub: "The rune carrier hops off (F) and goes to the statue." };
    return D.inserted ? { id: "r-back", title: "HEADING BACK", sub: n <= 4 ? `Next: find rune ${n} of 4.` : "" } : { id: "r-out", title: "RIDING TO THE BOSS DUNGEON", sub: "Shoot from the cart." };
  }
  if (inD) return mine && !D.inserted ? { id: "d-put", title: "PUT THE RUNE IN THE STATUE", sub: "Walk to the statue. Press F.", at: P.statue ? { x: P.statue.x, y: P.statue.y + 30, label: "STATUE" } : null }
    : { id: "d-back", title: "GET BACK IN THE CARTS", sub: "Press F at the carts.", at: stop };
  if (mine) return D.fuel < DEEP_UI.fuelCost ? { id: "c-fuel", title: `GET FUEL FOR THE CARTS · ${D.fuel}/${DEEP_UI.fuelCost}`, sub: "Walk over blue shards. Zombies drop them.", at: deepNearestShard(me) || station }
    : { id: "c-go", title: "TAKE THE RUNE TO THE CARTS", sub: "Get in (F). They leave with you aboard.", at: station };
  if (other) { const who = state.players.get(other.by)?.name || "A teammate";
    return D.fuel < DEEP_UI.fuelCost ? { id: "o-fuel", title: `COLLECT FUEL · ${D.fuel}/${DEEP_UI.fuelCost}`, sub: `${who} has the rune. Walk over blue shards.`, at: deepNearestShard(me) } : { id: "o-go", title: "GET IN THE CARTS", sub: `${who} has the rune. Ride with them.`, at: station }; }
  const free = D.runes.filter(r => r.st === 0 || r.st === 2).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
  return free ? { id: "find" + n + (free.st === 2 ? "d" : ""), title: free.st === 2 ? "PICK UP THE DROPPED RUNE" : `FIND RUNE ${n} OF 4`, sub: free.st === 2 ? "Follow the arrow. Press F." : "Follow the blue arrow to a shrine. Press F to take it.", at: { x: free.x, y: free.y - 20, label: "RUNE" } } : null;
}
function deepNearestShard(me) { let best = null, bd = 1e9; for (const l of state.loot.values()) if (l.kind === "shard") { const d = Math.hypot(l.x - me.x, l.y - me.y); if (d < bd) { bd = d; best = l; } } return best ? { x: best.x, y: best.y, label: "FUEL" } : null; }
// F in the mission: take a rune / put it in the statue. Returns the prompt text (or "" when there's nothing to do here).
function deepPrompt() {
  const D = deepState(), me = me_(); if (D?.step === "fight" && D.sh && me?.alive && !(me.ride > 0)) { const d = deepPieces().shrines[D.sh.i]; return d && Math.hypot(me.x - d.x, me.y - (d.y + 34)) < DEEP_UI.ovR ? (D.sh.by === myId ? `OVERLOADING ${D.sh.ov}% · STAY CLOSE` : "[F] OVERLOAD THE SHRINE") : ""; }   // the shield run
  if (!D || D.step !== "runes" || !me?.alive || me.ride > 0) return "";
  const mine = D.runes.find(r => r.st === 1 && r.by === myId), P = deepPieces();
  if (mine) return !D.inserted && P.statue && deepInDungeon(me) && Math.hypot(me.x - P.statue.x, me.y - (P.statue.y + 20)) < DEEP_UI.insertR ? "[F] PUT THE RUNE IN" : "";
  return D.runes.some(r => (r.st === 0 || r.st === 2) && Math.hypot(me.x - r.x, me.y - r.y) < DEEP_UI.takeR) ? "[F] TAKE THE RUNE" : "";
}
function deepUse() { if (!deepPrompt() || !room) return false; room.send("deep"); return true; }
function drawDeepPrompt() {   // screen space, over your head
  const text = deepPrompt(); if (!text) return false; const v = V(me_()), x = v.x - Math.round(cam.x), y = v.y - Math.round(cam.y) - 96;
  ctx.save(); ctx.font = "bold 15px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; const w = ctx.measureText(text).width + 22;
  ctx.fillStyle = "rgba(6,10,18,.78)"; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 17, w, 25, 7); ctx.fill(); ctx.strokeStyle = "#7fd4ff"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = "#bfe9ff"; ctx.fillText(text, x, y + 1); ctx.restore(); return true;
}
// The objective pop-up (user, Nov 11: "clear pop up instructions for every part, to the point"): a new objective drops in big for a few
// seconds with a chime, then shrinks to a small tracker under the top bars that stays until the next one.
const deepObj = { id: "", t: -1e9, title: "", sub: "" }, deepCam = { x: 0, y: 0 };
function drawDeepHud() {
  const D = deepState(); if (!D || state.phase !== "playing") { deepObj.id = ""; return; }
  const o = deepObjective(), now = gnow(); if (o && o.id !== deepObj.id) { deepObj.id = o.id; deepObj.t = o.small ? now - 3600 : now; if (!o.small) playSfx("pickup", undefined, undefined, .6); }   /* small: a quick hint in the tracker line only (no big banner) */ if (o) { deepObj.title = o.title; deepObj.sub = o.sub || ""; }
  if (!deepObj.id) return;
  const age = (now - deepObj.t) / 1000, big = age < 3.6, k = big ? Math.min(1, age / .22) : Math.max(0, 1 - (age - 3.6) / .35), e = 1 - (1 - k) * (1 - k), cx = W / 2;
  ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  if (age < 3.95) {   // the big pop-up
    const y = 232 - (big ? (1 - e) * 26 : (1 - e) * 100), sc = big ? .86 + .14 * e : .6 + .4 * e; ctx.globalAlpha = e; ctx.translate(cx, y); ctx.scale(sc, sc);
    ctx.font = "800 30px Inter, system-ui, sans-serif"; const tw = ctx.measureText(deepObj.title).width; ctx.font = "600 16px Inter, system-ui, sans-serif"; const sw = ctx.measureText(deepObj.sub).width, w = Math.max(tw, sw) + 64, h = deepObj.sub ? 84 : 58;
    ctx.fillStyle = "rgba(5,9,16,.86)"; ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 10); ctx.fill(); ctx.strokeStyle = "#5cc8ff"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#5cc8ff"; ctx.fillRect(-w / 2, -h / 2, 6, h);
    ctx.font = "800 30px Inter, system-ui, sans-serif"; ctx.fillStyle = "#eaf7ff"; ctx.fillText(deepObj.title, 0, deepObj.sub ? -14 : 1);
    if (deepObj.sub) { ctx.font = "600 16px Inter, system-ui, sans-serif"; ctx.fillStyle = "#a9d7f2"; ctx.fillText(deepObj.sub, 0, 20); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  if (age >= 3.6) {   // the small tracker
    const a = Math.min(1, (age - 3.6) / .35), y = 104; ctx.globalAlpha = a;
    ctx.font = "800 15px Inter, system-ui, sans-serif"; const tw = ctx.measureText(deepObj.title).width; ctx.font = "500 13px Inter, system-ui, sans-serif"; const sw = deepObj.sub ? ctx.measureText(deepObj.sub).width + 14 : 0, w = tw + sw + 46;
    ctx.fillStyle = "rgba(5,9,16,.74)"; ctx.beginPath(); ctx.roundRect(cx - w / 2, y - 15, w, 30, 8); ctx.fill(); ctx.strokeStyle = "rgba(92,200,255,.7)"; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = "#5cc8ff"; ctx.beginPath(); ctx.moveTo(cx - w / 2 + 12, y - 6); ctx.lineTo(cx - w / 2 + 21, y); ctx.lineTo(cx - w / 2 + 12, y + 6); ctx.closePath(); ctx.fill();
    ctx.textAlign = "left"; ctx.font = "800 15px Inter, system-ui, sans-serif"; ctx.fillStyle = "#eaf7ff"; ctx.fillText(deepObj.title, cx - w / 2 + 30, y + 1);
    if (deepObj.sub) { ctx.font = "500 13px Inter, system-ui, sans-serif"; ctx.fillStyle = "#a9d7f2"; ctx.fillText(deepObj.sub, cx - w / 2 + 30 + tw + 14, y + 1); }
  }
  // progress row: the four runes, the fuel, and in the chase the carts' hits left + how close the Beast is
  ctx.globalAlpha = 1; ctx.textAlign = "left"; ctx.textBaseline = "middle"; const y = 146, RW = 352; let x = cx - RW / 2 + 14;
  ctx.fillStyle = "rgba(5,9,16,.78)"; ctx.beginPath(); ctx.roundRect(cx - RW / 2, y - 21, RW, 42, 9); ctx.fill(); ctx.strokeStyle = "rgba(92,200,255,.35)"; ctx.lineWidth = 1; ctx.stroke();
  ctx.font = "700 12px Inter, system-ui, sans-serif"; ctx.fillStyle = "#a9d7f2"; ctx.fillText("RUNES", x, y + 1); x += 48;
  const carried = D.runes.filter(q => q.st === 1).length;
  for (let i = 0; i < 4; i++) { const img = mapImgs["mRune" + (i + 1)], st = i < D.placed ? 3 : i < D.placed + carried ? 1 : 0;
    ctx.globalAlpha = st === 3 ? 1 : st === 1 ? .65 + .35 * Math.sin(now / 160) : .3; if (img?.naturalWidth) ctx.drawImage(img, x, y - 16, 24, 32); if (st === 3) { ctx.globalAlpha = 1; ctx.fillStyle = "#7dffa0"; ctx.fillRect(x + 7, y + 17, 10, 2); } x += 29; }
  ctx.globalAlpha = 1; ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fillRect(x + 4, y - 13, 1, 26); x += 16; ctx.fillStyle = "#a9d7f2";
  if (D.step === "chase" || D.step === "escaped") { ctx.fillText("CARTS", x, y + 1); x += 46; for (let i = 0; i < 5; i++) { ctx.fillStyle = i < D.cartHp ? "#ff6b5c" : "rgba(255,255,255,.2)"; ctx.fillRect(x + i * 13, y - 7, 10, 14); } x += 72;
    const near = Math.max(0, Math.min(1, 1 - (D.gap - 150) / 800)); ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fillRect(x, y - 4, 44, 8); ctx.fillStyle = near > .7 ? "#ff4a3a" : "#5cc8ff"; ctx.fillRect(x, y - 4, 44 * near, 8); }
  else { ctx.fillText("FUEL", x, y + 1); x += 38; for (let i = 0; i < DEEP_UI.fuelCost; i++) { const on = i < D.fuel, px0 = x + i * 17; ctx.fillStyle = on ? "#5cc8ff" : "rgba(255,255,255,.2)"; ctx.beginPath(); ctx.moveTo(px0 + 6, y - 10); ctx.lineTo(px0 + 12, y); ctx.lineTo(px0 + 6, y + 10); ctx.lineTo(px0, y); ctx.closePath(); ctx.fill(); }
    if (D.fuel > DEEP_UI.fuelCost) { ctx.fillStyle = "#5cc8ff"; ctx.fillText("+" + (D.fuel - DEEP_UI.fuelCost), x + DEEP_UI.fuelCost * 17 + 3, y + 1); } }
  // the way to your objective: a pulsing arrow circling you, with how far it is
  const me0 = me_(), mv = me0 && V(me0); if (o?.at && mv && me0.alive) { const dx = o.at.x - mv.x, dy = o.at.y - mv.y, dist = Math.hypot(dx, dy); if (dist > 240) { const an = Math.atan2(dy, dx), R = 118 + Math.sin(now / 180) * 7, ax = mv.x - cam.x + Math.cos(an) * R, ay = mv.y - cam.y - 20 + Math.sin(an) * R * .8;
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(an); ctx.fillStyle = "#5cc8ff"; ctx.strokeStyle = "#04121c"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-10, -14); ctx.lineTo(-3, 0); ctx.lineTo(-10, 14); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
    const lab = `${o.at.label || "GO"} ${Math.round(dist / 10)}m`; ctx.font = "800 12px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.strokeText(lab, ax - Math.cos(an) * 30, ay - Math.sin(an) * 26 + 1); ctx.fillStyle = "#bfe9ff"; ctx.fillText(lab, ax - Math.cos(an) * 30, ay - Math.sin(an) * 26 + 1); } }
  ctx.restore();
  if (now - deepFx.smash < 500) { ctx.fillStyle = `rgba(255,60,40,${.35 * (1 - (now - deepFx.smash) / 500)})`; ctx.fillRect(0, 0, W, H); }
  if (D.step === "escaped") { const u = Math.min(1, (now - deepFx.escaped) / 1400); ctx.fillStyle = `rgba(190,232,255,${u})`; ctx.fillRect(0, 0, W, H); }
}
// World-space mission things: the runes (at shrines / on the ground / over their carrier), the statue's lit runes, shattered seals, the awakening
function drawDeepWorld() {
  const D = deepState(); if (!D) return; const now = gnow(), t = now / 1000;
  D.runes.forEach((r, i) => { if (r.st === 3 || r.st === 0) return; const img = mapImgs["mRune" + (i + 1)]; if (!img?.naturalWidth) return;
    const c = r.st === 1 ? state.players.get(r.by) : null, v = c ? V(c) : r, x = v.x, y = (c ? v.y - 92 : r.y - 12) + Math.sin(t * 2.2 + i) * 5; if (!inView(x, y, 120)) return;
    ctx.save(); ctx.globalCompositeOperation = "lighter"; const g = ctx.createRadialGradient(x, y - 20, 3, x, y - 20, 62); g.addColorStop(0, "rgba(110,205,255,.5)"); g.addColorStop(1, "rgba(40,120,255,0)"); ctx.fillStyle = g; ctx.fillRect(x - 62, y - 82, 124, 124); ctx.restore();
    const s = c ? .62 : .9; ctx.drawImage(img, x - img.width * s / 2, y - img.height * s, img.width * s, img.height * s); });
  for (const sh of deepFx.shatter) { const P = deepPieces(), d = P.seals[sh.i], F = MN_FX.shatter, f = Math.floor((now - sh.t) / F.ms); if (!d || f >= F.n || !shatterFxImg.naturalWidth) continue;   // a seal crystal bursting
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.drawImage(shatterFxImg, f * F.s, 0, F.s, F.s, d.x - 150, d.y - 270, 300, 300); ctx.restore(); }
}
const darkCopies = new Map();
function darkCopy(img) { let c = darkCopies.get(img); if (c) return c; c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.filter = "brightness(.32) saturate(.35)"; g.drawImage(img, 0, 0); g.filter = "none"; g.globalCompositeOperation = "source-atop"; g.fillStyle = "rgba(8,10,20,.45)"; g.fillRect(0, 0, c.width, c.height); darkCopies.set(img, c); return c; }
// The Mine Beast's sheets (tools/extract-minebeast.py). The side rows were drawn facing LEFT: rows = D, DL, L, UL, U; the right side is mirrored.
const mbImgs = {}; for (const [k, v] of Object.entries(MB)) if (v?.url) { const im = new Image(); im.src = v.url; mbImgs[k] = im; }
const MB_ROWS = [[2, true], [1, true], [0, false], [1, false], [2, false], [3, false], [4, false], [3, true]];   // by octant: R, DR, D, DL, L, UL, U, UR -> [row, mirrored]
const mbDir = a => MB_ROWS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
// Phase 2 (Nov 12): the same sheets with the blue crystals turned blood red, made once in code (blue-dominant pixels -> red, the rock and rust stay)
const mbRedCache = {}; let mbTint = false;
function mbRed(key) {
  if (mbRedCache[key] !== undefined) return mbRedCache[key]; const img = mbImgs[key]; if (!img?.naturalWidth) return null;
  try { const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight; const g = c.getContext("2d"); g.drawImage(img, 0, 0); const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
    for (let i = 0; i < px.length; i += 4) { const r = px[i], gg = px[i + 1], b = px[i + 2]; if (px[i + 3] && b > r + 25 && b > gg + 5) { const lo = Math.min(r, gg); px[i] = b; px[i + 1] = lo * .55 + (gg - lo) * .15; px[i + 2] = r * .45; } }
    g.putImageData(d, 0, 0); return (mbRedCache[key] = c); } catch { return (mbRedCache[key] = null); }
}
function mbDraw(key, col, row, x, y, flip, o = {}) {
  const S = MB[key], img0 = mbImgs[key]; if (!img0?.naturalWidth) return; const img = (mbTint && mbRed(key)) || img0; const k = MB.k * (o.scale || 1);
  ctx.save(); ctx.globalAlpha = o.alpha ?? 1; ctx.globalCompositeOperation = "source-over";
  if (!o.noShadow) { ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.beginPath(); ctx.ellipse(x, y - 2, 108, 30, 0, 0, 7); ctx.fill(); }
  ctx.translate(Math.round(x + (o.shake ? (Math.random() - .5) * o.shake : 0)), Math.round(y)); if (flip) ctx.scale(-1, 1); ctx.scale(k, k); ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, col * S.w, row * S.h, S.w, S.h, -S.ax, -S.fy, S.w, S.h); ctx.restore();
}
function mbFx(name, frame, x, y, sc = 1.5, alpha = 1) {   // an effect strip at a FRACTIONAL frame (each frame melts into the next), its ground point at (x, y)
  const S = MB["fx_" + name], img = mbImgs["fx_" + name]; if (!img?.naturalWidth || frame < 0 || frame >= S.n) return; const f = Math.floor(frame), k = frame - f, w = S.w * sc, h = S.h * sc;
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.globalAlpha = alpha * (f + 1 < S.n ? 1 - k * .55 : 1 - k); ctx.drawImage(img, f * S.w, 0, S.w, S.h, x - w / 2, y - h * .68, w, h);
  if (k > 0 && f + 1 < S.n && (f + 1) % 8) { ctx.globalAlpha = alpha * k; ctx.drawImage(img, (f + 1) * S.w, 0, S.w, S.h, x - w / 2, y - h * .68, w, h); } ctx.restore();
}
// ---- particles, light flashes and floor marks for the fight (all client-side dressing) ----
const deepParts = [], deepFlashes = [], deepDecals = [];
function deepEmit(kind, x, y, n, o = {}) {   // kinds: chip (rock, falls and bounces), shard (blue crystal, glows), spark (hot streak), dust (soft puff), mote (blue light drifting up)
  const now = gnow(); for (let i = 0; i < n; i++) { const a = o.a !== undefined ? o.a + (Math.random() - .5) * (o.spread ?? 1) : Math.random() * 6.283, sp = (o.sp ?? 200) * (.35 + Math.random() * .95);
    deepParts.push({ kind, x: x + (Math.random() - .5) * (o.r || 0), y: y + (Math.random() - .5) * (o.r || 0) * .6, z: (o.z || 0) * (.5 + Math.random()), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * .6, vz: (o.up || 0) * (.45 + Math.random() * .9), t0: now, life: (o.life || 700) * (.6 + Math.random() * .8) * (kind === "spark" ? 2.4 : 1), s: (o.s || 6) * (.6 + Math.random() * .9), rot: Math.random() * 6.283, b: 0 }); }
  if (deepParts.length > 520) deepParts.splice(0, deepParts.length - 520);
}
const deepFlash = (x, y, r, col, len = 320) => { deepFlashes.push({ x, y, r, col, t0: gnow(), len }); if (deepFlashes.length > 40) deepFlashes.shift(); };
const deepDecal = (x, y, r, blue) => { deepDecals.push({ x, y, r, blue, t0: gnow(), seed: Math.random() * 100 }); if (deepDecals.length > 26) deepDecals.shift(); };
let deepPartsAt = 0;
const softDot = (stops => { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); for (const [o, col] of stops) gr.addColorStop(o, col); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return c; });   // soft dots rendered once (a gradient per particle per frame was too slow)
const DUST_CV = softDot([[0, "rgba(186,160,130,1)"], [.6, "rgba(120,100,84,.6)"], [1, "rgba(90,76,66,0)"]]), GLOW_CV = softDot([[0, "rgba(110,200,255,.5)"], [1, "rgba(60,140,255,0)"]]);
function drawDeepDecals() {   // cracked, scorched floor where something hit (fades over 9s); under the marks and particles
  const now = gnow();
  for (let i = deepDecals.length - 1; i >= 0; i--) { const d = deepDecals[i], age = (now - d.t0) / 9000; if (age >= 1) { deepDecals.splice(i, 1); continue; } if (!inView(d.x, d.y, d.r + 60)) continue; const al = Math.min(1, (1 - age) * 2.2);
    ctx.save(); ctx.translate(d.x, d.y); ctx.scale(1, .72); const g = ctx.createRadialGradient(0, 0, d.r * .15, 0, 0, d.r); g.addColorStop(0, `rgba(4,3,6,${.6 * al})`); g.addColorStop(.7, `rgba(6,5,8,${.32 * al})`); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, d.r, 0, 7); ctx.fill();
    ctx.lineCap = "round"; for (let j = 0; j < 9; j++) { const a = j * .7 + d.seed, L = d.r * (.55 + ((j * 37 + d.seed * 13) % 40) / 80); ctx.beginPath(); ctx.moveTo(Math.cos(a) * d.r * .12, Math.sin(a) * d.r * .12); const mx = Math.cos(a + .18) * L * .55, my = Math.sin(a + .18) * L * .55; ctx.lineTo(mx, my); ctx.lineTo(Math.cos(a - .06) * L, Math.sin(a - .06) * L);
      ctx.strokeStyle = `rgba(0,0,0,${.75 * al})`; ctx.lineWidth = 3.5; ctx.stroke(); if (d.blue) { ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = `rgba(80,180,255,${.55 * al * (1 - age)})`; ctx.lineWidth = 1.6; ctx.stroke(); ctx.globalCompositeOperation = "source-over"; } }
    ctx.restore(); }
}
function drawDeepParts() {
  const now = gnow(), dt = Math.min(.05, (now - (deepPartsAt || now)) / 1000); deepPartsAt = now;
  for (let i = deepFlashes.length - 1; i >= 0; i--) { const f = deepFlashes[i], k = (now - f.t0) / f.len; if (k >= 1) { deepFlashes.splice(i, 1); continue; } if (!inView(f.x, f.y, f.r)) continue;
    ctx.save(); ctx.globalCompositeOperation = "lighter"; const r = f.r * (.55 + .45 * k), g = ctx.createRadialGradient(f.x, f.y, 2, f.x, f.y, r); g.addColorStop(0, `rgba(${f.col},${.75 * (1 - k)})`); g.addColorStop(.4, `rgba(${f.col},${.3 * (1 - k)})`); g.addColorStop(1, `rgba(${f.col},0)`); ctx.fillStyle = g; ctx.fillRect(f.x - r, f.y - r, r * 2, r * 2); ctx.restore(); }
  for (let i = deepParts.length - 1; i >= 0; i--) { const p = deepParts[i], age = (now - p.t0) / p.life; if (age >= 1) { deepParts.splice(i, 1); continue; }
    const grav = p.kind === "dust" ? -30 : p.kind === "mote" ? -120 : 1150, drag = p.kind === "dust" ? 2.6 : p.kind === "spark" ? .8 : .5;
    p.vz -= grav * dt; p.z += p.vz * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - drag * dt; p.vy *= 1 - drag * dt; p.rot += dt * 7;
    if (p.z < 0 && p.kind === "spark") { p.z = 0; p.vz = -p.vz * .45; p.vx *= .7; p.vy *= .7; }   /* sparks skip across the floor */
    if (p.z < 0 && (p.kind === "chip" || p.kind === "shard")) { p.z = 0; if (p.b++ < 2) { p.vz = -p.vz * .38; p.vx *= .55; p.vy *= .55; } else { p.vz = 0; p.vx = p.vy = 0; } }
    if (!inView(p.x, p.y, 60)) continue; const X = p.x, Y = p.y - Math.max(0, p.z), fade = age > .7 ? (1 - age) / .3 : 1;
    if (p.kind === "dust") { const r = p.s * (1 + age * 2.4); ctx.save(); ctx.globalAlpha = .34 * (1 - age) * Math.min(1, age * 8); ctx.drawImage(DUST_CV, X - r, Y - r, r * 2, r * 2); ctx.restore(); }
    else if (p.kind === "spark") { ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = `rgba(255,${180 + Math.floor(60 * (1 - age))},${90 + Math.floor(120 * (1 - age))},${fade})`; ctx.lineWidth = Math.max(1, p.s * .35); ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X - p.vx * .05, Y - (p.vy - p.vz) * .05); ctx.stroke(); ctx.fillStyle = `rgba(255,245,220,${fade})`; ctx.fillRect(X - 1, Y - 1, 2, 2); ctx.restore(); }
    else if (p.kind === "mote") { ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = Math.sin(age * Math.PI); ctx.fillStyle = "#bfe9ff"; ctx.fillRect(X - 1.5, Y - 1.5, 3, 3); ctx.drawImage(GLOW_CV, X - 9, Y - 9, 18, 18); ctx.restore(); }
    else { const s = p.s; ctx.save(); if (p.z > 2) { ctx.globalAlpha = .28 * fade; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, s * .8, s * .32, 0, 0, 7); ctx.fill(); } ctx.globalAlpha = fade; ctx.translate(X, Y); ctx.rotate(p.rot);
      if (p.kind === "shard") { ctx.fillStyle = "#0b2740"; ctx.beginPath(); ctx.moveTo(0, -s * 1.5); ctx.lineTo(s * .7, 0); ctx.lineTo(0, s); ctx.lineTo(-s * .7, 0); ctx.closePath(); ctx.fill(); ctx.fillStyle = "#62c6ff"; ctx.beginPath(); ctx.moveTo(0, -s * 1.2); ctx.lineTo(s * .45, 0); ctx.lineTo(0, s * .7); ctx.lineTo(-s * .45, 0); ctx.closePath(); ctx.fill(); ctx.fillStyle = "#e2f6ff"; ctx.beginPath(); ctx.moveTo(0, -s * 1.2); ctx.lineTo(-s * .45, 0); ctx.lineTo(-s * .05, -s * .1); ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = .8 * fade; ctx.drawImage(GLOW_CV, -s * 2.6, -s * 2.6, s * 5.2, s * 5.2); }
      else { ctx.fillStyle = "#17120f"; ctx.beginPath(); ctx.moveTo(-s, -s * .5); ctx.lineTo(-s * .2, -s); ctx.lineTo(s, -s * .4); ctx.lineTo(s * .7, s * .7); ctx.lineTo(-s * .6, s * .8); ctx.closePath(); ctx.fill(); ctx.fillStyle = "#6a5a4e"; ctx.beginPath(); ctx.moveTo(-s * .7, -s * .35); ctx.lineTo(-s * .1, -s * .75); ctx.lineTo(s * .7, -s * .25); ctx.lineTo(s * .45, s * .45); ctx.lineTo(-s * .4, s * .5); ctx.closePath(); ctx.fill(); ctx.fillStyle = "#9a8674"; ctx.beginPath(); ctx.moveTo(-s * .7, -s * .35); ctx.lineTo(-s * .1, -s * .75); ctx.lineTo(s * .1, -s * .2); ctx.closePath(); ctx.fill(); }
      ctx.restore(); } }
}
function drawBeastShield(x, y, now, t, z) {   // the crystal shield: a faceted dome of blue light, rippling where it's hit, flaring when it heals
  const up = Math.min(1, (now - (deepFx.shieldAt || 0)) / 500), hit = Math.max(0, 1 - (now - (deepFx.shHit || 0)) / 260), pulse = Math.max(0, 1 - (now - (deepFx.shPulse || 0)) / 900), cx = x, cy = y - 150, rx = 165 * up, ry = 205 * up;
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(cx, cy, rx * .2, cx, cy, ry); g.addColorStop(0, "rgba(80,170,255,0)"); g.addColorStop(.7, `rgba(80,170,255,${.07 + .1 * hit + .12 * pulse})`); g.addColorStop(1, `rgba(170,230,255,${.28 + .25 * hit + .3 * pulse})`); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 7); ctx.fill();
  ctx.strokeStyle = `rgba(190,240,255,${.55 + .35 * hit})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, 7); ctx.stroke();
  ctx.lineWidth = 1.2; ctx.strokeStyle = `rgba(150,220,255,${.22 + .3 * hit})`;   // facets: meridians turning slowly + latitude bands
  for (let i = 0; i < 6; i++) { const a = t * .5 + i * Math.PI / 6, k = Math.cos(a); ctx.beginPath(); ctx.ellipse(cx, cy, Math.abs(rx * k), ry, 0, 0, 7); ctx.stroke(); }
  for (const f of [-.55, 0, .55]) { ctx.beginPath(); ctx.ellipse(cx, cy + ry * f, rx * Math.sqrt(1 - f * f), ry * .16 * Math.sqrt(1 - f * f), 0, 0, 7); ctx.stroke(); }
  for (let i = 0; i < 5; i++) { const a = t * 1.3 + i * 1.26, px = cx + Math.cos(a) * rx * .82, py = cy + Math.sin(a * 1.7) * ry * .7; ctx.drawImage(GLOW_CV, px - 14, py - 14, 28, 28); }
  ctx.restore();
}
function drawShieldBeam(now, t) {   // the shrine feeding the shield: a beam of blue light from the shrine to the Beast
  const D = deepState(); if (D?.step !== "fight" || !D.sh) return; const d = deepPieces().shrines[D.sh.i], z = [...state.zombies.values()].find(q => q.kind === "minebeast"); if (!d || !z) return;
  const v = V(z) || z, x0 = d.x, y0 = d.y - 120, x1 = v.x, y1 = v.y - 160, L = Math.hypot(x1 - x0, y1 - y0), ov = D.sh.ov / 100;
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
  for (const [w, a] of [[16, .1], [7, .25], [2.5, .8]]) { ctx.strokeStyle = `rgba(${130 + 120 * ov},${210 - 60 * ov},255,${a * (.8 + .2 * Math.sin(t * 9))})`; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); const n = Math.max(2, Math.floor(L / 60)); for (let i = 1; i <= n; i++) { const k = i / n, wob = Math.sin(k * 20 - t * 10) * 6 * (1 - Math.abs(k - .5) * 2); ctx.lineTo(x0 + (x1 - x0) * k + wob * (y1 - y0) / L, y0 + (y1 - y0) * k - wob * (x1 - x0) / L); } ctx.stroke(); }
  for (let i = 0; i < 10; i++) { const k = ((t * .35 + i / 10) % 1); ctx.drawImage(GLOW_CV, x0 + (x1 - x0) * k - 16, y0 + (y1 - y0) * k - 16, 32, 32); }
  const R = 120 + 30 * Math.sin(t * 4) + 80 * ov, g = ctx.createRadialGradient(d.x, d.y - 80, 6, d.x, d.y - 80, R); g.addColorStop(0, `rgba(170,230,255,${.6 + .3 * ov})`); g.addColorStop(1, "rgba(40,120,255,0)"); ctx.fillStyle = g; ctx.fillRect(d.x - R, d.y - 80 - R, R * 2, R * 2);   // the shrine blazes (brighter as it's overloaded)
  if (D.sh.by) { ctx.strokeStyle = "rgba(255,240,170,.95)"; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(d.x, d.y - 20, 70, -Math.PI / 2, -Math.PI / 2 + ov * Math.PI * 2); ctx.stroke(); }   // overload progress ring
  ctx.restore();
}
function drawBoulder(b) {   // a fallen rock (the cave-in): drops in, sits, sinks away at the end; glows faintly so you can find it in the dark
  const img = spooky(mapImgs.mRock4), now = gnow(), age = now - b.t0, left = b.end - now, drop = Math.max(0, 1 - age / 220), sink = left < 900 ? 1 - left / 900 : 0; if (!img) return;
  const w = 150, h = w * img.height / img.width, y = b.y - drop * 260 + sink * 30;
  ctx.save(); ctx.fillStyle = `rgba(0,0,0,${.4 * (1 - sink)})`; ctx.beginPath(); ctx.ellipse(b.x, b.y - 4, 62, 18, 0, 0, 7); ctx.fill();
  ctx.globalAlpha = 1 - sink; ctx.drawImage(img, b.x - w / 2, y - h + 10, w, h);
  const z = state && [...state.zombies.values()].find(q => q.kind === "minebeast"), warn = z?.act === "wind" ? .5 + .5 * Math.sin(now / 90) : 0;   // while it winds up a charge the boulders flash: lure it in!
  ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = (.32 + .55 * warn) * (1 - sink); ctx.strokeStyle = "#ffd28a"; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(b.x, b.y - 4, 80, 24, 0, 0, 7); ctx.stroke(); ctx.restore();
}
function drawMineBeast(z) {
  mbTint = !!z.enraged; try { drawMineBeast2(z); } finally { mbTint = false; }
}
function drawMineBeast2(z) {
  const v = V(z) || z, a = z.aim || 0, [row, flip] = mbDir(a), now = gnow(), t = now / 1000, D = deepState(), step = D?.step, act = z.act, len = z.actLen || 1, u = act ? Math.max(0, Math.min(.999, 1 - z.slam / len)) : 0;
  const stg = now - (deepFx.stagger || -1e9), sh = now - deepFx.smash < 400 || stg < 350 ? 10 : 0, right = Math.cos(a) > 0, x = v.x, y = v.y, ca = Math.cos(a), sa = Math.sin(a); let label = true, heart = row <= 1 ? .5 : row === 2 ? .25 : 0;
  const every = (ms, key = "_em") => { if (now - (z[key] || 0) < ms) return false; z[key] = now; return true; }, tipX = x + ca * 120, tipY = y - 70 + sa * 70;
  { const big = act === "wind" || act === "roar" || act === "dive" || act === "throw" ? (act === "throw" ? Math.min(1, u * 2) : u) : act === "charge" ? 1 : 0, red = z.enraged, k = (.16 + .3 * big) * (.85 + .15 * Math.sin(t * 3)), R = 260 + 140 * big;   // its crystals light the cave around it (red once enraged); brighter as a big attack winds up
    if (act !== "under" && act !== "erupt") { ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.translate(x, y - 60); ctx.scale(1, .72); const g = ctx.createRadialGradient(0, 0, 10, 0, 0, R); g.addColorStop(0, red ? `rgba(255,90,60,${k})` : `rgba(110,200,255,${k})`); g.addColorStop(.5, red ? `rgba(200,40,30,${k * .4})` : `rgba(50,130,255,${k * .4})`); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill(); ctx.restore(); } }
  if (step === "chase" && now - (deepFx.chase || -1e9) < 750) { mbDraw("kneel", now - deepFx.chase < 380 ? 6 : 7, 0, x, y, false, { shake: 6 }); label = false; }   // back up off its knee, roaring: then the chase
  else if (step === "chase") { mbDraw("run", Math.floor(t * 9) % 4, row, x, y, flip, { shake: sh }); if (every(70)) { deepEmit("dust", x - ca * 40, y - 6, 2, { r: 70, sp: 60, s: 26, life: 900 }); if (Math.random() < .5) deepEmit("chip", x - ca * 30, y - 4, 1, { r: 60, a: a + Math.PI, spread: 1.6, sp: 220, up: 260, s: 4 }); } if (every(110, "_sp")) deepEmit("spark", tipX, tipY, 2, { a, spread: 1.2, sp: 300, up: 80, s: 5, life: 260 }); }
  else if (act === "strike") { const f = Math.min(3, Math.floor(u * 4)); mbDraw("strike", f, row, x, y, flip); if ((f === 1 || f === 2) && every(40, "_sp")) deepEmit("spark", tipX, tipY, 2, { a, spread: 1.4, sp: 340, up: 120, s: 5, life: 240 }); }
  else if (act === "throw") { mbDraw("throw", Math.min(3, Math.floor(u * 4)), row, x, y, flip); if (u > .2 && u < .5 && every(60)) deepEmit("shard", x - ca * 20, y - 250, 1, { sp: 120, up: 200, s: 5, life: 600 }); }
  else if (act === "plunge") { mbDraw("dive", u < .35 ? 0 : 1, 0, x, y, false, { shake: u > .35 ? 9 : 2 }); if (u > .35 && every(40)) { deepEmit("chip", x, y, 3, { r: 90, sp: 300, up: 420, s: 5 }); deepEmit("dust", x, y, 1, { r: 110, sp: 120, s: 34, life: 900 }); } heart = 1; }   // drills driven into the floor: the shield goes up
  else if (act === "roar") { mbDraw("roar", u < .12 ? 0 : u < .28 ? 1 : u < .78 ? 2 + Math.floor(t * 8) % 2 : u < .9 ? 4 : 5, 0, x, y, false, { shake: u > .2 && u < .8 ? 7 : 0 });   /* plant, swell, ROAR (3-4 loop), lanterns out, head down */ heart = 1; if (u > .2 && u < .85 && every(50)) { deepEmit("dust", x, y - 40, 1, { r: 240, sp: 40, s: 30, life: 900, z: 300 }); deepEmit("chip", x, y, 1, { r: 420, sp: 30, z: 420, s: 4, life: 900 }); } }
  else if (act === "wind") { mbDraw("charge", Math.min(2, Math.floor(u * 3)), 0, x, y, !right, { shake: 2 + u * 5 }); const dx = x + (right ? 150 : -150), dy = y - 62;
    ctx.save(); ctx.globalCompositeOperation = "lighter"; const R = 40 + 70 * u, g = ctx.createRadialGradient(dx, dy, 2, dx, dy, R); g.addColorStop(0, `rgba(190,235,255,${.55 + .4 * u})`); g.addColorStop(.5, `rgba(80,170,255,${.3 * u + .1})`); g.addColorStop(1, "rgba(40,110,255,0)"); ctx.fillStyle = g; ctx.fillRect(dx - R, dy - R, R * 2, R * 2);
    ctx.strokeStyle = `rgba(190,235,255,${.5 + .4 * u})`; ctx.lineWidth = 2.5; for (let i = 0; i < 3; i++) { const an = t * (16 + 22 * u) + i * 2.09; ctx.beginPath(); ctx.ellipse(dx, dy, 16 + 20 * u, 30 + 26 * u, 0, an, an + 1.1); ctx.stroke(); } ctx.restore();   // the drills spinning up
    if (every(34, "_sp")) deepEmit("spark", dx, dy, 1 + Math.floor(u * 3), { sp: 260 + 240 * u, up: 160, s: 5, life: 300 }); if (every(120)) deepEmit("dust", x, y - 4, 1, { r: 90, sp: 50, s: 24, life: 700 }); heart = 0; }
  else if (act === "charge") { const tr = z._trail ||= []; tr.push([x, y]); if (tr.length > 9) tr.shift(); const f = 3 + Math.floor(t * 12) % 2; for (const [gi, al] of [[0, .14], [3, .22], [6, .32]]) if (tr[gi]) mbDraw("charge", f, 0, tr[gi][0], tr[gi][1], !right, { alpha: al, noShadow: true });   // speed ghosts
    mbDraw("charge", f, 0, x, y, !right); if (every(24)) { deepEmit("dust", x - ca * 60, y - 4, 2, { r: 60, sp: 70, s: 30, life: 800 }); deepEmit("chip", x - ca * 40, y - 4, 1, { a: a + Math.PI, spread: 1.8, sp: 260, up: 300, s: 4 }); deepEmit("spark", x + ca * 150, y - 60, 2, { a, spread: 1.5, sp: 380, up: 120, s: 5, life: 240 }); } heart = 0; }
  else if (act === "skid") { z._trail = null; mbDraw("charge", 5, 0, x, y, !right); if (every(40)) deepEmit("dust", x + ca * 60, y - 4, 2, { a, spread: 1.2, sp: 160, s: 28, life: 700 }); heart = 0; }
  else if (act === "dive") { mbDraw("dive", Math.min(5, Math.floor(u * 6)), 0, x, y, false, { noShadow: u > .3 }); if (u > .2) { mbFx("rubble", Math.min(7.9, u * 8), x, y + 30, 1.7); if (every(40)) { deepEmit("chip", x, y, 2, { r: 110, sp: 240, up: 420, s: 5 }); deepEmit("dust", x, y, 1, { r: 120, sp: 80, s: 30, life: 800 }); } } heart = u < .5 ? .6 : 0; }
  else if (act === "under") { mbFx("rubble", 8 + (t * 10) % 8, x, y + 24, 1.7); if (every(45)) { deepEmit("chip", x, y + 6, 1, { r: 60, sp: 150, up: 260, s: 4, life: 600 }); deepEmit("dust", x, y + 6, 1, { r: 70, sp: 50, s: 24, life: 800 }); } if (every(700, "_dc")) deepDecal(x, y + 10, 70, true); label = false; heart = 0;
    ctx.save(); ctx.globalCompositeOperation = "lighter"; const g = ctx.createRadialGradient(x, y + 6, 4, x, y + 6, 110); g.addColorStop(0, `rgba(90,180,255,${.22 + .1 * Math.sin(t * 14)})`); g.addColorStop(1, "rgba(40,110,255,0)"); ctx.fillStyle = g; ctx.fillRect(x - 110, y - 70, 220, 150); ctx.restore(); }
  else if (act === "erupt") { mbFx("erupt", Math.min(7.9, u * 8), x, y + 30, 1.9); if (every(50)) deepEmit("mote", x, y, 2, { r: 200, sp: 20, life: 700 }); label = false; heart = 0; }
  else if (act === "emerge") { mbDraw("emerge", Math.min(5, Math.floor(u * 6)), 0, x, y, false, { noShadow: u < .5 }); mbFx("erupt", 8 + u * 15.9, x, y + 30, 1.9); heart = u; }
  else if (step === "flee") { const e = now - (deepFx.flee || now), f = e < 1300 ? Math.min(3, Math.floor(e / 325)) : 4 + Math.floor(e / 520) % 2; mbDraw("kneel", f, 0, x, y, false, { shake: e < 900 ? 6 : 0 });   // beaten: it staggers, crystals break off, drops to a knee and kneels there catching its breath
    if (e < 1300 && f === 1 && every(60, "_kc")) deepEmit("shard", x, y - 220, 3, { r: 120, sp: 260, up: 300, s: 5, life: 900 }); if (f >= 4 && every(260, "_ks")) deepEmit("dust", x, y - 150, 1, { r: 40, sp: 20, s: 22, life: 1100, z: 60 }); label = false; heart = f >= 4 ? .15 + .1 * Math.sin(t * 3) : .4; }
  else if (act === "stagger") { const tl = z.slam, f = len - tl < .25 ? 0 : tl < .35 ? 3 : 1 + Math.floor(t * 2.2) % 2; mbDraw("stagger", f, 0, x, y, false, { shake: f === 0 ? 8 : 0 }); if (every(90)) { deepEmit("mote", x, y - 150, 1, { r: 60, sp: 40, life: 900 }); if (Math.random() < .4) deepEmit("spark", x, y - 150, 1, { sp: 200, up: 120, s: 4, life: 260 }); }
    ctx.save(); ctx.font = "800 13px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#9fe3ff"; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 3; ctx.strokeText("STAGGERED", x, y - 330); ctx.fillText("STAGGERED", x, y - 330); ctx.restore(); label = false; heart = .3 + .3 * Math.sin(t * 20); }
  else { const mv = Math.hypot(v.x - (z._lx ?? v.x), v.y - (z._ly ?? v.y)) > .15; z._lx = v.x; z._ly = v.y; if (mv) z._mvT = now; const wf = now - (z._mvT || 0) < 200 ? Math.floor(t * 4.5) % 4 : 0; mbDraw("walk", wf, row, x, y, flip, { shake: sh });
    if (wf !== z._wf) { z._wf = wf; if (wf === 1 || wf === 3) { deepEmit("dust", x + (wf === 1 ? -34 : 34), y - 2, 3, { r: 30, sp: 70, s: 20, life: 650 }); if (Math.hypot(x - cam.x - W / 2, y - cam.y - H / 2) < 620) shake(2.5, 110); } } }   // every step lands
  if (heart > 0 && act !== "under") { const hx = x + (row === 2 ? (flip ? 46 : -46) : row === 1 ? (flip ? 14 : -14) : 0), hy = y - 176, k = heart * (.75 + .25 * Math.sin(t * 5)), R = 46 + 30 * heart; ctx.save(); ctx.globalCompositeOperation = "lighter"; const g = ctx.createRadialGradient(hx, hy, 2, hx, hy, R); g.addColorStop(0, z.enraged ? `rgba(255,150,120,${.55 * k})` : `rgba(170,225,255,${.55 * k})`); g.addColorStop(.45, z.enraged ? `rgba(230,50,30,${.25 * k})` : `rgba(70,160,255,${.25 * k})`); g.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(hx - R, hy - R, R * 2, R * 2); ctx.restore(); }   // his crystal heart breathing
  if (D?.sh && act !== "under" && act !== "erupt") drawBeastShield(x, y, now, t, z);
  if (stg < 350 && step === "chase") { ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = `rgba(190,235,255,${.55 * (1 - stg / 350)})`; ctx.beginPath(); ctx.ellipse(x, y - 150, 150, 190, 0, 0, 7); ctx.fill(); ctx.restore(); }
  if (label && step === "chase") { ctx.save(); ctx.font = "800 13px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#ffb3a8"; ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 3; ctx.strokeText("THE MINE BEAST", x, y - 330); ctx.fillText("THE MINE BEAST", x, y - 330); ctx.restore(); }
}
// The fight's marks and effects (world space, drawn over the floor and everything on it). deepFx.marks: {kind, x, y, r, t0, at (ms it lands), ...}
function drawBeastFx() {
  const now = gnow(), t = now / 1000;
  const ring = (x, y, r, k, col = "255,70,50") => { k = Math.max(0, Math.min(1, k)); ctx.save(); ctx.translate(x, y); ctx.scale(1, .75); const g = ctx.createRadialGradient(0, 0, r * .2, 0, 0, r); g.addColorStop(0, `rgba(${col},.05)`); g.addColorStop(1, `rgba(${col},.22)`); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    ctx.fillStyle = `rgba(${col},${.16 + .1 * k})`; ctx.beginPath(); ctx.arc(0, 0, r * k, 0, 7); ctx.fill(); ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = `rgba(${col},${.75 + .25 * Math.sin(t * 14)})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
    ctx.lineWidth = 2; ctx.setLineDash([10, 12]); ctx.lineDashOffset = -t * 60; ctx.strokeStyle = `rgba(${col},.55)`; ctx.beginPath(); ctx.arc(0, 0, r * .82, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = `rgba(${col},.9)`; ctx.lineWidth = 3; for (let i = 0; i < 4; i++) { const an = i * Math.PI / 2 + t * .8; ctx.beginPath(); ctx.moveTo(Math.cos(an) * r * (1.12 - .1 * k), Math.sin(an) * r * (1.12 - .1 * k)); ctx.lineTo(Math.cos(an) * r * .9, Math.sin(an) * r * .9); ctx.stroke(); } ctx.restore(); };
  drawDeepDecals();
  for (const z of state.zombies.values()) if (z.kind === "minebeast" && z.act === "wind") {   // the charge's lane
    const v = V(z) || z, a = z.aim || 0, L = deepFx.windReach || 950, hw = deepFx.windHalf || 95, u = 1 - z.slam / (z.actLen || 1);
    ctx.save(); ctx.translate(v.x, v.y); ctx.rotate(a); const g = ctx.createLinearGradient(0, 0, L, 0); g.addColorStop(0, "rgba(255,70,50,.26)"); g.addColorStop(1, "rgba(255,70,50,.05)"); ctx.fillStyle = g; ctx.fillRect(0, -hw, L, hw * 2); ctx.fillStyle = "rgba(255,70,50,.2)"; ctx.fillRect(0, -hw, L * u, hw * 2);
    ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = `rgba(255,90,60,${.6 + .4 * Math.sin(t * 16)})`; ctx.lineWidth = 3; ctx.strokeRect(0, -hw, L, hw * 2);
    ctx.fillStyle = "rgba(255,130,95,.75)"; for (let i = 0; i < 6; i++) { const ax = ((t * 420 + i * L / 6) % L); ctx.globalAlpha = 1 - ax / L * .7; ctx.beginPath(); ctx.moveTo(ax + 26, 0); ctx.lineTo(ax, -hw * .5); ctx.lineTo(ax + 8, 0); ctx.lineTo(ax, hw * .5); ctx.closePath(); ctx.fill(); } ctx.restore();
    ctx.save(); ctx.font = "800 14px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#9fe3ff"; ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.lineWidth = 3; ctx.strokeText("SHOOT IT TO BREAK THE CHARGE", v.x, v.y - 320); ctx.fillText("SHOOT IT TO BREAK THE CHARGE", v.x, v.y - 320); ctx.restore(); }
  deepFx.marks = (deepFx.marks || []).filter(m => now < m.end);
  for (const m of deepFx.marks) { if (!inView(m.x, m.y, 340)) continue; const u = (now - m.t0) / (m.at - m.t0), since = now - m.at;
    if (m.kind === "rock") { if (since < 0) { ring(m.x, m.y, m.r, u); const fall = (1 - u * u) * 620, sc = 1.5 + .5 * u, ry = m.y - fall + 40;
        ctx.save(); ctx.fillStyle = `rgba(0,0,0,${.2 + .4 * u})`; ctx.beginPath(); ctx.ellipse(m.x, m.y, m.r * (.35 + .5 * u), m.r * (.22 + .32 * u), 0, 0, 7); ctx.fill(); ctx.restore();   // its shadow closing in
        ctx.save(); ctx.globalCompositeOperation = "lighter"; const lg = ctx.createLinearGradient(0, ry - 300, 0, ry - 40); lg.addColorStop(0, "rgba(200,180,150,0)"); lg.addColorStop(1, `rgba(200,180,150,${.22 * u})`); ctx.fillStyle = lg; for (const ox of [-34, -12, 10, 30]) ctx.fillRect(m.x + ox, ry - 300, 5, 260); ctx.restore();   // dust streaks behind it
        for (const [g, al] of [[70, .16], [34, .3]]) mbFx("rock", Math.min(3.9, u * 4), m.x, ry - g * (.4 + u), sc, al * Math.min(1, u * 4));   // motion blur
        mbFx("rock", Math.min(3.9, u * 4), m.x, ry, sc, Math.min(1, u * 5)); if (Math.random() < .4) deepEmit("dust", m.x, ry - 60, 1, { r: 50, sp: 20, s: 18, life: 500 }); if (Math.random() < .25) deepEmit("chip", m.x, m.y, 1, { r: 60, sp: 20, z: fall, s: 3, life: 500 }); }
      else { if (!m.hit) { m.hit = 1; deepEmit("chip", m.x, m.y, 24, { r: 36, sp: 380, up: 520, s: 8, life: 1100 }); deepEmit("dust", m.x, m.y, 12, { r: 80, sp: 210, s: 44, life: 1300 }); deepEmit("spark", m.x, m.y - 10, 6, { sp: 360, up: 240, s: 5, life: 260 }); deepFlash(m.x, m.y - 20, 190, "255,225,180", 240); deepDecal(m.x, m.y, m.r * 1.05); if (Math.hypot(m.x - cam.x - W / 2, m.y - cam.y - H / 2) < 760) shake(11, 300); }
        mbFx("rock", 9 + since / 70, m.x, m.y + 40, 2); } }
    else if (m.kind === "erupt") { ring(m.x, m.y, m.r, u); if (Math.random() < .5) deepEmit("chip", m.x, m.y, 1, { r: m.r * 1.2, sp: 60, up: 200 + 300 * u, s: 4, life: 500 }); }
    else if (m.kind === "spike") { const fly = m.fly * 1000, el = now - m.t0, im = mapImgs.mCrystalSmall;
      if (since < 0) ring(m.x, m.y, m.r, el / (m.at - m.t0), "90,190,255");
      if (el < fly) { const k = el / fly, x = m.sx + (m.x - m.sx) * k, y = m.sy - 230 + (m.y - (m.sy - 230)) * k - Math.sin(k * Math.PI) * 150, an = Math.atan2(m.y - m.sy + 200 * (k - .5), m.x - m.sx);   // the crystal in flight, trailing light
        ctx.save(); ctx.globalCompositeOperation = "lighter"; const g = ctx.createRadialGradient(x, y, 0, x, y, 34); g.addColorStop(0, "rgba(140,215,255,.6)"); g.addColorStop(1, "rgba(60,140,255,0)"); ctx.fillStyle = g; ctx.fillRect(x - 34, y - 34, 68, 68); ctx.restore();
        ctx.save(); ctx.translate(x, y); ctx.rotate(an); ctx.fillStyle = "#0b2740"; ctx.beginPath(); ctx.moveTo(34, 0); ctx.lineTo(-14, -13); ctx.lineTo(-24, 0); ctx.lineTo(-14, 13); ctx.closePath(); ctx.fill(); ctx.fillStyle = "#6fd0ff"; ctx.beginPath(); ctx.moveTo(29, 0); ctx.lineTo(-12, -9); ctx.lineTo(-19, 0); ctx.lineTo(-12, 9); ctx.closePath(); ctx.fill(); ctx.fillStyle = "#e2f6ff"; ctx.beginPath(); ctx.moveTo(29, 0); ctx.lineTo(-12, -9); ctx.lineTo(-4, -1); ctx.closePath(); ctx.fill(); ctx.restore();
        if (Math.random() < .6) deepEmit("mote", x, y, 1, { r: 10, sp: 20, life: 400 }); }
      else if (since < 0) { if (!m.land) { m.land = 1; deepEmit("chip", m.x, m.y, 6, { sp: 220, up: 300, s: 4 }); deepEmit("dust", m.x, m.y, 3, { r: 30, sp: 90, s: 24, life: 700 }); deepFlash(m.x, m.y - 30, 110, "140,210,255", 200); deepDecal(m.x, m.y + 4, 46, true); if (Math.hypot(m.x - cam.x - W / 2, m.y - cam.y - H / 2) < 600) shake(3, 120); }
        const k = (el - fly) / (m.at - m.t0 - fly), sc = .85, pop = Math.min(1, (el - fly) / 120), jx = k > .6 ? (Math.random() - .5) * 5 * k : 0; if (im?.naturalWidth) { const w = im.width * sc, h = im.height * sc * (.5 + .5 * pop); ctx.drawImage(im, m.x - w / 2 + jx, m.y - h + 14, w, h);
          ctx.save(); ctx.globalCompositeOperation = "lighter"; const R = 46 + 80 * k, g = ctx.createRadialGradient(m.x, m.y - 44, 4, m.x, m.y - 44, R); g.addColorStop(0, `rgba(190,235,255,${.3 + .65 * k * (.7 + .3 * Math.sin(t * (14 + 30 * k)))})`); g.addColorStop(.5, `rgba(70,160,255,${.2 + .3 * k})`); g.addColorStop(1, "rgba(40,120,255,0)"); ctx.fillStyle = g; ctx.fillRect(m.x - R, m.y - 44 - R, R * 2, R * 2); ctx.restore(); if (Math.random() < .25 + k * .5) deepEmit("mote", m.x, m.y - 30, 1, { r: 50, sp: 30, life: 600 }); } }
      else { if (!m.pop) { m.pop = 1; deepEmit("shard", m.x, m.y - 30, 16, { sp: 380, up: 420, s: 7, life: 900 }); deepEmit("spark", m.x, m.y - 30, 10, { sp: 420, up: 200, s: 5, life: 320 }); deepEmit("dust", m.x, m.y, 3, { r: 40, sp: 120, s: 26, life: 800 }); deepFlash(m.x, m.y - 40, 240, "170,225,255", 300); if (Math.hypot(m.x - cam.x - W / 2, m.y - cam.y - H / 2) < 600) shake(5, 160); }
        const F = MN_FX.shatter, f = Math.floor(since / 70); if (f < F.n && shatterFxImg.naturalWidth) { ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.drawImage(shatterFxImg, f * F.s, 0, F.s, F.s, m.x - 150, m.y - 240, 300, 300); ctx.restore(); }
        const k = since / 420; if (k < 1) { ctx.save(); ctx.translate(m.x, m.y); ctx.scale(1, .75); ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = `rgba(170,225,255,${1 - k})`; ctx.lineWidth = 6 * (1 - k) + 1; ctx.beginPath(); ctx.arc(0, 0, m.r * (.3 + .9 * k), 0, 7); ctx.stroke(); ctx.restore(); } } }
    else if (m.kind === "shock") { const el = now - m.t0, k = el / 900; mbFx("shock", el / 70, m.x, m.y + 60, 3.2, .9);
      if (k < 1) { ctx.save(); ctx.translate(m.x, m.y); ctx.scale(1, .7); ctx.globalCompositeOperation = "lighter"; for (const [d, w, al] of [[0, 10, .8], [.12, 5, .5]]) { const kk = k - d; if (kk <= 0) continue; ctx.strokeStyle = `rgba(190,230,255,${al * (1 - kk)})`; ctx.lineWidth = w * (1 - kk) + 1; ctx.beginPath(); ctx.arc(0, 0, 60 + 640 * kk, 0, 7); ctx.stroke(); } ctx.restore(); } }
    else if (m.kind === "burst") { const k = since / 500; if (k < 1) { ctx.save(); ctx.translate(m.x, m.y); ctx.scale(1, .7); ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = `rgba(190,230,255,${1 - k})`; ctx.lineWidth = 12 * (1 - k) + 1; ctx.beginPath(); ctx.arc(0, 0, 80 + 360 * k, 0, 7); ctx.stroke(); ctx.restore(); } }
  }
  drawDeepParts();
}
function onBeastMsg(m, now) {   // the fight's server events -> marks, particles, shakes
  const M = deepFx.marks ||= [];
  if (m.k === "spines") for (const [x, y] of m.pts) M.push({ kind: "spike", x, y, r: m.r, sx: m.x, sy: m.y, fly: m.fly, t0: now, at: now + (m.fly + m.fuse) * 1000, end: now + (m.fly + m.fuse) * 1000 + 1100 });
  else if (m.k === "cavein") { for (const [x, y] of m.pts) M.push({ kind: "rock", x, y, r: m.r, t0: now, at: now + m.delay * 1000, end: now + m.delay * 1000 + 1250 }); M.push({ kind: "shock", x: m.x, y: m.y, t0: now, at: now, end: now + 1120 }); deepFx.dark = now + m.dark * 1000; shake(10, 1000); playSfx("stomp", undefined, undefined, 1);
    deepFlash(m.x, m.y - 150, 420, "150,215,255", 500); deepEmit("dust", m.x, m.y, 12, { r: 160, sp: 260, s: 40, life: 1200 }); for (let i = 0; i < 26; i++) deepEmit("chip", cam.x + Math.random() * W, cam.y + Math.random() * H, 1, { sp: 20, z: 500 + Math.random() * 300, s: 3 + Math.random() * 3, life: 1300 }); }   // grit shaken loose from the roof all over the screen
  else if (m.k === "erupt") M.push({ kind: "erupt", x: m.x, y: m.y, r: m.r, t0: now, at: now + m.warn * 1000, end: now + m.warn * 1000 });
  else if (m.k === "burst") { M.push({ kind: "burst", x: m.x, y: m.y, t0: now, at: now, end: now + 520 }); shake(14, 520); playSfx("stomp", undefined, undefined, 1); deepEmit("chip", m.x, m.y, 30, { r: 60, sp: 420, up: 620, s: 7, life: 1100 }); deepEmit("shard", m.x, m.y, 10, { r: 40, sp: 360, up: 520, s: 6, life: 1000 }); deepEmit("dust", m.x, m.y, 12, { r: 110, sp: 220, s: 42, life: 1200 }); deepFlash(m.x, m.y - 60, 360, "170,225,255", 380); deepDecal(m.x, m.y + 6, 190, true); }
  else if (m.k === "jab") { shake(m.i ? 9 : 6, 220); deepEmit("spark", m.x, m.y - 50, 16, { sp: 460, up: 220, s: 6, life: 300 }); deepEmit("chip", m.x, m.y, 6, { sp: 260, up: 320, s: 5 }); deepEmit("dust", m.x, m.y, 3, { r: 40, sp: 110, s: 28, life: 700 }); deepFlash(m.x, m.y - 50, 170, "255,215,150", 180); deepDecal(m.x, m.y + 10, 60); }
  else if (m.k === "wind") { deepFx.windReach = m.reach; deepFx.windHalf = m.half; }
  else if (m.k === "broke") { deepFx.stagger = now; shake(9, 420); playSfx("zap", undefined, undefined, 1); for (const z of state.zombies.values()) if (z.kind === "minebeast") { deepEmit("shard", z.x, z.y - 160, 14, { sp: 360, up: 380, s: 6, life: 900 }); deepEmit("spark", z.x, z.y - 160, 12, { sp: 420, up: 200, s: 5, life: 320 }); deepFlash(z.x, z.y - 160, 320, "170,225,255", 340); } }
  else if (m.k === "fight") { deepFx.fight = now; deepFx.boulders = []; deepFx.bTip = false; shake(12, 700); }
  else if (m.k === "crit") { const z = [...state.zombies.values()].find(q => q.kind === "minebeast"), red = z?.enraged; deepEmit("shard", m.x, m.y - 220, 4, { r: 80, sp: 260, up: 260, s: 4, life: 600 }); deepFlash(m.x, m.y - 210, 110, red ? "255,90,60" : "150,215,255", 180); }   // a hit on the crystals on its back
  else if (m.k === "crystal") { shake(8, 380); playSfx("zap", m.x, m.y, 1); deepEmit("shard", m.x, m.y - 230, 26, { r: 90, sp: 480, up: 520, s: 7, life: 1100 }); deepEmit("mote", m.x, m.y - 230, 10, { r: 120, sp: 60, life: 1200 }); deepFlash(m.x, m.y - 220, 300, m.red ? "255,90,60" : "160,225,255", 420); }   // (the server's message says how many are left)
  else if (m.k === "phase2") { deepFx.phase2 = now; shake(16, 900); playSfx("roar", m.x, m.y, 1); deepFlash(m.x, m.y - 160, 620, "255,70,40", 900); deepEmit("dust", m.x, m.y, 14, { r: 200, sp: 300, s: 44, life: 1300 }); }
  else if (m.k === "chain") shake(5, 240);
  else if (m.k === "shield") { deepFx.shieldAt = now; shake(12, 700); playSfx("zap", m.x, m.y, 1); playSfx("stomp", m.x, m.y, .8); deepFlash(m.x, m.y - 150, 520, "150,215,255", 700); deepFlash(m.sx, m.sy - 80, 360, "150,215,255", 900); }
  else if (m.k === "shieldHit") { deepFx.shHit = now; if (Math.random() < .5) deepEmit("mote", m.x + (Math.random() - .5) * 220, m.y - 150 + (Math.random() - .5) * 260, 2, { sp: 60, life: 500 }); }
  else if (m.k === "shieldPulse") { deepFx.shPulse = now; shake(6, 400); playSfx("zap", m.x, m.y, .7); deepFlash(m.x, m.y - 150, 380, "120,255,170", 700); }
  else if (m.k === "overload") playSfx("pickup", undefined, undefined, .8);
  else if (m.k === "shieldBreak") { deepFx.stagger = now; shake(16, 800); playSfx("zap", m.x, m.y, 1); playSfx("boom", m.x, m.y, .7); deepEmit("shard", m.x, m.y - 160, 46, { r: 160, sp: 560, up: 520, s: 7, life: 1300 }); deepEmit("mote", m.x, m.y - 160, 16, { r: 180, sp: 90, life: 1300 }); deepFlash(m.x, m.y - 160, 560, "190,240,255", 700);
    if (m.sx) { deepEmit("shard", m.sx, m.sy - 90, 24, { r: 60, sp: 420, up: 480, s: 6, life: 1100 }); deepFlash(m.sx, m.sy - 80, 420, "255,240,170", 600); } }
  else if (m.k === "boulder") { (deepFx.boulders ||= []).push({ id: m.id, x: m.x, y: m.y, t0: now, end: now + m.life * 1000 }); if (!deepFx.bTip) { deepFx.bTip = true; feed.unshift({ text: "Boulders! Lure its CHARGE into one to stun it", t: Date.now() }); feed.length = Math.min(feed.length, 5); } }
  else if (m.k === "boulderGone") { const b = (deepFx.boulders || []).find(q => q.id === m.id); if (b) { deepEmit("dust", b.x, b.y, 4, { r: 50, sp: 80, s: 30, life: 900 }); deepFx.boulders = deepFx.boulders.filter(q => q !== b); } }
  else if (m.k === "bsmash") { deepFx.boulders = (deepFx.boulders || []).filter(q => q.id !== m.id); deepFx.stagger = now; shake(18, 650); playSfx("stomp", m.x, m.y, 1); deepEmit("chip", m.x, m.y - 30, 34, { r: 50, sp: 520, up: 560, s: 8, life: 1200 }); deepEmit("dust", m.x, m.y, 12, { r: 90, sp: 260, s: 44, life: 1300 }); deepFlash(m.x, m.y - 60, 260, "255,220,170", 380); deepDecal(m.x, m.y, 110, false); }
  else if (m.k === "flee") { deepFx.flee = now; M.length = 0; deepFx.boulders = []; shake(10, 600); for (const z of state.zombies.values()) if (z.kind === "minebeast") { deepEmit("dust", z.x, z.y, 10, { r: 120, sp: 200, s: 40, life: 1100 }); deepEmit("chip", z.x, z.y, 12, { sp: 300, up: 380, s: 6 }); deepFlash(z.x, z.y - 150, 300, "170,225,255", 400); } }
}
// The statue during the mission: its plinth runes light up as runes go in; the awakening: cracks of light, shaking, the stone bursts off, the Beast roars and steps down
function drawDeepStatue(d, a) {
  const D = deepState(), img = spooky(mapImgs.mStatue), now = gnow(), t = now / 1000; if (!img) return;
  const aw = D && D.step !== "runes" ? (now - deepFx.awake) / 1000 : -1, L = deepFx.awakeLen, burst = L * .58;
  const plinthTop = Math.round(a.h * .76), sf = a.w / 600;
  if (aw < 0 || aw < burst) {   // still stone (shaking harder and harder once it starts)
    const k = aw < 0 ? 0 : aw / burst, sx = (Math.random() - .5) * 8 * k, sy = (Math.random() - .5) * 4 * k;
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(img, Math.round(d.x - a.w / 2 + sx), Math.round(d.y - a.h + sy));
    if (k > 0) { ctx.globalCompositeOperation = "lighter"; const cx = d.x, cy = d.y - a.h * .56;   // the heart lights, cracks of light spread from it, the eyes open
      const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, (60 + 220 * k) * sf); g.addColorStop(0, `rgba(170,225,255,${.85 * k})`); g.addColorStop(1, "rgba(40,120,255,0)"); ctx.fillStyle = g; ctx.fillRect(cx - 300, cy - 300, 600, 600);
      ctx.strokeStyle = `rgba(160,225,255,${.9 * k})`; ctx.lineWidth = 3; ctx.shadowColor = "#6cc8ff"; ctx.shadowBlur = 12;
      for (let i = 0; i < 9; i++) { const an = i * .7 + .3, len = (40 + (i * 37 % 90)) * 2.2 * k * sf; ctx.beginPath(); ctx.moveTo(cx, cy); let px = cx, py = cy; for (let j = 1; j <= 4; j++) { px = cx + Math.cos(an + Math.sin(i * 3 + j) * .5) * len * j / 4; py = cy + Math.sin(an + Math.sin(i * 3 + j) * .5) * len * j / 4 * .8; ctx.lineTo(px, py); } ctx.stroke(); }
      if (k > .45) for (const sgn of [-1, 1]) { ctx.fillStyle = `rgba(190,235,255,${(k - .45) * 1.8})`; ctx.beginPath(); ctx.ellipse(d.x + sgn * 26 * sf, d.y - a.h * .705, 9 * sf, 5 * sf, 0, 0, 7); ctx.fill(); } }
    ctx.restore();
  } else {   // the shell is gone: the bare plinth stays; the Beast stands on it roaring, then steps down (the chase takes over from the server's zombie)
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(img, 0, plinthTop, a.w, a.h - plinthTop, Math.round(d.x - a.w / 2), d.y - a.h + plinthTop, a.w, a.h - plinthTop); ctx.restore();
    if (D.step === "awake") { const u = (aw - burst) / (L - burst), down = Math.max(0, (u - .7) / .3); { const by = d.y - (a.h - plinthTop) * .5 * (1 - down) + 110 * down; if (u < .7) mbDraw("roar", u < .1 ? 1 : 2 + Math.floor(t * 8) % 2, 0, d.x, by, false, { shake: 8, scale: 1.02 + .02 * Math.sin(t * 30) });   /* on the plinth, roaring (the roar sheet's loop) */ else mbDraw("walk", Math.floor(t * 5) % 4, 0, d.x, by, false); }
      if (deepFx.burstFor !== deepFx.awake) { deepFx.burstFor = deepFx.awake; if (aw - burst < 1) { deepEmit("chip", d.x, d.y - a.h * .45, 46, { r: 160, sp: 460, up: 620, s: 8, life: 1300, z: 120 }); deepEmit("dust", d.x, d.y - 40, 16, { r: 200, sp: 240, s: 46, life: 1400 }); deepEmit("shard", d.x, d.y - a.h * .5, 10, { r: 80, sp: 380, up: 520, s: 6, life: 1100 }); deepFlash(d.x, d.y - a.h * .5, 520, "190,232,255", 600); shake(16, 700); } }
      const f = (aw - burst) / .9; if (f < 1) { ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = `rgba(215,240,255,${1 - f})`; ctx.beginPath(); ctx.arc(d.x, d.y - a.h * .5, 120 + 520 * f, 0, 7); ctx.fill(); ctx.restore();   // the burst: a flash and flying stone
        ctx.fillStyle = "#6f7480"; for (let i = 0; i < 26; i++) { const an = i * 2.4, r = 60 + f * (240 + (i * 53 % 200)); ctx.fillRect(d.x + Math.cos(an) * r - 5, d.y - a.h * .5 + Math.sin(an) * r * .7 + f * f * 160 - 5, 8 + i % 5, 8 + i % 4); } } }
  }
  ctx.save(); ctx.globalCompositeOperation = "lighter";   // the plinth's runes: faint, or bright once that rune is in
  (a.runes || []).forEach(([rx, ry], i) => { const on = D && i < D.placed, x = d.x + rx, y = d.y + ry, k = on ? .9 + .1 * Math.sin(t * 4 + i) : .35 + .15 * Math.sin(t * 1.7 + i * 1.3), r = (on ? 46 : 28) * Math.max(.7, sf); const g = ctx.createRadialGradient(x, y, 1, x, y, r); g.addColorStop(0, `rgba(${on ? "190,235,255" : "110,210,255"},${(on ? .95 : .5) * k})`); g.addColorStop(1, "rgba(40,120,255,0)"); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); });
  ctx.restore();
}
// Whiteout Station ground patches (Nov 10, user: the tiles looked "boxy and harsh" side by side): each pad / pond is drawn as a wobbly
// rounded shape, then the snow is feathered back over its edge in soft bands, with drifts of snow lying across the border.
// Everything comes from the patch's own position, so every ground chunk draws the same shape.
function softShape(g) {
  if (g._soft) return g._soft;
  let seed = (Math.round(g.x) * 7919 + Math.round(g.y) * 104729) % 2147483647 || 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ice = g.tile === "ice" || !!g.blob, r = Math.min(ice ? 1e9 : 34, g.w / 2, g.h / 2), x0 = g.x, y0 = g.y, x1 = g.x + g.w, y1 = g.y + g.h, pts = [];
  const side = (ax, ay, bx, by, nx, ny) => { const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 22)); for (let i = 0; i < n; i++) pts.push([ax + (bx - ax) * i / n, ay + (by - ay) * i / n, nx, ny]); };
  const arc = (cx, cy, a0) => { const n = Math.max(4, Math.round(r / 12)); for (let i = 0; i < n; i++) { const a = a0 + i / n * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, -Math.cos(a), -Math.sin(a)]); } };
  side(x0 + r, y0, x1 - r, y0, 0, 1); arc(x1 - r, y0 + r, -Math.PI / 2); side(x1, y0 + r, x1, y1 - r, -1, 0); arc(x1 - r, y1 - r, 0); side(x1 - r, y1, x0 + r, y1, 0, -1); arc(x0 + r, y1 - r, Math.PI / 2); side(x0, y1 - r, x0, y0 + r, 1, 0); arc(x0 + r, y0 + r, Math.PI);
  const N = pts.length, k1 = Math.max(2, Math.round(N / 9)), k2 = Math.max(3, Math.round(N / 3.4)), p1 = rnd() * 7, p2 = rnd() * 7, A = ice ? 16 : 9, B = ice ? 9 : 6;
  const P = pts.map(([x, y, nx, ny], i) => { const o = A * (.5 + .5 * Math.sin(2 * Math.PI * k1 * i / N + p1)) + B * (.5 + .5 * Math.sin(2 * Math.PI * k2 * i / N + p2)); return [x + nx * o, y + ny * o, nx, ny]; });
  const path = new Path2D(), mid = i => [(P[i][0] + P[(i + 1) % N][0]) / 2, (P[i][1] + P[(i + 1) % N][1]) / 2]; path.moveTo(...mid(N - 1));
  for (let i = 0; i < N; i++) { const m = mid(i); path.quadraticCurveTo(P[i][0], P[i][1], m[0], m[1]); } path.closePath();
  const drifts = []; for (let i = 0; i < N; i += 1 + Math.floor(rnd() * 3)) if (rnd() < .5) { const [x, y, nx, ny] = P[i], d = -6 + rnd() * 26; drifts.push([x + nx * d, y + ny * d, 10 + rnd() * 20, 6 + rnd() * 12, rnd() * 3.1]); }
  return (g._soft = { path, drifts });
}
function softPatch(g, tile, snow) {
  const { path, drifts } = softShape(g);
  ctx.save(); ctx.fillStyle = tile; ctx.fill(path);
  ctx.strokeStyle = snow; ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (let i = 0; i < 9; i++) { ctx.globalAlpha = .13 + i * .012; ctx.lineWidth = 46 - i * 5; ctx.stroke(path); }   // snow creeping in over the edge: thin at its inner reach, solid at the border
  ctx.globalAlpha = 1; ctx.lineWidth = 5; ctx.stroke(path);
  ctx.fillStyle = snow; for (const [x, y, rx, ry, a] of drifts) { ctx.globalAlpha = .9; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, a, 0, 7); ctx.fill(); ctx.globalAlpha = .45; ctx.beginPath(); ctx.ellipse(x, y, rx + 7, ry + 6, a, 0, 7); ctx.fill(); }   // drifts lying across it
  ctx.restore();
}
// Scorched Refinery: the pyramid's doorway glows on boss waves, and bursts with light, smoke and a shake when the boss walks out ("pyramid" message)
let pyrBurst = -1e9;
function pyramidFx(d, a) {
  const [dx, dy, w, h] = a.door, x = d.x + dx, y = d.y + dy, now = gnow(), since = (now - pyrBurst) / 1000, boss = state?.waveType === "boss" && !state.bossDead && state.phase === "playing";
  const k = since < 3.5 ? 1 - since / 5 : boss ? (state.bossPhase === "intro" ? .8 : state.bossPhase === "horde" ? .4 : .22) : 0; if (k <= 0) return;
  const pulse = .7 + .3 * Math.sin(now / (since < 3.5 ? 55 : 320)); ctx.save(); ctx.beginPath(); ctx.rect(x - w / 2, y, w, h); ctx.clip(); ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(x, y + h * .62, 4, x, y + h * .62, h * .95); g.addColorStop(0, `rgba(255,110,40,${.9 * k * pulse})`); g.addColorStop(.55, `rgba(210,30,10,${.55 * k * pulse})`); g.addColorStop(1, "rgba(90,0,0,0)"); ctx.fillStyle = g; ctx.fillRect(x - w / 2, y, w, h);
  if (boss || since < 3.5) for (const sx of [-1, 1]) { ctx.fillStyle = `rgba(255,230,120,${k * pulse})`; ctx.beginPath(); ctx.ellipse(x + sx * w * .17, y + h * .34, 9, 5, sx * .35, 0, 7); ctx.fill(); }   // eyes in the dark
  ctx.restore();
  if (since < 3.5) drawSmoke3(x, y + h + 30, 2.1, 1.4, now / 1000, Math.min(1, since * 3) * (1 - since / 3.5));   // dust rolling out as it comes
}
// a piece whose art is animated (the burning lab on Whiteout Station: the user's GIF, frames in one row), cross-faded frame to frame
function drawAnimPiece(d, a) {
  const img = spooky(mapImgs[d.kind]); if (!img) return; const ft = gnow() / a.ms + (d.x * 3 + d.y) % a.frames, f = Math.floor(ft) % a.frames, f2 = (f + 1) % a.frames, k = ft - Math.floor(ft);
  ctx.save(); ctx.imageSmoothingEnabled = false; ctx.translate(Math.round(d.x), Math.round(d.y)); if (d.flip) ctx.scale(-1, 1);
  ctx.drawImage(img, f * a.w, 0, a.w, a.h, -Math.round(a.w / 2), -a.h, a.w, a.h); ctx.globalAlpha = k; ctx.drawImage(img, f2 * a.w, 0, a.w, a.h, -Math.round(a.w / 2), -a.h, a.w, a.h); ctx.restore();
}
// a piece's fires (animated flames + smoke, drawn on the burning building) and lit lanterns / windows (a warm flickering glow)
function dynPieceFx(d, a) {
  if (!a || (!a.fires && !a.lights && !a.blue)) return;
  const t = gnow() / 1000, f = d.flip ? -1 : 1, seed = (d.x * 7 + d.y * 13) % 100;
  ctx.save();
  (a.fires || []).forEach(([fx, fy, s], i) => {
    const x = d.x + fx * f, y = d.y + fy, k = .8 + .2 * Math.sin(t * 7 + i * 1.9 + seed);
    ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 1;
    const g = ctx.createRadialGradient(x, y, 2, x, y, 46 * s); g.addColorStop(0, `rgba(255,150,50,${.4 * k})`); g.addColorStop(1, "rgba(255,90,20,0)"); ctx.fillStyle = g; ctx.fillRect(x - 46 * s, y - 46 * s, 92 * s, 92 * s);
    ctx.globalCompositeOperation = "source-over"; if (a.anim) return;   // the art already burns: only the glow
    if (i === 0 && !fire3Piece(d.kind) && mapFireImg.naturalWidth) for (let j = 0; j < 4; j++) {   // smoke from the biggest fire (Whiteout Station pieces use drawSmoke3 below)
      const u = (t * .08 + j / 4 + seed * .01) % 1, r = (18 + u * 50) * s;
      ctx.globalAlpha = .55 * Math.sin(u * Math.PI); ctx.drawImage(mapFireImg, 0, MFIRE.h, MFIRE.puff, MFIRE.puff, x + u * 24 * s - r / 2, y - 20 * s - u * 130 * s - r / 2, r, r);
    }
    if (fire3Piece(d.kind)) { if (s >= .7) drawSmoke3(x, y - 20 * s, s * 1.15, i * 1.7 + seed, t); drawFire3(a.fires[i][3] ?? 1, x, y, s, i * 2.3 + seed, t); }   // the user's own fire loops, smoke behind the bigger ones
    else drawFireSprite(x, y + 10 * s, s * .62, i * 5 + seed, t, .95);
  });
  if (a.blue && !/^mSeal/.test(d.kind)) {   // The Deep Mine: glowing crystals: a cold blue halo, slowly breathing
    ctx.globalCompositeOperation = "lighter";
    a.blue.forEach(([lx, ly, sc], i) => { const x = d.x + lx * f, y = d.y + ly, r = 30 * sc, k = .55 + .25 * Math.sin(t * 1.6 + i * 2.1 + seed);
      ctx.globalAlpha = k; const g = ctx.createRadialGradient(x, y, 1, x, y, r); g.addColorStop(0, "rgba(110,205,255,.5)"); g.addColorStop(1, "rgba(40,120,255,0)"); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); });
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  }
  if (a.lights) {   // lanterns / lit windows: soft warm halo that breathes and now and then stutters
    ctx.globalCompositeOperation = "lighter";
    a.lights.forEach(([lx, ly], i) => {
      const x = d.x + lx * f, y = d.y + ly, st = Math.sin(t * 9 + i * 7.3 + seed) > .985 ? .3 : 1, k = (.6 + .2 * Math.sin(t * 2.3 + i * 1.7 + seed)) * st;
      ctx.globalAlpha = k; const g = ctx.createRadialGradient(x, y, 1, x, y, 24); g.addColorStop(0, "rgba(255,190,110,.55)"); g.addColorStop(1, "rgba(255,120,60,0)"); ctx.fillStyle = g; ctx.fillRect(x - 24, y - 24, 48, 48);
    });
  }
  ctx.restore();
}
// ---------- Painted maps (one picture is the ground: mapLayout.js PAINTED; none at the moment) ----------
const PAINT_URLS = {}, paintImgs = {};
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
// Hit flash without ctx.filter: draw the sprite, then (while flashing) add it to itself twice. "lighter" saturates toward white the
// way brightness(2.6) did, but costs two plain drawImage calls instead of a filtered offscreen pass per hit zombie per frame.
// Boss glow (enraged / sermon) without a drop-shadow filter: one cached additive blob behind the sprite, scaled to size.
const glowCache = new Map();
function bossGlow(x, y, rgb, r, alpha) {
  let c = glowCache.get(rgb);
  if (!c) { c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"), gr = g.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, `rgba(${rgb},.9)`); gr.addColorStop(.45, `rgba(${rgb},.35)`); gr.addColorStop(1, `rgba(${rgb},0)`); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); glowCache.set(rgb, c); }
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = alpha; ctx.drawImage(c, x - r, y - r * .8, r * 2, r * 1.6); ctx.restore();
}
function flashDraw(flashing, draw) { draw(); if (flashing) { const op = ctx.globalCompositeOperation; ctx.globalCompositeOperation = "lighter"; draw(); draw(); ctx.globalCompositeOperation = op; } }
// The user's three fire loops (tools/extract-fire3.py): 0 small, 1 medium, 2 big; 8 frames each, transparent, base = bottom centre of the cell.
const FIRE3 = [["assets/sprites/fx/fire3-s.webp", 84, 112], ["assets/sprites/fx/fire3-m.webp", 116, 127], ["assets/sprites/fx/fire3-b.webp", 176, 144]].map(([url, w, h]) => { const im = new Image(); im.src = url; return { im, w, h }; });
// The user's smoke (smoke3.webp: 8 frames in which the cloud builds). Each puff plays through once while it rises, swells and fades; three
// puffs a step apart keep a steady column. Drawn BEHIND the flames. (x, y) = the base of the fire.
const SMOKE3 = { im: new Image(), w: 150, h: 151 }; SMOKE3.im.src = "assets/sprites/fx/smoke3.webp";
function drawSmoke3(x, y, sc, phase, t, alpha = 1) {
  const S = SMOKE3; if (!S.im.naturalWidth) return; ctx.save(); ctx.imageSmoothingEnabled = true;
  for (let j = 0; j < 3; j++) {
    const u = (t * .16 + j / 3 + phase * .37) % 1, ft = u * 7.99, f = Math.floor(ft), k = (.75 + .7 * u) * sc, w = S.w * k, h = S.h * k, a = Math.min(1, u * 6) * (1 - u) ** 1.3 * alpha;
    const px_ = x + (u * 26 + Math.sin(u * 5 + j * 2 + phase) * 6) * sc, py_ = y - (10 + u * 95) * sc;   // drifts up and a little downwind
    ctx.globalAlpha = a * .85; blendCells(S.im, 0, 0, S.w, S.h, f, Math.min(7, f + 1), ft - f, px_ - w / 2, py_ - h, w, h);
  }
  ctx.restore();
}
function drawFire3(kind, x, y, sc, phase, t, alpha = 1) {   // (x, y) = the base of the flame; cross-faded frame to frame, with a soft additive pass so it glows
  const F = FIRE3[kind] || FIRE3[1]; if (!F.im.naturalWidth) return; const ft = t * 9 + phase, f = Math.floor(ft) % 8, f2 = (f + 1) % 8, w = F.w * sc, h = F.h * sc;
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.globalAlpha = alpha; blendCells(F.im, 0, 0, F.w, F.h, f, f2, ft - Math.floor(ft), x - w / 2, y - h, w, h);
  ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = alpha * .45; ctx.drawImage(F.im, f * F.w, 0, F.w, F.h, x - w / 2, y - h, w, h); ctx.restore();
}
function drawFireSprite(x, y, sc, phase, t, alpha = 1) {   // one burning fire: the flipbook, cross-faded frame to frame, with a bright additive pass
  if (!mapFireImg.naturalWidth) return;
  const ft = t * MFIRE.fps + phase, f = Math.floor(ft) % MFIRE.n, f2 = (f + 1) % MFIRE.n, w = MFIRE.w * sc, h = MFIRE.h * sc;
  ctx.globalAlpha = alpha; blendCells(mapFireImg, 0, 0, MFIRE.w, MFIRE.h, f, f2, ft - Math.floor(ft), x - w / 2, y - h, w, h);
  const op = ctx.globalCompositeOperation; ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = alpha * .45;
  ctx.drawImage(mapFireImg, f * MFIRE.w, 0, MFIRE.w, MFIRE.h, x - w / 2, y - h, w, h); ctx.globalCompositeOperation = op; ctx.globalAlpha = 1;
}
function drawPaintedGround(pm) {
  const t = gnow() / 1000;
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
// over everything (Fallen Dynasty / painted maps): rain, drifting blossom petals, embers floating up from the fires
function drawPaintedOverlay(fires) {
  const t = gnow() / 1000;
  ctx.save();
  if (carnivalMap()) {   // Midnight Carnival: confetti and litter tumbling past
    const COL = ["#ff5d6c", "#ffd24a", "#5ad1c9", "#b98cff", "#ff9a3d", "#f4efe0"];
    for (let i = 0; i < 70; i++) { const x = cam.x + ((i * 191.7 + t * (26 + i % 6 * 9) + Math.sin(t * .9 + i) * 26) % (W + 40)) - 20, y = cam.y + ((i * 113.3 + t * (34 + i % 4 * 12)) % (H + 40)) - 20;
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * (1.5 + i % 4) + i); ctx.globalAlpha = .75; ctx.fillStyle = COL[i % 6]; ctx.fillRect(-2.5, -1.5, 5, 3); ctx.restore(); }
    ctx.globalAlpha = 1;
  } else if (mineMap()) {   // The Deep Mine: dust drifting down from the roof, now and then a drip catching the light
    for (let i = 0; i < 70; i++) { const x = cam.x + ((i * 173.3 + Math.sin(t * .4 + i) * 30 + t * 6) % (W + 40)) - 20, y = cam.y + ((i * 97.1 + t * (12 + (i % 5) * 7)) % (H + 40)) - 20;
      ctx.globalAlpha = .18 + (i % 5) * .06; ctx.fillStyle = i % 4 ? "#c9b8a6" : "#e8dcc8"; ctx.fillRect(x, y, 1 + (i % 3 === 0), 1 + (i % 3 === 0)); }
    for (let i = 0; i < 6; i++) { const u = (t * .7 + i * .37) % 1, x = cam.x + ((i * 331.7) % W), y = cam.y + ((i * 211.3) % (H * .6)) + u * 160; ctx.globalAlpha = .55 * (1 - u); ctx.fillStyle = "#9fd8ff"; ctx.fillRect(x, y, 2, 5); }
    ctx.globalAlpha = 1;
  } else if (crucibleMap()) {   // The Crucible: grey ash drifting down, embers rising off the lava
    for (let i = 0; i < 80; i++) { const x = cam.x + ((i * 173.3 + Math.sin(t * .5 + i) * 40 + t * 9) % (W + 40)) - 20, y = cam.y + ((i * 97.1 + t * (16 + (i % 5) * 8)) % (H + 40)) - 20;
      ctx.globalAlpha = .2 + (i % 5) * .07; ctx.fillStyle = i % 4 ? "#a8a19c" : "#d8d0c8"; ctx.fillRect(x, y, 1 + (i % 3 === 0), 1 + (i % 3 === 0)); }
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 26; i++) { const u = (t * (.18 + (i % 4) * .05) + i * .137) % 1, x = cam.x + ((i * 331.7 + Math.sin(t + i) * 30) % W), y = cam.y + H - u * (H + 60);
      ctx.globalAlpha = .7 * Math.sin(u * Math.PI); ctx.fillStyle = i % 3 ? "#ff9a3a" : "#ffd27a"; ctx.fillRect(x, y, 2, 2 + (i % 2)); }
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
  } else if (refineryMap()) {   // Scorched Refinery: sand blowing across in the wind
    for (let i = 0; i < 90; i++) { const sp = 150 + (i % 7) * 40, x = cam.x + ((i * 173.3 + t * sp) % (W + 80)) - 40, y = cam.y + ((i * 97.1 + t * 22 + Math.sin(t * 1.3 + i) * 14) % (H + 40)) - 20;
      ctx.globalAlpha = .25 + (i % 5) * .08; ctx.fillStyle = i % 3 ? "#f3d9a0" : "#fff1cf"; ctx.fillRect(x, y, 3 + (i % 4) * 3, 1 + (i % 2)); }
    ctx.globalAlpha = 1;
  } else if (whiteoutMap()) {   // Whiteout Station: snow blowing across, a few long gust streaks
    for (let i = 0; i < 150; i++) { const sp = 30 + (i % 7) * 14, sz = 1 + (i % 3), x = cam.x + ((i * 173.3 + t * (sp + 40) + Math.sin(t * .7 + i) * 22) % (W + 40)) - 20, y = cam.y + ((i * 97.1 + t * sp * 1.6) % (H + 40)) - 20;
      ctx.globalAlpha = .35 + (i % 5) * .11; ctx.fillStyle = "#eef4ff"; ctx.fillRect(x, y, sz, sz); }
    ctx.globalAlpha = 1; ctx.strokeStyle = "rgba(225,235,255,.10)"; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 0; i < 16; i++) { const x = cam.x + ((i * 311.7 + t * 520) % (W + 200)) - 100, y = cam.y + ((i * 211.3 + t * 150) % (H + 60)) - 30; ctx.moveTo(x, y); ctx.lineTo(x + 46, y + 13); }
    ctx.stroke();
  } else {
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
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "lighter";
  fires.forEach(([x, y, sc], i) => {   // embers
    if (!inView(x, y - 60, 120)) return;
    for (let j = 0; j < 6; j++) {
      const u = (t * (.35 + j * .05) + j * .17 + i * .31) % 1, ex = x + Math.sin(u * 6 + j * 2 + i) * 16 * sc + u * 20, ey = y - u * 120 * sc;
      ctx.globalAlpha = .9 * (1 - u); ctx.fillStyle = j % 2 ? "#ffb347" : "#ffe08a"; ctx.fillRect(ex, ey, 2, 2);
    }
  });
  ctx.restore();
}
// ---- ground cache: the static ground (grass, roads, plaza, tiles, map edge) is painted once per 512px chunk into an offscreen canvas and
// blitted after that. Before this every frame re-filled the whole viewport with 10-20 overlapping pattern fills (the single biggest draw cost).
// Phones / small laptops (<= 4 cores or a coarse pointer) get 384px chunks and keep fewer: ~24 x 0.6MB instead of 36 x 1MB of canvases.
const LOW_END = (navigator.hardwareConcurrency || 8) <= 4 || matchMedia?.("(pointer: coarse)")?.matches || false;
const GROUND_CHUNK = LOW_END ? 384 : 512, GROUND_KEEP = LOW_END ? 24 : 30, groundChunks = new Map(); let groundKey = "";
function strHash(t) { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return h; }
function drawGroundCached(key, paint) {   // paint(x0, y0, w, h) draws that world rect with the normal helpers (ctx is the chunk while it runs)
  if (key !== groundKey) { groundKey = key; groundChunks.clear(); }
  const C = GROUND_CHUNK, gx0 = Math.floor((cam.x - 64) / C), gy0 = Math.floor((cam.y - 64) / C), gx1 = Math.floor((cam.x + W + 64) / C), gy1 = Math.floor((cam.y + H + 64) / C);
  for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
    const k = gx * 4096 + gy; let c = groundChunks.get(k);
    if (!c) {
      if (groundChunks.size >= GROUND_KEEP) {   // full: drop the chunk farthest from the camera
        let far = null, fd = -1; const ccx = (cam.x + W / 2) / C, ccy = (cam.y + H / 2) / C;
        for (const key of groundChunks.keys()) { const kx = Math.floor(key / 4096), ky = key - kx * 4096, d = (kx + .5 - ccx) ** 2 + (ky + .5 - ccy) ** 2; if (d > fd) { fd = d; far = key; } }
        groundChunks.delete(far);
      }
      c = document.createElement("canvas"); c.width = c.height = C; const g = c.getContext("2d"), main = ctx;
      ctx = g; g.imageSmoothingEnabled = false; g.translate(-gx * C, -gy * C);
      try { paint(gx * C, gy * C, C, C); } catch (e) { reportError(e, "ground"); } finally { ctx = main; }
      groundChunks.set(k, c);
    }
    ctx.drawImage(c, gx * C, gy * C);
  }
}
function drawWorldArt(grassP, asphaltP, plazaP, walkP) {
  const WW = worldW(), WH = worldH(), cx = WW / 2, cy = WH / 2, R = roads();
  drawGroundCached("city" + WW + "x" + WH + ":" + strHash(state?.mapLayout || ""), (vx, vy, vw, vh) => {
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
    for (const r of R.h) for (let x = Math.floor(vx / 54) * 54 + 12; x < vx + vw; x += 54) if (!(r.main && Math.abs(x - cx) < 300)) px(x, r.y - 2, 24, 4, r.main ? "#7d6d4c" : "#665e4b");
    for (const r of R.v) for (let y = Math.floor(vy / 54) * 54 + 10; y < vy + vh; y += 54) if (!(r.main && Math.abs(y - cy) < 250)) px(r.x - 2, y, 4, 24, r.main ? "#7d6d4c" : "#665e4b");
    // map edge
    ctx.fillStyle = "#0c1012"; ctx.fillRect(-60, -60, WW + 120, 60); ctx.fillRect(-60, WH, WW + 120, 60); ctx.fillRect(-60, 0, 60, WH); ctx.fillRect(WW, 0, 60, WH);
    px(0, 0, WW, 4, "#3d4441"); px(0, WH - 4, WW, 4, "#3d4441"); px(0, 0, 4, WH, "#3d4441"); px(WW - 4, 0, 4, WH, "#3d4441");
  });
  syncDecor();
  const tall = [];
  for (const d of decor) { if (!inView(d.x, d.y - 60, 200)) continue; if (MAP_FLAT[d.kind]) drawMapObj(d); else tall.push({ y: d.y - 6, draw: () => drawMapObj(d) }); }
  drawWorldObjects(tall);
}
let crownCv = null;
function crownSprite() {
  if (crownCv) return crownCv;
  const c = document.createElement("canvas"); c.width = 48; c.height = 40; const g = c.getContext("2d");
  g.font = 'bold 22px serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.shadowColor = '#ffd84d'; g.shadowBlur = 12; g.fillStyle = '#ffd84d'; g.fillText('♛', 24, 30);
  return crownCv = c;
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
  for (const z0 of state.zombies.values()) { const z = V(z0); if (inView(z.x, z.y, z0.boss ? 460 : 220)) items.push({ y: z.y + 10, draw: () => { drawZombieAny(z); if (z0.burn > 0) drawBurning(z, z0.burn); } }); }
  if (state.robots) for (const r0 of state.robots.values()) { const r = r0; if (inView(r.x, r.y, 80)) items.push({ y: r.y + 6, draw: () => drawRobot(r) }); }
  for (const c of bossCorpses) if (inView(c.x, c.y, 200)) items.push({ y: c.y - 20, draw: () => drawBossCorpse(c) });
  for (const p0 of state.players.values()) { const p = V(p0); if (inView(p.x, p.y, 120)) { const air = state.vehicles?.get(p0.sessionId)?.kind === "heli"; if (p0.ride > 0 && coast) {} else items.push({ y: air ? 1e7 + p.y : p.y + 12, draw: () => drawSurvivor(p) }); } }   // the helicopter flies above everything
  healOverlays(items);
  items.sort((a, b) => a.y - b.y).forEach(it => { const d = ctxDepth; ctx.save(); try { it.draw(); } catch (e) { reportError(e, "draw"); } unwindTo(d); });
  const pmOver = paintedMap()?.fires || (dynastyMap() ? dynFires : null); if (pmOver) { const d = ctxDepth; ctx.save(); try { drawPaintedOverlay(pmOver); } catch (e) { reportError(e, "draw"); } unwindTo(d); }   // rain, petals, embers over everything
  for (const f of mechaLate.splice(0)) { const d = ctxDepth; ctx.save(); try { f(); } catch (e) { reportError(e, "draw"); } unwindTo(d); }     // a sprite that throws can't leave its save() open   // one broken sprite can't stop the rest
  ctx.fillStyle = '#e9d7b2'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.fillText('RADIO TOWER', cx, cy + 104);
  const leader0 = [...state.players.values()].sort((a, b) => b.kills - a.kills || (a.killLeadSince || Number.MAX_SAFE_INTEGER) - (b.killLeadSince || Number.MAX_SAFE_INTEGER) || String(a.name).localeCompare(String(b.name)))[0], leader = V(leader0);
  if (leader && leader.kills > 0) ctx.drawImage(crownSprite(), Math.round(leader.x) - 24, Math.round(leader.y) - 60 - 30);   // the kill leader's glowing crown (rendered once: a blurred glyph per frame was a full blur pass)
  drawShotFx();
  drawReviveRing(); drawAstraShield();
  drawCrosshair();
}

let vignette = null;
// ---------- Night: darkness everywhere except around players and under street lights ----------
// Each player only sees their own light (no shared vision). playerR = 20% of the screen width (V toggles 30% in the solo preview).
const NIGHT = { playerR: 240, lightR: 125, lightAlpha: .55, dark: .95 };
const VISION_STEPS = [0.2, 0.3];
// The darkness layer is built at half resolution (a quarter of the pixels to fill and punch holes in) and scaled up with smoothing:
// soft light edges look the same and the night costs a fraction of a full-size layer.
const DARK_SCALE = .5, darkCv = document.createElement("canvas"); darkCv.width = Math.ceil(W * DARK_SCALE); darkCv.height = Math.ceil(H * DARK_SCALE); const dctx = darkCv.getContext("2d"); dctx.scale(DARK_SCALE, DARK_SCALE);
let nightK = 0, nightLast = 0, forceNight = false; const CAVE_DARK = .5, LAVA_DARK = .46;   // LAVA_DARK: The Crucible, deep in the volcano (lit by its lava)   // forceNight: N key in the solo preview, to test the look
const isNightView = () => !!state && (state.isNight || forceNight);
let eyeGlowCv = null;
function eyeGlow() {   // a 16x16 glowing green dot, blurred once
  if (eyeGlowCv) return eyeGlowCv;
  const c = document.createElement("canvas"); c.width = c.height = 16; const g = c.getContext("2d");
  g.fillStyle = "rgba(200,255,110,1)"; g.shadowColor = "#b8ff6a"; g.shadowBlur = 6; g.fillRect(7, 7, 2, 2); g.fillRect(7, 7, 2, 2);
  return eyeGlowCv = c;
}
// A light in the dark: punches a soft hole in the darkness layer. The radial gradient is rendered once per (radius, alpha) and reused:
// building a gradient for every lamp, fire and explosion on every frame added up on big maps.
const holeCache = new Map();   // radius (8px steps) -> the hole at full strength; the light's strength is the draw's globalAlpha
function lightHole(x, y, r, a) {
  const R = Math.max(8, Math.round(r / 8) * 8); let c = holeCache.get(R);
  if (!c) {
    if (holeCache.size > 40) holeCache.clear();
    c = document.createElement("canvas"); c.width = c.height = R * 2; const g = c.getContext("2d"), gr = g.createRadialGradient(R, R, 0, R, R, R);
    gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(.55, "rgba(0,0,0,1)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, R * 2, R * 2); holeCache.set(R, c);
  }
  dctx.globalAlpha = Math.max(0, Math.min(1, a)); dctx.drawImage(c, x - R, y - R); dctx.globalAlpha = 1;
}
function drawNight() {
  const now = gnow(), dt = Math.min(.1, (now - (nightLast || now)) / 1000); nightLast = now;
  if (window.__saNoDark) return;   // (automated map surveys: no darkness)
  nightK += ((isNightView() ? 1 : mineMap() ? (now < (deepFx.dark || 0) ? .93 : CAVE_DARK) : crucibleMap() ? LAVA_DARK : 0) - nightK) * Math.min(1, dt * (now < (deepFx.dark || 0) ? 4 : 1.5));   // (a cave-in puts the lanterns out for a few seconds)   // The Deep Mine is always half dark (a cave): lanterns, crystals and you light it          // fade in/out over ~2 seconds
  if (nightK < .01) return;
  const warm = crucibleMap(); ctx.fillStyle = warm ? `rgba(26,6,2,${.22 * nightK})` : `rgba(4,8,15,${.25 * nightK})`; ctx.fillRect(0, 0, W, H);     // cold blue tint (The Crucible: a red-brown one)
  dctx.globalCompositeOperation = "source-over"; dctx.clearRect(0, 0, W, H);
  dctx.fillStyle = warm ? `rgba(10,3,2,${NIGHT.dark * nightK})` : `rgba(2,4,8,${NIGHT.dark * nightK})`; dctx.fillRect(0, 0, W, H);
  dctx.globalCompositeOperation = "destination-out";
  const sl = mapImgs.streetlight;
  if (decor && sl?.naturalWidth) for (const d of decor) {
    if (d.kind !== "streetlight" || !inView(d.x, d.y, NIGHT.lightR)) continue;
    lightHole(d.x + (d.flip ? -1 : 1) * STREETLIGHT_LAMP.x * sl.width - cam.x, d.y - 24 - cam.y, NIGHT.lightR, NIGHT.lightAlpha);
  }
  if (coast && coast.mn) { for (let i = 0; i < CO.carts; i++) { const c = coasterCart(coast.T, coast.s, i); if (inView(c.x, c.y, 200)) lightHole(c.x - cam.x, c.y - 30 - cam.y, i ? 70 : 150, i ? .5 : .85); } }   // the mine carts' lamps
  else if (coast) { const P = coast.T.pts; for (let i = 0; i < P.length; i += 5) if (inView(P[i].x, P[i].y, 120)) lightHole(P[i].x - cam.x, P[i].y - CO.H + 15 - cam.y, 64, .5); const c = coasterCart(coast.T, coast.s, 0); if (inView(c.x, c.y, 200)) lightHole(c.x - cam.x, c.y - CO.H - cam.y, 120, .75); }   // the bulbs along the track, the train
  if (dynastyMap()) {   // Fallen Dynasty: every lantern / lit window and fire lights the night
    for (const [x, y, b] of dynLights) if (inView(x, y, 120)) lightHole(x - cam.x, y + 30 - cam.y, b ? 95 : 110, b ? .7 : .8);
    if (mineMap()) for (const m of deepFx.marks || []) if ((m.kind === "rock" || m.kind === "spike" || m.kind === "erupt") && inView(m.x, m.y, 300)) lightHole(m.x - cam.x, m.y - cam.y, m.r * 1.9, .8);   // the warning marks (and what lands on them) are always lit, even with the lanterns out
    if (mineMap()) for (const f of deepFlashes) { const k = (now - f.t0) / f.len; if (k < 1 && inView(f.x, f.y, f.r)) lightHole(f.x - cam.x, f.y - cam.y, f.r * 1.3, .9 * (1 - k)); }   // impacts and shattering crystals light the dark for a moment
    if (mineMap()) for (const b of deepFx.boulders || []) if (inView(b.x, b.y, 150)) lightHole(b.x - cam.x, b.y - 40 - cam.y, 120, .55);
    if (mineMap()) { const D = deepState(); if (D?.step === "fight" && D.sh) { const d = deepPieces().shrines[D.sh.i]; if (d && inView(d.x, d.y, 320)) lightHole(d.x - cam.x, d.y - 80 - cam.y, 300, .9); } }   // the glowing shrine lights the dark   // the boulders stay findable in the dark
    if (mineMap()) for (const z of state.zombies.values()) if (z.kind === "minebeast" && inView(z.x, z.y, 500)) { const v = V(z) || z, u = z.act ? Math.max(0, Math.min(1, 1 - z.slam / (z.actLen || 1))) : 0, big = z.act === "wind" || z.act === "roar" || z.act === "dive" ? u : z.act === "charge" ? 1 : 0; lightHole(v.x - cam.x, v.y - 120 - cam.y, 320 + 160 * big, .9); }   // the Mine Beast glows: you always see it coming
    if (mineMap() && decor) for (const d of decor) { if (d.kind === "mPortal" && inView(d.x, d.y - 250, 300)) lightHole(d.x - cam.x, d.y - 300 - cam.y, 260, .9); else if (d.kind === "mRuneCircle" && inView(d.x, d.y, 300)) lightHole(d.x - cam.x, d.y - cam.y, 240, .55); else if (/^mSeal/.test(d.kind) && inView(d.x, d.y, 200)) lightHole(d.x - cam.x, d.y - 110 - cam.y, 150, .85); else if (d.kind === "mBrazier" && inView(d.x, d.y, 200)) lightHole(d.x - cam.x, d.y - 60 - cam.y, 120, .8); else if ((d.kind === "mShrine" || d.kind === "mStop") && inView(d.x, d.y, 200)) lightHole(d.x - cam.x, d.y - (d.kind === "mStop" ? 40 : 150) - cam.y, 150, .8); }
    for (const [x, y, sc] of dynFires) if (inView(x, y, 200)) lightHole(x - cam.x, y - cam.y, 120 * sc + 40, .85);
    if (crucibleMap()) lavaLights();
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
  pyreLights(now);   // the Pyre Priest and his fires light the night
  screamerLights(now); abomLights(now);
  turretLights(now);
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.drawImage(darkCv, 0, 0, W, H); ctx.restore();
  // zombies out in the dark: only a faint pair of glowing eyes gives them away
  if (nightK > .5) {
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (const z0 of state.zombies.values()) {
      const z = V(z0); if (z.kind === "mutant" || !inView(z.x, z.y, 0) || litAt(z.x, z.y)) continue;   // mutants have no glowing eyes: you don't see them coming
      const blink = Math.sin(now / 900 + z.x * .7) > .93 ? .15 : 1, ex = z.x - cam.x, ey = z.y - cam.y - (z.boss ? 58 : z.kind === "brute" ? 66 : 30), sp = z.boss ? 6 : 3;
      ctx.globalAlpha = .75 * blink * nightK; const g = eyeGlow();   // pre-blurred dot: a shadowBlur per zombie was a blur pass each, every frame
      ctx.drawImage(g, ex - sp - 8, ey - 7); ctx.drawImage(g, ex + sp - 8, ey - 7);
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
  drawRushScreen();   // Marcus Combat Rush: red heartbeat on the screen edges (over the night tint so it shows at night too)
  drawPyreDread(); drawScreamerScreen();
  // street lights glow (warm, stronger at night)
  const sl = mapImgs.streetlight;
  if (decor && sl?.naturalWidth) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; const k = .45 + .55 * nightK, flick = .92 + .08 * Math.sin(gnow() / 90);
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
  if (state.mission) targets.shift();   // the mine mission: no tower arrow (drawDeepHud points you at your objective)
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
  try { drawDeepHud(); } catch (e) { reportError(e, "deep"); }
  // minimap: whole world, your view as a box
  const mini = $('minimap'), m = mini.getContext('2d'), MW = 360, MH = 228, sx = MW / worldW(), sy = MH / worldH(), R = roads();
  m.imageSmoothingEnabled = false; m.clearRect(0, 0, MW, MH); m.fillStyle = '#11191a'; m.fillRect(0, 0, MW, MH);
  const pmM = paintedMap(), pmI = pmM && paintImgs[pmM.art];
  if (pmI?.naturalWidth) { m.globalAlpha = .75; m.imageSmoothingEnabled = true; m.drawImage(pmI, 0, 0, MW, MH); m.globalAlpha = 1; m.imageSmoothingEnabled = false; }
  else if (dynastyMap() && dynGroundCache) { const wo = whiteoutMap(), rf = refineryMap(), mnM = mineMap(), kcM = crucibleMap(); m.fillStyle = kcM ? '#262022' : mnM ? '#3b302b' : rf ? '#b98d4e' : wo ? '#39424f' : '#231f29'; m.fillRect(0, 0, MW, MH); for (const g of dynGroundCache.g) { m.fillStyle = kcM ? ({ ash: '#3f3a3c', cooled: '#2c2224', plates: '#4a3028' }[g.tile] || '#262022') : mnM ? ({ stone: '#3a3340', mud: '#4a3526', planks: '#6b4a2e', dungeon: '#252838' }[g.tile] || '#3b302b') : rf ? ({ cracked: '#a8733f', asphalt: '#4a4a4e' }[g.tile] || '#9c9488') : wo ? (g.tile === 'ice' ? '#4f7fa8' : g.road ? '#262b34' : '#2f3540') : g.road ? '#3f3a49' : '#4a4452'; m.fillRect(g.x * sx, g.y * sy, Math.max(2, g.w * sx), Math.max(2, g.h * sy)); }
    for (const d of decor || []) { const a = DYN_ART[d.kind]; if (a && a.w >= 200 && !a.flat) { m.fillStyle = d.kind === 'rPyramid' || d.kind === 'kCrucible' ? '#e0b24a' : d.kind === 'kFalls' ? '#ff7a1a' : d.kind[0] === 'k' ? (/Rock|Basalt|Spire/.test(d.kind) ? '#4a3d3a' : '#6e4a34') : d.kind === 'mPortal' ? '#4fc3e8' : d.kind[0] === 'm' ? (/Crystal|Seal/.test(d.kind) ? '#4fc3e8' : /Rock/.test(d.kind) ? '#5b463f' : '#7a5a3c') : d.kind[0] === 'r' ? (/Burnt|Flare/.test(d.kind) ? '#d2541e' : '#6d5a4a') : d.kind[0] === 'w' ? (/Burnt/.test(d.kind) ? '#c2562a' : '#aab3c4') : /Burnt|Ruin|Apartment/.test(d.kind) ? '#5a3b30' : '#6a2e2a'; m.fillRect((d.x - a.w * .42) * sx, (d.y - a.h * .55) * sy, a.w * .84 * sx, a.h * .5 * sy); } }
    if (kcM) { if (!lavaRivers) lavaRivers = crucibleRivers(); for (const r of lavaRivers) { m.strokeStyle = '#ff6a14'; m.lineWidth = Math.max(2, 260 * sx); m.beginPath(); r.pts.forEach((q, i) => i % 4 ? 0 : i ? m.lineTo(q.x * sx, q.y * sy) : m.moveTo(q.x * sx, q.y * sy)); m.stroke(); m.fillStyle = '#c9b49a'; for (const b of r.bridges) m.fillRect((b.x - 300) * sx, (b.y - 60) * sy, 600 * sx, Math.max(2, 120 * sy)); } }   // The Crucible: the lava rivers, the bridges over them
    if (coast) { m.strokeStyle = coast.mn ? '#d9a35c' : '#ff5d6c'; m.lineWidth = 1.5; m.beginPath(); coast.T.pts.forEach((q, i) => i % 3 ? 0 : i ? m.lineTo(q.x * sx, q.y * sy) : m.moveTo(q.x * sx, q.y * sy)); m.closePath(); m.stroke(); for (const q of coast.T.stations) { m.fillStyle = '#5ad1c9'; m.beginPath(); m.arc(q.x * sx, q.y * sy, 3, 0, 7); m.fill(); } const c = coasterAt(coast.T, coast.s); m.fillStyle = '#ffe08a'; m.fillRect(c.x * sx - 2.5, c.y * sy - 2.5, 5, 5); } }
  else { m.fillStyle = '#353e3d'; for (const r of R.h) m.fillRect(0, (r.y - r.w / 2) * sy, MW, Math.max(2, r.w * sy)); for (const r of R.v) m.fillRect((r.x - r.w / 2) * sx, 0, Math.max(2, r.w * sx), MH); }
  if (decor) { m.fillStyle = '#4a4440'; for (const d of decor) if (d.kind === 'building' || d.kind === 'ruin') m.fillRect((d.x - 70) * sx, (d.y - 110) * sy, 140 * sx, 100 * sy); }
  m.fillStyle = '#d58b45'; m.fillRect(towerX() * sx - 5, towerY() * sy - 5, 10, 10);
  for (const st of state.structures.values()) { m.fillStyle = '#c19a5c'; m.fillRect(st.x * sx - 2, st.y * sy - 2, 4, 4); }
  for (const z of state.zombies.values()) { if (!z.boss && !litAt(z.x, z.y)) continue; m.fillStyle = z.boss ? '#ff3737' : '#a9bd78'; const r = z.boss ? 4 : 2; m.fillRect(z.x * sx - r / 2, z.y * sy - r / 2, r, r); }
  for (const pl of state.players.values()) { m.fillStyle = pl.alive ? pl.color : '#ff7568'; m.fillRect(pl.x * sx - 3, pl.y * sy - 3, 6, 6); }
  { const D = deepState(); if (D) { for (const r of D.runes) if (r.st !== 3) { m.fillStyle = '#7fd4ff'; m.beginPath(); m.arc(r.x * sx, r.y * sy, 3.2, 0, 7); m.fill(); m.strokeStyle = '#06202f'; m.lineWidth = 1; m.stroke(); } if (D.sh) { const d = deepPieces().shrines[D.sh.i]; if (d) { m.fillStyle = '#9fe3ff'; m.beginPath(); m.arc(d.x * sx, d.y * sy, 4 + Math.sin(gnow() / 150) * 1.5, 0, 7); m.fill(); } }   // the glowing shrine (shield run)
    const o = deepObjective(); if (o?.at) { m.strokeStyle = '#ffe08a'; m.lineWidth = 1.5; m.beginPath(); m.arc(o.at.x * sx, o.at.y * sy, 5 + Math.sin(gnow() / 200) * 1.5, 0, 7); m.stroke(); } for (const z of state.zombies.values()) if (z.kind === 'minebeast') { m.fillStyle = '#ff3737'; m.fillRect(z.x * sx - 3, z.y * sy - 3, 6, 6); } } }
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
let lastStateAt = gnow(), stallReported = false;
setInterval(() => {
  if (!room || !state || state.phase !== "playing") { lastStateAt = gnow(); return; }
  const gap = gnow() - lastStateAt;
  if (gap > 3000 && !reconnecting && document.visibilityState === "visible" && room.reconnectionToken && !SOLO_PREVIEW) {   /* the connection is stuck (nothing from the server for 3s mid-wave): drop it and reconnect instead of standing frozen */
    const old = room, tok = room.reconnectionToken; dropInfo = { code: "stuck " + Math.round(gap) + "ms", at: Date.now(), vis: "visible" }; lastStateAt = gnow();
    try { old.removeAllListeners(); } catch {} try { old.connection.close(); } catch {}
    reconnectRoom(tok); return;
  }
  if (gap < 1000) stallReported = false;
}, 1000);
let pauseSentAt = 0, pauseNoteOn = false;
function pauseSync() {   // (Nov 12) the host's Esc menu = the whole game paused; closing it (RESUME, Esc, a dev button) unpauses. Everyone else gets a notice.
  if (!room || !state) return; const host = SOLO_PREVIEW || state.hostId === myId, ph = state.phase, paused = !!state.paused;
  if (host) { const want = !$("menu").classList.contains("hidden") && (ph === "playing" || ph === "cleared");
    if (want !== paused && _realNow() - pauseSentAt > 400) { pauseSentAt = _realNow(); room.send("pause", { on: want }); } }
  const note = paused && !host; if (note !== pauseNoteOn) { pauseNoteOn = note; $("pauseNote").classList.toggle("hidden", !note); }
  txt("pmTitle", host || paused ? "PAUSED" : "MENU");
}
function frame(t){
  gamePause(!!state?.paused); try { pauseSync(); } catch (e) { reportError(e, "pause"); }
  if (gnow() < hitStopUntil) { requestAnimationFrame(frame); return; }   // deflect hit-stop: freeze for a split second
  requestAnimationFrame(frame);
  unwindTo(0); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.filter = "none";   // start every frame clean
  try {
    sendControls(t); updateFeel(); updateCamera(t); updateMusic(); stopLostHeliLoops(); fireAmbience();
    ctx.clearRect(0, 0, W, H);
    const off = shakeOffset();
    ctx.save(); ctx.translate(off.x - Math.round(cam.x), off.y - Math.round(cam.y)); drawWorld(); drawFeel(); ctx.restore();
    drawScreen(); drawBuildWheel(); drawSquadWheel(); drawHurt();
    if (gnow() < flashUntil) { ctx.fillStyle = `rgba(255,248,220,${(flashUntil - gnow()) / 140 * .55})`; ctx.fillRect(0, 0, W, H); }
    drawReticle();   // last: nothing (night, flashes, overlays) can hide where you aim
  } catch (e) { unwindTo(0); ctx.setTransform(1, 0, 0, 1, 0, 0); reportError(e, "frame"); }
}
requestAnimationFrame(frame);
// ===================== LOBBY / CHARACTER SELECT SCREEN =====================
// Roster: who you can pick (Sofea was removed; Arshan shows as the locked "???" tile until he's ready).
const ROSTER = [
  { id: "assault", name: "MARCUS", role: "ASSAULT", cat: "assault", hp: 110, dmg: 17, spd: 190, def: 0, desc: "Balanced frontline fighter. Fast rifle fire and a damage rush when the horde closes in.",
    skills: [{ k: "E", n: "Combat Rush", cd: 15, t: "+50% damage and +25% attack speed (guns and melee) for 6 seconds." },
             { k: "Q", n: "Frag Barrage", cd: 20, t: "A blast shoves nearby zombies away, he hops back, and 3 grenades fan out to where you aim: big knockback blasts." }],
    trait: { n: "Veteran", t: "Years on the front line: +10% damage and +10% fire rate with every weapon." }, gear: ["rifle", "pistol", "knife"] },
  { id: "juggernaut", name: "BRIGGS", role: "JUGGERNAUT", cat: "tank", hp: 160, dmg: 14, spd: 150, def: 5, desc: "Shotgun tank who thrives in the thick of combat, protecting the team and crushing hordes.",
    skills: [{ k: "E", n: "Iron Bastion", cd: 30, card: "ironBastion", t: "A steel dome for 15s: nothing gets through. It shatters outward and knocks zombies back." },
             { k: "Q", n: "War Cry", cd: 60, card: "warCry", t: "Taunts every zombie within 350px, halves damage taken and boosts teammates' damage +25%. Shotgun spam, no ammo, for 10s." }],
    trait: { n: "Forceful Blast", card: "forcefulBlast", t: "Shotgun shots knock back every zombie, bosses too. Thick skin: every hit on him does 5 less damage." }, gear: ["shotgun", "pistol", "knife"] },
  { id: "operator", name: "SOFEA", role: "OPERATOR", cat: "specialist", hp: 115, dmg: 15, spd: 180, def: 0, desc: "Heavy-metal specialist. Calls in her own tank and a gunship, and pilots the Crimson Aegis mecha straight into the horde.",
    skills: [{ k: "E", n: "Steel Convoy", card: "steelConvoy", cd: 30, t: "Drive a tank for 30s: cannon on click, run zombies over, takes much less damage." },
             { k: "Q", n: "Sky Reign", card: "skyReign", cd: 60, t: "Fly a gunship for 30s over everything: its machine gun shreds every zombie in a 90° cone where you aim. Zombies can't reach you." },
             { k: "R", n: "Crimson Aegis", card: "crimsonAegis", cd: 100, t: "Transform into the Crimson Aegis mecha for 30s. Hold click: flame jet (190px, 60° cone). Right click: a lightsaber sweep (120px, 80 dmg). R again to step out." }],
    trait: { n: "Mechanic", t: "She keeps machines running: repairing the tower and the generator and refuelling cost her half the scrap and fuel." }, gear: ["smg", "pistol", "knife"] },
  { id: "engineer", name: "VIKTOR", role: "ENGINEER", cat: "specialist", hp: 110, dmg: 15, spd: 175, def: 1, desc: "Builds his own army: three kinds of combat robot and a heavy minigun turret.",
    skills: [{ k: "E", n: "Robot Squad", card: "robotSquad", cd: 25, t: "Deploy an assault, support or hunter robot. 3 charges, +1 every 25s." },
             { k: "Q", n: "Heavy Turret", card: "heavyTurret", cd: 60, t: "A heavy minigun turret that shreds everything for 40s." }],
    trait: { n: "Tinkerer", t: "Robot charges refill on their own (+1 every 25s, up to 3), he can keep 1 extra turret out (4 instead of 3), and his gear gives him 1 armour: every hit does 1 less damage. Slightly lower damage (×0.97)." }, gear: ["rifle", "pistol", "knife"] },
  { id: "scout", name: "RAVEN", role: "SCOUT", cat: "assault", hp: 90, dmg: 15, spd: 225, def: 0, desc: "Katana only. Dashes through the horde, vanishes, then strikes with a burning blade.",
    skills: [{ k: "E", n: "Shadow Pass", card: "shadowPass", cd: 25, t: "Dash through zombies and vanish. Your next attack ignites the katana." },
             { k: "Q", n: "Blade Storm", card: "bladeStorm", cd: 60, t: "A whirlwind of katana slashes around you." }],
    trait: { n: "Katana Mastery", t: "Her blade levels up every 50 katana kills: T1 +25% dmg · T2 hits 5, wider · T3 bleed · T4 +30% speed · T5 every 4th slash crits ×2.5. Fastest hero." }, gear: ["katana"] },
  { id: "demolitionist", name: "DANTE", role: "DEMOLITIONIST", cat: "assault", hp: 105, dmg: 18, spd: 175, def: 0, desc: "If it's standing, it's a target. Rockets land wherever you click.",
    skills: [{ k: "E", n: "Sky Barrage", card: "skyBarrage", cd: 8, t: "3 rockets up, 3 down around your mouse." },
             { k: "Q", n: "Demo Ripple", card: "demoRipple", cd: 60, t: "Plant the crate, press Q again: rings of grenades." }],
    trait: { n: "Demolitions Expert", t: "Everything he fires hits harder: +17% damage. Big guns are slow: ×0.85 fire rate." }, gear: ["launcher", "pistol", "knife"] },
  { id: "sniper", name: "SIENNA", role: "SNIPER", cat: "specialist", hp: 95, dmg: 21, spd: 165, def: 0, desc: "Precision long-range damage. Picks off the biggest threats first.",
    skills: [{ k: "E", n: "Dead Eye", cd: 24, t: "One huge aimed shot where you point: 12x a shot of the gun you're holding. It goes through as many zombies as that gun does (sniper 3, shotgun 2, launcher explodes). Holding melee? It uses your gun." }],
    trait: { n: "Marksman", t: "Every shot counts: +43% damage with every weapon, but she fires slower (×0.65). Her sniper also does +50% to bosses and brutes." }, gear: ["sniper", "pistol", "knife"] },
  { id: "dispatcher", name: "ASTRA", role: "EMERGENCY CMDR", cat: "support", hp: 120, dmg: 15, spd: 180, def: 0, isNew: true, desc: "Calm field leader who always has backup on the way: medics, police and a safehouse.",
    skills: [{ k: "E", n: "Emergency Medics", card: "medicTeam", cd: 30, t: "A medic arrives: everyone within 300px of you heals 30% of their max HP at once. For 20s he revives downed teammates first (2.5s each), then heals the injured (5 HP/s)." },
             { k: "Q", n: "Police Backup", card: "policeBackup", cd: 60, t: "Armed officers for 30s: 2 guard you, 1 guards each living teammate. 5-round bursts every 2s. Each Heavy Weapon pick: +15% officer damage." },
             { k: "R", n: "Safehouse", card: "safehouse", cd: 90, t: "Workers build 4 walls around you in 5s (you can't be hurt meanwhile), then stay to repair (6 hits break it). Zombies can't get in for 45s." }],
    trait: { n: "Field Commander", t: "Trained for emergencies: she revives downed teammates twice as fast (2.5s instead of 5s)." }, gear: ["rifle", "pistol", "knife"] },
];
const ROLE_ICON = { assault: '<path d="M3 12h13l5-3v6l-5-3M7 12v4"/>', tank: '<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z"/>', support: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>', specialist: '<path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19"/>' };
const GEAR = { rifle: "Rifle · full auto, 30 rounds", pistol: "Pistol · infinite ammo", smg: "SMG · full-auto spray, 30 rounds", sniper: "Sniper · 5 rounds, pierces 3, +50% vs bosses & brutes", shotgun: "Shotgun · 6 shells, pellets pierce 2, full damage up close", launcher: "Launcher · rockets explode where you click", knife: "Knife · fast stabs", katana: "Katana · upgrades with kills", bat: "Bat", axe: "Fire axe · hold for a heavy swing" };
// literal paths so the single-file preview build can embed them
const HERO_ART = { assault: "assets/hero/assault.webp", juggernaut: "assets/hero/juggernaut.webp", engineer: "assets/hero/engineer.webp", scout: "assets/hero/scout.webp",
  demolitionist: "assets/hero/demolitionist.webp", sniper: "assets/hero/sniper.webp", dispatcher: "assets/hero/dispatcher.webp", operator: "assets/hero/operator.webp" };
const SITE_NAMES = [["ASCENSION SITE 01", "Research Outpost"], ["ASCENSION SITE 02", "Old Town Streets"], ["ASCENSION SITE 03", "Crossroads Ruins"], ["FALLEN DYNASTY", "China · Walled City"], ["WHITEOUT STATION", "Antarctica · Research Base"], ["SCORCHED REFINERY", "Desert · Oil Field & Pyramid"], ["THE DEEP MINE", "Underground · Mine Carts & a Sealed Portal"], ["THE CRUCIBLE", "Volcano · a ruined iron foundry"]];
// (Nov 12, user) THE MAP ORDER (as on the server, CHAPTERS): 4 waves per map, its boss on the 4th; beat it and the team moves on.
const MAP_ORDER = [
  { site: 0, name: "ASCENSION", short: "ASCENSION", sub: "Research Outpost", boss: "THE BUTCHER" },
  { site: 3, name: "FALLEN DYNASTY", short: "DYNASTY", sub: "China · Walled City", boss: "THE ALPHA HIVEMIND" },
  { site: 4, name: "WHITEOUT STATION", short: "WHITEOUT", sub: "Antarctica · Research Base", boss: "THE SCREAMER" },
  { site: 5, name: "SCORCHED REFINERY", short: "REFINERY", sub: "Desert · Oil Field & Pyramid", boss: "THE PYRE PRIEST" },
  { site: 6, name: "THE DEEP MINE", short: "DEEP MINE", sub: "Underground · Mine Carts & a Sealed Portal", boss: "THE MINE BEAST" },
  { site: 7, name: "THE CRUCIBLE", short: "CRUCIBLE", sub: "Volcano · a ruined iron foundry", boss: "THE ABOMINATION" },
];
let mapCardKey = -1;
function showMapCard(wave) {   // the big title when the team arrives on a map (and at the start of the match)
  const k = Math.floor((Math.max(1, wave) - 1) / 4), c = MAP_ORDER[k % MAP_ORDER.length]; if (k === mapCardKey) return; mapCardKey = k;
  txt("mapCardN", `MAP ${k % MAP_ORDER.length + 1} OF ${MAP_ORDER.length}` + (k >= MAP_ORDER.length ? " · ROUND " + (Math.floor(k / MAP_ORDER.length) + 1) : "")); txt("mapCardName", c.name); txt("mapCardSub", c.sub);
  txt("mapCardBoss", wave >= 49 ? "Wave 50: THE APOCALYPSE" : `Boss on wave ${(k + 1) * 4}: ${c.boss}`);
  const el = $("mapCard"); el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
}
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
// TRAIT: what a hero is always good at (always on, no key). Shown last on the hero card and on the SKILLS page.
const TRAIT_ICON = '<svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.2 6.6.8-4.9 4.6 1.3 6.6L12 17l-5.9 3.2 1.3-6.6L2.5 9l6.6-.8z"/></svg>';
const traitRow = (r, style = "") => `<div class="ls-ab trait"${style}>${r.trait.card ? `<div class="icon card-${r.trait.card}"></div>` : `<div class="icon">${TRAIT_ICON}</div>`}<div><div class="t"><span class="k">TRAIT</span><span class="n">${r.trait.n.toUpperCase()}</span><span class="cd">ALWAYS ON</span></div><p>${r.trait.t}</p></div></div>`;
function skillIcon(s, r) { return s.card ? `<div class="icon card-${s.card}"></div>` : `<div class="icon"><svg viewBox="0 0 24 24">${ROLE_ICON[r.cat]}</svg></div>`; }
function gearIcon(id) { return `<span class="gi">${icon(id === "katana" ? "katana" : id) || ""}</span>`; }
function renderSide() {
  const r = heroDef(); document.querySelectorAll(".ls-tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === ls.tab));
  const clock = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  if (ls.tab === "abilities") {
    const rows = r.skills.map(s => `<div class="ls-ab">${skillIcon(s, r)}<div><div class="t"><span class="k">${s.k}</span><span class="n">${s.n.toUpperCase()}</span>${s.cd ? `<span class="cd">${clock}${s.cd}s</span>` : ""}</div><p>${s.t}</p></div></div>`);
    if (!r.skills.some(s => s.k === "Q")) rows.push(`<div class="ls-ab" style="opacity:.55"><div class="icon"><svg viewBox="0 0 24 24"><path d="M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z"/></svg></div><div><div class="t"><span class="k">Q</span><span class="n">ULTIMATE</span></div><p>Coming soon.</p></div></div>`);
    if (r.trait) rows.push(traitRow(r));
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
  $("skillsPage").innerHTML = `<h2>SKILLS</h2><p>Every operator's skills. E = skill, Q = ultimate (unlocks after 100 kills), R = Astra's third skill. TRAIT = always on.</p><div class="ls-grid">${ROSTER.map(o => `<div class="ls-op"><div class="h"><i class="p-${o.id}"></i><div><b>${o.name}</b><small>${o.role}</small></div></div>${o.skills.map(s => `<div class="ls-ab" style="grid-template-columns:52px 1fr">${skillIcon(s, o).replace('class="icon"', 'class="icon" style="width:52px;height:52px"').replace('class="icon" style="background', 'class="icon" style="width:52px;height:52px;background')}<div><div class="t"><span class="k">${s.k}</span><span class="n" style="font-size:17px">${s.n.toUpperCase()}</span>${s.cd ? `<span class="cd">${s.cd}s</span>` : ""}</div><p>${s.t}</p></div></div>`).join("")}${o.trait ? traitRow(o, ' style="grid-template-columns:52px 1fr"') : ""}</div>`).join("")}</div>`;
  $("manualPage").innerHTML = `<h2>FIELD MANUAL</h2>
    <h4>OBJECTIVE</h4><p>Protect the radio tower in the middle of the map. If it falls, the team loses. Every 4th wave is a boss fight; the Hivemind mini boss shows up between them. Campaign mode ends with the final boss on wave 50; Ascension mode never ends.</p>
    <h4>CONTROLS</h4><div class="ls-keys">${[["W A S D", "Walk"], ["Mouse", "Aim · hold left click to shoot"], ["1 / 2 / 3", "Melee / primary / secondary"], ["4", "Medkit"], ["E", "Skill"], ["Q", "Ultimate (after 100 kills)"], ["R", "3rd skill (Astra: Safehouse)"], ["C", "Reload early (reloading is automatic when empty)"], ["Space", "Dash"], ["F", "Revive a downed teammate"], ["T", "Equipment"], ["Right click", "Build wheel (hold)"], ["U", "Level-up picker"], ["Tab", "Scoreboard"], ["Esc", "Menu"]].map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join("")}</div>
    <h4>TEAMWORK</h4><p>Stand next to a downed teammate and hold F for 5 seconds to revive them. If nobody gets there in time they sit out until the next wave. When you're down you can watch your teammates fight.</p>
    <h4>BUILD & REPAIR</h4><p>Hold right click for the build wheel: barricades, turrets, mines, electric fences and flame traps. Turrets, fences and traps need the generator: keep it fuelled and repaired. To repair the tower or repair / refuel the generator, stand next to it and press (or hold) F.</p>
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
  txt("lsHostNote", !inRoom ? "create a room" : host ? "host" : "host only");
  if (inRoom) {
    txt("codeDisplay", ls.hideCode ? "•".repeat(Math.min(9, room.roomId.length)) : room.roomId);
    txt("roomCount", `${players.length} / 8 PLAYERS`);
    const rows = players.map(p => `<div class="ls-pl"><span class="cr">${p.isHost ? "♛" : ""}</span><i class="av p-${p.characterClass || "assault"}"></i><span class="nm">${escapeHtml(p.name)}${p.isBot ? "<small>AI</small>" : p.sessionId === myId ? "<small>YOU</small>" : ""}</span><span class="st${p.ready ? " ok" : ""}">${p.ready ? "READY" : "NOT READY"}<i class="dot">${p.ready ? "✓" : ""}</i>${host && !p.isHost ? `<button class="x" data-kick="${p.sessionId}" data-bot="${p.isBot ? 1 : ""}" title="Remove">×</button>` : ""}</span></div>`);
    for (let i = players.length; i < 8; i++) rows.push(`<button class="ls-pl empty" data-invite="1" title="${host ? "Click to add an AI teammate (or use INVITE to bring friends)" : "Copy the invite link"}"><span class="plus">+</span><span>Invite player</span>${host ? "<small>+ AI</small>" : ""}</button>`);
    setHtml("lobbyPlayers", rows.join(""));
    setHtml("lsParty", players.map(p => { const o = rosterOf(p.characterClass); return `<div class="ls-pc${p.ready ? " ok" : ""}"><div class="top"><div class="av p-${o.id}"></div><div><b>${escapeHtml(p.name)}</b><small>${o.name}</small></div></div>${p.isHost ? '<span class="cr">♛</span>' : ""}${host && !p.isHost ? `<button class="x" data-kick="${p.sessionId}" data-bot="${p.isBot ? 1 : ""}" title="Remove">–</button>` : ""}<div class="rs">${p.ready ? "✓ READY" : "○ NOT READY"}</div></div>`; }).join(""));
    const humans = players.filter(p => !p.isBot), readyN = humans.filter(p => p.ready).length, all = readyN === humans.length;
    const btn = $("startGame"); btn.disabled = false; btn.classList.toggle("on", !host && !!me?.ready);
    if (host) { txt("readyLabel", all ? "START MISSION" : "START ANYWAY"); txt("readySub", `${readyN} / ${humans.length} READY`); }
    else { txt("readyLabel", me?.ready ? "READY!" : "READY UP"); txt("readySub", me?.ready ? "click to cancel · waiting for the host" : `${readyN} / ${humans.length} READY`); }
    // mission settings
    const site = state.mapSite || 0; txt("mapName", "MAP 1 · " + MAP_ORDER[0].name); txt("mapSub", "Fixed route: beat each map's boss to move on");
    setHtml("lsRoute", MAP_ORDER.map((c, i) => `<span class="${c.site === site ? "on" : ""}"><i>${i + 1}</i>${c.short}</span>`).join(""));
    txt("setDifficulty", (state.difficulty || "normal").toUpperCase());
    txt("setWaveMode", state.waveMode === "ascension" ? "ASCENSION (∞)" : "CAMPAIGN (50)");
    txt("setFriendlyFire", state.friendlyFire ? "ON" : "OFF"); txt("setExtraLoot", state.extraLoot ? "ON" : "OFF");
    $("setNoCd").checked = !!state.noCd;
    if (ls.mapSrc !== state.mapLayout) { ls.mapSrc = state.mapLayout; drawMapThumb(); }
  } else {
    setHtml("lsParty", ""); txt("readyLabel", "CREATE A ROOM"); txt("readySub", "or join a friend's room"); $("startGame").classList.remove("on");
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
  if (["dynasty", "whiteout", "refinery", "carnival", "mine"].includes(SITE_STYLE[state?.mapSite || 0]) && src) {   // Fallen Dynasty: the temple gate and the wall, drawn from the real pieces
    const rfT = SITE_STYLE[state?.mapSite || 0] === "refinery", mnT = SITE_STYLE[state?.mapSite || 0] === "mine", MW = state?.worldW || 4400, k = W / 1900, x0 = mnT ? MW - 1960 : MW / 2 - 950, y0 = mnT ? 2620 : rfT ? 330 : SITE_STYLE[state?.mapSite || 0] === "carnival" ? 240 : 20;   // the mine: its boss dungeon
    g.fillStyle = { whiteout: "#5d6a80", refinery: "#c99a55", carnival: "#3a4632", mine: "#2a2a38" }[SITE_STYLE[state?.mapSite || 0]] || "#231f29"; g.fillRect(0, 0, W, H); g.imageSmoothingEnabled = true;
    const items = src.split(";").map(r => { const [ki, x, y, f] = r.split(",").map(Number); return { kind: MAP_KINDS[ki], x, y, f }; })
      .filter(d => d.kind && d.y < y0 + H / k + 260 && d.x > x0 - 250 && d.x < x0 + 2150).sort((a, b) => (MAP_FLAT[a.kind] ? 0 : 1) - (MAP_FLAT[b.kind] ? 0 : 1) || a.y - b.y);
    let waiting = false;
    for (const d of items) { const im = mapImgs[d.kind]; if (!im?.naturalWidth) { if (im && !waiting) { waiting = true; im.addEventListener("load", drawMapThumb, { once: true }); } continue; }
      g.save(); g.translate((d.x - x0) * k, (d.y - y0) * k); if (d.f === 1) g.scale(-1, 1); const fw = DYN_ART[d.kind]?.frames ? DYN_ART[d.kind].w : im.width; g.drawImage(im, 0, 0, fw, im.height, -fw * k / 2, -im.height * k, fw * k, im.height * k); g.restore(); }
    const v = g.createLinearGradient(0, 0, 0, H); v.addColorStop(0, "rgba(10,12,30,.25)"); v.addColorStop(1, "rgba(10,12,30,.55)"); g.fillStyle = v; if (!rfT) g.fillRect(0, 0, W, H);
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
try { const pr = JSON.parse(localStorage.getItem("sa-prefs") || "{}"); if (pr.sfx === false) { sfxOn = false; $("setSfx").checked = false; $("sfxToggle").classList.add("off"); } if (pr.music === false) { musicOn = false; $("setAmbient").checked = false; $("musicToggle").classList.add("off"); } if (pr.motion === false) { lsAnimOn = false; $("setMotion").checked = false; $("ls").classList.add("still"); } } catch {}
{ const q = new URLSearchParams(location.search).get("room"); if (q) { $("roomCode").value = q; toast("Type your name and press JOIN to enter your friend's room."); } }   // invite links
setSelectedClass(selectedClass, false); renderLobbyRoom(); drawMapThumb();
rejoinAfterRefresh();
