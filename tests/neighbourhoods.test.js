// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedFromText } from '../src/core/hash.js';
import { createWorld } from '../src/world/districts.js';
import { distToLine } from '../src/world/boulevards.js';
import { NEIGHBOURHOODS, MAIN_STREET_REACH, RING_MARGIN } from '../src/world/neighbourhoods.js';
import { pointInPolygon, polygonArea } from '../src/util/geom.js';

const SEED = seedFromText('1');
const AREA = [0, 0, 14000, 14000];
const world = createWorld(SEED);
const inner = () => world.districtsInRect(...AREA).filter((d) => d.station[0] > AREA[0] && d.station[0] < AREA[2] && d.station[1] > AREA[1] && d.station[1] < AREA[3]);
const other = (key) => world.district(world.growth.coreOf(key));
const same = (p, q) => p[0] === q[0] && p[1] === q[1];

function hull(P) {
  P = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  const up = [];
  for (const p of P) {
    while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), p) <= 0) lo.pop();
    lo.push(p);
  }
  for (const p of P.reverse()) {
    while (up.length >= 2 && cr(up.at(-2), up.at(-1), p) <= 0) up.pop();
    up.push(p);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

test('stage 3 does not depend on visiting order', () => {
  const a = createWorld(SEED);
  const b = createWorld(SEED);
  const pick = (d) => JSON.stringify({ key: d.key, hoods: d.stage3.hoods.map((h) => h.polygon), lines: d.stage3.lines.map((l) => l.points) });
  const fwd = a.districtsInRect(0, 0, 8000, 8000).map(pick).sort();
  b.districtsInRect(8000, 8000, 16000, 16000);
  b.districtsInRect(-8000, 0, 0, 8000);
  const rev = b.districtsInRect(0, 0, 8000, 8000).map(pick).sort();
  assert.deepEqual(fwd, rev);
});

test('districts have a core and 8 to 12 irregular neighbourhoods of about 0.75 km²', () => {
  let conv = 0;
  let n = 0;
  for (const d of inner()) {
    const hoods = d.stage3.hoods;
    const core = hoods[0];
    assert.ok(core.core && pointInPolygon(d.station[0], d.station[1], core.polygon), `${d.key} core misses its station`);
    assert.ok(core.area > 0.12e6 && core.area < 0.9e6, `${d.key} core is ${(core.area / 1e6).toFixed(2)} km²`);
    const rest = hoods.slice(1);
    assert.ok(rest.length <= NEIGHBOURHOODS[1], `${d.key} has ${rest.length} neighbourhoods`);
    // Small districts can drop a boxed-in centre or two.
    if (d.area > 6e6) assert.ok(rest.length >= NEIGHBOURHOODS[0], `${d.key} has ${rest.length} neighbourhoods`);
    else assert.ok(rest.length >= NEIGHBOURHOODS[0] - 2, `${d.key} has ${rest.length} neighbourhoods`);
    if (d.area > 6e6 && d.area < 12e6) {
      const mean = rest.reduce((s, h) => s + h.area, 0) / rest.length;
      assert.ok(mean > 0.5e6 && mean < 1.1e6, `${d.key} neighbourhoods average ${(mean / 1e6).toFixed(2)} km²`);
    }
    for (const h of rest) {
      assert.ok(h.area > 0.05e6, `${h.key} is only ${(h.area / 1e6).toFixed(2)} km²`);
      conv += polygonArea(h.polygon) / polygonArea(hull(h.polygon));
      n++;
    }
  }
  assert.ok(conv / n < 0.9, `neighbourhoods are too regular (convexity ${(conv / n).toFixed(2)})`);
});

test('neighbouring neighbourhoods share their boundary exactly', () => {
  for (const d of inner()) {
    const hoods = d.stage3.hoods;
    for (const c of d.stage3.chains) {
      if (c.a < 0 || c.b < 0 || c.points.length < 3) continue;
      const p = c.points[1];
      for (const k of [c.a, c.b]) assert.ok([hoods[k].polygon, ...hoods[k].holes].some((r) => r.some((q) => same(q, p))), `${hoods[k].key} is missing a shared boundary`);
    }
  }
});

// Every street of a district (main streets and boulevards) as point lists.
const streetsOf = (d) => d.stage3.lines.map((l) => l.points).concat(d.network.lines.map((l) => l.points));

// Crossings between two polylines, as { i, t, p } on the first.
function crossings(A, B) {
  const out = [];
  for (let i = 0; i < A.length - 1; i++) {
    const [ax, ay] = A[i];
    const [bx, by] = A[i + 1];
    for (let j = 0; j < B.length - 1; j++) {
      const [cx, cy] = B[j];
      const [dx, dy] = B[j + 1];
      if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx) || Math.max(ay, by) < Math.min(cy, dy) || Math.max(cy, dy) < Math.min(ay, by)) continue;
      const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
      if (Math.abs(den) < 1e-12) continue;
      const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
      const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
      if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) out.push({ i, t, u: j + u, p: [ax + (bx - ax) * t, ay + (by - ay) * t] });
    }
  }
  return out;
}

// The street network of a district as a graph: junctions and line ends are
// nodes, the stretches between them edges. Extra points (centres, the
// station) can be added as nodes on the lines they lie on.
function network(d, extra) {
  const lines = streetsOf(d);
  const cuts = lines.map(() => []);
  for (let a = 0; a < lines.length; a++) {
    for (let b = a + 1; b < lines.length; b++) {
      for (const c of crossings(lines[a], lines[b])) {
        const key = `j${a}.${b}.${c.i}.${Math.round(c.p[0])},${Math.round(c.p[1])}`;
        cuts[a].push({ pos: c.i + c.t, key });
        cuts[b].push({ pos: c.u, key });
      }
    }
  }
  // A line ending on another (a T junction) joins it there, even if rounding
  // leaves the end a hair to one side.
  lines.forEach((A, a) => {
    for (const [end, pos] of [[A[0], 0], [A[A.length - 1], A.length - 1]]) {
      lines.forEach((B, b) => {
        if (b === a) return;
        const q = project(B, end);
        if (q.d < 0.5) {
          const key = `t${a}.${pos}`;
          cuts[a].push({ pos, key });
          cuts[b].push({ pos: q.pos, key });
        }
      });
    }
  });
  for (const [key, p] of extra) {
    for (let a = 0; a < lines.length; a++) {
      const k = lines[a].findIndex((q) => same(q, p));
      if (k >= 0) cuts[a].push({ pos: k, key });
    }
  }
  const adj = new Map();
  const link = (x, y, w) => {
    if (!adj.has(x)) adj.set(x, []);
    if (!adj.has(y)) adj.set(y, []);
    adj.get(x).push([y, w]);
    adj.get(y).push([x, w]);
  };
  const at = (pts, pos) => {
    const i = Math.max(0, Math.min(pts.length - 2, Math.floor(pos)));
    const t = pos - i;
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
  };
  lines.forEach((pts, a) => {
    const cs = [{ pos: 0, key: `e${a}.0` }, ...cuts[a], { pos: pts.length - 1, key: `e${a}.1` }].sort((x, y) => x.pos - y.pos);
    for (let k = 0; k < cs.length - 1; k++) {
      const p = at(pts, cs[k].pos);
      const q = at(pts, cs[k + 1].pos);
      link(cs[k].key, cs[k + 1].key, Math.hypot(q[0] - p[0], q[1] - p[1]));
    }
  });
  return adj;
}

// Nearest point of a polyline: distance and position along it.
function project(B, p) {
  let best = { d: Infinity, pos: 0 };
  for (let j = 0; j < B.length - 1; j++) {
    const [ax, ay] = B[j];
    const dx = B[j + 1][0] - ax;
    const dy = B[j + 1][1] - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2)) : 0;
    const d = Math.hypot(ax + dx * t - p[0], ay + dy * t - p[1]);
    if (d < best.d) best = { d, pos: j + t };
  }
  return best;
}

function shortest(adj, from) {
  const dist = new Map([[from, 0]]);
  const open = [[0, from]];
  while (open.length) {
    open.sort((a, b) => b[0] - a[0]);
    const [dd, n] = open.pop();
    if (dd > dist.get(n)) continue;
    for (const [m, w] of adj.get(n) || []) {
      const nd = dd + w;
      if (nd < (dist.get(m) ?? Infinity)) {
        dist.set(m, nd);
        open.push([nd, m]);
      }
    }
  }
  return dist;
}

test('every neighbourhood centre sits on a main street or boulevard', () => {
  for (const d of inner()) {
    const lines = streetsOf(d);
    for (const h of d.stage3.hoods) {
      const near = Math.min(...lines.map((l) => distToLine(h.centre[0], h.centre[1], l)));
      assert.ok(near < 1e-6, `${h.key} centre is ${near.toFixed(0)} m off the streets`);
    }
  }
});

test('main streets run through the middle of their neighbourhoods', () => {
  let total = 0;
  let inside = 0;
  for (const d of inner()) {
    for (const h of d.stage3.hoods.slice(1)) {
      total++;
      if (pointInPolygon(h.centre[0], h.centre[1], h.polygon)) inside++;
    }
  }
  assert.ok(inside / total > 0.9, `only ${inside} of ${total} centres lie inside their own neighbourhood`);
});

test('main streets never dead-end', () => {
  for (const d of inner()) {
    const lines = streetsOf(d);
    for (const l of d.stage3.lines) {
      const ends = [[l.points[0], !!l.crossing], [l.points[l.points.length - 1], !!l.crossingEnd]];
      for (const [e, crossingStart] of ends) {
        if (crossingStart) continue; // carries on in the next district
        const on = lines.some((q) => q !== l.points && distToLine(e[0], e[1], q) < 1);
        assert.ok(on, `${l.key} dead-ends at ${e.map(Math.round)}`);
      }
    }
  }
});

test('main streets carry on across greenways into the next district', () => {
  let n = 0;
  for (const d of inner()) {
    for (const x of d.stage3.crossings) {
      const e = other(x.neighbour);
      const back = e.stage3.crossings.find((y) => y.key === x.key);
      assert.ok(back, `${e.key} has no crossing ${x.key}`);
      assert.ok(same(back.p, x.p));
      assert.equal(back.n[0], -x.n[0]);
      assert.equal(back.n[1], -x.n[1]);
      for (const side of [d, e]) {
        const served = side.stage3.lines.some((l) => (l.crossing === x.key && same(l.points[0], x.p)) || (l.crossingEnd === x.key && same(l.points[l.points.length - 1], x.p)));
        assert.ok(served, `${side.key} has no street at crossing ${x.key}`);
      }
      n++;
    }
  }
  assert.ok(n > inner().length * 2, `only ${n} greenway crossings`);
});

test('junctions are crossings or T junctions, never many streets at one spot', () => {
  let junctions = 0;
  let crowded = 0;
  for (const d of inner()) {
    const lines = streetsOf(d);
    const seen = [];
    for (let a = 0; a < lines.length; a++) {
      for (let b = a + 1; b < lines.length; b++) {
        for (const c of crossings(lines[a], lines[b])) {
          if (seen.some((q) => Math.hypot(q[0] - c.p[0], q[1] - c.p[1]) < 40)) continue;
          seen.push(c.p);
          junctions++;
          // Streets passing within 40 m of the junction.
          const through = lines.filter((q) => distToLine(c.p[0], c.p[1], q) < 40).length;
          assert.ok(through <= 3, `${through} streets meet at ${c.p.map(Math.round)} in ${d.key}`);
          if (through > 2) crowded++;
        }
      }
    }
  }
  assert.ok(crowded <= junctions * 0.02, `${crowded} of ${junctions} junctions have three streets close together`);
});

test('main streets keep apart: none runs alongside another', () => {
  let samples = 0;
  let alongside = 0;
  for (const d of inner()) {
    const mains = d.stage3.lines.map((l) => l.points);
    const all = streetsOf(d);
    mains.forEach((A, a) => {
      for (let i = 2; i < A.length - 2; i += 2) {
        samples++;
        const t = [A[i + 2][0] - A[i - 2][0], A[i + 2][1] - A[i - 2][1]];
        const lt = Math.hypot(...t);
        const p = A[i];
        const close = all.some((B) => {
          if (B === A) return false;
          // Near where the two meet, streets naturally run close.
          const meet = crossings(A, B).map((c) => c.p).concat([A[0], A[A.length - 1]].filter((e) => distToLine(e[0], e[1], B) < 1));
          if (meet.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 200)) return false;
          for (let j = 1; j < B.length - 1; j++) {
            if (Math.hypot(B[j][0] - p[0], B[j][1] - p[1]) > 120) continue;
            const u = [B[j + 1][0] - B[j - 1][0], B[j + 1][1] - B[j - 1][1]];
            if (Math.abs(t[0] * u[0] + t[1] * u[1]) / (lt * Math.hypot(...u)) > 0.9 && distToLine(p[0], p[1], B) > 30) return true;
          }
          return false;
        });
        if (close) alongside++;
      }
    });
  }
  assert.ok(alongside / samples < 0.02, `${((100 * alongside) / samples).toFixed(1)}% of main street runs alongside another`);
});

test('neighbourhoods have a fairly direct route to the core', () => {
  let total = 0;
  let direct = 0;
  let unconnected = 0;
  for (const d of inner().slice(0, 12)) {
    const extra = d.stage3.hoods.map((h) => [`h${h.id}`, h.centre]);
    const dist = shortest(network(d, extra), 'h0');
    for (const h of d.stage3.hoods.slice(1)) {
      const g = dist.get(`h${h.id}`);
      total++;
      if (g === undefined) {
        unconnected++;
        continue;
      }
      const crow = Math.hypot(h.centre[0] - d.station[0], h.centre[1] - d.station[1]);
      if (g < crow * 1.6 + 600) direct++;
    }
  }
  assert.ok(direct / total > 0.9, `only ${direct} of ${total} neighbourhoods have a fairly direct route to the core`);
  // Within the district, that is; a rare few reach it only through the next district.
  assert.ok(unconnected <= total * 0.03, `${unconnected} of ${total} neighbourhoods have no street to the core`);
});

test('nearly all land is within 450 m of a main street or boulevard', () => {
  let total = 0;
  let near = 0;
  let worst = 0;
  for (const d of inner().slice(0, 10)) {
    const lines = streetsOf(d);
    const ring = d.ring.concat([d.ring[0]]);
    for (let x = d.bbox.x0; x < d.bbox.x1; x += 90) {
      for (let y = d.bbox.y0; y < d.bbox.y1; y += 90) {
        if (!pointInPolygon(x, y, d.ring) || d.parks.some((p) => pointInPolygon(x, y, p.shape))) continue;
        if (distToLine(x, y, ring) < RING_MARGIN) continue;
        let m = Infinity;
        for (const l of lines) m = Math.min(m, distToLine(x, y, l));
        total++;
        if (m <= MAIN_STREET_REACH) near++;
        worst = Math.max(worst, m);
      }
    }
  }
  assert.ok(near / total > 0.94, `only ${((100 * near) / total).toFixed(1)}% of land within ${MAIN_STREET_REACH} m`);
  assert.ok(worst < 1000, `some land is ${worst.toFixed(0)} m from a main street`);
});
