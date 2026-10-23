// Draws stage 5's buildings, close in, in one of two ways:
//
//   2D: footprints from above, roofs in their materials (or plain), ridge
//       lines on pitched roofs, and a soft shadow to the south-east as long
//       as the building is tall, so heights read at a glance;
//   3D: each building raised from its footprint at a slight angle, as seen
//       from the south: the walls facing the viewer, then the roof, drawn
//       farthest first. Towers rise from their podiums; spires, minarets
//       and domes stand above their roofs.
//
// Paths are built once per chunk of a district and kept.

export const BUILDING_MIN_ZOOM = 0.7;
const SHADOW = [0.22, 0.3]; // shadow offset in metres per metre of height
const RAISE = [0.32, -0.8]; // where a point h metres up is drawn, per metre
const VIEW = [-RAISE[0], -RAISE[1]]; // towards the viewer
const PLAIN = { wall: '#dcd6cd', roof: '#e9e4dc' };

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const shadeCache = new Map();
// A colour made lighter (f > 1) or darker (f < 1).
function shade(hex, f) {
  const k = `${hex}:${f}`;
  let v = shadeCache.get(k);
  if (v) return v;
  const c = hexToRgb(hex).map((x) => Math.max(0, Math.min(255, Math.round(f >= 1 ? x + (255 - x) * (f - 1) : x * f))));
  v = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  shadeCache.set(k, v);
  return v;
}

function addPoly(path, pts, ox, oy, dx = 0, dy = 0) {
  path.moveTo(pts[0][0] - ox + dx, pts[0][1] - oy + dy);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0] - ox + dx, pts[i][1] - oy + dy);
  path.closePath();
}

// Every building in a chunk, with its tower as a building of its own.
function buildingsOf(chunk) {
  const out = [];
  for (const k of chunk.blocks) {
    for (const q of k.plots || []) {
      const b = q.bldg;
      if (!b || !b.pts || b.pts.length < 3) continue;
      out.push({ b, base: 0, top: b.h });
      if (b.tower) out.push({ b: b.tower, base: b.h, top: b.tower.h, onTop: true });
    }
  }
  return out;
}

// 2D: shadows, roofs by colour, plain roofs, ridges, landmark marks.
export function paths2D(d, chunk) {
  const [ox, oy] = d.origin;
  const p = { shadow: new Path2D(), plain: new Path2D(), roofs: new Map(), ridges: new Path2D(), edges: new Path2D(), marks: [] };
  for (const { b, top } of buildingsOf(chunk)) {
    addPoly(p.shadow, b.pts, ox, oy, top * SHADOW[0], top * SHADOW[1]);
    addPoly(p.plain, b.pts, ox, oy);
    if (b.hole) addPoly(p.plain, b.hole, ox, oy);
    if (!p.roofs.has(b.roofColour)) p.roofs.set(b.roofColour, new Path2D());
    const r = p.roofs.get(b.roofColour);
    addPoly(r, b.pts, ox, oy);
    if (b.hole) addPoly(r, b.hole, ox, oy);
    addPoly(p.edges, b.pts, ox, oy);
    if (b.ridge) {
      p.ridges.moveTo(b.ridge[0][0] - ox, b.ridge[0][1] - oy);
      p.ridges.lineTo(b.ridge[1][0] - ox, b.ridge[1][1] - oy);
    }
    if (b.spire) p.marks.push({ x: b.spire.p[0] - ox, y: b.spire.p[1] - oy, kind: 'spire' });
    if (b.dome) p.marks.push({ x: b.dome.p[0] - ox, y: b.dome.p[1] - oy, r: b.dome.r, kind: 'dome' });
  }
  return p;
}

// 3D: one entry per building, its walls (shaded by which way they face) and
// its roof, raised; `key` orders them farthest first.
export function items3D(d, chunk) {
  const [ox, oy] = d.origin;
  const out = [];
  for (const { b, base, top, onTop } of buildingsOf(chunk)) {
    const rings = b.hole ? [b.pts, b.hole] : [b.pts];
    const walls = { light: new Path2D(), mid: new Path2D(), dark: new Path2D() };
    let key = -Infinity;
    for (const [ri, R] of rings.entries()) {
      // Outward normals: a hole's run the other way.
      let area = 0;
      for (let i = 0; i < R.length; i++) {
        const a = R[i];
        const c = R[(i + 1) % R.length];
        area += a[0] * c[1] - c[0] * a[1];
      }
      const sgn = (area > 0 ? 1 : -1) * (ri === 0 ? 1 : -1);
      for (let i = 0; i < R.length; i++) {
        const a = R[i];
        const c = R[(i + 1) % R.length];
        const ex = c[0] - a[0];
        const ey = c[1] - a[1];
        const l = Math.hypot(ex, ey) || 1;
        const n = [(ey / l) * sgn, (-ex / l) * sgn];
        const facing = n[0] * VIEW[0] + n[1] * VIEW[1];
        if (ri === 0) key = Math.max(key, a[0] * VIEW[0] + a[1] * VIEW[1]);
        if (facing <= 0) continue;
        const w = n[1] > 0.55 ? walls.light : n[1] > 0 ? walls.mid : walls.dark;
        const [x0, y0] = [a[0] - ox, a[1] - oy];
        const [x1, y1] = [c[0] - ox, c[1] - oy];
        w.moveTo(x0 + RAISE[0] * base, y0 + RAISE[1] * base);
        w.lineTo(x1 + RAISE[0] * base, y1 + RAISE[1] * base);
        w.lineTo(x1 + RAISE[0] * top, y1 + RAISE[1] * top);
        w.lineTo(x0 + RAISE[0] * top, y0 + RAISE[1] * top);
        w.closePath();
      }
    }
    const roof = new Path2D();
    for (const R of rings) addPoly(roof, R, ox, oy, RAISE[0] * top, RAISE[1] * top);
    let ridge = null;
    if (b.ridge) {
      // A pitched roof's ridge stands a little above the eaves.
      const up = top + 2.5;
      ridge = new Path2D();
      ridge.moveTo(b.ridge[0][0] - ox + RAISE[0] * up, b.ridge[0][1] - oy + RAISE[1] * up);
      ridge.lineTo(b.ridge[1][0] - ox + RAISE[0] * up, b.ridge[1][1] - oy + RAISE[1] * up);
    }
    let spire = null;
    if (b.spire) {
      const [sx, sy] = [b.spire.p[0] - ox, b.spire.p[1] - oy];
      const w = b.spire.thin ? 1.6 : 4;
      spire = new Path2D();
      spire.moveTo(sx - w + RAISE[0] * top, sy + RAISE[1] * top);
      spire.lineTo(sx + w + RAISE[0] * top, sy + RAISE[1] * top);
      spire.lineTo(sx + RAISE[0] * b.spire.h, sy + RAISE[1] * b.spire.h);
      spire.closePath();
    }
    let dome = null;
    if (b.dome) {
      const [cx, cy] = [b.dome.p[0] - ox + RAISE[0] * top, b.dome.p[1] - oy + RAISE[1] * top];
      dome = new Path2D();
      dome.ellipse(cx, cy, b.dome.r, b.dome.r * 0.55, 0, 0, Math.PI * 2);
      dome.ellipse(cx, cy - b.dome.r * 0.45, b.dome.r * 0.85, b.dome.r * 0.85, 0, Math.PI, 0);
    }
    // A tower is drawn straight after the podium it stands on.
    if (onTop && out.length) key = out[out.length - 1].key + 1e-6;
    out.push({ key, b, walls, roof, ridge, spire, dome });
  }
  return out;
}

// Draw the buildings of the chunks in `list` ({ d, ch }), already built into
// paths by the caller's `get2D` / `get3D`.
export function drawBuildings(ctx, view, list, place, mode, materials) {
  const { pr, s } = view;
  const px = (cssPx) => (cssPx * pr) / s;
  if (mode === '3d') {
    const all = [];
    for (const { d, items } of list) for (const it of items) all.push({ d, it });
    all.sort((a, b) => a.it.key - b.it.key);
    let placed = null;
    ctx.lineJoin = 'round';
    for (const { d, it } of all) {
      if (placed !== d) {
        place(d);
        placed = d;
      }
      const wall = materials ? it.b.wall : PLAIN.wall;
      const roofC = materials ? it.b.roofColour : PLAIN.roof;
      ctx.fillStyle = shade(wall, 1);
      ctx.fill(it.walls.light);
      ctx.fillStyle = shade(wall, 0.88);
      ctx.fill(it.walls.mid);
      ctx.fillStyle = shade(wall, 0.76);
      ctx.fill(it.walls.dark);
      ctx.fillStyle = roofC;
      ctx.fill(it.roof, 'evenodd');
      ctx.strokeStyle = 'rgba(40, 40, 40, 0.18)';
      ctx.lineWidth = px(0.5);
      ctx.stroke(it.roof);
      if (it.ridge) {
        ctx.strokeStyle = shade(roofC, 0.7);
        ctx.lineWidth = px(1);
        ctx.stroke(it.ridge);
      }
      if (it.dome) {
        ctx.fillStyle = materials ? '#8fb0a2' : PLAIN.roof;
        ctx.fill(it.dome);
      }
      if (it.spire) {
        ctx.fillStyle = materials ? shade(roofC, 0.85) : PLAIN.wall;
        ctx.fill(it.spire);
      }
    }
    return;
  }
  // 2D
  ctx.fillStyle = 'rgba(60, 50, 40, 0.10)';
  for (const { d, p } of list) {
    place(d);
    ctx.fill(p.shadow);
  }
  if (materials) {
    for (const { d, p } of list) {
      place(d);
      for (const [colour, path] of p.roofs) {
        ctx.fillStyle = colour;
        ctx.fill(path, 'evenodd');
      }
    }
  } else {
    ctx.fillStyle = PLAIN.roof;
    for (const { d, p } of list) {
      place(d);
      ctx.fill(p.plain, 'evenodd');
    }
  }
  ctx.strokeStyle = 'rgba(40, 35, 30, 0.22)';
  ctx.lineWidth = px(0.6);
  for (const { d, p } of list) {
    place(d);
    ctx.stroke(p.edges);
    ctx.stroke(p.ridges);
  }
  // Spires and domes: a small mark from above.
  for (const { d, p } of list) {
    place(d);
    for (const m of p.marks) {
      ctx.beginPath();
      if (m.kind === 'dome') {
        ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        ctx.fillStyle = materials ? '#8fb0a2' : PLAIN.wall;
        ctx.fill();
      } else {
        ctx.arc(m.x, m.y, px(2.2), 0, Math.PI * 2);
        ctx.fillStyle = '#6b6f75';
        ctx.fill();
      }
    }
  }
}
