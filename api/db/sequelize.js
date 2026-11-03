/**
 * Inicialização do Sequelize
 * 
 * Cria e configura a instância do Sequelize para uso em migrations e models.
 */

const { Sequelize } = require('sequelize');
const logger = require('../utils/logger');
const config = require('../utils/config');

let sequelize = null;

function shouldEnableSequelizeLogging() {
  const raw = process.env.SEQUELIZE_LOGGING;
  if (raw !== undefined) {
    const v = String(raw).trim().toLowerCase();
    if (['0', 'false', 'off', 'no'].includes(v)) return false;
    if (['1', 'true', 'on', 'yes'].includes(v)) return true;
  }

  // Padrão: log de SQL desabilitado. Use SEQUELIZE_LOGGING=true para ativar.
  return false;
}

/**
 * Obtém configuração do banco de dados
 * Usa config.js como fonte principal, com fallback para env vars
 */
function getDatabaseConfig() {
  const dbUrl = config.getDatabaseUrl();
  const poolConfig = config.getDatabasePool();
  const sslConfig = config.getDatabaseSsl();
  
  return {
    url: dbUrl,
    pool: poolConfig,
    ssl: sslConfig,
  };
}

/**
 * Cria e configura a instância do Sequelize
 */
function createSequelize() {
  const dbConfig = getDatabaseConfig();
  
  // Configuração padrão para todos os models
  // IMPORTANTE: Migrations usam snake_case (created_at, updated_at)
  // então models devem usar underscored: true para mapear corretamente
  const defaultModelOptions = {
    underscored: true, // Mapeia createdAt -> created_at, updatedAt -> updated_at
    timestamps: true,
  };

  // Configuração do pool
  const poolConfig = {
    max: dbConfig.pool.max,
    min: dbConfig.pool.min,
    acquire: parseInt(process.env.DB_POOL_ACQUIRE || '30000', 10),
    idle: parseInt(process.env.DB_POOL_IDLE || '10000', 10),
  };

  // Configuração de dialect options
  const dialectOptions = {
    connectTimeout: 10000,
    // IDENTIDADE DA CONEXÃO (Fase 10 — orçamento de conexões).
    //
    // DEFEITO MEDIDO (2026-10-11): as conexões chegavam ao Postgres com
    // `application_name` VAZIO, então era impossível atribuir consumo a um workload —
    // `pg_stat_activity` mostrava tudo como anônimo (usuário `postgres`) e qualquer
    // orçamento por classe viraria ficção: não havia como dizer quem consumiu o quê.
    // Com o nome declarado aqui, o gate `check-postgres-budget.js` consegue medir por
    // classe e cobrar o orçamento. Sobrescrevível por env para instrumentar runners.
    application_name: process.env.PGAPPNAME || 'rap-api',
  };

  // Adiciona SSL se configurado
  if (dbConfig.ssl) {
    if (typeof dbConfig.ssl === 'object') {
      dialectOptions.ssl = dbConfig.ssl;
    } else {
      dialectOptions.ssl = { require: true };
    }
  }

  const sequelizeInstance = new Sequelize(dbConfig.url, {
    dialect: 'postgres',
    logging: shouldEnableSequelizeLogging()
      ? (msg) => logger.debug(`[Sequelize] ${msg}`)
      : false,
    define: defaultModelOptions, // Padrão global para todos os models
    pool: poolConfig,
    dialectOptions: dialectOptions,
  });
  
  return sequelizeInstance;
}

/**
 * Conecta ao banco de dados com retry logic
 * 
 * @param {number} maxRetries - Número máximo de tentativas (padrão: 30)
 * @param {number} retryDelay - Delay inicial entre tentativas em ms (padrão: 1000)
 * @returns {Promise<Sequelize>} Instância do Sequelize conectada
 */
/**
 * Orçamento de conexão CONFIGURÁVEL (Fase 2 / missão D).
 *
 * MEDIDO 2026-10-24 (`--scenario db-unavailable`): com PostgreSQL inalcançável o bootstrap ficava
 * 480 s (orçamento do passo do harness) e o resultado era `exit=null`/TIMEOUT em vez de falha
 * rápida com assinatura do motivo — o cenário negativo não conseguia PROVAR o fail-closed.
 * O padrão de produção continua 30 tentativas; quem precisa de falha rápida (harness, testes de
 * indisponibilidade) declara o orçamento por env. Nada é afrouxado: menos tentativas ⇒ falha mais
 * cedo, nunca sucesso.
 */
const TENTATIVAS_PADRAO = 30;
const DELAY_PADRAO_MS = 1000;

function tentativasDeConexao(padrao = TENTATIVAS_PADRAO) {
  const bruto = Number(process.env.DB_CONNECT_ATTEMPTS);
  return Number.isInteger(bruto) && bruto > 0 ? bruto : padrao;
}

async function connect(maxRetries = tentativasDeConexao(), retryDelay = DELAY_PADRAO_MS) {
  if (sequelize) {
    try {
      await sequelize.authenticate();
      return sequelize;
    } catch (err) {
      logger.warn('[Sequelize] Conexão existente inválida, recriando...', { error: err.message });
      sequelize = null;
    }
  }
  
  sequelize = createSequelize();
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await sequelize.authenticate();
      logger.info('[Sequelize] Conectado ao PostgreSQL com sucesso');
      return sequelize;
    } catch (err) {
      const isLastAttempt = attempt === maxRetries;
      
      if (isLastAttempt) {
        logger.error('[Sequelize] Falha ao conectar ao PostgreSQL após todas as tentativas', {
          attempts: maxRetries,
          error: err.message,
        });
        throw new Error(`Não foi possível conectar ao PostgreSQL após ${maxRetries} tentativas: ${err.message}`);
      }
      
      logger.warn(`[Sequelize] Tentativa ${attempt}/${maxRetries} falhou, tentando novamente em ${retryDelay}ms...`, {
        error: err.message,
      });
      
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      // Aumenta o delay exponencialmente (com limite)
      retryDelay = Math.min(retryDelay * 1.5, 10000);
    }
  }
  
  throw new Error('Não foi possível conectar ao PostgreSQL');
}

/**
 * Obtém a instância do Sequelize (sem conectar)
 */
function getSequelize() {
  return sequelize;
}

/**
 * Fecha a conexão
 */
async function close() {
  if (sequelize) {
    await sequelize.close();
    sequelize = null;
    logger.info('[Sequelize] Conexão fechada');
  }
}

module.exports = {
  connect,
  getSequelize,
  close,
  Sequelize,
};
