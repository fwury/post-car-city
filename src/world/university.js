// Universities: their names, and the buildings a campus has.
//
// The city centre's main campus is its premier research university; the
// others are smaller. Each campus has its library, convocation hall and
// museums round a central lawn, then its other buildings (athletic centre,
// student union, bookstore, health clinic, places of worship), and its
// departments: enough for every major programme, combined on a small campus
// and split on a big one. Department buildings are mostly modern, the
// humanities more often old. A campus names its buildings after people
// almost never or almost always (rarely in between), and words them all one
// way.

import { hash, toUnit } from '../core/hash.js';

// Departments: [key, name, old (a traditional building)].
const CORE_DEPTS = [
  ['life', 'Life Sciences', false],
  ['chem', 'Chemistry', false],
  ['phys', 'Physical Sciences', false],
  ['cs', 'Computer Science', false],
  ['eng', 'Engineering', false],
  ['bus', 'Business', false],
  ['med', 'Medical Sciences', false],
  ['edu', 'Education', false],
  ['law', 'Law', true],
  ['soc', 'Social Sciences', false],
  ['hum', 'Humanities', true],
  ['pol', 'Social Work and Public Policy', false],
  ['lec', 'Lecture Halls', false],
  ['scilib', 'Science Library', false],
];
// A small campus: the same programmes in fewer buildings.
const SMALL_DEPTS = [
  ['life', 'Life and Health Sciences', false],
  ['phys', 'Science', false],
  ['eng', 'Engineering and Computing', false],
  ['bus', 'Business', false],
  ['edu', 'Education', false],
  ['soc', 'Arts and Social Sciences', true],
  ['law', 'Law', true],
  ['lec', 'Lecture Halls', false],
];
// A big campus besides: some split, some more.
const SPLIT_DEPTS = [
  ['eng2', 'Mechanical Engineering', false],
  ['eng3', 'Electrical Engineering', false],
  ['eng4', 'Civil Engineering', false],
  ['eng5', 'Chemical Engineering', false],
  ['hist', 'History', true],
  ['eng-lit', 'English', true],
  ['lang', 'Languages and Cultures', true],
  ['anth', 'Anthropology', true],
  ['anat', 'Anatomy', false],
  ['neuro', 'Neuroscience', false],
];
const EXTRA_DEPTS = [
  ['arch', 'Architecture', false],
  ['music', 'Music', true],
  ['drama', 'Drama', true],
  ['art', 'Visual Arts', false],
  ['dent', 'Dentistry', false],
  ['optom', 'Optometry', false],
  ['pharm', 'Pharmacy', false],
  ['research', 'Molecular Research', false],
  ['culture', 'Cultural Centre', true],
];

// Research institutes, for lots left over.
export const INSTITUTES = ['Advanced Materials', 'Climate Science', 'Data Science', 'Health Policy', 'Robotics', 'Quantum Science', 'Cell Biology', 'Urban Studies', 'Public Health', 'Mathematical Sciences', 'Economics', 'Psychology', 'Earth Sciences', 'Nursing', 'Astronomy', 'Kinesiology', 'Linguistics', 'Philosophy', 'Statistics', 'Global Affairs'];

// The departments of a campus, in order of need: everything for a small
// campus is in fewer buildings; a big one splits and adds.
export function departmentsFor(size, u) {
  if (size === 'small') return SMALL_DEPTS.slice();
  const list = CORE_DEPTS.slice();
  // (A big one: up to all of these, in an order of its own.)
  const more = [...SPLIT_DEPTS, ...EXTRA_DEPTS].map((x, i) => ({ x, r: u(i) })).sort((a, b) => a.r - b.r).map((o) => o.x);
  return list.concat(more);
}

// How a campus words its buildings' names.
export function namerFor(seed, key, surname) {
  const u = (...k) => toUnit(hash(seed, 'campus-names', key, ...k));
  // The share named after people: almost none or almost all.
  const people = u(1) < 0.5 ? u(2) * 0.12 : 0.88 + u(2) * 0.12;
  const plain = Math.floor(u(3) * 3); // "X Building", "Department of X", "X Centre"
  const named = Math.floor(u(4) * 3); // "Surname Building", "Surname X Building", "Surname Hall"
  let n = 0;
  return (dept, old, institute = false) => {
    const k = n++;
    if (institute) return u(10, k) < people ? `${surname(k)} Institute for ${dept}` : `${dept} Institute`;
    if (u(10, k) < people) {
      const who = surname(k);
      if (named === 0) return `${who} Building`;
      if (named === 1) return `${who} ${dept} Building`;
      return old ? `${who} Hall` : `${who} Building`;
    }
    if (dept === 'Lecture Halls' || dept === 'Science Library' || dept === 'Cultural Centre') return dept;
    if (dept === 'Molecular Research') return 'Institute for Molecular Research';
    if (plain === 1) return `Department of ${dept}`;
    if (plain === 2 && !old) return `${dept} Centre`;
    return `${dept} Building`;
  };
}

// Higher education besides the universities: about twice as many schools,
// mostly colleges, polytechnics and trade schools; in a big city, a few
// specialised ones too, at most one of each kind. [use, kind] for each.
const SCHOOLS_PER_UNIVERSITY = 2;
const UNIVERSITY_PEOPLE = 1e6;
const SPECIAL_FROM = 3e6; // people before the first specialised school
const SPECIAL_EVERY = 1e6; // and one more kind for each so many people more
const SPECIAL = ['art', 'music', 'film', 'culinary', 'seminary', 'law'];
const GENERAL = [['college', 'college'], ['college', 'college'], ['polytechnic', 'polytechnic'], ['tradeSchool', 'trades']];

// The schools each district has, by its core's key.
export function higherEdPlan(seed, cores, population, keyOf) {
  const u = (...k) => toUnit(hash(seed, 'higher-ed', ...k));
  const total = Math.max(1, Math.round((population / UNIVERSITY_PEOPLE) * SCHOOLS_PER_UNIVERSITY * (0.8 + 0.4 * u(1))));
  const kinds = SPECIAL.map((k, i) => ({ k, r: u(2, i) })).sort((a, b) => a.r - b.r).map((o) => o.k);
  const special = population < SPECIAL_FROM ? [] : kinds.slice(0, Math.min(kinds.length, 1 + Math.floor((population - SPECIAL_FROM) / SPECIAL_EVERY)));
  const list = [...special.map((k) => ['specialistSchool', k])];
  for (let i = 0; list.length < Math.max(total, special.length + 1); i++) list.push(GENERAL[Math.floor(u(3, i) * GENERAL.length)]);
  const plan = new Map();
  list.forEach(([use, kind], i) => {
    const c = cores[Math.floor(u(4, i) * cores.length)];
    const k = keyOf(c);
    if (!plan.has(k)) plan.set(k, []);
    plan.get(k).push({ use, kind, n: i });
  });
  return plan;
}
