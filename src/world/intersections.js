// Stage 5: how each junction is laid out, by the kinds of street that meet.
//
//   main or boulevard x main or boulevard: signalised, with zebra crossings
//     on every arm, stop lines, and a Dutch protected layout for bikes:
//     the cycle tracks swing out round islands at the corners, so a turning
//     cyclist is never beside a turning car;
//   local x main, a local street meeting from both sides (lined up): a zebra
//     crossing over the main street, on a raised table;
//   local x main, a T: the main street's pavement and cycle track run on
//     across the mouth of the local street (a continuous sidewalk), cars
//     ramping over it as over a driveway;
//   local x local: a raised table, at pavement height, since a local street
//     is one where cars are guests;
//   pedestrian or rail lane x local: paving carries on, as local x local.
//
// Each is { kind, p, ... } in world coordinates.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const unit = (v) => {
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l];
};
const ALIGN = 9; // metres: local streets meeting a main street this close across it are lined up
const ARM = 26; // metres out from a junction its arms' directions are read

// The nearest point on a polyline, with the tangent there.
function nearestOn(P, q) {
  let best = null;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i];
    const ab = sub(P[i + 1], a);
    const l2 = dot(ab, ab);
    if (!l2) continue;
    const t = Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2));
    const f = [a[0] + ab[0] * t, a[1] + ab[1] * t];
    const r = len(sub(f, q));
    if (!best || r < best.r) best = { r, f, t: unit(ab), i, s: t };
  }
  return best;
}

// A point along a polyline from index i, s metres on (either way).
function along(P, i0, f, s) {
  let p = f;
  let left = Math.abs(s);
  if (s > 0) {
    for (let i = i0 + 1; i < P.length; i++) {
      const l = len(sub(P[i], p));
      if (l >= left) return [p[0] + ((P[i][0] - p[0]) * left) / l, p[1] + ((P[i][1] - p[1]) * left) / l];
      left -= l;
      p = P[i];
    }
  } else {
    for (let i = i0; i >= 0; i--) {
      const l = len(sub(P[i], p));
      if (l >= left) return [p[0] + ((P[i][0] - p[0]) * left) / (l || 1), p[1] + ((P[i][1] - p[1]) * left) / (l || 1)];
      left -= l;
      p = P[i];
    }
  }
  return null;
}

// mains: [{ pts, type: 'mainStreet' | 'boulevard' }]; signals: points where
// tram streets meet; local: local streets ({ kind, segs, lines }).
export function planIntersections(mains, signals, local) {
  const out = [];
  // ---- Signalised junctions ----
  for (const p of signals) {
    const arms = [];
    for (const m of mains) {
      const n = nearestOn(m.pts, p);
      if (!n || n.r > 4) continue;
      for (const sgn of [1, -1]) {
        const q = along(m.pts, n.i, n.f, sgn * ARM);
        if (!q || len(sub(q, p)) < ARM * 0.6) continue;
        const dir = unit(sub(q, p));
        if (arms.some((a) => dot(a.dir, dir) > 0.9)) continue;
        arms.push({ dir, type: m.type });
      }
    }
    if (arms.length >= 3) {
      arms.sort((a, b) => Math.atan2(a.dir[1], a.dir[0]) - Math.atan2(b.dir[1], b.dir[0]));
      out.push({ kind: 'signal', p, arms });
    }
  }
  const nearSignal = (q) => out.some((o) => o.kind === 'signal' && len(sub(o.p, q)) < 40);

  // ---- Local streets meeting main streets ----
  const ends = [];
  const degree = new Map();
  const key = (q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`;
  for (const st of local) {
    for (const [a, b] of st.segs) {
      for (const q of [a, b]) {
        const k = key(q);
        if (!degree.has(k)) degree.set(k, { q, n: 0, kinds: new Set() });
        const e = degree.get(k);
        e.n++;
        e.kinds.add(st.kind);
      }
    }
    for (const L of st.lines || []) {
      if (L.length < 2 || st.kind === 'rail') continue;
      for (const [q, r] of [[L[0], L[1]], [L[L.length - 1], L[L.length - 2]]]) {
        for (const m of mains) {
          const n = nearestOn(m.pts, q);
          if (!n || n.r > 1.5) continue;
          const dir = unit(sub(r, q)); // into the local street
          const side = Math.sign(cross(n.t, dir));
          ends.push({ p: n.f, t: n.t, side, type: m.type, dir, kind: st.kind });
          break;
        }
      }
    }
  }
  const used = new Set();
  ends.forEach((e, i) => {
    if (used.has(i) || nearSignal(e.p)) return;
    // Another meeting it from the far side, lined up: a crossing.
    const j = ends.findIndex((o, k) => k !== i && !used.has(k) && o.type === e.type && o.side === -e.side && len(sub(o.p, e.p)) < ALIGN);
    if (j >= 0) {
      used.add(i);
      used.add(j);
      const p = [(e.p[0] + ends[j].p[0]) / 2, (e.p[1] + ends[j].p[1]) / 2];
      out.push({ kind: 'crossing', p, t: e.t, type: e.type });
    }
  });
  ends.forEach((e, i) => {
    if (used.has(i) || nearSignal(e.p)) return;
    out.push({ kind: 'continuous', p: e.p, t: e.t, side: e.side, type: e.type, local: e.kind });
  });

  // ---- Local streets meeting each other ----
  const onMain = (q) => mains.some((m) => {
    const n = nearestOn(m.pts, q);
    return n && n.r < 2;
  });
  for (const { q, n, kinds } of degree.values()) {
    if (n < 3 || kinds.has('rail') || onMain(q)) continue;
    out.push({ kind: 'raised', p: q });
  }
  return out;
}
