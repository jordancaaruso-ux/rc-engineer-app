/**
 * The 2026-07 session, as a fixed yardstick for the browser decode lane.
 *
 * `expected` is what the validated offline run detected for the same target (ffmpeg decode,
 * per-line calibration, tracking, lap chaining) — median 1.7ms from the July Python probe and
 * within 100ms of all 15 of Jordan's hand marks. Anything the browser produces is compared
 * against it, so this page answers one question: does reading frames through a canvas cost
 * accuracy? Brightness comes off the decoder's own luma plane offline and has to be recovered
 * from RGB here, and that is the part that could differ.
 */

export type FixtureTarget = {
  id: string;
  lineKey: string;
  lapNumber: number;
  centerSec: number;
  /** Offline answer, or null where the offline run found nothing. */
  expected: number | null;
};

export const FIXTURE_VIDEO = "IMG_4044.MOV";

export const FIXTURE_LINES = [
  {
    "lineKey": "sf",
    "label": "Start / Finish",
    "sortOrder": 0,
    "x1": 0.6150518868772543,
    "y1": 0.6157247681931228,
    "x2": 0.7145328795084473,
    "y2": 0.8479431926722895
  },
  {
    "lineKey": "s1",
    "label": "S1",
    "sortOrder": 1,
    "x1": 0.3355984978699338,
    "y1": 0.523702478463812,
    "x2": 0.3191753949973718,
    "y2": 0.5049331471444276
  },
  {
    "lineKey": "s2",
    "label": "S2",
    "sortOrder": 2,
    "x1": 0.3512260581884138,
    "y1": 0.5779577341046713,
    "x2": 0.4322057959690346,
    "y2": 0.6190903607536765
  },
  {
    "lineKey": "s3",
    "label": "S3",
    "sortOrder": 3,
    "x1": 0.5170847614358351,
    "y1": 0.496347605563365,
    "x2": 0.5616349068708345,
    "y2": 0.4859669827259948
  },
  {
    "lineKey": "s4",
    "label": "S4",
    "sortOrder": 4,
    "x1": 0.6598183216816115,
    "y1": 0.4571319192888553,
    "x2": 0.6645761334224256,
    "y2": 0.4713571937851427
  },
  {
    "lineKey": "s5",
    "label": "S5",
    "sortOrder": 5,
    "x1": 0.8196366829621554,
    "y1": 0.5359477358843353,
    "x2": 0.7945501256355332,
    "y2": 0.5205690588505623
  }
];

export const FIXTURE_TARGETS: FixtureTarget[] = [
  {
    "id": "s1-L1",
    "lineKey": "s1",
    "lapNumber": 1,
    "centerSec": 378.6437,
    "expected": 380.6627
  },
  {
    "id": "s2-L1",
    "lineKey": "s2",
    "lapNumber": 1,
    "centerSec": 380.7677,
    "expected": 382.6798
  },
  {
    "id": "s3-L1",
    "lineKey": "s3",
    "lapNumber": 1,
    "centerSec": 383.9582,
    "expected": 385.8552
  },
  {
    "id": "s4-L1",
    "lineKey": "s4",
    "lapNumber": 1,
    "centerSec": 370.7585,
    "expected": 372.9438
  },
  {
    "id": "s5-L1",
    "lineKey": "s5",
    "lapNumber": 1,
    "centerSec": 372.6203,
    "expected": 374.8498
  },
  {
    "id": "s1-L2",
    "lineKey": "s1",
    "lapNumber": 2,
    "centerSec": 397.1237,
    "expected": 396.3971
  },
  {
    "id": "s2-L2",
    "lineKey": "s2",
    "lapNumber": 2,
    "centerSec": 399.2477,
    "expected": 398.3846
  },
  {
    "id": "s3-L2",
    "lineKey": "s3",
    "lapNumber": 2,
    "centerSec": 402.4382,
    "expected": 401.4316
  },
  {
    "id": "s4-L2",
    "lineKey": "s4",
    "lapNumber": 2,
    "centerSec": 389.2385,
    "expected": 388.9245
  },
  {
    "id": "s5-L2",
    "lineKey": "s5",
    "lapNumber": 2,
    "centerSec": 391.1003,
    "expected": 390.7018
  },
  {
    "id": "s1-L3",
    "lineKey": "s1",
    "lapNumber": 3,
    "centerSec": 412.9357,
    "expected": 412.0166
  },
  {
    "id": "s2-L3",
    "lineKey": "s2",
    "lapNumber": 3,
    "centerSec": 415.0597,
    "expected": 414.545
  },
  {
    "id": "s3-L3",
    "lineKey": "s3",
    "lapNumber": 3,
    "centerSec": 418.2502,
    "expected": 417.6988
  },
  {
    "id": "s4-L3",
    "lineKey": "s4",
    "lapNumber": 3,
    "centerSec": 405.0505,
    "expected": 404.5018
  },
  {
    "id": "s5-L3",
    "lineKey": "s5",
    "lapNumber": 3,
    "centerSec": 406.9123,
    "expected": 406.2196
  },
  {
    "id": "s1-L9",
    "lineKey": "s1",
    "lapNumber": 9,
    "centerSec": 517.6097,
    "expected": 517.3641
  },
  {
    "id": "s2-L9",
    "lineKey": "s2",
    "lapNumber": 9,
    "centerSec": 519.7337,
    "expected": 519.469
  },
  {
    "id": "s3-L9",
    "lineKey": "s3",
    "lapNumber": 9,
    "centerSec": 522.9242,
    "expected": 522.5401
  },
  {
    "id": "s4-L9",
    "lineKey": "s4",
    "lapNumber": 9,
    "centerSec": 509.7245,
    "expected": 509.5662
  },
  {
    "id": "s5-L9",
    "lineKey": "s5",
    "lapNumber": 9,
    "centerSec": 511.5863,
    "expected": 511.2952
  },
  {
    "id": "s1-L10",
    "lineKey": "s1",
    "lapNumber": 10,
    "centerSec": 533.7967,
    "expected": 533.3748
  },
  {
    "id": "s2-L10",
    "lineKey": "s2",
    "lapNumber": 10,
    "centerSec": 535.9207,
    "expected": 535.4031
  },
  {
    "id": "s3-L10",
    "lineKey": "s3",
    "lapNumber": 10,
    "centerSec": 539.1112,
    "expected": 538.4953
  },
  {
    "id": "s4-L10",
    "lineKey": "s4",
    "lapNumber": 10,
    "centerSec": 525.9115,
    "expected": 525.7027
  },
  {
    "id": "s5-L10",
    "lineKey": "s5",
    "lapNumber": 10,
    "centerSec": 527.7733,
    "expected": 527.4543
  }
];

/** Lap starts, from the offline run. These anchor the second pass, exactly as the transponder
 * lap list anchors it in the app — the chain may start from them but can never move them. */
export const FIXTURE_LAP_STARTS = [
  {
    "lapNumber": 1,
    "videoTimeSec": 360.0587
  },
  {
    "lapNumber": 2,
    "videoTimeSec": 378.547
  },
  {
    "lapNumber": 3,
    "videoTimeSec": 394.3583
  },
  {
    "lapNumber": 9,
    "videoTimeSec": 499.0336
  },
  {
    "lapNumber": 10,
    "videoTimeSec": 515.2181
  }
];
