/**
 * Testes de integração do Sistema de Replay
 * Testa a integração do replay em diferentes contextos
 */

const { ReplaySystem } = require('../../lib/replaySystem');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('ReplaySystem - Integração', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-integration-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Contextos diferentes', () => {
    test('deve funcionar com contexto generation', () => {
      const replay = new ReplaySystem({
        storagePath: tempDir,
        context: 'generation',
      });

      replay.start('gen-test', { flowId: 'flow-123' });
      replay.recordAction(
        { type: 'flow_generation', step: 'generate' },
        { success: true }
      );
      replay.stop();
      
      const filePath = replay.save('gen-test');
      expect(fs.existsSync(filePath)).toBe(true);
      
      const loaded = ReplaySystem.load(filePath);
      expect(loaded.context).toBe('generation');
      expect(loaded.metadata.flowId).toBe('flow-123');
    });

    test('deve funcionar com contexto engine', () => {
      const replay = new ReplaySystem({
        storagePath: tempDir,
        context: 'engine',
      });

      replay.start('engine-test', { sessionId: 'session-456' });
      replay.recordAction(
        { type: 'node_execution', step: 'node-1' },
        { success: true }
      );
      replay.recordEvent('node_transition', { from: 'node-1', to: 'node-2' });
      replay.stop();
      
      const filePath = replay.save('engine-test');
      const loaded = ReplaySystem.load(filePath);
      
      expect(loaded.context).toBe('engine');
      expect(loaded.actions).toHaveLength(1);
      expect(loaded.events).toHaveLength(1);
    });

    test('deve funcionar com contexto pipeline', () => {
      const replay = new ReplaySystem({
        storagePath: tempDir,
        context: 'pipeline',
      });

      replay.start('pipeline-test', { executionId: 'exec-789' });
      replay.recordEvent('stage_started', { stage: 'validation' });
      replay.recordAction(
        { type: 'stage_execution', step: 'validation' },
        { success: true }
      );
      replay.recordEvent('stage_completed', { stage: 'validation' });
      replay.stop();
      
      const filePath = replay.save('pipeline-test');
      const loaded = ReplaySystem.load(filePath);
      
      expect(loaded.context).toBe('pipeline');
      expect(loaded.events).toHaveLength(2);
    });
  });

  describe('Múltiplos replays simultâneos', () => {
    test('deve gerenciar múltiplos replays independentes', () => {
      const replay1 = new ReplaySystem({ storagePath: tempDir, context: 'test' });
      const replay2 = new ReplaySystem({ storagePath: tempDir, context: 'test' });
      
      replay1.start('replay-1');
      replay2.start('replay-2');
      
      replay1.recordAction({ type: 'action1' }, {});
      replay2.recordAction({ type: 'action2' }, {});
      
      replay1.stop();
      replay2.stop();
      
      const path1 = replay1.save('replay-1');
      const path2 = replay2.save('replay-2');
      
      const loaded1 = ReplaySystem.load(path1);
      const loaded2 = ReplaySystem.load(path2);
      
      expect(loaded1.id).toBe('replay-1');
      expect(loaded2.id).toBe('replay-2');
      expect(loaded1.actions[0].type).toBe('action1');
      expect(loaded2.actions[0].type).toBe('action2');
    });
  });

  describe('Performance', () => {
    test('deve lidar com muitos eventos sem problemas', () => {
      const replay = new ReplaySystem({ storagePath: tempDir, context: 'test' });
      replay.start('performance-test');
      
      // Registra 1000 eventos
      for (let i = 0; i < 1000; i++) {
        replay.recordEvent(`event_${i}`, { index: i });
      }
      
      replay.stop();
      const filePath = replay.save('performance-test');
      const loaded = ReplaySystem.load(filePath);
      
      expect(loaded.events).toHaveLength(1000);
      expect(loaded.events[999].type).toBe('event_999');
    });

    test('deve lidar com muitas ações sem problemas', () => {
      const replay = new ReplaySystem({ storagePath: tempDir, context: 'test' });
      replay.start('actions-test');
      
      // Registra 500 ações
      for (let i = 0; i < 500; i++) {
        replay.recordAction(
          { type: 'action', step: `step-${i}` },
          { success: true, index: i }
        );
      }
      
      replay.stop();
      const filePath = replay.save('actions-test');
      const loaded = ReplaySystem.load(filePath);
      
      expect(loaded.actions).toHaveLength(500);
    });
  });

  describe('Listagem e filtragem', () => {
    test('deve listar replays por contexto', () => {
      // Cria replays em diferentes contextos
      const genReplay = new ReplaySystem({ storagePath: tempDir, context: 'generation' });
      genReplay.start('gen-1');
      genReplay.stop();
      genReplay.save('gen-1');

      const engineReplay = new ReplaySystem({ storagePath: tempDir, context: 'engine' });
      engineReplay.start('engine-1');
      engineReplay.stop();
      engineReplay.save('engine-1');

      const genReplays = ReplaySystem.list(tempDir, 'generation');
      const engineReplays = ReplaySystem.list(tempDir, 'engine');
      
      expect(genReplays.length).toBeGreaterThanOrEqual(1);
      expect(engineReplays.length).toBeGreaterThanOrEqual(1);
      expect(genReplays.some(r => r.id === 'gen-1')).toBe(true);
      expect(engineReplays.some(r => r.id === 'engine-1')).toBe(true);
    });
  });
});
