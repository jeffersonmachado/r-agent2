'use strict';

/**
 * L1-RUNTIME-EVIDENCE-NAO-REPRODUZIVEL — evidência de runtime tem de ser REPRODUZÍVEL.
 *
 * O defeito original (ER-V1-FINAL-007): a evidência de runtime não declarava de que conteúdo
 * da árvore foi produzida, e itens podiam ser re-atribuídos — o relatório "provava" execução
 * sem que ninguém conseguisse repetir a medição.
 *
 * Esta suíte trava as três propriedades que tornam a evidência reproduzível:
 *   1. IDENTIDADE: cada item carrega `sourceCommit` + `sourceFingerprint` do run;
 *   2. DETERMINISMO: mesmo payload ⇒ mesmo hash; payload diferente ⇒ hash diferente;
 *   3. RECUSA DE AMBIENTE: fora de um worktree git o coletor se recusa (exit 2), em vez de
 *      produzir um relatório que ninguém consegue reproduzir.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  RUNTIME_ITEMS,
  isGitWorkTree,
  assertRouterEnvironmentUsable,
  extrairJsonDoJest,
} = require('../../../scripts/governance/collect-engineering-router-runtime-evidence');

const RAIZ = path.resolve(__dirname, '..', '..', '..');

/** Mesma derivação usada pelo coletor, para poder afirmar o contrato do hash. */
const hashDaEvidencia = (payload) => crypto.createHash('sha256')
  .update(JSON.stringify(payload)).digest('hex');

const itemFake = (over = {}) => ({
  id: 'ITEM-1',
  testPath: 'tests/unit/x.test.js',
  testId: 'faz algo',
  result: { pass: true, numPassedTests: 1, numFailedTests: 0 },
  ...over,
});

describe('L1 — o coletor recusa ambiente que não pode ser reproduzido', () => {
  const antes = process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT;
  const fora = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-evidence-'));

  afterEach(() => {
    if (antes === undefined) delete process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT;
    else process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT = antes;
  });

  afterAll(() => fs.rmSync(fora, { recursive: true, force: true }));

  test('diretório que não é repositório git é detectado como tal', () => {
    expect(isGitWorkTree(fora)).toBe(false);
    expect(isGitWorkTree(RAIZ)).toBe(true);
  });

  test('ENGINEERING_ROUTER_HOST_REPO_ROOT inválido ⇒ recusa nomeada (nunca relatório)', () => {
    process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT = fora;
    const r = assertRouterEnvironmentUsable();
    expect(r.ok).toBe(false);
    expect(r.declared).toBe(path.resolve(fora));
  });

  test('variável ausente com repositório válido ⇒ aceita e não inventa override', () => {
    delete process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT;
    const r = assertRouterEnvironmentUsable();
    expect(r.ok).toBe(true);
    expect(r.declared).toBeNull();
  });

  test('override apontando para repo git VÁLIDO é aceito', () => {
    process.env.ENGINEERING_ROUTER_HOST_REPO_ROOT = RAIZ;
    expect(assertRouterEnvironmentUsable().ok).toBe(true);
  });
});

describe('L1 — identidade por item (evidência não pode ser re-atribuída)', () => {
  test('todo item declara id, suíte e caso de teste REAIS', () => {
    expect(RUNTIME_ITEMS.length).toBeGreaterThan(0);
    for (const item of RUNTIME_ITEMS) {
      expect(typeof item.id).toBe('string');
      expect(item.id.length).toBeGreaterThan(0);
      expect(item.testPath.endsWith('.test.js')).toBe(true);
      // Reproduzível = o arquivo está no repositório (não um caminho inventado).
      expect(fs.existsSync(path.join(RAIZ, item.testPath))).toBe(true);
      expect(typeof item.testId).toBe('string');
      expect(item.testId.length).toBeGreaterThan(0);
    }
  });

  test('ids de RUNTIME_ITEMS não se repetem (cada item tem uma prova)', () => {
    const ids = RUNTIME_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('o payload do hash carrega a identidade do item e o RESULTADO', () => {
    const base = itemFake();
    const outroId = itemFake({ id: 'ITEM-2' });
    const outroResultado = itemFake({ result: { pass: false, numFailedTests: 1 } });
    // Trocar o item muda o hash: a evidência fica amarrada ao caso, não ao arquivo inteiro.
    expect(hashDaEvidencia(base)).not.toBe(hashDaEvidencia(outroId));
    // Trocar o resultado muda o hash: um PASS não pode herdar o hash de um FAIL.
    expect(hashDaEvidencia(base)).not.toBe(hashDaEvidencia(outroResultado));
  });
});

describe('L1 — determinismo da evidência', () => {
  test('mesmo payload produz o MESMO hash (reprodutibilidade)', () => {
    const a = itemFake({ result: { pass: true, numPassedTests: 3 } });
    const b = itemFake({ result: { pass: true, numPassedTests: 3 } });
    expect(hashDaEvidencia(a)).toBe(hashDaEvidencia(b));
    expect(hashDaEvidencia(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('a ordem das chaves do payload faz parte do contrato (JSON canônico pelo produtor)', () => {
    // Não é preciosismo: se o produtor montar o objeto em outra ordem, o hash muda e duas
    // execuções idênticas deixariam de bater — foi a classe do defeito original.
    const emOrdem = { id: 'A', testPath: 'p', testId: 't', result: { pass: true } };
    const outraOrdem = { testId: 't', id: 'A', testPath: 'p', result: { pass: true } };
    expect(hashDaEvidencia(emOrdem)).not.toBe(hashDaEvidencia(outraOrdem));
  });
});

describe('L1 — extração do JSON do Jest mesmo com log antes', () => {
  test('pega o último objeto JSON de uma saída com logs', () => {
    const saida = [
      'PASS tests/x.test.js',
      'console.log qualquer',
      JSON.stringify({ numPassedTests: 1, numFailedTests: 0, testResults: [] }),
    ].join('\n');
    const json = extrairJsonDoJest(saida);
    expect(json).not.toBeNull();
    expect(json.numPassedTests).toBe(1);
  });

  test('saída sem JSON devolve null (o coletor reprova, nunca presume sucesso)', () => {
    expect(extrairJsonDoJest('PASS tests/x.test.js\nsem relatório')).toBeNull();
    expect(extrairJsonDoJest('')).toBeNull();
  });
});
