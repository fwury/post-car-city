// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedFromText } from '../src/core/hash.js';
import { createWorld } from '../src/world/districts.js';
import { MIN_SHARED_EDGE, MIN_RADIUS, minRadius, distToLine } from '../src/world/boulevards.js';

const SEED = seedFromText('1');
const AREA = [0, 0, 14000, 14000];
const world = createWorld(SEED);
const inner = () => world.districtsInRect(...AREA).filter((d) => d.station[0] > AREA[0] && d.station[0] < AREA[2] && d.station[1] > AREA[1] && d.station[1] < AREA[3]);
const other = (key) => world.district(world.growth.coreOf(key));
const ends = (l) => [l.points[0], l.points[l.points.length - 1]];

test('nearly every pair of neighbouring districts is linked by a boulevard', () => {
  let pairs = 0;
  let linked = 0;
  for (const d of inner()) {
    for (const n of d.neighbours) {
      pairs++;
      if (d.network.links.some((l) => l.neighbour === n)) linked++;
    }
    for (const c of d.chains) {
      if (world.boulevards.crossingOf(c.geo).length > MIN_SHARED_EDGE * 1.6) assert.ok(d.network.links.some((l) => l.neighbour === c.neighbour), `${d.key} has no link to ${c.neighbour}`);
    }
  }
  assert.ok(linked / pairs > 0.85, `only ${linked} of ${pairs} neighbour pairs linked`);
});

test('both halves of a link meet exactly, crossing the greenway at right angles', () => {
  for (const d of inner()) {
    for (const l of d.network.links) {
      const e = other(l.neighbour);
      const back = e.network.links.find((x) => x.key === l.key);
      assert.ok(back, `${e.key} is missing link ${l.key}`);
      assert.deepEqual(back.p, l.p);
      assert.equal(back.n[0], -l.n[0]);
      assert.equal(back.n[1], -l.n[1]);
      // The district's line ends at the crossing point, heading straight across.
      const line = d.network.lines.find((x) => ends(x).some((p) => p === l.p || (p[0] === l.p[0] && p[1] === l.p[1])));
      assert.ok(line, `${d.key} has no line reaching ${l.key}`);
      const chain = d.chains.find((c) => c.key === l.key).points;
      let i = 0;
      for (let k = 1; k < chain.length; k++) if (Math.hypot(chain[k][0] - l.p[0], chain[k][1] - l.p[1]) < Math.hypot(chain[i][0] - l.p[0], chain[i][1] - l.p[1])) i = k;
      const a = chain[Math.max(0, i - 3)];
      const b = chain[Math.min(chain.length - 1, i + 3)];
      const t = [b[0] - a[0], b[1] - a[1]];
      const cos = Math.abs(t[0] * l.n[0] + t[1] * l.n[1]) / Math.hypot(...t);
      assert.ok(cos < 0.35, `link ${l.key} crosses at ${(Math.acos(cos) * 180 / Math.PI).toFixed(0)} degrees`);
    }
  }
});

test('every station is on a boulevard', () => {
  for (const d of inner()) {
    const near = Math.min(...d.network.lines.map((l) => distToLine(d.station[0], d.station[1], l.points)));
    assert.ok(near < 1e-6, `${d.key} station is ${near.toFixed(0)} m from a boulevard`);
  }
});

test('branches end at T junctions on another boulevard, meeting at about right angles', () => {
  let n = 0;
  for (const d of inner()) {
    for (const l of d.network.lines.filter((x) => x.kind === 'branch')) {
      const p = l.points;
      const end = p[p.length - 1];
      const host = d.network.lines.filter((x) => x !== l).find((x) => x.points.includes(end));
      assert.ok(host, `${l.key} does not end on another boulevard`);
      const i = host.points.indexOf(end);
      const h = host.points;
      const tau = [h[Math.min(h.length - 1, i + 2)][0] - h[Math.max(0, i - 2)][0], h[Math.min(h.length - 1, i + 2)][1] - h[Math.max(0, i - 2)][1]];
      const arr = [end[0] - p[p.length - 3][0], end[1] - p[p.length - 3][1]];
      const cos = Math.abs(tau[0] * arr[0] + tau[1] * arr[1]) / (Math.hypot(...tau) * Math.hypot(...arr));
      if (cos < 0.5) n++;
    }
  }
  assert.ok(n > 10, 'too few right-angled T junctions');
});

test('boulevards bend, but never tighter than the minimum radius', () => {
  let turning = 0;
  let count = 0;
  for (const d of inner()) {
    for (const l of d.network.lines) {
      if (l.kind === 'roundabout') continue;
      assert.ok(minRadius(l.points) >= MIN_RADIUS * 0.95, `${l.key} bends at ${minRadius(l.points).toFixed(0)} m radius`);
      const p = l.points;
      let sum = 0;
      for (let i = 1; i < p.length - 1; i++) {
        const a = Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]);
        const b = Math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0]);
        sum += Math.abs(((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
      }
      turning += sum;
      count++;
    }
  }
  const mean = (turning / count) * 180 / Math.PI;
  assert.ok(mean > 35, `boulevards turn only ${mean.toFixed(0)} degrees on average`);
});

test('some cores have a large roundabout, most do not', () => {
  const ds = world.districtsInRect(-10000, -10000, 30000, 30000);
  const r = ds.filter((d) => d.network.roundabout).length;
  assert.ok(r > ds.length * 0.08 && r < ds.length * 0.45, `${r} roundabouts in ${ds.length} districts`);
  for (const d of ds) {
    const rb = d.network.roundabout;
    if (!rb) continue;
    const arms = d.network.lines.filter((l) => l.kind === 'arm');
    assert.equal(arms.length, 3);
    for (const a of arms) assert.ok(Math.abs(Math.hypot(a.points[0][0] - rb.x, a.points[0][1] - rb.y) - rb.r) < 1e-6);
  }
});
