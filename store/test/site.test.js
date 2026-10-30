const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const SITE = path.join(__dirname, '..', 'site');
const pages = ['index.html','shop.html','collections.html','concerns.html','ingredients.html','shop/serums.html','shop/moisturisers.html','shop/cleansers.html','shop/sunscreens.html','shop/eye-care.html','collections/morning-ritual.html','collections/evening-ritual.html','collections/serum-edit.html','product.html','about.html','cart.html','checkout.html','order-success.html','blog.html','guide-routine.html','guide-sunscreen.html','guide-serums.html','faq.html','contact.html','privacy.html','terms.html','shipping.html','returns.html','design.html','404.html','login.html','signup.html','account.html','forgot.html','reset.html','track.html','admin.html','admin/setup.html'];
const read = (f) => fs.readFileSync(path.join(SITE, f.endsWith('.html') ? path.join('_pages', f) : f), 'utf8');
function loadProducts() {
  const txt = read('products.js');
  const s = txt.indexOf('[', txt.indexOf('AVERMONTIS_PRODUCTS'));
  return JSON.parse(txt.slice(s, txt.lastIndexOf(']') + 1));
}

test('every page exists with title, viewport, brand and footer policy links', () => {
  for (const p of pages) {
    const h = read(p);
    assert.match(h, /<title>[^<]{5,}<\/title>/, p + ' title');
    assert.match(h, /name="viewport" content="width=device-width, initial-scale=1/, p + ' viewport');
    if (!p.startsWith('admin')) assert.ok(h.includes('href="/privacy"') && h.includes('href="/terms"') && h.includes('href="/shipping"'), p + ' footer policy links');
    assert.ok(!/Avermentis|Avermonits|Avremontis|Avermontes/i.test(h), p + ' misspelling');
    assert.ok(!/TODO|lorem ipsum|\{\{/i.test(h), p + ' placeholder');
    assert.ok(!/<script>(?!<)/.test(h) && !/\son(click|load|submit)=/.test(h), p + ' no inline scripts');
  }
});

test('all local references resolve', () => {
  for (const p of pages) {
    const h = read(p);
    for (const m of h.matchAll(/(?:href|src)="([^"#?:]+)(?:[?#][^"]*)?"/g)) {
      const ref = m[1];
      if (ref.startsWith('mailto') || ref.startsWith('http')) continue;
      if (ref.startsWith('/api/') || ref.startsWith('/invoice/')) continue;
      let target = ref.replace(/^\//, '');
      if (target === '') target = 'index.html';
      if (/^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(target) && !fs.existsSync(path.join(SITE, target))) target += '.html';
      assert.ok(fs.existsSync(path.join(SITE, target.endsWith('.html') ? path.join('_pages', target) : target)), p + ' -> ' + ref);
    }
  }
});

test('products file is valid, priced in INR and images exist', () => {
  const ps = loadProducts();
  assert.ok(ps.length >= 4 && ps.length <= 6);
  const ids = new Set();
  for (const p of ps) {
    assert.ok(!ids.has(p.id)); ids.add(p.id);
    assert.ok(Number.isInteger(p.price) && p.price > 0);
    assert.ok(fs.existsSync(path.join(SITE, p.image)), p.image);
    assert.ok(Array.isArray(p.ingredients) && p.ingredients.length);
  }
});

test('contact email present, no phone number, no secret keys', () => {
  const all = pages.map(read).join('\n') + read('assets/app.js') + read('_worker.js') + read('products.js');
  assert.ok(read('contact.html').includes('avermontis@mail.tab.bot'));
  assert.ok(!pages.map(read).join('\n').includes('@gmail.com'), 'no owner personal name/email on pages');
  assert.ok(!/rzp_(live|test)_|sk_live|xkeysib-|\bre_[A-Za-z0-9]{16,}|(secret|api)_?key\s*[:=]\s*['"][A-Za-z0-9_-]{16,}/i.test(all), 'no secret values in code');
  assert.ok(!/(\+91[\s-]?)?[6-9]\d{9}\b/.test(pages.map(read).join('\n')), 'no phone number on pages');
  assert.ok(read('product.html') || true);
  assert.ok(read('assets/app.js').includes('No reviews yet'));
  assert.ok(read('checkout.html').includes('Coming soon'));
});

test('server re-prices orders and ignores browser prices', async () => {
  const tmp = path.join(require('node:os').tmpdir(), 'avermontis-worker-test.mjs');
  fs.copyFileSync(path.join(SITE, '_worker.js'), tmp);
  const mod = await import(tmp);
  const ps = loadProducts();
  const settings = { free_shipping_from: 499, shipping_fee: 49, max_qty_per_item: 10 };
  const ok = mod.priceOrder([{ id: ps[0].id, qty: 2, price: 1 }], ps, settings);
  assert.strictEqual(ok.subtotal, ps[0].price * 2);
  const cheap = ps.slice().sort((a, b) => a.price - b.price)[0];
  if (cheap.price < 499) assert.strictEqual(mod.priceOrder([{ id: cheap.id, qty: 1 }], ps, settings).shipping, 49);
  assert.ok(mod.priceOrder([{ id: 'fake', qty: 1 }], ps, settings).error);
  assert.ok(mod.priceOrder([{ id: ps[0].id, qty: -3 }], ps, settings).error);
  assert.ok(mod.priceOrder([{ id: ps[0].id, qty: 1.5 }], ps, settings).error);
  assert.ok(mod.priceOrder([{ id: ps[0].id, qty: 6 }, { id: ps[0].id, qty: 6 }], ps, settings).error);
  assert.ok(mod.priceOrder([], ps, settings).error);
  const v = mod.validateCustomer({ name: 'A', phone: '123', address: 'x', pincode: '012345', city: '', state: 'Nowhere' });
  assert.deepStrictEqual(Object.keys(v.errors).sort(), ['address', 'city', 'name', 'phone', 'pincode', 'state']);
  const good = mod.validateCustomer({ name: 'Test Buyer', phone: '+91 98765 43210', address: '12 MG Road, Sector 4', pincode: '110001', city: 'Delhi', state: 'Delhi' });
  assert.deepStrictEqual(good.errors, {});
  assert.strictEqual(good.customer.phone, '9876543210');
});

test('luxury redesign: hero copy, story, collection, closing CTA, palette, journal', () => {
  const idx = read('index.html');
  // v3 (Oct 2026): La Mer style campaign hero replaced the v2 split hero; story, collection and closing remain
  assert.ok(idx.includes('class="hero-v3"') && idx.includes('Timeless care') && idx.includes('Shop the serum'), 'hero copy');
  assert.ok(idx.includes('src="/img/campaign-wide.webp"') && idx.includes('srcset="/img/campaign-tall.webp"') && idx.includes('fetchpriority="high"'), 'campaign hero image');
  assert.ok(idx.includes('Pure Science.') && idx.includes('id="featured"') && idx.includes('Your Skincare Ritual'), 'story, collection, closing');
  assert.ok(!/clinically|dermatologist|cruelty|sustainab/i.test(idx), 'no unverifiable claims');
  assert.ok(/class="home"/.test(idx), 'home body class for transparent header');
  const css = read('assets/styles.css');
  for (const c of ['#0B0C0B', '#C6A16A', '#F5F0E7', '#D8C9B5', '#252522']) assert.ok(css.includes(c), 'palette ' + c);
  assert.ok(!/#3ccf8e|#1c9a69|#25d366/i.test(css), 'green removed');
  assert.ok(css.includes('prefers-reduced-motion'), 'reduced motion');
  assert.ok(read('blog.html').includes('class="journal"'), 'journal listing');
  const app = read('assets/app.js');
  assert.ok(app.includes('Add to Bag') && app.includes('pd-sticky'), 'add to bag + sticky bar');
  for (const f of ['hero', 'story', 'vitamin-c-serum', 'niacinamide-serum', 'hydrating-face-wash', 'daily-moisturizer', 'sunscreen-spf50']) assert.ok(fs.existsSync(path.join(SITE, 'img', f + '.webp')), f);
});


test('v3: category + collection navigation, coming-soon category, no fake labels', () => {
  const idx = read('index.html');
  for (const h of ['/shop/serums', '/shop/moisturisers', '/shop/cleansers', '/shop/sunscreens', '/shop/eye-care', '/collections', '/concerns', '/ingredients']) assert.ok(idx.includes('href="' + h + '"'), 'nav/home link ' + h);
  assert.ok(idx.includes('class="has-sub"') && idx.includes('class="sub"'), 'Shop dropdown');
  for (const s of ['serums', 'moisturisers', 'cleansers', 'sunscreens', 'eye-care']) assert.ok(read('shop/' + s + '.html').includes('id="cat-grid" data-cat="' + s + '"'), s);
  for (const s of ['morning-ritual', 'evening-ritual', 'serum-edit']) assert.ok(read('collections/' + s + '.html').includes('data-collection="' + s + '"'), s);
  const app = read('assets/app.js');
  assert.ok(app.includes("slug:'eye-care'") && app.includes('Coming soon'), 'eye care shows coming soon from data, not fake products');
  const ids = new Set(loadProducts().map((p) => p.id));
  for (const m of app.matchAll(/ids:\[([^\]]*)\]/g)) for (const id of m[1].match(/'([^']+)'/g).map((x) => x.slice(1, -1))) assert.ok(ids.has(id), 'collection/concern product exists: ' + id);
  for (const m of app.matchAll(/id:'([a-z0-9-]+)'/g)) assert.ok(ids.has(m[1]), 'routine product exists: ' + m[1]);
  assert.ok(/Bestseller\|New/.test(app) && !loadProducts().some((p) => p.label), 'labels only when the data carries one (none today)');
  const sw = read('_worker.js');
  for (const h of ['/shop/serums', '/collections', '/concerns', '/ingredients']) assert.ok(sw.includes("'" + h + "'"), 'sitemap ' + h);
});

test('v3: shop by concern + 4-question skin finder recommend only real products', () => {
  const c = read('concerns.html');
  assert.ok(c.includes('id="finder"') && c.includes('id="finder-root"'), 'finder');
  for (const s of ['dullness', 'dark-spots', 'uneven-tone', 'dehydration']) assert.ok(c.includes('id="' + s + '"') && c.includes('data-concern="' + s + '"'), s);
  assert.ok(/not a diagnosis/.test(c), 'disclaimer');
  const app = read('assets/app.js');
  const quiz = app.slice(app.indexOf('var QUIZ'), app.indexOf('function finderPlan'));
  assert.strictEqual((quiz.match(/\{k:'/g) || []).length, 4, 'four questions');
});

test('v3: ingredients page only lists ingredients that are in the products; product page hierarchy', () => {
  const app = read('assets/app.js');
  const ingBlock = app.slice(app.indexOf('var INGREDIENTS'), app.indexOf('var ROUTINE'));
  const all = loadProducts().flatMap((p) => p.ingredients).join(' | ').toLowerCase();
  for (const m of ingBlock.matchAll(/key:'([^']+)'/g)) assert.ok(all.includes(m[1]), 'ingredient in a product: ' + m[1]);
  assert.ok(app.includes('hasIng(p, i)') && app.includes('Found in'), 'found-in computed from live catalog');
  const ing = read('ingredients.html');
  assert.ok(ing.includes('id="routine"') && ing.includes('data-routine="am"') && ing.includes('data-routine="pm"') && ing.includes('id="formulation"'), 'routine + formulation');
  for (const id of ['id="ingredients"', 'id="formulation"', 'id="how-to-use"', 'id="faqs"', 'buy-band', 'band-add']) assert.ok(app.includes(id), 'product page section ' + id);
  const all3 = ['index.html', 'concerns.html', 'ingredients.html', 'collections.html'].map(read).join('\n') + app.slice(app.indexOf('/* ================= v3'));
  assert.ok(!/clinically|dermatologist[- ]tested|dermatologist recommended|award|\b\d{2,3}\s?%|cruelty|sustainab|\b\d(\.\d)? ?stars?\b/i.test(all3), 'no invented claims, stats, awards or ratings');
  assert.ok(!all3.includes('@gmail.com') && !/AVERMENTIS|Avermentis/.test(all3), 'no owner email, brand spelled right');
  for (const f of ['campaign-wide', 'campaign-tall', 'ritual']) assert.ok(fs.existsSync(path.join(SITE, 'img', f + '.webp')), f);
});
