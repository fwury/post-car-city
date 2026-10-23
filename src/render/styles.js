// Map colours: a light, semi-realistic palette in the spirit of Apple Maps.
// Pedestrian surfaces light grey, vehicle lanes darker grey, small green
// spaces light green, large parks and natural areas darker green, transit
// lanes red, bike lanes dark green.

export const palette = {
  land: '#f2f0eb',
  core: '#f3e5d2',
  natural: '#a9d59a', // primary greenways, district parks
  green: '#cde9bd', // parkettes, neighbourhood parks, courtyards (later stages)
  water: '#9fcff2',
  waterEdge: '#86bfe8',
  road: '#a7adb3',
  roadCasing: '#8c939a',
  tunnel: '#dfe3e5', // a street under a greenway
  tunnelCasing: '#8c939a',
  pedestrian: '#e2e4e6',
  tram: '#d65a4e',
  bike: '#3e8a52',
  rail: '#2f6db5',
  hoodTints: ['#f2f0eb', '#efebe3', '#f4f1ea', '#ece8df'],
  hoodLine: 'rgba(120, 104, 84, 0.45)',
  hoodCentre: '#b9a88f',
  stationRing: '#ffffff',
  // Stage 4: blocks and local streets
  building: '#e3ddd3',
  podium: '#dcd5ca',
  buildingEdge: 'rgba(150, 136, 118, 0.55)',
  plotLine: 'rgba(150, 136, 118, 0.45)',
  courtyard: '#e6eedb',
  garden: '#e9efdc',
  plaza: '#dedad3',
  school: '#f1e3c8',
  localStreet: '#ffffff',
  localCasing: '#dcd9d3',
  pavement: '#f2f0ec',
  selection: '#0a7aff',
  water: '#9fcff2',
  streamBank: '#8fc39a',
  trail: '#f3eee4',
  trailEdge: '#cfd9c1',
  woods: '#93c784',
  yard: '#ebe7df', // the ground round buildings: yards, light wells, forecourts
  pedestrianStreet: '#e9dfcc',
  // Dedicated buildings, by what they are for.
  dedicated: {
    education: '#f1e3c8',
    worship: '#e7def0',
    civic: '#dde3ea',
    health: '#f3dddb',
    recreation: '#dcebd6',
    lodging: '#eedfd2',
    office: '#d8d6d8',
    housing: '#e8e1d6',
    shop: '#e6dccd',
    transport: '#dfe4e8',
  },
  // Shop floors, as dots.
  uses: {
    'food and drink': '#ee9a3a',
    'food shop': '#6fb257',
    shop: '#4f8fd8',
    service: '#a07ed6',
    health: '#e05a5a',
    education: '#d6a73c',
    civic: '#6b7c93',
    recreation: '#3fb3a0',
    entertainment: '#d65fa8',
    office: '#98a1ab',
    lodging: '#c9845c',
    worship: '#8e7cc3',
    housing: '#b0a08a',
    transport: '#5b8fb0',
    park: '#7bbf6a',
  },
  ink: '#1f2a30',
  inkSoft: '#5c6a72',

  // Debug overlays
  gridLine: 'rgba(31, 42, 48, 0.13)',
  gridAxis: 'rgba(31, 42, 48, 0.55)',
  labelBg: 'rgba(255, 255, 255, 0.85)',
  tileLine: 'rgba(47, 109, 181, 0.6)',
  tilePending: 'rgba(47, 109, 181, 0.07)',
  lattice: 'rgba(176, 58, 46, 0.7)',
  latticeCentre: '#b03a2e',
  districtOutline: 'rgba(31, 42, 48, 0.45)',
  noiseLow: [216, 224, 221],
  noiseHigh: [150, 178, 168],
};

const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export const fonts = {
  label: `500 11px ${MONO}`,
  small: `500 10px ${MONO}`,
  scale: `600 11px ${SANS}`,
};
