package edu.bridge.joincode;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import edu.bridge.config.EduBridgeConfig;
import org.slf4j.Logger;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * Validates Classroom Join Codes (e.g. BOOK-APPLE-PANDA-RAIL)
 * that replace EduGeyser join code checking natively in the proxy.
 */
public final class ClassroomJoinCodeService {

    private final EduBridgeConfig config;
    private final Logger logger;
    private final Cache<UUID, Boolean> verifiedSessions;

    public ClassroomJoinCodeService(EduBridgeConfig config, Logger logger) {
        this.config = config;
        this.logger = logger;
        this.verifiedSessions = Caffeine.newBuilder()
                .maximumSize(512)
                .expireAfterWrite(config.getSessionTtlMinutes(), TimeUnit.MINUTES)
                .build();
    }

    public boolean isVerified(UUID playerUuid) {
        if (!config.isJoinCodeEnabled()) {
            return true;
        }
        return Boolean.TRUE.equals(verifiedSessions.getIfPresent(playerUuid));
    }

    public void markVerified(UUID playerUuid) {
        verifiedSessions.put(playerUuid, Boolean.TRUE);
    }

    public boolean verifyCodeInput(UUID playerUuid, String submittedCode) {
        if (!config.isJoinCodeEnabled()) {
            return true;
        }
        if (submittedCode == null) {
            return false;
        }
        String normalizedSubmitted = normalize(submittedCode);
        String normalizedExpected = normalize(config.getActiveJoinCode());

        if (normalizedExpected.equals(normalizedSubmitted)) {
            markVerified(playerUuid);
            if (logger != null) {
                logger.info("[EduBridge] Join Code verified for session {}", playerUuid);
            }
            return true;
        }
        return false;
    }

    private static String normalize(String raw) {
        return raw.trim().toUpperCase().replaceAll("[\\s_]+", "-");
    }
}
