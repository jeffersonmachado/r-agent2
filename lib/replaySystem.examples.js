/**
 * Exemplos de Uso do Sistema de Replay
 * 
 * Este arquivo demonstra como usar o Sistema de Replay em diferentes contextos.
 */

const { ReplaySystem } = require('./replaySystem');
const path = require('path');

// ============================================================================
// EXEMPLO 1: Uso em Testes RPA (Playwright)
// ============================================================================

async function exemploRpaTest(page) {
  const replay = new ReplaySystem({
    storagePath: path.join(__dirname, '../tests/rpa/replay'),
    context: 'rpa',
    enableScreenshots: true,
  });

  replay.start('test-login');

  try {
    // Navegação
    await page.goto('http://localhost:5173/login');
    replay.recordAction(
      { type: 'navigate', url: 'http://localhost:5173/login' },
      { success: true }
    );
    await replay.recordScreen(page, 'after-navigation');

    // Preenchimento
    await page.fill('input[type="text"]', 'admin');
    replay.recordAction(
      { type: 'fill', selector: 'input[type="text"]', value: 'admin' },
      { success: true }
    );

    // Clique
    await page.click('button[type="submit"]');
    replay.recordAction(
      { type: 'click', selector: 'button[type="submit"]' },
      { success: true }
    );

    await replay.recordScreen(page, 'after-submit');
  } catch (error) {
    replay.recordError(error, 'test-login');
  } finally {
    replay.stop();
    const filepath = replay.save('test-login');
    console.log('Replay salvo:', filepath);
  }
}

// ============================================================================
// EXEMPLO 2: Uso em Testes de API
// ============================================================================

async function exemploApiTest() {
  const replay = new ReplaySystem({
    storagePath: path.join(__dirname, '../tests/api/replays'),
    context: 'api',
    enableScreenshots: false, // APIs não têm screenshots
  });

  replay.start('api-user-creation');

  try {
    // POST /users
    const startTime = new Date().toISOString();
    const response = await fetch('http://localhost:3000/api/users', {
      method: 'POST',
      body: JSON.stringify({ name: 'John', email: 'john@example.com' }),
    });
    const endTime = new Date().toISOString();

    replay.recordAction(
      {
        type: 'api_call',
        endpoint: 'POST /api/users',
        value: { name: 'John', email: 'john@example.com' },
      },
      {
        success: response.ok,
        startTime,
        endTime,
        actual: { status: response.status, body: await response.json() },
      }
    );

    // GET /users/:id
    const getStartTime = new Date().toISOString();
    const getResponse = await fetch('http://localhost:3000/api/users/1');
    const getEndTime = new Date().toISOString();

    replay.recordAction(
      {
        type: 'api_call',
        endpoint: 'GET /api/users/1',
      },
      {
        success: getResponse.ok,
        startTime: getStartTime,
        endTime: getEndTime,
        actual: { status: getResponse.status },
      }
    );
  } catch (error) {
    replay.recordError(error, 'api-user-creation');
  } finally {
    replay.stop();
    replay.save('api-user-creation');
  }
}

// ============================================================================
// EXEMPLO 3: Uso em Processos de Geração (IA, Fluxos, etc.)
// ============================================================================

async function exemploGeracaoSistema() {
  const replay = new ReplaySystem({
    storagePath: path.join(__dirname, '../replays/generation'),
    context: 'generation',
    enableScreenshots: false,
  });

  replay.start('generate-tenant-xyz', {
    tenantName: 'XYZ Corp',
    requestedArtifacts: ['flow', 'rpa', 'seed'],
  });

  try {
    // Etapa 1: Validação
    replay.recordEvent('validation_started');
    const validationResult = await validateInput({ name: 'XYZ Corp' });
    replay.recordAction(
      { type: 'validation', step: 'validate-input' },
      { success: validationResult.valid }
    );
    replay.recordEvent('validation_completed', { result: validationResult });

    // Etapa 2: Geração de Contexto
    replay.recordEvent('context_generation_started');
    const context = await generateContext('XYZ Corp');
    replay.recordAction(
      { type: 'context_generation', step: 'generate-context' },
      { success: !!context }
    );
    replay.addMetadata({ contextSize: JSON.stringify(context).length });

    // Etapa 3: Geração de Fluxo
    replay.recordEvent('flow_generation_started');
    const flow = await generateFlow(context);
    replay.recordAction(
      { type: 'flow_generation', step: 'generate-flow' },
      { success: !!flow }
    );

    // Etapa 4: Geração de RPA
    replay.recordEvent('rpa_generation_started');
    const rpa = await generateRpa(flow);
    replay.recordAction(
      { type: 'rpa_generation', step: 'generate-rpa' },
      { success: !!rpa }
    );

    replay.recordEvent('generation_completed', {
      artifacts: ['flow', 'rpa'],
    });
  } catch (error) {
    replay.recordError(error, 'generation-process');
  } finally {
    replay.stop();
    replay.save('generate-tenant-xyz');
  }
}

// ============================================================================
// EXEMPLO 4: Uso em Workflows/Orquestração
// ============================================================================

async function exemploWorkflow() {
  const replay = new ReplaySystem({
    storagePath: path.join(__dirname, '../replays/workflows'),
    context: 'workflow',
  });

  replay.start('workflow-order-processing', {
    workflowId: 'order-123',
    version: '1.0',
  });

  const steps = [
    { name: 'validate-order', fn: validateOrder },
    { name: 'check-inventory', fn: checkInventory },
    { name: 'process-payment', fn: processPayment },
    { name: 'ship-order', fn: shipOrder },
  ];

  for (const step of steps) {
    try {
      const startTime = new Date().toISOString();
      const result = await step.fn();
      const endTime = new Date().toISOString();

      replay.recordAction(
        { type: 'workflow_step', step: step.name },
        {
          success: result.success,
          startTime,
          endTime,
          actual: result,
        }
      );

      replay.recordEvent('step_completed', {
        step: step.name,
        result: result.success,
      });
    } catch (error) {
      replay.recordError(error, step.name);
      break; // Para workflow em caso de erro
    }
    }
  }

  replay.stop();
  replay.save('workflow-order-processing');
}

// ============================================================================
// EXEMPLO 5: Uso Genérico (Qualquer Processo)
// ============================================================================

async function exemploGenerico() {
  const replay = new ReplaySystem({
    storagePath: './replays',
    context: 'custom',
  });

  replay.start('meu-processo-customizado', {
    userId: 'user-123',
    processType: 'data-migration',
  });

  // Registra estado inicial
  replay.recordScreen({ status: 'initial', data: {} }, 'initial-state');

  // Executa processo
  const data = await processData();
  replay.recordAction(
    { type: 'process', step: 'process-data' },
    { success: !!data }
  );

  // Registra estado final
  replay.recordScreen({ status: 'completed', data }, 'final-state');

  replay.stop();
  replay.save('meu-processo-customizado');
}

// ============================================================================
// EXEMPLO 6: Carregar e Analisar Replay
// ============================================================================

function exemploAnalisarReplay() {
  // Carregar replay
  const replay = ReplaySystem.load('test-login', './tests/rpa/replay');

  // Gerar relatório
  const report = ReplaySystem.generateReport(replay);
  console.log(report);

  // Listar todos os replays
  const replays = ReplaySystem.list('./tests/rpa/replay', 'rpa');
  console.log(`Total de replays RPA: ${replays.length}`);

  // Comparar dois replays
  const expected = ReplaySystem.load('baseline-test');
  const actual = ReplaySystem.load('current-test');
  const diff = ReplaySystem.generateDiff(expected, actual);
  console.log('Diferenças encontradas:', diff);
}

// ============================================================================
// Funções auxiliares (mock)
// ============================================================================

async function validateInput(data) {
  return { valid: true };
}

async function generateContext(name) {
  return { context: 'generated' };
}

async function generateFlow(context) {
  return { flow: 'generated' };
}

async function generateRpa(flow) {
  return { rpa: 'generated' };
}

async function validateOrder() {
  return { success: true };
}

async function checkInventory() {
  return { success: true };
}

async function processPayment() {
  return { success: true };
}

async function shipOrder() {
  return { success: true };
}

async function processData() {
  return { processed: true };
}

module.exports = {
  exemploRpaTest,
  exemploApiTest,
  exemploGeracaoSistema,
  exemploWorkflow,
  exemploGenerico,
  exemploAnalisarReplay,
};
