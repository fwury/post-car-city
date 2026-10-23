// Pointer, wheel, touch and keyboard input for the camera.

const PAN_SPEED = 700; // screen pixels per second for arrow keys
const KEY_ZOOM = 1.6;

const PAN_KEYS = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  a: [-1, 0], d: [1, 0], w: [0, -1], s: [0, 1],
};

export function attachInput(canvas, camera) {
  const pointers = new Map();
  const held = new Set();
  // onTap(point) is called for a short press that did not move: a click.
  const input = { hover: null, onTap: null };
  let press = null;

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= canvas.clientHeight;
    // Trackpad pinch arrives as ctrl+wheel with small deltas.
    const k = e.ctrlKey ? 0.01 : 0.0015;
    const [sx, sy] = local(e);
    camera.zoomAt(sx, sy, Math.exp(-dy * k), !e.ctrlKey && Math.abs(dy) >= 40);
  }, { passive: false });

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, local(e));
    press = pointers.size === 1 ? { p: local(e), t: performance.now() } : null;
    canvas.classList.add('dragging');
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    input.hover = p;
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    if (pointers.size === 1) {
      camera.panBy(p[0] - prev[0], p[1] - prev[1]);
      pointers.set(e.pointerId, p);
      return;
    }
    // Two-finger pinch: pan by the centroid, zoom by the change in spread.
    const others = [...pointers].filter(([id]) => id !== e.pointerId).map(([, v]) => v);
    const q = others[0];
    const c0 = [(prev[0] + q[0]) / 2, (prev[1] + q[1]) / 2];
    const c1 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const d0 = Math.hypot(prev[0] - q[0], prev[1] - q[1]);
    const d1 = Math.hypot(p[0] - q[0], p[1] - q[1]);
    camera.panBy(c1[0] - c0[0], c1[1] - c0[1]);
    if (d0 > 0) camera.zoomAt(c1[0], c1[1], d1 / d0);
    pointers.set(e.pointerId, p);
  });

  const release = (e) => {
    if (press && e.type === 'pointerup' && pointers.size === 1) {
      const p = local(e);
      if (Math.hypot(p[0] - press.p[0], p[1] - press.p[1]) < 6 && performance.now() - press.t < 500 && input.onTap) input.onTap(p);
    }
    press = null;
    pointers.delete(e.pointerId);
    if (pointers.size === 0) canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse') input.hover = null;
  });

  canvas.addEventListener('dblclick', (e) => {
    const [sx, sy] = local(e);
    camera.zoomAt(sx, sy, e.shiftKey ? 0.5 : 2, true);
  });

  const typing = (e) => e.target instanceof Element && e.target.closest('input, textarea, select');

  window.addEventListener('keydown', (e) => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (PAN_KEYS[key]) {
      held.add(key);
      e.preventDefault();
    } else if (key === '+' || key === '=') {
      camera.zoomAt(camera.width / 2, camera.height / 2, KEY_ZOOM, true);
      e.preventDefault();
    } else if (key === '-' || key === '_') {
      camera.zoomAt(camera.width / 2, camera.height / 2, 1 / KEY_ZOOM, true);
      e.preventDefault();
    }
    if (e.shiftKey) held.add('Shift');
  });

  window.addEventListener('keyup', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    held.delete(key);
    if (key === 'Shift') held.delete('Shift');
  });
  window.addEventListener('blur', () => held.clear());

  // Apply held keys. Returns true if the camera moved.
  input.update = (dt) => {
    let dx = 0;
    let dy = 0;
    for (const k of held) {
      const v = PAN_KEYS[k];
      if (v) {
        dx += v[0];
        dy += v[1];
      }
    }
    if (dx === 0 && dy === 0) return false;
    const len = Math.hypot(dx, dy);
    const speed = PAN_SPEED * (held.has('Shift') ? 2.5 : 1) * dt;
    camera.panBy((-dx / len) * speed, (-dy / len) * speed);
    return true;
  };

  return input;
}
