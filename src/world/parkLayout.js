// Stage 5: what is in a park.
//
// Parkettes: a path through, trees and benches; a playground in the bigger
// ones. Neighbourhood parks (after Queen's Park or Finsbury Park): a mesh of
// paths from entrances round the edge to junctions through the park, and the
// neighbourhood's community centre built into its edge, on a street. District parks: all that and more, larger: playing fields, tennis
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
    // A tight fit is searched for on a grid along the site's axes, nearest
    // the middle first; otherwise spots are tried at random.
    const grid = [];
    if (opts.grid) {
      for (let a = -this.ax.L / 2; a <= this.ax.L / 2; a += 6) for (let b = -this.ax.W / 2; b <= this.ax.W / 2; b += 6) grid.push([a, b]);
      grid.sort((p, q) => Math.hypot(...p) - Math.hypot(...q));
    }
    for (let t = 0; t < (opts.grid ? grid.length * 2 : tries); t++) {
      const g = opts.grid ? grid[t >> 1] : null;
      const c = g ? [this.ax.c[0] + u[0] * g[0] + v[0] * g[1], this.ax.c[1] + u[1] * g[0] + v[1] * g[1]] : [x0 + (x1 - x0) * this.rng.next(), y0 + (y1 - y0) * this.rng.next()];
      if (!inside(this.inner, c)) continue;
      const dir = opts.grid ? (t & 1 ? v : u) : this.rng.next() < 0.5 ? u : v;
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
  return s.result();
}

// The neighbourhood park; returns its layout and the community centre's
// footprint, built into the park's edge on a street.
export function layoutNeighbourhoodPark(P, rng) {
  const s = new Site(P, rng, 4);
  const A = polygonArea(P);
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
  pathNetwork(s, P, rng, { spacing: 55, edgeEvery: 85, width: 3.2 });
  return { ...s.result(), centre };
}

// A school's grounds: for a secondary school a 400 m track round a field
// (or, with no room for one, a field), for an elementary school a field and
// a playground; then the school building, compact, in the room left, as
// near the street as it can be. Returns the layout and the building's
// footprint.
export function layoutSchool(P, rng, secondary) {
  const s = new Site(P, rng, 4);
  const edge = (c) => {
    let best = Infinity;
    for (let i = 0; i < P.length; i++) best = Math.min(best, segDist(c, P[i], P[(i + 1) % P.length]));
    return best;
  };
  // The building: the biggest of a few sizes that fits, nearest the edge.
  const building = (sizes) => {
    for (const [l, w] of sizes) {
      const f = s.place('school', l, w, { grid: true, gap: 3, score: edge });
      if (f) {
        s.features.pop();
        return f.pts;
      }
    }
    return null;
  };
  let pts = null;
  if (secondary) {
    const t = s.place('track', 174, 92, { grid: true, gap: 2 });
    if (t) {
      const ax = axesOf(t.pts);
      t.pts = oval(ax.c, ax.u, 84.4, 45);
      s.features.push({ kind: 'trackField', pts: oval(ax.c, ax.u, 84.4, 36.5) });
    }
    pts = building([[110, 34], [90, 30], [70, 28], [55, 24], [42, 22]]);
    if (!t) s.place('pitch', 100, 64, { grid: true }) || s.place('pitch', 80, 50, { grid: true });
    s.place('court', 28, 15);
  } else {
    pts = building([[75, 26], [60, 22], [45, 20], [34, 18]]);
    s.place('pitch', 60, 40, { grid: true }) || s.place('pitch', 44, 30, { grid: true });
    s.place('playground', 30, 24);
  }
  return { ...s.result(), building: pts };
}

function segDist(q, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2)) : 0;
  return len(sub([a[0] + ab[0] * t, a[1] + ab[1] * t], q));
}

// A district park: trails between clearings, sports, water and woods.
export function layoutDistrictPark(P, rng) {
  const s = new Site(P, rng, 10);
  const A = polygonArea(P);
  // The loop drive: a broad promenade round the park, well in from its
  // edge, smoothed into long easy curves (as Central Park's drives or High
  // Park's loop).
  const inset = Math.max(45, Math.min(110, Math.sqrt(A) * 0.17));
  let loop = null;
  for (const d of [inset, inset * 0.75, inset * 0.55]) {
    loop = insetUniform(P, d);
    if (loop && loop.length >= 3 && polygonArea(loop) > A * 0.2) break;
    loop = null;
  }
  if (loop) {
    loop = simplifyRing(loop, 14);
    for (let k = 0; k < 4; k++) loop = chaikin(loop, true);
    s.path(loop.concat([loop[0]]), DRIVE_WIDTH);
  }
  // Entrances at the corners and along the sides; each a path curving in
  // from its gate to meet the loop at an easy angle, the way park paths
  // join (never two meeting the loop at one spot, never crossing).
  const gates = gatesOf(P, 190);
  const joins = [];
  for (const g of gates) {
    if (!loop) break;
    const near = nearestOnRing(loop, g);
    if (!near || near.r < 8) continue;
    if (joins.some((q) => len(sub(q, near.p)) < 70)) continue;
    // Come in square from the edge, then swing along the loop to meet it.
    const inward = unit(sub(near.p, g));
    const t = loopTangent(loop, near.p);
    const side = dot(t, sub(g, near.p)) > 0 ? 1 : -1;
    const meet = pointOnRingFrom(loop, near.p, side * Math.min(60, near.r * 0.6));
    const ctrl = [g[0] + inward[0] * near.r * 0.6, g[1] + inward[1] * near.r * 0.6];
    const pts = bezier(g, ctrl, meet, Math.max(8, Math.ceil(near.r / 6)));
    if (!pts.slice(1, -1).every((q) => inside(P, q))) continue;
    if (s.paths.slice(1).some(({ pts: o }) => crosses(pts, o))) continue;
    s.path(pts, ENTRY_WIDTH);
    joins.push(meet);
  }
  // Places, clear of the paths: fields, a pond, courts, a dog park.
  const fields = Math.max(1, Math.min(4, Math.floor(A / 1.6e5)));
  for (let k = 0; k < fields; k++) s.place('pitch', 105, 68, { tries: 160 });
  const pond = s.place('pond', 30 + rng.next() * 30, 0, { tries: 160 });
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
    // A path round its shore.
    const shore = pts.map((q) => {
      const d = sub(q, pond.c);
      const l = len(d) || 1;
      return [q[0] + (d[0] / l) * 7, q[1] + (d[1] / l) * 7];
    });
    if (shore.every((q) => inside(s.inner, q))) s.path(chaikin(shore, true).concat([chaikin(shore, true)[0]]), WALK_WIDTH);
    delete pond.c;
  }
  for (let k = 0; k < 3; k++) s.place('tennis', 36, 18, { tries: 80 });
  s.place('basketball', 28, 15, { tries: 60 });
  s.place('dogPark', 90, 60, { tries: 120 });
  if (rng.next() < 0.4) s.place('pool', 70, 45, { tries: 120 });
  if (rng.next() < 0.35 && A > 3e5) s.place('cemetery', 230, 160, { tries: 160 });
  s.place('playground', 40, 30, { tries: 80 });
  s.place('splash', 12, 0);
  s.place('skate', 40, 28, { tries: 60 });
  for (let k = 0; k < 3; k++) s.place('kiosk', 8, 6, { gap: 2 });
  s.place('washroom', 10, 7);
  // Winding walks across the middle, from one side of the loop to the
  // other, meandering round what is placed.
  if (loop && polygonArea(loop) > 4e4) {
    const L = ringLength(loop);
    const walks = Math.max(1, Math.min(4, Math.round(Math.sqrt(polygonArea(loop)) / 160)));
    for (let k = 0; k < walks; k++) {
      for (let tries = 0; tries < 12; tries++) {
        const s0 = rng.next() * L;
        const s1 = s0 + L * (0.35 + rng.next() * 0.3);
        const a = ringAt(loop, s0);
        const b = ringAt(loop, s1 % L);
        if (joins.some((q) => len(sub(q, a)) < 30 || len(sub(q, b)) < 30)) continue;
        const pts = meander(a, b, rng);
        if (!pts.slice(1, -1).every((q) => inside(loop, q))) continue;
        if (s.solid.some((S) => pts.some((q) => inside(grow(S, 3), q)))) continue;
        if (s.paths.slice(1).some(({ pts: o }) => crosses(pts, o))) continue;
        s.path(pts, WALK_WIDTH);
        joins.push(a, b);
        break;
      }
    }
  }
  // A short spur to each place from the nearest path.
  for (const f of s.features) {
    if (f.kind === 'pond') continue;
    const c = f.pts ? f.pts.reduce((a, q) => [a[0] + q[0] / f.pts.length, a[1] + q[1] / f.pts.length], [0, 0]) : f.c;
    const edge = f.pts ? nearestOnRing(f.pts, c) : null;
    let best = null;
    for (const { pts } of s.paths) {
      for (const q of pts) {
        const r = len(sub(q, c));
        if (!best || r < best.r) best = { r, q };
      }
    }
    if (!best) continue;
    const door = f.pts ? nearestOnRing(f.pts, best.q).p : c;
    if (len(sub(door, best.q)) < 4 || len(sub(door, best.q)) > 90) continue;
    const pts = [best.q, door];
    if (s.solid.some((S) => S !== f.pts && inside(S, [(best.q[0] + door[0]) / 2, (best.q[1] + door[1]) / 2]))) continue;
    void edge;
    s.path(pts, SPUR_WIDTH);
  }
  return s.result();
}

const DRIVE_WIDTH = 6; // metres: a district park's loop drive (walking, cycling)
const ENTRY_WIDTH = 4;
const WALK_WIDTH = 3;
const SPUR_WIDTH = 2.2;

const unit = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};

// A ring with points closer than tol to the line between their neighbours
// dropped (for a smoother loop).
function simplifyRing(R, tol) {
  let out = R.slice();
  for (let changed = true; changed && out.length > 6; ) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 6; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[(i + 1) % out.length];
      const ab = sub(b, a);
      const l = len(ab) || 1;
      const d = Math.abs(cross(ab, sub(out[i], a))) / l;
      if (d < tol) {
        out.splice(i, 1);
        changed = true;
      }
    }
  }
  return out;
}
function ringLength(R) {
  let L = 0;
  for (let i = 0; i < R.length; i++) L += len(sub(R[(i + 1) % R.length], R[i]));
  return L;
}
function ringAt(R, s) {
  for (let i = 0; i < R.length; i++) {
    const a = R[i];
    const b = R[(i + 1) % R.length];
    const l = len(sub(b, a));
    if (s <= l) return [a[0] + ((b[0] - a[0]) * s) / (l || 1), a[1] + ((b[1] - a[1]) * s) / (l || 1)];
    s -= l;
  }
  return R[0];
}
// Where along a ring a point lies (arc length), and the ring's direction there.
function ringPos(R, q) {
  let best = null;
  let acc = 0;
  for (let i = 0; i < R.length; i++) {
    const a = R[i];
    const ab = sub(R[(i + 1) % R.length], a);
    const l = len(ab);
    const t = l ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / (l * l))) : 0;
    const f = [a[0] + ab[0] * t, a[1] + ab[1] * t];
    const r = len(sub(f, q));
    if (!best || r < best.r) best = { r, s: acc + t * l, t: unit(ab) };
    acc += l;
  }
  return best;
}
const loopTangent = (R, q) => ringPos(R, q).t;
function pointOnRingFrom(R, q, ds) {
  const L = ringLength(R);
  const s0 = ringPos(R, q).s;
  return ringAt(R, (((s0 + ds) % L) + L) % L);
}
function crosses(A, B) {
  for (let i = 0; i + 1 < A.length; i++) for (let j = 0; j + 1 < B.length; j++) if (segsCross(A[i], A[i + 1], B[j], B[j + 1])) return true;
  return false;
}
// A walk from a to b that wanders gently: a few waypoints off the straight
// line, alternately to one side and the other, joined smoothly.
function meander(a, b, rng) {
  const d = sub(b, a);
  const L = len(d);
  const n = [-d[1] / (L || 1), d[0] / (L || 1)];
  const k = Math.max(2, Math.round(L / 140));
  const pts = [a];
  let side = rng.next() < 0.5 ? 1 : -1;
  for (let i = 1; i < k; i++) {
    const t = i / k + (rng.next() - 0.5) * 0.12;
    const off = side * L * (0.06 + rng.next() * 0.08);
    side = -side;
    pts.push([a[0] + d[0] * t + n[0] * off, a[1] + d[1] * t + n[1] * off]);
  }
  pts.push(b);
  let out = pts;
  for (let r = 0; r < 4; r++) out = chaikin(out, false);
  return out;
}
// Gates: just inside each corner, and along the sides every so often.
function gatesOf(P, every) {
  const n = P.length;
  const sign = Math.sign(P.reduce((a, p, i) => a + cross(p, P[(i + 1) % n]), 0)) || 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n];
    const v = P[i];
    const b = P[(i + 1) % n];
    const turn = Math.atan2(cross(sub(v, a), sub(b, v)), dot(sub(v, a), sub(b, v))) * sign;
    if (turn > 0.5) {
      const bis = unit([(a[0] + b[0]) / 2 - v[0], (a[1] + b[1]) / 2 - v[1]]);
      out.push([v[0] + bis[0] * 3, v[1] + bis[1] * 3]);
    }
  }
  // Along the sides: by arc length round the outline.
  const L = ringLength(P);
  const k = Math.floor(L / every);
  for (let i = 0; i < k; i++) {
    const q = ringAt(P, ((i + 0.5) / k) * L);
    if (!out.some((o) => len(sub(o, q)) < every * 0.5)) {
      // A step in from the edge.
      const t = ringPos(P, q).t;
      const a1 = [q[0] - t[1] * 3, q[1] + t[0] * 3];
      out.push(inside(P, a1) ? a1 : [q[0] + t[1] * 3, q[1] - t[0] * 3]);
    }
  }
  return out;
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

// A park's paths: entrances at its corners and along its sides, joined to
// junctions spread through it by gently curving paths, as a mesh. Paths only
// meet at junctions, and leave a junction at a good angle to each other.
export function pathNetwork(s, P, rng, { spacing, edgeEvery, width }) {
  const n = P.length;
  // Entrances: the corners, then along the sides.
  const gates = [];
  const sign = Math.sign(P.reduce((a, p, i) => a + cross(p, P[(i + 1) % n]), 0)) || 1;
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n];
    const v = P[i];
    const b = P[(i + 1) % n];
    const turn = Math.atan2(cross(sub(v, a), sub(b, v)), dot(sub(v, a), sub(b, v))) * sign;
    if (turn > 0.6) {
      // Just inside the corner, along its bisector.
      const bis = [(a[0] + b[0]) / 2 - v[0], (a[1] + b[1]) / 2 - v[1]];
      const l = len(bis) || 1;
      gates.push([v[0] + (bis[0] / l) * 3, v[1] + (bis[1] / l) * 3]);
    }
    const L = len(sub(b, v));
    const k = Math.floor(L / edgeEvery);
    for (let j = 1; j <= k; j++) {
      const t = j / (k + 1);
      gates.push([v[0] + (b[0] - v[0]) * t, v[1] + (b[1] - v[1]) * t]);
    }
  }
  const clean = [];
  for (const g of gates) if (!clean.some((o) => len(sub(o, g)) < spacing * 0.6)) clean.push(g);
  // Junctions inside, kept apart and off what is built.
  const deep = insetUniform(P, spacing * 0.35) || P;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of deep) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  const nodes = [];
  for (let t = 0; t < 600; t++) {
    const q = [x0 + (x1 - x0) * rng.next(), y0 + (y1 - y0) * rng.next()];
    if (!inside(deep, q) || s.solid.some((S) => inside(grow(S, 6), q))) continue;
    if (nodes.some((o) => len(sub(o, q)) < spacing)) continue;
    nodes.push(q);
  }
  if (!nodes.length) {
    // A small park: one junction in the middle.
    const c = s.ax.c;
    if (inside(P, c)) nodes.push(c);
  }
  const edges = [];
  const all = nodes.concat(clean);
  const isGate = (i) => i >= nodes.length;
  const degreeDirs = all.map(() => []);
  const crosses = (a, b) => {
    for (const [i, j] of edges) {
      const p = all[i];
      const q = all[j];
      if (p === a || p === b || q === a || q === b) continue;
      const r = sub(b, a);
      const t2 = sub(q, p);
      const den = cross(r, t2);
      if (Math.abs(den) < 1e-9) continue;
      const u = cross(sub(p, a), t2) / den;
      const v = cross(sub(p, a), r) / den;
      if (u > 0.02 && u < 0.98 && v > 0.02 && v < 0.98) return true;
    }
    return false;
  };
  const wellAngled = (i, j) => {
    const d1 = unitOf(sub(all[j], all[i]));
    const d2 = unitOf(sub(all[i], all[j]));
    return degreeDirs[i].every((e) => dot(e, d1) < 0.82) && degreeDirs[j].every((e) => dot(e, d2) < 0.82);
  };
  const clearOfBuilt = (a, b) => {
    for (let t = 0.1; t < 1; t += 0.1) {
      const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (!inside(P, q) || s.solid.some((S) => inside(S, q))) return false;
    }
    return true;
  };
  const add = (i, j) => {
    if (crosses(all[i], all[j]) || !wellAngled(i, j) || !clearOfBuilt(all[i], all[j])) return false;
    edges.push([i, j]);
    degreeDirs[i].push(unitOf(sub(all[j], all[i])));
    degreeDirs[j].push(unitOf(sub(all[i], all[j])));
    return true;
  };
  // Junctions joined nearest first (all connected), then more links, short
  // first, while they fit; then every entrance to its nearest junction.
  const cand = [];
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) cand.push([len(sub(nodes[i], nodes[j])), i, j]);
  cand.sort((a, b) => a[0] - b[0]);
  const comp = nodes.map((_, i) => i);
  const find = (i) => (comp[i] === i ? i : (comp[i] = find(comp[i])));
  for (const [, i, j] of cand) if (find(i) !== find(j) && add(i, j)) comp[find(i)] = find(j);
  for (const [dd, i, j] of cand) if (dd < spacing * 1.9 && !edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) add(i, j);
  for (let g = nodes.length; g < all.length; g++) {
    const order = nodes.map((_, i) => i).sort((a, b) => len(sub(all[a], all[g])) - len(sub(all[b], all[g])));
    for (const i of order.slice(0, 3)) if (add(g, i)) break;
  }
  // Each link a gentle curve.
  for (const [i, j] of edges) {
    const a = all[i];
    const b = all[j];
    const d = sub(b, a);
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const k = (rng.next() - 0.5) * 0.18;
    const ctrl = [m[0] - d[1] * k, m[1] + d[0] * k];
    s.path(bezier(a, ctrl, b, Math.max(6, Math.ceil(len(d) / 6))), isGate(i) || isGate(j) ? width * 0.9 : width);
  }
  // A little round square at junctions where three or more paths meet.
  nodes.forEach((q, i) => {
    if (degreeDirs[i].length >= 3) s.features.push({ kind: 'plaza', c: q, r: width * 1.6 });
  });
}

const unitOf = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};

// The community centre as a building.
export function communityCentre(pts) {
  return { pts, storeys: 2, h: 2 * 4.5, style: 'modern', wall: CC_STYLE.walls[0], roofColour: CC_STYLE.roofs[1], roof: 'flat', ridge: null, landmark: 'communityCentre' };
}
