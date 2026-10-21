# Post-car city generator

An infinite, seeded map of a city built to the Post-Car City plan. Stages 1 to 3 are in place.

- **Districts.** District cores come first, spread like a loose Poisson field with varied spacing. Districts grow outward from each core over 400 m land parcels, and where districts meet the boundary becomes a primary greenway. Boundaries carry detail at several scales: broad sweeps and meanders from layered warps, then straight runs of 110 to 340 m with rounded bends, and small swells and pinches in width. Greenways carry no streams.
- **Boulevards.** Tram boulevards link the cores of neighbouring districts. Each link crosses the shared greenway near its middle at right angles; inside a district the links join through the station, end at T junctions, or now and then meet at a large roundabout.
- **District parks** of 40 to 70 ha sit where three districts meet, spread out evenly. Each flows out along its greenways and keeps a straight edge where it meets a boulevard.
- **Neighbourhoods.** Each district has a core neighbourhood around its station and 8 to 12 more of about 0.75 km². Every neighbourhood gets a main street through its centre first, and is then regrown outward from that street, so the main street nearest a point decides which neighbourhood it is in and boundaries fall between main streets.
- **Main streets** (31 m, tram) form an organic grid. A smooth direction field follows the boulevards and greenway edges, leans towards each core and drifts slowly elsewhere; streets are traced along it and across it, so they bend gently and meet mostly at right angles. Streets are continuous: a street may end only in a T on a street that carries on past it, or at a greenway crossing where it carries on into the next district, so there are no stubs, corners where two streets both end, or hairpin loops. Streets running the same way keep at least 420 m apart, and about 97% of land is within 450 m of a main street or boulevard.

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
