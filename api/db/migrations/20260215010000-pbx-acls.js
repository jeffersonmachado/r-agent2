/**
 * PBX v1 - ACL catalog (product layer).
 *
 * Goal:
 * - Centralize IP ACL definitions (deny/permit) to be referenced by extensions.
 * - Materialization into Asterisk is handled separately (generated acl.conf + endpoint "acl" binding).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('pbx_acls', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING(128), allowNull: false },
      description: { type: Sequelize.STRING(255), allowNull: true },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      deny: { type: Sequelize.TEXT, allowNull: true },
      permit: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('pbx_acls', ['tenant_key', 'name'], { unique: true, name: 'pbx_acls_tenant_name_uq' });
    await queryInterface.addIndex('pbx_acls', ['tenant_key'], { name: 'pbx_acls_tenant_idx' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pbx_acls');
  },
};

