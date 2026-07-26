'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (_) { return null; }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ─── Capability mapping: vertical + journey → required capabilities ────────
// Mapeia cada jornada de negócio às capabilities que ela precisa cobrir.
// Baseado em: registry, scenario store, journey-coverage e conhecimento de domínio.

const VERTICAL_CAPABILITIES = {
  beauty: {
    base: ['scheduling', 'payment', 'crm_updates', 'notifications'],
    booking: ['customer_identification', 'scheduling', 'payment', 'crm_updates', 'notifications', 'checkin'],
    new_customer: ['customer_identification', 'lead_capture', 'scheduling', 'payment', 'crm_updates', 'notifications'],
    returning_customer: ['customer_identification', 'scheduling', 'payment', 'crm_updates', 'retention'],
  },
  fitness: {
    base: ['customer_identification', 'membership_validation', 'access_decision', 'attendance_record', 'crm_update'],
    agendamento: ['customer_identification', 'scheduling', 'notifications', 'crm_update'],
    cancelamento: ['customer_identification', 'membership_validation', 'billing_validation', 'crm_update', 'notifications'],
    checkin: ['customer_identification', 'membership_validation', 'access_decision', 'turnstile_release', 'attendance_record'],
    checkout: ['customer_identification', 'billing_validation', 'payment', 'crm_update', 'notifications'],
    active_customer: ['customer_identification', 'membership_validation', 'scheduling', 'attendance_record', 'crm_update', 'retention'],
    new_customer: ['lead_capture', 'customer_identification', 'scheduling', 'payment', 'crm_updates', 'notifications', 'onboarding'],
    leads: ['lead_capture', 'customer_identification', 'crm_updates', 'notifications'],
    onboarding: ['customer_identification', 'crm_updates', 'notifications', 'onboarding'],
    renovacao: ['customer_identification', 'membership_validation', 'billing_validation', 'payment', 'crm_update', 'notifications'],
  },
  food: {
    base: ['customer_identification', 'payment', 'notifications'],
    order_flow: ['customer_identification', 'order_management', 'payment', 'notifications', 'delivery_tracking'],
    customer_journey: ['customer_identification', 'order_management', 'payment', 'crm_updates', 'notifications', 'retention'],
  },
  clinic: {
    base: ['customer_identification', 'scheduling', 'crm_updates', 'notifications'],
    default_journey: ['customer_identification', 'scheduling', 'payment', 'crm_updates', 'notifications', 'checkin'],
  },
  market: {
    base: ['customer_identification', 'payment', 'notifications', 'crm_updates'],
    default_journey: ['customer_identification', 'order_management', 'payment', 'notifications', 'crm_updates', 'delivery_tracking'],
  },
  services: {
    base: ['customer_identification', 'scheduling', 'payment', 'crm_updates', 'notifications'],
    default_journey: ['customer_identification', 'lead_capture', 'scheduling', 'payment', 'crm_updates', 'notifications', 'retention'],
  },
};

function getCapabilities(vertical, journey) {
  const vCaps = VERTICAL_CAPABILITIES[vertical];
  if (!vCaps) return [];
  return vCaps[journey] || vCaps.base || [];
}

/**
 * Fórmula canônica de confidence: base 0.5 + cobertura de cenários (até
 * 0.3, saturando em 5 cenários) + capabilities requeridas (até 0.2,
 * saturando em 6). Função pura — testável sem tocar o disco.
 */
function computeConfidenceFromCounts(scenarioCount, requiredCaps) {
  const scenarioScore = Math.min(scenarioCount / 5, 1) * 0.3;
  const capScore = Math.min(requiredCaps.length / 6, 1) * 0.2;
  return Number(Math.min(1, 0.5 + scenarioScore + capScore).toFixed(2));
}

/**
 * Recalcula a confidence de jornadas que JÁ possuem contrato, a partir do
 * journey-coverage atual. Não destrutivo: preserva requiredCapabilities,
 * missingCapabilities e qualquer campo declarado — apenas `confidence` é
 * atualizada. Não cria contratos novos (responsabilidade do fluxo de
 * geração de novas jornadas).
 *
 * @param {object} contracts mapa journeyId → contrato existente
 * @param {object} coverageByJourney mapa journeyId → { vertical, scenarioCount }
 * @returns {{ contracts: object, refreshed: string[] }}
 */
function refreshJourneyContracts(contracts, coverageByJourney) {
  const refreshed = [];
  const output = { ...contracts };

  for (const [journeyId, coverage] of Object.entries(coverageByJourney || {})) {
    const existing = output[journeyId];
    if (!existing) continue;

    output[journeyId] = {
      ...existing,
      confidence: computeConfidenceFromCounts(
        coverage.scenarioCount,
        existing.requiredCapabilities || [],
      ),
    };
    refreshed.push(journeyId);
  }

  return { contracts: output, refreshed };
}

function countJourneyScenarios(vertical, journey) {
  const covFile = path.join(ROOT, 'qa-waves', 'journey-coverage', `${vertical}.json`);
  if (!fs.existsSync(covFile)) return 0;

  const covData = readJson(covFile);
  if (!covData) return 0;

  for (const j of (covData.journeys || [])) {
    if (j.journey === journey) {
      return (j.scenarios || []).length;
    }
  }
  return 0;
}

function computeConfidence(vertical, journey, requiredCaps) {
  return computeConfidenceFromCounts(countJourneyScenarios(vertical, journey), requiredCaps);
}

function main() {
  const covDir = path.join(ROOT, 'qa-waves', 'journey-coverage');
  const existingContracts = readJson(path.join(ROOT, 'config', 'journey-contracts.json')) || { journeys: {} };

  const newContracts = { ...existingContracts.journeys };
  let added = 0;

  if (!fs.existsSync(covDir)) {
    console.error('journey-coverage directory not found');
    process.exit(1);
  }

  const coverageByJourney = {};

  for (const file of fs.readdirSync(covDir)) {
    if (!file.endsWith('.json')) continue;
    const data = readJson(path.join(covDir, file));
    if (!data || !Array.isArray(data.journeys)) continue;

    const vertical = data.vertical || file.replace('.json', '');
    for (const journey of data.journeys) {
      const journeyId = journey.journey;
      coverageByJourney[journeyId] = {
        vertical,
        scenarioCount: (journey.scenarios || []).length,
      };
      if (newContracts[journeyId]) continue; // already exists

      const requiredCaps = getCapabilities(vertical, journeyId);
      if (requiredCaps.length === 0) {
        console.log(`⚠️  ${vertical}/${journeyId}: sem mapeamento de capabilities definido`);
        continue;
      }

      const confidence = computeConfidence(vertical, journeyId, requiredCaps);
      newContracts[journeyId] = {
        requiredCapabilities: requiredCaps,
        missingCapabilities: [],
        confidence,
      };
      added++;
      console.log(`✅ ${vertical}/${journeyId}: ${requiredCaps.length} caps, conf=${(confidence*100).toFixed(0)}%`);
    }
  }

  // Jornadas com contrato existente: recalcula confidence a partir do
  // journey-coverage atual (não destrutivo — preserva campos declarados).
  const refresh = refreshJourneyContracts(newContracts, coverageByJourney);
  for (const journeyId of refresh.refreshed) {
    const before = newContracts[journeyId].confidence;
    const after = refresh.contracts[journeyId].confidence;
    if (before !== after) {
      console.log(`🔄 ${journeyId}: confidence ${(before*100).toFixed(0)}% → ${(after*100).toFixed(0)}%`);
    }
  }
  Object.assign(newContracts, refresh.contracts);

  // Generate the updated contracts file
  const output = {
    version: (existingContracts.version || 1) + 1,
    generatedAt: new Date().toISOString(),
    journeys: newContracts,
  };

  const outPath = path.join(ROOT, 'config', 'journey-contracts.json');
  writeJson(outPath, output);
  console.log(`\n📄 ${added} novos contratos gerados em config/journey-contracts.json`);
  console.log(`   Total: ${Object.keys(newContracts).length} jornadas com contrato`);
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  VERTICAL_CAPABILITIES,
  getCapabilities,
  computeConfidence,
  computeConfidenceFromCounts,
  refreshJourneyContracts,
  countJourneyScenarios,
};
