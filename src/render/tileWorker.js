// Web Worker: generates districts and renders far-zoom tiles off the main thread.

import { createWorld } from '../world/districts.js';
import { renderDistrictTile } from './districtLayer.js';

let world = null;

self.onmessage = (e) => {
  const { id, seed, tile, layers, res } = e.data;
  try {
    if (!world || world.seed !== seed) world = createWorld(seed);
    const canvas = new OffscreenCanvas(res, res);
    renderDistrictTile(canvas.getContext('2d'), world, tile, layers, res);
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({ id, bitmap }, [bitmap]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack ? err.stack : err) });
  }
};
