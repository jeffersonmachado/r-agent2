'use strict';

/**
 * finalize-drafts.js
 *
 * Finaliza cenários draft_ai do scenario-store em lote para destravar a
 * cobertura do QA Waves:
 *
 *   1. Corrige o `vertical` quando o journeyId pertence a um domínio canônico
 *      no registry do mesh (a geração automática usava `vertical: 'core'`
 *      como default, duplicando jornadas entre verticais).
 *   2. Vincula `platformScenarioIds` aos cenários do registry com o mesmo
 *      `journeyId` (e, preferencialmente, o mesmo domínio).
 *   3. Promove status para `approved` (executável).
 *
 * Sem o vínculo de plataforma e a aprovação, o cenário nunca executa
 * (MISSING_PLATFORM_SCENARIO_IDS / SCENARIO_NOT_APPROVED) e nunca conta na
 * métrica de cobertura (executedRate = % de cenários com runs > 0).
 *
 * Uso:
 *   node scripts/qa-waves/finalize-drafts.js                # dry-run (default)
 *   node scripts/qa-waves/finalize-drafts.js --apply        # aplica as mudanças
 *   node scripts/qa-waves/finalize-drafts.js --statuses draft_ai,draft
 *   node scripts/qa-waves/finalize-drafts.js --status-target active
 *
 * Default: finaliza draft_ai/approved/active — cenários em status executável
 * (approved/active/regression) têm apenas o vínculo preenchido (status é
 * preservado); cenários não-executáveis são promovidos a approved.
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
process.env.QA_WAVES_SCENARIO_STORE_PATH = process.env.QA_WAVES_SCENARIO_STORE_PATH
  || path.join(ROOT, 'qa', 'qa-waves', 'scenario-store.json');

const qaWavesScenarioService = require('../../api/services/qaWavesScenarioService');
const qaMeshService = require('../../api/services/qaMeshService');

function parseArgs(argv) {
  const args = {
    apply: false,
    statuses: ['draft_ai', 'approved', 'active'],
    statusTarget: 'approved',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--apply') args.apply = true;
    if (token === '--statuses' && argv[i + 1]) {
      args.statuses = argv[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
      i += 1;
    }
    if (token.startsWith('--statuses=')) {
      args.statuses = token.slice('--statuses='.length).split(',').map((s) => s.trim()).filter(Boolean);
    }
    if (token === '--status-target' && argv[i + 1]) {
      args.statusTarget = argv[i + 1].trim() || 'approved';
      i += 1;
    }
    if (token.startsWith('--status-target=')) {
      args.statusTarget = token.slice('--status-target='.length).trim() || 'approved';
    }
  }
  return args;
}

/**
 * journeyId → { domains: Set<string>, items: [{ id, domain }] }
 */
function buildRegistryIndex() {
  const registry = qaMeshService.getRegistry() || [];
  const index = new Map();
  for (const item of registry) {
    const journeyId = String(item.journeyId || '').trim();
    const domain = String(item.domain || '').trim();
    const id = String(item.id || '').trim();
    if (!journeyId || !id) continue;
    if (!index.has(journeyId)) index.set(journeyId, { domains: new Set(), items: [] });
    const entry = index.get(journeyId);
    if (domain) entry.domains.add(domain);
    entry.items.push({ id, domain });
  }
  return index;
}

/**
 * Determina o vertical canônico para o cenário a partir do journeyId.
 * Mantém o vertical atual quando o journeyId é ambíguo (pertence a mais de um
 * domínio) e o vertical atual já é um dos candidatos.
 */
function resolveVertical(scenario, index) {
  const current = String(scenario.vertical || '').trim();
  const journeyId = String(scenario.journeyId || scenario.journey || '').trim();
  const entry = journeyId ? index.get(journeyId) : null;
  if (!entry || entry.domains.size === 0) return current || 'core';

  const domains = Array.from(entry.domains);
  if (domains.length === 1) return domains[0];
  // Ambíguo: prefere o vertical atual se ele for um domínio candidato válido.
  if (domains.includes(current) && current !== 'core') return current;
  return domains[0];
}

/**
 * Vínculo de plataforma: itens do registry com o mesmo journeyId, preferindo
 * os do mesmo domínio (targetVertical). Fallback: todos os do journeyId.
 */
function resolvePlatformScenarioIds(scenario, index, targetVertical) {
  const journeyId = String(scenario.journeyId || scenario.journey || '').trim();
  const entry = journeyId ? index.get(journeyId) : null;
  if (!entry || entry.items.length === 0) return [];

  const sameDomain = entry.items.filter((i) => i.domain === targetVertical);
  const pool = sameDomain.length > 0 ? sameDomain : entry.items;
  return pool.map((i) => i.id);
}

function currentPlatformIds(scenario) {
  return Array.from(new Set([
    ...(Array.isArray(scenario.platformScenarioIds) ? scenario.platformScenarioIds : []),
    ...(Array.isArray(scenario.platform?.platformScenarioIds) ? scenario.platform.platformScenarioIds : []),
  ].filter(Boolean)));
}

function buildPlan(scenarios, index, args) {
  const EXECUTABLE_STATUS = new Set(['approved', 'active', 'regression']);
  const plan = [];
  for (const scenario of scenarios) {
    const status = String(scenario.status || '').trim();
    if (args.statuses.length > 0 && !args.statuses.includes(status)) continue;

    const journeyId = String(scenario.journeyId || scenario.journey || '').trim();
    const targetVertical = resolveVertical(scenario, index);
    const platformIds = resolvePlatformScenarioIds(scenario, index, targetVertical);

    const currentVertical = String(scenario.vertical || '').trim();
    const currentIds = currentPlatformIds(scenario);

    const verticalChanged = Boolean(targetVertical) && targetVertical !== currentVertical;
    // Nunca sobrescreve vínculo existente: só vincula quando o cenário não
    // declara nenhum platformScenarioIds (curadoria manual é preservada).
    const idsChanged = currentIds.length === 0 && platformIds.length > 0;
    // Só promove status não-executável quando há vínculo de execução; um draft
    // sem cenário correspondente no registry permanece draft (não é executável).
    const statusChanged = !EXECUTABLE_STATUS.has(status) && platformIds.length > 0;
    const targetStatus = statusChanged ? args.statusTarget : status;

    plan.push({
      id: scenario.id,
      journeyId,
      currentVertical,
      targetVertical,
      platformIds,
      currentIds,
      status,
      targetStatus,
      linkable: platformIds.length > 0,
      verticalChanged,
      idsChanged,
      statusChanged,
    });
  }
  return plan;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const store = qaWavesScenarioService.loadScenarioStore();
  const scenarios = Array.isArray(store.scenarios) ? store.scenarios : [];
  const index = buildRegistryIndex();

  const plan = buildPlan(scenarios, index, args);
  const actionable = plan.filter((p) => p.verticalChanged || p.idsChanged || p.statusChanged);
  const linkable = plan.filter((p) => p.linkable);
  const notLinkable = plan.filter((p) => !p.linkable);

  console.log('=== QA Waves — finalização de drafts ===');
  console.log(`cenários no store: ${scenarios.length}`);
  console.log(`candidatos (status ${args.statuses.join(',')}): ${plan.length}`);
  console.log(`com vínculo possível: ${linkable.length}`);
  console.log(`sem vínculo possível: ${notLinkable.length}`);
  console.log(`com mudanças a aplicar: ${actionable.length}`);
  console.log('');

  for (const p of actionable) {
    const parts = [];
    if (p.verticalChanged) parts.push(`vertical ${p.currentVertical}→${p.targetVertical}`);
    if (p.idsChanged) parts.push(`platformScenarioIds [${p.currentIds.join(',') || '(vazio)'}]→[${p.platformIds.join(',')}]`);
    if (p.statusChanged) parts.push(`status ${p.status}→${p.targetStatus}`);
    console.log(`  ${p.id} (journey=${p.journeyId})`);
    console.log(`    ${parts.join(' | ')}`);
  }

  if (notLinkable.length > 0) {
    console.log('');
    console.log('--- sem vínculo (não alterados) ---');
    for (const p of notLinkable.slice(0, 20)) {
      console.log(`  ${p.id} (journey=${p.journeyId || '(sem)'})`);
    }
    if (notLinkable.length > 20) console.log(`  ... e mais ${notLinkable.length - 20}`);
  }

  console.log('');
  if (!args.apply) {
    console.log('[dry-run] Nenhuma alteração aplicada. Rode com --apply para escrever.');
    return;
  }

  let applied = 0;
  for (const p of actionable) {
    const scenario = scenarios.find((s) => s.id === p.id);
    if (!scenario) continue;
    const changes = [];
    const updated = { ...scenario, vertical: p.targetVertical || scenario.vertical };
    if (p.idsChanged) {
      updated.platformScenarioIds = p.platformIds;
      updated.platform = {
        ...(scenario.platform || {}),
        platformScenarioIds: p.platformIds,
      };
    }
    if (p.statusChanged) updated.status = p.targetStatus;
    if (p.verticalChanged) changes.push('vertical corrigido');
    if (p.idsChanged) changes.push('platformScenarioIds vinculado ao registry');
    if (p.statusChanged) changes.push(`status ${p.status}→${p.targetStatus}`);
    qaWavesScenarioService.upsertScenarioStore(updated, {
      changedBy: 'batch-finalize-drafts',
      changes,
    });
    applied += 1;
  }

  console.log(`[apply] ${applied} cenário(s) atualizado(s).`);
}

main();
