#!/usr/bin/env node
'use strict';

/**
 * Aceite MECÂNICO de uma correção de dependência: o pacote está instalado na versão >= alvo?
 *
 * Uso:
 *   node scripts/security-intel-verify-target.js <pacote> <versãoAlvo> [--ecosystem=npm|pypi]
 *
 * Por que um SCRIPT e não um `node -e` inline no Task Contract: o comando de teste é
 * REGISTRADO em `engineering_test_runs.command`, que é **varchar(255)**. O one-liner que este
 * script substitui tinha ~300 caracteres: o INSERT falhava com `22001 value too long for type
 * character varying(255)` e o comando era classificado como **REJECTED** sem nunca rodar
 * (medido em 2026-10-09, na primeira missão com o aceite novo). Comando curto não é estética —
 * é requisito do registro de execução.
 *
 * Fail-closed: quando as versões NÃO são comparáveis (formato desconhecido) a saída é código 2,
 * nunca "passou". Uma prova de aceite que não consegue comparar não pode declarar sucesso.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { compareVersions, normalizeEcosystem, ECOSYSTEMS } = require('../engine/securityIntel/versionCore');

const EXIT = Object.freeze({ OK: 0, NOT_APPLIED: 1, INCOMPARABLE: 2, USAGE: 3 });

/** Versão instalada de um pacote npm (via `package.json` do pacote resolvido a partir da raiz). */
function resolveNpmVersion(packageName, cwd = process.cwd()) {
  const candidates = [];
  try {
    candidates.push(require.resolve(`${packageName}/package.json`, { paths: [cwd] }));
  } catch {
    // Sem resolução pelo Node (árvore não hoisted): procura o caminho convencional.
  }
  candidates.push(path.join(cwd, 'node_modules', packageName, 'package.json'));
  candidates.push(path.join(cwd, 'frontend', 'node_modules', packageName, 'package.json'));

  for (const file of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && typeof raw.version === 'string') return raw.version;
    } catch {
      // tenta o próximo candidato
    }
  }
  return null;
}

/** Versão instalada de um pacote Python (metadata do venv do serviço). */
function resolvePypiVersion(packageName, cwd = process.cwd()) {
  const python = path.join(cwd, 'venv', 'bin', 'python');
  const executable = fs.existsSync(python) ? python : 'python3';
  const code = `import importlib.metadata as m\ntry:\n    print(m.version(${JSON.stringify(packageName)}))\nexcept Exception:\n    print("")`;
  try {
    const out = execFileSync(executable, ['-c', code], { cwd, encoding: 'utf8', timeout: 30000 });
    const version = String(out).trim();
    return version || null;
  } catch {
    return null;
  }
}

/**
 * Núcleo PURO e testável: recebe o resolvedor de versão injetado.
 * @returns {{status:'OK'|'NOT_APPLIED'|'INCOMPARABLE'|'MISSING', installed:string|null, message:string}}
 */
function verifyTarget({ packageName, targetVersion, ecosystem = 'npm', resolveVersion }) {
  const nome = String(packageName || '').trim();
  const alvo = String(targetVersion || '').trim();
  if (!nome || !alvo) {
    return { status: 'MISSING', installed: null, message: 'uso: <pacote> <versaoAlvo> [--ecosystem=npm|pypi]' };
  }
  const eco = normalizeEcosystem(ecosystem) === ECOSYSTEMS.PYPI ? ECOSYSTEMS.PYPI : ECOSYSTEMS.NPM;
  const installed = resolveVersion ? resolveVersion(nome, eco) : null;
  if (!installed) {
    return { status: 'MISSING', installed: null, message: `pacote nao encontrado na arvore instalada: ${nome}` };
  }
  const comparison = compareVersions(installed, alvo, { ecosystem: eco });
  if (comparison === null || comparison === undefined) {
    return {
      status: 'INCOMPARABLE',
      installed,
      message: `versoes nao comparaveis (${installed} vs ${alvo}) — aceite NAO pode declarar sucesso`,
    };
  }
  if (comparison < 0) {
    return { status: 'NOT_APPLIED', installed, message: `ALVO NAO APLICADO: ${nome} ${installed} < ${alvo}` };
  }
  return { status: 'OK', installed, message: `ALVO APLICADO: ${nome} ${installed} >= ${alvo}` };
}

function parseArgs(argv = []) {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const ecoArg = argv.find((arg) => arg.startsWith('--ecosystem='));
  return {
    packageName: positional[0] || null,
    targetVersion: positional[1] || null,
    ecosystem: ecoArg ? ecoArg.split('=')[1] : 'npm',
  };
}

function main(argv = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  const { packageName, targetVersion, ecosystem } = parseArgs(argv);
  const eco = normalizeEcosystem(ecosystem) === ECOSYSTEMS.PYPI ? ECOSYSTEMS.PYPI : ECOSYSTEMS.NPM;
  const resolveVersion = eco === ECOSYSTEMS.PYPI ? resolvePypiVersion : resolveNpmVersion;

  const result = verifyTarget({ packageName, targetVersion, ecosystem: eco, resolveVersion });
  if (result.status === 'OK') {
    log(result.message);
    return EXIT.OK;
  }
  error(result.message);
  if (result.status === 'INCOMPARABLE') return EXIT.INCOMPARABLE;
  if (result.status === 'MISSING' && !packageName) return EXIT.USAGE;
  return EXIT.NOT_APPLIED;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  EXIT,
  parseArgs,
  resolveNpmVersion,
  resolvePypiVersion,
  verifyTarget,
  main,
};
