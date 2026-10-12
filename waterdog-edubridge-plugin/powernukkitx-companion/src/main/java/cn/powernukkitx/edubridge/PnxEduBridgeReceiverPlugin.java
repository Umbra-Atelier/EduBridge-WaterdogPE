package cn.powernukkitx.edubridge;

import cn.nukkit.Player;
import cn.nukkit.event.EventHandler;
import cn.nukkit.event.EventPriority;
import cn.nukkit.event.Listener;
import cn.nukkit.event.player.PlayerLoginEvent;
import cn.nukkit.plugin.PluginBase;
import cn.nukkit.utils.LoginChainData;
import com.google.gson.JsonObject;

/**
 * Companion PowerNukkitX Plugin (Runs on Backend Port 19133).
 *
 * Reads the M365 Tenant ID, Student UPN, and Education Role ('teacher' / 'student')
 * forwarded by EduBridge-WaterdogPE via `clientData` / `extraData` on port 19133.
 *
 * Prerequisite in PowerNukkitX `server.properties`:
 *   server-port=19133
 *   server-ip=127.0.0.1
 *   xbox-auth=false
 *   waterdogpe-support=true
 */
public final class PnxEduBridgeReceiverPlugin extends PluginBase implements Listener {

    @Override
    public void onEnable() {
        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("[PNX-EduBridge] Listening for WaterdogPE M365 Education sessions on port " + getServer().getPort());
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onPlayerLogin(PlayerLoginEvent event) {
        Player player = event.getPlayer();
        LoginChainData chainData = player.getLoginChainData();

        if (chainData == null) {
            return;
        }

        JsonObject rawData = chainData.getRawData();
        if (rawData == null || !rawData.has("Waterdog_EduAuthenticated")) {
            return;
        }

        boolean eduAuth = rawData.get("Waterdog_EduAuthenticated").getAsBoolean();
        if (!eduAuth) {
            return;
        }

        String tenantId = rawData.has("Waterdog_M365TenantId") ? rawData.get("Waterdog_M365TenantId").getAsString() : "unknown";
        String upn = rawData.has("Waterdog_M365Upn") ? rawData.get("Waterdog_M365Upn").getAsString() : "unknown";
        String eduRole = rawData.has("Waterdog_EduRole") ? rawData.get("Waterdog_EduRole").getAsString() : "student";

        getLogger().info(String.format(
                "[PNX-EduBridge] Accepted M365 %s: %s (UPN: %s, Tenant: %s, XUID: %s)",
                eduRole.toUpperCase(),
                player.getName(),
                upn,
                tenantId,
                chainData.getXUID()
        ));

        // Automatically grant classroom operator / teacher permissions if verified as faculty
        if ("teacher".equalsIgnoreCase(eduRole)) {
            player.setOp(true);
            getLogger().info("[PNX-EduBridge] Granted Classroom Teacher OP permissions to " + player.getName() + " (" + upn + ")");
        }
    }
}
