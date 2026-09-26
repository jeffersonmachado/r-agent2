'use strict';

/**
 * Testa pruneVerticalEngagementSignals: remove sinais mais antigos que a janela
 * de retenção (default 90 dias), honra override por env e valida o parâmetro.
 *
 * Contexto: a tabela acumulava 8,4M linhas / ~4,1 GB sem expurgo, e a varredura
 * incremental dos ticks verticais fazia Seq Scan sobre ela (medido 2026-09-26).
 */

const mockQuery = jest.fn(async () => [{ rowCount: 5 }]);
const mockGetSequelize = jest.fn(() => ({ query: (...args) => mockQuery(...args) }));

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => mockGetSequelize(),
}));

const { pruneVerticalEngagementSignals } = require('../../api/services/pruneVerticalEngagementSignalsService');

describe('pruneVerticalEngagementSignalsService', () => {
  beforeEach(() => {
    // `resetMocks: true` apaga implementações de escopo de módulo; restaura aqui.
    mockQuery.mockImplementation(async () => [{ rowCount: 5 }]);
    mockGetSequelize.mockImplementation(() => ({ query: (...args) => mockQuery(...args) }));
    delete process.env.VERTICAL_ENGAGEMENT_SIGNAL_RETENTION_DAYS;
  });

  test('remove sinais antigos com retenção default de 90 dias', async () => {
    const out = await pruneVerticalEngagementSignals();

    expect(out.ok).toBe(true);
    expect(out.retentionDays).toBe(90);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const sql = mockQuery.mock.calls[0][0];
    expect(sql).toMatch(/DELETE FROM vertical_engagement_signals/);
    expect(sql).toMatch(/computed_at < NOW\(\) - INTERVAL '90 days'/);
    // A linha é um recálculo datado: não há estado pendente/em processamento a
    // preservar (diferente de execution_jobs, que filtra por status).
    expect(sql).not.toMatch(/status/);
  });

  test('honra retentionDays explícito', async () => {
    const out = await pruneVerticalEngagementSignals({ retentionDays: 30 });

    expect(out.retentionDays).toBe(30);
    expect(mockQuery.mock.calls[0][0]).toMatch(/INTERVAL '30 days'/);
  });

  test('usa VERTICAL_ENGAGEMENT_SIGNAL_RETENTION_DAYS quando definido', async () => {
    process.env.VERTICAL_ENGAGEMENT_SIGNAL_RETENTION_DAYS = '45';
    const out = await pruneVerticalEngagementSignals();

    expect(out.retentionDays).toBe(45);
    expect(mockQuery.mock.calls[0][0]).toMatch(/INTERVAL '45 days'/);
  });

  test('rejeita retentionDays inválido', async () => {
    await expect(pruneVerticalEngagementSignals({ retentionDays: 0 })).resolves.toEqual({ ok: false, reason: 'invalid_retention_days' });
    await expect(pruneVerticalEngagementSignals({ retentionDays: -3 })).resolves.toEqual({ ok: false, reason: 'invalid_retention_days' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('db indisponível retorna db_unavailable', async () => {
    mockGetSequelize.mockReturnValue(null);
    await expect(pruneVerticalEngagementSignals()).resolves.toEqual({ ok: false, reason: 'db_unavailable' });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
