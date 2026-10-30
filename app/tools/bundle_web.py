#!/usr/bin/env python3
"""Copies the AVERMONTIS app screens (served on the web at /app) into www/ so the Android app ships them inside the APK.
Source of truth: ../src/site (the store repo). Run: python3 tools/bundle_web.py  then  npx cap sync android"""
import os, re, shutil, json, glob
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.environ.get('AVM_SITE', os.path.join(os.path.dirname(HERE), 'src', 'site'))
WWW = os.path.join(HERE, 'www')
shutil.rmtree(WWW, ignore_errors=True)
def cp(rel):
    dst = os.path.join(WWW, rel); os.makedirs(os.path.dirname(dst), exist_ok=True); shutil.copy2(os.path.join(SITE, rel), dst)
for rel in ['assets/m/app.js', 'assets/m/app.css', 'products.js', 'icons/icon-192.png', 'img/favicon.png'] + \
           [os.path.relpath(p, SITE) for p in glob.glob(os.path.join(SITE, 'assets/fonts/*.woff2'))] + \
           [os.path.relpath(p, SITE) for p in glob.glob(os.path.join(SITE, 'assets/icons4/*.png'))]:
    cp(rel)
imgs = [os.path.relpath(p, SITE) for p in glob.glob(os.path.join(SITE, 'img/*.webp'))]
for rel in imgs: cp(rel)
bundled = sorted('/' + r for r in imgs)
with open(os.path.join(WWW, 'native-config.js'), 'w') as f:
    f.write('/* written by tools/bundle_web.py: images shipped inside the app */\nwindow.AVM_BUNDLED = ' + json.dumps(bundled) + ';\n')
html = open(os.path.join(SITE, '_pages', 'app.html'), encoding='utf-8').read()
# web-only bits: manifest/install metas and the website fallback link
html = re.sub(r'\s*<link rel="(manifest|apple-touch-icon)"[^>]*>', '', html)
html = re.sub(r'\s*<meta name="(apple-mobile-web-app-[a-z-]+|mobile-web-app-capable|robots)"[^>]*>', '', html)
html = html.replace('<script src="/assets/m/app.js?v=5.0.0" defer></script>',
                    '<script src="/native-config.js"></script>\n<script src="/products.js"></script>\n<script src="/assets/m/app.js?v=5.0.0" defer></script>')
html = re.sub(r'<noscript>.*?</noscript>', '', html, flags=re.S)
html = html.replace('<html lang="en-IN">', '<html lang="en-IN" class="native-boot">')
assert '/native-config.js' in html and 'manifest' not in html
open(os.path.join(WWW, 'index.html'), 'w', encoding='utf-8').write(html)
print('www/ ready:', sum(len(fs) for _, _, fs in os.walk(WWW)), 'files')
