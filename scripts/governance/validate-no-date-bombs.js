'use strict';

/**
 * Validador: time bombs de janela móvel em testes.
 *
 * PROBLEMA REAL (medido 2026-10-14): `tests/integration/evoSyncIntegration.test.js`
 * afirmava `expect(history.frequency30d).toBe(2)` sobre entradas de 01-03/09/2026.
 * A agregação compara com `agora - 30 dias` (janela MÓVEL), então a asserção
 * venceu sozinha em 03/10/2026 e o teste passou a falhar sem que ninguém tivesse
 * mudado nada. Ficou quebrado ~11 dias porque nenhum gate o executa.
 *
 * A CLASSE do defeito: um teste que (a) menciona um campo calculado contra o
 * relógio, (b) tem dados de data FIXA no arquivo e (c) asserta IGUALDADE com um
 * número literal sobre esse campo. O teste passa a depender da distância entre a
 * data em que foi escrito e a data em que roda.
 *
 * O que NÃO é violação: asserção derivada (`toBe(dentroDaJanela(30))`), comparação
 * relacional (`toBeLessThanOrEqual`), ou dados com data relativa. O validador é
 * deliberadamente conservador para não virar ruído — a varredura de 2026-10-14
 * sobre 1307 arquivos de teste encontrou exatamente 1 instância (a corrigida).
 *
 * Uso: node scripts/governance/validate-no-date-bombs.js [--json]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..', '..');
const RELATORIO = path.join(RAIZ, 'reports', 'no-date-bombs-report.json');

/** Campos que o código calcula contra o relógio (nome → semântica). */
const CAMPOS_MOVEIS = [
  'frequency\\d+d',
  'last\\d+[Dd]ays',
  'recent\\d*[Dd]ays',
  'daysAgo',
  'daysSince\\w*',
  'windowDays',
  'within\\d*[Dd]ays',
  'lifetime\\w*',
];

const RE_CAMPO_MOVEL = new RegExp(`\\b(?:${CAMPOS_MOVEIS.join('|')})\\b`, 'i');

/** Data ISO literal (indício de dado fixo). */
const RE_DATA_FIXA = /['"`]20\d\d-\d\d-\d\d[T ]/;

/**
 * Asserção que afirma PRESENÇA: `toBe(N)` com N > 0 sobre um campo móvel.
 *
 * Este é o time bomb de verdade: o teste exige que N itens estejam DENTRO da
 * janela, e quando os dados envelhecem eles saem e a asserção vence sozinha.
 * Foi exatamente o caso de `frequency30d === 2` em 03/10/2026.
 */
const RE_ASSERCAO_POSITIVA = new RegExp(
  String.raw`expect\([^)]*\b(?:${CAMPOS_MOVEIS.join('|')})\b[^)]*\)\s*\.to(?:Be|Equal)\(\s*[1-9]\d*\s*\)`,
  'i'
);

/**
 * Asserção que afirma AUSÊNCIA: `toBe(0)` sobre um campo móvel.
 *
 * NÃO é time bomb: afirma que nada está na janela, e com dados antigos isso só
 * fica MAIS verdadeiro com o tempo (só falharia se o relógio andasse para trás).
 * Reportada como observação, não como falha — um gate que acusa isto vira ruído
 * e as pessoas o desligam.
 */
const RE_ASSERCAO_ZERO = new RegExp(
  String.raw`expect\([^)]*\b(?:${CAMPOS_MOVEIS.join('|')})\b[^)]*\)\s*\.to(?:Be|Equal)\(\s*0\s*\)`,
  'i'
);

/**
 * Lista os arquivos de teste versionados.
 * @returns {string[]}
 */
function listarTestes() {
  const saida = execFileSync('git', ['ls-files', 'tests', 'frontend/src', 'engine', 'api/__tests__'], {
    cwd: RAIZ,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return saida
    .trim()
    .split('\n')
    .filter((f) => f && /\.(test|spec)\.(js|jsx|mjs)$/.test(f));
}

/**
 * Analisa um arquivo.
 * @param {string} rel
 * @returns {object|null} achado, ou null
 */
function analisar(rel) {
  let src;
  try {
    src = fs.readFileSync(path.join(RAIZ, rel), 'utf8');
  } catch {
    return null;
  }
  if (!RE_CAMPO_MOVEL.test(src)) return null;
  if (!RE_DATA_FIXA.test(src)) return null;
  if (!RE_ASSERCAO_POSITIVA.test(src) && !RE_ASSERCAO_ZERO.test(src)) return null;

  const bombas = [];
  const observacoes = [];
  src.split('\n').forEach((l, i) => {
    if (RE_ASSERCAO_POSITIVA.test(l)) bombas.push({ line: i + 1, code: l.trim().slice(0, 160) });
    else if (RE_ASSERCAO_ZERO.test(l)) observacoes.push({ line: i + 1, code: l.trim().slice(0, 160) });
  });
  return { file: rel, timeBombs: bombas, stableByAbsence: observacoes };
}

function main(argv = process.argv.slice(2)) {
  const testes = listarTestes();
  const violacoes = [];
  for (const t of testes) {
    const v = analisar(t);
    if (v && v.timeBombs.length > 0) violacoes.push(v);
  }

  const relatorio = {
    schemaVersion: 1,
    kind: 'no-date-bombs',
    generatedAt: new Date().toISOString(),
    analyzed: testes.length,
    violationCount: violacoes.reduce((s, v) => s + v.timeBombs.length, 0),
    violations: violacoes,
    status: violacoes.length === 0 ? 'PASS' : 'FAIL',
  };
  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, JSON.stringify(relatorio, null, 1), 'utf8');

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(relatorio, null, 1)}\n`);
  } else {
    process.stdout.write(`[no-date-bombs] analisados ${testes.length} arquivos de teste\n`);
    if (relatorio.violationCount === 0) {
      process.stdout.write('[no-date-bombs] PASS: nenhum time bomb de janela móvel\n');
    } else {
      process.stdout.write(`[no-date-bombs] FAIL: ${relatorio.violationCount} asserção(ões)\n`);
      for (const v of violacoes) {
        process.stdout.write(`  ${v.file}\n`);
        v.timeBombs.forEach((a) => process.stdout.write(`     linha ${a.line}: ${a.code}\n`));
      }
      process.stdout.write(
        '[no-date-bombs] a janela é calculada contra o relógio: derive a expectativa ou use invariantes\n'
      );
    }
  }
  return relatorio.violationCount === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, analisar, listarTestes, RE_ASSERCAO_POSITIVA, RE_CAMPO_MOVEL, RE_DATA_FIXA };
