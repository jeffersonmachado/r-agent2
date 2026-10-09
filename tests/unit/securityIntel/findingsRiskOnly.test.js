'use strict';

/**
 * Regressão do defeito medido no painel de engenharia em 2026-10-08: a tabela de
 * achados e o KPI do MESMO painel contavam coisas diferentes.
 *
 *   tabela ("achados abertos"):      1091
 *   risco aberto (KPI / gate):        248
 *   descartados por VEX (fora do KPI): 843
 *   KEV registrados: 4  ·  KEV em risco aberto (KPI): 0
 *
 * O usuário via "Somente KEV" devolvendo 4 achados enquanto o KPI dizia 0. A
 * correção não escolhe um número: ela dá UMA definição (`VEX_EXCLUDED_STATUSES`)
 * usada pelo resumo e pela listagem (`riskOnly`), e a tela declara os dois
 * números. Este teste fixa o contrato.
 */

jest.mock('../../../api/db/sequelize', () => ({
  connect: jest.fn(),
  // `getFindingSummary` monta COUNT(...) com fn/col: basta devolver as funções.
  getSequelize: jest.fn(),
}));

jest.mock('../../../api/db/models/SecurityFinding', () => jest.fn());
jest.mock('../../../api/db/models/SecurityFindingEvent', () => jest.fn());
jest.mock('../../../api/db/models/SecurityAdvisory', () => jest.fn());
jest.mock('../../../api/db/models/SecurityAdvisorySync', () => jest.fn());
jest.mock('../../../api/db/models/SecurityComponent', () => jest.fn());

const { Op } = require('sequelize');
const { getSequelize } = require('../../../api/db/sequelize');
const getSecurityFinding = require('../../../api/db/models/SecurityFinding');
const {
  VEX_EXCLUDED_STATUSES,
  listFindings,
  getFindingSummary,
} = require('../../../api/services/securityIntel/vulnerabilityScanService');

const VEX_STATUSES = ['NOT_AFFECTED', 'FALSE_POSITIVE'];

describe('listFindings — riskOnly usa a MESMA definição de risco do resumo', () => {
  let chamadas;

  beforeEach(() => {
    chamadas = [];
    // `resetMocks` do jest.config limpa implementações: rearma a cada teste.
    getSequelize.mockReturnValue({ fn: (name) => name, col: (name) => name });
    const modelo = {
      findAndCountAll: jest.fn(async (args) => {
        chamadas.push(args);
        return { rows: [], count: 0 };
      }),
      findAll: jest.fn(async (args) => {
        chamadas.push(args);
        return [];
      }),
      count: jest.fn(async (args) => {
        chamadas.push(args);
        return 0;
      }),
    };
    getSecurityFinding.mockReturnValue(modelo);
  });

  it('a lista de status fora de risco é exatamente VEX (não afetado / falso positivo)', () => {
    expect(VEX_EXCLUDED_STATUSES).toEqual(VEX_STATUSES);
  });

  it('sem riskOnly a listagem NÃO filtra status (auditoria continua possível)', async () => {
    await listFindings({ tenantKey: 'system' });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].where.status).toBeUndefined();
    expect(chamadas[0].where.resolved_at).toBeNull();
  });

  it('com riskOnly exclui os status decididos por VEX', async () => {
    await listFindings({ tenantKey: 'system', riskOnly: true });
    expect(chamadas[0].where.status).toEqual({ [Op.notIn]: VEX_STATUSES });
  });

  it('um status explícito vence riskOnly (quem quer auditar pede o status)', async () => {
    await listFindings({ tenantKey: 'system', status: 'NOT_AFFECTED', riskOnly: true });
    expect(chamadas[0].where.status).toBe('NOT_AFFECTED');
  });

  it('riskOnly NÃO aceita string em silêncio (bug de comparação estrita já visto no kev)', async () => {
    await listFindings({ tenantKey: 'system', riskOnly: 'true' });
    expect(chamadas[0].where.status).toBeUndefined();
  });

  it('kev + riskOnly combina as duas condições (é o filtro "KEV em risco aberto")', async () => {
    await listFindings({ tenantKey: 'system', kev: true, riskOnly: true });
    expect(chamadas[0].where.kev).toBe(true);
    expect(chamadas[0].where.status).toEqual({ [Op.notIn]: VEX_STATUSES });
  });

  it('o resumo usa a MESMA constante do filtro, não uma cópia literal', async () => {
    await getFindingSummary({ tenantKey: 'system' });
    const doResumo = chamadas
      .map((call) => call.where && call.where.status)
      .filter((status) => status && status[Op.notIn]);
    expect(doResumo.length).toBeGreaterThan(0);
    for (const status of doResumo) {
      expect(status[Op.notIn]).toBe(VEX_EXCLUDED_STATUSES);
    }

    chamadas = [];
    await listFindings({ tenantKey: 'system', riskOnly: true });
    expect(chamadas[0].where.status[Op.notIn]).toBe(VEX_EXCLUDED_STATUSES);
  });
});
