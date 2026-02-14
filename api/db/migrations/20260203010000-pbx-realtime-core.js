/**
 * PBX v1 - Core Realtime tables (Asterisk) + minimal multi-tenant support.
 *
 * Notes:
 * - This migration intentionally starts small: PJSIP core + dialplan realtime + queues.
 * - Asterisk shared multi-tenant strategy is enforced at the application level:
 *   - `extensions.context = tenant_key`
 *   - PJSIP object IDs are prefixed: `${tenantKey}__<id>`
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // ---------------------------------------------------------------------
    // Dialplan Realtime: extensions
    // ---------------------------------------------------------------------
    await queryInterface.createTable('extensions', {
      id: { type: Sequelize.BIGINT, allowNull: false, autoIncrement: true, primaryKey: true },
      context: { type: Sequelize.STRING(40), allowNull: false },
      exten: { type: Sequelize.STRING(40), allowNull: false },
      priority: { type: Sequelize.INTEGER, allowNull: false },
      app: { type: Sequelize.STRING(40), allowNull: false },
      appdata: { type: Sequelize.STRING(256), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('extensions', ['context', 'exten', 'priority'], { unique: true, name: 'extensions_context_exten_priority_uq' });

    // ---------------------------------------------------------------------
    // PJSIP Realtime: core tables
    // ---------------------------------------------------------------------
    await queryInterface.createTable('ps_endpoints', {
      id: { type: Sequelize.STRING(40), allowNull: false, primaryKey: true },
      transport: { type: Sequelize.STRING(40), allowNull: true },
      aors: { type: Sequelize.STRING(200), allowNull: true },
      auth: { type: Sequelize.STRING(40), allowNull: true },
      context: { type: Sequelize.STRING(40), allowNull: true }, // tenant dialplan context
      disallow: { type: Sequelize.STRING(200), allowNull: true },
      allow: { type: Sequelize.STRING(200), allowNull: true },
      direct_media: { type: Sequelize.STRING(8), allowNull: true },
      dtmf_mode: { type: Sequelize.STRING(16), allowNull: true },
      callerid: { type: Sequelize.STRING(80), allowNull: true },
      mailboxes: { type: Sequelize.STRING(80), allowNull: true },
      device_state_busy_at: { type: Sequelize.INTEGER, allowNull: true },
      allow_transfer: { type: Sequelize.STRING(8), allowNull: true },
      allow_subscribe: { type: Sequelize.STRING(8), allowNull: true },
      rewrite_contact: { type: Sequelize.STRING(8), allowNull: true },
      rtp_symmetric: { type: Sequelize.STRING(8), allowNull: true },
      force_rport: { type: Sequelize.STRING(8), allowNull: true },
      ice_support: { type: Sequelize.STRING(8), allowNull: true },
      use_ptime: { type: Sequelize.STRING(8), allowNull: true },
      media_encryption: { type: Sequelize.STRING(16), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('ps_auths', {
      id: { type: Sequelize.STRING(40), allowNull: false, primaryKey: true },
      auth_type: { type: Sequelize.STRING(16), allowNull: true }, // userpass|md5|...
      password: { type: Sequelize.STRING(255), allowNull: true },
      realm: { type: Sequelize.STRING(80), allowNull: true },
      username: { type: Sequelize.STRING(80), allowNull: true },
      md5_cred: { type: Sequelize.STRING(80), allowNull: true },
      nonce_lifetime: { type: Sequelize.INTEGER, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('ps_aors', {
      id: { type: Sequelize.STRING(40), allowNull: false, primaryKey: true },
      contact: { type: Sequelize.STRING(255), allowNull: true },
      default_expiration: { type: Sequelize.INTEGER, allowNull: true },
      mailboxes: { type: Sequelize.STRING(80), allowNull: true },
      max_contacts: { type: Sequelize.INTEGER, allowNull: true },
      minimum_expiration: { type: Sequelize.INTEGER, allowNull: true },
      remove_existing: { type: Sequelize.STRING(8), allowNull: true },
      qualify_frequency: { type: Sequelize.INTEGER, allowNull: true },
      authenticate_qualify: { type: Sequelize.STRING(8), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // ---------------------------------------------------------------------
    // Queues Realtime (optional, but present in many deployments)
    // NOTE: table names are prefixed to avoid clashing with the application's own `queues` table.
    // ---------------------------------------------------------------------
    await queryInterface.createTable('pbx_rt_queues', {
      name: { type: Sequelize.STRING(128), allowNull: false, primaryKey: true },
      musiconhold: { type: Sequelize.STRING(128), allowNull: true },
      announce: { type: Sequelize.STRING(128), allowNull: true },
      context: { type: Sequelize.STRING(128), allowNull: true }, // tenant context or queue context
      timeout: { type: Sequelize.INTEGER, allowNull: true },
      retry: { type: Sequelize.INTEGER, allowNull: true },
      wrapuptime: { type: Sequelize.INTEGER, allowNull: true },
      maxlen: { type: Sequelize.INTEGER, allowNull: true },
      servicelevel: { type: Sequelize.INTEGER, allowNull: true },
      strategy: { type: Sequelize.STRING(32), allowNull: true },
      joinempty: { type: Sequelize.STRING(128), allowNull: true },
      leavewhenempty: { type: Sequelize.STRING(128), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('pbx_rt_queue_members', {
      queue_name: { type: Sequelize.STRING(80), allowNull: false, primaryKey: true },
      interface: { type: Sequelize.STRING(80), allowNull: false, primaryKey: true },
      uniqueid: { type: Sequelize.INTEGER, allowNull: false, unique: true },
      membername: { type: Sequelize.STRING(80), allowNull: true },
      state_interface: { type: Sequelize.STRING(80), allowNull: true },
      penalty: { type: Sequelize.INTEGER, allowNull: true },
      paused: { type: Sequelize.INTEGER, allowNull: true },
      wrapuptime: { type: Sequelize.INTEGER, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pbx_rt_queue_members');
    await queryInterface.dropTable('pbx_rt_queues');
    await queryInterface.dropTable('ps_aors');
    await queryInterface.dropTable('ps_auths');
    await queryInterface.dropTable('ps_endpoints');
    await queryInterface.dropTable('extensions');
  },
};

