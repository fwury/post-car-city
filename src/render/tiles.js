// Tile manager: works out which tiles are visible and keeps an LRU cache of
// whatever `build(tile)` returns. Tiles are square, base 500 m, doubling per
// level so a tile is never smaller than about `minScreenPx` on screen.
// Tiles decide what to draw; generation itself stays per district.
//
// With `concurrency > 0`, build returns a Promise and up to that many tiles
// build at once; `onReady` fires as each one lands.

export class TileManager {
  constructor({ build, baseSize = 500, minScreenPx = 256, maxEntries = 400, concurrency = 0, onReady = null, onEvict = null }) {
    this.build = build;
    this.baseSize = baseSize;
    this.minScreenPx = minScreenPx;
    this.maxEntries = maxEntries;
    this.concurrency = concurrency;
    this.onReady = onReady;
    this.onEvict = onEvict;
    this.cache = new Map(); // key -> data, in LRU order
    this.queue = new Map(); // key -> tile, requested this frame, nearest first
    this.inflight = new Set();
    this.epoch = 0;
    this.lastBuildMs = 0;
  }

  levelFor(zoom) {
    let level = 0;
    while (this.baseSize * 2 ** level * zoom < this.minScreenPx) level++;
    return level;
  }

  tile(level, tx, ty) {
    const size = this.baseSize * 2 ** level;
    return { level, tx, ty, size, x0: tx * size, y0: ty * size, key: `${level}:${tx}:${ty}` };
  }

  // Visible tiles at the camera's level, nearest the centre first.
  visible(camera) {
    const level = this.levelFor(camera.zoom);
    const size = this.baseSize * 2 ** level;
    const b = camera.bounds();
    const tx0 = Math.floor(b.x0 / size);
    const ty0 = Math.floor(b.y0 / size);
    const tx1 = Math.floor(b.x1 / size);
    const ty1 = Math.floor(b.y1 / size);
    const out = [];
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) out.push(this.tile(level, tx, ty));
    }
    const cx = camera.x;
    const cy = camera.y;
    const d = (t) => (t.x0 + size / 2 - cx) ** 2 + (t.y0 + size / 2 - cy) ** 2;
    out.sort((a, b2) => d(a) - d(b2));
    return out;
  }

  // Call once per frame before get(): drops requests for tiles no longer in view.
  beginFrame() {
    this.queue.clear();
  }

  // Cached data, or null after queueing the tile for building.
  get(tile) {
    const data = this.cache.get(tile.key);
    if (data !== undefined) {
      this.cache.delete(tile.key);
      this.cache.set(tile.key, data);
      return data;
    }
    this.queue.set(tile.key, tile);
    return null;
  }

  peek(tile) {
    return this.cache.get(tile.key) ?? null;
  }

  // A cached ancestor to stand in while a tile builds.
  ancestor(tile, maxUp = 4) {
    for (let up = 1; up <= maxUp; up++) {
      const f = 2 ** up;
      const parent = this.tile(tile.level + up, Math.floor(tile.tx / f), Math.floor(tile.ty / f));
      const data = this.cache.get(parent.key);
      if (data !== undefined) return { tile: parent, data };
    }
    return null;
  }

  // Cached children one level down (useful when zooming out).
  children(tile) {
    if (tile.level === 0) return [];
    const out = [];
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const c = this.tile(tile.level - 1, tile.tx * 2 + i, tile.ty * 2 + j);
        const data = this.cache.get(c.key);
        if (data !== undefined) out.push({ tile: c, data });
      }
    }
    return out;
  }

  store(key, data) {
    this.cache.set(key, data);
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      const old = this.cache.get(oldest);
      this.cache.delete(oldest);
      if (this.onEvict) this.onEvict(old);
    }
  }

  // Sync: build queued tiles until the time budget runs out (always at least
  // one) and return the number built. Async: start builds up to the
  // concurrency limit and return 0.
  pump(budgetMs) {
    if (this.concurrency > 0) {
      for (const [key, tile] of this.queue) {
        if (this.inflight.size >= this.concurrency) break;
        if (this.inflight.has(key)) continue;
        this.inflight.add(key);
        const epoch = this.epoch;
        Promise.resolve(this.build(tile))
          .then((data) => {
            if (epoch === this.epoch) this.store(key, data);
            else if (this.onEvict) this.onEvict(data);
          })
          .catch((err) => console.error('Tile build failed', err))
          .finally(() => {
            if (epoch === this.epoch) this.inflight.delete(key);
            if (this.onReady) this.onReady();
          });
      }
      return 0;
    }
    const start = performance.now();
    let built = 0;
    for (const [key, tile] of this.queue) {
      if (built > 0 && performance.now() - start > budgetMs) break;
      const t0 = performance.now();
      this.store(key, this.build(tile));
      this.lastBuildMs = performance.now() - t0;
      this.queue.delete(key);
      built++;
    }
    return built;
  }

  get pending() {
    return this.concurrency > 0 ? this.inflight.size : this.queue.size;
  }

  clear() {
    this.epoch++;
    if (this.onEvict) for (const data of this.cache.values()) this.onEvict(data);
    this.cache.clear();
    this.queue.clear();
    this.inflight.clear();
  }
}
