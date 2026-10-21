// District cores, placed after the routes, the way towns grew at crossroads.
//
// Candidates, best first:
//   1. route crossings
//   2. points along a route, every 1.5 km
//   3. a sparse jittered fill, for the rare gaps between routes (these get
//      short spur boulevards to the nearest routes)
// A candidate becomes a core if no better candidate lies within CORE_SPACING.
// A second round fills gaps the first round left. Every step looks only at
// nearby candidates, so the result never depends on where generation started.

import { hash, toUnit } from '../core/hash.js';
import { LruCache } from './cache.js';
import { FAMILIES, ROUTE_SPACING } from './routes.js';

export const CORE_SPACING = 2000; // metres, minimum distance between cores
export const CORE_CHUNK = 6000; // cores are indexed in square chunks this size
const LINE_STEP = 1500;
const FILL_CELL = 1800;

export function createCores(seed, routes) {
  const candChunks = new LruCache(4000);
  const coreChunks = new LruCache(4000);
  const status = new LruCache(200000);

  // All candidates whose position lies in a chunk.
  function candidatesIn(cx, cy) {
    const key = `${cx},${cy}`;
    let list = candChunks.get(key);
    if (list) return list;
    list = [];
    const x0 = cx * CORE_CHUNK;
    const y0 = cy * CORE_CHUNK;
    const x1 = x0 + CORE_CHUNK;
    const y1 = y0 + CORE_CHUNK;
    const inside = (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;

    const rs = [];
    for (let k = 0; k < FAMILIES; k++) rs.push(routes.ranges(k, x0, y0, x1, y1));
    for (let i = 0; i < FAMILIES; i++) {
      for (let j = i + 1; j < FAMILIES; j++) {
        for (let a = rs[i].n0; a <= rs[i].n1; a++) {
          if (!routes.exists(i, a)) continue;
          for (let b = rs[j].n0; b <= rs[j].n1; b++) {
            if (!routes.exists(j, b)) continue;
            const [x, y] = routes.crossing(i, a, j, b);
            if (!inside(x, y)) continue;
            list.push({
              key: `x${i}.${a}.${j}.${b}`, x, y, type: 'crossing',
              routes: [[i, a], [j, b]],
              pri: 2 + toUnit(hash(seed, 'core-pri-x', i, a, j, b)),
            });
          }
        }
      }
    }
    for (let k = 0; k < FAMILIES; k++) {
      const r = rs[k];
      for (let n = r.n0; n <= r.n1; n++) {
        if (!routes.exists(k, n)) continue;
        for (let m = Math.floor(r.t0 / LINE_STEP); m <= Math.ceil(r.t1 / LINE_STEP); m++) {
          const [x, y] = routes.pointOn(k, n, m * LINE_STEP);
          if (!inside(x, y)) continue;
          list.push({
            key: `l${k}.${n}.${m}`, x, y, type: 'route',
            routes: [[k, n]],
            pri: 1 + toUnit(hash(seed, 'core-pri-l', k, n, m)),
          });
        }
      }
    }
    const f0x = Math.floor(x0 / FILL_CELL);
    const f0y = Math.floor(y0 / FILL_CELL);
    for (let fy = f0y; fy * FILL_CELL < y1; fy++) {
      for (let fx = f0x; fx * FILL_CELL < x1; fx++) {
        const x = (fx + 0.2 + 0.6 * toUnit(hash(seed, 'core-fill-x', fx, fy))) * FILL_CELL;
        const y = (fy + 0.2 + 0.6 * toUnit(hash(seed, 'core-fill-y', fx, fy))) * FILL_CELL;
        if (!inside(x, y)) continue;
        list.push({ key: `f${fx}.${fy}`, x, y, type: 'fill', routes: [], pri: toUnit(hash(seed, 'core-pri-f', fx, fy)) });
      }
    }
    candChunks.set(key, list);
    return list;
  }

  function candidatesNear(x, y, r) {
    const out = [];
    const cx0 = Math.floor((x - r) / CORE_CHUNK);
    const cy0 = Math.floor((y - r) / CORE_CHUNK);
    const cx1 = Math.floor((x + r) / CORE_CHUNK);
    const cy1 = Math.floor((y + r) / CORE_CHUNK);
    const r2 = r * r;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (const c of candidatesIn(cx, cy)) {
          if ((c.x - x) ** 2 + (c.y - y) ** 2 <= r2) out.push(c);
        }
      }
    }
    return out;
  }

  const better = (a, b) => a.pri > b.pri || (a.pri === b.pri && a.key > b.key);

  // Round one: the best candidate within CORE_SPACING.
  function round1(c) {
    const k = `1:${c.key}`;
    let v = status.get(k);
    if (v === undefined) {
      v = !candidatesNear(c.x, c.y, CORE_SPACING).some((o) => o !== c && better(o, c));
      status.set(k, v);
    }
    return v;
  }

  // Round two: away from every round-one core, and best among such candidates.
  function eligible2(c) {
    const k = `e:${c.key}`;
    let v = status.get(k);
    if (v === undefined) {
      v = !round1(c) && !candidatesNear(c.x, c.y, CORE_SPACING).some((o) => o !== c && round1(o));
      status.set(k, v);
    }
    return v;
  }

  function isCore(c) {
    if (round1(c)) return true;
    if (!eligible2(c)) return false;
    return !candidatesNear(c.x, c.y, CORE_SPACING).some((o) => o !== c && better(o, c) && eligible2(o));
  }

  // Selected cores in a chunk, each with a head start for district growth.
  function coresIn(cx, cy) {
    const key = `${cx},${cy}`;
    let list = coreChunks.get(key);
    if (list) return list;
    list = candidatesIn(cx, cy)
      .filter(isCore)
      .map((c) => ({ ...c, headStart: 700 * toUnit(hash(seed, 'core-head', ...keyInts(c))) }));
    coreChunks.set(key, list);
    return list;
  }

  function coresInRect(x0, y0, x1, y1) {
    const out = [];
    for (let cy = Math.floor(y0 / CORE_CHUNK); cy <= Math.floor(y1 / CORE_CHUNK); cy++) {
      for (let cx = Math.floor(x0 / CORE_CHUNK); cx <= Math.floor(x1 / CORE_CHUNK); cx++) {
        for (const c of coresIn(cx, cy)) if (c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1) out.push(c);
      }
    }
    return out;
  }

  const byKey = new LruCache(100000);

  // Look a core up by key (its position identifies its chunk).
  function core(key, x, y) {
    let c = byKey.get(key);
    if (!c) {
      c = coresIn(Math.floor(x / CORE_CHUNK), Math.floor(y / CORE_CHUNK)).find((o) => o.key === key);
      if (c) byKey.set(key, c);
    }
    return c;
  }

  // Short boulevards from a fill core to the nearest routes of two families.
  function spurs(c) {
    if (c.type !== 'fill') return [];
    if (c.spurs) return c.spurs;
    const options = [];
    for (let k = 0; k < FAMILIES; k++) {
      const r = routes.nearest(k, c.x, c.y);
      if (r && r.d < ROUTE_SPACING * 1.5) options.push({ k, n: r.n, d: r.d });
    }
    options.sort((a, b) => a.d - b.d);
    c.spurs = options.slice(0, 2).map(({ k, n }) => {
      const [ex, ey] = routes.project(k, n, c.x, c.y);
      const pts = [];
      const steps = Math.max(2, Math.ceil(Math.hypot(ex - c.x, ey - c.y) / 50));
      for (let i = 0; i <= steps; i++) pts.push([c.x + ((ex - c.x) * i) / steps, c.y + ((ey - c.y) * i) / steps]);
      return { key: `${c.key}>${k}.${n}`, points: pts };
    });
    return c.spurs;
  }

  return { candidatesIn, coresIn, coresInRect, core, spurs };
}

// Integers identifying a core, for hashing.
export function keyInts(c) {
  return c.key.slice(1).split('.').map(Number).concat([c.key.charCodeAt(0)]);
}
