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
        blocks: b.blocks.map(({ pts, use, hood, front, inner, plots }) => ({ pts, use, hood, front, inner, plots: plots && plots.map(({ pts: q, kind }) => ({ pts: q, kind })) })),
        streets: b.streets,
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
