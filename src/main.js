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
import { createPlaceCard } from './ui/placeCard.js';
import { pickPlace } from './render/places.js';
import { BUILDING_MIN_ZOOM } from './render/buildingLayer.js';
import { BLOCK_MIN_ZOOM } from './render/blockLayer.js';

const TILE_BUDGET_MS = 6;

const canvas = document.getElementById('map');
const initial = readUrlState();

const state = {
  seedText: initial.seed,
  seed: seedFromText(initial.seed),
  population: initial.population,
  layers: loadLayers(),
};
let world = createWorld(state.seed, { population: state.population });
// What the city is built on, and how big it is.
const siteEl = document.getElementById('site');
const showSite = () => {
  if (siteEl) siteEl.textContent = `${world.terrain.label}, ${world.terrain.districts} district${world.terrain.districts === 1 ? '' : 's'}`;
};
showSite();
const getWorld = () => world;

let dirty = true;
const markDirty = () => { dirty = true; };

const pool = createTilePool(Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)));
// Stage 4 blocks, worked out in their own workers as districts come into
// view at close zoom (or here, if workers are missing).
const BLOCK_CACHE = 12;
const blockPool = createTilePool(Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1)));
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
  const worldAt = world;
  blockPool.run({ kind: 'blocks', seed: state.seed, population: state.population, key: k, at: d.station }).then(
    (b) => {
      if (world !== worldAt) return;
      blockCache.set(k, b);
      // Tiles drawn before this district's blocks came in are redrawn.
      const bb = d.bbox;
      renderer.invalidate(bb.x0, bb.y0, bb.x1, bb.y1);
      dirty = true;
    },
    () => blockCache.delete(k),
  );
  return null;
}

// Each district's tram routes (its routed streets, stops, turns and
// loops), from the city's tram plan, worked out in a worker too.
const tramCache = new Map();
function tramsFor(d) {
  const k = d.key;
  if (tramCache.has(k)) return tramCache.get(k);
  if (!blockPool || blockPool.broken) {
    const t = world.trams.in(d);
    tramCache.set(k, t);
    return t;
  }
  tramCache.set(k, null);
  const worldAt = world;
  blockPool.run({ kind: 'trams', seed: state.seed, population: state.population, key: k, at: d.station }).then(
    (t) => {
      if (world !== worldAt) return;
      tramCache.set(k, t);
      const bb = d.bbox;
      renderer.invalidate(bb.x0, bb.y0, bb.x1, bb.y1);
      dirty = true;
    },
    () => tramCache.delete(k),
  );
  return null;
}

const camera = new Camera();
const noiseTiles = new TileManager({ build: createNoiseTileBuilder(() => state.seed) });
const districtTiles = new TileManager({
  build: createDistrictTileBuilder({ pool, getWorld, getLayers: () => state.layers }),
  concurrency: pool ? 8 : 1,
  maxEntries: 64,
  onReady: markDirty,
  onEvict: (data) => data.canvas.close?.(),
});
const renderer = new Renderer(canvas, camera, { noiseTiles, districtTiles }, state, getWorld);
renderer.blocksFor = blocksFor;
renderer.tramsFor = tramsFor;
const input = attachInput(canvas, camera);
const hud = createHud(document.getElementById('hud'));

// Tap a place marker to see what it is.
const card = createPlaceCard(document.getElementById('place-card'));
input.onTap = ([sx, sy]) => {
  const hit = pickPlace(renderer.placesDrawn || [], sx, sy);
  if (!hit) {
    card.close();
    renderer.selected = null;
  } else {
    const hood = hit.d.stage3.hoods.find((h) => h.id === hit.block.hood);
    card.show({ plot: hit.plot, block: hit.block, use: hit.use }, hood ? `${world.names.hood(hit.d, hood)}, ${world.names.district(hit.d)}` : world.names.district(hit.d));
    renderer.selected = hit.plot.bldg || null;
  }
  dirty = true;
};
const urlSync = createUrlSync(() => ({ seed: state.seedText, population: state.population, x: camera.x, y: camera.y, zoom: camera.zoom }));

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
    rebuild();
  },
  onPopulation(n) {
    state.population = n;
    rebuild();
  },
  onLayers(name) {
    if (MAP_LAYERS.includes(name)) districtTiles.clear();
    renderer.clearVectorTiles();
    dirty = true;
  },
});

function rebuild() {
  world = createWorld(state.seed, { population: state.population });
  showSite();
  card.close();
  renderer.selected = null;
  blockCache.clear();
  tramCache.clear();
  renderer.clearVectorTiles();
  noiseTiles.clear();
  districtTiles.clear();
  dirty = true;
  urlSync.now();
}

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
    if (renderer.vectorTiles.queue.size && renderer.vectorTiles.pump(TILE_BUDGET_MS) > 0) dirty = true;
    if (state.layers.noise && noiseTiles.pump(TILE_BUDGET_MS) > 0) dirty = true;
    if (noiseTiles.queue.size > 0 && state.layers.noise) dirty = true;
  }
  hud.tick(now);
  const stageEl = document.querySelector('.panel .stage');
  if (stageEl) {
    const z = camera.zoom;
    const text = z < BLOCK_MIN_ZOOM ? 'Stage 5: zoom in to see blocks' : z < BUILDING_MIN_ZOOM ? 'Stage 5: zoom in further to see buildings' : 'Stage 5: buildings (tap a place for more)';
    if (stageEl.textContent !== text) stageEl.textContent = text;
  }
  hud.update(now, { camera, input, tiles: districtTiles, renderer, world, visible: state.layers.hud });
  requestAnimationFrame(frame);
}


// Handle for debugging from the console.
window.city = { camera, renderer, districtTiles, getWorld, state };

requestAnimationFrame(frame);
