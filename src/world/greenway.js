// Stage 5: what is in a primary greenway. The whole strip is left natural
// (meadow and woodland) but for a stream and a trail:
//
//   - the stream winds down the middle in meanders about as long as the
//     greenway is wide, swinging about a quarter of that each way, so it runs
//     about one and a half times the greenway's length (the meander shape
//     natural streams settle into); it takes heavy rain off the streets;
//   - the trail, wide enough for people walking and cycling both ways, runs
//     along one side, following the stream's bends loosely;
//   - woodland comes in patches.
//
// Everything is a pure function of the stretch of greenway, so the two
// districts either side draw the same thing.

import { hash, hashString, toUnit } from '../core/hash.js';
import { createNoise } from '../core/noise.js';
import { LruCache } from './cache.js';
import { resample, chaikin } from '../util/geom.js';

const STEP = 6; // metres between points along a greenway
const STREAM_WIDTH = [4, 7];
export const TRAIL_WIDTH = 4;
const TREE_GRID = 13;

export function createGreenways(seed, { greenwayWidth }) {
  const cache = new LruCache(4000);
  const woods = createNoise(seed, 'greenway-woods');

  function of(geo) {
    let g = cache.get(geo.key);
    if (g) return g;
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
    // The trail keeps to one side.
    const side = u(1) < 0.5 ? 1 : -1;
    const L = (n - 1) * STEP;
    // The stream: a sine-generated curve, the shape meanders settle into.
    // Its heading swings ±OMEGA either side of down the valley over each
    // meander (whose length follows the greenway's width), so it runs about
    // 1/J0(OMEGA) = 1.5 times as far as the valley. Walked out in valley
    // coordinates (x down the valley, y across), then laid on the
    // centreline, squeezed if a loop would leave the greenway.
    const OMEGA = 1.22;
    const ph = u(2) * Math.PI * 2;
    const vary = u(3) * 1000;
    const halfAt = (x) => half[Math.max(0, Math.min(n - 1, Math.round(x / STEP)))];
    const walk = [];
    {
      let x = 0;
      let y = 0;
      let phase = ph;
      for (let guard = 0; x < L && guard < 20000; guard++) {
        const h = halfAt(x);
        const M = Math.max(110, Math.min(400, 1.7 * 2 * h)) * (0.85 + 0.3 * (0.5 + 0.5 * Math.sin(x / 700 + vary)));
        const th = OMEGA * Math.sin(phase);
        x += Math.cos(th) * 2;
        y += Math.sin(th) * 2;
        phase += (2 * Math.PI * 2) / M;
        walk.push([x, y]);
      }
    }
    // Centre the swings (the walk drifts), then fit them in.
    const ys = walk.map((q) => q[1]);
    const mean = (i) => {
      let a = 0;
      let c = 0;
      for (let j = Math.max(0, i - 120); j <= Math.min(ys.length - 1, i + 120); j += 4) {
        a += ys[j];
        c++;
      }
      return a / c;
    };
    const mAt = new Float64Array(n);
    const raw = walk.map((q, i) => [q[0], q[1] - mean(i)]);
    // How far the loops swing nearby, so a stretch can be scaled to fit
    // (keeping its shape) rather than cut off.
    const reach = raw.map((_, i) => {
      let m = 0;
      for (let j = Math.max(0, i - 150); j <= Math.min(raw.length - 1, i + 150); j += 3) m = Math.max(m, Math.abs(raw[j][1]));
      return m || 1;
    });
    const stream = [];
    for (const [k, [x, y0]] of raw.entries()) {
      const i = Math.max(0, Math.min(n - 1, Math.round(x / STEP)));
      const h = half[i];
      const room = Math.max(2, h - 20);
      const fade = Math.max(0, Math.min(1, x / 70, (L - x) / 70));
      const y = y0 * Math.min(1, room / reach[k]) * fade - side * Math.min(6, h * 0.1);
      mAt[i] = y;
      // (Between centreline points, so the stream does not step.)
      const f = Math.max(0, Math.min(n - 1.001, x / STEP));
      const i0 = Math.floor(f);
      const t = f - i0;
      const lerp = (A, j) => A[i0][j] + (A[i0 + 1][j] - A[i0][j]) * t;
      stream.push([lerp(P, 0) + lerp(N, 0) * y, lerp(P, 1) + lerp(N, 1) * y]);
    }
    for (let i = 1; i < n; i++) if (!mAt[i]) mAt[i] = mAt[i - 1];
    const trail = [];
    const mOff = Array.from(mAt);
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
    for (let i = 0; i < n; i++) trail.push([P[i][0] + N[i][0] * tSm[i], P[i][1] + N[i][1] * tSm[i]]);
    // Woodland in patches, clear of the stream and trail.
    const trees = [];
    let acc = 0;
    for (let i = 0; i < n; i++) {
      if (i) acc += STEP;
      if (acc < TREE_GRID && i) continue;
      acc = 0;
      for (let o = -half[i] + 7; o <= half[i] - 7; o += TREE_GRID) {
        const j = (o * 7.3 + i * 3.1) % 1;
        const off = o + (u(10, i, Math.round(o)) - 0.5) * 6;
        const q = [P[i][0] + N[i][0] * off, P[i][1] + N[i][1] * off];
        if (Math.abs(off - mOff[i]) < 9 || Math.abs(off - tSm[i]) < 7) continue;
        if (woods.fbm(q[0] / 240, q[1] / 240, 2) + j * 0 < 0.05) continue;
        trees.push(q);
      }
    }
    g = {
      stream: chaikin(resample(stream, 4), false),
      trail: chaikin(trail, false),
      streamWidth: STREAM_WIDTH[0] + u(4) * (STREAM_WIDTH[1] - STREAM_WIDTH[0]),
      trees,
      centre: P,
      half,
      side,
    };
    cache.set(geo.key, g);
    return g;
  }

  return { of };
}
