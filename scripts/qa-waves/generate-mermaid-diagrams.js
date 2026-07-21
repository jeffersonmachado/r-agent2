'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function safeId(text) {
  return String(text || '').replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function escapeLabel(text) {
  return String(text || '').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

// ─── Step type → Mermaid node shape ────────────────────────────────────────
const STEP_SHAPES = {
  trigger_channel_event: ['[', ']'],   // rectangle
  send_message:          ['[', ']'],
  validate_intent:       ['{', '}'],   // diamond → rhombus in mermaid via {}
  ai_decision:           ['{', '}'],
  validate_backend:      ['[', ']'],
  backend_action:        ['[', ']'],
  validate_state:        ['[', ']'],
  wait_for_event:        ['(', ')'],   // rounded
  human_handoff:         ['>', ']'],   // asymmetric
  checkpoint:            ['[', ']'],
};

function stepShape(stepType) {
  return STEP_SHAPES[stepType] || ['[', ']'];
}

// ─── Generate journey flowchart ────────────────────────────────────────────
function generateJourneyFlowchart(scenario, coverage) {
  const lines = [];
  const title = `${scenario.vertical}/${scenario.journey} — ${scenario.name || scenario.id}`;
  lines.push(`---`);
  lines.push(`title: ${title}`);
  lines.push(`---`);
  lines.push('');
  lines.push('```mermaid');
  lines.push('flowchart LR');

  const steps = Array.isArray(scenario.steps) ? scenario.steps : [];
  if (steps.length === 0) {
    if (coverage && Array.isArray(coverage.steps)) {
      // Use journey coverage steps as placeholder
      for (const stepName of coverage.steps) {
        const id = safeId(stepName);
        lines.push(`    ${id}["${escapeLabel(stepName)}"]`);
      }
      for (let i = 0; i < coverage.steps.length - 1; i++) {
        const from = safeId(coverage.steps[i]);
        const to = safeId(coverage.steps[i + 1]);
        lines.push(`    ${from} --> ${to}`);
      }
    } else {
      lines.push('    start["(sem passos definidos)"]');
    }
  } else {
    const sorted = [...steps].sort((a, b) => (a.order || 0) - (b.order || 0));
    for (const step of sorted) {
      const id = safeId(step.id || `step_${step.order}`);
      const [left, right] = stepShape(step.type);
      const label = escapeLabel(step.name || step.type || `Step ${step.order}`);
      const channel = step.channel ? `\\n📡 ${step.channel}` : '';
      const adapter = step.adapter ? `\\n⚙ ${step.adapter}` : '';
      lines.push(`    ${id}${left}"${label}${channel}${adapter}"${right}`);
    }
    for (let i = 0; i < sorted.length - 1; i++) {
      const from = safeId(sorted[i].id || `step_${sorted[i].order}`);
      const to = safeId(sorted[i + 1].id || `step_${sorted[i + 1].order}`);
      const edgeLabel = sorted[i + 1].expected ? `| "${Object.keys(sorted[i + 1].expected).join(', ')}" |` : '';
      lines.push(`    ${from} -->${edgeLabel} ${to}`);
    }
  }

  // Metadata
  lines.push('');
  lines.push('```');
  lines.push('');
  lines.push(`- **Status**: ${scenario.status || 'draft'}`);
  lines.push(`- **Canais**: ${(scenario.channels || []).join(', ') || 'não definidos'}`);
  lines.push(`- **Risco**: ${scenario.risk || 'não definido'}`);
  lines.push(`- **Pré-condições**: ${(scenario.preconditions || []).join('; ') || 'nenhuma'}`);
  if (scenario.validations) {
    lines.push(`- **Validações**: replay=${scenario.validations.requireReplay || false}, backend=${scenario.validations.requireBackendValidation || false}`);
  }

  return lines.join('\n');
}

// ─── Generate vertical summary diagram ─────────────────────────────────────
function generateVerticalSummary(vertical, scenarios) {
  const lines = [];
  lines.push(`---`);
  lines.push(`title: ${vertical.toUpperCase()} — Mapa de Jornadas QA Waves`);
  lines.push(`---`);
  lines.push('');
  lines.push('```mermaid');
  lines.push('flowchart TD');

  const verticalScenarios = scenarios.filter(s => s.vertical === vertical);
  const journeyGroups = {};
  for (const s of verticalScenarios) {
    const jKey = s.journey || 'unmapped';
    if (!journeyGroups[jKey]) journeyGroups[jKey] = [];
    journeyGroups[jKey].push(s);
  }

  lines.push(`    v_${safeId(vertical)}["${vertical.toUpperCase()}"]`);
  for (const [journey, scens] of Object.entries(journeyGroups)) {
    const jId = safeId(`${vertical}_${journey}`);
    const approved = scens.filter(s => s.status === 'approved').length;
    const total = scens.length;
    const icon = approved === total ? '✅' : approved > 0 ? '🔶' : '⬜';
    lines.push(`    ${jId}["${icon} ${journey}\\n${approved}/${total} aprovados"]`);
    lines.push(`    v_${safeId(vertical)} --> ${jId}`);
    for (const s of scens) {
      const sId = safeId(s.id);
      const sIcon = s.status === 'approved' ? '✅' : '⬜';
      lines.push(`    ${sId}["${sIcon} ${escapeLabel(s.name || s.id)}"]`);
      lines.push(`    ${jId} --> ${sId}`);
    }
  }

  lines.push('');
  lines.push('```');
  return lines.join('\n');
}

// ─── Generate architecture: Waves ↔ Mesh pipeline ──────────────────────────
function generateWavesMeshPipeline() {
  return `---
title: Pipeline QA Waves ↔ QA Mesh
---

\`\`\`mermaid
flowchart TD
    subgraph Inputs["Entradas"]
        J[fa:fa-file Jornadas de Negócio]
        C[fa:fa-gear Capabilities]
        R[fa:fa-database qa-waves-registry.json]
    end

    subgraph Waves["QA Waves"]
        GEN[Bot de Geração\\nscenario + uiSteps + validators + seeds]
        DRAFT[Drafts\\nscenario-store.json]
        APPR[Aprovação\\nreview → approve/reject]
        EXEC[Execução\\nPOST /api/qa-waves/executions]
    end

    subgraph Mesh["QA Mesh"]
        RUN[Mesh Runner\\nqa-mesh/meshRunner.js]
        ADAPT[Adapters\\nwhatsapp, webchat, pbx, api]
        METRICS[Metrics\\nqa-mesh/metrics.json]
        GONOGO[GO/NO_GO\\nqa-mesh/go-no-go-report.json]
    end

    subgraph Governance["Governança"]
        ENT[Enterprise Governance\\nqa-waves-enterprise-governance.json]
        SCORE[Governance Score\\nreports/governance-score.json]
        GATE[Release Gate\\nvalidate:governance-enforcement]
    end

    subgraph Evidence["Evidências"]
        REPLAY[Replay\\nRPA determinístico]
        SMOKE[Smoke Tests\\nprod-like + scheduled]
        COVERAGE[Journey Coverage\\nqa-waves/journey-coverage/]
    end

    J --> GEN
    C --> GEN
    R --> GEN
    GEN --> DRAFT
    DRAFT --> APPR
    APPR -->|approved| EXEC
    EXEC --> RUN
    RUN --> ADAPT
    ADAPT --> METRICS
    METRICS --> GONOGO
    GONOGO --> ENT
    EXEC --> REPLAY
    EXEC --> SMOKE
    EXEC --> COVERAGE
    REPLAY --> ENT
    SMOKE --> ENT
    COVERAGE --> ENT
    ENT --> SCORE
    SCORE --> GATE
    GATE -->|GO| RELEASE[🚀 Release]
    GATE -->|NO_GO| FIX[🔧 Auto-correção]

    style RELEASE fill:#2d6,stroke:#151,color:#fff
    style FIX fill:#d62,stroke:#a51,color:#fff
    style GONOGO fill:#ff0,stroke:#aa0
\`\`\`
`;
}

// ─── Generate governance flow ──────────────────────────────────────────────
function generateGovernanceFlow() {
  return `---
title: Fluxo de Governança QA Waves
---

\`\`\`mermaid
flowchart TD
    subgraph Generation["1. Geração"]
        direction LR
        A1[Bot: scenario + steps] --> A2[Bot: validators]
        A2 --> A3[Bot: seeds]
        A3 --> A4[Preflight validation]
    end

    subgraph Review["2. Revisão"]
        direction LR
        B1[Draft criado] --> B2{Revisão humana}
        B2 -->|approved| B3[Cenário ativo]
        B2 -->|rejected| B4[Corrigir e reenviar]
    end

    subgraph Execution["3. Execução"]
        direction LR
        C1[Wave Execution] --> C2[Mesh Runner]
        C2 --> C3[Replay + Smoke]
        C3 --> C4[Evidências]
    end

    subgraph Governance["4. Decisão"]
        direction LR
        D1[Enterprise Governance] --> D2{GO/NO_GO}
        D2 -->|GO| D3[Release Gate: GO]
        D2 -->|NO_GO| D4[Bloqueadores ativos]
        D4 --> D5[Gap Analysis]
        D5 --> A1
    end

    subgraph Validation["5. Validação Contínua"]
        direction LR
        E1[validate:qa-governance] --> E2[validate:qa-waves-registry]
        E2 --> E3[validate:governance-enforcement]
        E3 --> E4[Governance Score]
    end

    A4 --> B1
    B3 --> C1
    C4 --> D1
    D3 --> E1

    style D3 fill:#2d6,stroke:#151,color:#fff
    style D4 fill:#d62,stroke:#a51,color:#fff
\`\`\`
`;
}

// ─── Generate all-journeys index ───────────────────────────────────────────
function generateAllJourneysIndex(scenarios, coverageData) {
  const lines = [];
  lines.push(`# QA Waves — Diagramas de Jornada`);
  lines.push('');
  lines.push(`Gerado em: ${new Date().toISOString()}`);
  lines.push(`Total de cenários: ${scenarios.length}`);
  lines.push('');
  lines.push('## Por Vertical');
  lines.push('');

  const byVertical = {};
  for (const s of scenarios) {
    const v = s.vertical || 'unknown';
    if (!byVertical[v]) byVertical[v] = { total: 0, approved: 0, journeys: new Set() };
    byVertical[v].total++;
    if (s.status === 'approved') byVertical[v].approved++;
    byVertical[v].journeys.add(s.journey || 'unmapped');
  }

  lines.push('| Vertical | Cenários | Aprovados | Jornadas | Status |');
  lines.push('|---|---|---|---|---|');
  for (const [vertical, stats] of Object.entries(byVertical).sort()) {
    const icon = stats.approved === stats.total ? '✅' : stats.approved > 0 ? '🔶' : '⬜';
    lines.push(`| ${vertical} | ${stats.total} | ${stats.approved} | ${stats.journeys.size} | ${icon} |`);
  }

  lines.push('');
  lines.push('## Diagramas de Arquitetura');
  lines.push('');
  lines.push('- [Pipeline QA Waves ↔ QA Mesh](architecture-waves-mesh.md)');
  lines.push('- [Fluxo de Governança](architecture-governance-flow.md)');
  lines.push('');

  lines.push('## Diagramas por Vertical');
  lines.push('');
  for (const vertical of Object.keys(byVertical).sort()) {
    lines.push(`- [${vertical}](vertical-${safeId(vertical)}.md) (${byVertical[vertical].total} cenários)`);
  }

  return lines.join('\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────
function main() {
  const outDir = path.join(ROOT, 'docs', 'diagrams', 'qa-waves');
  const scenarioStore = readJson(path.join(ROOT, 'qa', 'qa-waves', 'scenario-store.json'));
  if (!scenarioStore) {
    console.error('scenario-store.json not found');
    process.exit(1);
  }

  const scenarios = Array.isArray(scenarioStore.scenarios) ? scenarioStore.scenarios : [];

  // Load journey coverage data
  const coverageDir = path.join(ROOT, 'qa-waves', 'journey-coverage');
  const coverageData = {};
  if (fs.existsSync(coverageDir)) {
    for (const file of fs.readdirSync(coverageDir)) {
      if (file.endsWith('.json')) {
        const data = readJson(path.join(coverageDir, file));
        if (data) coverageData[data.vertical || file.replace('.json', '')] = data;
      }
    }
  }

  // Build coverage lookup: scenarioId → coverage scenario
  const coverageLookup = {};
  for (const [, covData] of Object.entries(coverageData)) {
    for (const journey of (covData.journeys || [])) {
      for (const covScenario of (journey.scenarios || [])) {
        coverageLookup[covScenario.scenarioId] = covScenario;
      }
    }
  }

  // 1. Architecture diagrams (always generated)
  writeText(path.join(outDir, 'architecture-waves-mesh.md'), generateWavesMeshPipeline());
  writeText(path.join(outDir, 'architecture-governance-flow.md'), generateGovernanceFlow());
  console.log('✅ Architecture diagrams generated');

  // 2. Per-vertical summaries
  const verticals = [...new Set(scenarios.map(s => s.vertical))].sort();
  for (const vertical of verticals) {
    const content = generateVerticalSummary(vertical, scenarios);
    writeText(path.join(outDir, `vertical-${safeId(vertical)}.md`), content);
  }
  console.log(`✅ ${verticals.length} vertical summaries generated`);

  // 3. Per-scenario flowcharts (only for scenarios with steps)
  let journeyCount = 0;
  for (const scenario of scenarios) {
    if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) continue;
    const covScenario = coverageLookup[scenario.id];
    const content = generateJourneyFlowchart(scenario, covScenario);
    const fname = `journey-${safeId(scenario.vertical)}-${safeId(scenario.journey)}-${safeId(scenario.id)}.md`;
    writeText(path.join(outDir, fname), content);
    journeyCount++;
  }
  console.log(`✅ ${journeyCount} journey flowcharts generated (${scenarios.length - journeyCount} sem passos)`);

  // 4. Index
  writeText(path.join(outDir, 'README.md'), generateAllJourneysIndex(scenarios, coverageData));
  console.log('✅ Index generated');

  console.log(`\n📁 Output: ${outDir}`);
  console.log(`   ${verticals.length + journeyCount + 3} arquivos gerados`);
}

if (require.main === module) {
  main();
}

module.exports = { main, generateJourneyFlowchart, generateVerticalSummary, generateWavesMeshPipeline, generateGovernanceFlow };
