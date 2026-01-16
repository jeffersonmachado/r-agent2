/**
 * Seed idempotente do banco de dados
 * 
 * Garante que dados essenciais existem:
 * - Tenant "system" sempre existe
 * - Superadmin (se SUPERADMIN_EMAIL configurado)
 * 
 * Uso: node api/db/seed.js
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

const { connect, getSequelize, close } = require('./sequelize');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

/**
 * Cria ou atualiza tenant "system"
 */
async function ensureSystemTenant() {
  logger.info('[Seed] Verificando tenant "system"...');
  
  const sequelize = getSequelize();
  if (!sequelize) {
    throw new Error('Sequelize não inicializado');
  }
  
  const results = await sequelize.query(
    `SELECT id FROM tenants WHERE tenant_key = :tenantKey`,
    {
      replacements: { tenantKey: 'system' },
      type: sequelize.constructor.QueryTypes.SELECT,
    }
  );
  
  if (Array.isArray(results) && results.length > 0) {
    logger.info('[Seed] Tenant "system" já existe');
    return results[0].id;
  }
  
  logger.info('[Seed] Criando tenant "system"...');
  
  const tenantId = uuidv4();
  await sequelize.query(
    `INSERT INTO tenants (
      id, tenant_key, name, status, plan, limits, settings, branding
    ) VALUES (:id, :tenantKey, :name, :status, :plan, :limits, :settings, :branding)
    ON CONFLICT (tenant_key) DO UPDATE SET
      name = EXCLUDED.name,
      status = EXCLUDED.status,
      updated_at = CURRENT_TIMESTAMP`,
    {
      replacements: {
        id: tenantId,
        tenantKey: 'system',
        name: 'System',
        status: 'active',
        plan: 'enterprise',
        limits: JSON.stringify({}),
        settings: JSON.stringify({}),
        branding: JSON.stringify({}),
      },
      type: sequelize.constructor.QueryTypes.INSERT,
    }
  );
  
  logger.info('[Seed] ✅ Tenant "system" criado/atualizado');
  return tenantId;
}

/**
 * Cria superadmin se SUPERADMIN_EMAIL configurado
 */
async function ensureSuperAdmin() {
  const email = process.env.SUPERADMIN_EMAIL;
  if (!email) {
    logger.info('[Seed] SUPERADMIN_EMAIL não configurado, pulando criação de superadmin');
    return;
  }
  
  logger.info(`[Seed] Verificando superadmin: ${email}...`);
  
  const sequelize = getSequelize();
  if (!sequelize) {
    throw new Error('Sequelize não inicializado');
  }
  
  const results = await sequelize.query(
    `SELECT id FROM users WHERE email = :email`,
    {
      replacements: { email },
      type: sequelize.constructor.QueryTypes.SELECT,
    }
  );
  
  if (Array.isArray(results) && results.length > 0) {
    logger.info('[Seed] Superadmin já existe');
    return results[0].id;
  }
  
  logger.info('[Seed] Criando superadmin...');
  
  // Gera senha aleatória se não fornecida
  const password = process.env.SUPERADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
  
  // Hash da senha (simples - em produção usar bcrypt)
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
  
  const userId = uuidv4();
  await sequelize.query(
    `INSERT INTO users (
      id, email, password_hash, name, role, is_active
    ) VALUES (:id, :email, :passwordHash, :name, :role, :isActive)
    ON CONFLICT (email) DO UPDATE SET
      role = EXCLUDED.role,
      is_active = EXCLUDED.is_active,
      updated_at = CURRENT_TIMESTAMP`,
    {
      replacements: {
        id: userId,
        email,
        passwordHash,
        name: process.env.SUPERADMIN_NAME || 'Super Admin',
        role: 'superadmin',
        isActive: true,
      },
      type: sequelize.constructor.QueryTypes.INSERT,
    }
  );
  
  logger.info('[Seed] ✅ Superadmin criado/atualizado');
  logger.warn(`[Seed] ⚠️  Senha do superadmin: ${password} (salve em local seguro!)`);
  
  return userId;
}

/**
 * Executa todos os seeds
 */
async function runSeed() {
  try {
    logger.info('[Seed] Iniciando seed...');
    
    // Inicializa conexão Sequelize
    await connect(30, 1000);
    
    // Garante tenant system
    await ensureSystemTenant();
    
    // Garante superadmin (opcional)
    await ensureSuperAdmin();
    
    logger.info('[Seed] ✅ Seed concluído com sucesso');
  } catch (err) {
    logger.error('[Seed] ❌ Erro ao executar seed:', err);
    throw err;
  }
}

// Executa se chamado diretamente
if (require.main === module) {
  runSeed()
    .then(() => close())
    .then(() => process.exit(0))
    .catch(err => {
      logger.error('[Seed] Falha:', err);
      process.exit(1);
    });
}

module.exports = { runSeed, ensureSystemTenant, ensureSuperAdmin };
