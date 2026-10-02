'use strict';

/**
 * MISSION SOURCE AUTHORITY — fonte de código isolada por Engineering Mission.
 *
 * DEFEITO CONFIRMADO NO CÓDIGO (2026-10-02): `api/services/engineeringRouter/patchApplyService.js`
 * materializava o worktree de TODA tentativa a partir de `git rev-parse HEAD` do ROOT (a `main`).
 * O fix do Bug Loop nasce numa branch candidate própria; a task seguinte da missão voltava a
 * nascer da `main`. Logo, o patch corrigido nunca entrava no caminho de execução da missão e o
 * bug "reaparecia" na replacement task — não porque voltou, mas porque o fix nunca esteve na
 * source usada.
 *
 * Esta migração adiciona os dados que faltavam para existir uma fonte POR MISSÃO:
 *
 *   engineering_missions
 *     mission_source_ref          ref de origem da missão (ex.: `main`) — a ORIGEM, nunca a fonte
 *     mission_base_commit         commit da origem no momento em que a missão começou (M0)
 *     mission_integration_branch  `engineering/missions/<missionId>` — a fonte de execução
 *     mission_current_commit      commit corrente da fonte; AVANÇA por CAS a cada integração
 *     mission_source_state        PENDING | READY | CONFLICT | STALE
 *     mission_source_fence        fence monotônico do avanço da fonte (CAS + posse)
 *     mission_workspace_id        identidade do workspace lógico da missão (auditoria)
 *
 *   engineering_tasks
 *     source_commit               commit da fonte da missão de onde a task nasceu (HERANÇA)
 *     source_ref                  ref da fonte (auditoria legível)
 *
 *   engineering_mission_integrations (NOVA) — trilha de auditoria APPEND-ONLY de cada integração:
 *     missionId, taskId, findingId, candidateCommit, missionCommitBefore, missionCommitAfter,
 *     integrationType, integrationResult, tests, review, regression, integrationKey (idempotência).
 *
 * `integration_key` é ÚNICO: é o que torna a integração crash-safe. O processo pode morrer entre
 * criar o commit na fonte e persistir o novo commit corrente; na retomada a mesma tríade
 * `(missionId, taskId, candidateCommit)` é reconhecida e o patch NÃO é aplicado duas vezes.
 *
 * Idempotente: cada coluna é adicionada só se ausente (a tabela de missions já existe e recebeu
 * migrações incrementais ao longo do ciclo de vida do Engineer Router).
 */

const INTEGRATION_TABLE = 'engineering_mission_integrations';
const INTEGRATION_KEY_INDEX = 'engineering_mission_integrations_key_uidx';

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    // ---- 1. engineering_missions: a fonte da missão --------------------------------
    const missionTable = 'engineering_missions';
    const missionDescribe = await queryInterface.describeTable(missionTable);

    const missionColumns = [
      ['mission_source_ref', { type: DataTypes.STRING(255), allowNull: true }],
      ['mission_base_commit', { type: DataTypes.STRING(64), allowNull: true }],
      ['mission_integration_branch', { type: DataTypes.STRING(255), allowNull: true }],
      ['mission_current_commit', { type: DataTypes.STRING(64), allowNull: true }],
      ['mission_source_state', { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'PENDING' }],
      ['mission_source_fence', { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }],
      ['mission_workspace_id', { type: DataTypes.STRING(120), allowNull: true }],
    ];

    for (const [name, spec] of missionColumns) {
      if (Object.prototype.hasOwnProperty.call(missionDescribe, name)) continue;
      await queryInterface.addColumn(missionTable, name, spec);
    }

    // ---- 2. engineering_tasks: herança da fonte -----------------------------------
    const taskTable = 'engineering_tasks';
    const taskDescribe = await queryInterface.describeTable(taskTable);

    const taskColumns = [
      ['source_commit', { type: DataTypes.STRING(64), allowNull: true }],
      ['source_ref', { type: DataTypes.STRING(255), allowNull: true }],
      ['source_mission_fence', { type: DataTypes.INTEGER, allowNull: true }],
    ];

    for (const [name, spec] of taskColumns) {
      if (Object.prototype.hasOwnProperty.call(taskDescribe, name)) continue;
      await queryInterface.addColumn(taskTable, name, spec);
    }

    // ---- 3. trilha de auditoria de integrações ------------------------------------
    const tables = await queryInterface.showAllTables();
    const hasIntegrationTable = tables.map((t) => String(t)).includes(INTEGRATION_TABLE);

    if (!hasIntegrationTable) {
      await queryInterface.createTable(INTEGRATION_TABLE, {
        id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
        mission_id: { type: DataTypes.UUID, allowNull: false },
        task_id: { type: DataTypes.UUID, allowNull: true },
        finding_id: { type: DataTypes.UUID, allowNull: true },

        integration_type: { type: DataTypes.STRING(32), allowNull: false },
        integration_result: { type: DataTypes.STRING(32), allowNull: false },

        candidate_commit: { type: DataTypes.STRING(64), allowNull: false },
        candidate_base_commit: { type: DataTypes.STRING(64), allowNull: true },
        mission_commit_before: { type: DataTypes.STRING(64), allowNull: true },
        mission_commit_after: { type: DataTypes.STRING(64), allowNull: true },

        integration_branch: { type: DataTypes.STRING(255), allowNull: true },
        // Chave de idempotência derivada de (missionId, taskId, candidateCommit).
        integration_key: { type: DataTypes.STRING(255), allowNull: false },
        // Fence da fonte no momento da integração — prova de que o avanço foi sob posse vigente.
        source_fence: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

        // Evidências objetivas que autorizaram a integração (nunca "o coder terminou").
        tests: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
        review: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
        regression: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
        evidence: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
        // Conflito: arquivos envolvidos, para virar EngineeringTask explícita.
        conflict: { type: DataTypes.JSONB, allowNull: true },
        error: { type: DataTypes.JSONB, allowNull: true },

        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      });

      // A UNICIDADE é o mecanismo de idempotência (não uma checagem em código sujeita a TOCTOU):
      // duas tentativas de integrar a MESMA tríade colidem no banco, e a segunda é reconhecida
      // como ALREADY_INTEGRATED em vez de produzir um segundo commit.
      await queryInterface.addIndex(INTEGRATION_TABLE, ['integration_key'], {
        name: INTEGRATION_KEY_INDEX,
        unique: true,
      });
      await queryInterface.addIndex(INTEGRATION_TABLE, ['mission_id', 'created_at'], {
        name: 'engineering_mission_integrations_mission_idx',
      });
    }

    // ---- 4. índices de consulta ---------------------------------------------------
    const missionIndexes = await queryInterface.showIndex(missionTable).catch(() => []);
    const hasMissionIndex = (name) => missionIndexes.some((idx) => idx.name === name);

    if (!hasMissionIndex('engineering_missions_current_commit_idx')) {
      await queryInterface.addIndex(missionTable, ['mission_current_commit'], {
        name: 'engineering_missions_current_commit_idx',
      });
    }

    const taskIndexes = await queryInterface.showIndex(taskTable).catch(() => []);
    const hasTaskIndex = (name) => taskIndexes.some((idx) => idx.name === name);

    if (!hasTaskIndex('engineering_tasks_source_commit_idx')) {
      await queryInterface.addIndex(taskTable, ['source_commit'], {
        name: 'engineering_tasks_source_commit_idx',
      });
    }
  },

  async down(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (tables.map((t) => String(t)).includes(INTEGRATION_TABLE)) {
      await queryInterface.dropTable(INTEGRATION_TABLE);
    }

    const missionDescribe = await queryInterface.describeTable('engineering_missions');
    for (const name of ['mission_source_ref', 'mission_base_commit', 'mission_integration_branch',
      'mission_current_commit', 'mission_source_state', 'mission_source_fence', 'mission_workspace_id']) {
      if (Object.prototype.hasOwnProperty.call(missionDescribe, name)) {
        await queryInterface.removeColumn('engineering_missions', name);
      }
    }

    const taskDescribe = await queryInterface.describeTable('engineering_tasks');
    for (const name of ['source_commit', 'source_ref', 'source_mission_fence']) {
      if (Object.prototype.hasOwnProperty.call(taskDescribe, name)) {
        await queryInterface.removeColumn('engineering_tasks', name);
      }
    }
  },
};
