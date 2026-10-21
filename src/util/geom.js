// Small geometry helpers. Points are [x, y] arrays in world metres.

export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

// Shoelace sum; positive means clockwise on screen (y grows down).
export function signedArea(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

// Area of a polygon, computed relative to its first point for precision far from the origin.
export function polygonArea(pts) {
  const [ox, oy] = pts[0];
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    s += (p[0] - ox) * (q[1] - oy) - (q[0] - ox) * (p[1] - oy);
  }
  return Math.abs(s / 2);
}

export function orientPositive(pts) {
  return signedArea(pts) < 0 ? pts.slice().reverse() : pts;
}

export function pointInPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bboxOf(pts, pad = 0, into = null) {
  const b = into ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of pts) {
    if (x - pad < b.x0) b.x0 = x - pad;
    if (y - pad < b.y0) b.y0 = y - pad;
    if (x + pad > b.x1) b.x1 = x + pad;
    if (y + pad > b.y1) b.y1 = y + pad;
  }
  return b;
}

// Unit normals along a polyline (tangent from neighbouring points).
export function polylineNormals(pts) {
  const n = pts.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const len = Math.hypot(tx, ty) || 1;
    out[i] = [-ty / len, tx / len];
  }
  return out;
}

// Douglas-Peucker simplification, keeping both ends. Removes the parcel-grid
// staircase before smoothing.
export function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay);
    let best = -1;
    let bd = tol;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const d = len > 0 ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len : Math.hypot(px - ax, py - ay);
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function chaikin(pts, closed) {
  const out = closed ? [] : [pts[0]];
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
    out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

// Even spacing along a polyline, keeping both ends.
export function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    let t = step - carry;
    while (t < len) {
      out.push([ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len]);
      t += step;
    }
    carry = len - (t - step);
  }
  const last = pts[pts.length - 1];
  const prev = out[out.length - 1];
  if (Math.hypot(last[0] - prev[0], last[1] - prev[1]) < step * 0.4 && out.length > 1) out.pop();
  out.push(last);
  return out;
}
