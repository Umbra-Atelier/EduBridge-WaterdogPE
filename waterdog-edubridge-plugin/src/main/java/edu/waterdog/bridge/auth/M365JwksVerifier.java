package edu.waterdog.bridge.auth;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.RemoteJWKSet;
import com.nimbusds.jose.proc.JWSKeySelector;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jose.util.DefaultResourceRetriever;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.nimbusds.jwt.proc.ConfigurableJWTProcessor;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import edu.waterdog.bridge.config.EduBridgeConfig;
import org.apache.logging.log4j.Logger;

import java.net.URI;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Validates Microsoft 365 / Entra ID (Azure AD) JWT tokens carried by
 * Minecraft Education Edition clients during the Bedrock LoginPacket handshake.
 *
 * Uses bounded Caffeine caches so JWKS public keys are fetched at most once per
 * 24 hours per school tenant, keeping CPU and RAM overhead minimal on Raspberry Pi 4.
 */
public final class M365JwksVerifier {

    private final EduBridgeConfig config;
    private final XuidSynthesizer xuidSynthesizer;
    private final ExecutorService executor;
    private final Logger logger;

    // Cache RemoteJWKSet per Tenant UUID
    private final Cache<String, JWKSource<SecurityContext>> tenantJwksCache;
    // Cache already-verified token signatures by SHA-256 / raw JWT snippet
    private final Cache<String, M365EducationIdentity> verifiedTokenCache;

    public M365JwksVerifier(
            EduBridgeConfig config,
            XuidSynthesizer xuidSynthesizer,
            ExecutorService executor,
            Logger logger
    ) {
        this.config = config;
        this.xuidSynthesizer = xuidSynthesizer;
        this.executor = executor;
        this.logger = logger;

        this.tenantJwksCache = Caffeine.newBuilder()
                .maximumSize(32)
                .expireAfterWrite(config.getJwksCacheHours(), TimeUnit.HOURS)
                .build();

        this.verifiedTokenCache = Caffeine.newBuilder()
                .maximumSize(config.getMaxTokenCacheEntries())
                .expireAfterWrite(45, TimeUnit.MINUTES)
                .build();
    }

    /**
     * Asynchronously validates an M365 JWT token string on the RPi4 bounded thread pool.
     */
    public CompletableFuture<Optional<M365EducationIdentity>> verifyTokenAsync(String rawJwt) {
        return CompletableFuture.supplyAsync(() -> verifyTokenSync(rawJwt), this.executor);
    }

    /**
     * Synchronously parses and validates the M365 JWT token against the allowed school tenants.
     */
    public Optional<M365EducationIdentity> verifyTokenSync(String rawJwt) {
        if (rawJwt == null || rawJwt.isBlank()) {
            return Optional.empty();
        }

        M365EducationIdentity cached = this.verifiedTokenCache.getIfPresent(rawJwt);
        if (cached != null && cached.tokenExpiresAtEpochSeconds() > Instant.now().getEpochSecond()) {
            return Optional.of(cached);
        }

        try {
            SignedJWT signedJWT = SignedJWT.parse(rawJwt);
            JWTClaimsSet unverifiedClaims = signedJWT.getJWTClaimsSet();

            // 1. Extract Microsoft 365 Tenant ID ('tid') & Object ID ('oid' or 'sub')
            String tenantId = firstNonBlank(
                    unverifiedClaims.getStringClaim("tid"),
                    unverifiedClaims.getStringClaim("tenantId")
            );
            String objectId = firstNonBlank(
                    unverifiedClaims.getStringClaim("oid"),
                    unverifiedClaims.getSubject()
            );
            String upn = firstNonBlank(
                    unverifiedClaims.getStringClaim("upn"),
                    unverifiedClaims.getStringClaim("preferred_username"),
                    unverifiedClaims.getStringClaim("email")
            );
            String displayName = firstNonBlank(
                    unverifiedClaims.getStringClaim("name"),
                    unverifiedClaims.getStringClaim("displayName"),
                    upn
            );

            if (tenantId == null || objectId == null) {
                logger.debug("[EduBridge] JWT does not contain M365 'tid' or 'oid' claims.");
                return Optional.empty();
            }

            // 2. Verify Tenant ID against school whitelist in config.yml
            if (!config.getAllowedTenantIds().isEmpty() && !config.getAllowedTenantIds().contains(tenantId)) {
                logger.warn("[EduBridge] Rejected login from unauthorized M365 Tenant ID: " + tenantId);
                return Optional.empty();
            }

            // 3. Verify UPN domain suffix if configured
            if (upn != null && upn.contains("@") && !config.getAllowedDomains().isEmpty()) {
                String domain = upn.substring(upn.indexOf('@') + 1).toLowerCase();
                if (!config.getAllowedDomains().contains(domain)) {
                    logger.warn("[EduBridge] Rejected M365 login from unauthorized email domain: " + domain);
                    return Optional.empty();
                }
            }

            // 4. Verify Token Expiration
            Date exp = unverifiedClaims.getExpirationTime();
            long expEpoch = exp != null ? exp.toInstant().getEpochSecond() : Instant.now().plusSeconds(3600).getEpochSecond();
            if (exp != null && exp.before(new Date())) {
                logger.warn("[EduBridge] Rejected expired M365 Education token for UPN: " + upn);
                return Optional.empty();
            }

            // 5. Cryptographic RSA/ECDSA Signature Check against Microsoft OpenID JWKS
            if (config.isVerifyJwtSignature()) {
                JWKSource<SecurityContext> keySource = tenantJwksCache.get(tenantId, this::createRemoteJwkSource);
                ConfigurableJWTProcessor<SecurityContext> jwtProcessor = new DefaultJWTProcessor<>();
                JWSKeySelector<SecurityContext> keySelector = new JWSVerificationKeySelector<>(
                        JWSAlgorithm.RS256,
                        keySource
                );
                jwtProcessor.setJWSKeySelector(keySelector);
                jwtProcessor.process(signedJWT, null);
            }

            // 6. Determine Education Role (Teacher vs Student)
            String eduRole = resolveEduRole(unverifiedClaims, upn);
            String synthesizedXuid = xuidSynthesizer.deriveEducationXuid(tenantId, objectId);
            UUID synthesizedUuid = xuidSynthesizer.deriveEducationUuid(tenantId, objectId);

            M365EducationIdentity identity = new M365EducationIdentity(
                    tenantId,
                    objectId,
                    upn != null ? upn : (objectId + "@tenant.local"),
                    xuidSynthesizer.sanitizeBedrockUsername(displayName, upn),
                    synthesizedXuid,
                    synthesizedUuid,
                    eduRole,
                    "Minecraft: Education Edition (M365)",
                    expEpoch
            );

            this.verifiedTokenCache.put(rawJwt, identity);
            return Optional.of(identity);

        } catch (Exception e) {
            logger.warn("[EduBridge] M365 JWT verification failed: " + e.getMessage());
            return Optional.empty();
        }
    }

    private JWKSource<SecurityContext> createRemoteJwkSource(String tenantId) {
        try {
            String uri = config.getJwksUriTemplate().replace("{tenant}", tenantId);
            // Low timeouts (2500ms) so network hiccups never stall RPi4 threads
            DefaultResourceRetriever retriever = new DefaultResourceRetriever(2500, 2500, 512 * 1024);
            return new RemoteJWKSet<>(URI.create(uri).toURL(), retriever);
        } catch (Exception e) {
            throw new IllegalStateException("Invalid JWKS URI for tenant " + tenantId, e);
        }
    }

    private String resolveEduRole(JWTClaimsSet claims, String upn) {
        try {
            List<String> roles = claims.getStringListClaim("roles");
            if (roles != null) {
                for (String role : roles) {
                    if (role.toLowerCase().contains("teacher") || role.toLowerCase().contains("faculty") || role.toLowerCase().contains("admin")) {
                        return "teacher";
                    }
                }
            }
            String eduRoleClaim = claims.getStringClaim("edu_role");
            if (eduRoleClaim != null && !eduRoleClaim.isBlank()) {
                return eduRoleClaim.toLowerCase();
            }
        } catch (Exception ignored) {
        }

        if (upn != null && upn.contains("@")) {
            String domain = upn.substring(upn.indexOf('@') + 1).toLowerCase();
            if (config.getTeacherDomains().contains(domain)) {
                return "teacher";
            }
        }
        return "student";
    }

    private static String firstNonBlank(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) {
                return v;
            }
        }
        return null;
    }
}
