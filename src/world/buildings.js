// Stage 5, first part: buildings on their plots.
//
// Each plot that is built on gets one building (a podium may carry a tower):
// its footprint, its height, its architectural style, and the form and
// colour of its roof. Footprints vary the way a real street does without
// breaking the street wall: on a main street buildings stand on the
// building line; on quieter streets a few step back a metre or two, and
// their backs vary in depth; rowhouses have front gardens; in the core some
// towers stand back behind a forecourt. Styles are traditional European ones
// for the most part, varying by district, neighbourhood and block; schools,
// hospitals and towers are modern; churches, the cathedral and civic
// buildings are landmarks of their own.

import { hash, hashString, toUnit } from '../core/hash.js';
import { keyInts } from './cores.js';
import { insetUniform } from '../util/offset.js';
import { polygonArea } from '../util/geom.js';
import { clipSlab, longAxis } from './plots.js';
import { STYLES, FAMILIES } from './architecture.js';
import { USES } from './uses.js';
import { PODIUM_STOREYS, TOWER_PLATE } from './programme.js';

const GROUND_EXTRA = 1.2; // metres a shop floor is taller than an upper floor

// Storeys and style of buildings of their own, by use.
const LANDMARKS = {
  church: { storeys: 4, styles: ['gothic', 'gothic', 'renaissance', 'baroque'], spire: [32, 52], setback: 3 },
  cathedral: { storeys: 6, styles: ['gothic', 'gothic', 'baroque'], spire: [70, 95] },
  synagogue: { storeys: 3, styles: ['renaissance', 'artDeco', 'neoclassical'], setback: 3 },
  mosque: { storeys: 3, styles: ['modern', 'renaissance'], dome: true, minaret: [28, 40], setback: 3 },
  temple: { storeys: 3, styles: ['modern'], dome: true, setback: 3 },
  library: { storeys: 3, styles: ['beauxArts', 'neoclassical', 'modern'], setback: 2 },
  districtLibrary: { storeys: 4, styles: ['beauxArts', 'neoclassical'], setback: 3 },
  museum: { storeys: 4, styles: ['beauxArts', 'neoclassical'], setback: 4 },
  courthouse: { storeys: 5, styles: ['beauxArts', 'neoclassical'], setback: 4 },
  performingArts: { storeys: 4, styles: ['beauxArts', 'artDeco', 'modern'], setback: 3 },
  police: { storeys: 4, styles: ['neoclassical', 'modern'] },
  fireStation: { storeys: 2, styles: ['victorian', 'artDeco', 'modern'] },
  communityCentre: { storeys: 2, styles: ['modern'] },
  recCentre: { storeys: 2, styles: ['modern'], floor: 5, inset: 5 },
  hospital: { storeys: 7, styles: ['modern'], inset: 6, share: 0.68 },
  hospice: { storeys: 3, styles: ['modern'] },
  elementarySchool: { storeys: 2, styles: ['modern'], inset: 6, strip: [22, 90] },
  secondarySchool: { storeys: 3, styles: ['modern'], inset: 6, strip: [30, 130] },
  altPrimary: { storeys: 2, styles: ['modern'] },
  altSecondary: { storeys: 3, styles: ['modern'] },
  college: { storeys: 5, styles: ['modern', 'neoclassical'] },
  hotel: { storeys: 9, styles: ['beauxArts', 'artDeco'] },
  inn: { storeys: 4, styles: null },
  officeTower: { storeys: 18, styles: ['artDeco', 'modern'], setback: 4 },
  departmentStore: { storeys: 6, styles: ['beauxArts', 'artDeco'] },
  emergencyHousing: { storeys: 5, styles: null },
  transitionalHousing: { storeys: 5, styles: null },
  climbing: { storeys: 2, styles: ['modern'], floor: 6 },
  gymnastics: { storeys: 2, styles: ['modern'], floor: 5 },
  skatingRink: { storeys: 2, styles: ['modern'], floor: 6 },
};

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
function centroid(P) {
  let x = 0;
  let y = 0;
  for (const p of P) {
    x += p[0];
    y += p[1];
  }
  return [x / P.length, y / P.length];
}

// The part of P between s0 and s1 metres in from the line a-b (its front).
// How far a plot reaches back from its front line.
function lotDepth(P, a, b) {
  const t = sub(b, a);
  const l = len(t) || 1;
  let n = [-t[1] / l, t[0] / l];
  if (dot(sub(centroid(P), a), n) < 0) n = [-n[0], -n[1]];
  return Math.max(...P.map((q) => dot(sub(q, a), n)));
}
const LANEWAY_YARD = 19; // metres of backyard behind a house before a laneway house is built at its end
const LANEWAY_DEPTH = 7.5; // metres: a laneway house's depth

function band(P, a, b, s0, s1) {
  const t = sub(b, a);
  const l = len(t) || 1;
  let n = [-t[1] / l, t[0] / l];
  if (dot(sub(centroid(P), a), n) < 0) n = [-n[0], -n[1]];
  const out = clipSlab(P, a, n, s0, s1);
  return out && out.length >= 3 && polygonArea(out) > 12 ? out : null;
}

// A polygon's long axis, its centre, and its extent along and across it.
export function axesOf(P) {
  const u = longAxis(P);
  const v = [-u[1], u[0]];
  const c = centroid(P);
  let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const p of P) {
    const q = sub(p, c);
    u0 = Math.min(u0, dot(q, u));
    u1 = Math.max(u1, dot(q, u));
    v0 = Math.min(v0, dot(q, v));
    v1 = Math.max(v1, dot(q, v));
  }
  return { u, v, c: [c[0] + u[0] * (u0 + u1) / 2 + v[0] * (v0 + v1) / 2, c[1] + u[1] * (u0 + u1) / 2 + v[1] * (v0 + v1) / 2], L: u1 - u0, W: v1 - v0 };
}

// A rectangle centred on c, length l along u, width w.
export function rect(c, u, l, w) {
  const v = [-u[1], u[0]];
  const p = (a, b) => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b];
  return [p(-l / 2, -w / 2), p(l / 2, -w / 2), p(l / 2, w / 2), p(-l / 2, w / 2)];
}

// A cross-shaped plan: nave along u, transept across it two thirds of the
// way along, the chancel at the far end.
function cross(c, u, l, w, tl) {
  const v = [-u[1], u[0]];
  const p = (a, b) => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b];
  const t0 = l * 0.12;
  const t1 = t0 + w;
  return [
    p(-l / 2, -w / 2), p(t0, -w / 2), p(t0, -tl / 2), p(t1, -tl / 2), p(t1, -w / 2), p(l / 2, -w / 2),
    p(l / 2, w / 2), p(t1, w / 2), p(t1, tl / 2), p(t0, tl / 2), p(t0, w / 2), p(-l / 2, w / 2),
  ];
}

// A stadium's outline: an oval, a rectangle with rounded corners, or a
// horseshoe (a rounded rectangle open at one end).
function stadiumShape(c, u, L, W, form) {
  const v = [-u[1], u[0]];
  const at = (x, y) => [c[0] + u[0] * x + v[0] * y, c[1] + u[1] * x + v[1] * y];
  const out = [];
  if (form === 'oval') {
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      out.push(at((Math.cos(a) * L) / 2, (Math.sin(a) * W) / 2));
    }
    return out;
  }
  const r = Math.min(L, W) * (form === 'horseshoe' ? 0.5 : 0.22);
  const corners = [[L / 2 - r, W / 2 - r, 0], [-L / 2 + r, W / 2 - r, 1], [-L / 2 + r, -W / 2 + r, 2], [L / 2 - r, -W / 2 + r, 3]];
  for (const [x, y, q] of corners) {
    if (form === 'horseshoe' && (q === 0 || q === 3)) {
      // The open end: square corners.
      out.push(at(q === 0 ? L / 2 : L / 2, q === 0 ? W / 2 : -W / 2));
      continue;
    }
    for (let k = 0; k <= 8; k++) {
      const a = (q * Math.PI) / 2 + (k / 8) * (Math.PI / 2);
      out.push(at(x + Math.cos(a) * r, y + Math.sin(a) * r));
    }
  }
  return out;
}

// The ridge of a pitched or hipped roof: along the footprint's long axis.
function ridgeOf(P, roof) {
  if (roof !== 'pitched' && roof !== 'hipped' && roof !== 'mansard') return null;
  const ax = axesOf(P);
  if (ax.W < 4) return null;
  const half = roof === 'pitched' ? ax.L / 2 : Math.max(0, (ax.L - ax.W) / 2);
  if (half < 1) return null;
  return [[ax.c[0] - ax.u[0] * half, ax.c[1] - ax.u[1] * half], [ax.c[0] + ax.u[0] * half, ax.c[1] + ax.u[1] * half]];
}

const OLD_STYLES = ['georgian', 'neoclassical', 'renaissance', 'baroque', 'gothic', 'victorian']; // the old town's
const HOOD_LEAD = 0.8; // share of a neighbourhood's blocks built in its own style
const HOOD_MODERN = 0.05; // and modern infill

export function assignBuildings(seed, d, blocks) {
  const ints = keyInts(d.coreInfo);
  const u = (...k) => toUnit(hash(seed, 'building', ...ints, ...k));
  const pick = (list, ...k) => list[Math.floor(u(...k) * list.length) % list.length];
  // The district's family of styles, and each neighbourhood's own leaning.
  const family = FAMILIES[Math.floor(u(1) * FAMILIES.length) % FAMILIES.length];
  const next = FAMILIES[(FAMILIES.indexOf(family) + 1) % FAMILIES.length];
  const hoodStyles = new Map();
  // A neighbourhood was mostly built at one time, by builders working in
  // one style: that style takes most of its blocks, another from the
  // district's family a few, and there is a little modern infill. (Its
  // churches, schools and civic buildings keep their own styles.)
  const ROW_STYLES = ['georgian', 'victorian', 'neoclassical', 'artDeco'];
  const rowStyleOf = new Map();
  for (const h of d.stage3.hoods) {
    const lead = family[Math.floor(u(2, h.id) * 3) % 3];
    const others = family.filter((s) => s !== lead).concat([next[Math.floor(u(3, h.id) * 3) % 3]]);
    const second = others[Math.floor(u(4, h.id) * others.length) % others.length];
    hoodStyles.set(h.id, [[lead, HOOD_LEAD], [second, 1 - HOOD_LEAD - HOOD_MODERN], ['modern', HOOD_MODERN]]);
    rowStyleOf.set(h.id, ROW_STYLES.includes(lead) ? lead : ROW_STYLES.includes(second) ? second : u(5, h.id) < 0.6 ? 'victorian' : 'georgian');
  }
  // The core's buildings: one style for its podiums, towers modern.
  const coreStyle = pick(['modern', 'artDeco', 'beauxArts', 'modern'], 24);
  const weighted = (w, r) => {
    let t = r * w.reduce((a, [, x]) => a + x, 0);
    for (const [s, x] of w) if ((t -= x) <= 0) return s;
    return w[0][0];
  };
  // Colours: a block's buildings take neighbouring shades of one palette,
  // so a street reads as of a piece without every front alike.
  let blockShade = 0;
  const make = (pts, storeys, style, k, extra = {}) => {
    const st = STYLES[style];
    const tone = (list, salt) => list[(blockShade + (u(salt, ...k) < 0.35 ? 1 : 0)) % list.length];
    const floor = extra.floor || st.floor;
    const h = storeys * floor + (extra.shop ? GROUND_EXTRA : 0);
    const out = { pts, storeys, h, style, wall: tone(st.walls, 4), roofColour: tone(st.roofs, 5), roof: st.roof, ridge: ridgeOf(pts, st.roof), ...extra };
    if (extra.ridge === undefined) out.ridge = ridgeOf(pts, st.roof);
    return out;
  };

  // What a building (a group of plots) shares: whether it has a shop floor.
  const shopIn = new Set();
  const groupSize = new Map();
  for (const b of blocks) {
    for (const p of b.plots || []) {
      if (!p.group) continue;
      if (p.ground) shopIn.add(p.group);
      groupSize.set(p.group, (groupSize.get(p.group) || 0) + 1);
    }
  }
  // A ridge along the street, halfway back across a building's depth.
  const ridgeAlong = (pts, a, b, roof) => {
    if (roof === 'flat' || !a) return undefined;
    const t = sub(b, a);
    const l = len(t) || 1;
    const u0 = [t[0] / l, t[1] / l];
    let n = [-u0[1], u0[0]];
    const c = centroid(pts);
    if (dot(sub(c, a), n) < 0) n = [-n[0], -n[1]];
    let [s0, s1, d0, d1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const q of pts) {
      const v = sub(q, a);
      s0 = Math.min(s0, dot(v, u0));
      s1 = Math.max(s1, dot(v, u0));
      d0 = Math.min(d0, dot(v, n));
      d1 = Math.max(d1, dot(v, n));
    }
    const dm = (d0 + d1) / 2;
    const inset = roof === 'pitched' ? 0 : Math.min((d1 - d0) / 2, (s1 - s0) / 2);
    if (s1 - s0 - 2 * inset < 1) return null;
    const at = (s) => [a[0] + u0[0] * s + n[0] * dm, a[1] + u0[1] * s + n[1] * dm];
    return [at(s0 + inset), at(s1 - inset)];
  };

  let bi = 0;
  for (const b of blocks) {
    bi++;
    if (!b.plots) continue;
    const hs = hoodStyles.get(b.hood) || [['modern', 1]];
    // (The old town's blocks: the district's oldest styles.)
    const blockStyle = b.oldTown ? pick(OLD_STYLES, 26, bi) : weighted(hs, u(6, bi));
    blockShade = Math.floor(u(25, bi) * 4);
    b.plots.forEach((p, pi) => {
      const k = [bi, pi];
      p.bldg = null;
      if (['passage', 'merged'].includes(p.cls) || !p.pts || p.pts.length < 3) return;
      const own = p.dedicated && USES[p.dedicated];
      if (own && (own.floor === 'open' || own.cat === 'park')) return;
      if (b.use === 'campus') {
        // A college quadrangle: a ring of buildings round a green.
        const outer = insetUniform(p.pts, 8);
        const court = outer && insetUniform(outer, 16);
        if (outer && court && polygonArea(court) > 300) p.bldg = make(outer, 4, pick(['gothic', 'neoclassical', 'modern'], 23, bi), [bi, pi], { hole: court, landmark: 'college' });
        return;
      }
      if (p.cls === 'open' && !(own && own.floor === 'dedicated')) return;
      // A building's plots share its style and colours.
      const gk = p.group ? [hashString(p.group)] : k;
      // (Now and then one building in a block differs from the rest.)
      let style = u(7, ...gk) < 0.08 ? (b.oldTown ? pick(OLD_STYLES, 27, ...gk) : weighted(hs, u(8, ...gk))) : blockStyle;

      // ---- Buildings of their own ----
      if (p.cls === 'dedicated' || (own && own.floor === 'dedicated')) {
        const L = LANDMARKS[p.dedicated] || { storeys: 3, styles: null };
        style = L.styles ? pick(L.styles, 9, ...k) : style;
        const whole = p.pts === b.pts;
        let pts = p.pts;
        const extra = { landmark: p.dedicated };
        if (p.dedicated === 'stadium') {
          // Stands round a pitch: an oval, a rounded rectangle or a horseshoe,
          // its stands as deep and as tall as the stadium is big.
          const ax = axesOf(insetUniform(p.pts, 8) || p.pts);
          const form = pick(['oval', 'rounded', 'horseshoe'], 24, bi);
          const L = Math.min(ax.L, 230);
          const W = Math.min(ax.W, 170);
          const depth = 20 + u(25, bi) * 16;
          if (L > 100 && W > 72) {
            const outer = stadiumShape(ax.c, ax.u, L, W, form);
            const inner = stadiumShape(ax.c, ax.u, L - 2 * depth, W - 2 * depth, form === 'horseshoe' ? 'rounded' : form);
            p.bldg = make(outer, 1, 'modern', k, { hole: inner, landmark: 'stadium', floor: 22 + u(26, bi) * 16 });
            p.bldg.ridge = null;
            p.bldg.pitch = rect(ax.c, ax.u, Math.min(105, L - 2 * depth - 8), Math.min(68, W - 2 * depth - 8));
            return;
          }
        }
        if (p.dedicated === 'cathedral') {
          // A cross plan in its close, the west front facing the square.
          const ax = axesOf(insetUniform(p.pts, 10) || p.pts);
          const l = Math.min(ax.L * 0.88, 125);
          const w = Math.min(ax.W * 0.32, 30);
          const tl = Math.min(ax.W * 0.8, l * 0.5);
          if (l > 40 && w > 12) {
            pts = cross(ax.c, ax.u, l, w, tl);
            extra.spire = { p: [ax.c[0] - ax.u[0] * (l / 2 - w * 0.5), ax.c[1] - ax.u[1] * (l / 2 - w * 0.5)], h: LANDMARKS.cathedral.spire[0] + u(10, ...k) * 25 };
            extra.ground = 'close';
          }
        } else if (L.share && whole) {
          // A school or hospital building on part of its block; the rest is
          // its yard, playing field or garden.
          const inner = insetUniform(p.pts, L.inset || 5) || p.pts;
          const ax = axesOf(inner);
          const lo = -ax.L / 2;
          pts = clipSlab(inner, ax.c, ax.u, lo, lo + ax.L * L.share) || inner;
          extra.ground = p.dedicated === 'hospital' ? 'garden' : 'yard';
        } else if (L.strip && whole) {
          // A school: a compact building along one long side of its grounds
          // (depth by length), the rest its yard and playing field.
          const inner = insetUniform(p.pts, L.inset || 5) || p.pts;
          const ax = axesOf(inner);
          const [depth, long] = L.strip;
          const along = clipSlab(inner, ax.c, ax.v, -ax.W / 2, -ax.W / 2 + Math.min(depth, ax.W * 0.4)) || inner;
          const l = Math.min(long, ax.L * 0.8);
          pts = clipSlab(along, ax.c, ax.u, -l / 2, l / 2) || along;
          extra.ground = 'yard';
        } else if (L.inset && whole) {
          pts = insetUniform(p.pts, L.inset) || p.pts;
        } else if (L.setback) {
          pts = (p.frontA && band(p.pts, p.frontA, p.frontB, L.setback, 1e3)) || insetUniform(p.pts, L.setback * 0.6) || p.pts;
        }
        if (L.spire && !extra.spire) {
          const c = p.frontA ? [(p.frontA[0] + p.frontB[0]) / 2, (p.frontA[1] + p.frontB[1]) / 2] : centroid(pts);
          const m = centroid(pts);
          extra.spire = { p: [c[0] + (m[0] - c[0]) * 0.35, c[1] + (m[1] - c[1]) * 0.35], h: L.spire[0] + u(11, ...k) * (L.spire[1] - L.spire[0]) };
        }
        if (L.dome) extra.dome = { p: centroid(pts), r: Math.min(9, Math.sqrt(polygonArea(pts)) * 0.25) };
        if (L.minaret) extra.spire = { p: pts[0], h: L.minaret[0] + u(12, ...k) * (L.minaret[1] - L.minaret[0]), thin: true };
        const storeys = p.dedicated === 'officeTower' || p.dedicated === 'hotel' ? Math.max(L.storeys, p.storeys || 0) : L.storeys;
        p.bldg = make(pts, storeys, style, k, { ...extra, floor: L.floor });
        return;
      }

      const storeys = p.storeys || 3;
      const shop = p.group ? shopIn.has(p.group) : !!p.ground;
      const ridge = (pts) => ridgeAlong(pts, p.frontA, p.frontB, STYLES[style].roof);
      // ---- Rowhouses: front gardens, a house, a back garden ----
      if (p.kind === 'rowhouse' || ['house', 'rowCorner', 'cornerShop'].includes(p.cls)) {
        if (!ROW_STYLES.includes(style)) style = rowStyleOf.get(b.hood) || 'victorian';
        // One builder, one terrace: the same garden and depth all along.
        // Toronto proportions: a front garden of 3 to 5 m, a house 14 to 17 m
        // deep (much longer than it is wide), a short backyard to the lane.
        const garden = p.cls === 'cornerShop' ? 0 : 3 + u(14, ...gk) * 2;
        const depth = 14 + u(15, ...gk) * 3;
        const pts = (p.frontA && band(p.pts, p.frontA, p.frontB, garden, garden + depth)) || p.pts;
        p.bldg = make(pts, storeys, style, gk, { shop, ridge: ridge(pts) });
        // A deep lot (in a block wider than two houses and their yards) has
        // a laneway house at the back, facing the lane, as Toronto's do.
        if (p.frontA && p.cls !== 'cornerShop') {
          const lot = lotDepth(p.pts, p.frontA, p.frontB);
          if (lot - garden - depth > LANEWAY_YARD) {
            const back = band(p.pts, p.frontA, p.frontB, lot - LANEWAY_DEPTH - 1.2, lot - 1.2);
            if (back) p.bldg.annex = make(back, 2, style, [...gk, 7], { ridge: ridge(back) });
          }
        }
        return;
      }
      // ---- The core: a street wall of podiums, towers rising from the
      // corners, now and then behind a forecourt ----
      if (p.cls === 'podium' || p.kind === 'podium') {
        style = coreStyle;
        let pts = p.pts;
        if (p.frontA && !p.corner) pts = band(p.pts, p.frontA, p.frontB, 0, p.depth || 1e3) || p.pts;
        // (The podium stands as high as the rest of its building.)
        const podium = p.baseStoreys || PODIUM_STOREYS;
        if (p.towerSite && storeys > podium + 1) {
          const bl = make(pts, podium, style, gk, { shop });
          // The tower: a square-ish floor plate set back from the street on
          // the podium, so the street keeps its human scale.
          const forecourt = u(17, ...k) < 0.3 ? 4 + u(18, ...k) * 4 : 0;
          const ax = axesOf(insetUniform(pts, 4 + forecourt) || pts);
          const side = Math.sqrt(TOWER_PLATE);
          const l = Math.min(ax.L, side * 1.25);
          const w = Math.min(ax.W, TOWER_PLATE / l);
          if (w > 12 && l > 12) bl.tower = make(rect(ax.c, ax.u, l, w), storeys, 'tower', [...k, 1]);
          else Object.assign(bl, make(pts, podium, style, gk, { shop }));
          p.bldg = bl;
          return;
        }
        p.bldg = make(pts, Math.min(storeys, 10), style, gk, { shop });
        return;
      }
      // ---- Flats round a courtyard, and flats over shops ----
      let pts = p.pts;
      if (p.frontA && !p.corner) {
        const main = p.cls === 'main' || p.cls === 'unitShop';
        const back = p.depth ? p.depth - (u(19, ...k) < 0.35 ? 1.5 + u(20, ...k) * 3 : 0) : 1e3;
        // (A building of several plots keeps one front; one that stands on
        // its own plot may step back a little.)
        const alone = !p.group || groupSize.get(p.group) === 1;
        const setback = main || !alone ? 0 : u(21, ...k) < 0.2 ? 1 + u(22, ...k) * 1.5 : 0;
        pts = band(p.pts, p.frontA, p.frontB, setback, back) || p.pts;
      }
      p.bldg = make(pts, storeys, style, gk, { shop, ridge: p.corner ? undefined : ridge(pts) });
    });
  }
}
