// Tram stops along boulevards and main streets.
//
// About every 300 to 400 m, and where it matters: first at junctions with
// other main streets and boulevards, then beside squares, schools,
// hospitals, the cathedral and the station; long gaps are filled in between.
// A stop sits on the street's centreline, where the tracks part round an
// island platform (main streets) or have a platform either side
// (boulevards). Stops keep clear of the ends of a street that runs under a
// greenway.

const MIN_GAP = 280; // metres between stops along a street
const MAX_GAP = 420;
const END_CLEAR = 70; // metres from a street's end at a greenway
const NEAR = 140;
const CLEAR = 36; // metres from a stop's middle to the nearest junction: half a platform and the crossing street // a place this close to a street gets a stop beside it

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

function params(P) {
  const cum = [0];
  for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + len(sub(P[i], P[i - 1])));
  return cum;
}
function at(P, cum, s) {
  let i = 0;
  while (i < P.length - 2 && cum[i + 1] < s) i++;
  const t = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
  const d = sub(P[i + 1], P[i]);
  const l = len(d) || 1;
  return { p: [P[i][0] + d[0] * t, P[i][1] + d[1] * t], dir: [d[0] / l, d[1] / l] };
}
// The arc length on P nearest q, with the distance.
function project(P, cum, q) {
  let best = null;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i];
    const d = sub(P[i + 1], a);
    const l2 = d[0] * d[0] + d[1] * d[1];
    const t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]) / l2)) : 0;
    const f = [a[0] + d[0] * t, a[1] + d[1] * t];
    const r = len(sub(f, q));
    if (!best || r < best.r) best = { s: cum[i] + Math.sqrt(l2) * t, r };
  }
  return best;
}

// Returns { stops, junctions }: junctions are where the streets cross or
// meet, for drawing.
export function tramStops(d, blocks, local = []) {
  const lines = [
    ...d.network.lines.filter((l) => l.kind !== 'roundabout').map((l) => ({ pts: l.points, kind: 'boulevard', ends: [true, true] })),
    ...d.stage3.lines.map((l) => ({ pts: l.points, kind: 'main', ends: [!!l.crossing, !!l.crossingEnd] })),
  ];
  for (const l of lines) l.cum = params(l.pts);
  // Junctions between streets: where segments of two of them cross or meet.
  const junctions = lines.map(() => []);
  const points = [];
  for (let a = 0; a < lines.length; a++) {
    for (let b = a + 1; b < lines.length; b++) {
      const A = lines[a].pts;
      const B = lines[b].pts;
      for (let i = 0; i < A.length - 1; i++) {
        const p = A[i];
        const r = sub(A[i + 1], p);
        for (let j = 0; j < B.length - 1; j++) {
          const q = B[j];
          const s2 = sub(B[j + 1], q);
          const den = cross(r, s2);
          if (Math.abs(den) < 1e-9) continue;
          const t = cross(sub(q, p), s2) / den;
          const u = cross(sub(q, p), r) / den;
          if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) continue;
          junctions[a].push(lines[a].cum[i] + len(r) * Math.max(0, Math.min(1, t)));
          points.push([p[0] + r[0] * t, p[1] + r[1] * t]);
          junctions[b].push(lines[b].cum[j] + len(s2) * Math.max(0, Math.min(1, u)));
        }
      }
    }
  }
  // Ends of a street that stop on or just short of another street.
  for (let a = 0; a < lines.length; a++) {
    for (const end of [0, lines[a].pts.length - 1]) {
      const q = lines[a].pts[end];
      for (let b = 0; b < lines.length; b++) {
        if (b === a) continue;
        const pr = project(lines[b].pts, lines[b].cum, q);
        if (pr.r > 6) continue;
        junctions[a].push(lines[a].cum[end]);
        junctions[b].push(pr.s);
        points.push(q);
      }
    }
  }
  // Where every street meets a tram street, stops keep clear: the tram
  // streets' own junctions and the local streets meeting them.
  const avoid = junctions.map((j) => j.slice());
  // Tram street segments by grid cell, to find the ones near a point.
  const G = 40;
  const grid = new Map();
  lines.forEach((l, li) => {
    for (let i = 0; i < l.pts.length - 1; i++) {
      const [a, c] = [l.pts[i], l.pts[i + 1]];
      for (let gx = Math.floor((Math.min(a[0], c[0]) - 24) / G); gx <= Math.floor((Math.max(a[0], c[0]) + 24) / G); gx++) {
        for (let gy = Math.floor((Math.min(a[1], c[1]) - 24) / G); gy <= Math.floor((Math.max(a[1], c[1]) + 24) / G); gy++) {
          const k = gx * 100003 + gy;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push([li, i]);
        }
      }
    }
  });
  const seen = new Set();
  for (const st of local) {
    for (const [a, c] of st.segs) {
      for (const q of [a, c]) {
        const key = `${Math.round(q[0])},${Math.round(q[1])}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const best = new Map();
        for (const [li, i] of grid.get(Math.floor(q[0] / G) * 100003 + Math.floor(q[1] / G)) || []) {
          const l = lines[li];
          const p0 = l.pts[i];
          const d = sub(l.pts[i + 1], p0);
          const l2 = d[0] * d[0] + d[1] * d[1];
          const t = l2 ? Math.max(0, Math.min(1, ((q[0] - p0[0]) * d[0] + (q[1] - p0[1]) * d[1]) / l2)) : 0;
          const r = Math.hypot(p0[0] + d[0] * t - q[0], p0[1] + d[1] * t - q[1]);
          if (r < 24 && (!best.has(li) || r < best.get(li).r)) best.set(li, { r, s: l.cum[i] + Math.sqrt(l2) * t });
        }
        for (const [li, v] of best) avoid[li].push(v.s);
      }
    }
  }
  // Places worth a stop.
  const places = [d.station];
  for (const b of blocks) {
    if (['square', 'cathedral', 'hospital', 'school', 'elementarySchool', 'recCentre', 'campus'].includes(b.use) && b.pts) {
      let x = 0;
      let y = 0;
      for (const p of b.pts) {
        x += p[0] / b.pts.length;
        y += p[1] / b.pts.length;
      }
      places.push([x, y]);
    }
  }
  const stops = [];
  lines.forEach((l, li) => {
    const L = l.cum[l.cum.length - 1];
    const lo = l.ends[0] ? END_CLEAR : 0;
    const hi = l.ends[1] ? L - END_CLEAR : L;
    if (hi - lo < 60) return;
    // The nearest place to s where a whole platform is clear of junctions.
    const settle = (s0) => {
      for (let k = 0; k <= 40; k++) {
        for (const sgn of k ? [1, -1] : [1]) {
          const s = s0 + sgn * k * 4;
          if (s < lo || s > hi) continue;
          if (avoid[li].every((a) => Math.abs(a - s) >= CLEAR)) return s;
        }
      }
      return null;
    };
    const cands = [];
    // A stop at a junction stands just past it.
    for (const s of junctions[li]) {
      const t = settle(s + CLEAR);
      if (t !== null) cands.push({ s: t, w: 3 });
    }
    for (const q of places) {
      const pr = project(l.pts, l.cum, q);
      const t = pr.r < NEAR ? settle(pr.s) : null;
      if (t !== null) cands.push({ s: t, w: q === d.station ? 4 : 2 });
    }
    cands.sort((x, y) => y.w - x.w || x.s - y.s);
    const chosen = [];
    for (const c of cands) if (chosen.every((o) => Math.abs(o - c.s) >= MIN_GAP)) chosen.push(c.s);
    // Fill long gaps, ends included.
    chosen.sort((x, y) => x - y);
    const marks = [lo - MIN_GAP / 2, ...chosen, hi + MIN_GAP / 2];
    const all = [];
    for (let k = 0; k < marks.length - 1; k++) {
      if (k > 0) all.push(marks[k]);
      const gap = marks[k + 1] - marks[k];
      const n = Math.floor(gap / MAX_GAP);
      for (let j = 1; j <= n; j++) {
        const s = marks[k] + (gap * j) / (n + 1);
        if (s >= lo && s <= hi) all.push(s);
      }
    }
    const kept = [];
    for (const s0 of all) {
      const s = settle(s0);
      if (s === null || kept.some((o) => Math.abs(o - s) < MIN_GAP / 2)) continue;
      kept.push(s);
      const { p, dir } = at(l.pts, l.cum, s);
      stops.push({ p, dir, kind: l.kind });
    }
  });
  // Junction points, one for each place streets meet.
  const merged = [];
  for (const q of points) if (!merged.some((m) => len(sub(m, q)) < 8)) merged.push(q);
  return { stops, junctions: merged };
}
