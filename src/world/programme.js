// Stage 4, third part: what each plot is for, following the urban design
// guide.
//
// Plots facing main streets, boulevards, pedestrian streets and squares are
// mixed use: a shop floor along the pavement, offices or studios above,
// homes over that. Off the main streets the shop floors are quieter, and
// only some plots have one (corners most of all); in rowhouse areas only
// corner shops. Podium plots in the core have shops below and offices and
// homes above.
//
// Each neighbourhood gets its square with a market, its park, a secondary
// school, two elementary schools, a community centre, an inn, places of
// worship (in about Toronto's mix), and the list of shops, food, services,
// health, entertainment and arts along its main street out from the square.
// About one neighbourhood in three is a subdistrict centre (library, fire
// station, recreation centre, performing arts, cinema...), those with metro
// stations first, and the core takes
// the district's own (hotels, office towers, department store, courthouse,
// hospitals nearby...). Then every home is put within about 400 m of each
// everyday need (grocery, convenience store, café, bank, gym, daycare,
// clinic, pharmacy), and rowhouse areas get their parkettes. What is left of
// the main streets fills from the high street mix.

import { rngFor } from '../core/rng.js';
import { hash, toUnit } from '../core/hash.js';
import { keyInts } from './cores.js';
import { polygonArea, signedArea } from '../util/geom.js';
import {
  USES, EVERYDAY, EVERYDAY_REACH, NEIGHBOURHOOD_LIST, HIGH_STREET_MIX, UPSTAIRS_MIX, OFFICE_MIX, CORNER_MIX, WORSHIP_MIX,
  DISTRICT_LIST, SUBDISTRICT_LIST, MIN_PLOT,
} from './uses.js';

const WORSHIP_PER_HOOD = 3;
const OLD_TOWN_MUSEUMS = 2; // besides the district's own, there too
const OLD_TOWN_HOTELS = 6;
const OLD_TOWN_USES = new Set(['museum', 'gallery', 'districtLibrary']);
const OFFICE_LIST = 12; // floors of an office tower whose tenants are listed
const FLAGSHIP_HOTELS = 3; // the business district's, besides the district's own
const OBSERVATION_BLOCK = [3000, 16000]; // m²: the observation tower's block, its plaza round it
const OBSERVATION_REACH = 450; // metres from the station, about
const OFFICE_TOWERS = 0.5; // of the business district's towers, those of offices (the rest flats)
const CENTRE_PARKETTE_EVERY = 10; // podium blocks to a parkette, at most
const CENTRE_GREEN_REACH = 220; // metres: in a district's core, a park, green or parkette within this of every block
const ELEMENTARY_PER_HOOD = 2;
const SCHOOL_BLOCK = [0.3e4, 1.3e4]; // m², net: a block an elementary school takes
const HOSPITAL_BLOCK = [1.0e4, 3.5e4];
const CATHEDRAL_BLOCK = [0.45e4, 1.8e4];
// m², a cathedral's block, beside a square
const REC_BLOCK = [0.5e4, 1.6e4];
const WHOLE_BLOCK = 1500; // m²: a building of its own this big takes a whole block if it can...
const WHOLE_MAX = 4; // ...one up to this many times its size
const JOIN_STEPS = 5;
const LOUD = new Set(['pub', 'liveMusic', 'nightclub', 'restaurant', 'karaoke', 'arcade', 'comedy']); // kept to the main streets
const JOINABLE = new Set(['main', 'corner', 'unit', 'house', 'rowCorner', 'unitShop', 'cornerShop']); // plots a building of its own may take in
const WORSHIP_PLOT = 600; // m²: what a place of worship looks for // plots each way along a block a building of its own may take in
const PARKETTE_WALK = 400; // metres: three parkettes within this of every rowhouse
const PARKETTE_GAP = 210; // metres between parkettes in rowhouse areas (about four within 400 m)
const SUBDISTRICT_HOODS = 3; // neighbourhoods to a subdistrict centre
const QUIET_UNITS = 0.3; // share of off-main perimeter plots with a shop floor
const CORNER_UNITS = 0.7; // ... of off-main perimeter corner plots
const CORNER_SHOPS = 0.45; // ... of rowhouse end plots

// Buildings by plot class: usual storeys, their range, the depth of the
// building from the street where the plot runs deeper (rowhouse gardens).
const HEIGHTS = {
  main: { base: 6, storeys: [3, 10] },
  unit: { base: 5, storeys: [3, 9] },
  unitShop: { base: 5, storeys: [3, 9] },
  corner: { base: 5, storeys: [3, 9] },
  podium: { base: 7, storeys: [4, 10] }, // a core building without a tower: shops, offices, flats above
  podiumTower: { base: 22, storeys: [8, 40], tower: true }, // a podium of shops and offices with a tower of flats over it
  house: { base: 3, storeys: [2, 5], depth: 15, house: true },
  rowCorner: { base: 3, storeys: [2, 5], depth: 15, house: true },
  cornerShop: { base: 3, storeys: [2, 5], depth: 15, house: true },
};
export const PODIUM_STOREYS = 5; // a tower's podium
const TOWER_SHARE = 0.8; // of the core's buildings by the station, those with a tower
const TOWER_SITE = 1100; // m²: the least a building needs for a tower
const PODIUM_RANGE = [4, 6]; // storeys of a tower's podium: a floor of shops, the rest offices
export const TOWER_PLATE = 650; // m², a residential tower's floor
const DWELLING = 85; // m² of floor to a home, walls and stairs included
const NET_SHARE = 0.85; // of a floor, the share that is homes (the rest stairs, halls)
const HOUSEHOLD = 2.1; // people to a flat
const HOUSEHOLD_HOUSE = 2.7; // ... to a house

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);

function centroid(pts) {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

function pick(mix, rng) {
  let total = 0;
  for (const [, w] of mix) total += w;
  let r = rng.next() * total;
  for (const [k, w] of mix) {
    r -= w;
    if (r <= 0) return k;
  }
  return mix[mix.length - 1][0];
}

// Two plots side by side as one (the edge between them goes), or null.
function join(A, B) {
  const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const n = A.length;
  const m = B.length;
  const inB = new Map(B.map((p, j) => [key(p), j]));
  const shared = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    const j = inB.get(key(A[(i + 1) % n]));
    if (j !== undefined && key(B[(j + 1) % m]) === key(A[i])) {
      shared[i] = 1;
      any = true;
    }
  }
  if (!any) return null;
  let start = -1;
  for (let i = 0; i < n; i++) if (shared[i] && !shared[(i - 1 + n) % n]) {
    if (start >= 0) return null;
    start = i;
  }
  if (start < 0) return null;
  let end = start;
  while (shared[(end + 1) % n]) end = (end + 1) % n;
  const out = [];
  for (let i = (end + 1) % n; ; i = (i + 1) % n) {
    out.push(A[i]);
    if (i === start) break;
  }
  const jb = inB.get(key(A[start]));
  const je = inB.get(key(A[(end + 1) % n]));
  for (let j = (jb + 1) % m; j !== je; j = (j + 1) % m) out.push(B[j]);
  return signedArea(out) > 0 ? out : null;
}

export function assignProgramme(seed, d, blocks, planned = null) {
  const rng = rngFor(seed, 'programme', ...keyInts(d.coreInfo));
  const hoods = d.stage3.hoods;
  const S = d.station;

  // ---- Plots, by what they face ----
  const plots = [];
  const squares = blocks.filter((b) => b.use === 'square' && !b.stationPlaza);
  const sqCentre = new Map(squares.map((b) => [b.hood, centroid(b.pts)]));
  const sqCentres = [...sqCentre.values()];
  for (const b of blocks) {
    if (!b.plots) continue;
    b.plots.forEach((p, k) => {
      p.block = b;
      p.index = k;
      p.c = centroid(p.pts);
      p.hood = b.hood;
      p.ground = null;
      p.upper = null;
      p.dedicated = null;
      if (p.kind === 'passage') p.cls = 'passage';
      // (A parkette through a terrace, from the street to the lane.)
      else if (p.kind === 'parkette') {
        p.cls = 'open';
        p.dedicated = 'parkette';
      }
      else if (b.use === 'square' || b.use === 'station') p.cls = 'open';
      else if (['park', 'green', 'school', 'campus'].includes(b.use)) p.cls = 'open';
      else if (p.kind === 'podium') p.cls = 'podium';
      // Facing a main street or a square.
      else if (p.faces === 'main' || p.faces === 'boulevard' || p.faces === 'pedestrian' || sqCentres.some((q) => len(sub(q, p.c)) < 75)) p.cls = 'main';
      else if (p.kind === 'rowhouse') p.cls = p.corner ? 'rowCorner' : 'house';
      else p.cls = p.corner ? 'corner' : 'unit';
      plots.push(p);
    });
  }
  // A grid of plot centres for nearness.
  const G = 100;
  const grid = new Map();
  const cellKey = (x, y) => Math.floor(x / G) * 1e6 + Math.floor(y / G);
  for (const p of plots) {
    const k = cellKey(p.c[0], p.c[1]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  const near = (q, r) => {
    const out = [];
    for (let gx = Math.floor((q[0] - r) / G); gx <= Math.floor((q[0] + r) / G); gx++) {
      for (let gy = Math.floor((q[1] - r) / G); gy <= Math.floor((q[1] + r) / G); gy++) {
        for (const p of grid.get(gx * 1e6 + gy) || []) if (len(sub(p.c, q)) <= r) out.push(p);
      }
    }
    return out;
  };
  const homes = plots.filter((p) => ['main', 'podium', 'house', 'rowCorner', 'corner', 'unit'].includes(p.cls));

  // ---- Whole blocks ----
  const byHood = (use) => new Map(blocks.filter((b) => b.use === use).map((b) => [b.hood, b]));
  const dedicateBlock = (b, use) => {
    b.use = use;
    b.inner = null;
    b.court = null;
    for (const p of b.plots || []) {
      p.cls = 'dedicated';
      p.dedicated = null;
    }
    // One building on the whole block.
    b.plots = [{ pts: b.pts, area: b.area, kind: 'dedicated', cls: 'dedicated', dedicated: use, block: b, c: centroid(b.pts), hood: b.hood }];
    plots.push(b.plots[0]);
  };
  for (const b of blocks) {
    if (!b.plots) continue;
    if (b.use === 'square') b.plots[0].dedicated = b.stationPlaza ? 'stationPlaza' : b.hood === 0 ? 'districtPlaza' : 'market';
    if (b.use === 'station') b.plots[0].dedicated = 'railStation';
    if (b.use === 'park') b.plots[0].dedicated = 'neighbourhoodPark';
    if (b.use === 'school') b.plots[0].dedicated = 'secondarySchool';
    if (b.use === 'campus') b.plots[0].dedicated = 'college';
  }
  // Elementary schools: two whole small blocks off the main streets, apart.
  for (const h of hoods) {
    const cands = blocks.filter((b) => b.hood === h.id && (b.use === 'perimeter' || b.use === 'rowhouse') && !b.front && b.area >= SCHOOL_BLOCK[0] && b.area <= SCHOOL_BLOCK[1]);
    const chosen = [];
    for (let k = 0; k < ELEMENTARY_PER_HOOD && cands.length; k++) {
      let best = null;
      for (const b of cands) {
        if (chosen.includes(b)) continue;
        const c = centroid(b.pts);
        // The first near the middle of the neighbourhood's people; the next far from it.
        const score = chosen.length ? -Math.min(...chosen.map((o) => len(sub(centroid(o.pts), c)))) : len(sub(c, h.centre));
        if (!best || score < best.score) best = { score, b };
      }
      if (best) chosen.push(best.b);
    }
    for (const b of chosen) dedicateBlock(b, 'elementarySchool');
  }

  // ---- A cathedral ----
  // One to a district: a whole block by the core's square (or the square
  // nearest it), so it fronts open space.
  {
    const core = sqCentre.get(0) || S;
    const squaresNear = squares.slice().sort((x, y) => len(sub(centroid(x.pts), core)) - len(sub(centroid(y.pts), core)));
    const sq = squaresNear[0];
    if (sq) {
      const at = centroid(sq.pts);
      const b = blocks
        .filter((o) => (o.use === 'perimeter' || o.use === 'podium') && o.area >= CATHEDRAL_BLOCK[0] && o.area <= CATHEDRAL_BLOCK[1])
        .map((o) => ({ o, r: len(sub(centroid(o.pts), at)) }))
        .filter((x) => x.r < 260)
        .sort((x, y) => x.r - y.r)[0];
      if (b) dedicateBlock(b.o, 'cathedral');
    }
  }

  // ---- A stadium ----
  // In some districts (more than half), on the block cut for it near the
  // core (see blocks.js).
  for (const b of blocks) if (b.use === 'stadium' && b.plots) dedicateBlock(b, 'stadium');

  // ---- Subdistrict centres ----
  const rest = hoods.filter((h) => !h.core);
  const nSub = Math.max(rest.length >= 2 ? 1 : 0, Math.round(rest.length / SUBDISTRICT_HOODS));
  const subs = [];
  // (Neighbourhoods with a metro station first: a subdistrict's library
  // and the rest are for people from round about.)
  const byMetro = rest.filter((h) => h.metro && h.metro.length);
  while (subs.length < nSub) {
    let best = null;
    const pool = byMetro.some((h) => !subs.includes(h)) ? byMetro : rest;
    for (const h of pool) {
      if (subs.includes(h)) continue;
      const r = Math.min(len(sub(h.centre, S)), ...subs.map((o) => len(sub(o.centre, h.centre))));
      if (!best || r > best.r) best = { r, h };
    }
    subs.push(best.h);
  }

  // ---- Placing a use ----
  const taken = (p, slot) => (slot === 'dedicated' ? p.dedicated || p.ground || p.upper : slot === 'ground' ? p.ground || p.dedicated : p.upper || p.dedicated);
  const put = (p, use, slot) => {
    if (slot === 'dedicated') p.dedicated = use;
    else p[slot] = use;
  };
  // The free slot nearest a point among plots of the given classes.
  // (Searched ring by ring of grid cells outward, stopping once no nearer
  // plot can be left.)
  function nearest(q, classes, slot, reach, filter = () => true) {
    const cx = Math.floor(q[0] / G);
    const cy = Math.floor(q[1] / G);
    let best = null;
    let bd = reach * reach;
    for (let r = 0; r <= Math.ceil(reach / G) + 1; r++) {
      if (best && (r - 1) * G > Math.sqrt(bd)) break;
      for (let gx = cx - r; gx <= cx + r; gx++) {
        const edge = gx === cx - r || gx === cx + r;
        for (let gy = cy - r; gy <= cy + r; gy += edge ? 1 : 2 * r || 1) {
          for (const p of grid.get(gx * 1e6 + gy) || []) {
            if (!classes.includes(p.cls) || taken(p, slot) || !filter(p)) continue;
            const dx = p.c[0] - q[0];
            const dy = p.c[1] - q[1];
            const d2 = dx * dx + dy * dy;
            if (d2 <= bd && (!best || d2 < bd)) {
              bd = d2;
              best = p;
            }
          }
        }
      }
    }
    return best;
  }
  // A dedicated building: a plot big enough, or a plot joined with its neighbour.
  function dedicate(q, use, classes, reach, minArea) {
    // A big building of its own (a museum, a theatre...) takes a whole
    // block of about its size nearby, if one is free.
    const need = Math.max(minArea, MIN_PLOT[use] || 0);
    if (need >= WHOLE_BLOCK) {
      const b = blocks
        .filter((o) => (o.use === 'perimeter' || o.use === 'podium') && o.plots && free(o) && o.area >= need && o.area <= need * WHOLE_MAX && len(sub(centroid(o.pts), q)) < reach)
        .sort((x, y) => len(sub(centroid(x.pts), q)) - len(sub(centroid(y.pts), q)))[0];
      if (b) {
        dedicateBlock(b, use);
        return b.plots[0];
      }
    }
    let best = null;
    for (const p of near(q, reach)) {
      // (A core building whose shops are let may still be given over whole.)
      if (!classes.includes(p.cls) || (p.cls === 'podium' ? p.dedicated : taken(p, 'dedicated'))) continue;
      const r = len(sub(p.c, q));
      const need = Math.max(minArea, MIN_PLOT[use] || 0);
      const fits = reachable(p, need) >= need;
      const score = r + (fits ? 0 : 250);
      if (!best || score < best.score) best = { score, p, fits };
    }
    if (!best) return reach < 1500 ? dedicate(q, use, classes, reach * 1.8, minArea) : null;
    return dedicatePlot(best.p, use, minArea);
  }
  // A neighbour along the block a building of its own may take in: one of
  // the ordinary buildings, nothing given to anything yet.
  const joinable = (o, p) => o && o !== p && JOINABLE.has(o.cls) && !taken(o, 'dedicated') && o.kind !== 'passage';
  // The most land a plot could come to, taking in its neighbours.
  function reachable(p, minArea) {
    let a = polygonArea(p.pts);
    const list = p.block && p.block.plots;
    if (!list) return a;
    for (const dir of [1, -1]) {
      for (let step = 1; step <= JOIN_STEPS && a < minArea; step++) {
        const o = list[(((p.index + dir * step) % list.length) + list.length) % list.length];
        if (!joinable(o, p)) break;
        a += polygonArea(o.pts);
      }
    }
    return a;
  }
  function dedicatePlot(p, use, minArea) {
    minArea = Math.max(minArea, MIN_PLOT[use] || 0);
    if (polygonArea(p.pts) < minArea && p.block && p.block.plots) {
      // Join the plot to its neighbours along the block until big enough:
      // onward first, then back the other way.
      const list = p.block.plots;
      let pts = p.pts;
      for (const dir of [1, -1]) {
        for (let step = 1; step <= JOIN_STEPS && polygonArea(pts) < minArea; step++) {
          const o = list[(((p.index + dir * step) % list.length) + list.length) % list.length];
          if (!joinable(o, p)) break;
          const j = join(pts, o.pts);
          if (!j) break;
          pts = j;
          o.cls = 'merged';
          o.dedicated = use;
        }
      }
      p.pts = pts;
      p.c = centroid(pts);
    }
    p.dedicated = use;
    p.cls = 'dedicated';
    p.ground = null;
    p.upper = null;
    return p;
  }
  // A block nothing has been put on yet.
  const free = (b) => (b.plots || []).every((p) => !p.dedicated && !p.ground && !p.upper);
  const floorOf = (use) => (USES[use].floor === 'upper' ? 'upper' : USES[use].floor === 'dedicated' ? 'dedicated' : 'ground');

  // ---- The old town ----
  // In the city-centre district, the old-town neighbourhood: its square the
  // district plaza with city hall facing it; the main library, museums and
  // the tourist centre in its old buildings, and boutique hotels in its
  // perimeter blocks (no big buildings of their own).
  const oldHood = hoods.find((h) => h.oldTown);
  if (oldHood) {
    const inOld = (p) => p.hood === oldHood.id;
    const sq = blocks.find((b) => b.use === 'square' && b.hood === oldHood.id && b.plots);
    const q = sq ? centroid(sq.pts) : oldHood.centre;
    if (sq) sq.plots[0].dedicated = 'districtPlaza';
    dedicate(q, 'cityHall', ['main', 'corner', 'unit'], 160, MIN_PLOT.cityHall);
    dedicate(oldHood.centre, 'mainLibrary', ['main', 'corner', 'unit'], 350, MIN_PLOT.mainLibrary);
    for (let k = 0; k < OLD_TOWN_MUSEUMS; k++) dedicate(oldHood.centre, 'museum', ['main', 'corner', 'unit'], 400, MIN_PLOT.museum);
    const tc = nearest(oldHood.centre, ['main', 'corner', 'unit'], 'ground', 300, inOld);
    if (tc) put(tc, 'touristCentre', 'ground');
    // (Spread about it.)
    const hotels = [];
    for (let k = 0; k < OLD_TOWN_HOTELS; k++) {
      const p = nearest(oldHood.centre, ['main', 'corner', 'unit'], 'upper', 500, (o) => inOld(o) && hotels.every((x) => len(sub(x.c, o.c)) > 90));
      if (!p) break;
      put(p, 'boutiqueHotel', 'upper');
      hotels.push(p);
    }
  }

  // ---- Each neighbourhood's own ----
  // (A neighbourhood with a park has its community centre built into it.)
  const withPark = new Set(blocks.filter((b) => b.use === 'park').map((b) => b.hood));
  for (const h of hoods) {
    const q = sqCentre.get(h.id) || h.centre;
    for (const [use, count] of NEIGHBOURHOOD_LIST) {
      if (use === 'communityCentre' && withPark.has(h.id)) continue;
      for (let k = 0; k < count; k++) {
        const slot = floorOf(use);
        if (slot === 'dedicated') {
          const size = use === 'communityCentre' ? 800 : use === 'inn' ? 450 : 400;
          dedicate(q, use, use === 'inn' ? ['main'] : ['main', 'corner', 'unit'], 700, size);
        } else {
          // (Along its main streets; failing that, on a corner near its square,
          // but for what is loud at night: only on a main street.)
          const p = nearest(q, ['main', 'podium'], slot, 900, (o) => o.hood === h.id) || (LOUD.has(use) ? null : nearest(q, ['corner', 'unit'], slot, 700, (o) => o.hood === h.id)) || nearest(q, ['main', 'podium'], slot, 1400);
          if (p) put(p, use, slot);
        }
      }
    }
    // Places of worship, spread about the neighbourhood, on corners if they can be.
    const spots = [];
    const own = plots.filter((p) => p.hood === h.id && (p.cls === 'corner' || p.cls === 'rowCorner' || p.cls === 'main'));
    for (let k = 0; k < WORSHIP_PER_HOOD && own.length; k++) {
      let best = null;
      for (const p of own) {
        if (taken(p, 'dedicated')) continue;
        // Away from the square and from each other; corners first.
        const r = Math.min(len(sub(p.c, q)) * 0.6 + 120, ...spots.map((o) => len(sub(o, p.c))));
        const score = r + (p.cls === 'main' ? 0 : 80) + toUnit(hash(seed, 'worship', Math.floor(p.c[0]), Math.floor(p.c[1]))) * 60 - (reachable(p, WORSHIP_PLOT) >= WORSHIP_PLOT ? 0 : 200);
        if (!best || score > best.score) best = { score, p };
      }
      if (!best) break;
      spots.push(best.p.c);
      dedicatePlot(best.p, pick(WORSHIP_MIX, rng), 500);
    }
  }
  for (const h of subs) {
    const q = sqCentre.get(h.id) || h.centre;
    for (const [use, count, how] of SUBDISTRICT_LIST) {
      for (let k = 0; k < count; k++) {
        if (how === 'large') {
          const b = blocks
            .filter((o) => (o.use === 'perimeter' || o.use === 'rowhouse') && free(o) && o.area >= REC_BLOCK[0] && o.area <= REC_BLOCK[1])
            .sort((x, y) => len(sub(centroid(x.pts), q)) - len(sub(centroid(y.pts), q)))[0];
          if (b && len(sub(centroid(b.pts), q)) < 900) dedicateBlock(b, use);
        } else if (how === 'dedicated') {
          // (A fire station on a main street if one is free, else round the corner.)
          const p = dedicate(q, use, use === 'fireStation' ? ['main'] : ['main', 'corner'], 700, use === 'performingArts' ? 1500 : 700);
          if (!p && use === 'fireStation') dedicate(q, use, ['corner', 'unit'], 700, 700);
        } else {
          const p = nearest(q, ['main', 'podium'], how, 900);
          if (p) put(p, use, how);
        }
      }
    }
  }

  // ---- The business district ----
  // The city-centre district's core: the city's convention centre, and its
  // observation tower on a block of its own, a plaza all round it.
  const coreHood = hoods.find((h) => h.core);
  if (oldHood && coreHood) {
    dedicate(S, 'conventionCentre', ['podium'], 800, MIN_PLOT.conventionCentre);
    const site = blocks
      .filter((b) => b.use === 'podium' && b.plots && b.hood === coreHood.id && free(b) && b.area >= OBSERVATION_BLOCK[0] && b.area <= OBSERVATION_BLOCK[1])
      .sort((x, y) => Math.abs(len(sub(centroid(x.pts), S)) - OBSERVATION_REACH) - Math.abs(len(sub(centroid(y.pts), S)) - OBSERVATION_REACH))[0];
    if (site) dedicateBlock(site, 'observationTower');
  }

  // ---- More green in the core ----
  // A district's core has few courtyards: a parkette (a small block given
  // over to green) wherever a block is far from any park or green.
  if (coreHood) {
    const greens = blocks.filter((b) => b.pts && ['park', 'green', 'parkette', 'campus'].includes(b.use)).map((b) => centroid(b.pts));
    const own = blocks.filter((b) => b.use === 'podium' && b.plots && b.hood === coreHood.id);
    // (Nearest the station first, so its own are seen to.)
    own.sort((x, y) => len(sub(centroid(x.pts), S)) - len(sub(centroid(y.pts), S)));
    let room = Math.floor(own.length / CENTRE_PARKETTE_EVERY);
    for (const b of own) {
      const c = centroid(b.pts);
      if (room <= 0) break;
      if (b.use !== 'podium' || greens.some((g) => len(sub(g, c)) < CENTRE_GREEN_REACH)) continue;
      // The smallest free block near it.
      const pk = own
        .filter((o) => o.use === 'podium' && free(o) && len(sub(centroid(o.pts), c)) < CENTRE_GREEN_REACH * 0.6)
        .sort((x, y) => x.area - y.area)[0];
      if (!pk) continue;
      dedicateBlock(pk, 'parkette');
      room--;
      pk.plots[0].cls = 'open';
      greens.push(centroid(pk.pts));
    }
  }

  // ---- The district's own ----
  const coreAt = sqCentre.get(0) || S;
  const twoOrThree = toUnit(hash(seed, 'district-share', ...keyInts(d.coreInfo)));
  const extra = [];
  if (twoOrThree < 0.4) extra.push(['departmentStore', 1, 'core']);
  if (twoOrThree > 0.6) extra.push(['courthouse', 1, 'core']);
  if (oldHood) extra.push(['hotel', FLAGSHIP_HOTELS, 'core']);
  for (const [use, count, where] of DISTRICT_LIST.concat(extra)) {
    // (In the city-centre district, the museums, galleries and library
    // are the old town's.)
    const core = oldHood && OLD_TOWN_USES.has(use) ? oldHood.centre : coreAt;
    for (let k = 0; k < count; k++) {
      const slot = floorOf(use);
      if (where === 'large') {
        // Hospitals: whole blocks near the core, on the campus if there is one.
        const campus = hoods.find((h) => h.campus);
        const q = campus ? campus.centre : core;
        const b = blocks
          .filter((o) => (o.use === 'perimeter' || o.use === 'podium' || o.use === 'rowhouse') && free(o) && o.area >= HOSPITAL_BLOCK[0] && o.area <= HOSPITAL_BLOCK[1])
          .sort((x, y) => len(sub(centroid(x.pts), q)) - len(sub(centroid(y.pts), q)))[0];
        if (b) dedicateBlock(b, use);
      } else if (where === 'quiet') {
        const a = rng.next() * Math.PI * 2;
        const at = [S[0] + Math.cos(a) * 900, S[1] + Math.sin(a) * 900];
        dedicate(at, use, ['corner', 'unit'], 1200, 600);
      } else if (where === 'any') {
        const a = rng.next() * Math.PI * 2;
        const at = [S[0] + Math.cos(a) * 700, S[1] + Math.sin(a) * 700];
        dedicate(at, use, ['main', 'corner', 'podium'], 1200, 1200);
      } else if (slot === 'dedicated') {
        // Towers and big stores among the podiums; the old civic buildings
        // in the old town round the square.
        const modern = use === 'officeTower' || use === 'hotel' || use === 'departmentStore';
        dedicate(core, use, modern ? ['podium'] : ['podium', 'main', 'corner', 'unit'], 700, modern ? 900 : 1200);
      } else {
        const p = nearest(core, ['podium', 'main'], slot, 800);
        if (p) put(p, use, slot);
      }
    }
  }

  // ---- Everyday needs, within reach of every home ----
  const covered = new Map(EVERYDAY.map((u) => [u, new Set()]));
  for (const p of plots) {
    for (const u of EVERYDAY) if (p.ground === u || p.upper === u) for (const o of near(p.c, EVERYDAY_REACH)) covered.get(u).add(o);
  }
  // Homes in a fixed order of their own, so the result never depends on visiting order.
  const order = homes.slice().sort((a, b) => toUnit(hash(seed, 'everyday', Math.floor(a.c[0]), Math.floor(a.c[1]))) - toUnit(hash(seed, 'everyday', Math.floor(b.c[0]), Math.floor(b.c[1]))));
  for (const u of EVERYDAY) {
    const slot = floorOf(u);
    const set = covered.get(u);
    for (const h of order) {
      if (set.has(h)) continue;
      // Best on a main street close by, else a corner unit close by.
      const p = nearest(h.c, ['main', 'podium'], slot, EVERYDAY_REACH * 0.9) || nearest(h.c, ['corner', 'rowCorner', 'unit'], slot, EVERYDAY_REACH * 0.9);
      if (!p) continue;
      put(p, u, slot);
      if (p.cls === 'rowCorner' || p.cls === 'unit') p.cls = p.cls === 'unit' ? 'unitShop' : 'cornerShop';
      for (const o of near(p.c, EVERYDAY_REACH)) set.add(o);
    }
  }

  // ---- Parkettes in rowhouse areas ----
  const parkettes = [];
  const rowPlots = plots.filter((p) => p.cls === 'house' || p.cls === 'rowCorner');
  rowPlots.sort((a, b) => toUnit(hash(seed, 'parkette', Math.floor(a.c[0]), Math.floor(a.c[1]))) - toUnit(hash(seed, 'parkette', Math.floor(b.c[0]), Math.floor(b.c[1]))));
  for (const p of rowPlots) {
    if (taken(p, 'dedicated') || parkettes.some((o) => len(sub(o.c, p.c)) < PARKETTE_GAP)) continue;
    // A linear park two houses wide, or a corner lot with a playground.
    if (p.cls === 'house') {
      const o = p.block.plots[p.index + 1];
      if (o && o.cls === 'house' && !taken(o, 'dedicated')) {
        const j = join(p.pts, o.pts);
        if (j) {
          p.pts = j;
          p.c = centroid(j);
          o.cls = 'merged';
          o.dedicated = 'parkette';
        }
      }
    }
    p.dedicated = 'parkette';
    p.cls = 'open';
    parkettes.push(p);
  }
  // Then every house has three within a five-minute walk (counting those
  // through the terraces): one more on the nearest free plot to any short.
  {
    const all = plots.filter((p) => p.dedicated === 'parkette' && p.cls !== 'merged').map((p) => p.c);
    const count = (q) => all.filter((c) => len(sub(c, q)) <= PARKETTE_WALK).length;
    for (const h of plots.filter((p) => p.kind === 'rowhouse')) {
      if (h.dedicated || h.cls === 'merged' || count(h.c) >= 3) continue;
      let best = null;
      for (const p of rowPlots) {
        if (p.dedicated || p.cls === 'merged' || taken(p, 'dedicated')) continue;
        const r = len(sub(p.c, h.c));
        if (r < PARKETTE_WALK * 0.8 && (!best || r < best.r)) best = { r, p };
      }
      if (!best) continue;
      best.p.dedicated = 'parkette';
      best.p.cls = 'open';
      parkettes.push(best.p);
      all.push(best.p.c);
    }
  }

  // ---- The rest of the shop floors ----
  for (const p of plots) {
    if (p.dedicated || p.cls === 'merged') continue;
    if (p.cls === 'main' || p.cls === 'podium') {
      if (!p.ground) p.ground = pick(HIGH_STREET_MIX, rng);
      if (!p.upper) p.upper = pick(UPSTAIRS_MIX, rng);
    } else if (p.cls === 'corner' && !p.ground && rng.next() < CORNER_UNITS) {
      p.ground = pick(CORNER_MIX, rng);
    } else if (p.cls === 'unit' && !p.ground && rng.next() < QUIET_UNITS) {
      p.ground = pick(CORNER_MIX, rng);
    } else if (p.cls === 'rowCorner' && !p.ground && rng.next() < CORNER_SHOPS) {
      p.ground = pick(CORNER_MIX.slice(0, 8), rng);
      p.cls = 'cornerShop';
    }
  }
  // Joined-away plots go.
  for (const b of blocks) if (b.plots) b.plots = b.plots.filter((p) => p.cls !== 'merged');

  // ---- Homes ----
  // Storeys by building, then raised or lowered (within each kind's range)
  // until each neighbourhood houses about the people it was planned for.
  // Each building rounds up or down by its own share, so heights vary from
  // one to the next and the average can sit between whole storeys.
  const live = plots.filter((p) => p.cls !== 'merged' && !p.dedicated && HEIGHTS[p.cls]);
  // Plots are built as buildings: a run of plots between two gaps round a
  // courtyard is one building, as is each terrace of houses; a building has
  // one height, whatever is on its ground floor.
  const groups = new Map();
  blocks.forEach((b, bi) => {
    if (!b.plots) return;
    let g = 0;
    const ids = [];
    for (const p of b.plots) {
      let id = null;
      if (p.cls === 'passage' || p.dedicated || !HEIGHTS[p.cls]) g++;
      else if (p.row !== undefined) id = `${bi}:r${p.row}`;
      else if (!b.inner) id = `${bi}:s${p.index}`;
      else id = `${bi}:${g}`;
      ids.push(id);
    }
    // Round a courtyard the last run joins the first (no gap between them).
    if (b.inner && ids.length > 1 && ids[0] && ids[ids.length - 1] && ids[0] !== ids[ids.length - 1]) {
      const last = ids[ids.length - 1];
      for (let k = 0; k < ids.length; k++) if (ids[k] === last) ids[k] = ids[0];
    }
    b.plots.forEach((p, k) => {
      p.group = ids[k];
      if (!ids[k] || !live.includes(p)) return;
      if (!groups.has(ids[k])) groups.set(ids[k], []);
      groups.get(ids[k]).push(p);
    });
  });
  const groupList = [...groups.values()];
  for (const list of groupList) {
    const q = list[0].c;
    list.dither = toUnit(hash(seed, 'storeys', Math.floor(q[0] * 4), Math.floor(q[1] * 4)));
    // Its range: what every plot in it allows; a tower site stays its own.
    list.hood = list[0].hood;
  }
  // A corner of the core may carry a tower; its floors above the podium
  // are a tower's floor plate, not the whole plot.
  // (Most near the station, fewer towards the edge of the core.)
  for (const p of live) {
    const t = Math.min(1, len(sub(p.c, S)) / (d.coreReach * 1.25));
    p.towerSite = p.cls === 'podium' && polygonArea(p.pts) >= TOWER_SITE && toUnit(hash(seed, 'tower', Math.floor(p.c[0]), Math.floor(p.c[1]))) < TOWER_SHARE * (1 - 0.7 * t);
    // (In the business district, many towers are offices: head offices.)
    p.officeTower = p.towerSite && !!oldHood && toUnit(hash(seed, 'office-tower', Math.floor(p.c[0]), Math.floor(p.c[1]))) < OFFICE_TOWERS;
  }
  const heightsOf = (p) => (p.towerSite ? HEIGHTS.podiumTower : HEIGHTS[p.cls]);
  const people = (p) => {
    const H = heightsOf(p);
    const footprint = H.depth ? Math.min(polygonArea(p.pts), p.front * H.depth || polygonArea(p.pts)) : polygonArea(p.pts);
    const homesFloors = Math.max(0, p.storeys - (p.ground ? 1 : 0) - (p.upper ? 1 : 0));
    // (A tower's homes are all in the tower; its podium is shops and offices.)
    if (p.officeTower) return (p.dwellings = 0);
    const floorArea = H.tower ? Math.min(footprint, TOWER_PLATE) * Math.max(0, p.storeys - (p.baseStoreys || PODIUM_STOREYS)) : footprint * homesFloors;
    // A house of three storeys or more is split into flats (a plex).
    const dwellings = H.house ? Math.max(1, Math.min(3, p.storeys - (p.ground ? 1 : 0) - 1)) : Math.floor((floorArea * NET_SHARE) / DWELLING);
    p.dwellings = dwellings;
    return dwellings * (H.house ? (dwellings > 1 ? HOUSEHOLD : HOUSEHOLD_HOUSE) : HOUSEHOLD);
  };
  const built = new Map();
  for (const h of hoods) {
    const mine = groupList.filter((list) => list.hood === h.id);
    let f = 1;
    for (let round = 0; round < 12; round++) {
      let total = 0;
      for (const list of mine) {
        // One height for the building: from its plots' usual heights, within
        // the range all of them allow.
        let base = 0;
        let lo = 0;
        let hi = 99;
        for (const p of list) {
          const H = heightsOf(p);
          base += H.base / list.length;
          lo = Math.max(lo, H.storeys[0]);
          hi = Math.min(hi, H.storeys[1]);
        }
        const n = Math.max(lo, Math.min(Math.max(lo, hi), Math.floor(base * f + list.dither)));
        for (const p of list) {
          if (p.towerSite) {
            p.baseStoreys = PODIUM_RANGE[0] + Math.floor(list.dither * (PODIUM_RANGE[1] - PODIUM_RANGE[0] + 1));
            p.storeys = Math.max(HEIGHTS.podiumTower.storeys[0], Math.min(HEIGHTS.podiumTower.storeys[1], Math.floor(HEIGHTS.podiumTower.base * f + list.dither * 6)));
          } else {
            p.baseStoreys = n;
            p.storeys = n;
          }
          total += people(p);
        }
      }
      built.set(h.id, total);
      if (!total) break;
      const want = (planned ? planned[h.id] : h.population) / total;
      if (Math.abs(want - 1) < 0.03) break;
      f *= want;
    }
  }
  // A core building's podium holds many businesses, not one: shops round
  // its ground floor, a frontage each, and several firms to each floor of
  // offices above.
  for (const p of live) {
    if (p.cls !== 'podium') continue;
    const r = rngFor(seed, 'tenants', Math.floor(p.c[0]), Math.floor(p.c[1]));
    const perim = p.pts.reduce((a, q, i) => a + len(sub(p.pts[(i + 1) % p.pts.length], q)), 0);
    const shops = Math.max(2, Math.min(14, Math.round(perim / 16)));
    p.shops = [p.ground || pick(HIGH_STREET_MIX, r)];
    while (p.shops.length < shops) p.shops.push(pick(HIGH_STREET_MIX, r));
    // (Under a tower every floor above the shops is offices; otherwise one is.)
    const officeFloors = p.officeTower ? Math.min(OFFICE_LIST, p.storeys - 1) : p.towerSite ? Math.max(1, (p.baseStoreys || PODIUM_STOREYS) - 1) : 1;
    const perFloor = Math.max(2, Math.min(6, Math.round(polygonArea(p.pts) / 450)));
    // (Whatever was put upstairs already, a gym or a clinic, stays among them.)
    p.offices = p.upper ? [p.upper] : [];
    while (p.offices.length < officeFloors * perFloor) p.offices.push(pick(OFFICE_MIX, r));
    p.upper = p.offices[0];
  }
  return { subdistricts: subs.map((h) => h.id), parkettes: parkettes.length, housed: Object.fromEntries(built) };
}
