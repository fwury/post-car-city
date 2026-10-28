// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedFromText } from '../src/core/hash.js';
import { createWorld } from '../src/world/districts.js';

const world = createWorld(seedFromText('1'), { population: 1.5e6 });
const P = world.periphery;

test('a greenbelt 1 to 2 km wide, the expressway round its outer edge', () => {
  assert.ok(P.width >= 1000 && P.width <= 2000, `${P.width} m wide`);
  assert.ok(P.expressway.length >= 1, 'no expressway');
  for (const e of P.expressway) {
    for (const q of e.pts) assert.ok(P.outFromCity(q) >= P.width * 0.85, `the expressway comes ${Math.round(P.outFromCity(q))} m from the city`);
  }
  assert.ok(P.woods.length > 10, 'no woods');
  assert.ok(P.trails.length > 3, 'no trails');
});

test('roads run on from boulevards at the city edge to the expressway, each with its trail', () => {
  assert.ok(P.roads.length >= 2, `${P.roads.length} roads`);
  for (const r of P.roads) {
    if (r.toIndustry) continue;
    assert.ok(P.outFromCity(r.pts[0]) <= 150, 'a road starts away from the city');
    assert.ok(['trumpet', 'ddi'].includes(r.end));
    assert.ok(r.trail && r.trail.length === r.pts.length + (r.on ? r.on.length - 1 : 0), 'a road with no trail');
  }
  assert.equal(P.junctions.length, P.roads.length);
});

test('industrial areas beyond the expressway, about one per 1.25 million people, named, gridded, by rail', () => {
  assert.equal(P.industrial.length, Math.max(1, Math.round(1.5e6 / 1.25e6)));
  for (const a of P.industrial) {
    assert.ok(a.name, 'an industrial area with no name');
    for (const q of a.pts) assert.ok(P.outFromCity(q) > P.width, 'an industrial area inside the greenbelt');
    assert.ok(a.lots.length > 20, `${a.lots.length} lots`);
    assert.ok(a.streets.length > 6, `${a.streets.length} streets`);
    assert.ok(a.station || a.road, 'an industrial area nothing reaches');
  }
});

test('park-and-rides where rail lines cross the expressway; attractions in the greenbelt by metro', () => {
  assert.ok(P.parkAndRides.length >= 1, 'no park-and-ride');
  for (const p of P.parkAndRides) assert.ok(/Park-and-Ride$/.test(p.name));
  // (A botanical garden from 1.5 million people.)
  assert.ok(P.attractions.some((a) => a.kind === 'botanical'), 'no botanical garden');
  for (const a of P.attractions) {
    assert.ok(P.outFromCity(a.c) > 0 && P.outFromCity(a.c) < P.width, `${a.name} is not in the greenbelt`);
    assert.ok(a.metro.pts.length > 1, `${a.name} has no metro`);
  }
});
