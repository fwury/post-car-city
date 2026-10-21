// Run with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, hash2, hashBase, hashString, seedFromText, toUnit } from '../src/core/hash.js';
import { rngFor } from '../src/core/rng.js';
import { createNoise, createWarp } from '../src/core/noise.js';

const SEED = seedFromText('1');

test('hash gives identical output for identical input', () => {
  for (let i = -50; i < 50; i++) {
    assert.equal(hash(SEED, 'a', i, i * 7), hash(SEED, 'a', i, i * 7));
  }
});

test('hash2 fast path matches hash', () => {
  const base = hashBase(SEED, 'layer');
  for (const [x, y] of [[0, 0], [1, -1], [-123456, 987654], [2 ** 40, -(2 ** 35)]]) {
    assert.equal(hash2(base, x, y), hash(SEED, 'layer', x, y));
  }
});

test('hash separates seeds, layers, argument order and large integers', () => {
  const seen = new Set([
    hash(SEED, 'a', 1, 2),
    hash(SEED, 'a', 2, 1),
    hash(SEED, 'b', 1, 2),
    hash(SEED + 1, 'a', 1, 2),
    hash(SEED, 'a', 1, 2, 0),
    hash(SEED, 'a', 0),
    hash(SEED, 'a', 2 ** 32),
    hash(SEED, 'a', -1),
    hash(SEED, 'a', 2 ** 32 - 1),
  ]);
  assert.equal(seen.size, 9);
});

test('known values stay fixed across runs and platforms', () => {
  assert.equal(hashString('post-car city'), 3848528565);
  assert.equal(seedFromText(' 1 '), seedFromText('1'));
  assert.equal(hash(SEED, 'district-centre-x', 3, -2), 3830123192);
});

test('rng sequences repeat for the same hash', () => {
  const a = rngFor(SEED, 'r', 4, 5);
  const b = rngFor(SEED, 'r', 4, 5);
  for (let i = 0; i < 1000; i++) assert.equal(a.next(), b.next());
  const c = rngFor(SEED, 'r', 4, 6);
  assert.notEqual(rngFor(SEED, 'r', 4, 5).next(), c.next());
});

test('rng values are in range', () => {
  const r = rngFor(SEED, 'range');
  for (let i = 0; i < 5000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1);
    const n = r.int(3, 7);
    assert.ok(Number.isInteger(n) && n >= 3 && n <= 7);
  }
});

test('noise does not depend on sampling order', () => {
  const pts = [];
  for (let i = 0; i < 400; i++) pts.push([(i * 37.13) % 91 - 45, (i * 11.7) % 63 - 31]);
  const n1 = createNoise(SEED, 'n');
  const forward = pts.map(([x, y]) => n1.fbm(x, y, 5));
  const n2 = createNoise(SEED, 'n');
  const backward = [...pts].reverse().map(([x, y]) => n2.fbm(x, y, 5)).reverse();
  assert.deepEqual(forward, backward);
});

test('noise is continuous across lattice and tile edges', () => {
  const n = createNoise(SEED, 'n');
  for (let i = -20; i <= 20; i++) {
    const a = n.fbm(i - 1e-9, 0.37, 4);
    const b = n.fbm(i + 1e-9, 0.37, 4);
    assert.ok(Math.abs(a - b) < 1e-6, `jump at x=${i}`);
  }
  // A tile edge in world metres: sampling just either side matches.
  const warp = createWarp(SEED, 'w', 2400, 600, 2);
  const p = warp(500 - 1e-6, 1234);
  const q = warp(500 + 1e-6, 1234);
  assert.ok(Math.abs(p[0] - q[0]) < 1e-3 && Math.abs(p[1] - q[1]) < 1e-3);
});

test('noise stays in range', () => {
  const n = createNoise(SEED, 'range');
  for (let i = 0; i < 20000; i++) {
    const v = n.noise(i * 0.137, i * 0.071);
    assert.ok(v >= -1.0001 && v <= 1.0001);
  }
});

test('noise differs between seeds', () => {
  const a = createNoise(SEED, 'n');
  const b = createNoise(seedFromText('2'), 'n');
  let diff = 0;
  for (let i = 0; i < 100; i++) diff += Math.abs(a.fbm(i * 0.3, 0.5) - b.fbm(i * 0.3, 0.5));
  assert.ok(diff > 1);
});

test('unit conversion covers [0, 1)', () => {
  assert.equal(toUnit(0), 0);
  assert.ok(toUnit(0xffffffff) < 1);
});
