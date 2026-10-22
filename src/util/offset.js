// Insetting polygons, each edge by its own distance (half the width of the
// street along it, say). Polygons run clockwise on screen (y down), so the
// inside is on the right of each edge.

const MITRE = 2.5; // a corner reaching further in than this many offsets is cut off

function lineMeet(p, t, q, u) {
  const den = t[0] * u[1] - t[1] * u[0];
  if (Math.abs(den) < 1e-9) return null;
  const s = ((q[0] - p[0]) * u[1] - (q[1] - p[1]) * u[0]) / den;
  return [p[0] + t[0] * s, p[1] + t[1] * s];
}

function segsCross(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return false;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

// Does a closed polygon cross itself? (Segments hashed on a grid.)
export function selfCrosses(pts) {
  const n = pts.length;
  if (n < 4) return false;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  const cell = Math.max(1, Math.sqrt(((x1 - x0) * (y1 - y0)) / n) * 2);
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const gi0 = Math.floor((Math.min(a[0], b[0]) - x0) / cell);
    const gi1 = Math.floor((Math.max(a[0], b[0]) - x0) / cell);
    const gj0 = Math.floor((Math.min(a[1], b[1]) - y0) / cell);
    const gj1 = Math.floor((Math.max(a[1], b[1]) - y0) / cell);
    for (let gj = gj0; gj <= gj1; gj++) {
      for (let gi = gi0; gi <= gi1; gi++) {
        const k = gi * 65536 + gj;
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        for (const j of list) {
          if (Math.abs(i - j) <= 1 || (i === n - 1 && j === 0) || (j === n - 1 && i === 0)) continue;
          if (segsCross(a, b, pts[j], pts[(j + 1) % n])) return true;
        }
        list.push(i);
      }
    }
  }
  return false;
}

// Drop points closer than `tol` to the previous one, and points where the
// polygon runs straight on.
function tidy(pts, ds, tol = 0.05) {
  const P = [];
  const D = [];
  for (let i = 0; i < pts.length; i++) {
    const q = P[P.length - 1];
    if (q && Math.hypot(pts[i][0] - q[0], pts[i][1] - q[1]) < tol) continue;
    P.push(pts[i]);
    D.push(ds[i]);
  }
  while (P.length > 3 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < tol) {
    P.pop();
    D.pop();
  }
  return [P, D];
}

// Inset a clockwise polygon. `dist[i]` is the inset of the edge from pts[i]
// to pts[i + 1]. Returns the inset polygon, or null if it collapses or
// tangles. Each edge becomes a line, moved in by its distance; corners are
// where consecutive lines meet. An edge the inset swallows (a short one by a
// corner, say) is dropped, and its neighbours meet directly instead.
export function inset(pts0, dist0) {
  const [pts, dist] = tidy(pts0, dist0);
  const n0 = pts.length;
  if (n0 < 3) return null;
  let lines = [];
  for (let i = 0; i < n0; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n0];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-9) continue;
    const t = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    const nrm = [-t[1], t[0]];
    const d = dist[i];
    lines.push({ t, a: [a[0] + nrm[0] * d, a[1] + nrm[1] * d], b: [b[0] + nrm[0] * d, b[1] + nrm[1] * d], d });
  }
  for (let round = 0; round < 400; round++) {
    const n = lines.length;
    if (n < 3) return null;
    // Corner k joins line k - 1 and line k.
    const corner = [];
    for (let k = 0; k < n; k++) {
      const h = lines[(k - 1 + n) % n];
      const i = lines[k];
      const cr = h.t[0] * i.t[1] - h.t[1] * i.t[0];
      const m = Math.abs(cr) < 0.05 ? null : lineMeet(h.a, h.t, i.a, i.t);
      if (!m) {
        // Nearly straight on: halfway between where the one ends and the other starts.
        corner.push([[(h.b[0] + i.a[0]) / 2, (h.b[1] + i.a[1]) / 2]]);
        continue;
      }
      // A corner far out along a sharp point is cut off square to it.
      const lim = MITRE * Math.max(h.d, i.d, 1e-9);
      const reach = Math.min(Math.hypot(m[0] - h.b[0], m[1] - h.b[1]), Math.hypot(m[0] - i.a[0], m[1] - i.a[1])) + Math.max(h.d, i.d);
      if (cr > 0 && reach > lim) {
        const c = Math.min((reach - lim) * 0.8, lim);
        corner.push([[m[0] - h.t[0] * c, m[1] - h.t[1] * c], [m[0] + i.t[0] * c, m[1] + i.t[1] * c]]);
      } else {
        corner.push([m]);
      }
    }
    // A line whose stretch between its corners runs backwards is swallowed.
    const gone = new Uint8Array(n);
    let any = false;
    for (let k = 0; k < n; k++) {
      const s0 = corner[k][corner[k].length - 1];
      const s1 = corner[(k + 1) % n][0];
      if ((s1[0] - s0[0]) * lines[k].t[0] + (s1[1] - s0[1]) * lines[k].t[1] < 0) {
        // (Never two side by side in one round.)
        if (!gone[(k - 1 + n) % n]) {
          gone[k] = 1;
          any = true;
        }
      }
    }
    if (gone[0] && gone[n - 1]) gone[n - 1] = 0;
    if (!any) {
      const out = corner.flat();
      if (out.length < 3) return null;
      if (!selfCrosses(out)) return out;
      // Folded over where the shape narrows: keep its largest loop.
      const loop = largestLoop(out);
      return loop;
    }
    lines = lines.filter((_, k) => !gone[k]);
  }
  return null;
}

// A polygon that crosses itself, cut at its crossings into simple loops: the
// largest one running clockwise, or null.
function largestLoop(pts, depth = 0) {
  const n = pts.length;
  if (depth > 12 || n < 3) return null;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = pts[j];
      const d = pts[(j + 1) % n];
      if (!segsCross(a, b, c, d)) continue;
      const r = [b[0] - a[0], b[1] - a[1]];
      const q = [d[0] - c[0], d[1] - c[1]];
      const t = ((c[0] - a[0]) * q[1] - (c[1] - a[1]) * q[0]) / (r[0] * q[1] - r[1] * q[0]);
      const x = [a[0] + r[0] * t, a[1] + r[1] * t];
      const one = [x, ...pts.slice(j + 1), ...pts.slice(0, i + 1)];
      const two = [x, ...pts.slice(i + 1, j + 1)];
      let best = null;
      let bestArea = 0;
      for (const part of [one, two]) {
        const p = selfCrosses(part) ? largestLoop(part, depth + 1) : part;
        if (!p) continue;
        let s2 = 0;
        for (let k = 0; k < p.length; k++) {
          const u = p[k];
          const v = p[(k + 1) % p.length];
          s2 += u[0] * v[1] - v[0] * u[1];
        }
        if (s2 > bestArea) {
          bestArea = s2;
          best = p;
        }
      }
      return best;
    }
  }
  return null;
}

// Inset by one distance everywhere.
export function insetUniform(pts, d) {
  return inset(pts, pts.map(() => d));
}
