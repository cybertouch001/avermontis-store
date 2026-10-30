import bot.tab.sites.avermontis.admin.AdminUrlRule;
/* Run: javac -d /tmp/ac android/app/src/main/java/bot/tab/sites/avermontis/admin/AdminUrlRule.java tools/java/AdminUrlRuleCheck.java && java -cp /tmp/ac AdminUrlRuleCheck */
public class AdminUrlRuleCheck {
    static int n = 0, f = 0;
    static void t(boolean got, boolean want, String what) { n++; if (got != want) { f++; System.out.println("FAIL " + what); } }
    public static void main(String[] a) {
        for (String p : new String[] { "/admin", "/admin/app", "/admin/setup", "/invoice/AV-261030-X", "/api/admin/orders", "/api/admin/export/orders.csv", "/media/x.webp", "/assets/admin-app.js", "/design" })
            t(AdminUrlRule.opensInApp("https", p), true, p);
        for (String p : new String[] { "/", "", "/shop", "/product", "/login", "/account", "/download", "/app", "/adminx", "/checkout" })
            t(AdminUrlRule.opensInApp("https", p), false, p);
        t(AdminUrlRule.opensInApp("http", "/admin"), false, "http");
        t(AdminUrlRule.isStoreHost("avermontis.sites.tab.bot"), true, "host"); t(AdminUrlRule.isStoreHost("AVERMONTIS.sites.tab.bot."), true, "host2");
        t(AdminUrlRule.isStoreHost("evil.example"), false, "evil"); t(AdminUrlRule.isStoreHost(null), false, "null");
        System.out.println(n + " checks, " + f + " failed"); System.exit(f == 0 ? 0 : 1);
    }
}
