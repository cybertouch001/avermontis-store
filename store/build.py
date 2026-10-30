#!/usr/bin/env python3
"""Builds site/_pages/*.html from src/pages/*.html + the shared header/footer below.
Run:  python3 build.py      (then publish the site/ folder)
Each source page starts with a JSON comment:  <!--{"title": "...", "description": "...", "noindex": false}-->"""
import json, os, re, glob, html
ROOT = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = os.path.join(ROOT, 'src', 'pages'), os.path.join(ROOT, 'site', '_pages')
ICON = {
 'menu': '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
 'search': '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
 'user': '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
 'bag': '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M5 8h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8L5 8z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>',
 'close': '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
 'lock': '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
 'cash': '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
 'return': '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4 4v4h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
 'india': '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="11" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
 'ig': '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17.3" cy="6.7" r="1" fill="currentColor"/></svg>',
 'fb': '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M14 8h3V4.5h-3a4 4 0 0 0-4 4V11H7v3.5h3V21h3.5v-6.5h3l.5-3.5h-3.5V8.6c0-.4.2-.6.5-.6z" fill="currentColor"/></svg>',
 'phone': '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 18.5h2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
 't_home': '<svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
 't_shop': '<svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
 't_concern': '<svg viewBox="0 0 24 24" width="23" height="23" aria-hidden="true"><path d="M12 3.5c3 4 6 7.2 6 10.6a6 6 0 0 1-12 0c0-3.4 3-6.6 6-10.6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9.3 14.6a2.8 2.8 0 0 0 2.7 2.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
 'yt': '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/></svg>',
}
SHOP_SUB = [('/shop', 'All products'), ('/shop/serums', 'Serums'), ('/shop/moisturisers', 'Moisturisers'), ('/shop/cleansers', 'Cleansers'), ('/shop/sunscreens', 'Sunscreens'), ('/shop/eye-care', 'Eye care')]
NAV = [('/collections', 'Collections'), ('/concerns', 'Shop by concern'), ('/concerns#finder', 'Skin finder'), ('/ingredients', 'Ingredients'), ('/about', 'About')]
def menu_html():
    sub = ''.join(f'<a href="{h}">{l}{" <em>Soon</em>" if h.endswith("eye-care") else ""}</a>' for h, l in SHOP_SUB)
    return ('<li class="has-sub"><a href="/shop" aria-haspopup="true">Shop</a><div class="sub" role="group" aria-label="Shop categories">' + sub + '</div></li>'
            + ''.join(f'<li><a href="{h}">{l}</a></li>' for h, l in NAV))
def drawer_html():
    sub = ''.join(f'<a href="{h}">{l}{" <em>Soon</em>" if h.endswith("eye-care") else ""}</a>' for h, l in SHOP_SUB)
    return ('<p class="drawer-h">Shop</p><div class="drawer-sub">' + sub + '</div><p class="drawer-h">Discover</p>'
            + ''.join(f'<a href="{h}">{l}</a>' for h, l in NAV) + '<a href="/blog">Journal</a>')
def head(m):
    t, d = html.escape(m['title']), html.escape(m.get('description', ''))
    robots = '<meta name="robots" content="noindex, nofollow">\n' if m.get('noindex') else ''
    seo = ('<!--SEO--><title>%s</title>\n<meta name="description" content="%s">\n<meta property="og:title" content="%s">\n<meta property="og:description" content="%s">\n<meta property="og:image" content="/og.png">\n<!--/SEO-->' % (t, d, t, d))
    return f"""<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
{seo}
{robots}<meta property="og:type" content="website"><meta property="og:site_name" content="Avermontis">
<meta name="theme-color" content="#0B0C0B">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/img/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Avermontis">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="application-name" content="Avermontis">
<script src="/assets/pwa-boot.js"></script>
<link rel="preload" href="/assets/fonts/cg-600.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/styles.css">
</head>
<body class="{m.get('body_class', '')}">
<a class="skip" href="#main">Skip to content</a>
<div class="announce"><div class="wrap"><span id="announce-text">Free shipping above &#8377;499 &middot; Cash on Delivery available</span></div></div>
<div class="offline" id="offline" role="status">You are offline. You can browse, and your cart is saved &mdash; reconnect to place an order.</div>
<header class="site-header">
 <div class="wrap nav">
  <button class="menu-btn icon-btn" type="button" aria-controls="drawer" aria-expanded="false" aria-label="Open menu">{ICON['menu']}</button>
  <a class="logo" href="/" aria-label="Avermontis home">AVER<span>MONTIS</span></a>
  <nav class="menu-wrap" aria-label="Main"><ul class="menu">{menu_html()}</ul></nav>
  <div class="hdr-icons">
   <button class="search-btn icon-btn" type="button" aria-label="Search products" aria-controls="search-overlay">{ICON['search']}</button>
   <a class="acct-link icon-btn" href="/login" aria-label="Sign in">{ICON['user']}<span class="acct-label">Sign in</span></a>
   <a class="cart-link icon-btn" href="/cart" aria-label="Cart">{ICON['bag']}<span class="cart-count zero">0</span></a>
  </div>
 </div>
</header>
<div class="drawer" id="drawer" aria-label="Menu">
 <div class="drawer-scrim" data-close-drawer></div>
 <div class="drawer-panel">
  <div class="drawer-top"><a class="logo" href="/">AVER<span>MONTIS</span></a><button class="icon-btn" type="button" data-close-drawer aria-label="Close menu">{ICON['close']}</button></div>
  <nav class="drawer-nav" aria-label="Mobile">{drawer_html()}<p class="drawer-h">Help</p><a href="/contact">Contact</a><a href="/track">Track order</a><a href="/faq">FAQs</a><a href="/account" data-signed-in class="hidden">My account</a><a href="/login" data-signed-out>Sign in / Create account</a></nav>
  <p class="drawer-install hidden" data-install-wrap><button class="btn ghost sm" type="button" data-install>{ICON['phone']} Install the Avermontis app</button></p>
  <p class="drawer-note">Cash on Delivery &middot; Free shipping above &#8377;499</p>
 </div>
</div>
<div class="search-overlay" id="search-overlay" role="dialog" aria-label="Search">
 <form class="wrap search-form" action="/shop" method="get" role="search"><label class="sr" for="site-q">Search products</label><input id="site-q" name="q" type="search" placeholder="Search the collection&hellip;" autocomplete="off"><button class="btn sm" type="submit">Search</button><button class="icon-btn" type="button" data-close-search aria-label="Close search">{ICON['close']}</button></form>
</div>
<main id="main">
"""
FOOT = f"""
</main>
<footer class="site-footer">
 <div class="wrap">
  <div class="news-band"><div><span class="eyebrow">The Avermontis letter</span><h2>Notes on skin, ritual and new arrivals</h2><p class="muted">Occasional letters, never noise. Unsubscribe any time.</p></div>
   <form class="news-form" data-newsletter="footer" id="news-foot" novalidate><div class="field"><label class="sr" for="news-foot-email">Email</label><input id="news-foot-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="Your email address"><p class="err" id="news-foot-err-email"></p></div><button class="btn" type="submit">Subscribe</button><div class="form-alert hidden" role="alert"></div></form></div>
  <div class="fgrid">
   <div class="fbrand"><a class="logo" href="/">AVER<span>MONTIS</span></a><p class="muted small">A considered skincare house. A short collection &mdash; cleanser, serums, moisturiser and daily sunscreen &mdash; made in India, with every ingredient and step written plainly.</p><p class="small"><a href="/contact">Contact &amp; support</a></p>
    <div class="socials" aria-label="Social media (coming soon)"><span title="Instagram (coming soon)">{ICON['ig']}</span><span title="Facebook (coming soon)">{ICON['fb']}</span><span title="YouTube (coming soon)">{ICON['yt']}</span></div></div>
   <div><h3>Shop</h3><ul><li><a href="/shop">All products</a></li><li><a href="/shop/serums">Serums</a></li><li><a href="/shop/moisturisers">Moisturisers</a></li><li><a href="/shop/cleansers">Cleansers</a></li><li><a href="/shop/sunscreens">Sunscreens</a></li><li><a href="/collections">Collections</a></li></ul></div>
   <div><h3>Discover</h3><ul><li><a href="/concerns">Shop by concern</a></li><li><a href="/concerns#finder">Skin finder</a></li><li><a href="/ingredients">Ingredients &amp; routine</a></li><li><a href="/blog">Journal</a></li></ul></div>
   <div><h3>Help</h3><ul><li><a href="/track">Track your order</a></li><li><a href="/faq">FAQs</a></li><li><a href="/shipping">Shipping</a></li><li><a href="/returns">Returns &amp; refunds</a></li><li><a href="/contact">Contact us</a></li></ul></div>
   <div><h3>Avermontis</h3><ul><li><a href="/about">About</a></li><li><a href="/blog">Journal</a></li><li><a href="/account">My account</a></li><li><a href="/privacy">Privacy policy</a></li><li><a href="/terms">Terms of service</a></li><li class="hidden" data-install-wrap><a href="#" data-install>Install the app</a></li></ul></div>
  </div>
  <div class="fbottom"><span>&copy; <span id="year">2026</span> Avermontis. All prices in INR, inclusive of GST. Payment: Cash on Delivery.</span><span>Made in India</span></div>
 </div>
</footer>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<div class="install-banner" id="install-banner" role="dialog" aria-label="Install the Avermontis app" hidden>
 <img src="/icons/icon-192.png" alt="" width="48" height="48">
 <div class="ib-text"><b>Get the Avermontis app</b><span data-install-hint>Full screen, one tap from your home screen. Same account and bag.</span></div>
 <button class="btn sm" type="button" data-install>Install</button>
 <button class="icon-btn ib-close" type="button" data-install-close aria-label="Not now">{ICON['close']}</button>
</div>
<nav class="tabbar" aria-label="App">
 <a href="/" data-tab="home">{ICON['t_home']}<span>Home</span></a>
 <a href="/shop" data-tab="shop">{ICON['t_shop']}<span>Shop</span></a>
 <a href="/concerns" data-tab="concerns">{ICON['t_concern']}<span>Concerns</span></a>
 <a href="/cart" data-tab="bag" class="tb-bag"><span class="tb-ico">{ICON['bag'].replace('width="20" height="20"', 'width="23" height="23"')}<span class="cart-count zero">0</span></span><span>Bag</span></a>
 <a href="/account" data-tab="account">{ICON['user'].replace('width="20" height="20"', 'width="23" height="23"')}<span>Account</span></a>
</nav>
<script src="/products.js"></script>
<script src="/assets/app.js?v=5.0.0"></script>
<script src="/assets/pwa.js"></script>
"""

CATS = [('serums', 'Serums', 'Water-light formulas that do the focused work in your routine.'),
        ('moisturisers', 'Moisturisers', 'Light textures that keep skin comfortable and sit well under sunscreen.'),
        ('cleansers', 'Cleansers', 'The first step, morning and night.'),
        ('sunscreens', 'Sunscreens', 'The last step of every morning.'),
        ('eye-care', 'Eye care', 'A dedicated eye formula is not part of the collection yet.')]
COLLECTIONS = [('morning-ritual', 'The Morning Ritual', 'Cleanse, treat, moisturise, protect: the four morning steps, in the order you use them.'),
               ('evening-ritual', 'The Evening Ritual', 'Cleanse, treat, moisturise. Sunscreen stays in the morning.'),
               ('serum-edit', 'The Serum Edit', 'Both serums, each with its own place: Vitamin C in the morning, Niacinamide morning or night.')]
DISCOVER = ('<section class="discover-band"><div><span class="eyebrow">Not sure where to start?</span><h2>Find your routine in four questions.</h2></div>'
            '<div class="db-acts"><a class="btn" href="/concerns#finder">Take the skin finder</a><a class="linkbtn" href="/concerns">Shop by concern</a></div></section>')
def subnav(items, cur, label):
    return f'<nav class="subnav" aria-label="{label}">' + ''.join(
        f'<a href="{h}"{" aria-current=" + chr(34) + "page" + chr(34) if h == cur else ""}>{l}</a>' for h, l in items) + '</nav>'
def generated():
    pages = []
    cat_items = [('/shop', 'All')] + [('/shop/' + s, n) for s, n, _ in CATS]
    for s, n, intro in CATS:
        meta = {'title': f'{n} | Avermontis', 'description': f'Avermontis {n.lower()}: {intro}'}
        body = (f'<section class="page-hero"><div class="wrap"><nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/shop">Shop</a> / {n}</nav>'
                f'<span class="eyebrow">Shop</span><h1>{n}</h1><p class="lead">{intro}</p></div></section>'
                f'<div class="wrap page">{subnav(cat_items, "/shop/" + s, "Categories")}<p class="muted small" id="cat-count" aria-live="polite"></p>'
                f'<div class="grid" id="cat-grid" data-cat="{s}" aria-live="polite"></div>{DISCOVER}</div>\n')
        pages.append((os.path.join('shop', s + '.html'), meta, body))
    col_items = [('/collections', 'All collections')] + [('/collections/' + s, n) for s, n, _ in COLLECTIONS]
    for s, n, intro in COLLECTIONS:
        meta = {'title': f'{n} | Avermontis Collections', 'description': intro}
        body = (f'<section class="page-hero"><div class="wrap"><nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/collections">Collections</a> / {n}</nav>'
                f'<span class="eyebrow">Collection</span><h1>{n}</h1><p class="lead">{intro}</p></div></section>'
                f'<div class="wrap page">{subnav(col_items, "/collections/" + s, "Collections")}<div class="grid" id="col-grid" data-collection="{s}" aria-live="polite"></div>'
                f'<div class="col-buy" id="col-buy" aria-live="polite"></div>{DISCOVER}</div>\n')
        pages.append((os.path.join('collections', s + '.html'), meta, body))
    return pages
def build():
    n = 0
    for f in sorted(glob.glob(os.path.join(SRC, '*.html'))):
        raw = open(f, encoding='utf-8').read()
        m = re.match(r'\s*<!--(\{.*?\})-->\s*', raw, re.S)
        meta = json.loads(m.group(1)); body = raw[m.end():]
        extra = ''.join(f'<script src="{s}"></script>\n' for s in meta.get('scripts', []))
        out = head(meta) + body + FOOT + extra + '</body>\n</html>\n'
        open(os.path.join(OUT, os.path.basename(f)), 'w', encoding='utf-8').write(out); n += 1
    for rel, meta, body in generated():
        os.makedirs(os.path.dirname(os.path.join(OUT, rel)), exist_ok=True)
        open(os.path.join(OUT, rel), 'w', encoding='utf-8').write(head(meta) + body + FOOT + '</body>\n</html>\n'); n += 1
    print('built', n, 'pages')
if __name__ == '__main__':
    build()
