import { Client } from "https://cdn.jsdelivr.net/npm/colyseus.js@0.16.19/+esm";
import { GAME_CONFIG } from "./configs.js";
import { GAME_SERVER } from "./config.js";

const $ = id => document.getElementById(id);
const serverInput = new URLSearchParams(location.search).get("server");
const defaultEndpoint = location.protocol === "https:" ? `wss://${location.host}` : `ws://${location.hostname || "localhost"}:${GAME_CONFIG.serverPort}`;
const endpoint = serverInput || GAME_SERVER || defaultEndpoint;
const client = new Client(endpoint);
let room = null, myId = "", state = null, keys = {}, lastInput = 0, lastShoot = 0, dashReady = true, paused = false, selectedClass = loadProfile().characterClass || "assault";
const canvas = $("arena"), ctx = canvas.getContext("2d"), W = canvas.width, H = canvas.height;
const COLORS = ["#68d5e8", "#e8bd68", "#c58be8", "#82d49a", "#e88787", "#8eabed", "#e5a36b", "#d2d879"];
function loadProfile(){try{return JSON.parse(localStorage.getItem(GAME_CONFIG.profileStorageKey)||"{}");}catch{return {};}}
let lastProfileSave=0;
function saveProfile(me){if(!me||Date.now()-lastProfileSave<3000)return;lastProfileSave=Date.now();try{localStorage.setItem(GAME_CONFIG.profileStorageKey,JSON.stringify({level:me.level,xp:me.xp,xpNext:me.xpNext,maxHp:me.maxHp,damage:me.damage,fireRate:me.fireRate,speed:me.speed,defence:me.defence,currency:me.currency,characterClass:me.characterClass,weapon:me.weapon,melee:me.melee,highestWave:Math.max(Number(loadProfile().highestWave)||1,state?.stage||1)}));}catch{}}
const upgrades = [ ["damage","Heavy weapon","+5 weapon damage"], ["fireRate","Rapid fire","+20% firing speed"], ["health","Vitality","+20 maximum HP and heal"], ["defence","Body armour","+2 defence"], ["speed","Adrenaline","+10% movement speed"] ];
function status(text, good=false){$("connection").textContent=text;$("connection").style.borderColor=good?"#4d9c68":"#8a6852";}
function message(text){$("lobbyMessage").textContent=text;$("gameMessage").textContent=text;}
function showOverlay(title,text){$("overlay").classList.remove("hidden");$("overlayTitle").textContent=title;$("overlayText").textContent=text;$("upgradeChoices").innerHTML="";$("nextStage").classList.add("hidden");}
function hideOverlay(){$("overlay").classList.add("hidden");}
function playerName(){return $("name").value.trim().slice(0,18)||"Survivor";}
async function createRoom(){try{status("Connecting…");room=await client.create(GAME_CONFIG.roomName,{name:playerName(),profile:{...loadProfile(),characterClass:selectedClass}});connected();}catch(e){status("Connection failed");message(e.message||"Could not create room. Check the server URL and try again.");}}
async function joinRoom(){const code=$("roomCode").value.trim();if(!code)return message("Enter the invitation code first.");try{status("Joining…");room=await client.joinById(code,{name:playerName(),profile:{...loadProfile(),characterClass:selectedClass}});connected();}catch(e){status("Join failed");message(e.message||"Could not join room. Check the code and server.");}}
function connected(){myId=room.sessionId;status("Connected · "+room.roomId,true);$("lobby").classList.remove("hidden");$("gameArea").classList.remove("hidden");$("invite").classList.remove("hidden");$("codeDisplay").textContent=room.roomId;$("roomCount").textContent="Room connected";message("Connected. Share the invitation code with your friends.");
 room.onStateChange(s=>{state=s;renderState();});
 room.onLeave(code=>{status("Disconnected");message("You left the room ("+code+").");room=null;$("gameArea").classList.add("hidden");$("lobby").classList.remove("hidden");});
 room.onError((code,msg)=>message("Room error: "+msg));
}
document.addEventListener("click",e=>{const b=e.target.closest?.("button");if(b)b.blur();});
$("create").onclick=createRoom;$("join").onclick=joinRoom;
$("copy").onclick=async()=>{try{await navigator.clipboard.writeText(room.roomId);$("copy").textContent="Copied!";}catch{$("copy").textContent="Code: "+room.roomId;}};
$("startGame").onclick=()=>room?.send("start");$("nextStage").onclick=()=>room?.send("nextStage");
function setSelectedClass(id,send=true){selectedClass=id;document.querySelectorAll(".character-card").forEach(card=>card.classList.toggle("selected",card.dataset.class===id));const card=document.querySelector(`.character-card[data-class="${id}"]`);$("classSelectionStatus").textContent=(card?.querySelector(".character-role")?.textContent||id).toUpperCase()+" SELECTED";if(send&&room)room.send("chooseClass",{id});}
document.querySelectorAll(".character-card").forEach(card=>card.addEventListener("click",()=>setSelectedClass(card.dataset.class,true)));
setSelectedClass(selectedClass,false);
$("equipWeapon").onclick=()=>room?.send("weapon",{id:$("weaponPick").value});$("equipMelee").onclick=()=>room?.send("meleeEquip",{id:$("meleePick").value});
$("useAbility").onclick=()=>room?.send("ability");
$("meleeAttack").onclick=()=>room?.send("melee");
$("leave").onclick=()=>room?.leave();
$("repairTower").onclick=()=>room?.send("repairTower",{amount:250});
$("repairGen").onclick=()=>room?.send("repairGenerator");
$("refuelGen").onclick=()=>room?.send("refuelGenerator");
document.querySelectorAll("[data-build]").forEach(b=>b.onclick=()=>{
 const me=state?.players.get(myId); if(me) room?.send("build",{kind:b.dataset.build,x:me.x+35,y:me.y+15});
});
function renderState(){if(!state||!room)return;
 const players=[...state.players.values()],me=state.players.get(myId),host=state.hostId===myId;saveProfile(me);if(me?.characterClass&&me.characterClass!==selectedClass)setSelectedClass(me.characterClass,false);
 $("lobbyPlayers").innerHTML=players.map(p=>`<span class="pill">${escapeHtml(p.name)} ${p.isHost?"★":""}</span>`).join("");
 $("team").innerHTML=players.map(p=>`<span class="pill" style="border-color:${p.color}">${escapeHtml(p.name)} · ${p.alive?Math.ceil(p.hp)+" HP":"DOWN"} · Lv.${p.level}</span>`).join("");
 $("roomCount").textContent=players.length+" / 8 survivors";
 $("startGame").classList.toggle("hidden",!host||state.phase!=="lobby");
 $("stage").textContent=state.stage;$("level").textContent=me?.level||1;$("hp").textContent=me?Math.ceil(me.hp)+" / "+me.maxHp:"—";$("loadoutText").textContent=me?`${me.characterClass.toUpperCase()} · ${me.weapon.toUpperCase()} · ${me.ammo} ammo · ${me.melee||"knife"} · Ability cooldown ${Math.ceil(me.abilityCooldown||0)}s · ${me.currency||0} credits`:"Choose a survivor class.";$("gold").textContent=me?me.kills*2:0;$("kills").textContent=me?.kills||0;
 $("xpText").textContent=me?me.xp+" / "+me.xpNext:"0 / 30";$("xpBar").style.width=me?Math.min(100,me.xp/me.xpNext*100)+"%":"0%";
 $("towerText").textContent=Math.ceil(state.towerHp||0)+" / "+(state.towerMaxHp||10000)+" HP";
 $("towerBar").style.width=Math.max(0,(state.towerHp||0)/(state.towerMaxHp||10000)*100)+"%";
 $("towerBar").style.background=(state.towerHp||0)<2500?"#e45b4d":"#58ce8b";
 $("generatorText").textContent=Math.ceil(state.generatorFuel||0)+"% fuel · "+Math.ceil(state.generatorHp||0)+" HP";
 $("generatorBar").style.width=Math.max(0,(state.generatorHp||0)/(state.generatorMaxHp||1200)*100)+"%";
 $("resources").textContent=`Scrap ${Math.floor(state.scrap||0)} · Electronics ${Math.floor(state.electronics||0)} · Explosives ${Math.floor(state.explosives||0)} · Fuel ${Math.floor(state.fuel||0)}`;
 $("clockLabel").textContent=state.isNight?"NIGHT":"DAY";

 const ranked=players.slice().sort((a,b)=>b.kills-a.kills || (a.killLeadSince||Number.MAX_SAFE_INTEGER)-(b.killLeadSince||Number.MAX_SAFE_INTEGER) || String(a.name).localeCompare(String(b.name)));
 const crownLeader=ranked.length?ranked[0]:null;
 const board=$("scoreboard");
 const rows=ranked.map((p,i)=>`<tr class="${i===0&&p.kills>0?"leader":""}"><td>${i===0&&p.kills>0?"👑 ":""}${i+1}. ${escapeHtml(p.name)}${p.sessionId===myId?" (YOU)":""}</td><td>${p.kills}</td><td>${Math.round(p.bossDamage||0)}</td><td>${p.revives||0}</td><td>${Math.round(p.towerRepairs||0)}</td><td>${p.structuresBuilt||0}</td><td>${Math.round(p.damageDealt||0)}</td><td>${Math.round(p.damageTaken||0)}</td></tr>`).join("");
 const finalAwards=["Zombie Slayer","Boss Hunter","Lifesaver","Guardian","Master Engineer","Sharpshooter"];
 const awardKeys=["kills","bossDamage","revives","towerRepairs","structuresBuilt","headshots"];
 const awards=finalAwards.map((label,i)=>{const winner=players.slice().sort((a,b)=>(Number(b[awardKeys[i]])||0)-(Number(a[awardKeys[i]])||0))[0];return winner&&Number(winner[awardKeys[i]])>0?`${label}: ${escapeHtml(winner.name)}`:"";}).filter(Boolean);
 board.innerHTML=`<h3>${["cleared","victory","defeat"].includes(state.phase)?"MATCH RESULTS":"LIVE KILL LEADERBOARD"}</h3><table><thead><tr><th>Survivor</th><th>Kills</th><th>Boss dmg</th><th>Revives</th><th>Tower repair</th><th>Builds</th><th>Damage dealt</th><th>Damage taken</th></tr></thead><tbody>${rows}</tbody></table>${["cleared","victory","defeat"].includes(state.phase)?`<div class="scorehint">${awards.join(" · ")}</div>`:""}<div class="scorehint">Team kills: ${state.totalKills||0} · Press TAB to toggle</div>`;
 board.classList.toggle("hidden",!scoreboardOpen && !["cleared","victory","defeat"].includes(state.phase));

 $("gameMessage").textContent=state.message;
 if(state.phase==="lobby"){showOverlay("Waiting for host","Share code "+state.roomCode+" with friends. The host can start when ready.");}
 else if(state.phase==="cleared"){showOverlay("WAVE "+state.stage+" CLEARED!","The team survived. The host can launch the next wave.");$("nextStage").textContent="START WAVE "+(state.stage+1);$("nextStage").classList.toggle("hidden",!host);}
 else if(state.phase==="victory"){showOverlay("CAMPAIGN COMPLETE!","You survived all 50 waves and defeated the final boss. Victory!");}
 else if(state.phase==="defeat"){showOverlay("TEAM DEFEATED","The radio tower was destroyed or the entire team was downed.");}
 else if(state.phase==="playing"){
  if(me&&!me.alive)showOverlay("YOU ARE DOWN",`Bleed-out in ${Math.ceil(me.bleedout||0)} seconds. A teammate can come close and press E to revive you.`);
  else if(me && me.xp >= me.xpNext) showUpgradeChoices(me);
  else hideOverlay();
 }
}

function showUpgradeChoices(me){
 if($("overlayTitle").textContent==="LEVEL UP!") return;
 showOverlay("LEVEL UP!", "Choose one upgrade. Your XP is spent when you select it.");
 const box=$("upgradeChoices");
 for(const [id,title,desc] of upgrades){
  const b=document.createElement("button");b.className="button upgrade";b.innerHTML=`<b>${title}</b><div class="muted" style="font-size:12px;margin-top:4px">${desc}</div>`;
  b.onclick=()=>{room?.send("upgrade",{id});$("upgradeChoices").innerHTML="<span class='muted'>Upgrade selected…</span>";};box.appendChild(b);
 }
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function aimAngle(me){return Math.atan2(mouse.y-me.y,mouse.x-me.x);}
let mouse={x:W/2,y:H/2};
let audioContext=null, ambientGain=null, ambientOn=false;
function toggleAmbient(){
 if(!audioContext){const AC=window.AudioContext||window.webkitAudioContext;if(!AC)return;audioContext=new AC();ambientGain=audioContext.createGain();ambientGain.gain.value=0;ambientGain.connect(audioContext.destination);
  [55,82.4,110].forEach((freq,i)=>{const o=audioContext.createOscillator(),g=audioContext.createGain();o.type=i===1?"triangle":"sine";o.frequency.value=freq;o.detune.value=(i-1)*7;g.gain.value=[.18,.07,.04][i];o.connect(g);g.connect(ambientGain);o.start();});
 }
 ambientOn=!ambientOn;ambientGain.gain.setTargetAtTime(ambientOn?.16:0,audioContext.currentTime,.8);$("musicToggle").textContent="Ambient music: "+(ambientOn?"ON":"OFF");
}
$("musicToggle").onclick=toggleAmbient;
let scoreboardOpen=false;
canvas.addEventListener("mousemove",e=>{const r=canvas.getBoundingClientRect();mouse.x=(e.clientX-r.left)*W/r.width;mouse.y=(e.clientY-r.top)*H/r.height;});
window.addEventListener("keydown",e=>{if(e.target.closest?.("input,select,textarea"))return;const k=e.key.toLowerCase();if(k==="tab"){e.preventDefault();scoreboardOpen=!scoreboardOpen;if(state?.phase!=="cleared")$("scoreboard").classList.toggle("hidden",!scoreboardOpen);}if([" ","arrowup","arrowdown","arrowleft","arrowright"].includes(k))e.preventDefault();keys[k===" "?"space":k]=true;if(k==="p")paused=!paused;if(k==="e")tryRevive();if(k==="q")room?.send("ability");if(k==="f")room?.send("melee");});
window.addEventListener("keyup",e=>{const k=e.key.toLowerCase();keys[k===" "?"space":k]=false;});
function tryRevive(){if(!state||!room)return;const me=state.players.get(myId);if(!me?.alive)return;const target=[...state.players.values()].find(p=>!p.alive&&Math.hypot(p.x-me.x,p.y-me.y)<85);if(target)room.send("revive",{targetId:target.sessionId});}
function sendControls(t){if(!room||!state||state.phase!=="playing"||paused)return;const me=state.players.get(myId);if(!me?.alive)return;const dt=Math.min(.1,(t-lastInput)/1000||.05);if(t-lastInput>45){const dx=(keys.d||keys.arrowright?1:0)-(keys.a||keys.arrowleft?1:0),dy=(keys.s||keys.arrowdown?1:0)-(keys.w||keys.arrowup?1:0);room.send("input",{dx,dy,dt});lastInput=t;}if(t-lastShoot>170){room.send("shoot",{});lastShoot=t;}if(keys.space&&dashReady){dashReady=false;setTimeout(()=>dashReady=true,850);const dx=(keys.d||keys.arrowright?1:0)-(keys.a||keys.arrowleft?1:0),dy=(keys.s||keys.arrowdown?1:0)-(keys.w||keys.arrowup?1:0);room.send("input",{dx:dx*2,dy:dy*2,dt:.12});keys.space=false;}}
// --- Pixel-art world renderer: hand-drawn Canvas sprites, buildings and props ---
function px(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(Math.round(x),Math.round(y),Math.max(1,Math.round(w)),Math.max(1,Math.round(h)));}
function block(x,y,w,h,base,shade,light){px(x,y,w,h,base);px(x,y,w,3,light);px(x,y+h-3,w,3,shade);px(x,y,3,h,light);px(x+w-3,y,3,h,shade);}
function drawBuilding(x,y,w,h,seed=0){
  block(x,y,w,h,'#343b3c','#171d1e','#66706a');
  px(x+7,y+8,w-14,5,'#242b2b');
  const cols=Math.max(2,Math.floor((w-20)/22));
  for(let i=0;i<cols;i++) for(let j=0;j<Math.max(1,Math.floor((h-24)/25));j++){
    const wx=x+12+i*22, wy=y+20+j*25;
    px(wx,wy,12,10,((i*7+j*3+seed)%4===0)?'#d18a43':'#151e20');
    px(wx+2,wy+2,8,2,'#e8b56b');
  }
  px(x+8,y+h-13,w-16,6,'#111718');
  // rooftop rubble / vents
  px(x+w*.62,y-6,14,7,'#202829');px(x+w*.66,y-10,5,4,'#7a8178');
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
function drawSurvivor(p){
  ctx.save();ctx.translate(Math.round(p.x),Math.round(p.y));
  const c=p.alive?(p.color||'#69c9d1'):'#555b59';
  // feet, legs, tactical trousers
  px(-10,8,8,10,'#161d20');px(3,8,8,10,'#161d20');px(-9,3,7,9,'#394342');px(3,3,7,9,'#394342');
  // backpack and armored torso
  px(-13,-10,6,16,'#263b3b');block(-9,-12,18,23,'#344d48','#172522','#80968a');
  px(-7,-8,14,4,c);px(-5,0,10,4,'#202b2b');px(-15,-8,5,12,'#59645e');px(10,-8,5,12,'#59645e');
  // head, helmet, visor and face pixels
  px(-7,-23,14,12,'#b68a68');px(-9,-25,18,6,'#202a2b');px(-5,-18,10,3,'#263b3b');px(-5,-16,3,2,'#e4d6b9');px(3,-16,3,2,'#e4d6b9');
  // shoulder insignia and weapon
  px(-12,-9,4,4,'#e5a14e');px(8,-9,4,4,'#e5a14e');px(12,-5,13,3,'#252b2b');px(23,-6,5,5,'#aeb7ad');
  if(!p.alive){px(-15,-29,30,3,'#e34b43');}
  ctx.restore();
  ctx.fillStyle='#f2ead9';ctx.font='11px monospace';ctx.textAlign='center';ctx.fillText(p.name+(p.sessionId===myId?' (YOU)':''),p.x,p.y-32);
  if(!p.alive){ctx.fillStyle='#ff7568';ctx.fillText('DOWN · E TO REVIVE',p.x,p.y+28);}
}
function draw(){
  ctx.clearRect(0,0,W,H);px(0,0,W,H,'#111719');
  // asphalt tiles and cracks
  for(let y=0;y<H;y+=32)for(let x=0;x<W;x+=32){px(x,y,31,31,((x/32+y/32)%3===0)?'#202729':'#1b2224');px(x+2,y+2,27,1,'#293234');}
  for(let i=0;i<22;i++){const x=(i*137+29)%W,y=(i*83+17)%H;px(x,y,8,2,'#343b38');px(x+3,y+2,2,5,'#101617');}
  if(state){
    // perimeter blocks and recognizable ruined city buildings
    drawBuilding(18,52,145,105,1);drawBuilding(W-174,42,154,112,3);drawBuilding(22,H-170,150,140,2);drawBuilding(W-190,H-170,170,140,4);
    // crossroad, painted lane markings and drainage
    px(0,H/2-73,W,146,'#343a39');px(0,H/2-69,W,138,'#282f30');px(W/2-82,0,164,H,'#343a39');px(W/2-77,0,154,H,'#282f30');
    for(let x=12;x<W;x+=54){px(x,H/2-2,24,4,'#a78d5e');}for(let y=10;y<H;y+=54){px(W/2-2,y,4,24,'#a78d5e');}
    // sandbags, crates and debris around the central radio tower
    for(let i=0;i<7;i++){block(W/2-91+i*25,H/2+44,22,13,'#756044','#40372c','#b18d59');block(W/2-91+i*25,H/2-58,22,13,'#756044','#40372c','#b18d59');}
    for(const [x,y] of [[W/2-155,H/2-100],[W/2+118,H/2+92],[W/2+145,H/2-116],[W/2-160,H/2+102]]){block(x,y,25,24,'#5c625c','#292f2d','#a5a08a');px(x+5,y+6,15,3,'#c08a48');}
    // radio mast with beacon and antenna arrays
    ctx.save();ctx.translate(W/2,H/2);px(-27,-32,54,64,'#414d4a');px(-22,-27,44,54,'#283533');px(-5,-91,10,60,'#8b9690');px(-3,-115,6,25,'#c0c7b6');px(-35,-65,70,5,'#7e8a7d');px(-29,-50,58,4,'#68766d');px(-3,-120,6,6,'#ff4b3f');px(-2,-128,4,5,'#ffbd63');px(-45,-38,90,5,'#9a8054');ctx.restore();
    // loot crates and dropped supplies
    for(const item of state.loot.values()){const col=item.kind==='medkit'?'#c94c48':item.kind==='ammo'?'#c8a94d':item.kind==='gold'?'#e5c66a':item.kind==='weapon'?'#a88ad0':'#70a98a';block(item.x-7,item.y-7,14,14,col,'#272d2a','#e0c58a');}
    // defensive structures are bespoke silhouettes
    for(const st of state.structures.values()){ctx.save();ctx.translate(Math.round(st.x),Math.round(st.y));if(st.kind==='turret'){block(-13,-11,26,22,'#46575b','#1b2528','#91a19a');px(-4,-4,25,5,'#a5afa8');px(13,-6,12,8,'#6f7972');}else if(st.kind==='fence'){px(-15,-2,30,4,'#64c9c3');for(let x=-12;x<=12;x+=12)px(x,-13,3,26,'#8d9b90');}else if(st.kind==='mine'){block(-9,-7,18,14,'#8b4439','#3b2422','#e18b55');px(-3,-3,6,4,'#f4bd66');}else if(st.kind==='flameTrap'){block(-12,-9,24,18,'#87502d','#3c2921','#e6a14c');px(-3,-17,6,8,'#ff6a32');}else{block(-13,-13,26,26,'#755b3e','#312a22','#b79562');}ctx.restore();}
    // Draw infected first, then players so survivors remain readable
    for(const z of state.zombies.values())drawZombie(z);
    for(const p of state.players.values())drawSurvivor(p);
    const leader=[...state.players.values()].sort((a,b)=>b.kills-a.kills||(a.killLeadSince||Number.MAX_SAFE_INTEGER)-(b.killLeadSince||Number.MAX_SAFE_INTEGER)||String(a.name).localeCompare(String(b.name)))[0];
    if(leader&&leader.kills>0){ctx.save();ctx.font='bold 22px serif';ctx.textAlign='center';ctx.shadowColor='#ffd84d';ctx.shadowBlur=12;ctx.fillStyle='#ffd84d';ctx.fillText('♛',leader.x,leader.y-44);ctx.restore();}
    ctx.fillStyle='#f3e8cf';ctx.font='bold 13px monospace';ctx.textAlign='left';ctx.fillText('ABANDONED CITY  /  WAVE '+state.stage+'/50',16,23);ctx.fillStyle='#d2a45e';ctx.fillText('INFECTED: '+state.zombies.size+'  ·  '+(state.isNight?'NIGHT':'DAY'),16,43);
    if(state.isNight){ctx.fillStyle='rgba(4,8,15,.32)';ctx.fillRect(0,0,W,H);}
    ctx.fillStyle='#e9d7b2';ctx.font='bold 12px monospace';ctx.textAlign='center';ctx.fillText('RADIO TOWER',W/2,H/2+82);
    // minimap rendered in tactical pixel style
    const mini=$('minimap'),m=mini.getContext('2d');m.imageSmoothingEnabled=false;m.clearRect(0,0,360,228);m.fillStyle='#11191a';m.fillRect(0,0,360,228);m.fillStyle='#353e3d';m.fillRect(0,99,360,30);m.fillRect(165,0,30,228);m.fillStyle='#d58b45';m.fillRect(172,105,16,16);
    for(const st of state.structures.values()){m.fillStyle='#c19a5c';m.fillRect(st.x/W*360-3,st.y/H*228-3,6,6);}
    for(const z of state.zombies.values()){m.fillStyle=z.boss?'#ff3737':'#a9bd78';m.fillRect(z.x/W*360-2,z.y/H*228-2,4,4);}
    for(const pl of state.players.values()){m.fillStyle=pl.color;m.fillRect(pl.x/W*360-3,pl.y/H*228-3,6,6);}
  }
}

function frame(t){sendControls(t);draw();requestAnimationFrame(frame);}requestAnimationFrame(frame);
