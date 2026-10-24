// What goes in buildings: the urban design guide's programme, as data.
//
// `cat` groups uses for drawing and for mixing; `floor` is where a use
// usually sits: ground (the shop floor), upper (the first floors up), or
// dedicated (a building of its own). `quiet` uses may sit on corners off
// the main streets; the rest keep to main streets, squares and the core.

export const USES = {
  // Every home within about 400 m of each of these.
  grocery: { label: 'Grocery store', cat: 'food shop', floor: 'ground', quiet: true },
  convenience: { label: 'Convenience store', cat: 'food shop', floor: 'ground', quiet: true },
  cafe: { label: 'Café and bakery', cat: 'food and drink', floor: 'ground', quiet: true },
  bank: { label: 'Bank branch or credit union', cat: 'service', floor: 'ground', quiet: true },
  gym: { label: 'Gym', cat: 'recreation', floor: 'upper', quiet: true },
  daycare: { label: 'Daycare and preschool', cat: 'education', floor: 'ground', quiet: true },
  clinic: { label: 'Walk-in clinic and family doctor', cat: 'health', floor: 'ground', quiet: true },
  pharmacy: { label: 'Pharmacy', cat: 'health', floor: 'ground', quiet: true },

  // One or more in every neighbourhood.
  postOffice: { label: 'Post office', cat: 'civic', floor: 'ground' },
  foodBank: { label: 'Food bank', cat: 'civic', floor: 'ground' },
  inn: { label: 'Inn', cat: 'lodging', floor: 'dedicated' },
  communityCentre: { label: 'Community centre', cat: 'civic', floor: 'dedicated' },
  dental: { label: 'Dental clinic', cat: 'health', floor: 'upper' },
  optometry: { label: 'Optometry clinic', cat: 'health', floor: 'ground' },
  physio: { label: 'Physiotherapist', cat: 'health', floor: 'upper' },
  psychotherapy: { label: 'Psychotherapist', cat: 'health', floor: 'upper' },
  vet: { label: 'Veterinarian', cat: 'health', floor: 'ground' },
  church: { label: 'Church', cat: 'worship', floor: 'dedicated' },
  synagogue: { label: 'Synagogue', cat: 'worship', floor: 'dedicated' },
  mosque: { label: 'Mosque', cat: 'worship', floor: 'dedicated' },
  temple: { label: 'Temple (Hindu, Sikh or Buddhist)', cat: 'worship', floor: 'dedicated' },
  cathedral: { label: 'Cathedral', cat: 'worship', floor: 'dedicated' },
  elementarySchool: { label: 'Elementary school', cat: 'education', floor: 'dedicated' },
  secondarySchool: { label: 'Secondary school', cat: 'education', floor: 'dedicated' },
  market: { label: 'Public square and market', cat: 'civic', floor: 'open' },
  neighbourhoodPark: { label: 'Neighbourhood park', cat: 'park', floor: 'open' },
  parkette: { label: 'Parkette', cat: 'park', floor: 'open' },

  // The variety along a main street: food and drink...
  restaurant: { label: 'Sit-down restaurant', cat: 'food and drink', floor: 'ground' },
  casual: { label: 'Casual restaurant', cat: 'food and drink', floor: 'ground' },
  takeout: { label: 'Takeout', cat: 'food and drink', floor: 'ground', quiet: true },
  pub: { label: 'Bar or pub', cat: 'food and drink', floor: 'ground' },
  dessert: { label: 'Dessert shop', cat: 'food and drink', floor: 'ground', quiet: true },
  drinks: { label: 'Bubble tea and juice', cat: 'food and drink', floor: 'ground', quiet: true },
  deli: { label: 'Deli', cat: 'food and drink', floor: 'ground', quiet: true },
  // ...small shops...
  florist: { label: 'Florist', cat: 'shop', floor: 'ground', quiet: true },
  ethnicGrocer: { label: 'Ethnic grocery', cat: 'food shop', floor: 'ground', quiet: true },
  bikeShop: { label: 'Bicycle shop', cat: 'shop', floor: 'ground' },
  bookshop: { label: 'Bookshop', cat: 'shop', floor: 'ground' },
  clothing: { label: 'Clothing and thrift shop', cat: 'shop', floor: 'ground' },
  hardware: { label: 'Household goods', cat: 'shop', floor: 'ground' },
  stationery: { label: 'Stationery', cat: 'shop', floor: 'ground' },
  // ...entertainment...
  boardGames: { label: 'Board game café', cat: 'entertainment', floor: 'ground' },
  karaoke: { label: 'Karaoke', cat: 'entertainment', floor: 'upper' },
  arcade: { label: 'Small arcade', cat: 'entertainment', floor: 'ground' },
  liveMusic: { label: 'Live music bar', cat: 'entertainment', floor: 'ground' },
  // ...services...
  barber: { label: 'Barbershop', cat: 'service', floor: 'ground', quiet: true },
  salon: { label: 'Hair salon', cat: 'service', floor: 'ground', quiet: true },
  nails: { label: 'Nail salon', cat: 'service', floor: 'ground', quiet: true },
  tutor: { label: 'Tutoring', cat: 'education', floor: 'upper', quiet: true },
  tailor: { label: 'Tailor', cat: 'service', floor: 'ground', quiet: true },
  dryCleaner: { label: 'Dry cleaner', cat: 'service', floor: 'ground', quiet: true },
  repair: { label: 'Repair shop', cat: 'service', floor: 'ground', quiet: true },
  // ...arts and recreation, upstairs...
  martialArts: { label: 'Martial arts gym', cat: 'recreation', floor: 'upper' },
  artStudio: { label: 'Art studio', cat: 'recreation', floor: 'upper', quiet: true },
  danceStudio: { label: 'Dance, yoga and pilates studio', cat: 'recreation', floor: 'upper' },
  musicLessons: { label: 'Music lessons', cat: 'recreation', floor: 'upper', quiet: true },
  // ...and work.
  office: { label: 'Offices', cat: 'office', floor: 'upper', quiet: true },

  // Spread through the district's neighbourhoods.
  liquor: { label: 'Liquor shop', cat: 'shop', floor: 'ground' },
  officeSupply: { label: 'Office supplies', cat: 'shop', floor: 'ground' },
  furniture: { label: 'Furniture', cat: 'shop', floor: 'ground' },
  sports: { label: 'Sports shop', cat: 'shop', floor: 'ground' },
  toys: { label: 'Toy shop', cat: 'shop', floor: 'ground' },
  pets: { label: 'Pet shop', cat: 'shop', floor: 'ground' },
  hobby: { label: 'Hobby shop', cat: 'shop', floor: 'ground' },
  games: { label: 'Video game shop', cat: 'shop', floor: 'ground' },
  music: { label: 'Music shop', cat: 'shop', floor: 'ground' },
  records: { label: 'Record shop', cat: 'shop', floor: 'ground' },
  artSupply: { label: 'Art supplies', cat: 'shop', floor: 'ground' },
  gifts: { label: 'Gift shop', cat: 'shop', floor: 'ground' },
  electronics: { label: 'Electronics', cat: 'shop', floor: 'ground' },
  medicalSupply: { label: 'Medical supplies', cat: 'shop', floor: 'ground' },
  tattoo: { label: 'Tattoo and piercing', cat: 'service', floor: 'ground' },
  spa: { label: 'Spa', cat: 'service', floor: 'upper' },
  photo: { label: 'Photography studio', cat: 'service', floor: 'upper' },
  print: { label: 'Print shop', cat: 'service', floor: 'ground' },
  law: { label: 'Law firm', cat: 'office', floor: 'upper' },
  architects: { label: 'Architects', cat: 'office', floor: 'upper' },
  engineering: { label: 'Engineering consultancy', cat: 'office', floor: 'upper' },
  consulting: { label: 'Management consultancy', cat: 'office', floor: 'upper' },
  software: { label: 'Software company', cat: 'office', floor: 'upper' },
  design: { label: 'Design studio', cat: 'office', floor: 'upper' },
  marketing: { label: 'Advertising agency', cat: 'office', floor: 'upper' },
  recruitment: { label: 'Recruitment agency', cat: 'office', floor: 'upper' },
  coworking: { label: 'Coworking space', cat: 'office', floor: 'upper' },
  insuranceOffice: { label: 'Insurance company', cat: 'office', floor: 'upper' },
  bankOffice: { label: 'Bank offices', cat: 'office', floor: 'upper' },
  publisher: { label: 'Publisher', cat: 'office', floor: 'upper' },
  charityOffice: { label: 'Charity head office', cat: 'office', floor: 'upper' },
  mediaCompany: { label: 'Media company', cat: 'office', floor: 'upper' },
  researchLab: { label: 'Research lab', cat: 'office', floor: 'upper' },
  accounting: { label: 'Accountants', cat: 'office', floor: 'upper' },
  realEstate: { label: 'Real estate office', cat: 'office', floor: 'ground' },
  insurance: { label: 'Insurance office', cat: 'office', floor: 'ground' },
  travel: { label: 'Travel agency', cat: 'office', floor: 'ground' },
  catering: { label: 'Caterer', cat: 'service', floor: 'ground', quiet: true },
  dentalSpecialist: { label: 'Dental specialist', cat: 'health', floor: 'upper' },
  specialistClinic: { label: 'Medical specialist clinic', cat: 'health', floor: 'upper' },
  alliedHealth: { label: 'Massage, chiropractic and dietetics', cat: 'health', floor: 'upper', quiet: true },
  climbing: { label: 'Climbing gym', cat: 'recreation', floor: 'dedicated' },
  gymnastics: { label: 'Gymnastics centre', cat: 'recreation', floor: 'dedicated' },
  fencing: { label: 'Fencing club', cat: 'recreation', floor: 'upper' },
  makerspace: { label: 'Makerspace', cat: 'recreation', floor: 'ground' },
  musicSchool: { label: 'Music school', cat: 'education', floor: 'upper' },
  recordingStudio: { label: 'Recording studio', cat: 'recreation', floor: 'upper' },
  proStudio: { label: 'Professional art studio', cat: 'recreation', floor: 'upper' },
  languageSchool: { label: 'Language school', cat: 'education', floor: 'upper' },
  emergencyHousing: { label: 'Emergency housing', cat: 'housing', floor: 'dedicated' },
  transitionalHousing: { label: 'Transitional housing', cat: 'housing', floor: 'dedicated' },

  // Subdistrict centres, one to about three neighbourhoods.
  governmentOffice: { label: 'Government office', cat: 'civic', floor: 'upper' },
  library: { label: 'Library branch', cat: 'civic', floor: 'dedicated' },
  fireStation: { label: 'Fire station', cat: 'civic', floor: 'dedicated' },
  recCentre: { label: 'Recreation centre (pool, arena)', cat: 'recreation', floor: 'dedicated' },
  cinema: { label: 'Cinema', cat: 'entertainment', floor: 'upper' },
  bowling: { label: 'Bowling and escape rooms', cat: 'entertainment', floor: 'upper' },
  comedy: { label: 'Comedy club', cat: 'entertainment', floor: 'ground' },
  performingArts: { label: 'Performing arts centre', cat: 'civic', floor: 'dedicated' },

  // The district, mostly in its core.
  departmentStore: { label: 'Department store', cat: 'shop', floor: 'dedicated' },
  boutique: { label: 'Boutique', cat: 'shop', floor: 'ground' },
  shoes: { label: 'Shoe shop', cat: 'shop', floor: 'ground' },
  eyewear: { label: 'Eyewear', cat: 'shop', floor: 'ground' },
  jewellery: { label: 'Jeweller', cat: 'shop', floor: 'ground' },
  watches: { label: 'Watch shop', cat: 'shop', floor: 'ground' },
  bags: { label: 'Bag shop', cat: 'shop', floor: 'ground' },
  cosmetics: { label: 'Cosmetics', cat: 'shop', floor: 'ground' },
  perfume: { label: 'Perfumery', cat: 'shop', floor: 'ground' },
  hotel: { label: 'Hotel', cat: 'lodging', floor: 'dedicated' },
  officeTower: { label: 'Office tower', cat: 'office', floor: 'dedicated' },
  police: { label: 'Police station', cat: 'civic', floor: 'dedicated' },
  courthouse: { label: 'Courthouse', cat: 'civic', floor: 'dedicated' },
  employment: { label: 'Employment centre', cat: 'civic', floor: 'upper' },
  districtLibrary: { label: 'District library', cat: 'civic', floor: 'dedicated' },
  hospital: { label: 'Hospital (300 beds)', cat: 'health', floor: 'dedicated' },
  radiology: { label: 'Radiology clinic', cat: 'health', floor: 'upper' },
  lab: { label: 'Medical laboratory', cat: 'health', floor: 'upper' },
  specialists: { label: 'Medical specialists', cat: 'health', floor: 'upper' },
  hospice: { label: 'Hospice', cat: 'health', floor: 'dedicated' },
  bloodDonation: { label: 'Blood donation centre', cat: 'health', floor: 'ground' },
  altPrimary: { label: 'Alternative primary school', cat: 'education', floor: 'dedicated' },
  altSecondary: { label: 'Alternative secondary school', cat: 'education', floor: 'dedicated' },
  college: { label: 'College or university campus', cat: 'education', floor: 'dedicated' },
  museum: { label: 'Museum', cat: 'civic', floor: 'dedicated' },
  gallery: { label: 'Art gallery', cat: 'civic', floor: 'ground' },
  nightclub: { label: 'Nightclub', cat: 'entertainment', floor: 'ground' },
  bikeParking: { label: 'Bicycle parking', cat: 'transport', floor: 'ground' },
  districtPlaza: { label: 'District plaza', cat: 'civic', floor: 'open' },
  stationEntrance: { label: 'Rail station entrance', cat: 'transport', floor: 'ground' },
  skatingRink: { label: 'Skating rink', cat: 'recreation', floor: 'dedicated' },
  stadium: { label: 'Stadium and concert venue', cat: 'recreation', floor: 'dedicated' },
};

// The daily list: every home within EVERYDAY_REACH of one of each.
export const EVERYDAY = ['grocery', 'convenience', 'cafe', 'bank', 'gym', 'daycare', 'clinic', 'pharmacy'];
export const EVERYDAY_REACH = 400;

// One each (or as many as given) in every neighbourhood, along its main
// street out from the square.
export const NEIGHBOURHOOD_LIST = [
  ['postOffice', 1], ['foodBank', 1], ['inn', 1], ['communityCentre', 1],
  ['dental', 1], ['optometry', 1], ['physio', 1], ['psychotherapy', 1], ['vet', 1],
  ['boardGames', 1], ['liveMusic', 1], ['karaoke', 1],
  ['martialArts', 1], ['artStudio', 1], ['danceStudio', 1], ['musicLessons', 1],
  ['restaurant', 3], ['casual', 3], ['pub', 2], ['takeout', 2], ['dessert', 1], ['drinks', 1], ['deli', 1],
  ['florist', 1], ['ethnicGrocer', 2], ['bikeShop', 1], ['bookshop', 1], ['clothing', 2], ['hardware', 1],
  ['barber', 1], ['salon', 2], ['nails', 1], ['tutor', 1], ['tailor', 1], ['dryCleaner', 1], ['repair', 1],
];

// What fills the rest of a main street's shop floors, with weights.
export const HIGH_STREET_MIX = [
  ['restaurant', 6], ['casual', 6], ['cafe', 4], ['takeout', 3], ['pub', 3], ['dessert', 2], ['drinks', 2], ['deli', 2],
  ['clothing', 4], ['florist', 1], ['ethnicGrocer', 2], ['bookshop', 1], ['bikeShop', 1], ['hardware', 1], ['stationery', 1],
  ['barber', 2], ['salon', 3], ['nails', 2], ['tailor', 1], ['dryCleaner', 1], ['repair', 1],
  ['liquor', 1], ['officeSupply', 0.5], ['furniture', 0.7], ['sports', 0.7], ['toys', 0.7], ['pets', 0.7], ['hobby', 0.5],
  ['games', 0.5], ['music', 0.4], ['records', 0.4], ['artSupply', 0.4], ['gifts', 0.7], ['electronics', 0.7], ['medicalSupply', 0.4],
  ['tattoo', 0.6], ['print', 0.5], ['realEstate', 0.8], ['insurance', 0.6], ['travel', 0.4], ['catering', 0.4],
  ['grocery', 0.5], ['convenience', 0.5], ['pharmacy', 0.4], ['bank', 0.3], ['makerspace', 0.2], ['gallery', 0.3],
];
// Upstairs on a main street.
export const UPSTAIRS_MIX = [
  ['office', 20], ['law', 1.5], ['accounting', 1.5], ['dentalSpecialist', 1], ['specialistClinic', 1.2], ['alliedHealth', 1.5],
  ['spa', 0.6], ['photo', 0.6], ['recordingStudio', 0.3], ['proStudio', 0.4], ['languageSchool', 0.5], ['musicSchool', 0.4],
  ['fencing', 0.2], ['tutor', 1], ['danceStudio', 0.8], ['martialArts', 0.6], ['gym', 0.6], ['dental', 0.8], ['physio', 0.6],
];
// The core's podiums: a floor of offices holds several firms.
export const OFFICE_MIX = [
  ['office', 6], ['law', 3], ['accounting', 3], ['architects', 1.5], ['engineering', 1.5], ['consulting', 2], ['software', 3],
  ['design', 1.2], ['marketing', 1.5], ['recruitment', 1], ['coworking', 1.5], ['insuranceOffice', 1], ['bankOffice', 1],
  ['publisher', 0.6], ['charityOffice', 0.6], ['mediaCompany', 0.8], ['researchLab', 0.5], ['specialistClinic', 1.2],
  ['dentalSpecialist', 0.8], ['alliedHealth', 1], ['languageSchool', 0.6], ['tutor', 0.6], ['gym', 0.4], ['spa', 0.4],
];
// Corner units off the main streets: quiet uses only.
export const CORNER_MIX = [
  ['cafe', 2.5], ['convenience', 1.2], ['grocery', 0.8], ['takeout', 1.5], ['dessert', 1], ['barber', 1.5], ['salon', 1.5],
  ['florist', 1], ['daycare', 1], ['pharmacy', 0.8], ['clinic', 0.6], ['tutor', 0.6], ['dryCleaner', 0.8], ['tailor', 0.5],
  ['repair', 0.5], ['alliedHealth', 0.5], ['artStudio', 0.4], ['office', 1.5], ['catering', 0.3], ['deli', 0.8], ['nails', 0.5],
];
// The least plot (m²) a building of its own may stand on, by use: a
// museum or a courthouse needs a good part of a block, a fire station room
// for its engines, a church its nave. (Plots smaller are joined with their
// neighbours along the block until big enough.)
export const MIN_PLOT = {
  church: 600, mosque: 700, synagogue: 450, temple: 600,
  museum: 2500, districtLibrary: 1800, library: 900, courthouse: 2500, police: 1200, fireStation: 1000,
  performingArts: 2500, hotel: 1200, officeTower: 1200, departmentStore: 3000, inn: 350, hospice: 900,
  altPrimary: 1500, altSecondary: 2000, skatingRink: 2500, climbing: 1000, gymnastics: 1200,
  emergencyHousing: 600, transitionalHousing: 600,
};

// Places of worship, in about Toronto's proportions.
export const WORSHIP_MIX = [['church', 70], ['mosque', 11], ['synagogue', 8], ['temple', 11]];

// District-wide, mostly in the core: [use, how many, where].
export const DISTRICT_LIST = [
  ['police', 1, 'core'], ['districtLibrary', 1, 'core'], ['employment', 1, 'core'], ['museum', 1, 'core'], ['gallery', 2, 'core'],
  ['hotel', 2, 'core'], ['officeTower', 4, 'core'], ['nightclub', 2, 'core'], ['bikeParking', 1, 'core'], ['bloodDonation', 1, 'core'],
  ['boutique', 6, 'core'], ['shoes', 2, 'core'], ['eyewear', 1, 'core'], ['jewellery', 2, 'core'], ['watches', 1, 'core'],
  ['bags', 1, 'core'], ['cosmetics', 1, 'core'], ['perfume', 1, 'core'], ['languageSchool', 1, 'core'], ['specialists', 2, 'core'],
  ['radiology', 1, 'core'], ['lab', 1, 'core'],
  ['hospital', 2, 'large'], ['hospice', 1, 'quiet'], ['altPrimary', 1, 'quiet'], ['altSecondary', 1, 'quiet'],
  ['emergencyHousing', 1, 'quiet'], ['transitionalHousing', 1, 'quiet'], ['climbing', 1, 'any'], ['gymnastics', 1, 'any'],
  ['skatingRink', 1, 'any'],
];
export const SUBDISTRICT_LIST = [
  ['governmentOffice', 1, 'upper'], ['library', 1, 'dedicated'], ['fireStation', 1, 'dedicated'], ['recCentre', 1, 'large'],
  ['cinema', 1, 'upper'], ['bowling', 1, 'upper'], ['comedy', 1, 'ground'], ['performingArts', 1, 'dedicated'],
];
