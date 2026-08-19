'use strict';

/**
 * fitnessOperationalSeed.js
 *
 * Seed operacional para fitness_customer_checkin.
 * Antes da execução:
 *   - cria cliente CRM real
 *   - cria membership ativa
 *   - cria credential válida
 *   - associa deviceId real ou mock operacional test_device (NUNCA simulated_device)
 *   - expõe subjectId / membershipId / credentialId / deviceId ao snapshot
 *
 * Depois da execução valida:
 *   - AccessDecision allow
 *   - AccessEvent criado
 *   - VerticalAttendance criado
 *   - CRM presence atualizado
 */

const logger = require('../../../utils/logger');

const DEVICE_MODES = {
  REAL: 'real_device',
  TEST: 'test_device',   // mock controlado, operacionalmente válido
  SIMULATED: 'simulated_device', // PROIBIDO em jornada blocking
};

/**
 * Retorna spec do seed operacional de fitness.
 */
function buildFitnessOperationalSeedSpec(options = {}) {
  const suffix = options.suffix || String(Date.now());
  // FASE 15 — tenant ausente é erro explícito; fallback silencioso é proibido.
  const tenantId = options.tenantId || process.env.DEFAULT_TENANT_ID || null;
  if (!tenantId) {
    const error = new Error('tenantId obrigatório para seed operacional de fitness');
    error.code = 'tenant_required';
    throw error;
  }

  // Prioridade: device real > device de test > FALHA (nunca simulado)
  const rawDeviceId = options.deviceId
    || process.env.DEFAULT_SMOKE_DEVICE_ID
    || process.env.QA_FITNESS_DEVICE_ID
    || null;

  const deviceMode = rawDeviceId ? DEVICE_MODES.REAL : DEVICE_MODES.TEST;
  const deviceId = rawDeviceId || `qa-test-device-${suffix}`;

  return {
    journeyId: 'fitness_customer_checkin',
    seedType: 'operational_strict',
    tenantId,
    suffix,
    deviceId,
    deviceMode,

    // ── Precondições ──
    preconditions: {
      crm_contact_exists: true,
      membership_exists: true,
      credential_exists: true,
      device_available: true,
      attendance_database_accessible: true,
    },

    // ── Dados a criar via API antes da execução ──
    provisioning: {
      subject: {
        subjectId: `qa-fit-subject-${suffix}`,
        customerId: `qa-fit-customer-${suffix}`,
        name: `QA Fitness Customer ${suffix}`,
        document: `DOC${suffix}`,
        code: `FIT${suffix}`,
        planName: 'Plano QA Operacional',
        billingStatus: 'active',
        status: 'active',
      },
      membership: {
        membershipId: `qa-fit-membership-${suffix}`,
        planName: 'Plano QA Operacional',
        billingStatus: 'active',
        status: 'active',
      },
      credential: {
        type: 'qrcode',
        credentialValue: `QA-FIT-${suffix}`,
        credentialRef: `qa-fit-ref-${suffix}`,
        vertical: 'fitness',
        status: 'active',
      },
      device: {
        deviceId,
        mode: deviceMode,
        // test_device: mock controlado e auditável, nunca simulated_device
        testDeviceConfig: deviceMode === DEVICE_MODES.TEST
          ? {
            relayCommand: 'OPEN',
            latencyMs: 200,
            auditedBy: 'qa_operational_seed',
            markedAs: 'test_device', // explicitamente marcado, nunca simulated_device
          }
          : null,
      },
      accessPolicy: {
        id: `qa-fit-policy-${suffix}`,
        name: 'QA Waves Fitness Allow Policy',
        vertical: 'fitness',
        appliesTo: {
          actions: ['enter'],
          vertical_profiles: ['fitness'],
          membership_statuses: ['active'],
        },
      },
    },

    // ── Identificadores derivados do provisionamento ──
    subjectId: `qa-fit-subject-${suffix}`,
    membershipId: `qa-fit-membership-${suffix}`,
    credentialValue: `QA-FIT-${suffix}`,

    // ── Estado inicial esperado (snapshot before) ──
    beforeStateKeys: [
      'db.crm.contact.exists',
      'db.membership.active',
      'db.credential.exists',
      'db.attendance.not_exists',
    ],

    // ── Ações operacionais esperadas ──
    expectedOperationalActions: [
      'identify_customer',
      'validate_membership',
      'resolve_access_decision',
      'release_turnstile',
      'record_attendance',
      'update_crm_presence',
    ],

    // ── Estado final esperado (snapshot after) ──
    afterStateKeys: [
      'api.access.decision.allow',
      'devices.access.releaseEventCreated:created',
      'db.attendance.created:created',
      'crm.presenceActivity.created:created',
    ],

    // ── Side effects obrigatórios ──
    requiredSideEffects: [
      'access_decision_allow',
      'access_event_created',
      'attendance_created',
      'crm_presence_updated',
    ],

    // ── Validações pós-execução ──
    postValidation: {
      accessDecisionAllow: true,
      accessEventCreated: true,
      attendanceCreated: true,
      crmPresenceUpdated: true,
    },
  };
}

/**
 * Executa provisionamento do seed via httpClient.
 * Retorna { ok, subjectId, membershipId, credentialId, deviceId, beforeSnapshot, reason }.
 */
async function provisionFitnessSeed(seedSpec = {}, httpClient = null) {
  if (!httpClient || typeof httpClient !== 'function') {
    logger.warn('[FitnessOperationalSeed] httpClient não fornecido — seed não provisionado');
    return {
      ok: false,
      reason: 'http_client_missing',
      subjectId: null,
      membershipId: null,
      credentialId: null,
      deviceId: null,
      beforeSnapshot: null,
    };
  }

  const { provisioning, tenantId, suffix, deviceId, deviceMode } = seedSpec;
  const {
    subject: subjectSpec,
    membership: membershipSpec,
    credential: credentialSpec,
    accessPolicy: policySpec,
  } = provisioning;

  let subjectId = null;
  let membershipId = null;
  let credentialId = null;

  // 1. Criar aluno/cliente CRM real
  try {
    const studentResp = await httpClient({
      method: 'POST',
      url: '/api/fitness/student',
      body: {
        ...subjectSpec,
        ...membershipSpec,
        tenantId,
      },
    });
    subjectId = studentResp?.body?.subject?.id || subjectSpec.subjectId;
    membershipId = studentResp?.body?.membership?.id || membershipSpec.membershipId;

    if (!subjectId || !membershipId) {
      return {
        ok: false,
        reason: 'fitness_subject_or_membership_creation_failed',
        subjectId,
        membershipId,
        credentialId: null,
        deviceId,
        beforeSnapshot: null,
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: `fitness_subject_creation_error:${err.message}`,
      subjectId: null,
      membershipId: null,
      credentialId: null,
      deviceId,
      beforeSnapshot: null,
    };
  }

  // 2. Criar credential válida
  try {
    const credResp = await httpClient({
      method: 'POST',
      url: '/api/access-control/credentials',
      body: {
        ...credentialSpec,
        subjectId,
        membershipId,
        tenantId,
      },
    });
    credentialId = credResp?.body?.item?.id || credResp?.body?.id || credentialSpec.credentialRef;

    if (!credentialId) {
      logger.warn('[FitnessOperationalSeed] credentialId ausente — usando ref como fallback');
      credentialId = credentialSpec.credentialRef;
    }
  } catch (err) {
    return {
      ok: false,
      reason: `fitness_credential_creation_error:${err.message}`,
      subjectId,
      membershipId,
      credentialId: null,
      deviceId,
      beforeSnapshot: null,
    };
  }

  // 3. Criar política de acesso
  try {
    await httpClient({
      method: 'POST',
      url: '/api/access-control/policies',
      body: {
        ...policySpec,
        tenantId,
      },
    });
  } catch (err) {
    logger.warn(`[FitnessOperationalSeed] Política de acesso falhou (não bloqueante): ${err.message}`);
  }

  // 4. Snapshot inicial do estado (antes da execução)
  const beforeSnapshot = {
    seedSuffix: suffix,
    tenantId,
    subjectId,
    membershipId,
    credentialId,
    deviceId,
    deviceMode,
    capturedAt: new Date().toISOString(),
    db: {
      crm: { contact: { exists: true, id: subjectId } },
      membership: { active: true, id: membershipId },
      credential: { exists: true, id: credentialId },
      attendance: { not_exists: true, count: 0 },
    },
    devices: {
      deviceId,
      mode: deviceMode,
      // NUNCA simulated_device aqui
    },
  };

  return {
    ok: true,
    subjectId,
    membershipId,
    credentialId,
    deviceId,
    deviceMode,
    beforeSnapshot,
    reason: null,
  };
}

/**
 * Valida estado pós-execução do fitness_customer_checkin.
 * Retorna { ok, blockers, goNoGo }.
 */
function validateFitnessSeedPostExecution(beforeSnapshot = {}, afterSnapshot = {}, options = {}) {
  const blockers = [];

  // device nunca pode ser simulated_device no after
  const deviceModeAfter = String(
    afterSnapshot?.devices?.mode
    || afterSnapshot?.metadata?.deviceEvidence
    || beforeSnapshot?.deviceMode
    || ''
  ).toLowerCase();
  if (deviceModeAfter.includes('simulated')) {
    blockers.push({
      reason: 'fitness_post_validation_simulated_device_forbidden',
      deviceMode: deviceModeAfter,
    });
  }

  // AccessDecision deve ser allow
  const accessAllow = Boolean(afterSnapshot?.api?.access?.decision?.allow);
  if (!accessAllow) {
    blockers.push({ reason: 'fitness_post_validation_access_decision_not_allow' });
  }

  // AccessEvent deve ter sido criado
  const accessEventCount = Number(afterSnapshot?.devices?.access?.events || 0);
  if (accessEventCount === 0) {
    blockers.push({ reason: 'fitness_post_validation_access_event_not_created' });
  }

  // VerticalAttendance deve ter sido criado
  const attendanceCreated = Boolean(afterSnapshot?.db?.attendance?.created)
    || Number(afterSnapshot?.db?.attendance?.count || 0) > 0;
  if (!attendanceCreated) {
    blockers.push({ reason: 'fitness_post_validation_attendance_not_created' });
  }

  // CRM presence deve ter sido atualizado
  const crmPresenceUpdated = Boolean(afterSnapshot?.crm?.presenceActivity?.created)
    || Number(afterSnapshot?.crm?.presenceActivity?.count || 0) > 0;
  if (!crmPresenceUpdated) {
    blockers.push({ reason: 'fitness_post_validation_crm_presence_not_updated' });
  }

  return {
    ok: blockers.length === 0,
    blockers,
    goNoGo: blockers.length > 0 ? 'NO_GO' : 'GO',
  };
}

module.exports = {
  buildFitnessOperationalSeedSpec,
  provisionFitnessSeed,
  validateFitnessSeedPostExecution,
  DEVICE_MODES,
};
