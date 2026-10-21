# Post-car city generator

An infinite, seeded map of a city built to the Post-Car City plan. Stages 1 to 3 are in place.

- **Districts.** District cores come first, spread like a loose Poisson field with varied spacing. Districts grow outward from each core over 400 m land parcels, and where districts meet the boundary becomes a primary greenway. Boundaries carry detail at several scales: broad sweeps and meanders from layered warps, then straight runs of 110 to 340 m with rounded bends, and small swells and pinches in width.
- **Boulevards.** Tram boulevards link the cores of neighbouring districts. Each link crosses the shared greenway near its middle at right angles; inside a district the links join through the station, end at T junctions, or now and then meet at a large roundabout.
- **District parks** of 40 to 70 ha sit where three districts meet, spread out evenly. Each flows out along its greenways and keeps a straight edge where it meets a boulevard.
- **Neighbourhoods.** Each district has a core neighbourhood around its station and 8 to 12 more of about 0.75 km², grown over a noisy field so their shapes are irregular. Where a boulevard runs through, centres sit on it and it serves as their main street.
- **Main streets** (31 m, tram) link neighbouring centres so each has a street running through it, run straight into the core (4 to 6 tram streets reach each core, boulevards included), and cross the greenways to meet the neighbourhoods of the next district at shared crossing points. Nearly all land is within 450 m of a main street or boulevard, and no main street dead-ends.

Far-zoom tiles render in Web Workers.

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
