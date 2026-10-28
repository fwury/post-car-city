// Draws what lies round the city (see world/periphery.js): the greenbelt
// with its woods and trails, the expressway and roads with their
// junctions, the industrial areas, the greenbelt's attractions, the
// park-and-rides, and the transit out to them.

const C = {
  greenbelt: '#dce9cd',
  woods: '#c6dcb1',
  trail: '#a2875f',
  expressway: '#f5d48c',
  expresswayCasing: '#d3a24f',
  median: '#cfe1b9',
  road: '#ffffff',
  roadCasing: '#cfc7b9',
  industry: '#e7e3dc',
  industryEdge: '#cfc8bd',
  street: '#fbfaf7',
  building: '#cec7bc',
  buildingEdge: '#b2aa9e',
  power: '#c9b9a8',
  attraction: { zoo: '#c3dba5', botanical: '#cde7bd', amusement: '#f1dccb', racetrack: '#e8e2d2' },
  track: '#c49c74',
  lot: '#dcd8d0',
  lotLine: '#c3beb4',
  station: '#5f676e',
};
const EXPRESSWAY = 47; // metres
const ROAD = 26;
const RAMP = 9;
const DETAIL_ZOOM = 0.05; // industrial streets and buildings from here

const cache = new WeakMap();
function pathOf(lines, closed) {
  const p = new Path2D();
  for (const L of lines) {
    if (!L || L.length < 2) continue;
    p.moveTo(L[0][0], L[0][1]);
    for (let i = 1; i < L.length; i++) p.lineTo(L[i][0], L[i][1]);
    if (closed) p.closePath();
  }
  return p;
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];

// Ramps at a junction, as curves: a trumpet's two ramps and its loop, or a
// diverging diamond's four ramps.
function rampsOf(j) {
  const p = new Path2D();
  const { p: at, along: t, road: r } = j;
  const curve = (a, c, b) => {
    p.moveTo(a[0], a[1]);
    p.quadraticCurveTo(c[0], c[1], b[0], b[1]);
  };
  for (const side of j.kind === 'ddi' ? [-1, 1] : [-1]) {
    const back = add(at, mul(r, 260 * side));
    for (const s of [-1, 1]) {
      const onExp = add(at, mul(t, 340 * s));
      curve(back, add(at, add(mul(r, 70 * side), mul(t, 110 * s))), onExp);
    }
  }
  if (j.kind === 'trumpet') {
    const c = add(at, add(mul(r, -120), mul(t, 80)));
    p.moveTo(c[0] + 65, c[1]);
    p.arc(c[0], c[1], 65, 0, Math.PI * 2);
  }
  return p;
}

function build(P) {
  let b = cache.get(P);
  if (b) return b;
  const roadLines = P.roads.map((r) => (r.on ? r.pts.concat(r.on.slice(1)) : r.pts));
  const buildings = new Path2D();
  const special = new Path2D();
  const streets = [];
  const ground = [];
  for (const a of P.industrial) {
    ground.push(a.pts);
    streets.push(...a.streets);
    for (const l of a.lots) {
      if (!l.bldg) continue;
      const path = l.use === 'powerStation' || l.use === 'waterTreatment' ? special : buildings;
      path.moveTo(l.bldg[0][0], l.bldg[0][1]);
      for (let i = 1; i < l.bldg.length; i++) path.lineTo(l.bldg[i][0], l.bldg[i][1]);
      path.closePath();
    }
  }
  const track = new Path2D();
  for (const a of P.attractions) {
    if (a.kind !== 'racetrack') continue;
    // An oval track inside the grounds.
    const [p0, p1, , p3] = a.pts;
    const ux = [(p1[0] - p0[0]) / 2, (p1[1] - p0[1]) / 2];
    const vy = [(p3[0] - p0[0]) / 2, (p3[1] - p0[1]) / 2];
    for (let k = 0; k <= 48; k++) {
      const th = (k / 48) * Math.PI * 2;
      const q = add(a.c, add(mul(ux, 0.8 * Math.cos(th)), mul(vy, 0.7 * Math.sin(th))));
      if (k === 0) track.moveTo(q[0], q[1]);
      else track.lineTo(q[0], q[1]);
    }
  }
  const stripes = new Path2D();
  for (const pr of P.parkAndRides) {
    const [a, b2, , d] = pr.lot;
    for (let k = 1; k < 8; k++) {
      const s0 = add(a, mul([d[0] - a[0], d[1] - a[1]], k / 8));
      const s1 = add(b2, mul([d[0] - a[0], d[1] - a[1]], k / 8));
      stripes.moveTo(s0[0], s0[1]);
      stripes.lineTo(s1[0], s1[1]);
    }
  }
  b = {
    belt: pathOf(P.greenbelt, true),
    woods: pathOf(P.woods, true),
    trails: pathOf(P.trails.concat(P.roads.map((r) => r.trail)), false),
    expressway: pathOf(P.expressway.map((e) => e.pts), false),
    roads: pathOf(roadLines, false),
    ramps: P.junctions.map(rampsOf),
    ground: pathOf(ground, true),
    streets: pathOf(streets, false),
    buildings,
    special,
    attractions: P.attractions.map((a) => ({ kind: a.kind, path: pathOf([a.pts], true) })),
    track,
    lots: pathOf(P.parkAndRides.map((p) => p.lot), true),
    stripes,
    metro: P.attractions.map((a) => ({ colour: a.metro.colour, path: pathOf([a.metro.pts], false) })),
  };
  cache.set(P, b);
  return b;
}

// The greenbelt (under the city's land), then everything else round it.
// ctx is set to world coordinates; px(n) gives metres for n CSS pixels.
export function drawPeriphery(ctx, P, layers, zoom, px) {
  const b = build(P);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (layers.green) {
    ctx.fillStyle = C.greenbelt;
    ctx.fill(b.belt, 'evenodd');
    ctx.fillStyle = C.woods;
    ctx.fill(b.woods);
    for (const a of b.attractions) {
      ctx.fillStyle = C.attraction[a.kind];
      ctx.fill(a.path);
    }
    ctx.strokeStyle = C.track;
    ctx.lineWidth = Math.max(14, px(1.5));
    ctx.stroke(b.track);
    if (zoom >= 0.03) {
      ctx.strokeStyle = C.trail;
      ctx.lineWidth = Math.max(3, px(1));
      ctx.setLineDash([px(4), px(3)]);
      ctx.stroke(b.trails);
      ctx.setLineDash([]);
    }
  }
  if (layers.blocks || layers.streets) {
    ctx.fillStyle = C.industry;
    ctx.fill(b.ground);
    ctx.strokeStyle = C.industryEdge;
    ctx.lineWidth = Math.max(2, px(0.8));
    ctx.stroke(b.ground);
    if (zoom >= DETAIL_ZOOM) {
      ctx.strokeStyle = C.street;
      ctx.lineWidth = 20;
      ctx.lineCap = 'butt';
      ctx.stroke(b.streets);
      ctx.lineCap = 'round';
      ctx.fillStyle = C.building;
      ctx.fill(b.buildings);
      ctx.fillStyle = C.power;
      ctx.fill(b.special);
      ctx.strokeStyle = C.buildingEdge;
      ctx.lineWidth = Math.max(1, px(0.6));
      ctx.stroke(b.buildings);
      ctx.stroke(b.special);
    }
    ctx.fillStyle = C.lot;
    ctx.fill(b.lots);
    if (zoom >= DETAIL_ZOOM) {
      ctx.strokeStyle = C.lotLine;
      ctx.lineWidth = Math.max(1, px(0.5));
      ctx.stroke(b.stripes);
    }
  }
  if (layers.streets) {
    // Casings, then fills: ramps, roads, the expressway on top.
    const w = (m, minPx) => Math.max(m, px(minPx));
    ctx.strokeStyle = C.roadCasing;
    ctx.lineWidth = w(RAMP + 4, 1.4);
    for (const r of b.ramps) ctx.stroke(r);
    ctx.lineWidth = w(ROAD + 6, 2.2);
    ctx.stroke(b.roads);
    ctx.strokeStyle = C.road;
    ctx.lineWidth = w(RAMP, 0.9);
    for (const r of b.ramps) ctx.stroke(r);
    ctx.lineWidth = w(ROAD, 1.6);
    ctx.stroke(b.roads);
    ctx.strokeStyle = C.expresswayCasing;
    ctx.lineWidth = w(EXPRESSWAY + 6, 4.6);
    ctx.stroke(b.expressway);
    ctx.strokeStyle = C.expressway;
    ctx.lineWidth = w(EXPRESSWAY, 3.4);
    ctx.stroke(b.expressway);
    if (px(1) < 6) {
      ctx.strokeStyle = C.median;
      ctx.lineWidth = 10;
      ctx.stroke(b.expressway);
    }
  }
  if (layers.transit) {
    for (const m of b.metro) {
      ctx.strokeStyle = m.colour;
      ctx.lineWidth = Math.max(8, px(2.5));
      ctx.stroke(m.path);
    }
    const dot = (q, colour, r) => {
      ctx.beginPath();
      ctx.arc(q[0], q[1], r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = r * 0.45;
      ctx.strokeStyle = colour;
      ctx.stroke();
    };
    const r = Math.max(18, px(4.5));
    for (const a of P.attractions) dot(a.station, a.metro.colour, r);
    for (const a of P.industrial) if (a.station) dot(a.station, C.station, r);
    for (const p of P.parkAndRides) dot(p.station, C.station, r);
  }
}

// Names to label, with where: industrial areas, attractions, park-and-rides.
export function peripheryLabels(P) {
  return [
    ...P.industrial.map((a) => ({ name: a.name, p: a.c, big: true })),
    ...P.attractions.map((a) => ({ name: a.name, p: a.c, big: false })),
    ...P.parkAndRides.map((a) => ({ name: a.name, p: a.c, big: false })),
  ];
}
