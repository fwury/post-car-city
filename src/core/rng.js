// Seeded generator (mulberry32). Create one per unit of work from a hash,
// e.g. rngFor(seed, 'neighbourhood-points', districtX, districtY).

import { hash } from './hash.js';

export class Rng {
  constructor(seed32) {
    this.state = seed32 | 0;
  }

  nextUint() {
    let t = (this.state = (this.state + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  // Uniform in [0, 1).
  next() {
    return this.nextUint() / 4294967296;
  }

  range(min, max) {
    return min + (max - min) * this.next();
  }

  // Integer in [min, max], inclusive.
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p) {
    return this.next() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  normal(mean = 0, sd = 1) {
    const u = 1 - this.next();
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

export function rngFor(seed, layer, ...ints) {
  return new Rng(hash(seed, layer, ...ints));
}
