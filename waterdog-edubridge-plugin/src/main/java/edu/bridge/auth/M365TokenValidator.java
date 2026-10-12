package edu.bridge.auth;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jose.jwk.source.JWKSourceBuilder;
import com.nimbusds.jose.proc.JWSKeySelector;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jose.util.DefaultResourceRetriever;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.nimbusds.jwt.proc.ConfigurableJWTProcessor;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;
import edu.bridge.config.EduBridgeConfig;
import org.slf4j.Logger;

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
 * Validates Microsoft 365 / Entra ID (Azure AD) RS256 JWT tokens
 * against Microsoft's OpenID Connect JWKS endpoint.
 */
public final class M365TokenValidator {

    private final EduBridgeConfig config;
    private final XuidSynthesizer xuidSynthesizer;
    private final ExecutorService executor;
    private final Logger logger;

    private final Cache<String, JWKSource<SecurityContext>> tenantJwksCache;
    private final Cache<String, M365EducationIdentity> verifiedTokenCache;

    public M365TokenValidator(
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
                .expireAfterWrite(24, TimeUnit.HOURS)
                .build();

        this.verifiedTokenCache = Caffeine.newBuilder()
                .maximumSize(512)
                .expireAfterWrite(45, TimeUnit.MINUTES)
                .build();
    }

    public CompletableFuture<Optional<M365EducationIdentity>> verifyTokenAsync(String rawJwt) {
        return CompletableFuture.supplyAsync(() -> verifyTokenSync(rawJwt), this.executor);
    }

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
                return Optional.empty();
            }

            if (!config.getAllowedTenantIds().isEmpty() && !config.getAllowedTenantIds().contains(tenantId)) {
                if (logger != null) {
                    logger.warn("[EduBridge] Rejected login from unauthorized M365 Tenant ID: {}", tenantId);
                }
                return Optional.empty();
            }

            if (upn != null && upn.contains("@") && !config.getAllowedDomains().isEmpty()) {
                String domain = upn.substring(upn.indexOf('@') + 1).toLowerCase();
                if (!config.getAllowedDomains().contains(domain)) {
                    if (logger != null) {
                        logger.warn("[EduBridge] Rejected login from unauthorized domain: {}", domain);
                    }
                    return Optional.empty();
                }
            }

            Date exp = unverifiedClaims.getExpirationTime();
            long expEpoch = exp != null ? exp.toInstant().getEpochSecond() : Instant.now().plusSeconds(3600).getEpochSecond();
            if (exp != null && exp.before(new Date())) {
                if (logger != null) {
                    logger.warn("[EduBridge] Expired M365 token for {}", upn);
                }
                return Optional.empty();
            }

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
            if (logger != null) {
                logger.warn("[EduBridge] M365 JWT verification failed: {}", e.getMessage());
            }
            return Optional.empty();
        }
    }

    private JWKSource<SecurityContext> createRemoteJwkSource(String tenantId) {
        try {
            String uri = config.getJwksUriTemplate().replace("{tenant}", tenantId);
            DefaultResourceRetriever retriever = new DefaultResourceRetriever(2500, 2500, 512 * 1024);
            return JWKSourceBuilder.create(URI.create(uri).toURL(), retriever).build();
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
