// The card that opens when a building is clicked: what it is, how tall,
// what style, who and what is in it.

import { pointInPolygon } from '../util/geom.js';
import { USES } from '../world/uses.js';
import { STYLES } from '../world/architecture.js';

const KINDS = {
  main: 'Mixed-use building', unit: 'Block of flats', unitShop: 'Flats over a shop', corner: 'Corner building',
  podium: 'Shops and offices', house: 'Terraced house', rowCorner: 'End-of-terrace house', cornerShop: 'Corner shop with a home over it',
};
const ROOFS = { pitched: 'pitched roof', hipped: 'hipped roof', mansard: 'mansard roof', flat: 'flat roof' };
const RAISE = [0.32, -0.8]; // as drawn in 3D

const label = (k) => (k && USES[k] ? USES[k].label : null);

// The building under a world point: by footprint, or in 3D by its raised
// roof (the nearest the viewer wins).
export function pickBuilding(blocks, x, y, mode) {
  if (!blocks) return null;
  let best = null;
  for (const k of blocks.blocks) {
    for (const q of k.plots || []) {
      const b = q.bldg;
      if (!b) continue;
      const parts = b.tower ? [b, b.tower] : [b];
      for (const part of parts) {
        const h = mode === '3d' ? part.h : 0;
        const px = x - RAISE[0] * h;
        const py = y - RAISE[1] * h;
        if (Math.abs(px - part.pts[0][0]) > 400 || Math.abs(py - part.pts[0][1]) > 400) continue;
        if (!pointInPolygon(px, py, part.pts) || (part.hole && pointInPolygon(px, py, part.hole))) continue;
        const key = part.pts[0][1] * 0.8 - part.pts[0][0] * 0.32 + h;
        if (!best || key > best.key) best = { key, plot: q, block: k };
      }
    }
  }
  return best;
}

export function createPlaceCard(el) {
  const close = () => {
    el.hidden = true;
    el.dataset.open = '';
  };
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  return {
    close,
    show(hit, hood) {
      const q = hit.plot;
      const b = q.bldg;
      // The place tapped, and the building it is in.
      const title = label(hit.use) || label(q.dedicated) || (q.cls === 'podium' && b && b.tower ? 'Tower over shops and offices' : KINDS[q.cls]) || 'Building';
      const rows = [];
      if (!b) {
        if (hood) rows.push(['Neighbourhood', hood]);
        el.innerHTML = `<div class="card-head"><h2>${title}</h2><button type="button" class="card-close" data-close aria-label="Close">×</button></div>`
          + `<dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
        el.hidden = false;
        el.dataset.open = '1';
        return;
      }
      const st = STYLES[b.style];
      if (hit.use && hit.use !== q.dedicated) rows.push(['In', label(q.dedicated) || KINDS[q.cls] || 'Building']);
      const storeys = b.tower ? `${b.tower.storeys} storeys (tower), podium ${b.storeys}` : `${b.storeys} storey${b.storeys === 1 ? '' : 's'}`;
      const height = Math.round((b.tower ? b.tower.h : b.h) + (b.ridge ? 2.5 : 0));
      rows.push(['Height', `${storeys}, about ${height} m`]);
      if (b.spire) rows.push([b.spire.thin ? 'Minaret' : 'Spire', `about ${Math.round(b.spire.h)} m`]);
      rows.push(['Style', `${st.label}, ${ROOFS[b.roof] || 'roof'}`]);
      if (q.dwellings) rows.push(['Homes', `${q.dwellings}`]);
      // Many businesses: counted, by kind.
      const tally = (list) => {
        const m = new Map();
        for (const k of list) m.set(label(k), (m.get(label(k)) || 0) + 1);
        return [...m].sort((x, y) => y[1] - x[1]).map(([l, n]) => (n > 1 ? `${l} (${n})` : l)).join(', ');
      };
      if (q.shops && q.shops.length > 1) rows.push([`${q.shops.length} shops`, tally(q.shops)]);
      else if (q.ground) rows.push(['Shop floor', label(q.ground)]);
      if (q.offices && q.offices.length > 1) rows.push([`${q.offices.length} offices`, tally(q.offices)]);
      else if (q.upper) rows.push(['Upstairs', label(q.upper)]);
      if (hood) rows.push(['Neighbourhood', hood]);
      el.innerHTML = `<div class="card-head"><h2>${title}</h2><button type="button" class="card-close" data-close aria-label="Close">×</button></div>`
        + `<dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
      el.hidden = false;
      el.dataset.open = '1';
    },
  };
}
