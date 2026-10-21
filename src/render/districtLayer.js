// Draws districts: cores, boulevards, greenways, streams, district parks, lakes.
// Shared by the main thread (close zoom, drawn straight to screen) and the
// tile workers (far zoom, drawn into cached tiles).
//
// Paths are built in coordinates relative to each district's cell origin, so
// canvas float precision holds anywhere in the world. Colours are opaque, so a
// shared feature drawn by both neighbours looks the same as drawn once.

import { BOULEVARD_WIDTH, GREENWAY_MAX } from '../world/districts.js';
import { palette } from './styles.js';

export const LOD_STEPS = [
  [0.4, 25],
  [0.12, 50],
  [0.04, 100],
  [0.015, 200],
  [0.006, 400],
  [0, 1200],
];

export function lodSegLen(zoom) {
  for (const [z, seg] of LOD_STEPS) if (zoom >= z) return seg;
  return 1200;
}

const pathCache = new WeakMap();

function addPoly(path, pts, ox, oy, close) {
  path.moveTo(pts[0][0] - ox, pts[0][1] - oy);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0] - ox, pts[i][1] - oy);
  if (close) path.closePath();
}

function pathsFor(world, d, segLen) {
  const g = world.lod(d, segLen);
  let p = pathCache.get(g);
  if (p) return p;
  const [ox, oy] = d.origin;
  p = {
    core: new Path2D(),
    greenFill: [],
    greenLines: new Path2D(),
    streams: new Path2D(),
    parks: new Path2D(),
    lakes: new Path2D(),
    ring: new Path2D(),
  };
  addPoly(p.core, d.core, ox, oy, true);
  // One path per strip: strips can wind either way, and separate fills
  // avoid overlaps cancelling out.
  for (const s of g.strips) {
    const path = new Path2D();
    addPoly(path, s, ox, oy, true);
    p.greenFill.push(path);
  }
  for (const j of g.junctions) {
    const path = new Path2D();
    path.arc(j.x - ox, j.y - oy, j.r, 0, Math.PI * 2);
    p.greenFill.push(path);
  }
  for (const line of g.edgeLines) addPoly(p.greenLines, line, ox, oy, false);
  for (const s of g.streams) addPoly(p.streams, s, ox, oy, false);
  for (const pk of d.parks) {
    addPoly(p.parks, pk.shape, ox, oy, true);
    if (pk.lake) addPoly(p.lakes, pk.lake.shape, ox, oy, true);
  }
  addPoly(p.ring, g.ring, ox, oy, true);
  pathCache.set(g, p);
  return p;
}

const boulevardPaths = new WeakMap();

function boulevardPath(b) {
  let p = boulevardPaths.get(b.points);
  if (!p) {
    b.origin = [Math.round(b.points[0][0] / 1000) * 1000, Math.round(b.points[0][1] / 1000) * 1000];
    p = new Path2D();
    addPoly(p, b.points, b.origin[0], b.origin[1], false);
    boulevardPaths.set(b.points, p);
  } else if (!b.origin) {
    b.origin = [Math.round(b.points[0][0] / 1000) * 1000, Math.round(b.points[0][1] / 1000) * 1000];
  }
  return p;
}

// view: x0, y0 = world top-left of the canvas; s = canvas pixels per metre;
// w, h = canvas size in pixels; zoom = CSS pixels per metre (for detail
// choices); pr = canvas pixels per CSS pixel.
export function drawDistricts(ctx, view, world, layers) {
  const { x0, y0, s, zoom, pr } = view;
  const segLen = lodSegLen(zoom);
  const list = world.districtsInRect(x0, y0, x0 + view.w / s, y0 + view.h / s);
  const items = list.map((d) => ({ d, p: pathsFor(world, d, segLen) }));
  const px = (cssPx) => (cssPx * pr) / s; // CSS pixels to metres
  const place = (d) => ctx.setTransform(s, 0, 0, s, (d.origin[0] - x0) * s, (d.origin[1] - y0) * s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (layers.cores) {
    ctx.fillStyle = palette.core;
    for (const { d, p } of items) {
      place(d);
      ctx.fill(p.core);
    }
  }

  if (layers.streets) {
    const lines = world.boulevardsInRect(x0, y0, x0 + view.w / s, y0 + view.h / s).map((b) => ({ b, path: boulevardPath(b) }));
    const w = Math.max(BOULEVARD_WIDTH, px(zoom < 0.03 ? 1.1 : 1.6));
    const passes = zoom >= 0.05 ? [[palette.roadCasing, w + px(1.5)], [palette.road, w]] : [[palette.road, w]];
    for (const [colour, width] of passes) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      for (const { b, path } of lines) {
        ctx.setTransform(s, 0, 0, s, (b.origin[0] - x0) * s, (b.origin[1] - y0) * s);
        ctx.stroke(path);
      }
    }
  }

  if (layers.green) {
    ctx.fillStyle = palette.natural;
    ctx.strokeStyle = palette.natural;
    if (zoom >= 0.012) {
      for (const { d, p } of items) {
        place(d);
        for (const path of p.greenFill) ctx.fill(path);
      }
    } else {
      ctx.lineWidth = Math.max(GREENWAY_MAX * 0.65, px(1.3));
      for (const { d, p } of items) {
        place(d);
        ctx.stroke(p.greenLines);
      }
    }
  }

  if (layers.water && zoom >= 0.03) {
    ctx.strokeStyle = palette.water;
    ctx.lineWidth = Math.max(6, px(1));
    for (const { d, p } of items) {
      place(d);
      ctx.stroke(p.streams);
    }
  }

  if (layers.green) {
    ctx.fillStyle = palette.natural;
    for (const { d, p } of items) {
      place(d);
      ctx.fill(p.parks);
    }
  }

  if (layers.water) {
    ctx.fillStyle = palette.water;
    for (const { d, p } of items) {
      place(d);
      ctx.fill(p.lakes);
    }
    if (zoom >= 0.05) {
      ctx.strokeStyle = palette.waterEdge;
      ctx.lineWidth = px(1);
      for (const { d, p } of items) {
        place(d);
        ctx.stroke(p.lakes);
      }
    }
  }

  return items;
}

// Thin district outlines along the greenway centrelines (debug).
export function drawDistrictOutlines(ctx, view, items) {
  const { x0, y0, s, pr } = view;
  ctx.strokeStyle = palette.districtOutline;
  ctx.lineWidth = (1 * pr) / s;
  ctx.setLineDash([(4 * pr) / s, (4 * pr) / s]);
  for (const { d, p } of items) {
    ctx.setTransform(s, 0, 0, s, (d.origin[0] - x0) * s, (d.origin[1] - y0) * s);
    ctx.stroke(p.ring);
  }
  ctx.setLineDash([]);
}

// Render one tile. Tiles show between 256 and 512 CSS pixels wide.
export function renderDistrictTile(ctx, world, tile, layers, res) {
  const zoom = 362 / tile.size;
  const s = res / tile.size;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = palette.land;
  ctx.fillRect(0, 0, res, res);
  const view = { x0: tile.x0, y0: tile.y0, s, w: res, h: res, zoom, pr: s / zoom };
  const items = drawDistricts(ctx, view, world, layers);
  if (layers.outlines) drawDistrictOutlines(ctx, view, items);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
