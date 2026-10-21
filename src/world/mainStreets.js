// Main streets of a district, laid out as an organic grid.
//
// A smooth direction field covers the district: near a boulevard it follows
// the boulevard, near a greenway it follows the greenway, around the core
// it leans towards the station, and elsewhere it drifts slowly. Streets are
// traced along the field in one of its two families (along it or across it),
// so they bend gently and meet each other mostly at right angles, in four-way
// crossings or T junctions. A street stops when it comes too close to a
// street running the same way, so parallel streets stay apart and never run
// alongside each other.
//
// Streets are seeded, in this order, from:
//   1. every crossing point on the district's greenways (shared with the
//      neighbouring district, so streets carry on across)
//   2. every neighbourhood not yet reached, heading towards the core
//   3. every pair of neighbouring neighbourhoods not yet joined
//   4. any land still more than MAIN_STREET_REACH from a street
// Then every loose end is trimmed back to its last junction, so no main
// street dead-ends, and each neighbourhood's centre is put on the street
// that serves it.

import { createNoise } from '../core/noise.js';
import { hash, toUnit } from '../core/hash.js';
import { keyInts } from './cores.js';
import { lineBox, piecesOf } from './boulevards.js';
import { stamp, distanceField } from '../util/raster.js';

export const MAIN_STREET_REACH = 450; // metres from any point to a main street
export const STREET_GAP = 420; // closest two streets running the same way may come
const STEP = 20; // metres per tracing step
const MAX_TURN = STEP / 140;
const MAX_TOTAL_TURN = (100 * Math.PI) / 180; // a street turns no more than this end to end // radians per step: no bend tighter than about 140 m radius
const FIELD_CELL = 150;
const BUCKET = 200;
const KEY = 4194304; // bucket keys are i * KEY + j
const MAX_LENGTH = 5000;
const LOOKAHEAD = 300; // a loose end reaches this far ahead for a street to meet
const OVERSHOOT = 4;
const STUB = 70; // straight metres from a greenway crossing before following the field
const NEIGHBOUR_EDGE = 300; // shared boundary that calls for a street between two neighbourhoods
const EDGE_GAP = 170; // closest a street may run alongside a greenway (centreline)
const PARALLEL = 0.8;
const GLANCING = 0.82; // |cos| above which a street meeting another is too shallow (about 35°)
const JUNCTION_GAP = 110; // a new join keeps this far from other junctions // |cos| above which two streets count as running the same way

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const unit = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = cx - ax;
  const qy = cy - ay;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [t, u];
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}

export function createMainStreets(seed) {
  const drift = createNoise(seed, 'street-field');

  // Everything for one district. `grid` is the district's land raster;
  // `crossings` lists greenway crossings with their inward normals.
  return function build(d, hoods, chains, grid, crossings) {
    const salt = keyInts(d.coreInfo);
    const S = d.station;
    const LAND = 1;

    // ---- Direction field ----
    const samples = [];
    const addSamples = (pts, w, sigma, every) => {
      for (let i = every; i < pts.length - every; i += every) {
        const t = unit(sub(pts[i + every], pts[i - every]));
        samples.push({ x: pts[i][0], y: pts[i][1], a: Math.atan2(t[1], t[0]), w, s2: sigma * sigma });
      }
    };
    for (const l of d.network.lines) if (l.kind !== 'roundabout') addSamples(l.points, 1.6, 420, 8);
    addSamples(d.ring.concat([d.ring[0]]), 1.2, 280, 6);
    const sbuckets = new Map();
    const SB = 400;
    for (const s of samples) {
      const k = `${Math.floor(s.x / SB)},${Math.floor(s.y / SB)}`;
      let b = sbuckets.get(k);
      if (!b) sbuckets.set(k, (b = []));
      b.push(s);
    }
    const base = toUnit(hash(seed, 'street-field-angle', ...salt)) * Math.PI;
    const fx0 = grid.x0;
    const fy0 = grid.y0;
    const FW = Math.ceil((grid.W * 50) / FIELD_CELL) + 2;
    const FH = Math.ceil((grid.H * 50) / FIELD_CELL) + 2;
    const FC = new Float64Array(FW * FH);
    const FS = new Float64Array(FW * FH);
    for (let j = 0; j < FH; j++) {
      for (let i = 0; i < FW; i++) {
        const x = fx0 + i * FIELD_CELL;
        const y = fy0 + j * FIELD_CELL;
        // Background: a slow drift around the district's own grain.
        const a0 = base + drift.fbm(x / 2200, y / 2200, 2) * 0.9;
        let c = 0.35 * Math.cos(2 * a0);
        let s = 0.35 * Math.sin(2 * a0);
        // Around the core, lean towards the station.
        const r = Math.hypot(x - S[0], y - S[1]);
        if (r > 1) {
          const wr = 0.7 * Math.exp(-((r / 1500) ** 2)) * (1 - Math.exp(-((r / 350) ** 2)));
          const ar = Math.atan2(y - S[1], x - S[0]);
          c += wr * Math.cos(2 * ar);
          s += wr * Math.sin(2 * ar);
        }
        const bi = Math.floor(x / SB);
        const bj = Math.floor(y / SB);
        for (let dj = -2; dj <= 2; dj++) {
          for (let di = -2; di <= 2; di++) {
            const b = sbuckets.get(`${bi + di},${bj + dj}`);
            if (!b) continue;
            for (const q of b) {
              const d2 = (q.x - x) ** 2 + (q.y - y) ** 2;
              if (d2 > 5 * q.s2) continue;
              const w = q.w * Math.exp(-d2 / q.s2);
              c += w * Math.cos(2 * q.a);
              s += w * Math.sin(2 * q.a);
            }
          }
        }
        // Normalise, so nearby samples along one line do not swamp others.
        const m = Math.hypot(c, s) || 1;
        FC[j * FW + i] = c / m;
        FS[j * FW + i] = s / m;
      }
    }
    // The two directions of the field at a point (along, across).
    function field(x, y) {
      const fx = Math.max(0, Math.min(FW - 1.001, (x - fx0) / FIELD_CELL));
      const fy = Math.max(0, Math.min(FH - 1.001, (y - fy0) / FIELD_CELL));
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      const u = fx - i;
      const v = fy - j;
      const n = j * FW + i;
      const c = (FC[n] * (1 - u) + FC[n + 1] * u) * (1 - v) + (FC[n + FW] * (1 - u) + FC[n + FW + 1] * u) * v;
      const s = (FS[n] * (1 - u) + FS[n + 1] * u) * (1 - v) + (FS[n + FW] * (1 - u) + FS[n + FW + 1] * u) * v;
      const th = 0.5 * Math.atan2(s, c);
      return [[Math.cos(th), Math.sin(th)], [-Math.sin(th), Math.cos(th)]];
    }
    // The field direction closest to `dir`, signed to agree with it.
    function follow(x, y, dir) {
      const [a, b] = field(x, y);
      const v = Math.abs(dot(a, dir)) >= Math.abs(dot(b, dir)) ? a : b;
      return dot(v, dir) >= 0 ? v : [-v[0], -v[1]];
    }

    const isLand = (x, y) => {
      const n = grid.cellOf(x, y);
      return n >= 0 && grid.mask[n] === LAND;
    };

    // ---- Street segments, hashed for spacing and crossing tests ----
    const segs = []; // [ax, ay, bx, by, ux, uy, line, index along the line]
    const buckets = new Map();
    const bucketKeys = (ax, ay, bx, by, pad) => {
      const out = [];
      for (let j = Math.floor((Math.min(ay, by) - pad) / BUCKET); j <= Math.floor((Math.max(ay, by) + pad) / BUCKET); j++) {
        for (let i = Math.floor((Math.min(ax, bx) - pad) / BUCKET); i <= Math.floor((Math.max(ax, bx) + pad) / BUCKET); i++) out.push(i * KEY + j);
      }
      return out;
    };
    function addLine(pts, id, first = 0) {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        const l = Math.hypot(bx - ax, by - ay) || 1;
        const k = segs.length;
        segs.push([ax, ay, bx, by, (bx - ax) / l, (by - ay) / l, id, first + i]);
        for (const key of bucketKeys(ax, ay, bx, by, 0)) {
          let b = buckets.get(key);
          if (!b) buckets.set(key, (b = []));
          b.push(k);
        }
      }
    }
    // The district's greenway edge, kept apart: streets keep off it but never meet it.
    const edgeSegs = [];
    const edgeBuckets = new Map();
    {
      const r = d.ring.concat([d.ring[0]]);
      for (let i = 0; i < r.length - 1; i++) {
        const [ax, ay] = r[i];
        const [bx, by] = r[i + 1];
        const l = Math.hypot(bx - ax, by - ay) || 1;
        const k = edgeSegs.length;
        edgeSegs.push([ax, ay, bx, by, (bx - ax) / l, (by - ay) / l]);
        for (const key of bucketKeys(ax, ay, bx, by, 0)) {
          let b = edgeBuckets.get(key);
          if (!b) edgeBuckets.set(key, (b = []));
          b.push(k);
        }
      }
    }
    function edgeNear(x, y, r) {
      const out = [];
      for (const key of bucketKeys(x, y, x, y, r)) for (const k of edgeBuckets.get(key) || []) out.push(k);
      return out;
    }
    function segsNear(x, y, r) {
      // May list a segment more than once; callers only look for the nearest or any.
      const out = [];
      for (const key of bucketKeys(x, y, x, y, r)) for (const k of buckets.get(key) || []) out.push(k);
      return out;
    }
    // Is a street running the same way within r of p (other than line `own`)?
    function crowded(p, dir, r, own) {
      // Not along a greenway edge either.
      for (const k of edgeNear(p[0], p[1], EDGE_GAP)) {
        const g = edgeSegs[k];
        if (Math.abs(g[4] * dir[0] + g[5] * dir[1]) < PARALLEL) continue;
        if (segDist(p[0], p[1], g[0], g[1], g[2], g[3]) < EDGE_GAP) return true;
      }
      for (const k of segsNear(p[0], p[1], r)) {
        const g = segs[k];
        if (g[6] === own) continue;
        if (Math.abs(g[4] * dir[0] + g[5] * dir[1]) < PARALLEL) continue;
        if (segDist(p[0], p[1], g[0], g[1], g[2], g[3]) < r) return true;
      }
      return false;
    }
    function distToStreets(p, r) {
      let best = Infinity;
      for (const k of segsNear(p[0], p[1], r)) {
        const g = segs[k];
        best = Math.min(best, segDist(p[0], p[1], g[0], g[1], g[2], g[3]));
      }
      return best;
    }
    // First street hit by a ray from p along dir within reach.
    function rayHit(p, dir, reach, own) {
      const q = [p[0] + dir[0] * reach, p[1] + dir[1] * reach];
      let best = null;
      for (const key of bucketKeys(p[0], p[1], q[0], q[1], 0)) {
        for (const k of buckets.get(key) || []) {
          const g = segs[k];
          if (g[6] === own) continue;
          const hit = segCross(p[0], p[1], q[0], q[1], g[0], g[1], g[2], g[3]);
          if (hit && (!best || hit[0] < best.t)) best = { t: hit[0], g };
        }
      }
      // Only a street met at a fair angle makes a T; a glancing one is ignored.
      if (!best || Math.abs(best.g[4] * dir[0] + best.g[5] * dir[1]) > GLANCING) return null;
      return best.t * reach;
    }

    // ---- Tracing ----
    // One direction from p. Returns points; the first is p.
    function traceOne(p, dir, id, stub = 0, gap = STREET_GAP) {
      const pts = [p];
      let cur = p;
      let d0 = dir;
      let travelled = 0;
      let turned = 0;
      if (stub > 0) {
        const n = Math.ceil(stub / STEP);
        for (let i = 1; i <= n; i++) pts.push([p[0] + dir[0] * (stub * i) / n, p[1] + dir[1] * (stub * i) / n]);
        cur = pts[pts.length - 1];
        travelled = stub;
      }
      while (travelled < MAX_LENGTH) {
        const v1 = follow(cur[0], cur[1], d0);
        const mid = [cur[0] + v1[0] * STEP * 0.5, cur[1] + v1[1] * STEP * 0.5];
        const v2 = follow(mid[0], mid[1], v1);
        const next = [cur[0] + v2[0] * STEP, cur[1] + v2[1] * STEP];
        // Stop where the field turns sharply (near its knots) or the street has turned enough.
        const turn = Math.acos(Math.max(-1, Math.min(1, dot(v2, d0))));
        if (travelled > stub && turn > MAX_TURN) break;
        turned += turn;
        if (turned > Math.PI * 0.5) break;
        if (!isLand(next[0], next[1])) break;
        // Spacing is checked every other step; 40 m is fine-grained enough.
        if (travelled > 60 && (pts.length & 1) === 0 && crowded(next, v2, gap, id)) break;
        pts.push(next);
        cur = next;
        d0 = v2;
        travelled += STEP;
      }
      // Reach ahead for a street to meet, so the end makes a T rather than a stub.
      const last = pts[pts.length - 1];
      const prev = pts[Math.max(0, pts.length - 3)];
      const dirEnd = unit(sub(last, prev));
      const hit = rayHit(last, dirEnd, LOOKAHEAD, id);
      if (hit !== null) pts.push([last[0] + dirEnd[0] * (hit + OVERSHOOT), last[1] + dirEnd[1] * (hit + OVERSHOOT)]);
      return pts;
    }
    function traceBoth(p, dir, id, gap = STREET_GAP) {
      const a = traceOne(p, dir, id, 0, gap);
      const b = traceOne(p, [-dir[0], -dir[1]], id, 0, gap);
      return b.reverse().concat(a.slice(1));
    }

    // ---- Seeding ----
    const lines = []; // { id, points, protectStart, crossing }
    let nextId = 1;
    d.network.lines.forEach((l, k) => addLine(l.points, -1 - k));
    // Junctions so far, so new streets can keep their joins apart.
    const junctions = new Map();
    const addJunction = (p) => {
      const key = Math.floor(p[0] / BUCKET) * KEY + Math.floor(p[1] / BUCKET);
      let b = junctions.get(key);
      if (!b) junctions.set(key, (b = []));
      b.push(p);
    };
    const nearJunction = (p, r) => {
      for (const key of bucketKeys(p[0], p[1], p[0], p[1], r)) {
        for (const q of junctions.get(key) || []) if ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < r * r) return true;
      }
      return false;
    };
    for (const l of d.network.lines) {
      addJunction(l.points[0]);
      addJunction(l.points[l.points.length - 1]);
    }
    const place = (pts, extra = {}) => {
      if (pts.length < 3) return null;
      const id = nextId++;
      const l = { id, points: pts, ...extra };
      for (const h of hits(pts, id)) {
        const i = Math.min(pts.length - 2, Math.floor(h));
        const t = h - i;
        addJunction([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]);
      }
      lines.push(l);
      addLine(pts, id);
      return l;
    };

    // 1. Greenway crossings: straight across, then into the district. One
    // that meets no street yet is joined up once the rest are laid.
    const pending = [];
    for (const x of crossings) {
      const id = nextId;
      const pts = traceOne(x.p, x.n, id, STUB);
      const l = place(pts.length >= 3 ? pts : pts.concat([[pts[pts.length - 1][0] + x.n[0], pts[pts.length - 1][1] + x.n[1]]]), { crossing: x.key, protectStart: true });
      if (!meets(l.points, id)) pending.push(l);
    }
    function meets(pts, own) {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        for (const key of bucketKeys(ax, ay, bx, by, 0)) {
          for (const k of buckets.get(key) || []) {
            const g = segs[k];
            if (g[6] !== own && segCross(ax, ay, bx, by, g[0], g[1], g[2], g[3])) return true;
          }
        }
      }
      return false;
    }
    // Total heading change along a line, in radians.
    function turning(q) {
      let t = 0;
      for (let i = 2; i < q.length - 2; i += 2) {
        const a = unit(sub(q[i], q[i - 2]));
        const b = unit(sub(q[i + 2], q[i]));
        t += Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
      }
      return t;
    }
    // Outward direction at the start or end of a line.
    function endDir(pts, start) {
      const n = pts.length;
      return start ? unit(sub(pts[0], pts[Math.min(n - 1, 2)])) : unit(sub(pts[n - 1], pts[Math.max(0, n - 3)]));
    }
    // Where a line crosses streets already laid, as positions along it.
    function hits(pts, own) {
      const out = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        const seen = new Set();
        for (const key of bucketKeys(ax, ay, bx, by, 0)) {
          for (const k of buckets.get(key) || []) {
            if (seen.has(k)) continue;
            seen.add(k);
            const g = segs[k];
            if (g[6] === own) continue;
            const h = segCross(ax, ay, bx, by, g[0], g[1], g[2], g[3]);
            if (h) out.push(i + h[0]);
          }
        }
      }
      return out.sort((a, b) => a - b);
    }
    // A new street must cross the network at least twice, so that once its
    // loose ends are trimmed it still joins two streets.
    // A street crossing only one, or none, may run on from a loose end to
    // a street nearly straight ahead.
    function anchored(pts, own) {
      if (pts.length < 3) return null;
      // Two junctions, far enough apart that the street is not a loop back onto one street.
      const joins = (q) => {
        if (turning(q) > MAX_TOTAL_TURN) return false;
        const h = hits(q, own);
        if (h.length < 2) return false;
        const a = q[Math.floor(h[0])];
        const b = q[Math.min(q.length - 1, Math.ceil(h[h.length - 1]))];
        return len(sub(a, b)) >= 200;
      };
      if (joins(pts)) return pts;
      const tail = connector(pts[pts.length - 1], own, endDir(pts, false), 500);
      if (tail.length) pts = pts.concat(tail);
      if (!joins(pts)) {
        const head = connector(pts[0], own, endDir(pts, true), 500);
        if (head.length) pts = head.reverse().concat(pts);
      }
      return joins(pts) ? pts : null;
    }

    // `dir` is the way the street was heading; a join never turns back on it.
    function connector(from, own, dir, limit = 2000, cone = 0.8, allow = null) {
      let best = null;
      for (const r of [400, 900, 2000, 3000].filter((x) => x <= Math.max(400, limit))) {
        for (const k of segsNear(from[0], from[1], r)) {
          const g = segs[k];
          if (g[6] === own || (allow && !allow(g[6]))) continue;
          const dx = g[2] - g[0];
          const dy = g[3] - g[1];
          const l2 = dx * dx + dy * dy;
          const t0 = l2 > 0 ? Math.max(0, Math.min(1, ((from[0] - g[0]) * dx + (from[1] - g[1]) * dy) / l2)) : 0;
          // The foot of the perpendicular, or the nearest spot clear of other junctions.
          for (const t of [t0, 0, 0.5, 1]) {
            const q = [g[0] + dx * t, g[1] + dy * t];
            const v = sub(q, from);
            const lv = len(v);
            if (lv > 1e-6 && (v[0] * dir[0] + v[1] * dir[1]) / lv < cone) continue;
            // Arrive at a fair angle, not glancing along the street.
            if (lv > 1e-6 && Math.abs(v[0] * g[4] + v[1] * g[5]) / lv > GLANCING) continue;
            if (nearJunction(q, JUNCTION_GAP)) continue;
            const dd = len(sub(q, from)) + (t === t0 ? 0 : 1);
            if (!best || dd < best.r) best = { r: dd, q };
          }
        }
        if (best) break;
      }
      if (!best || best.r < 1e-6 || best.r > limit) return [];
      // A gentle curve carrying on from the street's heading into the target.
      const q = best.q;
      const r = len(sub(q, from));
      const c = [from[0] + dir[0] * r * 0.45, from[1] + dir[1] * r * 0.45];
      const n = Math.max(2, Math.ceil(r / STEP));
      const out = [];
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const a = (1 - t) * (1 - t);
        const b = 2 * (1 - t) * t;
        out.push([a * from[0] + b * c[0] + t * t * q[0], a * from[1] + b * c[1] + t * t * q[1]]);
      }
      const u = unit(sub(q, out.length > 1 ? out[out.length - 2] : from));
      out.push([q[0] + u[0] * OVERSHOOT, q[1] + u[1] * OVERSHOOT]);
      return out;
    }

    // 2. Neighbourhoods a street has not reached yet: one through the
    // neighbourhood, heading for the core.
    for (const h of hoods) {
      const p = h.seed;
      if (distToStreets(p, 260) < 260) continue;
      const toward = h.core ? [1, 0] : unit(sub(S, p));
      const v = follow(p[0], p[1], toward);
      if (crowded(p, v, STREET_GAP * 0.8, 0)) continue;
      const pts = anchored(traceBoth(p, v, nextId), nextId);
      if (pts) place(pts);
    }

    // 3. Neighbouring neighbourhoods with no street between them.
    const boundaries = chains.filter((c) => c.a >= 0 && c.b >= 0 && c.length >= NEIGHBOUR_EDGE).sort((a, b) => (a.key < b.key ? -1 : 1));
    for (const c of boundaries) {
      if (meets(c.points, 0)) continue;
      const m = c.points[Math.floor(c.points.length / 2)];
      const t = unit(sub(c.points[Math.min(c.points.length - 1, Math.floor(c.points.length / 2) + 2)], c.points[Math.max(0, Math.floor(c.points.length / 2) - 2)]));
      const v = follow(m[0], m[1], [-t[1], t[0]]);
      if (!isLand(m[0], m[1]) || crowded(m, v, STREET_GAP * 0.8, 0)) continue;
      const pts = anchored(traceBoth(m, v, nextId), nextId);
      if (pts) place(pts);
    }

    // 4. Land still too far from any street. A spot that cannot take a
    // street is set aside and the next one tried.
    const tried = [];
    for (let it = 0; it < 40; it++) {
      const gap = farthest(tried);
      if (!gap || gap.d <= MAIN_STREET_REACH) break;
      tried.push(gap.p);
      // Close to a greenway, start far enough in for a street to run alongside
      // it; if the spot itself cannot take a street, try a little to each side.
      const p0 = awayFromEdge(gap.p);
      const [fa, fb] = field(p0[0], p0[1]);
      const spots = [p0];
      for (const v of [fa, fb]) for (const k of [160, -160]) spots.push([p0[0] + v[0] * k, p0[1] + v[1] * k]);
      let done = false;
      for (const p of spots) {
        if (done || !isLand(p[0], p[1])) continue;
        const [a, b] = field(p[0], p[1]);
        for (const v of [a, b].filter((u) => !crowded(p, u, STREET_GAP * 0.8, 0))) {
          const pts = anchored(traceBoth(p, v, nextId), nextId);
          if (pts) {
            place(pts);
            done = true;
            break;
          }
        }
      }
    }
    // Step a point away from the district's greenways until it is EDGE_GAP + 40 m clear.
    function awayFromEdge(p) {
      let q = p;
      for (let k = 0; k < 12; k++) {
        const n = grid.cellOf(q[0], q[1]);
        if (n < 0 || grid.fromEdge[n] >= EDGE_GAP + 40) break;
        const g = [grid.fromEdge[n + 1] - grid.fromEdge[n - 1], grid.fromEdge[n + grid.W] - grid.fromEdge[n - grid.W]];
        if (!g[0] && !g[1]) break;
        const u = unit(g);
        const next = [q[0] + u[0] * 25, q[1] + u[1] * 25];
        if (!isLand(next[0], next[1])) break;
        q = next;
      }
      return q;
    }

    // The land point farthest from every street, from a raster distance field.
    function farthest(tried) {
      const src = new Uint8Array(grid.N);
      for (const l of lines) stamp(50, src, grid.W, grid.H, grid.x0, grid.y0, l.points);
      for (const l of d.network.lines) stamp(50, src, grid.W, grid.H, grid.x0, grid.y0, l.points);
      const far = distanceField(50, src, grid.W, grid.H);
      let best = null;
      for (let n = 0; n < grid.N; n++) {
        if (grid.mask[n] !== LAND || grid.fromEdge[n] < 80) continue;
        if (best && far[n] <= best.d) continue;
        const x = grid.x0 + ((n % grid.W) + 0.5) * 50;
        const y = grid.y0 + (Math.floor(n / grid.W) + 0.5) * 50;
        if (tried.some((t) => (t[0] - x) ** 2 + (t[1] - y) ** 2 < 250 * 250)) continue;
        best = { n, d: far[n] };
      }
      if (!best) return null;
      const i = best.n % grid.W;
      const j = (best.n - i) / grid.W;
      return { p: [grid.x0 + (i + 0.5) * 50, grid.y0 + (j + 0.5) * 50], d: best.d };
    }

    // 5. Crossing streets still meeting nothing join the nearest street.
    for (const l of pending) {
      if (meets(l.points, l.id)) continue;
      // Widen the search only as far as needed to find a street ahead.
      let extra = [];
      for (const cone of [0.6, 0.3, -0.1]) {
        extra = connector(l.points[l.points.length - 1], l.id, endDir(l.points, false), 2000, cone);
        if (extra.length) break;
      }
      if (!extra.length) continue;
      const from = l.points.length - 1;
      l.points = l.points.concat(extra);
      addLine(l.points.slice(from), l.id, from);
    }

    // ---- Junctions and trimming ----
    // All crossings between lines (main streets and boulevards).
    function resolve() {
    const all = lines.map((l) => ({ ...l, cuts: [] }));
    const byId = new Map(all.map((l) => [l.id, l]));
    for (let ka = 0; ka < segs.length; ka++) {
      const g = segs[ka];
      if (g[6] < 0) continue; // walk from main street segments
      const line = byId.get(g[6]);
      const segIndex = g[7];
      for (const key of bucketKeys(g[0], g[1], g[2], g[3], 0)) {
        for (const kb of buckets.get(key) || []) {
          if (kb === ka) continue;
          const h = segs[kb];
          if (h[6] === g[6]) continue;
          const hit = segCross(g[0], g[1], g[2], g[3], h[0], h[1], h[2], h[3]);
          if (!hit) continue;
          const pos = segIndex + hit[0];
          if (line.cuts.some((c) => c.with === h[6] && Math.abs(c.pos - pos) < 1e-9)) continue;
          line.cuts.push({ pos, with: h[6], at: [g[0] + (g[2] - g[0]) * hit[0], g[1] + (g[3] - g[1]) * hit[0]], otherPos: h[7] + hit[1] });
        }
      }
    }
    for (const l of all) l.cuts.sort((a, b) => a.pos - b.pos);
    for (const l of all) {
      l.lo = l.protectStart ? 0 : -Infinity;
      l.hi = Infinity;
      l.alive = true;
    }
    // Trim loose ends back to the last junction that still stands, until nothing changes.
    for (let round = 0; round < 12; round++) {
      let changed = false;
      for (const l of all) {
        if (!l.alive) continue;
        const live = l.cuts.filter((c) => {
          // A crossing street's junction must lie beyond its stub across the greenway.
          if (l.protectStart && c.pos * STEP < STUB + STEP) return false;
          if (c.with < 0) return true; // boulevards always stand
          const o = byId.get(c.with);
          if (!o || !o.alive) return false;
          const p = c.otherPos;
          return p >= o.lo - 1e-9 && p <= o.hi + 1e-9;
        });
        let lo;
        let hi;
        if (!live.length) {
          if (l.protectStart) {
            lo = 0;
            hi = l.points.length - 1;
            l.lonely = true;
          } else {
            l.alive = false;
            changed = true;
            continue;
          }
        } else {
          lo = l.protectStart ? 0 : live[0].pos;
          hi = live[live.length - 1].pos;
          if (hi - lo < 1e-6 && !l.protectStart) {
            l.alive = false;
            changed = true;
            continue;
          }
        }
        if (lo !== l.lo || hi !== l.hi) {
          l.lo = lo;
          l.hi = hi;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return all;
    }
    let all = resolve();
    // A crossing street whose only junction was trimmed away runs on to the
    // nearest boulevard (which always stands), and everything is settled again.
    const lonely = all.filter((l) => l.alive && l.lonely);
    if (lonely.length) {
      for (const a of lonely) {
        const l = lines.find((x) => x.id === a.id);
        let extra = [];
        for (const cone of [0.3, -0.1, -0.6]) {
          extra = connector(l.points[l.points.length - 1], l.id, endDir(l.points, false), 3000, cone, (id) => id < 0);
          if (extra.length) break;
        }
        if (!extra.length) continue;
        const from = l.points.length - 1;
        l.points = l.points.concat(extra);
        addLine(l.points.slice(from), l.id, from);
      }
      all = resolve();
    }
    const pointAt = (pts, pos) => {
      const i = Math.min(pts.length - 2, Math.floor(pos));
      const t = pos - i;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    };
    function extract(all) {
    const out = [];
    for (const l of all) {
      if (!l.alive) continue;
      const pts = [pointAt(l.points, l.lo)];
      for (let i = Math.floor(l.lo) + 1; i <= Math.ceil(l.hi) - 1 && i < l.points.length; i++) pts.push(l.points[i]);
      pts.push(pointAt(l.points, l.hi));
      if (pts.length >= 2 && len(sub(pts[0], pts[pts.length - 1])) > 1) {
        out.push({
          key: `${d.key}:m${l.id}`,
          kind: l.crossing ? 'crossing' : 'street',
          crossing: l.crossing || null,
          points: pts,
          bbox: lineBox(pts),
          pieces: piecesOf(pts),
        });
      }
    }
    return out;
    }
    let out = extract(all);

    // Neighbourhoods with no fairly direct route to the core get a street
    // from their centre heading for it, a little closer than usual to others.
    const slow = slowRoutes(out);
    if (slow.length) {
      for (const h of slow) {
        const p = h.seed;
        const v = follow(p[0], p[1], unit(sub(S, p)));
        const pts = anchored(traceBoth(p, v, nextId, STREET_GAP * 0.6), nextId);
        if (pts) place(pts);
      }
      all = resolve();
      out = extract(all);
    }

    // Street distance from the station on a raster of the streets.
    function slowRoutes(out) {
      const W = grid.W;
      const on = new Uint8Array(grid.N);
      for (const l of out) stamp(50, on, W, grid.H, grid.x0, grid.y0, l.points);
      for (const l of d.network.lines) stamp(50, on, W, grid.H, grid.x0, grid.y0, l.points);
      const dist = new Float64Array(grid.N).fill(Infinity);
      const start = grid.cellOf(S[0], S[1]);
      if (start < 0) return [];
      dist[start] = 0;
      const queue = [start];
      // Few weights (50 m or 71 m), so a simple label-correcting queue does.
      for (let qi = 0; qi < queue.length; qi++) {
        const n = queue[qi];
        const i = n % W;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            if (i + di < 0 || i + di >= W) continue;
            const m = n + dj * W + di;
            if (m < 0 || m >= grid.N || !on[m]) continue;
            const nd = dist[n] + (di && dj ? 70.7 : 50);
            if (nd < dist[m]) {
              dist[m] = nd;
              queue.push(m);
            }
          }
        }
      }
      const res = [];
      for (const h of hoods) {
        if (h.core) continue;
        // The street cell nearest the centre.
        let best = null;
        const c0 = grid.cellOf(h.seed[0], h.seed[1]);
        if (c0 < 0) continue;
        const ci = c0 % W;
        const cj = (c0 - ci) / W;
        for (let dj = -6; dj <= 6; dj++) {
          for (let di = -6; di <= 6; di++) {
            const m = (cj + dj) * W + ci + di;
            if (m < 0 || m >= grid.N || !on[m]) continue;
            const r = di * di + dj * dj;
            if (!best || r < best.r) best = { r, m };
          }
        }
        const crow = len(sub(h.seed, S));
        const route = best ? dist[best.m] : Infinity;
        if (route > crow * 1.5 + 500) res.push(h);
      }
      return res;
    }

    // ---- Neighbourhood centres on their streets ----
    const streetsAll = out.map((l) => l.points).concat(d.network.lines.filter((l) => l.kind !== 'roundabout').map((l) => l.points));
    for (const h of hoods) {
      if (h.core) continue;
      let best = null;
      for (const pts of streetsAll) {
        for (const q of pts) {
          const r = len(sub(q, h.seed));
          if (!best || r < best.r) best = { r, q };
        }
      }
      if (best) h.centre = best.q;
    }

    return { lines: out };
  };
}
