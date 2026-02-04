/**
 * PBX v1 - Product layer (Postgres source of truth).
 *
 * These tables represent the application domain and are used for:
 * - UX / validation
 * - audit/versioning of configuration
 * - materialization into Asterisk Realtime tables (ps_*, extensions, queues)
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Tenants enabled for PBX features
    await queryInterface.createTable('pbx_tenants', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false, unique: true },
      name: { type: Sequelize.STRING, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'active' }, // active|suspended
      settings: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_tenants', ['tenant_key'], { unique: true, name: 'pbx_tenants_tenant_key_uq' });

    // Extensions / endpoints (ramais)
    await queryInterface.createTable('pbx_extensions', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true }, // app-level id
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      extension: { type: Sequelize.STRING(40), allowNull: false }, // ramal
      display_name: { type: Sequelize.STRING(120), allowNull: true },
      auth_username: { type: Sequelize.STRING(120), allowNull: true },
      auth_password: { type: Sequelize.STRING(255), allowNull: true }, // will be encrypted or hashed per policy
      callerid_name: { type: Sequelize.STRING(120), allowNull: true },
      callerid_number: { type: Sequelize.STRING(40), allowNull: true },
      voicemail_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      codecs: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      endpoint_options: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      status: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'active' }, // active|disabled
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_extensions', ['tenant_key', 'extension'], { unique: true, name: 'pbx_extensions_tenant_extension_uq' });

    // Trunks (interconexões)
    await queryInterface.createTable('pbx_trunks', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING(128), allowNull: false },
      type: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'pjsip' }, // pjsip|iax|...
      transport: { type: Sequelize.STRING(40), allowNull: true },
      auth: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      aor: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      endpoint: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      status: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'active' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_trunks', ['tenant_key', 'name'], { unique: true, name: 'pbx_trunks_tenant_name_uq' });

    // Routes (inbound/outbound) - stored as normalized rules, materialized to dialplan realtime
    await queryInterface.createTable('pbx_routes', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      direction: { type: Sequelize.STRING(16), allowNull: false }, // inbound|outbound
      name: { type: Sequelize.STRING(128), allowNull: false },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      match: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} }, // DID/prefix/pattern/etc
      actions: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] }, // target chain
      priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 100 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_routes', ['tenant_key', 'direction', 'name'], { unique: true, name: 'pbx_routes_tenant_direction_name_uq' });

    // Queues (product layer)
    await queryInterface.createTable('pbx_queues', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING(128), allowNull: false },
      display_name: { type: Sequelize.STRING(128), allowNull: true },
      strategy: { type: Sequelize.STRING(32), allowNull: true },
      options: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_queues', ['tenant_key', 'name'], { unique: true, name: 'pbx_queues_tenant_name_uq' });

    await queryInterface.createTable('pbx_queue_members', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      queue_id: { type: Sequelize.STRING, allowNull: false },
      member_type: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'extension' }, // extension|external
      member_ref: { type: Sequelize.STRING(128), allowNull: false }, // extension id or interface
      penalty: { type: Sequelize.INTEGER, allowNull: true },
      paused: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_queue_members', ['tenant_key', 'queue_id'], { name: 'pbx_queue_members_tenant_queue_idx' });

    // IVR / time conditions / call policies are represented initially as JSON rules.
    await queryInterface.createTable('pbx_call_rules', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      type: { type: Sequelize.STRING(32), allowNull: false }, // ivr|time_condition|holiday|forwarding|blocklist|...
      name: { type: Sequelize.STRING(128), allowNull: false },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      definition: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_call_rules', ['tenant_key', 'type', 'name'], { unique: true, name: 'pbx_call_rules_tenant_type_name_uq' });

    // Config versioning (apply pipeline)
    await queryInterface.createTable('pbx_config_versions', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      version: { type: Sequelize.INTEGER, allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'draft' }, // draft|applied|failed
      summary: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_by_user_id: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_config_versions', ['tenant_key', 'version'], { unique: true, name: 'pbx_config_versions_tenant_version_uq' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('pbx_config_versions');
    await queryInterface.dropTable('pbx_call_rules');
    await queryInterface.dropTable('pbx_queue_members');
    await queryInterface.dropTable('pbx_queues');
    await queryInterface.dropTable('pbx_routes');
    await queryInterface.dropTable('pbx_trunks');
    await queryInterface.dropTable('pbx_extensions');
    await queryInterface.dropTable('pbx_tenants');
  },
};

