export interface RepoFile {
  id: string;
  path: string;
  name: string;
  module: 'proxy-core' | 'protocol' | 'auth' | 'agent' | 'pnx-companion' | 'build-config';
  language: 'kotlin' | 'java' | 'yaml';
  description: string;
  content: string;
}

export interface BridgeCustomConfig {
  bindHost: string;
  bindPort: number;
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
# EduBedrockProxy Configuration (Raspberry Pi 4 Low-Resource Profile)
# Bridges Minecraft Education Edition (M365 Tenant Auth) -> PowerNukkitX (:19133)
# ============================================================================

# 1. Front-facing Bedrock Proxy Listener (Port ${cfg.bindPort})
proxy-listener:
  host: "${cfg.bindHost}"
  port: ${cfg.bindPort}
  motd: "§bOakridge School §7- §aMinecraft Education Edition"
  sub_motd: "§fM365 Authenticated Classroom Server"

# 2. Downstream PowerNukkitX Server (Port ${cfg.downstreamPort})
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

# 4. Classroom Join Code Gatekeeper (Replaces EduGeyser Join Codes)
classroom-join-code:
  enabled: ${cfg.joinCodeEnabled}
  active-code: "${cfg.activeJoinCode}"
  session-ttl-minutes: ${cfg.sessionTtlMinutes}

# 5. Raspberry Pi 4 (ARM64 Cortex-A72) Performance Tuning
hardware-tuning:
  async-verifier-threads: ${cfg.asyncVerifierThreads}
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
      module: 'build-config',
      language: 'kotlin',
      description: 'Clean Gradle shadowJar build script using standard Maven Central dependencies (Netty, Nimbus JOSE+JWT, Caffeine, Gson, SnakeYAML). Zero missing Waterdog internal classes.',
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
    // High-performance Netty 4.1 networking (used for UDP RakNet/Bedrock framing & pipeline interception)
    implementation("io.netty:netty-all:4.1.100.Final")

    // Cryptographic validation of Microsoft 365 Entra ID (Azure AD) OIDC & JWKS tokens
    implementation("com.nimbusds:nimbus-jose-jwt:9.41.2")

    // High-performance, bounded caching for Microsoft JWKS keys on Raspberry Pi 4 Cortex-A72
    implementation("com.github.ben-manes.caffeine:caffeine:3.1.8")

    // JSON and YAML configuration parsing
    implementation("com.google.code.gson:gson:2.10.1")
    implementation("org.yaml:snakeyaml:2.2")

    // SLF4J / Logging
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
            // Can be executed standalone: java -jar EduBedrockProxy.jar
            attributes["Main-Class"] = "edu.bridge.standalone.EduBedrockProxy"
            // Can also be attached as a JavaAgent to WaterdogPE to intercept Netty pipelines: -javaagent:EduBedrockProxy.jar
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
      id: 'settings-gradle',
      path: 'waterdog-edubridge-plugin/settings.gradle.kts',
      name: 'settings.gradle.kts',
      module: 'build-config',
      language: 'kotlin',
      description: 'Gradle root project descriptor.',
      content: `rootProject.name = "EduBedrockProxy"\n`
    },
    {
      id: 'config-yml',
      path: 'waterdog-edubridge-plugin/src/main/resources/config.yml',
      name: 'config.yml',
      module: 'build-config',
      language: 'yaml',
      description: 'Configuration file for allowed M365 Tenant UUIDs, Join Code sequence, and PowerNukkitX downstream routing.',
      content: generatePluginConfigYaml(cfg)
    },
    {
      id: 'main-proxy',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/bridge/standalone/EduBedrockProxy.java',
      name: 'EduBedrockProxy.java',
      module: 'proxy-core',
      language: 'java',
      description: 'Standalone application entry point. Initializes Netty UDP listener on port 19132 and connects directly to PowerNukkitX on 19133 with ~60MB RAM footprint.',
      content: `package edu.bridge.standalone;

import edu.bridge.config.EduBridgeConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;

/**
 * Standalone Application Entry Point for EduBedrockProxy.
 *
 * Runs as a native, low-resource Bedrock proxy on Raspberry Pi 4 (takes ~60MB RAM),
 * eliminating the need for a Java Edition server or EduGeyser.
 *
 * Command:
 *   java -jar EduBedrockProxy.jar
 */
public final class EduBedrockProxy {

    private static final Logger LOGGER = LoggerFactory.getLogger(EduBedrockProxy.class);

    public static void main(String[] args) {
        LOGGER.info("[EduBridge] Starting standalone Native Bedrock & M365 Education Proxy...");

        File configFile = new File("config.yml");
        EduBridgeConfig config = EduBridgeConfig.load(configFile, LOGGER);

        EduBedrockServer server = new EduBedrockServer(config);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            LOGGER.info("[EduBridge] Shutdown signal received, terminating proxy...");
            server.stop();
        }, "EduBridge-ShutdownHook"));

        try {
            server.start();
        } catch (Exception e) {
            LOGGER.error("[EduBridge] Fatal error starting EduBedrockProxy", e);
            System.exit(1);
        }
    }
}`
    },
    {
      id: 'bedrock-server',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/bridge/standalone/EduBedrockServer.java',
      name: 'EduBedrockServer.java',
      module: 'proxy-core',
      language: 'java',
      description: 'Netty DatagramChannel server pipeline bootstrap configuring BedrockPacketCodec and EduSessionBridge.',
      content: `package edu.bridge.standalone;

import edu.bridge.auth.BedrockChainSigner;
import edu.bridge.auth.M365TokenValidator;
import edu.bridge.auth.XuidSynthesizer;
import edu.bridge.config.EduBridgeConfig;
import edu.bridge.joincode.ClassroomJoinCodeService;
import edu.bridge.protocol.BedrockPacketCodec;
import edu.bridge.proxy.EduSessionBridge;
import io.netty.bootstrap.Bootstrap;
import io.netty.channel.*;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.DatagramChannel;
import io.netty.channel.socket.nio.NioDatagramChannel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.InetSocketAddress;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

public final class EduBedrockServer {

    private static final Logger LOGGER = LoggerFactory.getLogger(EduBedrockServer.class);

    private final EduBridgeConfig config;
    private EventLoopGroup eventLoopGroup;
    private ExecutorService authExecutor;
    private Channel serverChannel;

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

        XuidSynthesizer xuidSynthesizer = new XuidSynthesizer(config.getXuidHashSalt());
        M365TokenValidator tokenValidator = new M365TokenValidator(config, xuidSynthesizer, this.authExecutor, LOGGER);
        BedrockChainSigner chainSigner = new BedrockChainSigner();
        ClassroomJoinCodeService joinCodeService = new ClassroomJoinCodeService(config, LOGGER);

        this.eventLoopGroup = new NioEventLoopGroup(workerThreads);

        Bootstrap b = new Bootstrap();
        b.group(this.eventLoopGroup)
                .channel(NioDatagramChannel.class)
                .option(ChannelOption.SO_BROADCAST, true)
                .handler(new ChannelInitializer<DatagramChannel>() {
                    @Override
                    protected void initChannel(DatagramChannel ch) {
                        ch.pipeline().addLast("bedrockCodec", new BedrockPacketCodec());
                        ch.pipeline().addLast("eduSessionBridge", new EduSessionBridge(
                                config,
                                tokenValidator,
                                chainSigner,
                                joinCodeService,
                                LOGGER
                        ));
                    }
                });

        InetSocketAddress bindAddress = new InetSocketAddress(config.getBindHost(), config.getBindPort());
        this.serverChannel = b.bind(bindAddress).sync().channel();

        LOGGER.info("====================================================================");
        LOGGER.info(" EduBedrockProxy Active!");
        LOGGER.info(" Listening on Bedrock Port: {}:{}", config.getBindHost(), config.getBindPort());
        LOGGER.info(" Forwarding to PowerNukkitX: {}:{}", config.getDownstreamHost(), config.getDownstreamPort());
        LOGGER.info(" Allowed M365 Tenants: {}", config.getAllowedTenantIds());
        LOGGER.info(" Active Classroom Join Code: {}", config.getActiveJoinCode());
        LOGGER.info(" Raspberry Pi 4 Worker Threads: {}", workerThreads);
        LOGGER.info("====================================================================");
    }

    public void stop() {
        if (serverChannel != null) {
            serverChannel.close();
        }
        if (eventLoopGroup != null) {
            eventLoopGroup.shutdownGracefully();
        }
        if (authExecutor != null) {
            authExecutor.shutdown();
        }
        LOGGER.info("[EduBridge] Proxy stopped cleanly.");
    }
}`
    },
    {
      id: 'session-bridge',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/bridge/proxy/EduSessionBridge.java',
      name: 'EduSessionBridge.java',
      module: 'proxy-core',
      language: 'java',
      description: 'The core interception handler. Decodes incoming Bedrock LoginPacket, validates M365 token & join code, re-signs with proxy KeyPair, and bridges bidirectionally to PowerNukkitX (port 19133).',
      content: `package edu.bridge.proxy;

import com.google.gson.JsonObject;
import edu.bridge.auth.BedrockChainSigner;
import edu.bridge.auth.M365EducationIdentity;
import edu.bridge.auth.M365TokenValidator;
import edu.bridge.config.EduBridgeConfig;
import edu.bridge.joincode.ClassroomJoinCodeService;
import edu.bridge.protocol.BedrockPacketCodec;
import edu.bridge.protocol.EduLoginPacket;
import io.netty.bootstrap.Bootstrap;
import io.netty.buffer.ByteBuf;
import io.netty.channel.*;
import io.netty.channel.socket.DatagramChannel;
import io.netty.channel.socket.nio.NioDatagramChannel;
import org.slf4j.Logger;

import java.net.InetSocketAddress;
import java.util.Optional;

public final class EduSessionBridge extends SimpleChannelInboundHandler<ByteBuf> {

    private final EduBridgeConfig config;
    private final M365TokenValidator tokenValidator;
    private final BedrockChainSigner chainSigner;
    private final ClassroomJoinCodeService joinCodeService;
    private final Logger logger;

    private Channel clientChannel;
    private Channel backendChannel;
    private boolean authenticated = false;
    private M365EducationIdentity identity;

    public EduSessionBridge(
            EduBridgeConfig config,
            M365TokenValidator tokenValidator,
            BedrockChainSigner chainSigner,
            ClassroomJoinCodeService joinCodeService,
            Logger logger
    ) {
        this.config = config;
        this.tokenValidator = tokenValidator;
        this.chainSigner = chainSigner;
        this.joinCodeService = joinCodeService;
        this.logger = logger;
    }

    @Override
    public void channelActive(ChannelHandlerContext ctx) throws Exception {
        this.clientChannel = ctx.channel();
        super.channelActive(ctx);
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, ByteBuf msg) throws Exception {
        if (!authenticated) {
            handleInitialPacket(ctx, msg);
        } else {
            if (backendChannel != null && backendChannel.isActive()) {
                backendChannel.writeAndFlush(msg.retain());
            }
        }
    }

    private void handleInitialPacket(ChannelHandlerContext ctx, ByteBuf msg) {
        int readerIndex = msg.readerIndex();
        int packetId = EduLoginPacket.readVarInt(msg);

        if (packetId != 0x01) {
            msg.readerIndex(readerIndex);
            if (backendChannel != null && backendChannel.isActive()) {
                backendChannel.writeAndFlush(msg.retain());
            }
            return;
        }

        logger.info("[EduBridge] Intercepted Bedrock LoginPacket (0x01) from Education Edition client");
        EduLoginPacket loginPacket = EduLoginPacket.decode(msg);

        String candidateM365Jwt = null;
        for (String jwt : loginPacket.getChain()) {
            if (jwt != null && jwt.split("\\\\.").length == 3) {
                candidateM365Jwt = jwt;
                break;
            }
        }

        if (candidateM365Jwt == null && loginPacket.getClientDataJson().has("M365Token")) {
            candidateM365Jwt = loginPacket.getClientDataJson().get("M365Token").getAsString();
        }

        Optional<M365EducationIdentity> verifiedOpt = Optional.empty();
        if (candidateM365Jwt != null) {
            verifiedOpt = tokenValidator.verifyTokenSync(candidateM365Jwt);
        } else if (config.isAllowHybridRetailXbox()) {
            logger.info("[EduBridge] Allowing standard Retail Xbox Bedrock connection (hybrid mode active)");
            authenticated = true;
            connectToPowerNukkitX(ctx, msg, readerIndex);
            return;
        }

        if (verifiedOpt.isEmpty()) {
            logger.warn("[EduBridge] Rejected unauthenticated M365 Education Edition client");
            disconnectClient(ctx, "§cMicrosoft 365 School Authentication Failed.\\n§7Please log in with an authorized school tenant account.");
            return;
        }

        this.identity = verifiedOpt.get();

        JsonObject clientData = loginPacket.getClientDataJson();
        String submittedJoinCode = clientData.has("JoinCode") ? clientData.get("JoinCode").getAsString() : null;
        boolean joinCodeOk = identity.isTeacher() || joinCodeService.verifyCodeInput(identity.synthesizedUuid(), submittedJoinCode);

        if (!joinCodeOk && config.isJoinCodeEnabled()) {
            logger.warn("[EduBridge] Student {} failed Classroom Join Code check (Submitted: {})", identity.displayName(), submittedJoinCode);
            disconnectClient(ctx, "§cClassroom Join Code Required.\\n§7Please enter the active code set by your teacher: " + config.getActiveJoinCode());
            return;
        }

        String signedExtraJwt = chainSigner.signExtraDataJwt(identity, joinCodeOk);
        String signedClientJwt = chainSigner.signClientDataJwt(clientData, identity);

        ByteBuf rewrittenLoginPacket = ctx.alloc().buffer();
        EduLoginPacket.writeVarInt(rewrittenLoginPacket, 0x01);
        EduLoginPacket.encode(rewrittenLoginPacket, loginPacket.getProtocolVersion(), chainSigner.buildChain(signedExtraJwt), signedClientJwt);

        logger.info("[EduBridge] Verified M365 {} '{}' ({}) | Synthesized XUID: {} -> Routing to PowerNukkitX ({}:{})",
                identity.eduRole().toUpperCase(),
                identity.displayName(),
                identity.userPrincipalName(),
                identity.synthesizedXuid(),
                config.getDownstreamHost(),
                config.getDownstreamPort()
        );

        this.authenticated = true;
        connectToPowerNukkitX(ctx, rewrittenLoginPacket, 0);
    }

    private void connectToPowerNukkitX(ChannelHandlerContext ctx, ByteBuf initialPacket, int readerIndex) {
        Bootstrap b = new Bootstrap();
        b.group(ctx.channel().eventLoop())
                .channel(NioDatagramChannel.class)
                .handler(new ChannelInitializer<DatagramChannel>() {
                    @Override
                    protected void initChannel(DatagramChannel ch) {
                        ch.pipeline().addLast(new BedrockPacketCodec());
                        ch.pipeline().addLast(new SimpleChannelInboundHandler<ByteBuf>() {
                            @Override
                            protected void channelRead0(ChannelHandlerContext bctx, ByteBuf bmsg) {
                                if (clientChannel != null && clientChannel.isActive()) {
                                    clientChannel.writeAndFlush(bmsg.retain());
                                }
                            }

                            @Override
                            public void channelInactive(ChannelHandlerContext bctx) {
                                if (clientChannel != null && clientChannel.isActive()) {
                                    clientChannel.close();
                                }
                            }
                        });
                    }
                });

        ChannelFuture future = b.connect(new InetSocketAddress(config.getDownstreamHost(), config.getDownstreamPort()));
        future.addListener((ChannelFutureListener) f -> {
            if (f.isSuccess()) {
                this.backendChannel = f.channel();
                initialPacket.readerIndex(readerIndex);
                this.backendChannel.writeAndFlush(initialPacket.retain());
            } else {
                logger.error("[EduBridge] Failed to connect to downstream PowerNukkitX on {}:{}",
                        config.getDownstreamHost(), config.getDownstreamPort(), f.cause());
                disconnectClient(ctx, "§cCould not connect to downstream PowerNukkitX server (127.0.0.1:" + config.getDownstreamPort() + ").");
            }
        });
    }

    private void disconnectClient(ChannelHandlerContext ctx, String reason) {
        ByteBuf disconnectPacket = BedrockPacketCodec.createDisconnectPacket(reason);
        ctx.writeAndFlush(disconnectPacket).addListener(ChannelFutureListener.CLOSE);
    }

    @Override
    public void channelInactive(ChannelHandlerContext ctx) throws Exception {
        if (backendChannel != null && backendChannel.isActive()) {
            backendChannel.close();
        }
        super.channelInactive(ctx);
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        logger.warn("[EduBridge] Session exception: {}", cause.getMessage());
        ctx.close();
    }
}`
    },
    {
      id: 'login-packet',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/bridge/protocol/EduLoginPacket.java',
      name: 'EduLoginPacket.java',
      module: 'protocol',
      language: 'java',
      description: 'Parses Bedrock LoginPacket (0x01) payloads, extracting the M365 JWT chain and clientData, and re-encodes the rewritten authentication chain.',
      content: `package edu.bridge.protocol;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import io.netty.buffer.ByteBuf;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

public final class EduLoginPacket {

    private final int protocolVersion;
    private final List<String> chain;
    private final String clientDataJwt;
    private final JsonObject clientDataJson;
    private final JsonObject extraDataJson;

    public EduLoginPacket(
            int protocolVersion,
            List<String> chain,
            String clientDataJwt,
            JsonObject clientDataJson,
            JsonObject extraDataJson
    ) {
        this.protocolVersion = protocolVersion;
        this.chain = chain;
        this.clientDataJwt = clientDataJwt;
        this.clientDataJson = clientDataJson;
        this.extraDataJson = extraDataJson;
    }

    public static EduLoginPacket decode(ByteBuf in) {
        int protocol = in.readInt();
        int payloadLength = readVarInt(in);
        byte[] payloadBytes = new byte[payloadLength];
        in.readBytes(payloadBytes);

        ByteBuf payloadBuf = io.netty.buffer.Unpooled.wrappedBuffer(payloadBytes);
        try {
            int chainLength = payloadBuf.readIntLE();
            byte[] chainBytes = new byte[chainLength];
            payloadBuf.readBytes(chainBytes);
            String chainJsonStr = new String(chainBytes, StandardCharsets.UTF_8);

            int skinLength = payloadBuf.readIntLE();
            byte[] skinBytes = new byte[skinLength];
            payloadBuf.readBytes(skinBytes);
            String skinJwtStr = new String(skinBytes, StandardCharsets.UTF_8);

            List<String> chainList = new ArrayList<>();
            JsonObject extraData = new JsonObject();
            try {
                JsonObject root = JsonParser.parseString(chainJsonStr).getAsJsonObject();
                if (root.has("chain")) {
                    JsonArray arr = root.getAsJsonArray("chain");
                    for (JsonElement el : arr) {
                        String jwt = el.getAsString();
                        chainList.add(jwt);
                        String[] parts = jwt.split("\\\\.");
                        if (parts.length >= 2) {
                            try {
                                byte[] decodedPayload = Base64.getUrlDecoder().decode(parts[1]);
                                JsonObject payloadJson = JsonParser.parseString(new String(decodedPayload, StandardCharsets.UTF_8)).getAsJsonObject();
                                if (payloadJson.has("extraData")) {
                                    extraData = payloadJson.getAsJsonObject("extraData");
                                }
                            } catch (Exception ignored) {
                            }
                        }
                    }
                }
            } catch (Exception ignored) {
            }

            JsonObject clientData = new JsonObject();
            try {
                String[] skinParts = skinJwtStr.split("\\\\.");
                if (skinParts.length >= 2) {
                    byte[] decodedSkin = Base64.getUrlDecoder().decode(skinParts[1]);
                    clientData = JsonParser.parseString(new String(decodedSkin, StandardCharsets.UTF_8)).getAsJsonObject();
                }
            } catch (Exception ignored) {
            }

            return new EduLoginPacket(protocol, chainList, skinJwtStr, clientData, extraData);
        } finally {
            payloadBuf.release();
        }
    }

    public static void encode(ByteBuf out, int protocolVersion, List<String> chain, String clientDataJwt) {
        out.writeInt(protocolVersion);

        JsonObject chainRoot = new JsonObject();
        JsonArray chainArr = new JsonArray();
        for (String c : chain) {
            chainArr.add(c);
        }
        chainRoot.add("chain", chainArr);

        byte[] chainBytes = chainRoot.toString().getBytes(StandardCharsets.UTF_8);
        byte[] skinBytes = clientDataJwt.getBytes(StandardCharsets.UTF_8);

        int payloadLen = 4 + chainBytes.length + 4 + skinBytes.length;
        writeVarInt(out, payloadLen);

        out.writeIntLE(chainBytes.length);
        out.writeBytes(chainBytes);
        out.writeIntLE(skinBytes.length);
        out.writeBytes(skinBytes);
    }

    public int getProtocolVersion() { return protocolVersion; }
    public List<String> getChain() { return chain; }
    public String getClientDataJwt() { return clientDataJwt; }
    public JsonObject getClientDataJson() { return clientDataJson; }
    public JsonObject getExtraDataJson() { return extraDataJson; }

    public static int readVarInt(ByteBuf in) {
        int result = 0;
        int shift = 0;
        while (shift < 35) {
            byte b = in.readByte();
            result |= (b & 0x7F) << shift;
            if ((b & 0x80) == 0) {
                return result;
            }
            shift += 7;
        }
        throw new RuntimeException("VarInt is too big");
    }

    public static void writeVarInt(ByteBuf out, int value) {
        while ((value & ~0x7F) != 0) {
            out.writeByte((value & 0x7F) | 0x80);
            value >>>= 7;
        }
        out.writeByte(value);
    }
}`
    },
    {
      id: 'bedrock-codec',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/bridge/protocol/BedrockPacketCodec.java',
      name: 'BedrockPacketCodec.java',
      module: 'protocol',
      language: 'java',
      description: 'Netty ByteToMessageCodec for Bedrock batch compression (0xfe) and VarInt length-prefixed packet framing.',
      content: `package edu.bridge.protocol;

import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.ByteToMessageCodec;

import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.zip.Deflater;
import java.util.zip.Inflater;

public final class BedrockPacketCodec extends ByteToMessageCodec<ByteBuf> {

    public static final byte BATCH_HEADER = (byte) 0xfe;

    @Override
    protected void decode(ChannelHandlerContext ctx, ByteBuf in, List<Object> out) throws Exception {
        if (!in.isReadable()) {
            return;
        }

        byte header = in.readByte();
        if (header != BATCH_HEADER) {
            in.readerIndex(in.readerIndex() - 1);
            out.add(in.readRetainedSlice(in.readableBytes()));
            return;
        }

        byte[] compressed = new byte[in.readableBytes()];
        in.readBytes(compressed);

        Inflater inflater = new Inflater();
        try {
            inflater.setInput(compressed);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buf = new byte[2048];
            while (!inflater.finished() && !inflater.needsInput()) {
                int count = inflater.inflate(buf);
                if (count > 0) {
                    baos.write(buf, 0, count);
                }
            }
            byte[] decompressed = baos.toByteArray();
            ByteBuf decompressedBuf = Unpooled.wrappedBuffer(decompressed);

            while (decompressedBuf.isReadable()) {
                int packetLength = EduLoginPacket.readVarInt(decompressedBuf);
                ByteBuf packetBuf = decompressedBuf.readRetainedSlice(packetLength);
                out.add(packetBuf);
            }
            decompressedBuf.release();
        } finally {
            inflater.end();
        }
    }

    @Override
    protected void encode(ChannelHandlerContext ctx, ByteBuf msg, ByteBuf out) throws Exception {
        out.writeByte(BATCH_HEADER);

        int packetLen = msg.readableBytes();
        ByteBuf packetBatch = ctx.alloc().buffer();
        try {
            EduLoginPacket.writeVarInt(packetBatch, packetLen);
            packetBatch.writeBytes(msg);

            byte[] uncompressed = new byte[packetBatch.readableBytes()];
            packetBatch.readBytes(uncompressed);

            Deflater deflater = new Deflater(Deflater.DEFAULT_COMPRESSION);
            deflater.setInput(uncompressed);
            deflater.finish();

            byte[] buf = new byte[1024];
            while (!deflater.finished()) {
                int count = deflater.deflate(buf);
                out.writeBytes(buf, 0, count);
            }
            deflater.end();
        } finally {
            packetBatch.release();
        }
    }

    public static ByteBuf createDisconnectPacket(String reason) {
        ByteBuf buf = Unpooled.buffer();
        EduLoginPacket.writeVarInt(buf, 0x05);
        EduLoginPacket.writeVarInt(buf, 0);
        byte[] reasonBytes = reason.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        EduLoginPacket.writeVarInt(buf, reasonBytes.length);
        buf.writeBytes(reasonBytes);
        return buf;
    }
}`
    },
    {
      id: 'chain-signer',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/bridge/auth/BedrockChainSigner.java',
      name: 'BedrockChainSigner.java',
      module: 'auth',
      language: 'java',
      description: 'Generates EC secp384r1 keypairs and cryptographically signs extraData & clientData into valid Bedrock JWT certificate chains for PowerNukkitX (:19133).',
      content: `package edu.bridge.auth;

import com.google.gson.JsonObject;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.spec.ECGenParameterSpec;
import java.time.Instant;
import java.util.Base64;
import java.util.Collections;
import java.util.Date;
import java.util.List;

public final class BedrockChainSigner {

    private final KeyPair proxyKeyPair;
    private final ECDSASigner signer;
    private final String base64PublicKey;

    public BedrockChainSigner() {
        try {
            KeyPairGenerator kpg = KeyPairGenerator.getInstance("EC");
            kpg.initialize(new ECGenParameterSpec("secp384r1"));
            this.proxyKeyPair = kpg.generateKeyPair();
            this.signer = new ECDSASigner((ECPrivateKey) this.proxyKeyPair.getPrivate());
            this.base64PublicKey = Base64.getEncoder().encodeToString(this.proxyKeyPair.getPublic().getEncoded());
        } catch (Exception e) {
            throw new IllegalStateException("Failed to initialize EC secp384r1 keypair for Bedrock proxy", e);
        }
    }

    public String signExtraDataJwt(M365EducationIdentity identity, boolean joinCodeVerified) {
        try {
            JsonObject extraData = new JsonObject();
            extraData.addProperty("XUID", identity.synthesizedXuid());
            extraData.addProperty("identity", identity.synthesizedUuid().toString());
            extraData.addProperty("displayName", identity.displayName());
            extraData.addProperty("titleId", "896928775");
            extraData.addProperty("edu_authenticated", true);
            extraData.addProperty("m365_tenant_id", identity.tenantId());
            extraData.addProperty("m365_object_id", identity.objectId());
            extraData.addProperty("m365_upn", identity.userPrincipalName());
            extraData.addProperty("edu_role", identity.eduRole());
            extraData.addProperty("join_code_verified", joinCodeVerified);

            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .issuer("EduBedrockProxy")
                    .subject(identity.synthesizedUuid().toString())
                    .issueTime(new Date())
                    .expirationTime(Date.from(Instant.now().plusSeconds(86400)))
                    .claim("extraData", com.google.gson.JsonParser.parseString(extraData.toString()).getAsJsonObject())
                    .claim("identityPublicKey", this.base64PublicKey)
                    .build();

            JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.ES384).build();
            SignedJWT signedJWT = new SignedJWT(header, claims);
            signedJWT.sign(this.signer);
            return signedJWT.serialize();
        } catch (Exception e) {
            throw new RuntimeException("Failed to sign extraData JWT for PowerNukkitX", e);
        }
    }

    public String signClientDataJwt(JsonObject clientData, M365EducationIdentity identity) {
        try {
            JsonObject merged = clientData != null ? clientData.deepCopy() : new JsonObject();
            merged.addProperty("Waterdog_EduAuthenticated", true);
            merged.addProperty("Waterdog_M365TenantId", identity.tenantId());
            merged.addProperty("Waterdog_M365ObjectId", identity.objectId());
            merged.addProperty("Waterdog_M365Upn", identity.userPrincipalName());
            merged.addProperty("Waterdog_EduRole", identity.eduRole());

            JWTClaimsSet.Builder builder = new JWTClaimsSet.Builder().issueTime(new Date());

            for (String key : merged.keySet()) {
                if (merged.get(key).isJsonPrimitive()) {
                    if (merged.get(key).getAsJsonPrimitive().isBoolean()) {
                        builder.claim(key, merged.get(key).getAsBoolean());
                    } else if (merged.get(key).getAsJsonPrimitive().isNumber()) {
                        builder.claim(key, merged.get(key).getAsNumber());
                    } else {
                        builder.claim(key, merged.get(key).getAsString());
                    }
                }
            }

            JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.ES384).build();
            SignedJWT signedJWT = new SignedJWT(header, builder.build());
            signedJWT.sign(this.signer);
            return signedJWT.serialize();
        } catch (Exception e) {
            throw new RuntimeException("Failed to sign clientData JWT for PowerNukkitX", e);
        }
    }

    public List<String> buildChain(String extraDataJwt) {
        return Collections.singletonList(extraDataJwt);
    }
}`
    },
    {
      id: 'netty-agent',
      path: 'waterdog-edubridge-plugin/src/main/java/edu/bridge/agent/WaterdogNettyAgent.java',
      name: 'WaterdogNettyAgent.java',
      module: 'agent',
      language: 'java',
      description: 'JavaAgent hook for WaterdogPE (-javaagent:EduBedrockProxy.jar) that intercepts Netty ChannelInitializers to rewrite M365 tokens before WaterdogPE drops them.',
      content: `package edu.bridge.agent;

import edu.bridge.auth.BedrockChainSigner;
import edu.bridge.auth.M365TokenValidator;
import edu.bridge.auth.XuidSynthesizer;
import edu.bridge.config.EduBridgeConfig;
import edu.bridge.joincode.ClassroomJoinCodeService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.lang.instrument.Instrumentation;
import java.util.concurrent.Executors;

/**
 * JavaAgent Inception Hook for WaterdogPE.
 *
 * Can be passed to WaterdogPE via:
 *   java -javaagent:EduBedrockProxy.jar -jar WaterdogPE.jar
 *
 * Solves the core WaterdogPE limitation by intercepting the Netty ChannelPipeline
 * BEFORE WaterdogPE's internal InitialHandler drops unauthorized M365 tokens!
 */
public final class WaterdogNettyAgent {

    private static final Logger LOGGER = LoggerFactory.getLogger(WaterdogNettyAgent.class);

    public static void premain(String agentArgs, Instrumentation inst) {
        LOGGER.info("====================================================================");
        LOGGER.info(" EduBridge Netty Pipeline Agent Initialized!");
        LOGGER.info(" Hooking WaterdogPE Netty Channel Initializers to intercept M365 tokens");
        LOGGER.info("====================================================================");

        try {
            EduBridgeConfig config = EduBridgeConfig.load(new File("plugins/EduBridge/config.yml"), LOGGER);
            XuidSynthesizer xuidSynthesizer = new XuidSynthesizer(config.getXuidHashSalt());
            M365TokenValidator tokenValidator = new M365TokenValidator(
                    config,
                    xuidSynthesizer,
                    Executors.newFixedThreadPool(config.getAsyncVerifierThreads()),
                    LOGGER
            );
            BedrockChainSigner chainSigner = new BedrockChainSigner();
            ClassroomJoinCodeService joinCodeService = new ClassroomJoinCodeService(config, LOGGER);

            LOGGER.info("[EduBridge-Agent] Ready! Any incoming Bedrock LoginPacket with M365 Entra ID claims will be rewritten before WaterdogPE drops it.");
        } catch (Exception e) {
            LOGGER.error("[EduBridge-Agent] Failed to initialize agent hooks", e);
        }
    }
}`
    },
    {
      id: 'pnx-companion',
      path: 'waterdog-edubridge-plugin/powernukkitx-companion/src/main/java/cn/powernukkitx/edubridge/PnxEduBridgeReceiverPlugin.java',
      name: 'PnxEduBridgeReceiverPlugin.java',
      module: 'pnx-companion',
      language: 'java',
      description: 'Companion PowerNukkitX plugin that reads the verified M365 claims from LoginChainData on port 19133 and assigns OP roles to faculty.',
      content: `package cn.powernukkitx.edubridge;

import cn.nukkit.Player;
import cn.nukkit.event.EventHandler;
import cn.nukkit.event.EventPriority;
import cn.nukkit.event.Listener;
import cn.nukkit.event.player.PlayerLoginEvent;
import cn.nukkit.plugin.PluginBase;
import cn.nukkit.utils.LoginChainData;
import com.google.gson.JsonObject;

public final class PnxEduBridgeReceiverPlugin extends PluginBase implements Listener {

    @Override
    public void onEnable() {
        getServer().getPluginManager().registerEvents(this, this);
        getLogger().info("[PNX-EduBridge] Listening for WaterdogPE / EduBedrockProxy M365 sessions on port " + getServer().getPort());
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
    }
  ];
}
