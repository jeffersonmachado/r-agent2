#!/usr/bin/env node

/**
 * Script para testar o login do systemadmin
 */

const authService = require('../api/services/authService');

console.log('=== Teste de Login SystemAdmin ===\n');

// Testa login com credenciais corretas
console.log('1. Testando login com username: systemadmin, password: Admin123!');
const result = authService.login('systemadmin', 'Admin123!', '127.0.0.1', 'test-script');

if (result.success) {
  console.log('✅ Login bem-sucedido!');
  console.log('   Token:', result.token.substring(0, 20) + '...');
  console.log('   Agent ID:', result.agent.id);
  console.log('   Username:', result.agent.username);
  console.log('   Role:', result.agent.role);
  console.log('   Tenant ID:', result.agent.tenantId);
  console.log('   Active:', result.agent.active);
  console.log('   Status:', result.agent.status);
} else {
  console.log('❌ Login falhou!');
  console.log('   Erro:', result.error);
}

// Lista todos os agentes para verificar
console.log('\n2. Listando todos os agentes:');
const agents = authService.listAgents();
agents.forEach(agent => {
  if (agent.username.toLowerCase() === 'systemadmin') {
    console.log('\n   SystemAdmin encontrado:');
    console.log('   - ID:', agent.id);
    console.log('   - Username:', agent.username);
    console.log('   - Email:', agent.email);
    console.log('   - Role:', agent.role);
    console.log('   - Tenant ID:', agent.tenantId);
    console.log('   - Active:', agent.active);
    console.log('   - Status:', agent.status);
  }
});

// Testa verificação de senha diretamente
console.log('\n3. Testando verificação de senha:');
const systemAdminAgent = agents.find(a => a.username.toLowerCase() === 'systemadmin');
if (systemAdminAgent) {
  // Precisamos acessar o agente completo para ter acesso ao passwordHash e salt
  const { _internal } = authService;
  const allAgents = authService.listAgents();
  // Não temos acesso direto ao passwordHash, então vamos testar o login novamente com diferentes senhas
  console.log('   Testando senha correta...');
  const test1 = authService.login('systemadmin', 'Admin123!', '127.0.0.1', 'test');
  console.log('   Resultado:', test1.success ? '✅ Senha correta' : '❌ ' + test1.error);
  
  console.log('   Testando senha incorreta...');
  const test2 = authService.login('systemadmin', 'SenhaErrada123!', '127.0.0.1', 'test');
  console.log('   Resultado:', !test2.success ? '✅ Senha incorreta rejeitada' : '❌ Senha incorreta aceita (ERRO!)');
} else {
  console.log('   ❌ SystemAdmin não encontrado na lista de agentes!');
}

console.log('\n=== Fim do Teste ===');
