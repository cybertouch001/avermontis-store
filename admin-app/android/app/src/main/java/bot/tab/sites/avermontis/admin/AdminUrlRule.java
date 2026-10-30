package bot.tab.sites.avermontis.admin;

import java.util.Locale;

/* Which store pages the Admin app shows inside itself (pure Java, checked by tools/java/AdminUrlRuleCheck.java). */
public final class AdminUrlRule {
    private AdminUrlRule() {}
    public static final String HOST = "avermontis.sites.tab.bot";
    public static boolean isStoreHost(String host) {
        if (host == null) return false;
        String h = host.toLowerCase(Locale.ROOT); if (h.endsWith(".")) h = h.substring(0, h.length() - 1);
        return h.equals(HOST);
    }
    /** owner pages, invoices, files and API calls stay in the app; shop pages (/, /shop, /product ...) open in the browser */
    public static boolean opensInApp(String scheme, String path) {
        if (!"https".equalsIgnoreCase(scheme)) return false;
        String p = path == null || path.isEmpty() ? "/" : path.toLowerCase(Locale.ROOT);
        while (p.contains("//")) p = p.replace("//", "/");
        return p.equals("/admin") || p.startsWith("/admin/") || p.startsWith("/invoice/") || p.startsWith("/api/")
            || p.startsWith("/media/") || p.startsWith("/assets/") || p.equals("/design");
    }
}
