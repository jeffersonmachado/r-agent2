'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN (
          SELECT conname
          FROM pg_constraint
          WHERE conrelid = 'tickets'::regclass
            AND conname ILIKE '%crm_%_id%'
        ) LOOP
          EXECUTE 'ALTER TABLE tickets DROP CONSTRAINT ' || quote_ident(r.conname);
        END LOOP;
      END $$;
    `);

    await queryInterface.changeColumn('tickets', 'crm_contact_id', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.changeColumn('tickets', 'crm_account_id', {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.changeColumn('tickets', 'crm_opportunity_id', {
      type: Sequelize.STRING,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('tickets', 'crm_contact_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });

    await queryInterface.changeColumn('tickets', 'crm_account_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });

    await queryInterface.changeColumn('tickets', 'crm_opportunity_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },
};
