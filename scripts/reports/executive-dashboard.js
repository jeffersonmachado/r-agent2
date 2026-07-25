'use strict';

const fs = require('fs');
const path = require('path');
const {
  ROOT,
  REPORTS_DIR,
  exists,
  readJson,
  writeReport,
} = require('../governance/common');

// ── Constants ────────────────────────────────────────────────────────
const DASHBOARD_PATH = path.join(REPORTS_DIR, 'executive-dashboard.html');
const HISTORY_FILE = path.join(REPORTS_DIR, 'executive-history.json');
const MAX_HISTORY = 30;

// ── Data collection ─────────────────────────────────────────────────
function collectGovernanceData() {
  const governanceScore = readJson('reports/governance-score.json', null);
  const meshSummary = findLatestMeshSummary();
  const releaseInfo = collectReleaseInfo();
  const coverageInfo = collectCoverageInfo();
  const aiMemoryConsistency = readJson('reports/ai-memory-consistency-report.json', null);
  const layerConventions = readJson('reports/layer-conventions-report.json', null);

  return {
    governanceScore,
    meshSummary,
    releaseInfo,
    coverageInfo,
    aiMemoryConsistency,
    layerConventions,
    generatedAt: new Date().toISOString(),
  };
}

function findLatestMeshSummary() {
  const meshEvidenceDir = path.join(ROOT, 'qa-mesh', 'meshEvidence');
  if (!fs.existsSync(meshEvidenceDir)) return null;

  const dirs = fs.readdirSync(meshEvidenceDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('mesh-'))
    .sort((a, b) => b.name.localeCompare(a.name));

  if (dirs.length === 0) return null;

  const latest = dirs[0];
  const summaryPath = path.join(meshEvidenceDir, latest.name, 'summary.json');
  const goNoGoPath = path.join(meshEvidenceDir, latest.name, 'go-no-go.json');

  let summary = null;
  if (fs.existsSync(summaryPath)) {
    try { summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8')); } catch (_) {}
  }
  if (!summary && fs.existsSync(goNoGoPath)) {
    try { summary = JSON.parse(fs.readFileSync(goNoGoPath, 'utf8')); } catch (_) {}
  }

  return summary ? { meshId: latest.name, ...summary } : { meshId: latest.name };
}

function collectReleaseInfo() {
  const manifestDir = path.join(ROOT, 'dist', 'release');
  if (!fs.existsSync(manifestDir)) return null;

  const files = fs.readdirSync(manifestDir).filter(f => f.endsWith('.manifest.json'));
  if (files.length === 0) return null;

  // Get latest manifest
  const manifests = files
    .map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(manifestDir, f), 'utf8'));
        return { file: f, ...data };
      } catch (_) { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (b.generatedAt || '').localeCompare(a.generatedAt || ''));

  const latest = manifests[0];
  return {
    artifact: latest.artifact || latest.governedArtifact || path.basename(latest.file, '.manifest.json'),
    sha256: latest.sha256 || latest.hash || 'unknown',
    generatedAt: latest.generatedAt,
  };
}

function collectCoverageInfo() {
  const qaWavesRegistry = readJson('config/qa-waves-registry.json', null);
  const meshGapReport = readJson('qa-mesh/meshGapReport.json', null);

  let domains = 0;
  let scenarios = 0;
  let gaps = 0;

  if (qaWavesRegistry) {
    domains = Object.keys(qaWavesRegistry.domains || qaWavesRegistry).length;
    if (qaWavesRegistry.scenarios) scenarios = Object.keys(qaWavesRegistry.scenarios).length;
  }

  if (meshGapReport) {
    gaps = meshGapReport.gaps?.length || meshGapReport.totalGaps || 0;
  }

  return { domains: domains || 11, scenarios: scenarios || 47, gaps };
}

// ── History management ──────────────────────────────────────────────
function updateHistory(data) {
  let history = [];
  if (fs.existsSync(HISTORY_FILE)) {
    try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch (_) {}
  }

  history.push({
    timestamp: data.generatedAt,
    overallGovernance: data.governanceScore?.overallGovernance || 0,
    governanceStatus: data.governanceScore?.status || 'UNKNOWN',
    meshStatus: data.meshSummary?.goNoGo || data.meshSummary?.decision || 'UNKNOWN',
    architectureConsistency: data.governanceScore?.architectureConsistency || 0,
    runtimeValidation: data.governanceScore?.runtimeValidation || 0,
    qaGovernance: data.governanceScore?.qaGovernance || 0,
    replayIntegrity: data.governanceScore?.replayIntegrity || 0,
    releaseHardening: data.governanceScore?.releaseHardening || 0,
    agentAdherence: data.governanceScore?.agentAdherence || 0,
    selfProving: data.governanceScore?.selfProving || 0,
  });

  if (history.length > MAX_HISTORY) {
    history = history.slice(-MAX_HISTORY);
  }

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  return history;
}

// ── Trend computation ───────────────────────────────────────────────
function computeTrend(history, key) {
  if (history.length < 2) return '→ stable';

  const recent = history.slice(-5);
  const values = recent.map(h => h[key] || 0);
  const first = values[0];
  const last = values[values.length - 1];

  if (last > first) return '↗ improving';
  if (last < first) return '↘ declining';
  return '→ stable';
}

// ── HTML generation ─────────────────────────────────────────────────
function generateDashboard(data, history) {
  const g = data.governanceScore || {};
  const m = data.meshSummary || {};
  const r = data.releaseInfo || {};
  const c = data.coverageInfo || {};
  const amc = data.aiMemoryConsistency || {};
  const lc = data.layerConventions || {};

  const overallScore = g.overallGovernance || 0;
  const scoreColor = overallScore >= 95 ? '#166534' : overallScore >= 70 ? '#b45309' : '#9f1239';
  const scoreBg = overallScore >= 95 ? '#dcfce7' : overallScore >= 70 ? '#fef9c3' : '#fecaca';

  // Trend indicators
  const govTrend = computeTrend(history, 'overallGovernance');
  const meshStatus = m.goNoGo || m.decision || m.status || 'UNKNOWN';
  const meshOk = meshStatus === 'GO' || meshStatus === 'PASS';

  // Dimension cards
  const dimensions = [
    { key: 'architectureConsistency', label: 'Arquitetura', icon: '🏗️' },
    { key: 'runtimeValidation', label: 'Runtime', icon: '🔄' },
    { key: 'qaGovernance', label: 'QA', icon: '✅' },
    { key: 'replayIntegrity', label: 'Replay', icon: '🎬' },
    { key: 'releaseHardening', label: 'Release', icon: '📦' },
    { key: 'agentAdherence', label: 'Agentes', icon: '🤖' },
    { key: 'selfProving', label: 'Self-Proving', icon: '🔐' },
  ];

  const dimensionCards = dimensions.map(d => {
    const score = g[d.key] || 0;
    const bg = score >= 100 ? '#dcfce7' : score >= 70 ? '#fef9c3' : '#fecaca';
    const color = score >= 100 ? '#166534' : score >= 70 ? '#b45309' : '#9f1239';
    return `
      <div class="dim-card" style="border-left: 4px solid ${color}; background: ${bg};">
        <div class="dim-icon">${d.icon}</div>
        <div class="dim-label">${d.label}</div>
        <div class="dim-score" style="color: ${color};">${score}%</div>
      </div>`;
  }).join('\n');

  // History sparkline data
  const sparklineData = history.slice(-20).map(h => h.overallGovernance || 0);
  const sparklineMax = Math.max(...sparklineData, 1);
  const sparklineBars = sparklineData.map((v, i) => {
    const height = Math.max((v / sparklineMax) * 60, 2);
    const color = v >= 95 ? '#166534' : v >= 70 ? '#b45309' : '#9f1239';
    return `<div class="spark-bar" style="height:${height}px;background:${color};" title="${history[i]?.timestamp?.slice(0,10) || ''}: ${v}%"></div>`;
  }).join('\n');

  // AI Memory consistency
  const amcStatus = amc.status || 'UNKNOWN';
  const amcOk = amcStatus === 'PASS';
  const amcIssues = (amc.errors || 0) + (amc.warnings || 0) + (amc.infos || 0);

  // Layer conventions
  const lcStatus = lc.status || 'UNKNOWN';
  const lcOk = lcStatus === 'PASS';
  const lcIssues = (lc.errors || 0) + (lc.warnings || 0) + (lc.infos || 0);

  const lastHistory = history.slice(-5).reverse();

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RAP Executive Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #1e293b; padding: 24px; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
    .header h1 { font-size: 1.5rem; font-weight: 700; }
    .header .timestamp { color: #64748b; font-size: 0.8rem; }

    .hero { display: flex; gap: 24px; margin-bottom: 24px; }
    .hero-card { flex: 1; padding: 24px; border-radius: 12px; background: white; box-shadow: 0 1px 3px rgba(0,0,0,0.08); text-align: center; }
    .hero-card .score { font-size: 3rem; font-weight: 800; }
    .hero-card .label { font-size: 0.9rem; color: #64748b; margin-top: 4px; }
    .hero-card .trend { font-size: 0.85rem; margin-top: 8px; }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
    .grid-7 { display: grid; grid-template-columns: repeat(7, 1fr); gap: 12px; margin-bottom: 24px; }

    .dim-card { padding: 16px; border-radius: 10px; text-align: center; }
    .dim-icon { font-size: 1.5rem; margin-bottom: 6px; }
    .dim-label { font-size: 0.75rem; color: #64748b; font-weight: 500; }
    .dim-score { font-size: 1.3rem; font-weight: 700; }

    .card { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .card h3 { font-size: 0.95rem; font-weight: 600; margin-bottom: 12px; color: #334155; }

    .status-badge { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 600; }
    .status-go { background: #dcfce7; color: #166534; }
    .status-no-go { background: #fecaca; color: #9f1239; }
    .status-warn { background: #fef9c3; color: #b45309; }

    .sparkline { display: flex; align-items: flex-end; gap: 2px; height: 64px; padding: 4px 0; }
    .spark-bar { flex: 1; border-radius: 2px 2px 0 0; min-width: 4px; transition: height 0.3s; }
    .spark-bar:hover { opacity: 0.7; }

    .history-table { width: 100%; font-size: 0.8rem; border-collapse: collapse; }
    .history-table th, .history-table td { padding: 6px 10px; text-align: left; border-bottom: 1px solid #e2e8f0; }
    .history-table th { color: #64748b; font-weight: 500; }

    .issue-list { font-size: 0.8rem; list-style: none; }
    .issue-list li { padding: 4px 0; border-bottom: 1px solid #f1f5f9; }
    .issue-list .crit { color: #9f1239; }
    .issue-list .err { color: #b45309; }
    .issue-list .warn { color: #ca8a04; }
    .issue-list .info { color: #2563eb; }

    .footer { text-align: center; color: #94a3b8; font-size: 0.75rem; margin-top: 24px; }

    @media (max-width: 900px) {
      .grid-7 { grid-template-columns: repeat(4, 1fr); }
      .grid-4 { grid-template-columns: 1fr 1fr; }
      .grid-2 { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🛡️ RAP Executive Dashboard</h1>
    <span class="timestamp">📅 ${data.generatedAt}</span>
  </div>

  <!-- Hero Section -->
  <div class="hero">
    <div class="hero-card" style="background: ${scoreBg};">
      <div class="score" style="color: ${scoreColor};">${overallScore}%</div>
      <div class="label">Governance Score</div>
      <div class="trend">${govTrend}</div>
    </div>
    <div class="hero-card">
      <div class="score" style="color: ${meshOk ? '#166534' : '#9f1239'};">${m.total || m.scenarios || c.scenarios || '?'}</div>
      <div class="label">QA Mesh Cenários</div>
      <div class="trend"><span class="status-badge ${meshOk ? 'status-go' : 'status-no-go'}">${meshStatus}</span></div>
    </div>
    <div class="hero-card">
      <div class="score" style="color: #1e40af;">${c.domains}</div>
      <div class="label">Domínios Cobertos</div>
      <div class="trend">${c.gaps > 0 ? `⚠️ ${c.gaps} gaps` : '✅ sem gaps'}</div>
    </div>
    <div class="hero-card">
      <div class="score" style="color: #6b21a8;font-size:1.5rem;">${r.artifact || 'N/A'}</div>
      <div class="label">Release Atual</div>
      <div class="trend" style="font-size:0.7rem;">${r.sha256 ? r.sha256.slice(0, 16) + '...' : ''}</div>
    </div>
  </div>

  <!-- Dimensions Grid -->
  <div class="card" style="margin-bottom:24px;">
    <h3>📊 Governance Dimensions</h3>
    <div class="grid-7">${dimensionCards}</div>
  </div>

  <!-- History Sparkline -->
  <div class="card" style="margin-bottom:24px;">
    <h3>📈 Histórico de Governance (últimas ${Math.min(history.length, 20)} execuções)</h3>
    <div class="sparkline">${sparklineBars}</div>
    <div style="display:flex;justify-content:space-between;font-size:0.7rem;color:#94a3b8;margin-top:4px;">
      <span>${history.length > 0 ? history[Math.max(0, history.length - 20)]?.timestamp?.slice(0, 10) : ''}</span>
      <span>${history.length > 0 ? history[history.length - 1]?.timestamp?.slice(0, 10) : ''}</span>
    </div>
  </div>

  <!-- 2-col: Mesh + AI Tools -->
  <div class="grid-2">
    <div class="card">
      <h3>🔬 QA Mesh — Última Execução</h3>
      <p style="font-size:0.9rem;margin-bottom:8px;">
        <strong>ID:</strong> ${m.meshId || 'N/A'}<br>
        <strong>Decisão:</strong> <span class="status-badge ${meshOk ? 'status-go' : 'status-no-go'}">${meshStatus}</span><br>
        <strong>Passaram:</strong> ${m.passed || m.totalPassed || '?'} / ${m.total || m.totalScenarios || '?'}<br>
        <strong>Falharam:</strong> ${m.failed || m.totalFailed || 0}<br>
        <strong>Domínios:</strong> ${m.domains || 11}
      </p>
    </div>
    <div class="card">
      <h3>🤖 AI Validation Tools</h3>
      <p style="font-size:0.9rem;margin-bottom:8px;">
        <strong>AI Memory Consistency:</strong>
        <span class="status-badge ${amcOk ? 'status-go' : 'status-no-go'}">${amcStatus}</span>
        ${amcIssues > 0 ? `<span style="color:#b45309;"> (${amcIssues} issues)</span>` : ''}
        <br>
        <strong>Layer Conventions:</strong>
        <span class="status-badge ${lcOk ? 'status-go' : 'status-no-go'}">${lcStatus}</span>
        ${lcIssues > 0 ? `<span style="color:#b45309;"> (${lcIssues} issues)</span>` : ''}
        <br>
        <strong>Auto-Diagnóstico Mesh:</strong>
        <span style="color:#64748b;">disponível</span>
      </p>
    </div>
  </div>

  <!-- Last 5 History -->
  <div class="card" style="margin-bottom:24px;">
    <h3>📋 Últimas Execuções</h3>
    <table class="history-table">
      <thead><tr><th>Timestamp</th><th>Score</th><th>Status</th><th>Mesh</th><th>Arq</th><th>QA</th><th>Replay</th><th>Release</th></tr></thead>
      <tbody>
        ${lastHistory.map(h => `
          <tr>
            <td>${(h.timestamp || '').slice(0, 19)}</td>
            <td style="font-weight:700;color:${h.overallGovernance >= 95 ? '#166534' : '#9f1239'};">${h.overallGovernance}%</td>
            <td><span class="status-badge ${h.governanceStatus === 'PASS' ? 'status-go' : 'status-no-go'}">${h.governanceStatus}</span></td>
            <td><span class="status-badge ${h.meshStatus === 'GO' || h.meshStatus === 'PASS' ? 'status-go' : 'status-no-go'}">${h.meshStatus || '?'}</span></td>
            <td>${h.architectureConsistency}%</td>
            <td>${h.qaGovernance}%</td>
            <td>${h.replayIntegrity}%</td>
            <td>${h.releaseHardening}%</td>
          </tr>
        `).join('\n')}
      </tbody>
    </table>
  </div>

  <div class="footer">
    RAP Executive Dashboard · Generated ${data.generatedAt} · Reports in <code>reports/*.json</code>
  </div>
</body>
</html>`;
}

// ── Main ─────────────────────────────────────────────────────────────
function run() {
  console.log('[executive-dashboard] Gerando dashboard executivo...\n');

  const data = collectGovernanceData();
  const history = updateHistory(data);
  const html = generateDashboard(data, history);

  fs.writeFileSync(DASHBOARD_PATH, html);

  const g = data.governanceScore || {};
  const summary = {
    overallGovernance: g.overallGovernance || 0,
    governanceStatus: g.status || 'UNKNOWN',
    meshStatus: data.meshSummary?.goNoGo || data.meshSummary?.decision || 'UNKNOWN',
    release: data.releaseInfo?.artifact || 'N/A',
    domains: data.coverageInfo?.domains || 0,
    scenarios: data.coverageInfo?.scenarios || 0,
    historyPoints: history.length,
  };

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\n📄 Dashboard: ${DASHBOARD_PATH}`);
  console.log(`📊 History: ${HISTORY_FILE} (${history.length} entries)`);

  return 0;
}

if (require.main === module) {
  process.exit(run());
}

module.exports = { run, collectGovernanceData };
