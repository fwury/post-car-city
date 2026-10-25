// The central station's site, chosen before the rail is laid: on a
// boulevard near the city's centre, a large station plaza along it, and
// behind the plaza the station's hall, its long side to the plaza and
// parallel to the street. The rail through the centre then runs straight
// beneath the hall, along it (the platforms underground).

import { STREET_TYPES } from './streetTypes.js';

export const HALL = [300, 60]; // metres: the hall's length and depth
const SIZES = [[300, 90], [260, 80], [220, 70]]; // hall length and plaza depth to try, largest first
const FRONT = STREET_TYPES.boulevard.width / 2 + 1; // metres from the boulevard's centreline to the plaza
const REACH = 650; // metres from the core the site's frontage may be
const CHOICES = 5; // sites offered to the rail
const UNLIKE = (20 * Math.PI) / 180; // sites turned this much apart are different
const STRAIGHT = 6; // metres the boulevard may stray from straight along the site's frontage

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (v) => Math.hypot(v[0], v[1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const unit = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};
const crossZ = (a, b) => a[0] * b[1] - a[1] * b[0];
function segHit(a, b, c, d) {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = crossZ(r, s);
  if (Math.abs(den) < 1e-9) return false;
  const t = crossZ(sub(c, a), s) / den;
  const u = crossZ(sub(c, a), r) / den;
  return t > 0 && t < 1 && u > 0 && u < 1;
}
function inside(P, q) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if (P[i][1] > q[1] !== P[j][1] > q[1] && q[0] < ((P[j][0] - P[i][0]) * (q[1] - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c;
  }
  return c;
}

// b: the central district's base (station, rings); lines: its boulevards'
// centrelines; onLand(q): whether q is on its land (not water, not a park).
// Returns the sites that fit, best first and unlike each other (the rail
// takes the first it can run through): each { p (the hall's middle), dir
// (along the street), hall, plaza, length (the hall's), back (metres from
// the street's centreline to the hall), front (the point on the street
// before it), side (from the street towards it) }.
export function centralStationSites(b, lines, onLand) {
  const S = b.station;
  const found = [];
  for (const [HL, PD] of SIZES) {
    for (const P of lines) {
      const cum = [0];
      for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + len(sub(P[i], P[i - 1])));
      for (let i = 1; i < P.length - 1; i++) {
        const s = len(sub(P[i], S));
        if (s > REACH) continue;
        // The frontage: where the boulevard runs straight for the hall's length.
        let a = i;
        let z = i;
        while (a > 0 && cum[i] - cum[a] < HL / 2 + 20) a--;
        while (z < P.length - 1 && cum[z] - cum[i] < HL / 2 + 20) z++;
        if (cum[i] - cum[a] < HL / 2 || cum[z] - cum[i] < HL / 2) continue;
        const t = unit(sub(P[z], P[a]));
        const n = [-t[1], t[0]];
        let bent = false;
        for (let k = a; k <= z && !bent; k++) if (Math.abs(dot(sub(P[k], P[i]), n)) > STRAIGHT) bent = true;
        if (bent) continue;
        for (const sg of [1, -1]) {
          const at = (u, v) => add(P[i], add(mul(t, u), mul(n, sg * v)));
          const plaza = [at(-HL / 2, FRONT), at(HL / 2, FRONT), at(HL / 2, FRONT + PD), at(-HL / 2, FRONT + PD)];
          const hall = [at(-HL / 2, FRONT + PD), at(HL / 2, FRONT + PD), at(HL / 2, FRONT + PD + HALL[1]), at(-HL / 2, FRONT + PD + HALL[1])];
          const whole = [plaza[0], plaza[1], hall[2], hall[3]];
          // Clear of every other boulevard, and all on land.
          let clear = true;
          for (const Q of lines) {
            for (let k = 0; k < Q.length - 1 && clear; k++) {
              if (inside(whole, Q[k]) || whole.some((w, m) => segHit(w, whole[(m + 1) % 4], Q[k], Q[k + 1]))) clear = false;
            }
            if (!clear) break;
          }
          if (!clear) continue;
          for (let u = -HL / 2; u <= HL / 2 && clear; u += 30) for (let v = FRONT; v <= FRONT + PD + HALL[1] && clear; v += 25) if (!onLand(at(u, v))) clear = false;
          if (!clear) continue;
          const score = Math.abs(s) + (HALL[0] - HL) * 3;
          found.push({ score, p: at(0, FRONT + PD + HALL[1] / 2), dir: t, hall, plaza, length: HL, back: FRONT + PD, front: at(0, 0), side: mul(n, sg) });
        }
      }
    }
  }
  found.sort((x, y) => x.score - y.score);
  // (The best for each way the hall may lie: the rail through it can then
  // run out more ways.)
  const out = [];
  for (const f of found) if (out.length < CHOICES && out.every((o) => Math.abs(dot(o.dir, f.dir)) < Math.cos(UNLIKE))) out.push(f);
  return out;
}
