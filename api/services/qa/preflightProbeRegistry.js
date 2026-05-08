'use strict';

const authService = require('../authService');
const queueService = require('../queueService');
const { getSequelize } = require('../../db/sequelize');
const {
  Ticket,
  Tenant,
  User,
  AccessSubject,
  AccessMembership,
  AccessCredential,
  AccessDevice,
  VerticalAttendance,
  BillingSubscription,
  EventLedger,
  AccessDecision,
  PbxTenant,
  PbxQueue,
} = require('../../db/models');

let cachedDefaultRegistry = null;

function safeString(value) {
  if (value === null || value === undefined) return '';
  try {
    return String(value).trim();
  } catch (_) {
    return '';
  }
}

function getModel(factoryOrModel) {
  if (!factoryOrModel) return null;
  return typeof factoryOrModel === 'function' ? factoryOrModel() : factoryOrModel;
}

async function runScalarQuery(query) {
  const sequelize = getSequelize();
  if (!sequelize) {
    return { ok: false, reason: 'db_unavailable' };
  }
  try {
    const [rows] = await sequelize.query(query);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (error) {
    return { ok: false, reason: `db_query_failed:${error.message}` };
  }
}

function getIntegrationProbe(context = {}, key) {
  const probe = context?.integrations?.[key]?.health;
  if (typeof probe !== 'function') {
    return null;
  }
  return probe;
}

async function runHealthProbe(context, key, payload = {}) {
  const health = getIntegrationProbe(context, key);
  if (!health) {
    return { ok: false, reason: `integration_health_missing:${key}` };
  }

  try {
    const result = await health(payload, context);
    if (!result || result.ok !== true) {
      return {
        ok: false,
        reason: result?.reason || `${key}_health_failed`,
        evidence: result?.evidence || null,
      };
    }
    return { ok: true, evidence: result.evidence || result };
  } catch (error) {
    return { ok: false, reason: `${key}_health_error:${error.message}` };
  }
}

function createPreflightProbeRegistry() {
  const registry = {
    authenticated_agent: async ({ token, user } = {}, context = {}) => {
      const authToken = token || context.authToken || context.token || null;
      const validation = authService.validateToken(authToken);
      if (!validation.valid) {
        return { ok: false, reason: validation.error || 'invalid_session_token' };
      }

      const sessionAgent = validation.agent || {};
      const expectedUser = user || context.user || {};
      const expectedId = safeString(expectedUser.id);
      if (expectedId && safeString(sessionAgent.id) !== expectedId) {
        return { ok: false, reason: 'session_user_mismatch' };
      }

      return {
        ok: true,
        evidence: {
          sessionId: validation.session?.token || authToken,
          userId: sessionAgent.id || null,
          token: authToken,
        },
      };
    },

    tenant_loaded: async ({ tenantId } = {}) => {
      const normalizedTenantId = safeString(tenantId);
      if (!normalizedTenantId) {
        return { ok: false, reason: 'tenant_missing' };
      }

      const TenantModel = getModel(Tenant);
      if (!TenantModel || typeof TenantModel.findByPk !== 'function') {
        return { ok: false, reason: 'tenant_model_unavailable' };
      }

      const row = await TenantModel.findByPk(normalizedTenantId);
      if (!row) {
        return { ok: false, reason: 'tenant_not_found' };
      }
      return { ok: true, evidence: { tenantId: normalizedTenantId } };
    },

    open_ticket_exists: async ({ ticketId, tenantId } = {}, context = {}) => {
      const normalizedTenantId = safeString(tenantId || context.tenantId);
      if (!normalizedTenantId) {
        return { ok: false, reason: 'tenant_missing_for_ticket' };
      }

      const TicketModel = getModel(Ticket);
      if (!TicketModel || typeof TicketModel.findOne !== 'function') {
        return { ok: false, reason: 'ticket_model_unavailable' };
      }

      const where = { tenant_key: normalizedTenantId };
      const normalizedTicketId = safeString(ticketId);
      if (normalizedTicketId) {
        where.id = normalizedTicketId;
      }

      let row = await TicketModel.findOne({ where, order: [['updated_at', 'DESC']] });
      if (!row && normalizedTicketId) {
        const runtimeTicket = queueService.getTicket(normalizedTicketId);
        if (runtimeTicket && safeString(runtimeTicket.tenantId) === normalizedTenantId) {
          row = runtimeTicket;
        }
      }

      if (!row) {
        return { ok: false, reason: 'ticket_not_found' };
      }

      const status = safeString(row.status || row.get?.('status')).toLowerCase();
      if (status === 'closed') {
        return { ok: false, reason: 'ticket_closed' };
      }

      return {
        ok: true,
        evidence: {
          ticket: {
            id: row.id || row.get?.('id') || null,
            status,
            tenantId: row.tenant_key || row.tenantId || row.get?.('tenant_key') || null,
          },
        },
      };
    },

    ticket_storage_accessible: async () => {
      const result = await runScalarQuery('SELECT 1 AS ok FROM tickets LIMIT 1');
      if (!result.ok) return result;
      return { ok: true, evidence: { storage: 'tickets', rowsRead: result.rows.length } };
    },

    crm_contact_exists: async ({ contactId, tenantId } = {}, context = {}) => {
      const normalizedTenantId = safeString(tenantId || context.tenantId);
      const normalizedContactId = safeString(contactId || context.contactId);
      if (!normalizedTenantId || !normalizedContactId) {
        return { ok: false, reason: 'crm_contact_input_missing' };
      }

      const SubjectModel = getModel(AccessSubject);
      if (!SubjectModel || typeof SubjectModel.findOne !== 'function') {
        return { ok: false, reason: 'crm_subject_model_unavailable' };
      }

      const row = await SubjectModel.findOne({
        where: {
          tenant_key: normalizedTenantId,
          customer_id: normalizedContactId,
        },
      });
      if (!row) {
        return { ok: false, reason: 'crm_contact_not_found' };
      }
      return { ok: true, evidence: { contactId: normalizedContactId, subjectId: row.id || null } };
    },

    membership_exists: async ({ membershipId, tenantId } = {}, context = {}) => {
      const normalizedTenantId = safeString(tenantId || context.tenantId);
      const normalizedMembershipId = safeString(membershipId || context.membershipId);
      if (!normalizedTenantId || !normalizedMembershipId) {
        return { ok: false, reason: 'membership_input_missing' };
      }

      const MembershipModel = getModel(AccessMembership);
      if (!MembershipModel || typeof MembershipModel.findOne !== 'function') {
        return { ok: false, reason: 'membership_model_unavailable' };
      }

      const row = await MembershipModel.findOne({
        where: {
          tenant_key: normalizedTenantId,
          id: normalizedMembershipId,
          status: 'active',
        },
      });
      if (!row) return { ok: false, reason: 'membership_not_found_or_inactive' };
      return { ok: true, evidence: { membershipId: normalizedMembershipId } };
    },

    credential_exists: async ({ credentialId } = {}, context = {}) => {
      const normalizedCredentialId = safeString(credentialId || context.credentialId);
      const normalizedTenantId = safeString(context.tenantId);
      if (!normalizedCredentialId || !normalizedTenantId) {
        return { ok: false, reason: 'credential_input_missing' };
      }

      const CredentialModel = getModel(AccessCredential);
      if (!CredentialModel || typeof CredentialModel.findOne !== 'function') {
        return { ok: false, reason: 'credential_model_unavailable' };
      }

      const row = await CredentialModel.findOne({
        where: {
          tenant_key: normalizedTenantId,
          id: normalizedCredentialId,
          status: 'active',
        },
      });

      if (!row) return { ok: false, reason: 'credential_not_found_or_inactive' };
      return { ok: true, evidence: { credentialId: normalizedCredentialId } };
    },

    device_available: async ({ deviceId, tenantId } = {}, context = {}) => {
      const normalizedTenantId = safeString(tenantId || context.tenantId);
      const normalizedDeviceId = safeString(deviceId || context.deviceId);
      if (!normalizedTenantId || !normalizedDeviceId) {
        return { ok: false, reason: 'device_input_missing' };
      }

      const DeviceModel = getModel(AccessDevice);
      if (!DeviceModel || typeof DeviceModel.findOne !== 'function') {
        return { ok: false, reason: 'device_model_unavailable' };
      }

      const row = await DeviceModel.findOne({
        where: {
          tenant_key: normalizedTenantId,
          id: normalizedDeviceId,
          status: 'active',
        },
      });

      if (!row) return { ok: false, reason: 'device_not_found_or_inactive' };

      const metadata = row.metadata || {};
      const heartbeatAt = metadata.heartbeatAt || metadata.lastHeartbeatAt || null;
      const integrationOk = metadata.integrationOk !== false;

      if (!heartbeatAt) {
        return { ok: false, reason: 'device_heartbeat_missing', evidence: { deviceId: normalizedDeviceId } };
      }

      if (!integrationOk) {
        return { ok: false, reason: 'device_integration_unhealthy', evidence: { deviceId: normalizedDeviceId } };
      }

      return {
        ok: true,
        evidence: {
          deviceId: normalizedDeviceId,
          heartbeatAt,
          integrationOk,
        },
      };
    },

    attendance_database_accessible: async () => {
      const result = await runScalarQuery('SELECT 1 AS ok FROM vertical_attendances LIMIT 1');
      if (!result.ok) return result;
      return { ok: true, evidence: { storage: 'vertical_attendances' } };
    },

    crm_service_available: async (_, context = {}) => {
      const external = await runHealthProbe(context, 'crm');
      if (external.ok) return external;

      const SubjectModel = getModel(AccessSubject);
      if (!SubjectModel || typeof SubjectModel.count !== 'function') {
        return { ok: false, reason: 'crm_model_unavailable' };
      }
      await SubjectModel.count({ limit: 1 });
      return { ok: true, evidence: { mode: 'db_probe' } };
    },

    database_writable: async () => {
      const result = await runScalarQuery('SHOW transaction_read_only');
      if (!result.ok) return result;
      const value = safeString(result.rows?.[0]?.transaction_read_only).toLowerCase();
      if (value === 'on' || value === 'true') {
        return { ok: false, reason: 'database_read_only' };
      }
      return { ok: true, evidence: { transactionReadOnly: value || 'off' } };
    },

    payment_gateway_available: async (_, context = {}) => {
      return runHealthProbe(context, 'payment_gateway');
    },

    subscription_exists: async ({ subscriptionId, tenantId } = {}, context = {}) => {
      const normalizedSubscriptionId = safeString(subscriptionId || context.subscriptionId);
      const normalizedTenantId = safeString(tenantId || context.tenantId);
      if (!normalizedSubscriptionId || !normalizedTenantId) {
        return { ok: false, reason: 'subscription_input_missing' };
      }

      const SubscriptionModel = getModel(BillingSubscription);
      if (!SubscriptionModel || typeof SubscriptionModel.findOne !== 'function') {
        return { ok: false, reason: 'subscription_model_unavailable' };
      }

      const row = await SubscriptionModel.findOne({
        where: {
          tenant_key: normalizedTenantId,
          id: normalizedSubscriptionId,
        },
      });

      if (!row) return { ok: false, reason: 'subscription_not_found' };
      return { ok: true, evidence: { subscriptionId: normalizedSubscriptionId } };
    },

    ledger_writable: async () => {
      const readOnly = await runScalarQuery('SHOW transaction_read_only');
      if (!readOnly.ok) return readOnly;

      const value = safeString(readOnly.rows?.[0]?.transaction_read_only).toLowerCase();
      if (value === 'on' || value === 'true') {
        return { ok: false, reason: 'ledger_read_only' };
      }

      const LedgerModel = getModel(EventLedger);
      if (!LedgerModel || typeof LedgerModel.count !== 'function') {
        return { ok: false, reason: 'ledger_model_unavailable' };
      }
      await LedgerModel.count({ limit: 1 });
      return { ok: true, evidence: { ledger: 'event_ledger' } };
    },

    access_service_available: async () => {
      const DecisionModel = getModel(AccessDecision);
      if (!DecisionModel || typeof DecisionModel.count !== 'function') {
        return { ok: false, reason: 'access_decision_model_unavailable' };
      }
      await DecisionModel.count({ limit: 1 });
      return { ok: true, evidence: { model: 'access_decisions' } };
    },

    device_connected: async ({ deviceId, tenantId } = {}, context = {}) => {
      const normalizedTenantId = safeString(tenantId || context.tenantId);
      const normalizedDeviceId = safeString(deviceId || context.deviceId);
      if (!normalizedTenantId || !normalizedDeviceId) {
        return { ok: false, reason: 'device_input_missing' };
      }

      const DeviceModel = getModel(AccessDevice);
      if (!DeviceModel || typeof DeviceModel.findOne !== 'function') {
        return { ok: false, reason: 'device_model_unavailable' };
      }

      const row = await DeviceModel.findOne({
        where: {
          tenant_key: normalizedTenantId,
          id: normalizedDeviceId,
          status: 'active',
        },
      });

      if (!row) return { ok: false, reason: 'device_not_found_or_inactive' };

      const metadata = row.metadata || {};
      const heartbeatAt = metadata.heartbeatAt || metadata.lastHeartbeatAt || null;
      if (!heartbeatAt) {
        return { ok: false, reason: 'device_heartbeat_missing', evidence: { deviceId: normalizedDeviceId } };
      }

      return {
        ok: true,
        evidence: {
          deviceId: normalizedDeviceId,
          heartbeatAt,
          integrationOk: metadata.integrationOk !== false,
        },
      };
    },

    release_mechanism_responsive: async (_, context = {}) => {
      return runHealthProbe(context, 'release_mechanism');
    },

    pbx_service_available: async (_, context = {}) => {
      const external = await runHealthProbe(context, 'pbx');
      if (external.ok) return external;

      const PbxTenantModel = getModel(PbxTenant);
      if (!PbxTenantModel || typeof PbxTenantModel.count !== 'function') {
        return { ok: false, reason: 'pbx_model_unavailable' };
      }
      await PbxTenantModel.count({ limit: 1 });
      return { ok: true, evidence: { mode: 'db_probe' } };
    },

    agent_available: async ({ agentId } = {}, context = {}) => {
      const normalizedTenantId = safeString(context.tenantId);
      const normalizedAgentId = safeString(agentId || context.agentId);
      const UserModel = getModel(User);
      if (!UserModel || typeof UserModel.findOne !== 'function') {
        return { ok: false, reason: 'user_model_unavailable' };
      }

      const where = { is_active: true };
      if (normalizedTenantId) where.tenant_key = normalizedTenantId;
      if (normalizedAgentId) where.id = normalizedAgentId;

      const row = await UserModel.findOne({ where });
      if (!row) return { ok: false, reason: 'no_active_agent_available' };
      return { ok: true, evidence: { agentId: row.id || normalizedAgentId || null } };
    },

    call_queue_writable: async () => {
      const readOnly = await runScalarQuery('SHOW transaction_read_only');
      if (!readOnly.ok) return readOnly;

      const value = safeString(readOnly.rows?.[0]?.transaction_read_only).toLowerCase();
      if (value === 'on' || value === 'true') {
        return { ok: false, reason: 'call_queue_read_only' };
      }

      const PbxQueueModel = getModel(PbxQueue);
      if (!PbxQueueModel || typeof PbxQueueModel.count !== 'function') {
        return { ok: false, reason: 'pbx_queue_model_unavailable' };
      }
      await PbxQueueModel.count({ limit: 1 });
      return { ok: true, evidence: { model: 'pbx_queues' } };
    },
  };

  const wrappedRegistry = {};
  for (const [probeName, probeFn] of Object.entries(registry)) {
    wrappedRegistry[probeName] = async (payload = {}, context = {}) => {
      try {
        return await probeFn(payload, context);
      } catch (error) {
        return {
          ok: false,
          reason: `${probeName}_error:${error.message}`,
          evidence: null,
        };
      }
    };
  }

  return wrappedRegistry;
}

function getDefaultPreflightProbes() {
  if (!cachedDefaultRegistry) {
    cachedDefaultRegistry = createPreflightProbeRegistry();
  }
  return cachedDefaultRegistry;
}

module.exports = {
  createPreflightProbeRegistry,
  getDefaultPreflightProbes,
};