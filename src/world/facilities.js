// City-wide facilities, shared out among the districts: stadiums, athletic
// training centres, fairgrounds and small zoos (in district parks),
// corrective facilities, and in a big enough city an aquarium and a mental
// health hospital, preferably in the city-centre district.

import { hash, hashString, toUnit } from '../core/hash.js';

const MILLION = 1e6;
const AQUARIUM_FROM = 2e6; // people before a city has its aquarium
const MENTAL_HEALTH_BEDS = 60; // a mental health hospital's beds, per million people
const MENTAL_HEALTH_SIZE = 180; // beds a hospital holds (so the first from about 3M)

// How many of each, for so many people.
const COUNTS = {
  stadium: (n) => Math.max(1, Math.round(n / MILLION)),
  athleticTraining: (n) => Math.max(1, Math.round(n / MILLION)),
  correctional: (n) => Math.max(1, Math.round(n / MILLION)),
  aquarium: (n) => (n >= AQUARIUM_FROM ? 1 : 0),
  mentalHealthHospital: (n) => Math.floor((n * MENTAL_HEALTH_BEDS) / MILLION / MENTAL_HEALTH_SIZE),
};
// Fairgrounds and small zoos, in district parks (laid out by the parks).
const PARK_COUNTS = {
  fairground: (n) => Math.max(1, Math.round(n / 5e5)),
  zoo: (n) => Math.max(1, Math.round(n / MILLION)),
};
export const parkFacilityCount = (kind, population) => PARK_COUNTS[kind](population);

// Those the city-centre district takes first.
const CENTRAL = new Set(['aquarium', 'mentalHealthHospital']);
// Those kept out of it.
const OUTER = new Set(['correctional']);

// The facilities each district has, by its core's key: a list of names.
export function facilityPlan(seed, cores, population, keyOf, centreKey) {
  const plan = new Map(cores.map((c) => [keyOf(c), []]));
  for (const [kind, count] of Object.entries(COUNTS)) {
    const n = count(population);
    if (!n) continue;
    // Districts in an order of this kind's own, the centre first or never
    // as it wants; each takes one before any takes a second.
    let order = cores.map((c) => ({ k: keyOf(c), r: toUnit(hash(seed, 'facility', hashString(kind), ...String(keyOf(c)).split(',').map(Number))) })).sort((a, b) => a.r - b.r).map((o) => o.k);
    if (CENTRAL.has(kind)) order = [centreKey, ...order.filter((k) => k !== centreKey)];
    if (OUTER.has(kind) && order.length > 1) order = order.filter((k) => k !== centreKey);
    for (let i = 0; i < n; i++) plan.get(order[i % order.length]).push(kind);
  }
  return plan;
}
