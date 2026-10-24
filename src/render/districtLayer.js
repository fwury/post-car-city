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
const TRAM_WIDTH = 5;
export const MAIN_STREET_MIN_ZOOM = 0.02;
const TRAM_MIN_ZOOM = 0.2;
const TUNNEL_MIN_ZOOM = 0.05;
const GREENWAY_DETAIL_ZOOM = 0.15; // streams from here; trails and paths closer in
const STOP_MIN_ZOOM = 0.25;
const TRANSIT_MIN_ZOOM = 0.008;
const VIADUCT = 11; // metres: a two-track viaduct's width
const VIADUCT_HEIGHT = 8; // tram stops as markers from here (to scale from DETAIL_MIN_ZOOM)
import { palette } from './styles.js';
import { TRAIL_WIDTH, BEACH } from '../world/greenway.js';
import { layoutPaths, drawLayouts } from './parkLayer.js';
import { drawBlocks, hoodLinePath, BLOCK_MIN_ZOOM } from './blockLayer.js';
import { DETAIL_MIN_ZOOM, drawIntersections, drawSections, carriageway, streetExtras, drawRails, drawJunctions, drawStops, offsetLine } from './streetDetail.js';

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
    wet: [], // which of greenFill hold water (a river, the shore)
  };
  addPoly(p.core, d.core, ox, oy, true);
  // One path per strip: strips can wind either way, and separate fills
  // avoid overlaps cancelling out.
  g.strips.forEach((s, i) => {
    const path = new Path2D();
    addPoly(path, s, ox, oy, true);
    p.greenFill.push(path);
    const kind = d.chains[i].geo.kind;
    p.wet.push(kind === 'river' || kind === 'shore');
  });
  for (const j of g.junctions) {
    const path = new Path2D();
    path.arc(j.x - ox, j.y - oy, j.r, 0, Math.PI * 2);
    p.greenFill.push(path);
    const r = world.terrain && world.terrain.nearestRiver(j.x, j.y);
    p.wet.push(!!r && r.d < 30);
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

  // The country round the city, and the city's land.
  const terrain = world.terrain;
  if (terrain) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = palette.country;
    ctx.fillRect(0, 0, view.w, view.h);
    drawHighGround(ctx, view, terrain, px);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = palette.land;
    for (const { d, p } of items) {
      place(d);
      ctx.fill(p.ring);
    }
  }

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

  // Linear parks along neighbourhood boundaries (under the streets and
  // the primary greenways they run into): green, a trail down the middle, paths in from
  // the streets.
  if (layers.green) {
    for (const { d } of items) {
      const b = view.blocks ? view.blocks(d) : null;
      if (!b || !b.linearParks || !b.linearParks.length) continue;
      place(d);
      drawLinearParks(ctx, b.linearParks, d.origin, zoom, px);
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
    // Main streets white and boulevards pale yellow, each in a light
    // casing; farther out, without casings, a little darker to show.
    const casing = zoom >= 0.05;
    const passes = casing
      ? [[palette.roadCasing, palette.boulevardCasing, px(1.5)], [palette.road, palette.boulevard, 0]]
      : [[palette.roadFar, palette.boulevardCasing, 0]];
    for (const [colour, blvd, extra] of passes) {
      ctx.strokeStyle = colour;
      if (layers.streets && zoom >= MAIN_STREET_MIN_ZOOM) {
        ctx.lineWidth = mw + extra;
        for (const { d, h } of hoods) {
          place(d);
          ctx.stroke(h.streets);
        }
      }
      ctx.strokeStyle = blvd;
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

  // Beaches along the ocean shore, under the water's edge.
  if (layers.green && terrain && terrain.ocean && zoom >= 0.04) {
    ctx.strokeStyle = palette.sand;
    ctx.lineWidth = BEACH * 2.3;
    ctx.lineCap = 'round';
    for (const { d } of items) {
      for (const c of d.chains) {
        if (c.geo.kind !== 'shore') continue;
        const p = greenwayPathsFor(world.greenway(c.geo), d.origin);
        if (!p.beaches) continue;
        place(d);
        ctx.stroke(p.beaches);
      }
    }
  }
  // Water: the sea (or lake) and the rivers.
  if (terrain) drawWater(ctx, view, terrain, px);

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
      for (let k = 0; k < p.greenFill.length; k++) {
        if (p.wet[k]) continue;
        const strip = p.greenFill[k];
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

  // Over a river, the streets cross on bridges.
  if (layers.streets && terrain && terrain.rivers.length) {
    const strokeAll = (extra) => {
      if (zoom >= MAIN_STREET_MIN_ZOOM) {
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
    };
    ctx.lineCap = 'butt';
    for (const { d, p } of items) {
      for (let k = 0; k < p.greenFill.length; k++) {
        if (!p.wet[k]) continue;
        ctx.save();
        place(d);
        ctx.clip(p.greenFill[k]);
        ctx.strokeStyle = palette.bridgeCasing;
        strokeAll(px(2.2));
        ctx.strokeStyle = palette.road;
        strokeAll(0);
        ctx.restore();
      }
    }
    ctx.lineCap = 'round';
  }

  // What is in the greenways: the stream, the trail and the paths in.
  if (layers.green && zoom >= GREENWAY_DETAIL_ZOOM) drawGreenwayDetail(ctx, view, world, items, place, px);

  // The metro runs underground: a dashed line under the buildings. Regional
  // rail runs on viaducts above everything.
  if (layers.transit && zoom >= TRANSIT_MIN_ZOOM) drawTransit(ctx, view, world, items, place, px, 'metro');
  if (drawBuildings) drawBuildings();
  if (layers.transit && zoom >= TRANSIT_MIN_ZOOM) drawTransit(ctx, view, world, items, place, px, 'rail');

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

const transitCache = new WeakMap();
function transitPaths(t, origin) {
  let p = transitCache.get(t);
  if (p && p.origin === origin) return p;
  const [ox, oy] = origin;
  p = { origin, metro: new Path2D() };
  for (const L of t.metro) addPoly(p.metro, L, ox, oy, false);
  transitCache.set(t, p);
  return p;
}

// Regional rail, for the whole city: each stretch of track's paths, in
// world coordinates.
const railCache = new WeakMap();
function railPaths(sg) {
  let p = railCache.get(sg);
  if (p) return p;
  const L = sg.pts;
  p = { rail: new Path2D(), rails: new Path2D(), shadow: new Path2D() };
  addPoly(p.rail, L, 0, 0, false);
  // Two tracks, each a pair of rails.
  for (const o of [-2.6, -1.1, 1.1, 2.6]) addPoly(p.rails, offsetLine(L, o), 0, 0, false);
  addPoly(p.shadow, L.map(([x, y]) => [x + VIADUCT_HEIGHT * 0.25, y + VIADUCT_HEIGHT * 0.32]), 0, 0, false);
  railCache.set(sg, p);
  return p;
}

function drawTransit(ctx, view, world, items, place, px, which) {
  const { zoom, x0, y0, s } = view;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (which === 'metro') {
    if (zoom > 1.6) return;
    const list = items.map(({ d }) => ({ d, p: transitPaths(world.transit(d), d.origin) }));
    ctx.strokeStyle = palette.metro;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = Math.max(5, px(3));
    ctx.setLineDash([px(6), px(4)]);
    for (const { d, p } of list) {
      place(d);
      ctx.stroke(p.metro);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    return;
  }
  if (!world.rail) return;
  const m = VIADUCT * 2;
  const list = world.rail.near(x0 - m, y0 - m, x0 + view.w / s + m, y0 + view.h / s + m).map(railPaths);
  ctx.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
  const close = zoom >= 0.5;
  if (close) {
    ctx.strokeStyle = 'rgba(40, 40, 40, 0.15)';
    ctx.lineWidth = VIADUCT;
    for (const p of list) ctx.stroke(p.shadow);
  }
  for (const [colour, w] of [[palette.railEdge, Math.max(VIADUCT + px(1.5), px(3.2))], [palette.railFill, Math.max(VIADUCT, px(2))]]) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = w;
    for (const p of list) ctx.stroke(p.rail);
  }
  if (close) {
    ctx.strokeStyle = palette.railTrack;
    ctx.lineWidth = Math.max(0.15, px(0.6));
    for (const p of list) ctx.stroke(p.rails);
  } else {
    // Farther out, ties along the line, as maps draw railways.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(VIADUCT, px(2)) * 0.45;
    ctx.setLineDash([px(1.2), px(5)]);
    ctx.lineCap = 'butt';
    for (const p of list) ctx.stroke(p.rail);
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
  }
}

const linearCache = new WeakMap();
function drawLinearParks(ctx, list, origin, zoom, px) {
  let p = linearCache.get(list);
  if (!p) {
    const [ox, oy] = origin;
    p = { fill: new Path2D(), trail: new Path2D(), links: new Path2D() };
    for (const lp of list) {
      p.fill.moveTo(lp.pts[0][0] - ox, lp.pts[0][1] - oy);
      for (const q of lp.pts.slice(1)) p.fill.lineTo(q[0] - ox, q[1] - oy);
      p.fill.closePath();
      p.trail.moveTo(lp.centre[0][0] - ox, lp.centre[0][1] - oy);
      for (const q of lp.centre.slice(1)) p.trail.lineTo(q[0] - ox, q[1] - oy);
      for (const [a, b] of lp.links || []) {
        p.links.moveTo(a[0] - ox, a[1] - oy);
        p.links.lineTo(b[0] - ox, b[1] - oy);
      }
    }
    linearCache.set(list, p);
  }
  ctx.fillStyle = palette.green;
  ctx.fill(p.fill);
  if (zoom < 0.3) return;
  ctx.lineCap = 'round';
  for (const [colour, extra] of [[palette.trailEdge, px(1.2)], [palette.trail, 0]]) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = Math.max(3.5, px(1.4)) + extra;
    ctx.stroke(p.trail);
    ctx.lineWidth = Math.max(3, px(1.2)) + extra;
    ctx.stroke(p.links);
  }
}


// Each stretch of greenway is drawn by both districts beside it, the same
// way, so the join is invisible.
const greenwayPaths = new WeakMap();
function greenwayPathsFor(g, origin) {
  let p = greenwayPaths.get(g);
  if (p && p.origin === origin) return p;
  const [ox, oy] = origin;
  const lines = (list) => {
    const path = new Path2D();
    for (const L of list) addPoly(path, L, ox, oy, false);
    return path;
  };
  p = { origin, stream: g.streams.length ? lines(g.streams) : null, trails: lines(g.trails), beaches: g.beaches && g.beaches.length ? lines(g.beaches) : null };
  greenwayPaths.set(g, p);
  return p;
}

function drawGreenwayDetail(ctx, view, world, items, place, px) {
  const { zoom } = view;
  const ways = [];
  for (const { d } of items) for (const c of d.chains) ways.push({ d, p: greenwayPathsFor(world.greenway(c.geo), d.origin), g: world.greenway(c.geo) });
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const { d, p, g } of ways) {
    if (!p.stream) continue;
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
      ctx.stroke(p.trails);
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

// Mountains: the high ground, shaded, with contours.
const highCache = new WeakMap();
function drawHighGround(ctx, view, terrain, px) {
  if (!terrain.highShapes) return;
  let h = highCache.get(terrain);
  if (!h) {
    const sh = terrain.highShapes();
    const poly = (list) => {
      const path = new Path2D();
      for (const L of list) addPoly(path, L, 0, 0, true);
      return path;
    };
    h = { fill: poly(sh.fill), contours: poly(sh.contours), tiers: sh.tiers.map(poly) };
    highCache.set(terrain, h);
  }
  const { x0, y0, s } = view;
  ctx.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
  ctx.fillStyle = palette.hills;
  ctx.fill(h.fill, 'evenodd');
  // Each hundred metres up a shade darker.
  ctx.fillStyle = palette.hillTint;
  for (const t of h.tiers) ctx.fill(t, 'evenodd');
  ctx.strokeStyle = palette.contour;
  ctx.lineWidth = px(0.8);
  ctx.stroke(h.contours);
}

// The sea and the rivers, in world coordinates.
const waterCache = new WeakMap();
function drawWater(ctx, view, terrain, px) {
  let w = waterCache.get(terrain);
  if (!w) {
    const poly = (list) => {
      const path = new Path2D();
      for (const L of list) addPoly(path, L, 0, 0, true);
      return path;
    };
    w = { sea: poly(terrain.seaShapes()), rivers: poly(terrain.riverShapes()) };
    waterCache.set(terrain, w);
  }
  const { x0, y0, s } = view;
  ctx.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
  // Edges first, then the fill over their inner halves, so where rivers
  // meet each other or the sea no edge shows.
  ctx.strokeStyle = palette.waterEdge;
  ctx.lineWidth = px(2);
  ctx.stroke(w.sea);
  ctx.stroke(w.rivers);
  ctx.fillStyle = palette.water;
  ctx.fill(w.sea);
  ctx.fill(w.rivers);
}

// Boulevards and main streets to scale: cross-sections, junctions paved
// over, rails and tram stops.
function drawDetailedStreets(ctx, view, world, hoods, lines, place, px) {
  const { x0, y0, s } = view;
  const blocksOf = (d) => (view.blocks ? view.blocks(d) : null);
  const items = [
    ...hoods.map(({ d, h }) => ({ path: h.streets, type: 'mainStreet', place: () => place(d) })),
    ...lines.map(({ b, path }) => ({ path, type: 'boulevard', place: () => ctx.setTransform(s, 0, 0, s, (b.origin[0] - x0) * s, (b.origin[1] - y0) * s) })),
  ];
  drawSections(ctx, items, px);
  // Junctions, then rails.
  for (const { d } of hoods) {
    const b = blocksOf(d);
    if (!b || !b.junctions) continue;
    place(d);
    drawJunctions(ctx, b.junctions, d.origin[0], d.origin[1], carriageway('mainStreet'));
  }
  for (const { d } of hoods) {
    const b = blocksOf(d);
    place(d);
    const [ox, oy] = d.origin;
    for (const l of world.neighbourhoods(d).lines) {
      const e = streetExtras(l.points, 'mainStreet');
      drawRails(ctx, e.rails, ox, oy, px);
    }
    for (const l of d.network.lines) {
      if (l.kind === 'roundabout') continue;
      const e = streetExtras(l.points, 'boulevard');
      drawRails(ctx, e.rails, ox, oy, px);
    }
    if (b && b.intersections) drawIntersections(ctx, b.intersections, ox, oy, px);
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
