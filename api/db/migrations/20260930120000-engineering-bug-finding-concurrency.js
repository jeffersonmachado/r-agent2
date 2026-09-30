'use strict';

/**
 * Concorrência do Bug Finding: CAS de estado, LEASE de worker e deduplicação ATÔMICA.
 *
 * GAPS CONFIRMADOS por inspeção do código real (2026-09-30):
 *   1. `bugFindingService.transitionFinding` fazia `getFinding` → `assertTransition` →
 *      `update where {id}` SEM versão. Duas transições concorrentes (A: CONFIRMED→FIXING,
 *      B: CONFIRMED→BLOCKED com a MESMA leitura) escreviam as duas — a última vencia sem detecção.
 *   2. `registerFinding` deduplicava por `SELECT` seguido de `INSERT`: duas entregas do mesmo
 *      evento criavam DOIS findings (TOCTOU clássico).
 *   3. O worker do laço de bugs não tinha POSSE durável (nenhum lease/fence no finding), então
 *      dois processos podiam corrigir o mesmo finding simultaneamente.
 *
 * Esta migração adiciona os primitivos que o resto da plataforma já usa (mission/task):
 * `version` (CAS otimista), lease com fence monotônico, e um índice ÚNICO PARCIAL que dá a
 * atomicidade da deduplicação ao banco — não ao código.
 *
 * O escopo da unicidade é o MESMO da semântica de deduplicação existente: mesmo `fingerprint` no
 * mesmo escopo de missão, enquanto o finding NÃO é terminal (CLOSED/DUPLICATE). Findings de missões
 * diferentes continuam sendo registros distintos, e a reincidência continua reabrindo o MESMO
 * registro (nunca cria um segundo).
 *
 * Dados legados: se já existirem duplicatas não terminais, as excedentes são consolidadas como
 * DUPLICATE apontando para a canônica (a mais antiga) — o histórico é PRESERVADO, nada é apagado.
 */

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const DEDUPE_INDEX = 'engineering_bug_findings_dedupe_uidx';

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const table = 'engineering_bug_findings';
    const describe = await queryInterface.describeTable(table);

    const columns = [
      // CAS otimista de transição de estado.
      ['version', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }],
      // Linhagem / proteção contra explosão recursiva.
      ['parent_finding_id', { type: DataTypes.UUID, allowNull: true }],
      ['origin', { type: DataTypes.STRING(40), allowNull: true }],
      ['depth', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }],
      // POSSE DURÁVEL do worker do laço (mesmos primitivos de mission/task).
      ['lease_token', { type: DataTypes.UUID, allowNull: true }],
      ['lease_fence', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }],
      ['lease_worker_instance_id', { type: DataTypes.STRING(160), allowNull: true }],
      ['lease_acquired_at', { type: DataTypes.DATE, allowNull: true }],
      ['lease_expires_at', { type: DataTypes.DATE, allowNull: true }],
      ['lease_heartbeat_at', { type: DataTypes.DATE, allowNull: true }],
      ['last_progress_at', { type: DataTypes.DATE, allowNull: true }],
    ];

    for (const [name, spec] of columns) {
      if (Object.prototype.hasOwnProperty.call(describe, name)) continue;
      await queryInterface.addColumn(table, name, spec);
    }

    const indexes = await queryInterface.showIndex(table).catch(() => []);
    const hasIndex = (name) => indexes.some((idx) => idx.name === name);
    if (!hasIndex('engineering_bug_findings_lease_expires_idx')) {
      await queryInterface.addIndex(table, ['lease_expires_at'], { name: 'engineering_bug_findings_lease_expires_idx' });
    }
    if (!hasIndex('engineering_bug_findings_lease_worker_idx')) {
      await queryInterface.addIndex(table, ['lease_worker_instance_id'], { name: 'engineering_bug_findings_lease_worker_idx' });
    }
    if (!hasIndex('engineering_bug_findings_parent_idx')) {
      await queryInterface.addIndex(table, ['parent_finding_id'], { name: 'engineering_bug_findings_parent_idx' });
    }

    // ── Consolidação de duplicatas legadas (preserva histórico) ────────────────────────────────
    const [duplicates] = await queryInterface.sequelize.query(`
      SELECT mission_id, fingerprint, array_agg(id ORDER BY first_seen_at ASC, created_at ASC) AS ids
        FROM ${table}
       WHERE status NOT IN ('CLOSED', 'DUPLICATE')
       GROUP BY mission_id, fingerprint
      HAVING count(*) > 1
    `);

    for (const row of duplicates || []) {
      const [canonical, ...extras] = row.ids;
      for (const extraId of extras) {
        await queryInterface.sequelize.query(
          `UPDATE ${table}
              SET status = 'DUPLICATE',
                  duplicate_of = :canonical,
                  version = version + 1,
                  updated_at = NOW()
            WHERE id = :extraId`,
          { replacements: { canonical, extraId } },
        );
        await queryInterface.sequelize.query(
          `UPDATE ${table}
              SET related_findings = (
                    SELECT to_jsonb(array(SELECT DISTINCT value::uuid
                                            FROM jsonb_array_elements_text(related_findings || :extraJson) AS value))
                  ),
                  updated_at = NOW()
            WHERE id = :canonical`,
          { replacements: { canonical, extraJson: JSON.stringify([extraId]) } },
        ).catch(() => {
          // Formato JSONB divergente: a consolidação de status já preservou a rastreabilidade.
        });
      }
    }

    // ── Atomicidade da DEDUPLICAÇÃO: unicidade no BANCO, não no código ────────────────────────
    if (!hasIndex(DEDUPE_INDEX)) {
      await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX ${DEDUPE_INDEX}
            ON ${table} (COALESCE(mission_id, '${ZERO_UUID}'::uuid), fingerprint)
         WHERE status NOT IN ('CLOSED', 'DUPLICATE')
      `);
    }
  },

  async down(queryInterface) {
    const table = 'engineering_bug_findings';
    await queryInterface.sequelize.query(`DROP INDEX IF EXISTS ${DEDUPE_INDEX}`).catch(() => {});

    const indexes = await queryInterface.showIndex(table).catch(() => []);
    const hasIndex = (name) => indexes.some((idx) => idx.name === name);
    for (const name of ['engineering_bug_findings_lease_expires_idx', 'engineering_bug_findings_lease_worker_idx', 'engineering_bug_findings_parent_idx']) {
      if (hasIndex(name)) await queryInterface.removeIndex(table, name);
    }

    const describe = await queryInterface.describeTable(table);
    for (const name of ['version', 'parent_finding_id', 'origin', 'depth', 'lease_token', 'lease_fence', 'lease_worker_instance_id', 'lease_acquired_at', 'lease_expires_at', 'lease_heartbeat_at', 'last_progress_at']) {
      if (Object.prototype.hasOwnProperty.call(describe, name)) {
        await queryInterface.removeColumn(table, name);
      }
    }
  },
};
