'use strict';

function createInitializeSystemAdmin({
  logger,
  createTenant,
  getTenant,
}) {
  return async function initializeSystemAdmin() {
    logger.info('[Init] Iniciando initializeSystemAdmin()...');

    try {
      let systemTenant = getTenant('system');

      if (!systemTenant) {
        logger.info('[Init] Tenant "system" não existe. Criando...');
        const tenantResult = await createTenant({
          id: 'system',
          name: 'Sistema',
          site: 'https://sistema.com',
          ramo_atividade: 'Sistema de Administração',
          objetivo: 'Administração global do sistema',
          plan: 'enterprise',
        });

        if (!tenantResult.success) {
          logger.error('[Init] ❌ Erro ao criar tenant system:', tenantResult.error);
        } else {
          systemTenant = tenantResult.tenant;
          logger.info('[Init] ✅ Tenant "system" criado com sucesso');
        }
      } else {
        logger.info('[Init] ✅ Tenant "system" já existe');
      }

      const { getSequelize } = require('../db/sequelize');
      const { User, TenantUser, Tenant } = require('../db/models');
      const crypto = require('crypto');

      function hashPassword(password) {
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto
          .createHash('sha256')
          .update(String(password) + salt)
          .digest('hex');
        return `sha256:${salt}:${hash}`;
      }

      const sequelize = getSequelize();
      if (!sequelize) {
        logger.error('[Init] ❌ Sequelize não está disponível. Não é possível verificar/criar systemadmin.');
        return;
      }

      const UserModel = User();
      const TenantUserModel = TenantUser();
      const TenantModel = Tenant();

      const existingUser = await UserModel.findOne({
        where: { email: 'systemadmin@exemplo.com' },
      });

      let systemAdminExists = false;
      let userId = null;

      if (existingUser) {
        userId = existingUser.id;

        try {
          const stored = existingUser.password_hash;
          const looksLikeLegacySaltedButBroken =
            typeof stored === 'string' && /^[a-f0-9]{64}$/i.test(stored);

          if (looksLikeLegacySaltedButBroken) {
            await existingUser.update({
              password_hash: hashPassword('Admin123!'),
              username: existingUser.username || 'systemadmin',
              role: existingUser.role || 'super_admin',
              is_active: existingUser.is_active !== false,
              status: existingUser.status || 'active',
              is_superadmin: true,
              tenant_key: existingUser.tenant_key || 'system',
            });
            logger.warn('[Init] 🔧 Corrigido password_hash legado do systemadmin para formato compatível');
          }
        } catch (e) {
          logger.warn('[Init] Falha ao tentar corrigir password_hash legado do systemadmin (ignorado)', {
            error: e.message,
          });
        }

        const tenantUser = await TenantUserModel.findOne({
          where: {
            user_id: userId,
            tenant_id:
              systemTenant?.id || (await TenantModel.findOne({ where: { tenant_key: 'system' } }))?.id,
          },
        });

        systemAdminExists = !!tenantUser;
      }

      if (!systemAdminExists) {
        logger.info('[Init] systemadmin não encontrado. Criando no PostgreSQL...');

        if (!systemTenant) {
          const tenantResult = await createTenant({
            id: 'system',
            name: 'Sistema',
            site: 'https://sistema.com',
            ramo_atividade: 'Sistema de Administração',
            objetivo: 'Administração global do sistema',
            plan: 'enterprise',
          });

          if (!tenantResult.success) {
            logger.error('[Init] ❌ Falha ao criar tenant "system" na segunda tentativa:', tenantResult.error);
            return;
          }

          systemTenant = tenantResult.tenant;
        }

        const systemTenantDb = await TenantModel.findOne({
          where: { tenant_key: 'system' },
        });

        if (!systemTenantDb) {
          logger.error('[Init] ❌ Tenant "system" não encontrado no banco de dados');
          return;
        }

        const passwordHash = hashPassword('Admin123!');

        if (!userId) {
          const newUser = await UserModel.create({
            name: 'Administrador do Sistema',
            email: 'systemadmin@exemplo.com',
            password_hash: passwordHash,
            username: 'systemadmin',
            role: 'super_admin',
            is_active: true,
            status: 'active',
            is_superadmin: true,
            tenant_key: 'system',
          });
          userId = newUser.id;
          logger.info('[Init] ✅ Usuário systemadmin criado no PostgreSQL');
        }

        await TenantUserModel.findOrCreate({
          where: {
            user_id: userId,
            tenant_id: systemTenantDb.id,
          },
          defaults: {
            user_id: userId,
            tenant_id: systemTenantDb.id,
            role: 'owner',
          },
        });

        logger.info('[Init] ✅ Super Admin criado/atualizado no PostgreSQL!');
      } else {
        logger.info('[Init] ✅ Super Admin já existe no PostgreSQL');
      }
    } catch (error) {
      logger.error('[Init] ❌ Erro ao verificar/criar systemadmin no PostgreSQL:', error);
      logger.error('[Init] Stack:', error.stack);
    }
  };
}

module.exports = {
  createInitializeSystemAdmin,
};
