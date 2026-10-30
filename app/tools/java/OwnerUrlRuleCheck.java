import bot.tab.sites.avermontis.twa.OwnerUrlRule;
/* v6: checks the customer app's owner-URL block without a phone.
   Run: javac -d /tmp/oc android/app/src/main/java/bot/tab/sites/avermontis/twa/OwnerUrlRule.java tools/java/OwnerUrlRuleCheck.java && java -cp /tmp/oc OwnerUrlRuleCheck */
public class OwnerUrlRuleCheck {
    static int fails = 0, n = 0;
    static void t(String scheme, String host, String path, boolean want) { n++; boolean got = OwnerUrlRule.isOwnerUrl(scheme, host, path); if (got != want) { fails++; System.out.println("FAIL " + host + path + " -> " + got); } }
    public static void main(String[] a) {
        String S = "avermontis.sites.tab.bot";
        for (String p : new String[] { "/admin", "/admin/", "/admin/app", "/admin/setup", "/ADMIN", "/Admin/App", "//admin", "/admin.html", "/api/admin/me", "/api/admin/login", "/api/auth/admin-pin", "/%61dmin", "/download/admin", "/download/avermontis-admin.apk", "/_dl/avermontis-admin.apk" }) { t("https", S, p, true); t("https", "localhost", p, true); }
        t("https", S + ".", "/admin", true); t("https", "AVERMONTIS.sites.tab.bot", "/admin", true);
        for (String p : new String[] { "/", "/shop", "/product", "/administer-skin", "/download", "/download/avermontis.apk", "/api/auth/login", "/api/products", "/invoice/AV-1", "/privacy", "/adminx" }) { t("https", S, p, p.equals("/adminx") ? false : false); t("https", "localhost", p, false); }
        t("https", "example.com", "/admin", false); t("https", null, "/admin", false);
        System.out.println(n + " checks, " + fails + " failed"); System.exit(fails == 0 ? 0 : 1);
    }
}
