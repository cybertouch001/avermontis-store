package bot.tab.sites.avermontis.twa;

import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/* AVERMONTIS native extras for v4:
   - sceneViewer: opens Google's Scene Viewer ("View in your room") for a public .glb URL
   - setIcon / getIcon: switches the launcher icon between the bundled designs (activity aliases) */
@CapacitorPlugin(name = "AvmNative")
public class AvmNativePlugin extends Plugin {
    /* v6: the customer app has no owner area. Any navigation to the owner pages or owner APIs (on the store site or the
       app's own origin) is refused and the app goes back to its store home screen; nothing opens in a browser either. */
    @Override
    public Boolean shouldOverrideLoad(Uri url) {
        if (url == null) return null;
        if (!OwnerUrlRule.isOwnerUrl(url.getScheme(), url.getHost(), url.getPath())) return null;
        final WebView wv = getBridge() != null ? getBridge().getWebView() : null;
        if (wv != null) {
            final String home = getBridge().getAppUrl();
            wv.post(new Runnable() { public void run() { wv.loadUrl(home); } });
        }
        return Boolean.TRUE;
    }

    private static final String[] ICONS = { "avr", "avr_gold", "avr_green", "classic" };
    private static final String[] ALIASES = { ".MainActivity", ".IconAvrGold", ".IconAvrGreen", ".IconClassic" };

    @PluginMethod
    public void sceneViewer(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) { call.reject("A https model URL is needed."); return; }
        String title = call.getString("title", "");
        Uri u = Uri.parse("https://arvr.google.com/scene-viewer/1.0").buildUpon()
            .appendQueryParameter("file", url).appendQueryParameter("mode", "ar_preferred")
            .appendQueryParameter("title", title).appendQueryParameter("resizable", "false").build();
        Context ctx = getContext();
        String[] pkgs = { "com.google.android.googlequicksearchbox", "com.google.ar.core" };
        for (String pkg : pkgs) {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setData(u); i.setPackage(pkg); i.putExtra("browser_fallback_url", url);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
                JSObject r = new JSObject(); r.put("opened", true); r.put("via", pkg); call.resolve(r); return;
            } catch (ActivityNotFoundException e) { /* try the next one */ }
        }
        call.reject("View in your room needs the Google app or Google Play Services for AR on this phone.");
    }

    @PluginMethod
    public void getIcon(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        String cur = "avr";
        for (int k = 0; k < ICONS.length; k++) {
            int st = pm.getComponentEnabledSetting(new ComponentName(getContext(), getContext().getPackageName() + ALIASES[k]));
            boolean on = st == PackageManager.COMPONENT_ENABLED_STATE_ENABLED || (st == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && k == 0);
            if (on) { cur = ICONS[k]; break; }
        }
        JSObject r = new JSObject(); r.put("name", cur); call.resolve(r);
    }

    @PluginMethod
    public void setIcon(PluginCall call) {
        String name = call.getString("name", "avr");
        int want = -1;
        for (int k = 0; k < ICONS.length; k++) if (ICONS[k].equals(name)) want = k;
        if (want < 0) { call.reject("Unknown icon"); return; }
        PackageManager pm = getContext().getPackageManager();
        String pkg = getContext().getPackageName();
        // enable the new one first so the app always has a launcher entry
        pm.setComponentEnabledSetting(new ComponentName(getContext(), pkg + ALIASES[want]), PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP);
        for (int k = 0; k < ICONS.length; k++) if (k != want)
            pm.setComponentEnabledSetting(new ComponentName(getContext(), pkg + ALIASES[k]), PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
        JSObject r = new JSObject(); r.put("name", name); call.resolve(r);
    }
}
