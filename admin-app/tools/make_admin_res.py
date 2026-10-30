#!/usr/bin/env python3
"""Android resources for the AVERMONTIS ADMIN app (v6): the store's gold "A" on obsidian with a green "ADMIN" badge,
so the owner can tell it apart from the customer app at a glance. Launcher (legacy + adaptive + monochrome),
Android 12+ splash icon, classic splash and the notification icon.
Needs: pip install pillow fonttools brotli.   Run: AVM_FONTS=../store/site/assets/fonts python3 tools/make_admin_res.py"""
import os, io
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.environ.get('AVM_FONTS', os.path.join(os.path.dirname(HERE), 'store', 'site', 'assets', 'fonts'))
RES = os.path.join(HERE, 'android', 'app', 'src', 'main', 'res')
OBS, GOLD, IVORY, WHITE, GREEN = (14, 19, 17, 255), (211, 180, 122, 255), (245, 240, 231, 255), (255, 255, 255, 255), (30, 123, 82, 255)
def tt(name, px):
    f = TTFont(os.path.join(FONTS, name)); f.flavor = None
    b = io.BytesIO(); f.save(b); b.seek(0); return ImageFont.truetype(b, px)
def draw(w, h, scale, bg, fg=GOLD, badge=True, round_mask=False, mono=False, word=False):
    """scale = size of the A+badge block relative to the canvas height"""
    S = 4; W, H = w * S, h * S
    im = Image.new('RGBA', (W, H), bg); d = ImageDraw.Draw(im)
    block = H * scale
    gh_target = block * (0.66 if badge else 1.0)
    fa = tt('cg-600.woff2', int(gh_target / 0.72))
    bb = d.textbbox((0, 0), 'A', font=fa); gw, gh = bb[2] - bb[0], bb[3] - bb[1]
    bh = block * 0.25 if badge else 0
    gap = block * 0.07 if badge else 0
    top = (H - (gh + gap + bh)) / 2 - (H * 0.02 if word else 0)
    if word: top -= H * 0.05
    d.text(((W - gw) / 2 - bb[0], top - bb[1]), 'A', font=fa, fill=(WHITE if mono else fg))
    if badge:
        by = top + gh + gap; bw = block * 0.92
        d.rounded_rectangle([W / 2 - bw / 2, by, W / 2 + bw / 2, by + bh], radius=bh * 0.3, fill=(WHITE if mono else GREEN))
        fb = tt('poppins-600.woff2', int(bh * 0.62)); txt = 'ADMIN'
        tb = d.textbbox((0, 0), txt, font=fb); tw, th = tb[2] - tb[0], tb[3] - tb[1]
        d.text(((W - tw) / 2 - tb[0], by + (bh - th) / 2 - tb[1]), txt, font=fb, fill=((0, 0, 0, 0) if mono else WHITE))
    if word:
        fw = tt('cg-600.woff2', int(H * scale * 0.11)); txt = 'AVERMONTIS'; sp = H * scale * 0.03
        ws = [d.textbbox((0, 0), c, font=fw)[2] for c in txt]; tw = sum(ws) + sp * (len(txt) - 1)
        x = (W - tw) / 2; y = top + gh + gap + bh + block * 0.12
        for c, cw in zip(txt, ws): d.text((x, y), c, font=fw, fill=IVORY); x += cw + sp
    im = im.resize((w, h), Image.LANCZOS)
    if round_mask:
        m = Image.new('L', (w * S, h * S), 0); ImageDraw.Draw(m).ellipse([0, 0, w * S - 1, h * S - 1], fill=255)
        im.putalpha(m.resize((w, h), Image.LANCZOS))
    return im
def stat(n):
    # notification icon: white silhouette "A" with a small bar (Android tints it)
    S = 4; im = Image.new('RGBA', (n * S, n * S), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    fa = tt('cg-600.woff2', int(n * S * 0.95)); bb = d.textbbox((0, 0), 'A', font=fa)
    d.text(((n * S - (bb[2] - bb[0])) / 2 - bb[0], (n * S - (bb[3] - bb[1])) / 2 - bb[1] - n * S * 0.04), 'A', font=fa, fill=WHITE)
    return im.resize((n, n), Image.LANCZOS)
def save(im, *p):
    f = os.path.join(RES, *p); os.makedirs(os.path.dirname(f), exist_ok=True); im.save(f, optimize=True)
D = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for k, s in D.items():
    n = round(48 * s); save(draw(n, n, 0.70, OBS), f'mipmap-{k}', 'ic_launcher.png')
    save(draw(n, n, 0.62, OBS, round_mask=True), f'mipmap-{k}', 'ic_launcher_round.png')
    n = round(108 * s); save(draw(n, n, 0.46, (0, 0, 0, 0)), f'mipmap-{k}', 'ic_launcher_foreground.png')
    save(draw(n, n, 0.46, (0, 0, 0, 0), mono=True), f'mipmap-{k}', 'ic_launcher_monochrome.png')
    n = round(24 * s); save(stat(n), f'drawable-{k}', 'ic_stat_admin.png')
    pw, ph = round(320 * s), round(533 * s)
    save(draw(pw, ph, 0.30, OBS, word=True), f'drawable-port-{k}', 'splash.png')
    save(draw(ph, pw, 0.45, OBS, word=True), f'drawable-land-{k}', 'splash.png')
save(draw(480, 320, 0.5, OBS, word=True), 'drawable', 'splash.png')
save(draw(1152, 1152, 0.42, (0, 0, 0, 0)), 'drawable-xxxhdpi', 'splash_icon.png')
save(draw(512, 512, 0.70, OBS), '..', '..', '..', '..', '..', 'brand', 'admin-icon-512.png')
os.makedirs(os.path.join(RES, 'mipmap-anydpi-v26'), exist_ok=True)
for nm in ('ic_launcher', 'ic_launcher_round'):
    open(os.path.join(RES, 'mipmap-anydpi-v26', nm + '.xml'), 'w').write('<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n</adaptive-icon>\n')
print('resources written to', RES)
