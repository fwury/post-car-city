// Names on the map, in screen space over everything: districts far out,
// neighbourhoods in between, boulevards and main streets, and close in the
// local streets, each along its street and kept the right way up. Labels
// that would overlap one already placed are left out.

import { palette } from './styles.js';
import { peripheryLabels } from './peripheryLayer.js';

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';

// Place text along a screen polyline: the middle of the longest stretch
// that is straight enough for it. Returns { x, y, angle } or null.
function along(S, width) {
  let best = null;
  for (let i = 0; i < S.length - 1; i++) {
    // Grow a run from i while it stays straight.
    let L = 0;
    let j = i;
    const a0 = Math.atan2(S[i + 1][1] - S[i][1], S[i + 1][0] - S[i][0]);
    while (j < S.length - 1) {
      const a = Math.atan2(S[j + 1][1] - S[j][1], S[j + 1][0] - S[j][0]);
      let da = Math.abs(a - a0);
      if (da > Math.PI) da = 2 * Math.PI - da;
      if (da > 0.35) break;
      L += Math.hypot(S[j + 1][0] - S[j][0], S[j + 1][1] - S[j][1]);
      j++;
    }
    if (L >= width + 16 && (!best || L > best.L)) best = { i, j, L };
    if (best && best.L > width * 3) break;
  }
  if (!best) return null;
  // The point halfway along the run.
  let s = best.L / 2;
  for (let k = best.i; k < best.j; k++) {
    const l = Math.hypot(S[k + 1][0] - S[k][0], S[k + 1][1] - S[k][1]);
    if (s <= l) {
      const t = s / l;
      let angle = Math.atan2(S[best.j][1] - S[best.i][1], S[best.j][0] - S[best.i][0]);
      if (angle > Math.PI / 2) angle -= Math.PI;
      if (angle < -Math.PI / 2) angle += Math.PI;
      return { x: S[k][0] + (S[k + 1][0] - S[k][0]) * t, y: S[k][1] + (S[k + 1][1] - S[k][1]) * t, angle };
    }
    s -= l;
  }
  return null;
}

export function drawLabels(ctx, camera, world, blocksFor) {
  const z = camera.zoom;
  if (z < 0.006) return;
  const b = camera.bounds();
  const m = 200 / z;
  // Districts in full only where the map is drawn from them anyway; farther
  // out, district names come from the cores alone.
  const districts = z >= 0.1 ? world.districtsInRect(b.x0 - m, b.y0 - m, b.x1 + m, b.y1 + m) : [];
  const placed = [];
  const free = (x, y, w, h) => {
    const r = { x0: x - w / 2 - 4, y0: y - h / 2 - 3, x1: x + w / 2 + 4, y1: y + h / 2 + 3 };
    if (placed.some((o) => o.x0 < r.x1 && o.x1 > r.x0 && o.y0 < r.y1 && o.y1 > r.y0)) return false;
    placed.push(r);
    return true;
  };
  const screen = (P) => P.map(([x, y]) => camera.worldToScreen(x, y));
  const text = (t, x, y, angle, font, colour, halo = 3) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.lineWidth = halo;
    ctx.strokeText(t, 0, 0);
    ctx.fillStyle = colour;
    ctx.fillText(t, 0, 0);
    ctx.restore();
  };
  const onLine = (name, P, font, colour) => {
    ctx.font = font;
    const w = ctx.measureText(name).width;
    const S = screen(P);
    // Skip lines off screen.
    if (!S.some(([x, y]) => x > -50 && y > -50 && x < camera.width + 50 && y < camera.height + 50)) return;
    const at = along(S, w);
    if (!at) return;
    // An axis-aligned box round the rotated text, for overlaps.
    const c = Math.abs(Math.cos(at.angle));
    const s = Math.abs(Math.sin(at.angle));
    if (!free(at.x, at.y, w * c + 14 * s, w * s + 14 * c)) return;
    text(name, at.x, at.y, at.angle, font, colour);
  };

  // Streets first (they matter most close in), then places.
  if (z >= 1.0) {
    const font = `500 11px ${FONT}`;
    for (const d of districts) {
      const bl = blocksFor(d);
      if (!bl) continue;
      for (const st of bl.streets) {
        if (!st.name || !st.lines) continue;
        const line = st.lines.slice().sort((x, y) => y.length - x.length)[0];
        if (line && line.length > 2) onLine(st.name.short, line, font, palette.ink);
      }
    }
  }
  if (z >= 0.15) {
    const font = `600 ${z >= 1 ? 12 : 11}px ${FONT}`;
    for (const d of districts) {
      for (const l of d.stage3.lines) onLine((world.names.mainStreet(d, l) || world.names.street('main', l.crossing || l.key)).short, l.points, font, palette.ink);
      for (const l of d.network.lines) {
        if (l.kind === 'roundabout') continue;
        onLine(world.names.street('boulevard', l.key.split(':').pop()).short, l.points, font, palette.ink);
      }
    }
  }
  if (z >= 0.12 && z < 0.9) {
    const font = `600 ${z >= 0.25 ? 12 : 11}px ${FONT}`;
    for (const d of districts) {
      for (const h of d.stage3.hoods) {
        if (h.core) continue;
        const [x, y] = camera.worldToScreen(h.centre[0], h.centre[1]);
        // (A campus by its university's name.)
        const name = (h.campus ? world.names.university(d, h) : world.names.hood(d, h)).toUpperCase();
        ctx.font = font;
        const w = ctx.measureText(name).width;
        if (free(x, y + 14, w, 14)) text(name, x, y + 14, 0, font, palette.inkSoft);
      }
    }
  }
  if (z < 0.12) {
    const font = `700 ${z >= 0.03 ? 15 : 13}px ${FONT}`;
    for (const c of world.coresInRect(b.x0 - m, b.y0 - m, b.x1 + m, b.y1 + m)) {
      const [x, y] = camera.worldToScreen(c.x, c.y);
      const name = world.names.district(c);
      ctx.font = font;
      const w = ctx.measureText(name).width;
      if (free(x, y - 20, w, 18)) text(name, x, y - 20, 0, font, palette.ink, 4);
    }
  }
  // Round the city: industrial areas, the greenbelt's attractions,
  // park-and-rides.
  if (z >= 0.02 && world.periphery) {
    for (const { name, p, big } of peripheryLabels(world.periphery)) {
      if (!big && z < 0.06) continue;
      const font = `${big ? 700 : 600} ${big ? 13 : 12}px ${FONT}`;
      const [x, y] = camera.worldToScreen(p[0], p[1]);
      ctx.font = font;
      const w = ctx.measureText(name).width;
      if (free(x, y, w, 16)) text(name, x, y, 0, font, palette.inkSoft, 4);
    }
  }
}
