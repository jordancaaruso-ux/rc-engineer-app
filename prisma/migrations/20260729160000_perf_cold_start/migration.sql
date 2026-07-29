-- Cold-start attribution for PerfSample.
--
-- The dashboard renders in ~264ms server-side while the browser reports ~2.5s TTFB.
-- Everything measured inside the render happens after the gap, so the render timings
-- cannot explain it. These two columns can: `coldStart` marks the first request a
-- freshly booted process served, and `processAgeMs` records how long that process had
-- been alive. Slow requests clustering at a low process age means lambda boot, which no
-- query change would ever have fixed.

ALTER TABLE "PerfSample" ADD COLUMN "coldStart" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PerfSample" ADD COLUMN "processAgeMs" DOUBLE PRECISION;
