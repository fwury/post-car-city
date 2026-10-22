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
// tangles. Edges that the inset swallows (short ones in tight corners) are
// dropped.
export function inset(pts0, dist0) {
  let [pts, dist] = tidy(pts0, dist0);
  for (let round = 0; round < 200; round++) {
    const n = pts.length;
    if (n < 3) return null;
    const t = [];
    const nrm = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      t.push([(b[0] - a[0]) / l, (b[1] - a[1]) / l]);
      nrm.push([-(b[1] - a[1]) / l, (b[0] - a[0]) / l]);
    }
    // Offset line of edge i passes through pts[i] + nrm[i] * dist[i].
    const base = (i) => [pts[i][0] + nrm[i][0] * dist[i], pts[i][1] + nrm[i][1] * dist[i]];
    // Corner i joins edge i - 1 and edge i.
    const corner = [];
    for (let i = 0; i < n; i++) {
      const h = (i - 1 + n) % n;
      const pa = [pts[i][0] + nrm[h][0] * dist[h], pts[i][1] + nrm[h][1] * dist[h]];
      const pb = [pts[i][0] + nrm[i][0] * dist[i], pts[i][1] + nrm[i][1] * dist[i]];
      // (Nearly straight on: the two offset points, averaged.)
      const cr = t[h][0] * t[i][1] - t[h][1] * t[i][0];
      const m = Math.abs(cr) < 0.05 ? null : lineMeet(base(h), t[h], base(i), t[i]);
      if (!m) {
        corner.push([[(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2]]);
        continue;
      }
      const reach = Math.hypot(m[0] - pts[i][0], m[1] - pts[i][1]);
      const lim = MITRE * Math.max(dist[h], dist[i], 1e-9);
      // A sharp corner of the block is cut off square to its bisector rather
      // than left as a long thin point.
      if (reach > lim && cr > 0) {
        const c = Math.min((reach - lim) * 0.8, lim);
        corner.push([[m[0] - t[h][0] * c, m[1] - t[h][1] * c], [m[0] + t[i][0] * c, m[1] + t[i][1] * c]]);
      } else {
        corner.push([m]);
      }
    }
    // An edge whose inset runs backwards has been swallowed.
    const gone = [];
    for (let i = 0; i < n; i++) {
      const a = corner[i][corner[i].length - 1];
      const b = corner[(i + 1) % n][0];
      if ((b[0] - a[0]) * t[i][0] + (b[1] - a[1]) * t[i][1] < 0) gone.push(i);
    }
    if (!gone.length) {
      const out = corner.flat();
      if (out.length < 3 || selfCrosses(out)) {
        if (globalThis.__off) globalThis.__off.push(out.length < 3 ? 'few' : 'crosses');
        return null;
      }
      return out;
    }
    // Remove the swallowed edges (no two side by side in one round): each
    // one's two ends merge into one point.
    const drop = new Uint8Array(n);
    for (const i of gone) if (!drop[(i - 1 + n) % n] && !drop[(i + 1) % n]) drop[i] = 1;
    const P = [];
    const D = [];
    for (let i = 0; i < n; i++) {
      if (drop[(i - 1 + n) % n]) continue; // merged into the previous point
      if (drop[i]) {
        const j = (i + 1) % n;
        P.push([(pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2]);
        D.push(dist[j]);
      } else {
        P.push(pts[i]);
        D.push(dist[i]);
      }
    }
    // (If the last edge was dropped, the first point was merged into it.)
    if (drop[n - 1]) {
      P.shift();
      D.shift();
    }
    pts = P;
    dist = D;
    if (pts.length < 3) {
      if (globalThis.__off) globalThis.__off.push('collapsed');
      return null;
    }
  }
  if (globalThis.__off) globalThis.__off.push('rounds');
  return null;
}

// Inset by one distance everywhere.
export function insetUniform(pts, d) {
  return inset(pts, pts.map(() => d));
}
