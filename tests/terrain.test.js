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

for (const kind of ['river', 'coast', 'inland']) {
  test(`a city of 1.5 million ${kind === 'inland' ? 'inland' : `on a ${kind}`} has 10 districts, all on dry land`, () => {
    const w = createWorld(seedFor(kind), { population: 1.5e6 });
    const R = w.terrain.radius + 6000;
    const ds = w.districtsInRect(-R, -R, R, R);
    assert.equal(ds.length, Math.round(1.5e6 / PEOPLE_PER_DISTRICT));
    for (const d of ds) {
      assert.ok(!w.terrain.isWater(...d.station), `${d.key} has its station in the water`);
      for (const l of d.network.links) assert.ok(isDistrictKey(l.neighbour), `${d.key} links out to ${l.neighbour}`);
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
