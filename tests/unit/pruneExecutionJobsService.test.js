'use strict';

/**
 * Testa pruneExecutionJobs: remove apenas jobs done/dead mais antigos que a
 * janela de retenção; nunca toca pending/processing; valida retentionDays.
 */

const mockQuery = jest.fn(async () => [{ rowCount: 5 }]);
const mockGetSequelize = jest.fn(() => ({ query: (...args) => mockQuery(...args) }));

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => mockGetSequelize(),
}));

const { pruneExecutionJobs } = require('../../api/services/pruneExecutionJobsService');

describe('pruneExecutionJobsService', () => {
  beforeEach(() => {
    // `resetMocks: true` apaga implementações de escopo de módulo; restaura aqui.
    mockQuery.mockImplementation(async () => [{ rowCount: 5 }]);
    mockGetSequelize.mockImplementation(() => ({ query: (...args) => mockQuery(...args) }));
    delete process.env.EXECUTION_JOB_RETENTION_DAYS;
  });

  test('remove done/dead com retenção default de 30 dias e preserva pending/processing', async () => {
    const out = await pruneExecutionJobs();

    expect(out.ok).toBe(true);
    expect(out.retentionDays).toBe(30);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/DELETE FROM execution_jobs/);
    expect(sql).toMatch(/status IN \('done', 'dead'\)/);
    expect(sql).toMatch(/updated_at < NOW\(\) - INTERVAL '30 days'/);
  });

  test('honra retentionDays explícito', async () => {
    const out = await pruneExecutionJobs({ retentionDays: 7 });

    expect(out.retentionDays).toBe(7);
    expect(mockQuery.mock.calls[0][0]).toMatch(/INTERVAL '7 days'/);
  });

  test('rejeita retentionDays inválido', async () => {
    await expect(pruneExecutionJobs({ retentionDays: 0 })).resolves.toEqual({ ok: false, reason: 'invalid_retention_days' });
    await expect(pruneExecutionJobs({ retentionDays: -3 })).resolves.toEqual({ ok: false, reason: 'invalid_retention_days' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('db indisponível retorna db_unavailable', async () => {
    mockGetSequelize.mockReturnValue(null);
    await expect(pruneExecutionJobs()).resolves.toEqual({ ok: false, reason: 'db_unavailable' });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
