package bot.tab.sites.avermontis.twa;

import java.util.Locale;

/* v6: which URLs the customer app must never open (the owner area moved to the separate Avermontis Admin app).
   Pure Java so it can be checked without a phone (tools/OwnerUrlRuleCheck.java). */
public final class OwnerUrlRule {
    private OwnerUrlRule() {}
    public static boolean isOwnerUrl(String scheme, String host, String path) {
        if (host == null) return false;
        String h = host.toLowerCase(Locale.ROOT);
        if (h.endsWith(".")) h = h.substring(0, h.length() - 1);
        boolean ours = h.equals("avermontis.sites.tab.bot") || h.equals("localhost");
        if (!ours) return false;
        String p = path == null ? "" : path.toLowerCase(Locale.ROOT);
        while (p.contains("//")) p = p.replace("//", "/");
        try { p = java.net.URLDecoder.decode(p, "UTF-8"); } catch (Exception e) { /* keep as is */ }
        p = p.toLowerCase(Locale.ROOT);
        return p.equals("/admin") || p.startsWith("/admin/") || p.startsWith("/admin.") || p.startsWith("/admin?")
            || p.startsWith("/api/admin") || p.startsWith("/api/auth/admin") || p.startsWith("/_dl/avermontis-admin")
            || p.startsWith("/download/admin") || p.startsWith("/download/avermontis-admin");
    }
}
