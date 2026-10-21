// 32-bit integer hashing. Every random value in generation derives from here.
// hash(seed, layer, ...ints) is a pure function: same inputs, same output,
// regardless of call order. Integers may be any safe integer (negative or > 2^32).

const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;
const TWO_32 = 4294967296;

function mix(h, k) {
  k = Math.imul(k, C1);
  k = (k << 15) | (k >>> 17);
  k = Math.imul(k, C2);
  h ^= k;
  h = (h << 13) | (h >>> 19);
  return (Math.imul(h, 5) + 0xe6546b64) | 0;
}

function fmix(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// Mix both 32-bit halves so large and negative integers hash distinctly.
// The high half is skipped when zero (the common case), which still keeps
// every safe integer distinct.
function mixInt(h, v) {
  h = mix(h, v | 0);
  const hi = Math.floor(v / TWO_32);
  return hi === 0 ? h : mix(h, hi | 0);
}

export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix(h);
}

const layerIds = new Map();

// Layers are named streams ('district-centre', 'noise-preview', ...).
export function layerId(layer) {
  if (typeof layer === 'number') return layer >>> 0;
  let id = layerIds.get(layer);
  if (id === undefined) {
    id = hashString(layer);
    layerIds.set(layer, id);
  }
  return id;
}

export function seedFromText(text) {
  return hashString(String(text).trim());
}

export function hash(seed, layer, ...ints) {
  let h = mix(seed | 0, layerId(layer));
  for (let i = 0; i < ints.length; i++) h = mixInt(h, ints[i]);
  return fmix(h ^ ints.length);
}

// Fast path for hot loops: precompute hashBase(seed, layer) once, then
// hash2(base, x, y) === hash(seed, layer, x, y).
export function hashBase(seed, layer) {
  return mix(seed | 0, layerId(layer));
}

export function hash2(base, x, y) {
  return fmix(mixInt(mixInt(base, x), y) ^ 2);
}

export function toUnit(h) {
  return h / TWO_32;
}

export function hashFloat(seed, layer, ...ints) {
  return toUnit(hash(seed, layer, ...ints));
}
