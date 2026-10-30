package bot.tab.sites.avermontis.admin;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.Context;
import android.content.SharedPreferences;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONObject;

/* Background new-order check (about every 15 minutes; Android may delay it, e.g. in battery saver / Doze).
   Asks the store with the read-only alert key: how many new orders, and when the newest came in. Nothing else. */
public class OrderWatchJob extends JobService {
    @Override
    public boolean onStartJob(final JobParameters params) {
        new Thread(() -> { try { check(getApplicationContext()); } catch (Exception e) { /* try again next time */ } jobFinished(params, false); }).start();
        return true;
    }
    @Override
    public boolean onStopJob(JobParameters params) { return true; }

    static void check(Context ctx) throws Exception {
        SharedPreferences p = ctx.getSharedPreferences(AvmAdminPlugin.PREFS, Context.MODE_PRIVATE);
        String key = p.getString("key", null), url = p.getString("url", null);
        if (key == null || url == null) return;
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(15000);
        c.setRequestProperty("X-Alert-Key", key); c.setRequestProperty("Accept", "application/json");
        c.setRequestProperty("User-Agent", "AvermontisAdmin/1.0 (order check)");
        int code = c.getResponseCode();
        if (code == 403) { AvmAdminPlugin.stop(ctx); return; }      // key switched off (alerts off / signed out everywhere)
        if (code != 200) return;
        StringBuilder sb = new StringBuilder();
        try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) { String l; while ((l = r.readLine()) != null) sb.append(l); }
        JSONObject j = new JSONObject(sb.toString());
        String latest = j.optString("latest_at", ""); int n = j.optInt("new_orders", 0);
        String since = p.getString("since", "");
        if (!latest.isEmpty() && latest.compareTo(since) > 0) {
            if (!since.isEmpty() && n > 0) AvmAdminPlugin.post(ctx, 7002, "New order on Avermontis", n + (n == 1 ? " new order is" : " new orders are") + " waiting. Tap to open.");
            p.edit().putString("since", latest).apply();
        }
    }
}
