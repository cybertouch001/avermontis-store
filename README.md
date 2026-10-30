# AVERMONTIS store + Android app (v4)

This repo has the full code of the AVERMONTIS skincare store: the website, the admin panel, the server, and the Android app.

Live store: https://avermontis.sites.tab.bot/
Admin panel: https://avermontis.sites.tab.bot/admin

> Yahan poora code hai: website, admin panel dashboard, server aur Android app. Live store upar wale link pe chalta hai.

## Folders

- `store/` – the website, admin panel and server, all in one.
  - `store/site/` – the files that get published. `site/_worker.js` is the server (accounts, orders, admin, chatbot, bargaining, config API). It uses a D1 (SQLite) database `DB` and an R2 media store `MEDIA` (see `site/tab-site.json`).
  - `store/src/pages/` – page sources. `python3 build.py` builds them into `site/_pages/`.
  - `store/migrations/` – database tables (SQL).
  - `store/test/` – tests.
  - `store/tools/dev-server.mjs` – run the store on your own computer.
  - `store/site/assets/ar/` – AR: 3D bottle models, glow selfie, bottle scan.
- `app/` – the native Android app (Capacitor 7). Package `bot.tab.sites.avermontis.twa`, version 4.0.0 (versionCode 4). See `app/README.md` for full details.

## Website: test, build, run

Needs Node.js 22+ (uses node:sqlite) and Python 3.

```bash
cd store
npm test                     # runs all tests (node --test); the APK download test needs site/_dl/avermontis.apk, which is not in this repo
python3 build.py             # builds site/_pages/*.html from src/pages/
node tools/dev-server.mjs    # local preview at http://localhost:8787 (in-memory database)
```

**One AR file is not in this repo:** `store/site/assets/ar/vendor/mediapipe/wasm/vision_wasm_internal.wasm` (14 MB, used by the glow selfie). It is the unmodified file from npm `@mediapipe/tasks-vision` 1.2.0. Before you run or publish the site, get it with:

```bash
cd store
sh tools/fetch-vendor.sh     # downloads it and checks its SHA-256
```

> Glow selfie ke liye ye ek file alag se download karni hai, upar wala command chala do.

The 3D hero (`site/assets/hero3d.js`) is built from `hero3d.src.js`; steps are in `store/BUILD-3D.txt`.

## Android app: build

Needs JDK 21 and Android SDK 35.

```bash
cd app
npm install
AVM_SITE=../store/site python3 tools/bundle_web.py
npx cap sync android
cd android && ./gradlew assembleRelease bundleRelease
```

Release signing reads a properties file kept OUTSIDE this repo (env `AVM_KEYSTORE_PROPS`). Use the SAME keystore as before, or phones won't accept the update.

> Signing key (keystore) aur passwords is repo mein nahi hain, jaan-boojh ke. Unhe safe jagah rakho, GitHub pe kabhi mat daalna.

## About GitHub Pages

GitHub Pages can only host static pages. The admin panel, orders, login, chatbot, bargaining and the database need the server (`site/_worker.js` with its database), so they will NOT work on GitHub Pages. The real store keeps running at https://avermontis.sites.tab.bot/.

> GitHub Pages pe sirf design wale page dikhenge. Admin, orders, login aur database ke liye server chahiye, isliye live store upar wale address pe hi chalega.

## Not in this repo

No keystore, no passwords, no `.apk` / `.aab` files, no `node_modules`, no build output, and the one 14 MB AR file above (download it with `tools/fetch-vendor.sh`).
