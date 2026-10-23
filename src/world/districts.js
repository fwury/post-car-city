// Districts, generated in this order:
//   1. cores.js       district cores, spread like a loose Poisson field
//   2. growth.js      districts spread out from their cores over land parcels
//   3. here           boundaries where districts meet become primary greenways
//   4. boulevards.js  tram boulevards link the cores of neighbouring districts
//   5. parks.js       district parks sit where three districts meet, clear of
//                     the boulevards
//   6. neighbourhoods.js  neighbourhoods (the core among them) and main streets
//
// Boundaries are traced between parcels of different districts, then
// smoothed. Each stretch of boundary between two junctions is computed once,
// in a fixed direction, and shared by both districts, so the two sides always
// match exactly.

import { hash, hashString, toUnit } from '../core/hash.js';
import { rngFor } from '../core/rng.js';
import { createNoise, createWarp } from '../core/noise.js';
import { LruCache } from './cache.js';
import { STREET_TYPES } from './streetTypes.js';
import { createBoulevards, distToPieces } from './boulevards.js';
import { createParks } from './parks.js';
import { createGreenways } from './greenway.js';
import { createNeighbourhoods } from './neighbourhoods.js';
export { PARK_AREA_HA } from './parks.js';
import { createCores, keyInts } from './cores.js';
import { createBlocks } from './blocks.js';
import { createGrowth, PARCEL } from './growth.js';
import { dist, pointInPolygon, polygonArea, signedArea, polylineNormals, bboxOf, simplify, chaikin, resample } from '../util/geom.js';

export const CORE_RADIUS = 380; // about 0.45 km²
export const GREENWAY_MIN = 50;
export const GREENWAY_MAX = 160;
export const BOULEVARD_WIDTH = STREET_TYPES.boulevard.width;
const CORE_CLEAR = 300; // greenways keep this far from a station
const DISTRICT_REACH = 7000; // no district extends further than this from its core
const DISTRICT_SEARCH = 5500; // cores this far outside a view can still reach into it
const SMOOTHING = 4; // Chaikin passes on boundaries
const SIMPLIFY = 120; // metres of staircase removed before smoothing
const SMOOTH_SPACING = 30; // metres between points of the smoothed boundary
const FINE_SPACING = 15; // metres between points of the final boundary
const RUN_LENGTH = [110, 340]; // straight runs of greenway between bends
const RUN_OFFSET = 26; // metres a bend may sit off the smoothed line
const FILLET = 70; // longest rounding either side of a bend

// Parcel-grid point keys. A boundary point is either the midpoint between two
// parcels ('h' horizontal or 'v' vertical neighbours) or the centre of a quad
// of four parcels where three or more districts meet ('q').
const hKey = (i, j) => `h${i},${j}`;
const vKey = (i, j) => `v${i},${j}`;
const qKey = (i, j) => `q${i},${j}`;

// Replace a smooth line by straight runs with rounded bends between them, the
// way a linear park follows old field edges: mostly straight, with a bend
// every hundred metres or so. Both ends stay exactly where they are. Returns
// the new line and its straight runs (each from a to b).
function straightRuns(pts, rng) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  const at = (s) => {
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const t = cum[i] > cum[i - 1] ? (s - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0;
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, nx: -(b[1] - a[1]) / len, ny: (b[0] - a[0]) / len };
  };
  const B = [pts[0]];
  let s = rng.range(...RUN_LENGTH);
  while (s < L - RUN_LENGTH[0] * 0.7) {
    const q = at(s);
    const off = rng.range(-RUN_OFFSET, RUN_OFFSET);
    B.push([q.x + q.nx * off, q.y + q.ny * off]);
    s += rng.range(...RUN_LENGTH);
  }
  B.push(pts[pts.length - 1]);
  if (B.length < 3) return { points: pts, runs: [] };
  const out = [B[0]];
  const runs = [];
  let runStart = B[0];
  for (let k = 1; k < B.length - 1; k++) {
    const [px, py] = B[k - 1];
    const [cx, cy] = B[k];
    const [nx, ny] = B[k + 1];
    const l0 = Math.hypot(cx - px, cy - py) || 1;
    const l1 = Math.hypot(nx - cx, ny - cy) || 1;
    const f = Math.min(FILLET, l0 * 0.4, l1 * 0.4);
    const P = [cx - ((cx - px) / l0) * f, cy - ((cy - py) / l0) * f];
    const Q = [cx + ((nx - cx) / l1) * f, cy + ((ny - cy) / l1) * f];
    runs.push({ a: runStart, b: P });
    out.push(P);
    for (let i = 1; i < 6; i++) {
      const t = i / 6;
      const u = 1 - t;
      out.push([u * u * P[0] + 2 * u * t * cx + t * t * Q[0], u * u * P[1] + 2 * u * t * cy + t * t * Q[1]]);
    }
    out.push(Q);
    runStart = Q;
  }
  runs.push({ a: runStart, b: B[B.length - 1] });
  out.push(B[B.length - 1]);
  return { points: out, runs };
}

// Cores reach at most this many core radii from the station (parks keep clear).
const CORE_REACH = 1.25;

export function createWorld(seed) {
  const cores = createCores(seed);
  const growth = createGrowth(seed, cores);
  const boulevards = createBoulevards(seed);
  const hoods = createNeighbourhoods(seed, { boulevards });
  const parks = createParks(seed, {
    baseOf: (k) => baseOf(k), label: (i, j) => growth.label(i, j), parcel: PARCEL,
    greenwayWidth: (x, y) => greenwayWidth(x, y), boulevardDistance: (x, y) => boulevardDistance(x, y), network: (b) => boulevards.network(b),
  });
  // Boundary detail at three scales: broad sweeps, meanders, then smaller kinks.
  const warpBroad = createWarp(seed, 'boundary-sweep', 2600, 210, 2);
  const warpMid = createWarp(seed, 'boundary-detail', 1100, 80, 2);
  const warpFine = createWarp(seed, 'boundary-detail-fine', 420, 28, 2);
  const detail = (x, y) => {
    const p = warpBroad(x, y, [0, 0]);
    warpMid(p[0], p[1], p);
    return warpFine(p[0], p[1], p);
  };
  const widthNoise = createNoise(seed, 'greenway-width');
  const greenways = createGreenways(seed, { greenwayWidth: (x, y) => greenwayWidth(x, y) });

  const bases = new LruCache(12000);
  const districts = new LruCache(12000);
  const chains = new LruCache(60000);

  const label = growth.label;
  const pos = growth.parcelPos;

  function pointPos(key) {
    const kind = key[0];
    const [i, j] = key.slice(1).split(',').map(Number);
    if (kind === 'h') {
      const a = pos(i, j);
      const b = pos(i + 1, j);
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }
    if (kind === 'v') {
      const a = pos(i, j);
      const b = pos(i, j + 1);
      return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    }
    const a = pos(i, j);
    const b = pos(i + 1, j);
    const c = pos(i + 1, j + 1);
    const d = pos(i, j + 1);
    return [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4];
  }

  // Boundary pieces inside the quad whose top-left parcel is (i, j).
  // Each piece runs between two point keys and separates two labels; `corner`
  // gives, for each label, a corner position on that label's side.
  function quadPieces(i, j) {
    const C = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
    const L = C.map(([a, b]) => label(a, b));
    const E = [hKey(i, j), vKey(i + 1, j), hKey(i, j + 1), vKey(i, j)];
    const cut = [0, 1, 2, 3].filter((e) => L[e] !== L[(e + 1) % 4]);
    if (cut.length === 0) return [];
    const piece = (a, b, e) => ({ a, b, la: L[e], lb: L[(e + 1) % 4], ca: C[e], cb: C[(e + 1) % 4] });
    if (cut.length === 2) return [piece(E[cut[0]], E[cut[1]], cut[0])];
    const Q = qKey(i, j);
    if (cut.length === 4) {
      const d0 = L[0] === L[2];
      const d1 = L[1] === L[3];
      let win = -1;
      if (d0 && d1) win = L[0] < L[1] ? 0 : 1;
      else if (d0) win = 0;
      else if (d1) win = 1;
      // The winning diagonal joins through the quad; the other two corners are cut off.
      if (win === 0) return [piece(E[0], E[1], 0), piece(E[2], E[3], 2)];
      if (win === 1) return [piece(E[3], E[0], 0), piece(E[1], E[2], 2)];
    }
    return cut.map((e) => piece(E[e], Q, e));
  }

  // Geometry and topology of a district, without parks.
  function base(core) {
    let b = bases.get(core.key);
    if (b) return b;
    const D = core.key;
    // Flood the district's parcels from the core.
    const si = Math.floor(core.x / PARCEL);
    const sj = Math.floor(core.y / PARCEL);
    const seen = new Set();
    const stack = [[si, sj]];
    const quads = new Set();
    let parcels = 0;
    while (stack.length) {
      const [i, j] = stack.pop();
      const k = `${i},${j}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (label(i, j) !== D) continue;
      if (Math.abs(i - si) * PARCEL > DISTRICT_REACH || Math.abs(j - sj) * PARCEL > DISTRICT_REACH) continue;
      parcels++;
      for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) quads.add(`${i + di},${j + dj}`);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (di || dj) stack.push([i + di, j + dj]);
    }

    // Pieces with D on one side, oriented so D is on the left.
    const next = new Map();
    for (const q of quads) {
      const [i, j] = q.split(',').map(Number);
      for (const p of quadPieces(i, j)) {
        if (p.la !== D && p.lb !== D) continue;
        const other = p.la === D ? p.lb : p.la;
        const corner = pos(...(p.la === D ? p.ca : p.cb));
        const A = pointPos(p.a);
        const B = pointPos(p.b);
        const left = (B[0] - A[0]) * (corner[1] - A[1]) - (B[1] - A[1]) * (corner[0] - A[0]) < 0;
        const [s, e] = left ? [p.a, p.b] : [p.b, p.a];
        next.set(s, { end: e, other });
      }
    }

    // Follow pieces into rings, and split rings into chains at junctions.
    const rings = [];
    const used = new Set();
    for (const start of next.keys()) {
      if (used.has(start)) continue;
      const keys = [];
      const others = [];
      let k = start;
      while (!used.has(k) && next.has(k)) {
        used.add(k);
        keys.push(k);
        others.push(next.get(k).other);
        k = next.get(k).end;
      }
      if (keys.length > 2) rings.push({ keys, others });
    }

    const dChains = [];
    const junctions = new Map();
    const ringPts = [];
    for (const r of rings) {
      const n = r.keys.length;
      // Start at a change of neighbour, if there is one.
      let s0 = r.others.findIndex((o, i) => o !== r.others[(i - 1 + n) % n]);
      const loop = s0 < 0;
      if (loop) s0 = 0;
      const ringChains = [];
      let cur = null;
      for (let t = 0; t < n; t++) {
        const i = (s0 + t) % n;
        if (!cur || r.others[i] !== cur.other) {
          if (cur) cur.keys.push(r.keys[i]);
          cur = { other: r.others[i], keys: [r.keys[i]] };
          ringChains.push(cur);
        } else {
          cur.keys.push(r.keys[i]);
        }
      }
      cur.keys.push(r.keys[s0]);
      const pts = [];
      for (const c of ringChains) {
        const g = sharedChain(D, c.other, c.keys, loop);
        dChains.push({ key: g.key, neighbour: c.other, points: g.oriented(c.keys[0]), geo: g });
        const op = g.oriented(c.keys[0]);
        for (let i = 0; i < op.length - 1; i++) pts.push(op[i]);
        if (!loop) {
          for (const jk of [c.keys[0], c.keys[c.keys.length - 1]]) {
            if (!junctions.has(jk)) {
              const [x, y] = clearOfCores(...pointPos(jk));
              junctions.set(jk, { key: jk, x, y });
            }
          }
        }
      }
      ringPts.push(pts);
    }
    // The outer ring is the largest; any others are islands or holes.
    ringPts.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
    const ring = ringPts[0] || [];

    for (const j of junctions.values()) {
      const [i, jj] = j.key.slice(1).split(',').map(Number);
      j.i = i;
      j.j = jj;
      j.labels = [...new Set([[i, jj], [i + 1, jj], [i + 1, jj + 1], [i, jj + 1]].map(([a, c]) => label(a, c)))].sort();
    }

    let minD = Infinity;
    for (const [x, y] of ring) minD = Math.min(minD, dist(core.x, core.y, x, y));
    const coreRadius = Math.max(200, Math.min(CORE_RADIUS, (minD - GREENWAY_MAX / 2 - 60) / CORE_REACH));
    const bbox = bboxOf(ring, GREENWAY_MAX);
    b = {
      key: D,
      core,
      station: [core.x, core.y],
      coreRadius,
      coreReach: coreRadius * CORE_REACH,
      parcels,
      area: ring.length ? polygonArea(ring) : 0,
      ring,
      rings: ringPts,
      chains: dChains,
      junctions: [...junctions.values()],
      neighbours: [...new Set(dChains.map((c) => c.neighbour))],
      bbox,
    };
    bases.set(D, b);
    return b;
  }

  // One boundary stretch between two districts, computed in a fixed direction
  // and shared. `keys` is the stretch as seen from district D.
  function sharedChain(D, E, keys, loop) {
    let canon = keys;
    if (loop) {
      // Closed loop: start at the smallest key, go towards the smaller neighbour.
      const ring = keys.slice(0, -1);
      let m = 0;
      for (let i = 1; i < ring.length; i++) if (ring[i] < ring[m]) m = i;
      const fwd = ring.slice(m).concat(ring.slice(0, m));
      const back = [fwd[0], ...fwd.slice(1).reverse()];
      canon = (fwd[1] < back[1] ? fwd : back).concat([fwd[0]]);
    } else if (keys[0] > keys[keys.length - 1]) {
      canon = keys.slice().reverse();
    }
    const pair = D < E ? `${D}|${E}` : `${E}|${D}`;
    const key = `${pair}|${canon[0]}|${canon[canon.length - 1]}|${canon.length}`;
    let g = chains.get(key);
    if (!g) {
      let pts = simplify(canon.map(pointPos), SIMPLIFY);
      if (loop) pts = pts.slice(0, -1);
      if (pts.length < 3 && loop) pts = canon.slice(0, -1).map(pointPos);
      for (let s = 0; s < SMOOTHING; s++) pts = chaikin(pts, loop);
      if (loop) pts.push(pts[0]);
      pts = resample(pts, SMOOTH_SPACING);
      pts = pts.map(([x, y]) => clearOfCores(x, y));
      const shaped = straightRuns(pts, rngFor(seed, 'greenway-runs', hashString(key)));
      pts = resample(shaped.points, FINE_SPACING);
      const first = canon[0];
      const lods = new Map();
      g = {
        key,
        points: pts,
        runs: shaped.runs,
        first,
        // Points running from `start` (orientation only matters for open stretches).
        oriented(start) {
          return start === first ? pts : pts.slice().reverse();
        },
        lod(step) {
          let l = lods.get(step);
          if (!l) {
            const line = [];
            for (let i = 0; i < pts.length - 1; i += step) line.push(pts[i]);
            line.push(pts[pts.length - 1]);
            l = { line, strip: greenwayStrip(line) };
            lods.set(step, l);
          }
          return l;
        },
      };
      chains.set(key, g);
    }
    return g;
  }

  // Warping can carry a boundary over a station in a small district. Near a
  // core the warp fades out, so the boundary keeps to its smoothed parcel
  // line (which has the core on the right side), and is then eased outwards
  // to keep CORE_CLEAR from the station. Both depend only on the point, so
  // chains and the junctions at their ends move alike.
  function clearOfCores(x, y) {
    const R = 2 * CORE_CLEAR;
    const near = cores.coresInRect(x - R, y - R, x + R, y + R);
    const w = detail(x, y);
    let f = 1;
    for (const c of near) {
      const t = Math.min(1, Math.max(0, (Math.hypot(x - c.x, y - c.y) - CORE_CLEAR) / CORE_CLEAR));
      f = Math.min(f, t * t * (3 - 2 * t));
    }
    let p = [x + (w[0] - x) * f, y + (w[1] - y) * f];
    for (const c of near) {
      const dx = p[0] - c.x;
      const dy = p[1] - c.y;
      const r = Math.hypot(dx, dy);
      if (r >= R || r < 1e-9) continue;
      // r -> CORE_CLEAR at the core, unchanged at R, and never reordered.
      const k = (r + ((R - r) ** 2 * CORE_CLEAR) / (R * R)) / r;
      p = [c.x + dx * k, c.y + dy * k];
    }
    return p;
  }

  // Width varies slowly along a greenway, with small swells and pinches on top.
  const greenwayWidth = (x, y) => {
    const broad = Math.min(1, Math.max(0, widthNoise.fbm(x / 1500, y / 1500, 2) * 0.9 + 0.5));
    const fine = widthNoise.fbm(x / 230 + 91.7, y / 230, 2) * 0.22;
    return Math.max(GREENWAY_MIN, (GREENWAY_MIN + (GREENWAY_MAX - GREENWAY_MIN) * broad) * (1 + fine));
  };

  function greenwayStrip(line) {
    const normals = polylineNormals(line);
    const left = [];
    const right = [];
    for (let i = 0; i < line.length; i++) {
      const [x, y] = line[i];
      const h = greenwayWidth(x, y) / 2;
      left.push([x + normals[i][0] * h, y + normals[i][1] * h]);
      right.push([x - normals[i][0] * h, y - normals[i][1] * h]);
    }
    return left.concat(right.reverse());
  }

  function baseOf(key) {
    const c = growth.coreOf(key);
    return c ? base(c) : null;
  }

  // ---- Full districts ----

  function district(core) {
    let d = districts.get(core.key);
    if (d) return d;
    const b = base(core);
    const dParks = parks.parksOf(b);
    const bbox = { ...b.bbox };
    for (const p of dParks) bboxOf(p.shape, 0, bbox);
    const net = boulevards.network(b);
    d = {
      ...b,
      origin: [Math.round(core.x / 1000) * 1000, Math.round(core.y / 1000) * 1000],
      coreInfo: core,
      parks: dParks,
      links: net.links.length,
      network: net,
      bbox,
      lods: new Map(),
    };
    // Stage 3. The core is the neighbourhood around the station.
    d.stage3 = hoods.of(d);
    d.core = d.stage3.hoods[0].polygon;
    d.coreArea = d.stage3.hoods[0].area;
    districts.set(core.key, d);
    return d;
  }

  // Geometry for a level of detail: chain points thinned to about segLen.
  function lod(d, segLen) {
    let g = d.lods.get(segLen);
    if (g) return g;
    const step = Math.max(1, Math.round(segLen / FINE_SPACING));
    const edgeLines = [];
    const strips = [];
    for (const c of d.chains) {
      const l = c.geo.lod(step);
      edgeLines.push(l.line);
      strips.push(l.strip);
    }
    const junctions = d.junctions.map((j) => ({ x: j.x, y: j.y, r: greenwayWidth(j.x, j.y) / 2 }));
    g = { segLen, ring: d.ring, edgeLines, strips, junctions };
    d.lods.set(segLen, g);
    return g;
  }

  function districtsInRect(x0, y0, x1, y1) {
    const out = [];
    const m = DISTRICT_SEARCH;
    for (const c of cores.coresInRect(x0 - m, y0 - m, x1 + m, y1 + m)) {
      const b = base(c);
      if (b.bbox.x1 < x0 - 1000 || b.bbox.x0 > x1 + 1000 || b.bbox.y1 < y0 - 1000 || b.bbox.y0 > y1 + 1000) continue;
      const d = district(c);
      const bb = d.bbox;
      if (bb.x1 < x0 || bb.x0 > x1 || bb.y1 < y0 || bb.y0 > y1) continue;
      out.push(d);
    }
    return out;
  }

  // Boulevard lines and roundabouts touching a rectangle. Each district
  // draws its own half of every link.
  function boulevardsInRect(x0, y0, x1, y1) {
    const lines = [];
    const roundabouts = [];
    for (const d of districtsInRect(x0, y0, x1, y1)) {
      for (const l of d.network.lines) {
        const b = l.bbox;
        if (b.x1 < x0 - BOULEVARD_WIDTH || b.x0 > x1 + BOULEVARD_WIDTH || b.y1 < y0 - BOULEVARD_WIDTH || b.y0 > y1 + BOULEVARD_WIDTH) continue;
        lines.push(l);
      }
      if (d.network.roundabout) roundabouts.push(d.network.roundabout);
    }
    return { lines, roundabouts };
  }

  // Distance from a point to the nearest boulevard, looking at every district
  // with land within `reach` metres.
  function boulevardDistance(x, y, reach = 800) {
    const keys = new Set();
    const n = Math.ceil(reach / PARCEL);
    const i0 = Math.floor(x / PARCEL);
    const j0 = Math.floor(y / PARCEL);
    for (let j = j0 - n; j <= j0 + n; j++) for (let i = i0 - n; i <= i0 + n; i++) keys.add(label(i, j));
    let best = Infinity;
    for (const k of [...keys].sort()) {
      const b = baseOf(k);
      if (!b) continue;
      for (const l of boulevards.network(b).lines) {
        const bb = l.bbox;
        if (x < bb.x0 - best || x > bb.x1 + best || y < bb.y0 - best || y > bb.y1 + best) continue;
        best = distToPieces(x, y, l.points, l.pieces, best);
      }
    }
    return best;
  }

  // The district containing a point.
  function districtAt(x, y) {
    const i0 = Math.floor(x / PARCEL);
    const j0 = Math.floor(y / PARCEL);
    let best = null;
    let bd = Infinity;
    for (let j = j0 - 1; j <= j0 + 1; j++) {
      for (let i = i0 - 1; i <= i0 + 1; i++) {
        const [px, py] = pos(i, j);
        const dd = (px - x) ** 2 + (py - y) ** 2;
        if (dd < bd) {
          bd = dd;
          best = label(i, j);
        }
      }
    }
    const c = best && growth.coreOf(best);
    if (!c) return null;
    const d = district(c);
    for (const r of d.rings) if (pointInPolygon(x, y, r)) return d;
    return d;
  }

  // Stage 4: local streets and blocks, worked out only when wanted.
  const blocks = createBlocks(seed, { greenwayWidth: (x, y) => greenwayWidth(x, y), greenway: (geo) => greenways.of(geo) });

  return {
    seed, cores, growth, boulevards,
    blocks: (d) => blocks.of(d),
    // Stage 5: the stream, trail and woods of a stretch of greenway.
    greenway: (geo) => greenways.of(geo),
    district, base, lod, districtsInRect, boulevardsInRect, boulevardDistance, districtAt, greenwayWidth,
    // Stage 3: neighbourhoods and main streets of a district.
    neighbourhoods: (d) => d.stage3,
    coresInRect: cores.coresInRect,
  };
}
