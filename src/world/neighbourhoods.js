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
// Main streets (tram, 31 m) are laid out in mainStreets.js as an organic
// grid that takes in the boulevards and crosses the greenways at crossing
// points worked out here from each shared greenway alone, so neighbouring
// districts meet there exactly.

import { hash, hashString, toUnit } from '../core/hash.js';
import { rngFor } from '../core/rng.js';
import { createNoise } from '../core/noise.js';
import { LruCache } from './cache.js';
import { keyInts } from './cores.js';
import { Heap } from './growth.js';
import { createMainStreets } from './mainStreets.js';
import { fill, distanceField } from '../util/raster.js';
export { MAIN_STREET_REACH } from './mainStreets.js';
import { polygonArea, signedArea, simplify, chaikin } from '../util/geom.js';

export const NEIGHBOURHOOD_AREA = 0.75e6; // m², typical
export const NEIGHBOURHOODS = [8, 12]; // per district, besides the core
export const RING_MARGIN = 80; // land this close to a district's greenway is the greenway's
export const EDGE_SPACING = 850; // metres between main street crossings of a greenway
const EDGE_END = 420; // crossings keep this far from the ends of a greenway stretch
const EDGE_CLEAR = 380; // and this far from a boulevard crossing
const CELL = 50;
const SMOOTH_TOL = 32; // metres of raster staircase removed before smoothing
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

export function createNeighbourhoods(seed, { boulevards }) {
  const mainStreets = createMainStreets(seed);
  const friction = createNoise(seed, 'neighbourhood-friction');
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
    fill(CELL, mask, W, H, x0, y0, d.ring, LAND);
    for (const p of d.parks) fill(CELL, mask, W, H, x0, y0, p.shape, PARK, LAND);
    // Land never touches the raster's border, so neighbours are always in range.
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (i === 0 || j === 0 || i === W - 1 || j === H - 1) mask[j * W + i] = 0;
    const land = [];
    for (let n = 0; n < N; n++) if (mask[n] === LAND) land.push(n);
    const coreCells = Math.max(20, (Math.PI * d.coreRadius * d.coreRadius) / (CELL * CELL));
    const count = 1 + Math.min(NEIGHBOURHOODS[1], Math.max(NEIGHBOURHOODS[0], Math.round((land.length - coreCells) * CELL * CELL / NEIGHBOURHOOD_AREA)));

    // Distance from the district's greenways (and parks), so centres keep off them.
    const edgeSrc = new Uint8Array(N);
    for (let n = 0; n < N; n++) if (mask[n] !== LAND) edgeSrc[n] = 1;
    const fromEdge = distanceField(CELL, edgeSrc, W, H);

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

    // ---- Main streets ----
    // Greenway crossings, with the normal pointing into this district.
    const crossings = [];
    for (const c of d.chains) {
      const same = c.points === c.geo.points;
      for (const x of crossingsOf(c.geo)) {
        const tx = same ? x.t[0] : -x.t[0];
        const ty = same ? x.t[1] : -x.t[1];
        crossings.push({ key: x.key, p: x.p, n: [ty, -tx], neighbour: c.neighbour });
      }
    }
    for (const h of hoods) h.seed = h.centre;
    const streets = mainStreets(d, hoods, chains, { mask, label, W, H, x0, y0, N, fromEdge, cellOf }, crossings);
    return { hoods, chains, crossings, lines: streets.lines };
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

  return { of, crossingsOf };
}
