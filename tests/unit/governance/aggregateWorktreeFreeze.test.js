'use strict';

/**
 * HARDENING-ENG-GOV-RELEASE-AGREGADO-EXIGE-WORKTREE-CONGELADO — o agregado mede UMA árvore.
 *
 * Defeito medido (2026-10-16, agg7): commitei duas vezes ENQUANTO o agregado rodava. O passo de
 * runtime do Engineering Router deriva `expectedBaseCommit` do HEAD real e calcula tree hashes;
 * com o HEAD andando no meio, `expected != validated` e a promoção foi recusada — o gate ficou RED
 * por causa do commit, não do código. Sem medir o estado antes e depois, esse RED é
 * indistinguível de regressão real (e o contrário também: um PASS medido em duas árvores é pior).
 *
 * A regra implementada é CONGELAMENTO, não limpeza: exigir `worktree limpo` bloquearia o trabalho
 * normal. O que não pode é o estado MUDAR embaixo do medidor.
 */

const {
  avaliarCongelamento,
  capturarEstadoDaArvore,
  executarCadeia,
  lerCadeia,
} = require('../../../scripts/governance/run-governance-enforcement');

const estado = (head, impressao) => ({ head, worktreeLimpo: impressao === 'vazio', impressaoWorktree: impressao });

describe('agregado — árvore congelada é pré-requisito do veredito', () => {
  test('mesmo HEAD e mesma impressão ⇒ congelado', () => {
    const r = avaliarCongelamento(estado('a'.repeat(40), 'h1'), estado('a'.repeat(40), 'h1'));
    expect(r.congelado).toBe(true);
    expect(r.codigo).toBeNull();
  });

  test('árvore SUJA mas estável continua congelada (a regra não exige limpeza)', () => {
    const r = avaliarCongelamento(estado('a'.repeat(40), 'sujo-1'), estado('a'.repeat(40), 'sujo-1'));
    expect(r.congelado).toBe(true);
  });

  test('HEAD mudou durante o run ⇒ HEAD_MUDOU_DURANTE_O_RUN (o defeito do agg7)', () => {
    const r = avaliarCongelamento(estado('a'.repeat(40), 'h1'), estado('b'.repeat(40), 'h2'));
    expect(r.congelado).toBe(false);
    expect(r.codigo).toBe('HEAD_MUDOU_DURANTE_O_RUN');
    expect(r.detalhe).toMatch(/mediu DUAS árvores/);
  });

  test('worktree mudou com HEAD igual ⇒ NÃO reprova, mas fica REGISTRADO', () => {
    // Os próprios validadores regravam evidência versionada durante o agregado. Reprovar por isso
    // deixaria o gate vermelho por desenho; o que invalida o veredito é o HEAD andar.
    const r = avaliarCongelamento(estado('a'.repeat(40), 'h1'), estado('a'.repeat(40), 'h2'));
    expect(r.congelado).toBe(true);
    expect(r.codigo).toBeNull();
    expect(r.worktreeMudou).toBe(true);
    expect(r.avisoWorktree).toMatch(/HEAD\) ficou estável/);
  });

  test('sem fotografia (ou sem HEAD resolvido) NÃO é congelado — fail-closed', () => {
    expect(avaliarCongelamento(null, estado('a'.repeat(40), 'h1')).codigo).toBe('ESTADO_NAO_MEDIDO');
    expect(avaliarCongelamento(estado('a'.repeat(40), 'h1'), undefined).codigo).toBe('ESTADO_NAO_MEDIDO');
    expect(avaliarCongelamento(estado(null, 'h1'), estado(null, 'h1')).codigo).toBe('HEAD_NAO_RESOLVIDO');
  });
});

describe('agregado — a fotografia real do repositório tem o formato que a regra consome', () => {
  test('capturarEstadoDaArvore devolve HEAD de 40 hex e impressão de 64 hex', () => {
    const e = capturarEstadoDaArvore();
    expect(e.head).toMatch(/^[0-9a-f]{40}$/);
    expect(e.impressaoWorktree).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof e.worktreeLimpo).toBe('boolean');
  });

  test('duas capturas seguidas, sem tocar em arquivo, são idênticas (determinismo)', () => {
    const a = capturarEstadoDaArvore();
    const b = capturarEstadoDaArvore();
    expect(avaliarCongelamento(a, b).congelado).toBe(true);
  });
});

describe('agregado — veredito reprova quando a árvore muda no meio (integração da etapa)', () => {
  const identidade = (head) => ({
    runId: 'run-teste-congelamento',
    sourceCommit: head,
    sourceFingerprint: 'f'.repeat(64),
  });
  // Cadeia REAL (lida do package.json): o escopo do agregado exige os passos obrigatórios, e um
  // teste com cadeia inventada mediria só o caminho de BLOCKED.
  const cadeia = lerCadeia();

  const executar = (sequencia) => {
    let i = 0;
    return executarCadeia({
      cadeia,
      id: identidade('a'.repeat(40)),
      autorizacao: { allowed: true, decision: 'AUTORIZADO', reasonCodes: [] },
      executor: () => ({ exitCode: 0, duracaoMs: 1, sha256Saida: 'a'.repeat(64), saidaFinal: 'ok' }),
      capturarEstado: () => sequencia[Math.min(i++, sequencia.length - 1)],
    });
  };

  test('todos os passos passando + árvore congelada ⇒ PASS', () => {
    const v = executar([estado('a'.repeat(40), 'h1')]);
    expect(v.status).toBe('PASS');
    const etapa = v.etapas.find((e) => e.etapa === 'CONGELAMENTO');
    expect(etapa.resultado).toBe('CONGELADO');
  });

  test('todos os passos passando + HEAD movido ⇒ FAIL nomeado (PASS nunca sobrevive à drift)', () => {
    const v = executar([estado('a'.repeat(40), 'h1'), estado('b'.repeat(40), 'h2')]);
    expect(v.status).toBe('FAIL');
    expect(v.motivo).toMatch(/HEAD_MUDOU_DURANTE_O_RUN/);
    expect(v.etapas.find((e) => e.etapa === 'CONGELAMENTO').resultado).toBe('MUDOU');
  });

  test('worktree mexido durante o run mantém o PASS e registra o aviso na etapa', () => {
    const v = executar([estado('a'.repeat(40), 'h1'), estado('a'.repeat(40), 'h2')]);
    expect(v.status).toBe('PASS');
    const etapa = v.etapas.find((e) => e.etapa === 'CONGELAMENTO');
    expect(etapa.worktreeMudou).toBe(true);
    expect(etapa.avisoWorktree).toMatch(/evidência versionada/);
  });
});
