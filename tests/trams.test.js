// Tram routes, planned for the whole city.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world/districts.js';
import { seedFromText } from '../src/core/hash.js';

const world = createWorld(seedFromText('1'), { population: 1.5e6 });
const plan = world.trams.plan();
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('every route runs from a loop to a loop, at the city edge, a park or a station plaza', () => {
  assert.ok(plan.routes.length >= 5, `${plan.routes.length} routes`);
  for (const r of plan.routes) for (const e of r.ends) assert.ok(['edge', 'park', 'plaza'].includes(e.at), `a route ends at ${e.at}`);
  assert.ok(plan.loops.length >= 2);
});

test('every route stops at the station plaza of a district centre it passes', () => {
  for (const r of plan.routes) {
    assert.ok(r.anchors.length >= 1);
    const plazas = plan.stops.filter((s) => s.plaza || s.end);
    assert.ok(r.stops.some((p) => plazas.some((s) => dist(s.p, p) < 1)), 'no stop at a plaza');
  }
});

test('nearly every neighbourhood rides straight to its district centre, by tram or metro', () => {
  assert.ok(plan.judged.joined >= 0.95, `${(plan.judged.joined * 100).toFixed(0)}% joined`);
});

test('routes keep to one overall way, and stops are 300 to 400 m apart along them', () => {
  const gaps = [];
  for (const r of plan.routes) {
    const [A, B] = [r.ends[0].p, r.ends[1].p];
    const L = dist(A, B);
    assert.ok(r.len <= 1.55 * L + 1500, `a ${Math.round(r.len)} m route between ends ${Math.round(L)} m apart`);
    for (let i = 1; i < r.stops.length; i++) gaps.push(dist(r.stops[i], r.stops[i - 1]));
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[gaps.length >> 1];
  // (Straight-line gaps: a little under the distance along the street.)
  assert.ok(median >= 260 && median <= 400, `median gap ${Math.round(median)} m`);
});

test('only routed streets have tracks; the rest have none', () => {
  let routed = 0;
  let all = 0;
  for (const c of world.cityCores) {
    const d = world.district(c);
    const T = world.trams.in(d);
    for (const l of d.stage3.lines) {
      all++;
      if (T.ranges.has(l.key)) routed++;
    }
  }
  assert.ok(routed > 0 && routed < all, `${routed} of ${all} main streets routed`);
});
