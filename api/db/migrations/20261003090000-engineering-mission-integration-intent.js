'use strict';

/**
 * IntegrationIntent durável na trilha de integrações.
 *
 * DEFEITO QUE ESTA MIGRAÇÃO ELIMINA (confirmado no código em 2026-10-03):
 * `advanceMissionSource` executava `git update-ref` ANTES de persistir qualquer coisa, e o registro
 * da trilha era escrito por ÚLTIMO (`recordIntegration`). A janela real era:
 *
 *   persist IntegrationIntent(PREPARED)
 *   ↓ (faltava)                                                        ← janela aberta
 *   git update-ref CAS
 *   ↓
 *   DB missionCurrentCommit CAS
 *   ↓
 *   recordIntegration (receipt)                                        ← único registro durável
 *
 * Se o processo morresse entre o `update-ref` e o `recordIntegration`, a branch estava à frente do
 * banco e NÃO havia linha alguma que explicasse o avanço: a retomada caía em
 * `CONCURRENT_SOURCE_UPDATE` / `STALE_CANDIDATE` e a operação podia travar ou ser reaplicada.
 *
 * A correção NÃO cria tabela paralela: evolui `engineering_mission_integrations`, que já é a trilha
 * append-only com `integration_key` UNIQUE (idempotência no banco, não em código). A linha passa a
 * nascer como INTENT (PREPARED) antes de tocar na ref git e a progredir por fases até COMMITTED.
 *
 * COMPATIBILIDADE: as linhas pré-existentes são resultados pós-fato. Elas recebem
 * `integration_status='COMMITTED'` pelo default da coluna — nenhum dado histórico é reinterpretado
 * como intent e nenhuma linha antiga passa a ser varrida pela reconciliação.
 */

const INTEGRATION_TABLE = 'engineering_mission_integrations';

const STATUS_COLUMN = 'integration_status';
const STATUS_INDEX = 'engineering_mission_integrations_status_idx';

const TIMESTAMP_COLUMNS = ['git_applied_at', 'db_applied_at', 'committed_at'];
const INTENT_COLUMNS = [
  ['worker_instance_id', { type: require('sequelize').DataTypes.STRING(64), allowNull: true }],
  ['expected_mission_commit', { type: require('sequelize').DataTypes.STRING(64), allowNull: true }],
  ['expected_fence', { type: require('sequelize').DataTypes.INTEGER, allowNull: true }],
];

module.exports = {
  async up(queryInterface) {
    const { DataTypes } = require('sequelize');
    const describe = await queryInterface.describeTable(INTEGRATION_TABLE);

    // 1. Fase durável. Default COMMITTED mantém as linhas antigas válidas como resultado pós-fato.
    if (!Object.prototype.hasOwnProperty.call(describe, STATUS_COLUMN)) {
      await queryInterface.addColumn(INTEGRATION_TABLE, STATUS_COLUMN, {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'COMMITTED',
      });
    }

    // 2. Carimbos por fase — é o que torna a janela de crash observável e reconciliável.
    for (const name of TIMESTAMP_COLUMNS) {
      if (Object.prototype.hasOwnProperty.call(describe, name)) continue;
      await queryInterface.addColumn(INTEGRATION_TABLE, name, { type: DataTypes.DATE, allowNull: true });
    }

    // 3. Contexto do intent: quem aplicou, sob qual commit esperado e sob qual fence.
    for (const [name, spec] of INTENT_COLUMNS) {
      if (Object.prototype.hasOwnProperty.call(describe, name)) continue;
      await queryInterface.addColumn(INTEGRATION_TABLE, name, spec);
    }

    // 4. `integration_result` passa a ser opcional: enquanto o intent está PREPARED/GIT_APPLIED não
    //    existe desfecho a declarar. Antes era NOT NULL, o que FORÇAVA gravar o resultado antes de
    //    ele existir (ou não gravar nada — exatamente a janela acima).
    if (describe.integration_result && describe.integration_result.allowNull === false) {
      await queryInterface.changeColumn(INTEGRATION_TABLE, 'integration_result', {
        type: DataTypes.STRING(32),
        allowNull: true,
      });
    }

    // 5. Índice para a varredura de boot por intents NÃO terminais.
    const indexes = await queryInterface.showIndex(INTEGRATION_TABLE).catch(() => []);
    const hasStatusIndex = (indexes || []).some((idx) => String(idx.name) === STATUS_INDEX);
    if (!hasStatusIndex) {
      await queryInterface.addIndex(INTEGRATION_TABLE, [STATUS_COLUMN], { name: STATUS_INDEX });
    }
  },

  async down(queryInterface) {
    const { DataTypes } = require('sequelize');
    const describe = await queryInterface.describeTable(INTEGRATION_TABLE);

    const indexes = await queryInterface.showIndex(INTEGRATION_TABLE).catch(() => []);
    if ((indexes || []).some((idx) => String(idx.name) === STATUS_INDEX)) {
      await queryInterface.removeIndex(INTEGRATION_TABLE, STATUS_INDEX);
    }

    if (describe.integration_result && describe.integration_result.allowNull === true) {
      await queryInterface.changeColumn(INTEGRATION_TABLE, 'integration_result', {
        type: DataTypes.STRING(32),
        allowNull: false,
      });
    }

    for (const [name] of INTENT_COLUMNS) {
      if (!Object.prototype.hasOwnProperty.call(describe, name)) continue;
      await queryInterface.removeColumn(INTEGRATION_TABLE, name);
    }
    for (const name of TIMESTAMP_COLUMNS) {
      if (!Object.prototype.hasOwnProperty.call(describe, name)) continue;
      await queryInterface.removeColumn(INTEGRATION_TABLE, name);
    }
    if (Object.prototype.hasOwnProperty.call(describe, STATUS_COLUMN)) {
      await queryInterface.removeColumn(INTEGRATION_TABLE, STATUS_COLUMN);
    }
  },
};
