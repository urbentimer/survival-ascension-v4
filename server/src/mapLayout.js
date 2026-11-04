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
export const MAP_FLAT = { blood: 1, manhole: 1 };
export const MAP_KINDS = ["car", "burntCar", "bus", "police", "building", "ruin", "streetlight", "dumpster", "blood", "manhole", "rubble", "tree"];

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
export const PAINTED = {
  dynasty: {
    art: "fallen-dynasty", w: 1672, h: 941, tower: [875, 805], start: [875, 600],   // start: where survivors appear (the plaza in front of the fenced tower)
    boxes: [
      [0, 0, 400, 300], [0, 300, 330, 395], [0, 395, 205, 445], [330, 300, 395, 360],            // burning tower block (top left) + rubble
      [0, 505, 225, 700], [0, 700, 240, 941], [240, 805, 470, 941],                              // hotel + pagoda houses (bottom left)
      [470, 95, 652, 185], [652, 60, 676, 195], [904, 60, 930, 195], [930, 95, 1175, 190],       // city wall + the gate's pillars
      [1170, 0, 1672, 140], [1300, 140, 1672, 258], [1545, 258, 1672, 335],   // temple + its stairs and stone lions (top right), red pavilion
      [1475, 425, 1672, 690], [1440, 720, 1672, 941], [1390, 800, 1440, 941],                    // biohazard block + pagoda shops (right)
      [790, 300, 880, 392],                                                                        // dragon statue
      [557, 212, 636, 248], [322, 518, 408, 564], [532, 452, 614, 494], [1112, 452, 1250, 500],  // wrecked cars / van / jeep
      [1172, 276, 1248, 304], [1112, 262, 1165, 290], [1357, 362, 1502, 430], [1268, 630, 1410, 700], [1022, 196, 1088, 220],   // cars, bus, army truck
      [668, 695, 692, 880], [692, 685, 1012, 702], [1000, 695, 1016, 860],                       // the tower compound's fence (open at the bottom)
    ],
    spawns: [[790, 40, 3], [20, 475, 2], [1652, 385, 2], [1240, 215, 2], [570, 926, 1], [1210, 926, 1]],   // x, y, weight
    lights: [[553, 128], [770, 240], [915, 240], [545, 460], [556, 560], [392, 642], [430, 780], [1110, 130], [1270, 250], [1440, 295], [1390, 540], [1400, 770], [742, 668], [968, 668], [1046, 740], [475, 278]],
    fires: [[135, 125, 1.1], [90, 340, .8], [330, 392, .7], [170, 650, .9], [100, 735, .8], [1550, 130, 1.1], [1525, 35, .9], [1440, 612, .9], [1190, 64, .6], [545, 58, .6]],
    beams: [[628, 262, .35], [327, 556, Math.PI - .15], [1238, 505, .3]],   // car headlights: x, y, angle
    beacons: [[859, 556], [846, 568], [887, 568], [851, 650], [895, 715]],   // the tower's red warning lights
  },
};
export const paintedOf = site => site?.painted ? PAINTED[site.painted] : null;
// painted map -> layout pieces (invisible solid boxes)
export const paintedLayout = P => P.boxes.map(([x0, y0, x1, y1]) => ({ kind: "box", x: (x0 + x1) / 2, y: (y0 + y1) / 2, hw: (x1 - x0) / 2, hh: (y1 - y0) / 2 }));

// Solid boxes {x, y, hw, hh} (centre + half sizes) for the pieces that block movement.
export function mapBoxes(layout) {
  const boxes = [];
  for (const d of layout) {
    if (d.hw) { boxes.push({ x: d.x, y: d.y, hw: d.hw, hh: d.hh }); continue; }   // painted map box
    const s = MAP_SOLID[d.kind]; if (!s) continue;
    boxes.push({ x: d.x + (d.flip ? -s.ox : s.ox), y: d.y + s.oy, hw: s.hw, hh: s.hh });
  }
  return boxes;
}

// Compact form sent to clients: "kind,x,y,flip;kind,x,y,flip;..." (kind = index in MAP_KINDS)
export const packLayout = layout => layout.map(d => `${MAP_KINDS.indexOf(d.kind)},${d.x},${d.y},${d.flip ? 1 : 0}`).join(";");
