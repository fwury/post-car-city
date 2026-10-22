// App start and wiring.

import { seedFromText } from './core/hash.js';
import { createWorld } from './world/districts.js';
import { Camera } from './render/camera.js';
import { TileManager } from './render/tiles.js';
import { Renderer, createNoiseTileBuilder, createDistrictTileBuilder } from './render/renderer.js';
import { createTilePool } from './render/workerPool.js';
import { attachInput } from './ui/input.js';
import { readUrlState, createUrlSync, setupControls, loadLayers, MAP_LAYERS } from './ui/controls.js';
import { createHud } from './ui/hud.js';
import { BLOCK_MIN_ZOOM, PLOT_MIN_ZOOM } from './render/blockLayer.js';

const TILE_BUDGET_MS = 6;

const canvas = document.getElementById('map');
const initial = readUrlState();

const state = {
  seedText: initial.seed,
  seed: seedFromText(initial.seed),
  layers: loadLayers(),
};
let world = createWorld(state.seed);
const getWorld = () => world;

let dirty = true;
const markDirty = () => { dirty = true; };

const pool = createTilePool(Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)));
// Stage 4 blocks, worked out in their own workers as districts come into
// view at close zoom (or here, if workers are missing).
const BLOCK_CACHE = 48;
const blockPool = createTilePool(2);
const blockCache = new Map();
function blocksFor(d) {
  const k = d.key;
  if (blockCache.has(k)) return blockCache.get(k);
  while (blockCache.size >= BLOCK_CACHE) blockCache.delete(blockCache.keys().next().value);
  if (!blockPool || blockPool.broken) {
    const b = world.blocks(d);
    blockCache.set(k, b);
    return b;
  }
  blockCache.set(k, null);
  const seedAt = state.seed;
  blockPool.run({ kind: 'blocks', seed: state.seed, key: k, at: d.station }).then(
    (b) => {
      if (state.seed !== seedAt) return;
      blockCache.set(k, b);
      dirty = true;
    },
    () => blockCache.delete(k),
  );
  return null;
}

const camera = new Camera();
const noiseTiles = new TileManager({ build: createNoiseTileBuilder(() => state.seed) });
const districtTiles = new TileManager({
  build: createDistrictTileBuilder({ pool, getWorld, getLayers: () => state.layers }),
  concurrency: pool ? 8 : 1,
  maxEntries: 96,
  onReady: markDirty,
  onEvict: (data) => data.canvas.close?.(),
});
const renderer = new Renderer(canvas, camera, { noiseTiles, districtTiles }, state, getWorld);
renderer.blocksFor = blocksFor;
const input = attachInput(canvas, camera);
const hud = createHud(document.getElementById('hud'));
const urlSync = createUrlSync(() => ({ seed: state.seedText, x: camera.x, y: camera.y, zoom: camera.zoom }));

renderer.resize();
camera.set(initial.x, initial.y, initial.zoom);

const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
camera.reducedMotion = motion.matches;
motion.addEventListener('change', () => { camera.reducedMotion = motion.matches; });

setupControls({
  state,
  camera,
  onSeed(text) {
    state.seedText = text;
    state.seed = seedFromText(text);
    world = createWorld(state.seed);
    blockCache.clear();
    noiseTiles.clear();
    districtTiles.clear();
    dirty = true;
    urlSync.now();
  },
  onLayers(name) {
    if (MAP_LAYERS.includes(name)) districtTiles.clear();
    dirty = true;
  },
});

window.addEventListener('resize', () => {
  renderer.resize();
  dirty = true;
});

let last = performance.now();
let seenVersion = -1;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  input.update(dt);
  camera.update(dt);
  if (camera.version !== seenVersion) {
    seenVersion = camera.version;
    dirty = true;
    urlSync.schedule();
  }
  if (dirty) {
    dirty = false;
    renderer.draw();
    districtTiles.pump(TILE_BUDGET_MS);
    if (state.layers.noise && noiseTiles.pump(TILE_BUDGET_MS) > 0) dirty = true;
    if (noiseTiles.queue.size > 0 && state.layers.noise) dirty = true;
  }
  hud.tick(now);
  const stageEl = document.querySelector('.panel .stage');
  if (stageEl) {
    const z = camera.zoom;
    const text = z < BLOCK_MIN_ZOOM ? 'Stage 4: zoom in to see blocks' : z < PLOT_MIN_ZOOM ? 'Stage 4: zoom in further to see plots' : 'Stage 4: blocks and plots';
    if (stageEl.textContent !== text) stageEl.textContent = text;
  }
  hud.update(now, { camera, input, tiles: districtTiles, renderer, world, visible: state.layers.hud });
  requestAnimationFrame(frame);
}


// Handle for debugging from the console.
window.city = { camera, renderer, districtTiles, getWorld, state };

requestAnimationFrame(frame);
