'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const [results] = await queryInterface.sequelize.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'runtime_artifacts' AND column_name = 'storage_key') AS exists",
    );

    const exists = Array.isArray(results) && results.length > 0
      ? (results[0].exists === true || results[0].exists === 't')
      : false;

    if (!exists) {
      await queryInterface.addColumn('runtime_artifacts', 'storage_key', {
        type: Sequelize.STRING,
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('runtime_artifacts', 'storage_key').catch(() => {});
  },
};
