'use strict';

/**
 * P0 (auditoria 2026-10-19) — FALSO PASS NO GATE DE DESENVOLVIMENTO.
 *
 * Defeito reproduzido contra a baseline `9758f828f`:
 *
 *   node scripts/ci/dev-branch-gate.js --fases A,A,A,A
 *   → veredito=PASS, equivalenteAValidacaoCompleta=true, exit=0
 *
 * com ZERO passos executados: o tamanho do array era usado como sinal de
 * cobertura e fases desconhecidas eram filtradas em silêncio.
 *
 * Este arquivo cobre os 14 cenários adversariais exigidos. Nenhuma combinação
 * incompleta ou fraudulenta pode produzir PASS nem equivalência a validação
 * completa.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');

const {
  parseFases,
  identidadeValida,
  avaliarEstadosPorFase,
  decidirVeredito,
  definirContextoExecucao,
  PASSOS,
  ESTADOS_DE_FASE,
  FASES_OBRIGATORIAS_VALIDACAO_COMPLETA,
} = require('../../../scripts/ci/dev-branch-gate.js');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const GATE = path.join(ROOT, 'scripts', 'ci', 'dev-branch-gate.js');
const crypto = require('crypto');

const SHA = '9758f828f3fdd0fb07c08ebe591de1ace8df2ebe';
const DIGEST = 'a'.repeat(64);
const EVID_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-fase-evid-'));

/** Evidência REAL em disco com o digest do próprio conteúdo. */
function evidenciaPara(id, conteudo = `saida de ${id}`) {
  const nome = `${id.replace(/[^A-Za-z0-9_.-]/g, '_')}.log`;
  const absoluto = path.join(EVID_DIR, nome);
  fs.writeFileSync(absoluto, conteudo, 'utf8');
  return {
    saidaRef: path.relative(ROOT, absoluto),
    sha256Saida: crypto.createHash('sha256').update(conteudo, 'utf8').digest('hex'),
  };
}

/** Todos os passos OBRIGATÓRIOS da fase com evidência válida. */
function passosCompletosDaFase(fase, extra = {}) {
  // Fase B é planejada dinamicamente (não tem definição fixa em PASSOS): mantém
  // o passo sintético usado pelos cenários de planejamento.
  if (!PASSOS[fase]) return [passo(fase, extra)];
  return (PASSOS[fase] || []).map((p) => {
    const ev = evidenciaPara(p.id);
    return passo(fase, { id: p.id, ...ev, ...extra });
  });
}

/** Passo real vinculado à execução corrente. */
function passo(fase, extra = {}) {
  return {
    id: `${fase}-passo`,
    fase,
    comando: 'npm test',
    exitCode: 0,
    timeout: false,
    naoExecutado: false,
    duracaoMs: 10,
    sha256Saida: DIGEST,
    sha: SHA,
    execucaoId: 'exec-1',
    saidaFinal: 'ok',
    ...extra,
  };
}

function avaliar({ fases, resultados, faseA = { ok: true, checks: [{ id: 'A1', ok: true }] }, bloqueio = null, contexto = { sha: SHA, execucaoId: 'exec-1' } }) {
  const timeouts = resultados.filter((r) => r.timeout === true);
  const estados = avaliarEstadosPorFase({ fasesPedidas: fases, faseA, resultados, bloqueio, timeouts, contexto });
  const veredito = decidirVeredito({ entradaInvalida: null, identidade: { ok: true }, estados, bloqueio });
  return { estados, veredito };
}

describe('P0 gate de fases — entrada inválida é RECUSADA (nunca filtrada em silêncio)', () => {
  test('1. fases duplicadas A,A,A,A', () => {
    const r = parseFases('A,A,A,A');
    expect(r.invalido).toBe(true);
    expect(r.motivo).toBe('FASE_DUPLICADA:A');
  });

  test('2. array vazio', () => {
    expect(parseFases('').invalido).toBe(true);
    expect(parseFases('').motivo).toBe('LISTA_DE_FASES_VAZIA');
    expect(parseFases(',,').invalido).toBe(true);
  });

  test('3. fases desconhecidas', () => {
    const r = parseFases('A,Z,9');
    expect(r.invalido).toBe(true);
    expect(r.motivo).toContain('FASE_DESCONHECIDA');
  });

  test('lista válida continua aceita', () => {
    const r = parseFases('A,B,C');
    expect(r.invalido).toBe(false);
    expect(r.fases).toEqual(['A', 'B', 'C']);
  });
});

describe('P0 gate de fases — identidade de execução', () => {
  test('SHA curto e branch vazia são rejeitados', () => {
    expect(identidadeValida('abc123', 'dev/x').ok).toBe(false);
    expect(identidadeValida(SHA, '').ok).toBe(false);
    expect(identidadeValida(SHA, '(desconhecida)').ok).toBe(false);
    expect(identidadeValida(SHA, 'dev/engineering-hardening').ok).toBe(true);
  });
});

describe('P0 gate de fases — comprovação de execução, não intenção', () => {
  test('4. fases corretas mas NÃO executadas não produzem PASS', () => {
    const { estados, veredito } = avaliar({
      fases: FASES_OBRIGATORIAS_VALIDACAO_COMPLETA.slice(),
      resultados: [],
    });
    expect(estados[0].estado).toBe(ESTADOS_DE_FASE.PASS); // fase A roda no pré-voo
    for (const e of estados.slice(1)) expect(e.estado).toBe(ESTADOS_DE_FASE.NOT_EXECUTED);
    expect(veredito).not.toBe('PASS');
    expect(veredito).toBe('INCONCLUSIVO');
  });

  test('5. fase executada SEM evidência (sem digest/sha/execução) é UNKNOWN', () => {
    const semDigest = avaliar({ fases: ['A', 'B'], resultados: [passo('B', { sha256Saida: 'curto' })] });
    expect(semDigest.estados.find((e) => e.fase === 'B').estado).toBe(ESTADOS_DE_FASE.UNKNOWN);
    expect(semDigest.estados.find((e) => e.fase === 'B').motivo).toContain('EVIDENCIA_SEM_DIGEST');

    const semVinculo = avaliar({ fases: ['A', 'B'], resultados: [passo('B', { sha: null, execucaoId: null })] });
    expect(semVinculo.estados.find((e) => e.fase === 'B').estado).toBe(ESTADOS_DE_FASE.UNKNOWN);
  });

  test('6. fase obrigatória ausente rebaixa para PASS_PARCIAL (nunca PASS)', () => {
    const fases = ['A', 'B', 'C'];
    const resultados = [...passosCompletosDaFase('B'), ...passosCompletosDaFase('C')];
    const { veredito, estados } = avaliar({ fases, resultados });
    expect(estados.every((e) => e.estado === ESTADOS_DE_FASE.PASS)).toBe(true);
    expect(veredito).toBe('PASS_PARCIAL');
  });

  test('todas as obrigatórias em PASS e comprovadas ⇒ PASS', () => {
    const fases = FASES_OBRIGATORIAS_VALIDACAO_COMPLETA.slice();
    const resultados = fases
      .filter((f) => f !== 'A')
      .flatMap((f) => passosCompletosDaFase(f));
    const { veredito } = avaliar({ fases, resultados });
    expect(veredito).toBe('PASS');
  });

  test('7. exit code não zero reprova a fase', () => {
    const { veredito, estados } = avaliar({ fases: ['A', 'B'], resultados: [passo('B', { exitCode: 1 })] });
    expect(estados.find((e) => e.fase === 'B').estado).toBe(ESTADOS_DE_FASE.FAIL);
    expect(veredito).toBe('FAIL');
  });

  test('8. processo encerrado por sinal (timeout do executor) é BLOCKED, não PASS', () => {
    const { veredito, estados } = avaliar({
      fases: ['A', 'B'],
      resultados: [passo('B', { exitCode: null, timeout: true })],
    });
    expect(estados.find((e) => e.fase === 'B').estado).toBe(ESTADOS_DE_FASE.BLOCKED);
    expect(veredito).toBe('BLOQUEADO_POR_TIMEOUT');
  });

  test('8b. passo reprovado no runner REAL (bloqueio PASSO_FALHOU) é FAIL, nunca BLOQUEADO_POR_TIMEOUT', () => {
    // Regressão do run 39614201981: `L0-suite-oficial` saiu exit=1 por asserção real e o
    // veredito publicado foi BLOQUEADO_POR_TIMEOUT, sugerindo orçamento de tempo.
    // `decidirVeredito` RETORNA a string do veredito (não um objeto): destruturar aqui
    // produziria `undefined` e o teste passaria a medir nada.
    const veredito = decidirVeredito({
      entradaInvalida: null,
      identidade: { ok: true },
      estados: [
        { fase: 'A', estado: ESTADOS_DE_FASE.PASS },
        { fase: 'B', estado: ESTADOS_DE_FASE.NOT_APPLICABLE },
        { fase: 'C', estado: ESTADOS_DE_FASE.BLOCKED, motivo: 'PASSO_FALHOU' },
        { fase: 'D', estado: ESTADOS_DE_FASE.NOT_EXECUTED },
      ],
      bloqueio: { fase: 'C', code: 'PASSO_FALHOU', detail: 'L0-suite-oficial exit=1' },
    });
    expect(veredito).toBe('FAIL');
    expect(veredito).not.toBe('BLOQUEADO_POR_TIMEOUT');
  });

  test('9. timeout não é confundido com falha de asserção', () => {
    const { veredito } = avaliar({ fases: ['A', 'B'], resultados: [passo('B', { exitCode: null, timeout: true })] });
    expect(veredito).not.toBe('FAIL');
  });

  test('10. evidência de outro SHA não conta', () => {
    const { estados, veredito } = avaliar({
      fases: ['A', 'B'],
      resultados: [passo('B', { sha: 'f'.repeat(40) })],
    });
    expect(estados.find((e) => e.fase === 'B').estado).toBe(ESTADOS_DE_FASE.UNKNOWN);
    expect(estados.find((e) => e.fase === 'B').motivo).toContain('EVIDENCIA_DE_OUTRO_SHA');
    expect(veredito).not.toBe('PASS');
  });

  test('11. evidência de outra execução (runId) não conta', () => {
    const { estados, veredito } = avaliar({
      fases: ['A', 'B'],
      resultados: [passo('B', { execucaoId: 'exec-antiga' })],
    });
    expect(estados.find((e) => e.fase === 'B').estado).toBe(ESTADOS_DE_FASE.UNKNOWN);
    expect(veredito).not.toBe('PASS');
  });

  test('12. "PASS" no stdout com exit != 0 continua FAIL', () => {
    const { veredito } = avaliar({
      fases: ['A', 'B'],
      resultados: [passo('B', { exitCode: 2, saidaFinal: 'ALL TESTS PASS — veredito: PASS' })],
    });
    expect(veredito).toBe('FAIL');
  });

  test('13. evidência antiga reutilizada não preenche fase', () => {
    const { estados } = avaliar({ fases: ['A', 'B', 'C'], resultados: [] });
    expect(estados.filter((e) => e.fase !== 'A').every((e) => e.estado === ESTADOS_DE_FASE.NOT_EXECUTED)).toBe(true);
  });

  test('14. fase com passo sintético (não executado) não vira PASS', () => {
    const { estados, veredito } = avaliar({
      fases: ['A', 'B'],
      resultados: [passo('B', { naoExecutado: true, exitCode: null })],
    });
    expect(estados.find((e) => e.fase === 'B').estado).toBe(ESTADOS_DE_FASE.NOT_EXECUTED);
    expect(veredito).not.toBe('PASS');
  });
});

describe('P0 gate de fases — execução real recusa antes de qualquer passo', () => {
  const dirEvid = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-evid-'));
  const outJson = path.join(dirEvid, 'evidencia.json');

  function rodar(args) {
    return spawnSync(process.execPath, [GATE, ...args, '--out', outJson], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, DEV_BRANCH_GATE_EVIDENCE_DIR: dirEvid },
      timeout: 120000,
    });
  }

  test('--fases A,A,A,A ⇒ ENTRADA_INVALIDA, completo=false, exit != 0', () => {
    const r = rodar(['--fases', 'A,A,A,A']);
    expect(r.status).not.toBe(0);
    const evidencia = JSON.parse(fs.readFileSync(outJson, 'utf8'));
    expect(evidencia.veredito).toBe('ENTRADA_INVALIDA');
    expect(evidencia.equivalenteAValidacaoCompleta).toBe(false);
    expect(evidencia.passos).toEqual([]);
  });

  test('--fases Z ⇒ ENTRADA_INVALIDA', () => {
    const r = rodar(['--fases', 'Z']);
    expect(r.status).not.toBe(0);
    const evidencia = JSON.parse(fs.readFileSync(outJson, 'utf8'));
    expect(evidencia.veredito).toBe('ENTRADA_INVALIDA');
    expect(evidencia.equivalenteAValidacaoCompleta).toBe(false);
  });

  test('o contexto de execução é único por rodada', () => {
    const a = definirContextoExecucao(SHA);
    const b = definirContextoExecucao(SHA);
    expect(a.execucaoId).not.toBe(b.execucaoId);
    expect(a.sha).toBe(SHA);
  });
});
