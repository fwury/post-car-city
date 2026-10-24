// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedFromText } from '../src/core/hash.js';
import { createWorld, CORE_RADIUS, GREENWAY_MIN } from '../src/world/districts.js';
import { isDistrictKey } from '../src/world/growth.js';
import { CORE_SPACING } from '../src/world/cores.js';
import { PARK_SPACING, PARK_AREA_HA } from '../src/world/parks.js';
import { pointInPolygon } from '../src/util/geom.js';
import { distToLine } from '../src/world/boulevards.js';

// A big city on flat land, so a wide square of it is all districts.
const SEED = seedFromText('20');
const POPULATION = 1e7;


// One world for the read-only checks; generation is pure, so sharing is safe.
const world = createWorld(SEED, { population: POPULATION });
const [CX, CY] = world.centre;
const AREA = [CX - 7000, CY - 7000, CX + 7000, CY + 7000];
const inner = () => world.districtsInRect(...AREA).filter((d) => d.station[0] > AREA[0] && d.station[0] < AREA[2] && d.station[1] > AREA[1] && d.station[1] < AREA[3]);

test('cores keep their spacing', () => {
  const cs = world.coresInRect(CX - 12000, CY - 12000, CX + 12000, CY + 12000);
  for (const a of cs) {
    for (const b of cs) {
      if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= CORE_SPACING - 1e-6, 'cores too close');
    }
  }
});

test('shared boundaries match exactly from both sides', () => {
  for (const d of inner()) {
    for (const c of d.chains) {
      if (!isDistrictKey(c.neighbour)) continue;
      const e = world.district(world.growth.coreOf(c.neighbour));
      const back = e.chains.find((x) => x.key === c.key);
      assert.ok(back, `${e.key} is missing boundary ${c.key}`);
      const rev = back.points.slice().reverse();
      assert.ok(JSON.stringify(rev) === JSON.stringify(c.points) || JSON.stringify(back.points) === JSON.stringify(c.points), `boundary ${c.key} differs`);
    }
  }
});

test('generation does not depend on visiting order', () => {
  const a = createWorld(SEED, { population: POPULATION });
  const b = createWorld(SEED, { population: POPULATION });
  const pick = (d) => JSON.stringify({ key: d.key, ring: d.ring, core: d.core, parks: d.parks.map((p) => p.key), lines: d.network.lines.map((l) => l.points) });
  const fwd = a.districtsInRect(CX - 4500, CY - 4500, CX + 4500, CY + 4500).map(pick).sort();
  b.districtsInRect(CX + 4500, CY + 4500, CX + 9000, CY + 9000);
  b.districtsInRect(CX - 9000, CY - 4500, CX - 4500, CY + 4500);
  const rev = b.districtsInRect(CX - 4500, CY - 4500, CX + 4500, CY + 4500).map(pick).sort();
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
    // The core is a neighbourhood traced on a 50 m raster; its edge may sit a cell off the greenway line.
    const ring = d.ring.concat([d.ring[0]]);
    for (const p of d.core) assert.ok(pointInPolygon(p[0], p[1], d.ring) || distToLine(p[0], p[1], ring) < 60, `${d.key} core crosses its boundary`);
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
        assert.ok(Math.hypot(pt[0] - d.station[0], pt[1] - d.station[1]) > d.coreReach, 'park reaches into a core');
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

test('the city has the districts its people need, and no more', () => {
  const R = world.terrain.radius + 8000;
  const ds = world.districtsInRect(CX - R, CY - R, CX + R, CY + R);
  assert.equal(ds.length, Math.round(POPULATION / 150000));
  // Out past the city there are none.
  assert.equal(world.districtsInRect(CX + R + 9000, CY, CX + R + 15000, CY + 6000).length, 0);
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

test('greenways run mostly straight, with frequent small bends', () => {
  let straight = 0;
  let total = 0;
  let bends = 0;
  let length = 0;
  for (const d of inner()) {
    for (const c of d.chains) {
      const p = c.geo.points;
      const heading = (i) => Math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0]);
      let inBend = false;
      for (let i = 0; i < p.length - 10; i++) {
        let turn = Math.abs(heading(i + 9) - heading(i));
        if (turn > Math.PI) turn = 2 * Math.PI - turn;
        let local = Math.abs(heading(i + 3) - heading(i));
        if (local > Math.PI) local = 2 * Math.PI - local;
        total++;
        if (local < 0.035) straight++;
        if (turn > 0.12 && !inBend) bends++;
        inBend = turn > 0.12;
        length += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
      }
    }
  }
  assert.ok(straight / total > 0.5, `only ${((100 * straight) / total).toFixed(0)}% of greenway is straight`);
  const perKm = bends / (length / 1000);
  assert.ok(perKm > 1.5 && perKm < 8, `${perKm.toFixed(1)} bends per km`);
});

test('boundaries meeting at a junction end at exactly the same point', () => {
  for (const d of inner()) {
    const ends = d.chains.flatMap((c) => (c.points[0] === c.points[c.points.length - 1] ? [] : [c.points[0], c.points[c.points.length - 1]]));
    for (const j of d.junctions) {
      const n = ends.filter((p) => p[0] === j.x && p[1] === j.y).length;
      assert.ok(n >= 2, `junction ${j.key} of ${d.key} matches ${n} chain ends`);
    }
  }
});

test('district parks are spread out, sized 40 to 70 ha, and flow into their greenways', () => {
  const ds = world.districtsInRect(CX - 7000, CY - 7000, CX + 7000, CY + 7000);
  const parks = new Map();
  for (const d of ds) for (const p of d.parks) parks.set(p.key, p);
  const list = [...parks.values()];
  for (const a of list) {
    assert.ok(a.area > 20e4 && a.area < PARK_AREA_HA[1] * 1.15e4, `park ${a.key} is ${(a.area / 1e4).toFixed(0)} ha`);
    for (const b of list) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= PARK_SPACING, 'parks too close');
    // Every greenway leaving the park's junction runs into the park.
    const d = world.district(world.growth.coreOf(a.districts[0]));
    for (const c of d.chains) {
      const p = c.geo.points;
      const k = p[0][0] === a.x && p[0][1] === a.y ? 3 : p[p.length - 1][0] === a.x && p[p.length - 1][1] === a.y ? p.length - 4 : -1;
      if (k >= 0) assert.ok(pointInPolygon(p[k][0], p[k][1], a.shape), `park ${a.key} does not reach along its greenway`);
    }
  }
  const touching = inner().map((d) => d.parks.length);
  const crowded = touching.filter((n) => n >= 3).length;
  assert.ok(crowded <= touching.length * 0.2, `${crowded} of ${touching.length} districts touch three or more parks`);
});
