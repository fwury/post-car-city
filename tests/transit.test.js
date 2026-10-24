// Regional rail and metro, planned for the whole city as networks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world/districts.js';
import { seedFromText } from '../src/core/hash.js';
import { minRadius, MIN_RADIUS } from '../src/world/rail.js';
import { minRadius as metroRadius, METRO_RADIUS } from '../src/world/metro.js';

const world = createWorld(seedFromText('1'), { population: 6e6 });
const small = createWorld(seedFromText('1'), { population: 1.5e6 });
const P = (w) => w.cityCores.map((c) => [c.x, c.y]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('a large city has a loop line through its central station; a small one a central trunk', () => {
  const r = world.rail;
  assert.ok(r.ring, 'no loop');
  assert.ok(r.ring.ids.includes(0), 'the loop misses the central station');
  assert.ok(r.lines.some((l) => l.ring));
  assert.ok(!small.rail.ring, 'a small city has a loop');
  assert.ok(small.rail.lines.length >= 1);
});

test('nearly every district has a rail station in it or next to it', () => {
  for (const w of [world, small]) {
    const pts = P(w);
    const on = w.rail.stations.filter((s) => s.key).map((s) => pts[w.cityCores.findIndex((c) => c.key === s.key)]);
    const near = pts.filter((p) => on.some((q) => dist(p, q) < 3000)).length;
    assert.ok(near >= pts.length * 0.8, `${near} of ${pts.length} districts by the rail`);
  }
});

test('rail curves are gentle, and every station is underground', () => {
  for (const sg of world.rail.segments) {
    if (sg.country || sg.a === 0 || sg.b === 0) continue;
    assert.ok(minRadius(sg.pts) >= MIN_RADIUS * 0.8, `${sg.key}: a ${minRadius(sg.pts).toFixed(0)} m curve`);
  }
  for (const st of world.rail.stations) {
    for (const sg of world.rail.segments) {
      for (const run of sg.runs) {
        if (run.kind === 'tunnel') continue;
        for (const q of run.pts) assert.ok(dist(q, st.p) > 200, `track above ground at a station (${st.id})`);
      }
    }
  }
});

test('the metro is one network, most district pairs a change apart at most', () => {
  const plan = world.metro.plan();
  assert.ok(plan.lines.length >= 4);
  assert.ok(plan.judged.one >= 0.8, `only ${(plan.judged.one * 100).toFixed(0)}% of pairs within one change`);
  // One network: every line reaches every other through shared stations.
  const seen = new Set([0]);
  for (let grew = true; grew; ) {
    grew = false;
    plan.lines.forEach((l, k) => {
      if (seen.has(k)) return;
      if ([...seen].some((j) => plan.lines[j].stations.some((s) => l.stations.includes(s)))) {
        seen.add(k);
        grew = true;
      }
    });
  }
  assert.equal(seen.size, plan.lines.length, 'the metro is in pieces');
});

test('metro stations are about 800 m apart, on smooth lines, about one for 30 000 people', () => {
  const plan = world.metro.plan();
  const gaps = [];
  for (const l of plan.lines) {
    assert.ok(metroRadius(l.pts) >= METRO_RADIUS * 0.95, `line ${l.name}: a ${metroRadius(l.pts).toFixed(0)} m curve`);
    for (let k = 1; k < l.stations.length; k++) gaps.push(dist(plan.stations[l.stations[k]].p, plan.stations[l.stations[k - 1]].p));
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[gaps.length >> 1];
  assert.ok(median > 600 && median < 1000, `median spacing ${median.toFixed(0)} m`);
  const per = world.population / plan.stations.length;
  assert.ok(per > 20000 && per < 45000, `one station for ${per.toFixed(0)} people`);
});
