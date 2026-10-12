plugins {
    id("java")
    id("java-library")
    id("com.gradleup.shadow") version "8.3.5"
}

group = "edu.waterdog.bridge"
version = "1.2.0-RPi4"
description = "Native Microsoft 365 & Minecraft Education Edition Authentication Bridge for WaterdogPE -> PowerNukkitX"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
    withSourcesJar()
}

repositories {
    mavenCentral()
    maven("https://repo.waterdog.dev/main") {
        name = "waterdog-repo"
    }
    maven("https://repo.waterdog.dev/snapshots") {
        name = "waterdog-snapshots"
    }
    maven("https://repo.opencollab.dev/maven-releases/") {
        name = "opencollab-releases"
    }
    maven("https://repo.opencollab.dev/maven-snapshots/") {
        name = "opencollab-snapshots"
    }
}

dependencies {
    // WaterdogPE Proxy API (Provided at runtime by the proxy jar on port 19132)
    compileOnly("dev.waterdog.waterdogpe:waterdog:2.0.4-SNAPSHOT")

    // Cloudburst Protocol (Bedrock RakNet & LoginPacket / ModalFormRequestPacket definitions)
    compileOnly("org.cloudburstmc.protocol:bedrock-codec:3.0.0.Beta2-SNAPSHOT")
    compileOnly("org.cloudburstmc.protocol:bedrock-connection:3.0.0.Beta2-SNAPSHOT")

    // Nimbus JOSE + JWT for lightweight Microsoft 365 Entra ID (Azure AD) OIDC & JWKS validation
    // Shaded into plugin jar; minimal memory footprint for Raspberry Pi 4 ARM64
    implementation("com.nimbusds:nimbus-jose-jwt:9.41.2")

    // Caffeine for bounded, non-blocking JWKS and session token caching on 4-core Cortex-A72
    implementation("com.github.ben-manes.caffeine:caffeine:3.1.8")

    // Gson & SnakeYAML (Provided by WaterdogPE runtime)
    compileOnly("com.google.code.gson:gson:2.10.1")
    compileOnly("org.yaml:snakeyaml:2.2")
}

tasks {
    compileJava {
        options.encoding = Charsets.UTF_8.name()
        options.release.set(17)
    }

    processResources {
        filteringCharset = Charsets.UTF_8.name()
        filesMatching("plugin.yml") {
            expand("version" to project.version)
        }
    }

    shadowJar {
        archiveBaseName.set("WaterdogPE-EduBridge")
        archiveClassifier.set("")
        // Relocate shaded crypto/JWT dependencies to avoid conflicts with other WaterdogPE plugins
        relocate("com.nimbusds", "edu.waterdog.bridge.shaded.nimbusds")
        relocate("com.github.benmanes.caffeine", "edu.waterdog.bridge.shaded.caffeine")
        minimize()
    }

    build {
        dependsOn(shadowJar)
    }
}
