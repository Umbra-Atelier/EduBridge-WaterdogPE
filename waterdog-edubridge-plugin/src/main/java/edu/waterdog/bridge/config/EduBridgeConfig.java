package edu.waterdog.bridge.config;

import org.apache.logging.log4j.Logger;
import org.yaml.snakeyaml.Yaml;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Strongly-typed configuration loader for EduBridge-WaterdogPE.
 */
public final class EduBridgeConfig {

    private final boolean verifyJwtSignature;
    private final String jwksUriTemplate;
    private final Set<String> allowedTenantIds;
    private final Set<String> allowedDomains;
    private final boolean allowHybridRetailXbox;
    private final String xuidHashSalt;

    private final boolean joinCodeEnabled;
    private final String activeJoinCode;
    private final int sessionTtlMinutes;
    private final String promptTitle;
    private final String promptSubtitle;

    private final String targetServerName;
    private final String downstreamHost;
    private final int downstreamPort;
    private final boolean injectSignedExtradata;
    private final Set<String> teacherDomains;

    private final int asyncVerifierThreads;
    private final int maxTokenCacheEntries;
    private final int jwksCacheHours;

    public EduBridgeConfig(
            boolean verifyJwtSignature,
            String jwksUriTemplate,
            Set<String> allowedTenantIds,
            Set<String> allowedDomains,
            boolean allowHybridRetailXbox,
            String xuidHashSalt,
            boolean joinCodeEnabled,
            String activeJoinCode,
            int sessionTtlMinutes,
            String promptTitle,
            String promptSubtitle,
            String targetServerName,
            String downstreamHost,
            int downstreamPort,
            boolean injectSignedExtradata,
            Set<String> teacherDomains,
            int asyncVerifierThreads,
            int maxTokenCacheEntries,
            int jwksCacheHours
    ) {
        this.verifyJwtSignature = verifyJwtSignature;
        this.jwksUriTemplate = jwksUriTemplate;
        this.allowedTenantIds = Collections.unmodifiableSet(allowedTenantIds);
        this.allowedDomains = Collections.unmodifiableSet(allowedDomains);
        this.allowHybridRetailXbox = allowHybridRetailXbox;
        this.xuidHashSalt = xuidHashSalt;
        this.joinCodeEnabled = joinCodeEnabled;
        this.activeJoinCode = activeJoinCode;
        this.sessionTtlMinutes = sessionTtlMinutes;
        this.promptTitle = promptTitle;
        this.promptSubtitle = promptSubtitle;
        this.targetServerName = targetServerName;
        this.downstreamHost = downstreamHost;
        this.downstreamPort = downstreamPort;
        this.injectSignedExtradata = injectSignedExtradata;
        this.teacherDomains = Collections.unmodifiableSet(teacherDomains);
        this.asyncVerifierThreads = asyncVerifierThreads;
        this.maxTokenCacheEntries = maxTokenCacheEntries;
        this.jwksCacheHours = jwksCacheHours;
    }

    @SuppressWarnings("unchecked")
    public static EduBridgeConfig load(File file, Logger logger) {
        try (InputStream in = new FileInputStream(file)) {
            Yaml yaml = new Yaml();
            Map<String, Object> root = yaml.load(in);

            Map<String, Object> m365 = (Map<String, Object>) root.getOrDefault("m365-auth", Collections.emptyMap());
            Map<String, Object> joinCode = (Map<String, Object>) root.getOrDefault("classroom-join-code", Collections.emptyMap());
            Map<String, Object> pnx = (Map<String, Object>) root.getOrDefault("downstream-pnx", Collections.emptyMap());
            Map<String, Object> hw = (Map<String, Object>) root.getOrDefault("hardware-tuning", Collections.emptyMap());

            return new EduBridgeConfig(
                    (Boolean) m365.getOrDefault("verify-jwt-signature", true),
                    (String) m365.getOrDefault("jwks-uri-template", "https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys"),
                    new HashSet<>((List<String>) m365.getOrDefault("allowed-tenant-ids", List.of("84c31ca0-ac3b-4eae-ad11-519d80233e6f"))),
                    new HashSet<>((List<String>) m365.getOrDefault("allowed-domains", List.of("students.oakridge.edu", "faculty.oakridge.edu"))),
                    (Boolean) m365.getOrDefault("allow-hybrid-retail-xbox", true),
                    (String) m365.getOrDefault("xuid-hash-salt", "edubridge-rpi4-pnx-salt-2026"),
                    (Boolean) joinCode.getOrDefault("enabled", true),
                    (String) joinCode.getOrDefault("active-code", "BOOK-APPLE-PANDA-RAIL"),
                    ((Number) joinCode.getOrDefault("session-ttl-minutes", 180)).intValue(),
                    (String) joinCode.getOrDefault("prompt-title", "Minecraft Education Classroom"),
                    (String) joinCode.getOrDefault("prompt-subtitle", "Enter your teacher's 4-word Join Code to connect to PowerNukkitX:"),
                    (String) pnx.getOrDefault("target-server-name", "lobby"),
                    (String) pnx.getOrDefault("host", "127.0.0.1"),
                    ((Number) pnx.getOrDefault("port", 19133)).intValue(),
                    (Boolean) pnx.getOrDefault("inject-signed-extradata", true),
                    new HashSet<>((List<String>) pnx.getOrDefault("teacher-domains", List.of("faculty.oakridge.edu"))),
                    ((Number) hw.getOrDefault("async-verifier-threads", 2)).intValue(),
                    ((Number) hw.getOrDefault("max-token-cache-entries", 256)).intValue(),
                    ((Number) hw.getOrDefault("jwks-cache-hours", 24)).intValue()
            );
        } catch (Exception e) {
            logger.warn("[EduBridge] Using fallback defaults due to config parse error: " + e.getMessage());
            return new EduBridgeConfig(
                    true,
                    "https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys",
                    Set.of("84c31ca0-ac3b-4eae-ad11-519d80233e6f"),
                    Set.of("students.oakridge.edu", "faculty.oakridge.edu"),
                    true,
                    "edubridge-rpi4-pnx-salt-2026",
                    true,
                    "BOOK-APPLE-PANDA-RAIL",
                    180,
                    "Minecraft Education Classroom",
                    "Enter your teacher's 4-word Join Code to connect to PowerNukkitX:",
                    "lobby",
                    "127.0.0.1",
                    19133,
                    true,
                    Set.of("faculty.oakridge.edu"),
                    2,
                    256,
                    24
            );
        }
    }

    public boolean isVerifyJwtSignature() { return verifyJwtSignature; }
    public String getJwksUriTemplate() { return jwksUriTemplate; }
    public Set<String> getAllowedTenantIds() { return allowedTenantIds; }
    public Set<String> getAllowedDomains() { return allowedDomains; }
    public boolean isAllowHybridRetailXbox() { return allowHybridRetailXbox; }
    public String getXuidHashSalt() { return xuidHashSalt; }
    public boolean isJoinCodeEnabled() { return joinCodeEnabled; }
    public String getActiveJoinCode() { return activeJoinCode; }
    public int getSessionTtlMinutes() { return sessionTtlMinutes; }
    public String getPromptTitle() { return promptTitle; }
    public String getPromptSubtitle() { return promptSubtitle; }
    public String getTargetServerName() { return targetServerName; }
    public String getDownstreamHost() { return downstreamHost; }
    public int getDownstreamPort() { return downstreamPort; }
    public boolean isInjectSignedExtradata() { return injectSignedExtradata; }
    public Set<String> getTeacherDomains() { return teacherDomains; }
    public int getAsyncVerifierThreads() { return asyncVerifierThreads; }
    public int getMaxTokenCacheEntries() { return maxTokenCacheEntries; }
    public int getJwksCacheHours() { return jwksCacheHours; }
}
