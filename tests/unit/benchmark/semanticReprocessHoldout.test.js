'use strict';

/**
 * Reprocess semântico × holdout (loop de absorção 2026-09-15).
 *
 * O reprocesso semântico NUNCA abre o holdout cedo: ele só reprocessa os
 * achados de um holdout que já foi ABERTO legitimamente — seja porque o
 * engine marcou saturação aparente neste ciclo, seja porque o sample
 * versionado registra `analyzedAt` do holdout (abertura legítima anterior,
 * pré-registrada). Reprocessar achados persistidos não é pesquisa nova: é
 * reclassificação honesta do que já foi medido.
 */

const { shouldReprocessHoldout } = require('../../../scripts/benchmark/reprocess-semantic-research');

describe('reprocess-semantic — shouldReprocessHoldout', () => {
  test('saturação aparente marcada pelo engine autoriza o reprocesso', () => {
    expect(shouldReprocessHoldout({
      holdoutBenchmarkId: 'zenplanner',
      saturationMarked: true,
      previouslyAnalyzed: false,
    })).toEqual({ reprocess: true, basis: 'saturation_marked' });
  });

  test('holdout JÁ analizado em ciclo anterior (sample) pode ser reprocessado sem saturação nova', () => {
    // Sem esta base, o holdout medido com novelty BRUTA em r5 jamais seria
    // re-medido com a pipeline semântica — a medição honesta ficaria presa
    // ao classificador antigo para sempre.
    expect(shouldReprocessHoldout({
      holdoutBenchmarkId: 'zenplanner',
      saturationMarked: false,
      previouslyAnalyzed: true,
    })).toEqual({ reprocess: true, basis: 'previously_analyzed_in_sample' });
  });

  test('holdout NUNCA aberto não é reprocessado (leakage continua proibido)', () => {
    expect(shouldReprocessHoldout({
      holdoutBenchmarkId: 'zenplanner',
      saturationMarked: false,
      previouslyAnalyzed: false,
    })).toEqual({ reprocess: false, basis: 'holdout_not_opened' });
  });

  test('sem holdout não há o que reprocessar', () => {
    expect(shouldReprocessHoldout({
      holdoutBenchmarkId: null,
      saturationMarked: true,
      previouslyAnalyzed: true,
    })).toEqual({ reprocess: false, basis: 'no_holdout' });
  });
});
