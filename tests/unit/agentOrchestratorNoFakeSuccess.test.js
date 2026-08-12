'use strict';

/**
 * Regressão (gap 3.1): o Agent Orchestrator declara "NUNCA retorna resposta
 * simulada", porém engolia falhas de serviço com catch(_) e devolvia
 * { success: true, result: { data: { capability, action, context } } }.
 *
 * Contrato obrigatório: REAL SUCCESS ou EXPLICIT FAILURE — nunca FAKE SUCCESS.
 */

jest.mock('../../api/services/scheduleService', () => ({
  getSchedule: jest.fn(() => { throw new Error('db_connection_refused'); }),
  createSchedule: jest.fn(() => { throw new Error('db_connection_refused'); }),
  updateScheduleStatus: jest.fn(() => { throw new Error('db_connection_refused'); }),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const { executeCapability } = require('../../api/modules/agent-os/routes/agent-orchestrator');

describe('Agent Orchestrator — sem fake success', () => {
  test('capability cujo serviço falha NÃO pode retornar success:true', async () => {
    const result = await executeCapability('agenda.read', { id: 'agent-1', slug: 'scheduling-agent' }, {
      tenantId: 'tenant-a',
      query: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // Sem payload sintético de fallback disfarçado de resultado.
    expect(result.result?.data?.note).not.toBe('capability executed');
  });

  test('capability desconhecida retorna falha explícita', async () => {
    const result = await executeCapability('nao.existe', null, { tenantId: 't1' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown capability|capability_not_found/i);
  });

  test('resultado de sucesso não contém marcador de fallback sintético', async () => {
    const result = await executeCapability('crm.read', { id: 'a', slug: 'crm-agent' }, { tenantId: 't1' });
    if (result.success) {
      expect(result.result?.data?.note).not.toBe('capability executed');
      // data sintética { capability, action, context } sem serviço real é proibida.
      const data = result.result?.data || {};
      const isSynthetic = data.capability && data.action && data.context && Object.keys(data).length <= 4;
      expect(isSynthetic).toBe(false);
    }
  });
});
