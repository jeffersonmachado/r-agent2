'use strict';

/**
 * Migration: guarda de imutabilidade de propriedade em `crm_records`.
 *
 * P0-02 (auditoria 2026-10-19): a aplicação usava `upsert` com PK apenas `id`,
 * e um POST com o id de outro tenant trocava o `tenant_key` do registro alheio
 * (transferência de propriedade). A aplicação foi corrigida (INSERT/SELECT/
 * UPDATE/DELETE separados e escopados), mas defesa em profundidade exige que o
 * BANCO recuse a transferência mesmo que uma regressão futura reintroduza um
 * UPDATE amplo.
 *
 * Esta migration instala um trigger `BEFORE UPDATE` que rejeita qualquer mudança
 * de `tenant_key`. `down` remove trigger e função — reversível.
 *
 * Só é instalada em PostgreSQL (dialeto onde `crm_records` foi criada com JSONB).
 * Em outros dialetos o enforcement fica na aplicação.
 */

const NOME_FUNCAO = 'crm_records_protege_tenant';
const NOME_TRIGGER = 'crm_records_tenant_imutavel';

module.exports = {
  async up(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== 'postgres') return;

    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION ${NOME_FUNCAO}()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.tenant_key IS DISTINCT FROM OLD.tenant_key THEN
          RAISE EXCEPTION 'crm_records.tenant_key e imutavel (tentativa de transferencia de propriedade: % -> %)',
            OLD.tenant_key, NEW.tenant_key
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS ${NOME_TRIGGER} ON crm_records;
      CREATE TRIGGER ${NOME_TRIGGER}
      BEFORE UPDATE ON crm_records
      FOR EACH ROW
      EXECUTE PROCEDURE ${NOME_FUNCAO}();
    `);
  },

  async down(queryInterface) {
    const dialect = queryInterface.sequelize.getDialect();
    if (dialect !== 'postgres') return;
    await queryInterface.sequelize.query(`DROP TRIGGER IF EXISTS ${NOME_TRIGGER} ON crm_records;`);
    await queryInterface.sequelize.query(`DROP FUNCTION IF EXISTS ${NOME_FUNCAO}();`);
  },
};
