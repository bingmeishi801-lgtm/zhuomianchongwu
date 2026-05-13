"""Sample the four corners + center of an image to guess the chroma key color."""
import sys
from PIL import Image

img = Image.open(sys.argv[1]).convert("RGB")
w, h = img.size
points = {
    "top-left":     (5, 5),
    "top-right":    (w - 6, 5),
    "bottom-left":  (5, h - 6),
    "bottom-right": (w - 6, h - 6),
    "center":       (w // 2, h // 2),
}
for name, (x, y) in points.items():
    r, g, b = img.getpixel((x, y))
    print(f"{name:12s} ({x:4d},{y:4d})  RGB=({r:3d},{g:3d},{b:3d})  #{r:02x}{g:02x}{b:02x}")
