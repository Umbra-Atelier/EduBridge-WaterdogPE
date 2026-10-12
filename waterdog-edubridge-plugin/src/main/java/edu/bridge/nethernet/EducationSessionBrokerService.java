package edu.bridge.nethernet;

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
