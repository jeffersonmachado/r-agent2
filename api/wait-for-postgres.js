const logger = require('./utils/logger');
/**
 * Script para aguardar PostgreSQL estar disponível
 * 
 * Uso: node api/wait-for-postgres.js
 * 
 * Usa config.js como fonte principal, com fallback para env vars
 */

const { connect } = require('./db/sequelize');

async function waitForPostgres(maxRetries = 30, retryDelay = 2000) {
  logger.info('[Wait] Aguardando PostgreSQL estar disponível...');
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await connect(1, 1000); // Tenta conectar com 1 retry e 1s de delay
      logger.info('[Wait] PostgreSQL está disponível!');
      process.exit(0);
    } catch (err) {
      const isLastAttempt = attempt === maxRetries;
      
      if (isLastAttempt) {
        logger.error('[Wait] PostgreSQL não está disponível após todas as tentativas');
        process.exit(1);
      }
      
      logger.info(`[Wait] Tentativa ${attempt}/${maxRetries} falhou, tentando novamente em ${retryDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

waitForPostgres();
