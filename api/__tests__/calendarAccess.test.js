const { _internal } = require('../server');

describe('calendar access helpers', () => {
  test('self can manage own calendar', () => {
    const req = { agent: { id: 'user-1', role: 'operator' } };
    expect(_internal.canManageCalendarResource(req, 'user-1')).toBe(true);
  });

  test('manager can manage other resource calendar', () => {
    const req = { agent: { id: 'mgr-1', role: 'manager' } };
    expect(_internal.canManageCalendarResource(req, 'user-2')).toBe(true);
  });

  test('operator without explicit permission cannot manage others', () => {
    const req = { agent: { id: 'op-1', role: 'operator', permissions: ['tickets:read'] } };
    expect(_internal.canManageCalendarResource(req, 'user-2')).toBe(false);
  });

  test('custom calendar permission grants cross-resource access', () => {
    const req = { agent: { id: 'user-1', role: 'operator', permissions: ['calendar:view:team'] } };
    expect(_internal.canManageCalendarResource(req, 'user-2')).toBe(true);
  });
});
