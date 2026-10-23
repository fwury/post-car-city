// Stage 5: what is in a park.
//
// Parkettes: a path through, trees and benches; a playground in the bigger
// ones. Neighbourhood parks (after Queen's Park): a loop path inside the
// park, paths weaving across it, a playground, a splash pad and a skate park
// (as room allows), a games court, a washroom, a small dog run, community
// gardens, a fountain where paths meet, open lawn with trees here and there,
// and the neighbourhood's community centre built into its edge, on a
// street. District parks: all that and more, larger: playing fields, tennis
// and basketball courts, a full dog park, food kiosks, a pond, sometimes an
// outdoor pool or a woodland cemetery, woods, and trails between them.
// Secondary schools have their running track and field; elementary schools
// a playground and a small field.
//
// Features: { kind, pts } (polygons) or { kind, c, r } (circles); paths are
// polylines with a width.

import { insetUniform } from '../util/offset.js';
import { polygonArea, pointInPolygon, chaikin } from '../util/geom.js';
import { axesOf, rect } from './buildings.js';
import { STYLES } from './architecture.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const inside = (P, q) => pointInPolygon(q[0], q[1], P);

function segsCross(a, b, c, d) {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return false;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  return t > 0 && t < 1 && u > 0 && u < 1;
}
function overlap(A, B) {
  if (A.some((p) => inside(B, p)) || B.some((p) => inside(A, p))) return true;
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) if (segsCross(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true;
  return false;
}
function grow(R, g) {
  const c = R.reduce((a, p) => [a[0] + p[0] / R.length, a[1] + p[1] / R.length], [0, 0]);
  return R.map((p) => {
    const d = sub(p, c);
    const l = len(d) || 1;
    return [p[0] + (d[0] / l) * g, p[1] + (d[1] / l) * g];
  });
}
function circlePts(c, r, k = 20) {
  const out = [];
  for (let i = 0; i < k; i++) out.push([c[0] + Math.cos((i / k) * Math.PI * 2) * r, c[1] + Math.sin((i / k) * Math.PI * 2) * r]);
  return out;
}
function bezier(a, c, b, k = 12) {
  const out = [];
  for (let i = 0; i <= k; i++) {
    const t = i / k;
    out.push([(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]]);
  }
  return out;
}
function nearestOnRing(R, q) {
  let best = null;
  for (let i = 0; i < R.length; i++) {
    const a = R[i];
    const ab = sub(R[(i + 1) % R.length], a);
    const l2 = dot(ab, ab);
    const t = l2 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2)) : 0;
    const f = [a[0] + ab[0] * t, a[1] + ab[1] * t];
    const r = len(sub(f, q));
    if (!best || r < best.r) best = { p: f, r };
  }
  return best;
}

// A park being laid out: what is placed so far, and the paths.
class Site {
  constructor(P, rng, margin = 6) {
    this.P = P;
    this.rng = rng;
    this.inner = insetUniform(P, margin) || P;
    this.ax = axesOf(P);
    this.features = [];
    this.paths = [];
    this.solid = []; // polygons nothing else may overlap
    this.treeOk = new Set(); // ... of which trees may stand in these
  }

  clearOfPaths(R, gap) {
    const G = grow(R, gap);
    for (const { pts } of this.paths) for (const q of pts) if (inside(G, q)) return false;
    return true;
  }

  fits(R, gap = 3) {
    if (!R.every((q) => inside(this.inner, q))) return false;
    const G = grow(R, gap);
    if (this.solid.some((S) => overlap(G, S))) return false;
    return this.clearOfPaths(R, 2.5);
  }

  // Place an l x w rectangle (or a circle of radius l when w is 0).
  place(kind, l, w, opts = {}) {
    const { u } = this.ax;
    const v = [-u[1], u[0]];
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of this.inner) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    const tries = opts.tries || 80;
    let best = null;
    for (let t = 0; t < tries; t++) {
      const c = [x0 + (x1 - x0) * this.rng.next(), y0 + (y1 - y0) * this.rng.next()];
      if (!inside(this.inner, c)) continue;
      const dir = this.rng.next() < 0.5 ? u : v;
      const R = w ? rect(c, dir, l, w) : circlePts(c, l, 16);
      if (!this.fits(R, opts.gap ?? 3)) continue;
      const score = opts.score ? opts.score(c) : 0;
      if (!best || score < best.score) best = { R, c, score };
      if (!opts.score) break;
    }
    if (!best) return null;
    const f = w ? { kind, pts: best.R } : { kind, c: best.c, r: l };
    this.features.push(f);
    this.solid.push(best.R);
    if (opts.trees) this.treeOk.add(best.R);
    return f;
  }

  path(pts, width = 3) {
    if (pts.length < 2) return;
    this.paths.push({ pts, width });
  }

  // A path from a to b with a gentle bend; kept if it stays in the park
  // and off what is placed.
  bend(a, b, width = 3, sway = 0.25) {
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const d = sub(b, a);
    const n = [-d[1], d[0]];
    for (const k of [(this.rng.next() - 0.5) * sway * 2, (this.rng.next() - 0.5) * sway, 0]) {
      const pts = bezier(a, [m[0] + n[0] * k, m[1] + n[1] * k], b, Math.max(6, Math.ceil(len(d) / 8)));
      if (pts.slice(1, -1).every((q) => inside(this.P, q)) && !this.solid.some((S) => pts.some((q) => inside(S, q)))) {
        this.path(pts, width);
        return pts;
      }
    }
    return null;
  }

  // Trees scattered with at least `gap` between them, off paths and features.
  trees(gap, keep = () => true, max = 4000) {
    const out = [];
    const cell = gap / Math.SQRT2;
    const grid = new Map();
    const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of this.P) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    const attempts = Math.min(max * 4, Math.ceil(((x1 - x0) * (y1 - y0)) / (gap * gap)) * 3);
    // What trees keep off: placed things (grown a little) and path points,
    // the latter by grid cell.
    const blocked = this.solid.filter((S) => !this.treeOk.has(S)).map((S) => grow(S, 2));
    const PC = 8;
    const pathCells = new Set();
    for (const { pts } of this.paths) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const k = Math.max(1, Math.ceil(len(sub(b, a)) / 3));
        for (let j = 0; j <= k; j++) pathCells.add(`${Math.floor((a[0] + ((b[0] - a[0]) * j) / k) / PC)},${Math.floor((a[1] + ((b[1] - a[1]) * j) / k) / PC)}`);
      }
    }
    for (let t = 0; t < attempts && out.length < max; t++) {
      const q = [x0 + (x1 - x0) * this.rng.next(), y0 + (y1 - y0) * this.rng.next()];
      if (!inside(this.inner, q) || !keep(q)) continue;
      if (pathCells.has(`${Math.floor(q[0] / PC)},${Math.floor(q[1] / PC)}`)) continue;
      if (blocked.some((S) => inside(S, q))) continue;
      let near = false;
      const gx = Math.floor(q[0] / cell);
      const gy = Math.floor(q[1] / cell);
      for (let i = -2; i <= 2 && !near; i++) for (let j = -2; j <= 2 && !near; j++) for (const o of grid.get(`${gx + i},${gy + j}`) || []) if (len(sub(o, q)) < gap) near = true;
      if (near) continue;
      out.push(q);
      const k = key(q[0], q[1]);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(q);
    }
    return out;
  }

  result(extra = {}) {
    return { features: this.features, paths: this.paths, ...extra };
  }
}

// A loop path round the inside of a park, d metres in.
function loopOf(P, d) {
  let R = insetUniform(P, d);
  if (!R || R.length < 3) return null;
  for (let k = 0; k < 2; k++) R = chaikin(R, true);
  return R.concat([R[0]]);
}

// Entrances: the middles of the longer sides and the corners.
function entrances(P, rng, max) {
  const out = [];
  const n = P.length;
  for (let i = 0; i < n; i++) {
    const a = P[i];
    const b = P[(i + 1) % n];
    if (len(sub(b, a)) > 45) out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
  }
  rng.shuffle(out);
  return out.slice(0, max);
}

const CC_STYLE = STYLES.modern;

export function layoutParkette(P, rng) {
  const A = polygonArea(P);
  const s = new Site(P, rng, 2);
  // A path through, end to end along its length.
  const { c, u, L } = s.ax;
  const a = [c[0] - u[0] * L * 0.5, c[1] - u[1] * L * 0.5];
  const b = [c[0] + u[0] * L * 0.5, c[1] + u[1] * L * 0.5];
  s.bend(a, b, 2.5, 0.2);
  if (A > 550) s.place('playground', 14, 11, { gap: 2 });
  const trees = s.trees(9);
  return s.result({ trees });
}

// The neighbourhood park; returns its layout and the community centre's
// footprint, built into the park's edge on a street.
export function layoutNeighbourhoodPark(P, rng, opts = {}) {
  const s = new Site(P, rng, 4);
  const A = polygonArea(P);
  // The secondary school's track, when its own grounds have no room for it.
  if (opts.track) {
    const t = s.place('track', 178, 96, { tries: 200 });
    if (t) {
      const ax = axesOf(t.pts);
      t.pts = oval(ax.c, ax.u, 84.4, 47);
      s.features.push({ kind: 'trackField', pts: oval(ax.c, ax.u, 84.4, 36.5) });
    }
  }
  // The community centre first, at the edge, on a street.
  let centre = null;
  {
    const n = P.length;
    const cum = [0];
    for (let i = 0; i < n; i++) cum.push(cum[i] + len(sub(P[(i + 1) % n], P[i])));
    const total = cum[n];
    const at = (t) => {
      t = ((t % total) + total) % total;
      let i = 0;
      while (i < n - 1 && cum[i + 1] < t) i++;
      const f = (t - cum[i]) / (cum[i + 1] - cum[i] || 1);
      const a = P[i];
      const b = P[(i + 1) % n];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    };
    const [L, W] = [44, 26];
    const start = rng.next() * total;
    for (let k = 0; k < 40 && !centre; k++) {
      const t = start + (k * total) / 40;
      const m = at(t);
      const d = sub(at(t + 25), at(t - 25));
      const l = len(d) || 1;
      const u = [d[0] / l, d[1] / l];
      let nrm = [-u[1], u[0]];
      if (!inside(P, [m[0] + nrm[0] * 5, m[1] + nrm[1] * 5])) nrm = [-nrm[0], -nrm[1]];
      const cc = [m[0] + nrm[0] * (W / 2 + 3), m[1] + nrm[1] * (W / 2 + 3)];
      const R = rect(cc, u, L, W);
      if (R.every((q) => inside(P, q)) && !s.solid.some((S) => overlap(R, S))) {
        centre = R;
        s.solid.push(R);
      }
    }
  }
  // Paths: a loop inside the park, the entrances joined to it, and a path
  // or two weaving across.
  const loop = loopOf(P, 14);
  if (loop) {
    s.path(loop, 3.5);
    for (const e of entrances(P, rng, 5)) {
      const t = nearestOnRing(loop, e);
      if (t) s.bend(e, t.p, 3, 0.1);
    }
    const k = loop.length;
    for (let w = 0; w < (A > 3e4 ? 2 : 1); w++) {
      const i = Math.floor(rng.next() * k);
      const j = (i + Math.floor(k * (0.35 + rng.next() * 0.3))) % k;
      s.bend(loop[i], loop[j], 3, 0.35);
    }
  }
  // Amenities, as room allows.
  s.place('playground', 28, 22);
  s.place(rng.next() < 0.6 ? 'splash' : 'skate', rng.next() < 0.6 ? 10 : 30, rng.next() < 0.6 ? 0 : 22);
  if (A > 2.6e4) s.place('skate', 30, 20);
  s.place('court', 32, 19);
  s.place('dogRun', 34, 26);
  s.place('gardens', 34, 24);
  s.place('washroom', 9, 6, { gap: 2 });
  // A fountain or a statue where paths cross, else in the open.
  s.place(rng.next() < 0.6 ? 'fountain' : 'statue', 5, 0, { gap: 1 });
  const trees = s.trees(19);
  return { ...s.result({ trees }), centre };
}

// A secondary school's grounds: a 400 m track round a field if it fits,
// else a field; an elementary school's: a playground and a small field.
export function layoutSchool(P, building, rng, secondary) {
  const s = new Site(P, rng, 3);
  if (building) s.solid.push(building);
  if (secondary) {
    const t = s.place('track', 178, 96, { tries: 160 });
    if (t) {
      // A 400 m track: two straights and two bends round the field.
      const ax = axesOf(t.pts);
      t.pts = oval(ax.c, ax.u, 84.4, 47);
      s.features.push({ kind: 'trackField', pts: oval(ax.c, ax.u, 84.4, 36.5) });
    } else s.place('pitch', 100, 64, { tries: 160 }) || s.place('pitch', 80, 50, { tries: 160 });
    s.place('court', 28, 15);
  } else {
    s.place('pitch', 60, 40, { tries: 120 });
    s.place('playground', 30, 24);
  }
  return s.result({ trees: s.trees(16, () => true, 60) });
}

// A district park: trails between clearings, sports, water and woods.
export function layoutDistrictPark(P, rng, wooded) {
  const s = new Site(P, rng, 10);
  const A = polygonArea(P);
  // Places first, as they need room: fields, a pond, courts, a dog park.
  const fields = Math.max(1, Math.min(4, Math.floor(A / 1.6e5)));
  for (let k = 0; k < fields; k++) s.place('pitch', 105, 68, { tries: 120 });
  const pond = s.place('pond', 30 + rng.next() * 30, 0, { tries: 120 });
  if (pond) {
    // A natural outline, not a circle.
    const [p1, p2, p3] = [rng.next() * 6.3, rng.next() * 6.3, rng.next() * 6.3];
    const pts = [];
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      const r = pond.r * (0.82 + 0.16 * Math.sin(2 * a + p1) + 0.1 * Math.sin(3 * a + p2) + 0.05 * Math.sin(5 * a + p3));
      pts.push([pond.c[0] + Math.cos(a) * r * 1.25, pond.c[1] + Math.sin(a) * r * 0.8]);
    }
    pond.pts = pts;
    delete pond.c;
  }
  for (let k = 0; k < 3; k++) s.place('tennis', 36, 18, { tries: 60 });
  s.place('basketball', 28, 15);
  s.place('dogPark', 90, 60, { tries: 100 });
  if (rng.next() < 0.4) s.place('pool', 70, 45, { tries: 100 });
  if (rng.next() < 0.35 && A > 3e5) s.place('cemetery', 230, 160, { tries: 160, trees: true });
  s.place('playground', 40, 30);
  s.place('splash', 12, 0);
  s.place('skate', 40, 28);
  for (let k = 0; k < 3; k++) s.place('kiosk', 8, 6, { gap: 2 });
  s.place('washroom', 10, 7);
  // Trails: junctions spread through the park, joined nearest first, with a
  // few loops, and entrances from its edges.
  const deep = insetUniform(P, 40) || s.inner;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of deep) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  const nodes = [];
  for (let t = 0; t < 400 && nodes.length < Math.max(4, Math.min(16, A / 3.5e4)); t++) {
    const q = [x0 + (x1 - x0) * rng.next(), y0 + (y1 - y0) * rng.next()];
    if (!inside(deep, q) || s.solid.some((S) => inside(grow(S, 8), q))) continue;
    if (nodes.some((o) => len(sub(o, q)) < 110)) continue;
    nodes.push(q);
  }
  const joined = nodes.length ? [nodes[0]] : [];
  while (joined.length < nodes.length) {
    let pick = null;
    for (const n of nodes) {
      if (joined.includes(n)) continue;
      for (const m of joined) {
        const dd = len(sub(n, m));
        if (!pick || dd < pick.dd) pick = { n, m, dd };
      }
    }
    joined.push(pick.n);
    s.bend(pick.m, pick.n, 4, 0.3);
  }
  for (let k = 0; k < Math.floor(nodes.length / 3); k++) {
    const a = nodes[Math.floor(rng.next() * nodes.length)];
    const b = nodes.filter((o) => o !== a).sort((x, y) => len(sub(x, a)) - len(sub(y, a)))[1];
    if (b) s.bend(a, b, 4, 0.3);
  }
  for (const e of entrances(P, rng, 8)) {
    const n = nodes.slice().sort((x, y) => len(sub(x, e)) - len(sub(y, e)))[0];
    if (n) s.bend(e, n, 4, 0.2);
  }
  // Woods where the ground is wooded, sparse trees elsewhere; the cemetery
  // is a woodland too, its paths in a grid among the trees.
  const cem = s.features.find((f) => f.kind === 'cemetery');
  const woods = s.trees(10, (q) => wooded(q) || (cem && inside(cem.pts, q)), 3000);
  const lawn = s.trees(30, (q) => !wooded(q), 600);
  return s.result({ trees: woods.concat(lawn) });
}

// A running-track shape: straights of length l joined by semicircles of radius r.
export function oval(c, u, l, r, k = 14) {
  const v = [-u[1], u[0]];
  const out = [];
  for (const [end, a0] of [[l / 2, -Math.PI / 2], [-l / 2, Math.PI / 2]]) {
    for (let i = 0; i <= k; i++) {
      const a = a0 + (i / k) * Math.PI;
      const x = end + Math.cos(a) * r;
      const y = Math.sin(a) * r;
      out.push([c[0] + u[0] * x + v[0] * y, c[1] + u[1] * x + v[1] * y]);
    }
  }
  return out;
}

// The community centre as a building.
export function communityCentre(pts) {
  return { pts, storeys: 2, h: 2 * 4.5, style: 'modern', wall: CC_STYLE.walls[0], roofColour: CC_STYLE.roofs[1], roof: 'flat', ridge: null, landmark: 'communityCentre' };
}
