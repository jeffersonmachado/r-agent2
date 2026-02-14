'use strict';

/**
 * Migration: Create event_ledger (append-only) for canonical events.
 *
 * Goals:
 * - Unified, queryable, multi-tenant event stream (physical/order/pbx/...)
 * - Correlation via correlation_id across modules
 * - Best-effort idempotency via (tenant_key, type, idempotency_key)
 *
 * Notes:
 * - This is NOT the same as audit_events (who did what) nor ticket_events (ticket timeline).
 * - Keep payload JSONB for forward compatibility.
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'event_ledger', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      type: { type: Sequelize.STRING(80), allowNull: false }, // canonical event type
      source: { type: Sequelize.STRING(120), allowNull: false, defaultValue: 'api' },
      occurred_at: { type: Sequelize.DATE, allowNull: false }, // when it happened
      received_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }, // when we wrote it
      correlation_id: { type: Sequelize.STRING(120), allowNull: true },
      subject_type: { type: Sequelize.STRING(40), allowNull: true }, // order|physical_ticket|call|...
      subject_id: { type: Sequelize.STRING(128), allowNull: true },
      actor_type: { type: Sequelize.STRING(40), allowNull: true }, // user|system|public_token|...
      actor_id: { type: Sequelize.STRING(128), allowNull: true },
      idempotency_key: { type: Sequelize.STRING(160), allowNull: true },
      payload: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'event_ledger', ['tenant_key', 'occurred_at'], {
      name: 'event_ledger_tenant_occurred_at_idx',
    });
    await addIndexIfNotExists(queryInterface, 'event_ledger', ['tenant_key', 'type', 'occurred_at'], {
      name: 'event_ledger_tenant_type_occurred_at_idx',
    });
    await addIndexIfNotExists(queryInterface, 'event_ledger', ['tenant_key', 'correlation_id', 'occurred_at'], {
      name: 'event_ledger_tenant_correlation_occurred_at_idx',
    });
    await addIndexIfNotExists(queryInterface, 'event_ledger', ['tenant_key', 'subject_type', 'subject_id', 'occurred_at'], {
      name: 'event_ledger_tenant_subject_occurred_at_idx',
    });
    await addIndexIfNotExists(queryInterface, 'event_ledger', ['tenant_key', 'type', 'idempotency_key'], {
      name: 'event_ledger_tenant_type_idempotency_uq',
      unique: true,
    });

    // PBX: on insert into pbx_cdr, emit a canonical event (best-effort).
    // This keeps the PBX ingest path decoupled from the Node runtime.
    await queryInterface.sequelize.query(
      `CREATE OR REPLACE FUNCTION event_ledger_from_pbx_cdr()
       RETURNS trigger AS $$
       DECLARE
         evt_id text;
         corr_id text;
       BEGIN
         evt_id := 'evt-pbx-cdr-' || COALESCE(NEW.uniqueid, EXTRACT(EPOCH FROM NOW())::bigint::text);
         corr_id := COALESCE(NEW.linkedid, NEW.uniqueid, NEW.id);

         INSERT INTO event_ledger (
           id, tenant_key, type, source, occurred_at, correlation_id,
           subject_type, subject_id, actor_type, actor_id, payload, created_at, updated_at
         )
         VALUES (
           evt_id,
           COALESCE(NULLIF(NEW.tenant_key, ''), 'unknown'),
           'PbxCdrIngested',
           'asterisk.cdr',
           COALESCE(NEW.calldate, NOW()),
           corr_id,
           'call',
           COALESCE(NEW.uniqueid, NEW.id),
           'system',
           'asterisk',
           jsonb_build_object(
             'pbxCdrId', NEW.id,
             'uniqueid', NEW.uniqueid,
             'linkedid', NEW.linkedid,
             'src', NEW.src,
             'dst', NEW.dst,
             'disposition', NEW.disposition,
             'duration', NEW.duration,
             'billsec', NEW.billsec,
             'accountcode', NEW.accountcode
           ) || COALESCE(NEW.extra, '{}'::jsonb),
           NOW(),
           NOW()
         )
         ON CONFLICT DO NOTHING;

         RETURN NEW;
       END;
       $$ LANGUAGE plpgsql;`,
    ).catch(() => {});

    await queryInterface.sequelize.query(
      `DROP TRIGGER IF EXISTS event_ledger_from_pbx_cdr_trg ON pbx_cdr;`,
    ).catch(() => {});

    await queryInterface.sequelize.query(
      `CREATE TRIGGER event_ledger_from_pbx_cdr_trg
       AFTER INSERT ON pbx_cdr
       FOR EACH ROW
       EXECUTE FUNCTION event_ledger_from_pbx_cdr();`,
    ).catch(() => {});
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(
      `DROP TRIGGER IF EXISTS event_ledger_from_pbx_cdr_trg ON pbx_cdr;`,
    ).catch(() => {});
    await queryInterface.sequelize.query(
      `DROP FUNCTION IF EXISTS event_ledger_from_pbx_cdr();`,
    ).catch(() => {});
    await queryInterface.dropTable('event_ledger');
  },
};

