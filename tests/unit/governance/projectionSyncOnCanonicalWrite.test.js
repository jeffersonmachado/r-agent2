'use strict';

/**
 * Regressão: quem grava a decisão canônica precisa REGENERAR e VALIDAR as
 * projeções na mesma execução.
 *
 * Defeito medido (2026-10-19, run `rap-governed-20261017053314590-3558e6f4`):
 * projeções gravadas 11:12:00 (fingerprint `2c8f986c…`, `NO_GO:BLOCKING_GAPS`) e
 * canônica regravada 11:14:09 (fingerprint `bfbabde3…`,
 * `PASS_WITH_DEFERRED_PACKAGE_GATE`). O repositório passou a publicar uma decisão
 * nos docs e outra na canônica, e o gate `validate:final-status-projection`
 * reprovou (L2 = `FINAL_STATUS_PROJECTION_STALE`).
 *
 * A causa não é o gerador (ele apenas copia a canônica): é a JANELA entre gravar
 * a canônica e lembrar de regenerar as projeções. Este teste trava a ordem.
 */

const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const PRODUTOR = path.join(RAIZ, 'tools', 'system', 'platform-readiness.js');
const GERADOR = path.join(RAIZ, 'scripts', 'governance', 'generate-final-status-projections.js');
const VALIDADOR = path.join(RAIZ, 'scripts', 'governance', 'validate-final-status-projection.js');

const fonte = fs.readFileSync(PRODUTOR, 'utf8');

/** Remove comentários para inspecionar CÓDIGO, não a docstring que descreve o bug. */
function somenteCodigo(conteudo) {
  return conteudo
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linha) => !linha.trim().startsWith('//'))
    .join('\n');
}

describe('produtor da decisão canônica sincroniza as projeções', () => {
  test('as duas ferramentas canônicas existem em disco', () => {
    expect(fs.existsSync(GERADOR)).toBe(true);
    expect(fs.existsSync(VALIDADOR)).toBe(true);
  });

  test('main() chama syncDerivedProjections depois de persistReport', () => {
    const codigo = somenteCodigo(fonte);
    const corpoMain = codigo.slice(codigo.indexOf('function main()'), codigo.indexOf('if (require.main === module)'));
    const posPersist = corpoMain.indexOf('persistReport(report)');
    const posSync = corpoMain.indexOf('syncDerivedProjections()');
    expect(posPersist).toBeGreaterThan(-1);
    expect(posSync).toBeGreaterThan(posPersist);
  });

  test('syncDerivedProjections executa o gerador E o validador (não só um)', () => {
    const codigo = somenteCodigo(fonte);
    const corpoSync = codigo.slice(codigo.indexOf('function syncDerivedProjections()'));
    expect(corpoSync).toContain('generate-final-status-projections.js');
    expect(corpoSync).toContain('validate-final-status-projection.js');
    // fail-closed: falha na sincronização derruba o produtor
    expect(corpoSync).toMatch(/process\.exitCode\s*=\s*1/);
  });

  test('a sincronização é exportada (permite regressão direta)', () => {
    const codigo = somenteCodigo(fonte);
    const blocoExports = codigo.slice(codigo.indexOf('module.exports'));
    expect(blocoExports).toContain('syncDerivedProjections');
  });
});
