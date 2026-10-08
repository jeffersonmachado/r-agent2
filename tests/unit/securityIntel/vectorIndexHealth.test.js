'use strict';

/**
 * Testes do veredito de saúde do índice vetorial.
 *
 * As provas centrais:
 *   - Índice inválido (`indisvalid=false`) ⇒ INVALID + achado BLOCKING (é a
 *     definição operacional de "corrupção de índice").
 *   - Fato não medido ⇒ nunca HEALTHY (não medir não é estar bem).
 *   - Versão da extensão abaixo do mínimo recomendado ⇒ DEGRADED (risco de
 *     versão, não corrupção declarada).
 *   - Planner ignorando o índice ⇒ achado HIGH.
 */

const {
  VERDICTS,
  detectIndexMethod,
  compareWithRecommended,
  evaluateVectorIndexHealth,
} = require('../../../engine/securityIntel/vectorIndexHealth');

function healthyInput(overrides = {}) {
  return {
    extension: { name: 'vector', version: '0.8.4' },
    index: {
      name: 'rag_chunks_embedding_hnsw_idx',
      method: 'hnsw',
      opclass: 'vector_cosine_ops',
      isValid: true,
      isReady: true,
      isLive: true,
      sizeBytes: 15728640,
      scans: 6,
    },
    embeddings: { total: 8460, nulls: 0, wrongDimensions: 0, expectedDimensions: 384 },
    plan: { usesVectorIndex: true, detail: 'Index Scan using rag_chunks_embedding_hnsw_idx' },
    policy: { recommendedMinVersion: '0.8.0', expectedDimensions: 384, maxNullEmbeddings: 0 },
    ...overrides,
  };
}

describe('vectorIndexHealth — método do índice', () => {
  test('detecta hnsw/ivfflat a partir do indexdef', () => {
    expect(detectIndexMethod('CREATE INDEX x ON t USING hnsw (embedding vector_cosine_ops)')).toBe('hnsw');
    expect(detectIndexMethod('CREATE INDEX x ON t USING ivfflat (embedding vector_l2_ops)')).toBe('ivfflat');
    expect(detectIndexMethod('CREATE INDEX x ON t USING btree (id)')).toBe('btree');
    expect(detectIndexMethod(null)).toBeNull();
  });

  test('comparação com o mínimo recomendado usa comparação de versão real', () => {
    expect(compareWithRecommended('0.6.0', '0.8.0')).toBe('behind');
    expect(compareWithRecommended('0.8.4', '0.8.0')).toBe('ok');
    expect(compareWithRecommended('latest', '0.8.0')).toBe('unknown');
    expect(compareWithRecommended(null, '0.8.0')).toBe('unknown');
  });
});

describe('vectorIndexHealth — veredito', () => {
  test('tudo medido e sadio ⇒ HEALTHY', () => {
    const result = evaluateVectorIndexHealth(healthyInput());
    expect(result.verdict).toBe(VERDICTS.HEALTHY);
    expect(result.findings).toEqual([]);
    expect(result.unmeasured).toEqual([]);
  });

  test('índice inválido no catálogo ⇒ INVALID com achado BLOCKING', () => {
    const result = evaluateVectorIndexHealth(healthyInput({
      index: { ...healthyInput().index, isValid: false },
    }));
    expect(result.verdict).toBe(VERDICTS.INVALID);
    const blocking = result.findings.filter((finding) => finding.severity === 'BLOCKING');
    expect(blocking.map((finding) => finding.code)).toContain('vector_index_invalid');
    expect(blocking[0].detail.invalidFlags).toContain('isValid=false');
  });

  test('ausência de índice vetorial ⇒ INVALID (busca degrada para varredura)', () => {
    const result = evaluateVectorIndexHealth(healthyInput({ index: null }));
    expect(result.verdict).toBe(VERDICTS.INVALID);
    expect(result.findings.map((finding) => finding.code)).toContain('vector_index_not_found');
  });

  test('embeddings nulos ou com dimensão errada ⇒ INVALID', () => {
    const withNulls = evaluateVectorIndexHealth(healthyInput({
      embeddings: { total: 10, nulls: 1, wrongDimensions: 0, expectedDimensions: 384 },
    }));
    expect(withNulls.verdict).toBe(VERDICTS.INVALID);
    expect(withNulls.findings.map((finding) => finding.code)).toContain('embeddings_nulls');

    const wrongDim = evaluateVectorIndexHealth(healthyInput({
      embeddings: { total: 10, nulls: 0, wrongDimensions: 2, expectedDimensions: 384 },
    }));
    expect(wrongDim.verdict).toBe(VERDICTS.INVALID);
    expect(wrongDim.findings.map((finding) => finding.code)).toContain('embeddings_dimension_mismatch');
  });

  test('versão atrás do recomendado ⇒ DEGRADED (não INVALID: é risco de versão)', () => {
    const result = evaluateVectorIndexHealth(healthyInput({
      extension: { name: 'vector', version: '0.6.0' },
    }));
    expect(result.verdict).toBe(VERDICTS.DEGRADED);
    const finding = result.findings.find((item) => item.code === 'vector_extension_behind_recommended');
    expect(finding).toMatchObject({ severity: 'MEDIUM' });
    expect(finding.detail).toEqual({ installed: '0.6.0', recommendedMinVersion: '0.8.0' });
  });

  test('planner ignorando o índice ⇒ achado HIGH e veredito DEGRADED', () => {
    const result = evaluateVectorIndexHealth(healthyInput({
      plan: { usesVectorIndex: false, detail: 'Seq Scan on rag_chunks' },
    }));
    expect(result.verdict).toBe(VERDICTS.DEGRADED);
    expect(result.findings.map((finding) => finding.code)).toContain('planner_ignores_vector_index');
  });

  test('fato não medido NUNCA vira HEALTHY', () => {
    for (const missing of ['extension', 'index', 'embeddings', 'plan']) {
      const result = evaluateVectorIndexHealth(healthyInput({ [missing]: null }));
      expect(result.verdict).not.toBe(VERDICTS.HEALTHY);
      expect(result.unmeasured.length).toBeGreaterThan(0);
    }
  });

  test('flags de validade não medidas ⇒ UNKNOWN (não assume validade)', () => {
    const result = evaluateVectorIndexHealth(healthyInput({
      index: { name: 'idx', method: 'hnsw' },
    }));
    expect(result.verdict).toBe(VERDICTS.UNKNOWN);
    expect(result.unmeasured).toContain('index_catalog_flags');
  });

  test('método inesperado (btree como único índice) ⇒ achado HIGH', () => {
    const result = evaluateVectorIndexHealth(healthyInput({
      index: { ...healthyInput().index, method: 'btree' },
    }));
    expect(result.findings.map((finding) => finding.code)).toContain('vector_index_method_unexpected');
  });

  test('dimensão esperada desconhecida impede validar dimensão (não passa em silêncio)', () => {
    const result = evaluateVectorIndexHealth(healthyInput({
      embeddings: { total: 10, nulls: 0, wrongDimensions: 0 },
      policy: { recommendedMinVersion: '0.8.0', maxNullEmbeddings: 0 },
    }));
    expect(result.findings.map((finding) => finding.code)).toContain('embeddings_expected_dimensions_unknown');
    expect(result.verdict).toBe(VERDICTS.DEGRADED);
  });

  test('veredito é determinístico e traz a evidência que o produziu', () => {
    const input = healthyInput({ extension: { name: 'vector', version: '0.6.0' } });
    const first = evaluateVectorIndexHealth(input);
    const second = evaluateVectorIndexHealth(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.evidence).toMatchObject({
      extension: { name: 'vector', version: '0.6.0' },
      recommendedMinVersion: '0.8.0',
      versionStatus: 'behind',
    });
    expect(first.evidence.index.isValid).toBe(true);
  });
});
