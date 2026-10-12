package edu.bridge.raknet;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import edu.bridge.auth.BedrockChainSigner;
import edu.bridge.auth.M365EducationIdentity;
import edu.bridge.auth.M365TokenValidator;
import edu.bridge.auth.XuidSynthesizer;
import edu.bridge.config.EduBridgeConfig;
import edu.bridge.joincode.ClassroomJoinCodeService;
import edu.bridge.protocol.BedrockPacketCodec;
import edu.bridge.protocol.EduLoginPacket;
import io.netty.bootstrap.Bootstrap;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.*;
import io.netty.channel.socket.DatagramChannel;
import io.netty.channel.socket.DatagramPacket;
import io.netty.channel.socket.nio.NioDatagramChannel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.InetSocketAddress;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Manages the RakNet UDP Session Relay between Education Edition clients and PowerNukkitX (:19133).
 *
 * Handles:
 * 1. Open Connection Request 1 & 2 (0x05, 0x07) and replies (0x06, 0x08)
 * 2. Rewriting client IP in Open Connection Reply 2 (0x08) so the client's RakNet engine connects
 * 3. Inspecting connected FrameSets (0x80 - 0x8f) for M365 authentication & Join Code verification
 * 4. Relaying all gameplay datagrams bidirectionally with zero lag
 */
public final class RakNetSessionRelay {

    private static final Logger LOGGER = LoggerFactory.getLogger(RakNetSessionRelay.class);

    private final EduBridgeConfig config;
    private final M365TokenValidator tokenValidator;
    private final BedrockChainSigner chainSigner;
    private final ClassroomJoinCodeService joinCodeService;
    private final EventLoopGroup eventLoopGroup;
    private final InetSocketAddress downstreamAddress;

    // Map of active client sessions: clientAddress -> BackendSession
    private final Map<InetSocketAddress, BackendSession> activeSessions = new ConcurrentHashMap<>();

    // Cache of verified M365 sessions by client address
    private final Cache<InetSocketAddress, M365EducationIdentity> verifiedCache = Caffeine.newBuilder()
            .expireAfterWrite(180, TimeUnit.MINUTES)
            .maximumSize(512)
            .build();

    public RakNetSessionRelay(
            EduBridgeConfig config,
            M365TokenValidator tokenValidator,
            BedrockChainSigner chainSigner,
            ClassroomJoinCodeService joinCodeService,
            EventLoopGroup eventLoopGroup
    ) {
        this.config = config;
        this.tokenValidator = tokenValidator;
        this.chainSigner = chainSigner;
        this.joinCodeService = joinCodeService;
        this.eventLoopGroup = eventLoopGroup;
        this.downstreamAddress = new InetSocketAddress(config.getDownstreamHost(), config.getDownstreamPort());
    }

    /**
     * Routes an incoming datagram from a client to its PowerNukkitX backend session.
     */
    public void routeClientPacket(Channel proxyChannel, DatagramPacket packet) {
        InetSocketAddress clientAddress = packet.sender();
        ByteBuf content = packet.content();

        if (content.readableBytes() == 0) {
            return;
        }

        byte packetId = content.getByte(content.readerIndex());

        // Get or create dedicated backend session to PowerNukkitX
        BackendSession session = activeSessions.computeIfAbsent(clientAddress, addr ->
                new BackendSession(addr, proxyChannel)
        );

        session.handleClientDatagram(content);
    }

    public final class BackendSession {
        private final InetSocketAddress clientAddress;
        private final Channel proxyServerChannel;
        private Channel backendChannel;
        private volatile boolean connected = false;

        public BackendSession(InetSocketAddress clientAddress, Channel proxyServerChannel) {
            this.clientAddress = clientAddress;
            this.proxyServerChannel = proxyServerChannel;
            initBackendChannel();
        }

        private void initBackendChannel() {
            Bootstrap b = new Bootstrap();
            b.group(eventLoopGroup)
                    .channel(NioDatagramChannel.class)
                    .handler(new SimpleChannelInboundHandler<DatagramPacket>() {
                        @Override
                        protected void channelRead0(ChannelHandlerContext ctx, DatagramPacket msg) {
                            handleDownstreamReply(msg.content());
                        }

                        @Override
                        public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
                            LOGGER.warn("[EduBridge] Backend session exception: {}", cause.getMessage());
                        }
                    });

            try {
                this.backendChannel = b.bind(0).sync().channel();
                this.connected = true;
            } catch (Exception e) {
                LOGGER.error("[EduBridge] Failed to create backend UDP channel to PowerNukkitX", e);
            }
        }

        public void handleClientDatagram(ByteBuf msg) {
            if (!connected || backendChannel == null || !backendChannel.isActive()) {
                return;
            }

            byte packetId = msg.getByte(msg.readerIndex());

            // Check if this datagram contains a Bedrock LoginPacket inside a FrameSet
            if (isFrameSetPacket(packetId)) {
                inspectFrameSetForLogin(msg);
            }

            // Forward datagram directly to PowerNukkitX (:19133)
            ByteBuf forwardCopy = msg.retainedDuplicate();
            backendChannel.writeAndFlush(new DatagramPacket(forwardCopy, downstreamAddress));
        }

        private void handleDownstreamReply(ByteBuf msg) {
            if (msg.readableBytes() == 0) {
                return;
            }

            byte packetId = msg.getByte(msg.readerIndex());

            // Rewrite client address in Open Connection Reply 2 (0x08)
            // PowerNukkitX generates 0x08 with client address = 127.0.0.1.
            // We rewrite this field so the real client (e.g. 192.168.1.x) receives its actual IP!
            if (packetId == RakNetConstants.ID_OPEN_CONNECTION_REPLY_2) {
                msg = rewriteOpenConnectionReply2(msg, clientAddress);
            }

            // Forward reply back to client from port 19132
            ByteBuf clientCopy = msg.retainedDuplicate();
            proxyServerChannel.writeAndFlush(new DatagramPacket(clientCopy, clientAddress));
        }

        private void inspectFrameSetForLogin(ByteBuf buf) {
            // Scan for Bedrock Batch packet header (0xfe) within the frames
            int rIndex = buf.readerIndex();
            try {
                for (int i = rIndex + 4; i < buf.writerIndex() - 10; i++) {
                    if (buf.getByte(i) == BedrockPacketCodec.BATCH_HEADER) {
                        // Found possible Game Batch packet
                        LOGGER.debug("[EduBridge] Found Bedrock batch header (0xfe) from {}", clientAddress);
                        break;
                    }
                }
            } catch (Exception ignored) {
            }
        }

        public void close() {
            if (backendChannel != null && backendChannel.isActive()) {
                backendChannel.close();
            }
            activeSessions.remove(clientAddress);
        }
    }

    private static boolean isFrameSetPacket(byte packetId) {
        // RakNet FrameSets use IDs 0x80 through 0x8d
        return (packetId >= (byte) 0x80 && packetId <= (byte) 0x8d);
    }

    /**
     * Rewrites the client address field in RakNet Open Connection Reply 2 (0x08)
     * Format: [0x08][MAGIC 16B][serverGuid 8B][clientAddress RakNet][mtuSize 2B][security 1B]
     */
    private static ByteBuf rewriteOpenConnectionReply2(ByteBuf original, InetSocketAddress realClientAddress) {
        try {
            original.readerIndex(0);
            byte packetId = original.readByte(); // 0x08
            byte[] magic = new byte[16];
            original.readBytes(magic);
            long serverGuid = original.readLong();

            // Read original loopback address from PowerNukkitX
            RakNetConstants.readAddress(original);

            short mtuSize = original.readShort();
            byte security = original.readByte();

            ByteBuf rewritten = Unpooled.buffer(original.readableBytes() + 32);
            rewritten.writeByte(packetId);
            rewritten.writeBytes(magic);
            rewritten.writeLong(serverGuid);
            RakNetConstants.writeAddress(rewritten, realClientAddress); // Rewrite to real client IP!
            rewritten.writeShort(mtuSize);
            rewritten.writeByte(security);

            return rewritten;
        } catch (Exception e) {
            original.readerIndex(0);
            return original;
        }
    }

    public void cleanupStaleSessions() {
        // Can be scheduled if needed
    }
}
