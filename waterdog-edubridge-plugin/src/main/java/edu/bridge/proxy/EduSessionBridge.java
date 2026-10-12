package edu.bridge.proxy;

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
import io.netty.buffer.Unpooled;
import io.netty.channel.*;
import io.netty.channel.socket.DatagramChannel;
import io.netty.channel.socket.nio.NioDatagramChannel;
import org.slf4j.Logger;

import java.net.InetSocketAddress;
import java.util.Optional;

/**
 * Manages an active player session: receives Bedrock packets from the Education Edition client,
 * validates the M365 authentication chain and classroom join code, re-signs the extraData JWT,
 * connects to PowerNukkitX (port 19133), and proxies all gameplay packets bidirectionally.
 */
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
            // Forward gameplay packets directly to PowerNukkitX backend
            if (backendChannel != null && backendChannel.isActive()) {
                backendChannel.writeAndFlush(msg.retain());
            }
        }
    }

    private void handleInitialPacket(ChannelHandlerContext ctx, ByteBuf msg) {
        int readerIndex = msg.readerIndex();
        int packetId = EduLoginPacket.readVarInt(msg);

        if (packetId != 0x01) { // Not LoginPacket
            msg.readerIndex(readerIndex);
            if (backendChannel != null && backendChannel.isActive()) {
                backendChannel.writeAndFlush(msg.retain());
            }
            return;
        }

        logger.info("[EduBridge] Intercepted Bedrock LoginPacket (0x01) from Education Edition client");
        EduLoginPacket loginPacket = EduLoginPacket.decode(msg);

        // 1. Extract M365 JWT token candidate from the chain or clientData
        String candidateM365Jwt = null;
        for (String jwt : loginPacket.getChain()) {
            if (jwt != null && jwt.split("\\.").length == 3) {
                candidateM365Jwt = jwt;
                break;
            }
        }

        if (candidateM365Jwt == null && loginPacket.getClientDataJson().has("M365Token")) {
            candidateM365Jwt = loginPacket.getClientDataJson().get("M365Token").getAsString();
        }

        // 2. Validate M365 Token against Entra ID / Microsoft OpenID JWKS
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
            disconnectClient(ctx, "§cMicrosoft 365 School Authentication Failed.\n§7Please log in with an authorized school tenant account.");
            return;
        }

        this.identity = verifiedOpt.get();

        // 3. Validate Classroom Join Code
        JsonObject clientData = loginPacket.getClientDataJson();
        String submittedJoinCode = clientData.has("JoinCode") ? clientData.get("JoinCode").getAsString() : null;
        boolean joinCodeOk = identity.isTeacher() || joinCodeService.verifyCodeInput(identity.synthesizedUuid(), submittedJoinCode);

        if (!joinCodeOk && config.isJoinCodeEnabled()) {
            logger.warn("[EduBridge] Student {} failed Classroom Join Code check (Submitted: {})", identity.displayName(), submittedJoinCode);
            disconnectClient(ctx, "§cClassroom Join Code Required.\n§7Please enter the active code set by your teacher: " + config.getActiveJoinCode());
            return;
        }

        // 4. Re-sign extraData & clientData with proxy KeyPair for PowerNukkitX (:19133)
        String signedExtraJwt = chainSigner.signExtraDataJwt(identity, joinCodeOk);
        String signedClientJwt = chainSigner.signClientDataJwt(clientData, identity);

        ByteBuf rewrittenLoginPacket = ctx.alloc().buffer();
        EduLoginPacket.writeVarInt(rewrittenLoginPacket, 0x01); // LoginPacket ID
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
                                // Relay downstream PowerNukkitX packets back to Education client
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
}
