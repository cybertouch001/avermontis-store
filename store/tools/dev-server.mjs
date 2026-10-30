// Local preview: runs the real _worker.js with an in-memory SQLite "D1" and the site folder as assets.
// node tools/dev-server.mjs  ->  http://localhost:8787/app
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { DatabaseSync } from 'node:sqlite'; import { fileURLToPath } from 'node:url';
const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const db = new DatabaseSync(':memory:');
const exec = (sql, args) => { const st = db.prepare(sql); if (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql) || /RETURNING/i.test(sql)) return { results: st.all(...args), meta: { changes: 0 } }; const r = st.run(...args); return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), first: async () => { const r = exec(sql, args).results; return r.length ? { ...r[0] } : null; }, all: async () => exec(sql, args), run: async () => exec(sql, args), _x: () => exec(sql, args) });
const DB = { prepare: (sql) => stmt(sql), exec: async (s) => db.exec(s), batch: async (l) => { db.exec('BEGIN'); try { const o = l.map((s) => s._x()); db.exec('COMMIT'); return o; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const ASSETS = { fetch: async (req) => { const u = new URL(req.url); let p = decodeURIComponent(u.pathname); if (p.endsWith('/')) p += 'index.html'; let f = path.join(SITE, p); const isF = (x) => fs.existsSync(x) && fs.statSync(x).isFile(); if (!isF(f) && isF(f + '.html')) f += '.html'; if (!isF(f)) return new Response('nf', { status: 404, headers: { 'content-type': 'text/html' } }); return new Response(fs.readFileSync(f), { status: 200, headers: { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' } }); } };
const tmp = path.join('/tmp', 'avm-dev-worker-' + process.pid + '.mjs'); fs.copyFileSync(path.join(SITE, '_worker.js'), tmp);
const mod = await import(tmp); const env = { DB, ASSETS };
const PORT = +process.env.PORT || 8787;
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c); const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = { ...req.headers, 'cf-connecting-ip': '127.0.0.1' }; if (headers.cookie) headers.cookie = headers.cookie.replace(/(^|;\s*)(?!__Host-)(avm_[a-z_]+)=/g, '$1__Host-$2='); if (headers.origin) headers.origin = 'https://avermontis.sites.tab.bot';
  const r = await mod.default.fetch(new Request('https://avermontis.sites.tab.bot' + req.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env);
  const h = {}; r.headers.forEach((v, k) => { if (k === 'set-cookie') v = v.replace(/;\s*Secure/i, '').replace(/__Host-/g, ''); h[k] = v; });
  res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, () => console.log('dev server on http://localhost:' + PORT));
