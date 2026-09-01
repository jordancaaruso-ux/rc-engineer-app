/**
 * Why a video element is showing black.
 *
 * Measured 2026-08-25 against the real failing file (IMG_4044.MOV — hvc1 HEVC
 * Main 10, HLG HDR, 4K) in Chrome with hardware video decode disabled:
 *
 *   metadata: ok · seeks: succeed · readyState: 4 · error: NONE · size: 0x0
 *
 * Chrome ships no software HEVC decoder — HEVC relies entirely on the platform's
 * hardware decoder. Switch hardware acceleration off and every iPhone video
 * loses its decoder. When the file also carries an audio track (all camera
 * footage does), the container still opens on audio alone: duration is known,
 * the scrubber scales, seeks complete, `readyState` reaches HAVE_ENOUGH_DATA and
 * **no `error` is ever set** — while the video track is silently dropped.
 *
 * So `onError` cannot catch this. The tell is `videoWidth === 0` once metadata
 * has loaded: a file that opened but has no decodable picture.
 */

export type VideoPlaybackDiagnosis = {
  /** One line, written for a driver rather than an engineer. */
  message: string;
  /** True when the browser could play this given a settings change. */
  fixable: boolean;
};

function isChromeNotEdge(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Chrome\//.test(ua) && !/Edg\//.test(ua);
}

/**
 * Call once metadata has loaded. Returns null when the picture is fine.
 * `video.videoWidth === 0` after `loadedmetadata` means the container opened
 * but no video track could be decoded.
 */
export function diagnoseMissingPicture(video: HTMLVideoElement): VideoPlaybackDiagnosis | null {
  if (video.videoWidth > 0) return null;

  const hevcPlayable = video.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== "";
  if (!hevcPlayable) {
    return {
      message: isChromeNotEdge()
        ? "This is iPhone (HEVC) video, and Chrome can only play it with graphics acceleration switched on. Go to Chrome Settings → System → turn on “Use graphics acceleration when available”, then restart Chrome. Microsoft Edge plays it as-is."
        : "This browser can't decode iPhone (HEVC) video. Try Microsoft Edge, or convert the file to H.264 MP4.",
      fixable: true,
    };
  }

  return {
    message:
      "This video opened but its picture can't be decoded here. Try Microsoft Edge, or convert the file to H.264 MP4.",
    fixable: false,
  };
}

/** For a `<video>` that raised a real `error` event. */
export function describeVideoError(video: HTMLVideoElement): string {
  const code = video.error?.code;
  if (code === 4) {
    return isChromeNotEdge()
      ? "This browser can't play this video file. If it came off an iPhone, turn on “Use graphics acceleration when available” in Chrome Settings → System and restart Chrome — or open the app in Microsoft Edge."
      : "This browser can't play this video file. Try Microsoft Edge, or convert it to H.264 MP4.";
  }
  if (code === 2) return "Reading the video failed part-way through.";
  if (code === 3) return "This video's picture data could not be decoded.";
  return "This video could not be opened.";
}
