#!/usr/bin/env python3
"""Prepare images for the LG UX Scenario deck.

Crops the content-free auth/profile screenshots down to their card region (so
the UI fills the frame and the numbered call-outs have room to spread out) and
copies the brand logo/mark. Output lands in ./img next to build.js.

Run once before build.js:  python3 prep-images.py
Requires Pillow:            pip3 install Pillow
"""
import os
import shutil
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
LG = os.path.abspath(os.path.join(HERE, ".."))          # tv/packaging/lg
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))  # repo root
SHOTS = os.path.join(LG, "screenshots")
ASSETS = os.path.join(REPO, "assets")
OUT = os.path.join(HERE, "img")
os.makedirs(OUT, exist_ok=True)

# Fractional crop boxes (L, T, R, B) measured against each full-screen capture.
# They isolate the centred auth card / profile row from the surrounding letterbox.
CROPS = {
    "02-login.png":    ("02-login-crop.png",    0.36, 0.25, 0.64, 0.76),
    "01-register.png": ("01-register-crop.png", 0.36, 0.19, 0.64, 0.81),
    "03-profiles.png": ("03-profiles-crop.png", 0.30, 0.32, 0.70, 0.99),
}

for src, (dst, l, t, r, b) in CROPS.items():
    im = Image.open(os.path.join(SHOTS, src)).convert("RGB")
    w, h = im.size
    im.crop((int(l * w), int(t * h), int(r * w), int(b * h))).save(os.path.join(OUT, dst))
    print("cropped", dst, Image.open(os.path.join(OUT, dst)).size)

# Brand art used on the cover / closing slides.
for src, dst in [("suvo-logo-tagline.png", "suvo-logo-tagline.png"),
                 ("suvo-mark-1024.png", "suvo-mark.png")]:
    shutil.copy(os.path.join(ASSETS, src), os.path.join(OUT, dst))
    print("copied", dst)

print("done ->", OUT)
