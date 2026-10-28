// Main streets of a district: high streets, as a city's old roads were.
//
// A city grew along the roads between its villages, and those roads became
// its high streets: long, gently curving, running on through one village
// after another. So here. Each neighbourhood's first centre is a village;
// each gateway (where a street crosses a greenway into the next district,
// agreed with the district beyond) is where a road comes in. From every
// gateway a street runs on from village to village, to whichever lies
// ahead and keeps it straightest (turning at most 45 degrees at a village,
// and no more than 70 over two), until it reaches another gateway and
// carries on into the next district, meets a street, or comes to the edge
// of the land (and stops there, at the greenway's line). Streets cross the
// boulevards and each other at 60 degrees or more, never run alongside
// another, and keep their junctions apart. A village no road has reached
// gets one through it both ways. Last, land still far from any street gets
// a street run through it from the nearest, straight on to the next.
//
// Each neighbourhood is then centred on the main street through its first
// centre: that street runs down its middle, and its land grows out from it.

import { createNoise } from '../core/noise.js';
import { lineBox, piecesOf } from './boulevards.js';
import { pointInPolygon, chaikin } from '../util/geom.js';
import { distanceField } from '../util/raster.js';

export const MAIN_STREET_REACH = 450; // most land is this close to a main street

const CELL = 50; // metres: the district's land raster
const STEP = 20; // metres between points of a street as traced
const RAIL_GAP = 90; // metres: closest a street may run alongside the rail above ground
const EDGE_GAP = 250; // and alongside the greenway at the land's edge
const PARALLEL = 0.8; // |cos| above which two streets run the same way (within about 37°)
const FAIR = Math.sin((60 * Math.PI) / 180); // streets meet at 60° or more
const STUB = 120; // metres a street runs straight in from its gateway before bending
const EDGE_RUN = 300; // metres a street ending at the land's edge may run on to the greenway's line
const ROUND = 16; // metres either side of a bend rounded off
const BUCKET = 200;
const VILLAGE_REACH = [350, 1500]; // metres from one stop of a high street to the next
const VILLAGE_STEP = 800; // metres between stops, preferred
const TURN_MAX = (45 * Math.PI) / 180; // the most a high street turns at a village
const STUB_TURN = (35 * Math.PI) / 180; // or leaving its gateway
const GATE_LATER = 250; // a street would rather run through another village than out (in score)
const SIDE_GAP = 380; // metres: streets going the same way keep at least this far apart
const RUN_OUT = 900; // metres a street's last stretch runs on to a street or the land's edge
const WANDER = 22; // metres a street wanders off the line between its stops
const REACH_GAP = 430; // metres from a street land may lie before a street is run through it
const FILLERS = 90;
const FILL_RUN = 2500; // metres a street run through a gap may run to the next // such streets, at most
const TURN_TWO = (70 * Math.PI) / 180; // the most a high street turns over two villages
const JUNCTION_CLEAR = 50; // metres a junction keeps from another street
const LINK_TURN = (80 * Math.PI) / 180; // the most a street turns to reach the nearest street
const OLD_TOWN_HALF = [330, 300]; // metres: half the old town's frame, along the way to the core and across it
const OLD_TOWN_BLVD = 220; // a side this near a boulevard running its way is the boulevard

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
    // (Not a boulevard out to the country: it was not planned round.)
    const blvds = d.network.lines.filter((l) => l.kind !== 'roundabout' && !l.country);
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

    // Gateways: where the streets cross the greenways into the next district.
    const gates = crossings.map((x) => ({ x }));

    // ---- Tests along a street ----
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
    // ---- The old town's frame ----
    // In the city centre, the old town: a quarter framed by main streets
    // all round (or a boulevard, where one runs along it), with a
    // pedestrian main street through its middle, past the metro station
    // there, towards the core. Laid before the grid, which grows round it;
    // nothing else runs into it.
    let frame = null;
    if (grid.oldTown) {
      const { p: P0, dir } = grid.oldTown;
      const u = unit(dir);
      const n = [-u[1], u[0]];
      const at = (a, b) => add(P0, add(mul(u, a), mul(n, b)));
      const C = [at(-OLD_TOWN_HALF[0], -OLD_TOWN_HALF[1]), at(OLD_TOWN_HALF[0], -OLD_TOWN_HALF[1]), at(OLD_TOWN_HALF[0], OLD_TOWN_HALF[1]), at(-OLD_TOWN_HALF[0], OLD_TOWN_HALF[1])];
      // A side a boulevard runs along: the boulevard is that side.
      const alongBlvd = (a, b) => {
        const m = mul(add(a, b), 0.5);
        const v = unit(sub(b, a));
        return streets.near(m, OLD_TOWN_BLVD).some((g) => lines.get(g.line).boulevard && Math.abs(dot(g.u, v)) > 0.75 && segDist(m, g.a, g.b) < OLD_TOWN_BLVD);
      };
      let open = [0, 1, 2, 3].find((k) => alongBlvd(C[k], C[(k + 1) % 4]));
      let ring = [...C, C[0]];
      if (open !== undefined) {
        // From the boulevard round the other three sides back to it: each
        // end carried on straight out to meet it. (Both, or the frame is
        // closed all round.)
        const order = [1, 2, 3, 4].map((k) => C[(open + k) % 4]);
        const out0 = unit(sub(order[0], order[1]));
        const out1 = unit(sub(order[3], order[2]));
        const meet = (p, v) => {
          const hit = firstHit(add(p, mul(v, -1)), add(p, mul(v, OLD_TOWN_BLVD * 1.5)), -999);
          if (hit && lines.get(hit.g.line).boulevard) return hit;
          // (Or, where it bends away, square on to the nearest of it.)
          let best = null;
          for (const g of streets.near(p, OLD_TOWN_BLVD * 1.5)) {
            if (!lines.get(g.line).boulevard) continue;
            const ab = sub(g.b, g.a);
            const t = Math.max(0, Math.min(1, dot(sub(p, g.a), ab) / (dot(ab, ab) || 1)));
            const q = add(g.a, mul(ab, t));
            const r = len(sub(q, p));
            if (r < OLD_TOWN_BLVD * 1.5 && (!best || r < best.r)) best = { r, p: q, g, s: g.s + len(ab) * t };
          }
          return best;
        };
        const h0 = meet(order[0], out0);
        const h1 = meet(order[3], out1);
        if (h0 && h1) {
          ring = [h0.p, ...order, h1.p];
          ring.hits = [h0, h1];
        } else open = undefined;
      }
      const id = nextId++;
      addLine(id, ring, { closed: open === undefined });
      const me = lines.get(id);
      const fr = { id, raw: ring, end: 'hit', start: null, hits: [], fixed: true };
      made.push(fr);
      if (ring.hits) {
        const L = ring.reduce((a, q, i) => (i ? a + len(sub(q, ring[i - 1])) : 0), 0);
        ring.hits.forEach((h, k) => {
          if (!h) return;
          me.junctions.push({ s: k ? L : 0, line: h.g.line });
          lines.get(h.g.line).junctions.push({ s: h.s, line: id });
        });
      }
      // The pedestrian main street: straight through the station from the
      // frame on the core's side to the frame (or boulevard) beyond.
      const ends = [];
      for (const sg of [-1, 1]) {
        const hit = firstHit(P0, add(P0, mul(u, sg * (OLD_TOWN_HALF[0] + OLD_TOWN_BLVD * 1.5))), -999);
        if (hit) ends.push(hit);
      }
      if (ends.length === 2) {
        const pid = nextId++;
        const praw = [ends[0].p, P0, ends[1].p];
        addLine(pid, praw, { noSeeds: true });
        const pm = lines.get(pid);
        const pl = praw.reduce((a, q, i) => (i ? a + len(sub(q, praw[i - 1])) : 0), 0);
        pm.junctions.push({ s: 0, line: ends[0].g.line }, { s: pl, line: ends[1].g.line });
        for (const h of ends) lines.get(h.g.line).junctions.push({ s: h.s, line: pid });
        made.push({ id: pid, raw: praw, end: 'hit', start: null, hits: [], fixed: true, pedestrian: true });
      }
      // (The frame's land, out to the boulevard where that is a side.)
      const poly = C.slice();
      if (open !== undefined) {
        const a = open;
        const b = (open + 1) % 4;
        const shift = mul(sub(mul(add(C[a], C[b]), 0.5), P0), 0.35);
        poly[a] = add(C[a], shift);
        poly[b] = add(C[b], shift);
      }
      frame = { poly, line: id };
    }
    const inFrame = (q) => !!frame && pointInPolygon(q[0], q[1], frame.poly);

    // ---- High streets, village to village ----
    // Like the old roads a city grew along: from each gateway a street runs
    // on from village to village (each neighbourhood's first centre), on to
    // the one ahead that keeps it straightest, until it reaches another
    // gateway (and carries on into the next district), meets a street, or
    // comes to the edge of the land. So high streets are long and run
    // through several neighbourhoods, crossing the boulevards and greenways
    // on their way, and each neighbourhood has one down its middle.
    const villages = hoods.filter((h) => !h.core && !h.oldTown && isLand(h.seed) && !inFrame(h.seed)).map((h) => ({ p: h.seed, routes: [] }));
    const gateList = gates.map((g) => ({ p: g.x.p, n: g.x.n, key: g.x.key, used: false }));
    // (A boulevard runs right through some gateways already.)
    for (const g of gateList) if (streets.near(g.p, 6).some((s) => segDist(g.p, s.a, s.b) < 5)) g.used = true;
    const angleTo = (u, v) => Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
    // Another street (besides `line` and the street's own) near q: a
    // junction there already, or about to be.
    const busy = (q, line, own) => streets.near(q, JUNCTION_CLEAR).some((g) => g.line !== line && !own.has(g.line) && !dropped.has(g.line) && segDist(q, g.a, g.b) < JUNCTION_CLEAR);
    // May a street run straight from a to b: over land (past its first
    // and last `slack` metres), out of the old town, crossing other streets
    // at a fair angle and never running alongside one (or the rail, or the
    // land's edge)?
    function clear(a, b, own, slack0 = 0, slack1 = 0, loose = false) {
      const L = len(sub(b, a));
      if (L < 1) return false;
      const v = unit(sub(b, a));
      let wet = 0;
      for (let s = 0; s <= L; s += 25) {
        const q = add(a, mul(v, s));
        if (inFrame(q)) return false;
        if (s > slack0 && s < L - slack1 && !isLand(q)) wet++;
      }
      if (wet > 2) return false;
      for (const g of streets.near(a, L + 1)) {
        if (own.has(g.line) || dropped.has(g.line)) continue;
        const h = segCross(a, b, g.a, g.b);
        if (!h || h[0] <= 0.01 || h[0] >= 0.99) continue;
        if (Math.abs(cross(v, g.u)) < FAIR) return false;
        // (Nor right by another junction.)
        if (!loose && busy(add(a, mul(v, L * h[0])), g.line, own)) return false;
      }
      if (loose) return true;
      for (let s = Math.min(150, L / 3); s < L - Math.min(150, L / 3); s += 60) {
        const q = add(a, mul(v, s));
        for (const g of streets.near(q, SIDE_GAP)) {
          if (own.has(g.line) || dropped.has(g.line) || Math.abs(dot(g.u, v)) < PARALLEL) continue;
          if (besideDist(q, g.a, g.b) < SIDE_GAP) return false;
        }
        for (const g of rails.near(q, RAIL_GAP)) if (Math.abs(dot(g.u, v)) >= PARALLEL && besideDist(q, g.a, g.b) < RAIL_GAP) return false;
        for (const g of edges.near(q, EDGE_GAP)) if (Math.abs(dot(g.u, v)) >= PARALLEL && besideDist(q, g.a, g.b) < EDGE_GAP) return false;
      }
      return true;
    }
    // On from `cur` heading `dir`: the next village or gateway, or null.
    function nextStop(cur, dir, own, visited, first, before = dir) {
      let best = null;
      const consider = (q, kind, ref) => {
        const to = sub(q, cur);
        const r = len(to);
        if (r < VILLAGE_REACH[0] || r > VILLAGE_REACH[1]) return;
        const v = unit(to);
        const turn = angleTo(dir, v);
        if (turn > (first ? STUB_TURN : TURN_MAX) || angleTo(before, v) > TURN_TWO) return;
        if (kind === 'village') {
          // (Crossing any street already through it fairly.)
          if (ref.routes.length >= 2 || ref.routes.some((u) => Math.abs(cross(u, v)) < FAIR)) return;
        } else if (dot(v, ref.n) > -Math.cos(TURN_MAX)) return; // (out through a gateway, not along it)
        const score = turn * 900 + Math.abs(r - VILLAGE_STEP) * 0.5 + (kind === 'gate' ? GATE_LATER : 0);
        if (best && score >= best.score) return;
        if (!clear(cur, q, own, first ? 150 : 0, kind === 'gate' ? 150 : 0)) return;
        best = { score, q, kind, ref, v };
      };
      for (const vl of villages) if (!visited.has(vl)) consider(vl.p, 'village', vl);
      for (const g of gateList) if (!g.used && !visited.has(g)) consider(g.p, 'gate', g);
      return best;
    }
    // Straight on from p along v, to a street met fairly (a T junction) or
    // the land's edge met square enough on: the end, or null.
    function runOut(p, v, own, max = RUN_OUT) {
      for (let s = STEP; s <= max; s += STEP) {
        const q = add(p, mul(v, s));
        const hit = firstHit(add(p, mul(v, s - STEP)), q, -999);
        if (hit && !own.has(hit.g.line) && !dropped.has(hit.g.line)) return Math.abs(cross(hit.g.u, v)) >= FAIR && !busy(hit.p, hit.g.line, own) && clear(p, hit.p, own) ? { p: hit.p, kind: 'hit' } : null;
        if (!isLand(q) || inFrame(q)) {
          const edge = edges.near(q, 60).find((g) => segDist(q, g.a, g.b) < 120);
          if (edge && Math.abs(cross(edge.u, v)) < FAIR * 0.9) return null;
          const tip = add(p, mul(v, s - STEP));
          if (s <= STEP || !clear(p, tip, own)) return null;
          // (On to the greenway's line, or a park's edge.)
          const at = toEdge(tip, v, -999);
          return at ? { p: at, kind: 'edge' } : null;
        }
      }
      return null;
    }
    // A route from p heading dir: its stops, and how it ends.
    function routeFrom(p, dir, own, visited, first) {
      const stops = [];
      let cur = p;
      let v = dir;
      let before = dir;
      for (let k = 0; k < 16; k++) {
        const nx = nextStop(cur, v, own, visited, first && k === 0, before);
        if (!nx) break;
        stops.push(nx);
        visited.add(nx.ref);
        if (nx.kind === 'gate') return { stops, end: 'gate' };
        cur = nx.q;
        before = v;
        v = nx.v;
      }
      // (Straight on if it can, else bending a little either way.)
      let out = null;
      for (const turn of [0, 0.3, -0.3, 0.6, -0.6]) if (!out) out = runOut(cur, rot(v, turn), own);
      // (Or to the nearest street, if it ends where there is none ahead.)
      if (!out && stops.length) {
        let best = null;
        for (const g of streets.near(cur, RUN_OUT)) {
          if (own.has(g.line) || dropped.has(g.line)) continue;
          const ab = sub(g.b, g.a);
          const t = Math.max(0.05, Math.min(0.95, dot(sub(cur, g.a), ab) / (dot(ab, ab) || 1)));
          const q = add(g.a, mul(ab, t));
          const r = len(sub(q, cur));
          if (r > 30 && r < RUN_OUT && angleTo(v, unit(sub(q, cur))) < LINK_TURN && Math.abs(cross(g.u, unit(sub(q, cur)))) >= FAIR && (!best || r < best.r) && !busy(q, g.line, own) && clear(cur, q, own)) best = { r, q };
        }
        if (best) out = { p: best.q, kind: 'hit' };
      }
      if (out) stops.push({ q: out.p, kind: out.kind, v: unit(sub(out.p, cur)) });
      return { stops, end: out ? out.kind : 'loose' };
    }
    // A smooth street through its stops (corners cut, so it never
    // overshoots), wandering a little between them.
    function smooth(P, startDir, endDir) {
      let ctrl = P.slice();
      if (startDir && len(sub(P[1], P[0])) > STUB * 1.5) ctrl.splice(1, 0, add(P[0], mul(startDir, STUB)));
      // (endDir: the gateway's inward normal, so the street comes in square to it.)
      if (endDir && len(sub(P[P.length - 1], P[P.length - 2])) > STUB * 1.5) ctrl.splice(ctrl.length - 1, 0, add(P[P.length - 1], mul(endDir, STUB)));
      for (let k = 0; k < 4; k++) ctrl = chaikin(ctrl, false);
      const out = [ctrl[0]];
      let s = 0;
      for (let i = 1; i < ctrl.length; i++) {
        const a = ctrl[i - 1];
        const b = ctrl[i];
        const L = len(sub(b, a));
        const n = Math.max(1, Math.ceil(L / STEP));
        for (let k = 1; k <= n; k++) {
          const q = add(a, mul(sub(b, a), k / n));
          s += L / n;
          out.push(q.concat([s]));
        }
      }
      // (Wandering off the line a little, fading out toward each end.)
      const total = s;
      return out.map((q, i) => {
        if (i === 0 || i === out.length - 1) return [q[0], q[1]];
        const a = out[Math.max(0, i - 1)];
        const b = out[Math.min(out.length - 1, i + 1)];
        const nrm = unit([-(b[1] - a[1]), b[0] - a[0]]);
        const fade = Math.min(1, q[2] / 300, (total - q[2]) / 300);
        const w = WANDER * fade * wander.fbm(q[0] / 700, q[1] / 700, 2);
        return [q[0] + nrm[0] * w, q[1] + nrm[1] * w];
      });
    }
    let routeId = 0;
    function layRoute(start, startDir, back, fwd, extra) {
      // back/fwd: routes from the start each way (back may be null).
      const pts = [...(back ? back.stops.map((s) => s.q).reverse() : []), start, ...fwd.stops.map((s) => s.q)];
      if (pts.length < 2) return null;
      const lastStop = fwd.stops[fwd.stops.length - 1];
      const firstStop = back && back.stops[back.stops.length - 1];
      // (A route back out through a gateway starts there.)
      const backGate = firstStop && firstStop.kind === 'gate' ? firstStop.ref : null;
      if (backGate) extra = { ...extra, crossing: backGate.key };
      const raw = smooth(pts, backGate ? backGate.n : extra.crossing ? startDir : null, lastStop && lastStop.kind === 'gate' ? lastStop.ref.n : null);
      const id = nextId++;
      addLine(id, raw);
      made.push({ id, raw, end: lastStop ? (lastStop.kind === 'edge' ? 'edge' : 'hit') : 'hit', start: null, hits: [], edgeStart: !!(firstStop && firstStop.kind === 'edge'), crossingEnd: lastStop && lastStop.kind === 'gate' ? lastStop.ref.key : null, ...extra });
      for (const s of [...fwd.stops, ...(back ? back.stops : [])]) {
        if (s.kind === 'village') s.ref.routes.push(s.v);
        if (s.kind === 'gate') s.ref.used = true;
      }
      routeId++;
      return id;
    }
    // From every gateway, centre outward.
    for (const g of gateList.slice().sort((a, b) => len(sub(a.p, S)) - len(sub(b.p, S)))) {
      if (g.used) continue;
      const own = new Set([nextId]);
      const visited = new Set([g]);
      let fwd = routeFrom(g.p, g.n, own, visited, true);
      if (!fwd.stops.length || fwd.end === 'loose') {
        // (Failing a route, a short street in from it to the nearest
        // street ahead, or the land's edge.)
        let p = null;
        for (let s = 0; s <= 300 && !p; s += 10) if (isLand(add(g.p, mul(g.n, s)))) p = add(g.p, mul(g.n, s + 20));
        let out = null;
        if (p) for (const turn of [0, 0.3, -0.3, 0.6, -0.6]) if (!out) out = runOut(p, rot(g.n, turn), own);
        if (p && (!out || out.kind !== 'hit')) {
          // (Or the nearest street it can be run to.)
          out = null;
          for (const gg of streets.near(p, RUN_OUT)) {
            if (dropped.has(gg.line)) continue;
            const ab = sub(gg.b, gg.a);
            const t = Math.max(0.05, Math.min(0.95, dot(sub(p, gg.a), ab) / (dot(ab, ab) || 1)));
            const q = add(gg.a, mul(ab, t));
            const r = len(sub(q, p));
            const v = unit(sub(q, p));
            if (r > 30 && r < RUN_OUT && angleTo(g.n, v) < LINK_TURN && Math.abs(cross(gg.u, v)) >= FAIR && (!out || r < out.r) && !busy(q, gg.line, own) && clear(p, q, own)) out = { r, p: q, kind: 'hit' };
          }
        }
        if (p && (!out || out.kind !== 'hit')) {
          // (Last of all, the nearest street at all, looser about what it
          // passes: a gateway is never left without its street.)
          out = null;
          for (const gg of streets.near(p, RUN_OUT * 1.5)) {
            if (dropped.has(gg.line)) continue;
            const ab = sub(gg.b, gg.a);
            const t = Math.max(0.05, Math.min(0.95, dot(sub(p, gg.a), ab) / (dot(ab, ab) || 1)));
            const q = add(gg.a, mul(ab, t));
            const r = len(sub(q, p));
            const v = unit(sub(q, p));
            if (r > 30 && Math.abs(cross(gg.u, v)) >= FAIR * 0.85 && (!out || r < out.r) && clear(p, q, own, 0, 0, true)) out = { r, p: q, kind: 'hit' };
          }
        }
        if (!out || out.kind !== 'hit') continue;
        fwd = { stops: [{ q: out.p, kind: 'hit', v: unit(sub(out.p, g.p)) }], end: 'hit' };
      }
      g.used = true;
      layRoute(g.p, g.n, null, fwd, { crossing: g.key });
    }
    // Through every village no street has reached yet: both ways, along
    // whichever way runs on furthest.
    for (const vl of villages) {
      if (vl.routes.length) continue;
      let best = null;
      for (let k = 0; k < 8; k++) {
        const dir = [Math.cos((k * Math.PI) / 8 + 0.2), Math.sin((k * Math.PI) / 8 + 0.2)];
        const own = new Set([nextId]);
        const visited = new Set([vl]);
        const fwd = routeFrom(vl.p, dir, own, visited, false);
        const back = routeFrom(vl.p, mul(dir, -1), own, visited, false);
        if (!fwd.stops.length || !back.stops.length || fwd.end === 'loose' || back.end === 'loose') continue;
        const score = fwd.stops.length + back.stops.length;
        if (!best || score > best.score) best = { score, fwd, back, dir };
      }
      if (!best) continue;
      vl.routes.push(best.dir);
      layRoute(vl.p, best.dir, best.back, best.fwd, {});
    }
    // Land still far from any street: a street through the farthest of it,
    // from the nearest street, straight on to the next.
    const given = new Set(); // (cells no street can reach: left be)
    const stampSeg = (src, a, b) => {
      const n = Math.max(1, Math.ceil(len(sub(b, a)) / (CELL / 2)));
      for (let k = 0; k <= n; k++) {
        const c = grid.cellOf(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n);
        if (c >= 0) src[c] = 1;
      }
    };
    for (let guard = 0; guard < FILLERS; guard++) {
      const src = new Uint8Array(grid.N);
      for (const l of lines.values()) if (!dropped.has(l.id)) for (let i = 0; i + 1 < l.pts.length; i++) stampSeg(src, l.pts[i], l.pts[i + 1]);
      const far = distanceField(CELL, src, grid.W, grid.H);
      let worst = -1;
      for (let n = 0; n < grid.N; n++) if (grid.mask[n] === LAND && !given.has(n) && far[n] > REACH_GAP && (worst < 0 || far[n] > far[worst])) worst = n;
      if (worst < 0) break;
      const p = [grid.x0 + ((worst % grid.W) + 0.5) * CELL, grid.y0 + (Math.floor(worst / grid.W) + 0.5) * CELL];
      let near = null;
      for (const g of streets.near(p, far[worst] + 200)) {
        if (dropped.has(g.line)) continue;
        const ab = sub(g.b, g.a);
        const t = Math.max(0, Math.min(1, dot(sub(p, g.a), ab) / (dot(ab, ab) || 1)));
        const q = add(g.a, mul(ab, t));
        if (!near || len(sub(q, p)) < len(sub(near.q, p))) near = { q, g };
      }
      let laid = false;
      if (near) {
        const v = unit(sub(p, near.q));
        const own = new Set([nextId, near.g.line]);
        let out = null;
        for (const turn of [0, 0.25, -0.25]) {
          const w = rot(v, turn);
          if (!out && Math.abs(cross(near.g.u, w)) >= FAIR) out = runOut(add(near.q, mul(w, 1)), w, own, FILL_RUN);
        }
        if (out && len(sub(out.p, near.q)) > 150) {
          const id = nextId++;
          const raw = [near.q, out.p];
          addLine(id, raw);
          made.push({ id, raw, end: out.kind === 'edge' ? 'edge' : 'hit', start: null, hits: [] });
          laid = true;
        }
      }
      // (None can be run through it: the land round it is left be.)
      if (!laid) for (let n = 0; n < grid.N; n++) if (len([grid.x0 + ((n % grid.W) + 0.5) * CELL - p[0], grid.y0 + (Math.floor(n / grid.W) + 0.5) * CELL - p[1]]) < 150) given.add(n);
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
      .map((l) => ({ ...l, pts: finish(l.raw) }));

    // ---- Neighbourhoods on their streets ----
    // Each centred on the main street (or boulevard) nearest where it first
    // grew from: that street runs down its middle.
    const all = out.map((l) => l.pts).concat(blvds.map((l) => l.points));
    const ped = out.find((l) => l.pedestrian);
    for (const h of hoods) {
      if (h.core) {
        h.spine = null;
        continue;
      }
      // (The old town's: its pedestrian main street, its station its centre.)
      if (h.oldTown && ped) {
        h.centre = grid.oldTown.p.slice();
        h.spine = ped.pts;
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
      crossingEnd: l.crossingEnd || null,
      parkEnd: null,
      edgeStart: !!l.edgeStart,
      edgeEnd: l.end === 'edge',
      serves: hoods.filter((h) => !h.core && l.pts.some((q) => len(sub(q, h.centre)) < 1e-6)).map((h) => h.id),
      points: l.pts,
      bbox: lineBox(l.pts),
      pieces: piecesOf(l.pts),
      ...(l.pedestrian ? { pedestrian: true } : {}),
    }));
    return { lines: result, oldTown: frame ? { frame: frame.poly } : null };
  };
}
