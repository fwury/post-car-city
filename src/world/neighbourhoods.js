// Stage 3: neighbourhoods and main streets, worked out per district on a
// raster of its land (inside its greenways, outside its parks).
//
// Each neighbourhood is planned for about 15 000 people, the number its
// shops, schools and services need. Density varies: highest in the mid-rise
// core around the station, a little higher along boulevards, and otherwise
// changing smoothly from rowhouses to perimeter blocks; about one district in
// three also has a campus (university or hospital), which houses fewer
// people for its size. So a district has as many neighbourhoods as its
// people fill, and their areas differ: small where dense, large where not.
//
// The district core is a neighbourhood like any other, grown from the
// station. Where a boulevard runs through the district, neighbourhood
// centres sit on it and the boulevard is their main street. The remaining
// centres are spread by farthest-point sampling and a few Lloyd steps
// (weighted towards where people live), then every neighbourhood is grown
// over a noisy cost field, its spreading slowed or quickened until its
// population is about right, so the shapes come out very irregular. Boundaries are traced once per shared stretch and
// smoothed in a fixed direction, so both sides match exactly.
//
// Main streets (tram, 31 m) are laid out in mainStreets.js as an organic
// grid that takes in the boulevards and crosses the greenways at crossing
// points worked out here from each shared greenway alone, so neighbouring
// districts meet there exactly.

import { hash, hashString, toUnit } from '../core/hash.js';
import { rngFor } from '../core/rng.js';
import { createNoise } from '../core/noise.js';
import { LruCache } from './cache.js';
import { keyInts } from './cores.js';
import { PEOPLE_PER_DISTRICT } from './terrain.js';
import { Heap, isDistrictKey } from './growth.js';
import { createMainStreets } from './mainStreets.js';
import { fill, distanceField, stamp } from '../util/raster.js';
export { MAIN_STREET_REACH } from './mainStreets.js';
import { polygonArea, signedArea, simplify, chaikin, pointInPolygon } from '../util/geom.js';

export const NEIGHBOURHOOD_AREA = 0.75e6; // m², typical
export const NEIGHBOURHOOD_PEOPLE = 15000; // residents a neighbourhood's shops, schools and services are planned for
const DISTRICT_SPREAD = [0.8, 1.2]; // of PEOPLE_PER_DISTRICT a district houses
const DENSITY_SCALE = [0.4, 1]; // the most a district's densities are scaled to house them (a small district is never built denser)
const BASE_DENSITY = 0.0182; // residents per m² of neighbourhood land, before the variations below
const CORE_BOOST = 0.8; // the core is this much denser (mid-rise around the station)...
const CORE_FADE = 900; // ...fading out over about this many metres
const FORM_LOW = 0.55; // housing form: rowhouses and villas at the low end...
const FORM_HIGH = 1.45; // ...mid-rise perimeter blocks at the high end
const FORM_SCALE = 2500; // metres over which the form of housing changes
const BOULEVARD_BOOST = 0.15; // a little denser along a boulevard
const CAMPUS_METRO = 900; // metres from a metro station a campus is sought
const CAMPUS_CHANCE = 0.35; // share of districts with a campus neighbourhood (university, hospital)
const BALANCE_STEPS = 10;
const LLOYD_STEPS = 6; // rounds of moving the free centres to the middle of their people // rounds of evening out populations after the main streets are in
const CAMPUS_SHARE = 0.45; // share of a campus neighbourhood's land that is not housing
export const NEIGHBOURHOODS = [1, 22]; // per district, besides the core (as many as its people fill)
export const RING_MARGIN = 80; // land this close to a district's greenway is the greenway's
const BOULEVARD_SNAP = 140; // metres a metro station's neighbourhood centre may move to sit on its boulevard
export const SPINE_REACH = 450; // metres of its main street either side of a centre a neighbourhood grows from
export const GATEWAY_TWO = 2600; // a shared greenway this long gets two gateways for main streets, else one
const EDGE_END = 400; // crossings keep this far from the ends of a greenway stretch
const EDGE_CLEAR = 380; // and this far from a boulevard crossing
const CELL = 50;
export const ROWHOUSE_DENSITY = 18500; // people per km²: a neighbourhood less dense than this is rowhouses
const NECK = 130; // metres: half the narrowest a neighbourhood may be, away from its middle
const SMOOTH_TOL = 32; // metres of raster staircase removed before smoothing
const OUTSIDE = -1;
const LABELS = 64; // more than the neighbourhoods a district can have (edge keys are corner * LABELS + label)

const LAND = 1;
const PARK = 3;

const N8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const unit = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};

function arcLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += len(sub(pts[i], pts[i - 1]));
  return s;
}

function along(pts, s) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = len(sub(pts[i + 1], pts[i]));
    if (acc + l >= s || i === pts.length - 2) {
      const t = l > 0 ? Math.min(1, Math.max(0, (s - acc) / l)) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    }
    acc += l;
  }
  return pts[pts.length - 1];
}

export function createNeighbourhoods(seed, { boulevards, railIn = () => [], metroIn = () => [] }) {
  const mainStreets = createMainStreets(seed);
  const friction = createNoise(seed, 'neighbourhood-friction');
  // Housing form: perimeter blocks where high, rowhouses and villas where low.
  const form = createNoise(seed, 'housing-form');
  const cache = new LruCache(4000);
  const crossings = new LruCache(60000);

  // Main street crossings of a shared greenway stretch: points and the unit
  // tangent of the stretch, in its canonical direction. A pure function of
  // the stretch, so both districts agree.
  function crossingsOf(geo) {
    let list = crossings.get(geo.key);
    if (list) return list;
    list = [];
    const pts = geo.points;
    const L = arcLength(pts);
    const span = L - 2 * EDGE_END;
    if (span > 0) {
      // One gateway, or two on a long stretch, kept clear of the boulevard's crossing.
      const k = L >= GATEWAY_TWO ? 2 : 1;
      const bp = boulevards.crossingOf(geo).p;
      for (let i = 0; i < k; i++) {
        const u = toUnit(hash(seed, 'street-crossing', hashString(geo.key), i));
        let s = EDGE_END + ((i + 0.5 + (u - 0.5) * 0.4) * span) / k;
        let p = along(pts, s);
        if (len(sub(p, bp)) < EDGE_CLEAR) {
          // Slide along the stretch to whichever side has room.
          const moved = [s + EDGE_CLEAR * 1.2, s - EDGE_CLEAR * 1.2].find((q) => q > EDGE_END && q < L - EDGE_END && len(sub(along(pts, q), bp)) >= EDGE_CLEAR);
          if (moved === undefined) continue;
          s = moved;
          p = along(pts, s);
        }
        const t = unit(sub(along(pts, Math.min(L, s + 60)), along(pts, Math.max(0, s - 60))));
        list.push({ key: `${geo.key}#${i}`, p, t });
      }
    }
    crossings.set(geo.key, list);
    return list;
  }

  function of(d) {
    let out = cache.get(d.key);
    if (out) return out;
    out = build(d);
    cache.set(d.key, out);
    return out;
  }

  function build(d) {
    const rng = rngFor(seed, 'neighbourhoods', ...keyInts(d.coreInfo));
    const bb = d.bbox;
    const x0 = Math.floor(bb.x0 / CELL) * CELL;
    const y0 = Math.floor(bb.y0 / CELL) * CELL;
    const W = Math.ceil((bb.x1 - x0) / CELL) + 1;
    const H = Math.ceil((bb.y1 - y0) / CELL) + 1;
    const N = W * H;
    const cx = (n) => x0 + ((n % W) + 0.5) * CELL;
    const cy = (n) => y0 + (Math.floor(n / W) + 0.5) * CELL;
    const cellOf = (x, y) => {
      const i = Math.floor((x - x0) / CELL);
      const j = Math.floor((y - y0) / CELL);
      return i >= 0 && j >= 0 && i < W && j < H ? j * W + i : -1;
    };
    const S = d.station;

    // ---- Land ----
    const mask = new Uint8Array(N);
    fill(CELL, mask, W, H, x0, y0, d.ring, LAND);
    for (const p of d.parks) fill(CELL, mask, W, H, x0, y0, p.shape, PARK, LAND);
    // Land never touches the raster's border, so neighbours are always in range.
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (i === 0 || j === 0 || i === W - 1 || j === H - 1) mask[j * W + i] = 0;
    const land = [];
    for (let n = 0; n < N; n++) if (mask[n] === LAND) land.push(n);
    // ---- Rail ----
    // Regional rail crosses on its viaduct; neighbourhoods grow up to it
    // from either side but not across, so their boundaries follow it. The
    // track is stamped two cells wide so nothing slips through diagonally.
    const onRail = new Uint8Array(N);
    for (const L of railIn(d)) {
      for (const o of [-0.4, 0.4]) {
        const off = L.map((p, i) => {
          const a = L[Math.max(0, i - 1)];
          const b = L[Math.min(L.length - 1, i + 1)];
          const t = unit(sub(b, a));
          return [p[0] - t[1] * o * CELL, p[1] + t[0] * o * CELL];
        });
        stamp(CELL, onRail, W, H, x0, y0, off);
      }
    }
    // Which side of the rail each cell is on: pieces of land the track
    // parts, numbered.
    const side = new Int32Array(N).fill(-1);
    {
      let k = 0;
      for (const n0 of land) {
        if (side[n0] >= 0 || onRail[n0]) continue;
        const stack = [n0];
        side[n0] = k;
        while (stack.length) {
          const n = stack.pop();
          for (const m of [n - 1, n + 1, n - W, n + W]) {
            if (mask[m] === LAND && !onRail[m] && side[m] < 0) {
              side[m] = k;
              stack.push(m);
            }
          }
        }
        k++;
      }
    }
    // ---- People ----
    // Residents per m² of land: densest around the station, a little denser
    // along boulevards, and varying smoothly with the form of housing.
    const onBlvd = new Uint8Array(N);
    for (const l of d.network.lines) stamp(CELL, onBlvd, W, H, x0, y0, l.points);
    const fromBlvd = distanceField(CELL, onBlvd, W, H);
    const dens = new Float64Array(N);
    let people = 0;
    for (const n of land) {
      const r = Math.hypot(cx(n) - S[0], cy(n) - S[1]);
      const f = Math.min(1, Math.max(0, form.fbm(cx(n) / FORM_SCALE, cy(n) / FORM_SCALE, 2) * 1.8 + 0.5));
      dens[n] = BASE_DENSITY * (1 + CORE_BOOST * Math.exp(-((r / CORE_FADE) ** 2))) * (FORM_LOW + (FORM_HIGH - FORM_LOW) * f) * (1 + BOULEVARD_BOOST * Math.exp(-fromBlvd[n] / 250));
      people += dens[n] * CELL * CELL;
    }
    // Every district houses about as many people (more or less dense as its
    // land is less or more), within what its housing allows: a large outer
    // district is rowhouses, a small one built up.
    const want = PEOPLE_PER_DISTRICT * (DISTRICT_SPREAD[0] + (DISTRICT_SPREAD[1] - DISTRICT_SPREAD[0]) * toUnit(hash(seed, 'district-people', ...keyInts(d.coreInfo))));
    const scale = Math.max(DENSITY_SCALE[0], Math.min(DENSITY_SCALE[1], want / Math.max(1, people)));
    for (const n of land) dens[n] *= scale;
    people *= scale;
    // A campus takes in a university or hospital, so it houses fewer people
    // for its size.
    const hasCampus = toUnit(hash(seed, 'campus', ...keyInts(d.coreInfo))) < CAMPUS_CHANCE;
    const residents = people - (hasCampus ? CAMPUS_SHARE * NEIGHBOURHOOD_PEOPLE : 0);
    const count = 1 + Math.min(NEIGHBOURHOODS[1], Math.max(NEIGHBOURHOODS[0], Math.round(residents / NEIGHBOURHOOD_PEOPLE) - 1));

    // Distance from the district's greenways (and parks), so centres keep off them.
    const edgeSrc = new Uint8Array(N);
    for (let n = 0; n < N; n++) if (mask[n] !== LAND) edgeSrc[n] = 1;
    const fromEdge = distanceField(CELL, edgeSrc, W, H);

    // ---- Centres ----
    // The core first, then the metro stations (each the centre of its
    // neighbourhood), then centres along the boulevards, then the rest.
    const centres = [[S[0], S[1]]];
    const onBoulevard = [{ t: null }];
    const spacing = Math.sqrt(NEIGHBOURHOOD_AREA) * 1.05;
    const farFrom = (p, r) => centres.every((c) => len(sub(c, p)) >= r);
    const lines = d.network.lines.filter((l) => l.kind !== 'roundabout').slice().sort((a, b) => (a.key < b.key ? -1 : 1));
    for (const st of metroIn(d)) {
      const n = cellOf(st.p[0], st.p[1]);
      if (st.core || centres.length >= count || n < 0 || mask[n] !== LAND || onRail[n] || fromEdge[n] < 400) continue;
      // (As far apart as centres along the boulevards.)
      const local = Math.sqrt(NEIGHBOURHOOD_PEOPLE / dens[n]) * 1.05;
      if (len(sub(st.p, S)) < local * 1.1 || !farFrom(st.p, local)) continue;
      // On the boulevard above it (the metro runs under the boulevards, if
      // not always right under them): that is its main street.
      let best = null;
      for (const l of lines) {
        const q = l.points;
        for (let i = 1; i < q.length - 1; i++) {
          const r = len(sub(q[i], st.p));
          if (r < BOULEVARD_SNAP && (!best || r < best.r)) best = { r, p: q[i], t: unit(sub(q[i + 1], q[i - 1])) };
        }
      }
      if (best && !farFrom(best.p, local)) continue;
      centres.push(best ? best.p : st.p.slice());
      onBoulevard.push({ t: best ? best.t : null });
    }
    for (const l of lines) {
      const q = l.points;
      for (let i = 3; i < q.length - 3 && centres.length < count; i += 3) {
        const n = cellOf(q[i][0], q[i][1]);
        if (n < 0 || mask[n] !== LAND || fromEdge[n] < 300) continue;
        // Closer together where more people live.
        const local = Math.sqrt(NEIGHBOURHOOD_PEOPLE / dens[n]) * 1.05;
        if (len(sub(q[i], S)) < local * 1.1 || !farFrom(q[i], local)) continue;
        centres.push(q[i]);
        onBoulevard.push({ t: unit(sub(q[i + 3], q[i - 3])) });
      }
    }
    const fixed = centres.length;
    const sample = land.filter((n, k) => k % 3 === 0 && fromEdge[n] > 200);
    const pool = sample.length >= count * 4 ? sample : land;
    const nearest = new Float64Array(pool.length);
    for (let k = 0; k < pool.length; k++) {
      let m = Infinity;
      for (const c of centres) m = Math.min(m, Math.hypot(cx(pool[k]) - c[0], cy(pool[k]) - c[1]));
      nearest[k] = m;
    }
    while (centres.length < count) {
      let pick = pool[0];
      let best = -1;
      for (let k = 0; k < pool.length; k++) {
        if (nearest[k] > best) {
          best = nearest[k];
          pick = pool[k];
        }
      }
      const p = [cx(pick), cy(pick)];
      centres.push(p);
      onBoulevard.push({ t: null });
      for (let k = 0; k < pool.length; k++) nearest[k] = Math.min(nearest[k], Math.hypot(cx(pool[k]) - p[0], cy(pool[k]) - p[1]));
    }
    // Lloyd steps for the free centres; the fixed ones stay put. Land is
    // weighted by the square of its density, which makes each region hold
    // about as many people rather than as much land.
    for (let it = 0; it < LLOYD_STEPS; it++) {
      const sx = new Float64Array(count);
      const sy = new Float64Array(count);
      const sn = new Float64Array(count);
      for (const n of pool) {
        const x = cx(n);
        const y = cy(n);
        let b = 0;
        let bd = Infinity;
        for (let k = 0; k < count; k++) {
          const dx = centres[k][0] - x;
          const dy = centres[k][1] - y;
          const dd = dx * dx + dy * dy;
          if (dd < bd) {
            bd = dd;
            b = k;
          }
        }
        const wt = (dens[n] / BASE_DENSITY) ** 2;
        sx[b] += x * wt;
        sy[b] += y * wt;
        sn[b] += wt;
      }
      const taken = new Set(centres.slice(0, fixed).map((c) => cellOf(c[0], c[1])));
      for (let k = fixed; k < count; k++) {
        if (!sn[k]) {
          taken.add(cellOf(centres[k][0], centres[k][1]));
          continue;
        }
        const tx = sx[k] / sn[k];
        const ty = sy[k] / sn[k];
        let b = null;
        let bd = Infinity;
        for (const n of pool) {
          const dx = cx(n) - tx;
          const dy = cy(n) - ty;
          const dd = dx * dx + dy * dy;
          if (dd < bd && !taken.has(n)) {
            bd = dd;
            b = n;
          }
        }
        taken.add(b);
        centres[k] = [cx(b), cy(b)];
      }
    }

    // The campus, if any: one of the free centres with room round it (the
    // more open half), near a metro station if one is, else picked by its
    // place alone.
    let campus = null;
    if (hasCampus) {
      let best = -1;
      const room = (k) => Math.min(...centres.map((c, j) => (j === k ? Infinity : len(sub(c, centres[k])))));
      const rooms = [];
      for (let k = fixed; k < count; k++) rooms.push(room(k));
      const enough = rooms.slice().sort((a, b) => a - b)[Math.floor(rooms.length / 2)] ?? 0;
      for (let k = fixed; k < count; k++) {
        if (room(k) < enough) continue;
        const byMetro = metroIn(d).some((st) => len(sub(st.p, centres[k])) < CAMPUS_METRO);
        const u = (byMetro ? 1 : 0) + toUnit(hash(seed, 'campus-site', Math.floor(centres[k][0] / CELL), Math.floor(centres[k][1] / CELL)));
        if (u > best) {
          best = u;
          campus = centres[k];
        }
      }
    }
    // Land cut off by the rail with no centre of its own (between tracks
    // fanning out of a station, say) gets one, else the core would take it.
    {
      const has = new Set(centres.slice(1).map((c) => side[cellOf(c[0], c[1])]));
      const sum = new Map();
      for (const n of land) {
        const k = side[n];
        if (k < 0 || has.has(k)) continue;
        const e = sum.get(k) || { people: 0, x: 0, y: 0, w: 0 };
        const wt = dens[n] * CELL * CELL;
        e.people += wt;
        e.x += cx(n) * wt;
        e.y += cy(n) * wt;
        e.w += wt;
        sum.set(k, e);
      }
      for (const [k, e] of [...sum].sort((a, b) => a[0] - b[0])) {
        if (e.people < NEIGHBOURHOOD_PEOPLE * 0.4) continue;
        const tx = e.x / e.w;
        const ty = e.y / e.w;
        let b = -1;
        let bd = Infinity;
        for (const n of land) {
          if (side[n] !== k) continue;
          // (Near its middle, but clear of centres across the track.)
          const clear = Math.min(600, ...centres.map((c) => Math.hypot(cx(n) - c[0], cy(n) - c[1])));
          const dd = Math.hypot(cx(n) - tx, cy(n) - ty) - Math.min(fromEdge[n], 200) - clear;
          if (dd < bd) [bd, b] = [dd, n];
        }
        if (b >= 0) {
          centres.push([cx(b), cy(b)]);
          onBoulevard.push({ t: null });
        }
      }
    }
    const housing = (k) => (centres[k] === campus ? 1 - CAMPUS_SHARE : 1);
    // People living in each neighbourhood of a labelling.
    const peopleOf = (lab, m) => {
      const pop = new Float64Array(m);
      for (const n of land) if (lab[n] >= 0) pop[lab[n]] += dens[n] * CELL * CELL;
      for (let k = 0; k < m; k++) pop[k] *= housing(k);
      return pop;
    };

    // ---- Growth ----
    const label = new Int16Array(N).fill(OUTSIDE);
    const cost = new Float64Array(N).fill(Infinity);
    const fr = new Float64Array(N);
    for (const n of land) {
      const f = friction.fbm(cx(n) / 700, cy(n) / 700, 3, 2.2, 0.55);
      fr[n] = 1 + Math.max(-0.5, Math.min(0.7, f * 1.3));
    }
    const OFF = N8.map(([di, dj]) => dj * W + di);
    const STEP = N8.map(([, , w]) => CELL * w * 0.5);
    const done = new Uint8Array(N);
    let seedCells = centres.map((p) => cellOf(p[0], p[1]));
    const isSeed = new Uint8Array(N);
    for (const n of seedCells) if (n >= 0) isSeed[n] = 1;
    function grow(speed) {
      label.fill(OUTSIDE);
      cost.fill(Infinity);
      done.fill(0);
      const heap = new Heap();
      seedCells.forEach((n, k) => {
        if (n < 0 || mask[n] !== LAND) return;
        cost[n] = 0;
        label[n] = k;
        heap.push(cost[n], n);
      });
      while (heap.size) {
        const n = heap.pop();
        if (done[n]) continue;
        done[n] = 1;
        for (let q = 0; q < 8; q++) {
          const m = n + OFF[q];
          if (mask[m] !== LAND || done[m] || isSeed[m] || (onRail[m] && !onRail[n])) continue;
          const c = cost[n] + STEP[q] * (fr[n] + fr[m]) * speed[label[n]];
          if (c < cost[m]) {
            cost[m] = c;
            label[m] = label[n];
            heap.push(c, m);
          }
        }
      }
    }
    // Grow, then even out the populations by making the more populous
    // neighbourhoods spread more slowly, so a dense one ends up small and a
    // sparse one large. A centre left with almost no one is dropped.
    const speed = centres.map(() => rng.range(0.92, 1.08));
    for (let it = 0; it < 6; it++) {
      grow(speed);
      const m = centres.length;
      const size = peopleOf(label, m);
      const share = size.reduce((a, b) => a + b, 0) / m;
      const target = () => share;
      let small = -1;
      for (let k = 1; k < m; k++) if (size[k] < share * 0.3 && (small < 0 || size[k] < size[small])) small = k;
      if (small >= 0 && it < 4 && m > 3) {
        isSeed[seedCells[small]] = 0;
        for (const arr of [centres, seedCells, speed, onBoulevard]) arr.splice(small, 1);
        continue;
      }
      if (it >= 4) break;
      for (let k = 0; k < m; k++) speed[k] = Math.max(0.4, Math.min(2.5, speed[k] * (size[k] / target(k)) ** 0.5));
    }
    const total = centres.length;
    // Land growth could not reach (the track itself, and any piece of land
    // the rail cuts off with no centre of its own) joins the neighbourhood
    // most of its edge touches, from the outside in.
    function fillGaps() {
      let gap = land.filter((n) => label[n] < 0);
      for (let pass = 0; pass < 400 && gap.length; pass++) {
        const next = [];
        const set = [];
        for (const n of gap) {
          const counts = new Map();
          for (const m of [n - 1, n + 1, n - W, n + W]) if (label[m] >= 0) counts.set(label[m], (counts.get(label[m]) || 0) + 1);
          if (!counts.size) {
            next.push(n);
            continue;
          }
          let best = -1;
          let bc = 0;
          for (const [l, c] of [...counts].sort((x, y) => x[0] - y[0])) if (c > bc) [best, bc] = [l, c];
          set.push([n, best]);
        }
        if (!set.length) break;
        for (const [n, l] of set) label[n] = l;
        gap = next;
      }
    }
    fillGaps();
    // Neighbourhoods are compact: a thin arm or panhandle one reaches out
    // (narrower than about twice NECK) goes to the neighbourhoods round it.
    // Found by opening each neighbourhood (shrinking it by NECK, then
    // growing what is left back by as much): what does not come back is
    // too thin. A neighbourhood that is thin all over is left alone.
    function trimNecks() {
      const R = NECK;
      const edge = new Uint8Array(N);
      for (const n of land) {
        const l = label[n];
        if (l < 0) continue;
        if (label[n - 1] !== l || label[n + 1] !== l || label[n - W] !== l || label[n + W] !== l) edge[n] = 1;
      }
      const inner = distanceField(CELL, edge, W, H);
      const removed = [];
      for (let k = 0; k < total; k++) {
        const core = new Uint8Array(N);
        let cells = 0;
        let kept = 0;
        for (const n of land) {
          if (label[n] !== k) continue;
          cells++;
          if (inner[n] >= R) {
            core[n] = 1;
            kept++;
          }
        }
        if (!kept) continue;
        const back = distanceField(CELL, core, W, H);
        const drop = [];
        for (const n of land) if (label[n] === k && back[n] > R + CELL * 0.5) drop.push(n);
        // (The core is always kept compact round its station.)
        if (k !== 0 && drop.length > cells * 0.6) continue;
        // (Never where it grows from.)
        const keepAt = new Set([cellOf(centres[k][0], centres[k][1]), ...(hoods ? [cellOf(hoods[k].centre[0], hoods[k].centre[1]), hoods[k].seed && cellOf(hoods[k].seed[0], hoods[k].seed[1])] : [])]);
        for (const n of drop) if (!keepAt.has(n)) removed.push([n, k]);
      }
      for (const [n] of removed) label[n] = OUTSIDE;
      // Each goes to the neighbourhood its edge touches most, never back
      // to the one it came from.
      let gap = removed;
      for (let pass = 0; pass < 200 && gap.length; pass++) {
        const next = [];
        const set = [];
        for (const [n, from] of gap) {
          const counts = new Map();
          for (const m of [n - 1, n + 1, n - W, n + W]) if (label[m] >= 0 && label[m] !== from) counts.set(label[m], (counts.get(label[m]) || 0) + 1);
          if (!counts.size) {
            next.push([n, from]);
            continue;
          }
          let best = -1;
          let bc = 0;
          for (const [l, cn] of [...counts].sort((x, y) => x[0] - y[0])) if (cn > bc) [best, bc] = [l, cn];
          set.push([n, best]);
        }
        if (!set.length) break;
        for (const [n, l] of set) label[n] = l;
        gap = next;
      }
      // Any left with nowhere else to go stay where they were.
      for (const [n, from] of gap) label[n] = from;
    }
    // Even out the people neighbourhood by neighbourhood after the trimming:
    // a cell on the edge of a fuller neighbourhood passes to an emptier one
    // next to it, if most of its sides already touch that one (so shapes
    // stay compact). Never the core's disc round the station, nor a centre.
    function evenOut() {
      const pop = peopleOf(label, total);
      const share = pop.reduce((a, b) => a + b, 0) / total;
      const isCentre = new Uint8Array(N);
      for (const c of [...centres, ...hoods.map((h) => h.centre), ...hoods.filter((h) => h.seed).map((h) => h.seed)]) {
        const n = cellOf(c[0], c[1]);
        if (n >= 0) isCentre[n] = 1;
      }
      for (let round = 0; round < 80; round++) {
        let moved = 0;
        for (const n of land) {
          const a = label[n];
          if (a < 0 || isCentre[n] || (a === 0 && Math.hypot(cx(n) - S[0], cy(n) - S[1]) < d.coreRadius * 0.8)) continue;
          if (pop[a] < share * 0.85) continue;
          const counts = new Map();
          for (const m of [n - 1, n + 1, n - W, n + W]) if (label[m] >= 0 && label[m] !== a) counts.set(label[m], (counts.get(label[m]) || 0) + 1);
          let best = -1;
          for (const [b, c] of counts) if (c >= 2 && pop[b] < pop[a] * 0.9 && pop[b] < share * 1.08 && (best < 0 || pop[b] < pop[best])) best = b;
          if (best < 0) continue;
          // (Not across the rail.)
          if (onRail[n] === 0 && side[n] >= 0 && best !== 0) {
            const sb = sideOfHood(best);
            if (sb >= 0 && sb !== side[n]) continue;
          }
          const p = dens[n] * CELL * CELL * housing(a);
          label[n] = best;
          pop[a] -= p;
          pop[best] += dens[n] * CELL * CELL * housing(best);
          moved++;
        }
        if (!moved) break;
      }
    }
    // Single cells cut off from their own kind join their neighbours.
    for (const n of land) {
      if (isSeed[n]) continue;
      const own = label[n];
      const ns = [label[n - 1], label[n + 1], label[n - W], label[n + W]];
      if (ns.includes(own)) continue;
      const counts = new Map();
      for (const l of ns) if (l !== OUTSIDE) counts.set(l, (counts.get(l) || 0) + 1);
      let best = own;
      let bc = 0;
      for (const [l, c] of [...counts].sort((a, b) => a[0] - b[0])) {
        if (c > bc) {
          best = l;
          bc = c;
        }
      }
      label[n] = best;
    }

    const { chains, polygons } = trace(label, W, H, x0, y0, total);
    const hoods = centres.map((c, k) => {
      // The outer ring; any others are holes around another neighbourhood.
      const rings = polygons[k] || [];
      const poly = rings[0] || [];
      const holes = rings.slice(1);
      const area = poly.length > 2 ? polygonArea(poly) - holes.reduce((a, r) => a + (r.length > 2 ? polygonArea(r) : 0), 0) : 0;
      return { id: k, key: `${d.key}:n${k}`, core: k === 0, centre: c, onBoulevard: onBoulevard[k].t, polygon: poly, holes, area };
    });

    // ---- Main streets ----
    // Greenway crossings, with the normal pointing into this district.
    const crossings = [];
    for (const c of d.chains) {
      if (!isDistrictKey(c.neighbour)) continue;
      const same = c.points === c.geo.points;
      // Parks at the ends of the stretch belong to both districts, so both
      // skip the same crossings: none inside a park.
      const ends = c.geo.key.split('|').slice(2, 4);
      const endParks = d.parks.filter((pk) => ends.includes(pk.key));
      for (const x of crossingsOf(c.geo)) {
        const tx = same ? x.t[0] : -x.t[0];
        const ty = same ? x.t[1] : -x.t[1];
        const n = [ty, -tx];
        const probe = [x.p, [x.p[0] + n[0] * 110, x.p[1] + n[1] * 110], [x.p[0] - n[0] * 110, x.p[1] - n[1] * 110]];
        if (endParks.some((pk) => probe.some((q) => pointInPolygon(q[0], q[1], pk.shape)))) continue;
        crossings.push({ key: x.key, p: x.p, n, neighbour: c.neighbour });
      }
    }
    for (const h of hoods) h.seed = h.centre;
    const streets = mainStreets(d, hoods, chains, { mask, label, W, H, x0, y0, N, fromEdge, cellOf }, crossings);

    // ---- Regrow around the main streets ----
    // Each neighbourhood now grows out from its own main street (the stretch
    // near its centre), so the main street nearest a point decides which
    // neighbourhood it is in, and boundaries fall between main streets.
    const owner = new Int16Array(N).fill(OUTSIDE);
    const ownerDist = new Float64Array(N).fill(Infinity);
    const sideOfHood = (k) => {
      const c = cellOf(hoods[k].centre[0], hoods[k].centre[1]);
      return c >= 0 ? side[c] : -1;
    };
    const claim = (x, y, k, r) => {
      const n = cellOf(x, y);
      if (n < 0 || mask[n] !== LAND || r >= ownerDist[n]) return;
      // Never across the rail from its centre.
      // (The core, round the station, spans the track.)
      const sk = k === 0 ? -1 : sideOfHood(k);
      if (sk >= 0 && side[n] !== sk) return;
      owner[n] = k;
      ownerDist[n] = r;
    };
    const stampAlong = (pts, k, centre, reach) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[i + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL / 2)));
        for (let t = 0; t <= steps; t++) {
          const x = ax + ((bx - ax) * t) / steps;
          const y = ay + ((by - ay) * t) / steps;
          const r = Math.hypot(x - centre[0], y - centre[1]);
          if (r <= reach) claim(x, y, k, r);
        }
      }
    };
    // Each also keeps the land right around where it first grew from.
    for (const n of land) {
      const k = label[n];
      if (k < 0) continue;
      const r = Math.hypot(cx(n) - hoods[k].seed[0], cy(n) - hoods[k].seed[1]);
      if (r < 180) claim(cx(n), cy(n), k, r);
    }
    for (const h of hoods) {
      claim(h.centre[0], h.centre[1], h.id, 0);
      if (h.core) {
        // The core: round its station, not out along its boulevards.
        // (Smaller where the district is built denser.)
        const r = Math.max(200, (d.coreRadius * 0.8) / Math.sqrt(Math.max(1, scale)));
        for (let j = -r; j <= r; j += CELL / 2) for (let i = -r; i <= r; i += CELL / 2) {
          const q = Math.hypot(i, j);
          if (q <= r) claim(S[0] + i, S[1] + j, 0, q);
        }
      } else if (h.spine) {
        stampAlong(h.spine, h.id, h.centre, SPINE_REACH);
      }
    }
    const sources = hoods.map(() => []);
    for (let n = 0; n < N; n++) if (owner[n] >= 0) sources[owner[n]].push(n);
    const fixedCell = new Uint8Array(N);
    for (let n = 0; n < N; n++) if (owner[n] >= 0) fixedCell[n] = 1;
    function regrow(speed2) {
      label.fill(OUTSIDE);
      cost.fill(Infinity);
      done.fill(0);
      const heap = new Heap();
      sources.forEach((cells, k) => {
        for (const n of cells) {
          cost[n] = 0;
          label[n] = k;
          heap.push(0, n);
        }
      });
      while (heap.size) {
        const n = heap.pop();
        if (done[n]) continue;
        done[n] = 1;
        for (let q = 0; q < 8; q++) {
          const m = n + OFF[q];
          if (mask[m] !== LAND || done[m] || fixedCell[m] || (onRail[m] && !onRail[n])) continue;
          const c = cost[n] + STEP[q] * (fr[n] + fr[m]) * speed2[label[n]];
          if (c < cost[m]) {
            cost[m] = c;
            label[m] = label[n];
            heap.push(c, m);
          }
        }
      }
    }
    // Even out the populations: the more populous a neighbourhood, the
    // slower it spreads next round. The best-balanced round is kept.
    const speed2 = hoods.map(() => 1);
    let bestLabel = null;
    let bestErr = Infinity;
    for (let it = 0; it < BALANCE_STEPS; it++) {
      regrow(speed2);
      fillGaps();
      trimNecks();
      const size = peopleOf(label, total);
      const share = size.reduce((a, b) => a + b, 0) / total;
      let err = 0;
      for (let k = 0; k < total; k++) err += (size[k] / share - 1) ** 2;
      if (err < bestErr) {
        bestErr = err;
        bestLabel = label.slice();
      }
      for (let k = 0; k < total; k++) speed2[k] = Math.max(0.4, Math.min(2.5, speed2[k] * (size[k] / share) ** 0.35));
    }
    label.set(bestLabel);
    evenOut();
    // Keep each neighbourhood to the one piece that holds its centre; stray
    // pieces go to the neighbourhoods around them.
    const keep = new Uint8Array(N);
    for (const h of hoods) {
      // Start from where it first grew (always its own now), else its centre.
      let start = cellOf(h.seed[0], h.seed[1]);
      if (start < 0 || label[start] !== h.id) start = cellOf(h.centre[0], h.centre[1]);
      if (start < 0 || label[start] !== h.id) {
        // Else from the largest piece it has.
        start = -1;
        let bestSize = 0;
        const seen = new Uint8Array(N);
        for (const n0 of land) {
          if (label[n0] !== h.id || seen[n0]) continue;
          const stack = [n0];
          seen[n0] = 1;
          let size = 0;
          while (stack.length) {
            const n = stack.pop();
            size++;
            for (const m of [n - 1, n + 1, n - W, n + W]) if (!seen[m] && label[m] === h.id) {
              seen[m] = 1;
              stack.push(m);
            }
          }
          if (size > bestSize) [bestSize, start] = [size, n0];
        }
        if (start < 0) continue;
      }
      const stack = [start];
      keep[start] = 1;
      while (stack.length) {
        const n = stack.pop();
        // Four-way: pieces touching only at a corner are traced apart.
        for (const m of [n - 1, n + 1, n - W, n + W]) {
          if (!keep[m] && label[m] === h.id) {
            keep[m] = 1;
            stack.push(m);
          }
        }
      }
    }
    let stray = [];
    for (const n of land) if (label[n] >= 0 && !keep[n]) {
      label[n] = OUTSIDE;
      stray.push(n);
    }
    for (let pass = 0; pass < 400 && stray.length; pass++) {
      const next = [];
      const set = [];
      for (const n of stray) {
        const counts = new Map();
        for (const m of [n - 1, n + 1, n - W, n + W]) if (label[m] >= 0) counts.set(label[m], (counts.get(label[m]) || 0) + 1);
        if (!counts.size) {
          next.push(n);
          continue;
        }
        let best = -1;
        let bc = 0;
        for (const [l, c] of [...counts].sort((x, y) => x[0] - y[0])) if (c > bc) [best, bc] = [l, c];
        set.push([n, best]);
      }
      for (const [n, l] of set) label[n] = l;
      stray = next;
    }
    const again = trace(label, W, H, x0, y0, total);
    for (const h of hoods) {
      const rings = again.polygons[h.id] || [];
      h.polygon = rings[0] || [];
      h.holes = rings.slice(1);
      h.area = h.polygon.length > 2 ? polygonArea(h.polygon) - h.holes.reduce((a, r) => a + (r.length > 2 ? polygonArea(r) : 0), 0) : 0;
      delete h.spine;
    }
    const pop = peopleOf(label, total);
    for (const h of hoods) {
      h.population = Math.round(pop[h.id]);
      h.campus = centres[h.id] === campus;
      // People per km² of the neighbourhood's land, and the housing that implies.
      h.density = h.area > 0 ? Math.round(pop[h.id] / (h.area / 1e6)) : 0;
      // One form of housing to a neighbourhood: the less dense are rowhouses.
      h.character = h.core ? 'core' : h.campus ? 'campus' : h.density < ROWHOUSE_DENSITY ? 'rowhouses' : 'perimeter blocks';
    }
    // Neighbourhoods with a metro station.
    for (const st of metroIn(d)) {
      const n = cellOf(st.p[0], st.p[1]);
      const k = n >= 0 ? label[n] : -1;
      if (k >= 0 && hoods[k]) (hoods[k].metro ||= []).push(st.id);
    }
    // The rasters later stages read: residents per m² and neighbourhood per cell.
    const raster = { x0, y0, W, H, cell: CELL, dens, label };
    return { hoods, chains: again.chains, crossings, lines: streets.lines, raster };
  }

  // ---- Boundary tracing ----

  // Directed cell edges with each label on its right (clockwise on screen),
  // joined into loops, split into chains where the label across changes or
  // three regions meet. Each chain is smoothed once in a fixed direction.
  function trace(label, W, H, x0, y0, count) {
    const CW = W + 1;
    const at = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? OUTSIDE : label[j * W + i]);
    const from = [];
    const to = [];
    const own = [];
    const across = [];
    const out = new Map();
    const addEdge = (a, b, l, x) => {
      const e = from.length;
      from.push(a);
      to.push(b);
      own.push(l);
      across.push(x);
      const k = a * LABELS + l;
      let list = out.get(k);
      if (!list) out.set(k, (list = []));
      list.push(e);
    };
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const l = label[j * W + i];
        if (l === OUTSIDE) continue;
        const c00 = j * CW + i;
        const c10 = c00 + 1;
        const c01 = c00 + CW;
        const c11 = c01 + 1;
        let x = at(i, j - 1);
        if (x !== l) addEdge(c00, c10, l, x);
        x = at(i + 1, j);
        if (x !== l) addEdge(c10, c11, l, x);
        x = at(i, j + 1);
        if (x !== l) addEdge(c11, c01, l, x);
        x = at(i - 1, j);
        if (x !== l) addEdge(c01, c00, l, x);
      }
    }
    const cxy = (c) => [x0 + (c % CW) * CELL, y0 + Math.floor(c / CW) * CELL];
    const dirOf = (e) => {
      const a = cxy(from[e]);
      const b = cxy(to[e]);
      return [b[0] - a[0], b[1] - a[1]];
    };
    // Corners where three or more regions (counting outside as one) meet.
    const junction = (c) => {
      const i = c % CW;
      const j = Math.floor(c / CW);
      const v = new Set([at(i - 1, j - 1), at(i, j - 1), at(i - 1, j), at(i, j)]);
      return v.size >= 3;
    };

    const used = new Uint8Array(from.length);
    const loopsOf = Array.from({ length: count }, () => []);
    for (let e0 = 0; e0 < from.length; e0++) {
      if (used[e0]) continue;
      const loop = [];
      let e = e0;
      while (e !== undefined && !used[e]) {
        used[e] = 1;
        loop.push(e);
        const cands = (out.get(to[e] * LABELS + own[e]) || []).filter((f) => !used[f]);
        if (cands.length <= 1) {
          e = cands[0];
          continue;
        }
        // At a pinch, turn right to keep the region to itself.
        const din = dirOf(e);
        let best = -Infinity;
        for (const f of cands) {
          const dout = dirOf(f);
          const cr = din[0] * dout[1] - din[1] * dout[0];
          if (cr > best) [best, e] = [cr, f];
        }
      }
      if (loop.length > 2) loopsOf[own[e0]].push(loop);
    }

    const chains = new Map();
    const polygons = [];
    for (let l = 0; l < count; l++) {
      const rings = [];
      for (const loop of loopsOf[l]) {
        const m = loop.length;
        const breaks = [];
        for (let t = 0; t < m; t++) {
          const prev = loop[(t - 1 + m) % m];
          if (across[loop[t]] !== across[prev] || junction(from[loop[t]])) breaks.push(t);
        }
        const pts = [];
        const pieces = [];
        if (!breaks.length) {
          pieces.push({ corners: loop.map((e) => from[e]).concat([from[loop[0]]]), other: across[loop[0]], closed: true });
        } else {
          for (let b = 0; b < breaks.length; b++) {
            const s = breaks[b];
            const e = b + 1 < breaks.length ? breaks[b + 1] : breaks[0] + m;
            const corners = [];
            for (let t = s; t < e; t++) corners.push(from[loop[t % m]]);
            corners.push(to[loop[(e - 1) % m]]);
            pieces.push({ corners, other: across[loop[s]], closed: false });
          }
        }
        for (const pc of pieces) {
          const g = sharedChain(chains, l, pc, cxy);
          const op = g.oriented(pc);
          for (let i = 0; i < op.length - 1; i++) pts.push(op[i]);
        }
        rings.push(pts);
      }
      rings.sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
      polygons.push(rings);
    }
    return { chains: [...chains.values()], polygons };
  }

  function sharedChain(chains, l, pc, cxy) {
    let canon = pc.corners;
    if (pc.closed) {
      const ring = canon.slice(0, -1);
      let m = 0;
      for (let i = 1; i < ring.length; i++) if (ring[i] < ring[m]) m = i;
      const fwd = ring.slice(m).concat(ring.slice(0, m));
      const back = [fwd[0], ...fwd.slice(1).reverse()];
      canon = (fwd[1] < back[1] ? fwd : back).concat([fwd[0]]);
    } else if (canon[0] > canon[canon.length - 1]) {
      canon = canon.slice().reverse();
    }
    const a = Math.min(l, pc.other);
    const b = Math.max(l, pc.other);
    const key = `${a}|${b}|${canon[0]}|${canon[canon.length - 1]}|${canon.length}`;
    let g = chains.get(key);
    if (!g) {
      let pts = canon.map(cxy);
      if (pc.closed) {
        pts = simplify(pts, SMOOTH_TOL).slice(0, -1);
        if (pts.length < 3) pts = canon.slice(0, -1).map(cxy);
        for (let k = 0; k < 4; k++) pts = chaikin(pts, true);
        pts.push(pts[0]);
      } else {
        pts = simplify(pts, SMOOTH_TOL);
        for (let k = 0; k < 4; k++) pts = chaikin(pts, false);
      }
      const first = canon[0];
      g = {
        key,
        a,
        b,
        points: pts,
        length: pts.reduce((s, p, i) => (i ? s + len(sub(p, pts[i - 1])) : 0), 0),
        oriented(piece) {
          if (piece.closed) {
            // Closed chains: follow the piece's own winding.
            const sameWay = signedArea(pts) > 0 === signedArea(piece.corners.map(cxy)) > 0;
            return sameWay ? pts : pts.slice().reverse();
          }
          return piece.corners[0] === first ? pts : pts.slice().reverse();
        },
      };
      chains.set(key, g);
    }
    return g;
  }

  return { of, crossingsOf };
}
