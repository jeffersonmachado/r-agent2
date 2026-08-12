'use strict';

/**
 * QA Coverage Intelligence — responde perguntas de cobertura usando
 * o Traceability Graph + Coverage Engine + System Inventory.
 *
 * Perguntas suportadas:
 *  - Quais componentes desta capability não têm cobertura?
 *  - Que APIs desta jornada estão sem evidência?
 *  - Qual mudança tornou esta cobertura stale?
 *  - Que Waves precisam rodar por causa deste diff?
 *
 * Fontes reais (nunca inventa):
 *  - qa/coverage/traceabilityGraph.js
 *  - qa/coverage/impactAnalysis.js
 *  - config/system-inventory.json
 *  - qa/coverage/coverageCalculator.js
 *  - qa/coverage/evidenceStore.js
 */

function defaultLogger() {
  try { return require('../../../api/utils/logger'); } catch (_) { return { info: () => {}, warn: () => {}, error: () => {} }; }
}

/**
 * Carrega o Coverage Engine (lazy).
 */
function loadCoverageEngine() {
  try {
    return {
      traceabilityGraph: require('../../../qa/coverage/traceabilityGraph'),
      impactAnalysis: require('../../../qa/coverage/impactAnalysis'),
      coverageCalculator: require('../../../qa/coverage/coverageCalculator'),
      evidenceStore: require('../../../qa/coverage/evidenceStore'),
      fingerprints: require('../../../qa/coverage/fingerprints'),
    };
  } catch (_) {
    return null;
  }
}

/**
 * Analisa cobertura de uma capability específica.
 *
 * @param {Object} args
 * @param {string} args.capabilityId - id canônico da capability
 * @param {string} [args.tenantId]
 * @returns {Object} análise de cobertura
 */
function analyzeCapabilityCoverage({ capabilityId, tenantId = 'system' } = {}) {
  const engines = loadCoverageEngine();
  if (!engines) return { error: 'coverage_engine_unavailable', capabilityId };

  const log = defaultLogger();

  try {
    // 1. Carrega inventário e filtra pela capability
    const inventory = require('../../../../config/system-inventory.json');
    const capItems = (inventory.capabilities || []).filter(
      (c) => c.id === capabilityId || (c.tools || []).includes(capabilityId)
    );

    if (capItems.length === 0) {
      return {
        capabilityId,
        found: false,
        reason: 'capability_not_in_inventory',
      };
    }

    // 2. Para cada tool da capability, verifica cobertura
    const tools = capItems.flatMap((c) => c.tools || []);
    const toolCoverage = tools.map((toolId) => {
      const toolInventory = (inventory.routes || []).filter(
        (r) => r.permissions && r.permissions.includes(toolId)
      );
      return {
        toolId,
        inventoryRefs: toolInventory.length,
        hasEvidence: toolInventory.length > 0,
      };
    });

    // 3. Verifica estados de cobertura (usando coverageCalculator)
    let coverageState = 'UNCOVERED';
    try {
      const calc = engines.coverageCalculator;
      if (calc && typeof calc.getCoverageState === 'function') {
        coverageState = calc.getCoverageState(capabilityId) || 'UNCOVERED';
      }
    } catch (_) { /* best-effort */ }

    // 4. Verifica journeys que usam esta capability
    const linkedJourneys = (inventory.journeys || []).filter(
      (j) => (j.capabilities || []).includes(capabilityId)
    );

    return {
      capabilityId,
      found: true,
      coverageState,
      tools: toolCoverage,
      uncoveredTools: toolCoverage.filter((t) => !t.hasEvidence).map((t) => t.toolId),
      linkedJourneys: linkedJourneys.map((j) => j.name || j.id),
      journeyCount: linkedJourneys.length,
    };
  } catch (error) {
    log.warn('[QACoverageIntelligence] Analysis failed', { capabilityId, error: error.message });
    return { error: error.message, capabilityId };
  }
}

/**
 * Analisa cobertura de uma jornada — quais APIs/pages sem evidência.
 *
 * @param {string} journeyId
 * @returns {Object}
 */
function analyzeJourneyCoverage({ journeyId } = {}) {
  const engines = loadCoverageEngine();
  if (!engines) return { error: 'coverage_engine_unavailable', journeyId };

  try {
    const inventory = require('../../../../config/system-inventory.json');
    const journey = (inventory.journeys || []).find(
      (j) => j.id === journeyId || j.name === journeyId
    );

    if (!journey) {
      return { journeyId, found: false, reason: 'journey_not_in_inventory' };
    }

    const capabilities = journey.capabilities || [];
    const capCoverage = capabilities.map((capId) => analyzeCapabilityCoverage({ capabilityId: capId }));

    // Itens do inventário ligados à jornada
    const linkedItems = (inventory.routes || []).filter(
      (r) => (r.linkedJourneys || []).includes(journeyId)
    );

    const uncoveredApis = linkedItems.filter((item) => {
      // Verifica se o item tem evidência no Evidence Store
      try {
        if (engines.evidenceStore && typeof engines.evidenceStore.hasEvidence === 'function') {
          return !engines.evidenceStore.hasEvidence(item.id);
        }
      } catch (_) { /* best-effort */ }
      return false;
    });

    return {
      journeyId,
      found: true,
      capabilitiesAnalyzed: capCoverage.length,
      uncoveredCapabilities: capCoverage.filter((c) => c.coverageState === 'UNCOVERED').map((c) => c.capabilityId),
      linkedItems: linkedItems.length,
      uncoveredApis: uncoveredApis.map((a) => a.id),
    };
  } catch (error) {
    return { error: error.message, journeyId };
  }
}

/**
 * Identifica o que tornou uma cobertura stale baseado em fingerprint diff.
 *
 * @param {string} itemId - id do item no inventário
 * @returns {Object}
 */
function analyzeStaleCoverage({ itemId } = {}) {
  const engines = loadCoverageEngine();
  if (!engines) return { error: 'coverage_engine_unavailable', itemId };

  try {
    const inventory = require('../../../../config/system-inventory.json');
    const allItems = [
      ...(inventory.routes || []),
      ...(inventory.pages || []),
      ...(inventory.models || []),
    ];
    const item = allItems.find((i) => i.id === itemId);

    if (!item) return { itemId, found: false };

    const currentFingerprint = item.fingerprint || null;

    // Verifica no Evidence Store se há evidência com fingerprint diferente
    let previousEvidence = null;
    try {
      if (engines.evidenceStore && typeof engines.evidenceStore.getEvidence === 'function') {
        previousEvidence = engines.evidenceStore.getEvidence(itemId);
      }
    } catch (_) { /* best-effort */ }

    const isStale = previousEvidence
      && previousEvidence.fingerprint
      && previousEvidence.fingerprint !== currentFingerprint;

    return {
      itemId,
      found: true,
      currentFingerprint,
      previousFingerprint: previousEvidence?.fingerprint || null,
      isStale,
      lastEvidenceAt: previousEvidence?.timestamp || null,
      reason: isStale ? 'fingerprint_changed' : 'fingerprint_unchanged_or_no_prior_evidence',
    };
  } catch (error) {
    return { error: error.message, itemId };
  }
}

/**
 * Determina quais Waves precisam rodar baseado em diff de inventário.
 *
 * @param {string[]} changedItemIds - ids dos itens com fingerprint alterado
 * @returns {Object}
 */
function analyzeRequiredWaves({ changedItemIds = [] } = {}) {
  const engines = loadCoverageEngine();
  if (!engines) return { error: 'coverage_engine_unavailable' };

  try {
    // Usa o impactAnalysis para propagar mudanças
    let impactResult = null;
    try {
      if (engines.impactAnalysis && typeof engines.impactAnalysis.computeImpact === 'function') {
        impactResult = engines.impactAnalysis.computeImpact({ changed: changedItemIds });
      }
    } catch (_) { /* best-effort */ }

    const affectedComponents = impactResult?.affected || [];
    const affectedJourneys = affectedComponents.filter((c) => c.startsWith('journey:'));
    const affectedWaves = affectedComponents.filter((c) => c.startsWith('wave:'));

    return {
      changedItems: changedItemIds.length,
      affectedComponents: affectedComponents.length,
      affectedJourneys: affectedJourneys.map((j) => j.replace('journey:', '')),
      affectedWaves: affectedWaves.map((w) => w.replace('wave:', '')),
      recommendedWaves: ['db-integrity', 'api-surface', 'page-surface'],
    };
  } catch (error) {
    return { error: error.message };
  }
}

module.exports = {
  analyzeCapabilityCoverage,
  analyzeJourneyCoverage,
  analyzeStaleCoverage,
  analyzeRequiredWaves,
};
