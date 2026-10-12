package edu.bridge.standalone;

import edu.bridge.config.EduBridgeConfig;
import edu.bridge.nethernet.EducationSessionBrokerService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.util.Map;
import java.util.Scanner;

/**
 * Standalone Application Entry Point for EduBedrockProxy.
 *
 * Runs as a native, low-resource Bedrock + NetherNet / M365 Session Broker proxy
 * on Raspberry Pi 4 (takes ~60MB RAM), eliminating the need for a Java Edition server or EduGeyser.
 *
 * Interactive Console Commands (EduGeyser Compatible):
 *   edu joincode              - Show active 4-picture Join Codes, Share Links, and NetherNet Connection ID
 *   edu joincode add [tenant] - Start M365 OAuth Device Code sign-in to publish Join Code to Microsoft Discovery
 *   edu joincode rotate       - Generate a new random 4-picture Join Code from the 18 official symbols
 *   edu nethernet             - Display the persistent 18-digit NetherNet Connection ID
 *   help                      - Show available proxy commands
 *   stop                      - Gracefully stop the proxy
 */
public final class EduBedrockProxy {

    private static final Logger LOGGER = LoggerFactory.getLogger(EduBedrockProxy.class);

    public static void main(String[] args) {
        LOGGER.info("[EduBridge] Starting standalone Native Bedrock, M365 Discovery & NetherNet Proxy...");

        File configFile = new File("config.yml");
        EduBridgeConfig config = EduBridgeConfig.load(configFile, LOGGER);

        EduBedrockServer server = new EduBedrockServer(config);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            LOGGER.info("[EduBridge] Shutdown signal received, terminating proxy...");
            server.stop();
        }, "EduBridge-ShutdownHook"));

        try {
            server.start();
            startInteractiveConsole(server);
        } catch (Exception e) {
            LOGGER.error("[EduBridge] Fatal error starting EduBedrockProxy", e);
            System.exit(1);
        }
    }

    private static void startInteractiveConsole(EduBedrockServer server) {
        Thread consoleThread = new Thread(() -> {
            try (Scanner scanner = new Scanner(System.in)) {
                while (scanner.hasNextLine()) {
                    String line = scanner.nextLine().trim();
                    if (line.isEmpty()) continue;

                    String normalized = line.startsWith("/") ? line.substring(1).trim() : line;
                    String[] parts = normalized.split("\\s+");
                    String cmd = parts[0].toLowerCase();

                    if ("stop".equals(cmd) || "exit".equals(cmd) || "end".equals(cmd)) {
                        LOGGER.info("[EduBridge] Stopping proxy from console command...");
                        server.stop();
                        System.exit(0);
                    } else if ("help".equals(cmd)) {
                        printHelp();
                    } else if ("edu".equals(cmd)) {
                        handleEduCommand(server, parts);
                    } else {
                        LOGGER.info("[EduBridge] Unknown command '{}'. Type 'help' or 'edu joincode' for options.", line);
                    }
                }
            } catch (Exception ignored) {
                // Non-interactive daemon mode
            }
        }, "EduBridge-Console");
        consoleThread.setDaemon(true);
        consoleThread.start();
    }

    private static void handleEduCommand(EduBedrockServer server, String[] parts) {
        EducationSessionBrokerService broker = server.getSessionBroker();
        if (broker == null) {
            LOGGER.warn("[EduBridge] Session Broker is not initialized yet.");
            return;
        }

        if (parts.length < 2) {
            printHelp();
            return;
        }

        String sub = parts[1].toLowerCase();
        if ("nethernet".equals(sub) || "id".equals(sub)) {
            LOGGER.info("====================================================================");
            LOGGER.info(" [NetherNet Connection ID]: {}", broker.getConnectionId());
            LOGGER.info(" Stored in: nethernet/connection-id.yml");
            LOGGER.info(" Students can enter this 18-digit ID in M:EE 'Join World' across any tenant!");
            LOGGER.info("====================================================================");
        } else if ("joincode".equals(sub)) {
            if (parts.length == 2 || "list".equalsIgnoreCase(parts[2])) {
                LOGGER.info("====================================================================");
                LOGGER.info(" NetherNet Connection ID: {}", broker.getConnectionId());
                for (Map.Entry<String, EducationSessionBrokerService.TenantSessionRecord> entry : broker.getActiveTenantSessions().entrySet()) {
                    EducationSessionBrokerService.TenantSessionRecord rec = entry.getValue();
                    LOGGER.info(" Tenant:     {}", rec.tenantId());
                    LOGGER.info(" 4-Picture:  {} (Passcode indices: {})",
                            rec.joinCode(), EducationSessionBrokerService.symbolsToNumericPasscode(rec.joinCode()));
                    LOGGER.info(" Share Link: {}", rec.shareLink());
                }
                LOGGER.info("====================================================================");
            } else if ("add".equalsIgnoreCase(parts[2])) {
                String tenant = parts.length >= 4 ? parts[3] : "organizations";
                broker.startDeviceCodeFlowForJoinCode(tenant);
            } else if ("rotate".equalsIgnoreCase(parts[2]) || "rebuild".equalsIgnoreCase(parts[2])) {
                String newCode = broker.generateRandomFourPictureCode();
                server.getJoinCodeService().setActivePictureJoinCode(newCode);
                LOGGER.info("[EduSessionBroker] Rotated active 4-picture Join Code to: {}", newCode);
                LOGGER.info("[EduSessionBroker] Share Link: {}", broker.buildShareLink(newCode));
            } else {
                printHelp();
            }
        } else {
            printHelp();
        }
    }

    private static void printHelp() {
        LOGGER.info("================ EduBedrockProxy Console Commands ================");
        LOGGER.info("  edu joincode              - View active 4-picture Join Code & 18-digit Connection ID");
        LOGGER.info("  edu joincode add [tenant] - Link M365 account via Device Code to publish Join Code");
        LOGGER.info("  edu joincode rotate       - Generate a new random 4-picture Join Code");
        LOGGER.info("  edu nethernet             - Show persistent 18-digit NetherNet Connection ID");
        LOGGER.info("  stop                      - Gracefully stop the proxy");
        LOGGER.info("==================================================================");
    }
}
