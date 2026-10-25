// Main streets of a district: an organic network of old high streets.
//
// Every neighbourhood has one main street of its own running roughly down
// its middle, through its centre (where its square and shops gather), so
// its homes lie at about the same distance either way along it. That
// street is laid out from the centre both ways: inward it heads for the
// district's core and meets the first street that carries on past it, in a
// T; outward it heads for a gateway into the next district if one lies
// ahead, or else meets another street, or runs out to the greenway at the
// edge. Gateways no neighbourhood's street reached get a street of their
// own into the district, to the first street met. Boulevards are main
// streets too, and a neighbourhood a boulevard runs through has it as its
// own.
//
// Streets are laid at the scale of the streets round them: straight
// stretches of 140 to 320 m, bending a little where one meets the next (as
// a street does at a junction), never in long sweeping curves. Each keeps
// well away from any street running the same way, and from the greenway
// at the land's edge, where half its catchment would be lost.

import { rngFor } from '../core/rng.js';
import { keyInts } from './cores.js';
import { lineBox, piecesOf } from './boulevards.js';
import { pointInPolygon } from '../util/geom.js';

export const MAIN_STREET_REACH = 600; // most land is this close to a main street (the rest has its tram stops)

const CELL = 50; // metres: the district's land raster
const LEG = [140, 320]; // metres: a straight stretch of main street
const KINK = (28 * Math.PI) / 180; // the most a street bends where one stretch meets the next
const WANDER = (9 * Math.PI) / 180; // how far a street left to itself drifts, stretch to stretch
const CURL = (100 * Math.PI) / 180; // nor turns more than this within CURL_SPAN
const CURL_SPAN = 600;
const GAP = 400; // metres: closest a street may run alongside another going the same way
const RAIL_GAP = 90; // and alongside the rail above ground
const EDGE_GAP = 250; // and alongside the greenway at the land's edge
const PARALLEL = 0.85; // |cos| above which two streets run the same way
const T_SIN = 0.6; // a street meets another at no shallower an angle than this (about 37°)
const JUNCTION_GAP = 90; // metres between junctions on a street
const THROUGH = 40; // a street meets another only where it carries on this far both ways
const STATION_CLEAR = 150; // metres a street keeps its junctions from the station
const STUB = 120; // metres straight in from a gateway before turning
const GATE_CONE = (50 * Math.PI) / 180; // a gateway ahead within this of a street's heading draws it on
const GATE_REACH = 1700; // metres
const INNER_MAX = 3000; // metres an inward half may run to meet a street
const OUTER_MAX = 1500; // and an outward half before it gives up on its own and turns in
const EDGE_RUN = 400; // metres a street ending at the land's edge may run on to the greenway's line
const ROUND = 16; // metres either side of a bend rounded off
const STEP = 20; // metres between points of a finished street
const PROBE = 10; // metres between the spots a stretch is tested at
const BUCKET = 200;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (v) => Math.hypot(v[0], v[1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const unit = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};
const rot = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
const angleOf = (v) => Math.atan2(v[1], v[0]);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function segDist(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  return len(sub(add(a, mul(ab, t)), p));
}
// Where segments ab and cd cross: [t along ab, u along cd], or null.
function segCross(a, b, c, d) {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [t, u] : null;
}

export function createMainStreets(seed) {
  // Everything for one district. `grid` is the district's land raster (with
  // each cell's neighbourhood as first grown); `crossings` lists greenway
  // crossings with their inward normals.
  return function build(d, hoods, _chains, grid, crossings) {
    const rng = rngFor(seed, 'main-streets', ...keyInts(d.coreInfo));
    const S = d.station;
    const LAND = 1;
    const isLand = (q) => {
      const n = grid.cellOf(q[0], q[1]);
      return n >= 0 && grid.mask[n] === LAND;
    };

    // ---- Street segments, hashed ----
    // Each: { a, b, u, line, s } (s: distance along its line at a).
    const segs = [];
    const buckets = new Map();
    const keysOf = (ax, ay, bx, by, pad) => {
      const out = [];
      for (let j = Math.floor((Math.min(ay, by) - pad) / BUCKET); j <= Math.floor((Math.max(ay, by) + pad) / BUCKET); j++) {
        for (let i = Math.floor((Math.min(ax, bx) - pad) / BUCKET); i <= Math.floor((Math.max(ax, bx) + pad) / BUCKET); i++) out.push(i * 1e6 + j);
      }
      return out;
    };
    const index = (list, map, a, b, extra) => {
      const k = list.length;
      list.push({ a, b, u: unit(sub(b, a)), ...extra });
      for (const key of keysOf(a[0], a[1], b[0], b[1], 0)) {
        let bk = map.get(key);
        if (!bk) map.set(key, (bk = []));
        bk.push(k);
      }
    };
    const near = (list, map, p, r) => {
      const out = new Set();
      for (const key of keysOf(p[0], p[1], p[0], p[1], r)) for (const k of map.get(key) || []) out.add(k);
      return [...out].map((k) => list[k]);
    };
    // Lines: { id, pts, L, closed }.
    const lines = new Map();
    const addLine = (id, pts, closed = false) => {
      let s = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        index(segs, buckets, pts[i], pts[i + 1], { line: id, s });
        s += len(sub(pts[i + 1], pts[i]));
      }
      lines.set(id, { id, pts, L: s, closed });
    };
    d.network.lines.forEach((l, k) => {
      const P = l.points;
      addLine(-1 - k, P, len(sub(P[0], P[P.length - 1])) < 1);
    });
    // The greenway's line at the land's edge, and the rail above ground.
    const edgeSegs = [];
    const edgeBuckets = new Map();
    for (const r of d.rings) for (let i = 0; i < r.length; i++) index(edgeSegs, edgeBuckets, r[i], r[(i + 1) % r.length], {});
    const railSegs = [];
    const railBuckets = new Map();
    for (const L of grid.rail || []) for (let i = 0; i < L.length - 1; i++) index(railSegs, railBuckets, L[i], L[i + 1], {});

    // Junctions so far, to keep new ones apart.
    const junctions = [S];
    for (const l of d.network.lines) junctions.push(l.points[0], l.points[l.points.length - 1]);
    const nearJunction = (p, r) => junctions.some((q) => len(sub(q, p)) < r);

    // Is a street running the same way as `dir` within `gap` of p (other
    // than lines in `own`)? Or the rail above ground, or the land's edge?
    function crowded(p, dir, gap, own) {
      for (const g of near(segs, buckets, p, gap)) {
        if (own.has(g.line) || Math.abs(dot(g.u, dir)) < PARALLEL) continue;
        if (segDist(p, g.a, g.b) < gap) return 'street';
      }
      for (const g of near(railSegs, railBuckets, p, RAIL_GAP)) if (Math.abs(dot(g.u, dir)) >= PARALLEL && segDist(p, g.a, g.b) < RAIL_GAP) return 'rail';
      for (const g of near(edgeSegs, edgeBuckets, p, EDGE_GAP)) if (Math.abs(dot(g.u, dir)) >= PARALLEL && segDist(p, g.a, g.b) < EDGE_GAP) return 'edge';
      return null;
    }
    // The first street (not in `own`) segment ab crosses, if any.
    function firstHit(a, b, own) {
      let best = null;
      for (const g of near(segs, buckets, a, len(sub(b, a)) + 1)) {
        if (own.has(g.line)) continue;
        const h = segCross(a, b, g.a, g.b);
        if (!h || (best && h[0] >= best.t)) continue;
        best = { t: h[0], p: add(a, mul(sub(b, a), h[0])), g, s: g.s + len(sub(g.b, g.a)) * h[1] };
      }
      return best;
    }
    // May a street end there, in a T: at a fair angle, the street it meets
    // carrying on past it both ways, clear of other junctions and the station?
    function fairT(hit, dir) {
      if (Math.abs(cross(hit.g.u, dir)) < T_SIN) return false;
      const l = lines.get(hit.g.line);
      if (!l.closed && (hit.s < THROUGH || hit.s > l.L - THROUGH)) return false;
      if (nearJunction(hit.p, JUNCTION_GAP) || len(sub(hit.p, S)) < STATION_CLEAR) return false;
      return true;
    }

    // ---- Laying a street ----
    // From p, heading `dir`: straight stretches, each bending a little from
    // the last, drawn towards `target` if given (and drifting gently if
    // not), until it meets a street it may end on in a T, reaches the
    // target, or runs out of land. `aim` draws it towards a point without
    // making that point its end. Returns { pts, end, hit }.
    function lay(p, dir, { own = new Set(), target = null, aim = null, pull = 0.35, max = INNER_MAX, gap = GAP, quiet = 100 } = {}) {
      const pts = [p];
      const heads = [{ s: 0, a: angleOf(dir) }];
      let cur = p;
      let h = dir;
      let travelled = 0;
      while (travelled < max) {
        let L = rng.range(LEG[0], LEG[1]);
        let want;
        let final = false;
        if (target) {
          const r = len(sub(target, cur));
          want = unit(sub(target, cur));
          if (r < L * 1.4) {
            L = r;
            final = true;
          }
        } else {
          want = rot(h, rng.range(-WANDER, WANDER));
          if (aim) want = unit(add(mul(want, 1 - pull), mul(unit(sub(aim, cur)), pull)));
        }
        // The bend from the last stretch, within KINK; failing that a
        // little more either way, to get round what is in the way.
        const base = Math.max(-KINK, Math.min(KINK, wrap(angleOf(want) - angleOf(h))));
        const tries = final ? [base] : [base, base + KINK * 0.6, base - KINK * 0.6, base + KINK, base - KINK].filter((t) => Math.abs(t) <= KINK * 1.3);
        let took = null;
        for (const turn of tries) {
          const v = rot(h, turn);
          // No curling round.
          const a = heads[heads.length - 1].a + turn;
          const back = heads.filter((x) => x.s >= travelled - CURL_SPAN);
          if (back.some((x) => Math.abs(a - x.a) > CURL)) continue;
          const r = probe(cur, v, L, own, gap, travelled < quiet || (target && len(sub(target, cur)) < 200));
          if (r.kind === 'blocked' || r.kind === 'crowded') continue;
          took = { v, r, a };
          break;
        }
        if (!took) return { pts, end: 'blocked' };
        const { v, r, a } = took;
        if (r.kind === 'hit') {
          pts.push(r.hit.p);
          return { pts, end: 'hit', hit: r.hit };
        }
        if (r.kind === 'edge') {
          // The land's raster stops short of the greenway: straight on to
          // its line (or a park's edge), if that is near.
          const tip = toEdge(r.at, v);
          if (!tip) return { pts, end: 'blocked' };
          if (len(sub(tip, cur)) > 5) pts.push(tip);
          return { pts, end: 'edge' };
        }
        const next = add(cur, mul(v, L));
        pts.push(next);
        travelled += L;
        heads.push({ s: travelled, a });
        cur = next;
        h = v;
        if (final) return { pts, end: 'target' };
      }
      return { pts, end: 'long' };
    }
    // From p along v to the greenway's line, or the edge of a park, within
    // EDGE_RUN; null if neither is there (water, say), or a street is met.
    function toEdge(p, v) {
      for (let r = 0; r <= EDGE_RUN; r += 5) {
        const q = add(p, mul(v, r));
        let inside = false;
        for (const ring of d.rings) if (pointInPolygon(q[0], q[1], ring)) inside = !inside;
        if (!inside || d.parks.some((pk) => pointInPolygon(q[0], q[1], pk.shape))) return r ? add(p, mul(v, r - 5)) : p;
        if (r && firstHit(add(p, mul(v, r - 5)), q, new Set())) return null;
      }
      return null;
    }
    // What a stretch from p along v for L metres runs into.
    function probe(p, v, L, own, gap, quiet) {
      const n = Math.max(1, Math.ceil(L / PROBE));
      let last = p;
      for (let k = 1; k <= n; k++) {
        const q = add(p, mul(v, (L * k) / n));
        const hit = firstHit(last, q, own);
        if (hit) return fairT(hit, v) ? { kind: 'hit', hit } : { kind: 'blocked' };
        if (!isLand(q)) return { kind: 'edge', at: last };
        if (!quiet && k % 2 === 0 && crowded(q, v, gap, own)) return { kind: 'crowded' };
        last = q;
      }
      return { kind: 'free' };
    }

    // ---- Each neighbourhood's own street ----
    const out = [];
    let nextId = 1;
    const usedGates = new Set();
    // Gateways, with a point a stub in from each.
    const gates = crossings.map((x) => ({ x, in: add(x.p, mul(x.n, STUB)) }));
    // The way each neighbourhood's land runs (its long axis, from its cells).
    const axisOf = new Map();
    {
      const acc = hoods.map(() => [0, 0, 0, 0, 0, 0]);
      for (let n = 0; n < grid.N; n++) {
        const k = grid.label[n];
        if (k < 0 || !hoods[k]) continue;
        const x = grid.x0 + ((n % grid.W) + 0.5) * CELL;
        const y = grid.y0 + (Math.floor(n / grid.W) + 0.5) * CELL;
        const a = acc[k];
        a[0]++;
        a[1] += x;
        a[2] += y;
        a[3] += x * x;
        a[4] += y * y;
        a[5] += x * y;
      }
      acc.forEach((a, k) => {
        if (!a[0]) return;
        const mx = a[1] / a[0];
        const my = a[2] / a[0];
        const sxx = a[3] / a[0] - mx * mx;
        const syy = a[4] / a[0] - my * my;
        const sxy = a[5] / a[0] - mx * my;
        const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        axisOf.set(k, { u: [Math.cos(th), Math.sin(th)], spread: Math.sqrt(Math.max(1, (sxx + syy) / 2)) });
      });
    }
    // Finish a line: its corners rounded off (but not at its junctions or
    // the centre it was laid from), and points every STEP metres.
    function finish(raw, keep) {
      const P = [raw[0]];
      for (let i = 1; i < raw.length - 1; i++) {
        const a = raw[i - 1];
        const b = raw[i];
        const c = raw[i + 1];
        const turn = Math.abs(wrap(angleOf(sub(c, b)) - angleOf(sub(b, a))));
        const r = Math.min(ROUND, len(sub(b, a)) / 3, len(sub(c, b)) / 3);
        if (turn < 0.03 || r < 4 || keep.some((q) => len(sub(q, b)) < 1e-6)) {
          P.push(b);
          continue;
        }
        const p0 = add(b, mul(unit(sub(a, b)), r));
        const p1 = add(b, mul(unit(sub(c, b)), r));
        for (let t = 0; t <= 1.0001; t += 0.25) P.push(add(add(mul(p0, (1 - t) * (1 - t)), mul(b, 2 * t * (1 - t))), mul(p1, t * t)));
      }
      P.push(raw[raw.length - 1]);
      const pts = [P[0]];
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1];
        const b = P[i];
        const l = len(sub(b, a));
        if (l < 1e-6) continue;
        const n = Math.ceil(l / STEP);
        for (let k = 1; k < n; k++) pts.push(add(a, mul(sub(b, a), k / n)));
        pts.push(b);
      }
      return pts;
    }
    // Commit a line laid as raw vertices: its junctions noted, its
    // segments indexed so later streets see it.
    function commit(raw, extra = {}, keep = []) {
      const id = nextId++;
      const ends = [raw[0], raw[raw.length - 1]];
      const pts = finish(raw, keep.concat(ends));
      addLine(id, pts);
      for (const e of ends) if (!extra.crossing || e !== raw[0]) junctions.push(e);
      const l = { id, pts, ...extra };
      out.push(l);
      return l;
    }

    // The core neighbourhood is the station's; a neighbourhood a boulevard
    // runs through has it. The rest, nearest the core first.
    const order = hoods.filter((h) => !h.core && !h.onBoulevard).sort((a, b) => len(sub(a.seed, S)) - len(sub(b.seed, S)) || a.id - b.id);
    const spineOf = new Map();
    for (const h of order) {
      const c = h.seed;
      const ax = axisOf.get(h.id) || { u: unit(sub(S, c)), spread: 300 };
      const toCore = unit(sub(S, c));
      // Directions to try, round its long axis, best first: along the
      // axis, clear of streets going the same way and of the edge, and
      // leaning towards the core.
      const cands = [];
      for (let k = -6; k <= 6; k++) {
        let v = rot(ax.u, (k * Math.PI) / 12);
        if (dot(v, toCore) < 0) v = mul(v, -1);
        let score = -Math.abs(k) * 0.25 + 0.5 * dot(v, toCore);
        for (const sg of [1, -1]) {
          for (const r of [150, 350, 550]) {
            const q = add(c, mul(v, sg * r));
            const why = crowded(q, v, GAP, new Set());
            if (why) score -= why === 'edge' ? 0.7 : 1;
          }
        }
        cands.push({ v, score: score + rng.next() * 0.2 });
      }
      cands.sort((a, b) => b.score - a.score);
      let made = null;
      for (const { v } of cands.slice(0, 6)) {
        const own = new Set();
        // Inward: towards the core, to the first street it may meet.
        const inner = lay(c, v, { own, aim: S, pull: 0.3 });
        if (inner.end !== 'hit') continue;
        // Outward: to a gateway ahead, if there is one free.
        const away = mul(v, -1);
        let gate = null;
        for (const g of gates) {
          if (usedGates.has(g.x.key)) continue;
          const to = sub(g.in, c);
          const r = len(to);
          if (r > GATE_REACH || r < 200 || Math.acos(Math.max(-1, Math.min(1, dot(unit(to), away)))) > GATE_CONE || dot(g.x.n, unit(to)) > -0.2) continue;
          if (!gate || r < gate.r) gate = { g, r };
        }
        let outer = null;
        if (gate) {
          const o = lay(c, away, { own, target: gate.g.in, gap: GAP * 0.8 });
          if (o.end === 'target') outer = { pts: o.pts.concat([gate.g.x.p]), end: 'gate', gate: gate.g };
        }
        if (!outer) {
          const o = lay(c, away, { own, max: OUTER_MAX });
          if (o.end === 'hit' || o.end === 'edge') outer = o;
          else {
            // Left to itself it met nothing: it turns in to the nearest
            // street ahead instead.
            const tip = o.pts[o.pts.length - 1];
            const fwd = o.pts.length > 1 ? unit(sub(tip, o.pts[o.pts.length - 2])) : away;
            let best = null;
            for (const g of near(segs, buckets, tip, 1200)) {
              const f = add(g.a, mul(sub(g.b, g.a), 0.5));
              const to = sub(f, tip);
              if (dot(unit(to), fwd) < 0.1) continue;
              const r = len(to);
              if (!best || r < best.r) best = { r, f };
            }
            if (best) {
              const o2 = lay(tip, fwd, { own, aim: best.f, pull: 0.8, max: 1600, quiet: 1e9 });
              if (o2.end === 'hit' || o2.end === 'edge') outer = { pts: o.pts.concat(o2.pts.slice(1)), end: o2.end, hit: o2.hit };
            }
          }
        }
        if (!outer) continue;
        made = { inner, outer };
        break;
      }
      if (!made) continue;
      const raw = made.inner.pts.slice().reverse().concat(made.outer.pts.slice(1));
      const extra = { hood: h.id, serves: [h.id] };
      if (made.outer.end === 'gate') {
        extra.crossingEnd = made.outer.gate.x.key;
        usedGates.add(made.outer.gate.x.key);
      }
      if (made.outer.end === 'edge') extra.edgeEnd = true;
      const l = commit(raw, extra, [c]);
      spineOf.set(h.id, l);
    }

    // ---- Gateways no street reached ----
    for (const g of gates) {
      if (usedGates.has(g.x.key)) continue;
      const own = new Set();
      // Straight in, then on towards the nearest neighbourhood centre (or
      // the core), to the first street met.
      let aim = S;
      let br = Infinity;
      for (const h of hoods) {
        const r = len(sub(h.seed, g.in));
        if (r < br && dot(unit(sub(h.seed, g.in)), g.x.n) > 0.2) [br, aim] = [r, h.seed];
      }
      // (A street running right by it already: in to that.)
      const stub = firstHit(g.x.p, g.in, own);
      if (stub) {
        usedGates.add(g.x.key);
        // (Unless it runs right through it: a boulevard carrying on.)
        if (len(sub(stub.p, g.x.p)) > 5) commit([g.x.p, stub.p], { crossing: g.x.key });
        continue;
      }
      // (Failing that, more strongly towards the core, or the nearest
      // street ahead.)
      let ahead = null;
      for (const sg of near(segs, buckets, g.in, 1500)) {
        const f = add(sg.a, mul(sub(sg.b, sg.a), 0.5));
        if (dot(unit(sub(f, g.in)), g.x.n) < 0.2) continue;
        if (!ahead || len(sub(f, g.in)) < len(sub(ahead, g.in))) ahead = f;
      }
      let o = null;
      for (const [to, pull, quiet] of [[aim, 0.3, 0], [aim, 0.6, 1e9], [S, 0.6, 1e9], [ahead, 0.85, 1e9]]) {
        if (!to) continue;
        const r = lay(g.in, g.x.n, { own, aim: to, pull, quiet });
        if (r.end === 'hit') {
          o = r;
          break;
        }
      }
      // Last of all, straight to the foot of the nearest street ahead.
      if (!o) {
        let foot = null;
        for (const sg of near(segs, buckets, g.in, 1500)) {
          const ab = sub(sg.b, sg.a);
          const t = Math.max(0.05, Math.min(0.95, dot(sub(g.in, sg.a), ab) / (dot(ab, ab) || 1)));
          const f = add(sg.a, mul(ab, t));
          if (dot(unit(sub(f, g.in)), g.x.n) < 0) continue;
          if (!foot || len(sub(f, g.in)) < len(sub(foot, g.in))) foot = f;
        }
        if (foot) {
          const r = lay(g.in, unit(sub(foot, g.in)), { own, target: foot, quiet: 1e9 });
          if (r.end === 'hit' || r.end === 'target') o = r;
        }
      }
      if (!o) continue;
      usedGates.add(g.x.key);
      commit([g.x.p, ...o.pts], { crossing: g.x.key });
    }

    // ---- Neighbourhood centres on their streets ----
    const allLines = out.map((l) => l.pts).concat(d.network.lines.filter((l) => l.kind !== 'roundabout').map((l) => l.points));
    for (const h of hoods) {
      if (h.core) {
        h.spine = null;
        continue;
      }
      const own = spineOf.get(h.id);
      if (own) {
        h.centre = h.seed;
        h.spine = own.pts;
        continue;
      }
      // On a boulevard, or with no street of its own: the nearest street point.
      let best = null;
      for (const P of allLines) {
        for (const q of P) {
          const r = len(sub(q, h.seed));
          if (!best || r < best.r) best = { r, q, P };
        }
      }
      if (best) {
        h.centre = best.q;
        h.spine = best.P;
      }
    }

    // ---- Out ----
    const result = out.map((l) => ({
      key: `${d.key}:m${l.id}`,
      id: l.id,
      kind: l.crossing ? 'crossing' : 'street',
      crossing: l.crossing || null,
      parkStart: null,
      crossingEnd: l.crossingEnd || null,
      parkEnd: null,
      edgeEnd: !!l.edgeEnd,
      serves: hoods.filter((h) => !h.core && l.pts.some((q) => len(sub(q, h.centre)) < 1e-6)).map((h) => h.id),
      points: l.pts,
      bbox: lineBox(l.pts),
      pieces: piecesOf(l.pts),
    }));
    return { lines: result };
  };
}
