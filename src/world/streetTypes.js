// Street cross-sections in metres, building face to building face.
// `side` lists elements from the building face toward the centre; `centre`
// is the middle zone. Detailed drawing uses these from Stage 4.

export const STREET_TYPES = {
  mainStreet: {
    width: 31.0, speed: 30,
    side: [['clearway', 3.0], ['furnishing', 1.8], ['cycle', 2.1], ['buffer', 0.5], ['drive', 3.0]],
    centre: [['tram', 3.5], ['median', 3.2], ['tram', 3.5]], // 4.0 island platform replaces the median at stops
  },
  boulevard: {
    width: 35.2, speed: 30,
    side: [['clearway', 3.0], ['furnishing', 1.2], ['cycle', 2.1], ['furnishing', 1.8], ['drive', 3.0], ['buffer', 3.0]],
    centre: [['tram', 3.5], ['tram', 3.5]], // side platforms up to 3.4 in the buffers at stops
  },
  // The 2.5 frontage zone may be an arcade; it still counts as sidewalk.
  coreMainStreet: {
    width: 37.0, speed: 30,
    side: [['frontage', 2.5], ['clearway', 3.5], ['furnishing', 1.8], ['cycle', 2.1], ['buffer', 0.5], ['drive', 3.0]],
    centre: [['tram', 3.5], ['median', 3.2], ['tram', 3.5]],
  },
  // The same three where no tram route runs: the tram lanes (and the
  // median between them) a planted median of the same width.
  mainStreetPlanted: {
    width: 31.0, speed: 30,
    side: [['clearway', 3.0], ['furnishing', 1.8], ['cycle', 2.1], ['buffer', 0.5], ['drive', 3.0]],
    centre: [['median', 10.2]],
  },
  boulevardPlanted: {
    width: 35.2, speed: 30,
    side: [['clearway', 3.0], ['furnishing', 1.2], ['cycle', 2.1], ['furnishing', 1.8], ['drive', 3.0], ['buffer', 3.0]],
    centre: [['median', 7.0]],
  },
  coreMainStreetPlanted: {
    width: 37.0, speed: 30,
    side: [['frontage', 2.5], ['clearway', 3.5], ['furnishing', 1.8], ['cycle', 2.1], ['buffer', 0.5], ['drive', 3.0]],
    centre: [['median', 10.2]],
  },
  // The old town's pedestrian main street: no traffic lanes, the trams
  // down its middle, side platforms at stops in the wide furnishing zone.
  pedestrianMainStreet: {
    width: 31.0, speed: 0,
    side: [['clearway', 5.5], ['furnishing', 1.2], ['cycle', 2.1], ['furnishing', 3.2]],
    centre: [['tram', 3.5], ['tram', 3.5]],
  },
  pedestrianMainStreetPlanted: {
    width: 31.0, speed: 0,
    side: [['clearway', 5.5], ['furnishing', 1.2], ['cycle', 2.1], ['furnishing', 3.2]],
    centre: [['median', 7.0]],
  },
  coreCrossStreet: {
    width: 26.8, speed: 20,
    side: [['frontage', 2.5], ['clearway', 3.5], ['furnishing', 1.8], ['cycle', 2.1], ['buffer', 0.5]],
    centre: [['drive', 3.0], ['drive', 3.0]],
  },
  coreCrossStreetNarrow: {
    width: 21.6, speed: 20,
    side: [['frontage', 2.5], ['clearway', 3.5], ['furnishing', 1.8]],
    centre: [['drive', 3.0], ['drive', 3.0]],
  },
  collector: {
    width: 21.4, speed: 30, reserve: 31.0,
    side: [['clearway', 3.0], ['furnishing', 1.8], ['cycle', 2.1], ['buffer', 0.5]],
    centre: [['bus', 3.3], ['bus', 3.3]],
  },
  localStreet: {
    width: 13.8, speed: 15,
    side: [['clearway', 2.1], ['furnishing', 1.8]],
    centre: [['shared', 6.0]], // rowhouse streets add 2 to 3 of front garden each side
  },
  pedestrianStreet: {
    width: 18.0, speed: 0,
    side: [['frontage', 2.0], ['clearway', 3.0], ['furnishing', 1.0]],
    centre: [['cycle', 3.0], ['cycle', 3.0]],
  },
  laneway: {
    width: 7.0, speed: 0,
    side: [['planted', 1.5]],
    centre: [['paved', 4.0]],
  },
  industrialStreet: {
    width: 20.0, speed: 30,
    side: [['path', 3.0], ['planted', 3.5]],
    centre: [['drive', 3.5], ['drive', 3.5]],
  },
  road: {
    width: 47.0, speed: 50,
    side: [['path', 4.0], ['planted', 4.0], ['bus', 3.5], ['drive', 3.5], ['drive', 3.5]],
    centre: [['median', 10.0]],
  },
  expressway: {
    width: 47.0, speed: 100,
    side: [['shoulder', 3.0], ['bus', 3.5], ['drive', 3.5], ['drive', 3.5], ['drive', 3.5], ['shoulder', 1.5]],
    centre: [['median', 10.0]],
  },
};
