// Stage 5: names. English-sounding names put together from word lists, the
// way English place and street names are made: an old place name, a
// family name, a tree or a landmark, with an ending that suits the place.
// No two neighbouring things need differ, but a district's own names are
// kept apart from each other.

import { hash, hashString, toUnit } from '../core/hash.js';

const ROOTS = [
  'Ash', 'Bram', 'Elm', 'Holl', 'Oak', 'Willow', 'Hazel', 'Rowan', 'Birch', 'Beech', 'Alder', 'Lark', 'Wren', 'King', 'Queen',
  'Church', 'Mill', 'Bridge', 'Brook', 'Fen', 'Marsh', 'Heath', 'Moor', 'Stone', 'Chalk', 'Red', 'White', 'Black', 'Green', 'Kel',
  'Ald', 'Brad', 'Craw', 'Dun', 'Ever', 'Fair', 'Gold', 'Hart', 'Lang', 'Lin', 'Long', 'Maple', 'Nor', 'Park', 'Pen',
  'Rad', 'Rich', 'Rother', 'Sand', 'Sher', 'Stan', 'Sut', 'Thorn', 'Wal', 'Well', 'West', 'Whit', 'Wood', 'Yar', 'Ced',
  'Har', 'Ken', 'Bel', 'Clare', 'Dart', 'Eden', 'Fern', 'Glen', 'Hay', 'Ivy', 'Lea', 'Mer', 'New', 'Orch', 'Pem',
  'Rams', 'Sel', 'Abber', 'Acken', 'Amber', 'Applet', 'Arn', 'Ashen', 'Aston', 'Avon', 'Bark', 'Barn', 'Bar', 'Bas', 'Bay',
  'Bell', 'Ben', 'Berk', 'Bex', 'Bick', 'Bil', 'Bin', 'Bish', 'Blyth', 'Bol', 'Bourne', 'Box', 'Brack', 'Bran', 'Brent',
  'Brick', 'Brigh', 'Brin', 'Brom', 'Broom', 'Bur', 'Butter', 'Cal', 'Cam', 'Can', 'Car', 'Carl', 'Cart', 'Cas', 'Chad',
  'Chard', 'Charl', 'Chel', 'Chester', 'Chil', 'Chip', 'Chis', 'Clap', 'Clay', 'Cliff', 'Clif', 'Cob', 'Cold', 'Col', 'Corn',
  'Cos', 'Cot', 'Cran', 'Crick', 'Crom', 'Crow', 'Cud', 'Dal', 'Dar', 'Day', 'Deb', 'Ded', 'Den', 'Der', 'Dor',
  'Dove', 'Down', 'Drax', 'Dray', 'Dud', 'Dur', 'Eal', 'East', 'Eas', 'Eb', 'Edg', 'Edmon', 'Elder', 'Ell', 'Ems',
  'Ep', 'Esh', 'Eton', 'Ex', 'Far', 'Farn', 'Fel', 'Finch', 'Fins', 'Flax', 'Fold', 'Ford', 'Fox', 'Frim', 'Frith',
  'Gad', 'Gar', 'Gil', 'Glas', 'Gos', 'Graf', 'Grant', 'Grave', 'Gray', 'Grims', 'Had', 'Hail', 'Hal', 'Ham', 'Hamp',
  'Hans', 'Hare', 'Has', 'Hat', 'Haver', 'Haw', 'Hen', 'Here', 'Hes', 'Hey', 'High', 'Hil', 'Hind', 'Hith', 'Hog',
  'Hol', 'Hon', 'Horn', 'Hors', 'Hox', 'Hum', 'Hun', 'Ick', 'Il', 'Ing', 'Ip', 'Kes', 'Kew', 'Kil', 'Kim',
  'Kirk', 'Knap', 'Knight', 'Lam', 'Lan', 'Laven', 'Led', 'Lei', 'Lev', 'Lid', 'Lim', 'Lind', 'Lit', 'Lock', 'Lod',
  'Lor', 'Lox', 'Lud', 'Lyd', 'Lyn', 'Mal', 'Man', 'Mar', 'Mart', 'Mat', 'Mel', 'Mid', 'Mil', 'Mon', 'Mor',
  'Mort', 'Moss', 'Mul', 'Nan', 'Neth', 'Nut', 'Ock', 'Old', 'Ort', 'Ot', 'Ox', 'Pad', 'Pak', 'Pan', 'Pat',
  'Pel', 'Pert', 'Pet', 'Pick', 'Pin', 'Pit', 'Plum', 'Pol', 'Pond', 'Pres', 'Pul', 'Put', 'Quar', 'Rain', 'Raven',
  'Ray', 'Rid', 'Rip', 'Rock', 'Rom', 'Ros', 'Rud', 'Rush', 'Ry', 'Sal', 'Salt', 'Sax', 'Scar', 'Sea', 'Sef',
  'Shaft', 'Shap', 'Shel', 'Shep', 'Shir', 'Shore', 'Sil', 'Silver', 'Skel', 'Sid', 'Slad', 'Snow', 'Sol', 'Somer', 'Sow',
  'Spald', 'Spring', 'Staf', 'Stoke', 'Stow', 'Strat', 'Stret', 'Sud', 'Sum', 'Swan', 'Swin', 'Syd', 'Tad', 'Tam', 'Tan',
  'Tav', 'Ted', 'Tem', 'Tew', 'Thack', 'Than', 'Thrus', 'Tib', 'Til', 'Tod', 'Tot', 'Tow', 'Tren', 'Tring', 'Tun',
  'Twy', 'Ux', 'Ver', 'Wad', 'Wake', 'Wan', 'War', 'Wat', 'Wav', 'Wed', 'Wel', 'Wen', 'Wey', 'Wim', 'Win',
  'Wind', 'Wit', 'Wol', 'Wor', 'Wy',
];
const ENDINGS = [
  'ford', 'field', 'ley', 'ton', 'bury', 'wick', 'ham', 'worth', 'stead', 'dale', 'wood', 'combe', 'gate', 'hurst', 'mere', 'thorpe',
  'by', 'well', 'den', 'cote', 'borough', 'minster', 'bridge', 'brook', 'holme', 'hampton', 'ing', 'ington', 'ingham', 'low', 'marsh', 'moor',
  'more', 'ney', 'ock', 'port', 'ridge', 'sey', 'shaw', 'shot', 'side', 'stock', 'stone', 'stow', 'wade', 'water', 'way', 'wych',
];
const SURNAMES = [
  'Ashby', 'Barrow', 'Bennett', 'Carlisle', 'Dawson', 'Ellis', 'Fletcher', 'Gibson', 'Harper', 'Hughes', 'Jennings', 'Kendall',
  'Lambert', 'Marlowe', 'Norton', 'Parker', 'Radcliffe', 'Shelley', 'Thornton', 'Underwood', 'Vaughan', 'Walsh', 'Yates', 'Abbott',
  'Baxter', 'Chandler', 'Darby', 'Elliot', 'Fairfax', 'Granger', 'Hartley', 'Ingram', 'Keats', 'Lowell', 'Merrick', 'Newton',
  'Osborne', 'Palmer', 'Quinn', 'Rowland', 'Sutton', 'Tennyson', 'Upton', 'Vernon', 'Wardell', 'Austen', 'Blake', 'Byron',
  'Cavendish', 'Dickens', 'Elgar', 'Faraday', 'Gainsborough', 'Hardy', 'Kipling', 'Morris', 'Nash', 'Pitt', 'Russell', 'Spencer',
  'Turner', 'Wilberforce', 'Wren', 'Constable', 'Darwin', 'Brunel', 'Telford', 'Stephenson', 'Pankhurst', 'Seacole', 'Addison', 'Ainsworth',
  'Aldridge', 'Allerton', 'Ambrose', 'Anstey', 'Appleby', 'Archer', 'Arkwright', 'Armitage', 'Ashdown', 'Atherton', 'Atwood', 'Aubrey',
  'Avery', 'Aylward', 'Bagshaw', 'Bainbridge', 'Barker', 'Barlow', 'Barnes', 'Bartram', 'Bascombe', 'Bateman', 'Beckett', 'Bellamy',
  'Benbow', 'Bentley', 'Beresford', 'Bewick', 'Bingham', 'Birkett', 'Blackwood', 'Blundell', 'Bolton', 'Booth', 'Boswell', 'Bowden',
  'Bradshaw', 'Bramwell', 'Brewster', 'Brightwell', 'Brockway', 'Bronte', 'Brooke', 'Browning', 'Buckland', 'Bunyan', 'Burbage', 'Burgess',
  'Burney', 'Caxton', 'Chaucer', 'Churchill', 'Clarkson', 'Clement', 'Coleridge', 'Collier', 'Colville', 'Cookson', 'Corbett', 'Cotton',
  'Coverdale', 'Cromwell', 'Crosby', 'Culpeper', 'Dalton', 'Davenport', 'Defoe', 'Denham', 'Dryden', 'Dunstan', 'Eastwood', 'Edison',
  'Egerton', 'Eliot', 'Emerson', 'Evelyn', 'Fawcett', 'Fielding', 'Finch', 'Fitzroy', 'Forster', 'Fowler', 'Franklin', 'Fry',
  'Garrick', 'Gaskell', 'Gilbert', 'Godwin', 'Goldsmith', 'Gordon', 'Graham', 'Gresham', 'Grey', 'Grimshaw', 'Hadley', 'Hale',
  'Halley', 'Hamilton', 'Handel', 'Harcourt', 'Harding', 'Hargreaves', 'Harrington', 'Harvey', 'Hastings', 'Hawkins', 'Hazlitt', 'Herschel',
  'Hobbes', 'Hogarth', 'Holbein', 'Hooke', 'Hopkins', 'Howard', 'Hume', 'Hunt', 'Jenner', 'Johnson', 'Jowett', 'Keble',
  'Kemble', 'Kingsley', 'Knowles', 'Landor', 'Latimer', 'Lawrence', 'Leighton', 'Lister', 'Locke', 'Lovelace', 'Lyell', 'Macaulay',
  'Malory', 'Mansfield', 'Marvell', 'Maxwell', 'Meredith', 'Milton', 'Montague', 'Moore', 'Napier', 'Nelson', 'Newman', 'Nightingale',
  'Orwell', 'Owen', 'Paget', 'Paine', 'Peel', 'Pepys', 'Petrie', 'Pope', 'Priestley', 'Purcell', 'Raleigh', 'Ramsay',
  'Reynolds', 'Ricardo', 'Rossetti', 'Ruskin', 'Salisbury', 'Scott', 'Shaftesbury', 'Sheridan', 'Sidney', 'Smeaton', 'Somerville', 'Southey',
  'Stanhope', 'Sterne', 'Stubbs', 'Swift', 'Talbot', 'Thackeray', 'Tyndale', 'Wallace', 'Walpole', 'Watt', 'Webb', 'Wedgwood',
  'Wesley', 'Whitworth', 'Wilde', 'Wolfe', 'Woolf', 'Wordsworth', 'Wycliffe',
];
const THINGS = [
  'Acacia', 'Laurel', 'Chestnut', 'Linden', 'Poplar', 'Sycamore', 'Hawthorn', 'Juniper', 'Larch', 'Myrtle', 'Primrose', 'Bluebell',
  'Foxglove', 'Heather', 'Clover', 'Orchard', 'Meadow', 'Spring', 'Well', 'Windmill', 'Tannery', 'Brewery', 'Granary', 'Foundry',
  'Mason', 'Weaver', 'Cooper', 'Chapel', 'Abbey', 'Priory', 'Castle', 'Tower', 'Beacon', 'Ferry', 'Wharf', 'Quarry',
  'Pottery', 'Alder', 'Almond', 'Apple', 'Aspen', 'Bracken', 'Bramble', 'Briar', 'Broom', 'Buttercup', 'Camellia', 'Catkin',
  'Cherry', 'Clematis', 'Cowslip', 'Crab', 'Cypress', 'Daisy', 'Damson', 'Elder', 'Fennel', 'Fir', 'Gorse', 'Hazel',
  'Holly', 'Honeysuckle', 'Hornbeam', 'Iris', 'Ivy', 'Jasmine', 'Lavender', 'Lilac', 'Lime', 'Magnolia', 'Marigold', 'Medlar',
  'Mulberry', 'Nettle', 'Olive', 'Pear', 'Pine', 'Plum', 'Quince', 'Reed', 'Rose', 'Rosemary', 'Rush', 'Saffron',
  'Sage', 'Sorrel', 'Teasel', 'Thistle', 'Thyme', 'Tulip', 'Violet', 'Walnut', 'Wisteria', 'Yew', 'Anvil', 'Bakehouse',
  'Barley', 'Bell', 'Boathouse', 'Bowling', 'Brickfield', 'Candle', 'Cannon', 'Cloth', 'Coach', 'Cobble', 'Copper', 'Corn',
  'Dairy', 'Dye', 'Forge', 'Glass', 'Glebe', 'Hop', 'Kiln', 'Lantern', 'Lock', 'Malt', 'Market', 'Mint',
  'Paper', 'Pump', 'Rope', 'Saddle', 'Salt', 'Sawmill', 'Silk', 'Smithy', 'Soap', 'Spinner', 'Tallow', 'Tanner',
  'Tile', 'Timber', 'Toll', 'Vine', 'Wool', 'Badger', 'Falcon', 'Fox', 'Hare', 'Heron', 'Kestrel', 'Kingfisher',
  'Lapwing', 'Linnet', 'Magpie', 'Mallard', 'Martin', 'Nightingale', 'Otter', 'Owl', 'Peacock', 'Plover', 'Raven', 'Robin',
  'Rook', 'Skylark', 'Sparrow', 'Starling', 'Swallow', 'Swan', 'Thrush', 'Wagtail', 'Woodpecker', 'Arch', 'Bank', 'Barrow',
  'Bourne', 'Causeway', 'Cliff', 'Coppice', 'Croft', 'Dell', 'Dyke', 'Fold', 'Ford', 'Grove', 'Haven', 'Hollow',
  'Knoll', 'Lea', 'Mead', 'Mill', 'Pond', 'Ridge', 'Shaw', 'Spinney', 'Stile', 'Weir',
];
const HOOD_STREET = 0.3; // share of one-word neighbourhoods whose main street takes their name
const PLACE_WORDS = ['Green', 'Heath', 'End', 'Common', 'Park', 'Fields', 'Hill', 'Cross', 'Vale', 'Wood', 'Gate', 'Rise', 'Side', 'Town', 'Bank', 'Bridge', 'Farm', 'Grange', 'Hollow', 'Lea', 'Marsh', 'Mead', 'Row', 'Wharf', 'Yard', 'Corner', 'Down', 'Edge', 'Hythe', 'Moor'];

// Street types, by kind and shape. Most streets are plain streets.
export const STREET_TYPES_NAMES = {
  St: 'Street', Ave: 'Avenue', Blvd: 'Boulevard', Rd: 'Road', Way: 'Way', Ln: 'Lane', Cres: 'Crescent', Ct: 'Court', Pl: 'Place',
  Terr: 'Terrace', Walk: 'Walk', Mews: 'Mews', Row: 'Row', Sq: 'Square',
};

// The business district's names, the common ones more often.
const CBD_NAMES = [['Financial District', 20], ['Downtown', 20], ['Business District', 12], ['New Town', 10], ['The City', 8], ['Exchange', 6], ['The Loop', 2]];
const weightedPick = (list, r) => {
  let t = r * list.reduce((a, [, w]) => a + w, 0);
  for (const [name, w] of list) if ((t -= w) < 0) return name;
  return list[list.length - 1][0];
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
      // (No Wellwell or Brookbrook.)
      if (root.toLowerCase() === end || root.toLowerCase().endsWith(end)) end = end === 'ton' ? 'ford' : 'ton';
      return root + end;
    }
    if (r < 0.85) return `${pick(SURNAMES.concat(THINGS), ...k, 4)} ${pick(PLACE_WORDS, ...k, 5)}`;
    return `${pick(['Old', 'New', 'Upper', 'Lower', 'North', 'South', 'East', 'West', 'Little', 'Great'], ...k, 6)} ${pick(ROOTS, ...k, 7)}${pick(ENDINGS, ...k, 8)}`;
  };
  // A street's own word: a family name, a thing, or a place.
  const word = (...k) => {
    const r = u(...k, 10);
    if (r < 0.35) return pick(SURNAMES, ...k, 11);
    if (r < 0.6) return pick(THINGS, ...k, 12);
    // (Of "Harper Green", Harper; of "Old Ashford", Ashford.)
    const parts = place(...k, 13).split(' ');
    return PLACE_WORDS.includes(parts[parts.length - 1]) ? parts[0] : parts[parts.length - 1];
  };
  // Main streets. A neighbourhood with a one-word name now and then lends
  // it to its own main street (the one through its centre): its High
  // Street, or its Road. Otherwise a main street is named for itself, by
  // its key (so it keeps its name across a greenway).
  const mainCache = new WeakMap();
  function mainStreets(d) {
    let m = mainCache.get(d.stage3);
    if (m) return m;
    m = new Map();
    for (const h of d.stage3.hoods) {
      const name = place(hashString(d.key), 2, h.id);
      if (name.includes(' ') || u(hashString(d.key), 30, h.id) > HOOD_STREET) continue;
      // Its main street: the one passing nearest its centre.
      let best = null;
      for (const l of d.stage3.lines) {
        let r = Infinity;
        for (const p of l.points) r = Math.min(r, Math.hypot(p[0] - h.centre[0], p[1] - h.centre[1]));
        if (r < 80 && (!best || r < best.r)) best = { r, l };
      }
      if (!best || m.has(best.l)) continue;
      const type = u(hashString(d.key), 31, h.id) < 0.4 ? ['High St', 'High Street'] : u(hashString(d.key), 32, h.id) < 0.5 ? ['Rd', 'Road'] : ['St', 'Street'];
      m.set(best.l, { short: `${name} ${type[0]}`, full: `${name} ${type[1]}` });
    }
    mainCache.set(d.stage3, m);
    return m;
  }
  // The city's own name: one word.
  const city = () => {
    const root = pick(ROOTS, 7001);
    let end = pick(ENDINGS, 7002);
    if (root.endsWith(end[0])) end = end.slice(1);
    return root + end;
  };
  return {
    city,
    surname: (...k) => pick(SURNAMES, ...k),
    // A university by its campus: the main one the city's own ("University
    // of X", "X University"...), the others by a place or a founder.
    university(d, h) {
      const k = hashString(d.key) + h.id * 7919;
      const r = u(k, 50);
      if (h.university === 'main') {
        if (r < 0.4) return `University of ${city()}`;
        if (r < 0.6) return `${city()} University`;
        if (r < 0.85) return `${pick(SURNAMES, k, 51)} University`;
        return `Royal ${city()} College`;
      }
      const here = place(hashString(d.key), 1).split(' ')[0];
      if (r < 0.25) return `${here} University`;
      if (r < 0.45) return `${pick(SURNAMES, k, 51)} University`;
      if (r < 0.6) return `${city()} Metropolitan University`;
      if (r < 0.75) return `${city()} Institute of Technology`;
      if (r < 0.9) return `University of ${here}`;
      return `${pick(SURNAMES, k, 51)} College`;
    },
    mainStreet: (d, l) => mainStreets(d).get(l) || null,
    district: (d) => place(hashString(d.key), 1),
    // (The city-centre district's core is its business district, by one of
    // the usual names.)
    // (A medical or theatre district, by its own name and what it is.)
    hood: (d, h) => (h.core && d.stage3.hoods.some((o) => o.oldTown) ? weightedPick(CBD_NAMES, u(hashString(d.key), 40)) : h.suffix ? `${place(hashString(d.key), 2, h.id)} ${h.suffix}` : place(hashString(d.key), 2, h.id)),
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
