// Raster helpers for square grids of `cell` metres, row by row from (x0, y0).

// Fill a polygon into a raster, by scanlines through cell centres.
export function fill(cell, mask, W, H, x0, y0, poly, value, only = -1) {
  const n = poly.length;
  const xs = [];
  for (let j = 0; j < H; j++) {
    const y = y0 + (j + 0.5) * cell;
    xs.length = 0;
    for (let k = 0; k < n; k++) {
      const a = poly[k];
      const b = poly[(k + 1) % n];
      if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5));
      const i1 = Math.min(W - 1, Math.floor((xs[k + 1] - x0) / cell - 0.5));
      for (let i = i0; i <= i1; i++) if (only < 0 || mask[j * W + i] === only) mask[j * W + i] = value;
    }
  }
}

// Chamfer distance transform in metres from every source cell (dist 0).
export function distanceField(cell, src, W, H) {
  const d = new Float64Array(W * H);
  for (let n = 0; n < d.length; n++) d[n] = src[n] ? 0 : Infinity;
  const D = cell * Math.SQRT2;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const n = j * W + i;
      let v = d[n];
      if (i > 0) v = Math.min(v, d[n - 1] + cell);
      if (j > 0) {
        v = Math.min(v, d[n - W] + cell);
        if (i > 0) v = Math.min(v, d[n - W - 1] + D);
        if (i < W - 1) v = Math.min(v, d[n - W + 1] + D);
      }
      d[n] = v;
    }
  }
  for (let j = H - 1; j >= 0; j--) {
    for (let i = W - 1; i >= 0; i--) {
      const n = j * W + i;
      let v = d[n];
      if (i < W - 1) v = Math.min(v, d[n + 1] + cell);
      if (j < H - 1) {
        v = Math.min(v, d[n + W] + cell);
        if (i < W - 1) v = Math.min(v, d[n + W + 1] + D);
        if (i > 0) v = Math.min(v, d[n + W - 1] + D);
      }
      d[n] = v;
    }
  }
  return d;
}

// Mark the cells a polyline passes through.
export function stamp(cell, src, W, H, x0, y0, pts) {
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, ay] = pts[k];
    const [bx, by] = pts[k + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (cell / 2)));
    for (let s = 0; s <= steps; s++) {
      const i = Math.floor((ax + ((bx - ax) * s) / steps - x0) / cell);
      const j = Math.floor((ay + ((by - ay) * s) / steps - y0) / cell);
      if (i >= 0 && j >= 0 && i < W && j < H) src[j * W + i] = 1;
    }
  }
}

// Outlines of the cells where mask is set, as closed loops of cell corners
// running clockwise on screen with the set cells on the right. Where two
// pieces touch only at a corner they are traced apart.
export function contours(cell, mask, W, H, x0, y0) {
  const CW = W + 1;
  const set = (i, j) => i >= 0 && j >= 0 && i < W && j < H && mask[j * W + i];
  const out = new Map(); // corner -> edges leaving it
  const from = [];
  const to = [];
  const add = (a, b) => {
    const e = from.length;
    from.push(a);
    to.push(b);
    let l = out.get(a);
    if (!l) out.set(a, (l = []));
    l.push(e);
  };
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (!mask[j * W + i]) continue;
      const c00 = j * CW + i;
      if (!set(i, j - 1)) add(c00, c00 + 1);
      if (!set(i + 1, j)) add(c00 + 1, c00 + 1 + CW);
      if (!set(i, j + 1)) add(c00 + 1 + CW, c00 + CW);
      if (!set(i - 1, j)) add(c00 + CW, c00);
    }
  }
  const xy = (c) => [x0 + (c % CW) * cell, y0 + Math.floor(c / CW) * cell];
  const used = new Uint8Array(from.length);
  const loops = [];
  for (let e0 = 0; e0 < from.length; e0++) {
    if (used[e0]) continue;
    const loop = [];
    let e = e0;
    while (e !== undefined && !used[e]) {
      used[e] = 1;
      loop.push(xy(from[e]));
      const cands = (out.get(to[e]) || []).filter((f) => !used[f]);
      if (cands.length <= 1) {
        e = cands[0];
        continue;
      }
      // At a pinch, turn right, keeping each piece to itself.
      const [ax, ay] = xy(from[e]);
      const [bx, by] = xy(to[e]);
      const din = [bx - ax, by - ay];
      let best = -Infinity;
      for (const f of cands) {
        const [cx, cy] = xy(to[f]);
        const cr = din[0] * (cy - by) - din[1] * (cx - bx);
        if (cr > best) [best, e] = [cr, f];
      }
    }
    if (loop.length > 3) loops.push(loop);
  }
  return loops;
}
