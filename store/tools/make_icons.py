#!/usr/bin/env python3
"""Makes the app icons in site/icons/ from the site's own serif (Cormorant 600) and brand colours.
Needs: pip install pillow fonttools brotli.   Run: python3 tools/make_icons.py"""
import os, io
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'site', 'icons'); os.makedirs(OUT, exist_ok=True)
OBS, GOLD, IVORY = (11, 12, 11), (198, 161, 106), (245, 240, 231)
def font(px, w='600'):
    f = TTFont(os.path.join(ROOT, 'site', 'assets', 'fonts', f'cg-{w}.woff2')); f.flavor = None
    b = io.BytesIO(); f.save(b); b.seek(0); return ImageFont.truetype(b, px)
def mark(size, safe):
    S = size * 4  # draw large, downsample for clean edges
    im = Image.new('RGB', (S, S), OBS); d = ImageDraw.Draw(im)
    inner = S * safe            # the part of the canvas the glyph may use
    fa = font(int(inner * (0.62 if wordmark else 0.78)))
    bb = d.textbbox((0, 0), 'A', font=fa); gw, gh = bb[2] - bb[0], bb[3] - bb[1]
    total = gh + (inner * 0.2 if wordmark else inner * 0.1)
    top = (S - total) / 2
    d.text(((S - gw) / 2 - bb[0], top - bb[1]), 'A', font=fa, fill=GOLD)
    ry = top + gh + inner * 0.06; rw = inner * 0.22
    d.rectangle([S / 2 - rw / 2, ry, S / 2 + rw / 2, ry + max(2, S * 0.006)], fill=GOLD)
    if wordmark:
        fw = font(int(inner * 0.085)); txt = 'AVERMONTIS'; sp = inner * 0.022
        ws = [d.textbbox((0, 0), c, font=fw)[2] for c in txt]; tw = sum(ws) + sp * (len(txt) - 1)
        x = (S - tw) / 2; y = ry + inner * 0.07
        for c, w in zip(txt, ws): d.text((x, y), c, font=fw, fill=IVORY); x += w + sp
    return im.resize((size, size), Image.LANCZOS)
for s in (192, 512): mark(s, 0.86).save(os.path.join(OUT, f'icon-{s}.png'), optimize=True)
for s in (192, 512): mark(s, 0.62).save(os.path.join(OUT, f'maskable-{s}.png'), optimize=True)   # glyph inside the 80% safe circle
mark(180, 0.80).save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)
mark(64, 0.92).save(os.path.join(ROOT, 'site', 'img', 'favicon.png'), optimize=True)
print('icons written to', OUT)
