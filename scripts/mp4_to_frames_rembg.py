"""Extract frames from MP4 and remove background with rembg (AI).

Usage:
    python scripts/mp4_to_frames_rembg.py <input.mp4> <output_dir> [--fps 12] [--max-width 480]
"""

import argparse
import subprocess
import sys
import json
from pathlib import Path
from PIL import Image
from rembg import remove, new_session

FFMPEG = Path(__file__).resolve().parent.parent / "tools" / "ffmpeg.exe"
if not FFMPEG.exists():
    FFMPEG = "ffmpeg"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output_dir")
    ap.add_argument("--fps", type=float, default=12, help="output frame rate (default 12)")
    ap.add_argument("--max-width", type=int, default=480, help="max width in pixels (default 480)")
    args = ap.parse_args()

    inp = Path(args.input)
    out_dir = Path(args.output_dir)
    raw_dir = out_dir / "_raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Step 1: extract raw frames with ffmpeg
    print(f"[1/2] Extracting frames at {args.fps} fps, max width {args.max_width}px ...")
    vf = f"fps={args.fps},scale='min({args.max_width},iw)':-2:flags=lanczos"
    pattern = str(raw_dir / "frame_%04d.png")
    result = subprocess.run(
        [str(FFMPEG), "-y", "-i", str(inp), "-vf", vf, "-vsync", "cfr", pattern],
        capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if result.returncode != 0 and not list(raw_dir.glob("frame_*.png")):
        print(result.stderr, file=sys.stderr)
        sys.exit(1)

    raw_frames = sorted(raw_dir.glob("frame_*.png"))
    total = len(raw_frames)
    print(f"    Extracted {total} frames.")

    # Step 2: rembg each frame
    print(f"[2/2] Removing background from {total} frames (this may take a few minutes)...")
    session = new_session("u2net")  # reuse session for speed

    for i, f in enumerate(raw_frames, 1):
        out_path = out_dir / f.name
        if out_path.exists():
            print(f"  [{i}/{total}] skip (exists): {f.name}")
            continue
        img = Image.open(f)
        result_img = remove(img, session=session)
        # Crop to bounding box so transparent padding is minimal
        bbox = result_img.getbbox()
        if bbox:
            result_img = result_img.crop(bbox)
        result_img.save(out_path)
        print(f"  [{i}/{total}] {f.name} -> {result_img.size}")

    # Clean up raw frames
    import shutil
    shutil.rmtree(raw_dir)

    final_frames = sorted(out_dir.glob("frame_*.png"))
    print(f"\nDone! {len(final_frames)} transparent frames in: {out_dir}")

    # Print config.json snippet
    rel_frames = [f"{out_dir.name}/{f.name}" for f in final_frames]
    snippet = {
        "type": "sequence",
        "frames": rel_frames,
        "fps": args.fps,
        "loop": True
    }
    print("\n--- Paste into config.json 'actions' ---")
    print(json.dumps({"走路": snippet}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
