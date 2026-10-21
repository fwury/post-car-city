# Post-car city generator

An infinite, seeded map of a city built to the Post-Car City plan. Stages 1 and 2 are in place. The city is generated the way old cities grew: boulevards first (long flowing routes, contour lines of smooth noise in three families), then district cores at route crossings and along routes, then districts grown outward from each core over 400 m land parcels (faster along boulevards). Where districts meet, the boundary becomes a primary greenway, and district parks sit where three districts meet. Far-zoom tiles render in Web Workers.

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
