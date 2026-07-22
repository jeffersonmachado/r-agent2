'use strict';

const {
  runAutoPromotion,
  evaluateSuggestion,
} = require('../../api/services/learningAutoPromotionService');

function makeSuggested(overrides = {}) {
  return {
    id: overrides.id || `rec-${Math.random().toString(36).slice(2, 10)}`,
    tenant_id: 'system',
    type: 'failure',
    source: 'cognitive-core',
    sourceRef: 'exec-1',
    status: 'suggested',
    suggestion: {
      kind: 'recurrent_failure_group',
      group: 'cognitive-core::ai_provider',
      classification: 'ai_provider',
      rootCause: 'Provider sem chave',
      proposedActions: ['Configurar chave', 'Adicionar healthcheck', 'Criar alerta'],
      confidence: 0.9,
      generatedBy: 'learning-routine:ai',
      requiresHumanValidation: true,
    },
    ...overrides,
  };
}

function makeRapLearn(records) {
  return {
    listLearningRecords: jest.fn(async () => records),
    validateSuggestion: jest.fn(async (id, validationResult) => ({ id, validationResult })),
    promoteToProduction: jest.fn(async (id, promotedBy) => ({ id, promotedBy })),
  };
}

const silentLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
// resetMocks:true no jest.config — implementações devem ser criadas por teste
const makeQaPass = () => jest.fn(async () => ({ passed: true, exitCode: 0, error: null }));
const makeQaFail = () => jest.fn(async () => ({ passed: false, exitCode: 1, error: 'gate failed' }));

describe('learningAutoPromotionService', () => {
  describe('evaluateSuggestion', () => {
    it('sugestão de IA com confidence alta é elegível', () => {
      const { eligible } = evaluateSuggestion(makeSuggested(), { minConfidence: 0.8 });
      expect(eligible).toBe(true);
    });

    it('sugestão determinística (sem confidence) NUNCA é elegível', () => {
      const record = makeSuggested({
        suggestion: {
          kind: 'recurrent_failure_group',
          proposedActions: ['a'],
          generatedBy: 'learning-routine:deterministic',
          confidence: null,
        },
      });
      const { eligible, checks } = evaluateSuggestion(record, { minConfidence: 0.8 });
      expect(eligible).toBe(false);
      expect(checks.find((c) => c.name === 'confidence_threshold').passed).toBe(false);
      expect(checks.find((c) => c.name === 'ai_generated').passed).toBe(false);
    });

    it('confidence abaixo do limiar não é elegível', () => {
      const record = makeSuggested();
      record.suggestion.confidence = 0.5;
      expect(evaluateSuggestion(record, { minConfidence: 0.8 }).eligible).toBe(false);
    });

    it('sem proposedActions não é elegível', () => {
      const record = makeSuggested();
      record.suggestion.proposedActions = [];
      expect(evaluateSuggestion(record, { minConfidence: 0.8 }).eligible).toBe(false);
    });
  });

  describe('runAutoPromotion', () => {
    it('GO: valida, promove com promotedBy=learning-routine:auto e audita no ledger', async () => {
      const records = [makeSuggested({ id: 'go-1' })];
      const rapLearn = makeRapLearn(records);
      const appendEvent = jest.fn(async () => {});

      const report = await runAutoPromotion({
        tenantId: 'system',
        minConfidence: 0.8,
        rapLearn,
        runQaGate: makeQaPass(),
        appendEvent,
        logger: silentLogger,
      });

      expect(report.promoted).toBe(1);
      expect(rapLearn.validateSuggestion).toHaveBeenCalledWith('go-1', expect.objectContaining({
        passed: true,
        method: 'auto',
        qaGate: expect.objectContaining({ passed: true }),
      }), 'system');
      expect(rapLearn.promoteToProduction).toHaveBeenCalledWith('go-1', 'learning-routine:auto', 'system');
      expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: 'LearningRoutineCompleted',
        payload: expect.objectContaining({ action: 'auto_promotion', outcome: 'promoted' }),
      }));
    });

    it('NO_GO no gate de QA: rejeita e NUNCA promove', async () => {
      const records = [makeSuggested({ id: 'nogo-1' })];
      const rapLearn = makeRapLearn(records);

      const report = await runAutoPromotion({
        minConfidence: 0.8,
        rapLearn,
        runQaGate: makeQaFail(),
        appendEvent: jest.fn(async () => {}),
        logger: silentLogger,
      });

      expect(report.rejected).toBe(1);
      expect(rapLearn.validateSuggestion).toHaveBeenCalledWith('nogo-1', expect.objectContaining({
        passed: false,
        method: 'auto',
      }), 'system');
      expect(rapLearn.promoteToProduction).not.toHaveBeenCalled();
    });

    it('não elegíveis são ignorados sem tocar no status', async () => {
      const det = makeSuggested({ id: 'det-1' });
      det.suggestion.generatedBy = 'learning-routine:deterministic';
      det.suggestion.confidence = null;
      const rapLearn = makeRapLearn([det]);

      const report = await runAutoPromotion({
        minConfidence: 0.8,
        rapLearn,
        runQaGate: makeQaPass(),
        appendEvent: jest.fn(async () => {}),
        logger: silentLogger,
      });

      expect(report.skipped).toBe(1);
      expect(rapLearn.validateSuggestion).not.toHaveBeenCalled();
      expect(rapLearn.promoteToProduction).not.toHaveBeenCalled();
    });

    it('dryRun decide mas não persiste', async () => {
      const records = [makeSuggested({ id: 'dry-1' })];
      const rapLearn = makeRapLearn(records);

      const report = await runAutoPromotion({
        minConfidence: 0.8,
        dryRun: true,
        rapLearn,
        runQaGate: makeQaPass(),
        appendEvent: jest.fn(async () => {}),
        logger: silentLogger,
      });

      expect(report.promoted).toBe(1);
      expect(rapLearn.validateSuggestion).not.toHaveBeenCalled();
      expect(rapLearn.promoteToProduction).not.toHaveBeenCalled();
    });

    it('gate de QA que lança exceção conta como NO_GO (nunca promove no escuro)', async () => {
      const records = [makeSuggested({ id: 'err-1' })];
      const rapLearn = makeRapLearn(records);
      const runQaGate = jest.fn(async () => { throw new Error('runner exploded'); });

      await expect(runAutoPromotion({
        minConfidence: 0.8,
        rapLearn,
        runQaGate,
        appendEvent: jest.fn(async () => {}),
        logger: silentLogger,
      })).rejects.toThrow('runner exploded');
      // comportamento documentado: exceção no runner injetado propaga;
      // o runner real (runQaGateCommand) nunca lança — resolve passed:false
      expect(rapLearn.promoteToProduction).not.toHaveBeenCalled();
    });

    it('falha do ledger não derruba a promoção', async () => {
      const records = [makeSuggested({ id: 'led-1' })];
      const rapLearn = makeRapLearn(records);

      const report = await runAutoPromotion({
        minConfidence: 0.8,
        rapLearn,
        runQaGate: makeQaPass(),
        appendEvent: jest.fn(async () => { throw new Error('ledger down'); }),
        logger: silentLogger,
      });

      expect(report.promoted).toBe(1);
    });

    it('sem candidatos gera relatório vazio', async () => {
      const rapLearn = makeRapLearn([]);
      const report = await runAutoPromotion({
        rapLearn,
        runQaGate: makeQaPass(),
        appendEvent: jest.fn(async () => {}),
        logger: silentLogger,
      });
      expect(report.candidates).toBe(0);
      expect(report.decisions).toHaveLength(0);
      expect(report.errors).toHaveLength(0);
    });
  });
});
