'use strict';

/**
 * P0-01 — COBERTURA INTEGRAL DE FASE (auditoria 2026-10-19, SHA 511ae5249).
 *
 * Defeito reproduzido na baseline: `avaliarEstadosPorFase()` devolvia `PASS`
 * para a fase D (7 passos obrigatórios) com UM único resultado aprovado, porque
 * o avaliador só olhava os resultados PRESENTES. Ausência não tem linha — logo
 * "tudo que existe está ok" virou sinônimo de "a fase está completa".
 *
 * Este arquivo fixa o contrato: 23 cenários inválidos são REJEITADOS e o
 * cenário legítimo (conjunto obrigatório completo, com evidência real em disco e
 * digest correto) continua PASSANDO. Só rejeitar não prova nada: sem o caso
 * positivo o contrato poderia ser "sempre vermelho".
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const {
  ESTADOS,
  passosObrigatoriosDaFase,
  validarCoberturaDeFase,
  sha256,
} = require('../../../scripts/ci/phase-step-contract');

const { PASSOS, parseFases, decidirVeredito, FASES_OBRIGATORIAS_VALIDACAO_COMPLETA } = require('../../../scripts/ci/dev-branch-gate.js');

const SHA = '511ae5249d906eca21d2cb1f818b110e09ca896f';
const RUN = 'exec-p0-01';
const CONTEXTO = { sha: SHA, execucaoId: RUN };

const DEFINICAO_D = PASSOS.D;
const IDS_D = passosObrigatoriosDaFase(DEFINICAO_D);

let EVID_DIR;

beforeAll(() => {
  EVID_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'p001-evid-'));
});

afterAll(() => {
  fs.rmSync(EVID_DIR, { recursive: true, force: true });
});

/** Evidência real (arquivo em disco) com digest do conteúdo. */
function evidencia(id, conteudo) {
  const texto = conteudo !== undefined ? conteudo : `saida de ${id}`;
  const arquivo = path.join(EVID_DIR, `${id.replace(/[^A-Za-z0-9_.-]/g, '_')}.log`);
  fs.writeFileSync(arquivo, texto, 'utf8');
  return { saidaRef: arquivo, sha256Saida: sha256(texto) };
}

/** Resultado real aprovado de um passo obrigatório da fase D. */
function passoD(id, extra = {}) {
  return {
    id,
    fase: 'D',
    comando: 'node scripts/governance/...',
    exitCode: 0,
    timeout: false,
    naoExecutado: false,
    duracaoMs: 100,
    sha: SHA,
    execucaoId: RUN,
    saidaFinal: 'ok',
    ...evidencia(id),
    ...extra,
  };
}

function conjuntoCompleto(overrides = {}) {
  return IDS_D.map((id) => passoD(id, overrides[id] || {}));
}

function validar(resultados, { definicao = DEFINICAO_D, contexto = CONTEXTO, timeoutsIds } = {}) {
  return validarCoberturaDeFase({
    fase: 'D',
    definicao,
    resultados,
    contexto,
    timeoutsIds,
    raiz: '/',
    lerEvidencia: (_raiz, ref) => fs.readFileSync(ref, 'utf8'),
  });
}

const TOTAL_D = IDS_D.length;

describe('P0-01 — contrato de cobertura: a fase D é o conjunto EXATO de integridade de desenvolvimento', () => {
  test('a fase D contém só gates de desenvolvimento, na ordem canônica', () => {
    // MISSÃO 2026-10-22: a certificação de release (cadeia, self-proving, decisão canônica) saiu de D
    // para a fase R. Este teste PINa o conjunto — mover um gate de escopo sem atualizar o contrato
    // falha aqui em vez de passar silenciosamente.
    expect(IDS_D).toEqual([
      'L1-release-dag',
      'L1-fila-oficial',
      'L1-ai-memory',
      'L1-aderencia-agente',
    ]);
    expect(new Set(IDS_D).size).toBe(TOTAL_D);
    expect(Object.isFrozen(PASSOS)).toBe(true);
  });

  test('a fase R (certificação de release) é obrigatória para validação completa', () => {
    const idsR = passosObrigatoriosDaFase(PASSOS.R);
    // Fase 3 (missão D): a asserção de ESTADO CANÔNICO das projeções saiu do L2 (dependia de
    // `governance/rap-master-scorecard.json`, artefato de run governado) e passou a ser exigida
    // AQUI — o controle de certificação continua obrigatório, apenas no lugar certo.
    expect(idsR).toEqual([
      'L1-cadeia-criptografica',
      'L1-self-proving',
      'L1-projecao-estado-canonico',
      'L1-decisao-canonica',
    ]);
    const certificacao = PASSOS.R.find((p) => p.id === 'L1-projecao-estado-canonico');
    expect(certificacao.comando).toContain('test:certification');
    // Se R deixar de ser obrigatória, "validação completa" passaria a não exigir certificação de
    // release — exatamente o furo que a separação existe para evitar.
    expect(FASES_OBRIGATORIAS_VALIDACAO_COMPLETA).toContain('R');
  });
});

describe('P0-01 — 23 cenários inválidos NUNCA produzem PASS', () => {
  test('1. nenhum passo executado', () => {
    const r = validar([]);
    expect(r.estado).toBe(ESTADOS.NOT_EXECUTED);
  });

  test('2. apenas um passo aprovado em fase com vários obrigatórios', () => {
    const r = validar([passoD(IDS_D[0])]);
    expect(r.estado).toBe(ESTADOS.INCOMPLETE);
    expect(r.motivo).toContain('PASSOS_AUSENTES');
    expect(r.detalhes.ausentes).toHaveLength(TOTAL_D - 1);
  });

  test('3. seis de sete passos aprovados', () => {
    const r = validar(conjuntoCompleto().slice(0, TOTAL_D - 1));
    expect(r.estado).toBe(ESTADOS.INCOMPLETE);
    expect(r.detalhes.ausentes).toEqual([IDS_D[TOTAL_D - 1]]);
  });

  test('4. sete resultados com um id duplicado e outro ausente', () => {
    const sete = conjuntoCompleto();
    // remove o último obrigatório e duplica o primeiro: continua "7 resultados"
    const fraudulento = [...sete.slice(0, TOTAL_D - 1), passoD(IDS_D[0])];
    const r = validar(fraudulento);
    expect(r.estado).toBe(ESTADOS.INCOMPLETE);
    expect(r.motivo).toContain('PASSO_DUPLICADO');
  });

  test('5. todos aprovados, mas um sem evidência', () => {
    const semEvidencia = conjuntoCompleto();
    delete semEvidencia[3].saidaRef;
    const r = validar(semEvidencia);
    expect(r.estado).toBe(ESTADOS.INCOMPLETE);
    expect(r.motivo).toContain('EVIDENCIA_AUSENTE');
  });

  test('6. SHA divergente (evidência de outro commit)', () => {
    const outro = conjuntoCompleto();
    outro[2] = passoD(IDS_D[2], { sha: 'f'.repeat(40) });
    const r = validar(outro);
    expect(r.estado).toBe(ESTADOS.UNKNOWN);
    expect(r.motivo).toContain('EVIDENCIA_DE_OUTRO_SHA');
  });

  test('7. RunId divergente', () => {
    const outro = conjuntoCompleto();
    outro[TOTAL_D - 1] = passoD(IDS_D[TOTAL_D - 1], { execucaoId: 'exec-anterior' });
    const r = validar(outro);
    expect(r.estado).toBe(ESTADOS.UNKNOWN);
    expect(r.motivo).toContain('EVIDENCIA_DE_OUTRA_EXECUCAO');
  });

  test('8. passo desconhecido no lugar de um obrigatório', () => {
    const invadido = conjuntoCompleto().slice(0, TOTAL_D - 1);
    invadido.push(passoD('L1-passo-inventado'));
    const r = validar(invadido);
    expect(r.estado).toBe(ESTADOS.INCOMPLETE);
    expect(r.motivo).toContain('PASSO_DESCONHECIDO');
  });

  test('9. passo obrigatório com NOT_EXECUTED', () => {
    const parcial = conjuntoCompleto();
    parcial[1] = passoD(IDS_D[1], { exitCode: null, estado: 'NOT_EXECUTED' });
    const r = validar(parcial);
    expect(r.estado).toBe(ESTADOS.INCOMPLETE);
  });

  test('10. passo obrigatório com UNKNOWN', () => {
    const parcial = conjuntoCompleto();
    parcial[TOTAL_D - 2] = passoD(IDS_D[TOTAL_D - 2], { status: 'UNKNOWN' });
    const r = validar(parcial);
    expect(r.estado).toBe(ESTADOS.INCOMPLETE);
    expect(r.motivo).toContain('PASSO_EM_ESTADO_NAO_APROVADO');
  });

  test('11. passo obrigatório com SKIPPED não autorizado', () => {
    const parcial = conjuntoCompleto();
    parcial[TOTAL_D - 1] = passoD(IDS_D[TOTAL_D - 1], { status: 'SKIPPED' });
    const r = validar(parcial);
    expect(r.estado).toBe(ESTADOS.INCOMPLETE);
    expect(r.motivo).toContain('PASSO_PULADO_NAO_AUTORIZADO');
  });

  test('12. exit code não zero', () => {
    const falho = conjuntoCompleto();
    falho[0] = passoD(IDS_D[0], { exitCode: 1 });
    const r = validar(falho);
    expect(r.estado).toBe(ESTADOS.FAIL);
    expect(r.motivo).toContain('PASSO_FALHOU');
  });

  test('13. timeout', () => {
    const estourado = conjuntoCompleto();
    estourado[3] = passoD(IDS_D[3], { timeout: true, exitCode: null });
    const r = validar(estourado);
    expect(r.estado).toBe(ESTADOS.BLOCKED);
    expect(r.motivo).toContain('TIMEOUT');
  });

  test('14. encerramento por sinal (sem exit code)', () => {
    const morto = conjuntoCompleto();
    morto[2] = passoD(IDS_D[2], { exitCode: null });
    const r = validar(morto);
    expect(r.estado).toBe(ESTADOS.BLOCKED);
    expect(r.motivo).toContain('SEM_EXIT_CODE');
  });

  test('15. "PASS" textual com subprocesso FAIL continua FAIL', () => {
    const mentiroso = conjuntoCompleto();
    mentiroso[1] = passoD(IDS_D[1], { exitCode: 2, saidaFinal: 'PASS', status: 'PASS' });
    const r = validar(mentiroso);
    expect(r.estado).toBe(ESTADOS.FAIL);
  });

  test('16. relatório antigo reutilizado (outro run) não preenche a fase', () => {
    const antigo = conjuntoCompleto().map((p) => ({ ...p, execucaoId: 'exec-2026-10-18' }));
    const r = validar(antigo);
    expect(r.estado).toBe(ESTADOS.UNKNOWN);
  });

  test('17. evidência alterada depois da execução', () => {
    const adulterado = conjuntoCompleto();
    fs.appendFileSync(adulterado[TOTAL_D - 1].saidaRef, '\nlinha injetada apos a execucao', 'utf8');
    const r = validar(adulterado);
    expect(r.estado).toBe(ESTADOS.INCOMPLETE);
    expect(r.motivo).toContain('EVIDENCIA_ADULTERADA');
  });

  test('18. ordem inválida quando a definição declara dependência', () => {
    const definicaoComOrdem = [
      { id: 'passo-base' },
      { id: 'passo-dependente', depoisDe: 'passo-base' },
    ];
    const base = {
      fase: 'D', comando: 'x', exitCode: 0, timeout: false, naoExecutado: false,
      sha: SHA, execucaoId: RUN, ...evidencia('ordem'),
    };
    const r = validarCoberturaDeFase({
      fase: 'D',
      definicao: definicaoComOrdem,
      resultados: [
        { ...base, id: 'passo-dependente', ...evidencia('ordem-dependente') },
        { ...base, id: 'passo-base', ...evidencia('ordem-base') },
      ],
      contexto: CONTEXTO,
      raiz: '/',
      lerEvidencia: (_r, ref) => fs.readFileSync(ref, 'utf8'),
    });
    expect(r.estado).toBe(ESTADOS.INCOMPLETE);
    expect(r.motivo).toContain('ORDEM_INVALIDA');
  });

  test('19. fases duplicadas na entrada', () => {
    const r = parseFases('A,A,A,A');
    expect(r.invalido).toBe(true);
    expect(r.motivo).toBe('FASE_DUPLICADA:A');
  });

  test('20. fases ausentes nunca produzem PASS completo', () => {
    const estados = [
      { fase: 'A', estado: ESTADOS.PASS },
      { fase: 'B', estado: ESTADOS.NOT_APPLICABLE },
      { fase: 'C', estado: ESTADOS.PASS },
    ];
    expect(decidirVeredito({ entradaInvalida: null, identidade: { ok: true }, estados })).toBe('PASS_PARCIAL');
  });

  test('21. execução parcial interrompida (resultado sem exit code)', () => {
    const interrompido = conjuntoCompleto();
    delete interrompido[TOTAL_D - 1].exitCode;
    const r = validar(interrompido);
    expect(r.estado).toBe(ESTADOS.BLOCKED);
  });

  test('22. tentativa de reduzir a lista obrigatória pelo próprio resultado', () => {
    const fraudulento = conjuntoCompleto().slice(0, 2).map((p) => ({
      ...p,
      obrigatorio: false,
      opcional: true,
      reduzObrigatorios: ['ok'],
    }));
    const r = validar(fraudulento);
    expect(r.estado).toBe(ESTADOS.INCOMPLETE);
    expect(r.detalhes.esperados).toHaveLength(TOTAL_D);
  });

  test('23. tentativa de falsificar o número de passos', () => {
    const fraudulento = conjuntoCompleto().slice(0, 1).map((p) => ({
      ...p,
      passosReais: 7,
      totalPassos: 7,
      cobertura: '100%',
    }));
    const r = validar(fraudulento);
    expect(r.estado).toBe(ESTADOS.INCOMPLETE);
  });
});

describe('P0-01 — o cenário legítimo continua APROVADO (não vacuidade)', () => {
  test('24. conjunto completo, aprovado e com evidência verificável ⇒ PASS', () => {
    const r = validar(conjuntoCompleto());
    expect(r.motivo).toBeNull();
    expect(r.estado).toBe(ESTADOS.PASS);
    expect(r.detalhes.aprovados).toBe(TOTAL_D);
  });

  test('o mesmo conjunto SEM uma evidência passa a INCOMPLETE (o PASS depende do contrato)', () => {
    const completo = conjuntoCompleto();
    fs.rmSync(completo[2].saidaRef, { force: true });
    const r = validar(completo);
    expect(r.estado).toBe(ESTADOS.INCOMPLETE);
    expect(r.motivo).toContain('EVIDENCIA_INEXISTENTE');
  });
});

describe('P0-01 — integração com decidirVeredito', () => {
  test('fase D INCOMPLETE nunca vira PASS global', () => {
    const estados = FASES_OBRIGATORIAS_VALIDACAO_COMPLETA.map((fase) => ({
      fase,
      estado: fase === 'D' ? 'INCOMPLETE' : (fase === 'A' ? 'PASS' : (fase === 'B' ? 'NOT_APPLICABLE' : 'PASS')),
    }));
    expect(decidirVeredito({ entradaInvalida: null, identidade: { ok: true }, estados })).toBe('INCONCLUSIVO');
  });
});
