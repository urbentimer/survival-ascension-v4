// The city map: roads + where every map piece (building, car, tree...) stands.
// Made once on the server with a fixed seed and sent to every player (GameState.mapLayout),
// so everyone sees the same map and the server knows what is solid.
// TWO IDENTICAL COPIES: server/src/mapLayout.js and client/mapLayout.js (the client predicts your movement with the same
// collision boxes; Render can't read files outside each service's folder). Edit both; tools/test-room.mjs checks they match.
//
// Each piece: { kind, x, y, flip }  (x, y = bottom centre of its picture, i.e. where it touches the ground)

// Ground footprint of the solid pieces, relative to (x, y): centre offset ox/oy and half-width/height.
// ox is mirrored when the piece is flipped. Pieces not listed here (blood, manhole) can be walked over.
export const MAP_SOLID = {
  building:    { ox: 0,   oy: -60, hw: 76, hh: 52 },
  ruin:        { ox: 0,   oy: -36, hw: 64, hh: 28 },
  car:         { ox: 0,   oy: -44, hw: 40, hh: 30 },
  burntCar:    { ox: 2,   oy: -40, hw: 40, hh: 26 },
  police:      { ox: 4,   oy: -42, hw: 44, hh: 28 },
  bus:         { ox: 0,   oy: -56, hw: 62, hh: 40 },
  dumpster:    { ox: 0,   oy: -24, hw: 34, hh: 16 },
  rubble:      { ox: 0,   oy: -22, hw: 32, hh: 14 },
  tree:        { ox: -2,  oy: -12, hw: 13, hh: 9 },
  streetlight: { ox: -18, oy: -14, hw: 8,  hh: 7 },
};
// how much room each piece needs around it when placing (bigger = more spacing)
export const MAP_FOOT = { car: 46, burntCar: 44, bus: 70, police: 46, building: 92, ruin: 86, streetlight: 26, dumpster: 36, blood: 26, manhole: 22, rubble: 40, tree: 40 };
export const MAP_FLAT = { blood: 1, manhole: 1, dBlood: 1, dManhole: 1, dPuddle: 1, dPetals: 1 };
// city pieces first (their index is what packLayout sends: never reorder), then the Fallen Dynasty pieces ("d...")
export const MAP_KINDS = ["car", "burntCar", "bus", "police", "building", "ruin", "streetlight", "dumpster", "blood", "manhole", "rubble", "tree",
  "dShop", "dShopBurnt", "dApartment", "dRuin", "dGate", "dWall", "dPavilion", "dPagoda", "dFountain", "dMarket", "dSandbags", "dLion",
  "dTruck", "dTaxi", "dBurntCar", "dBus", "dCherry", "dBamboo", "dDeadTree", "dBonsai", "dLamp", "dLanterns", "dBanner", "dStoneLamp",
  "dCrates", "dBarrels", "dRubble", "dCart", "dBlood", "dManhole", "dPuddle", "dPetals"];

// ---------- FALLEN DYNASTY (grid map, Nov 5): the same kind of map as the city, built from pieces (art: tools/extract-dynasty.py) ----------
// Sprite sizes (game px) and solid footprints {ox, oy, hw, hh} from the bottom centre (a list = several boxes, e.g. the gate's two walls).
export const DYN_SIZE = { dShop: [400, 392], dShopBurnt: [400, 407], dApartment: [380, 406], dRuin: [360, 362], dGate: [640, 301], dWall: [520, 210],
  dPavilion: [300, 311], dPagoda: [330, 518], dFountain: [360, 349], dMarket: [210, 145], dSandbags: [200, 81], dLion: [100, 144], dTruck: [240, 122],
  dTaxi: [170, 77], dBurntCar: [170, 73], dBus: [270, 122], dCherry: [170, 157], dBamboo: [110, 133], dDeadTree: [150, 137], dBonsai: [90, 99],
  dLamp: [90, 179], dLanterns: [190, 123], dBanner: [90, 186], dStoneLamp: [64, 96], dCrates: [110, 92], dBarrels: [100, 79], dRubble: [120, 90],
  dCart: [130, 79], dBlood: [90, 65], dManhole: [70, 60], dPuddle: [120, 67], dPetals: [110, 73] };
Object.assign(MAP_SOLID, {
  dShop: { ox: 0, oy: -125, hw: 168, hh: 105 }, dShopBurnt: { ox: 0, oy: -125, hw: 168, hh: 105 }, dApartment: { ox: 0, oy: -140, hw: 168, hh: 120 },
  dRuin: { ox: 0, oy: -110, hw: 158, hh: 90 }, dPavilion: { ox: 0, oy: -90, hw: 125, hh: 75 }, dPagoda: { ox: 0, oy: -110, hw: 140, hh: 95 },
  dFountain: { ox: 0, oy: -100, hw: 160, hh: 85 }, dWall: { ox: 0, oy: -40, hw: 258, hh: 32 },
  dGate: [{ ox: -212, oy: -40, hw: 108, hh: 32 }, { ox: 212, oy: -40, hw: 108, hh: 32 }],   // the arch in the middle is open
  dMarket: { ox: 0, oy: -40, hw: 95, hh: 32 }, dSandbags: { ox: 0, oy: -25, hw: 95, hh: 18 }, dLion: { ox: 0, oy: -25, hw: 40, hh: 20 },
  dTruck: { ox: 0, oy: -35, hw: 112, hh: 28 }, dTaxi: { ox: 0, oy: -25, hw: 80, hh: 20 }, dBurntCar: { ox: 0, oy: -24, hw: 80, hh: 20 },
  dBus: { ox: 0, oy: -38, hw: 128, hh: 30 }, dCherry: { ox: 0, oy: -14, hw: 16, hh: 10 }, dBamboo: { ox: 0, oy: -14, hw: 30, hh: 12 },
  dDeadTree: { ox: 0, oy: -14, hw: 16, hh: 10 }, dBonsai: { ox: 0, oy: -18, hw: 30, hh: 14 }, dLamp: { ox: -24, oy: -8, hw: 8, hh: 6 },
  dBanner: { ox: -28, oy: -8, hw: 8, hh: 6 }, dStoneLamp: { ox: 0, oy: -12, hw: 18, hh: 10 }, dCrates: { ox: 0, oy: -28, hw: 48, hh: 24 },
  dBarrels: { ox: 0, oy: -22, hw: 42, hh: 18 }, dRubble: { ox: 0, oy: -24, hw: 50, hh: 18 }, dCart: { ox: 0, oy: -22, hw: 55, hh: 18 } });
const solidList = k => { const s = MAP_SOLID[k]; return !s ? [] : Array.isArray(s) ? s : [s]; };

// The ground: grass everywhere, then these rectangles {x, y, w, h, tile} (tiles: asphalt, plaza, cobble). Roads only run straight.
export function dynastyGround(WW, WH) {
  const cx = WW / 2, cy = WH / 2, R = [];
  const hRoad = (y, h, tile) => R.push({ x: 0, y: y - h / 2, w: WW, h, tile, road: 1 }), vRoad = (x, w, tile, y0 = 0) => R.push({ x: x - w / 2, y: y0, w, h: WH - y0, tile, road: 1 });
  R.push({ x: cx - 760, y: 300, w: 1520, h: 270, tile: "plaza" });                         // temple courtyard inside the gate
  R.push({ x: cx - 1220, y: cy - 680, w: 740, h: 560, tile: "plaza" });                    // the dragon fountain's courtyard
  R.push({ x: cx - 440, y: cy - 330, w: 880, h: 650, tile: "plaza" });                     // the radio tower's square
  hRoad(cy - 760, 120, "cobble"); hRoad(cy + 780, 120, "cobble");                          // side streets
  vRoad(cx - 1300, 120, "cobble", 270); vRoad(cx + 1300, 120, "cobble", 270);
  hRoad(cy, 170, "asphalt"); vRoad(cx, 180, "asphalt");                                    // the two avenues (the N-S one runs out through the gate)
  return R;
}

export function buildDynastyLayout(WW, WH, start = 8888) {
  let seed = start; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pick = a => a[Math.floor(rnd() * a.length)];
  const cx = WW / 2, cy = WH / 2, out = [], boxes = [], G = dynastyGround(WW, WH), roads = G.filter(g => g.road), plazas = G.filter(g => !g.road);
  const bx = (k, x, y, flip) => solidList(k).map(s => ({ x0: x + (flip ? -s.ox : s.ox) - s.hw, x1: x + (flip ? -s.ox : s.ox) + s.hw, y0: y + s.oy - s.hh, y1: y + s.oy + s.hh }));
  const hit = (a, r, m) => a.x0 < r.x + r.w + m && a.x1 > r.x - m && a.y0 < r.y + r.h + m && a.y1 > r.y - m;
  const over = (a, b, m) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.y0 < b.y1 + m && a.y1 > b.y0 - m;
  // place a piece if its footprint keeps clear of roads / plazas / other pieces (gap: a boss must fit between big things)
  const add = (k, x, y, o = {}) => {
    x = Math.round(x); y = Math.round(y); const flip = o.flip ?? false, b = bx(k, x, y, flip), gap = o.gap ?? 34, [w, h] = DYN_SIZE[k];
    if (!o.force) {
      if (x - w / 2 < -40 || x + w / 2 > WW + 40 || y > WH - 4 || y - h < -60) return false;
      if (Math.hypot(x - cx, y - cy) < 400) return false;                                   // the tower square stays open
      if (b.some(q => roads.some(r => hit(q, r, o.onRoad ? -1e9 : 6)) || (!o.inPlaza && plazas.some(r => hit(q, r, 4))))) return false;
      if (b.some(q => boxes.some(z => over(q, z, gap)))) return false;
      if (MAP_FLAT[k] && out.some(d => Math.hypot(d.x - x, d.y - y) < 60)) return false;
    }
    out.push({ kind: k, x, y, flip }); boxes.push(...b); return true;
  };
  // the city wall along the top with the temple gate where the avenue leaves the map, stone lions guarding it
  add("dGate", cx, 290, { force: true });
  for (let x = cx - 320 - 260; x > -260; x -= 520) add("dWall", x, 270, { force: true });
  for (let x = cx + 320 + 260; x < WW + 260; x += 520) add("dWall", x, 270, { force: true });
  add("dLion", cx - 170, 400, { inPlaza: true }); add("dLion", cx + 170, 400, { inPlaza: true, flip: true });
  add("dPagoda", cx - 560, 560, { inPlaza: true }); add("dPagoda", cx + 560, 560, { inPlaza: true });
  for (const x of [cx - 330, cx + 330]) add("dStoneLamp", x, 470, { inPlaza: true });
  // the dragon fountain courtyard: fountain, cherry trees, bamboo, stone lanterns; pavilions in the temple grounds by the wall
  const fx = cx - 850, fy = cy - 330;
  add("dFountain", fx, fy, { inPlaza: true });
  for (const [dx, dy] of [[-280, -170], [280, -170], [-290, 40], [290, 40], [-250, 200], [250, 200]]) add(Math.abs(dy) > 100 ? "dCherry" : "dBamboo", fx + dx, fy + dy, { inPlaza: true, gap: 16 });
  for (const dx of [-110, 110]) add("dStoneLamp", fx + dx, fy + 140, { inPlaza: true, gap: 16 });
  for (const x of [cx - 1050, cx + 1050]) add("dPavilion", x, 560, { gap: 20 });
  // the tower square: lantern lamps round it, sandbag lines
  for (const [dx, dy] of [[-420, -300], [420, -300], [-420, 300], [420, 300]]) add("dLamp", cx + dx, cy + dy, { inPlaza: true, gap: 10, flip: dx > 0 });
  for (const [dx, dy] of [[-300, -200], [300, -200], [-300, 250], [300, 250]]) add("dSandbags", cx + dx, cy + dy, { force: true });
  // lantern strings over the market avenue (walk under them) and lamps along it
  for (let y = cy + 260; y < WH - 80; y += 210) out.push({ kind: "dLanterns", x: cx, y, flip: false });
  for (let y = cy - 380; y > 680; y -= 190) out.push({ kind: "dLanterns", x: cx, y, flip: false });
  // the blocks between the roads: a row of big buildings facing the road below them, then smaller things in front / between
  const xs = [0, cx - 1360, cx - 1240, cx - 90, cx + 90, cx + 1240, cx + 1360, WW], ys = [300, cy - 820, cy - 700, cy - 85, cy + 85, cy + 720, cy + 840, WH];
  const BIG = ["dShop", "dShop", "dShop", "dShopBurnt", "dShopBurnt", "dApartment", "dApartment", "dRuin", "dRuin", "dPavilion", "dMarket"];
  for (let r = 0; r < ys.length; r += 2) for (let c = 0; c < xs.length; c += 2) {
    const x0 = xs[c] + 20, x1 = xs[c + 1] - 20, y0 = ys[r] + 10, y1 = ys[r + 1] - 14; if (x1 - x0 < 150 || y1 - y0 < 150) continue;
    for (let x = x0; x < x1;) {   // the row of buildings, bottoms just above the road below
      const k = pick(BIG), [w, h] = DYN_SIZE[k];
      if (h > y1 - y0 + 150 || x + w > x1 + 30) { x += 60; continue; }
      if (add(k, x + w / 2, y1 - rnd() * 14, { flip: rnd() < .5 && k !== "dApartment", gap: 44 })) x += w + 60 + rnd() * 60; else x += 40;
    }
    for (let i = 0, t = 0; i < (x1 - x0) / 95 && t < 300; t++) {   // trees, crates, carts... wherever there's room
      const k = pick(["dCherry", "dCherry", "dBamboo", "dBamboo", "dDeadTree", "dBonsai", "dCrates", "dBarrels", "dRubble", "dCart", "dMarket", "dStoneLamp"]);
      if (add(k, x0 + rnd() * (x1 - x0), y0 + 40 + rnd() * (y1 - y0 - 40), { flip: rnd() < .5, gap: 26 })) i++;
    }
  }
  // wrecks along the edges of the east-west roads (lanes stay open), lamps along all roads
  for (const r of roads) {
    const horiz = r.w > r.h;
    if (horiz) for (let i = 0, t = 0; i < (r.h > 150 ? 9 : 5) && t < 200; t++) {
      const k = pick(["dTaxi", "dTaxi", "dBurntCar", "dBurntCar", "dTruck", "dBus"]), y = r.y + (rnd() < .5 ? 28 : r.h - 6);
      if (add(k, 120 + rnd() * (WW - 240), y, { onRoad: true, flip: rnd() < .5, gap: 70 })) i++;
    }
    for (let p = 260, side = 1; p < (horiz ? WW : WH) - 120; p += 330, side = -side) {
      const x = horiz ? p : r.x + (side > 0 ? r.w + 30 : -6), y = horiz ? (side > 0 ? r.y + r.h + 40 : r.y - 6) : p;
      add(pick(["dLamp", "dLamp", "dLamp", "dBanner"]), x, y, { gap: 14, flip: side < 0 });
    }
  }
  // flat ground detail: puddles, petals, blood, drains
  for (let i = 0, t = 0; i < 70 && t < 900; t++) { const k = pick(["dPuddle", "dPuddle", "dPetals", "dPetals", "dBlood", "dManhole"]), onR = rnd() < .6, r = pick(roads);
    const x = onR ? r.x + rnd() * r.w : rnd() * WW, y = onR ? r.y + 20 + rnd() * Math.max(1, r.h - 10) : 300 + rnd() * (WH - 320);
    if (add(k, x, y, { onRoad: true, inPlaza: true, gap: 0 })) i++; }
  return out;
}

// Two main avenues through the tower, plus side streets (the client draws the same roads).
export function roads(WW, WH) {
  const cx = WW / 2, cy = WH / 2;
  return {
    h: [{ y: cy, w: 146, main: true }, { y: cy - 720, w: 96 }, { y: cy + 720, w: 96 }],
    v: [{ x: cx, w: 164, main: true }, { x: cx - 1150, w: 96 }, { x: cx + 1150, w: 96 }],
  };
}

export function buildMapLayout(WW, WH, start = 1337) {   // start = the site's seed (lobby map picker)
  let seed = start; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const R = roads(WW, WH), cx = WW / 2, cy = WH / 2, out = [];
  const roadGap = (x, y) => Math.min(...R.h.map(r => Math.abs(y - r.y) - r.w / 2), ...R.v.map(r => Math.abs(x - r.x) - r.w / 2));
  const fits = (x, y, kind) => {
    const f = MAP_FOOT[kind];
    if (x < f + 20 || x > WW - f - 20 || y < 140 || y > WH - 30) return false;
    if (Math.hypot(x - cx, y - cy) < 330 + f) return false;                         // keep the tower plaza clear
    return out.every(o => MAP_FLAT[o.kind] || MAP_FLAT[kind] || Math.hypot(o.x - x, o.y - y) > (MAP_FOOT[o.kind] + f) * 0.85);
  };
  const add = (kind, x, y, flip = rnd() < .5) => { if (fits(x, y, kind)) { out.push({ kind, x: Math.round(x), y: Math.round(y), flip }); return true; } return false; };
  // street lights along every road, alternating sides
  for (const r of R.h) for (let x = 200, side = 1; x < WW - 100; x += 380, side = -side) add("streetlight", x, r.y + side * (r.w / 2 + 16) + (side < 0 ? 0 : 30), side < 0);
  for (const r of R.v) for (let y = 260, side = 1; y < WH - 60; y += 380, side = -side) add("streetlight", r.x + side * (r.w / 2 + 22), y, side < 0);
  // buildings and ruins in the blocks between roads
  for (let gy = 230; gy < WH - 60; gy += 230) for (let gx = 150; gx < WW - 100; gx += 250) {
    const x = gx + (rnd() - .5) * 90, y = gy + (rnd() - .5) * 70;
    if (roadGap(x, y - 50) < 110) continue;
    const roll = rnd(); if (roll < .5) add("building", x, y); else if (roll < .78) add("ruin", x, y);
  }
  // wrecked vehicles on the roads (mostly near the edges, so the lanes stay open)
  for (let i = 0; i < 60; i++) {
    const kind = rnd() < .12 ? "bus" : rnd() < .4 ? "burntCar" : rnd() < .25 ? "police" : "car";
    if (rnd() < .5) { const r = R.h[Math.floor(rnd() * R.h.length)]; add(kind, 80 + rnd() * (WW - 160), r.y + (rnd() - .5) * r.w * .5 + 22); }
    else { const r = R.v[Math.floor(rnd() * R.v.length)]; add(kind, r.x + (rnd() - .5) * r.w * .4, 80 + rnd() * (WH - 160)); }
  }
  // smaller stuff everywhere
  const scatter = (kind, n, onRoad) => { for (let i = 0, tries = 0; i < n && tries < n * 30; tries++) {
    const x = 40 + rnd() * (WW - 80), y = 60 + rnd() * (WH - 100), g = roadGap(x, y);
    if (onRoad ? g < -10 : g > 30) if (add(kind, x, y)) i++; } };
  scatter("tree", 34, false); scatter("dumpster", 14, false); scatter("rubble", 30, false);
  scatter("manhole", 16, true); scatter("blood", 30, true); scatter("blood", 14, false);
  return out;
}

// Painted maps (lobby site with `painted`): ONE picture is the whole ground (client/assets/map/<art>.webp, drawn 1:1), so the
// world is the picture's size and the radio tower stands where it's painted (tower = its centre). boxes = solid ground
// footprints [x0, y0, x1, y1] of the painted buildings / walls / wrecks; spawns = where streets leave the picture (zombies
// come in there); lights = lamps that light up at night; fires / beams = animated effects (client only).
export const PAINTED = {};   // (the painted Fallen Dynasty picture was replaced by the grid-built map below, Nov 5)
export const paintedOf = site => site?.painted ? PAINTED[site.painted] : null;
// painted map -> layout pieces (invisible solid boxes)
export const paintedLayout = P => P.boxes.map(([x0, y0, x1, y1]) => ({ kind: "box", x: (x0 + x1) / 2, y: (y0 + y1) / 2, hw: (x1 - x0) / 2, hh: (y1 - y0) / 2 }));

// Solid boxes {x, y, hw, hh} (centre + half sizes) for the pieces that block movement.
export function mapBoxes(layout) {
  const boxes = [];
  for (const d of layout) {
    if (d.hw) { boxes.push({ x: d.x, y: d.y, hw: d.hw, hh: d.hh }); continue; }   // painted map box
    for (const s of solidList(d.kind)) boxes.push({ x: d.x + (d.flip ? -s.ox : s.ox), y: d.y + s.oy, hw: s.hw, hh: s.hh });
  }
  return boxes;
}

// Compact form sent to clients: "kind,x,y,flip;kind,x,y,flip;..." (kind = index in MAP_KINDS)
export const packLayout = layout => layout.map(d => `${MAP_KINDS.indexOf(d.kind)},${d.x},${d.y},${d.flip ? 1 : 0}`).join(";");
