'use strict';

/**
 * A FONTE dos candidatos do plano de regressão.
 *
 * DEFEITO ELIMINADO (2026-10-08). `checkRegression` executava os comandos com `cwd: workspacePath`
 * (o worktree isolado da tentativa = `source_commit` + patch), mas resolvia os candidatos a
 * "teste relacionado" com `expandGlobsToFiles(['tests/**\/*.test.js'])` SEM reader — ou seja, a partir
 * do ROOT do processo (o repositório principal). Um arquivo que existe numa fonte e não na outra
 * virava `npx jest <arquivo>` ⇒ "No tests found" (exit 1): a regressão reprovava por um comando que
 * nunca poderia passar.
 *
 * Medido ao vivo (task eef5f81e, missão ca56cbdc): o coder aplicou patch de 1354B e passou os TRÊS
 * test runs do contrato; a regressão reprovou em `engineeringMissionGovernanceSafeguards.test.js` e
 * `engineeringMissionSpec.test.js`, suítes que existiam na main e NÃO no worktree da missão. O RED
 * parecia do patch e era do plano.
 *
 * `resolveAvailableTestFiles` passa a resolver no MESMO lugar onde os comandos rodam — inclusive
 * suítes CRIADAS pelo patch — e registra em auditoria o que ficou de fora por não existir ali.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveAvailableTestFiles, createWorkspaceReader } = require('../../api/services/engineeringRouter/regressionGovernanceService');

const workspaces = [];
const novoWorkspace = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-plan-source-'));
  workspaces.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
};

afterAll(() => {
  for (const root of workspaces) fs.rmSync(root, { recursive: true, force: true });
});

describe('plano de regressão — candidatos vêm do WORKSPACE, não do repositório principal', () => {
  test('lista as suítes do workspace e NENHUMA do repositório principal que não exista ali', () => {
    const root = novoWorkspace({
      'tests/unit/do-workspace.test.js': '// x\n',
      'tests/integration/outra.test.js': '// x\n',
    });

    const { availableTestFiles } = resolveAvailableTestFiles(root);
    expect(availableTestFiles).toEqual(['tests/integration/outra.test.js', 'tests/unit/do-workspace.test.js']);
    // O caso que causava o RED: uma suíte do repo principal (ex.: a criada nesta sessão, que vive
    // só na main) NÃO PODE entrar no plano de um workspace que não a tem.
    expect(availableTestFiles).not.toContain('tests/unit/engineeringMissionGovernanceSafeguards.test.js');
    expect(availableTestFiles).not.toContain('tests/unit/engineeringMissionSpec.test.js');
  });

  test('suíte CRIADA PELO PATCH entra no plano (o workspace é a fonte, não o source_commit)', () => {
    const root = novoWorkspace({ 'tests/unit/criada-pelo-patch.test.js': '// nova\n' });
    const { availableTestFiles } = resolveAvailableTestFiles(root);
    expect(availableTestFiles).toContain('tests/unit/criada-pelo-patch.test.js');
  });

  test('auditoria registra a fonte e o que ficou ausente (nada é descartado em silêncio)', () => {
    const root = novoWorkspace({ 'tests/unit/unica.test.js': '// x\n' });
    const { audit } = resolveAvailableTestFiles(root);

    expect(audit.source).toBe('WORKSPACE_DA_TENTATIVA');
    expect(audit.workspacePath).toBe(root);
    expect(audit.availableTestFilesCount).toBe(1);
    expect(audit.candidatesAbsentInWorkspaceCount).toBeGreaterThan(0);
    expect(audit.candidatesAbsentInWorkspace).toContain('tests/unit/engineeringMissionGovernanceSafeguards.test.js');
    expect(audit.candidatesAbsentInWorkspace).not.toContain('tests/unit/unica.test.js');
  });

  test('workspace vazio ⇒ nenhum candidato e auditoria explícita (nunca o repo principal por engano)', () => {
    const root = novoWorkspace({ 'README.md': 'sem testes\n' });
    const { availableTestFiles, audit } = resolveAvailableTestFiles(root);
    expect(availableTestFiles).toEqual([]);
    expect(audit.availableTestFilesCount).toBe(0);
    expect(audit.candidatesAbsentInWorkspaceCount).toBeGreaterThan(0);
  });
});

describe('reader do workspace', () => {
  test('lista arquivos relativos com separador "/" e não desce em diretórios pesados', () => {
    const root = novoWorkspace({
      'tests/unit/a.test.js': '// x\n',
      'node_modules/pacote/index.js': '// ruído\n',
      '.git/HEAD': 'ref\n',
      'dist/bundle.js': '// ruído\n',
    });

    const arquivos = createWorkspaceReader(root).listFiles();
    expect(arquivos).toContain('tests/unit/a.test.js');
    expect(arquivos.some((f) => f.startsWith('node_modules/'))).toBe(false);
    expect(arquivos.some((f) => f.startsWith('.git/'))).toBe(false);
    expect(arquivos.some((f) => f.startsWith('dist/'))).toBe(false);
  });

  test('isFile/readFile respondem pelo workspace (e nunca pelo principal)', () => {
    const root = novoWorkspace({ 'tests/unit/a.test.js': 'conteudo-do-workspace\n' });
    const reader = createWorkspaceReader(root);

    expect(reader.isFile('tests/unit/a.test.js')).toBe(true);
    expect(reader.readFile('tests/unit/a.test.js')).toBe('conteudo-do-workspace\n');
    expect(reader.isFile('tests/unit/engineeringMissionGovernanceSafeguards.test.js')).toBe(false);
    expect(reader.readFile('tests/unit/engineeringMissionGovernanceSafeguards.test.js')).toBeNull();
    expect(reader.kind).toBe('WORKSPACE');
  });

  test('symlink NÃO é seguido (um link para fora não representa o que os comandos veem)', () => {
    const root = novoWorkspace({ 'tests/unit/real.test.js': '// x\n' });
    try {
      fs.symlinkSync(os.tmpdir(), path.join(root, 'tests', 'link-externo'));
    } catch (_) {
      return; // ambiente sem symlink: o caso não se aplica
    }
    const arquivos = createWorkspaceReader(root).listFiles();
    expect(arquivos).toContain('tests/unit/real.test.js');
    expect(arquivos.some((f) => f.includes('link-externo'))).toBe(false);
  });

  test('diretórios ignorados pelo jest continuam fora do plano (tests/rpa e fixtures do Router)', () => {
    const root = novoWorkspace({
      'tests/unit/valida.test.js': '// x\n',
      'tests/rpa/ignorada.test.js': '// x\n',
      'tests/fixtures/engineering-router-sandbox/mathUtils.test.js': '// x\n',
    });
    const { availableTestFiles } = resolveAvailableTestFiles(root);
    expect(availableTestFiles).toEqual(['tests/unit/valida.test.js']);
  });
});
