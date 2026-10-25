// Stage 5: what of the regional rail and the metro is in each district.
//
// Both are planned for the whole city at once (see rail.js and metro.js):
// regional rail on viaducts, radial lines through the central station and a
// ring in a large city; the metro in tunnels under the boulevards, from
// district centre to district centre, with stations between at
// neighbourhood centres. This gathers a district's stations.

import { LruCache } from './cache.js';
import { pointInPolygon } from '../util/geom.js';

export function createTransit({ rail, metro }) {
  const cache = new LruCache(4000);
  function of(d) {
    let t = cache.get(d.key);
    if (t) return t;
    const railStops = rail.stations
      .filter((st) => st.key === d.key || (!st.key && d.rings.some((r) => pointInPolygon(st.p[0], st.p[1], r))))
      .map((st) => ({ p: st.p, second: !st.key, central: st.central, site: st.site, dir: st.dir, lines: st.lines || [] }));
    const metroStops = metro.stationsIn(d.key).map((st) => ({ p: st.p, core: st.core, lines: st.lines, id: st.id }));
    t = { railStops, metroStops };
    cache.set(d.key, t);
    return t;
  }
  return { of };
}
