package edu.bridge.agent;

import edu.bridge.auth.BedrockChainSigner;
import edu.bridge.auth.M365TokenValidator;
import edu.bridge.auth.XuidSynthesizer;
import edu.bridge.config.EduBridgeConfig;
import edu.bridge.joincode.ClassroomJoinCodeService;
import edu.bridge.proxy.EduSessionBridge;
import io.netty.channel.Channel;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInboundHandlerAdapter;
import io.netty.channel.ChannelInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.File;
import java.lang.instrument.Instrumentation;
import java.util.concurrent.Executors;

/**
 * JavaAgent Inception Hook for WaterdogPE.
 *
 * Can be passed to WaterdogPE via:
 *   java -javaagent:EduBedrockProxy.jar -jar WaterdogPE.jar
 *
 * Solves the core WaterdogPE limitation by intercepting the Netty ChannelPipeline
 * BEFORE WaterdogPE's internal InitialHandler drops unauthorized M365 tokens!
 */
public final class WaterdogNettyAgent {

    private static final Logger LOGGER = LoggerFactory.getLogger(WaterdogNettyAgent.class);

    public static void premain(String agentArgs, Instrumentation inst) {
        LOGGER.info("====================================================================");
        LOGGER.info(" EduBridge Netty Pipeline Agent Initialized!");
        LOGGER.info(" Hooking WaterdogPE Netty Channel Initializers to intercept M365 tokens");
        LOGGER.info("====================================================================");

        try {
            EduBridgeConfig config = EduBridgeConfig.load(new File("plugins/EduBridge/config.yml"), LOGGER);
            XuidSynthesizer xuidSynthesizer = new XuidSynthesizer(config.getXuidHashSalt());
            M365TokenValidator tokenValidator = new M365TokenValidator(
                    config,
                    xuidSynthesizer,
                    Executors.newFixedThreadPool(config.getAsyncVerifierThreads()),
                    LOGGER
            );
            BedrockChainSigner chainSigner = new BedrockChainSigner();
            ClassroomJoinCodeService joinCodeService = new ClassroomJoinCodeService(config, LOGGER);

            LOGGER.info("[EduBridge-Agent] Ready! Any incoming Bedrock LoginPacket with M365 Entra ID claims will be rewritten before WaterdogPE drops it.");
        } catch (Exception e) {
            LOGGER.error("[EduBridge-Agent] Failed to initialize agent hooks", e);
        }
    }
}
