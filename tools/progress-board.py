# Builds the Survival Ascension progress board (Nov 17 update) -> progress.html (images embedded as small WebP data URIs)
import base64, io, json, os, html, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import equip
from PIL import Image
SA = '/home/claude/sa/client/assets'; S = '/tmp/claude-0/-home-claude/bf90eec0-08de-5616-bd11-000f5b7ebf25/scratchpad'; OUT = os.path.join(S, 'infog', 'progress.html')

def uri(im, q=82, lossless=False):
    b = io.BytesIO(); im.save(b, 'WEBP', quality=q, lossless=lossless, method=6); return 'data:image/webp;base64,' + base64.b64encode(b.getvalue()).decode()
def thumb(path, size, q=82):
    im = Image.open(path).convert('RGBA'); im.thumbnail((size, size), Image.LANCZOS); return uri(im, q)
def sprite(cls):   # the DOWN standing frame of the first block, trimmed (shown 2x, pixelated)
    meta = json.load(open(f'{SA}/sprites/dir8/dir8.json'))[cls]; cw, ch = meta['cellW'], meta['cellH']
    p = f'{SA}/sprites/dir8/{cls}.webp' if os.path.exists(f'{SA}/sprites/dir8/{cls}.webp') else f'{SA}/sprites/dir8/{cls}.png'
    a = Image.open(p).convert('RGBA').crop((0, 0, cw, ch)); bb = a.getbbox(); return uri(a.crop(bb), lossless=True)
def shot(name, box):
    im = Image.open(os.path.join(S, name)).convert('RGB').crop(box); im.thumbnail((720, 720), Image.LANCZOS); return uri(im, 72)
card = lambda n: thumb(f'{SA}/icons/card-{n}.png', 96) if n else None

# ---------------- data ----------------
# status per slot: card name (done, has card art), True (done, no card art yet), None (missing)
CHARS = [
 dict(id='juggernaut', name='IRON', role='Juggernaut · tank', color='#f28b36', state='full', gun='Shotgun + pistol', art='New chibi art (Nov 16)',
      E=('Steel Boomerang', '4s', 'steelBoomerang'), Q=('Unbreakable', '60s', 'unbreakable'), R=('Bare Knuckle', '15s', 'bareKnuckle'), T=('Forceful Blast', '', 'forcefulBlast')),
 dict(id='sniper', name='SIENNA', role='Sniper · ice', color='#69dcff', state='full', gun='Sniper ONLY (one-gun rule)', art='New chibi art (Nov 16)',
      E=('Cryo Grenade', '3.5s', 'cryoGrenade'), Q=('Glacier Perch', '60s', 'glacierPerch'), R=('Ice Decoy', '30s', 'iceDecoy'), T=('Cold Precision', '', 'coldPrecision')),
 dict(id='operator', name='SOFEA', role='Operator · vehicles', color='#e05a4f', state='full', gun='SMG + pistol', art='Older art',
      E=('Steel Convoy', '30s', 'steelConvoy'), Q=('Sky Reign', '60s', 'skyReign'), R=('Crimson Aegis', '100s', 'crimsonAegis'), T=('Mechanic', '', True)),
 dict(id='dispatcher', name='ASTRA', role='Emergency commander · support', color='#9fd86b', state='full', gun='Rifle + pistol', art='Older art',
      E=('Emergency Medics', '30s', 'medicTeam'), Q=('Police Backup', '60s', 'policeBackup'), R=('Safehouse', '90s', 'safehouse'), T=('Field Commander', '', True)),
 dict(id='assault', name='MARCUS', role='Assault · all-rounder', color='#ffd75e', state='needR', gun='Rifle + pistol', art='Older art (the style everyone matches)',
      E=('Combat Rush', '15s', True), Q=('Frag Barrage', '20s', True), R=None, T=('Veteran', '', True)),
 dict(id='engineer', name='VIKTOR', role='Engineer · robots', color='#c9b36a', state='needR', gun='Rifle + pistol', art='Older art',
      E=('Robot Squad', '25s', 'robotSquad'), Q=('Heavy Turret', '60s', 'heavyTurret'), R=None, T=('Tinkerer', '', True)),
 dict(id='scout', name='RAVEN', role='Scout · katana', color='#b48fd0', state='needR', gun='Katana only', art='Older art',
      E=('Shadow Pass', '25s', 'shadowPass'), Q=('Blade Storm', '60s', 'bladeStorm'), R=None, T=('Katana Mastery', '', True)),
 dict(id='demolitionist', name='DANTE', role='Demolitionist · rockets', color='#ff9a5c', state='needR', gun='Launcher + pistol', art='Older art',
      E=('Sky Barrage', '8s', 'skyBarrage'), Q=('Demo Ripple', '60s', 'demoRipple'), R=None, T=('Demolitions Expert', '', True)),
 dict(id='slasher', name='ARSHAN', role='Slasher · chain-axe', color='#f0ecde', state='locked', gun='Chain-axe only', art='Art done · not pickable yet',
      E=("Reaper's Reach", '12s', 'reapersReach'), Q=('Crimson Cyclone', '60s', 'crimsonCyclone'), R=None, T=None),
 dict(id='vex', name='VEX', role='Toxicologist · poison + team heal', color='#8fe36a', state='planned', gun='Toxin Dart Rifle only', art='Kit locked · no art yet',
      E=('Toxic Vial', '~4s', True), Q=('Pandemic', '~60s', True), R=('Antidote Mist', '~25s', True), T=('Chain Reaction', '', True)),
 dict(id='angel', name='ANGEL', role='Guardian medic · protection', color='#e8eef0', state='planned', gun='MP5', art='Draft · no art yet',
      E=('Protective Injection', '~8s', True), Q=('Guardian Angel', '~60s', True), R=('Guardian Shield', '~25s', True), T=None),
]
STATE = {'full': ('FULL KIT', 'c-done'), 'needR': ('NEEDS AN R', 'c-todo'), 'locked': ('LOCKED · NEEDS R + TRAIT', 'c-wip'), 'planned': ('PLANNED', 'c-plan')}
SKILLTEXT = {
 'Steel Boomerang': 'Flings a steel boomerang that bounces through 12 zombies, knocking back and stunning.',
 'Unbreakable': '30s inside 8 spinning shields: everything comes for him and nothing gets past.',
 'Bare Knuckle': '12s of giant gauntlets: every punch blasts a shockwave cone; kills heal him.',
 'Forceful Blast': 'Shotgun shots knock back everything, bosses too; every hit on him does 5 less.',
 'Cryo Grenade': 'Freezes zombies solid for 2s, slows bosses 25%. Only hurts the fire bosses.',
 'Glacier Perch': '20s on an ice tower (600 HP takes every hit) firing a map-length laser; 200px ice floor slows zombies 80%.',
 'Ice Decoy': 'Dash and leave an ice copy zombies chase; hidden and untouchable up to 10s.',
 'Cold Precision': '+43% damage, +50% to bosses / brutes, every sniper hit chills. Sniper reaches 4x as far.',
 'Steel Convoy': 'Drive a tank for 30s: cannon on click, run zombies over.',
 'Sky Reign': 'Fly a gunship for 30s, out of reach, shredding a 90 degree cone.',
 'Crimson Aegis': '30s in the Crimson Aegis mecha: flame jet + lightsaber sweep.',
 'Mechanic': 'Repairs and refuelling cost her half the scrap and fuel.',
 'Emergency Medics': 'Everyone near heals 30%; a medic revives and heals for 20s.',
 'Police Backup': 'Armed officers for 30s guarding her and every teammate.',
 'Safehouse': 'Workers wall her in for 45s; zombies can\'t get in.',
 'Field Commander': 'Revives teammates twice as fast.',
 'Combat Rush': '+50% damage and +25% attack speed for 6s.',
 'Frag Barrage': 'A shove blast, a hop back and 3 grenades fanned at the aim.',
 'Veteran': '+10% damage and fire rate with every weapon.',
 'Robot Squad': 'Deploys assault, support or hunter robots (3 charges).',
 'Heavy Turret': 'A heavy minigun turret for 40s.',
 'Tinkerer': 'Charges refill on their own, 1 extra turret, 1 armour.',
 'Shadow Pass': 'Dash through zombies and vanish; the next hit ignites the katana.',
 'Blade Storm': 'A whirlwind of katana slashes around her.',
 'Katana Mastery': 'The blade levels up every 50 katana kills (5 tiers).',
 'Sky Barrage': '3 rockets up, 3 down around the mouse.',
 'Demo Ripple': 'Plant the crate, press Q again: rings of grenades.',
 'Demolitions Expert': '+17% damage, slower fire rate.',
 "Reaper's Reach": 'Throws the hook up to 1100px and pulls himself to an enemy or a wall.',
 'Crimson Cyclone': '12s of the red-hot axe circling him (260px).',
 'Toxic Vial': 'A poison cloud where he aims that keeps adding toxin stacks.',
 'Pandemic': 'A toxic aura for 20s; when it ends, every poisoned zombie pops for x2.',
 'Antidote Mist': 'Team heal: everyone within ~350px heals 30% over 3s, slows / stuns cleared.',
 'Chain Reaction': 'A poisoned zombie that dies bursts and poisons the ones around it.',
 'Protective Injection': 'Heals the teammate at your aim 25% and they take 30% less damage for 5s.',
 'Guardian Angel': 'Links nearby teammates: 40% less damage; the first who would go down stays at 1 HP.',
 'Guardian Shield': 'Teammates within ~300px get a 40 HP shield (white bar) for 20s.',
}
MISSING_NOTE = {'R': 'No R skill yet', 'T': 'No trait yet'}
MAPS = [('ASCENSION', 'Research Outpost', 'waves 1-4', 'THE BUTCHER', 'butcher'), ('FALLEN DYNASTY', 'China · Walled City', 'waves 5-8', 'THE ALPHA HIVEMIND', 'hivemind'),
        ('WHITEOUT STATION', 'Antarctica · Research Base', 'waves 9-12', 'THE SCREAMER', 'screamer'), ('SCORCHED REFINERY', 'Desert · Oil Field & Pyramid', 'waves 13-16', 'THE PYRE PRIEST', 'pyre'),
        ('THE DEEP MINE', 'Mine carts + the rune mission', 'waves 17-20', 'THE MINE BEAST', 'minebeast'), ('THE CRUCIBLE', 'Volcano · ruined iron foundry', 'waves 21-24', 'THE ABOMINATION', 'abomination')]
PLANNED_MAPS = [('NEON HEIGHTS', 'Cyberpunk rooftops at night', 'map 7 · boss OVERCLOCK', 'prompts written'), ('SHIPWRECK COVE', 'Beach map', 'boss not picked yet', 'prompts written')]
RECENT = [
 ('Iron', 'Replaced Briggs: new chibi military art sized to Marcus, steel boomerang, shields, gauntlets.'),
 ('Sienna rebuilt', 'New art + ice kit, sniper only (first character on the one-gun rule), sniper range x4.'),
 ('Ice effects', 'Your "ultra realistic" grenade burst, ice tower and shatter, keyed to ice-blue (no purple).'),
 ('Cryo Grenade', 'Now freezes zombies instead of hurting them; only the Abomination and Pyre Priest take damage.'),
 ('Glacier Perch', 'Layered 200px ice floor (80% slow), the tower has 600 HP and breaks, Q again / R to jump down.'),
 ('Music + sound', 'Character-select music on every non-boss level; sound fixed live.'),
]
NEXT = [
 ('Build VEX', 'Kit locked (toxin stacks, Chain Reaction, Toxic Vial, Antidote Mist team heal, Pandemic). Next: numbers, design sheet, ChatGPT prompts.'),
 ('Finish ANGEL', 'Pick her trait (Mercy Rounds / Field Surgeon / 7 more ideas) and confirm the shield range and cooldown.'),
 ('R skills for 4 survivors', 'Marcus, Viktor, Raven and Dante only have E + Q.'),
 ('Unlock ARSHAN', 'Needs an R and a trait, then he can join the roster.'),
 ('One-gun rule', 'Sienna done; every other survivor gets one unique gun, one at a time.'),
 ('New maps', 'Neon Heights (map 7) and Shipwreck Cove are written up; art still to make.'),
]

# ---------------- html ----------------
E = html.escape
def slot(c, k):
    v = c[k]; key = 'TRAIT' if k == 'T' else k
    if v is None:
        return f'<div class="sk miss"><div class="ph{' tr' if k == 'T' else ''}">{key}</div><span><b>{MISSING_NOTE.get(k, "Missing")}</b><small>{"Needs designing" if c["state"] != "planned" else "To decide"}</small></span></div>'
    name, cd, art = v; img = f'<img src="{card(art)}" alt="">' if isinstance(art, str) else f'<div class="ph ok{" tr" if k == "T" else ""}">{key}</div>'
    return f'<div class="sk"><span class="kk">{img}</span><span><b><kbd>{key}</kbd>{E(name)}</b>{f"<em>{cd} cooldown</em>" if cd else ""}<small>{E(SKILLTEXT.get(name, ""))}</small></span></div>'
def cell(c, k):
    v = c[k]
    if v is None: return '<td class="m-miss"><span>MISSING</span></td>'
    name, cd, art = v; ic = f'<img src="{card(art)}" alt="">' if isinstance(art, str) else '<i class="dot"></i>'
    return f'<td class="m-ok{" m-plan" if c["state"] == "planned" else ""}">{ic}<span>{E(name)}{f"<small>{cd}</small>" if cd else ""}</span></td>'

por = {c['id']: (thumb(f'{SA}/portraits/{c["id"]}.webp', 128) if os.path.exists(f'{SA}/portraits/{c["id"]}.webp') else None) for c in CHARS}
spr = {c['id']: sprite(c['id']) for c in CHARS if c['id'] not in ('vex', 'angel')}
boss = {b: thumb(f'{SA}/portraits/{b}.webp', 112) for *_, b in MAPS}
shots = [shot('f-full-c.png', (0, 0, 600, 440)), shot('s-beam.png', (0, 0, 940, 360)), shot('z-frozen.png', (0, 0, 520, 300)), shot('lobby-juggernaut.png', (0, 60, 600, 640))]
caps = ['<b>Glacier Perch</b> · the layered ice floor round Sienna\'s tower', '<b>The perch laser</b> · across the whole map, through everything', '<b>Cryo Grenade</b> · zombies frozen in ice blocks', '<b>Lobby</b> · Iron\'s new art']

nFull = sum(c['state'] == 'full' for c in CHARS); play = [c for c in CHARS if c['state'] in ('full', 'needR')]
missR = [c['name'].title() for c in CHARS if c['R'] is None]
rows = ''.join(f'''<tr class="r-{c['state']}"><th><div class="who">{f'<img src="{por[c["id"]]}" alt="">' if por[c['id']] else '<div class="nopor">?</div>'}<span><b style="color:{c['color']}">{c['name']}</b><small>{E(c['role'])}</small></span></div></th>
<td class="m-gun">{E(c['gun'])}</td>{cell(c, 'E')}{cell(c, 'Q')}{cell(c, 'R')}{cell(c, 'T')}<td><span class="chip {STATE[c['state']][1]}">{STATE[c['state']][0]}</span></td></tr>''' for c in CHARS)
cards = ''.join(f'''<article class="sv sv-{c['state']}" style="--sc:{c['color']}">
  <div class="sv-head">{f'<img class="por" src="{por[c["id"]]}" alt="">' if por[c['id']] else '<div class="por nopor">?</div>'}<div><h3>{c['name']}</h3><div class="role-t">{E(c['role'])}</div><span class="chip {STATE[c['state']][1]}">{STATE[c['state']][0]}</span></div>
  {f'<img class="spr" src="{spr[c["id"]]}" alt="">' if c['id'] in spr else ''}</div>
  <div class="gearline"><b>Gun</b> {E(c['gun'])} <i>·</i> <b>Art</b> {E(c['art'])}</div>
  {slot(c, 'E')}{slot(c, 'Q')}{slot(c, 'R')}{slot(c, 'T')}
</article>''' for c in CHARS)
maps = ''.join(f'''<div class="mp"><img src="{boss[b]}" alt=""><div><span class="wv">MAP {i + 1} · {w.upper()}</span><h3>{n}</h3><small>{E(s)}</small><em>Boss: {bn}</em></div></div>''' for i, (n, s, w, bn, b) in enumerate(MAPS))
pmaps = ''.join(f'<div class="mp plan"><div class="ph big">?</div><div><span class="wv">PLANNED · {E(st.upper())}</span><h3>{n}</h3><small>{E(s)}</small><em>{E(b)}</em></div></div>' for n, s, b, st in PLANNED_MAPS)
recent = ''.join(f'<li><span><b>{E(a)}</b><small>{E(b)}</small></span></li>' for a, b in RECENT)
nxt = ''.join(f'<li><span><b>{E(a)}</b><small>{E(b)}</small></span></li>' for a, b in NEXT)
shot_html = ''.join(f'<figure><img src="{u}" alt=""><figcaption>{c}</figcaption></figure>' for u, c in zip(shots, caps))
hero_sprites = ''.join(f'<img src="{spr[c["id"]]}" alt="">' for c in CHARS if c['id'] in spr and c['state'] != 'locked')

equip_html = equip.view(boss, por['sniper'])
page = f'''<title>Survival Ascension Progress</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Teko:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap">
<style>
/* A field-ops board in the game's own world: deliberately one dark look (colours all set here). */
:root {{ color-scheme: dark; --bg:#0b1113; --panel:#121b1e; --panel-2:#172226; --line:#24343a; --fg:#e6ece9; --muted:#8fa1a6; --hazard:#f28b36; --gold:#ffd75e;
  --done:#9fd86b; --wip:#f2c14e; --todo:#ff7a6b; --plan:#8fb0bb;
  --display:"Teko","Arial Narrow",Impact,sans-serif; --body:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif; --mono:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace }}
* {{ box-sizing:border-box }}
body {{ margin:0; background:var(--bg); color:var(--fg); font:400 14px/1.5 var(--body);
  background-image:radial-gradient(1200px 500px at 15% -10%,#1b2b2a 0%,transparent 60%),repeating-linear-gradient(135deg,transparent 0 22px,#ffffff03 22px 23px) }}
.wrap {{ max-width:1200px; margin:0 auto; padding-block:28px 56px; padding-left:max(16px,env(safe-area-inset-left,0px)); padding-right:max(16px,env(safe-area-inset-right,0px)); display:grid; gap:22px }}
h1,h2,h3 {{ font-family:var(--display); font-weight:600; letter-spacing:.02em; margin:0; line-height:.95; text-wrap:balance }}
img {{ max-width:100% }}
header {{ display:grid; grid-template-columns:minmax(0,1fr) auto; gap:18px; align-items:end; padding-bottom:18px; border-bottom:2px solid var(--line); position:relative }}
header::after {{ content:""; position:absolute; left:0; bottom:-2px; width:180px; height:2px; background:var(--hazard) }}
.kicker {{ font:700 11px/1 var(--mono); letter-spacing:.2em; color:var(--hazard); text-transform:uppercase }}
header h1 {{ font-size:clamp(44px,7vw,78px); margin-top:6px }}
header p {{ margin:6px 0 0; color:var(--muted); max-width:62ch }}
.hero-sprite {{ display:flex; flex-wrap:wrap; gap:2px; align-items:flex-end; justify-content:flex-end; max-width:520px }}
.hero-sprite img {{ height:84px; image-rendering:pixelated }}
.stats {{ display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:10px }}
.stat {{ background:var(--panel); border:1px solid var(--line); padding:10px 12px 9px; border-radius:4px; min-width:0 }}
.stat b {{ display:block; font:600 38px/1 var(--display); color:var(--gold); font-variant-numeric:tabular-nums }}
.stat.bad b {{ color:var(--todo) }} .stat.good b {{ color:var(--done) }}
.stat span {{ font-size:12px; color:var(--muted); line-height:1.3; display:block }}
.sec-head {{ display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap }}
.sec-head h2 {{ font-size:40px }} .sec-head span {{ color:var(--muted); font-size:13px }}
.chip {{ display:inline-flex; align-items:center; gap:6px; font:700 10px/1 var(--mono); letter-spacing:.12em; text-transform:uppercase; padding:4px 7px; border-radius:3px; border:1px solid; white-space:nowrap }}
.chip::before {{ content:""; width:7px; height:7px; border-radius:50%; background:currentColor }}
.c-done {{ color:var(--done); border-color:#9fd86b55; background:#9fd86b12 }} .c-wip {{ color:var(--wip); border-color:#f2c14e55; background:#f2c14e12 }}
.c-todo {{ color:var(--todo); border-color:#ff7a6b55; background:#ff7a6b12 }} .c-plan {{ color:var(--plan); border-color:#8fb0bb55; background:#8fb0bb12 }}
.alert {{ display:grid; grid-template-columns:auto minmax(0,1fr); gap:14px; align-items:center; padding:12px 16px; background:#2a1414; border:1px solid #ff7a6b55; border-left:4px solid var(--todo); border-radius:4px; font-size:13px }}
.alert b {{ font:600 24px/1 var(--display); color:var(--todo); letter-spacing:.03em }}
.alert .names {{ display:flex; flex-wrap:wrap; gap:6px }} .alert .names span {{ background:#ff7a6b1c; border:1px solid #ff7a6b55; color:#ffb3a8; border-radius:999px; padding:2px 10px; font-weight:600 }}
/* matrix */
.mx-wrap {{ overflow-x:auto; border:1px solid var(--line); border-radius:4px; background:var(--panel) }}
table.mx {{ border-collapse:collapse; width:100%; min-width:980px; font-size:12.5px }}
.mx th, .mx td {{ padding:8px 10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:middle }}
.mx thead th {{ font:700 10px/1 var(--mono); letter-spacing:.14em; color:var(--muted); text-transform:uppercase; background:#0f1719; position:sticky; top:0 }}
.mx thead th.k {{ color:var(--gold) }}
.who {{ display:grid; grid-template-columns:40px minmax(0,1fr); gap:10px; align-items:center }}
.who img, .who .nopor {{ width:40px; height:40px; object-fit:cover; object-position:center 20%; border-radius:3px; border:1px solid var(--line) }}
.who b {{ font:600 22px/1 var(--display); letter-spacing:.03em; display:block }} .who small {{ color:var(--muted); font-size:11px; display:block; line-height:1.25 }}
.nopor {{ display:grid; place-items:center; background:var(--panel-2); color:#4b6168; font:600 22px var(--display) }}
.m-gun {{ color:var(--muted); font-size:12px; min-width:120px; max-width:150px }}
.mx tbody th {{ min-width:210px; position:sticky; left:0; z-index:1; background:var(--panel) }}   /* the names stay put while the table scrolls sideways on a phone */
.mx thead th:first-child {{ position:sticky; left:0; z-index:2 }}
.m-ok {{ white-space:nowrap }} .m-ok img {{ width:30px; height:30px; border-radius:4px; vertical-align:middle; margin-right:7px }}
.m-ok span {{ display:inline-block; vertical-align:middle; font-weight:600 }} .m-ok small {{ display:block; color:var(--muted); font:500 10.5px/1.2 var(--mono) }}
.m-ok .dot {{ display:inline-block; width:30px; height:30px; border-radius:4px; vertical-align:middle; margin-right:7px; background:repeating-linear-gradient(135deg,#1d2b30 0 5px,#223238 5px 10px); border:1px solid #2c3f45 }}
.m-plan span {{ color:#c6d6db; font-weight:500 }}
.m-miss span {{ display:inline-block; font:700 10.5px/1 var(--mono); letter-spacing:.14em; color:var(--todo); border:1px dashed #ff7a6b88; background:#ff7a6b14; padding:9px 12px; border-radius:4px }}
tr.r-planned th, tr.r-planned td {{ background:#101a1d }} tr.r-locked th, tr.r-locked td {{ background:#16150f }}
tr.sep td {{ padding:4px 10px; font:700 10px/1 var(--mono); letter-spacing:.16em; color:var(--muted); background:#0f1719; text-transform:uppercase }}
/* survivor cards */
.surv {{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px }}
.sv {{ background:var(--panel); border:1px solid var(--line); border-top:3px solid var(--sc); border-radius:4px; padding:14px; display:grid; gap:9px; align-content:start; min-width:0 }}
.sv-planned {{ background:#101a1d; border-style:dashed; border-top-style:solid }} .sv-locked {{ background:#16150f }}
.sv-head {{ display:grid; grid-template-columns:64px minmax(0,1fr) auto; gap:12px; align-items:center }}
.sv-head .por {{ width:64px; height:64px; object-fit:cover; object-position:center 20%; border-radius:3px; border:1px solid var(--line) }}
.sv h3 {{ font-size:32px; color:var(--sc) }} .role-t {{ font:700 10px/1.3 var(--mono); letter-spacing:.12em; color:var(--muted); text-transform:uppercase; margin:2px 0 6px }}
.spr {{ height:76px; image-rendering:pixelated }}
.gearline {{ font-size:12px; color:var(--muted) }} .gearline b {{ color:var(--fg); font-weight:600 }} .gearline i {{ font-style:normal; margin:0 4px }}
.sk {{ display:grid; grid-template-columns:52px minmax(0,1fr); gap:10px; align-items:start; background:var(--panel-2); border-radius:3px; padding:8px; font-size:12.5px; line-height:1.4 }}
.sk img {{ width:52px; height:52px; border-radius:4px; display:block }}
.sk b {{ font-weight:600; font-size:13.5px; display:block }} .sk small {{ color:var(--muted); display:block; font-size:12px; margin-top:2px }}
.sk em {{ font-style:normal; font:700 10.5px/1.4 var(--mono); color:var(--gold); display:block }}
kbd {{ font:700 10px/1 var(--mono); color:var(--fg); background:#0a1012; border:1px solid #3a4c52; border-bottom-width:3px; border-radius:4px; padding:3px 5px; margin-right:6px; vertical-align:1px }}
.ph {{ width:52px; height:52px; border-radius:4px; display:grid; place-items:center; font:600 20px var(--display); color:#5d747b; border:1px dashed #3a4c52 }}
.ph.tr {{ font-size:14px; letter-spacing:.06em }}
.ph.ok {{ border-style:solid; background:repeating-linear-gradient(135deg,#1d2b30 0 6px,#223238 6px 12px); color:#9fb5bb }}
.sk.miss {{ background:#251515; outline:1px dashed #ff7a6b77; outline-offset:-1px }} .sk.miss .ph {{ color:var(--todo); border-color:#ff7a6b88 }} .sk.miss b {{ color:#ffb3a8 }}
.legend {{ display:flex; flex-wrap:wrap; gap:8px 16px; font-size:12px; color:var(--muted); align-items:center }}
.legend .sw {{ display:inline-block; width:14px; height:14px; border-radius:3px; vertical-align:-3px; margin-right:5px }}
/* maps */
.maps {{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px }}
.mp {{ background:var(--panel); border:1px solid var(--line); border-radius:4px; padding:10px; display:grid; grid-template-columns:56px minmax(0,1fr); gap:10px; align-items:center; min-width:0 }}
.mp img, .mp .ph.big {{ width:56px; height:56px; object-fit:cover; object-position:center 25%; border-radius:3px; border:1px solid var(--line) }}
.mp .wv {{ font:700 9.5px/1 var(--mono); letter-spacing:.14em; color:var(--hazard) }} .mp h3 {{ font-size:22px; margin-top:3px }}
.mp small {{ display:block; color:var(--muted); font-size:11.5px; line-height:1.3 }} .mp em {{ font-style:normal; font:700 10.5px/1.4 var(--mono); color:var(--todo); display:block; margin-top:2px }}
.mp.plan {{ border-style:dashed; background:#101a1d }} .mp.plan .wv {{ color:var(--plan) }} .mp.plan em {{ color:var(--plan) }}
/* bottom */
.split {{ display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:14px }}
.box {{ background:var(--panel); border:1px solid var(--line); border-radius:4px; padding:14px 16px }}
.box h2 {{ font-size:30px; margin-bottom:10px }}
.recent {{ list-style:none; margin:0; padding:0; display:grid; gap:8px }}
.recent li {{ display:grid; grid-template-columns:14px minmax(0,1fr); gap:8px; font-size:13px; line-height:1.4 }}
.recent li::before {{ content:""; width:9px; height:9px; margin-top:5px; border-radius:2px; background:var(--done) }}
.recent b, .next b {{ font-weight:600; display:block }} .recent small, .next small {{ color:var(--muted); font-size:12px; display:block }}
.next {{ list-style:none; margin:0; padding:0; display:grid; gap:8px; counter-reset:n }}
.next li {{ counter-increment:n; display:grid; grid-template-columns:30px minmax(0,1fr); gap:10px; align-items:start; font-size:13px; line-height:1.45 }}
.next li::before {{ content:counter(n); font:600 24px/1 var(--display); color:var(--hazard); text-align:center; border:1px solid #f28b3655; border-radius:3px; padding:4px 0 1px }}
.shots {{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px }}
.shots figure {{ margin:0; background:var(--panel); border:1px solid var(--line); border-radius:4px; overflow:hidden }}
.shots img {{ display:block; width:100%; aspect-ratio:16/10; object-fit:cover }}
.shots figcaption {{ padding:7px 10px; font-size:12px; color:var(--muted) }} .shots figcaption b {{ color:var(--fg); font-weight:600 }}
{equip.CSS}
footer {{ color:var(--muted); font-size:12px; border-top:1px solid var(--line); padding-top:12px }}
@media (max-width:1000px) {{ .surv {{ grid-template-columns:1fr 1fr }} .maps {{ grid-template-columns:repeat(2,minmax(0,1fr)) }} .stats {{ grid-template-columns:repeat(3,minmax(0,1fr)) }} .shots {{ grid-template-columns:1fr 1fr }} .split {{ grid-template-columns:1fr }} }}
@media (max-width:640px) {{ header {{ grid-template-columns:1fr }} .hero-sprite {{ justify-content:flex-start }} .hero-sprite img {{ height:60px }} .surv, .maps, .shots {{ grid-template-columns:1fr }}
  .stats {{ grid-template-columns:repeat(2,minmax(0,1fr)) }} .alert {{ grid-template-columns:1fr }} .sv-head {{ grid-template-columns:56px minmax(0,1fr) }} .sv-head .spr {{ display:none }} }}
</style>
<div class="wrap">
<header>
  <div><div class="kicker">Field report · updated 17 Nov 2026</div><h1>Survival Ascension</h1>
  <p>Online co-op zombie survival. Where every survivor stands, which skills are still missing, the maps in rotation and what's next.</p></div>
  <div class="hero-sprite" aria-hidden="true">{hero_sprites}</div>
</header>
<nav class="tabs" aria-label="Pages"><a href="#board" aria-current="page">Progress board</a><a href="#equipment">Boss gear (planned)</a></nav>
<div class="view" id="v-board">
<section class="stats" aria-label="Key numbers">
  <div class="stat"><b>8</b><span>playable survivors (+ Arshan locked)</span></div>
  <div class="stat good"><b>{nFull} / 8</b><span>with a full kit: E + Q + R + trait</span></div>
  <div class="stat bad"><b>{len(missR)}</b><span>survivors without an R skill</span></div>
  <div class="stat"><b>2</b><span>new survivors planned (Vex, Angel)</span></div>
  <div class="stat"><b>6</b><span>maps in rotation, a boss on every 4th wave</span></div>
  <div class="stat"><b>1 / 8</b><span>on the one-gun rule (Sienna)</span></div>
</section>
<div class="alert"><b>Missing R skills</b><div><div class="names">{''.join(f'<span>{n}</span>' for n in missR)}</div><div style="margin-top:6px;color:var(--muted)">Arshan also needs a trait before he can be unlocked. Vex is fully planned; Angel still needs her trait.</div></div></div>

<section class="sec-head"><h2>Skill check</h2><span>Every survivor at a glance · Q is the ultimate, E the quick skill, R the third</span></section>
<div class="legend"><span><i class="sw" style="background:#9fd86b33;border:1px solid #9fd86b"></i>Done (with its card art)</span><span><i class="sw" style="background:repeating-linear-gradient(135deg,#1d2b30 0 4px,#223238 4px 8px);border:1px solid #2c3f45"></i>Done or planned, no card art yet</span><span><i class="sw" style="border:1px dashed #ff7a6b;background:#ff7a6b14"></i>Missing</span></div>
<div class="mx-wrap"><table class="mx"><thead><tr><th>Survivor</th><th>Gun</th><th class="k">E</th><th class="k">Q · ultimate</th><th class="k">R</th><th class="k">Trait</th><th>Status</th></tr></thead><tbody>
{rows.replace('<tr class="r-locked">', '<tr class="sep"><td colspan="7">Not pickable yet</td></tr><tr class="r-locked">', 1).replace('<tr class="r-planned">', '<tr class="sep"><td colspan="7">Planned</td></tr><tr class="r-planned">', 1)}
</tbody></table></div>

<section class="sec-head"><h2>Survivors</h2><span>Full kits first, then the ones that need an R, then locked and planned</span></section>
<section class="surv" aria-label="Survivors">{cards}</section>

<section class="sec-head"><h2>Maps</h2><span>The fixed order: 4 waves per map, its boss on the 4th · after map 6 it starts over, harder · wave 50 is the Apocalypse</span></section>
<section class="maps" aria-label="Maps">{maps}{pmaps}</section>

<section class="sec-head"><h2>How it looks now</h2><span>From the current preview</span></section>
<section class="shots">{shot_html}</section>

<section class="split">
  <div class="box"><h2>Just shipped</h2><ul class="recent">{recent}</ul></div>
  <div class="box"><h2>What's next</h2><ol class="next">{nxt}</ol></div>
</section>
</div>
<div class="view" id="v-equip" hidden>{equip_html}</div>
<footer>Survival Ascension · progress board · numbers marked ~ are planned, not final. Boss gear is a plan: names and numbers are first ideas.</footer>
</div>{equip.JS}'''
open(OUT, 'w').write(page); print(OUT, round(len(page) / 1024), 'KB')
