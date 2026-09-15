"use client";

/**
 * Run the race pass against a real job, and print what it made of it.
 *
 * The standing rig for the pass, in the same spirit as `/debug/find-crossings`: the point is to
 * be able to read a real race end to end, on real footage, and see every number it produced —
 * before any of it is wired to a button a driver can press.
 *
 * It reads the job's own session (its timing, its drawn lines, its sync), so what happens here is
 * what would happen in the flow. **It writes nothing.** Grading needs to be repeatable and the
 * job has to stay as it was.
 *
 *   /debug/race-pass?job=<id>
 *
 * Then pick the video. `scripts/dev-drive-race.mts` does both without a person.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";

import { parseManualVideoSession, type ManualVideoSessionV2 } from "@/lib/manualVideoAnalysis/types";
import { parseMovie } from "@/lib/videoAnalysis/findCrossings/mp4";
import { blobSource } from "@/lib/videoAnalysis/findCrossings/frameSource";
import { runRacePass, type RacePassOutcome } from "@/lib/videoAnalysis/racePass/browserRace";
import { seatedRolesOf, sheetFromSession } from "@/lib/videoAnalysis/racePass/sheet";
import { SF_LINE_KEY } from "@/lib/videoAnalysis/findCrossings/fromSession";
import type { SectorLine } from "@/lib/videoAnalysis/findCrossings/types";

type LineRow = {
  lineKey: string;
  label: string;
  sortOrder: number;
  x1: number | null;
  y1: number | null;
  x2: number | null;
  y2: number | null;
};

export default function RacePassPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const params = useSearchParams();
  const jobId = params.get("job") ?? "";
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState("Loading the job…");
  const [session, setSession] = useState<ManualVideoSessionV2 | null>(null);
  const [lines, setLines] = useState<SectorLine[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<RacePassOutcome | null>(null);

  const say = useCallback((s: string) => {
    console.debug(`[racepass] ${s}`);
    setLog((p) => [...p, s]);
  }, []);

  useEffect(() => {
    if (!jobId) {
      setStatus("Add ?job=<id> to the address.");
      return;
    }
    let live = true;
    void (async () => {
      const res = await fetch(`/api/video-analysis/jobs/${jobId}`);
      if (!res.ok) {
        if (live) setStatus(`Could not load the job (${res.status}).`);
        return;
      }
      const data = (await res.json()) as { job?: { manualJson?: unknown }; sectorLines?: LineRow[] };
      const parsed = parseManualVideoSession(data.job?.manualJson);
      if (!live) return;
      if (!parsed) {
        setStatus("This job has no analysis session on it.");
        return;
      }
      const drawn = (data.sectorLines ?? [])
        .filter((l) => l.x1 != null && l.y1 != null && l.x2 != null && l.y2 != null)
        .map((l) => ({
          lineKey: l.lineKey,
          label: l.label,
          sortOrder: l.sortOrder,
          x1: l.x1!,
          y1: l.y1!,
          x2: l.x2!,
          y2: l.y2!,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder);
      setSession(parsed);
      setLines(drawn);
      const sheet = sheetFromSession(parsed);
      setStatus(
        `${sheet.length} drivers on the sheet, ${sheet.reduce((s, d) => s + d.laps.length, 0)} laps, ${drawn.length} lines drawn. Pick ${parsed.localVideoName ?? "the video"}.`
      );
    })();
    return () => {
      live = false;
    };
  }, [jobId]);

  async function run(file: File) {
    if (!session) return;
    setRunning(true);
    setLog([]);
    setOutcome(null);
    const video = videoRef.current!;
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    try {
      setStatus("Reading the file header…");
      await new Promise<void>((res, rej) => {
        video.onloadedmetadata = () => res();
        video.onerror = () => rej(new Error("Could not open this video."));
      });
      let frameW = video.videoWidth;
      let frameH = video.videoHeight;
      if (!frameW || !frameH) {
        // No hardware decoder for this codec: the file's own index still says how big it is.
        const movie = await parseMovie(blobSource(file));
        frameW = movie.video.codedWidth;
        frameH = movie.video.codedHeight;
      }
      say(`${file.name} · ${frameW}×${frameH} · ${Math.round(video.duration)}s`);

      // `?from=&to=` clips the sheet to a window. Grading a nine-minute practice run end to end
      // costs nine minutes of decoding every time a rule changes, and most questions are about a
      // handful of laps. The whole sheet is still there, so naming still has to tell the drivers
      // apart — there are simply fewer laps of it.
      const fromSec = Number(params.get("from"));
      const toSec = Number(params.get("to"));
      const clip = Number.isFinite(fromSec) && Number.isFinite(toSec) && toSec > fromSec;
      const sheet = sheetFromSession(session)
        .map((d) => (clip ? { ...d, laps: d.laps.filter((l) => l.startSec >= fromSec && l.startSec <= toSec) } : d))
        .filter((d) => d.laps.length > 0);
      if (clip) say(`clipped to ${fromSec}–${toSec}s`);
      for (const d of sheet) {
        say(`sheet ${d.name}${d.role ? ` (${d.role})` : ""}: ${d.laps.length} laps, ${d.laps[0]!.startSec.toFixed(2)}s → ${(d.laps[d.laps.length - 1]!.startSec + d.laps[d.laps.length - 1]!.lapTimeSec).toFixed(2)}s`);
      }

      const result = await runRacePass({
        video,
        file,
        frameW,
        frameH,
        durationSec: video.duration,
        lines,
        sfKey: SF_LINE_KEY,
        sheet,
        seatedRoles: seatedRolesOf(session),
        sessionId: session.timingSessions[0]?.sessionId ?? "unknown",
        onProgress: (p) => setStatus(`${Math.round(p.fraction * 100)}% · ${p.note}`),
      });
      setOutcome(result);
      // Left where a drive script can pick it up. Everything after the read is a pure function of
      // this, so a rule can be tried again in a second instead of another minute of decoding.
      (window as unknown as { __racePassDump?: unknown }).__racePassDump = result.dump;
      say(`dump ready · ${result.dump.frames.length} frames of sightings`);
      say(
        `DONE ${result.named.laps.length} laps named · ${result.pieces.marks.length} marks · ${Object.keys(result.pieces.traces).length} traces · ${result.sectors.missing.length} missing · ${result.framesRead} frames in ${(result.elapsedMs / 1000).toFixed(1)}s${result.starved ? " STARVED" : ""}`
      );
      setStatus("Done. Nothing was saved.");
    } catch (e) {
      say(`FAILED ${(e as Error).message}`);
      setStatus(`Failed: ${(e as Error).message}`);
    } finally {
      URL.revokeObjectURL(url);
      setRunning(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <h1 className="type-machine text-[13px] font-bold uppercase tracking-[0.1em]">Race pass</h1>

      <label className="inline-flex w-fit cursor-pointer items-center rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-ink">
        {running ? "Reading…" : "Pick the video"}
        <input
          type="file"
          accept="video/*"
          className="hidden"
          disabled={running || !session}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void run(f);
          }}
        />
      </label>

      <p className="text-[12px] text-muted-foreground">{status}</p>

      {outcome ? (
        <div className="rounded-xl border border-border p-4">
          <p className="type-machine text-[11.5px] leading-relaxed">
            {outcome.named.verdict === "ok" ? "OK" : "DOESN'T LINE UP"} · {(outcome.named.namedShare * 100).toFixed(0)}% of the
            sheet named · {outcome.named.unnamed} paths matched nobody · {outcome.named.ties.length} ties ·{" "}
            {outcome.named.bridged} bridged
          </p>
          {outcome.named.sheetCheck ? (
            <p className="mt-1 type-machine text-[11.5px] leading-relaxed text-muted-foreground">
              sheet check {outcome.named.sheetCheck.laps} laps · median {outcome.named.sheetCheck.medianMs.toFixed(0)}ms ·
              worst {outcome.named.sheetCheck.worstMs.toFixed(0)}ms
            </p>
          ) : null}
        </div>
      ) : null}

      {log.length ? (
        <div className="rounded-xl border border-border bg-secondary/50 p-3">
          {log.map((line, i) => (
            <p key={i} className="type-machine text-[10.5px] leading-relaxed text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
      ) : null}

      <video ref={videoRef} className="hidden" />
    </main>
  );
}
