const repository = require('./accessControlRepository');
const controlService = require('./accessControlService');
const { resolveSubjectContext } = require('./accessProfileAdapter');
const { REASON_CODES } = require('./constants');
const { makeId, hashCredential, signPayload, minutesFromTimeString, weekdayToken } = require('./utils');
const { verifyBiometricRef } = require('../../services/biometricService');
const { evaluateAntiPassback } = require('./anti-passback/antiPassbackService');
const visitorQrService = require('./visitor-access/visitorQrService');

function allowedByBillingStatus(status) {
  if (status === 'active') return { allowed: true, reasonCode: REASON_CODES.ALLOWED_ACTIVE };
  if (status === 'grace_period') return { allowed: true, reasonCode: REASON_CODES.ALLOWED_GRACE_PERIOD };
  if (status === 'trial') return { allowed: true, reasonCode: REASON_CODES.ALLOWED_TRIAL };
  if (status === 'visitor') return { allowed: true, reasonCode: REASON_CODES.ALLOWED_VISITOR };
  if (status === 'delinquent') return { allowed: false, reasonCode: REASON_CODES.DENY_BILLING_DELINQUENT };
  if (status === 'blocked') return { allowed: false, reasonCode: REASON_CODES.DENY_BILLING_BLOCKED };
  if (status === 'cancelled') return { allowed: false, reasonCode: REASON_CODES.DENY_BILLING_CANCELLED };
  return { allowed: false, reasonCode: REASON_CODES.DENY_MEMBERSHIP_INACTIVE };
}

function matchesPolicy({ policy, subject, membership, device, action }) {
  if (!policy) return false;
  const appliesTo = policy.applies_to || {};
  if (appliesTo.actions && Array.isArray(appliesTo.actions) && appliesTo.actions.length > 0) {
    if (!appliesTo.actions.includes(action)) return false;
  }
  if (appliesTo.vertical_profiles && Array.isArray(appliesTo.vertical_profiles) && appliesTo.vertical_profiles.length > 0) {
    if (!appliesTo.vertical_profiles.includes(subject?.vertical_profile)) return false;
  }
  if (appliesTo.membership_statuses && Array.isArray(appliesTo.membership_statuses) && appliesTo.membership_statuses.length > 0) {
    if (!appliesTo.membership_statuses.includes(membership?.billing_status)) return false;
  }
  if (appliesTo.device_types && Array.isArray(appliesTo.device_types) && appliesTo.device_types.length > 0) {
    if (!appliesTo.device_types.includes(device?.type)) return false;
  }
  return true;
}

function validateTimeWindow(policy, now = new Date()) {
  const allowedDays = Array.isArray(policy?.days_allowed) ? policy.days_allowed : [];
  if (allowedDays.length > 0 && !allowedDays.includes(weekdayToken(now))) {
    return { allowed: false, reasonCode: REASON_CODES.DENY_OUTSIDE_ALLOWED_HOURS };
  }

  const startMinutes = minutesFromTimeString(policy?.time_start || null);
  const endMinutes = minutesFromTimeString(policy?.time_end || null);
  if (startMinutes === null || endMinutes === null) return { allowed: true };

  const nowMinutes = (now.getHours() * 60) + now.getMinutes();
  if (nowMinutes < startMinutes || nowMinutes > endMinutes) {
    return { allowed: false, reasonCode: REASON_CODES.DENY_OUTSIDE_ALLOWED_HOURS };
  }
  return { allowed: true };
}

function validateUnitScope(policy, membership, device) {
  const deviceUnit = device?.unit_id || device?.location || null;
  const policyUnits = Array.isArray(policy?.unit_scope) ? policy.unit_scope : [];
  const membershipUnits = Array.isArray(membership?.unit_scope) ? membership.unit_scope : [];
  if (policyUnits.length > 0 && deviceUnit && !policyUnits.includes(deviceUnit)) {
    return { allowed: false, reasonCode: REASON_CODES.DENY_WRONG_UNIT };
  }
  if (membershipUnits.length > 0 && deviceUnit && !membershipUnits.includes(deviceUnit)) {
    return { allowed: false, reasonCode: REASON_CODES.DENY_WRONG_UNIT };
  }
  return { allowed: true };
}

async function validateUsageLimit({ tenantId, subjectId, policy }) {
  if (!policy?.max_entries_per_day || !subjectId) return { allowed: true };
  const today = new Date().toISOString().slice(0, 10);
  const events = await repository.listEvents({
    tenantId,
    where: { subject_id: String(subjectId), direction: 'in' },
    order: [['occurred_at', 'DESC']],
    limit: 500,
  });
  const todayEntries = events.filter((event) => String(event.occurred_at || '').slice(0, 10) === today);
  if (todayEntries.length >= Number(policy.max_entries_per_day)) {
    return { allowed: false, reasonCode: REASON_CODES.DENY_USAGE_LIMIT };
  }
  return { allowed: true };
}

async function emitDecisionAndEvent({
  tenantId,
  subjectId = null,
  deviceId = null,
  credentialId = null,
  action = 'enter',
  decision,
  reasonCode,
  reasonDetail = null,
  metadata = {},
  direction = null,
}) {
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + (metadata.decisionTtlSec ? Number(metadata.decisionTtlSec) * 1000 : 120000));
  const signed = signPayload({
    v: 1,
    tenantId,
    subjectId,
    deviceId,
    credentialId,
    action,
    decision,
    reasonCode,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  const savedDecision = await repository.createDecision({
    id: makeId('acdcn'),
    tenant_key: tenantId,
    subject_id: subjectId,
    device_id: deviceId,
    credential_id: credentialId,
    action,
    decision,
    reason_code: reasonCode,
    reason_detail: reasonDetail,
    issued_at: issuedAt,
    expires_at: expiresAt,
    signature: signed,
    metadata,
  });

  const savedEvent = await controlService.createEvent({
    tenantId,
    payload: {
      device_id: deviceId,
      subject_id: subjectId,
      credential_id: credentialId,
      decision_id: savedDecision.id,
      event_type: decision === 'allow' ? 'decision_issued' : 'deny',
      direction,
      reason_code: reasonCode,
      occurred_at: issuedAt,
      raw_payload: {
        action,
        decision,
      },
      metadata,
    },
  });

  return {
    decision: savedDecision,
    event: savedEvent,
    token: signed,
  };
}

async function resolveCredential({ tenantId, credentialValue, credentialRef, biometricRef }) {
  let credential = null;
  if (credentialValue) {
    credential = await repository.findCredential({ tenantId, where: { credential_hash: hashCredential(credentialValue) } });
  }
  if (!credential && credentialRef) {
    credential = await repository.findCredential({ tenantId, where: { credential_ref: String(credentialRef) } });
  }
  if (!credential && biometricRef) {
    credential = await repository.findCredential({ tenantId, where: { credential_ref: String(biometricRef), type: 'biometric' } });
  }
  return credential;
}

function normalizeBiometricSubjectId(subjectId) {
  const raw = String(subjectId || '');
  if (!raw) return { raw: null, customerId: null };
  if (raw.startsWith('cust:')) {
    return { raw, customerId: raw.slice('cust:'.length) };
  }
  return { raw, customerId: raw };
}

async function resolveDecision({
  tenantId,
  action = 'enter',
  deviceId = null,
  credentialValue = null,
  credentialRef = null,
  credentialId = null,
  subjectId = null,
  customerId = null,
  membershipId = null,
  vertical = 'fitness',
  biometricRef = null,
  rawPayload = {},
}) {
  let biometricIdentity = null;
  if (biometricRef && rawPayload.biometric_secret && rawPayload.expected_token_id) {
    const verified = verifyBiometricRef({
      secret: rawPayload.biometric_secret,
      ref: biometricRef,
      expectedTokenId: rawPayload.expected_token_id,
      expectedLocationId: rawPayload.expected_location_id || null,
      allowedModes: ['identify-1n', 'verify-1to1', 'dedupe-only'],
      maxAgeSec: Number(rawPayload.biometric_max_age_sec) || 180,
    });
    biometricIdentity = normalizeBiometricSubjectId(verified.subjectId);
  }

  const device = deviceId
    ? await repository.findDevice({ tenantId, where: { id: String(deviceId) } })
    : null;
  if (device && device.status !== 'active') {
    return emitDecisionAndEvent({
      tenantId,
      deviceId,
      action,
      decision: 'deny',
      reasonCode: REASON_CODES.DENY_DEVICE_INACTIVE,
      metadata: { rawPayload, vertical },
      direction: action === 'enter' ? 'in' : 'out',
    });
  }

  let credential = credentialId
    ? await repository.findCredential({ tenantId, where: { id: String(credentialId) } })
    : null;
  if (!credential) {
    credential = await resolveCredential({ tenantId, credentialValue, credentialRef, biometricRef });
  }
  if (!credential && biometricIdentity?.customerId) {
    credential = await repository.findCredential({
      tenantId,
      where: {
        type: 'biometric',
        credential_ref: biometricIdentity.raw,
      },
    });
  }
  if (!credential) {
    return emitDecisionAndEvent({
      tenantId,
      deviceId,
      action,
      decision: 'deny',
      reasonCode: REASON_CODES.DENY_CREDENTIAL_NOT_FOUND,
      metadata: { rawPayload, vertical },
      direction: action === 'enter' ? 'in' : 'out',
    });
  }
  if (credential.status !== 'active') {
    return emitDecisionAndEvent({
      tenantId,
      deviceId,
      credentialId: credential.id,
      subjectId: credential.subject_id,
      action,
      decision: 'deny',
      reasonCode: REASON_CODES.DENY_CREDENTIAL_INACTIVE,
      metadata: { rawPayload, vertical },
      direction: action === 'enter' ? 'in' : 'out',
    });
  }
  if (credential.expires_at && new Date(credential.expires_at).getTime() <= Date.now()) {
    return emitDecisionAndEvent({
      tenantId,
      deviceId,
      credentialId: credential.id,
      subjectId: credential.subject_id,
      action,
      decision: 'deny',
      reasonCode: REASON_CODES.DENY_CREDENTIAL_EXPIRED,
      metadata: { rawPayload, vertical },
      direction: action === 'enter' ? 'in' : 'out',
    });
  }

  const context = await resolveSubjectContext({
    tenantId,
    subjectId: subjectId || credential.subject_id,
    customerId: customerId || biometricIdentity?.customerId || null,
    membershipId,
    vertical,
  });

  if (!context.subject) {
    return emitDecisionAndEvent({
      tenantId,
      deviceId,
      credentialId: credential.id,
      action,
      decision: 'deny',
      reasonCode: REASON_CODES.DENY_SUBJECT_NOT_FOUND,
      metadata: { rawPayload, vertical },
      direction: action === 'enter' ? 'in' : 'out',
    });
  }
  if (context.subject.status !== 'active') {
    return emitDecisionAndEvent({
      tenantId,
      deviceId,
      credentialId: credential.id,
      subjectId: context.subject.id,
      action,
      decision: 'deny',
      reasonCode: REASON_CODES.DENY_SUBJECT_INACTIVE,
      metadata: { rawPayload, vertical },
      direction: action === 'enter' ? 'in' : 'out',
    });
  }

  const policies = await repository.listPolicies({ tenantId, order: [['created_at', 'ASC']], limit: 500 });
  const selectedPolicy = policies.find((policy) => matchesPolicy({
    policy,
    subject: context.subject,
    membership: context.membership,
    device,
    action,
  })) || null;

  if (!selectedPolicy && vertical !== 'beauty') {
    return emitDecisionAndEvent({
      tenantId,
      deviceId,
      credentialId: credential.id,
      subjectId: context.subject.id,
      action,
      decision: 'deny',
      reasonCode: REASON_CODES.DENY_POLICY_NOT_FOUND,
      metadata: { rawPayload, vertical },
      direction: action === 'enter' ? 'in' : 'out',
    });
  }

  if (vertical === 'beauty') {
    if (!context.activeSchedule) {
      return emitDecisionAndEvent({
        tenantId,
        deviceId,
        credentialId: credential.id,
        subjectId: context.subject.id,
        action,
        decision: 'deny',
        reasonCode: REASON_CODES.DENY_SCHEDULE_NOT_FOUND,
        metadata: { rawPayload, vertical },
        direction: action === 'enter' ? 'in' : 'out',
      });
    }
    const now = Date.now();
    const start = new Date(context.activeSchedule.startAt).getTime();
    const end = new Date(context.activeSchedule.endAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || now < start || now > end) {
      return emitDecisionAndEvent({
        tenantId,
        deviceId,
        credentialId: credential.id,
        subjectId: context.subject.id,
        action,
        decision: 'deny',
        reasonCode: REASON_CODES.DENY_OUTSIDE_SCHEDULE_WINDOW,
        metadata: { rawPayload, vertical, scheduleId: context.activeSchedule.id },
        direction: action === 'enter' ? 'in' : 'out',
      });
    }

    // Beauty advanced policy rules (room/resource/professional restriction, appointment window)
    if (selectedPolicy) {
      const { validateBeautyPolicyRules } = require('../../services/vertical/beautyPolicyRules');
      const beautyCheck = validateBeautyPolicyRules({
        policy: selectedPolicy,
        subject: context.subject,
        membership: context.membership,
        roomId: rawPayload.room_id || null,
        resourceId: rawPayload.resource_id || null,
        professionalId: rawPayload.professional_id || null,
        activeSchedule: context.activeSchedule,
      });
      if (!beautyCheck.allowed) {
        return emitDecisionAndEvent({
          tenantId,
          deviceId,
          credentialId: credential.id,
          subjectId: context.subject.id,
          action,
          decision: 'deny',
          reasonCode: beautyCheck.reasonCode,
          metadata: { rawPayload, vertical, policyId: selectedPolicy.id, beautyReason: beautyCheck.reasonDetail },
          direction: action === 'enter' ? 'in' : 'out',
        });
      }
    }
  }

  if (context.membership) {
    if (context.membership.status !== 'active') {
      return emitDecisionAndEvent({
        tenantId,
        deviceId,
        credentialId: credential.id,
        subjectId: context.subject.id,
        action,
        decision: 'deny',
        reasonCode: REASON_CODES.DENY_MEMBERSHIP_INACTIVE,
        metadata: { rawPayload, vertical },
        direction: action === 'enter' ? 'in' : 'out',
      });
    }
    const billingEvaluation = allowedByBillingStatus(context.membership.billing_status);
    if (!billingEvaluation.allowed) {
      return emitDecisionAndEvent({
        tenantId,
        deviceId,
        credentialId: credential.id,
        subjectId: context.subject.id,
        action,
        decision: 'deny',
        reasonCode: billingEvaluation.reasonCode,
        metadata: { rawPayload, vertical, membershipId: context.membership.id },
        direction: action === 'enter' ? 'in' : 'out',
      });
    }
  } else if (vertical === 'fitness') {
    return emitDecisionAndEvent({
      tenantId,
      deviceId,
      credentialId: credential.id,
      subjectId: context.subject.id,
      action,
      decision: 'deny',
      reasonCode: REASON_CODES.DENY_MEMBERSHIP_NOT_FOUND,
      metadata: { rawPayload, vertical },
      direction: action === 'enter' ? 'in' : 'out',
    });
  }

  if (selectedPolicy) {
    const timeCheck = validateTimeWindow(selectedPolicy);
    if (!timeCheck.allowed) {
      return emitDecisionAndEvent({
        tenantId,
        deviceId,
        credentialId: credential.id,
        subjectId: context.subject.id,
        action,
        decision: 'deny',
        reasonCode: timeCheck.reasonCode,
        metadata: { rawPayload, vertical, policyId: selectedPolicy.id },
        direction: action === 'enter' ? 'in' : 'out',
      });
    }

    const unitCheck = validateUnitScope(selectedPolicy, context.membership, device);
    if (!unitCheck.allowed) {
      return emitDecisionAndEvent({
        tenantId,
        deviceId,
        credentialId: credential.id,
        subjectId: context.subject.id,
        action,
        decision: 'deny',
        reasonCode: unitCheck.reasonCode,
        metadata: { rawPayload, vertical, policyId: selectedPolicy.id },
        direction: action === 'enter' ? 'in' : 'out',
      });
    }

    const antiPassbackCheck = await evaluateAntiPassback({
      tenantId,
      subjectId: context.subject.id,
      action,
      policy: selectedPolicy,
    });
    if (!antiPassbackCheck.allowed) {
      return emitDecisionAndEvent({
        tenantId,
        deviceId,
        credentialId: credential.id,
        subjectId: context.subject.id,
        action,
        decision: 'deny',
        reasonCode: antiPassbackCheck.reasonCode,
        metadata: { rawPayload, vertical, policyId: selectedPolicy.id },
        direction: action === 'enter' ? 'in' : 'out',
      });
    }

    const usageCheck = await validateUsageLimit({
      tenantId,
      subjectId: context.subject.id,
      policy: selectedPolicy,
    });
    if (!usageCheck.allowed) {
      return emitDecisionAndEvent({
        tenantId,
        deviceId,
        credentialId: credential.id,
        subjectId: context.subject.id,
        action,
        decision: 'deny',
        reasonCode: usageCheck.reasonCode,
        metadata: { rawPayload, vertical, policyId: selectedPolicy.id },
        direction: action === 'enter' ? 'in' : 'out',
      });
    }
  }

  const allowedReason = context.membership
    ? allowedByBillingStatus(context.membership.billing_status).reasonCode
    : REASON_CODES.ALLOWED_VISITOR;

  const finalResult = await emitDecisionAndEvent({
    tenantId,
    subjectId: context.subject.id,
    deviceId,
    credentialId: credential.id,
    action,
    decision: 'allow',
    reasonCode: allowedReason,
    metadata: {
      rawPayload,
      vertical,
      membershipId: context.membership?.id || null,
      policyId: selectedPolicy?.id || null,
      scheduleId: context.activeSchedule?.id || null,
      decisionTtlSec: vertical === 'beauty' ? 300 : 120,
    },
    direction: action === 'enter' ? 'in' : 'out',
  });

  // Auto-trigger fitness check-in/out (fire-and-forget, non-blocking)
  if (vertical === 'fitness' && finalResult.decision) {
    setImmediate(() => {
      try {
        const fitnessAttendanceService = require('../../services/vertical/fitnessAttendanceService');
        if (action === 'enter') {
          fitnessAttendanceService.recordCheckIn({
            tenantId,
            subjectId: context.subject.id,
            membershipId: context.membership?.id || null,
            accessDecisionId: finalResult.decision.id,
            deviceId: deviceId || null,
            unitId: device?.unit_id || device?.location || null,
            metadata: { correlationId: finalResult.decision.id, auto: true },
          }).catch(() => {/* best-effort */});
        } else if (action === 'exit' || action === 'leave') {
          fitnessAttendanceService.recordCheckOut({
            tenantId,
            subjectId: context.subject.id,
            metadata: { correlationId: finalResult.decision.id, auto: true },
          }).catch(() => {/* best-effort */});
        }
      } catch (_e) {/* best-effort */}
    });
  }

  return finalResult;
}

async function issueVisitorQr({ tenantId, payload = {} }) {
  return visitorQrService.issueVisitorQr({ tenantId, payload });
}

async function resolveQrToken({ tenantId, token, deviceId = null, action = 'enter' }) {
  return visitorQrService.resolveVisitorQrToken({
    tenantId,
    token,
    deviceId,
    action,
    resolveDecision,
  });
}

module.exports = {
  resolveDecision,
  issueVisitorQr,
  resolveQrToken,
};
