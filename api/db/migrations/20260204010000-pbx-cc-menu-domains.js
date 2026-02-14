/**
 * PBX/CC v1 - Tabelas adicionais para cobrir o menu legado do Ripabx-Web.
 *
 * Objetivo: permitir import/conversão do legado (XML/MariaDB/arquivos) para Postgres
 * e servir como fonte de verdade para materialização no Asterisk Realtime.
 *
 * Nota: várias entidades do legado são representadas como JSONB (definition/settings)
 * para acelerar a migração big-bang e permitir evolução incremental do modelo.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // -------------------------------------------------------------------
    // PBX - Operadoras / Bases de rota / Categorias / Bloqueios
    // -------------------------------------------------------------------
    await queryInterface.createTable('pbx_carriers', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      code: { type: Sequelize.STRING(40), allowNull: false }, // legado: operadora.codigo
      name: { type: Sequelize.STRING(128), allowNull: false },
      settings: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_carriers', ['tenant_key', 'code'], { unique: true, name: 'pbx_carriers_tenant_code_uq' });

    await queryInterface.createTable('pbx_route_bases', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      code: { type: Sequelize.STRING(40), allowNull: false }, // legado: rota_base.codigo
      name: { type: Sequelize.STRING(128), allowNull: true },
      pattern: { type: Sequelize.STRING(128), allowNull: true },
      definition: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_route_bases', ['tenant_key', 'code'], { unique: true, name: 'pbx_route_bases_tenant_code_uq' });

    await queryInterface.createTable('pbx_category_types', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      code: { type: Sequelize.STRING(40), allowNull: false }, // legado: tipo.codigo
      name: { type: Sequelize.STRING(128), allowNull: false },
      settings: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_category_types', ['tenant_key', 'code'], { unique: true, name: 'pbx_category_types_tenant_code_uq' });

    await queryInterface.createTable('pbx_categories', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      code: { type: Sequelize.STRING(40), allowNull: false }, // legado: categoria.codigo
      name: { type: Sequelize.STRING(128), allowNull: false },
      type_code: { type: Sequelize.STRING(40), allowNull: true },
      rules: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_categories', ['tenant_key', 'code'], { unique: true, name: 'pbx_categories_tenant_code_uq' });

    await queryInterface.createTable('pbx_block_rules', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      direction: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'outbound' }, // inbound|outbound
      pattern: { type: Sequelize.STRING(128), allowNull: false },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      reason: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_block_rules', ['tenant_key', 'direction'], { name: 'pbx_block_rules_tenant_direction_idx' });

    // -------------------------------------------------------------------
    // PBX - Grupos, Salas, Feriados, DID/DDR, Fax
    // -------------------------------------------------------------------
    await queryInterface.createTable('pbx_groups', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING(128), allowNull: false },
      definition: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_groups', ['tenant_key', 'name'], { unique: true, name: 'pbx_groups_tenant_name_uq' });

    await queryInterface.createTable('pbx_conference_rooms', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING(128), allowNull: false },
      pin: { type: Sequelize.STRING(32), allowNull: true },
      options: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_conference_rooms', ['tenant_key', 'name'], { unique: true, name: 'pbx_conference_rooms_tenant_name_uq' });

    await queryInterface.createTable('pbx_holidays', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      name: { type: Sequelize.STRING(128), allowNull: false },
      settings: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_holidays', ['tenant_key', 'date'], { unique: true, name: 'pbx_holidays_tenant_date_uq' });

    await queryInterface.createTable('pbx_dids', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      did: { type: Sequelize.STRING(64), allowNull: false }, // E.164 ou formato legado
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      match: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} }, // ex: { did:"5511..." }
      actions: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] }, // chain (queue/ivr/extension)
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_dids', ['tenant_key', 'did'], { unique: true, name: 'pbx_dids_tenant_did_uq' });

    await queryInterface.createTable('pbx_fax_routes', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING(128), allowNull: false },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      definition: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_fax_routes', ['tenant_key', 'name'], { unique: true, name: 'pbx_fax_routes_tenant_name_uq' });

    // -------------------------------------------------------------------
    // PBX - Áudios / Gravações / CDR (metadados)
    // -------------------------------------------------------------------
    await queryInterface.createTable('pbx_audio_assets', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      kind: { type: Sequelize.STRING(32), allowNull: false }, // espera|sons|campanha|ivr|...
      name: { type: Sequelize.STRING(255), allowNull: false },
      storage: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} }, // {provider,path,mime,size,...}
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_audio_assets', ['tenant_key', 'kind'], { name: 'pbx_audio_assets_tenant_kind_idx' });

    await queryInterface.createTable('pbx_recordings', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      uniqueid: { type: Sequelize.STRING(80), allowNull: true }, // correlaciona com CDR/Asterisk
      direction: { type: Sequelize.STRING(16), allowNull: true }, // inbound|outbound|internal
      src: { type: Sequelize.STRING(80), allowNull: true },
      dst: { type: Sequelize.STRING(80), allowNull: true },
      storage: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      started_at: { type: Sequelize.DATE, allowNull: true },
      ended_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_recordings', ['tenant_key', 'uniqueid'], { name: 'pbx_recordings_tenant_uniqueid_idx' });

    await queryInterface.createTable('pbx_cdr', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      uniqueid: { type: Sequelize.STRING(80), allowNull: false },
      calldate: { type: Sequelize.DATE, allowNull: false },
      src: { type: Sequelize.STRING(80), allowNull: true },
      dst: { type: Sequelize.STRING(80), allowNull: true },
      disposition: { type: Sequelize.STRING(32), allowNull: true },
      duration: { type: Sequelize.INTEGER, allowNull: true },
      billsec: { type: Sequelize.INTEGER, allowNull: true },
      accountcode: { type: Sequelize.STRING(80), allowNull: true },
      userfield: { type: Sequelize.STRING(255), allowNull: true },
      extra: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('pbx_cdr', ['tenant_key', 'uniqueid'], { unique: true, name: 'pbx_cdr_tenant_uniqueid_uq' });

    // -------------------------------------------------------------------
    // Contact Center - Motivos, Campanhas, Agendados, Click2Call
    // -------------------------------------------------------------------
    await queryInterface.createTable('cc_pause_reasons', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      code: { type: Sequelize.STRING(40), allowNull: false }, // legado: motivo.codigo (ou atributo)
      description: { type: Sequelize.STRING(255), allowNull: false },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('cc_pause_reasons', ['tenant_key', 'code'], { unique: true, name: 'cc_pause_reasons_tenant_code_uq' });

    await queryInterface.createTable('cc_contact_reasons', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      code: { type: Sequelize.STRING(40), allowNull: false }, // legado: motivo1.codigo (ou atributo)
      description: { type: Sequelize.STRING(255), allowNull: false },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('cc_contact_reasons', ['tenant_key', 'code'], { unique: true, name: 'cc_contact_reasons_tenant_code_uq' });

    await queryInterface.createTable('cc_campaigns', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING(255), allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'draft' }, // draft|active|paused|ended
      start_at: { type: Sequelize.DATE, allowNull: true },
      end_at: { type: Sequelize.DATE, allowNull: true },
      settings: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} }, // inclui fila, modo, audio, confirmacao, gravar etc.
      click2call_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      record_enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('cc_campaigns', ['tenant_key', 'name'], { name: 'cc_campaigns_tenant_name_idx' });

    await queryInterface.createTable('cc_campaign_list', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      campaign_id: { type: Sequelize.STRING, allowNull: false },
      ddd: { type: Sequelize.STRING(8), allowNull: true },
      phone: { type: Sequelize.STRING(40), allowNull: false },
      key: { type: Sequelize.STRING(80), allowNull: true }, // legado: chave
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'pending' },
      attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      extra: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('cc_campaign_list', ['tenant_key', 'campaign_id'], { name: 'cc_campaign_list_tenant_campaign_idx' });

    await queryInterface.createTable('cc_scheduled_callbacks', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      scheduled_at: { type: Sequelize.DATE, allowNull: false },
      description: { type: Sequelize.STRING(255), allowNull: true },
      ddd: { type: Sequelize.STRING(8), allowNull: true },
      phone: { type: Sequelize.STRING(40), allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'pending' }, // pending|processing|done|failed|cancelled
      settings: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} }, // fila, modo, audio, confirmacao, gravar etc.
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('cc_scheduled_callbacks', ['tenant_key', 'scheduled_at'], { name: 'cc_scheduled_callbacks_tenant_scheduled_idx' });

    await queryInterface.createTable('cc_click2call_requests', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      campaign_id: { type: Sequelize.STRING, allowNull: true },
      target: { type: Sequelize.STRING(128), allowNull: false }, // fila/ramal/contexto (legado varia)
      ddd: { type: Sequelize.STRING(8), allowNull: true },
      phone: { type: Sequelize.STRING(40), allowNull: false },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'pending' },
      extra: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('cc_click2call_requests', ['tenant_key', 'status'], { name: 'cc_click2call_requests_tenant_status_idx' });

    // -------------------------------------------------------------------
    // Legacy R-ChatBot (migrar para novo stack depois)
    // -------------------------------------------------------------------
    await queryInterface.createTable('legacy_rchatbot', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      tag: { type: Sequelize.STRING(128), allowNull: false },
      context_set: { type: Sequelize.TEXT, allowNull: true },
      context_filter: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await queryInterface.addIndex('legacy_rchatbot', ['tenant_key', 'tag'], { name: 'legacy_rchatbot_tenant_tag_idx' });

    await queryInterface.createTable('legacy_rchatbot_patterns', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      rchatbot_id: { type: Sequelize.STRING, allowNull: false },
      patterns: { type: Sequelize.TEXT, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('legacy_rchatbot_responses', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      rchatbot_id: { type: Sequelize.STRING, allowNull: false },
      responses: { type: Sequelize.TEXT, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('legacy_rchatbot_actions', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      rchatbot_id: { type: Sequelize.STRING, allowNull: false },
      action: { type: Sequelize.STRING(128), allowNull: false },
      extra: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // -------------------------------------------------------------------
    // Monitoramento (legado no menu; IcingaWeb2 continua separado)
    // -------------------------------------------------------------------
    await queryInterface.createTable('legacy_mon_hosts', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      host: { type: Sequelize.STRING(255), allowNull: false },
      display_name: { type: Sequelize.STRING(255), allowNull: true },
      ipv4: { type: Sequelize.STRING(64), allowNull: true },
      ipv6: { type: Sequelize.STRING(64), allowNull: true },
      os: { type: Sequelize.STRING(128), allowNull: true },
      app: { type: Sequelize.STRING(128), allowNull: true },
      settings: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('legacy_mon_services', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      name: { type: Sequelize.STRING(255), allowNull: false },
      host: { type: Sequelize.STRING(255), allowNull: true },
      oid: { type: Sequelize.STRING(255), allowNull: true },
      settings: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('legacy_mon_os', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      os: { type: Sequelize.STRING(255), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('legacy_mon_app', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false, defaultValue: 'system' },
      app: { type: Sequelize.STRING(255), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('legacy_mon_app');
    await queryInterface.dropTable('legacy_mon_os');
    await queryInterface.dropTable('legacy_mon_services');
    await queryInterface.dropTable('legacy_mon_hosts');
    await queryInterface.dropTable('legacy_rchatbot_actions');
    await queryInterface.dropTable('legacy_rchatbot_responses');
    await queryInterface.dropTable('legacy_rchatbot_patterns');
    await queryInterface.dropTable('legacy_rchatbot');
    await queryInterface.dropTable('cc_click2call_requests');
    await queryInterface.dropTable('cc_scheduled_callbacks');
    await queryInterface.dropTable('cc_campaign_list');
    await queryInterface.dropTable('cc_campaigns');
    await queryInterface.dropTable('cc_contact_reasons');
    await queryInterface.dropTable('cc_pause_reasons');
    await queryInterface.dropTable('pbx_cdr');
    await queryInterface.dropTable('pbx_recordings');
    await queryInterface.dropTable('pbx_audio_assets');
    await queryInterface.dropTable('pbx_fax_routes');
    await queryInterface.dropTable('pbx_dids');
    await queryInterface.dropTable('pbx_holidays');
    await queryInterface.dropTable('pbx_conference_rooms');
    await queryInterface.dropTable('pbx_groups');
    await queryInterface.dropTable('pbx_block_rules');
    await queryInterface.dropTable('pbx_categories');
    await queryInterface.dropTable('pbx_category_types');
    await queryInterface.dropTable('pbx_route_bases');
    await queryInterface.dropTable('pbx_carriers');
  },
};

