package edu.bridge.standalone;

import edu.bridge.auth.BedrockChainSigner;
import edu.bridge.auth.M365TokenValidator;
import edu.bridge.auth.XuidSynthesizer;
import edu.bridge.config.EduBridgeConfig;
import edu.bridge.joincode.ClassroomJoinCodeService;
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
 * Netty UDP / RakNet Server Engine.
 *
 * Binds to 0.0.0.0:19132 and responds to:
 * 1. RakNet Unconnected Pings (0x01, 0x02) -> Replies with 0x1c Pong, eliminating "World doesn't exist"
 * 2. RakNet Connection Handshakes (0x05, 0x07) -> Relays to PowerNukkitX (:19133) and rewrites 0x08 client address
 * 3. Connected Game FrameSets -> Relays gameplay packets with M365 authentication
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

        this.scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "EduBridge-PingPoller");
            t.setDaemon(true);
            return t;
        });

        XuidSynthesizer xuidSynthesizer = new XuidSynthesizer(config.getXuidHashSalt());
        M365TokenValidator tokenValidator = new M365TokenValidator(config, xuidSynthesizer, this.authExecutor, LOGGER);
        BedrockChainSigner chainSigner = new BedrockChainSigner();
        ClassroomJoinCodeService joinCodeService = new ClassroomJoinCodeService(config, LOGGER);

        this.eventLoopGroup = new NioEventLoopGroup(workerThreads);

        this.pingManager = new RakNetPingManager(config, this.scheduler);
        this.sessionRelay = new RakNetSessionRelay(
                config,
                tokenValidator,
                chainSigner,
                joinCodeService,
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

        LOGGER.info("====================================================================");
        LOGGER.info(" EduBedrockProxy Active (with Full RakNet State Machine)!");
        LOGGER.info(" Listening on Bedrock Port: {}:{}", config.getBindHost(), config.getBindPort());
        LOGGER.info(" Forwarding to PowerNukkitX: {}:{}", config.getDownstreamHost(), config.getDownstreamPort());
        LOGGER.info(" RakNet Ping Response: ENABLED (Auto-syncs live MOTD from PowerNukkitX)");
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
        if (scheduler != null) {
            scheduler.shutdown();
        }
        if (authExecutor != null) {
            authExecutor.shutdown();
        }
        LOGGER.info("[EduBridge] Proxy stopped cleanly.");
    }
}
