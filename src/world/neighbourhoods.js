// Stage 3: neighbourhoods and main streets, worked out per district on a
// raster of its land (inside its greenways, outside its parks).
//
// The district core is a neighbourhood like any other, grown from the
// station. Where a boulevard runs through the district, neighbourhood
// centres sit on it and the boulevard is their main street. The remaining
// centres are spread by farthest-point sampling and a few Lloyd steps, then
// every neighbourhood is grown over a noisy cost field, so the shapes come
// out very irregular. Boundaries are traced once per shared stretch and
// smoothed in a fixed direction, so both sides match exactly.
//
// Main streets (tram, 31 m) tie the neighbourhoods together:
//   - straight radials from the station, so that with the boulevards 4 to 6
//     tram streets run into the core
//   - links between neighbouring centres (a relative neighbourhood graph),
//     enough that every centre has a street running through it
//   - links across the greenways to the neighbouring districts, at crossing
//     points worked out from the shared greenway alone, so both districts
//     meet there exactly
//   - extra links wherever land is still more than MAIN_STREET_REACH from a
//     main street or boulevard
// A main street ends only at a centre, the station, a boulevard or a
// greenway crossing (where it carries on in the next district).

import { hash, hashString, toUnit } from '../core/hash.js';
import { rngFor } from '../core/rng.js';
import { createNoise } from '../core/noise.js';
import { LruCache } from './cache.js';
import { keyInts } from './cores.js';
import { Heap } from './growth.js';
import { spline, minRadius, lineBox, piecesOf, distToLine } from './boulevards.js';
import { polygonArea, signedArea, simplify, chaikin } from '../util/geom.js';

export const NEIGHBOURHOOD_AREA = 0.75e6; // m², typical
export const NEIGHBOURHOODS = [8, 12]; // per district, besides the core
export const MAIN_STREET_REACH = 450; // metres from any point to a main street
export const MAIN_STREET_RADIUS = 35; // tightest bend on a main street
export const RING_MARGIN = 80; // land this close to a district's greenway is the greenway's
export const CORE_ARMS = [4, 6]; // tram streets into the core, boulevards included
export const EDGE_SPACING = 850; // metres between main street crossings of a greenway
const EDGE_END = 420; // crossings keep this far from the ends of a greenway stretch
const EDGE_CLEAR = 380; // and this far from a boulevard crossing
const STUB = 70; // straight metres either side of a greenway crossing
const CELL = 50;
const SMOOTH_TOL = 32; // metres of raster staircase removed before smoothing
const MIN_SHARED = 120; // metres of shared boundary for two neighbourhoods to count as neighbours
const OUTSIDE = -1;

const LAND = 1;
const PARK = 3;

const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const unit = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

function arcLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += len(sub(pts[i], pts[i - 1]));
  return s;
}

function along(pts, s) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = len(sub(pts[i + 1], pts[i]));
    if (acc + l >= s || i === pts.length - 2) {
      const t = l > 0 ? Math.min(1, Math.max(0, (s - acc) / l)) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
    acc += l;
  }
  return pts[pts.length - 1];
}

// Fill a polygon into a raster, by scanlines through cell centres.
function fill(mask, W, H, x0, y0, poly, value, only = -1) {
  const n = poly.length;
  const xs = [];
  for (let j = 0; j < H; j++) {
    const y = y0 + (j + 0.5) * CELL;
    xs.length = 0;
    for (let k = 0; k < n; k++) {
      const a = poly[k];
      const b = poly[(k + 1) % n];
      if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / CELL - 0.5));
      const i1 = Math.min(W - 1, Math.floor((xs[k + 1] - x0) / CELL - 0.5));
      for (let i = i0; i <= i1; i++) if (only < 0 || mask[j * W + i] === only) mask[j * W + i] = value;
    }
  }
}

// Chamfer distance transform in metres from every source cell (dist 0).
function distanceField(src, W, H) {
  const d = new Float64Array(W * H);
  for (let n = 0; n < d.length; n++) d[n] = src[n] ? 0 : Infinity;
  const D = CELL * Math.SQRT2;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const n = j * W + i;
      let v = d[n];
      if (i > 0) v = Math.min(v, d[n - 1] + CELL);
      if (j > 0) {
        v = Math.min(v, d[n - W] + CELL);
        if (i > 0) v = Math.min(v, d[n - W - 1] + D);
        if (i < W - 1) v = Math.min(v, d[n - W + 1] + D);
      }
      d[n] = v;
    }
  }
  for (let j = H - 1; j >= 0; j--) {
    for (let i = W - 1; i >= 0; i--) {
      const n = j * W + i;
      let v = d[n];
      if (i < W - 1) v = Math.min(v, d[n + 1] + CELL);
      if (j < H - 1) {
        v = Math.min(v, d[n + W] + CELL);
        if (i < W - 1) v = Math.min(v, d[n + W + 1] + D);
        if (i > 0) v = Math.min(v, d[n + W - 1] + D);
      }
      d[n] = v;
    }
  }
  return d;
}

// Mark the cells a polyline passes through.
function stamp(src, W, H, x0, y0, pts) {
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k];
    const [bx, by] = pts[k + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL / 2)));
    for (let s = 0; s <= steps; s++) {
      const i = Math.floor((ax + ((bx - ax) * s) / steps - x0) / CELL);
      const j = Math.floor((ay + ((by - ay) * s) / steps - y0) / CELL);
      if (i >= 0 && j >= 0 && i < W && j < H) src[j * W + i] = 1;
    }
  }
}

export function createNeighbourhoods(seed, { boulevards }) {
  const friction = createNoise(seed, 'neighbourhood-friction');
  const bendNoise = createNoise(seed, 'main-street-bend');
  const cache = new LruCache(4000);
  const crossings = new LruCache(60000);

  // Main street crossings of a shared greenway stretch: points and the unit
  // tangent of the stretch, in its canonical direction. A pure function of
  // the stretch, so both districts agree.
  function crossingsOf(geo) {
    let list = crossings.get(geo.key);
    if (list) return list;
    list = [];
    const pts = geo.points;
    const L = arcLength(pts);
    const span = L - 2 * EDGE_END;
    if (span > 0) {
      const k = Math.max(1, Math.round(span / EDGE_SPACING));
      const bp = boulevards.crossingOf(geo).p;
      for (let i = 0; i < k; i++) {
        const u = toUnit(hash(seed, 'street-crossing', hashString(geo.key), i));
        const s = EDGE_END + ((i + 0.5 + (u - 0.5) * 0.4) * span) / k;
        const p = along(pts, s);
        if (len(sub(p, bp)) < EDGE_CLEAR) continue;
        const t = unit(sub(along(pts, Math.min(L, s + 60)), along(pts, Math.max(0, s - 60))));
        list.push({ key: `${geo.key}#${i}`, p, t });
      }
    }
    crossings.set(geo.key, list);
    return list;
  }

  function of(d) {
    let out = cache.get(d.key);
    if (out) return out;
    out = build(d);
    cache.set(d.key, out);
    return out;
  }

  function build(d) {
    const rng = rngFor(seed, 'neighbourhoods', ...keyInts(d.coreInfo));
    const bb = d.bbox;
    const x0 = Math.floor(bb.x0 / CELL) * CELL;
    const y0 = Math.floor(bb.y0 / CELL) * CELL;
    const W = Math.ceil((bb.x1 - x0) / CELL) + 1;
    const H = Math.ceil((bb.y1 - y0) / CELL) + 1;
    const N = W * H;
    const cx = (n) => x0 + ((n % W) + 0.5) * CELL;
    const cy = (n) => y0 + (Math.floor(n / W) + 0.5) * CELL;
    const cellOf = (x, y) => {
      const i = Math.floor((x - x0) / CELL);
      const j = Math.floor((y - y0) / CELL);
      return i >= 0 && j >= 0 && i < W && j < H ? j * W + i : -1;
    };
    const S = d.station;

    // ---- Land ----
    const mask = new Uint8Array(N);
    fill(mask, W, H, x0, y0, d.ring, LAND);
    for (const p of d.parks) fill(mask, W, H, x0, y0, p.shape, PARK, LAND);
    // Land never touches the raster's border, so neighbours are always in range.
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (i === 0 || j === 0 || i === W - 1 || j === H - 1) mask[j * W + i] = 0;
    const land = [];
    for (let n = 0; n < N; n++) if (mask[n] === LAND) land.push(n);
    const coreCells = Math.max(20, (Math.PI * d.coreRadius * d.coreRadius) / (CELL * CELL));
    const count = 1 + Math.min(NEIGHBOURHOODS[1], Math.max(NEIGHBOURHOODS[0], Math.round((land.length - coreCells) * CELL * CELL / NEIGHBOURHOOD_AREA)));

    // Distance from the district's greenways (and parks), so centres keep off them.
    const edgeSrc = new Uint8Array(N);
    for (let n = 0; n < N; n++) if (mask[n] !== LAND) edgeSrc[n] = 1;
    const fromEdge = distanceField(edgeSrc, W, H);

    // ---- Centres ----
    // The core first, then centres along the boulevards, then the rest.
    const centres = [[S[0], S[1]]];
    const onBoulevard = [{ t: null }];
    const spacing = Math.sqrt(NEIGHBOURHOOD_AREA) * 1.05;
    const farFrom = (p, r) => centres.every((c) => len(sub(c, p)) >= r);
    const lines = d.network.lines.filter((l) => l.kind !== 'roundabout').slice().sort((a, b) => (a.key < b.key ? -1 : 1));
    for (const l of lines) {
      const q = l.points;
      for (let i = 3; i < q.length - 3 && centres.length < count; i += 3) {
        const n = cellOf(q[i][0], q[i][1]);
        if (n < 0 || mask[n] !== LAND || fromEdge[n] < 300) continue;
        if (len(sub(q[i], S)) < spacing * 1.1 || !farFrom(q[i], spacing)) continue;
        centres.push(q[i]);
        onBoulevard.push({ t: unit(sub(q[i + 3], q[i - 3])) });
      }
    }
    const fixed = centres.length;
    const sample = land.filter((n, k) => k % 3 === 0 && fromEdge[n] > 200);
    const pool = sample.length >= count * 4 ? sample : land;
    const nearest = new Float64Array(pool.length);
    for (let k = 0; k < pool.length; k++) {
      let m = Infinity;
      for (const c of centres) m = Math.min(m, Math.hypot(cx(pool[k]) - c[0], cy(pool[k]) - c[1]));
      nearest[k] = m;
    }
    while (centres.length < count) {
      let pick = pool[0];
      let best = -1;
      for (let k = 0; k < pool.length; k++) {
        if (nearest[k] > best) {
          best = nearest[k];
          pick = pool[k];
        }
      }
      const p = [cx(pick), cy(pick)];
      centres.push(p);
      onBoulevard.push({ t: null });
      for (let k = 0; k < pool.length; k++) nearest[k] = Math.min(nearest[k], Math.hypot(cx(pool[k]) - p[0], cy(pool[k]) - p[1]));
    }
    // Lloyd steps for the free centres; the fixed ones stay put.
    for (let it = 0; it < 4; it++) {
      const sx = new Float64Array(count);
      const sy = new Float64Array(count);
      const sn = new Float64Array(count);
      for (const n of pool) {
        const x = cx(n);
        const y = cy(n);
        let b = 0;
        let bd = Infinity;
        for (let k = 0; k < count; k++) {
          const dx = centres[k][0] - x;
          const dy = centres[k][1] - y;
          const dd = dx * dx + dy * dy;
          if (dd < bd) {
            bd = dd;
            b = k;
          }
        }
        sx[b] += x;
        sy[b] += y;
        sn[b]++;
      }
      const taken = new Set(centres.slice(0, fixed).map((c) => cellOf(c[0], c[1])));
      for (let k = fixed; k < count; k++) {
        if (!sn[k]) {
          taken.add(cellOf(centres[k][0], centres[k][1]));
          continue;
        }
        const tx = sx[k] / sn[k];
        const ty = sy[k] / sn[k];
        let b = null;
        let bd = Infinity;
        for (const n of pool) {
          const dx = cx(n) - tx;
          const dy = cy(n) - ty;
          const dd = dx * dx + dy * dy;
          if (dd < bd && !taken.has(n)) {
            bd = dd;
            b = n;
          }
        }
        taken.add(b);
        centres[k] = [cx(b), cy(b)];
      }
    }

    // ---- Growth ----
    const label = new Int16Array(N).fill(OUTSIDE);
    const cost = new Float64Array(N).fill(Infinity);
    const fr = new Float64Array(N);
    for (const n of land) {
      const f = friction.fbm(cx(n) / 700, cy(n) / 700, 3, 2.2, 0.55);
      fr[n] = 1 + Math.max(-0.5, Math.min(0.7, f * 1.3));
    }
    const OFF = N8.map(([di, dj]) => dj * W + di);
    const STEP = N8.map(([, , w]) => CELL * w * 0.5);
    const done = new Uint8Array(N);
    let seedCells = centres.map((p) => cellOf(p[0], p[1]));
    const isSeed = new Uint8Array(N);
    for (const n of seedCells) if (n >= 0) isSeed[n] = 1;
    function grow(speed) {
      label.fill(OUTSIDE);
      cost.fill(Infinity);
      done.fill(0);
      const heap = new Heap();
      seedCells.forEach((n, k) => {
        if (n < 0 || mask[n] !== LAND) return;
        cost[n] = 0;
        label[n] = k;
        heap.push(cost[n], n);
      });
      while (heap.size) {
        const n = heap.pop();
        if (done[n]) continue;
        done[n] = 1;
        for (let q = 0; q < 8; q++) {
          const m = n + OFF[q];
          if (mask[m] !== LAND || done[m] || isSeed[m]) continue;
          const c = cost[n] + STEP[q] * (fr[n] + fr[m]) * speed[label[n]];
          if (c < cost[m]) {
            cost[m] = c;
            label[m] = label[n];
            heap.push(c, m);
          }
        }
      }
    }
    // Grow, then even out the sizes by making big neighbourhoods spread more
    // slowly: the core aims for its own size, the rest share what is left. A
    // centre left with almost no land is dropped.
    const speed = centres.map(() => rng.range(0.92, 1.08));
    for (let it = 0; it < 5; it++) {
      grow(speed);
      const m = centres.length;
      const share = (land.length - coreCells) / (m - 1);
      const target = (k) => (k === 0 ? coreCells : share);
      const size = new Float64Array(m);
      for (const n of land) if (label[n] >= 0) size[label[n]]++;
      let small = -1;
      for (let k = 1; k < m; k++) if (size[k] < share * 0.3 && (small < 0 || size[k] < size[small])) small = k;
      if (small >= 0 && it < 4 && m > 3) {
        isSeed[seedCells[small]] = 0;
        for (const arr of [centres, seedCells, speed, onBoulevard]) arr.splice(small, 1);
        continue;
      }
      if (it >= 2) break;
      for (let k = 0; k < m; k++) speed[k] = Math.max(0.4, Math.min(2.5, speed[k] * (size[k] / target(k)) ** 0.4));
    }
    const total = centres.length;
    // Single cells cut off from their own kind join their neighbours.
    for (const n of land) {
      if (isSeed[n]) continue;
      const own = label[n];
      const ns = [label[n - 1], label[n + 1], label[n - W], label[n + W]];
      if (ns.includes(own)) continue;
      const counts = new Map();
      for (const l of ns) if (l !== OUTSIDE) counts.set(l, (counts.get(l) || 0) + 1);
      let best = own;
      let bc = 0;
      for (const [l, c] of [...counts].sort((a, b) => a[0] - b[0])) {
        if (c > bc) {
          best = l;
          bc = c;
        }
      }
      label[n] = best;
    }

    const { chains, polygons } = trace(label, W, H, x0, y0, total);
    const hoods = centres.map((c, k) => {
      // The outer ring; any others are holes around another neighbourhood.
      const rings = polygons[k] || [];
      const poly = rings[0] || [];
      const holes = rings.slice(1);
      const area = poly.length > 2 ? polygonArea(poly) - holes.reduce((a, r) => a + (r.length > 2 ? polygonArea(r) : 0), 0) : 0;
      return { id: k, key: `${d.key}:n${k}`, core: k === 0, centre: c, onBoulevard: onBoulevard[k].t, polygon: poly, holes, area };
    });

    const streets = mainStreets(d, rng, hoods, chains, { mask, label, W, H, x0, y0, N, fromEdge, cellOf });
    return { hoods, chains, ...streets };
  }

  // ---- Boundary tracing ----

  // Directed cell edges with each label on its right (clockwise on screen),
  // joined into loops, split into chains where the label across changes or
  // three regions meet. Each chain is smoothed once in a fixed direction.
  function trace(label, W, H, x0, y0, count) {
    const CW = W + 1;
    const at = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? OUTSIDE : label[j * W + i]);
    const from = [];
    const to = [];
    const own = [];
    const across = [];
    const out = new Map();
    const addEdge = (a, b, l, x) => {
      const e = from.length;
      from.push(a);
      to.push(b);
      own.push(l);
      across.push(x);
      const k = a * 16 + l;
      let list = out.get(k);
      if (!list) out.set(k, (list = []));
      list.push(e);
    };
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const l = label[j * W + i];
        if (l === OUTSIDE) continue;
        const c00 = j * CW + i;
        const c10 = c00 + 1;
        const c01 = c00 + CW;
        const c11 = c01 + 1;
        let x = at(i, j - 1);
        if (x !== l) addEdge(c00, c10, l, x);
        x = at(i + 1, j);
        if (x !== l) addEdge(c10, c11, l, x);
        x = at(i, j + 1);
        if (x !== l) addEdge(c11, c01, l, x);
        x = at(i - 1, j);
        if (x !== l) addEdge(c01, c00, l, x);
      }
    }
    const cxy = (c) => [x0 + (c % CW) * CELL, y0 + Math.floor(c / CW) * CELL];
    const dirOf = (e) => {
      const a = cxy(from[e]);
      const b = cxy(to[e]);
      return [b[0] - a[0], b[1] - a[1]];
    };
    // Corners where three or more regions (counting outside as one) meet.
    const junction = (c) => {
      const i = c % CW;
      const j = Math.floor(c / CW);
      const v = new Set([at(i - 1, j - 1), at(i, j - 1), at(i - 1, j), at(i, j)]);
      return v.size >= 3;
    };

    const used = new Uint8Array(from.length);
    const loopsOf = Array.from({ length: count }, () => []);
    for (let e0 = 0; e0 < from.length; e0++) {
      if (used[e0]) continue;
      const loop = [];
      let e = e0;
      while (e !== undefined && !used[e]) {
        used[e] = 1;
        loop.push(e);
        const cands = (out.get(to[e] * 16 + own[e]) || []).filter((f) => !used[f]);
        if (cands.length <= 1) {
          e = cands[0];
          continue;
        }
        // At a pinch, turn right to keep the region to itself.
        const din = dirOf(e);
        let best = -Infinity;
        for (const f of cands) {
          const dout = dirOf(f);
          const cr = din[0] * dout[1] - din[1] * dout[0];
          if (cr > best) [best, e] = [cr, f];
        }
      }
      if (loop.length > 2) loopsOf[own[e0]].push(loop);
    }

    const chains = new Map();
    const polygons = [];
    for (let l = 0; l < count; l++) {
      const rings = [];
      for (const loop of loopsOf[l]) {
        const m = loop.length;
        const breaks = [];
        for (let t = 0; t < m; t++) {
          const prev = loop[(t - 1 + m) % m];
          if (across[loop[t]] !== across[prev] || junction(from[loop[t]])) breaks.push(t);
        }
        const pts = [];
        const pieces = [];
        if (!breaks.length) {
          pieces.push({ corners: loop.map((e) => from[e]).concat([from[loop[0]]]), other: across[loop[0]], closed: true });
        } else {
          for (let b = 0; b < breaks.length; b++) {
            const s = breaks[b];
            const e = b + 1 < breaks.length ? breaks[b + 1] : breaks[0] + m;
            const corners = [];
            for (let t = s; t < e; t++) corners.push(from[loop[t % m]]);
            corners.push(to[loop[(e - 1) % m]]);
            pieces.push({ corners, other: across[loop[s]], closed: false });
          }
        }
        for (const pc of pieces) {
          const g = sharedChain(chains, l, pc, cxy);
          const op = g.oriented(pc);
          for (let i = 0; i < op.length - 1; i++) pts.push(op[i]);
        }
        rings.push(pts);
      }
      rings.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
      polygons.push(rings);
    }
    return { chains: [...chains.values()], polygons };
  }

  function sharedChain(chains, l, pc, cxy) {
    let canon = pc.corners;
    if (pc.closed) {
      const ring = canon.slice(0, -1);
      let m = 0;
      for (let i = 1; i < ring.length; i++) if (ring[i] < ring[m]) m = i;
      const fwd = ring.slice(m).concat(ring.slice(0, m));
      const back = [fwd[0], ...fwd.slice(1).reverse()];
      canon = (fwd[1] < back[1] ? fwd : back).concat([fwd[0]]);
    } else if (canon[0] > canon[canon.length - 1]) {
      canon = canon.slice().reverse();
    }
    const a = Math.min(l, pc.other);
    const b = Math.max(l, pc.other);
    const key = `${a}|${b}|${canon[0]}|${canon[canon.length - 1]}|${canon.length}`;
    let g = chains.get(key);
    if (!g) {
      let pts = canon.map(cxy);
      if (pc.closed) {
        pts = simplify(pts, SMOOTH_TOL).slice(0, -1);
        if (pts.length < 3) pts = canon.slice(0, -1).map(cxy);
        for (let k = 0; k < 4; k++) pts = chaikin(pts, true);
        pts.push(pts[0]);
      } else {
        pts = simplify(pts, SMOOTH_TOL);
        for (let k = 0; k < 4; k++) pts = chaikin(pts, false);
      }
      const first = canon[0];
      g = {
        key,
        a,
        b,
        points: pts,
        length: pts.reduce((s, p, i) => (i ? s + len(sub(p, pts[i - 1])) : 0), 0),
        oriented(piece) {
          if (piece.closed) {
            // Closed chains: follow the piece's own winding.
            const sameWay = signedArea(pts) > 0 === signedArea(piece.corners.map(cxy)) > 0;
            return sameWay ? pts : pts.slice().reverse();
          }
          return piece.corners[0] === first ? pts : pts.slice().reverse();
        },
      };
      chains.set(key, g);
    }
    return g;
  }

  // ---- Main streets ----

  function mainStreets(d, rng, hoods, chains, grid) {
    const S = d.station;
    const n = hoods.length;
    const nodes = hoods.map((h) => ({ kind: h.core ? 'core' : 'centre', p: h.centre, hood: h.id, t: h.onBoulevard }));
    const P = (k) => nodes[k].p;
    const edges = [];
    const has = new Set();
    const pairKey = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
    const addEdge = (a, b, kind) => {
      const k = pairKey(a, b);
      if (has.has(k)) return false;
      has.add(k);
      edges.push({ a, b, kind });
      return true;
    };
    const bvdLines = d.network.lines;
    const nearBoulevard = (p, r) => bvdLines.some((l) => distToLine(p[0], p[1], l.points) < r);

    // Neighbours: neighbourhoods sharing enough boundary.
    const shared = new Map();
    for (const c of chains) {
      if (c.a < 0 || c.b < 0) continue;
      const k = `${c.a}-${c.b}`;
      shared.set(k, (shared.get(k) || 0) + c.length);
    }
    const adj = [];
    for (const [k, L] of shared) {
      if (L < MIN_SHARED) continue;
      const [a, b] = k.split('-').map(Number);
      adj.push({ a, b, w: len(sub(P(a), P(b))) });
    }
    adj.sort((p, q) => p.w - q.w || p.a - q.a || p.b - q.b);
    const adjOf = (k) => adj.filter((e) => e.a === k || e.b === k);

    // Radials: with the boulevards leaving the station, 4 to 6 tram streets
    // run into the core. Each goes straight to a neighbouring centre.
    const arms = [];
    for (const l of bvdLines) {
      if (l.kind === 'roundabout') continue;
      const q = l.points;
      const i = q.findIndex((p) => len(sub(p, S)) < 1);
      if (i < 0) continue;
      // Directions taken a few hundred metres out, where streets part company.
      const out = (step) => {
        let j = i;
        while (j + step >= 0 && j + step < q.length && len(sub(q[j], S)) < 300) j += step;
        return unit(sub(q[j], S));
      };
      if (i > 0) arms.push(out(-1));
      if (i < q.length - 1) arms.push(out(1));
    }
    const want = Math.max(0, rng.int(CORE_ARMS[0], CORE_ARMS[1]) - arms.length);
    const dirs = arms.slice();
    const touching = new Set(adjOf(0).map((e) => (e.a === 0 ? e.b : e.a)));
    const options = hoods.map((h) => h.id).filter((k) => k > 0 && (touching.has(k) || len(sub(P(k), S)) < 1600));
    let radials = 0;
    while (radials < want) {
      let best = null;
      for (const k of options) {
        if (has.has(pairKey(0, k))) continue;
        const u = unit(sub(P(k), S));
        const gap = dirs.length ? Math.min(...dirs.map((v) => Math.acos(Math.max(-1, Math.min(1, dot(u, v)))))) : Math.PI;
        if (!best || gap > best.gap) best = { k, gap, u };
      }
      if (!best || best.gap < (35 * Math.PI) / 180) break;
      addEdge(0, best.k, 'radial');
      dirs.push(best.u);
      radials++;
    }

    // Cross-links: neighbours with no other centre between them (a relative
    // neighbourhood graph), so links are short and do not cross. The core is
    // reached by its radials and boulevards, and a link that would only
    // double a boulevard is left out.
    for (const e of adj) {
      if (e.a === 0 || e.b === 0) continue;
      let blocked = false;
      for (let c = 0; c < n && !blocked; c++) {
        if (c === e.a || c === e.b) continue;
        blocked = Math.max(len(sub(P(c), P(e.a))), len(sub(P(c), P(e.b)))) < e.w;
      }
      if (blocked) continue;
      const mid = [(P(e.a)[0] + P(e.b)[0]) / 2, (P(e.a)[1] + P(e.b)[1]) / 2];
      if (nodes[e.a].t && nodes[e.b].t && nearBoulevard(mid, 150)) continue;
      addEdge(e.a, e.b, 'link');
    }

    // Greenway crossings into the neighbouring districts: each joins the
    // centre of the neighbourhood it leads into.
    for (const c of d.chains) {
      const same = c.points === c.geo.points;
      for (const x of crossingsOf(c.geo)) {
        const tx = same ? x.t[0] : -x.t[0];
        const ty = same ? x.t[1] : -x.t[1];
        const nrm = [ty, -tx];
        let home = OUTSIDE;
        for (let r = 60; r < 600 && home === OUTSIDE; r += CELL) {
          const cell = grid.cellOf(x.p[0] + nrm[0] * r, x.p[1] + nrm[1] * r);
          if (cell >= 0) home = grid.label[cell];
        }
        if (home === OUTSIDE) home = nearestCentre(hoods, x.p);
        nodes.push({ kind: 'edge', p: x.p, n: nrm, key: x.key, neighbour: c.neighbour });
        addEdge(nodes.length - 1, home, 'crossing');
      }
    }

    // Everything connects to the core (boulevard centres already do, by boulevard).
    const parent = nodes.map((_, i) => i);
    const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    const join = (a, b) => {
      parent[root(a)] = root(b);
    };
    for (let k = 1; k < n; k++) if (nodes[k].t) join(k, 0);
    for (const e of edges) if (nodes[e.a].kind !== 'edge') join(e.a, e.b);
    for (const e of adj) {
      if (root(e.a) === root(e.b)) continue;
      join(e.a, e.b);
      addEdge(e.a, e.b, 'link');
    }

    // Each free centre gets a street running through it, not ending there.
    // Centres on a boulevard have one already.
    const dirsAt = (k) => edges.filter((e) => e.a === k || e.b === k).map((e) => unit(sub(P(e.a === k ? e.b : e.a), P(k))));
    const through = (k) => {
      const ds = dirsAt(k);
      for (let i = 0; i < ds.length; i++) for (let j = i + 1; j < ds.length; j++) if (dot(ds[i], ds[j]) < -0.3) return true;
      return false;
    };
    for (let k = 1; k < n; k++) {
      if (nodes[k].t || through(k)) continue;
      const ds = dirsAt(k);
      let best = null;
      for (const e of adjOf(k)) {
        const o = e.a === k ? e.b : e.a;
        if (o === 0 || has.has(pairKey(k, o))) continue;
        const u = unit(sub(P(o), P(k)));
        const opp = ds.length ? Math.max(...ds.map((v) => -dot(v, u))) : 1;
        if (!best || opp > best.opp) best = { o, opp };
      }
      if (best && (best.opp > 0.3 || ds.length < 2)) {
        addEdge(k, best.o, 'link');
        continue;
      }
      if (ds.length) {
        // No neighbour on the far side: carry on to the nearest boulevard that way.
        const away = unit(ds.reduce((a, v) => [a[0] - v[0], a[1] - v[1]], [0, 0]));
        const hit = boulevardAhead(d, P(k), away);
        if (hit) {
          nodes.push({ kind: 'boulevard', p: hit.p, t: hit.t });
          addEdge(k, nodes.length - 1, 'spur');
        }
      }
    }
    // Last resort against dead ends: link to the nearest other centre.
    for (let k = 1; k < n; k++) {
      if (nodes[k].t || dirsAt(k).length >= 2) continue;
      const others = hoods.map((h) => h.id).filter((o) => o !== k && !has.has(pairKey(k, o)));
      others.sort((a, b) => len(sub(P(a), P(k))) - len(sub(P(b), P(k))) || a - b);
      if (others.length) addEdge(k, others[0], 'link');
    }

    // Fill land still too far from a tram street with whichever extra link
    // (or link to a boulevard) covers most of it.
    const cover = new Uint8Array(grid.N);
    for (const l of bvdLines) stamp(cover, grid.W, grid.H, grid.x0, grid.y0, l.points);
    let lines = geometry(d, nodes, edges);
    for (const l of lines) stamp(cover, grid.W, grid.H, grid.x0, grid.y0, l.points);
    const landCount = grid.mask.reduce((c, v) => c + (v === LAND ? 1 : 0), 0);
    for (let it = 0; it < 8; it++) {
      const gap = uncovered(cover, grid);
      if (gap.count <= landCount * 0.003) break;
      const cands = [];
      for (const e of adj) if (e.a !== 0 && e.b !== 0 && !has.has(pairKey(e.a, e.b))) cands.push({ a: e.a, b: e.b, pts: [P(e.a), P(e.b)] });
      const closest = hoods.map((h) => h.id).sort((a, b) => len(sub(P(a), gap.worst)) - len(sub(P(b), gap.worst)) || a - b).slice(0, 3);
      for (const k of closest) {
        const hit = boulevardAhead(d, P(k), unit(sub(gap.worst, P(k))));
        if (hit) cands.push({ a: k, bvd: hit, pts: [P(k), hit.p] });
      }
      // Score each candidate by the uncovered land its straight line would reach.
      let best = null;
      for (const c of cands) {
        let gain = 0;
        const bx0 = Math.min(c.pts[0][0], c.pts[1][0]) - MAIN_STREET_REACH;
        const bx1 = Math.max(c.pts[0][0], c.pts[1][0]) + MAIN_STREET_REACH;
        const by0 = Math.min(c.pts[0][1], c.pts[1][1]) - MAIN_STREET_REACH;
        const by1 = Math.max(c.pts[0][1], c.pts[1][1]) + MAIN_STREET_REACH;
        for (const [x, y] of gap.cells) if (x > bx0 && x < bx1 && y > by0 && y < by1 && distToLine(x, y, c.pts) <= MAIN_STREET_REACH) gain++;
        if (gain >= 3 && (!best || gain > best.gain)) best = { c, gain };
      }
      if (!best) break;
      const c = best.c;
      if (c.bvd) {
        nodes.push({ kind: 'boulevard', p: c.bvd.p, t: c.bvd.t });
        addEdge(c.a, nodes.length - 1, 'spur');
      } else {
        addEdge(c.a, c.b, 'link');
      }
      const added = geometry(d, nodes, edges, [edges.length - 1])[0];
      stamp(cover, grid.W, grid.H, grid.x0, grid.y0, added.points);
    }
    lines = geometry(d, nodes, edges);

    const degree = nodes.map(() => 0);
    for (const e of edges) {
      degree[e.a]++;
      degree[e.b]++;
    }
    return { nodes, edges, lines, degree, radials, arms: arms.length + radials };
  }

  function nearestCentre(hoods, p) {
    let b = 0;
    for (let k = 1; k < hoods.length; k++) if (len(sub(hoods[k].centre, p)) < len(sub(hoods[b].centre, p))) b = k;
    return b;
  }

  // First boulevard point within reach in a direction (a cone of about ±35°).
  function boulevardAhead(d, p, dir) {
    let best = null;
    for (const l of d.network.lines) {
      const q = l.points;
      for (let i = 1; i < q.length - 1; i += 2) {
        const v = sub(q[i], p);
        const r = len(v);
        if (r < 120 || r > 1100) continue;
        if (dot(v, dir) / r < 0.82) continue;
        if (!best || r < best.r) best = { r, p: q[i], t: unit(sub(q[i + 1], q[i - 1])) };
      }
    }
    return best;
  }

  function geometry(d, nodes, edges, only = null) {
    // Through direction at each free centre: from its most opposite pair of streets.
    const thru = nodes.map(() => null);
    const pair = nodes.map(() => null);
    nodes.forEach((nd, k) => {
      if (nd.kind !== 'centre' || nd.t) return;
      const mine = edges.filter((e) => e.a === k || e.b === k);
      const target = (e) => nodes[e.a === k ? e.b : e.a].p;
      let best = null;
      for (let i = 0; i < mine.length; i++) {
        for (let j = i + 1; j < mine.length; j++) {
          const u = unit(sub(target(mine[i]), nd.p));
          const v = unit(sub(target(mine[j]), nd.p));
          if (!best || dot(u, v) < best.c) best = { c: dot(u, v), u, v, i: mine[i], j: mine[j] };
        }
      }
      if (best && best.c < -0.2) {
        thru[k] = unit(sub(best.u, best.v));
        pair[k] = [best.i, best.j];
      }
    });
    // Unit direction a street leaves node k in, heading for `toward`.
    const tangentAt = (k, e, toward) => {
      const nd = nodes[k];
      const u = unit(sub(toward, nd.p));
      if (nd.kind === 'core') return u;
      if (nd.kind === 'edge') return nd.n;
      if (nd.t) {
        // Meet a boulevard at right angles, unless the street runs along it.
        let a = [-nd.t[1], nd.t[0]];
        if (dot(a, u) < 0) a = [-a[0], -a[1]];
        return dot(a, u) > 0.5 ? a : unit([a[0] + u[0], a[1] + u[1]]);
      }
      if (thru[k] && pair[k].includes(e)) {
        const t = dot(thru[k], u) >= 0 ? thru[k] : [-thru[k][0], -thru[k][1]];
        // Follow the through line only where it roughly points the right way.
        if (dot(t, u) > 0.7) return t;
        return unit([t[0] + u[0], t[1] + u[1]]);
      }
      return u;
    };
    return (only || edges.map((_, i) => i)).map((idx) => {
      const e = edges[idx];
      const A = nodes[e.a];
      const B = nodes[e.b];
      // A greenway crossing starts with a straight stub across the greenway.
      let stub = null;
      let pa = A.p;
      if (A.kind === 'edge') {
        stub = [A.p, [A.p[0] + A.n[0] * STUB, A.p[1] + A.n[1] * STUB]];
        pa = stub[1];
      }
      const ta = tangentAt(e.a, e, B.p);
      const tb = tangentAt(e.b, e, pa);
      const knots = [{ p: pa, d: ta }, { p: B.p, d: [-tb[0], -tb[1]] }];
      let pts = null;
      const straight = e.kind === 'radial';
      for (const amount of straight ? [0.04, 0] : [1, 0.5, 0]) {
        pts = spline(bend(knots[0], knots[1], amount, idx));
        if (minRadius(pts) >= MAIN_STREET_RADIUS) break;
      }
      if (minRadius(pts) < MAIN_STREET_RADIUS) {
        for (const k of [0.6, 0.4]) {
          const soft = spline(knots.map((q) => ({ ...q, k })));
          if (minRadius(soft) >= MAIN_STREET_RADIUS) {
            pts = soft;
            break;
          }
        }
      }
      if (stub) pts = [stub[0]].concat(pts);
      return { key: `${d.key}:m${idx}`, kind: e.kind, points: pts, bbox: lineBox(pts), pieces: piecesOf(pts), a: e.a, b: e.b, crossing: A.kind === 'edge' ? A.key : null };
    });
  }

  function bend(a, b, amount, salt) {
    const v = sub(b.p, a.p);
    const L = len(v);
    if (L < 500 || amount === 0) return [a, b];
    const m = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2];
    const w = bendNoise.fbm(m[0] / 900 + salt * 0.21, m[1] / 900, 2);
    const off = Math.max(-0.14, Math.min(0.14, w * 0.3)) * L * amount;
    const u = unit(v);
    const pm = [m[0] - u[1] * off, m[1] + u[0] * off];
    return [a, { p: pm, d: unit([a.d[0] + b.d[0] + u[0] * 2, a.d[1] + b.d[1] + u[1] * 2]) }, b];
  }

  // Land more than MAIN_STREET_REACH from every main street and boulevard
  // (stamped into `cover`), ignoring the strip along the greenways.
  function uncovered(cover, g) {
    const far = distanceField(cover, g.W, g.H);
    let count = 0;
    let worst = null;
    let wd = 0;
    const cells = [];
    for (let n = 0; n < g.N; n++) {
      if (g.mask[n] !== LAND || g.fromEdge[n] < RING_MARGIN) continue;
      if (far[n] > MAIN_STREET_REACH) {
        count++;
        const p = [g.x0 + ((n % g.W) + 0.5) * CELL, g.y0 + (Math.floor(n / g.W) + 0.5) * CELL];
        cells.push(p);
        if (far[n] > wd) {
          wd = far[n];
          worst = p;
        }
      }
    }
    return { count, worst, far: wd, cells };
  }

  return { of, crossingsOf };
}
