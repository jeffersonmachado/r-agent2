'use strict';

/**
 * generate-journey-runbooks — roteiros operacionais por jornada.
 *
 * §A1–A6 (missão corretiva): o roteiro gerado em `docs/roteiros/jornada-*.md` é
 * classificado `OPERATIONAL/PRODUCTION` pelo `scripts/rag-sync.js` e portanto é
 * indexado no RAG que alimenta o copiloto do operador. Antes desta correção ele
 * expunha: `replay=true`, `Replay (se aplicável)`, `qa-mesh/meshHistory/`,
 * `waveScenarioSchema.js`, `POST /api/qa-waves/intelligence/generate-scenario`,
 * `npx playwright install`, `npm run validate:replay-governance`, IDs de cenário
 * e tabelas de passos com adapter/timeout.
 *
 * Agora o gerador produz DOIS artefatos:
 *
 *   1. `docs/roteiros/jornada-*.md`          — PRODUCTION, operacional, limpo;
 *   2. `qa-waves/journey-provenance/*.json`  — DEVELOPMENT, prova interna
 *      (cenários, passos, adapter/timeout, validações, caminhos de evidência e
 *      gates). A auditoria NÃO é perdida: ela apenas deixa de vazar para o
 *      conteúdo que o operador e o modelo de produção leem.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const {
  assertProductionClean, detectProductionLeaks,
} = require('../../api/services/learning/manualSanitizer');

// §A9: mesma taxonomia usada pelo rag-sync para decidir o que é PRODUCTION.
const {
  isProductionSurface,
} = require('../../api/services/rag/knowledgeSurfaceClassification');

const PROVENANCE_DIR = path.join(ROOT, 'qa-waves', 'journey-provenance');
// §A2/segregação: roteiro TÉCNICO (RPA, replay, editor de fluxos, QA) é
// DEVELOPMENT e não pode ocupar a superfície PRODUCTION `docs/roteiros`.
const DEV_RUNBOOKS_DIR = path.join(ROOT, 'qa-waves', 'journey-runbooks-dev');

/**
 * Classifica a jornada por SUPERFÍCIE. O nome/vertical revela o domínio: uma
 * jornada de RPA/replay/QA/editor de fluxos é ferramenta de engenharia, não
 * procedimento de operador.
 */
const TECHNICAL_JOURNEY_PATTERNS = Object.freeze([
  /\brpa\b/i,
  /\breplay\b/i,
  /\bqawaves?\b/i,
  /\bqa[_ -]?mesh\b/i,
  /flows?[_ -]?editor/i,
  /[_ -]editor\b/i,
  /\bseed(s)?\b/i,
  /\bbenchmark\b/i,
  /\bmcp\b/i,
  /\bdev(hub|tools?)?\b/i,
  /\btooling\b/i,
  /\bscenario[_ -]?builder\b/i,
  /[_ -]coverage\b/i,
  /\bregression\b/i,
  /\bvalidation[_ -]?wave\b/i,
  /\bsynthetic\b/i,
]);

function isTechnicalJourney(journey) {
  const haystack = [journey.journey, journey.vertical, journey.area, journey.journeyId]
    .filter(Boolean).join(' ');
  return TECHNICAL_JOURNEY_PATTERNS.some((re) => re.test(haystack));
}

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

/** Rótulos de passo em linguagem OPERACIONAL (nunca tipo técnico de adapter). */
const STEP_TYPE_LABELS = {
  trigger_channel_event: 'Receber a solicitação do cliente',
  send_message: 'Responder ao cliente',
  validate_intent: 'Confirmar a intenção do cliente',
  ai_decision: 'Avaliar a solicitação',
  validate_backend: 'Verificar os dados do cadastro',
  backend_action: 'Registrar a operação no sistema',
  validate_state: 'Confirmar que o estado foi atualizado',
  wait_for_event: 'Aguardar a resposta do cliente',
  human_handoff: 'Encaminhar o atendimento para uma pessoa',
  checkpoint: 'Registrar o ponto de controle',
};

function titleCaseFromId(journeyId) {
  return String(journeyId || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Nome de capability em linguagem de operador (sem taxonomia interna crua). */
function operationalCapabilityLabel(capability) {
  return String(capability || '')
    .split('.')
    .slice(1)
    .join(' ')
    .replace(/_/g, ' ')
    .trim() || String(capability || '');
}

/**
 * Conteúdo OPERACIONAL (PRODUCTION) do roteiro — sem replay, sem QA, sem
 * caminho interno, sem comando de gate, sem ID de cenário.
 */
function renderOperationalRunbook(journey, coverageScenarios, storeScenarios, contracts) {
  const lines = [];
  const vertical = journey.vertical;
  const journeyId = journey.journey;
  const verticalLabel = VERTICAL_LABELS[vertical] || vertical;
  const scenarios = coverageScenarios || [];

  lines.push(`# ${verticalLabel} — ${titleCaseFromId(journeyId)}`);
  lines.push('');
  lines.push('> Roteiro operacional. Descreve como atender esta jornada no dia a dia.');
  lines.push('');

  lines.push('## 1. Objetivo');
  lines.push('');
  const journeyContract = (contracts?.journeys || {})[journeyId];
  if (journeyContract && Array.isArray(journeyContract.requiredCapabilities)) {
    lines.push(`Executar o atendimento completo da jornada **${titleCaseFromId(journeyId)}** na vertical ${verticalLabel}, concluindo cada etapa abaixo antes de seguir para a próxima.`);
    lines.push('');
    lines.push('**Recursos necessários para esta jornada:**');
    for (const cap of journeyContract.requiredCapabilities) {
      lines.push(`- ${operationalCapabilityLabel(cap)}`);
    }
  } else {
    lines.push(`Executar o atendimento completo da jornada **${titleCaseFromId(journeyId)}** na vertical ${verticalLabel}.`);
  }
  lines.push('');

  lines.push('## 2. Antes de começar');
  lines.push('');
  lines.push('| Condição | Obrigatória |');
  lines.push('|---|---|');
  lines.push('| Acesso ao sistema com seu usuário de operação | Sim |');
  lines.push(`| Unidade/tenant configurado para ${verticalLabel} | Sim |`);
  lines.push('| Canal de atendimento do cliente ativo | Sim |');
  lines.push('');

  lines.push('## 3. Passo a passo do atendimento');
  lines.push('');

  const storeSteps = [];
  for (const scenario of scenarios) {
    const storeS = storeScenarios.find((ss) => ss.id === scenario.scenarioId);
    if (storeS && Array.isArray(storeS.steps) && storeS.steps.length > 0) {
      storeSteps.push({ steps: storeS.steps });
    }
  }

  if (storeSteps.length === 0) {
    lines.push('Esta jornada ainda não possui roteiro detalhado publicado. Atenda conforme o procedimento padrão da vertical e registre o atendimento no sistema.');
    lines.push('');
  } else {
    let order = 0;
    for (const group of storeSteps) {
      for (const step of group.steps.slice().sort((a, b) => (a.order || 0) - (b.order || 0))) {
        order += 1;
        const label = STEP_TYPE_LABELS[step.type] || 'Executar a etapa';
        const detail = step.name ? ` — ${String(step.name).replace(/[_]+/g, ' ')}` : '';
        lines.push(`${order}. **${label}**${detail}`);
      }
    }
    lines.push('');
  }

  lines.push('## 4. Resultado esperado');
  lines.push('');
  lines.push('- O cliente recebe a confirmação do atendimento.');
  lines.push('- O registro correspondente fica atualizado no sistema.');
  lines.push('- Não há pendência aberta para o cliente ao final do atendimento.');
  lines.push('');

  lines.push('## 5. Quando não for possível concluir');
  lines.push('');
  lines.push('- Verifique se você tem a permissão necessária para a operação.');
  lines.push('- Confira se o cadastro do cliente está em situação regular para esta jornada.');
  lines.push('- Se a dificuldade persistir, encaminhe o caso ao suporte informando o identificador do atendimento.');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

/**
 * Artefato INTERNO (DEVELOPMENT) com toda a prova técnica que saiu do roteiro
 * operacional. Mantém a auditoria de QA/RPA sem contaminar PRODUCTION.
 */
function renderProvenanceArtifact(journey, coverageScenarios, storeScenarios, contracts) {
  const journeyId = journey.journey;
  const scenarios = coverageScenarios || [];
  const journeyContract = (contracts?.journeys || {})[journeyId] || null;

  return {
    artifactType: 'journey-provenance',
    artifactVersion: '1.0.0',
    // §A2: proveniência interna vive em SUPPORT/DEVELOPMENT.
    classification: 'DEVELOPMENT',
    domain: 'SYSTEM',
    generatedAt: new Date().toISOString(),
    vertical: journey.vertical,
    journeyId,
    replaySupport: Boolean(journey.replaySupport),
    requiredCapabilities: journeyContract && Array.isArray(journeyContract.requiredCapabilities)
      ? journeyContract.requiredCapabilities
      : [],
    contractConfidence: journeyContract ? journeyContract.confidence : null,
    scenarios: scenarios.map((scenario) => {
      const storeS = storeScenarios.find((ss) => ss.id === scenario.scenarioId) || null;
      return {
        scenarioId: scenario.scenarioId,
        scenario: scenario.scenario || null,
        status: storeS ? storeS.status : scenario.status,
        channels: scenario.channels || [],
        preconditions: scenario.preconditions || [],
        integrations: scenario.integrations || [],
        validations: storeS ? (storeS.validations || null) : null,
        steps: storeS && Array.isArray(storeS.steps)
          ? storeS.steps.map((step) => ({
            order: step.order,
            type: step.type,
            name: step.name || null,
            adapter: step.adapter || null,
            channel: step.channel || null,
            timeoutMs: step.timeoutMs || null,
          }))
          : [],
      };
    }),
    expectedEvidence: [
      { artifact: 'execution-result', format: 'json', location: 'qa-mesh/meshHistory/' },
      { artifact: 'go-no-go', format: 'json', location: 'qa-mesh/go-no-go-report.json' },
      { artifact: 'replay', format: 'json+trace', location: 'qa/ (governado)' },
      { artifact: 'smoke-evidence', format: 'json', location: 'qa/smoke/prod-like/' },
    ],
    governanceGates: [
      'npm run validate:qa-governance',
      'npm run validate:qa-waves-registry',
      'npm run validate:replay-governance',
      'npm run validate:self-proving',
    ],
  };
}

/** Compatibilidade: assinatura antiga continua produzindo o roteiro operacional. */
function generateJourneyRunbook(journey, coverageScenarios, storeScenarios, contracts) {
  const markdown = renderOperationalRunbook(journey, coverageScenarios, storeScenarios, contracts);
  // Backstop fail-closed: um roteiro PRODUCTION não sai com detalhe interno.
  const leaks = detectProductionLeaks(markdown);
  if (leaks.length > 0) {
    assertProductionClean(markdown, `roteiro PRODUCTION ${journey.journey}`);
  }
  return markdown;
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
  let totalTechnical = 0;
  const indexRows = [];

  for (const file of fs.readdirSync(coverageDir)) {
    if (!file.endsWith('.json')) continue;
    const data = readJson(path.join(coverageDir, file));
    if (!data || !Array.isArray(data.journeys)) continue;
    const vertical = data.vertical || file.replace('.json', '');
    for (const journey of data.journeys) {
      const scenarios = journey.scenarios || [];
      const technical = isTechnicalJourney(journey) || vertical === 'core';
      const fname = `jornada-${safeId(vertical)}-${safeId(journey.journey)}.md`;

      if (technical) {
        // Ferramenta de engenharia: fica na superfície DEVELOPMENT, onde a
        // prova técnica é legítima e necessária.
        const devContent = [
          `# [DEVELOPMENT] ${titleCaseFromId(journey.journey)}`,
          '',
          '> Documento interno de engenharia (QA/RPA). NÃO é procedimento de operador.',
          '',
          'A prova técnica completa está no artefato de proveniência desta jornada.',
          '',
        ].join('\n');
        writeText(path.join(DEV_RUNBOOKS_DIR, fname), devContent);
        totalTechnical += 1;
      } else {
        const content = generateJourneyRunbook(journey, scenarios, storeScenarios, contracts);
        writeText(path.join(outDir, fname), content);
        totalGenerated += 1;
        indexRows.push({
          verticalLabel: VERTICAL_LABELS[vertical] || vertical,
          journey: journey.journey,
          fname,
        });
      }

      // Prova interna correspondente — sempre, operacional ou técnica.
      const provenance = renderProvenanceArtifact(journey, scenarios, storeScenarios, contracts);
      if (technical) provenance.surface = 'DEVELOPMENT';
      const pname = `${fname.replace(/\.md$/, '')}.provenance.json`;
      writeText(path.join(PROVENANCE_DIR, pname), `${JSON.stringify(provenance, null, 2)}\n`);
    }
  }

  const indexLines = ['# Roteiros operacionais por jornada', '', 'Consultas operacionais para o atendimento diário.', ''];
  indexLines.push('| Vertical | Jornada |');
  indexLines.push('|---|---|');
  for (const row of indexRows.sort((a, b) => `${a.verticalLabel}${a.journey}`.localeCompare(`${b.verticalLabel}${b.journey}`))) {
    indexLines.push(`| ${row.verticalLabel} | [${row.journey}](${row.fname}) |`);
  }
  writeText(path.join(outDir, 'README.md'), `${indexLines.join('\n')}\n`);

  // Backstop final: exige limpeza APENAS em superfície PRODUCTION. Arquivos
  // SUPPORT (`docs/roteiros/manual-*`, `docs/roteiros/treinamento-*`) podem
  // manter proveniência técnica por classificação (§A2) — não são vistos pelo
  // usuário PRODUCTION nem entram no escopo PRODUCTION do copiloto.
  const leaked = [];
  for (const name of fs.readdirSync(outDir)) {
    if (!name.endsWith('.md')) continue;
    const rel = path.posix.join('docs/roteiros', name);
    if (!isProductionSurface(rel)) continue;
    const content = fs.readFileSync(path.join(outDir, name), 'utf8');
    for (const leak of detectProductionLeaks(content)) leaked.push(`${name}: ${leak.ruleId}("${leak.match}")`);
  }
  if (leaked.length > 0) {
    console.error('❌ Conteúdo PRODUCTION com detalhe interno:');
    for (const item of leaked) console.error(`   - ${item}`);
    process.exit(1);
  }

  console.log(`✅ ${totalGenerated} roteiros operacionais (PRODUCTION) gerados`);
  console.log(`🔧 ${totalTechnical} roteiros técnicos roteados para DEVELOPMENT`);
  console.log(`📁 Output operacional: ${outDir}`);
  console.log(`📁 Roteiros técnicos: ${DEV_RUNBOOKS_DIR}`);
  console.log(`📁 Proveniência interna: ${PROVENANCE_DIR}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  generateJourneyRunbook,
  renderOperationalRunbook,
  renderProvenanceArtifact,
  isTechnicalJourney,
  PROVENANCE_DIR,
  DEV_RUNBOOKS_DIR,
};
