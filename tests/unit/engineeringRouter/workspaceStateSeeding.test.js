'use strict';

/**
 * Semeadura do workspace isolado da missão.
 *
 * DEFEITO ESTRUTURAL medido em 2026-10-09: o `git worktree` da missão não herda `.env`,
 * `api/data` nem `reports` (são ignorados/untracked). Sem eles, a suíte do serviço reprova
 * dentro do workspace **com a árvore limpa** — o aceite era insatisfazível ali, independente do
 * patch (missões com patch válido morriam em TESTING; 1 GREEN em 75 aprovações).
 *
 * Duas propriedades que este teste fixa:
 *   1. os artefatos de estado são COPIADOS (não symlink — symlink gravável para o repositório
 *      real é o defeito ER-V1-FINAL-001);
 *   2. falha ao semear NÃO derruba a materialização do worktree (semear é pré-requisito do
 *      aceite, não do patch).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  WORKSPACE_STATE_ARTIFACTS,
  seedWorkspaceState,
} = require('../../../api/services/engineeringRouter/patchApplyService');

describe('semeadura de estado do workspace isolado', () => {
  let destino;

  beforeEach(() => {
    destino = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-test-'));
  });

  afterEach(() => {
    fs.rmSync(destino, { recursive: true, force: true });
  });

  it('copia .env e api/data para o workspace (sem eles o aceite não roda)', () => {
    const seeded = seedWorkspaceState(destino);
    expect(seeded).toContain('.env');
    expect(seeded).toContain('api/data');
    expect(fs.existsSync(path.join(destino, '.env'))).toBe(true);
    expect(fs.existsSync(path.join(destino, 'api', 'data', 'config.json'))).toBe(true);
  });

  it('COPIA — nunca symlink para o repositório real (ER-V1-FINAL-001)', () => {
    seedWorkspaceState(destino);
    expect(fs.lstatSync(path.join(destino, '.env')).isSymbolicLink()).toBe(false);
    expect(fs.lstatSync(path.join(destino, 'api', 'data')).isSymbolicLink()).toBe(false);
  });

  it('a cópia é independente: escrever no workspace não toca o repositório', () => {
    seedWorkspaceState(destino);
    const alvo = path.join(destino, '.env');
    const antes = fs.readFileSync(alvo, 'utf8');
    fs.appendFileSync(alvo, '\n# escrito no workspace isolado\n');
    const origem = fs.readFileSync(path.join(__dirname, '..', '..', '..', '.env'), 'utf8');
    expect(origem).toBe(antes);
  });

  it('declara exatamente os artefatos que o aceite exige', () => {
    expect(WORKSPACE_STATE_ARTIFACTS).toEqual(['.env', 'api/data', 'reports']);
  });

  it('workspace inválido não lança (semear não pode derrubar a materialização)', () => {
    const inexistente = path.join(destino, 'nao-existe', 'nem', 'pai');
    expect(() => seedWorkspaceState(inexistente)).not.toThrow();
  });
});
