/**
 * Inicialização do banco de dados
 * 
 * Responsabilidades:
 * - Criar banco de dados se não existir
 * - Sincronizar models (criar/atualizar tabelas)
 * - Garantir que o schema está atualizado
 */

const { Sequelize } = require('sequelize');
const { getSequelize, connect } = require('./sequelize');
const { defineRelationships } = require('./models');
const logger = require('../utils/logger');
const config = require('../utils/config');

/**
 * Cria o banco de dados se não existir
 * 
 * @param {string} databaseName - Nome do banco de dados
 * @param {Object} config - Configuração de conexão (sem database)
 * @returns {Promise<void>}
 */
async function createDatabaseIfNotExists(databaseName, config) {
  // Conecta ao banco 'postgres' para criar o banco de dados
  const adminSequelize = new Sequelize('postgres', config.username, config.password, {
    host: config.host,
    port: config.port,
    dialect: 'postgres',
    logging: false,
  });

  try {
    await adminSequelize.authenticate();
    
    // Verifica se o banco existe
    const [results] = await adminSequelize.query(
      `SELECT 1 FROM pg_database WHERE datname = '${databaseName}'`
    );

    if (results.length === 0) {
      logger.info(`[DB Init] Criando banco de dados '${databaseName}'...`);
      await adminSequelize.query(`CREATE DATABASE "${databaseName}"`);
      logger.info(`[DB Init] ✅ Banco de dados '${databaseName}' criado com sucesso`);
    } else {
      logger.info(`[DB Init] Banco de dados '${databaseName}' já existe`);
    }
  } catch (error) {
    logger.error(`[DB Init] Erro ao verificar/criar banco de dados: ${error.message}`);
    throw error;
  } finally {
    await adminSequelize.close();
  }
}

/**
 * Sincroniza os models com o banco de dados
 * Cria/atualiza tabelas conforme necessário
 * 
 * IMPORTANTE: sync() NÃO deve ser usado em produção.
 * 
 * Regras de execução:
 * - PRODUÇÃO: sync() NUNCA é executado (bloqueio absoluto por segurança)
 * - DEV/TEST: sync() só executa se database.allowSync === true no config.json
 * - force: só permitido em NODE_ENV === "test"
 * - alter: permitido apenas em dev/test (nunca em produção)
 * 
 * @param {Object} options - Opções de sincronização
 * @param {boolean} options.force - Força recriação de tabelas (apaga dados!)
 * @param {boolean} options.alter - Altera tabelas existentes para corresponder aos models
 * @returns {Promise<void>}
 */
async function syncDatabase(options = {}) {
  const sequelize = getSequelize();
  if (!sequelize) {
    throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
  }

  const nodeEnv = process.env.NODE_ENV || 'development';
  
  // REGRA A: PRODUÇÃO - NUNCA executar sync() - BLOQUEIO ABSOLUTO
  // IMPORTANTE: Mesmo que database.allowSync=true no config, produção NUNCA executa sync
  if (nodeEnv === 'production') {
    // Apenas testa conexão e registra no logger
    try {
      await sequelize.authenticate();
      logger.info('[DB] Produção detectada: sequelize.sync() desabilitado. Schema é gerenciado por migrations.');
      logger.info('[DB] Config database.allowSync será ignorado em produção por segurança.');
    } catch (authErr) {
      logger.error(`[DB] Erro ao autenticar em produção: ${authErr.message}`);
      throw authErr;
    }
    return;
  }

  // REGRA B: DEV/TEST - Verifica se allowSync está habilitado no config.json
  // Usa config central (config.json via config.js), não ENV vars
  // NOTA: Em produção, esta verificação nunca é alcançada devido ao bloqueio acima
  const allowSync = config.get('database.allowSync') === true;
  
  if (!allowSync) {
    logger.info('[DB] Auto-sync desabilitado (database.allowSync=false).');
    return;
  }

  // allowSync === true e NODE_ENV !== "production"
  const { force = false, alter = true } = options;

  // REGRA C: force só permitido em ambiente de teste
  // NOTA: Em produção, esta verificação nunca é alcançada devido ao bloqueio acima
  let finalForce = false;
  if (force) {
    if (nodeEnv === 'test') {
      finalForce = true;
      logger.warn('[DB] ⚠️  FORCE MODE: Todas as tabelas serão recriadas (dados serão perdidos!)');
    } else {
      // Em qualquer outro ambiente, force deve ser sempre false
      logger.warn('[DB] ⚠️  force=true só é permitido em NODE_ENV=test. Ignorando force.');
      finalForce = false;
    }
  }

  // alter permitido apenas em dev/test (nunca em produção, mas já bloqueado acima)
  // NOTA: Em produção, esta verificação nunca é alcançada devido ao bloqueio acima
  const finalAlter = alter && nodeEnv !== 'production';

  // Log conforme especificação
  logger.info('[DB] Auto-sync habilitado via config (database.allowSync=true). Executando sync(alter=true).');

  try {
    // Carrega todos os models antes de sincronizar
    const { Tenant, User, TenantUser, TenantSetting, TenantAISetting, TenantAICredential, AuditLog } = require('./models');
    
    // Garante que os models estão inicializados
    Tenant();
    User();
    TenantUser();
    TenantSetting();
    TenantAISetting();
    TenantAICredential();
    AuditLog();

    // Define relacionamentos
    defineRelationships();

    // Sincroniza o banco de dados
    await sequelize.sync({ 
      force: finalForce,
      alter: finalAlter,
      logging: nodeEnv === 'development' 
        ? (msg) => logger.debug(`[DB Sync] ${msg}`)
        : false,
    });

    logger.info('[DB] ✅ Sincronização do banco de dados concluída');
  } catch (error) {
    logger.error(`[DB] Erro ao sincronizar banco de dados: ${error.message}`, error);
    throw error;
  }
}

/**
 * Extrai informações do banco de dados da DATABASE_URL
 * 
 * @param {string} databaseUrl - URL do banco de dados
 * @returns {Object} Configuração do banco
 */
function parseDatabaseUrl(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    return {
      host: url.hostname,
      port: parseInt(url.port || '5432', 10),
      username: url.username,
      password: url.password,
      database: url.pathname.replace(/^\//, ''), // Remove barra inicial
    };
  } catch (error) {
    throw new Error(`Erro ao parsear DATABASE_URL: ${error.message}`);
  }
}

/**
 * Obtém configuração do banco para criação (sem database name)
 * Usa config.js como fonte principal
 */
function getDatabaseConfigForCreation() {
  const dbUrl = config.getDatabaseUrl();
  const parsed = parseDatabaseUrl(dbUrl);
  
  return {
    host: parsed.host,
    port: parsed.port,
    username: parsed.username,
    password: parsed.password,
  };
}

/**
 * Obtém o nome do banco de dados
 * Usa config.js como fonte principal
 */
function getDatabaseName() {
  const dbUrl = config.getDatabaseUrl();
  const parsed = parseDatabaseUrl(dbUrl);
  return parsed.database;
}

/**
 * Inicializa completamente o banco de dados
 * - Conecta ao PostgreSQL
 * - Cria banco se não existir
 * - Sincroniza models
 * 
 * @param {Object} options - Opções de inicialização
 * @returns {Promise<void>}
 */
async function initializeDatabase(options = {}) {
  const { 
    createDatabase = true,
    syncModels = true,
    syncOptions = { force: false, alter: true },
  } = options;

  logger.info('[DB Init] Iniciando inicialização do banco de dados...');

  try {
    // 1. Conecta ao PostgreSQL
    await connect();

    // 2. Cria banco de dados se necessário
    if (createDatabase) {
      let config;
      let databaseName;

      if (process.env.DATABASE_URL) {
        // Extrai informações da DATABASE_URL
        const parsed = parseDatabaseUrl(process.env.DATABASE_URL);
        databaseName = parsed.database;
        config = {
          host: parsed.host,
          port: parsed.port,
          username: parsed.username,
          password: parsed.password,
        };
      } else {
        // Usa variáveis individuais
        config = {
          host: process.env.PGHOST || 'localhost',
          port: parseInt(process.env.PGPORT || '5432', 10),
          username: process.env.PGUSER || 'postgres',
          password: process.env.PGPASSWORD || 'postgres',
        };
        databaseName = process.env.PGDATABASE || 'r_agent2';
      }
      
      await createDatabaseIfNotExists(databaseName, config);
    }

    // 3. Sincroniza models
    if (syncModels) {
      await syncDatabase(syncOptions);
    }

    logger.info('[DB Init] ✅ Inicialização do banco de dados concluída com sucesso');
  } catch (error) {
    logger.error(`[DB Init] ❌ Erro na inicialização do banco de dados: ${error.message}`, error);
    throw error;
  }
}

module.exports = {
  createDatabaseIfNotExists,
  syncDatabase,
  initializeDatabase,
  parseDatabaseUrl,
  getDatabaseConfigForCreation,
  getDatabaseName,
};
