// Debug readout: cursor position, district under the cursor, zoom, tiles, frame rate.

import { formatDistance, VECTOR_MIN_ZOOM } from '../render/renderer.js';
import { pointInPolygon } from '../util/geom.js';

const fmt = (v) => v.toLocaleString('en', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const km2 = (m2) => `${(m2 / 1e6).toFixed(2)} km²`;
const ha = (m2) => `${(m2 / 1e4).toFixed(0)} ha`;
const people = (n) => `${(Math.round(n / 100) * 100).toLocaleString('en')}`;

// The neighbourhood of a district under a point, if any.
function hoodAt(d, x, y) {
  return d.stage3.hoods.find((h) => pointInPolygon(x, y, h.polygon) && !h.holes.some((r) => pointInPolygon(x, y, r))) || null;
}

export function createHud(el) {
  let frames = 0;
  let windowStart = performance.now();
  let fps = 0;
  let lastText = 0;

  return {
    tick(now) {
      frames++;
      if (now - windowStart >= 500) {
        fps = (frames * 1000) / (now - windowStart);
        frames = 0;
        windowStart = now;
      }
    },

    update(now, { camera, input, tiles, renderer, world, visible }) {
      el.hidden = !visible;
      if (!visible || now - lastText < 100) return;
      lastText = now;
      const z = camera.zoom;
      const cursor = input.hover ? camera.screenToWorld(input.hover[0], input.hover[1]) : null;
      const d = cursor ? world.districtAt(cursor[0], cursor[1]) : null;
      const h = d ? hoodAt(d, cursor[0], cursor[1]) : null;
      const level = tiles.levelFor(z);
      const rows = [
        ['Cursor', cursor ? `${fmt(cursor[0])} m, ${fmt(cursor[1])} m` : 'off map'],
        ['District', d ? `${km2(d.area)}, core ${ha(d.coreArea)}, ${d.stage3.hoods.length - 1} neighbourhoods, ${d.neighbours.length} neighbouring districts` : 'none'],
        ['Neighbourhood', h ? `${h.character}, ${people(h.population)} people on ${km2(h.area)} (${people(h.density)} per km²)` : 'none'],
        ['Links', d ? `${d.links} boulevard links, ${d.stage3.lines.length} main streets` : 'none'],
        ['Parks', d ? (d.parks.length ? `${d.parks.length} district park${d.parks.length === 1 ? '' : 's'} (${d.parks.map((p) => ha(p.area)).join(', ')})` : 'none') : 'none'],
        ['Zoom', `${z.toPrecision(3)} px/m, 1 px = ${1 / z < 10 ? `${(1 / z).toPrecision(2)} m` : formatDistance(1 / z)}`],
        ['Drawing', z < VECTOR_MIN_ZOOM
          ? `tiles, level ${level} (${formatDistance(tiles.baseSize * 2 ** level)}), ${tiles.cache.size} cached, ${tiles.pending} building`
          : 'vectors'],
        ['Frame', `${Math.round(fps)} fps, draw ${renderer.lastDrawMs.toFixed(1)} ms`],
      ];
      el.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
    },
  };
}
