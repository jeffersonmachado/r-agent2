'use strict';

/**
 * Testes do `archetypeEvidenceDerivation` (GAP_CLOSURE 2026-09-15).
 *
 * Invariantes sob teste:
 *   1. EVIDENCE-REQUIRED: um arquétipo só é suportado com achado VERIFICADO que
 *      casa o vocabulário versionado — declaração sem achado é recusada;
 *   2. NO-EVIDENCE REFUSAL: sem achados verificados, sem vocabulário declarado
 *      ou sem casamento, o veredito é `supported: false` com razão nominal —
 *      nunca cobertura por conveniência;
 *   3. o veredito positivo carrega os findings que sustentam (auditável).
 */

const {
  REASONS,
  normalizeTerm,
  archetypeTerms,
  deriveArchetypeEvidence,
  deriveSampleArchetypeEvidence,
} = require('../../qa/benchmarks/archetypeEvidenceDerivation');

const NORMALIZATION = require('../../config/benchmark-normalization.json');

function finding(overrides = {}) {
  return {
    id: 'brf-test-1',
    kind: 'capability',
    external_name: 'Automated payment collection for recurring membership dues',
    verified: true,
    ...overrides,
  };
}

describe('archetypeEvidenceDerivation', () => {
  describe('normalizeTerm', () => {
    it('normaliza caixa, acentos e pontuação de forma determinística', () => {
      expect(normalizeTerm('  Cobrança Recorrente! ')).toBe('cobranca recorrente');
      expect(normalizeTerm('Inadimplência')).toBe('inadimplencia');
    });
  });

  describe('archetypeTerms', () => {
    it('lê o vocabulário versionado dos arquétipos em gap', () => {
      expect(archetypeTerms(NORMALIZATION, 'financial-billing')).toContain('mensalidade');
      expect(archetypeTerms(NORMALIZATION, 'student-digital-experience')).toContain('app do aluno');
    });

    it('arquétipo sem vocabulário declarado devolve lista vazia (nunca inventa)', () => {
      expect(archetypeTerms(NORMALIZATION, 'archetype-inexistente')).toEqual([]);
    });
  });

  describe('deriveArchetypeEvidence — evidência exigida', () => {
    it('SUPORTA financial-billing com achado verificado de cobrança recorrente', () => {
      const result = deriveArchetypeEvidence({
        archetype: 'financial-billing',
        findings: [finding()],
        normalizationConfig: NORMALIZATION,
      });
      expect(result.supported).toBe(true);
      expect(result.reason).toBeNull();
      expect(result.supportingFindings).toHaveLength(1);
      expect(result.supportingFindings[0].matchedTerm).toBe('payment');
      expect(result.supportingFindings[0].id).toBe('brf-test-1');
    });

    it('SUPORTA student-digital-experience com achado verificado de app do aluno', () => {
      const result = deriveArchetypeEvidence({
        archetype: 'student-digital-experience',
        findings: [finding({ external_name: 'App personalizado com acesso a treinos, agenda e check-ins rápidos' })],
        normalizationConfig: NORMALIZATION,
      });
      expect(result.supported).toBe(true);
      expect(result.supportingFindings[0].matchedTerm).toBe('app personalizado');
    });

    it('casamento é por frase contígua, não por token solto fora de ordem', () => {
      const result = deriveArchetypeEvidence({
        archetype: 'student-digital-experience',
        findings: [finding({ external_name: 'portal de vendas do gestor para o aluno' })],
        normalizationConfig: NORMALIZATION,
      });
      // "portal do aluno" não aparece como sequência contígua.
      expect(result.supported).toBe(false);
      expect(result.reason).toBe(REASONS.NO_MATCH);
    });
  });

  describe('deriveArchetypeEvidence — recusa sem evidência', () => {
    it('RECUSA quando não há nenhum achado verificado', () => {
      const result = deriveArchetypeEvidence({
        archetype: 'financial-billing',
        findings: [finding({ verified: false })],
        normalizationConfig: NORMALIZATION,
      });
      expect(result.supported).toBe(false);
      expect(result.reason).toBe(REASONS.NO_VERIFIED_FINDINGS);
    });

    it('RECUSA quando os achados verificados não casam o vocabulário', () => {
      const result = deriveArchetypeEvidence({
        archetype: 'financial-billing',
        findings: [finding({ external_name: 'Agenda de aulas e reservas de posição' })],
        normalizationConfig: NORMALIZATION,
      });
      expect(result.supported).toBe(false);
      expect(result.reason).toBe(REASONS.NO_MATCH);
      expect(result.verifiedFindings).toBe(1);
    });

    it('RECUSA quando o arquétipo não tem vocabulário versionado', () => {
      const result = deriveArchetypeEvidence({
        archetype: 'crossfit-box',
        findings: [finding()],
        normalizationConfig: NORMALIZATION,
      });
      expect(result.supported).toBe(false);
      expect(result.reason).toBe(REASONS.VOCABULARY_MISSING);
    });

    it('RECUSA sem arquétipo informado', () => {
      const result = deriveArchetypeEvidence({
        archetype: '',
        findings: [finding()],
        normalizationConfig: NORMALIZATION,
      });
      expect(result.supported).toBe(false);
      expect(result.reason).toBe(REASONS.ARCHETYPE_REQUIRED);
    });

    it('achado UNVERIFIED com termo certo NUNCA sustenta cobertura', () => {
      const result = deriveArchetypeEvidence({
        archetype: 'financial-billing',
        findings: [finding({ verified: false, external_name: 'mensalidade recorrente' })],
        normalizationConfig: NORMALIZATION,
      });
      expect(result.supported).toBe(false);
      expect(result.reason).toBe(REASONS.NO_VERIFIED_FINDINGS);
    });
  });

  describe('deriveSampleArchetypeEvidence', () => {
    it('agrega por arquétipo apenas benchmarks com evidência real', () => {
      const result = deriveSampleArchetypeEvidence({
        archetypes: [{ id: 'financial-billing' }, { id: 'student-digital-experience' }],
        benchmarks: [
          { id: 'abcfitness', findings: [finding()] },
          { id: 'mindbody', findings: [finding({ external_name: 'Class scheduling and staff management' })] },
        ],
        normalizationConfig: NORMALIZATION,
      });
      expect(result.coverageSupported['financial-billing']).toBe(true);
      expect(result.coverageSupported['student-digital-experience']).toBe(false);
      const billing = result.results.find((r) => r.archetype === 'financial-billing');
      expect(billing.supportingBenchmarks).toHaveLength(1);
      expect(billing.supportingBenchmarks[0].benchmarkId).toBe('abcfitness');
    });
  });
});
