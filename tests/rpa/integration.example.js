/**
 * Exemplo de integração do RPA com testes existentes.
 * 
 * Este arquivo mostra como usar o RPA em conjunto com o sistema de testes existente.
 */

const { RpaTestRunner } = require('./rpaTestRunner');
const { validateTestData } = require('../helpers/dataValidationHelper');

describe('Integração RPA com Sistema de Testes', () => {
  let runner;

  beforeAll(async () => {
    // Gate de dados: valida dados antes de executar testes RPA
    const dataValidation = validateTestData();
    if (!dataValidation.passed) {
      throw new Error(
        'Dados de teste não validados. Execute: npm run seed:test'
      );
    }

    runner = new RpaTestRunner({
      headless: true,
      slowMo: 100,
    });
    await runner.init();
  });

  afterAll(async () => {
    await runner.close();
    
    // Gera relatório final
    const report = runner.generateReport();
    console.log('\n📊 Relatório RPA:');
    console.log(`Total: ${report.summary.total}`);
    console.log(`Passou: ${report.summary.passed}`);
    console.log(`Falhou: ${report.summary.failed}`);
    console.log(`Taxa de sucesso: ${report.summary.successRate}`);
    
    // Salva relatório
    runner.saveReport('rpa-integration-report');
  });

  test('deve executar gravação de login', async () => {
    const result = await runner.playback('example-login', {
      testUser: {
        email: 'test@example.com',
        password: 'test123',
      },
    });

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
  }, 60000);

  test('deve detectar erro quando elemento não existe', async () => {
    const recording = {
      id: 'test-error-detection',
      name: 'Teste de Detecção de Erro',
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
    expect(result.errors[0].error).toContain('not found');
  }, 30000);
});

