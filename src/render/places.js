// Place markers, as map apps draw them: a round badge in the colour of what
// kind of place it is, with a small white glyph, and its kind written beside
// it close in. Less common places (schools, libraries, police and fire
// stations, hospitals, places of worship, museums, the stadium...) show from
// middling zoom; the everyday ones found on every main street (cafés,
// restaurants, groceries, pharmacies...) only when close in.

import { USES } from '../world/uses.js';

// Kinds of marker: colour and glyph.
const KINDS = {
  school: ['#a07a4f', 'cap'],
  health: ['#e0464e', 'cross'],
  police: ['#4f6d9a', 'shield'],
  fire: ['#d9573a', 'flame'],
  civic: ['#6b7c93', 'columns'],
  culture: ['#9566c9', 'columns'],
  library: ['#9566c9', 'book'],
  stage: ['#9566c9', 'star'],
  worship: ['#7a7f88', 'steeple'],
  mosque: ['#7a7f88', 'crescent'],
  synagogue: ['#7a7f88', 'star'],
  sport: ['#3c9d63', 'ball'],
  shop: ['#ef9a2f', 'bag'],
  food: ['#f07c35', 'fork'],
  cafe: ['#b0763f', 'cup'],
  drink: ['#d76a8d', 'glass'],
  lodging: ['#5a72d4', 'bed'],
  market: ['#c88a3a', 'square'],
  post: ['#6b7c93', 'letter'],
  rail: ['#2f6db5', 'stairs'],
};

// Uses shown, with their kind and from which tier: 1 the district's own,
// from middling zoom; 1.5 each neighbourhood's own; 2 everyday, close in.
const SHOWN = {
  hospital: ['health', 1], hospice: ['health', 1], college: ['school', 1], secondarySchool: ['school', 1.5], elementarySchool: ['school', 1.5],
  altPrimary: ['school', 1.5], altSecondary: ['school', 1.5], stadium: ['sport', 1], recCentre: ['sport', 1.5], skatingRink: ['sport', 1.5],
  climbing: ['sport', 1.5], gymnastics: ['sport', 1.5], museum: ['culture', 1], gallery: ['culture', 2], performingArts: ['stage', 1],
  cinema: ['stage', 1.5], library: ['library', 1.5], districtLibrary: ['library', 1], police: ['police', 1], fireStation: ['fire', 1],
  courthouse: ['civic', 1], cityHall: ['civic', 1], mainLibrary: ['library', 1], touristCentre: ['civic', 1.5], boutiqueHotel: ['lodging', 1.5], governmentOffice: ['civic', 1.5], communityCentre: ['civic', 1.5], employment: ['civic', 2], postOffice: ['post', 1.5],
  church: ['worship', 1.5], cathedral: ['worship', 1], mosque: ['mosque', 1.5], synagogue: ['synagogue', 1.5], temple: ['worship', 1.5],
  stationEntrance: ['rail', 1.5],
  departmentStore: ['shop', 1], hotel: ['lodging', 1], inn: ['lodging', 1.5], market: ['market', 1.5], districtPlaza: ['market', 1],
  // Everyday places, close in only.
  grocery: ['shop', 2], convenience: ['shop', 2], ethnicGrocer: ['shop', 2], pharmacy: ['health', 2], clinic: ['health', 2],
  dental: ['health', 2], bank: ['civic', 2], cafe: ['cafe', 2], restaurant: ['food', 2], casual: ['food', 2], takeout: ['food', 2],
  deli: ['food', 2], dessert: ['cafe', 2], pub: ['drink', 2], drinks: ['drink', 2], liveMusic: ['drink', 2], nightclub: ['drink', 2],
  bookshop: ['shop', 2], clothing: ['shop', 2], hardware: ['shop', 2], bikeShop: ['shop', 2], florist: ['shop', 2],
};
export const PLACE_MIN_ZOOM = 0.3; // notable places from here
export const LOCAL_MIN_ZOOM = 0.7; // each neighbourhood's own (schools, churches, libraries...) from here
export const EVERYDAY_MIN_ZOOM = 1.6; // everyday ones from here
const LABEL_MIN_ZOOM = 0.9;
const R = 9; // px, a badge's radius

const centroid = (P) => {
  let x = 0;
  let y = 0;
  for (const p of P) {
    x += p[0];
    y += p[1];
  }
  return [x / P.length, y / P.length];
};

// The places in a district's blocks: each dedicated building, and close
// in each shop floor of note.
const cache = new WeakMap();
export function placesOf(blocks) {
  let out = cache.get(blocks);
  if (out) return out;
  out = [];
  for (const block of blocks.blocks) {
    for (const plot of block.plots || []) {
      const at = plot.bldg && plot.bldg.pts ? centroid(plot.bldg.pts) : plot.c || (plot.pts && centroid(plot.pts));
      if (!at) continue;
      const uses = [];
      if (plot.dedicated) uses.push(plot.dedicated);
      for (const a of plot.also || []) uses.push(a);
      if (plot.ground && plot.ground !== 'stationEntrance') uses.push(plot.ground);
      if (plot.shops) for (const s of plot.shops.slice(1, 3)) uses.push(s);
      // A rail station's entrances, each where it is on the frontage.
      for (const q of plot.entrances || []) out.push({ p: q, use: 'stationEntrance', kind: 'rail', tier: SHOWN.stationEntrance[1], block, plot });
      let k = 0;
      for (const use of uses) {
        const shown = SHOWN[use];
        if (!shown) continue;
        // (Several on one plot sit side by side.)
        out.push({ p: [at[0] + k * 9, at[1]], use, kind: shown[0], tier: shown[1], block, plot });
        k++;
      }
    }
  }
  // Notable first, so they win a place when markers crowd.
  out.sort((a, b) => a.tier - b.tier);
  cache.set(blocks, out);
  return out;
}

// Draw markers for the places given (in world space), skipping any that
// would overlap one already drawn. Returns what was drawn, for tapping.
export function drawPlaces(ctx, camera, lists, dpr = 1) {
  const z = camera.zoom;
  if (z < PLACE_MIN_ZOOM) return [];
  const drawn = [];
  const boxes = [];
  const labels = z >= LABEL_MIN_ZOOM;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = '600 11px -apple-system, system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (const list of lists) {
    for (const pl of list) {
      if ((pl.tier === 2 && z < EVERYDAY_MIN_ZOOM) || (pl.tier === 1.5 && z < LOCAL_MIN_ZOOM)) continue;
      const [sx, sy] = camera.worldToScreen(pl.p[0], pl.p[1]);
      if (sx < -40 || sy < -40 || sx > camera.width + 40 || sy > camera.height + 40) continue;
      const text = labels ? shortLabel(pl.use) : '';
      const tw = text ? ctx.measureText(text).width + 6 : 0;
      const box = [sx - R - 2, sy - R - 2, sx + R + 2 + tw, sy + R + 2];
      if (boxes.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      boxes.push(box);
      const [colour, glyph] = KINDS[pl.kind];
      badge(ctx, sx, sy, colour, glyph);
      if (text) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
        ctx.lineJoin = 'round';
        ctx.strokeText(text, sx + R + 4, sy);
        ctx.fillStyle = colour;
        ctx.fillText(text, sx + R + 4, sy);
      }
      drawn.push({ ...pl, sx, sy });
    }
  }
  ctx.restore();
  return drawn;
}

// The marker under a screen point, if any.
export function pickPlace(drawn, sx, sy) {
  let best = null;
  for (const d of drawn) {
    const r = Math.hypot(d.sx - sx, d.sy - sy);
    if (r <= R + 4 && (!best || r < best.r)) best = { r, d };
  }
  return best ? best.d : null;
}

function shortLabel(use) {
  const l = USES[use] ? USES[use].label : use;
  return l.replace(/ \(.*\)$/, '').replace(/ and .*$/, '');
}

function badge(ctx, x, y, colour, glyph) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  GLYPHS[glyph](ctx);
  ctx.restore();
}

// Glyphs, drawn in white about a 10 px box centred on the origin.
const GLYPHS = {
  // Stairs going down, and an arrow down them.
  stairs(c) {
    c.beginPath();
    c.moveTo(-5, -3.5);
    c.lineTo(-2.5, -3.5);
    c.lineTo(-2.5, -1);
    c.lineTo(0, -1);
    c.lineTo(0, 1.5);
    c.lineTo(2.5, 1.5);
    c.lineTo(2.5, 4);
    c.lineTo(5, 4);
    c.stroke();
    c.beginPath();
    c.moveTo(-3.5, 1);
    c.lineTo(-1.5, 3.5);
    c.moveTo(-1.5, 3.5);
    c.lineTo(-1.5, 1.8);
    c.moveTo(-1.5, 3.5);
    c.lineTo(-3.2, 3.5);
    c.stroke();
  },
  cross(c) {
    c.fillRect(-1.6, -4.5, 3.2, 9);
    c.fillRect(-4.5, -1.6, 9, 3.2);
  },
  cap(c) {
    c.beginPath();
    c.moveTo(-5, -1);
    c.lineTo(0, -3.5);
    c.lineTo(5, -1);
    c.lineTo(0, 1.5);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(-2.8, 0.5);
    c.lineTo(-2.8, 3);
    c.quadraticCurveTo(0, 4.5, 2.8, 3);
    c.lineTo(2.8, 0.5);
    c.fill();
  },
  shield(c) {
    c.beginPath();
    c.moveTo(0, -4.8);
    c.lineTo(4, -3);
    c.quadraticCurveTo(4, 2.5, 0, 4.8);
    c.quadraticCurveTo(-4, 2.5, -4, -3);
    c.closePath();
    c.fill();
  },
  flame(c) {
    c.beginPath();
    c.moveTo(0, -5);
    c.quadraticCurveTo(4.5, -0.5, 3, 2.5);
    c.quadraticCurveTo(1.5, 5, 0, 5);
    c.quadraticCurveTo(-3.5, 4.5, -3.2, 1.5);
    c.quadraticCurveTo(-3, -1, -1, -1.5);
    c.quadraticCurveTo(-0.5, -3, 0, -5);
    c.fill();
  },
  columns(c) {
    c.beginPath();
    c.moveTo(-5, -1.8);
    c.lineTo(0, -4.8);
    c.lineTo(5, -1.8);
    c.closePath();
    c.fill();
    for (const x of [-3.6, -1.2, 1.2, 3.6]) c.fillRect(x - 0.6, -1, 1.2, 4.2);
    c.fillRect(-5, 3.6, 10, 1.3);
  },
  book(c) {
    c.beginPath();
    c.moveTo(0, -2.8);
    c.quadraticCurveTo(-2.5, -4.2, -5, -3);
    c.lineTo(-5, 3.6);
    c.quadraticCurveTo(-2.5, 2.4, 0, 4);
    c.quadraticCurveTo(2.5, 2.4, 5, 3.6);
    c.lineTo(5, -3);
    c.quadraticCurveTo(2.5, -4.2, 0, -2.8);
    c.fill();
  },
  star(c) {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 2.1 : 5;
      c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    c.closePath();
    c.fill();
  },
  steeple(c) {
    c.beginPath();
    c.moveTo(0, -5);
    c.lineTo(2.2, -0.8);
    c.lineTo(3.8, -0.8);
    c.lineTo(3.8, 4.8);
    c.lineTo(-3.8, 4.8);
    c.lineTo(-3.8, -0.8);
    c.lineTo(-2.2, -0.8);
    c.closePath();
    c.fill();
  },
  crescent(c) {
    c.beginPath();
    c.arc(0, 0, 4.6, 0, Math.PI * 2);
    c.fill();
    c.globalCompositeOperation = 'destination-out';
    c.beginPath();
    c.arc(1.9, -0.8, 3.8, 0, Math.PI * 2);
    c.fill();
    c.globalCompositeOperation = 'source-over';
  },
  ball(c) {
    c.beginPath();
    c.arc(0, 0, 4.4, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(-4.4, 0);
    c.lineTo(4.4, 0);
    c.moveTo(0, -4.4);
    c.quadraticCurveTo(-2.6, 0, 0, 4.4);
    c.moveTo(0, -4.4);
    c.quadraticCurveTo(2.6, 0, 0, 4.4);
    c.stroke();
  },
  bag(c) {
    c.fillRect(-4, -1.6, 8, 6.2);
    c.beginPath();
    c.moveTo(-2, -1.6);
    c.lineTo(-2, -3);
    c.quadraticCurveTo(0, -5.4, 2, -3);
    c.lineTo(2, -1.6);
    c.stroke();
  },
  fork(c) {
    c.beginPath();
    c.moveTo(-2.4, -4.8);
    c.lineTo(-2.4, 4.8);
    c.moveTo(-3.8, -4.8);
    c.lineTo(-3.8, -1.6);
    c.quadraticCurveTo(-2.4, -0.2, -1, -1.6);
    c.lineTo(-1, -4.8);
    c.stroke();
    c.beginPath();
    c.moveTo(2.6, 4.8);
    c.lineTo(2.6, -4.8);
    c.quadraticCurveTo(4.6, -2.5, 3.8, 0.4);
    c.lineTo(2.6, 0.4);
    c.stroke();
  },
  cup(c) {
    c.beginPath();
    c.moveTo(-4, -2.2);
    c.lineTo(2.6, -2.2);
    c.lineTo(2.2, 2.6);
    c.quadraticCurveTo(-0.7, 4.2, -3.6, 2.6);
    c.closePath();
    c.fill();
    c.beginPath();
    c.arc(3.1, 0, 1.6, -Math.PI / 2, Math.PI / 2);
    c.stroke();
    c.fillRect(-4.6, 4, 7.6, 1);
  },
  glass(c) {
    c.beginPath();
    c.moveTo(-4, -4.4);
    c.lineTo(4, -4.4);
    c.lineTo(0, 0.6);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(0, 0.6);
    c.lineTo(0, 4.2);
    c.moveTo(-2.4, 4.4);
    c.lineTo(2.4, 4.4);
    c.stroke();
  },
  bed(c) {
    c.fillRect(-5, 0, 10, 2.6);
    c.fillRect(-5, -3.6, 1.4, 7.6);
    c.fillRect(3.6, 2.6, 1.4, 1.6);
    c.beginPath();
    c.arc(-1.8, -1.4, 1.5, 0, Math.PI * 2);
    c.fill();
    c.fillRect(0, -2.6, 5, 2.6);
  },
  square(c) {
    c.fillRect(-4, -4, 8, 8);
  },
  letter(c) {
    c.fillRect(-4.6, -3, 9.2, 6.4);
    c.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(-4.4, -2.6);
    c.lineTo(0, 0.6);
    c.lineTo(4.4, -2.6);
    c.stroke();
  },
};
