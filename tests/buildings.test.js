// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedFromText } from '../src/core/hash.js';
import { createWorld } from '../src/world/districts.js';
import { polygonArea, pointInPolygon } from '../src/util/geom.js';
import { STYLES } from '../src/world/architecture.js';

const world = createWorld(seedFromText('1'));
const districts = world.districtsInRect(3000, 3000, 5500, 5500).slice(0, 2);
const plotsOf = (d) => world.blocks(d).blocks.flatMap((b) => (b.plots || []).map((p) => ({ p, b })));

test('every home and shop stands in a building on its own plot', () => {
  for (const d of districts) {
    for (const { p } of plotsOf(d)) {
      if (p.dwellings > 0 || p.ground) assert.ok(p.bldg, `${d.key}: a ${p.cls} plot with no building`);
      if (!p.bldg || p.bldg.landmark === 'cathedral') continue;
      // The footprint lies within the plot (a little give for rounding).
      const inside = p.bldg.pts.filter(([x, y]) => pointInPolygon(x, y, p.pts)).length;
      assert.ok(inside >= p.bldg.pts.length * 0.5 || polygonArea(p.bldg.pts) <= polygonArea(p.pts) * 1.02, `${d.key}: a building outside its plot`);
      assert.ok(polygonArea(p.bldg.pts) <= polygonArea(p.pts) * 1.02, `${d.key}: a building bigger than its plot`);
    }
  }
});

test('heights are those of a mid-rise city, with towers only in the core', () => {
  for (const d of districts) {
    const hs = [];
    let towers = 0;
    for (const { p } of plotsOf(d)) {
      if (!p.bldg || p.bldg.landmark) continue;
      hs.push(p.bldg.h);
      if (p.bldg.tower) {
        towers++;
        assert.equal(p.cls, 'podium', `${d.key}: a tower outside the core`);
      }
    }
    hs.sort((a, b) => a - b);
    const median = hs[hs.length >> 1];
    assert.ok(median > 9 && median < 28, `${d.key}: median height ${median.toFixed(1)} m`);
    assert.ok(towers < 60, `${d.key}: ${towers} towers`);
  }
});

test('mostly traditional styles, modern for schools, hospitals and towers', () => {
  for (const d of districts) {
    const count = {};
    let n = 0;
    for (const { p } of plotsOf(d)) {
      const b = p.bldg;
      if (!b) continue;
      assert.ok(STYLES[b.style], `${d.key}: unknown style ${b.style}`);
      if (b.landmark === 'elementarySchool' || b.landmark === 'secondarySchool' || b.landmark === 'hospital') assert.equal(b.style, 'modern');
      if (b.tower) assert.equal(b.tower.style, 'tower');
      count[b.style] = (count[b.style] || 0) + 1;
      n++;
    }
    const modern = (count.modern || 0) + (count.tower || 0);
    assert.ok(modern < n * 0.25, `${d.key}: ${((100 * modern) / n).toFixed(0)}% modern`);
  }
});

test('a cathedral by a square, and churches with spires', () => {
  for (const d of districts) {
    const all = plotsOf(d);
    const cathedrals = all.filter(({ p }) => p.bldg && p.bldg.landmark === 'cathedral');
    assert.equal(cathedrals.length, 1, `${d.key}: ${cathedrals.length} cathedrals`);
    assert.ok(cathedrals[0].p.bldg.spire, `${d.key}: a cathedral with no spire`);
    const churches = all.filter(({ p }) => p.dedicated === 'church');
    assert.ok(churches.every(({ p }) => p.bldg && p.bldg.spire), `${d.key}: a church with no spire`);
  }
});
