# EduBridge-WaterdogPE: Native M365 & Education Edition Proxy Bridge

EduBridge-WaterdogPE is a complete, GitHub-ready Java Gradle plugin repository and interactive engineering workbench that enables **Minecraft Education Edition** clients (authenticated via Microsoft 365 organization tenants and classroom join codes) to connect through a **WaterdogPE** proxy (`:19132`) directly into a native **PowerNukkitX** Bedrock server (`:19133`) on a Raspberry Pi 4—without requiring a Java Edition server or EduGeyser.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> Your Phase 1 preferences have been locked into this architecture so you can sync the workspace directly to GitHub or export a standalone `.zip` / Gradle project bundle at any time.

- **Confirmed Decision 1 (Repository & Delivery Format)**: Full, production-ready Java Gradle project structure written directly in the repository workspace (`waterdog-edubridge-plugin/`) alongside a companion PowerNukkitX reader module and an interactive Web Workbench for configuring tenant IDs, testing M365 JWT chains, and downloading packaged files.
- **Confirmed Decision 2 (Authentication Interception Strategy)**: Intercept incoming `LoginPacket` instances via a custom `UpstreamPacketHandler` and `PreClientDataSetEvent` pipeline to bypass retail Xbox Live (`Mojang Root Key`) rejection while cryptographically validating Microsoft 365 Entra ID (Azure AD) / Education Services JWT chains and classroom Join Codes.
- **Confirmed Decision 3 (Downstream Forwarding to PowerNukkitX)**: Inject verified M365 claims (`tid`, `oid`, `upn`, `edu_role`, `join_code_session`) into WaterdogPE's `extraData` (`JsonObject`) and re-sign the downstream `LoginPacket` chain with WaterdogPE's proxy `KeyPair` so PowerNukkitX (`127.0.0.1:19133`) trusts and reads the student identity natively.

---

### 1. Overview & Core Concept

- **What It Does**:
  1. **Complete Java Plugin Repository in Workspace**: Provides the complete Gradle build system, `plugin.yml`, core WaterdogPE plugin entry point, Netty/Cloudburst `LoginPacket` interceptor, M365 OIDC/JWKS token verifier, Join Code room gatekeeper, downstream `HandshakeUtils` JWT injector, and a companion PowerNukkitX receiver listener directly inside the project directory for immediate GitHub sync.
  2. **Interactive Engineering Workbench (Web App)**: Provides a developer console where server administrators can inspect every Java source file, customize `config.yml` (M365 Allowed Tenant IDs, Classroom Join Code, PowerNukkitX Downstream Port `19133`, Raspberry Pi 4 ARM64 thread budgets), run live simulated M365 Education `LoginPacket` handshakes to inspect the decoded & re-signed JWT payloads, and download any file or the full repository bundle.
- **Target Audience / Persona**: Minecraft Bedrock network engineers, school IT administrators, and Raspberry Pi self-hosters running native Bedrock classroom infrastructure on low-resource ARM64 hardware.
- **Key Value**: Eliminates the ~1.5 GB RAM overhead of running a dummy Java Edition server + Geyser/EduGeyser on a Raspberry Pi 4, keeping the entire stack native Bedrock (`WaterdogPE -> PowerNukkitX`) while preserving Microsoft 365 school tenant security and classroom join codes.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Repository & Code Explorer**: Browse the complete Gradle project files (`build.gradle.kts`, `settings.gradle.kts`, `plugin.yml`, `config.yml`, and all Java classes across `edu.waterdog.bridge.*` and `cn.powernukkitx.edubridge.*`), copy individual classes, or export the project.
  2. **M365 & Raspberry Pi 4 Configurator**: Customize the school's Azure AD / Entra Tenant UUIDs, configure classroom Join Codes (e.g., `BOOK-APPLE-PANDA-RAIL`), set the PowerNukkitX downstream address (`127.0.0.1:19133`), and dynamically regenerate `config.yml` and `waterdog.yml` snippets.
  3. **Live Handshake & Packet Interceptor Simulator**: Test an incoming Education Edition client connection (`LoginPacket` with M365 JWT chain + `ClientData` skin/device token), step through how standard WaterdogPE `HandshakeUtils.processHandshake()` fails on retail Xbox root key checks, and observe how `EduUpstreamLoginHandler` verifies the M365 token, injects `extraData` claims, and forwards the re-signed JWT to PowerNukkitX.
  4. **Architecture & Xbox-Auth Bypass Guide**: Interactive technical walkthrough detailing the exact packet lifecycle, WaterdogPE `online-mode` vs. custom `UpstreamPacketHandler` mechanics, and PowerNukkitX `waterdogpe-login-extras` integration.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Precision systems engineering & developer console (clean, high-contrast dark slate workspace tailored for network protocol inspection and Java development).
  - *Color Palette & Mood*:
    - Dominant Canvas (60%): Deep Carbon Slate (`#0B0F17`) with crisp hairline borders (`#1E293B`).
    - Structural Surfaces (30%): Elevated Slate panels (`#111827`) and code viewport surfaces (`#0D131F`) with high-contrast legibility (`#F8FAFC` primary text, `#94A3B8` muted prose).
    - Accent Budget (10%): Bedrock Emerald (`#10B981`) for verified handshake states and M365 Azure Blue (`#38BDF8`) for primary interactive actions and active tabs.
  - *Typography & Hierarchy*:
    - Display & Navigation: `Plus Jakarta Sans` (SemiBold 600 / Bold 700) for clean structural hierarchy.
    - Body Prose: `DM Sans` (Regular 400 / Medium 500) for technical explanations and documentation.
    - Code, Packets & Telemetry: `JetBrains Mono` (`tabular-nums`) for all Java source code, Gradle scripts, port numbers, and JWT payload inspection.
  - *Component Styling & Layout*: Full-viewport 1440px desktop engineering layout following the 3-zone Top Bar Contract, left file/module sidebar (`260px`), and main split-pane code/simulator workspace with single-elevation surfaces and unboxed metadata separators (`·`).

- **Interactive Feedback & Motion**:
  - Instant (<150ms) tab switching between Java source files, live syntax highlighting, one-click clipboard copy with confirmation state, and interactive step-by-step packet stage inspection.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Dual-Stage Interception (`LoginPacket` Handler + `PreClientDataSetEvent`)**
  - *Chosen Approach*: Hook `PlayerLoginEvent` / initial session creation to attach a custom `PacketHandler` before or in place of WaterdogPE's default `InitialHandler` when `use-login-extras` is active, paired with `PreClientDataSetEvent` to enrich `extraData` and validate M365 tokens against Microsoft's OpenID Connect JWKS endpoint (`login.microsoftonline.com/{tenant}/discovery/v2.0/keys`).
  - *Why*: Standard WaterdogPE `HandshakeUtils.validateChain()` checks whether the certificate chain terminates at Mojang's retail Xbox Live Root Public Key (`MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE...`). Education Edition clients sign their handshake using a Microsoft Education / M365 tenant token chain or send an educational protocol variant (`protocolVersion` / `edu` deviceOS). Intercepting at the initial handshake layer allows us to validate the M365 token cryptographically without letting WaterdogPE drop the connection as "Unauthenticated Xbox Live account".
  - *Alternatives Considered*: Simply turning `online-mode: false` in WaterdogPE globally without packet verification—rejected because it leaves the school server vulnerable to XUID/username spoofing.

- **Decision 2: Downstream Forwarding via WaterdogPE `extraData` + Signed Proxy JWT**
  - *Chosen Approach*: Inject verified M365 student attributes (`m365_tenant_id`, `m365_object_id`, `m365_upn`, `edu_role`, `join_code_verified`) into the `extraData` `JsonObject` during `PreClientDataSetEvent` and invoke `HandshakeUtils.createExtraData(KeyPair, JsonObject)` when constructing the downstream `ServerTransferRequest` to PowerNukkitX (`127.0.0.1:19133`).
  - *Why*: PowerNukkitX natively supports WaterdogPE downstream authentication (`waterdogpe-support: true` in `server.properties`). By embedding the M365 claims directly inside the proxy-signed JWT chain, PowerNukkitX accepts the player immediately on port `19133` with zero RakNet packet modification required on the backend, and a lightweight PowerNukkitX plugin can read the student's school email and role from `PlayerLoginEvent`.
  - *Alternatives Considered*: Separate Redis pub/sub or custom RakNet payload channels—rejected to keep the Raspberry Pi 4 memory footprint minimal (no Redis daemon needed).

- **Decision 3: Direct Repository Layout for GitHub Sync**
  - *Chosen Approach*: Write all real Java & Gradle source files directly into the workspace directory (`build.gradle.kts`, `settings.gradle.kts`, `src/main/java/...`, `src/main/resources/plugin.yml`, `powernukkitx-companion/...`) while maintaining the interactive web workbench in the root web app.
  - *Why*: You stated you will sync the directory directly to GitHub to download/build the plugin like any standard Java repository. Having the physical `.java`, `.kts`, and `.yml` files present on disk ensures `git push` and `./gradlew shadowJar` work out-of-the-box.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                 Minecraft Education Edition Client (M365)                    │
│        Sends LoginPacket (M365 Tenant Token / Chain + Edu ClientData)        │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ UDP :19132 (RakNet / Bedrock)
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     WaterdogPE Proxy (Raspberry Pi 4)                        │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ 1. EduLoginPacketInterceptor (Custom Upstream Handshake Hook)          │  │
│  │    • Intercepts LoginPacket before retail Mojang Root Key rejection    │  │
│  │    • Extracts M365 JWT & Education ClientData payload                  │  │
│  └───────────────────────────────────┬────────────────────────────────────┘  │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ 2. M365TokenValidator & CachingJwksResolver                            │  │
│  │    • Verifies RSA/ECDSA signature via Microsoft Entra ID JWKS          │  │
│  │    • Validates tid (School Tenant UUID), exp, aud, and UPN             │  │
│  │    • Derives deterministic 16-digit XUID & UUIDv5 from M365 Object ID  │  │
│  └───────────────────────────────────┬────────────────────────────────────┘  │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ 3. EduJoinCodeGatekeeper (Optional Classroom Code Verification)        │  │
│  │    • Validates join code or triggers ModalFormRequestPacket challenge  │  │
│  └───────────────────────────────────┬────────────────────────────────────┘  │
│                                      ▼                                       │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ 4. DownstreamExtraDataInjector (PreClientDataSetEvent + HandshakeUtils)│  │
│  │    • Injects m365_tid, m365_upn, edu_role into extraData JsonObject    │  │
│  │    • Re-signs downstream JWT with WaterdogPE Proxy KeyPair             │  │
│  └───────────────────────────────────┬────────────────────────────────────┘  │
└──────────────────────────────────────┼───────────────────────────────────────┘
                                       │ UDP :19133 (Local Loopback)
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                  PowerNukkitX Backend Server (127.0.0.1:19133)               │
│  • Verifies WaterdogPE proxy signature & reads extraData M365 claims         │
│  • PnxEduBridgePlugin maps edu_role (teacher/student) to PNX permissions     │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & Key Plugin Modules**:
  - **Gradle Build Configuration (`build.gradle.kts` & `settings.gradle.kts`)**: Configured for Java 17/21, `dev.waterdog.waterdogpe:waterdog:2.0.4-SNAPSHOT` (`repo.waterdog.dev`), `com.nimbusds:nimbus-jose-jwt` for lightweight M365 OIDC/JWKS validation on ARM64, and ShadowJar tasks.
  - **`EduBridgePlugin` (Main Class)**: Initializes `EduBridgeConfig`, warms up the asynchronous `M365JwksCache` (bounded thread pool sized for Raspberry Pi 4's 4 Cortex-A72 cores), and registers event listeners on WaterdogPE's `EventManager`.
  - **`EduLoginInterceptor` & `PreClientDataSetEvent` Handler**: Captures incoming handshake data, validates M365 JWT claims (`tid`, `oid`, `upn`, `roles`), synthesizes a deterministic Xbox-compatible `xuid` (so PowerNukkitX player data saves cleanly without collisions), and mutates `PreClientDataSetEvent.getExtraData()`.
  - **`DownstreamForwardingListener`**: Hooks `PlayerAuthenticatedEvent`, `ServerTransferRequestEvent`, and `InitialServerConnectedEvent` to ensure custom `LoginData` and signed `extraData` are transmitted to PowerNukkitX on port `19133`, plus optional classroom join-code modal verification via `ModalFormRequestPacket`.
  - **`PnxEduBridgeListener` (PowerNukkitX Companion Class)**: Demonstrates how PowerNukkitX reads the forwarded `m365_upn`, `m365_tenant_id`, and `edu_role` from the WaterdogPE login chain to grant teacher/operator permissions automatically.

- **Interactive Component & State Mapping (Web Workbench)**:
  - **Code & Repository Browser**: Interactive file selector switching across all Gradle, YAML, and Java source files with live search, line numbers, and single-click copy/download handlers.
  - **Live Configurator (`config.yml` & `waterdog.yml` Generator)**: Interactive form inputs for Tenant IDs, Join Code sequence, Downstream Host/Port (`127.0.0.1:19133`), and XUID derivation salt—mutating the generated YAML and Java constants in real time.
  - **Packet & JWT Handshake Simulator**: Interactive test bench where users can toggle between a *Retail Xbox Client*, a *Valid School M365 Education Client*, and an *Unauthorized External Tenant Client*, watching the 4-stage pipeline inspect the JWT header/claims, compute the deterministic XUID, and output the exact downstream `extraData` JSON sent to PowerNukkitX.
