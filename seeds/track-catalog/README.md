# Track catalog seed

Source data for pre-seeding the global track catalog, so a driver at a known track finds it already
listed, already carrying a timing link, and already pinned on the map.

Everything here is **input and provenance**. Nothing in this folder is read at runtime — the app
only ever reads the `Track` rows the import wrote.

## Sources

| Source | Rows | Carries | Licence |
|---|---|---|---|
| LiveRC subdomain sweep | 1,126 swept, 1,075 active | name, street, city, region, country, club website, event archive, **and the timing link** (the subdomain *is* the link) | Each track's own published contact block |
| OpenStreetMap `sport=rc_car` | 542 named worldwide, 448 in Europe | name, **exact coordinates**, sometimes website | ODbL — **attribution required** |

The two barely overlap: OSM has only 38 North American tracks, LiveRC has almost no EU. Together
they are ~1,500 tracks.

### MYLAPS / Speedhive is deliberately absent

A 994-row RC location dump from MYLAPS exists and is **not used, and must not be added**. Their
Conditions of Use Art. 5.3 forbids copying their data for commercial purposes (Dutch law, Haarlem
courts per Art. 10.2). The risk that actually matters is not a lawsuit but an IP block, which would
break Speedhive lap import for paying EU users — a self-inflicted outage on a shipped feature.

EU coverage comes from OpenStreetMap instead, and Speedhive links are donated one at a time by the
first driver at each track through the "find your timing link" button on the track page. That is
user-initiated, for that driver's own track, and carries none of the same exposure.

## Files

```
raw/liverc-subdomains.txt          1,126 hosts — input to both sweeps
raw/liverc-tracks.jsonl            sweep 1 output: the <address> block per track
raw/liverc-events.jsonl            sweep 2 output: event archive per track (the activity signal)
raw/liverc-scored-reference.json   the original 2026-08-19 analysis, kept to cross-check the re-parse
raw/osm-rc-tracks.json             Overpass export of sport=rc_car, named + coordinates
```

Regenerating any `raw/` file costs ~1,126 requests against a third party. Treat them as committed
provenance and only re-sweep when deliberately refreshing the catalog.

## Pipeline

```
scripts/track-catalog/sweep-liverc.mjs         ) one-off, already run 2026-08-19
scripts/track-catalog/sweep-liverc-events.mjs  )
scripts/track-catalog/fetch-osm.mjs            ) one-off Overpass export
        -> build-candidates.ts   joins + normalises + flags   -> candidates.json
        -> geocode-candidates.ts Nominatim, cached            -> geocode-cache.json
        -> match-existing.ts     vs the live catalog          -> matches.json
        -> review-server.mjs     founder review, resumable    -> decisions.json
        -> import-catalog.ts     --dry-run | --apply
```

Both Overpass and Nominatim are free public endpoints. They are called **once, from scripts, cached
to disk** — never from application code.

## Attribution

Track coordinates derived from OpenStreetMap must carry "© OpenStreetMap contributors" wherever they
are surfaced, plus a line in the app credits. This is the whole cost of the ODbL licence and it is
not optional.
