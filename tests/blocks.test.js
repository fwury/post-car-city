// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedFromText } from '../src/core/hash.js';
import { createWorld } from '../src/world/districts.js';
import { axesOf } from '../src/world/blocks.js';
import { distToLine } from '../src/world/boulevards.js';
import { polygonArea } from '../src/util/geom.js';
import { ALLEY } from '../src/world/plots.js';

const SEED = seedFromText('1');
const world = createWorld(SEED);
// A few districts of different kinds round the middle of the test area.
const districts = world.districtsInRect(3000, 3000, 5500, 5500).slice(0, 4);
const blocksOf = (d) => world.blocks(d);

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

function minCorner(P) {
  let m = 180;
  for (let i = 0; i < P.length; i++) {
    const a = P[(i - 1 + P.length) % P.length];
    const b = P[i];
    const c = P[(i + 1) % P.length];
    const u = [a[0] - b[0], a[1] - b[1]];
    const v = [c[0] - b[0], c[1] - b[1]];
    const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v) || 1);
    m = Math.min(m, (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI);
  }
  return m;
}

test('blocks are the same from a fresh world', () => {
  const d = districts[0];
  const again = createWorld(SEED);
  const e = again.districtsInRect(d.station[0] - 1, d.station[1] - 1, d.station[0] + 1, d.station[1] + 1).find((q) => q.key === d.key);
  const a = blocksOf(d).blocks.map((b) => [b.use, b.pts && b.pts.length, Math.round(b.area)]);
  const b = again.blocks(e).blocks.map((k) => [k.use, k.pts && k.pts.length, Math.round(k.area)]);
  assert.deepEqual(a, b);
});

test('blocks cover the land between the streets', () => {
  for (const d of districts) {
    const b = blocksOf(d);
    let covered = 0;
    for (const k of b.blocks) covered += polygonArea(k.centreline);
    const land = d.area - d.parks.reduce((s, p) => s + p.area, 0);
    // The rest is the inner half of the greenways round the district.
    assert.ok(covered > land * 0.8 && covered < d.area, `${d.key}: blocks cover ${(covered / 1e4).toFixed(0)} of ${(d.area / 1e4).toFixed(0)} ha`);
    const failed = b.blocks.filter((k) => !k.pts).length;
    assert.ok(failed <= b.blocks.length * 0.01, `${d.key}: ${failed} blocks have no building line`);
  }
});

test('blocks are the sizes their housing calls for', () => {
  const sides = { perimeter: [], rowhouse: [] };
  for (const d of districts) for (const k of blocksOf(d).blocks) if (k.pts && sides[k.use]) sides[k.use].push(axesOf(k.pts));
  const median = (l, f) => l.map(f).sort((a, b) => a - b)[l.length >> 1];
  const p = sides.perimeter;
  assert.ok(p.length > 100, 'few perimeter blocks');
  // About 100 m, building line to building line.
  assert.ok(median(p, (a) => a.W) > 65 && median(p, (a) => a.W) < 100, `perimeter blocks ${median(p, (a) => a.W).toFixed(0)} m across`);
  assert.ok(median(p, (a) => a.L) > 95 && median(p, (a) => a.L) < 150, `perimeter blocks ${median(p, (a) => a.L).toFixed(0)} m long`);
  const r = sides.rowhouse;
  if (r.length > 10) {
    // Two rows of houses back to back, and long.
    assert.ok(median(r, (a) => a.W) > 45 && median(r, (a) => a.W) < 85, `rowhouse blocks ${median(r, (a) => a.W).toFixed(0)} m deep`);
    assert.ok(median(r, (a) => a.L) > 120, `rowhouse blocks only ${median(r, (a) => a.L).toFixed(0)} m long`);
  }
});

test('blocks are well shaped: no sharp points, no ragged edges', () => {
  let n = 0;
  let sharp = 0;
  let ragged = 0;
  for (const d of districts) {
    for (const k of blocksOf(d).blocks) {
      if (!k.pts || k.use === 'green') continue;
      n++;
      if (minCorner(k.pts) < 50) sharp++;
      if (polygonArea(k.pts) / polygonArea(hull(k.pts)) < 0.85) ragged++;
    }
  }
  assert.ok(sharp <= n * 0.02, `${sharp} of ${n} blocks have a corner under 50°`);
  assert.ok(ragged <= n * 0.02, `${ragged} of ${n} blocks are far from convex`);
});

test('every neighbourhood has its square, park and secondary school', () => {
  let hoods = 0;
  let squares = 0;
  let parks = 0;
  let schools = 0;
  for (const d of districts) {
    const b = blocksOf(d).blocks;
    for (const h of d.stage3.hoods) {
      hoods++;
      if (b.some((k) => k.use === 'square' && k.hood === h.id)) squares++;
      if (h.core) continue;
      if (b.some((k) => k.use === 'park' && k.hood === h.id)) parks++;
      if (b.some((k) => k.use === 'school' && k.hood === h.id)) schools++;
    }
  }
  const rest = hoods - districts.length;
  assert.ok(squares >= hoods * 0.9, `${squares} squares for ${hoods} neighbourhoods`);
  assert.ok(parks >= rest * 0.9, `${parks} parks for ${rest} neighbourhoods`);
  assert.ok(schools >= rest * 0.9, `${schools} secondary schools for ${rest} neighbourhoods`);
  // Each square has a pedestrian street off it.
  for (const d of districts) {
    const b = blocksOf(d);
    const ped = b.streets.filter((s) => s.kind === 'pedestrian');
    for (const k of b.blocks.filter((q) => q.use === 'square')) {
      const by = ped.some((s) => s.segs.some(([a, c]) => k.centreline.some((p) => distToLine(p[0], p[1], [a, c]) < 1)));
      assert.ok(by || !k.centreline, `a square in ${d.key} has no pedestrian street`);
    }
  }
});

test('local streets never dead-end, and meet other streets square on', () => {
  for (const d of districts) {
    const b = blocksOf(d);
    const lines = d.stage3.lines.map((l) => l.points).concat(d.network.lines.map((l) => l.points));
    for (const side of b.sides) lines.push(side.pts.concat([side.pts[0]]));
    const key = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
    let dead = 0;
    let oblique = 0;
    let ends = 0;
    for (const s of b.streets) {
      // The ends of this street: points used by one of its segments only.
      const count = new Map();
      for (const [a, c] of s.segs) for (const p of [a, c]) count.set(key(p), (count.get(key(p)) || 0) + 1);
      for (const [a, c] of s.segs) {
        for (const [p, q] of [[a, c], [c, a]]) {
          if (count.get(key(p)) !== 1) continue;
          ends++;
          // It meets another street there.
          // (Not one that also ends here: that carries straight on, across.)
          const endsAt = (o) => o.segs.filter(([g0, g1]) => key(g0) === key(p) || key(g1) === key(p)).length === 1;
          const line = lines.find((l) => distToLine(p[0], p[1], l) < 0.5);
          const near = (o) => o !== s && o.segs.some((g) => distToLine(p[0], p[1], g) < 0.5);
          const other = line ? null : b.streets.find((o) => near(o) && !endsAt(o)) || b.streets.find(near);
          const through = (g) => distToLine(p[0], p[1], g) < 0.5;
          if (!other && !line) {
            dead++;
            continue;
          }
          // At about a right angle: compare with the other street's direction there.
          const seg = other ? other.segs.find(through) || other.segs.find((g) => distToLine(p[0], p[1], g) < 0.5) : null;
          let dir = null;
          if (seg) dir = [seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]];
          else {
            for (let i = 0; i < line.length - 1 && !dir; i++) if (distToLine(p[0], p[1], [line[i], line[i + 1]]) < 0.5) dir = [line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]];
          }
          const u = [q[0] - p[0], q[1] - p[1]];
          const cos = Math.abs(u[0] * dir[0] + u[1] * dir[1]) / (Math.hypot(...u) * Math.hypot(...dir) || 1);
          if (cos > 0.55) oblique++;
        }
      }
    }
    assert.equal(dead, 0, `${d.key}: ${dead} local street ends meet nothing`);
    assert.ok(oblique <= ends * 0.03, `${d.key}: ${oblique} of ${ends} local street ends meet another street at a slant`);
  }
});

test('plots fill their blocks, front their streets, and are sound shapes', () => {
  let blocksSeen = 0;
  const offBlocks = [];
  let plots = 0;
  let sharp = 0;
  const widths = { perimeter: [], rowhouse: [] };
  for (const d of districts.slice(0, 2)) {
    for (const k of blocksOf(d).blocks) {
      if (!k.plots || !['perimeter', 'rowhouse', 'podium'].includes(k.use)) continue;
      // Plots and courtyard together are the block (less the odd yard, where
      // a lobe of the block is too narrow for the courtyard to reach).
      // (and the footpath down a rowhouse block's middle).
      let alley = 0;
      for (let i = 1; k.alley && i < k.alley.length; i++) alley += Math.hypot(k.alley[i][0] - k.alley[i - 1][0], k.alley[i][1] - k.alley[i - 1][1]) * ALLEY;
      const sum = k.plots.reduce((s, p) => s + polygonArea(p.pts), 0) + (k.inner ? polygonArea(k.inner) : 0) + alley;
      blocksSeen++;
      if (Math.abs(sum - k.area) > k.area * 0.05) offBlocks.push(`a ${k.use} block in ${d.key} is ${((100 * sum) / k.area).toFixed(0)}% plots`);
      for (const p of k.plots) {
        plots++;
        if (p.kind !== 'passage' && minCorner(p.pts) < 30) sharp++;
        if (widths[p.kind]) widths[p.kind].push(p.front);
      }
    }
  }
  // (Plots joined into one building may lose a sliver between them.)
  assert.ok(offBlocks.length <= blocksSeen * 0.01, offBlocks.join('; '));
  assert.ok(sharp <= plots * 0.01, `${sharp} of ${plots} plots have a corner under 30°`);
  const median = (l) => l.sort((a, b) => a - b)[l.length >> 1];
  // Terraced houses about 5 to 8 m wide; flats over shops and blocks of flats wider.
  assert.ok(median(widths.rowhouse) > 5 && median(widths.rowhouse) < 8, `houses ${median(widths.rowhouse).toFixed(1)} m wide`);
  assert.ok(median(widths.perimeter) > 11 && median(widths.perimeter) < 24, `perimeter plots ${median(widths.perimeter).toFixed(1)} m wide`);
});

test('perimeter blocks are several buildings, with a gap on every street', () => {
  let n = 0;
  let miss = 0;
  for (const d of districts.slice(0, 2)) {
    for (const b of blocksOf(d).blocks) {
      if (b.use !== 'perimeter' || !b.inner || !b.plots) continue;
      const gaps = b.plots.filter((p) => p.kind === 'passage');
      assert.ok(gaps.length >= 2, `${d.key}: a perimeter block with ${gaps.length} gaps`);
      for (const g of gaps) assert.ok(g.front >= 4, `${d.key}: a gap ${g.front.toFixed(1)} m wide`);
      // Each street the block fronts for 40 m or more has a gap.
      const run = new Map();
      for (let i = 0; i < b.pts.length; i++) {
        const q = b.pts[(i + 1) % b.pts.length];
        const l = Math.hypot(q[0] - b.pts[i][0], q[1] - b.pts[i][1]);
        run.set(b.fronts[i], (run.get(b.fronts[i]) || 0) + l);
      }
      const faced = new Set(gaps.map((g) => g.faces));
      for (const [f, l] of run) {
        if (l < 40 || f === 'park' || f === 'greenway') continue;
        n++;
        if (!faced.has(f)) miss++;
      }
    }
  }
  assert.ok(miss <= n * 0.01, `${miss} of ${n} street frontages of 40 m or more have no gap`);
});

test('plots in a rectangular block are cut square', () => {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const rectness = (N) => {
    let best = Infinity;
    for (let i = 0; i < N.length; i++) {
      const e = sub(N[(i + 1) % N.length], N[i]);
      const l = Math.hypot(...e);
      if (l < 1) continue;
      const u = [e[0] / l, e[1] / l];
      let [a, b, c, e2] = [Infinity, -Infinity, Infinity, -Infinity];
      for (const p of N) {
        const x = p[0] * u[0] + p[1] * u[1];
        const y = -p[0] * u[1] + p[1] * u[0];
        [a, b, c, e2] = [Math.min(a, x), Math.max(b, x), Math.min(c, y), Math.max(e2, y)];
      }
      best = Math.min(best, (b - a) * (e2 - c));
    }
    return Math.abs(polygonArea(N)) / best;
  };
  let n = 0;
  let bad = 0;
  for (const d of districts.slice(0, 2)) {
    for (const b of blocksOf(d).blocks) {
      if (!b.plots || b.plots.length < 2 || rectness(b.pts) < 0.9) continue;
      for (const p of b.plots) {
        if (p.corner || p.kind === 'passage') continue;
        n++;
        for (let i = 0; i < p.pts.length; i++) {
          const a = sub(p.pts[i], p.pts[(i - 1 + p.pts.length) % p.pts.length]);
          const c = sub(p.pts[(i + 1) % p.pts.length], p.pts[i]);
          const t = (Math.abs(Math.atan2(a[0] * c[1] - a[1] * c[0], a[0] * c[0] + a[1] * c[1])) * 180) / Math.PI;
          if (t > 30 && t < 150 && Math.abs(90 - t) > 12) {
            bad++;
            break;
          }
        }
      }
    }
  }
  assert.ok(bad <= n * 0.01, `${bad} of ${n} plots in rectangular blocks cut aslant`);
});

test('rowhouse neighbourhoods are rowhouses, with footpaths behind the gardens', () => {
  for (const d of districts.slice(0, 2)) {
    const b = blocksOf(d);
    for (const h of d.stage3.hoods) {
      const mine = b.blocks.filter((k) => k.hood === h.id);
      const row = mine.filter((k) => k.use === 'rowhouse');
      if (h.character === 'rowhouses') {
        // Off the main streets, rowhouses.
        const off = mine.filter((k) => (k.use === 'perimeter' || k.use === 'rowhouse') && !k.front);
        assert.ok(row.length >= off.length * 0.9, `${h.key}: ${row.length} of ${off.length} blocks off the main streets are rowhouses`);
        assert.ok(row.filter((k) => k.alley).length >= row.length * 0.7, `${h.key}: few rowhouse blocks have a footpath down the middle`);
      } else assert.equal(row.length, 0, `${h.key}: rowhouses in a ${h.character} neighbourhood`);
    }
  }
});

test('a building is one height', () => {
  for (const d of districts.slice(0, 2)) {
    const by = new Map();
    for (const k of blocksOf(d).blocks) {
      for (const p of k.plots || []) {
        if (!p.group || !p.bldg || p.bldg.tower) continue;
        if (!by.has(p.group)) by.set(p.group, new Set());
        by.get(p.group).add(p.bldg.h.toFixed(2));
      }
    }
    const mixed = [...by.values()].filter((s) => s.size > 1).length;
    assert.equal(mixed, 0, `${d.key}: ${mixed} buildings with more than one height`);
  }
});
