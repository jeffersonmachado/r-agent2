'use strict';

/**
 * Escada de certificação — contrato do núcleo puro.
 *
 * O risco real desta peça é transformar "não rodou" em "passou". Estes testes fixam que:
 *  - degrau com pré-requisito não cumprido é BLOCKED, nunca PASS nem SKIPPED;
 *  - FAIL não é mascarado pelo degrau seguinte;
 *  - `certificavel` só é true com ZERO FAIL e ZERO BLOCKED;
 *  - a ordem declarada respeita as dependências (nenhum degrau requer um posterior).
 */

const {
  ESTADOS, DEGRAUS, podeRodar, executarEscada, degrau,
} = require('../../../governance/certification-ladder');

const runnersQuePassam = () => DEGRAUS.reduce((acc, d) => {
  acc[d.id] = async () => ({ ok: true, exitCode: 0 });
  return acc;
}, {});

describe('escada de certificação (puro)', () => {
  test('a ordem declarada nunca exige um degrau POSTERIOR', () => {
    const indice = new Map(DEGRAUS.map((d, i) => [d.id, i]));
    for (const d of DEGRAUS) {
      for (const req of d.requires) {
        expect(indice.has(req)).toBe(true);
        expect(indice.get(req)).toBeLessThan(indice.get(d.id));
      }
    }
  });

  test('pré-requisito não cumprido ⇒ BLOCKED (nunca PASS/SKIPPED)', async () => {
    const runners = runnersQuePassam();
    delete runners.ancoras;
    const resultado = await executarEscada({
      runners: {
        ...runners,
        // âncoras reprova
        ancoras: async () => ({ ok: false, exitCode: 1, detail: 'RAP_CLOSURE_INVENTORY_SHA256 ausente' }),
      },
    });

    const fechamentos = resultado.trilha.find((t) => t.id === 'fechamentos');
    expect(fechamentos.state).toBe(ESTADOS.BLOCKED);
    expect(fechamentos.blockedBy).toContain('ancoras');

    const requiredTests = resultado.trilha.find((t) => t.id === 'required-tests');
    expect(requiredTests.state).toBe(ESTADOS.BLOCKED);

    expect(resultado.certificavel).toBe(false);
  });

  test('FAIL num degrau não vira PASS adiante e zera a certificabilidade', async () => {
    const resultado = await executarEscada({
      runners: {
        ...runnersQuePassam(),
        dag: async () => ({ ok: false, exitCode: 1, detail: 'PHASE_ORDER_VIOLATION' }),
      },
    });
    expect(resultado.trilha.find((t) => t.id === 'dag').state).toBe(ESTADOS.FAIL);
    expect(resultado.resumo.FAIL).toBeGreaterThan(0);
    expect(resultado.certificavel).toBe(false);
  });

  test('sem runner injetado o degrau é SKIPPED — e SKIPPED não certifica', async () => {
    const resultado = await executarEscada({ runners: { fila: async () => ({ ok: true }) } });
    expect(resultado.trilha.find((t) => t.id === 'memoria').state).toBe(ESTADOS.SKIPPED);
    expect(resultado.certificavel).toBe(false);
  });

  test('tudo verde ⇒ certificável', async () => {
    const resultado = await executarEscada({ runners: runnersQuePassam() });
    expect(resultado.resumo).toMatchObject({ PASS: DEGRAUS.length, FAIL: 0, BLOCKED: 0, SKIPPED: 0 });
    expect(resultado.certificavel).toBe(true);
  });

  test('runner que lança é FAIL, não queda da escada', async () => {
    const runners = runnersQuePassam();
    runners.fila = async () => { throw new Error('boom'); };
    const resultado = await executarEscada({ runners });
    expect(resultado.trilha.find((t) => t.id === 'fila').state).toBe(ESTADOS.FAIL);
    expect(resultado.trilha.find((t) => t.id === 'memoria').state).toBe(ESTADOS.PASS);
  });

  test('podeRodar consulta apenas os pré-requisitos declarados', () => {
    expect(podeRodar('fechamentos', {})).toEqual({ runnable: false, blockedBy: ['ancoras'] });
    expect(podeRodar('fechamentos', { ancoras: { state: ESTADOS.PASS } })).toEqual({ runnable: true, blockedBy: [] });
    expect(podeRodar('inexistente', {})).toEqual({ runnable: false, blockedBy: ['DEGRAU_DESCONHECIDO'] });
    expect(degrau('agregado').requires).toContain('cobertura');
  });
});
