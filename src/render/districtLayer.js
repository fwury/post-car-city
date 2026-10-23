// Draws districts: cores, neighbourhoods, boulevards and main streets, greenways and district parks.
// Shared by the main thread (close zoom, drawn straight to screen) and the
// tile workers (far zoom, drawn into cached tiles).
//
// Paths are built in coordinates relative to each district's cell origin, so
// canvas float precision holds anywhere in the world. Colours are opaque, so a
// shared feature drawn by both neighbours looks the same as drawn once.

import { BOULEVARD_WIDTH, GREENWAY_MAX } from '../world/districts.js';
import { ROUNDABOUT_RADIUS } from '../world/boulevards.js';
import { STREET_TYPES } from '../world/streetTypes.js';

const MAIN_STREET_WIDTH = STREET_TYPES.mainStreet.width;
const TRAM_WIDTH = 7;
export const MAIN_STREET_MIN_ZOOM = 0.02;
const TRAM_MIN_ZOOM = 0.2;
const TUNNEL_MIN_ZOOM = 0.05;
const GREENWAY_DETAIL_ZOOM = 0.15; // streams from here; trails, paths and woods closer in
const STOP_MIN_ZOOM = 0.25; // tram stops as markers from here (to scale from DETAIL_MIN_ZOOM)
import { palette } from './styles.js';
import { TRAIL_WIDTH } from '../world/greenway.js';
import { layoutPaths, drawLayouts } from './parkLayer.js';
import { drawBlocks, hoodLinePath, BLOCK_MIN_ZOOM } from './blockLayer.js';
import { DETAIL_MIN_ZOOM, drawSection, streetExtras, drawRails, drawTrees, drawJunctions, drawStops } from './streetDetail.js';

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
    parks: new Path2D(),
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
  for (const pk of d.parks) {
    addPoly(p.parks, pk.shape, ox, oy, true);
  }
  addPoly(p.ring, g.ring, ox, oy, true);
  pathCache.set(g, p);
  return p;
}

// Neighbourhood paths, cached per district's stage 3 result.
const hoodCache = new WeakMap();

function hoodPathsFor(d, nb) {
  let p = hoodCache.get(nb);
  if (p) return p;
  const [ox, oy] = d.origin;
  // Colour neighbourhoods so neighbours differ.
  const adj = nb.hoods.map(() => new Set());
  for (const c of nb.chains) if (c.a >= 0 && c.b >= 0) {
    adj[c.a].add(c.b);
    adj[c.b].add(c.a);
  }
  const colour = [];
  for (const h of nb.hoods) {
    let k = 0;
    while (k < 3 && [...adj[h.id]].some((o) => colour[o] === k)) k++;
    colour[h.id] = k;
  }
  p = { tints: palette.hoodTints.map(() => new Path2D()), lines: new Path2D(), centres: nb.hoods.map((h) => h.centre), streets: new Path2D() };
  for (const h of nb.hoods) {
    if (h.core || h.polygon.length < 3) continue;
    addPoly(p.tints[colour[h.id]], h.polygon, ox, oy, true);
    for (const r of h.holes) if (r.length > 2) addPoly(p.tints[colour[h.id]], r, ox, oy, true);
  }
  for (const c of nb.chains) if (c.a >= 0 && c.b >= 0) addPoly(p.lines, c.points, ox, oy, false);
  for (const l of nb.lines) addPoly(p.streets, l.points, ox, oy, false);
  hoodCache.set(nb, p);
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

  const wantHoods = layers.neighbourhoods || (layers.streets && zoom >= MAIN_STREET_MIN_ZOOM);
  const hoods = wantHoods ? items.map(({ d }) => ({ d, h: hoodPathsFor(d, world.neighbourhoods(d)) })) : [];

  if (layers.neighbourhoods) {
    palette.hoodTints.forEach((tint, k) => {
      ctx.fillStyle = tint;
      for (const { d, h } of hoods) {
        place(d);
        ctx.fill(h.tints[k], 'evenodd');
      }
    });
  }

  if (layers.cores) {
    ctx.fillStyle = palette.core;
    for (const { d, p } of items) {
      place(d);
      ctx.fill(p.core);
    }
  }

  const drawBuildings = layers.blocks ? drawBlocks(ctx, view, world, items, place, layers) : null;

  const net = layers.streets ? world.boulevardsInRect(x0, y0, x0 + view.w / s, y0 + view.h / s) : null;
  const lines = net ? net.lines.map((b) => ({ b, path: boulevardPath(b) })) : [];
  const w = Math.max(BOULEVARD_WIDTH, px(zoom < 0.03 ? 1.1 : 1.6));
  const mw = Math.max(MAIN_STREET_WIDTH, px(zoom < 0.03 ? 0.7 : 1.1));
  if (layers.streets && zoom >= DETAIL_MIN_ZOOM) {
    drawDetailedStreets(ctx, view, world, hoods, lines, place, px);
  } else if (layers.streets) {
    const casing = zoom >= 0.05;
    const passes = casing ? [[palette.roadCasing, px(1.5)], [palette.road, 0]] : [[palette.road, 0]];
    for (const [colour, extra] of passes) {
      ctx.strokeStyle = colour;
      if (layers.streets && zoom >= MAIN_STREET_MIN_ZOOM) {
        ctx.lineWidth = mw + extra;
        for (const { d, h } of hoods) {
          place(d);
          ctx.stroke(h.streets);
        }
      }
      ctx.lineWidth = w + extra;
      for (const { b, path } of lines) {
        ctx.setTransform(s, 0, 0, s, (b.origin[0] - x0) * s, (b.origin[1] - y0) * s);
        ctx.stroke(path);
      }
    }
    // Tram tracks down the middle of boulevards and main streets.
    if (zoom >= TRAM_MIN_ZOOM) {
      ctx.strokeStyle = palette.tram;
      ctx.lineWidth = TRAM_WIDTH;
      for (const { d, h } of hoods) {
        place(d);
        ctx.stroke(h.streets);
      }
      for (const { b, path } of lines) {
        ctx.setTransform(s, 0, 0, s, (b.origin[0] - x0) * s, (b.origin[1] - y0) * s);
        ctx.stroke(path);
      }
    }
    // Tram stops, as small markers, once a district's blocks are in.
    if (zoom >= STOP_MIN_ZOOM && view.blocks) {
      const r = px(3.2);
      for (const { d } of hoods) {
        const b = view.blocks(d);
        if (!b || !b.tramStops) continue;
        place(d);
        ctx.beginPath();
        for (const st of b.tramStops) {
          const [x, y] = [st.p[0] - d.origin[0], st.p[1] - d.origin[1]];
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = palette.tram;
        ctx.lineWidth = px(1.6);
        ctx.stroke();
      }
    }
    // Roundabout islands.
    const island = net.roundabouts.length ? ROUNDABOUT_RADIUS - w / 2 - (zoom >= 0.05 ? px(0.75) : 0) : 0;
    if (island > px(1)) {
      ctx.fillStyle = palette.green;
      ctx.setTransform(s, 0, 0, s, 0, 0);
      for (const r of net.roundabouts) {
        ctx.beginPath();
        ctx.arc(r.x - x0, r.y - y0, island, 0, Math.PI * 2);
        ctx.fill();
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

  if (layers.green) {
    ctx.fillStyle = palette.natural;
    for (const { d, p } of items) {
      place(d);
      ctx.fill(p.parks);
    }
    // What is in the district parks, once a district's blocks are in.
    const lays = [];
    for (const { d } of items) {
      const b = view.blocks ? view.blocks(d) : null;
      for (const dp of (b && b.districtParks) || []) lays.push({ d, p: layoutPaths(dp.layout, d.origin[0], d.origin[1]) });
    }
    drawLayouts(ctx, lays, place, zoom, px);
  }

  // Boulevards and main streets carry on under the greenways: drawn again
  // inside each greenway strip as tunnels, pale with dashed edges, so a
  // street reads as one street from district to district.
  if (layers.streets && layers.green && zoom >= TUNNEL_MIN_ZOOM) {
    const strokeAll = (extra) => {
      ctx.lineWidth = mw + extra;
      for (const { d, h } of hoods) {
        place(d);
        ctx.stroke(h.streets);
      }
      ctx.lineWidth = w + extra;
      for (const { b, path } of lines) {
        ctx.setTransform(s, 0, 0, s, (b.origin[0] - x0) * s, (b.origin[1] - y0) * s);
        ctx.stroke(path);
      }
    };
    for (const { d, p } of items) {
      for (const strip of p.greenFill) {
        ctx.save();
        place(d);
        ctx.clip(strip);
        ctx.strokeStyle = palette.tunnelCasing;
        ctx.setLineDash([px(4), px(3)]);
        ctx.lineCap = 'butt';
        strokeAll(px(1.5));
        ctx.setLineDash([]);
        ctx.strokeStyle = palette.tunnel;
        strokeAll(-px(1));
        ctx.lineCap = 'round';
        ctx.restore();
      }
    }
  }

  // What is in the greenways: woods, the stream, the trail and the paths in.
  if (layers.green && zoom >= GREENWAY_DETAIL_ZOOM) drawGreenwayDetail(ctx, view, world, items, place, px);

  if (drawBuildings) drawBuildings();

  if (layers.neighbourhoods) {
    ctx.strokeStyle = palette.hoodLine;
    ctx.lineWidth = px(1.2);
    ctx.setLineDash([px(5), px(4)]);
    // Close in, where a district's blocks are in, boundaries run down streets.
    const byBlock = layers.blocks && zoom >= BLOCK_MIN_ZOOM;
    for (const { d, h } of hoods) {
      place(d);
      const b = byBlock ? (view.blocks ? view.blocks(d) : world.blocks(d)) : null;
      ctx.stroke(b && b.hoodLines ? hoodLinePath(d, b) : h.lines);
    }
    ctx.setLineDash([]);
    if (zoom >= 0.05) {
      ctx.fillStyle = palette.hoodCentre;
      for (const { d, h } of hoods) {
        place(d);
        ctx.beginPath();
        for (const [x, y] of h.centres) {
          ctx.moveTo(x - d.origin[0] + px(3.5), y - d.origin[1]);
          ctx.arc(x - d.origin[0], y - d.origin[1], px(3.5), 0, Math.PI * 2);
        }
        ctx.fill();
      }
    }
  }

  return items;
}

// Each stretch of greenway is drawn by both districts beside it, the same
// way, so the join is invisible.
const greenwayPaths = new WeakMap();
function greenwayPathsFor(g, origin) {
  let p = greenwayPaths.get(g);
  if (p && p.origin === origin) return p;
  const [ox, oy] = origin;
  const line = (L) => {
    const path = new Path2D();
    path.moveTo(L[0][0] - ox, L[0][1] - oy);
    for (let i = 1; i < L.length; i++) path.lineTo(L[i][0] - ox, L[i][1] - oy);
    return path;
  };
  const trees = new Path2D();
  for (const [x, y] of g.trees) {
    const r = 3.4 + ((Math.floor(x * 3.7) ^ Math.floor(y * 5.3)) & 7) * 0.35;
    trees.moveTo(x - ox + r, y - oy);
    trees.arc(x - ox, y - oy, r, 0, Math.PI * 2);
  }
  p = { origin, stream: line(g.stream), trail: line(g.trail), trees };
  greenwayPaths.set(g, p);
  return p;
}

function drawGreenwayDetail(ctx, view, world, items, place, px) {
  const { zoom } = view;
  const ways = [];
  for (const { d } of items) for (const c of d.chains) ways.push({ d, p: greenwayPathsFor(world.greenway(c.geo), d.origin), g: world.greenway(c.geo) });
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (zoom >= 0.6) {
    ctx.fillStyle = palette.woods;
    for (const { d, p } of ways) {
      place(d);
      ctx.fill(p.trees);
    }
  }
  for (const { d, p, g } of ways) {
    place(d);
    ctx.strokeStyle = palette.streamBank;
    ctx.lineWidth = Math.max(g.streamWidth + 2, px(2.2));
    ctx.stroke(p.stream);
    ctx.strokeStyle = palette.water;
    ctx.lineWidth = Math.max(g.streamWidth, px(1.4));
    ctx.stroke(p.stream);
  }
  if (zoom < 0.3) return;
  // The trail, and the paths in from the streets (over the stream: bridges).
  const links = [];
  for (const { d } of items) {
    const b = view.blocks ? view.blocks(d) : null;
    if (b && b.greenLinks) links.push({ d, list: b.greenLinks });
  }
  for (const [colour, extra] of [[palette.trailEdge, px(1.2)], [palette.trail, 0]]) {
    ctx.strokeStyle = colour;
    for (const { d, p } of ways) {
      place(d);
      ctx.lineWidth = Math.max(TRAIL_WIDTH, px(1.6)) + extra;
      ctx.stroke(p.trail);
    }
    if (zoom >= 0.5) {
      for (const { d, list } of links) {
        place(d);
        ctx.lineWidth = Math.max(3, px(1.2)) + extra;
        ctx.beginPath();
        for (const L of list) {
          ctx.moveTo(L[0][0] - d.origin[0], L[0][1] - d.origin[1]);
          for (let i = 1; i < L.length; i++) ctx.lineTo(L[i][0] - d.origin[0], L[i][1] - d.origin[1]);
        }
        ctx.stroke();
      }
    }
  }
}

// Boulevards and main streets to scale: cross-sections, junctions paved
// over, rails, trees and tram stops.
function drawDetailedStreets(ctx, view, world, hoods, lines, place, px) {
  const { x0, y0, s } = view;
  const blocksOf = (d) => (view.blocks ? view.blocks(d) : null);
  for (const { d, h } of hoods) {
    place(d);
    drawSection(ctx, h.streets, 'mainStreet', px);
  }
  for (const { b, path } of lines) {
    ctx.setTransform(s, 0, 0, s, (b.origin[0] - x0) * s, (b.origin[1] - y0) * s);
    drawSection(ctx, path, 'boulevard', px);
  }
  // Junctions, then rails and trees (kept clear of junctions and stops).
  for (const { d } of hoods) {
    const b = blocksOf(d);
    if (!b || !b.junctions) continue;
    place(d);
    drawJunctions(ctx, b.junctions, d.origin[0], d.origin[1], 8.5);
  }
  for (const { d } of hoods) {
    const b = blocksOf(d);
    const clear = b && b.junctions ? [...b.junctions, ...b.tramStops.map((t) => t.p)] : [];
    const avoid = (q) => clear.some((c) => Math.abs(c[0] - q[0]) < 24 && Math.abs(c[1] - q[1]) < 24);
    place(d);
    const [ox, oy] = d.origin;
    for (const l of world.neighbourhoods(d).lines) {
      const e = streetExtras(l.points, 'mainStreet', avoid);
      drawRails(ctx, e.rails, ox, oy, px);
      drawTrees(ctx, e.trees, ox, oy, px);
    }
    for (const l of d.network.lines) {
      if (l.kind === 'roundabout') continue;
      const e = streetExtras(l.points, 'boulevard', avoid);
      drawRails(ctx, e.rails, ox, oy, px);
      drawTrees(ctx, e.trees, ox, oy, px);
    }
    if (b && b.tramStops) drawStops(ctx, b.tramStops, ox, oy, px);
  }
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
