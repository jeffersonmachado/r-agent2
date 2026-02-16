/**
 * PBX v1 - Extend Asterisk Realtime ps_endpoints with ACL fields.
 *
 * Asterisk PJSIP supports endpoint option "acl" (and optionally "contact_acl"),
 * which references sections in acl.conf.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ps_endpoints', 'acl', { type: Sequelize.STRING(200), allowNull: true });
    await queryInterface.addColumn('ps_endpoints', 'contact_acl', { type: Sequelize.STRING(200), allowNull: true });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ps_endpoints', 'contact_acl');
    await queryInterface.removeColumn('ps_endpoints', 'acl');
  },
};

