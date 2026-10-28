// Web Worker: generates districts, renders far-zoom tiles, and works out
// stage 4 blocks off the main thread.

import { createWorld } from '../world/districts.js';
import { renderDistrictTile } from './districtLayer.js';

let world = null;

self.onmessage = (e) => {
  const { id, seed, population, tile, layers, res } = e.data;
  try {
    if (!world || world.seed !== seed || world.population !== population) world = createWorld(seed, { population });
    if (e.data.kind === 'trams') {
      // One district's share of the city's tram plan.
      const [x, y] = e.data.at;
      const d = world.districtsInRect(x - 1, y - 1, x + 1, y + 1).find((q) => q.key === e.data.key);
      self.postMessage({ id, result: world.trams.in(d) });
      return;
    }
    if (e.data.kind === 'blocks') {
      // Stage 4 for one district, found by its station.
      const [x, y] = e.data.at;
      const d = world.districtsInRect(x - 1, y - 1, x + 1, y + 1).find((q) => q.key === e.data.key);
      const b = world.blocks(d);
      const result = {
        blocks: b.blocks.map(({ pts, centreline, use, hood, front, inner, court, alley, layout, plots }) => ({
          pts, centreline, use, hood, front, inner, court, alley, layout,
          plots: plots && plots.map(({ pts: q, kind, cls, ground, upper, dedicated, storeys, baseStoreys, dwellings, corner, c, bldg, layout: pl, also, group, shops, offices, towerSite, walkway, entrances, name }) => ({ pts: q, kind, cls, ground, upper, dedicated, storeys, baseStoreys, dwellings, corner, c, bldg, layout: pl, also, group, shops, offices, towerSite, walkway, entrances, name })),
        })),
        streets: b.streets,
        hoodLines: b.hoodLines,
        tramStops: b.tramStops,
        intersections: b.intersections,
        greenLinks: b.greenLinks,
        districtParks: b.districtParks,
        linearParks: b.linearParks,
        arcades: b.arcades,
        entrances: b.entrances,
        halls: b.halls,
        planned: b.planned,
        housed: b.programme.housed,
      };
      // The page keeps them; this worker need not.
      world.forgetBlocks(d);
      self.postMessage({ id, result });
      return;
    }
    const canvas = new OffscreenCanvas(res, res);
    renderDistrictTile(canvas.getContext('2d'), world, tile, layers, res);
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ id, bitmap }, [bitmap]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack ? err.stack : err) });
  }
};
