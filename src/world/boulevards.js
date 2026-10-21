// Boulevards: tram streets linking the cores of neighbouring districts.
//
// Every pair of districts that share a long enough stretch of greenway gets
// one link. The link crosses the greenway at a point near the middle of the
// longest shared stretch, at right angles to it. That crossing point is
// computed from the shared stretch alone, so both districts agree on it
// exactly, and each district then builds its own half of every link:
//
//   - a trunk: the two links that leave in the most opposite directions,
//     joined through the station, so the core is always on the network
//   - sometimes instead a large roundabout near the core, where three links
//     meet, one of them running through the station
//   - every other link ends at a T junction on what is already built,
//     meeting it at right angles, with a bias towards the core
//
// Curves are cubic Hermite splines with an extra bend on long stretches,
// checked against a minimum radius. All choices come from the district's own
// geometry and the seed, so a district's half never depends on visiting order.

import { hash, hashString, toUnit } from '../core/hash.js';
import { createNoise } from '../core/noise.js';
import { LruCache } from './cache.js';
import { keyInts } from './cores.js';
import { pointInPolygon } from '../util/geom.js';

export const MIN_SHARED_EDGE = 450; // metres of shared greenway needed for a link
export const MIN_RADIUS = 50; // metres, tightest bend allowed on a boulevard
export const ROUNDABOUT_RADIUS = 90; // centreline radius of a large roundabout
const ROUNDABOUT_SHARE = 0.3; // share of districts (with three or more links) that get one
const SAMPLE = 12; // metres between points on a boulevard
const END_MARGIN = 260; // crossing points stay this far from the ends of a stretch
const T_SPACING = 170; // metres between junctions on the same boulevard
const EDGE_CLEAR = 220; // T junctions stay this far from a district's crossing points
const EDGE_GAP = 150; // metres a T branch keeps from the district's greenways
const STUB = 110; // metres of straight boulevard either side of a greenway crossing

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const unit = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

// Cubic Hermite from p0 (tangent m0) to p1 (tangent m1), sampled about every SAMPLE metres.
function hermite(p0, m0, p1, m1, out) {
  const chord = len(sub(p1, p0));
  const n = Math.max(2, Math.ceil((chord * 1.25) / SAMPLE));
  for (let i = out.length ? 1 : 0; i <= n; i++) {
    const t = i / n;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    if (i === n) out.push(p1);
    else out.push([
      h00 * p0[0] + h10 * m0[0] + h01 * p1[0] + h11 * m1[0],
      h00 * p0[1] + h10 * m0[1] + h01 * p1[1] + h11 * m1[1],
    ]);
  }
  return out;
}

// Smooth curve through knots [{p, d}] where d is the unit direction of travel
// at that knot. Tangent length follows the neighbouring chords.
function spline(knots) {
  const out = [];
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i];
    const b = knots[i + 1];
    const c = len(sub(b.p, a.p)) * (a.k ?? 1);
    const c2 = len(sub(b.p, a.p)) * (b.k ?? 1);
    hermite(a.p, [a.d[0] * c, a.d[1] * c], b.p, [b.d[0] * c2, b.d[1] * c2], out);
  }
  return out;
}

// Tightest bend radius along a sampled curve, measured over a few samples.
export function minRadius(pts, span = 2) {
  let r = Infinity;
  for (let i = span; i < pts.length - span; i++) {
    const a = pts[i - span];
    const b = pts[i];
    const c = pts[i + span];
    const ab = len(sub(b, a));
    const bc = len(sub(c, b));
    const ca = len(sub(a, c));
    const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (area2 > 1e-9) r = Math.min(r, (ab * bc * ca) / (2 * area2));
  }
  return r;
}

function segmentsCross(a, b, c, d) {
  const d1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d2 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
  const d3 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]);
  const d4 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// Does a curve cross any line, ignoring points within `skip` metres of `end`?
function crossesAny(pts, lines, end, skip) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (end && len(sub(a, end)) < skip) continue;
    const x0 = Math.min(a[0], b[0]);
    const x1 = Math.max(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]);
    const y1 = Math.max(a[1], b[1]);
    for (const l of lines) {
      if (l.bbox.x1 < x0 || l.bbox.x0 > x1 || l.bbox.y1 < y0 || l.bbox.y0 > y1) continue;
      const p = l.points;
      for (let j = 0; j < p.length - 1; j++) {
        const c = p[j];
        const d = p[j + 1];
        if (Math.max(c[0], d[0]) < x0 || Math.min(c[0], d[0]) > x1 || Math.max(c[1], d[1]) < y0 || Math.min(c[1], d[1]) > y1) continue;
        if (segmentsCross(a, b, c, d)) return true;
      }
    }
  }
  return false;
}

function lineBox(points) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

// Distance from a point to a polyline.
export function distToLine(x, y, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (d < best) best = d;
  }
  return best;
}

function straight(p, d, length) {
  const n = Math.max(1, Math.ceil(length / SAMPLE));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(i === 0 ? p : [p[0] + (d[0] * length * i) / n, p[1] + (d[1] * length * i) / n]);
  return out;
}

function arcLength(pts) {
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) s += len(sub(pts[i + 1], pts[i]));
  return s;
}

// Point and unit tangent at arc length s along a polyline.
function along(pts, s) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = len(sub(pts[i + 1], pts[i]));
    if (acc + l >= s || i === pts.length - 2) {
      const t = l > 0 ? Math.min(1, Math.max(0, (s - acc) / l)) : 0;
      const a = pts[i];
      const b = pts[i + 1];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    acc += l;
  }
  return pts[pts.length - 1];
}

export function createBoulevards(seed) {
  const bendNoise = createNoise(seed, 'boulevard-bend');
  const crossings = new LruCache(60000);
  const networks = new LruCache(12000);

  // Where the link across a shared stretch crosses it: a point and the unit
  // tangent of the stretch there, both in the stretch's canonical direction.
  function crossingOf(geo) {
    let c = crossings.get(geo.key);
    if (c) return c;
    const pts = geo.points;
    const L = arcLength(pts);
    const u = toUnit(hash(seed, 'boulevard-crossing', hashString(geo.key)));
    const s = Math.min(L - END_MARGIN, Math.max(END_MARGIN, L * (0.38 + 0.24 * u)));
    const p = along(pts, s);
    // Tangent over a wide window, so small wiggles in the greenway don't tilt it.
    const t = unit(sub(along(pts, Math.min(L, s + 90)), along(pts, Math.max(0, s - 90))));
    c = { p, t, length: L };
    crossings.set(geo.key, c);
    return c;
  }

  // The links of a district: one per neighbour with a long enough shared stretch.
  function linksOf(b) {
    const best = new Map();
    for (const c of b.chains) {
      const L = crossingOf(c.geo).length;
      const cur = best.get(c.neighbour);
      if (!cur || L > cur.L || (L === cur.L && c.key < cur.c.key)) best.set(c.neighbour, { c, L });
    }
    const links = [];
    for (const [neighbour, { c, L }] of best) {
      if (L < MIN_SHARED_EDGE) continue;
      const x = crossingOf(c.geo);
      // The district's own copy runs with the district on its left; its inward normal points left.
      const same = c.points === c.geo.points;
      const tx = same ? x.t[0] : -x.t[0];
      const ty = same ? x.t[1] : -x.t[1];
      links.push({ key: c.key, neighbour, p: x.p, n: [ty, -tx], edge: L });
    }
    links.sort((a, b2) => (a.key < b2.key ? -1 : 1));
    return links;
  }

  // Knots from a to b with an extra bend in the middle of long stretches.
  function bend(a, b, amount, salt) {
    const v = sub(b.p, a.p);
    const L = len(v);
    if (L < 700 || amount === 0) return [a, b];
    const m = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2];
    const w = bendNoise.fbm(m[0] / 1700 + salt * 0.37, m[1] / 1700, 2);
    const off = Math.max(-0.2, Math.min(0.2, w * 0.35)) * L * amount;
    const u = unit(v);
    const pm = [m[0] - u[1] * off, m[1] + u[0] * off];
    const d = unit([a.d[0] + b.d[0] + u[0] * 2, a.d[1] + b.d[1] + u[1] * 2]);
    return [a, { p: pm, d }, b];
  }

  // A curve through the knots, bending less until it is gentle enough. A knot
  // at a crossing point gets a straight stub, so the boulevard crosses the
  // greenway at right angles.
  function curve(knots, salt) {
    const first = knots[0];
    const last = knots[knots.length - 1];
    const stubA = first.edge ? straight(first.p, first.d, STUB) : null;
    const stubB = last.edge ? straight(last.p, [-last.d[0], -last.d[1]], STUB).reverse() : null;
    knots = knots.slice();
    if (stubA) knots[0] = { p: stubA[stubA.length - 1], d: first.d };
    if (stubB) knots[knots.length - 1] = { p: stubB[0], d: last.d };
    let pts = bendy(knots, salt);
    if (stubA) pts = stubA.slice(0, -1).concat(pts);
    if (stubB) pts = pts.concat(stubB.slice(1));
    return pts;
  }

  function bendy(knots, salt) {
    let pts = null;
    for (const amount of [1, 0.5, 0]) {
      const ks = [knots[0]];
      for (let i = 0; i < knots.length - 1; i++) ks.push(...bend(knots[i], knots[i + 1], amount, salt + i).slice(1));
      pts = spline(ks);
      if (minRadius(pts) >= MIN_RADIUS) return pts;
    }
    // Still too tight: soften the tangents at the knots.
    for (const k of [0.7, 0.5]) {
      const soft = spline(knots.map((q) => ({ ...q, k })));
      if (minRadius(soft) >= MIN_RADIUS) return soft;
    }
    return pts;
  }

  // The district's half of every link, plus any roundabout.
  function network(b) {
    let net = networks.get(b.key);
    if (net) return net;
    const S = b.station;
    const links = linksOf(b);
    const lines = [];
    const junctions = [];
    let roundabout = null;
    const salt = keyInts(b.core).reduce((a, v) => (a * 31 + v) | 0, 7);
    const add = (points, kind, link, extra = {}) => {
      const l = { key: `${b.key}:${kind}:${link ? link.key : ''}`, points, kind, bbox: lineBox(points), ...extra };
      lines.push(l);
      return l;
    };
    const dirTo = (l) => unit(sub(l.p, S));
    const outward = (l) => [-l.n[0], -l.n[1]];
    const usable = links.filter((l) => len(sub(l.p, S)) > b.coreRadius * 0.6);
    const done = new Set();

    if (usable.length === 1) {
      const l = usable[0];
      add(curve([{ p: S, d: dirTo(l) }, { p: l.p, d: outward(l), edge: true }], salt), 'spur', l);
      done.add(l.key);
    } else if (usable.length >= 2) {
      // Roundabout: three links well spread around the core.
      let triple = null;
      if (usable.length >= 3 && toUnit(hash(seed, 'roundabout', ...keyInts(b.core))) < ROUNDABOUT_SHARE) {
        let bestGap = (75 * Math.PI) / 180;
        const ang = usable.map((l) => Math.atan2(...dirTo(l).slice().reverse()));
        for (let i = 0; i < usable.length; i++) {
          for (let j = i + 1; j < usable.length; j++) {
            for (let k = j + 1; k < usable.length; k++) {
              const a = [ang[i], ang[j], ang[k]].sort((x, y) => x - y);
              const gap = Math.min(a[1] - a[0], a[2] - a[1], a[0] + 2 * Math.PI - a[2]);
              if (gap > bestGap) {
                bestGap = gap;
                triple = [usable[i], usable[j], usable[k]];
              }
            }
          }
        }
      }
      if (triple) {
        // The station sits on the longest arm, just outside the roundabout.
        triple.sort((a, c) => len(sub(c.p, S)) - len(sub(a.p, S)) || (a.key < c.key ? -1 : 1));
        const lead = triple[0];
        const back = dirTo(lead);
        const R = [S[0] - back[0] * (ROUNDABOUT_RADIUS + 150), S[1] - back[1] * (ROUNDABOUT_RADIUS + 150)];
        const ring = [];
        const n = 48;
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          ring.push([R[0] + Math.cos(a) * ROUNDABOUT_RADIUS, R[1] + Math.sin(a) * ROUNDABOUT_RADIUS]);
        }
        roundabout = { key: `${b.key}:roundabout`, x: R[0], y: R[1], r: ROUNDABOUT_RADIUS };
        add(ring, 'roundabout', null);
        for (const l of triple) {
          const u = unit(sub(l.p, R));
          const P = [R[0] + u[0] * ROUNDABOUT_RADIUS, R[1] + u[1] * ROUNDABOUT_RADIUS];
          const knots = [{ p: P, d: u }];
          if (l === lead) knots.push({ p: S, d: back });
          knots.push({ p: l.p, d: outward(l), edge: true });
          add(curve(knots, salt + 3), 'arm', l);
          done.add(l.key);
        }
        junctions.push(R);
      } else {
        // Trunk: the most opposite pair, through the station.
        let best = null;
        for (let i = 0; i < usable.length; i++) {
          for (let j = i + 1; j < usable.length; j++) {
            const score = -dot(dirTo(usable[i]), dirTo(usable[j])) + 0.15 * toUnit(hash(seed, 'trunk', salt, i, j));
            if (!best || score > best.score) best = { score, a: usable[i], c: usable[j] };
          }
        }
        const { a, c } = best;
        const through = unit(sub(dirTo(c), dirTo(a)));
        const knots = [{ p: a.p, d: a.n, edge: true }, { p: S, d: through }, { p: c.p, d: outward(c), edge: true }];
        add(curve(knots, salt + 1), 'trunk', a, { to: c.key });
        done.add(a.key);
        done.add(c.key);
      }
      junctions.push(S);

      // Every other link ends at a T junction, longest shared stretch first.
      const rest = usable.filter((l) => !done.has(l.key)).sort((x, y) => y.edge - x.edge || (x.key < y.key ? -1 : 1));
      for (const l of rest) {
        const { pts, at } = branch(b, l, lines, junctions, links, salt);
        add(pts, 'branch', l);
        junctions.push(at);
      }
    }
    // Links too close to the station for a curve of their own.
    for (const l of links) {
      if (usable.includes(l)) continue;
      add([S, l.p], 'spur', l);
    }
    net = { key: b.key, links, lines, roundabout, junctions };
    networks.set(b.key, net);
    return net;
  }

  // A link that ends at a right-angled T junction on the network built so far.
  function branch(b, l, lines, junctions, links, salt) {
    const S = b.station;
    const ring = b.ring.filter((_, i) => i % 3 === 0);
        const cands = [];
    for (const line of lines) {
      if (line.kind === 'roundabout') continue;
      const p = line.points;
      for (let i = 2; i < p.length - 2; i += 3) {
        const q = p[i];
        if (links.some((o) => len(sub(o.p, q)) < EDGE_CLEAR)) continue;
        if (junctions.some((j) => len(sub(j, q)) < T_SPACING && len(sub(j, S)) > 1)) continue;
        const tau = unit(sub(p[i + 2], p[i - 2]));
        const dv = sub(q, l.p);
        const dl = len(dv);
        if (dl < 150) continue;
        const d = [dv[0] / dl, dv[1] / dl];
        // Arrive at right angles, from the link's side.
        let a = [-tau[1], tau[0]];
        if (dot(a, d) < 0) a = [-a[0], -a[1]];
        const cost = dl + 0.45 * len(sub(q, S)) + 380 * (1 - dot(l.n, d)) + 380 * (1 - dot(d, a));
        cands.push({ q, a, cost });
      }
    }
    cands.sort((x, y) => x.cost - y.cost);
    let fallback = null;
    for (const c of cands.slice(0, 24)) {
      const pts = curve([{ p: l.p, d: l.n, edge: true }, { p: c.q, d: c.a }], salt + 5);
      if (!fallback) fallback = pts;
      if (minRadius(pts) < MIN_RADIUS) continue;
      if (crossesAny(pts, lines, c.q, 40)) continue;
      // Stay inside the district and clear of its greenways, past the crossing itself.
      let bad = false;
      for (let i = 0; i < pts.length && !bad; i += 4) {
        const [x, y] = pts[i];
        if (len(sub(pts[i], l.p)) < STUB + 80) continue;
        bad = !pointInPolygon(x, y, ring) || distToLine(x, y, ring) < EDGE_GAP;
      }
      if (bad) continue;
      return { pts, at: c.q };
    }
    if (fallback) return { pts: fallback, at: cands[0].q };
    return { pts: curve([{ p: S, d: unit(sub(l.p, S)) }, { p: l.p, d: [-l.n[0], -l.n[1]], edge: true }], salt + 7), at: S };
  }

  return { crossingOf, linksOf, network };
}
