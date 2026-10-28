// The metro, planned for the whole city at once as one network.
//
// Lines run in tunnels under the boulevards, from district centre to
// district centre: each a smooth, continuous line with two ends, running
// fairly straight on through the centres it serves (never back on itself),
// with stations about 800 m apart: at each district centre, and between
// them at what become neighbourhood centres. Lines meet at interchanges at
// district centres, two lines (three at the city centre) to a station.
//
// The lines are laid one at a time where they do most good: between
// districts many people travel between, districts no line serves yet, and
// districts the regional rail does not join directly (a metro under a rail
// line duplicates it). Every line after the first meets one already laid, so
// the metro is one network. Several networks are laid this way, a little
// differently each time, and judged as a whole: on how many pairs of
// districts are a single change apart or better (counting the rail lines),
// how many districts and rail stations it serves, and how near it comes to
// about one station for every 30 000 people. The best is kept.
//
// Track is laid for 80 km/h: curves no tighter than about 300 m.

import { rngFor } from "../core/rng.js";

export const METRO_SPACING = 800; // metres between stations
const SHARE_STATION = 350; // metres: a station this close to another on a line is the same station
const LINK_CLEAR = 250; // metres a station keeps from where the line crosses a greenway
const TURN = (60 * Math.PI) / 180; // the most a line turns at a district centre
const BEND = (150 * Math.PI) / 180; // and all told, end to end
const UNSERVED = 3; // what a network loses for each district centre neither it nor the rail serves
const OLD_TOWN_ALONG = [600, 700, 800]; // metres out from the city centre's core along a metro link the old town's middle may be...
const OLD_TOWN_OFF = 340; // ...and to one side of it
const OLD_TOWN_CLEAR = 280; // metres it keeps from any boulevard, at least
const OLD_TOWN_EDGE = 500; // and from the district's edge
const OLD_TOWN_REJOIN = 500; // metres on from it the bent track rejoins its boulevard
const PER_STATION = 30000; // people for each metro station, about
const PLANS = 40; // whole networks laid out and judged
const MAX_DISTRICTS = 12; // district centres on a line, at most (a few more to reach the city's edge)
const TAIL_CLEAR = 400; // metres a line's run on past its last district keeps from the way into another district
const TAIL_SHORT = 200; // and how far short of the boulevard's end it stops
const TAIL_EDGE = 350; // or, going straight on, of the district's edge
const TAIL_MOST = 2.5; // station spacings, at most
const EDGE_GAP = (110 * Math.PI) / 180; // a district with no neighbour in the city over this wide an angle is on its edge
export const METRO_RADIUS = 300; // metres: the tightest curve
const SAMPLE = 40; // metres between points of line
export const METRO_COLOURS = ["#e3342f", "#3490dc", "#f6993f", "#38a169", "#9561e2", "#f66d9b", "#00a3a3", "#a0522d", "#d4a017", "#2d3a8c", "#6b8e23", "#c71585", "#4a5568", "#e67e22"];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (v) => Math.hypot(v[0], v[1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const unit = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b)))));

function lengthOf(P) {
  let L = 0;
  for (let i = 1; i < P.length; i++) L += len(sub(P[i], P[i - 1]));
  return L;
}
function pointAlong(P, s) {
  for (let i = 1; i < P.length; i++) {
    const l = len(sub(P[i], P[i - 1]));
    if (s <= l) return add(P[i - 1], mul(sub(P[i], P[i - 1]), s / (l || 1)));
    s -= l;
  }
  return P[P.length - 1];
}
// The nearest point on a polyline, and how far along it lies.
function project(P, q) {
  let best = { r: Infinity, s: 0, p: P[0] };
  let s0 = 0;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1];
    const ab = sub(P[i], a);
    const l2 = dot(ab, ab);
    const l = Math.sqrt(l2);
    const t = l2 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2)) : 0;
    const f = add(a, mul(ab, t));
    const r = len(sub(q, f));
    if (r < best.r) best = { r, s: s0 + l * t, p: f };
    s0 += l;
  }
  return best;
}
function resample(P, step) {
  const L = lengthOf(P);
  const n = Math.max(1, Math.round(L / step));
  const out = [];
  for (let k = 0; k <= n; k++) out.push(pointAlong(P, (L * k) / n));
  return out;
}

// The tightest radius along a polyline.
export function minRadius(P) {
  let r = Infinity;
  for (let i = 1; i < P.length - 1; i++) {
    const u = sub(P[i], P[i - 1]);
    const v = sub(P[i + 1], P[i]);
    const a = Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], dot(u, v)));
    if (a > 1e-6) r = Math.min(r, (len(u) + len(v)) / 2 / a);
  }
  return r;
}

// A smooth line through the way P runs: through points about CONTROL apart
// along it (and through the fixed points, district centres), dropping any
// that would double back, then smoothed until no curve is tighter than the
// line allows (its ends kept).
const CONTROL = 450;
function smoothLine(P, fixed = []) {
  const L = lengthOf(P);
  const at = fixed.map((q) => project(P, q).s).sort((a, b) => a - b);
  const marks = [0, L, ...at];
  for (let k = 0; k < at.length + 1; k++) {
    const a = k ? at[k - 1] : 0;
    const b = k < at.length ? at[k] : L;
    const n = Math.max(0, Math.round((b - a) / CONTROL) - 1);
    for (let q = 1; q <= n; q++) marks.push(a + ((b - a) * q) / (n + 1));
  }
  marks.sort((a, b) => a - b);
  // (Control points well apart, but never losing a fixed one.)
  const keep = [];
  for (const m of marks) {
    const fx = at.includes(m);
    const prev = keep[keep.length - 1];
    if (prev === undefined || m - prev.m > 60) keep.push({ m, fx });
    else if (fx && !prev.fx) keep[keep.length - 1] = { m, fx };
  }
  let C = keep.map(({ m }) => pointAlong(P, m));
  const isFixed = (q) => fixed.some((f) => len(sub(f, q)) < 1);
  for (let changed = true; changed && C.length > 2; ) {
    changed = false;
    for (let i = 1; i < C.length - 1; i++) {
      if (isFixed(C[i])) continue;
      if (angleBetween(sub(C[i], C[i - 1]), sub(C[i + 1], C[i])) > Math.PI / 2) {
        C.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  // Catmull-Rom through the control points.
  let Q = [];
  for (let i = 0; i < C.length - 1; i++) {
    const p0 = C[Math.max(0, i - 1)];
    const p1 = C[i];
    const p2 = C[i + 1];
    const p3 = C[Math.min(C.length - 1, i + 2)];
    const k = Math.max(2, Math.ceil(len(sub(p2, p1)) / SAMPLE));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const t2 = t * t;
      const t3 = t2 * t;
      Q.push([0, 1].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
    }
  }
  Q.push(C[C.length - 1]);
  Q = resample(Q, SAMPLE);
  for (let it = 0; it < 200 && minRadius(Q) < METRO_RADIUS; it++) {
    const R = Q.slice();
    for (let i = 1; i < Q.length - 1; i++) {
      R[i] = i < 2 || i > Q.length - 3 ? [0, 1].map((c) => (Q[i - 1][c] + 2 * Q[i][c] + Q[i + 1][c]) / 4) : [0, 1].map((c) => (Q[i - 2][c] + 4 * Q[i - 1][c] + 6 * Q[i][c] + 4 * Q[i + 1][c] + Q[i + 2][c]) / 16);
    }
    Q = R;
  }
  return Q;
}

// The shortest way along a district's boulevards from a to b.
export function route(lines, a, b) {
  const pts = [];
  const adj = [];
  const key = (q) => `${Math.round(q[0])},${Math.round(q[1])}`;
  const at = new Map();
  const node = (q) => {
    const k = key(q);
    if (at.has(k)) return at.get(k);
    at.set(k, pts.length);
    pts.push(q);
    adj.push([]);
    return pts.length - 1;
  };
  for (const L of lines) {
    let prev = -1;
    for (const q of L) {
      const n = node(q);
      if (prev >= 0 && prev !== n) {
        const w = len(sub(pts[prev], q));
        adj[prev].push([n, w]);
        adj[n].push([prev, w]);
      }
      prev = n;
    }
  }
  const nearest = (q) => {
    let best = -1;
    let bd = Infinity;
    pts.forEach((p, i) => {
      const r = len(sub(p, q));
      if (r < bd) [best, bd] = [i, r];
    });
    return best;
  };
  const s = nearest(a);
  const t = nearest(b);
  if (s < 0 || t < 0) return [a, b];
  const D = new Float64Array(pts.length).fill(Infinity);
  const from = new Int32Array(pts.length).fill(-1);
  const done = new Uint8Array(pts.length);
  D[s] = 0;
  // A binary heap of [distance, node].
  const heap = [[0, s]];
  const push = (e) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [du, u] = pop();
    if (done[u] || du > D[u]) continue;
    if (u === t) break;
    done[u] = 1;
    for (const [v, w] of adj[u]) {
      if (du + w < D[v]) {
        D[v] = du + w;
        from[v] = u;
        push([D[v], v]);
      }
    }
  }
  if (D[t] === Infinity) return [a, b];
  const out = [];
  for (let v = t; v >= 0; v = from[v]) out.push(pts[v]);
  return [a, ...out.reverse(), b];
}

// cores: the city's cores, the central one first. base(core) and
// network(base) give each district's outline and boulevards.
export function createMetro(seed, { cores, base, network, rail, population, isWater }) {
  let planned = null;
  function plan() {
    if (planned) return planned;
    planned = { lines: [], stations: [], byKey: new Map(), segments: [] };
    const N = cores.length;
    if (N < 2) return planned;
    const B = cores.map((c) => base(c));
    const nets = B.map((b) => network(b));
    const idx = new Map(B.map((b, i) => [b.key, i]));
    const S = B.map((b) => b.station);
    // (The city centre's under the central station's plaza, by its hall.)
    const central = rail.stations.find((st) => st.central);
    if (central && central.site) S[0] = central.site.front.slice();

    // ---- Links between district centres, along the boulevards ----
    const edges = [];
    const edgeAt = new Map(); // "i|j" -> edge
    // (Not a boulevard out into the country: the metro keeps to the city.)
    const outOf = (i) => nets[i].links.filter((lk) => lk.country).map((lk) => lk.p);
    const toCountry = (i, P) => outOf(i).some((q) => [P[0], P[P.length - 1]].some((e) => len(sub(e, q)) < 1));
    const linesOf = (i) => nets[i].lines.filter((l) => l.kind !== "roundabout" && !toCountry(i, l.points)).map((l) => l.points);
    for (let i = 0; i < N; i++) {
      for (const l of nets[i].links) {
        const j = idx.get(l.neighbour);
        if (j === undefined || j <= i || edgeAt.has(`${i}|${j}`)) continue;
        const back = nets[j].links.find((m) => m.key === l.key) || nets[j].links.find((m) => m.neighbour === B[i].key);
        if (!back) continue;
        const a = route(linesOf(i), S[i], l.p);
        const b = route(linesOf(j), back.p, S[j]);
        const pts = resample([...a, ...b.slice(1)], SAMPLE);
        const e = { id: edges.length, i, j, pts, L: lengthOf(pts), cross: l.p, rail: rail.joins(B[i].key, B[j].key) };
        e.crossAt = project(pts, l.p).s;
        edges.push(e);
        edgeAt.set(`${i}|${j}`, e);
        edgeAt.set(`${j}|${i}`, e);
      }
    }
    const adj = Array.from({ length: N }, () => []);
    for (const e of edges) {
      adj[e.i].push(e);
      adj[e.j].push(e);
    }
    // The way a link leaves a district centre.
    for (const e of edges) {
      const d = Math.min(600, e.L / 2);
      e.out = [unit(sub(pointAlong(e.pts, d), e.pts[0])), unit(sub(pointAlong(e.pts, e.L - d), e.pts[e.pts.length - 1]))];
    }
    const leave = (e, from) => (from === e.i ? e.out[0] : e.out[1]);
    const other = (e, n) => (e.i === n ? e.j : e.i);
    // A district on the city's edge: one with a boulevard out of the city,
    // or a wide side with no district of the city beyond it.
    const atEdge = S.map((p, n) => {
      // (A boulevard out into the country, running on as a road, is not one.)
      if (nets[n].links.some((l) => !l.country && !idx.has(l.neighbour))) return true;
      const a = adj[n].map((e) => Math.atan2(S[other(e, n)][1] - p[1], S[other(e, n)][0] - p[0])).sort((x, y) => x - y);
      if (a.length < 2) return true;
      for (let k = 0; k < a.length; k++) if ((k + 1 < a.length ? a[k + 1] : a[0] + 2 * Math.PI) - a[k] > EDGE_GAP) return true;
      return false;
    });
    // How far a line turns all told, from one end to the other (signed
    // turns summed, so a wiggle is not a curl).
    const bend = (l) => {
      let t = 0;
      for (let q = 1; q < l.nodes.length - 1; q++) {
        const n = l.nodes[q];
        const a = mul(leave(l.edges[q - 1], n), -1);
        const b = leave(l.edges[q], n);
        t += Math.atan2(a[0] * b[1] - a[1] * b[0], dot(a, b));
      }
      return Math.abs(t);
    };

    // ---- Demand between districts ----
    // People in each district (by area), the centre drawing more for its jobs.
    const weight = B.map((b, i) => (b.area / 1e6) * (i === 0 ? 3 : 1));
    const demandOf = new Float64Array(N * N);
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) demandOf[a * N + b] = (weight[a] * weight[b]) / (len(sub(S[a], S[b])) / 1000 + 2) ** 1.3;
    const demand = (a, b) => demandOf[a * N + b];
    // The rail lines, as sets of districts, for counting changes.
    const railSets = rail.lines.map((l) => new Set(l.stations.map((s) => cores[s] && idx.get(cores[s].key)).filter((x) => x !== undefined)));
    const railAt = new Set(rail.stations.filter((s) => s.key && idx.has(s.key)).map((s) => idx.get(s.key)));
    const target = Math.max(4, Math.round(population / PER_STATION));
    const railServes = (n) => railAt.has(n);
    const stationsOn = (e) => Math.max(0, Math.round(e.L / METRO_SPACING) - 1);

    // ---- Judging a network ----
    function judge(lines) {
      const sets = [...railSets, ...lines.map((l) => new Set(l.nodes))];
      const linesAt = Array.from({ length: N }, () => []);
      sets.forEach((s, k) => s.forEach((n) => linesAt[n].push(k)));
      const meets = sets.map((a) => sets.map((b) => a === b || [...a].some((n) => b.has(n))));
      let one = 0;
      let pairs = 0;
      let weighted = 0;
      let wsum = 0;
      for (let a = 0; a < N; a++) {
        for (let b = a + 1; b < N; b++) {
          const ok = linesAt[a].some((x) => linesAt[b].some((y) => meets[x][y]));
          pairs++;
          const w = demand(a, b);
          wsum += w;
          if (ok) {
            one++;
            weighted += w;
          }
        }
      }
      const onMetro = new Set(lines.flatMap((l) => l.nodes));
      let stations = 0;
      const used = new Map();
      for (const l of lines) for (const e of l.edges) used.set(e.id, (used.get(e.id) || 0) + 1);
      let dup = 0;
      let railDup = 0;
      for (const [id, n] of used) {
        const e = edges[id];
        stations += stationsOn(e);
        dup += (n - 1) * e.L;
        if (e.rail) railDup += e.L;
      }
      stations += onMetro.size;
      const railServed = railAt.size ? [...railAt].filter((n) => onMetro.has(n)).length / railAt.size : 1;
      // Every district reachable without passing through the centre.
      let bypass = 1;
      if (N > 3) {
        const seen = new Set([1]);
        const stack = [1];
        while (stack.length) {
          const n = stack.pop();
          for (const k of linesAt[n])
            for (const m of sets[k])
              if (m !== 0 && !seen.has(m) && [...sets[k]].length) {
                seen.add(m);
                stack.push(m);
              }
        }
        bypass = seen.size / (N - 1);
      }
      // (Every district centre must be served, by the metro or the rail.)
      let unserved = 0;
      for (let n = 0; n < N; n++) if (!onMetro.has(n) && !railAt.has(n)) unserved++;
      const score = -UNSERVED * unserved + 4 * (one / pairs) + 4 * (weighted / wsum) + 2 * (onMetro.size / N) + railServed + bypass - (2 * Math.abs(stations - target)) / target - (dup + 0.5 * railDup) / 20000 - 0.1 * lines.length;
      return { score, one: one / pairs, stations, served: onMetro.size, railServed, bypass };
    }

    // ---- Laying one network ----
    function lay(salt) {
      const r = rngFor(seed, "metro", salt);
      const rng = () => r.next();
      const lines = [];
      const usedEdge = new Map();
      const linesAtNode = new Array(N).fill(0);
      const cap = (n) => (n === 0 ? 3 : 2);
      let stations = 0;
      const stationsOfLine = (l) => l.edges.reduce((a, e) => a + (usedEdge.get(e.id) ? 0 : stationsOn(e)), 0) + l.nodes.filter((n) => !linesAtNode[n]).length;
      // How much good a district does a line: more if no line serves it yet.
      const worth = (n, nodes) => {
        let g = linesAtNode[n] ? 0.5 : 2;
        for (const m of nodes) g += demand(n, m) / (weight[0] * 0.2);
        return g;
      };
      // The best district to carry a line on to from either end, if any.
      const onward = (l) => {
        let best = null;
        for (const end of [0, 1]) {
          const n = end ? l.nodes[l.nodes.length - 1] : l.nodes[0];
          const prev = end ? l.nodes[l.nodes.length - 2] : l.nodes[1];
          const inE = end ? l.edges[l.edges.length - 1] : l.edges[0];
          const arrive = mul(leave(inE, n), -1);
          const far = end ? l.nodes[0] : l.nodes[l.nodes.length - 1];
          for (const e of adj[n]) {
            const m = other(e, n);
            if (l.nodes.includes(m) || linesAtNode[m] >= cap(m) || (usedEdge.get(e.id) || 0) >= 1) continue;
            // Straight on through the centre, both by the boulevards and
            // from centre to centre.
            const turn = angleBetween(arrive, leave(e, n));
            if (turn > TURN || angleBetween(sub(S[n], S[prev]), sub(S[m], S[n])) > TURN * 1.25) continue;
            // No more than a half circle all told, and never back near
            // its other end.
            if (bend(l) + turn > BEND || (l.nodes.length > 2 && len(sub(S[m], S[far])) < 0.5 * len(sub(S[n], S[far])))) continue;
            let g = worth(m, l.nodes) * (e.rail ? 0.35 : 1) - 0.8 * turn - 0.4;
            g *= 0.7 + 0.6 * rng();
            if (g > 0.6 && (!best || g > best.g)) best = { g, end, e, m };
          }
        }
        return best;
      };
      const extend = (l, x) => {
        if (x.end) {
          l.nodes.push(x.m);
          l.edges.push(x.e);
        } else {
          l.nodes.unshift(x.m);
          l.edges.unshift(x.e);
        }
      };
      // The straightest way along the links from a to b: never turning
      // more than a line may at a centre, through no centre already full,
      // keeping off links other lines (or the rail) already take.
      const path = (a, b) => {
        const states = new Map(); // "node|edge" -> { cost, node, edge, from }
        const open = [{ cost: 0, node: a, edge: null, from: null }];
        states.set(`${a}|-`, open[0]);
        while (open.length) {
          let k = 0;
          for (let q = 1; q < open.length; q++) if (open[q].cost < open[k].cost) k = q;
          const st = open.splice(k, 1)[0];
          if (st.done) continue;
          st.done = true;
          if (st.node === b) {
            const nodes = [];
            const es = [];
            for (let x = st; x; x = x.from) {
              nodes.unshift(x.node);
              if (x.edge) es.unshift(x.edge);
            }
            if (new Set(nodes).size !== nodes.length) return null;
            return { nodes, edges: es };
          }
          const n = st.node;
          for (const e of adj[n]) {
            const m = other(e, n);
            if (linesAtNode[m] >= cap(m) || e === st.edge) continue;
            let turn = 0;
            if (st.edge) {
              turn = angleBetween(mul(leave(st.edge, n), -1), leave(e, n));
              const prev = other(st.edge, n);
              if (turn > TURN || angleBetween(sub(S[n], S[prev]), sub(S[m], S[n])) > TURN * 1.25) continue;
            }
            const c = st.cost + e.L * (1 + (e.rail ? 0.8 : 0) + (usedEdge.get(e.id) > 0 ? 3 : 0)) + 900 * turn;
            const key = `${m}|${e.id}`;
            const old = states.get(key);
            if (old && old.cost <= c) continue;
            const ns = { cost: c, node: m, edge: e, from: st };
            states.set(key, ns);
            open.push(ns);
          }
        }
        return null;
      };
      const diameter = Math.max(...S.map((p) => len(sub(p, S[0])))) * 2;
      let throughCentre = N >= 10 ? 2 : N >= 4 ? 1 : 0;
      for (let attempt = 0; attempt < 60 && (stations < target * 0.9 || (linesAtNode.some((x, n) => !x && !railServes(n)) && stations < target * 1.1)); attempt++) {
        // A district no line serves yet, next to a line's end: the line
        // carried on, rather than a new one, where it can be.
        let more = null;
        for (const l of lines) {
          if (l.nodes.length >= MAX_DISTRICTS) continue;
          const x = onward(l);
          if (x && !linesAtNode[x.m] && (!more || x.g > more.x.g)) more = { l, x };
        }
        if (more && stations + stationsOn(more.x.e) + 1 < target * 1.1) {
          extend(more.l, more.x);
          usedEdge.set(more.x.e.id, 1);
          linesAtNode[more.x.m]++;
          stations += stationsOn(more.x.e) + 1;
          continue;
        }
        // Otherwise a new line across the city, between two districts far
        // apart; after the first, meeting a line already laid.
        // (Once the long lines are laid, shorter ones between them.)
        let pick = null;
        for (const reach of N > 8 ? [0.3, 0.15, 0.05] : [0.15, 0.05]) {
          if (pick) break;
          for (let t = 0; t < 120; t++) {
            const x = Math.floor(rng() * N);
            const y = Math.floor(rng() * N);
            if (x === y || linesAtNode[x] >= cap(x) || linesAtNode[y] >= cap(y)) continue;
            const D = len(sub(S[x], S[y]));
            if (D < diameter * reach) continue;
            // The first lines run through the city centre, from one side
            // to the other.
            let l;
            if (lines.length < throughCentre) {
              if (x === 0 || y === 0 || angleBetween(sub(S[x], S[0]), sub(S[y], S[0])) < (120 * Math.PI) / 180) continue;
              const a = path(x, 0);
              const b = a && path(0, y);
              if (!b) continue;
              const ea = a.edges[a.edges.length - 1];
              if (angleBetween(mul(leave(ea, 0), -1), leave(b.edges[0], 0)) > TURN) continue;
              l = { nodes: [...a.nodes, ...b.nodes.slice(1)], edges: [...a.edges, ...b.edges] };
              if (new Set(l.nodes).size !== l.nodes.length) continue;
            } else l = path(x, y);
            if (!l || l.nodes.length > MAX_DISTRICTS || l.edges.length < (N > 3 ? 2 : 1)) continue;
            if (lines.length && !l.nodes.some((n) => linesAtNode[n] > 0)) continue;
            if (bend(l) > BEND) continue;
            if (l.edges.every((e) => usedEdge.get(e.id) > 0)) continue;
            const L = l.edges.reduce((q, e) => q + e.L, 0);
            if (L > D * 1.6) continue;
            let v = 0;
            for (const n of l.nodes) v += linesAtNode[n] ? 0.3 : 2;
            // Each line it meets (metro or rail) is a change fewer for many trips.
            const meets = new Set();
            for (const n of l.nodes) {
              lines.forEach((o, k) => o.nodes.includes(n) && meets.add(`m${k}`));
              railSets.forEach((o, k) => o.has(n) && meets.add(`r${k}`));
            }
            v += 0.8 * meets.size;
            for (const e of l.edges) v -= (e.rail ? 0.7 : 0) + (usedEdge.get(e.id) > 0 ? 1.5 : 0);
            for (let q = 0; q < l.nodes.length; q++) for (let r = q + 1; r < l.nodes.length; r++) v += demand(l.nodes[q], l.nodes[r]) / (weight[0] * 0.5);
            v *= 0.8 + 0.4 * rng();
            const cost = stationsOfLine(l);
            if (stations + cost > target * 1.15) continue;
            if (!pick || v > pick.v) pick = { v, l };
          }
        }
        if (!pick && lines.length < throughCentre) {
          // (No way straight through the centre: lines elsewhere instead.)
          throughCentre = lines.length;
          continue;
        }
        if (!pick) break;
        const l = pick.l;
        stations += stationsOfLine(l);
        for (const e of l.edges) usedEdge.set(e.id, (usedEdge.get(e.id) || 0) + 1);
        for (const n of l.nodes) linesAtNode[n]++;
        lines.push(l);
      }
      // A district with no station of any kind next to a line's end: the
      // line carried on to it, turning a little more if need be.
      for (let more = true; more; ) {
        more = false;
        for (const l of lines) {
          if (l.nodes.length >= MAX_DISTRICTS) continue;
          for (const end of [0, 1]) {
            const n = end ? l.nodes[l.nodes.length - 1] : l.nodes[0];
            const prev = end ? l.nodes[l.nodes.length - 2] : l.nodes[1];
            const inE = end ? l.edges[l.edges.length - 1] : l.edges[0];
            const e = adj[n].find((e) => {
              const m = other(e, n);
              return !linesAtNode[m] && !railServes(m) && !usedEdge.get(e.id) && angleBetween(mul(leave(inE, n), -1), leave(e, n)) < TURN * 1.35 && angleBetween(sub(S[n], S[prev]), sub(S[m], S[n])) < TURN * 1.6;
            });
            if (!e) continue;
            extend(l, { end, e, m: other(e, n) });
            usedEdge.set(e.id, 1);
            linesAtNode[other(e, n)]++;
            more = true;
            break;
          }
          if (more) break;
        }
      }
      // A line ending one link short of another line or a rail station,
      // where no other line meets it: carried on to it, so its end is an
      // interchange rather than a near miss.
      const meets = (n, l) => railServes(n) || lines.some((o) => o !== l && o.nodes.includes(n));
      for (const l of lines) {
        for (const end of [0, 1]) {
          if (l.nodes.length >= MAX_DISTRICTS) break;
          const n = end ? l.nodes[l.nodes.length - 1] : l.nodes[0];
          if (meets(n, l)) continue;
          const prev = end ? l.nodes[l.nodes.length - 2] : l.nodes[1];
          const inE = end ? l.edges[l.edges.length - 1] : l.edges[0];
          let best = null;
          for (const e of adj[n]) {
            const m = other(e, n);
            if (l.nodes.includes(m) || !meets(m, l) || linesAtNode[m] >= cap(m) || usedEdge.get(e.id) > 0) continue;
            const turn = angleBetween(mul(leave(inE, n), -1), leave(e, n));
            if (turn > TURN * 1.35 || angleBetween(sub(S[n], S[prev]), sub(S[m], S[n])) > TURN * 1.6) continue;
            if (!best || turn < best.turn) best = { turn, e, m };
          }
          if (!best) continue;
          extend(l, { end, e: best.e, m: best.m });
          usedEdge.set(best.e.id, 1);
          linesAtNode[best.m]++;
        }
      }
      // A line ending inside the city is carried on, a district at a time,
      // to one on its edge: through an interchange that is full if need be
      // (so it ends there rather than short of it), straight on as far as
      // it can.
      for (const l of lines) {
        for (const end of [0, 1]) {
          for (let guard = 0; guard < 6; guard++) {
            const n = end ? l.nodes[l.nodes.length - 1] : l.nodes[0];
            if (atEdge[n] || l.nodes.length >= MAX_DISTRICTS + 2) break;
            const prev = end ? l.nodes[l.nodes.length - 2] : l.nodes[1];
            const inE = end ? l.edges[l.edges.length - 1] : l.edges[0];
            let best = null;
            for (const e of adj[n]) {
              const m = other(e, n);
              if (l.nodes.includes(m) || linesAtNode[m] > cap(m)) continue;
              const turn = angleBetween(mul(leave(inE, n), -1), leave(e, n));
              if (turn > TURN * 1.35 || angleBetween(sub(S[n], S[prev]), sub(S[m], S[n])) > TURN * 1.6 || bend(l) + turn > BEND) continue;
              const cost = turn + (usedEdge.get(e.id) > 0 ? 1 : 0) + (e.rail ? 0.3 : 0) - (atEdge[m] ? 0.3 : 0);
              if (!best || cost < best.cost) best = { cost, e, m };
            }
            if (!best) break;
            extend(l, { end, e: best.e, m: best.m });
            usedEdge.set(best.e.id, (usedEdge.get(best.e.id) || 0) + 1);
            linesAtNode[best.m]++;
          }
        }
      }
      // Short lines meeting end to end, running on straight, become one.
      for (let merged = true; merged; ) {
        merged = false;
        for (const a of lines) {
          for (const b of lines) {
            if (a === b || a.nodes.length + b.nodes.length - 1 > MAX_DISTRICTS || Math.min(a.nodes.length, b.nodes.length) > 3) continue;
            for (const [A, B] of [
              [a, b],
              [a, { nodes: b.nodes.slice().reverse(), edges: b.edges.slice().reverse() }],
            ]) {
              const n = A.nodes[A.nodes.length - 1];
              if (B.nodes[0] !== n || A.nodes.slice(0, -1).some((x) => B.nodes.includes(x))) continue;
              const turn = angleBetween(mul(leave(A.edges[A.edges.length - 1], n), -1), leave(B.edges[0], n));
              const joined = { nodes: [...A.nodes, ...B.nodes.slice(1)], edges: [...A.edges, ...B.edges] };
              if (turn > TURN || bend(joined) > BEND) continue;
              a.nodes = joined.nodes;
              a.edges = joined.edges;
              lines.splice(lines.indexOf(b), 1);
              linesAtNode[n]--;
              merged = true;
              break;
            }
            if (merged) break;
          }
          if (merged) break;
        }
      }
      for (const [id, n] of usedEdge) if (n < 0) usedEdge.delete(id);
      return lines;
    }

    let best = null;
    for (let k = 0; k < PLANS; k++) {
      const lines = lay(k);
      if (!lines.length) continue;
      const j = judge(lines);
      if (!best || j.score > best.j.score) best = { lines, j };
    }
    if (!best) return planned;

    // Every district centre served: one neither the metro nor the rail
    // serves gets a line carried on to it from an end next door (as
    // straight on as may be), or else a short line of its own to the
    // nearest centre a line serves.
    const onMetro = () => new Set(best.lines.flatMap((l) => l.nodes));
    for (let n = 0; n < N; n++) {
      if (railServes(n) || onMetro().has(n)) continue;
      let pick = null;
      for (const l of best.lines) {
        for (const end of [0, 1]) {
          const m = end ? l.nodes[l.nodes.length - 1] : l.nodes[0];
          const e = adj[m].find((x) => other(x, m) === n);
          if (!e) continue;
          const inE = end ? l.edges[l.edges.length - 1] : l.edges[0];
          const turn = angleBetween(mul(leave(inE, m), -1), leave(e, m));
          if (turn > TURN * 1.6) continue;
          if (!pick || turn < pick.turn) pick = { turn, l, end, e };
        }
      }
      if (pick) {
        if (pick.end) {
          pick.l.nodes.push(n);
          pick.l.edges.push(pick.e);
        } else {
          pick.l.nodes.unshift(n);
          pick.l.edges.unshift(pick.e);
        }
        continue;
      }
      const served = onMetro();
      const e = adj[n].filter((x) => served.has(other(x, n)) || railServes(other(x, n))).sort((a, b) => a.L - b.L)[0];
      if (e) best.lines.push({ nodes: [n, other(e, n)], edges: [e] });
    }

    // ---- The old town ----
    // Beside the city centre's core, between its boulevards: a pedestrian
    // quarter with a metro station at its middle. The metro's line out of
    // the centre nearest it is bent through it (the tunnel need not keep
    // under the boulevard), with a station there.
    let oldTown = null;
    {
      const core = B[0].station;
      const blvds = linesOf(0);
      const fromBlvd = (q) => {
        let r = Infinity;
        for (const P of blvds) r = Math.min(r, project(P, q).r);
        return r;
      };
      const ring = B[0].ring;
      const inside = (q) => {
        let c = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          if (ring[i][1] > q[1] !== ring[j][1] > q[1] && q[0] < ((ring[j][0] - ring[i][0]) * (q[1] - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c;
        }
        return c;
      };
      const fromRing = (q) => project(ring.concat([ring[0]]), q).r;
      const used = new Set(best.lines.flatMap((l) => l.edges).filter((e) => e.i === 0 || e.j === 0));
      let pick = null;
      for (const e of [...used].sort((a, b) => a.id - b.id)) {
        const d = leave(e, 0);
        const n = [-d[1], d[0]];
        for (const along of OLD_TOWN_ALONG) {
          for (const side of [1, -1]) {
            const q = add(core, add(mul(d, along), mul(n, side * OLD_TOWN_OFF)));
            if (!inside(q) || (isWater && isWater(q[0], q[1])) || fromRing(q) < OLD_TOWN_EDGE) continue;
            const r = fromBlvd(q);
            if (r < OLD_TOWN_CLEAR) continue;
            const score = Math.min(r, OLD_TOWN_OFF * 1.5) - Math.abs(along - OLD_TOWN_ALONG[1]) * 0.3;
            if (!pick || score > pick.score) pick = { score, q, e, d };
          }
        }
      }
      if (pick) {
        // The link's track bent through it, rejoining the boulevard a way on.
        const e = pick.e;
        const fwd = e.i === 0 ? e.pts : e.pts.slice().reverse();
        const pr = project(fwd, pick.q);
        const sR = Math.min(lengthOf(fwd) - 50, pr.s + OLD_TOWN_REJOIN);
        const R = pointAlong(fwd, sR);
        const tail = fwd.filter((_, i) => lengthOf(fwd.slice(0, i + 1)) > sR);
        const knots = [fwd[0], pick.q, R];
        // (A smooth curve through the three, then on along the boulevard.)
        const curve = [];
        const t0 = unit(sub(pick.q, fwd[0]));
        const t2 = unit(sub(pointAlong(fwd, sR + 20), R));
        const tq = unit(sub(R, fwd[0]));
        const herm = (a, b, ta, tb, k) => {
          const L = len(sub(b, a));
          for (let i = 0; i <= k; i++) {
            const t = i / k;
            const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
            const h10 = t ** 3 - 2 * t ** 2 + t;
            const h01 = -2 * t ** 3 + 3 * t ** 2;
            const h11 = t ** 3 - t ** 2;
            curve.push([0, 1].map((c) => h00 * a[c] + h10 * L * ta[c] + h01 * b[c] + h11 * L * tb[c]));
          }
        };
        herm(knots[0], knots[1], t0, tq, 20);
        curve.pop();
        herm(knots[1], knots[2], tq, t2, 20);
        const pts = resample([...curve, ...tail], SAMPLE);
        e.pts = e.i === 0 ? pts : pts.slice().reverse();
        e.L = lengthOf(e.pts);
        e.crossAt = project(e.pts, e.cross).s;
        e.oldTownAt = project(e.pts, pick.q).s;
        oldTown = { p: pick.q, dir: pick.d, key: B[0].key };
      }
    }

    // ---- Stations along each link ----
    // At each district centre, and between them about METRO_SPACING apart,
    // clear of the greenway crossing; shared by every line on the link.
    const linkStations = new Map(); // edge id -> [{ s, p, key }]
    const stationList = [];
    const coreStation = new Map();
    const station = (p, key, core, extra = {}) => {
      const st = { id: stationList.length, p, key, core, lines: [], ...extra };
      stationList.push(st);
      return st;
    };
    for (const l of best.lines) for (const n of l.nodes) if (!coreStation.has(n)) coreStation.set(n, station(S[n], B[n].key, true, { central: n === 0 }));
    for (const l of best.lines) {
      for (const e of l.edges) {
        if (linkStations.has(e.id)) continue;
        // (Through the old town: a station there, the rest spaced either side.)
        const marks = [];
        const spread = (a, b) => {
          const n = Math.max(0, Math.round((b - a) / METRO_SPACING) - 1);
          for (let k = 1; k <= n; k++) marks.push(a + ((b - a) * k) / (n + 1));
        };
        if (e.oldTownAt !== undefined) {
          spread(0, e.oldTownAt);
          spread(e.oldTownAt, e.L);
        } else spread(0, e.L);
        const list = [];
        const at = new Map(); // station -> where along the link
        if (e.oldTownAt !== undefined) {
          const st = station(pointAlong(e.pts, e.oldTownAt), B[0].key, false, { oldTown: true });
          list.push(st);
          at.set(st, e.oldTownAt);
        }
        for (const m of marks) {
          let s = m;
          // Clear of the greenway, on the side nearer its even place.
          if (Math.abs(s - e.crossAt) < LINK_CLEAR) s = e.crossAt + (s < e.crossAt ? -LINK_CLEAR : LINK_CLEAR);
          const p = pointAlong(e.pts, s);
          if (isWater && isWater(p[0], p[1])) continue;
          // (Where two lines run along the same boulevard, one station
          // serves both.)
          const shared = stationList.find((o) => len(sub(o.p, p)) < SHARE_STATION);
          if (shared) {
            if (!list.includes(shared)) {
              list.push(shared);
              at.set(shared, s);
            }
            continue;
          }
          const st = station(p, s < e.crossAt ? B[e.i].key : B[e.j].key, false);
          list.push(st);
          at.set(st, s);
        }
        list.sort((a, b) => at.get(a) - at.get(b));
        linkStations.set(e.id, list);
      }
    }

    // ---- On past the last district centre ----
    // A line ending at a district on the city's edge runs on out along a
    // boulevard to near the edge, with its stations, rather than stopping
    // short in the district's centre (where there is room for a station or
    // more beyond it).
    const nearCity = (q) => nets.some((nt) => nt.links.some((lk) => idx.has(lk.neighbour) && len(sub(lk.p, q)) < TAIL_CLEAR));
    function tail(l, end) {
      const n = end ? l.nodes[l.nodes.length - 1] : l.nodes[0];
      if (!atEdge[n]) return null;
      const inE = end ? l.edges[l.edges.length - 1] : l.edges[0];
      const dir = mul(leave(inE, n), -1);
      // Where it might run to: a boulevard out of the city, or the far end
      // of any boulevard ahead not leading on to another district.
      const ends = nets[n].links.filter((lk) => !lk.country && !idx.has(lk.neighbour)).map((lk) => lk.p);
      for (const P of linesOf(n)) for (const q of [P[0], P[P.length - 1]]) if (!nearCity(q)) ends.push(q);
      let best = null;
      for (const q of ends) {
        if (angleBetween(dir, sub(q, S[n])) > TURN || len(sub(q, S[n])) < METRO_SPACING) continue;
        const P = route(linesOf(n), S[n], q);
        if (!P || P.length < 2) continue;
        const L = lengthOf(P) - TAIL_SHORT;
        if (L < METRO_SPACING * 0.8 || angleBetween(dir, sub(pointAlong(P, Math.min(300, L)), S[n])) > TURN * 1.2) continue;
        const pts = resample(P, SAMPLE).filter((_, i, A) => lengthOf(A.slice(0, i + 1)) <= L + 1e-6);
        if (pts.some((q2) => isWater && isWater(q2[0], q2[1]))) continue;
        if (!best || L > best.L) best = { pts, L };
      }
      if (!best) {
        // No boulevard that way: straight on (under the main street its
        // stations will have) to near the district's edge.
        const ring = B[n].ring.concat([B[n].ring[0]]);
        let r = Infinity;
        for (let i = 0; i < ring.length - 1; i++) {
          const a = ring[i];
          const ab = sub(ring[i + 1], a);
          const den = dir[0] * ab[1] - dir[1] * ab[0];
          if (Math.abs(den) < 1e-9) continue;
          const t = ((a[0] - S[n][0]) * ab[1] - (a[1] - S[n][1]) * ab[0]) / den;
          const v = ((a[0] - S[n][0]) * dir[1] - (a[1] - S[n][1]) * dir[0]) / den;
          if (t > 0 && v >= 0 && v <= 1) r = Math.min(r, t);
        }
        const L = Math.min(r - TAIL_EDGE, METRO_SPACING * TAIL_MOST);
        if (!(L >= METRO_SPACING * 0.8)) return null;
        const pts = resample([S[n], add(S[n], mul(dir, L))], SAMPLE);
        if (pts.some((q) => (isWater && isWater(q[0], q[1])) || nearCity(q))) return null;
        best = { pts, L };
      }
      // Stations about METRO_SPACING apart, the last at its end.
      const k = Math.max(1, Math.round(best.L / METRO_SPACING));
      const stops = [];
      for (let q = 1; q <= k; q++) {
        const p = pointAlong(best.pts, (best.L * q) / k);
        stops.push(stationList.find((o) => len(sub(o.p, p)) < SHARE_STATION) || station(p, B[n].key, false));
      }
      return { pts: best.pts, stops };
    }
    const tails = best.lines.map((l) => [tail(l, 0), tail(l, 1)]);

    // ---- Each line's track and stations ----
    const lines = best.lines.map((l, k) => {
      const [t0, t1] = tails[k];
      let pts = t0 ? t0.pts.slice().reverse() : [S[l.nodes[0]]];
      const stops = t0 ? [...t0.stops.slice().reverse(), coreStation.get(l.nodes[0])] : [coreStation.get(l.nodes[0])];
      l.edges.forEach((e, q) => {
        const forward = e.i === l.nodes[q];
        const P = forward ? e.pts : e.pts.slice().reverse();
        pts = pts.concat(P.slice(1));
        const mid = linkStations.get(e.id);
        stops.push(...(forward ? mid : mid.slice().reverse()), coreStation.get(l.nodes[q + 1]));
      });
      if (t1) {
        pts = pts.concat(t1.pts.slice(1));
        stops.push(...t1.stops);
      }
      const track = smoothLine(
        pts,
        l.nodes.map((n) => S[n]).concat(t0 ? [t0.pts[t0.pts.length - 1]] : [], t1 ? [t1.pts[t1.pts.length - 1]] : [], oldTown && l.edges.some((e) => e.oldTownAt !== undefined) ? [oldTown.p] : []),
      );
      for (const st of stops) if (!st.lines.includes(k)) st.lines.push(k);
      // The stretches between district centres, each with how many lines
      // share it and where this one runs among them (for drawing them side
      // by side).
      const along = [0];
      for (let i = 1; i < track.length; i++) along.push(along[i - 1] + len(sub(track[i], track[i - 1])));
      const at = l.nodes.map((n) => project(track, S[n]).s);
      const pieces = l.edges.map((e, q) => {
        const on = best.lines.map((o, j) => (o.edges.includes(e) ? j : -1)).filter((x) => x >= 0);
        const a = Math.min(at[q], at[q + 1]);
        const b = Math.max(at[q], at[q + 1]);
        // (Ranked by the link's own direction, so lines agree on sides.)
        const rank = e.i === l.nodes[q] ? on.indexOf(k) : on.length - 1 - on.indexOf(k);
        return { pts: track.filter((_, i) => along[i] >= a - SAMPLE && along[i] <= b + SAMPLE), rank, of: on.length };
      });
      // (The runs on past the ends, this line's own.)
      if (t0) pieces.unshift({ pts: track.filter((_, i) => along[i] <= at[0] + SAMPLE), rank: 0, of: 1 });
      if (t1) pieces.push({ pts: track.filter((_, i) => along[i] >= at[at.length - 1] - SAMPLE), rank: 0, of: 1 });
      return { id: k, name: String(k + 1), colour: METRO_COLOURS[k % METRO_COLOURS.length], nodes: l.nodes.map((n) => B[n].key), pts: track, pieces, stations: stops.map((s) => s.id) };
    });
    // (The old town centred where the line, eased, passes its site.)
    if (oldTown) {
      const st = stationList.find((x) => x.oldTown);
      const L = lines.find((x) => st && st.lines.includes(x.id));
      if (st && L) {
        const pr = project(L.pts, oldTown.p);
        oldTown.p = pr.p;
        st.p = pr.p.slice();
      }
    }
    // Stations sit on their lines' track.
    for (const st of stationList) {
      const P = lines[st.lines[0]].pts;
      const at = project(P, st.p);
      // (A district centre's stays right under the centre, where the rail
      // station is too.)
      if (st.lines.length === 1 && !st.core) st.p = at.p;
      // The way the line runs through it.
      st.t = unit(sub(pointAlong(P, at.s + 30), pointAlong(P, Math.max(0, at.s - 30))));
    }
    for (const L of lines) {
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of L.pts) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
      L.bbox = { x0, y0, x1, y1 };
    }
    for (const st of stationList) {
      if (!planned.byKey.has(st.key)) planned.byKey.set(st.key, []);
      planned.byKey.get(st.key).push(st);
    }
    planned.lines = lines;
    planned.stations = stationList;
    planned.oldTown = oldTown;
    planned.judged = best.j;
    planned.target = target;
    return planned;
  }
  return {
    get lines() {
      return plan().lines;
    },
    get stations() {
      return plan().stations;
    },
    plan,
    // The metro stations in a district.
    stationsIn: (key) => plan().byKey.get(key) || [],
    // Lines touching a rectangle.
    near: (x0, y0, x1, y1) => plan().lines.filter((L) => !(L.bbox.x1 < x0 || L.bbox.x0 > x1 || L.bbox.y1 < y0 || L.bbox.y0 > y1)),
  };
}
