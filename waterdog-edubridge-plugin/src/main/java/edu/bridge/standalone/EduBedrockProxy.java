package edu.bridge.standalone;

import edu.bridge.config.EduBridgeConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;

/**
 * Standalone Application Entry Point for EduBedrockProxy.
 *
 * Runs as a native, low-resource Bedrock proxy on Raspberry Pi 4 (takes ~60MB RAM),
 * eliminating the need for a Java Edition server or EduGeyser.
 *
 * Command:
 *   java -jar EduBedrockProxy.jar
 */
public final class EduBedrockProxy {

    private static final Logger LOGGER = LoggerFactory.getLogger(EduBedrockProxy.class);

    public static void main(String[] args) {
        LOGGER.info("[EduBridge] Starting standalone Native Bedrock & M365 Education Proxy...");

        File configFile = new File("config.yml");
        EduBridgeConfig config = EduBridgeConfig.load(configFile, LOGGER);

        EduBedrockServer server = new EduBedrockServer(config);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            LOGGER.info("[EduBridge] Shutdown signal received, terminating proxy...");
            server.stop();
        }, "EduBridge-ShutdownHook"));

        try {
            server.start();
        } catch (Exception e) {
            LOGGER.error("[EduBridge] Fatal error starting EduBedrockProxy", e);
            System.exit(1);
        }
    }
}
