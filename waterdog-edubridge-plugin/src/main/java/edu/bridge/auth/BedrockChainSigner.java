package edu.bridge.auth;

import com.google.gson.JsonObject;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.ECDSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.security.spec.ECGenParameterSpec;
import java.time.Instant;
import java.util.Base64;
import java.util.Collections;
import java.util.Date;
import java.util.List;

/**
 * Creates and signs standard Bedrock Edition JSON Web Token (JWT) certificate chains
 * using an internal EC (secp384r1) keypair.
 *
 * This allows EduBedrockProxy to rewrite the unauthenticated or M365-signed LoginPacket
 * into a valid Bedrock chain that PowerNukkitX (on 127.0.0.1:19133) accepts natively.
 */
public final class BedrockChainSigner {

    private final KeyPair proxyKeyPair;
    private final ECDSASigner signer;
    private final String base64PublicKey;

    public BedrockChainSigner() {
        try {
            KeyPairGenerator kpg = KeyPairGenerator.getInstance("EC");
            kpg.initialize(new ECGenParameterSpec("secp384r1"));
            this.proxyKeyPair = kpg.generateKeyPair();
            this.signer = new ECDSASigner((ECPrivateKey) this.proxyKeyPair.getPrivate());
            this.base64PublicKey = Base64.getEncoder().encodeToString(this.proxyKeyPair.getPublic().getEncoded());
        } catch (Exception e) {
            throw new IllegalStateException("Failed to initialize EC secp384r1 keypair for Bedrock proxy", e);
        }
    }

    /**
     * Signs the extraData payload into a valid Bedrock authentication JWT.
     */
    public String signExtraDataJwt(M365EducationIdentity identity, boolean joinCodeVerified) {
        try {
            JsonObject extraData = new JsonObject();
            extraData.addProperty("XUID", identity.synthesizedXuid());
            extraData.addProperty("identity", identity.synthesizedUuid().toString());
            extraData.addProperty("displayName", identity.displayName());
            extraData.addProperty("titleId", "896928775");
            extraData.addProperty("edu_authenticated", true);
            extraData.addProperty("m365_tenant_id", identity.tenantId());
            extraData.addProperty("m365_object_id", identity.objectId());
            extraData.addProperty("m365_upn", identity.userPrincipalName());
            extraData.addProperty("edu_role", identity.eduRole());
            extraData.addProperty("join_code_verified", joinCodeVerified);

            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .issuer("EduBedrockProxy")
                    .subject(identity.synthesizedUuid().toString())
                    .issueTime(new Date())
                    .expirationTime(Date.from(Instant.now().plusSeconds(86400)))
                    .claim("extraData", com.google.gson.JsonParser.parseString(extraData.toString()).getAsJsonObject())
                    .claim("identityPublicKey", this.base64PublicKey)
                    .build();

            JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.ES384)
                    .x509CertURL(null)
                    .build();

            SignedJWT signedJWT = new SignedJWT(header, claims);
            signedJWT.sign(this.signer);
            return signedJWT.serialize();
        } catch (Exception e) {
            throw new RuntimeException("Failed to sign extraData JWT for PowerNukkitX", e);
        }
    }

    /**
     * Signs the clientData payload (device, skin, edition flags) for PowerNukkitX.
     */
    public String signClientDataJwt(JsonObject clientData, M365EducationIdentity identity) {
        try {
            JsonObject merged = clientData != null ? clientData.deepCopy() : new JsonObject();

            // Inject PowerNukkitX companion tags into ClientData
            merged.addProperty("Waterdog_EduAuthenticated", true);
            merged.addProperty("Waterdog_M365TenantId", identity.tenantId());
            merged.addProperty("Waterdog_M365ObjectId", identity.objectId());
            merged.addProperty("Waterdog_M365Upn", identity.userPrincipalName());
            merged.addProperty("Waterdog_EduRole", identity.eduRole());

            JWTClaimsSet.Builder builder = new JWTClaimsSet.Builder()
                    .issueTime(new Date());

            for (String key : merged.keySet()) {
                if (merged.get(key).isJsonPrimitive()) {
                    if (merged.get(key).getAsJsonPrimitive().isBoolean()) {
                        builder.claim(key, merged.get(key).getAsBoolean());
                    } else if (merged.get(key).getAsJsonPrimitive().isNumber()) {
                        builder.claim(key, merged.get(key).getAsNumber());
                    } else {
                        builder.claim(key, merged.get(key).getAsString());
                    }
                }
            }

            JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.ES384).build();
            SignedJWT signedJWT = new SignedJWT(header, builder.build());
            signedJWT.sign(this.signer);
            return signedJWT.serialize();
        } catch (Exception e) {
            throw new RuntimeException("Failed to sign clientData JWT for PowerNukkitX", e);
        }
    }

    public List<String> buildChain(String extraDataJwt) {
        return Collections.singletonList(extraDataJwt);
    }

    public KeyPair getProxyKeyPair() {
        return proxyKeyPair;
    }

    public String getBase64PublicKey() {
        return base64PublicKey;
    }
}
