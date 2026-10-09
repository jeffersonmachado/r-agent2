'use strict';

/**
 * `scripts/security-intel-verify-target.js` — aceite MECÂNICO de uma correção de dependência.
 *
 * Três invariantes que este teste fixa:
 *   1. FAIL-CLOSED: declaração não avaliável ou versão não comparável ⇒ INCOMPARABLE (código 2),
 *      nunca "passou".
 *   2. O aceite mede o GRAFO DECLARADO. No workspace isolado `node_modules` é bind READ-ONLY do
 *      host (`executionSandbox`): uma prova que olhasse a árvore instalada reprovaria todo patch
 *      correto — e mediria o host, não a correção.
 *   3. Declaração DURÁVEL é exigida: lockfile editado sem `overrides`/dependência declarada não
 *      passa (volta no próximo `npm install`), e cópia antiga remanescente no lock reprova.
 *
 * O comando é curto porque é REGISTRADO em `engineering_test_runs.command` (varchar(255)): o
 * `node -e` inline de ~300 chars falhava o INSERT com `22001` e virava REJECTED sem rodar
 * (medido em 2026-10-09).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  EXIT,
  parseArgs,
  overrideKeyName,
  collectOverrideEntries,
  collectDirectEntries,
  collectLockVersions,
  evaluateDeclaredTarget,
  verifyTarget,
  main,
} = require('../../../scripts/security-intel-verify-target');

const ALVO = '4.3.2';
const LOCK_COERENTE = { lockfileVersion: 3, packages: { '': {}, 'node_modules/js-yaml': { version: '4.3.2' } } };

/** Cria um diretório temporário com os arquivos do grafo declarado informados. */
function cenario(arquivos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-target-'));
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    fs.writeFileSync(path.join(dir, nome), typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo, null, 2));
  }
  return dir;
}

describe('verify-target — leitura do grafo declarado', () => {
  it('extrai o nome do pacote de chaves de override (inclusive com escopo)', () => {
    expect(overrideKeyName('js-yaml')).toBe('js-yaml');
    expect(overrideKeyName('js-yaml@^4')).toBe('js-yaml');
    expect(overrideKeyName('@scope/pkg')).toBe('@scope/pkg');
    expect(overrideKeyName('@scope/pkg@^4')).toBe('@scope/pkg');
  });

  it('acha override simples, aninhado e com range na chave', () => {
    expect(collectOverrideEntries({ 'js-yaml': '^4.3.2' }, 'js-yaml')).toEqual([
      { path: 'overrides.js-yaml', range: '^4.3.2' },
    ]);
    expect(collectOverrideEntries({ cosmiconfig: { 'js-yaml': '4.3.2' } }, 'js-yaml')).toEqual([
      { path: 'overrides.cosmiconfig > js-yaml', range: '4.3.2' },
    ]);
    expect(collectOverrideEntries({ 'js-yaml@^3': '^4.3.2' }, 'js-yaml')).toEqual([
      { path: 'overrides.js-yaml@^3', range: '^4.3.2' },
    ]);
    expect(collectOverrideEntries({ lodash: '^4.18.0' }, 'js-yaml')).toEqual([]);
    expect(collectOverrideEntries(undefined, 'js-yaml')).toEqual([]);
  });

  it('lê dependências diretas e versões resolvidas do lock (v3 e v1)', () => {
    expect(collectDirectEntries({ dependencies: { 'js-yaml': '^4.3.2' } }, 'js-yaml')).toEqual([
      { path: 'dependencies', range: '^4.3.2' },
    ]);
    expect(collectDirectEntries({ devDependencies: { 'js-yaml': '4.3.2' } }, 'js-yaml')).toEqual([
      { path: 'devDependencies', range: '4.3.2' },
    ]);
    expect(collectLockVersions({ packages: { 'node_modules/js-yaml': { version: '4.3.2' } } }, 'js-yaml')).toEqual([
      { path: 'packages[node_modules/js-yaml]', version: '4.3.2' },
    ]);
    expect(collectLockVersions({ dependencies: { a: { dependencies: { 'js-yaml': { version: '3.14.2' } } } } }, 'js-yaml')).toEqual([
      { path: 'a/js-yaml', version: '3.14.2' },
    ]);
  });
});

describe('verify-target — veredito declarado', () => {
  it('override que admite o alvo e lock coerente ⇒ OK', () => {
    const r = evaluateDeclaredTarget({
      packageName: 'js-yaml',
      targetVersion: ALVO,
      expect: 'override',
      declarations: [{ path: 'overrides.js-yaml', range: '^4.3.2' }],
      lockVersions: [{ path: 'packages[node_modules/js-yaml]', version: '4.3.2' }],
    });
    expect(r.status).toBe('OK');
    expect(r.message).toContain('ALVO DECLARADO');
  });

  it('sem entrada no grafo declarado ⇒ NOT_APPLIED (o patch não aplicou nada durável)', () => {
    const r = evaluateDeclaredTarget({ packageName: 'js-yaml', targetVersion: ALVO, expect: 'override', declarations: [], lockVersions: [] });
    expect(r.status).toBe('NOT_APPLIED');
    expect(r.message).toContain('ALVO NAO DECLARADO');
  });

  it('override que NÃO admite o alvo ⇒ NOT_APPLIED', () => {
    const r = evaluateDeclaredTarget({
      packageName: 'js-yaml',
      targetVersion: ALVO,
      expect: 'override',
      declarations: [{ path: 'overrides.js-yaml', range: '^3.14.0' }],
    });
    expect(r.status).toBe('NOT_APPLIED');
    expect(r.message).toContain('nao admite');
  });

  it('override correto mas lock ainda resolvendo versão antiga ⇒ NOT_APPLIED (lock não regenerado)', () => {
    const r = evaluateDeclaredTarget({
      packageName: 'js-yaml',
      targetVersion: ALVO,
      expect: 'override',
      declarations: [{ path: 'overrides.js-yaml', range: '^4.3.2' }],
      lockVersions: [{ path: 'packages[node_modules/cosmiconfig/node_modules/js-yaml]', version: '3.14.2' }],
    });
    expect(r.status).toBe('NOT_APPLIED');
    expect(r.message).toContain('lockfile ainda resolve js-yaml@3.14.2');
  });

  it('FAIL-CLOSED: range não avaliável ⇒ INCOMPARABLE (nunca OK)', () => {
    const r = evaluateDeclaredTarget({
      packageName: 'js-yaml',
      targetVersion: ALVO,
      expect: 'override',
      declarations: [{ path: 'overrides.js-yaml', range: 'latest-ish' }],
    });
    expect(r.status).toBe('INCOMPARABLE');
    expect(r.message).toContain('NAO pode declarar sucesso');
  });

  it('expect=direct não aceita override, e vice-versa (o lugar do patch importa)', () => {
    const soOverride = [{ path: 'overrides.js-yaml', range: '^4.3.2' }];
    const soDireta = [{ path: 'dependencies', range: '^4.3.2' }];
    expect(evaluateDeclaredTarget({ packageName: 'js-yaml', targetVersion: ALVO, expect: 'direct', declarations: soOverride }).status).toBe('NOT_APPLIED');
    expect(evaluateDeclaredTarget({ packageName: 'js-yaml', targetVersion: ALVO, expect: 'override', declarations: soDireta }).status).toBe('NOT_APPLIED');
    expect(evaluateDeclaredTarget({ packageName: 'js-yaml', targetVersion: ALVO, expect: 'any', declarations: soDireta }).status).toBe('OK');
  });
});

describe('verify-target — CLI sobre arquivos reais', () => {
  it('override + lock coerente ⇒ OK; com cópia antiga no lock ⇒ NOT_APPLIED', () => {
    const bom = cenario({
      'package.json': { name: 'x', overrides: { 'js-yaml': '^4.3.2' } },
      'package-lock.json': LOCK_COERENTE,
    });
    expect(verifyTarget({ packageName: 'js-yaml', targetVersion: ALVO, expect: 'override', rootDir: bom }).status).toBe('OK');

    const velho = cenario({
      'package.json': { name: 'x', overrides: { 'js-yaml': '^4.3.2' } },
      'package-lock.json': { lockfileVersion: 3, packages: { 'node_modules/js-yaml': { version: '3.14.2' } } },
    });
    expect(verifyTarget({ packageName: 'js-yaml', targetVersion: ALVO, expect: 'override', rootDir: velho }).status).toBe('NOT_APPLIED');
  });

  it('lock editado SEM declaração durável ⇒ NOT_APPLIED (volta no próximo `npm install`)', () => {
    const soLock = cenario({
      'package.json': { name: 'x', dependencies: { cosmiconfig: '^9.0.0' } },
      'package-lock.json': LOCK_COERENTE,
    });
    const r = verifyTarget({ packageName: 'js-yaml', targetVersion: ALVO, expect: 'override', rootDir: soLock });
    expect(r.status).toBe('NOT_APPLIED');
    expect(r.message).toContain('ALVO NAO DECLARADO');
  });

  it('lê o repositório real e devolve um estado do contrato (nunca lança, nunca inventa)', () => {
    const raiz = path.join(__dirname, '..', '..', '..');
    const r = verifyTarget({ packageName: 'js-yaml', targetVersion: ALVO, expect: 'override', rootDir: raiz });
    expect(['OK', 'NOT_APPLIED', 'INCOMPARABLE', 'MISSING']).toContain(r.status);
    expect(typeof r.message).toBe('string');
  });

  it('a expectativa sobre o repositório REAL é derivada do próprio repositório (não congela o estado)', () => {
    // Achado (medido em 2026-10-09, num worktree onde o override havia sido aplicado durante a
    // prova do aceite): a versão anterior deste teste afirmava sempre `NOT_APPLIED` para o repo
    // real — ou seja, REPROVARIA exatamente quando o motor de patch faz a correção que ele existe
    // para fazer. Um teste do motor não pode punir o resultado que o motor deve produzir.
    const raiz = path.join(__dirname, '..', '..', '..');
    const textoOverrides = JSON.stringify(JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).overrides || {});
    const r = verifyTarget({ packageName: 'js-yaml', targetVersion: ALVO, expect: 'override', rootDir: raiz });
    if (!textoOverrides.includes('js-yaml')) {
      expect(r.status).toBe('NOT_APPLIED'); // nada declarado ⇒ nada aplicado
    } else {
      // Declarado: quem decide é a corroboração do lock (coerente ⇒ OK; cópia antiga ⇒ NOT_APPLIED).
      expect(['OK', 'NOT_APPLIED']).toContain(r.status);
    }
  });

  it('--source=installed lê a árvore instalada (verificação de host, pós `npm ci`)', () => {
    const r = verifyTarget({ packageName: 'express', targetVersion: '1.0.0', source: 'installed', resolveVersion: () => '4.21.2' });
    expect(r.status).toBe('OK');
    expect(r.message).toContain('ALVO INSTALADO');
  });

  it('parseArgs aceita `--k=v` e `--k v`, e expõe argumento solto como erro de uso', () => {
    expect(parseArgs(['js-yaml', '4.3.2', '--expect=override', '--root=/tmp/x'])).toMatchObject({
      packageName: 'js-yaml', targetVersion: '4.3.2', expect: 'override', root: '/tmp/x', extraArgs: [],
    });
    expect(parseArgs(['js-yaml', '4.3.2', '--expect', 'override', '--root', '/tmp/x'])).toMatchObject({
      expect: 'override', root: '/tmp/x',
    });
    expect(parseArgs(['js-yaml', '4.3.2', '/tmp/perdido']).extraArgs).toEqual(['/tmp/perdido']);
  });

  it('main devolve o código do desfecho e escreve no canal certo', () => {
    const ok = [];
    const erros = [];
    const log = (m) => ok.push(m);
    const error = (m) => erros.push(m);
    const bom = cenario({
      'package.json': { name: 'x', overrides: { 'js-yaml': '^4.3.2' } },
      'package-lock.json': LOCK_COERENTE,
    });

    expect(main(['js-yaml', ALVO, '--expect=override', '--root', bom], { log, error })).toBe(EXIT.OK);
    expect(ok.join(' ')).toContain('ALVO DECLARADO');

    expect(main(['js-yaml', ALVO, '--expect=override', '--root', path.join(bom, 'inexistente')], { log, error })).toBe(EXIT.NOT_APPLIED);
    expect(erros.join(' ')).toContain('ALVO NAO DECLARADO');

    expect(main(['js-yaml', 'versao-invalida', '--expect=override', '--root', bom], { log, error })).toBe(EXIT.INCOMPARABLE);

    // Comando CURTO: o limite é `engineering_test_runs.command` varchar(255).
    const comando = `node scripts/security-intel-verify-target.js js-yaml ${ALVO} --expect=override`;
    expect(comando.length).toBeLessThan(255);

    expect(main(['js-yaml', ALVO, '/tmp/perdido'], { log, error })).toBe(EXIT.USAGE);
    expect(main([], { log, error })).toBe(EXIT.USAGE);
  });
});
