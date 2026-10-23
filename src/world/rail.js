// Regional rail, for the whole city at once.
//
// Lines run through the central station: each comes in from the country on
// one side, through the central station and out to the country on the other
// (through running, so no line stops short). Out from the centre the lines
// fan into arms, each a chain of district stations, one district core after
// another, turning only a little at each. A district left between the arms
// gets a branch off the nearest arm, leaving it at a station.
//
// Lines only ever meet at a station running side by side on the same
// alignment: every station has one direction through it, so where a branch
// leaves an arm it leaves along the arm's track (and the central station,
// where every line meets, has all its lines through it in one direction).
// Platforms are straight, and the curves between stations are kept gentle
// (no tighter than MIN_RADIUS) for fast regional and intercity trains.
//
// The tracks run on viaducts across the neighbourhoods, never down the
// streets; neighbourhood boundaries are drawn along them.

import { hash, toUnit } from '../core/hash.js';

export const MIN_RADIUS = 900; // metres: the tightest curve out on the line
export const CENTRE_RADIUS = 400; // and leaving the central station
export const VIADUCT_WIDTH = 11; // metres: a two-track viaduct
const PLATFORM = 170; // metres of straight track either side of a station
const SPACING = [1100, 6000]; // metres between one district station and the next on an arm
const TURN = (75 * Math.PI) / 180; // how far off its general heading an arm may reach for a station
const BRANCH_TURN = (75 * Math.PI) / 180; // the most a branch may turn off its arm
const TRUNKS = 3; // lines leaving the central station either way, at most
const EXTRA_STOP = 1900; // metres: a stretch this long between stations has a stop in the middle
const COUNTRY = 14000; // metres the lines run on beyond the city
const STEP = 20; // metres between points of track

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (v) => Math.hypot(v[0], v[1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const unit = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};
const angleOf = (v) => Math.atan2(v[1], v[0]);
const wrap = (a) => {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x < -Math.PI) x += 2 * Math.PI;
  return x;
};

// The tightest radius along a polyline (from the turn at each point).
export function minRadius(P) {
  let r = Infinity;
  for (let i = 1; i < P.length - 1; i++) {
    const u = sub(P[i], P[i - 1]);
    const v = sub(P[i + 1], P[i]);
    const a = Math.abs(Math.atan2(u[0] * v[1] - u[1] * v[0], dot(u, v)));
    if (a > 1e-6) r = Math.min(r, ((len(u) + len(v)) / 2) / a);
  }
  return r;
}

// Track from a station at a, leaving along ta, to a station at b, the way
// railways are laid: straight out along the platform, one curve of fixed
// radius, then straight on into the next station (its platform straight
// too). The widest radius that fits is taken. Returns the track, the
// direction it arrives in, and how far it turns; or null.
const RADII = [2400, 1800, 1400, 1100, MIN_RADIUS];
const MAX_TURN = (90 * Math.PI) / 180;
// Out of the central station trains run slowly through the throat, so the
// lines may fan out there on tighter curves.
const CENTRE_RADII = [...RADII, 700, 550, CENTRE_RADIUS];
const CENTRE_TURN = (100 * Math.PI) / 180;
export function track(a, ta, b, fromCentre = false) {
  const radii = fromCentre ? CENTRE_RADII : RADII;
  const maxTurn = fromCentre ? CENTRE_TURN : MAX_TURN;
  const D = len(sub(b, a));
  if (D < 2 * PLATFORM + 50) return null;
  const a1 = add(a, mul(ta, PLATFORM));
  const nrm = [-ta[1], ta[0]];
  const side = dot(sub(b, a1), nrm) >= 0 ? 1 : -1;
  for (const R of radii) {
    const c = add(a1, mul(nrm, side * R));
    if (len(sub(b, c)) < R * 1.02) continue;
    // Round the curve until the track points at b.
    const pts = [a, a1];
    let p = a1;
    let h = ta;
    let turned = 0;
    const dth = STEP / R;
    while (side * (h[0] * (b[1] - p[1]) - h[1] * (b[0] - p[0])) > 0 && turned < maxTurn + dth) {
      const ang = side * dth;
      const r = sub(p, c);
      p = add(c, [r[0] * Math.cos(ang) - r[1] * Math.sin(ang), r[0] * Math.sin(ang) + r[1] * Math.cos(ang)]);
      h = [h[0] * Math.cos(ang) - h[1] * Math.sin(ang), h[0] * Math.sin(ang) + h[1] * Math.cos(ang)];
      turned += dth;
      pts.push(p);
    }
    if (turned > maxTurn) return null;
    const straight = len(sub(b, p));
    if (straight < PLATFORM) continue;
    const arrive = unit(sub(b, p));
    const n = Math.ceil(straight / (STEP * 4));
    for (let i = 1; i <= n; i++) pts.push(add(p, mul(sub(b, p), i / n)));
    return { pts, arrive, turn: turned, radius: R };
  }
  return null;
}

function pointAlong(P, s) {
  for (let i = 1; i < P.length; i++) {
    const l = len(sub(P[i], P[i - 1]));
    if (s <= l) return add(P[i - 1], mul(sub(P[i], P[i - 1]), s / (l || 1)));
    s -= l;
  }
  return P[P.length - 1];
}
const lengthOf = (P) => P.reduce((s, p, i) => (i ? s + len(sub(p, P[i - 1])) : 0), 0);

// cores: the city's cores, the central one first.
export function createRail(seed, { cores, terrain }) {
  const u = (...k) => toUnit(hash(seed, 'rail', ...k));
  const empty = { segments: [], stations: [], lines: [], near: () => [] };
  if (!cores.length) return empty;
  const C = cores[0];
  const cp = [C.x, C.y];
  const wet = (p) => terrain.isSea(p[0], p[1]);
  const dryRun = (a, b) => {
    const n = Math.ceil(len(sub(b, a)) / 100);
    for (let i = 1; i < n; i++) if (wet(add(a, mul(sub(b, a), i / n)))) return false;
    return true;
  };

  // ---- The direction through the central station ----
  // Along the spread of the city (its principal axis), turned if need be
  // so the line has land to run on either way.
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const c of cores) {
    const dx = c.x - C.x;
    const dy = c.y - C.y;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  let theta = cores.length > 2 ? 0.5 * Math.atan2(2 * sxy, sxx - syy) : u(1) * Math.PI;
  const landBothWays = (th) => {
    const t = [Math.cos(th), Math.sin(th)];
    let s = 0;
    for (const r of [1500, 3000, 5000]) s += (wet(add(cp, mul(t, r))) ? 0 : 1) + (wet(sub(cp, mul(t, r))) ? 0 : 1);
    return s;
  };
  {
    let best = { th: theta, s: landBothWays(theta) };
    for (let k = 1; k < 12 && best.s < 6; k++) {
      for (const sg of [1, -1]) {
        const th = theta + (sg * k * Math.PI) / 24;
        const s = landBothWays(th);
        if (s > best.s) best = { th, s };
      }
    }
    theta = best.th;
  }
  const axis = [Math.cos(theta), Math.sin(theta)];

  // ---- Arms ----
  // Stations are core indices; 0 is the centre.
  const P = cores.map((c) => [c.x, c.y]);
  // Where each station stands: at its district's core, or a little to one
  // side of it if that lets the line run more gently.
  const SP = P.map((q) => q.slice());
  const OFFSETS = [0, 220, -220, 400, -400];
  const reach = (from, dir, i, fromCentre) => {
    let best = null;
    const v = unit(sub(P[i], from));
    for (const o of OFFSETS) {
      const q = add(P[i], mul([-v[1], v[0]], o));
      if (terrain.isWater(q[0], q[1])) continue;
      const t = track(from, dir, q, fromCentre);
      if (!t) continue;
      const score = t.turn + Math.abs(o) / 800;
      if (!best || score < best.score) best = { t, q, score };
    }
    return best;
  };
  const taken = new Uint8Array(cores.length);
  taken[0] = 1;
  // Two trunks at most leave the central station each way (more would fan out
  // into slivers of land between the viaducts); other lines branch off them.
  const nArms = cores.length === 1 ? 0 : cores.length < 6 ? 2 : 4;
  const arms = [];
  for (let k = 0; k < nArms; k++) {
    const h = theta + (k * 2 * Math.PI) / nArms + (u(2, k) - 0.5) * 0.3;
    arms.push({ stations: [0], heading: h, side: Math.cos(h - theta) >= 0 ? 1 : -1, open: true });
  }
  // How a train leaves each station outward: from the centre along its
  // axis, elsewhere the way it arrived.
  const dirOut = new Map();
  const segments = new Map(); // "a>b" -> track, each stretch once
  const step = (arm) => {
    const at = arm.stations[arm.stations.length - 1];
    let best = null;
    for (let i = 1; i < P.length; i++) {
      if (taken[i]) continue;
      const v = sub(P[i], SP[at]);
      const D = len(v);
      if (D < SPACING[0] || D > SPACING[1]) continue;
      const dev = Math.abs(wrap(angleOf(v) - arm.heading));
      if (dev > TURN) continue;
      // Outward only: never back towards the centre.
      if (at !== 0 && len(sub(P[i], cp)) < len(sub(P[at], cp)) + 100) continue;
      if (!dryRun(SP[at], P[i])) continue;
      const r = reach(SP[at], at === 0 ? mul(axis, arm.side) : dirOut.get(at), i, at === 0);
      if (!r) continue;
      const score = D * (1 + 1.3 * r.t.turn + 0.5 * dev);
      if (!best || score < best.score) best = { i, score, v, t: r.t, q: r.q };
    }
    return best;
  };
  const take = (arm, s) => {
    const at = arm.stations[arm.stations.length - 1];
    taken[s.i] = 1;
    SP[s.i] = s.q;
    arm.stations.push(s.i);
    dirOut.set(s.i, s.t.arrive);
    segments.set(`${at}>${s.i}`, { key: `${at}>${s.i}`, a: at, b: s.i, pts: s.t.pts, radius: s.t.radius });
    arm.heading += wrap(angleOf(s.v) - arm.heading) * 0.5;
  };
  // Round by round, each arm taking its next station, so they share the
  // districts fairly.
  for (let round = 0; round < cores.length; round++) {
    let any = false;
    for (const arm of arms) {
      if (!arm.open) continue;
      const s = step(arm);
      if (!s) {
        arm.open = false;
        continue;
      }
      take(arm, s);
      any = true;
    }
    if (!any) break;
  }
  for (let a = arms.length - 1; a >= 0; a--) if (arms[a].stations.length < 2) arms.splice(a, 1);

  // ---- Branches ----
  // A district no arm reached: a branch leaving an arm at a station, along
  // its track, then curving off towards the district.
  const left = [];
  for (let i = 1; i < P.length; i++) if (!taken[i]) left.push(i);
  left.sort((a, b) => len(sub(P[a], cp)) - len(sub(P[b], cp)));
  for (const i of left) {
    if (taken[i]) continue;
    let best = null;
    for (const arm of arms) {
      for (let k = 1; k < arm.stations.length; k++) {
        const s = arm.stations[k];
        const v = sub(P[i], SP[s]);
        const D = len(v);
        if (D < SPACING[0] || D > SPACING[1]) continue;
        if (dot(v, dirOut.get(s)) <= 0) continue;
        if (!dryRun(SP[s], P[i])) continue;
        const r = reach(SP[s], dirOut.get(s), i, false);
        if (!r || r.t.turn > BRANCH_TURN) continue;
        const score = D * (1 + 1.3 * r.t.turn);
        if (!best || score < best.score) best = { score, arm, k, v, t: r.t, q: r.q };
      }
    }
    // Or a new arm, straight out of the central station either way.
    for (const sg of [1, -1]) {
      if (arms.filter((a) => a.side === sg && a.stations[0] === 0 && a.stations.length > 1 && !arms.some((o) => o !== a && o.stations.length < a.stations.length && a.stations.slice(0, o.stations.length).every((x, j) => x === o.stations[j]))).length >= TRUNKS) continue;
      const v = sub(P[i], cp);
      const D = len(v);
      if (D < SPACING[0] || D > SPACING[1] || !dryRun(cp, P[i])) continue;
      const r = reach(cp, mul(axis, sg), i, true);
      if (!r) continue;
      // (A branch off a line is better than one more line through the centre.)
      const score = D * (1 + 1.3 * r.t.turn) * 1.6;
      if (!best || score < best.score) best = { score, arm: { stations: [0], side: sg }, k: 0, v, t: r.t, q: r.q };
    }
    if (!best) continue;
    const branch = { stations: best.arm.stations.slice(0, best.k + 1), heading: angleOf(best.v), side: best.arm.side, open: true };
    take(branch, { i, v: best.v, t: best.t, q: best.q });
    for (let more = 0; more < cores.length; more++) {
      const s = step(branch);
      if (!s) break;
      take(branch, s);
    }
    arms.push(branch);
  }

  // Out into the country from the last station of each arm, and from the
  // centre on any side no arm leaves by: on as straight as the land allows,
  // turning gently off the water.
  const country = (from, dir, salt) => {
    const out = [from];
    let p = from;
    let h = angleOf(dir);
    let drift = 0;
    for (let s = 0; s < COUNTRY; s += STEP * 5) {
      drift += (u(10, salt, s) - 0.5) * 0.02;
      drift *= 0.9;
      let nh = h + drift;
      // Steer away from the sea, a little at a time.
      for (let k = 0; k < 9 && wet(add(p, mul([Math.cos(nh), Math.sin(nh)], 600))); k++) {
        const l = wet(add(p, mul([Math.cos(nh + 0.3), Math.sin(nh + 0.3)], 600)));
        nh += l ? -0.05 : 0.05;
      }
      // Never tighter than the tightest curve.
      const maxTurn = (STEP * 5) / MIN_RADIUS;
      h += Math.max(-maxTurn, Math.min(maxTurn, wrap(nh - h)));
      p = add(p, mul([Math.cos(h), Math.sin(h)], STEP * 5));
      out.push(p);
    }
    return out;
  };
  const ends = [];
  for (const arm of arms) {
    const last = arm.stations[arm.stations.length - 1];
    // A branch's parent goes on past the branch station; this one ends here.
    if (arms.some((o) => o !== arm && o.stations.length > arm.stations.length && o.stations.slice(0, arm.stations.length).every((s, i) => s === arm.stations[i]))) continue;
    ends.push({ key: `${last}>out`, from: SP[last], dir: dirOut.get(last), station: last, arm });
  }
  const sides = new Set(arms.map((a) => a.side));
  for (const sg of [1, -1]) if (!sides.has(sg)) ends.push({ key: `0>out${sg}`, from: cp, dir: mul(axis, sg), station: 0, arm: null });
  const termini = [];
  ends.forEach((e, i) => {
    // A straight platform first, then out; but a line that would have to
    // turn back off the sea ends at its station, a terminus by the water.
    const pl = add(e.from, mul(e.dir, PLATFORM));
    const run = country(pl, e.dir, i);
    const ahead = run.slice(0, Math.ceil(4000 / (STEP * 5)));
    const h0 = angleOf(e.dir);
    const turned = ahead.some((q, k) => k > 0 && Math.abs(wrap(angleOf(sub(q, ahead[k - 1])) - h0)) > Math.PI / 2);
    if (turned || ahead.some((q) => wet(q))) {
      termini.push({ p: e.from, dir: e.dir, station: e.station });
      return;
    }
    segments.set(e.key, { key: e.key, a: e.station, b: null, pts: [e.from, ...run], radius: MIN_RADIUS, country: true });
  });

  // ---- Lines ----
  // Arms paired across the centre, one from each side; arms left over are
  // paired with one already in a line (the two share its track).
  const plus = arms.filter((a) => a.side > 0);
  const minus = arms.filter((a) => a.side < 0);
  const lines = [];
  const outEnd = (sg) => `0>out${sg}`;
  const longer = (A, B) => (A.length >= B.length ? A : B);
  const count = Math.max(plus.length, minus.length, 1);
  for (let k = 0; k < count; k++) {
    const a = plus.length ? plus[k % plus.length] : null;
    const b = minus.length ? minus[k % minus.length] : null;
    lines.push({ id: lines.length, arms: [a, b], ends: [a ? null : outEnd(1), b ? null : outEnd(-1)] });
  }
  void longer;

  // ---- Stations ----
  const stations = new Map();
  const station = (s, extra = {}) => {
    if (!stations.has(s)) stations.set(s, { id: s, p: SP[s], key: cores[s].key, central: s === 0, dir: s === 0 ? axis : dirOut.get(s), ...extra });
    return stations.get(s);
  };
  station(0);
  for (const arm of arms) for (const s of arm.stations) station(s);
  // Stops in the middle of long stretches between district stations.
  const stops = [];
  for (const sg of segments.values()) {
    if (sg.country) continue;
    const L = lengthOf(sg.pts);
    if (L < EXTRA_STOP) continue;
    const p = pointAlong(sg.pts, L / 2);
    if (terrain.isWater(p[0], p[1])) continue;
    const q = pointAlong(sg.pts, L / 2 + 20);
    stops.push({ id: `m${sg.key}`, p, key: null, central: false, dir: unit(sub(q, p)), stop: true, segment: sg.key });
  }

  const segs = [...segments.values()];
  for (const sg of segs) {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of sg.pts) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    sg.bbox = { x0, y0, x1, y1 };
  }
  // Track touching a rectangle.
  const near = (x0, y0, x1, y1) => segs.filter((s) => !(s.bbox.x1 < x0 || s.bbox.x0 > x1 || s.bbox.y1 < y0 || s.bbox.y0 > y1));
  // Districts joined directly by a stretch of track.
  const joined = new Set();
  for (const sg of segs) if (sg.b !== null) {
    joined.add(`${cores[sg.a].key}|${cores[sg.b].key}`);
    joined.add(`${cores[sg.b].key}|${cores[sg.a].key}`);
  }
  return {
    segments: segs,
    stations: [...stations.values(), ...stops],
    lines,
    arms,
    termini,
    axis,
    near,
    joins: (ka, kb) => joined.has(`${ka}|${kb}`),
  };
}
