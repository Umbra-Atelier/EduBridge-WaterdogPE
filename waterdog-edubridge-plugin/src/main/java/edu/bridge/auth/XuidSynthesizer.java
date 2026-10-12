package edu.bridge.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;

/**
 * Derives a deterministic 16-digit numeric Xbox Live XUID (29xxxxxxxxxxxxxx) and UUIDv3
 * from an M365 Entra ID (Azure AD) Object ID ('oid') and Tenant ID ('tid').
 *
 * Essential for PowerNukkitX because Bedrock servers key player savegames and inventories
 * on a persistent 64-bit unsigned numeric XUID string.
 */
public final class XuidSynthesizer {

    private final String salt;

    public XuidSynthesizer(String salt) {
        this.salt = salt != null ? salt : "edubridge-default-salt";
    }

    public String deriveEducationXuid(String tenantId, String objectId) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            String composite = this.salt + ":" + tenantId.toLowerCase() + ":" + objectId.toLowerCase();
            byte[] hash = digest.digest(composite.getBytes(StandardCharsets.UTF_8));

            long value = 0L;
            for (int i = 0; i < 7; i++) {
                value = (value << 8) | (hash[i] & 0xFFL);
            }
            long positive14Digits = Math.abs(value) % 100_000_000_000_000L;
            return String.format("29%014d", positive14Digits);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable on JVM", e);
        }
    }

    public UUID deriveEducationUuid(String tenantId, String objectId) {
        String seed = "urn:m365:mc-edu:" + tenantId.toLowerCase() + ":" + objectId.toLowerCase();
        return UUID.nameUUIDFromBytes(seed.getBytes(StandardCharsets.UTF_8));
    }

    public String sanitizeBedrockUsername(String displayName, String upn) {
        String candidate = (displayName != null && !displayName.isBlank())
                ? displayName
                : (upn != null && upn.contains("@") ? upn.substring(0, upn.indexOf('@')) : "EduStudent");

        String cleaned = candidate.replaceAll("[^A-Za-z0-9_]", "_");
        if (cleaned.length() > 16) {
            cleaned = cleaned.substring(0, 16);
        }
        return cleaned.isEmpty() ? "EduStudent" : cleaned;
    }
}
