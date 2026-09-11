'use strict';

/**
 * Projeção OPERACIONAL de jornadas de negócio.
 *
 * O grafo de QA é material técnico (DEVELOPMENT): contém wave IDs, scenarioIds,
 * seeds, replay, passos de RPA e rotas internas. A projeção operacional é o
 * subconjunto de NEGÓCIO derivado dele — e a sanitização é fail-closed: se um
 * token técnico sobreviver, a projeção é rejeitada em vez de publicada.
 */

const fs = require('fs');
const path = require('path');

const {
  detectTechnicalTokens,
  sanitizeOperationalText,
  assertOperationalClean,
  projectBusinessJourney,
  deriveProjectionFromQaCoverage,
  FORBIDDEN_KEYS,
} = require('../../src/core/operational/journey-projection');

const ROOT = path.resolve(__dirname, '..', '..');

const CONTAMINATED_QA_JOURNEY = {
  vertical: 'fitness',
  journey: 'fitness_new_customer',
  replaySupport: true,
  qaSupport: true,
  maturity: 'production-like',
  scenarios: [
    {
      scenarioId: 'business-e2e-fitness_new_customer',
      scenario: 'E2E: fitness_new_customer',
      status: 'draft_ai',
      channels: ['whatsapp', 'api'],
      steps: ['validate_backend'],
      operationalAssertions: [
        { stepId: 'step_e2e_fitness_new_customer_1', expected: { ok: true } },
      ],
    },
  ],
};

const CATALOG = {
  fitness_new_customer: {
    title: 'Captação e matrícula de novo aluno',
    stages: [
      { title: 'Interesse', description: 'Contato inicial do interessado.' },
      { title: 'Matrícula', description: 'Cadastro do aluno e escolha do plano.' },
    ],
  },
};

describe('projeção operacional de jornadas', () => {
  test('detecta tokens técnicos de QA', () => {
    expect(detectTechnicalTokens('QA Wave 4').tokens).toContain('wave');
    expect(detectTechnicalTokens('scenarioId business-e2e-x').clean).toBe(false);
    expect(detectTechnicalTokens('/api/qa-waves/runs').clean).toBe(false);
    expect(detectTechnicalTokens('step_e2e_fitness_new_customer_1').clean).toBe(false);
    expect(detectTechnicalTokens('Interesse do aluno').clean).toBe(true);
  });

  test('sanitização é fail-closed: token técnico rejeita o texto', () => {
    expect(() => sanitizeOperationalText('Ver a QA Wave 4'))
      .toThrow('Conteúdo técnico detectado');
    expect(sanitizeOperationalText('  Interesse  ')).toBe('Interesse');
  });

  test('rejeita chave estrutural técnica mesmo com valor inofensivo', () => {
    expect(() => assertOperationalClean({ journeyKey: 'x', scenarioId: 'y' }))
      .toThrow('Chave técnica proibida');
    expect(FORBIDDEN_KEYS).toContain('replayId');
  });

  test('projeta jornada de negócio limpa', () => {
    const projection = projectBusinessJourney({
      vertical: 'fitness',
      journeyKey: 'fitness_new_customer',
      title: 'Captação e matrícula de novo aluno',
      stages: [{ title: 'Interesse', description: 'Contato inicial.' }],
      channels: ['whatsapp'],
    });

    expect(projection.scope).toBe('OPERATIONAL');
    expect(projection.stages).toEqual([{ id: 'stage_1', title: 'Interesse', description: 'Contato inicial.' }]);
    expect(projection).not.toHaveProperty('scenarioId');
    expect(projection).not.toHaveProperty('replaySupport');
  });

  test('projeção rejeita estágio contaminado por conteúdo técnico', () => {
    expect(() => projectBusinessJourney({
      vertical: 'fitness',
      journeyKey: 'fitness_new_customer',
      title: 'Jornada',
      stages: [{ title: 'Executar step_e2e_fitness_new_customer_1' }],
    })).toThrow('Conteúdo técnico detectado');
  });

  test('deriva projeção de cobertura de QA descartando internals', () => {
    const projection = deriveProjectionFromQaCoverage(CONTAMINATED_QA_JOURNEY, CATALOG);

    expect(projection).not.toBeNull();
    expect(projection.stages.map((stage) => stage.title)).toEqual(['Interesse', 'Matrícula']);
    // Canais técnicos (`api`) são removidos da visão de negócio.
    expect(projection.channels).toEqual(['whatsapp']);

    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain('scenarioId');
    expect(serialized).not.toContain('wave');
    expect(serialized).not.toContain('replay');
    expect(serialized).not.toContain('seed');
    expect(serialized).not.toContain('validate_backend');
    expect(serialized).not.toContain('/api/');
    expect(serialized).not.toContain('draft_ai');
  });

  test('jornada sem estágio de negócio mapeado não gera projeção', () => {
    expect(deriveProjectionFromQaCoverage(CONTAMINATED_QA_JOURNEY, {})).toBeNull();
    expect(deriveProjectionFromQaCoverage({ vertical: 'x' }, CATALOG)).toBeNull();
  });

  test('artefato versionado está limpo e não vazio', () => {
    const artifactPath = path.join(ROOT, 'reports', 'business-journey-projections.json');
    expect(fs.existsSync(artifactPath)).toBe(true);

    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    expect(artifact.scope).toBe('OPERATIONAL');
    expect(artifact.journeys.length).toBeGreaterThan(0);
    expect(() => assertOperationalClean(artifact)).not.toThrow();
  });

  test('a projeção não expõe o grafo de QA ao copiloto', () => {
    const artifact = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'reports', 'business-journey-projections.json'), 'utf8',
    ));
    const serialized = JSON.stringify(artifact);
    for (const token of ['scenarioId', 'waveId', 'replayId', 'seedId', 'uiTrace', 'operationalAssertions']) {
      expect(serialized).not.toContain(token);
    }
  });
});
