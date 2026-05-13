"""Batch convert all MP4 files in a folder to transparent PNG sequences.

Usage:
    python scripts/batch_convert.py <mp4_folder> [--fps 12] [--max-width 400]

Example:
    python scripts/batch_convert.py "D:/my_videos" --fps 12 --max-width 400

This will:
1. Find all .mp4 files in the given folder
2. For each MP4, extract frames and remove background with rembg
3. Save results to assets/pets/default/<video_name>/
4. Auto-generate config.json with all actions set to random playback
"""

import argparse
import subprocess
import sys
import json
import shutil
from pathlib import Path
from PIL import Image
from rembg import remove, new_session

FFMPEG = Path(__file__).resolve().parent.parent / "tools" / "ffmpeg.exe"
if not FFMPEG.exists():
    FFMPEG = "ffmpeg"

PET_DIR = Path(__file__).resolve().parent.parent / "assets" / "pets" / "default"


def process_one_video(mp4_path, out_dir, fps, max_width, session):
    """Extract frames from one MP4 and remove background."""
    raw_dir = out_dir / "_raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Step 1: extract raw frames
    print(f"  Extracting frames at {fps} fps ...")
    vf = f"fps={fps},scale='min({max_width},iw)':-2:flags=lanczos"
    pattern = str(raw_dir / "frame_%04d.png")
    subprocess.run(
        [str(FFMPEG), "-y", "-i", str(mp4_path), "-vf", vf, "-vsync", "cfr", pattern],
        capture_output=True, text=True, encoding="utf-8", errors="replace"
    )

    raw_frames = sorted(raw_dir.glob("frame_*.png"))
    total = len(raw_frames)
    if total == 0:
        print(f"  WARNING: No frames extracted from {mp4_path}")
        return []

    print(f"  Removing background from {total} frames ...")
    for i, f in enumerate(raw_frames, 1):
        out_path = out_dir / f.name
        if out_path.exists():
            continue
        img = Image.open(f)
        result_img = remove(img, session=session)
        bbox = result_img.getbbox()
        if bbox:
            result_img = result_img.crop(bbox)
        result_img.save(out_path)
        if i % 10 == 0 or i == total:
            print(f"    [{i}/{total}]")

    # Clean up raw
    shutil.rmtree(raw_dir)

    final_frames = sorted(out_dir.glob("frame_*.png"))
    return [f"{out_dir.name}/{f.name}" for f in final_frames]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mp4_folder", help="Folder containing MP4 files")
    ap.add_argument("--fps", type=float, default=12)
    ap.add_argument("--max-width", type=int, default=400)
    args = ap.parse_args()

    mp4_folder = Path(args.mp4_folder)
    mp4_files = sorted(mp4_folder.glob("*.mp4"))
    if not mp4_files:
        print(f"No .mp4 files found in {mp4_folder}")
        sys.exit(1)

    print(f"Found {len(mp4_files)} MP4 files. Starting batch conversion...\n")

    session = new_session("u2net")
    actions = {}

    for idx, mp4 in enumerate(mp4_files, 1):
        # Use a clean name for the action directory
        action_name = mp4.stem  # filename without extension
        # Sanitize: replace spaces and special chars
        dir_name = f"action_{idx:02d}"
        out_dir = PET_DIR / dir_name

        print(f"[{idx}/{len(mp4_files)}] {mp4.name} -> {dir_name}/")
        frames = process_one_video(mp4, out_dir, args.fps, args.max_width, session)

        if frames:
            actions[action_name] = {
                "type": "sequence",
                "frames": frames,
                "fps": args.fps,
                "loop": True
            }
            print(f"  Done: {len(frames)} frames\n")
        else:
            print(f"  Skipped (no frames)\n")

    # Write config.json
    config = {
        "name": "我的宠物",
        "defaultAction": "__random__",
        "actions": actions
    }
    config_path = PET_DIR / "config.json"
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nconfig.json written to {config_path}")
    print(f"Total actions: {len(actions)}")
    print("\nDone! Run 'npm start' to see your pet.")


if __name__ == "__main__":
    main()
