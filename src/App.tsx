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
  RefreshCw
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
  const [selectedFileId, setSelectedFileId] = useState<string>('main-plugin');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [fileSearch, setFileSearch] = useState<string>('');

  // Simulator state
  const [selectedSimId, setSelectedSimId] = useState<SimProfile['id']>('edu-student');
  const [customSimJoinCode, setCustomSimJoinCode] = useState<string>('BOOK-APPLE-PANDA-RAIL');

  // Configurator new tenant input
  const [newTenantInput, setNewTenantInput] = useState<string>('');
  const [newDomainInput, setNewDomainInput] = useState<string>('');

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
      '# Auto-generated EduBridge-WaterdogPE Repository Installer',
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
    scriptLines.push('echo "[EduBridge] All Java & Gradle files written to ./waterdog-edubridge-plugin"');

    const blob = new Blob([scriptLines.join('\n')], { type: 'text/x-sh;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export-edubridge-repo.sh';
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
        stage1Status: 'Retail LoginPacket Detected (Mojang Root Key)',
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
    const joinCodePassed =
      !bridgeConfig.joinCodeEnabled || isTeacher || normalizedExpected === normalizedSubmitted;

    const passed = tenantAllowed && domainAllowed && joinCodePassed;
    const synthXuid = computeSimulatedXuid(bridgeConfig.xuidHashSalt, p.tenantId, p.objectId);
    const synthUuid = computeSimulatedUuid(p.tenantId, p.objectId);

    return {
      passed,
      tenantAllowed,
      domainAllowed,
      joinCodePassed,
      isTeacher,
      stage1Status: 'Intercepted in PreClientDataSetEvent (Bypassed Mojang Root Key reject)',
      stage2Status: tenantAllowed && domainAllowed
        ? `Verified RS256 JWKS Signature · Tenant ${p.tenantId.slice(0, 8)}...`
        : `Rejected: Tenant or Domain (${domain}) not in allowed list`,
      stage3Status: !bridgeConfig.joinCodeEnabled
        ? 'Disabled in config.yml'
        : isTeacher
        ? 'Teacher Faculty Domain Auto-Verified'
        : joinCodePassed
        ? `Join Code Match (${normalizedSubmitted})`
        : `Join Code Mismatch (Expected ${normalizedExpected})`,
      stage4Status: passed
        ? `Signed with WaterdogPE KeyPair -> Sent to ${bridgeConfig.downstreamHost}:${bridgeConfig.downstreamPort}`
        : 'Disconnected before PowerNukkitX Transfer',
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
          EduBridge-WaterdogPE
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
            Plugin Repository
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
            Xbox-Auth Bypass Guide
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            onClick={handleDownloadSetupScript}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-[#0B0F17] bg-[#38BDF8] rounded-md hover:bg-[#7DD3FC] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export Repository Bundle
          </button>
        </div>
      </header>

      {/* Sub-header Context Strip (Unboxed Typography Metadata) */}
      <div className="border-b border-[#1E293B] bg-[#111827]/60 px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs text-[#94A3B8]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[#F8FAFC] font-medium">Workspace Path:</span>
          <code className="text-[#38BDF8]">/waterdog-edubridge-plugin/</code>
          <span aria-hidden="true">·</span>
          <span>Target Proxy: WaterdogPE 2.0.4 (:19132)</span>
          <span aria-hidden="true">·</span>
          <span>Downstream Backend: PowerNukkitX ({bridgeConfig.downstreamHost}:{bridgeConfig.downstreamPort})</span>
          <span aria-hidden="true">·</span>
          <span>Hardware Profile: Raspberry Pi 4 ARM64 ({bridgeConfig.asyncVerifierThreads} Verifier Threads)</span>
        </div>
        <div className="flex items-center gap-2 font-mono">
          <span>Active Join Code: {bridgeConfig.activeJoinCode}</span>
          <span aria-hidden="true">·</span>
          <span>Tenants Whitelisted: {bridgeConfig.tenantIds.length}</span>
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
                    GitHub-Ready Repository Files
                  </h2>
                  <span className="text-xs text-[#94A3B8] font-mono">{repoFiles.length} files</span>
                </div>
                <p className="text-xs text-[#94A3B8] leading-relaxed mb-3">
                  All files below are physically written to <code className="text-[#F8FAFC]">/waterdog-edubridge-plugin/</code> in this project directory for direct GitHub sync.
                </p>
                <input
                  type="text"
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  placeholder="Filter Java classes or Gradle files..."
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
                          {file.module === 'waterdog-plugin'
                            ? 'WaterdogPE'
                            : file.module === 'pnx-companion'
                            ? 'PowerNukkitX'
                            : 'Proxy YAML'}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-[#64748B] truncate">
                        {file.path}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Build & Deploy Quick Reference */}
              <div className="p-4 border-t border-[#1E293B] bg-[#0B0F17]/60">
                <div className="text-xs font-semibold text-[#F8FAFC] mb-1.5 flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-[#10B981]" />
                  Compile on Raspberry Pi 4 / CI
                </div>
                <pre className="text-[11px] font-mono text-[#94A3B8] bg-[#0B0F17] p-2.5 rounded border border-[#1E293B] overflow-x-auto">
{`cd waterdog-edubridge-plugin
./gradlew shadowJar
# Output: build/libs/WaterdogPE-EduBridge-1.2.0-RPi4.jar`}
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
                    WaterdogPE LoginPacket & PreClientDataSetEvent Handshake Simulator
                  </h1>
                  <p className="text-sm text-[#94A3B8] mt-1">
                    Test how <code className="text-[#38BDF8]">EduLoginPacketInterceptor</code> and <code className="text-[#38BDF8]">DownstreamForwardingListener</code> process incoming Minecraft Education Edition connections and forward signed M365 claims to PowerNukkitX (:{bridgeConfig.downstreamPort}).
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
                      Classroom Join Code Challenge Input (Form ID 19133)
                    </div>
                    <div className="text-xs text-[#94A3B8]">
                      Expected Server Join Code: <code className="text-[#10B981]">{bridgeConfig.activeJoinCode}</code> (Try modifying the student's code below to test rejection)
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
                      onClick={() => setCustomSimJoinCode('WRONG-CODE-1234')}
                      className="px-3 py-1.5 text-xs font-medium text-[#94A3B8] hover:text-[#F8FAFC] bg-[#1E293B] rounded whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Simulate Wrong Code
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
                  <div className="text-xs text-[#94A3B8] mb-1">01. Upstream Handshake</div>
                  <div className="text-sm font-semibold text-[#F8FAFC] mb-2">
                    PreClientDataSetEvent
                  </div>
                  <p className="text-xs text-[#10B981] font-mono leading-relaxed">
                    {simulationEvaluation.stage1Status}
                  </p>
                </div>

                <div className="p-4 rounded-lg border border-[#1E293B] bg-[#0B0F17]">
                  <div className="text-xs text-[#94A3B8] mb-1">02. M365 OIDC / JWKS Verifier</div>
                  <div className="text-sm font-semibold text-[#F8FAFC] mb-2">
                    M365JwksVerifier
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
                  <div className="text-xs text-[#94A3B8] mb-1">03. Classroom Join Code Gate</div>
                  <div className="text-sm font-semibold text-[#F8FAFC] mb-2">
                    EduJoinCodeGatekeeper
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
                  <div className="text-xs text-[#94A3B8] mb-1">04. PowerNukkitX Transfer</div>
                  <div className="text-sm font-semibold text-[#F8FAFC] mb-2">
                    ServerTransferRequestEvent
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

              {/* Split Inspection: Incoming M365 Token vs Outgoing Signed WaterdogPE ExtraData */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="border border-[#1E293B] bg-[#0D131F] rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-[#F8FAFC]">
                      Incoming Client Handshake (Port 19132)
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
                      Re-Signed WaterdogPE Downstream JWT Payload (To PowerNukkitX :{bridgeConfig.downstreamPort})
                    </span>
                    <span
                      className={`text-xs font-mono font-semibold ${
                        simulationEvaluation.passed ? 'text-[#10B981]' : 'text-[#EF4444]'
                      }`}
                    >
                      {simulationEvaluation.passed ? 'FORWARDED TO :19133' : 'DROPPED AT PROXY'}
                    </span>
                  </div>
                  <pre className="text-xs font-mono text-[#E2E8F0] overflow-x-auto leading-relaxed">
{JSON.stringify(
  {
    waterdog_jwt_header: {
      alg: 'ES384',
      x5u: 'WaterdogPE-Proxy-Session-PublicKey'
    },
    extraData: simulationEvaluation.downstreamExtraData,
    pnx_login_chain_summary: {
      synthesizedXUID: simulationEvaluation.synthesizedXuid,
      synthesizedUUID: simulationEvaluation.synthesizedUuid,
      grantedOpOnPowerNukkitX:
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
                  M365 Tenant & Raspberry Pi 4 Plugin Configurator
                </h1>
                <p className="text-xs text-[#94A3B8] mt-1">
                  Customize your school's Microsoft 365 Tenant UUIDs, Classroom Join Code, and PowerNukkitX port settings. Changes immediately update the generated <code className="text-[#38BDF8]">config.yml</code> and Java constants.
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
                    Add Tenant UUID
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
                  <label className="block text-xs font-semibold text-[#F8FAFC] mb-1.5">
                    Classroom Join Code Sequence
                  </label>
                  <input
                    type="text"
                    value={bridgeConfig.activeJoinCode}
                    onChange={(e) =>
                      setBridgeConfig({ ...bridgeConfig, activeJoinCode: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs font-mono bg-[#0B0F17] border border-[#1E293B] rounded text-[#F8FAFC]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#F8FAFC] mb-1.5">
                    XUID Hash Salt (Deterministic Player Saves)
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

              {/* Toggles & RPi4 Thread Budget */}
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

            {/* Live Generated config.yml Preview */}
            <div className="lg:col-span-5 border border-[#1E293B] bg-[#111827] rounded-lg overflow-hidden flex flex-col">
              <div className="px-4 py-3 border-b border-[#1E293B] flex items-center justify-between">
                <span className="text-xs font-mono font-semibold text-[#F8FAFC]">
                  Live Generated src/main/resources/config.yml
                </span>
                <button
                  onClick={() =>
                    handleCopy(
                      repoFiles.find((f) => f.id === 'config-yml')?.content || '',
                      'live-config'
                    )
                  }
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-[#F8FAFC] bg-[#1E293B] hover:bg-[#334155] rounded cursor-pointer"
                >
                  {copiedId === 'live-config' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#10B981]" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy YAML
                    </>
                  )}
                </button>
              </div>
              <pre className="p-4 text-xs font-mono text-[#E2E8F0] bg-[#0D131F] overflow-x-auto flex-1 leading-relaxed">
                {repoFiles.find((f) => f.id === 'config-yml')?.content}
              </pre>
            </div>
          </div>
        )}

        {/* TAB 4: ARCHITECTURE & XBOX-AUTH BYPASS TECHNICAL GUIDE */}
        {activeTab === 'architecture' && (
          <div className="space-y-6">
            <div className="border border-[#1E293B] bg-[#111827] rounded-lg p-6">
              <h1 className="text-xl font-bold text-[#F8FAFC] mb-2">
                Bypassing Retail Xbox-Auth in WaterdogPE for M365 Education Clients
              </h1>
              <p className="text-sm text-[#94A3B8] leading-relaxed max-w-3xl">
                Complete architectural guide explaining why standard WaterdogPE rejects Minecraft Education Edition accounts, how to intercept the handshake without sacrificing cryptographic security, and how PowerNukkitX consumes the forwarded identity on port {bridgeConfig.downstreamPort}.
              </p>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
                <div className="p-5 rounded-lg border border-[#1E293B] bg-[#0B0F17]">
                  <h2 className="text-sm font-semibold text-[#F8FAFC] mb-2">
                    01. Why Standard WaterdogPE Rejects Education Clients
                  </h2>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">
                    When <code className="text-[#E2E8F0]">online_mode: true</code> is set in WaterdogPE, <code className="text-[#38BDF8]">HandshakeUtils.validateChain()</code> checks that the client's ECDSA certificate chain in <code className="text-[#E2E8F0]">LoginPacket</code> is signed by Mojang's retail Xbox Live Root Public Key (<code className="text-[#E2E8F0]">MHYwEAYHKoZIzj0CAQYFK4EEACIDYgAE...</code>). Education Edition clients authenticate via school Microsoft 365 Entra ID tenants (<code className="text-[#E2E8F0]">login.microsoftonline.com/&#123;tid&#125;</code>), causing standard WaterdogPE to immediately disconnect them.
                  </p>
                </div>

                <div className="p-5 rounded-lg border border-[#1E293B] bg-[#0B0F17]">
                  <h2 className="text-sm font-semibold text-[#F8FAFC] mb-2">
                    02. How EduBridge Captures & Validates M365 Tokens
                  </h2>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">
                    By configuring <code className="text-[#10B981]">online_mode: false</code> and <code className="text-[#10B981]">use_login_extras: true</code> in WaterdogPE, the proxy parses the client handshake and fires <code className="text-[#38BDF8]">PreClientDataSetEvent</code> before creating the player session. <code className="text-[#38BDF8]">EduLoginPacketInterceptor</code> intercepts this event, extracts the M365 JWT, and validates its RS256 signature against Microsoft's OpenID JWKS keys and your school's allowed <code className="text-[#E2E8F0]">tid</code> list.
                  </p>
                </div>

                <div className="p-5 rounded-lg border border-[#1E293B] bg-[#0B0F17]">
                  <h2 className="text-sm font-semibold text-[#F8FAFC] mb-2">
                    03. Forwarding Signed Claims to PowerNukkitX (:{bridgeConfig.downstreamPort})
                  </h2>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">
                    Once verified, <code className="text-[#38BDF8]">XuidSynthesizer</code> derives a deterministic 16-digit XUID (<code className="text-[#E2E8F0]">29xxxxxxxxxxxxxx</code>) from the student's M365 <code className="text-[#E2E8F0]">oid</code>. During <code className="text-[#38BDF8]">ServerTransferRequestEvent</code>, the plugin injects <code className="text-[#E2E8F0]">m365_tenant_id</code>, <code className="text-[#E2E8F0]">m365_upn</code>, and <code className="text-[#E2E8F0]">edu_role</code> into <code className="text-[#E2E8F0]">extraData</code> and signs the downstream token with WaterdogPE's proxy <code className="text-[#E2E8F0]">KeyPair</code>.
                  </p>
                </div>
              </div>

              {/* ASCII End-to-End Packet Lifecycle Diagram */}
              <div className="mt-6 border border-[#1E293B] bg-[#0D131F] rounded-lg p-5 overflow-x-auto">
                <div className="text-xs font-semibold text-[#F8FAFC] mb-3">
                  End-to-End Packet Flow on Raspberry Pi 4 (ARM64)
                </div>
                <pre className="text-xs font-mono text-[#94A3B8] leading-relaxed">
{`[Minecraft: Education Edition Client]
   │  1. RakNet Connection + LoginPacket (M365 Tenant JWT + Education ClientData)
   ▼
[WaterdogPE Proxy :19132] (online_mode: false, use_login_extras: true)
   │  2. HandshakeUtils parses JSON -> Fires PreClientDataSetEvent
   ├─► EduLoginPacketInterceptor.onPreClientDataSet(event)
   │     • Extracts M365 Token & verifies RS256 signature via M365JwksVerifier (Caffeine Cached)
   │     • Checks 'tid' against allowed-tenant-ids (${bridgeConfig.tenantIds[0] || 'school-tid'})
   │     • Synthesizes 16-digit XUID & UUIDv5 via XuidSynthesizer
   │     • Mutates extraData & clientData with Waterdog_M365TenantId, Waterdog_M365Upn, Waterdog_EduRole
   │
   ├─► DownstreamForwardingListener.onServerTransferRequest(event)
   │     • Calls HandshakeUtils.createExtraData(proxyKeyPair, extraData)
   │     • Schedules ModalFormRequestPacket (Form ID 19133) if Classroom Join Code not yet verified
   ▼
[PowerNukkitX Backend 127.0.0.1:${bridgeConfig.downstreamPort}] (xbox-auth=false, waterdogpe-support=true)
   │  3. Verifies WaterdogPE proxy signature & populates Player.getLoginChainData()
   └─► PnxEduBridgeReceiverPlugin.onPlayerLogin(event)
         • Reads Waterdog_M365Upn & Waterdog_EduRole
         • Automatically grants OP if Waterdog_EduRole == "teacher"`}
                </pre>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Clean Minimal Footer */}
      <footer className="border-t border-[#1E293B] px-6 py-4 text-xs text-[#64748B] flex flex-wrap items-center justify-between gap-4">
        <div>
          EduBridge-WaterdogPE · Native Bedrock M365 Authentication Bridge for WaterdogPE & PowerNukkitX
        </div>
        <div className="font-mono">
          Repository Directory: /waterdog-edubridge-plugin/
        </div>
      </footer>
    </div>
  );
}
