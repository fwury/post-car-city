// Streets drawn to scale close in: each street's cross-section, from the
// building line in (pavement, tree strip, cycle track, kerb, traffic lane,
// tram tracks, planted median), as strokes one inside another along its
// centreline; then each junction laid out as the street and intersection
// spec has it (see junctions.js), drawn over the streets' sections; the
// tram platforms; the rails; and the markings, kerbs, signals and bollards.

import { STREET_TYPES } from '../world/streetTypes.js';
import { profile } from '../world/junctions.js';

export const DETAIL_MIN_ZOOM = 1.1;
const RAIL_GAUGE = 1.435;

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

// ---- Junctions ----

const ZEBRA_WHITE = '#ffffff';
const TABLE = '#e9e2d5'; // a raised table's paving
const PLATEAU = '#ebe6dc'; // a flush junction's paving
const PLATEAU_MARK = '#ddd6c9';
const TACTILE = '#e2c46a';
const SIGNAL = '#3b4046';
const BOLLARD = '#5b6168';
const REMOVABLE = '#c8743c'; // a removable bollard (for emergency vehicles)
const PLATFORM_FILL = '#f4f2ee';
const SHELTER = '#d65a4e';
const REFUGE = new Set(['median', 'buffer', 'furnishing', 'planted']);
const KERB_RADIUS = { boulevard: 7, mainStreet: 5.5, coreMainStreet: 5.5, coreCrossStreet: 3, coreCrossStreetNarrow: 3 };

// A point of an arm's frame: `along` out from the junction, `lat` to its right.
const F = (c, a, along, lat) => [c[0] + a.dir[0] * along + a.n[0] * lat, c[1] + a.dir[1] * along + a.n[1] * lat];
const meet = (p, d, q, e) => {
  const den = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(den) < 1e-6) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
};
function poly(ctx, pts) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
// A band across an arm: along [a0, a1], lateral [l0, l1].
const band = (c, a, a0, a1, l0, l1) => [F(c, a, a0, l0), F(c, a, a1, l0), F(c, a, a1, l1), F(c, a, a0, l1)];
function fillBand(ctx, c, a, a0, a1, l0, l1, colour) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  poly(ctx, band(c, a, a0, a1, l0, l1));
  ctx.fill();
}
// A street's bands across its whole width: [from, to, element], -half to half.
function across(type) {
  const P = profile(type);
  const out = [];
  for (const [a, b, el] of P.bands) {
    out.push([a, b, el]);
    out.push([-b, -a, el]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

// Zebra stripes over [a0, a1] along an arm, across lateral [-e, e]: bars
// running with the traffic, 0.6 m wide; refuges (medians, buffers, tree
// strips) cut through at pavement level with tactile edges; over tram
// lanes, a marked track crossing (edge lines only, the rails left clear).
function zebraAcross(ctx, c, a, a0, a1, e, type) {
  const bands = type ? across(type).filter(([x, y]) => y > -e - 0.01 && x < e + 0.01) : [[-e, e, 'shared']];
  for (const [x, y, el] of bands) {
    const l0 = Math.max(-e, x);
    const l1 = Math.min(e, y);
    if (l1 - l0 < 0.05) continue;
    if (REFUGE.has(el)) {
      fillBand(ctx, c, a, a0, a1, l0, l1, COLOURS.clearway);
      fillBand(ctx, c, a, a0, a0 + 0.6, l0, l1, TACTILE);
      fillBand(ctx, c, a, a1 - 0.6, a1, l0, l1, TACTILE);
      continue;
    }
    fillBand(ctx, c, a, a0, a1, l0, l1, COLOURS[el] || COLOURS.drive);
    if (el === 'tram') {
      ctx.strokeStyle = ZEBRA_WHITE;
      ctx.lineWidth = 0.2;
      ctx.setLineDash([0.6, 0.6]);
      ctx.beginPath();
      for (const al of [a0 + 0.1, a1 - 0.1]) {
        const p = F(c, a, al, l0);
        const q = F(c, a, al, l1);
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    ctx.fillStyle = ZEBRA_WHITE;
    ctx.beginPath();
    for (let l = l0 + 0.3; l + 0.6 <= l1 - 0.2; l += 1.2) poly(ctx, band(c, a, a0 + 0.2, a1 - 0.2, l, l + 0.6));
    ctx.fill();
  }
  // Tactile paving at both ends.
  fillBand(ctx, c, a, a0, a1, -e - 0.6, -e, TACTILE);
  fillBand(ctx, c, a, a0, a1, e, e + 0.6, TACTILE);
}

// A marked cycle crossing over [a0, a1] along an arm, lateral [l0, l1]:
// the cycle surface with square "elephant's feet" along both edges.
function cycleCrossing(ctx, c, a, a0, a1, l0, l1) {
  fillBand(ctx, c, a, a0, a1, l0, l1, COLOURS.cycle);
  ctx.fillStyle = ZEBRA_WHITE;
  ctx.beginPath();
  for (let l = l0 + 0.1; l + 0.5 <= l1; l += 1.0) {
    poly(ctx, band(c, a, a0, a0 + 0.5, l, l + 0.5));
    poly(ctx, band(c, a, a1 - 0.5, a1, l, l + 0.5));
  }
  ctx.fill();
}

// Give-way triangles ("shark's teeth") along lateral [l0, l1] at `along`,
// pointing back (-1) or out (1) along the arm.
function giveWay(ctx, c, a, along, l0, l1, way = -1) {
  ctx.fillStyle = ZEBRA_WHITE;
  ctx.beginPath();
  for (let l = l0 + 0.3; l + 0.6 <= l1; l += 0.9) {
    const b0 = F(c, a, along, l);
    const b1 = F(c, a, along, l + 0.6);
    const tip = F(c, a, along + way * 0.7, l + 0.3);
    ctx.moveTo(b0[0], b0[1]);
    ctx.lineTo(b1[0], b1[1]);
    ctx.lineTo(tip[0], tip[1]);
    ctx.closePath();
  }
  ctx.fill();
}

// A line of bollards from p to q about `gap` apart; those within `keep` of
// the middle removable (for emergency vehicles).
function bollards(ctx, p, q, gap, keep, px) {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const n = Math.max(1, Math.round(L / gap));
  const r = Math.max(0.2, px(1.2));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const x = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    ctx.fillStyle = Math.abs(t - 0.5) * L <= keep ? REMOVABLE : BOLLARD;
    ctx.beginPath();
    ctx.arc(x[0], x[1], r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function signal(ctx, p, px) {
  ctx.fillStyle = SIGNAL;
  ctx.beginPath();
  ctx.arc(p[0], p[1], Math.max(0.35, px(1.3)), 0, Math.PI * 2);
  ctx.fill();
}

// Where a crossing meets its corner: the lateral at which the ring of
// cycle track joins an arm (its cycle lane, else just off its carriageway).
const ringLat = (a) => {
  const P = profile(a.type);
  return P.cycle ? P.cycle.r : P.drive + 1.5;
};

// The kerb round a corner between arm A (its +n side) and arm B (its -n
// side), from A's carriageway edge at alA to B's at alB.
function kerbCorner(c, A, B, alA, alB) {
  const dA = profile(A.type).drive;
  const dB = profile(B.type).drive;
  const pA = F(c, A, alA, dA);
  const pB = F(c, B, alB, -dB);
  const K = meet(F(c, A, 0, dA), A.dir, F(c, B, 0, -dB), B.dir);
  if (!K) return { pA, pB, curve: [pA, pB] };
  const r = Math.max(KERB_RADIUS[A.type] || 2, KERB_RADIUS[B.type] || 2);
  const toward = (p, q, d) => {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const k = Math.min(d, L * 0.9) / L;
    return [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
  };
  const a1 = toward(K, pA, r);
  const b1 = toward(K, pB, r);
  const curve = [pA, a1];
  for (let t = 0.2; t < 1; t += 0.2) {
    const m = (1 - t) * (1 - t);
    const n = 2 * t * (1 - t);
    const o = t * t;
    curve.push([m * a1[0] + n * K[0] + o * b1[0], m * a1[1] + n * K[1] + o * b1[1]]);
  }
  curve.push(b1, pB);
  return { pA, pB, curve };
}

// The ground of each junction (before platforms and rails).
// (Only those in view: inView(p) on a junction's point, in world coordinates.)
export function drawJunctionGround(ctx, list, ox, oy, px, inView = () => true) {
  if (!list) return;
  for (const j of list) {
    if (!inView(j.p)) continue;
    const c = [j.p[0] - ox, j.p[1] - oy];
    if (j.kind === 'D') protectedGround(ctx, c, j, px);
    else if (j.kind === 'GREEN') {
      const m = j.arms.find((a) => a.type !== 'rail');
      if (m) fillBand(ctx, c, m, -GREEN_HALF, GREEN_HALF, -profile(m.type).edge, profile(m.type).edge, COLOURS.drive);
    } else if (j.kind === 'CONT' || j.kind === 'CONT_CORE' || j.kind === 'PED') continuousGround(ctx, c, j, px);
    else if (j.kind === 'TABLE') plateau(ctx, c, j, TABLE, 3.5);
    else if (j.kind === 'FLUSH') plateau(ctx, c, j, PLATEAU, 2.5);
    else if (j.kind === 'LANE') laneMouth(ctx, c, j, ox, oy);
  }
}

// The markings, kerbs, signals and bollards of each junction (after the rails).
export function drawJunctionMarks(ctx, list, ox, oy, px, inView = () => true) {
  if (!list) return;
  for (const j of list) {
    if (!inView(j.p)) continue;
    const c = [j.p[0] - ox, j.p[1] - oy];
    if (j.kind === 'D') protectedMarks(ctx, c, j, px);
    else if (j.kind === 'GREEN') greenCrossing(ctx, c, j, px);
    else if (j.kind === 'XING') signalisedZebra(ctx, c, j, px);
    else if (j.kind === 'ZEBRA') zebraAcross(ctx, c, j.arms[0], -2, 2, profile(j.arms[0].type).edge, j.arms[0].type);
    else if (j.kind === 'GREEN_FLUSH') greenFlush(ctx, c, j);
    else if (j.kind === 'CONT' || j.kind === 'CONT_CORE') continuousMarks(ctx, c, j);
    else if (j.kind === 'PED') pedestrianEnd(ctx, c, j, px);
    else if (j.kind === 'PED_FLUSH') pedestrianFlush(ctx, c, j, px);
    else if (j.kind === 'TABLE') tableMarks(ctx, c, j);
    else if (j.kind === 'FLUSH' && j.filter) {
      const d = [-j.filter[1], j.filter[0]];
      bollards(ctx, [c[0] - d[0] * 7, c[1] - d[1] * 7], [c[0] + d[0] * 7, c[1] + d[1] * 7], 1.5, 0.8, px);
    } else if (j.kind === 'LANE') {
      const a = j.arms[0];
      bollards(ctx, F(c, a, 1.0, -2), F(c, a, 1.0, 2), 1.0, 0.4, px);
    }
  }
}

// ---- A signalised, protected junction ----
function corners(j) {
  const out = [];
  const n = j.arms.length;
  for (let i = 0; i < n; i++) {
    const A = j.arms[i];
    const B = j.arms[(i + 1) % n];
    // (Only corners less than a straight line round.)
    if (A.dir[0] * B.dir[1] - A.dir[1] * B.dir[0] <= 0.17) continue;
    out.push([A, B]);
  }
  return out;
}

function protectedGround(ctx, c, j, px) {
  const arms = j.arms;
  // The junction box: each arm's carriageway out to its crossings, kerbed
  // round the corners.
  const ring = [];
  for (let i = 0; i < arms.length; i++) {
    const A = arms[i];
    const B = arms[(i + 1) % arms.length];
    const dA = profile(A.type).drive;
    ring.push(F(c, A, A.zebra, -dA));
    if (A.dir[0] * B.dir[1] - A.dir[1] * B.dir[0] > 0.17) ring.push(...kerbCorner(c, A, B, A.zebra, B.zebra).curve);
    else ring.push(F(c, A, A.zebra, dA), F(c, B, B.zebra, -profile(B.type).drive));
  }
  ctx.fillStyle = COLOURS.drive;
  ctx.beginPath();
  poly(ctx, ring);
  ctx.fill();
  // Corner islands, between the kerbs and the crossings, and the cycle
  // track round each: in from one crossing, round the island, out over the
  // next.
  for (const [A, B] of corners(j)) {
    const k = kerbCorner(c, A, B, A.s, B.s);
    const inner = meet(F(c, A, A.s, 0), A.n, F(c, B, B.s, 0), B.n);
    if (!inner) continue;
    ctx.fillStyle = COLOURS.clearway;
    ctx.strokeStyle = KERB;
    ctx.lineWidth = Math.max(0.15, px(0.7));
    ctx.beginPath();
    poly(ctx, [...k.curve, inner]);
    ctx.fill();
    ctx.stroke();
    const mid = meet(F(c, A, A.s + A.cw / 2, 0), A.n, F(c, B, B.s + B.cw / 2, 0), B.n);
    if (!mid) continue;
    const pA = F(c, A, A.s + A.cw / 2, ringLat(A));
    const pB = F(c, B, B.s + B.cw / 2, -ringLat(B));
    ctx.lineCap = 'butt';
    for (const [colour, w] of [[KERB, Math.min(A.cw, B.cw) + 0.5], [COLOURS.cycle, Math.min(A.cw, B.cw)]]) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(pA[0], pA[1]);
      ctx.lineTo(mid[0], mid[1]);
      ctx.lineTo(pB[0], pB[1]);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
  }
}

function protectedMarks(ctx, c, j, px) {
  for (const a of j.arms) {
    const P = profile(a.type);
    const e = P.flush ? P.half : P.edge;
    // The cycle crossing (nearer), then the zebra beside it (farther).
    cycleCrossing(ctx, c, a, a.s, a.s + a.cw, -ringLat(a), ringLat(a));
    zebraAcross(ctx, c, a, a.s + a.cw, a.zebra, e, P.flush ? null : a.type);
    // Stop lines 1 m outside the zebra, across the lanes coming in (on
    // their right: here, the -n side), for cars and for bikes.
    if (!P.flush) {
      ctx.fillStyle = ZEBRA_WHITE;
      ctx.beginPath();
      poly(ctx, band(c, a, a.stop, a.stop + 0.4, -P.drive, -P.drive + 3.0));
      if (P.cycle) poly(ctx, band(c, a, a.stop, a.stop + 0.4, -P.cycle.outer, -P.cycle.outer + P.cycle.w));
      ctx.fill();
    } else {
      // A flush street ramps down to the carriageway outside its crossings.
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      for (let l = -P.drive + 0.3; l < P.drive - 0.5; l += 1.0) {
        const b0 = F(c, a, a.stop + 0.6, l);
        const b1 = F(c, a, a.stop + 0.6, l + 0.6);
        const tip = F(c, a, a.stop, l + 0.3);
        ctx.moveTo(b0[0], b0[1]);
        ctx.lineTo(b1[0], b1[1]);
        ctx.lineTo(tip[0], tip[1]);
        ctx.closePath();
      }
      ctx.fill();
    }
    // Signals on the refuges.
    for (const [x, y, el] of across(a.type)) if (REFUGE.has(el) && Math.abs((x + y) / 2) < P.drive) signal(ctx, F(c, a, a.zebra + 0.4, (x + y) / 2), px);
  }
  // Signal poles on the corner islands.
  for (const [A, B] of corners(j)) {
    const k = kerbCorner(c, A, B, A.s, B.s);
    signal(ctx, k.curve[Math.floor(k.curve.length / 2)], px);
  }
}

// ---- A side street meeting a tram street (or a core street) unsignalised ----
// The major street's arms, and the side street arms on either side of it.
function majorArms(j) {
  const rank = (t) => ({ boulevard: 1, mainStreet: 2, coreMainStreet: 2, coreCrossStreet: 3, coreCrossStreetNarrow: 3 })[t] || 9;
  const top = Math.min(...j.arms.map((a) => rank(a.type)));
  const majors = j.arms.filter((a) => rank(a.type) === top);
  const sides = j.arms.filter((a) => rank(a.type) !== top);
  return { m: majors[0], majors, sides };
}

function continuousGround(ctx, c, j) {
  const { m, sides } = majorArms(j);
  if (!m) return;
  const P = profile(m.type);
  for (const a of sides) {
    const sg = Math.sign(a.dir[0] * m.n[0] + a.dir[1] * m.n[1]) || 1;
    const w = j.kind === 'PED' ? 3.0 : profile(a.type).drive;
    const L = (l0, l1) => [sg * l0, sg * l1].sort((x, y) => x - y);
    for (const [x, y, el] of P.bands) {
      const [l0, l1] = L(x, y);
      if (el === 'clearway' || el === 'frontage') fillBand(ctx, c, m, -w - 1, w + 1, l0, l1, COLOURS.clearway);
      else if (el === 'cycle') fillBand(ctx, c, m, -w - 1, w + 1, l0, l1, COLOURS.cycle);
      else if (el === 'furnishing') fillBand(ctx, c, m, -w, w, l0, l1, j.kind === 'PED' ? COLOURS.cycle : COLOURS.clearway);
      else if (el === 'buffer' && j.kind !== 'PED') fillBand(ctx, c, m, -w, w, l0, l1, COLOURS.shared);
    }
  }
}

function continuousMarks(ctx, c, j) {
  const { m, sides } = majorArms(j);
  if (!m) return;
  const P = profile(m.type);
  let w = 0;
  for (const a of sides) {
    const sg = Math.sign(a.dir[0] * m.n[0] + a.dir[1] * m.n[1]) || 1;
    w = Math.max(w, profile(a.type).drive);
    const aw = profile(a.type).drive;
    // Cars ramp up over the buffer gap (marked at the carriageway's edge)
    // and give way at the cycle lane.
    if (P.cycle) {
      const edge = sg > 0 ? P.cycle.outer : -P.cycle.outer;
      ctx.save();
      giveWayAlong(ctx, c, m, -aw, aw, edge, -sg);
      ctx.restore();
    }
    ctx.strokeStyle = KERB;
    ctx.lineWidth = 0.25;
    ctx.setLineDash([0.4, 0.4]);
    ctx.beginPath();
    const k0 = F(c, m, -aw, sg * P.drive);
    const k1 = F(c, m, aw, sg * P.drive);
    ctx.moveTo(k0[0], k0[1]);
    ctx.lineTo(k1[0], k1[1]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // A zebra over the major street beside the mouth (on its far side).
  // (Not where a tram platform runs past the mouth.)
  if (j.kind === 'CONT' && !j.platform) zebraAcross(ctx, c, m, w + 1.5, w + 1.5 + 4.0, P.edge, m.type);
}

// Give-way triangles along an arm from a0 to a1 at lateral `lat`, pointing
// across it (toward -n * way... way sets which side they face).
function giveWayAlong(ctx, c, a, a0, a1, lat, way) {
  ctx.fillStyle = ZEBRA_WHITE;
  ctx.beginPath();
  for (let al = a0 + 0.3; al + 0.6 <= a1; al += 0.9) {
    const b0 = F(c, a, al, lat);
    const b1 = F(c, a, al + 0.6, lat);
    const tip = F(c, a, al + 0.3, lat + way * 0.7);
    ctx.moveTo(b0[0], b0[1]);
    ctx.lineTo(b1[0], b1[1]);
    ctx.lineTo(tip[0], tip[1]);
    ctx.closePath();
  }
  ctx.fill();
}

// A pedestrian street ending at a tram street: the pavement runs on; the
// street's double bike lane crosses it (marked, cyclists giving way to
// people walking) through a gap in the furnishing zone to the cycle lane;
// a line of bollards on the furnishing zone's line.
function pedestrianEnd(ctx, c, j, px) {
  const { m, sides } = majorArms(j);
  if (!m) return;
  const P = profile(m.type);
  // (The furnishing zone just outside the cycle lane.)
  const furn = P.cycle && P.bands.find(([a, , el]) => el === 'furnishing' && a >= P.cycle.outer - 0.01);
  for (const a of sides) {
    const sg = Math.sign(a.dir[0] * m.n[0] + a.dir[1] * m.n[1]) || 1;
    const clear = P.bands.filter(([, , el]) => el === 'clearway' || el === 'frontage');
    const c0 = Math.min(...clear.map((b) => b[0]));
    // The bike lanes' crossing of the pavement.
    const [l0, l1] = [sg * c0, sg * P.half].sort((x, y) => x - y);
    cycleCrossing(ctx, c, { dir: m.n, n: [-m.n[1], m.n[0]] }, l0, l1, -3, 3);
    giveWayAlong(ctx, c, m, -3, 3, sg * P.half, -sg);
    if (furn) {
      const lat = sg * (furn[0] + furn[1]) / 2;
      bollards(ctx, F(c, m, -9, lat), F(c, m, 9, lat), 1.5, 3, px);
    }
  }
}

// A pedestrian street meeting a local street: a change of paving and a
// line of bollards, the bike lane carrying on.
function pedestrianFlush(ctx, c, j, px) {
  for (const a of j.arms) {
    if (a.type !== 'pedestrianStreet') continue;
    const other = j.arms.find((b) => b.type !== 'pedestrianStreet');
    const at = other ? profile(other.type).half + 1 : 8;
    bollards(ctx, F(c, a, at, -9), F(c, a, at, 9), 1.5, 3, px);
  }
}

// A raised table (or a flush plateau): the junction paved over, a little
// beyond each arm's width.
function plateau(ctx, c, j, colour, extra) {
  const r = Math.max(...j.arms.map((a) => profile(a.type).drive)) + extra + 3;
  ctx.fillStyle = colour;
  ctx.beginPath();
  const pts = [];
  for (const a of j.arms) pts.push(F(c, a, r, -profile(a.type).drive - extra), F(c, a, r, profile(a.type).drive + extra));
  pts.sort((p, q) => Math.atan2(p[1] - c[1], p[0] - c[0]) - Math.atan2(q[1] - c[1], q[0] - c[0]));
  poly(ctx, pts);
  ctx.fill();
  if (colour === PLATEAU) {
    // Its paving laid in a pattern of its own.
    ctx.strokeStyle = PLATEAU_MARK;
    ctx.lineWidth = 0.12;
    ctx.save();
    ctx.beginPath();
    poly(ctx, pts);
    ctx.clip();
    ctx.beginPath();
    for (let k = -2 * r; k <= 2 * r; k += 1.2) {
      ctx.moveTo(c[0] + k - r, c[1] - r);
      ctx.lineTo(c[0] + k + r, c[1] + r);
    }
    ctx.stroke();
    ctx.restore();
  }
}

function tableMarks(ctx, c, j) {
  for (const a of j.arms) {
    const P = profile(a.type);
    const others = j.arms.filter((b) => b !== a && Math.abs(a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1]) < 0.85);
    const reach = Math.max(3, ...others.map((b) => profile(b.type).edge)) + 1;
    // Cycle crossings in line with the other street's lanes, zebras outside them.
    cycleCrossing(ctx, c, a, reach, reach + 2.1, -P.drive, P.drive);
    zebraAcross(ctx, c, a, reach + 2.1, reach + 6.1, P.edge, a.type);
    // Ramp marks on the carriageway just outside.
    giveWay(ctx, c, a, reach + 7.2, -P.drive, P.drive, 1);
  }
}

// ---- Greenways ----
const GREEN_HALF = 4.0; // the cycle crossing and the zebra, 4 m each, side by side
function greenCrossing(ctx, c, j, px) {
  const m = j.arms.find((a) => a.type !== 'rail');
  if (!m) return;
  const P = profile(m.type);
  cycleCrossing(ctx, c, m, -GREEN_HALF, 0, -P.edge, P.edge);
  zebraAcross(ctx, c, m, 0, GREEN_HALF, P.edge, m.type);
  // Stop lines either way, signals at the edges.
  ctx.fillStyle = ZEBRA_WHITE;
  ctx.beginPath();
  poly(ctx, band(c, m, GREEN_HALF + 1, GREEN_HALF + 1.4, -P.drive, -P.drive + 3));
  poly(ctx, band(c, m, -GREEN_HALF - 1.4, -GREEN_HALF - 1, P.drive - 3, P.drive));
  ctx.fill();
  signal(ctx, F(c, m, 0, P.edge + 1), px);
  signal(ctx, F(c, m, 0, -P.edge - 1), px);
}
// A signalised zebra on its own, with stop lines either way.
function signalisedZebra(ctx, c, j, px) {
  const m = j.arms[0];
  const P = profile(m.type);
  zebraAcross(ctx, c, m, -2, 2, P.edge, m.type);
  ctx.fillStyle = ZEBRA_WHITE;
  ctx.beginPath();
  poly(ctx, band(c, m, 3, 3.4, -P.drive, -P.drive + 3));
  poly(ctx, band(c, m, -3.4, -3, P.drive - 3, P.drive));
  ctx.fill();
  signal(ctx, F(c, m, 0, P.edge + 1), px);
  signal(ctx, F(c, m, 0, -P.edge - 1), px);
}
function greenFlush(ctx, c, j) {
  for (const a of j.arms) {
    if (a.type === 'rail') continue;
    const P = profile(a.type);
    // The path's crossing marked on the street's surface, cars giving way.
    const m = { dir: [-a.dir[1], a.dir[0]], n: a.dir };
    cycleCrossing(ctx, c, m, -GREEN_HALF, 0, P.half * 0.2, P.half);
    zebraAcross(ctx, c, m, 0, GREEN_HALF, P.drive, null);
    giveWay(ctx, c, a, P.half + 0.8, -P.drive, P.drive, 1);
    break;
  }
}

// ---- Laneways ----
// Its mouth: the local street's furnishing zone opened 7 m wide, the
// pavement running flush across.
function laneMouth(ctx, c, j, ox, oy) {
  const f = [j.foot[0] - ox, j.foot[1] - oy];
  const t = j.street;
  const n0 = [c[0] - f[0], c[1] - f[1]];
  const l = Math.hypot(n0[0], n0[1]) || 1;
  const nn = [n0[0] / l, n0[1] / l];
  const a = { dir: t, n: nn };
  const P = profile('localStreet');
  const furn = P.bands.find(([, , el]) => el === 'furnishing');
  if (furn) fillBand(ctx, f, a, -3.5, 3.5, furn[0], furn[1], COLOURS.clearway);
}

// ---- Tram platforms ----
// On a main street, one island platform over the median (the tracks never
// shift); on a boulevard, a side platform for each direction in place of
// the tree buffer, with a railing on its kerb strip. Each with a tactile
// strip along its tram edges, a shelter, and a ramp at its junction end.
export function drawPlatforms(ctx, stops, ox, oy, px, inView = () => true) {
  for (const st of stops || []) {
    if (!inView(st.p)) continue;
    const c = [st.p[0] - ox, st.p[1] - oy];
    const a = { dir: st.dir, n: [-st.dir[1], st.dir[0]] };
    const h = st.length / 2;
    fillBand(ctx, c, a, -h, h, st.from, st.to, PLATFORM_FILL);
    ctx.strokeStyle = KERB;
    ctx.lineWidth = Math.max(0.15, px(0.7));
    ctx.beginPath();
    poly(ctx, band(c, a, -h, h, st.from, st.to));
    ctx.stroke();
    // Tactile strips along the edges trams stop at.
    const edges = st.kind === 'island' ? [st.from, st.to - 0.5] : [st.from];
    for (const e of edges) fillBand(ctx, c, a, -h + 3.6, h, e, e + 0.5, TACTILE);
    // The ramp at the end nearest the junction.
    ctx.strokeStyle = KERB;
    ctx.lineWidth = 0.15;
    ctx.beginPath();
    for (let k = 0.6; k < 3.6; k += 0.6) {
      const p = F(c, a, -h + k, st.from);
      const q = F(c, a, -h + k, st.to);
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
    }
    ctx.stroke();
    // The shelter: along the middle of an island; on a side platform,
    // along its traffic side.
    const [s0, s1] = st.kind === 'island' ? [-0.7, 0.7] : [st.to - 1.4, st.to - 0.3];
    fillBand(ctx, c, a, -6, 6, s0, s1, SHELTER);
    if (st.kind === 'side') {
      ctx.strokeStyle = SIGNAL;
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      const p = F(c, a, -h, st.to + 0.2);
      const q = F(c, a, h, st.to + 0.2);
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.stroke();
    }
  }
}
