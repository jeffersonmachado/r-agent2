const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');
const { getDefaultPreflightProbes } = require('./preflightProbeRegistry');

const PRECONDITIONS_CONFIG_PATH = path.join(__dirname, '../../../config/journey-preconditions.json');
const GENERATED_ROOT = path.join(__dirname, '../../../qa/qa-waves');

function loadPreconditionContracts() {
  try {
    if (fs.existsSync(PRECONDITIONS_CONFIG_PATH)) {
      const raw = fs.readFileSync(PRECONDITIONS_CONFIG_PATH, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    logger.warn(`[PreflightEngine] Falha ao carregar journey-preconditions.json: ${err.message}`);
  }
  return {};
}

const SYSTEM_PRECONDITIONS = {
  authenticated_agent: async (context = {}) => {
    const session = context.session || {};
    const token = context.authToken || context.token || null;
    const user = context.user || {};
    const probe = await runProbe(context, 'authenticated_agent', { token, user });

    if (probe.ok !== true) {
      return { ok: false, detail: probe.reason || 'authentication_probe_failed', evidence: probe.evidence || null };
    }

    const hasSession = Boolean(session.id || session.sessionId || probe.evidence?.sessionId);
    const hasToken = Boolean(token || probe.evidence?.token || probe.evidence?.jwt);
    const hasUser = Boolean(user.id || user.username || probe.evidence?.userId);
    return {
      ok: hasSession && hasToken && hasUser,
      detail: hasSession && hasToken && hasUser ? 'authenticated_agent_valid' : 'missing_session_token_or_user',
      evidence: { hasSession, hasToken, hasUser },
    };
  },
  tenant_loaded: async (context = {}) => {
    const tenantId = context.tenantId || context.tenantKey || null;
    const probe = await runProbe(context, 'tenant_loaded', { tenantId });
    const hasTenant = Boolean(tenantId || probe.evidence?.tenantId || probe.evidence?.tenantKey);
    return {
      ok: hasTenant && probe.ok === true,
      detail: hasTenant && probe.ok === true ? 'tenant_loaded' : (probe.reason || 'tenant_not_loaded'),
      evidence: { hasTenant },
    };
  },
  open_ticket_exists: async (context = {}) => {
    const ticketId = context.ticketId || null;
    const probe = await runProbe(context, 'open_ticket_exists', { ticketId, tenantId: context.tenantId });
    const ticket = probe.evidence?.ticket || context.ticket || {};
    const status = String(ticket.status || probe.evidence?.status || '').toLowerCase();
    const tenantMatch = !context.tenantId || String(ticket.tenantId || ticket.tenant_key || '').trim() === String(context.tenantId).trim();

    return {
      ok: probe.ok === true && Boolean(ticket.id || ticketId) && status !== 'closed' && tenantMatch,
      detail: probe.ok !== true ? (probe.reason || 'ticket_probe_failed') : 'open_ticket_exists',
      evidence: {
        ticketId: ticket.id || ticketId || null,
        ticketStatus: status || null,
        tenantMatch,
      },
    };
  },
  ticket_storage_accessible: async (context = {}) => {
    const probe = await runProbe(context, 'ticket_storage_accessible', {});
    return {
      ok: probe.ok === true,
      detail: probe.ok === true ? 'ticket_storage_accessible' : (probe.reason || 'ticket_storage_unreachable'),
      evidence: probe.evidence || null,
    };
  },
  crm_contact_exists: async (context = {}) => {
    const contactId = context.contactId || null;
    const probe = await runProbe(context, 'crm_contact_exists', { contactId, tenantId: context.tenantId });
    return {
      ok: probe.ok === true && Boolean(probe.evidence?.contactId || contactId),
      detail: probe.ok === true ? 'crm_contact_exists' : (probe.reason || 'crm_contact_missing'),
      evidence: probe.evidence || null,
    };
  },
  membership_exists: async (context = {}) => {
    const membershipId = context.membershipId || null;
    const probe = await runProbe(context, 'membership_exists', { membershipId, tenantId: context.tenantId });
    return {
      ok: probe.ok === true && Boolean(probe.evidence?.membershipId || membershipId),
      detail: probe.ok === true ? 'membership_exists' : (probe.reason || 'membership_missing'),
      evidence: probe.evidence || null,
    };
  },
  credential_exists: async (context = {}) => {
    const credentialId = context.credentialId || null;
    const probe = await runProbe(context, 'credential_exists', { credentialId, contactId: context.contactId });
    return {
      ok: probe.ok === true && Boolean(probe.evidence?.credentialId || credentialId),
      detail: probe.ok === true ? 'credential_exists' : (probe.reason || 'credential_missing'),
      evidence: probe.evidence || null,
    };
  },
  device_available: async (context = {}) => {
    const deviceId = context.deviceId || null;
    const probe = await runProbe(context, 'device_available', { deviceId, tenantId: context.tenantId });
    const heartbeatAt = probe.evidence?.heartbeatAt || probe.evidence?.lastHeartbeatAt || null;
    const integrationOk = probe.evidence?.integrationOk === true;
    return {
      ok: probe.ok === true && Boolean(deviceId || probe.evidence?.deviceId) && Boolean(heartbeatAt) && integrationOk,
      detail: probe.ok === true ? 'device_available' : (probe.reason || 'device_unavailable'),
      evidence: {
        deviceId: deviceId || probe.evidence?.deviceId || null,
        heartbeatAt,
        integrationOk,
      },
    };
  },
  attendance_database_accessible: async (context = {}) => {
    const probe = await runProbe(context, 'attendance_database_accessible', {});
    return {
      ok: probe.ok === true,
      detail: probe.ok === true ? 'attendance_database_accessible' : (probe.reason || 'attendance_database_unreachable'),
      evidence: probe.evidence || null,
    };
  },
  crm_service_available: async (context = {}) => {
    const probe = await runProbe(context, 'crm_service_available', {});
    return {
      ok: probe.ok === true,
      detail: probe.ok === true ? 'crm_service_available' : (probe.reason || 'crm_service_unavailable'),
      evidence: probe.evidence || null,
    };
  },
  database_writable: async (context = {}) => {
    const probe = await runProbe(context, 'database_writable', {});
    return {
      ok: probe.ok === true,
      detail: probe.ok === true ? 'database_writable' : (probe.reason || 'database_not_writable'),
      evidence: probe.evidence || null,
    };
  },
  payment_gateway_available: async (context = {}) => {
    const probe = await runProbe(context, 'payment_gateway_available', {});
    return {
      ok: probe.ok === true,
      detail: probe.ok === true ? 'payment_gateway_available' : (probe.reason || 'payment_gateway_unavailable'),
      evidence: probe.evidence || null,
    };
  },
  subscription_exists: async (context = {}) => {
    const subscriptionId = context.subscriptionId || null;
    const probe = await runProbe(context, 'subscription_exists', { subscriptionId, tenantId: context.tenantId });
    return {
      ok: probe.ok === true && Boolean(probe.evidence?.subscriptionId || subscriptionId),
      detail: probe.ok === true ? 'subscription_exists' : (probe.reason || 'subscription_missing'),
      evidence: probe.evidence || null,
    };
  },
  ledger_writable: async (context = {}) => {
    const probe = await runProbe(context, 'ledger_writable', {});
    return {
      ok: probe.ok === true,
      detail: probe.ok === true ? 'ledger_writable' : (probe.reason || 'ledger_not_writable'),
      evidence: probe.evidence || null,
    };
  },
  access_service_available: async (context = {}) => {
    const probe = await runProbe(context, 'access_service_available', {});
    return {
      ok: probe.ok === true,
      detail: probe.ok === true ? 'access_service_available' : (probe.reason || 'access_service_unavailable'),
      evidence: probe.evidence || null,
    };
  },
  device_connected: async (context = {}) => {
    const probe = await runProbe(context, 'device_connected', { deviceId: context.deviceId });
    return {
      ok: probe.ok === true && Boolean(context.deviceId || probe.evidence?.deviceId),
      detail: probe.ok === true ? 'device_connected' : (probe.reason || 'device_not_connected'),
      evidence: probe.evidence || null,
    };
  },
  release_mechanism_responsive: async (context = {}) => {
    const probe = await runProbe(context, 'release_mechanism_responsive', {});
    return {
      ok: probe.ok === true,
      detail: probe.ok === true ? 'release_mechanism_responsive' : (probe.reason || 'release_mechanism_unresponsive'),
      evidence: probe.evidence || null,
    };
  },
  pbx_service_available: async (context = {}) => {
    const probe = await runProbe(context, 'pbx_service_available', {});
    return {
      ok: probe.ok === true,
      detail: probe.ok === true ? 'pbx_service_available' : (probe.reason || 'pbx_service_unavailable'),
      evidence: probe.evidence || null,
    };
  },
  agent_available: async (context = {}) => {
    const probe = await runProbe(context, 'agent_available', { agentId: context.agentId });
    return {
      ok: probe.ok === true,
      detail: probe.ok === true ? 'agent_available' : (probe.reason || 'agent_unavailable'),
      evidence: probe.evidence || null,
    };
  },
  call_queue_writable: async (context = {}) => {
    const probe = await runProbe(context, 'call_queue_writable', {});
    return {
      ok: probe.ok === true,
      detail: probe.ok === true ? 'call_queue_writable' : (probe.reason || 'call_queue_not_writable'),
      evidence: probe.evidence || null,
    };
  },
};

async function runProbe(context = {}, probeName, payload = {}) {
  const defaultProbes = getDefaultPreflightProbes();
  const probe = context?.probes?.[probeName]
    || context?.preflightProbes?.[probeName]
    || defaultProbes?.[probeName];
  if (typeof probe !== 'function') {
    return { ok: false, reason: `probe_missing:${probeName}`, evidence: null };
  }
  try {
    const result = await probe(payload, context);
    if (!result || result.ok !== true) {
      return {
        ok: false,
        reason: result?.reason || `${probeName}_failed`,
        evidence: result?.evidence || result?.data || null,
      };
    }
    return {
      ok: true,
      reason: null,
      evidence: result.evidence || result.data || result,
    };
  } catch (err) {
    return { ok: false, reason: `${probeName}_error:${err.message}`, evidence: null };
  }
}

/**
 * Executa validação de pré-condições para uma jornada
 * @param {string} journeyId - ID da jornada
 * @param {object} context - contexto de execução (ticketId, contactId, etc)
 * @returns {object} { status: 'GO'|'NO_GO', results: [], missing: [] }
 */
async function validateJourneyPreconditions(journeyId, context = {}) {
  const contracts = loadPreconditionContracts();
  const contract = contracts[journeyId];

  if (!contract) {
    return {
      status: 'NO_GO',
      reason: 'PRECONDITION_CONTRACT_MISSING',
      message: `Nenhum contrato de pré-condições para jornada ${journeyId}`,
      results: [],
      missing: [{ name: journeyId, reason: 'missing_precondition_contract' }],
    };
  }

  const results = [];
  const missing = [];

  // Validar required preconditions
  for (const precondition of contract.required || []) {
    try {
      const validator = SYSTEM_PRECONDITIONS[precondition];
      if (!validator) {
        logger.warn(`[PreflightEngine] Precondição desconhecida: ${precondition}`);
        missing.push({ name: precondition, reason: 'unknown_precondition' });
        continue;
      }

      const result = await validator(context);
      results.push({ name: precondition, ok: result.ok, detail: result.detail, evidence: result.evidence || null });
      if (!result.ok) {
        missing.push({ name: precondition, reason: result.detail, evidence: result.evidence || null });
      }
    } catch (err) {
      logger.error(`[PreflightEngine] Erro ao validar ${precondition}: ${err.message}`);
      missing.push({ name: precondition, reason: err.message });
    }
  }

  // Validar optional preconditions (log apenas, não bloqueia)
  for (const precondition of contract.optional || []) {
    try {
      const validator = SYSTEM_PRECONDITIONS[precondition];
      if (validator) {
        const result = await validator(context);
        results.push({ name: precondition, ok: result.ok, optional: true });
      }
    } catch (err) {
      logger.debug(`[PreflightEngine] Precondição optional ${precondition} falhou: ${err.message}`);
    }
  }

  const status = missing.length === 0 ? 'GO' : 'NO_GO';
  return {
    status,
    reason: status === 'GO' ? null : 'PRECONDITION_FAILED',
    journeyId,
    contract,
    results,
    missing,
    timeout: contract.timeout,
  };
}

/**
 * Valida dados mínimos para execução
 * @param {object} data - dados a validar
 * @returns {object} { valid: boolean, errors: [] }
 */
function validateMinimalData(data = {}) {
  const errors = [];

  if (!data.waveId) errors.push('waveId obrigatório');
  if (!data.journeyId) errors.push('journeyId obrigatório');
  if (!data.tenantId) errors.push('tenantId obrigatório');
  if (!data.scenarioIds || !Array.isArray(data.scenarioIds) || data.scenarioIds.length === 0) {
    errors.push('scenarioIds obrigatório (array não-vazio)');
  }
  if (!data.capabilityIds || !Array.isArray(data.capabilityIds) || data.capabilityIds.length === 0) {
    errors.push('capabilityIds obrigatório (array não-vazio)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Valida estado mínimo do sistema para execução
 * @returns {object} { ready: boolean, issues: [] }
 */
async function validateSystemReadiness() {
  const issues = [];

  const requiredDirs = [
    GENERATED_ROOT,
    path.join(GENERATED_ROOT, 'generated-seeds'),
    path.join(GENERATED_ROOT, 'generated-validators'),
    path.join(GENERATED_ROOT, 'generated-ui-steps'),
  ];

  for (const dirPath of requiredDirs) {
    try {
      fs.mkdirSync(dirPath, { recursive: true });
      fs.accessSync(dirPath, fs.constants.W_OK);
    } catch (err) {
      issues.push(`artifact_dir_unwritable:${dirPath}:${err.message}`);
    }
  }

  return {
    ready: issues.length === 0,
    issues,
  };
}

/**
 * Executa preflight completo para uma onda
 * @param {object} waveSpec - especificação da onda { waveId, scenarioIds, context }
 * @returns {object} { status: 'GO'|'NO_GO', validation, blockingIssues: [] }
 */
async function executeFullPreflight(waveSpec = {}) {
  const missing = [];

  // 1. Validar dados mínimos
  const dataValidation = validateMinimalData(waveSpec);
  if (!dataValidation.valid) {
    return {
      status: 'NO_GO',
      reason: 'PRECONDITION_FAILED',
      validation: dataValidation,
      blockingIssues: dataValidation.errors,
      missing: dataValidation.errors.map((item) => ({ name: 'input', reason: item })),
    };
  }

  // 2. Validar estado do sistema
  const systemReadiness = await validateSystemReadiness();
  if (!systemReadiness.ready) {
    return {
      status: 'NO_GO',
      reason: 'PRECONDITION_FAILED',
      validation: systemReadiness,
      blockingIssues: systemReadiness.issues,
      missing: systemReadiness.issues.map((item) => ({ name: 'system_readiness', reason: item })),
    };
  }

  // 3. Validar pré-condições por jornada real
  const journeyId = waveSpec.journeyId;
  const journeyValidation = await validateJourneyPreconditions(journeyId, waveSpec.context || {});
  if (journeyValidation.status === 'NO_GO') {
    missing.push(...(journeyValidation.missing || []));
  }

  const status = missing.length === 0 ? 'GO' : 'NO_GO';
  return {
    status,
    reason: status === 'GO' ? null : 'PRECONDITION_FAILED',
    waveId: waveSpec.waveId,
    journeyId,
    scenarioIds: waveSpec.scenarioIds,
    capabilityIds: waveSpec.capabilityIds,
    tenantId: waveSpec.tenantId,
    dataValidation,
    systemReadiness,
    journeyValidation,
    blockingIssues: missing,
    missing,
  };
}

module.exports = {
  validateJourneyPreconditions,
  validateMinimalData,
  validateSystemReadiness,
  executeFullPreflight,
  loadPreconditionContracts,
};
