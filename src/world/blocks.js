// Stage 4, first part: local streets and blocks.
//
// Streets come first, as centrelines; every street then takes its width out
// of the land either side, so a block is the land left between the building
// lines of the streets round it.
//
// The main streets, boulevards, greenways and district parks cut a district
// into superblocks. Each is split, again and again, by a local street running
// roughly across its long side and curving to meet the streets at its ends
// square on, until the pieces are the size their housing calls for: about
// 100 m perimeter blocks, long rowhouse blocks about 50 m deep, larger podium
// blocks in the core, larger still on a campus. A new street meeting a street
// that another local street already meets from the far side lines up with it
// (a crossing) or keeps well clear (never a short jog), and it never meets a
// street close to a corner. So every local street ends on another street,
// and junctions are crossings and T junctions at about right angles.
//
// Along greenways and parks the edge of the land is itself a street, so
// blocks face the green across it.
//
// While splitting, a block of the right size by a neighbourhood's centre on
// its main street becomes the neighbourhood's square, with a pedestrian street
// off it; and one set back from the main streets becomes its park and
// secondary school, side by side.

import { rngFor } from '../core/rng.js';
import { hash, hashString, toUnit } from '../core/hash.js';
import { keyInts } from './cores.js';
import { LruCache } from './cache.js';
import { STREET_TYPES } from './streetTypes.js';
import { planarFaces } from '../util/planar.js';
import { insetWithSources, selfCrosses as selfCrossing } from '../util/offset.js';
import { plotsOfBlock, rectness, TERRACE_RECT } from './plots.js';
import { assignProgramme } from './programme.js';
import { assignBuildings } from './buildings.js';
import { planJunctions, isTramStreet } from './junctions.js';
import { layoutParkette, layoutNeighbourhoodPark, layoutSchool, layoutDistrictPark, communityCentre } from './parkLayout.js';
import { createNames } from './names.js';
import { polygonArea, signedArea, pointInPolygon, orientPositive, simplify, chaikin, resample, splitByPolygon } from '../util/geom.js';
import { fill, distanceField, contours, stamp } from '../util/raster.js';
import { distToLine } from './boulevards.js';

const LOCAL = STREET_TYPES.localStreet.width;
const PEDESTRIAN = STREET_TYPES.pedestrianStreet.width;
const CORE_CROSS = STREET_TYPES.coreCrossStreet.width;
const PARKSIDE = LOCAL; // the street along a greenway or park edge
const ARCH = 9; // metres: one arch of a viaduct, and its stall
const ARCH_CLEAR = 14; // metres a stall keeps from a way across under the viaduct
const KIOSK_DEPTH = 6; // metres: a stall's depth across the viaduct
const PASSAGE_EVERY = 160; // metres between streets running across under a viaduct
const PASSAGE_REACH = 320; // metres out either side a passage looks for a street to join
const RAIL_CORRIDOR = 21; // metres between building lines either side of a rail viaduct (the viaduct and a lane each side)

// Block sizes, centreline to centreline: stop splitting once both sides fit;
// never split into a piece narrower than `min` (or shorter than `minLong`).
export const BLOCK_SIZES = {
  perimeter: { long: 175, short: 140, min: 80 },
  rowhouse: { long: 240, short: 86, min: 60, minLong: 95 },
  podium: { long: 165, short: 135, min: 80 },
  campus: { long: 270, short: 220, min: 110 },
};
const CORNER_GAP = 28; // metres a new street keeps from a corner of the block it splits
const ALIGN = 34; // a new street this close to one meeting the far side lines up with it
const JOG = 48; // and otherwise keeps at least this far from it
const SQUARE_AREA = [0.5e4, 1.7e4]; // m², centreline, for a neighbourhood square
const PARK_PAIR_AREA = [4.2e4, 9.5e4]; // m², centreline, for a park and school side by side
const PARK_SHARE = 0.5; // of that pair, the park's share (the school's grounds take the rest, track and all)
const PARK_SITE_SET_BACK = 150; // metres a park's site keeps from main streets
const REMNANT = 0.12e4; // m², net: a block smaller than this is left green
const STEP = 10; // metres between points of a new street
const CAMPUS_SHARE = 0.45; // of a campus neighbourhood's land, the campus itself
const FORCED_MIN = 60; // metres: narrowest side of a park or school split off a site
const SQUARE_MIN = 62; // metres, centreline: narrowest a square's block may be
const SPLAY_BELOW = (55 * Math.PI) / 180; // a building line corner sharper than this is splayed
const SPLAY = 9; // metres back from the point, each way
const AWKWARD_AREA = 0.45e4; // m²: a block this small ...
const AWKWARD_RECT = 0.62; // ... and this far from rectangular is a green
const GREEN_LINK_GAP = 140; // metres between local streets' paths into a greenway
const LINEAR_PARK_RUN = [220, 1000]; // metres: a secondary greenway's length, main street to main street
const LINEAR_PARK_SHARE = 0.5; // of such stretches of boundary, those made linear parks
const LINEAR_PARK_WIDTH = [28, 40]; // metres
const ROW_AWKWARD_AREA = 0.9e4; // m²: a rowhouse block bigger than this that is far from rectangular is split again ...
const TERRACE_RECT_GOOD = 0.78; // ... (rectangular enough, by this measure); a smaller one is a green
const STADIUM_SHARE = 0.6; // of districts, those with a stadium
const STADIUM_SITE = [250, 200]; // metres, centreline: a stadium's block (a 60 000-seat bowl and its concourse)
const STADIUM_REACH = [300, 1500]; // metres from the station
const ROW_STRIP = 74; // metres, centreline to centreline: a rowhouse block's width (two houses, gardens and the lane)
const OVERSIZE = 1.5; // a block this many times its usual area must split, one way or another
const SQUARE_SIDE = 30; // metres: shortest side along which a square may take in its street
const SQUARE_FORMS = { corner: 0.3, against: 0.35 }; // shares of squares by form; the rest stand on their own
const SCHOOL_AREA = 0.9e4; // m², centreline: smallest block a secondary school takes
const SCHOOL_LONGEST = 220; // metres, centreline: a school's grounds longer than this are cut down...
const SCHOOL_LENGTH = 185; // ...to about this (a track and field and the building beside it)
const SCHOOL_WIDE = 70; // metres, centreline: narrowest a school's grounds should be (for its field)
const OLD_TOWN = 190; // metres from the core neighbourhood's centre: its old town, a pedestrian zone
const PEDESTRIAN_ZONE = 120; // metres from the district's square its pedestrian streets reach, at least
const PEDESTRIAN_REACH = 220; // metres from its square a pedestrian street runs
const FALLBACK_REACH = 250; // metres from a centre a square may stand if none was found by it
const EDGE_CELL = 4; // metres: the raster the greenway-side streets are found on

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const unit = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

export const axesOf = (pts) => axes(pts);

// Principal axes of a polygon (from its area moments) and its extents.
function axes(pts) {
  const [ox, oy] = pts[0];
  let A = 0;
  let cx = 0;
  let cy = 0;
  let ixx = 0;
  let iyy = 0;
  let ixy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const x0 = pts[i][0] - ox;
    const y0 = pts[i][1] - oy;
    const x1 = pts[(i + 1) % n][0] - ox;
    const y1 = pts[(i + 1) % n][1] - oy;
    const c = x0 * y1 - x1 * y0;
    A += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
    ixx += (x0 * x0 + x0 * x1 + x1 * x1) * c;
    iyy += (y0 * y0 + y0 * y1 + y1 * y1) * c;
    ixy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c;
  }
  A /= 2;
  cx /= 6 * A;
  cy /= 6 * A;
  // Second moments about the centroid.
  const sxx = ixx / 12 - A * cx * cx;
  const syy = iyy / 12 - A * cy * cy;
  const sxy = ixy / 24 - A * cx * cy;
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let u = [Math.cos(ang), Math.sin(ang)];
  let v = [-u[1], u[0]];
  const c = [cx + ox, cy + oy];
  const ext = (d) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts) {
      const s = dot(sub(p, c), d);
      if (s < lo) lo = s;
      if (s > hi) hi = s;
    }
    return [lo, hi];
  };
  let eu = ext(u);
  let ev = ext(v);
  if (ev[1] - ev[0] > eu[1] - eu[0]) {
    [u, v] = [v, [-v[1], v[0]]];
    [eu, ev] = [ext(u), ext(v)];
  }
  return { c, u, v, eu, ev, L: eu[1] - eu[0], W: ev[1] - ev[0], area: Math.abs(A) };
}

function segHit(a, b, c, d) {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(c, a), s) / den;
  const u = cross(sub(c, a), r) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [t, u];
}

function interiorPoint(pts) {
  // Just inside the middle of the longest edge (inside is on the right).
  let best = 0;
  let bl = -1;
  for (let i = 0; i < pts.length; i++) {
    const l = len(sub(pts[(i + 1) % pts.length], pts[i]));
    if (l > bl) {
      bl = l;
      best = i;
    }
  }
  const a = pts[best];
  const b = pts[(best + 1) % pts.length];
  const t = unit(sub(b, a));
  return [(a[0] + b[0]) / 2 - t[1] * 0.5, (a[1] + b[1]) / 2 + t[0] * 0.5];
}

// Remove repeated points (each edge keeps the tag of the edge it starts).
function clean(node) {
  const P = [];
  const T = [];
  const n = node.pts.length;
  for (let i = 0; i < n; i++) {
    const q = P[P.length - 1];
    if (q && len(sub(node.pts[i], q)) < 0.01) {
      T[T.length - 1] = node.tags[i];
      continue;
    }
    P.push(node.pts[i]);
    T.push(node.tags[i]);
  }
  while (P.length > 3 && len(sub(P[0], P[P.length - 1])) < 0.01) {
    P.pop();
    T.pop();
  }
  return { ...node, pts: P, tags: T };
}

// Cut the point off every sharp corner of a building line, square to the
// corner's bisector, as splayed street corners are: the corner building gets
// a short face of its own instead of a point.
function splay(res) {
  if (!res) return res;
  const P = res.pts;
  const n = P.length;
  const sign = Math.sign(signedArea(P)) || 1;
  const pts = [];
  const src = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n];
    const v = P[i];
    const b = P[(i + 1) % n];
    const u1 = sub(a, v);
    const u2 = sub(b, v);
    const l1 = len(u1);
    const l2 = len(u2);
    const convex = (cross(sub(v, a), sub(b, v)) * sign) > 0;
    const angle = l1 > 0 && l2 > 0 ? Math.acos(Math.max(-1, Math.min(1, dot(u1, u2) / (l1 * l2)))) : Math.PI;
    if (!convex || angle >= SPLAY_BELOW) {
      pts.push(v);
      src.push(res.src[i]);
      continue;
    }
    const c = Math.min(SPLAY, l1 * 0.3, l2 * 0.3);
    pts.push([v[0] + (u1[0] / l1) * c, v[1] + (u1[1] / l1) * c]);
    src.push(-1);
    pts.push([v[0] + (u2[0] / l2) * c, v[1] + (u2[1] / l2) * c]);
    src.push(res.src[i]);
  }
  return { pts, src };
}

// Join segments [a, b] that share ends into polylines (either way round).
function joinSegs(segs) {
  const key = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const ends = new Map();
  segs.forEach((s, i) => {
    for (const e of [0, 1]) {
      const k = key(s[e]);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const out = [];
  const extend = (line, atEnd) => {
    for (;;) {
      const tip = atEnd ? line[line.length - 1] : line[0];
      const next = (ends.get(key(tip)) || []).find((j) => !used[j]);
      if (next === undefined) return;
      used[next] = 1;
      const [a, b] = segs[next];
      const other = key(a) === key(tip) ? b : a;
      if (atEnd) line.push(other);
      else line.unshift(other);
    }
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line = [segs[i][0], segs[i][1]];
    extend(line, true);
    extend(line, false);
    out.push(line);
  }
  return out;
}

// Join polylines that meet end to start into longer ones.
function joinRuns(runs) {
  const key = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const starts = new Map();
  for (const r of runs) starts.set(key(r[0]), r);
  const used = new Set();
  const out = [];
  // Begin with runs nothing leads into, then any loops left.
  const ends = new Set(runs.map((r) => key(r[r.length - 1])));
  const order = runs.filter((r) => !ends.has(key(r[0]))).concat(runs);
  for (const r of order) {
    if (used.has(r)) continue;
    used.add(r);
    const line = r.slice();
    for (let next = starts.get(key(line[line.length - 1])); next && !used.has(next); next = starts.get(key(line[line.length - 1]))) {
      used.add(next);
      line.push(...next.slice(1));
    }
    out.push(line);
  }
  return out;
}

// A rail station's platforms, underground: a rectangle along the track at
// the station (wider and longer at the central station).
export const STATION_HALL = { district: [220, 44], central: [300, 60], stop: [150, 36] };
const ENTRANCE_REACH = 70; // metres out from the platforms a building may hold an entrance
const ENTRANCE_GAP = 45; // metres between entrances
const ENTRANCES = 6; // entrances to a station
const ENTRANCES_CENTRAL = 10; // and to the central station
const PLAZA_ENTRANCE_REACH = 250; // metres from the platforms the district's plaza may hold one too
const ENTRANCE_HOSTS = new Set(['officeTower', 'hotel', 'departmentStore', 'governmentOffice']); // buildings of their own that may hold one
export function hallOf(st) {
  const [L, W] = st.central ? STATION_HALL.central : st.second ? STATION_HALL.stop : STATION_HALL.district;
  const t = unit(st.dir || [1, 0]);
  const n = [-t[1], t[0]];
  const at = (a, b) => [st.p[0] + t[0] * a + n[0] * b, st.p[1] + t[1] * a + n[1] * b];
  return { pts: [at(-L / 2, -W / 2), at(L / 2, -W / 2), at(L / 2, W / 2), at(-L / 2, W / 2)], t, n, L, W, at };
}
export function createBlocks(seed, { greenwayWidth, greenway, isWater = () => false, railIn = () => [], stationsIn = () => [] }) {
  // A path that would run through water is left out.
  const dryPath = (pts) => pts && !pts.some((q) => isWater(q[0], q[1]));
  const names = createNames(seed);
  const cache = new LruCache(6); // (each district's blocks and buildings take tens of MB)

  function of(d) {
    let out = cache.get(d.key);
    if (!out) {
      out = build(d);
      cache.set(d.key, out);
    }
    return out;
  }

  // Centrelines of the streets along a district's greenways, as closed loops.
  function parksideLines(d) {
    const bb = d.bbox;
    const x0 = Math.floor(bb.x0 / EDGE_CELL) * EDGE_CELL - EDGE_CELL * 4;
    const y0 = Math.floor(bb.y0 / EDGE_CELL) * EDGE_CELL - EDGE_CELL * 4;
    const W = Math.ceil((bb.x1 - x0) / EDGE_CELL) + 8;
    const H = Math.ceil((bb.y1 - y0) / EDGE_CELL) + 8;
    const land = new Uint8Array(W * H);
    // Inside the district's rings (even-odd), then the greenways cut away.
    for (const r of d.rings) {
      const m = new Uint8Array(W * H);
      fill(EDGE_CELL, m, W, H, x0, y0, r, 1);
      for (let n = 0; n < m.length; n++) if (m[n]) land[n] ^= 1;
    }
    for (const c of d.chains) fill(EDGE_CELL, land, W, H, x0, y0, c.geo.lod(1).strip, 0);
    for (const j of d.junctions) {
      const r = greenwayWidth(j.x, j.y) / 2;
      const circle = [];
      for (let k = 0; k < 24; k++) circle.push([j.x + Math.cos((k / 24) * Math.PI * 2) * r, j.y + Math.sin((k / 24) * Math.PI * 2) * r]);
      fill(EDGE_CELL, land, W, H, x0, y0, circle, 0);
    }
    const off = new Uint8Array(W * H);
    for (let n = 0; n < off.length; n++) off[n] = land[n] ? 0 : 1;
    const dist = distanceField(EDGE_CELL, off, W, H);
    const keep = new Uint8Array(W * H);
    for (let n = 0; n < keep.length; n++) keep[n] = dist[n] > PARKSIDE / 2 ? 1 : 0;
    const loops = [];
    for (const raw of contours(EDGE_CELL, keep, W, H, x0, y0)) {
      if (raw.length < 12) continue;
      // Smooth out the raster's stairs first (a few passes of neighbour
      // averaging round the loop), so the street keeps an even line.
      let pts = raw;
      for (let k = 0; k < 6; k++) {
        const n = pts.length;
        pts = pts.map((p, i) => {
          const a = pts[(i - 1 + n) % n];
          const b = pts[(i + 1) % n];
          return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
        });
      }
      pts = simplify(pts.concat([pts[0]]), EDGE_CELL * 0.25).slice(0, -1);
      pts = chaikin(pts, true);
      if (Math.abs(signedArea(pts)) < 2e4) continue;
      loops.push(orientPositive(pts));
    }
    return loops;
  }

  function build(d) {
    const rng = rngFor(seed, 'blocks', ...keyInts(d.coreInfo));
    const st = d.stage3;
    const R = st.raster;
    const hoods = st.hoods;
    const cellOf = (x, y) => {
      const i = Math.floor((x - R.x0) / R.cell);
      const j = Math.floor((y - R.y0) / R.cell);
      return i >= 0 && j >= 0 && i < R.W && j < R.H ? j * R.W + i : -1;
    };
    const hoodAt = (p) => {
      const n = cellOf(p[0], p[1]);
      return n >= 0 && R.label[n] >= 0 ? hoods[R.label[n]] : null;
    };
    const densityAt = (p) => {
      const n = cellOf(p[0], p[1]);
      return n >= 0 ? R.dens[n] * 1e6 : 0;
    };

    function linksToGreenways(leaves) {
      const ways = d.chains.map((c) => ({ c, g: greenway(c.geo) }));
      const nearestOn = (L, q) => {
        let best = null;
        for (let i = 0; i < L.length - 1; i++) {
          const a = L[i];
          const ab = sub(L[i + 1], a);
          const l2 = dot(ab, ab);
          const t = l2 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2)) : 0;
          const f = [a[0] + ab[0] * t, a[1] + ab[1] * t];
          const r = len(sub(f, q));
          if (!best || r < best.r) best = { p: f, r, i };
        }
        return best;
      };
      // A gently curving path from p to the trail.
      const toTrail = (p, way, toward) => {
        let T = null;
        for (const L of way.g.trails) {
          const t = nearestOn(L, toward || p);
          if (t && (!T || t.r < T.r)) T = t;
        }
        if (!T || T.r > 260) return null;
        const m = [(p[0] + T.p[0]) / 2, (p[1] + T.p[1]) / 2];
        const c = toward ? [(m[0] + toward[0]) / 2, (m[1] + toward[1]) / 2] : m;
        const pts = [];
        for (let k = 0; k <= 8; k++) {
          const t = k / 8;
          pts.push([(1 - t) * (1 - t) * p[0] + 2 * (1 - t) * t * c[0] + t * t * T.p[0], (1 - t) * (1 - t) * p[1] + 2 * (1 - t) * t * c[1] + t * t * T.p[1]]);
        }
        return pts;
      };
      const wayNear = (q) => {
        let best = null;
        for (const w of ways) {
          const r = nearestOn(w.g.centre, q);
          if (r && (!best || r.r < best.r.r)) best = { w, r };
        }
        return best;
      };
      const out = [];
      // Local streets meeting a greenway's street, every so often.
      const meets = [];
      for (const lf of leaves) {
        const n = lf.pts.length;
        for (let i = 0; i < n; i++) {
          const a = lf.tags[(i - 1 + n) % n].kind;
          const b = lf.tags[i].kind;
          if ((a === 'local' && b === 'greenway') || (a === 'greenway' && b === 'local')) {
            const q = lf.pts[i];
            if (!meets.some((m) => len(sub(m, q)) < 10)) meets.push(q);
          }
        }
      }
      const taken = [];
      for (const q of meets.sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
        const near = wayNear(q);
        if (!near || near.r.r > near.w.g.half[Math.min(near.r.i, near.w.g.half.length - 1)] + PARKSIDE * 1.5) continue;
        if (taken.some((t) => len(sub(t, q)) < GREEN_LINK_GAP)) continue;
        const pts = toTrail(q, near.w, near.r.p);
        if (dryPath(pts)) {
          out.push(pts);
          taken.push(q);
        }
      }
      // From each pavement of a street just before it dips under a greenway.
      const under = [
        ...st.lines.filter((l) => l.crossing).map((l) => ({ P: l.points, w: STREET_TYPES.mainStreet.width })),
        ...d.network.lines.filter((l) => l.kind !== 'roundabout').map((l) => ({ P: l.points, w: STREET_TYPES.boulevard.width, both: true })),
      ];
      for (const { P, w, both } of under) {
        for (const end of both ? [0, P.length - 1] : [0]) {
          const x = P[end];
          const near = wayNear(x);
          if (!near || near.r.r > 12) continue;
          const nx = P[end === 0 ? Math.min(3, P.length - 1) : Math.max(0, P.length - 4)];
          const dir = unit(sub(nx, x));
          const perp = [-dir[1], dir[0]];
          const h = near.w.g.half[Math.min(near.r.i, near.w.g.half.length - 1)];
          for (const sgn of [1, -1]) {
            const e = [x[0] + dir[0] * (h + 2) + perp[0] * sgn * (w / 2 - 1.5), x[1] + dir[1] * (h + 2) + perp[1] * sgn * (w / 2 - 1.5)];
            const toward = [e[0] - dir[0] * h * 0.6 + perp[0] * sgn * 30, e[1] - dir[1] * h * 0.6 + perp[1] * sgn * 30];
            const pts = toTrail(e, near.w, toward);
            if (dryPath(pts)) out.push(pts);
          }
        }
      }
      return out;
    }

    function hoodsByBlock(blocks) {
      const faces = blocks.filter((b) => b.centreline && b.hood != null);
      // Faces by grid cell, to find the block across a street.
      const G = 40;
      const grid = new Map();
      const gkey = (gx, gy) => gx * 100003 + gy;
      faces.forEach((b, i) => {
        let [bx0, by0, bx1, by1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const [x, y] of b.centreline) [bx0, by0, bx1, by1] = [Math.min(bx0, x), Math.min(by0, y), Math.max(bx1, x), Math.max(by1, y)];
        b.box = [bx0, by0, bx1, by1];
        for (let gx = Math.floor(bx0 / G); gx <= Math.floor(bx1 / G); gx++) {
          for (let gy = Math.floor(by0 / G); gy <= Math.floor(by1 / G); gy++) {
            const k = gkey(gx, gy);
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push(i);
          }
        }
      });
      const faceAt = (x, y) => {
        for (const i of grid.get(gkey(Math.floor(x / G), Math.floor(y / G))) || []) {
          const f = faces[i];
          if (x < f.box[0] || x > f.box[2] || y < f.box[1] || y > f.box[3]) continue;
          if (pointInPolygon(x, y, f.centreline)) return f;
        }
        return null;
      };
      // Each block's edge in short pieces, with the block across each.
      const PIECE = 10;
      for (const b of faces) {
        const P = b.centreline;
        // The side of each edge facing out of the block.
        const out = signedArea(P) > 0 ? -1 : 1;
        b.across = [];
        for (let i = 0; i < P.length; i++) {
          const a = P[i];
          const c = P[(i + 1) % P.length];
          const L = len(sub(c, a));
          if (L < 0.01) continue;
          const nrm = [-(c[1] - a[1]) / L, (c[0] - a[0]) / L];
          const k = Math.ceil(L / PIECE);
          for (let j = 0; j < k; j++) {
            const t0 = j / k;
            const t1 = (j + 1) / k;
            const m = [a[0] + ((c[0] - a[0]) * (t0 + t1)) / 2, a[1] + ((c[1] - a[1]) * (t0 + t1)) / 2];
            const o = [m[0] + nrm[0] * 1.5 * out, m[1] + nrm[1] * 1.5 * out];
            b.across.push({
              p: [a[0] + (c[0] - a[0]) * t0, a[1] + (c[1] - a[1]) * t0],
              q: [a[0] + (c[0] - a[0]) * t1, a[1] + (c[1] - a[1]) * t1],
              l: L / k,
              o: faceAt(o[0], o[1]),
            });
          }
        }
      }
      // Smooth the boundaries: an ordinary block mostly surrounded by
      // another neighbourhood joins it, so boundaries do not step round
      // single blocks. (Squares, parks and schools stay with their own.)
      const movable = new Set(['perimeter', 'rowhouse', 'podium', 'green']);
      for (let round = 0; round < 4; round++) {
        let moved = 0;
        for (const b of faces) {
          if (!movable.has(b.use)) continue;
          const by = new Map();
          let total = 0;
          for (const e of b.across) {
            if (!e.o) continue;
            total += e.l;
            by.set(e.o.hood, (by.get(e.o.hood) || 0) + e.l);
          }
          let best = b.hood;
          let bl = by.get(b.hood) || 0;
          for (const [h, l] of [...by].sort((x, y) => x[0] - y[0])) if (l > bl) [best, bl] = [h, l];
          // (Never into a neighbourhood built in another form.)
          const fits = (b.use === 'rowhouse') === (hoods[best] && formOf(hoods[best]) === 'rowhouse') || (b.use !== 'rowhouse' && b.front);
          if (best !== b.hood && bl > total * 0.6 && fits) {
            b.hood = best;
            moved++;
          }
        }
        if (!moved) break;
      }
      // People per block, from stage 3's density where the block stands.
      const byBlock = new Map();
      for (const b of faces) {
        const [bx0, by0, bx1, by1] = b.box;
        let sum = 0;
        let k = 0;
        for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
          const n = cellOf(bx0 + (bx1 - bx0) * fx, by0 + (by1 - by0) * fy);
          if (n < 0) continue;
          sum += R.dens[n];
          k++;
        }
        if (k) byBlock.set(b.hood, (byBlock.get(b.hood) || 0) + (sum / k) * polygonArea(b.centreline));
      }
      // Stage 3's people by its own boundaries, to carry over its plan
      // (campus neighbourhoods house fewer for their land).
      const byLabel = new Map();
      for (let n = 0; n < R.label.length; n++) if (R.label[n] >= 0 && R.dens[n] > 0) byLabel.set(hoods[R.label[n]].id, (byLabel.get(hoods[R.label[n]].id) || 0) + R.dens[n] * R.cell * R.cell);
      const planned = {};
      let total = 0;
      for (const h of hoods) {
        const raw = byLabel.get(h.id) || 0;
        planned[h.id] = raw > 0 ? ((byBlock.get(h.id) || 0) * h.population) / raw : 0;
        total += planned[h.id];
      }
      // Land at the district's edges is outside every block: its people are
      // shared out, so the district as a whole houses what stage 3 planned.
      const want = hoods.reduce((a, h) => a + h.population, 0);
      for (const h of hoods) planned[h.id] = total > 0 ? Math.round((planned[h.id] * want) / total) : h.population;
      // Boundaries: the stretches of a block's edge (its street's centreline)
      // with another neighbourhood's block across, each drawn from one side.
      const hoodLines = [];
      for (const b of faces) {
        let run = null;
        for (const e of b.across) {
          if (!e.o || e.o.hood === b.hood || b.hood > e.o.hood) {
            run = null;
            continue;
          }
          if (run && len(sub(run[run.length - 1], e.p)) < 0.01) run.push(e.q);
          else {
            run = [e.p, e.q];
            hoodLines.push(run);
          }
        }
        delete b.across;
        delete b.box;
      }
      return { planned, hoodLines: joinRuns(hoodLines) };
    }

    function secondaryGreenways(mains) {
      const segHitT = (a, b, c, e) => {
        const r = sub(b, a);
        const q = sub(e, c);
        const den = cross(r, q);
        if (Math.abs(den) < 1e-9) return null;
        const t = cross(sub(c, a), q) / den;
        const u2 = cross(sub(c, a), r) / den;
        return t >= 0 && t <= 1 && u2 >= 0 && u2 <= 1 ? t : null;
      };
      const atEdge = (q) => d.rings.some((r) => r.some((v, i) => distToLine(q[0], q[1], [v, r[(i + 1) % r.length]]) < greenwayWidth(q[0], q[1]) / 2 + 40));
      const slice = (P, cum, s0, s1) => {
        const pts = [];
        for (let i = 0; i < P.length; i++) if (cum[i] >= s0 && cum[i] <= s1) pts.push(P[i]);
        return pts;
      };
      // Each stretch of boundary: where main streets cross it, and whether
      // its ends meet the greenway.
      const runs = []; // whole stretches, anchor to anchor
      const arms = new Map(); // point where boundaries meet -> stretches from it to an anchor
      const key = (q) => `${Math.round(q[0])},${Math.round(q[1])}`;
      for (const c of st.chains) {
        if (c.a < 0 || c.b < 0 || hoods[c.a].core || hoods[c.b].core) continue;
        // The traced boundary has the raster's stairs: simplified, then
        // smoothed into an easy curve.
        let P = simplify(c.points, 12);
        if (P.length < 2) continue;
        for (let k = 0; k < 3; k++) P = chaikin(P, false);
        P = resample(P, 8);
        const cum = [0];
        for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + len(sub(P[i], P[i - 1])));
        const total = cum[cum.length - 1];
        const cuts = [];
        for (const m of mains) {
          for (let i = 0; i < P.length - 1; i++) {
            for (let j = 0; j < m.pts.length - 1; j++) {
              const t = segHitT(P[i], P[i + 1], m.pts[j], m.pts[j + 1]);
              if (t !== null) cuts.push(cum[i] + (cum[i + 1] - cum[i]) * t);
            }
          }
        }
        const edge0 = atEdge(P[0]);
        const edge1 = atEdge(P[P.length - 1]);
        if (edge0) cuts.push(0);
        if (edge1) cuts.push(total);
        cuts.sort((x, y) => x - y);
        const id = `${c.a}:${c.b}`;
        for (let k = 0; k + 1 < cuts.length; k++) runs.push({ pts: slice(P, cum, cuts[k] - 1, cuts[k + 1] + 1), id: `${id}:${k}`, hoods: [c.a, c.b] });
        // From a meeting point inwards to the first anchor.
        if (cuts.length) {
          if (!edge0) {
            const arm = slice(P, cum, 0, cuts[0] + 1);
            if (!arms.has(key(P[0]))) arms.set(key(P[0]), []);
            arms.get(key(P[0])).push({ pts: arm, id: `${id}:s`, hoods: [c.a, c.b] });
          }
          if (!edge1) {
            const arm = slice(P, cum, cuts[cuts.length - 1] - 1, total).reverse();
            if (!arms.has(key(P[P.length - 1]))) arms.set(key(P[P.length - 1]), []);
            arms.get(key(P[P.length - 1])).push({ pts: arm, id: `${id}:e`, hoods: [c.a, c.b] });
          }
        }
      }
      // Through a meeting point: two arms that leave it in about opposite
      // directions make one stretch.
      for (const [k, list] of [...arms].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
        let best = null;
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const A = list[i].pts;
            const B = list[j].pts;
            if (A.length < 3 || B.length < 3) continue;
            const da = unit(sub(A[Math.min(4, A.length - 1)], A[0]));
            const db = unit(sub(B[Math.min(4, B.length - 1)], B[0]));
            const straight = -dot(da, db);
            if (straight > 0.5 && (!best || straight > best.straight)) best = { straight, pts: A.slice().reverse().concat(B.slice(1)), id: `${k}`, hoods: list[i].hoods };
          }
        }
        if (best) runs.push(best);
      }
      const out = [];
      const used = [];
      for (const r of runs) {
        let L = 0;
        for (let i = 1; i < r.pts.length; i++) L += len(sub(r.pts[i], r.pts[i - 1]));
        if (L < LINEAR_PARK_RUN[0] || L > LINEAR_PARK_RUN[1] * 1.6) continue;
        if (toUnit(hash(seed, 'linear-park', ...keyInts(d.coreInfo), hashString(r.id))) > LINEAR_PARK_SHARE) continue;
        // Run 12 m on into whatever it ends at.
        const P = r.pts.slice();
        for (const end of [0, 1]) {
          const a = end ? P[P.length - 1] : P[0];
          const b = end ? P[P.length - 2] : P[1];
          const dir = unit(sub(a, b));
          const q = [a[0] + dir[0] * 12, a[1] + dir[1] * 12];
          if (end) P.push(q);
          else P.unshift(q);
        }
        const W = LINEAR_PARK_WIDTH[0] + toUnit(hash(seed, 'linear-park-w', hashString(r.id))) * (LINEAR_PARK_WIDTH[1] - LINEAR_PARK_WIDTH[0]);
        const left = [];
        const right = [];
        for (let i = 0; i < P.length; i++) {
          const a = P[Math.max(0, i - 1)];
          const b = P[Math.min(P.length - 1, i + 1)];
          const t = unit(sub(b, a));
          const n = [-t[1], t[0]];
          left.push([P[i][0] + (n[0] * W) / 2, P[i][1] + (n[1] * W) / 2]);
          right.push([P[i][0] - (n[0] * W) / 2, P[i][1] - (n[1] * W) / 2]);
        }
        const poly = orientPositive(left.concat(right.reverse()));
        if (selfCrossing(poly)) continue;
        // Not on top of another.
        if (used.some((o) => P.some((q) => pointInPolygon(q[0], q[1], o)))) continue;
        used.push(poly);
        out.push({ pts: poly, centre: P, width: W, hoods: r.hoods });
      }
      return out;
    }

    // ---- Superblocks ----
    let nextStreet = 1;
    const street = (kind, w, extra = {}) => ({ id: nextStreet++, kind, w, ...extra });
    const lines = [];
    const mains = [];
    // (Through the core neighbourhood, a main street is a core main street:
    // wider, with a frontage zone under the podiums.)
    const corePoly = st.hoods[0] && st.hoods[0].core ? st.hoods[0].polygon : null;
    for (const l of st.lines) {
      for (const run of splitByPolygon(l.points, corePoly)) {
        const t = street('main', STREET_TYPES[run.inside ? 'coreMainStreet' : 'mainStreet'].width, { key: l.key, core: run.inside });
        mains.push({ t, pts: run.pts });
        lines.push({ pts: run.pts, tag: t });
      }
    }
    const roundabouts = [];
    for (const l of d.network.lines) {
      const t = street('boulevard', STREET_TYPES.boulevard.width, { key: l.key });
      mains.push({ t, pts: l.points });
      if (l.kind === 'roundabout') roundabouts.push(l.points);
      lines.push({ pts: l.points, tag: t });
    }
    // Along the greenway, the street's centreline: half the street in from the
    // greenway's edge. Found on a fine raster of the land, so the line splits
    // cleanly where the land narrows to a neck.
    const sideLoops = parksideLines(d);
    for (const loop of sideLoops) lines.push({ pts: loop, closed: true, tag: street('greenway', PARKSIDE) });
    // Regional rail on its viaduct, over a path for walking and cycling (a
    // lane each side under it): blocks face it as they would a street. Only
    // the stretches over the district's land, each run on a little past the
    // parkside street so they meet it; at a tunnel's mouth the path carries
    // on over the tunnel to the next street.
    const railLines = [];
    for (const C of railIn(d)) {
      const inside = (q) => sideLoops.some((lp) => pointInPolygon(q[0], q[1], lp));
      let run = null;
      const flush = () => {
        if (run && run.pts.length > 1) {
          const ext = (a, b) => {
            const t = unit(sub(a, b));
            return [a[0] + t[0] * 8, a[1] + t[1] * 8];
          };
          run.pts.unshift(ext(run.pts[0], run.pts[1]));
          run.kinds.unshift(run.kinds[0]);
          run.pts.push(ext(run.pts[run.pts.length - 1], run.pts[run.pts.length - 2]));
          run.kinds.push(run.kinds[run.kinds.length - 1]);
          railLines.push(run);
        }
        run = null;
      };
      C.pts.forEach((q, k) => {
        if (inside(q)) {
          run ||= { pts: [], kinds: [] };
          run.pts.push(q);
          run.kinds.push(C.kinds[k]);
        } else flush();
      });
      flush();
    }
    // Under the viaduct, the streets either side join up: every so often a
    // street runs across under it, from the first street (or other edge) on
    // one side to the first on the other; nothing is built across it.
    const passages = [];
    {
      const others = lines.map((l) => (l.closed ? l.pts.concat([l.pts[0]]) : l.pts));
      const firstHit = (q, dir) => {
        let best = null;
        const b = [q[0] + dir[0] * PASSAGE_REACH, q[1] + dir[1] * PASSAGE_REACH];
        for (const P of others) {
          for (let i = 1; i < P.length; i++) {
            const h = segHit(q, b, P[i - 1], P[i]);
            const x = h && h[0];
            if (h && x * PASSAGE_REACH > RAIL_CORRIDOR / 2 && (best === null || x < best)) best = x;
          }
        }
        return best === null ? null : [q[0] + dir[0] * best * PASSAGE_REACH, q[1] + dir[1] * best * PASSAGE_REACH];
      };
      for (const R of railLines) {
        // Where a street already crosses (so a passage keeps clear of it).
        const crossed = [];
        let along = 0;
        for (let i = 1; i < R.pts.length; i++) {
          along += len(sub(R.pts[i], R.pts[i - 1]));
          for (const P of others) for (let j = 1; j < P.length; j++) if (segHit(R.pts[i - 1], R.pts[i], P[j - 1], P[j]) !== null) crossed.push(along);
        }
        R.crossed = crossed;
        let s = 0;
        let last = -Infinity;
        for (let i = 1; i < R.pts.length - 1; i++) {
          s += len(sub(R.pts[i], R.pts[i - 1]));
          if (R.kinds[i] !== 'viaduct' || s - last < PASSAGE_EVERY || crossed.some((c) => Math.abs(c - s) < PASSAGE_EVERY * 0.5)) continue;
          const t = unit(sub(R.pts[i + 1], R.pts[i - 1]));
          const n = [-t[1], t[0]];
          const a = firstHit(R.pts[i], n);
          const b = firstHit(R.pts[i], [-n[0], -n[1]]);
          if (!a || !b) continue;
          last = s;
          passages.push({ pts: [a, R.pts[i], b], at: s, rail: R });
        }
      }
      for (const pg of passages) lines.push({ pts: pg.pts, tag: street('local', LOCAL, { passage: true }) });
    }
    // Between the crossings, little shops and food stalls in the arches
    // under the viaduct, clear of every way across.
    const arcades = [];
    for (const R of railLines) {
      const clearOf = [...R.crossed, ...passages.filter((pg) => pg.rail === R).map((pg) => pg.at)];
      let s = 0;
      for (let i = 1; i < R.pts.length; i++) {
        const a = R.pts[i - 1];
        const seg = len(sub(R.pts[i], a));
        const t = unit(sub(R.pts[i], a));
        const n = [-t[1], t[0]];
        for (let x = Math.ceil(s / ARCH) * ARCH; x + ARCH <= s + seg; x += ARCH) {
          const mid = x + ARCH / 2;
          if (R.kinds[i - 1] !== 'viaduct' || R.kinds[i] !== 'viaduct' || clearOf.some((c) => Math.abs(c - mid) < ARCH_CLEAR)) continue;
          const c = [a[0] + t[0] * (mid - s), a[1] + t[1] * (mid - s)];
          const hl = (ARCH - 1.5) / 2;
          const hw = KIOSK_DEPTH / 2;
          arcades.push([0, 1, 2, 3].map((k) => {
            const u = k === 0 || k === 3 ? -hl : hl;
            const v = k < 2 ? -hw : hw;
            return [c[0] + t[0] * u + n[0] * v, c[1] + t[1] * u + n[1] * v];
          }));
        }
        s += seg;
      }
    }
    for (const L of railLines) lines.push({ pts: L.pts, tag: street('rail', RAIL_CORRIDOR) });
    for (const pk of d.parks) lines.push({ pts: pk.shape, closed: true, tag: street('park', PARKSIDE * 2, { park: pk.key }) });
    // Secondary greenways: linear parks along some stretches of the
    // boundaries between neighbourhoods, each from one main street to the
    // next, so they part the neighbourhoods cleanly. Streets run along their
    // sides; local streets meet them rather than crossing.
    const linearParks = secondaryGreenways(mains);
    for (const lp of linearParks) lines.push({ pts: lp.pts, closed: true, tag: street('park', PARKSIDE * 2, { linear: true }) });
    const { faces } = planarFaces(lines);
    const onLand = (p) => {
      let inside = false;
      for (const r of d.rings) if (pointInPolygon(p[0], p[1], r)) inside = !inside;
      if (!inside) return false;
      if (d.parks.some((pk) => pointInPolygon(p[0], p[1], pk.shape))) return false;
      if (linearParks.some((lp) => pointInPolygon(p[0], p[1], lp.pts))) return false;
      if (roundabouts.some((r) => pointInPolygon(p[0], p[1], r))) return false;
      return true;
    };
    const supers = faces.filter((f) => signedArea(f.pts) > 200 && onLand(interiorPoint(f.pts)));

    // ---- Sites ----
    // Distance to the nearest main street or boulevard, on the stage 3 raster.
    const onMain = new Uint8Array(R.W * R.H);
    for (const m of mains) stamp(R.cell, onMain, R.W, R.H, R.x0, R.y0, m.pts);
    const fromMain = distanceField(R.cell, onMain, R.W, R.H);
    // Each neighbourhood's park: on its land, set back from main streets and
    // the greenway, near where its people live.
    const parkSite = new Map();
    {
      const acc = hoods.map(() => [0, 0, 0]);
      for (let n = 0; n < R.label.length; n++) {
        const k = R.label[n];
        if (k < 0) continue;
        const w = R.dens[n];
        acc[k][0] += (R.x0 + ((n % R.W) + 0.5) * R.cell) * w;
        acc[k][1] += (R.y0 + (Math.floor(n / R.W) + 0.5) * R.cell) * w;
        acc[k][2] += w;
      }
      const best = hoods.map(() => null);
      for (let n = 0; n < R.label.length; n++) {
        const k = R.label[n];
        if (k < 0 || hoods[k].core) continue;
        const p = [R.x0 + ((n % R.W) + 0.5) * R.cell, R.y0 + (Math.floor(n / R.W) + 0.5) * R.cell];
        const m = Math.min(fromMain[n], 400);
        // Well set back if it can be; a narrow neighbourhood takes what it has.
        const g = [acc[k][0] / acc[k][2], acc[k][1] / acc[k][2]];
        const score = len(sub(p, g)) - 0.5 * m + (m < PARK_SITE_SET_BACK ? 2000 + (PARK_SITE_SET_BACK - m) * 10 : 0);
        if (!best[k] || score < best[k].score) best[k] = { score, p };
      }
      best.forEach((b, k) => b && parkSite.set(k, b.p));
    }
    const squareOf = new Map(); // hood id -> block
    const parkOf = new Map();

    // ---- Splitting ----
    const junctions = new Map(); // street id -> points where local streets meet it
    const meet = (t, p) => {
      if (!junctions.has(t.id)) junctions.set(t.id, []);
      junctions.get(t.id).push(p);
    };
    // Rowhouse neighbourhoods are the less dense ones.
    const formOf = (h) => (h.character === 'rowhouses' ? 'rowhouse' : 'perimeter');
    // The old town: the district's square in the middle of the core, and
    // round it the old buildings (its places of worship, museum, library,
    // courthouse...), traditional perimeter blocks with pedestrian streets
    // between them; the podiums and towers stand round it.
    const oldCentre = hoods[0] && hoods[0].core ? hoods[0].centre : d.station;
    const inOldTown = (q) => !!(hoods[0] && hoods[0].core) && len(sub(q, oldCentre)) < OLD_TOWN;
    const zoneOf = (node, ax) => {
      const h = hoodAt(ax.c);
      // A campus takes the middle of its neighbourhood; homes round it.
      if (h && h.campus && len(sub(ax.c, h.centre)) < Math.sqrt((CAMPUS_SHARE * h.area) / Math.PI)) return 'campus';
      if (h && h.core && inOldTown(ax.c)) return 'perimeter';
      if (h && h.core && len(sub(ax.c, d.station)) < d.coreReach * 1.25) return 'podium';
      // A neighbourhood is built in one form throughout: rowhouses or
      // perimeter blocks (its main streets mixed use either way).
      return h ? formOf(h) : 'perimeter';
    };

    // Distance along the boundary from point e (on edge i, param t) to the
    // nearest corner, where one street gives way to another.
    function cornerDist(node, i, t) {
      const P = node.pts;
      const T = node.tags;
      const n = P.length;
      const segLen = (k) => len(sub(P[(k + 1) % n], P[k]));
      let fwd = segLen(i) * (1 - t);
      for (let k = (i + 1) % n, guard = 0; T[k] === T[i] && guard < n; k = (k + 1) % n, guard++) fwd += segLen(k);
      let back = segLen(i) * t;
      for (let k = (i - 1 + n) % n, guard = 0; T[k] === T[i] && guard < n; k = (k - 1 + n) % n, guard++) back += segLen(k);
      return Math.min(fwd, back);
    }

    // Where a line through c along dir leaves the polygon, either way.
    function exits(node, c, dir) {
      const P = node.pts;
      const n = P.length;
      const far = 1e4;
      const a = [c[0] - dir[0] * far, c[1] - dir[1] * far];
      const b = [c[0] + dir[0] * far, c[1] + dir[1] * far];
      let lo = null;
      let hi = null;
      for (let i = 0; i < n; i++) {
        const h = segHit(a, b, P[i], P[(i + 1) % n]);
        if (!h) continue;
        const s = (h[0] - 0.5) * 2 * far;
        if (s < 0 && (!lo || s > lo.s)) lo = { s, i, t: h[1] };
        if (s > 0 && (!hi || s < hi.s)) hi = { s, i, t: h[1] };
      }
      return lo && hi ? [lo, hi] : null;
    }

    const at = (node, i, t) => {
      const a = node.pts[i];
      const b = node.pts[(i + 1) % node.pts.length];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    };
    // Inward normal of edge i (inside is on the right).
    const inward = (node, i) => {
      const t = unit(sub(node.pts[(i + 1) % node.pts.length], node.pts[i]));
      return [-t[1], t[0]];
    };

    // Line an end up with a street meeting the far side, or reject it.
    function settleEnd(node, e) {
      const tag = node.tags[e.i];
      const p = at(node, e.i, e.t);
      for (const q of junctions.get(tag.id) || []) {
        const r = len(sub(q, p));
        if (r < 0.5) return e;
        if (r <= ALIGN) {
          // Snap onto it, if it lies on this same stretch of the boundary.
          const n = node.pts.length;
          for (let k = 0; k < n; k++) {
            if (node.tags[k] !== tag) continue;
            const a = node.pts[k];
            const b = node.pts[(k + 1) % n];
            const ab = sub(b, a);
            const l2 = dot(ab, ab);
            const tt = l2 > 0 ? dot(sub(q, a), ab) / l2 : 0;
            if (tt < 0 || tt > 1) continue;
            const f = [a[0] + ab[0] * tt, a[1] + ab[1] * tt];
            if (len(sub(f, q)) < 0.3) return { ...e, i: k, t: tt, snapped: true };
          }
          return null;
        }
        if (r < JOG) return null;
      }
      return e;
    }

    // A gentle curve from e1 to e2, leaving and arriving square to the
    // streets at its ends.
    function curve(p1, n1, p2, n2) {
      const D = len(sub(p2, p1));
      const k = D * 0.5;
      const m = Math.max(2, Math.ceil(D / STEP));
      const out = [p1];
      for (let s = 1; s < m; s++) {
        const t = s / m;
        const h00 = 2 * t ** 3 - 3 * t * t + 1;
        const h10 = t ** 3 - 2 * t * t + t;
        const h01 = -2 * t ** 3 + 3 * t * t;
        const h11 = t ** 3 - t * t;
        out.push([h00 * p1[0] + h10 * k * n1[0] + h01 * p2[0] - h11 * k * n2[0], h00 * p1[1] + h10 * k * n1[1] + h01 * p2[1] - h11 * k * n2[1]]);
      }
      out.push(p2);
      return out;
    }

    function cut(node, e1, e2, pts, tag) {
      const P = node.pts;
      const T = node.tags;
      const n = P.length;
      const p1 = pts[0];
      const p2 = pts[pts.length - 1];
      // A: p1, boundary forward to p2, then the new street back to p1.
      const A = { pts: [p1], tags: [T[e1.i]] };
      for (let k = (e1.i + 1) % n, guard = 0; guard <= n; k = (k + 1) % n, guard++) {
        A.pts.push(P[k]);
        A.tags.push(T[k]);
        if (k === e2.i) break;
      }
      A.pts.push(p2);
      A.tags.push(tag);
      for (let s = pts.length - 2; s >= 1; s--) {
        A.pts.push(pts[s]);
        A.tags.push(tag);
      }
      const B = { pts: [p2], tags: [T[e2.i]] };
      for (let k = (e2.i + 1) % n, guard = 0; guard <= n; k = (k + 1) % n, guard++) {
        B.pts.push(P[k]);
        B.tags.push(T[k]);
        if (k === e1.i) break;
      }
      B.pts.push(p1);
      B.tags.push(tag);
      for (let s = 1; s < pts.length - 1; s++) {
        B.pts.push(pts[s]);
        B.tags.push(tag);
      }
      return [clean(A), clean(B)];
    }

    // The nearest place a ray from p along dir leaves the polygon.
    function rayExit(node, p, dir) {
      const P = node.pts;
      const n = P.length;
      const far = [p[0] + dir[0] * 1e4, p[1] + dir[1] * 1e4];
      let best = null;
      for (let i = 0; i < n; i++) {
        const h = segHit(p, far, P[i], P[(i + 1) % n]);
        if (!h || h[0] * 1e4 < 1) continue;
        if (!best || h[0] < best.s) best = { s: h[0], i, t: h[1] };
      }
      return best;
    }

    // Two blocks either side of one stretch of local street, joined into one
    // (the stretch between them goes), or null if they do not share one.
    function merge(A, B) {
      const n = A.pts.length;
      const m = B.pts.length;
      const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
      const inB = new Map(B.pts.map((p, j) => [key(p), j]));
      // Edges of A running backwards along B: A[i] -> A[i+1] is B[j+1] -> B[j].
      const shared = new Uint8Array(n);
      let count = 0;
      for (let i = 0; i < n; i++) {
        const j = inB.get(key(A.pts[(i + 1) % n]));
        if (j === undefined) continue;
        if (key(B.pts[(j + 1) % m]) === key(A.pts[i]) && A.tags[i].kind === 'local') {
          shared[i] = 1;
          count++;
        }
      }
      if (!count) return null;
      // One run only, from a corner to a corner.
      let start = -1;
      for (let i = 0; i < n; i++) if (shared[i] && !shared[(i - 1 + n) % n]) {
        if (start >= 0) return null;
        start = i;
      }
      if (start < 0) return null;
      let end = start;
      while (shared[(end + 1) % n]) end = (end + 1) % n;
      // A: from the run's far end round to its start; B: the rest.
      const pts = [];
      const tags = [];
      for (let i = (end + 1) % n; ; i = (i + 1) % n) {
        pts.push(A.pts[i]);
        tags.push(A.tags[i]);
        if (i === start) break;
      }
      // At A[start] we cross into B, which runs on from there.
      const jb = inB.get(key(A.pts[start]));
      const je = inB.get(key(A.pts[(end + 1) % n]));
      tags.pop();
      for (let j = jb; ; j = (j + 1) % m) {
        if (j !== jb) pts.push(B.pts[j]);
        tags.push(B.tags[j]);
        if ((j + 1) % m === je) break;
      }
      const out = clean({ pts, tags });
      return signedArea(out.pts) > 0 && !selfCrossing(out.pts) ? out : null;
    }

    // Try to split a node; returns its two children, or null.
    function split(node, ax, zone, opts = {}) {
      const size = BLOCK_SIZES[zone];
      const across = opts.along === undefined ? !(zone === 'rowhouse' && ax.L <= size.long && ax.W > size.short) : !opts.along;
      const dirs = across ? [ax.v, ax.u] : [ax.u, ax.v];
      const t0 = opts.at ?? 0.4 + rng.next() * 0.2;
      const ts = opts.at !== undefined ? [opts.at] : [t0, 0.5, 1 - t0, 0.36, 0.64, 0.3, 0.7];
      const jitter = (rng.next() - 0.5) * 0.3;
      const final = size.long * size.short * 2.5;
      // One candidate cut from e1 to e2 (a carried-on street is already lined up at e1).
      // Streets already meeting an edge at a point (from either side).
      const meetsAt = (k, p) => (junctions.get(node.tags[k].id) || []).filter((q) => len(sub(q, p)) < 1.5).length;
      function attempt(e1, e2, carried) {
        if (e1.i === e2.i) return null;
        if ((!carried && cornerDist(node, e1.i, e1.t) < CORNER_GAP) || cornerDist(node, e2.i, e2.t) < CORNER_GAP) return null;
        if (!carried) e1 = settleEnd(node, e1);
        e2 = e1 && settleEnd(node, e2);
        if (!e1 || !e2 || e1.i === e2.i) return null;
        // (Settled, still clear of the corners; and ending where at most one
        // other street already meets the edge, so no junction gets a fifth
        // arm.)
        if ((!carried && cornerDist(node, e1.i, e1.t) < CORNER_GAP) || cornerDist(node, e2.i, e2.t) < CORNER_GAP) return null;
        if (meetsAt(e1.i, at(node, e1.i, e1.t)) >= 2 || meetsAt(e2.i, at(node, e2.i, e2.t)) >= 1) return null;
        const p1 = at(node, e1.i, e1.t);
        const p2 = at(node, e2.i, e2.t);
        const n1 = inward(node, e1.i);
        const n2 = inward(node, e2.i);
        const ch = unit(sub(p2, p1));
        // Heading across, and not bending round much between its ends.
        if (dot(n1, ch) < 0.5 || -dot(n2, ch) < 0.5 || -dot(n1, n2) < 0.57) return null;
        const pts = curve(p1, n1, p2, n2);
        if (!gentle(pts)) return null;
        if (!inside(node, pts)) return null;
        const tag = street(opts.kind ?? 'local', opts.width ?? (zone === 'podium' ? CORE_CROSS : LOCAL));
        const kids = cut(node, e1, e2, pts, tag);
        if (kids.some((k) => k.pts.length < 3 || signedArea(k.pts) <= 0)) return null;
        if (opts.force) {
          // Even a forced split leaves both sides usable.
          if (kids.some((k) => axes(k.pts).W < FORCED_MIN)) return null;
        } else {
          for (const k of kids) {
            const a = axes(k.pts);
            // Deeper where a wide street takes more of the block.
            const wide = k.tags.some((t) => t.kind === 'main' || t.kind === 'boulevard') ? 18 : 0;
            if (a.W < size.min + wide || a.L < (size.minLong ?? size.min) || (a.area < final && a.area / (a.L * a.W) < 0.55)) return null;
          }
        }
        meet(node.tags[e1.i], p1);
        meet(node.tags[e2.i], p2);
        return kids;
      }
      // Streets meeting this block from outside, carried on across it: the
      // best placed first.
      const carry = [];
      if (opts.at === undefined) {
        const dir0 = dirs[0];
        const pos = dir0 === ax.v ? ax.u : ax.v;
        const [lo, hi] = dir0 === ax.v ? ax.eu : ax.ev;
        const n = node.pts.length;
        for (let k = 0; k < n; k++) {
          const tag = node.tags[k];
          const list = junctions.get(tag.id);
          if (!list) continue;
          const a = node.pts[k];
          const b = node.pts[(k + 1) % n];
          const ab = sub(b, a);
          const l2 = dot(ab, ab);
          const bx0 = Math.min(a[0], b[0]) - 0.5;
          const bx1 = Math.max(a[0], b[0]) + 0.5;
          const by0 = Math.min(a[1], b[1]) - 0.5;
          const by1 = Math.max(a[1], b[1]) + 0.5;
          for (const q of list) {
            if (q[0] < bx0 || q[0] > bx1 || q[1] < by0 || q[1] > by1) continue;
            const tt = l2 > 0 ? dot(sub(q, a), ab) / l2 : -1;
            if (tt <= 0 || tt >= 1) continue;
            const f = [a[0] + ab[0] * tt, a[1] + ab[1] * tt];
            if (len(sub(f, q)) > 0.3) continue;
            const along = (dot(sub(q, ax.c), pos) - lo) / (hi - lo);
            const nn = inward(node, k);
            if (along < 0.28 || along > 0.72 || Math.abs(dot(nn, dir0)) < 0.8) continue;
            carry.push({ e: { i: k, t: tt }, score: Math.abs(along - 0.5) });
          }
        }
        carry.sort((x, y) => x.score - y.score);
      }
      for (const { e } of carry) {
        const f = rayExit(node, at(node, e.i, e.t), inward(node, e.i));
        const kids = f && attempt(e, f, true);
        if (kids) return kids;
      }
      for (let di = 0; di < dirs.length; di++) {
        const dir0 = dirs[di];
        // The cut runs along dir0, placed along the other axis.
        const pos = dir0 === ax.v ? ax.u : ax.v;
        const [lo, hi] = dir0 === ax.v ? ax.eu : ax.ev;
        for (const t of ts) {
          for (const j of [jitter, 0]) {
            const c = [ax.c[0] + pos[0] * (lo + (hi - lo) * t), ax.c[1] + pos[1] * (lo + (hi - lo) * t)];
            const dir = [dir0[0] * Math.cos(j) - dir0[1] * Math.sin(j), dir0[0] * Math.sin(j) + dir0[1] * Math.cos(j)];
            const r = exits(node, c, dir);
            if (!r) continue;
            // Straight across, or leaving square from either end.
            const tries = [r];
            for (const [e, other] of [[r[0], 1], [r[1], 0]]) {
              const p = at(node, e.i, e.t);
              const f = rayExit(node, p, inward(node, e.i));
              if (f) tries.push(other ? [e, f] : [f, e]);
            }
            for (const [e1, e2] of tries) {
              const kids = attempt(e1, e2, false);
              if (kids) return kids;
            }
          }
        }
      }
      return null;
    }

    // Rowhouse land is laid out its own way: houses stand two deep, back to
    // back across a lane, so a block is never wider than two houses and
    // their gardens. Too wide a piece is cut into strips that wide first,
    // by streets along its length (as many as fit, not halved and halved
    // again); then each strip is cut across where it is too long, so cross
    // streets come every 120 to 240 m: long, narrow blocks.
    function splitRows(node, ax) {
      const size = BLOCK_SIZES.rowhouse;
      if (ax.W > size.short) {
        const k = Math.max(2, Math.round(ax.W / ROW_STRIP));
        const ts = [];
        for (let i = 1; i < k; i++) ts.push(i / k);
        // Outermost strips first, so a remainder ends up in the middle.
        ts.sort((a, b) => Math.abs(b - 0.5) - Math.abs(a - 0.5));
        for (const t of ts) {
          const kids = split(node, ax, 'rowhouse', { at: t, along: true });
          if (kids) return kids;
        }
        // Then at one strip's width from either side, and then, if it must,
        // anywhere that leaves both sides deep enough for houses.
        for (const t of [ROW_STRIP / ax.W, 1 - ROW_STRIP / ax.W]) {
          if (t <= 0 || t >= 1) continue;
          const kids = split(node, ax, 'rowhouse', { at: t, along: true });
          if (kids) return kids;
        }
        for (const t of [...ts, 0.5, 0.42, 0.58]) {
          const kids = split(node, ax, 'rowhouse', { at: t, along: true, force: true });
          if (kids && kids.every((q) => axes(q.pts).W >= size.min - 4)) return kids;
        }
      }
      // Too long: cut across into equal lengths, long ones (their terraces
      // broken by parkettes through to the lane), the first cut a length
      // in from one end.
      if (ax.L > size.long) {
        const k = Math.ceil(ax.L / size.long);
        for (const t of [1 / k, 1 - 1 / k, 0.5]) {
          const kids = split(node, ax, 'rowhouse', { at: t, along: false });
          if (kids) return kids;
        }
        const kids = split(node, ax, 'rowhouse', { along: false });
        if (kids) return kids;
      }
      return split(node, ax, 'rowhouse');
    }

    function gentle(pts) {
      let total = 0;
      for (let i = 1; i < pts.length - 1; i++) {
        const a = unit(sub(pts[i], pts[i - 1]));
        const b = unit(sub(pts[i + 1], pts[i]));
        const turn = Math.abs(Math.atan2(cross(a, b), dot(a, b)));
        if (turn > 0.2) return false;
        total += turn;
      }
      return total < 0.9;
    }

    // Does a new street stay inside the block? One point inside and no
    // crossing of the boundary between its ends is enough.
    function inside(node, pts) {
      const m = pts[pts.length >> 1];
      if (!pointInPolygon(m[0], m[1], node.pts)) return false;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [x, y] of pts) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      const P = node.pts;
      const near = [];
      for (let i = 0; i < P.length; i++) {
        const a = P[i];
        const b = P[(i + 1) % P.length];
        if (Math.max(a[0], b[0]) < x0 || Math.min(a[0], b[0]) > x1 || Math.max(a[1], b[1]) < y0 || Math.min(a[1], b[1]) > y1) continue;
        near.push(i);
      }
      for (let s = 1; s < pts.length - 2; s++) {
        for (const i of near) if (segHit(pts[s], pts[s + 1], P[i], P[(i + 1) % P.length])) return false;
      }
      return true;
    }

    // Does a node front a neighbourhood's main street right by its centre?
    const squareFor = (node, area, W) => {
      if (area < SQUARE_AREA[0] || area > SQUARE_AREA[1] || W < SQUARE_MIN || !node.tags.some((t) => t.kind === 'local')) return null;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [x, y] of node.pts) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      for (const h of hoods) {
        if (squareOf.has(h.id)) continue;
        const [hx, hy] = h.centre;
        if (hx < x0 - 5 || hx > x1 + 5 || hy < y0 - 5 || hy > y1 + 5) continue;
        for (let i = 0; i < node.pts.length; i++) {
          const t = node.tags[i];
          if (t.kind !== 'main' && t.kind !== 'boulevard') continue;
          const a = node.pts[i];
          const b = node.pts[(i + 1) % node.pts.length];
          if (distToLine(h.centre[0], h.centre[1], [a, b]) < 3 && cornerDist(node, i, 0.5) > 20) return h;
        }
      }
      return null;
    };
    const parkFor = (node, area) => {
      if (area < PARK_PAIR_AREA[0] || area > PARK_PAIR_AREA[1]) return null;
      for (const [k, p] of parkSite) if (!parkOf.has(k) && pointInPolygon(p[0], p[1], node.pts)) return hoods[k];
      return null;
    };

    // About three districts in five have a stadium.
    const wantStadium = toUnit(hash(seed, 'stadium', ...keyInts(d.coreInfo))) < STADIUM_SHARE;
    let stadiumPlaced = false;
    // Cut a block of a stadium's size from a node: a strip of its width
    // along one side, then that strip cut to its length. Returns the block
    // and the pieces left, or null.
    function carve(node, ax, zone) {
      const [SL, SW] = STADIUM_SITE;
      for (const t of [SW / ax.W, 1 - SW / ax.W]) {
        const kids = split(node, ax, zone, { at: t, along: true, force: true });
        if (!kids) continue;
        const [strip, other] = kids.map((k) => ({ k, a: axes(k.pts) })).sort((x, y) => Math.abs(x.a.W - SW) - Math.abs(y.a.W - SW));
        if (Math.abs(strip.a.W - SW) > 18) continue;
        for (const u of [SL / strip.a.L, 1 - SL / strip.a.L, 0.5]) {
          if (u <= 0 || u >= 1) continue;
          const parts = split(strip.k, strip.a, zone, { at: u, along: false, force: true });
          if (!parts) continue;
          const [blk, rest] = parts.map((k) => ({ k, a: axes(k.pts) })).sort((x, y) => Math.abs(x.a.L - SL) - Math.abs(y.a.L - SL));
          if (Math.abs(blk.a.L - SL) > 45 || blk.a.W < SW - 18 || rectness(blk.k.pts) < 0.85) continue;
          return { block: blk.k, rest: [other.k, rest.k] };
        }
      }
      return null;
    }
    // A school's grounds cut down to size if they run on too long: the
    // school keeps one end, and the rest is left for ordinary blocks.
    function schoolSized(node, depth = 0) {
      const ax = axes(node.pts);
      if (ax.L <= SCHOOL_LONGEST) return [node, null];
      const f = SCHOOL_LENGTH / ax.L;
      // (Cut where it should be if it can be; failing that, wherever a cut
      // will go, and the school's piece cut again if still too long.)
      for (const at of [f, 1 - f, f * 1.12, 1 - f * 1.12, f * 0.9, 1 - f * 0.9, undefined]) {
        if (at !== undefined && (at <= 0.15 || at >= 0.85)) continue;
        const kids = split(node, ax, 'campus', { at, force: true, along: false });
        if (!kids) continue;
        const [a, b] = Math.abs(axes(kids[0].pts).L - SCHOOL_LENGTH) <= Math.abs(axes(kids[1].pts).L - SCHOOL_LENGTH) ? kids : [kids[1], kids[0]];
        if (polygonArea(a.pts) < SCHOOL_AREA) continue;
        if (axes(a.pts).L > SCHOOL_LONGEST && depth < 1) {
          const [a2, b2] = schoolSized(a, depth + 1);
          // (The second offcut is left as its own block too.)
          if (b2) return [a2, b, b2];
        }
        return [a, b];
      }
      return [node, null];
    }
    const leaves = [];
    let queue = supers.map((f) => ({ pts: f.pts, tags: f.tags }));
    queue.sort((a, b) => a.pts[0][0] - b.pts[0][0] || a.pts[0][1] - b.pts[0][1]);
    for (let depth = 0; queue.length && depth < 40; depth++) {
      const next = [];
      for (const node of queue) {
        const ax = axes(node.pts);
        const zone = zoneOf(node, ax);
        const sq = squareFor(node, ax.area, ax.W);
        if (sq) {
          const leaf = { ...node, ax, use: 'square', hood: sq.id };
          squareOf.set(sq.id, leaf);
          leaves.push(leaf);
          continue;
        }
        // A stadium's own block, cut to its size from a large piece of land
        // near the core: a rectangle, the stadium filling it.
        if (wantStadium && !stadiumPlaced && zone !== 'campus') {
          const r = len(sub(ax.c, d.station));
          if (r > STADIUM_REACH[0] && r < STADIUM_REACH[1] && ax.W >= STADIUM_SITE[1] + 70 && ax.L >= STADIUM_SITE[0] + 70) {
            const site = carve(node, ax, zone);
            if (site) {
              stadiumPlaced = true;
              leaves.push({ ...site.block, ax: axes(site.block.pts), use: 'stadium', hood: hoodAt(site.block.ax ? site.block.ax.c : axes(site.block.pts).c)?.id ?? 0 });
              next.push(...site.rest);
              continue;
            }
          }
        }
        const pk = parkFor(node, ax.area);
        if (pk) {
          parkOf.set(pk.id, node);
          let kids = null;
          for (const at of [PARK_SHARE, 0.45, 0.58]) if (!kids) kids = split(node, ax, 'campus', { at, force: true, along: false });
          if (kids) {
            // The park is the larger piece.
            const [a, b] = kids[0].pts && polygonArea(kids[0].pts) >= polygonArea(kids[1].pts) ? kids : [kids[1], kids[0]];
            leaves.push({ ...a, ax: axes(a.pts), use: 'park', hood: pk.id });
            // (Too narrow a strip for a school is left for ordinary blocks:
            // the school goes on a block nearby instead.)
            if (axes(b.pts).W < SCHOOL_WIDE) next.push(b);
            else {
              const [school, ...rest] = schoolSized(b);
              leaves.push({ ...school, ax: axes(school.pts), use: 'school', hood: pk.id });
              for (const r of rest) if (r) next.push(r);
            }
          } else {
            leaves.push({ ...node, ax, use: 'park', hood: pk.id });
          }
          continue;
        }
        const sizeZone = zone;
        const size = BLOCK_SIZES[sizeZone];
        // (A rowhouse block must also be near enough rectangular for its
        // terraces; one that is not is split again, if it is big enough.)
        const awkwardRow = zone === 'rowhouse' && ax.area > ROW_AWKWARD_AREA && rectness(node.pts) < TERRACE_RECT_GOOD;
        if (ax.L <= size.long && ax.W <= size.short && !awkwardRow) {
          leaves.push({ ...node, ax, zone });
          continue;
        }
        let kids = zone === 'rowhouse' ? splitRows(node, ax) : split(node, ax, sizeZone);
        // A block well over size that will not split the usual way is split
        // anyway, either way across, so long as both sides stay usable: no
        // block is left several times the size of its neighbours.
        if (!kids && ax.area > size.long * size.short * OVERSIZE) {
          for (const along of [false, true]) if (!kids) kids = split(node, ax, sizeZone, { force: true, along });
        }
        // (Nor a rowhouse block wider than two houses and their gardens.)
        if (!kids && zone === 'rowhouse' && ax.W > size.short * 1.05) {
          for (const at of [0.5, 0.42, 0.58, undefined]) if (!kids) kids = split(node, ax, 'rowhouse', { force: true, along: true, at });
        }
        if (kids) next.push(...kids);
        else leaves.push({ ...node, ax, zone, stuck: true });
      }
      queue = next;
    }
    for (const node of queue) leaves.push({ ...node, ax: axes(node.pts), zone: zoneOf(node, axes(node.pts)), stuck: true });

    // ---- Fallbacks ----
    // Every leaf a plain block, of the land kinds.
    const plain = (lf) => !lf.use && (lf.zone === 'perimeter' || lf.zone === 'rowhouse' || lf.zone === 'podium');
    // A square on the main street near the centre, if splitting found none.
    for (const h of hoods) {
      if (squareOf.has(h.id)) continue;
      let best = null;
      // (Failing one of about the right size, a larger block will do.)
      for (const [most, far] of [[1.3, 1], [1.8, 1], [2.6, 1.6]]) {
        if (best) break;
        for (const lf of leaves) {
          // (On a campus, its own square.)
          // (It needs a local street to turn into its pedestrian street.)
          if (!lf.tags.some((t) => t.kind === 'local')) continue;
          if (!(plain(lf) || (!lf.use && lf.zone === 'campus')) || lf.ax.area < SQUARE_AREA[0] * 0.7 || lf.ax.area > SQUARE_AREA[1] * most || lf.ax.W < SQUARE_MIN * 0.9) continue;
          if (len(sub(lf.ax.c, h.centre)) > FALLBACK_REACH * far + 150) continue;
          let r = Infinity;
          lf.tags.forEach((t, i) => {
            if (t.kind !== 'main' && t.kind !== 'boulevard') return;
            r = Math.min(r, distToLine(h.centre[0], h.centre[1], [lf.pts[i], lf.pts[(i + 1) % lf.pts.length]]));
          });
          if (r > FALLBACK_REACH * far) continue;
          if (!best || r < best.r) best = { r, lf };
        }
      }
      if (best) {
        best.lf.use = 'square';
        best.lf.hood = h.id;
        squareOf.set(h.id, best.lf);
      }
    }
    // A park near its site, if splitting found none: the best block there,
    // joined with its neighbour across a local street if it is small.
    for (const [k, site] of parkSite) {
      if (parkOf.has(k)) continue;
      let best = null;
      for (const lf of leaves) {
        if (!plain(lf) || lf.tags.some((t) => t.kind === 'main' || t.kind === 'boulevard')) continue;
        const r = len(sub(lf.ax.c, site));
        if (r > 400) continue;
        const score = r - Math.min(lf.ax.area, 3e4) / 60;
        if (!best || score < best.score) best = { score, lf };
      }
      if (!best) continue;
      let park = best.lf;
      if (park.ax.area < PARK_PAIR_AREA[0] * 0.55) {
        let mate = null;
        for (const lf of leaves) {
          if (lf === park || !plain(lf) || lf.tags.some((t) => t.kind === 'main' || t.kind === 'boulevard')) continue;
          const joined = merge(park, lf);
          if (joined && (!mate || lf.ax.area > mate.lf.ax.area)) mate = { lf, joined };
        }
        if (mate) {
          mate.lf.use = 'merged';
          park.pts = mate.joined.pts;
          park.tags = mate.joined.tags;
          park.ax = axes(park.pts);
        }
      }
      park.use = 'park';
      park.hood = k;
      parkOf.set(k, park);
    }
    for (let i = leaves.length - 1; i >= 0; i--) if (leaves[i].use === 'merged') leaves.splice(i, 1);
    // A secondary school by each park that has none.
    const schools = new Set(leaves.filter((lf) => lf.use === 'school').map((lf) => lf.hood));
    for (const [k, park] of parkOf) {
      if (schools.has(k)) continue;
      const parkPts = new Set(park.pts.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`));
      let best = null;
      // (Wide enough for its field if one is near, any size that will do if not.)
      for (const wide of [SCHOOL_WIDE, 0]) {
        if (best) break;
        for (const lf of leaves) {
          if (!plain(lf) || lf.ax.area < SCHOOL_AREA || lf.ax.W < wide || lf.tags.some((t) => t.kind === 'main' || t.kind === 'boulevard')) continue;
          const r = len(sub(lf.ax.c, (park.ax || axes(park.pts)).c));
          if (r > 450) continue;
          // Across a street from the park if it can be.
          const touches = lf.pts.some((p) => parkPts.has(`${p[0].toFixed(3)},${p[1].toFixed(3)}`));
          const score = r - (touches ? 300 : 0);
          if (!best || score < best.score) best = { score, lf };
        }
      }
      if (best) {
        const [school, ...rest] = schoolSized(best.lf);
        if (rest[0]) {
          Object.assign(best.lf, school, { ax: axes(school.pts) });
          for (const r of rest) leaves.push({ ...r, ax: axes(r.pts), zone: best.lf.zone });
        }
        best.lf.use = 'school';
        best.lf.hood = k;
      }
    }

    // Squares take one of three forms. Some stand on their own, streets all
    // round. Others go right up against the block across a local street:
    // that stretch of street becomes part of the square, so the block's
    // buildings face straight onto it. Others again fill the corner of two
    // such streets, against blocks on two adjacent sides. A street a square
    // takes in goes on beyond it as a pedestrian street; a square on its own
    // gets one too, off its longest local side.
    const pedestrianiseStreet = (t, c) => {
      t.kind = 'pedestrian';
      t.w = PEDESTRIAN;
      t.square = c;
    };
    for (const [hid, sqNode] of squareOf) {
      const P = sqNode.pts;
      const n = P.length;
      const c = axes(P).c;
      // (A pedestrian street runs at least the length of its square.)
      const span = Math.max(...P.map((q) => len(sub(q, c)))) + 30;
      const pedestrianise = (t, at) => {
        pedestrianiseStreet(t, at);
        if (t.reach !== Infinity) t.reach = Math.max(t.reach ?? PEDESTRIAN_REACH, span);
      };
      // Local sides, by street, with their length and edges.
      const sides = new Map();
      sqNode.tags.forEach((t, i) => {
        if (t.kind !== 'local') return;
        if (!sides.has(t.id)) sides.set(t.id, { t, l: 0, edges: [] });
        const sd = sides.get(t.id);
        sd.l += len(sub(P[(i + 1) % n], P[i]));
        sd.edges.push(i);
      });
      const list = [...sides.values()].filter((sd) => sd.l >= SQUARE_SIDE).sort((a, b) => b.l - a.l || a.t.id - b.t.id);
      // Two sides are adjacent if one's last edge runs into the other's first.
      const meet = (a, b) => a.edges.some((i) => b.edges.includes((i + 1) % n)) || b.edges.some((i) => a.edges.includes((i + 1) % n));
      let pair = null;
      for (let i = 0; i < list.length && !pair; i++) for (let j = i + 1; j < list.length && !pair; j++) if (meet(list[i], list[j])) pair = [list[i], list[j]];
      const u = toUnit(hash(seed, 'square-form', hid, ...keyInts(d.coreInfo)));
      const form = pair && u < SQUARE_FORMS.corner ? 'corner' : list.length && u < SQUARE_FORMS.corner + SQUARE_FORMS.against ? 'against' : 'island';
      sqNode.infill = new Set();
      if (form === 'corner') for (const sd of pair) sqNode.infill.add(sd.t.id);
      if (form === 'against') sqNode.infill.add(list[0].t.id);
      sqNode.form = form;
      for (const sd of list) if (sqNode.infill.has(sd.t.id)) pedestrianise(sd.t, c);
      if (form === 'island') {
        // (The longest local side, by its whole street.)
        let best = null;
        sqNode.tags.forEach((t, i) => {
          if (t.kind !== 'local') return;
          const l = len(sub(P[(i + 1) % n], P[i]));
          if (!best || l > best.l) best = { t, l };
        });
        if (best) pedestrianise(best.t, c);
      }
    }

    // The old town is a pedestrian zone: its local streets are given over
    // to people on foot (and bikes), as in the old centre of a European
    // city; main streets and boulevards still cross it.
    const coreSquare = squareOf.get(0);
    if (coreSquare) {
      const c = axes(coreSquare.pts).c;
      for (const lf of leaves) {
        lf.tags.forEach((t, i) => {
          if (t.kind !== 'local') return;
          const a = lf.pts[i];
          const b = lf.pts[(i + 1) % lf.pts.length];
          const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          if (inOldTown(m) || len(sub(m, c)) < PEDESTRIAN_ZONE) {
            pedestrianiseStreet(t, c);
            t.reach = Infinity; // (the whole street, not cut short partway)
          }
        });
      }
    }

    // ---- Blocks ----
    // A pedestrian street runs a block or two from its square, then goes on
    // as a local street (in the centre's pedestrian zone, to its edge).
    const kindAt = (t, p) => (t.kind === 'pedestrian' && len(sub(p, t.square)) > (t.reach ?? PEDESTRIAN_REACH) ? 'local' : t.kind);
    const half = (t, p) => {
      if (t.kind === 'pedestrian') return (kindAt(t, p) === 'pedestrian' ? PEDESTRIAN : LOCAL) / 2;
      if (t.kind === 'greenway') return PARKSIDE / 2;
      if (t.kind === 'park') return PARKSIDE;
      return t.w / 2;
    };
    const blocks = [];
    const streets = new Map();
    for (const lf of leaves) {
      const P = lf.pts;
      const n = P.length;
      // A square reaches across a street it takes in, to the building line
      // of the block on the far side.
      const dist = lf.tags.map((t, i) => {
        const h = half(t, [(P[i][0] + P[(i + 1) % n][0]) / 2, (P[i][1] + P[(i + 1) % n][1]) / 2]);
        return lf.infill && lf.infill.has(t.id) ? -h : h;
      });
      for (let i = 0; i < n; i++) {
        const t = lf.tags[i];
        if (t.kind !== 'local' && t.kind !== 'pedestrian' && t.kind !== 'rail') continue;
        const mid = [(P[i][0] + P[(i + 1) % n][0]) / 2, (P[i][1] + P[(i + 1) % n][1]) / 2];
        const kind = kindAt(t, mid);
        const k = `${t.id}:${kind}`;
        if (!streets.has(k)) streets.set(k, { tag: t, kind, width: kind === 'pedestrian' ? PEDESTRIAN : t.kind === 'pedestrian' ? LOCAL : t.w, segs: [] });
        streets.get(k).segs.push([P[i], P[(i + 1) % n]]);
      }
      const res = splay(insetWithSources(P, dist));
      const net = res ? res.pts : null;
      const area = net ? polygonArea(net) : 0;
      // What each edge of the building line faces.
      let fronts = null;
      if (net) {
        fronts = res.src.map((k) => (k >= 0 ? lf.tags[k].kind : null));
        for (let j = 0; j < fronts.length; j++) {
          if (fronts[j]) continue;
          // A cut-off corner faces what its neighbour does; an unknown edge,
          // the nearest street.
          if (res.src[j] === -1) fronts[j] = fronts[(j - 1 + fronts.length) % fronts.length] || fronts[(j + 1) % fronts.length];
          if (fronts[j]) continue;
          const m = [(net[j][0] + net[(j + 1) % net.length][0]) / 2, (net[j][1] + net[(j + 1) % net.length][1]) / 2];
          let best = Infinity;
          for (let i = 0; i < n; i++) {
            const dd = distToLine(m[0], m[1], [P[i], P[(i + 1) % n]]);
            if (dd < best) {
              best = dd;
              fronts[j] = lf.tags[i].kind;
            }
          }
        }
      }
      // A rowhouse block on a main street is built up as a mixed-use block.
      const front = lf.tags.some((t) => t.kind === 'main' || t.kind === 'boulevard');
      // A small block of awkward shape (a triangle, say) is left as a green:
      // no plots cut from it would make sensible buildings.
      const awkward = net && ((area < AWKWARD_AREA && rectness(net) < AWKWARD_RECT) || (lf.zone === 'rowhouse' && !lf.use && area < ROW_AWKWARD_AREA && rectness(net) < TERRACE_RECT_GOOD - 0.1));
      const use = lf.use ?? (area < REMNANT || awkward ? 'green' : lf.zone === 'rowhouse' && front ? 'perimeter' : lf.zone);
      const b = { pts: net, centreline: P, dist, use, area, stuck: !!lf.stuck, raw: polygonArea(P), hood: lf.hood ?? (hoodAt(lf.ax.c) || {}).id, front: lf.tags.some((t) => t.kind === 'main' || t.kind === 'boulevard') };
      if (lf.zone === 'perimeter' && inOldTown(lf.ax.c)) b.oldTown = true;
      if (lf.form) b.form = lf.form;
      if (!net) b.use = 'green';
      else {
        let pl = plotsOfBlock(net, fronts, b.use, axes(net).W, rng);
        // A rowhouse block that would take neither terraces nor a ring of
        // houses (cut into long strips instead) is left as a green.
        if (b.use === 'rowhouse' && !pl.alley && !pl.inner) {
          b.use = 'green';
          pl = plotsOfBlock(net, fronts, 'green', 0, rng);
        }
        b.plots = pl.plots;
        b.inner = pl.inner;
        b.court = pl.court;
        if (pl.alley) b.alley = pl.alley;
        b.fronts = fronts;
      }
      blocks.push(b);
    }

    // Local and pedestrian streets as centrelines, joined up from block sides.
    const local = [];
    const usedNames = new Set();
    for (const { tag, kind, width, segs } of streets.values()) {
      // Each side appears twice (once from each block): keep one copy.
      const seen = new Set();
      const keep = [];
      for (const [a, b] of segs) {
        const k1 = `${a[0].toFixed(2)},${a[1].toFixed(2)}|${b[0].toFixed(2)},${b[1].toFixed(2)}`;
        const k2 = `${b[0].toFixed(2)},${b[1].toFixed(2)}|${a[0].toFixed(2)},${a[1].toFixed(2)}`;
        if (seen.has(k1) || seen.has(k2)) continue;
        seen.add(k1);
        keep.push([a, b]);
      }
      // Joined into lines (for its name along it), and named by its shape.
      const lines = joinSegs(keep);
      let length = 0;
      for (const [a, b] of keep) length += len(sub(b, a));
      const main = lines.slice().sort((x, y) => y.length - x.length)[0] || [];
      let turn = 0;
      for (let i = 1; i < main.length - 1; i++) {
        const a = unit(sub(main[i], main[i - 1]));
        const b = unit(sub(main[i + 1], main[i]));
        turn += Math.atan2(cross(a, b), dot(a, b));
      }
      // (No two streets of a district share a name.)
      let name = null;
      for (let salt = 0; salt < 8 && (!name || usedNames.has(name.short)); salt++) name = names.street(kind === 'pedestrian' || kind === 'rail' ? 'pedestrian' : 'local', hashString(`${d.key}:${tag.id}`), { length, curved: Math.abs(turn) > 1.1 }, salt);
      usedNames.add(name.short);
      local.push({ id: tag.id, kind, width, segs: keep, lines, name });
    }

    // ---- Neighbourhoods, block by block ----
    // Every block belongs to one neighbourhood, so boundaries run down the
    // middle of streets. Each neighbourhood is then planned for the people
    // its own blocks' land holds (stage 3's plan, shifted with the land).
    const { planned, hoodLines } = hoodsByBlock(blocks);

    // Paths into the greenways, from local streets that meet them and from
    // the pavements of streets that pass under them.
    const greenLinks = greenway ? linksToGreenways(leaves) : [];
    // A linear park's trail runs down its middle; where a local street meets
    // the park, a path joins it to the trail (paired across the park, a
    // crossing for people walking and cycling).
    for (const lp of linearParks) {
      lp.links = [];
      // An end in a primary greenway: a path on to its trail.
      if (greenway) {
        for (const q of [lp.centre[0], lp.centre[lp.centre.length - 1]]) {
          let best = null;
          for (const c of d.chains) {
            for (const T of greenway(c.geo).trails) for (let i = 0; i < T.length - 1; i++) {
              const a = T[i];
              const ab = sub(T[i + 1], a);
              const l2 = dot(ab, ab);
              const t = l2 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2)) : 0;
              const f = [a[0] + ab[0] * t, a[1] + ab[1] * t];
              const r = len(sub(f, q));
              if (!best || r < best.r) best = { p: f, r };
            }
          }
          if (best && best.r < greenwayWidth(q[0], q[1]) && dryPath([q, best.p, [(q[0] + best.p[0]) / 2, (q[1] + best.p[1]) / 2]])) greenLinks.push([q, best.p]);
        }
      }
      const near = (q) => {
        let best = null;
        for (let i = 0; i < lp.centre.length - 1; i++) {
          const a = lp.centre[i];
          const ab = sub(lp.centre[i + 1], a);
          const l2 = dot(ab, ab);
          const t = l2 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2)) : 0;
          const f = [a[0] + ab[0] * t, a[1] + ab[1] * t];
          const r = len(sub(f, q));
          if (!best || r < best.r) best = { p: f, r };
        }
        return best;
      };
      const seen = [];
      for (const lf of leaves) {
        const n = lf.pts.length;
        for (let i = 0; i < n; i++) {
          const a = lf.tags[(i - 1 + n) % n];
          const b = lf.tags[i];
          const meets = (a.kind === 'local' && b.linear) || (a.linear && b.kind === 'local');
          if (!meets) continue;
          const q = lf.pts[i];
          if (seen.some((o) => len(sub(o, q)) < 8)) continue;
          seen.push(q);
          const c = near(q);
          if (c && c.r < lp.width / 2 + PARKSIDE * 2 + 6) lp.links.push([q, c.p]);
        }
      }
    }

    // What every plot is for.
    const programme = assignProgramme(seed, d, blocks, planned);
    // Rail stations lie underground, their platforms under the street; the
    // ground floors of buildings round them are given over to their
    // entrances (fare gates, stairs and lifts down to the concourse), spread
    // along the platforms and on both sides, more for the central station.
    const entrances = [];
    stationsIn(d).forEach((st, si) => {
      const box = hallOf(st);
      const reach = box.L / 2 + ENTRANCE_REACH;
      // Spots along the frontages of buildings that may take one, every
      // 20 m or so.
      const near = [];
      for (const b of blocks) {
        if (!b.plots || ['square', 'park', 'green', 'school', 'elementarySchool', 'campus', 'stadium'].includes(b.use)) continue;
        for (const p of b.plots) {
          if ((p.dedicated && !ENTRANCE_HOSTS.has(p.dedicated)) || !p.pts || p.cls === 'open' || p.cls === 'house' || p.cls === 'passage') continue;
          const n = p.pts.length;
          const outline = b.pts.concat([b.pts[0]]);
          for (let i = 0; i < n; i++) {
            const e0 = p.pts[i];
            const e1 = p.pts[(i + 1) % n];
            const L = len(sub(e1, e0));
            for (let k = 0.5; k < L / 20; k++) {
              const q = [e0[0] + ((e1[0] - e0[0]) * k * 20) / L, e0[1] + ((e1[1] - e0[1]) * k * 20) / L];
              // (On the street, not a lot line within the block.)
              if (distToLine(q[0], q[1], outline) > 1.5) continue;
              const rel = sub(q, st.p);
              const a = dot(rel, box.t);
              const o = dot(rel, box.n);
              if (Math.abs(a) > reach || Math.abs(o) > ENTRANCE_REACH + box.W / 2) continue;
              near.push({ p, q, a, o, r: Math.hypot(Math.max(0, Math.abs(a) - box.L / 2), Math.max(0, Math.abs(o) - box.W / 2)) });
            }
          }
        }
      }
      // Near each end of the platforms and the middle, on each side in
      // turn; then any others, nearest first, kept apart.
      const want = st.central ? ENTRANCES_CENTRAL : ENTRANCES;
      const spots = [];
      for (const a of [-box.L / 2, box.L / 2, 0, -box.L / 4, box.L / 4]) for (const sg of [1, -1]) spots.push([a, sg]);
      const taken = [];
      const free = (q) => !taken.some((x) => len(sub(x.q, q)) < ENTRANCE_GAP);
      for (const [a, sg] of spots) {
        if (taken.length >= want) break;
        let best = null;
        for (const x of near) {
          if (Math.sign(x.o) !== sg || !free(x.q)) continue;
          const score = Math.abs(x.a - a) + x.r * 2;
          if (!best || score < best.score) best = { score, x };
        }
        if (best) taken.push(best.x);
      }
      for (const x of near.sort((u, v) => u.r - v.r)) if (taken.length < want && free(x.q)) taken.push(x);
      // One more in the district's plaza, if it is close: stairs down from
      // the square itself, on its side nearest the platforms.
      const plaza = blocks.find((b) => b.use === 'square' && b.hood === 0 && b.plots && b.plots.length);
      if (plaza) {
        let best = null;
        for (const q of plaza.pts) {
          const rel = sub(q, st.p);
          const r = Math.hypot(Math.max(0, Math.abs(dot(rel, box.t)) - box.L / 2), Math.max(0, Math.abs(dot(rel, box.n)) - box.W / 2));
          if (!best || r < best.r) best = { r, q };
        }
        if (best && best.r < PLAZA_ENTRANCE_REACH) {
          const c = axes(plaza.pts).c;
          const q = sub(best.q, [(best.q[0] - c[0]) * 0.15, (best.q[1] - c[1]) * 0.15]);
          if (free(q)) taken.push({ p: plaza.plots[0], q });
        }
      }
      for (const x of taken) {
        // (Its ground floor given over to it, where it is not a building
        // of its own.)
        if (!x.p.dedicated) x.p.ground = 'stationEntrance';
        (x.p.entrances ||= []).push(x.q);
        entrances.push({ p: x.q, station: si, central: !!st.central });
      }
    });
    // And what stands on it.
    assignBuildings(seed, d, blocks);
    // What is in the parks, and the schools' grounds.
    const parkRng = rngFor(seed, 'park-layout', ...keyInts(d.coreInfo));
    // Schools' grounds: a track and field where there is room.
    for (const b of blocks) {
      if (!b.plots || !b.plots.length || (b.use !== 'school' && b.use !== 'elementarySchool')) continue;
      const q = b.plots[0];
      b.layout = layoutSchool(b.pts, parkRng, b.use === 'school');
      // The building where the grounds leave room for it.
      if (q.bldg && b.layout.building) q.bldg = { ...q.bldg, pts: b.layout.building, ridge: null };
    }
    for (const b of blocks) {
      if (!b.plots || !b.plots.length) continue;
      if (b.use === 'park') {
        b.layout = layoutNeighbourhoodPark(b.pts, parkRng);
        if (b.layout.centre) {
          b.plots[0].bldg = communityCentre(b.layout.centre);
          b.plots[0].also = 'communityCentre';
        }
      }
      for (const q of b.plots) if (q.dedicated === 'parkette' && q.pts.length > 2) q.layout = layoutParkette(q.pts, parkRng);
      // A stadium's pitch.
      if (b.use === 'stadium' && b.plots[0].bldg && b.plots[0].bldg.pitch) b.layout = { features: [{ kind: 'pitch', pts: b.plots[0].bldg.pitch }], paths: [] };
    }
    // District parks, laid out the same way by every district they touch.
    const districtParks = d.parks.map((pk) => ({ key: pk.key, layout: layoutDistrictPark(pk.shape, rngFor(seed, 'district-park', hashString(pk.key)), isWater) }));

    // The streets along greenways and parks, as centreline loops.
    const sides = lines.filter((l) => l.tag.kind === 'greenway' || l.tag.kind === 'park').map((l) => ({ kind: l.tag.kind, pts: l.pts }));
    // How each junction is laid out, by the streets that meet there, and
    // where the tram stops are (on the far sides of signalised junctions).
    const places = [d.station];
    for (const b of blocks) if (['square', 'cathedral', 'hospital', 'school', 'elementarySchool', 'recCentre', 'campus'].includes(b.use) && b.pts) places.push(axes(b.pts).c);
    const { junctions: laidOut, stops: tramStopList } = planJunctions(hashString(d.key), {
      majors: [...st.lines.map((l) => ({ pts: l.points, type: 'mainStreet', typeAt: (q) => (corePoly && pointInPolygon(q[0], q[1], corePoly) ? 'coreMainStreet' : 'mainStreet') })), ...d.network.lines.filter((l) => l.kind !== 'roundabout').map((l) => ({ pts: l.points, type: 'boulevard' }))],
      // (A podium core's streets are core residential streets.)
      local: local.map((x) => ({ ...x, kind: x.kind === 'local' && x.width >= CORE_CROSS - 0.1 ? 'core' : x.kind })),
      alleys: blocks.map((b) => b.alley).filter(Boolean),
      greenways: linearParks.map((lp) => lp.centre),
      places,
      onLand: (q) => sideLoops.some((lp) => pointInPolygon(q[0], q[1], lp)),
    });
    // A square that takes in the streets beside it is paved right across
    // them: no kerbs, crossings or bollards where streets meet on it. (Where
    // one meets a tram street, its crossing over the tram street stays.)
    const paved = [...squareOf.values()].filter((sq) => sq.infill && sq.infill.size).map((sq) => sq.pts);
    const onSquare = (q) => paved.some((P) => pointInPolygon(q[0], q[1], P) || distToLine(q[0], q[1], P.concat([P[0]])) < PEDESTRIAN / 2 + 2);
    const intersections = laidOut.filter((j) => j.arms.some((a) => isTramStreet(a.type)) || !onSquare(j.p));
    return { blocks, streets: local, intersections, sides, supers: supers.length, parkSites: [...parkSite.values()], programme, planned, hoodLines, tramStops: tramStopList, greenLinks, districtParks, linearParks, arcades, entrances };
  }

  // Forget a district's blocks (a worker that has handed them on keeps none).
  const forget = (d) => cache.delete(d.key);
  return { of, forget };
}
