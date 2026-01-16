/**
 * Script de teste manual do Sistema de Replay
 * Executa testes básicos sem dependências de Jest
 */

const { ReplaySystem } = require('../../lib/replaySystem');
const fs = require('fs');
const path = require('path');
const os = require('os');

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    testsPassed++;
    console.log(`✅ ${name}`);
  } catch (error) {
    testsFailed++;
    console.error(`❌ ${name}`);
    console.error(`   Erro: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

console.log('🧪 Testando Sistema de Replay...\n');

// Teste 1: Criação de instância
test('Criação de instância', () => {
  const replay = new ReplaySystem({
    storagePath: path.join(os.tmpdir(), 'replay-test'),
    context: 'test',
  });
  assert(replay !== undefined, 'ReplaySystem deve ser criado');
  assert(typeof replay.start === 'function', 'deve ter método start');
  assert(typeof replay.stop === 'function', 'deve ter método stop');
  assert(typeof replay.save === 'function', 'deve ter método save');
});

// Teste 2: Inicialização
test('Inicialização do replay', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-test-'));
  const replay = new ReplaySystem({
    storagePath: tempDir,
    context: 'test',
  });
  
  replay.start('test-replay-123');
  const data = replay.getData();
  
  assert(data !== undefined, 'data deve ser definido');
  assert(data.id === 'test-replay-123', 'ID deve ser definido');
  assert(data.startTime !== undefined, 'startTime deve ser definido');
  assert(data.context === 'test', 'context deve ser definido');
  
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// Teste 3: Registro de ações
test('Registro de ações', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-test-'));
  const replay = new ReplaySystem({
    storagePath: tempDir,
    context: 'test',
  });
  
  replay.start('test-replay');
  replay.recordAction(
    { type: 'test_action', step: 'step1' },
    { success: true, actual: { value: 123 } }
  );
  
  const data = replay.getData();
  assert(data.actions.length === 1, 'deve ter 1 ação');
  assert(data.actions[0].type === 'test_action', 'tipo deve ser test_action');
  
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// Teste 4: Registro de eventos
test('Registro de eventos', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-test-'));
  const replay = new ReplaySystem({
    storagePath: tempDir,
    context: 'test',
  });
  
  replay.start('test-replay');
  replay.recordEvent('test_event', { data: 'value' });
  
  const data = replay.getData();
  assert(data.events.length === 1, 'deve ter 1 evento');
  assert(data.events[0].type === 'test_event', 'tipo deve ser test_event');
  
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// Teste 5: Registro de erros
test('Registro de erros', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-test-'));
  const replay = new ReplaySystem({
    storagePath: tempDir,
    context: 'test',
  });
  
  replay.start('test-replay');
  const error = new Error('Test error');
  replay.recordError(error, 'test-step');
  
  const data = replay.getData();
  assert(data.errors.length === 1, 'deve ter 1 erro');
  assert(data.errors[0].message === 'Test error', 'mensagem deve ser correta');
  
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// Teste 6: Salvamento
test('Salvamento de replay', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-test-'));
  const replay = new ReplaySystem({
    storagePath: tempDir,
    context: 'test',
  });
  
  replay.start('test-replay-789');
  replay.recordAction({ type: 'test' }, {});
  replay.stop();
  
  const filePath = replay.save('test-replay-789');
  
  assert(fs.existsSync(filePath), 'arquivo deve existir');
  
  const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  assert(saved !== null, 'deve carregar dados');
  assert(saved.id === 'test-replay-789', 'ID deve ser correto');
  assert(saved.actions.length === 1, 'deve ter 1 ação');
  
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// Teste 7: Carregamento
test('Carregamento de replay', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-test-'));
  const replay = new ReplaySystem({
    storagePath: tempDir,
    context: 'test',
  });
  
  replay.start('load-test');
  replay.recordAction({ type: 'test' }, {});
  replay.stop();
  
  const filePath = replay.save('load-test');
  const loaded = ReplaySystem.load(filePath); // Passa caminho completo
  
  assert(loaded !== null, 'deve carregar replay');
  if (loaded) {
    assert(loaded.id === 'load-test', 'ID deve ser correto');
    assert(loaded.actions.length === 1, 'deve ter 1 ação');
  }
  
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// Teste 8: Fluxo completo
test('Fluxo completo de replay', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-test-'));
  const replay = new ReplaySystem({
    storagePath: tempDir,
    context: 'test',
  });
  
  const replayId = 'integration-test';
  replay.start(replayId, { test: true });
  
  replay.recordEvent('started');
  replay.recordAction({ type: 'action1' }, { success: true });
  replay.recordAction({ type: 'action2' }, { success: true });
  replay.recordEvent('completed');
  
  replay.stop();
  
  const filePath = replay.save(replayId);
  const loaded = ReplaySystem.load(filePath); // Passa caminho completo
  
  assert(loaded !== null, 'deve carregar replay');
  if (loaded) {
    assert(loaded.id === replayId, 'ID deve ser correto');
    assert(loaded.actions.length === 2, 'deve ter 2 ações');
    assert(loaded.events.length === 2, 'deve ter 2 eventos');
    assert(loaded.startTime !== undefined, 'startTime deve existir');
    assert(loaded.endTime !== undefined, 'endTime deve existir');
  }
  
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// Teste 9: Múltiplos replays
test('Múltiplos replays independentes', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-test-'));
  
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
  
  const loaded1 = ReplaySystem.load(path1); // Passa caminho completo
  const loaded2 = ReplaySystem.load(path2); // Passa caminho completo
  
  assert(loaded1 !== null, 'deve carregar replay1');
  assert(loaded2 !== null, 'deve carregar replay2');
  if (loaded1 && loaded2) {
    assert(loaded1.id === 'replay-1', 'replay1 ID correto');
    assert(loaded2.id === 'replay-2', 'replay2 ID correto');
    assert(loaded1.actions[0].type === 'action1', 'replay1 ação correta');
    assert(loaded2.actions[0].type === 'action2', 'replay2 ação correta');
  }
  
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// Teste 10: Listagem
test('Listagem de replays', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-test-'));
  
  const replay1 = new ReplaySystem({ storagePath: tempDir, context: 'test' });
  replay1.start('replay-1');
  replay1.stop();
  replay1.save('replay-1');

  const replay2 = new ReplaySystem({ storagePath: tempDir, context: 'test' });
  replay2.start('replay-2');
  replay2.stop();
  replay2.save('replay-2');

  const replays = ReplaySystem.list(tempDir);
  
  assert(replays.length >= 2, 'deve listar pelo menos 2 replays');
  assert(replays.some(r => r.id === 'replay-1'), 'deve conter replay-1');
  assert(replays.some(r => r.id === 'replay-2'), 'deve conter replay-2');
  
  fs.rmSync(tempDir, { recursive: true, force: true });
});

console.log('\n📊 Resultados:');
console.log(`  ✅ Passou: ${testsPassed}`);
console.log(`  ❌ Falhou: ${testsFailed}`);
console.log(`  📈 Total: ${testsPassed + testsFailed}`);

if (testsFailed === 0) {
  console.log('\n🎉 Todos os testes passaram!');
  process.exit(0);
} else {
  console.log('\n⚠️  Alguns testes falharam');
  process.exit(1);
}
