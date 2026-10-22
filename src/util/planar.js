// Planar graphs from tagged polylines, and the faces they enclose.
//
// Lines are cut wherever they cross, and where one ends on (or within
// `snap` metres of) another. Loose ends are pruned away, so only edges that
// bound a face are left. Faces are traced with the region on the right of
// each directed edge (clockwise on screen, y down).

const KEY = 1e3; // vertex keys: coordinates rounded to the millimetre

function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [Math.min(1, Math.max(0, t)), Math.min(1, Math.max(0, u))];
}

// Nearest point on a segment: [t, distance].
function project(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return [t, Math.hypot(ax + dx * t - px, ay + dy * t - py)];
}

// lines: [{ pts, tag, closed }]. Returns { vertices, edges, faces }, where
// each face is { pts, tags } with tags[i] the tag of the edge from pts[i] to
// pts[i + 1] (wrapping round).
export function planarFaces(lines, { snap = 0.5, bucket = 100 } = {}) {
  // Segments, hashed.
  const segs = [];
  const grid = new Map();
  const cellKey = (i, j) => i * 4194304 + j;
  lines.forEach((l, li) => {
    const p = l.closed ? l.pts.concat([l.pts[0]]) : l.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i];
      const [bx, by] = p[i + 1];
      if (ax === bx && ay === by) continue;
      const k = segs.length;
      segs.push({ li, i, ax, ay, bx, by });
      for (let gj = Math.floor((Math.min(ay, by) - snap) / bucket); gj <= Math.floor((Math.max(ay, by) + snap) / bucket); gj++) {
        for (let gi = Math.floor((Math.min(ax, bx) - snap) / bucket); gi <= Math.floor((Math.max(ax, bx) + snap) / bucket); gi++) {
          const ck = cellKey(gi, gj);
          let b = grid.get(ck);
          if (!b) grid.set(ck, (b = []));
          b.push(k);
        }
      }
    }
  });
  const near = (x0, y0, x1, y1) => {
    const out = new Set();
    for (let gj = Math.floor(y0 / bucket); gj <= Math.floor(y1 / bucket); gj++) {
      for (let gi = Math.floor(x0 / bucket); gi <= Math.floor(x1 / bucket); gi++) for (const k of grid.get(cellKey(gi, gj)) || []) out.add(k);
    }
    return out;
  };

  // Cut points per line: { i (segment), t, p (shared point) }.
  const cuts = lines.map(() => []);
  const addCut = (li, i, t, p) => cuts[li].push({ i, t, p });
  for (let a = 0; a < segs.length; a++) {
    const s = segs[a];
    for (const b of near(Math.min(s.ax, s.bx), Math.min(s.ay, s.by), Math.max(s.ax, s.bx), Math.max(s.ay, s.by))) {
      if (b <= a) continue;
      const q = segs[b];
      if (q.li === s.li && (Math.abs(q.i - s.i) <= 1 || (lines[s.li].closed && Math.abs(q.i - s.i) === lines[s.li].pts.length - 1))) continue;
      const h = segCross(s.ax, s.ay, s.bx, s.by, q.ax, q.ay, q.bx, q.by);
      if (!h) continue;
      const p = [s.ax + (s.bx - s.ax) * h[0], s.ay + (s.by - s.ay) * h[0]];
      addCut(s.li, s.i, h[0], p);
      addCut(q.li, q.i, h[1], p);
    }
  }
  // Ends of open lines that stop just short of another line join it.
  lines.forEach((l, li) => {
    if (l.closed) return;
    for (const [e, ei, et] of [[l.pts[0], 0, 0], [l.pts[l.pts.length - 1], l.pts.length - 2, 1]]) {
      let best = null;
      for (const b of near(e[0] - snap, e[1] - snap, e[0] + snap, e[1] + snap)) {
        const q = segs[b];
        if (q.li === li) continue;
        const [t, dd] = project(e[0], e[1], q.ax, q.ay, q.bx, q.by);
        if (dd <= snap && (!best || dd < best.dd)) best = { q, t, dd };
      }
      if (!best) continue;
      const p = [best.q.ax + (best.q.bx - best.q.ax) * best.t, best.q.ay + (best.q.by - best.q.ay) * best.t];
      addCut(best.q.li, best.q.i, best.t, p);
      addCut(li, ei, et, p);
    }
  });

  // Vertices, merged by position.
  const vertices = [];
  const vid = new Map();
  const vertexOf = (p) => {
    const k = `${Math.round(p[0] * KEY)},${Math.round(p[1] * KEY)}`;
    let v = vid.get(k);
    if (v === undefined) {
      v = vertices.length;
      vid.set(k, v);
      vertices.push({ p, out: [] });
    }
    return v;
  };

  // Edges: runs of a line between consecutive cuts.
  const edges = [];
  lines.forEach((l, li) => {
    const n = l.pts.length;
    const nseg = l.closed ? n : n - 1;
    const list = cuts[li].slice().sort((a, b) => a.i - b.i || a.t - b.t);
    if (!l.closed) {
      list.unshift({ i: 0, t: 0, p: l.pts[0] });
      list.push({ i: nseg - 1, t: 1, p: l.pts[n - 1] });
    } else if (!list.length) {
      list.push({ i: 0, t: 0, p: l.pts[0] });
    }
    const at = (i) => l.pts[i % n];
    const runs = [];
    const span = (a, b, wrap) => {
      // Points from cut a to cut b along the line.
      const pts = [a.p];
      let i = a.i;
      const end = wrap ? b.i + nseg : b.i;
      for (let k = i + 1; k <= end; k++) pts.push(at(k));
      // The last whole point may lie past b if b.t is 0.
      if (b.t < 1e-12 && pts.length > 1 && end > a.i) pts.pop();
      pts.push(b.p);
      return pts;
    };
    for (let k = 0; k + 1 < list.length; k++) runs.push(span(list[k], list[k + 1], false));
    if (l.closed) runs.push(span(list[list.length - 1], list[0], true));
    for (const pts of runs) {
      // Drop repeated points.
      const clean = [pts[0]];
      for (let k = 1; k < pts.length; k++) {
        const q = clean[clean.length - 1];
        if (Math.hypot(pts[k][0] - q[0], pts[k][1] - q[1]) > 1e-6) clean.push(pts[k]);
      }
      if (clean.length < 2) continue;
      const a = vertexOf(clean[0]);
      const b = vertexOf(clean[clean.length - 1]);
      if (a === b && clean.length < 3) continue;
      clean[0] = vertices[a].p;
      clean[clean.length - 1] = vertices[b].p;
      edges.push({ a, b, pts: clean, tag: l.tag, alive: true });
    }
  });

  // Prune loose ends.
  const degree = new Int32Array(vertices.length);
  for (const e of edges) {
    degree[e.a]++;
    degree[e.b]++;
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of edges) {
      if (!e.alive) continue;
      if (degree[e.a] === 1 || degree[e.b] === 1) {
        e.alive = false;
        degree[e.a]--;
        degree[e.b]--;
        changed = true;
      }
    }
  }

  // Half-edges, sorted by angle round each vertex.
  const half = [];
  for (const e of edges) {
    if (!e.alive) continue;
    const fwd = { from: e.a, to: e.b, pts: e.pts, tag: e.tag, used: false };
    const back = { from: e.b, to: e.a, pts: e.pts.slice().reverse(), tag: e.tag, used: false };
    fwd.twin = back;
    back.twin = fwd;
    for (const h of [fwd, back]) {
      h.angle = Math.atan2(h.pts[1][1] - h.pts[0][1], h.pts[1][0] - h.pts[0][0]);
      vertices[h.from].out.push(h);
      half.push(h);
    }
  }
  for (const v of vertices) v.out.sort((a, b) => a.angle - b.angle);
  // Arriving along h at its end, the next edge of the face on h's right is
  // the one turning most sharply right: the predecessor of h's twin in the
  // angular order (angles grow clockwise on screen).
  const next = (h) => {
    const out = vertices[h.to].out;
    const i = out.indexOf(h.twin);
    return out[(i - 1 + out.length) % out.length];
  };
  const faces = [];
  for (const h0 of half) {
    if (h0.used) continue;
    const pts = [];
    const tags = [];
    let h = h0;
    let guard = 0;
    while (!h.used && guard++ < 100000) {
      h.used = true;
      for (let k = 0; k < h.pts.length - 1; k++) {
        pts.push(h.pts[k]);
        tags.push(h.tag);
      }
      h = next(h);
    }
    if (h !== h0 || pts.length < 3) continue;
    faces.push({ pts, tags });
  }
  return { vertices, edges: edges.filter((e) => e.alive), faces };
}
