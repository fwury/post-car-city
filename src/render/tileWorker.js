// Web Worker: generates districts, renders far-zoom tiles, and works out
// stage 4 blocks off the main thread.

import { createWorld } from '../world/districts.js';
import { renderDistrictTile } from './districtLayer.js';

let world = null;

self.onmessage = (e) => {
  const { id, seed, tile, layers, res } = e.data;
  try {
    if (!world || world.seed !== seed) world = createWorld(seed);
    if (e.data.kind === 'blocks') {
      // Stage 4 for one district, found by its station.
      const [x, y] = e.data.at;
      const d = world.districtsInRect(x - 1, y - 1, x + 1, y + 1).find((q) => q.key === e.data.key);
      const b = world.blocks(d);
      const result = {
        blocks: b.blocks.map(({ pts, centreline, use, hood, front, inner, court, plots }) => ({
          pts, centreline, use, hood, front, inner, court,
          plots: plots && plots.map(({ pts: q, kind, cls, ground, upper, dedicated, storeys, dwellings, corner, c, bldg }) => ({ pts: q, kind, cls, ground, upper, dedicated, storeys, dwellings, corner, c, bldg })),
        })),
        streets: b.streets,
        hoodLines: b.hoodLines,
        tramStops: b.tramStops,
        junctions: b.junctions,
        greenLinks: b.greenLinks,
        planned: b.planned,
        housed: b.programme.housed,
      };
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
