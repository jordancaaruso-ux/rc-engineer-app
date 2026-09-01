/**
 * Cut a small picture out of the video at a given moment, around a given point.
 *
 * Everything else in this folder describes a crossing in numbers — "2.84s into the lap, agreed on
 * four laps". Numbers cannot answer "which of these is my car", and that is the one question the
 * detector genuinely cannot settle on its own when several cars run in company. A driver settles it
 * in one glance, so long as they are shown the moment rather than told about it.
 *
 * Browser only: it draws the video element to a canvas, which is also why the two traps below bite.
 */

const READ_FREQUENTLY = false;
const SEEK_TIMEOUT_MS = 15000;
/** How close a presented frame has to be to the moment asked for before it is the right frame. */
const FRAME_TOLERANCE_SEC = 0.08;
/** A seek can present several stale frames first; give up rather than wait forever. */
const MAX_STALE_FRAMES = 20;
/**
 * How long to wait for a frame callback before drawing anyway.
 *
 * On a PAUSED video the browser presents the frame the seek landed on once, and then nothing ever
 * again — so a callback registered a moment too late waits for a frame that will never come. With
 * no ceiling here the first picture never appears and the screen sits on "cutting the pictures"
 * forever, which is exactly what it did. `seeked` has already fired by this point, so drawing
 * without the confirmation is very likely right; waiting is only the belt to that braces.
 */
const FRAME_WAIT_MS = 350;

export type ThumbRequest = {
  /** Video time of the moment. */
  t: number;
  /** Where to centre the crop, in FRAME pixels. Omitted falls back to the middle of the frame. */
  x?: number;
  y?: number;
};

export type ThumbOptions = {
  /**
   * Half-width of the crop as a FRACTION of frame width.
   *
   * Never pixels. The same footage is 3840 wide on the desktop lane and 1280 on a proxy, and a
   * fixed pixel box turns one of them into a picture of empty tarmac — which is what the first
   * version did. A tenth-scale car is a few dozen pixels at 4K, so the box has to be small
   * relative to the frame or the car is a speck in the middle of a car park.
   */
  halfFrac?: number;
  /** Longest edge of the returned picture. */
  outPx?: number;
  /** Ring the exact point the crossing was detected at. */
  mark?: boolean;
  signal?: AbortSignal;
};

class Aborted extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

export function isGrabAborted(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

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
    }, 150);
    timer = window.setTimeout(
      () => done(new Error(`The video did not respond to a seek to ${t.toFixed(1)}s.`)),
      SEEK_TIMEOUT_MS
    );
    video.currentTime = t;
  });
}

type RvfcVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * Wait until the picture on screen really is the moment asked for.
 *
 * `seeked` fires when the browser has *decided* where to be, not when it has painted it, and the
 * first frame delivered afterwards routinely carries the PREVIOUS position's timestamp. Grabbing
 * on `seeked` alone therefore yields a picture of somewhere else entirely — which, for a tool whose
 * whole job is "is this your car", would be worse than showing nothing.
 */
function awaitFrameAt(video: RvfcVideo, t: number, signal?: AbortSignal): Promise<void> {
  if (typeof video.requestVideoFrameCallback !== "function") return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    let stale = 0;
    let handle = 0;
    let timer = 0;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      window.clearTimeout(timer);
      if (handle && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(handle);
      if (err) reject(err);
      else resolve();
    };
    timer = window.setTimeout(() => finish(), FRAME_WAIT_MS);
    const onAbort = () => finish(new Aborted());
    signal?.addEventListener("abort", onAbort);
    const tick = (_now: number, meta: { mediaTime: number }) => {
      if (settled) return;
      if (Math.abs(meta.mediaTime - t) <= FRAME_TOLERANCE_SEC || ++stale > MAX_STALE_FRAMES) {
        finish();
        return;
      }
      handle = video.requestVideoFrameCallback!(tick);
    };
    handle = video.requestVideoFrameCallback!(tick);
  });
}

/**
 * One picture per moment, in the order asked for.
 *
 * Seeking dominates the cost — roughly a fifth of a second each — so this is for tens of pictures,
 * not thousands. Requests are seeked in time order internally to keep the decoder moving forwards
 * where it can, and the results are put back in the caller's order.
 */
export async function grabThumbnails(
  video: HTMLVideoElement,
  requests: ThumbRequest[],
  opts: ThumbOptions = {}
): Promise<Array<string | null>> {
  const { halfFrac = 0.035, outPx = 200, mark = true, signal } = opts;
  const w = video.videoWidth;
  const h = video.videoHeight;
  const out: Array<string | null> = requests.map(() => null);
  if (!w || !h || requests.length === 0) return out;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: READ_FREQUENTLY });
  if (!ctx) return out;

  const wasPaused = video.paused;
  const returnTo = video.currentTime;
  video.pause();

  const order = requests.map((r, i) => ({ r, i })).sort((a, b) => a.r.t - b.r.t);
  try {
    for (const { r, i } of order) {
      if (signal?.aborted) throw new Aborted();
      await seekTo(video, r.t, signal);
      await awaitFrameAt(video as RvfcVideo, r.t, signal);

      const cx = r.x ?? w / 2;
      const cy = r.y ?? h / 2;
      const half = Math.max(24, Math.min(w * halfFrac, w / 2, h / 2));
      // Clamp the box rather than the centre, so a car near an edge still gets a full-size
      // picture instead of a sliver — the crop slides, it does not shrink.
      const side = Math.min(half * 2, w, h);
      const sx = Math.max(0, Math.min(w - side, cx - half));
      const sy = Math.max(0, Math.min(h - side, cy - half));

      canvas.width = outPx;
      canvas.height = outPx;
      ctx.drawImage(video, sx, sy, side, side, 0, 0, outPx, outPx);

      if (mark) {
        // A tenth-scale car on a wide shot is small even cropped tight, and several cars can share
        // one crop. Without a mark the driver is guessing which speck the picture is about, which
        // is the same guess this screen exists to remove.
        const scale = outPx / side;
        const mx = (cx - sx) * scale;
        const my = (cy - sy) * scale;
        const r0 = Math.max(9, outPx * 0.07);
        ctx.lineWidth = Math.max(2, outPx * 0.012);
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        ctx.beginPath();
        ctx.arc(mx, my, r0 + ctx.lineWidth, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "rgba(255,214,0,0.95)";
        ctx.beginPath();
        ctx.arc(mx, my, r0, 0, Math.PI * 2);
        ctx.stroke();
      }
      out[i] = canvas.toDataURL("image/jpeg", 0.8);
    }
  } finally {
    try {
      await seekTo(video, returnTo);
      if (!wasPaused) void video.play().catch(() => {});
    } catch {
      // Putting the playhead back is a courtesy, never a reason to lose the pictures.
    }
  }
  return out;
}
