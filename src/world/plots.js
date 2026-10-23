// Stage 4, second part: plots.
//
// A block's building line is moved in by the depth of its buildings; the
// band between the two is cut into plots, each cut running square to the
// street from the building line to the back of the band. Around each corner
// the cuts keep clear of the corner itself, so a corner plot wraps round it
// as an L (or a wedge on a sharp corner), as corner buildings do. What is
// left in the middle is the courtyard of a perimeter block, or the shared
// strip behind the back gardens of a rowhouse block.
//
// Plot widths come from the kind of building and the street it faces: shops
// and flats over them on a main street are narrower than a block of flats
// on a quiet street; a terrace keeps one width along its run, as one builder
// would have built it; podium plots in the core are wide. A perimeter block
// is not one solid ring: it is several buildings with gaps between them, at
// least one on every street, open through to the courtyard, where a path runs
// round along the backs of the buildings and paths cross the green to a
// small square in the middle. Plots that come out too small or too thin are
// joined to the next.

import { insetUniform, selfCrosses } from '../util/offset.js';
import { polygonArea } from '../util/geom.js';

export const PLOT_TYPES = {
  // depth: metres of building from the street; width: plot frontage range.
  perimeter: { depth: 14, width: [13, 24], minArea: 140 },
  mixed: { depth: 16, width: [10, 20], minArea: 130 },
  rowhouse: { depth: null, width: [5.2, 7.8], minArea: 90 },
  podium: { depth: 24, width: [30, 55], minArea: 600 },
};
const GAP = [4.5, 6.5]; // metres: the gap between two buildings, open through to the courtyard
const GAP_RUN = GAP[0]; // every frontage between corner buildings gets a gap
const GAP_EVERY = 55; // and one more for about every this many metres
const TIDY = 1.2; // metres: points of a plot closer than this are one
const SPIKE = (25 * Math.PI) / 180; // a turn this sharp beside a short edge is a sliver
export const TERRACE_RECT = 0.8; // how nearly rectangular a block must be for terraces down a spine
const MAX_HOUSE = 1400; // m²: the largest plot a house (end of terrace included) may take
const COURT_RING = 3.5; // metres: the path round a courtyard, along the backs of the buildings
const BACK_STRIP = 2; // metres either side of the middle of a rowhouse block left as a shared strip
const ROW_DEPTH = [16, 34]; // metres: a rowhouse plot's depth, from the street to the back strip
const MIN_COURT = 0.12; // a courtyard smaller than this share of its block is not left open
const CORNER_EXTRA = 1; // metres a corner plot reaches past its corner's zone, each way

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const unit = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

function ringParams(P) {
  const n = P.length;
  const cum = [0];
  for (let i = 0; i < n; i++) cum.push(cum[i] + len(sub(P[(i + 1) % n], P[i])));
  return cum;
}

// The point at arc length s along a closed ring, with its edge index.
function pointAt(P, cum, s) {
  const total = cum[cum.length - 1];
  s = ((s % total) + total) % total;
  let lo = 0;
  let hi = P.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  const a = P[lo];
  const b = P[(lo + 1) % P.length];
  const l = cum[lo + 1] - cum[lo] || 1;
  const t = (s - cum[lo]) / l;
  return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], i: lo, s };
}

// Points of a ring strictly between arc lengths s0 and s1 (going forward).
function between(P, cum, s0, s1) {
  const total = cum[cum.length - 1];
  const out = [];
  if (s1 < s0) s1 += total;
  for (let k = 0; k < P.length * 2; k++) {
    const base = Math.floor(k / P.length) * total;
    const s = cum[k % P.length] + base;
    if (s > s0 + 1e-6 && s < s1 - 1e-6) out.push(P[k % P.length]);
  }
  return out;
}

function segHit(a, b, c, d) {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [t, u];
}

// Where a ray from p along dir first meets a ring, as an arc length on it.
function rayToRing(p, dir, reach, R, cum) {
  const far = [p[0] + dir[0] * reach, p[1] + dir[1] * reach];
  let best = null;
  for (let i = 0; i < R.length; i++) {
    const h = segHit(p, far, R[i], R[(i + 1) % R.length]);
    if (h && (!best || h[0] < best.t)) best = { t: h[0], s: cum[i] + h[1] * (cum[i + 1] - cum[i]) };
  }
  return best ? { q: [p[0] + dir[0] * reach * best.t, p[1] + dir[1] * reach * best.t], s: best.s, d: reach * best.t } : null;
}

// Cut a band between outer ring N and inner ring I into plots.
// fronts[i] is what edge i of N faces; widthAt(s, front) gives the next
// plot width along a run. Returns plots, or null if the band will not cut.
function band(N, fronts, I, depth, widthOf, opts) {
  const n = N.length;
  const cumN = ringParams(N);
  const totalN = cumN[n];
  const cumI = ringParams(I);
  // Corners: where the building line turns sharply, or faces another street.
  const corners = [];
  for (let i = 0; i < n; i++) {
    const a = unit(sub(N[i], N[(i - 1 + n) % n]));
    const b = unit(sub(N[(i + 1) % n], N[i]));
    const turn = Math.atan2(cross(a, b), dot(a, b)); // > 0: convex (turning right on screen)
    const newStreet = fronts[i] !== fronts[(i - 1 + n) % n];
    if (Math.abs(turn) > 0.45 || newStreet) {
      // Half the inside angle; the band's inner corner sits this far along.
      const half = (Math.PI - turn) / 2;
      const zone = turn > 0 ? depth / Math.tan(half) : 0;
      corners.push({ i, s: cumN[i], zone: Math.max(0, Math.min(zone, depth * 3)) + CORNER_EXTRA, turn });
    }
  }
  if (!corners.length) corners.push({ i: 0, s: 0, zone: CORNER_EXTRA, turn: 0 });
  // Cut positions, run by run.
  const cuts = [];
  for (let c = 0; c < corners.length; c++) {
    const A = corners[c];
    const B = corners[(c + 1) % corners.length];
    let s0 = A.s + A.zone;
    let s1 = (B.s <= A.s ? B.s + totalN : B.s) - B.zone;
    const front = fronts[A.i];
    const runLen = s1 - s0;
    if (runLen < 1) continue;
    // Widths along the run, then stretched evenly to fill it.
    const ws = [];
    let filled = 0;
    let guard = 0;
    while (guard++ < 400) {
      const w = widthOf(front, ws.length);
      if (filled + w > runLen + w * 0.35) break;
      ws.push(w);
      filled += w;
    }
    if (!ws.length && runLen < GAP[0] * 2) continue;
    // Gaps between the buildings, through to the courtyard: at least one on
    // every frontage long enough, spread evenly between the buildings (a
    // gap may sit next to a corner building). Each is GAP wide, unstretched.
    const gaps = [];
    if (opts.passages && runLen >= GAP_RUN) {
      const want = Math.max(1, Math.round(runLen / GAP_EVERY));
      for (let j = 1; j <= want; j++) {
        const at = Math.round((j * ws.length) / (want + 1));
        if (!gaps.some((g) => g.at === at)) gaps.push({ at, w: opts.gapWidth() });
      }
      // Keep the buildings from being squeezed: drop gaps until they fit,
      // down to the one every frontage keeps (a building too narrow for it
      // joins the corner building next to it).
      const sumW = ws.reduce((a, b) => a + b, 0);
      while (gaps.length > 1 && (runLen - gaps.reduce((a, g) => a + g.w, 0)) / (sumW || 1) < 0.7) gaps.pop();
      if (!ws.length && gaps.length) gaps.length = 1;
    }
    const gapTotal = gaps.reduce((a, g) => a + g.w, 0);
    const stretch = ws.length ? (runLen - gapTotal) / ws.reduce((a, b) => a + b, 0) : 1;
    // The run as pieces in order: buildings and gaps.
    const pieces = [];
    for (let k = 0; k <= ws.length; k++) {
      for (const g of gaps) if (g.at === k) pieces.push({ w: g.w, gap: true });
      if (k < ws.length) pieces.push({ w: ws[k] * stretch, gap: false });
    }
    if (!pieces.length) continue;
    let s = s0;
    cuts.push({ s: s0, passageNext: pieces[0].gap });
    for (let k = 0; k < pieces.length; k++) {
      s += pieces[k].w;
      if (k < pieces.length - 1) cuts.push({ s, passageNext: pieces[k + 1].gap });
    }
    cuts.push({ s: s1 });
  }
  // Each cut runs square to the building line, in to the inner ring.
  const placed = [];
  for (const c of cuts) {
    const at = pointAt(N, cumN, c.s);
    const t = unit(sub(N[(at.i + 1) % n], N[at.i]));
    const nrm = [-t[1], t[0]];
    const hit = rayToRing(at.p, nrm, depth * 2.5, I, cumI);
    if (hit && hit.d < depth * 0.4) continue;
    if (!hit || hit.d > depth * 1.8) {
      // The courtyard does not reach here (the inset lost this lobe of the
      // block): the building still goes back its usual depth, or where the
      // block is too narrow for that, back to back with the building on the
      // other side, halfway across.
      const far = rayToRing([at.p[0] + nrm[0] * 0.05, at.p[1] + nrm[1] * 0.05], nrm, depth * 2.5, N, cumN);
      const back = far ? Math.min(depth, far.d / 2) : depth;
      const q = [at.p[0] + nrm[0] * back, at.p[1] + nrm[1] * back];
      if (back < 3 || !inside(N, q)) continue;
      placed.push({ s: ((c.s % totalN) + totalN) % totalN, p: at.p, q, qs: null, passageNext: c.passageNext });
      continue;
    }
    placed.push({ s: ((c.s % totalN) + totalN) % totalN, p: at.p, q: hit.q, qs: hit.s, passageNext: c.passageNext });
  }
  placed.sort((a, b) => a.s - b.s);
  // Cuts must keep their order round the inner ring too.
  const kept = [];
  for (const c of placed) {
    if (kept.length) {
      const prev = kept[kept.length - 1];
      if (c.s - prev.s < 0.5) continue;
      if (c.qs === null || prev.qs === null) {
        kept.push(c);
        continue;
      }
      const dq = (((c.qs - prev.qs) % cumI[I.length]) + cumI[I.length]) % cumI[I.length];
      if (dq > cumI[I.length] * 0.5) continue;
    }
    kept.push(c);
  }
  if (kept.length < 2) return null;
  // Plots between consecutive cuts; small or thin ones join the next.
  const build = (a, b) => {
    const outer = [a.p, ...between(N, cumN, a.s, b.s), b.p];
    const inner = a.qs === null || b.qs === null ? [b.q, a.q] : [b.q, ...between(I, cumI, a.qs, b.qs).reverse(), a.q];
    return outer.concat(inner);
  };
  let list = kept;
  for (let round = 0; round < 8; round++) {
    const out = [];
    for (let k = 0; k < list.length; k++) {
      const a = list[k];
      const b = list[(k + 1) % list.length];
      const pts = build(a, b);
      const area = polygonArea(pts);
      const front = ((b.s - a.s) % totalN + totalN) % totalN;
      const passage = !!a.passageNext && front < GAP[1] * 1.5;
      const ok = passage ? area > 10 && !selfCrosses(pts) : area >= opts.minArea && front >= opts.minFront && !selfCrosses(pts);
      // A corner plot has a corner of the block within its frontage.
      const corner = corners.some((c) => (((c.s - a.s) % totalN) + totalN) % totalN < front);
      out.push({ pts, front, area, passage, corner, ok, edge: pointAt(N, cumN, (a.s + front / 2) % totalN).i, door: passage ? [(a.q[0] + b.q[0]) / 2, (a.q[1] + b.q[1]) / 2] : null });
    }
    // A plot too small or thin joins a neighbouring building (not a gap) by
    // dropping the cut between them; a bad gap is closed up.
    const m = list.length;
    const drop = new Set();
    for (let k = 0; k < m; k++) {
      if (out[k].ok) continue;
      if (out[k].passage) {
        drop.add(k);
        continue;
      }
      const next = out[(k + 1) % m];
      const prev = out[(k - 1 + m) % m];
      if (!next.passage) drop.add((k + 1) % m);
      else if (!prev.passage) drop.add(k);
      else drop.add((k + 1) % m);
    }
    if (!drop.size) return out;
    if (m - drop.size < 2) return null;
    // A dropped cut that started a gap hands that on to nothing: the gap is
    // gone. A dropped cut after a gap widens it into the building, so the
    // gap's own start loses its mark instead.
    for (const k of drop) {
      const prevCut = list[(k - 1 + m) % m];
      if (prevCut.passageNext && !drop.has((k - 1 + m) % m)) list[(k - 1 + m) % m] = { ...prevCut, passageNext: false };
    }
    list = list.filter((_, k) => !drop.has(k));
  }
  return null;
}

// The public paths of a courtyard: a ring just inside the backs of the
// buildings, joining every gap, and through the garden a small network of
// paths, as in a park: a few junctions spread about the garden, linked by
// gently curving paths, with the nearer gaps joined to them. Paths never
// all meet in one place; where three or more meet there is a little square.
function courtyard(I, doors, rng) {
  const green = insetUniform(I, COURT_RING);
  if (!green || polygonArea(green) < 60) return { green: null, paths: [], nodes: [] };
  const A = polygonArea(green);
  // Bend a path from a to b a little to one side; null if it leaves the garden.
  const bend = (a, b, within) => {
    const d = sub(b, a);
    const L = len(d);
    if (L < 4) return null;
    const nrm = [-d[1] / L, d[0] / L];
    for (const k of [(rng.next() - 0.5) * 0.5, (rng.next() - 0.5) * 0.25, 0]) {
      const c = [(a[0] + b[0]) / 2 + nrm[0] * k * L, (a[1] + b[1]) / 2 + nrm[1] * k * L];
      const pts = [];
      const m = Math.max(4, Math.ceil(L / 4));
      for (let i = 0; i <= m; i++) {
        const t = i / m;
        pts.push([(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]]);
      }
      if (pts.slice(1, -1).every((q, i) => inside(i < 2 || i > pts.length - 5 ? I : within, q))) return pts;
    }
    return null;
  };
  // Junctions, spread out and kept off the garden's edge.
  const want = A < 450 ? 0 : Math.min(5, 1 + Math.floor(A / 1600));
  const deep = insetUniform(green, 7) || green;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of deep) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  const cands = [];
  for (let t = 0; t < 80 && cands.length < 30; t++) {
    const q = [x0 + (x1 - x0) * rng.next(), y0 + (y1 - y0) * rng.next()];
    if (inside(deep, q)) cands.push(q);
  }
  const nodes = [];
  while (nodes.length < want && cands.length) {
    // The candidate farthest from those chosen (the first at random).
    let best = 0;
    let bd = -1;
    cands.forEach((q, i) => {
      const dd = nodes.length ? Math.min(...nodes.map((n) => len(sub(n.p, q)))) : rng.next();
      if (dd > bd) [best, bd] = [i, dd];
    });
    if (nodes.length && bd < 14) break;
    nodes.push({ p: cands.splice(best, 1)[0], degree: 0 });
  }
  const paths = [];
  const link = (a, b, na, nb) => {
    const pts = bend(a, b, green);
    if (!pts) return false;
    paths.push(pts);
    if (na) na.degree++;
    if (nb) nb.degree++;
    return true;
  };
  // Junctions joined up, nearest first (a spanning tree), with now and then
  // one more link to make a loop.
  const joined = nodes.length ? [nodes[0]] : [];
  while (joined.length < nodes.length) {
    let pick = null;
    for (const n of nodes) {
      if (joined.includes(n)) continue;
      for (const m of joined) {
        const dd = len(sub(n.p, m.p));
        if (!pick || dd < pick.dd) pick = { n, m, dd };
      }
    }
    joined.push(pick.n);
    link(pick.m.p, pick.n.p, pick.m, pick.n);
  }
  if (nodes.length >= 4 && rng.next() < 0.6) {
    const [a, b] = [nodes[nodes.length - 1], nodes[nodes.length - 2]];
    link(a.p, b.p, a, b);
  }
  // Gaps to their nearest junction, at most three to any one.
  if (nodes.length) {
    for (const d of doors) {
      const order = nodes.slice().sort((a, b) => len(sub(a.p, d)) - len(sub(b.p, d)));
      const n = order.find((q) => q.degree < 4);
      if (n) link(d, n.p, null, n);
    }
  } else if (doors.length >= 2) {
    // A small courtyard: one path across, between the two gaps farthest apart.
    let pair = null;
    for (let i = 0; i < doors.length; i++) for (let j = i + 1; j < doors.length; j++) {
      const dd = len(sub(doors[i], doors[j]));
      if (!pair || dd > pair.dd) pair = { a: doors[i], b: doors[j], dd };
    }
    link(pair.a, pair.b, null, null);
  }
  return { green, paths, nodes: nodes.filter((n) => n.degree >= 3).map((n) => ({ p: n.p, r: 3 + n.degree * 0.5 })) };
}

function inside(P, q) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i];
    const b = P[j];
    if (a[1] > q[1] !== b[1] > q[1] && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

// The direction of a polygon's long sides: the long side of its smallest
// enclosing rectangle that lies along one of its edges. (The two points
// farthest apart lie across a diagonal, which would cut a rectangle aslant.)
function longAxis(N) {
  let best = null;
  for (let i = 0; i < N.length; i++) {
    const e = sub(N[(i + 1) % N.length], N[i]);
    if (len(e) < 1) continue;
    const u = unit(e);
    const v = [-u[1], u[0]];
    let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of N) {
      const a = dot(p, u);
      const b = dot(p, v);
      u0 = Math.min(u0, a);
      u1 = Math.max(u1, a);
      v0 = Math.min(v0, b);
      v1 = Math.max(v1, b);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area - 1e-6) best = { area, u: u1 - u0 >= v1 - v0 ? u : v };
  }
  return best ? best.u : [1, 0];
}

// A plot outline without the slivers cutting leaves behind: points within
// TIDY of the last one kept, and spikes (a sharp turn beside a very short
// edge), are dropped.
function tidyRing(P) {
  let pts = [];
  for (const p of P) if (!pts.length || len(sub(p, pts[pts.length - 1])) >= TIDY) pts.push(p);
  while (pts.length > 3 && len(sub(pts[0], pts[pts.length - 1])) < TIDY) pts.pop();
  for (let round = 0; round < 4 && pts.length > 3; round++) {
    const keep = pts.filter((v, i) => {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[(i + 1) % pts.length];
      const u = sub(a, v);
      const w = sub(b, v);
      const lu = len(u);
      const lw = len(w);
      const ang = Math.acos(Math.max(-1, Math.min(1, dot(u, w) / (lu * lw || 1))));
      return !(ang < SPIKE && Math.min(lu, lw) < TIDY * 2.5);
    });
    if (keep.length === pts.length || keep.length < 3) break;
    pts = keep;
  }
  return pts;
}

// A polygon's area over that of its smallest enclosing rectangle.
export function rectness(N) {
  const u = longAxis(N);
  const v = [-u[1], u[0]];
  let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const p of N) {
    u0 = Math.min(u0, dot(p, u));
    u1 = Math.max(u1, dot(p, u));
    v0 = Math.min(v0, dot(p, v));
    v1 = Math.max(v1, dot(p, v));
  }
  return polygonArea(N) / ((u1 - u0) * (v1 - v0) || 1);
}

// Cut a block with no room for a courtyard straight across into plots; a
// piece too small to build on joins its smaller neighbour.
function slices(N, widthOf, front, minArea, wide) {
  // Cut square to the block's long sides, not its diagonal.
  const u = longAxis(N);
  const a = 0;
  const proj = N.map((p) => dot(sub(p, N[a]), u));
  const lo = Math.min(...proj);
  const hi = Math.max(...proj);
  const ws = [];
  let filled = 0;
  while (filled < hi - lo - 1) {
    const w = widthOf(front, ws.length) * wide;
    ws.push(w);
    filled += w;
  }
  const stretch = (hi - lo) / filled;
  let ranges = [];
  let s = lo;
  for (const w of ws) {
    ranges.push([s, s + w * stretch]);
    s += w * stretch;
  }
  const piece = ([s0, s1]) => {
    const pts = clipSlab(N, N[a], u, s0, s1);
    return pts && pts.length > 2 ? { pts, area: polygonArea(pts), front: s1 - s0 } : { pts: null, area: 0, front: 0 };
  };
  let pieces = ranges.map(piece);
  for (let guard = 0; guard < 50 && pieces.length > 1; guard++) {
    let k = pieces.findIndex((p) => p.area < minArea);
    if (k < 0) break;
    // Join it with the smaller of its neighbours.
    const j = k === 0 ? 1 : k === pieces.length - 1 ? k - 1 : pieces[k - 1].area < pieces[k + 1].area ? k - 1 : k + 1;
    const [x, y] = [Math.min(j, k), Math.max(j, k)];
    ranges.splice(x, 2, [ranges[x][0], ranges[y][1]]);
    pieces.splice(x, 2, piece(ranges[x]));
  }
  return pieces.filter((p) => p.pts);
}

// The part of polygon P with o + u * s0 <= x . u <= o + u * s1 (Sutherland-Hodgman).
function clipSlab(P, o, u, s0, s1) {
  const clip = (pts, keep) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const fp = keep(p);
      const fq = keep(q);
      if (fp >= 0) out.push(p);
      if ((fp >= 0) !== (fq >= 0)) {
        const t = fp / (fp - fq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    return out;
  };
  const s = (p) => dot(sub(p, o), u);
  return clip(clip(P, (p) => s(p) - s0), (p) => s1 - s(p));
}

// A polyline's arc-length parameters.
function lineParams(L) {
  const cum = [0];
  for (let i = 1; i < L.length; i++) cum.push(cum[i - 1] + len(sub(L[i], L[i - 1])));
  return cum;
}

// Where a ray first meets an open polyline: the point and its arc length.
function rayToLine(p, dir, reach, L, cum) {
  const far = [p[0] + dir[0] * reach, p[1] + dir[1] * reach];
  let best = null;
  for (let i = 0; i < L.length - 1; i++) {
    const h = segHit(p, far, L[i], L[i + 1]);
    if (h && (!best || h[0] < best.t)) best = { t: h[0], s: cum[i] + h[1] * (cum[i + 1] - cum[i]) };
  }
  return best ? { q: [p[0] + dir[0] * reach * best.t, p[1] + dir[1] * reach * best.t], s: best.s, d: reach * best.t } : null;
}

// Points of an open polyline strictly between arc lengths s0 < s1.
function lineBetween(L, cum, s0, s1) {
  const out = [];
  for (let i = 0; i < L.length; i++) if (cum[i] > s0 + 1e-6 && cum[i] < s1 - 1e-6) out.push(L[i]);
  return out;
}

// The spine of a long thin polygon: the line midway between its long
// sides, from one end to the other.
function spine(N) {
  // Long axis through the centroid.
  let cx = 0;
  let cy = 0;
  for (const p of N) {
    cx += p[0] / N.length;
    cy += p[1] / N.length;
  }
  const u = longAxis(N);
  const v = [-u[1], u[0]];
  const c = [cx, cy];
  const proj = N.map((p) => dot(sub(p, c), u));
  const lo = Math.min(...proj);
  const hi = Math.max(...proj);
  const cross2 = (o, dir) => {
    // Nearest crossings of the line o + dir * t with N on either side of o.
    const far = 1e4;
    const A = [o[0] - dir[0] * far, o[1] - dir[1] * far];
    const B = [o[0] + dir[0] * far, o[1] + dir[1] * far];
    let neg = null;
    let pos = null;
    for (let i = 0; i < N.length; i++) {
      const h = segHit(A, B, N[i], N[(i + 1) % N.length]);
      if (!h) continue;
      const t = (h[0] - 0.5) * 2 * far;
      if (t < 0 && (neg === null || t > neg)) neg = t;
      if (t > 0 && (pos === null || t < pos)) pos = t;
    }
    return neg !== null && pos !== null ? [neg, pos] : null;
  };
  // Midpoints of cross sections, every 6 m; near the ends a cross section
  // cuts the short side, so only those of about the block's usual width count.
  const secs = [];
  for (let s = lo + 4; s <= hi - 4; s += 6) {
    const o = [c[0] + u[0] * s, c[1] + u[1] * s];
    const r = cross2(o, v);
    if (!r) continue;
    const m = (r[0] + r[1]) / 2;
    secs.push({ p: [o[0] + v[0] * m, o[1] + v[1] * m], w: r[1] - r[0] });
  }
  if (secs.length < 4) return null;
  const widths = secs.map((x) => x.w).sort((x, y) => x - y);
  const usual = widths[widths.length >> 1];
  const mids = secs.filter((x) => Math.abs(x.w - usual) < usual * 0.12).map((x) => x.p);
  if (mids.length < 3) return null;
  // Smooth, then run out to the ends along the last few sections' line.
  const sm = mids.map((p, i) => {
    const q = mids[Math.max(0, i - 1)];
    const r = mids[Math.min(mids.length - 1, i + 1)];
    return [(q[0] + 2 * p[0] + r[0]) / 4, (q[1] + 2 * p[1] + r[1]) / 4];
  });
  const end = (p, q) => {
    const dir = unit(sub(p, q));
    const r = cross2(p, dir);
    return r ? [p[0] + dir[0] * r[1], p[1] + dir[1] * r[1]] : null;
  };
  const k = Math.min(3, sm.length - 1);
  const e0 = end(sm[0], sm[k]);
  const e1 = end(sm[sm.length - 1], sm[sm.length - 1 - k]);
  if (!e0 || !e1) return null;
  return [e0, ...sm, e1];
}

// Where on ring N (clockwise) a point lies: [edge index, param], or null.
function onRing(N, p) {
  let best = null;
  for (let i = 0; i < N.length; i++) {
    const a = N[i];
    const b = N[(i + 1) % N.length];
    const ab = sub(b, a);
    const l2 = dot(ab, ab);
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
    const d = len(sub([a[0] + ab[0] * t, a[1] + ab[1] * t], p));
    if (!best || d < best.d) best = { i, t, d };
  }
  return best && best.d < 0.5 ? best : null;
}

// Rowhouse plots: the block split down its spine, each half cut into a
// terrace of houses running back to the spine, with an end house at each
// end turning the corner onto the side street.
function terraces(N, fronts, widthOf) {
  const fail = () => null;
  const M = spine(N);
  if (!M) return fail('spine');
  const hs = onRing(N, M[0]);
  const he = onRing(N, M[M.length - 1]);
  if (!hs || !he || hs.i === he.i) return fail('ends');
  const n = N.length;
  const plots = [];
  // Half one runs round from the spine's end to its start; half two from
  // its start to its end. Each frontage, with the spine as its back.
  for (const [from, to, back] of [[he, hs, M.slice().reverse()], [hs, he, M]]) {
    const F = [back[0]];
    const ff = [];
    for (let k = (from.i + 1) % n, guard = 0; guard <= n; k = (k + 1) % n, guard++) {
      ff.push(fronts[(k - 1 + n) % n]);
      F.push(N[k]);
      if (k === to.i) break;
    }
    ff.push(fronts[to.i]);
    F.push(back[back.length - 1]);
    // (F runs from the spine round the frontage and back to the spine; the
    // back, reversed, runs the other way, so a cut at frontage arc s meets
    // the back at about the matching place.)
    const B = back.slice().reverse();
    const cumF = lineParams(F);
    const cumB = lineParams(B);
    // The frontage from the block's first corner to its last: everything but
    // the half short sides at each end, which the end houses take.
    const turns = [];
    for (let k = 1; k < F.length - 1; k++) {
      const a = unit(sub(F[k], F[k - 1]));
      const b = unit(sub(F[k + 1], F[k]));
      if (Math.abs(Math.atan2(cross(a, b), dot(a, b))) > 0.5) turns.push(k);
    }
    const run = turns.length >= 2 ? { a: turns[0], b: turns[turns.length - 1] } : turns.length === 1 ? { a: turns[0], b: F.length - 1 } : { a: 0, b: F.length - 1 };
    run.l = cumF[run.b] - cumF[run.a];
    if (run.l < 20) return fail('run');
    // What the terrace faces: the street along the middle of its frontage.
    const mid = cumF[run.a] + run.l / 2;
    let km = 0;
    while (km < F.length - 2 && cumF[km + 1] < mid) km++;
    const front = ff[Math.min(ff.length - 1, km)];
    // Terrace widths along the run, the end houses a little wider.
    const endW = widthOf(front, 0) * 1.25;
    const s0 = cumF[run.a] + (run.a === 0 ? 0 : endW);
    const s1 = cumF[run.b] - (run.b === F.length - 1 ? 0 : endW);
    const ws = [];
    let filled = 0;
    let guard = 0;
    while (guard++ < 300) {
      const w = widthOf(front, ws.length + 1);
      if (filled + w > s1 - s0 + w * 0.35) break;
      ws.push(w);
      filled += w;
    }
    const stretch = ws.length ? (s1 - s0) / filled : 1;
    const cuts = [];
    let s = s0;
    cuts.push(s);
    for (let k = 0; k < ws.length - 1; k++) {
      s += ws[k] * stretch;
      cuts.push(s);
    }
    cuts.push(s1);
    // Each cut square to the frontage, back to the spine.
    const placed = [{ s: 0, p: F[0], q: B[B.length - 1], qs: cumB[B.length - 1] }];
    for (const c of cuts) {
      let k = 0;
      while (k < F.length - 2 && cumF[k + 1] < c) k++;
      const t = unit(sub(F[k + 1], F[k]));
      const tt = (c - cumF[k]) / (cumF[k + 1] - cumF[k] || 1);
      const p = [F[k][0] + (F[k + 1][0] - F[k][0]) * tt, F[k][1] + (F[k + 1][1] - F[k][1]) * tt];
      const prev = placed[placed.length - 1];
      if (c - prev.s < 2) continue;
      let hit = rayToLine(p, [-t[1], t[0]], 80, B, cumB);
      // Where a cut square to the street would miss the spine or cross the
      // last one (on a curve, or where the block narrows), it meets the
      // spine where its share of the way along says instead.
      if (!hit || hit.s >= prev.qs - 0.3) {
        const qs = cumB[B.length - 1] * (1 - (c - s0 + (s0 - cumF[0])) / (cumF[F.length - 1] || 1));
        if (qs >= prev.qs - 0.3 || qs <= 0.3) continue;
        let k = 0;
        while (k < B.length - 2 && cumB[k + 1] < qs) k++;
        const u = (qs - cumB[k]) / (cumB[k + 1] - cumB[k] || 1);
        hit = { q: [B[k][0] + (B[k + 1][0] - B[k][0]) * u, B[k][1] + (B[k + 1][1] - B[k][1]) * u], s: qs };
      }
      placed.push({ s: c, p, q: hit.q, qs: hit.s });
    }
    placed.push({ s: cumF[F.length - 1], p: F[F.length - 1], q: B[0], qs: 0 });
    for (let k = 0; k + 1 < placed.length; k++) {
      const a = placed[k];
      const b = placed[k + 1];
      const pts = [a.p, ...lineBetween(F, cumF, a.s, b.s), b.p];
      if (k + 1 < placed.length - 1) pts.push(b.q);
      // Back along the spine, from b's cut to a's.
      pts.push(...lineBetween(B, cumB, b.qs, a.qs));
      if (k > 0) pts.push(a.q);
      const area = polygonArea(pts);
      if (area < 20) continue;
      plots.push({ pts, area, front: b.s - a.s, corner: k === 0 || k === placed.length - 2, faces: front });
    }
  }
  return plots.length ? plots : fail('none');
}

// Plots of one block. `fronts[i]` is the kind of street edge i of the
// block's building line faces; rng gives the variation.
export function plotsOfBlock(N, fronts, use, W, rng) {
  const out = plotsOf(N, fronts, use, W, rng);
  for (const p of out.plots) {
    if (p.pts === N) continue;
    const t = tidyRing(p.pts);
    if (t.length >= 3) {
      p.pts = t;
      p.area = polygonArea(t);
    }
  }
  return out;
}

function plotsOf(N, fronts, use, W, rng) {
  if (use === 'perimeter' || use === 'podium' || use === 'rowhouse') {
    const onMain = (f) => f === 'main' || f === 'boulevard' || f === 'pedestrian';
    // A terrace keeps one width along each run.
    const terrace = new Map();
    const widthOf = (front, k) => {
      const type = use === 'perimeter' && onMain(front) ? PLOT_TYPES.mixed : PLOT_TYPES[use];
      const [w0, w1] = type.width;
      if (use === 'rowhouse') {
        if (!terrace.has(front)) terrace.set(front, w0 + (w1 - w0) * rng.next());
        return terrace.get(front) * (0.96 + 0.08 * rng.next());
      }
      // Skewed towards the narrow end, with now and then a wide one.
      const u = rng.next();
      return w0 + (w1 - w0) * u * u + (k % 5 === 4 && rng.next() < 0.3 ? (w1 - w0) * 0.5 : 0);
    };
    // Terraces down a spine suit a roughly rectangular block; any house
    // there far bigger than its neighbours means the spine went wrong.
    if (use === 'rowhouse' && rectness(N) >= TERRACE_RECT) {
      const t = terraces(N, fronts, widthOf);
      const ok = t && t.every((p) => !selfCrosses(p.pts) && p.area <= MAX_HOUSE);
      if (ok) return { plots: t.map((p) => ({ ...p, kind: 'rowhouse' })), inner: null, depth: null };
    }
    let depth;
    let I = null;
    if (use === 'rowhouse') {
      depth = Math.max(ROW_DEPTH[0], Math.min(ROW_DEPTH[1], W / 2 - BACK_STRIP));
    } else {
      depth = PLOT_TYPES[use].depth;
      if (use === 'perimeter' && fronts.some(onMain)) depth = PLOT_TYPES.mixed.depth;
    }
    for (const d of [depth, depth * 0.8, depth * 0.65]) {
      I = insetUniform(N, d);
      if (I && polygonArea(I) > 20) {
        depth = d;
        break;
      }
      I = null;
    }
    const type = PLOT_TYPES[use];
    // Podium blocks are built across, a few big buildings; and a block whose
    // courtyard would be a light well is built solid.
    if (use === 'podium' || (I && polygonArea(I) < polygonArea(N) * MIN_COURT)) I = null;
    if (I) {
      const plots = band(N, fronts, I, depth, widthOf, {
        passages: use !== 'rowhouse',
        gapWidth: () => GAP[0] + (GAP[1] - GAP[0]) * rng.next(),
        minArea: type.minArea,
        minFront: use === 'rowhouse' ? type.width[0] * 0.8 : type.width[0] * 0.7,
      });
      // Rowhouses round an irregular block that would not cut into houses
      // of a sensible size are built as small blocks of flats instead.
      if (use === 'rowhouse' && (!plots || plots.some((p) => !p.passage && p.area > MAX_HOUSE))) return plotsOf(N, fronts, 'perimeter', W, rng);
      if (plots) {
        const court = use === 'rowhouse' ? null : courtyard(I, plots.filter((p) => p.passage).map((p) => p.door), rng);
        return { plots: plots.map(({ ok, door, ...p }) => ({ ...p, kind: p.passage ? 'passage' : use, faces: fronts[p.edge] })), inner: I, court, depth };
      }
    }
    // No room for a courtyard: straight across.
    const front = fronts.find(onMain) || fronts[0];
    const cut = slices(N, widthOf, front, use === 'podium' ? type.minArea * 2 : type.minArea * 1.5, use === 'podium' ? 1 : 1.4);
    const plots = cut.length ? cut : [{ pts: N, area: polygonArea(N), front: 0 }];
    return { plots: plots.map((p, k) => ({ ...p, kind: use, faces: front, corner: k === 0 || k === plots.length - 1 })), inner: null, depth: null };
  }
  // Squares, parks, schools, campuses and greens are one plot each.
  return { plots: [{ pts: N, area: polygonArea(N), front: 0, kind: use, faces: fronts[0] }], inner: null, depth: null };
}
