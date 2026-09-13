/**
 * Runner de migrations Sequelize usando Umzug
 * 
 * Executa migrations Sequelize em ordem, registrando no SequelizeMeta.
 * Cada migration roda em transação.
 * 
 * Uso: node api/db/migrate.js
 */

// Carrega variáveis do .env se existir
try {
  require('dotenv').config();
} catch (e) {
  // dotenv não instalado, tenta carregar manualmente
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    });
  }
}

const path = require('path');
const { Umzug, SequelizeStorage } = require('umzug');
const { connect, getSequelize, close, Sequelize } = require('./sequelize');
const logger = require('../utils/logger');

/**
 * Cria instância Umzug configurada
 */
function createUmzug() {
  const sequelize = getSequelize();
  
  if (!sequelize) {
    throw new Error('Sequelize não inicializado');
  }
  
  return new Umzug({
    migrations: {
      glob: path.join(__dirname, 'migrations', '*.js'),
      resolve: ({ name, path: migrationPath, context }) => {
        const migration = require(migrationPath);
        return {
          name,
          up: async () => migration.up(context, Sequelize),
          down: async () => migration.down(context, Sequelize),
        };
      },
    },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: {
      info: (msg) => logger.info(`[Migration] ${msg}`),
      warn: (msg) => logger.warn(`[Migration] ${msg}`),
      error: (msg) => logger.error(`[Migration] ${msg}`),
      debug: (msg) => logger.debug(`[Migration] ${msg}`),
    },
  });
}

/**
 * Obtém status das migrations (executadas e pendentes)
 */
async function getMigrationStatus() {
  try {
    // Conecta ao banco
    await connect(30, 1000); // 30 tentativas, delay inicial 1s
    
    const umzug = createUmzug();
    
    // Obtém migrations executadas e pendentes
    const executed = await umzug.executed();
    const pending = await umzug.pending();
    
    return {
      executed: executed.map(m => m.name),
      pending: pending.map(m => m.name),
      totalExecuted: executed.length,
      totalPending: pending.length,
    };
  } catch (err) {
    logger.error('[Migration] ❌ Erro ao obter status das migrations:', {
      message: err.message,
      stack: err.stack,
      name: err.name,
      ...err
    });
    throw err;
  }
}

/**
 * Executa todas as migrations pendentes
 */
async function runMigrations() {
  try {
    logger.info('[Migration] Iniciando migrations Sequelize...');
    
    // Conecta ao banco
    await connect(30, 1000); // 30 tentativas, delay inicial 1s
    
    const umzug = createUmzug();
    
    // Executa migrations pendentes
    const pendingMigrations = await umzug.pending();
    
    if (pendingMigrations.length === 0) {
      logger.info('[Migration] Nenhuma migration pendente');
      return;
    }
    
    logger.info(`[Migration] ${pendingMigrations.length} migration(s) pendente(s)`);
    
    const executed = await umzug.up();
    
    logger.info(`[Migration] ✅ ${executed.length} migration(s) executada(s) com sucesso`);
    
    executed.forEach(migration => {
      logger.info(`[Migration] ✅ Aplicada: ${migration.name}`);
    });
    
  } catch (err) {
    logger.error('[Migration] ❌ Erro ao executar migrations:', {
      message: err.message,
      stack: err.stack,
      name: err.name,
      ...err
    });
    throw err;
  }
}

// Executa se chamado diretamente
if (require.main === module) {
  const args = process.argv.slice(2);
  const showStatus = args.includes('--status') || args.includes('-s');
  
  if (showStatus) {
    getMigrationStatus()
      .then(status => {
        logger.info('\n📊 Status das Migrations:');
        logger.info(`✅ Executadas: ${status.totalExecuted}`);
        logger.info(`⏳ Pendentes: ${status.totalPending}`);
        
        if (status.executed.length > 0) {
          logger.info('\n✅ Migrations Executadas:');
          status.executed.forEach(name => logger.info(`   - ${name}`));
        }
        
        if (status.pending.length > 0) {
          logger.info('\n⏳ Migrations Pendentes:');
          status.pending.forEach(name => logger.info(`   - ${name}`));
        } else {
          logger.info('\n✨ Nenhuma migration pendente!');
        }
        
        return close();
      })
      .then(() => process.exit(0))
      .catch(err => {
        logger.error('[Migration] Falha ao obter status:', {
          message: err.message,
          stack: err.stack,
          name: err.name,
          ...err
        });
        logger.error('Erro detalhado:', err);
        process.exit(1);
      });
  } else {
    runMigrations()
      .then(() => {
        logger.info('[Migration] Processo concluído');
        return close();
      })
      .then(() => process.exit(0))
      .catch(err => {
        logger.error('[Migration] Falha:', {
          message: err.message,
          stack: err.stack,
          name: err.name,
          ...err
        });
        logger.error('Erro detalhado:', err);
        process.exit(1);
      });
  }
}

/**
 * Obtém instância Umzug configurada (para uso em healthchecks)
 * IMPORTANTE: Esta função apenas cria a instância, não executa migrations
 * 
 * @returns {Umzug} Instância Umzug configurada
 */
function getUmzug() {
  const sequelize = getSequelize();
  
  if (!sequelize) {
    throw new Error('Sequelize não inicializado');
  }
  
  return createUmzug();
}

module.exports = { runMigrations, getMigrationStatus, getUmzug };
