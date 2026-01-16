/**
 * Script de migração de dados JSON para PostgreSQL
 * 
 * Migra:
 * - Tenants de api/data/tenants.json
 * - Configurações de IA de api/data/config.json (se existirem)
 * 
 * O script é idempotente: pode ser executado múltiplas vezes sem duplicar dados.
 * 
 * Uso: node scripts/migrate_to_pg.js
 */

const fs = require('fs');
const path = require('path');
const { connect, getSequelize } = require('../api/db/sequelize');
const { runMigrations } = require('../api/db/migrate');
const { defineRelationships } = require('../api/db/models');
const { encrypt } = require('../api/utils/crypto');

// Logger opcional (pode não estar disponível durante migração)
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
    User: typeof modelsModule.User === 'function' ? modelsModule.User() : modelsModule.User,
    TenantUser: typeof modelsModule.TenantUser === 'function' ? modelsModule.TenantUser() : modelsModule.TenantUser,
    TenantSetting: typeof modelsModule.TenantSetting === 'function' ? modelsModule.TenantSetting() : modelsModule.TenantSetting,
    TenantAISetting: typeof modelsModule.TenantAISetting === 'function' ? modelsModule.TenantAISetting() : modelsModule.TenantAISetting,
    TenantAICredential: typeof modelsModule.TenantAICredential === 'function' ? modelsModule.TenantAICredential() : modelsModule.TenantAICredential,
  };
}

async function migrateTenants() {
  const sequelize = getSequelize();
  const tenantsFile = path.join(__dirname, '..', 'api', 'data', 'tenants.json');
  
  if (!fs.existsSync(tenantsFile)) {
    console.log('[Migrate] Arquivo tenants.json não encontrado, pulando migração de tenants.');
    return;
  }

  const tenantsData = JSON.parse(fs.readFileSync(tenantsFile, 'utf8'));
  
  if (!Array.isArray(tenantsData)) {
    console.log('[Migrate] tenants.json não contém um array, pulando migração.');
    return;
  }

  console.log(`[Migrate] Migrando ${tenantsData.length} tenant(s)...`);

  for (const tenantData of tenantsData) {
    try {
      // Verifica se já existe
      const existing = await Tenant.findOne({
        where: { tenant_key: tenantData.id || tenantData.tenant_key },
      });

      if (existing) {
        console.log(`[Migrate] Tenant ${tenantData.id || tenantData.tenant_key} já existe, atualizando...`);
        
        await existing.update({
          name: tenantData.name || existing.name,
          site: tenantData.site || existing.site,
          ramo_atividade: tenantData.ramo_atividade || existing.ramo_atividade,
          objetivo: tenantData.objetivo || existing.objetivo,
          status: tenantData.status || existing.status,
          plan: tenantData.plan || existing.plan,
          limits: tenantData.limits || existing.limits,
          settings: tenantData.settings || existing.settings,
          branding: tenantData.branding || existing.branding,
          suspendedAt: tenantData.suspendedAt || existing.suspendedAt,
          trialExpiresAt: tenantData.trialExpiresAt || existing.trialExpiresAt,
        });
      } else {
        console.log(`[Migrate] Criando tenant ${tenantData.id || tenantData.tenant_key}...`);
        
        await Tenant.create({
          tenant_key: tenantData.id || tenantData.tenant_key,
          name: tenantData.name,
          site: tenantData.site,
          ramo_atividade: tenantData.ramo_atividade,
          objetivo: tenantData.objetivo,
          status: tenantData.status || 'trial',
          plan: tenantData.plan || 'trial',
          limits: tenantData.limits || {},
          settings: tenantData.settings || {},
          branding: tenantData.branding || {},
          suspendedAt: tenantData.suspendedAt || null,
          trialExpiresAt: tenantData.trialExpiresAt || null,
        });
      }
    } catch (err) {
      console.error(`[Migrate] Erro ao migrar tenant ${tenantData.id || tenantData.tenant_key}:`, err.message);
    }
  }

  console.log('[Migrate] Migração de tenants concluída.');
}

async function migrateAIConfig() {
  const configFile = path.join(__dirname, '..', 'api', 'data', 'config.json');
  
  if (!fs.existsSync(configFile)) {
    console.log('[Migrate] Arquivo config.json não encontrado, pulando migração de IA.');
    return;
  }

  const configData = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  
  // Verifica se há configuração de IA global
  if (!configData.ai) {
    console.log('[Migrate] Nenhuma configuração de IA encontrada em config.json.');
    return;
  }

  console.log('[Migrate] Migrando configurações de IA...');

  const { Tenant, TenantAISetting, TenantAICredential } = getModels();

  // Busca tenant "system"
  let systemTenant = await Tenant.findOne({
    where: { tenant_key: 'system' },
  });

  if (!systemTenant) {
    console.log('[Migrate] Tenant "system" não encontrado. Criando...');
    const created = await Tenant.create({
      tenant_key: 'system',
      name: 'Sistema',
      site: 'https://sistema.com',
      ramo_atividade: 'Sistema de Administração',
      objetivo: 'Administração global do sistema',
      status: 'active',
      plan: 'enterprise',
      limits: {
        usuarios: -1,
        agentes_ia: -1,
        execucoes_rpa: -1,
        tokens_ia: -1,
        documentos_rag: -1,
        storage_mb: -1,
      },
    });
    systemTenant = created;
  }

  // Migra configurações de IA por tenant (se existirem)
  if (configData.ai.tenants && typeof configData.ai.tenants === 'object') {
    for (const [tenantKey, aiConfig] of Object.entries(configData.ai.tenants)) {
      try {
        const tenant = await Tenant.findOne({ where: { tenant_key: tenantKey } });
        
        if (!tenant) {
          console.log(`[Migrate] Tenant ${tenantKey} não encontrado, pulando configuração de IA.`);
          continue;
        }

        // Migra settings (sem apiKey)
        const { TenantAISetting } = getModels();
        const aiSetting = await TenantAISetting.findOne({
          where: { tenant_id: tenant.id },
        });

        const settingData = {
          enabled: aiConfig.enabled !== false,
          provider: aiConfig.provider || aiConfig.primary || 'openai',
          model: aiConfig.model || null,
          temperature: aiConfig.temperature || null,
          max_tokens: aiConfig.max_tokens || null,
          quota_monthly: aiConfig.quota_monthly || null,
        };

        if (aiSetting) {
          await aiSetting.update(settingData);
        } else {
          await TenantAISetting.create({
            tenant_id: tenant.id,
            ...settingData,
          });
        }

        // Migra credenciais (com criptografia)
        if (aiConfig.apiKey || aiConfig.openai?.apiKey || aiConfig.anthropic?.apiKey) {
          const providers = [];
          
          if (aiConfig.openai?.apiKey) {
            providers.push({ name: 'openai', key: aiConfig.openai.apiKey });
          }
          if (aiConfig.anthropic?.apiKey) {
            providers.push({ name: 'anthropic', key: aiConfig.anthropic.apiKey });
          }
          if (aiConfig.apiKey && !aiConfig.openai && !aiConfig.anthropic) {
            // Assume OpenAI se não especificado
            providers.push({ name: 'openai', key: aiConfig.apiKey });
          }

          for (const { name, key } of providers) {
            try {
              const encrypted = encrypt(key);
              
              const { TenantAICredential } = getModels();
              const credential = await TenantAICredential.findOne({
                where: {
                  tenant_id: tenant.id,
                  provider: name,
                },
              });

              if (credential) {
                await credential.update({
                  api_key_encrypted: encrypted,
                });
              } else {
                await TenantAICredential.create({
                  tenant_id: tenant.id,
                  provider: name,
                  api_key_encrypted: encrypted,
                });
              }
              
              console.log(`[Migrate] Credencial ${name} migrada para tenant ${tenantKey}.`);
            } catch (err) {
              console.error(`[Migrate] Erro ao migrar credencial ${name} para tenant ${tenantKey}:`, err.message);
            }
          }
        }
      } catch (err) {
        console.error(`[Migrate] Erro ao migrar IA para tenant ${tenantKey}:`, err.message);
      }
    }
  }

  // NOTA: Configuração global de IA (ai.openai.apiKey) NÃO é migrada para tenant "system"
  // Ela deve permanecer como variável de ambiente (OPENAI_API_KEY) para uso do servidor
  console.log('[Migrate] Migração de configurações de IA concluída.');
  console.log('[Migrate] NOTA: API keys globais devem ser configuradas via OPENAI_API_KEY (env).');
}

async function main() {
  try {
    console.log('[Migrate] Iniciando migração para PostgreSQL...');
    
    // Conecta ao banco
    console.log('[Migrate] Conectando ao banco de dados...');
    await connect();
    
    // Define relacionamentos
    defineRelationships();
    
    // Executa migrations
    console.log('[Migrate] Executando migrations...');
    await runMigrations();
    
    // Migra dados
    await migrateTenants();
    await migrateAIConfig();
    
    console.log('[Migrate] Migração concluída com sucesso!');
  } catch (err) {
    console.error('[Migrate] Erro durante migração:', err);
    process.exit(1);
  } finally {
    const sequelize = getSequelize();
    if (sequelize) {
      await sequelize.close();
    }
  }
}

// Executa se chamado diretamente
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { main };
