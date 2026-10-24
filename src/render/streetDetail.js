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

// ---- Intersections ----
// Where along a street's section each part lies: its half-width, its kerb
// (the carriageway's edge), its cycle track's centre and width, and the
// furnishing strip between pavement and cycle track.
const radiiCache = new Map();
function radii(type) {
  let r = radiiCache.get(type);
  if (r) return r;
  const T = STREET_TYPES[type];
  const half = T.side.reduce((a, [, w]) => a + w, 0) + T.centre.reduce((a, [, w]) => a + w, 0) / 2;
  let at = half;
  let cycle = null;
  let furnishing = null;
  let clear = null;
  for (const [el, w] of T.side) {
    if (el === 'cycle' && !cycle) cycle = { r: at - w / 2, w };
    if (el === 'furnishing' && !furnishing && !cycle) furnishing = { r0: at, r1: at - w };
    if ((el === 'clearway' || el === 'frontage') && !cycle) clear = at - w;
    at -= w;
  }
  r = { half, kerb: carriageway(type), cycle, furnishing, clear: clear ?? half };
  radiiCache.set(type, r);
  return r;
}

const ZEBRA = '#ffffff';
const TABLE = '#e9e2d5'; // a raised table's paving
const SIGNAL = '#3b4046';

// A box centred at c, `l` long along u and `w` wide across it.
function box(ctx, c, u, l, w) {
  const v = [-u[1], u[0]];
  ctx.moveTo(c[0] + u[0] * l / 2 + v[0] * w / 2, c[1] + u[1] * l / 2 + v[1] * w / 2);
  ctx.lineTo(c[0] - u[0] * l / 2 + v[0] * w / 2, c[1] - u[1] * l / 2 + v[1] * w / 2);
  ctx.lineTo(c[0] - u[0] * l / 2 - v[0] * w / 2, c[1] - u[1] * l / 2 - v[1] * w / 2);
  ctx.lineTo(c[0] + u[0] * l / 2 - v[0] * w / 2, c[1] + u[1] * l / 2 - v[1] * w / 2);
  ctx.closePath();
}

// Zebra stripes across a carriageway: bars running with the traffic (u),
// side by side across it, from -k to k.
function zebra(ctx, c, u, k, depth = 3.6) {
  const v = [-u[1], u[0]];
  ctx.fillStyle = TABLE;
  ctx.beginPath();
  box(ctx, c, u, depth + 1.2, 2 * k);
  ctx.fill();
  ctx.fillStyle = ZEBRA;
  ctx.beginPath();
  for (let s = -k + 0.6; s <= k - 0.4; s += 1.2) box(ctx, [c[0] + v[0] * s, c[1] + v[1] * s], u, depth, 0.6);
  ctx.fill();
}

const lineHit = (p, d, q, e) => {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-6) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
};

export function drawIntersections(ctx, list, ox, oy, px) {
  if (!list) return;
  const P = (q) => [q[0] - ox, q[1] - oy];
  // Raised tables where local streets meet.
  ctx.fillStyle = TABLE;
  ctx.beginPath();
  for (const it of list) {
    if (it.kind !== 'raised') continue;
    const [x, y] = P(it.p);
    ctx.moveTo(x + 4.6, y);
    ctx.arc(x, y, 4.6, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.strokeStyle = KERB;
  ctx.lineWidth = Math.max(0.15, px(0.5));
  ctx.stroke();
  for (const it of list) {
    const c = P(it.p);
    if (it.kind === 'continuous') {
      // The local street's mouth: cars ramp up over the furnishing strip,
      // the pavement and cycle track run on across it.
      const R = radii(it.type);
      const n = [-it.t[1] * it.side, it.t[0] * it.side];
      const a = R.furnishing ? R.furnishing.r0 : R.clear;
      const b = R.kerb;
      const m = [c[0] + n[0] * (a + b) / 2, c[1] + n[1] * (a + b) / 2];
      ctx.fillStyle = COLOURS.shared;
      ctx.beginPath();
      box(ctx, m, it.t, 6.4, a - b);
      ctx.fill();
      if (R.cycle) {
        ctx.fillStyle = COLOURS.cycle;
        ctx.beginPath();
        box(ctx, [c[0] + n[0] * R.cycle.r, c[1] + n[1] * R.cycle.r], it.t, 6.4, R.cycle.w);
        ctx.fill();
      }
      // The ramp's edge, at the kerb.
      ctx.strokeStyle = KERB;
      ctx.lineWidth = Math.max(0.15, px(0.6));
      ctx.setLineDash([0.5, 0.5]);
      ctx.beginPath();
      const k0 = [c[0] + n[0] * b, c[1] + n[1] * b];
      ctx.moveTo(k0[0] - it.t[0] * 3.2, k0[1] - it.t[1] * 3.2);
      ctx.lineTo(k0[0] + it.t[0] * 3.2, k0[1] + it.t[1] * 3.2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (it.kind === 'crossing') {
      // A zebra over the main street, in line with the local streets' pavements.
      const R = radii(it.type);
      zebra(ctx, [c[0] + it.t[0] * 5, c[1] + it.t[1] * 5], it.t, R.kerb);
    } else if (it.kind === 'signal') {
      drawSignal(ctx, c, it.arms, px);
    }
  }
}

// A signalised junction: zebras on every arm, stop lines, signals, and the
// cycle tracks swung out round islands at the corners (a Dutch protected
// junction).
function drawSignal(ctx, c, arms, px) {
  const widest = Math.max(...arms.map((a) => radii(a.type).half));
  const S = widest + 3; // the crossings, clear of the junction box
  const n = (a) => [-a.dir[1], a.dir[0]];
  for (const a of arms) {
    const R = radii(a.type);
    const at = [c[0] + a.dir[0] * S, c[1] + a.dir[1] * S];
    zebra(ctx, at, a.dir, R.kerb);
    // Stop line on the side traffic comes in on.
    const N = n(a);
    const s0 = [c[0] + a.dir[0] * (S + 3.2), c[1] + a.dir[1] * (S + 3.2)];
    ctx.strokeStyle = ZEBRA;
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.moveTo(s0[0] + N[0] * 1.8, s0[1] + N[1] * 1.8);
    ctx.lineTo(s0[0] + N[0] * (R.cycle ? R.cycle.r - R.cycle.w / 2 - 0.6 : R.kerb), s0[1] + N[1] * (R.cycle ? R.cycle.r - R.cycle.w / 2 - 0.6 : R.kerb));
    ctx.stroke();
  }
  // Corners: each arm's left side to the next arm's right side.
  for (let i = 0; i < arms.length; i++) {
    const A = arms[i];
    const B = arms[(i + 1) % arms.length];
    const RA = radii(A.type);
    const RB = radii(B.type);
    if (!RA.cycle || !RB.cycle) continue;
    const nA = n(A);
    const nB = n(B);
    // (Only round corners less than a straight line.)
    if (A.dir[0] * B.dir[1] - A.dir[1] * B.dir[0] <= 0.2) continue;
    const SA = S + 4.5;
    const at = (dir, nn, s, r) => [c[0] + dir[0] * s + nn[0] * r, c[1] + dir[1] * s + nn[1] * r];
    const a0 = at(A.dir, nA, SA, RA.cycle.r);
    const b0 = at(B.dir, nB, SA, -RB.cycle.r);
    const ctrl = lineHit(a0, A.dir, b0, B.dir);
    if (!ctrl) continue;
    // The corner island, between the carriageways' kerbs and the track.
    const ai = at(A.dir, nA, SA, RA.cycle.r - RA.cycle.w / 2 - 0.4);
    const bi = at(B.dir, nB, SA, -(RB.cycle.r - RB.cycle.w / 2 - 0.4));
    const ci = lineHit(ai, A.dir, bi, B.dir);
    const ak = at(A.dir, nA, SA, RA.kerb + 0.3);
    const bk = at(B.dir, nB, SA, -(RB.kerb + 0.3));
    const ck = lineHit(ak, A.dir, bk, B.dir);
    if (!ci || !ck) continue;
    const kc = [(ck[0] * 2 + c[0]) / 3, (ck[1] * 2 + c[1]) / 3];
    ctx.fillStyle = COLOURS.clearway;
    ctx.strokeStyle = KERB;
    ctx.lineWidth = Math.max(0.15, px(0.6));
    ctx.beginPath();
    ctx.moveTo(ak[0], ak[1]);
    ctx.lineTo(ai[0], ai[1]);
    ctx.quadraticCurveTo(ci[0], ci[1], bi[0], bi[1]);
    ctx.lineTo(bk[0], bk[1]);
    ctx.quadraticCurveTo(kc[0], kc[1], ak[0], ak[1]);
    ctx.fill();
    ctx.stroke();
    // The cycle track round it.
    ctx.lineCap = 'butt';
    ctx.strokeStyle = KERB;
    ctx.lineWidth = RA.cycle.w + 0.5;
    ctx.beginPath();
    ctx.moveTo(a0[0], a0[1]);
    ctx.quadraticCurveTo(ctrl[0], ctrl[1], b0[0], b0[1]);
    ctx.stroke();
    ctx.strokeStyle = COLOURS.cycle;
    ctx.lineWidth = RA.cycle.w;
    ctx.stroke();
    ctx.lineCap = 'round';
    // A signal head on the island.
    ctx.fillStyle = SIGNAL;
    ctx.beginPath();
    ctx.arc(ak[0] * 0.5 + bk[0] * 0.5, ak[1] * 0.5 + bk[1] * 0.5, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}
