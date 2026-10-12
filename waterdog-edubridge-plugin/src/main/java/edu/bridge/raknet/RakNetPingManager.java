package edu.bridge.raknet;

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

/**
 * Manages RakNet Unconnected Ping (0x01) and Unconnected Pong (0x1c) packets.
 *
 * Automatically keeps Minecraft Bedrock / Education Edition clients updated with
 * server status, latency, MOTD, player count, and version info, completely solving
 * the "World does not exist" / red dot offline error.
 */
public final class RakNetPingManager {

    private static final Logger LOGGER = LoggerFactory.getLogger(RakNetPingManager.class);

    private final EduBridgeConfig config;
    private final InetSocketAddress downstreamAddress;

    // Backend server status polled dynamically from PowerNukkitX (:19133)
    private final AtomicReference<String> backendVersionName = new AtomicReference<>("1.26.50");
    private final AtomicInteger backendProtocolVersion = new AtomicInteger(686);
    private final AtomicInteger onlinePlayerCount = new AtomicInteger(0);
    private final AtomicInteger maxPlayerCount = new AtomicInteger(40);

    public RakNetPingManager(EduBridgeConfig config, ScheduledExecutorService scheduler) {
        this.config = config;
        this.downstreamAddress = new InetSocketAddress(config.getDownstreamHost(), config.getDownstreamPort());

        // Periodically poll PowerNukkitX on 127.0.0.1:19133 to mirror live player count & protocol version
        scheduler.scheduleAtFixedRate(this::pollDownstreamServer, 1, 3, TimeUnit.SECONDS);
    }

    /**
     * Handles an incoming Unconnected Ping from a Minecraft client and sends back an Unconnected Pong.
     */
    public void handleClientPing(Channel channel, DatagramPacket packet) {
        ByteBuf in = packet.content();
        InetSocketAddress sender = packet.sender();

        byte packetId = in.readByte(); // 0x01 or 0x02
        long pingTime = in.readLong();

        if (!RakNetConstants.matchMagic(in, in.readerIndex())) {
            return;
        }
        in.skipBytes(RakNetConstants.RAKNET_MAGIC.length);
        long clientGuid = in.readableBytes() >= 8 ? in.readLong() : 0L;

        // Build Bedrock Pong String:
        // MCPE;ServerName;ProtocolVersion;VersionName;PlayerCount;MaxPlayers;ServerGuid;SubMotd;GameMode;GameModeNumeric;PortIpv4;PortIpv6;
        String motd = buildMotdString();
        byte[] motdBytes = motd.getBytes(StandardCharsets.UTF_8);

        ByteBuf pongBuf = Unpooled.buffer(35 + motdBytes.length);
        pongBuf.writeByte(RakNetConstants.ID_UNCONNECTED_PONG);
        pongBuf.writeLong(pingTime); // Echo client timestamp
        pongBuf.writeLong(RakNetConstants.SERVER_GUID);
        pongBuf.writeBytes(RakNetConstants.RAKNET_MAGIC);
        pongBuf.writeShort(motdBytes.length);
        pongBuf.writeBytes(motdBytes);

        channel.writeAndFlush(new DatagramPacket(pongBuf, sender));
        LOGGER.debug("[EduBridge] Replied to RakNet Unconnected Ping from {} (PingTime: {})", sender, pingTime);
    }

    /**
     * Parses an incoming Unconnected Pong reply from PowerNukkitX to update our cached server info.
     */
    public void handleDownstreamPong(ByteBuf in) {
        try {
            in.readByte(); // 0x1c
            in.readLong(); // pingTime
            in.readLong(); // serverGuid
            in.skipBytes(RakNetConstants.RAKNET_MAGIC.length);
            int strLen = in.readUnsignedShort();
            byte[] bytes = new byte[Math.min(strLen, in.readableBytes())];
            in.readBytes(bytes);
            String motdStr = new String(bytes, StandardCharsets.UTF_8);

            String[] tokens = motdStr.split(";");
            if (tokens.length >= 6) {
                // tokens[2] = protocolVersion, tokens[3] = versionName, tokens[4] = online, tokens[5] = max
                try {
                    int protocol = Integer.parseInt(tokens[2]);
                    backendProtocolVersion.set(protocol);
                } catch (Exception ignored) {}

                backendVersionName.set(tokens[3]);

                try {
                    onlinePlayerCount.set(Integer.parseInt(tokens[4]));
                    maxPlayerCount.set(Integer.parseInt(tokens[5]));
                } catch (Exception ignored) {}

                LOGGER.debug("[EduBridge] Updated from PowerNukkitX: Protocol={}, Version={}, Players={}/{}",
                        backendProtocolVersion.get(), backendVersionName.get(), onlinePlayerCount.get(), maxPlayerCount.get());
            }
        } catch (Exception e) {
            LOGGER.debug("[EduBridge] Failed to parse PowerNukkitX pong: {}", e.getMessage());
        }
    }

    /**
     * Formats the official Bedrock server advertisement string.
     */
    public String buildMotdString() {
        return String.format(
                "MCPE;§bOakridge School §7[§aM365 Edu§7];%d;%s;%d;%d;%d;§fClassroom Server;Survival;1;%d;%d;",
                backendProtocolVersion.get(),
                backendVersionName.get(),
                onlinePlayerCount.get(),
                maxPlayerCount.get(),
                RakNetConstants.SERVER_GUID,
                config.getBindPort(),
                config.getDownstreamPort()
        );
    }

    private void pollDownstreamServer() {
        try {
            // PowerNukkitX is local on 127.0.0.1:19133
            java.net.DatagramSocket socket = new java.net.DatagramSocket();
            socket.setSoTimeout(1000);

            ByteBuf ping = Unpooled.buffer(33);
            ping.writeByte(RakNetConstants.ID_UNCONNECTED_PING);
            ping.writeLong(System.currentTimeMillis());
            ping.writeBytes(RakNetConstants.RAKNET_MAGIC);
            ping.writeLong(RakNetConstants.SERVER_GUID);

            byte[] sendData = new byte[ping.readableBytes()];
            ping.readBytes(sendData);
            ping.release();

            java.net.DatagramPacket sendPacket = new java.net.DatagramPacket(
                    sendData, sendData.length, downstreamAddress.getAddress(), downstreamAddress.getPort()
            );
            socket.send(sendPacket);

            byte[] recvData = new byte[2048];
            java.net.DatagramPacket recvPacket = new java.net.DatagramPacket(recvData, recvData.length);
            socket.receive(recvPacket);

            ByteBuf pong = Unpooled.wrappedBuffer(recvPacket.getData(), 0, recvPacket.getLength());
            if (pong.readableBytes() > 0 && pong.getByte(0) == RakNetConstants.ID_UNCONNECTED_PONG) {
                handleDownstreamPong(pong);
            }
            pong.release();
            socket.close();
        } catch (Exception ignored) {
            // PowerNukkitX may still be starting up
        }
    }
}
