'use strict';

/**
 * P1-D — PRONTIDÃO COM CHECKS VAZIOS (missão Codex 2026-10-23).
 *
 * Defeito reproduzido ANTES da correção, chamando o contrato direto:
 *
 *   decidirVeredito({ checks: [], aprovacaoHumana: true })
 *     → { veredito: 'ENGINEER_SUPERVISED_READY_GO', exitCode: 0, isGo: true }
 *   decidirVeredito({ aprovacaoHumana: true })            // checks undefined
 *     → ENGINEER_SUPERVISED_READY_GO
 *   decidirVeredito({ checks: [{ id: 'fake', ok: true }], aprovacaoHumana: true })
 *     → ENGINEER_SUPERVISED_READY_GO
 *   decidirVeredito({ checks: null, aprovacaoHumana: true })
 *     → TypeError (crash, não decisão)
 *
 * Ou seja: aprovação humana substituía teste técnico e a ausência de medição virava GO.
 * O contrato agora exige COBERTURA EXPLÍCITA do catálogo canônico.
 */

const {
  decidirVeredito, CHECKS_OBRIGATORIOS,
} = require('../../../scripts/governance/validate-engineer-supervised-readiness');

const cheio = (mutacoes = {}) => CHECKS_OBRIGATORIOS.map((id) => {
  const m = mutacoes[id];
  if (m === false) return { id, ok: false, bloqueante: true, detalhe: `reprovado ${id}` };
  if (m && typeof m === 'object') return { id, ...m };
  return { id, ok: true, bloqueante: true, detalhe: `medido ${id}` };
});

describe('P1-D — entrada degenerada NUNCA produz READY_GO, mesmo com aprovação humana', () => {
  const degeneradas = [
    ['checks = []', []],
    ['checks = null', null],
    ['checks = undefined', undefined],
    ['checks = [{}]', [{}]],
    ['checks = [{ status: "PASS" }]', [{ status: 'PASS' }]],
    ['checks = [{ id: "fake", status: "PASS" }]', [{ id: 'fake', status: 'PASS' }]],
    ['checks = [{ id: "fake", ok: true }]', [{ id: 'fake', ok: true }]],
    ['checks = "PASS"', 'PASS'],
    ['checks = 42', 42],
  ];

  test.each(degeneradas)('%s + aprovacaoHumana=true ⇒ NOT_READY', (_rotulo, checks) => {
    const d = decidirVeredito({ checks, aprovacaoHumana: true });
    expect(d.veredito).toBe('NOT_READY');
    expect(d.isGo).toBe(false);
    expect(d.exitCode).toBe(1);
    expect((d.problemas || []).length).toBeGreaterThan(0);
  });

  test.each(degeneradas)('%s + aprovacaoHumana=false ⇒ NOT_READY (nunca PENDING)', (_rotulo, checks) => {
    const d = decidirVeredito({ checks, aprovacaoHumana: false });
    expect(d.veredito).toBe('NOT_READY');
    expect(d.isGo).toBe(false);
  });
});

describe('P1-D — cobertura incompleta, duplicidade e inconclusivo reprovam', () => {
  test('catálogo incompleto (um check obrigatório ausente) ⇒ NOT_READY', () => {
    const checks = cheio().filter((c) => c.id !== 'QUEUE_INVENTORY_ANCHORED');
    const d = decidirVeredito({ checks, aprovacaoHumana: true });
    expect(d.veredito).toBe('NOT_READY');
    expect(d.checksAusentes).toEqual(['QUEUE_INVENTORY_ANCHORED']);
    expect(d.problemas).toContain('CHECK_OBRIGATORIO_AUSENTE:QUEUE_INVENTORY_ANCHORED');
  });

  test('check duplicado ⇒ NOT_READY (não "o último vence")', () => {
    const checks = [...cheio(), { id: 'QUEUE_READABLE', ok: true, detalhe: 'repetido' }];
    const d = decidirVeredito({ checks, aprovacaoHumana: true });
    expect(d.veredito).toBe('NOT_READY');
    expect(d.problemas).toContain('CHECK_DUPLICADO:QUEUE_READABLE');
  });

  test('check DESCONHECIDO (fora do catálogo) ⇒ NOT_READY', () => {
    const checks = [...cheio(), { id: 'CHECK_INVENTADO', ok: true, detalhe: 'inventado' }];
    const d = decidirVeredito({ checks, aprovacaoHumana: true });
    expect(d.veredito).toBe('NOT_READY');
    expect(d.problemas).toContain('CHECK_DESCONHECIDO:CHECK_INVENTADO');
  });

  test.each(['UNKNOWN', 'NOT_EXECUTED', 'TIMEOUT', 'SKIPPED', 'BLOCKED', 'ERROR'])(
    'status %s com ok:true continua reprovando (não vira PASS)',
    (status) => {
      const checks = cheio({ QUEUE_CLOSURE_EVIDENCE: { ok: true, status, bloqueante: true, detalhe: `${status}` } });
      const d = decidirVeredito({ checks, aprovacaoHumana: true });
      expect(d.veredito).toBe('NOT_READY');
      expect(d.problemas).toContain(`CHECK_INCONCLUSIVO:QUEUE_CLOSURE_EVIDENCE:${status}`);
    },
  );

  test('check sem `ok` booleano ⇒ NOT_READY', () => {
    const checks = cheio({ QUEUE_READABLE: { ok: 'true', bloqueante: true, detalhe: 'string em vez de booleano' } });
    const d = decidirVeredito({ checks, aprovacaoHumana: true });
    expect(d.veredito).toBe('NOT_READY');
    expect(d.problemas).toContain('CHECK_SEM_RESULTADO_BOOLEANO:QUEUE_READABLE');
  });

  test('check sem evidência (`detalhe` vazio) ⇒ NOT_READY', () => {
    const checks = cheio({ QUEUE_READABLE: { ok: true, bloqueante: true, detalhe: '   ' } });
    const d = decidirVeredito({ checks, aprovacaoHumana: true });
    expect(d.veredito).toBe('NOT_READY');
    expect(d.problemas).toContain('CHECK_SEM_EVIDENCIA:QUEUE_READABLE');
  });
});

describe('P1-D — identidade de execução', () => {
  test('check que declara outro commit ⇒ NOT_READY', () => {
    const checks = cheio({
      QUEUE_READABLE: { ok: true, bloqueante: true, detalhe: 'x', identidade: { commit: 'deadbeef' } },
    });
    const d = decidirVeredito({ checks, aprovacaoHumana: true, identidade: { commit: 'a'.repeat(40) } });
    expect(d.veredito).toBe('NOT_READY');
    expect(d.problemas.some((p) => p.startsWith('CHECK_DE_OUTRO_COMMIT:QUEUE_READABLE'))).toBe(true);
  });

  test('check que declara o MESMO commit ⇒ decisão normal', () => {
    const commit = 'b'.repeat(40);
    const checks = cheio({
      QUEUE_READABLE: { ok: true, bloqueante: true, detalhe: 'x', identidade: { commit } },
    });
    const d = decidirVeredito({ checks, aprovacaoHumana: true, identidade: { commit } });
    expect(d.veredito).toBe('ENGINEER_SUPERVISED_READY_GO');
  });
});

describe('P1-D — aprovação humana: necessária e NUNCA suficiente', () => {
  test('conjunto completo legítimo sem aprovação ⇒ PENDING_HUMAN_APPROVAL (exit 2)', () => {
    const d = decidirVeredito({ checks: cheio(), aprovacaoHumana: false });
    expect(d.veredito).toBe('PENDING_HUMAN_APPROVAL');
    expect(d.exitCode).toBe(2);
    expect(d.isGo).toBe(false);
  });

  test('conjunto completo legítimo com aprovação ⇒ único caso de READY_GO', () => {
    const d = decidirVeredito({ checks: cheio(), aprovacaoHumana: true });
    expect(d.veredito).toBe('ENGINEER_SUPERVISED_READY_GO');
    expect(d.exitCode).toBe(0);
    expect(d.isGo).toBe(true);
  });

  test('aprovacaoHumana=true com técnico reprovado ⇒ NOT_READY (nunca substitui)', () => {
    const d = decidirVeredito({ checks: cheio({ QUEUE_CLOSURE_EVIDENCE: false }), aprovacaoHumana: true });
    expect(d.veredito).toBe('NOT_READY');
    expect(d.falhas).toEqual(['QUEUE_CLOSURE_EVIDENCE']);
  });

  test('o catálogo tem os 21 checks e nenhum id duplicado', () => {
    expect(CHECKS_OBRIGATORIOS).toHaveLength(21);
    expect(new Set(CHECKS_OBRIGATORIOS).size).toBe(CHECKS_OBRIGATORIOS.length);
  });
});

// ─── 1ª passada da revisão independente (achado 4) ──────────────────────────

describe('P1-D — parâmetros públicos não podem desligar as guardas', () => {
  test('catalogo=[] ou null NÃO desliga a cobertura obrigatória', () => {
    const inventado = [{ id: 'fake', ok: true, detalhe: 'inventado' }];
    for (const catalogo of [[], null, undefined, 'nao-e-array']) {
      const d = decidirVeredito({ checks: inventado, aprovacaoHumana: true, catalogo });
      expect(d.veredito).toBe('NOT_READY');
      expect(d.isGo).toBe(false);
    }
  });

  test('status inconclusivo com espaço/case diferente continua reprovando', () => {
    for (const status of [' TimeOut', 'timeout ', '  unknown', 'Not_Executed ']) {
      const checks = cheio({ QUEUE_CLOSURE_EVIDENCE: { ok: true, status, bloqueante: true, detalhe: 'x' } });
      const d = decidirVeredito({ checks, aprovacaoHumana: true });
      expect(d.veredito).toBe('NOT_READY');
    }
  });
});

// ─── 2ª passada da revisão independente (A7) ────────────────────────────────

describe('P1-D — resíduos do contrato exportado (A7)', () => {
  test('catálogo custom não pode OMITIR obrigatórios do canônico', () => {
    const d = decidirVeredito({
      checks: [{ id: 'HUMAN_APPROVAL_PRESENT', ok: true, detalhe: 'x' }],
      catalogo: ['HUMAN_APPROVAL_PRESENT'],
      aprovacaoHumana: true,
    });
    expect(d.veredito).toBe('NOT_READY');
    expect(d.isGo).toBe(false);
    expect(d.problemas.some((p) => p.startsWith('CATALOGO_CUSTOM_OMITE_OBRIGATORIO'))).toBe(true);
  });

  test("aprovação humana só vale como o booleano `true` (truthiness não aprova)", () => {
    for (const valor of ['false', 'true', 1, {}, []]) {
      const d = decidirVeredito({ checks: cheio(), aprovacaoHumana: valor });
      expect(d.veredito).toBe('PENDING_HUMAN_APPROVAL');
      expect(d.isGo).toBe(false);
    }
  });

  test('status inconclusivo com caractere de largura zero ou fullwidth não escapa', () => {
    for (const status of ['UNKNOWN\u200b', 'ＵＮＫＮＯＷＮ', 'TiMeOut\u200d', 'NOT_EXECUTED\ufeff']) {
      const checks = cheio({ QUEUE_CLOSURE_EVIDENCE: { ok: true, status, bloqueante: true, detalhe: 'x' } });
      const d = decidirVeredito({ checks, aprovacaoHumana: true });
      expect(d.veredito).toBe('NOT_READY');
    }
  });
});

// ─── 3ª passada da revisão independente (A7-1) ──────────────────────────────

describe('P1-D — status usa ALLOWLIST de conclusivos (A7-1)', () => {
  test('status desconhecido é inconclusivo, não passa por omissão', () => {
    const checks = cheio({ QUEUE_CLOSURE_EVIDENCE: { ok: true, status: 'GARBAGE', bloqueante: true, detalhe: 'x' } });
    const d = decidirVeredito({ checks, aprovacaoHumana: true });
    expect(d.veredito).toBe('NOT_READY');
    expect(d.problemas.some((p) => p.startsWith('CHECK_STATUS_DESCONHECIDO'))).toBe(true);
  });

  test('format chars fora da lista antiga também são removidos', () => {
    for (const status of ['UNKNOWN\u2060', 'UNKNOWN\u00ad', 'UNKNOWN\u180e']) {
      const checks = cheio({ QUEUE_CLOSURE_EVIDENCE: { ok: true, status, bloqueante: true, detalhe: 'x' } });
      expect(decidirVeredito({ checks, aprovacaoHumana: true }).veredito).toBe('NOT_READY');
    }
  });

  test('status conclusivo explícito continua passando', () => {
    for (const status of ['PASS', 'OK', 'pass ']) {
      const checks = cheio({ QUEUE_CLOSURE_EVIDENCE: { ok: true, status, bloqueante: true, detalhe: 'x' } });
      expect(decidirVeredito({ checks, aprovacaoHumana: true }).veredito).toBe('ENGINEER_SUPERVISED_READY_GO');
    }
  });
});
