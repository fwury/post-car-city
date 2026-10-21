// Seeded 2D gradient noise, fbm and domain warp. Lattice gradients come from
// hash2 of integer lattice coordinates, so any point evaluates the same
// regardless of what was sampled before it.

import { hashBase, hash2, layerId } from './hash.js';

const GRADS = 32;
const GX = new Float64Array(GRADS);
const GY = new Float64Array(GRADS);
for (let i = 0; i < GRADS; i++) {
  const a = ((i + 0.5) / GRADS) * Math.PI * 2;
  GX[i] = Math.cos(a);
  GY[i] = Math.sin(a);
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// Returns roughly [-1, 1]; exactly 0 at lattice points.
export function gradientNoise(base, x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const g00 = hash2(base, xi, yi) & 31;
  const g10 = hash2(base, xi + 1, yi) & 31;
  const g01 = hash2(base, xi, yi + 1) & 31;
  const g11 = hash2(base, xi + 1, yi + 1) & 31;
  const n00 = GX[g00] * fx + GY[g00] * fy;
  const n10 = GX[g10] * (fx - 1) + GY[g10] * fy;
  const n01 = GX[g01] * fx + GY[g01] * (fy - 1);
  const n11 = GX[g11] * (fx - 1) + GY[g11] * (fy - 1);
  const u = fade(fx);
  const v = fade(fy);
  const a = n00 + u * (n10 - n00);
  const b = n01 + u * (n11 - n01);
  return (a + v * (b - a)) * Math.SQRT2;
}

const MAX_OCTAVES = 12;

export function createNoise(seed, layer) {
  const id = layerId(layer);
  const bases = new Int32Array(MAX_OCTAVES);
  for (let o = 0; o < MAX_OCTAVES; o++) {
    bases[o] = hashBase(seed, (id ^ Math.imul(o + 1, 0x9e3779b9)) >>> 0);
  }
  return {
    noise(x, y) {
      return gradientNoise(bases[0], x, y);
    },
    // Normalised fractal sum, roughly [-1, 1] (mostly within +-0.7).
    fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
      let sum = 0;
      let amp = 1;
      let norm = 0;
      let f = 1;
      const n = Math.min(octaves, MAX_OCTAVES);
      for (let o = 0; o < n; o++) {
        sum += amp * gradientNoise(bases[o], x * f, y * f);
        norm += amp;
        amp *= gain;
        f *= lacunarity;
      }
      return sum / norm;
    },
  };
}

// Domain warp in world units: displaces (x, y) by up to about `amount` metres
// using noise with features about `scale` metres across.
export function createWarp(seed, layer, scale, amount, octaves = 3) {
  const nx = createNoise(seed, `${layer}:x`);
  const ny = createNoise(seed, `${layer}:y`);
  return (x, y, out = [0, 0]) => {
    const sx = x / scale;
    const sy = y / scale;
    out[0] = x + nx.fbm(sx, sy, octaves) * amount;
    out[1] = y + ny.fbm(sx, sy, octaves) * amount;
    return out;
  };
}
