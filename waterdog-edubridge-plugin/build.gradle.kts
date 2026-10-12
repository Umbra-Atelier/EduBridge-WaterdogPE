plugins {
    id("java")
    id("com.gradleup.shadow") version "8.3.5"
}

group = "edu.bridge"
version = "2.0.0-CustomBuild"
description = "Native Bedrock & M365 Education Edition Proxy Bridge for Raspberry Pi 4 (PowerNukkitX :19133)"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

repositories {
    mavenCentral()
}

dependencies {
    // High-performance Netty 4.1 networking (used for UDP RakNet/Bedrock framing & pipeline interception)
    implementation("io.netty:netty-all:4.1.100.Final")

    // Cryptographic validation of Microsoft 365 Entra ID (Azure AD) OIDC & JWKS tokens
    implementation("com.nimbusds:nimbus-jose-jwt:9.41.2")

    // High-performance, bounded caching for Microsoft JWKS keys on Raspberry Pi 4 Cortex-A72
    implementation("com.github.ben-manes.caffeine:caffeine:3.1.8")

    // JSON and YAML configuration parsing
    implementation("com.google.code.gson:gson:2.10.1")
    implementation("org.yaml:snakeyaml:2.2")

    // SLF4J / Logging
    implementation("org.slf4j:slf4j-api:2.0.12")
    implementation("org.slf4j:slf4j-simple:2.0.12")
}

tasks {
    compileJava {
        options.encoding = Charsets.UTF_8.name()
        options.release.set(17)
    }

    shadowJar {
        archiveBaseName.set("EduBedrockProxy")
        archiveClassifier.set("")

        manifest {
            // Can be executed standalone: java -jar EduBedrockProxy.jar
            attributes["Main-Class"] = "edu.bridge.standalone.EduBedrockProxy"
            // Can also be attached as a JavaAgent to WaterdogPE to intercept Netty pipelines: -javaagent:EduBedrockProxy.jar
            attributes["Premain-Class"] = "edu.bridge.agent.WaterdogNettyAgent"
            attributes["Can-Redefine-Classes"] = "true"
            attributes["Can-Retransform-Classes"] = "true"
        }
    }

    build {
        dependsOn(shadowJar)
    }
}
