// District growth. Every core spreads outward over a grid of jittered land
// parcels; a parcel joins whichever core reaches it first. Spreading is
// faster along boulevards and varies with a "terrain" field, so districts come
// out irregular and lobed, and fronts meet away from the routes. Each core
// also gets a small head start, which varies district sizes.
//
// Because this is a shortest-path spread, every district is one connected
// piece. Labels are computed per chunk of parcels, over a window with a wide
// margin, and each parcel is labelled by exactly one chunk, so a parcel's
// label is a pure function of its position.

import { hash, toUnit } from '../core/hash.js';
import { createNoise } from '../core/noise.js';
import { LruCache } from './cache.js';
import { FAMILIES, ROUTE_SPACING } from './routes.js';

export const PARCEL = 400; // metres between parcels
const CHUNK = 15; // parcels per chunk side (6 km)
const MARGIN = 11; // parcels of margin around a chunk's window
const JITTER = 0.35;
const ROAD_REACH = 260; // metres either side of a boulevard where growth is fast
const ROAD_FACTOR = 0.55;

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

class Heap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= k.length) break;
        if (c + 1 < k.length && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
  get size() {
    return this.k.length;
  }
}

export function createGrowth(seed, routes, cores) {
  const terrain = createNoise(seed, 'growth-terrain');
  const chunks = new LruCache(3000);

  function parcelPos(i, j) {
    return [
      (i + 0.5 + JITTER * (toUnit(hash(seed, 'parcel-x', i, j)) * 2 - 1)) * PARCEL,
      (j + 0.5 + JITTER * (toUnit(hash(seed, 'parcel-y', i, j)) * 2 - 1)) * PARCEL,
    ];
  }

  // Cost per metre of spreading through a point.
  function friction(x, y) {
    let fr = 0.7 + 0.75 * Math.min(1, Math.max(0, terrain.fbm(x / 3200, y / 3200, 2) * 0.8 + 0.5));
    for (let k = 0; k < FAMILIES; k++) {
      // Cheap screen in contour units first; only near a route is the exact distance needed.
      const v = routes.f(k, x, y);
      const n = Math.round(v);
      if (Math.abs(v - n) * ROUTE_SPACING > ROAD_REACH * 3.5 || !routes.exists(k, n)) continue;
      if (routes.distTo(k, n, x, y) < ROAD_REACH) {
        fr *= ROAD_FACTOR;
        break;
      }
    }
    return fr;
  }

  // Parcel positions and costs, cached per chunk so overlapping windows share them.
  const terrains = new LruCache(6000);
  function terrainChunk(ti, tj) {
    const key = `${ti},${tj}`;
    let t = terrains.get(key);
    if (t) return t;
    const n = CHUNK * CHUNK;
    t = { px: new Float64Array(n), py: new Float64Array(n), fr: new Float64Array(n) };
    for (let b = 0; b < CHUNK; b++) {
      for (let a = 0; a < CHUNK; a++) {
        const m = b * CHUNK + a;
        const [x, y] = parcelPos(ti * CHUNK + a, tj * CHUNK + b);
        t.px[m] = x;
        t.py[m] = y;
        t.fr[m] = friction(x, y);
      }
    }
    terrains.set(key, t);
    return t;
  }

  // Labels (core keys) for one chunk's parcels.
  function chunk(ci, cj) {
    const key = `${ci},${cj}`;
    let c = chunks.get(key);
    if (c) return c;
    const W = CHUNK + 2 * MARGIN;
    const i0 = ci * CHUNK - MARGIN;
    const j0 = cj * CHUNK - MARGIN;
    const N = W * W;
    const px = new Float64Array(N);
    const py = new Float64Array(N);
    const fr = new Float64Array(N);
    for (let b = 0; b < W; b++) {
      for (let a = 0; a < W; a++) {
        const i = i0 + a;
        const j = j0 + b;
        const ti = Math.floor(i / CHUNK);
        const tj = Math.floor(j / CHUNK);
        const t = terrainChunk(ti, tj);
        const m = (j - tj * CHUNK) * CHUNK + (i - ti * CHUNK);
        const n = b * W + a;
        px[n] = t.px[m];
        py[n] = t.py[m];
        fr[n] = t.fr[m];
      }
    }
    const dist = new Float64Array(N).fill(Infinity);
    const label = new Array(N).fill(null);
    const heap = new Heap();
    const wx0 = i0 * PARCEL;
    const wy0 = j0 * PARCEL;
    const list = cores.coresInRect(wx0 - PARCEL, wy0 - PARCEL, wx0 + (W + 1) * PARCEL, wy0 + (W + 1) * PARCEL);
    // Sort sources so ties always resolve the same way.
    list.sort((a, b) => (a.key < b.key ? -1 : 1));
    for (const core of list) {
      const a = Math.min(W - 1, Math.max(0, Math.floor(core.x / PARCEL) - i0));
      const b = Math.min(W - 1, Math.max(0, Math.floor(core.y / PARCEL) - j0));
      const n = b * W + a;
      const d = core.headStart + Math.hypot(px[n] - core.x, py[n] - core.y) * fr[n];
      if (d < dist[n]) {
        dist[n] = d;
        label[n] = core.key;
        heap.push(d, n);
      }
    }
    const done = new Uint8Array(N);
    while (heap.size) {
      const n = heap.pop();
      if (done[n]) continue;
      done[n] = 1;
      const a = n % W;
      const b = (n - a) / W;
      for (const [da, db] of NEIGHBOURS) {
        const a2 = a + da;
        const b2 = b + db;
        if (a2 < 0 || b2 < 0 || a2 >= W || b2 >= W) continue;
        const m = b2 * W + a2;
        if (done[m]) continue;
        const d = dist[n] + Math.hypot(px[m] - px[n], py[m] - py[n]) * 0.5 * (fr[n] + fr[m]);
        if (d < dist[m] || (d === dist[m] && label[n] < label[m])) {
          dist[m] = d;
          label[m] = label[n];
          heap.push(d, m);
        }
      }
    }
    const out = new Array(CHUNK * CHUNK);
    for (let b = 0; b < CHUNK; b++) {
      for (let a = 0; a < CHUNK; a++) out[b * CHUNK + a] = label[(b + MARGIN) * W + (a + MARGIN)];
    }
    for (const core of list) coreIndex.set(core.key, core);
    c = { labels: out, cores: list };
    chunks.set(key, c);
    return c;
  }

  const coreIndex = new LruCache(200000);
  const finals = new LruCache(3000);

  function rawLabel(i, j) {
    const ci = Math.floor(i / CHUNK);
    const cj = Math.floor(j / CHUNK);
    return chunk(ci, cj).labels[(j - cj * CHUNK) * CHUNK + (i - ci * CHUNK)];
  }

  // Final label: a parcel unlike all eight neighbours joins their majority,
  // so no single-parcel slivers survive at chunk seams. Cached per chunk.
  function cleaned(i, j) {
    const own = rawLabel(i, j);
    const counts = new Map();
    for (const [da, db] of NEIGHBOURS) {
      const l = rawLabel(i + da, j + db);
      if (l === own) return own;
      counts.set(l, (counts.get(l) || 0) + 1);
    }
    let best = own;
    let bestN = 0;
    for (const [l, n] of counts) if (n > bestN || (n === bestN && l < best)) [best, bestN] = [l, n];
    return best;
  }

  let memoKey = null;
  let memo = null;
  function label(i, j) {
    const ci = Math.floor(i / CHUNK);
    const cj = Math.floor(j / CHUNK);
    const key = `${ci},${cj}`;
    if (key !== memoKey) {
      memo = finals.get(key);
      if (!memo) {
        memo = new Array(CHUNK * CHUNK);
        for (let b = 0; b < CHUNK; b++) {
          for (let a = 0; a < CHUNK; a++) memo[b * CHUNK + a] = cleaned(ci * CHUNK + a, cj * CHUNK + b);
        }
        finals.set(key, memo);
      }
      memoKey = key;
    }
    return memo[(j - cj * CHUNK) * CHUNK + (i - ci * CHUNK)];
  }

  // The core object for a label.
  const coreOf = (key) => coreIndex.get(key);

  return { parcelPos, friction, label, rawLabel, coreOf };
}
