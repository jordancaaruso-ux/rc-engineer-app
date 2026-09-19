/**
 * Where the scan gets its frames.
 *
 * Two ways to read a stretch of video in a browser, behind one interface:
 *
 *   - **Decoded** — the file's index is read (`mp4.ts`), the compressed frames for the stretch
 *     are sliced straight out of the file and pushed through a `VideoDecoder`. Every frame
 *     arrives, in order, with its timestamp, as fast as the decoder runs — several times real
 *     time on a phone. This is the reader when the browser and the file allow it.
 *   - **Playback** — the video element is seeked and played, and every frame the browser
 *     PAINTS is read off a canvas. Pinned to real time, and a busy tab or a slow machine simply
 *     skips frames with no error anywhere: at Bendigo (2026-09-02) a four-pixel car on a far
 *     line was on the line for two frames, the browser painted neither, and the scan reported
 *     the rival's car as the only thing in the window. Kept as the fallback, because it needs
 *     nothing but a video element.
 *
 * The detector reads pixel crops and never knows which one it got.
 */

import { parseMovie, presentationSec, samplesForRange, type MovieInfo, type VideoTrack } from "./mp4";

export class Aborted extends Error {
  constructor() {
    super("Scan cancelled");
    this.name = "Aborted";
  }
}

export function isAborted(e: unknown): boolean {
  return e instanceof Error && e.name === "Aborted";
}

export function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new Aborted();
}

/** Anything a 2D canvas can draw a frame from. */
export type FrameImage = HTMLVideoElement | VideoFrame;

export type FrameSink = (image: FrameImage, t: number) => void;

export type RangeReport = {
  frames: number;
  /** Typical gap between consecutive frames, in video time. Infinity when nothing arrived. */
  medianGapMs: number;
  /** Frames came too sparsely for the timing to mean anything. Never true for a decoded read. */
  starved: boolean;
};

export type FrameSourceKind = "decoded" | "playback";

export interface FrameSource {
  readonly kind: FrameSourceKind;
  /** One line for the log. */
  readonly label: string;
  /**
   * Hand every frame shown between `from` and `to` to `onFrame`, in order. `rate` is the
   * playback speed and only means anything to the playback reader.
   */
  readRange(from: number, to: number, rate: number, onFrame: FrameSink, signal?: AbortSignal): Promise<RangeReport>;
  close(): Promise<void>;
}

/**
 * Frames must arrive at least this often IN VIDEO TIME. The browser only hands over frames it
 * actually presents, and a tab that loses focus or falls behind presents far fewer — one run of
 * the playback scan collected 1332 frames where an identical run collected 2198, with no error
 * anywhere. Below this rate the sub-frame interpolation is meaningless, so the stretch is
 * reported as not found rather than answered badly. A gap is honest; a wrong mark is not.
 */
export const STARVED_MEDIA_GAP_MS = 100;
/** A seek that never lands — Safari can swallow one on an element that has never played. */
const SEEK_TIMEOUT_MS = 20000;
/** How far before the range a frame may sit and still count as part of it. */
const PRE_ROLL_TOLERANCE_SEC = 0.05;
/** Frames left over from before the seek that may be skipped before giving up on the range. */
const MAX_STALE_FRAMES = 30;

function medianOf(xs: number[]): number {
  if (!xs.length) return Infinity;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/* ------------------------------------------------------------------------------------------
 * Playback
 * ---------------------------------------------------------------------------------------- */

/**
 * Seek and wait for it to land.
 *
 * Belt and braces on purpose: Safari can complete a seek on a never-played element without ever
 * firing `seeked`, so the position is polled too, and the whole thing gives up rather than
 * hanging the button forever.
 */
function seekTo(video: HTMLVideoElement, t: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let poll = 0;
    let timer = 0;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", onSeeked);
      signal?.removeEventListener("abort", onAbort);
      window.clearInterval(poll);
      window.clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const onSeeked = () => done();
    const onAbort = () => done(new Aborted());
    video.addEventListener("seeked", onSeeked);
    signal?.addEventListener("abort", onAbort);
    poll = window.setInterval(() => {
      if (!video.seeking && Math.abs(video.currentTime - t) < 0.5 && video.readyState >= 2) done();
    }, 200);
    timer = window.setTimeout(
      () => done(new Error(`The video did not respond to a seek to ${t.toFixed(1)}s.`)),
      SEEK_TIMEOUT_MS
    );
    video.currentTime = t;
  });
}

/**
 * Play from `from` to `to`, handing over every frame the browser presents in between.
 *
 * `from` matters as much as `to`. A seek does not clear what is already on screen, so the first
 * callback after one routinely delivers the frame that was showing BEFORE it — and when the
 * previous stretch was later in the video, that stale frame is already past `to`, which used to
 * end the pass before it had read anything. So frames outside the range are skipped until one
 * lands inside it.
 */
function playRange(
  video: HTMLVideoElement,
  from: number,
  to: number,
  rate: number,
  onFrame: (mediaTime: number) => void,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let handle = 0;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      video.removeEventListener("ended", onEnded);
      if (handle && "cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(handle);
      video.pause();
      if (err) reject(err);
      else resolve();
    };
    const onAbort = () => done(new Aborted());
    const onEnded = () => done();
    signal?.addEventListener("abort", onAbort);
    video.addEventListener("ended", onEnded);

    if (!("requestVideoFrameCallback" in video)) {
      done(new Error("This browser cannot hand over video frames — try Chrome or Edge."));
      return;
    }

    let entered = false;
    let skipped = 0;
    const tick: VideoFrameRequestCallback = (_now, meta) => {
      if (settled) return;
      const t = meta.mediaTime;
      if (!entered) {
        if (t < from - PRE_ROLL_TOLERANCE_SEC || t > to) {
          if (++skipped > MAX_STALE_FRAMES) {
            done();
            return;
          }
          handle = video.requestVideoFrameCallback(tick);
          return;
        }
        entered = true;
      }
      if (t > to) {
        done();
        return;
      }
      try {
        onFrame(t);
      } catch (e) {
        done(e as Error);
        return;
      }
      handle = video.requestVideoFrameCallback(tick);
    };

    video.playbackRate = rate;
    handle = video.requestVideoFrameCallback(tick);
    video.play().catch((e: Error) => done(e));
  });
}

export class PlaybackSource implements FrameSource {
  readonly kind = "playback" as const;
  readonly label = "playing the video";
  private readonly wasMuted: boolean;
  private readonly wasRate: number;
  private readonly wasTime: number;

  private constructor(private readonly video: HTMLVideoElement) {
    this.wasMuted = video.muted;
    this.wasRate = video.playbackRate;
    this.wasTime = video.currentTime;
  }

  static async open(video: HTMLVideoElement): Promise<PlaybackSource> {
    const src = new PlaybackSource(video);
    video.muted = true;
    // A never-played element can swallow the first seek outright; one muted play/pause wakes
    // the decode pipeline before anything is timed against it.
    try {
      await video.play();
      video.pause();
    } catch {
      /* autoplay policy — the seeks below usually still work */
    }
    return src;
  }

  async readRange(
    from: number,
    to: number,
    rate: number,
    onFrame: FrameSink,
    signal?: AbortSignal
  ): Promise<RangeReport> {
    const gaps: number[] = [];
    let last: number | null = null;
    let frames = 0;
    await seekTo(this.video, from, signal);
    await playRange(
      this.video,
      from,
      to,
      rate,
      (t) => {
        frames++;
        if (last != null && t > last) gaps.push((t - last) * 1000);
        last = t;
        onFrame(this.video, t);
      },
      signal
    );
    const medianGapMs = medianOf(gaps);
    return { frames, medianGapMs, starved: medianGapMs > STARVED_MEDIA_GAP_MS };
  }

  async close(): Promise<void> {
    this.video.pause();
    this.video.playbackRate = this.wasRate;
    this.video.muted = this.wasMuted;
    try {
      this.video.currentTime = this.wasTime;
    } catch {
      /* a detached element */
    }
  }
}

/* ------------------------------------------------------------------------------------------
 * Decoded
 * ---------------------------------------------------------------------------------------- */

/** Compressed frames queued in the decoder before feeding pauses for it to catch up. */
const MAX_DECODE_QUEUE = 24;
/** Frames wanted a little before the range so the first one inside it has a predecessor. */
const DECODE_PRE_ROLL_SEC = 0.05;
/** One read of the file at a time, so a 20-second stretch of 4K is a handful of slices. */
const MAX_SLICE_BYTES = 32 * 1024 * 1024;

/** A picked file as random-access bytes, for the index reader. */
export function blobSource(file: Blob) {
  return {
    size: file.size,
    async read(offset: number, length: number): Promise<Uint8Array> {
      const buf = await file.slice(offset, offset + length).arrayBuffer();
      return new Uint8Array(buf);
    },
  };
}

export class DecodedSource implements FrameSource {
  readonly kind = "decoded" as const;
  readonly label: string;
  private decoder: VideoDecoder | null = null;
  /** The sink for the range being read — the decoder's output callback is fixed at creation. */
  private sink: ((frame: VideoFrame) => void) | null = null;
  private failure: Error | null = null;

  private constructor(
    private readonly file: Blob,
    readonly track: VideoTrack,
    private readonly config: VideoDecoderConfig
  ) {
    this.label = `decoding the file (${track.codec}, ${track.samples.length} frames)`;
  }

  /**
   * Read the file's index and check the browser can decode its codec. Returns null — never
   * throws — when it cannot, so the caller falls back to playback.
   */
  static async open(file: Blob): Promise<DecodedSource | null> {
    if (typeof VideoDecoder === "undefined" || typeof EncodedVideoChunk === "undefined") return null;
    let movie: MovieInfo;
    try {
      movie = await parseMovie(blobSource(file));
    } catch (e) {
      console.debug(`[frames] cannot index the file: ${(e as Error).message}`);
      return null;
    }
    const track = movie.video;
    const base: VideoDecoderConfig = {
      codec: track.codec,
      codedWidth: track.codedWidth,
      codedHeight: track.codedHeight,
      ...(track.description ? { description: track.description } : {}),
    };
    for (const hardwareAcceleration of ["prefer-hardware", "no-preference"] as const) {
      const config: VideoDecoderConfig = { ...base, hardwareAcceleration };
      try {
        const support = await VideoDecoder.isConfigSupported(config);
        if (support.supported) return new DecodedSource(file, track, config);
      } catch {
        /* an unknown codec string throws rather than answering */
      }
    }
    console.debug(`[frames] browser cannot decode ${track.codec} directly`);
    return null;
  }

  private ensureDecoder(): VideoDecoder {
    if (this.decoder && this.decoder.state !== "closed") return this.decoder;
    this.failure = null;
    const decoder = new VideoDecoder({
      output: (frame) => {
        try {
          this.sink?.(frame);
        } finally {
          frame.close();
        }
      },
      error: (e) => {
        this.failure = e instanceof Error ? e : new Error(String(e));
      },
    });
    decoder.configure(this.config);
    this.decoder = decoder;
    return decoder;
  }

  async readRange(
    from: number,
    to: number,
    _rate: number,
    onFrame: FrameSink,
    signal?: AbortSignal
  ): Promise<RangeReport> {
    checkAbort(signal);
    const { track } = this;
    const { first, end } = samplesForRange(track, from - DECODE_PRE_ROLL_SEC, to);
    if (end <= first) return { frames: 0, medianGapMs: Infinity, starved: false };

    const gaps: number[] = [];
    let last: number | null = null;
    let frames = 0;
    let sinkError: Error | null = null;
    this.sink = (frame) => {
      if (sinkError) return;
      const t = frame.timestamp / 1e6;
      if (t < from - PRE_ROLL_TOLERANCE_SEC || t > to) return;
      frames++;
      if (last != null && t > last) gaps.push((t - last) * 1000);
      last = t;
      try {
        onFrame(frame, t);
      } catch (e) {
        sinkError = e as Error;
      }
    };

    const decoder = this.ensureDecoder();
    try {
      // The compressed frames, sliced out of the file in as few reads as the layout allows:
      // consecutive samples usually sit back to back.
      let i = first;
      while (i < end) {
        checkAbort(signal);
        const startOffset = track.samples[i]!.offset;
        let j = i;
        let endOffset = startOffset;
        while (
          j < end &&
          track.samples[j]!.offset === endOffset &&
          endOffset + track.samples[j]!.size - startOffset <= MAX_SLICE_BYTES
        ) {
          endOffset += track.samples[j]!.size;
          j++;
        }
        if (j === i) {
          // Not contiguous with the previous one: take this sample alone.
          endOffset = startOffset + track.samples[i]!.size;
          j = i + 1;
        }
        const bytes = await this.file.slice(startOffset, endOffset).arrayBuffer();
        for (let k = i; k < j; k++) {
          checkAbort(signal);
          if (this.failure) throw this.failure;
          if (sinkError) throw sinkError;
          const s = track.samples[k]!;
          const data = new Uint8Array(bytes, s.offset - startOffset, s.size);
          decoder.decode(
            new EncodedVideoChunk({
              type: s.sync ? "key" : "delta",
              timestamp: Math.round(presentationSec(track, s) * 1e6),
              duration: Math.round((s.duration / track.timescale) * 1e6),
              data,
            })
          );
          if (decoder.decodeQueueSize > MAX_DECODE_QUEUE) await this.drain(decoder, signal);
        }
        i = j;
      }
      await decoder.flush();
      if (this.failure) throw this.failure;
      if (sinkError) throw sinkError;
    } finally {
      this.sink = null;
    }
    return { frames, medianGapMs: medianOf(gaps), starved: false };
  }

  /** Wait for the decoder to work through its queue, or for a cancel. */
  private drain(decoder: VideoDecoder, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const tidy = () => {
        decoder.removeEventListener("dequeue", onDequeue);
        signal?.removeEventListener("abort", onAbort);
      };
      const onDequeue = () => {
        if (decoder.decodeQueueSize <= MAX_DECODE_QUEUE / 2) {
          tidy();
          resolve();
        }
      };
      const onAbort = () => {
        tidy();
        reject(new Aborted());
      };
      decoder.addEventListener("dequeue", onDequeue);
      signal?.addEventListener("abort", onAbort);
      onDequeue();
    });
  }

  async close(): Promise<void> {
    const d = this.decoder;
    this.decoder = null;
    this.sink = null;
    if (d && d.state !== "closed") d.close();
  }
}

/**
 * A support knob: `localStorage.rc_frame_reader = "playback"` forces the player, so the old
 * path can be compared on the same footage, or used when a decoder misbehaves. Never set by
 * the app itself.
 */
function playbackForced(): boolean {
  try {
    return window.localStorage.getItem("rc_frame_reader") === "playback";
  } catch {
    return false;
  }
}

/**
 * The best reader available: the file decoded directly when there is a file and the browser
 * can decode its codec, the player otherwise.
 */
export async function openFrameSource(
  video: HTMLVideoElement,
  file: Blob | null | undefined
): Promise<FrameSource> {
  if (file && !playbackForced()) {
    const decoded = await DecodedSource.open(file);
    if (decoded) {
      console.debug(`[frames] ${decoded.label}`);
      return decoded;
    }
  }
  const playback = await PlaybackSource.open(video);
  console.debug(`[frames] ${playback.label}`);
  return playback;
}
