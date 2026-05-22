"""CLI entry point."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from rc_video_analysis.align import compute_alignment
from rc_video_analysis.analyze import analyze_video, load_config, write_results
from rc_video_analysis.validate import load_transponder_csv, validate_results


def cmd_analyze(args: argparse.Namespace) -> int:
    config = load_config(Path(args.config))
    if args.max_frames:
        config = {**config, "max_frames": args.max_frames}
    result = analyze_video(
        Path(args.video),
        config,
        sample_every_n=args.sample_every,
        max_frames=args.max_frames,
        prefer_yolo=not args.motion_only,
    )
    out = Path(args.output)
    write_results(result, out)
    print(f"Wrote {out} ({len(result.get('tracks', []))} tracks)")
    return 0


def cmd_align(args: argparse.Namespace) -> int:
    import cv2

    ref = cv2.imread(args.reference)
    cap = cv2.VideoCapture(args.video)
    ret, frame = cap.read()
    cap.release()
    if ref is None or not ret:
        print("Failed to load reference or video frame", file=sys.stderr)
        return 1
    meta = compute_alignment(ref, frame)
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(json.dumps(meta, indent=2))
    return 0 if meta.get("ok") else 2


def cmd_validate(args: argparse.Namespace) -> int:
    with Path(args.results).open(encoding="utf-8") as f:
        results = json.load(f)
    laps = load_transponder_csv(Path(args.transponder))
    report = validate_results(
        results,
        laps,
        mot_track_id=args.mot_track_id,
    )
    out = Path(args.output) if args.output else None
    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))
    return 0 if report.get("passesGate0_15") or report.get("ok") else 2


def main() -> None:
    parser = argparse.ArgumentParser(prog="rc-video-analysis")
    sub = parser.add_subparsers(dest="command", required=True)

    p_analyze = sub.add_parser("analyze", help="Detect, track, sector crossings")
    p_analyze.add_argument("--video", required=True)
    p_analyze.add_argument("--config", required=True)
    p_analyze.add_argument("--output", required=True)
    p_analyze.add_argument("--sample-every", type=int, default=2)
    p_analyze.add_argument("--max-frames", type=int, default=None)
    p_analyze.add_argument("--motion-only", action="store_true")
    p_analyze.set_defaults(func=cmd_analyze)

    p_align = sub.add_parser("align", help="Compute homography vs reference still")
    p_align.add_argument("--reference", required=True)
    p_align.add_argument("--video", required=True)
    p_align.add_argument("--output", required=True)
    p_align.set_defaults(func=cmd_align)

    p_val = sub.add_parser("validate", help="Compare laps to transponder CSV")
    p_val.add_argument("--results", required=True)
    p_val.add_argument("--transponder", required=True)
    p_val.add_argument("--output", default=None)
    p_val.add_argument("--mot-track-id", type=int, default=None)
    p_val.set_defaults(func=cmd_validate)

    args = parser.parse_args()
    raise SystemExit(args.func(args))


if __name__ == "__main__":
    main()
