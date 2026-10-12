package edu.waterdog.bridge.handler;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import dev.waterdog.waterdogpe.player.ProxiedPlayer;
import edu.waterdog.bridge.config.EduBridgeConfig;
import org.apache.logging.log4j.Logger;
import org.cloudburstmc.protocol.bedrock.packet.ModalFormRequestPacket;
import org.cloudburstmc.protocol.bedrock.packet.ModalFormResponsePacket;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * Classroom Join Code Gatekeeper (Replaces EduGeyser Join Code feature natively in WaterdogPE).
 *
 * Supports both:
 * 1. Pre-populated Join Code inside `clientData` ("JoinCode" / "ClassroomCode") during LoginPacket.
 * 2. Interactive Bedrock `ModalFormRequestPacket` challenge before allowing commands/movement or
 *    transferring to secondary classroom worlds on PowerNukkitX.
 */
public final class EduJoinCodeGatekeeper {

    public static final int JOIN_CODE_FORM_ID = 19133;

    private final EduBridgeConfig config;
    private final Logger logger;
    private final Cache<UUID, Boolean> verifiedJoinCodeSessions;

    public EduJoinCodeGatekeeper(EduBridgeConfig config, Logger logger) {
        this.config = config;
        this.logger = logger;
        this.verifiedJoinCodeSessions = Caffeine.newBuilder()
                .maximumSize(512)
                .expireAfterWrite(config.getSessionTtlMinutes(), TimeUnit.MINUTES)
                .build();
    }

    public boolean isVerified(UUID playerUuid) {
        if (!config.isJoinCodeEnabled()) {
            return true;
        }
        return Boolean.TRUE.equals(verifiedJoinCodeSessions.getIfPresent(playerUuid));
    }

    public void markVerified(UUID playerUuid) {
        verifiedJoinCodeSessions.put(playerUuid, Boolean.TRUE);
    }

    public boolean verifyCodeInput(UUID playerUuid, String submittedCode) {
        if (!config.isJoinCodeEnabled()) {
            return true;
        }
        if (submittedCode == null) {
            return false;
        }
        String normalizedSubmitted = normalizeJoinCode(submittedCode);
        String normalizedExpected = normalizeJoinCode(config.getActiveJoinCode());

        if (normalizedExpected.equals(normalizedSubmitted)) {
            markVerified(playerUuid);
            return true;
        }
        return false;
    }

    /**
     * Sends a native Bedrock Custom Form (`ModalFormRequestPacket`) prompting the student
     * to enter the teacher's 4-word classroom Join Code (e.g. BOOK-APPLE-PANDA-RAIL).
     */
    public void sendJoinCodeChallengeForm(ProxiedPlayer player) {
        JsonObject form = new JsonObject();
        form.addProperty("type", "custom_form");
        form.addProperty("title", config.getPromptTitle());

        JsonArray content = new JsonArray();

        JsonObject label = new JsonObject();
        label.addProperty("type", "label");
        label.addProperty("text", config.getPromptSubtitle());
        content.add(label);

        JsonObject input = new JsonObject();
        input.addProperty("type", "input");
        input.addProperty("text", "Classroom Join Code");
        input.addProperty("placeholder", "e.g. BOOK-APPLE-PANDA-RAIL");
        input.addProperty("default", "");
        content.add(input);

        form.add("content", content);

        ModalFormRequestPacket packet = new ModalFormRequestPacket();
        packet.setFormId(JOIN_CODE_FORM_ID);
        packet.setFormData(form.toString());

        player.sendPacket(packet);
    }

    /**
     * Processes the student's `ModalFormResponsePacket` for form ID 19133.
     */
    public boolean handleModalResponse(ProxiedPlayer player, ModalFormResponsePacket packet) {
        if (packet.getFormId() != JOIN_CODE_FORM_ID) {
            return false;
        }

        String formData = packet.getFormData();
        if (formData == null || formData.isBlank() || "null".equals(formData.trim())) {
            player.disconnect("§cClassroom Join Code is required to join this server.");
            return true;
        }

        try {
            JsonArray responses = JsonParser.parseString(formData).getAsJsonArray();
            // Index 0 is the label, Index 1 is the text input
            String enteredCode = responses.size() > 1 && !responses.get(1).isJsonNull()
                    ? responses.get(1).getAsString()
                    : "";

            if (verifyCodeInput(player.getUniqueId(), enteredCode)) {
                logger.info("[EduBridge] Student " + player.getName() + " passed Classroom Join Code challenge.");
                player.sendMessage("§a[EduBridge] Classroom Join Code verified! Connected to PowerNukkitX.");
            } else {
                logger.warn("[EduBridge] Student " + player.getName() + " entered invalid Join Code: " + enteredCode);
                player.disconnect("§cInvalid Classroom Join Code.\n§7Please check the code on your teacher's board and try again.");
            }
        } catch (Exception e) {
            player.disconnect("§cFailed to verify Classroom Join Code response.");
        }
        return true;
    }

    private static String normalizeJoinCode(String raw) {
        return raw.trim().toUpperCase().replaceAll("[\\s_]+", "-");
    }
}
