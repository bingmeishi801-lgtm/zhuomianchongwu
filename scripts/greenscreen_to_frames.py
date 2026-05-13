"""Convert a green-screen MP4 into transparent PNG frames.

Uses ffmpeg's `chromakey` filter to remove the green background, then
writes a zero-padded PNG sequence. Also produces a suggested
config.json snippet you can paste into your pet pack.

Usage:
    python scripts/greenscreen_to_frames.py <input.mp4> <output_dir> \
        [--key 0x00b140] [--similarity 0.18] [--blend 0.08] [--fps 15] \
        [--max-width 480]
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

FFMPEG = Path(__file__).resolve().parent.parent / "tools" / "ffmpeg.exe"
if not FFMPEG.exists():
    FFMPEG = "ffmpeg"  # fall back to PATH


def run(args):
    print(">>", " ".join(str(a) for a in args))
    res = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        print(res.stdout)
        print(res.stderr, file=sys.stderr)
        sys.exit(res.returncode)
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output_dir")
    ap.add_argument("--key", default="0x00b140", help="chroma color in 0xRRGGBB (default pure green)")
    ap.add_argument("--similarity", type=float, default=0.18)
    ap.add_argument("--blend", type=float, default=0.08)
    ap.add_argument("--fps", type=float, default=15)
    ap.add_argument("--max-width", type=int, default=480, help="scale down to save disk / CPU")
    args = ap.parse_args()

    inp = Path(args.input)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Filter graph:
    #   chromakey removes green,
    #   despill reduces green fringe,
    #   scale caps width,
    #   fps caps frame rate.
    vf = (
        f"chromakey={args.key}:{args.similarity}:{args.blend},"
        f"despill=green,"
        f"fps={args.fps},"
        f"scale='min({args.max_width},iw)':-2:flags=lanczos"
    )

    pattern = str(out_dir / "frame_%04d.png")
    run([
        str(FFMPEG), "-y",
        "-i", str(inp),
        "-vf", vf,
        "-vsync", "cfr",
        pattern,
    ])

    frames = sorted(out_dir.glob("frame_*.png"))
    print(f"\nWrote {len(frames)} frames to {out_dir}")

    # Build a config.json snippet relative to the pet pack directory.
    # We assume the pet pack dir is the parent of out_dir if out_dir is inside
    # assets/pets/<pack>/<subdir>, otherwise paths are written as absolute.
    try:
        pack_dir = out_dir.parent
        rel_frames = [str((out_dir.name + "/" + f.name).replace("\\", "/")) for f in frames]
    except Exception:
        rel_frames = [str(f) for f in frames]

    snippet = {
        "type": "sequence",
        "frames": rel_frames,
        "fps": args.fps,
        "loop": True,
    }
    print("\nPaste this into your config.json 'actions' map:")
    print(json.dumps({"动作名": snippet}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
