// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedFromText } from '../src/core/hash.js';
import { createWorld } from '../src/world/districts.js';
import { distToLine } from '../src/world/boulevards.js';
import { NEIGHBOURHOODS, MAIN_STREET_REACH, CORE_ARMS, RING_MARGIN } from '../src/world/neighbourhoods.js';
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

test('every centre is on a main street or boulevard that runs through it', () => {
  let opposite = 0;
  let free = 0;
  for (const d of inner()) {
    const s = d.stage3;
    s.nodes.forEach((nd, k) => {
      if (nd.kind === 'core') {
        assert.ok(d.network.lines.some((l) => distToLine(nd.p[0], nd.p[1], l.points) < 1e-6), `${d.key} station is off the boulevards`);
        return;
      }
      if (nd.kind !== 'centre') return;
      if (nd.t) {
        assert.ok(d.network.lines.some((l) => distToLine(nd.p[0], nd.p[1], l.points) < 1e-6), `${d.key} centre ${k} is off its boulevard`);
        return;
      }
      free++;
      assert.ok(s.degree[k] >= 2, `${d.key} centre ${k} is a dead end`);
      const dirs = s.lines.filter((l) => l.a === k || l.b === k).map((l) => {
        const p = l.a === k ? l.points[Math.min(5, l.points.length - 1)] : l.points[Math.max(0, l.points.length - 6)];
        const v = [p[0] - nd.p[0], p[1] - nd.p[1]];
        const m = Math.hypot(...v);
        return [v[0] / m, v[1] / m];
      });
      if (dirs.some((u, i) => dirs.some((v, j) => j > i && u[0] * v[0] + u[1] * v[1] < -0.3))) opposite++;
    });
  }
  assert.ok(opposite / free > 0.85, `only ${opposite} of ${free} centres have a street running through`);
});

test('main streets never dead-end', () => {
  for (const d of inner()) {
    const s = d.stage3;
    for (const l of s.lines) {
      for (const k of [l.a, l.b]) {
        const nd = s.nodes[k];
        const end = k === l.a ? l.points[0] : l.points[l.points.length - 1];
        assert.ok(same(end, nd.p), `${l.key} does not end at its node`);
        if (nd.kind === 'boulevard') assert.ok(d.network.lines.some((b) => distToLine(end[0], end[1], b.points) < 1e-6), `${l.key} ends short of its boulevard`);
        if (nd.kind === 'centre' && !nd.t) assert.ok(s.degree[k] >= 2, `${l.key} ends at a dead-end centre`);
      }
    }
  }
});

test('main streets carry on across greenways into the next district', () => {
  let n = 0;
  for (const d of inner()) {
    for (const nd of d.stage3.nodes.filter((x) => x.kind === 'edge')) {
      const e = other(nd.neighbour);
      const back = e.stage3.nodes.find((x) => x.kind === 'edge' && x.key === nd.key);
      assert.ok(back, `${e.key} has no street at crossing ${nd.key}`);
      assert.ok(same(back.p, nd.p));
      assert.equal(back.n[0], -nd.n[0]);
      assert.equal(back.n[1], -nd.n[1]);
      n++;
    }
  }
  assert.ok(n > inner().length * 2, `only ${n} greenway crossings`);
});

test('4 to 6 tram streets run into each core, boulevards included', () => {
  const ds = inner();
  const ok = ds.filter((d) => d.stage3.arms >= CORE_ARMS[0] && d.stage3.arms <= CORE_ARMS[1]).length;
  for (const d of ds) assert.ok(d.stage3.arms <= CORE_ARMS[1] + 1, `${d.key} core has ${d.stage3.arms} tram streets`);
  assert.ok(ok / ds.length > 0.85, `only ${ok} of ${ds.length} cores have 4 to 6 tram streets`);
});

test('nearly all land is within 450 m of a main street or boulevard', () => {
  let total = 0;
  let near = 0;
  let worst = 0;
  for (const d of inner().slice(0, 10)) {
    const lines = d.stage3.lines.map((l) => l.points).concat(d.network.lines.map((l) => l.points));
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
  assert.ok(near / total > 0.97, `only ${((100 * near) / total).toFixed(1)}% of land within ${MAIN_STREET_REACH} m`);
  assert.ok(worst < 1000, `some land is ${worst.toFixed(0)} m from a main street`);
});
