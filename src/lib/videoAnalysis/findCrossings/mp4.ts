/**
 * Just enough MP4 / QuickTime to hand a phone video to WebCodecs.
 *
 * A video file is one big blob of compressed frames (`mdat`) and an index (`moov`) saying where
 * each frame sits, how big it is, when it is shown, and which ones can be decoded on their own.
 * WebCodecs decodes frames; it does not read files. So this reads the index — a few hundred
 * kilobytes at the front or the back of a file that may be half a gigabyte — and hands back a
 * sample table the frame reader can slice the file by. Nothing here touches the DOM, so it can
 * be checked in Node against ffprobe's packet list for the same file.
 *
 * Deliberately small: one video track, plain (unfragmented) files, the codecs a phone writes
 * (HEVC and H.264). Anything else throws, and the caller falls back to playing the video.
 */

/** Random-access bytes — a Blob in the browser, a file handle in Node. */
export type ByteSource = {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
};

export type VideoSample = {
  /** Where the compressed frame sits in the file. */
  offset: number;
  size: number;
  /** Decode order clock, media ticks. */
  dts: number;
  /** Presentation clock, media ticks, before the edit list. */
  cts: number;
  /** Media ticks. */
  duration: number;
  /** Decodable on its own — the only place a read can start. */
  sync: boolean;
};

export type VideoTrack = {
  id: number;
  /** WebCodecs codec string, e.g. `hvc1.1.6.L123.B0` or `avc1.640028`. */
  codec: string;
  /** The decoder configuration record (the `hvcC` / `avcC` payload) WebCodecs takes as `description`. */
  description: Uint8Array | null;
  codedWidth: number;
  codedHeight: number;
  /** Ticks per second on the sample clocks. */
  timescale: number;
  durationSec: number;
  /** In decode (file) order. */
  samples: VideoSample[];
  /**
   * Ticks taken off every `cts` so presentation starts where a player's clock does. A phone
   * writes frames out of order and an edit list that says "start showing at the first frame's
   * presentation time", so without this every frame would read a couple of frames late against
   * the marks a driver made on the player.
   */
  presentationOffset: number;
  /**
   * Ticks added to every `dts` so that no frame is decoded after it is shown. A QuickTime file
   * may write negative reorder offsets (a frame's `cts` below its `dts`); shifting decode time
   * by the most negative one is what ffmpeg does, and it keeps "the first sample decoded after
   * the range" a safe place to stop.
   */
  decodeShift: number;
};

export type MovieInfo = {
  video: VideoTrack;
  /** Size of the index that was read, for the log line. */
  moovBytes: number;
};

/** Seconds on the player's clock at which this sample is shown. */
export function presentationSec(track: VideoTrack, s: VideoSample): number {
  return (s.cts - track.presentationOffset) / track.timescale;
}

/** Seconds on the player's clock at which this sample is decoded — never later than shown. */
export function decodeSec(track: VideoTrack, s: VideoSample): number {
  return (s.dts + track.decodeShift - track.presentationOffset) / track.timescale;
}

/* ------------------------------------------------------------------------------------------
 * Boxes
 * ---------------------------------------------------------------------------------------- */

type Box = { type: string; start: number; end: number; body: number };

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts"]);

function fourcc(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3)
  );
}

/** Read one box header at `at` inside `view`; `end` bounds the parent. */
function boxAt(view: DataView, at: number, end: number): Box | null {
  if (at + 8 > end) return null;
  let size = view.getUint32(at);
  const type = fourcc(view, at + 4);
  let body = at + 8;
  if (size === 1) {
    if (at + 16 > end) return null;
    size = Number(view.getBigUint64(at + 8));
    body = at + 16;
  } else if (size === 0) {
    size = end - at;
  }
  if (size < body - at) throw new Error(`Bad box size at ${at}`);
  return { type, start: at, end: Math.min(end, at + size), body };
}

function* children(view: DataView, start: number, end: number): Generator<Box> {
  let at = start;
  while (at < end) {
    const b = boxAt(view, at, end);
    if (!b) return;
    yield b;
    at = b.end;
  }
}

function find(view: DataView, start: number, end: number, type: string): Box | null {
  for (const b of children(view, start, end)) if (b.type === type) return b;
  return null;
}

function findPath(view: DataView, box: Box, path: string[]): Box | null {
  let cur: Box | null = box;
  for (const type of path) {
    if (!cur) return null;
    cur = find(view, cur.body, cur.end, type);
  }
  return cur;
}

/** FullBox: version byte + 24-bit flags, then the payload. */
function full(view: DataView, box: Box): { version: number; at: number } {
  return { version: view.getUint8(box.body), at: box.body + 4 };
}

/* ------------------------------------------------------------------------------------------
 * Sample tables
 * ---------------------------------------------------------------------------------------- */

function readStts(view: DataView, box: Box): Array<{ count: number; delta: number }> {
  const { at } = full(view, box);
  const n = view.getUint32(at);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ count: view.getUint32(at + 4 + i * 8), delta: view.getUint32(at + 8 + i * 8) });
  }
  return out;
}

function readCtts(view: DataView, box: Box): Array<{ count: number; offset: number }> {
  const { version, at } = full(view, box);
  const n = view.getUint32(at);
  const out = [];
  for (let i = 0; i < n; i++) {
    const count = view.getUint32(at + 4 + i * 8);
    // Version 1 offsets are signed; QuickTime writes negative offsets in version 0 too, and
    // reading them signed is harmless when they are positive.
    const offset = version === 1 ? view.getInt32(at + 8 + i * 8) : view.getInt32(at + 8 + i * 8);
    out.push({ count, offset });
  }
  return out;
}

function readStss(view: DataView, box: Box): Set<number> {
  const { at } = full(view, box);
  const n = view.getUint32(at);
  const out = new Set<number>();
  for (let i = 0; i < n; i++) out.add(view.getUint32(at + 4 + i * 4));
  return out;
}

function readStsc(view: DataView, box: Box): Array<{ firstChunk: number; perChunk: number }> {
  const { at } = full(view, box);
  const n = view.getUint32(at);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      firstChunk: view.getUint32(at + 4 + i * 12),
      perChunk: view.getUint32(at + 8 + i * 12),
    });
  }
  return out;
}

function readStsz(view: DataView, box: Box): { constant: number; sizes: Uint32Array | null; count: number } {
  const { at } = full(view, box);
  const constant = view.getUint32(at);
  const count = view.getUint32(at + 4);
  if (constant !== 0) return { constant, sizes: null, count };
  const sizes = new Uint32Array(count);
  for (let i = 0; i < count; i++) sizes[i] = view.getUint32(at + 8 + i * 4);
  return { constant, sizes, count };
}

function readChunkOffsets(view: DataView, box: Box): number[] {
  const { at } = full(view, box);
  const n = view.getUint32(at);
  const out: number[] = [];
  const wide = box.type === "co64";
  for (let i = 0; i < n; i++) {
    out.push(wide ? Number(view.getBigUint64(at + 4 + i * 8)) : view.getUint32(at + 4 + i * 4));
  }
  return out;
}

function readElst(view: DataView, box: Box): Array<{ segmentDuration: number; mediaTime: number }> {
  const { version, at } = full(view, box);
  const n = view.getUint32(at);
  const out = [];
  let p = at + 4;
  for (let i = 0; i < n; i++) {
    if (version === 1) {
      out.push({
        segmentDuration: Number(view.getBigUint64(p)),
        mediaTime: Number(view.getBigInt64(p + 8)),
      });
      p += 20;
    } else {
      out.push({ segmentDuration: view.getUint32(p), mediaTime: view.getInt32(p + 4) });
      p += 12;
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------
 * Codec strings — what `VideoDecoder.configure` wants to hear
 * ---------------------------------------------------------------------------------------- */

const hex2 = (b: number) => b.toString(16).toUpperCase().padStart(2, "0");

/** `avc1.PPCCLL` from the first three bytes after the avcC version byte. */
export function avcCodecString(avcC: Uint8Array): string {
  return `avc1.${hex2(avcC[1]!)}${hex2(avcC[2]!)}${hex2(avcC[3]!)}`;
}

/**
 * `hvc1.<profile>.<compat>.<tier><level>.<constraints>` (ISO 14496-15 Annex E), from the hvcC
 * record. The profile compatibility flags are written bit-reversed, the constraint bytes with
 * trailing zeros dropped — an iPhone's 1080p HEVC comes out as `hvc1.1.6.L123.B0`.
 */
export function hevcCodecString(hvcC: Uint8Array, boxType: "hvc1" | "hev1" = "hvc1"): string {
  const profileSpace = hvcC[1]! >> 6;
  const tier = (hvcC[1]! >> 5) & 1;
  const profileIdc = hvcC[1]! & 0x1f;
  const compat = ((hvcC[2]! << 24) | (hvcC[3]! << 16) | (hvcC[4]! << 8) | hvcC[5]!) >>> 0;
  let reversed = 0;
  for (let i = 0; i < 32; i++) reversed = ((reversed << 1) | ((compat >>> i) & 1)) >>> 0;
  const constraints = Array.from(hvcC.subarray(6, 12));
  while (constraints.length && constraints[constraints.length - 1] === 0) constraints.pop();
  const level = hvcC[12]!;
  const space = profileSpace === 0 ? "" : String.fromCharCode(64 + profileSpace);
  const parts = [
    boxType,
    `${space}${profileIdc}`,
    reversed.toString(16).toUpperCase(),
    `${tier ? "H" : "L"}${level}`,
    ...constraints.map((b) => b.toString(16).toUpperCase()),
  ];
  return parts.join(".");
}

/* ------------------------------------------------------------------------------------------
 * The movie
 * ---------------------------------------------------------------------------------------- */

/** Bytes to read per probe while walking the top-level boxes looking for `moov`. */
const HEADER_PROBE = 16;
/** An index bigger than this is not a phone video and is not worth holding in memory. */
const MAX_MOOV_BYTES = 64 * 1024 * 1024;

/**
 * Find the index without reading the footage: walk the top-level boxes by their sizes, skipping
 * over `mdat` however large it is.
 */
async function readMoov(src: ByteSource): Promise<{ bytes: Uint8Array; start: number }> {
  let at = 0;
  while (at + 8 <= src.size) {
    const head = await src.read(at, Math.min(HEADER_PROBE, src.size - at));
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let size = view.getUint32(0);
    const type = fourcc(view, 4);
    if (size === 1) size = Number(view.getBigUint64(8));
    else if (size === 0) size = src.size - at;
    if (size < 8) throw new Error(`Bad top-level box '${type}' at ${at}`);
    if (type === "moof") throw new Error("Fragmented MP4 is not supported");
    if (type === "moov") {
      if (size > MAX_MOOV_BYTES) throw new Error(`Index too large (${size} bytes)`);
      return { bytes: await src.read(at, size), start: at };
    }
    at += size;
  }
  throw new Error("No 'moov' box: not an MP4/MOV, or the file is still being written");
}

type TrackBoxes = {
  trak: Box;
  id: number;
  handler: string;
  mdTimescale: number;
  mdDuration: number;
};

function trackHeader(view: DataView, trak: Box): TrackBoxes | null {
  const tkhd = findPath(view, trak, ["tkhd"]);
  const mdhd = findPath(view, trak, ["mdia", "mdhd"]);
  const hdlr = findPath(view, trak, ["mdia", "hdlr"]);
  if (!tkhd || !mdhd || !hdlr) return null;
  const tk = full(view, tkhd);
  const id = tk.version === 1 ? view.getUint32(tk.at + 16) : view.getUint32(tk.at + 8);
  const md = full(view, mdhd);
  const mdTimescale = md.version === 1 ? view.getUint32(md.at + 16) : view.getUint32(md.at + 8);
  const mdDuration =
    md.version === 1 ? Number(view.getBigUint64(md.at + 20)) : view.getUint32(md.at + 12);
  const handler = fourcc(view, hdlr.body + 8);
  return { trak, id, handler, mdTimescale, mdDuration };
}

/** QuickTime and MP4 count seconds from 1904; Unix from 1970. */
const MAC_EPOCH_OFFSET_SEC = 2082844800;

/**
 * When the recording started, from the movie header — or null when the file does not say.
 *
 * A phone stamps `mvhd` with the moment recording began (an iPhone 14 Pro Max's IMG_4521 was
 * checked against four LiveRC session clocks: all within half a second). That one fact ties the
 * whole video to wall-clock time, which is what lets a practice session be placed on it with no
 * tap at all — see `wallClock.ts`. Anything that cannot be read comes back null rather than
 * throwing: a video without a date is still a video.
 */
export async function readRecordingStart(src: ByteSource): Promise<Date | null> {
  try {
    const { bytes } = await readMoov(src);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const moov = boxAt(view, 0, bytes.byteLength);
    if (!moov || moov.type !== "moov") return null;
    const mvhd = find(view, moov.body, moov.end, "mvhd");
    if (!mvhd) return null;
    const mv = full(view, mvhd);
    const created = mv.version === 1 ? Number(view.getBigUint64(mv.at)) : view.getUint32(mv.at);
    if (!created) return null;
    const unixSec = created - MAC_EPOCH_OFFSET_SEC;
    // Before 1990 or after 2100 is not a date a phone wrote; a zeroed or garbage field.
    if (unixSec < 631152000 || unixSec > 4102444800) return null;
    return new Date(unixSec * 1000);
  } catch {
    return null;
  }
}

/**
 * Read a file's index and describe its video track for WebCodecs.
 *
 * Throws on anything it does not understand; the caller's answer to that is the player.
 */
export async function parseMovie(src: ByteSource): Promise<MovieInfo> {
  const { bytes } = await readMoov(src);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const moov = boxAt(view, 0, bytes.byteLength);
  if (!moov || moov.type !== "moov") throw new Error("Index did not start with 'moov'");

  const mvhd = find(view, moov.body, moov.end, "mvhd");
  if (!mvhd) throw new Error("No movie header");
  const mv = full(view, mvhd);
  const movieTimescale = mv.version === 1 ? view.getUint32(mv.at + 16) : view.getUint32(mv.at + 8);

  // The video track with the most samples: a phone also writes audio, metadata and motion
  // tracks, and some players write a tiny preview track.
  let best: TrackBoxes | null = null;
  let bestCount = -1;
  for (const trak of children(view, moov.body, moov.end)) {
    if (trak.type !== "trak") continue;
    const t = trackHeader(view, trak);
    if (!t || t.handler !== "vide") continue;
    const stsz = findPath(view, trak, ["mdia", "minf", "stbl", "stsz"]);
    const count = stsz ? view.getUint32(full(view, stsz).at + 4) : 0;
    if (count > bestCount) {
      best = t;
      bestCount = count;
    }
  }
  if (!best) throw new Error("No video track");

  const stbl = findPath(view, best.trak, ["mdia", "minf", "stbl"]);
  if (!stbl) throw new Error("Video track has no sample table");
  const need = (type: string): Box => {
    const b = find(view, stbl.body, stbl.end, type);
    if (!b) throw new Error(`Video track has no '${type}'`);
    return b;
  };

  // --- codec ---------------------------------------------------------------------------------
  const stsd = need("stsd");
  const sd = full(view, stsd);
  const entry = boxAt(view, sd.at + 4, stsd.end);
  if (!entry) throw new Error("Empty sample description");
  const codedWidth = view.getUint16(entry.body + 24);
  const codedHeight = view.getUint16(entry.body + 26);
  let codec: string;
  let description: Uint8Array | null = null;
  const configBoxes = entry.body + 78;
  if (entry.type === "hvc1" || entry.type === "hev1") {
    const hvcC = find(view, configBoxes, entry.end, "hvcC");
    if (!hvcC) throw new Error("HEVC track has no hvcC");
    description = bytes.slice(hvcC.body, hvcC.end);
    codec = hevcCodecString(description, entry.type);
  } else if (entry.type === "avc1" || entry.type === "avc3") {
    const avcC = find(view, configBoxes, entry.end, "avcC");
    if (!avcC) throw new Error("H.264 track has no avcC");
    description = bytes.slice(avcC.body, avcC.end);
    codec = avcCodecString(description);
  } else {
    throw new Error(`Unsupported video codec '${entry.type}'`);
  }

  // --- sample tables ---------------------------------------------------------------------------
  const stts = readStts(view, need("stts"));
  const cttsBox = find(view, stbl.body, stbl.end, "ctts");
  const ctts = cttsBox ? readCtts(view, cttsBox) : [];
  const stssBox = find(view, stbl.body, stbl.end, "stss");
  const sync = stssBox ? readStss(view, stssBox) : null;
  const stsc = readStsc(view, need("stsc"));
  const stsz = readStsz(view, need("stsz"));
  const chunkBox = find(view, stbl.body, stbl.end, "stco") ?? find(view, stbl.body, stbl.end, "co64");
  if (!chunkBox) throw new Error("Video track has no chunk offsets");
  const chunkOffsets = readChunkOffsets(view, chunkBox);

  const count = stsz.count;
  const sizes = new Array<number>(count);
  for (let i = 0; i < count; i++) sizes[i] = stsz.sizes ? stsz.sizes[i]! : stsz.constant;

  // Where each sample sits: chunk by chunk, run by run.
  const offsets = new Array<number>(count);
  {
    let sample = 0;
    for (let run = 0; run < stsc.length && sample < count; run++) {
      const { firstChunk, perChunk } = stsc[run]!;
      const lastChunk = run + 1 < stsc.length ? stsc[run + 1]!.firstChunk - 1 : chunkOffsets.length;
      for (let chunk = firstChunk; chunk <= lastChunk && sample < count; chunk++) {
        let at = chunkOffsets[chunk - 1];
        if (at == null) throw new Error(`Chunk ${chunk} has no offset`);
        for (let k = 0; k < perChunk && sample < count; k++) {
          offsets[sample] = at;
          at += sizes[sample]!;
          sample++;
        }
      }
    }
    if (sample !== count) throw new Error(`Placed ${sample} of ${count} samples`);
  }

  // When each sample is decoded and shown.
  const dts = new Array<number>(count);
  const durations = new Array<number>(count);
  {
    let t = 0;
    let i = 0;
    for (const { count: n, delta } of stts) {
      for (let k = 0; k < n && i < count; k++, i++) {
        dts[i] = t;
        durations[i] = delta;
        t += delta;
      }
    }
    for (; i < count; i++) {
      dts[i] = t;
      durations[i] = 0;
    }
  }
  const cts = new Array<number>(count);
  {
    let i = 0;
    for (const { count: n, offset } of ctts) {
      for (let k = 0; k < n && i < count; k++, i++) cts[i] = dts[i]! + offset;
    }
    for (; i < count; i++) cts[i] = dts[i]!;
  }

  const samples: VideoSample[] = new Array(count);
  let decodeShift = 0;
  for (let i = 0; i < count; i++) {
    samples[i] = {
      offset: offsets[i]!,
      size: sizes[i]!,
      dts: dts[i]!,
      cts: cts[i]!,
      duration: durations[i]!,
      sync: sync ? sync.has(i + 1) : true,
    };
    decodeShift = Math.min(decodeShift, cts[i]! - dts[i]!);
  }

  // --- edit list -------------------------------------------------------------------------------
  // An empty edit delays the start; the first real edit says which media time is shown first.
  let presentationOffset = 0;
  const elst = findPath(view, best.trak, ["edts", "elst"]);
  if (elst) {
    let delayMediaTicks = 0;
    for (const e of readElst(view, elst)) {
      if (e.mediaTime < 0) {
        delayMediaTicks += (e.segmentDuration * best.mdTimescale) / movieTimescale;
        continue;
      }
      presentationOffset = e.mediaTime - delayMediaTicks;
      break;
    }
  }

  return {
    video: {
      id: best.id,
      codec,
      description,
      codedWidth,
      codedHeight,
      timescale: best.mdTimescale,
      durationSec: best.mdDuration / best.mdTimescale,
      samples,
      presentationOffset,
      decodeShift,
    },
    moovBytes: bytes.byteLength,
  };
}

/**
 * Which samples to decode to see every frame shown between `from` and `to`.
 *
 * Decoding can only start at a sync sample, so the run begins at the last one at or before the
 * first frame shown in the range. It ends at the first sample DECODED after `to`: a frame is
 * never decoded later than it is shown, so nothing shown inside the range can sit past that.
 */
export function samplesForRange(
  track: VideoTrack,
  from: number,
  to: number
): { first: number; end: number } {
  const s = track.samples;
  if (!s.length) return { first: 0, end: 0 };
  // The last sample shown at or before `from` — the frame on screen when the range opens.
  let first = 0;
  let firstT = -Infinity;
  for (let i = 0; i < s.length; i++) {
    const t = presentationSec(track, s[i]!);
    if (t <= from && t > firstT) {
      first = i;
      firstT = t;
    }
  }
  while (first > 0 && !s[first]!.sync) first--;
  let end = first;
  while (end < s.length && decodeSec(track, s[end]!) <= to) end++;
  return { first, end };
}
