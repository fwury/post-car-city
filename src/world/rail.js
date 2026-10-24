// Regional rail, planned for the whole city at once as one network.
//
// A smaller city has one trunk through the central station: lines come in
// on one side and run straight through, out the other (through running, as
// the RER does), dividing now and then at stations further out so they
// spread into the districts (never three ways, and at most twice along a
// line). A large city instead has a loop line through the central station
// and the districts round the heart of the city, as the Yamanote Line runs
// through Tokyo, Shinjuku and Shibuya: the radial lines branch off it at its
// stations, and come in along it through the centre and out along another
// branch, so trains can reach any part of the network on its own track.
// Stations have at most two sets of tracks meeting; lines meet side by side,
// along the same alignment, not crossing at an angle.
//
// Not every district needs a station of its own, but every district should
// have one in a district next to it. Tracks keep well apart. The network is
// judged as a whole: several layouts are laid out and scored on how many
// districts they serve and how evenly they reach out in every direction,
// against how much track they take, and the best is kept.
//
// Track is laid for 140 km/h: straight along each platform, and between
// stations one curve of fixed radius (no tighter than 900 m) then straight
// on; branches leave the loop on a wider turn. A long stretch between
// district stations gets an infill stop.
//
// In the city centre the lines run in tunnels (the many tracks there would
// cut up the streets); out from it, on viaducts above a walking and cycling
// path, but every station is underground, its hall standing over the
// platforms, the track ramping down to it and back up.

import { hash, toUnit } from '../core/hash.js';

export const MIN_RADIUS = 900; // metres: the tightest curve out on the line
export const CENTRE_RADIUS = 400; // and leaving the central station
export const VIADUCT_WIDTH = 11; // metres: a two-track viaduct
const PLATFORM = 170; // metres of straight track either side of a station
const SPACING = [1300, 7000]; // metres from one district station to the next
const REACH = (60 * Math.PI) / 180; // how far off its heading a trunk may reach for a station
const BRANCH_REACH = (110 * Math.PI) / 180; // and a branch where it divides
const SPLIT_APART = (38 * Math.PI) / 180; // the least angle between the two lines of a division
const SPLITS = 2; // divisions along any one line, at most
const GAP = 750; // metres two tracks keep apart, away from the stations they share
const OUT_ANGLE = (60 * Math.PI) / 180; // how far off the way out from the centre a line may run
const LAYOUTS = 45; // whole networks laid out and judged
const PART = 1400; // metres out from a division before its two tracks must be GAP apart
const TAIL_TURN = (75 * Math.PI) / 180; // the most a line out into the country turns
const NEAR = 3000; // metres: districts this close are next to each other
const INFILL = 3200; // metres: a stretch this long between stations gets an infill stop
const RING_CITY = 20; // districts (3 million people): from here, a loop line
const RING_SIZE = [0.24, 0.3, 0.36]; // the loop's radius, as a share of the city's
const RING_CHOICES = 3; // loops laid out networks are tried round
const UNDER = 260; // metres either side of a station the track is underground
const RAMP = 420; // metres of ramp between tunnel and viaduct
const ALONG_GAP = 45; // metres: track this close beside a street running the same way...
const ALONG_COS = 0.88; // (within about 28 degrees of it)...
const ALONG_MIN = 120; // ...for this far or more goes underground
const ALONG_NEAR = 100; // (and on underground while within this of it)
const OVER = 600; // metres the path beside the track runs on over a tunnel, at most (into a station hall's forecourt)
const TUNNEL_CENTRE = [1400, 3200]; // metres: how far out from the central station the lines run in tunnel, at least and at most
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
// A branch leaving the loop turns further (out from along the loop).
const JUNCTION_TURN = (120 * Math.PI) / 180;
export function track(a, ta, b, mode = false) {
  const radii = mode === true ? CENTRE_RADII : RADII;
  const maxTurn = mode === true ? CENTRE_TURN : mode === 'junction' ? JUNCTION_TURN : MAX_TURN;
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
function resample(P, step) {
  const L = lengthOf(P);
  const n = Math.max(1, Math.round(L / step));
  const out = [];
  for (let k = 0; k <= n; k++) out.push(pointAlong(P, (L * k) / n));
  return out;
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
export function createRail(seed, { cores, terrain, streetsNear = () => [] }) {
  const u = (...k) => toUnit(hash(seed, 'rail', ...k));
  if (!cores.length) return { segments: [], stations: [], lines: [], near: () => [], surfaceIn: () => [], joins: () => false, termini: [] };
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

  // ---- The loop (large cities) ----
  // Through the central station and the districts about a circle beside it,
  // smoothed into a loop no tighter than the line's curves allow. Several
  // circles (turned and sized) are tried; the one serving most districts
  // with a smooth loop is kept.
  const rings = [];
  if (N >= RING_CITY) {
    for (let k = 0; k < 16; k++) {
      for (const f of RING_SIZE) {
        const th = (k / 16) * 2 * Math.PI + u(20) * 0.4;
        const R = Math.max(2200, f * farthest);
        const C = add(cp, mul([Math.cos(th), Math.sin(th)], R));
        let ids = [0];
        for (let i = 1; i < N; i++) if (Math.abs(len(sub(P[i], C)) - R) < 0.35 * R) ids.push(i);
        ids.sort((a, b) => angleOf(sub(P[a], C)) - angleOf(sub(P[b], C)));
        const off = (i) => Math.abs(len(sub(P[i], C)) - R);
        // Stations too close together: the one further off the circle goes.
        for (let changed = true; changed && ids.length > 6; ) {
          changed = false;
          for (let q = 0; q < ids.length; q++) {
            const a = ids[q];
            const b = ids[(q + 1) % ids.length];
            if (len(sub(P[a], P[b])) >= SPACING[0]) continue;
            const drop = a === 0 ? b : b === 0 ? a : off(a) > off(b) ? a : b;
            ids.splice(ids.indexOf(drop), 1);
            changed = true;
            break;
          }
        }
        // The sharpest corner goes (never the central station: then the
        // worse of its neighbours) until the loop is smooth and on land.
        let pts = null;
        for (let guard = 0; guard < 30 && ids.length >= 6; guard++) {
          const curve = closedCurve(ids.map((i) => P[i]));
          if (minRadius(curve) >= MIN_RADIUS * 0.85 && !curve.some((q) => wet(q))) {
            pts = curve.concat([curve[0]]);
            break;
          }
          let worst = -1;
          let wa = -1;
          ids.forEach((id, q) => {
            const t = angleBetween(sub(P[id], P[ids[(q - 1 + ids.length) % ids.length]]), sub(P[ids[(q + 1) % ids.length]], P[id]));
            if (t > wa) [wa, worst] = [t, q];
          });
          if (ids[worst] === 0) {
            const a = ids[(worst - 1 + ids.length) % ids.length];
            const b = ids[(worst + 1) % ids.length];
            worst = ids.indexOf(off(a) > off(b) ? a : b);
          }
          ids.splice(worst, 1);
        }
        if (!pts) continue;
        let covered = 0;
        for (let i = 0; i < N; i++) if (ids.some((j) => len(sub(P[i], P[j])) < NEAR)) covered++;
        const score = covered + 0.5 * ids.length - lengthOf(pts) / 4000;
        rings.push({ score, ids, pts, C, R });
      }
    }
    rings.sort((a, b) => b.score - a.score);
    // The best few, unlike each other.
    const chosen = [];
    for (const r of rings) if (chosen.length < RING_CHOICES && chosen.every((o) => len(sub(o.C, r.C)) > o.R * 0.5)) chosen.push(r);
    rings.length = 0;
    for (const { ids, pts, C, R } of chosen) {
      // Where each station is along the loop, and the way the loop runs there.
      const at = ids.map((id) => {
        let bi = 0;
        let bd = Infinity;
        pts.forEach((q, j) => {
          const dd = len(sub(q, P[id]));
          if (dd < bd) [bd, bi] = [dd, j];
        });
        return bi;
      });
      const tangent = new Map(ids.map((id, q) => {
        const j = at[q];
        return [id, unit(sub(pts[Math.min(pts.length - 1, j + 1)], pts[Math.max(0, j - 1)]))];
      }));
      // How far along the loop from one station to the next, each way.
      const L = lengthOf(pts);
      const along = [0];
      for (let j = 1; j < pts.length; j++) along.push(along[j - 1] + len(sub(pts[j], pts[j - 1])));
      const ahead = (a, b) => {
        const d = along[at[ids.indexOf(b)]] - along[at[ids.indexOf(a)]];
        return d < 0 ? d + L : d;
      };
      rings.push({ ids, pts, C, R, at, tangent, ahead, L });
    }
  }
  // The loop (if any) a layout is laid round, and the hub lines run away
  // from: the loop's middle, or the central station.
  let ring = null;
  let hub = cp;
  // Which way along the loop trains from a branch at s run to the centre
  // (+1 forward, -1 back), and so which way the branch leaves: the other way.
  const towardCentre = (s) => (s === 0 ? 0 : ring.ahead(s, 0) < ring.L / 2 ? 1 : -1);

  // ---- One layout ----
  // Outward only, and roughly away from the hub, so lines run out
  // radially rather than curling round.
  // (With a single trunk, branches fan out wider from its first stations.)
  const outward = (from, i) => (ring ? len(sub(P[i], hub)) > len(sub(from, hub)) + 300 && angleBetween(sub(P[i], from), sub(P[i], hub)) < OUT_ANGLE : len(sub(P[i], hub)) > len(sub(from, hub)) - 200 && angleBetween(sub(P[i], from), sub(P[i], hub)) < OUT_ANGLE * 1.35);
  function layout(theta, splitRatio, keep, salt) {
    const SP = P.map((q) => q.slice()); // where each station stands
    const taken = new Uint8Array(N);
    taken[0] = 1;
    if (ring) for (const id of ring.ids) taken[id] = 1;
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
    const loop = ring ? ring.pts.filter((_, j) => j % 6 === 0) : [];
    // (Near the station it leaves, a track may run close to those it
    // leaves beside: lines dividing there part gradually, and a branch
    // peeling off the loop more gradually still.)
    const near = (q, list, gap) => list.some((o) => Math.abs(q[0] - o[0]) < gap && Math.abs(q[1] - o[1]) < gap && len(sub(q, o)) < gap);
    const clear = (pts, junction) => {
      for (const q of inner(pts)) {
        const r = len(sub(q, pts[0]));
        if (r > (junction ? PART * 1.6 : PART) && near(q, samples, GAP)) return false;
        if (r > (junction ? PART : 0) && near(q, loop, GAP * 0.5)) return false;
      }
      return true;
    };
    // A station's place: at its core, or a little to one side of it if
    // that lets the line run more gently.
    const OFFSETS = [0, 220, -220, 400, -400];
    const reach = (from, dir, i, mode) => {
      let best = null;
      const v = unit(sub(P[i], from));
      for (const o of OFFSETS) {
        const q = add(P[i], mul([-v[1], v[0]], o));
        if (wet(q)) continue;
        const t = track(from, dir, q, mode);
        if (!t || angleBetween(t.arrive, sub(q, hub)) > (ring ? OUT_ANGLE : OUT_ANGLE * 1.35) || !clear(t.pts, mode === 'junction')) continue;
        const score = t.turn + Math.abs(o) / 800;
        if (!best || score < best.score) best = { t, q, score };
      }
      return best;
    };
    const place = (s, c, r, side, splits) => {
      taken[c] = 1;
      SP[c] = r.q;
      dirOut.set(c, r.t.arrive);
      segs.push({ a: s, b: c, pts: r.t.pts });
      samples.push(...inner(r.t.pts));
      nodes.push({ s: c, parent: s, side, splits });
    };
    // Grow a line outward from station s (already placed), leaving along
    // dir: one station at a time, now and then dividing in two.
    const grow = (s, dir, heading, splits, side, mode = false) => {
      const cands = [];
      for (let i = 1; i < N; i++) {
        if (taken[i]) continue;
        const v = sub(P[i], SP[s]);
        const D = len(v);
        if (D < SPACING[0] || D > SPACING[1]) continue;
        // (Only the way on keeps to the line's heading; a branch at a
        // division may swing further off it.)
        const off = Math.abs(wrap(angleOf(v) - heading)) > (ring ? REACH : REACH * 1.4);
        if (off && (mode || Math.abs(wrap(angleOf(v) - heading)) > BRANCH_REACH)) continue;
        if (s !== 0 && !outward(SP[s], i)) continue;
        if (!dryRun(SP[s], P[i])) continue;
        const r = reach(SP[s], dir, i, mode);
        if (!r) continue;
        const dev = Math.abs(wrap(angleOf(v) - heading));
        cands.push({ i, D, v, r, off, score: D * (1 + 1.4 * r.t.turn + keep * dev) });
      }
      cands.sort((a, b) => a.off - b.off || a.score - b.score);
      if (cands.length && cands[0].off) return false;
      if (!cands.length) return false;
      const picks = [cands[0]];
      // Divide here if a second district lies well off to one side, not
      // much farther, while this line may still divide (never where it
      // leaves the loop or the central station).
      if (splits > 0 && !mode) {
        const two = cands.find((c) => c !== cands[0] && angleBetween(c.v, cands[0].v) > SPLIT_APART && c.score < cands[0].score * splitRatio * (c.off ? 1.5 : 1) && len(sub(P[c.i], P[cands[0].i])) > NEAR * 0.55);
        if (two) picks.push(two);
      }
      for (const c of picks) {
        // (Re-checked: the first pick's track may now crowd the second's.)
        const r = picks.length > 1 && c !== picks[0] ? reach(SP[s], dir, c.i, mode) : c.r;
        if (!r || taken[c.i]) continue;
        place(s, c.i, r, side, splits - (picks.length - 1));
      }
      for (const c of picks) {
        if (!dirOut.has(c.i) || nodes.find((n) => n.s === c.i).parent !== s) continue;
        grow(c.i, dirOut.get(c.i), heading + wrap(angleOf(c.v) - heading) * 0.5, splits - (picks.length - 1), side);
      }
      return true;
    };
    // Where a line may start: from the loop's stations (along the loop,
    // away from the centre, then curving out), or out of the central
    // station along its axis either way.
    const roots = [];
    if (ring) {
      for (const s of ring.ids) {
        const t = ring.tangent.get(s);
        const out = unit(sub(P[s], ring.C));
        // (A branch peels off the loop gradually: it heads out between the
        // way along the loop and straight out.)
        const root = (dir) => ({ s, dir, heading: angleOf(add(dir, out)), mode: 'junction' });
        // (A branch joining at the central station, as the Chuo Line at
        // Shinjuku, one way or the other.)
        if (s === 0) roots.push(root(mul(t, u(30, salt) < 0.5 ? 1 : -1)));
        else roots.push(root(mul(t, -towardCentre(s))));
      }
      // In an order of this layout's own.
      roots.sort((a, b) => u(31, salt, a.s) - u(31, salt, b.s));
    } else {
      for (const sg of [1, -1]) roots.push({ s: 0, dir: [Math.cos(theta) * sg, Math.sin(theta) * sg], heading: theta + (sg < 0 ? Math.PI : 0), mode: true });
    }
    roots.forEach((r, k) => (r.grown = grow(r.s, r.dir, r.heading, SPLITS, k, r.mode)));

    // ---- Repair ----
    // A district with no station in it or next to it: reached by carrying a
    // line on from its end, or by a line dividing in two at a station on the
    // way (if that keeps every line to its divisions, and the station is not
    // already a division), or by a new branch off the loop.
    const kids = (s) => nodes.filter((n) => n.parent === s);
    const nodeOf = (s) => nodes.find((n) => n.s === s);
    const above = (s) => {
      let k = 0;
      for (let n = nodeOf(s); n; n = nodeOf(n.parent)) if (nodeOf(n.parent) && kids(n.parent).length === 2) k++;
      return k;
    };
    const below = (s) => {
      const ks = kids(s);
      if (!ks.length) return 0;
      return Math.max(...ks.map((c) => below(c.s))) + (ks.length === 2 ? 1 : 0);
    };
    const served = () => new Set([0, ...(ring ? ring.ids : []), ...nodes.map((n) => n.s)]);
    const uncovered = (i, on) => !on.has(i) && ![...on].some((j) => len(sub(P[i], P[j])) < NEAR);
    for (let changed = true; changed; ) {
      changed = false;
      const on = served();
      const want = [];
      for (let i = 1; i < N; i++) if (!taken[i] && uncovered(i, on)) want.push(i);
      want.sort((a, b) => len(sub(P[a], hub)) - len(sub(P[b], hub)));
      for (const w of want) {
        let best = null;
        // A station in it, or in a district next to it.
        for (let i = 1; i < N; i++) {
          if (taken[i] || len(sub(P[i], P[w])) >= NEAR) continue;
          const v0 = (from) => sub(P[i], from);
          for (const n of nodes) {
            const ks = kids(n.s);
            if (ks.length > 1) continue;
            const used = ks.length ? above(n.s) + 1 + below(ks[0].s) : 0;
            if (used > SPLITS) continue;
            const v = v0(SP[n.s]);
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
            if (!best || score < best.score) best = { i, s: n.s, side: n.side, r, v, score, left: SPLITS - (ks.length ? above(n.s) + 1 : above(n.s)) };
          }
          // A loop station no branch leaves yet.
          for (const rt of roots) {
            if (rt.grown || kids(rt.s).length) continue;
            const v = v0(SP[rt.s]);
            const D = len(v);
            if (D < SPACING[0] || D > SPACING[1] || !outward(SP[rt.s], i) || !dryRun(SP[rt.s], P[i])) continue;
            const r = reach(SP[rt.s], rt.dir, i, rt.mode);
            if (!r) continue;
            const score = D * (1 + 1.4 * r.t.turn) * 1.2 * (i === w ? 1 : 1.15);
            if (!best || score < best.score) best = { i, s: rt.s, side: roots.indexOf(rt), r, v, score, left: SPLITS, root: rt };
          }
        }
        if (!best) continue;
        const { i, s, r, v } = best;
        if (best.root) best.root.grown = true;
        place(s, i, r, best.side, best.left);
        grow(i, r.t.arrive, angleOf(v), best.left, best.side);
        changed = true;
        break;
      }
    }
    for (const n of nodes) n.dir = dirOut.get(n.s);

    // ---- Score ----
    const onRail = served();
    let covered = 0;
    for (let i = 0; i < N; i++) if (onRail.has(i) || [...onRail].some((j) => len(sub(P[i], P[j])) < NEAR)) covered++;
    // Reach in every direction: the widest gap between the lines' ends.
    const tails = nodes.filter((n) => !nodes.some((m) => m.parent === n.s)).map((n) => angleOf(sub(SP[n.s], hub))).sort((a, b) => a - b);
    let widest = 2 * Math.PI;
    if (tails.length > 1) {
      widest = tails[0] + 2 * Math.PI - tails[tails.length - 1];
      for (let k = 1; k < tails.length; k++) widest = Math.max(widest, tails[k] - tails[k - 1]);
    }
    const km = segs.reduce((a, s) => a + lengthOf(s.pts), 0) / 1000;
    // (With one trunk, its branches are what serve the districts: more weight on them.)
    const score = (10 * covered) / N + ((ring ? 2 : 5) * onRail.size) / N - 0.5 * Math.min(2, widest) - km * 0.01;
    return { theta, SP, dirOut, segs, nodes, score, onRail, roots };
  }

  // Lay out the network a number of ways; keep the best.
  const tries = N < 2 ? [[u(1) * Math.PI, 1.8, 1, 0]] : Array.from({ length: LAYOUTS }, (_, k) => [(k / LAYOUTS) * Math.PI + u(2) * 0.2, (N < RING_CITY ? 1.8 : 1.3) + (N < RING_CITY ? 2 : 1.4) * u(3, k), 2 * u(4, k), k]);
  let best = null;
  for (const r of rings.length ? rings : [null]) {
    ring = r;
    hub = r ? r.C : cp;
    for (const th of rings.length ? tries.filter((_, k) => k % rings.length === rings.indexOf(r) || tries.length < 12) : tries) {
      const L = layout(...th);
      L.ring = r;
      if (!best || L.score > best.score) best = L;
    }
  }
  ring = best.ring;
  hub = ring ? ring.C : cp;
  const { SP, dirOut, segs, nodes, theta } = best;
  const axis = [Math.cos(theta), Math.sin(theta)];

  // ---- Out into the country ----
  // From each line's end, on as straight as the land allows; but a line
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
      // Bending gently away from the hub, so lines out of the city spread
      // apart.
      let nh = h + drift + Math.max(-0.02, Math.min(0.02, wrap(angleOf(sub(p, hub)) - h) * 0.05));
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
  // The loop, in stretches from station to station (forward along it).
  if (ring) {
    const R = ring.pts;
    for (let q = 0; q < ring.ids.length; q++) {
      const a = ring.at[q];
      const b = ring.at[(q + 1) % ring.ids.length];
      const pts = b > a ? R.slice(a, b + 1) : R.slice(a).concat(R.slice(1, b + 1));
      const sg = { key: `r${ring.ids[q]}>${ring.ids[(q + 1) % ring.ids.length]}`, a: ring.ids[q], b: ring.ids[(q + 1) % ring.ids.length], pts, ring: true };
      segments.push(sg);
      segOf.set(sg.key, sg);
    }
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

  // ---- Lines ----
  const pathTo = (s) => {
    const out = [];
    let n = nodes.find((m) => m.s === s);
    for (; n; n = nodes.find((m) => m.s === n.parent)) out.unshift(n.s);
    const first = nodes.find((m) => m.s === out[0]);
    return [first ? first.parent : 0, ...out];
  };
  // The root a leaf grew from: by its first station and the way it left.
  const rootOf = (s) => {
    const path = pathTo(s);
    const cands = best.roots.filter((r) => r.s === path[0]);
    if (cands.length < 2) return cands[0];
    // (Both ways out of the central station: the one its first stretch left by.)
    const sg = segOf.get(keyOf(path[0], path[1]));
    const lv = unit(sub(sg.pts[1], sg.pts[0]));
    return cands.slice().sort((x, y) => dot(y.dir, lv) - dot(x.dir, lv))[0];
  };
  const tipsFrom = (root) => leaves.filter((l) => rootOf(l.s) === root).map((l) => ({ path: pathTo(l.s), out: tailOf.get(l.s), angle: angleOf(sub(SP[l.s], hub)) }));
  const lines = [];
  // Stations and stretches of a line, from its first station on.
  const keysOf = (stations) => {
    const keys = [];
    for (let i = 0; i + 1 < stations.length; i++) {
      const [a, b] = [stations[i], stations[i + 1]];
      for (const k of [keyOf(a, b), keyOf(b, a), `r${a}>${b}`, `r${b}>${a}`]) {
        if (segOf.has(k)) {
          keys.push(k);
          break;
        }
      }
    }
    return keys;
  };
  if (ring) {
    // The loop stations from a to b, stepping one way (+1 forward).
    const arc = (a, b, way) => {
      const ids = ring.ids;
      const out = [a];
      for (let q = ids.indexOf(a); ids[q] !== b; ) {
        q = (q + way + ids.length) % ids.length;
        out.push(ids[q]);
        if (out.length > ids.length) break;
      }
      return out;
    };
    // Each branch's lines come in along the loop through the centre (the
    // way its trains run to it) and go out along a branch on the far side.
    const tipsOfRoot = best.roots.map((r) => ({ r, tips: tipsFrom(r), way: r.s === 0 ? -Math.sign(dot(r.dir, ring.tangent.get(0))) : towardCentre(r.s) })).filter((x) => x.tips.length);
    const fwd = tipsOfRoot.filter((x) => x.way > 0).flatMap((x) => x.tips.map((t) => ({ ...t, root: x.r.s })));
    const back = tipsOfRoot.filter((x) => x.way < 0).flatMap((x) => x.tips.map((t) => ({ ...t, root: x.r.s })));
    // Paired by how far round the loop their roots are from the centre.
    const round = (x, way) => (way > 0 ? ring.ahead(x.root, 0) : ring.ahead(0, x.root));
    fwd.sort((a, b) => round(a, 1) - round(b, 1));
    back.sort((a, b) => round(a, -1) - round(b, -1));
    const n = Math.max(fwd.length, back.length);
    for (let k = 0; k < n; k++) {
      const x = fwd.length ? fwd[k % fwd.length] : null;
      const y = back.length ? back[k % back.length] : null;
      // In from x's far end, round the loop forward to y's root, out to its end.
      let stations;
      if (x && y) stations = [...x.path.slice().reverse(), ...arc(x.root, y.root, 1).slice(1), ...y.path.slice(1)];
      else if (x) stations = [...x.path.slice().reverse(), ...arc(x.root, 0, 1).slice(1)];
      else stations = [...arc(0, y.root, 1), ...y.path.slice(1)];
      const keys = keysOf(stations);
      if (x && x.out) keys.unshift(x.out);
      if (y && y.out) keys.push(y.out);
      lines.push({ stations, segments: keys });
    }
  } else {
    // Every path out of the central station on each side, paired with one
    // on the other side: a line through the centre.
    const side = (l) => Math.sign(dot(unit(sub(SP[pathTo(l.s)[1]], cp)), axis)) || 1;
    const tips = leaves.map((l) => ({ path: pathTo(l.s), out: tailOf.get(l.s), angle: angleOf(sub(SP[l.s], cp)), side: side(l) }));
    const A = tips.filter((t) => t.side > 0).sort((x, y) => x.angle - y.angle);
    const B = tips.filter((t) => t.side < 0).sort((x, y) => y.angle - x.angle);
    // A side with no line out: the line runs straight on out of the centre.
    if (!A.length) A.push({ path: [0], out: tailsFrom(cp, axis, 0, 100), angle: 0 });
    if (!B.length) B.push({ path: [0], out: tailsFrom(cp, mul(axis, -1), 0, 101), angle: 0 });
    const n = Math.max(A.length, B.length);
    for (let k = 0; k < n; k++) {
      const x = A[k % A.length];
      const y = B[k % B.length];
      const stations = [...x.path.slice().reverse(), ...y.path.slice(1)];
      const keys = keysOf(stations);
      if (x.out) keys.unshift(x.out);
      if (y.out) keys.push(y.out);
      lines.push({ stations, segments: keys });
    }
  }
  if (ring) lines.push({ stations: ring.ids.concat([ring.ids[0]]), segments: ring.ids.map((a, q) => `r${a}>${ring.ids[(q + 1) % ring.ids.length]}`), ring: true });
  lines.forEach((l, k) => {
    l.id = k;
    l.name = l.ring ? 'R' : String.fromCharCode(65 + k);
    l.colour = l.ring ? '#7a8792' : RAIL_COLOURS[k % RAIL_COLOURS.length];
  });
  // Which lines run on each stretch (for drawing them side by side).
  for (const sg of segments) sg.lines = lines.filter((l) => l.segments.includes(sg.key)).map((l) => l.id);

  // ---- Stations ----
  const stations = new Map();
  const station = (s) => {
    if (!stations.has(s)) {
      const dir = ring && ring.tangent.has(s) ? ring.tangent.get(s) : s === 0 ? axis : dirOut.get(s) || [1, 0];
      stations.set(s, { id: s, p: SP[s], key: cores[s].key, central: s === 0, dir, lines: [] });
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
  // Infill stops on long stretches between district stations, where people
  // live (but not just by another station).
  const stops = [];
  const stationAt = (q, r) => [...stations.values()].some((st) => len(sub(st.p, q)) < r);
  for (const sg of segments) {
    if (sg.country) continue;
    const L = lengthOf(sg.pts);
    if (L < INFILL) continue;
    const p = pointAlong(sg.pts, L / 2);
    if (terrain.isWater(p[0], p[1]) || stationAt(p, 1000) || stops.some((o) => len(sub(o.p, p)) < 1000)) continue;
    const q = pointAlong(sg.pts, L / 2 + 20);
    stops.push({ id: `m${sg.key}`, p, key: null, central: false, dir: unit(sub(q, p)), stop: true, segment: sg.key, lines: sg.lines.slice() });
  }
  const all = [...stations.values(), ...stops];

  // ---- Tunnel, ramp and viaduct ----
  // Underground through the centre and at every station, on viaducts
  // between, with ramps from one to the other; each stretch in runs.
  const tunnelReach = Math.max(TUNNEL_CENTRE[0], Math.min(TUNNEL_CENTRE[1], farthest * 0.15));
  const depth = (q) => {
    let r = len(sub(q, cp)) - tunnelReach;
    for (const st of all) {
      const d = len(sub(q, st.p)) - (st.central ? UNDER * 1.6 : UNDER);
      if (d < r) r = d;
    }
    return r < 0 ? 'tunnel' : r < RAMP ? 'ramp' : 'viaduct';
  };
  // Track running alongside a street (a boulevard, say) above ground would
  // wall it off from the blocks across it: such a stretch goes underground
  // too. (Worked out for a stretch of track when it is first needed, by
  // when the boulevards near it are known.)
  function along(pts) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of pts) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    const streets = streetsNear(x0 - ALONG_GAP, y0 - ALONG_GAP, x1 + ALONG_GAP, y1 + ALONG_GAP);
    // How far each point is from a street running the same way.
    const gap = pts.map((q, i) => {
      const d = unit(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
      let best = Infinity;
      for (const P of streets) {
        for (let k = 0; k < P.length - 1; k++) {
          const a = P[k];
          const ab = sub(P[k + 1], a);
          const l = len(ab);
          if (!l || Math.abs(dot(ab, d)) / l < ALONG_COS) continue;
          const t = Math.max(0, Math.min(1, dot(sub(q, a), ab) / (l * l)));
          best = Math.min(best, len(sub(add(a, mul(ab, t)), q)));
        }
      }
      return best;
    });
    // Stretches of some length right beside one (a street merely crossed
    // is no matter), each carried on while the track stays near it, so it
    // ramps up only once clear.
    const out = pts.map(() => false);
    for (let i = 0; i < pts.length; ) {
      if (gap[i] >= ALONG_GAP) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < pts.length && gap[j + 1] < ALONG_GAP) j++;
      if ((j - i) * STEP >= ALONG_MIN) {
        let a = i;
        let b = j;
        while (a > 0 && gap[a - 1] < ALONG_NEAR) a--;
        while (b + 1 < pts.length && gap[b + 1] < ALONG_NEAR) b++;
        for (let k = a; k <= b; k++) out[k] = true;
      }
      i = j + 1;
    }
    return out;
  }
  function profile(sg) {
    const pts = resample(sg.pts, STEP);
    const buried = sg.country ? pts.map(() => false) : along(pts);
    const idx = buried.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
    const runs = [];
    let run = null;
    pts.forEach((q, i) => {
      let k = sg.country && len(sub(q, cp)) > farthest + 3000 ? 'viaduct' : depth(q);
      if (idx.length && k !== 'tunnel') {
        // (Ramping down to such a stretch as to a station.)
        let r = Infinity;
        for (const j of idx) r = Math.min(r, Math.abs(j - i) * STEP);
        if (r === 0) k = 'tunnel';
        else if (r < RAMP) k = 'ramp';
      }
      if (!run || run.kind !== k) {
        const last = run ? run.pts[run.pts.length - 1] : null;
        run = { kind: k, pts: last ? [last] : [] };
        runs.push(run);
      }
      run.pts.push(q);
    });
    const kept = runs.filter((r) => r.pts.length > 1);
    // Above ground (viaduct and ramp together), each run on along the
    // tunnel a way at either end: the path beside the track carries on
    // over the tunnel until it meets a street. With what is under each
    // point of it.
    const corridors = [];
    for (let q = 0; q < kept.length; q++) {
      if (kept[q].kind === 'tunnel') continue;
      let e = q;
      while (e + 1 < kept.length && kept[e + 1].kind !== 'tunnel') e++;
      const cpts = [];
      const kinds = [];
      const push = (list, kind) => {
        for (const x of list) {
          if (cpts.length && len(sub(cpts[cpts.length - 1], x)) < 1e-6) continue;
          cpts.push(x);
          kinds.push(kind);
        }
      };
      const before = q > 0 ? kept[q - 1].pts : [];
      push(before.slice(Math.max(0, before.length - Math.round(OVER / STEP))), 'tunnel');
      for (let k = q; k <= e; k++) push(kept[k].pts, kept[k].kind);
      const after = e + 1 < kept.length ? kept[e + 1].pts : [];
      push(after.slice(0, Math.round(OVER / STEP)), 'tunnel');
      corridors.push({ pts: cpts, kinds });
      q = e;
    }
    return { runs: kept, corridors };
  }
  for (const sg of segments) {
    let done = null;
    const get = () => done || (done = profile(sg));
    Object.defineProperty(sg, 'runs', { get: () => get().runs, enumerable: true });
    Object.defineProperty(sg, 'corridors', { get: () => get().corridors, enumerable: true });
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
    stations: all,
    lines,
    termini,
    ring,
    near,
    // The track above ground (on viaducts and ramps) touching a rectangle,
    // as polylines: what divides the neighbourhoods.
    surfaceIn: (x0, y0, x1, y1) => near(x0, y0, x1, y1).flatMap((sg) => sg.runs.filter((r) => r.kind !== 'tunnel').map((r) => r.pts)),
    // And the paths along it, run on over the tunnels at either end, with
    // what is under each point ({ pts, kinds }): what the blocks face.
    corridorsIn: (x0, y0, x1, y1) => near(x0, y0, x1, y1).flatMap((sg) => sg.corridors),
    joins: (ka, kb) => joined.has(`${ka}|${kb}`),
    // Which districts have a station, and which only one next door.
    served: best.onRail,
  };
}
