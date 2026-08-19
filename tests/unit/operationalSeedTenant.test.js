'use strict';

/**
 * FASE 15 — Seed operacional sem tenant falha explicitamente.
 *
 * Falha coberta (falharia antes da correção): os builders
 * *OperationalSeed.js aplicavam `|| 'system'` como fallback silencioso de
 * tenant — seed provisionado no tenant errado contava como evidência.
 * Agora tenant ausente gera erro explícito `tenant_required`.
 */

const { buildSupportOperationalSeedSpec } = require('../../api/services/qa/seeds/supportOperationalSeed');
const { buildFitnessOperationalSeedSpec } = require('../../api/services/qa/seeds/fitnessOperationalSeed');
const { buildAgendamentoOperationalSeedSpec } = require('../../api/services/qa/seeds/agendamentoOperationalSeed');

const BUILDERS = [
  ['support', buildSupportOperationalSeedSpec],
  ['fitness', buildFitnessOperationalSeedSpec],
  ['agendamento', buildAgendamentoOperationalSeedSpec],
];

describe('OperationalSeed builders — tenant obrigatório (sem fallback silencioso)', () => {
  const ORIGINAL_ENV = process.env.DEFAULT_TENANT_ID;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.DEFAULT_TENANT_ID;
    else process.env.DEFAULT_TENANT_ID = ORIGINAL_ENV;
  });

  test.each(BUILDERS)('%s: sem tenantId e sem DEFAULT_TENANT_ID → erro tenant_required', (_name, builder) => {
    delete process.env.DEFAULT_TENANT_ID;
    expect(() => builder({ suffix: 'w5test' }))
      .toThrow(expect.objectContaining({ code: 'tenant_required' }));
  });

  test.each(BUILDERS)('%s: nunca cai para o tenant system por fallback', (_name, builder) => {
    delete process.env.DEFAULT_TENANT_ID;
    let spec = null;
    try {
      spec = builder({ suffix: 'w5test' });
    } catch (_) {
      spec = null;
    }
    expect(spec?.tenantId ?? null).not.toBe('system');
  });

  test.each(BUILDERS)('%s: tenantId explícito é usado', (_name, builder) => {
    delete process.env.DEFAULT_TENANT_ID;
    const spec = builder({ suffix: 'w5test', tenantId: 'tenant-w5' });
    expect(spec.tenantId).toBe('tenant-w5');
  });

  test.each(BUILDERS)('%s: DEFAULT_TENANT_ID explícito no ambiente é respeitado', (_name, builder) => {
    process.env.DEFAULT_TENANT_ID = 'tenant-env-w5';
    const spec = builder({ suffix: 'w5test' });
    expect(spec.tenantId).toBe('tenant-env-w5');
  });
});
