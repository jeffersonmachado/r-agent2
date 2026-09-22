'use strict';

/**
 * ER-V1-FINAL-009 (Full-Suite Isolation).
 *
 * RED reproduzido AO VIVO (não hipotético) rodando a suíte completa do Engineering Router em
 * paralelo (modo oficial padrão do Jest, sem --runInBand): `createSnapshotCommit()`
 * (patchApplyService.js) faz `git add -A` no repositório PRINCIPAL compartilhado por TODA a
 * suíte de testes do projeto — sob paralelismo real, um arquivo temporário criado por OUTRO
 * teste completamente não relacionado (`benchmarkChangeProposal.test.js`, via
 * `benchmarkSampleRegistry.js`, escrita atômica tmp+rename em `config/benchmarks/`) pode ser
 * removido entre o `readdir` interno do `git add -A` e o `stat` de cada arquivo — TOCTOU
 * clássico. Erro real capturado nesta sessão:
 *
 *   fatal: unable to stat 'config/benchmarks/__testbrcpf6351e6e.json': Arquivo ou diretório
 *   inexistente
 *
 * `tests/integration/engineeringRouterFullLoopE2E.test.js` falhava de forma real com
 * `createWorkspace` propagando esse erro, terminando a task inteira em erro em vez de RED/GREEN
 * determinístico — não é um problema de lógica do Engineering Router, é a mecânica de snapshot
 * do repositório compartilhado colidindo com QUALQUER outro teste do projeto que escreva
 * arquivos reais dentro do repositório.
 *
 * Não há como eliminar essa concorrência coordenando com todo o resto do projeto (fora de
 * escopo). A correção mínima e correta para uma classe de erro estruturalmente transitória
 * (arquivo existia no momento do scan, sumiu antes do stat) é: detectar o padrão específico e
 * reexecutar a sequência inteira do snapshot. Este teste prova esse retry de forma determinística
 * — via mock de `child_process.execFile` simulando a falha transitória real na primeira
 * chamada de `git add -A` e sucesso na segunda — em vez de depender de recriar a race real via
 * filesystem (não confiável, não determinístico).
 */

const mockExecFile = jest.fn();

// Node dá a `child_process.execFile` um `util.promisify.custom` nativo que resolve para
// `{stdout, stderr}` (não o array genérico que `util.promisify` produziria por padrão para um
// callback com mais de um valor de sucesso). O mock precisa replicar exatamente esse contrato —
// senão `patchApplyService.js` (que usa `util.promisify(execFile)`) recebe um array em vez do
// objeto esperado, quebrando a desestruturação `{ stdout }` de forma alheia ao que este teste
// realmente quer provar.
jest.mock('child_process', () => {
  // eslint-disable-next-line global-require
  const nodeUtil = require('util');
  function execFile(...args) {
    return mockExecFile(...args);
  }
  execFile[nodeUtil.promisify.custom] = (file, fileArgs, options) => new Promise((resolve, reject) => {
    mockExecFile(file, fileArgs, options, (err, stdout, stderr) => {
      if (err) {
        if (err.stdout === undefined) err.stdout = stdout;
        if (err.stderr === undefined) err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
  return { execFile };
});

function callbackOk(stdout = '') {
  return (cb) => cb(null, stdout, '');
}

function callbackTransientAddFailure() {
  const err = new Error('Command failed: git add -A\nfatal: unable to stat \'config/benchmarks/__testbrcpf6351e6e.json\': Arquivo ou diretório inexistente\n');
  err.stderr = 'fatal: unable to stat \'config/benchmarks/__testbrcpf6351e6e.json\': Arquivo ou diretório inexistente\n';
  err.stdout = '';
  return (cb) => cb(err);
}

function callbackFatalNonTransientFailure() {
  const err = new Error('Command failed: git add -A\nfatal: not a git repository\n');
  err.stderr = 'fatal: not a git repository\n';
  err.stdout = '';
  return (cb) => cb(err);
}

describe('ER-V1-FINAL-009 — createSnapshotCommit retenta apenas o erro transitório real de TOCTOU', () => {
  beforeEach(() => {
    jest.resetModules();
    mockExecFile.mockReset();
  });

  test('git add -A falha uma vez com "unable to stat" (arquivo sumiu durante o scan) → retenta e conclui com sucesso', async () => {
    let addCallCount = 0;
    mockExecFile.mockImplementation((file, args, options, callback) => {
      const cb = callback || options;
      if (args[0] === 'read-tree') return callbackOk()(cb);
      if (args[0] === 'add') {
        addCallCount += 1;
        if (addCallCount === 1) return callbackTransientAddFailure()(cb);
        return callbackOk()(cb);
      }
      if (args[0] === 'write-tree') return callbackOk('fake-tree-hash\n')(cb);
      if (args[0] === 'commit-tree') return callbackOk('fake-commit-hash\n')(cb);
      return callbackOk()(cb);
    });

    // eslint-disable-next-line global-require
    const { createSnapshotCommit } = require('../../api/services/engineeringRouter/patchApplyService');
    const result = await createSnapshotCommit();

    expect(result).toBe('fake-commit-hash');
    expect(addCallCount).toBe(2);
  });

  test('git add -A falha com erro NÃO transitório (ex.: repositório corrompido) → propaga imediatamente, sem retry', async () => {
    let addCallCount = 0;
    mockExecFile.mockImplementation((file, args, options, callback) => {
      const cb = callback || options;
      if (args[0] === 'read-tree') return callbackOk()(cb);
      if (args[0] === 'add') {
        addCallCount += 1;
        return callbackFatalNonTransientFailure()(cb);
      }
      return callbackOk()(cb);
    });

    // eslint-disable-next-line global-require
    const { createSnapshotCommit } = require('../../api/services/engineeringRouter/patchApplyService');
    await expect(createSnapshotCommit()).rejects.toThrow(/not a git repository/);
    expect(addCallCount).toBe(1);
  });

  test('git add -A falha com "unable to stat" em TODAS as tentativas → propaga o erro real (nunca mascara/finge sucesso)', async () => {
    let addCallCount = 0;
    mockExecFile.mockImplementation((file, args, options, callback) => {
      const cb = callback || options;
      if (args[0] === 'read-tree') return callbackOk()(cb);
      if (args[0] === 'add') {
        addCallCount += 1;
        return callbackTransientAddFailure()(cb);
      }
      return callbackOk()(cb);
    });

    // eslint-disable-next-line global-require
    const { createSnapshotCommit } = require('../../api/services/engineeringRouter/patchApplyService');
    await expect(createSnapshotCommit()).rejects.toThrow(/unable to stat/);
    expect(addCallCount).toBe(5);
  }, 15000);
});
