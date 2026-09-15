'use strict';

/**
 * discoveryHandoff — LINEAGE executável Market Discovery → Benchmark Research
 * (T-MR2).
 *
 * O marketDiscoverySupervisor NUNCA pesquisa em profundidade: ele produz o
 * contrato de handoff (`benchmarkIds` + `holdoutBenchmarkId` + proveniência).
 * Este módulo é o chamador que CONSUME o handoff e ABRE o run de benchmark
 * research com a lineage persistida (`metadata.lineage.marketDiscoveryRunId`).
 *
 * Regras duras (todas fail-closed, ANTES de abrir qualquer run de benchmark):
 *   - o handoff precisa declarar run, set e instante de pré-registro;
 *   - o discovery set PERSISTIDO é a autoridade: o `run_id` do set precisa ser
 *     o run do handoff (um handoff adulterado apontando para outro run é
 *     `market_discovery_lineage_mismatch`);
 *   - sem holdout pré-registrado no set persistido NÃO há handoff
 *     (`market_discovery_holdout_not_preregistered`) — a ordem holdout-antes-
 *     de-pesquisa-profunda não é negociável;
 *   - os campos de lineage gravados no run de benchmark vêm do ESTADO
 *     PERSISTIDO do set (nunca da cópia volátil do handoff).
 */

const LINEAGE_ERROR_CODES = Object.freeze({
  HANDOFF_INVALID: 'market_discovery_handoff_invalid',
  LINEAGE_MISMATCH: 'market_discovery_lineage_mismatch',
  HOLDOUT_NOT_PREREGISTERED: 'market_discovery_holdout_not_preregistered',
});

function lineageError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * @param {object} args
 * @param {object} args.marketStore       marketDiscoveryStore (Postgres ou helper de teste)
 * @param {object} args.benchmarkService  benchmarkResearchService
 * @param {Function} [args.now]
 */
function createDiscoveryHandoff({ marketStore, benchmarkService, now } = {}) {
  if (!marketStore) throw lineageError(LINEAGE_ERROR_CODES.HANDOFF_INVALID, 'marketStore é obrigatório');
  if (!benchmarkService) throw lineageError(LINEAGE_ERROR_CODES.HANDOFF_INVALID, 'benchmarkService é obrigatório');
  const clock = typeof now === 'function' ? now : () => new Date().toISOString();

  /**
   * Abre o run de benchmark research a partir do handoff de um run de mercado.
   *
   * @param {object} args
   * @param {string} args.tenantId
   * @param {object} args.handoff  contrato produzido pelo supervisor
   *   (`metadata.handoff` do run): vertical, researchVersion, benchmarkIds,
   *   holdoutBenchmarkId, discoverySetId, discoveryRunId, holdoutPreregisteredAt
   * @returns {Promise<{lineage: object, benchmarkRun: object, discoverySetId: string}>}
   */
  async function openBenchmarkResearchRun({ tenantId, handoff } = {}) {
    if (!handoff || typeof handoff !== 'object') {
      throw lineageError(LINEAGE_ERROR_CODES.HANDOFF_INVALID, 'handoff ausente');
    }
    const discoveryRunId = String(handoff.discoveryRunId || '').trim();
    const discoverySetId = String(handoff.discoverySetId || '').trim();
    const vertical = String(handoff.vertical || '').trim();
    const researchVersion = String(handoff.researchVersion || '').trim();
    const benchmarkIds = Array.isArray(handoff.benchmarkIds) ? handoff.benchmarkIds : [];
    if (!discoveryRunId || !discoverySetId || !vertical || !researchVersion || benchmarkIds.length === 0) {
      throw lineageError(
        LINEAGE_ERROR_CODES.HANDOFF_INVALID,
        'handoff incompleto: discoveryRunId, discoverySetId, vertical, researchVersion e benchmarkIds são obrigatórios',
      );
    }

    // O set PERSISTIDO é a autoridade — o handoff é apenas o envelope.
    const set = await marketStore.getDiscoverySet({ tenantId, setId: discoverySetId });
    if (!set) {
      throw lineageError(LINEAGE_ERROR_CODES.HANDOFF_INVALID, `discovery set inexistente: ${discoverySetId}`);
    }
    if (String(set.run_id || '') !== discoveryRunId) {
      throw lineageError(
        LINEAGE_ERROR_CODES.LINEAGE_MISMATCH,
        `o discovery set ${discoverySetId} pertence ao run ${set.run_id || 'nenhum'}, não a ${discoveryRunId}`,
      );
    }
    if (set.holdout_preregistered !== true || !set.holdout_selected_at) {
      throw lineageError(
        LINEAGE_ERROR_CODES.HOLDOUT_NOT_PREREGISTERED,
        `discovery set ${discoverySetId} sem holdout pré-registrado: pesquisa profunda recusada`,
      );
    }

    const lineage = {
      source: 'market-discovery',
      marketDiscoveryRunId: discoveryRunId,
      discoverySetId: String(set.id),
      holdoutPreregisteredAt: set.holdout_selected_at instanceof Date
        ? set.holdout_selected_at.toISOString()
        : String(set.holdout_selected_at),
    };

    const benchmarkRun = await benchmarkService.openDiscoverySet({
      tenantId,
      vertical,
      researchVersion,
      benchmarkIds,
      holdoutBenchmarkId: isNonEmptyString(handoff.holdoutBenchmarkId)
        ? String(handoff.holdoutBenchmarkId)
        : (set.holdout_candidate_id || null),
      lineage,
    });

    // Vínculo recíproco: o set de mercado registra QUE run de benchmark abriu
    // a partir dele — a cadeia é navegável nos dois sentidos.
    await marketStore.updateDiscoverySet({
      tenantId,
      setId: set.id,
      patch: {
        metadata: {
          benchmarkResearchHandoff: {
            researchVersion,
            lineage,
            openedAt: clock(),
          },
        },
      },
    });

    return { lineage, benchmarkRun, discoverySetId: String(set.id) };
  }

  return { openBenchmarkResearchRun };
}

module.exports = {
  LINEAGE_ERROR_CODES,
  createDiscoveryHandoff,
};
