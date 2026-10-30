#!/usr/bin/env python3
"""Android resources for the AVERMONTIS app: launcher icons (legacy + adaptive), Android 12+ splash icon, classic splash
screens and the notification icon. Drawn from the site's own serif (Cormorant 600) in the brand colours.
Needs: pip install pillow fonttools brotli.   Run: python3 tools/make_native_res.py"""
import os, io
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.environ.get('AVM_FONTS', os.path.join(os.path.dirname(HERE), 'src', 'site', 'assets', 'fonts'))
RES = os.path.join(HERE, 'android', 'app', 'src', 'main', 'res')
OBS, GOLD, IVORY, WHITE = (11, 12, 11, 255), (198, 161, 106, 255), (245, 240, 231, 255), (255, 255, 255, 255)
def font(px):
    f = TTFont(os.path.join(FONTS, 'cg-600.woff2')); f.flavor = None
    b = io.BytesIO(); f.save(b); b.seek(0); return ImageFont.truetype(b, px)
def draw(w, h, glyph_h, bg, fg, rule=True, word=False, round_mask=False):
    S = 4; W, H = w * S, h * S
    im = Image.new('RGBA', (W, H), bg); d = ImageDraw.Draw(im)
    fa = font(int(glyph_h * S / 0.72))
    bb = d.textbbox((0, 0), 'A', font=fa); gw, gh = bb[2] - bb[0], bb[3] - bb[1]
    extra = gh * (0.16 if rule else 0) + (gh * 0.36 if word else 0)
    top = (H - (gh + extra)) / 2
    d.text(((W - gw) / 2 - bb[0], top - bb[1]), 'A', font=fa, fill=fg)
    ry = top + gh + gh * 0.09
    if rule:
        rw = gh * 0.34; d.rectangle([W / 2 - rw / 2, ry, W / 2 + rw / 2, ry + max(S, gh * 0.012)], fill=fg)
    if word:
        fw = font(int(gh * 0.13)); txt = 'AVERMONTIS'; sp = gh * 0.035
        ws = [d.textbbox((0, 0), c, font=fw)[2] for c in txt]; tw = sum(ws) + sp * (len(txt) - 1)
        x = (W - tw) / 2; y = ry + gh * 0.12
        for c, cw in zip(txt, ws): d.text((x, y), c, font=fw, fill=IVORY); x += cw + sp
    im = im.resize((w, h), Image.LANCZOS)
    if round_mask:
        m = Image.new('L', (w * S, h * S), 0); ImageDraw.Draw(m).ellipse([0, 0, w * S - 1, h * S - 1], fill=255)
        im.putalpha(m.resize((w, h), Image.LANCZOS))
    return im
def save(im, *p):
    f = os.path.join(RES, *p); os.makedirs(os.path.dirname(f), exist_ok=True); im.save(f, optimize=True)
D = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for k, s in D.items():
    n = round(48 * s); save(draw(n, n, n * 0.46, OBS, GOLD), f'mipmap-{k}', 'ic_launcher.png')
    save(draw(n, n, n * 0.40, OBS, GOLD, round_mask=True), f'mipmap-{k}', 'ic_launcher_round.png')
    n = round(108 * s); save(draw(n, n, n * 0.30, (0, 0, 0, 0), GOLD), f'mipmap-{k}', 'ic_launcher_foreground.png')
    n = round(24 * s); save(draw(n, n, n * 0.78, (0, 0, 0, 0), WHITE, rule=False), f'drawable-{k}', 'ic_stat_avermontis.png')
    pw, ph = round(320 * s), round(533 * s)
    save(draw(pw, ph, pw * 0.26, OBS, GOLD, word=True), f'drawable-port-{k}', 'splash.png')
    save(draw(ph, pw, pw * 0.26, OBS, GOLD, word=True), f'drawable-land-{k}', 'splash.png')
save(draw(480, 320, 84, OBS, GOLD, word=True), 'drawable', 'splash.png')
# Android 12+ system splash: 288dp icon canvas, the mark kept inside the central 192dp circle
save(draw(1152, 1152, 1152 * 0.30, (0, 0, 0, 0), GOLD), 'drawable-xxxhdpi', 'splash_icon.png')
print('resources written to', RES)
