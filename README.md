# Post-car city generator

An infinite, seeded map of a city built to the Post-Car City plan. Stages 1 to 3 are in place.

- **Districts.** District cores come first, spread like a loose Poisson field with varied spacing. Districts grow outward from each core over 400 m land parcels, and where districts meet the boundary becomes a primary greenway. Boundaries carry detail at several scales: broad sweeps and meanders from layered warps, then straight runs of 110 to 340 m with rounded bends, and small swells and pinches in width. Greenways carry no streams.
- **Boulevards.** Tram boulevards link the cores of neighbouring districts. Each link crosses the shared greenway near its middle at right angles; inside a district the links join through the station, end at T junctions, or now and then meet at a large roundabout.
- **District parks** of 40 to 70 ha sit where three districts meet, spread out evenly. Each flows out along its greenways and keeps a straight edge where it meets a boulevard.
- **Neighbourhoods.** Each is planned for about 15 000 people, enough to support its own shops, schools and services. Density varies, so areas do too: the mid-rise core around the station is densest, boulevards a little denser, and elsewhere housing changes smoothly from rowhouses (large neighbourhoods) to perimeter blocks (small ones). About one district in three has a campus neighbourhood (university or hospital) that houses fewer people for its size. A district gets as many neighbourhoods as its people fill. Every neighbourhood gets a main street through its centre first, and is then regrown outward from that street, so the main street nearest a point decides which neighbourhood it is in and boundaries fall between main streets. Hovering shows a neighbourhood's housing, population and density.
- **Main streets** (31 m, tram) are old roads between places, forming an organic grid. Every neighbourhood gets one route through its centre (at least one main street, and rarely more than three), laid from the core outwards: its inner half heads for the core and ends in a T on the first street that carries on past it, and its outer half runs on to the next neighbourhood further out, or to a gateway on the greenway (one per shared greenway, two on long ones), where it carries on into the next district. A neighbourhood still without one gets a cross street through its centre; in a wedge of land between two greenways it may end at the gate of the district park they meet at. A smooth direction field follows the boulevards and greenway edges, leans towards each core and drifts slowly elsewhere, so streets bend gently and meet mostly at right angles. No main street dead-ends, curls round or runs alongside another, and junctions keep clear of each other. With about 15 000 people to a neighbourhood that comes to roughly 1.8 to 2 km of main street and boulevard per km² (a main street every kilometre or so), with nearly all land within 600 m of one.

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
