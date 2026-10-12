package edu.waterdog.bridge.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;

/**
 * Synthesizes a deterministic 16-digit numeric Xbox Live XUID and UUIDv5
 * from a Microsoft 365 Entra ID (Azure AD) Object ID ('oid') and Tenant ID ('tid').
 *
 * Why this is critical for PowerNukkitX:
 * Standard Education Edition M365 logins lack a retail Xbox Live Gamertag XUID or
 * provide a tenant-scoped subject identifier. PowerNukkitX relies on a consistent
 * 64-bit unsigned numeric string XUID and UUID to persist player inventories and
 * permissions without collisions.
 */
public final class XuidSynthesizer {

    private final String salt;

    public XuidSynthesizer(String salt) {
        this.salt = salt != null ? salt : "edubridge-default-salt";
    }

    /**
     * Generates a deterministic 16-digit numeric XUID starting with '29' (Education range)
     * from the M365 Tenant ID and User Object ID.
     */
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

    /**
     * Generates a deterministic offline-safe UUIDv3/v5 from the M365 identity.
     */
    public UUID deriveEducationUuid(String tenantId, String objectId) {
        String seed = "urn:m365:mc-edu:" + tenantId.toLowerCase() + ":" + objectId.toLowerCase();
        return UUID.nameUUIDFromBytes(seed.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Sanitizes an M365 displayName or UPN prefix into a valid Bedrock username (max 16 chars).
     */
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
