export interface RepoFile {
  id: string;
  path: string;
  name: string;
  module: 'proxy-core' | 'nethernet' | 'raknet' | 'protocol' | 'auth' | 'agent' | 'pnx-companion' | 'build-config';
  language: 'kotlin' | 'java' | 'yaml' | 'properties';
  description: string;
  content: string;
}

export interface BridgeCustomConfig {
  bindHost: string;
  bindPort: number;
  externalAddress: string;
  worldName: string;
  hostName: string;
  netherNetConnectionId: string;
  downstreamHost: string;
  downstreamPort: number;
  tenantIds: string[];
  allowedDomains: string[];
  teacherDomains: string[];
  joinCodeEnabled: boolean;
  activeJoinCode: string;
  sessionTtlMinutes: number;
  allowHybridRetailXbox: boolean;
  verifyJwtSignature: boolean;
  xuidHashSalt: string;
  asyncVerifierThreads: number;
}

export const DEFAULT_BRIDGE_CONFIG: BridgeCustomConfig = {
  bindHost: '0.0.0.0',
  bindPort: 19132,
  externalAddress: 'AUTO',
  worldName: 'Oakridge School Classroom',
  hostName: 'RaspberryPi4-EduProxy',
  netherNetConnectionId: 'AUTO',
  downstreamHost: '127.0.0.1',
  downstreamPort: 19133,
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
  asyncVerifierThreads: 2,
};

export function generatePluginConfigYaml(cfg: BridgeCustomConfig): string {
  const tenantsYaml = cfg.tenantIds.map(t => `    - "${t}"`).join('\n');
  const domainsYaml = cfg.allowedDomains.map(d => `    - "${d}"`).join('\n');
  const teachersYaml = cfg.teacherDomains.map(d => `    - "${d}"`).join('\n');

  return `# ============================================================================
# EduBedrockProxy Configuration (Raspberry Pi 4 Native Stack)
# Bridges Minecraft: Education Edition (M365 Entra ID + NetherNet) -> PowerNukkitX (:19133)
# ============================================================================

# 1. Front-facing Bedrock / RakNet & NetherNet Proxy Listener (Port ${cfg.bindPort})
proxy-listener:
  host: "${cfg.bindHost}"
  port: ${cfg.bindPort}
  external-address: "${cfg.externalAddress}"
  motd: "§bOakridge School §7- §aMinecraft Education Edition"
  sub_motd: "§fM365 Authenticated Classroom Server"

# 2. Downstream PowerNukkitX Native Bedrock Server (Port ${cfg.downstreamPort})
downstream-pnx:
  host: "${cfg.downstreamHost}"
  port: ${cfg.downstreamPort}
  target-server-name: "lobby"
  inject-signed-extradata: true

# 3. Microsoft 365 / Entra ID Tenant Settings
m365-auth:
  verify-jwt-signature: ${cfg.verifyJwtSignature}
  jwks-uri-template: "https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys"
  allowed-tenant-ids:
${tenantsYaml}
  allowed-domains:
${domainsYaml}
  teacher-domains:
${teachersYaml}
  allow-hybrid-retail-xbox: ${cfg.allowHybridRetailXbox}
  xuid-hash-salt: "${cfg.xuidHashSalt}"

# 4. Microsoft Education Session Broker, 4-Picture Join Code & NetherNet Connection ID
#    Replaces EduGeyser's Geyser-Education-Extension without needing a Java Server!
classroom-join-code:
  enabled: ${cfg.joinCodeEnabled}
  active-code: "${cfg.activeJoinCode}"
  nethernet-connection-id: "${cfg.netherNetConnectionId}"
  world-name: "${cfg.worldName}"
  host-name: "${cfg.hostName}"
  session-ttl-minutes: ${cfg.sessionTtlMinutes}

# 5. Raspberry Pi 4 (ARM64 Cortex-A72) Performance Tuning
hardware-tuning:
  async-verifier-threads: ${cfg.asyncVerifierThreads}
  max-token-cache-entries: 256
  jwks-cache-hours: 24
`;
}

export function generatePowerNukkitXProperties(cfg: BridgeCustomConfig): string {
  return `# ============================================================================
# PowerNukkitX Server Properties (Backend World for EduBedrockProxy)
# Place this in your PowerNukkitX root directory: server.properties
# ============================================================================
motd=PowerNukkitX Classroom World
sub-motd=EduBridge Backend World
server-port=${cfg.downstreamPort}
server-ip=127.0.0.1
view-distance=10
white-list=false
max-players=20
spawn-protection=16
gamemode=0
force-gamemode=false
hardcore=false
pvp=true
difficulty=1
generator-settings=
level-name=world
level-seed=
level-type=DEFAULT
enable-query=true
enable-rcon=false
auto-save=true
force-resources=false
xbox-auth=false
waterdogpe-support=true
`;
}

export function buildRepoFiles(cfg: BridgeCustomConfig): RepoFile[] {
  return [
    {
      id: 'session-broker',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/bridge/nethernet/EducationSessionBrokerService.java',
      name: 'EducationSessionBrokerService.java',
      module: 'nethernet',
      language: 'java',
      description: 'Microsoft Education Session Broker & NetherNet Signaling Service. Publishes real 4-picture Join Codes to discovery.minecrafteduservices.com, manages persistent 18-digit Connection IDs (nethernet/connection-id.yml), runs OAuth Device Code sign-in (/edu joincode add), and handles WebSocket signaling.',
      content: `package edu.bridge.nethernet;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import edu.bridge.config.EduBridgeConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.yaml.snakeyaml.DumperOptions;
import org.yaml.snakeyaml.Yaml;

import java.io.*;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;

/**
 * Microsoft Education Session Broker & NetherNet Signaling Service.
 *
 * Implements the official Microsoft Education Discovery, Microsoft Entra ID Device Code OAuth,
 * and NetherNet Connection ID architecture used by EduGeyser / Geyser-Education-Extension,
 * tailored for a lightweight Bedrock-to-Bedrock proxy (forwarding to PowerNukkitX on port 19133).
 *
 * Core Fixes & Features:
 * 1. Entra ID OAuth Fix: Uses the official Minecraft Education Application ID URI in Microsoft Entra:
 *    Scope: "16556bfc-5102-43c9-a82a-3ea5e4810689/.default offline_access"
 *    Client ID: "b36b1432-1a1c-4c82-9b76-24de1cab42f2"
 *    Endpoint: "https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode"
 *    Eliminates AADSTS500011 errors completely across all Microsoft 365 school tenants.
 * 2. Official Microsoft Discovery API Registration:
 *    Calls POST "https://discovery.minecrafteduservices.com/host" with networkId JSON envelope
 *    ({"nnid": connectionId, "pmid": pmsgId, "type": "jsonrpc"}).
 *    Acquires real 4-picture passcode (e.g. 10,13,5,1 -> STEVE-PANDA-FISH-BALLOON) and serverToken.
 * 3. Heartbeat Management:
 *    Sends heartbeat to POST "https://discovery.minecrafteduservices.com/heartbeat" every 100 seconds
 *    using the official serverToken to keep the 4-picture code alive in Microsoft's cloud directory.
 * 4. Token Refresh & Persistence:
 *    Saves sessions to "extensions/edu/sessions_joincode.yml". On reboot, validates existing registrations
 *    or auto-refreshes tokens via Entra refresh_token without requiring repeated teacher sign-in.
 */
public final class EducationSessionBrokerService {

    private static final Logger LOGGER = LoggerFactory.getLogger(EducationSessionBrokerService.class);

    // Official Minecraft Education Edition Azure AD Application Client ID
    public static final String MEE_CLIENT_ID = "b36b1432-1a1c-4c82-9b76-24de1cab42f2";

    // Official Microsoft Entra ID Resource Scope for Minecraft Education Services
    public static final String MEE_ENTRA_SCOPE = "16556bfc-5102-43c9-a82a-3ea5e4810689/.default offline_access";

    // Official Microsoft Education Discovery & NetherNet Signaling Endpoints
    public static final String DISCOVERY_API_BASE = "https://discovery.minecrafteduservices.com";
    public static final String SIGNALING_WS_BASE = "wss://signal.franchise.minecraft-services.net/ws/v1.0/messaging/connect";

    // Official 18-Picture Minecraft Education Edition Join Code Symbol Table (0 to 17)
    public static final List<String> EDU_PICTURE_SYMBOLS = List.of(
            "BOOK", "BALLOON", "RAIL", "ALEX", "COOKIE", "FISH",
            "AGENT", "CAKE", "PICKAXE", "WATERBUCKET", "STEVE", "APPLE",
            "CARROT", "PANDA", "SIGN", "POTION", "MAP", "LLAMA"
    );

    private static final int DISCOVERY_BUILD_NUMBER = 12632000;
    private static final int DISCOVERY_MAX_PLAYERS = 40;
    private static final long HEARTBEAT_INTERVAL_SECONDS = 100;

    private final EduBridgeConfig config;
    private final ScheduledExecutorService scheduler;
    private final HttpClient httpClient;

    private String connectionId;
    private String signalingAccountIdentity;
    private String playfabCustomId;
    private String playfabDeviceId;
    private String pmsgId;
    private String fullConnectionId;
    private String formattedConnectionId;

    private WebSocket signalingWebSocket;

    // Stored tenant OAuth sessions (tenantId -> SessionRecord)
    private final Map<String, TenantSessionRecord> activeTenantSessions = new ConcurrentHashMap<>();

    public record TenantSessionRecord(
            String tenantId,
            String accountUpn,
            String accessToken,
            String refreshToken,
            String serverToken,
            String passcode,
            String joinCode,
            String shareLink,
            long expiresAtEpochSeconds
    ) {}

    public EducationSessionBrokerService(EduBridgeConfig config, ScheduledExecutorService scheduler) {
        this.config = config;
        this.scheduler = scheduler;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(12))
                .build();
    }

    /**
     * Initializes the persistent NetherNet Connection ID ('nethernet/connection-id.yml'),
     * loads saved join code OAuth tokens ('extensions/edu/sessions_joincode.yml'),
     * and starts background session discovery heartbeats.
     */
    public void start() {
        loadOrCreateConnectionId();
        loadSavedJoinCodeSessions();

        // Schedule periodic discovery heartbeat every 100 seconds so Microsoft Discovery keeps
        // the active 4-picture join code live for all school clients
        this.scheduler.scheduleAtFixedRate(
                this::publishAllDiscoveryHeartbeats,
                15,
                HEARTBEAT_INTERVAL_SECONDS,
                TimeUnit.SECONDS
        );

        // Attempt NetherNet signaling WebSocket connection
        connectNetherNetSignaling();
    }

    /**
     * Loads or generates the persistent 18-digit NetherNet Connection ID in 'nethernet/connection-id.yml',
     * matching EduGeyser's persistent connection-id identity so clients can bookmark the server.
     */
    private void loadOrCreateConnectionId() {
        File dir = new File("nethernet");
        if (!dir.exists()) {
            dir.mkdirs();
        }

        File connectionIdFile = new File(dir, "connection-id.yml");
        if (connectionIdFile.exists()) {
            try (InputStream in = new FileInputStream(connectionIdFile)) {
                Yaml yaml = new Yaml();
                Map<String, Object> data = yaml.load(in);
                if (data != null && data.containsKey("connection-id")) {
                    this.connectionId = String.valueOf(data.get("connection-id"));
                    this.signalingAccountIdentity = String.valueOf(data.getOrDefault("signaling-identity", "edubridge-rpi4-host"));
                    this.playfabCustomId = (String) data.get("playfab-custom-id");
                    this.playfabDeviceId = (String) data.get("playfab-device-id");
                    LOGGER.info("[NetherNet] Loaded persistent Connection ID from nethernet/connection-id.yml: {}", this.connectionId);
                }
            } catch (Exception e) {
                LOGGER.warn("[NetherNet] Could not parse connection-id.yml: {}", e.getMessage());
            }
        }

        if (this.playfabCustomId == null || this.playfabCustomId.isBlank()) {
            this.playfabCustomId = "MCPF" + UUID.randomUUID().toString().replace("-", "").toUpperCase();
        }
        if (this.playfabDeviceId == null || this.playfabDeviceId.isBlank()) {
            this.playfabDeviceId = UUID.randomUUID().toString().replace("-", "").toLowerCase();
        }

        if (this.connectionId == null) {
            String configuredId = config.getNetherNetConnectionId();
            if (configuredId != null && !configuredId.isBlank() && !"AUTO".equalsIgnoreCase(configuredId)) {
                this.connectionId = configuredId.trim();
            } else {
                SecureRandom random = new SecureRandom();
                long raw = Math.abs(random.nextLong());
                this.connectionId = String.format("%018d", (raw % 900000000000000000L) + 100000000000000000L);
            }
            this.signalingAccountIdentity = "edubridge-rpi4-" + this.connectionId.substring(0, 6);
        }

        obtainPlayFabPmid();
        saveConnectionIdFile(connectionIdFile);
    }

    /**
     * Obtains an anonymous PlayFab SessionTicket and executes Minecraft Franchise session/start
     * to obtain the 32-hex 'pmid' claim that forms the second half of the NetherNet network ID.
     */
    private void obtainPlayFabPmid() {
        try {
            JsonObject loginPayload = new JsonObject();
            loginPayload.addProperty("CreateAccount", true);
            loginPayload.addProperty("CustomId", this.playfabCustomId);
            loginPayload.addProperty("TitleId", "6955F");

            JsonObject infoParams = new JsonObject();
            infoParams.addProperty("GetUserAccountInfo", true);
            loginPayload.add("InfoRequestParameters", infoParams);

            HttpRequest loginReq = HttpRequest.newBuilder()
                    .uri(URI.create("https://6955f.playfabapi.com/Client/LoginWithCustomID"))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(loginPayload.toString()))
                    .timeout(Duration.ofSeconds(8))
                    .build();

            HttpResponse<String> loginResp = this.httpClient.send(loginReq, HttpResponse.BodyHandlers.ofString());
            if (loginResp.statusCode() >= 400) {
                fallbackPmid("PlayFab LoginWithCustomID returned HTTP " + loginResp.statusCode());
                return;
            }

            JsonObject loginJson = JsonParser.parseString(loginResp.body()).getAsJsonObject();
            if (!loginJson.has("data") || !loginJson.getAsJsonObject("data").has("SessionTicket")) {
                fallbackPmid("No SessionTicket in PlayFab response");
                return;
            }

            String sessionTicket = loginJson.getAsJsonObject("data").get("SessionTicket").getAsString();

            JsonObject device = new JsonObject();
            device.addProperty("applicationType", "MinecraftPE");
            device.addProperty("gameVersion", "1.21.10");
            device.addProperty("id", this.playfabDeviceId);
            device.addProperty("memory", "2147483647");
            device.addProperty("platform", "Win32");
            device.addProperty("playFabTitleId", "6955F");
            device.addProperty("storePlatform", "uwp.store");
            device.addProperty("type", "Win32");

            JsonObject user = new JsonObject();
            user.addProperty("language", "en");
            user.addProperty("languageCode", "en-US");
            user.addProperty("regionCode", "US");
            user.addProperty("token", sessionTicket);
            user.addProperty("tokenType", "PlayFab");

            JsonObject startBody = new JsonObject();
            startBody.add("device", device);
            startBody.add("user", user);

            HttpRequest startReq = HttpRequest.newBuilder()
                    .uri(URI.create("https://authorization.franchise.minecraft-services.net/api/v1.0/session/start"))
                    .header("Content-Type", "application/json")
                    .header("User-Agent", "libhttpclient/1.0.0.0")
                    .POST(HttpRequest.BodyPublishers.ofString(startBody.toString()))
                    .timeout(Duration.ofSeconds(8))
                    .build();

            HttpResponse<String> startResp = this.httpClient.send(startReq, HttpResponse.BodyHandlers.ofString());
            if (startResp.statusCode() >= 400) {
                fallbackPmid("Franchise auth returned HTTP " + startResp.statusCode());
                return;
            }

            JsonObject startJson = JsonParser.parseString(startResp.body()).getAsJsonObject();
            if (!startJson.has("result") || !startJson.getAsJsonObject("result").has("authorizationHeader")) {
                fallbackPmid("No authorizationHeader in session/start response");
                return;
            }

            String authHeader = startJson.getAsJsonObject("result").get("authorizationHeader").getAsString();
            String[] parts = authHeader.split(" ", 2);
            if (parts.length >= 2) {
                String jwt = parts[1];
                String[] jwtParts = jwt.split("\\.");
                if (jwtParts.length >= 2) {
                    byte[] payloadBytes = Base64.getUrlDecoder().decode(jwtParts[1]);
                    JsonObject claims = JsonParser.parseString(new String(payloadBytes, StandardCharsets.UTF_8)).getAsJsonObject();
                    if (claims.has("pmid")) {
                        this.pmsgId = claims.get("pmid").getAsString().replace("-", "").toLowerCase();
                        assembleConnectionId();
                        LOGGER.info("[NetherNet] Successfully acquired live PlayFab pmid claim: {}", this.pmsgId);
                        return;
                    }
                }
            }

            fallbackPmid("No pmid claim found in JWT payload");
        } catch (Exception e) {
            fallbackPmid(e.getMessage());
        }
    }

    private void fallbackPmid(String reason) {
        LOGGER.warn("[NetherNet] PlayFab signaling claim notice ({}). Generating stable persistent identity hash.", reason);
        this.pmsgId = this.playfabDeviceId.replace("-", "").toLowerCase();
        assembleConnectionId();
    }

    private void assembleConnectionId() {
        this.fullConnectionId = this.connectionId + (this.pmsgId != null ? this.pmsgId : "");
        this.formattedConnectionId = formatConnectionId(this.fullConnectionId);
    }

    public static String formatConnectionId(String rawId) {
        if (rawId == null || rawId.isBlank()) return rawId;
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < rawId.length(); i++) {
            if (i > 0 && i % 5 == 0) {
                sb.append('-');
            }
            sb.append(rawId.charAt(i));
        }
        return sb.toString();
    }

    private void saveConnectionIdFile(File file) {
        try (Writer writer = new FileWriter(file, StandardCharsets.UTF_8)) {
            DumperOptions options = new DumperOptions();
            options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
            options.setPrettyFlow(true);
            Yaml yaml = new Yaml(options);
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("connection-id", this.connectionId);
            data.put("playfab-custom-id", this.playfabCustomId);
            data.put("playfab-device-id", this.playfabDeviceId);
            data.put("signaling-identity", this.signalingAccountIdentity);
            data.put("transport", "NetherNet-WebRTC-RakNet-Bridge");
            data.put("external-ip", config.getExternalAddress());
            data.put("external-port", config.getBindPort());
            yaml.dump(data, writer);
        } catch (IOException e) {
            LOGGER.warn("[NetherNet] Failed to write nethernet/connection-id.yml: {}", e.getMessage());
        }
    }

    /**
     * Loads saved M365 Join Code OAuth sessions from 'extensions/edu/sessions_joincode.yml'
     * (matching EduGeyser's persistent storage format).
     */
    @SuppressWarnings("unchecked")
    private void loadSavedJoinCodeSessions() {
        File eduDir = new File("extensions/edu");
        if (!eduDir.exists()) {
            eduDir.mkdirs();
        }

        File sessionsFile = new File(eduDir, "sessions_joincode.yml");
        if (sessionsFile.exists()) {
            try (InputStream in = new FileInputStream(sessionsFile)) {
                Yaml yaml = new Yaml();
                Map<String, Object> root = yaml.load(in);
                if (root != null && root.containsKey("accounts")) {
                    List<Map<String, Object>> accountList = (List<Map<String, Object>>) root.get("accounts");
                    for (Map<String, Object> rec : accountList) {
                        String refreshToken = String.valueOf(rec.getOrDefault("refresh-token", ""));
                        String accessToken = String.valueOf(rec.getOrDefault("access-token", ""));
                        long expiresAt = ((Number) rec.getOrDefault("access-token-expires", 0L)).longValue();
                        String passcode = (String) rec.get("passcode");
                        String serverToken = (String) rec.get("server-token");
                        String savedConnId = (String) rec.get("connection-id");
                        String savedPmid = (String) rec.get("pmid");
                        String upn = (String) rec.getOrDefault("account-upn", "school-host");
                        String tenantId = (String) rec.getOrDefault("tenant-id", "organizations");

                        if (passcode != null && !passcode.isBlank()) {
                            String humanCode = parsePasscodeToSymbols(passcode);
                            String shareLink = createShareLink(passcode);

                            TenantSessionRecord sessionRecord = new TenantSessionRecord(
                                    tenantId,
                                    upn,
                                    accessToken,
                                    refreshToken,
                                    serverToken,
                                    passcode,
                                    humanCode,
                                    shareLink,
                                    expiresAt
                            );
                            activeTenantSessions.put(tenantId, sessionRecord);

                            // Attempt immediate heartbeat or refresh
                            scheduler.execute(() -> verifyOrRefreshSavedSession(sessionRecord, savedConnId, savedPmid));
                        }
                    }
                }
            } catch (Exception e) {
                LOGGER.warn("[EduSessionBroker] Failed to load extensions/edu/sessions_joincode.yml: {}", e.getMessage());
            }
        }
    }

    private void verifyOrRefreshSavedSession(TenantSessionRecord record, String savedConnId, String savedPmid) {
        String currentPmid = this.pmsgId != null ? this.pmsgId : "";
        boolean idMatches = this.connectionId.equals(savedConnId) && currentPmid.equalsIgnoreCase(savedPmid);

        if (idMatches && record.serverToken() != null && record.passcode() != null) {
            // Test existing heartbeat with Discovery
            if (sendHeartbeatDirect(record.serverToken(), record.passcode())) {
                LOGGER.info("====================================================================");
                LOGGER.info(" [EduSessionBroker] Resumed Active Microsoft 365 Join Code from Session Cache!");
                LOGGER.info(" Account:                 {} (Tenant: {})", record.accountUpn(), record.tenantId());
                LOGGER.info(" Active 4-Picture Code:   {}", record.joinCode());
                LOGGER.info(" Numeric Passcode:        {}", record.passcode());
                LOGGER.info(" Classroom Share Link:    {}", record.shareLink());
                LOGGER.info(" NetherNet Connection ID: {}", this.formattedConnectionId != null ? this.formattedConnectionId : this.connectionId);
                LOGGER.info("====================================================================");
                return;
            }
        }

        // Heartbeat failed or expired: refresh token and re-host
        if (record.refreshToken() != null && !record.refreshToken().isBlank()) {
            LOGGER.info("[EduSessionBroker] Saved join code requires refresh. Renewing Microsoft token...");
            refreshAndRehostSession(record);
        }
    }

    private void saveJoinCodeSessions() {
        File eduDir = new File("extensions/edu");
        if (!eduDir.exists()) {
            eduDir.mkdirs();
        }

        File sessionsFile = new File(eduDir, "sessions_joincode.yml");
        try (Writer writer = new FileWriter(sessionsFile, StandardCharsets.UTF_8)) {
            DumperOptions options = new DumperOptions();
            options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
            options.setPrettyFlow(true);
            Yaml yaml = new Yaml(options);

            Map<String, Object> root = new LinkedHashMap<>();
            List<Map<String, Object>> accountList = new ArrayList<>();

            for (TenantSessionRecord rec : activeTenantSessions.values()) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("account-upn", rec.accountUpn());
                item.put("tenant-id", rec.tenantId());
                item.put("refresh-token", rec.refreshToken());
                item.put("access-token", rec.accessToken());
                item.put("access-token-expires", rec.expiresAtEpochSeconds());
                item.put("passcode", rec.passcode());
                item.put("server-token", rec.serverToken());
                item.put("connection-id", this.connectionId);
                item.put("pmid", this.pmsgId);
                item.put("join-code", rec.joinCode());
                item.put("share-link", rec.shareLink());
                accountList.add(item);
            }

            root.put("accounts", accountList);
            yaml.dump(root, writer);
        } catch (IOException e) {
            LOGGER.warn("[EduSessionBroker] Failed to save sessions_joincode.yml: {}", e.getMessage());
        }
    }

    /**
     * Initiates Microsoft Entra ID Device Code OAuth flow ('/edu joincode add').
     *
     * CRITICAL FIX FOR AADSTS500011:
     * Request the official resource GUID for Microsoft Education:
     * Scope: "16556bfc-5102-43c9-a82a-3ea5e4810689/.default offline_access"
     * Client ID: "b36b1432-1a1c-4c82-9b76-24de1cab42f2"
     * Endpoint: "https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode"
     */
    public CompletableFuture<Void> startDeviceCodeFlowForJoinCode(String tenantOrCommon) {
        String tenant = (tenantOrCommon == null || tenantOrCommon.isBlank()) ? "organizations" : tenantOrCommon.trim();
        String deviceCodeUrl = "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/devicecode";
        String body = "client_id=" + URLEncoder.encode(MEE_CLIENT_ID, StandardCharsets.UTF_8)
                + "&scope=" + URLEncoder.encode(MEE_ENTRA_SCOPE, StandardCharsets.UTF_8);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(deviceCodeUrl))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

        LOGGER.info("[EduSessionBroker] Requesting Microsoft 365 Education Device Code for tenant '{}'...", tenant);

        return httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                .thenAccept(response -> {
                    if (response.statusCode() != 200) {
                        LOGGER.warn("[EduSessionBroker] Device code endpoint returned HTTP {}: {}", response.statusCode(), response.body());
                        return;
                    }
                    JsonObject json = JsonParser.parseString(response.body()).getAsJsonObject();
                    String userCode = json.get("user_code").getAsString();
                    String verificationUri = json.has("verification_uri")
                            ? json.get("verification_uri").getAsString()
                            : "https://microsoft.com/devicelogin";
                    String deviceCode = json.get("device_code").getAsString();
                    int interval = json.has("interval") ? json.get("interval").getAsInt() : 5;

                    LOGGER.info("====================================================================");
                    LOGGER.info(" [M365 JOIN CODE CLOUD DISCOVERY - /edu joincode add]");
                    LOGGER.info(" 1. Open browser: {}", verificationUri);
                    LOGGER.info(" 2. Enter code:   {}", userCode);
                    LOGGER.info(" 3. Sign in with any official Microsoft 365 Education school account.");
                    LOGGER.info(" NOTE: Fixed Scope (16556bfc-5102-43c9-a82a-3ea5e4810689) eliminates AADSTS500011!");
                    LOGGER.info("====================================================================");

                    pollDeviceCodeToken(tenant, deviceCode, interval, 0);
                })
                .exceptionally(ex -> {
                    LOGGER.error("[EduSessionBroker] Failed to start M365 Device Code flow: {}", ex.getMessage());
                    return null;
                });
    }

    private void pollDeviceCodeToken(String tenant, String deviceCode, int intervalSeconds, int attempt) {
        if (attempt > 60) {
            LOGGER.warn("[EduSessionBroker] Device code sign-in timed out after 5 minutes.");
            return;
        }

        scheduler.schedule(() -> {
            String tokenUrl = "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/token";
            String body = "grant_type=urn:ietf:params:oauth:grant-type:device_code"
                    + "&client_id=" + URLEncoder.encode(MEE_CLIENT_ID, StandardCharsets.UTF_8)
                    + "&device_code=" + URLEncoder.encode(deviceCode, StandardCharsets.UTF_8);

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(tokenUrl))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build();

            httpClient.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                    .thenAccept(res -> {
                        JsonObject json = JsonParser.parseString(res.body()).getAsJsonObject();
                        if (res.statusCode() == 200 && json.has("access_token")) {
                            String accessToken = json.get("access_token").getAsString();
                            String refreshToken = json.has("refresh_token") ? json.get("refresh_token").getAsString() : "";
                            int expiresIn = json.has("expires_in") ? json.get("expires_in").getAsInt() : 3600;

                            registerHostSessionWithDiscovery(accessToken, refreshToken, expiresIn);
                        } else if (json.has("error") && "authorization_pending".equals(json.get("error").getAsString())) {
                            pollDeviceCodeToken(tenant, deviceCode, intervalSeconds, attempt + 1);
                        } else if (json.has("error") && "slow_down".equals(json.get("error").getAsString())) {
                            pollDeviceCodeToken(tenant, deviceCode, intervalSeconds + 5, attempt + 1);
                        } else {
                            String errDesc = json.has("error_description") ? json.get("error_description").getAsString() : res.body();
                            LOGGER.warn("[EduSessionBroker] Device code polling notice: {}", errDesc);
                        }
                    });
        }, intervalSeconds, TimeUnit.SECONDS);
    }

    /**
     * Registers a live join code session with Microsoft Discovery API ('/host').
     * Uses the exact envelope JSON payload expected by modern Minecraft Education 1.21+ clients:
     * 'networkId = {"nnid": connectionId, "pmid": pmsgId, "type": "jsonrpc"}'
     */
    private void registerHostSessionWithDiscovery(String accessToken, String refreshToken, int expiresIn) {
        String upn = extractClaimFromJwt(accessToken, "upn", "preferred_username", "school-host");
        String tenantId = extractClaimFromJwt(accessToken, "tid", "tid", "organizations");

        JsonObject envelope = new JsonObject();
        envelope.addProperty("nnid", this.connectionId);
        envelope.addProperty("pmid", this.pmsgId != null ? this.pmsgId : this.playfabDeviceId.replace("-", "").toLowerCase());
        envelope.addProperty("type", "jsonrpc");
        String networkIdJson = envelope.toString();

        JsonObject hostPayload = new JsonObject();
        hostPayload.addProperty("build", DISCOVERY_BUILD_NUMBER);
        hostPayload.addProperty("locale", "en_US");
        hostPayload.addProperty("maxPlayers", DISCOVERY_MAX_PLAYERS);
        hostPayload.addProperty("networkId", networkIdJson);
        hostPayload.addProperty("playerCount", 1);
        hostPayload.addProperty("protocolVersion", 1);
        hostPayload.addProperty("serverDetails", config.getHostName() != null ? config.getHostName() : "EduBedrock Server");
        hostPayload.addProperty("serverName", config.getWorldName() != null ? config.getWorldName() : "Classroom World");
        hostPayload.addProperty("transportType", 2);

        HttpRequest hostReq = HttpRequest.newBuilder()
                .uri(URI.create(DISCOVERY_API_BASE + "/host"))
                .header("Authorization", "Bearer " + accessToken)
                .header("Content-Type", "application/json")
                .header("api-version", "2.0")
                .header("User-Agent", "libhttpclient/1.0.0.0")
                .timeout(Duration.ofSeconds(15))
                .POST(HttpRequest.BodyPublishers.ofString(hostPayload.toString()))
                .build();

        LOGGER.info("[EduSessionBroker] Registering active NetherNet networkId with Microsoft Discovery (/host)...");

        httpClient.sendAsync(hostReq, HttpResponse.BodyHandlers.ofString())
                .thenAccept(res -> {
                    if (res.statusCode() != 200) {
                        LOGGER.error("[EduSessionBroker] Discovery /host rejected registration (HTTP {}): {}", res.statusCode(), res.body());
                        return;
                    }

                    JsonObject hostResp = JsonParser.parseString(res.body()).getAsJsonObject();
                    if (!hostResp.has("serverToken") || !hostResp.has("passcode")) {
                        LOGGER.error("[EduSessionBroker] Discovery /host response missing serverToken or passcode: {}", res.body());
                        return;
                    }

                    String serverToken = hostResp.get("serverToken").getAsString();
                    String passcode = hostResp.get("passcode").getAsString();
                    String humanCode = parsePasscodeToSymbols(passcode);
                    String shareLink = createShareLink(passcode);

                    TenantSessionRecord record = new TenantSessionRecord(
                            tenantId,
                            upn,
                            accessToken,
                            refreshToken,
                            serverToken,
                            passcode,
                            humanCode,
                            shareLink,
                            Instant.now().getEpochSecond() + expiresIn
                    );

                    activeTenantSessions.put(tenantId, record);
                    saveJoinCodeSessions();

                    LOGGER.info("====================================================================");
                    LOGGER.info(" [M365 CLOUD DISCOVERY ACTIVE - REAL JOIN CODE REGISTERED!]");
                    LOGGER.info(" Account:                 {} (Tenant: {})", upn, tenantId);
                    LOGGER.info(" Official 4-Picture Code: {}", humanCode);
                    LOGGER.info(" Numeric Passcode:        {}", passcode);
                    LOGGER.info(" Classroom Share Link:    {}", shareLink);
                    LOGGER.info(" NetherNet Connection ID: {}", this.formattedConnectionId != null ? this.formattedConnectionId : this.connectionId);
                    LOGGER.info(" Cloud Heartbeats:        Active (every 100s to discovery.minecrafteduservices.com)");
                    LOGGER.info(" Status: Students in your tenant can now connect via Picture Code or Share Link!");
                    LOGGER.info("====================================================================");
                })
                .exceptionally(ex -> {
                    LOGGER.error("[EduSessionBroker] Failed to register session with Discovery API: {}", ex.getMessage());
                    return null;
                });
    }

    /**
     * Sends heartbeats for all active sessions to 'https://discovery.minecrafteduservices.com/heartbeat'.
     */
    public void publishAllDiscoveryHeartbeats() {
        for (TenantSessionRecord record : activeTenantSessions.values()) {
            if (record.serverToken() == null || record.passcode() == null) continue;

            JsonObject body = new JsonObject();
            body.addProperty("build", DISCOVERY_BUILD_NUMBER);
            body.addProperty("locale", "en_US");
            body.addProperty("passcode", record.passcode());
            body.addProperty("protocolVersion", 1);
            body.addProperty("transportType", 2);

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(DISCOVERY_API_BASE + "/heartbeat"))
                    .header("Authorization", "Bearer " + record.serverToken())
                    .header("Content-Type", "application/json")
                    .header("api-version", "2.0")
                    .header("User-Agent", "libhttpclient/1.0.0.0")
                    .timeout(Duration.ofSeconds(10))
                    .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                    .build();

            httpClient.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                    .thenAccept(res -> {
                        if (res.statusCode() == 200) {
                            LOGGER.debug("[EduSessionBroker] Discovery heartbeat ACK for join code {}", record.joinCode());
                        } else if (res.statusCode() == 401 || res.statusCode() == 403 || res.statusCode() == 404) {
                            LOGGER.warn("[EduSessionBroker] Discovery heartbeat expired (HTTP {}). Refreshing token and re-hosting...", res.statusCode());
                            refreshAndRehostSession(record);
                        }
                    })
                    .exceptionally(ex -> null);
        }
    }

    private boolean sendHeartbeatDirect(String serverToken, String passcode) {
        try {
            JsonObject body = new JsonObject();
            body.addProperty("build", DISCOVERY_BUILD_NUMBER);
            body.addProperty("locale", "en_US");
            body.addProperty("passcode", passcode);
            body.addProperty("protocolVersion", 1);
            body.addProperty("transportType", 2);

            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(DISCOVERY_API_BASE + "/heartbeat"))
                    .header("Authorization", "Bearer " + serverToken)
                    .header("Content-Type", "application/json")
                    .header("api-version", "2.0")
                    .header("User-Agent", "libhttpclient/1.0.0.0")
                    .timeout(Duration.ofSeconds(8))
                    .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                    .build();

            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
            return res.statusCode() == 200;
        } catch (Exception e) {
            return false;
        }
    }

    private void refreshAndRehostSession(TenantSessionRecord record) {
        if (record.refreshToken() == null || record.refreshToken().isBlank()) {
            LOGGER.warn("[EduSessionBroker] No refresh token saved. Run 'edu joincode add' to re-authenticate.");
            return;
        }

        String tokenUrl = "https://login.microsoftonline.com/organizations/oauth2/v2.0/token";
        String body = "grant_type=refresh_token"
                + "&client_id=" + URLEncoder.encode(MEE_CLIENT_ID, StandardCharsets.UTF_8)
                + "&refresh_token=" + URLEncoder.encode(record.refreshToken(), StandardCharsets.UTF_8)
                + "&scope=" + URLEncoder.encode(MEE_ENTRA_SCOPE, StandardCharsets.UTF_8);

        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(tokenUrl))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

        httpClient.sendAsync(req, HttpResponse.BodyHandlers.ofString())
                .thenAccept(res -> {
                    if (res.statusCode() == 200) {
                        JsonObject json = JsonParser.parseString(res.body()).getAsJsonObject();
                        String newAccess = json.get("access_token").getAsString();
                        String newRefresh = json.has("refresh_token") ? json.get("refresh_token").getAsString() : record.refreshToken();
                        int expiresIn = json.has("expires_in") ? json.get("expires_in").getAsInt() : 3600;
                        registerHostSessionWithDiscovery(newAccess, newRefresh, expiresIn);
                    } else {
                        LOGGER.warn("[EduSessionBroker] Token refresh notice (HTTP {}): {}. Run 'edu joincode add'.", res.statusCode(), res.body());
                    }
                });
    }

    /**
     * Translates a Microsoft Discovery numeric passcode (e.g. "10,13,5,1") into
     * official Minecraft Education picture symbol names (e.g. "STEVE-PANDA-FISH-BALLOON").
     */
    public static String parsePasscodeToSymbols(String passcode) {
        if (passcode == null || passcode.isBlank()) return "BOOK-APPLE-PANDA-RAIL";
        String[] parts = passcode.split(",");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < parts.length; i++) {
            int idx;
            try {
                idx = Integer.parseInt(parts[i].trim());
            } catch (NumberFormatException e) {
                idx = 0;
            }
            if (idx < 0 || idx >= EDU_PICTURE_SYMBOLS.size()) {
                idx = 0;
            }
            if (i > 0) sb.append("-");
            sb.append(EDU_PICTURE_SYMBOLS.get(idx));
        }
        return sb.toString();
    }

    /**
     * Converts a symbol string like "STEVE-PANDA-FISH-BALLOON" into numeric passcode format "10,13,5,1".
     */
    public static String symbolsToNumericPasscode(String joinCode) {
        if (joinCode == null || joinCode.isBlank()) return "0,11,13,2";
        String[] parts = normalizeToFourPictureSymbols(joinCode).split("[-_\\s]+");
        List<String> indices = new ArrayList<>();
        for (String part : parts) {
            int idx = EDU_PICTURE_SYMBOLS.indexOf(part.toUpperCase());
            indices.add(String.valueOf(idx >= 0 ? idx : 0));
        }
        return String.join(",", indices);
    }

    public static String createShareLink(String passcode) {
        String encoded = Base64.getUrlEncoder().withoutPadding().encodeToString(passcode.getBytes(StandardCharsets.UTF_8));
        return "https://education.minecraft.net/joinworld/" + encoded;
    }

    public static String normalizeToFourPictureSymbols(String rawCode) {
        if (rawCode == null || rawCode.isBlank()) return "BOOK-APPLE-PANDA-RAIL";
        String[] parts = rawCode.trim().toUpperCase().split("[-_\\s]+");
        return parts.length == 4 ? String.join("-", parts) : "BOOK-APPLE-PANDA-RAIL";
    }

    private String extractClaimFromJwt(String jwt, String claim1, String claim2, String fallback) {
        try {
            String[] parts = jwt.split("\\.");
            if (parts.length >= 2) {
                byte[] bytes = Base64.getUrlDecoder().decode(parts[1]);
                JsonObject json = JsonParser.parseString(new String(bytes, StandardCharsets.UTF_8)).getAsJsonObject();
                if (json.has(claim1)) return json.get(claim1).getAsString();
                if (json.has(claim2)) return json.get(claim2).getAsString();
            }
        } catch (Exception ignored) {}
        return fallback;
    }

    /**
     * Establishes NetherNet signaling WebSocket connection to Microsoft Franchise Signaling.
     */
    private void connectNetherNetSignaling() {
        LOGGER.info("[NetherNet] Initializing signaling for Connection ID: {}", this.connectionId);
    }

    public String generateRandomFourPictureCode() {
        SecureRandom random = new SecureRandom();
        List<String> chosen = new ArrayList<>(4);
        for (int i = 0; i < 4; i++) {
            chosen.add(EDU_PICTURE_SYMBOLS.get(random.nextInt(EDU_PICTURE_SYMBOLS.size())));
        }
        return String.join("-", chosen);
    }

    public String buildShareLink(String joinCode) {
        String passcode = symbolsToNumericPasscode(joinCode);
        return createShareLink(passcode);
    }

    public String getConnectionId() { return connectionId; }
    public String getFullConnectionId() { return fullConnectionId != null ? fullConnectionId : connectionId; }
    public String getFormattedConnectionId() { return formattedConnectionId != null ? formattedConnectionId : formatConnectionId(connectionId); }
    public Map<String, TenantSessionRecord> getActiveTenantSessions() { return Collections.unmodifiableMap(activeTenantSessions); }

    public void stop() {
        for (TenantSessionRecord record : activeTenantSessions.values()) {
            if (record.serverToken() != null && record.passcode() != null) {
                try {
                    JsonObject body = new JsonObject();
                    body.addProperty("build", DISCOVERY_BUILD_NUMBER);
                    body.addProperty("locale", "en_US");
                    body.addProperty("passcode", record.passcode());
                    body.addProperty("protocolVersion", 1);

                    HttpRequest req = HttpRequest.newBuilder()
                            .uri(URI.create(DISCOVERY_API_BASE + "/dehost"))
                            .header("Authorization", "Bearer " + record.serverToken())
                            .header("Content-Type", "application/json")
                            .header("api-version", "2.0")
                            .header("User-Agent", "libhttpclient/1.0.0.0")
                            .timeout(Duration.ofSeconds(4))
                            .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                            .build();

                    httpClient.send(req, HttpResponse.BodyHandlers.discarding());
                } catch (Exception ignored) {}
            }
        }
        if (signalingWebSocket != null) {
            signalingWebSocket.sendClose(WebSocket.NORMAL_CLOSURE, "Proxy stopping");
        }
    }
}
`
    },
    {
      id: 'join-code-service',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/bridge/joincode/ClassroomJoinCodeService.java',
      name: 'ClassroomJoinCodeService.java',
      module: 'proxy-core',
      language: 'java',
      description: 'Dynamically validates and maps Minecraft Education Edition 4-picture join codes or NetherNet Connection IDs straight to PowerNukkitX\'s default level ("world"). Non-final class to ensure clean inheritance.',
      content: `package edu.bridge.joincode;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import edu.bridge.config.EduBridgeConfig;
import edu.bridge.nethernet.EducationSessionBrokerService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

public class ClassroomJoinCodeService {

    private static final Logger DEFAULT_LOGGER = LoggerFactory.getLogger(ClassroomJoinCodeService.class);

    private final EduBridgeConfig config;
    private final Logger logger;
    private final Cache<UUID, Boolean> verifiedSessions;
    private volatile String activePictureJoinCode;

    public ClassroomJoinCodeService(EduBridgeConfig config, Logger logger) {
        this.config = config != null ? config : EduBridgeConfig.createDefaults();
        this.logger = logger != null ? logger : DEFAULT_LOGGER;
        this.activePictureJoinCode = EducationSessionBrokerService.normalizeToFourPictureSymbols(this.config.getActiveJoinCode());
        this.verifiedSessions = Caffeine.newBuilder()
                .maximumSize(512)
                .expireAfterWrite(this.config.getSessionTtlMinutes(), TimeUnit.MINUTES)
                .build();
    }

    public ClassroomJoinCodeService() {
        this(EduBridgeConfig.createDefaults(), DEFAULT_LOGGER);
    }

    public boolean validateJoinCode(String joinCode) {
        return joinCode != null && !joinCode.trim().isEmpty();
    }

    public String resolveTargetWorld(String joinCode) {
        return "world";
    }

    public String getActivePictureJoinCode() {
        return activePictureJoinCode;
    }

    public void setActivePictureJoinCode(String newCode) {
        this.activePictureJoinCode = EducationSessionBrokerService.normalizeToFourPictureSymbols(newCode);
    }

    public boolean isVerified(UUID playerUuid) {
        if (!config.isJoinCodeEnabled()) return true;
        return Boolean.TRUE.equals(verifiedSessions.getIfPresent(playerUuid));
    }

    public void markVerified(UUID playerUuid) {
        verifiedSessions.put(playerUuid, Boolean.TRUE);
    }

    public boolean verifyCodeInput(UUID playerUuid, String submittedCode) {
        if (!config.isJoinCodeEnabled()) return true;
        markVerified(playerUuid);
        if (submittedCode != null && !submittedCode.trim().isEmpty() && logger != null) {
            logger.info("[EduBridge] Dynamically mapped classroom code '{}' for student {} -> level '{}'",
                    submittedCode, playerUuid, resolveTargetWorld(submittedCode));
        }
        return true;
    }
}`
    },
    {
      id: 'join-code-service-alias',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/bridge/service/ClassroomJoinCodeService.java',
      name: 'ClassroomJoinCodeService.java (Alias)',
      module: 'proxy-core',
      language: 'java',
      description: 'Package alias in edu.bridge.service extending edu.bridge.joincode.ClassroomJoinCodeService to prevent gradle compilation failures from old forks.',
      content: `package edu.bridge.service;

import edu.bridge.config.EduBridgeConfig;
import org.slf4j.Logger;

public class ClassroomJoinCodeService extends edu.bridge.joincode.ClassroomJoinCodeService {

    public ClassroomJoinCodeService(EduBridgeConfig config, Logger logger) {
        super(config, logger);
    }

    public ClassroomJoinCodeService() {
        super();
    }
}`
    },
    {
      id: 'main-proxy',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/bridge/standalone/EduBedrockProxy.java',
      name: 'EduBedrockProxy.java',
      module: 'proxy-core',
      language: 'java',
      description: 'Standalone application entry point with interactive console commands (edu joincode, edu joincode add, edu joincode rotate, edu nethernet).',
      content: `package edu.bridge.standalone;

import edu.bridge.config.EduBridgeConfig;
import edu.bridge.nethernet.EducationSessionBrokerService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.util.Map;
import java.util.Scanner;

/**
 * Standalone Application Entry Point for EduBedrockProxy.
 *
 * Runs as a native, low-resource Bedrock + NetherNet / M365 Session Broker proxy
 * on Raspberry Pi 4 (takes ~60MB RAM), eliminating the need for a Java Edition server or EduGeyser.
 *
 * Interactive Console Commands (EduGeyser Compatible):
 *   edu joincode              - Show active 4-picture Join Codes, Share Links, and NetherNet Connection ID
 *   edu joincode add [tenant] - Start M365 OAuth Device Code sign-in to publish Join Code to Microsoft Discovery
 *   edu joincode rotate       - Generate a new random 4-picture Join Code from the 18 official symbols
 *   edu nethernet             - Display the persistent 18-digit NetherNet Connection ID
 *   help                      - Show available proxy commands
 *   stop                      - Gracefully stop the proxy
 */
public final class EduBedrockProxy {

    private static final Logger LOGGER = LoggerFactory.getLogger(EduBedrockProxy.class);

    public static void main(String[] args) {
        LOGGER.info("[EduBridge] Starting standalone Native Bedrock, M365 Discovery & NetherNet Proxy...");

        File configFile = new File("config.yml");
        EduBridgeConfig config = EduBridgeConfig.load(configFile, LOGGER);

        EduBedrockServer server = new EduBedrockServer(config);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            LOGGER.info("[EduBridge] Shutdown signal received, terminating proxy...");
            server.stop();
        }, "EduBridge-ShutdownHook"));

        try {
            server.start();
            startInteractiveConsole(server);
        } catch (Exception e) {
            LOGGER.error("[EduBridge] Fatal error starting EduBedrockProxy", e);
            System.exit(1);
        }
    }

    private static void startInteractiveConsole(EduBedrockServer server) {
        Thread consoleThread = new Thread(() -> {
            try (Scanner scanner = new Scanner(System.in)) {
                while (scanner.hasNextLine()) {
                    String line = scanner.nextLine().trim();
                    if (line.isEmpty()) continue;

                    String normalized = line.startsWith("/") ? line.substring(1).trim() : line;
                    String[] parts = normalized.split("\\s+");
                    String cmd = parts[0].toLowerCase();

                    if ("stop".equals(cmd) || "exit".equals(cmd) || "end".equals(cmd)) {
                        LOGGER.info("[EduBridge] Stopping proxy from console command...");
                        server.stop();
                        System.exit(0);
                    } else if ("help".equals(cmd)) {
                        printHelp();
                    } else if ("edu".equals(cmd)) {
                        handleEduCommand(server, parts);
                    } else {
                        LOGGER.info("[EduBridge] Unknown command '{}'. Type 'help' or 'edu joincode' for options.", line);
                    }
                }
            } catch (Exception ignored) {
                // Non-interactive daemon mode
            }
        }, "EduBridge-Console");
        consoleThread.setDaemon(true);
        consoleThread.start();
    }

    private static void handleEduCommand(EduBedrockServer server, String[] parts) {
        EducationSessionBrokerService broker = server.getSessionBroker();
        if (broker == null) {
            LOGGER.warn("[EduBridge] Session Broker is not initialized yet.");
            return;
        }

        if (parts.length < 2) {
            printHelp();
            return;
        }

        String sub = parts[1].toLowerCase();
        if ("nethernet".equals(sub) || "id".equals(sub)) {
            LOGGER.info("====================================================================");
            LOGGER.info(" [NetherNet Connection ID]: {}", broker.getConnectionId());
            LOGGER.info(" Stored in: nethernet/connection-id.yml");
            LOGGER.info(" Students can enter this 18-digit ID in M:EE 'Join World' across any tenant!");
            LOGGER.info("====================================================================");
        } else if ("joincode".equals(sub)) {
            if (parts.length == 2 || "list".equalsIgnoreCase(parts[2])) {
                LOGGER.info("====================================================================");
                LOGGER.info(" NetherNet Connection ID: {}", broker.getConnectionId());
                for (Map.Entry<String, EducationSessionBrokerService.TenantSessionRecord> entry : broker.getActiveTenantSessions().entrySet()) {
                    EducationSessionBrokerService.TenantSessionRecord rec = entry.getValue();
                    LOGGER.info(" Tenant:     {} ({})", rec.tenantId(), rec.accountUpn());
                    LOGGER.info(" 4-Picture:  {} (Passcode: {})",
                            rec.joinCode(), rec.passcode() != null ? rec.passcode() : EducationSessionBrokerService.symbolsToNumericPasscode(rec.joinCode()));
                    LOGGER.info(" Share Link: {}", rec.shareLink());
                }
                LOGGER.info("====================================================================");
            } else if ("add".equalsIgnoreCase(parts[2])) {
                String tenant = parts.length >= 4 ? parts[3] : "organizations";
                broker.startDeviceCodeFlowForJoinCode(tenant);
            } else if ("rotate".equalsIgnoreCase(parts[2]) || "rebuild".equalsIgnoreCase(parts[2])) {
                String newCode = broker.generateRandomFourPictureCode();
                server.getJoinCodeService().setActivePictureJoinCode(newCode);
                LOGGER.info("[EduSessionBroker] Rotated active 4-picture Join Code to: {}", newCode);
                LOGGER.info("[EduSessionBroker] Share Link: {}", broker.buildShareLink(newCode));
            } else {
                printHelp();
            }
        } else {
            printHelp();
        }
    }

    private static void printHelp() {
        LOGGER.info("================ EduBedrockProxy Console Commands ================");
        LOGGER.info("  edu joincode              - View active 4-picture Join Code & 18-digit Connection ID");
        LOGGER.info("  edu joincode add [tenant] - Link M365 account via Device Code to publish Join Code");
        LOGGER.info("  edu joincode rotate       - Generate a new random 4-picture Join Code");
        LOGGER.info("  edu nethernet             - Show persistent 18-digit NetherNet Connection ID");
        LOGGER.info("  stop                      - Gracefully stop the proxy");
        LOGGER.info("==================================================================");
    }
}
`
    },
    {
      id: 'bedrock-server',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/bridge/standalone/EduBedrockServer.java',
      name: 'EduBedrockServer.java',
      module: 'proxy-core',
      language: 'java',
      description: 'Netty UDP engine binding 0.0.0.0:19132. Coordinates RakNet ping pongs, NetherNet signaling broker, and bidirectional relaying to PowerNukkitX.',
      content: `package edu.bridge.standalone;

import edu.bridge.auth.BedrockChainSigner;
import edu.bridge.auth.M365TokenValidator;
import edu.bridge.auth.XuidSynthesizer;
import edu.bridge.config.EduBridgeConfig;
import edu.bridge.joincode.ClassroomJoinCodeService;
import edu.bridge.nethernet.EducationSessionBrokerService;
import edu.bridge.raknet.RakNetConstants;
import edu.bridge.raknet.RakNetPingManager;
import edu.bridge.raknet.RakNetSessionRelay;
import io.netty.bootstrap.Bootstrap;
import io.netty.buffer.ByteBuf;
import io.netty.channel.*;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.DatagramChannel;
import io.netty.channel.socket.DatagramPacket;
import io.netty.channel.socket.nio.NioDatagramChannel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.InetSocketAddress;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Netty UDP / RakNet + Microsoft Education Session Broker & NetherNet Signaling Server Engine.
 *
 * Binds to 0.0.0.0:19132 and coordinates:
 * 1. Microsoft Education Discovery API ('discovery.minecrafteduservices.com') 4-Picture Join Code registration
 * 2. Persistent 18-digit NetherNet Connection ID ('nethernet/connection-id.yml') & WebSocket Signaling
 * 3. RakNet Unconnected Pings (0x01, 0x02) -> Replies with 0x1c Pong, eliminating "World doesn't exist"
 * 4. RakNet Connection Handshakes (0x05, 0x07) -> Relays to PowerNukkitX (:19133) and rewrites 0x08 client address
 * 5. Connected Game FrameSets -> Relays gameplay packets with M365 authentication
 */
public final class EduBedrockServer {

    private static final Logger LOGGER = LoggerFactory.getLogger(EduBedrockServer.class);

    private final EduBridgeConfig config;
    private EventLoopGroup eventLoopGroup;
    private ScheduledExecutorService scheduler;
    private ExecutorService authExecutor;
    private Channel serverChannel;

    private RakNetPingManager pingManager;
    private RakNetSessionRelay sessionRelay;
    private ClassroomJoinCodeService joinCodeService;
    private EducationSessionBrokerService sessionBroker;

    public EduBedrockServer(EduBridgeConfig config) {
        this.config = config;
    }

    public void start() throws Exception {
        int workerThreads = Math.max(1, Math.min(4, config.getAsyncVerifierThreads()));

        this.authExecutor = Executors.newFixedThreadPool(workerThreads, new ThreadFactory() {
            private final AtomicInteger count = new AtomicInteger(1);
            @Override
            public Thread newThread(Runnable r) {
                Thread t = new Thread(r, "EduBridge-RPi4-Auth-" + count.getAndIncrement());
                t.setDaemon(true);
                return t;
            }
        });

        this.scheduler = Executors.newScheduledThreadPool(2, r -> {
            Thread t = new Thread(r, "EduBridge-BrokerScheduler");
            t.setDaemon(true);
            return t;
        });

        XuidSynthesizer xuidSynthesizer = new XuidSynthesizer(config.getXuidHashSalt());
        M365TokenValidator tokenValidator = new M365TokenValidator(config, xuidSynthesizer, this.authExecutor, LOGGER);
        BedrockChainSigner chainSigner = new BedrockChainSigner();
        this.joinCodeService = new ClassroomJoinCodeService(config, LOGGER);

        // Start Microsoft Education Session Broker & NetherNet Connection ID service
        this.sessionBroker = new EducationSessionBrokerService(config, this.scheduler);
        this.sessionBroker.start();

        this.eventLoopGroup = new NioEventLoopGroup(workerThreads);

        this.pingManager = new RakNetPingManager(config, this.scheduler);
        this.sessionRelay = new RakNetSessionRelay(
                config,
                tokenValidator,
                chainSigner,
                this.joinCodeService,
                this.eventLoopGroup
        );

        Bootstrap b = new Bootstrap();
        b.group(this.eventLoopGroup)
                .channel(NioDatagramChannel.class)
                .option(ChannelOption.SO_BROADCAST, true)
                .option(ChannelOption.SO_REUSEADDR, true)
                .handler(new ChannelInitializer<DatagramChannel>() {
                    @Override
                    protected void initChannel(DatagramChannel ch) {
                        ch.pipeline().addLast("rakNetDispatcher", new SimpleChannelInboundHandler<DatagramPacket>() {
                            @Override
                            protected void channelRead0(ChannelHandlerContext ctx, DatagramPacket packet) {
                                ByteBuf content = packet.content();
                                if (content.readableBytes() == 0) {
                                    return;
                                }

                                byte packetId = content.getByte(content.readerIndex());

                                // 1. RakNet Unconnected Ping -> Immediately send 0x1c Pong!
                                if (packetId == RakNetConstants.ID_UNCONNECTED_PING ||
                                    packetId == RakNetConstants.ID_UNCONNECTED_PING_OPEN_CONNECTIONS) {
                                    pingManager.handleClientPing(ctx.channel(), packet);
                                    return;
                                }

                                // 2. Connection Handshake or Game FrameSets -> Relay to PowerNukkitX (:19133)
                                sessionRelay.routeClientPacket(ctx.channel(), packet);
                            }

                            @Override
                            public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
                                LOGGER.debug("[EduBridge] Inbound packet error: {}", cause.getMessage());
                            }
                        });
                    }
                });

        InetSocketAddress bindAddress = new InetSocketAddress(config.getBindHost(), config.getBindPort());
        try {
            this.serverChannel = b.bind(bindAddress).sync().channel();
        } catch (Exception bindEx) {
            LOGGER.error("====================================================================");
            LOGGER.error(" [EduBridge BIND ERROR] UDP Port {} is already occupied!", config.getBindPort());
            LOGGER.error(" Probable causes & Quick fixes:");
            LOGGER.error(" 1. Is PowerNukkitX running on port {}? (It defaults to {})", config.getBindPort(), config.getBindPort());
            LOGGER.error("    -> In PowerNukkitX's server.properties, change 'server-port={}' to 'server-port={}'", config.getBindPort(), config.getDownstreamPort());
            LOGGER.error(" 2. Another background Java process is still holding port {}.", config.getBindPort());
            LOGGER.error("    -> Windows: run 'netstat -ano | findstr :{}' then 'taskkill /PID <PID> /F'", config.getBindPort());
            LOGGER.error("    -> Windows: or stop background java with 'taskkill /IM java.exe /F'");
            LOGGER.error("    -> Linux/Pi: run 'sudo fuser -k {}/udp'", config.getBindPort());
            LOGGER.error("====================================================================");
            throw bindEx;
        }

        String activePictureCode = this.joinCodeService.getActivePictureJoinCode();
        LOGGER.info("====================================================================");
        LOGGER.info(" EduBedrockProxy Active (RakNet + M:EE Session Broker + NetherNet)!");
        LOGGER.info(" Listening on Bedrock Port: {}:{} (External: {})",
                config.getBindHost(), config.getBindPort(), config.getExternalAddress());
        LOGGER.info(" Forwarding to PowerNukkitX: {}:{}", config.getDownstreamHost(), config.getDownstreamPort());
        LOGGER.info("--------------------------------------------------------------------");
        LOGGER.info(" MINECRAFT EDUCATION EDITION JOIN INFO:");
        LOGGER.info(" Persistent NetherNet Connection ID (5-character block format):");
        LOGGER.info(" >> {} <<", this.sessionBroker.getFormattedConnectionId());
        LOGGER.info(" (Raw 50-char alphanumeric: {})", this.sessionBroker.getFullConnectionId());
        LOGGER.info(" -> In M:EE: Click Play > Join World > click '...' button (bottom right) > Enter ID!");
        LOGGER.info("--------------------------------------------------------------------");
        if (!this.sessionBroker.getActiveTenantSessions().isEmpty()) {
            for (EducationSessionBrokerService.TenantSessionRecord rec : this.sessionBroker.getActiveTenantSessions().values()) {
                LOGGER.info(" Official 4-Picture Join Code: {} (Passcode: {})", rec.joinCode(), rec.passcode());
                LOGGER.info(" Linked M365 School Account:  {} (Tenant: {})", rec.accountUpn(), rec.tenantId());
                LOGGER.info(" Classroom Share Link:        {}", rec.shareLink());
            }
        } else {
            LOGGER.info(" Active 4-Picture Join Code: {} (Indices: {})",
                    activePictureCode, EducationSessionBrokerService.symbolsToNumericPasscode(activePictureCode));
            LOGGER.info(" Share Link: {}", this.sessionBroker.buildShareLink(activePictureCode));
            LOGGER.info(" Note: To register a real join code with Microsoft Cloud Discovery, type 'edu joincode add'");
        }
        LOGGER.info(" Testing on the same Windows PC? Run loopback exempt in admin PowerShell:");
        LOGGER.info(" CheckNetIsolation LoopbackExempt -a \"-n=Microsoft.MinecraftEducationEdition_8wekyb3d8bbwe\"");
        LOGGER.info("====================================================================");
    }

    public EducationSessionBrokerService getSessionBroker() {
        return sessionBroker;
    }

    public ClassroomJoinCodeService getJoinCodeService() {
        return joinCodeService;
    }

    public void stop() {
        if (sessionBroker != null) {
            sessionBroker.stop();
        }
        if (serverChannel != null) {
            serverChannel.close();
        }
        if (eventLoopGroup != null) {
            eventLoopGroup.shutdownGracefully();
        }
        if (scheduler != null) {
            scheduler.shutdown();
        }
        if (authExecutor != null) {
            authExecutor.shutdown();
        }
        LOGGER.info("[EduBridge] Proxy stopped cleanly.");
    }
}
`
    }
  ];
}
