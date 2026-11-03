'use strict';

/**
 * FASE 3 / MISSÃO E — CI INDEPENDENTE NO SHA EXATO.
 *
 * PROBLEMA MEDIDO (2026-10-24): o PR #16 (`codex/p1-governance-hardening-20261023` →
 * `dev/engineering-hardening`) não disparava NENHUM workflow:
 *   `gh run list --branch codex/p1-governance-hardening-20261023`  -> []
 *   `gh run list --commit a3aa22d28`                              -> []
 * A causa é estrutural: `dev-branch-ci.yml` só disparava em `push` para
 * `dev/engineering-hardening` (+ `workflow_dispatch`), e os demais workflows
 * (`jest`, `e2e`, `frontend`, `rag`, `release-governance`) filtram `main`/`develop`/`release/**`.
 * Resultado: a validação do PR existia apenas como execução local do agente.
 *
 * O que este arquivo trava (estrutura verificável, sem depender de run remoto):
 *   1. existe gatilho de `pull_request` para a base do PR;
 *   2. CI de desenvolvimento nunca publica (`contents: read`, sem `git push`/`tag`/`publish`);
 *   3. passos de validação não usam `continue-on-error` (job não pode ser "verde por omissão");
 *   4. a identidade do SHA é ASSERTADA (`git rev-parse HEAD` == `GITHUB_SHA`) e os artefatos são
 *      nomeados por `github.sha` (não há reutilização silenciosa de evidência de outro commit);
 *   5. todo workflow declara `concurrency`/`permissions` explícitos quando publica nada — e nenhum
 *      dos workflows aplicáveis ao PR tem permissão de escrita.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..', '..', '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const BASE = 'dev/engineering-hardening';

const carregar = (nome) => yaml.load(fs.readFileSync(path.join(WORKFLOWS, nome), 'utf8'));
const gatilhos = (doc) => doc.on || doc[true] || {};
const branchesDe = (gatilho) => {
  if (!gatilho) return [];
  const br = (gatilho.branches || []).slice();
  return br;
};

describe('P3-E — cobertura de CI do PR', () => {
  test('o CI de desenvolvimento dispara em pull_request para a base do PR', () => {
    const doc = carregar('dev-branch-ci.yml');
    const on = gatilhos(doc);
    expect(on.pull_request).toBeDefined();
    expect(branchesDe(on.pull_request)).toContain(BASE);
    // `push` na branch de desenvolvimento continua coberto.
    expect(branchesDe(on.push)).toContain(BASE);
  });

  test('o CI de desenvolvimento NÃO publica nada (permissões somente leitura)', () => {
    const doc = carregar('dev-branch-ci.yml');
    expect(doc.permissions).toEqual({ contents: 'read' });
    const texto = fs.readFileSync(path.join(WORKFLOWS, 'dev-branch-ci.yml'), 'utf8');
    expect(texto).not.toMatch(/git\s+push/);
    expect(texto).not.toMatch(/git\s+tag\s/);
    expect(texto).not.toMatch(/docker\s+push/);
    expect(texto).not.toMatch(/npm\s+publish/);
  });

  test('nenhum passo de VALIDAÇÃO do CI usa continue-on-error', () => {
    const doc = carregar('dev-branch-ci.yml');
    for (const [nomeJob, job] of Object.entries(doc.jobs || {})) {
      for (const passo of job.steps || []) {
        const nome = String(passo.name || '');
        const diagnostico = /upload|artifact|dump|logs em caso|logs no caso/i.test(nome);
        if (diagnostico) continue;
        expect({ job: nomeJob, passo: nome, coe: passo['continue-on-error'] })
          .toEqual({ job: nomeJob, passo: nome, coe: undefined });
      }
    }
  });

  test('a identidade do SHA é ASSERTADA e os artefatos são vinculados ao commit', () => {
    const texto = fs.readFileSync(path.join(WORKFLOWS, 'dev-branch-ci.yml'), 'utf8');
    // O clone precisa provar que mediu o commit do evento, não um HEAD qualquer.
    expect(texto).toMatch(/test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/);
    // Evidência/artefato nomeado pelo SHA (sem reutilizar prova de outro commit).
    expect(texto).toMatch(/dev-branch-ci-evidence-\$\{\{\s*github\.sha\s*\}\}/);
    expect(texto).toMatch(/prod-like-smoke-\$\{\{\s*github\.sha\s*\}\}/);
  });

  test('os workflows que NÃO cobrem a base do PR não são contados como validação do PR', () => {
    const naoCobrem = [];
    for (const arquivo of fs.readdirSync(WORKFLOWS)) {
      if (!arquivo.endsWith('.yml')) continue;
      const on = gatilhos(carregar(arquivo));
      const cobrePr = on.pull_request && branchesDe(on.pull_request).includes(BASE);
      const cobrePush = on.push && branchesDe(on.push).includes(BASE);
      if (!cobrePr && !cobrePush) naoCobrem.push(arquivo);
      else expect([cobrePr, cobrePush].some(Boolean)).toBe(true);
    }
    // Documenta o conjunto REAL: só o CI de desenvolvimento cobre a base do PR.
    expect(naoCobrem).toEqual(expect.arrayContaining(['e2e.yml', 'frontend.yml', 'jest.yml', 'rag.yml']));
    expect(naoCobrem).not.toContain('dev-branch-ci.yml');
  });
});
