jest.mock('../../api/modules/access-control/accessControlRepository', () => ({
  findDevice: jest.fn(),
  findCredential: jest.fn(),
  listPolicies: jest.fn(),
  listEvents: jest.fn(),
  createDecision: jest.fn(async (payload) => ({ ...payload })),
}));

jest.mock('../../api/modules/access-control/accessProfileAdapter', () => ({
  resolveSubjectContext: jest.fn(),
}));

jest.mock('../../api/modules/access-control/accessControlService', () => ({
  createEvent: jest.fn(async ({ payload }) => ({ id: 'evt-1', ...payload })),
  ensureSubject: jest.fn(async ({ tenantId, subjectId, customerId, verticalProfile, metadata }) => ({
    id: subjectId || 'sub-visitor',
    tenant_key: tenantId,
    customer_id: customerId || null,
    vertical_profile: verticalProfile || 'fitness',
    metadata: metadata || {},
  })),
  upsertMembership: jest.fn(async ({ membershipId, subjectId, billingStatus }) => ({
    id: membershipId,
    subject_id: subjectId,
    billing_status: billingStatus,
  })),
  createCredential: jest.fn(async ({ payload }) => ({
    id: 'cred-visitor',
    subject_id: payload.subject_id,
    expires_at: payload.expires_at,
  })),
}));

jest.mock('../../api/services/biometricService', () => ({
  verifyBiometricRef: jest.fn(),
}));

const repository = require('../../api/modules/access-control/accessControlRepository');
const controlService = require('../../api/modules/access-control/accessControlService');
const { resolveSubjectContext } = require('../../api/modules/access-control/accessProfileAdapter');
const biometricService = require('../../api/services/biometricService');
const {
  resolveDecision,
  issueVisitorQr,
  resolveQrToken,
} = require('../../api/modules/access-control/accessDecisionService');
const { REASON_CODES } = require('../../api/modules/access-control/constants');

describe('accessDecisionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.createDecision.mockImplementation(async (payload) => ({ ...payload }));
    repository.findDevice.mockResolvedValue({ id: 'dev-1', status: 'active', type: 'turnstile', unit_id: 'unit-a' });
    repository.findCredential.mockResolvedValue({ id: 'cred-1', status: 'active', subject_id: 'sub-1', type: 'qrcode' });
    repository.listPolicies.mockResolvedValue([{
      id: 'policy-1',
      applies_to: {
        actions: ['enter', 'exit'],
        vertical_profiles: ['fitness'],
        membership_statuses: ['active', 'grace_period', 'trial', 'visitor'],
        device_types: ['turnstile'],
      },
      days_allowed: [],
      time_start: '05:00',
      time_end: '23:00',
      unit_scope: ['unit-a'],
      anti_passback_mode: 'none',
      max_entries_per_day: 5,
    }]);
    repository.listEvents.mockResolvedValue([]);
    controlService.createEvent.mockImplementation(async ({ payload }) => ({ id: 'evt-1', ...payload }));
    controlService.ensureSubject.mockImplementation(async ({ tenantId, subjectId, customerId, verticalProfile, metadata }) => ({
      id: subjectId || 'sub-visitor',
      tenant_key: tenantId,
      customer_id: customerId || null,
      vertical_profile: verticalProfile || 'fitness',
      metadata: metadata || {},
    }));
    controlService.upsertMembership.mockImplementation(async ({ membershipId, subjectId, billingStatus }) => ({
      id: membershipId,
      subject_id: subjectId,
      billing_status: billingStatus,
    }));
    controlService.createCredential.mockImplementation(async ({ payload }) => ({
      id: 'cred-visitor',
      subject_id: payload.subject_id,
      expires_at: payload.expires_at,
    }));
    resolveSubjectContext.mockResolvedValue({
      subject: { id: 'sub-1', status: 'active', vertical_profile: 'fitness', customer_id: 'cust-1' },
      membership: { id: 'mem-1', status: 'active', billing_status: 'active', unit_scope: ['unit-a'] },
      customer: null,
      activeSchedule: null,
    });
  });

  it('nega acesso por billing_status delinquent', async () => {
    repository.listPolicies.mockResolvedValueOnce([{
      id: 'policy-1',
      applies_to: {
        actions: ['enter'],
        vertical_profiles: ['fitness'],
        membership_statuses: ['active', 'grace_period', 'trial', 'visitor', 'delinquent'],
        device_types: ['turnstile'],
      },
      days_allowed: [],
      time_start: '05:00',
      time_end: '23:00',
      unit_scope: ['unit-a'],
      anti_passback_mode: 'none',
      max_entries_per_day: 5,
    }]);
    resolveSubjectContext.mockResolvedValueOnce({
      subject: { id: 'sub-1', status: 'active', vertical_profile: 'fitness' },
      membership: { id: 'mem-1', status: 'active', billing_status: 'delinquent', unit_scope: ['unit-a'] },
      activeSchedule: null,
    });

    const result = await resolveDecision({
      tenantId: 'tenant-a',
      action: 'enter',
      deviceId: 'dev-1',
      credentialValue: 'qr-value',
      vertical: 'fitness',
      rawPayload: {},
    });

    expect(result.decision.decision).toBe('deny');
    expect(result.decision.reason_code).toBe(REASON_CODES.DENY_BILLING_DELINQUENT);
  });

  it('nega acesso beauty fora da janela de atendimento', async () => {
    resolveSubjectContext.mockResolvedValueOnce({
      subject: { id: 'sub-1', status: 'active', vertical_profile: 'beauty' },
      membership: null,
      activeSchedule: {
        id: 'sch-1',
        startAt: '2000-01-01T10:00:00.000Z',
        endAt: '2000-01-01T11:00:00.000Z',
        status: 'scheduled',
      },
    });

    const result = await resolveDecision({
      tenantId: 'tenant-a',
      action: 'enter',
      deviceId: 'dev-1',
      credentialValue: 'qr-value',
      vertical: 'beauty',
      rawPayload: {},
    });

    expect(result.decision.decision).toBe('deny');
    expect(result.decision.reason_code).toBe(REASON_CODES.DENY_OUTSIDE_SCHEDULE_WINDOW);
  });

  it('nega acesso por anti-passback', async () => {
    repository.listPolicies.mockResolvedValueOnce([{
      id: 'policy-1',
      applies_to: {
        actions: ['enter'],
        vertical_profiles: ['fitness'],
        membership_statuses: ['active'],
        device_types: ['turnstile'],
      },
      days_allowed: [],
      time_start: '05:00',
      time_end: '23:00',
      unit_scope: ['unit-a'],
      anti_passback_mode: 'strict',
      max_entries_per_day: 5,
    }]);
    repository.listEvents.mockResolvedValueOnce([{ id: 'evt-prev', direction: 'in', occurred_at: new Date().toISOString() }]);

    const result = await resolveDecision({
      tenantId: 'tenant-a',
      action: 'enter',
      deviceId: 'dev-1',
      credentialValue: 'qr-value',
      vertical: 'fitness',
      rawPayload: {},
    });

    expect(result.decision.decision).toBe('deny');
    expect(result.decision.reason_code).toBe(REASON_CODES.DENY_ANTI_PASSBACK);
  });

  it('emite QR temporário e resolve o token para o mesmo tenant', async () => {
    const qr = await issueVisitorQr({
      tenantId: 'tenant-a',
      payload: {
        vertical: 'fitness',
        customer_id: 'visitor-1',
      },
    });

    repository.findCredential.mockResolvedValueOnce({ id: 'cred-visitor', status: 'active', subject_id: 'sub-visitor', type: 'qrcode' });
    resolveSubjectContext.mockResolvedValueOnce({
      subject: { id: 'sub-visitor', status: 'active', vertical_profile: 'fitness' },
      membership: { id: 'mem-visitor', status: 'active', billing_status: 'visitor', unit_scope: [] },
      activeSchedule: null,
    });

    const resolved = await resolveQrToken({
      tenantId: 'tenant-a',
      token: qr.qr_payload,
      deviceId: 'dev-1',
      action: 'enter',
    });

    expect(qr.qr_payload).toBeTruthy();
    expect(qr.qr_svg).toContain('<svg');
    expect(resolved.decision.decision).toBe('allow');
  });

  it('mantém isolamento por tenant ao resolver QR', async () => {
    const qr = await issueVisitorQr({
      tenantId: 'tenant-a',
      payload: {
        vertical: 'fitness',
        customer_id: 'visitor-2',
      },
    });

    await expect(resolveQrToken({
      tenantId: 'tenant-b',
      token: qr.qr_payload,
      deviceId: 'dev-1',
      action: 'enter',
    })).rejects.toMatchObject({ code: 'invalid_qr_tenant' });
  });

  it('resolve biometria sem transformá-la em autorização implícita', async () => {
    repository.findCredential
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'cred-bio', status: 'active', subject_id: 'sub-1', type: 'biometric', credential_ref: 'cust:cust-1' });
    biometricService.verifyBiometricRef.mockReturnValue({
      subjectId: 'cust:cust-1',
      mode: 'identify-1n',
    });

    const result = await resolveDecision({
      tenantId: 'tenant-a',
      action: 'enter',
      deviceId: 'dev-1',
      biometricRef: 'bio-ref',
      vertical: 'fitness',
      rawPayload: {
        biometric_secret: 'secret',
        expected_token_id: 'pat-1',
      },
    });

    expect(biometricService.verifyBiometricRef).toHaveBeenCalled();
    expect(result.decision.decision).toBe('allow');
    expect(result.decision.reason_code).toBe(REASON_CODES.ALLOWED_ACTIVE);
  });
});
