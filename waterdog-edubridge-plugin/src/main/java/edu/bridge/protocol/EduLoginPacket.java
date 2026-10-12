package edu.bridge.protocol;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import io.netty.buffer.ByteBuf;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/**
 * Dedicated Bedrock LoginPacket (0x01) decoder and encoder.
 *
 * Extracts the Microsoft 365 Entra ID / Education Edition certificate chain and
 * ClientData JSON, and allows rewriting the packet with a proxy-signed chain
 * for PowerNukkitX.
 */
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

        // Read VarInt length of payload string/bytes
        int payloadLength = readVarInt(in);
        byte[] payloadBytes = new byte[payloadLength];
        in.readBytes(payloadBytes);

        ByteBuf payloadBuf = io.netty.buffer.Unpooled.wrappedBuffer(payloadBytes);
        try {
            // Bedrock Login payload has 2 Little-Endian Int lengths:
            // 1) chainData byte length
            // 2) skinData byte length
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
                        // Parse JWT payload (part 2)
                        String[] parts = jwt.split("\\.");
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
                String[] skinParts = skinJwtStr.split("\\.");
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
}
