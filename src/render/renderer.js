// Draw loop body: paints the map for the current camera, layer by layer.
// Far out, districts come from cached tiles (rendered in workers); close in,
// they are drawn as vectors straight to the screen.

import { createNoise, createWarp } from '../core/noise.js';
import { drawDistricts, drawDistrictOutlines, renderDistrictTile } from './districtLayer.js';
import { palette, fonts } from './styles.js';
import { TileManager } from './tiles.js';

export const VECTOR_MIN_ZOOM = 0.1; // below this, districts are drawn from tiles (rendered in workers)
export const LIVE_MIN_ZOOM = 2; // from here in, drawn live; between, from tiles drawn here and kept
const STATION_MIN_ZOOM = 0.02;
const NICE = [1, 2, 5];

// Smallest 1-2-5 step (in metres) that is at least `minPx` on screen.
function niceStep(zoom, minPx) {
  const raw = minPx / zoom;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const n of NICE) if (n * mag >= raw) return n * mag;
  return 10 * mag;
}

export function formatDistance(m) {
  const a = Math.abs(m);
  if (a >= 1000) {
    const km = m / 1000;
    const digits = Number.isInteger(km) ? 0 : 1;
    return `${km.toLocaleString('en', { maximumFractionDigits: digits, minimumFractionDigits: digits })} km`;
  }
  return `${Math.round(m)} m`;
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Noise preview tiles: warped fbm, banded like contours, sampled at world
// coordinates so neighbouring tiles join without seams.
export function createNoiseTileBuilder(getSeed, res = 96) {
  let seed = null;
  let noise;
  let warp;
  const p = [0, 0];
  return (tile) => {
    if (getSeed() !== seed) {
      seed = getSeed();
      noise = createNoise(seed, 'noise-preview');
      warp = createWarp(seed, 'noise-preview-warp', 2400, 600, 1);
    }
    const canvas = makeCanvas(res, res);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(res, res);
    const d = img.data;
    const step = tile.size / res;
    const [r0, g0, b0] = palette.noiseLow;
    const [r1, g1, b1] = palette.noiseHigh;
    let i = 0;
    for (let j = 0; j < res; j++) {
      const wy = tile.y0 + (j + 0.5) * step;
      for (let k = 0; k < res; k++) {
        const wx = tile.x0 + (k + 0.5) * step;
        warp(wx, wy, p);
        let t = noise.fbm(p[0] / 1600, p[1] / 1600, 4) * 0.8 + 0.5;
        t = Math.floor(Math.min(0.999, Math.max(0, t)) * 8) / 7;
        d[i++] = r0 + (r1 - r0) * t;
        d[i++] = g0 + (g1 - g0) * t;
        d[i++] = b0 + (b1 - b0) * t;
        d[i++] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return { canvas, res };
  };
}

// District tiles: in a worker when possible, otherwise on the main thread.
export function createDistrictTileBuilder({ pool, getWorld, getLayers, res = 512 }) {
  const layersFor = () => {
    const L = getLayers();
    return { cores: L.cores, streets: L.streets, green: L.green, outlines: L.outlines, neighbourhoods: L.neighbourhoods };
  };
  const local = (tile) => {
    const canvas = makeCanvas(res, res);
    renderDistrictTile(canvas.getContext('2d'), getWorld(), tile, layersFor(), res);
    return { canvas, res };
  };
  return async (tile) => {
    if (pool && !pool.broken) {
      try {
        const t = { level: tile.level, tx: tile.tx, ty: tile.ty, size: tile.size, x0: tile.x0, y0: tile.y0 };
        const bitmap = await pool.run({ seed: getWorld().seed, tile: t, layers: layersFor(), res });
        return { canvas: bitmap, res };
      } catch (err) {
        console.warn('Tile worker failed, drawing on the main thread instead.', err);
      }
    }
    return local(tile);
  };
}

export class Renderer {
  constructor(canvas, camera, { noiseTiles, districtTiles }, state, getWorld) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.camera = camera;
    this.noiseTiles = noiseTiles;
    this.districtTiles = districtTiles;
    this.state = state;
    this.getWorld = getWorld;
    this.dpr = 1;
    this.lastDrawMs = 0;
    this.visibleTiles = [];
    this.mode = 'tiles';
    // Mid zoom: the vector map drawn into tiles once, then just copied while
    // panning. Tiles are built a few per frame; until one is, its parent or
    // children stand in, or the map is drawn live underneath.
    this.vectorTiles = new TileManager({ build: (tile) => this.renderVectorTile(tile), baseSize: 32, minScreenPx: 256, maxEntries: 40 });
  }

  renderVectorTile(tile) {
    const res = Math.min(1024, Math.round(512 * this.dpr));
    const canvas = makeCanvas(res, res);
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = palette.land;
    ctx.fillRect(0, 0, res, res);
    const s = res / tile.size;
    const view = { x0: tile.x0, y0: tile.y0, s, w: res, h: res, zoom: s / this.dpr, pr: this.dpr, blocks: this.blocksFor };
    const items = drawDistricts(ctx, view, this.getWorld(), this.state.layers);
    if (this.state.layers.outlines) drawDistrictOutlines(ctx, view, items);
    return { canvas, res };
  }

  // Forget drawn tiles over a rectangle, e.g. once a district's blocks arrive.
  invalidate(x0, y0, x1, y1) {
    this.vectorTiles.invalidate(x0, y0, x1, y1);
  }

  clearVectorTiles() {
    this.vectorTiles.clear();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.camera.setViewport(w, h);
  }

  // Snap a CSS-pixel coordinate to the device pixel grid.
  snap(v) {
    return Math.round(v * this.dpr) / this.dpr;
  }

  // Centre of a device pixel, for crisp 1px lines.
  crisp(v) {
    return (Math.floor(v * this.dpr) + 0.5) / this.dpr;
  }

  resetTransform() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  draw() {
    const t0 = performance.now();
    if ((window.devicePixelRatio || 1) !== this.dpr) this.resize();
    const { ctx, camera, state } = this;
    const L = state.layers;
    this.resetTransform();
    ctx.fillStyle = palette.land;
    ctx.fillRect(0, 0, camera.width, camera.height);

    this.noiseTiles.beginFrame();
    this.districtTiles.beginFrame();
    const dvis = this.districtTiles.visible(camera);
    this.visibleTiles = dvis;

    if (camera.zoom < VECTOR_MIN_ZOOM) {
      this.mode = 'tiles';
      this.drawTileLayer(this.districtTiles, dvis, true);
    } else if (camera.zoom < LIVE_MIN_ZOOM) {
      this.mode = 'vector tiles';
      this.vectorTiles.beginFrame();
      const vis = this.vectorTiles.visible(camera);
      // Anything not covered by a tile or a stand-in is drawn live first.
      const covered = vis.every((t) => this.vectorTiles.peek(t) || this.vectorTiles.ancestor(t) || this.vectorTiles.children(t).length === 4);
      if (!covered) this.drawLive(L);
      this.drawTileLayer(this.vectorTiles, vis, true);
    } else {
      this.mode = 'vector';
      const b = camera.bounds();
      const view = { x0: b.x0, y0: b.y0, s: camera.zoom * this.dpr, w: this.canvas.width, h: this.canvas.height, zoom: camera.zoom, pr: this.dpr, blocks: this.blocksFor };
      const items = drawDistricts(ctx, view, this.getWorld(), L);
      if (L.outlines) drawDistrictOutlines(ctx, view, items);
      this.resetTransform();
    }

    if (this.selected) this.drawSelection(this.selected, L.heights === '3d');

    if (L.noise) {
      ctx.globalAlpha = 0.55;
      this.drawTileLayer(this.noiseTiles, this.noiseTiles.visible(camera), false);
      ctx.globalAlpha = 1;
    }
    if (L.transit && camera.zoom >= STATION_MIN_ZOOM) this.drawStations();
    if (L.grid) this.drawGrid();
    if (L.tiles) this.drawTileOutlines(dvis);
    this.drawScaleBar();
    this.lastDrawMs = performance.now() - t0;
  }

  // The clicked building, outlined (at its roof, in 3D).
  drawSelection(b, raised) {
    const { ctx, camera } = this;
    const parts = b.tower ? [b, b.tower] : [b];
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = palette.selection;
    ctx.lineJoin = 'round';
    for (const part of parts) {
      const h = raised ? part.h : 0;
      ctx.beginPath();
      part.pts.forEach(([x, y], i) => {
        const [sx, sy] = camera.worldToScreen(x + 0.32 * h, y - 0.8 * h);
        if (i) ctx.lineTo(sx, sy);
        else ctx.moveTo(sx, sy);
      });
      ctx.closePath();
      ctx.stroke();
    }
  }

  drawLive(L) {
    const { camera } = this;
    const b = camera.bounds();
    const view = { x0: b.x0, y0: b.y0, s: camera.zoom * this.dpr, w: this.canvas.width, h: this.canvas.height, zoom: camera.zoom, pr: this.dpr, blocks: this.blocksFor };
    const items = drawDistricts(this.ctx, view, this.getWorld(), L);
    if (L.outlines) drawDistrictOutlines(this.ctx, view, items);
    this.resetTransform();
  }

  tileRect(tile) {
    const [x0, y0] = this.camera.worldToScreen(tile.x0, tile.y0);
    const [x1, y1] = this.camera.worldToScreen(tile.x0 + tile.size, tile.y0 + tile.size);
    const sx0 = this.snap(x0);
    const sy0 = this.snap(y0);
    return [sx0, sy0, this.snap(x1) - sx0, this.snap(y1) - sy0];
  }

  drawSub(data, src, tile) {
    const f = data.res / src.size;
    const [x, y, w, h] = this.tileRect(tile);
    this.ctx.drawImage(data.canvas, (tile.x0 - src.x0) * f, (tile.y0 - src.y0) * f, tile.size * f, tile.size * f, x, y, w, h);
  }

  // Draw cached tiles, standing in with a parent or children while one builds.
  drawTileLayer(tm, vis, smooth) {
    const { ctx } = this;
    ctx.imageSmoothingEnabled = smooth;
    for (const tile of vis) {
      const data = tm.get(tile);
      tile.ready = data !== null;
      if (data) {
        const [x, y, w, h] = this.tileRect(tile);
        ctx.drawImage(data.canvas, x, y, w, h);
        continue;
      }
      const kids = tm.children(tile);
      if (kids.length === 4) {
        for (const k of kids) {
          const [x, y, w, h] = this.tileRect(k.tile);
          ctx.drawImage(k.data.canvas, x, y, w, h);
        }
        continue;
      }
      const anc = tm.ancestor(tile);
      if (anc) this.drawSub(anc.data, anc.tile, tile);
    }
    ctx.imageSmoothingEnabled = true;
  }

  drawStations() {
    const { camera } = this;
    const b = camera.bounds();
    const m = 40 / camera.zoom;
    const big = camera.zoom >= 0.06;
    for (const c of this.getWorld().coresInRect(b.x0 - m, b.y0 - m, b.x1 + m, b.y1 + m)) {
      const [sx, sy] = camera.worldToScreen(c.x, c.y);
      if (big) this.stationBadge(sx, sy);
      else this.stationDot(sx, sy);
    }
  }

  stationDot(sx, sy) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fillStyle = palette.rail;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = palette.stationRing;
    ctx.stroke();
  }

  // Regional rail station: rounded badge with a simple train glyph.
  stationBadge(x, y) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = palette.stationRing;
    ctx.beginPath();
    ctx.roundRect(-10, -10, 20, 20, 5);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = palette.rail;
    ctx.beginPath();
    ctx.roundRect(-8.5, -8.5, 17, 17, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect(-4.5, -6, 9, 9.5, 2.2);
    ctx.fill();
    ctx.fillStyle = palette.rail;
    ctx.fillRect(-3, -4.5, 6, 3);
    ctx.beginPath();
    ctx.arc(-2.2, 1.2, 0.9, 0, Math.PI * 2);
    ctx.arc(2.2, 1.2, 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-2.5, 4.5);
    ctx.lineTo(-4, 6.5);
    ctx.moveTo(2.5, 4.5);
    ctx.lineTo(4, 6.5);
    ctx.stroke();
    ctx.restore();
  }

  drawGrid() {
    const { ctx, camera } = this;
    const step = niceStep(camera.zoom, 90);
    const b = camera.bounds();
    ctx.lineWidth = 1 / this.dpr;
    ctx.font = fonts.small;
    ctx.textBaseline = 'middle';

    const xs = [];
    const ys = [];
    for (let v = Math.ceil(b.x0 / step) * step; v <= b.x1; v += step) xs.push(v);
    for (let v = Math.ceil(b.y0 / step) * step; v <= b.y1; v += step) ys.push(v);

    for (const axis of [false, true]) {
      ctx.strokeStyle = axis ? palette.gridAxis : palette.gridLine;
      ctx.beginPath();
      for (const v of xs) {
        if ((v === 0) !== axis) continue;
        const sx = this.crisp(camera.worldToScreen(v, 0)[0]);
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, camera.height);
      }
      for (const v of ys) {
        if ((v === 0) !== axis) continue;
        const sy = this.crisp(camera.worldToScreen(0, v)[1]);
        ctx.moveTo(0, sy);
        ctx.lineTo(camera.width, sy);
      }
      ctx.stroke();
    }

    for (const v of xs) {
      const sx = camera.worldToScreen(v, 0)[0];
      this.label(formatDistance(v), sx + 4, 12, 'left');
    }
    for (const v of ys) {
      const sy = camera.worldToScreen(0, v)[1];
      this.label(formatDistance(v), 6, sy - 9, 'left');
    }
  }

  label(text, x, y, align = 'left', color = palette.ink) {
    const { ctx } = this;
    ctx.textAlign = align;
    const w = ctx.measureText(text).width;
    const bx = align === 'left' ? x - 3 : align === 'center' ? x - w / 2 - 3 : x - w - 3;
    ctx.fillStyle = palette.labelBg;
    ctx.fillRect(bx, y - 7, w + 6, 14);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y + 0.5);
  }

  drawTileOutlines(vis) {
    const { ctx } = this;
    ctx.lineWidth = 1 / this.dpr;
    ctx.strokeStyle = palette.tileLine;
    ctx.font = fonts.small;
    ctx.textBaseline = 'middle';
    for (const tile of vis) {
      const [x, y, w, h] = this.tileRect(tile);
      if (this.mode === 'tiles' && !tile.ready) {
        ctx.fillStyle = palette.tilePending;
        ctx.fillRect(x, y, w, h);
      }
      ctx.strokeRect(this.crisp(x), this.crisp(y), w, h);
      if (w >= 90) this.label(`L${tile.level} ${tile.tx}, ${tile.ty}`, x + 8, y + h - 12, 'left', palette.tileLine);
    }
  }

  drawScaleBar() {
    const { ctx, camera } = this;
    let m = niceStep(camera.zoom, 60);
    if (m * camera.zoom > 160) m /= 2;
    const px = m * camera.zoom;
    const x1 = camera.width - 20;
    const x0 = x1 - px;
    const y = camera.height - 22;
    ctx.font = fonts.scale;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const text = formatDistance(m);
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.roundRect(x0 - 10, y - 20, px + 20, 30, 8);
    ctx.fill();
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 2;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(x0, y - 4);
    ctx.lineTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.lineTo(x1, y - 4);
    ctx.stroke();
    ctx.fillStyle = palette.ink;
    ctx.fillText(text, x0 + (px - tw) / 2, y - 7);
  }
}
