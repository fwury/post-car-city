// Tram routes, planned for the whole city at once.
//
// Trams are the city's walking accelerators: local lines on the main
// streets, stopping every 300 to 400 m, that link each neighbourhood to its
// district's centre and run on across the districts. The metro runs under
// the boulevards from centre to centre; a tram may share a boulevard with it
// for a stretch, but never most of its way.
//
// Each route runs from a loop at one end to a loop at the other (at the
// city's edge, or at the entrance to a park), keeping to one overall
// direction, and passes in front of the station of every district centre
// on its way, with a stop at the station's plaza. Routes are chosen one at
// a time where they do most good: neighbourhoods not yet joined directly to
// their district's centre (by tram, or by a metro station of their own),
// and homes not yet within a short walk of a stop; less the track a route
// would add.
//
// Only routed streets have tracks and stops; elsewhere the tram lanes of a
// main street are a planted median of the same width.

import { pointInPolygon } from '../util/geom.js';
import { hash, toUnit } from '../core/hash.js';

// Each route's colour on the map, by its number.
const ROUTE_COLOURS = ['#d6453d', '#2f7fc1', '#3a9a5b', '#e08a1e', '#8e5bb5', '#c2477f', '#1d9a9a', '#9a7b2f', '#5a6fd6', '#d2603a', '#4f8f2f', '#b0418f', '#2e8bb0', '#c79a1b', '#6b5bd0', '#3d7f6a'];
export const routeColour = (id) => ROUTE_COLOURS[id % ROUTE_COLOURS.length];
export const STOP_EVERY = [300, 400]; // metres between stops along a route
const STOP_MERGE = 220; // metres: another route's stop this close along the same street is the same stop
const EDGE_NEAR = 80; // metres: a main street ending this close to its district's edge, with nothing beyond, ends at the city's edge
const SNAP = 4; // metres: a line's end this close to another line meets it there
const MERGE = 4; // metres: junction points this close are one
const PLAZA_REACH = 120; // metres from a district's station plaza to the street its stop is on
const METRO_NEAR = 45; // metres: a boulevard this close over a metro line has it beneath
const METRO_SHARE = 0.5; // the most of a route that may run over the metro
const CONNECT = 300; // metres: a route through its centre that runs this far in a neighbourhood joins it to the centre
const COVER = 380; // metres: homes this close to a route are a short walk from a stop
const SAMPLE = 125; // metres between sample points of the land homes stand on
const SPAN = [1200, 15000]; // metres between a route's two ends, at least and at most
const DETOUR = 1.55; // a route's length, at most, to the straight line between its ends...
const DETOUR_ADD = 1500; // (...and this many metres)
const BACK = 300; // metres a route may run back against its overall direction
const WIND = 350; // (but for within this of a centre it serves)
const ANCHOR_TURN = (35 * Math.PI) / 180; // a route out of a centre may run on by way of another centre this far off its way
const THROUGH = (125 * Math.PI) / 180; // a route through a centre turns there no more than this (its two ways this far apart at least)
const HALVES = 120; // ways out of each centre paired up, the straightest
const SEEK_TRIES = 3; // a neighbourhood's longest stretches of street a route made for it may take
const PER_CENTRE = 60; // candidate routes through each centre, the straightest
const PER_HOOD = 15000; // people: what joining a neighbourhood to its centre is worth
const PER_KM_RUN = 2500; // people: what each kilometre of a route must serve, to be worth running
const PER_KM_TRACK = 2000; // and each kilometre of new track it needs, to be worth laying
const PER_PAIR_MUST = 40000; // people: what joining two neighbouring centres with no metro or rail between is worth
const PER_PAIR = 9000; // ...and two that have one
const COVER_TARGET = 0.97; // of residents, those a route should pass within a short walk of
const COVER_ROUNDS = 120; // routes added for coverage, at most
const GAP_TRIES = 3; // gaps a round looks for streets near
const TURN = (25 * Math.PI) / 180; // a route changing streets turns at least this much to need turning track

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (v) => Math.hypot(v[0], v[1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const unit = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};
const lengthOf = (P) => P.reduce((s, p, i) => (i ? s + len(sub(p, P[i - 1])) : 0), 0);
function cumOf(P) {
  const c = [0];
  for (let i = 1; i < P.length; i++) c.push(c[i - 1] + len(sub(P[i], P[i - 1])));
  return c;
}
function pointAt(P, cum, s) {
  if (s <= 0) return P[0].slice();
  for (let i = 1; i < P.length; i++) {
    if (s <= cum[i]) {
      const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      return add(P[i - 1], mul(sub(P[i], P[i - 1]), t));
    }
  }
  return P[P.length - 1].slice();
}
function slice(P, cum, s0, s1) {
  const out = [pointAt(P, cum, s0)];
  for (let i = 1; i < P.length - 1; i++) if (cum[i] > s0 && cum[i] < s1) out.push(P[i]);
  out.push(pointAt(P, cum, s1));
  return out;
}
// The nearest point on a polyline: its arc length s and distance r.
function project(P, cum, q) {
  let best = { s: 0, r: Infinity };
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1];
    const ab = sub(P[i], a);
    const l2 = dot(ab, ab) || 1;
    const t = Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2));
    const r = len(sub(add(a, mul(ab, t)), q));
    if (r < best.r) best = { s: cum[i - 1] + t * (cum[i] - cum[i - 1]), r };
  }
  return best;
}
function segCross(a, b, c, d) {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const ca = sub(c, a);
  const t = (ca[0] * s[1] - ca[1] * s[0]) / den;
  const u = (ca[0] * r[1] - ca[1] * r[0]) / den;
  return t > 0 && t < 1 && u > 0 && u < 1 ? t : null;
}
// A spatial index of items by bucket.
function index(size) {
  const m = new Map();
  const k = (i, j) => i * 100003 + j;
  return {
    add(x0, y0, x1, y1, item) {
      for (let i = Math.floor(x0 / size); i <= Math.floor(x1 / size); i++) for (let j = Math.floor(y0 / size); j <= Math.floor(y1 / size); j++) {
        const key = k(i, j);
        if (!m.has(key)) m.set(key, []);
        m.get(key).push(item);
      }
    },
    near(x, y, r) {
      const out = new Set();
      for (let i = Math.floor((x - r) / size); i <= Math.floor((x + r) / size); i++) for (let j = Math.floor((y - r) / size); j <= Math.floor((y + r) / size); j++) for (const it of m.get(k(i, j)) || []) out.add(it);
      return out;
    },
  };
}
// A binary heap of [cost, node].
function heap() {
  const a = [];
  return {
    get size() {
      return a.length;
    },
    peek() {
      return a[0];
    },
    push(c, n) {
      a.push([c, n]);
      for (let i = a.length - 1; i > 0; ) {
        const p = (i - 1) >> 1;
        if (a[p][0] <= a[i][0]) break;
        [a[p], a[i]] = [a[i], a[p]];
        i = p;
      }
    },
    pop() {
      const top = a[0];
      const last = a.pop();
      if (a.length) {
        a[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < a.length && a[l][0] < a[m][0]) m = l;
          if (r < a.length && a[r][0] < a[m][0]) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]];
          i = m;
        }
      }
      return top;
    },
  };
}

// cores: the city's district cores; district(core): a district with its
// stage 3 (neighbourhoods and main streets), boulevards and parks;
// metroLines(): the metro's lines ({ pts }); plazaOf(d): where a district's
// station plaza meets its street.
export function createTrams(seed, { cores, district, metroLines, plazaOf, linked = () => new Set() }) {
  let planned = null;
  function plan() {
    if (planned) return planned;
    const ds = cores.map((c) => district(c));

    // ---- The streets trams may run on ----
    const lines = [];
    for (const d of ds) {
      for (const l of d.stage3.lines) lines.push({ key: l.key, d: d.key, kind: 'main', pts: l.points, src: l });
      for (const l of d.network.lines) if (l.kind !== 'roundabout') lines.push({ key: l.key, d: d.key, kind: 'boulevard', pts: l.points, src: l });
    }
    for (const L of lines) {
      L.cum = cumOf(L.pts);
      L.L = L.cum[L.cum.length - 1];
      L.cuts = [0, L.L];
    }
    const segs = index(200);
    lines.forEach((L, li) => {
      for (let i = 1; i < L.pts.length; i++) {
        const [a, b] = [L.pts[i - 1], L.pts[i]];
        segs.add(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), li * 100000 + i);
      }
    });
    const segAt = (code) => {
      const L = lines[Math.floor(code / 100000)];
      const i = code % 100000;
      return { L, i, a: L.pts[i - 1], b: L.pts[i] };
    };
    // Where lines meet: one's end on another, or crossing.
    for (const L of lines) {
      for (const end of [L.pts[0], L.pts[L.pts.length - 1]]) {
        for (const code of segs.near(end[0], end[1], SNAP)) {
          const { L: M, i, a, b } = segAt(code);
          if (M === L) continue;
          const ab = sub(b, a);
          const t = Math.max(0, Math.min(1, dot(sub(end, a), ab) / (dot(ab, ab) || 1)));
          if (len(sub(add(a, mul(ab, t)), end)) < SNAP) M.cuts.push(M.cum[i - 1] + t * (M.cum[i] - M.cum[i - 1]));
        }
      }
      for (let i = 1; i < L.pts.length; i++) {
        const [a, b] = [L.pts[i - 1], L.pts[i]];
        for (const code of segs.near((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, len(sub(b, a)) / 2 + 1)) {
          const { L: M, i: j, a: c, b: e } = segAt(code);
          if (M === L) continue;
          const t = segCross(a, b, c, e);
          if (t === null) continue;
          L.cuts.push(L.cum[i - 1] + t * (L.cum[i] - L.cum[i - 1]));
        }
      }
    }
    // Each district's station plaza, on the street nearest it.
    const plazas = new Map();
    for (const d of ds) {
      const P = plazaOf(d);
      let best = null;
      for (const code of segs.near(P[0], P[1], PLAZA_REACH)) {
        const { L } = segAt(code);
        if (L.d !== d.key) continue;
        const pr = project(L.pts, L.cum, P);
        if (pr.r < PLAZA_REACH && (!best || pr.r < best.pr.r)) best = { L, pr };
      }
      if (!best) continue;
      best.L.cuts.push(best.pr.s);
      plazas.set(d.key, pointAt(best.L.pts, best.L.cum, best.pr.s));
    }

    // ---- The graph: junctions, and the stretches of street between ----
    const nodes = [];
    const nodeIdx = index(20);
    const nodeAt = (p) => {
      for (const n of nodeIdx.near(p[0], p[1], MERGE)) if (len(sub(n.p, p)) < MERGE) return n;
      const n = { id: nodes.length, p: p.slice(), edges: [] };
      nodes.push(n);
      nodeIdx.add(p[0], p[1], p[0], p[1], n);
      return n;
    };
    const edges = [];
    for (const L of lines) {
      const cuts = [...new Set(L.cuts.map((s) => Math.max(0, Math.min(L.L, s))))].sort((a, b) => a - b);
      const keep = [cuts[0]];
      for (const s of cuts.slice(1)) {
        if (s - keep[keep.length - 1] < MERGE * 2) {
          if (s === L.L) keep[keep.length - 1] = s;
          continue;
        }
        keep.push(s);
      }
      if (keep[keep.length - 1] !== L.L) keep.push(L.L);
      L.nodes = keep.map((s) => nodeAt(pointAt(L.pts, L.cum, s)));
      for (let k = 1; k < keep.length; k++) {
        const a = L.nodes[k - 1];
        const b = L.nodes[k];
        if (a === b) continue;
        const pts = slice(L.pts, L.cum, keep[k - 1], keep[k]);
        const e = { id: edges.length, a: a.id, b: b.id, L, s0: keep[k - 1], s1: keep[k], pts, len: keep[k] - keep[k - 1], kind: L.kind };
        edges.push(e);
        a.edges.push(e);
        b.edges.push(e);
      }
    }
    // Ends: at the city's edge, or at a park.
    for (const L of lines) {
      if (L.kind !== 'main') continue;
      const first = L.nodes[0];
      const last = L.nodes[L.nodes.length - 1];
      if (L.src.parkStart && first.edges.length === 1) first.end = 'park';
      if (L.src.parkEnd && last.edges.length === 1) last.end = 'park';
      if (L.src.edgeEnd && last.edges.length === 1) last.end = 'edge';
      if (L.src.edgeStart && first.edges.length === 1) first.end = 'edge';
      // (A main street ending at the district's edge with nothing beyond:
      // the city's edge.)
      const ring = ds.find((d) => d.key === L.d).ring;
      for (const n of [first, last]) {
        if (n.end || n.edges.length !== 1) continue;
        let r = Infinity;
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1];
          const ab = sub(ring[i], a);
          const t = Math.max(0, Math.min(1, dot(sub(n.p, a), ab) / (dot(ab, ab) || 1)));
          r = Math.min(r, len(sub(add(a, mul(ab, t)), n.p)));
        }
        if (r < EDGE_NEAR) n.end = 'edge';
      }
    }
    for (const n of nodes) if (!n.end && n.edges.length === 1 && n.edges[0].kind === 'boulevard' && n.edges[0].L.src.kind !== 'spur') {
      // (A boulevard out of the city.)
      const e = n.edges[0];
      const atEnd = e.b === n.id ? e.s1 === e.L.L : e.s0 === 0;
      if (atEnd) n.end = 'edge';
    }
    const centreNode = new Map();
    for (const [k, p] of plazas) centreNode.set(k, nodeAt(p));
    // (A centre at the end of its street: the trams turn there, round a
    // loop at the station plaza.)
    for (const n of centreNode.values()) if (n.edges.length === 1) n.end = 'plaza';

    // Boulevards with the metro beneath.
    const metro = index(150);
    for (const l of metroLines()) {
      for (let i = 1; i < l.pts.length; i++) {
        const [a, b] = [l.pts[i - 1], l.pts[i]];
        metro.add(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), [a, b]);
      }
    }
    const overMetro = (q) => {
      for (const [a, b] of metro.near(q[0], q[1], METRO_NEAR)) {
        const ab = sub(b, a);
        const t = Math.max(0, Math.min(1, dot(sub(q, a), ab) / (dot(ab, ab) || 1)));
        if (len(sub(add(a, mul(ab, t)), q)) < METRO_NEAR) return true;
      }
      return false;
    };
    for (const e of edges) {
      e.metro = 0;
      if (e.kind !== 'boulevard') continue;
      const c = cumOf(e.pts);
      const n = Math.max(1, Math.round(e.len / 50));
      let on = 0;
      for (let k = 0; k <= n; k++) if (overMetro(pointAt(e.pts, c, (e.len * k) / n))) on++;
      e.metro = on / (n + 1);
    }
    // (A tram keeps to the main streets where it can: boulevards cost it
    // more, and more again over the metro.)
    for (const e of edges) e.w = e.len * (e.kind === 'main' ? 1 : 1.3 + 1.2 * e.metro);

    // ---- Who a route serves ----
    const hoods = [];
    for (const d of ds) for (const h of d.stage3.hoods) hoods.push({ d: d.key, h, joined: !!h.metro });
    // Where people live: each district's raster of residents, gathered into
    // sample points, each with its neighbourhood.
    const hoodNo = new Map(hoods.map((x, i) => [`${x.d}|${x.h.id}`, i]));
    const samples = [];
    const sampleIdx = index(200);
    for (const d of ds) {
      const R = d.stage3.raster;
      const bins = new Map();
      for (let j = 0; j < R.H; j++) {
        for (let i = 0; i < R.W; i++) {
          const n = j * R.W + i;
          if (R.label[n] < 0 || !R.dens[n]) continue;
          const x = R.x0 + (i + 0.5) * R.cell;
          const y = R.y0 + (j + 0.5) * R.cell;
          const k = `${Math.floor(x / SAMPLE)},${Math.floor(y / SAMPLE)}`;
          let bin = bins.get(k);
          if (!bin) bins.set(k, (bin = { x: 0, y: 0, w: 0 }));
          const w = R.dens[n] * R.cell * R.cell;
          bin.x += x * w;
          bin.y += y * w;
          bin.w += w;
        }
      }
      for (const bin of bins.values()) {
        if (bin.w <= 0) continue;
        const p = [bin.x / bin.w, bin.y / bin.w];
        const s = { id: samples.length, p, w: bin.w };
        samples.push(s);
        sampleIdx.add(p[0], p[1], p[0], p[1], s);
      }
    }
    // The neighbourhood a point is in, from its district's raster.
    const rasterOf = new Map(ds.map((d) => [d.key, d.stage3.raster]));
    const hoodAt = (q, dk) => {
      const R = rasterOf.get(dk);
      const i = Math.floor((q[0] - R.x0) / R.cell);
      const j = Math.floor((q[1] - R.y0) / R.cell);
      if (i < 0 || j < 0 || i >= R.W || j >= R.H) return -1;
      const l = R.label[j * R.W + i];
      return l >= 0 ? hoodNo.get(`${dk}|${l}`) ?? -1 : -1;
    };
    // Each stretch: the homes near it, and how far it runs in each
    // neighbourhood.
    for (const e of edges) {
      const near = new Set();
      const hs = new Map();
      const c = cumOf(e.pts);
      const n = Math.max(1, Math.ceil(e.len / 60));
      for (let k = 0; k <= n; k++) {
        const q = pointAt(e.pts, c, (e.len * k) / n);
        if (k % 2 === 0 || k === n) for (const s of sampleIdx.near(q[0], q[1], COVER)) if (len(sub(s.p, q)) < COVER) near.add(s.id);
        const h = hoodAt(q, e.L.d);
        if (h >= 0) hs.set(h, (hs.get(h) || 0) + e.len / (n + 1));
      }
      e.samples = [...near];
      e.hoods = hs;
    }

    // ---- Shortest ways from each district's centre ----
    // From the centre, and out of it along each street leaving it (so a
    // route through it can leave one way and come in another). Twice: once
    // as the streets are, once with their costs shaken a little, for other
    // ways to the same places.
    const search = (start, w, banned = -1, offset = 0) => {
      const dist = new Float64Array(nodes.length).fill(Infinity);
      const via = new Int32Array(nodes.length).fill(-1);
      dist[start] = offset;
      const H = heap();
      H.push(offset, start);
      while (H.size) {
        const [dc, n] = H.pop();
        if (dc > dist[n]) continue;
        for (const e of nodes[n].edges) {
          const m = e.a === n ? e.b : e.a;
          if (m === banned) continue;
          const nd = dc + w[e.id];
          if (nd < dist[m]) {
            dist[m] = nd;
            via[m] = e.id;
            H.push(nd, m);
          }
        }
      }
      return { dist, via, node: start };
    };
    const trees = [];
    for (const shake of [0, 1]) {
      const w = edges.map((e) => e.w * (shake ? 0.6 + 0.8 * toUnit(hash(seed, 'tram-shake', e.id)) : 1));
      const tree = new Map();
      for (const [k, c] of centreNode) {
        const all = search(c.id, w);
        const ways = c.edges.map((f) => ({ first: f.id, t: search(f.a === c.id ? f.b : f.a, w, c.id, w[f.id]) }));
        tree.set(k, { all, ways });
      }
      trees.push(tree);
    }
    const walk = (t, to) => {
      if (!Number.isFinite(t.dist[to])) return null;
      const out = [];
      for (let n = to; n !== t.node; ) {
        const e = edges[t.via[n]];
        out.push(e.id);
        n = e.a === n ? e.b : e.a;
      }
      return out.reverse();
    };
    // The stretches from a centre out to a node, in order (leaving by any
    // street, or by a given one).
    const pathFrom = (tree, k, to) => walk(tree.get(k).all, to);
    const pathsOut = (tree, k, to) =>
      tree
        .get(k)
        .ways.map(({ first, t }) => {
          const p = walk(t, to);
          return p && { first, path: [first, ...p] };
        })
        .filter(Boolean);

    // ---- Candidate routes ----
    // Through a district's centre, out each way to an end: straight out, or
    // by way of the next centre on that way.
    const ends = nodes.filter((n) => n.end);
    const centres = [...centreNode.entries()].map(([k, n]) => ({ k, n }));
    const cands = [];
    const seen = new Set();
    for (const C of centres) {
      const halves = [];
      for (const tree of trees) {
        for (const t of ends) {
          const v = sub(t.p, C.n.p);
          const D = len(v);
          if (D < SPAN[0] / 2 || D > SPAN[1] / 2) continue;
          for (const { first, path } of pathsOut(tree, C.k, t.id)) halves.push({ t, path, via: [], first });
          for (const C2 of centres) {
            if (C2 === C) continue;
            const v2 = sub(C2.n.p, C.n.p);
            if (len(v2) > D - 400 || dot(unit(v2), unit(v)) < Math.cos(ANCHOR_TURN)) continue;
            const b = pathFrom(tree, C2.k, t.id);
            if (!b) continue;
            for (const { first, path } of pathsOut(tree, C.k, C2.n.id)) halves.push({ t, path: [...path, ...b], via: [C2.k], first });
          }
        }
      }
      // (The straightest of them.)
      for (const h of halves) h.straight = h.path.reduce((a, id) => a + edges[id].len, 0) / (len(sub(h.t.p, C.n.p)) || 1);
      halves.sort((a, b) => a.straight - b.straight);
      halves.length = Math.min(halves.length, HALVES);
      const found = [];
      // (From a loop at the centre itself, one half is a route.)
      if (C.n.end) {
        for (const h of halves) {
          const r = routeOf(C.n.id, h.path);
          const D = len(sub(h.t.p, C.n.p));
          if (!r || D < SPAN[0] || r.len > DETOUR * D + DETOUR_ADD || backOf(r.pts, C.n.p, h.t.p, [C.n.p, ...h.via.map((k) => centreNode.get(k).p)]) > BACK) continue;
          const sig = h.path.slice().sort((x, y) => x - y).join(',');
          if (seen.has(sig)) continue;
          seen.add(sig);
          found.push({ ...r, ends: [C.n.id, h.t.id], anchors: [C.k, ...h.via], straight: r.len / D });
        }
      }
      for (let i = 0; i < halves.length; i++) {
        for (let j = i + 1; j < halves.length; j++) {
          const [h1, h2] = [halves[i], halves[j]];
          if (h1.t === h2.t || h1.first === h2.first) continue;
          const A = h1.t.p;
          const B = h2.t.p;
          const D = len(sub(B, A));
          if (D < SPAN[0] || D > SPAN[1]) continue;
          if (dot(unit(sub(A, C.n.p)), unit(sub(B, C.n.p))) > Math.cos(THROUGH)) continue;
          const path = [...h1.path.slice().reverse(), ...h2.path];
          if (new Set(path).size !== path.length) continue;
          const sig = path.slice().sort((x, y) => x - y).join(',');
          if (seen.has(sig)) continue;
          seen.add(sig);
          const r = routeOf(h1.t.id, path);
          if (!r) continue;
          // One overall way; not too roundabout; not mostly over the metro.
          if (backOf(r.pts, A, B, [C.n.p, ...[...h1.via, ...h2.via].map((k) => centreNode.get(k).p)]) > BACK || r.len > DETOUR * D + DETOUR_ADD) continue;
          const metroLen = path.reduce((a, id) => a + edges[id].len * edges[id].metro, 0);
          if (metroLen > METRO_SHARE * r.len) continue;
          found.push({ ...r, ends: [h1.t.id, h2.t.id], anchors: [...h1.via.slice().reverse(), C.k, ...h2.via], straight: r.len / D });
        }
      }
      found.sort((x, y) => x.straight - y.straight);
      cands.push(...found.slice(0, PER_CENTRE));
    }
    // How far a route runs back against the way from its one end to its
    // other (but where it winds about a centre it serves).
    function backOf(pts, A, B, around) {
      const ax = unit(sub(B, A));
      let hi = -Infinity;
      let back = 0;
      for (const q of pts) {
        if (around.some((c) => len(sub(q, c)) < WIND)) continue;
        const t = dot(sub(q, A), ax);
        hi = Math.max(hi, t);
        back = Math.max(back, hi - t);
      }
      return back;
    }
    // The stretches of a path from a node, as one line.
    function routeOf(from, path) {
      const pts = [];
      const nodeList = [from];
      let n = from;
      for (const id of path) {
        const e = edges[id];
        if (e.a !== n && e.b !== n) return null;
        const P = e.a === n ? e.pts : e.pts.slice().reverse();
        for (const q of pts.length ? P.slice(1) : P) pts.push(q);
        n = e.a === n ? e.b : e.a;
        nodeList.push(n);
      }
      return { edges: path, nodes: nodeList, pts, len: lengthOf(pts) };
    }

    // A route made for a neighbourhood: from an end beyond its centre, in
    // through the centre, out along the neighbourhood's own street (its
    // longest stretch in it) and on to an end beyond.
    const growFrom = (from, banned) => {
      const dist = new Float64Array(nodes.length).fill(Infinity);
      const via = new Int32Array(nodes.length).fill(-1);
      dist[from] = 0;
      const H = heap();
      H.push(0, from);
      while (H.size) {
        const [dc, n] = H.pop();
        if (dc > dist[n]) continue;
        for (const e of nodes[n].edges) {
          if (banned.has(e.id)) continue;
          const m = e.a === n ? e.b : e.a;
          const nd = dc + e.w;
          if (nd < dist[m]) {
            dist[m] = nd;
            via[m] = e.id;
            H.push(nd, m);
          }
        }
      }
      return (to) => {
        if (!Number.isFinite(dist[to])) return null;
        const out = [];
        for (let n = to; n !== from; ) {
          const e = edges[via[n]];
          out.push(e.id);
          n = e.a === n ? e.b : e.a;
        }
        return { path: out.reverse(), cost: dist[to] };
      };
    };
    // Each neighbourhood's longest stretches of street (main streets first).
    const longest = new Map();
    for (const e of edges) {
      for (const [h, l] of e.hoods) {
        if (!longest.has(h)) longest.set(h, []);
        longest.get(h).push({ e, v: l * (e.kind === 'main' ? 1.5 : 1) });
      }
    }
    for (const list of longest.values()) list.sort((a, b) => b.v - a.v);
    // Routes through a district's centre that run along a given stretch:
    // in from the centre to one end of it, out of the other and on to an
    // end beyond; back out of the centre the other way.
    function through(dk, e, limit = 1) {
      const C = centreNode.get(dk);
      const found = [];
      if (!C) return found;
      // (Fit to run: one overall way, not too roundabout.)
      const fit = (r, A, B) => r && r.len <= DETOUR * len(sub(B, A)) + DETOUR_ADD && backOf(r.pts, A, B, [C.p]) <= BACK;
      for (const [near, far] of [[e.a, e.b], [e.b, e.a]]) {
        const toNear = pathFrom(trees[0], dk, near);
        if (!toNear || toNear.includes(e.id)) continue;
        const head = [...toNear, e.id];
        const way = unit(sub(nodes[far].p, C.p));
        const out = growFrom(far, new Set(head));
        const outs = [];
        for (const t of ends) {
          if (t === C || dot(unit(sub(t.p, C.p)), way) < 0.3) continue;
          const r = out(t.id);
          if (r) outs.push({ t, ...r });
        }
        outs.sort((p, q) => p.cost - q.cost);
        for (const best of outs.slice(0, 3)) {
          const half = [...head, ...best.path];
          // (From a loop at the centre, that is the route.)
          if (C.end) {
            const r = routeOf(C.id, half);
            if (fit(r, C.p, best.t.p)) found.push({ ...r, ends: [C.id, best.t.id], anchors: [dk] });
            if (found.length >= limit) return found;
            continue;
          }
          const back = growFrom(C.id, new Set(half));
          const others = [];
          for (const t of ends) {
            if (t === best.t || dot(unit(sub(t.p, C.p)), unit(sub(best.t.p, C.p))) > Math.cos(THROUGH)) continue;
            const r = back(t.id);
            if (r) others.push({ t, ...r });
          }
          others.sort((p, q) => p.cost - q.cost);
          for (const other of others.slice(0, 3)) {
            const r = routeOf(other.t.id, [...other.path.slice().reverse(), ...half]);
            if (fit(r, other.t.p, best.t.p)) {
              found.push({ ...r, ends: [other.t.id, best.t.id], anchors: [dk] });
              break;
            }
          }
          if (found.length >= limit) return found;
        }
      }
      return found;
    }
    // A crosstown route along a given stretch: out of each end of it and on
    // to an end beyond, keeping to one way.
    function across(e) {
      const found = [];
      const way = unit(sub(nodes[e.b].p, nodes[e.a].p));
      const outB = growFrom(e.b, new Set([e.id]));
      const tb = [];
      for (const t of ends) {
        if (dot(unit(sub(t.p, nodes[e.b].p)), way) < 0.3) continue;
        const r = outB(t.id);
        if (r) tb.push({ t, ...r });
      }
      tb.sort((p, q) => p.cost - q.cost);
      for (const b of tb.slice(0, 2)) {
        const outA = growFrom(e.a, new Set([e.id, ...b.path]));
        const ta = [];
        for (const t of ends) {
          if (t === b.t || dot(unit(sub(t.p, nodes[e.a].p)), way) > -0.3) continue;
          const r = outA(t.id);
          if (r) ta.push({ t, ...r });
        }
        ta.sort((p, q) => p.cost - q.cost);
        for (const a of ta.slice(0, 2)) {
          const r = routeOf(a.t.id, [...a.path.slice().reverse(), e.id, ...b.path]);
          const D = len(sub(b.t.p, a.t.p));
          if (!r || D < SPAN[0] || r.len > DETOUR * D + DETOUR_ADD || backOf(r.pts, a.t.p, b.t.p, []) > BACK) continue;
          if (new Set(r.edges).size !== r.edges.length) continue;
          found.push({ ...r, ends: [a.t.id, b.t.id], anchors: [] });
          return found;
        }
      }
      return found;
    }
    function seek(hi) {
      const x = hoods[hi];
      if (!centreNode.get(x.d) || !longest.has(hi)) return null;
      for (const { e } of longest.get(hi).slice(0, SEEK_TRIES)) {
        const [r] = through(x.d, e);
        if (r) return { ...r, made: hi };
      }
      return null;
    }
    for (let hi = 0; hi < hoods.length; hi++) {
      if (hoods[hi].joined) continue;
      const c = seek(hi);
      if (c) cands.push(c);
    }

    // ---- Centre to centre ----
    // Each two neighbouring districts: a route through both centres, on
    // beyond each (or, failing that, from a loop at one's station plaza to
    // a loop at the other's). Where neither the metro nor regional rail
    // joins them it must run; elsewhere it is worth running if it can.
    const linkedSet = linked();
    const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    const pairs = [];
    for (const d of ds) {
      for (const k of d.neighbours || []) {
        if (d.key >= k || !centreNode.has(d.key) || !centreNode.has(k)) continue;
        pairs.push({ a: d.key, b: k, must: !linkedSet.has(pairKey(d.key, k)), cands: [] });
      }
    }
    for (const P of pairs) {
      const A = centreNode.get(P.a);
      const B = centreNode.get(P.b);
      const mid = pathFrom(trees[0], P.a, B.id);
      if (!mid || !mid.length) continue;
      const fit = (r, X, Y) => r && r.len <= DETOUR * len(sub(Y, X)) + DETOUR_ADD && backOf(r.pts, X, Y, [A.p, B.p]) <= BACK;
      // On beyond each centre, away from the other.
      const beyond = (from, away, banned) => {
        const grow = growFrom(from.id, banned);
        const out = [];
        for (const t of ends) {
          if (t === from || dot(unit(sub(t.p, from.p)), away) < 0.3) continue;
          const r = grow(t.id);
          if (r) out.push({ t, ...r });
        }
        return out.sort((p, q) => p.cost - q.cost).slice(0, 3);
      };
      const ab = unit(sub(B.p, A.p));
      const outB = B.end ? [{ t: B, path: [] }] : beyond(B, ab, new Set(mid));
      for (const b of outB) {
        const outA = A.end ? [{ t: A, path: [] }] : beyond(A, mul(ab, -1), new Set([...mid, ...b.path]));
        for (const a of outA) {
          const r = routeOf(a.t.id, [...a.path.slice().reverse(), ...mid, ...b.path]);
          if (!r || new Set(r.edges).size !== r.edges.length || !fit(r, a.t.p, b.t.p)) continue;
          P.cands.push({ ...r, ends: [a.t.id, b.t.id], anchors: [P.a, P.b] });
          break;
        }
        if (P.cands.length) break;
      }
      // (Loop to loop between the two plazas.)
      if (!P.cands.length) {
        const r = routeOf(A.id, mid);
        if (r) P.cands.push({ ...r, ends: [A.id, B.id], anchors: [P.a, P.b], plazaLoops: true });
      }
      cands.push(...P.cands);
    }

    // ---- Choosing routes ----
    const covered = new Uint8Array(samples.length);
    const usedEdge = new Uint8Array(edges.length);
    const routes = [];
    const centreIds = new Map([...centreNode].map(([k, n]) => [n.id, k]));
    const prep = (c) => {
      const ss = new Set();
      const anchorSet = new Set(c.anchors);
      const inHood = new Map();
      for (const id of c.edges) {
        for (const s of edges[id].samples) ss.add(s);
        for (const [h, l] of edges[id].hoods) inHood.set(h, (inHood.get(h) || 0) + l);
      }
      c.samples = [...ss];
      c.hoods = [...inHood].filter(([h, l]) => l >= CONNECT && anchorSet.has(hoods[h].d)).map(([h]) => h);
      if (c.made !== undefined && !c.hoods.includes(c.made)) c.hoods.push(c.made);
      // The neighbouring centres it runs straight between.
      const through = new Set(c.nodes.filter((n) => centreIds.has(n)).map((n) => centreIds.get(n)));
      c.pairs = pairs.filter((P) => through.has(P.a) && through.has(P.b));
    };
    for (const c of cands) prep(c);
    // What a route would do now: the people it newly serves (and the
    // neighbourhoods and neighbouring centres it newly joins), less the
    // cost of running it and of the new track it needs.
    const costOf = (c) => {
      let cost = (c.len / 1000) * PER_KM_RUN;
      for (const id of c.edges) if (!usedEdge[id]) cost += (edges[id].len / 1000) * PER_KM_TRACK;
      return cost;
    };
    const gainOf = (c) => {
      let gain = 0;
      for (const s of c.samples) if (!covered[s]) gain += samples[s].w;
      return gain;
    };
    const valueOf = (c) => {
      let gain = gainOf(c);
      for (const h of c.hoods) if (!hoods[h].joined) gain += PER_HOOD;
      for (const P of c.pairs) if (!P.joined) gain += P.must ? PER_PAIR_MUST : PER_PAIR;
      return gain - costOf(c);
    };
    const take = (c) => {
      c.taken = true;
      for (const s of c.samples) covered[s] = 1;
      for (const h of c.hoods) hoods[h].joined = true;
      for (const P of c.pairs) P.joined = true;
      for (const id of c.edges) usedEdge[id] = 1;
      if (c.plazaLoops) for (const n of c.ends) nodes[n].end ||= 'plaza';
      routes.push(c);
    };
    // (Lazily: a route's value only falls as others are chosen, but for the
    // track others lay, so each is worked out again only when it comes to
    // the top.)
    const queue = heap();
    cands.forEach((c, i) => queue.push(-valueOf(c), i));
    while (queue.size) {
      const [nv, i] = queue.pop();
      const c = cands[i];
      if (-nv <= 0) break;
      const v = valueOf(c);
      if (queue.size && v < -queue.peek()[0] - 1e-6) {
        queue.push(-v, i);
        continue;
      }
      if (v <= 0) continue;
      take(c);
    }
    // Neighbouring centres with no metro or rail between them and no route
    // yet: the cheapest that joins them, whatever it costs.
    for (const P of pairs) {
      if (!P.must || P.joined) continue;
      const best = P.cands.filter((c) => !c.taken).sort((x, y) => costOf(x) - costOf(y))[0];
      if (best) take(best);
    }
    // The old town's pedestrian main street: trams run along it (the
    // cheapest route that does, whatever it costs).
    for (const e of edges) {
      if (!e.L.src.pedestrian || usedEdge[e.id]) continue;
      const cs = [...through(e.L.d, e, 2), ...across(e)];
      for (const c of cs) {
        prep(c);
        cands.push(c);
      }
      const best = cs.sort((x, y) => costOf(x) - costOf(y))[0];
      if (best) take(best);
    }
    // Neighbourhoods still not joined to their centres: the routes that
    // join most of them for what they cost, whatever that is.
    for (;;) {
      let best = null;
      for (const c of cands) {
        if (c.taken) continue;
        const n = c.hoods.filter((h) => !hoods[h].joined).length;
        if (!n) continue;
        const v = n / (1 + costOf(c));
        if (!best || v > best.v) best = { c, v };
      }
      if (!best) break;
      take(best.c);
    }
    // Then homes still beyond a short walk of a stop: routes along the
    // streets nearest the biggest gaps, the most people for the track,
    // until nearly everyone is served (or no street comes near enough).
    {
      const total = samples.reduce((a, x) => a + x.w, 0);
      const reach = new Uint8Array(samples.length);
      for (const e of edges) for (const x of e.samples) reach[x] = 1;
      let got = samples.reduce((a, x) => a + (covered[x.id] ? x.w : 0), 0);
      const tried = new Set();
      for (let round = 0; round < COVER_ROUNDS && got < COVER_TARGET * total; round++) {
        // (Candidates through the streets nearest the biggest gaps.)
        const gaps = samples.filter((x) => !covered[x.id] && reach[x.id]).sort((a, b) => b.w - a.w);
        let added = 0;
        for (const g of gaps) {
          if (added >= GAP_TRIES) break;
          let best = null;
          for (const code of segs.near(g.p[0], g.p[1], COVER)) {
            const { L, i, a, b } = segAt(code);
            const ab = sub(b, a);
            const t = Math.max(0, Math.min(1, dot(sub(g.p, a), ab) / (dot(ab, ab) || 1)));
            const r = len(sub(add(a, mul(ab, t)), g.p));
            if (r < COVER && (!best || r < best.r)) best = { r, L, s: L.cum[i - 1] + t * (L.cum[i] - L.cum[i - 1]) };
          }
          if (!best) continue;
          const e = edges.find((x) => x.L === best.L && best.s >= x.s0 - 1 && best.s <= x.s1 + 1);
          if (!e || tried.has(e.id)) continue;
          tried.add(e.id);
          added++;
          for (const c of [...through(e.L.d, e, 2), ...across(e)]) {
            prep(c);
            cands.push(c);
          }
        }
        let best = null;
        for (const c of cands) {
          if (c.taken) continue;
          const gain = gainOf(c);
          if (gain <= 0) continue;
          let track = 0;
          for (const id of c.edges) if (!usedEdge[id]) track += edges[id].len;
          const v = gain / (1 + track / 1000 + (c.len / 1000) * 0.25);
          if (!best || v > best.v) best = { c, v };
        }
        if (!best) {
          if (!added) break;
          continue;
        }
        take(best.c);
        got = samples.reduce((a, x) => a + (covered[x.id] ? x.w : 0), 0);
      }
    }

    // ---- Stops ----
    // Along each route every 300 to 400 m, from loop to loop, and at the
    // station plaza of each centre it passes; one stop where routes share
    // a street.
    const stops = [];
    const stopIdx = index(200);
    const stopNear = (p, e) => {
      for (const s of stopIdx.near(p[0], p[1], STOP_MERGE)) if ([...s.edges].some((x) => edges[x].L === edges[e].L) && len(sub(s.p, p)) < STOP_MERGE) return s;
      return null;
    };
    routes.forEach((r, ri) => {
      r.id = ri;
      const cum = cumOf(r.pts);
      // Where along it each stretch is.
      const at = [];
      let s = 0;
      r.edges.forEach((id) => {
        at.push([s, s + edges[id].len, id]);
        s += edges[id].len;
      });
      const edgeAt = (x) => (at.find(([a, b]) => x >= a && x <= b) || at[at.length - 1])[2];
      const fixed = [0];
      for (const k of r.anchors) {
        const n = centreNode.get(k).id;
        const q = r.nodes.indexOf(n);
        if (q > 0) fixed.push(at[q - 1][1]);
      }
      fixed.push(r.len);
      const marks = [];
      for (let q = 0; q + 1 < fixed.length; q++) {
        const gap = fixed[q + 1] - fixed[q];
        // (As many as keep them 300 to 400 m apart, or nearest that.)
        let n = Math.max(1, Math.round(gap / ((STOP_EVERY[0] + STOP_EVERY[1]) / 2)));
        if (gap / n > STOP_EVERY[1] && gap / (n + 1) >= STOP_EVERY[0]) n++;
        else if (n > 1 && gap / n < STOP_EVERY[0] && gap / (n - 1) <= STOP_EVERY[1]) n--;
        for (let k = 0; k < n; k++) marks.push({ s: fixed[q] + (gap * k) / n, plaza: k === 0 && q > 0 });
      }
      marks.push({ s: r.len, plaza: false });
      r.stops = [];
      for (const m of marks) {
        const p = pointAt(r.pts, cum, m.s);
        const e = edgeAt(m.s);
        let st = stopNear(p, e);
        if (!st) {
          st = { id: stops.length, p, edges: new Set([e]), routes: [], plaza: m.plaza, end: m.s === 0 || m.s === r.len };
          stops.push(st);
          stopIdx.add(p[0], p[1], p[0], p[1], st);
        }
        st.routes.push(ri);
        r.stops.push(st.id);
      }
    });

    // ---- Turning track and loops ----
    const turns = [];
    const loops = [];
    for (const r of routes) {
      for (let q = 1; q < r.nodes.length - 1; q++) {
        const e0 = edges[r.edges[q - 1]];
        const e1 = edges[r.edges[q]];
        if (e0.L === e1.L) continue;
        const n = nodes[r.nodes[q]];
        const P0 = e0.pts;
        const din = e0.b === n.id ? unit(sub(P0[P0.length - 1], P0[Math.max(0, P0.length - 3)])) : unit(sub(P0[0], P0[Math.min(P0.length - 1, 2)]));
        const P1 = e1.pts;
        const dout = e1.a === n.id ? unit(sub(P1[Math.min(P1.length - 1, 2)], P1[0])) : unit(sub(P1[Math.max(0, P1.length - 3)], P1[P1.length - 1]));
        if (Math.acos(Math.max(-1, Math.min(1, dot(din, dout)))) < TURN) continue;
        // (Both ways: a route runs in both directions.)
        if (!turns.some((t) => t.node === n.id && dot(t.in, din) > 0.95 && dot(t.out, dout) > 0.95)) turns.push({ node: n.id, p: n.p, in: din, out: dout, from: e0.L.key, to: e1.L.key, d: e1.L.d });
      }
      for (const [q, nb] of [[0, 1], [r.nodes.length - 1, r.nodes.length - 2]]) {
        const n = nodes[r.nodes[q]];
        if (loops.some((l) => l.node === n.id)) continue;
        loops.push({ node: n.id, p: n.p, dir: unit(sub(n.p, nodes[r.nodes[nb]].p)), at: n.end, d: (q ? edges[r.edges[r.edges.length - 1]] : edges[r.edges[0]]).L.d });
      }
    }

    // ---- What each district holds ----
    const byDistrict = new Map();
    const of = (k) => {
      if (!byDistrict.has(k)) byDistrict.set(k, { ranges: new Map(), runs: [], stops: [], turns: [], loops: [] });
      return byDistrict.get(k);
    };
    const routedEdges = new Map();
    routes.forEach((r) => r.edges.forEach((id) => (routedEdges.get(id) || routedEdges.set(id, []).get(id)).push(r.id)));
    for (const [id, rs] of routedEdges) {
      const e = edges[id];
      const t = of(e.L.d);
      if (!t.ranges.has(e.L.key)) t.ranges.set(e.L.key, []);
      t.ranges.get(e.L.key).push([e.s0, e.s1, rs]);
      // (And the stretch as drawn: the routes along it, in number order so
      // each keeps its place beside the others from one stretch to the next.)
      t.runs.push({ pts: e.pts, routes: rs.slice().sort((a, b) => a - b) });
    }
    for (const t of byDistrict.values()) {
      for (const [k, list] of t.ranges) {
        list.sort((a, b) => a[0] - b[0]);
        const merged = [];
        for (const [a, b] of list) {
          if (merged.length && a - merged[merged.length - 1][1] < 1) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], b);
          else merged.push([a, b]);
        }
        t.ranges.set(k, merged);
      }
    }
    for (const st of stops) {
      const e = edges[[...st.edges][0]];
      const pr = project(e.L.pts, e.L.cum, st.p);
      of(e.L.d).stops.push({ p: st.p, line: e.L.key, s: pr.s, routes: st.routes, plaza: st.plaza, end: st.end });
    }
    for (const x of turns) of(x.d).turns.push(x);
    for (const x of loops) of(x.d).loops.push(x);

    const joinedShare = hoods.filter((x) => x.joined).length / (hoods.length || 1);
    const pop = samples.reduce((a, s) => a + s.w, 0);
    const coveredShare = samples.reduce((a, s) => a + (covered[s.id] ? s.w : 0), 0) / (pop || 1);
    planned = {
      routes: routes.map((r) => ({ id: r.id, pts: r.pts, len: r.len, ends: r.ends.map((n) => ({ p: nodes[n].p, at: nodes[n].end })), anchors: r.anchors, stops: r.stops.map((i) => stops[i].p) })),
      stops,
      turns,
      loops,
      byDistrict,
      judged: { pairs: { must: pairs.filter((P) => P.must).length, mustJoined: pairs.filter((P) => P.must && P.joined).length, all: pairs.length, joined: pairs.filter((P) => P.joined).length }, routes: routes.length, km: routes.reduce((a, r) => a + r.len, 0) / 1000, track: [...routedEdges.keys()].reduce((a, id) => a + edges[id].len, 0) / 1000, joined: joinedShare, covered: coveredShare, hoods: hoods.length, candidates: cands.length, ends: ends.length },
    };
    return planned;
  }
  const empty = { ranges: new Map(), runs: [], stops: [], turns: [], loops: [] };
  return { plan, in: (d) => plan().byDistrict.get(d.key) || empty };
}
