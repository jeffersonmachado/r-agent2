'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'platform_role', {
      type: Sequelize.STRING,
      allowNull: true,
      comment: 'Platform role interno RAP (support_n1..n3, engineer, etc.); NULL = usuário de tenant sem acesso a plataforma',
    }).catch((error) => {
      if (!/already exists|duplicate column/i.test(error.message)) throw error;
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'platform_role').catch(() => {});
  },
};
