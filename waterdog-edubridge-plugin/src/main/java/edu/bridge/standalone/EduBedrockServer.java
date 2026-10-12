package edu.bridge.standalone;

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

/**
 * Netty UDP/Bedrock Server Engine.
 * Binds to 0.0.0.0:19132 and accepts connections from Minecraft Education Edition clients.
 */
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
}
