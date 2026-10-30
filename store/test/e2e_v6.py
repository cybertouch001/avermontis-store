# Headless end-to-end test for AVERMONTIS v6 against tools/e2e-server.mjs: the customer website + customer app runtime
# no longer open the owner area; the new Avermontis Admin app (/admin/app) does everything the v5 owner area did.
# Run: node tools/e2e-server.mjs &   then   python3 test/e2e_v6.py <screenshot_dir>
import sys, os, json, re, mimetypes, time
from playwright.sync_api import sync_playwright, expect
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/av6-shots'
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


# the Admin app shell: a stand-in for the native AvmAdmin plugin records what the page asks the phone to do
ADMIN_STUB = """if (location.hostname === 'avermontis.sites.tab.bot') { window.__calls = []; var rec = function(n){ return function(a){ window.__calls.push([n, a || null]); return Promise.resolve(n === 'unlock' ? {ok: true} : n === 'lockAvailable' ? {available: true} : {ok: true}); }; };
  window.Capacitor = { isNativePlatform: function(){ return true; }, getPlatform: function(){ return 'android'; }, Plugins: { AvmAdmin: { vibrate: rec('vibrate'), notify: rec('notify'), requestNotify: rec('requestNotify'), unlock: rec('unlock'), lockAvailable: rec('lockAvailable'), startWatch: rec('startWatch'), stopWatch: rec('stopWatch'), setSeen: rec('setSeen'), share: rec('share'), printPage: rec('printPage') } } }; }"""
GENERIC = 'Username/email or password is incorrect'
with sync_playwright() as pw:
    br = pw.chromium.launch()
    def ctx(ip, mobile=False, native=False, dark=False, admin_app=False):
        c = br.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1366, 'height': 900}, device_scale_factor=2 if mobile else 1, is_mobile=mobile, has_touch=mobile, color_scheme='dark' if dark else 'light', service_workers='block',
                           user_agent=('Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36' + (' AvermontisAdmin/6.0.0' if admin_app else '') if mobile else None))
        c.route(SITE + '/**', proxy(ip))
        if native: c.route('https://localhost/**', serve_www); c.add_init_script(CAP_STUB)
        if admin_app: c.add_init_script(ADMIN_STUB)
        return c
    seed = ctx('10.2.0.1'); sp = seed.new_page(); sp.goto(SITE + '/admin/setup')
    r = sp.evaluate("""async (pw) => { const a = await fetch('/api/admin/setup', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({password: pw, confirm: pw})});
       await fetch('/api/admin/logout', {method:'POST', headers:{'content-type':'application/json'}, body:'{}'});
       const b = await fetch('/api/auth/signup', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({name:'Priya Verma', email:'priya@example.com', password:'Customer123'})});
       const o = []; for (const [n, ph, q] of [['Kavya Rao','9812345678',1],['Arjun Mehta','9898012345',2],['Sana Khan','9876501234',1]]) { const x = await fetch('/api/orders', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({items:[{id:'vitamin-c-serum', qty:q}], customer:{name:n, phone:ph, email:n.split(' ')[0].toLowerCase()+'@example.com', address:'12 MG Road', city:'Varanasi', state:'Uttar Pradesh', pincode:'221005'}, payment:'cod'})}); o.push(x.status); }
       return [a.status, b.status].concat(o); }""", PW)
    ok('seed owner + customer + 3 test orders', r == [201, 201, 201, 201, 201], str(r)); seed.close()

    # 1) website login: "admin" is just a wrong login now
    c = ctx('10.2.0.2'); pg = c.new_page()
    pg.goto(SITE + '/login'); pg.wait_for_selector('#login-form')
    ok('website login label says Email (no username)', 'Email' in pg.inner_text('#login-form') and 'username' not in pg.inner_text('#login-form').lower())
    pg.fill('#login-email', 'admin'); pg.fill('#login-password', PW); pg.click('#login-form button[type=submit]')
    pg.wait_for_selector('#login-form .form-alert.error', timeout=15000); msg = pg.inner_text('#login-form .form-alert'); pg.wait_for_timeout(800)
    ok('website: admin + the REAL owner password -> same generic error, stays on /login', GENERIC in msg and pg.url.endswith('/login') and not pg.context.cookies() or all(k['name'] != 'av_admin' for k in pg.context.cookies()), msg + ' ' + pg.url)
    pg.fill('#login-email', 'nobody'); pg.fill('#login-password', 'x1234567'); pg.click('#login-form button[type=submit]'); pg.wait_for_timeout(1200)
    ok('website: any other non-email gets the identical message', GENERIC in pg.inner_text('#login-form .form-alert'))
    pg.screenshot(path=os.path.join(OUT, 'av6-website-login-admin-refused.png'))
    C2 = ctx('10.2.0.8'); cp = C2.new_page(); cp.goto(SITE + '/login'); cp.fill('#login-email', 'priya@example.com'); cp.fill('#login-password', 'Customer123'); cp.click('#login-form button[type=submit]')
    cp.wait_for_url(re.compile(r'/account'), timeout=15000); ok('website: customer login still works', '/account' in cp.url)
    st = cp.evaluate("fetch('/api/admin/design').then(r => r.status)"); ok('customer gets 403 on owner API', st == 403, str(st))

    # 2) customer app runtime (bundled screens on https://localhost)
    a = ctx('10.2.0.5', mobile=True, native=True); ap = a.new_page(); ap.on('dialog', lambda d: d.accept())
    ap.goto('https://localhost/'); ap.wait_for_selector('#tabbar'); ap.wait_for_timeout(2000); skip_onboarding(ap)
    ap.click('#tabbar button[data-go=me]'); ap.wait_for_timeout(900)
    me = ap.inner_text('#screen') if ap.query_selector('#screen') else ap.inner_text('body')
    ok('app Me screen: no "Store owner?" entry and no owner link', 'Store owner' not in me and ap.query_selector('[data-act=owner]') is None and ap.query_selector('a[href*="/admin"]') is None)
    ap.click('[data-auth=login]'); ap.wait_for_selector('#a-form', timeout=8000); ap.wait_for_timeout(400)
    ok('app sign-in sheet says Email (no username)', 'Email or username' not in ap.inner_text('#a-form'))
    ap.fill('#a-email', 'admin'); ap.fill('#a-pw', PW)
    with ap.expect_response(lambda r: '/api/auth/login' in r.url and r.request.method == 'POST', timeout=15000) as info: ap.click('#a-go')
    ap.wait_for_selector('#a-alert .alert', timeout=10000); ap.wait_for_timeout(500)
    amsg = ap.inner_text('#a-alert')
    ok('app: admin + the REAL owner password -> generic error, no owner area', info.value.status == 401 and GENERIC in amsg and ap.url.startswith('https://localhost'), str(info.value.status) + ' ' + amsg + ' ' + ap.url)
    ap.screenshot(path=os.path.join(OUT, 'av6-customer-app-login.png'))
    codes = ap.evaluate("""async () => { const o = {}; for (const [m, p, b] of [['POST','/api/admin/login',{username:'admin',password:'x'}],['GET','/api/admin/me'],['GET','/api/admin/app/summary'],['POST','/api/admin/handoff',{code:'abc'}]]) { const r = await fetch('https://avermontis.sites.tab.bot' + p, {method:m, headers:{'content-type':'application/json'}, body: b ? JSON.stringify(b) : undefined}); o[p] = r.status; } return o; }""")
    ok('app origin: every owner API refused (403)', all(v == 403 for v in codes.values()), json.dumps(codes))
    app_js = open(os.path.join(WWW, 'assets', 'm', 'app.js'), encoding='utf-8').read()
    ok('bundled app.js has no owner sign-in / admin link', not re.search(r"admin/handoff|ownerSignedIn|data-act=\"owner\"|admin-pin", app_js))
    cfgj = json.load(open(os.path.join(HERE, '..', '..', 'app', 'capacitor.config.json')))
    ok('app config: the store site is no longer an in-app navigation target', 'allowNavigation' not in cfgj.get('server', {}), json.dumps(cfgj.get('server')))

    # 3) Admin app (/admin/app) - phone, with the native plugin stand-in
    A = ctx('10.2.0.20', mobile=True, admin_app=True); aa = A.new_page(); dialogs = []
    aa.on('dialog', lambda d: (dialogs.append(d.message), d.accept('3')))
    aa.goto(SITE + '/admin/app'); aa.wait_for_selector('#login-f', timeout=15000)
    ok('admin app opens on its own sign-in screen (username + password)', aa.is_visible('#u') and aa.is_visible('#p'))
    aa.fill('#u', 'manager'); aa.fill('#p', PW); aa.click('#go'); aa.wait_for_selector('#al .alert'); m1 = aa.inner_text('#al')
    ok('admin app: wrong username -> generic error', GENERIC in m1, m1)
    aa.fill('#u', 'admin'); aa.fill('#p', 'not-the-password-1'); aa.click('#go'); aa.wait_for_timeout(1500); m2 = aa.inner_text('#al')
    ok('admin app: wrong password -> generic error', GENERIC in m2, m2)
    aa.fill('#u', 'admin'); aa.fill('#p', ''); aa.screenshot(path=os.path.join(OUT, 'av6-admin-app-login.png'))
    aa.fill('#p', PW); aa.click('#go'); aa.wait_for_selector('.kpi.big', timeout=15000); aa.wait_for_timeout(1500)
    k = aa.inner_text('.kpi.big'); summ = aa.evaluate("fetch('/api/admin/app/summary?days=7').then(r => r.json())")['summary']
    ok('admin app: signs in with username admin + the existing owner password -> dashboard', 'Today' in k, k.replace('\n', ' | '))
    ok('dashboard numbers = live store data (today revenue, new orders)', ('\u20b9' + format(summ['today']['revenue'], ',')) in k.replace('\u20b9', '\u20b9') or str(summ['today']['revenue']) in k.replace(',', ''), k.replace('\n', ' ') + ' vs ' + str(summ['today']))
    ok('dashboard: 7-day chart drawn', aa.locator('svg.chart rect.bar').count() == 7)
    aa.click('#days button[data-d="30"]'); aa.wait_for_timeout(1500); ok('dashboard: 30-day chart', aa.locator('svg.chart rect.bar').count() == 30)
    aa.screenshot(path=os.path.join(OUT, 'av6-admin-dashboard.png'), full_page=False)
    aa.screenshot(path=os.path.join(OUT, 'av6-admin-dashboard-full.png'), full_page=True)
    # orders: search, filter, quick status, call / WhatsApp links
    aa.click('.nav button[data-tab=orders]'); aa.wait_for_selector('.order', timeout=10000); aa.wait_for_timeout(600)
    ok('orders list shows the 3 orders', aa.locator('.order').count() >= 3, str(aa.locator('.order').count()))
    aa.fill('#q', 'arjun'); aa.wait_for_timeout(1500)
    ok('order search by name', aa.locator('.order').count() == 1 and 'Arjun' in aa.inner_text('.order'))
    aa.click('.order .hd'); aa.wait_for_timeout(400)
    tel = aa.get_attribute('.order a[href^="tel:"]', 'href'); wa = aa.get_attribute('.order a[href*="wa.me"]', 'href')
    ok('call + WhatsApp links for the customer', tel == 'tel:+919898012345' and wa.startswith('https://wa.me/919898012345?text='), str(tel) + ' ' + str(wa))
    aa.screenshot(path=os.path.join(OUT, 'av6-admin-orders.png'))
    with aa.expect_response(lambda r: '/api/admin/orders/' in r.url and r.request.method == 'PATCH', timeout=15000) as info: aa.click('.order [data-st=confirmed]')
    aa.wait_for_timeout(1500)
    ok('one tap: New -> Confirmed (packed)', info.value.status == 200 and 'Confirmed' in aa.inner_text('.order'), aa.inner_text('.order .hd'))
    with aa.expect_response(lambda r: '/api/admin/orders/' in r.url and r.request.method == 'PATCH', timeout=15000) as info: aa.click('.order [data-st=shipped]')
    aa.wait_for_timeout(1200); ok('one tap: Confirmed -> Shipped', info.value.status == 200 and 'Shipped' in aa.inner_text('.order'))
    aa.fill('#q', ''); aa.wait_for_timeout(1200); aa.click('#chips .chip[data-s=shipped]'); aa.wait_for_timeout(1200)
    ok('status filter: Shipped shows only that order', aa.locator('.order').count() == 1)
    aa.click('#chips .chip[data-s=""]'); aa.wait_for_timeout(1200)
    sharebtn = aa.query_selector('.order [data-share]')
    if sharebtn:
        aa.click('.order .hd'); aa.wait_for_timeout(300); aa.locator('.order').first.locator('[data-share]').click(); aa.wait_for_timeout(500)
        ok('share invoice -> Android share sheet (native call)', any(c0[0] == 'share' and '/invoice/' in (c0[1] or {}).get('text', '') for c0 in aa.evaluate('window.__calls')))
    csv = aa.evaluate("fetch('/api/admin/export/orders.csv').then(async r => [r.status, r.headers.get('content-disposition'), (await r.text()).split('\\n').length])")
    ok('orders CSV export works for the owner', csv[0] == 200 and 'attachment' in (csv[1] or '') and csv[2] >= 4, str(csv))
    # stock
    aa.click('.nav button[data-tab=stock]'); aa.wait_for_selector('#sl .it', timeout=10000); aa.wait_for_timeout(500)
    first = aa.locator('#sl .it').first; before = int(first.locator('b.n').inner_text())
    with aa.expect_response(lambda r: '/quick' in r.url, timeout=15000) as info: first.locator('[data-d="1"]').click()
    aa.wait_for_timeout(800); after = int(first.locator('b.n').inner_text())
    ok('stock +1 saved to the store', info.value.status == 200 and after == before + 1, '%d -> %d' % (before, after))
    with aa.expect_response(lambda r: '/quick' in r.url, timeout=15000) as info: first.locator('[data-set]').click()
    aa.wait_for_timeout(800); ok('stock "Set" to 3 (low-stock warning)', first.locator('b.n').inner_text() == '3' and 'low' in (first.get_attribute('class') or ''))
    aa.screenshot(path=os.path.join(OUT, 'av6-admin-stock.png'))
    # new-order alert while open
    aa.click('.nav button[data-tab=home]'); aa.wait_for_timeout(1500)
    n0 = len([x for x in aa.evaluate('window.__calls') if x[0] == 'notify'])
    s2 = ctx('10.2.0.30'); s2p = s2.new_page(); s2p.goto(SITE + '/shop')
    newst = s2p.evaluate("""fetch('/api/orders', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({items:[{id:'vitamin-c-serum', qty:1}], customer:{name:'Neha Gupta', phone:'9123456780', email:'neha@example.com', address:'12 MG Road', city:'Varanasi', state:'Uttar Pradesh', pincode:'221005'}, payment:'cod'})}).then(async r => [r.status, await r.text()])"""); s2.close(); print('new order status', newst, flush=True)
    aa.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); aa.wait_for_timeout(2500)
    calls = aa.evaluate('window.__calls'); n1 = len([x for x in calls if x[0] == 'notify'])
    ok('new order -> phone notification + badge (checked every minute and on resume)', n1 == n0 + 1 and aa.inner_text('#dot').strip() != '', str([x for x in calls if x[0] == 'notify'][-1:]))
    pulse_touch = aa.evaluate("fetch('/api/admin/app/pulse').then(r => r.status)"); ok('pulse answers for the owner', pulse_touch == 200)
    # more: every v5 area + settings
    aa.click('.nav button[data-tab=more]'); aa.wait_for_timeout(600)
    hrefs = aa.eval_on_selector_all('.more a', 'els => els.map(e => e.getAttribute("href"))')
    need = ['design', 'customize', 'products', 'customers', 'coupons', 'reviews', 'messages', 'assistant', 'bargains', 'notify', 'ar', 'overview', 'subscribers', 'logins', 'security', 'audit', 'backup', 'settings']
    ok('More lists every v5 owner area (18)', all(('/admin?app=1#' + n) in hrefs for n in need), str(len(hrefs)))
    aa.click('label.sw:has(#lk)'); aa.wait_for_timeout(800)
    ok('app lock uses the phone fingerprint / screen lock (native)', any(x[0] == 'unlock' for x in aa.evaluate('window.__calls')) and aa.evaluate("localStorage.getItem('avmA.lock')") == '"device"')
    with aa.expect_response(lambda r: '/api/admin/app/alert-key' in r.url, timeout=15000) as info: aa.click('label.sw:has(#bg)')
    aa.wait_for_timeout(800); sw_ = [x for x in aa.evaluate('window.__calls') if x[0] == 'startWatch']
    ok('background alert: read-only key made and handed to the phone', info.value.status == 200 and sw_ and sw_[-1][1]['url'].endswith('/api/admin/app/peek'), str(sw_[-1:])[:160])
    aa.click('#th button[data-t=dark]'); aa.wait_for_timeout(500)
    ok('dark mode switch', aa.evaluate("document.documentElement.getAttribute('data-theme')") == 'dark')
    aa.screenshot(path=os.path.join(OUT, 'av6-admin-more-dark.png'), full_page=True)
    aa.click('.nav button[data-tab=home]'); aa.wait_for_timeout(1800); aa.screenshot(path=os.path.join(OUT, 'av6-admin-dashboard-dark.png'))
    aa.click('#th') if aa.query_selector('#th') else None
    aa.evaluate("localStorage.setItem('avmA.theme', JSON.stringify('light'))")
    # every v5 area opens inside the admin app with a way back
    bad = []
    for n in need:
        aa.goto(SITE + '/admin?app=1#' + n); 
        try:
            aa.wait_for_selector('#panel', timeout=10000); aa.wait_for_timeout(900)
            txt = aa.inner_text('#panel')
            if 'Owner access only' in txt or 'Something went wrong' in txt or not aa.is_visible('#back-to-app'): bad.append(n)
        except Exception as e: bad.append(n + ':' + str(e)[:40])
    ok('all 18 v5 owner areas load inside the admin app (with "Admin home")', not bad, str(bad))
    aa.goto(SITE + '/admin?app=1#design'); aa.wait_for_selector('#v5-pv', timeout=15000); aa.wait_for_timeout(3000)
    ok('design studio inside the admin app', aa.is_visible('#back-to-app') and 'admin home' in aa.inner_text('#back-to-app').lower(), aa.inner_text('#back-to-app') if aa.query_selector('#back-to-app') else 'no back button')
    aa.screenshot(path=os.path.join(OUT, 'av6-admin-design-studio.png'))
    # design publish from the phone reaches the live site (v5 feature kept)
    aa.click('[data-preset=fresh_green]'); aa.wait_for_timeout(1200)
    st_pub = act(aa, '#v5-publish', '/design/publish'); ok('publish a theme from the admin app', st_pub == 200, str(st_pub))
    v = ctx('10.2.0.3'); vp = v.new_page(); vp.goto(SITE + '/'); vp.wait_for_load_state('networkidle')
    ok('website live shows the new theme', vp.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()").upper() == '#F4FAF5')
    act(aa, '#v5-reset', '/design/reset')
    aa.goto(SITE + '/admin?app=1#audit'); aa.wait_for_selector('text=Audit log'); aa.wait_for_timeout(600)
    aud = aa.evaluate("fetch('/api/admin/audit').then(r => r.json())"); areas = set(x.get('area') for x in (aud.get('entries') or aud.get('audit') or aud.get('items') or []))
    ok('audit log records admin-app actions (orders, stock, alerts, design)', {'Orders', 'Products', 'Admin app', 'Design'} <= areas, str(areas) + ' ' + str(list(aud.keys())))
    aa.click('#back-to-app'); aa.wait_for_selector('.kpi.big', timeout=10000); ok('"Admin home" returns to the app dashboard', '/admin/app' in aa.url)
    # PIN step (optional second factor) in the admin app
    r = aa.evaluate("(pw) => fetch('/api/admin/security', {method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify({pin_enabled:true, pin:'4826', current_password: pw})}).then(r => r.status)", PW)
    B = ctx('10.2.0.21', mobile=True, admin_app=True); bb = B.new_page(); bb.goto(SITE + '/admin/app'); bb.wait_for_selector('#login-f')
    bb.fill('#u', 'admin'); bb.fill('#p', PW); bb.click('#go'); bb.wait_for_selector('#pin-f', timeout=10000)
    bb.fill('#pin', '4826'); bb.click('#go'); bb.wait_for_selector('.kpi.big', timeout=10000)
    ok('owner PIN (if on) asked after the password in the admin app', r == 200 and bb.is_visible('.kpi.big'))
    aa.evaluate("(pw) => fetch('/api/admin/security', {method:'PUT', headers:{'content-type':'application/json'}, body: JSON.stringify({pin_enabled:false, current_password: pw})})", PW)
    # lockout: 5 wrong tries on the admin app screen
    L = ctx('10.2.0.66', mobile=True, admin_app=True); lp = L.new_page(); lp.goto(SITE + '/admin/app'); lp.wait_for_selector('#login-f')
    for i in range(5):
        lp.fill('#u', 'admin'); lp.fill('#p', 'nope-%d' % i); lp.click('#go'); lp.wait_for_timeout(700)
    lp.fill('#u', 'admin'); lp.fill('#p', PW); lp.click('#go'); lp.wait_for_timeout(1200)
    t = lp.inner_text('#al'); ok('admin app: locked for 15 min after 5 wrong tries (even with the right password)', 'locked for 15 minutes' in t, t)
    # laptop: /admin still works in a normal browser
    D = ctx('10.2.0.40'); dp = D.new_page(); dp.goto(SITE + '/admin'); dp.wait_for_selector('#admin-login'); dp.fill('#password', PW)
    dp.click('#admin-login button[type=submit]'); dp.wait_for_selector('.adm-tabs', timeout=15000)
    ok('laptop: /admin in a normal browser still works (password)', dp.is_visible('text=Design studio') and not dp.query_selector('#back-to-app'))
    # unlisted admin download page
    g = ctx('10.2.0.50'); gp = g.new_page(); resp = gp.goto(SITE + '/download/admin')
    ok('admin download page: noindex', 'noindex' in (resp.headers.get('x-robots-tag') or '') and gp.locator('meta[name=robots][content*=noindex]').count() == 1)
    gp.goto(SITE + '/download'); ok('public /download does not link the admin app', 'admin' not in gp.content().lower().replace('/admin/', 'x') or '/download/admin' not in gp.content())
    br.close()
fails = [r for r in results if not r[1]]
print('\nE2E v6: %d passed, %d failed' % (len(results) - len(fails), len(fails)))
json.dump([{'name': n, 'ok': o, 'extra': e} for n, o, e in results], open(os.path.join(OUT, 'e2e-v6-results.json'), 'w'), indent=1)
sys.exit(1 if fails else 0)
