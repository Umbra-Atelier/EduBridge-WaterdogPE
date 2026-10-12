package edu.bridge.auth;

import java.util.UUID;

/**
 * Immutable representation of a verified Microsoft 365 Education Edition identity.
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
