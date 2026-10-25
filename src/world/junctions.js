// Stage 5: every junction of a district, laid out by the streets that meet
// there (the street and intersection spec, Parts 3 and 4).
//
// Streets rank boulevard, main street, core residential street, local
// street, laneway; the higher keeps its section through a junction and the
// lower gets the crossing. So:
//
//   tram street x tram street: signalised, a Dutch protected junction ('D'):
//     a corner island at each corner, each street's cycle lane swung out
//     round it to a cycle crossing set back 5 m from the carriageway being
//     turned out of, a 4 m zebra beside that (farther out), stop lines 1 m
//     outside the zebras, refuges where a zebra crosses a median or buffer;
//   tram street x local or core street: signalised the same way where a tram
//     stop is (every 300 to 400 m, the stop on the junction's far side), else
//     a continuous sidewalk ('CONT'): the tram street's pavement and cycle
//     lane run on across the side street's mouth, cars ramping over them,
//     with a zebra over the tram street beside it;
//   core street x core street: a raised table ('TABLE');
//   core street x local street: the core street's pavement continuous;
//   local x local: a flush plateau ('FLUSH'), some with a bollard filter;
//   a pedestrian street ending at a tram street ('PED'): the pavement runs
//     on, the street's bike lanes cross it to the cycle lanes, bollards;
//   a laneway's mouth on a local street ('LANE'): bollards just inside it;
//   a tram street with no junction for a long way: a signalised zebra of
//   its own ('XING'), for a tram stop; and a zebra at least every 115 m
//   ('ZEBRA'), its tram tracks crossed through a cut in the median;
//   a secondary greenway (a linear park, or the path under a viaduct)
//     crossing a tram street: signalised, the greenway's priority ('GREEN'),
//     or a local street: marked across its flush surface ('GREEN_FLUSH').
//
// Primary greenways pass over the streets (drawn with the greenways).
// No left turns are drawn anywhere; there are no turn lanes.
//
// Each junction is { kind, p, arms, ... } in world coordinates; each arm is
// { dir (out of the junction), type, ... } and, at a signalised junction,
// where its crossings lie: s (metres out to the cycle crossing's near
// edge), cw (its width), zebra (out to the zebra's far edge).

import { STREET_TYPES } from './streetTypes.js';
import { hash, toUnit } from '../core/hash.js';

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

export const SETBACK = 5.0; // metres from the carriageway turned out of to a cycle crossing
export const TURN_ROOM = 3.5; // and from the cycle lane turned out of (room for the corner island)
export const ZEBRA = 4.0; // metres: a zebra's width
export const CYCLE_CROSSING = 2.1; // one-way, as the cycle lane
export const TWO_WAY_CROSSING = 3.0; // for cyclists from a local street
export const GREEN_CROSSING = 4.0; // a greenway's two-way paths
export const STOP_LINE = 1.0; // metres outside the zebra
export const PLATFORM_LENGTH = 40; // metres (35 to 45)
export const STOP_SPACING = [300, 400]; // metres between tram stops along a street
const ARM = 26; // metres out from a junction its arms' directions are read
const ALIGN = 9; // metres: side streets meeting a tram street this close across it are lined up
const MERGE = 8; // metres: junction points this close are one junction
const FILTER_SHARE = 0.18; // local junctions with a bollard filter
const MAJOR_REACH = 28; // metres out a tram-street junction's crossings reach, about
const MINOR_REACH = 14; // and a side street's (or a crossing's)
const MAX_STOP_GAP = 480;
const STOP_SNAP = 70; // metres from where a route's stop is planned to the junction it is put at, at most
const CROSSING_EVERY = 110; // metres: a zebra across a tram street at least this often (115 at most) // metres: no longer between stops, a side street junction signalised if need be

// ---- Sections ----
// Each street type's bands, centreline outward on one side: [from, to, element].
const profileCache = new Map();
export function profile(type) {
  let p = profileCache.get(type);
  if (p) return p;
  if (type === 'rail') {
    // The path under a viaduct: walking and cycling only.
    p = { half: 10.5, drive: 0, cycle: null, edge: 10.5, bands: [[0, 10.5, 'clearway']], tram: [], flush: true };
    profileCache.set(type, p);
    return p;
  }
  const T = STREET_TYPES[type];
  const across = [...T.side, ...T.centre, ...T.side.slice().reverse()];
  const total = across.reduce((a, [, w]) => a + w, 0);
  const half = total / 2;
  const bands = [];
  let at = -half;
  for (const [el, w] of across) {
    const a = at;
    const b = at + w;
    at = b;
    if (b <= 1e-9) continue;
    bands.push([Math.max(0, a), b, el]);
  }
  const lanes = bands.filter(([, , el]) => el === 'drive' || el === 'bus' || el === 'shared' || el === 'tram');
  const drive = lanes.length ? lanes[lanes.length - 1][1] : 0;
  const cyc = bands.find(([a, , el]) => el === 'cycle' && a > 0.01);
  const flush = ['localStreet', 'pedestrianStreet', 'laneway'].includes(type);
  const tram = [];
  for (const [a, b, el] of bands) if (el === 'tram') tram.push((a + b) / 2);
  p = {
    half,
    drive, // the carriageway's edge (a flush street's central clearway)
    cycle: cyc ? { r: (cyc[0] + cyc[1]) / 2, w: cyc[1] - cyc[0], outer: cyc[1] } : null,
    // How far out a zebra across it reaches: its cycle lanes, else its carriageway.
    edge: cyc ? cyc[1] : flush ? Math.min(half, drive + 3.9) : drive,
    bands,
    tram,
    flush,
  };
  profileCache.set(type, p);
  return p;
}

// Street types by rank (lower is higher).
const RANK = { boulevard: 1, boulevardPlanted: 1, mainStreet: 2, coreMainStreet: 2, mainStreetPlanted: 2, coreMainStreetPlanted: 2, coreCrossStreet: 3, coreCrossStreetNarrow: 3, localStreet: 4, laneway: 5 };
// (Tram streets by their class: those with no route have a planted median
// for tracks.)
export const isTramStreet = (type) => ['boulevard', 'mainStreet', 'coreMainStreet', 'boulevardPlanted', 'mainStreetPlanted', 'coreMainStreetPlanted'].includes(type);
export const plantedOf = (type) => (['boulevard', 'mainStreet', 'coreMainStreet'].includes(type) ? `${type}Planted` : type);

// ---- Geometry ----
function params(P) {
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + len(sub(P[i], P[i - 1])));
  return cum;
}
function pointAt(P, cum, s) {
  let i = 0;
  while (i < P.length - 2 && cum[i + 1] < s) i++;
  const t = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
  return add(P[i], mul(sub(P[i + 1], P[i]), Math.max(0, Math.min(1, t))));
}
function project(P, cum, q) {
  let best = null;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i];
    const d = sub(P[i + 1], a);
    const l2 = dot(d, d);
    const t = l2 ? Math.max(0, Math.min(1, dot(sub(q, a), d) / l2)) : 0;
    const f = add(a, mul(d, t));
    const r = len(sub(f, q));
    if (!best || r < best.r) best = { s: cum[i] + Math.sqrt(l2) * t, r, f, t: unit(d) };
  }
  return best;
}
// Where line p + d t meets line q + e u: t.
function meetT(p, d, q, e) {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9) return null;
  return cross(sub(q, p), e) / den;
}
// The arms a street gives a junction at arc length s along it.
function armsAlong(line, s, type0, extra = {}) {
  const L = line.cum[line.cum.length - 1];
  const c = pointAt(line.pts, line.cum, s);
  const type = line.typeAt ? line.typeAt(c) : type0;
  const out = [];
  if (s > 4) out.push({ dir: unit(sub(pointAt(line.pts, line.cum, Math.max(0, s - ARM)), c)), type, line, s, way: -1, ...extra });
  if (s < L - 4) out.push({ dir: unit(sub(pointAt(line.pts, line.cum, Math.min(L, s + ARM)), c)), type, line, s, way: 1, ...extra });
  return out;
}

// ---- Crossing bands at a signalised junction ----
// For each arm: its neighbours either side (by angle); the cycle crossing
// set back 5 m beyond where the nearer neighbour's carriageway edge crosses
// the arm's width, and 3.5 m beyond its cycle lane (so a corner island fits
// inside the cycle track turning between them); then the zebra; the stop
// line beyond.
export function layOutCrossings(j) {
  const arms = j.arms;
  arms.sort((a, b) => Math.atan2(a.dir[1], a.dir[0]) - Math.atan2(b.dir[1], b.dir[0]));
  for (const a of arms) a.n = [-a.dir[1], a.dir[0]];
  const n = arms.length;
  for (let i = 0; i < n; i++) {
    const X = arms[i];
    const PX = profile(X.type);
    let reach = 0;
    // (How far out a line at lateral `off` on Y's side facing X crosses X's
    // width.)
    const cross = (Y, off) => {
      const sg = Math.sign(dot(X.dir, Y.n)) || 1;
      const q = add(j.p, mul(Y.n, sg * off));
      let r = 0;
      for (const o of [-PX.edge, PX.edge]) {
        const t = meetT(add(j.p, mul(X.n, o)), X.dir, q, Y.dir);
        if (t !== null) r = Math.max(r, t);
      }
      return r;
    };
    for (const k of [-1, 1]) {
      const Y = arms[(i + k + n) % n];
      if (Y === X || dot(X.dir, Y.dir) < -0.85) continue;
      const PY = profile(Y.type);
      // Y's carriageway edge on the side facing X, and its cycle lane.
      reach = Math.max(reach, cross(Y, PY.drive) + SETBACK);
      if (PY.cycle) reach = Math.max(reach, cross(Y, PY.cycle.outer) + TURN_ROOM);
    }
    X.s = Math.max(reach, PX.drive * 0.5 + SETBACK);
  }
  // What each crossing carries: the cycle lanes of the street across it, or
  // (where that street has none) a two-way crossing for its cyclists.
  for (let i = 0; i < n; i++) {
    const X = arms[i];
    const others = arms.filter((Y) => Y !== X && Math.abs(dot(X.dir, Y.dir)) < 0.85);
    const hasLanes = others.some((Y) => profile(Y.type).cycle);
    X.cw = j.kind === 'XING' ? 0 : j.kind === 'GREEN' ? GREEN_CROSSING : hasLanes && others.every((Y) => profile(Y.type).cycle) ? CYCLE_CROSSING : TWO_WAY_CROSSING;
    X.zebra = X.s + X.cw + ZEBRA;
    X.stop = X.zebra + STOP_LINE;
  }
  return j;
}

// ---- Planning a district's junctions ----
// majors: tram streets [{ pts, type }]; local: the local streets
// [{ id, kind, lines }] (kinds local, core, coreNarrow, pedestrian, rail);
// alleys: laneways [pts]; greenways: linear parks' trails [pts]; places:
// points worth a tram stop.
// onLand(p): whether a point is on the district's land (not in a greenway,
// a river or a park): streets meeting anywhere else are no junction.
export function planJunctions(seedKey, { majors, local, alleys = [], greenways = [], places = [], onLand = () => true }) {
  const u = (...k) => toUnit(hash(seedKey, 'junction', ...k));
  const lines = majors.map((m) => ({ ...m, cum: params(m.pts) }));
  const junctions = [];
  // Junctions by grid cell, to find the one at a point.
  const G = 50;
  const grid = new Map();
  const cellsNear = (p, r) => {
    const out = [];
    for (let gx = Math.floor((p[0] - r) / G); gx <= Math.floor((p[0] + r) / G); gx++) {
      for (let gy = Math.floor((p[1] - r) / G); gy <= Math.floor((p[1] + r) / G); gy++) out.push(grid.get(gx * 1e6 + gy) || []);
    }
    return out.flat();
  };
  const near = (p, r) => cellsNear(p, r).filter((j) => len(sub(j.p, p)) < r);
  const keep = (j) => {
    junctions.push(j);
    const k = Math.floor(j.p[0] / G) * 1e6 + Math.floor(j.p[1] / G);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(j);
    return j;
  };
  const find = (p) => near(p, MERGE)[0];
  const at = (p) => find(p) || keep({ p, arms: [], kinds: new Set() });
  const addArms = (j, arms) => {
    for (const a of arms) if (!j.arms.some((b) => dot(a.dir, b.dir) > 0.94)) j.arms.push(a);
  };

  // Tram streets crossing or meeting each other.
  for (let a = 0; a < lines.length; a++) {
    for (let b = a + 1; b < lines.length; b++) {
      const A = lines[a];
      const B = lines[b];
      for (let i = 0; i < A.pts.length - 1; i++) {
        const p = A.pts[i];
        const r = sub(A.pts[i + 1], p);
        for (let k = 0; k < B.pts.length - 1; k++) {
          const q = B.pts[k];
          const e = sub(B.pts[k + 1], q);
          const den = cross(r, e);
          if (Math.abs(den) < 1e-9) continue;
          const t = cross(sub(q, p), e) / den;
          const v = cross(sub(q, p), r) / den;
          if (t < -0.02 || t > 1.02 || v < -0.02 || v > 1.02) continue;
          const x = add(p, mul(r, Math.max(0, Math.min(1, t))));
          const j = at(x);
          j.kinds.add('major');
          addArms(j, armsAlong(A, A.cum[i] + len(r) * Math.max(0, Math.min(1, t)), A.type));
          addArms(j, armsAlong(B, B.cum[k] + len(e) * Math.max(0, Math.min(1, v)), B.type));
        }
      }
    }
  }
  for (const A of lines) {
    for (const end of [0, A.pts.length - 1]) {
      const q = A.pts[end];
      for (const B of lines) {
        if (B === A) continue;
        const pr = project(B.pts, B.cum, q);
        if (pr.r > 6) continue;
        const j = at(pr.f);
        j.kinds.add('major');
        addArms(j, armsAlong(A, A.cum[end], A.type));
        addArms(j, armsAlong(B, pr.s, B.type));
      }
    }
  }

  // Side streets meeting tram streets: their ends on a tram street.
  const typeOf = (kind) => (kind === 'core' ? 'coreCrossStreet' : kind === 'coreNarrow' ? 'coreCrossStreetNarrow' : kind === 'pedestrian' ? 'pedestrianStreet' : kind === 'rail' ? 'rail' : 'localStreet');
  const ends = [];
  for (const st of local) {
    for (const L of st.lines || []) {
      if (L.length < 2) continue;
      const away = (k, step) => {
        let o = k + step;
        while (o > 0 && o < L.length - 1 && len(sub(L[o], L[k])) < 0.5) o += step;
        return L[o];
      };
      for (const [q, r] of [[L[0], away(0, 1)], [L[L.length - 1], away(L.length - 1, -1)]]) {
        if (len(sub(r, q)) < 0.5) continue;
        for (const M of lines) {
          const pr = project(M.pts, M.cum, q);
          if (pr.r > 1.5) continue;
          ends.push({ q: pr.f, M, s: pr.s, dir: unit(sub(r, q)), type: typeOf(st.kind), kind: st.kind, id: st.id });
          break;
        }
      }
    }
  }
  for (const e of ends) {
    // Into a tram-street junction already there: one more arm (at most four).
    let j = find(e.q);
    if (j && j.kinds.has('major')) {
      if (j.arms.length < 4) addArms(j, [{ dir: e.dir, type: e.type, kind: e.kind }]);
      continue;
    }
    // (A viaduct's path meets a tram street once, however many pieces of
    // it end there.)
    j = near(e.q, e.kind === 'rail' ? 40 : ALIGN).find((o) => !o.kinds.has('major') && o.M === e.M && (e.kind !== 'rail' || o.kinds.has('rail')));
    if (!j) {
      j = at(e.q);
      j.M = e.M;
      j.s = e.s;
      addArms(j, armsAlong(e.M, e.s, e.M.type));
    }
    j.kinds.add(e.kind);
    addArms(j, [{ dir: e.dir, type: e.type, kind: e.kind }]);
  }

  // Side streets meeting each other.
  const degree = new Map();
  const key = (q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`;
  for (const st of local) {
    for (const L of st.lines || []) {
      for (let i = 0; i < L.length; i++) {
        const q = L[i];
        const k = key(q);
        if (!degree.has(k)) degree.set(k, { q, arms: [] });
        const e = degree.get(k);
        for (const step of [-1, 1]) {
          // (The first point along that is not the same point.)
          let o = i + step;
          while (o >= 0 && o < L.length && len(sub(L[o], q)) < 0.5) o += step;
          if (o >= 0 && o < L.length) e.arms.push({ dir: unit(sub(L[o], q)), type: typeOf(st.kind), kind: st.kind });
        }
      }
    }
  }
  for (const { q, arms } of degree.values()) {
    const uniq = [];
    for (const a of arms) if (!uniq.some((b) => dot(a.dir, b.dir) > 0.94)) uniq.push(a);
    if (uniq.length < 3) continue;
    if (lines.some((M) => project(M.pts, M.cum, q).r < 3)) continue;
    const j = at(q);
    for (const a of uniq) j.kinds.add(a.kind);
    addArms(j, uniq);
  }

  // (Not where streets meet out on a greenway, say where one district's
  // boulevard runs on into the next's over a bridge.)
  for (let k = junctions.length - 1; k >= 0; k--) {
    if (onLand(junctions[k].p)) continue;
    const j = junctions[k];
    junctions.splice(k, 1);
    const g = grid.get(Math.floor(j.p[0] / G) * 1e6 + Math.floor(j.p[1] / G));
    if (g) g.splice(g.indexOf(j), 1);
  }

  // ---- Kinds ----
  for (const j of junctions) {
    const ks = j.kinds;
    if (ks.has('major')) j.kind = 'D';
    else if (j.M) {
      if (ks.has('rail')) j.kind = 'GREEN';
      else if (ks.has('pedestrian') && !ks.has('local') && !ks.has('core') && !ks.has('coreNarrow')) j.kind = 'PED';
      else j.kind = 'CONT';
    } else if (ks.has('rail')) j.kind = 'GREEN_FLUSH';
    else if (ks.has('pedestrian')) j.kind = 'PED_FLUSH';
    else if ((ks.has('core') || ks.has('coreNarrow')) && !ks.has('local')) j.kind = 'TABLE';
    else if (ks.has('core') || ks.has('coreNarrow')) j.kind = 'CONT_CORE';
    else {
      j.kind = 'FLUSH';
      // A few local junctions keep cars from cutting through: a line of
      // bollards across them, passable on foot and by bike.
      if (u(Math.round(j.p[0]), Math.round(j.p[1])) < FILTER_SHARE) {
        const a = j.arms[0].dir;
        j.filter = unit(add(a, j.arms[1].dir));
      }
    }
  }
  // Linear parks' trails crossing a tram street at their ends.
  for (const T of greenways) {
    for (const q of [T[0], T[T.length - 1]]) {
      for (const M of lines) {
        const pr = project(M.pts, M.cum, q);
        if (pr.r > 25) continue;
        if (near(pr.f, 20).length) continue;
        const j = keep({ p: pr.f, arms: armsAlong(M, pr.s, M.type), kinds: new Set(['green']), kind: 'GREEN', M, s: pr.s });
        j.arms.push({ dir: unit(sub(q, pr.f)), type: 'rail', kind: 'green' });
        break;
      }
    }
  }

  // Laneways' mouths on local streets.
  const segGrid = new Map();
  for (const st of local) {
    if (st.kind !== 'local') continue;
    for (const L of st.lines || []) {
      for (let i = 0; i < L.length - 1; i++) {
        const m = mul(add(L[i], L[i + 1]), 0.5);
        const k = Math.floor(m[0] / G) * 1e6 + Math.floor(m[1] / G);
        if (!segGrid.has(k)) segGrid.set(k, []);
        segGrid.get(k).push([L[i], L[i + 1]]);
      }
    }
  }
  for (const A of alleys) {
    if (!A || A.length < 2) continue;
    for (const [q, r] of [[A[0], A[1]], [A[A.length - 1], A[A.length - 2]]]) {
      let best = null;
      for (let gx = Math.floor(q[0] / G) - 1; gx <= Math.floor(q[0] / G) + 1; gx++) {
        for (let gy = Math.floor(q[1] / G) - 1; gy <= Math.floor(q[1] / G) + 1; gy++) {
          for (const seg of segGrid.get(gx * 1e6 + gy) || []) {
            const pr = project(seg, [0, len(sub(seg[1], seg[0]))], q);
            if (pr.r < 12 && (!best || pr.r < best.r)) best = pr;
          }
        }
      }
      if (best) junctions.push({ kind: 'LANE', p: q, arms: [{ dir: unit(sub(r, q)), type: 'laneway' }], street: best.t, foot: best.f });
    }
  }

  // ---- Signals and tram stops ----
  // Along each tram street, a stop every 300 to 400 m at a signalised
  // junction (tram streets' own junctions first, then side streets lined up
  // across it, then any), on its far side; a side-street junction chosen
  // for a stop is signalised.
  const stops = [];
  for (const M of lines) {
    const L = M.cum[M.cum.length - 1];
    const here = [];
    for (const j of junctions) {
      if (j.kind !== 'D' && j.kind !== 'CONT') continue;
      const pr = project(M.pts, M.cum, j.p);
      if (pr.r > 3) continue;
      const near = places.some((q) => len(sub(q, j.p)) < 140);
      const score = (j.kind === 'D' ? 3 : 0) + (j.arms.length >= 4 ? 1 : 0) + (near ? 1.5 : 0);
      here.push({ j, s: pr.s, score });
    }
    here.sort((a, b) => a.s - b.s);
    // Every junction on this street, for the room a platform needs.
    // (How far its crossings reach out from it: a tram-street junction's
    // farther than a side street's.)
    const reachOf = (j) => (j.kinds && j.kinds.has('major') ? MAJOR_REACH : MINOR_REACH);
    // (A side street's mouth may open beside a main street's island
    // platform, since nothing turns left across the tracks; it may not
    // beside a boulevard's side platform, which takes the tree buffer.)
    const sideOnly = (j) => j.kinds && [...j.kinds].every((k) => k === 'local' || k === 'core' || k === 'coreNarrow');
    // Which sides of the street (+1 its right, -1 its left, going along it)
    // a side street opens on.
    const sidesOf = (j, pr) => new Set(j.arms.filter((a) => !a.line).map((a) => Math.sign(cross(pr.t, a.dir)) || 1));
    const onLine = junctions
      .map((j) => ({ j, pr: project(M.pts, M.cum, j.p) }))
      .filter(({ pr }) => pr.r < 3)
      .map(({ j, pr }) => ({ s: pr.s, r: reachOf(j), side: sideOnly(j), opens: sidesOf(j, pr) }));
    // (A platform on a junction's far side going one way stands on the
    // right of the trams leaving that way: the street's right going +1, its
    // left going -1.)
    const blocks = (o, way) => !o.side || (M.type === 'boulevard' && o.opens.has(way));
    const room = (s0, way) => {
      const own = onLine.find((o) => Math.abs(o.s - s0) < 1);
      const need = (own ? own.r : MINOR_REACH) + 1 + PLATFORM_LENGTH;
      return onLine.every((o) => Math.abs(o.s - s0) < 1 || (o.s - s0) * way <= 0 || !blocks(o, way) || Math.abs(o.s - s0) >= need + o.r) && (way > 0 ? L - s0 : s0) >= need + 10;
    };
    // Which side(s) of a junction its platforms go: a boulevard's on both,
    // a main street's island on one (either), or none if there is no room.
    const sidesFor = (s0) => (M.type === 'boulevard' ? (room(s0, 1) && room(s0, -1) ? [1, -1] : null) : room(s0, 1) ? [1] : room(s0, -1) ? [-1] : null);
    const stopAt = (j, s0) => {
      if (j.kind === 'CONT') j.kind = 'D';
      (j.stops ||= []).push({ line: M, s: s0, ways: sidesFor(s0) });
    };
    // Where the routes' stops are planned along it: at the best junction
    // near each, else a signalised crossing of its own.
    if (M.targets) {
      // (Never nearer the last than the least spacing allows.)
      let prev = -Infinity;
      const apart = (x) => x - prev >= STOP_SPACING[0] - 10;
      for (const t of M.targets.slice().sort((a, b) => a - b)) {
        const pick = here.filter((h) => Math.abs(h.s - t) <= STOP_SNAP && h.s > 20 && h.s < L - 20 && apart(h.s) && sidesFor(h.s)).sort((a, b) => b.score - Math.abs(b.s - t) / 12 - (a.score - Math.abs(a.s - t) / 12))[0];
        if (pick) {
          stopAt(pick.j, pick.s);
          prev = pick.s;
          continue;
        }
        let s0 = null;
        for (let k = 0; k <= STOP_SNAP / 10 && s0 === null; k++) {
          for (const x of k ? [t + k * 10, t - k * 10] : [t]) {
            if (x < 30 || x > L - 30 || !apart(x)) continue;
            if (!near(pointAt(M.pts, M.cum, x), 40).length && sidesFor(x)) {
              s0 = x;
              break;
            }
          }
        }
        if (s0 === null) continue;
        const j = keep({ p: pointAt(M.pts, M.cum, s0), arms: armsAlong(M, s0, M.type), kinds: new Set(['crossing']), kind: 'XING' });
        onLine.push({ s: s0, r: MINOR_REACH, side: false, opens: new Set() });
        here.push({ j, s: s0, score: 0 });
        here.sort((a, b) => a.s - b.s);
        stopAt(j, s0);
        prev = s0;
      }
      continue;
    }
    let last = -Infinity;
    for (let guard = 0; guard < 200; guard++) {
      const lo = last === -Infinity ? 60 : last + STOP_SPACING[0];
      const hi = last === -Infinity ? STOP_SPACING[1] : last + STOP_SPACING[1];
      let pick = here.filter((h) => h.s >= lo && h.s <= hi && h.s < L - 30 && sidesFor(h.s)).sort((a, b) => b.score - a.score)[0];
      if (!pick) pick = here.find((h) => h.s > hi && h.s <= (last === -Infinity ? MAX_STOP_GAP : last + MAX_STOP_GAP) && h.s < L - 30 && sidesFor(h.s));
      if (!pick) {
        // No junction for a long way (along a park, say): a signalised
        // crossing of its own, for the stop.
        const mid = last === -Infinity ? 200 : last + (STOP_SPACING[0] + STOP_SPACING[1]) / 2;
        const top = last === -Infinity ? MAX_STOP_GAP : last + MAX_STOP_GAP;
        let s0 = null;
        for (let k = 0; k < 30 && s0 === null; k++) {
          for (const t of k ? [mid + k * 15, mid - k * 15] : [mid]) {
            if (t < lo - 40 || t > top || t > L - 80 || t < 60) continue;
            if (!near(pointAt(M.pts, M.cum, t), 40).length && sidesFor(t)) {
              s0 = t;
              break;
            }
          }
        }
        if (s0 === null) {
          if (mid > L - 80) break;
          const next = here.find((h) => h.s > lo);
          if (!next) break;
          last = next.s;
          continue;
        }
        const p = pointAt(M.pts, M.cum, s0);
        const j = keep({ p, arms: armsAlong(M, s0, M.type), kinds: new Set(['crossing']), kind: 'XING' });
        onLine.push({ s: s0, r: MINOR_REACH, side: false, opens: new Set() });
        here.push({ j, s: s0, score: 0 });
        here.sort((a, b) => a.s - b.s);
        pick = { j, s: s0 };
      }
      last = pick.s;
      const j = pick.j;
      if (j.kind === 'CONT') j.kind = 'D';
      (j.stops ||= []).push({ line: M, s: pick.s, ways: sidesFor(pick.s) });
    }
  }
  // Side-street junctions in a core: every other one signalised.
  for (const j of junctions) if (j.kind === 'CONT' && (j.kinds.has('core') || j.kinds.has('coreNarrow')) && u(7, Math.round(j.p[0]), Math.round(j.p[1])) < 0.45) j.kind = 'D';

  for (const j of junctions) {
    if (j.kind === 'D' || j.kind === 'GREEN' || j.kind === 'XING') layOutCrossings(j);
    else for (const a of j.arms) a.n = [-a.dir[1], a.dir[0]];
    // Tram stops at this junction: a main street's island platform on one
    // far side; a boulevard's two side platforms, each on the far side for
    // its direction (so on opposite sides of the junction).
    for (const st of j.stops || []) {
      const arms = j.arms.filter((a) => a.line === st.line);
      const type = st.line.typeAt ? st.line.typeAt(j.p) : st.line.type;
      const li = lines.indexOf(st.line);
      for (const a of arms) {
        if (!st.ways.includes(a.way)) continue;
        stops.push({ ...platform(j, a, type === 'boulevard' ? 'side' : 'island', type), line: li, at: st.s });
      }
    }
    j.stop = !!(j.stops && j.stops.length);
    delete j.stops;
    delete j.M;
    delete j.kinds;
    for (const a of j.arms) {
      delete a.line;
      delete a.way;
      }
  }
  // A zebra across every tram street at least every 115 m: at its
  // junctions, and between them where they are farther apart (clear of
  // junctions and platforms).
  for (const M of lines) {
    const L = M.cum[M.cum.length - 1];
    const at0 = [];
    const busy = [];
    for (const j of junctions) {
      const pr = project(M.pts, M.cum, j.p);
      if (pr.r > 3) continue;
      busy.push(pr.s);
      if (j.kind === 'D' || j.kind === 'XING' || j.kind === 'GREEN' || j.kind === 'ZEBRA' || (j.kind === 'CONT' && !j.platform)) at0.push(pr.s);
    }
    for (const st of stops) {
      const pr = project(M.pts, M.cum, st.p);
      if (pr.r < 8) busy.push(pr.s - PLATFORM_LENGTH / 2, pr.s, pr.s + PLATFORM_LENGTH / 2);
    }
    const marks = [0, ...at0.sort((a, b) => a - b), L];
    for (let k = 0; k + 1 < marks.length; k++) {
      const gap = marks[k + 1] - marks[k];
      if (gap <= CROSSING_EVERY) continue;
      const n = Math.ceil(gap / CROSSING_EVERY) - 1;
      for (let q = 1; q <= n; q++) {
        let s0 = marks[k] + (gap * q) / (n + 1);
        // (Nudged clear of junctions and platforms.)
        for (let t = 0; t < 8 && busy.some((b) => Math.abs(b - s0) < 22); t++) s0 += t % 2 ? -t * 6 : t * 6;
        if (busy.some((b) => Math.abs(b - s0) < 22) || s0 < 20 || s0 > L - 20) continue;
        const z = keep({ p: pointAt(M.pts, M.cum, s0), arms: armsAlong(M, s0, M.type), kind: 'ZEBRA' });
        for (const a of z.arms) {
          a.n = [-a.dir[1], a.dir[0]];
          delete a.line;
          delete a.way;
        }
        busy.push(s0);
      }
    }
  }

  // A side street's mouth beside a platform: no zebra over the street there
  // (the crossings at the stop's own junction serve it).
  for (const st of stops) {
    for (const j of near(st.p, PLATFORM_LENGTH)) {
      if (j.kind !== 'CONT') continue;
      const v = sub(j.p, st.p);
      if (Math.abs(dot(v, st.dir)) <= PLATFORM_LENGTH / 2 + 8 && Math.abs(cross(st.dir, v)) < 20) j.platform = true;
    }
  }
  return { junctions, stops };
}

// A tram platform on an arm, from 1 m beyond its far crossing band, its
// ramp at that end. Island platforms sit on the centreline (4 m wide, over
// the median, 1.35 m from each track). Side platforms are 3 m wide beside
// the track trams leaving the junction along the arm run on: on their
// right, which with n = [-dir.y, dir.x] (screen coordinates, y down) is +n.
function platform(j, arm, kind, type) {
  const P = profile(type);
  const s0 = (arm.zebra ?? 20) + 1.0;
  const c = add(j.p, mul(arm.dir, s0 + PLATFORM_LENGTH / 2));
  const [from, to] = kind === 'island' ? [-2.0, 2.0] : [P.tram[0] + 1.35, P.tram[0] + 4.35];
  return { kind, p: c, dir: arm.dir, length: PLATFORM_LENGTH, from, to, type };
}
