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
