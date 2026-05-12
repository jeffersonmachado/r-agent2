module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TABLE pbx_cdr ALTER COLUMN calldate DROP NOT NULL`,
    ).catch(() => {});

    await queryInterface.sequelize.query(
      `ALTER TABLE pbx_cdr ALTER COLUMN calldate SET DEFAULT NOW()`,
    ).catch(() => {});

    // Asterisk may emit non-UTF8 payloads for these internal fields on Local channels.
    // Dropping them prevents cdr_adaptive_odbc from trying to insert invalid text.
    await queryInterface.removeColumn('pbx_cdr', 'lastapp').catch(() => {});
    await queryInterface.removeColumn('pbx_cdr', 'lastdata').catch(() => {});
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('pbx_cdr', 'lastapp', {
      type: Sequelize.STRING(80),
      allowNull: true,
    }).catch(() => {});

    await queryInterface.addColumn('pbx_cdr', 'lastdata', {
      type: Sequelize.STRING(255),
      allowNull: true,
    }).catch(() => {});

    await queryInterface.sequelize.query(
      `ALTER TABLE pbx_cdr ALTER COLUMN calldate DROP DEFAULT`,
    ).catch(() => {});

    await queryInterface.sequelize.query(
      `ALTER TABLE pbx_cdr ALTER COLUMN calldate SET NOT NULL`,
    ).catch(() => {});
  },
};