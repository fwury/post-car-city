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
import { splitByPolygon } from '../util/geom.js';

const MAIN_STREET_WIDTH = STREET_TYPES.mainStreet.width;
const TRAM_WIDTH = 5;
export const MAIN_STREET_MIN_ZOOM = 0.02;
const TRAM_MIN_ZOOM = 0.2;
const TUNNEL_MIN_ZOOM = 0.05;
const GREENWAY_DETAIL_ZOOM = 0.15; // streams from here; trails and paths closer in
const STOP_MIN_ZOOM = 0.25;
const TRANSIT_MIN_ZOOM = 0.008;
const VIADUCT = 11; // metres: a two-track viaduct's width
const RAIL_BUILDING_ZOOM = 0.5; // station halls and stalls under the viaducts from here
const CENTRAL_TRACKS = [4, 12]; // platform tracks at the central station, fewest and most
const TRACK_GAP = 4.6; // metres between neighbouring tracks with no platform between
const ISLAND = 9; // metres: an island platform's width
const PLATFORM_LENGTH = 400; // metres: the central station's platforms
const THROAT = 260; // metres over which its tracks fan out
const CYCLE_TRACK = 7.5; // metres off the viaduct's centreline: the cycle track on the path beneath
const VIADUCT_HEIGHT = 8; // tram stops as markers from here (to scale from DETAIL_MIN_ZOOM)
import { palette } from './styles.js';
import { TRAIL_WIDTH, BEACH } from '../world/greenway.js';
import { layoutPaths, drawLayouts } from './parkLayer.js';
import { drawBlocks, hoodLinePath, BLOCK_MIN_ZOOM } from './blockLayer.js';
import { DETAIL_MIN_ZOOM, drawJunctionGround, drawJunctionMarks, drawPlatforms, drawSections, streetExtras, drawRails, offsetLine } from './streetDetail.js';

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
  p = { tints: palette.hoodTints.map(() => new Path2D()), lines: new Path2D(), centres: nb.hoods.map((h) => h.centre), streets: new Path2D(), outer: new Path2D(), core: new Path2D() };
  for (const h of nb.hoods) {
    if (h.core || h.polygon.length < 3) continue;
    addPoly(p.tints[colour[h.id]], h.polygon, ox, oy, true);
    for (const r of h.holes) if (r.length > 2) addPoly(p.tints[colour[h.id]], r, ox, oy, true);
  }
  for (const c of nb.chains) if (c.a >= 0 && c.b >= 0) addPoly(p.lines, c.points, ox, oy, false);
  // All the main streets; and, for drawing close in, split into those
  // through the core neighbourhood (core main streets) and the rest.
  for (const l of nb.lines) addPoly(p.streets, l.points, ox, oy, false);
  const corePoly = nb.hoods[0] && nb.hoods[0].core ? nb.hoods[0].polygon : null;
  for (const l of nb.lines) for (const run of splitByPolygon(l.points, corePoly)) addPoly(run.inside ? p.core : p.outer, run.pts, ox, oy, false);
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
  if (layers.transit) drawRailBuildings(ctx, view, items, place, px, 'arcades');
  if (layers.transit && zoom >= TRANSIT_MIN_ZOOM) drawTransit(ctx, view, world, items, place, px, 'rail');
  if (layers.transit) drawRailBuildings(ctx, view, items, place, px, 'halls');

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

// A line's path offset to one side (metres), cached by offset.
const offsetCache = new WeakMap();
function offsetPath(pts, o) {
  let m = offsetCache.get(pts);
  if (!m) offsetCache.set(pts, (m = new Map()));
  const k = Math.round(o * 4) / 4;
  let p = m.get(k);
  if (!p) {
    p = new Path2D();
    addPoly(p, k ? offsetLine(pts, k) : pts, 0, 0, false);
    if (m.size > 6) m.clear();
    m.set(k, p);
  }
  return p;
}

// Regional rail, for the whole city: each run of track's paths (on a
// viaduct, a ramp or in tunnel), in world coordinates.
const railCache = new WeakMap();
function railPaths(sg) {
  let p = railCache.get(sg);
  if (p) return p;
  const L = sg.pts;
  p = { rail: new Path2D(), rails: new Path2D(), shadow: new Path2D(), walls: new Path2D() };
  addPoly(p.rail, L, 0, 0, false);
  for (const o of [-VIADUCT / 2, VIADUCT / 2]) addPoly(p.walls, offsetLine(L, o), 0, 0, false);
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
  const m = VIADUCT * 2;
  const vx0 = x0 - m;
  const vy0 = y0 - m;
  const vx1 = x0 + view.w / s + m;
  const vy1 = y0 + view.h / s + m;
  if (which === 'metro') {
    // The metro in tunnels: each line in its own colour, lines sharing a
    // stretch side by side; hidden close in, where the streets take over.
    if (zoom > 1.6 || !world.metro) return;
    ctx.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
    // (Thinner than the rail, with a white casing.)
    const w = px(zoom < 0.05 ? 1.6 : 2.2);
    for (const [colour, width] of [['#ffffff', w * 2], [null, w]]) {
      for (const L of world.metro.near(vx0, vy0, vx1, vy1)) {
        ctx.strokeStyle = colour || L.colour;
        ctx.lineWidth = width;
        for (const pc of L.pieces) ctx.stroke(offsetPath(pc.pts, (pc.rank - (pc.of - 1) / 2) * w * 1.3));
      }
    }
    return;
  }
  if (!world.rail) return;
  const segs = world.rail.near(vx0, vy0, vx1, vy1);
  ctx.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
  const runsOf = (kinds) => segs.flatMap((sg) => (sg.runs || [{ kind: 'viaduct', pts: sg.pts }]).filter((r) => kinds.includes(r.kind)).map((r) => ({ sg, r, p: railPaths(r) })));
  if (zoom < 0.3) {
    // Far out, as on a transit map: each line in its colour, side by side
    // where they share the track; in tunnel, dashed and paler. (Thicker
    // than the metro; above ground cased in the viaduct's grey.)
    const w = px(zoom < 0.05 ? 2.4 : 3.2);
    ctx.strokeStyle = palette.railEdge;
    for (const { sg, p } of runsOf(['viaduct', 'ramp'])) {
      ctx.lineWidth = w * ((sg.lines || []).length || 1) + px(1.6);
      ctx.stroke(p.rail);
    }
    for (const { sg, r } of runsOf(['tunnel', 'ramp', 'viaduct'])) {
      const ids = sg.lines || [];
      const under = r.kind === 'tunnel';
      ctx.globalAlpha = under ? 0.6 : 1;
      ctx.setLineDash(under ? [px(5), px(3)] : []);
      ids.forEach((id, k) => {
        ctx.strokeStyle = world.rail.lines[id].colour;
        ctx.lineWidth = w;
        ctx.stroke(offsetPath(r.pts, (k - (ids.length - 1) / 2) * w));
      });
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    return;
  }
  const close = zoom >= 0.5;
  // In tunnel: the tracks underground, faint and dashed.
  ctx.setLineDash([px(6), px(4)]);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = 'rgba(95, 103, 110, 0.5)';
  ctx.lineWidth = close ? Math.max(0.3, px(0.9)) : Math.max(VIADUCT * 0.6, px(1.6));
  for (const { p } of runsOf(['tunnel'])) ctx.stroke(close ? p.rails : p.rail);
  ctx.setLineDash([]);
  ctx.lineCap = 'round';
  if (close) drawCentralStation(ctx, world, px);
  // On a ramp: an open cutting between retaining walls.
  const ramps = runsOf(['ramp']);
  ctx.strokeStyle = palette.railFill;
  ctx.lineWidth = Math.max(VIADUCT, px(2));
  ctx.globalAlpha = 0.75;
  for (const { p } of ramps) ctx.stroke(p.rail);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = palette.railEdge;
  ctx.lineWidth = Math.max(0.6, px(1));
  for (const { p } of ramps) ctx.stroke(p.walls);
  // On a viaduct: the cycle track along the path beneath, its shadow, the
  // deck, and the rails.
  const list = runsOf(['viaduct']).map((x) => x.p);
  if (close) {
    ctx.strokeStyle = palette.bike;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 2.2;
    for (const { r } of runsOf(['viaduct', 'ramp'])) ctx.stroke(offsetPath(r.pts, CYCLE_TRACK));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(40, 40, 40, 0.15)';
    ctx.lineWidth = VIADUCT;
    for (const p of list) ctx.stroke(p.shadow);
  }
  for (const [colour, w] of [[palette.railEdge, Math.max(VIADUCT + px(1.5), px(3.2))], [palette.railFill, Math.max(VIADUCT, px(2))]]) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = w;
    for (const p of list) ctx.stroke(p.rail);
  }
  ctx.strokeStyle = palette.railTrack;
  ctx.lineWidth = Math.max(0.15, px(0.6));
  for (const p of close ? list.concat(ramps.map((x) => x.p)) : []) ctx.stroke(p.rails);
  if (!close) {
    // Ties along the line, as maps draw railways.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(VIADUCT, px(2)) * 0.45;
    ctx.setLineDash([px(1.2), px(5)]);
    ctx.lineCap = 'butt';
    for (const p of list) ctx.stroke(p.rail);
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
  }
}

// The central station, underground: the lines through it fan out from four
// approach tracks (two either way) to a track for every line or two, along
// island platforms, and back; ladders of crossovers in each throat let any
// train reach any platform. Trains run through, not stopping long, so a
// platform track for about every line does (as at Chatelet on the RER).
const centralCache = new WeakMap();
function centralTracks(st) {
  let c = centralCache.get(st);
  if (c) return c;
  const t = st.dir;
  const n = [-t[1], t[0]];
  const at = (a, b) => [st.p[0] + t[0] * a + n[0] * b, st.p[1] + t[1] * a + n[1] * b];
  const lines = (st.lines || []).length;
  const k = Math.min(CENTRAL_TRACKS[1], Math.max(CENTRAL_TRACKS[0], 2 * Math.ceil(lines / 2) + 2));
  // Tracks in pairs, an island platform between each pair.
  const offs = [];
  const platforms = [];
  let y = -((k / 2) * TRACK_GAP + (k / 2) * ISLAND) / 2;
  for (let q = 0; q < k / 2; q++) {
    offs.push(y);
    platforms.push(y + TRACK_GAP / 2 + ISLAND / 2);
    offs.push(y + TRACK_GAP + ISLAND);
    y += 2 * TRACK_GAP + ISLAND;
  }
  const approach = [-6, -2, 2, 6];
  const tracks = new Path2D();
  const half = PLATFORM_LENGTH / 2;
  for (const o of offs) {
    // The nearest approach track, eased across to the platform.
    const a = approach.reduce((m, x) => (Math.abs(x - o) < Math.abs(m - o) ? x : m));
    const pts = [];
    for (let s = -half - THROAT; s <= half + THROAT; s += 10) {
      const u = Math.abs(s) <= half ? 1 : 1 - (Math.abs(s) - half) / THROAT;
      const e = u * u * (3 - 2 * u);
      pts.push(at(s, a + (o - a) * e));
    }
    addPoly(tracks, pts, 0, 0, false);
  }
  // Crossovers between neighbouring approach tracks, a ladder each end.
  const ladders = new Path2D();
  for (const sg of [-1, 1]) {
    for (let q = 0; q + 1 < approach.length; q++) {
      const s0 = sg * (half + THROAT + 30 + q * 25);
      addPoly(ladders, [at(s0, approach[q]), at(s0 + sg * 25, approach[q + 1])], 0, 0, false);
      addPoly(ladders, [at(s0 + sg * 60, approach[q + 1]), at(s0 + sg * 85, approach[q])], 0, 0, false);
    }
    for (const a of approach) addPoly(ladders, [at(sg * (half + THROAT), a), at(sg * (half + THROAT + 160), a)], 0, 0, false);
  }
  const islands = new Path2D();
  for (const y0 of platforms) {
    const P = [at(-half, y0 - ISLAND / 2), at(half, y0 - ISLAND / 2), at(half, y0 + ISLAND / 2), at(-half, y0 + ISLAND / 2)];
    addPoly(islands, P, 0, 0, true);
  }
  c = { tracks, ladders, islands };
  centralCache.set(st, c);
  return c;
}
function drawCentralStation(ctx, world, px) {
  const st = world.rail.stations.find((x) => x.central);
  if (!st || !st.dir) return;
  const c = centralTracks(st);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = palette.platform;
  ctx.fill(c.islands);
  ctx.strokeStyle = palette.railEdge;
  ctx.lineWidth = Math.max(0.5, px(1.1));
  ctx.lineCap = 'butt';
  ctx.stroke(c.tracks);
  ctx.stroke(c.ladders);
  ctx.lineCap = 'round';
  ctx.globalAlpha = 1;
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
    ...hoods.map(({ d, h }) => ({ path: h.outer, type: 'mainStreet', place: () => place(d) })),
    ...hoods.map(({ d, h }) => ({ path: h.core, type: 'coreMainStreet', place: () => place(d) })),
    ...lines.map(({ b, path }) => ({ path, type: 'boulevard', place: () => ctx.setTransform(s, 0, 0, s, (b.origin[0] - x0) * s, (b.origin[1] - y0) * s) })),
  ];
  drawSections(ctx, items, px);
  // Each junction's ground, the tram platforms, the rails, then the
  // junctions' markings, kerbs, signals and bollards (those in view).
  const M = 60;
  const inView = ([x, y]) => x > x0 - M && y > y0 - M && x < x0 + view.w / s + M && y < y0 + view.h / s + M;
  for (const { d } of hoods) {
    const b = blocksOf(d);
    if (!b) continue;
    place(d);
    drawJunctionGround(ctx, b.intersections, d.origin[0], d.origin[1], px, inView);
    drawPlatforms(ctx, b.tramStops, d.origin[0], d.origin[1], px, inView);
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
    if (b) drawJunctionMarks(ctx, b.intersections, ox, oy, px, inView);
  }
}

// Rail buildings at street level: the stalls in the arches under the
// viaducts (before the viaducts are drawn over them), or the station halls
// over the platforms (after the tracks).
function drawRailBuildings(ctx, view, items, place, px, which) {
  if (!view.blocks || view.zoom < RAIL_BUILDING_ZOOM) return;
  for (const { d } of items) {
    const b = view.blocks(d);
    if (!b) continue;
    place(d);
    const [ox, oy] = d.origin;
    if (which === 'halls') {
      // Station halls over the platforms below: a glass roof, with an
      // entrance in the middle of each long side.
      for (const h of b.halls || []) {
        const P = h.pts.map(([x, y]) => [x - ox, y - oy]);
        ctx.beginPath();
        P.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = palette.hallRoof;
        // (The central station's hall, glass, shows its platforms below.)
        ctx.globalAlpha = h.central ? 0.55 : 1;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = palette.hallEdge;
        ctx.lineWidth = Math.max(0.4, px(1));
        ctx.stroke();
        // The roof's ridge, and the doors.
        const mid = (a, c) => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
        ctx.beginPath();
        const r0 = mid(P[0], P[3]);
        const r1 = mid(P[1], P[2]);
        ctx.moveTo(r0[0], r0[1]);
        ctx.lineTo(r1[0], r1[1]);
        ctx.stroke();
        ctx.fillStyle = palette.hallEdge;
        for (const [a, c] of [[P[0], P[1]], [P[3], P[2]]]) {
          const m = mid(a, c);
          const t = [h.t[0] * 7, h.t[1] * 7];
          const inward = [(r0[0] + r1[0]) / 2 - m[0], (r0[1] + r1[1]) / 2 - m[1]];
          const l = Math.hypot(inward[0], inward[1]) || 1;
          const n = [(inward[0] / l) * 2.5, (inward[1] / l) * 2.5];
          ctx.beginPath();
          ctx.moveTo(m[0] - t[0], m[1] - t[1]);
          ctx.lineTo(m[0] + t[0], m[1] + t[1]);
          ctx.lineTo(m[0] + t[0] + n[0], m[1] + t[1] + n[1]);
          ctx.lineTo(m[0] - t[0] + n[0], m[1] - t[1] + n[1]);
          ctx.closePath();
          ctx.fill();
        }
      }
      continue;
    }
    // Stalls in the arches under the viaducts (seen through the deck).
    if (b.arcades && b.arcades.length) {
      const path = new Path2D();
      for (const q of b.arcades) addPoly(path, q, ox, oy, true);
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = palette.kiosk;
      ctx.fill(path);
      ctx.strokeStyle = palette.kioskEdge;
      ctx.lineWidth = Math.max(0.2, px(0.6));
      ctx.stroke(path);
      ctx.globalAlpha = 1;
    }
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
