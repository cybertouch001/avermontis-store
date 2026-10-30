# Headless end-to-end test for AVERMONTIS v5 (updated for v6: owner sign-in only on /admin and the Admin app) (website + app runtime emulation) against tools/e2e-server.mjs.
# Run: node tools/e2e-server.mjs &   then   python3 test/e2e_v5.py <screenshot_dir>
import sys, os, json, re, mimetypes, time
from playwright.sync_api import sync_playwright, expect
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/av5-shots'
os.makedirs(OUT, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
WWW = os.path.join(HERE, '..', '..', 'app', 'www')
SRV = os.environ.get('AVM_SRV', 'http://localhost:8788')
SITE = 'https://avermontis.sites.tab.bot'
PW = 'OwnerPass123'
results = []
def ok(name, cond, extra=''):
    results.append((name, bool(cond), extra)); print(('PASS ' if cond else 'FAIL ') + name + (' — ' + extra if extra else ''), flush=True)

def proxy(ip):
    def handler(route, request):
        h = dict(request.headers); h['x-test-ip'] = ip
        url = SRV + request.url[len(SITE):]
        try:
            resp = route.fetch(url=url, headers=h, max_redirects=0)
            route.fulfill(response=resp)
        except Exception as e:
            route.abort()
    return handler
def serve_www(route, request):
    p = request.url.split('://localhost', 1)[1].split('#')[0].split('?')[0]
    if p in ('', '/') or not os.path.splitext(p)[1]: p = '/index.html'
    f = os.path.normpath(os.path.join(WWW, p.lstrip('/')))
    if not f.startswith(os.path.normpath(WWW)) or not os.path.isfile(f): return route.fulfill(status=404, body='nf')
    route.fulfill(status=200, body=open(f, 'rb').read(), content_type=mimetypes.guess_type(f)[0] or 'application/octet-stream')
def skip_onboarding(p):
    # a returning customer: onboarding done, skin profile saved on the phone
    p.evaluate("localStorage.setItem('avm_app_onboarded','1'); localStorage.setItem('avm_app_profile', JSON.stringify({name:'Priya', type:'normal', concerns:['dullness'], sens:false}))")
    p.reload(); p.wait_for_selector('#tabbar'); p.wait_for_timeout(2500)
def act(p, sel, path):
    with p.expect_response(lambda r: path in r.url and r.request.method != 'GET', timeout=20000) as info:
        p.click(sel)
    r = info.value; p.wait_for_timeout(1200); return r.status
CAP_STUB = "if (location.hostname === 'localhost') { window.Capacitor = { isNativePlatform: function(){ return true; }, getPlatform: function(){ return 'android'; }, Plugins: {} }; }"

with sync_playwright() as pw:
    br = pw.chromium.launch()
    def ctx(ip, mobile=False, native=False, dark=False):
        c = br.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1366, 'height': 900}, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile, color_scheme='dark' if dark else 'light', service_workers='block',
                           user_agent=('Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36' if mobile else None))
        c.route(SITE + '/**', proxy(ip))
        if native: c.route('https://localhost/**', serve_www); c.add_init_script(CAP_STUB)
        return c
    # seed: owner password (the existing one, set once in setup) + a customer
    seed = ctx('10.1.0.1'); sp = seed.new_page(); sp.goto(SITE + '/admin/setup')
    r = sp.evaluate("""async (pw) => { const a = await fetch('/api/admin/setup', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({password: pw, confirm: pw})}); 
       await fetch('/api/admin/logout', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'});
       const b = await fetch('/api/auth/signup', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({name:'Priya Verma', email:'priya@example.com', password:'Customer123'})}); return [a.status, b.status]; }""", PW)
    ok('seed owner + customer', r == [201, 201], str(r)); seed.close()

    # 1) website: normal login page with username admin
    c = ctx('10.1.0.2'); pg = c.new_page(); pg.on('dialog', lambda d: d.accept())
    pg.goto(SITE + '/login'); pg.wait_for_selector('#login-form')
    ok('login page label says Email (v6: no username)', 'Email or username' not in pg.inner_text('#login-form'))
    pg.fill('#login-email', 'admin'); pg.fill('#login-password', 'wrong-pass-1'); pg.click('#login-form button[type=submit]')
    pg.wait_for_selector('#login-form .form-alert.error'); msg = pg.inner_text('#login-form .form-alert')
    ok('wrong owner password -> generic message', 'Username/email or password is incorrect' in msg, msg)
    # v6: the owner signs in on /admin (laptop) or in the Avermontis Admin app, never on the customer login
    pg.goto(SITE + '/admin'); pg.wait_for_selector('#admin-login'); pg.fill('#password', PW)
    pg.screenshot(path=os.path.join(OUT, 'av5-login-website.png'))
    pg.click('#admin-login button[type=submit]'); pg.wait_for_selector('.adm-tabs', timeout=15000)
    ok('admin opens from /admin (v6)', pg.is_visible('text=Design studio'))
    # 2) design studio
    pg.click('.adm-tabs button[data-tab=design]'); pg.wait_for_selector('#v5-pv'); pg.wait_for_timeout(2500)
    pg.screenshot(path=os.path.join(OUT, 'av5-studio-themes.png'), full_page=False)
    pg.click('[data-preset=fresh_green]'); pg.wait_for_timeout(2500)
    app_ob = pg.frame_locator('#pv-app').locator('html').evaluate("e => getComputedStyle(e).getPropertyValue('--ob').trim()")
    ok('preview: app frame shows the draft (Fresh Green bg)', app_ob.upper() == '#F4FAF5', app_ob)
    site_bg = pg.frame_locator('#pv-site').locator('html').evaluate("e => getComputedStyle(e).getPropertyValue('--bg').trim()")
    ok('preview: website frame shows the draft', site_bg.upper() == '#F4FAF5', site_bg)
    pg.screenshot(path=os.path.join(OUT, 'av5-studio-preset-fresh-green.png'))
    pg.click('[data-v5=colours]'); pg.wait_for_timeout(300)
    pg.fill('.v5-color[data-ck=button_bg] .v5-hex', '#1F5E3B'); pg.fill('.v5-color[data-ck=header_bg] .v5-hex', '#FFFFFF')
    pg.fill('.v5-color[data-ck=footer_bg] .v5-hex', '#EEEEEE'); pg.fill('.v5-color[data-ck=footer_text] .v5-hex', '#DDDDDD'); pg.wait_for_timeout(1500)
    warn = pg.inner_text('#v5-warn')
    ok('contrast warning shown for unreadable footer', 'Footer' in warn, warn[:160])
    pg.fill('.v5-color[data-ck=footer_text] .v5-hex', '#1F2A22'); pg.wait_for_timeout(1200)
    pg.screenshot(path=os.path.join(OUT, 'av5-studio-colours.png'))
    pg.click('[data-v5=fonts]'); pg.select_option('#heading_font', 'rozha'); pg.select_option('#body_font', 'hind'); pg.wait_for_timeout(1500)
    pg.screenshot(path=os.path.join(OUT, 'av5-studio-fonts.png'))
    pg.click('[data-v5=layout]'); pg.wait_for_timeout(300)
    pg.click('[data-seg=grid_mobile] button[data-v="1"]'); pg.click('[data-seg=button_shape] button[data-v=pill]')
    pg.locator('#o-nav li[data-id=diary] label').click(); pg.wait_for_timeout(1500)
    pg.screenshot(path=os.path.join(OUT, 'av5-studio-layout.png'))
    pg.click('[data-v5=extras]'); pg.fill('#announce_text', 'Festive offer: free gift on orders above \u20b9999'); pg.wait_for_timeout(1500)
    ok('publish from the studio', act(pg, '#v5-publish', '/design/publish') == 200)
    pg.click('[data-v5=history]'); pg.wait_for_timeout(300); pg.screenshot(path=os.path.join(OUT, 'av5-studio-history.png'))

    # 3) the live website shows it
    v = ctx('10.1.0.3'); vp = v.new_page(); vp.goto(SITE + '/'); vp.wait_for_load_state('networkidle')
    bg = vp.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()")
    ok('website live: Fresh Green background', bg.upper() == '#F4FAF5', bg)
    ok('website live: announcement text', 'Festive offer' in vp.inner_text('.announce'))
    fam = vp.evaluate("getComputedStyle(document.querySelector('h1')).fontFamily")
    ok('website live: heading font Rozha One', 'Rozha' in fam, fam)
    vp.screenshot(path=os.path.join(OUT, 'av5-home-fresh-green-desktop.png'))
    m = ctx('10.1.0.4', mobile=True); mp = m.new_page(); mp.goto(SITE + '/'); mp.wait_for_load_state('networkidle'); mp.screenshot(path=os.path.join(OUT, 'av5-home-fresh-green-phone.png'))

    # 4) the app runtime (bundled screens on https://localhost + live config from the server)
    a = ctx('10.1.0.5', mobile=True, native=True); ap = a.new_page(); ap.on('dialog', lambda d: d.accept())
    ap.goto('https://localhost/'); ap.wait_for_selector('#tabbar'); ap.wait_for_timeout(2500)
    ap.screenshot(path=os.path.join(OUT, 'av5-app-welcome-fresh-green.png'))
    skip_onboarding(ap)
    ob = ap.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--ob').trim()")
    ok('app runtime: published look applied (no new APK)', ob.upper() == '#F4FAF5', ob)
    hidden = ap.evaluate("getComputedStyle(document.querySelector('#tabbar button[data-go=diary]')).display")
    ok('app runtime: bottom bar item removed by the owner', hidden == 'none', hidden)
    ap.screenshot(path=os.path.join(OUT, 'av5-app-home-fresh-green.png'))
    # customer sign-in still works in the app and does not open admin
    ap.click('#tabbar button[data-go=me]'); ap.wait_for_timeout(800)
    ap.click('[data-auth=login]'); ap.wait_for_selector('#a-form'); ap.wait_for_timeout(400)
    ok('app: sign-in sheet takes email (v6: no username)', 'Email or username' not in ap.inner_text('#a-form'))
    ap.fill('#a-email', 'admin'); ap.fill('#a-pw', PW); ap.screenshot(path=os.path.join(OUT, 'av5-login-app.png'))
    ap.click('#a-go'); ap.wait_for_selector('#a-alert .alert', timeout=15000)
    ok('app (v6): admin is refused with the generic message, stays in the app', 'incorrect' in ap.inner_text('#a-alert') and ap.url.startswith('https://localhost'), ap.url)
    ok('app: no owner token stored on the phone', ap.evaluate("Object.keys(localStorage).filter(k => /admin|owner/i.test(k)).length") == 0)
    ap.screenshot(path=os.path.join(OUT, 'av5-app-admin-refused.png'))

    # 5) Dark Luxe via preset + publish, then Undo, then restore, reset
    pg.click('[data-v5=presets]'); pg.click('[data-preset=dark_luxe]'); pg.wait_for_timeout(800); stt = act(pg, '#v5-publish', '/design/publish');
    vp.reload(); vp.wait_for_load_state('networkidle')
    ok('website: Dark Luxe live', 'dark' in vp.evaluate("getComputedStyle(document.body).colorScheme"), vp.evaluate("getComputedStyle(document.body).colorScheme"))
    vp.screenshot(path=os.path.join(OUT, 'av5-home-dark-luxe-desktop.png'))
    a2 = ctx('10.1.0.6', mobile=True, native=True); ap2 = a2.new_page(); ap2.goto('https://localhost/'); ap2.wait_for_selector('#tabbar'); ap2.wait_for_timeout(2500)
    skip_onboarding(ap2)
    ap2.screenshot(path=os.path.join(OUT, 'av5-app-home-dark-luxe.png'))
    act(pg, '#v5-undo', '/design/undo')
    vp.reload(); vp.wait_for_load_state('networkidle')
    ok('undo: Fresh Green back', vp.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()").upper() == '#F4FAF5')
    pg.click('[data-v5=presets]'); pg.click('[data-preset=rose_blush]'); pg.wait_for_timeout(500); act(pg, '#v5-publish', '/design/publish')
    m.close(); m = ctx('10.1.0.7', mobile=True); mp = m.new_page(); mp.goto(SITE + '/'); mp.wait_for_load_state('networkidle'); mp.screenshot(path=os.path.join(OUT, 'av5-home-rose-phone.png'))
    pg.click('[data-v5=history]'); pg.wait_for_timeout(300)
    btns = pg.locator('[data-restore]'); n = btns.count(); ok('history lists versions', n >= 3, str(n))
    with pg.expect_response(lambda r: '/restore' in r.url, timeout=20000) as info: btns.nth(0).click()
    pg.wait_for_timeout(1200); vp.reload(); vp.wait_for_load_state('networkidle')
    ok('restore an older version (Fresh Green again)', info.value.status == 200 and vp.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()").upper() == '#F4FAF5')
    act(pg, '#v5-reset', '/design/reset')
    vp.reload(); vp.wait_for_load_state('networkidle')
    ok('reset to default: no theme CSS', vp.evaluate("!document.getElementById('avm-theme')"))
    # audit log + security tabs
    pg.click('.adm-tabs button[data-tab=audit]'); pg.wait_for_selector('text=Audit log'); pg.wait_for_timeout(500)
    ok('audit log lists design changes', pg.locator('td', has_text='Design').count() >= 3)
    pg.screenshot(path=os.path.join(OUT, 'av5-audit.png'))
    pg.click('.adm-tabs button[data-tab=security]'); pg.wait_for_selector('text=Owner PIN'); pg.wait_for_timeout(500)
    pg.screenshot(path=os.path.join(OUT, 'av5-security.png'), full_page=True)

    # 6) lockout + customer cannot reach admin
    L = ctx('10.1.0.66'); lp = L.new_page(); lp.goto(SITE + '/admin'); lp.wait_for_selector('#admin-login')
    for i in range(5):
        lp.fill('#password', 'nope-%d' % i); lp.click('#admin-login button[type=submit]'); lp.wait_for_timeout(600)
    lp.fill('#password', PW); lp.click('#admin-login button[type=submit]'); lp.wait_for_timeout(900)
    t = lp.inner_text('#admin-login'); ok('lockout after 5 wrong tries (even with the right password)', 'locked for 15 minutes' in t, t[-160:])
    C = ctx('10.1.0.8'); cp = C.new_page(); cp.goto(SITE + '/login'); cp.fill('#login-email', 'priya@example.com'); cp.fill('#login-password', 'Customer123'); cp.click('#login-form button[type=submit]')
    cp.wait_for_url(re.compile(r'/account'), timeout=15000); ok('customer login still works', '/account' in cp.url)
    cp.goto(SITE + '/admin'); cp.wait_for_selector('#admin-login'); ok('customer cannot open admin', cp.is_visible('#admin-login'))
    st = cp.evaluate("fetch('/api/admin/design').then(r => r.status)"); ok('customer gets 403 on owner API', st == 403, str(st))
    br.close()
fails = [r for r in results if not r[1]]
print('\nE2E: %d passed, %d failed' % (len(results) - len(fails), len(fails)))
json.dump([{'name': n, 'ok': o, 'extra': e} for n, o, e in results], open(os.path.join(OUT, 'e2e-results.json'), 'w'), indent=1)
sys.exit(1 if fails else 0)
