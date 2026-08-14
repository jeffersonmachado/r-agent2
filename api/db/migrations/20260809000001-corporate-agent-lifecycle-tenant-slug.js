'use strict';

const { tableExists } = require('../migrations-helper');

const TABLE = 'corporate_agents';

/**
 * Migration incremental e segura — CorporateAgent (Agent OS):
 *
 * 1. lifecycle passa a aceitar 'validated'
 *    (draft → validation → validated → approved → active), pois validação
 *    (QA Wave) e aprovação (governança) são eventos distintos. O agent-factory
 *    e o agent-hardening-service já gravam 'validated'.
 *
 * 2. slug deixa de ser globalmente UNIQUE e passa a ser único por tenant
 *    (tenant_id, slug) — tenant A e tenant B podem ter, cada um, o seu
 *    `scheduling-agent`. O id UUID permanece global.
 *
 * Idempotente: usa IF EXISTS / guards para rodar sobre bancos criados pela
 * DDL histórica (migrations/agent-os-2026-06-11.sql) sem quebrar.
 */

module.exports = {
  async up(queryInterface) {
    // `corporate_agents` pertence à DDL histórica do Agent OS e pode não estar
    // presente em instalações que usam somente a trilha Umzug. Nesse caso a
    // migration incremental deve ser um no-op, nunca impedir o bootstrap.
    if (!(await tableExists(queryInterface, TABLE))) return;

    const sequelize = queryInterface.sequelize;

    // ── 1. lifecycle CHECK inclui 'validated' ──────────────────────────────
    await sequelize.query(`
      ALTER TABLE corporate_agents
        DROP CONSTRAINT IF EXISTS corporate_agents_lifecycle_check;
    `);
    await sequelize.query(`
      ALTER TABLE corporate_agents
        ADD CONSTRAINT corporate_agents_lifecycle_check
        CHECK (lifecycle IN ('draft','validation','validated','approved','active','deprecated','archived'));
    `);

    // ── 2. slug UNIQUE global → UNIQUE composto (tenant_id, slug) ──────────
    // Constraint criada pela DDL histórica (slug VARCHAR ... UNIQUE).
    await sequelize.query(`
      ALTER TABLE corporate_agents
        DROP CONSTRAINT IF EXISTS corporate_agents_slug_key;
    `);
    // Na DDL histórica atual, `corporate_agents_tenant_slug_uidx` pode existir
    // como CONSTRAINT (com índice backing). Nesse caso DROP INDEX falha
    // ("cannot drop index ... because constraint requires it") — remove a
    // constraint primeiro; o DROP INDEX seguinte cobre o caso de índice puro.
    await sequelize.query(`
      ALTER TABLE corporate_agents
        DROP CONSTRAINT IF EXISTS corporate_agents_tenant_slug_uidx;
    `);
    await sequelize.query(`
      DROP INDEX IF EXISTS corporate_agents_tenant_slug_uidx;
    `);
    await sequelize.query(`
      CREATE UNIQUE INDEX corporate_agents_tenant_slug_uidx
        ON corporate_agents (tenant_id, slug);
    `);
  },

  async down(queryInterface) {
    if (!(await tableExists(queryInterface, TABLE))) return;

    const sequelize = queryInterface.sequelize;

    await sequelize.query(`
      DROP INDEX IF EXISTS corporate_agents_tenant_slug_uidx;
    `);
    // Só restaura o UNIQUE global se não houver colisão de slug entre tenants
    // (permitida após o up). Com colisão, o UNIQUE global não pode ser
    // recriado — o índice composto já foi removido acima e o schema fica sem
    // unicidade de slug até saneamento manual dos dados.
    const [duplicates] = await sequelize.query(`
      SELECT slug FROM corporate_agents GROUP BY slug HAVING COUNT(*) > 1 LIMIT 1;
    `);
    if (!Array.isArray(duplicates) || duplicates.length === 0) {
      await sequelize.query(`
        ALTER TABLE corporate_agents
          ADD CONSTRAINT corporate_agents_slug_key UNIQUE (slug);
      `);
    }

    // Antes de restringir o lifecycle, normaliza registros 'validated' → 'approved'
    // (o estado anterior mais próximo semanticamente).
    await sequelize.query(`
      UPDATE corporate_agents SET lifecycle = 'approved' WHERE lifecycle = 'validated';
    `);
    await sequelize.query(`
      ALTER TABLE corporate_agents
        DROP CONSTRAINT IF EXISTS corporate_agents_lifecycle_check;
    `);
    await sequelize.query(`
      ALTER TABLE corporate_agents
        ADD CONSTRAINT corporate_agents_lifecycle_check
        CHECK (lifecycle IN ('draft','validation','approved','active','deprecated','archived'));
    `);
  },
};
