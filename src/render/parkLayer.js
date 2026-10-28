// Draws what is in parks and school grounds (stage 5): woods, paths,
// pitches and courts with their markings, playgrounds, water and gardens.

export const PARK_DETAIL_ZOOM = 0.45; // features and paths from here

const FILL = {
  playground: '#f1dcae', splash: '#a9d9f2', skate: '#d9d6d0', court: '#8fb3cf', basketball: '#d99a73', tennis: '#6fa77c',
  pitch: '#93c97f', track: '#d4846a', trackField: '#93c97f', dogRun: '#d6e5c4', dogPark: '#d6e5c4', gardens: '#c4d9a2',
  washroom: '#d8d0c3', kiosk: '#e3c7a5', fountain: '#a9d9f2', statue: '#b7b2aa', pond: '#9fcff2', pool: '#e6e0d4',
  cemetery: '#cfe0c1', plaza: '#f1ece2', fairground: '#ece3d3', zoo: '#c9ddb0',
};
const WOODS = '#b4d59b';
const MARKED = new Set(['pitch', 'tennis', 'basketball', 'court', 'trackField']);
const FENCED = new Set(['dogRun', 'dogPark', 'gardens', 'cemetery', 'zoo', 'fairground']);

const cache = new WeakMap();

function addPoly(path, pts, ox, oy) {
  path.moveTo(pts[0][0] - ox, pts[0][1] - oy);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0] - ox, pts[i][1] - oy);
  path.closePath();
}
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// Paths for one layout (cached by the layout object).
export function layoutPaths(layout, ox, oy) {
  let p = cache.get(layout);
  if (p) return p;
  p = { kinds: new Map(), woods: new Path2D(), lines: new Path2D(), fences: new Path2D(), paths: new Map(), pool: new Path2D(), headstones: new Path2D() };
  const kind = (k) => {
    if (!p.kinds.has(k)) p.kinds.set(k, new Path2D());
    return p.kinds.get(k);
  };
  for (const f of layout.features) {
    // (Woods lie under the paths running through them.)
    if (f.kind === 'woods') {
      addPoly(p.woods, f.pts, ox, oy);
      continue;
    }
    if (f.pts) {
      addPoly(kind(f.kind), f.pts, ox, oy);
      if (FENCED.has(f.kind)) addPoly(p.fences, f.pts, ox, oy);
      if (MARKED.has(f.kind) && f.pts.length === 4) {
        // Touchlines, the halfway line or net, and a centre circle.
        const [a, b, c, d] = f.pts;
        addPoly(p.lines, f.pts, ox, oy);
        const m1 = mid(a, b);
        const m2 = mid(c, d);
        p.lines.moveTo(m1[0] - ox, m1[1] - oy);
        p.lines.lineTo(m2[0] - ox, m2[1] - oy);
        if (f.kind === 'pitch') {
          const m = mid(m1, m2);
          const r = Math.min(9.15, Math.hypot(a[0] - d[0], a[1] - d[1]) * 0.15);
          p.lines.moveTo(m[0] - ox + r, m[1] - oy);
          p.lines.arc(m[0] - ox, m[1] - oy, r, 0, Math.PI * 2);
        }
      }
      if (f.kind === 'pool') {
        // The pool itself inside its deck.
        const [a, b, c, d] = f.pts;
        const inset = (q, k) => [q[0] + (mid(mid(a, b), mid(c, d))[0] - q[0]) * k, q[1] + (mid(mid(a, b), mid(c, d))[1] - q[1]) * k];
        addPoly(p.pool, [a, b, c, d].map((q) => inset(q, 0.3)), ox, oy);
      }
      if (f.kind === 'cemetery') {
        // Rows of headstones in the woods.
        const [a, b, c, d] = f.pts;
        for (let i = 1; i < 12; i++) {
          const t = i / 12;
          const s0 = [a[0] + (d[0] - a[0]) * t, a[1] + (d[1] - a[1]) * t];
          const s1 = [b[0] + (c[0] - b[0]) * t, b[1] + (c[1] - b[1]) * t];
          p.headstones.moveTo(s0[0] - ox, s0[1] - oy);
          p.headstones.lineTo(s1[0] - ox, s1[1] - oy);
        }
      }
    } else if (f.c) {
      const k = kind(f.kind);
      k.moveTo(f.c[0] - ox + f.r, f.c[1] - oy);
      k.arc(f.c[0] - ox, f.c[1] - oy, f.r, 0, Math.PI * 2);
    }
  }
  for (const { pts, width } of layout.paths) {
    if (!p.paths.has(width)) p.paths.set(width, new Path2D());
    const path = p.paths.get(width);
    path.moveTo(pts[0][0] - ox, pts[0][1] - oy);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0] - ox, pts[i][1] - oy);
  }
  cache.set(layout, p);
  return p;
}

// Draw a list of { d, p } (p from layoutPaths), in the current place().
export function drawLayouts(ctx, list, place, zoom, px) {
  if (zoom < PARK_DETAIL_ZOOM || !list.length) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.fillStyle = WOODS;
  for (const { d, p } of list) {
    place(d);
    ctx.fill(p.woods);
  }
  // Paths, then what stands among them.
  for (const [colour, extra] of [['#dcd5c6', px(1)], ['#f1ece2', 0]]) {
    ctx.strokeStyle = colour;
    for (const { d, p } of list) {
      place(d);
      for (const [w, path] of p.paths) {
        ctx.lineWidth = Math.max(w, px(1.2)) + extra;
        ctx.stroke(path);
      }
    }
  }
  for (const { d, p } of list) {
    place(d);
    for (const [k, path] of p.kinds) {
      ctx.fillStyle = FILL[k] || '#d8d0c3';
      ctx.fill(path);
    }
    ctx.fillStyle = '#7fc6ea';
    ctx.fill(p.pool);
  }
  if (zoom >= 0.8) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = Math.max(0.12, px(0.7));
    for (const { d, p } of list) {
      place(d);
      ctx.stroke(p.lines);
    }
    ctx.strokeStyle = 'rgba(80, 90, 70, 0.35)';
    ctx.setLineDash([px(2), px(2)]);
    for (const { d, p } of list) {
      place(d);
      ctx.stroke(p.fences);
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(120, 120, 120, 0.35)';
    ctx.lineWidth = px(0.8);
    for (const { d, p } of list) {
      place(d);
      ctx.stroke(p.headstones);
    }
  }

}
