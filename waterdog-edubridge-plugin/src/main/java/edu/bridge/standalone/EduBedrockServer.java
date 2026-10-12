package edu.bridge.standalone;

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
 * 1. Microsoft Education Discovery API (`discovery.minecrafteduservices.com`) 4-Picture Join Code registration
 * 2. Persistent 18-digit NetherNet Connection ID (`nethernet/connection-id.yml`) & WebSocket Signaling
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
        this.serverChannel = b.bind(bindAddress).sync().channel();

        String activePictureCode = this.joinCodeService.getActivePictureJoinCode();
        LOGGER.info("====================================================================");
        LOGGER.info(" EduBedrockProxy Active (RakNet + M:EE Session Broker + NetherNet)!");
        LOGGER.info(" Listening on Bedrock Port: {}:{} (External: {})",
                config.getBindHost(), config.getBindPort(), config.getExternalAddress());
        LOGGER.info(" Forwarding to PowerNukkitX: {}:{}", config.getDownstreamHost(), config.getDownstreamPort());
        LOGGER.info(" Persistent NetherNet Connection ID: {}", this.sessionBroker.getConnectionId());
        LOGGER.info(" Active 4-Picture Join Code: {} (Indices: {})",
                activePictureCode, EducationSessionBrokerService.symbolsToNumericPasscode(activePictureCode));
        LOGGER.info(" Share Link: {}", this.sessionBroker.buildShareLink(activePictureCode));
        LOGGER.info(" Allowed M365 Tenants: {}", config.getAllowedTenantIds());
        LOGGER.info(" Tip: Type 'edu joincode add' to link an M365 account via Device Code");
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
