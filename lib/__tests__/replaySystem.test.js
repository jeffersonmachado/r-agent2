/**
 * Testes para o Sistema de Replay
 */

const { ReplaySystem } = require('../replaySystem');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('ReplaySystem', () => {
  let tempDir;
  let replay;

  beforeEach(() => {
    // Cria diretório temporário para testes
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-test-'));
    replay = new ReplaySystem({
      storagePath: tempDir,
      context: 'test',
      enableScreenshots: false,
    });
  });

  afterEach(() => {
    // Limpa diretório temporário
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Inicialização', () => {
    test('deve criar instância do ReplaySystem', () => {
      expect(replay).toBeDefined();
      expect(replay.start).toBeDefined();
      expect(replay.stop).toBeDefined();
      expect(replay.save).toBeDefined();
    });

    test('deve inicializar com configurações padrão', () => {
      const defaultReplay = new ReplaySystem();
      expect(defaultReplay).toBeDefined();
    });
  });

  describe('start()', () => {
    test('deve iniciar um replay com ID', () => {
      const replayId = 'test-replay-123';
      replay.start(replayId);

      const data = replay.getData();
      expect(data.id).toBe(replayId);
      expect(data.startTime).toBeDefined();
      expect(data.context).toBe('test');
    });

    test('deve iniciar com metadados', () => {
      const replayId = 'test-replay-456';
      const metadata = { userId: 'user123', action: 'test' };
      
      replay.start(replayId, metadata);

      const data = replay.getData();
      expect(data.metadata.userId).toBe('user123');
      expect(data.metadata.action).toBe('test');
      expect(data.metadata.version).toBeDefined();
      expect(data.metadata.createdAt).toBeDefined();
    });

    test('deve gerar ID automático se não fornecido', () => {
      replay.start();
      const data = replay.getData();
      expect(data.id).toBeDefined();
      expect(data.id).toMatch(/^replay-/);
    });
  });

  describe('stop()', () => {
    test('deve parar o replay e definir endTime', async () => {
      replay.start('test-replay');
      
      // Aguarda um pouco para garantir diferença de tempo
      await new Promise((resolve) => setTimeout(resolve, 10));

      replay.stop();
      const data = replay.getData();
      expect(data.endTime).toBeDefined();
      expect(new Date(data.endTime).getTime()).toBeGreaterThan(
        new Date(data.startTime).getTime()
      );
    });
  });

  describe('recordAction()', () => {
    test('deve registrar uma ação', () => {
      replay.start('test-replay');
      
      replay.recordAction(
        { type: 'test_action', step: 'step1' },
        { success: true, actual: { value: 123 } }
      );

      const data = replay.getData();
      expect(data.actions).toHaveLength(1);
      expect(data.actions[0].type).toBe('test_action');
      expect(data.actions[0].step).toBe('step1');
      expect(data.actions[0].success).toBe(true);
    });

    test('deve registrar múltiplas ações', () => {
      replay.start('test-replay');
      
      replay.recordAction({ type: 'action1' }, {});
      replay.recordAction({ type: 'action2' }, {});
      replay.recordAction({ type: 'action3' }, {});

      const data = replay.getData();
      expect(data.actions).toHaveLength(3);
    });
  });

  describe('recordEvent()', () => {
    test('deve registrar um evento', () => {
      replay.start('test-replay');
      
      replay.recordEvent('test_event', { data: 'value' });

      const data = replay.getData();
      expect(data.events).toHaveLength(1);
      expect(data.events[0].type).toBe('test_event');
      expect(data.events[0].data).toEqual({ data: 'value' });
    });

    test('deve registrar múltiplos eventos', () => {
      replay.start('test-replay');
      
      replay.recordEvent('event1');
      replay.recordEvent('event2', { value: 123 });
      replay.recordEvent('event3');

      const data = replay.getData();
      expect(data.events).toHaveLength(3);
    });
  });

  describe('recordError()', () => {
    test('deve registrar um erro', () => {
      replay.start('test-replay');
      
      const error = new Error('Test error');
      replay.recordError(error, 'test-step');

      const data = replay.getData();
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0].message).toBe('Test error');
      expect(data.errors[0].step).toBe('test-step');
    });

    test('deve registrar erro com contexto adicional', () => {
      replay.start('test-replay');
      
      const error = new Error('Test error');
      replay.recordError(error, 'test-step', { extra: 'data' });

      const data = replay.getData();
      expect(data.errors[0].extra).toBe('data');
    });
  });

  describe('save()', () => {
    test('deve salvar replay em arquivo JSON', () => {
      replay.start('test-replay-789');
      replay.recordAction({ type: 'test' }, {});
      replay.stop();
      
      const filePath = replay.save('test-replay-789');
      
      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath)).toBe(true);
      
      const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(saved.id).toBe('test-replay-789');
      expect(saved.actions).toHaveLength(1);
    });

    test('deve criar diretório se não existir', () => {
      const newDir = path.join(tempDir, 'new-subdir');
      const newReplay = new ReplaySystem({
        storagePath: newDir,
        context: 'test',
      });
      
      newReplay.start('test');
      newReplay.stop();
      
      const filePath = newReplay.save('test');
      expect(fs.existsSync(newDir)).toBe(true);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    test('deve usar ID do replay se não fornecido', () => {
      replay.start('auto-id-test');
      replay.stop();
      
      const filePath = replay.save();
      
      expect(filePath).toContain('auto-id-test');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    test('deve salvar em subpasta por tenant quando tenantId é fornecido no construtor', () => {
      const tenantReplay = new ReplaySystem({
        storagePath: tempDir,
        tenantId: 'tenant-1',
        context: 'test',
        enableScreenshots: false,
      });

      tenantReplay.start('tenant-replay');
      tenantReplay.stop();
      const filePath = tenantReplay.save('tenant-replay');

      const expectedDir = path.join(tempDir, 'tenant-1');
      expect(path.dirname(filePath)).toBe(expectedDir);
      expect(fs.existsSync(filePath)).toBe(true);
    });

    test('deve inferir tenantId do metadata do start() e salvar em subpasta', () => {
      const tenantReplay = new ReplaySystem({
        storagePath: tempDir,
        context: 'test',
        enableScreenshots: false,
      });

      tenantReplay.start('tenant-replay-2', { tenantId: 'tenant-2' });
      tenantReplay.stop();
      const filePath = tenantReplay.save('tenant-replay-2');

      const expectedDir = path.join(tempDir, 'tenant-2');
      expect(path.dirname(filePath)).toBe(expectedDir);
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe('load()', () => {
    test('deve carregar replay de arquivo', () => {
      replay.start('load-test');
      replay.recordAction({ type: 'test' }, {});
      replay.stop();
      
      const filePath = replay.save('load-test');
      
      const loaded = ReplaySystem.load(filePath);
      
      expect(loaded).toBeDefined();
      expect(loaded.id).toBe('load-test');
      expect(loaded.actions).toHaveLength(1);
    });

    test('deve retornar null se arquivo não existir', () => {
      const loaded = ReplaySystem.load('/path/that/does/not/exist.json');
      expect(loaded).toBeNull();
    });
  });

  describe('list()', () => {
    test('deve listar todos os replays no diretório', () => {
      // Cria alguns replays
      const replay1 = new ReplaySystem({ storagePath: tempDir, context: 'test' });
      replay1.start('replay-1');
      replay1.stop();
      replay1.save('replay-1');

      const replay2 = new ReplaySystem({ storagePath: tempDir, context: 'test' });
      replay2.start('replay-2');
      replay2.stop();
      replay2.save('replay-2');

      const replays = ReplaySystem.list(tempDir);
      
      expect(replays.length).toBeGreaterThanOrEqual(2);
      expect(replays.some(r => r.id === 'replay-1')).toBe(true);
      expect(replays.some(r => r.id === 'replay-2')).toBe(true);
    });

    test('deve filtrar por contexto se fornecido', () => {
      const replay1 = new ReplaySystem({ storagePath: tempDir, context: 'test' });
      replay1.start('test-replay');
      replay1.stop();
      replay1.save('test-replay');

      const replay2 = new ReplaySystem({ storagePath: tempDir, context: 'other' });
      replay2.start('other-replay');
      replay2.stop();
      replay2.save('other-replay');

      const testReplays = ReplaySystem.list(tempDir, 'test');
      
      expect(testReplays.length).toBeGreaterThanOrEqual(1);
      expect(testReplays.some(r => r.id === 'test-replay')).toBe(true);
    });
  });

  describe('Integração completa', () => {
    test('deve executar fluxo completo de replay', () => {
      const replayId = 'integration-test';
      
      replay.start(replayId, { test: true });
      
      replay.recordEvent('started');
      replay.recordAction({ type: 'action1' }, { success: true });
      replay.recordAction({ type: 'action2' }, { success: true });
      replay.recordEvent('completed');
      
      replay.stop();
      
      const filePath = replay.save(replayId);
      
      // Verifica arquivo salvo
      expect(fs.existsSync(filePath)).toBe(true);
      
      // Carrega e verifica
      const loaded = ReplaySystem.load(filePath);
      expect(loaded.id).toBe(replayId);
      expect(loaded.actions).toHaveLength(2);
      expect(loaded.events).toHaveLength(2);
      expect(loaded.startTime).toBeDefined();
      expect(loaded.endTime).toBeDefined();
    });

    test('deve lidar com erros durante execução', () => {
      replay.start('error-test');
      
      replay.recordAction({ type: 'action1' }, { success: true });
      
      const error = new Error('Something went wrong');
      replay.recordError(error, 'action2');
      
      replay.recordEvent('error_occurred');
      replay.stop();
      
      const filePath = replay.save('error-test');
      const loaded = ReplaySystem.load(filePath);
      
      expect(loaded.errors).toHaveLength(1);
      expect(loaded.errors[0].message).toBe('Something went wrong');
    });
  });
});
