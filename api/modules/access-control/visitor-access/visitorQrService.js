const controlService = require('../accessControlService');
const { REASON_CODES } = require('../constants');
const { makeId, signPayload, verifySignedPayload, nowIso, buildPseudoQrSvg } = require('../utils');

async function issueVisitorQr({
  tenantId,
  payload = {},
}) {
  const subject = await controlService.ensureSubject({
    tenantId,
    subjectId: payload.subject_id || payload.subjectId || null,
    customerId: payload.customer_id || payload.customerId || null,
    verticalProfile: payload.vertical || 'fitness',
    metadata: {
      ...(payload.subject_metadata || {}),
      visitor: true,
    },
  });

  const membershipId = payload.membership_id || payload.membershipId || makeId('acmvis');
  await controlService.upsertMembership({
    tenantId,
    subjectId: subject.id,
    membershipId,
    vertical: payload.vertical || 'fitness',
    customerId: payload.customer_id || payload.customerId || null,
    planName: payload.plan_name || 'visitor',
    billingStatus: 'visitor',
    status: 'active',
    unitScope: payload.unit_scope || payload.unitScope || [],
    metadata: {
      visitorName: payload.name || null,
      visitorDocument: payload.document || null,
      validUntil: payload.expires_at || payload.expiresAt || null,
      scheduleContextType: payload.vertical === 'beauty' ? 'beauty_access' : null,
    },
  });

  const rawCode = makeId('visitor');
  const credential = await controlService.createCredential({
    tenantId,
    payload: {
      subject_id: subject.id,
      membership_id: membershipId,
      customer_id: payload.customer_id || payload.customerId || null,
      type: 'qrcode',
      credential_value: rawCode,
      credential_ref: payload.credential_ref || payload.credentialRef || null,
      status: 'active',
      expires_at: payload.expires_at || payload.expiresAt || new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      metadata: {
        visitor: true,
        deviceScope: payload.device_scope || [],
      },
      vertical: payload.vertical || 'fitness',
      billing_status: 'visitor',
    },
  });

  const qrPayload = signPayload({
    v: 1,
    tenantId,
    credentialId: credential.id,
    subjectId: subject.id,
    action: payload.action || 'enter',
    issuedAt: nowIso(),
    expiresAt: payload.expires_at || payload.expiresAt || new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    kind: 'access_qr',
  });

  await controlService.createEvent({
    tenantId,
    payload: {
      subject_id: subject.id,
      credential_id: credential.id,
      event_type: 'visitor_qr_issued',
      reason_code: REASON_CODES.ALLOWED_VISITOR,
      occurred_at: new Date(),
      raw_payload: {
        vertical: payload.vertical || 'fitness',
      },
      metadata: {
        qrPayload,
      },
    },
  });

  return {
    ok: true,
    subject,
    credential,
    qr_payload: qrPayload,
    qr_svg: buildPseudoQrSvg(qrPayload),
    expires_at: credential.expires_at,
  };
}

async function resolveVisitorQrToken({ tenantId, token, deviceId = null, action = 'enter', resolveDecision }) {
  const payload = verifySignedPayload(token);
  if (payload.tenantId !== tenantId) {
    const err = new Error('invalid_qr_tenant');
    err.code = 'invalid_qr_tenant';
    throw err;
  }
  if (payload.expiresAt && new Date(payload.expiresAt).getTime() <= Date.now()) {
    const err = new Error('expired_qr_token');
    err.code = 'expired_qr_token';
    throw err;
  }

  return resolveDecision({
    tenantId,
    action,
    deviceId,
    credentialId: payload.credentialId,
    subjectId: payload.subjectId,
    vertical: payload.vertical || 'fitness',
    rawPayload: {
      source: 'qrcode',
      tokenKind: payload.kind || 'access_qr',
    },
  });
}

module.exports = {
  issueVisitorQr,
  resolveVisitorQrToken,
};
