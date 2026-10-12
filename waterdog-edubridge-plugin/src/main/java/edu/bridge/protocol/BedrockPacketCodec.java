package edu.bridge.protocol;

import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.ByteToMessageCodec;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.Deflater;
import java.util.zip.Inflater;

/**
 * Bedrock Game Packet Batch (0xfe) Deflate/Zlib encoder and decoder.
 */
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
        EduLoginPacket.writeVarInt(buf, 0x05); // DisconnectPacket
        EduLoginPacket.writeVarInt(buf, 0); // Hide disconnect screen?
        byte[] reasonBytes = reason.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        EduLoginPacket.writeVarInt(buf, reasonBytes.length);
        buf.writeBytes(reasonBytes);
        return buf;
    }
}
