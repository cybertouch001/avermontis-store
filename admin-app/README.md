# Avermontis Admin (owner app)

Separate Android app for the store owner. Package `bot.tab.sites.avermontis.admin`, version 1.0.0 (versionCode 1), Capacitor 7.

It loads the owner screens from the live store (`https://avermontis.sites.tab.bot/admin/app`), so admin features update with the website.
Only owner pages open inside the app (`tools/java/AdminUrlRuleCheck.java`); other store links open in the phone's browser.

Native parts (`android/app/src/main/java/bot/tab/sites/avermontis/admin/`):
- `AvmAdminPlugin` – vibrate, notifications, fingerprint / screen-lock unlock, share sheet, print/save invoice PDF, background order check on/off.
- `OrderWatchJob` – optional background check for new orders about every 15 minutes (Android decides the exact time; battery saver can delay it). It uses a read-only key that can only see counts.
- `MainActivity` – downloads (CSV, backups) go to the phone's Downloads with the sign-in cookie.

Build (needs JDK 21 + Android SDK 35):

```bash
npm install
npx cap sync android
cd android && ./gradlew assembleRelease
```

Signing reads a properties file kept OUTSIDE this repo (env `AVM_KEYSTORE_PROPS`), the same keystore as the customer app.
Icons: `python3 tools/make_admin_res.py`.
