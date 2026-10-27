// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { seedFromText } from '../src/core/hash.js';
import { createWorld } from '../src/world/districts.js';
import { USES, EVERYDAY, EVERYDAY_REACH, NEIGHBOURHOOD_LIST, MIN_PLOT } from '../src/world/uses.js';
import { polygonArea } from '../src/util/geom.js';

const world = createWorld(seedFromText('1'));
const districts = world.districtsInRect(3000, 3000, 5500, 5500).slice(0, 2);
const plotsOf = (d) => world.blocks(d).blocks.flatMap((b) => b.plots || []);
const near = (a, b, r) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= r;
const has = (p, use) => p.dedicated === use || p.ground === use || p.upper === use || p.also === use;
const homes = (plots) => plots.filter((p) => p.dwellings > 0);

test('every neighbourhood has its square, park, schools and civic buildings', () => {
  for (const d of districts) {
    const plots = plotsOf(d);
    for (const h of d.stage3.hoods) {
      const here = plots.filter((p) => p.hood === h.id);
      const count = (use) => here.filter((p) => has(p, use)).length;
      // (The old town's square is the city-centre district's plaza too.)
      assert.equal(count(h.core || h.oldTown ? 'districtPlaza' : 'market'), 1, `${h.key}: square`);
      if (h.core) continue;
      assert.equal(count('neighbourhoodPark'), 1, `${h.key}: park`);
      assert.equal(count('secondarySchool'), 1, `${h.key}: secondary school`);
      assert.ok(count('elementarySchool') >= 1, `${h.key}: no elementary school`);
      const worship = here.filter((p) => p.dedicated && USES[p.dedicated].cat === 'worship').length;
      assert.ok(worship >= 2, `${h.key}: ${worship} places of worship`);
    }
  }
});

test("each neighbourhood's list is along its main streets, close to its square", () => {
  for (const d of districts) {
    const plots = plotsOf(d);
    const squares = world.blocks(d).blocks.filter((b) => b.use === 'square');
    for (const h of d.stage3.hoods) {
      const sq = squares.find((b) => b.hood === h.id);
      const at = sq ? sq.plots[0].c : h.centre;
      for (const [use] of NEIGHBOURHOOD_LIST) {
        assert.ok(plots.some((p) => has(p, use) && near(p.c, at, 1000)), `${h.key}: no ${USES[use].label.toLowerCase()} within 1 km of its square`);
      }
    }
  }
});

test('every home is around the corner from its everyday needs', () => {
  for (const d of districts) {
    const plots = plotsOf(d);
    const list = homes(plots);
    for (const use of EVERYDAY) {
      const at = plots.filter((p) => has(p, use)).map((p) => p.c);
      let ok = 0;
      for (const p of list) if (at.some((q) => near(q, p.c, EVERYDAY_REACH))) ok++;
      assert.ok(ok >= list.length * 0.98, `${d.key}: only ${((100 * ok) / list.length).toFixed(1)}% of homes within ${EVERYDAY_REACH} m of a ${USES[use].label.toLowerCase()}`);
    }
  }
});

test('quiet streets stay quiet; rowhouse streets have their parkettes', () => {
  const loud = ['pub', 'liveMusic', 'nightclub', 'restaurant', 'karaoke', 'arcade', 'comedy'];
  for (const d of districts) {
    const plots = plotsOf(d);
    for (const p of plots) {
      if (p.cls === 'main' || p.cls === 'podium') continue;
      assert.ok(!loud.includes(p.ground), `${USES[p.ground] && USES[p.ground].label} off a main street in ${d.key}`);
    }
    const houses = plots.filter((p) => p.cls === 'house');
    const parkettes = plots.filter((p) => p.dedicated === 'parkette').map((p) => p.c);
    if (houses.length < 200) continue;
    let ok = 0;
    for (const p of houses) if (parkettes.filter((q) => near(q, p.c, 400)).length >= 3) ok++;
    assert.ok(ok >= houses.length * 0.8, `${d.key}: only ${((100 * ok) / houses.length).toFixed(0)}% of rowhouses have three parkettes within 400 m`);
  }
});

test('subdistrict centres and the district core have their own', () => {
  for (const d of districts) {
    const plots = plotsOf(d);
    const b = world.blocks(d);
    const rest = d.stage3.hoods.length - 1;
    assert.ok(Math.abs(b.programme.subdistricts.length - rest / 3) <= 1, `${d.key}: ${b.programme.subdistricts.length} subdistrict centres for ${rest} neighbourhoods`);
    for (const use of ['library', 'fireStation', 'recCentre', 'performingArts']) {
      assert.ok(plots.filter((p) => has(p, use)).length >= b.programme.subdistricts.length, `${d.key}: too few ${USES[use].label.toLowerCase()}s`);
    }
    for (const use of ['police', 'districtLibrary', 'hotel', 'officeTower', 'hospital', 'museum']) {
      assert.ok(plots.some((p) => has(p, use)), `${d.key}: no ${USES[use].label.toLowerCase()}`);
    }
  }
});

test('the homes built house each neighbourhood about as many people as planned', () => {
  for (const d of districts) {
    const { programme, planned } = world.blocks(d);
    // Moving the boundaries onto streets shifts land, and people, between
    // neighbourhoods, but not in or out of the district.
    const want = d.stage3.hoods.reduce((a, h) => a + h.population, 0);
    const got = Object.values(planned).reduce((a, v) => a + v, 0);
    assert.ok(Math.abs(got / want - 1) < 0.08, `${d.key}: planned for ${want} by stage 3, ${got} by block`);
    for (const h of d.stage3.hoods) {
      const r = programme.housed[h.id] / planned[h.id];
      assert.ok(r > 0.75 && r < 1.25, `${h.key}: planned for ${planned[h.id]}, housing ${programme.housed[h.id]}`);
    }
  }
});

test('big buildings of their own stand on plots big enough for them', () => {
  for (const d of districts) {
    for (const b of world.blocks(d).blocks) {
      for (const p of b.plots || []) {
        const need = MIN_PLOT[p.dedicated];
        if (!need || need < 1500 || p.cls === 'merged') continue;
        assert.ok(polygonArea(p.pts) >= need * 0.9, `${d.key}: a ${p.dedicated} on ${Math.round(polygonArea(p.pts))} m², not ${need}`);
      }
    }
  }
});

test('the old town holds city hall facing its plaza, the main library, museums, the tourist centre and boutique hotels', () => {
  const d = world.cityCores.map((c) => world.district(c)).find((x) => x.stage3.hoods.some((h) => h.oldTown));
  assert.ok(d, 'no old town');
  const h = d.stage3.hoods.find((x) => x.oldTown);
  const here = plotsOf(d).filter((p) => p.hood === h.id);
  const count = (use) => here.filter((p) => has(p, use)).length;
  const plaza = here.find((p) => has(p, 'districtPlaza'));
  const hall = here.find((p) => has(p, 'cityHall'));
  assert.ok(plaza && hall, 'no plaza or city hall');
  assert.ok(near(plaza.c, hall.c, 160), 'city hall is not on the plaza');
  assert.equal(count('mainLibrary'), 1);
  assert.ok(count('museum') >= 2, `${count('museum')} museums`);
  assert.equal(count('touristCentre'), 1);
  assert.ok(count('boutiqueHotel') >= 4, `${count('boutiqueHotel')} boutique hotels`);
});

test('the business district: all podiums, a convention centre, flagship hotels, office towers and an observation tower on its own plaza', () => {
  const d = world.cityCores.map((c) => world.district(c)).find((x) => x.stage3.hoods.some((h) => h.oldTown));
  const core = d.stage3.hoods.find((h) => h.core);
  assert.ok(['Financial District', 'Downtown', 'Business District', 'New Town', 'The City', 'Exchange', 'The Loop'].includes(world.names.hood(d, core)));
  const blocks = world.blocks(d).blocks.filter((b) => b.hood === core.id);
  assert.ok(!blocks.some((b) => b.use === 'rowhouse'), 'rowhouses in the business district');
  assert.equal(blocks.filter((b) => b.use === 'observationTower').length, 1);
  const here = blocks.flatMap((b) => b.plots || []);
  assert.ok(here.some((p) => has(p, 'conventionCentre')), 'no convention centre');
  assert.ok(here.filter((p) => has(p, 'hotel')).length >= 3, 'too few hotels');
  const towers = here.filter((p) => p.towerSite);
  const offices = towers.filter((p) => p.officeTower);
  assert.ok(offices.length > 0 && offices.length < towers.length, `${offices.length} of ${towers.length} towers offices`);
  assert.ok(offices.every((p) => !p.dwellings));
});

test('the city centre has its main courthouse and arts centre on their plazas, a research hospital and embassies', () => {
  const d = world.cityCores.map((c) => world.district(c)).find((x) => x.stage3.hoods.some((h) => h.oldTown));
  const plots = plotsOf(d);
  const one = (use) => plots.filter((p) => has(p, use));
  for (const [use, plaza] of [['mainCourthouse', 'courthousePlaza'], ['mainArts', 'artsPlaza']]) {
    const [b] = one(use);
    const [q] = one(plaza);
    assert.ok(b && q, `no ${use} or ${plaza}`);
    assert.ok(near(b.c, q.c, 230), `${use} is not on its plaza`);
    // (At a neighbourhood with a metro station.)
    const h = d.stage3.hoods.find((x) => x.id === q.hood);
    assert.ok(h.metro && h.metro.length, `${use}'s neighbourhood has no metro station`);
  }
  assert.ok(one('researchHospital').length >= 1, 'no research hospital');
  const embassies = one('embassy');
  assert.ok(embassies.length >= 6, `${embassies.length} embassies`);
});
