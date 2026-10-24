'use strict';

/**
 * IDENTIDADE CANÔNICA DE RELEASE: O RUN PRECISA CONTER O COMMIT (P0 — 2026-10-16).
 *
 * DEFEITO MEDIDO (na base real, leitura read-only de `governance_run`):
 *
 *     run_id            : rap-governed-20261016144931085-033e1239
 *     source_fingerprint: 1c10ffa6…
 *     git_commit        : null      <-- nunca gravado
 *     branch            : null
 *
 * Encadeamento do defeito:
 *   1. `create-governed-run.js` gravava `sourceCommit`/`sourceTree` apenas em
 *      `governance/.current-run.json` e chamava `createRun(...)` SEM
 *      `gitCommit`/`branch` (o serviço já aceitava os dois campos);
 *   2. `stamp-report-lineage.js` estampava só `runId` + `sourceFingerprint`,
 *      nunca o commit;
 *   3. a decisão canônica exige `sourceCommit` como campo OBRIGATÓRIO de
 *      identidade — logo os três relatórios finais ficavam com identidade
 *      INCOMPLETA para sempre:
 *
 *        identidade insuficiente: final_governance:INCOMPLETA:faltantes=sourceCommit
 *
 *      isto é, a plataforma NÃO conseguia certificar nenhum release como GO
 *      definitivo (dead-end estrutural), e um release podia ser selado com
 *      identidade que ninguém podia conferir.
 *
 * Estes testes protegem as três pontas da correção: o run grava o commit, o
 * estampador propaga o commit do RUN (não do worktree) e recusa estampar sem ele.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const ler = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function semComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linha) => !linha.trim().startsWith('//'))
    .join('\n');
}

describe('(1) o run governado registra o commit', () => {
  it('create-governed-run passa gitCommit/branch para createRun', () => {
    const fonte = semComentarios(ler('scripts/governance/create-governed-run.js'));
    const criaRun = fonte.slice(fonte.indexOf('createRun({'), fonte.indexOf('createRun({') + 400);
    expect(criaRun).toContain('gitCommit:');
    expect(criaRun).toContain('branch:');
  });

  /**
   * DEFEITO MEDIDO (CI 2026-10-24): este teste exigia `typeof sourceBranch === 'string'` sem
   * considerar HEAD DESTACADO. O GitHub Actions faz checkout de `refs/pull/<n>/merge` em HEAD
   * destacado, então `git rev-parse --abbrev-ref HEAD` devolve a string literal `HEAD` — que a
   * implementação corretamente converte em `null` (não é branch, é ausência). O teste reprovava em
   * TODO run de pull request e passava em qualquer clone com branch — asserção dependente de
   * ambiente, exatamente o tipo de verde local / vermelho no CI.
   *
   * A regra abaixo é mais estrita que a anterior: a branch tem de ser a MESMA que o git reporta,
   * e `null` só é aceito quando o HEAD está de fato destacado.
   */
  it('resolveGitIdentity expõe commit, tree AND branch (fonte única do git)', () => {
    const { execSync } = require('child_process');
    const { resolveGitIdentity } = require('../../../scripts/governance/lib/resolve-run-lineage');
    const g = resolveGitIdentity(ROOT);
    expect(g.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(g.sourceTree).toMatch(/^[0-9a-f]{40}$/);

    let destacado = false;
    try {
      execSync('git symbolic-ref -q HEAD', { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] });
    } catch (_) {
      destacado = true;
    }
    if (destacado) {
      expect(g.sourceBranch).toBeNull();
    } else {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
      expect(g.sourceBranch).toBe(branch);
      expect(g.sourceBranch.length).toBeGreaterThan(0);
    }
  });

  it('o serviço createRun PERSISTE o commit quando recebido (não descarta em silêncio)', () => {
    const fonte = ler('api/services/governance/certificationService.js');
    expect(fonte).toContain('git_commit: input.gitCommit || null');
    expect(fonte).toContain('branch: input.branch || null');
  });
});

describe('(2) o lineage estampa o commit do RUN, nunca do worktree', () => {
  it('grava sourceCommit a partir do run', () => {
    const fonte = semComentarios(ler('scripts/governance/stamp-report-lineage.js'));
    expect(fonte).toContain('sourceCommit: run.git_commit');
  });

  it('recusa estampar quando o run não tem commit (fail-closed, não fabrica identidade)', () => {
    const fonte = semComentarios(ler('scripts/governance/stamp-report-lineage.js'));
    expect(fonte).toContain('RUN_SEM_SOURCE_COMMIT');
    expect(fonte).toMatch(/if \(!run\.git_commit\)/);
  });

  it('não busca o commit do HEAD do worktree para estampar (identidade do run)', () => {
    const fonte = semComentarios(ler('scripts/governance/stamp-report-lineage.js'));
    // O worktree pode ter avançado depois do congelamento do run; usar HEAD
    // produziria identidade divergente dos demais artefatos.
    expect(fonte).not.toContain("rev-parse HEAD");
    expect(fonte).not.toContain('execSync');
  });
});

describe('(3) a exigência e a produção da identidade concordam (não há dead-end)', () => {
  it('os campos exigidos pela decisão canônica são os mesmos que o estampador produz', () => {
    const { CAMPOS_IDENTIDADE_OBRIGATORIOS } = require('../../../governance/canonical-release-decision');
    expect(CAMPOS_IDENTIDADE_OBRIGATORIOS).toEqual(
      expect.arrayContaining(['runId', 'sourceCommit', 'sourceFingerprint'])
    );
    const estampador = semComentarios(ler('scripts/governance/stamp-report-lineage.js'));
    for (const campo of CAMPOS_IDENTIDADE_OBRIGATORIOS) {
      expect(estampador).toContain(campo);
    }
  });
});
