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
  pedestrian: '#e2e4e6',
  tram: '#d65a4e',
  bike: '#3e8a52',
  rail: '#2f6db5',
  hoodTints: ['#f2f0eb', '#efebe3', '#f4f1ea', '#ece8df'],
  hoodLine: 'rgba(120, 104, 84, 0.45)',
  hoodCentre: '#b9a88f',
  stationRing: '#ffffff',
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
