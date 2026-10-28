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
// In the inner city the waterfront is made for people: a river's lower
// banks are paved promenades (Paris) with plazas at the water's edge
// (Porto) every so often, or here and there a boardwalk out over the water
// (the Bund); the shore is a quay (Sydney) with piers. Further out the
// banks have their trails, the shore its beaches, and here and there bluffs.
//
// Everything is a pure function of the stretch of greenway, so the two
// districts either side draw the same thing.

import { hash, hashString, toUnit } from '../core/hash.js';
import { LruCache } from './cache.js';
import { createNoise } from '../core/noise.js';
import { resample, chaikin } from '../util/geom.js';

const STEP = 6; // metres between points along a greenway
const STREAM_WIDTH = [4, 7];
const JOIN = 70; // metres downstream of a junction a tributary stream joins the main one
const TRIB_REACH = 110; // metres out along it that a tributary starts to swing round
export const TRAIL_WIDTH = 4;

const BANK_PATH = 0.45; // the bank paths' place across the bank, from the water
const SHORE_PATH = 10; // metres from the water's edge to the promenade (or from the back of the beach)
export const BEACH = 24; // metres of sand from the water's edge
export const QUAY = 18; // metres of paved promenade along the water's edge
const PLAZA_EVERY = 520; // metres along a river between plazas at the water
const PLAZA = [64, 30]; // metres: a plaza at the water, along and back from it
const BOARDWALK = 0.3; // share of inner river stretches with a boardwalk
const BOARDWALK_OUT = 4; // metres out over the water
const PIER_EVERY = 900; // metres along an inner shore between piers, about
const PIER = [130, 260]; // metres long
const PIER_END = 150; // metres a pier keeps from the ends of its stretch
const BLUFFS = 0.42; // noise above which an outer shore without sand is bluffs

export function createGreenways(seed, { greenwayWidth, terrain = null, armsAt = () => [], inner = () => false, innerShore = inner }) {
  const cache = new LruCache(4000);
  const drift = createNoise(seed, 'stream-drift');
  const beachNoise = createNoise(seed, 'beaches');

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
      const central = P.map(([x, y]) => inner(x, y));
      const widths = P.map((q) => {
        const r = terrain.nearestRiver(q[0], q[1]);
        return r ? r.width : 0;
      });
      // Along each bank, this far out from the water, over the runs of
      // the stretch wanted.
      const along = (sd, o, want = () => true) => {
        const out = [];
        let cur = null;
        for (let i = 0; i < n; i++) {
          if (!want(i)) {
            cur = null;
            continue;
          }
          if (!cur) out.push((cur = []));
          cur.push([P[i][0] + N[i][0] * sd * (widths[i] / 2 + o), P[i][1] + N[i][1] * sd * (widths[i] / 2 + o)]);
        }
        return out.filter((r) => r.length > 3).map((r) => chaikin(r, false));
      };
      if (central.some(Boolean)) {
        // In the inner city: paved lower banks, the promenade along them;
        // plazas at the water, by turns on either bank; a boardwalk on one
        // bank now and then. Further out along it, the bank paths.
        const inside = (i) => central[i];
        const outside = (i) => !central[i];
        const quays = [1, -1].flatMap((sd) => along(sd, 0, inside));
        const plazas = [];
        for (let s = PLAZA_EVERY * (0.3 + 0.4 * u(30)), k = 0; s < L - PLAZA[0]; s += PLAZA_EVERY, k++) {
          const i = Math.round(s / STEP);
          if (!central[i]) continue;
          const sd = k % 2 ? 1 : -1;
          const t = [-N[i][1], N[i][0]];
          const e = widths[i] / 2;
          const at = (a, b) => [P[i][0] + t[0] * a + N[i][0] * sd * (e + b), P[i][1] + t[1] * a + N[i][1] * sd * (e + b)];
          plazas.push([at(-PLAZA[0] / 2, 0), at(PLAZA[0] / 2, 0), at(PLAZA[0] / 2, PLAZA[1]), at(-PLAZA[0] / 2, PLAZA[1])]);
        }
        const boardwalks = u(31) < BOARDWALK ? along(u(32) < 0.5 ? 1 : -1, -BOARDWALK_OUT, inside) : [];
        // (The way along runs down the middle of the promenade.)
        const trails = [...[1, -1].flatMap((sd) => along(sd, QUAY / 2, inside)), ...[1, -1].flatMap((sd) => along(sd, bank * BANK_PATH, outside))];
        return { stream: null, trail: trails[0], trails, centre: P, half, side: 1, water: 'river', quays, plazas, boardwalks };
      }
      const trails = [1, -1].flatMap((sd) => along(sd, bank * BANK_PATH));
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
      // On the ocean, much of the shore is beach: sand from the water's
      // edge, the promenade behind it.
      // (In the inner city, a quay instead.)
      const central = P.map(([x, y]) => innerShore(x, y));
      const sandy = P.map(([x, y], i) => !central[i] && terrain.ocean && beachNoise.fbm(x / 900, y / 900, 2) > -0.1);
      const off = half.map((h, i) => sd * (sandy[i] ? h - BEACH - SHORE_PATH : Math.max(0, h - SHORE_PATH)));
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
      const beaches = [];
      let run = null;
      for (let i = 0; i < n; i++) {
        if (!sandy[i]) {
          run = null;
          continue;
        }
        // (Along the water's edge; drawn twice as wide, the water covers the outer half.)
        const o = sd * (half[i] - 8);
        if (!run) beaches.push((run = []));
        run.push([P[i][0] + N[i][0] * o, P[i][1] + N[i][1] * o]);
      }
      // Runs of the shore: quays in the inner city (with piers), bluffs
      // here and there further out where there is no sand. (At the water's
      // edge, found along each normal.)
      const edge = P.map((q, i) => {
        let lo = 0;
        let hi = half[i] * 1.6 + 40;
        if (terrain.shore(q[0] + N[i][0] * sd * hi, q[1] + N[i][1] * sd * hi) > 0) return null;
        for (let k = 0; k < 14; k++) {
          const m = (lo + hi) / 2;
          if (terrain.shore(q[0] + N[i][0] * sd * m, q[1] + N[i][1] * sd * m) > 0) lo = m;
          else hi = m;
        }
        return lo;
      });
      const runsOf = (want) => {
        const out = [];
        let cur = null;
        for (let i = 0; i < n; i++) {
          if (!want(i) || edge[i] === null) {
            cur = null;
            continue;
          }
          if (!cur) out.push((cur = []));
          // (On the water's edge: drawn twice as wide, the water covers the
          // outer half, so it meets the water wherever that is drawn.)
          const o = sd * edge[i];
          cur.push([P[i][0] + N[i][0] * o, P[i][1] + N[i][1] * o]);
        }
        return out.filter((r) => r.length > 3).map((r) => chaikin(r, false));
      };
      const quays = runsOf((i) => central[i]);
      const bluffs = runsOf((i) => !central[i] && !sandy[i] && beachNoise.fbm(P[i][0] / 1500 + 40, P[i][1] / 1500, 2) > BLUFFS);
      const piers = [];
      for (let s = PIER_EVERY * (0.3 + 0.5 * u(33)), k = 0; s < L; s += PIER_EVERY * (0.7 + 0.6 * u(34, k)), k++) {
        const i = Math.round(s / STEP);
        // (Not by the ends of the stretch, where the next one's may be.)
        if (!central[i] || edge[i] === null || s < PIER_END || s > L - PIER_END) continue;
        const e = [P[i][0] + N[i][0] * sd * (edge[i] - 6), P[i][1] + N[i][1] * sd * (edge[i] - 6)];
        const l = PIER[0] + (PIER[1] - PIER[0]) * u(35, k);
        piers.push([e, [e[0] + N[i][0] * sd * l, e[1] + N[i][1] * sd * l]]);
      }
      return { stream: null, trail, trails: [trail], centre: P, half, side: sd, water: 'sea', beaches: beaches.filter((b) => b.length > 3).map((b) => chaikin(b, false)), quays, bluffs, piers };
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
    let stream = P.map((q, i) => [q[0] + N[i][0] * mOff[i], q[1] + N[i][1] * mOff[i]]);
    // Where three or more greenways meet, the two that run most nearly
    // straight on carry the stream through; any other is a tributary,
    // curving round to join it a little downstream rather than meeting it
    // square at the junction.
    for (const [end, k] of (geo.ends || []).map((k, e) => [e, k])) {
      const arms = armsAt(k);
      if (arms.length < 3) continue;
      let pair = null;
      for (let a = 0; a < arms.length; a++) {
        for (let b = a + 1; b < arms.length; b++) {
          const dd = arms[a].dir[0] * arms[b].dir[0] + arms[a].dir[1] * arms[b].dir[1];
          if (!pair || dd < pair.dd || (dd === pair.dd && arms[a].key + arms[b].key < pair.k)) pair = { dd, a: arms[a], b: arms[b], k: arms[a].key + arms[b].key };
        }
      }
      if (!pair || pair.a.key === geo.key || pair.b.key === geo.key) continue;
      const mine = arms.find((q) => q.key === geo.key);
      if (!mine) continue;
      // Join the main stream on the side it flows on with this one.
      const t = mine.dir;
      const m = [pair.a, pair.b].sort((x, y) => (x.dir[0] * -t[0] + x.dir[1] * -t[1] > y.dir[0] * -t[0] + y.dir[1] * -t[1] ? -1 : 1))[0];
      const J = [mine.p[0] + m.dir[0] * JOIN, mine.p[1] + m.dir[1] * JOIN];
      // The last stretch of this stream, from REACH out, swung round to J.
      const S = end === 0 ? stream : stream.slice().reverse();
      const iFrom = Math.min(S.length - 1, Math.ceil(TRIB_REACH / STEP));
      const A = S[iFrom];
      const c1 = [A[0] - t[0] * TRIB_REACH * 0.45, A[1] - t[1] * TRIB_REACH * 0.45];
      const c2 = [J[0] - m.dir[0] * JOIN * 0.6, J[1] - m.dir[1] * JOIN * 0.6];
      const bend = [];
      for (let q = 0; q <= 16; q++) {
        const u0 = q / 16;
        const v0 = 1 - u0;
        bend.push([0, 1].map((c) => v0 ** 3 * A[c] + 3 * v0 * v0 * u0 * c1[c] + 3 * v0 * u0 * u0 * c2[c] + u0 ** 3 * J[c]));
      }
      const joined = bend.reverse().concat(S.slice(iFrom + 1));
      stream = end === 0 ? joined : joined.reverse();
    }
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
