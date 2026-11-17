# The planned BOSS GEAR system (Nov 17, user): data + the "Equipment" view of the progress board (imported by build.py)
import html, base64, io, os
from PIL import Image
E = html.escape
ART = '/home/claude/sa/tools/art/equipment'   # (Nov 17) the user's ChatGPT screen designs + material icons (tools/extract-materials.py)
def uri(path, w=None, q=82):
    im = Image.open(path)
    if w and im.width > w: im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'WEBP', quality=q, method=6); return 'data:image/webp;base64,' + base64.b64encode(b.getvalue()).decode()
MAT_ICON = {'Gold': 'gold', 'Iron Ore': 'iron-ore', 'Silver Ore': 'silver-ore', 'Titanium Ore': 'titanium-ore'}
SLOTS = ['Head', 'Outfit', 'Gloves', 'Boots', 'Gun Mod', 'Trophy']
# (tier, name, slot, kind DEF/ATK/UTIL, stat text). Tier 10 = the boss's legendary piece with a special effect.
GEAR = {
 'butcher': ('THE BUTCHER', 'Ascension · Research Outpost', 'Meat, hooks and cleavers: melee, healing and HP', [
  (1, 'Stained Apron', 'Outfit', 'DEF', '+8 max HP'),
  (2, "Butcher's Gloves", 'Gloves', 'ATK', '+4% melee damage'),
  (3, 'Rubber Boots', 'Boots', 'UTIL', '+3% move speed'),
  (4, 'Pig Mask', 'Head', 'DEF', '+16 max HP'),
  (5, 'Sharpened Sight', 'Gun Mod', 'ATK', '+6% damage'),
  (6, 'Chain Apron', 'Outfit', 'DEF', '+2 armour, +12 max HP'),
  (7, 'Meat Hook Charm', 'Trophy', 'UTIL', 'Melee kills heal 3 HP'),
  (8, 'Hook Gauntlets', 'Gloves', 'ATK', '+10% melee damage, +6% fire rate'),
  (9, 'Bone Saw Barrel', 'Gun Mod', 'ATK', '+12% damage, shots go through 1 more zombie'),
  (10, "The Butcher's Cleaver", 'Trophy', 'ATK', '+10% damage. Melee kills heal 6 HP, and 1 hit in 10 cleaves for double damage'),

  (8, 'Slaughterhouse Vest', 'Outfit', 'DEF', '+3 armour, +20 max HP'),
  (8, 'Meat Locker Boots', 'Boots', 'UTIL', '+8% move speed, slows on you last 30% shorter'),
  (9, 'Blood-Soaked Hood', 'Head', 'DEF', '+25 max HP, melee kills heal 2 HP'),
  (10, "The Butcher's Apron", 'Outfit', 'DEF', '+6 armour, +40 max HP. Zombies that bite you bleed (10 damage over 2s)'),
  (10, 'The Meat Hook', 'Gun Mod', 'ATK', '+15% damage. Every 8s your next shot hooks a zombie and drags it to you, stunned for 1s'),
 ]),
 'hivemind': ('THE ALPHA HIVEMIND', 'Fallen Dynasty · China', 'Chitin, silk and jade: armour, fire rate and faster skills', [
  (1, 'Silk Wraps', 'Gloves', 'ATK', '+3% fire rate'),
  (2, 'Jade Bead Charm', 'Trophy', 'UTIL', 'Skills recharge 4% faster'),
  (3, 'Chitin Shin Guards', 'Boots', 'DEF', '+1 armour'),
  (4, 'Hive Mask', 'Head', 'DEF', '+1 armour, +8 max HP'),
  (5, 'Larva Sac Ammo', 'Gun Mod', 'ATK', '+6% fire rate'),
  (6, 'Chitin Vest', 'Outfit', 'DEF', '+3 armour'),
  (7, 'Antenna Headset', 'Head', 'UTIL', 'See zombies through walls close to you, +10 max HP'),
  (8, 'Swarm Gloves', 'Gloves', 'ATK', '+10% fire rate'),
  (9, 'Hive Heart', 'Trophy', 'UTIL', 'Skills recharge 12% faster'),
  (10, 'Alpha Crown', 'Head', 'DEF', '+4 armour, +30 max HP. Zombies that bite you take 15 damage back'),

  (8, 'Jade Scale Armour', 'Outfit', 'DEF', '+4 armour, +15 max HP'),
  (8, 'Silk Runner Boots', 'Boots', 'UTIL', '+9% move speed'),
  (9, 'Stinger Rounds', 'Gun Mod', 'ATK', '+10% damage, your hits poison zombies (a little damage over time)'),
  (10, "The Brood Mother's Sac", 'Trophy', 'UTIL', 'Skills recharge 15% faster. Every 20s, 3 friendly larvae hatch and fight for you for 10s'),
  (10, 'Jade Emperor Gauntlets', 'Gloves', 'ATK', '+18% fire rate. Every 5th hit jumps to 2 more zombies nearby'),
 ]),
 'screamer': ('THE SCREAMER', 'Whiteout Station · Antarctica', 'Sound and snow: stun protection, speed and cooldowns', [
  (1, 'Wool Scarf', 'Outfit', 'DEF', '+8 max HP'),
  (2, 'Earmuffs', 'Head', 'DEF', 'Stuns on you last 20% shorter'),
  (3, 'Snow Boots', 'Boots', 'UTIL', '+3% move speed'),
  (4, 'Frosted Lens', 'Gun Mod', 'ATK', '+5% damage, +10% range'),
  (5, 'Thermal Gloves', 'Gloves', 'ATK', '+5% fire rate'),
  (6, 'Parka Plate', 'Outfit', 'DEF', '+2 armour, +16 max HP'),
  (7, 'Echo Charm', 'Trophy', 'UTIL', 'Skills recharge 10% faster'),
  (8, 'Noise-Cancel Helmet', 'Head', 'DEF', 'Screams can\'t stun you, +16 max HP'),
  (9, 'Glacier Boots', 'Boots', 'UTIL', '+8% move speed, and a frost trail that slows zombies 20%'),
  (10, "The Screamer's Vocal Cord", 'Trophy', 'UTIL', 'Skills recharge 10% faster. Every 20s you let out a scream that stuns zombies around you for 1s'),

  (8, 'Arctic Parka', 'Outfit', 'DEF', '+3 armour, +20 max HP'),
  (8, 'Tuning Fork Scope', 'Gun Mod', 'ATK', '+10% damage, +15% range'),
  (9, 'Frostbite Gloves', 'Gloves', 'ATK', '+8% fire rate, your hits make zombies 15% slower for 1s'),
  (10, 'The Banshee Veil', 'Head', 'DEF', "+35 max HP. Screams and stuns can't touch you"),
  (10, 'The Whiteout Coat', 'Outfit', 'DEF', '+5 armour, +30 max HP. Zombies near you are 20% slower (a cold aura)'),
 ]),
 'pyre': ('THE PYRE PRIEST', 'Scorched Refinery · desert', 'Fire and ash: burning, damage and fire protection', [
  (1, 'Ash Cloth', 'Outfit', 'DEF', '+8 max HP'),
  (2, 'Ember Gloves', 'Gloves', 'ATK', '+4% damage'),
  (3, 'Sand Treads', 'Boots', 'UTIL', '+4% move speed'),
  (4, 'Prayer Beads', 'Trophy', 'UTIL', 'Skills recharge 5% faster'),
  (5, 'Incendiary Rounds', 'Gun Mod', 'ATK', 'Your hits set zombies on fire (a small burn)'),
  (6, "Priest's Hood", 'Head', 'DEF', '+20 max HP, fire hurts you 30% less'),
  (7, 'Flame-Forged Grips', 'Gloves', 'ATK', '+10% damage'),
  (8, 'Pyre Plate', 'Outfit', 'DEF', 'Fireproof (the drop already in the game), +4 armour'),
  (9, 'Sun Idol', 'Trophy', 'ATK', '+12% damage, +6% fire rate'),
  (10, 'The Pyre Crown', 'Head', 'DEF', '+40 max HP. When you\'re hit, a ring of fire bursts round you (once every 8s)'),

  (8, 'Desert Walker Boots', 'Boots', 'UTIL', "+9% move speed, fire on the ground can't hurt you"),
  (8, 'Cinder Mask', 'Head', 'DEF', '+22 max HP, fire hurts you 40% less'),
  (9, 'Phoenix Gloves', 'Gloves', 'ATK', '+12% damage, kills sometimes burst into flame'),
  (10, 'The Eternal Flame', 'Gun Mod', 'ATK', '+18% damage. Every shot sets zombies on fire, and burning zombies take 10% more damage'),
  (10, "The Priest's Censer", 'Trophy', 'UTIL', 'Skills recharge 15% faster. Using a skill bursts a ring of fire round you'),
 ]),
 'minebeast': ('THE MINE BEAST', 'The Deep Mine', 'Rock, ore and runes: armour, piercing and gold', [
  (1, "Miner's Gloves", 'Gloves', 'ATK', '+3% fire rate'),
  (2, 'Steel-Toe Boots', 'Boots', 'DEF', '+1 armour'),
  (3, "Miner's Helmet", 'Head', 'DEF', '+10 max HP and a light in the dark'),
  (4, 'Ore Chunk Charm', 'Trophy', 'UTIL', '+10% gold from kills'),
  (5, 'Drill Bit Barrel', 'Gun Mod', 'ATK', 'Shots go through 1 more zombie'),
  (6, 'Ore-Plated Vest', 'Outfit', 'DEF', '+3 armour'),
  (7, 'Rune Stone', 'Trophy', 'UTIL', 'Skills recharge 12% faster'),
  (8, 'Rune Boots', 'Boots', 'UTIL', '+10% move speed'),
  (9, 'Crystal Scope', 'Gun Mod', 'ATK', '+15% damage, +20% range'),
  (10, "The Beast's Horn", 'Trophy', 'DEF', '+5 armour. Every 15s your next shot is a rock spike that stuns for 1s'),

  (8, 'Granite Plate', 'Outfit', 'DEF', '+5 armour'),
  (8, "Foreman's Helmet", 'Head', 'DEF', '+20 max HP, +1 armour and a light in the dark'),
  (9, 'Pickaxe Grips', 'Gloves', 'ATK', '+12% melee damage, +8% fire rate'),
  (10, 'The Rune Heart', 'Trophy', 'UTIL', 'Skills recharge 18% faster. Glowing runes under your feet heal teammates near you 2 HP a second'),
  (10, "The Beast's Hide", 'Outfit', 'DEF', '+7 armour, +30 max HP. Every 10s the next hit on you is blocked'),
 ]),
 'abomination': ('THE ABOMINATION', 'The Crucible · volcano', 'Flesh, iron and lava: max HP, healing and a second life', [
  (1, 'Rag Bandages', 'Outfit', 'DEF', 'Heal 0.5 HP a second'),
  (2, 'Iron Knuckles', 'Gloves', 'ATK', '+5% melee damage'),
  (3, 'Lava Treads', 'Boots', 'UTIL', '+4% move speed, lava hurts you 50% less'),
  (4, 'Foundry Mask', 'Head', 'DEF', '+2 armour'),
  (5, 'Molten Slugs', 'Gun Mod', 'ATK', '+8% damage'),
  (6, 'Mutant Hide', 'Outfit', 'DEF', '+30 max HP, heal 1 HP a second'),
  (7, 'Crucible Gauntlets', 'Gloves', 'ATK', '+12% damage'),
  (8, 'Iron Lung', 'Trophy', 'DEF', '+40 max HP'),
  (9, 'Forge Helm', 'Head', 'DEF', '+4 armour, +20 max HP'),
  (10, "The Abomination's Heart", 'Trophy', 'DEF', 'Heal 2 HP a second. Once a match, when you would go down you get back up with 50% HP'),

  (8, 'Slag Boots', 'Boots', 'UTIL', "+8% move speed, lava can't hurt you"),
  (8, 'Stitched Flesh Vest', 'Outfit', 'DEF', '+35 max HP, heal 1 HP a second'),
  (9, 'Molten Core Barrel', 'Gun Mod', 'ATK', '+14% damage, every 10th shot is a molten slug that splashes'),
  (10, 'The Iron Maw', 'Gloves', 'ATK', '+20% melee damage, +10% fire rate. Melee kills heal 8 HP'),
  (10, 'The Flesh Crown', 'Head', 'DEF', '+50 max HP, and +1 more max HP for every 20 kills in a match (up to +30)'),
 ]),
}
PILE = (10, 12)   # (Nov 17, user) a boss kill bursts into 10-12 items on the ground; first come, first served
# (Nov 17, user) every burst: exactly 1 LEGENDARY (one of the boss's 3, each equally likely), 1-2 EPICS (from its 5), the rest from its 7 lower items
EPICS = (1, 2)
RATIO = 0.75   # the lower items (tiers 1-7): each tier 3/4 as likely as the one below
ODDS = [RATIO ** (t - 1) for t in range(1, 8)]; tot = sum(ODDS); ODDS = [o / tot for o in ODDS]
# (Nov 17, user) the other 7-10 drops are also materials: gold and ores (for enhancing later). Split: half gear, half materials (Claude's pick, easy to change)
MAT_SHARE = 0.5
MATS = [   # name, weight among material rolls, stack size, colour, what it's for
 ('Gold', 40, '25–75 coins', '#e0a84a', 'Money. Every enhance costs gold; later, trading too'),
 ('Iron Ore', 30, '1–3', '#a9b4ba', 'Enhances gear from +1 to +4'),
 ('Silver Ore', 17, '1–2', '#dfe7ec', 'Enhances gear from +5 to +7'),
 ('Titanium Ore', 9, '1', '#7fd0d8', 'Enhances gear from +8 to +10'),
 ('Boss Essence', 4, '1', '#ff8a5c', "Each boss has its own. Needed to enhance that boss's epics and legendaries"),
]
ESSENCE = {'butcher': "Butcher's Bone", 'hivemind': 'Jade Resin', 'screamer': 'Frozen Echo', 'pyre': 'Ember Core', 'minebeast': 'Rune Shard', 'abomination': 'Slag Core'}
def combos():   # (rest count, weight) over burst sizes 10-12 and 1-2 epics, all equally likely
    out = []
    for n in range(PILE[0], PILE[1] + 1):
        for e in range(EPICS[0], EPICS[1] + 1): out.append(n - 1 - e)
    return out
def in_pile_low(t): c = combos(); p = (1 - MAT_SHARE) * ODDS[t - 1]; return sum(1 - (1 - p) ** r for r in c) / len(c)
def in_pile_mat(w): c = combos(); p = MAT_SHARE * w / sum(m[1] for m in MATS); return sum(1 - (1 - p) ** r for r in c) / len(c)
def in_pile_epic(n=5): es = range(EPICS[0], EPICS[1] + 1); return sum(1 - (1 - 1 / n) ** e for e in es) / len(es)
def chance(t, n_epic=5, n_leg=3): return 1 / n_leg if t == 10 else in_pile_epic(n_epic) if t >= 8 else in_pile_low(t)
BAND = lambda t: ('Common', '#c9d1cf') if t <= 3 else ('Uncommon', '#7fd36a') if t <= 5 else ('Rare', '#5fb4ff') if t <= 7 else ('Epic', '#c58bff') if t <= 9 else ('Legendary', '#ffc94d')
KIND = {'DEF': ('DEFENCE', '#5fb4ff'), 'ATK': ('ATTACK', '#ff7a6b'), 'UTIL': ('UTILITY', '#f2c14e')}
def pct(x):
    x *= 100; return f'{x:.0f}%' if x >= 10 else f'{x:.1f}%' if x >= 1 else f'{x:.2f}%' if x >= .1 else f'{x:.3f}%'
def one_in(x): return f'1 in {round(1 / x):,}'
LOW_AVG = sum(combos()) / len(combos())   # lower items in an average burst
COLLECT3 = 3 * (1 + 1 / 2 + 1 / 3)   # kills to see all 3 legendaries, on average

def card(t, n, sl, k, st, extra=''):
    return f'''<div class="it{' leg' if t == 10 else ''}" style="--bc:{BAND(t)[1]}"><div class="it-top"><span class="tb" style="--bc:{BAND(t)[1]}">T{t}</span><span class="slot">{E(sl)}</span><span class="kd" style="--kc:{KIND[k][1]}">{KIND[k][0]}</span></div>
          <h4>{E(n)}</h4><p>{E(st)}</p><div class="it-odds"><span>{BAND(t)[0]}</span><b>{pct(chance(t))} of kills</b></div></div>'''

# ---- the item hover card (Nov 17: user showed MapleStory's item tooltips as an example, not to copy) ----
ENH_STEP = 0.05   # each + adds 5% of the item's base stats (+10 = +50%); special effects don't change (Claude's pick)
ENH = {   # next level: (success, ore, ore count, gold); +8 to +10 on epics/legendaries also take 1 boss essence. A fail uses the materials, the item keeps its level
 1: (100, 'Iron Ore', 1, 50), 2: (95, 'Iron Ore', 2, 100), 3: (90, 'Iron Ore', 3, 150), 4: (85, 'Iron Ore', 4, 200),
 5: (70, 'Silver Ore', 1, 250), 6: (60, 'Silver Ore', 2, 300), 7: (50, 'Silver Ore', 3, 350),
 8: (40, 'Titanium Ore', 1, 400), 9: (30, 'Titanium Ore', 2, 450), 10: (20, 'Titanium Ore', 3, 500)}
ICON = {   # simple line icons per slot (code-made, coloured by rarity)
 'Head': '<path d="M10 30c0-9 6-16 14-16s14 7 14 16v4H10z"/><path d="M8 34h32M18 22h12"/>',
 'Outfit': '<path d="M17 10l-7 5 3 9 4-2v18h14V22l4 2 3-9-7-5c-1 3-4 5-7 5s-6-2-7-5z"/><path d="M24 15v25"/>',
 'Gloves': '<path d="M16 38V22l-3-6c-1-2 2-4 3-2l3 5V10c0-2 3-2 3 0v8-10c0-2 3-2 3 0v10-8c0-2 3-2 3 0v9-6c0-2 3-2 3 0v13c0 5-3 9-8 9h-2c-3 0-5-1-6-3z"/>',
 'Boots': '<path d="M15 8h10v20l10 4c3 1 4 3 4 6v2H13v-6l2-4z"/><path d="M13 34h26"/>',
 'Gun Mod': '<circle cx="24" cy="24" r="11"/><circle cx="24" cy="24" r="3"/><path d="M24 7v8M24 33v8M7 24h8M33 24h8"/>',
 'Trophy': '<path d="M16 9h16v9a8 8 0 0 1-16 0z"/><path d="M16 12h-5c0 5 2 8 6 8M32 12h5c0 5-2 8-6 8M24 26v7M17 39h14l-2-6H19z"/>',
}
def icon(slot, col): return f'<svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="{col}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">{ICON[slot]}</svg>'
def boosted(base, lvl): return base + round(base * ENH_STEP * lvl + 1e-9)
def tip(item, lvl, stats, special, boss, vs=None, cmp=()):
    t, n, sl, k, _ = item; band, col = BAND(t); kname = KIND[k][0].title()
    pips = ''.join(f'<i class="{"on" if i < lvl else ""}"></i>' for i in range(10))
    rows = ''.join(f'<div class="tt-s"><span>{E(lab)}</span><b>+{boosted(b, lvl)}{u}</b><small>{b}{u}' + (f' <em>+{boosted(b, lvl) - b}</em>' if lvl else '') + '</small></div>' for lab, b, u in stats)
    cm = ''.join(f'<li class="{"up" if d > 0 else "dn"}">{"▲" if d > 0 else "▼"} {E(txt)}</li>' for d, txt in cmp)
    vs_html = f'<div class="tt-vs"><small>vs your {E(vs)}</small><ul>{cm}</ul></div>' if vs else f'<div class="tt-vs"><small>your {E(sl.lower())} slot is empty</small><ul>{cm}</ul></div>'
    sp = f'<div class="tt-sp"><b>SPECIAL</b>{E(special)}</div>' if special else ''
    if lvl < 10:
        ok, ore, cnt, gold = ENH[lvl + 1]; ess = f' · 1 {E(ESSENCE[boss])}' if t >= 8 and lvl + 1 >= 8 else ''
        enh = f'<div class="tt-en"><div><b>ENHANCE</b><span>+{lvl} → +{lvl + 1}</span><em>{ok}% chance</em></div><small>{cnt} {ore}{ess} · {gold} Gold</small></div>'
    else: enh = '<div class="tt-en"><div><b>ENHANCE</b><span>+10 · maxed</span></div></div>'
    return f'''<div class="tt" style="--bc:{col}"><div class="tt-top"><span class="tb" style="--bc:{col}">{band.upper()} · T{t}</span><span class="pips" title="enhanced +{lvl} of 10">{pips}</span></div>
      <h4>{E(n)}{f" <span>+{lvl}</span>" if lvl else ""}</h4><div class="tt-meta">{E(sl)} · {kname} · from {E(GEAR[boss][0].title())}</div>
      <div class="tt-mid"><div class="tt-ic">{icon(sl, col)}</div>{vs_html}</div>
      <div class="tt-st">{rows}</div>{sp}{enh}<div class="tt-ft">Kept forever · tradeable later</div></div>'''

def tips_html():
    g = {k: {it[1]: it for it in v[3]} for k, v in GEAR.items()}
    a = tip(g['butcher']['Rubber Boots'], 0, [('Move speed', 3, '%')], None, 'butcher', None, [(1, '+3% move speed')])
    b = tip(g['butcher']['Blood-Soaked Hood'], 4, [('Max HP', 25, '')], 'Melee kills heal 2 HP', 'butcher', 'Pig Mask +6', [(1, f'+{boosted(25, 4) - boosted(16, 6)} max HP'), (1, 'melee kills heal 2 HP')])
    c = tip(g['butcher']["The Butcher's Apron"], 7, [('Armour', 6, ''), ('Max HP', 40, '')], 'Zombies that bite you bleed (10 damage over 2s)', 'butcher', 'Stitched Flesh Vest +6',
            [(1, f'+{boosted(6, 7)} armour'), (1, f'+{boosted(40, 7) - boosted(35, 6)} max HP'), (-1, 'heal 1 HP a second'), (1, 'bite bleed (special)')])
    return a + b + c

def view(boss_img, sample_por):
    row = lambda tag, col, kills, b, note: f'''<div class="od"><span class="tb" style="--bc:{col}">{tag}</span><div class="obar"><i style="width:{max(.6, kills * 100):.2f}%;background:{col}"></i></div>
      <b>{b}</b><small>{note}</small></div>'''
    odds_rows = row('T10', BAND(10)[1], 1 / 3, pct(1 / 3), 'always 1 · picked from 3')
    odds_rows += row('T8–9', BAND(8)[1], in_pile_epic(), pct(in_pile_epic()), '1–2 per burst · from 5')
    odds_rows += ''.join(row(f'T{t}', BAND(t)[1], in_pile_low(t), pct(in_pile_low(t)), f'{pct((1 - MAT_SHARE) * ODDS[t - 1])} of the other rolls') for t in range(7, 0, -1))
    bands = ''.join(f'<span class="band" style="--bc:{c}"><b>{n}</b> T{a}{"–T" + str(b) if b != a else ""}</span>' for n, c, a, b in [('Common', '#c9d1cf', 1, 3), ('Uncommon', '#7fd36a', 4, 5), ('Rare', '#5fb4ff', 6, 7), ('Epic', '#c58bff', 8, 9), ('Legendary', '#ffc94d', 10, 10)])
    burst = f'''<div class="burst"><span style="--bc:{BAND(10)[1]}"><b>1</b>Legendary</span><span style="--bc:{BAND(8)[1]}"><b>1–2</b>Epic</span><span style="--bc:{BAND(6)[1]}"><b>7–10</b>lower gear, gold and ores</span></div>'''
    ic = {k: uri(os.path.join(ART, 'icons', f + '.png'), 96, 88) for k, f in [*[(v, v) for v in MAT_ICON.values()], *[(b, 'ess-' + b) for b in ESSENCE]]}
    mic = lambda n: f'<img src="{ic[MAT_ICON[n]]}" alt="">' if n in MAT_ICON else '<span class="ess6">' + ''.join(f'<img src="{ic[b]}" alt="">' for b in ESSENCE) + '</span>'
    mats = ''.join(f'''<div class="it mat" style="--bc:{c}"><div class="mat-top">{mic(n)}<div><span class="slot">stacks × {E(st)}</span><h4>{E(n)}</h4></div></div>
          <p>{E(use)}</p><div class="it-odds"><span>Material</span><b>{pct(in_pile_mat(w))} of kills</b></div></div>''' for n, w, st, c, use in MATS)
    ess = ''.join(f'<span class="essi"><img src="{ic[k]}" alt=""><b>{E(GEAR[k][0].title().replace("The ", ""))}</b> {E(v)}</span>' for k, v in ESSENCE.items())
    shots = ''.join(f'<figure class="shot"><img src="{uri(os.path.join(ART, f), 1100, 80)}" alt="{E(cap)} screen design"><figcaption>{cap}</figcaption></figure>' for f, cap in (('1-equipment.png', 'Equipment tab'), ('2-stats.png', 'Stats tab')))
    slots_l = ''.join(f'<div class="eslot"><b>{s}</b></div>' for s in SLOTS[:3]); slots_r = ''.join(f'<div class="eslot"><b>{s}</b></div>' for s in SLOTS[3:])
    bosses = ''
    for key, (bn, where, theme, items) in GEAR.items():
        legs = [it for it in items if it[0] == 10]; epics = sorted([it for it in items if it[0] in (8, 9)], key=lambda it: it[0]); low = sorted([it for it in items if it[0] <= 7], reverse=True)
        nd = sum(1 for it in items if it[3] == 'DEF')
        grp = lambda cls, head, sub, its: f'''<div class="grp"><div class="grp-h"><b class="{cls}">{head}</b><small>{sub}</small></div><div class="items {cls}">{''.join(card(*it) for it in its)}</div></div>'''
        bosses += f'''<section class="gb"><div class="gb-head"><img src="{boss_img[key]}" alt=""><div><span class="wv">{E(where.upper())}</span><h3>{bn}</h3><small>{E(theme)} · {len(items)} items · {nd} are defence pieces · essence <img class="essm" src="{ic[key]}" alt=""> {E(ESSENCE[key])}</small></div></div>
          {grp('g-leg', 'Legendary', 'one of these 3 drops every kill', legs)}
          {grp('g-epic', 'Epic', '1–2 of these 5 in every burst', epics)}
          {grp('g-low', 'Rare · Uncommon · Common', 'mixed in with gold and ores in the other 7–10 drops', low)}</section>'''
    return f'''
<section class="sec-head"><h2>Boss Gear</h2><span class="chip c-plan">PLANNED · A PROJECT FOR LATER</span></section>
<section class="stats" aria-label="Gear numbers">
  <div class="stat"><b>6</b><span>bosses, each with its own themed gear</span></div>
  <div class="stat"><b>15</b><span>items per boss: 3 legendary, 5 epic, 7 lower (90 in all)</span></div>
  <div class="stat"><b>10–12</b><span>items burst out of every boss kill, gold and ores included</span></div>
  <div class="stat good"><b>1</b><span>legendary every kill, but which of the 3 is random</span></div>
  <div class="stat"><b>1–2</b><span>epics per burst, from the boss's 5</span></div>
  <div class="stat good"><b>Forever</b><span>gear is kept; trading and enhancing later</span></div>
</section>
<section class="eq-how">
  <div class="box"><h2>How drops work</h2>
    <ol class="next">
      <li><span><b>A loot burst</b><small>When a boss dies it bursts into 10 to 12 items scattered round its body, each glowing in its rarity colour.</small></span></li>
      <li><span><b>1 legendary, always</b><small>Every burst has exactly 1 legendary, picked at random from the boss's 3, so each one turns up about 1 kill in 3. Seeing all 3 takes about {COLLECT3:.1f} kills on average.</small></span></li>
      <li><span><b>1–2 epics, then gear and materials</b><small>Then 1 or 2 epics from its 5. The other 7–10 are a mix: about half are rare, uncommon and common gear (each tier 3/4 as likely as the one below), half are materials: gold and ores for enhancing later.</small></span></li>
      <li><span><b>First come, first served</b><small>Run over and grab them before they fade (about 30s). With 4 players everyone usually gets a few, but the legendary goes to whoever reaches it first. Just luck and fun.</small></span></li>
      <li><span><b>Pick what suits your survivor</b><small>Defence pieces (HP, armour, healing) make squishy survivors like Sienna, Raven or Dante tankier; attack pieces suit tanks. Duplicates stay in your bag for trading or enhancing later.</small></span></li>
    </ol>
  </div>
  <div class="box"><h2>Every burst</h2>{burst}<div class="od-head"><span></span><span></span><b>each item</b><small>how often it's in the burst</small></div>{odds_rows}<div class="bands">{bands}</div></div>
</section>
<section class="box matbox"><div class="grp-h"><h2>Materials</h2><small>about half of the other 7–10 drops · about {LOW_AVG * MAT_SHARE:.0f} per burst · they stack in a pouch, not a gear slot</small></div>
  <div class="items g-mat">{mats}</div>
  <div class="esslist"><small>Boss essences</small>{ess}</div>
</section>
<section class="box scrbox"><div class="grp-h"><h2>The screens (press I)</h2><small>designs made in ChatGPT · the real ones get built in code with crisp text and live numbers</small></div>
  <div class="shots">{shots}</div>
  <ul class="recent ttnotes">
    <li><span><b>Equipment tab</b><small>Your survivor in the middle with the 6 slots round them, the bag (Gear / Materials tabs) and a pouch for gold, ores and essences. Hover an item for its card. Gear changes stats only: characters look the same in game.</small></span></li>
    <li><span><b>Stats tab</b><small>Every stat as base + gear = total with a bar, the specials your gear gives you, and a collection: how many of each boss's 15 items you've found.</small></span></li>
    <li><span><b>When we build it</b><small>Collection uses the real boss portraits; the pouch shows all 6 essences (the design shows one); open with I in a match or the lobby.</small></span></li>
    <li><span><b>Kept forever, and later</b><small>Gear stays with you between matches (first in the browser, properly with logins + a database). Later: trading with friends, and enhancing +1 to +10 with ores, gold and essence.</small></span></li>
  </ul>
</section>
<section class="box ttbox"><div class="grp-h"><h2>Item card (on hover)</h2><small>our own take on the hover card: hover an item in your bag, or one on the ground after a burst</small></div>
  <div class="tts">{tips_html()}</div>
  <ul class="recent ttnotes">
    <li><span><b>Name + level</b><small>The + level sits after the name in the rarity colour; the 10 pips fill as you enhance.</small></span></li>
    <li><span><b>Compare first</b><small>Green and red arrows against what you're wearing in that slot, so you know at a glance if it's better.</small></span></li>
    <li><span><b>Stats: total, then where it comes from</b><small>The big number is your total; small grey is the base and green is what enhancing added. Each + adds 5% of the base (+10 = +50%); specials don't change.</small></span></li>
    <li><span><b>Next enhance</b><small>The cost and chance of the next +: iron ore to +4, silver to +7, titanium to +10, plus gold. Epics and legendaries also need that boss's essence from +8. A fail uses the materials, but the item never loses a level.</small></span></li>
  </ul>
</section>
<section class="sec-head"><h2>Drops by boss</h2><span>15 items each · the chance shown is how often that item is in the loot burst of a boss kill</span></section>
{bosses}'''

CSS = '''
nav.tabs { display:flex; gap:6px; flex-wrap:wrap; border-bottom:1px solid var(--line); padding-bottom:10px }
nav.tabs a { font:600 22px/1 var(--display); letter-spacing:.03em; color:var(--muted); text-decoration:none; padding:8px 14px 5px; border:1px solid var(--line); border-radius:4px; background:var(--panel) }
nav.tabs a[aria-current="page"] { color:#0b1113; background:var(--hazard); border-color:var(--hazard) }
.view { display:grid; gap:22px } .view[hidden] { display:none }
.eq-how { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:14px }
.od-head, .od { display:grid; grid-template-columns:44px minmax(0,1fr) 50px 200px; gap:10px; align-items:center }
.od-head { font:700 9.5px/1.2 var(--mono); letter-spacing:.1em; color:var(--muted); text-transform:uppercase; margin-bottom:4px }
.od-head b { font-weight:700; text-align:right } .od { padding:3px 0 } .od b { font:600 13px/1 var(--mono); text-align:right; font-variant-numeric:tabular-nums }
.od small { color:var(--muted); font:500 11px/1.2 var(--mono); font-variant-numeric:tabular-nums }
.obar { height:12px; background:#0a1012; border:1px solid #1f2d32; border-radius:2px; overflow:hidden } .obar i { display:block; height:100%; border-radius:1px }
.tb { display:inline-grid; place-items:center; min-width:36px; font:700 11px/1 var(--mono); padding:4px 0; border-radius:3px; color:#0b1113; background:var(--bc) }
.bands { display:flex; flex-wrap:wrap; gap:6px; margin-top:10px }
.band { font-size:11.5px; color:var(--muted); border:1px solid var(--line); border-left:4px solid var(--bc); border-radius:3px; padding:3px 8px } .band b { color:var(--bc); font-weight:700; margin-right:3px }
.emock { display:grid; grid-template-columns:1fr 120px 1fr; gap:10px; align-items:center; background:linear-gradient(180deg,#0d1517,#18242a); border:1px solid #1d2b30; border-radius:4px; padding:12px; max-width:440px }
.ecol { display:grid; gap:8px } .eslot { height:46px; border:1px solid #3a4c52; border-radius:4px; background:repeating-linear-gradient(135deg,#1a272b 0 6px,#1e2c31 6px 12px); display:grid; place-items:center }
.eslot b { font:700 10px/1 var(--mono); letter-spacing:.1em; color:#9fb5bb; text-transform:uppercase }
.eportrait { display:grid; gap:6px; justify-items:center } .eportrait img { width:110px; height:110px; object-fit:cover; object-position:center 20%; border-radius:4px; border:1px solid var(--line) }
.eportrait span { font-size:11px; color:var(--muted) }
.note { font-size:13px; color:var(--muted); margin:10px 0 0 } .note b { color:var(--fg); font-weight:600 }
.gb { background:var(--panel); border:1px solid var(--line); border-radius:4px; padding:14px; display:grid; gap:12px }
.gb-head { display:grid; grid-template-columns:64px minmax(0,1fr); gap:12px; align-items:center }
.gb-head img { width:64px; height:64px; object-fit:cover; object-position:center 25%; border-radius:4px; border:1px solid var(--line) }
.gb-head .wv { font:700 10px/1 var(--mono); letter-spacing:.14em; color:var(--hazard) } .gb-head h3 { font-size:34px; margin-top:3px } .gb-head small { color:var(--muted); font-size:12.5px }
.items { display:grid; grid-template-columns:repeat(auto-fill,minmax(168px,1fr)); gap:8px } .items.g-leg { grid-template-columns:repeat(3,minmax(0,1fr)) } .items.g-epic { grid-template-columns:repeat(5,minmax(0,1fr)) }
@media (min-width:1101px) { .items.g-low { grid-template-columns:repeat(7,minmax(0,1fr)) } .items.g-low .it h4 { font-size:18px } }
.grp { display:grid; gap:7px }
.mat-top { display:grid; grid-template-columns:52px minmax(0,1fr); gap:8px; align-items:center } .mat-top > img { width:52px; height:52px; filter:drop-shadow(0 3px 4px #0008) }
.mat-top .slot { font-size:9px } .mat-top h4 { margin-top:4px }
.ess6 { display:grid; grid-template-columns:repeat(3,1fr); width:52px; gap:1px } .ess6 img { width:17px; height:17px }
.esslist { display:flex; flex-wrap:wrap; gap:6px 16px; align-items:center; font-size:13px; color:var(--muted) } .esslist b { color:var(--fg); font-weight:600 } .esslist small { font:700 10px/1 var(--mono); letter-spacing:.12em; text-transform:uppercase }
.essi { display:inline-flex; align-items:center; gap:4px; white-space:nowrap } .essi img { width:22px; height:22px } .essm { width:18px; height:18px; vertical-align:-4px }
.scrbox { display:grid; gap:12px } .scrbox h2 { margin:0 }
.shots { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px } .shot { margin:0; display:grid; gap:6px } .shot img { width:100%; height:auto; border-radius:4px; border:1px solid var(--line); display:block }
.shot figcaption { font:700 10px/1 var(--mono); letter-spacing:.12em; color:var(--muted); text-transform:uppercase }
.ttbox { display:grid; gap:12px } .ttbox h2 { margin:0 }
.tts { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; align-items:start; background:repeating-linear-gradient(135deg,#0d1517 0 10px,#0f191c 10px 20px); border:1px solid #1d2b30; border-radius:4px; padding:16px }
.tt { background:linear-gradient(180deg,#151f23,#0f171a); border:1px solid #33464c; border-top:3px solid var(--bc); border-radius:6px; padding:11px 12px; display:grid; gap:8px; box-shadow:0 10px 26px #0009, 0 0 0 1px #0006; min-width:0 }
.tt-top { display:flex; justify-content:space-between; align-items:center; gap:8px } .tt-top .tb { padding:4px 7px; font-size:9.5px; letter-spacing:.06em }
.pips { display:flex; gap:3px } .pips i { width:7px; height:7px; transform:rotate(45deg); border:1px solid #4a5f66; background:transparent } .pips i.on { background:var(--bc); border-color:var(--bc); box-shadow:0 0 5px var(--bc) }
.tt h4 { margin:0; font:600 24px/1 var(--display); letter-spacing:.02em; color:var(--bc) } .tt h4 span { color:#fff; text-shadow:0 0 8px var(--bc) }
.tt-meta { font:700 9.5px/1.2 var(--mono); letter-spacing:.08em; color:var(--muted); text-transform:uppercase; margin-top:-3px }
.tt-mid { display:grid; grid-template-columns:58px minmax(0,1fr); gap:10px; align-items:start }
.tt-ic { width:58px; height:58px; display:grid; place-items:center; border:1px solid #3a4c52; border-radius:5px; background:radial-gradient(circle at 50% 40%,color-mix(in srgb,var(--bc) 22%,transparent),#0a1113 70%) }
.tt-vs small { display:block; font-size:11px; color:var(--muted); margin-bottom:3px } .tt-vs ul { list-style:none; margin:0; padding:0; display:grid; gap:2px }
.tt-vs li { font:600 12px/1.3 var(--mono) } .tt-vs li.up { color:#7fe07a } .tt-vs li.dn { color:#ff7a6b }
.tt-st { border-top:1px solid #26363b; padding-top:7px; display:grid; gap:3px }
.tt-s { display:grid; grid-template-columns:minmax(0,1fr) auto; column-gap:8px; align-items:baseline } .tt-s span { font-size:12px; color:var(--fg) } .tt-s b { font:700 15px/1 var(--mono); color:#fff; text-align:right }
.tt-s small { grid-column:2; text-align:right; font:500 10.5px/1.2 var(--mono); color:var(--muted) } .tt-s small em { font-style:normal; color:#7fe07a }
.tt-sp { border:1px solid #ffc94d55; background:#2a221033; border-radius:4px; padding:6px 8px; font-size:12px; line-height:1.35; color:#ffe2a0 } .tt-sp b { display:block; font:700 9px/1 var(--mono); letter-spacing:.12em; color:#ffc94d; margin-bottom:3px }
.tt-en { border-top:1px dashed #2c3f45; padding-top:7px; display:grid; gap:3px } .tt-en div { display:flex; gap:8px; align-items:baseline } .tt-en b { font:700 9px/1 var(--mono); letter-spacing:.12em; color:var(--hazard) }
.tt-en span { font:700 13px/1 var(--mono); color:var(--fg) } .tt-en em { font-style:normal; margin-left:auto; font:700 12px/1 var(--mono); color:#9fd0ff } .tt-en small { font-size:11.5px; color:var(--muted) }
.tt-ft { font:600 9.5px/1 var(--mono); letter-spacing:.08em; color:#5f767d; text-transform:uppercase }
.ttnotes { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px 18px } .matbox { display:grid; gap:10px } .matbox h2 { margin:0 } .items.g-mat { grid-template-columns:repeat(5,minmax(0,1fr)) } .it.mat { border-top-style:dotted } .grp-h { display:flex; flex-wrap:wrap; gap:4px 10px; align-items:baseline }
.grp-h b { font:600 20px/1 var(--display); letter-spacing:.04em } .grp-h b.g-leg { color:#ffc94d } .grp-h b.g-epic { color:#c58bff } .grp-h b.g-low { color:#9fd0ff } .grp-h small { color:var(--muted); font-size:12px }
.burst { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 12px } .burst span { display:flex; gap:7px; align-items:baseline; border:1px solid var(--line); border-left:4px solid var(--bc); border-radius:3px; padding:6px 10px; font-size:12px; color:var(--muted) }
.burst span b { font:600 22px/1 var(--display); color:var(--bc) }
.it { background:var(--panel-2); border:1px solid var(--line); border-top:3px solid var(--bc); border-radius:4px; padding:9px 10px; display:grid; gap:5px; align-content:start; min-width:0 }
.it.leg { background:linear-gradient(160deg,#2a2210,var(--panel-2) 70%); border-color:#ffc94d88; box-shadow:0 0 0 1px #ffc94d33 inset }
.it-top { display:flex; flex-wrap:wrap; gap:5px; align-items:center }
.slot { font:700 9.5px/1 var(--mono); letter-spacing:.08em; color:var(--fg); text-transform:uppercase; border:1px solid #3a4c52; border-radius:3px; padding:3px 5px }
.kd { font:700 9px/1 var(--mono); letter-spacing:.1em; color:var(--kc); margin-left:auto }
.it h4 { margin:0; font:600 20px/1 var(--display); letter-spacing:.02em; color:var(--bc) } .it p { margin:0; font-size:12px; line-height:1.4; color:var(--fg) }
.it-odds { display:flex; justify-content:space-between; align-items:baseline; border-top:1px dashed #2c3f45; padding-top:5px; margin-top:auto; font-size:11px; color:var(--muted) }
.it-odds { flex-wrap:wrap; gap:3px 6px } .it-odds b { font:700 12px/1 var(--mono); color:var(--fg); font-variant-numeric:tabular-nums; white-space:nowrap }
@media (max-width:1000px) { .tts { grid-template-columns:repeat(2,minmax(0,1fr)) } .items.g-mat { grid-template-columns:repeat(3,minmax(0,1fr)) } .items.g-epic { grid-template-columns:repeat(3,minmax(0,1fr)) } .eq-how { grid-template-columns:1fr } }
@media (max-width:640px) { .tts, .ttnotes, .shots { grid-template-columns:1fr } .tts { padding:10px } .items, .items.g-epic, .items.g-mat { grid-template-columns:repeat(2,minmax(0,1fr)) } .items.g-leg { grid-template-columns:1fr } .it h4 { font-size:18px; overflow-wrap:break-word } .od-head, .od { grid-template-columns:36px minmax(0,1fr) 56px } .od small, .od-head small { display:none } .emock { grid-template-columns:1fr 90px 1fr } .eportrait img { width:84px; height:84px } }
'''
JS = '''<script>
(function () {   // two views: the progress board and the gear plan (#equipment), picked by the link's #name
  function show() { var eq = location.hash === "#equipment"; document.getElementById("v-board").hidden = eq; document.getElementById("v-equip").hidden = !eq;
    document.querySelectorAll("nav.tabs a").forEach(function (a) { if ((a.getAttribute("href") === "#equipment") === eq) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }); }
  window.addEventListener("hashchange", function () { show(); window.scrollTo(0, 0); }); show();
})();
</script>'''
