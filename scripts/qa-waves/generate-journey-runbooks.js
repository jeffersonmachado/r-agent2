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

const VERTICAL_LABELS = {
  fitness: 'Fitness',
  beauty: 'Beleza & Estética',
  food: 'Alimentação',
  clinic: 'Clínica & Saúde',
  market: 'Marketplace',
  services: 'Serviços',
};

const STEP_TYPE_LABELS = {
  trigger_channel_event: 'Evento de Canal',
  send_message: 'Envio de Mensagem',
  validate_intent: 'Validação de Intenção (IA)',
  ai_decision: 'Decisão de IA',
  validate_backend: 'Validação de Backend',
  backend_action: 'Ação de Backend',
  validate_state: 'Validação de Estado',
  wait_for_event: 'Aguardar Evento',
  human_handoff: 'Transferência para Humano',
  checkpoint: 'Checkpoint',
};

// ─── Generate one journey runbook ──────────────────────────────────────────
function generateJourneyRunbook(journey, coverageScenarios, storeScenarios, contracts) {
  const lines = [];
  const vertical = journey.vertical;
  const journeyId = journey.journey;
  const verticalLabel = VERTICAL_LABELS[vertical] || vertical;
  const scenarios = coverageScenarios || [];
  const approved = scenarios.filter(s => {
    const storeS = storeScenarios.find(ss => ss.id === s.scenarioId);
    return storeS && storeS.status === 'approved';
  });
  const draftCount = scenarios.length - approved.length;

  lines.push(`# ${verticalLabel} — ${journeyId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`);
  lines.push('');
  lines.push(`> Gerado: ${new Date().toISOString()} | Vertical: ${vertical} | Jornada: ${journeyId}`);
  lines.push('');

  // ── Objetivo ──
  lines.push('## 1. Objetivo');
  lines.push('');
  const journeyContract = (contracts?.journeys || {})[journeyId];
  if (journeyContract) {
    lines.push(`Validar o fluxo operacional completo da jornada **${journeyId}** com cobertura de ${journeyContract.requiredCapabilities.length} capabilities obrigatórias e confiança de contrato de ${(journeyContract.confidence * 100).toFixed(0)}%.`);
    lines.push('');
    lines.push('**Capabilities requeridas:**');
    for (const cap of journeyContract.requiredCapabilities) {
      lines.push(`- \`${cap}\``);
    }
  } else {
    lines.push(`Validar o fluxo operacional completo da jornada **${journeyId}** na vertical ${verticalLabel}.`);
  }
  lines.push('');

  // ── Pré-condições ──
  lines.push('## 2. Pré-condições');
  lines.push('');
  lines.push('| Condição | Obrigatória |');
  lines.push('|---|---|');
  lines.push('| API em execução (porta 3001) | Sim |');
  lines.push('| Redis acessível | Sim |');
  lines.push('| PostgreSQL acessível | Sim |');
  lines.push(`| Tenant configurado para vertical ${verticalLabel} | Sim |`);
  lines.push('| Credenciais de QA (`systemadmin` / tenant `system`) | Sim |');
  if (journey.replaySupport) {
    lines.push('| RPA/Playwright disponível para replay | Sim |');
  } else {
    lines.push('| RPA/Playwright disponível para replay | Não (jornada sem suporte a replay) |');
  }
  lines.push('');

  // ── Cenários ──
  lines.push('## 3. Cenários');
  lines.push('');
  lines.push(`Total: **${scenarios.length}** cenários (${approved.length} aprovados, ${draftCount} drafts)`);
  lines.push('');

  for (const scenario of scenarios) {
    const storeS = storeScenarios.find(ss => ss.id === scenario.scenarioId);
    const statusIcon = scenario.status === 'approved' || (storeS && storeS.status === 'approved') ? '✅' : '⬜';
    lines.push(`### ${statusIcon} ${scenario.scenario || scenario.scenarioId}`);
    lines.push('');
    lines.push(`- **ID**: \`${scenario.scenarioId}\``);
    lines.push(`- **Status**: ${storeS ? storeS.status : scenario.status}`);
    lines.push(`- **Canais**: ${(scenario.channels || []).join(', ') || 'não definidos'}`);
    lines.push(`- **Pré-condições**: ${(scenario.preconditions || []).join('; ') || 'nenhuma'}`);
    lines.push(`- **Integrações**: ${(scenario.integrations || []).join(', ') || 'não definidas'}`);

    if (storeS && Array.isArray(storeS.steps) && storeS.steps.length > 0) {
      lines.push('');
      lines.push('**Passos:**');
      lines.push('');
      lines.push('| Ordem | Tipo | Nome | Adapter | Canal | Timeout |');
      lines.push('|---|---|---|---|---|');
      for (const step of storeS.steps.sort((a, b) => (a.order || 0) - (b.order || 0))) {
        const typeLabel = STEP_TYPE_LABELS[step.type] || step.type;
        lines.push(`| ${step.order} | ${typeLabel} | ${step.name || '-'} | ${step.adapter || '-'} | ${step.channel || '-'} | ${step.timeoutMs || '-'}ms |`);
      }

      if (storeS.validations) {
        lines.push('');
        lines.push(`**Validações**: replay=${storeS.validations.requireReplay || false}, backend=${storeS.validations.requireBackendValidation || false}`);
      }
    } else {
      lines.push('');
      lines.push('⚠️ **Cenário sem passos definidos** — requer geração via bot (`POST /api/qa-waves/intelligence/generate-scenario`).');
    }
    lines.push('');
  }

  // ── Evidência esperada ──
  lines.push('## 4. Evidência Esperada');
  lines.push('');
  lines.push('Após execução de todos os cenários aprovados via QA Mesh:');
  lines.push('');
  lines.push('| Artefato | Formato | Local |');
  lines.push('|---|---|---|');
  lines.push('| Resultado da execução | JSON | `qa-mesh/meshHistory/` |');
  lines.push('| Relatório GO/NO_GO | JSON | `qa-mesh/go-no-go-report.json` |');
  lines.push('| Replay (se aplicável) | JSON + trace | `qa/` (governado) |');
  lines.push('| Evidência de smoke | JSON | `qa/smoke/prod-like/` |');
  lines.push('| Diagrama da jornada | Mermaid | `docs/diagrams/qa-waves/journey-*.md` |');
  lines.push('');

  // ── Validações de governança ──
  lines.push('## 5. Validações de Governança');
  lines.push('');
  lines.push('Gates aplicáveis após execução:');
  lines.push('');
  lines.push('```bash');
  lines.push('npm run validate:qa-governance        # QA Mesh GO/NO_GO');
  lines.push('npm run validate:qa-waves-registry     # Integridade do registry');
  lines.push('npm run validate:replay-governance     # Integridade de replay');
  lines.push('npm run validate:self-proving          # Prova final');
  lines.push('```');
  lines.push('');

  // ── Troubleshooting ──
  lines.push('## 6. Troubleshooting');
  lines.push('');
  lines.push('| Sintoma | Causa provável | Ação |');
  lines.push('|---|---|---|');
  lines.push('| Cenário falha na validação de schema | Passos não conformes com `waveScenarioSchema.js` | Regerar via bot ou corrigir manualmente |');
  lines.push('| Execução retorna 500 | API ou dependência indisponível | Verificar `docker-compose.prod.yml` serviços |');
  lines.push('| Mesh runner falha | Adapter não configurado para o canal | Verificar configuração de canais no tenant |');
  lines.push('| Replay não gera evidência | RPA não configurado ou browser ausente | Rodar `npx playwright install` |');
  lines.push('| GO/NO_GO retorna NO_GO | Bloqueadores ativos no enterprise governance | Rodar `npm run validate:qa-governance` e inspecionar `reports/` |');
  lines.push('| Cenário sem passos (draft) | Não passou pelo bot de geração | Usar `POST /api/qa-waves/intelligence/generate-scenario` |');
  lines.push('');

  return lines.join('\n');
}

// ─── Main ──────────────────────────────────────────────────────────────────
function main() {
  const outDir = path.join(ROOT, 'docs', 'roteiros');
  const coverageDir = path.join(ROOT, 'qa-waves', 'journey-coverage');
  const scenarioStore = readJson(path.join(ROOT, 'qa', 'qa-waves', 'scenario-store.json'));
  const contracts = readJson(path.join(ROOT, 'config', 'journey-contracts.json'));

  if (!scenarioStore) {
    console.error('scenario-store.json not found');
    process.exit(1);
  }

  const storeScenarios = Array.isArray(scenarioStore.scenarios) ? scenarioStore.scenarios : [];

  if (!fs.existsSync(coverageDir)) {
    console.error('journey-coverage directory not found');
    process.exit(1);
  }

  let totalGenerated = 0;
  for (const file of fs.readdirSync(coverageDir)) {
    if (!file.endsWith('.json')) continue;
    const data = readJson(path.join(coverageDir, file));
    if (!data || !Array.isArray(data.journeys)) continue;

    const vertical = data.vertical || file.replace('.json', '');
    for (const journey of data.journeys) {
      const content = generateJourneyRunbook(journey, journey.scenarios || [], storeScenarios, contracts);
      const fname = `jornada-${safeId(vertical)}-${safeId(journey.journey)}.md`;
      writeText(path.join(outDir, fname), content);
      totalGenerated++;
    }
  }

  // Generate index
  const indexLines = ['# QA Waves — Roteiros por Jornada', '', `Gerado: ${new Date().toISOString()}`, `Total de jornadas: ${totalGenerated}`, ''];
  indexLines.push('| Vertical | Jornada | Cenários | Aprovados |');
  indexLines.push('|---|---|---|---|');
  for (const file of fs.readdirSync(coverageDir).sort()) {
    if (!file.endsWith('.json')) continue;
    const data = readJson(path.join(coverageDir, file));
    if (!data || !Array.isArray(data.journeys)) continue;
    const vertical = data.vertical || file.replace('.json', '');
    for (const journey of data.journeys) {
      const scenarios = journey.scenarios || [];
      const approved = scenarios.filter(s => {
        const storeS = storeScenarios.find(ss => ss.id === s.scenarioId);
        return storeS && storeS.status === 'approved';
      });
      const fname = `jornada-${safeId(vertical)}-${safeId(journey.journey)}.md`;
      indexLines.push(`| ${VERTICAL_LABELS[vertical] || vertical} | [${journey.journey}](${fname}) | ${scenarios.length} | ${approved.length} |`);
    }
  }
  writeText(path.join(outDir, 'README.md'), indexLines.join('\n'));

  console.log(`✅ ${totalGenerated} roteiros de jornada gerados`);
  console.log(`📁 Output: ${outDir}`);
}

if (require.main === module) {
  main();
}

module.exports = { main, generateJourneyRunbook };
