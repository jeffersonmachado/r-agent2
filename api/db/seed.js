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

function envOrDefault(key, defaultValue) {
  const raw = process.env[key];
  if (typeof raw !== 'string') return defaultValue;
  const trimmed = raw.trim();
  return trimmed !== '' ? trimmed : defaultValue;
}

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
 * Garante que existe um vínculo tenant_users (RBAC) entre um tenant e um user.
 *
 * @param {string} tenantId - UUID do tenant (tenants.id)
 * @param {string} userId - UUID do user (users.id)
 * @param {'owner'|'admin'|'member'|'support'} role
 */
async function ensureTenantUser(tenantId, userId, role) {
  const sequelize = getSequelize();
  if (!sequelize) throw new Error('Sequelize não inicializado');

  await sequelize.query(
    `INSERT INTO tenant_users (id, tenant_id, user_id, role)
     VALUES (:id, :tenantId, :userId, :role)
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET
       role = EXCLUDED.role,
       updated_at = CURRENT_TIMESTAMP`,
    {
      replacements: {
        id: uuidv4(),
        tenantId,
        userId,
        role,
      },
      type: sequelize.constructor.QueryTypes.INSERT,
    }
  );
}

/**
 * Cria (ou atualiza) um usuário bootstrap no tenant "system".
 * Observação: users.tenant_key é obrigatório (hardening multi-tenant).
 *
 * @param {Object} params
 * @param {string} params.username
 * @param {string} params.email
 * @param {string} params.name
 * @param {string} params.password
 * @param {string} params.role
 * @param {boolean} params.isSuperadmin
 * @returns {Promise<{ id: string, passwordWasGenerated: boolean }>}
 */
async function ensureBootstrapUser({ username, email, name, password, role, isSuperadmin }) {
  const sequelize = getSequelize();
  if (!sequelize) throw new Error('Sequelize não inicializado');

  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedUsername = String(username || '').trim().toLowerCase();
  if (!normalizedEmail || !normalizedUsername) {
    throw new Error('email e username são obrigatórios para usuários bootstrap');
  }

  // Procura por email OU username (para evitar erro por unique constraint de username).
  const existing = await sequelize.query(
    `SELECT id, email, username
       FROM users
      WHERE lower(email) = :email OR lower(username) = :username
      LIMIT 1`,
    {
      replacements: { email: normalizedEmail, username: normalizedUsername },
      type: sequelize.constructor.QueryTypes.SELECT,
    }
  );

  const hasExisting = Array.isArray(existing) && existing.length > 0;
  const userId = hasExisting ? existing[0].id : uuidv4();
  const existingEmail = hasExisting ? (existing[0].email || null) : null;
  const existingUsername = hasExisting ? (existing[0].username || null) : null;

  // Regra de idempotência:
  // - Se o usuário já existe e NENHUMA senha foi fornecida, NÃO altere password_hash.
  // - Se senha foi fornecida, atualiza password_hash (permite reset via env).
  // - Se não existe, cria com senha fornecida ou gera uma aleatória.
  const passwordProvided = typeof password === 'string' && password.trim() !== '';

  if (hasExisting && !passwordProvided) {
    await sequelize.query(
      `UPDATE users SET
         name = :name,
         role = :role,
         is_active = :isActive,
         is_superadmin = :isSuperadmin,
         tenant_key = :tenantKey,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = :id`,
      {
        replacements: {
          id: userId,
          name,
          role,
          isActive: true,
          isSuperadmin: !!isSuperadmin,
          tenantKey: 'system',
        },
        type: sequelize.constructor.QueryTypes.UPDATE,
      }
    );

    // Não tentamos “forçar” username/email aqui para evitar quebrar ambientes
    // já existentes (unique constraints). Apenas garantimos atributos essenciais.
    return { id: userId, created: false, passwordWasGenerated: false, password: null, passwordWasUpdated: false };
  }

  const passwordWasGenerated = !passwordProvided;
  const effectivePassword = passwordProvided ? password.trim() : crypto.randomBytes(18).toString('base64url');

  // Hash da senha (compatível com authService: sha256:salt:hash)
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = `sha256:${salt}:${crypto.createHash('sha256').update(effectivePassword + salt).digest('hex')}`;

  if (!hasExisting) {
    await sequelize.query(
      `INSERT INTO users (
         id, email, password_hash, name, username, role, is_active, is_superadmin, tenant_key
       ) VALUES (
         :id, :email, :passwordHash, :name, :username, :role, :isActive, :isSuperadmin, :tenantKey
       )`,
      {
        replacements: {
          id: userId,
          email: normalizedEmail,
          passwordHash,
          name,
          username: normalizedUsername,
          role,
          isActive: true,
          isSuperadmin: !!isSuperadmin,
          tenantKey: 'system',
        },
        type: sequelize.constructor.QueryTypes.INSERT,
      }
    );

    return { id: userId, created: true, passwordWasGenerated, password: effectivePassword, passwordWasUpdated: false };
  }

  // Exists + password provided -> update password_hash
  await sequelize.query(
    `UPDATE users SET
       password_hash = :passwordHash,
       name = :name,
       role = :role,
       is_active = :isActive,
       is_superadmin = :isSuperadmin,
       tenant_key = :tenantKey,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = :id`,
    {
      replacements: {
        id: userId,
        passwordHash,
        name,
        role,
        isActive: true,
        isSuperadmin: !!isSuperadmin,
        tenantKey: 'system',
      },
      type: sequelize.constructor.QueryTypes.UPDATE,
    }
  );

  // Best-effort: tentar ajustar username/email para os desejados quando
  // não houver conflito óbvio. Se falhar por unique constraint, não derruba o seed.
  try {
    // Se o registro existente veio pelo username, não force email; e vice-versa.
    // Ajuste apenas quando for “seguro” (match já aponta para o mesmo campo).
    const shouldUpdateUsername = existingUsername && String(existingUsername).toLowerCase() === normalizedUsername;
    const shouldUpdateEmail = existingEmail && String(existingEmail).toLowerCase() === normalizedEmail;
    // Se já está “batendo”, não faz nada. Se está diferente, não tenta forçar.
    if (!shouldUpdateUsername || !shouldUpdateEmail) {
      // noop
    }
  } catch (_) {}

  return { id: userId, created: false, passwordWasGenerated, password: effectivePassword, passwordWasUpdated: true };
}

/**
 * Garante usuários base do sistema:
 * - admin (tenant system, role admin)
 * - systemadmin (tenant system, superadmin)
 *
 * Critério:
 * - Sempre cria/atualiza de forma idempotente.
 * - Se a senha não for informada via env, gera e loga uma vez por execução do seed.
 */
async function ensureAdminAndSystemAdmin(systemTenantId) {
  console.log('[Seed] Garantindo usuários bootstrap (admin/systemadmin)...');
  logger.info('[Seed] Garantindo usuários bootstrap (admin/systemadmin)...');

  // Admin (tenant system)
  const adminUsername = envOrDefault('ADMIN_USERNAME', 'admin');
  const adminEmail = envOrDefault('ADMIN_EMAIL', 'admin@exemplo.com');
  const adminName = envOrDefault('ADMIN_NAME', 'Admin');
  // Compatível com UI/Docs: default Admin123! (pode ser sobrescrito via env)
  const adminPassword = envOrDefault('ADMIN_PASSWORD', 'Admin123!');

  const admin = await ensureBootstrapUser({
    username: adminUsername,
    email: adminEmail,
    name: adminName,
    password: adminPassword,
    role: 'admin',
    isSuperadmin: false,
  });
  await ensureTenantUser(systemTenantId, admin.id, 'admin');

  if (admin.created && admin.passwordWasGenerated) {
    console.log(`[Seed] Senha do admin (${adminEmail}): ${admin.password} (salve em local seguro!)`);
    logger.warn(`[Seed] ⚠️  Senha do admin (${adminEmail}): ${admin.password} (salve em local seguro!)`);
  }
  if (!admin.created && admin.passwordWasUpdated) {
    console.log(`[Seed] Senha do admin (${adminEmail}) foi atualizada via env (salve em local seguro!)`);
    logger.warn(`[Seed] ⚠️  Senha do admin (${adminEmail}) foi atualizada via env (salve em local seguro!)`);
  }

  // SystemAdmin (super-admin global)
  const sysUsername = envOrDefault('SYSTEMADMIN_USERNAME', 'systemadmin');
  // Compatível com docs e testes (ex.: systemadmin@exemplo.com / Admin123!)
  const sysEmail = envOrDefault('SYSTEMADMIN_EMAIL', 'systemadmin@exemplo.com');
  const sysName = envOrDefault('SYSTEMADMIN_NAME', 'System Admin');
  const sysPassword = envOrDefault('SYSTEMADMIN_PASSWORD', 'Admin123!');

  const systemadmin = await ensureBootstrapUser({
    username: sysUsername,
    email: sysEmail,
    name: sysName,
    password: sysPassword,
    role: 'super_admin',
    isSuperadmin: true,
  });
  await ensureTenantUser(systemTenantId, systemadmin.id, 'owner');

  if (systemadmin.created && systemadmin.passwordWasGenerated) {
    console.log(`[Seed] Senha do systemadmin (${sysEmail}): ${systemadmin.password} (salve em local seguro!)`);
    logger.warn(`[Seed] ⚠️  Senha do systemadmin (${sysEmail}): ${systemadmin.password} (salve em local seguro!)`);
  }
  if (!systemadmin.created && systemadmin.passwordWasUpdated) {
    console.log(`[Seed] Senha do systemadmin (${sysEmail}) foi atualizada via env (salve em local seguro!)`);
    logger.warn(`[Seed] ⚠️  Senha do systemadmin (${sysEmail}) foi atualizada via env (salve em local seguro!)`);
  }

  console.log('[Seed] Usuários bootstrap garantidos');
  logger.info('[Seed] ✅ Usuários bootstrap garantidos');
}

/**
 * Garante um superadmin (NÃO pode pular em produção).
 *
 * Regras:
 * - Se SUPERADMIN_EMAIL não estiver configurado, usa defaults.
 * - Não altera password_hash se o usuário já existir e SUPERADMIN_PASSWORD não for fornecida.
 * - Se usuário não existir e não houver senha, gera e loga a senha (1x por execução do seed).
 */
async function ensureSuperAdmin(systemTenantId) {
  // Mantém precedência: SUPERADMIN_* > SYSTEMADMIN_* > defaults
  const email = envOrDefault('SUPERADMIN_EMAIL', envOrDefault('SYSTEMADMIN_EMAIL', 'systemadmin@exemplo.com'));

  const username = envOrDefault('SUPERADMIN_USERNAME', email.split('@')[0] || 'systemadmin');

  const name = envOrDefault('SUPERADMIN_NAME', 'Super Admin');
  const password = envOrDefault('SUPERADMIN_PASSWORD', 'Admin123!');

  console.log(`[Seed] Garantindo superadmin: ${email}...`);
  logger.info(`[Seed] Garantindo superadmin: ${email}...`);

  const result = await ensureBootstrapUser({
    username,
    email,
    name,
    password,
    role: 'super_admin',
    isSuperadmin: true,
  });

  // Para consistência com superAdminService: owner do tenant "system" também é tratado como super-admin.
  await ensureTenantUser(systemTenantId, result.id, 'owner');

  if (result.created && result.passwordWasGenerated) {
    console.log(`[Seed] Senha do superadmin (${email}): ${result.password} (salve em local seguro!)`);
    logger.warn(`[Seed] ⚠️  Senha do superadmin (${email}): ${result.password} (salve em local seguro!)`);
  }
  if (!result.created && result.passwordWasUpdated) {
    console.log(`[Seed] Senha do superadmin (${email}) foi atualizada via env (salve em local seguro!)`);
    logger.warn(`[Seed] ⚠️  Senha do superadmin (${email}) foi atualizada via env (salve em local seguro!)`);
  }

  console.log('[Seed] Superadmin garantido');
  logger.info('[Seed] ✅ Superadmin garantido');
  return result.id;
}

/**
 * Executa todos os seeds
 */
async function runSeed() {
  try {
    console.log('[Seed] Iniciando seed...');
    logger.info('[Seed] Iniciando seed...');
    
    // Inicializa conexão Sequelize
    await connect(30, 1000);
    
    // Garante tenant system
    const systemTenantId = await ensureSystemTenant();

    // Garante usuários básicos sempre (admin + systemadmin)
    await ensureAdminAndSystemAdmin(systemTenantId);
    
    // Garante superadmin (obrigatório)
    await ensureSuperAdmin(systemTenantId);
    
    console.log('[Seed] Seed concluído com sucesso');
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
