// Main streets of a district: old roads between places, laid out as an
// organic grid.
//
// A smooth direction field covers the district: near a boulevard it follows
// the boulevard, near a greenway it follows the greenway, around the core
// it leans towards the station, and elsewhere it drifts slowly. Streets are
// traced along the field in one of its two families (along it or across it),
// so they bend gently and meet each other mostly at right angles, in
// crossings or T junctions. No stretch of street curls round, and none runs
// alongside another.
//
// Every neighbourhood gets one route through its centre, laid from the core
// outwards. Its inner half heads for the core and stops in a T on the first
// street that carries on past it; its outer half heads for the next
// neighbourhood further out (whose route then carries on from there), or a
// gateway on the district's greenways (where the street carries on into the
// next district), or failing those the nearest street ahead. Gateways no
// route reached get a street of their own into the district. A street may
// also end at the gate of a district park, which in a wedge of land between
// two greenways is often the only place it can go.
//
// Last, any neighbourhood still without a route of its own gets a cross
// street through its centre (or close to it), from a T to a T or a park gate.
//
// Then every loose end is joined up or trimmed back to its last junction, so
// no main street dead-ends, and each neighbourhood's centre is put on the
// street that serves it.

import { createNoise } from '../core/noise.js';
import { hash, toUnit } from '../core/hash.js';
import { keyInts } from './cores.js';
import { distToLine, lineBox, piecesOf } from './boulevards.js';
import { stamp, distanceField } from '../util/raster.js';
import { pointInPolygon } from '../util/geom.js';

export const MAIN_STREET_REACH = 600; // nearly all land is this close to a main street
const CENTRE_SNAP = 450; // a centre off its route moves to a street this close, if one is
const STEP = 20; // metres per tracing step
const MAX_TURN = STEP / 140; // radians per step: no bend tighter than about 140 m radius
const MAX_ROUTE_TURN = (200 * Math.PI) / 180; // a route through several centres may wind a little more
const STATION_CLEAR = 250; // routes join the core's streets this far from the station, not at it
const ROUTE_GAP = 420; // a loose end stops this close beside a street running the same way
const JOIN_REACH = 900; // metres a crossing street meeting nothing at all may run straight on to the nearest street
const PAIR_REACH = 1000; // two loose ends this close may join up as one street
const FILL_SHIFT = 180; // a cross street for a neighbourhood left without a route may pass this far from its centre
const FILL_GAP = 420; // and may come this close beside a street running the same way
const FILL_EDGE_GAP = 0; // and may front onto a greenway (held SLIDE_HOLD off it)
const SLIDE_HOLD = 110; // metres from a greenway's line a street fronting onto it keeps
const FILL_LONGEST = 2400; // metres, end to end
const COVER = 600; // metres: no land farther than this from a main street (about a 10-minute walk by street)
const PRUNE_GAP = 420; // metres: a street with most of its length this close beside another (and no neighbourhood its own) goes
const PRUNE_MOVE = 400; // (a neighbourhood's own street, if another passes this close to its centre)
const COVER_EDGE = 220; // metres in from the greenway's line land is counted from
const COVER_STEP = 60; // metres between the spots tested
const COVER_ROUNDS = 30; // cross streets laid at most, per district, to bring every spot in reach
const COVER_GAP = 420; // how close such a street may run beside another running the same way
const COVER_GAP_LAST = 360; // (or failing that, this close)
const COVER_LONGEST = 3200; // metres, end to end
const EDGE_REACH = 100; // metres from the greenway's line such a street may end, joined straight on to it
const STRAIGHT_RUN = 200; // metres a cross street holds its heading before easing into the field
const PARK_CELL = 3; // raster value of district park land (see neighbourhoods.js)
const PARK_GATES = 2; // main streets that may end at one district park's gate, per district
const PARK_GATE_GAP = 300; // metres between two such gates
const CAND_GAP = 80; // metres between the points a join tries for
const HIT_GAP = 50; // a street running into another keeps this clear of its other junctions
const TARGET_GAP = 360; // how close a street drawn towards a target may run alongside another
const SLIDE_GAP = 160; // a street heading for a gateway turns along the greenway this close to it
const CURL_SPAN = 300; // metres over which...
const CURL_TURN = (100 * Math.PI) / 180; // ...a street turns at most this much
const TURN_BACK = (120 * Math.PI) / 180; // nor does one stretch of street ever turn back on itself
const FIELD_CELL = 150; // metres between samples of the direction field
const BUCKET = 200; // metres to a side of the street segment hash
const KEY = 4194304; // bucket keys are i * KEY + j
const MAX_LENGTH = 5000; // longest a single run of tracing goes
const OVERSHOOT = 4; // metres a street ending in a T runs past the street it meets
const STUB = 70; // straight metres from a greenway crossing before following the field
const STUB_POS = 5; // positions along a crossing street taken up by its stub
const NEIGHBOUR_EDGE = 150; // shared boundary for two neighbourhoods to count as neighbours
const RAIL_GAP = 90; // closest a street may run alongside the rail above ground
const EDGE_GAP = 170; // closest a street may run alongside a greenway (centreline)
const PARALLEL = 0.8; // |cos| above which two streets count as running the same way
const THROUGH = 2; // positions (about 40 m) a street must carry on past a junction to end another there
const THROUGH_B = 3; // the same along a boulevard (12 m points)
const GLANCING = 0.82; // |cos| above which a street meeting another is too shallow (about 35°)
const JUNCTION_GAP = 110; // a new join keeps this far from other junctions

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
    // Regional rail above ground: streets cross under it but never run
    // alongside it.
    const railSegs = [];
    const railBuckets = new Map();
    for (const L of grid.rail || []) {
      for (let i = 0; i < L.length - 1; i++) {
        const [ax, ay] = L[i];
        const [bx, by] = L[i + 1];
        const l = Math.hypot(bx - ax, by - ay) || 1;
        const k = railSegs.length;
        railSegs.push([ax, ay, bx, by, (bx - ax) / l, (by - ay) / l]);
        for (const key of bucketKeys(ax, ay, bx, by, 0)) {
          let b = railBuckets.get(key);
          if (!b) railBuckets.set(key, (b = []));
          b.push(k);
        }
      }
    }
    // The nearest stretch of greenway edge within r of p: its tangent, the
    // way away from it, and how far it is.
    function edgeAlong(p, r) {
      let best = null;
      for (const k of edgeNear(p[0], p[1], r)) {
        const g = edgeSegs[k];
        const dx = g[2] - g[0];
        const dy = g[3] - g[1];
        const l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - g[0]) * dx + (p[1] - g[1]) * dy) / l2));
        const fx = g[0] + dx * t;
        const fy = g[1] + dy * t;
        const dd = Math.hypot(p[0] - fx, p[1] - fy);
        if (dd < r && (!best || dd < best.r)) best = { r: dd, t: [g[4], g[5]], away: dd > 1e-6 ? [(p[0] - fx) / dd, (p[1] - fy) / dd] : [-g[5], g[4]] };
      }
      return best;
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
    function crowded(p, dir, r, own, edgeGap = EDGE_GAP) {
      // Not alongside the rail.
      for (const key of bucketKeys(p[0], p[1], p[0], p[1], RAIL_GAP)) {
        for (const k of railBuckets.get(key) || []) {
          const g = railSegs[k];
          if (Math.abs(g[4] * dir[0] + g[5] * dir[1]) >= PARALLEL && segDist(p[0], p[1], g[0], g[1], g[2], g[3]) < RAIL_GAP) return true;
        }
      }
      // Not along a greenway edge either.
      for (const k of edgeNear(p[0], p[1], edgeGap)) {
        const g = edgeSegs[k];
        if (Math.abs(g[4] * dir[0] + g[5] * dir[1]) < PARALLEL) continue;
        if (segDist(p[0], p[1], g[0], g[1], g[2], g[3]) < edgeGap) return true;
      }
      for (const k of segsNear(p[0], p[1], r)) {
        const g = segs[k];
        if (g[6] === own || trimmed(g)) continue;
        if (Math.abs(g[4] * dir[0] + g[5] * dir[1]) < PARALLEL) continue;
        if (segDist(p[0], p[1], g[0], g[1], g[2], g[3]) < r) return true;
      }
      return false;
    }


    // ---- Seeding ----
    const lines = []; // { id, points, protectStart, crossing }
    const lineById = new Map();
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
    // Take a line out again (its segments no longer count for anything).
    function removeLine(id) {
      for (const [key, b] of buckets) {
        const rest = b.filter((k) => segs[k][6] !== id);
        if (rest.length !== b.length) buckets.set(key, rest);
      }
      for (const g of segs) if (g[6] === id) g[6] = 0;
      const i = lines.findIndex((l) => l.id === id);
      if (i >= 0) lines.splice(i, 1);
      lineById.delete(id);
      stubIds.delete(id);
    }
    const place = (pts, extra = {}) => {
      if (pts.length < 3) return null;
      const id = nextId++;
      const l = { id, points: pts, ...extra };
      for (const { pos: h } of hits(pts, id)) {
        const i = Math.min(pts.length - 2, Math.floor(h));
        const t = h - i;
        addJunction([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]);
      }
      lines.push(l);
      lineById.set(id, l);
      addLine(pts, id);
      return l;
    };

    const pending = [];
    const stubIds = new Set();
    const looseEnds = [];

    // ---- Routes ----
    // Main streets are old roads between places: one through the centre of
    // every neighbourhood, laid from the core outwards. Its inward half heads
    // for the core and stops in a T on the first street that carries on past
    // it; its outward half heads for the next neighbourhood further out (whose
    // own street then carries on from there, so routes run on through several
    // centres) or for a gateway on the district's greenways. Neighbourhoods
    // a boulevard runs through have it as their main street.
    // What the last resolve pass kept of each line: [lo, hi], an untrimmed
    // end left open so a line extended later keeps its new part.
    const kept = new Map();
    // Streets ending at a district park's gate, by park.
    const gates = new Map();
    function parkGate(q) {
      const n = grid.cellOf(q[0], q[1]);
      if (n < 0 || grid.mask[n] !== PARK_CELL) return null;
      const pk = d.parks.find((x) => pointInPolygon(q[0], q[1], x.shape));
      if (!pk) return null;
      const at = gates.get(pk.key) || [];
      if (at.length >= PARK_GATES || at.some((g) => len(sub(g, q)) < PARK_GATE_GAP)) return null;
      return pk.key;
    }
    const isGate = (k) => k.startsWith('park:');
    const gateOf = (k) => k.slice(5, k.lastIndexOf('#'));
    function addGate(key, q) {
      if (!gates.has(key)) gates.set(key, []);
      const at = gates.get(key);
      at.push(q);
      return `park:${key}#${at.length}`;
    }
    const routeOf = new Map(); // hood id -> line through its centre
    const arrived = new Map(); // hood id -> line whose outward half ended at its centre
    const gatewayUsed = new Set();
    const shared = new Map();
    for (const c of chains) {
      if (c.a < 0 || c.b < 0) continue;
      const k = `${c.a}-${c.b}`;
      shared.set(k, (shared.get(k) || 0) + c.length);
    }
    const neighbours = (k) => hoods.filter((o) => o.id !== k && (shared.get(k < o.id ? `${k}-${o.id}` : `${o.id}-${k}`) || 0) >= NEIGHBOUR_EDGE);
    const fromCore = (q) => len(sub(q, S));

    // Rotate a unit vector towards another by at most `max` radians.
    function towards(v, want, max) {
      const ang = Math.acos(Math.max(-1, Math.min(1, dot(v, want))));
      if (ang <= max) return want;
      const side = v[0] * want[1] - v[1] * want[0] >= 0 ? 1 : -1;
      const c = Math.cos(max * side);
      const sn = Math.sin(max * side);
      return [v[0] * c - v[1] * sn, v[0] * sn + v[1] * c];
    }

    // Trace from p, following the field but drawn towards `target` if given.
    // Ends on reaching the target, in a T on the first street that carries on
    // past it (when `stopAtHit`), at the greenway, or beside a parallel street.
    // With `aim` the target only draws the street on; it is not an end.
    function steer(p, dir, id, { target = null, approach = null, stopAtHit = false, gap = ROUTE_GAP, pull = 0.5, aim = false, straight = false, slide = false, edgeGap = EDGE_GAP, parkEnds = false } = {}) {
      const pts = [p];
      let cur = p;
      let d0 = dir;
      let travelled = 0;
      const start = target ? len(sub(target, p)) : 0;
      // Heading so far, unwrapped, at each point: no stretch of CURL_SPAN may
      // turn more than CURL_TURN, nor the whole run more than TURN_BACK, so a
      // street bends but never curls round.
      const heading = [0];
      const back = Math.round(CURL_SPAN / STEP);
      while (travelled < MAX_LENGTH) {
        // (A straight street eases only gradually into the field.)
        let want = follow(cur[0], cur[1], d0);
        if (straight && travelled < STRAIGHT_RUN) want = unit([want[0] + d0[0] * 2, want[1] + d0[1] * 2]);
        let r = Infinity;
        if (target) {
          r = len(sub(target, cur));
          // A target that has fallen behind, or that the street keeps
          // missing, is let go rather than circled round.
          const behind = dot(unit(sub(target, cur)), d0) < -0.2;
          if (behind || travelled > start * 2 + 200) {
            if (!aim) return { pts, end: 'missed' };
            target = null;
            continue;
          }
          if (!aim && r <= STEP * 1.2) {
            pts.push(target);
            return { pts, end: 'target' };
          }
          const t = unit(sub(target, cur));
          const w = r < 300 && !aim ? 1 : pull;
          want = unit([want[0] * (1 - w) + t[0] * w, want[1] * (1 - w) + t[1] * w]);
          if (approach && r < STUB + 60) want = unit(sub(target, cur));
          else if (approach && r > SLIDE_GAP * 2) {
            // Heading for a gateway but up against the greenway: run along
            // its edge towards the gateway instead of into it.
            const e = edgeAlong(cur, SLIDE_GAP);
            if (e) {
              const tt = dot(e.t, t) >= 0 ? e.t : [-e.t[0], -e.t[1]];
              const k = 1 - e.r / SLIDE_GAP;
              want = unit([want[0] * (1 - k) + (tt[0] * 0.85 + e.away[0] * 0.15) * k, want[1] * (1 - k) + (tt[1] * 0.85 + e.away[1] * 0.15) * k]);
            }
          }
        }
        if (slide) {
          // Up against the greenway: turn to front onto it rather than run into it.
          // It eases in to run SLIDE_HOLD from the greenway's line.
          const e = edgeAlong(cur, SLIDE_GAP);
          if (e) {
            const tt = dot(e.t, d0) >= 0 ? e.t : [-e.t[0], -e.t[1]];
            const k = Math.min(1, (1 - e.r / SLIDE_GAP) * 2);
            const a = Math.max(-0.3, Math.min(0.7, (SLIDE_HOLD - e.r) / SLIDE_HOLD));
            const along = unit([tt[0] + e.away[0] * a, tt[1] + e.away[1] * a]);
            want = unit([want[0] * (1 - k) + along[0] * k, want[1] * (1 - k) + along[1] * k]);
          }
        }
        const v = towards(d0, want, MAX_TURN);
        const turn = heading[heading.length - 1] + Math.atan2(d0[0] * v[1] - d0[1] * v[0], dot(d0, v));
        const was = heading[Math.max(0, heading.length - back)];
        if (Math.abs(turn - was) > CURL_TURN || Math.abs(turn) > TURN_BACK) return { pts, end: 'curl' };
        const next = [cur[0] + v[0] * STEP, cur[1] + v[1] * STEP];
        if (stopAtHit && travelled > 40) {
          const h = hits([cur, next], id).find((x) => passesThrough(x.with, x.at));
          if (h) {
            const at = [cur[0] + (next[0] - cur[0]) * h.pos, cur[1] + (next[1] - cur[1]) * h.pos];
            // Not in a T right by another junction (that makes a star).
            if (nearJunction(at, HIT_GAP)) return { pts, end: 'junction' };
            pts.push([at[0] + v[0] * OVERSHOOT, at[1] + v[1] * OVERSHOOT]);
            return { pts, end: 'hit' };
          }
        }
        // A street may end at the gate of a district park.
        if (parkEnds && !isLand(next[0], next[1])) {
          const park = parkGate(next);
          if (park) {
            pts.push(next);
            return { pts, end: 'park', park };
          }
        }
        // A gateway lies on the greenway's line, so the last stretch to it leaves the land.
        if (!isLand(next[0], next[1]) && !(target && approach && r < STUB + 80)) return { pts, end: 'edge' };
        // Never alongside another street (one with a target is let close in
        // only near the end, where it turns in to meet it).
        if (travelled > 100 && (pts.length & 1) === 0 && (!target || r > 200) && crowded(next, v, target ? TARGET_GAP : gap, id, edgeGap)) return { pts, end: 'crowded' };
        pts.push(next);
        heading.push(turn);
        cur = next;
        d0 = v;
        travelled += STEP;
      }
      return { pts, end: 'long' };
    }

    // Where the outward half of a route through h should head.
    function outwardTarget(h, out) {
      const p = h.seed;
      let best = null;
      for (const o of neighbours(h.id)) {
        if (o.onBoulevard || routeOf.has(o.id) || arrived.has(o.id)) continue;
        if (fromCore(o.seed) < fromCore(p) - 100) continue;
        const v = sub(o.seed, p);
        const r = len(v);
        const c = dot(v, out) / r;
        if (c < 0.55 || r > 1800) continue;
        const score = r * (2 - c);
        if (!best || score < best.score) best = { score, kind: 'hood', hood: o, p: o.seed };
      }
      if (best) return best;
      for (const x of crossings) {
        if (gatewayUsed.has(x.key)) continue;
        const v = sub(x.p, p);
        const r = len(v);
        const c = dot(v, out) / r;
        if (c < 0.35 || r > 2000 || dot(x.n, out) > -0.2) continue;
        const score = r * (2 - c);
        if (!best || score < best.score) best = { score, kind: 'gateway', x, p: x.p };
      }
      return best;
    }

    // Lay the outward half of a route from p (heading `out`), appending to
    // `pts`. Returns the extended points and extra properties for the line.
    // `fits` vets the whole route each option would make; `loose` allows,
    // as a last resort, an end that meets nothing (trimmed back later).
    function layOutward(h, p, out, id, fits = () => true, loose = true) {
      const tgt = outwardTarget(h, out);
      if (tgt && tgt.kind === 'hood') {
        const r = steer(p, out, id, { target: tgt.p, pull: 0.45 });
        if (r.end === 'target' && fits(r.pts)) return { pts: r.pts, next: tgt.hood };
      }
      if (tgt && tgt.kind === 'gateway') {
        const r = steer(p, out, id, { target: tgt.p, approach: true, pull: 0.5 });
        if (r.end === 'target' && fits(r.pts)) return { pts: r.pts, gateway: tgt.x };
      }
      // Otherwise on along the field to the first street that carries on past it,
      // or failing that, drawn towards the nearest such street ahead.
      const r = steer(p, out, id, { stopAtHit: true, parkEnds: true });
      if (r.end === 'hit' && fits(r.pts)) return { pts: r.pts };
      if (r.end === 'park' && fits(r.pts)) return { pts: r.pts, park: r.park };
      const q = streetAhead(p, out, id);
      if (q) {
        const r2 = steer(p, out, id, { target: q, stopAtHit: true, pull: 0.6, aim: true });
        if (r2.end === 'hit' && fits(r2.pts)) return { pts: r2.pts };
      }
      const tail = r.end === 'hit' ? null : joinAhead(r.pts, id);
      if (tail && fits(tail)) return { pts: tail };
      // Or bending round towards a street off to one side.
      const side = streetAhead(p, out, id, 0, -0.1);
      if (side) {
        const r3 = steer(p, out, id, { target: side, stopAtHit: true, pull: 0.7, aim: true });
        if (r3.end === 'hit' && fits(r3.pts)) return { pts: r3.pts };
      }
      return loose && fits(r.pts) ? { pts: r.pts, loose: true } : null;
    }

    // The nearest point ahead on a street that carries on past it, met at a fair angle.
    function streetAhead(p, out, id, clearOfStation = 0, minCos = 0.45) {
      let best = null;
      const seen = new Set();
      for (const k of segsNear(p[0], p[1], 1500)) {
        if (seen.has(k)) continue;
        seen.add(k);
        const g = segs[k];
        if (g[6] === id || g[6] === 0) continue;
        const q = [(g[0] + g[2]) / 2, (g[1] + g[3]) / 2];
        if (clearOfStation && len(sub(q, S)) < clearOfStation) continue;
        const v = sub(q, p);
        const r = len(v);
        if (r < 150 || r > 1500) continue;
        const c = dot(v, out) / r;
        if (c < minCos) continue;
        if (Math.abs((v[0] * g[4] + v[1] * g[5]) / r) > GLANCING) continue;
        if (!passesThrough(g[6], g[7] + 0.5)) continue;
        const score = r * (2 - c);
        if (!best || score < best.score) best = { score, q };
      }
      return best ? best.q : null;
    }

    // A loose end bends round into a street ahead, if there is one near.
    function joinAhead(pts, id) {
      for (const cone of [0.8, 0.5, 0.2]) {
        const extra = connector(pts[pts.length - 1], id, endDir(pts, false), 700, cone);
        if (extra.length) return pts.concat(extra);
      }
      return null;
    }

    function layRoute(h) {
      const p = h.seed;
      const came = arrived.get(h.id);
      if (came) {
        // Carry the arriving route straight on through this centre (or if it
        // cannot go on without curling round, lay a route of its own).
        const out = endDir(came.points, false);
        const res = layOutward(h, p, out, came.id, (o) => !curls(came.points.concat(o.slice(1))), false);
        if (!res) {
          // It stops here instead, just past the centre, in a T on the route
          // this neighbourhood is about to get.
          const from = came.points.length - 1;
          came.points = came.points.concat([[p[0] + out[0] * OVERSHOOT, p[1] + out[1] * OVERSHOOT]]);
          addLine(came.points.slice(from), came.id, from);
        } else {
        const from = came.points.length - 1;
        came.points = came.points.concat(res.pts.slice(1));
        came.hoodPos.set(h.id, from);
        addLine(came.points.slice(from), came.id, from);
        finish(came, res);
        routeOf.set(h.id, came);
        return;
        }
      }
      const id = nextId;
      const [fa, fb] = field(p[0], p[1]);
      const toward = unit(sub(S, p));
      let order = Math.abs(dot(fa, toward)) >= Math.abs(dot(fb, toward)) ? [fa, fb] : [fb, fa];
      // A route that stopped here is crossed, not doubled back along.
      if (came) {
        const o = endDir(came.points, false);
        order = [fa, fb].filter((f) => Math.abs(dot(f, o)) < 0.8).sort((a, b) => Math.abs(dot(a, o)) - Math.abs(dot(b, o)));
      }
      for (const [v0, loose] of order.flatMap((v) => [[v, false]]).concat(order.map((v) => [v, true]))) {
        const inDir = dot(v0, toward) >= 0 ? v0 : [-v0[0], -v0[1]];
        // Inwards: towards the nearest street on the core side (not the
        // station itself), meeting it in a T.
        const q = streetAhead(p, inDir, id, STATION_CLEAR);
        const inward = steer(p, inDir, id, { target: q || S, stopAtHit: true, pull: q ? 0.5 : 0.25, aim: true });
        const inPts = inward.end === 'hit' ? inward.pts : joinAhead(inward.pts, id);
        if (!inPts) continue;
        const back = inPts.slice().reverse();
        const whole = (o) => back.concat(o.slice(1));
        const res = layOutward(h, p, [-inDir[0], -inDir[1]], id, (o) => turning(whole(o)) <= MAX_ROUTE_TURN && !curls(whole(o)), loose);
        if (!res) continue;
        const pts = whole(res.pts);
        // Where a route stopped at this centre, the junction it makes stays
        // clear of any other.
        if (came && (pathLength(inPts) < JUNCTION_GAP || pathLength(res.pts) < JUNCTION_GAP)) continue;
        if (turning(pts) > MAX_ROUTE_TURN || curls(pts)) continue;
        const l = place(pts, { hood: h.id, hoodPos: new Map([[h.id, inPts.length - 1]]) });
        finish(l, res);
        routeOf.set(h.id, l);
        return;
      }
    }

    // Record where a route's outward half ended.
    function finish(l, res) {
      if (res.loose) looseEnds.push(l);
      if (res.next) arrived.set(res.next.id, l);
      if (res.gateway) {
        gatewayUsed.add(res.gateway.key);
        l.crossingEnd = res.gateway.key;
      }
      if (res.park) l.crossingEnd = addGate(res.park, l.points[l.points.length - 1]);
    }

    const routeOrder = hoods.filter((h) => !h.core && !h.onBoulevard).sort((a, b) => fromCore(a.seed) - fromCore(b.seed) || a.id - b.id);
    for (const h of routeOrder) layRoute(h);

    // Gateways no route reached: straight across, then into the district
    // until the first street that carries on past it.
    for (const x of crossings) {
      if (gatewayUsed.has(x.key)) continue;
      const id = nextId;
      // Straight across the greenway, then on towards the nearest
      // neighbourhood centre with a route, to a T on the first street met.
      const stub = [x.p];
      for (let r = STEP; r <= STUB; r += STEP) stub.push([x.p[0] + x.n[0] * r, x.p[1] + x.n[1] * r]);
      let goal = null;
      for (const h of hoods) {
        if (h.core || !(routeOf.has(h.id) || h.onBoulevard)) continue;
        const r = len(sub(h.seed, x.p));
        if (r < 2500 && dot(sub(h.seed, x.p), x.n) > 0 && (!goal || r < goal.r)) goal = { r, p: h.seed };
      }
      // It joins the nearest street ahead (clear of the station), or failing
      // that heads for the nearest centre with a route, or the core.
      const ahead = streetAhead(stub[stub.length - 1], x.n, id, STATION_CLEAR);
      const on = steer(stub[stub.length - 1], x.n, id, { target: ahead || (goal ? goal.p : S), stopAtHit: true, pull: ahead ? 0.5 : 0.4, aim: true });
      const pts = stub.concat(on.pts.slice(1));
      const l = place(pts.length >= 3 ? pts : pts.concat([[pts[pts.length - 1][0] + x.n[0], pts[pts.length - 1][1] + x.n[1]]]), { crossing: x.key, protectStart: true });
      stubIds.add(l.id);
      if (!meetsThrough(l.points, id)) pending.push(l);
    }

    // Does a crossing street meet, past its stub, a street that carries on past it?
    function meetsThrough(pts, own) {
      return hits(pts, own).some((h) => h.pos > STUB_POS && passesThrough(h.with, h.at));
    }
    function pathLength(q) {
      let t = 0;
      for (let i = 1; i < q.length; i++) t += len(sub(q[i], q[i - 1]));
      return t;
    }
    // Does a line turn back on itself anywhere: more than TURN_BACK within
    // any 2 * CURL_SPAN of its length?
    function curls(q) {
      const at = [0];
      const hd = [0];
      for (let i = 1; i < q.length - 1; i++) {
        const a = sub(q[i], q[i - 1]);
        const b = sub(q[i + 1], q[i]);
        at.push(at[i - 1] + len(a));
        // (A repeated point has no heading of its own.)
        hd.push(hd[i - 1] + (len(a) > 1e-9 && len(b) > 1e-9 ? Math.atan2(a[0] * b[1] - a[1] * b[0], dot(a, b)) : 0));
      }
      for (let i = 0, j = 0; i < hd.length; i++) {
        let lo = hd[i];
        let hi = hd[i];
        for (j = i; j < hd.length && at[j] - at[i] <= 2 * CURL_SPAN; j++) {
          lo = Math.min(lo, hd[j]);
          hi = Math.max(hi, hd[j]);
        }
        if (hi - lo > TURN_BACK) return true;
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
            if (h) out.push({ pos: i + h[0], with: g[6], at: g[7] + h[1], seg: k });
          }
        }
      }
      return out.sort((a, b) => a.pos - b.pos);
    }
    // Does line `id` carry on past position `at` both ways, so a street may end there?
    // A boulevard carries on past a point not too near its ends; a
    // roundabout (a closed loop) has no ends.
    function boulevardThrough(id, at) {
      const q = d.network.lines[-1 - id].points;
      const a = q[0];
      const b = q[q.length - 1];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1) return true;
      return at >= THROUGH_B && at <= q.length - 1 - THROUGH_B;
    }
    // Is a segment on a part of its line that resolve has trimmed away?
    function trimmed(g) {
      const t = kept.get(g[6]);
      return !!t && (g[7] + 1 < t[0] || g[7] > t[1]);
    }
    function passesThrough(id, at) {
      if (id < 0) return boulevardThrough(id, at);
      const l = lineById.get(id);
      if (!l) return false;
      let lo = l.protectStart ? STUB_POS : 0;
      let hi = l.points.length - 1;
      // Once trimmed, only the part still standing counts.
      const t = kept.get(id);
      if (t) {
        lo = Math.max(lo, t[0]);
        hi = Math.min(hi, t[1]);
      }
      return at >= lo + THROUGH && at <= hi - THROUGH;
    }
    // `dir` is the way the street was heading; a join never turns back on it,
    // meets its target at a fair angle, keeps clear of other junctions and
    // never runs alongside another street on the way. Nearest first.
    function connector(from, own, dir, limit = 700, cone = 0.8, allow = null, junctionGap = JUNCTION_GAP, glancing = GLANCING) {
      const cands = [];
      const seen = new Set();
      for (const k of segsNear(from[0], from[1], limit)) {
        if (seen.has(k)) continue;
        seen.add(k);
        const g = segs[k];
        if (g[6] === own || (allow && !allow(g[6]))) continue;
        if (stubIds.has(g[6]) && g[7] < STUB_POS) continue; // not onto a greenway crossing's stub
        const dx = g[2] - g[0];
        const dy = g[3] - g[1];
        const l2 = dx * dx + dy * dy;
        const t0 = l2 > 0 ? Math.max(0, Math.min(1, ((from[0] - g[0]) * dx + (from[1] - g[1]) * dy) / l2)) : 0;
        // The foot of the perpendicular, or if that is by a junction, the
        // segment's middle or ends.
        for (const t of [t0, 0.5, 0, 1]) {
          const q = [g[0] + dx * t, g[1] + dy * t];
          const vx = q[0] - from[0];
          const vy = q[1] - from[1];
          const lv = Math.hypot(vx, vy);
          if (lv < 1e-6 || lv > limit) continue;
          if ((vx * dir[0] + vy * dir[1]) / lv < cone) continue;
          if (Math.abs(vx * g[4] + vy * g[5]) / lv > glancing) continue;
          if (junctionGap > 0 && nearJunction(q, junctionGap)) continue;
          cands.push({ r: lv + (t === t0 ? 0 : 1), q });
          break;
        }
      }
      cands.sort((a, b) => a.r - b.r);
      // Spread out: no two candidates within CAND_GAP of each other.
      const spread = [];
      for (const c of cands) if (!spread.some((o) => len(sub(o.q, c.q)) < CAND_GAP)) spread.push(c);
      cands.length = 0;
      cands.push(...spread);
      for (const { q } of cands.slice(0, 5)) {
        // A gentle curve carrying on from the street's heading into the target.
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
        // No tighter a bend than the streets themselves may make.
        let clear = true;
        const path = [from, ...out];
        for (let i = 1; i < path.length - 1 && clear; i++) {
          const a = unit(sub(path[i], path[i - 1]));
          const b = unit(sub(path[i + 1], path[i]));
          clear = Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) <= MAX_TURN * 1.3 * (len(sub(path[i + 1], path[i])) / STEP);
        }
        for (let i = 2; i < out.length - 3 && clear; i += 2) {
          const v = unit(sub(out[i + 1], out[i - 1]));
          clear = !crowded(out[i], v, 160, own) && isLand(out[i][0], out[i][1]);
        }
        if (!clear) continue;
        const u = unit(sub(q, out.length > 1 ? out[out.length - 2] : from));
        out.push([q[0] + u[0] * OVERSHOOT, q[1] + u[1] * OVERSHOOT]);
        return out;
      }
      return [];
    }

    // 6. Crossing streets still meeting nothing join the nearest street: by
    // bending round into it, or failing that by running straight in, square
    // to the greenway, to the first street met at a fair angle.
    function rescue(l) {
      for (const cone of [0.8, 0.5, 0.2, 0]) {
        const extra = connector(l.points[l.points.length - 1], l.id, endDir(l.points, false), 700, cone);
        if (extra.length && !curls(l.points.concat(extra))) {
          const from = l.points.length - 1;
          l.points = l.points.concat(extra);
          addLine(l.points.slice(from), l.id, from);
          return true;
        }
      }
      // Across a narrow district: carry straight on to another crossing close
      // ahead, as one street, in place of that crossing's own street.
      const end = l.points[l.points.length - 1];
      const dirEnd = endDir(l.points, false);
      for (const y of crossings) {
        if (y.key === l.crossing) continue;
        const v = sub(y.p, end);
        const r = len(v);
        if (r > 500 || (r > 1e-6 && dot(v, dirEnd) / r < 0.5) || dot(y.n, dirEnd) > -0.3) continue;
        const other = lines.find((o) => o.crossing === y.key);
        const n = Math.max(2, Math.ceil(r / STEP));
        const c = [end[0] + dirEnd[0] * r * 0.45, end[1] + dirEnd[1] * r * 0.45];
        const tail = [];
        for (let i = 1; i <= n; i++) {
          const t = i / n;
          tail.push([(1 - t) * (1 - t) * end[0] + 2 * (1 - t) * t * c[0] + t * t * y.p[0], (1 - t) * (1 - t) * end[1] + 2 * (1 - t) * t * c[1] + t * t * y.p[1]]);
        }
        tail[tail.length - 1] = y.p;
        if (curls(l.points.concat(tail))) continue;
        if (other) removeLine(other.id);
        const from = l.points.length - 1;
        l.points = l.points.concat(tail);
        l.crossingEnd = y.key;
        addLine(l.points.slice(from), l.id, from);
        return true;
      }
      const x = crossings.find((c) => c.key === l.crossing);
      if (!x) return false;
      const pts = [x.p];
      let cur = x.p;
      for (let r = STEP; r <= 1500; r += STEP) {
        const next = [x.p[0] + x.n[0] * r, x.p[1] + x.n[1] * r];
        if (r > STUB) {
          const h = hits([cur, next], l.id).find((c) => passesThrough(c.with, c.at) && Math.abs(segs[c.seg][4] * x.n[0] + segs[c.seg][5] * x.n[1]) < GLANCING);
          if (h) {
            pts.push([cur[0] + (next[0] - cur[0]) * h.pos + x.n[0] * OVERSHOOT, cur[1] + (next[1] - cur[1]) * h.pos + x.n[1] * OVERSHOOT]);
            removeLine(l.id);
            const nl = place(pts, { crossing: l.crossing, protectStart: true });
            stubIds.add(nl.id);
            return true;
          }
        }
        if (r > STUB + 40 && !isLand(next[0], next[1])) break;
        pts.push(next);
        cur = next;
      }
      // Really the last resorts: a wider, longer join, allowed near other
      // junctions, and then a short one right by them (better than a dead end).
      for (const [limit, cone, gap] of [[1000, -0.3, 40], [300, -0.5, 0]]) {
        const extra = connector(l.points[l.points.length - 1], l.id, endDir(l.points, false), limit, cone, null, gap);
        if (extra.length && !curls(l.points.concat(extra))) {
          const from = l.points.length - 1;
          l.points = l.points.concat(extra);
          addLine(l.points.slice(from), l.id, from);
          return true;
        }
      }
      return false;
    }
    // Routes whose outer end met nothing when laid try again, now that the
    // streets laid after them are there too. (An end that ran up against
    // the greenway may first draw back a little.)
    function joinLoose(l) {
      const head = Math.max(...l.hoodPos.values()) + 3;
      for (const back of [0, 8, 16]) {
        const keep = l.points.length - back;
        if (keep < head) break;
        const pts = l.points.slice(0, keep);
        const end = pts[pts.length - 1];
        const dir = endDir(pts, false);
        for (const [cone, limit, gap] of [[0.8, 700, JUNCTION_GAP], [0.5, 700, JUNCTION_GAP], [0.2, 700, JUNCTION_GAP], [0, 1000, 40]]) {
          const extra = connector(end, l.id, dir, limit, cone, null, gap);
          if (extra.length && !curls(pts.concat(extra))) {
            removeLine(l.id);
            l.points = pts.concat(extra);
            lines.push(l);
            lineById.set(l.id, l);
            addLine(l.points, l.id);
            return true;
          }
        }
      }
      return false;
    }
    for (const l of looseEnds) {
      l.anchored = true;
      if (lineById.has(l.id) && !l.crossingEnd && joinLoose(l)) l.anchored = false;
    }
    for (const l of pending) if (lineById.has(l.id) && !l.crossingEnd && !meetsThrough(l.points, l.id)) rescue(l);

    // ---- Junctions and trimming ----
    // All crossings between lines (main streets and boulevards).
    // `last`: the final pass, where a crossing street that could not be
    // joined up properly is cut back to its last junction of any kind.
    function resolve(last = false) {
    const all = lines.map((l) => ({ ...l, cuts: [] }));
    const byId = new Map(all.map((l) => [l.id, l]));
    for (let ka = 0; ka < segs.length; ka++) {
      const g = segs[ka];
      if (g[6] <= 0) continue; // walk from main street segments (0: taken out)
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
        // A street may end only where the street it meets carries on past
        // it both ways, so no two streets end at one corner.
        const live = l.cuts.filter((c) => {
          // A crossing street's junction must lie beyond its stub across the greenway.
          if (l.protectStart && c.pos * STEP < STUB + STEP) return false;
          const p = c.otherPos;
          if (c.with < 0) return boulevardThrough(c.with, p);
          const o = byId.get(c.with);
          if (!o || !o.alive) return false;
          const lo = o.protectStart ? Math.max(o.lo, STUB_POS) : o.lo;
          return p >= lo + THROUGH - 1e-9 && p <= o.hi - THROUGH + 1e-9;
        });
        let lo;
        let hi;
        if (l.crossingEnd || l.edgeEnd) {
          // Ends at a greenway crossing, where it carries on into the next
          // district (or at a park gate, or the land's edge, meeting the
          // street along the greenway); that end stands, the other is
          // trimmed as usual.
          const lo = l.protectStart ? 0 : live.length ? live[0].pos : last ? l.points.length - 1 : 0;
          // With nothing left to meet at its other end, it waits for a rescue.
          if (!live.length && !l.protectStart && !last) l.lonely = true;
          if (lo !== l.lo || l.hi !== l.points.length - 1) changed = true;
          l.lo = lo;
          l.hi = l.points.length - 1;
          continue;
        }
        if (l.anchored && live.length === 1 && !last) {
          // A route whose outer end still meets nothing: it waits, whole
          // from its inner junction on, for another try at joining up.
          lo = live.length ? live[0].pos : 0;
          hi = l.points.length - 1;
          l.lonely = true;
        } else if (!live.length) {
          const any = last ? l.cuts.filter((c) => c.pos > STUB_POS && (c.with < 0 || (byId.get(c.with) && byId.get(c.with).alive && c.otherPos >= byId.get(c.with).lo - 1e-9 && c.otherPos <= byId.get(c.with).hi + 1e-9))) : [];
          if (l.protectStart && any.length) {
            lo = 0;
            hi = any[any.length - 1].pos;
          } else if (l.protectStart) {
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
    function keep(all) {
      for (const l of all) {
        if (!l.alive) kept.set(l.id, [Infinity, -Infinity]);
        else kept.set(l.id, [l.lo, l.hi >= l.points.length - 1 ? Infinity : l.hi]);
      }
      return all;
    }
    let all = keep(resolve());
    // A crossing street whose junctions were all trimmed away is rescued
    // the same way, and everything is settled again.
    // Two crossing streets left meeting only each other's loose ends become
    // one street from one gateway to the other, if their ends face each
    // other close enough to join in a smooth curve.
    // Does a path bend no tighter than the streets themselves may?
    function gentle(path) {
      for (let i = 1; i < path.length - 1; i++) {
        const a = unit(sub(path[i], path[i - 1]));
        const b = unit(sub(path[i + 1], path[i]));
        if (Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) > MAX_TURN * 1.3 * (len(sub(path[i + 1], path[i])) / STEP)) return false;
      }
      return true;
    }
    function pairUp(lonely) {
      let any = false;
      const used = new Set();
      // Crossing streets first, so a joined line starts at its gateway.
      const order = lonely.slice().sort((a, b) => (b.crossing ? 1 : 0) - (a.crossing ? 1 : 0));
      for (const a of order) {
        const l = lineById.get(a.id);
        if (!l || used.has(l.id) || l.crossingEnd) continue;
        // Either end may first draw back a little, as in joinLoose.
        const minKeep = (x) => (x.crossing ? STUB_POS + 3 : 4);
        const cands = [];
        for (const b of lonely) {
          const o = lineById.get(b.id);
          if (!o || o === l || used.has(o.id) || o.crossingEnd || (o.crossing && o.crossing === l.crossing)) continue;
          // l's end (drawn back a little, perhaps) joins o at its end or
          // anywhere along it past its first junction, o's tail beyond dropped.
          const tries = [];
          for (const bl of [0, 8]) for (let no = o.points.length; no >= minKeep(o); no -= 2) tries.push([l.points.length - bl, no]);
          for (const [nl, no] of tries) {
            {
              const lp = l.points.slice(0, nl);
              const op = o.points.slice(0, no);
              if (lp.length < minKeep(l) || op.length < minKeep(o)) continue;
              const p = lp[lp.length - 1];
              const q = op[op.length - 1];
              const u = endDir(lp, false);
              const w = endDir(op, false);
              const v = sub(q, p);
              const r = len(v);
              if (r > PAIR_REACH || r < 60) continue;
              if (dot(v, u) / r < -0.1 || -dot(v, w) / r < -0.1) continue;
              cands.push({ o, r: r + (l.points.length - nl + o.points.length - no) * STEP * 0.5, lp, op, p, q, u, w });
            }
          }
        }
        cands.sort((x, y) => x.r - y.r || x.o.id - y.o.id);
        for (const { o, lp, op, p, q, u, w } of cands) {
          if (used.has(o.id)) continue;
          const r = len(sub(q, p));
          // Hermite curve from l's end to o's end, leaving along u, arriving against w.
          const n = Math.max(2, Math.ceil(r / STEP));
          const k = r * 0.8;
          const curve = [];
          for (let i = 1; i < n; i++) {
            const t = i / n;
            const h1 = 2 * t ** 3 - 3 * t * t + 1;
            const h2 = t ** 3 - 2 * t * t + t;
            const h3 = -2 * t ** 3 + 3 * t * t;
            const h4 = t ** 3 - t * t;
            curve.push([h1 * p[0] + h2 * u[0] * k + h3 * q[0] - h4 * w[0] * k, h1 * p[1] + h2 * u[1] * k + h3 * q[1] - h4 * w[1] * k]);
          }
          const pts = lp.concat(curve, op.slice().reverse());
          if (curls(pts) || !curve.every(([x, y]) => isLand(x, y)) || !gentle([p, ...curve, q])) continue;
          used.add(l.id);
          used.add(o.id);
          removeLine(l.id);
          removeLine(o.id);
          // Centres along either keep their place on the joined line.
          const hoodPos = new Map([...(l.hoodPos || [])].filter(([, i]) => i < lp.length - 1));
          for (const [k2, i] of o.hoodPos || []) if (i < op.length - 1) hoodPos.set(k2, pts.length - 1 - i);
          const nl = place(pts, { crossing: l.crossing, protectStart: !!l.crossing, crossingEnd: o.crossing, hoodPos });
          if (l.crossing) stubIds.add(nl.id);
          any = true;
          break;
        }
      }
      return any;
    }
    // A street ending at a gateway, turned round to start there, like a
    // crossing street (so it can be rescued like one).
    function flip(l) {
      removeLine(l.id);
      const n = l.points.length;
      const hoodPos = new Map([...(l.hoodPos || [])].map(([k, i]) => [k, n - 1 - i]));
      const nl = place(l.points.slice().reverse(), { crossing: l.crossingEnd, protectStart: true, hoodPos });
      stubIds.add(nl.id);
      return nl;
    }
    function settle() {
    for (let round = 0; round < 3; round++) {
      const lonely = all.filter((l) => l.alive && l.lonely);
      if (!lonely.length) break;
      let any = pairUp(lonely);
      for (const a of lonely) {
        let l = lineById.get(a.id);
        if (l && l.crossingEnd && !l.protectStart) l = flip(l);
        if (!l || l.crossingEnd) continue;
        if (l.anchored ? joinLoose(l) : rescue(l)) any = true;
      }
      if (!any) break;
      all = keep(resolve());
    }
    }
    settle();
    // Routes that never joined up go, and what met them settles again.
    const unjoined = all.filter((l) => l.alive && l.lonely && l.anchored);
    if (unjoined.length) {
      for (const l of unjoined) {
        const o = lineById.get(l.id);
        if (o) o.anchored = false;
        removeLine(l.id);
      }
      all = keep(resolve());
      settle();
    }

    // Neighbourhoods still without a route of their own get a cross street
    // through the centre (or a spot close to it), in a T on a through street
    // at each end, keeping its distance from streets running the same way.
    const routed = (h) => all.some((l) => l.alive && l.hoodPos && l.hoodPos.has(h.id) && l.hoodPos.get(h.id) >= l.lo && l.hoodPos.get(h.id) <= l.hi);
    let filled = false;
    for (const h of hoods.slice().sort((a, b) => fromCore(a.seed) - fromCore(b.seed) || a.id - b.id)) {
      if (h.core || h.onBoulevard || routed(h)) continue;
      // A loose street ending close by carries on through the centre instead.
      let carried = false;
      for (const a of all) {
        const l = a.alive && a.lonely && !a.crossingEnd ? lineById.get(a.id) : null;
        if (!l || len(sub(l.points[l.points.length - 1], h.seed)) > FILL_SHIFT * 1.5) continue;
        const r = steer(l.points[l.points.length - 1], endDir(l.points, false), l.id, { stopAtHit: true, gap: FILL_GAP, straight: true, slide: true, edgeGap: FILL_EDGE_GAP, parkEnds: true });
        if (r.end !== 'hit' && r.end !== 'park') continue;
        const pts = l.points.concat(r.pts.slice(1));
        if (curls(pts)) continue;
        const from = l.points.length - 1;
        l.points = pts;
        addLine(pts.slice(from), l.id, from);
        if (r.end === 'park') l.crossingEnd = addGate(r.park, pts[pts.length - 1]);
        let at = 0;
        for (let i = 1; i < pts.length; i++) if (len(sub(pts[i], h.seed)) < len(sub(pts[at], h.seed))) at = i;
        h.seed = pts[at];
        l.hoodPos = new Map([...(l.hoodPos || []), [h.id, at]]);
        carried = filled = true;
        break;
      }
      if (carried) continue;
      const id = nextId;
      let best = null;
      const spots = [h.seed];
      for (let k = 0; k < 8; k++) spots.push([h.seed[0] + Math.cos((k * Math.PI) / 4) * FILL_SHIFT, h.seed[1] + Math.sin((k * Math.PI) / 4) * FILL_SHIFT]);
      for (const p of spots) {
        if (!isLand(p[0], p[1]) || segsNear(p[0], p[1], 60).some((k) => segs[k][6] !== 0 && segDist(p[0], p[1], segs[k][0], segs[k][1], segs[k][2], segs[k][3]) < 60)) continue;
        const [fa, fb] = field(p[0], p[1]);
        const heads = [fa, fb];
        for (let k = 0; k < 6; k++) heads.push([Math.cos((k * Math.PI) / 6), Math.sin((k * Math.PI) / 6)]);
        // A candidate: half a ends in a T or at a park gate, half b in a T.
        const consider = (a, b) => {
          if ((a.end !== 'hit' && a.end !== 'park') || b.end !== 'hit') return;
          const pts = b.pts.slice().reverse().concat(a.pts.slice(1));
          const L = pathLength(pts);
          if (L > FILL_LONGEST || curls(pts) || pathLength(a.pts) < JUNCTION_GAP || pathLength(b.pts) < JUNCTION_GAP) return;
          // Nowhere alongside another street, save where it turns in at its ends.
          const n0 = Math.ceil(120 / STEP);
          for (let i = n0; i < pts.length - n0; i += 2) if (crowded(pts[i], unit(sub(pts[i + 1], pts[i - 1])), FILL_GAP, id, 0)) return;
          // Short, straight, and through the centre itself if it can be.
          const score = L + turning(pts) * 400 + len(sub(p, h.seed)) * 2;
          if (!best || score < best.score) best = { score, pts, p, at: b.pts.length - 1, park: a.end === 'park' ? a.park : null };
        };
        const opts = { stopAtHit: true, gap: FILL_GAP, straight: true, slide: true, edgeGap: FILL_EDGE_GAP, parkEnds: true };
        for (const v of heads) {
          const a = steer(p, v, id, opts);
          consider(a, steer(p, [-v[0], -v[1]], id, { ...opts, parkEnds: a.end !== 'park' }));
        }
        // In a wedge of land ending at a park: up to its gate, and back the
        // other way to the nearest street that carries on.
        for (const pk of d.parks) {
          const c = pk.shape.reduce((m, q) => [m[0] + q[0] / pk.shape.length, m[1] + q[1] / pk.shape.length], [0, 0]);
          if (len(sub(c, p)) > FILL_LONGEST) continue;
          const v = unit(sub(c, p));
          const a = steer(p, v, id, { target: c, aim: true, pull: 0.7, parkEnds: true, stopAtHit: true, gap: FILL_GAP, edgeGap: 0 });
          if (a.end !== 'park') continue;
          const back = [-v[0], -v[1]];
          const q = streetAhead(p, back, id, 0, -0.2);
          consider(a, q ? steer(p, back, id, { target: q, aim: true, pull: 0.6, stopAtHit: true, gap: FILL_GAP }) : steer(p, back, id, opts));
        }
        if (best && p === h.seed) break;
      }
      if (!best) continue;
      h.seed = best.p;
      const extra = best.park ? { crossingEnd: addGate(best.park, best.pts[best.pts.length - 1]) } : {};
      const nl = place(best.pts, { hood: h.id, hoodPos: new Map([[h.id, best.at]]), ...extra });
      filled = true;
      // A loose street ending close by may bend round into the new one.
      for (const a of all) {
        const l = a.alive && a.lonely && !a.crossingEnd ? lineById.get(a.id) : null;
        if (!l || distToLine(l.points[l.points.length - 1][0], l.points[l.points.length - 1][1], nl.points) > 400) continue;
        for (const cone of [0.5, 0, -0.5]) {
          const ex = connector(l.points[l.points.length - 1], l.id, endDir(l.points, false), 400, cone, (o) => o === nl.id, 40);
          if (ex.length && !curls(l.points.concat(ex))) {
            const from = l.points.length - 1;
            l.points = l.points.concat(ex);
            addLine(l.points.slice(from), l.id, from);
            break;
          }
        }
      }
    }
    // Anything left loose may join the new streets.
    if (filled) {
      all = keep(resolve());
      settle();
    }

    // Streets too close alongside another: a street that is no
    // neighbourhood's own (through its centre) and leads to no other
    // district goes, if most of it runs within PRUNE_GAP of another going
    // the same way. (Its land is reached again below, by streets kept apart.)
    {
      let pruned = false;
      const ownOf = (l) => l.hoodPos && [...l.hoodPos.values()].some((i) => i >= l.lo && i <= l.hi);
      // (A neighbourhood's own street may go too, if another street passes
      // close to its centre for it to move onto.)
      const spare = (l) =>
        !ownOf(l) ||
        [...l.hoodPos].every(([hid, i]) => {
          if (i < l.lo || i > l.hi) return true;
          const q = l.points[Math.min(l.points.length - 1, Math.round(i))];
          return segsNear(q[0], q[1], PRUNE_MOVE).some((k) => segs[k][6] !== l.id && segs[k][6] !== 0 && !trimmed(segs[k]) && segDist(q[0], q[1], segs[k][0], segs[k][1], segs[k][2], segs[k][3]) < PRUNE_MOVE);
        });
      const order = all.filter((l) => l.alive && !l.crossing && !l.crossingEnd && spare(l));
      for (const a of order) {
        const l = lineById.get(a.id);
        if (!l) continue;
        const lo = Math.max(0, Math.floor(a.lo));
        const hi = Math.min(l.points.length - 1, Math.ceil(a.hi));
        let n = 0;
        let close = 0;
        for (let i = lo + 1; i < hi; i++) {
          const q = l.points[i];
          const dir = unit(sub(l.points[i + 1], l.points[i - 1]));
          n++;
          for (const k of segsNear(q[0], q[1], PRUNE_GAP)) {
            const g = segs[k];
            if (g[6] === a.id || g[6] === 0 || trimmed(g) || Math.abs(g[4] * dir[0] + g[5] * dir[1]) < PARALLEL) continue;
            if (segDist(q[0], q[1], g[0], g[1], g[2], g[3]) < PRUNE_GAP) {
              close++;
              break;
            }
          }
        }
        if (n > 5 && close > n * 0.5) {
          removeLine(a.id);
          pruned = true;
        }
      }
      if (pruned) {
        all = keep(resolve());
        settle();
      }
    }

    // Everywhere a short walk from a main street: while any land lies more
    // than COVER from one, a cross street goes through (or close by) the
    // farthest spot, from a T to a T (or a park gate), as for a
    // neighbourhood without a route but allowed longer and closer to
    // streets running the same way. A spot nothing can reach is let be.
    const gapAt = (x, y) => {
      let b = COVER * 2;
      for (const k of segsNear(x, y, COVER * 2)) {
        const g = segs[k];
        if (g[6] === 0 || trimmed(g)) continue;
        b = Math.min(b, segDist(x, y, g[0], g[1], g[2], g[3]));
      }
      return b;
    };
    const given = [];
    const ring = d.ring.concat([d.ring[0]]);
    // The nearest point on the greenway's line.
    const edgeFoot = (e) => {
      let f = null;
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i];
        const ab = sub(ring[i + 1], a);
        const t = Math.max(0, Math.min(1, dot(sub(e, a), ab) / (dot(ab, ab) || 1)));
        const q = [a[0] + ab[0] * t, a[1] + ab[1] * t];
        if (!f || len(sub(q, e)) < len(sub(f, e))) f = q;
      }
      return f;
    };
    let covered = false;
    for (let round = 0; round < COVER_ROUNDS; round++) {
      let far = null;
      for (let y = grid.y0 + COVER_STEP / 2; y < grid.y0 + grid.H * 50; y += COVER_STEP) {
        for (let x = grid.x0 + COVER_STEP / 2; x < grid.x0 + grid.W * 50; x += COVER_STEP) {
          // (Not for land right by the edge: a street there would have half
          // the catchment of one further in.)
          if (!isLand(x, y) || given.some((q) => len(sub(q, [x, y])) < COVER) || edgeAlong([x, y], COVER_EDGE)) continue;
          const r = gapAt(x, y);
          if (r > COVER && (!far || r > far.r)) far = { p: [x, y], r };
        }
      }
      if (!far) break;
      given.push(far.p);
      const id = nextId;
      let best = null;
      const spots = [far.p];
      for (const rr of [COVER * 0.3, COVER * 0.6]) for (let k = 0; k < 8; k++) spots.push([far.p[0] + Math.cos((k * Math.PI) / 4) * rr, far.p[1] + Math.sin((k * Math.PI) / 4) * rr]);
      // (Kept well clear of streets running the same way and of the edge if
      // it can be; closer only where nothing else will reach.)
      for (const [gap, edgeGap] of [[COVER_GAP, EDGE_GAP], [COVER_GAP_LAST, FILL_EDGE_GAP]]) {
      if (best) break;
      const opts = { stopAtHit: true, gap, straight: true, slide: true, edgeGap, parkEnds: true };
      for (const p of spots) {
        if (!isLand(p[0], p[1]) || gapAt(p[0], p[1]) < gap) continue;
        const [fa, fb] = field(p[0], p[1]);
        const heads = [fa, fb];
        for (let k = 0; k < 6; k++) heads.push([Math.cos((k * Math.PI) / 6), Math.sin((k * Math.PI) / 6)]);
        // One side may instead run on to the land's edge (meeting the street
        // along the greenway there), if the other ends in a T.
        const side = (v) => {
          const r = steer(p, v, id, opts);
          if (r.end === 'hit' || r.end === 'park') return r;
          const e = steer(p, v, id, { ...opts, slide: false, parkEnds: false });
          return e.end === 'edge' ? e : r;
        };
        for (const v of heads) {
          let a = side(v);
          let b = side([-v[0], -v[1]]);
          if (b.end !== 'hit') [a, b] = [b, a];
          if (b.end !== 'hit' || (a.end !== 'hit' && a.end !== 'park' && a.end !== 'edge')) continue;
          if (a.end === 'edge') {
            // Close to the greenway's line, and heading on into it.
            if (a.pts.length < 2) continue;
            const e = a.pts[a.pts.length - 1];
            const f = edgeFoot(e);
            const r = len(sub(f, e));
            if (r > EDGE_REACH || (r > 5 && dot(unit(sub(f, e)), unit(sub(e, a.pts[a.pts.length - 2]))) < 0.5)) continue;
          }
          const pts = b.pts.slice().reverse().concat(a.pts.slice(1));
          const L = pathLength(pts);
          if (L > COVER_LONGEST || curls(pts) || pathLength(a.pts) < JUNCTION_GAP || pathLength(b.pts) < JUNCTION_GAP) continue;
          const reach = distToLine(far.p[0], far.p[1], pts);
          if (reach > COVER * 0.7) continue;
          const n0 = Math.ceil(120 / STEP);
          let ok = true;
          for (let i = n0; i < pts.length - n0 && ok; i += 2) if (crowded(pts[i], unit(sub(pts[i + 1], pts[i - 1])), gap, id, 0)) ok = false;
          if (!ok) continue;
          // Straight, and as near the spot as it can be, with a T at each
          // end if it can: short only as a tie-break.
          const score = reach * 3 + turning(pts) * 400 + L * 0.2 + (a.end === 'edge' ? COVER * 0.5 : 0);
          if (!best || score < best.score) best = { score, pts, park: a.end === 'park' ? a.park : null, edge: a.end === 'edge' };
        }
        if (best && best.score < COVER) break;
      }
      }
      if (!best) continue;
      if (best.edge) {
        // (The land raster is coarse: run on to the greenway's line itself.)
        const P = best.pts;
        const e = P[P.length - 1];
        const f = edgeFoot(e);
        // (Unless already on it, or just over it.)
        const n = dot(sub(f, e), sub(e, P[P.length - 2])) > 0 ? Math.ceil(len(sub(f, e)) / STEP) : 0;
        for (let k = 1; k <= n; k++) P.push([e[0] + ((f[0] - e[0]) * k) / n, e[1] + ((f[1] - e[1]) * k) / n]);
      }
      const extra = best.park ? { crossingEnd: addGate(best.park, best.pts[best.pts.length - 1]) } : best.edge ? { edgeEnd: true } : {};
      place(best.pts, extra);
      covered = true;
    }
    if (covered) {
      all = keep(resolve());
      settle();
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
      for (let i = pts.length - 1; i > 0; i--) if (len(sub(pts[i], pts[i - 1])) < 1e-6) pts.splice(i, 1);
      if (pts.length >= 2 && len(sub(pts[0], pts[pts.length - 1])) > 1) {
        out.push({
          key: `${d.key}:m${l.id}`,
          id: l.id,
          kind: l.crossing && !isGate(l.crossing) ? 'crossing' : 'street',
          crossing: l.crossing && !isGate(l.crossing) ? l.crossing : null,
          // (A street turned round to start at a park gate, or ending at one.)
          parkStart: l.crossing && isGate(l.crossing) ? gateOf(l.crossing) : null,
          crossingEnd: l.crossingEnd && !isGate(l.crossingEnd) ? l.crossingEnd : null,
          parkEnd: l.crossingEnd && isGate(l.crossingEnd) ? gateOf(l.crossingEnd) : null,
          // (Or ending at the land's edge, on the street along the greenway.)
          edgeEnd: !!l.edgeEnd && l.hi >= l.points.length - 1,
          // Neighbourhoods whose own main street this is (through their centre).
          serves: [...(l.hoodPos || [])].filter(([, i]) => i >= l.lo && i <= l.hi).map(([k]) => k).sort((a, b) => a - b),
          points: pts,
          bbox: lineBox(pts),
          pieces: piecesOf(pts),
        });
      }
    }
    return out;
    }
    let out = extract(all);

    if (all.some((l) => l.alive && l.lonely)) {
      all = resolve(true);
      out = extract(all);
    }
    // Last of all, a street in from a greenway crossing that still meets
    // nothing runs straight on to the nearest street, if one is near.
    for (const o of out) {
      if (!o.crossing || o.crossingEnd || o.parkEnd) continue;
      const e = o.points[o.points.length - 1];
      const others = out.filter((x) => x !== o).map((x) => x.points).concat(d.network.lines.map((l) => l.points));
      if (others.some((P) => P.some((q, i) => i && segDist(e[0], e[1], P[i - 1][0], P[i - 1][1], q[0], q[1]) < 1))) continue;
      let best = null;
      for (const P of others) {
        for (let i = 1; i < P.length; i++) {
          const a = P[i - 1];
          const ab = sub(P[i], a);
          const l2 = dot(ab, ab) || 1;
          const t = Math.max(0, Math.min(1, dot(sub(e, a), ab) / l2));
          const q = [a[0] + ab[0] * t, a[1] + ab[1] * t];
          const r = len(sub(q, e));
          if (r < JOIN_REACH && (!best || r < best.r)) best = { r, q };
        }
      }
      if (!best) continue;
      const n = Math.max(1, Math.ceil(best.r / STEP));
      for (let k = 1; k <= n; k++) o.points.push([e[0] + ((best.q[0] - e[0]) * k) / n, e[1] + ((best.q[1] - e[1]) * k) / n]);
      o.bbox = lineBox(o.points);
      o.pieces = piecesOf(o.points);
    }

    // Street distance from the station, on a raster of the streets.
    function streetDistance(out) {
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
      return { dist, on };
    }
    // ---- Neighbourhood centres on their streets ----
    // A neighbourhood whose own street survived keeps its centre there; any
    // other takes the nearest point on a street. Each records the street
    // through its centre (its spine), from which it is regrown.
    const outById = new Map();
    for (const l of out) outById.set(l.id, l);
    const streetsAll = out.map((l) => l.points).concat(d.network.lines.filter((l) => l.kind !== 'roundabout').map((l) => l.points));
    const reach = streetDistance(out);
    for (const h of hoods) {
      if (h.core) {
        h.spine = null;
        continue;
      }
      const a = all.find((l) => l.alive && l.hoodPos && l.hoodPos.has(h.id));
      const pos = a ? a.hoodPos.get(h.id) : -1;
      if (a && pos >= a.lo && pos <= a.hi && outById.has(a.id)) {
        h.centre = h.seed;
        h.spine = outById.get(a.id).points;
        continue;
      }
      // The nearest point close by on a street that leads to the station,
      // or failing that simply the nearest street point.
      let best = null;
      let any = null;
      for (const pts of streetsAll) {
        for (const q of pts) {
          const r = len(sub(q, h.seed));
          if (!any || r < any.r) any = { r, q, pts };
          if (r > CENTRE_SNAP || (best && r >= best.r)) continue;
          const n = grid.cellOf(q[0], q[1]);
          if (n < 0 || !Number.isFinite(reach.dist[n])) continue;
          best = { r, q, pts };
        }
      }
      best = best || any;
      if (best) {
        h.centre = best.q;
        h.spine = best.pts;
      }
    }

    return { lines: out };
  };
}
