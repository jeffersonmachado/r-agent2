'use strict';

const {
  runLearningRoutine,
  groupFailures,
  classifyGroup,
  buildDeterministicSuggestion,
} = require('../../api/services/learningRoutineService');

function makeRecord(overrides = {}) {
  return {
    id: overrides.id || `rec-${Math.random().toString(36).slice(2, 10)}`,
    tenant_id: 'system',
    type: 'failure',
    source: 'cognitive-core',
    sourceRef: 'exec-1',
    classification: null,
    status: 'detected',
    metrics: {},
    ...overrides,
  };
}

function makeRapLearn(records) {
  return {
    detectRegressions: jest.fn(async () => records),
    classifyFailure: jest.fn(async (id, classification, rootCause) => ({ id, classification, rootCause })),
    generateSuggestion: jest.fn(async (id, suggestion) => ({ id, suggestion })),
  };
}

const silentLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('learningRoutineService', () => {
  describe('groupFailures', () => {
    it('agrupa por source::classification com fallback unclassified', () => {
      const records = [
        makeRecord({ source: 'a', classification: 'x' }),
        makeRecord({ source: 'a', classification: 'x' }),
        makeRecord({ source: 'a', classification: null }),
        makeRecord({ source: null, classification: null }),
      ];
      const groups = groupFailures(records);
      expect(groups.get('a::x')).toHaveLength(2);
      expect(groups.get('a::unclassified')).toHaveLength(1);
      expect(groups.get('unknown::unclassified')).toHaveLength(1);
    });
  });

  describe('classifyGroup', () => {
    it('classifica timeout por padrão de erro', () => {
      const result = classifyGroup([makeRecord({ metrics: { failure: { error: 'request timed out' } } })]);
      expect(result.classification).toBe('timeout_or_connectivity');
    });

    it('classifica intent_misclassification', () => {
      const result = classifyGroup([makeRecord({ metrics: { intent: 'fitness_lead', failure: { reason: 'intent confidence below threshold' } } })]);
      expect(result.classification).toBe('intent_misclassification');
    });

    it('retorna null quando nenhum padrão casa', () => {
      expect(classifyGroup([makeRecord({ metrics: { failure: { error: '???' } } })])).toBeNull();
    });
  });

  describe('runLearningRoutine', () => {
    it('processa apenas grupos >= minGroupSize e só registros detected', async () => {
      const records = [
        makeRecord({ id: 'a1', metrics: { failure: { error: 'timeout' } } }),
        makeRecord({ id: 'a2', metrics: { failure: { error: 'timeout' } } }),
        makeRecord({ id: 'a3', metrics: { failure: { error: 'timeout' } } }),
        makeRecord({ id: 'b1', source: 'other' }), // grupo abaixo do limiar
        makeRecord({ id: 'c1', status: 'suggested' }), // já processado — ignorado
      ];
      const rapLearn = makeRapLearn(records);
      const appendEvent = jest.fn(async () => {});

      const report = await runLearningRoutine({
        tenantId: 'system',
        minGroupSize: 3,
        rapLearn,
        appendEvent,
        logger: silentLogger,
      });

      expect(report.failuresInWindow).toBe(5);
      expect(report.pendingDetected).toBe(4);
      expect(report.groupsProcessed).toBe(1);
      expect(rapLearn.classifyFailure).toHaveBeenCalledTimes(3);
      expect(rapLearn.classifyFailure).toHaveBeenCalledWith('a1', 'timeout_or_connectivity', expect.any(String), 'system');
      expect(rapLearn.generateSuggestion).toHaveBeenCalledTimes(1);
      expect(rapLearn.generateSuggestion).toHaveBeenCalledWith('a1', expect.objectContaining({
        generatedBy: 'learning-routine:deterministic',
        requiresHumanValidation: true,
        occurrences: 3,
      }), 'system');
      expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'LearningRoutineCompleted' }));
    });

    it('dryRun não persiste nada', async () => {
      const records = [makeRecord({}), makeRecord({}), makeRecord({})];
      const rapLearn = makeRapLearn(records);
      const report = await runLearningRoutine({
        minGroupSize: 3,
        dryRun: true,
        rapLearn,
        appendEvent: jest.fn(async () => {}),
        logger: silentLogger,
      });
      expect(report.groupsProcessed).toBe(1);
      expect(rapLearn.classifyFailure).not.toHaveBeenCalled();
      expect(rapLearn.generateSuggestion).not.toHaveBeenCalled();
    });

    it('usa sugestão da IA quando disponível', async () => {
      const records = [makeRecord({}), makeRecord({}), makeRecord({})];
      const rapLearn = makeRapLearn(records);
      const generateAiText = jest.fn(async () => JSON.stringify({
        rootCause: 'Provider de IA sem chave configurada',
        proposedActions: ['Configurar chave', 'Adicionar healthcheck', 'Criar alerta'],
        confidence: 0.8,
      }));

      const report = await runLearningRoutine({
        minGroupSize: 3,
        rapLearn,
        generateAiText,
        appendEvent: jest.fn(async () => {}),
        logger: silentLogger,
      });

      expect(report.aiUsed).toBe(true);
      expect(rapLearn.generateSuggestion).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        generatedBy: 'learning-routine:ai',
        rootCause: 'Provider de IA sem chave configurada',
      }), 'system');
    });

    it('cai no fallback determinístico quando a IA falha', async () => {
      const records = [makeRecord({}), makeRecord({}), makeRecord({})];
      const rapLearn = makeRapLearn(records);
      const generateAiText = jest.fn(async () => { throw new Error('no provider'); });

      const report = await runLearningRoutine({
        minGroupSize: 3,
        rapLearn,
        generateAiText,
        appendEvent: jest.fn(async () => {}),
        logger: silentLogger,
      });

      expect(report.aiUsed).toBe(false);
      expect(report.aiFallbacks).toHaveLength(1);
      expect(rapLearn.generateSuggestion).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        generatedBy: 'learning-routine:deterministic',
      }), 'system');
    });

    it('nunca valida nem promove (governança humana preservada)', async () => {
      const records = [makeRecord({}), makeRecord({}), makeRecord({})];
      const rapLearn = makeRapLearn(records);
      rapLearn.validateSuggestion = jest.fn();
      rapLearn.promoteToProduction = jest.fn();

      await runLearningRoutine({
        minGroupSize: 3,
        rapLearn,
        appendEvent: jest.fn(async () => {}),
        logger: silentLogger,
      });

      expect(rapLearn.validateSuggestion).not.toHaveBeenCalled();
      expect(rapLearn.promoteToProduction).not.toHaveBeenCalled();
    });

    it('falha do ledger não derruba a rotina', async () => {
      const records = [makeRecord({}), makeRecord({}), makeRecord({})];
      const rapLearn = makeRapLearn(records);
      const report = await runLearningRoutine({
        minGroupSize: 3,
        rapLearn,
        appendEvent: jest.fn(async () => { throw new Error('ledger down'); }),
        logger: silentLogger,
      });
      expect(report.suggestions).toBe(1);
    });

    it('janela vazia gera relatório vazio sem erro', async () => {
      const rapLearn = makeRapLearn([]);
      const report = await runLearningRoutine({
        rapLearn,
        appendEvent: jest.fn(async () => {}),
        logger: silentLogger,
      });
      expect(report.failuresInWindow).toBe(0);
      expect(report.groupsProcessed).toBe(0);
      expect(report.errors).toHaveLength(0);
    });

    it('não sobrescreve classification existente no grupo', async () => {
      const records = [
        makeRecord({ id: 'a1', classification: 'timeout_or_connectivity', metrics: { failure: { error: 'timeout' } } }),
        makeRecord({ id: 'a2', classification: null, metrics: { failure: { error: 'timeout' } } }),
        makeRecord({ id: 'a3', classification: null, metrics: { failure: { error: 'timeout' } } }),
      ];
      const rapLearn = makeRapLearn(records);
      await runLearningRoutine({
        minGroupSize: 3,
        rapLearn,
        appendEvent: jest.fn(async () => {}),
        logger: silentLogger,
      });
      // a1 já tinha classification → não é tocado; a2/a3 recebem a do grupo
      expect(rapLearn.classifyFailure).toHaveBeenCalledTimes(2);
      expect(rapLearn.classifyFailure).not.toHaveBeenCalledWith('a1', expect.anything(), expect.anything(), expect.anything());
      expect(rapLearn.classifyFailure).toHaveBeenCalledWith('a2', 'timeout_or_connectivity', expect.anything(), 'system');
    });
  });

  describe('buildDeterministicSuggestion', () => {
    it('sempre exige validação humana', () => {
      const suggestion = buildDeterministicSuggestion({ key: 'a::b', classification: 'x', rootCause: 'y', records: [makeRecord()] });
      expect(suggestion.requiresHumanValidation).toBe(true);
      expect(suggestion.proposedActions.length).toBeGreaterThan(0);
    });
  });
});
