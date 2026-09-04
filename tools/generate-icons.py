#!/usr/bin/env python3
"""Generate the PWA icon set for Active Plus.

Usage:
    python3 tools/generate-icons.py            # writes assets/*.png
    python3 tools/generate-icons.py --check    # verify files exist with right sizes

Pure Pillow, no network access needed. Run it whenever the brand mark changes.
"""
from __future__ import annotations

import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")

# Brand gradient, top-left -> bottom-right.
GRADIENT_TOP = (66, 153, 225, 255)      # #4299e1
GRADIENT_BOTTOM = (43, 108, 176, 255)   # #2b6cb0
PAGE_BG = (45, 55, 72, 255)             # #2d3748

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "C:\\Windows\\Fonts\\arialbd.ttf",
]


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def gradient(size: int) -> Image.Image:
    """Diagonal gradient between the two brand colours."""
    base = Image.new("RGBA", (size, size), GRADIENT_TOP)
    top = Image.new("RGBA", (size, size), GRADIENT_BOTTOM)
    # Distance along the diagonal, normalised 0..1 -> used as the blend mask.
    mask = Image.new("L", (size, size))
    pixels = mask.load()
    denom = 2 * (size - 1) if size > 1 else 1
    for y in range(size):
        for x in range(size):
            pixels[x, y] = int(255 * (x + y) / denom)
    base.paste(top, (0, 0), mask)
    return base


def rounded_mask(size: int, radius_ratio: float) -> Image.Image:
    radius = int(size * radius_ratio)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def draw_mark(size: int, inset_ratio: float = 0.2) -> Image.Image:
    """White 'A+' centred inside the safe area."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    safe = int(size * (1 - 2 * inset_ratio))
    left = (size - safe) // 2
    top = (size - safe) // 2
    font = load_font(int(safe * 0.52))
    text = "A+"
    box = draw.textbbox((0, 0), text, font=font)
    text_w = box[2] - box[0]
    text_h = box[3] - box[1]
    draw.text((left + (safe - text_w) / 2 - box[0], top + (safe - text_h) / 2 - box[1]),
              text, font=font, fill=(255, 255, 255, 255))
    return layer


def compose(size: int, corner_radius: float = 0.22, maskable: bool = False) -> Image.Image:
    if maskable:
        # Maskable icons must be full-bleed; the mark stays inside the 80% safe zone.
        icon = Image.new("RGBA", (size, size), PAGE_BG)
        icon.alpha_composite(gradient(size))
        icon.alpha_composite(draw_mark(size, inset_ratio=0.28))
        return icon.convert("RGB")

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    tile = gradient(size)
    tile.putalpha(rounded_mask(size, corner_radius))
    canvas.alpha_composite(tile)
    canvas.alpha_composite(draw_mark(size, inset_ratio=0.24))
    return canvas


TARGETS = {
    "icon-192.png": (192, False),
    "icon-512.png": (512, False),
    "icon-maskable-512.png": (512, True),
    "apple-touch-icon.png": (180, False),
    "favicon-32x32.png": (32, False),
    "favicon-16x16.png": (16, False),
}


def generate() -> None:
    os.makedirs(ASSETS, exist_ok=True)
    for filename, (size, maskable) in TARGETS.items():
        path = os.path.join(ASSETS, filename)
        compose(size, maskable=maskable).save(path, "PNG")
        print(f"wrote {os.path.relpath(path, ROOT)} ({size}x{size})")


def check() -> int:
    failures = 0
    for filename, (size, _) in TARGETS.items():
        path = os.path.join(ASSETS, filename)
        if not os.path.exists(path):
            print(f"MISSING {filename}")
            failures += 1
            continue
        with Image.open(path) as image:
            ok = image.size == (size, size)
            print(f"{'ok  ' if ok else 'BAD '} {filename} {image.size} expected {(size, size)}")
            failures += 0 if ok else 1
    return failures


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify the icon set instead of writing it")
    args = parser.parse_args()
    if args.check:
        sys.exit(1 if check() else 0)
    generate()
