'use strict';

/**
 * Migration: LEASE DISTRIBUÍDO + INTEGRIDADE REFERENCIAL das tabelas de missão (auditoria V2).
 *
 * Dois achados reais corrigidos aqui:
 *
 * 1. CONCORRÊNCIA (§30–§32): a autoridade de "quem está vivo" era `process.kill(pid, 0)` sobre o
 *    PID embutido em `locked_by`. PID não é identidade global (dois containers podem ter o mesmo
 *    PID; outra máquina não tem PID local) e, sem fencing, um worker antigo podia gravar por cima
 *    da execução do worker novo. Agora existe lease com identidade de instância, TTL, heartbeat e
 *    `lease_fence` monotônico. `locked_by`/`locked_at` são mantidos (compatibilidade com a
 *    implementação anterior e com as suítes já existentes) e passam a ser apenas registro local.
 *
 * 2. INTEGRIDADE (§33): as tabelas filhas guardavam `mission_id` sem FK nenhuma —
 *    histórico de versão/aprovação/parecer podia apontar para missão inexistente sem qualquer
 *    erro. FK com `ON DELETE RESTRICT` (nunca CASCADE) porque versão, aprovação e parecer são
 *    EVIDÊNCIA DE AUDITORIA: apagar a missão não pode apagar o histórico silenciosamente.
 */

const { addIndexIfNotExists } = require('../migrations-helper');

async function columnExists(queryInterface, tableName, columnName) {
  const description = await queryInterface.describeTable(tableName);
  return Object.prototype.hasOwnProperty.call(description, columnName);
}

async function addColumnIfNotExists(queryInterface, tableName, columnName, definition) {
  if (await columnExists(queryInterface, tableName, columnName)) return false;
  await queryInterface.addColumn(tableName, columnName, definition);
  return true;
}

async function constraintExists(queryInterface, constraintName) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT EXISTS (SELECT FROM pg_constraint WHERE conname = '${constraintName}') AS "exists"`,
    { type: queryInterface.sequelize.constructor.QueryTypes.SELECT },
  );
  return rows?.exists === true || rows?.exists === 't';
}

/** Fail-closed: FK em histórico só é criada se não existir órfão (nunca "consertar" apagando). */
async function assertNoOrphans(queryInterface, tableName) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT COUNT(*)::int AS n FROM ${tableName} c
       LEFT JOIN engineering_missions m ON m.id = c.mission_id
      WHERE c.mission_id IS NOT NULL AND m.id IS NULL`,
    { type: queryInterface.sequelize.constructor.QueryTypes.SELECT },
  );
  const orphans = rows?.n || 0;
  if (orphans > 0) {
    const err = new Error(
      `${tableName} possui ${orphans} registro(s) com mission_id órfão — reconcilie antes de aplicar a FK (a migration NÃO apaga histórico de auditoria automaticamente)`,
    );
    err.code = 'ENGINEERING_MISSION_FK_ORPHANS';
    throw err;
  }
}

async function addMissionForeignKey(queryInterface, tableName, constraintName) {
  if (await constraintExists(queryInterface, constraintName)) return false;
  await assertNoOrphans(queryInterface, tableName);
  await queryInterface.addConstraint(tableName, {
    fields: ['mission_id'],
    type: 'foreign key',
    name: constraintName,
    references: { table: 'engineering_missions', field: 'id' },
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  });
  return true;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    // ── 1. Lease distribuído ───────────────────────────────────────────────────────────────────
    await addColumnIfNotExists(queryInterface, 'engineering_missions', 'lease_worker_instance_id', { type: Sequelize.STRING, allowNull: true });
    await addColumnIfNotExists(queryInterface, 'engineering_missions', 'lease_worker_type', { type: Sequelize.STRING, allowNull: true });
    await addColumnIfNotExists(queryInterface, 'engineering_missions', 'lease_host', { type: Sequelize.STRING, allowNull: true });
    await addColumnIfNotExists(queryInterface, 'engineering_missions', 'lease_token', { type: Sequelize.STRING, allowNull: true });
    await addColumnIfNotExists(queryInterface, 'engineering_missions', 'lease_fence', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    await addColumnIfNotExists(queryInterface, 'engineering_missions', 'lease_acquired_at', { type: Sequelize.DATE, allowNull: true });
    await addColumnIfNotExists(queryInterface, 'engineering_missions', 'lease_expires_at', { type: Sequelize.DATE, allowNull: true });
    await addColumnIfNotExists(queryInterface, 'engineering_missions', 'lease_heartbeat_at', { type: Sequelize.DATE, allowNull: true });
    // Takeover procura por lease vencido; heartbeat expõe worker "meio morto" em relatório.
    await addIndexIfNotExists(queryInterface, 'engineering_missions', ['lease_expires_at'], { name: 'engineering_missions_lease_expires_idx' });
    await addIndexIfNotExists(queryInterface, 'engineering_missions', ['lease_worker_instance_id'], { name: 'engineering_missions_lease_worker_idx' });

    // ── 2. Integridade referencial do histórico de auditoria ───────────────────────────────────
    await addMissionForeignKey(queryInterface, 'engineering_mission_versions', 'engineering_mission_versions_mission_fk');
    await addMissionForeignKey(queryInterface, 'engineering_mission_approvals', 'engineering_mission_approvals_mission_fk');
    await addMissionForeignKey(queryInterface, 'engineering_mission_reviews', 'engineering_mission_reviews_mission_fk');
  },

  async down(queryInterface) {
    for (const [table, name] of [
      ['engineering_mission_versions', 'engineering_mission_versions_mission_fk'],
      ['engineering_mission_approvals', 'engineering_mission_approvals_mission_fk'],
      ['engineering_mission_reviews', 'engineering_mission_reviews_mission_fk'],
    ]) {
      await queryInterface.removeConstraint(table, name).catch(() => {});
    }
    for (const column of ['lease_worker_instance_id', 'lease_worker_type', 'lease_host', 'lease_token', 'lease_fence', 'lease_acquired_at', 'lease_expires_at', 'lease_heartbeat_at']) {
      await queryInterface.removeColumn('engineering_missions', column).catch(() => {});
    }
  },
};
