package edu.waterdog.bridge.auth;

import java.util.UUID;

/**
 * Immutable record representing a verified Microsoft 365 Education Edition session.
 * These claims are injected into WaterdogPE's extraData JsonObject and re-signed
 * for downstream verification on PowerNukkitX (port 19133).
 */
public record M365EducationIdentity(
        String tenantId,
        String objectId,
        String userPrincipalName,
        String displayName,
        String synthesizedXuid,
        UUID synthesizedUuid,
        String eduRole,
        String clientEdition,
        long tokenExpiresAtEpochSeconds
) {
    public boolean isTeacher() {
        return "teacher".equalsIgnoreCase(eduRole) || "faculty".equalsIgnoreCase(eduRole);
    }
}
