// Streets drawn to scale close in: each street's cross-section, from the
// building line in (pavement, tree strip, cycle track, kerb, traffic lane,
// tram tracks, planted median), as strokes one inside another along its
// centreline; then the rails, the paving over junctions, and the
// tram stops' platforms.

import { STREET_TYPES } from '../world/streetTypes.js';

export const DETAIL_MIN_ZOOM = 1.1;
const RAIL_GAUGE = 1.435;
const PLATFORM = [40, 4]; // a tram stop's platform: length, width

const COLOURS = {
  clearway: '#f1eee8', frontage: '#ece8e0', furnishing: '#e6e1d8', planted: '#c9dfba', path: '#f1eee8', paved: '#ece8e0',
  cycle: '#dcbfb5', buffer: '#d4d0c8', drive: '#c5c9cd', bus: '#c9b0a8', shared: '#e2dfd9', tram: '#bcc0c4', median: '#c4dcb4',
  shoulder: '#c5c9cd',
};
const KERB = '#b9b5ad';
const PAVED = new Set(['clearway', 'frontage', 'furnishing', 'planted', 'path', 'paved']);

// From the outside in: each element's half-width from the centreline.
const layerCache = new Map();
export function sectionLayers(type) {
  let out = layerCache.get(type);
  if (out) return out;
  const T = STREET_TYPES[type];
  out = [];
  const centre = T.centre.reduce((a, [, w]) => a + w, 0);
  let r = T.side.reduce((a, [, w]) => a + w, 0) + centre / 2;
  let prev = null;
  for (const [el, w] of T.side) {
    out.push({ r, el, kerb: prev && PAVED.has(prev) !== PAVED.has(el) });
    prev = el;
    r -= w;
  }
  r = centre / 2;
  for (const [el, w] of T.centre) {
    if (r <= 0.01) break;
    out.push({ r, el, kerb: prev && PAVED.has(prev) !== PAVED.has(el) });
    prev = el;
    r -= w;
  }
  layerCache.set(type, out);
  return out;
}

// Where along the section the trees stand and the tram lanes run.
const featureCache = new Map();
export function sectionFeatures(type) {
  let f = featureCache.get(type);
  if (f) return f;
  const T = STREET_TYPES[type];
  const centre = T.centre.reduce((a, [, w]) => a + w, 0);
  let r = T.side.reduce((a, [, w]) => a + w, 0) + centre / 2;
  const trees = [];
  for (const [el, w] of T.side) {
    // Trees in the widest furnishing strip.
    if (el === 'furnishing' && w >= 1.5) trees.push(r - w / 2);
    r -= w;
  }
  if (!trees.length) {
    let rr = T.side.reduce((a, [, w]) => a + w, 0) + centre / 2;
    for (const [el, w] of T.side) {
      if (el === 'furnishing') {
        trees.push(rr - w / 2);
        break;
      }
      rr -= w;
    }
  }
  const tram = [];
  let c = centre / 2;
  for (const [el, w] of T.centre) {
    if (el === 'tram') tram.push(c - w / 2, -(c - w / 2));
    c -= w;
  }
  f = { trees, tram: [...new Set(tram.map((x) => Math.round(x * 1000) / 1000))] };
  featureCache.set(type, f);
  return f;
}

// Draw a street path (in the current transform) as its cross-section.
export function drawSection(ctx, path, type, px) {
  ctx.lineCap = 'butt';
  for (const { r, el, kerb } of sectionLayers(type)) {
    if (kerb) {
      ctx.strokeStyle = KERB;
      ctx.lineWidth = 2 * r + px(1);
      ctx.stroke(path);
    }
    ctx.strokeStyle = COLOURS[el] || COLOURS.drive;
    ctx.lineWidth = 2 * r;
    ctx.stroke(path);
  }
  ctx.lineCap = 'round';
}

// Several streets' cross-sections drawn together, layer by layer from the
// outside in, so where streets meet their carriageways open into each other
// instead of one street's pavement running across the other. items:
// [{ path, type, place }] (place() sets the transform for that path).
export function drawSections(ctx, items, px) {
  ctx.lineCap = 'butt';
  const layers = items.map((it) => sectionLayers(it.type));
  const depth = Math.max(0, ...layers.map((l) => l.length));
  for (let k = 0; k < depth; k++) {
    for (const pass of ['kerb', 'fill']) {
      items.forEach((it, i) => {
        const L = layers[i][k];
        if (!L || (pass === 'kerb' && !L.kerb)) return;
        it.place();
        ctx.strokeStyle = pass === 'kerb' ? KERB : COLOURS[L.el] || COLOURS.drive;
        ctx.lineWidth = 2 * L.r + (pass === 'kerb' ? px(1) : 0);
        ctx.stroke(it.path);
      });
    }
  }
  ctx.lineCap = 'round';
}

// The half-width of a street's carriageway: everything inside its pavements.
export function carriageway(type) {
  const T = STREET_TYPES[type];
  let r = T.side.reduce((a, [, w]) => a + w, 0) + T.centre.reduce((a, [, w]) => a + w, 0) / 2;
  for (const [el, w] of T.side) {
    if (!PAVED.has(el)) break;
    r -= w;
  }
  return r;
}

// A polyline moved d metres to its left (or right, d < 0).
export function offsetLine(P, d) {
  const out = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)];
    const b = P[Math.min(P.length - 1, i + 1)];
    const t = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(t[0], t[1]) || 1;
    out.push([P[i][0] - (t[1] / l) * d, P[i][1] + (t[0] / l) * d]);
  }
  return out;
}

// Rails for one street centreline, kept by its points.
const extrasCache = new WeakMap();
export function streetExtras(P, type) {
  let e = extrasCache.get(P);
  if (e) return e;
  const f = sectionFeatures(type);
  const rails = [];
  for (const c of f.tram) for (const g of [-RAIL_GAUGE / 2, RAIL_GAUGE / 2]) rails.push(offsetLine(P, c + g));
  e = { rails };
  extrasCache.set(P, e);
  return e;
}

export function drawRails(ctx, rails, ox, oy, px) {
  ctx.strokeStyle = '#8b9096';
  ctx.lineWidth = Math.max(0.12, px(0.6));
  ctx.beginPath();
  for (const L of rails) {
    ctx.moveTo(L[0][0] - ox, L[0][1] - oy);
    for (let i = 1; i < L.length; i++) ctx.lineTo(L[i][0] - ox, L[i][1] - oy);
  }
  ctx.stroke();
}


// Junctions paved over (so medians and tree strips stop short of them).
export function drawJunctions(ctx, junctions, ox, oy, r) {
  ctx.fillStyle = COLOURS.drive;
  ctx.beginPath();
  for (const [x, y] of junctions) {
    ctx.moveTo(x - ox + r, y - oy);
    ctx.arc(x - ox, y - oy, r, 0, Math.PI * 2);
  }
  ctx.fill();
}

// A tram stop: the platform along the street, with a little shelter.
export function drawStops(ctx, stops, ox, oy, px) {
  for (const st of stops) {
    const [x, y] = [st.p[0] - ox, st.p[1] - oy];
    const ang = Math.atan2(st.dir[1], st.dir[0]);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const [L, W] = PLATFORM;
    const offsets = st.kind === 'boulevard' ? [-5, 5] : [0];
    for (const o of offsets) {
      ctx.fillStyle = '#f4f2ee';
      ctx.strokeStyle = KERB;
      ctx.lineWidth = px(0.8);
      ctx.beginPath();
      ctx.rect(-L / 2, o - W / 2, L, W);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d65a4e';
      ctx.fillRect(-4, o - W / 4, 8, W / 2);
    }
    ctx.restore();
  }
}
