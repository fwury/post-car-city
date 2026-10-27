// Main streets of a district: an organic grid.
//
// Main streets are traced through a field of directions: two families of
// streets crossing at right angles, the field turning slowly across the
// district (so the grid bends and wanders as an old grid does), running
// along the boulevards and the greenway at the land's edge near them, and
// straight in from each gateway into the next district. Following it, main
// streets meet each other square on, or nearly.
//
// The gateways' streets are laid first, each in from its gateway to the
// first street it meets. Then, from points along every street (nearest the
// district's centre first), side streets run off at right angles, one every
// GRID metres or so, wherever no street already runs that way near by. A
// street ends where it meets another at a fair angle (in a T, or it crosses
// straight on), at the land's edge if it meets it square on, or short of a
// street running the same way; one left with a loose end is carried on to
// the street ahead, or cut back to its last junction. So no two run side by
// side closer than GAP, none runs along the land's edge, and every spot
// lies within about half the grid's spacing of one: within a short walk of
// a tram stop.
//
// Each neighbourhood is then centred on the main street nearest its first
// centre: that street runs down its middle, and its land grows out from it.

import { rngFor } from '../core/rng.js';
import { createNoise } from '../core/noise.js';
import { hash, toUnit } from '../core/hash.js';
import { keyInts } from './cores.js';
import { lineBox, piecesOf } from './boulevards.js';
import { pointInPolygon } from '../util/geom.js';

export const MAIN_STREET_REACH = 450; // most land is this close to a main street
export const GRID = 650; // metres between neighbouring main streets running the same way, about
export const GAP = 500; // metres: closest a street may run alongside another going the same way

const CELL = 50; // metres: the district's land raster
const STEP = 20; // metres between points of a street as traced
const TURN = (3 * Math.PI) / 180; // the most a street turns in one step
const FIELD_SCALE = 3200; // metres over which the grid's direction wanders
const FIELD_TURN = Math.PI / 3; // and how far
const BLVD_FALL = 450; // metres over which a boulevard's direction takes hold
const EDGE_FALL = 350; // and the land's edge's
const GATE_FALL = 300; // and a gateway's
const RAIL_GAP = 90; // metres: closest a street may run alongside the rail above ground
const EDGE_GAP = 250; // and alongside the greenway at the land's edge
const PARALLEL = 0.8; // |cos| above which two streets run the same way (within about 37°)
const FAIR = Math.sin((60 * Math.PI) / 180); // streets meet at 60° or more
const JUNCTION_GAP = 120; // metres between junctions on a street
const THROUGH = 60; // a street meets another only where it carries on this far both ways
const STATION_CLEAR = 120; // metres a street keeps its junctions from the station (but for a boulevard's)
const STUB = 120; // metres straight in from a gateway before following the grid
const QUIET = 150; // metres from its start a street is not stopped for running near another
const GATE_QUIET = 400; // (a gateway's, from the greenway it crosses)
const SEED_JOG = 220; // metres along a street a side street keeps from another's junction (but for one straight across)
const SEED_STEP = 100; // metres between the spots along a street a side street may start from
const SEED_CLEAR = 580; // metres a side street starts from a street running its way (so about GRID apart)
const MAX_RUN = 4000; // metres a street may run
const REACH_ON = 320; // metres a loose end may be carried on to meet a street
const GATE_LINK = 700; // and a gateway's street, to the nearest street ahead
const EDGE_RUN = 300; // metres a street ending at the land's edge may run on to the greenway's line
const ROUND = 16; // metres either side of a bend rounded off
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

// How far p lies beside segment ab: square off it, within its length
// (Infinity if p lies beyond either end).
function besideDist(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (!l2) return Infinity;
  const t = dot(sub(p, a), ab) / l2;
  // (A little past its ends, for the outside of a bend: a street lined up
  // end to end with it lies far beyond.)
  return t < -0.6 || t > 1.6 ? Infinity : Math.abs(cross(ab, sub(p, a))) / Math.sqrt(l2);
}
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
  const wander = createNoise(seed, 'main-street-grid');
  // Everything for one district. `grid` is the district's land raster;
  // `crossings` lists greenway crossings with their inward normals.
  return function build(d, hoods, _chains, grid, crossings) {
    const rng = rngFor(seed, 'main-streets', ...keyInts(d.coreInfo));
    const S = d.station;
    const LAND = 1;
    const isLand = (q) => {
      const n = grid.cellOf(q[0], q[1]);
      return n >= 0 && grid.mask[n] === LAND;
    };

    // ---- Segments, hashed ----
    const keysOf = (ax, ay, bx, by, pad) => {
      const out = [];
      for (let j = Math.floor((Math.min(ay, by) - pad) / BUCKET); j <= Math.floor((Math.max(ay, by) + pad) / BUCKET); j++) {
        for (let i = Math.floor((Math.min(ax, bx) - pad) / BUCKET); i <= Math.floor((Math.max(ax, bx) + pad) / BUCKET); i++) out.push(i * 1e6 + j);
      }
      return out;
    };
    const makeIndex = () => {
      const list = [];
      const map = new Map();
      return {
        list,
        add(a, b, extra) {
          const k = list.length;
          list.push({ a, b, u: unit(sub(b, a)), ...extra });
          for (const key of keysOf(a[0], a[1], b[0], b[1], 0)) {
            let bk = map.get(key);
            if (!bk) map.set(key, (bk = []));
            bk.push(k);
          }
        },
        near(p, r) {
          const out = new Set();
          for (const key of keysOf(p[0], p[1], p[0], p[1], r)) for (const k of map.get(key) || []) out.add(k);
          return [...out].map((k) => list[k]);
        },
      };
    };
    const streets = makeIndex(); // { a, b, u, line, s }
    const dropped = new Set(); // streets given up
    const edges = makeIndex();
    const rails = makeIndex();
    for (const r of d.rings) for (let i = 0; i < r.length; i++) edges.add(r[i], r[(i + 1) % r.length]);
    for (const L of grid.rail || []) for (let i = 0; i < L.length - 1; i++) rails.add(L[i], L[i + 1]);

    // Lines: { id, pts, L, closed, junctions: [{ s, line }], boulevard }.
    const lines = new Map();
    const addLine = (id, pts, extra = {}) => {
      let s = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        streets.add(pts[i], pts[i + 1], { line: id, s });
        s += len(sub(pts[i + 1], pts[i]));
      }
      const l = { id, pts, L: s, junctions: [], ...extra };
      lines.set(id, l);
      return l;
    };
    const blvds = d.network.lines.filter((l) => l.kind !== 'roundabout');
    blvds.forEach((l, k) => {
      const P = l.points;
      addLine(-1 - k, P, { boulevard: true, closed: len(sub(P[0], P[P.length - 1])) < 1 });
    });
    // (The boulevards' own junctions, kept clear like any other.)
    for (const q of d.network.junctions || []) {
      for (const g of streets.near(q, 3)) {
        if (segDist(q, g.a, g.b) > 3) continue;
        const l = lines.get(g.line);
        const sq = g.s + len(sub(q, g.a));
        if (!l.junctions.some((j) => Math.abs(j.s - sq) < 1)) l.junctions.push({ s: sq, line: 0 });
      }
    }

    // ---- The field ----
    // Each source of direction as a weight and an angle; the grid's two
    // families are a quarter turn apart, so angles are summed at four times.
    const base = toUnit(hash(seed, 'grid-angle', ...keyInts(d.coreInfo))) * Math.PI;
    const gates = crossings.map((x) => ({ x, in: add(x.p, mul(x.n, STUB)) }));
    const fieldCache = new Map();
    function fieldAngle(p) {
      const key = Math.round(p[0] / 25) * 1e6 + Math.round(p[1] / 25);
      let a = fieldCache.get(key);
      if (a !== undefined) return a;
      const a0 = base + FIELD_TURN * wander.fbm(p[0] / FIELD_SCALE, p[1] / FIELD_SCALE, 2);
      let cx = Math.cos(4 * a0) * 0.6;
      let cy = Math.sin(4 * a0) * 0.6;
      const pull = (ang, w) => {
        cx += w * Math.cos(4 * ang);
        cy += w * Math.sin(4 * ang);
      };
      for (const g of streets.near(p, BLVD_FALL * 2)) {
        if (!lines.get(g.line).boulevard) continue;
        const r = segDist(p, g.a, g.b);
        pull(angleOf(g.u), 3 * Math.exp(-((r / BLVD_FALL) ** 2)));
      }
      for (const g of edges.near(p, EDGE_FALL * 2)) {
        const r = segDist(p, g.a, g.b);
        pull(angleOf(g.u), 1.2 * Math.exp(-((r / EDGE_FALL) ** 2)));
      }
      for (const g of gates) {
        const r = len(sub(p, g.x.p));
        if (r < GATE_FALL * 2.5) pull(angleOf(g.x.n), 4 * Math.exp(-((r / GATE_FALL) ** 2)));
      }
      a = Math.atan2(cy, cx) / 4;
      fieldCache.set(key, a);
      return a;
    }
    // The way on from p for a street heading h: the field's direction
    // nearest it.
    function fieldDir(p, h) {
      const a = fieldAngle(p);
      let best = null;
      for (let k = 0; k < 4; k++) {
        const v = [Math.cos(a + (k * Math.PI) / 2), Math.sin(a + (k * Math.PI) / 2)];
        if (!best || dot(v, h) > dot(best, h)) best = v;
      }
      return best;
    }

    // ---- Tests along a street ----
    // A street running the same way within `gap` of p (other than `own`)?
    // Or the rail above ground, or the land's edge?
    function crowded(p, dir, gap, own) {
      // (Beside it, that is: not a street lined up end to end with it.)
      for (const g of streets.near(p, gap)) {
        if (g.line === own || dropped.has(g.line) || Math.abs(dot(g.u, dir)) < PARALLEL) continue;
        if (besideDist(p, g.a, g.b) < gap) return 'street';
      }
      for (const g of rails.near(p, RAIL_GAP)) if (Math.abs(dot(g.u, dir)) >= PARALLEL && besideDist(p, g.a, g.b) < RAIL_GAP) return 'rail';
      for (const g of edges.near(p, EDGE_GAP)) if (Math.abs(dot(g.u, dir)) >= PARALLEL && besideDist(p, g.a, g.b) < EDGE_GAP) return 'edge';
      return null;
    }
    // The first street (other than `own`) segment ab crosses, if any.
    function firstHit(a, b, own) {
      let best = null;
      for (const g of streets.near(a, len(sub(b, a)) + 1)) {
        if (g.line === own || dropped.has(g.line)) continue;
        const h = segCross(a, b, g.a, g.b);
        if (!h || (best && h[0] >= best.t)) continue;
        best = { t: h[0], p: add(a, mul(sub(b, a), h[0])), g, s: g.s + len(sub(g.b, g.a)) * h[1] };
      }
      return best;
    }
    // May a street meet another there: square on enough, the other running
    // on past it both ways, clear of its other junctions and the station?
    function fair(hit, dir) {
      if (Math.abs(cross(hit.g.u, dir)) < FAIR) return false;
      const l = lines.get(hit.g.line);
      if (!l.closed && (hit.s < THROUGH || hit.s > l.L - THROUGH)) return false;
      if (l.junctions.some((j) => Math.abs(j.s - hit.s) < JUNCTION_GAP)) return false;
      if (len(sub(hit.p, S)) < STATION_CLEAR && !l.boulevard) return false;
      return true;
    }

    // ---- Tracing a street ----
    // From p heading h, along the field (straight for `straight` metres
    // first), until it meets a street fairly (ending there, or crossing on
    // if `through` and there is room beyond), reaches the land's edge square
    // on, runs near a street going its way, or runs too long. Returns
    // { pts, end, hits: [{ hit, s }] } (s: distance along this street).
    function trace(p, h, { own, straight = 0, through = true, max = MAX_RUN, quiet = QUIET }) {
      const pts = [p];
      const hits = [];
      let cur = p;
      let dir = h;
      let run = 0;
      while (run < max) {
        let want = run < straight ? dir : fieldDir(cur, dir);
        const turn = Math.max(-TURN, Math.min(TURN, wrap(angleOf(want) - angleOf(dir))));
        dir = rot(dir, turn);
        const next = add(cur, mul(dir, STEP));
        const hit = firstHit(cur, next, own);
        if (hit) {
          if (!fair(hit, dir)) return { pts, end: 'blocked', hits };
          pts.push(hit.p);
          hits.push({ hit, s: run + len(sub(hit.p, cur)) });
          // On across it, if the far side has room for a street.
          const beyond = add(hit.p, mul(dir, 3 * STEP));
          if (!through || !isLand(beyond) || crowded(add(hit.p, mul(dir, STEP * 6)), dir, GAP, own) || firstHit(add(hit.p, mul(dir, 0.5)), beyond, own)) return { pts, end: 'hit', hits };
          // (Just past it, so as not to meet it again.)
          run += len(sub(hit.p, cur)) + 0.5;
          cur = add(hit.p, mul(dir, 0.5));
          continue;
        }
        // (A gateway's street starts out on the greenway: in to the land.)
        if (!isLand(next) && run < straight && !pts.slice(1).some(isLand)) {
          pts.push(next);
          run += STEP;
          cur = next;
          continue;
        }
        if (!isLand(next)) {
          // The land's edge: on to the greenway's line (or a park's edge),
          // if met square on.
          const edge = edges.near(next, 60).find((g) => segDist(next, g.a, g.b) < 120);
          if (edge && Math.abs(cross(edge.u, dir)) < FAIR * 0.9) return { pts, end: 'blocked', hits };
          const tip = toEdge(cur, dir, own);
          if (!tip) return { pts, end: 'blocked', hits };
          if (len(sub(tip, cur)) > 3) pts.push(tip);
          return { pts, end: 'edge', hits };
        }
        if (run > quiet) {
          const cw = crowded(next, dir, GAP, own);
          if (cw) {
            return { pts, end: 'crowded', hits };
          }
        }
        pts.push(next);
        run += STEP;
        cur = next;
      }
      return { pts, end: 'long', hits };
    }
    // From p along v to the greenway's line, or the edge of a park, within
    // EDGE_RUN; null if neither is there (water, say), or a street is met.
    function toEdge(p, v, own) {
      for (let r = 0; r <= EDGE_RUN; r += 5) {
        const q = add(p, mul(v, r));
        let inside = false;
        for (const ring of d.rings) if (pointInPolygon(q[0], q[1], ring)) inside = !inside;
        if (!inside || d.parks.some((pk) => pointInPolygon(q[0], q[1], pk.shape))) return r ? add(p, mul(v, r - 5)) : p;
        if (r && firstHit(add(p, mul(v, r - 5)), q, own)) return null;
      }
      return null;
    }

    // ---- Laying the streets ----
    let nextId = 1;
    const made = [];
    // Note the junctions a traced street makes, on both streets.
    function lay(t, start, extra = {}) {
      const id = nextId++;
      const l = { id, raw: t.pts, end: t.end, start, hits: t.hits, ...extra };
      made.push(l);
      // (Indexed now, so later streets see it; finished at the end.)
      addLine(id, t.pts);
      const me = lines.get(id);
      if (start) {
        me.junctions.push({ s: 0, line: start.g.line });
        lines.get(start.g.line).junctions.push({ s: start.s, line: id });
      }
      for (const { hit, s } of t.hits) {
        me.junctions.push({ s, line: hit.g.line });
        lines.get(hit.g.line).junctions.push({ s: hit.s, line: id });
      }
      return l;
    }

    // The gateways first: straight in, then along the grid, to the first
    // street (or short of one running its way: joined up at the end).
    for (const g of gates) {
      const own = nextId;
      // (A street running right through it already: a boulevard, say.)
      const there = streets.near(g.x.p, 6).find((s) => segDist(g.x.p, s.a, s.b) < 5);
      if (there) continue;
      const t = trace(g.x.p, g.x.n, { own, straight: STUB, through: false, quiet: GATE_QUIET });
      lay(t, null, { crossing: g.x.key });
    }
    // Side streets off every street, centre outward.
    const seeds = [];
    const seedsAlong = (id) => {
      const l = lines.get(id);
      const P = l.pts;
      let s = 0;
      let next = SEED_STEP / 2 + rng.range(0, SEED_STEP / 2);
      for (let i = 1; i < P.length; i++) {
        const seg = len(sub(P[i], P[i - 1]));
        while (next <= s + seg) {
          const q = add(P[i - 1], mul(sub(P[i], P[i - 1]), (next - s) / seg));
          const u = unit(sub(P[i], P[i - 1]));
          for (const side of [1, -1]) seeds.push({ p: q, v: [-u[1] * side, u[0] * side], line: id, s: next, r: len(sub(q, S)) });
          next += SEED_STEP;
        }
        s += seg;
      }
    };
    for (const id of lines.keys()) seedsAlong(id);
    // (And in from the land's edge, square to it, where no street reaches
    // it: these are laid last, the edge being farthest from the centre.)
    for (const r of d.rings) {
      let next = rng.range(0, SEED_STEP);
      let s = 0;
      for (let i = 0; i < r.length; i++) {
        const a = r[i];
        const b = r[(i + 1) % r.length];
        const seg = len(sub(b, a));
        const u = unit(sub(b, a));
        while (next <= s + seg) {
          const q = add(a, mul(sub(b, a), (next - s) / (seg || 1)));
          for (const side of [1, -1]) {
            const v = [-u[1] * side, u[0] * side];
            if (isLand(add(q, mul(v, 80)))) seeds.push({ p: q, v, edge: true, r: len(sub(q, S)) + 1e6 });
          }
          next += SEED_STEP;
        }
        s += seg;
      }
    }
    // Does street `id` leave point p on the side v points to?
    const leavesOn = (id, p, v) => {
      const l = lines.get(id);
      if (!l) return false;
      return l.pts.some((q) => {
        const r = len(sub(q, p));
        return r > 20 && r < 80 && dot(sub(q, p), v) > 0;
      });
    };
    for (let guard = 0; guard < 6000 && seeds.length; guard++) {
      // (Nearest the centre first.)
      let k = 0;
      for (let i = 1; i < seeds.length; i++) if (seeds[i].r < seeds[k].r) k = i;
      const sd = seeds.splice(k, 1)[0];
      if (!sd.edge) {
        const l = lines.get(sd.line);
        if (sd.s < THROUGH || (!l.closed && sd.s > l.L - THROUGH)) continue;
        // Clear of the street's other junctions, but for one right here
        // with a street off the other side: then this carries it on straight
        // across (rather than jogging a little way along).
        const here = l.junctions.filter((j) => Math.abs(j.s - sd.s) < SEED_JOG);
        if (here.some((j) => Math.abs(j.s - sd.s) > 5 || leavesOn(j.line, sd.p, sd.v))) continue;
        if (len(sub(sd.p, S)) < STATION_CLEAR && !l.boulevard) continue;
      }
      // (Square off its street, or the edge, easing onto the grid as it goes.)
      const v = sd.v;
      if (!isLand(add(sd.p, mul(v, 80))) || crowded(add(sd.p, mul(v, 140)), v, SEED_CLEAR, -999)) continue;
      const t = trace(sd.p, v, { own: nextId, straight: sd.edge ? 80 : 60, quiet: sd.edge ? 80 : 40 });
      if (t.pts.length < 4) continue;
      const laid = sd.edge ? lay(t, null, { edgeStart: true }) : lay(t, { g: { line: sd.line }, s: sd.s });
      seedsAlong(laid.id);
      // (Carried on across its street next, if it can be.)
      if (!sd.edge) seeds.push({ ...sd, v: mul(sd.v, -1), r: -1 });
    }

    // A gateway's street must reach the grid: straight on from its tip to
    // the nearest street ahead, met at a fair enough angle, better beside no
    // other street; failing that, more loosely.
    function linkGate(l) {
      const me = lines.get(l.id);
      const P = l.raw;
      const tip = P[P.length - 1];
      const dir = P.length > 1 ? unit(sub(tip, P[P.length - 2])) : [1, 0];
      for (const [reach, ahead, angle] of [[GATE_LINK, 0.3, Math.PI / 4], [GATE_LINK * 1.8, -0.3, Math.PI / 6]]) {
        let best = null;
        for (const g of streets.near(tip, reach)) {
          if (g.line === l.id || dropped.has(g.line)) continue;
          const ab = sub(g.b, g.a);
          const t = Math.max(0.05, Math.min(0.95, dot(sub(tip, g.a), ab) / (dot(ab, ab) || 1)));
          const f = add(g.a, mul(ab, t));
          const to = sub(f, tip);
          const r = len(to);
          if (r < 1 || r > reach || dot(unit(to), dir) < ahead || Math.abs(cross(g.u, unit(to))) < Math.sin(angle)) continue;
          if (firstHit(add(tip, mul(unit(to), 0.5)), add(f, mul(unit(to), -0.5)), l.id)) continue;
          let beside = 0;
          for (let x = 60; x < r - 60; x += 40) if (crowded(add(tip, mul(unit(to), x)), unit(to), GAP * 0.8, l.id) === 'street') beside++;
          const cost = r + beside * 400;
          if (!best || cost < best.cost) best = { r, f, g, s: g.s + len(sub(f, g.a)), cost };
        }
        if (!best) continue;
        P.push(best.f);
        me.L = P.reduce((x, q, i) => (i ? x + len(sub(q, P[i - 1])) : 0), 0);
        me.junctions.push({ s: me.L, line: best.g.line });
        lines.get(best.g.line).junctions.push({ s: best.s, line: l.id });
        streets.add(tip, best.f, { line: l.id, s: me.L - best.r });
        l.end = 'hit';
        return true;
      }
      return false;
    }

    // ---- Loose ends ----
    // A street ending short of another is carried on to the street ahead
    // (at a fair angle) if that is near; else cut back to its last junction,
    // and dropped if that leaves it nothing.
    for (const l of made) {
      if (l.end === 'hit' || l.end === 'edge') continue;
      const me = lines.get(l.id);
      const P = l.raw;
      const tip = P[P.length - 1];
      const dir = P.length > 1 ? unit(sub(tip, P[P.length - 2])) : [1, 0];
      let on = null;
      for (const turn of [0, 0.15, -0.15, 0.3, -0.3]) {
        const v = rot(dir, turn);
        const far = add(tip, mul(v, REACH_ON));
        const hit = firstHit(add(tip, mul(v, 0.5)), far, l.id);
        if (!hit || !fair(hit, v) || !isLand(add(tip, mul(v, Math.min(REACH_ON, len(sub(hit.p, tip))) / 2)))) continue;
        on = hit;
        break;
      }
      if (on) {
        P.push(on.p);
        me.junctions.push({ s: me.L + len(sub(on.p, tip)), line: on.g.line });
        lines.get(on.g.line).junctions.push({ s: on.s, line: l.id });
        streets.add(tip, on.p, { line: l.id, s: me.L });
        me.L += len(sub(on.p, tip));
        l.end = 'hit';
        continue;
      }
      if (l.crossing && linkGate(l)) continue;
      l.end = 'loose';
    }
    // Every street held at both ends: by a gateway or the land's edge, or a
    // junction with a street still there. One that is not is cut back to
    // its outermost junctions with streets still there, or dropped if that
    // leaves too little; which may loosen others in turn.
    const arc = (P) => P.reduce((a, q, i) => (i ? a + len(sub(q, P[i - 1])) : 0), 0);
    const cutTo = (P, s0, s1) => {
      const out = [];
      let s = 0;
      for (let i = 1; i < P.length; i++) {
        const seg = len(sub(P[i], P[i - 1]));
        const at = (x) => add(P[i - 1], mul(sub(P[i], P[i - 1]), Math.max(0, Math.min(1, (x - s) / (seg || 1)))));
        if (!out.length && s + seg >= s0) out.push(at(s0));
        if (s + seg >= s1) {
          out.push(at(s1));
          break;
        }
        if (out.length) out.push(P[i]);
        s += seg;
      }
      return out;
    };
    for (let again = true; again; ) {
      again = false;
      for (const l of made) {
        if (dropped.has(l.id)) continue;
        const me = lines.get(l.id);
        const L = arc(l.raw);
        const live = me.junctions.filter((j) => !dropped.has(j.line) && j.s <= L + 1);
        const held0 = l.crossing || l.edgeStart || live.some((j) => j.s < 1);
        const held1 = l.end === 'edge' || live.some((j) => j.s > L - 1);
        // (Edge to edge, meeting nothing: no street at all.)
        if (!live.length && !l.crossing) {
          dropped.add(l.id);
          again = true;
          continue;
        }
        if (held0 && held1) continue;
        again = true;
        const ss = live.map((j) => j.s);
        const lo = held0 ? 0 : Math.min(...ss);
        const hi = held1 ? L : Math.max(...ss);
        // (A gateway's street is never dropped: linked on again instead.)
        if (l.crossing && !held1 && (!ss.length || hi - lo < THROUGH * 2)) {
          if (!ss.length || hi - lo < THROUGH * 2) {
            l.raw = ss.length ? cutTo(l.raw, 0, hi) : l.raw.slice(0, 2);
            me.junctions = me.junctions.filter((j) => j.s <= hi + 1);
            if (!linkGate(l)) l.end = 'hit';
          }
          continue;
        }
        if (!ss.length || hi - lo < THROUGH * 2 || (!held0 && !held1 && new Set(live.map((j) => j.line)).size < 2)) {
          dropped.add(l.id);
          continue;
        }
        l.raw = cutTo(l.raw, lo, hi);
        for (const j of me.junctions) j.s -= lo;
        if (!held1) l.end = 'hit';
        if (!held0 && l.start) l.start = null;
      }
    }

    // ---- One street straight across ----
    // Two streets meeting end to end where they cross a third, going on
    // straight, are one street across it.
    {
      const kindAt = (l, end) => (end ? (l.end === 'edge' ? 'edge' : 'junction') : l.crossing ? 'gate' : l.edgeStart ? 'edge' : 'junction');
      const away = (P, end) => (end ? unit(sub(P[P.length - 2], P[P.length - 1])) : unit(sub(P[1], P[0])));
      const live = () => made.filter((l) => !dropped.has(l.id) && l.raw.length > 1);
      for (let merged = true; merged; ) {
        merged = false;
        const L = live();
        outer: for (const A of L) {
          for (const B of L) {
            if (A === B) continue;
            for (const ea of [0, 1]) {
              for (const eb of [0, 1]) {
                const pa = ea ? A.raw[A.raw.length - 1] : A.raw[0];
                const pb = eb ? B.raw[B.raw.length - 1] : B.raw[0];
                if (len(sub(pa, pb)) > 6 || dot(away(A.raw, ea), away(B.raw, eb)) > -0.8) continue;
                // (Across a third street.)
                if (!streets.near(pa, 8).some((g) => g.line !== A.id && g.line !== B.id && !dropped.has(g.line) && segDist(pa, g.a, g.b) < 6)) continue;
                // A's far end first, then B's: the far ends as they were.
                const ka = kindAt(A, ea ? 0 : 1);
                const kb = kindAt(B, eb ? 0 : 1);
                const pts = [...(ea ? A.raw : A.raw.slice().reverse()), ...(eb ? B.raw.slice().reverse() : B.raw).slice(1)];
                // (A gateway must start it, the land's edge end it.)
                let first = ka;
                let last = kb;
                let line = pts;
                if (first === 'edge' || last === 'gate') [first, last, line] = [kb, ka, pts.slice().reverse()];
                if (first === 'edge' || last === 'gate') continue;
                A.raw = line;
                A.crossing = first === 'gate' ? A.crossing || B.crossing : null;
                A.edgeStart = false;
                A.end = last === 'edge' ? 'edge' : 'hit';
                dropped.add(B.id);
                merged = true;
                break outer;
              }
            }
          }
        }
      }
    }

    // ---- Finishing ----
    // Corners rounded off (but not at the ends), points every STEP metres.
    function finish(raw) {
      const P = [raw[0]];
      for (let i = 1; i < raw.length - 1; i++) {
        const a = raw[i - 1];
        const b = raw[i];
        const c = raw[i + 1];
        const turn = Math.abs(wrap(angleOf(sub(c, b)) - angleOf(sub(b, a))));
        const r = Math.min(ROUND, len(sub(b, a)) / 3, len(sub(c, b)) / 3);
        if (turn < 0.05 || r < 4) {
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
    // (A street from the land's edge runs the other way, out to it.)
    const out = made
      .filter((l) => !dropped.has(l.id) && l.raw.length > 1)
      .map((l) => (l.edgeStart ? { ...l, pts: finish(l.raw.slice().reverse()), end: 'edge' } : { ...l, pts: finish(l.raw) }));

    // ---- Neighbourhoods on their streets ----
    // Each centred on the main street (or boulevard) nearest where it first
    // grew from: that street runs down its middle.
    const all = out.map((l) => l.pts).concat(blvds.map((l) => l.points));
    for (const h of hoods) {
      if (h.core) {
        h.spine = null;
        continue;
      }
      let best = null;
      for (const P of all) {
        for (let i = 1; i < P.length; i++) {
          const a = P[i - 1];
          const ab = sub(P[i], a);
          const t = Math.max(0, Math.min(1, dot(sub(h.seed, a), ab) / (dot(ab, ab) || 1)));
          const q = add(a, mul(ab, t));
          const r = len(sub(q, h.seed));
          if (!best || r < best.r) best = { r, q: t < 0.5 ? a : P[i], P };
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
      crossingEnd: null,
      parkEnd: null,
      edgeEnd: l.end === 'edge',
      serves: hoods.filter((h) => !h.core && l.pts.some((q) => len(sub(q, h.centre)) < 1e-6)).map((h) => h.id),
      points: l.pts,
      bbox: lineBox(l.pts),
      pieces: piecesOf(l.pts),
    }));
    return { lines: result };
  };
}
