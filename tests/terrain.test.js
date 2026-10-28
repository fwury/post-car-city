// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedFromText } from '../src/core/hash.js';
import { createWorld } from '../src/world/districts.js';
import { SITES, siteOf, PEOPLE_PER_DISTRICT } from '../src/world/terrain.js';
import { isDistrictKey } from '../src/world/growth.js';

test('seeds get kinds of site in about the shares cities have them', () => {
  assert.ok(Math.abs(SITES.reduce((a, s) => a + s[1], 0) - 1) < 1e-9);
  const n = 4000;
  const counts = new Map();
  for (let i = 0; i < n; i++) {
    const k = siteOf(seedFromText(`site-${i}`));
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  for (const [k, share] of SITES) {
    const got = (counts.get(k) || 0) / n;
    assert.ok(Math.abs(got - share) < 0.025, `${k}: ${got.toFixed(3)} of seeds, want about ${share}`);
  }
});

// Seeds of a few kinds of site (found by siteOf).
const seedFor = (kind) => {
  for (let i = 0; ; i++) if (siteOf(seedFromText(String(i))) === kind) return seedFromText(String(i));
};

for (const kind of ['river', 'shore', 'inland']) {
  test(`a city of 1.5 million (${kind}) has 10 districts, all on dry land`, () => {
    const w = createWorld(seedFor(kind), { population: 1.5e6 });
    const R = w.terrain.radius + 6000;
    const ds = w.districtsInRect(-R, -R, R, R);
    assert.equal(ds.length, Math.round(1.5e6 / PEOPLE_PER_DISTRICT));
    for (const d of ds) {
      assert.ok(!w.terrain.isWater(...d.station), `${d.key} has its station in the water`);
      // (Or out into the country, on as a road: never to the sea.)
      for (const l of d.network.links) assert.ok(isDistrictKey(l.neighbour) || l.country, `${d.key} links out to ${l.neighbour}`);
    }
    // Boundaries along a river lie on it; along the shore, half a greenway in from it.
    for (const d of ds) {
      for (const c of d.chains) {
        const P = c.geo.points;
        if (c.geo.kind === 'river') {
          const on = P.filter(([x, y]) => w.terrain.nearestRiver(x, y).d < 5).length;
          assert.ok(on > P.length * 0.5, `${c.key} is only partly on its river`);
        }
        if (c.geo.kind === 'shore') {
          const off = P.filter(([x, y]) => Math.abs(w.terrain.shore(x, y) - w.greenwayWidth(x, y) / 2) > 60).length;
          assert.ok(off < P.length * 0.2, `${c.key} strays from the shore`);
        }
      }
    }
  });
}

test('the smallest city is one district', () => {
  const w = createWorld(seedFor('inland'), { population: 150000 });
  assert.equal(w.districtsInRect(-20000, -20000, 20000, 20000).length, 1);
});

test('mountains are never built on, and the city stops at them', () => {
  for (let i = 0; i < 60; i++) {
    const w = createWorld(seedFromText(String(i)), { population: 1.5e6 });
    if (!w.terrain.label.includes('mountains')) continue;
    const R = w.terrain.radius + 6000;
    for (const d of w.districtsInRect(-R, -R, R, R)) assert.ok(!w.terrain.isHigh(...d.station), `${d.key} stands on the mountains`);
    return;
  }
  assert.fail('no seed with mountains');
});

test('an island is cut off by a channel the streets bridge', () => {
  for (let i = 0; i < 60; i++) {
    const w = createWorld(seedFromText(String(i)), { population: 1.5e6 });
    if (!w.terrain.label.includes('an island')) continue;
    assert.ok(w.terrain.rivers.some((r) => r.channel), 'no channel');
    return;
  }
  assert.fail('no seed with an island');
});

test('rivers meander, widen and narrow along their way', () => {
  const w = createWorld(seedFor('river'), { population: 1.5e6 });
  const rv = w.terrain.rivers[0];
  const widths = [];
  for (let i = 0; i < rv.pts.length; i += 10) {
    const r = w.terrain.nearestRiver(rv.pts[i][0], rv.pts[i][1]);
    if (r && r.river === 0) widths.push(r.width);
  }
  const lo = Math.min(...widths);
  const hi = Math.max(...widths);
  assert.ok(hi / lo > 1.2, `widths ${lo.toFixed(0)} to ${hi.toFixed(0)} m`);
  // (Its course is longer than the straight line between its ends.)
  let L = 0;
  for (let i = 1; i < rv.pts.length; i++) L += Math.hypot(rv.pts[i][0] - rv.pts[i - 1][0], rv.pts[i][1] - rv.pts[i - 1][1]);
  const D = Math.hypot(rv.pts[rv.pts.length - 1][0] - rv.pts[0][0], rv.pts[rv.pts.length - 1][1] - rv.pts[0][1]);
  assert.ok(L / D > 1.08, `sinuosity ${(L / D).toFixed(2)}`);
});

test('inner-city waterfronts are for people: quays and plazas on the river, quays and piers on the shore', () => {
  for (const kind of ['river', 'shore']) {
    const w = createWorld(seedFor(kind), { population: 1.5e6 });
    const [cx, cy] = w.centre;
    const ds = w.districtsInRect(cx - 2500, cy - 2500, cx + 2500, cy + 2500);
    const gs = ds.flatMap((d) => d.chains.filter((c) => c.geo.kind === (kind === 'river' ? 'river' : 'shore')).map((c) => w.greenway(c.geo)));
    assert.ok(gs.length, `${kind}: no waterfront near the centre`);
    assert.ok(gs.some((g) => g.quays && g.quays.length), `${kind}: no quays`);
    if (kind === 'river') assert.ok(gs.some((g) => g.plazas && g.plazas.length), 'no plazas at the water');
    // Main streets stop at the bank unless a bridge carries them across.
    for (const d of ds) {
      for (const l of d.stage3.lines) {
        for (const q of [l.points[0], l.points[l.points.length - 1]]) {
          const r = w.terrain.nearestRiver(q[0], q[1]);
          const crossing = d.stage3.crossings.some((x) => Math.hypot(x.p[0] - q[0], x.p[1] - q[1]) < 30);
          assert.ok(crossing || !r || r.d >= r.width / 2, `${d.key}: ${l.key} ends in the river`);
        }
      }
    }
  }
});
