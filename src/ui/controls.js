// Seed input, layer toggles, zoom buttons and URL sync (seed, x, y, zoom).

const DEFAULT_VIEW = { seed: '1', x: 0, y: 0, zoom: 0.03 };
const LAYERS_KEY = 'post-car-city:layers:v3';
export const MAP_LAYERS = ['cores', 'streets', 'green', 'outlines', 'neighbourhoods'];
export const DEFAULT_LAYERS = {
  cores: true, streets: true, green: true, transit: true, neighbourhoods: true,
  outlines: false, noise: false, grid: false, tiles: false, hud: true,
};

export function readUrlState() {
  const p = new URLSearchParams(window.location.search);
  const num = (name, fallback) => {
    const v = Number.parseFloat(p.get(name));
    return Number.isFinite(v) ? v : fallback;
  };
  const seed = (p.get('seed') ?? '').trim() || DEFAULT_VIEW.seed;
  return {
    seed,
    x: num('x', DEFAULT_VIEW.x),
    y: num('y', DEFAULT_VIEW.y),
    zoom: num('zoom', DEFAULT_VIEW.zoom),
  };
}

// Writes the view to the URL at most a few times a second.
export function createUrlSync(getState) {
  let timer = null;
  const write = () => {
    timer = null;
    const { seed, x, y, zoom } = getState();
    const p = new URLSearchParams();
    p.set('seed', seed);
    p.set('x', x.toFixed(2));
    p.set('y', y.toFixed(2));
    p.set('zoom', String(Number(zoom.toPrecision(6))));
    const url = `${window.location.pathname}?${p}`;
    if (url !== window.location.pathname + window.location.search) history.replaceState(null, '', url);
  };
  return {
    schedule() {
      if (timer === null) timer = setTimeout(write, 250);
    },
    now: write,
  };
}

export function loadLayers() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYERS_KEY) || '{}');
    return { ...DEFAULT_LAYERS, ...saved };
  } catch {
    return { ...DEFAULT_LAYERS };
  }
}

function saveLayers(layers) {
  try {
    localStorage.setItem(LAYERS_KEY, JSON.stringify(layers));
  } catch {
    // Storage can be unavailable; layers then reset on reload.
  }
}

function randomSeedText() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(100000 + (a[0] % 900000));
}

export function setupControls({ state, camera, onSeed, onLayers }) {
  const form = document.getElementById('seed-form');
  const input = document.getElementById('seed');
  const newSeed = document.getElementById('new-seed');
  input.value = state.seedText;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) {
      input.value = state.seedText;
      return;
    }
    onSeed(text);
  });

  newSeed.addEventListener('click', () => {
    const text = randomSeedText();
    input.value = text;
    onSeed(text);
  });

  for (const box of document.querySelectorAll('input[data-layer]')) {
    const name = box.dataset.layer;
    box.checked = Boolean(state.layers[name]);
    box.addEventListener('change', () => {
      state.layers[name] = box.checked;
      saveLayers(state.layers);
      onLayers(name);
    });
  }

  const centre = () => [camera.width / 2, camera.height / 2];
  document.getElementById('zoom-in').addEventListener('click', () => camera.zoomAt(...centre(), 2, true));
  document.getElementById('zoom-out').addEventListener('click', () => camera.zoomAt(...centre(), 0.5, true));

  const panel = document.getElementById('panel');
  if (window.matchMedia('(max-width: 600px)').matches) panel.open = false;
}
