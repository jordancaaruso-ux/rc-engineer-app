/**
 * The index reader against ffprobe, on a file ffmpeg writes here and now.
 *
 * Every sample's position, size, keyframe flag, decode time and presentation time has to match
 * what ffprobe reads from the same file, or the decoder is handed the wrong bytes or the wrong
 * clock. Presentation time is the one that matters most: it is what the driver's marks and the
 * transponder sync are measured on.
 *
 *   npx tsx src/lib/videoAnalysis/findCrossings/mp4.test.ts
 *   MP4_CHECK_FILE=F:/Downloads/IMG_4522.MOV npx tsx …   # also check a real phone file
 *
 * Needs ffmpeg and ffprobe on the PATH; without them the ffmpeg-made fixtures are skipped and
 * only the pure functions are checked.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  avcCodecString,
  decodeSec,
  hevcCodecString,
  parseMovie,
  presentationSec,
  samplesForRange,
  type ByteSource,
  type VideoTrack,
} from "./mp4";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function fileSource(path: string): ByteSource & { close(): void } {
  const fd = openSync(path, "r");
  return {
    size: statSync(path).size,
    async read(offset, length) {
      const buf = new Uint8Array(length);
      const n = readSync(fd, buf, 0, length, offset);
      return n === length ? buf : buf.subarray(0, n);
    },
    close: () => closeSync(fd),
  };
}

type Packet = { pts: number; dts: number; size: number; pos: number; key: boolean };

function ffprobePackets(path: string): Packet[] {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,dts_time,size,pos,flags", "-of", "csv=p=0", path],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  return out
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [pts, dts, size, pos, flags] = line.split(",");
      return { pts: Number(pts), dts: Number(dts), size: Number(size), pos: Number(pos), key: (flags ?? "").startsWith("K") };
    });
}

function haveTool(name: string): boolean {
  return spawnSync(name, ["-version"], { stdio: "ignore" }).status === 0;
}

/** ffprobe lists packets in decode (file) order, as the sample table does. */
async function checkAgainstFfprobe(path: string, label: string) {
  const src = fileSource(path);
  try {
    const movie = await parseMovie(src);
    const track = movie.video;
    const packets = ffprobePackets(path);
    assert(track.samples.length === packets.length, `${label}: ${track.samples.length} samples vs ${packets.length} packets`);
    const tick = 1 / track.timescale;
    let worstPts = 0;
    for (let i = 0; i < packets.length; i++) {
      const s = track.samples[i]!;
      const p = packets[i]!;
      assert(s.offset === p.pos, `${label} #${i}: offset ${s.offset} vs ${p.pos}`);
      assert(s.size === p.size, `${label} #${i}: size ${s.size} vs ${p.size}`);
      assert(s.sync === p.key, `${label} #${i}: sync ${s.sync} vs key ${p.key}`);
      const pts = presentationSec(track, s);
      const dts = decodeSec(track, s);
      worstPts = Math.max(worstPts, Math.abs(pts - p.pts));
      assert(Math.abs(pts - p.pts) <= tick, `${label} #${i}: pts ${pts.toFixed(4)} vs ${p.pts.toFixed(4)}`);
      assert(Math.abs(dts - p.dts) <= tick, `${label} #${i}: dts ${dts.toFixed(4)} vs ${p.dts.toFixed(4)}`);
    }
    console.log(
      `  ${label}: ${track.codec} ${track.codedWidth}x${track.codedHeight} · ${track.samples.length} samples ` +
        `· index ${movie.moovBytes} bytes · presentation offset ${track.presentationOffset} ticks · worst pts error ${(worstPts * 1000).toFixed(2)}ms`
    );
    return track;
  } finally {
    src.close();
  }
}

/* ---------- codec strings, from records as a phone writes them ---------- */
{
  // avcC: version 1, High profile (100), no constraints, level 4.0.
  assert(avcCodecString(new Uint8Array([1, 0x64, 0x00, 0x28])) === "avc1.640028", "H.264 codec string");
  // hvcC: Main profile, tier L, compat flags 0x60000000 (bits 1 and 2), constraints 0x90 then zeros, level 123.
  const hvcC = new Uint8Array(23);
  hvcC[0] = 1;
  hvcC[1] = 0x01; // space 0, tier 0, profile 1
  hvcC[2] = 0x60;
  hvcC[6] = 0x90;
  hvcC[12] = 123;
  assert(hevcCodecString(hvcC) === "hvc1.1.6.L123.90", `HEVC codec string, got ${hevcCodecString(hvcC)}`);
}

/* ---------- which samples a range needs ---------- */
{
  // Ten frames at 30fps, keyframes at 0 and 5, shown in file order.
  const ts = 600;
  const track: VideoTrack = {
    id: 1,
    codec: "avc1.640028",
    description: null,
    codedWidth: 64,
    codedHeight: 64,
    timescale: ts,
    durationSec: 10 / 30,
    presentationOffset: 0,
    decodeShift: 0,
    samples: Array.from({ length: 10 }, (_, i) => ({
      offset: i * 100,
      size: 100,
      dts: i * 20,
      cts: i * 20,
      duration: 20,
      sync: i === 0 || i === 5,
    })),
  };
  const r = samplesForRange(track, 0.21, 0.25);
  assert(r.first === 5, `starts at the keyframe before 0.21s, got ${r.first}`);
  assert(r.end === 8, `ends after the first sample decoded past 0.25s, got ${r.end}`);
  const whole = samplesForRange(track, 0, 1);
  assert(whole.first === 0 && whole.end === 10, "the whole file");
}

/* ---------- ffmpeg-made files, checked against ffprobe ---------- */
(async () => {
  if (!haveTool("ffmpeg") || !haveTool("ffprobe")) {
    console.log("mp4.test.ts: ffmpeg not on PATH — fixture checks skipped");
    console.log("mp4.test.ts: OK");
    return;
  }
  const dir = tmpdir();
  const h264 = join(dir, "rc-mp4-test-h264.mp4");
  // B-frames and a moov at the end, the way a phone writes it; two keyframes so a range has a
  // keyframe to start from.
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=30", "-t", "2", "-c:v", "libx264", "-bf", "2", "-g", "15", "-pix_fmt", "yuv420p", h264], { stdio: "ignore" });
  const t = await checkAgainstFfprobe(h264, "h264 (moov last)");
  assert(t.codec.startsWith("avc1."), `codec string ${t.codec}`);
  assert(t.samples.some((s) => s.cts !== s.dts), "B-frames: presentation differs from decode order");

  const faststart = join(dir, "rc-mp4-test-faststart.mp4");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", h264, "-c", "copy", "-movflags", "+faststart", faststart], { stdio: "ignore" });
  await checkAgainstFfprobe(faststart, "h264 (moov first)");

  const hevcOk = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=64x64:rate=30", "-t", "1", "-c:v", "libx265", "-tag:v", "hvc1", "-pix_fmt", "yuv420p", join(dir, "rc-mp4-test-hevc.mov")], { stdio: "ignore" }).status === 0;
  if (hevcOk) {
    const h = await checkAgainstFfprobe(join(dir, "rc-mp4-test-hevc.mov"), "hevc");
    assert(h.codec.startsWith("hvc1."), `codec string ${h.codec}`);
  } else {
    console.log("  (no libx265 in this ffmpeg — HEVC fixture skipped)");
  }

  const real = process.env.MP4_CHECK_FILE;
  if (real) await checkAgainstFfprobe(real, real);

  console.log("mp4.test.ts: OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
