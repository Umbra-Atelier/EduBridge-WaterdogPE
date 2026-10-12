package edu.waterdog.bridge;

import dev.waterdog.waterdogpe.event.defaults.PlayerAuthenticatedEvent;
import dev.waterdog.waterdogpe.event.defaults.PlayerDisconnectedEvent;
import dev.waterdog.waterdogpe.event.defaults.PlayerLoginEvent;
import dev.waterdog.waterdogpe.event.defaults.PreClientDataSetEvent;
import dev.waterdog.waterdogpe.event.defaults.ServerTransferRequestEvent;
import dev.waterdog.waterdogpe.plugin.Plugin;
import edu.waterdog.bridge.auth.M365JwksVerifier;
import edu.waterdog.bridge.auth.XuidSynthesizer;
import edu.waterdog.bridge.config.EduBridgeConfig;
import edu.waterdog.bridge.handler.DownstreamForwardingListener;
import edu.waterdog.bridge.handler.EduJoinCodeGatekeeper;
import edu.waterdog.bridge.handler.EduLoginPacketInterceptor;

import java.io.File;
import java.io.InputStream;
import java.nio.file.Files;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * EduBridgePlugin - Core WaterdogPE Plugin Entry Point.
 *
 * Bridges Microsoft 365 (Entra ID) Education Edition client authentication
 * directly into a native PowerNukkitX Bedrock server (127.0.0.1:19133)
 * without requiring a Java Edition backend or EduGeyser.
 *
 * Specifically tuned for low-resource Raspberry Pi 4 (ARM64) deployments.
 */
public final class EduBridgePlugin extends Plugin {

    private EduBridgeConfig bridgeConfig;
    private ExecutorService authExecutor;
    private M365JwksVerifier jwksVerifier;
    private XuidSynthesizer xuidSynthesizer;
    private EduJoinCodeGatekeeper joinCodeGatekeeper;
    private EduLoginPacketInterceptor loginInterceptor;
    private DownstreamForwardingListener downstreamListener;

    @Override
    public void onStartup() {
        getLogger().info("[EduBridge] Initializing M365 Education Edition Bridge for WaterdogPE...");
        saveDefaultConfig();
        this.bridgeConfig = EduBridgeConfig.load(new File(getDataFolder(), "config.yml"), getLogger());
    }

    @Override
    public void onEnable() {
        int workerThreads = Math.max(1, Math.min(4, this.bridgeConfig.getAsyncVerifierThreads()));
        this.authExecutor = Executors.newFixedThreadPool(workerThreads, new ThreadFactory() {
            private final AtomicInteger count = new AtomicInteger(1);
            @Override
            public Thread newThread(Runnable r) {
                Thread thread = new Thread(r, "EduBridge-RPi4-Verifier-" + count.getAndIncrement());
                thread.setDaemon(true);
                thread.setPriority(Thread.NORM_PRIORITY - 1);
                return thread;
            }
        });

        this.xuidSynthesizer = new XuidSynthesizer(this.bridgeConfig.getXuidHashSalt());
        this.jwksVerifier = new M365JwksVerifier(this.bridgeConfig, this.xuidSynthesizer, this.authExecutor, getLogger());
        this.joinCodeGatekeeper = new EduJoinCodeGatekeeper(this.bridgeConfig, getLogger());

        this.loginInterceptor = new EduLoginPacketInterceptor(
                this,
                this.bridgeConfig,
                this.jwksVerifier,
                this.xuidSynthesizer
        );

        this.downstreamListener = new DownstreamForwardingListener(
                this,
                this.bridgeConfig,
                this.loginInterceptor,
                this.joinCodeGatekeeper
        );

        // 1. Intercept PreClientDataSetEvent: Fired inside WaterdogPE HandshakeUtils
        // right before ClientData & ExtraData are finalized into LoginData.
        getProxy().getEventManager().subscribe(PreClientDataSetEvent.class, this.loginInterceptor::onPreClientDataSet);

        // 2. Intercept PlayerAuthenticatedEvent: Fired when handshake completes;
        // attaches our custom UpstreamPacketHandler to inspect LoginPacket & ModalFormResponsePacket.
        getProxy().getEventManager().subscribe(PlayerAuthenticatedEvent.class, this.loginInterceptor::onPlayerAuthenticated);

        // 3. Intercept PlayerLoginEvent: Enforces classroom Join Code gatekeeping and
        // logs verified M365 UPN + Tenant ID before initial connect to PowerNukkitX (port 19133).
        getProxy().getEventManager().subscribe(PlayerLoginEvent.class, this.downstreamListener::onPlayerLogin);

        // 4. Intercept ServerTransferRequestEvent: Ensures re-signed extraData JWT containing
        // M365 tenant & role metadata is forwarded to PowerNukkitX (port 19133).
        getProxy().getEventManager().subscribe(ServerTransferRequestEvent.class, this.downstreamListener::onServerTransferRequest);

        // 5. Cleanup session cache on disconnect to keep RPi4 heap usage minimal.
        getProxy().getEventManager().subscribe(PlayerDisconnectedEvent.class, this.downstreamListener::onPlayerDisconnect);

        getLogger().info(String.format(
                "[EduBridge] Active! Listening for Education Edition M365 clients (:19132) -> PowerNukkitX (%s:%d) [RPi4 Workers: %d]",
                this.bridgeConfig.getDownstreamHost(),
                this.bridgeConfig.getDownstreamPort(),
                workerThreads
        ));
    }

    @Override
    public void onDisable() {
        getLogger().info("[EduBridge] Shutting down M365 verification workers...");
        if (this.authExecutor != null) {
            this.authExecutor.shutdown();
            try {
                if (!this.authExecutor.awaitTermination(3, TimeUnit.SECONDS)) {
                    this.authExecutor.shutdownNow();
                }
            } catch (InterruptedException ignored) {
                this.authExecutor.shutdownNow();
                Thread.currentThread().interrupt();
            }
        }
    }

    private void saveDefaultConfig() {
        if (!getDataFolder().exists() && !getDataFolder().mkdirs()) {
            getLogger().warn("[EduBridge] Could not create plugin data directory!");
        }
        File configFile = new File(getDataFolder(), "config.yml");
        if (!configFile.exists()) {
            try (InputStream in = getResourceFile("config.yml")) {
                if (in != null) {
                    Files.copy(in, configFile.toPath());
                }
            } catch (Exception e) {
                getLogger().error("[EduBridge] Failed to write default config.yml", e);
            }
        }
    }

    public EduBridgeConfig getBridgeConfig() {
        return bridgeConfig;
    }
}
