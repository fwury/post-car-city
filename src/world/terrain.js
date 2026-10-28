// The city's site: how big it is and what it is built on.
//
// A seed picks a kind of site, in about the shares major cities have them:
// on flat land with no river (Mexico City), on a river (Paris, London,
// Cairo), where two rivers meet (Pittsburgh, Belgrade, Khartoum), where a
// river flows into the sea or a great lake (New York, Shanghai, Buenos
// Aires), or on the shore of one (Toronto, San Francisco, Rio, Athens). A
// shore may have a peninsula the city stands on or reaches out along, and
// an island cut off by a channel; an ocean shore has beaches. Any city may
// be bounded on one side by a mountain range. The population picks how
// many districts the city has (one to about 150 000 people), the ones
// nearest the centre.
//
// Water comes in two kinds. Rivers are lines with a width: districts do not
// grow across them, so a boundary between districts forms along each, which
// is then laid on the river and widened to hold it, and the streets and
// lines that cross it are its bridges. Sea and lake water is a region of its
// own: districts stop at it, with a promenade along the shore.
//
// Everything here is worked out once for the world, on a raster round the
// city (water, and distance to it for the shore).

import { hash, toUnit } from '../core/hash.js';
import { createNoise } from '../core/noise.js';
import { distanceField, contours, stamp } from '../util/raster.js';
import { chaikin } from '../util/geom.js';

export const PEOPLE_PER_DISTRICT = 150000;
export const DEFAULT_POPULATION = 1500000;
const CELL = 50; // metres, the water raster
const MARGIN = 16000; // metres of country round the city on the raster
const BANK = 45; // metres of green bank either side of a river

// Kinds of site, with their shares among the world's major cities (rough).
export const SITES = [
  ['river', 0.3, 'On a river'],
  ['confluence', 0.1, 'Where two rivers meet'],
  ['estuary', 0.27, 'Where a river meets the'],
  ['shore', 0.25, 'On the shore of'],
  ['inland', 0.08, 'On flat land, no river'],
];
const OCEAN = { estuary: 0.85, shore: 0.7 }; // shares of water sites on the ocean (the rest on a great lake)
const PENINSULA = { estuary: 0.2, shore: 0.35 }; // ... with a peninsula
const ISLAND = { estuary: 0.4, shore: 0.3 }; // ... with an island cut off by a channel
const MOUNTAINS = 0.22; // shares of cities with a mountain range on one side
const MEANDER = 2.4; // a river's meanders swing this many widths either way, at most
const MEANDER_LENGTH = 13; // widths from one meander to the next, about
const WIDTH_VARY = 0.3; // a river widens and narrows by up to this share along its way
const TRIBUTARY = 0.5; // share of river and estuary cities with a smaller river joining

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

// Distance from q to the segment a-b, the nearest point and its parameter.
function toSeg(q, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2)) : 0;
  const f = [a[0] + ab[0] * t, a[1] + ab[1] * t];
  return { d: len(sub(q, f)), f, t };
}

// The kind of site a seed gets.
export function siteOf(seed) {
  let r = toUnit(hash(seed, 'terrain', 1));
  for (const [k, share] of SITES) if ((r -= share) < 0) return k;
  return SITES[SITES.length - 1][0];
}

export function createTerrain(seed, { population = DEFAULT_POPULATION } = {}) {
  const u = (...k) => toUnit(hash(seed, 'terrain', ...k));
  const noise = createNoise(seed, 'terrain-shape');
  const districts = Math.max(1, Math.round(population / PEOPLE_PER_DISTRICT));
  // A district takes about 4 km²; the city reaches about this far.
  const radius = Math.sqrt((districts * 4.2e6) / Math.PI) + 800;
  const site = siteOf(seed);
  const watery = site === 'estuary' || site === 'shore';
  const ocean = watery && u(20) < OCEAN[site];
  const peninsula = watery && u(21) < PENINSULA[site];
  const island = watery && u(22) < ISLAND[site];
  const mountains = u(23) < MOUNTAINS;
  const ext = radius + MARGIN;
  const x0 = -ext;
  const y0 = -ext;
  const W = Math.ceil((2 * ext) / CELL);
  const H = W;

  // ---- Rivers: lines across the site with a width ----
  const theta = u(2) * Math.PI * 2;
  const rivers = [];
  // A river from far off, winding gently (its heading drifting with noise,
  // never doubling back), passing near the centre (or ending at `end`).
  const riverLine = (heading, offset, width, salt, end = null) => {
    const dir = [Math.cos(heading), Math.sin(heading)];
    const nrm = [-dir[1], dir[0]];
    const L = ext * 2.3;
    const pts = [];
    // Meanders: swinging from side to side every so many widths, now
    // tighter, now hardly at all, as a river's do.
    const wave = width * MEANDER_LENGTH;
    const phase = u(40, salt) * Math.PI * 2;
    for (let s = -L / 2; s <= (end ? 0 : L / 2); s += 60) {
      const swing = 0.45 + 0.55 * Math.max(0, Math.min(1, noise.fbm(s / (wave * 2.5) + salt * 4.7, 9.3 + salt, 2) * 1.6 + 0.5));
      const meander = Math.sin((s / wave) * Math.PI * 2 + phase) * width * MEANDER * swing;
      const wobble = noise.fbm(s / 5200 + salt * 13.1, salt * 7.7, 3, 2, 0.5) * 1700 + noise.fbm(s / 1400 + salt * 3.3, 4.1 + salt, 2) * 260 + meander;
      pts.push([dir[0] * s + nrm[0] * (offset + wobble), dir[1] * s + nrm[1] * (offset + wobble)]);
    }
    // Shift so the river passes the centre at the offset asked for (or ends
    // at the end point asked for).
    if (end) {
      const last = pts[pts.length - 1];
      const shift = sub(end, last);
      for (const p of pts) {
        p[0] += shift[0];
        p[1] += shift[1];
      }
    } else {
      let best = null;
      for (const p of pts) if (!best || len(p) < len(best)) best = p;
      const want = [nrm[0] * offset, nrm[1] * offset];
      const shift = sub(want, [nrm[0] * dot(best, nrm), nrm[1] * dot(best, nrm)]);
      for (const p of pts) {
        p[0] += shift[0];
        p[1] += shift[1];
      }
    }
    return { pts: chaikin(pts, false), width };
  };
  // A point a given distance back up a line from its end.
  const pointAlongBack = (P, d) => {
    let left = d;
    for (let i = P.length - 1; i > 0; i--) {
      const l = len(sub(P[i], P[i - 1]));
      if (l >= left) return [P[i][0] + ((P[i - 1][0] - P[i][0]) * left) / l, P[i][1] + ((P[i - 1][1] - P[i][1]) * left) / l];
      left -= l;
    }
    return P[0];
  };
  // A channel from a to b, bowing out to one side (bow metres) and
  // wandering a little.
  const channel = (a, b, side, width, salt, bow = null) => {
    const d = sub(b, a);
    const L = len(d);
    const n = [(-d[1] / L) * side, (d[0] / L) * side];
    const B = bow ?? L * 0.3;
    const pts = [];
    for (let k = 0; k <= 60; k++) {
      const t = k / 60;
      const off = B * 4 * t * (1 - t) + noise.fbm(t * 4 + salt * 5.1, salt * 2.3, 2) * 180;
      pts.push([a[0] + d[0] * t + n[0] * off, a[1] + d[1] * t + n[1] * off]);
    }
    return { pts: chaikin(pts, false), width, channel: true };
  };
  // ---- Sea: the side of a coastline away from the city ----
  let seaAt = null;
  const coastDir = theta + Math.PI / 2;
  const cn = [Math.cos(coastDir), Math.sin(coastDir)]; // towards the sea
  const ct = [-cn[1], cn[0]];
  const coastOffset = radius * (0.25 + 0.25 * u(3)) + 600;
  const coastLine = (q, amp) => {
    const along = dot(q, ct);
    return coastOffset + noise.fbm(along / 7000 + 31, 5.5, 3, 2, 0.5) * amp + noise.fbm(along / 1600 + 9, 2.2, 2) * amp * 0.18;
  };
  const big = 160 + 220 * u(4);
  // A smaller river joining the main one, from one side, somewhere out
  // from the centre.
  const tributary = (main, salt) => {
    const at = radius * (0.45 + 0.8 * u(41, salt));
    let meet = null;
    for (const p of main.pts) if (Math.abs(len(p) - at) < 120 && !(seaAt && seaAt(p))) meet = meet || p;
    if (!meet) return;
    const side = u(42, salt) < 0.5 ? 1 : -1;
    const along = Math.atan2(meet[1], meet[0]);
    rivers.push(riverLine(along + side * (0.7 + 0.6 * u(43, salt)), 0, Math.max(50, big * (0.25 + 0.1 * u(44, salt))), 10 + salt, meet));
  };
  if (site === 'river') {
    rivers.push(riverLine(theta, (u(5) - 0.5) * 900, big, 1));
    if (u(45) < TRIBUTARY) tributary(rivers[0], 1);
  } else if (site === 'confluence') {
    rivers.push(riverLine(theta, (u(5) - 0.5) * 700, big, 1));
    // A tributary joining near the centre, from the side.
    const main = rivers[0].pts;
    let meet = main[0];
    for (const p of main) if (len(p) < len(meet)) meet = p;
    const side = u(6) < 0.5 ? 1 : -1;
    rivers.push(riverLine(theta + side * (0.9 + u(7) * 0.7), 0, big * (0.45 + 0.2 * u(8)), 2, meet));
  } else if (watery) {
    const amp = ocean ? 1800 : 900;
    if (peninsula && site === 'shore') {
      // Land: the mainland well behind the centre, and a broad tongue of
      // land reaching out past it, water on three sides.
      const half = radius * (0.85 + 0.3 * u(12));
      const tip = radius * (0.9 + 0.4 * u(13));
      seaAt = (q) => {
        const a = dot(q, cn); // out along the peninsula
        const b = dot(q, ct);
        const wob = noise.fbm(a / 3000 + 3, b / 3000, 3) * half * 0.35;
        if (a < -radius * 0.9 + wob) return false;
        const w = half * (a > tip * 0.5 ? Math.max(0, 1 - ((a - tip * 0.5) / (tip * 0.6)) ** 2) ** 0.5 : 1);
        return Math.abs(b) > w + wob;
      };
    } else if (peninsula) {
      // A headland reaching out from the shore beside the river's mouth.
      const at = (u(14) < 0.5 ? -1 : 1) * radius * (0.35 + 0.3 * u(15));
      const reach = radius * (0.5 + 0.4 * u(16));
      const w = radius * (0.22 + 0.12 * u(17));
      seaAt = (q) => dot(q, cn) > coastLine(q, amp) + reach * Math.exp(-(((dot(q, ct) - at) / w) ** 2));
    } else {
      seaAt = (q) => dot(q, cn) > coastLine(q, amp);
    }
    if (site === 'estuary') {
      // A river running down to the water near the centre, widening to its mouth.
      const mouth = [cn[0] * coastOffset, cn[1] * coastOffset];
      const rv = riverLine(coastDir, 0, big, 3, [mouth[0] + cn[0] * 900, mouth[1] + cn[1] * 900]);
      rv.widenTo = { p: mouth, width: Math.min(900, big * 3), reach: 3500 };
      rivers.push(rv);
      if (u(46) < TRIBUTARY) tributary(rv, 2);
      if (island) {
        // A channel leaving the river above its mouth and running out to
        // the water to one side: the land between is an island.
        const sideK = u(18) < 0.5 ? 1 : -1;
        const a = pointAlongBack(rv.pts, radius * (0.45 + 0.25 * u(19)));
        const b = [mouth[0] + ct[0] * sideK * radius * (0.5 + 0.3 * u(24)) + cn[0] * 1500, mouth[1] + ct[1] * sideK * radius * (0.5 + 0.3 * u(24)) + cn[1] * 1500];
        rivers.push(channel(a, b, sideK, big * 0.55, 5));
      }
    } else {
      if (u(9) < 0.4) {
        // Now and then a smaller river reaching the shore too.
        const along = (u(10) - 0.5) * radius * 1.2;
        const mouth = [cn[0] * coastOffset + ct[0] * along, cn[1] * coastOffset + ct[1] * along];
        rivers.push(riverLine(coastDir + (u(11) - 0.5) * 0.8, 0, big * 0.5, 4, [mouth[0] + cn[0] * 600, mouth[1] + cn[1] * 600]));
      }
      if (island && !peninsula) {
        // A channel from the water, round behind a stretch of shore and back
        // out to it: the land it cuts off is an island.
        const along = (u(25) - 0.5) * radius * 0.8;
        const span = radius * (0.55 + 0.35 * u(26));
        const base = (t) => [cn[0] * (coastOffset + 1500) + ct[0] * (along + t), cn[1] * (coastOffset + 1500) + ct[1] * (along + t)];
        rivers.push(channel(base(-span / 2), base(span / 2), -1, big * 0.5, 6, radius * (0.45 + 0.2 * u(27))));
      }
    }
  }

  // ---- Mountains: high ground the city stops at, on one side ----
  let highAt = null;
  let depthIn = null;
  if (mountains) {
    // Away from the water if there is any.
    const md = watery ? coastDir + Math.PI + (u(28) - 0.5) * 1.6 : u(28) * Math.PI * 2;
    const mn = [Math.cos(md), Math.sin(md)];
    const mt = [-mn[1], mn[0]];
    const foot = radius * (0.95 + 0.3 * u(29));
    // How far a point stands in past the foot of the mountains.
    depthIn = (q) => dot(q, mn) - foot - noise.fbm(dot(q, mt) / 3000 + 71, 3.3, 3, 2, 0.55) * radius * 0.25;
    highAt = (q) => depthIn(q) > 0;
  }
  // How high the ground stands (metres), for drawing: rising from the foot
  // into ridges and valleys.
  const ridges = createNoise(seed, 'terrain-ridges');
  const heightAt = (x, y) => {
    if (!highAt) return 0;
    const rise = Math.min(1, Math.max(0, depthIn([x, y]) / 4000));
    const n = ridges.fbm(x / 3800, y / 3800, 2, 2, 0.5);
    return 120 + rise * 650 + n * 220 * (0.4 + rise);
  };

  // ---- The raster: sea, rivers, and distances ----
  const sea = new Uint8Array(W * H);
  if (seaAt) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) sea[j * W + i] = seaAt([x0 + (i + 0.5) * CELL, y0 + (j + 0.5) * CELL]) ? 1 : 0;
  // Rivers end where they reach the sea (a channel that starts out in the
  // water starts where it reaches land).
  for (const rv of rivers) {
    const out = [];
    let onLand = false;
    for (let i = 0; i < rv.pts.length; i++) {
      const p = rv.pts[i];
      const wet = seaIndex(p);
      if (!onLand) {
        if (wet) continue;
        onLand = true;
        if (i > 0) out.push(rv.pts[i - 1]);
      }
      out.push(p);
      if (wet) break;
    }
    rv.pts = out.length > 1 ? out : rv.pts;
  }
  // High ground, on the same raster.
  const high = new Uint8Array(W * H);
  if (highAt) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) high[j * W + i] = highAt([x0 + (i + 0.5) * CELL, y0 + (j + 0.5) * CELL]) ? 1 : 0;
  const highIndex = (x, y) => {
    const i = Math.floor((x - x0) / CELL);
    const j = Math.floor((y - y0) / CELL);
    return i >= 0 && j >= 0 && i < W && j < H ? high[j * W + i] : highAt ? (highAt([x, y]) ? 1 : 0) : 0;
  };
  function seaIndex(p) {
    const i = Math.floor((p[0] - x0) / CELL);
    const j = Math.floor((p[1] - y0) / CELL);
    return i >= 0 && j >= 0 && i < W && j < H ? sea[j * W + i] : 0;
  }
  // Distance from land to the sea, and from the sea to land.
  const landDist = distanceField(CELL, sea, W, H);
  const land = new Uint8Array(W * H);
  for (let n = 0; n < land.length; n++) land[n] = sea[n] ? 0 : 1;
  const seaDist = distanceField(CELL, land, W, H);
  const bilinear = (F, x, y) => {
    const fx = (x - x0) / CELL - 0.5;
    const fy = (y - y0) / CELL - 0.5;
    const i = Math.max(0, Math.min(W - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(H - 2, Math.floor(fy)));
    const tx = Math.max(0, Math.min(1, fx - i));
    const ty = Math.max(0, Math.min(1, fy - j));
    const a = F[j * W + i];
    const b = F[j * W + i + 1];
    const c = F[(j + 1) * W + i];
    const d = F[(j + 1) * W + i + 1];
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  };
  // Signed distance to the shore: positive on land.
  const shore = (x, y) => (seaAt ? bilinear(landDist, x, y) - bilinear(seaDist, x, y) : 1e6);

  // Rivers' segments by grid cell (each in the cells its box touches).
  const G = 150;
  const REACH = 1100; // metres: nearestRiver finds a river only this near
  const segs = new Map();
  rivers.forEach((rv, ri) => {
    for (let i = 0; i < rv.pts.length - 1; i++) {
      const [a, b] = [rv.pts[i], rv.pts[i + 1]];
      for (let gx = Math.floor(Math.min(a[0], b[0]) / G); gx <= Math.floor(Math.max(a[0], b[0]) / G); gx++) {
        for (let gy = Math.floor(Math.min(a[1], b[1]) / G); gy <= Math.floor(Math.max(a[1], b[1]) / G); gy++) {
          const k = gx * 100003 + gy;
          if (!segs.has(k)) segs.set(k, []);
          segs.get(k).push([ri, i]);
        }
      }
    }
  });
  // Distance to the nearest river line, roughly, on the raster: most
  // points are far from any river and are answered from it at once.
  const riverMask = new Uint8Array(W * H);
  for (const rv of rivers) stamp(CELL, riverMask, W, H, x0, y0, rv.pts);
  const riverDist = rivers.length ? distanceField(CELL, riverMask, W, H) : null;
  // (Wider and narrower along its way; wider still toward a mouth.)
  const widthNoise = createNoise(seed, 'river-width');
  const widthOf = (rv, p) => {
    const w = rv.channel ? rv.width : rv.width * (1 + WIDTH_VARY * Math.max(-1, Math.min(1, widthNoise.fbm(p[0] / 4200, p[1] / 4200, 2) * 1.6)));
    if (!rv.widenTo) return w;
    const d = len(sub(p, rv.widenTo.p));
    const t = Math.max(0, 1 - d / rv.widenTo.reach);
    return w + (rv.widenTo.width - w) * t * t;
  };
  // The nearest river to a point, if one is within REACH: distance, nearest
  // point, direction, width. Cells are searched in rings outward until no
  // nearer segment can be left.
  function nearestRiver(x, y) {
    if (!riverDist) return null;
    const i = Math.floor((x - x0) / CELL);
    const j = Math.floor((y - y0) / CELL);
    if (i >= 0 && j >= 0 && i < W && j < H && riverDist[j * W + i] > REACH + 2 * CELL) return null;
    const cx = Math.floor(x / G);
    const cy = Math.floor(y / G);
    let best = null;
    const K = Math.ceil(REACH / G);
    for (let k = 0; k <= K; k++) {
      for (let gx = cx - k; gx <= cx + k; gx++) {
        for (let gy = cy - k; gy <= cy + k; gy++) {
          if (Math.max(Math.abs(gx - cx), Math.abs(gy - cy)) !== k) continue;
          const list = segs.get(gx * 100003 + gy);
          if (!list) continue;
          for (const [ri, si] of list) {
            const rv = rivers[ri];
            const sg = toSeg([x, y], rv.pts[si], rv.pts[si + 1]);
            if (!best || sg.d < best.d) best = { d: sg.d, f: sg.f, ri, si };
          }
        }
      }
      // Every cell not yet searched lies at least k * G away.
      if (best && best.d <= k * G) break;
    }
    if (!best || best.d > REACH) return null;
    const rv = rivers[best.ri];
    const t = sub(rv.pts[best.si + 1], rv.pts[best.si]);
    const l = len(t) || 1;
    return { d: best.d, p: best.f, t: [t[0] / l, t[1] / l], width: widthOf(rv, best.f), river: best.ri };
  }
  // Does the step from a to b cross a river's line?
  function crossesRiver(a, b) {
    const seen = new Set();
    const cells = [];
    for (let gx = Math.floor(Math.min(a[0], b[0]) / G); gx <= Math.floor(Math.max(a[0], b[0]) / G); gx++) {
      for (let gy = Math.floor(Math.min(a[1], b[1]) / G); gy <= Math.floor(Math.max(a[1], b[1]) / G); gy++) cells.push([gx, gy]);
    }
    for (const [gx, gy] of cells) {
      for (const [ri, i] of segs.get(gx * 100003 + gy) || []) {
        const key = ri * 1e6 + i;
        if (seen.has(key)) continue;
        seen.add(key);
        const p = rivers[ri].pts[i];
        const q = rivers[ri].pts[i + 1];
        const d1 = sub(b, a);
        const d2 = sub(q, p);
        const den = d1[0] * d2[1] - d1[1] * d2[0];
        if (Math.abs(den) < 1e-9) continue;
        const w = sub(p, a);
        const t = (w[0] * d2[1] - w[1] * d2[0]) / den;
        const s = (w[0] * d1[1] - w[1] * d1[0]) / den;
        if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return true;
      }
    }
    return false;
  }

  // Move a point onto the shore, `inland` metres in from the water.
  function toShore(p, inland) {
    let q = p;
    for (let k = 0; k < 6; k++) {
      const s = shore(q[0], q[1]);
      const e = 6;
      const gx = (shore(q[0] + e, q[1]) - shore(q[0] - e, q[1])) / (2 * e);
      const gy = (shore(q[0], q[1] + e) - shore(q[0], q[1] - e)) / (2 * e);
      const g = Math.hypot(gx, gy) || 1;
      const step = s - inland;
      q = [q[0] - (gx / g) * step, q[1] - (gy / g) * step];
      if (Math.abs(step) < 0.5) break;
    }
    return q;
  }

  // Outlines of the sea, for drawing: the raster's outline, smoothed, with
  // points on the raster's border pushed far out (the sea goes on).
  let seaOutlines = null;
  function seaShapes() {
    if (seaOutlines) return seaOutlines;
    seaOutlines = [];
    if (!seaAt) return seaOutlines;
    const xe = x0 + W * CELL;
    const ye = y0 + H * CELL;
    const FAR = 2e5;
    for (const loop of contours(CELL, sea, W, H, x0, y0)) {
      const pin = loop.map(([x, y]) => x <= x0 || y <= y0 || x >= xe || y >= ye);
      let P = loop;
      for (let r = 0; r < 8; r++) {
        const n = P.length;
        P = P.map((p, i) => {
          if (pin[i]) return p;
          const a = P[(i - 1 + n) % n];
          const b = P[(i + 1) % n];
          return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
        });
      }
      seaOutlines.push(P.map(([x, y], i) => (pin[i] ? [x <= x0 ? x - FAR : x >= xe ? x + FAR : x, y <= y0 ? y - FAR : y >= ye ? y + FAR : y] : [x, y])));
    }
    return seaOutlines;
  }

  // Mountains for drawing: their outline, and contours of the ground.
  let highOutlines = null;
  function highShapes() {
    if (highOutlines) return highOutlines;
    highOutlines = { fill: [], contours: [], tiers: [] };
    if (!highAt) return highOutlines;
    const xe = x0 + W * CELL;
    const ye = y0 + H * CELL;
    const FAR = 2e5;
    const smooth = (loop) => {
      const pin = loop.map(([x, y]) => x <= x0 || y <= y0 || x >= xe || y >= ye);
      let P = loop;
      for (let r = 0; r < 6; r++) {
        const n = P.length;
        P = P.map((p, i) => (pin[i] ? p : [(P[(i - 1 + n) % n][0] + 2 * p[0] + P[(i + 1) % n][0]) / 4, (P[(i - 1 + n) % n][1] + 2 * p[1] + P[(i + 1) % n][1]) / 4]));
      }
      return P.map(([x, y], i) => (pin[i] ? [x <= x0 ? x - FAR : x >= xe ? x + FAR : x, y <= y0 ? y - FAR : y >= ye ? y + FAR : y] : [x, y]));
    };
    highOutlines.fill = contours(CELL, high, W, H, x0, y0).map(smooth);
    // Contour lines every 100 m of height, on the high ground only.
    for (let level = 200; level <= 800; level += 100) {
      const m = new Uint8Array(W * H);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (high[j * W + i]) m[j * W + i] = heightAt(x0 + (i + 0.5) * CELL, y0 + (j + 0.5) * CELL) >= level ? 1 : 0;
      // (Loops cut off at the raster's edge are left out.)
      const tier = [];
      for (const loop of contours(CELL, m, W, H, x0, y0)) {
        if (loop.length < 30) continue;
        const L = smooth(loop);
        tier.push(L);
        if (!loop.some(([x, y]) => x <= x0 || y <= y0 || x >= xe || y >= ye)) highOutlines.contours.push(L);
      }
      highOutlines.tiers.push(tier);
    }
    return highOutlines;
  }

  // Rivers as filled outlines, for drawing.
  let riverOutlines = null;
  function riverShapes() {
    if (riverOutlines) return riverOutlines;
    riverOutlines = rivers.map((rv) => {
      const P = rv.pts;
      const left = [];
      const right = [];
      for (let i = 0; i < P.length; i++) {
        const a = P[Math.max(0, i - 1)];
        const b = P[Math.min(P.length - 1, i + 1)];
        const t = sub(b, a);
        const l = len(t) || 1;
        const h = widthOf(rv, P[i]) / 2;
        left.push([P[i][0] - (t[1] / l) * h, P[i][1] + (t[0] / l) * h]);
        right.push([P[i][0] + (t[1] / l) * h, P[i][1] - (t[0] / l) * h]);
      }
      return left.concat(right.reverse());
    });
    return riverOutlines;
  }

  const isWater = (x, y) => (seaAt && shore(x, y) < 0) || (() => {
    const r = nearestRiver(x, y);
    return !!r && r.d < r.width / 2;
  })();

  // What the site is, in a few words.
  let label = SITES.find((q) => q[0] === site)[2];
  if (site === 'estuary') label += ocean ? ' ocean' : ' lake';
  if (site === 'shore') label += ocean ? ' the ocean' : ' a great lake';
  const withs = [];
  if (peninsula && site === 'shore') label += ', on a peninsula';
  else if (peninsula) withs.push('a headland');
  if (island && !(peninsula && site === 'shore')) withs.push('an island');
  if (ocean) withs.push('beaches');
  if (mountains) withs.push('mountains on one side');
  if (withs.length) label += `, with ${withs.length > 1 ? `${withs.slice(0, -1).join(', ')} and ${withs[withs.length - 1]}` : withs[0]}`;
  return {
    site,
    label,
    ocean,
    isHigh: (x, y) => !!highIndex(x, y),
    heightAt,
    highShapes,
    population,
    districts,
    radius,
    rivers,
    hasSea: !!seaAt,
    shore,
    toShore,
    nearestRiver,
    crossesRiver,
    isSea: (x, y) => !!seaAt && shore(x, y) < 0,
    isWater,
    seaShapes,
    riverShapes,
    riverWidth: (x, y) => {
      const r = nearestRiver(x, y);
      return r ? r.width : 0;
    },
    BANK,
  };
}
