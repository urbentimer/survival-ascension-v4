import { Room } from "@colyseus/core";
import { MapSchema } from "@colyseus/schema";
import { GameState, PlayerState, ZombieState, StructureState, LootState } from "./schema.js";

const ARENA = { width: 1200, height: 760 };
const COLORS = ["#68d5e8", "#e8bd68", "#c58be8", "#82d49a", "#e88787", "#8eabed", "#e5a36b", "#d2d879"];
const UPGRADES = {
  damage: p => { p.damage += 5; },
  fireRate: p => { p.fireRate = Math.min(5, p.fireRate * 1.2); },
  health: p => { p.maxHp += 20; p.hp = Math.min(p.maxHp, p.hp + 35); },
  defence: p => { p.defence += 2; },
  speed: p => { p.speed = Math.min(300, p.speed * 1.1); }
};
const rand = (a, b) => a + Math.random() * (b - a);
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export class SurvivalRoom extends Room {
  maxClients = 8;
  patchRate = 50;

  onCreate() {
    this.autoDispose = true;
    this.setState(new GameState());
    this.state.players = new MapSchema();
    this.state.zombies = new MapSchema();
    this.state.structures = new MapSchema();
    this.state.loot = new MapSchema();
    this.state.stage = 1;
    this.state.elapsed = 0;
    this.state.stageDuration = 90;
    this.state.bossSpawned = false;
    this.state.bossDead = false;
    this.state.phase = "lobby";
    this.state.roomCode = this.roomId;
    this.state.hostId = "";
    this.state.message = "Waiting for survivors. Host can start when ready.";
    this.state.totalKills = 0;
    this.state.towerMaxHp = 10000; this.state.towerHp = 10000;
    this.state.scrap = 100; this.state.electronics = 20; this.state.explosives = 10; this.state.fuel = 100;
    this.state.dayTime = 0; this.state.isNight = false;
    this.state.generatorMaxHp = 1200; this.state.generatorHp = 1200; this.state.generatorFuel = 100;
    this.state.waveType = "normal"; this.state.remaining = 0; this.state.matchTime = 0;
    this.spawnClock = 0;
    this.structureSequence = 0;
    this.lootSequence = 0;
    this.zombieSequence = 0;
    this.lastInputs = new Map();
    this.enraged = new Set();
    this.lastTick = Date.now();
    this.setSimulationInterval(() => this.tick(), 50);

    this.onMessage("start", (client) => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== "lobby") return;
      if (this.state.players.size < 1) return;
      this.state.phase = "playing";
      this.state.elapsed = 0;
      this.state.message = "Wave 1/50: protect the radio tower!";
      this.beginWave();
    });

    this.onMessage("input", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || this.state.phase !== "playing") return;
      const dx = Math.max(-1, Math.min(1, Number(data?.dx) || 0));
      const dy = Math.max(-1, Math.min(1, Number(data?.dy) || 0));
      const mag = Math.hypot(dx, dy) || 1;
      const now = Date.now();
      const previous = this.lastInputs.get(client.sessionId) || (now - 50);
      const dt = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      this.lastInputs.set(client.sessionId, now);
      p.x = clamp(p.x + dx / mag * p.speed * dt, 18, ARENA.width - 18);
      p.y = clamp(p.y + dy / mag * p.speed * dt, 18, ARENA.height - 18);
    });

    this.onMessage("shoot", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || this.state.phase !== "playing") return;
      const now = Date.now();
      if (now - p.lastShot < 1000 / p.fireRate) return;
      p.lastShot = now;
      if(p.ammo<=0){p.ammo=30;this.state.message=`${p.name} reloaded.`;return;}
      p.ammo--;
      const target = [...this.state.zombies.values()].filter(z => distance(p, z) < 520)
        .sort((a, b) => distance(p, a) - distance(p, b))[0];
      if (!target) return;
      target.hp -= p.damage;
      p.damageDealt += p.damage;
      if (target.boss) p.bossDamage += p.damage;
      if (target.hp <= 0) this.killZombie(target, p);
    });

    this.onMessage("chooseClass", (client,data) => {
      const p=this.state.players.get(client.sessionId); const id=String(data?.id||"");
      const classes=["assault","juggernaut","medic","engineer","scout","demolitionist","sniper","commander"];
      if(!p || this.state.phase!=="lobby" || !classes.includes(id)) return;
      p.characterClass=id;
      const base={assault:[110,18,1.1,190,0],juggernaut:[160,13,.85,150,5],medic:[105,14,1,185,1],engineer:[110,14,1,175,1],scout:[90,16,1.2,225,0],demolitionist:[105,20,.85,175,0],sniper:[95,28,.65,165,0],commander:[115,15,1,180,1]}[id];
      p.maxHp=base[0];p.hp=base[0];p.damage=base[1];p.fireRate=base[2];p.speed=base[3];p.defence=base[4];
      this.state.message=`${p.name} selected ${id.toUpperCase()}.`;
    });
    this.onMessage("ability", client => {
      const p=this.state.players.get(client.sessionId); if(!p?.alive||this.state.phase!=="playing"||p.abilityCooldown>0)return;
      const cls=p.characterClass; const cooldown=cls==="medic"?35:cls==="engineer"?40:cls==="scout"?18:cls==="demolitionist"?32:cls==="sniper"?24:cls==="commander"?40:cls==="juggernaut"?28:25;
      p.abilityCooldown=cooldown;
      if(cls==="medic"){for(const a of this.state.players.values())if(a.alive&&distance(p,a)<190)a.hp=Math.min(a.maxHp,a.hp+45);}
      else if(cls==="engineer"){const st=new StructureState();st.id=`s${++this.structureSequence}`;st.kind="turret";st.x=p.x;st.y=p.y;st.hp=420;st.maxHp=420;st.ownerId=p.sessionId;this.state.structures.set(st.id,st);}
      else if(cls==="scout"){p.speed+=75;setTimeout(()=>{if(this.state.players.has(p.sessionId))p.speed=Math.max(150,p.speed-75);},3500);}
      else if(cls==="demolitionist"){for(const z of [...this.state.zombies.values()])if(distance(p,z)<175){z.hp-=260;if(z.hp<=0)this.killZombie(z,p);}}
      else if(cls==="sniper"){const z=[...this.state.zombies.values()].filter(z=>distance(p,z)<650).sort((a,b)=>distance(p,a)-distance(p,b))[0];if(z){const hit=Math.min(z.hp,p.damage*12);z.hp-=hit;p.damageDealt+=hit;if(z.boss)p.bossDamage+=hit;if(z.hp<=0)this.killZombie(z,p);}}
      else if(cls==="juggernaut"){p.defence+=8;setTimeout(()=>{if(this.state.players.has(p.sessionId))p.defence=Math.max(0,p.defence-8);},5000);}
      else if(cls==="commander"){for(const a of this.state.players.values())if(a.alive&&distance(p,a)<220){a.defence+=4;setTimeout(()=>{if(this.state.players.has(a.sessionId))a.defence=Math.max(0,a.defence-4);},8000);}}
      else {p.damage+=12;setTimeout(()=>{if(this.state.players.has(p.sessionId))p.damage=Math.max(8,p.damage-12);},6000);}
      this.state.message=`${p.name} used ${cls.toUpperCase()} ability!`;
    });
    this.onMessage("weapon", (client,data) => {
      const p=this.state.players.get(client.sessionId);const w=String(data?.id||"");
      const weapons={pistol:[10,2.2],shotgun:[9,1.0],rifle:[15,1.3],smg:[8,2.8],sniper:[42,.55],launcher:[85,.35]};
      if(!p?.alive||!weapons[w])return;p.weapon=w;p.damage=weapons[w][0];p.fireRate=weapons[w][1];
    });
    this.onMessage("meleeEquip",(client,data)=>{
      const p=this.state.players.get(client.sessionId),id=String(data?.id||"");
      if(p&&["knife","bat","axe","katana"].includes(id))p.melee=id;
    });
    this.onMessage("melee", client => {
      const p=this.state.players.get(client.sessionId);if(!p?.alive||this.state.phase!=="playing")return;
      const z=[...this.state.zombies.values()].filter(z=>distance(p,z)<65).sort((a,b)=>distance(p,a)-distance(p,b))[0];
      if(!z)return;const hit=p.melee==="axe"?85:p.melee==="bat"?45:p.melee==="katana"?65:30;z.hp-=hit;p.damageDealt+=hit;if(z.boss)p.bossDamage+=hit;if(z.hp<=0)this.killZombie(z,p);
    });
    this.onMessage("upgrade", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      if (!p || !p.alive || !UPGRADES[data?.id] || p.xp < p.xpNext) return;
      p.xp -= p.xpNext;
      p.level++;
      p.xpNext = Math.floor(p.xpNext * 1.35 + 8);
      UPGRADES[data.id](p);
      this.state.message = `${p.name} upgraded: ${String(data.id)}.`;
    });

    this.onMessage("revive", (client, data) => {
      const rescuer=this.state.players.get(client.sessionId);
      const target=this.state.players.get(String(data?.targetId||""));
      if(!rescuer?.alive||!target||target.alive||distance(rescuer,target)>85)return;
      rescuer.reviveTargetId=target.sessionId;rescuer.reviveProgress=0;
      this.state.message=`${rescuer.name} is reviving ${target.name}...`;
    });
    this.onMessage("repairTower", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      const amount = Math.max(0, Math.min(2000, Number(data?.amount) || 0));
      if (!p?.alive || amount <= 0) return;
      const cost = Math.ceil(amount / 25);
      if (this.state.scrap < cost || this.state.towerHp >= this.state.towerMaxHp) return;
      this.state.scrap -= cost;
      this.state.towerHp = Math.min(this.state.towerMaxHp, this.state.towerHp + amount);
      p.towerRepairs += amount;
      this.state.message = `${p.name} repaired the radio tower (+${amount} HP).`;
    });
    this.onMessage("refuelGenerator", (client) => {
      const p = this.state.players.get(client.sessionId);
      if (!p?.alive || this.state.fuel < 10 || this.state.generatorFuel >= 100) return;
      this.state.fuel -= 10; this.state.generatorFuel = Math.min(100, this.state.generatorFuel + 25);
      this.state.message = `${p.name} refuelled the generator.`;
    });
    this.onMessage("repairGenerator", (client) => {
      const p = this.state.players.get(client.sessionId);
      if (!p?.alive || this.state.scrap < 15 || this.state.generatorHp >= this.state.generatorMaxHp) return;
      this.state.scrap -= 15; this.state.generatorHp = Math.min(this.state.generatorMaxHp, this.state.generatorHp + 300);
      this.state.message = `${p.name} repaired the generator.`;
    });
    this.onMessage("build", (client, data) => {
      const p = this.state.players.get(client.sessionId);
      const kind = String(data?.kind || "");
      const costs = { barricade:{scrap:15,hp:450}, turret:{scrap:35,electronics:8,hp:300}, mine:{scrap:8,explosives:3,hp:1}, fence:{scrap:25,electronics:5,hp:250}, flameTrap:{scrap:20,fuel:8,hp:180} };
      const cfg = costs[kind];
      if (!p?.alive || !cfg || this.state.structures.size >= 20) return;
      if (this.state.scrap < (cfg.scrap||0) || this.state.electronics < (cfg.electronics||0) || this.state.explosives < (cfg.explosives||0) || this.state.fuel < (cfg.fuel||0)) return;
      this.state.scrap -= cfg.scrap||0; this.state.electronics -= cfg.electronics||0; this.state.explosives -= cfg.explosives||0; this.state.fuel -= cfg.fuel||0;
      const st = new StructureState(); st.id = `s${++this.structureSequence}`; st.kind = kind;
      st.x = clamp(Number(data?.x)||p.x, 30, ARENA.width-30); st.y = clamp(Number(data?.y)||p.y, 30, ARENA.height-30);
      st.hp = cfg.hp; st.maxHp = cfg.hp; st.ownerId = p.sessionId;
      this.state.structures.set(st.id, st); p.structuresBuilt++;
      this.state.message = `${p.name} built a ${kind}.`;
    });
    this.onMessage("nextStage", client => {
      if (client.sessionId !== this.state.hostId || this.state.phase !== "cleared") return;
      this.state.stage++;
      this.state.elapsed = 0;
      this.state.bossSpawned = false;
      this.state.bossDead = false;
      this.state.zombies.clear();
      this.state.phase = "playing";
      for (const p of this.state.players.values()) { p.hp = p.maxHp; p.alive = true; }
      this.state.message = `Wave ${this.state.stage}/50: the infected are getting stronger!`; this.beginWave();
    });
  }

  beginWave() {
    this.state.elapsed = 0; this.spawnClock = 0.2; this.state.bossSpawned = false; this.state.bossDead = false;
    this.state.waveType = this.state.stage % 4 === 0 || this.state.stage === 50 ? "boss" : "normal";
    if (this.state.waveType === "boss") { this.state.bossSpawned = true; this.spawnZombie(true); this.state.message = `BOSS WAVE ${this.state.stage}!`; }
    else this.state.message = `Wave ${this.state.stage}/50 — survive for 90 seconds.`;
  }

  onJoin(client, options = {}) {
    if (this.state.players.size >= 8) throw new Error("This room is full (8/8).");
    const p = new PlayerState();
    p.sessionId = client.sessionId;
    p.name = cleanName(options.name) || `Survivor ${this.state.players.size + 1}`;
    p.x = rand(430, 770); p.y = rand(280, 480);
    p.hp = 100; p.maxHp = 100; p.level = 1; p.xp = 0; p.xpNext = 30;
    p.characterClass = "assault"; p.abilityCooldown = 0; p.bleedout = 0; p.weapon = "rifle"; p.melee = "knife"; p.ammo = 120; p.currency = 0;
    p.kills = 0; p.killLeadSince = 0; p.bossDamage = 0; p.revives = 0; p.damageDealt = 0; p.damageTaken = 0; p.towerRepairs = 0; p.structuresBuilt = 0; p.headshots = 0; p.damage = 15; p.fireRate = 1; p.speed = 190; p.defence = 0;
    const profile=options.profile&&typeof options.profile==="object"?options.profile:{};
    p.level=Math.max(1,Math.min(100,Number(profile.level)||1));p.xp=Math.max(0,Math.min(100000,Number(profile.xp)||0));
    p.xpNext=Math.max(30,Math.min(100000,Number(profile.xpNext)||30));p.currency=Math.max(0,Math.min(1000000,Number(profile.currency)||0));
    const classIds=["assault","juggernaut","medic","engineer","scout","demolitionist","sniper","commander"];
    if(classIds.includes(profile.characterClass)){
      p.characterClass=profile.characterClass;
      const savedClass={assault:[110,18,1.1,190,0],juggernaut:[160,13,.85,150,5],medic:[105,14,1,185,1],engineer:[110,14,1,175,1],scout:[90,16,1.2,225,0],demolitionist:[105,20,.85,175,0],sniper:[95,28,.65,165,0],commander:[115,15,1,180,1]}[p.characterClass];
      p.maxHp=savedClass[0];p.hp=savedClass[0];p.damage=savedClass[1];p.fireRate=savedClass[2];p.speed=savedClass[3];p.defence=savedClass[4];
    }
    const weaponIds=["pistol","shotgun","rifle","smg","sniper","launcher"];if(weaponIds.includes(profile.weapon))p.weapon=profile.weapon;
    p.alive = true; p.ready = true; p.isHost = this.state.players.size === 0;
    p.color = COLORS[this.state.players.size % COLORS.length]; p.lastShot = 0; p.reviveProgress = 0; p.reviveTargetId = "";
    this.state.players.set(client.sessionId, p);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    this.state.message = `${p.name} joined (${this.state.players.size}/8).`;
  }

  onLeave(client) {
    const p = this.state.players.get(client.sessionId);
    if (p) this.state.message = `${p.name} left the room.`;
    this.state.players.delete(client.sessionId);
    this.lastInputs.delete(client.sessionId);
    if (this.state.hostId === client.sessionId) {
      const next = this.state.players.values().next();
      this.state.hostId = next.done ? "" : next.value.sessionId;
      if (next.value) next.value.isHost = true;
    }
    if (this.state.players.size === 0) this.state.phase = "lobby";
  }

  spawnZombie(boss = false) {
    const edge = Math.floor(Math.random() * 4);
    const x = edge === 0 ? 8 : edge === 1 ? ARENA.width - 8 : rand(20, ARENA.width - 20);
    const y = edge === 2 ? 8 : edge === 3 ? ARENA.height - 8 : rand(20, ARENA.height - 20);
    const roll = Math.random();
    const normalKinds = ["walker","runner","brute","spitter","mutant"];
    const kind = boss ? (this.state.stage === 50 ? "apocalypse" : ["butcher","plagueBrute","screamer","abomination","devourer","stalker","boneCrusher","hiveMother","executioner","colossus","reaper","undeadKing"][(this.state.stage/4-1)%12]) : (this.state.stage < 5 ? "walker" : this.state.stage < 9 ? (roll<0.25?"runner":"walker") : this.state.stage < 13 ? (roll<0.2?"brute":roll<0.5?"runner":"walker") : this.state.stage < 17 ? (roll<0.25?"spitter":roll<0.5?"brute":"runner") : (normalKinds[Math.floor(Math.random()*normalKinds.length)]));
    const scale = 1 + (this.state.stage - 1) * 0.08;
    const base = { walker:38, runner:25, brute:105, spitter:42, mutant:75, butcher:1200, plagueBrute:1500, screamer:1100, abomination:1700, devourer:1500, stalker:1000, boneCrusher:1800, hiveMother:1900, executioner:1600, colossus:2500, reaper:1800, undeadKing:2400, apocalypse:6500 }[kind] || 900;
    const z = new ZombieState();
    z.id = `z${++this.zombieSequence}`; z.kind = kind; z.x = x; z.y = y;
    z.maxHp = base * scale * (boss ? Math.max(1, this.state.players.size * 0.25) : 1);
    z.hp = z.maxHp; z.speed = ({walker:57,runner:125,brute:34,spitter:28,mutant:90}[kind] || (boss?42:55)) * (this.state.isNight?1.2:1);
    z.damage = ({walker:8,runner:7,brute:18,spitter:6,mutant:13}[kind] || (boss?28:10)) * scale * (this.state.isNight?1.3:1);
    z.radius = boss ? 42 : kind === "brute" ? 22 : kind === "mutant" ? 18 : 14; z.attackCooldown = 0;
    z.targetId = ""; z.boss = boss;
    this.state.zombies.set(z.id, z);
  }

  killZombie(z, killer) {
    this.state.zombies.delete(z.id);
    if (killer) {
      killer.kills++;
      killer.killLeadSince = Date.now();
      killer.xp += z.boss ? 35 : z.kind === "brute" ? 9 : 5;
      killer.hp = Math.min(killer.maxHp, killer.hp + (z.boss ? 25 : 1));
    }
    this.state.totalKills++;
    if(Math.random()<(z.boss?.95:.28)){const item=new LootState();item.id=`l${++this.lootSequence}`;const roll=Math.random();item.kind=z.boss||roll>.92?"weapon":roll<.25?"ammo":roll<.48?"medkit":roll<.72?"scrap":"gold";item.x=z.x;item.y=z.y;item.amount=item.kind==="medkit"?35:item.kind==="ammo"?45:item.kind==="gold"?15:item.kind==="scrap"?8:0;item.rarity=z.boss?"Legendary":roll>.97?"Epic":roll>.9?"Rare":"Common";this.state.loot.set(item.id,item);}
    this.state.scrap += z.boss ? 35 : 2; if (Math.random()<0.12) this.state.electronics += 1; if (Math.random()<0.08) this.state.fuel += 1;
    if (z.boss) {
      this.state.bossDead = true;
      this.state.phase = this.state.stage === 50 ? "victory" : "cleared";
      this.state.message = this.state.stage === 50 ? "THE APOCALYPSE HAS FALLEN — CAMPAIGN VICTORY!" : `Boss defeated! Wave ${this.state.stage} cleared.`;
    }
  }

  tick() {
    if (this.state.phase !== "playing") return;
    const now = Date.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.state.elapsed += dt; this.state.matchTime += dt;
    for(const p of this.state.players.values()) if(p.abilityCooldown>0)p.abilityCooldown=Math.max(0,p.abilityCooldown-dt);
    for(const rescuer of this.state.players.values()) if(rescuer.reviveTargetId){
      const target=this.state.players.get(rescuer.reviveTargetId);
      if(!rescuer.alive||!target||target.alive||distance(rescuer,target)>85){rescuer.reviveTargetId="";rescuer.reviveProgress=0;}
      else {rescuer.reviveProgress+=dt;if(rescuer.reviveProgress>=5){target.alive=true;target.bleedout=0;target.hp=Math.max(30,Math.round(target.maxHp*.35));rescuer.revives++;rescuer.reviveTargetId="";rescuer.reviveProgress=0;this.state.message=`${rescuer.name} revived ${target.name}!`;}}
    }
    for(const p of this.state.players.values()) if(!p.alive&&p.bleedout>0){p.bleedout=Math.max(0,p.bleedout-dt);if(p.bleedout===0)this.state.message=`${p.name} has bled out.`;}
    for(const p of this.state.players.values()) if(p.alive) for(const item of [...this.state.loot.values()]) if(distance(p,item)<30){
      if(item.kind==="ammo")p.ammo+=item.amount;else if(item.kind==="medkit")p.hp=Math.min(p.maxHp,p.hp+item.amount);else if(item.kind==="scrap")this.state.scrap+=item.amount;else if(item.kind==="gold")p.currency+=item.amount;else if(item.kind==="weapon"){p.weapon=item.rarity==="Legendary"?"launcher":item.rarity==="Epic"?"sniper":"shotgun";p.damage=item.rarity==="Legendary"?85:item.rarity==="Epic"?42:24;}
      this.state.loot.delete(item.id);
    }
    this.state.dayTime = (this.state.dayTime + dt) % 240;
    this.state.isNight = this.state.dayTime >= 120;
    this.spawnClock -= dt;
    if (this.spawnClock <= 0 && this.state.elapsed < 90) {
      this.spawnZombie();
      if (this.state.stage > 1 && Math.random() < Math.min(.65,.15 + this.state.stage*.01)) this.spawnZombie();
      this.spawnClock = Math.max(0.24, 1.15 - this.state.stage * 0.018);
    }
    if (this.state.generatorFuel > 0 && this.state.generatorHp > 0) this.state.generatorFuel = Math.max(0,this.state.generatorFuel-dt*0.025);
    else if (this.state.generatorHp <= 0 || this.state.generatorFuel <= 0) this.state.generatorHp = Math.max(0,this.state.generatorHp-dt*0.1);
    for (const st of this.state.structures.values()) {
      if (st.kind === "turret" && this.state.generatorFuel > 0 && this.state.generatorHp > 0) {
        const target=[...this.state.zombies.values()].sort((a,b)=>distance(st,a)-distance(st,b))[0];
        if(target && distance(st,target)<260){target.hp-=18*dt;if(target.hp<=0)this.killZombie(target,this.state.players.get(st.ownerId)||[...this.state.players.values()][0]||null);}
      }
      if (st.kind === "fence" && this.state.generatorFuel > 0 && this.state.generatorHp > 0) {
        for(const z of [...this.state.zombies.values()]) if(distance(st,z)<48) { z.hp-=12*dt; if(z.hp<=0)this.killZombie(z,this.state.players.get(st.ownerId)||[...this.state.players.values()][0]||null); }
      }
      if (st.kind === "flameTrap" && this.state.generatorFuel > 0 && this.state.generatorHp > 0) {
        for(const z of [...this.state.zombies.values()]) if(distance(st,z)<65) { z.hp-=20*dt; if(z.hp<=0)this.killZombie(z,this.state.players.get(st.ownerId)||[...this.state.players.values()][0]||null); }
      }
      if (st.kind === "mine" && st.hp > 0) {
        const victim=[...this.state.zombies.values()].find(z=>distance(st,z)<42);
        if(victim){victim.hp-=220;st.hp=0;this.state.structures.delete(st.id);if(victim.hp<=0)this.killZombie(victim,this.state.players.get(st.ownerId)||[...this.state.players.values()][0]||null);}
      }
    }

    const players = [...this.state.players.values()].filter(p => p.alive);
    for (const z of [...this.state.zombies.values()]) {
      if(z.boss&&!this.enraged.has(z.id)&&z.hp/z.maxHp<.3){this.enraged.add(z.id);z.speed*=1.35;z.damage*=1.25;this.state.message="The boss is ENRAGED!";}
      if (!players.length) break;
      const nearestPlayer = players.length ? players.reduce((a,b)=>distance(z,a)<distance(z,b)?a:b) : null;
      const tower = {x: ARENA.width/2, y: ARENA.height/2};
      const target = nearestPlayer && distance(z,nearestPlayer)<230 ? nearestPlayer : tower;
      z.targetId = nearestPlayer?.sessionId || "";
      const d = distance(z, target);
      const a = Math.atan2(target.y - z.y, target.x - z.x);
      const barricade = [...this.state.structures.values()].find(st=>st.kind==="barricade"&&distance(st,z)<30);
      if (barricade) {
        z.attackCooldown -= dt;
        if(z.attackCooldown<=0){barricade.hp-=z.damage;z.attackCooldown=1;if(barricade.hp<=0)this.state.structures.delete(barricade.id);}
      } else if (z.kind === "spitter" && d < 210) {
        // Spitters hold their distance and deal periodic ranged damage.
        if (d < 115) { z.x -= Math.cos(a) * z.speed * dt; z.y -= Math.sin(a) * z.speed * dt; }
      } else if (d > z.radius + 18) {
        z.x = clamp(z.x + Math.cos(a) * z.speed * dt, 5, ARENA.width - 5);
        z.y = clamp(z.y + Math.sin(a) * z.speed * dt, 5, ARENA.height - 5);
      }
      z.attackCooldown -= dt;
      if (d < z.radius + 22 && z.attackCooldown <= 0) {
        if (target.sessionId) {
          const dealt = Math.max(1,z.damage-target.defence); target.hp-=dealt; target.damageTaken+=dealt;
          if(target.hp<=0){target.hp=0;target.alive=false;target.bleedout=30;this.state.message=`${target.name} is down! A teammate can revive them.`;}
        } else {
          this.state.towerHp=Math.max(0,this.state.towerHp-z.damage*(z.boss?2:1));
          if(this.state.towerHp<=0){this.state.phase="defeat";this.state.message="THE RADIO TOWER HAS BEEN DESTROYED — TEAM DEFEATED.";}
        }
        z.attackCooldown = z.boss ? 0.8 : 1.0;
      }
      if (z.kind === "spitter" && target.sessionId && d >= 115 && d < 330 && z.attackCooldown <= 0) {
        const dealt=Math.max(1,z.damage-target.defence);target.hp-=dealt;target.damageTaken+=dealt;z.attackCooldown=2.4;
        if(target.hp<=0){target.hp=0;target.alive=false;target.bleedout=30;this.state.message=`${target.name} is down! A teammate can revive them.`;}
      }
    }
    if (this.state.elapsed >= 90 && this.state.waveType === "normal" && this.state.phase === "playing") {
      this.state.phase = this.state.stage >= 50 ? "victory" : "cleared";
      this.state.message = `Wave ${this.state.stage} survived! Host can launch the next wave.`;
    }
    if ([...this.state.players.values()].every(p=>!p.alive) && this.state.players.size>0 && this.state.phase==="playing") {
      this.state.phase="defeat"; this.state.message="THE ENTIRE TEAM HAS FALLEN.";
    }
  }
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function cleanName(v) { return String(v || "").replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, 18); }
