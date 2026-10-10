'use strict';

/**
 * Migration: lineage de aprovação dos waivers de segurança.
 *
 * Achado P0 (2026-10-10): o waiver era criado em UMA etapa e a identidade de quem
 * aceitava o risco vinha do corpo da requisição. Não existia solicitante
 * registrado, então separação de funções (quem pede ≠ quem aprova) era
 * inexprimível, e "aplique a mitigação" acontecia no mesmo ato da solicitação.
 *
 * Esta migração abre espaço para o ciclo
 *   SOLICITADO (PENDING_APPROVAL) → APROVADO (ACTIVE) → REVOGADO/EXPIRADO
 * com:
 *   - `status`: linhas anteriores são aceitações JÁ efetivadas ⇒ nascem ACTIVE
 *     (o default preserva o histórico sem reinterpretá-lo);
 *   - `requested_by`/`requested_at`: quem pediu a isenção e quando;
 *   - `approved_at`: quando a aprovação de fato ocorreu;
 *   - `scope_hash`: impressão do ESCOPO aprovado (achado + pacote + serviço +
 *     severidade + expiração). Se o escopo mudar depois, o hash não casa e o
 *     waiver deixa de isentar — aprovação não pode ser reaproveitada para outro
 *     escopo;
 *   - `approval_version`: incrementado a cada transição, para detectar
 *     reaproveitamento (anti-replay) e dar CAS à concorrência.
 *
 * `approved_by` passa a ser NULLABLE: enquanto a solicitação está pendente NÃO
 * existe aprovador, e gravar o solicitante ali afirmaria uma aprovação que não
 * aconteceu. Nada nesta migração isenta nada.
 */

async function columnDescription(queryInterface, tableName) {
  return queryInterface.describeTable(tableName).catch(() => null);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const table = 'security_waivers';
    const description = await columnDescription(queryInterface, table);
    if (!description) return;

    const addMissing = async (name, definition) => {
      if (Object.prototype.hasOwnProperty.call(description, name)) return;
      await queryInterface.addColumn(table, name, definition);
    };

    await addMissing('status', { type: Sequelize.STRING, allowNull: false, defaultValue: 'ACTIVE' });
    await addMissing('requested_by', { type: Sequelize.STRING, allowNull: true });
    await addMissing('requested_at', { type: Sequelize.DATE, allowNull: true });
    await addMissing('approved_at', { type: Sequelize.DATE, allowNull: true });
    await addMissing('scope_hash', { type: Sequelize.STRING, allowNull: true });
    await addMissing('approval_version', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 });

    if (description.approved_by && description.approved_by.allowNull === false) {
      await queryInterface.changeColumn(table, 'approved_by', { type: Sequelize.STRING, allowNull: true });
    }
  },

  async down(queryInterface) {
    const table = 'security_waivers';
    const description = await columnDescription(queryInterface, table);
    if (!description) return;
    for (const name of ['approval_version', 'scope_hash', 'approved_at', 'requested_at', 'requested_by', 'status']) {
      if (!Object.prototype.hasOwnProperty.call(description, name)) continue;
      await queryInterface.removeColumn(table, name).catch(() => {});
    }
  },
};
