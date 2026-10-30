package bot.tab.sites.avermontis.admin;

import android.Manifest;
import android.app.Activity;
import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.WebView;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/* Native extras for the Avermontis Admin app, used by /admin/app (window.Capacitor.Plugins.AvmAdmin):
   lockAvailable / unlock   phone fingerprint, face or screen lock (BiometricPrompt on Android 10+, confirm-credential before)
   notify / requestNotify   a local notification (new order) + the Android 13+ notification permission
   startWatch / stopWatch / setSeen   background new-order check about every 15 min (JobScheduler; Android decides the exact
                            time). It sends only a read-only alert key and gets back a count, never customer data.
   share / printPage / vibrate */
@CapacitorPlugin(name = "AvmAdmin")
public class AvmAdminPlugin extends Plugin {
    static final String PREFS = "avm_admin";
    static final String CHANNEL = "orders";
    static final int JOB_ID = 6001;

    @PluginMethod
    public void vibrate(PluginCall call) {
        int ms = Math.max(5, Math.min(1000, call.getInt("ms", 20)));
        try {
            Vibrator v = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) { if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE)); else v.vibrate(ms); }
        } catch (Exception e) { /* no vibrator */ }
        call.resolve();
    }

    @PluginMethod
    public void lockAvailable(PluginCall call) {
        KeyguardManager km = (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
        JSObject r = new JSObject(); r.put("available", km != null && km.isDeviceSecure()); call.resolve(r);
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        final String title = call.getString("title", "Unlock Avermontis Admin");
        final String subtitle = call.getString("subtitle", "");
        KeyguardManager km = (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
        if (km == null || !km.isDeviceSecure()) { JSObject r = new JSObject(); r.put("ok", true); r.put("method", "none"); call.resolve(r); return; }
        if (Build.VERSION.SDK_INT >= 29) {
            getActivity().runOnUiThread(() -> {
                try {
                    BiometricPrompt.Builder b = new BiometricPrompt.Builder(getContext()).setTitle(title);
                    if (!subtitle.isEmpty()) b.setSubtitle(subtitle);
                    if (Build.VERSION.SDK_INT >= 30) b.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL);
                    else b.setDeviceCredentialAllowed(true);
                    b.build().authenticate(new CancellationSignal(), getContext().getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                        @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) { JSObject r = new JSObject(); r.put("ok", true); r.put("method", "biometric_or_screen_lock"); call.resolve(r); }
                        @Override public void onAuthenticationError(int code, CharSequence msg) { JSObject r = new JSObject(); r.put("ok", false); r.put("error", String.valueOf(msg)); call.resolve(r); }
                    });
                } catch (Exception e) { call.reject("Unlock is not available: " + e.getMessage()); }
            });
            return;
        }
        Intent i = km.createConfirmDeviceCredentialIntent(title, subtitle);
        if (i == null) { JSObject r = new JSObject(); r.put("ok", true); call.resolve(r); return; }
        startActivityForResult(call, i, "unlockResult");
    }

    @ActivityCallback
    private void unlockResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject r = new JSObject(); r.put("ok", result.getResultCode() == Activity.RESULT_OK); r.put("method", "screen_lock"); call.resolve(r);
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "New orders", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("Alerts when a new order comes into the Avermontis store");
                ch.enableVibration(true);
                nm.createNotificationChannel(ch);
            }
        }
    }

    static void post(Context ctx, int id, String title, String body) {
        ensureChannel(ctx);
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        Intent open = new Intent(ctx, MainActivity.class); open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL) : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_stat_admin).setContentTitle(title).setContentText(body).setAutoCancel(true).setContentIntent(pi)
            .setColor(0xFF1E7B52).setStyle(new Notification.BigTextStyle().bigText(body));
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(id, b.build());
    }

    @PluginMethod
    public void requestNotify(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getContext().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            getActivity().requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 6002);
        }
        ensureChannel(getContext());
        call.resolve();
    }

    @PluginMethod
    public void notify(PluginCall call) {
        post(getContext(), 7001, call.getString("title", "Avermontis Admin"), call.getString("body", ""));
        call.resolve();
    }

    @PluginMethod
    public void startWatch(PluginCall call) {
        String key = call.getString("key"), url = call.getString("url");
        if (key == null || url == null || !url.startsWith("https://" + AdminUrlRule.HOST + "/")) { call.reject("Missing key or wrong address."); return; }
        SharedPreferences.Editor e = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit();
        e.putString("key", key).putString("url", url);
        String since = call.getString("since", "");
        if (since != null && !since.isEmpty()) e.putString("since", since);
        e.apply();
        JobScheduler js = (JobScheduler) getContext().getSystemService(Context.JOB_SCHEDULER_SERVICE);
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(getContext(), OrderWatchJob.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(15 * 60 * 1000L).setPersisted(true).build();
        int res = js.schedule(job);
        if (res != JobScheduler.RESULT_SUCCESS) { call.reject("Android did not accept the background check."); return; }
        JSObject r = new JSObject(); r.put("ok", true); r.put("every_minutes", 15); call.resolve(r);
    }

    @PluginMethod
    public void stopWatch(PluginCall call) {
        stop(getContext()); call.resolve();
    }
    static void stop(Context ctx) {
        JobScheduler js = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (js != null) js.cancel(JOB_ID);
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("key").remove("url").apply();
    }

    @PluginMethod
    public void setSeen(PluginCall call) {
        String since = call.getString("since", "");
        if (since != null && !since.isEmpty()) {
            SharedPreferences p = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (since.compareTo(p.getString("since", "")) > 0) p.edit().putString("since", since).apply();
        }
        call.resolve();
    }

    @PluginMethod
    public void share(PluginCall call) {
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_SUBJECT, call.getString("title", "Avermontis"));
        send.putExtra(Intent.EXTRA_TEXT, call.getString("text", ""));
        Intent chooser = Intent.createChooser(send, call.getString("title", "Share"));
        chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(chooser);
        call.resolve();
    }

    @PluginMethod
    public void printPage(PluginCall call) {
        final String name = call.getString("name", "Avermontis invoice");
        getActivity().runOnUiThread(() -> {
            try {
                WebView wv = getBridge().getWebView();
                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                pm.print(name, wv.createPrintDocumentAdapter(name), new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
                call.resolve();
            } catch (Exception e) { call.reject("Printing is not available: " + e.getMessage()); }
        });
    }
}
