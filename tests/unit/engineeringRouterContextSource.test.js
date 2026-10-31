'use strict';

/**
 * HUMAN_EXTERNAL_BOOTSTRAP (2026-10-07) — COERÊNCIA CONTEXTO↔WORKSPACE.
 *
 * Defeito real medido: o workspace onde o patch é aplicado é materializado do `source_commit` da
 * task (fonte da Engineering Mission), mas o construtor de contexto lia os arquivos do CHECKOUT
 * PRINCIPAL (main). Em incrementos encadeados — exatamente o que a decomposição produz — o CODER
 * recebia o conteúdo ANTIGO do arquivo e o patch não aplicava (`PATCH_APPLY_FAILED`), ou pior,
 * aplicava sobre premissa errada.
 *
 * Prova estrutural do defeito (medida no INC-2B): `api/services/engineeringMission/
 * missionReplanService.js` e `missionStoreService.js` somam 155 linhas na FONTE da missão
 * (commit 0ada6025) e ZERO no main. Sem a correção, o arquivo nem aparecia no contexto.
 *
 * Estes testes usam git real (nenhum mock): a fonte é um commit que existe de verdade neste
 * repositório, e o checkout principal é o próprio ROOT do processo.
 */

const fs = require('fs');
const path = require('path');
const {
  ROOT,
  createSourceReader,
  expandGlobsToFiles,
  buildContext,
} = require('../../api/services/engineeringRouter/contextBuilderService');

const MISSION_SOURCE_COMMIT = '0ada6025e49b';
const FILE_ONLY_IN_SOURCE = 'api/services/engineeringMission/missionReplanService.js';
const FILE_IN_ROOT = 'package.json';

function commitExists(commit) {
  try {
    require('child_process').execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

const hasSourceCommit = commitExists(MISSION_SOURCE_COMMIT);

describe('engineeringRouter/contextBuilder — fonte do contexto (commit da missão)', () => {
  test('PROVA do defeito: o arquivo do incremento anterior NÃO existe no checkout principal', () => {
    if (!hasSourceCommit) return; // repositório sem o commit (clone raso): nada a provar aqui
    // Se este assert falhar, o defeito deixou de existir por outro motivo (arquivo promovido ao main)
    // e esta suíte precisa ser revisada — nunca silenciada.
    expect(fs.existsSync(path.join(ROOT, FILE_ONLY_IN_SOURCE))).toBe(false);
  });

  test('task de missão lê o contexto do COMMIT DA FONTE (não do main)', () => {
    if (!hasSourceCommit) return;
    const reader = createSourceReader({ id: 't-source', source_commit: MISSION_SOURCE_COMMIT });
    expect(reader.kind).toBe('MISSION_SOURCE');
    expect(reader.commit).toBe(MISSION_SOURCE_COMMIT);

    const content = reader.readFile(FILE_ONLY_IN_SOURCE);
    expect(typeof content).toBe('string');
    expect(content).toContain('missionReplanService');
    expect(reader.isFile(FILE_ONLY_IN_SOURCE)).toBe(true);
    // O mesmo leitor NÃO encontra o arquivo no checkout principal — a diferença é real.
    expect(fs.existsSync(path.join(ROOT, FILE_ONLY_IN_SOURCE))).toBe(false);
  });

  test('buildContext de task de missão inclui o arquivo do incremento anterior', () => {
    if (!hasSourceCommit) return;
    const task = {
      id: 'task-ctx-source',
      title: 'INC-2B',
      objective: 'expor a secao de replan no relatorio',
      task_type: 'CODE_GENERATION',
      allowed_paths: ['api/services/engineeringMission/missionReportService.js', FILE_ONLY_IN_SOURCE],
      source_commit: MISSION_SOURCE_COMMIT,
    };
    const context = buildContext(task);

    expect(context.includedFiles).toContain(FILE_ONLY_IN_SOURCE);
    expect(context.files.find((f) => f.path === FILE_ONLY_IN_SOURCE).content).toContain('decideReplanForMission');
    expect(context.sourceOrigin).toEqual({ kind: 'MISSION_SOURCE', commit: MISSION_SOURCE_COMMIT });
  });

  test('task SEM source_commit continua lendo do checkout principal (compatibilidade)', () => {
    const reader = createSourceReader({ id: 't-root' });
    expect(reader.kind).toBe('ROOT');
    expect(reader.commit).toBeNull();
    expect(reader.isFile(FILE_IN_ROOT)).toBe(true);

    const context = buildContext({ id: 'task-root', allowed_paths: [FILE_IN_ROOT] });
    expect(context.sourceOrigin).toEqual({ kind: 'ROOT', commit: null });
    expect(context.includedFiles).toContain(FILE_IN_ROOT);
  });

  // L-1 (2026-10-20): a degradação silenciosa para o checkout principal era o defeito. A base
  // declarada é IDENTIDADE — se ela não existe, o contexto não pode ser construído de outra fonte.
  test('source_commit IRRESOLVÍVEL FALHA explicitamente (nunca lê o checkout principal)', () => {
    const commit = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    let thrown = null;
    try {
      createSourceReader({ id: 't-bad', source_commit: commit });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('CONTEXT_SOURCE_UNRESOLVABLE');
    expect(thrown.reason).toBe('MISSION_SOURCE_COMMIT_UNRESOLVABLE');
    expect(thrown.sourceCommit).toBe(commit);

    expect(() => buildContext({ id: 't-bad', allowed_paths: [FILE_IN_ROOT], source_commit: commit }))
      .toThrow(/não existe neste repositório/);
  });

  test('task de missão SEM source_commit FALHA (não herda a main silenciosamente)', () => {
    let thrown = null;
    try {
      createSourceReader({ id: 't-mission', mission_id: '11111111-2222-3333-4444-555555555555' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('CONTEXT_SOURCE_UNRESOLVABLE');
    expect(thrown.reason).toBe('MISSION_SOURCE_NOT_INHERITED');
  });

  test('globs são expandidos contra a FONTE (não só arquivos literais)', () => {
    if (!hasSourceCommit) return;
    const reader = createSourceReader({ id: 't-glob', source_commit: MISSION_SOURCE_COMMIT });
    const matched = expandGlobsToFiles(['api/services/engineeringMission/**'], reader);
    expect(matched).toContain(FILE_ONLY_IN_SOURCE);
    // Sem leitor (compatibilidade), a expansão continua funcionando no checkout principal.
    expect(expandGlobsToFiles(['package.json'])).toContain(FILE_IN_ROOT);
  });
});
