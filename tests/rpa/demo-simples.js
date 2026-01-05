/**
 * Demonstração Simples do Sistema RPA (sem browser)
 * 
 * Mostra como o sistema funciona sem precisar instalar Playwright
 * Execute: node tests/rpa/demo-simples.js
 */

const { ActionRecorder } = require('./actionRecorder');
const fs = require('fs');
const path = require('path');

console.log('🤖 Sistema RPA - Demonstração Simples\n');
console.log('='.repeat(60));

// ============================================
// 1. DEMONSTRAÇÃO: Criar Gravação
// ============================================
console.log('\n📹 1. Criando gravação de exemplo...\n');

const recorder = new ActionRecorder();
recorder.start({
  name: 'demo-login-completo',
  url: 'http://localhost:5173',
  version: '1.0.0',
});

// Simula ações de login
recorder.recordNavigate('http://localhost:5173/login', {
  waitFor: 'input[type="email"]',
  timeout: 30000,
});

recorder.recordFill('input[type="email"]', '{{testUser.email}}', {
  clear: true,
  validate: {
    exists: true,
    value: '{{testUser.email}}',
  },
});

recorder.recordFill('input[type="password"]', '{{testUser.password}}', {
  clear: true,
});

recorder.recordClick('button[type="submit"]', {
  waitFor: '.dashboard',
  timeout: 30000,
});

recorder.recordAssert('.dashboard', {
  exists: true,
  visible: true,
  message: 'Login realizado com sucesso',
});

recorder.recordWait(1000); // Aguarda 1 segundo

recorder.stop();

const filepath = recorder.save('demo-login-completo', {
  testUser: {
    email: 'test@example.com',
    password: 'test123',
  },
});

console.log(`✅ Gravação criada: ${filepath}`);
console.log(`   - Nome: ${recorder.metadata.name}`);
console.log(`   - ID: ${recorder.metadata.id}`);
console.log(`   - ${recorder.actions.length} ações gravadas\n`);

// Mostra ações gravadas
console.log('📝 Ações gravadas:');
recorder.actions.forEach((action, index) => {
  console.log(`   ${index + 1}. ${action.type.toUpperCase()}`);
  if (action.selector) console.log(`      Seletor: ${action.selector}`);
  if (action.url) console.log(`      URL: ${action.url}`);
  if (action.value) console.log(`      Valor: ${action.value}`);
  if (action.waitFor) console.log(`      Aguarda: ${action.waitFor}`);
});

// ============================================
// 2. DEMONSTRAÇÃO: Carregar Gravação
// ============================================
console.log('\n📂 2. Carregando gravação salva...\n');

try {
  const loaded = ActionRecorder.load('demo-login-completo');
  
  console.log('✅ Gravação carregada com sucesso!');
  console.log(`   - Nome: ${loaded.name}`);
  console.log(`   - ID: ${loaded.id}`);
  console.log(`   - Versão: ${loaded.version}`);
  console.log(`   - Criada em: ${loaded.createdAt}`);
  console.log(`   - Total de steps: ${loaded.steps.length}`);
  console.log(`   - Dados: ${Object.keys(loaded.data || {}).length} variável(is)\n`);
  
  // Mostra estrutura da gravação
  console.log('📋 Estrutura da gravação:');
  console.log(JSON.stringify(loaded, null, 2).substring(0, 500) + '...\n');
  
} catch (error) {
  console.error('❌ Erro ao carregar:', error.message);
}

// ============================================
// 3. DEMONSTRAÇÃO: Listar Gravações
// ============================================
console.log('📁 3. Listando todas as gravações...\n');

const gravações = ActionRecorder.list();
console.log(`✅ ${gravações.length} gravação(ões) encontrada(s):`);
gravações.forEach((grav, index) => {
  console.log(`   ${index + 1}. ${grav}`);
});

// ============================================
// 4. DEMONSTRAÇÃO: Criar Gravação Complexa
// ============================================
console.log('\n🎯 4. Criando gravação complexa com múltiplas ações...\n');

const recorderComplexo = new ActionRecorder();
recorderComplexo.start({
  name: 'demo-fluxo-completo',
  url: 'http://localhost:5173',
});

// Fluxo completo: Login -> Criar Fluxo -> Testar
recorderComplexo.recordNavigate('http://localhost:5173/login');
recorderComplexo.recordFill('input[type="email"]', 'admin@example.com');
recorderComplexo.recordFill('input[type="password"]', 'admin123');
recorderComplexo.recordClick('button[type="submit"]', { waitFor: '.dashboard' });

recorderComplexo.recordClick('a[href="/flows"]', { waitFor: '.flow-editor' });
recorderComplexo.recordClick('button:has-text("Novo Fluxo")');
recorderComplexo.recordFill('input[name="flowName"]', 'Fluxo de Teste RPA');
recorderComplexo.recordClick('button:has-text("Criar")', { waitFor: '.flow-canvas' });

// Adiciona nós
recorderComplexo.recordClick('.add-node-button');
recorderComplexo.recordClick('.node-type-message');
recorderComplexo.recordFill('textarea[name="messageText"]', 'Olá! Este é um teste RPA.');
recorderComplexo.recordClick('button:has-text("Salvar")');

recorderComplexo.recordAssert('.flow-node', {
  exists: true,
  count: 1,
  message: 'Nó deve ter sido criado',
});

recorderComplexo.stop();

const filepathComplexo = recorderComplexo.save('demo-fluxo-completo', {
  admin: {
    email: 'admin@example.com',
    password: 'admin123',
  },
});

console.log(`✅ Gravação complexa criada: ${filepathComplexo}`);
console.log(`   - ${recorderComplexo.actions.length} ações gravadas`);
console.log(`   - Fluxo completo: Login → Criar Fluxo → Adicionar Nó → Validar\n`);

// ============================================
// 5. DEMONSTRAÇÃO: Estrutura de Dados
// ============================================
console.log('📊 5. Estrutura de dados da gravação...\n');

const exemplo = {
  id: 'exemplo-gravacao',
  name: 'Exemplo de Gravação',
  version: '1.0.0',
  steps: [
    {
      type: 'navigate',
      url: '{{urls.frontend}}/login',
      waitFor: 'input[type="email"]',
    },
    {
      type: 'fill',
      selector: 'input[type="email"]',
      value: '{{testUser.email}}',
      validate: { value: '{{testUser.email}}' },
    },
  ],
  data: {
    testUser: { email: 'test@example.com' },
    urls: { frontend: 'http://localhost:5173' },
  },
};

console.log('📋 Exemplo de gravação JSON:');
console.log(JSON.stringify(exemplo, null, 2));

// ============================================
// 6. DEMONSTRAÇÃO: Substituição de Variáveis
// ============================================
console.log('\n🔄 6. Demonstração de substituição de variáveis...\n');

function substituirVariaveis(str, data) {
  return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const keys = key.trim().split('.');
    let value = data;
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return match;
      }
    }
    return value !== undefined ? String(value) : match;
  });
}

const template = 'Olá {{testUser.name}}, seu email é {{testUser.email}}';
const dados = {
  testUser: {
    name: 'João Silva',
    email: 'joao@example.com',
  },
};

const resultado = substituirVariaveis(template, dados);
console.log(`Template: ${template}`);
console.log(`Dados: ${JSON.stringify(dados, null, 2)}`);
console.log(`Resultado: ${resultado}`);

// ============================================
// RESUMO
// ============================================
console.log('\n' + '='.repeat(60));
console.log('✨ Demonstração concluída!\n');
console.log('📚 Próximos passos:');
console.log('   1. Instale Playwright: npx playwright install chromium');
console.log('   2. Execute testes: npm run test:rpa');
console.log('   3. Veja exemplos em: tests/rpa/seeds/');
console.log('   4. Leia documentação: tests/rpa/README.md\n');

