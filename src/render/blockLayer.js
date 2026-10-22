// Draws stage 4: local streets at their widths, and blocks by use. Until
// plots exist, blocks show their built edge as a band (perimeter blocks
// round a courtyard, rowhouses along the street with gardens behind).

import { insetUniform } from '../util/offset.js';
import { palette } from './styles.js';

export const BLOCK_MIN_ZOOM = 0.25;
const PERIMETER_DEPTH = 14; // metres of building along a perimeter block's streets
const ROWHOUSE_DEPTH = 10;
const CAMPUS_DEPTH = 18;

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
    local: P(), pedestrian: P(),
    built: P(), podium: P(), open: P(), garden: P(), green: P(), square: P(), school: P(), edge: P(),
  };
  for (const s of b.streets) {
    const path = s.kind === 'pedestrian' ? p.pedestrian : p.local;
    for (const [a, c] of s.segs) {
      path.moveTo(a[0] - ox, a[1] - oy);
      path.lineTo(c[0] - ox, c[1] - oy);
    }
  }
  for (const k of b.blocks) {
    if (!k.pts) continue;
    const add = (path, pts) => pts && pts.length > 2 && addPoly(path, pts, ox, oy);
    switch (k.use) {
      case 'perimeter':
      case 'campus': {
        add(p.built, k.pts);
        const inner = insetUniform(k.pts, k.use === 'campus' ? CAMPUS_DEPTH : PERIMETER_DEPTH);
        add(k.use === 'campus' ? p.green : p.open, inner);
        break;
      }
      case 'rowhouse': {
        add(p.built, k.pts);
        add(p.garden, insetUniform(k.pts, ROWHOUSE_DEPTH));
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
        add(p.school, k.pts);
        break;
      default:
        add(p.built, k.pts);
    }
    add(p.edge, k.pts);
  }
  cache.set(b, p);
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
  for (const [key, colour, width] of [
    ['local', palette.localCasing, 13.8 + px(1.2)],
    ['local', palette.localStreet, 13.8],
    ['pedestrian', palette.pedestrianStreet, 18],
  ]) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    for (const { d, p } of list) {
      place(d);
      ctx.stroke(p[key]);
    }
  }
  for (const [key, colour] of [
    ['built', palette.building],
    ['podium', palette.podium],
    ['open', palette.courtyard],
    ['garden', palette.garden],
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
  ctx.strokeStyle = palette.buildingEdge;
  ctx.lineWidth = px(0.6);
  for (const { d, p } of list) {
    place(d);
    ctx.stroke(p.edge);
  }
}
