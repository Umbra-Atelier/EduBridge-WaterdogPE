export interface RepoFile {
  id: string;
  path: string;
  name: string;
  module: 'waterdog-plugin' | 'pnx-companion' | 'deployment-config';
  language: 'kotlin' | 'java' | 'yaml';
  description: string;
  content: string;
}

export interface BridgeCustomConfig {
  tenantIds: string[];
  allowedDomains: string[];
  teacherDomains: string[];
  joinCodeEnabled: boolean;
  activeJoinCode: string;
  sessionTtlMinutes: number;
  allowHybridRetailXbox: boolean;
  verifyJwtSignature: boolean;
  xuidHashSalt: string;
  downstreamServerName: string;
  downstreamHost: string;
  downstreamPort: number;
  asyncVerifierThreads: number;
}

export const DEFAULT_BRIDGE_CONFIG: BridgeCustomConfig = {
  tenantIds: [
    '84c31ca0-ac3b-4eae-ad11-519d80233e6f',
    'f8cdef31-a31e-4b4a-93e4-5f571e91255a'
  ],
  allowedDomains: ['students.oakridge.edu', 'faculty.oakridge.edu'],
  teacherDomains: ['faculty.oakridge.edu'],
  joinCodeEnabled: true,
  activeJoinCode: 'BOOK-APPLE-PANDA-RAIL',
  sessionTtlMinutes: 180,
  allowHybridRetailXbox: true,
  verifyJwtSignature: true,
  xuidHashSalt: 'edubridge-rpi4-pnx-salt-2026',
  downstreamServerName: 'lobby',
  downstreamHost: '127.0.0.1',
  downstreamPort: 19133,
  asyncVerifierThreads: 2,
};

export function generatePluginConfigYaml(cfg: BridgeCustomConfig): string {
  const tenantsYaml = cfg.tenantIds.map(t => `    - "${t}"`).join('\n');
  const domainsYaml = cfg.allowedDomains.map(d => `    - "${d}"`).join('\n');
  const teachersYaml = cfg.teacherDomains.map(d => `    - "${d}"`).join('\n');

  return `# ============================================================================
# EduBridge-WaterdogPE Configuration (Raspberry Pi 4 Low-Resource Profile)
# Bridges Minecraft Education Edition (M365 Tenant Auth) -> PowerNukkitX
# ============================================================================

# 1. Microsoft 365 / Entra ID Tenant Settings
m365-auth:
  # Require cryptographic verification against Microsoft's OpenID Connect JWKS endpoint
  verify-jwt-signature: ${cfg.verifyJwtSignature}
  # Discovery endpoint template ({tenant} is replaced with the student's tid claim)
  jwks-uri-template: "https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys"
  # Allowed School / Organization Tenant UUIDs (Azure AD 'tid' claim)
  allowed-tenant-ids:
${tenantsYaml}
  # Allowed email domains (UPN suffix check)
  allowed-domains:
${domainsYaml}
  # Also allow standard retail Xbox Live accounts alongside Education Edition accounts?
  allow-hybrid-retail-xbox: ${cfg.allowHybridRetailXbox}
  # Deterministic XUID generation salt (ensures M365 Object IDs map to unique 16-digit XUIDs)
  xuid-hash-salt: "${cfg.xuidHashSalt}"

# 2. Classroom Join Code Gatekeeper (Replaces EduGeyser Join Codes)
classroom-join-code:
  enabled: ${cfg.joinCodeEnabled}
  # Symbolic or alphanumeric code required when joining for the first time in a session
  active-code: "${cfg.activeJoinCode}"
  # Cache verified student OIDs so they don't re-enter the code on server transfer
  session-ttl-minutes: ${cfg.sessionTtlMinutes}
  prompt-title: "Minecraft Education Classroom"
  prompt-subtitle: "Enter your teacher's 4-word Join Code to connect to PowerNukkitX:"

# 3. Downstream PowerNukkitX Forwarding (Port ${cfg.downstreamPort})
downstream-pnx:
  target-server-name: "${cfg.downstreamServerName}"
  host: "${cfg.downstreamHost}"
  port: ${cfg.downstreamPort}
  # Inject verified M365 claims into WaterdogPE extraData JsonObject and re-sign JWT chain
  inject-signed-extradata: true
  # Map M365 Entra Directory roles or faculty domain to edu_role="teacher"
  teacher-domains:
${teachersYaml}

# 4. Raspberry Pi 4 (ARM64 Cortex-A72) Performance & Memory Tuning
hardware-tuning:
  # Restrict async JWKS/OIDC verification worker threads (optimal = 2 for 4-core RPi 4)
  async-verifier-threads: ${cfg.asyncVerifierThreads}
  # Maximum cached M365 public keys and verified token fingerprints
  max-token-cache-entries: 256
  jwks-cache-hours: 24
`;
}

export function buildRepoFiles(cfg: BridgeCustomConfig): RepoFile[] {
  return [
    {
      id: 'build-gradle',
      path: 'waterdog-edubridge-plugin/build.gradle.kts',
      name: 'build.gradle.kts',
      module: 'waterdog-plugin',
      language: 'kotlin',
      description: 'Gradle build script targeting Java 17+, WaterdogPE 2.0.4-SNAPSHOT API, Cloudburst Protocol, and shaded Nimbus JOSE+JWT for M365 JWKS validation.',
      content: `plugins {
    id("java")
    id("java-library")
    id("com.gradleup.shadow") version "8.3.5"
}

group = "edu.waterdog.bridge"
version = "1.2.0-RPi4"
description = "Native Microsoft 365 & Minecraft Education Edition Authentication Bridge for WaterdogPE -> PowerNukkitX"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
    withSourcesJar()
}

repositories {
    mavenCentral()
    maven("https://repo.waterdog.dev/main") {
        name = "waterdog-repo"
    }
    maven("https://repo.waterdog.dev/snapshots") {
        name = "waterdog-snapshots"
    }
    maven("https://repo.opencollab.dev/maven-releases/") {
        name = "opencollab-releases"
    }
    maven("https://repo.opencollab.dev/maven-snapshots/") {
        name = "opencollab-snapshots"
    }
}

dependencies {
    // WaterdogPE Proxy API (Provided at runtime by the proxy jar on port 19132)
    compileOnly("dev.waterdog.waterdogpe:waterdog:2.0.4-SNAPSHOT")

    // Cloudburst Protocol (Bedrock RakNet & LoginPacket / ModalFormRequestPacket definitions)
    compileOnly("org.cloudburstmc.protocol:bedrock-codec:3.0.0.Beta2-SNAPSHOT")
    compileOnly("org.cloudburstmc.protocol:bedrock-connection:3.0.0.Beta2-SNAPSHOT")

    // Nimbus JOSE + JWT for lightweight Microsoft 365 Entra ID (Azure AD) OIDC & JWKS validation
    // Shaded into plugin jar; minimal memory footprint for Raspberry Pi 4 ARM64
    implementation("com.nimbusds:nimbus-jose-jwt:9.41.2")

    // Caffeine for bounded, non-blocking JWKS and session token caching on 4-core Cortex-A72
    implementation("com.github.ben-manes.caffeine:caffeine:3.1.8")

    // Gson & SnakeYAML (Provided by WaterdogPE runtime)
    compileOnly("com.google.code.gson:gson:2.10.1")
    compileOnly("org.yaml:snakeyaml:2.2")
}

tasks {
    compileJava {
        options.encoding = Charsets.UTF_8.name()
        options.release.set(17)
    }

    processResources {
        filteringCharset = Charsets.UTF_8.name()
        filesMatching("plugin.yml") {
            expand("version" to project.version)
        }
    }

    shadowJar {
        archiveBaseName.set("WaterdogPE-EduBridge")
        archiveClassifier.set("")
        // Relocate shaded crypto/JWT dependencies to avoid conflicts with other WaterdogPE plugins
        relocate("com.nimbusds", "edu.waterdog.bridge.shaded.nimbusds")
        relocate("com.github.benmanes.caffeine", "edu.waterdog.bridge.shaded.caffeine")
        minimize()
    }

    build {
        dependsOn(shadowJar)
    }
}`
    },
    {
      id: 'settings-gradle',
      path: 'waterdog-edubridge-plugin/settings.gradle.kts',
      name: 'settings.gradle.kts',
      module: 'waterdog-plugin',
      language: 'kotlin',
      description: 'Gradle root project descriptor.',
      content: `rootProject.name = "waterdog-edubridge-plugin"\n`
    },
    {
      id: 'plugin-yml',
      path: 'waterdog-edubridge-plugin/src/main/resources/plugin.yml',
      name: 'plugin.yml',
      module: 'waterdog-plugin',
      language: 'yaml',
      description: 'WaterdogPE plugin manifest registering EduBridgePlugin as the main entry point.',
      content: `name: "EduBridge"
main: "edu.waterdog.bridge.EduBridgePlugin"
version: "\${version}"
author: "EduBridge Systems Engineering"
description: "Bridges Microsoft 365 Education Edition client authentication and classroom Join Codes natively into WaterdogPE and PowerNukkitX (port ${cfg.downstreamPort})"\n`
    },
    {
      id: 'config-yml',
      path: 'waterdog-edubridge-plugin/src/main/resources/config.yml',
      name: 'config.yml',
      module: 'waterdog-plugin',
      language: 'yaml',
      description: 'Plugin configuration file defining allowed M365 Tenant UUIDs, Join Code challenge settings, and PowerNukkitX downstream forwarding.',
      content: generatePluginConfigYaml(cfg)
    },
    {
      id: 'main-plugin',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/waterdog/bridge/EduBridgePlugin.java',
      name: 'EduBridgePlugin.java',
      module: 'waterdog-plugin',
      language: 'java',
      description: 'Core WaterdogPE Plugin main class. Initializes bounded RPi4 worker threads and subscribes to PreClientDataSetEvent, PlayerAuthenticatedEvent, PlayerLoginEvent, and ServerTransferRequestEvent.',
      content: `package edu.waterdog.bridge;

import dev.waterdog.waterdogpe.event.defaults.PlayerAuthenticatedEvent;
import dev.waterdog.waterdogpe.event.defaults.PlayerDisconnectedEvent;
import dev.waterdog.waterdogpe.event.defaults.PlayerLoginEvent;
import dev.waterdog.waterdogpe.event.defaults.PreClientDataSetEvent;
import dev.waterdog.waterdogpe.event.defaults.ServerTransferRequestEvent;
import dev.waterdog.waterdogpe.plugin.Plugin;
import edu.waterdog.bridge.auth.M365JwksVerifier;
import edu.waterdog.bridge.auth.XuidSynthesizer;
import edu.waterdog.bridge.config.EduBridgeConfig;
import edu.waterdog.bridge.handler.DownstreamForwardingListener;
import edu.waterdog.bridge.handler.EduJoinCodeGatekeeper;
import edu.waterdog.bridge.handler.EduLoginPacketInterceptor;

import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * EduBridgePlugin - Core WaterdogPE Plugin Entry Point.
 *
 * Bridges Microsoft 365 (Entra ID) Education Edition client authentication
 * directly into a native PowerNukkitX Bedrock server (${cfg.downstreamHost}:${cfg.downstreamPort})
 * without requiring a Java Edition backend or EduGeyser.
 *
 * Specifically tuned for low-resource Raspberry Pi 4 (ARM64) deployments.
 */
public final class EduBridgePlugin extends Plugin {

    private EduBridgeConfig bridgeConfig;
    private ExecutorService authExecutor;
    private M365JwksVerifier jwksVerifier;
    private XuidSynthesizer xuidSynthesizer;
    private EduJoinCodeGatekeeper joinCodeGatekeeper;
    private EduLoginPacketInterceptor loginInterceptor;
    private DownstreamForwardingListener downstreamListener;

    @Override
    public void onStartup() {
        getLogger().info("[EduBridge] Initializing M365 Education Edition Bridge for WaterdogPE...");
        saveDefaultConfig();
        this.bridgeConfig = EduBridgeConfig.load(new File(getDataFolder(), "config.yml"), getLogger());
    }

    @Override
    public void onEnable() {
        int workerThreads = Math.max(1, Math.min(4, this.bridgeConfig.getAsyncVerifierThreads()));
        this.authExecutor = Executors.newFixedThreadPool(workerThreads, new ThreadFactory() {
            private final AtomicInteger count = new AtomicInteger(1);
            @Override
            public Thread newThread(Runnable r) {
                Thread thread = new Thread(r, "EduBridge-RPi4-Verifier-" + count.getAndIncrement());
                thread.setDaemon(true);
                thread.setPriority(Thread.NORM_PRIORITY - 1);
                return thread;
            }
        });

        this.xuidSynthesizer = new XuidSynthesizer(this.bridgeConfig.getXuidHashSalt());
        this.jwksVerifier = new M365JwksVerifier(this.bridgeConfig, this.xuidSynthesizer, this.authExecutor, getLogger());
        this.joinCodeGatekeeper = new EduJoinCodeGatekeeper(this.bridgeConfig, getLogger());

        this.loginInterceptor = new EduLoginPacketInterceptor(
                this,
                this.bridgeConfig,
                this.jwksVerifier,
                this.xuidSynthesizer
        );

        this.downstreamListener = new DownstreamForwardingListener(
                this,
                this.bridgeConfig,
                this.loginInterceptor,
                this.joinCodeGatekeeper
        );

        // 1. Intercept PreClientDataSetEvent: Fired inside WaterdogPE HandshakeUtils
        // right before ClientData & ExtraData are finalized into LoginData.
        getProxy().getEventManager().subscribe(PreClientDataSetEvent.class, this.loginInterceptor::onPreClientDataSet);

        // 2. Intercept PlayerAuthenticatedEvent: Fired when handshake completes;
        // attaches our custom UpstreamPacketHandler to inspect LoginPacket & ModalFormResponsePacket.
        getProxy().getEventManager().subscribe(PlayerAuthenticatedEvent.class, this.loginInterceptor::onPlayerAuthenticated);

        // 3. Intercept PlayerLoginEvent: Enforces classroom Join Code gatekeeping and
        // logs verified M365 UPN + Tenant ID before initial connect to PowerNukkitX (port ${cfg.downstreamPort}).
        getProxy().getEventManager().subscribe(PlayerLoginEvent.class, this.downstreamListener::onPlayerLogin);

        // 4. Intercept ServerTransferRequestEvent: Ensures re-signed extraData JWT containing
        // M365 tenant & role metadata is forwarded to PowerNukkitX (port ${cfg.downstreamPort}).
        getProxy().getEventManager().subscribe(ServerTransferRequestEvent.class, this.downstreamListener::onServerTransferRequest);

        // 5. Cleanup session cache on disconnect to keep RPi4 heap usage minimal.
        getProxy().getEventManager().subscribe(PlayerDisconnectedEvent.class, this.downstreamListener::onPlayerDisconnect);

        getLogger().info(String.format(
                "[EduBridge] Active! Listening for Education Edition M365 clients (:19132) -> PowerNukkitX (%s:%d) [RPi4 Workers: %d]",
                this.bridgeConfig.getDownstreamHost(),
                this.bridgeConfig.getDownstreamPort(),
                workerThreads
        ));
    }

    @Override
    public void onDisable() {
        getLogger().info("[EduBridge] Shutting down M365 verification workers...");
        if (this.authExecutor != null) {
            this.authExecutor.shutdown();
            try {
                if (!this.authExecutor.awaitTermination(3, TimeUnit.SECONDS)) {
                    this.authExecutor.shutdownNow();
                }
            } catch (InterruptedException ignored) {
                this.authExecutor.shutdownNow();
                Thread.currentThread().interrupt();
            }
        }
    }

    private void saveDefaultConfig() {
        if (!getDataFolder().exists() && !getDataFolder().mkdirs()) {
            getLogger().warn("[EduBridge] Could not create plugin data directory!");
        }
        File configFile = new File(getDataFolder(), "config.yml");
        if (!configFile.exists()) {
            try (InputStream in = getResourceFile("config.yml")) {
                if (in != null) {
                    Files.copy(in, configFile.toPath());
                }
            } catch (Exception e) {
                getLogger().error("[EduBridge] Failed to write default config.yml", e);
            }
        }
    }

    public EduBridgeConfig getBridgeConfig() {
        return bridgeConfig;
    }
}`
    },
    {
      id: 'login-interceptor',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/waterdog/bridge/handler/EduLoginPacketInterceptor.java',
      name: 'EduLoginPacketInterceptor.java',
      module: 'waterdog-plugin',
      language: 'java',
      description: 'Captures incoming Education Edition handshakes in PreClientDataSetEvent & LoginPacket, validates M365 tokens, synthesizes 16-digit XUIDs, and injects extraData claims.',
      content: `package edu.waterdog.bridge.handler;

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
 * 1. Standard WaterdogPE checks if the LoginPacket certificate chain terminates at
 *    Mojang's retail Xbox Live Root Key (HandshakeUtils.MOJANG_PUBLIC_KEY).
 * 2. Education Edition clients sign in with Microsoft 365 (Entra ID) school tokens.
 * 3. By running WaterdogPE with online_mode: false and use_login_extras: true, this
 *    interceptor captures PreClientDataSetEvent, verifies the M365 JWT against
 *    Microsoft's OpenID JWKS endpoint, synthesizes a deterministic 16-digit XUID,
 *    and injects the verified M365 attributes into extraData & clientData.
 */
public final class EduLoginPacketInterceptor {

    private final EduBridgePlugin plugin;
    private final EduBridgeConfig config;
    private final M365JwksVerifier jwksVerifier;
    private final XuidSynthesizer xuidSynthesizer;

    private final Map<UUID, M365EducationIdentity> verifiedSessions = new ConcurrentHashMap<>();
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

    public void onPreClientDataSet(PreClientDataSetEvent event) {
        JsonObject clientData = event.getClientData();
        JsonObject extraData = event.getExtraData();

        String candidateM365Jwt = extractM365JwtFromHandshake(clientData, extraData, event.getConnection());
        boolean isEduClient = isEducationEditionClient(clientData, extraData) || candidateM365Jwt != null;

        if (!isEduClient) {
            if (!config.isAllowHybridRetailXbox()) {
                plugin.getLogger().warn("[EduBridge] Rejecting non-Education Edition client (hybrid retail Xbox disabled).");
                event.getConnection().disconnect("This server requires Minecraft: Education Edition with a School Microsoft 365 account.");
            }
            return;
        }

        Optional<M365EducationIdentity> verifiedOpt = Optional.empty();
        if (candidateM365Jwt != null) {
            verifiedOpt = jwksVerifier.verifyTokenSync(candidateM365Jwt);
        } else if (!config.isVerifyJwtSignature() && hasInlineM365Claims(clientData, extraData)) {
            verifiedOpt = parseInlineM365Claims(clientData, extraData);
        }

        if (verifiedOpt.isEmpty()) {
            plugin.getLogger().warn("[EduBridge] Blocked unverified M365 Education Edition handshake.");
            event.getConnection().disconnect("§cMicrosoft 365 School Authentication Failed.\\n§7Please sign in with an authorized school tenant account.");
            return;
        }

        M365EducationIdentity identity = verifiedOpt.get();

        // Populate Xbox-compatible identity fields so WaterdogPE & PowerNukkitX persist player data cleanly
        extraData.addProperty("XUID", identity.synthesizedXuid());
        extraData.addProperty("identity", identity.synthesizedUuid().toString());
        extraData.addProperty("displayName", identity.displayName());

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

    public void onPlayerAuthenticated(PlayerAuthenticatedEvent event) {
        ProxiedPlayer player = event.getPlayer();
        M365EducationIdentity identity = verifiedSessions.get(player.getUniqueId());
        if (identity != null) {
            plugin.getLogger().debug("[EduBridge] PlayerAuthenticatedEvent confirmed for M365 user " + identity.userPrincipalName());
        }
    }

    public BedrockPacketHandler createSessionPacketTap(
            ProxiedPlayer player,
            EduJoinCodeGatekeeper gatekeeper,
            Runnable onJoinCodeVerified
    ) {
        return new BedrockPacketHandler() {
            @Override
            public PacketSignal handle(LoginPacket packet) {
                for (String jwt : packet.getChain()) {
                    if (jwt != null && jwt.split("\\\\.").length == 3) {
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
        return extraData.has("tid") || extraData.has("m365_tenant_id") || clientData.has("TenantId");
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
}`
    },
    {
      id: 'downstream-listener',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/waterdog/bridge/handler/DownstreamForwardingListener.java',
      name: 'DownstreamForwardingListener.java',
      module: 'waterdog-plugin',
      language: 'java',
      description: 'Handles PlayerLoginEvent and ServerTransferRequestEvent. Uses HandshakeUtils.createExtraData(KeyPair, extraData) to re-sign the M365 claims for PowerNukkitX on port 19133.',
      content: `package edu.waterdog.bridge.handler;

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
 * Handles player connection events (PlayerLoginEvent, ServerTransferRequestEvent,
 * PlayerDisconnectedEvent) and guarantees that verified M365 Education metadata
 * is cryptographically signed by WaterdogPE and forwarded to PowerNukkitX (port ${cfg.downstreamPort}).
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

    public void onPlayerLogin(PlayerLoginEvent event) {
        ProxiedPlayer player = event.getPlayer();
        Optional<M365EducationIdentity> eduIdentityOpt = loginInterceptor.getVerifiedSession(player.getUniqueId());

        if (eduIdentityOpt.isEmpty()) {
            if (!config.isAllowHybridRetailXbox()) {
                event.setCancelReason("§cMicrosoft 365 Education Edition login required.");
                event.setCancelled(true);
            }
            return;
        }

        M365EducationIdentity identity = eduIdentityOpt.get();

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

    public void onServerTransferRequest(ServerTransferRequestEvent event) {
        ProxiedPlayer player = event.getPlayer();
        ServerInfo targetServer = event.getTargetServer();

        Optional<M365EducationIdentity> eduIdentityOpt = loginInterceptor.getVerifiedSession(player.getUniqueId());
        if (eduIdentityOpt.isEmpty()) {
            return;
        }

        M365EducationIdentity identity = eduIdentityOpt.get();

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

        if (config.isJoinCodeEnabled() && !joinCodeGatekeeper.isVerified(player.getUniqueId())) {
            plugin.getProxy().getScheduler().scheduleDelayed(() -> {
                if (player.isConnected() && !joinCodeGatekeeper.isVerified(player.getUniqueId())) {
                    joinCodeGatekeeper.sendJoinCodeChallengeForm(player);
                }
            }, 40);
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
}`
    },
    {
      id: 'jwks-verifier',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/waterdog/bridge/auth/M365JwksVerifier.java',
      name: 'M365JwksVerifier.java',
      module: 'waterdog-plugin',
      language: 'java',
      description: 'Validates Microsoft 365 Entra ID (Azure AD) RS256 JWT signatures against login.microsoftonline.com/{tenant}/discovery/v2.0/keys with bounded Caffeine caching.',
      content: `package edu.waterdog.bridge.auth;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.RemoteJWKSet;
import com.nimbusds.jose.proc.JWSKeySelector;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jose.util.DefaultResourceRetriever;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.nimbusds.jwt.proc.ConfigurableJWTProcessor;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import edu.waterdog.bridge.config.EduBridgeConfig;
import org.apache.logging.log4j.Logger;

import java.net.URI;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;

public final class M365JwksVerifier {

    private final EduBridgeConfig config;
    private final XuidSynthesizer xuidSynthesizer;
    private final ExecutorService executor;
    private final Logger logger;

    private final Cache<String, JWKSource<SecurityContext>> tenantJwksCache;
    private final Cache<String, M365EducationIdentity> verifiedTokenCache;

    public M365JwksVerifier(
            EduBridgeConfig config,
            XuidSynthesizer xuidSynthesizer,
            ExecutorService executor,
            Logger logger
    ) {
        this.config = config;
        this.xuidSynthesizer = xuidSynthesizer;
        this.executor = executor;
        this.logger = logger;

        this.tenantJwksCache = Caffeine.newBuilder()
                .maximumSize(32)
                .expireAfterWrite(config.getJwksCacheHours(), TimeUnit.HOURS)
                .build();

        this.verifiedTokenCache = Caffeine.newBuilder()
                .maximumSize(config.getMaxTokenCacheEntries())
                .expireAfterWrite(45, TimeUnit.MINUTES)
                .build();
    }

    public CompletableFuture<Optional<M365EducationIdentity>> verifyTokenAsync(String rawJwt) {
        return CompletableFuture.supplyAsync(() -> verifyTokenSync(rawJwt), this.executor);
    }

    public Optional<M365EducationIdentity> verifyTokenSync(String rawJwt) {
        if (rawJwt == null || rawJwt.isBlank()) {
            return Optional.empty();
        }

        M365EducationIdentity cached = this.verifiedTokenCache.getIfPresent(rawJwt);
        if (cached != null && cached.tokenExpiresAtEpochSeconds() > Instant.now().getEpochSecond()) {
            return Optional.of(cached);
        }

        try {
            SignedJWT signedJWT = SignedJWT.parse(rawJwt);
            JWTClaimsSet unverifiedClaims = signedJWT.getJWTClaimsSet();

            String tenantId = firstNonBlank(
                    unverifiedClaims.getStringClaim("tid"),
                    unverifiedClaims.getStringClaim("tenantId")
            );
            String objectId = firstNonBlank(
                    unverifiedClaims.getStringClaim("oid"),
                    unverifiedClaims.getSubject()
            );
            String upn = firstNonBlank(
                    unverifiedClaims.getStringClaim("upn"),
                    unverifiedClaims.getStringClaim("preferred_username"),
                    unverifiedClaims.getStringClaim("email")
            );
            String displayName = firstNonBlank(
                    unverifiedClaims.getStringClaim("name"),
                    unverifiedClaims.getStringClaim("displayName"),
                    upn
            );

            if (tenantId == null || objectId == null) {
                return Optional.empty();
            }

            if (!config.getAllowedTenantIds().isEmpty() && !config.getAllowedTenantIds().contains(tenantId)) {
                logger.warn("[EduBridge] Rejected login from unauthorized M365 Tenant ID: " + tenantId);
                return Optional.empty();
            }

            if (upn != null && upn.contains("@") && !config.getAllowedDomains().isEmpty()) {
                String domain = upn.substring(upn.indexOf('@') + 1).toLowerCase();
                if (!config.getAllowedDomains().contains(domain)) {
                    logger.warn("[EduBridge] Rejected M365 login from unauthorized email domain: " + domain);
                    return Optional.empty();
                }
            }

            Date exp = unverifiedClaims.getExpirationTime();
            long expEpoch = exp != null ? exp.toInstant().getEpochSecond() : Instant.now().plusSeconds(3600).getEpochSecond();
            if (exp != null && exp.before(new Date())) {
                logger.warn("[EduBridge] Rejected expired M365 Education token for UPN: " + upn);
                return Optional.empty();
            }

            if (config.isVerifyJwtSignature()) {
                JWKSource<SecurityContext> keySource = tenantJwksCache.get(tenantId, this::createRemoteJwkSource);
                ConfigurableJWTProcessor<SecurityContext> jwtProcessor = new DefaultJWTProcessor<>();
                JWSKeySelector<SecurityContext> keySelector = new JWSVerificationKeySelector<>(
                        JWSAlgorithm.RS256,
                        keySource
                );
                jwtProcessor.setJWSKeySelector(keySelector);
                jwtProcessor.process(signedJWT, null);
            }

            String eduRole = resolveEduRole(unverifiedClaims, upn);
            String synthesizedXuid = xuidSynthesizer.deriveEducationXuid(tenantId, objectId);
            UUID synthesizedUuid = xuidSynthesizer.deriveEducationUuid(tenantId, objectId);

            M365EducationIdentity identity = new M365EducationIdentity(
                    tenantId,
                    objectId,
                    upn != null ? upn : (objectId + "@tenant.local"),
                    xuidSynthesizer.sanitizeBedrockUsername(displayName, upn),
                    synthesizedXuid,
                    synthesizedUuid,
                    eduRole,
                    "Minecraft: Education Edition (M365)",
                    expEpoch
            );

            this.verifiedTokenCache.put(rawJwt, identity);
            return Optional.of(identity);

        } catch (Exception e) {
            logger.warn("[EduBridge] M365 JWT verification failed: " + e.getMessage());
            return Optional.empty();
        }
    }

    private JWKSource<SecurityContext> createRemoteJwkSource(String tenantId) {
        try {
            String uri = config.getJwksUriTemplate().replace("{tenant}", tenantId);
            DefaultResourceRetriever retriever = new DefaultResourceRetriever(2500, 2500, 512 * 1024);
            return new RemoteJWKSet<>(URI.create(uri).toURL(), retriever);
        } catch (Exception e) {
            throw new IllegalStateException("Invalid JWKS URI for tenant " + tenantId, e);
        }
    }

    private String resolveEduRole(JWTClaimsSet claims, String upn) {
        try {
            List<String> roles = claims.getStringListClaim("roles");
            if (roles != null) {
                for (String role : roles) {
                    if (role.toLowerCase().contains("teacher") || role.toLowerCase().contains("faculty") || role.toLowerCase().contains("admin")) {
                        return "teacher";
                    }
                }
            }
            String eduRoleClaim = claims.getStringClaim("edu_role");
            if (eduRoleClaim != null && !eduRoleClaim.isBlank()) {
                return eduRoleClaim.toLowerCase();
            }
        } catch (Exception ignored) {
        }

        if (upn != null && upn.contains("@")) {
            String domain = upn.substring(upn.indexOf('@') + 1).toLowerCase();
            if (config.getTeacherDomains().contains(domain)) {
                return "teacher";
            }
        }
        return "student";
    }

    private static String firstNonBlank(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) {
                return v;
            }
        }
        return null;
    }
}`
    },
    {
      id: 'join-code-gatekeeper',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/waterdog/bridge/handler/EduJoinCodeGatekeeper.java',
      name: 'EduJoinCodeGatekeeper.java',
      module: 'waterdog-plugin',
      language: 'java',
      description: 'Replaces EduGeyser classroom Join Codes natively in WaterdogPE using ModalFormRequestPacket (formId 19133) and ClientData inspection.',
      content: `package edu.waterdog.bridge.handler;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.waterdog.waterdogpe.player.ProxiedPlayer;
import edu.waterdog.bridge.config.EduBridgeConfig;
import org.apache.logging.log4j.Logger;
import org.cloudburstmc.protocol.bedrock.packet.ModalFormRequestPacket;
import org.cloudburstmc.protocol.bedrock.packet.ModalFormResponsePacket;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

public final class EduJoinCodeGatekeeper {

    public static final int JOIN_CODE_FORM_ID = 19133;

    private final EduBridgeConfig config;
    private final Logger logger;
    private final Cache<UUID, Boolean> verifiedJoinCodeSessions;

    public EduJoinCodeGatekeeper(EduBridgeConfig config, Logger logger) {
        this.config = config;
        this.logger = logger;
        this.verifiedJoinCodeSessions = Caffeine.newBuilder()
                .maximumSize(512)
                .expireAfterWrite(config.getSessionTtlMinutes(), TimeUnit.MINUTES)
                .build();
    }

    public boolean isVerified(UUID playerUuid) {
        if (!config.isJoinCodeEnabled()) {
            return true;
        }
        return Boolean.TRUE.equals(verifiedJoinCodeSessions.getIfPresent(playerUuid));
    }

    public void markVerified(UUID playerUuid) {
        verifiedJoinCodeSessions.put(playerUuid, Boolean.TRUE);
    }

    public boolean verifyCodeInput(UUID playerUuid, String submittedCode) {
        if (!config.isJoinCodeEnabled()) {
            return true;
        }
        if (submittedCode == null) {
            return false;
        }
        String normalizedSubmitted = normalizeJoinCode(submittedCode);
        String normalizedExpected = normalizeJoinCode(config.getActiveJoinCode());

        if (normalizedExpected.equals(normalizedSubmitted)) {
            markVerified(playerUuid);
            return true;
        }
        return false;
    }

    public void sendJoinCodeChallengeForm(ProxiedPlayer player) {
        JsonObject form = new JsonObject();
        form.addProperty("type", "custom_form");
        form.addProperty("title", config.getPromptTitle());

        JsonArray content = new JsonArray();

        JsonObject label = new JsonObject();
        label.addProperty("type", "label");
        label.addProperty("text", config.getPromptSubtitle());
        content.add(label);

        JsonObject input = new JsonObject();
        input.addProperty("type", "input");
        input.addProperty("text", "Classroom Join Code");
        input.addProperty("placeholder", "e.g. ${cfg.activeJoinCode}");
        input.addProperty("default", "");
        content.add(input);

        form.add("content", content);

        ModalFormRequestPacket packet = new ModalFormRequestPacket();
        packet.setFormId(JOIN_CODE_FORM_ID);
        packet.setFormData(form.toString());

        player.sendPacket(packet);
    }

    public boolean handleModalResponse(ProxiedPlayer player, ModalFormResponsePacket packet) {
        if (packet.getFormId() != JOIN_CODE_FORM_ID) {
            return false;
        }

        String formData = packet.getFormData();
        if (formData == null || formData.isBlank() || "null".equals(formData.trim())) {
            player.disconnect("§cClassroom Join Code is required to join this server.");
            return true;
        }

        try {
            JsonArray responses = JsonParser.parseString(formData).getAsJsonArray();
            String enteredCode = responses.size() > 1 && !responses.get(1).isJsonNull()
                    ? responses.get(1).getAsString()
                    : "";

            if (verifyCodeInput(player.getUniqueId(), enteredCode)) {
                logger.info("[EduBridge] Student " + player.getName() + " passed Classroom Join Code challenge.");
                player.sendMessage("§a[EduBridge] Classroom Join Code verified! Connected to PowerNukkitX.");
            } else {
                logger.warn("[EduBridge] Student " + player.getName() + " entered invalid Join Code: " + enteredCode);
                player.disconnect("§cInvalid Classroom Join Code.\\n§7Please check the code on your teacher's board and try again.");
            }
        } catch (Exception e) {
            player.disconnect("§cFailed to verify Classroom Join Code response.");
        }
        return true;
    }

    private static String normalizeJoinCode(String raw) {
        return raw.trim().toUpperCase().replaceAll("[\\\\s_]+", "-");
    }
}`
    },
    {
      id: 'xuid-synthesizer',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/waterdog/bridge/auth/XuidSynthesizer.java',
      name: 'XuidSynthesizer.java',
      module: 'waterdog-plugin',
      language: 'java',
      description: 'Derives deterministic 16-digit numeric XUIDs (29xxxxxxxxxxxxxx) and UUIDs from M365 Tenant ID + Object ID so PowerNukkitX saves student inventories reliably.',
      content: `package edu.waterdog.bridge.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;

public final class XuidSynthesizer {

    private final String salt;

    public XuidSynthesizer(String salt) {
        this.salt = salt != null ? salt : "${cfg.xuidHashSalt}";
    }

    public String deriveEducationXuid(String tenantId, String objectId) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            String composite = this.salt + ":" + tenantId.toLowerCase() + ":" + objectId.toLowerCase();
            byte[] hash = digest.digest(composite.getBytes(StandardCharsets.UTF_8));

            long value = 0L;
            for (int i = 0; i < 7; i++) {
                value = (value << 8) | (hash[i] & 0xFFL);
            }
            long positive14Digits = Math.abs(value) % 100_000_000_000_000L;
            return String.format("29%014d", positive14Digits);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable on JVM", e);
        }
    }

    public UUID deriveEducationUuid(String tenantId, String objectId) {
        String seed = "urn:m365:mc-edu:" + tenantId.toLowerCase() + ":" + objectId.toLowerCase();
        return UUID.nameUUIDFromBytes(seed.getBytes(StandardCharsets.UTF_8));
    }

    public String sanitizeBedrockUsername(String displayName, String upn) {
        String candidate = (displayName != null && !displayName.isBlank())
                ? displayName
                : (upn != null && upn.contains("@") ? upn.substring(0, upn.indexOf('@')) : "EduStudent");

        String cleaned = candidate.replaceAll("[^A-Za-z0-9_]", "_");
        if (cleaned.length() > 16) {
            cleaned = cleaned.substring(0, 16);
        }
        return cleaned.isEmpty() ? "EduStudent" : cleaned;
    }
}`
    },
    {
      id: 'm365-identity',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/waterdog/bridge/auth/M365EducationIdentity.java',
      name: 'M365EducationIdentity.java',
      module: 'waterdog-plugin',
      language: 'java',
      description: 'Immutable record storing verified Microsoft 365 claims and synthesized Bedrock identifiers.',
      content: `package edu.waterdog.bridge.auth;

import java.util.UUID;

public record M365EducationIdentity(
        String tenantId,
        String objectId,
        String userPrincipalName,
        String displayName,
        String synthesizedXuid,
        UUID synthesizedUuid,
        String eduRole,
        String clientEdition,
        long tokenExpiresAtEpochSeconds
) {
    public boolean isTeacher() {
        return "teacher".equalsIgnoreCase(eduRole) || "faculty".equalsIgnoreCase(eduRole);
    }
}`
    },
    {
      id: 'pnx-receiver',
      path: 'waterdog-edubridge-plugin/powernukkitx-companion/src/main/java/cn/powernukkitx/edubridge/PnxEduBridgeReceiverPlugin.java',
      name: 'PnxEduBridgeReceiverPlugin.java',
      module: 'pnx-companion',
      language: 'java',
      description: 'Companion PowerNukkitX listener (port 19133) that reads Waterdog_M365TenantId, Waterdog_M365Upn, and Waterdog_EduRole from LoginChainData.',
      content: `package cn.powernukkitx.edubridge;

import cn.nukkit.Player;
import cn.nukkit.event.EventHandler;
import cn.nukkit.event.EventPriority;
import cn.nukkit.event.Listener;
import cn.nukkit.event.player.PlayerLoginEvent;
import cn.nukkit.plugin.PluginBase;
import cn.nukkit.utils.LoginChainData;
import com.google.gson.JsonObject;

/**
 * Companion PowerNukkitX Plugin (Runs on Backend Port ${cfg.downstreamPort}).
 *
 * Reads the M365 Tenant ID, Student UPN, and Education Role ('teacher' / 'student')
 * forwarded by EduBridge-WaterdogPE via clientData / extraData on port ${cfg.downstreamPort}.
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

        if ("teacher".equalsIgnoreCase(eduRole)) {
            player.setOp(true);
            getLogger().info("[PNX-EduBridge] Granted Classroom Teacher OP permissions to " + player.getName() + " (" + upn + ")");
        }
    }
}`
    },
    {
      id: 'waterdog-proxy-yml',
      path: 'waterdog-edubridge-plugin/waterdog-proxy-config.yml',
      name: 'waterdog-proxy-config.yml',
      module: 'deployment-config',
      language: 'yaml',
      description: 'Reference WaterdogPE config.yml for Raspberry Pi 4 showing online_mode: false, use_login_extras: true, and downstream PowerNukkitX routing.',
      content: `# ============================================================================
# WaterdogPE Proxy Configuration (Raspberry Pi 4 - Port 19132)
# Paired with EduBridge Plugin -> PowerNukkitX Backend (Port ${cfg.downstreamPort})
# ============================================================================

listener:
  host: 0.0.0.0:19132
  max_players: 40
  motd: "§bOakridge School §7- §aMinecraft Education Edition"
  sub_motd: "§fM365 Authenticated Classroom Server"
  forced_host: "${cfg.downstreamServerName}"

# CRITICAL FOR M365 EDUCATION EDITION INTERCEPTION:
# Set online_mode: false so WaterdogPE does not immediately drop Education Edition
# clients whose JWT chain is signed by Microsoft 365 Entra ID instead of Mojang's
# retail Xbox Live root key. The EduBridge plugin's PreClientDataSetEvent listener
# cryptographically enforces M365 OIDC/JWKS verification before login completes!
online_mode: false

# MUST BE TRUE: Enables WaterdogPE to sign and forward extraData & clientData JWTs
# (containing m365_tenant_id, m365_upn, edu_role, and synthesized XUID) to PowerNukkitX.
use_login_extras: true

ip_forward: true
prefer_fast_transfer: true
enable_edu_features: true
pack_cache_size: 16
default_idle_threads: ${cfg.asyncVerifierThreads}

servers:
  ${cfg.downstreamServerName}:
    address: ${cfg.downstreamHost}:${cfg.downstreamPort}
    public_address: ${cfg.downstreamHost}:${cfg.downstreamPort}
    server_type: bedrock
`
    }
  ];
}
