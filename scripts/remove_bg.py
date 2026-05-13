"""Remove background from an image using rembg.

Usage:
    python scripts/remove_bg.py <input> [output]

If output is omitted, writes alongside input with suffix `_nobg.png`.
"""

import sys
from pathlib import Path
from rembg import remove
from PIL import Image


def main():
    if len(sys.argv) < 2:
        print("Usage: python remove_bg.py <input> [output]")
        sys.exit(1)

    inp = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) >= 3 else inp.with_name(inp.stem + "_nobg.png")

    print(f"Reading: {inp}")
    img = Image.open(inp)
    print("Removing background (first run downloads the model, ~170MB)...")
    result = remove(img)
    # Crop to non-transparent bounding box so the pet fills the frame
    bbox = result.getbbox()
    if bbox:
        result = result.crop(bbox)
    result.save(out)
    print(f"Saved: {out}  ({result.size[0]}x{result.size[1]})")


if __name__ == "__main__":
    main()
