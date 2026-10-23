// Draws stage 4: local streets at their widths, and blocks by use. Until
// plots exist, blocks show their built edge as a band (perimeter blocks
// round a courtyard, rowhouses along the street with gardens behind).

import { insetUniform } from '../util/offset.js';
import { palette } from './styles.js';
import { USES } from '../world/uses.js';
import { STREET_TYPES } from '../world/streetTypes.js';

export const BLOCK_MIN_ZOOM = 0.25;
export const PLOT_MIN_ZOOM = 0.7;
export const USE_MIN_ZOOM = 1.6; // shop-floor dots from here in
const PERIMETER_DEPTH = 14; // metres of building along a perimeter block's streets
const ROWHOUSE_DEPTH = 10;
const CAMPUS_DEPTH = 18;
// A local street's pavement each side: its clearway and furnishing zones.
const PAVEMENT = STREET_TYPES.localStreet.side.reduce((a, [, w]) => a + w, 0);
const COURT_SPOKE = 2.5; // metres: a path across a courtyard

const cache = new WeakMap();

function addPoly(path, pts, ox, oy) {
  path.moveTo(pts[0][0] - ox, pts[0][1] - oy);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0] - ox, pts[i][1] - oy);
  path.closePath();
}

function pathsFor(d, b) {
  let p = cache.get(b);
  if (p) return p;
  const [ox, oy] = d.origin;
  const P = () => new Path2D();
  p = {
    built: P(), podium: P(), open: P(), garden: P(), green: P(), square: P(), school: P(), edge: P(),
    plotLines: P(), passages: P(), courtPath: P(), courtGreen: P(), spokes: P(), hubs: P(),
    dedicated: new Map(), dots: new Map(),
  };
  const dedicatedPath = (cat) => {
    if (!p.dedicated.has(cat)) p.dedicated.set(cat, P());
    return p.dedicated.get(cat);
  };
  // Streets by kind and width.
  p.streets = new Map();
  for (const s of b.streets) {
    const k = `${s.kind}:${s.width}`;
    if (!p.streets.has(k)) p.streets.set(k, { kind: s.kind, width: s.width, path: new Path2D() });
    const path = p.streets.get(k).path;
    for (const [a, c] of s.segs) {
      path.moveTo(a[0] - ox, a[1] - oy);
      path.lineTo(c[0] - ox, c[1] - oy);
    }
  }
  for (const k of b.blocks) {
    if (!k.pts) continue;
    const add = (path, pts) => pts && pts.length > 2 && addPoly(path, pts, ox, oy);
    if (k.plots) {
      for (const q of k.plots) {
        if (q.kind === 'passage') add(p.passages, q.pts);
        else if (q.pts !== k.pts) add(p.plotLines, q.pts);
        // Buildings of their own, and parkettes.
        const u = q.dedicated && USES[q.dedicated];
        if (u && u.cat !== 'park' && u.floor !== 'open' && q.pts !== k.pts) add(dedicatedPath(u.cat), q.pts);
        if (q.dedicated === 'parkette') add(dedicatedPath('park'), q.pts);
        // A dot for the shop floor.
        const g = q.ground && USES[q.ground];
        if (g && q.c) {
          if (!p.dots.has(g.cat)) p.dots.set(g.cat, []);
          p.dots.get(g.cat).push([q.c[0] - ox, q.c[1] - oy]);
        }
      }
    }
    // (A rowhouse block built as flats has a courtyard like a perimeter block.)
    switch (k.court ? 'perimeter' : k.use) {
      case 'perimeter':
      case 'campus': {
        add(p.built, k.pts);
        const inner = k.inner || insetUniform(k.pts, k.use === 'campus' ? CAMPUS_DEPTH : PERIMETER_DEPTH);
        if (k.court && k.court.green) {
          // A public courtyard: a path round it, a garden in the middle with
          // paths through it.
          add(p.courtPath, inner);
          add(p.courtGreen, k.court.green);
          for (const line of k.court.paths) {
            p.spokes.moveTo(line[0][0] - ox, line[0][1] - oy);
            for (let i = 1; i < line.length; i++) p.spokes.lineTo(line[i][0] - ox, line[i][1] - oy);
          }
          for (const { p: q, r } of k.court.nodes) {
            p.hubs.moveTo(q[0] - ox + r, q[1] - oy);
            p.hubs.arc(q[0] - ox, q[1] - oy, r, 0, Math.PI * 2);
          }
        } else add(k.use === 'campus' ? p.green : p.open, inner);
        break;
      }
      case 'rowhouse': {
        // Houses along the street, gardens behind, a shared strip down the middle.
        add(p.garden, k.pts);
        const back = insetUniform(k.pts, ROWHOUSE_DEPTH);
        if (back) {
          const band = new Path2D();
          addPoly(band, k.pts, ox, oy);
          addPoly(band, back, ox, oy);
          p.built.addPath(band);
        }
        if (k.inner) add(p.open, k.inner);
        break;
      }
      case 'podium':
        add(p.podium, k.pts);
        break;
      case 'square':
        add(p.square, k.pts);
        break;
      case 'park':
      case 'green':
        add(p.green, k.pts);
        break;
      case 'school':
      case 'elementarySchool':
        add(p.school, k.pts);
        break;
      case 'hospital':
      case 'recCentre':
        add(dedicatedPath(USES[k.use].cat), k.pts);
        break;
      default:
        add(p.built, k.pts);
    }
    add(p.edge, k.pts);
  }
  cache.set(b, p);
  return p;
}

// Neighbourhood boundaries down the middle of streets, once a district's
// blocks are in.
const hoodLineCache = new WeakMap();
export function hoodLinePath(d, b) {
  let p = hoodLineCache.get(b);
  if (p) return p;
  const [ox, oy] = d.origin;
  p = new Path2D();
  for (const line of b.hoodLines || []) {
    p.moveTo(line[0][0] - ox, line[0][1] - oy);
    for (let i = 1; i < line.length; i++) p.lineTo(line[i][0] - ox, line[i][1] - oy);
  }
  hoodLineCache.set(b, p);
  return p;
}

// Called inside drawDistricts, after the neighbourhood tints and before the
// main streets, for districts in view.
export function drawBlocks(ctx, view, world, items, place) {
  const { zoom, pr, s } = view;
  if (zoom < BLOCK_MIN_ZOOM) return;
  const px = (cssPx) => (cssPx * pr) / s;
  // Blocks may still be on their way from a worker; those districts wait.
  const list = [];
  for (const { d } of items) {
    const b = view.blocks ? view.blocks(d) : world.blocks(d);
    if (b) list.push({ d, p: pathsFor(d, b) });
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Each street at its width, building line to building line: casing first,
  // then (close in) the pavements, with the roadway down the middle.
  const passes = zoom >= PLOT_MIN_ZOOM ? ['casing', 'pavement', 'fill'] : ['casing', 'fill'];
  for (const pass of passes) {
    for (const { d, p } of list) {
      place(d);
      for (const st of p.streets.values()) {
        if (pass === 'casing' && st.kind === 'pedestrian') continue;
        if (pass === 'casing') {
          ctx.strokeStyle = palette.localCasing;
          ctx.lineWidth = st.width + px(1.2);
        } else if (pass === 'pavement') {
          if (st.kind === 'pedestrian') continue;
          ctx.strokeStyle = palette.pavement;
          ctx.lineWidth = st.width;
        } else if (st.kind === 'pedestrian') {
          ctx.strokeStyle = palette.pedestrianStreet;
          ctx.lineWidth = st.width;
        } else {
          ctx.strokeStyle = palette.localStreet;
          ctx.lineWidth = passes.length === 3 ? Math.max(st.width - 2 * PAVEMENT, st.width * 0.4) : st.width;
        }
        ctx.stroke(st.path);
      }
    }
  }
  for (const [key, colour] of [
    ['garden', palette.garden],
    ['built', palette.building],
    ['podium', palette.podium],
    ['open', palette.courtyard],
    ['courtPath', palette.pedestrianStreet],
    ['courtGreen', palette.courtyard],
    ['hubs', palette.pedestrianStreet],
    ['green', palette.green],
    ['square', palette.plaza],
    ['school', palette.school],
  ]) {
    ctx.fillStyle = colour;
    for (const { d, p } of list) {
      place(d);
      ctx.fill(p[key], 'evenodd');
    }
  }
  for (const { d, p } of list) {
    place(d);
    for (const [cat, path] of p.dedicated) {
      ctx.fillStyle = cat === 'park' ? palette.green : palette.dedicated[cat] || palette.building;
      ctx.fill(path);
    }
  }
  // Gaps between buildings and the paths across courtyards.
  ctx.fillStyle = palette.pedestrianStreet;
  ctx.strokeStyle = palette.pedestrianStreet;
  ctx.lineWidth = COURT_SPOKE;
  for (const { d, p } of list) {
    place(d);
    ctx.fill(p.passages);
    ctx.stroke(p.spokes);
  }
  if (zoom >= PLOT_MIN_ZOOM) {
    ctx.strokeStyle = palette.plotLine;
    ctx.lineWidth = px(0.6);
    for (const { d, p } of list) {
      place(d);
      ctx.stroke(p.plotLines);
    }
  }
  ctx.strokeStyle = palette.buildingEdge;
  ctx.lineWidth = px(0.6);
  for (const { d, p } of list) {
    place(d);
    ctx.stroke(p.edge);
  }
  if (zoom >= USE_MIN_ZOOM) {
    const r = px(2.6);
    for (const { d, p } of list) {
      place(d);
      for (const [cat, pts] of p.dots) {
        ctx.fillStyle = palette.uses[cat] || palette.inkSoft;
        ctx.beginPath();
        for (const [x, y] of pts) {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }
  }
}
