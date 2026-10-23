// Stage 5: names. English-sounding names put together from word lists, the
// way English place and street names are made: an old place name, a
// family name, a tree or a landmark, with an ending that suits the place.
// No two neighbouring things need differ, but a district's own names are
// kept apart from each other.

import { hash, hashString, toUnit } from '../core/hash.js';

const ROOTS = [
  'Ash', 'Bram', 'Elm', 'Holl', 'Oak', 'Willow', 'Hazel', 'Rowan', 'Birch', 'Beech', 'Alder', 'Lark', 'Wren', 'King', 'Queen',
  'Church', 'Mill', 'Bridge', 'Brook', 'Fen', 'Marsh', 'Heath', 'Moor', 'Stone', 'Chalk', 'Red', 'White', 'Black', 'Green',
  'Kel', 'Ald', 'Brad', 'Craw', 'Dun', 'Ever', 'Fair', 'Gold', 'Hart', 'Lang', 'Lin', 'Long', 'Maple', 'Nor', 'Park', 'Pen',
  'Rad', 'Rich', 'Rother', 'Sand', 'Sher', 'Stan', 'Sut', 'Thorn', 'Wal', 'Well', 'West', 'Whit', 'Wood', 'Yar', 'Ced', 'Har',
  'Ken', 'Bel', 'Clare', 'Dart', 'Eden', 'Fern', 'Glen', 'Hay', 'Ivy', 'Lea', 'Mer', 'New', 'Orch', 'Pem', 'Rams', 'Sel',
];
const ENDINGS = ['ford', 'field', 'ley', 'ton', 'bury', 'wick', 'ham', 'worth', 'stead', 'dale', 'wood', 'combe', 'gate', 'hurst', 'mere', 'thorpe', 'by', 'well', 'den', 'cote', 'borough', 'minster', 'bridge', 'brook', 'holme'];
const SURNAMES = [
  'Ashby', 'Barrow', 'Bennett', 'Carlisle', 'Dawson', 'Ellis', 'Fletcher', 'Gibson', 'Harper', 'Hughes', 'Jennings', 'Kendall',
  'Lambert', 'Marlowe', 'Norton', 'Parker', 'Radcliffe', 'Shelley', 'Thornton', 'Underwood', 'Vaughan', 'Walsh', 'Yates',
  'Abbott', 'Baxter', 'Chandler', 'Darby', 'Elliot', 'Fairfax', 'Granger', 'Hartley', 'Ingram', 'Keats', 'Lowell', 'Merrick',
  'Newton', 'Osborne', 'Palmer', 'Quinn', 'Rowland', 'Sutton', 'Tennyson', 'Upton', 'Vernon', 'Wardell', 'Austen', 'Blake',
  'Byron', 'Cavendish', 'Dickens', 'Elgar', 'Faraday', 'Gainsborough', 'Hardy', 'Kipling', 'Morris', 'Nash', 'Pitt', 'Russell',
  'Spencer', 'Turner', 'Wilberforce', 'Wren', 'Constable', 'Darwin', 'Brunel', 'Telford', 'Stephenson', 'Pankhurst', 'Seacole',
];
const THINGS = [
  'Acacia', 'Laurel', 'Chestnut', 'Linden', 'Poplar', 'Sycamore', 'Hawthorn', 'Juniper', 'Larch', 'Myrtle', 'Primrose', 'Bluebell',
  'Foxglove', 'Heather', 'Clover', 'Orchard', 'Meadow', 'Spring', 'Well', 'Windmill', 'Tannery', 'Brewery', 'Granary', 'Foundry',
  'Mason', 'Weaver', 'Cooper', 'Chapel', 'Abbey', 'Priory', 'Castle', 'Tower', 'Beacon', 'Ferry', 'Wharf', 'Quarry', 'Pottery',
];
const PLACE_WORDS = ['Green', 'Heath', 'End', 'Common', 'Park', 'Fields', 'Hill', 'Cross', 'Vale', 'Wood', 'Gate', 'Rise', 'Side', 'Town'];

// Street types, by kind and shape. Most streets are plain streets.
export const STREET_TYPES_NAMES = {
  St: 'Street', Ave: 'Avenue', Blvd: 'Boulevard', Rd: 'Road', Way: 'Way', Ln: 'Lane', Cres: 'Crescent', Ct: 'Court', Pl: 'Place',
  Terr: 'Terrace', Walk: 'Walk', Mews: 'Mews', Row: 'Row', Sq: 'Square',
};

export function createNames(seed) {
  const u = (...k) => toUnit(hash(seed, 'names', ...k));
  const pick = (list, ...k) => list[Math.floor(u(...k) * list.length) % list.length];
  // A place name: a root and an ending, or a root word and a place word.
  const place = (...k) => {
    const r = u(...k, 1);
    if (r < 0.62) {
      const root = pick(ROOTS, ...k, 2);
      let end = pick(ENDINGS, ...k, 3);
      // Join without doubling a letter awkwardly.
      if (root.endsWith(end[0])) end = end.slice(1);
      return root + end;
    }
    if (r < 0.85) return `${pick(SURNAMES.concat(THINGS), ...k, 4)} ${pick(PLACE_WORDS, ...k, 5)}`;
    return `${pick(['Old', 'New', 'Upper', 'Lower', 'North', 'South', 'East', 'West', 'Little', 'Great'], ...k, 6)} ${pick(ROOTS, ...k, 7)}${pick(ENDINGS, ...k, 8)}`;
  };
  // A street's own word: a family name, a thing, or a place.
  const word = (...k) => {
    const r = u(...k, 10);
    if (r < 0.45) return pick(SURNAMES, ...k, 11);
    if (r < 0.75) return pick(THINGS, ...k, 12);
    return place(...k, 13).split(' ').pop();
  };
  return {
    district: (d) => place(hashString(d.key), 1),
    hood: (d, h) => place(hashString(d.key), 2, h.id),
    // kind: boulevard, main, local, pedestrian, parkside; shape: { length, curved }.
    street(kind, key, shape = {}, salt = 0) {
      const k = (typeof key === 'number' ? key : hashString(String(key))) + salt * 7919;
      const w = word(k, 20);
      let type = 'St';
      if (kind === 'boulevard') type = u(k, 21) < 0.6 ? 'Ave' : 'Blvd';
      else if (kind === 'main') type = 'St';
      else if (kind === 'pedestrian') type = u(k, 22) < 0.5 ? 'Walk' : 'Row';
      else if (kind === 'parkside') type = u(k, 23) < 0.6 ? 'Terr' : 'Walk';
      else {
        const r = u(k, 24);
        if (shape.curved && r < 0.7) type = 'Cres';
        else if (shape.length < 140) type = r < 0.22 ? 'Ln' : r < 0.34 ? 'Mews' : r < 0.44 ? 'Pl' : 'St';
        else type = r < 0.72 ? 'St' : r < 0.82 ? 'Way' : r < 0.92 ? 'Rd' : 'Ln';
      }
      return { short: `${w} ${type}`, full: `${w} ${STREET_TYPES_NAMES[type]}` };
    },
  };
}
