// District cores, placed first. Each cell of a jittered grid offers one
// candidate with a random priority and its own spacing radius (so district
// sizes vary). A candidate becomes a core if no better candidate is closer
// than the two radii allow; a second round fills the gaps the first round
// left. Every step looks only at nearby candidates, so the result never
// depends on where generation started.

import { hash, toUnit } from '../core/hash.js';
import { LruCache } from './cache.js';

export const CORE_SPACING = 1650; // metres, minimum distance between cores
export const CORE_SPACING_MAX = 2350; // the widest a candidate's spacing can be
export const CORE_CHUNK = 6000; // cores are indexed in square chunks this size
const CELL = 700; // candidate grid

export function createCores(seed) {
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
    for (let fy = Math.floor(y0 / CELL); fy * CELL < y1; fy++) {
      for (let fx = Math.floor(x0 / CELL); fx * CELL < x1; fx++) {
        const x = (fx + 0.1 + 0.8 * toUnit(hash(seed, 'core-x', fx, fy))) * CELL;
        const y = (fy + 0.1 + 0.8 * toUnit(hash(seed, 'core-y', fx, fy))) * CELL;
        if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
        // Size variety: a skewed spread of spacings, mostly near the minimum.
        const u = toUnit(hash(seed, 'core-size', fx, fy));
        const spacing = CORE_SPACING + (CORE_SPACING_MAX - CORE_SPACING) * u * u;
        list.push({ key: `f${fx}.${fy}`, x, y, spacing, pri: toUnit(hash(seed, 'core-pri', fx, fy)) });
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
  // Two candidates conflict when closer than the larger of their spacings.
  const conflict = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < Math.max(a.spacing, b.spacing) ** 2;
  const rivals = (c) => candidatesNear(c.x, c.y, CORE_SPACING_MAX).filter((o) => o !== c && conflict(o, c));

  // Round one: the best candidate among those it conflicts with.
  function round1(c) {
    const k = `1:${c.key}`;
    let v = status.get(k);
    if (v === undefined) {
      v = !rivals(c).some((o) => better(o, c));
      status.set(k, v);
    }
    return v;
  }

  // Round two: clear of every round-one core, and best among such candidates.
  function eligible2(c) {
    const k = `e:${c.key}`;
    let v = status.get(k);
    if (v === undefined) {
      v = !round1(c) && !rivals(c).some(round1);
      status.set(k, v);
    }
    return v;
  }

  function isCore(c) {
    if (round1(c)) return true;
    if (!eligible2(c)) return false;
    return !rivals(c).some((o) => better(o, c) && eligible2(o));
  }

  // Selected cores in a chunk, each with a head start for district growth.
  function coresIn(cx, cy) {
    const key = `${cx},${cy}`;
    let list = coreChunks.get(key);
    if (list) return list;
    list = candidatesIn(cx, cy)
      .filter(isCore)
      .map((c) => ({ ...c, headStart: 900 * toUnit(hash(seed, 'core-head', ...keyInts(c))) - (c.spacing - CORE_SPACING) * 0.5 }));
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

  return { candidatesIn, coresIn, coresInRect };
}

// Integers identifying a core, for hashing.
export function keyInts(c) {
  return c.key.slice(1).split('.').map(Number).concat([c.key.charCodeAt(0)]);
}
