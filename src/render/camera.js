// Camera: (x, y) is the world point at the viewport centre, in metres.
// World x grows east, world y grows south, so north is up on screen.
// zoom is in screen (CSS) pixels per metre.

export const MIN_ZOOM = 0.004;
export const MAX_ZOOM = 4;
export const WORLD_LIMIT = 1e9; // metres from the origin; far enough to be endless

const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
const ZOOM_EASE_SECONDS = 0.09;

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 0.05;
    this.width = 1;
    this.height = 1;
    this.reducedMotion = false;
    this.version = 0; // bumps on every change, so the app knows when to redraw
    this.anim = null;
  }

  setViewport(width, height) {
    this.width = width;
    this.height = height;
    this.version++;
  }

  set(x, y, zoom) {
    this.x = x;
    this.y = y;
    this.zoom = clampZoom(zoom);
    this.anim = null;
    this.clamp();
  }

  worldToScreen(wx, wy) {
    return [(wx - this.x) * this.zoom + this.width / 2, (wy - this.y) * this.zoom + this.height / 2];
  }

  screenToWorld(sx, sy) {
    return [(sx - this.width / 2) / this.zoom + this.x, (sy - this.height / 2) / this.zoom + this.y];
  }

  bounds() {
    const hw = this.width / 2 / this.zoom;
    const hh = this.height / 2 / this.zoom;
    return { x0: this.x - hw, y0: this.y - hh, x1: this.x + hw, y1: this.y + hh };
  }

  clamp() {
    this.x = Math.min(WORLD_LIMIT, Math.max(-WORLD_LIMIT, this.x));
    this.y = Math.min(WORLD_LIMIT, Math.max(-WORLD_LIMIT, this.y));
    this.version++;
  }

  // Move the view by a screen-space drag.
  panBy(dsx, dsy) {
    this.x -= dsx / this.zoom;
    this.y -= dsy / this.zoom;
    // Keep an in-flight zoom anchored to the same spot under the pointer.
    if (this.anim) {
      this.anim.sx += dsx;
      this.anim.sy += dsy;
    }
    this.clamp();
  }

  // Zoom by `factor`, keeping the world point under (sx, sy) fixed.
  zoomAt(sx, sy, factor, smooth = false) {
    const base = this.anim ? this.anim.target : this.zoom;
    const target = clampZoom(base * factor);
    if (!smooth || this.reducedMotion) {
      if (this.anim) this.anim = null;
      this.applyZoom(sx, sy, target);
      return;
    }
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.anim = { target, sx, sy, wx, wy };
  }

  applyZoom(sx, sy, z) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.zoom = z;
    this.x = wx - (sx - this.width / 2) / z;
    this.y = wy - (sy - this.height / 2) / z;
    this.clamp();
  }

  // Advance smooth zoom. Returns true while animating.
  update(dt) {
    const a = this.anim;
    if (!a) return false;
    const k = 1 - Math.exp(-dt / ZOOM_EASE_SECONDS);
    const lz = Math.log(this.zoom);
    const lt = Math.log(a.target);
    if (Math.abs(lt - lz) < 0.002) {
      this.zoom = a.target;
      this.anim = null;
    } else {
      this.zoom = Math.exp(lz + (lt - lz) * k);
    }
    this.x = a.wx - (a.sx - this.width / 2) / this.zoom;
    this.y = a.wy - (a.sy - this.height / 2) / this.zoom;
    this.clamp();
    return true;
  }
}
