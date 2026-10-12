package edu.bridge.raknet;

import io.netty.buffer.ByteBuf;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;

/**
 * Core RakNet Protocol Constants and Utility Methods for Minecraft: Bedrock Edition.
 */
public final class RakNetConstants {

    private RakNetConstants() {}

    // RakNet Magic (16 bytes) used in offline/handshake packets
    public static final byte[] RAKNET_MAGIC = new byte[]{
            (byte) 0x00, (byte) 0xff, (byte) 0xff, (byte) 0x00,
            (byte) 0xfe, (byte) 0xfe, (byte) 0xfe, (byte) 0xfe,
            (byte) 0xfd, (byte) 0xfd, (byte) 0xfd, (byte) 0xfd,
            (byte) 0x12, (byte) 0x34, (byte) 0x56, (byte) 0x78
    };

    // RakNet Packet IDs
    public static final byte ID_UNCONNECTED_PING = (byte) 0x01;
    public static final byte ID_UNCONNECTED_PING_OPEN_CONNECTIONS = (byte) 0x02;
    public static final byte ID_UNCONNECTED_PONG = (byte) 0x1c;

    public static final byte ID_OPEN_CONNECTION_REQUEST_1 = (byte) 0x05;
    public static final byte ID_OPEN_CONNECTION_REPLY_1 = (byte) 0x06;
    public static final byte ID_OPEN_CONNECTION_REQUEST_2 = (byte) 0x07;
    public static final byte ID_OPEN_CONNECTION_REPLY_2 = (byte) 0x08;

    public static final byte ID_CONNECTION_REQUEST = (byte) 0x09;
    public static final byte ID_CONNECTION_REQUEST_ACCEPTED = (byte) 0x10;
    public static final byte ID_NEW_INCOMING_CONNECTION = (byte) 0x13;
    public static final byte ID_DISCONNECT = (byte) 0x15;

    public static final byte ID_ACK = (byte) 0xc0;
    public static final byte ID_NACK = (byte) 0xa0;

    public static final int RAKNET_PROTOCOL_VERSION = 11;
    public static final long SERVER_GUID = 2747994725500000000L;

    /**
     * Checks if the buffer contains the RakNet Magic at the given index.
     */
    public static boolean matchMagic(ByteBuf buf, int index) {
        if (buf.readableBytes() < index + RAKNET_MAGIC.length) {
            return false;
        }
        for (int i = 0; i < RAKNET_MAGIC.length; i++) {
            if (buf.getByte(index + i) != RAKNET_MAGIC[i]) {
                return false;
            }
        }
        return true;
    }

    /**
     * Writes an IPv4 or IPv6 address in RakNet inverted-byte wire format.
     */
    public static void writeAddress(ByteBuf buf, InetSocketAddress address) {
        InetAddress addr = address.getAddress();
        if (addr instanceof Inet4Address) {
            buf.writeByte(4); // IPv4 version byte
            byte[] ip = addr.getAddress();
            for (byte b : ip) {
                buf.writeByte((~b) & 0xFF);
            }
            buf.writeShort(address.getPort());
        } else {
            buf.writeByte(6); // IPv6 version byte
            buf.writeShort(23); // AF_INET6 family
            buf.writeShort(address.getPort());
            buf.writeInt(0); // Flow info
            byte[] ip = addr.getAddress();
            buf.writeBytes(ip);
            buf.writeInt(0); // Scope ID
        }
    }

    /**
     * Reads a RakNet address from the buffer.
     */
    public static InetSocketAddress readAddress(ByteBuf buf) {
        byte version = buf.readByte();
        if (version == 4) {
            byte[] ip = new byte[4];
            for (int i = 0; i < 4; i++) {
                ip[i] = (byte) ((~buf.readByte()) & 0xFF);
            }
            int port = buf.readUnsignedShort();
            try {
                return new InetSocketAddress(InetAddress.getByAddress(ip), port);
            } catch (Exception e) {
                return new InetSocketAddress("127.0.0.1", port);
            }
        } else {
            buf.skipBytes(2); // Family
            int port = buf.readUnsignedShort();
            buf.skipBytes(4); // Flow info
            byte[] ip = new byte[16];
            buf.readBytes(ip);
            buf.skipBytes(4); // Scope ID
            try {
                return new InetSocketAddress(InetAddress.getByAddress(ip), port);
            } catch (Exception e) {
                return new InetSocketAddress("::1", port);
            }
        }
    }
}
