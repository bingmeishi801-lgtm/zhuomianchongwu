"""Stable GIF background removal with fixed bounding box.

Usage:
    python scripts\gif_stable_nobg.py <input.gif> <output_dir>
"""

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


def main():
    if len(sys.argv) < 3:
        print("Usage: python gif_stable_nobg.py <input.gif> <output_dir>")
        sys.exit(1)

    inp = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    raw_dir = out_dir / "_raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("[1/4] Extracting frames...")
    pattern = str(raw_dir / "frame_%04d.png")
    subprocess.run(
        [str(FFMPEG), "-y", "-i", str(inp), pattern],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    raw_frames = sorted(raw_dir.glob("frame_*.png"))
    total = len(raw_frames)
    print(f"    {total} frames extracted.")

    print("[2/4] Removing backgrounds...")
    session = new_session("u2net")
    processed = []

    for i, f in enumerate(raw_frames, 1):
        img = Image.open(f)
        result = remove(img, session=session)
        processed.append(result)
        if i % 5 == 0 or i == total:
            print(f"    [{i}/{total}]")

    print("[3/4] Computing fixed bounding box...")
    min_x, min_y = float("inf"), float("inf")
    max_x, max_y = 0, 0

    for img in processed:
        bbox = img.getbbox()
        if bbox:
            min_x = min(min_x, bbox[0])
            min_y = min(min_y, bbox[1])
            max_x = max(max_x, bbox[2])
            max_y = max(max_y, bbox[3])

    if min_x == float("inf"):
        print("ERROR: No content found!")
        sys.exit(1)

    print(f"    Fixed box: ({min_x}, {min_y}) -> ({max_x}, {max_y})")
    print(f"    Size: {max_x - min_x} x {max_y - min_y}")

    print("[4/4] Cropping with fixed box...")
    for i, img in enumerate(processed, 1):
        cropped = img.crop((min_x, min_y, max_x, max_y))
        out_path = out_dir / f"frame_{i:04d}.png"
        cropped.save(out_path)

    shutil.rmtree(raw_dir)
    print(f"\nDone! {total} frames in {out_dir}")

    try:
        gif = Image.open(inp)
        fps = 1000 / gif.info.get("duration", 100)
        fps = round(fps, 1)
    except:
        fps = 12

    rel_frames = [f"{out_dir.name}/frame_{i:04d}.png" for i in range(1, total + 1)]
    print(f"\nFPS: {fps}")
    print("\nconfig.json snippet:")
    print(
        json.dumps(
            {
                "撒娇": {
                    "type": "sequence",
                    "frames": rel_frames,
                    "fps": fps,
                    "loop": True,
                }
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
