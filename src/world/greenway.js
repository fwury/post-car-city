// Stage 5: what is in a primary greenway. The whole strip is left natural
// (meadow and woodland) but for a stream and a trail:
//
//   - the stream runs down the middle, drifting a little off it and back
//     as a small river does; it takes heavy rain off the streets;
//   - the trail, wide enough for people walking and cycling both ways, runs
//     along one side, following the stream's bends loosely;
//
// Along a river the river takes the stream's place, with a path along each
// bank; along the shore there is a promenade by the water.
//
// Everything is a pure function of the stretch of greenway, so the two
// districts either side draw the same thing.

import { hash, hashString, toUnit } from '../core/hash.js';
import { LruCache } from './cache.js';
import { createNoise } from '../core/noise.js';
import { resample, chaikin } from '../util/geom.js';

const STEP = 6; // metres between points along a greenway
const STREAM_WIDTH = [4, 7];
export const TRAIL_WIDTH = 4;

const BANK_PATH = 0.45; // the bank paths' place across the bank, from the water
const SHORE_PATH = 10; // metres from the water's edge to the promenade

export function createGreenways(seed, { greenwayWidth, terrain = null }) {
  const cache = new LruCache(4000);
  const drift = createNoise(seed, 'stream-drift');

  // A line split where it runs into water: the pieces on land.
  const dry = (L) => {
    if (!terrain) return [L];
    const out = [];
    let cur = [];
    for (const q of L) {
      if (terrain.isWater(q[0], q[1])) {
        if (cur.length > 1) out.push(cur);
        cur = [];
      } else cur.push(q);
    }
    if (cur.length > 1) out.push(cur);
    return out;
  };
  const longest = (list) => list.reduce((a, b) => (b.length > a.length ? b : a), []);

  function of(geo) {
    let g = cache.get(geo.key);
    if (g) return g;
    g = shape(geo);
    // Streams run into the water; paths stop at its edge.
    g.streams = g.stream ? dry(g.stream) : [];
    g.trails = g.trails.flatMap(dry);
    g.trail = longest(g.trails);
    cache.set(geo.key, g);
    return g;
  }

  function shape(geo) {
    let g;
    const P = resample(geo.points, STEP);
    const n = P.length;
    const k = hashString(geo.key);
    const u = (...x) => toUnit(hash(seed, 'greenway', k, ...x));
    // Normals and half-widths along the centreline.
    const N = [];
    const half = [];
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)];
      const b = P[Math.min(n - 1, i + 1)];
      const t = [b[0] - a[0], b[1] - a[1]];
      const l = Math.hypot(t[0], t[1]) || 1;
      N.push([-t[1] / l, t[0] / l]);
      half.push(greenwayWidth(P[i][0], P[i][1]) / 2);
    }
    const L = (n - 1) * STEP;
    if (terrain && geo.kind === 'river') {
      const bank = terrain.BANK;
      const trails = [1, -1].map((sd) => {
        const T = P.map((q, i) => {
          const r = terrain.nearestRiver(q[0], q[1]);
          const o = sd * ((r ? r.width / 2 : 0) + bank * BANK_PATH);
          return [q[0] + N[i][0] * o, q[1] + N[i][1] * o];
        });
        return chaikin(T, false);
      });
      return { stream: null, trail: trails[0], trails, centre: P, half, side: 1, water: 'river' };
    }
    if (terrain && geo.kind === 'shore') {
      // The sea lies on the side where the shore is nearer.
      let s = 0;
      for (let i = 0; i < n; i += 5) {
        const q = P[i];
        s += terrain.shore(q[0] + N[i][0] * 20, q[1] + N[i][1] * 20) - terrain.shore(q[0] - N[i][0] * 20, q[1] - N[i][1] * 20);
      }
      const sd = s < 0 ? 1 : -1;
      const off = half.map((h) => sd * Math.max(0, h - SHORE_PATH));
      const sm = off.map((_, i) => {
        let a = 0;
        let c = 0;
        for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) {
          a += off[j];
          c++;
        }
        return a / c;
      });
      const trail = chaikin(P.map((q, i) => [q[0] + N[i][0] * sm[i], q[1] + N[i][1] * sm[i]]), false);
      return { stream: null, trail, trails: [trail], centre: P, half, side: sd, water: 'sea' };
    }
    // The trail keeps to one side.
    const side = u(1) < 0.5 ? 1 : -1;
    // The stream: near the middle, drifting off it a little and back as the
    // ground lies, the way a small river does, not in regular swings. Its
    // offset follows noise in world coordinates (so it does not depend on
    // which way the stretch is walked), up to about a quarter of the half
    // width, easing to the middle at each end, where it meets the streams
    // of the stretches beyond.
    const mOff = new Array(n);
    for (let i = 0; i < n; i++) {
      const [x, y] = P[i];
      const wander = drift.fbm(x / 420, y / 420, 3, 2.1, 0.5) * 1.6 + drift.fbm(x / 130 + 17.3, y / 130, 2) * 0.35;
      const amp = Math.min(14, half[i] * 0.28);
      const s0 = i * STEP;
      const fade = Math.min(1, s0 / 90, (L - s0) / 90);
      mOff[i] = Math.max(-1, Math.min(1, wander)) * amp * Math.max(0, fade);
    }
    // Smoothed, so it bends gently.
    for (let r = 0; r < 3; r++) for (let i = 1; i < n - 1; i++) mOff[i] = (mOff[i - 1] + 2 * mOff[i] + mOff[i + 1]) / 4;
    const stream = P.map((q, i) => [q[0] + N[i][0] * mOff[i], q[1] + N[i][1] * mOff[i]]);
    const trail = [];
    const tOff = mOff.map((m, i) => side * Math.max(half[i] * 0.55, Math.min(half[i] - 9, Math.abs(m) + 16)) + m * 0.2);
    // Smooth the trail's offsets so it bends less than the stream.
    const tSm = tOff.map((_, i) => {
      let a = 0;
      let c = 0;
      for (let j = Math.max(0, i - 6); j <= Math.min(n - 1, i + 6); j++) {
        a += tOff[j];
        c++;
      }
      return a / c;
    });
    // The trail eases to the middle at each end too, so where greenways meet
    // their trails meet, at the joining of their streams (a footbridge).
    for (let i = 0; i < n; i++) {
      const s0 = i * STEP;
      const f = Math.max(0, Math.min(1, s0 / 70, (L - s0) / 70));
      const o = tSm[i] * (f * f * (3 - 2 * f));
      trail.push([P[i][0] + N[i][0] * o, P[i][1] + N[i][1] * o]);
    }
    g = {
      stream: chaikin(stream, false),
      trail: chaikin(trail, false),
      trails: null,
      streamWidth: STREAM_WIDTH[0] + u(4) * (STREAM_WIDTH[1] - STREAM_WIDTH[0]),
      centre: P,
      half,
      side,
    };
    g.trails = [g.trail];
    return g;
  }

  return { of };
}
