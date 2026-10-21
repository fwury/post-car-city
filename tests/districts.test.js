// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedFromText } from '../src/core/hash.js';
import { createWorld, CORE_RADIUS, GREENWAY_MIN } from '../src/world/districts.js';
import { CORE_SPACING } from '../src/world/cores.js';
import { pointInPolygon } from '../src/util/geom.js';

const SEED = seedFromText('1');
const AREA = [0, 0, 14000, 14000];

// One world for the read-only checks; generation is pure, so sharing is safe.
const world = createWorld(SEED);
const inner = () => world.districtsInRect(...AREA).filter((d) => d.station[0] > AREA[0] && d.station[0] < AREA[2] && d.station[1] > AREA[1] && d.station[1] < AREA[3]);

test('cores keep their spacing', () => {
  const cs = world.coresInRect(-10000, -10000, 30000, 30000);
  for (const a of cs) {
    for (const b of cs) {
      if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= CORE_SPACING - 1e-6, 'cores too close');
    }
  }
});

test('shared boundaries match exactly from both sides', () => {
  for (const d of inner()) {
    for (const c of d.chains) {
      const e = world.district(world.growth.coreOf(c.neighbour));
      const back = e.chains.find((x) => x.key === c.key);
      assert.ok(back, `${e.key} is missing boundary ${c.key}`);
      const rev = back.points.slice().reverse();
      assert.ok(JSON.stringify(rev) === JSON.stringify(c.points) || JSON.stringify(back.points) === JSON.stringify(c.points), `boundary ${c.key} differs`);
    }
  }
});

test('generation does not depend on visiting order', () => {
  const a = createWorld(SEED);
  const b = createWorld(SEED);
  const pick = (d) => JSON.stringify({ key: d.key, ring: d.ring, core: d.core, parks: d.parks.map((p) => p.key), lines: d.network.lines.map((l) => l.points) });
  const fwd = a.districtsInRect(0, 0, 9000, 9000).map(pick).sort();
  b.districtsInRect(9000, 9000, 18000, 18000);
  b.districtsInRect(-9000, 0, 0, 9000);
  const rev = b.districtsInRect(0, 0, 9000, 9000).map(pick).sort();
  assert.deepEqual(fwd, rev);
});

test('districts are irregular, connected, about 6 to 9 km² on average, with a core around the station', () => {
  const ds = inner();
  assert.ok(ds.length > 10);
  let total = 0;
  for (const d of ds) {
    total += d.area;
    assert.equal(d.rings.length, 1, `${d.key} is split into ${d.rings.length} pieces`);
    assert.ok(d.area > 2e6 && d.area < 25e6, `${d.key} area ${(d.area / 1e6).toFixed(1)} km²`);
    assert.ok(d.coreRadius >= 200 && d.coreRadius <= CORE_RADIUS);
    assert.ok(pointInPolygon(d.station[0], d.station[1], d.ring), `${d.key} station outside its district`);
    for (const p of d.core) assert.ok(pointInPolygon(p[0], p[1], d.ring), `${d.key} core crosses its boundary`);
  }
  const mean = total / ds.length / 1e6;
  assert.ok(mean > 6 && mean < 10.5, `mean district ${mean.toFixed(1)} km²`);
  const sizes = ds.map((d) => d.area);
  assert.ok(Math.max(...sizes) / Math.min(...sizes) > 1.8, 'districts are too uniform in size');
});

test('greenways are at least 50 m wide', () => {
  for (let i = 0; i < 2000; i++) assert.ok(world.greenwayWidth(i * 137.1, i * -91.7) >= GREENWAY_MIN);
});

test('district parks sit at junctions, clear of cores and boulevards, shared by their districts', () => {
  const ds = inner();
  const parks = new Map();
  let without = 0;
  for (const d of ds) {
    if (d.parks.length === 0) without++;
    for (const p of d.parks) parks.set(p.key, p);
  }
  for (const p of parks.values()) {
    assert.ok(p.districts.length >= 3);
    for (const l of p.districts) {
      const d = world.district(world.growth.coreOf(l));
      assert.ok(d.parks.some((q) => q.key === p.key), `park ${p.key} missing from ${d.key}`);
      for (const pt of p.shape) {
        assert.ok(Math.hypot(pt[0] - d.station[0], pt[1] - d.station[1]) > d.coreRadius * 1.15, 'park overlaps a core');
      }
    }
    for (const pt of p.shape) assert.ok(world.boulevardDistance(pt[0], pt[1]) > 17, 'park sits on a boulevard');
  }
  assert.ok(parks.size >= ds.length * 0.35, `only ${parks.size} parks for ${ds.length} districts`);
  assert.ok(without <= ds.length * 0.2, `${without} of ${ds.length} districts touch no district park`);
});

test('every core has at least two boulevard links', () => {
  for (const d of inner()) assert.ok(d.links >= 2, `${d.key} has ${d.links} links`);
});

test('works far from the origin', () => {
  const x = 3e8;
  const ds = world.districtsInRect(x, -x, x + 6000, -x + 6000);
  assert.ok(ds.length > 0);
  const d = ds[0];
  const c = d.chains[0];
  const e = world.district(world.growth.coreOf(c.neighbour));
  assert.ok(e.chains.some((x2) => x2.key === c.key));
  assert.ok(d.links >= 2 && d.network.lines.length >= 1);
});

test('generation code never calls Math.random', () => {
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  for (const file of walk(root).filter((f) => f.endsWith('.js'))) {
    if (file.includes('/ui/')) continue;
    assert.ok(!readFileSync(file, 'utf8').includes('Math.random'), `${file} uses Math.random`);
  }
});
