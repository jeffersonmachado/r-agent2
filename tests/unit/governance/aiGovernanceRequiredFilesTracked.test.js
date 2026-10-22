'use strict';

/**
 * REGRESSÃO PERMANENTE — o requisito de governança de IA só é satisfazível se o arquivo exigido
 * estiver VERSIONADO (missão CI DEFINITIVO, §9 "teste de instalação limpa").
 *
 * DEFEITO MEDIDO em 2026-10-21, clone limpo do commit `b7d8f1281`: dois validadores bloqueantes
 * exigiam `.github/copilot-instructions.md`, que existia apenas no disco da máquina de
 * desenvolvimento (`.git/info/exclude`) e em NENHUM commit. Em qualquer checkout — CI, runner
 * efêmero, outra pessoa — os dois gates reprovavam:
 *
 *   [governance] validate-ai-memory: FAIL
 *    - required_file_missing: .github/copilot-instructions.md is required by AI governance.
 *   [governance] validate-agent-adherence: FAIL
 *    - agent_instruction_missing: .github/copilot-instructions.md is missing.
 *
 * "Existe no disco" nunca provou nada. O contrato passa a ser: existe no disco E está no índice do
 * git. O controle negativo (arquivo não versionado de propósito) prova que a asserção não é vazia.
 */

const path = require('path');
const { spawnSync } = require('child_process');

const {
  REQUIRED_AI_GOVERNANCE_FILES,
  AGENT_INSTRUCTION_FILES,
} = require('../../../scripts/governance/lib/required-agent-files');

const ROOT = path.join(__dirname, '..', '..', '..');

function gitTracked(relPath) {
  const r = spawnSync('git', ['ls-files', '--error-unmatch', '--', relPath], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { tracked: r.status === 0, status: r.status, saida: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

describe('arquivos exigidos pela governança de IA precisam estar VERSIONADOS', () => {
  it('o repositório é um worktree git (sem isso o invariante não pode ser provado)', () => {
    const r = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ROOT, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(String(r.stdout).trim()).toBe('true');
  });

  it('as listas canônicas continuam completas (nenhum adaptador removido em silêncio)', () => {
    expect(REQUIRED_AI_GOVERNANCE_FILES.length).toBeGreaterThanOrEqual(33);
    for (const obrigatorio of ['AGENTS.md', 'CLAUDE.md', '.github/copilot-instructions.md']) {
      expect(REQUIRED_AI_GOVERNANCE_FILES).toContain(obrigatorio);
      expect(AGENT_INSTRUCTION_FILES).toContain(obrigatorio);
    }
  });

  it('todo arquivo de REQUIRED_AI_GOVERNANCE_FILES está no índice do git', () => {
    const naoVersionados = REQUIRED_AI_GOVERNANCE_FILES
      .filter((arquivo) => !gitTracked(arquivo).tracked);
    expect(naoVersionados).toEqual([]);
  });

  it('todo adaptador de instrução está no índice do git', () => {
    const naoVersionados = AGENT_INSTRUCTION_FILES
      .filter((arquivo) => !gitTracked(arquivo).tracked);
    expect(naoVersionados).toEqual([]);
  });

  it('CONTROLE NEGATIVO: um arquivo não versionado de propósito é detectado como tal', () => {
    // `reports/*` é gitignored por política (evidência local de execução). Se este caminho passar
    // a ser "tracked" o controle perde o sentido e o teste avisa em vez de silenciar.
    const controle = gitTracked('reports/governance-score.json');
    expect(controle.tracked).toBe(false);
    expect(controle.status).not.toBe(0);
  });
});
