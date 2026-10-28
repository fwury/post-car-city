// Map colours: a light, calm palette in the spirit of Apple Maps. Warm
// off-white land, soft greens for parks (deeper for the large ones), clear
// light blue water; streets white with light casings and boulevards pale
// yellow; buildings light stone, their materials muted.

export const palette = {
  land: '#f7f4ee',
  country: '#eef0e3', // the land round the city
  hills: '#e8e5d4', // mountains
  contour: 'rgba(150, 140, 110, 0.35)',
  hillTint: 'rgba(150, 136, 98, 0.06)',
  sand: '#f3e6c4',
  quay: '#e4dac8', // paved promenades, quays and piers by the water
  quayEdge: '#bdae95',
  boardwalk: '#c9a77c',
  bluff: '#d7c29a',
  bridgeCasing: '#b4ada1',
  core: '#f8ecdc',
  natural: '#bde2a9', // primary greenways, district parks
  green: '#d4ecc6', // parkettes, neighbourhood parks, courtyards (later stages)
  water: '#a6d5f7',
  metro: '#8a5cc2',
  railFill: '#959ca2',
  railEdge: '#5f676e',
  railTrack: '#5f666c',
  waterEdge: '#93c8ef',
  road: '#ffffff', // main streets: white, as map apps draw them
  roadCasing: '#d9d3c8',
  roadFar: '#dcd5c8',
  boulevard: '#fde9a8', // boulevards: a pale yellow, the next rank of road
  boulevardCasing: '#e6c97a',
  tunnel: '#f1f2ee', // a street under a greenway
  tunnelCasing: '#c9c6bd',
  pedestrian: '#e2e4e6',
  tram: '#e2786c',
  bike: '#3e8a52',
  kiosk: '#e8c9a0',
  hallRoof: '#cfdbe4',
  platform: '#d9d6cf',
  hallEdge: '#7f919f',
  kioskEdge: '#b98d5a',
  rail: '#2f6db5',
  hoodTints: ['#f7f4ee', '#f4f0e8', '#f8f6f1', '#f2eee6'],
  hoodLine: 'rgba(120, 110, 96, 0.35)',
  hoodCentre: '#b9a88f',
  stationRing: '#ffffff',
  // Stage 4: blocks and local streets
  building: '#e9e5de',
  podium: '#e3ded6',
  buildingEdge: 'rgba(150, 136, 118, 0.55)',
  plotLine: 'rgba(150, 136, 118, 0.45)',
  courtyard: '#e9f1df',
  garden: '#ebf2e0',
  plaza: '#dedad3',
  school: '#f1e3c8',
  localStreet: '#ffffff',
  localCasing: '#e2ded6',
  pavement: '#f5f3ef',
  selection: '#0a7aff',
  water: '#a6d5f7',
  metro: '#8a5cc2',
  railFill: '#959ca2',
  railEdge: '#5f676e',
  railTrack: '#5f666c',
  streamBank: '#a6d3a6',
  trail: '#f3eee4',
  trailEdge: '#d6e2c8',
  woods: '#93c784',
  yard: '#efebe4', // the ground round buildings: yards, light wells, forecourts
  pedestrianStreet: '#efe6d6',
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
