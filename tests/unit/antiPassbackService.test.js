jest.mock('../../api/modules/access-control/accessControlRepository', () => ({
  listEvents: jest.fn(),
}));

const repository = require('../../api/modules/access-control/accessControlRepository');
const { evaluateAntiPassback } = require('../../api/modules/access-control/anti-passback/antiPassbackService');
const { REASON_CODES } = require('../../api/modules/access-control/constants');

describe('antiPassbackService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('permite quando modo é none', async () => {
    const result = await evaluateAntiPassback({
      tenantId: 'tenant-1',
      subjectId: 'sub-1',
      action: 'enter',
      policy: { anti_passback_mode: 'none' },
    });

    expect(result.allowed).toBe(true);
    expect(repository.listEvents).not.toHaveBeenCalled();
  });

  it('bloqueia reentrada em modo strict', async () => {
    repository.listEvents.mockResolvedValueOnce([{ id: 'evt-1', direction: 'in' }]);

    const result = await evaluateAntiPassback({
      tenantId: 'tenant-1',
      subjectId: 'sub-1',
      action: 'enter',
      policy: { anti_passback_mode: 'strict' },
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe(REASON_CODES.DENY_ANTI_PASSBACK);
  });

  it('permite saída repetida em modo soft', async () => {
    repository.listEvents.mockResolvedValueOnce([{ id: 'evt-2', direction: 'out' }]);

    const result = await evaluateAntiPassback({
      tenantId: 'tenant-1',
      subjectId: 'sub-1',
      action: 'exit',
      policy: { anti_passback_mode: 'soft' },
    });

    expect(result.allowed).toBe(true);
  });
});
