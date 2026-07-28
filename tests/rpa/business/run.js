#!/usr/bin/env node
'use strict';

const { assertLegacyEntrypointAllowed } = require('../../../core/rpa/legacyEntrypointGuard');
const { SCREEN_SCENARIOS, FLOW_SCENARIOS, JOURNEY_SCENARIOS, listCatalog } = require('./catalog');
const { createRunContext, startScenario, executeStep, finalizeScenario, writeRunReport } = require('./reporting');
const {
  createApiClient,
  createUiSession,
  seedBusinessBaseline,
  runScreenScenario,
  runFlowScenario,
  runJourneyScenario,
  saveCatalogSnapshot,
  FRONTEND_URL,
  API_URL,
} = require('./runtime');

function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    const item = String(raw || '');
    if (!item.startsWith('--')) continue;
    const [key, value] = item.slice(2).split('=');
    args[key] = value === undefined ? '1' : value;
  }
  return args;
}

function selectScenarios(args) {
  const mode = args.mode || args.level || 'pr';
  let items = [];
  if (mode === 'screens') items = SCREEN_SCENARIOS;
  else if (mode === 'flows') items = FLOW_SCENARIOS;
  else if (mode === 'journeys') items = JOURNEY_SCENARIOS;
  else if (mode === 'pr') items = [...SCREEN_SCENARIOS, ...FLOW_SCENARIOS.filter((item) => item.criticality === 'high')];
  else if (mode === 'homolog') items = [...SCREEN_SCENARIOS, ...FLOW_SCENARIOS, ...JOURNEY_SCENARIOS];
  else if (mode === 'release') items = JOURNEY_SCENARIOS.filter((item) => ['F1', 'B1', 'F2', 'B2'].includes(item.code));
  else items = listCatalog();

  if (args.type) {
    items = items.filter((item) => item.type === args.type);
  }
  if (args.vertical) {
    items = items.filter((item) => item.vertical === args.vertical);
  }
  if (args.code) {
    const target = String(args.code).split(',').map((item) => item.trim()).filter(Boolean);
    items = items.filter((item) => target.includes(item.code));
  }
  return items;
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.catalog === '1' || args.mode === 'catalog') {
    const out = await saveCatalogSnapshot(listCatalog());
    console.log(`Catalogo salvo em:\n- ${out.jsonPath}\n- ${out.mdPath}`);
    return;
  }

  if (args.mode === 'seed' || args.mode === 'seed-reset') {
    const api = await createApiClient();
    const seed = await seedBusinessBaseline(api);
    console.log('Baseline Business QA aplicada:');
    console.log(JSON.stringify(seed, null, 2));
    return;
  }

  const scenarios = selectScenarios(args);
  if (!scenarios.length) {
    throw new Error('Nenhum cenário selecionado para execução');
  }

  const run = createRunContext({
    mode: args.mode || 'pr',
    frontendUrl: FRONTEND_URL,
    apiUrl: API_URL,
    selectedCodes: scenarios.map((item) => item.code),
  });

  const api = await createApiClient();
  const seed = await seedBusinessBaseline(api);
  const runId = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const needsUi = scenarios.some((item) => item.type === 'screen' || (Array.isArray(item.pages) && item.pages.length > 0));
  const ui = needsUi ? await createUiSession() : null;

  try {
    for (const definition of scenarios) {
      const scenario = startScenario(run, definition);
      try {
        await executeStep(scenario, 'seed-baseline', async () => ({
          detail: 'Baseline determinística validada',
          ids: {
            tenantId: seed.tenantId,
            baselineFitnessMembershipId: seed.fitness.membershipId,
            baselineBeautyCampaignId: seed.beauty.campaignId,
          },
        }));

        if (definition.type === 'screen') {
          await executeStep(scenario, 'screen-validation', async () => runScreenScenario(definition, {
            api,
            page: ui.page,
            runId,
            seed,
          }));
        } else if (definition.type === 'flow') {
          await executeStep(scenario, 'flow-validation', async () => runFlowScenario(definition, {
            api,
            page: ui ? ui.page : null,
            runId,
            seed,
          }));
        } else if (definition.type === 'journey') {
          await executeStep(scenario, 'journey-validation', async () => runJourneyScenario(definition, {
            api,
            runId,
            seed,
          }));
        } else {
          throw new Error(`Tipo de cenário não suportado: ${definition.type}`);
        }
        finalizeScenario(scenario);
      } catch (error) {
        finalizeScenario(scenario, error);
      }
    }
  } finally {
    if (ui?.browser) {
      await ui.browser.close().catch(() => null);
    }
  }

  const reportPaths = writeRunReport(run);
  console.log(`Business QA concluído: ${run.summary.status}`);
  console.log(`- PASS: ${run.summary.passed}`);
  console.log(`- FAIL: ${run.summary.failed}`);
  console.log(`- JSON: ${reportPaths.jsonPath}`);
  console.log(`- Markdown: ${reportPaths.mdPath}`);
  if (run.summary.failed > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  assertLegacyEntrypointAllowed('tests/rpa/business/run.js');
  main().catch((error) => {
    console.error('[business-qa] erro fatal:', error);
    process.exit(1);
  });
}

module.exports = {
  main,
};
