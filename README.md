# Post-car city generator

An infinite, seeded map of a city built to the Post-Car City plan. Stages 1 and 2 are in place. District cores come first, spread like a loose Poisson field with varied spacing. Districts grow outward from each core over 400 m land parcels, and where districts meet the boundary becomes a primary greenway. Boundaries carry detail at several scales: broad sweeps and meanders from layered warps, then straight runs of 110 to 340 m with rounded bends, and small swells and pinches in width. Tram boulevards then link the cores of neighbouring districts: each link crosses the shared greenway near its middle at right angles, and inside a district the links join through the station, end at T junctions, or now and then meet at a large roundabout. District parks sit where three districts meet. Far-zoom tiles render in Web Workers.

## Run

ES modules need a server, so `file://` won't work:

```
python3 -m http.server 8123
```

Then open http://localhost:8123. Views are shareable: `?seed=1&x=1400&y=1400&zoom=0.05`.

## Test

```
node --test
```

## Conventions

- Units are metres. World x grows east, y grows south (north is up).
- No `Math.random()` in generation. Use `hash(seed, layer, ...ints)` or `rngFor(...)` from `src/core`.
- Generation lives in `src/core` and `src/world`; drawing in `src/render`; interface in `src/ui`.
