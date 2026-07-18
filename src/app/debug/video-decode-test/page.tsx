"use client";

/**
 * Phone decode feasibility test for automatic sector marking (Step 3 of the
 * auto-snap plan). Picks a camera-roll video and dry-runs the exact I/O the
 * auto-marker needs — seek to a random spot, read ~2s of frames, sample a
 * pixel band from each — and times every stage. No detection logic; this
 * measures whether the phone can feed it.
 */

import { useRef, useState } from "react";

const WINDOW_SEC = 2.0;
const SPOTS = 8;

type WindowResult = {
  t0: number;
  seekMs: number;
  rate: number;
  framesPresented: number;
  framesExpected: number;
  wallMs: number;
  sampleMsAvg: number;
};

type TestReport = {
  fileName: string;
  bytes: number;
  duration: number;
  width: number;
  height: number;
  rvfcSupported: boolean;
  windows: WindowResult[];
  verdict: "pass" | "marginal" | "fail";
  summary: string;
};

function fmtMs(n: number): string {
  return `${Math.round(n)}ms`;
}

export default function VideoDecodeTestPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<string>("Pick a heat video from your camera roll.");
  const [progress, setProgress] = useState<string[]>([]);
  const [report, setReport] = useState<TestReport | null>(null);
  const [running, setRunning] = useState(false);

  async function runTest(file: File) {
    setRunning(true);
    setReport(null);
    setProgress([]);
    const log = (s: string) => setProgress((p) => [...p, s]);

    const video = videoRef.current!;
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    try {
      setStatus("Loading video metadata…");
      await new Promise<void>((res, rej) => {
        video.onloadedmetadata = () => res();
        video.onerror = () => rej(new Error("Could not open this video."));
      });
      const duration = video.duration;
      const width = video.videoWidth;
      const height = video.videoHeight;
      const rvfcSupported = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
      log(`Video: ${width}x${height}, ${Math.round(duration)}s, ${Math.round(file.size / 1e6)}MB`);
      log(`Frame callback API: ${rvfcSupported ? "available" : "MISSING (older iOS?)"}`);

      // Sampling canvas ≈ the watch-band readback the detector does.
      const canvas = canvasRef.current!;
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

      const margin = Math.min(20, duration * 0.1);
      const usable = Math.max(duration - 2 * margin - WINDOW_SEC, 1);
      // Assume ~30fps if we can't know better; only used for the "expected" denominator.
      const assumedFps = 30;

      const windows: WindowResult[] = [];
      const rates = [1, 2];

      for (let i = 0; i < SPOTS; i++) {
        const t0 = margin + ((i + 0.5) / SPOTS) * usable;
        const rate = rates[i % rates.length]!;
        setStatus(`Window ${i + 1}/${SPOTS} — seeking to ${Math.round(t0)}s…`);

        video.pause();
        const seekStart = performance.now();
        video.currentTime = t0;
        await new Promise<void>((res) => {
          const done = () => {
            video.removeEventListener("seeked", done);
            res();
          };
          video.addEventListener("seeked", done);
        });
        const seekMs = performance.now() - seekStart;

        setStatus(`Window ${i + 1}/${SPOTS} — reading ${WINDOW_SEC}s at ${rate}x…`);
        let frames = 0;
        let sampleMsTotal = 0;
        let sampleCount = 0;
        const wallStart = performance.now();
        video.playbackRate = rate;

        await new Promise<void>((res) => {
          let handle = 0;
          const stopAt = t0 + WINDOW_SEC;
          const finish = () => {
            if (handle && "cancelVideoFrameCallback" in video) {
              (video as HTMLVideoElement & { cancelVideoFrameCallback(h: number): void }).cancelVideoFrameCallback(handle);
            }
            video.pause();
            res();
          };
          if (rvfcSupported) {
            const onFrame: VideoFrameRequestCallback = (_now, meta) => {
              frames += 1;
              // Sample a pixel band every 3rd frame — the detector reads every
              // frame but only a small strip; every-3rd at 640x360 is a fair proxy.
              if (frames % 3 === 0) {
                const s = performance.now();
                ctx.drawImage(video, 0, height * 0.3, width, height * 0.4, 0, 0, 640, 360);
                ctx.getImageData(0, 0, 640, 360);
                sampleMsTotal += performance.now() - s;
                sampleCount += 1;
              }
              if (meta.mediaTime >= stopAt || video.ended) finish();
              else handle = video.requestVideoFrameCallback(onFrame);
            };
            handle = video.requestVideoFrameCallback(onFrame);
          } else {
            const onTime = () => {
              frames += 1;
              if (video.currentTime >= stopAt || video.ended) {
                video.removeEventListener("timeupdate", onTime);
                finish();
              }
            };
            video.addEventListener("timeupdate", onTime);
          }
          void video.play().catch(() => finish());
          // Safety: never hang a window longer than 15s.
          setTimeout(finish, 15000);
        });

        const wallMs = performance.now() - wallStart;
        const framesExpected = Math.round(assumedFps * WINDOW_SEC);
        const sampleMsAvg = sampleCount ? sampleMsTotal / sampleCount : 0;
        windows.push({ t0, seekMs, rate, framesPresented: frames, framesExpected, wallMs, sampleMsAvg });
        log(
          `#${i + 1} @${Math.round(t0)}s: seek ${fmtMs(seekMs)} · ${rate}x · ` +
            `${frames}/${framesExpected} frames in ${fmtMs(wallMs)} · sample ${fmtMs(sampleMsAvg)}/frame`
        );
      }

      const seekAvg = windows.reduce((a, w) => a + w.seekMs, 0) / windows.length;
      const oneX = windows.filter((w) => w.rate === 1);
      const twoX = windows.filter((w) => w.rate === 2);
      const covOneX = oneX.length
        ? oneX.reduce((a, w) => a + w.framesPresented / w.framesExpected, 0) / oneX.length
        : 0;
      const covTwoX = twoX.length
        ? twoX.reduce((a, w) => a + w.framesPresented / w.framesExpected, 0) / twoX.length
        : 0;
      const sampleAvg = windows.reduce((a, w) => a + w.sampleMsAvg, 0) / windows.length;

      // 18 windows ≈ 6 lines × 3 laps.
      const estFullJobSec = (18 * (seekAvg + (covTwoX >= 0.85 ? WINDOW_SEC / 2 : WINDOW_SEC) * 1000)) / 1000;

      let verdict: TestReport["verdict"];
      if (rvfcSupported && seekAvg < 2500 && covOneX >= 0.85) verdict = "pass";
      else if (rvfcSupported && seekAvg < 5000 && covOneX >= 0.6) verdict = "marginal";
      else verdict = "fail";

      const summary =
        `seek avg ${fmtMs(seekAvg)} · frames delivered ${(covOneX * 100).toFixed(0)}% @1x` +
        (twoX.length ? ` / ${(covTwoX * 100).toFixed(0)}% @2x` : "") +
        ` · band sample ${fmtMs(sampleAvg)}/frame · est. full auto-mark ~${Math.round(estFullJobSec)}s`;

      setReport({
        fileName: file.name,
        bytes: file.size,
        duration,
        width,
        height,
        rvfcSupported,
        windows,
        verdict,
        summary,
      });
      setStatus("Done.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Test failed.");
    } finally {
      URL.revokeObjectURL(url);
      setRunning(false);
    }
  }

  return (
    <main className="page-body mx-auto flex max-w-md flex-col gap-4 p-4 pb-16">
      <div>
        <h1 className="text-[18px] font-bold tracking-tight">Video decode test</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          Dry run for automatic sector marking: seeks to {SPOTS} spots in a big video, reads{" "}
          {WINDOW_SEC}s of frames at each, and samples pixels — then says whether this phone can
          feed the auto-marker. Nothing uploads.
        </p>
      </div>

      <label
        className={
          "flex w-full cursor-pointer flex-col items-center gap-1 rounded-2xl border-[1.5px] border-dashed border-foreground/20 bg-secondary px-4 py-6 text-[13px] font-semibold" +
          (running ? " opacity-50" : "")
        }
      >
        {running ? "Running…" : "Pick a heat video"}
        <span className="text-[11px] font-normal text-faint">the bigger the better — this is a stress test</span>
        <input
          type="file"
          accept="video/*"
          className="hidden"
          disabled={running}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void runTest(f);
          }}
        />
      </label>

      <p className="text-[12px] text-muted-foreground">{status}</p>

      {report ? (
        <div
          className={
            "rounded-xl border p-4 " +
            (report.verdict === "pass"
              ? "border-[#4FD089]/40 bg-[#4FD089]/5"
              : report.verdict === "marginal"
                ? "border-[#E5A44E]/40 bg-[#E5A44E]/5"
                : "border-destructive/40 bg-destructive/5")
          }
        >
          <p
            className={
              "font-mono text-[20px] font-bold uppercase tracking-[0.1em] " +
              (report.verdict === "pass"
                ? "text-[#4FD089]"
                : report.verdict === "marginal"
                  ? "text-[#E5A44E]"
                  : "text-destructive")
            }
          >
            {report.verdict}
          </p>
          <p className="mt-2 font-mono text-[11.5px] leading-relaxed text-foreground">{report.summary}</p>
          <p className="mt-2 text-[11.5px] leading-relaxed text-muted-foreground">
            {report.verdict === "pass"
              ? "This phone can feed the auto-marker. Screenshot this and send it over."
              : report.verdict === "marginal"
                ? "Workable but slow — auto-marking would take a few minutes per session. Screenshot this and send it over."
                : "This phone can't read frames fast enough — auto-marking should run on a computer instead. Screenshot this and send it over."}
          </p>
        </div>
      ) : null}

      {progress.length ? (
        <div className="rounded-xl border border-border bg-secondary/50 p-3">
          {progress.map((line, i) => (
            <p key={i} className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
              {line}
            </p>
          ))}
        </div>
      ) : null}

      <video ref={videoRef} className="hidden" />
      <canvas ref={canvasRef} className="hidden" />
    </main>
  );
}
