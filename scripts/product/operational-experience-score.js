'use strict';

/**
 * Operational Experience Score (P4.14) — avaliação executável da experiência
 * operacional do RAP, SEPARADA do Master Scorecard técnico de governança.
 *
 * Princípios:
 * - NÃO é auto-aprovado por existência de código: cada dimensão é medida por
 *   probes EXECUTÁVEIS (suítes de comportamento que precisam passar de
 *   verdade) e por artefatos canônicos validados por predicado.
 * - Métricas de produto medidas em banco real (quando disponível) são
 *   anexadas como evidência `measured` — nunca inventadas; quando a
 *   medição não é possível, o campo diz explicitamente `available: false`.
 * - Gaps são reportados, não mascarados: qualquer probe falho vira gap
 *   aberto na dimensão correspondente.
 *
 * Uso:
 *   node scripts/product/operational-experience-score.js [--gate N] [--json]
 *
 * Saída: reports/operational-experience-score.json + tabela no console.
 * Exit code: 0 por padrão; com --gate N, sai 1 se overallScore < N.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT, 'reports', 'operational-experience-score.json');

/**
 * Dimensões da experiência operacional e seus probes.
 * kind: 'jest' | 'vitest' | 'artifact'
 */
const DIMENSIONS = [
  {
    id: 'workspace-context',
    label: 'Workspace Context (Customer 360)',
    probes: [
      { kind: 'jest', ref: 'tests/unit/workspaceChurnInsight.test.js' },
      { kind: 'jest', ref: 'tests/unit/workspaceNoShowInsight.test.js' },
      { kind: 'vitest', ref: 'frontend/src/pages/WorkspacePage.test.jsx' },
    ],
  },
  {
    id: 'workspace-actions',
    label: 'Workspace Actions (execução contextual)',
    probes: [
      { kind: 'jest', ref: 'tests/unit/recommendationActionExecution.test.js' },
      { kind: 'jest', ref: 'tests/unit/workspaceTenantRecommendation.test.js' },
    ],
  },
  {
    id: 'inbox-speed',
    label: 'Inbox Speed (listagem, batching, realtime)',
    probes: [
      { kind: 'jest', ref: 'tests/unit/inboxConversations.test.js' },
      { kind: 'jest', ref: 'tests/unit/inboxModuleRoutes.test.js' },
    ],
  },
  {
    id: 'inbox-context',
    label: 'Inbox Context (inteligência da conversa)',
    probes: [
      { kind: 'vitest', ref: 'frontend/src/pages/InboxPage.test.jsx' },
    ],
  },
  {
    id: 'inbox-productivity',
    label: 'Inbox Productivity (quick replies, offline outbox)',
    probes: [
      { kind: 'vitest', ref: 'frontend/src/pwa/inboxOutbox.test.js' },
      { kind: 'jest', ref: 'tests/unit/quickRepliesService.coercion.test.js' },
    ],
  },
  {
    id: 'navigation-simplicity',
    label: 'Navigation Simplicity (segregação de superfícies)',
    probes: [
      { kind: 'jest', ref: 'tests/unit/workspaceApiSegregation.test.js' },
      {
        kind: 'artifact',
        ref: 'reports/experience-segregation-report.json',
        expect: (data) => data && data.status === 'PASS' && Number(data.violationCount) === 0,
        evidence: (data) => `status=${data?.status} violations=${data?.violationCount}`,
      },
    ],
  },
  {
    id: 'next-best-action',
    label: 'Next Best Action (contrato executável)',
    probes: [
      { kind: 'jest', ref: 'tests/unit/workspaceTenantRecommendation.test.js' },
      { kind: 'jest', ref: 'tests/unit/tenantRecommendationPrioritization.test.js' },
    ],
  },
  {
    id: 'decision-intelligence',
    label: 'Decision Intelligence (stats, outcome, priorização)',
    probes: [
      { kind: 'jest', ref: 'tests/unit/tenantRecommendationStats.test.js' },
      { kind: 'jest', ref: 'tests/unit/tenantRecommendationOutcome.test.js' },
      { kind: 'jest', ref: 'tests/unit/recommendationOutcomeSignals.test.js' },
    ],
  },
  {
    id: 'autonomy-ux',
    label: 'Autonomy UX (suggest/approve/autonomous)',
    probes: [
      { kind: 'jest', ref: 'tests/unit/tenantRecommendationAutonomy.test.js' },
    ],
  },
  {
    id: 'mobile',
    label: 'Mobile (PWA, push, offline)',
    probes: [
      { kind: 'jest', ref: 'tests/unit/mobileStrategyDecision.test.js' },
      { kind: 'jest', ref: 'tests/unit/pushNotificationService.test.js' },
      { kind: 'vitest', ref: 'frontend/src/components/InstallPwaPrompt.test.jsx' },
    ],
  },
  {
    id: 'onboarding',
    label: 'Onboarding (vertical → configuração real)',
    probes: [
      { kind: 'jest', ref: 'tests/unit/onboardingService.vertical.test.js' },
      { kind: 'vitest', ref: 'frontend/src/__tests__/OnboardingPage.vertical.test.jsx' },
    ],
  },
  {
    id: 'vertical-depth',
    label: 'Vertical Depth (jornadas executáveis por vertical)',
    probes: [
      {
        kind: 'artifact',
        ref: 'config/qa-waves-registry.json',
        expect: (data) => {
          const verticals = Object.keys(data?.verticalJourneys || {});
          return verticals.length >= 7 && verticals.every((v) => {
            const journeys = data.verticalJourneys[v] || {};
            return Object.values(journeys).every((j) => j && j.name && Array.isArray(j.steps) && j.steps.length >= 5);
          });
        },
        evidence: (data) => `verticals=${Object.keys(data?.verticalJourneys || {}).length}`,
      },
      { kind: 'jest', ref: 'tests/unit/verticalMetricsEngine.test.js' },
    ],
  },
  {
    id: 'outcome-language',
    label: 'Outcome Language (sem vazamento técnico em PRODUCTION)',
    probes: [
      {
        kind: 'artifact',
        ref: 'reports/experience-segregation-report.json',
        expect: (data) => data && data.status === 'PASS' && Number(data.violationCount) === 0,
        evidence: (data) => `status=${data?.status} violations=${data?.violationCount}`,
      },
    ],
  },
  {
    id: 'voice-digital',
    label: 'Voice + Digital (chamada → timeline → intent → NBA)',
    probes: [
      { kind: 'jest', ref: 'tests/unit/voiceRecordingLinkService.test.js' },
      { kind: 'jest', ref: 'tests/unit/callInsightBridgeService.test.js' },
    ],
  },
  {
    id: 'manager-experience',
    label: 'Manager Experience (gestão por exceção)',
    probes: [
      { kind: 'jest', ref: 'tests/unit/tenantAttentionQueue.test.js' },
      { kind: 'vitest', ref: 'frontend/src/pages/analytics/AnalyticsAttentionSection.test.jsx' },
    ],
  },
];

function execTolerant(cmd, args, cwd) {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    // jest/vitest saem com código != 0 quando alguma suíte falha: o probe
    // falho deve derrubar o score da dimensão, não abortar a medição toda.
    if (err.stdout) return err.stdout;
    throw err;
  }
}

function runJest(files) {
  if (files.length === 0) return {};
  const out = execTolerant('npx', ['jest', '--json', ...files], ROOT);
  const parsed = JSON.parse(out);
  const results = {};
  for (const suite of parsed.testResults || []) {
    const rel = path.relative(ROOT, suite.name);
    results[rel] = suite.status === 'passed';
  }
  return results;
}

function runVitest(files) {
  if (files.length === 0) return {};
  const relFiles = files.map((f) => path.relative(path.join(ROOT, 'frontend'), path.join(ROOT, f)));
  const out = execTolerant('npx', ['vitest', 'run', '--reporter=json', ...relFiles], path.join(ROOT, 'frontend'));
  const parsed = JSON.parse(out);
  const results = {};
  for (const suite of parsed.testResults || []) {
    const abs = suite.name;
    const rel = path.relative(ROOT, abs);
    results[rel] = (suite.status || (suite.assertionResults?.every((a) => a.status === 'passed') ? 'passed' : 'failed')) === 'passed';
  }
  return results;
}

function evalArtifact(probe) {
  const abs = path.join(ROOT, probe.ref);
  if (!fs.existsSync(abs)) {
    return { status: 'fail', evidence: `artefato ausente: ${probe.ref}` };
  }
  try {
    const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const ok = probe.expect(data);
    return { status: ok ? 'pass' : 'fail', evidence: probe.evidence ? probe.evidence(data) : String(ok) };
  } catch (err) {
    return { status: 'fail', evidence: `artefato ilegível: ${err.message}` };
  }
}

async function measureProductMetrics() {
  const databaseUrl = process.env.TEST_DATABASE_URL
    || 'postgresql://results_app:StrongPass@localhost:5433/results_saas';
  try {
    process.env.TEST_DATABASE_URL = databaseUrl;
    // eslint-disable-next-line global-require
    const { connect, getSequelize } = require('../../api/db/sequelize');
    await connect();
    // eslint-disable-next-line global-require
    const { getProductMetricsSummary } = require('../../api/services/productMetricsService');
    const summary = await getProductMetricsSummary({ tenantId: 'system', windowDays: 30 });
    await getSequelize().close();
    return {
      available: true,
      database: 'docker results_saas (localhost:5433)',
      tenantId: 'system',
      timeToFirstResponse: summary.timeToFirstResponse,
      timeToFirstValue: {
        available: summary.timeToFirstValue?.available,
        seconds: summary.timeToFirstValue?.seconds,
      },
      navigation: summary.navigation,
      clicksPerCoreSurface: summary.clicksPerCoreSurface,
    };
  } catch (err) {
    return { available: false, reason: err.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const gateIdx = args.indexOf('--gate');
  const gate = gateIdx >= 0 ? Number(args[gateIdx + 1]) : null;

  const jestFiles = [...new Set(DIMENSIONS.flatMap((d) => d.probes.filter((p) => p.kind === 'jest').map((p) => p.ref)))];
  const vitestFiles = [...new Set(DIMENSIONS.flatMap((d) => d.probes.filter((p) => p.kind === 'vitest').map((p) => p.ref)))];

  console.log(`[opex-score] Executando ${jestFiles.length} suítes jest e ${vitestFiles.length} suítes vitest como probes...`);
  const jestResults = runJest(jestFiles);
  const vitestResults = runVitest(vitestFiles);

  const dimensions = DIMENSIONS.map((dimension) => {
    const probes = dimension.probes.map((probe) => {
      if (probe.kind === 'artifact') {
        const result = evalArtifact(probe);
        return { kind: probe.kind, ref: probe.ref, status: result.status, evidence: result.evidence };
      }
      const table = probe.kind === 'jest' ? jestResults : vitestResults;
      const passed = table[probe.ref];
      return {
        kind: probe.kind,
        ref: probe.ref,
        status: passed === true ? 'pass' : 'fail',
        evidence: passed === true ? 'suíte executada e verde' : 'suíte falhou ou não foi executada',
      };
    });
    const passed = probes.filter((p) => p.status === 'pass').length;
    const score = probes.length > 0 ? Math.round((passed / probes.length) * 100) / 10 : 0;
    const gaps = probes.filter((p) => p.status !== 'pass').map((p) => `${p.ref}: ${p.evidence}`);
    return { id: dimension.id, label: dimension.label, score, probes, gaps };
  });

  const overall = Math.round((dimensions.reduce((acc, d) => acc + d.score, 0) / dimensions.length) * 10) / 10;
  const measured = await measureProductMetrics();

  const report = {
    artifactType: 'operational-experience-score',
    scoreVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    overallScore: overall,
    maxScore: 10,
    dimensionsEvaluated: dimensions.length,
    dimensionsAt10: dimensions.filter((d) => d.score === 10).length,
    dimensions,
    measured,
    note: 'Score executável de experiência operacional — separado do Master Scorecard técnico de governança. Cada ponto vem de probe executado (suíte verde ou artefato validado por predicado), nunca de existência de código.',
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  console.log('\n=== OPERATIONAL EXPERIENCE SCORE ===');
  for (const d of dimensions) {
    const mark = d.score === 10 ? '✓' : '✗';
    console.log(` ${mark} ${d.label.padEnd(58)} ${d.score.toFixed(1)}/10`);
    for (const gap of d.gaps) console.log(`     gap: ${gap}`);
  }
  console.log(`\n OVERALL: ${overall.toFixed(1)}/10 (${report.dimensionsAt10}/${dimensions.length} dimensões em 10)`);
  console.log(` Measured (produto real): ${measured.available ? 'disponível — ver relatório' : `indisponível (${measured.reason})`}`);
  console.log(` Relatório: ${path.relative(ROOT, REPORT_PATH)}`);

  if (gate != null && overall < gate) {
    console.error(`\n[opex-score] GATE FAIL: overall ${overall} < ${gate}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[opex-score] Falha ao executar o score:', err.message);
    process.exit(1);
  });
}

module.exports = { DIMENSIONS, ROOT, REPORT_PATH };
