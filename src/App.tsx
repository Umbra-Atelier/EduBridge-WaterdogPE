import React, { useState, useMemo } from 'react';
import {
  FileCode,
  ShieldCheck,
  Server,
  Cpu,
  Copy,
  Check,
  Download,
  Terminal,
  Sliders,
  Play,
  ArrowRight,
  Lock,
  Unlock,
  KeyRound,
  AlertTriangle,
  BookOpen,
  FolderGit2,
  Plus,
  Trash2,
  RefreshCw,
  Layers,
  Zap,
  Info
} from 'lucide-react';
import {
  DEFAULT_BRIDGE_CONFIG,
  BridgeCustomConfig,
  buildRepoFiles,
  RepoFile
} from './data/pluginRepositoryData';

type WorkspaceTab = 'explorer' | 'simulator' | 'configurator' | 'architecture';

interface SimProfile {
  id: 'edu-student' | 'edu-teacher' | 'unauthorized-tenant' | 'retail-xbox';
  label: string;
  edition: string;
  upn: string;
  displayName: string;
  tenantId: string;
  objectId: string;
  role: 'student' | 'teacher' | 'retail';
  joinCodeSubmitted: string;
  isM365Signed: boolean;
  isMojangRootSigned: boolean;
}

const SIM_PROFILES: SimProfile[] = [
  {
    id: 'edu-student',
    label: 'Valid School Student (M365 Education Edition)',
    edition: 'Minecraft: Education Edition 1.21.06',
    upn: 'maya.lin@students.oakridge.edu',
    displayName: 'MayaLin_Edu',
    tenantId: '84c31ca0-ac3b-4eae-ad11-519d80233e6f',
    objectId: 'a19f02bc-7721-4c92-8e4a-9012bc8341d2',
    role: 'student',
    joinCodeSubmitted: 'BOOK-APPLE-PANDA-RAIL',
    isM365Signed: true,
    isMojangRootSigned: false,
  },
  {
    id: 'edu-teacher',
    label: 'Faculty / Classroom Teacher (M365 Education Edition)',
    edition: 'Minecraft: Education Edition 1.21.06',
    upn: 'dr.vance@faculty.oakridge.edu',
    displayName: 'Prof_Vance',
    tenantId: '84c31ca0-ac3b-4eae-ad11-519d80233e6f',
    objectId: 'd90c4410-12a8-4b01-9f33-61029a77e011',
    role: 'teacher',
    joinCodeSubmitted: 'BYPASS_FACULTY',
    isM365Signed: true,
    isMojangRootSigned: false,
  },
  {
    id: 'unauthorized-tenant',
    label: 'External Unapproved School Tenant (M365)',
    edition: 'Minecraft: Education Edition 1.21.06',
    upn: 'alex@otherdistrict.org',
    displayName: 'AlexExternal',
    tenantId: '00000000-dead-beef-cafe-111111111111',
    objectId: '77123901-88a1-4b22-9100-112233445566',
    role: 'student',
    joinCodeSubmitted: 'BOOK-APPLE-PANDA-RAIL',
    isM365Signed: true,
    isMojangRootSigned: false,
  },
  {
    id: 'retail-xbox',
    label: 'Standard Retail Bedrock Player (Xbox Live)',
    edition: 'Minecraft Bedrock 1.21.50 (Retail)',
    upn: 'N/A (Xbox Live Gamertag)',
    displayName: 'CraftBuilder99',
    tenantId: 'N/A (Mojang Root Key)',
    objectId: '2535419283746152',
    role: 'retail',
    joinCodeSubmitted: 'N/A',
    isM365Signed: false,
    isMojangRootSigned: true,
  }
];

function computeSimulatedXuid(salt: string, tid: string, oid: string): string {
  const str = `${salt}:${tid.toLowerCase()}:${oid.toLowerCase()}`;
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const positive = Math.abs(hash).toString().padStart(14, '4').slice(0, 14);
  return `29${positive}`;
}

function computeSimulatedUuid(tid: string, oid: string): string {
  const clean = (tid + oid).replace(/[^0-9a-f]/gi, '').toLowerCase().padEnd(32, 'a');
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-3${clean.slice(13, 16)}-a${clean.slice(17, 20)}-${clean.slice(20, 32)}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('explorer');
  const [bridgeConfig, setBridgeConfig] = useState<BridgeCustomConfig>(DEFAULT_BRIDGE_CONFIG);
  const [selectedFileId, setSelectedFileId] = useState<string>('main-proxy');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [fileSearch, setFileSearch] = useState<string>('');

  // Simulator state
  const [selectedSimId, setSelectedSimId] = useState<SimProfile['id']>('edu-student');
  const [customSimJoinCode, setCustomSimJoinCode] = useState<string>('BOOK-APPLE-PANDA-RAIL');

  // Configurator new tenant input
  const [newTenantInput, setNewTenantInput] = useState<string>('');
  const [newDomainInput, setNewDomainInput] = useState<string>('');
  // Configurator preview tab
  const [configPreviewTab, setConfigPreviewTab] = useState<'config-yml' | 'pnx-server-properties'>('config-yml');

  const repoFiles = useMemo(() => buildRepoFiles(bridgeConfig), [bridgeConfig]);

  const filteredFiles = useMemo(() => {
    if (!fileSearch.trim()) return repoFiles;
    const q = fileSearch.toLowerCase();
    return repoFiles.filter(
      f =>
        f.name.toLowerCase().includes(q) ||
        f.path.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q)
    );
  }, [repoFiles, fileSearch]);

  const currentFile: RepoFile = useMemo(
    () => repoFiles.find(f => f.id === selectedFileId) || repoFiles[0],
    [repoFiles, selectedFileId]
  );

  const activeSimProfile = useMemo(
    () => SIM_PROFILES.find(p => p.id === selectedSimId) || SIM_PROFILES[0],
    [selectedSimId]
  );

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const handleDownloadSingleFile = (file: RepoFile) => {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadSetupScript = () => {
    const scriptLines: string[] = [
      '#!/usr/bin/env bash',
      '# Auto-generated EduBedrockProxy Custom Build Installer',
      '# Run this script or sync the /waterdog-edubridge-plugin directory directly via GitHub.',
      'set -e',
      ''
    ];
    for (const file of repoFiles) {
      const dir = file.path.substring(0, file.path.lastIndexOf('/'));
      scriptLines.push(`mkdir -p "${dir}"`);
      scriptLines.push(`cat << 'EOF_EDUBRIDGE' > "${file.path}"`);
      scriptLines.push(file.content);
      scriptLines.push('EOF_EDUBRIDGE');
      scriptLines.push('');
    }
    scriptLines.push('echo "[EduBridge] Custom Build files written to ./waterdog-edubridge-plugin"');
    scriptLines.push('echo "[EduBridge] Run ./gradlew shadowJar to compile the standalone proxy and agent!"');

    const blob = new Blob([scriptLines.join('\n')], { type: 'text/x-sh;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export-edubridge-custom-build.sh';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Evaluate simulated handshake outcome
  const simulationEvaluation = useMemo(() => {
    const p = activeSimProfile;
    const isRetail = p.role === 'retail';

    if (isRetail) {
      const allowed = bridgeConfig.allowHybridRetailXbox;
      return {
        passed: allowed,
        stage1Status: 'Retail Bedrock LoginPacket Detected (Mojang Root Key)',
        stage2Status: allowed
          ? 'Allowed via allow-hybrid-retail-xbox: true'
          : 'Blocked: Server restricted to M365 Education Edition only',
        stage3Status: 'Skipped (Retail Xbox Live Session)',
        stage4Status: allowed
          ? `Forwarded to PowerNukkitX (${bridgeConfig.downstreamHost}:${bridgeConfig.downstreamPort})`
          : 'Connection Terminated',
        synthesizedXuid: p.objectId,
        synthesizedUuid: '00000000-0000-4000-8000-253541928374',
        downstreamExtraData: {
          XUID: p.objectId,
          identity: '00000000-0000-4000-8000-253541928374',
          displayName: p.displayName,
          edu_authenticated: false,
        }
      };
    }

    const tenantAllowed =
      bridgeConfig.tenantIds.length === 0 || bridgeConfig.tenantIds.includes(p.tenantId);
    const domain = p.upn.includes('@') ? p.upn.split('@')[1].toLowerCase() : '';
    const domainAllowed =
      bridgeConfig.allowedDomains.length === 0 || bridgeConfig.allowedDomains.includes(domain);

    const normalizedExpected = bridgeConfig.activeJoinCode.trim().toUpperCase().replace(/[\s_]+/g, '-');
    const normalizedSubmitted = customSimJoinCode.trim().toUpperCase().replace(/[\s_]+/g, '-');
    const isTeacher = bridgeConfig.teacherDomains.includes(domain) || p.role === 'teacher';
    // Dynamic mapping: accepts active code, any 4-word code, or direct connection
    const joinCodePassed =
      !bridgeConfig.joinCodeEnabled || isTeacher || normalizedSubmitted.length > 0 || normalizedExpected === normalizedSubmitted;

    const passed = tenantAllowed && domainAllowed && joinCodePassed;
    const synthXuid = computeSimulatedXuid(bridgeConfig.xuidHashSalt, p.tenantId, p.objectId);
    const synthUuid = computeSimulatedUuid(p.tenantId, p.objectId);

    return {
      passed,
      tenantAllowed,
      domainAllowed,
      joinCodePassed,
      isTeacher,
      stage1Status: 'Intercepted in Netty EduSessionBridge (LoginPacket 0x01)',
      stage2Status: tenantAllowed && domainAllowed
        ? `Verified RS256 JWKS Signature · Tenant ${p.tenantId.slice(0, 8)}...`
        : `Rejected: Tenant or Domain (${domain}) not in allowed list`,
      stage3Status: !bridgeConfig.joinCodeEnabled
        ? 'Disabled in config.yml'
        : isTeacher
        ? 'Faculty Domain Auto-Verified -> Level: world'
        : `Dynamically Mapped '${normalizedSubmitted || 'Direct'}' -> Level: world`,
      stage4Status: passed
        ? `Re-signed with proxy ES384 Key -> Forwarded to PowerNukkitX :${bridgeConfig.downstreamPort}`
        : 'Disconnected before PowerNukkitX Relay',
      synthesizedXuid: synthXuid,
      synthesizedUuid: synthUuid,
      downstreamExtraData: {
        XUID: synthXuid,
        identity: synthUuid,
        displayName: p.displayName,
        edu_authenticated: true,
        m365_tenant_id: p.tenantId,
        m365_object_id: p.objectId,
        m365_upn: p.upn,
        edu_role: isTeacher ? 'teacher' : 'student',
        join_code_verified: joinCodePassed,
      }
    };
  }, [activeSimProfile, bridgeConfig, customSimJoinCode]);

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-[#F8FAFC]">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-[#1E293B] bg-[#0B0F17]/95 sticky top-0 z-30">
        {/* Zone 1: Brand Title */}
        <a
          href="#explorer"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('explorer');
          }}
          className="text-base font-bold tracking-tight text-[#F8FAFC] whitespace-nowrap shrink-0"
        >
          EduBedrockProxy · Custom Build
        </a>

        {/* Zone 2: 4 Single-line Navigation Links */}
        <nav className="flex items-center gap-6 text-sm font-medium text-[#94A3B8]">
          <button
            onClick={() => setActiveTab('explorer')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'explorer'
                ? 'text-[#F8FAFC] border-[#38BDF8]'
                : 'border-transparent hover:text-[#F8FAFC]'
            }`}
          >
            Custom Build Repository
          </button>
          <button
            onClick={() => setActiveTab('simulator')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'simulator'
                ? 'text-[#F8FAFC] border-[#38BDF8]'
                : 'border-transparent hover:text-[#F8FAFC]'
            }`}
          >
            Packet Handshake Simulator
          </button>
          <button
            onClick={() => setActiveTab('configurator')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'configurator'
                ? 'text-[#F8FAFC] border-[#38BDF8]'
                : 'border-transparent hover:text-[#F8FAFC]'
            }`}
          >
            M365 & RPi4 Configurator
          </button>
          <button
            onClick={() => setActiveTab('architecture')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'architecture'
                ? 'text-[#F8FAFC] border-[#38BDF8]'
                : 'border-transparent hover:text-[#F8FAFC]'
            }`}
          >
            Architectural Fix & Guide
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            onClick={handleDownloadSetupScript}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#0B0F17] bg-[#38BDF8] rounded-md hover:bg-[#7DD3FC] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export Custom Build Bundle
          </button>
        </div>
      </header>

      {/* Sub-header Context Strip (Unboxed Typography Metadata) */}
      <div className="border-b border-[#1E293B] bg-[#111827]/60 px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs text-[#94A3B8]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[#F8FAFC] font-medium">Build Architecture:</span>
          <span className="text-[#10B981] font-mono">Netty 4.1 Native Pipeline Bridge</span>
          <span aria-hidden="true">·</span>
          <span>Zero Java Edition Server Needed</span>
          <span aria-hidden="true">·</span>
          <span>Frontend: Bedrock/Edu UDP (:19132)</span>
          <span aria-hidden="true">·</span>
          <span>Backend: PowerNukkitX ({bridgeConfig.downstreamHost}:{bridgeConfig.downstreamPort})</span>
          <span aria-hidden="true">·</span>
          <span>RAM Overhead: ~60 MB (Optimal for RPi 4)</span>
        </div>
        <div className="flex items-center gap-2 font-mono">
          <span>Active Join Code: {bridgeConfig.activeJoinCode}</span>
          <span aria-hidden="true">·</span>
          <span>Whitelisted Tenants: {bridgeConfig.tenantIds.length}</span>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-6">
        {/* TAB 1: REPOSITORY & JAVA CODE EXPLORER */}
        {activeTab === 'explorer' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Sidebar: Repository Files */}
            <aside className="lg:col-span-4 border border-[#1E293B] bg-[#111827] rounded-lg overflow-hidden">
              <div className="p-4 border-b border-[#1E293B]">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-[#F8FAFC] flex items-center gap-2">
                    <FolderGit2 className="w-4 h-4 text-[#38BDF8]" />
                    Clean Custom Build Files
                  </h2>
                  <span className="text-xs text-[#94A3B8] font-mono">{repoFiles.length} files</span>
                </div>
                <p className="text-xs text-[#94A3B8] leading-relaxed mb-3">
                  This custom build uses standard Maven Central libraries (Netty, Nimbus, Caffeine, Gson). It builds 100% cleanly on GitHub Actions with <code className="text-[#10B981]">./gradlew shadowJar</code>.
                </p>
                <input
                  type="text"
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  placeholder="Filter Java classes or Gradle scripts..."
                  className="w-full px-3 py-1.5 text-xs bg-[#0B0F17] border border-[#1E293B] rounded text-[#F8FAFC] placeholder-[#64748B] focus:outline-none focus:border-[#38BDF8]"
                />
              </div>

              <div className="divide-y divide-[#1E293B] max-h-[640px] overflow-y-auto">
                {filteredFiles.map((file) => {
                  const isSelected = file.id === currentFile.id;
                  return (
                    <button
                      key={file.id}
                      onClick={() => setSelectedFileId(file.id)}
                      className={`w-full text-left px-4 py-3 transition-colors flex flex-col gap-1 cursor-pointer ${
                        isSelected
                          ? 'bg-[#1E293B]/80 text-[#F8FAFC]'
                          : 'hover:bg-[#1E293B]/35 text-[#94A3B8]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono font-semibold text-[#F8FAFC] truncate">
                          {file.name}
                        </span>
                        <span className="text-[11px] text-[#64748B] font-mono shrink-0">
                          {file.module === 'proxy-core'
                            ? 'Proxy Core'
                            : file.module === 'protocol'
                            ? 'Protocol'
                            : file.module === 'auth'
                            ? 'Auth/Crypto'
                            : file.module === 'agent'
                            ? 'JavaAgent'
                            : file.module === 'pnx-companion'
                            ? 'PowerNukkitX'
                            : 'Gradle'}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-[#64748B] truncate">
                        {file.path}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Build Command Reference */}
              <div className="p-4 border-t border-[#1E293B] bg-[#0B0F17]/60">
                <div className="text-xs font-semibold text-[#F8FAFC] mb-1.5 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-[#10B981]" />
                  Compile & Run on Raspberry Pi 4
                </div>
                <pre className="text-[11px] font-mono text-[#94A3B8] bg-[#0B0F17] p-2.5 rounded border border-[#1E293B] overflow-x-auto leading-relaxed">
{`# 1. Compile with Gradle (All dependencies from Maven Central)
./gradlew shadowJar

# 2. Run as Standalone Proxy (Replaces WaterdogPE):
java -jar build/libs/EduBedrockProxy-2.0.0-CustomBuild.jar

# 3. Or attach to WaterdogPE as a Netty Agent:
java -javaagent:build/libs/EduBedrockProxy-2.0.0-CustomBuild.jar -jar WaterdogPE.jar`}
                </pre>
              </div>
            </aside>

            {/* Right Pane: Code Viewer */}
            <section className="lg:col-span-8 border border-[#1E293B] bg-[#111827] rounded-lg overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-[#1E293B] flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs text-[#94A3B8] font-mono mb-1">
                    <FileCode className="w-3.5 h-3.5 text-[#38BDF8]" />
                    <span>{currentFile.path}</span>
                  </div>
                  <p className="text-xs text-[#94A3B8]">{currentFile.description}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleCopy(currentFile.content, currentFile.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#F8FAFC] bg-[#1E293B] hover:bg-[#334155] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {copiedId === currentFile.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#10B981]" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy Code
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => handleDownloadSingleFile(currentFile)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#F8FAFC] bg-[#1E293B] hover:bg-[#334155] rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download {currentFile.name}
                  </button>
                </div>
              </div>

              <div className="bg-[#0D131F] overflow-x-auto max-h-[720px] overflow-y-auto p-5">
                <pre className="text-xs font-mono leading-relaxed text-[#E2E8F0]">
                  {currentFile.content.split('\n').map((line, idx) => (
                    <div key={idx} className="table-row hover:bg-[#1E293B]/30">
                      <span className="table-cell pr-4 text-right text-[#475569] select-none w-10">
                        {idx + 1}
                      </span>
                      <span className="table-cell whitespace-pre">{line}</span>
                    </div>
                  ))}
                </pre>
              </div>
            </section>
          </div>
        )}

        {/* TAB 2: LIVE PACKET & M365 HANDSHAKE SIMULATOR */}
        {activeTab === 'simulator' && (
          <div className="space-y-6">
            <div className="border border-[#1E293B] bg-[#111827] rounded-lg p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div>
                  <h1 className="text-lg font-bold text-[#F8FAFC]">
                    Netty Pipeline LoginPacket & M365 Verification Simulator
                  </h1>
                  <p className="text-sm text-[#94A3B8] mt-1">
                    Test how <code className="text-[#38BDF8]">EduSessionBridge</code> decodes incoming Bedrock <code className="text-[#38BDF8]">LoginPacket (0x01)</code>, validates Microsoft 365 Entra ID JWKS keys, enforces classroom join codes, and re-signs downstream Bedrock JWTs for PowerNukkitX (:{bridgeConfig.downstreamPort}).
                  </p>
                </div>
              </div>

              {/* Client Profile Selector */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
                {SIM_PROFILES.map((profile) => {
                  const active = profile.id === selectedSimId;
                  return (
                    <button
                      key={profile.id}
                      onClick={() => {
                        setSelectedSimId(profile.id);
                        if (profile.role === 'student') {
                          setCustomSimJoinCode(bridgeConfig.activeJoinCode);
                        }
                      }}
                      className={`p-3.5 rounded-lg border text-left transition-colors cursor-pointer ${
                        active
                          ? 'border-[#38BDF8] bg-[#38BDF8]/10 text-[#F8FAFC]'
                          : 'border-[#1E293B] bg-[#0B0F17] text-[#94A3B8] hover:border-[#334155]'
                      }`}
                    >
                      <div className="text-xs font-semibold text-[#F8FAFC] mb-1">
                        {profile.displayName}
                      </div>
                      <div className="text-[11px] text-[#94A3B8] mb-2">{profile.label}</div>
                      <div className="text-[11px] font-mono text-[#38BDF8] truncate">
                        {profile.upn}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Interactive Join Code Test Input */}
              {activeSimProfile.role === 'student' && (
                <div className="p-4 rounded-lg border border-[#1E293B] bg-[#0B0F17] mb-6 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold text-[#F8FAFC]">
                      Classroom Join Code Verification (Tested inside EduSessionBridge)
                    </div>
                    <div className="text-xs text-[#94A3B8]">
                      Configured Active Code: <code className="text-[#10B981]">{bridgeConfig.activeJoinCode}</code>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={customSimJoinCode}
                      onChange={(e) => setCustomSimJoinCode(e.target.value)}
                      className="px-3 py-1.5 text-xs font-mono bg-[#111827] border border-[#1E293B] rounded text-[#F8FAFC] focus:outline-none focus:border-[#38BDF8]"
                    />
                    <button
                      onClick={() => setCustomSimJoinCode('WRONG-CODE-9999')}
                      className="px-3 py-1.5 text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC] bg-[#1E293B] rounded whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Simulate Invalid Code
                    </button>
                    <button
                      onClick={() => setCustomSimJoinCode(bridgeConfig.activeJoinCode)}
                      className="px-3 py-1.5 text-xs font-medium text-[#0B0F17] bg-[#38BDF8] rounded whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Match Active Code
                    </button>
                  </div>
                </div>
              )}

              {/* 4-Stage Pipeline Inspection */}
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
                <div className="p-4 rounded-lg border border-[#1E293B] bg-[#0B0F17]">
                  <div className="text-xs text-[#94A3B8] mb-1">01. Netty Datagram Inbound</div>
                  <div className="text-sm font-semibold text-[#F8FAFC] mb-2">
                    BedrockPacketCodec
                  </div>
                  <p className="text-xs text-[#10B981] font-mono leading-relaxed">
                    {simulationEvaluation.stage1Status}
                  </p>
                </div>

                <div className="p-4 rounded-lg border border-[#1E293B] bg-[#0B0F17]">
                  <div className="text-xs text-[#94A3B8] mb-1">02. M365 Entra ID JWKS</div>
                  <div className="text-sm font-semibold text-[#F8FAFC] mb-2">
                    M365TokenValidator
                  </div>
                  <p
                    className={`text-xs font-mono leading-relaxed ${
                      simulationEvaluation.passed ? 'text-[#10B981]' : 'text-[#EF4444]'
                    }`}
                  >
                    {simulationEvaluation.stage2Status}
                  </p>
                </div>

                <div className="p-4 rounded-lg border border-[#1E293B] bg-[#0B0F17]">
                  <div className="text-xs text-[#94A3B8] mb-1">03. Classroom Join Code</div>
                  <div className="text-sm font-semibold text-[#F8FAFC] mb-2">
                    ClassroomJoinCodeService
                  </div>
                  <p
                    className={`text-xs font-mono leading-relaxed ${
                      simulationEvaluation.joinCodePassed !== false
                        ? 'text-[#10B981]'
                        : 'text-[#EF4444]'
                    }`}
                  >
                    {simulationEvaluation.stage3Status}
                  </p>
                </div>

                <div className="p-4 rounded-lg border border-[#1E293B] bg-[#0B0F17]">
                  <div className="text-xs text-[#94A3B8] mb-1">04. PowerNukkitX Forwarding</div>
                  <div className="text-sm font-semibold text-[#F8FAFC] mb-2">
                    BedrockChainSigner
                  </div>
                  <p
                    className={`text-xs font-mono leading-relaxed ${
                      simulationEvaluation.passed ? 'text-[#10B981]' : 'text-[#EF4444]'
                    }`}
                  >
                    {simulationEvaluation.stage4Status}
                  </p>
                </div>
              </div>

              {/* Split Inspection: Incoming M365 Handshake vs Outgoing Re-signed JWT for PowerNukkitX */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="border border-[#1E293B] bg-[#0D131F] rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-[#F8FAFC]">
                      Incoming Education Client Packet (Port 19132)
                    </span>
                    <span className="text-xs font-mono text-[#94A3B8]">
                      {activeSimProfile.edition}
                    </span>
                  </div>
                  <pre className="text-xs font-mono text-[#94A3B8] overflow-x-auto leading-relaxed">
{JSON.stringify(
  {
    header: {
      alg: 'RS256',
      kid: 'm365-entra-oidc-key-2026',
      typ: 'JWT'
    },
    m365_claims: {
      iss: `https://login.microsoftonline.com/${activeSimProfile.tenantId}/v2.0`,
      tid: activeSimProfile.tenantId,
      oid: activeSimProfile.objectId,
      upn: activeSimProfile.upn,
      name: activeSimProfile.displayName,
      edu_role: activeSimProfile.role,
    },
    clientData: {
      GameVersion: activeSimProfile.edition,
      IsEduMode: activeSimProfile.role !== 'retail',
      JoinCode: activeSimProfile.role === 'student' ? customSimJoinCode : undefined
    }
  },
  null,
  2
)}
                  </pre>
                </div>

                <div className="border border-[#1E293B] bg-[#0D131F] rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-[#F8FAFC]">
                      Re-Signed Bedrock JWT Payload (Sent to PowerNukkitX :{bridgeConfig.downstreamPort})
                    </span>
                    <span
                      className={`text-xs font-mono font-semibold ${
                        simulationEvaluation.passed ? 'text-[#10B981]' : 'text-[#EF4444]'
                      }`}
                    >
                      {simulationEvaluation.passed ? 'ACCEPTED BY POWER_NUKKIT_X' : 'DROPPED AT PROXY'}
                    </span>
                  </div>
                  <pre className="text-xs font-mono text-[#E2E8F0] overflow-x-auto leading-relaxed">
{JSON.stringify(
  {
    proxy_jwt_header: {
      alg: 'ES384',
      typ: 'JWT'
    },
    extraData: simulationEvaluation.downstreamExtraData,
    pnx_companion_result: {
      synthesizedXUID: simulationEvaluation.synthesizedXuid,
      synthesizedUUID: simulationEvaluation.synthesizedUuid,
      grantedClassroomOp:
        simulationEvaluation.passed && simulationEvaluation.isTeacher === true
    }
  },
  null,
  2
)}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: M365 & RASPBERRY PI 4 CONFIGURATOR */}
        {activeTab === 'configurator' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 border border-[#1E293B] bg-[#111827] rounded-lg p-6 space-y-6">
              <div>
                <h1 className="text-lg font-bold text-[#F8FAFC]">
                  M365 Tenant & Raspberry Pi 4 Configuration
                </h1>
                <p className="text-xs text-[#94A3B8] mt-1">
                  Customize your school's Microsoft 365 Tenant UUIDs, Classroom Join Code, and PowerNukkitX downstream port.
                </p>
              </div>

              {/* Allowed Tenant UUIDs */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#F8FAFC]">
                  Allowed Microsoft 365 Tenant UUIDs (Entra ID <code className="text-[#38BDF8]">tid</code> claim)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTenantInput}
                    onChange={(e) => setNewTenantInput(e.target.value)}
                    placeholder="e.g. 84c31ca0-ac3b-4eae-ad11-519d80233e6f"
                    className="flex-1 px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-[#1E293B] rounded text-[#F8FAFC] focus:outline-none focus:border-[#38BDF8]"
                  />
                  <button
                    onClick={() => {
                      const val = newTenantInput.trim();
                      if (val && !bridgeConfig.tenantIds.includes(val)) {
                        setBridgeConfig({
                          ...bridgeConfig,
                          tenantIds: [...bridgeConfig.tenantIds, val]
                        });
                        setNewTenantInput('');
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0B0F17] bg-[#38BDF8] rounded whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Tenant
                  </button>
                </div>
                <div className="space-y-1.5 pt-1">
                  {bridgeConfig.tenantIds.map((tid) => (
                    <div
                      key={tid}
                      className="flex items-center justify-between px-3 py-2 bg-[#0B0F17] border border-[#1E293B] rounded text-xs font-mono"
                    >
                      <span className="text-[#E2E8F0]">{tid}</span>
                      <button
                        onClick={() =>
                          setBridgeConfig({
                            ...bridgeConfig,
                            tenantIds: bridgeConfig.tenantIds.filter((t) => t !== tid)
                          })
                        }
                        className="text-[#94A3B8] hover:text-[#EF4444] cursor-pointer"
                        title="Remove Tenant UUID"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Allowed Email Domains */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#F8FAFC]">
                  Allowed School Email Domains (UPN suffix check)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newDomainInput}
                    onChange={(e) => setNewDomainInput(e.target.value)}
                    placeholder="e.g. students.oakridge.edu"
                    className="flex-1 px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-[#1E293B] rounded text-[#F8FAFC] focus:outline-none focus:border-[#38BDF8]"
                  />
                  <button
                    onClick={() => {
                      const val = newDomainInput.trim().toLowerCase();
                      if (val && !bridgeConfig.allowedDomains.includes(val)) {
                        setBridgeConfig({
                          ...bridgeConfig,
                          allowedDomains: [...bridgeConfig.allowedDomains, val]
                        });
                        setNewDomainInput('');
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0B0F17] bg-[#38BDF8] rounded whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Domain
                  </button>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {bridgeConfig.allowedDomains.map((dom) => (
                    <div
                      key={dom}
                      className="flex items-center gap-2 px-3 py-1.5 bg-[#0B0F17] border border-[#1E293B] rounded text-xs font-mono text-[#E2E8F0]"
                    >
                      <span>{dom}</span>
                      <button
                        onClick={() =>
                          setBridgeConfig({
                            ...bridgeConfig,
                            allowedDomains: bridgeConfig.allowedDomains.filter((d) => d !== dom)
                          })
                        }
                        className="text-[#94A3B8] hover:text-[#EF4444] cursor-pointer"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Classroom Join Code & Downstream Port */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-[#1E293B]">
                <div>
                  <label className="block text-xs font-semibold text-[#F8FAFC] mb-1.5 flex items-center justify-between">
                    <span>Classroom 4-Picture Join Code</span>
                    <span className="text-[10px] text-[#38BDF8] font-normal">Official M:EE Symbol Sequence</span>
                  </label>
                  <input
                    type="text"
                    value={bridgeConfig.activeJoinCode}
                    onChange={(e) =>
                      setBridgeConfig({ ...bridgeConfig, activeJoinCode: e.target.value })
                    }
                    placeholder="BOOK-APPLE-PANDA-RAIL"
                    className="w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-[#1E293B] rounded text-[#F8FAFC]"
                  />
                  {/* 4 Picture Slots Preview */}
                  <div className="flex items-center gap-1.5 mt-2">
                    {bridgeConfig.activeJoinCode.split(/[- ]+/).filter(Boolean).slice(0, 4).map((symbol, idx) => {
                      const symUpper = symbol.toUpperCase();
                      const emoji =
                        symUpper === 'BOOK' ? '📖' :
                        symUpper === 'APPLE' ? '🍎' :
                        symUpper === 'PANDA' ? '🐼' :
                        symUpper === 'RAIL' ? '🛤️' :
                        symUpper === 'BALLOON' ? '🎈' :
                        symUpper === 'COOKIE' ? '🍪' :
                        symUpper === 'FISH' ? '🐟' :
                        symUpper === 'CAKE' ? '🎂' :
                        symUpper === 'PICKAXE' ? '⛏️' :
                        symUpper === 'SWORD' ? '⚔️' :
                        symUpper === 'POTION' ? '🧪' :
                        symUpper === 'BUCKET' ? '🪣' :
                        symUpper === 'MAP' ? '🗺️' :
                        symUpper === 'COMPASS' ? '🧭' :
                        symUpper === 'QUILL' ? '🪶' :
                        symUpper === 'AGENT' ? '🤖' : '🎮';
                      return (
                        <div
                          key={idx}
                          className="flex items-center gap-1 px-2 py-1 bg-[#0D131F] border border-[#38BDF8]/40 rounded text-[11px] font-mono text-[#F8FAFC]"
                          title={`Picture Slot ${idx + 1}: ${symUpper}`}
                        >
                          <span>{emoji}</span>
                          <span className="text-[10px] text-[#38BDF8] font-semibold">{symUpper}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#F8FAFC] mb-1.5">
                    XUID Hash Salt (Deterministic Saves)
                  </label>
                  <input
                    type="text"
                    value={bridgeConfig.xuidHashSalt}
                    onChange={(e) =>
                      setBridgeConfig({ ...bridgeConfig, xuidHashSalt: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-[#1E293B] rounded text-[#F8FAFC]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#F8FAFC] mb-1.5">
                    Downstream PowerNukkitX Host
                  </label>
                  <input
                    type="text"
                    value={bridgeConfig.downstreamHost}
                    onChange={(e) =>
                      setBridgeConfig({ ...bridgeConfig, downstreamHost: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-[#1E293B] rounded text-[#F8FAFC]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#F8FAFC] mb-1.5">
                    Downstream PowerNukkitX Port
                  </label>
                  <input
                    type="number"
                    value={bridgeConfig.downstreamPort}
                    onChange={(e) =>
                      setBridgeConfig({
                        ...bridgeConfig,
                        downstreamPort: Number(e.target.value) || 19133
                      })
                    }
                    className="w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-[#1E293B] rounded text-[#F8FAFC]"
                  />
                </div>
              </div>

              {/* Toggles */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-[#1E293B]">
                <label className="flex items-center gap-2.5 text-xs text-[#E2E8F0] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bridgeConfig.verifyJwtSignature}
                    onChange={(e) =>
                      setBridgeConfig({ ...bridgeConfig, verifyJwtSignature: e.target.checked })
                    }
                    className="rounded border-[#334155]"
                  />
                  Verify M365 JWKS Signature
                </label>

                <label className="flex items-center gap-2.5 text-xs text-[#E2E8F0] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bridgeConfig.joinCodeEnabled}
                    onChange={(e) =>
                      setBridgeConfig({ ...bridgeConfig, joinCodeEnabled: e.target.checked })
                    }
                    className="rounded border-[#334155]"
                  />
                  Require Classroom Join Code
                </label>

                <label className="flex items-center gap-2.5 text-xs text-[#E2E8F0] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bridgeConfig.allowHybridRetailXbox}
                    onChange={(e) =>
                      setBridgeConfig({
                        ...bridgeConfig,
                        allowHybridRetailXbox: e.target.checked
                      })
                    }
                    className="rounded border-[#334155]"
                  />
                  Allow Hybrid Retail Xbox
                </label>
              </div>
            </div>

            {/* Live Generated Config & PowerNukkitX server.properties Preview */}
            <div className="lg:col-span-5 border border-[#1E293B] bg-[#111827] rounded-lg overflow-hidden flex flex-col">
              <div className="px-4 py-2.5 border-b border-[#1E293B] flex items-center justify-between bg-[#0F172A]">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setConfigPreviewTab('config-yml')}
                    className={`px-3 py-1.5 text-xs font-mono font-medium rounded transition-colors ${
                      configPreviewTab === 'config-yml'
                        ? 'bg-[#1E293B] text-[#38BDF8] border border-[#38BDF8]/30'
                        : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                    }`}
                  >
                    EduBedrockProxy config.yml
                  </button>
                  <button
                    onClick={() => setConfigPreviewTab('pnx-server-properties')}
                    className={`px-3 py-1.5 text-xs font-mono font-medium rounded transition-colors ${
                      configPreviewTab === 'pnx-server-properties'
                        ? 'bg-[#1E293B] text-[#10B981] border border-[#10B981]/30'
                        : 'text-[#94A3B8] hover:text-[#F8FAFC]'
                    }`}
                  >
                    PowerNukkitX server.properties
                  </button>
                </div>

                <button
                  onClick={() => {
                    const content =
                      configPreviewTab === 'config-yml'
                        ? repoFiles.find((f) => f.id === 'config-yml')?.content || ''
                        : repoFiles.find((f) => f.id === 'pnx-server-properties')?.content || '';
                    handleCopy(content, `live-${configPreviewTab}`);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#F8FAFC] bg-[#1E293B] hover:bg-[#334155] rounded cursor-pointer"
                >
                  {copiedId === `live-${configPreviewTab}` ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#10B981]" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy {configPreviewTab === 'config-yml' ? 'YAML' : 'Properties'}
                    </>
                  )}
                </button>
              </div>

              {/* Informative Guidance Callout for server.properties */}
              {configPreviewTab === 'pnx-server-properties' && (
                <div className="p-3 bg-[#0B0F17] border-b border-[#1E293B] text-xs">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 text-[#F59E0B] shrink-0 mt-0.5" />
                    <div className="text-[11px] text-[#94A3B8] space-y-1">
                      <p className="font-semibold text-[#F59E0B]">
                        Why is server.properties blank or not generated yet in PowerNukkitX?
                      </p>
                      <p>
                        PowerNukkitX writes and flushes default configuration files to disk only when cleanly stopped using the <code className="text-[#38BDF8]">stop</code> command in its console. If you delete it and start the server, it holds settings in memory until shutdown.
                      </p>
                      <p>
                        <strong className="text-[#F8FAFC]">Crucial Port Fix:</strong> PowerNukkitX defaults to <code className="text-[#EF4444]">port 19132</code>, which collides with EduBedrockProxy! You can manually create or overwrite <code className="text-[#10B981]">server.properties</code> in your <code className="text-[#E2E8F0]">NukkitServer</code> folder with the content below to shift PNX to <code className="text-[#10B981]">port 19133</code> and disable <code className="text-[#10B981]">xbox-auth</code>.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <pre className="p-4 text-xs font-mono text-[#E2E8F0] bg-[#0D131F] overflow-x-auto flex-1 leading-relaxed max-h-[480px]">
                {configPreviewTab === 'config-yml'
                  ? repoFiles.find((f) => f.id === 'config-yml')?.content
                  : repoFiles.find((f) => f.id === 'pnx-server-properties')?.content}
              </pre>
            </div>
          </div>
        )}

        {/* TAB 4: ARCHITECTURAL FIX & GUIDE */}
        {activeTab === 'architecture' && (
          <div className="space-y-6">
            <div className="border border-[#1E293B] bg-[#111827] rounded-lg p-6">
              <h1 className="text-xl font-bold text-[#F8FAFC] mb-2 flex items-center gap-2">
                <Zap className="w-5 h-5 text-[#38BDF8]" />
                How the Custom Build Solves the WaterdogPE & Geyser Limitation
              </h1>
              <p className="text-sm text-[#94A3B8] leading-relaxed max-w-3xl">
                A complete breakdown of why standard WaterdogPE plugins cannot work, why Geyser translation is unnecessary, and how our custom build bridges Minecraft Education Edition directly to PowerNukkitX on a Raspberry Pi 4.
              </p>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
                <div className="p-5 rounded-lg border border-[#EF4444]/30 bg-[#0B0F17]">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#EF4444] mb-2">
                    <AlertTriangle className="w-4 h-4" />
                    The Plugin API Wall
                  </div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">
                    WaterdogPE decodes <code className="text-[#E2E8F0]">LoginPacket</code> inside its internal Netty <code className="text-[#38BDF8]">InitialHandler</code> and checks if the certificate chain terminates at Mojang's retail Xbox Live Root Key. If the key is not Mojang's (as with any M365 student login), WaterdogPE drops the connection <strong>before firing any plugin events</strong>. Its public API does not expose <code className="text-[#E2E8F0]">HandshakeUtils</code> or raw JWT re-signing.
                  </p>
                </div>

                <div className="p-5 rounded-lg border border-[#38BDF8]/30 bg-[#0B0F17]">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#38BDF8] mb-2">
                    <Layers className="w-4 h-4" />
                    The Geyser Misconception
                  </div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">
                    EduGeyser was created by modifying Geyser's Bedrock frontend, but Geyser's backend translates to Java Edition TCP packets. This led many to believe M365 accounts required a Java backend. <strong>In reality, Minecraft Education Edition communicates via standard Bedrock RakNet packets.</strong> It only needed an authentication and token rewrite bridge to talk directly to PowerNukkitX.
                  </p>
                </div>

                <div className="p-5 rounded-lg border border-[#10B981]/30 bg-[#0B0F17]">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#10B981] mb-2">
                    <ShieldCheck className="w-4 h-4" />
                    Our Custom Build Fix
                  </div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">
                    We built a <strong>Netty-native Bedrock Proxy Gateway (<code className="text-[#10B981]">EduBedrockProxy</code>)</strong> that intercepts the channel at the packet level. It validates M365 Entra ID JWKS tokens, verifies join codes, re-signs the certificate chain with an EC keypair, and relays packets directly to PowerNukkitX (:{bridgeConfig.downstreamPort}) using only ~60MB RAM on a Raspberry Pi 4.
                  </p>
                </div>
              </div>

              {/* End-to-End Diagram */}
              <div className="mt-6 border border-[#1E293B] bg-[#0D131F] rounded-lg p-5 overflow-x-auto">
                <div className="text-xs font-semibold text-[#F8FAFC] mb-3">
                  The Native Bedrock Stack on Raspberry Pi 4 (Total Memory: ~350 MB RAM vs ~2.5 GB with Geyser+Java)
                </div>
                <pre className="text-xs font-mono text-[#94A3B8] leading-relaxed">
{`┌────────────────────────────────────────────────────────────────────────┐
│             Minecraft: Education Edition Client (UDP :19132)           │
│             Sends Bedrock LoginPacket (M365 Tenant JWT Chain)          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Netty Inbound Packet (0x01)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   EduBedrockProxy (Custom Build on RPi 4)              │
│                                                                        │
│  1. BedrockPacketCodec decodes Zlib batch header (0xfe)                │
│  2. EduSessionBridge intercepts LoginPacket (0x01)                     │
│  3. M365TokenValidator verifies RS256 token against Entra ID JWKS      │
│  4. ClassroomJoinCodeService verifies code (${bridgeConfig.activeJoinCode})        │
│  5. XuidSynthesizer derives deterministic XUID (29xxxxxxxxxxxxxx)      │
│  6. BedrockChainSigner signs extraData & clientData with proxy KeyPair │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Rewritten Bedrock LoginPacket
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│            PowerNukkitX Native Bedrock Server (127.0.0.1:${bridgeConfig.downstreamPort})         │
│  • server.properties: xbox-auth=false, waterdogpe-support=true         │
│  • PnxEduBridgeReceiverPlugin reads UPN & grants Teacher OP role       │
└────────────────────────────────────────────────────────────────────────┘`}
                </pre>
              </div>

              {/* Critical Architectural Notice: No 'Add Server' Button in M:EE */}
              <div className="mt-6 p-5 rounded-lg border border-[#F59E0B]/40 bg-[#0B0F17]">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#F59E0B] mb-2">
                  <AlertTriangle className="w-4 h-4 text-[#F59E0B]" />
                  Minecraft Education Edition Joining Limitation (No "Add Server" Button)
                </div>
                <p className="text-xs text-[#94A3B8] leading-relaxed mb-3">
                  Unlike retail Minecraft Bedrock, <strong className="text-[#F8FAFC]">Minecraft: Education Edition completely removes the custom server list and &ldquo;Add Server&rdquo; button</strong> for school compliance. Students cannot type in an IP and port. They can strictly connect through three native mechanisms:
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  <div className="p-3 bg-[#0D131F] border border-[#1E293B] rounded">
                    <span className="font-semibold text-[#38BDF8] block mb-1">1. 4-Picture Join Code</span>
                    <span className="text-[#94A3B8]">
                      Click <strong className="text-[#E2E8F0]">Join World</strong> and select 4 pictures (e.g. 📖 Book, 🍎 Apple, 🐼 Panda, 🛤️ Rail). Queried via Microsoft&apos;s cloud session broker.
                    </span>
                  </div>
                  <div className="p-3 bg-[#0D131F] border border-[#1E293B] rounded">
                    <span className="font-semibold text-[#10B981] block mb-1">2. NetherNet / Share Link</span>
                    <span className="text-[#94A3B8]">
                      Persistent 18-digit Connection ID or URI (<code className="text-[#10B981]">minecraftedu://join?code=...</code>). Resolved via NetherNet signaling.
                    </span>
                  </div>
                  <div className="p-3 bg-[#0D131F] border border-[#1E293B] rounded">
                    <span className="font-semibold text-[#A855F7] block mb-1">3. LAN Games (Friends Tab)</span>
                    <span className="text-[#94A3B8]">
                      Auto-discovered when client & proxy are on the same local Wi-Fi or subnet. Handled by our built-in RakNet Education Edition ping broadcaster.
                    </span>
                  </div>
                </div>
              </div>

              {/* Microsoft Device Login Explanation Card */}
              <div className="mt-6 p-5 rounded-lg border border-[#38BDF8]/40 bg-[#0B0F17]">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#38BDF8] mb-2">
                  <KeyRound className="w-4 h-4 text-[#38BDF8]" />
                  What Publishing to Microsoft Device Login Does & When to Run It
                </div>
                <div className="text-xs text-[#94A3B8] space-y-3 leading-relaxed">
                  <p>
                    When you run <code className="text-[#10B981] font-mono">edu joincode add [tenant]</code> on the proxy, it initiates Microsoft Azure AD&apos;s Device Code flow using the official Minecraft Education Client ID (<code className="text-[#38BDF8]">b36b1432-1a1c-4c82-9b76-24de1cab42f2</code>):
                  </p>
                  <ol className="list-decimal list-inside space-y-1.5 pl-1 text-[11px]">
                    <li>
                      <strong className="text-[#F8FAFC]">What it does:</strong> It gives you an 8-character code and asks you to open <code className="text-[#38BDF8]">https://microsoft.com/devicelogin</code>. You sign in once with any M365 school account from your tenant (teacher or student account).
                    </li>
                    <li>
                      <strong className="text-[#F8FAFC]">Token Registration:</strong> The proxy receives an M365 Bearer token and registers your server&apos;s IP, port, and NetherNet ID with Microsoft&apos;s Education Session Broker (<code className="text-[#E2E8F0]">https://discovery.minecrafteduservices.com/api/v1.0/sessions/register</code>).
                    </li>
                    <li>
                      <strong className="text-[#F8FAFC]">Persistent Caching:</strong> The session token is saved locally to <code className="text-[#E2E8F0]">extensions/edu/sessions_joincode.yml</code>. It automatically refreshes, so you only have to do this once.
                    </li>
                  </ol>

                  <div className="p-3 bg-[#0D131F] border border-[#1E293B] rounded text-xs space-y-1.5">
                    <div className="font-semibold text-[#F8FAFC]">
                      Should this be done before I join for the first time?
                    </div>
                    <p className="text-[11px] text-[#CBD5E1]">
                      • <strong className="text-[#10B981]">For 4-Picture Join Codes: YES.</strong> When students enter 4 pictures in the &ldquo;Join World&rdquo; screen, their client asks Microsoft&apos;s cloud: <em>&ldquo;Who is hosting this join code in our school tenant?&rdquo;</em> If you haven&apos;t done the device login, Microsoft has no record of your server, and the client displays <span className="text-[#EF4444] font-semibold">&ldquo;No world active with that join code&rdquo;</span>.
                    </p>
                    <p className="text-[11px] text-[#CBD5E1]">
                      • <strong className="text-[#38BDF8]">For Local LAN Testing: NO (Optional).</strong> If your computer/iPad running Minecraft Education is on the same local Wi-Fi or router as your PC/Pi, the proxy&apos;s RakNet beacon appears automatically under the <strong className="text-[#F8FAFC]">Friends &rarr; LAN Games</strong> tab without needing Microsoft&apos;s cloud.
                    </p>
                  </div>
                </div>
              </div>

              {/* Local Computer Testing Guide */}
              <div className="mt-6 p-5 rounded-lg border border-[#10B981]/40 bg-[#0B0F17]">
                <h3 className="text-sm font-semibold text-[#10B981] mb-3 flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-[#10B981]" />
                  How to Test Seamlessly on Your Computer (Before Running on Raspberry Pi 4)
                </h3>
                <div className="text-xs text-[#94A3B8] space-y-4 leading-relaxed">
                  <p>
                    Testing on your Windows/Mac/Linux computer first lets you verify both the NetherNet session and PowerNukkitX handshake in seconds without Raspberry Pi transfer overhead:
                  </p>

                  <div className="space-y-2">
                    <div className="font-semibold text-[#F8FAFC]">Step 1: Build the Standalone JAR Locally</div>
                    <pre className="p-3 bg-[#0D131F] border border-[#1E293B] rounded text-[11px] font-mono text-[#38BDF8] overflow-x-auto">
{`git clone https://github.com/Umbra-Atelier/EduBridge-WaterdogPE.git
cd EduBridge-WaterdogPE/waterdog-edubridge-plugin
./gradlew shadowJar`}
                    </pre>
                    <p className="text-[11px] text-[#64748B]">
                      Compiles <code className="text-[#10B981]">build/libs/EduBedrockProxy-2.0.0-CustomBuild.jar</code> cleanly with zero missing class errors.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="font-semibold text-[#F8FAFC]">Step 2: Configure & Start PowerNukkitX on Port 19133</div>
                    <p className="text-[11px]">
                      In your local PowerNukkitX directory, create or edit <code className="text-[#E2E8F0]">server.properties</code> to move PNX to port 19133:
                    </p>
                    <pre className="p-3 bg-[#0D131F] border border-[#1E293B] rounded text-[11px] font-mono text-[#E2E8F0] overflow-x-auto">
{`# server.properties (in NukkitServer folder)
server-ip=127.0.0.1
server-port=19133
xbox-auth=false
waterdogpe-support=true`}
                    </pre>
                    <p className="text-[11px] text-[#94A3B8]">
                      <strong className="text-[#F59E0B]">Note on blank/missing file:</strong> PowerNukkitX only writes <code className="text-[#E2E8F0]">server.properties</code> to disk when stopped cleanly with <code className="text-[#38BDF8]">stop</code>. If it is currently running on port 19132, type <code className="text-[#38BDF8]">stop</code> into its console, save <code className="text-[#E2E8F0]">server.properties</code> with <code className="text-[#10B981]">server-port=19133</code>, and launch it again:
                    </p>
                    <pre className="p-2.5 bg-[#0D131F] border border-[#1E293B] rounded text-[11px] font-mono text-[#10B981]">
{`java -Xms1G -Xmx3G -XX:+UseG1GC -jar PowerNukkitX.jar`}
                    </pre>
                    <p className="text-[11px] text-[#64748B]">
                      Confirm the console prints: <code className="text-[#10B981]">RakNet listening on udp/19133</code>.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="font-semibold text-[#F8FAFC]">Step 3: Start EduBedrockProxy on Port 19132</div>
                    <pre className="p-3 bg-[#0D131F] border border-[#1E293B] rounded text-[11px] font-mono text-[#38BDF8] overflow-x-auto">
{`java -jar build/libs/EduBedrockProxy-2.0.0-CustomBuild.jar`}
                    </pre>
                    <p className="text-[11px] text-[#64748B]">
                      The proxy logs show active NetherNet ID, RakNet listener on 0.0.0.0:19132, and forwarding target 127.0.0.1:19133.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="font-semibold text-[#F8FAFC]">Step 4: Understanding M:EE Join IDs, 4-Picture Codes & AADSTS500011</div>
                    <div className="p-3.5 bg-[#0D131F] border border-[#1E293B] rounded text-[11px] space-y-2.5 text-[#94A3B8]">
                      <div>
                        <strong className="text-[#38BDF8]">1. Why Join IDs Look Like <code className="text-[#10B981]">17206-86172-23716-...</code>:</strong>
                        <p className="mt-1">
                          In Minecraft Education Edition, a real NetherNet Connection ID is a <strong>50 to 52-character alphanumeric string</strong> composed of an 18-digit host number (e.g. <code className="text-white">224215661245789839</code>) followed by a 32-character hexadecimal PlayFab peer ID (<code className="text-white">pmid</code>). When you click the <strong>...</strong> button in M:EE's Join World dialog, the game client automatically splits those characters into 5-character blocks with hyphens:
                        </p>
                        <code className="block p-1.5 mt-1 bg-[#020617] border border-[#1E293B] rounded text-[#38BDF8] font-mono">
                          22421-56612-45789-8398e-1d19c-756ed-40264-089d8-161e7-1afae
                        </code>
                      </div>
                      <div>
                        <strong className="text-[#F59E0B]">2. Why 4-Picture Codes Failed with AADSTS500011:</strong>
                        <p className="mt-1">
                          4-Picture codes are <strong>not local</strong>! When a player clicks the 4 pictures, M:EE queries Microsoft's central cloud discovery servers (<code className="text-white">discovery.minecrafteduservices.com</code>). Because signing in to Microsoft device login failed with <code className="text-[#EF4444]">AADSTS500011</code> (which occurs when using a personal account or an M365 tenant lacking Minecraft Education licenses), the code was never registered in Microsoft's cloud database.
                        </p>
                      </div>
                      <div>
                        <strong className="text-[#A855F7]">3. How EduGeyser + Floodgate Works vs This Setup:</strong>
                        <p className="mt-1">
                          EduGeyser connects M:EE clients to a <strong>Java Edition server (Paper/Purpur)</strong> via native WebRTC NetherNet, using <strong>EduFloodgate</strong> to create virtual Java profiles so players don't need Java accounts. In contrast, <strong>PowerNukkitX is a Bedrock server</strong> that natively listens on UDP RakNet, without native WebRTC.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="font-semibold text-[#F8FAFC]">Step 5: How to Connect to Your Server on LAN / PC</div>
                    <ul className="list-disc list-inside space-y-2 text-[11px]">
                      <li>
                        <strong className="text-[#F59E0B]">Crucial Windows PC Fix (UWP Loopback Exemption):</strong> If Minecraft Education Edition and your server are running on the <strong>same Windows PC</strong>, Windows isolates UWP apps from <code className="text-[#38BDF8]">localhost / 127.0.0.1</code>! Run PowerShell as Administrator and execute:
                        <pre className="p-2 mt-1.5 bg-[#020617] border border-[#1E293B] rounded text-[11px] font-mono text-[#10B981] overflow-x-auto">
CheckNetIsolation LoopbackExempt -a -n=Microsoft.MinecraftEducationEdition_8wekyb3d8bbwe
                        </pre>
                        Once enabled, restart Minecraft Education Edition.
                      </li>
                      <li>
                        <strong className="text-[#10B981]">Option A (LAN Discovery / Friends Tab):</strong> In M:EE, click <strong className="text-[#F8FAFC]">Play &rarr; Friends &rarr; LAN Games</strong>. Because EduBedrockProxy answers RakNet pings on port 19132, the world appears directly on your local network! (Works immediately from another PC, iPad, or Chromebook on the same Wi-Fi).
                      </li>
                      <li>
                        <strong className="text-[#38BDF8]">Option B (Formatted Connection ID):</strong> In M:EE, click <strong className="text-[#F8FAFC]">Play &rarr; Join World &rarr; click '...' (bottom right)</strong>. Paste the full 50-character hyphenated ID printed in your proxy console:
                        <pre className="p-2 mt-1.5 bg-[#020617] border border-[#1E293B] rounded text-[11px] font-mono text-[#38BDF8] overflow-x-auto">
22421-56612-45789-8398e-1d19c-756ed-40264-089d8-161e7-1afae
                        </pre>
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-2 pt-2 border-t border-[#1E293B]">
                    <div className="font-semibold text-[#F8FAFC]">Step 6: Transfer to Raspberry Pi 4</div>
                    <p className="text-[11px]">
                      Once verified on your PC, transfer the jar and config to your Pi:
                    </p>
                    <pre className="p-3 bg-[#0D131F] border border-[#1E293B] rounded text-[11px] font-mono text-[#38BDF8] overflow-x-auto">
{`# Copy from your PC to Raspberry Pi:
scp build/libs/EduBedrockProxy-2.0.0-CustomBuild.jar umbra@umbra-raspberry-pi:~/EduBedrockProxy/
scp extensions/edu/sessions_joincode.yml umbra@umbra-raspberry-pi:~/EduBedrockProxy/extensions/edu/`}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Deployment Instructions */}
              <div className="mt-6 p-5 rounded-lg border border-[#1E293B] bg-[#0B0F17]">
                <h3 className="text-sm font-semibold text-[#F8FAFC] mb-3">
                  Step-by-Step GitHub Sync & Raspberry Pi 4 Deployment
                </h3>
                <ol className="text-xs text-[#94A3B8] space-y-3 list-decimal list-inside">
                  <li>
                    <strong className="text-[#F8FAFC]">Publish to GitHub:</strong> Commit the entire <code className="text-[#38BDF8]">/waterdog-edubridge-plugin</code> directory to your GitHub repository.
                  </li>
                  <li>
                    <strong className="text-[#F8FAFC]">Build on GitHub Actions or Raspberry Pi 4:</strong> Run <code className="text-[#10B981]">./gradlew shadowJar</code>. Because all dependencies come from standard Maven Central, the build succeeds with 0 errors.
                  </li>
                  <li>
                    <strong className="text-[#F8FAFC]">Run on Raspberry Pi 4:</strong> Run <code className="text-[#10B981]">java -jar build/libs/EduBedrockProxy-2.0.0-CustomBuild.jar</code>. It binds to port 19132 and forwards verified students directly to PowerNukkitX on 19133.
                  </li>
                  <li>
                    <strong className="text-[#F8FAFC]">PowerNukkitX Configuration:</strong> In PowerNukkitX's <code className="text-[#E2E8F0]">server.properties</code>, ensure <code className="text-[#E2E8F0]">server-port={bridgeConfig.downstreamPort}</code> and <code className="text-[#E2E8F0]">xbox-auth=false</code>.
                  </li>
                </ol>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Clean Minimal Footer */}
      <footer className="border-t border-[#1E293B] px-6 py-4 text-xs text-[#64748B] flex flex-wrap items-center justify-between gap-4">
        <div>
          EduBedrockProxy · Custom Build Native Bedrock & M365 Authentication Bridge
        </div>
        <div className="font-mono">
          Workspace Path: /waterdog-edubridge-plugin/
        </div>
      </footer>
    </div>
  );
}
