import { describe, expect, it } from 'vitest';
import { createInitialPipelineState, pipelineReducer, PipelineStage } from './usePipelineMachine';

describe('usePipelineMachine (PIPELINE_STATUS snapshot)', () => {
  it('não deve auto-completar etapas intermediárias quando uma etapa tardia chega true', () => {
    const state0 = createInitialPipelineState();

    const next = pipelineReducer(state0, {
      type: 'PIPELINE_STATUS',
      payload: {
        executionId: 'exec-test-1',
        status: 'running',
        stages: {
          providerValidated: true,
          ragValidated: true,
          webScraping: true,
          descriptionSuggested: true,
          questionsGenerated: true,
          faqGenerated: true,
          initialFlowGenerated: true,

          // artefatos ainda não executados
          filesInferred: false,
          payloadValid: false,
          contractValid: false,
          contextBuilt: false,
          ragContextBuilt: false,
          aiExecuted: false,
          flowGenerated: false,
          seedGenerated: false,
          rpaGenerated: false,
          rpaExecuted: false,
        },
        metadata: { stage: 'initialFlowGenerated', message: 'Etapa concluída: initialFlowGenerated' },
      },
    });

    // Etapas true devem estar concluídas.
    expect(next.completedStages.has('providerValidated')).toBe(true);
    expect(next.completedStages.has('ragValidated')).toBe(true);
    expect(next.completedStages.has('faqGenerated')).toBe(true);
    expect(next.completedStages.has('initialFlowGenerated')).toBe(true);

    // Etapas false NÃO devem virar concluídas só porque initialFlowGenerated é tardia.
    expect(next.completedStages.has('payloadValid')).toBe(false);
    expect(next.completedStages.has('contractValid')).toBe(false);
    expect(next.completedStages.has('contextBuilt')).toBe(false);
    expect(next.completedStages.has('flowGenerated')).toBe(false);

    // O estágio “derivado” pode apontar para o mais avançado true, sem afetar completedStages.
    expect(next.stage).toBe(PipelineStage.initialFlowGenerated);
  });
});

