// What lies round the city, planned once for the whole of it.
//
// A greenbelt of naturalised land, 1 to 2 km wide (the bigger the city,
// the wider), runs between the built-up edge and the expressway: woods and
// meadow with a few hiking trails, and where the city justifies them a
// large zoo, an amusement park, a botanical garden and a racetrack, each
// well back from the roads and reached by a metro line run on out to it.
// The expressway rings the city, or runs as far round it as the sea and
// mountains let it. Roads, each with a trail of its own well beside it,
// carry on from the boulevards that leave the city: some end at a trumpet
// junction on the expressway, others cross it at a diverging diamond and
// run on to an industrial area. Beyond the expressway lie the heavy
// industrial areas, about one for each 1 to 1.5 million people, each on a
// regional rail line with a station, laid out as a regular grid of streets
// for trucks. Where a rail line runs on out of the city across the
// expressway, a park-and-ride stands at a station by the crossing.

import { hash, hashString, toUnit } from '../core/hash.js';
import { fill, distanceField, contours } from '../util/raster.js';
import { simplify, chaikin, resample, polylineNormals, signedArea } from '../util/geom.js';

const CELL = 100; // metres: the planning grid
const MARGIN = 10000; // metres of country planned round the city
const GREENBELT = [1000, 2000]; // metres wide, from the smallest city to the biggest
const GREENBELT_PEOPLE = [7.5e5, 8e6];
const ROUND = 1600; // metres: notches in the city's edge the expressway rounds over
const SMOOTH = 260; // metres of wiggle taken out of the expressway's line
const TRAIL_AT = 0.45; // of the greenbelt's width out, its main trail
const SPUR_EVERY = 3000; // metres along it between trails in from the city
const WOODS_PER = 2.2e5; // m² of greenbelt to a stand of woods
const ROAD_STEP = 40; // metres between a road's points
const ROAD_TURN = 0.025; // radians a road may turn each step
const ROAD_TRAIL = 40; // metres a road's trail keeps from its centreline
const INDUSTRY_PEOPLE = 1.25e6; // people to an industrial area
const INDUSTRY_AREA = [2e6, 5e6]; // m²
const INDUSTRY_GAP = 5000; // metres between industrial areas, at least
const INDUSTRY_OUT = 900; // metres beyond the expressway an industrial area starts
const BLOCK = [260, 170]; // metres: an industrial block, along and across
const STREET = 20; // metres: an industrial street
const RAIL_STRIP = 30; // metres either side of the track kept clear
const ATTRACTIONS = [
  ['botanical', 1.5e6, [520, 380]],
  ['zoo', 2e6, [720, 520]],
  ['amusement', 2.5e6, [620, 460]],
  ['racetrack', 3e6, [820, 420]],
];
const ATTRACTION_CLEAR = 350; // metres an attraction keeps from roads
const PARK_AND_RIDE = [320, 170]; // metres: the car park

// Industrial uses: [use, weight, whole block, at most per area].
export const INDUSTRIAL_USES = [
  ['heavyManufacturing', 10, false, 99],
  ['lightManufacturing', 14, false, 99],
  ['processingPlant', 6, false, 99],
  ['distributionCentre', 12, true, 99],
  ['coldStorage', 4, false, 99],
  ['truckTerminal', 5, true, 99],
  ['storageUnits', 4, false, 99],
  ['powerStation', 1.5, true, 1],
  ['waterTreatment', 1, true, 1],
  ['wasteTransfer', 1, false, 1],
  ['recycling', 1.5, false, 1],
  ['railDepot', 2, true, 2],
  ['busBarn', 2, false, 2],
  ['dealership', 4, false, 99],
  ['dataCentre', 4, false, 99],
];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (v) => Math.hypot(v[0], v[1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const unit = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};
const perp = (v) => [-v[1], v[0]];
const lengthOf = (P) => {
  let L = 0;
  for (let i = 1; i < P.length; i++) L += len(sub(P[i], P[i - 1]));
  return L;
};
// Where segment ab first meets a polyline: { p, t } (t along ab) or null.
function meet(a, b, P) {
  let best = null;
  const r = sub(b, a);
  for (let i = 0; i + 1 < P.length; i++) {
    const q = P[i];
    const e = sub(P[i + 1], q);
    const den = r[0] * e[1] - r[1] * e[0];
    if (Math.abs(den) < 1e-9) continue;
    const w = sub(q, a);
    const t = (w[0] * e[1] - w[1] * e[0]) / den;
    const v = (w[0] * r[1] - w[1] * r[0]) / den;
    if (t >= 0 && t <= 1 && v >= 0 && v <= 1 && (!best || t < best.t)) best = { p: add(a, mul(r, t)), t, i, v };
  }
  return best;
}
const distToPolyline = (q, P) => {
  let best = Infinity;
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i];
    const ab = sub(P[i + 1], a);
    const t = Math.max(0, Math.min(1, dot(sub(q, a), ab) / (dot(ab, ab) || 1)));
    best = Math.min(best, len(sub(q, add(a, mul(ab, t)))));
  }
  return best;
};
const rect = (c, u, l, w) => {
  const v = perp(u);
  return [
    add(c, add(mul(u, -l / 2), mul(v, -w / 2))),
    add(c, add(mul(u, l / 2), mul(v, -w / 2))),
    add(c, add(mul(u, l / 2), mul(v, w / 2))),
    add(c, add(mul(u, -l / 2), mul(v, w / 2))),
  ];
};
const pointAlong = (P, s) => {
  for (let i = 1; i < P.length; i++) {
    const L = len(sub(P[i], P[i - 1]));
    if (s <= L) return add(P[i - 1], mul(sub(P[i], P[i - 1]), L ? s / L : 0));
    s -= L;
  }
  return P[P.length - 1];
};

// Gentle curves, as an expressway's are: the staircase and the city
// edge's small wiggles taken out, then rounded.
function smoothRun(P, tol) {
  let Q = resample(simplify(P, tol), tol * 2.2);
  for (let k = 0; k < 4; k++) Q = chaikin(Q, false);
  return resample(Q, 40);
}
function smoothLoop(P, tol) {
  let Q = resample(simplify(P.concat([P[0]]), tol), tol * 2.2);
  Q.pop();
  for (let k = 0; k < 4; k++) Q = chaikin(Q, true);
  return resample(Q.concat([Q[0]]), 40);
}

// rings: the city's district outlines. outLinks: boulevards out of the city
// ({ p, dir }). railTails: rail lines out into the country (polylines from
// the city outward). metroLines: { pts, colour, name }.
export function createPeriphery(seed, { terrain, population, centre, rings, outLinks, railTails, metroLines, names }) {
  const u = (...k) => toUnit(hash(seed, 'periphery', ...k));
  const G = GREENBELT[0] + (GREENBELT[1] - GREENBELT[0]) * Math.max(0, Math.min(1, (population - GREENBELT_PEOPLE[0]) / (GREENBELT_PEOPLE[1] - GREENBELT_PEOPLE[0])));

  // ---- The planning grid ----
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const R of rings) for (const [x, y] of R) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  x0 = Math.floor((x0 - MARGIN) / CELL) * CELL;
  y0 = Math.floor((y0 - MARGIN) / CELL) * CELL;
  const W = Math.ceil((x1 + MARGIN - x0) / CELL);
  const H = Math.ceil((y1 + MARGIN - y0) / CELL);
  const city = new Uint8Array(W * H);
  for (const R of rings) fill(CELL, city, W, H, x0, y0, R, 1);
  // Sea and mountains stop the expressway; rivers it bridges.
  const blocked = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = x0 + (i + 0.5) * CELL;
      const y = y0 + (j + 0.5) * CELL;
      if (terrain.isSea(x, y) || terrain.isHigh(x, y)) blocked[j * W + i] = 1;
    }
  }
  const cellOf = (q) => {
    const i = Math.floor((q[0] - x0) / CELL);
    const j = Math.floor((q[1] - y0) / CELL);
    return i < 0 || j < 0 || i >= W || j >= H ? -1 : j * W + i;
  };
  const Dc = distanceField(CELL, city, W, H); // out from the city
  const outside = new Uint8Array(W * H);
  for (let n = 0; n < outside.length; n++) outside[n] = city[n] ? 0 : 1;
  const Di = distanceField(CELL, outside, W, H); // in from the edge
  const at = (F, q) => {
    const n = cellOf(q);
    return n < 0 ? Infinity : F[n];
  };
  const isBlocked = (q) => {
    const n = cellOf(q);
    return n < 0 || blocked[n] === 1;
  };
  const isWet = (q) => terrain.isWater(q[0], q[1]);

  // The city's edge pushed out by d, its notches rounded over: a mask.
  const offset = (d, round) => {
    const grown = new Uint8Array(W * H);
    for (let n = 0; n < grown.length; n++) grown[n] = Dc[n] <= d + round ? 0 : 1;
    const back = distanceField(CELL, grown, W, H);
    const out = new Uint8Array(W * H);
    for (let n = 0; n < out.length; n++) out[n] = back[n] > round && !blocked[n] ? 1 : 0;
    return out;
  };
  // Its outline, in open runs where it meets the sea or mountains (a ring
  // where it never does), smoothed.
  const outline = (mask, minRun, tol = SMOOTH) => {
    const loops = contours(CELL, mask, W, H, x0, y0);
    if (!loops.length) return [];
    const loop = loops.slice().sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];
    const near = (q) => {
      const i = Math.round((q[0] - x0) / CELL);
      const j = Math.round((q[1] - y0) / CELL);
      for (let b = j - 2; b <= j + 1; b++) for (let a = i - 2; a <= i + 1; a++) if (a < 0 || b < 0 || a >= W || b >= H || blocked[b * W + a]) return true;
      return false;
    };
    const off = loop.map(near);
    const smooth = (P, closed) => (closed ? smoothLoop(P, tol) : smoothRun(P, tol));
    if (!off.some(Boolean)) return [{ pts: smooth(loop, true), closed: true }];
    // (Runs between stretches beside the sea or mountains.)
    const start = off.indexOf(true);
    const runs = [];
    let run = [];
    for (let k = 1; k <= loop.length; k++) {
      const n = (start + k) % loop.length;
      if (off[n]) {
        if (run.length > 1) runs.push(run);
        run = [];
      } else run.push(loop[n]);
    }
    return runs.filter((r) => lengthOf(r) >= minRun).map((r) => ({ pts: smooth(r, false), closed: false }));
  };

  // ---- The greenbelt and the expressway ----
  // (Set out a little further, as smoothing pulls the line in at bends.)
  const belt = offset(G + SMOOTH, ROUND);
  const expressway = outline(belt, 3000);
  // (Its outline as smooth as the expressway's, so the two meet.)
  const beltLoops = contours(CELL, belt, W, H, x0, y0).map((L) => smoothLoop(L, SMOOTH));
  const inBelt = (q) => {
    const n = cellOf(q);
    return n >= 0 && belt[n] === 1 && !city[n];
  };
  // Woods over part of it.
  const woods = [];
  let beltArea = 0;
  for (let n = 0; n < belt.length; n++) if (belt[n] && !city[n]) beltArea += CELL * CELL;
  for (let k = 0, tries = 0; k < beltArea / WOODS_PER && tries < beltArea / WOODS_PER * 6; tries++) {
    const q = [x0 + u(1, tries) * W * CELL, y0 + u(2, tries) * H * CELL];
    if (!inBelt(q) || isWet(q)) continue;
    const r = 90 + u(3, tries) * 160;
    const pts = [];
    const m = 14;
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2;
      const rr = r * (0.7 + 0.5 * u(4, tries, i));
      pts.push([q[0] + Math.cos(a) * rr * 1.2, q[1] + Math.sin(a) * rr]);
    }
    woods.push(chaikin(pts, true));
    k++;
  }

  // ---- Roads ----
  const expressPts = expressway.map((e) => e.pts);
  const crossExpressway = (a, b) => {
    let best = null;
    for (const P of expressPts) {
      const m = meet(a, b, P);
      if (m && (!best || m.t < best.t)) best = { ...m, P };
    }
    return best;
  };
  // A road on out from a point, bending gently onto the way out from the
  // centre, to where it meets the expressway (null if it cannot).
  const drive = (p, dir, limit = G + ROUND + 4000) => {
    const pts = [p];
    let h = unit(dir);
    let q = p;
    for (let s = 0; s < limit; s += ROAD_STEP) {
      const want = unit(sub(q, centre));
      const turn = Math.max(-ROAD_TURN, Math.min(ROAD_TURN, Math.atan2(h[0] * want[1] - h[1] * want[0], dot(h, want)) * 0.08));
      h = [h[0] * Math.cos(turn) - h[1] * Math.sin(turn), h[0] * Math.sin(turn) + h[1] * Math.cos(turn)];
      const next = add(q, mul(h, ROAD_STEP));
      if (isBlocked(next)) return null;
      const x = crossExpressway(q, next);
      if (x) {
        pts.push(x.p);
        return { pts, at: x.p, exp: x.P, dir: h };
      }
      pts.push(next);
      q = next;
    }
    return null;
  };
  const roads = [];
  for (const [k, l] of outLinks.entries()) {
    const r = drive(l.p, l.dir);
    if (!r) continue;
    roads.push({ pts: r.pts, at: r.at, exp: r.exp, dir: r.dir, end: 'trumpet', key: k });
  }

  // ---- Industrial areas ----
  const want = Math.max(1, Math.round(population / INDUSTRY_PEOPLE));
  const sites = [];
  // On the rail lines out of the city first, then out along the roads.
  for (const [k, T] of railTails.entries()) {
    let s0 = null;
    let s = 0;
    for (let i = 1; i < T.length; i++) {
      s += len(sub(T[i], T[i - 1]));
      if (at(Dc, T[i]) > G + ROUND * 0.3 + INDUSTRY_OUT && !isBlocked(T[i])) {
        s0 = s;
        break;
      }
    }
    if (s0 !== null) sites.push({ tail: T, s0, rail: true, r: u(10, k) });
  }
  for (const rd of roads) sites.push({ road: rd, rail: false, r: 1 + u(11, rd.key) });
  sites.sort((a, b) => a.r - b.r);
  const industrial = [];
  for (const site of sites) {
    if (industrial.length >= want) break;
    const A = INDUSTRY_AREA[0] + (INDUSTRY_AREA[1] - INDUSTRY_AREA[0]) * u(12, industrial.length);
    const L = Math.sqrt(A * 1.6);
    const Wd = A / L;
    let c;
    let ax;
    if (site.rail) {
      c = pointAlong(site.tail, site.s0 + L / 2);
      ax = unit(sub(pointAlong(site.tail, site.s0 + L / 2 + 50), pointAlong(site.tail, site.s0 + L / 2 - 50)));
    } else {
      ax = site.road.dir;
      c = add(site.road.at, mul(ax, INDUSTRY_OUT + L / 2));
    }
    // (All of it beyond the expressway, on dry land, clear of the others.)
    let ok = false;
    for (let t = 0; t < 6 && !ok; t++) {
      const R = rect(c, ax, L, Wd);
      let wet = 0;
      let close = false;
      for (let a = 0; a <= 4; a++) {
        for (let b = 0; b <= 4; b++) {
          const q = add(add(R[0], mul(sub(R[1], R[0]), a / 4)), mul(sub(R[3], R[0]), b / 4));
          if (isBlocked(q) || isWet(q)) wet++;
          if (at(Dc, q) < G + ROUND * 0.3 + 300) close = true;
        }
      }
      ok = wet <= 2 && !close && industrial.every((o) => len(sub(o.c, c)) > INDUSTRY_GAP);
      if (!ok) c = add(c, mul(unit(sub(c, centre)), 400));
    }
    if (!ok) continue;
    industrial.push(layOutIndustry(industrial.length, c, ax, L, Wd, site.rail ? site.tail : null));
  }
  function layOutIndustry(k, c, ax, L, Wd, tail) {
    const v = perp(ax);
    const outlinePts = rect(c, ax, L, Wd);
    const P = (a, b) => add(c, add(mul(ax, a), mul(v, b)));
    // Street lines across (every block's length) and along (every block's
    // width, either side of the track).
    const xs = [];
    const nA = Math.max(1, Math.round(L / (BLOCK[0] + STREET)));
    for (let i = 0; i <= nA; i++) xs.push(-L / 2 + (i * L) / nA);
    const ys = [];
    const half = Wd / 2;
    const first = tail ? RAIL_STRIP + STREET / 2 : 0;
    if (tail) {
      for (let y = first; y < half - BLOCK[1] * 0.5; y += BLOCK[1] + STREET) ys.push(y, -y);
    } else {
      const nB = Math.max(1, Math.round(Wd / (BLOCK[1] + STREET)));
      for (let i = 0; i <= nB; i++) ys.push(-half + (i * Wd) / nB);
    }
    ys.push(half, -half);
    const Y = [...new Set(ys.map((y) => Math.round(y * 10) / 10))].sort((a, b) => a - b);
    const streets = [];
    for (const x of xs) {
      // (Not across the track.)
      if (tail) {
        streets.push([P(x, -half), P(x, -first)], [P(x, first), P(x, half)]);
      } else streets.push([P(x, -half), P(x, half)]);
    }
    for (const y of Y) streets.push([P(-L / 2, y), P(L / 2, y)]);
    // Lots: each block split along its length, by use.
    const lots = [];
    const used = new Map();
    const pick = (salt, wholeOnly) => {
      const opts = INDUSTRIAL_USES.filter(([use, , whole, most]) => (used.get(use) || 0) < most && (!wholeOnly || whole));
      const total = opts.reduce((s, o) => s + o[1], 0);
      let r = u(20, k, salt) * total;
      for (const o of opts) {
        r -= o[1];
        if (r <= 0) return o;
      }
      return opts[opts.length - 1];
    };
    for (let i = 0; i + 1 < xs.length; i++) {
      for (let j = 0; j + 1 < Y.length; j++) {
        const [ya, yb] = [Y[j], Y[j + 1]];
        if (tail && ya < 0 && yb > 0) continue; // the track's strip
        if (yb - ya < 40) continue;
        const [xa, xb] = [xs[i] + STREET / 2, xs[i + 1] - STREET / 2];
        const [yA, yB] = [ya + STREET / 2, yb - STREET / 2];
        const salt = i * 101 + j;
        const byRail = tail && (Math.abs(ya) <= first + 1 || Math.abs(yb) <= first + 1);
        // (A rail depot by the track; some uses take a whole block.)
        let o = byRail && (used.get('railDepot') || 0) < 2 && u(21, k, salt) < 0.35 ? INDUSTRIAL_USES.find((x) => x[0] === 'railDepot') : pick(salt, false);
        const n = o[2] ? 1 : 1 + Math.floor(u(22, k, salt) * 3);
        for (let q = 0; q < n; q++) {
          if (q > 0) o = pick(salt * 7 + q, false);
          if (o[2] && n > 1) o = INDUSTRIAL_USES.find((x) => x[0] === 'lightManufacturing');
          used.set(o[0], (used.get(o[0]) || 0) + 1);
          const a = xa + ((xb - xa) * q) / n;
          const b = xa + ((xb - xa) * (q + 1)) / n;
          const pts = [P(a, yA), P(b, yA), P(b, yB), P(a, yB)];
          // The building: set back from the street, yard behind.
          const inset = 12 + u(23, k, salt, q) * 10;
          const depth = (yB - yA) * (0.45 + 0.35 * u(24, k, salt, q));
          const front = u(25, k, salt, q) < 0.5;
          const bya = front ? yA + inset : yB - inset - depth;
          const bldg = b - a > 2 * inset + 15 ? [P(a + inset, bya), P(b - inset, bya), P(b - inset, bya + depth), P(a + inset, bya + depth)] : null;
          lots.push({ pts, use: o[0], bldg, c: P((a + b) / 2, (yA + yB) / 2) });
        }
      }
    }
    return { name: names.industrial(k), c, axis: ax, pts: outlinePts, streets, lots, station: tail ? c : null };
  }
  // Roads on to the industrial areas: the nearest crossing carries on, at a
  // diverging diamond; an area no road reaches gets one of its own in from
  // the expressway.
  for (const area of industrial) {
    let best = null;
    for (const rd of roads) {
      if (rd.end === 'ddi') continue;
      const r = len(sub(rd.at, area.c));
      if (r < 7000 && (!best || r < best.r)) best = { rd, r };
    }
    const edgeToward = (q) => {
      // The point on the area's outline nearest q.
      let b = null;
      for (let i = 0; i < 4; i++) {
        const a = area.pts[i];
        const ab = sub(area.pts[(i + 1) % 4], a);
        const t = Math.max(0, Math.min(1, dot(sub(q, a), ab) / dot(ab, ab)));
        const p = add(a, mul(ab, t));
        if (!b || len(sub(p, q)) < len(sub(b, q))) b = p;
      }
      return b;
    };
    if (best) {
      const e = edgeToward(best.rd.at);
      best.rd.on = resample([best.rd.at, e], ROAD_STEP);
      best.rd.end = 'ddi';
      area.road = best.rd;
    } else {
      // In from the area toward the centre, to the expressway.
      const e = edgeToward(centre);
      {
        // (Straight in, toward the centre.)
        const dir = unit(sub(centre, e));
        const pts = [e];
        let q = e;
        let hit = null;
        for (let s = 0; s < 8000 && !hit; s += ROAD_STEP) {
          const next = add(q, mul(dir, ROAD_STEP));
          if (isBlocked(next)) break;
          hit = crossExpressway(q, next);
          pts.push(hit ? hit.p : next);
          q = next;
        }
        if (hit) roads.push({ pts: pts.slice().reverse(), at: hit.p, exp: hit.P, dir: mul(dir, -1), end: 'trumpet', key: 100 + industrial.indexOf(area), toIndustry: true });
      }
    }
  }
  // Each road's trail, a safe way off to one side.
  for (const rd of roads) {
    const all = rd.on ? rd.pts.concat(rd.on.slice(1)) : rd.pts;
    const side = u(30, rd.key) < 0.5 ? 1 : -1;
    const N = polylineNormals(all);
    rd.trail = all.map((q, i) => add(q, mul(N[i], ROAD_TRAIL * side)));
  }
  // Junctions on the expressway: trumpets and diverging diamonds.
  const junctions = roads.map((rd) => {
    const P = rd.exp;
    let best = 0;
    for (let i = 0; i + 1 < P.length; i++) if (distToPolyline(rd.at, [P[i], P[i + 1]]) < distToPolyline(rd.at, [P[best], P[best + 1]])) best = i;
    const t = unit(sub(P[Math.min(P.length - 1, best + 1)], P[best]));
    return { kind: rd.end, p: rd.at, along: t, road: unit(rd.dir) };
  });

  // ---- Trails through the greenbelt ----
  const trails = [];
  for (const T of outline(offset(G * TRAIL_AT, ROUND * 0.4), 1500, 120)) {
    // (Broken where it would run through the city or the water.)
    let run = [];
    for (const q of T.pts) {
      if (at(Dc, q) < 60 || isWet(q)) {
        if (run.length > 4) trails.push(run);
        run = [];
      } else run.push(q);
    }
    if (run.length > 4) trails.push(run);
  }
  // Trails in from the city's edge, every so far along.
  for (const T of trails.slice()) {
    for (let s = SPUR_EVERY / 2; s < lengthOf(T); s += SPUR_EVERY) {
      let q = pointAlong(T, s);
      const pts = [q];
      // (Down the slope of the distance to the city, to its edge.)
      for (let k = 0; k < 60 && at(Dc, q) > 0; k++) {
        const n = cellOf(q);
        if (n < 0) break;
        const i = n % W;
        const j = Math.floor(n / W);
        let bn = n;
        for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
          const m = (j + b) * W + i + a;
          if (m >= 0 && m < Dc.length && Dc[m] < Dc[bn]) bn = m;
        }
        if (bn === n) break;
        q = [x0 + ((bn % W) + 0.5) * CELL, y0 + (Math.floor(bn / W) + 0.5) * CELL];
        pts.push(q);
      }
      if (pts.length > 2 && !pts.some(isWet)) trails.push(chaikin(chaikin(simplify(pts, 30), false), false));
    }
  }

  // ---- The greenbelt's attractions ----
  const roadLines = [...expressPts, ...roads.map((r) => (r.on ? r.pts.concat(r.on) : r.pts))];
  const clearOfRoads = (q, r) => roadLines.every((P) => distToPolyline(q, P) > r);
  const ends = [];
  for (const L of metroLines) {
    for (const [a, b] of [[L.pts[0], L.pts[Math.min(5, L.pts.length - 1)]], [L.pts[L.pts.length - 1], L.pts[Math.max(0, L.pts.length - 6)]]]) {
      if (at(Di, a) < 2500) ends.push({ L, p: a, dir: unit(sub(a, b)) });
    }
  }
  const attractions = [];
  const taken = new Set();
  for (const [kind, from, [l, w]] of ATTRACTIONS) {
    if (population < from) continue;
    let done = false;
    const order = ends.map((e, i) => ({ e, i, r: u(40, hashString(kind), i) })).sort((a, b) => a.r - b.r);
    for (const { e, i } of order) {
      if (done || taken.has(i)) continue;
      // The line run on out to a station in the greenbelt.
      const pts = [e.p];
      let q = e.p;
      let h = e.dir;
      let ok = false;
      for (let s = 0; s < 5000; s += ROAD_STEP) {
        const want = unit(sub(q, centre));
        h = unit(add(mul(h, 0.92), mul(want, 0.08)));
        q = add(q, mul(h, ROAD_STEP));
        if (isBlocked(q)) break;
        pts.push(q);
        if (at(Dc, q) >= G * 0.3) {
          ok = true;
          break;
        }
      }
      if (!ok) continue;
      const st = q;
      const c = add(st, mul(h, w / 2 + 90));
      const R = rect(c, h, w, l);
      const inside = R.concat([c]).every((p) => inBelt(p) && !isWet(p));
      if (!inside || !clearOfRoads(c, ATTRACTION_CLEAR + l / 2) || attractions.some((a) => len(sub(a.c, c)) < 1200)) continue;
      taken.add(i);
      done = true;
      attractions.push({ kind, name: names.attraction(kind, attractions.length), c, pts: R, axis: h, station: st, metro: { pts, colour: e.L.colour, name: e.L.name } });
    }
  }

  // ---- Park-and-ride ----
  const parkAndRides = [];
  for (const [k, T] of railTails.entries()) {
    let x = null;
    let s = 0;
    for (let i = 1; i < T.length && !x; i++) {
      const m = crossExpressway(T[i - 1], T[i]);
      if (m) x = { s: s + len(sub(m.p, T[i - 1])) };
      s += len(sub(T[i], T[i - 1]));
    }
    if (!x) continue;
    const st = pointAlong(T, x.s + 350);
    const t = unit(sub(pointAlong(T, x.s + 400), pointAlong(T, x.s + 300)));
    const side = u(50, k) < 0.5 ? 1 : -1;
    const c = add(st, mul(perp(t), side * (PARK_AND_RIDE[1] / 2 + 40)));
    const lot = rect(c, t, PARK_AND_RIDE[0], PARK_AND_RIDE[1]);
    if (lot.some((q) => isWet(q) || isBlocked(q))) continue;
    parkAndRides.push({ name: names.parkAndRide(k), station: st, lot, c, axis: t });
  }

  return {
    width: G,
    bbox: { x0, y0, x1: x0 + W * CELL, y1: y0 + H * CELL },
    greenbelt: beltLoops,
    woods,
    expressway,
    roads,
    junctions,
    trails,
    industrial,
    attractions,
    parkAndRides,
    // How far out of the city a point is (0 inside it).
    outFromCity: (q) => at(Dc, q),
  };
}
