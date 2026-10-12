package edu.waterdog.bridge.handler;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import dev.waterdog.waterdogpe.event.defaults.PlayerAuthenticatedEvent;
import dev.waterdog.waterdogpe.event.defaults.PreClientDataSetEvent;
import dev.waterdog.waterdogpe.network.connection.ProxiedConnection;
import dev.waterdog.waterdogpe.player.ProxiedPlayer;
import edu.waterdog.bridge.EduBridgePlugin;
import edu.waterdog.bridge.auth.M365EducationIdentity;
import edu.waterdog.bridge.auth.M365JwksVerifier;
import edu.waterdog.bridge.auth.XuidSynthesizer;
import edu.waterdog.bridge.config.EduBridgeConfig;
import org.cloudburstmc.protocol.bedrock.packet.BedrockPacketHandler;
import org.cloudburstmc.protocol.bedrock.packet.LoginPacket;
import org.cloudburstmc.protocol.bedrock.packet.ModalFormResponsePacket;
import org.cloudburstmc.protocol.common.PacketSignal;

import java.net.SocketAddress;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Core Interception Layer for WaterdogPE:
 *
 * HOW STANDARD WATERDOGPE XBOX AUTH WORKS & HOW WE BYPASS / BRIDGE IT:
 * -------------------------------------------------------------------
 * 1. In standard WaterdogPE (`UpstreamLoginHandler` + `HandshakeUtils.processHandshake`),
 *    when a client sends `LoginPacket`, WaterdogPE verifies that the `chain` of JWTs terminates
 *    at Mojang's hard-coded retail Xbox Live public root key (`HandshakeUtils.MOJANG_PUBLIC_KEY`).
 * 2. Minecraft: Education Edition clients authenticate via Microsoft 365 (Entra ID / Azure AD)
 *    and Education Services (`login.microsoftonline.com/{tenant}`), NOT retail Xbox Live.
 *    Consequently, if `online-mode: true` is left unchecked without interception, WaterdogPE
 *    drops Education Edition clients with "disconnectionScreen.notAuthenticated".
 * 3. By setting `online-mode: false` and `use-login-extras: true` in `config.yml` (WaterdogPE)
 *    and subscribing to `PreClientDataSetEvent` at HIGHEST priority, this interceptor:
 *      a) Extracts the raw M365 token from `clientData` ("M365Token" / "EduToken" / "TenantToken")
 *         or the `extraData` chain in `PreClientDataSetEvent`.
 *      b) Cryptographically verifies the M365 RSA/ECDSA signature against Microsoft's JWKS endpoint
 *         for the school's allowed `tid` (Tenant UUID) — restoring full online-mode security!
 *      c) Synthesizes a collision-free 16-digit numeric `XUID` and `UUID` from the student's M365
 *         Object ID (`oid`), and injects the verified M365 claims directly into `extraData`
 *         before WaterdogPE constructs the player's `LoginData` and signs the downstream token
 *         for PowerNukkitX (port 19133).
 */
public final class EduLoginPacketInterceptor {

    private final EduBridgePlugin plugin;
    private final EduBridgeConfig config;
    private final M365JwksVerifier jwksVerifier;
    private final XuidSynthesizer xuidSynthesizer;

    // Active verified M365 identities indexed by synthesized Player UUID
    private final Map<UUID, M365EducationIdentity> verifiedSessions = new ConcurrentHashMap<>();
    // Pending raw M365 JWTs captured by the upstream LoginPacket handler (indexed by remote socket address)
    private final Map<SocketAddress, String> rawM365JwtByAddress = new ConcurrentHashMap<>();

    public EduLoginPacketInterceptor(
            EduBridgePlugin plugin,
            EduBridgeConfig config,
            M365JwksVerifier jwksVerifier,
            XuidSynthesizer xuidSynthesizer
    ) {
        this.plugin = plugin;
        this.config = config;
        this.jwksVerifier = jwksVerifier;
        this.xuidSynthesizer = xuidSynthesizer;
    }

    /**
     * Stage 1: Triggered inside WaterdogPE's `UpstreamLoginHandler` -> `HandshakeUtils`
     * right after the `LoginPacket` JSON payloads (`extraData` and `clientData`) are parsed,
     * and BEFORE `LoginData` or `ProxiedPlayer` is instantiated.
     */
    public void onPreClientDataSet(PreClientDataSetEvent event) {
        JsonObject clientData = event.getClientData();
        JsonObject extraData = event.getExtraData();

        // Check if client is an Education Edition client or carries an M365 JWT token
        String candidateM365Jwt = extractM365JwtFromHandshake(clientData, extraData, event.getConnection());
        boolean isEduClient = isEducationEditionClient(clientData, extraData) || candidateM365Jwt != null;

        if (!isEduClient) {
            // Retail Bedrock client path
            if (!config.isAllowHybridRetailXbox()) {
                plugin.getLogger().warn("[EduBridge] Rejecting non-Education Edition client (hybrid retail Xbox disabled).");
                event.getConnection().disconnect("This server requires Minecraft: Education Edition with a School Microsoft 365 account.");
            }
            return;
        }

        // Validate the M365 JWT token against Microsoft Entra ID JWKS
        Optional<M365EducationIdentity> verifiedOpt = Optional.empty();
        if (candidateM365Jwt != null) {
            verifiedOpt = jwksVerifier.verifyTokenSync(candidateM365Jwt);
        } else if (!config.isVerifyJwtSignature() && hasInlineM365Claims(clientData, extraData)) {
            // Fallback for local classroom testing when M365 claims are passed directly inside clientData/extraData
            verifiedOpt = parseInlineM365Claims(clientData, extraData);
        }

        if (verifiedOpt.isEmpty()) {
            plugin.getLogger().warn("[EduBridge] Blocked unverified M365 Education Edition handshake.");
            event.getConnection().disconnect("§cMicrosoft 365 School Authentication Failed.\n§7Please sign in with an authorized school tenant account.");
            return;
        }

        M365EducationIdentity identity = verifiedOpt.get();

        // Override extraData with deterministic XUID, UUID, and sanitized displayName
        // so WaterdogPE's LoginData.builder() and downstream PowerNukkitX receive valid Xbox-compatible fields
        extraData.addProperty("XUID", identity.synthesizedXuid());
        extraData.addProperty("identity", identity.synthesizedUuid().toString());
        extraData.addProperty("displayName", identity.displayName());

        // Inject verified M365 Tenant & Student Metadata into extraData AND clientData
        // WaterdogPE signs extraData & clientData using HandshakeUtils.createExtraData(KeyPair, extraData)
        // when forwarding the player to PowerNukkitX on port 19133!
        if (config.isInjectSignedExtradata()) {
            extraData.addProperty("edu_authenticated", true);
            extraData.addProperty("m365_tenant_id", identity.tenantId());
            extraData.addProperty("m365_object_id", identity.objectId());
            extraData.addProperty("m365_upn", identity.userPrincipalName());
            extraData.addProperty("edu_role", identity.eduRole());

            clientData.addProperty("Waterdog_EduAuthenticated", true);
            clientData.addProperty("Waterdog_M365TenantId", identity.tenantId());
            clientData.addProperty("Waterdog_M365ObjectId", identity.objectId());
            clientData.addProperty("Waterdog_M365Upn", identity.userPrincipalName());
            clientData.addProperty("Waterdog_EduRole", identity.eduRole());
        }

        verifiedSessions.put(identity.synthesizedUuid(), identity);

        plugin.getLogger().info(String.format(
                "[EduBridge] Verified M365 Education Login: %s (%s) | Role: %s | Tenant: %s | Synthesized XUID: %s",
                identity.displayName(),
                identity.userPrincipalName(),
                identity.eduRole(),
                identity.tenantId(),
                identity.synthesizedXuid()
        ));
    }

    /**
     * Stage 2: Fired when the player's identity is bound to the session.
     * Allows us to attach a lightweight packet listener for Classroom Join Code modal responses.
     */
    public void onPlayerAuthenticated(PlayerAuthenticatedEvent event) {
        ProxiedPlayer player = event.getPlayer();
        M365EducationIdentity identity = verifiedSessions.get(player.getUniqueId());
        if (identity != null) {
            plugin.getLogger().debug("[EduBridge] PlayerAuthenticatedEvent confirmed for M365 user " + identity.userPrincipalName());
        }
    }

    /**
     * Custom Upstream BedrockPacketHandler that can be attached to a session to inspect raw
     * LoginPackets (extracting embedded M365 bearer tokens from the chain list) and
     * ModalFormResponsePackets (for classroom join-code challenges).
     */
    public BedrockPacketHandler createSessionPacketTap(
            ProxiedPlayer player,
            EduJoinCodeGatekeeper gatekeeper,
            Runnable onJoinCodeVerified
    ) {
        return new BedrockPacketHandler() {
            @Override
            public PacketSignal handle(LoginPacket packet) {
                // Inspect raw chain JWTs in LoginPacket before standard processing
                for (String jwt : packet.getChain()) {
                    if (jwt != null && jwt.split("\\.").length == 3) {
                        rawM365JwtByAddress.put(player.getAddress(), jwt);
                    }
                }
                return PacketSignal.UNHANDLED;
            }

            @Override
            public PacketSignal handle(ModalFormResponsePacket packet) {
                if (gatekeeper.handleModalResponse(player, packet)) {
                    onJoinCodeVerified.run();
                    return PacketSignal.HANDLED;
                }
                return PacketSignal.UNHANDLED;
            }
        };
    }

    private String extractM365JwtFromHandshake(JsonObject clientData, JsonObject extraData, ProxiedConnection connection) {
        String[] candidateKeys = {
                "M365Token", "EduToken", "TenantToken", "m365_jwt", "id_token", "AccessToken"
        };
        for (String key : candidateKeys) {
            if (clientData.has(key) && clientData.get(key).isJsonPrimitive()) {
                return clientData.get(key).getAsString();
            }
            if (extraData.has(key) && extraData.get(key).isJsonPrimitive()) {
                return extraData.get(key).getAsString();
            }
        }
        if (connection != null && connection.getSocketAddress() != null) {
            return rawM365JwtByAddress.remove(connection.getSocketAddress());
        }
        return null;
    }

    private boolean isEducationEditionClient(JsonObject clientData, JsonObject extraData) {
        if (clientData.has("GameVersion") && clientData.get("GameVersion").getAsString().toLowerCase().contains("edu")) {
            return true;
        }
        if (clientData.has("IsEduMode") && clientData.get("IsEduMode").getAsBoolean()) {
            return true;
        }
        if (extraData.has("tid") || extraData.has("m365_tenant_id") || clientData.has("TenantId")) {
            return true;
        }
        return false;
    }

    private boolean hasInlineM365Claims(JsonObject clientData, JsonObject extraData) {
        return (extraData.has("tid") && extraData.has("oid"))
                || (clientData.has("TenantId") && clientData.has("ObjectId"));
    }

    private Optional<M365EducationIdentity> parseInlineM365Claims(JsonObject clientData, JsonObject extraData) {
        String tid = getJsonString(extraData, "tid", getJsonString(clientData, "TenantId", null));
        String oid = getJsonString(extraData, "oid", getJsonString(clientData, "ObjectId", null));
        String upn = getJsonString(extraData, "upn", getJsonString(clientData, "UserPrincipalName", "student@students.oakridge.edu"));
        String name = getJsonString(extraData, "displayName", "EduStudent");

        if (tid == null || oid == null || (!config.getAllowedTenantIds().isEmpty() && !config.getAllowedTenantIds().contains(tid))) {
            return Optional.empty();
        }

        String xuid = xuidSynthesizer.deriveEducationXuid(tid, oid);
        UUID uuid = xuidSynthesizer.deriveEducationUuid(tid, oid);
        String role = (upn != null && config.getTeacherDomains().stream().anyMatch(upn::endsWith)) ? "teacher" : "student";

        return Optional.of(new M365EducationIdentity(
                tid,
                oid,
                upn,
                xuidSynthesizer.sanitizeBedrockUsername(name, upn),
                xuid,
                uuid,
                role,
                "Minecraft: Education Edition (Inline Claims)",
                System.currentTimeMillis() / 1000L + 3600L
        ));
    }

    private static String getJsonString(JsonObject obj, String key, String fallback) {
        if (obj != null && obj.has(key)) {
            JsonElement el = obj.get(key);
            if (el != null && el.isJsonPrimitive()) {
                return el.getAsString();
            }
        }
        return fallback;
    }

    public Optional<M365EducationIdentity> getVerifiedSession(UUID playerUuid) {
        return Optional.ofNullable(verifiedSessions.get(playerUuid));
    }

    public void removeSession(UUID playerUuid) {
        verifiedSessions.remove(playerUuid);
    }
}
