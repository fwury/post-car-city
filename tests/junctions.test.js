// The street and intersection spec's checks (Part 6), and its junction
// geometry rules (Part 1.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld } from '../src/world/districts.js';
import { seedFromText } from '../src/core/hash.js';
import { STREET_TYPES } from '../src/world/streetTypes.js';
import { profile, SETBACK, isTramStreet } from '../src/world/junctions.js';

const world = createWorld(seedFromText('1'), { population: 1.5e6 });
const districts = world.cityCores.slice(0, 3).map((c) => world.district(c));
const plans = districts.map((d) => ({ d, b: world.blocks(d) }));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Distance along a polyline to the point nearest q, and how far off it q is.
function along(P, q) {
  let best = null;
  let s0 = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i];
    const d = [P[i + 1][0] - a[0], P[i + 1][1] - a[1]];
    const l = Math.hypot(d[0], d[1]);
    const t = l ? Math.max(0, Math.min(1, ((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]) / (l * l))) : 0;
    const r = Math.hypot(a[0] + d[0] * t - q[0], a[1] + d[1] * t - q[1]);
    if (!best || r < best.r) best = { r, s: s0 + l * t };
    s0 += l;
  }
  return { ...best, L: s0 };
}
const tramStreets = (d) => [...d.stage3.lines.map((l) => l.points), ...d.network.lines.filter((l) => l.kind !== 'roundabout').map((l) => l.points)];

test('every street section adds up to its width, its bands where the spec has them', () => {
  const widths = { mainStreet: 31.0, pedestrianMainStreet: 31.0, boulevard: 35.2, coreMainStreet: 37.0, coreCrossStreet: 26.8, coreCrossStreetNarrow: 21.6, collector: 21.4, localStreet: 13.8, pedestrianStreet: 18.0, laneway: 7.0 };
  for (const [type, w] of Object.entries(widths)) {
    const T = STREET_TYPES[type];
    const sum = 2 * T.side.reduce((a, [, x]) => a + x, 0) + T.centre.reduce((a, [, x]) => a + x, 0);
    assert.ok(Math.abs(sum - w) < 1e-6 && Math.abs(T.width - w) < 1e-6, `${type} adds up to ${sum}, not ${w}`);
  }
  const edges = (type) => profile(type).bands.map(([a, b, el]) => `${el} ${a.toFixed(1)}-${b.toFixed(1)}`).join(', ');
  assert.equal(edges('mainStreet'), 'median 0.0-1.6, tram 1.6-5.1, drive 5.1-8.1, buffer 8.1-8.6, cycle 8.6-10.7, furnishing 10.7-12.5, clearway 12.5-15.5');
  assert.equal(edges('boulevard'), 'tram 0.0-3.5, buffer 3.5-6.5, drive 6.5-9.5, furnishing 9.5-11.3, cycle 11.3-13.4, furnishing 13.4-14.6, clearway 14.6-17.6');
  assert.equal(edges('coreCrossStreet'), 'drive 0.0-3.0, buffer 3.0-3.5, cycle 3.5-5.6, furnishing 5.6-7.4, clearway 7.4-10.9, frontage 10.9-13.4');
  assert.equal(edges('localStreet'), 'shared 0.0-3.0, furnishing 3.0-4.8, clearway 4.8-6.9');
  // No turn lanes anywhere.
  for (const T of Object.values(STREET_TYPES)) for (const [el] of [...T.side, ...T.centre]) assert.ok(!/turn/.test(el));
});

test('tram tracks never shift: platforms stand clear of them, 1.35 m from each track', () => {
  let n = 0;
  for (const { b } of plans) {
    for (const st of b.tramStops) {
      const tracks = profile(st.type).tram;
      if (st.kind === 'island') {
        assert.equal(st.from, -2.0);
        assert.equal(st.to, 2.0);
        assert.ok(Math.abs(tracks[0] - 2.0 - 1.35) < 1e-9);
      } else {
        assert.ok(Math.abs(st.from - tracks[0] - 1.35) < 1e-9 && Math.abs(st.to - st.from - 3.0) < 1e-9);
      }
      assert.ok(st.length >= 35 && st.length <= 45);
      n++;
    }
  }
  assert.ok(n > 20, `only ${n} platforms`);
});

test('signalised junctions are protected: crossings set back 5 m, zebras beside them, stop lines outside', () => {
  let n = 0;
  for (const { b } of plans) {
    for (const j of b.intersections) {
      if (j.kind !== 'D') continue;
      n++;
      for (const a of j.arms) {
        // Set back at least 5 m from the carriageway of a street across it.
        const across = j.arms.filter((o) => Math.abs(o.dir[0] * a.dir[0] + o.dir[1] * a.dir[1]) < 0.5);
        for (const o of across) assert.ok(a.s >= profile(o.type).drive + SETBACK - 0.01, `a cycle crossing ${a.s.toFixed(1)} m out over a ${o.type}`);
        assert.ok(a.cw >= 2.1 && Math.abs(a.zebra - a.s - a.cw - 4.0) < 1e-9 && Math.abs(a.stop - a.zebra - 1.0) < 1e-9);
      }
    }
  }
  assert.ok(n > 30, `only ${n} signalised junctions`);
});

test('tram stops are 300 to 400 m apart, each at a signalised junction', () => {
  const gaps = [];
  for (const { d, b } of plans) {
    const by = new Map();
    for (const st of b.tramStops) {
      if (!by.has(st.line)) by.set(st.line, new Set());
      by.get(st.line).add(Math.round(st.at));
    }
    // (Only along stretches trams run: two routes may each use one end of
    // a street and not the middle.)
    const majors = [...d.stage3.lines, ...d.network.lines.filter((l) => l.kind !== 'roundabout')];
    const ranges = world.trams.in(d).ranges;
    for (const [li, set] of by) {
      const a = [...set].sort((x, y) => x - y);
      const R = ranges.get(majors[li] && majors[li].key) || [];
      for (let i = 1; i < a.length; i++) {
        const mid = (a[i] + a[i - 1]) / 2;
        if (R.some(([lo, hi]) => mid >= lo - 1 && mid <= hi + 1)) gaps.push(a[i] - a[i - 1]);
      }
    }
    // Every stop stands at a signalised junction (or crossing), but on a
    // pedestrian main street, where there is no traffic to stop.
    for (const st of b.tramStops) {
      if (st.type.startsWith('pedestrian')) continue;
      const back = [st.p[0] - st.dir[0] * (st.length / 2 + 1), st.p[1] - st.dir[1] * (st.length / 2 + 1)];
      const j = b.intersections.filter((x) => ['D', 'XING', 'GREEN'].includes(x.kind)).find((x) => dist(x.p, back) < 55);
      assert.ok(j, `${d.key}: a tram stop at ${st.p.map(Math.round)} with no signals behind it`);
    }
  }
  gaps.sort((a, b) => a - b);
  const median = gaps[gaps.length >> 1];
  assert.ok(median >= 300 && median <= 400, `median gap ${median} m`);
  assert.ok(gaps.filter((g) => g >= 290).length >= gaps.length * 0.95, 'stops too close together');
  // (Some longer gaps are where routes overlap only in part, or where side
  // streets come too thick for platforms.)
  // (Boulevards through a core meet side streets too thickly for a stop
  // at every 400 m.)
  assert.ok(gaps.filter((g) => g <= 480).length >= gaps.length * 0.8, 'stops too far apart');
});

test('laneways meet only local streets', () => {
  for (const { d, b } of plans) {
    const majors = tramStreets(d);
    for (const j of b.intersections) {
      if (j.kind !== 'LANE') continue;
      // (A laneway opening on a tram street would end at its building line,
      // about its half-width from its centreline.)
      for (const P of majors) assert.ok(along(P, j.p).r > 17, `${d.key}: a laneway at ${j.p.map(Math.round)} opens on a tram street`);
    }
  }
});

test('every point of a tram street is within 115 m of a crossing', () => {
  for (const { d, b } of plans) {
    // (A pedestrian main street is crossed anywhere.)
    const ped = new Set(d.stage3.lines.filter((l) => l.pedestrian).map((l) => l.points));
    for (const P of tramStreets(d)) {
      if (ped.has(P)) continue;
      const xs = b.intersections
        .filter((j) => ['D', 'XING', 'GREEN', 'ZEBRA'].includes(j.kind) || (['CONT', 'PED'].includes(j.kind) && !j.platform))
        .map((j) => along(P, j.p))
        .filter((pr) => pr.r < 3)
        .map((pr) => pr.s)
        .sort((x, y) => x - y);
      const L = along(P, P[0]).L;
      const m = [0, ...xs, L];
      for (let k = 1; k < m.length; k++) assert.ok(m[k] - m[k - 1] <= 230, `${d.key}: ${Math.round(m[k] - m[k - 1])} m between crossings`);
    }
  }
});

test('junctions have at most four arms, meeting at 60 to 120 degrees', () => {
  let corners = 0;
  let bad = 0;
  for (const { d, b } of plans) {
    for (const j of b.intersections) {
      assert.ok(j.arms.length <= 4, `${d.key}: a junction of ${j.arms.length} arms at ${j.p.map(Math.round)}`);
      if (j.arms.length < 3) continue;
      const as = j.arms.map((a) => Math.atan2(a.dir[1], a.dir[0])).sort((x, y) => x - y);
      for (let i = 0; i < as.length; i++) {
        const g = (((i + 1 < as.length ? as[i + 1] : as[0] + 2 * Math.PI) - as[i]) * 180) / Math.PI;
        if (g > 165) continue; // (a street running straight on)
        corners++;
        if (g < 60) bad++;
      }
    }
  }
  assert.ok(bad <= corners * 0.002, `${bad} of ${corners} corners under 60 degrees`);
});

test('side streets meeting a tram street from opposite sides line up or keep 30 m apart', () => {
  let tees = 0;
  let close = 0;
  for (const { b } of plans) {
    const T = b.intersections.filter((j) => ['CONT', 'D', 'PED'].includes(j.kind) && j.arms.length === 3);
    for (const j of T) {
      const side = j.arms.find((a) => !isTramStreet(a.type));
      if (!side) continue;
      tees++;
      for (const o of T) {
        if (o === j) continue;
        const os = o.arms.find((a) => !isTramStreet(a.type));
        if (os && dist(o.p, j.p) < 30 && side.dir[0] * os.dir[0] + side.dir[1] * os.dir[1] < -0.5) close++;
      }
    }
  }
  // (Each pair was counted from both ends.)
  // (The old town's pedestrian streets and the streets round it may meet
  // its frame a little off each other.)
  assert.ok(close / 2 <= tees * 0.015, `${close / 2} pairs of T junctions within 30 m of each other across a tram street`);
});

test('the old town\'s pedestrian main street has no signals or crossings along it, and its stops side platforms', () => {
  let n = 0;
  for (const { d, b } of plans) {
    const ped = d.stage3.lines.find((l) => l.pedestrian);
    if (!ped) continue;
    n++;
    const on = (p) => {
      let r = Infinity;
      for (let i = 1; i < ped.points.length; i++) {
        const [a, c] = [ped.points[i - 1], ped.points[i]];
        const ab = [c[0] - a[0], c[1] - a[1]];
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2 || 1)));
        r = Math.min(r, dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]));
      }
      return r < 3;
    };
    const ends = [ped.points[0], ped.points[ped.points.length - 1]];
    for (const j of b.intersections) {
      if (!on(j.p) || ends.some((e) => dist(e, j.p) < 20)) continue;
      assert.ok(!['D', 'XING', 'ZEBRA', 'CONT'].includes(j.kind), `${d.key}: a ${j.kind} junction on the pedestrian main street at ${j.p.map(Math.round)}`);
    }
    for (const st of b.tramStops) if (st.type.startsWith('pedestrian')) assert.equal(st.kind, 'side');
  }
  assert.ok(n >= 1, 'no old town');
});

test('trams run along the old town\'s pedestrian main street and stop on it', () => {
  const d = districts.find((x) => x.stage3.lines.some((l) => l.pedestrian));
  assert.ok(d, 'no old town');
  const ped = d.stage3.lines.find((l) => l.pedestrian);
  assert.ok(world.trams.in(d).ranges.has(ped.key), 'no route along it');
  assert.ok(plans.find((x) => x.d === d).b.tramStops.some((st) => st.type.startsWith('pedestrian')), 'no stop on it');
});
