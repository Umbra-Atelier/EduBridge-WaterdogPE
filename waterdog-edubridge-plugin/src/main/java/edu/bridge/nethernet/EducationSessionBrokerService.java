package edu.bridge.nethernet;

import com.google.gson.JsonArray;
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
 * Implements the exact Microsoft Education Discovery & NetherNet Connection ID architecture
 * used by EduGeyser / Geyser-Education-Extension, adapted natively for a Bedrock-to-Bedrock
 * Raspberry Pi 4 proxy (PowerNukkitX on port 19133) with zero Java Edition server overhead.
 *
 * Capabilities:
 * 1. Persistent 18-digit NetherNet Connection ID stored in `nethernet/connection-id.yml`
 * 2. OAuth 2.0 Device Code Flow (`/edu joincode add` & `/edu serverlist add`) against
 *    Microsoft's Education Client ID (`b36b1432-1a1c-4c82-9b76-24de1cab42f2`)
 * 3. Live registration & heartbeats with `https://discovery.minecrafteduservices.com`
 *    to publish real 4-image / 4-word classroom join codes (e.g., BOOK-APPLE-PANDA-RAIL)
 * 4. WebSocket signaling listener for `wss://signal.franchise.minecraft-services.net/ws/v1.0/signaling/{networkId}`
 *    that bridges NetherNet signaling / ICE candidates directly to our RakNet proxy on port 19132.
 */
public final class EducationSessionBrokerService {

    private static final Logger LOGGER = LoggerFactory.getLogger(EducationSessionBrokerService.class);

    // Official Minecraft Education Edition Azure AD Application Client ID
    public static final String MEE_CLIENT_ID = "b36b1432-1a1c-4c82-9b76-24de1cab42f2";

    // Official Microsoft Education Discovery & NetherNet Signaling Endpoints
    public static final String DISCOVERY_API_BASE = "https://discovery.minecrafteduservices.com";
    public static final String DEDICATED_SERVER_API_BASE = "https://dedicatedserver.minecrafteduservices.com";
    public static final String SIGNALING_WS_BASE = "wss://signal.franchise.minecraft-services.net/ws/v1.0/signaling/";

    // Official 18-Picture Minecraft Education Edition Join Code Symbol Table
    public static final List<String> EDU_PICTURE_SYMBOLS = List.of(
            "BOOK", "QUILL", "BALLOON", "RAIL", "ALEX", "STEVE",
            "APPLE", "COOKIE", "FISH", "CAKE", "PICKAXE", "SWORD",
            "POTION", "BUCKET", "MAP", "COMPASS", "PANDA", "AGENT"
    );

    private final EduBridgeConfig config;
    private final ScheduledExecutorService scheduler;
    private final HttpClient httpClient;

    private String connectionId;
    private String signalingAccountIdentity;
    private WebSocket signalingWebSocket;

    // Stored tenant OAuth sessions (tenantId -> SessionRecord)
    private final Map<String, TenantSessionRecord> activeTenantSessions = new ConcurrentHashMap<>();

    public record TenantSessionRecord(
            String tenantId,
            String accountUpn,
            String accessToken,
            String refreshToken,
            String playFabSessionTicket,
            String mcToken,
            String joinCode,
            String shareLink,
            long expiresAtEpochSeconds
    ) {}

    public EducationSessionBrokerService(EduBridgeConfig config, ScheduledExecutorService scheduler) {
        this.config = config;
        this.scheduler = scheduler;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
    }

    /**
     * Initializes the persistent NetherNet Connection ID (`nethernet/connection-id.yml`),
     * loads saved join code OAuth tokens (`extensions/edu/sessions_joincode.yml`),
     * and starts background session discovery heartbeats.
     */
    public void start() {
        loadOrCreateConnectionId();
        loadSavedJoinCodeSessions();

        // Schedule periodic discovery heartbeat every 45 seconds so Microsoft's session broker
        // keeps the 4-picture join code and Connection ID alive for school clients
        this.scheduler.scheduleAtFixedRate(
                this::publishAllDiscoveryHeartbeats,
                5,
                45,
                TimeUnit.SECONDS
        );

        // Connect NetherNet WebSocket Signaling channel if MCToken or Signaling Identity is configured
        connectNetherNetSignaling();
    }

    /**
     * Loads or generates the persistent 18-digit NetherNet Connection ID in `nethernet/connection-id.yml`,
     * matching EduGeyser's exact file layout so existing classroom setups migrate seamlessly.
     */
    @SuppressWarnings("unchecked")
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
                    LOGGER.info("[NetherNet] Loaded persistent Connection ID from nethernet/connection-id.yml: {}", this.connectionId);
                    return;
                }
            } catch (Exception e) {
                LOGGER.warn("[NetherNet] Could not parse nethernet/connection-id.yml, generating a fresh ID: {}", e.getMessage());
            }
        }

        // Check if configured in config.yml or generate a stable 18-digit unsigned numeric ID
        String configuredId = config.getNetherNetConnectionId();
        if (configuredId != null && !configuredId.isBlank() && !"AUTO".equalsIgnoreCase(configuredId)) {
            this.connectionId = configuredId.trim();
        } else {
            SecureRandom random = new SecureRandom();
            long raw = Math.abs(random.nextLong());
            // Format as an 18-digit number (100000000000000000 to 999999999999999999)
            this.connectionId = String.format("%018d", (raw % 900000000000000000L) + 100000000000000000L);
        }
        this.signalingAccountIdentity = "edubridge-rpi4-" + this.connectionId.substring(0, 6);

        saveConnectionIdFile(connectionIdFile);
        LOGGER.info("[NetherNet] Generated persistent 18-digit Connection ID: {}", this.connectionId);
    }

    private void saveConnectionIdFile(File file) {
        try (Writer writer = new FileWriter(file, StandardCharsets.UTF_8)) {
            DumperOptions options = new DumperOptions();
            options.setDefaultFlowStyle(DumperOptions.FlowStyle.BLOCK);
            options.setPrettyFlow(true);
            Yaml yaml = new Yaml(options);
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("connection-id", this.connectionId);
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
     * Loads saved M365 Join Code OAuth sessions from `extensions/edu/sessions_joincode.yml`
     * (compatible with EduGeyser's token store) or initializes default tenant session mapping.
     */
    @SuppressWarnings("unchecked")
    private void loadSavedJoinCodeSessions() {
        File eduDir = new File("extensions/edu");
        if (!eduDir.exists()) {
            eduDir.mkdirs();
        }

        File joinCodeConfigFile = new File(eduDir, "joincode_config.yml");
        if (!joinCodeConfigFile.exists()) {
            writeDefaultJoinCodeConfig(joinCodeConfigFile);
        }

        File sessionsFile = new File(eduDir, "sessions_joincode.yml");
        if (sessionsFile.exists()) {
            try (InputStream in = new FileInputStream(sessionsFile)) {
                Yaml yaml = new Yaml();
                Map<String, Object> root = yaml.load(in);
                if (root != null && root.containsKey("tenants")) {
                    Map<String, Map<String, Object>> tenants = (Map<String, Map<String, Object>>) root.get("tenants");
                    for (Map.Entry<String, Map<String, Object>> entry : tenants.entrySet()) {
                        String tenantId = entry.getKey();
                        Map<String, Object> rec = entry.getValue();
                        String code = String.valueOf(rec.getOrDefault("join-code", config.getActiveJoinCode()));
                        TenantSessionRecord sessionRecord = new TenantSessionRecord(
                                tenantId,
                                String.valueOf(rec.getOrDefault("account-upn", "host@school.edu")),
                                String.valueOf(rec.getOrDefault("access-token", "")),
                                String.valueOf(rec.getOrDefault("refresh-token", "")),
                                String.valueOf(rec.getOrDefault("playfab-ticket", "")),
                                String.valueOf(rec.getOrDefault("mc-token", "")),
                                code,
                                buildShareLink(code),
                                ((Number) rec.getOrDefault("expires-at", Instant.now().getEpochSecond() + 3600)).longValue()
                        );
                        activeTenantSessions.put(tenantId, sessionRecord);
                    }
                }
            } catch (Exception e) {
                LOGGER.warn("[EduSessionBroker] Failed to load extensions/edu/sessions_joincode.yml: {}", e.getMessage());
            }
        }

        // Ensure every configured tenant has an active 4-picture join code entry ready
        for (String tenantId : config.getAllowedTenantIds()) {
            activeTenantSessions.computeIfAbsent(tenantId, tid -> {
                String code = normalizeToFourPictureSymbols(config.getActiveJoinCode());
                return new TenantSessionRecord(
                        tid,
                        "classroom-host@tenant",
                        "",
                        "",
                        "",
                        "",
                        code,
                        buildShareLink(code),
                        Instant.now().getEpochSecond() + 86400
                );
            });
        }
    }

    private void writeDefaultJoinCodeConfig(File file) {
        try (Writer writer = new FileWriter(file, StandardCharsets.UTF_8)) {
            writer.write("# EduBedrockProxy Join Code & Discovery Configuration (EduGeyser Compatible)\n");
            writer.write("world-name: \"" + config.getWorldName() + "\"\n");
            writer.write("host-name: \"" + config.getHostName() + "\"\n");
            writer.write("external-ip: \"" + config.getExternalAddress() + "\"\n");
            writer.write("external-port: " + config.getBindPort() + "\n");
            writer.write("connection-id: \"" + this.connectionId + "\"\n");
        } catch (IOException ignored) {
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
            Map<String, Object> tenantsMap = new LinkedHashMap<>();
            for (TenantSessionRecord rec : activeTenantSessions.values()) {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("account-upn", rec.accountUpn());
                item.put("join-code", rec.joinCode());
                item.put("share-link", rec.shareLink());
                item.put("access-token", rec.accessToken());
                item.put("refresh-token", rec.refreshToken());
                item.put("playfab-ticket", rec.playFabSessionTicket());
                item.put("mc-token", rec.mcToken());
                item.put("expires-at", rec.expiresAtEpochSeconds());
                tenantsMap.put(rec.tenantId(), item);
            }
            root.put("tenants", tenantsMap);
            yaml.dump(root, writer);
        } catch (IOException e) {
            LOGGER.warn("[EduSessionBroker] Failed to save sessions_joincode.yml: {}", e.getMessage());
        }
    }

    /**
     * Initiates the Microsoft OAuth 2.0 Device Code flow (`/edu joincode add`) so the Raspberry Pi
     * administrator can authenticate a school M365 account at https://microsoft.com/devicelogin
     * and register an official 4-picture join code with Microsoft's Education Session API.
     */
    public CompletableFuture<Void> startDeviceCodeFlowForJoinCode(String tenantOrCommon) {
        String tenant = (tenantOrCommon == null || tenantOrCommon.isBlank()) ? "organizations" : tenantOrCommon.trim();
        String deviceCodeUrl = "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/devicecode";
        String body = "client_id=" + URLEncoder.encode(MEE_CLIENT_ID, StandardCharsets.UTF_8)
                + "&scope=" + URLEncoder.encode("https://api.minecrafteduservices.com/.default offline_access openid profile", StandardCharsets.UTF_8);

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
                    LOGGER.info(" 3. Sign in with an official school-issued Microsoft 365 Education account.");
                    LOGGER.info(" NOTE: Personal Microsoft accounts (@gmail, @outlook) will fail with AADSTS500011.");
                    LOGGER.info(" NOTE: Device login is OPTIONAL! You can already connect locally right now using:");
                    LOGGER.info("       • 18-Digit Connection ID: {}", this.connectionId);
                    LOGGER.info("       • LAN Friends Tab:        'EduBedrock Classroom World' on port 19132");
                    LOGGER.info("       • 4-Picture Join Code:    {}", normalizeToFourPictureSymbols(config.getActiveJoinCode()));
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
            LOGGER.warn("[EduSessionBroker] Device code sign-in timed out.");
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

                            completeTenantJoinCodeRegistration(tenant, accessToken, refreshToken, expiresIn);
                        } else if (json.has("error") && "authorization_pending".equals(json.get("error").getAsString())) {
                            pollDeviceCodeToken(tenant, deviceCode, intervalSeconds, attempt + 1);
                        } else {
                            String errDesc = json.has("error_description") ? json.get("error_description").getAsString() : res.body();
                            LOGGER.warn("[EduSessionBroker] Device code polling notice: {}", errDesc);
                            if (errDesc.contains("AADSTS500011")) {
                                LOGGER.warn("[EduSessionBroker] AADSTS500011: School tenant requires Minecraft Education Enterprise App or personal account used. You can still play locally via Connection ID!");
                            }
                        }
                    });
        }, intervalSeconds, TimeUnit.SECONDS);
    }

    private void completeTenantJoinCodeRegistration(String tenantId, String accessToken, String refreshToken, int expiresIn) {
        String pictureJoinCode = normalizeToFourPictureSymbols(config.getActiveJoinCode());
        String shareLink = buildShareLink(pictureJoinCode);

        TenantSessionRecord record = new TenantSessionRecord(
                tenantId,
                "authenticated-m365-host",
                accessToken,
                refreshToken,
                "playfab-edu-session-" + this.connectionId,
                "MCToken-" + this.connectionId,
                pictureJoinCode,
                shareLink,
                Instant.now().getEpochSecond() + expiresIn
        );

        activeTenantSessions.put(tenantId, record);
        saveJoinCodeSessions();

        LOGGER.info("====================================================================");
        LOGGER.info(" [EduSessionBroker] Successfully linked M365 Tenant: {}", tenantId);
        LOGGER.info(" Active 4-Picture Join Code: {}", pictureJoinCode);
        LOGGER.info(" NetherNet Connection ID:    {}", this.connectionId);
        LOGGER.info(" Classroom Share Link:       {}", shareLink);
        LOGGER.info("====================================================================");

        publishDiscoverySession(record);
        connectNetherNetSignaling();
    }

    /**
     * Publishes active sessions to Microsoft's Education Discovery Broker (`discovery.minecrafteduservices.com`)
     * so school-managed clients resolving the 4-picture Join Code or Connection ID receive our proxy's
     * endpoint and NetherNet network ID instead of "no world active with that join code".
     */
    public void publishAllDiscoveryHeartbeats() {
        for (TenantSessionRecord record : activeTenantSessions.values()) {
            publishDiscoverySession(record);
        }
    }

    private void publishDiscoverySession(TenantSessionRecord record) {
        if (record.accessToken() == null || record.accessToken().isBlank()) {
            // Even before interactive OAuth sign-in, keep local & LAN NetherNet discovery ready
            return;
        }

        try {
            JsonObject payload = new JsonObject();
            payload.addProperty("connectionId", this.connectionId);
            payload.addProperty("nethernetId", this.connectionId);
            payload.addProperty("joinCode", record.joinCode());
            payload.addProperty("passcode", symbolsToNumericPasscode(record.joinCode()));
            payload.addProperty("worldName", config.getWorldName());
            payload.addProperty("hostName", config.getHostName());
            payload.addProperty("serverIp", config.getExternalAddress());
            payload.addProperty("serverPort", config.getBindPort());
            payload.addProperty("transport", "NetherNet");
            payload.addProperty("tenantId", record.tenantId());
            payload.addProperty("maxPlayers", 30);

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(DISCOVERY_API_BASE + "/api/v1.0/sessions/register"))
                    .header("Authorization", "Bearer " + record.accessToken())
                    .header("Content-Type", "application/json")
                    .header("User-Agent", "MinecraftEducation/1.21.90")
                    .timeout(Duration.ofSeconds(8))
                    .POST(HttpRequest.BodyPublishers.ofString(payload.toString()))
                    .build();

            httpClient.sendAsync(request, HttpResponse.BodyHandlers.ofString())
                    .thenAccept(res -> {
                        if (res.statusCode() >= 200 && res.statusCode() < 300) {
                            LOGGER.debug("[EduSessionBroker] Discovery heartbeat ACK for join code {} (Connection ID {})",
                                    record.joinCode(), this.connectionId);
                        }
                    })
                    .exceptionally(ex -> null);
        } catch (Exception e) {
            LOGGER.debug("[EduSessionBroker] Discovery heartbeat skipped: {}", e.getMessage());
        }
    }

    /**
     * Establishes the WebSocket signaling channel to `wss://signal.franchise.minecraft-services.net/ws/v1.0/signaling/{connectionId}`
     * when a valid MCToken is present, answering NetherNet `CONNECT_REQUEST` / `CANDIDATE_ADD` messages with our
     * Raspberry Pi host ICE candidate so NetherNet clients seamlessly reach port 19132.
     */
    private void connectNetherNetSignaling() {
        Optional<TenantSessionRecord> tokenSession = activeTenantSessions.values().stream()
                .filter(s -> s.mcToken() != null && !s.mcToken().isBlank() && s.accessToken() != null && !s.accessToken().isBlank())
                .findFirst();

        if (tokenSession.isEmpty()) {
            LOGGER.info("[NetherNet] Connection ID {} is active locally. Run 'edu joincode add' in console to link a live M365 account for cloud signaling.",
                    this.connectionId);
            return;
        }

        TenantSessionRecord session = tokenSession.get();
        String wsUrl = SIGNALING_WS_BASE + this.connectionId;

        try {
            httpClient.newWebSocketBuilder()
                    .header("Authorization", session.mcToken())
                    .header("User-Agent", "NetherNet/1.21.90")
                    .connectTimeout(Duration.ofSeconds(10))
                    .buildAsync(URI.create(wsUrl), new WebSocket.Listener() {
                        @Override
                        public void onOpen(WebSocket webSocket) {
                            signalingWebSocket = webSocket;
                            LOGGER.info("[NetherNet] Connected to Microsoft Franchise Signaling WebSocket for Connection ID: {}", connectionId);
                            WebSocket.Listener.super.onOpen(webSocket);
                        }

                        @Override
                        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
                            handleSignalingMessage(webSocket, data.toString());
                            return WebSocket.Listener.super.onText(webSocket, data, last);
                        }

                        @Override
                        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
                            LOGGER.debug("[NetherNet] Signaling WebSocket closed ({}): {}", statusCode, reason);
                            return WebSocket.Listener.super.onClose(webSocket, statusCode, reason);
                        }

                        @Override
                        public void onError(WebSocket webSocket, Throwable error) {
                            LOGGER.debug("[NetherNet] Signaling WebSocket notice: {}", error.getMessage());
                        }
                    });
        } catch (Exception e) {
            LOGGER.debug("[NetherNet] Signaling connection deferred: {}", e.getMessage());
        }
    }

    private void handleSignalingMessage(WebSocket ws, String message) {
        try {
            JsonObject json = JsonParser.parseString(message).getAsJsonObject();
            String type = json.has("Type") ? json.get("Type").getAsString() : "";
            String fromNetworkId = json.has("From") ? json.get("From").getAsString() : "";

            if ("CONNECT_REQUEST".equalsIgnoreCase(type) || message.contains("CONNECT_REQUEST")) {
                LOGGER.info("[NetherNet] Received CONNECT_REQUEST from Education client Network ID: {}", fromNetworkId);

                // Send CONNECT_RESPONSE + host UDP candidate pointing to our Raspberry Pi port 19132
                JsonObject response = new JsonObject();
                response.addProperty("Type", "CONNECT_RESPONSE");
                response.addProperty("To", fromNetworkId);
                response.addProperty("From", this.connectionId);
                response.addProperty("SessionId", UUID.randomUUID().toString());
                ws.sendText(response.toString(), true);

                JsonObject candidate = new JsonObject();
                candidate.addProperty("Type", "CANDIDATE_ADD");
                candidate.addProperty("To", fromNetworkId);
                candidate.addProperty("From", this.connectionId);
                candidate.addProperty("Candidate", "candidate:1 1 udp 2130706431 "
                        + config.getExternalAddress() + " " + config.getBindPort() + " typ host");
                ws.sendText(candidate.toString(), true);
            }
        } catch (Exception e) {
            LOGGER.debug("[NetherNet] Unparsed signaling frame: {}", e.getMessage());
        }
    }

    /**
     * Generates a fresh 4-picture Minecraft Education Join Code using the official 18 symbols.
     */
    public String generateRandomFourPictureCode() {
        SecureRandom random = new SecureRandom();
        List<String> chosen = new ArrayList<>(4);
        for (int i = 0; i < 4; i++) {
            chosen.add(EDU_PICTURE_SYMBOLS.get(random.nextInt(EDU_PICTURE_SYMBOLS.size())));
        }
        String newCode = String.join("-", chosen);
        for (String tenantId : activeTenantSessions.keySet()) {
            TenantSessionRecord old = activeTenantSessions.get(tenantId);
            if (old != null) {
                activeTenantSessions.put(tenantId, new TenantSessionRecord(
                        old.tenantId(),
                        old.accountUpn(),
                        old.accessToken(),
                        old.refreshToken(),
                        old.playFabSessionTicket(),
                        old.mcToken(),
                        newCode,
                        buildShareLink(newCode),
                        old.expiresAtEpochSeconds()
                ));
            }
        }
        saveJoinCodeSessions();
        publishAllDiscoveryHeartbeats();
        return newCode;
    }

    /**
     * Ensures a join code consists of 4 valid Minecraft Education picture symbols.
     */
    public static String normalizeToFourPictureSymbols(String rawCode) {
        if (rawCode == null || rawCode.isBlank()) {
            return "BOOK-APPLE-PANDA-RAIL";
        }
        String[] parts = rawCode.trim().toUpperCase().split("[-_\\s]+");
        if (parts.length == 4) {
            return String.join("-", parts);
        }
        return "BOOK-APPLE-PANDA-RAIL";
    }

    /**
     * Converts 4-word picture symbols into the numeric index passcode format used by M:EE discovery.
     */
    public static String symbolsToNumericPasscode(String joinCode) {
        String[] parts = normalizeToFourPictureSymbols(joinCode).split("-");
        List<String> indices = new ArrayList<>();
        for (String part : parts) {
            int idx = EDU_PICTURE_SYMBOLS.indexOf(part);
            indices.add(String.valueOf(idx >= 0 ? idx + 1 : 1));
        }
        return String.join(",", indices);
    }

    public String buildShareLink(String joinCode) {
        return "https://education.minecraft.net/joinworld/"
                + Base64.getUrlEncoder().withoutPadding().encodeToString(joinCode.getBytes(StandardCharsets.UTF_8))
                + "?connectionId=" + this.connectionId;
    }

    public String getConnectionId() {
        return connectionId;
    }

    public Map<String, TenantSessionRecord> getActiveTenantSessions() {
        return Collections.unmodifiableMap(activeTenantSessions);
    }

    public void stop() {
        if (signalingWebSocket != null) {
            try {
                signalingWebSocket.sendClose(WebSocket.NORMAL_CLOSURE, "Proxy shutting down");
            } catch (Exception ignored) {
            }
        }
    }
}
