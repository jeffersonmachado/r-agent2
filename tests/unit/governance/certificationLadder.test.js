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
  ESTADOS, DEGRAUS, podeRodar, executarEscada, degrau, avaliarCertificabilidade, selecionarDegraus,
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

/**
 * P1-A (prompt duro 2026-10-31): `certificavel` era `FAIL === 0 && BLOCKED === 0` — um degrau
 * SKIPPED (sem runner, ambiente sem permissão) contava como certificação. Fail-open por omissão:
 * ausência de FAIL não é prova de PASS.
 *
 * Contrato novo: certificável exige o CONJUNTO ESPERADO COMPLETO de degraus, cada um com estado
 * VÁLIDO e igual a PASS. Degrau ausente, SKIPPED, UNKNOWN, estado inválido, resultado de degrau
 * desconhecido e lista vazia ⇒ NÃO certificável, com motivo nomeado.
 */
describe('certificação fail-closed (P1-A)', () => {
  const passTodos = () => {
    const runners = {};
    for (const d of DEGRAUS) runners[d.id] = async () => ({ ok: true, exitCode: 0 });
    return runners;
  };

  test('todos os degraus em PASS ⇒ certificável', async () => {
    const r = await executarEscada({ runners: passTodos() });
    expect(r.resumo.PASS).toBe(DEGRAUS.length);
    expect(r.certificavel).toBe(true);
    expect(r.problemas).toEqual([]);
  });

  test('DEGRAU SKIPPED (sem runner) ⇒ NÃO certificável, com motivo', async () => {
    const runners = passTodos();
    delete runners[DEGRAUS[0].id];
    const r = await executarEscada({ runners });
    expect(r.resumo.SKIPPED).toBeGreaterThan(0);
    expect(r.certificavel).toBe(false);
    expect(r.problemas.map((p) => p.code)).toContain('DEGRAU_NAO_PASSOU');
  });

  test('SKIPPED declarado pelo runner ⇒ NÃO certificável', async () => {
    const runners = passTodos();
    runners[DEGRAUS[0].id] = async () => ({ skipped: true });
    const r = await executarEscada({ runners });
    expect(r.certificavel).toBe(false);
  });

  test('mistura PASS + SKIPPED ⇒ NÃO certificável (não basta não ter FAIL/BLOCKED)', async () => {
    // Degrau FOLHA (sem dependentes) para que o SKIPPED não gere BLOCKED em cascata: é o caso
    // que o critério antigo (`FAIL===0 && BLOCKED===0`) aprovava indevidamente.
    const runners = passTodos();
    const folha = DEGRAUS[DEGRAUS.length - 1].id;
    runners[folha] = async () => ({ skipped: true });
    const r = await executarEscada({ runners });
    expect(r.resumo.FAIL).toBe(0);
    expect(r.resumo.BLOCKED).toBe(0);
    expect(r.resumo.SKIPPED).toBe(1);
    expect(r.certificavel).toBe(false);
    expect(r.problemas.map((p) => p.code)).toContain('DEGRAU_NAO_PASSOU');
  });

  test('resultado pré-semeado com estado UNKNOWN/ inválido ⇒ NÃO certificável', async () => {
    const runners = passTodos();
    const resultados = { [DEGRAUS[0].id]: { state: 'UNKNOWN' } };
    delete runners[DEGRAUS[0].id];
    const r = await executarEscada({ runners, resultados });
    expect(r.certificavel).toBe(false);
  });

  test('resultado de degrau DESCONHECIDO ⇒ NÃO certificável', async () => {
    const runners = passTodos();
    const r = await executarEscada({ runners, resultados: { 'degrau-forjado': { state: 'PASS' } } });
    expect(r.certificavel).toBe(false);
    expect(r.problemas.map((p) => p.code)).toContain('DEGRAU_DESCONHECIDO');
  });

  test('lista vazia de resultados ⇒ NÃO certificável', async () => {
    const r = await executarEscada({ runners: {}, resultados: {} });
    // Degraus independentes viram SKIPPED; os dependentes, BLOCKED.
    expect(r.certificavel).toBe(false);
  });

  test('degrau ausente do trilho ⇒ NÃO certificável mesmo sem FAIL/BLOCKED', async () => {
    const runners = passTodos();
    const r = await executarEscada({ runners });
    const trilhaIncompleta = r.trilha.filter((t) => t.id !== DEGRAUS[0].id);
    const avaliado = avaliarCertificabilidade(trilhaIncompleta.reduce((acc, t) => { acc[t.id] = t; return acc; }, {}));
    expect(avaliado.certificavel).toBe(false);
    expect(avaliado.problemas.map((p) => p.code)).toContain('DEGRAU_AUSENTE');
  });
});

/**
 * P1-B (prompt duro 2026-10-31): `--only` filtrava a EXIBIÇÃO depois de rodar a escada inteira —
 * os comandos não selecionados executavam (com efeitos colaterais reais) e só não apareciam.
 * Contrato novo: a seleção acontece ANTES da execução, inclui apenas as dependências estritamente
 * necessárias, e `--only` inválido falha fechado sem rodar nada.
 */
describe('seleção restringe EXECUÇÃO (P1-B)', () => {
  test('seleção inclui o alvo e suas dependências, na ordem da escada', () => {
    const sel = selecionarDegraus(['cobertura']);
    expect(sel.ok).toBe(true);
    // cobertura requer waves; waves requer fechamentos; fechamentos requer ancoras.
    expect(sel.ids).toEqual(expect.arrayContaining(['ancoras', 'fechamentos', 'waves', 'cobertura']));
    expect(sel.ids.indexOf('ancoras')).toBeLessThan(sel.ids.indexOf('fechamentos'));
    expect(sel.ids.indexOf('fechamentos')).toBeLessThan(sel.ids.indexOf('waves'));
    expect(sel.ids.indexOf('waves')).toBeLessThan(sel.ids.indexOf('cobertura'));
    // Nada fora do fecho de dependências.
    expect(sel.ids).not.toContain('agregado');
  });

  test('seleção de degrau sem dependência roda só ele', () => {
    const sel = selecionarDegraus(['fila']);
    expect(sel.ids).toEqual(['fila']);
  });

  test('--only inválido falha fechado e não seleciona nada', () => {
    const sel = selecionarDegraus(['nao-existe']);
    expect(sel.ok).toBe(false);
    expect(sel.ids).toEqual([]);
    expect(sel.erro).toBe('DEGRAU_DESCONHECIDO');
  });

  test('executarEscada com seleção NÃO invoca runner fora do alvo', async () => {
    const invocados = [];
    const runners = {};
    for (const d of DEGRAUS) {
      runners[d.id] = async () => { invocados.push(d.id); return { ok: true, exitCode: 0 }; };
    }
    await executarEscada({ runners, apenas: ['fila'] });
    expect(invocados).toEqual(['fila']);
  });

  test('executarEscada com seleção roda apenas alvo + dependências', async () => {
    const invocados = [];
    const runners = {};
    for (const d of DEGRAUS) {
      runners[d.id] = async () => { invocados.push(d.id); return { ok: true, exitCode: 0 }; };
    }
    await executarEscada({ runners, apenas: ['fechamentos'] });
    expect(invocados).toEqual(['ancoras', 'fechamentos']);
  });
});
