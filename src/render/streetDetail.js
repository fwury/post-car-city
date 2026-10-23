// Streets drawn to scale close in: each street's cross-section, from the
// building line in (pavement, tree strip, cycle track, kerb, traffic lane,
// tram tracks, planted median), as strokes one inside another along its
// centreline; then the rails, the trees, the paving over junctions, and the
// tram stops' platforms.

import { STREET_TYPES } from '../world/streetTypes.js';

export const DETAIL_MIN_ZOOM = 1.1;
const TREE_SPACING = 11; // metres between street trees
const TREE_R = 2.6; // canopy radius
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

// Rails and tree positions for one street centreline, kept by its points.
const extrasCache = new WeakMap();
export function streetExtras(P, type, avoid) {
  let e = extrasCache.get(P);
  if (e) return e;
  const f = sectionFeatures(type);
  const rails = [];
  for (const c of f.tram) for (const g of [-RAIL_GAUGE / 2, RAIL_GAUGE / 2]) rails.push(offsetLine(P, c + g));
  const trees = [];
  for (const side of [1, -1]) {
    for (const r of f.trees) {
      const L = offsetLine(P, side * r);
      let carry = TREE_SPACING / 2;
      for (let i = 0; i < L.length - 1; i++) {
        const a = L[i];
        const b = L[i + 1];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        let s = carry;
        while (s < l) {
          const q = [a[0] + ((b[0] - a[0]) * s) / l, a[1] + ((b[1] - a[1]) * s) / l];
          if (!avoid(q)) trees.push(q);
          s += TREE_SPACING;
        }
        carry = s - l;
      }
    }
  }
  e = { rails, trees };
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

export function drawTrees(ctx, trees, ox, oy, px) {
  if (!trees.length) return;
  const path = new Path2D();
  for (const [x, y] of trees) {
    // Not all the same size: a little bigger or smaller by where they stand.
    const r = TREE_R * (0.85 + 0.3 * (((Math.floor(x * 7.13) ^ Math.floor(y * 3.71)) & 15) / 15));
    path.moveTo(x - ox + r, y - oy);
    path.arc(x - ox, y - oy, r, 0, Math.PI * 2);
  }
  ctx.fillStyle = '#a9cf94';
  ctx.fill(path);
  ctx.strokeStyle = 'rgba(70, 110, 60, 0.35)';
  ctx.lineWidth = px(0.6);
  ctx.stroke(path);
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

// Street trees along local and pedestrian streets in a chunk: in the tree
// strip each side, kept clear of junctions and of street ends.
export function localTrees(segs) {
  const key = (p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
  const degree = new Map();
  for (const { a, c } of segs) for (const p of [a, c]) degree.set(key(p), (degree.get(key(p)) || 0) + 1);
  const ends = [];
  for (const { a, c } of segs) for (const p of [a, c]) if (degree.get(key(p)) !== 2) ends.push(p);
  const out = [];
  for (const { kind, a, c } of segs) {
    const type = kind === 'pedestrian' ? 'pedestrianStreet' : 'localStreet';
    const f = sectionFeatures(type);
    if (!f.trees.length) continue;
    const dx = c[0] - a[0];
    const dy = c[1] - a[1];
    const l = Math.hypot(dx, dy);
    if (l < 1) continue;
    const n = [-dy / l, dx / l];
    // Trees on a common grid along x+y, so neighbouring segments line up.
    for (let s = TREE_SPACING / 2; s < l; s += TREE_SPACING) {
      const p = [a[0] + (dx * s) / l, a[1] + (dy * s) / l];
      if (ends.some((e) => Math.abs(e[0] - p[0]) < 14 && Math.abs(e[1] - p[1]) < 14)) continue;
      for (const side of [1, -1]) out.push([p[0] + n[0] * side * f.trees[0], p[1] + n[1] * side * f.trees[0]]);
    }
  }
  return out;
}
