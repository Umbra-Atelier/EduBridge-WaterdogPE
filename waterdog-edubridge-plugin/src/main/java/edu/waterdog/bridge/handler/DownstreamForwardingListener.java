package edu.waterdog.bridge.handler;

import com.google.gson.JsonObject;
import dev.waterdog.waterdogpe.event.defaults.PlayerDisconnectedEvent;
import dev.waterdog.waterdogpe.event.defaults.PlayerLoginEvent;
import dev.waterdog.waterdogpe.event.defaults.ServerTransferRequestEvent;
import dev.waterdog.waterdogpe.network.connection.handler.HandshakeUtils;
import dev.waterdog.waterdogpe.network.serverinfo.ServerInfo;
import dev.waterdog.waterdogpe.player.ProxiedPlayer;
import edu.waterdog.bridge.EduBridgePlugin;
import edu.waterdog.bridge.auth.M365EducationIdentity;
import edu.waterdog.bridge.config.EduBridgeConfig;
import org.cloudburstmc.protocol.bedrock.data.auth.CertificateChainPayload;
import org.cloudburstmc.protocol.bedrock.packet.LoginPacket;

import java.security.KeyPair;
import java.util.Collections;
import java.util.Optional;

/**
 * Handles player connection events (`PlayerLoginEvent`, `ServerTransferRequestEvent`,
 * `PlayerDisconnectedEvent`) and guarantees that verified M365 Education metadata
 * is cryptographically signed by WaterdogPE and forwarded to PowerNukkitX (port 19133).
 */
public final class DownstreamForwardingListener {

    private final EduBridgePlugin plugin;
    private final EduBridgeConfig config;
    private final EduLoginPacketInterceptor loginInterceptor;
    private final EduJoinCodeGatekeeper joinCodeGatekeeper;

    public DownstreamForwardingListener(
            EduBridgePlugin plugin,
            EduBridgeConfig config,
            EduLoginPacketInterceptor loginInterceptor,
            EduJoinCodeGatekeeper joinCodeGatekeeper
    ) {
        this.plugin = plugin;
        this.config = config;
        this.loginInterceptor = loginInterceptor;
        this.joinCodeGatekeeper = joinCodeGatekeeper;
    }

    /**
     * Fired when a player finishes initial authentication and is about to be routed
     * to the initial downstream server (PowerNukkitX on 127.0.0.1:19133).
     */
    public void onPlayerLogin(PlayerLoginEvent event) {
        ProxiedPlayer player = event.getPlayer();
        Optional<M365EducationIdentity> eduIdentityOpt = loginInterceptor.getVerifiedSession(player.getUniqueId());

        if (eduIdentityOpt.isEmpty()) {
            // If hybrid retail Xbox is allowed, let standard Xbox Live players pass through
            if (!config.isAllowHybridRetailXbox()) {
                event.setCancelReason("§cMicrosoft 365 Education Edition login required.");
                event.setCancelled(true);
            }
            return;
        }

        M365EducationIdentity identity = eduIdentityOpt.get();

        // Check if student's clientData already supplied the Classroom Join Code
        JsonObject clientData = player.getLoginData().getClientData();
        if (config.isJoinCodeEnabled() && !joinCodeGatekeeper.isVerified(player.getUniqueId())) {
            if (clientData.has("JoinCode")) {
                String submitted = clientData.get("JoinCode").getAsString();
                if (!joinCodeGatekeeper.verifyCodeInput(player.getUniqueId(), submitted)) {
                    event.setCancelReason("§cInvalid Classroom Join Code (" + submitted + ").");
                    event.setCancelled(true);
                    return;
                }
            } else if (identity.isTeacher()) {
                // Teachers authenticated on faculty domain bypass student join-code prompt
                joinCodeGatekeeper.markVerified(player.getUniqueId());
            }
        }

        plugin.getLogger().info(String.format(
                "[EduBridge] Routing M365 %s '%s' (%s) -> PowerNukkitX (%s:%d)",
                identity.eduRole().toUpperCase(),
                player.getName(),
                identity.userPrincipalName(),
                config.getDownstreamHost(),
                config.getDownstreamPort()
        ));
    }

    /**
     * Fired right before WaterdogPE establishes the downstream connection to PowerNukkitX (port 19133).
     *
     * Here we ensure that the player's `LoginData` contains the re-signed JWT chain with
     * `m365_tenant_id`, `m365_object_id`, `m365_upn`, and `edu_role` inside `extraData`,
     * signed by WaterdogPE's proxy `KeyPair` via `HandshakeUtils.createExtraData(...)`.
     */
    public void onServerTransferRequest(ServerTransferRequestEvent event) {
        ProxiedPlayer player = event.getPlayer();
        ServerInfo targetServer = event.getTargetServer();

        Optional<M365EducationIdentity> eduIdentityOpt = loginInterceptor.getVerifiedSession(player.getUniqueId());
        if (eduIdentityOpt.isEmpty()) {
            return;
        }

        M365EducationIdentity identity = eduIdentityOpt.get();

        // Rebuild and sign the downstream LoginPacket payload so PowerNukkitX (port 19133)
        // receives a cryptographically valid WaterdogPE JWT containing the M365 claims
        if (config.isInjectSignedExtradata()) {
            JsonObject extraData = player.getLoginData().getExtraData();
            extraData.addProperty("edu_authenticated", true);
            extraData.addProperty("m365_tenant_id", identity.tenantId());
            extraData.addProperty("m365_object_id", identity.objectId());
            extraData.addProperty("m365_upn", identity.userPrincipalName());
            extraData.addProperty("edu_role", identity.eduRole());
            extraData.addProperty("join_code_verified", joinCodeGatekeeper.isVerified(player.getUniqueId()));

            // Re-sign extraData with WaterdogPE's proxy KeyPair and update the LoginPacket
            KeyPair proxyKeyPair = plugin.getProxy().getKeyPair();
            String signedExtraJwt = HandshakeUtils.createExtraData(proxyKeyPair, extraData);
            String signedClientJwt = HandshakeUtils.encodeRandomToken(proxyKeyPair, player.getLoginData().getClientData());

            LoginPacket downstreamLoginPacket = player.getLoginData().getLoginPacket();
            if (downstreamLoginPacket != null) {
                downstreamLoginPacket.setAuthPayload(new CertificateChainPayload(
                        Collections.singletonList(signedExtraJwt)
                ));
                downstreamLoginPacket.setClientJwt(signedClientJwt);
            }
        }

        // If Join Code is required and wasn't supplied in clientData, schedule the modal prompt
        // as soon as the player finishes spawning on PowerNukkitX
        if (config.isJoinCodeEnabled() && !joinCodeGatekeeper.isVerified(player.getUniqueId())) {
            plugin.getProxy().getScheduler().scheduleDelayed(() -> {
                if (player.isConnected() && !joinCodeGatekeeper.isVerified(player.getUniqueId())) {
                    joinCodeGatekeeper.sendJoinCodeChallengeForm(player);
                }
            }, 40); // 40 ticks (2 seconds) after downstream spawn
        }

        plugin.getLogger().debug(String.format(
                "[EduBridge] Signed downstream M365 extraData JWT for %s -> %s (%s)",
                player.getName(),
                targetServer.getServerName(),
                targetServer.getAddress()
        ));
    }

    public void onPlayerDisconnect(PlayerDisconnectedEvent event) {
        if (event.getPlayer() != null) {
            loginInterceptor.removeSession(event.getPlayer().getUniqueId());
        }
    }
}
