/**
 * Script para atualizar a senha do admin para Admin123!
 * 
 * Uso: node scripts/update-admin-password.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Função para gerar hash da senha (mesma lógica do authService)
function hashPassword(password, salt = null) {
  if (!salt) {
    salt = crypto.randomBytes(16).toString('hex');
  }
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 32, 'sha256').toString('hex');
  return { hash, salt };
}

// Caminho do arquivo de agentes
const agentsFile = path.join(__dirname, '..', 'api', 'data', 'agents.json');

try {
  // Lê o arquivo de agentes
  const agentsData = JSON.parse(fs.readFileSync(agentsFile, 'utf8'));
  
  // Procura o admin
  const adminIndex = agentsData.findIndex(agent => agent.username === 'admin');
  
  if (adminIndex === -1) {
    console.log('❌ Admin não encontrado no arquivo agents.json');
    process.exit(1);
  }
  
  // Gera novo hash para a senha Admin123!
  const { hash, salt } = hashPassword('Admin123!');
  
  // Atualiza a senha do admin
  agentsData[adminIndex].passwordHash = hash;
  agentsData[adminIndex].salt = salt;
  agentsData[adminIndex].updatedAt = new Date().toISOString();
  
  // Salva o arquivo
  fs.writeFileSync(agentsFile, JSON.stringify(agentsData, null, 2), 'utf8');
  
  console.log('✅ Senha do admin atualizada para: Admin123!');
  console.log(`   Username: admin`);
  console.log(`   Email: ${agentsData[adminIndex].email}`);
  console.log(`   Tenant ID: ${agentsData[adminIndex].tenantId}`);
  
} catch (err) {
  console.error('❌ Erro ao atualizar senha do admin:', err.message);
  process.exit(1);
}
