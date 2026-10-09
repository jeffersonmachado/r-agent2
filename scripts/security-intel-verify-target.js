#!/usr/bin/env node
'use strict';

/**
 * Aceite MECÂNICO de uma correção de dependência: o alvo está APLICADO no grafo declarado?
 *
 * Uso:
 *   node scripts/security-intel-verify-target.js <pacote> <versãoAlvo> [--expect=override|direct|any]
 *        [--source=declared|installed] [--ecosystem=npm|pypi] [--root <dir>]
 *
 * Duas razões para este script existir:
 *
 * 1. O comando de teste é REGISTRADO em `engineering_test_runs.command`, **varchar(255)**. O
 *    one-liner `node -e` que este script substitui tinha ~300 caracteres: o INSERT falhava com
 *    `22001 value too long for type character varying(255)` e o comando era classificado como
 *    **REJECTED** sem nunca rodar (medido em 2026-10-09).
 *
 * 2. `--source=declared` (padrão) verifica o que uma missão de patch PODE mudar: `package.json`
 *    (`overrides`/`dependencies`) e `package-lock.json`. No workspace isolado a árvore
 *    `node_modules` é um bind READ-ONLY do repositório do host (`executionSandbox`), portanto
 *    uma prova que lia a árvore instalada NUNCA passaria, mesmo com o patch correto — e, pior,
 *    mediria a árvore do host, não a correção. `--source=installed` continua disponível para
 *    verificação de host (depois de `npm ci`).
 *
 * Fail-closed: quando o rangedor não é avaliável ou as versões não são comparáveis, o resultado é
 * INCOMPARABLE (código 2), nunca "passou".
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { compareVersions, satisfiesComparatorSet, normalizeEcosystem, ECOSYSTEMS } = require('../engine/securityIntel/versionCore');

const EXIT = Object.freeze({ OK: 0, NOT_APPLIED: 1, INCOMPARABLE: 2, USAGE: 3 });

/**
 * Extrai o nome do pacote de uma chave de `overrides` do npm (que pode trazer o range colado:
 * `js-yaml@^4`, `"js-yaml"`, `"@scope/pkg"`).
 */
function overrideKeyName(key) {
  const raw = String(key || '').trim();
  if (!raw) return '';
  const at = raw.lastIndexOf('@');
  // Em pacote com escopo o `@` inicial é parte do nome (`@scope/pkg`), nunca separador de range.
  if (at > 0) return raw.slice(0, at).trim();
  return raw;
}

/**
 * Percorre `overrides` (estrutura aninhada do npm) procurando declarações do pacote alvo.
 * Aceita `"pkg": "^1.2.3"`, `"pkg@^1": "1.2.3"` e referências `$pkg`.
 * @returns {Array<{path:string, range:string}>}
 */
function collectOverrideEntries(overrides, packageName, path = []) {
  const found = [];
  if (!overrides || typeof overrides !== 'object') return found;
  for (const [key, value] of Object.entries(overrides)) {
    const name = overrideKeyName(key);
    const aqui = path.concat(key).join(' > ');
    if (name === packageName && typeof value === 'string') {
      found.push({ path: `overrides.${aqui}`, range: value });
    } else if (value && typeof value === 'object') {
      found.push(...collectOverrideEntries(value, packageName, path.concat(key)));
    }
  }
  return found;
}

/** Declarações DIRETAS do pacote em `package.json` (deps de produção, dev e opcionais). */
function collectDirectEntries(pkg, packageName) {
  const found = [];
  for (const campo of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const range = pkg && pkg[campo] ? pkg[campo][packageName] : undefined;
    if (typeof range === 'string') found.push({ path: campo, range });
  }
  return found;
}

/** Versões RESOLVIDAS do pacote no lockfile npm (`packages` v2/v3 e `dependencies` v1). */
function collectLockVersions(lock, packageName) {
  const found = [];
  if (!lock || typeof lock !== 'object') return found;
  const pacotes = lock.packages && typeof lock.packages === 'object' ? lock.packages : {};
  for (const [caminho, info] of Object.entries(pacotes)) {
    if (!caminho.endsWith(`node_modules/${packageName}`)) continue;
    if (info && typeof info.version === 'string') found.push({ path: `packages[${caminho}]`, version: info.version });
  }
  const walk = (deps, prefixo) => {
    if (!deps || typeof deps !== 'object') return;
    for (const [nome, info] of Object.entries(deps)) {
      if (nome === packageName && info && typeof info.version === 'string') {
        found.push({ path: `${prefixo}${nome}`, version: info.version });
      }
      if (info && typeof info === 'object' && info.dependencies) walk(info.dependencies, `${prefixo}${nome}/`);
    }
  };
  walk(lock.dependencies, '');
  return found;
}

/**
 * Veredito sobre as declarações coletadas. PURO: recebe dados já lidos.
 * Regras: a declaração durável (overrides / deps) precisa ADMITIR o alvo, e TODA cópia resolvida no
 * lockfile precisa estar >= alvo (cópia antiga no lock = correção não aplicada de fato).
 */
function evaluateDeclaredTarget({ packageName, targetVersion, expect = 'any', declarations = [], lockVersions = [], ecosystem = ECOSYSTEMS.NPM }) {
  const alvo = String(targetVersion || '').trim();
  const ordem = expect === 'override' ? ['overrides'] : expect === 'direct' ? ['direct'] : ['overrides', 'direct'];
  const porTipo = {
    overrides: declarations.filter((d) => d.path.startsWith('overrides.')),
    direct: declarations.filter((d) => !d.path.startsWith('overrides.')),
  };
  const usadas = ordem.flatMap((tipo) => porTipo[tipo]);
  if (!usadas.length) {
    const onde = expect === 'override' ? 'nenhuma entrada `overrides`' : expect === 'direct' ? 'nenhuma dependência direta' : 'nenhuma entrada `overrides` nem dependência direta';
    return {
      status: 'NOT_APPLIED',
      message: `ALVO NAO DECLARADO: ${onde} declara ${packageName} — a correção não está no grafo declarado`,
    };
  }
  const detalhes = [];
  for (const d of usadas) {
    const satisfaz = satisfiesComparatorSet(alvo, d.range, { ecosystem });
    if (satisfaz === null) {
      return {
        status: 'INCOMPARABLE',
        message: `declaracao nao avaliavel (${d.path}=${d.range} vs alvo ${alvo}) — aceite NAO pode declarar sucesso`,
      };
    }
    if (satisfaz === false) {
      return {
        status: 'NOT_APPLIED',
        message: `ALVO NAO APLICADO: ${d.path}=${d.range} nao admite ${alvo}`,
      };
    }
    detalhes.push(`${d.path.replace(/^overrides\./, '')}=${d.range}`);
  }
  for (const l of lockVersions) {
    const cmp = compareVersions(l.version, alvo, { ecosystem });
    if (cmp === null || cmp === undefined) {
      return {
        status: 'INCOMPARABLE',
        message: `versao do lockfile nao comparavel (${l.path}=${l.version} vs ${alvo}) — aceite NAO pode declarar sucesso`,
      };
    }
    if (cmp < 0) {
      return {
        status: 'NOT_APPLIED',
        message: `ALVO NAO APLICADO: lockfile ainda resolve ${packageName}@${l.version} < ${alvo} (${l.path})`,
      };
    }
    detalhes.push(`lock[${l.version}]`);
  }
  return {
    status: 'OK',
    message: `ALVO DECLARADO: ${packageName} ${detalhes.join(' ')} >= ${alvo}`,
  };
}

/** Lê o grafo declarado do diretório (package.json / package-lock.json). */
function readDeclaredNpm(rootDir, packageName) {
  const ler = (nome) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(rootDir, nome), 'utf8'));
    } catch {
      return null;
    }
  };
  const pkg = ler('package.json') || {};
  const lock = ler('package-lock.json');
  return {
    declarations: collectOverrideEntries(pkg.overrides, packageName).concat(collectDirectEntries(pkg, packageName)),
    lockVersions: collectLockVersions(lock, packageName),
  };
}

/** Lê o grafo declarado do requirements.txt (PyPI). */
function readDeclaredPypi(rootDir, packageName) {
  const arquivos = [path.join(rootDir, 'requirements.txt'), path.join(rootDir, 'rag-service', 'requirements.txt')];
  const declarations = [];
  const nome = packageName.toLowerCase().replace(/[-_.]+/g, '-');
  for (const arquivo of arquivos) {
    let texto;
    try {
      texto = fs.readFileSync(arquivo, 'utf8');
    } catch {
      continue;
    }
    for (const linha of texto.split(/\r?\n/)) {
      const limpa = linha.split('#')[0].trim();
      if (!limpa) continue;
      const m = limpa.match(/^([A-Za-z0-9_.-]+)\s*(.*)$/);
      if (!m) continue;
      if (m[1].toLowerCase().replace(/[-_.]+/g, '-') !== nome) continue;
      declarations.push({ path: `requirements.txt[${m[1]}]`, range: m[2].trim() || '*' });
    }
  }
  return { declarations, lockVersions: [] };
}

/**
 * Núcleo PURO e testável: recebe a leitura do grafo já feita.
 * @returns {{status:'OK'|'NOT_APPLIED'|'INCOMPARABLE'|'MISSING', installed:string|null, message:string}}
 */
function verifyTarget({ packageName, targetVersion, ecosystem = ECOSYSTEMS.NPM, source = 'declared', expect = 'any', rootDir, resolveVersion, readGraph }) {
  const nome = String(packageName || '').trim();
  const alvo = String(targetVersion || '').trim();
  if (!nome || !alvo) {
    return { status: 'MISSING', installed: null, message: 'uso: <pacote> <versaoAlvo> [--expect=override|direct|any] [--source=declared|installed]' };
  }
  const eco = normalizeEcosystem(ecosystem) === ECOSYSTEMS.PYPI ? ECOSYSTEMS.PYPI : ECOSYSTEMS.NPM;

  if (source === 'installed') {
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
      return { status: 'NOT_APPLIED', installed, message: `ALVO NAO APLICADO: ${nome} instalado ${installed} < ${alvo}` };
    }
    return { status: 'OK', installed, message: `ALVO INSTALADO: ${nome} ${installed} >= ${alvo}` };
  }

  // Leitor padrão é o REAL: um chamador que esquece de injetar não pode receber "não declarado"
  // por falta de dados (falso negativo silencioso). A injeção existe para o teste.
  const lerGrafo = readGraph || (eco === ECOSYSTEMS.PYPI ? readDeclaredPypi : readDeclaredNpm);
  const grafo = lerGrafo(rootDir, nome, eco) || { declarations: [], lockVersions: [] };
  const veredito = evaluateDeclaredTarget({
    packageName: nome,
    targetVersion: alvo,
    expect,
    declarations: grafo.declarations,
    lockVersions: grafo.lockVersions,
    ecosystem: eco,
  });
  return { ...veredito, installed: null };
}

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

function parseArgs(argv = []) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i]);
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq > 0) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      const nome = arg.slice(2);
      const proximo = argv[i + 1];
      // `--root /caminho` e `--root=/caminho` valem igual: um caminho perdido por falta de `=`
      // caía silenciosamente no cwd e produzia veredito sobre o repositório errado.
      flags[nome] = proximo !== undefined && !String(proximo).startsWith('--') ? String(argv[(i += 1)]) : 'true';
    }
  }
  return {
    packageName: positional[0] || null,
    targetVersion: positional[1] || null,
    extraArgs: positional.slice(2),
    ecosystem: flags.ecosystem || 'npm',
    expect: flags.expect || 'any',
    source: flags.source || 'declared',
    root: flags.root && flags.root !== 'true' ? flags.root : process.cwd(),
  };
}

function main(argv = process.argv.slice(2), { log = console.log, error = console.error } = {}) {
  const { packageName, targetVersion, ecosystem, expect, source, root, extraArgs } = parseArgs(argv);
  if (extraArgs && extraArgs.length) {
    // Argumento solto é erro de uso, não algo a ignorar: um caminho perdido aqui vira veredito
    // sobre o diretório errado.
    error(`argumento nao reconhecido: ${extraArgs.join(' ')} (uso: <pacote> <versaoAlvo> [--expect=...] [--source=...] [--ecosystem=...] [--root <dir>])`);
    return EXIT.USAGE;
  }
  const eco = normalizeEcosystem(ecosystem) === ECOSYSTEMS.PYPI ? ECOSYSTEMS.PYPI : ECOSYSTEMS.NPM;
  const resolveVersion = eco === ECOSYSTEMS.PYPI ? resolvePypiVersion : resolveNpmVersion;
  const readGraph = eco === ECOSYSTEMS.PYPI ? readDeclaredPypi : readDeclaredNpm;

  const result = verifyTarget({
    packageName,
    targetVersion,
    ecosystem: eco,
    expect,
    source,
    rootDir: root,
    resolveVersion: (nome, e) => resolveVersion(nome, root, e),
    readGraph: (dir, nome, e) => readGraph(dir || root, nome, e),
  });
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
  overrideKeyName,
  collectOverrideEntries,
  collectDirectEntries,
  collectLockVersions,
  evaluateDeclaredTarget,
  readDeclaredNpm,
  readDeclaredPypi,
  resolveNpmVersion,
  resolvePypiVersion,
  verifyTarget,
  main,
};
