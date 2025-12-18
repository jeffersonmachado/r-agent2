const {
  isSameTenant,
  maskText,
  maskPayload,
  sanitizeEventsForLogging,
  canAccessReplay,
  buildAdminAuditEvent,
} = require('../security');

describe('security helpers', () => {
  test('isSameTenant retorna true apenas para tenants iguais e não vazios', () => {
    expect(isSameTenant('t1', 't1')).toBe(true);
    expect(isSameTenant('t1', 't2')).toBe(false);
    expect(isSameTenant('', 't1')).toBe(false);
  });

  test('maskText mascara e-mails e sequências longas de dígitos', () => {
    const input = 'Contato: user@example.com, telefone 11987654321';
    const masked = maskText(input);
    expect(masked).not.toContain('user@example.com');
    expect(masked).toMatch(/\*+@example\.com/);
    expect(masked).not.toContain('11987654321');
  });

  test('maskPayload mascara campos sensíveis conhecidos', () => {
    const payload = {
      email: 'user@example.com',
      phone: '11987654321',
      other: 'ok',
    };
    const masked = maskPayload(payload);
    expect(masked.email).not.toBe(payload.email);
    expect(masked.phone).not.toBe(payload.phone);
    expect(masked.other).toBe('ok');
  });

  test('sanitizeEventsForLogging aplica masking em payloads', () => {
    const events = [
      {
        id: '1',
        timestamp: '2025-01-01T00:00:00.000Z',
        sessionId: 's1',
        flowId: 'f1',
        nodeId: 'n1',
        type: 'MESSAGE_IN',
        payload: { email: 'user@example.com' },
      },
    ];

    const sanitized = sanitizeEventsForLogging(events);
    expect(sanitized[0].payload.email).not.toBe('user@example.com');
  });

  test('canAccessReplay exige mesmo tenant e permissão ou role admin', () => {
    const ctx = {
      tenantId: 't1',
      actorId: 'u1',
      roles: [],
      permissions: [],
    };

    expect(canAccessReplay(ctx, 't1')).toBe(false);

    const ctxWithPerm = { ...ctx, permissions: ['replay:read'] };
    expect(canAccessReplay(ctxWithPerm, 't1')).toBe(true);

    const ctxAdmin = { ...ctx, roles: ['admin'] };
    expect(canAccessReplay(ctxAdmin, 't1')).toBe(true);

    expect(canAccessReplay(ctxAdmin, 't2')).toBe(false);
  });

  test('buildAdminAuditEvent cria evento com dados mínimos', () => {
    const ctx = {
      tenantId: 't1',
      actorId: 'admin-1',
    };
    const ev = buildAdminAuditEvent(ctx, {
      action: 'flow.publish',
      targetType: 'flow',
      targetId: 'flow-1',
      details: { version: 2 },
    });

    expect(ev.tenantId).toBe('t1');
    expect(ev.actorId).toBe('admin-1');
    expect(ev.action).toBe('flow.publish');
    expect(ev.targetType).toBe('flow');
    expect(ev.targetId).toBe('flow-1');
    expect(ev.details).toEqual({ version: 2 });
  });
});


