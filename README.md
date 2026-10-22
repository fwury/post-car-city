# Post-car city generator

An infinite, seeded map of a city built to the Post-Car City plan. Stages 1 to 4 are in place.

- **Districts.** District cores come first, spread like a loose Poisson field with varied spacing. Districts grow outward from each core over 400 m land parcels, and where districts meet the boundary becomes a primary greenway. Boundaries carry detail at several scales: broad sweeps and meanders from layered warps, then straight runs of 110 to 340 m with rounded bends, and small swells and pinches in width. Greenways carry no streams.
- **Boulevards.** Tram boulevards link the cores of neighbouring districts. Each link crosses the shared greenway near its middle at right angles; inside a district the links join through the station or end at T junctions (roundabouts are kept for roads outside the city). Boulevards and main streets that meet on a greenway carry on under it, drawn as tunnels.
- **District parks** of 40 to 70 ha sit where three districts meet, spread out evenly. Each flows out along its greenways and keeps a straight edge where it meets a boulevard.
- **Neighbourhoods.** Each is planned for about 15 000 people, enough to support its own shops, schools and services. Density varies, so areas do too: the mid-rise core around the station is densest, boulevards a little denser, and elsewhere housing changes smoothly from rowhouses (large neighbourhoods) to perimeter blocks (small ones). About one district in three has a campus neighbourhood (university or hospital) that houses fewer people for its size. A district gets as many neighbourhoods as its people fill. Every neighbourhood gets a main street through its centre first, and is then regrown outward from that street, so the main street nearest a point decides which neighbourhood it is in and boundaries fall between main streets. Hovering shows a neighbourhood's housing, population and density. Close in, once blocks are in, every block belongs to one neighbourhood, so boundaries run down the middle of streets (smoothed so they do not step round single blocks), and each neighbourhood is planned for the people its own blocks hold.
- **Main streets** (31 m, tram) are old roads between places, forming an organic grid. Every neighbourhood gets one route through its centre (at least one main street, and rarely more than three), laid from the core outwards: its inner half heads for the core and ends in a T on the first street that carries on past it, and its outer half runs on to the next neighbourhood further out, or to a gateway on the greenway (one per shared greenway, two on long ones), where it carries on into the next district. A neighbourhood still without one gets a cross street through its centre; in a wedge of land between two greenways it may end at the gate of the district park they meet at. A smooth direction field follows the boulevards and greenway edges, leans towards each core and drifts slowly elsewhere, so streets bend gently and meet mostly at right angles. No main street dead-ends, curls round or runs alongside another, and junctions keep clear of each other. With about 15 000 people to a neighbourhood that comes to roughly 1.8 to 2 km of main street and boulevard per km² (a main street every kilometre or so), with nearly all land within 600 m of one.
- **Local streets and blocks** (stage 4, from 0.25 px/m in). Streets come first, as centrelines, and each takes its own width out of the land either side, so a block is what is left between the building lines and a street is exactly the space between buildings. Main streets, boulevards and the streets along every greenway and park cut a district into superblocks; each is split again and again by a local street running across its long side, curving to meet the streets at its ends square on and carrying on any street already meeting it from outside, until the pieces are the size their housing calls for: perimeter blocks of about 100 m, rowhouse blocks about 50 m deep and 150 m or more long, larger podium blocks round the station, campus blocks. Every local street ends on another street; junctions are crossings and T junctions at about right angles, with no short jogs. Each neighbourhood's square (with a market) fronts its main street by its centre. A square may stand on its own with a pedestrian street off it, or take in the local street on one side, or on two adjacent sides, so it runs right up to the buildings of the blocks across; a street it takes in goes on beyond it as a pedestrian street. Each neighbourhood's park and secondary school sit side by side, set back from the main streets. Local streets show their pavements close in.
- **Plots** (from 0.7 px/m in). A perimeter block is several buildings round a courtyard, with gaps of 4.5 to 6.5 m between them, at least one on every street, open through to the courtyard. In the courtyard a path runs round along the backs of the buildings, and paths cross the green from the gaps to a small square in the middle. Plots are cut square to the street (and in a block with no courtyard, square to its long sides), narrower for mixed use on a main street, with corner plots wrapping round their corners. A rowhouse block splits down its spine into two terraces of houses 5 to 8 m wide, with an end house at each end. Podium blocks in the core are cut into a few big plots.
- **What is where**, following the urban design guide. Plots on main streets, boulevards, pedestrian streets and squares are mixed use: a shop floor, offices or studios above, homes over that; off them, quieter shop floors on corners and some other plots; in rowhouse areas only corner shops, and a parkette every 250 m or so. Every neighbourhood has its square and market, park, secondary school, two elementary schools, community centre, inn, places of worship (in about Toronto's mix), post office, food bank, health, arts, entertainment, food, shops and services along its main street; about one in three is a subdistrict centre (library, fire station, recreation centre, performing arts, cinema); the core has the district's own (hotels, office towers, police, library, museum, hospitals nearby, now and then a department store or courthouse). Every home is within 400 m of a grocery, convenience store, café, bank, gym, daycare, clinic and pharmacy. Storeys are set so each neighbourhood houses about the people it was planned for. Coloured dots (from 1.6 px/m in) show shop floors; hovering shows what is on a plot.

Far-zoom tiles render in Web Workers.

## Run

ES modules need a server, so `file://` won't work:

```
python3 -m http.server 8123
```

Then open http://localhost:8123. Views are shareable: `?seed=1&x=1400&y=1400&zoom=0.05`.

## Publish

A GitHub Pages workflow (`.github/workflows/pages.yml`) runs the tests and publishes the site on every push to `main`. Once, in the repository settings under Pages, set Source to GitHub Actions. The site then lives at `https://<user>.github.io/post-car-city/`.

## Test

```
node --test
```

## Conventions

- Units are metres. World x grows east, y grows south (north is up).
- No `Math.random()` in generation. Use `hash(seed, layer, ...ints)` or `rngFor(...)` from `src/core`.
- Generation lives in `src/core` and `src/world`; drawing in `src/render`; interface in `src/ui`.
