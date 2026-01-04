/**
 * Testes para sistema RPA.
 */

const { RpaTestRunner } = require('./rpaTestRunner');
const { ActionRecorder } = require('./actionRecorder');
const config = require('./rpaConfig');

describe('Sistema RPA', () => {
  let runner;

  beforeAll(async () => {
    runner = new RpaTestRunner({
      headless: true,
      slowMo: 50,
    });
    await runner.init();
  });

  afterAll(async () => {
    await runner.close();
  });

  describe('ActionRecorder', () => {
    test('deve criar gravação', () => {
      const recorder = new ActionRecorder();
      recorder.start({ name: 'test-recording' });
      
      expect(recorder.isRecording).toBe(true);
      expect(recorder.metadata.name).toBe('test-recording');
    });

    test('deve adicionar ações', () => {
      const recorder = new ActionRecorder();
      recorder.start({ name: 'test' });
      
      recorder.recordNavigate('http://example.com');
      recorder.recordClick('button.submit');
      recorder.recordFill('input.email', 'test@example.com');
      
      expect(recorder.actions).toHaveLength(3);
      expect(recorder.actions[0].type).toBe('navigate');
      expect(recorder.actions[1].type).toBe('click');
      expect(recorder.actions[2].type).toBe('fill');
    });

    test('deve salvar gravação', () => {
      const recorder = new ActionRecorder();
      recorder.start({ name: 'test-save' });
      recorder.recordNavigate('http://example.com');
      recorder.stop();
      
      const filepath = recorder.save('test-save');
      expect(filepath).toContain('test-save.json');
      
      // Limpa arquivo de teste
      const fs = require('fs');
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    });

    test('deve carregar gravação', () => {
      const recorder = new ActionRecorder();
      recorder.start({ name: 'test-load' });
      recorder.recordNavigate('http://example.com');
      recorder.stop();
      
      recorder.save('test-load');
      
      const loaded = ActionRecorder.load('test-load');
      expect(loaded.name).toBe('test-load');
      expect(loaded.steps).toHaveLength(1);
      
      // Limpa arquivo de teste
      const fs = require('fs');
      const path = require('path');
      const filepath = path.join(__dirname, 'recordings', 'test-load.json');
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    });
  });

  describe('RpaTestRunner', () => {
    test('deve inicializar corretamente', async () => {
      expect(runner.executor).not.toBeNull();
      expect(runner.executor.page).not.toBeNull();
    });

    test('deve executar gravação simples', async () => {
      const recording = {
        id: 'test-simple',
        name: 'Teste Simples',
        version: '1.0.0',
        steps: [
          {
            type: 'navigate',
            url: 'https://example.com',
            timeout: 10000,
          },
          {
            type: 'wait',
            condition: 1000,
          },
        ],
        data: {},
      };

      const result = await runner.playback(recording);
      
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('steps');
      expect(result.steps.length).toBeGreaterThan(0);
    }, 30000);

    test('deve detectar erros', async () => {
      const recording = {
        id: 'test-error',
        name: 'Teste de Erro',
        version: '1.0.0',
        steps: [
          {
            type: 'navigate',
            url: 'https://example.com',
          },
          {
            type: 'click',
            selector: 'button.inexistente-12345',
            timeout: 2000,
          },
        ],
        data: {},
      };

      const result = await runner.playback(recording);
      
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }, 30000);

    test('deve substituir variáveis', async () => {
      const recording = {
        id: 'test-variables',
        name: 'Teste de Variáveis',
        version: '1.0.0',
        steps: [
          {
            type: 'navigate',
            url: 'https://example.com',
          },
        ],
        data: {
          data: {
            testValue: 'test-123',
          },
        },
      };

      // Testa substituição de variáveis
      const testValue = runner.executor.replaceVariables('{{data.testValue}}', recording.data);
      expect(testValue).toBe('test-123');
    }, 30000);
  });
});

