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
// would have built it; podium plots in the core are wide. A long frontage of
// a perimeter block gets a passage through to the courtyard. Plots that come
// out too small or too thin are joined to the next.

import { insetUniform, selfCrosses } from '../util/offset.js';
import { polygonArea } from '../util/geom.js';

export const PLOT_TYPES = {
  // depth: metres of building from the street; width: plot frontage range.
  perimeter: { depth: 14, width: [13, 24], minArea: 140 },
  mixed: { depth: 16, width: [10, 20], minArea: 130 },
  rowhouse: { depth: null, width: [5.2, 7.8], minArea: 90 },
  podium: { depth: 24, width: [30, 55], minArea: 600 },
};
const PASSAGE = 5; // metres: a walkway through to a courtyard
const PASSAGE_RUN = 70; // a frontage at least this long gets one
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
    if (!ws.length) continue;
    // A passage through to the courtyard, near the middle of a long run.
    let passageAt = -1;
    if (opts.passages && runLen >= PASSAGE_RUN && ws.length >= 3) {
      passageAt = Math.floor(ws.length / 2);
      ws.splice(passageAt, 0, PASSAGE);
    }
    const stretch = runLen / ws.reduce((a, b) => a + b, 0);
    let s = s0;
    cuts.push({ s: s0 });
    for (let k = 0; k < ws.length; k++) {
      s += ws[k] * (k === passageAt ? 1 : stretch);
      if (k === passageAt) cuts[cuts.length - 1].passageNext = true;
      if (k < ws.length - 1) cuts.push({ s });
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
    if (!hit || hit.d > depth * 1.8 || hit.d < depth * 0.4) continue;
    placed.push({ s: ((c.s % totalN) + totalN) % totalN, p: at.p, q: hit.q, qs: hit.s, passageNext: c.passageNext });
  }
  placed.sort((a, b) => a.s - b.s);
  // Cuts must keep their order round the inner ring too.
  const kept = [];
  for (const c of placed) {
    if (kept.length) {
      const prev = kept[kept.length - 1];
      if (c.s - prev.s < 0.5) continue;
      const dq = (((c.qs - prev.qs) % cumI[I.length]) + cumI[I.length]) % cumI[I.length];
      if (dq > cumI[I.length] * 0.5) continue;
    }
    kept.push(c);
  }
  if (kept.length < 2) return null;
  // Plots between consecutive cuts; small or thin ones join the next.
  const build = (a, b) => {
    const outer = [a.p, ...between(N, cumN, a.s, b.s), b.p];
    const inner = [b.q, ...between(I, cumI, a.qs, b.qs).reverse(), a.q];
    return outer.concat(inner);
  };
  let list = kept;
  for (let round = 0; round < 8; round++) {
    const out = [];
    const drop = new Set();
    for (let k = 0; k < list.length; k++) {
      const a = list[k];
      const b = list[(k + 1) % list.length];
      const pts = build(a, b);
      const area = polygonArea(pts);
      const front = ((b.s - a.s) % totalN + totalN) % totalN;
      const passage = !!a.passageNext && front < PASSAGE * 1.5;
      const ok = passage ? area > 10 : area >= opts.minArea && front >= opts.minFront && !selfCrosses(pts);
      if (!ok) drop.add((k + 1) % list.length);
      out.push({ pts, front, area, passage, edge: pointAt(N, cumN, (a.s + front / 2) % totalN).i });
    }
    if (!drop.size || list.length - drop.size < 2) return out;
    list = list.filter((_, k) => !drop.has(k));
  }
  return null;
}

// Cut a block with no room for a courtyard straight across into plots; a
// piece too small to build on joins its smaller neighbour.
function slices(N, widthOf, front, minArea, wide) {
  // Long axis from the two farthest-apart points' direction.
  let a = 0;
  let b = 0;
  let best = 0;
  for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
    const d = len(sub(N[i], N[j]));
    if (d > best) [best, a, b] = [d, i, j];
  }
  const u = unit(sub(N[b], N[a]));
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
  let a = 0;
  let b = 0;
  let best = 0;
  for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
    const d = len(sub(N[i], N[j]));
    if (d > best) [best, a, b] = [d, i, j];
  }
  const u = unit(sub(N[b], N[a]));
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
      const hit = rayToLine(p, [-t[1], t[0]], 80, B, cumB);
      if (!hit) continue;
      const prev = placed[placed.length - 1];
      if (hit.s >= prev.qs - 0.3 || c - prev.s < 2) continue; // keeps its order along the spine
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
      plots.push({ pts, area, front: b.s - a.s, end: k === 0 || k === placed.length - 2, faces: front });
    }
  }
  return plots.length ? plots : fail('none');
}

// Plots of one block. `fronts[i]` is the kind of street edge i of the
// block's building line faces; rng gives the variation.
export function plotsOfBlock(N, fronts, use, W, rng) {
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
    if (use === 'rowhouse') {
      const t = terraces(N, fronts, widthOf);
      if (t && t.every((p) => !selfCrosses(p.pts))) return { plots: t.map((p) => ({ ...p, kind: p.end ? 'corner' : 'rowhouse' })), inner: null, depth: null };
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
        minArea: type.minArea,
        minFront: use === 'rowhouse' ? type.width[0] * 0.8 : type.width[0] * 0.7,
      });
      if (plots) return { plots: plots.map((p) => ({ ...p, kind: p.passage ? 'passage' : use, faces: fronts[p.edge] })), inner: I, depth };
    }
    // No room for a courtyard: straight across.
    const front = fronts.find(onMain) || fronts[0];
    const cut = slices(N, widthOf, front, use === 'podium' ? type.minArea * 2 : type.minArea * 1.5, use === 'podium' ? 1 : 1.4);
    const plots = cut.length ? cut : [{ pts: N, area: polygonArea(N), front: 0 }];
    return { plots: plots.map((p) => ({ ...p, kind: use, faces: front })), inner: null, depth: null };
  }
  // Squares, parks, schools, campuses and greens are one plot each.
  return { plots: [{ pts: N, area: polygonArea(N), front: 0, kind: use, faces: fronts[0] }], inner: null, depth: null };
}
