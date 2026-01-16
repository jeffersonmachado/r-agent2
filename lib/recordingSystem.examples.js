/**
 * Exemplos de uso do Sistema de Gravação
 * 
 * Este arquivo demonstra como usar o RecordingSystem em diferentes contextos.
 */

const { RecordingSystem } = require('./recordingSystem');
const path = require('path');

// ============================================
// Exemplo 1: Gravação RPA
// ============================================
async function exemploRpa() {
  const recording = new RecordingSystem({
    storagePath: path.join(process.cwd(), 'recordings', 'rpa'),
    context: 'rpa',
    enableTimestamps: false, // Seeds não devem ter timestamps
  });

  recording.start('login-flow', {
    name: 'Fluxo de Login',
    description: 'Gravação do fluxo completo de login',
    source: 'manual',
  });

  // Grava ações
  recording.recordNavigate('http://localhost:5173/login');
  recording.recordFill('input[name="username"]', 'systemadmin', { step: 'fill-username' });
  recording.recordFill('input[type="password"]', 'Admin123!', { step: 'fill-password' });
  recording.recordClick('button[type="submit"]', { step: 'submit-login' });
  recording.recordWait('text=/Dashboard/', { step: 'wait-redirect' });

  recording.stop();
  const filePath = recording.save('login-flow');
  console.log('Gravação RPA salva:', filePath);
}

// ============================================
// Exemplo 2: Gravação de API
// ============================================
async function exemploApi() {
  const recording = new RecordingSystem({
    storagePath: path.join(process.cwd(), 'recordings', 'api'),
    context: 'api',
    enableTimestamps: true,
  });

  recording.start('api-test-suite', {
    name: 'Teste de API',
    description: 'Gravação de chamadas de API',
  });

  // Grava chamadas de API
  recording.recordApiCall('POST', '/auth/login', {
    step: 'login',
    body: { username: 'user', password: 'pass' },
  });

  recording.recordApiCall('GET', '/api/users', {
    step: 'list-users',
    headers: { Authorization: 'Bearer token' },
  });

  recording.stop();
  recording.save('api-test-suite');
}

// ============================================
// Exemplo 3: Gravação de Processo de Geração
// ============================================
async function exemploGeneration() {
  const recording = new RecordingSystem({
    storagePath: path.join(process.cwd(), 'recordings', 'generation'),
    context: 'generation',
  });

  recording.start('flow-generation', {
    name: 'Geração de Fluxo',
    description: 'Gravação do processo de geração de fluxo',
  });

  // Grava passos de geração
  recording.recordGeneration('flow', {
    description: 'Fluxo de atendimento',
    useRag: true,
  }, {
    step: 'generate-flow',
  });

  recording.recordGeneration('rpa', {
    flowId: 'flow-123',
  }, {
    step: 'generate-rpa',
  });

  recording.addMetadata({
    flowId: 'flow-123',
    rpaTestId: 'rpa-456',
  });

  recording.stop();
  recording.save('flow-generation');
}

// ============================================
// Exemplo 4: Gravação de Workflow
// ============================================
async function exemploWorkflow() {
  const recording = new RecordingSystem({
    storagePath: path.join(process.cwd(), 'recordings', 'workflow'),
    context: 'workflow',
  });

  recording.start('pipeline-execution', {
    name: 'Execução de Pipeline',
  });

  // Grava etapas do pipeline
  recording.recordAction({
    type: 'stage',
    step: 'validation',
    value: { status: 'completed' },
  });

  recording.recordAction({
    type: 'stage',
    step: 'generation',
    value: { status: 'completed' },
  });

  recording.stop();
  recording.save('pipeline-execution');
}

// ============================================
// Exemplo 5: Carregamento e Listagem
// ============================================
function exemploLoadAndList() {
  // Carrega uma gravação
  const loaded = RecordingSystem.load('login-flow', path.join(process.cwd(), 'recordings', 'rpa'));
  if (loaded) {
    console.log('Gravação carregada:', loaded.name);
    console.log('Passos:', loaded.steps.length);
  }

  // Lista todas as gravações
  const allRecordings = RecordingSystem.list(path.join(process.cwd(), 'recordings'));
  console.log('Total de gravações:', allRecordings.length);

  // Lista apenas gravações RPA
  const rpaRecordings = RecordingSystem.list(
    path.join(process.cwd(), 'recordings'),
    'rpa'
  );
  console.log('Gravações RPA:', rpaRecordings.length);
}

// ============================================
// Exemplo 6: Integração com ReplaySystem
// ============================================
async function exemploComReplay() {
  const { ReplaySystem } = require('./replaySystem');

  // Gravação (O QUE foi feito)
  const recording = new RecordingSystem({
    storagePath: path.join(process.cwd(), 'recordings', 'rpa'),
    context: 'rpa',
  });

  // Replay (COMO foi executado)
  const replay = new ReplaySystem({
    storagePath: path.join(process.cwd(), 'replays', 'rpa'),
    context: 'rpa',
  });

  recording.start('test-completo');
  replay.start('test-completo');

  // Durante execução: grava ação E replay
  recording.recordClick('button.submit', { step: 'submit' });
  replay.recordAction(
    { type: 'click', step: 'submit', selector: 'button.submit' },
    { success: true, startTime: new Date().toISOString() }
  );

  recording.stop();
  replay.stop();

  recording.save('test-completo');
  replay.save('test-completo');
}

module.exports = {
  exemploRpa,
  exemploApi,
  exemploGeneration,
  exemploWorkflow,
  exemploLoadAndList,
  exemploComReplay,
};
