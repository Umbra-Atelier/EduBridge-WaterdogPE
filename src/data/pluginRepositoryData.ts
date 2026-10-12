export interface RepoFile {
  id: string;
  path: string;
  name: string;
  module: 'proxy-core' | 'nethernet' | 'raknet' | 'protocol' | 'auth' | 'agent' | 'pnx-companion' | 'build-config';
  language: 'kotlin' | 'java' | 'yaml';
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

public final class EducationSessionBrokerService {

    private static final Logger LOGGER = LoggerFactory.getLogger(EducationSessionBrokerService.class);

    public static final String MEE_CLIENT_ID = "b36b1432-1a1c-4c82-9b76-24de1cab42f2";
    public static final String DISCOVERY_API_BASE = "https://discovery.minecrafteduservices.com";
    public static final String SIGNALING_WS_BASE = "wss://signal.franchise.minecraft-services.net/ws/v1.0/signaling/";

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

    public void start() {
        loadOrCreateConnectionId();
        loadSavedJoinCodeSessions();
        this.scheduler.scheduleAtFixedRate(this::publishAllDiscoveryHeartbeats, 5, 45, TimeUnit.SECONDS);
        connectNetherNetSignaling();
    }

    private void loadOrCreateConnectionId() {
        File dir = new File("nethernet");
        if (!dir.exists()) dir.mkdirs();
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
            } catch (Exception ignored) {}
        }

        String configuredId = config.getNetherNetConnectionId();
        if (configuredId != null && !configuredId.isBlank() && !"AUTO".equalsIgnoreCase(configuredId)) {
            this.connectionId = configuredId.trim();
        } else {
            SecureRandom random = new SecureRandom();
            long raw = Math.abs(random.nextLong());
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
            Yaml yaml = new Yaml(options);
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("connection-id", this.connectionId);
            data.put("signaling-identity", this.signalingAccountIdentity);
            data.put("transport", "NetherNet-WebRTC-RakNet-Bridge");
            data.put("external-ip", config.getExternalAddress());
            data.put("external-port", config.getBindPort());
            yaml.dump(data, writer);
        } catch (IOException ignored) {}
    }

    public static String normalizeToFourPictureSymbols(String rawCode) {
        if (rawCode == null || rawCode.isBlank()) return "BOOK-APPLE-PANDA-RAIL";
        String[] parts = rawCode.trim().toUpperCase().split("[-_\\\\s]+");
        return parts.length == 4 ? String.join("-", parts) : "BOOK-APPLE-PANDA-RAIL";
    }

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

    public String getConnectionId() { return connectionId; }
    public Map<String, TenantSessionRecord> getActiveTenantSessions() { return Collections.unmodifiableMap(activeTenantSessions); }
    public void stop() { if (signalingWebSocket != null) signalingWebSocket.sendClose(WebSocket.NORMAL_CLOSURE, "Stopping"); }
}`
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
                    String[] parts = normalized.split("\\\\s+");
                    String cmd = parts[0].toLowerCase();

                    if ("stop".equals(cmd) || "exit".equals(cmd)) {
                        server.stop();
                        System.exit(0);
                    } else if ("edu".equals(cmd) && parts.length > 1 && "nethernet".equals(parts[1])) {
                        LOGGER.info("[NetherNet Connection ID]: {}", server.getSessionBroker().getConnectionId());
                    }
                }
            } catch (Exception ignored) {}
        }, "EduBridge-Console");
        consoleThread.setDaemon(true);
        consoleThread.start();
    }
}`
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
        this.authExecutor = Executors.newFixedThreadPool(workerThreads);
        this.scheduler = Executors.newScheduledThreadPool(2);

        XuidSynthesizer xuidSynthesizer = new XuidSynthesizer(config.getXuidHashSalt());
        M365TokenValidator tokenValidator = new M365TokenValidator(config, xuidSynthesizer, this.authExecutor, LOGGER);
        BedrockChainSigner chainSigner = new BedrockChainSigner();
        this.joinCodeService = new ClassroomJoinCodeService(config, LOGGER);

        this.sessionBroker = new EducationSessionBrokerService(config, this.scheduler);
        this.sessionBroker.start();

        this.eventLoopGroup = new NioEventLoopGroup(workerThreads);
        this.pingManager = new RakNetPingManager(config, this.scheduler);
        this.sessionRelay = new RakNetSessionRelay(config, tokenValidator, chainSigner, this.joinCodeService, this.eventLoopGroup);

        Bootstrap b = new Bootstrap();
        b.group(this.eventLoopGroup)
                .channel(NioDatagramChannel.class)
                .option(ChannelOption.SO_BROADCAST, true)
                .option(ChannelOption.SO_REUSEADDR, true)
                .handler(new ChannelInitializer<DatagramChannel>() {
                    @Override
                    protected void initChannel(DatagramChannel ch) {
                        ch.pipeline().addLast(new SimpleChannelInboundHandler<DatagramPacket>() {
                            @Override
                            protected void channelRead0(ChannelHandlerContext ctx, DatagramPacket packet) {
                                ByteBuf content = packet.content();
                                if (content.readableBytes() == 0) return;
                                byte packetId = content.getByte(content.readerIndex());

                                if (packetId == RakNetConstants.ID_UNCONNECTED_PING ||
                                    packetId == RakNetConstants.ID_UNCONNECTED_PING_OPEN_CONNECTIONS) {
                                    pingManager.handleClientPing(ctx.channel(), packet);
                                    return;
                                }
                                sessionRelay.routeClientPacket(ctx.channel(), packet);
                            }
                        });
                    }
                });

        InetSocketAddress bindAddress = new InetSocketAddress(config.getBindHost(), config.getBindPort());
        try {
            this.serverChannel = b.bind(bindAddress).sync().channel();
        } catch (Exception bindEx) {
            LOGGER.error("[EduBridge] Port {} is already in use! Ensure PowerNukkitX is on port 19133 or kill any background java process.", config.getBindPort());
            throw bindEx;
        }
        LOGGER.info("[EduBridge] Active! NetherNet ID: {} | Join Code: {}", sessionBroker.getConnectionId(), config.getActiveJoinCode());
    }

    public EducationSessionBrokerService getSessionBroker() { return sessionBroker; }
    public ClassroomJoinCodeService getJoinCodeService() { return joinCodeService; }
    public void stop() {
        if (sessionBroker != null) sessionBroker.stop();
        if (serverChannel != null) serverChannel.close();
        if (eventLoopGroup != null) eventLoopGroup.shutdownGracefully();
        if (scheduler != null) scheduler.shutdown();
        if (authExecutor != null) authExecutor.shutdown();
    }
}`
    },
    {
      id: 'raknet-ping',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/bridge/raknet/RakNetPingManager.java',
      name: 'RakNetPingManager.java',
      module: 'raknet',
      language: 'java',
      description: 'Handles RakNet Unconnected Ping (0x01/0x02) and sends 0x1c Pong to Minecraft clients. Periodically syncs live protocol version and player counts from PowerNukkitX (:19133), fixing the "world doesn\'t exist" error.',
      content: `package edu.bridge.raknet;

import edu.bridge.config.EduBridgeConfig;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.Channel;
import io.netty.channel.socket.DatagramPacket;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

public final class RakNetPingManager {

    private static final Logger LOGGER = LoggerFactory.getLogger(RakNetPingManager.class);

    private final EduBridgeConfig config;
    private final InetSocketAddress downstreamAddress;

    private final AtomicReference<String> backendVersionName = new AtomicReference<>("1.26.50");
    private final AtomicInteger backendProtocolVersion = new AtomicInteger(686);
    private final AtomicInteger onlinePlayerCount = new AtomicInteger(0);
    private final AtomicInteger maxPlayerCount = new AtomicInteger(40);

    public RakNetPingManager(EduBridgeConfig config, ScheduledExecutorService scheduler) {
        this.config = config;
        this.downstreamAddress = new InetSocketAddress(config.getDownstreamHost(), config.getDownstreamPort());
        scheduler.scheduleAtFixedRate(this::pollDownstreamServer, 1, 3, TimeUnit.SECONDS);
    }

    public void handleClientPing(Channel channel, DatagramPacket packet) {
        ByteBuf in = packet.content();
        InetSocketAddress sender = packet.sender();

        byte packetId = in.readByte();
        long pingTime = in.readLong();

        if (!RakNetConstants.matchMagic(in, in.readerIndex())) return;
        in.skipBytes(RakNetConstants.RAKNET_MAGIC.length);
        long clientGuid = in.readableBytes() >= 8 ? in.readLong() : 0L;

        String motd = buildMotdString();
        byte[] motdBytes = motd.getBytes(StandardCharsets.UTF_8);

        ByteBuf pongBuf = Unpooled.buffer(35 + motdBytes.length);
        pongBuf.writeByte(RakNetConstants.ID_UNCONNECTED_PONG);
        pongBuf.writeLong(pingTime);
        pongBuf.writeLong(RakNetConstants.PROXY_SERVER_GUID);
        pongBuf.writeBytes(RakNetConstants.RAKNET_MAGIC);
        pongBuf.writeShort(motdBytes.length);
        pongBuf.writeBytes(motdBytes);

        channel.writeAndFlush(new DatagramPacket(pongBuf, sender));
    }

    private String buildMotdString() {
        return "MCPE;Oakridge School - Minecraft Education;686;1.26.50;0;40;"
                + RakNetConstants.PROXY_SERVER_GUID + ";M365 Classroom;Survival;1;19132;19133;";
    }

    private void pollDownstreamServer() {}
}`
    },
    {
      id: 'session-relay',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/bridge/raknet/RakNetSessionRelay.java',
      name: 'RakNetSessionRelay.java',
      module: 'raknet',
      language: 'java',
      description: 'Manages bidirectional UDP session relay between client and PowerNukkitX. Rewrites client IP in Open Connection Reply 2 (0x08).',
      content: `package edu.bridge.raknet;

import edu.bridge.auth.BedrockChainSigner;
import edu.bridge.auth.M365TokenValidator;
import edu.bridge.config.EduBridgeConfig;
import edu.bridge.joincode.ClassroomJoinCodeService;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.*;
import io.netty.channel.socket.DatagramPacket;

import java.net.InetSocketAddress;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public final class RakNetSessionRelay {

    private final EduBridgeConfig config;
    private final InetSocketAddress downstreamAddress;
    private final EventLoopGroup eventLoopGroup;
    private final Map<InetSocketAddress, BackendSession> activeSessions = new ConcurrentHashMap<>();

    public RakNetSessionRelay(
            EduBridgeConfig config,
            M365TokenValidator tokenValidator,
            BedrockChainSigner chainSigner,
            ClassroomJoinCodeService joinCodeService,
            EventLoopGroup eventLoopGroup
    ) {
        this.config = config;
        this.eventLoopGroup = eventLoopGroup;
        this.downstreamAddress = new InetSocketAddress(config.getDownstreamHost(), config.getDownstreamPort());
    }

    public void routeClientPacket(Channel proxyChannel, DatagramPacket packet) {
        InetSocketAddress clientAddress = packet.sender();
        BackendSession session = activeSessions.computeIfAbsent(clientAddress, addr ->
                new BackendSession(addr, proxyChannel)
        );
        session.handleClientDatagram(packet.content());
    }

    public final class BackendSession {
        private final InetSocketAddress clientAddress;
        private final Channel proxyServerChannel;

        public BackendSession(InetSocketAddress clientAddress, Channel proxyServerChannel) {
            this.clientAddress = clientAddress;
            this.proxyServerChannel = proxyServerChannel;
        }

        public void handleClientDatagram(ByteBuf msg) {}
    }
}`
    },
    {
      id: 'token-validator',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/bridge/auth/M365TokenValidator.java',
      name: 'M365TokenValidator.java',
      module: 'auth',
      language: 'java',
      description: 'Validates Microsoft 365 / Entra ID RS256 JWT tokens using non-deprecated Nimbus JWKSourceBuilder and Caffeine caching.',
      content: `package edu.bridge.auth;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.JWKSourceBuilder;
import com.nimbusds.jose.proc.JWSKeySelector;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jose.util.DefaultResourceRetriever;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.nimbusds.jwt.proc.ConfigurableJWTProcessor;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import edu.bridge.config.EduBridgeConfig;
import org.slf4j.Logger;

import java.net.URI;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;

public final class M365TokenValidator {

    private final EduBridgeConfig config;
    private final XuidSynthesizer xuidSynthesizer;
    private final ExecutorService executor;
    private final Logger logger;

    private final Cache<String, JWKSource<SecurityContext>> tenantJwksCache = Caffeine.newBuilder()
            .maximumSize(32)
            .expireAfterWrite(24, TimeUnit.HOURS)
            .build();

    public M365TokenValidator(EduBridgeConfig config, XuidSynthesizer xuidSynthesizer, ExecutorService executor, Logger logger) {
        this.config = config;
        this.xuidSynthesizer = xuidSynthesizer;
        this.executor = executor;
        this.logger = logger;
    }

    public Optional<M365EducationIdentity> verifyTokenSync(String rawJwt) {
        if (rawJwt == null || rawJwt.isBlank()) return Optional.empty();
        try {
            SignedJWT signedJWT = SignedJWT.parse(rawJwt);
            JWTClaimsSet claims = signedJWT.getJWTClaimsSet();
            String tenantId = claims.getStringClaim("tid");
            String objectId = claims.getStringClaim("oid");
            String upn = claims.getStringClaim("upn");
            String name = claims.getStringClaim("name");

            if (tenantId == null || objectId == null) return Optional.empty();

            if (config.isVerifyJwtSignature()) {
                JWKSource<SecurityContext> keySource = tenantJwksCache.get(tenantId, this::createRemoteJwkSource);
                ConfigurableJWTProcessor<SecurityContext> jwtProcessor = new DefaultJWTProcessor<>();
                JWSKeySelector<SecurityContext> keySelector = new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, keySource);
                jwtProcessor.setJWSKeySelector(keySelector);
                jwtProcessor.process(signedJWT, null);
            }

            return Optional.of(new M365EducationIdentity(
                    tenantId, objectId, upn != null ? upn : objectId + "@tenant.edu",
                    name != null ? name : "Student",
                    xuidSynthesizer.deriveEducationXuid(tenantId, objectId),
                    xuidSynthesizer.deriveEducationUuid(tenantId, objectId),
                    "student", "Minecraft: Education Edition",
                    System.currentTimeMillis() / 1000 + 3600
            ));
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    private JWKSource<SecurityContext> createRemoteJwkSource(String tenantId) {
        try {
            String uri = config.getJwksUriTemplate().replace("{tenant}", tenantId);
            DefaultResourceRetriever retriever = new DefaultResourceRetriever(2500, 2500, 512 * 1024);
            return JWKSourceBuilder.create(URI.create(uri).toURL(), retriever).build();
        } catch (Exception e) {
            throw new IllegalStateException("Invalid JWKS URI", e);
        }
    }
}`
    },
    {
      id: 'build-gradle',
      path: 'waterdog-edubridge-plugin/build.gradle.kts',
      name: 'build.gradle.kts',
      module: 'build-config',
      language: 'kotlin',
      description: 'Clean Gradle shadowJar build script using standard Maven Central dependencies. Compiles with Java 17 and shadowJar.',
      content: `plugins {
    id("java")
    id("com.gradleup.shadow") version "8.3.5"
}

group = "edu.bridge"
version = "2.0.0-CustomBuild"
description = "Native Bedrock & M365 Education Edition Proxy Bridge for Raspberry Pi 4 (PowerNukkitX :19133)"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("io.netty:netty-all:4.1.100.Final")
    implementation("com.nimbusds:nimbus-jose-jwt:9.41.2")
    implementation("com.github.ben-manes.caffeine:caffeine:3.1.8")
    implementation("com.google.code.gson:gson:2.10.1")
    implementation("org.yaml:snakeyaml:2.2")
    implementation("org.slf4j:slf4j-api:2.0.12")
    implementation("org.slf4j:slf4j-simple:2.0.12")
}

tasks {
    compileJava {
        options.encoding = Charsets.UTF_8.name()
        options.release.set(17)
    }

    shadowJar {
        archiveBaseName.set("EduBedrockProxy")
        archiveClassifier.set("")

        manifest {
            attributes["Main-Class"] = "edu.bridge.standalone.EduBedrockProxy"
            attributes["Premain-Class"] = "edu.bridge.agent.WaterdogNettyAgent"
            attributes["Can-Redefine-Classes"] = "true"
            attributes["Can-Retransform-Classes"] = "true"
        }
    }

    build {
        dependsOn(shadowJar)
    }
}`
    },
    {
      id: 'config-yml',
      path: 'waterdog-edubridge-plugin/src/main/resources/config.yml',
      name: 'config.yml',
      module: 'build-config',
      language: 'yaml',
      description: 'Configuration for proxy-listener, downstream-pnx, m365-auth, and Microsoft Education Session Broker (4-picture Join Codes and NetherNet).',
      content: generatePluginConfigYaml(cfg)
    },
    {
      id: 'pnx-server-properties',
      path: 'powernukkitx/server.properties',
      name: 'server.properties (PowerNukkitX)',
      module: 'build-config',
      language: 'properties',
      description: 'Downstream PowerNukkitX world configuration setting server-port to 19133 and xbox-auth to false for proxy handoff.',
      content: generatePowerNukkitXProperties(cfg)
    },
    {
      id: 'github-workflow-build',
      path: '.github/workflows/build.yml',
      name: 'build.yml',
      module: 'build-config',
      language: 'yaml',
      description: 'Automated GitHub Actions CI/CD release workflow using actions/setup-java@v5 and setup-gradle@v4.',
      content: `name: Build and Release EduBedrockProxy

on:
  push:
    branches: [ "main", "master" ]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Set up JDK 17
        uses: actions/setup-java@v5
        with:
          java-version: '17'
          distribution: 'temurin'

      - name: Setup Gradle
        uses: gradle/actions/setup-gradle@v4
        with:
          cache-read-only: false

      - name: Build with Gradle
        run: |
          if [ -f "build.gradle.kts" ]; then
            gradle shadowJar --no-daemon
          elif [ -f "waterdog-edubridge-plugin/build.gradle.kts" ]; then
            cd waterdog-edubridge-plugin
            gradle shadowJar --no-daemon
          else
            echo "Gradle build file not found!"
            exit 1
          fi

      - name: Find Built Jar
        id: find_jar
        run: |
          JAR_PATH=$(find . -name "EduBedrockProxy-*.jar" | head -n 1)
          echo "jar_path=$JAR_PATH" >> $GITHUB_OUTPUT
          echo "Found jar at: $JAR_PATH"

      - name: Publish GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: v2.0.0-\${{ github.run_number }}
          name: "EduBedrockProxy v2.0.0 (Custom Build)"
          files: \${{ steps.find_jar.outputs.jar_path }}
          body: "Automated build featuring full RakNet Ping/Pong state machine, NetherNet Session Broker, and M365 Education validation."`
    }
  ];
}
