// Regional rail, planned for the whole city at once as one network.
//
// It is radial: lines run out from the central station to the country in
// most directions, and through running, each coming in on one side of the
// centre and going out on the other. The central station has two axes
// crossing at about a right angle (as Berlin's main station does); each
// line runs straight through along one of them. Out from the centre each
// of the four trunks carries its lines through one district station after
// another, and now and then divides in two at a station (never three ways,
// and at most twice along a line), so the lines spread out into the
// districts. Lines keep well apart: no two tracks run close side by side.
// Not every district needs a station of its own, but every district should
// have one in a district next to it. A large city also has a ring line
// round its inner districts (as the Ringbahn or the Yamanote Line), meeting
// the radial lines at interchange stations.
//
// The network is judged as a whole: several layouts (the axes turned this
// way and that) are laid out and scored on how many districts they serve
// and how evenly they reach out in every direction, against how much track
// they take, and the best is kept.
//
// Track is laid as railways are, for 140 km/h: straight along each platform,
// and between stations one curve of fixed radius (no tighter than 900 m)
// then straight on; tighter curves only in the central station's throat,
// where trains run slowly. A long stretch between district stations gets
// an infill stop. The tracks run on viaducts across the neighbourhoods,
// never down the streets; neighbourhood boundaries are drawn along them.

import { hash, toUnit } from '../core/hash.js';

export const MIN_RADIUS = 900; // metres: the tightest curve out on the line
export const CENTRE_RADIUS = 400; // and leaving the central station
export const VIADUCT_WIDTH = 11; // metres: a two-track viaduct
const PLATFORM = 170; // metres of straight track either side of a station
const SPACING = [1300, 7000]; // metres from one district station to the next
const REACH = (60 * Math.PI) / 180; // how far off its heading a trunk may reach for a station
const SPLIT_APART = (38 * Math.PI) / 180; // the least angle between the two lines of a division
const SPLITS = 2; // divisions along any one line, at most
const GAP = 750; // metres two tracks keep apart, away from the stations they share
const OUT_ANGLE = (60 * Math.PI) / 180; // how far off the way out from the centre a line may run
const LAYOUTS = 36; // whole networks laid out and judged
const PART = 1400; // metres out from a division before its two tracks must be GAP apart
const TAIL_TURN = (75 * Math.PI) / 180; // the most a line out into the country turns
const NEAR = 3000; // metres: districts this close are next to each other
const INFILL = 3200; // metres: a stretch this long between stations gets an infill stop
const RING_CITY = 20; // districts (3 million people): from here, a ring line
const COUNTRY = 14000; // metres the lines run on beyond the city
const STEP = 20; // metres between points of track
// Line colours, as on a transit map.
export const RAIL_COLOURS = ['#2f6db5', '#d4442e', '#2e9a5b', '#8e44ad', '#e6900f', '#0b8fa3', '#b5651d', '#c2185b', '#5d6d7e', '#7cb342', '#3949ab', '#00897b'];

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
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b)))));

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
const MAX_TURN = (80 * Math.PI) / 180;
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

// A smooth closed curve through points (centripetal Catmull-Rom), sampled.
function closedCurve(Q, step = STEP) {
  const n = Q.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = Q[(i - 1 + n) % n];
    const p1 = Q[i];
    const p2 = Q[(i + 1) % n];
    const p3 = Q[(i + 2) % n];
    const k = Math.max(2, Math.ceil(len(sub(p2, p1)) / step));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([0, 1].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
    }
  }
  return out;
}

// cores: the city's cores, the central one first.
export function createRail(seed, { cores, terrain }) {
  const u = (...k) => toUnit(hash(seed, 'rail', ...k));
  if (!cores.length) return { segments: [], stations: [], lines: [], near: () => [], joins: () => false, termini: [] };
  const N = cores.length;
  const P = cores.map((c) => [c.x, c.y]);
  const cp = P[0];
  const wet = (p) => terrain.isSea(p[0], p[1]) || (terrain.isHigh && terrain.isHigh(p[0], p[1]));
  const dryRun = (a, b) => {
    const n = Math.ceil(len(sub(b, a)) / 100);
    for (let i = 1; i < n; i++) if (wet(add(a, mul(sub(b, a), i / n)))) return false;
    return true;
  };
  const farthest = Math.max(1, ...P.map((p) => len(sub(p, cp))));

  // ---- One layout, for axes at angle theta ----
  // Outward only, and roughly away from the centre, so lines run out
  // radially rather than curling round it.
  const outward = (from, i) => len(sub(P[i], cp)) > len(sub(from, cp)) + 300 && angleBetween(sub(P[i], from), sub(P[i], cp)) < OUT_ANGLE;
  function layout(theta, splitRatio, keep) {
    const axes = N < 6 ? [theta] : [theta, theta + Math.PI / 2];
    const SP = P.map((q) => q.slice()); // where each station stands
    const taken = new Uint8Array(N);
    taken[0] = 1;
    const dirOut = new Map(); // station -> the way trains leave it outward
    const segs = []; // { a, b, pts }
    const samples = []; // track points, for keeping tracks apart
    const nodes = []; // { s, parent, side, splits }
    // Points along a track, away from its stations.
    const inner = (pts) => {
      const L = lengthOf(pts);
      const out = [];
      for (let s = 600; s < L - 600; s += 120) out.push(pointAlong(pts, s));
      return out;
    };
    // (Near the station it leaves, a track may run close to those it
    // leaves beside: lines dividing there part gradually.)
    const clear = (pts) => {
      for (const q of inner(pts)) if (len(sub(q, pts[0])) > PART) for (const o of samples) if (Math.abs(q[0] - o[0]) < GAP && Math.abs(q[1] - o[1]) < GAP && len(sub(q, o)) < GAP) return false;
      return true;
    };
    // A station's place: at its core, or a little to one side of it if
    // that lets the line run more gently.
    const OFFSETS = [0, 220, -220, 400, -400];
    const reach = (from, dir, i, fromCentre) => {
      let best = null;
      const v = unit(sub(P[i], from));
      for (const o of OFFSETS) {
        const q = add(P[i], mul([-v[1], v[0]], o));
        if (wet(q)) continue;
        const t = track(from, dir, q, fromCentre);
        if (!t || angleBetween(t.arrive, sub(q, cp)) > OUT_ANGLE || !clear(t.pts)) continue;
        const score = t.turn + Math.abs(o) / 800;
        if (!best || score < best.score) best = { t, q, score };
      }
      return best;
    };
    // Grow a trunk outward from station s (already placed), leaving along
    // dir: one station at a time, now and then dividing in two.
    const grow = (s, dir, heading, splits, side) => {
      const cands = [];
      for (let i = 1; i < N; i++) {
        if (taken[i]) continue;
        const v = sub(P[i], SP[s]);
        const D = len(v);
        if (D < SPACING[0] || D > SPACING[1]) continue;
        if (Math.abs(wrap(angleOf(v) - heading)) > REACH) continue;
        if (s !== 0 && !outward(SP[s], i)) continue;
        if (!dryRun(SP[s], P[i])) continue;
        const r = reach(SP[s], dir, i, s === 0);
        if (!r) continue;
        const dev = Math.abs(wrap(angleOf(v) - heading));
        cands.push({ i, D, v, r, score: D * (1 + 1.4 * r.t.turn + keep * dev) });
      }
      cands.sort((a, b) => a.score - b.score);
      if (!cands.length) return;
      const picks = [cands[0]];
      // Divide here if a second district lies well off to one side, not
      // much farther, while this line may still divide.
      if (splits > 0 && s !== 0) {
        const two = cands.find((c) => c !== cands[0] && angleBetween(c.v, cands[0].v) > SPLIT_APART && c.score < cands[0].score * splitRatio && len(sub(P[c.i], P[cands[0].i])) > NEAR * 0.7);
        if (two) picks.push(two);
      }
      for (const c of picks) {
        // (Re-checked: the first pick's track may now crowd the second's.)
        const r = picks.length > 1 && c !== picks[0] ? reach(SP[s], dir, c.i, false) : c.r;
        if (!r || taken[c.i]) continue;
        taken[c.i] = 1;
        SP[c.i] = r.q;
        dirOut.set(c.i, r.t.arrive);
        segs.push({ a: s, b: c.i, pts: r.t.pts });
        samples.push(...inner(r.t.pts));
        nodes.push({ s: c.i, parent: s, side, splits: splits - (picks.length - 1) });
      }
      for (const c of picks) {
        if (!dirOut.has(c.i) || nodes.find((n) => n.s === c.i).parent !== s) continue;
        grow(c.i, dirOut.get(c.i), heading + wrap(angleOf(c.v) - heading) * 0.5, splits - (picks.length - 1), side);
      }
    };
    const sides = [];
    for (const th of axes) for (const sg of [1, -1]) sides.push({ th, dir: [Math.cos(th) * sg, Math.sin(th) * sg], heading: th + (sg < 0 ? Math.PI : 0) });
    // Grow the trunks a station at a time in turn, so they share the
    // districts fairly: done by growing each fully in an order that
    // alternates sides (good enough with the outward-only rule).
    sides.forEach((sd, k) => grow(0, sd.dir, sd.heading, SPLITS, k));

    // ---- Repair ----
    // A district with no station in it or next to it: reached by carrying a
    // line on from its end, or by a line dividing in two at a station on the
    // way (if that keeps every line to its divisions, and the station is not
    // already a division).
    const kids = (s) => nodes.filter((n) => n.parent === s);
    const nodeOf = (s) => nodes.find((n) => n.s === s);
    const above = (s) => {
      let k = 0;
      for (let n = nodeOf(s); n; n = nodeOf(n.parent)) if (n.parent !== 0 && kids(n.parent).length === 2) k++;
      return k;
    };
    const below = (s) => {
      const ks = kids(s);
      if (!ks.length) return 0;
      return Math.max(...ks.map((c) => below(c.s))) + (ks.length === 2 ? 1 : 0);
    };
    const served = () => new Set([0, ...nodes.map((n) => n.s)]);
    const uncovered = (i, on) => !on.has(i) && ![...on].some((j) => len(sub(P[i], P[j])) < NEAR);
    for (let changed = true; changed; ) {
      changed = false;
      const on = served();
      const want = [];
      for (let i = 1; i < N; i++) if (!taken[i] && uncovered(i, on)) want.push(i);
      want.sort((a, b) => len(sub(P[a], cp)) - len(sub(P[b], cp)));
      for (const w of want) {
        let best = null;
        // A station in it, or in a district next to it.
        for (let i = 1; i < N; i++) {
          if (taken[i] || len(sub(P[i], P[w])) >= NEAR) continue;
          for (const n of nodes) {
            const ks = kids(n.s);
            if (ks.length > 1) continue;
            const used = ks.length ? above(n.s) + 1 + below(ks[0].s) : 0;
            if (used > SPLITS) continue;
            const v = sub(P[i], SP[n.s]);
            const D = len(v);
            if (D < SPACING[0] || D > SPACING[1]) continue;
            if (!outward(SP[n.s], i)) continue;
            const dir = dirOut.get(n.s);
            if (angleBetween(v, dir) > (75 * Math.PI) / 180) continue;
            if (ks.length && angleBetween(v, sub(SP[ks[0].s], SP[n.s])) < SPLIT_APART * 0.7) continue;
            if (!dryRun(SP[n.s], P[i])) continue;
            const r = reach(SP[n.s], dir, i, false);
            if (!r) continue;
            const score = D * (1 + 1.4 * r.t.turn) * (ks.length ? 1.3 : 1) * (i === w ? 1 : 1.15);
            if (!best || score < best.score) best = { i, n, r, v, score, split: ks.length > 0 };
          }
        }
        if (!best) continue;
        const { i, n, r, v } = best;
        const left = SPLITS - (best.split ? above(n.s) + 1 : above(n.s));
        taken[i] = 1;
        SP[i] = r.q;
        dirOut.set(i, r.t.arrive);
        segs.push({ a: n.s, b: i, pts: r.t.pts });
        samples.push(...inner(r.t.pts));
        nodes.push({ s: i, parent: n.s, side: n.side, splits: left });
        grow(i, r.t.arrive, angleOf(v), left, n.side);
        changed = true;
        break;
      }
    }
    for (const n of nodes) n.dir = dirOut.get(n.s);

    // ---- Score ----
    const onRail = new Set([0, ...nodes.map((n) => n.s)]);
    let covered = 0;
    for (let i = 0; i < N; i++) if (onRail.has(i) || [...onRail].some((j) => len(sub(P[i], P[j])) < NEAR)) covered++;
    // Reach in every direction: the widest gap between the lines' ends.
    const tails = nodes.filter((n) => !nodes.some((m) => m.parent === n.s)).map((n) => angleOf(sub(SP[n.s], cp))).sort((a, b) => a - b);
    let widest = 2 * Math.PI;
    if (tails.length > 1) {
      widest = tails[0] + 2 * Math.PI - tails[tails.length - 1];
      for (let k = 1; k < tails.length; k++) widest = Math.max(widest, tails[k] - tails[k - 1]);
    }
    const km = segs.reduce((a, s) => a + lengthOf(s.pts), 0) / 1000;
    const score = (10 * covered) / N + (2 * onRail.size) / N - 0.5 * Math.min(2, widest) - km * 0.01;
    return { theta, axes, SP, dirOut, segs, nodes, score, onRail };
  }

  // Lay out the network with the axes turned a step at a time; keep the best.
  const tries = N < 2 ? [[u(1) * Math.PI, 1.8, 1]] : Array.from({ length: LAYOUTS }, (_, k) => [(k / LAYOUTS) * (N < 6 ? Math.PI : Math.PI / 2) + u(2) * 0.2, 1.3 + 1.4 * u(3, k), 2 * u(4, k)]);
  let best = null;
  for (const th of tries) {
    const L = layout(...th);
    if (!best || L.score > best.score) best = L;
  }
  const { SP, dirOut, segs, nodes, axes } = best;

  // ---- The ring ----
  // Round the inner districts, through those about halfway out, smoothed
  // into a loop no tighter than the line's curves allow.
  const ringSegs = [];
  let ring = null;
  if (N >= RING_CITY) {
    let ids = [];
    for (let i = 1; i < N; i++) {
      const r = len(sub(P[i], cp)) / farthest;
      if (r > 0.25 && r < 0.62) ids.push(i);
    }
    ids.sort((a, b) => angleOf(sub(P[a], cp)) - angleOf(sub(P[b], cp)));
    // Thin out stations too close together, then drop the sharpest corner
    // until the loop is smooth enough.
    const pos = (i) => SP[i];
    for (let changed = true; changed && ids.length > 6; ) {
      changed = false;
      for (let k = 0; k < ids.length && ids.length > 6; k++) {
        if (len(sub(pos(ids[k]), pos(ids[(k + 1) % ids.length]))) < SPACING[0]) {
          ids.splice((k + 1) % ids.length, 1);
          changed = true;
        }
      }
    }
    for (let guard = 0; guard < 30 && ids.length >= 6; guard++) {
      const curve = closedCurve(ids.map(pos));
      if (minRadius(curve) >= MIN_RADIUS * 0.85 && !curve.some((q) => wet(q))) {
        ring = { ids, pts: curve.concat([curve[0]]) };
        break;
      }
      let worst = 0;
      let wa = -1;
      ids.forEach((id, k) => {
        const a = pos(ids[(k - 1 + ids.length) % ids.length]);
        const b = pos(id);
        const c = pos(ids[(k + 1) % ids.length]);
        const t = angleBetween(sub(b, a), sub(c, b));
        if (t > wa) [wa, worst] = [t, k];
      });
      ids.splice(worst, 1);
    }
    if (ring) {
      // The ring in stretches from station to station.
      const R = ring.pts;
      const at = ring.ids.map((id) => {
        let bi = 0;
        let bd = Infinity;
        R.forEach((q, j) => {
          const dd = len(sub(q, pos(id)));
          if (dd < bd) [bd, bi] = [dd, j];
        });
        return bi;
      });
      for (let k = 0; k < ring.ids.length; k++) {
        const a = at[k];
        const b = at[(k + 1) % ring.ids.length];
        const pts = b > a ? R.slice(a, b + 1) : R.slice(a).concat(R.slice(1, b + 1));
        ringSegs.push({ a: ring.ids[k], b: ring.ids[(k + 1) % ring.ids.length], pts, ring: true });
      }
    }
  }

  // ---- Out into the country ----
  // From each trunk's end, on as straight as the land allows; but a line
  // that would have to turn back off the sea ends at its station.
  const country = (from, dir, salt) => {
    const out = [from];
    let p = from;
    let h = angleOf(dir);
    const h0 = h;
    let drift = 0;
    for (let s = 0; s < COUNTRY; s += STEP * 5) {
      // (Where the land turns it too far, or it cannot get by, it stops.)
      if (Math.abs(wrap(h - h0)) > TAIL_TURN || wet(add(p, mul([Math.cos(h), Math.sin(h)], 200)))) break;
      drift += (u(10, salt, s) - 0.5) * 0.02;
      drift *= 0.9;
      // Bending gently away from the centre, so lines out of the city
      // spread apart.
      let nh = h + drift + Math.max(-0.02, Math.min(0.02, wrap(angleOf(sub(p, cp)) - h) * 0.05));
      for (let k = 0; k < 9 && wet(add(p, mul([Math.cos(nh), Math.sin(nh)], 600))); k++) {
        const l = wet(add(p, mul([Math.cos(nh + 0.3), Math.sin(nh + 0.3)], 600)));
        nh += l ? -0.05 : 0.05;
      }
      const maxTurn = (STEP * 5) / MIN_RADIUS;
      h += Math.max(-maxTurn, Math.min(maxTurn, wrap(nh - h)));
      p = add(p, mul([Math.cos(h), Math.sin(h)], STEP * 5));
      out.push(p);
    }
    return out;
  };
  const segments = [];
  const segOf = new Map();
  const keyOf = (a, b) => `${a}>${b}`;
  for (const s of segs) {
    const sg = { key: keyOf(s.a, s.b), a: s.a, b: s.b, pts: s.pts };
    segments.push(sg);
    segOf.set(sg.key, sg);
  }
  for (const s of ringSegs) {
    const sg = { key: `r${s.a}>${s.b}`, a: s.a, b: s.b, pts: s.pts, ring: true };
    segments.push(sg);
    segOf.set(sg.key, sg);
  }
  const termini = [];
  const tailOf = new Map(); // station -> its country segment's key, or null for a terminus
  const tailsFrom = (from, dir, station, salt) => {
    const pl = add(from, mul(dir, PLATFORM));
    const run = country(pl, dir, salt);
    if (lengthOf(run) < 4000) {
      termini.push({ p: from, dir, station });
      return null;
    }
    const key = `${station}>out${salt}`;
    const sg = { key, a: station, b: null, pts: [from, ...run], country: true };
    segments.push(sg);
    segOf.set(key, sg);
    return key;
  };
  const leaves = nodes.filter((n) => !nodes.some((m) => m.parent === n.s));
  leaves.forEach((n, k) => tailOf.set(n.s, tailsFrom(SP[n.s], n.dir, n.s, k)));
  // A side of an axis with no trunk at all: the line runs straight out.
  const sideDirs = [];
  for (const th of axes) for (const sg of [1, -1]) sideDirs.push([Math.cos(th) * sg, Math.sin(th) * sg]);
  const sideRoots = sideDirs.map((d, k) => {
    const first = nodes.filter((n) => n.parent === 0 && dot(unit(sub(SP[n.s], cp)), d) > Math.cos(Math.PI / 2.2));
    if (first.length) return { dir: d, roots: first };
    return { dir: d, roots: [], out: tailsFrom(cp, d, 0, 100 + k) };
  });

  // ---- Lines ----
  // Every path from the centre out to a trunk's end, on each side of an
  // axis, paired with one on the other side: a line through the centre.
  const pathTo = (s) => {
    const out = [];
    for (let n = nodes.find((m) => m.s === s); n; n = nodes.find((m) => m.s === n.parent)) out.unshift(n.s);
    return [0, ...out];
  };
  const tipsOf = (sr) => {
    if (!sr.roots.length) return [{ path: [0], out: sr.out, angle: angleOf(sr.dir) }];
    const rootSet = new Set(sr.roots.map((r) => r.s));
    return leaves.filter((l) => pathTo(l.s).some((s) => rootSet.has(s))).map((l) => ({ path: pathTo(l.s), out: tailOf.get(l.s), angle: angleOf(sub(SP[l.s], cp)) }));
  };
  const lines = [];
  for (let a = 0; a < axes.length; a++) {
    const A = tipsOf(sideRoots[a * 2]).sort((x, y) => x.angle - y.angle);
    const B = tipsOf(sideRoots[a * 2 + 1]).sort((x, y) => y.angle - x.angle);
    const n = Math.max(A.length, B.length);
    for (let k = 0; k < n; k++) {
      const x = A[k % A.length];
      const y = B[k % B.length];
      // Stations from x's far end in to the centre, then out to y's.
      const stations = [...x.path.slice().reverse(), ...y.path.slice(1)];
      const keys = [];
      if (x.out) keys.push(x.out);
      for (let i = 0; i + 1 < stations.length; i++) {
        const k1 = keyOf(stations[i], stations[i + 1]);
        const k2 = keyOf(stations[i + 1], stations[i]);
        keys.push(segOf.has(k1) ? k1 : k2);
      }
      if (y.out) keys.push(y.out);
      lines.push({ stations, segments: keys });
    }
  }
  if (ring) lines.push({ stations: ring.ids.concat([ring.ids[0]]), segments: ringSegs.map((s) => `r${s.a}>${s.b}`), ring: true });
  lines.forEach((l, k) => {
    l.id = k;
    l.name = l.ring ? 'R' : String.fromCharCode(65 + k);
    l.colour = l.ring ? '#7a8792' : RAIL_COLOURS[k % RAIL_COLOURS.length];
  });
  // Which lines run on each stretch, in order across it (for drawing them
  // side by side).
  for (const sg of segments) sg.lines = lines.filter((l) => l.segments.includes(sg.key)).map((l) => l.id);

  // ---- Stations ----
  const stations = new Map();
  const station = (s) => {
    if (!stations.has(s)) {
      const ringHere = ring && ring.ids.includes(s);
      stations.set(s, { id: s, p: SP[s], key: cores[s].key, central: s === 0, dir: s === 0 ? sideDirs[0] : dirOut.get(s) || (ringHere ? unit(sub(SP[ring.ids[(ring.ids.indexOf(s) + 1) % ring.ids.length]], SP[s])) : [1, 0]), lines: [] });
    }
    return stations.get(s);
  };
  station(0);
  for (const n of nodes) station(n.s);
  if (ring) for (const s of ring.ids) station(s);
  for (const l of lines) for (const s of l.stations) station(s).lines.includes(l.id) || station(s).lines.push(l.id);
  for (const sg of segments) {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of sg.pts) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    sg.bbox = { x0, y0, x1, y1 };
  }
  // Where the ring crosses a radial line away from a station, an
  // interchange station at the crossing (as at Akihabara: rare, since the
  // ring runs through district stations the radial lines also serve).
  const stops = [];
  const stationAt = (q, r) => [...stations.values()].some((st) => len(sub(st.p, q)) < r);
  const crossing = (A, B) => {
    for (let i = 1; i < A.length; i++) {
      const a = A[i - 1];
      const ab = sub(A[i], a);
      for (let j = 1; j < B.length; j++) {
        const c = B[j - 1];
        const cd = sub(B[j], c);
        const den = ab[0] * cd[1] - ab[1] * cd[0];
        if (!den) continue;
        const ac = sub(c, a);
        const t = (ac[0] * cd[1] - ac[1] * cd[0]) / den;
        const v = (ac[0] * ab[1] - ac[1] * ab[0]) / den;
        if (t >= 0 && t <= 1 && v >= 0 && v <= 1) return { p: add(a, mul(ab, t)), dir: unit(ab) };
      }
    }
    return null;
  };
  for (const rs of segments.filter((sg) => sg.ring)) {
    for (const sg of segments) {
      if (sg.ring || sg.country || rs.bbox.x1 < sg.bbox.x0 || rs.bbox.x0 > sg.bbox.x1 || rs.bbox.y1 < sg.bbox.y0 || rs.bbox.y0 > sg.bbox.y1) continue;
      const x = crossing(rs.pts, sg.pts);
      if (!x || stationAt(x.p, 600) || wet(x.p)) continue;
      stops.push({ id: `x${rs.key}|${sg.key}`, p: x.p, key: null, central: false, dir: x.dir, stop: true, interchange: true, segment: rs.key, lines: [...rs.lines, ...sg.lines] });
    }
  }
  // Infill stops on long stretches between district stations, where people
  // live (but not just by another station).
  for (const sg of segments) {
    if (sg.country) continue;
    const L = lengthOf(sg.pts);
    if (L < INFILL) continue;
    const p = pointAlong(sg.pts, L / 2);
    if (terrain.isWater(p[0], p[1]) || stationAt(p, 1000) || stops.some((o) => len(sub(o.p, p)) < 1000)) continue;
    const q = pointAlong(sg.pts, L / 2 + 20);
    stops.push({ id: `m${sg.key}`, p, key: null, central: false, dir: unit(sub(q, p)), stop: true, segment: sg.key, lines: sg.lines.slice() });
  }

  // Track touching a rectangle.
  const near = (x0, y0, x1, y1) => segments.filter((s) => !(s.bbox.x1 < x0 || s.bbox.x0 > x1 || s.bbox.y1 < y0 || s.bbox.y0 > y1));
  // Districts joined directly by a stretch of track.
  const joined = new Set();
  for (const sg of segments) if (sg.b !== null) {
    joined.add(`${cores[sg.a].key}|${cores[sg.b].key}`);
    joined.add(`${cores[sg.b].key}|${cores[sg.a].key}`);
  }
  return {
    segments,
    stations: [...stations.values(), ...stops],
    lines,
    termini,
    axes,
    near,
    joins: (ka, kb) => joined.has(`${ka}|${kb}`),
    // Which districts have a station, and which only one next door.
    served: best.onRail,
  };
}
