'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('runtime_artifacts', 'metadata', { type: Sequelize.JSONB, allowNull: false, defaultValue: {} }).catch((error) => {
      if (!/already exists|duplicate column/i.test(error.message)) throw error;
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('runtime_artifacts', 'metadata').catch(() => {});
  },
};