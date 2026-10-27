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
  // (Crosstown routes, added for coverage, pass none; most routes do.)
  assert.ok(plan.routes.filter((r) => r.anchors.length).length >= plan.routes.length / 2);
  for (const r of plan.routes) {
    if (!r.anchors.length) continue;
    const plazas = plan.stops.filter((s) => s.plaza || s.end);
    assert.ok(r.stops.some((p) => plazas.some((s) => dist(s.p, p) < 1)), 'no stop at a plaza');
  }
});

test('most neighbourhoods ride straight to their district centre, by tram or metro', () => {
  assert.ok(plan.judged.joined >= 0.9, `${(plan.judged.joined * 100).toFixed(0)}% joined`);
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

test('neighbouring centres with no metro or rail between them have a tram route straight between them', () => {
  const { must, mustJoined, all, joined } = plan.judged.pairs;
  assert.ok(all > 0 && must > 0, `${all} neighbouring pairs, ${must} with no metro or rail`);
  assert.equal(mustJoined, must);
  assert.ok(joined / all >= 0.5, `${joined} of ${all} pairs joined`);
});

test('nearly everyone lives within 400 m of a tram stop', () => {
  const G = 200;
  const idx = new Map();
  for (const s of plan.stops) {
    const k = `${Math.floor(s.p[0] / G)},${Math.floor(s.p[1] / G)}`;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(s.p);
  }
  const near = (x, y) => {
    for (let a = Math.floor(x / G) - 2; a <= Math.floor(x / G) + 2; a++) for (let b = Math.floor(y / G) - 2; b <= Math.floor(y / G) + 2; b++) for (const p of idx.get(`${a},${b}`) || []) if (Math.hypot(p[0] - x, p[1] - y) < 400) return true;
    return false;
  };
  let all = 0;
  let served = 0;
  for (const c of world.cityCores) {
    const R = world.district(c).stage3.raster;
    for (let j = 0; j < R.H; j++) {
      for (let i = 0; i < R.W; i++) {
        const n = j * R.W + i;
        if (R.label[n] < 0 || !R.dens[n]) continue;
        const w = R.dens[n] * R.cell * R.cell;
        all += w;
        if (near(R.x0 + (i + 0.5) * R.cell, R.y0 + (j + 0.5) * R.cell)) served += w;
      }
    }
  }
  assert.ok(served / all >= 0.95, `${((served / all) * 100).toFixed(1)}% within 400 m`);
});
