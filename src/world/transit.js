// Stage 5: regional rail and metro.
//
// Regional rail runs on viaducts, linking each district to its neighbour
// nearer the city centre (here the world's origin), so lines run out from
// the centre through every district; above the boulevards between the two
// stations. A district has its station at the core, and on a long run a
// second stop on the way out.
//
// The metro runs in tunnels, between neighbouring districts the rail does
// not join directly. Lines run straight on through stations (two lines
// through one cross about square, an interchange), with a station at each
// core and one more between each core and the next, about a kilometre
// apart, at a neighbourhood centre near the line where there is one.
//
// Each district works out its own half of every line, from its station to
// where the line crosses the greenway to the next district, so the two
// halves meet.

import { LruCache } from './cache.js';

const SECOND_STOP = 1100; // metres: a rail run in a district this long gets a second stop
const METRO_REACH = 260; // metres a neighbourhood centre may lie off the line for the station to be named after it
const THROUGH = -0.34; // links whose directions from the station are at least 110° apart make a line through

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const unit = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};

function lengthOf(P) {
  let L = 0;
  for (let i = 1; i < P.length; i++) L += len(sub(P[i], P[i - 1]));
  return L;
}
function pointAlong(P, s) {
  for (let i = 1; i < P.length; i++) {
    const l = len(sub(P[i], P[i - 1]));
    if (s <= l) return [P[i - 1][0] + ((P[i][0] - P[i - 1][0]) * s) / l, P[i - 1][1] + ((P[i][1] - P[i - 1][1]) * s) / l];
    s -= l;
  }
  return P[P.length - 1];
}

// The shortest way along a district's boulevards from a to b.
function route(lines, a, b) {
  const pts = [];
  const adj = [];
  const key = (q) => `${Math.round(q[0])},${Math.round(q[1])}`;
  const at = new Map();
  const node = (q) => {
    const k = key(q);
    if (at.has(k)) return at.get(k);
    at.set(k, pts.length);
    pts.push(q);
    adj.push([]);
    return pts.length - 1;
  };
  for (const L of lines) {
    let prev = -1;
    for (const q of L) {
      const n = node(q);
      if (prev >= 0 && prev !== n) {
        const w = len(sub(pts[prev], q));
        adj[prev].push([n, w]);
        adj[n].push([prev, w]);
      }
      prev = n;
    }
  }
  const nearest = (q) => {
    let best = -1;
    let bd = Infinity;
    pts.forEach((p, i) => {
      const r = len(sub(p, q));
      if (r < bd) [best, bd] = [i, r];
    });
    return best;
  };
  const s = nearest(a);
  const t = nearest(b);
  if (s < 0 || t < 0) return [a, b];
  const D = new Float64Array(pts.length).fill(Infinity);
  const from = new Int32Array(pts.length).fill(-1);
  const done = new Uint8Array(pts.length);
  D[s] = 0;
  // A binary heap of [distance, node].
  const heap = [[0, s]];
  const push = (e) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [du, u] = pop();
    if (done[u] || du > D[u]) continue;
    if (u === t) break;
    done[u] = 1;
    for (const [v, w] of adj[u]) {
      if (du + w < D[v]) {
        D[v] = du + w;
        from[v] = u;
        push([D[v], v]);
      }
    }
  }
  if (D[t] === Infinity) return [a, b];
  const out = [];
  for (let v = t; v >= 0; v = from[v]) out.push(pts[v]);
  return out.reverse();
}

// A cubic Hermite curve through points with given unit tangents, each
// span's tangents scaled to its length; sampled every few metres.
function hermite(P, T, step = 15) {
  const out = [P[0]];
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i];
    const b = P[i + 1];
    const D = len(sub(b, a));
    const k = D * 0.9;
    const m = Math.max(2, Math.ceil(D / step));
    for (let s = 1; s <= m; s++) {
      const t = s / m;
      const h00 = 2 * t ** 3 - 3 * t * t + 1;
      const h10 = t ** 3 - 2 * t * t + t;
      const h01 = -2 * t ** 3 + 3 * t * t;
      const h11 = t ** 3 - t * t;
      out.push([0, 1].map((c) => h00 * a[c] + h10 * k * T[i][c] + h01 * b[c] + h11 * k * T[i + 1][c]));
    }
  }
  return out;
}

function nearestIndex(P, q) {
  let best = 0;
  let bd = Infinity;
  P.forEach((p, i) => {
    const r = len(sub(p, q));
    if (r < bd) [best, bd] = [i, r];
  });
  return best;
}

// A smooth curve through points (Catmull-Rom), sampled every few metres.
function smooth(P, step = 15) {
  if (P.length < 3) return P;
  const out = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)];
    const p1 = P[i];
    const p2 = P[i + 1];
    const p3 = P[Math.min(P.length - 1, i + 2)];
    const k = Math.max(2, Math.ceil(len(sub(p2, p1)) / step));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([0, 1].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
    }
  }
  out.push(P[P.length - 1]);
  return out;
}

export function createTransit({ baseOf, network, centre = [0, 0] }) {
  const CENTRE = centre;
  const parents = new LruCache(20000);
  // The neighbour a district's rail runs to: the one nearest the centre, if
  // nearer than it.
  function parentOf(key) {
    const hit = parents.get(key);
    if (hit !== undefined) return hit;
    const b = baseOf(key);
    let best = null;
    if (b) {
      const here = len(sub(b.station, CENTRE));
      for (const l of network(b).links) {
        const nb = baseOf(l.neighbour);
        if (!nb) continue;
        const r = len(sub(nb.station, CENTRE));
        if (r < here - 150 && (!best || r < best.r)) best = { key: nb.key, r };
      }
    }
    const v = best ? best.key : null;
    parents.set(key, v);
    return v;
  }

  const cache = new LruCache(4000);
  function of(d) {
    let t = cache.get(d.key);
    if (t) return t;
    const S = d.station;
    const lines = d.network.lines.filter((l) => l.kind !== 'roundabout').map((l) => l.points);
    const rail = [];
    const railStops = [];
    const metro = [];
    const metroStops = [];
    const mine = parentOf(d.key);
    for (const l of d.network.links) {
      const isRail = l.neighbour === mine || parentOf(l.neighbour) === d.key;
      if (isRail) {
        // Above the boulevard from the station out to the greenway.
        const P = smooth(route(lines, S, l.p), 12);
        rail.push(P);
        const L = lengthOf(P);
        // One more stop on a long run towards the centre.
        if (l.neighbour === mine && L > SECOND_STOP) railStops.push({ p: pointAlong(P, L * 0.6), second: true });
      }
    }
    // ---- Metro ----
    // Every link the rail does not take has a metro line. At the station
    // the links pair up, each with the one most nearly opposite, so lines
    // run straight on through; two lines through one station cross about
    // square, an interchange. A link with no partner ends its line here.
    const mlinks = d.network.links.filter((l) => !(l.neighbour === mine || parentOf(l.neighbour) === d.key));
    const dirTo = (l) => unit(sub(l.p, S));
    const pairs = [];
    const left = mlinks.slice().sort((x, y) => (x.key < y.key ? -1 : 1));
    while (left.length >= 2) {
      let best = null;
      for (let i = 0; i < left.length; i++) {
        for (let j = i + 1; j < left.length; j++) {
          const c = dot(dirTo(left[i]), dirTo(left[j]));
          if (!best || c < best.c) best = { c, i, j };
        }
      }
      if (best.c > THROUGH) break;
      pairs.push([left[best.i], left[best.j]]);
      left.splice(best.j, 1);
      left.splice(best.i, 1);
    }
    for (const [a, b] of pairs) {
      // Smooth through the station, square to the greenway at each end.
      const through = unit(sub(b.p, a.p));
      const P = hermite([a.p, S, b.p], [a.n, through, [-b.n[0], -b.n[1]]]);
      metro.push(P);
    }
    for (const l of left) metro.push(hermite([S, l.p], [dirTo(l), [-l.n[0], -l.n[1]]]));
    // One station between this core and the next on each line, at a
    // neighbourhood centre near the way if there is one (kept by the
    // district with the lower key, so the two do not both add one).
    for (const l of mlinks) {
      if (d.key > l.neighbour) continue;
      const P = metro.find((L) => L.some((q) => len(sub(q, l.p)) < 1));
      if (!P) continue;
      // The half of the line from the station to this link's crossing.
      const iS = nearestIndex(P, S);
      const iE = nearestIndex(P, l.p);
      const half = iS <= iE ? P.slice(iS, iE + 1) : P.slice(iE, iS + 1).reverse();
      const L = lengthOf(half);
      if (L < 300) continue;
      let best = null;
      for (const h of d.stage3.hoods) {
        if (h.core) continue;
        const k = nearestIndex(half, h.centre);
        const along = lengthOf(half.slice(0, k + 1)) / L;
        const r = len(sub(half[k], h.centre));
        if (along < 0.35 || along > 0.95 || r > METRO_REACH) continue;
        if (!best || r < best.r) best = { r, p: half[k] };
      }
      metroStops.push({ p: best ? best.p : pointAlong(half, L * 0.75) });
    }
    if (rail.length) railStops.unshift({ p: S, second: false });
    metroStops.unshift({ p: S });
    t = { rail, railStops, metro, metroStops };
    cache.set(d.key, t);
    return t;
  }
  return { of, parentOf };
}
