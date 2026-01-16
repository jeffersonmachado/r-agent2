/**
 * Testes de uso real do Sistema de Replay
 * Simula cenários reais de uso
 */

const { ReplaySystem } = require('../../lib/replaySystem');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('ReplaySystem - Uso Real', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-usage-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Cenário: Processo de Geração', () => {
    test('deve gravar processo completo de geração', () => {
      const replay = new ReplaySystem({
        storagePath: tempDir,
        context: 'generation',
      });

      const replayId = `generate-flow-${Date.now()}`;
      replay.start(replayId, {
        flowName: 'Test Flow',
        useRag: true,
      });

      // Validação
      replay.recordAction(
        { type: 'validation', step: 'validate-payload' },
        { success: true, startTime: new Date().toISOString() }
      );

      // Resolução de contexto
      replay.recordEvent('context_resolution_started');
      replay.recordAction(
        { type: 'context_resolution', step: 'resolve-context' },
        { success: true, actual: { sources: ['rag'] } }
      );

      // Geração de fluxo
      replay.recordEvent('flow_generation_started');
      replay.recordAction(
        { type: 'flow_generation', step: 'generate-flow' },
        { success: true, actual: { flowId: 'flow-123', nodesCount: 5 } }
      );

      replay.recordEvent('generation_completed');
      replay.stop();

      const filePath = replay.save(replayId);
      const loaded = ReplaySystem.load(filePath);

      expect(loaded.actions).toHaveLength(3);
      expect(loaded.events).toHaveLength(3);
      expect(loaded.metadata.flowName).toBe('Test Flow');
    });
  });

  describe('Cenário: Execução de Engine', () => {
    test('deve gravar execução de múltiplos nós', () => {
      const replay = new ReplaySystem({
        storagePath: tempDir,
        context: 'engine',
      });

      replay.start(`flow-session-${Date.now()}`, {
        flowId: 'flow-123',
        sessionId: 'session-456',
      });

      // Simula execução de 3 nós
      for (let i = 1; i <= 3; i++) {
        replay.recordAction(
          {
            type: 'node_execution',
            step: `node-${i}`,
            nodeType: 'message',
          },
          {
            success: true,
            actual: { nextNode: `node-${i + 1}` },
          }
        );

        if (i < 3) {
          replay.recordEvent('node_transition', {
            from: `node-${i}`,
            to: `node-${i + 1}`,
          });
        }
      }

      replay.stop();
      const filePath = replay.save();
      const loaded = ReplaySystem.load(filePath);

      expect(loaded.actions).toHaveLength(3);
      expect(loaded.events).toHaveLength(2); // 2 transições
    });
  });

  describe('Cenário: Pipeline Orchestrator', () => {
    test('deve gravar todas as etapas do pipeline', () => {
      const replay = new ReplaySystem({
        storagePath: tempDir,
        context: 'pipeline',
      });

      replay.start(`pipeline-${Date.now()}`, {
        executionId: 'exec-123',
      });

      const stages = ['validation', 'context', 'generation', 'rpa'];
      
      stages.forEach((stage, index) => {
        replay.recordEvent('stage_started', { stage });
        replay.recordAction(
          { type: 'stage_execution', step: stage },
          { success: true }
        );
        replay.recordEvent('stage_completed', { stage });
      });

      replay.recordEvent('pipeline_completed');
      replay.stop();

      const filePath = replay.save();
      const loaded = ReplaySystem.load(filePath);

      expect(loaded.actions).toHaveLength(4);
      expect(loaded.events).toHaveLength(9); // 4 started + 4 completed + 1 final
    });
  });

  describe('Cenário: Tratamento de Erros', () => {
    test('deve gravar erro e continuar registro', () => {
      const replay = new ReplaySystem({
        storagePath: tempDir,
        context: 'test',
      });

      replay.start('error-test');

      replay.recordAction({ type: 'action1' }, { success: true });
      
      const error = new Error('Test error');
      error.code = 'TEST_ERROR';
      replay.recordError(error, 'action2', { attempt: 1 });

      replay.recordEvent('error_handled');
      replay.recordAction({ type: 'action3' }, { success: true });

      replay.stop();
      const filePath = replay.save('error-test');
      const loaded = ReplaySystem.load(filePath);

      expect(loaded.actions).toHaveLength(2);
      expect(loaded.errors).toHaveLength(1);
      expect(loaded.errors[0].message).toBe('Test error');
      expect(loaded.errors[0].code).toBe('TEST_ERROR');
    });
  });

  describe('Cenário: RPA Flow Pipeline', () => {
    test('deve gravar pipeline RPA completo', () => {
      const replay = new ReplaySystem({
        storagePath: tempDir,
        context: 'rpa-pipeline',
      });

      replay.start(`rpa-pipeline-${Date.now()}`, {
        flowId: 'flow-123',
      });

      // Análise de dependências
      replay.recordEvent('dependency_analysis_started');
      replay.recordAction(
        { type: 'dependency_analysis', step: 'analyze-dependencies' },
        { success: true, actual: { seedsCount: 2 } }
      );

      // Execução de seeds
      replay.recordEvent('seeds_execution_started', { seedsCount: 2 });
      replay.recordAction(
        { type: 'seeds_execution', step: 'execute-seeds' },
        { success: true, actual: { executedCount: 2 } }
      );

      // Conversão
      replay.recordEvent('flow_conversion_started');
      replay.recordAction(
        { type: 'flow_conversion', step: 'convert-flow-to-rpa' },
        { success: true, actual: { recordingId: 'rec-123', stepsCount: 10 } }
      );

      replay.recordEvent('pipeline_completed');
      replay.stop();

      const filePath = replay.save();
      const loaded = ReplaySystem.load(filePath);

      expect(loaded.actions).toHaveLength(3);
      expect(loaded.events).toHaveLength(4);
    });
  });
});
