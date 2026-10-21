// Boulevard routes: the city's oldest roads, generated before anything else.
//
// Each family k of routes is the set of contour lines f_k(p) = n of
//   f_k(p) = (p · e_k) / SPACING + BEND * fbm(p / WAVE)
// where e_k is the family's direction. f_k always increases along e_k, so each
// contour is one unbroken curve that never loops back, never dead-ends and
// bends gently. Three families meet at about 60 degrees; some whole routes
// are left out so the network is uneven.
//
// A point on route (k, n) at position t along the route is found by solving
// f_k = n along e_k, so every route is a pure function of (seed, k, n, t).

import { hash, toUnit } from '../core/hash.js';
import { createNoise } from '../core/noise.js';
import { LruCache } from './cache.js';

export const FAMILIES = 3;
export const ROUTE_SPACING = 3600; // metres between neighbouring routes of a family
export const ROUTE_EXIST = 0.7; // share of routes that exist
export const ROUTE_WAVE = 9000; // metres, scale of the bends
export const ROUTE_BEND = 0.6; // bend amplitude, in route spacings
export const ROUTE_STEP = 50; // sample spacing along a route
const PIECE = 2000; // routes are cached in pieces this long

export function createRoutes(seed) {
  const base = toUnit(hash(seed, 'route-angle')) * Math.PI;
  const fams = [];
  for (let k = 0; k < FAMILIES; k++) {
    const a = base + (k * Math.PI) / 3 + (toUnit(hash(seed, 'route-angle', k)) - 0.5) * (Math.PI / 9);
    fams.push({ k, ex: Math.cos(a), ey: Math.sin(a), tx: -Math.sin(a), ty: Math.cos(a), noise: createNoise(seed, `route-${k}`) });
  }
  const pieces = new LruCache(20000);
  const crossings = new LruCache(40000);

  const f = (k, x, y) => {
    const F = fams[k];
    return (x * F.ex + y * F.ey) / ROUTE_SPACING + ROUTE_BEND * F.noise.fbm(x / ROUTE_WAVE, y / ROUTE_WAVE, 2, 2, 0.45);
  };

  const exists = (k, n) => toUnit(hash(seed, 'route-exists', k, n)) < ROUTE_EXIST;

  // Gradient of f_k by central differences.
  function grad(k, x, y) {
    const h = 1;
    return [(f(k, x + h, y) - f(k, x - h, y)) / (2 * h), (f(k, x, y + h) - f(k, x, y - h)) / (2 * h)];
  }

  // Point on route (k, n) at position t along it.
  function pointOn(k, n, t) {
    const F = fams[k];
    let s = n * ROUTE_SPACING;
    for (let i = 0; i < 12; i++) {
      const x = s * F.ex + t * F.tx;
      const y = s * F.ey + t * F.ty;
      const g = f(k, x, y) - n;
      if (Math.abs(g) < 1e-8) break;
      const dg = f(k, x + F.ex, y + F.ey) - f(k, x, y);
      s -= Math.max(-3000, Math.min(3000, g / dg));
    }
    return [s * F.ex + t * F.tx, s * F.ey + t * F.ty];
  }

  function piece(k, n, pi) {
    const key = `${k}:${n}:${pi}`;
    let p = pieces.get(key);
    if (!p) {
      const pts = [];
      const per = PIECE / ROUTE_STEP;
      for (let i = 0; i <= per; i++) pts.push(pointOn(k, n, (pi * per + i) * ROUTE_STEP));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of pts) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      p = { key, k, n, pi, points: pts, bbox: { x0, y0, x1, y1 } };
      pieces.set(key, p);
    }
    return p;
  }

  // Range of route numbers and positions that can touch a rectangle.
  function ranges(k, x0, y0, x1, y1) {
    const F = fams[k];
    const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
    const s = corners.map(([x, y]) => (x * F.ex + y * F.ey) / ROUTE_SPACING);
    const t = corners.map(([x, y]) => x * F.tx + y * F.ty);
    return {
      n0: Math.floor(Math.min(...s) - ROUTE_BEND) - 1,
      n1: Math.ceil(Math.max(...s) + ROUTE_BEND) + 1,
      t0: Math.min(...t),
      t1: Math.max(...t),
    };
  }

  // Route pieces whose bounding box touches the rectangle.
  function piecesInRect(x0, y0, x1, y1) {
    const out = [];
    for (let k = 0; k < FAMILIES; k++) {
      const r = ranges(k, x0, y0, x1, y1);
      const p0 = Math.floor(r.t0 / PIECE);
      const p1 = Math.floor(r.t1 / PIECE);
      for (let n = r.n0; n <= r.n1; n++) {
        if (!exists(k, n)) continue;
        for (let pi = p0; pi <= p1; pi++) {
          const p = piece(k, n, pi);
          const b = p.bbox;
          if (b.x1 < x0 || b.x0 > x1 || b.y1 < y0 || b.y0 > y1) continue;
          out.push(p);
        }
      }
    }
    return out;
  }

  // Where route (i, a) crosses route (j, b), by Newton's method from the
  // straight-line estimate. Unique because both families are monotone.
  function crossing(i, a, j, b) {
    const key = `${i}:${a}:${j}:${b}`;
    let c = crossings.get(key);
    if (c) return c;
    const A = fams[i];
    const B = fams[j];
    const det = A.ex * B.ey - A.ey * B.ex;
    const ra = a * ROUTE_SPACING;
    const rb = b * ROUTE_SPACING;
    let x = (ra * B.ey - rb * A.ey) / det;
    let y = (A.ex * rb - B.ex * ra) / det;
    for (let it = 0; it < 12; it++) {
      const g1 = f(i, x, y) - a;
      const g2 = f(j, x, y) - b;
      if (Math.abs(g1) < 1e-8 && Math.abs(g2) < 1e-8) break;
      const [a11, a12] = grad(i, x, y);
      const [a21, a22] = grad(j, x, y);
      const d = a11 * a22 - a12 * a21;
      x -= Math.max(-3000, Math.min(3000, (g1 * a22 - g2 * a12) / d));
      y -= Math.max(-3000, Math.min(3000, (a11 * g2 - a21 * g1) / d));
    }
    c = [x, y];
    crossings.set(key, c);
    return c;
  }

  // Distance from a point to route (k, n), first-order estimate.
  function distTo(k, n, x, y) {
    const [gx, gy] = grad(k, x, y);
    return Math.abs(f(k, x, y) - n) / Math.hypot(gx, gy);
  }

  // Nearest existing route of family k to a point: { n, d }.
  function nearest(k, x, y) {
    const v = f(k, x, y);
    let best = null;
    for (let n = Math.floor(v) - 2; n <= Math.ceil(v) + 2; n++) {
      if (!exists(k, n)) continue;
      const d = distTo(k, n, x, y);
      if (!best || d < best.d) best = { n, d };
    }
    return best;
  }

  // Distance to the nearest existing route of any family.
  function nearestAny(x, y) {
    let best = null;
    for (let k = 0; k < FAMILIES; k++) {
      const r = nearest(k, x, y);
      if (r && (!best || r.d < best.d)) best = { k, n: r.n, d: r.d };
    }
    return best;
  }

  // Foot of the perpendicular from a point onto route (k, n).
  function project(k, n, x, y) {
    for (let i = 0; i < 6; i++) {
      const [gx, gy] = grad(k, x, y);
      const g2 = gx * gx + gy * gy;
      const e = f(k, x, y) - n;
      x -= (e * gx) / g2;
      y -= (e * gy) / g2;
    }
    return [x, y];
  }

  return { fams, f, exists, pointOn, ranges, piecesInRect, crossing, distTo, nearest, nearestAny, project };
}
