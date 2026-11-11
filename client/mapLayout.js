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
  "dCrates", "dBarrels", "dRubble", "dCart", "dBlood", "dManhole", "dPuddle", "dPetals",
  "wLab", "wDome", "wQuarters", "wHangar", "wRig", "wPlane", "wWall", "wGate", "wLabBurnt", "wContainers", "wGenerator", "wTank", "wTankRound", "wSnowcat", "wTruck", "wForklift",
  "wBuggy", "wWatchtower", "wMast", "wDish", "wShed", "wSandbags", "wBarrier", "wCrates", "wGasRack", "wRocks", "wIce", "wPines", "wRockArch", "wFloodlight", "wLamp", "wWindsock",
  "wBeacon", "wShelf", "wPipes", "wBarrels", "wBigCrate", "wFence", "wSign", "wFlag",
  "rTowers", "rTank", "rTankBurnt", "rControl", "rPumpjack", "rTanker", "rPipeRack", "rLoading", "rPyramid", "rFlare", "rHTank", "rGenerator", "rCooler", "rSphere", "rTruck", "rDozer", "rPickup", "rContainers", "rBarrels", "rCrates", "rIbc", "rPipeBend", "rTransformer", "rLight", "rBarrier", "rPipes", "rValve", "rFence", "rSign", "rStairs", "rSpool", "rBlocks", "rSandbags", "rRubble", "rOil1", "rOil2", "rCrack", "rTracks1", "rTracks2", "rStripes", "rArrow", "rHeli", "rHazard", "rFlameMark", "rDebris", "rBlood",
  "cvHaunted", "cvFerris", "cvCarousel", "cvBigtop", "cvFunhouse", "cvBumper", "cvGate", "cvSwing", "cvStation", "cvPopcorn", "cvCandy", "cvHotdog", "cvDrinks", "cvRingToss", "cvBalloons", "cvDarts", "cvPrize", "cvFoodTrailer", "cvIceCream", "cvClaw", "cvWagon", "cvNewsVan", "cvAmbulance", "cvLightTower", "cvTicket", "cvBalloonBox", "cvSignpost", "cvLamp", "cvBanner", "cvBench", "cvBin", "cvCrates", "cvHay", "cvBarrier", "cvArrow", "cvBear", "cvJack", "cvFireworks", "cvBarrel", "cvPoster", "cvCrackM", "cvPuddle", "cvBloodM", "cvStar", "cvTickets", "cvPopSpill", "cvConfetti", "cvPrints", "cvPlanks", "cvBunting", "cvOil", "cvLeaves", "cvRope", "cvPaint", "cvMedallion", "cvSunburst"];

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

// ---------- WHITEOUT STATION (grid map, Nov 10): an Antarctic research station built as a TIGHT MAZE (art: tools/extract-whiteout.py) ----------
// Sprite sizes (game px). Footprints cover most of each sprite's height (not just its base like the older maps): in narrow lanes you
// must never be able to walk "behind" a building and vanish under its roof.
export const WO_SIZE = { wLab: [400, 355], wDome: [380, 344], wQuarters: [390, 363], wHangar: [430, 326], wRig: [440, 409], wPlane: [540, 474], wWall: [520, 161], wGate: [760, 245], wLabBurnt: [400, 361], wContainers: [210, 188], wGenerator: [150, 109], wTank: [190, 180], wTankRound: [165, 180], wSnowcat: [180, 146], wTruck: [205, 171], wForklift: [135, 117], wBuggy: [140, 107], wWatchtower: [140, 186], wMast: [100, 152], wDish: [160, 175], wShed: [200, 137], wSandbags: [190, 155], wBarrier: [150, 105], wCrates: [150, 135], wGasRack: [130, 116], wRocks: [150, 132], wIce: [150, 139], wPines: [140, 140], wRockArch: [150, 101], wFloodlight: [110, 126], wLamp: [84, 130], wWindsock: [90, 117], wBeacon: [90, 105], wShelf: [140, 138], wPipes: [140, 94], wBarrels: [110, 93], wBigCrate: [140, 115], wFence: [150, 140], wSign: [110, 115], wFlag: [90, 104] };
export const WO_KINDS = Object.keys(WO_SIZE);
const woBox = (k, wf = .45, hf = .72) => { const [w, h] = WO_SIZE[k]; return { ox: 0, oy: -Math.round((h * hf + 6) / 2), hw: Math.round(w * wf), hh: Math.round((h * hf - 6) / 2) }; };
for (const k of WO_KINDS) MAP_SOLID[k] = woBox(k);
Object.assign(MAP_SOLID, {
  wLabBurnt: { ...woBox("wLab"), ox: 0 }, wRig: woBox("wRig", .45, .68), wWall: { ox: 0, oy: -112, hw: 261, hh: 108 }, wGate: { ox: 0, oy: -112, hw: 381, hh: 108 },   // the wall is the map's top edge: solid right up to it
  wPlane: [{ ox: -150, oy: -90, hw: 115, hh: 78 }, { ox: 10, oy: -175, hw: 150, hh: 85 }, { ox: 160, oy: -260, hw: 95, hh: 60 }, { ox: -175, oy: -275, hw: 80, hh: 40 }, { ox: 190, oy: -150, hw: 75, hh: 55 }],
  wWatchtower: woBox("wWatchtower", .4, .45), wDish: woBox("wDish", .42, .5), wMast: { ox: 0, oy: -18, hw: 34, hh: 14 }, wPines: { ox: -10, oy: -14, hw: 24, hh: 11 },
  wFloodlight: { ox: 0, oy: -18, hw: 42, hh: 13 }, wLamp: { ox: -8, oy: -8, hw: 10, hh: 7 }, wWindsock: { ox: -30, oy: -8, hw: 8, hh: 6 }, wBeacon: { ox: 0, oy: -14, hw: 28, hh: 11 },
  wFence: { ox: 0, oy: -16, hw: 70, hh: 10 }, wSign: { ox: 0, oy: -12, hw: 46, hh: 8 }, wFlag: { ox: -30, oy: -8, hw: 8, hh: 6 }, wSandbags: woBox("wSandbags", .46, .5) });
// Whiteout Station is laid out ORGANICALLY (Nov 10, user: "more random, not everything along one street"): pieces are dropped at random
// spots, biggest first, and kept only if they leave a lane of at least WO_GAP to everything else (or stand close beside a building as an
// annexe, a squeeze-through gap apart), so the lanes twist between buildings of every size instead of running in straight rows.
const WO_GAP = 104, WO_SQUEEZE = 46;   // SQUEEZE: the gap left beside an annexe: a survivor fits through (user: "you can't walk between a truck and a tank"), a boss goes round   // narrowest lane: a boss's path body (radius 28, 40px path grid) always fits
// The ground: snow everywhere, then these rectangles {x, y, w, h, tile}: the tower's yard, a foundation pad under every big building, frozen ponds.
export function whiteoutGround(WW, WH, layout = []) {
  const cx = WW / 2, cy = WH / 2, R = [{ x: cx - 430, y: cy - 270, w: 860, h: 560, tile: "concrete", road: 1 }], solid = [];
  for (const d of layout) for (const s of solidList(d.kind)) { const b = { x0: d.x + (d.flip ? -s.ox : s.ox) - s.hw, x1: d.x + (d.flip ? -s.ox : s.ox) + s.hw, y0: d.y + s.oy - s.hh, y1: d.y + s.oy + s.hh }; solid.push(b);
    if (s.hw >= 150 && !/wWall|wGate|wPlane/.test(d.kind)) R.push({ x: b.x0 - 26, y: b.y0 - 20, w: b.x1 - b.x0 + 52, h: b.y1 - b.y0 + 46, tile: /Hangar|Rig|Dome/.test(d.kind) ? "metal" : "concrete", road: 1 }); }
  let seed = 77; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0, t = 0; i < 14 && t < 400; t++) { const w = 170 + rnd() * 200, h = 100 + rnd() * 90, x = 60 + rnd() * (WW - w - 120), y = 330 + rnd() * (WH - h - 380);
    if (Math.abs(x + w / 2 - cx) < 640 && Math.abs(y + h / 2 - cy) < 440) continue;
    if (solid.some(b => b.x0 < x + w + 30 && b.x1 > x - 30 && b.y0 < y + h + 30 && b.y1 > y - 30) || R.some(o => o.tile === "ice" && o.x < x + w + 60 && o.x + o.w > x - 60 && o.y < y + h + 60 && o.y + o.h > y - 60)) continue;
    R.push({ x, y, w, h, tile: "ice" }); i++; }
  return R;
}
export function buildWhiteoutLayout(WW, WH, start = 2040) {
  let seed = start; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pick = a => a[Math.floor(rnd() * a.length)];
  const cx = WW / 2, cy = WH / 2, out = [], boxes = [], G = WO_GAP, WALL_Y = 214;
  // ov = how far the picture rises above its footprint (roof, antennas): the piece BEHIND it must stand that much further back, or the roof would cover the lane
  const bx = (k, x, y, flip, id) => solidList(k).map(s => ({ x0: x + (flip ? -s.ox : s.ox) - s.hw, x1: x + (flip ? -s.ox : s.ox) + s.hw, y0: y + s.oy - s.hh, y1: y + s.oy + s.hh, id, ov: s.hw > 50 && !Array.isArray(MAP_SOLID[k]) ? Math.max(0, WO_SIZE[k][1] + s.oy - s.hh) * .8 : 0 }));
  // walkability on a 20px grid: can a body of radius R get from the tower yard to every place it fits?
  const C = 20, GW = Math.ceil(WW / C), GH = Math.ceil(WH / C);
  const sealed = R => { const g = new Uint8Array(GW * GH);
    for (const b of boxes) { const i0 = Math.max(0, Math.floor((b.x0 - R) / C)), i1 = Math.min(GW - 1, Math.floor((b.x1 + R) / C)), j0 = Math.max(0, Math.floor((b.y0 - R) / C)), j1 = Math.min(GH - 1, Math.floor((b.y1 + R) / C));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const px = i * C + C / 2, py = j * C + C / 2; if (px > b.x0 - R && px < b.x1 + R && py > b.y0 - R && py < b.y1 + R) g[j * GW + i] = 1; } }
    const q = [Math.floor((cy + 110) / C) * GW + Math.floor(cx / C)]; g[q[0]] = 2;
    for (let h = 0; h < q.length; h++) { const c = q[h], i = c % GW, j = (c - i) / GW; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= GW || b >= GH) continue; const n = b * GW + a; if (!g[n]) { g[n] = 2; q.push(n); } } }
    return g.includes(0); };
  const walkable = () => !sealed(22) && !sealed(30);   // no pocket a survivor or a boss could be shut in (or shut out of)
  const dist = (a, b) => { const dx = Math.max(a.x0 - b.x1, b.x0 - a.x1, 0), up = a.y0 - b.y1, dn = b.y0 - a.y1;   // a below b: a's roof pokes up toward b (and the other way round)
    return Math.hypot(dx, Math.max(up > 0 ? up - (dx < 60 ? a.ov : 0) : dn > 0 ? dn - (dx < 60 ? b.ov : 0) : 0, 0)); };
  const raw = (a, b) => Math.hypot(Math.max(a.x0 - b.x1, b.x0 - a.x1, 0), Math.max(a.y0 - b.y1, b.y0 - a.y1, 0));
  const inMap = (q, m) => q.x0 >= m && q.x1 <= WW - m && q.y1 <= WH - m * .6 && q.y0 >= WALL_Y + m;
  const offYard = q => !(q.x0 < cx + 500 && q.x1 > cx - 500 && q.y0 < cy + 300 + (q.ov || 0) && q.y1 > cy - 330);   // the radio tower stands in the open: nothing close beside it, and no roof poking up into its yard from below
  // gap = room to every other piece; host = the piece it may sit flush against
  const place = (k, x, y, flip, gap, host = -1, edge = 96) => {
    x = Math.round(x); y = Math.round(y); const id = out.length, b = bx(k, x, y, flip, id);
    if (!b.every(q => inMap(q, edge) && offYard(q) && boxes.every(z => z.id === host ? raw(q, z) >= WO_SQUEEZE - 4 : dist(q, z) >= gap))) return false;
    out.push({ kind: k, x, y, flip }); boxes.push(...b);
    if (!walkable()) { out.pop(); boxes.length -= b.length; return false; }
    return true;
  };
  const drop = (k, gap, flip = rnd() < .5) => place(k, 80 + rnd() * (WW - 160), WALL_Y + 90 + rnd() * (WH - WALL_Y - 110), flip, gap);
  const annexe = (k, gap, hosts) => {   // flush against one side of a building (never the plane / wall), sliding along it
    const s = MAP_SOLID[k]; if (Array.isArray(s) || !hosts.length) return false; const h = pick(hosts), side = Math.floor(rnd() * 3),   /* right, left, in front; never tucked behind (the host's roof would hide it) */ flip = rnd() < .5, ox = flip ? -s.ox : s.ox;
    const along = (a0, a1, half) => a1 - a0 > half * 2 ? a0 + half + rnd() * (a1 - a0 - half * 2) : (a0 + a1) / 2;
    const bxc = side === 0 ? h.x1 + WO_SQUEEZE + s.hw : side === 1 ? h.x0 - WO_SQUEEZE - s.hw : along(h.x0, h.x1, s.hw), byc = side === 2 ? h.y1 + WO_SQUEEZE + s.hh : along(h.y0, h.y1, s.hh);
    return place(k, bxc - ox, byc - s.oy, flip, gap, h.id);
  };
  // the perimeter wall along the top, the main gate in the middle (pieces without an id never count as hosts)
  for (const [k, x] of [["wGate", cx], ...[-1, 1].flatMap(sg => [0, 1, 2, 3, 4].map(i => ["wWall", cx + sg * (640 + i * 520)]))]) { out.push({ kind: k, x, y: WALL_Y, flip: false }); boxes.push(...bx(k, x, WALL_Y, false, -2)); }
  // landmarks, one per corner, each somewhere different inside its corner
  const corner = (k, sx, sy) => { for (let t = 0; t < 60; t++) if (place(k, cx + sx * (1050 + rnd() * 750), cy + sy * (420 + rnd() * 520) + 160, false, G + 20)) return; };
  corner("wDome", -1, -1); corner("wRig", 1, -1); corner("wPlane", -1, 1); corner("wHangar", 1, 1);
  const hostsOf = () => boxes.filter(b => b.id >= 0 && out[b.id].kind !== "wPlane" && b.x1 - b.x0 > 150);
  // big buildings anywhere they fit, some hugging the minimum gap and some standing further apart
  const BIG = ["wLab", "wLab", "wLab", "wQuarters", "wQuarters", "wLabBurnt", "wHangar"], NOFLIP = { wQuarters: 1, wHangar: 1, wLabBurnt: 1 };
  for (let t = 0; t < 2600; t++) { const k = pick(BIG); drop(k, G + (rnd() < .35 ? rnd() * 90 : rnd() * 14), !NOFLIP[k] && rnd() < .5); }
  // medium things: on their own in the gaps, or as an annexe against a building
  const MED = ["wContainers", "wContainers", "wContainers", "wTank", "wTank", "wTankRound", "wTruck", "wTruck", "wShed", "wShed", "wSnowcat", "wDish", "wWatchtower", "wSandbags"];
  for (let t = 0; t < 3600; t++) { const k = pick(MED); if (rnd() < .45) annexe(k, G, hostsOf()); else drop(k, G + rnd() * 20); }
  // small things; rocks, ice and pines take over toward the edges of the map
  const SMALL = ["wGenerator", "wCrates", "wCrates", "wGasRack", "wBigCrate", "wShelf", "wPipes", "wBarrels", "wForklift", "wBuggy", "wBarrier", "wFence"], WILD = ["wRocks", "wRocks", "wRocks", "wIce", "wIce", "wIce", "wRockArch", "wRockArch", "wPines", "wPines"];
  for (let t = 0; t < 9000; t++) {
    if (rnd() < .4) { annexe(pick(rnd() < .25 ? WILD : SMALL), G, hostsOf()); continue; }
    const x = 80 + rnd() * (WW - 160), y = WALL_Y + 90 + rnd() * (WH - WALL_Y - 110), far = Math.max(Math.abs(x - cx) / (WW / 2), Math.abs(y - cy) / (WH / 2));
    place(pick(far > .72 ? WILD : rnd() < .2 ? WILD : SMALL), x, y, rnd() < .5, G + rnd() * 16);
  }
  // lights and markers: lamps round the yard, then lamps / floodlights / beacons / flags tucked against buildings and out in the snow
  for (const [dx, dy] of [[-400, -240], [400, -240], [-400, 262], [400, 262]]) { const k = dy < 0 ? "wLamp" : "wBeacon", id = out.length; out.push({ kind: k, x: cx + dx, y: cy + dy, flip: dx > 0 }); boxes.push(...bx(k, cx + dx, cy + dy, dx > 0, id)); }
  const TINY = ["wLamp", "wLamp", "wLamp", "wFloodlight", "wBeacon", "wMast", "wWindsock", "wFlag", "wSign"];
  for (let t = 0, n = 0; t < 900 && n < 46; t++) if (rnd() < .5 ? annexe(pick(TINY), 92, hostsOf()) : place(pick(TINY), 80 + rnd() * (WW - 160), WALL_Y + 60 + rnd() * (WH - WALL_Y - 90), rnd() < .5, 100, -1, 60)) n++;
  return out;
}

// ---------- SCORCHED REFINERY (grid map, Nov 10): a desert oil refinery, bright and OPEN, with a pyramid the bosses come out of ----------
// (art: tools/extract-refinery.py). Same organic placement as Whiteout Station, with wider gaps and fewer pieces.
export const RF_SIZE = { rTowers: [430, 429], rTank: [400, 390], rTankBurnt: [400, 393], rControl: [410, 394], rPumpjack: [390, 382], rTanker: [520, 336], rPipeRack: [560, 274], rLoading: [430, 364], rPyramid: [840, 800], rFlare: [210, 262], rHTank: [215, 205], rGenerator: [200, 197], rCooler: [210, 185], rSphere: [200, 206], rTruck: [215, 169], rDozer: [195, 149], rPickup: [185, 124], rContainers: [205, 196], rBarrels: [110, 107], rCrates: [135, 118], rIbc: [120, 119], rPipeBend: [130, 111], rTransformer: [140, 148], rLight: [100, 156], rBarrier: [150, 122], rPipes: [140, 105], rValve: [130, 130], rFence: [150, 147], rSign: [105, 101], rStairs: [130, 127], rSpool: [110, 96], rBlocks: [130, 103], rSandbags: [130, 95], rRubble: [130, 102], rOil1: [150, 140], rOil2: [150, 138], rCrack: [140, 129], rTracks1: [150, 158], rTracks2: [150, 176], rStripes: [140, 83], rArrow: [150, 94], rHeli: [230, 228], rHazard: [170, 167], rFlameMark: [150, 152], rDebris: [140, 135], rBlood: [120, 109] };
export const RF_KINDS = Object.keys(RF_SIZE);
const RF_FLATS = ["rOil1", "rOil2", "rCrack", "rTracks1", "rTracks2", "rStripes", "rArrow", "rHeli", "rHazard", "rFlameMark", "rDebris", "rBlood"];   // ground marks: walked over
for (const k of RF_FLATS) MAP_FLAT[k] = 1;
const rfBox = (k, wf = .45, hf = .7) => { const [w, h] = RF_SIZE[k]; return { ox: 0, oy: -Math.round((h * hf + 6) / 2), hw: Math.round(w * wf), hh: Math.round((h * hf - 6) / 2) }; };
for (const k of RF_KINDS) if (!MAP_FLAT[k]) MAP_SOLID[k] = rfBox(k);
Object.assign(MAP_SOLID, {
  rPyramid: [{ ox: -247, oy: -255, hw: 148, hh: 195 }, { ox: 247, oy: -255, hw: 148, hh: 195 }, { ox: 0, oy: -300, hw: 100, hh: 150 }, { ox: 0, oy: -545, hw: 285, hh: 95 }, { ox: 0, oy: -710, hw: 160, hh: 70 }],   // the steps up to the doorway are open (a 200px notch): the boss walks down them
  rTowers: rfBox("rTowers", .45, .62), rPumpjack: rfBox("rPumpjack", .45, .6), rTanker: rfBox("rTanker", .46, .62), rPipeRack: rfBox("rPipeRack", .48, .6), rFlare: rfBox("rFlare", .4, .42),
  rLight: { ox: 0, oy: -16, hw: 30, hh: 11 }, rFence: { ox: 0, oy: -18, hw: 68, hh: 11 }, rSign: { ox: 0, oy: -14, hw: 40, hh: 9 }, rStairs: rfBox("rStairs", .42, .5) });
const RF_PYR_Y = 860;   // the pyramid's bottom edge; it stands in the middle of the map's top edge
// The ground: sand everywhere, then {x, y, w, h, tile}: cracked-earth patches, an asphalt road from the pyramid to the tower's yard, a concrete pad under every big structure.
export function refineryGround(WW, WH, layout = []) {
  const cx = WW / 2, cy = WH / 2, R = []; let seed = 911; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 22; i++) { const w = 260 + rnd() * 380, h = 170 + rnd() * 240; R.push({ x: 40 + rnd() * (WW - w - 80), y: 120 + rnd() * (WH - h - 160), w, h, tile: "cracked", blob: 1 }); }
  R.push({ x: cx - 150, y: RF_PYR_Y - 40, w: 300, h: cy - 250 - RF_PYR_Y + 110, tile: "asphalt", road: 1 });
  for (const d of layout) for (const s of solidList(d.kind)) if (s.hw >= 150 && d.kind !== "rPyramid") { const x0 = d.x + (d.flip ? -s.ox : s.ox) - s.hw, y0 = d.y + s.oy - s.hh;
    R.push({ x: x0 - 30, y: y0 - 16, w: s.hw * 2 + 60, h: s.hh * 2 + 52, tile: /Tanker|Loading/.test(d.kind) ? "asphalt" : "concrete", road: 1 }); }
  R.push({ x: cx - 430, y: cy - 270, w: 860, h: 560, tile: "concrete", road: 1 });
  return R;
}
export function buildRefineryLayout(WW, WH, start = 7070) {
  let seed = start; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pick = a => a[Math.floor(rnd() * a.length)];
  const cx = WW / 2, cy = WH / 2, out = [], boxes = [], G = 150, SQ = 46;   // G: open lanes; SQ: the squeeze gap beside an annexe
  const bx = (k, x, y, flip, id) => solidList(k).map(s => ({ x0: x + (flip ? -s.ox : s.ox) - s.hw, x1: x + (flip ? -s.ox : s.ox) + s.hw, y0: y + s.oy - s.hh, y1: y + s.oy + s.hh, id, ov: s.hw > 50 && !Array.isArray(MAP_SOLID[k]) ? Math.max(0, RF_SIZE[k][1] + s.oy - s.hh) * .8 : 0 }));
  const C = 20, GW = Math.ceil(WW / C), GH = Math.ceil(WH / C);
  const sealed = R => { const g = new Uint8Array(GW * GH);
    for (const b of boxes) { const i0 = Math.max(0, Math.floor((b.x0 - R) / C)), i1 = Math.min(GW - 1, Math.floor((b.x1 + R) / C)), j0 = Math.max(0, Math.floor((b.y0 - R) / C)), j1 = Math.min(GH - 1, Math.floor((b.y1 + R) / C));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const px = i * C + C / 2, py = j * C + C / 2; if (px > b.x0 - R && px < b.x1 + R && py > b.y0 - R && py < b.y1 + R) g[j * GW + i] = 1; } }
    const q = [Math.floor((cy + 110) / C) * GW + Math.floor(cx / C)]; g[q[0]] = 2;
    for (let h = 0; h < q.length; h++) { const c = q[h], i = c % GW, j = (c - i) / GW; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= GW || b >= GH) continue; const n = b * GW + a; if (!g[n]) { g[n] = 2; q.push(n); } } }
    return g.includes(0); };
  const walkable = () => !sealed(22) && !sealed(30);
  const raw = (a, b) => Math.hypot(Math.max(a.x0 - b.x1, b.x0 - a.x1, 0), Math.max(a.y0 - b.y1, b.y0 - a.y1, 0));
  const dist = (a, b) => { const dx = Math.max(a.x0 - b.x1, b.x0 - a.x1, 0), up = a.y0 - b.y1, dn = b.y0 - a.y1; return Math.hypot(dx, Math.max(up > 0 ? up - (dx < 60 ? a.ov : 0) : dn > 0 ? dn - (dx < 60 ? b.ov : 0) : 0, 0)); };
  const inMap = (q, m) => q.x0 >= m && q.x1 <= WW - m && q.y1 <= WH - m * .6 && q.y0 >= 70 + m * .4;
  const offYard = q => !(q.x0 < cx + 500 && q.x1 > cx - 500 && q.y0 < cy + 300 + (q.ov || 0) && q.y1 > cy - 330) && !(q.x0 < cx + 230 && q.x1 > cx - 230 && q.y0 < cy && q.y1 > RF_PYR_Y - 80);   // the tower's yard, and the road the bosses walk down from the pyramid
  const place = (k, x, y, flip, gap, host = -1, edge = 90) => {
    x = Math.round(x); y = Math.round(y); const id = out.length, b = bx(k, x, y, flip, id);
    if (!b.every(q => inMap(q, edge) && offYard(q) && boxes.every(z => z.id === host ? raw(q, z) >= SQ - 4 : dist(q, z) >= gap))) return false;
    out.push({ kind: k, x, y, flip }); boxes.push(...b);
    if (!walkable()) { out.pop(); boxes.length -= b.length; return false; }
    return true;
  };
  const drop = (k, gap, flip = rnd() < .5) => place(k, 80 + rnd() * (WW - 160), 160 + rnd() * (WH - 190), flip, gap);
  const annexe = (k, gap, hosts) => { const s = MAP_SOLID[k]; if (Array.isArray(s) || !hosts.length) return false; const h = pick(hosts), side = Math.floor(rnd() * 3), flip = rnd() < .5, ox = flip ? -s.ox : s.ox;
    const along = (a0, a1, half) => a1 - a0 > half * 2 ? a0 + half + rnd() * (a1 - a0 - half * 2) : (a0 + a1) / 2;
    const bxc = side === 0 ? h.x1 + SQ + s.hw : side === 1 ? h.x0 - SQ - s.hw : along(h.x0, h.x1, s.hw), byc = side === 2 ? h.y1 + SQ + s.hh : along(h.y0, h.y1, s.hh);
    return place(k, bxc - ox, byc - s.oy, flip, gap, h.id); };
  // the pyramid, top centre: the bosses come out of its doorway
  out.push({ kind: "rPyramid", x: cx, y: RF_PYR_Y, flip: false }); boxes.push(...bx("rPyramid", cx, RF_PYR_Y, false, -2));
  // landmarks, each somewhere in its own corner: distillation towers, flare stack, crashed tanker, loading station
  const corner = (k, sx, sy) => { for (let t = 0; t < 80; t++) if (place(k, cx + sx * (950 + rnd() * 900), cy + sy * (380 + rnd() * 560) + 150, false, G + 30)) return; };
  corner("rTowers", -1, -1); corner("rFlare", 1, -1); corner("rTanker", -1, 1); corner("rLoading", 1, 1);
  const hostsOf = () => boxes.filter(b => b.id >= 0 && !Array.isArray(MAP_SOLID[out[b.id].kind]) && b.x1 - b.x0 > 150);
  const NOFLIP = { rControl: 1, rLoading: 1, rTank: 1, rTankBurnt: 1 };   // (lettering)
  const BIG = ["rTank", "rTank", "rTankBurnt", "rControl", "rPumpjack", "rPumpjack", "rPipeRack", "rTowers", "rFlare"];
  for (let t = 0, n = 0; t < 1400 && n < 15; t++) { const k = pick(BIG); if (drop(k, G + 40 + rnd() * 160, !NOFLIP[k] && rnd() < .5)) n++; }
  const MED = ["rHTank", "rGenerator", "rCooler", "rSphere", "rSphere", "rTruck", "rDozer", "rPickup", "rContainers", "rContainers"];
  for (let t = 0, n = 0; t < 1600 && n < 30; t++) { const k = pick(MED); if (rnd() < .35 ? annexe(k, G, hostsOf()) : drop(k, G + rnd() * 120, k !== "rTruck" && rnd() < .5)) n++; }
  const SMALL = ["rBarrels", "rBarrels", "rCrates", "rIbc", "rPipeBend", "rTransformer", "rBarrier", "rBarrier", "rPipes", "rValve", "rFence", "rSign", "rStairs", "rSpool", "rBlocks", "rSandbags", "rRubble", "rRubble"];
  for (let t = 0, n = 0; t < 3000 && n < 70; t++) { const k = pick(SMALL); if (rnd() < .4 ? annexe(k, G - 30, hostsOf()) : place(k, 80 + rnd() * (WW - 160), 150 + rnd() * (WH - 180), k !== "rSign" && rnd() < .5, G - 30 + rnd() * 60)) n++; }
  for (const [dx, dy] of [[-400, -240], [400, -240], [-400, 262], [400, 262]]) { const id = out.length; out.push({ kind: "rLight", x: cx + dx, y: cy + dy, flip: dx > 0 }); boxes.push(...bx("rLight", cx + dx, cy + dy, dx > 0, id)); }
  for (let t = 0, n = 0; t < 500 && n < 16; t++) if (place("rLight", 80 + rnd() * (WW - 160), 150 + rnd() * (WH - 180), rnd() < .5, 110, -1, 60)) n++;
  // flat ground marks (under everything): painted ones in the yard and on the pyramid road, stains and tracks anywhere
  const flat = (k, x, y, flip = false) => out.push({ kind: k, x: Math.round(x), y: Math.round(y), flip });
  flat("rHeli", cx - 255, cy + 250); flat("rFlameMark", cx + 270, cy - 80); flat("rHazard", cx + 290, cy + 240); flat("rStripes", cx - 300, cy - 150);
  flat("rHazard", cx, RF_PYR_Y + 190);
  for (let i = 0; i < 80; i++) flat(pick(["rOil1", "rOil1", "rOil2", "rOil2", "rCrack", "rCrack", "rTracks1", "rTracks2", "rTracks1", "rTracks2", "rDebris", "rDebris", "rBlood"]), 60 + rnd() * (WW - 120), 160 + rnd() * (WH - 200), rnd() < .5);
  return out.sort((a, b) => (MAP_FLAT[b.kind] ? 1 : 0) - (MAP_FLAT[a.kind] ? 1 : 0));   // flats first (the minimap / thumbnail draw in order)
}

// ---------- MIDNIGHT CARNIVAL (grid map, Nov 10): an abandoned fairground with a RIDEABLE ROLLER COASTER looping round it ----------
// (art: tools/extract-carnival.py). Same organic placement as the refinery; the coaster track is laid first and everything keeps clear of it.
export const CV_SIZE = { cvMedallion: [520, 520], cvSunburst: [420, 420], cvHaunted: [620, 608], cvFerris: [520, 527], cvCarousel: [450, 455], cvBigtop: [520, 499], cvFunhouse: [500, 488], cvBumper: [480, 474], cvGate: [760, 372], cvSwing: [430, 427], cvStation: [540, 359], cvPopcorn: [190, 204], cvCandy: [190, 196], cvHotdog: [190, 199], cvDrinks: [190, 204], cvRingToss: [195, 203], cvBalloons: [195, 187], cvDarts: [190, 192], cvPrize: [190, 184], cvFoodTrailer: [205, 170], cvIceCream: [200, 188], cvClaw: [185, 177], cvWagon: [195, 166], cvNewsVan: [200, 186], cvAmbulance: [200, 166], cvLightTower: [150, 152], cvTicket: [140, 134], cvBalloonBox: [110, 170], cvSignpost: [120, 166], cvLamp: [110, 169], cvBanner: [125, 154], cvBench: [140, 102], cvBin: [90, 91], cvCrates: [130, 117], cvHay: [140, 114], cvBarrier: [140, 99], cvArrow: [120, 116], cvBear: [110, 107], cvJack: [100, 118], cvFireworks: [105, 110], cvBarrel: [90, 106], cvPoster: [110, 113], cvCrackM: [150, 133], cvPuddle: [160, 139], cvBloodM: [140, 128], cvStar: [190, 175], cvTickets: [130, 98], cvPopSpill: [120, 120], cvConfetti: [140, 131], cvPrints: [100, 103], cvPlanks: [140, 122], cvBunting: [140, 125], cvOil: [150, 130], cvLeaves: [130, 118], cvRope: [130, 110], cvPaint: [120, 111] };
const CV_FLATS = ["cvMedallion", "cvSunburst", "cvCrackM", "cvPuddle", "cvBloodM", "cvStar", "cvTickets", "cvPopSpill", "cvConfetti", "cvPrints", "cvPlanks", "cvBunting", "cvOil", "cvLeaves", "cvRope", "cvPaint"];
for (const k of CV_FLATS) MAP_FLAT[k] = 1;
const cvBox = (k, wf = .45, hf = .68) => { const [w, h] = CV_SIZE[k]; return { ox: 0, oy: -Math.round((h * hf + 6) / 2), hw: Math.round(w * wf), hh: Math.round((h * hf - 6) / 2) }; };
for (const k of Object.keys(CV_SIZE)) if (!MAP_FLAT[k]) MAP_SOLID[k] = cvBox(k);
Object.assign(MAP_SOLID, {
  cvHaunted: [{ ox: -215, oy: -190, hw: 95, hh: 170 }, { ox: 215, oy: -190, hw: 95, hh: 170 }, { ox: 0, oy: -245, hw: 120, hh: 115 }, { ox: 0, oy: -450, hw: 260, hh: 90 }],   // the steps up to its doorway are open: the bosses walk down them
  // the station: you walk up its steps onto the platform (open: the stairs in the middle and the deck); solid: the skirts either side of the stairs, the back (where the train runs), the ends, the booth
  cvStation: [{ ox: -172, oy: -53, hw: 80, hh: 47 }, { ox: 172, oy: -53, hw: 80, hh: 47 }, { ox: 0, oy: -180, hw: 253, hh: 20 }, { ox: -251, oy: -130, hw: 6, hh: 30 }, { ox: 251, oy: -130, hw: 6, hh: 30 }, { ox: -164, oy: -146, hw: 53, hh: 14 }],
  cvGate: [{ ox: -255, oy: -70, hw: 125, hh: 60 }, { ox: 255, oy: -70, hw: 125, hh: 60 }],   // walk through under the arch
  cvFerris: cvBox("cvFerris", .46, .3), cvSwing: cvBox("cvSwing", .32, .4), cvBigtop: cvBox("cvBigtop", .46, .6), cvCarousel: cvBox("cvCarousel", .46, .55),
  cvLamp: { ox: 0, oy: -10, hw: 14, hh: 8 }, cvSignpost: { ox: 0, oy: -10, hw: 14, hh: 8 }, cvBanner: { ox: 0, oy: -10, hw: 50, hh: 8 }, cvBarrier: { ox: 0, oy: -14, hw: 62, hh: 10 },
  cvArrow: { ox: 0, oy: -14, hw: 44, hh: 10 }, cvPoster: { ox: 0, oy: -14, hw: 40, hh: 10 }, cvLightTower: { ox: 0, oy: -22, hw: 58, hh: 16 }, cvBalloonBox: { ox: 0, oy: -14, hw: 22, hh: 12 } });
// The coaster. speed px/s, gap between carts, H = how high the rails are drawn above the ground, wait = seconds stopped at a station, cd = seconds before you can ride again.
export const COASTER = { speed: 290, gap: 84, H: 70, wait: 8, cd: 60, seats: 8, carts: 4 };
export function coasterTrack(WW, WH) {   // a closed loop round the park, ANTI-CLOCKWISE on screen, bending in and out; points 24px apart: {x, y (on the ground under the rails), s}
  const cx = WW / 2, cy = WH / 2 + 60, A = WW * .36, B = WH * .24, N = 1440, raw = [];
  for (let i = 0; i <= N; i++) { const th = i / N * Math.PI * 2, c = Math.cos(th), s = Math.sin(th), w = 1 + .07 * Math.sin(3 * th + .6) + .05 * Math.sin(5 * th + 2.1) + .045 * Math.sin(9 * th + 4);
    raw.push({ x: cx + A * w * Math.sign(c) * Math.abs(c) ** .62, y: cy - B * w * Math.sign(s) * Math.abs(s) ** .62, th }); }
  const step = 24, pts = [{ x: raw[0].x, y: raw[0].y, th: 0, s: 0 }]; let acc = 0, total = 0;
  for (let i = 1; i < raw.length; i++) { const a = raw[i - 1], b = raw[i], d = Math.hypot(b.x - a.x, b.y - a.y); let from = 0;
    while (acc + (d - from) >= step) { from += step - acc; acc = 0; total += step; const k = from / d; pts.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, th: a.th + (b.th - a.th) * k, s: total }); }
    acc += d - from; }
  const L = pts.length * step, near = th => pts.reduce((best, p) => Math.abs(p.th - th) < Math.abs(best.th - th) ? p : best);
  const stations = [1.5 * Math.PI - .55].map(near).map(p => ({ s: p.s, x: Math.round(p.x), y: Math.round(p.y) }));   // ONE station (user, Nov 11), on the bottom stretch left of the ticket gate
  return { pts, L, step, stations };
}
export function coasterAt(T, s) {   // where the rails are s px along the loop: {x, y (ground), a (heading)}
  s = ((s % T.L) + T.L) % T.L; const n = T.pts.length, i = Math.floor(s / T.step) % n, k = s / T.step - Math.floor(s / T.step), a = T.pts[i], b = T.pts[(i + 1) % n];
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, a: Math.atan2(b.y - a.y, b.x - a.x) };
}
export const coasterCart = (T, s, i) => { const K = T.cfg || COASTER; return coasterAt(T, s + K.gap * ((K.carts - 1) / 2 - i)); };   // cart i (0 = front) when the train's middle is at s (T.cfg: the mine train's own numbers)
export function coasterSeat(T, s, n) {   // where rider n (0..7) sits: two per cart (coaster: side by side; mine cart: one behind the other), feet just above the cart's floor (the client cuts them off at the rim)
  const K = T.cfg || COASTER, c = coasterCart(T, s, n >> 1), sd = n & 1 ? 1 : -1;
  if (K.along) return { x: c.x - Math.cos(c.a) * 17 * sd, y: c.y - K.H - 34 - Math.sin(c.a) * 9 * sd };
  return { x: c.x - Math.sin(c.a) * 13 * sd, y: c.y - K.H - 36 + Math.cos(c.a) * 3 * sd };
}
const CV_HOUSE_Y = 760;
// The ground: grass everywhere, then {x, y, w, h, tile}: dirt patches, the paved plaza and the path from the haunted house, a boardwalk under every big ride.
export function carnivalGround(WW, WH, layout = []) {
  const cx = WW / 2, cy = WH / 2, R = []; let seed = 404; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 26; i++) { const w = 260 + rnd() * 420, h = 170 + rnd() * 260; R.push({ x: 40 + rnd() * (WW - w - 80), y: 120 + rnd() * (WH - h - 160), w, h, tile: "dirt", blob: 1 }); }
  R.push({ x: cx - 150, y: CV_HOUSE_Y - 40, w: 300, h: cy - 250 - CV_HOUSE_Y + 110, tile: "paving", road: 1 });
  R.push({ x: cx - 150, y: cy + 250, w: 300, h: WH - 150 - cy - 250, tile: "paving", road: 1 });   // and on down to the ticket gate
  for (const d of layout) for (const s of solidList(d.kind)) if (s.hw >= 150 && d.kind !== "cvHaunted") { const x0 = d.x + (d.flip ? -s.ox : s.ox) - s.hw, y0 = d.y + s.oy - s.hh;
    R.push({ x: x0 - 34, y: y0 - 18, w: s.hw * 2 + 68, h: s.hh * 2 + 60, tile: d.kind === "cvStation" || d.kind === "cvBumper" ? "wood" : d.kind === "cvBigtop" || d.kind === "cvFerris" ? "dirt" : "paving", road: 1 }); }
  R.push({ x: cx - 470, y: cy - 300, w: 940, h: 620, tile: "paving", road: 1 });
  return R;
}
export function buildCarnivalLayout(WW, WH, start = 5150) {
  // SPREAD OUT like Whiteout Station (Nov 11, user): every piece dropped at a random spot, biggest first, with generous room around it.
  // Fixed: the haunted house (top centre, bosses), the ticket gate (bottom centre), the ONE coaster station. Kept open: the tower plaza,
  // the path from the haunted house down to the gate, the ground in front of the station's steps, the coaster's track.
  let seed = start; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pick = a => a[Math.floor(rnd() * a.length)];
  const cx = WW / 2, cy = WH / 2, out = [], boxes = [], T = coasterTrack(WW, WH), TP = T.pts.filter((_, i) => i % 2 === 0);
  const bx = (k, x, y, flip, id) => solidList(k).map(s => ({ x0: x + (flip ? -s.ox : s.ox) - s.hw, x1: x + (flip ? -s.ox : s.ox) + s.hw, y0: y + s.oy - s.hh, y1: y + s.oy + s.hh, id, ov: s.hw > 50 && !Array.isArray(MAP_SOLID[k]) ? Math.max(0, CV_SIZE[k][1] + s.oy - s.hh) * .8 : 0 }));
  const C = 20, GW = Math.ceil(WW / C), GH = Math.ceil(WH / C);
  const sealed = R => { const g = new Uint8Array(GW * GH);
    for (const b of boxes) { const i0 = Math.max(0, Math.floor((b.x0 - R) / C)), i1 = Math.min(GW - 1, Math.floor((b.x1 + R) / C)), j0 = Math.max(0, Math.floor((b.y0 - R) / C)), j1 = Math.min(GH - 1, Math.floor((b.y1 + R) / C));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const px = i * C + C / 2, py = j * C + C / 2; if (px > b.x0 - R && px < b.x1 + R && py > b.y0 - R && py < b.y1 + R) g[j * GW + i] = 1; } }
    const q = [Math.floor((cy + 110) / C) * GW + Math.floor(cx / C)]; g[q[0]] = 2;
    for (let h = 0; h < q.length; h++) { const c = q[h], i = c % GW, j = (c - i) / GW; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= GW || b >= GH) continue; const n = b * GW + a; if (!g[n]) { g[n] = 2; q.push(n); } } }
    return g.includes(0); };
  const walkable = () => !sealed(22) && !sealed(30);
  const dist = (a, b) => { const dx = Math.max(a.x0 - b.x1, b.x0 - a.x1, 0), up = a.y0 - b.y1, dn = b.y0 - a.y1; return Math.hypot(dx, Math.max(up > 0 ? up - (dx < 60 ? a.ov : 0) : dn > 0 ? dn - (dx < 60 ? b.ov : 0) : 0, 0)); };
  const inMap = q => q.x0 >= 70 && q.x1 <= WW - 70 && q.y1 <= WH - 40 && q.y0 >= 90;
  const st0 = T.stations[0];
  const keep = [[cx - 520, cy - 340, cx + 520, cy + 310], [cx - 210, CV_HOUSE_Y - 80, cx + 210, cy], [cx - 200, cy, cx + 200, WH - 60], [st0.x - 200, st0.y + 60, st0.x + 200, st0.y + 260]];
  const offKeep = q => !keep.some(([x0, y0, x1, y1]) => q.x0 < x1 && q.x1 > x0 && q.y0 - (y1 === cy + 310 ? q.ov || 0 : 0) < y1 && q.y1 > y0);
  const offTrack = q => !TP.some(p => Math.max(q.x0 - p.x, p.x - q.x1, 0) < 64 && p.y > q.y0 - (q.ov || 0) - 44 && p.y < q.y1 + 92);
  const place = (k, x, y, gap, flip = false) => {
    x = Math.round(x); y = Math.round(y); const id = out.length, b = bx(k, x, y, flip, id);
    if (!b.every(q => inMap(q) && offKeep(q) && offTrack(q) && boxes.every(z => dist(q, z) >= gap))) return false;
    out.push({ kind: k, x, y, flip }); boxes.push(...b);
    if (!walkable()) { out.pop(); boxes.length -= b.length; return false; }
    return true;
  };
  const drop = (k, gap, tries = 400, area = [80, 170, WW - 80, WH - 60]) => { for (let t = 0; t < tries; t++) if (place(k, area[0] + rnd() * (area[2] - area[0]), area[1] + rnd() * (area[3] - area[1]), gap)) return true; return false; };
  const fixed = (k, x, y) => { const id = out.length; out.push({ kind: k, x: Math.round(x), y: Math.round(y), flip: false }); boxes.push(...bx(k, x, y, false, id)); };
  fixed("cvHaunted", cx, CV_HOUSE_Y); fixed("cvGate", cx, WH - 70); fixed("cvStation", st0.x, st0.y + 84);
  // landmarks: the ferris wheel and the big top, each somewhere in a top corner
  drop("cvFerris", 220, 400, [150, 200, cx - 700, cy - 200]); drop("cvBigtop", 220, 400, [cx + 700, 200, WW - 150, cy - 200]);
  // the rides, one of each, then a few more where there's lots of room
  for (const k of ["cvCarousel", "cvBumper", "cvFunhouse", "cvSwing"]) drop(k, 220);
  for (const k of ["cvCarousel", "cvSwing", "cvFunhouse"]) drop(k, 260, 200);
  // stalls and trucks, each on its own with space round it
  const STALLS = ["cvPopcorn", "cvCandy", "cvHotdog", "cvDrinks", "cvRingToss", "cvBalloons", "cvDarts", "cvPrize", "cvFoodTrailer", "cvIceCream", "cvClaw", "cvWagon", "cvNewsVan", "cvAmbulance", "cvTicket"];
  for (let n = 0, t = 0; n < 34 && t < 80; t++) if (drop(STALLS[n % STALLS.length], 150, 60)) n++;
  // small props, spread thin
  const SMALL = ["cvBalloonBox", "cvSignpost", "cvBanner", "cvBench", "cvBench", "cvBin", "cvCrates", "cvHay", "cvBarrier", "cvArrow", "cvBear", "cvJack", "cvFireworks", "cvBarrel", "cvBarrel", "cvPoster"];
  for (let n = 0, t = 0; n < 60 && t < 140; t++) if (drop(pick(SMALL), 120, 50)) n++;
  // lamps round the plaza, then dotted all over
  for (const [dx, dy] of [[-440, -270], [440, -270], [-440, 285], [440, 285]]) fixed("cvLamp", cx + dx, cy + dy);
  for (let n = 0, t = 0; n < 30 && t < 80; t++) if (drop(t % 4 ? "cvLamp" : "cvLightTower", 150, 40)) n++;
  // flat things: a medallion round the tower, a sunburst before the haunted house, litter everywhere
  const flat = (k, x, y) => out.push({ kind: k, x: Math.round(x), y: Math.round(y), flip: false });
  flat("cvMedallion", cx, cy + 260); flat("cvSunburst", cx, CV_HOUSE_Y + 330);
  for (let i = 0; i < 120; i++) flat(pick(["cvConfetti", "cvConfetti", "cvTickets", "cvTickets", "cvPopSpill", "cvPrints", "cvPuddle", "cvLeaves", "cvLeaves", "cvBunting", "cvPlanks", "cvCrackM", "cvRope", "cvOil", "cvPaint"]), 60 + rnd() * (WW - 120), 170 + rnd() * (WH - 210));
  return out.sort((a, b) => (MAP_FLAT[b.kind] ? 1 : 0) - (MAP_FLAT[a.kind] ? 1 : 0) || (b.kind === "cvMedallion" || b.kind === "cvSunburst") - (a.kind === "cvMedallion" || a.kind === "cvSunburst"));   // medallions first: litter lies on top
}

// ---------- THE DEEP MINE (grid map, Nov 11): an abandoned mine deep underground, ridden on MINE CARTS ----------
// (art: tools/extract-mine.py). Top-left: the scavenge zone (cart station, radio tower, crusher, shack, collapsed tunnel, flooded pit).
// The rest: one long winding cart track (ground-level rails, drawn in code) through caves, under rock arches and over chasms on bridges,
// past the boss dungeon in the bottom-right corner (the portal, four seal crystals, the spot where the Mine Beast's statue will stand).
// Designed on a 6000 x 4000 map; every position below is in those units and scales with the map.
export const MN_SIZE = {mShaft: [520, 520], mLift: [470, 471], mStation: [600, 296], mCrusher: [450, 439], mShack: [400, 388], mCrystal: [380, 374], mCollapsed: [420, 409], mWrecks: [400, 258], mArch: [420, 273], mPortal: [560, 546], mSeal1: [149, 229], mSeal2: [148, 228], mSeal3: [150, 228], mSeal4: [149, 228], mRock1: [221, 181], mRock2: [221, 180], mRock3: [223, 180], mRock4: [215, 204], mRock5: [219, 215], mRock6: [218, 210], mRock7: [222, 201], mRock8: [159, 209], mRock9: [215, 217], mRock10: [218, 207], mRock11: [221, 189], mRock12: [221, 203], mRock13: [219, 191], mRock14: [218, 194], mRock15: [224, 197], mRock16: [226, 198], mLanternPost: [124, 143], mLanternPost2: [128, 142], mSkullSign: [132, 148], mSignpost: [132, 144], mCrystalCrate: [134, 141], mOreCart: [137, 139], mBarrel: [134, 134], mTnt: [137, 138], mToolRack: [144, 127], mWinch: [144, 128], mRopeCoil: [130, 112], mTimber: [145, 119], mOrePile: [148, 112], mCrystalSmall: [141, 137], mFloodlight: [130, 142], mBanner: [148, 137], mDrill: [223, 205], mExcavator: [221, 215], mCrystalCart: [207, 187], mLoco: [232, 209], mConveyor: [219, 216], mGenerator: [221, 207], mFan: [216, 200], mPump: [215, 192], mScaffold: [221, 217], mWinchFrame: [218, 216], mFurnace: [223, 220], mCrane: [229, 212], mTrommel: [221, 200], mSilos: [215, 213], mFuelTank: [214, 164], mCrawler: [221, 197], mPillar: [94, 180], mPillarBroken: [138, 166], mBrazier: [126, 118], mCandles: [101, 186], mGate: [177, 169], mChains: [167, 132], mCage: [161, 175], mAltar: [184, 111], mMiner: [139, 181], mMinerBroken: [153, 148], mTotem: [115, 184], mCoffin: [174, 151], mBones: [167, 115], mRuneStone: [166, 144], mOffering: [171, 133], mClawWall: [181, 156], mStones: [158, 140], mPuddles: [157, 135], mDirt: [156, 144], mShards: [156, 142], mGoldVein: [156, 136], mBlueCrack: [155, 130], mStain: [157, 135], mPlanks: [155, 151], mRopeM: [144, 138], mRocksM: [152, 136], mCrystalRocks: [157, 144], mHatch: [158, 138], mChevron: [156, 139], mGrate: [156, 141], mStripes: [156, 138],
  mChasm: [660, 250], mChasmV: [250, 620], mRuneCircle: [560, 360],   // (drawn in code: chasms, the rune circle under the statue)
  mStatue: [600, 605], mWardH: [2140, 50], mWardV: [50, 1320], mWardGate: [160, 140],
  mRune1: [74, 97], mRune2: [74, 100], mRune3: [74, 98], mRune4: [74, 101], mShrine: [190, 249], mStop: [300, 90] };   // the four rune stones (carried, drawn floating), their shrines; the boss stop's platform (drawn in code)   // the Mine Beast asleep in stone; the cordon round the dungeon (invisible walls) and the rune-ward the carts pass through (drawn in code)
export const MN_KINDS = Object.keys(MN_SIZE);
MAP_KINDS.push(...MN_KINDS);   // (appended after every older kind: their indexes never change)
const MN_FLATS = ["mStones", "mPuddles", "mDirt", "mShards", "mGoldVein", "mBlueCrack", "mStain", "mPlanks", "mRopeM", "mRocksM", "mCrystalRocks", "mHatch", "mChevron", "mGrate", "mStripes", "mRopeCoil", "mChains", "mRuneCircle", "mWardGate", "mStop"];
for (const k of MN_FLATS) MAP_FLAT[k] = 1;
const mnBox = (k, wf = .44, hf = .55) => { const [w, h] = MN_SIZE[k]; return { ox: 0, oy: -Math.round((h * hf + 6) / 2), hw: Math.round(w * wf), hh: Math.round((h * hf - 6) / 2) }; };
for (const k of MN_KINDS) if (!MAP_FLAT[k]) MAP_SOLID[k] = mnBox(k);
for (let i = 1; i <= 16; i++) MAP_SOLID["mRock" + i] = mnBox("mRock" + i, .46, .56);
Object.assign(MAP_SOLID, {
  // the cart station: you walk up its steps onto the deck (open); solid: the skirts either side of the steps, the back rail (the carts run behind it), the ends, the booth, the crates
  mStation: [{ ox: -194, oy: -48, hw: 98, hh: 48 }, { ox: 194, oy: -48, hw: 98, hh: 48 }, { ox: 0, oy: -152, hw: 292, hh: 8 }, { ox: -287, oy: -122, hw: 7, hh: 24 }, { ox: 287, oy: -122, hw: 7, hh: 24 }, { ox: -206, oy: -130, hw: 50, hh: 12 }, { ox: 210, oy: -128, hw: 40, hh: 10 }],
  // the boss shaft: the slope down from its black mouth is open (the boss walks out); the portal: its steps up to the doorway are open
  mShaft: [{ ox: -190, oy: -190, hw: 74, hh: 175 }, { ox: 190, oy: -190, hw: 74, hh: 175 }, { ox: 0, oy: -300, hw: 120, hh: 58 }],
  mPortal: [{ ox: -205, oy: -175, hw: 72, hh: 150 }, { ox: 205, oy: -175, hw: 72, hh: 150 }, { ox: 0, oy: -245, hw: 135, hh: 70 }],
  mArch: [{ ox: -152, oy: -30, hw: 56, hh: 26 }, { ox: 152, oy: -30, hw: 56, hh: 26 }],   // the track runs through the middle
  mLift: mnBox("mLift", .44, .42), mCrusher: mnBox("mCrusher", .45, .5), mShack: mnBox("mShack", .45, .52), mCrystal: mnBox("mCrystal", .42, .45), mCollapsed: mnBox("mCollapsed", .45, .5), mWrecks: mnBox("mWrecks", .44, .5),
  mSeal1: { ox: 0, oy: -30, hw: 50, hh: 26 }, mSeal2: { ox: 0, oy: -30, hw: 50, hh: 26 }, mSeal3: { ox: 0, oy: -30, hw: 50, hh: 26 }, mSeal4: { ox: 0, oy: -30, hw: 50, hh: 26 },
  mLanternPost: { ox: -10, oy: -12, hw: 16, hh: 9 }, mLanternPost2: { ox: 0, oy: -12, hw: 18, hh: 9 }, mSkullSign: { ox: 0, oy: -12, hw: 48, hh: 9 }, mSignpost: { ox: 0, oy: -12, hw: 18, hh: 9 }, mFloodlight: { ox: 0, oy: -14, hw: 34, hh: 12 }, mBanner: { ox: 0, oy: -12, hw: 58, hh: 9 },
  mPillar: { ox: 0, oy: -22, hw: 34, hh: 18 }, mCandles: { ox: 0, oy: -10, hw: 20, hh: 8 }, mTotem: { ox: 0, oy: -12, hw: 18, hh: 9 }, mBones: mnBox("mBones", .38, .45),
  mStatue: { ox: 0, oy: -150, hw: 282, hh: 140 },   // its plinth and body
  mShrine: { ox: 0, oy: -34, hw: 70, hh: 30 }, mRune1: { ox: 0, oy: -6, hw: 4, hh: 4 }, mRune2: { ox: 0, oy: -6, hw: 4, hh: 4 }, mRune3: { ox: 0, oy: -6, hw: 4, hh: 4 }, mRune4: { ox: 0, oy: -6, hw: 4, hh: 4 },
  mWardH: { ox: 0, oy: -25, hw: 1075, hh: 25 }, mWardV: { ox: 0, oy: 0, hw: 25, hh: 660 },   // the cordon: nobody walks into the boss dungeon; only the carts go in
  mChasm: [{ ox: 0, oy: 0, hw: 300, hh: 62 }, { ox: 0, oy: 0, hw: 220, hh: 100 }], mChasmV: [{ ox: 0, oy: 0, hw: 62, hh: 285 }, { ox: 0, oy: 0, hw: 100, hh: 205 }] });   // a chasm: centre-placed, the track crosses it on a bridge
export const MINECART = { speed: 340, gap: 112, H: 0, wait: 8, cd: 45, seats: 8, carts: 4, along: 1 };   // the mine train: rails on the ground, riders sit one behind the other
export const MN_WAY = [[850, 400], [1300, 400], [1900, 360], [2600, 320], [3300, 400], [4000, 330], [4800, 420], [5500, 380], [5820, 820], [5550, 1280], [4800, 1330], [4100, 1080], [3450, 1300], [3350, 1900], [3900, 2280], [4700, 2000], [5350, 2150], [5800, 2650], [5840, 3350], [5600, 3720], [4800, 3740], [4000, 3720], [3400, 3350], [2800, 3720], [2250, 3200], [1650, 3650], [1050, 3080], [550, 3600], [220, 3250], [200, 2400], [330, 1650], [190, 950], [300, 520], [430, 400]];   // clockwise from the station: east along the top, snaking down the right, through the dungeon, back west along the bottom, up the left
export const MN_SPOT = { tower: [1450, 1330], station: [850, 565], shaft: [2450, 1080], lift: [620, 1650], collapsed: [1950, 820], crusher: [2560, 2060], shack: [820, 2220], wrecks: [1380, 830], pit: [1720, 2080],
  dungeon: [3880, 2700, 5990, 3990], portal: [5180, 3230], statue: [4520, 3170], seals: [[4060, 3010], [5600, 2960], [4080, 3480], [5560, 3480]],
  stop: [5000, 3740], shrines: [[4350, 1750], [5350, 900], [1750, 3250], [2700, 2850]] };   // stop: the carts' stop inside the boss dungeon (user, Nov 11); shrines: where the four runes wait
export function mineTrack(WW, WH) {   // one closed loop, points 24px apart: {x, y (the rails, on the ground), s}; ONE station (the cart station, top left)
  const sx = WW / 6000, sy = WH / 4000, P = MN_WAY.map(([x, y]) => [x * sx, y * sy]), n = P.length, raw = [];
  for (let i = 0; i < n; i++) { const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), .5) || 1, t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);   // centripetal Catmull-Rom: smooth, no loops or cusps
    for (let k = 0; k < 60; k++) { const t = t1 + (t2 - t1) * k / 60, L = (a, b, ta, tb) => [a[0] * (tb - t) / (tb - ta) + b[0] * (t - ta) / (tb - ta), a[1] * (tb - t) / (tb - ta) + b[1] * (t - ta) / (tb - ta)];
      const A1 = L(p0, p1, 0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3), B1 = L(A1, A2, 0, t2), B2 = L(A2, A3, t1, t3);
      raw.push({ x: B1[0] * (t2 - t) / (t2 - t1) + B2[0] * (t - t1) / (t2 - t1), y: B1[1] * (t2 - t) / (t2 - t1) + B2[1] * (t - t1) / (t2 - t1) }); } }
  raw.push(raw[0]);
  const step = 24, pts = [{ x: raw[0].x, y: raw[0].y, s: 0 }]; let acc = 0, total = 0;
  for (let i = 1; i < raw.length; i++) { const a = raw[i - 1], b = raw[i], dd = Math.hypot(b.x - a.x, b.y - a.y); let from = 0;
    while (acc + (dd - from) >= step) { from += step - acc; acc = 0; total += step; const k = from / dd; pts.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, s: total }); }
    acc += dd - from; }
  if (Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y) < step * .5) pts.pop();
  const [bx, by] = [MN_SPOT.stop[0] * sx, MN_SPOT.stop[1] * sy], bp = pts.reduce((b, p) => Math.hypot(p.x - bx, p.y - by) < Math.hypot(b.x - bx, b.y - by) ? p : b);
  return { pts, L: pts.length * step, step, cfg: MINECART, stations: [{ s: 0, x: Math.round(P[0][0]), y: Math.round(P[0][1]), off: 1 }, { s: bp.s, x: Math.round(bp.x), y: Math.round(bp.y), off: -1, boss: 1 }] };   // off: which side you step off (1 = in front, -1 = behind the rails); boss: the stop in the dungeon (the carts wait there for whoever got off)
}
// The ground: gravel everywhere, then {x, y, w, h, tile}: slate and mud patches (soft edges), the flooded pit, plank decks under the station /
// shack / crusher / lift, and the boss dungeon's carved floor ("dungeon": drawn in code).
export function mineGround(WW, WH, layout = []) {
  const sx = WW / 6000, sy = WH / 4000, R = []; let seed = 1717; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 34; i++) { const w = 300 + rnd() * 520, h = 200 + rnd() * 320; R.push({ x: 40 + rnd() * (WW - w - 80), y: 60 + rnd() * (WH - h - 100), w, h, tile: rnd() < .78 ? "stone" : "mud", blob: 1 }); }
  const [px, py] = MN_SPOT.pit; R.push({ x: (px - 330) * sx, y: (py - 190) * sy, w: 660 * sx, h: 380 * sy, tile: "mud", blob: 1 });
  for (const d of layout) if (/^m(Station|Shack|Crusher|Lift)$/.test(d.kind)) { const [w, h] = MN_SIZE[d.kind]; R.push({ x: d.x - w * .5 - 20, y: d.y - h * .42, w: w + 40, h: h * .42 + 40, tile: "planks", road: 1 }); }
  const [x0, y0, x1, y1] = MN_SPOT.dungeon; R.push({ x: x0 * sx, y: y0 * sy, w: (x1 - x0) * sx, h: (y1 - y0) * sy, tile: "dungeon", road: 1 });
  return R;
}
export function buildMineLayout(WW, WH, start = 6060) {
  let seed = start; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, pick = a => a[Math.floor(rnd() * a.length)];
  const sx = WW / 6000, sy = WH / 4000, S = ([x, y]) => [x * sx, y * sy], out = [], boxes = [], T = mineTrack(WW, WH), TP = T.pts.filter((_, i) => i % 2 === 0);
  const [tx, ty] = S(MN_SPOT.tower), [dx0, dy0] = S(MN_SPOT.dungeon), [dx1, dy1] = S(MN_SPOT.dungeon.slice(2)), st0 = T.stations[0];
  const bx = (k, x, y, flip, id) => solidList(k).map(s => ({ x0: x + (flip ? -s.ox : s.ox) - s.hw, x1: x + (flip ? -s.ox : s.ox) + s.hw, y0: y + s.oy - s.hh, y1: y + s.oy + s.hh, id, ov: s.hw > 40 && !Array.isArray(MAP_SOLID[k]) ? Math.max(0, MN_SIZE[k][1] + s.oy - s.hh) * .8 : 0 }));
  const C = 20, GW = Math.ceil(WW / C), GH = Math.ceil(WH / C);
  const sealed = R => { const g = new Uint8Array(GW * GH);
    for (const b of boxes) { const i0 = Math.max(0, Math.floor((b.x0 - R) / C)), i1 = Math.min(GW - 1, Math.floor((b.x1 + R) / C)), j0 = Math.max(0, Math.floor((b.y0 - R) / C)), j1 = Math.min(GH - 1, Math.floor((b.y1 + R) / C));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const px = i * C + C / 2, py = j * C + C / 2; if (px > b.x0 - R && px < b.x1 + R && py > b.y0 - R && py < b.y1 + R) g[j * GW + i] = 1; } }
    const q = [Math.floor((ty + 120) / C) * GW + Math.floor(tx / C), Math.floor((T.stations[1].y - 150) / C) * GW + Math.floor(T.stations[1].x / C)]; for (const c of q) g[c] = 2;   // flood from the tower AND from the boss stop (the cordoned dungeon is reached by cart): every spot must connect to one of them
    for (let h = 0; h < q.length; h++) { const c = q[h], i = c % GW, j = (c - i) / GW; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= GW || b >= GH) continue; const n = b * GW + a; if (!g[n]) { g[n] = 2; q.push(n); } } }
    return g.includes(0); };
  const walkable = () => !sealed(22) && !sealed(30);
  const dist = (a, b) => { const dx = Math.max(a.x0 - b.x1, b.x0 - a.x1, 0), up = a.y0 - b.y1, dn = b.y0 - a.y1; return Math.hypot(dx, Math.max(up > 0 ? up - (dx < 60 ? a.ov : 0) : dn > 0 ? dn - (dx < 60 ? b.ov : 0) : 0, 0)); };
  const inMap = q => q.x0 >= 30 && q.x1 <= WW - 30 && q.y1 <= WH - 20 && q.y0 >= 40;
  const [shx, shy] = S(MN_SPOT.shaft), [ptx, pty] = S(MN_SPOT.portal), [stx, sty] = S(MN_SPOT.statue);
  const keep = [[tx - 430, ty - 320, tx + 430, ty + 300], [st0.x - 230, st0.y + 150, st0.x + 230, st0.y + 420], [shx - 190, shy - 140, shx + 190, shy + 300], [stx - 330, sty - 470, stx + 330, sty + 150], [ptx - 170, pty - 10, ptx + 170, pty + 260]];   // the tower's yard, in front of the station's steps, the boss's way out of the shaft, the statue's spot, the portal's steps
  const offKeep = q => !keep.some(([x0, y0, x1, y1], i) => q.x0 < x1 && q.x1 > x0 && q.y0 - (i === 0 ? q.ov || 0 : 0) < y1 && q.y1 > y0);
  const offTrack = q => !TP.some(p => Math.max(q.x0 - p.x, p.x - q.x1, 0) < 62 && p.y > q.y0 - (q.ov || 0) - 50 && p.y < q.y1 + 64);
  const inDungeon = q => q.x1 > dx0 && q.y1 > dy0;
  const place = (k, x, y, gap, flip = false, o = {}) => {
    x = Math.round(x); y = Math.round(y); const id = out.length, b = bx(k, x, y, flip, id);
    if (!b.every(q => (o.edge || inMap(q)) && offKeep(q) && (o.track || offTrack(q)) && (o.dungeon || !inDungeon(q)) && boxes.every(z => dist(q, z) >= gap))) return false;
    out.push({ kind: k, x, y, flip }); boxes.push(...b);
    if (!walkable()) { out.pop(); boxes.length -= b.length; return false; }
    return true;
  };
  const fixed = (k, x, y, flip = false) => { const id = out.length; out.push({ kind: k, x: Math.round(x), y: Math.round(y), flip }); boxes.push(...bx(k, Math.round(x), Math.round(y), flip, id)); };
  const drop = (k, gap, area, tries = 300, o) => { for (let t = 0; t < tries; t++) if (place(k, area[0] + rnd() * (area[2] - area[0]), area[1] + rnd() * (area[3] - area[1]), gap, !/Sign|Seal|Portal|Station/.test(k) && rnd() < .5, o)) return true; return false; };
  // the landmarks (fixed): the cart station on the track's straight, the boss shaft, the part areas
  fixed("mStation", st0.x, st0.y + 165);
  for (const [k, spot] of [["mShaft", "shaft"], ["mLift", "lift"], ["mCollapsed", "collapsed"], ["mCrusher", "crusher"], ["mShack", "shack"], ["mWrecks", "wrecks"]]) fixed(k, ...S(MN_SPOT[spot]));
  // chasms the track crosses on bridges, and rock arches it runs through (wherever it heads roughly up / down, spread out)
  fixed("mChasm", ...S([2520, 3450])); fixed("mChasmV", ...S([4400, 375])); fixed("mChasm", ...S([150, 2760]));
  const chasms = out.filter(d => /Chasm/.test(d.kind)), arches = [];
  for (let i = 0; i < T.pts.length; i++) { const a = T.pts[(i + T.pts.length - 5) % T.pts.length], b = T.pts[(i + 5) % T.pts.length], p = T.pts[i];
    if (Math.abs(b.x - a.x) > .6 * Math.abs(b.y - a.y) || p.x < 120 * sx || p.x > WW - 230 || p.y < 700 * sy || p.y > WH - 300) continue;
    if (arches.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 1150) || chasms.some(c => Math.hypot(c.x - p.x, c.y - p.y) < 560) || (p.x > dx0 - 200 && p.y > dy0 - 200) || Math.hypot(p.x - st0.x, p.y - st0.y) < 600) continue;
    arches.push({ x: p.x, y: p.y }); fixed("mArch", p.x, p.y + 34); }
  // the boss dungeon (bottom right), CORDONED OFF (user, Nov 11): a solid wall all round it; the track goes in through a rock arch in the north
  // wall and out through two pillars in the west wall, each sealed by a rune-ward only the carts pass through. Inside: the Mine Beast's
  // statue on its rune circle, the portal, four seal crystals, braziers, kneeling miners.
  const wy = dy0 + 110, wx = dx0 + 60, cross = (f) => { let best = null; for (let i = 0; i < T.pts.length; i++) { const a = T.pts[i], b = T.pts[(i + 1) % T.pts.length], c = f(a, b); if (c && (!best || c.d < best.d)) best = c; } return best; };
  const gN = cross((a, b) => (a.y - wy) * (b.y - wy) <= 0 && a.x > dx0 + 100 ? { x: a.x + (b.x - a.x) * ((wy - a.y) / ((b.y - a.y) || 1)), y: wy, d: 0 } : null);
  const gW = cross((a, b) => (a.x - wx) * (b.x - wx) <= 0 && a.y > dy0 + 100 ? { x: wx, y: a.y + (b.y - a.y) * ((wx - a.x) / ((b.x - a.x) || 1)), d: 0 } : null);
  out.push({ kind: "mRuneCircle", x: Math.round(stx), y: Math.round(sty + 30), flip: false });
  fixed("mStatue", stx, sty + 70); fixed("mPortal", ptx, pty); MN_SPOT.seals.forEach((q, i) => fixed("mSeal" + (i + 1), ...S(q)));
  for (const [x, y] of [[stx - 345, sty + 120], [stx + 345, sty + 120], [ptx - 330, pty + 70], [ptx + 330, pty + 70]]) fixed("mBrazier", x, y);
  for (const [x, y, f] of [[stx - 300, sty + 360, false], [stx - 110, sty + 420, false], [stx + 110, sty + 420, true], [stx + 300, sty + 360, true]]) fixed(rnd() < .25 ? "mMinerBroken" : "mMiner", x, y, f);
  for (const [x, y] of [[stx - 190, sty + 230], [stx + 190, sty + 230], [ptx - 230, pty + 230], [ptx + 230, pty + 230]]) fixed("mCandles", x, y);
  let wi = 0; for (let x = dx0 + 20; x < WW + 40; x += 136, wi++) { if (gN && Math.abs(x - gN.x) < 250) continue; fixed(wi % 2 ? (rnd() < .25 ? "mPillarBroken" : "mPillar") : "mClawWall", x, wy); }   // the north wall
  for (let y = wy + 140, j = 0; y < WH + 60; y += 132, j++) { if (gW && Math.abs(y - gW.y) < 150) continue; fixed(j % 2 ? "mClawWall" : rnd() < .25 ? "mPillarBroken" : "mPillar", wx, y); }   // the west wall
  if (gN) { fixed("mArch", gN.x, wy + 34); out.push({ kind: "mWardGate", x: Math.round(gN.x), y: wy + 6, flip: false }); }
  if (gW) { fixed("mPillar", wx, gW.y - 92); fixed("mPillar", wx, gW.y + 118); fixed("mTotem", wx - 70, gW.y - 150); fixed("mTotem", wx - 70, gW.y + 190); out.push({ kind: "mWardGate", x: wx, y: Math.round(gW.y), flip: true }); }
  const bs = T.stations[1]; out.push({ kind: "mStop", x: bs.x, y: bs.y - 112, flip: false }); fixed("mLanternPost2", bs.x - 175, bs.y - 46); fixed("mLanternPost2", bs.x + 175, bs.y - 46, true);   // the boss stop: a stone platform behind the rails, lanterns either side
  fixed("mWardH", (dx0 + WW) / 2 - 10, wy + 10); fixed("mWardV", wx, (wy + WH) / 2 + 10);   // the invisible walls (the pieces above are just how they look)
  const DUN = ["mCoffin", "mBones", "mBones", "mOffering", "mOffering", "mCage", "mRuneStone", "mRuneStone", "mAltar", "mGate"];
  for (const area of [[dx0 + 150, dy1 - 520, stx - 330, dy1 - 140], [ptx + 300, dy1 - 520, dx1 - 60, dy1 - 140], [dx0 + 200, dy0 + 330, stx - 380, dy0 + 700]])
    for (let n = 0, t = 0; n < 3 && t < 30; t++) if (drop(pick(DUN), 60, area, 20, { dungeon: 1 })) n++;
  const ROCK = Array.from({ length: 16 }, (_, i) => "mRock" + (i + 1));
  const ridge = (x0, y0, x1, y1, gaps) => { const n = Math.round(Math.hypot(x1 - x0, y1 - y0) / 235); for (let i = 0; i <= n; i++) { const f = i / n; if (gaps.some(g => Math.abs(f - g) < .05)) continue; place(pick(ROCK), x0 + (x1 - x0) * f + (rnd() - .5) * 40, y0 + (y1 - y0) * f + (rnd() - .5) * 50, 6, rnd() < .5); } };
  ridge(3080 * sx, 700 * sy, 3080 * sx, 2380 * sy, [.2, .55, .85]); ridge(450 * sx, 2470 * sy, 3000 * sx, 2470 * sy, [.15, .45, .75]);   // the scavenge zone's cave walls, with ways through
  // the four rune shrines, out in the caves (each rune floats over its shrine until someone takes it)
  for (const q of MN_SPOT.shrines) { const [x, y] = S(q); for (let t = 0; t < 60; t++) { const a = t * 2.4, r = t * 9; if (place("mShrine", x + Math.cos(a) * r, y + Math.sin(a) * r, 120)) break; } }
  // big crystal clusters in the open caves, machines and wrecks out along the track, a few in the scavenge zone
  const zone = [80, 80, 3050 * sx, 2350 * sy], wild = [80, 80, WW - 80, WH - 60];
  drop("mCrystal", 170, S([3900, 1500]).concat(S([5300, 1900]))); drop("mCrystal", 170, S([3500, 2500]).concat(S([4300, 3100]))); drop("mCrystal", 170, S([700, 2600]).concat(S([2600, 3100])));
  const MACH = ["mDrill", "mExcavator", "mCrystalCart", "mLoco", "mConveyor", "mGenerator", "mFan", "mPump", "mScaffold", "mWinchFrame", "mFurnace", "mCrane", "mTrommel", "mSilos", "mFuelTank", "mCrawler"];
  for (let n = 0, t = 0; n < 24 && t < 90; t++) { const k = MACH[n % MACH.length], [x, y] = [80 + rnd() * (WW - 160), 120 + rnd() * (WH - 180)]; if ((x < zone[2] && y < zone[3]) ? false : place(k, x, y, 130, rnd() < .5)) n++; }
  for (const k of ["mPump", "mGenerator", "mConveyor", "mWinchFrame", "mFuelTank", "mScaffold"]) drop(k, 130, zone, 120);
  // cave rock: walls round the edge of the map, then outcrops everywhere (never sealing anything off, never on the track)
  for (let x = 120; x < WW - 100; x += 190 + rnd() * 60) { place(pick(ROCK), x, 30 + 150 + rnd() * 30, 20, rnd() < .5, { edge: 1 }); place(pick(ROCK), x, WH - 10 - rnd() * 20, 20, rnd() < .5, { edge: 1, dungeon: x < dx0 }); }
  for (let y = 380; y < WH - 120; y += 170 + rnd() * 50) { place(pick(ROCK), 95 + rnd() * 20, y, 20, rnd() < .5, { edge: 1 }); place(pick(ROCK), WW - 95 - rnd() * 20, y, 20, rnd() < .5, { edge: 1, dungeon: y < dy0 }); }
  for (let n = 0, t = 0; n < 30 && t < 500; t++) { const x = 160 + rnd() * (WW - 320), y = 220 + rnd() * (WH - 300), inZone = x < zone[2] && y < zone[3]; if (inZone && rnd() < .7) continue;
    if (place(pick(ROCK), x, y, 150 + rnd() * 80, rnd() < .5)) { n++; const a = rnd() * Math.PI, m = 2 + Math.floor(rnd() * 3);   // an outcrop: a short line of rocks, a cave wall
      for (let j = 1; j <= m; j++) for (const sg of [1, -1]) if (rnd() < .75) place(pick(ROCK), x + Math.cos(a) * 175 * j * sg + (rnd() - .5) * 30, y + Math.sin(a) * 120 * j * sg + (rnd() - .5) * 30, 6, rnd() < .5); } }
  // lanterns along the track (the only light out on the long dark stretches), props everywhere
  for (let i = 0; i < T.pts.length; i += 22) { const p = T.pts[i], q = T.pts[(i + 1) % T.pts.length], a = Math.atan2(q.y - p.y, q.x - p.x), side = (i / 22) % 2 ? 1 : -1;
    place(rnd() < .7 ? "mLanternPost" : "mLanternPost2", p.x - Math.sin(a) * 108 * side, p.y + Math.cos(a) * 108 * side + 10, 40, side > 0); }
  const PROPS = ["mSkullSign", "mSkullSign", "mSignpost", "mCrystalCrate", "mCrystalCrate", "mOreCart", "mBarrel", "mBarrel", "mTnt", "mTnt", "mToolRack", "mWinch", "mTimber", "mTimber", "mOrePile", "mFloodlight", "mBanner"];
  for (let n = 0, t = 0; n < 40 && t < 140; t++) if (drop(pick(PROPS), 100, zone, 30)) n++;
  for (let n = 0, t = 0; n < 34 && t < 200; t++) if (drop(pick(PROPS), 140, wild, 30)) n++;
  for (let n = 0, t = 0; n < 26 && t < 200; t++) { const x = 3200 * sx + rnd() * (WW - 3300 * sx), y = 200 + rnd() * (WH - 300); if (place(rnd() < .75 ? "mCrystalSmall" : "mCrystalCrate", x, y, 90, rnd() < .5)) n++; }   // crystals glinting out in the caves
  for (const [x, y] of [[tx - 450, ty - 330], [tx + 450, ty - 330], [tx - 450, ty + 310], [tx + 450, ty + 310]]) place("mFloodlight", x, y, 30);
  // flat ground marks (under everything): puddles round the flooded pit, hazard paint by the station and the crusher, rubble and shards everywhere
  const flat = (k, x, y, flip = false) => { if (!TP.some(p => Math.abs(p.x - x) < 110 && Math.abs(p.y - y + 50) < 90) && (k === "mChains" ? Math.hypot(x - stx, (y - sty) * 1.6) > 330 : !(x > dx0 - 90 && y > dy0 - 40))) out.push({ kind: k, x: Math.round(x), y: Math.round(y), flip }); };   // (never lying across the rails; the dungeon floor stays clean: only chains on it, user Nov 11)
  const [ppx, ppy] = S(MN_SPOT.pit); for (let i = 0; i < 9; i++) flat("mPuddles", ppx + (rnd() - .5) * 560, ppy + 40 + (rnd() - .5) * 300, rnd() < .5);
  flat("mStripes", st0.x - 150, st0.y + 300); flat("mChevron", st0.x + 160, st0.y + 300); flat("mHatch", tx - 260, ty + 200); flat("mGrate", tx + 270, ty - 160);
  for (let i = 0; i < 150; i++) flat(pick(["mStones", "mStones", "mDirt", "mDirt", "mRocksM", "mRocksM", "mPlanks", "mRopeM", "mGoldVein", "mBlueCrack", "mBlueCrack", "mShards", "mCrystalRocks", "mStain", "mRopeCoil"]), 60 + rnd() * (WW - 120), 120 + rnd() * (WH - 160), rnd() < .5);
  for (let i = 0; i < 6; i++) flat("mChains", dx0 + 100 + rnd() * (dx1 - dx0 - 200), dy0 + 250 + rnd() * (dy1 - dy0 - 320), rnd() < .5);
  return out.sort((a, b) => (MAP_FLAT[b.kind] ? 1 : 0) - (MAP_FLAT[a.kind] ? 1 : 0) || (b.kind === "mRuneCircle") - (a.kind === "mRuneCircle"));   // flats first (the rune circle first of all: marks lie on top)
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
