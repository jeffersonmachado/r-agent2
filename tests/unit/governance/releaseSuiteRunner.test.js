'use strict';

/**
 * Runner canônico — MAPEAMENTO do relatório do Jest para os estados do manifesto.
 *
 * Dois defeitos reais aconteceram exatamente aqui (2026-09-25), e ambos passariam por `node
 * --check`:
 *
 *   1. `numTotalTests` lido no NÍVEL DA SUÍTE — no JSON do Jest esse campo só existe na raiz; por
 *      suíte o que existe é `assertionResults[]`. Toda suíte virava "executou ZERO testes", ou
 *      seja, uma execução 100% verde era reprovada (e o inverso poderia aprovar suíte vazia);
 *   2. variável de decisão perdida numa edição (ReferenceError em runtime).
 *
 * Este teste fixa o mapeamento contra a ESTRUTURA REAL do Jest.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const { mapSuiteResult, buildJestArgs, collectBatchExitCodeViolations, avaliarReusoDeLote, suitesFingerprint, exitCodeDoRelatorioReusado, parsePidsVivos, ceifarGrupoDoLote } = require('../../../scripts/governance/run-release-suites');

function suite({ assertions = [], status = 'passed', message = '' }) {
  return {
    name: '/tmp/x.test.js',
    status,
    message,
    assertionResults: assertions.map((a) => ({ status: a })),
  };
}

describe('run-release-suites — mapSuiteResult', () => {
  it('conta os testes por assertionResults (o campo numTotalTests NÃO existe por suíte)', () => {
    const result = mapSuiteResult(suite({ assertions: ['passed', 'passed', 'passed'] }));
    expect(result.testsExecuted).toBe(3);
    expect(result.state).toBe('PASS');
  });

  it('suíte com ZERO testes é FAIL (nunca PASS vacuoso)', () => {
    const result = mapSuiteResult(suite({ assertions: [] }));
    expect(result.testsExecuted).toBe(0);
    expect(result.state).toBe('FAIL');
    expect(result.reason).toMatch(/ZERO testes/);
  });

  it('um único teste falhando marca a suíte inteira como FAIL', () => {
    const result = mapSuiteResult(suite({ assertions: ['passed', 'failed', 'passed'] }));
    expect(result.state).toBe('FAIL');
    expect(result.failed).toBe(1);
    expect(result.testsExecuted).toBe(3);
  });

  it('todos os testes pulados é NOT_EXECUTED (não conta como cobertura)', () => {
    const result = mapSuiteResult(suite({ assertions: ['pending', 'pending'] }));
    expect(result.state).toBe('NOT_EXECUTED');
    expect(result.skipped).toBe(2);
  });

  it('alguns pulados com o restante passando é PASS (pulo parcial é declarado, não é falha)', () => {
    const result = mapSuiteResult(suite({ assertions: ['passed', 'pending'] }));
    expect(result.state).toBe('PASS');
    expect(result.skipped).toBe(1);
    expect(result.testsExecuted).toBe(2);
  });

  it('INFRA_ERROR na mensagem de uma suíte que FALHOU tem estado próprio (não é FAIL genérico)', () => {
    // O `infraGate` LANÇA em modo autoritativo — a suíte fica `failed` com a mensagem. É esse o
    // cenário real. (Ler `message` de suíte que PASSOU seria a varredura de texto que causou o
    // falso positivo corrigido abaixo.)
    const result = mapSuiteResult(suite({ assertions: [], status: 'failed', message: 'INFRA_ERROR: postgres indisponível' }));
    expect(result.state).toBe('INFRA_ERROR');
  });

  it('INFRA_ERROR em failureMessages é detectado (estrutura, não texto de título)', () => {
    const result = {
      name: '/tmp/x.test.js',
      status: 'failed',
      message: 'suite falhou',
      assertionResults: [{ status: 'failed', title: 'DB', failureMessages: ['Error: INFRA_ERROR: postgres indisponível'] }],
    };
    expect(mapSuiteResult(result).state).toBe('INFRA_ERROR');
  });

  it('REGRESSÃO: a PALAVRA INFRA_ERROR no título de um teste que PASSOU não classifica a suíte', () => {
    // Defeito real: a varredura usava JSON.stringify(assertionResults), que inclui títulos. A
    // suíte que testa este mapeador tem casos com "INFRA_ERROR" no título e passou a ser marcada
    // como INFRA_ERROR no modo autoritativo — reprovando uma execução 100% verde.
    const result = {
      name: '/tmp/x.test.js',
      status: 'passed',
      message: '',
      assertionResults: [
        { status: 'passed', title: 'INFRA_ERROR em failureMessages é detectado', failureMessages: [] },
        { status: 'passed', title: 'INFRA_ERROR no erro de um teste', failureMessages: [] },
      ],
    };
    expect(mapSuiteResult(result).state).toBe('PASS');
  });

  it('REGRESSÃO: mensagem de FALHA real sem INFRA_ERROR continua FAIL (não vira estado especial)', () => {
    const result = {
      name: '/tmp/x.test.js',
      status: 'failed',
      message: 'expect(received).toBe(expected)',
      assertionResults: [{ status: 'failed', title: 'X', failureMessages: ['expect(received).toBe(expected)'] }],
    };
    expect(mapSuiteResult(result).state).toBe('FAIL');
  });

  it('suíte marcada failed sem assertions é FAIL (erro de suíte, não zero testes silencioso)', () => {
    const result = mapSuiteResult(suite({ assertions: [], status: 'failed', message: 'Cannot find module' }));
    expect(result.state).toBe('FAIL');
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });

  it('estrutura ausente não derruba o mapeamento (relatório malformado ⇒ FAIL, nunca exceção)', () => {
    expect(mapSuiteResult({ name: '/tmp/y.test.js' }).state).toBe('FAIL');
    expect(mapSuiteResult({}).state).toBe('FAIL');
  });
});

/**
 * POLÍTICA DE EXECUÇÃO DO LOTE — um lote NUNCA pode ser truncado.
 *
 * Defeito real medido em 2026-10-08: o `jest.config.cjs` traz `bail: 1` (comentado como "útil para
 * debug") e o runner não o desligava. O Jest abortava no primeiro teste falho do lote e NÃO
 * escrevia o `--outputFile`: as 6 suítes do lote viravam `MANIFEST_SUITE_NOT_EXECUTED`. Uma falha
 * real (uma suíte) apagava a evidência das suítes que nem chegaram a rodar, e o relatório agregado
 * passava a dizer "não executada" em vez de nomear a que falhou — causa e resultado escondidos ao
 * mesmo tempo.
 */
describe('run-release-suites — política de execução do lote', () => {
  it('desliga o bail EXPLICITAMENTE (o bail do projeto é conveniência de debug, não política de gate)', () => {
    const args = buildJestArgs(['tests/unit/x.test.js'], '/tmp/batch-0.json');
    expect(args).toContain('--bail=0');
  });

  it('nenhum `--bail` diferente de 0 pode entrar nos argumentos', () => {
    const args = buildJestArgs(['tests/unit/x.test.js'], '/tmp/batch-0.json');
    const bailFlags = args.filter((a) => String(a).startsWith('--bail'));
    expect(bailFlags).toEqual(['--bail=0']);
  });

  it('mantém a serialização e o transporte do relatório do lote', () => {
    const args = buildJestArgs(['tests/unit/x.test.js', 'tests/unit/y.test.js'], '/tmp/batch-3.json');
    expect(args).toContain('--runInBand');
    expect(args).toContain('--json');
    expect(args).toContain('--outputFile=/tmp/batch-3.json');
    // as suítes pedidas são exatamente as que o lote executa — nenhuma some no caminho
    expect(args.filter((a) => a.startsWith('tests/'))).toEqual(['tests/unit/x.test.js', 'tests/unit/y.test.js']);
  });
});

/**
 * H1 (2026-10-11) — o PROCESSO do lote não pode ser ignorado.
 *
 * Defeito: `batchExitCodes` era registrado e nunca virava violação; um lote com
 * exit != 0 cujo JSON listava tudo aprovado deixava o relatório agregado em PASS.
 * "Não confundir ausência de erros registrados com sucesso comprovado" (regra 16).
 */
describe('run-release-suites — exit code do lote é autoridade (H1)', () => {
  it('JSON PASS com exit 1 ⇒ VIOLAÇÃO (testes aprovados não cancelam o processo)', () => {
    const violacoes = collectBatchExitCodeViolations({
      batchRuns: [{ exitCode: 1 }, { exitCode: 0 }],
      batchFailures: [],
    });
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0].code).toBe('BATCH_EXIT_CODE_NONZERO');
    expect(violacoes[0].batchIndex).toBe(0);
    expect(violacoes[0].detail).toMatch(/NÃO cancelam a falha do PROCESSO/);
  });

  it('exit 0 em todos os lotes ⇒ nenhuma violação (não é não-vacuidade às avessas)', () => {
    expect(collectBatchExitCodeViolations({ batchRuns: [{ exitCode: 0 }, { exitCode: 0 }] })).toEqual([]);
  });

  it('morto por sinal (exit null) ⇒ violação nomeada como sinal', () => {
    const violacoes = collectBatchExitCodeViolations({ batchRuns: [{ exitCode: null, signal: 'SIGKILL' }] });
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0].detail).toMatch(/morto por sinal/);
    expect(violacoes[0].detail).toMatch(/SIGKILL/);
  });

  it('lote já reportado como BATCH_REPORT_MISSING não gera violação duplicada', () => {
    const violacoes = collectBatchExitCodeViolations({
      batchRuns: [{ exitCode: 1 }],
      batchFailures: [{ batchIndex: 0 }],
    });
    expect(violacoes).toEqual([]);
  });

  // P0-6 (2026-10-16): a isenção `reused === true` foi REMOVIDA. Ela existia porque o
  // lote reusado declarava `exitCode` derivado do JSON — não havia código real para
  // conferir. Com o contrato exigindo `exitCode === 0` do sidecar e o lote carregando
  // o valor real, a regra passa a valer nos DOIS caminhos: uma regressão futura no
  // contrato de reuso é pega aqui em vez de passar em silêncio.
  it('lote REUTILIZADO com exit != 0 É violação (isenção removida no P0-6)', () => {
    const violacoes = collectBatchExitCodeViolations({ batchRuns: [{ exitCode: 1, reused: true }] });
    expect(violacoes).toHaveLength(1);
    expect(violacoes[0].code).toBe('BATCH_EXIT_CODE_NONZERO');
    expect(violacoes[0].batchIndex).toBe(0);
  });

  it('lote REUTILIZADO com exit 0 (o único que o contrato permite) não gera violação', () => {
    expect(collectBatchExitCodeViolations({ batchRuns: [{ exitCode: 0, reused: true }] })).toEqual([]);
  });

  it('a violação é suficiente para impedir PASS (não-vacuidade do gate)', () => {
    // Espelha o cálculo do runner: `status = violationCount === 0 ? 'PASS' : 'FAIL'`.
    const violacoes = collectBatchExitCodeViolations({ batchRuns: [{ exitCode: 130 }] });
    const status = violacoes.length === 0 ? 'PASS' : 'FAIL';
    expect(status).toBe('FAIL');
  });
});

// ── Fase 6: reuso de evidência com CONTRATO ─────────────────────────────────────
//
// DEFEITO MEDIDO (2026-10-11): o reuso era `if (reuse && fs.existsSync(outputFile))`
// — aceitava QUALQUER relatório de lote presente, inventava `exitCode: 0` e não
// conferia nada. Com `RELEASE_SUITES_REUSE_BATCHES=1`, um relatório de um COMMIT
// ANTERIOR (tudo verde) sustentava uma execução nova: falso verde por reutilização
// de evidência incompatível, e o relatório agregado ainda exibia as suítes como
// aprovadas.
describe('run-release-suites — contrato de reuso de lote (Fase 6)', () => {
  const suites = ['a.test.js', 'b.test.js'];
  const identidade = { runId: 'R1', sourceCommit: 'C1', sourceFingerprint: 'F1' };
  const metaValido = {
    ...identidade,
    suitesHash: suitesFingerprint(suites),
    resultHash: 'HASH-DO-RESULTADO',
    // Código REAL do processo do lote, gravado no sidecar desde 2026-10-11. É exigido
    // pelo contrato de reuso desde o P0-6 (2026-10-16).
    exitCode: 0,
  };
  const avaliar = (extra = {}) => avaliarReusoDeLote({
    meta: metaValido,
    identidade,
    suites,
    resultHash: 'HASH-DO-RESULTADO',
    // Relatório do lote declarando sucesso (`json.success === true`).
    resultExitCode: 0,
    ...extra,
  });

  it('sem sidecar de binding NÃO reusa (fail-closed: procedência desconhecida)', () => {
    expect(avaliar({ meta: null })).toEqual({ reuse: false, reason: 'META_MISSING' });
    expect(avaliar({ meta: undefined }).reason).toBe('META_MISSING');
  });

  it('sem run governado NÃO reusa', () => {
    expect(avaliar({ identidade: { runId: null, sourceCommit: 'C1', sourceFingerprint: 'F1' } }).reason)
      .toBe('NO_GOVERNED_RUN');
  });

  it('runId diferente NÃO reusa', () => {
    expect(avaliar({ meta: { ...metaValido, runId: 'R2' } }).reason).toBe('RUN_MISMATCH');
  });

  it('commit diferente NÃO reusa', () => {
    expect(avaliar({ meta: { ...metaValido, sourceCommit: 'C9' } }).reason).toBe('SOURCE_COMMIT_MISMATCH');
  });

  it('fingerprint de source diferente NÃO reusa', () => {
    expect(avaliar({ meta: { ...metaValido, sourceFingerprint: 'F9' } }).reason)
      .toBe('SOURCE_FINGERPRINT_MISMATCH');
  });

  it('plano de suítes diferente NÃO reusa (o lote agora contém outras suítes)', () => {
    expect(avaliar({ meta: { ...metaValido, suitesHash: suitesFingerprint(['z.test.js']) } }).reason)
      .toBe('SUITE_PLAN_MISMATCH');
  });

  it('hash do resultado diferente NÃO reusa (relatório adulterado/trocado)', () => {
    expect(avaliar({ resultHash: 'OUTRO-HASH' }).reason).toBe('RESULT_HASH_MISMATCH');
    expect(avaliar({ meta: { ...metaValido, resultHash: 'OUTRO' } }).reason).toBe('RESULT_HASH_MISMATCH');
    expect(avaliar({ resultHash: null }).reason).toBe('RESULT_HASH_MISMATCH');
  });

  it('com binding completo e idêntico, reusa — e atesta o exit code real', () => {
    expect(avaliar()).toEqual({ reuse: true, reason: null, exitCode: 0 });
  });

  // ── P0-6 (medido 2026-10-16): o CÓDIGO DE SAÍDA do processo original ────────────
  // O JSON do Jest é escrito ANTES do teardown: um lote cujo processo morreu depois
  // (handle aberto, rejeição não tratada, forceExit, sinal) deixa JSON verde com
  // `status != 0`. O contrato conferia run/commit/fingerprint/plano/hash e NUNCA o
  // código real — o falso verde era propagado para o run corrente.
  it('processo original com exit != 0 NÃO reusa (o JSON verde não cancela o processo)', () => {
    expect(avaliar({ meta: { ...metaValido, exitCode: 1 } }).reason).toBe('ORIGINAL_EXIT_CODE_NONZERO');
    expect(avaliar({ meta: { ...metaValido, exitCode: 130 } }).reason).toBe('ORIGINAL_EXIT_CODE_NONZERO');
  });

  it('lote morto por SINAL (exit null) NÃO reusa', () => {
    expect(avaliar({ meta: { ...metaValido, exitCode: null, signal: 'SIGKILL' } }).reason)
      .toBe('ORIGINAL_EXIT_CODE_NONZERO');
  });

  it('sidecar do formato ANTERIOR (sem o campo) NÃO reusa — fail-closed, não presumido limpo', () => {
    const semCampo = { ...metaValido };
    delete semCampo.exitCode;
    expect(avaliar({ meta: semCampo }).reason).toBe('ORIGINAL_EXIT_CODE_NONZERO');
  });

  it('relatório do lote SEM `success: true` NÃO reusa (coerência relatório↔processo)', () => {
    // O processo prova que nada falhou DEPOIS dos testes; o relatório prova que os
    // testes passaram. Nenhum dos dois substitui o outro.
    expect(avaliar({ resultExitCode: 1 }).reason).toBe('RESULT_REPORT_NOT_SUCCESS');
  });

  // Esta função deixou de ser a fonte do `exitCode` do lote reusado (hoje é o valor
  // REAL do sidecar, validado pelo contrato); ela segue sendo a checagem de COERÊNCIA
  // do relatório dentro do contrato (`RESULT_REPORT_NOT_SUCCESS`).
  it('exitCodeDoRelatorioReusado: relatório sem sucesso nunca vale 0', () => {
    expect(exitCodeDoRelatorioReusado({ success: true })).toBe(0);
    expect(exitCodeDoRelatorioReusado({ success: false })).toBe(1);
    expect(exitCodeDoRelatorioReusado({})).toBe(1);
    expect(exitCodeDoRelatorioReusado(null)).toBe(1);
  });

  it('o fingerprint do plano é insensível à ORDEM mas sensível ao CONTEÚDO', () => {
    expect(suitesFingerprint(['b', 'a'])).toBe(suitesFingerprint(['a', 'b']));
    expect(suitesFingerprint(['a'])).not.toBe(suitesFingerprint(['a', 'b']));
  });

  it('a recusa de reuso é registrada no relatório (não pode ser silenciosa)', () => {
    const fonte = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'run-release-suites.js'),
      'utf8',
    );
    expect(fonte).toContain('reuseRejections');
    expect(fonte).toMatch(/report\.reuseRejections\s*=\s*reuseRejections/);
    // E o reuso NÃO pode voltar a ser "existe arquivo, então serve".
    expect(fonte).not.toMatch(/if\s*\(\s*reuse\s*&&\s*fs\.existsSync\(outputFile\)\s*\)\s*\{\s*\n\s*try/);
  });
});

// ── Fase 6: isolamento entre lotes com PROVA DE SAÍDA ────────────────────────────
//
// DEFEITO: a ceifa do grupo do lote chamava `process.kill(-pid, 'SIGTERM')` e
// marcava `reaped = true`. Enviar o sinal NÃO é prova de que o processo morreu — o
// grupo pode ter sobreviventes segurando conexões, que é a causa medida da falha do
// lote seguinte. E `ps -o pid= -g <pgid>` lista ZUMBIS como se estivessem vivos, o
// que faria a verificação declarar sobrevivência com o grupo já morto (falso
// positivo que esconderia o caso real).
describe('run-release-suites — prova de saída do grupo do lote (Fase 6)', () => {
  it('zumbi NÃO conta como processo vivo do grupo', () => {
    const saida = [
      '  1234 Ss',
      '  1235 Z',
      '  1236 Sl',
      '  1237 Z+',
    ].join('\n');
    expect(parsePidsVivos(saida)).toEqual([1234, 1236]);
  });

  it('saída vazia/ilegível não inventa processo', () => {
    expect(parsePidsVivos('')).toEqual([]);
    expect(parsePidsVivos(null)).toEqual([]);
    expect(parsePidsVivos('não é ps')).toEqual([]);
  });

  it('grupo que já não existe ⇒ saída provada por AUSÊNCIA (não por sinal)', () => {
    const r = ceifarGrupoDoLote(999999, { termTimeoutMs: 300, killTimeoutMs: 300 });
    expect(r.exitProof).toBe('ALREADY_GONE');
    expect(r.termEnviado).toBe(false);
    expect(r.sobreviventesAposTerm).toBe(0);
  });

  it('grupo que respeita SIGTERM ⇒ exitProof=TERM (sem precisar de KILL)', () => {
    const filho = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
    try {
      const r = ceifarGrupoDoLote(filho.pid, { termTimeoutMs: 5000, killTimeoutMs: 3000 });
      expect(r.termEnviado).toBe(true);
      expect(r.exitProof).toBe('TERM');
      expect(r.killEnviado).toBe(false);
    } finally {
      try { process.kill(-filho.pid, 'SIGKILL'); } catch (_) { /* já saiu */ }
    }
  });

  it('grupo que IGNORA SIGTERM ⇒ escala para SIGKILL e prova a saída', () => {
    const filho = spawn('bash', ['-c', 'trap "" TERM; sleep 30'], { detached: true, stdio: 'ignore' });
    try {
      const r = ceifarGrupoDoLote(filho.pid, { termTimeoutMs: 1500, killTimeoutMs: 5000 });
      expect(r.sobreviventesAposTerm).toBeGreaterThan(0);
      expect(r.killEnviado).toBe(true);
      expect(r.exitProof).toBe('KILL');
      expect(r.sobreviventesAposKill).toBe(0);
    } finally {
      try { process.kill(-filho.pid, 'SIGKILL'); } catch (_) { /* já saiu */ }
    }
  });

  it('a evidência do lote publica a prova de saída e o isolamento', () => {
    const fonte = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'run-release-suites.js'),
      'utf8',
    );
    expect(fonte).toContain('exitProof');
    expect(fonte).toContain('connectionDrains');
  });

  // DEFEITO DE AUDITORIA medido em 2026-10-20: o stdout integral do lote era descartado, e com ele
  // o diagnóstico estruturado que as suítes imprimem quando o ciclo não fecha
  // (`DIAG_NAO_FECHOU`). Só sobravam 40 linhas de `stdoutTail`, insuficientes para saber POR QUE o
  // lote falhou. Restringir o log ao lote que falhou é o ponto: o caminho feliz não paga o custo.
  it('lote que FALHA tem o log integral preservado (e o caminho feliz não escreve nada)', () => {
    const fonte = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'run-release-suites.js'),
      'utf8',
    );
    expect(fonte).toContain('stdoutLogPath');
    expect(fonte).toMatch(/if \(result\.status !== 0\) \{/);
    expect(fonte).toContain('.stdout.log');
  });

  // DEFEITO REAL medido em 2026-10-20: este script roda com `--env-file-if-exists=.env`, que define
  // ENGINEERING_RUNNER_URL=8090 (dev). Os lotes herdavam esse valor e subprocessos que recarregavam
  // o `.env` voltavam para 8090 — onde nada escuta — produzindo
  // `SANDBOX_UNAVAILABLE ... :8090: fetch failed` e missões BLOCKED. Quem define a URL do runner de
  // TESTE é o `globalSetup` do Jest (8097), nunca o `.env` herdado.
  it('o lote NÃO herda ENGINEERING_RUNNER_URL/TOKEN do ambiente do runner de suítes', () => {
    const fonte = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'run-release-suites.js'),
      'utf8',
    );
    expect(fonte).toContain('delete batchEnv.ENGINEERING_RUNNER_URL');
    expect(fonte).toContain('delete batchEnv.ENGINEERING_RUNNER_TOKEN');
    expect(fonte).toMatch(/env:\s*batchEnv,/);
  });

  // DEFEITO REAL medido em 2026-10-20 (selo V2 do run …db420779): o lote 4 caiu com
  // `SequelizeConnectionError: sorry, too many clients already` (max_connections=100) — o `.env`
  // declara DB_POOL_MAX=40 para a API de dev e a suíte herda esse teto, mesmo rodando --runInBand.
  // O lote passa a impor um teto próprio e pequeno (RELEASE_SUITES_DB_POOL_MAX, default 12).
  it('o lote impõe teto de pool próprio (DB_POOL_MAX), nunca o valor de dev do .env', () => {
    const fonte = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'run-release-suites.js'),
      'utf8',
    );
    expect(fonte).toContain('RELEASE_SUITES_DB_POOL_MAX');
    expect(fonte).toMatch(/batchEnv\.DB_POOL_MAX\s*=\s*String\(/);
    expect(fonte).toMatch(/Math\.min\(inheritedPool, batchPoolMax\)/);
  });
});
