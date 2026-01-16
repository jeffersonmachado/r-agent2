/**
 * Script para corrigir tenants sem nome no banco de dados
 * 
 * Verifica todos os tenants no PostgreSQL e corrige aqueles que:
 * - Não têm campo 'name'
 * - Têm campo 'name' vazio ou apenas espaços em branco
 * 
 * O script é idempotente: pode ser executado múltiplas vezes sem problemas.
 * 
 * Uso: node scripts/fix-tenants-without-name.js [--dry-run]
 * 
 * --dry-run: Apenas mostra quais tenants seriam corrigidos, sem fazer alterações
 */

const { connect, getSequelize } = require('../api/db/sequelize');
const { runMigrations } = require('../api/db/migrate');
const { defineRelationships } = require('../api/db/models');

// Logger opcional
let logger = null;
try {
  logger = require('../api/utils/logger');
} catch (err) {
  logger = {
    info: (...args) => console.log('[INFO]', ...args),
    error: (...args) => console.error('[ERROR]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    debug: (...args) => console.debug('[DEBUG]', ...args),
  };
}

// Models (lazy loading)
const modelsModule = require('../api/db/models');

// Helper para obter models
function getModels() {
  return {
    Tenant: typeof modelsModule.Tenant === 'function' ? modelsModule.Tenant() : modelsModule.Tenant,
  };
}

/**
 * Gera um nome padrão baseado no tenant_key
 */
function generateDefaultName(tenantKey) {
  // Remove prefixo "tenant-" se existir
  let name = tenantKey.replace(/^tenant-/, '');
  
  // Capitaliza primeira letra de cada palavra
  name = name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
  
  // Se for "demo", usa "Tenant Demo"
  if (name.toLowerCase() === 'demo') {
    return 'Tenant Demo';
  }
  
  // Se for "system", usa "Sistema"
  if (name.toLowerCase() === 'system') {
    return 'Sistema';
  }
  
  return name || 'Tenant Sem Nome';
}

/**
 * Verifica e corrige tenants sem nome
 */
async function fixTenantsWithoutName(dryRun = false) {
  const sequelize = getSequelize();
  if (!sequelize) {
    throw new Error('PostgreSQL não está disponível. Verifique a conexão. Chame connect() primeiro.');
  }
  
  // Verifica se a conexão está ativa
  try {
    await sequelize.authenticate();
  } catch (err) {
    throw new Error(`Conexão com PostgreSQL não está ativa: ${err.message}`);
  }

  const { Tenant } = getModels();
  
  try {
    // Busca todos os tenants
    const allTenants = await Tenant.findAll({
      order: [['created_at', 'ASC']],
    });

    logger.info(`[FixTenants] Verificando ${allTenants.length} tenant(s)...`);

    const tenantsToFix = [];
    
    for (const tenant of allTenants) {
      const hasName = tenant.name && tenant.name.trim() !== '';
      
      if (!hasName) {
        const defaultName = generateDefaultName(tenant.tenant_key);
        tenantsToFix.push({
          tenant,
          defaultName,
        });
        
        logger.warn(`[FixTenants] Tenant sem nome encontrado:`, {
          tenant_key: tenant.tenant_key,
          id: tenant.id,
          currentName: tenant.name || '(vazio)',
          suggestedName: defaultName,
        });
      }
    }

    if (tenantsToFix.length === 0) {
      logger.info('[FixTenants] ✅ Todos os tenants têm nome válido. Nenhuma correção necessária.');
      return { fixed: 0, total: allTenants.length };
    }

    logger.info(`[FixTenants] Encontrados ${tenantsToFix.length} tenant(s) sem nome.`);

    if (dryRun) {
      logger.info('[FixTenants] 🔍 Modo DRY-RUN: Nenhuma alteração será feita.');
      if (tenantsToFix.length > 0) {
        logger.info('[FixTenants] Tenants que seriam corrigidos:');
        tenantsToFix.forEach(({ tenant, defaultName }) => {
          console.log(`  - ${tenant.tenant_key}: "${tenant.name || '(vazio)'}" → "${defaultName}"`);
        });
      }
      return { fixed: 0, total: allTenants.length, wouldFix: tenantsToFix.length };
    }

    // Corrige os tenants
    let fixedCount = 0;
    for (const { tenant, defaultName } of tenantsToFix) {
      try {
        await tenant.update({
          name: defaultName,
        });
        
        logger.info(`[FixTenants] ✅ Tenant corrigido: ${tenant.tenant_key} → "${defaultName}"`);
        fixedCount++;
      } catch (err) {
        logger.error(`[FixTenants] ❌ Erro ao corrigir tenant ${tenant.tenant_key}:`, err.message);
      }
    }

    logger.info(`[FixTenants] ✅ Correção concluída: ${fixedCount} de ${tenantsToFix.length} tenant(s) corrigido(s).`);
    
    return { fixed: fixedCount, total: allTenants.length, attempted: tenantsToFix.length };
  } catch (err) {
    logger.error('[FixTenants] Erro ao verificar/corrigir tenants:', err);
    throw err;
  }
}

/**
 * Função principal
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  try {
    logger.info('[FixTenants] Iniciando verificação de tenants sem nome...');
    
    // Conecta ao banco
    await connect();
    logger.info('[FixTenants] Conectado ao PostgreSQL.');
    
    // Executa migrações (garante que a tabela existe)
    await runMigrations();
    logger.info('[FixTenants] Migrações verificadas.');
    
    // Define relacionamentos
    defineRelationships();
    logger.info('[FixTenants] Relacionamentos definidos.');
    
    // Corrige tenants sem nome
    const result = await fixTenantsWithoutName(dryRun);
    
    if (dryRun) {
      if (result.wouldFix > 0) {
        logger.info(`[FixTenants] 🔍 DRY-RUN concluído: ${result.wouldFix} tenant(s) seriam corrigidos.`);
        logger.info('[FixTenants] Execute sem --dry-run para aplicar as correções.');
      } else {
        logger.info(`[FixTenants] 🔍 DRY-RUN concluído: Nenhum tenant precisa de correção.`);
      }
    } else {
      logger.info(`[FixTenants] ✅ Processo concluído: ${result.fixed} tenant(s) corrigido(s) de ${result.total} total.`);
    }
    
    process.exit(0);
  } catch (err) {
    logger.error('[FixTenants] ❌ Erro fatal:', err);
    process.exit(1);
  }
}

// Executa se chamado diretamente
if (require.main === module) {
  main();
}

module.exports = { fixTenantsWithoutName, generateDefaultName };
