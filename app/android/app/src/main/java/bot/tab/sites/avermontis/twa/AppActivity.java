package bot.tab.sites.avermontis.twa;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/* The app's one screen. The launcher entry is an activity-alias (see AndroidManifest.xml): ".MainActivity" stays the
   default alias name so home-screen shortcuts from v1-v3 keep working, and the other aliases are the alternate icons. */
public class AppActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AvmNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
