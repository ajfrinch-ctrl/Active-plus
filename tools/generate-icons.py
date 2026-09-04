#!/usr/bin/env python3
"""Generate the Active Plus brand icon set and master logo.

The brand mark mirrors the supplied logo: a grey broken ring with a dark
bold "A" and an orange "+" beneath/overlapping it, on a transparent (or
white) background. Run this whenever the brand mark changes.

Usage:
    python3 tools/generate-icons.py            # writes assets/*.png + logo
    python3 tools/generate-icons.py --check    # verify files exist with right sizes

Pure Pillow, no network access needed.
"""
from __future__ import annotations

import argparse
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")

# Brand colours.
GRAY = (140, 144, 149, 255)      # ring
DARK = (41, 41, 41, 255)         # "A"
ORANGE = (245, 145, 15, 255)     # "+"
TRANSPARENT = (0, 0, 0, 0)
WHITE = (255, 255, 255, 255)
PAGE_BG = (45, 55, 72, 255)      # #2d3748 — for maskable full-bleed icons

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


def compose(size: int, background=TRANSPARENT) -> Image.Image:
    """Draw the A+ logo at a given square size on `background`."""
    img = Image.new("RGBA", (size, size), background)
    d = ImageDraw.Draw(img)
    sc = size / 1024.0
    cx = cy = size / 2

    # Broken grey ring (small gap at the lower-left).
    ring_r = 458 * sc
    ring_w = 66 * sc
    gap_center = 207
    gap_half = 5
    a0 = gap_center + gap_half
    a1 = gap_center - gap_half + 360
    bbox = [cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r]
    d.arc(bbox, start=a0, end=a1, fill=GRAY, width=int(ring_w))

    # Dark "A", offset left of centre.
    font_a = load_font(int(440 * sc))
    text_a = "A"
    ba = d.textbbox((0, 0), text_a, font=font_a)
    aw, ah = ba[2] - ba[0], ba[3] - ba[1]
    ax = cx - 118 * sc - aw / 2
    ay = cy - ah / 2 - ba[1] + 6 * sc
    d.text((ax, ay), text_a, font=font_a, fill=DARK)

    # Orange "+", right of centre, slightly overlapping the A and raised.
    font_p = load_font(int(460 * sc))
    text_p = "+"
    bp = d.textbbox((0, 0), text_p, font=font_p)
    pw, ph = bp[2] - bp[0], bp[3] - bp[1]
    px = cx + 96 * sc - pw / 2
    py = cy + 34 * sc - ph / 2 - bp[1]
    d.text((px, py), text_p, font=font_p, fill=ORANGE)

    if background == TRANSPARENT:
        return img
    return img.convert("RGB")


def write_logo() -> None:
    """Write the standalone logo used in the UI header and reports."""
    os.makedirs(ASSETS, exist_ok=True)
    logo = compose(512, WHITE)
    logo.save(os.path.join(ASSETS, "logo.png"), "PNG")
    # A transparent variant (for dark app headers via the brand mark).
    compose(512, TRANSPARENT).save(os.path.join(ASSETS, "logo-transparent.png"), "PNG")
    print("wrote assets/logo.png (512x512)")
    print("wrote assets/logo-transparent.png (512x512)")


TARGETS = {
    "icon-192.png": (192, TRANSPARENT),
    "icon-512.png": (512, TRANSPARENT),
    # Maskable must be full-bleed on the app theme background.
    "icon-maskable-512.png": (512, PAGE_BG),
    "apple-touch-icon.png": (180, TRANSPARENT),
    "favicon-32x32.png": (32, TRANSPARENT),
    "favicon-16x16.png": (16, TRANSPARENT),
}


def generate() -> None:
    os.makedirs(ASSETS, exist_ok=True)
    write_logo()
    for filename, (size, background) in TARGETS.items():
        path = os.path.join(ASSETS, filename)
        img = compose(size, background)
        if background == TRANSPARENT:
            img.save(path, "PNG")
        else:
            img.save(path, "PNG")
        print(f"wrote {os.path.relpath(path, ROOT)} ({size}x{size})")


def check() -> int:
    failures = 0
    files = list(TARGETS.items()) + [("logo.png", (512, None)), ("logo-transparent.png", (512, None))]
    for filename, (size, _) in files:
        path = os.path.join(ASSETS, filename)
        if not os.path.exists(path):
            print(f"MISSING {filename}")
            failures += 1
            continue
        with Image.open(path) as image:
            ok = size is None or image.size == (size, size)
            print(f"{'ok  ' if ok else 'BAD '} {filename} {image.size} expected {(size, size) if size else 'any'}")
            failures += 0 if ok else 1
    return failures


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="verify the icon set instead of writing it")
    args = parser.parse_args()
    if args.check:
        sys.exit(1 if check() else 0)
    generate()
