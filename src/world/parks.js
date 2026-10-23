// District parks. They sit where three or more districts meet, spread out
// fairly evenly: a junction gets a park if no better candidate lies within
// PARK_SPACING (two rounds, like the cores, so gaps get filled). Each choice
// looks only at nearby junctions, so it never depends on visiting order.
//
// A park's outline is the edge of a soft field: a main body near the
// junction, a few lobes into the districts, and fingers that run out along
// each greenway and taper to the greenway's own width, so the park flows into
// them. The outline is found along rays from the junction and is held back
// from boulevards and district cores, which gives it a straight street edge
// where it meets one.

import { hash, toUnit } from '../core/hash.js';
import { rngFor } from '../core/rng.js';
import { LruCache } from './cache.js';
import { polygonArea } from '../util/geom.js';
import { distToLine } from './boulevards.js';
import { isDistrictKey } from './growth.js';

export const PARK_AREA_HA = [40, 70];
export const PARK_SPACING = 2700; // metres between park centres, at least
const MIN_AREA_HA = 22; // a park squeezed smaller than this is dropped
const RAYS = 144;
const RAY_STEP = 24;
const ROAD_CLEAR = 17.6 + 16; // metres from a boulevard centreline
const CORE_CLEAR = 35; // metres from a district core
const FINGER_STEP = 55;
const BUCKET = 80;

export function createParks(seed, { baseOf, label, parcel, greenwayWidth, boulevardDistance, network }) {
  const nearCache = new LruCache(40000);
  const status = new LruCache(120000);
  const shapes = new LruCache(20000);

  const score = (j) => toUnit(hash(seed, 'park-score', j.i, j.j));
  const better = (a, b) => score(a) > score(b) || (score(a) === score(b) && a.key > b.key);

  // Districts with land within r of a point, sorted by key.
  function basesNear(x, y, r) {
    const keys = new Set();
    const n = Math.ceil(r / parcel);
    const i0 = Math.floor(x / parcel);
    const j0 = Math.floor(y / parcel);
    for (let j = j0 - n; j <= j0 + n; j++) for (let i = i0 - n; i <= i0 + n; i++) keys.add(label(i, j));
    return [...keys].sort().map(baseOf).filter(Boolean);
  }

  // Can this junction hold a park at all?
  function eligible(j) {
    const k = `e:${j.key}`;
    let v = status.get(k);
    if (v !== undefined) return v;
    v = j.labels.length >= 3 && j.labels.every(isDistrictKey);
    for (const l of j.labels) {
      const b = baseOf(l);
      if (!v || !b) break;
      v = Math.hypot(j.x - b.station[0], j.y - b.station[1]) > b.coreReach + 320;
    }
    if (v) v = boulevardDistance(j.x, j.y) > 90;
    status.set(k, v);
    return v;
  }

  // Eligible junctions within PARK_SPACING (excluding j itself).
  function rivals(j) {
    let list = nearCache.get(j.key);
    if (list) return list;
    const seen = new Map();
    for (const b of basesNear(j.x, j.y, PARK_SPACING)) {
      for (const w of b.junctions) {
        if (w.key === j.key || seen.has(w.key)) continue;
        if ((w.x - j.x) ** 2 + (w.y - j.y) ** 2 >= PARK_SPACING ** 2) continue;
        seen.set(w.key, w);
      }
    }
    list = [...seen.values()].filter(eligible);
    nearCache.set(j.key, list);
    return list;
  }

  function round1(j) {
    const k = `1:${j.key}`;
    let v = status.get(k);
    if (v === undefined) {
      v = eligible(j) && !rivals(j).some((o) => better(o, j));
      status.set(k, v);
    }
    return v;
  }

  function eligible2(j) {
    const k = `2:${j.key}`;
    let v = status.get(k);
    if (v === undefined) {
      v = eligible(j) && !round1(j) && !rivals(j).some(round1);
      status.set(k, v);
    }
    return v;
  }

  function isPark(j) {
    if (round1(j)) return true;
    if (!eligible2(j)) return false;
    return !rivals(j).some((o) => better(o, j) && eligible2(o));
  }

  // ---- Shape ----

  // Boulevard segments and cores near the junction, for clearance tests.
  function obstacles(j, reach) {
    const grid = new Map();
    const cores = [];
    for (const b of basesNear(j.x, j.y, reach)) {
      cores.push({ x: b.station[0], y: b.station[1], r: b.coreReach });
      for (const l of network(b).lines) {
        const bb = l.bbox;
        if (bb.x1 < j.x - reach || bb.x0 > j.x + reach || bb.y1 < j.y - reach || bb.y0 > j.y + reach) continue;
        const p = l.points;
        for (let i = 0; i < p.length - 1; i++) {
          const cx = Math.floor((p[i][0] + p[i + 1][0]) / 2 / BUCKET);
          const cy = Math.floor((p[i][1] + p[i + 1][1]) / 2 / BUCKET);
          const key = `${cx},${cy}`;
          let cell = grid.get(key);
          if (!cell) grid.set(key, (cell = []));
          cell.push(p[i], p[i + 1]);
        }
      }
    }
    // Distance to the nearest obstacle beyond its clearance, capped at a
    // bucket width (all a ray march needs to take a safe step).
    return {
      gap(x, y) {
        let best = BUCKET;
        const cx = Math.floor(x / BUCKET);
        const cy = Math.floor(y / BUCKET);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const cell = grid.get(`${cx + dx},${cy + dy}`);
            if (!cell) continue;
            for (let i = 0; i < cell.length; i += 2) best = Math.min(best, distToLine(x, y, cell, i, i + 1) - ROAD_CLEAR);
          }
        }
        for (const k of cores) best = Math.min(best, Math.hypot(x - k.x, y - k.y) - k.r - CORE_CLEAR);
        return best;
      },
    };
  }

  // Greenways leaving the junction, as point lists running away from it.
  function armsOf(j) {
    const arms = new Map();
    for (const l of j.labels) {
      const b = baseOf(l);
      if (!b) continue;
      for (const c of b.chains) {
        const p = c.geo.points;
        if (p[0][0] === j.x && p[0][1] === j.y) arms.set(c.key, p);
        else if (p[p.length - 1][0] === j.x && p[p.length - 1][1] === j.y) arms.set(c.key, p.slice().reverse());
      }
    }
    return [...arms.keys()].sort().map((k) => arms.get(k));
  }

  // The soft field: seeds [x, y, r]; the park is where the sum of bumps is high.
  function fieldSeeds(j, rng, R) {
    const seeds = [];
    const arms = armsOf(j);
    const dirs = [];
    for (const p of arms) {
      const reach = R * rng.range(0.5, 1.9);
      let s = 0;
      let k = 1;
      const end = p[Math.min(p.length - 1, 4)];
      dirs.push(Math.atan2(end[1] - j.y, end[0] - j.x));
      for (let i = 1; i < p.length && s < reach; i++) {
        s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
        if (s < k * FINGER_STEP) continue;
        k++;
        const t = s / reach;
        const gw = greenwayWidth(p[i][0], p[i][1]) * 0.62;
        seeds.push([p[i][0], p[i][1], R * 0.5 * (1 - t) ** 1.3 + gw * t]);
      }
    }
    // Main body, a little off the junction.
    const a0 = rng.range(0, Math.PI * 2);
    const o0 = R * rng.range(0, 0.25);
    seeds.push([j.x + Math.cos(a0) * o0, j.y + Math.sin(a0) * o0, R * rng.range(0.55, 0.8)]);
    // Lobes into the land between greenways.
    dirs.sort((a, b) => a - b);
    const gaps = dirs.map((d, i) => {
      const next = i + 1 < dirs.length ? dirs[i + 1] : dirs[0] + Math.PI * 2;
      return [d + (next - d) / 2, next - d];
    });
    const lobes = rng.int(1, 3);
    for (let i = 0; i < lobes && gaps.length; i++) {
      const [mid, width] = gaps[rng.int(0, gaps.length - 1)];
      const a = mid + (rng.next() - 0.5) * width * 0.5;
      const d = R * rng.range(0.35, 0.85);
      seeds.push([j.x + Math.cos(a) * d, j.y + Math.sin(a) * d, R * rng.range(0.28, 0.55)]);
    }
    return seeds;
  }

  // How far each ray can go before it meets an obstacle (sphere tracing).
  function limits(j, obs, reach) {
    const hard = new Float64Array(RAYS);
    for (let i = 0; i < RAYS; i++) {
      const a = (i / RAYS) * Math.PI * 2;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      hard[i] = Infinity;
      for (let r = 40; r < reach; ) {
        const g = obs.gap(j.x + cx * r, j.y + cy * r);
        if (g < 0) {
          hard[i] = r;
          break;
        }
        r += Math.max(4, g);
      }
    }
    return hard;
  }

  function outline(j, seeds, scale, hard, maxR) {
    const S = seeds.map(([x, y, r]) => [j.x + (x - j.x) * scale, j.y + (y - j.y) * scale, 1 / (r * scale) ** 2]);
    const field = (x, y) => {
      let f = 0;
      for (const [sx, sy, k] of S) {
        const d2 = ((x - sx) ** 2 + (y - sy) ** 2) * k;
        if (d2 < 9) f += Math.exp(-d2);
      }
      return f;
    };
    const soft = new Float64Array(RAYS);
    for (let i = 0; i < RAYS; i++) {
      const a = (i / RAYS) * Math.PI * 2;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      // Coarse steps out to the edge, then halve back onto it.
      const inside = (r) => field(j.x + cx * r, j.y + cy * r) >= Math.exp(-1);
      let r = RAY_STEP;
      while (r < maxR * scale && r < hard[i] && inside(r)) r += RAY_STEP;
      let lo = Math.max(0, r - RAY_STEP);
      for (let k = 0; k < 3; k++) {
        const m = (lo + r) / 2;
        if (inside(m)) lo = m;
        else r = m;
      }
      soft[i] = Math.min(r, hard[i]);
    }
    // Smooth the soft edge; never push past an obstacle.
    let r = soft;
    for (let pass = 0; pass < 3; pass++) {
      const n = new Float64Array(RAYS);
      for (let i = 0; i < RAYS; i++) n[i] = 0.25 * r[(i + RAYS - 1) % RAYS] + 0.5 * r[i] + 0.25 * r[(i + 1) % RAYS];
      r = n;
    }
    const pts = [];
    for (let i = 0; i < RAYS; i++) {
      const a = (i / RAYS) * Math.PI * 2;
      const rr = Math.max(20, Math.min(r[i], hard[i]));
      pts.push([j.x + Math.cos(a) * rr, j.y + Math.sin(a) * rr]);
    }
    return pts;
  }

  function shapeOf(j) {
    let p = shapes.get(j.key);
    if (p !== undefined) return p;
    const rng = rngFor(seed, 'park', j.i, j.j);
    const target = rng.range(PARK_AREA_HA[0], PARK_AREA_HA[1]) * 1e4;
    const R = Math.sqrt(target / Math.PI);
    const seeds = fieldSeeds(j, rng, R);
    const maxR = R * 2.1;
    const hard = limits(j, obstacles(j, maxR * 1.6), maxR * 1.5);
    let scale = 1;
    let shape = outline(j, seeds, scale, hard, maxR);
    for (let it = 0; it < 1; it++) {
      const a = polygonArea(shape);
      scale *= Math.min(1.6, Math.max(0.6, Math.sqrt(target / a)));
      shape = outline(j, seeds, scale, hard, maxR);
    }
    const area = polygonArea(shape);
    p = area < MIN_AREA_HA * 1e4 ? null : { key: j.key, x: j.x, y: j.y, area, shape, districts: j.labels };
    shapes.set(j.key, p);
    return p;
  }

  // Parks around a district.
  function parksOf(b) {
    return b.junctions.filter(isPark).map(shapeOf).filter(Boolean);
  }

  return { parksOf, isPark, eligible };
}
