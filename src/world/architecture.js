// Architectural styles: what buildings are made of and how their roofs are
// formed, for drawing. Traditional European styles predominate; modern ones
// are kept for schools, hospitals, towers and some infill, and are meant to
// be humane (brick, stone, proportioned windows), not glass curtain walls.
//
// walls: facade colours; roofs: roof colours; roof: its form (flat, pitched,
// hipped, mansard, or, for landmarks, dome or spire); floor: storey height in
// metres.

export const STYLES = {
  georgian: { label: 'Georgian', walls: ['#c78a6c', '#b97a5e', '#d49c7c', '#e6dccb'], roof: 'pitched', roofs: ['#a3a8ae', '#989ea4', '#adb1b6'], floor: 3.1 },
  victorian: { label: 'Victorian', walls: ['#a9654d', '#bf7e60', '#c99a7a', '#e0d4c0'], roof: 'pitched', roofs: ['#9ca1a7', '#b39385', '#a6aaaf'], floor: 3.2 },
  neoclassical: { label: 'Neoclassical', walls: ['#efe7d7', '#e7ddca', '#f3ede1', '#e0d3bc'], roof: 'hipped', roofs: ['#b2b8bd', '#bcc1c5', '#a9b0b5'], floor: 3.4 },
  renaissance: { label: 'Renaissance revival', walls: ['#e4c690', '#d9b27c', '#edd5a8', '#d8a888'], roof: 'hipped', roofs: ['#d39a80', '#c98d73', '#dba68c'], floor: 3.5 },
  baroque: { label: 'Baroque', walls: ['#f0d8a6', '#e9c8a0', '#dba98d', '#f2e2c4'], roof: 'mansard', roofs: ['#a3a9ae', '#9fb5aa', '#a0a5aa'], floor: 3.5 },
  beauxArts: { label: 'Beaux-Arts', walls: ['#ede5d5', '#e4dac6', '#f1ebdf'], roof: 'mansard', roofs: ['#a8b3af', '#a3c0b3', '#a7adb2'], floor: 4.2 },
  artNouveau: { label: 'Art Nouveau', walls: ['#eadcc4', '#d9c7a7', '#cdd5c2', '#e7cfc0'], roof: 'mansard', roofs: ['#a1a7ac', '#98b0a6', '#aab0b4'], floor: 3.3 },
  artDeco: { label: 'Art Deco', walls: ['#e9ddcc', '#dacbb3', '#d1c8ba', '#e6d3bd'], roof: 'flat', roofs: ['#bdb6ab', '#b3ada3', '#c4bdb2'], floor: 3.3 },
  gothic: { label: 'Gothic Revival', walls: ['#cfc6b6', '#bdb3a2', '#d8cfbf'], roof: 'pitched', roofs: ['#959ba1', '#9ea3a9'], floor: 5 },
  modern: { label: 'Modern', walls: ['#d9d0c3', '#c8b6a1', '#b9a48d', '#e2ddd5'], roof: 'flat', roofs: ['#aaa69f', '#9fae92', '#b4b0a8'], floor: 3.2 },
  tower: { label: 'Contemporary residential', walls: ['#d3d9dc', '#e3ded4', '#c9cfd2', '#d8cfc4'], roof: 'flat', roofs: ['#a2aaae', '#99b28f', '#adb3b6'], floor: 3.1 },
};

// The traditional styles a district may be built in, as families that sit
// well together (a district takes one family as its base and borrows a
// little from the next).
export const FAMILIES = [
  ['georgian', 'victorian', 'neoclassical'],
  ['victorian', 'artNouveau', 'artDeco'],
  ['neoclassical', 'beauxArts', 'artNouveau'],
  ['renaissance', 'baroque', 'neoclassical'],
  ['baroque', 'artNouveau', 'beauxArts'],
  ['georgian', 'neoclassical', 'artDeco'],
];
