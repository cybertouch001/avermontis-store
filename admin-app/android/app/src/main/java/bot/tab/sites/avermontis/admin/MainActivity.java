package bot.tab.sites.avermontis.admin;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.widget.Toast;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

/* Avermontis Admin: one screen, the live store's owner area (/admin/app and /admin) in a native WebView.
   - only the owner pages open inside the app; store pages and other sites open in the browser (AdminUrlRule)
   - file downloads (orders CSV, backups, login history) go to Android's Downloads with the owner's cookie
   - native extras (app lock, notifications, new-order check, share, print to PDF) live in AvmAdminPlugin */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AvmAdminPlugin.class);
        super.onCreate(savedInstanceState);
        final Bridge bridge = getBridge();
        if (bridge == null) return;
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (request.isForMainFrame() && AdminUrlRule.isStoreHost(u.getHost()) && !AdminUrlRule.opensInApp(u.getScheme(), u.getPath())) {
                    openOutside(u); return true;
                }
                return super.shouldOverrideUrlLoading(view, request);
            }
        });
        WebView wv = bridge.getWebView();
        wv.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> {
            try {
                if (url == null || !url.startsWith("https://")) { Toast.makeText(this, "This file can't be downloaded here.", Toast.LENGTH_SHORT).show(); return; }
                String name = URLUtil.guessFileName(url, contentDisposition, mimetype);
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) r.addRequestHeader("Cookie", cookie);
                r.addRequestHeader("User-Agent", userAgent);
                r.setMimeType(mimetype);
                r.setTitle(name);
                r.setDescription("Avermontis Admin");
                r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
                Toast.makeText(this, "Downloading " + name + " to Downloads", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "Download failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });
    }

    private void openOutside(Uri u) {
        try { Intent i = new Intent(Intent.ACTION_VIEW, u); i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(i); }
        catch (Exception e) { Toast.makeText(this, "No browser found to open this link.", Toast.LENGTH_SHORT).show(); }
    }
}
