package edu.bridge.config;

import org.slf4j.Logger;
import org.yaml.snakeyaml.Yaml;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.*;

/**
 * Strongly-typed configuration parser for EduBedrockProxy / EduBridge.
 */
public final class EduBridgeConfig {

    private final String bindHost;
    private final int bindPort;

    private final String downstreamHost;
    private final int downstreamPort;

    private final boolean verifyJwtSignature;
    private final String jwksUriTemplate;
    private final Set<String> allowedTenantIds;
    private final Set<String> allowedDomains;
    private final Set<String> teacherDomains;
    private final boolean allowHybridRetailXbox;
    private final String xuidHashSalt;

    private final boolean joinCodeEnabled;
    private final String activeJoinCode;
    private final int sessionTtlMinutes;

    private final int asyncVerifierThreads;

    public EduBridgeConfig(
            String bindHost,
            int bindPort,
            String downstreamHost,
            int downstreamPort,
            boolean verifyJwtSignature,
            String jwksUriTemplate,
            Set<String> allowedTenantIds,
            Set<String> allowedDomains,
            Set<String> teacherDomains,
            boolean allowHybridRetailXbox,
            String xuidHashSalt,
            boolean joinCodeEnabled,
            String activeJoinCode,
            int sessionTtlMinutes,
            int asyncVerifierThreads
    ) {
        this.bindHost = bindHost;
        this.bindPort = bindPort;
        this.downstreamHost = downstreamHost;
        this.downstreamPort = downstreamPort;
        this.verifyJwtSignature = verifyJwtSignature;
        this.jwksUriTemplate = jwksUriTemplate;
        this.allowedTenantIds = Collections.unmodifiableSet(allowedTenantIds);
        this.allowedDomains = Collections.unmodifiableSet(allowedDomains);
        this.teacherDomains = Collections.unmodifiableSet(teacherDomains);
        this.allowHybridRetailXbox = allowHybridRetailXbox;
        this.xuidHashSalt = xuidHashSalt;
        this.joinCodeEnabled = joinCodeEnabled;
        this.activeJoinCode = activeJoinCode;
        this.sessionTtlMinutes = sessionTtlMinutes;
        this.asyncVerifierThreads = asyncVerifierThreads;
    }

    @SuppressWarnings("unchecked")
    public static EduBridgeConfig load(File file, Logger logger) {
        try {
            InputStream in;
            if (file != null && file.exists()) {
                in = new FileInputStream(file);
            } else {
                in = EduBridgeConfig.class.getClassLoader().getResourceAsStream("config.yml");
            }

            if (in == null) {
                return createDefaults();
            }

            Yaml yaml = new Yaml();
            Map<String, Object> root = yaml.load(in);
            in.close();

            Map<String, Object> proxy = (Map<String, Object>) root.getOrDefault("proxy-listener", Collections.emptyMap());
            Map<String, Object> pnx = (Map<String, Object>) root.getOrDefault("downstream-pnx", Collections.emptyMap());
            Map<String, Object> m365 = (Map<String, Object>) root.getOrDefault("m365-auth", Collections.emptyMap());
            Map<String, Object> joinCode = (Map<String, Object>) root.getOrDefault("classroom-join-code", Collections.emptyMap());
            Map<String, Object> hw = (Map<String, Object>) root.getOrDefault("hardware-tuning", Collections.emptyMap());

            return new EduBridgeConfig(
                    (String) proxy.getOrDefault("host", "0.0.0.0"),
                    ((Number) proxy.getOrDefault("port", 19132)).intValue(),
                    (String) pnx.getOrDefault("host", "127.0.0.1"),
                    ((Number) pnx.getOrDefault("port", 19133)).intValue(),
                    (Boolean) m365.getOrDefault("verify-jwt-signature", true),
                    (String) m365.getOrDefault("jwks-uri-template", "https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys"),
                    new HashSet<>((List<String>) m365.getOrDefault("allowed-tenant-ids", List.of("84c31ca0-ac3b-4eae-ad11-519d80233e6f"))),
                    new HashSet<>((List<String>) m365.getOrDefault("allowed-domains", List.of("students.oakridge.edu", "faculty.oakridge.edu"))),
                    new HashSet<>((List<String>) m365.getOrDefault("teacher-domains", List.of("faculty.oakridge.edu"))),
                    (Boolean) m365.getOrDefault("allow-hybrid-retail-xbox", true),
                    (String) m365.getOrDefault("xuid-hash-salt", "edubridge-rpi4-pnx-salt-2026"),
                    (Boolean) joinCode.getOrDefault("enabled", true),
                    (String) joinCode.getOrDefault("active-code", "BOOK-APPLE-PANDA-RAIL"),
                    ((Number) joinCode.getOrDefault("session-ttl-minutes", 180)).intValue(),
                    ((Number) hw.getOrDefault("async-verifier-threads", 2)).intValue()
            );
        } catch (Exception e) {
            if (logger != null) {
                logger.warn("[EduBridge] Failed to read config.yml, using defaults: " + e.getMessage());
            }
            return createDefaults();
        }
    }

    public static EduBridgeConfig createDefaults() {
        return new EduBridgeConfig(
                "0.0.0.0",
                19132,
                "127.0.0.1",
                19133,
                true,
                "https://login.microsoftonline.com/{tenant}/discovery/v2.0/keys",
                Set.of("84c31ca0-ac3b-4eae-ad11-519d80233e6f"),
                Set.of("students.oakridge.edu", "faculty.oakridge.edu"),
                Set.of("faculty.oakridge.edu"),
                true,
                "edubridge-rpi4-pnx-salt-2026",
                true,
                "BOOK-APPLE-PANDA-RAIL",
                180,
                2
        );
    }

    public String getBindHost() { return bindHost; }
    public int getBindPort() { return bindPort; }
    public String getDownstreamHost() { return downstreamHost; }
    public int getDownstreamPort() { return downstreamPort; }
    public boolean isVerifyJwtSignature() { return verifyJwtSignature; }
    public String getJwksUriTemplate() { return jwksUriTemplate; }
    public Set<String> getAllowedTenantIds() { return allowedTenantIds; }
    public Set<String> getAllowedDomains() { return allowedDomains; }
    public Set<String> getTeacherDomains() { return teacherDomains; }
    public boolean isAllowHybridRetailXbox() { return allowHybridRetailXbox; }
    public String getXuidHashSalt() { return xuidHashSalt; }
    public boolean isJoinCodeEnabled() { return joinCodeEnabled; }
    public String getActiveJoinCode() { return activeJoinCode; }
    public int getSessionTtlMinutes() { return sessionTtlMinutes; }
    public int getAsyncVerifierThreads() { return asyncVerifierThreads; }
}
