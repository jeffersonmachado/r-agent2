#!/usr/bin/env node
/**
 * Script para criar banco de dados local
 * 
 * Uso: node scripts/create-database.js
 * 
 * Usa config.json como fonte principal, com fallback para env vars
 */

const { Sequelize } = require('sequelize');
const config = require('../api/utils/config');
const { parseDatabaseUrl } = require('../api/db/init');

// Obtém configuração do banco usando config.js
function getDatabaseConfig() {
  const dbUrl = config.getDatabaseUrl();
  const parsed = parseDatabaseUrl(dbUrl);
  
  return {
    host: parsed.host,
    port: parsed.port,
    username: parsed.username,
    password: parsed.password,
    database: parsed.database,
  };
}

async function createDatabase() {
  const config = getDatabaseConfig();
  const databaseName = config.database;

  console.log(`[Create DB] Configuração:`);
  console.log(`  Host: ${config.host}`);
  console.log(`  Port: ${config.port}`);
  console.log(`  User: ${config.username}`);
  console.log(`  Database: ${databaseName}`);

  // Conecta ao banco 'postgres' para criar o banco de dados
  const adminSequelize = new Sequelize('postgres', config.username, config.password, {
    host: config.host,
    port: config.port,
    dialect: 'postgres',
    logging: false,
  });

  try {
    console.log('[Create DB] Conectando ao PostgreSQL...');
    await adminSequelize.authenticate();
    console.log('[Create DB] ✅ Conectado ao PostgreSQL');

    // Verifica se o banco existe
    const [results] = await adminSequelize.query(
      `SELECT 1 FROM pg_database WHERE datname = '${databaseName}'`
    );

    if (results.length > 0) {
      console.log(`[Create DB] ⚠️  Banco de dados '${databaseName}' já existe`);
      return;
    }

    console.log(`[Create DB] Criando banco de dados '${databaseName}'...`);
    await adminSequelize.query(`CREATE DATABASE "${databaseName}"`);
    console.log(`[Create DB] ✅ Banco de dados '${databaseName}' criado com sucesso!`);

  } catch (error) {
    console.error(`[Create DB] ❌ Erro:`, error.message);
    
    if (error.message.includes('password authentication failed')) {
      console.error('\n💡 Dicas:');
      console.error('   1. Para PostgreSQL local (não Docker), use o script shell:');
      console.error('      ./scripts/create-database-local.sh');
      console.error('');
      console.error('   2. Ou configure a senha correta no .env:');
      console.error('      PGPASSWORD=sua_senha');
      console.error('      ou');
      console.error('      DATABASE_URL=postgresql://postgres:SUA_SENHA@localhost:5432/r_agent2');
      console.error('');
      console.error('   3. Ou crie manualmente via sudo:');
      console.error('      sudo -u postgres psql -c "CREATE DATABASE r_agent2;"');
    } else if (error.message.includes('ECONNREFUSED')) {
      console.error('\n💡 Dica: PostgreSQL não está rodando ou não está acessível');
      console.error('   Verifique se o PostgreSQL está rodando em:', config.host, ':', config.port);
      console.error('   Comando: sudo systemctl status postgresql');
    }
    
    process.exit(1);
  } finally {
    await adminSequelize.close();
  }
}

// Executa
createDatabase()
  .then(() => {
    console.log('[Create DB] Processo concluído');
    process.exit(0);
  })
  .catch(err => {
    console.error('[Create DB] Falha:', err);
    process.exit(1);
  });
