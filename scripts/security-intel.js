#!/usr/bin/env node
'use strict';

/**
 * security-intel — CLI da capacidade RAP Version & Security Intelligence.
 *
 * Subcomandos:
 *   discover   coleta o inventário real (componentes, versões, drift, cobertura)
 *              e grava `reports/security-intel-discovery-report.json`.
 *   sbom       gera o SBOM CycloneDX a partir do inventário, valida e grava o
 *              artefato + `reports/security-intel-report.json`.
 *   inventory  imprime o resumo do inventário PERSISTIDO (Postgres).
 *   status     idade da informação: última coleta, último SBOM e lacunas.
 *
 * Flags comuns: `--persist` (grava no Postgres), `--json` (saída máquina),
 * `--no-docker` (não sonda o daemon Docker), `--tenant <key>`.
 *
 * Regra de honestidade: este CLI nunca imprime "sem vulnerabilidades". Ele
 * separa o que foi MEDIDO do que está INDISPONÍVEL.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Carrega `.env` sem depender de dotenv (não sobrescreve ambiente explícito). */
function loadEnvFile(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return { loaded: false, keys: 0 };
  const content = fs.readFileSync(file, 'utf8');
  let keys = 0;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
    keys += 1;
  }
  return { loaded: true, keys };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--persist') args.persist = true;
    else if (token === '--json') args.json = true;
    else if (token === '--no-docker') args.noDocker = true;
    else if (token === '--tenant') args.tenant = argv[++index];
    else if (token === '--out') args.out = argv[++index];
    else args._.push(token);
  }
  return args;
}

function writeJsonReport(relativePath, payload) {
  const abs = path.join(ROOT, relativePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`);
  return abs;
}

/** Descobre as imagens declaradas para alimentar o probe do Docker. */
function collectDeclaredImages() {
  const { parseComposeImages } = require('../api/services/securityIntel/manifestReaders');
  const { COMPOSE_FILES } = require('../api/services/securityIntel/componentDiscoveryService');
  const images = [];
  const seen = new Set();
  for (const composeRel of COMPOSE_FILES) {
    const abs = path.join(ROOT, composeRel);
    if (!fs.existsSync(abs)) continue;
    const parsed = parseComposeImages(fs.readFileSync(abs, 'utf8'), { source: composeRel, service: composeRel });
    for (const image of parsed.images) {
      if (seen.has(image.reference)) continue;
      seen.add(image.reference);
      images.push(image);
    }
  }
  return images;
}

async function runDiscovery({ persist, tenant, noDocker }) {
  const { discoverComponents } = require('../api/services/securityIntel/componentDiscoveryService');
  const { createDefaultProbes } = require('../api/services/securityIntel/probes');

  const now = new Date().toISOString();
  const declaredImages = collectDeclaredImages();
  const probes = createDefaultProbes({
    rootDir: ROOT,
    declaredImages,
    includeDocker: !noDocker,
  });

  const startedAt = Date.now();
  const discovery = await discoverComponents({ rootDir: ROOT, now, probes });
  const durationMs = Date.now() - startedAt;

  let persistence = null;
  if (persist) {
    const { persistDiscovery } = require('../api/services/securityIntel/inventoryStoreService');
    persistence = await persistDiscovery({ discovery, tenantKey: tenant || 'system', durationMs });
  }

  const report = {
    generatedAt: now,
    status: (discovery.identityConflicts || []).length > 0 ? 'DEGRADED' : 'PASS',
    durationMs,
    counts: discovery.counts,
    coverage: discovery.coverage,
    drift: discovery.drift,
    warnings: discovery.warnings,
    unavailable: discovery.unavailable,
    identityConflicts: discovery.identityConflicts,
    sources: discovery.sources,
    persistence,
  };
  const reportPath = writeJsonReport('reports/security-intel-discovery-report.json', report);
  return { discovery, report, reportPath, declaredImages };
}

async function commandDiscover(args) {
  const { discovery, report, reportPath } = await runDiscovery({
    persist: args.persist,
    tenant: args.tenant,
    noDocker: args.noDocker,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  const { counts } = discovery;
  console.log('=== RAP Version & Security Intelligence — descoberta ===');
  console.log(`componentes........: ${counts.components} (diretos ${counts.direct} / transitivos ${counts.transitive})`);
  console.log(`classes de versão..: ${Object.entries(counts.byVersionClass).map(([key, value]) => `${key}=${value}`).join(' ')}`);
  console.log(`requisitos ........: ${counts.requirements}  arestas de dependência: ${counts.dependencyEdges}`);
  console.log(`fontes ............: ${counts.sourcesRead} lidas / ${counts.sourcesMissing} ausentes`);
  console.log(`cobertura .........: ${discovery.coverage.coveragePercent}% (limites declarados: ${discovery.coverage.outOfScope.length})`);
  const drift = discovery.drift.filter((entry) => entry.verdict === 'drift');
  const unverifiable = discovery.drift.filter((entry) => entry.verdict === 'unverifiable');
  console.log(`drift .............: ${drift.length} confirmado(s), ${unverifiable.length} não verificável(is)`);
  for (const entry of drift.slice(0, 10)) {
    console.log(`   - ${entry.key}: declarado ${entry.declared} ≠ resolvido ${entry.resolved} (${entry.service})`);
  }
  if (discovery.unavailable.length > 0) {
    console.log(`indisponível ......: ${discovery.unavailable.map((entry) => `${entry.source}(${entry.reason})`).join(', ')}`);
  }
  if (discovery.identityConflicts.length > 0) {
    console.log(`conflitos de identidade: ${discovery.identityConflicts.length}`);
  }
  console.log(`relatório .........: ${path.relative(ROOT, reportPath)}`);
  return 0;
}

async function commandSbom(args) {
  const { generateSbom } = require('../api/services/securityIntel/sbomService');
  const { discovery, declaredImages } = await runDiscovery({
    persist: false,
    tenant: args.tenant,
    noDocker: args.noDocker,
  });

  const result = await generateSbom({
    rootDir: ROOT,
    now: new Date().toISOString(),
    discovery,
    persist: args.persist,
    tenantKey: args.tenant || 'system',
  });

  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(ROOT, 'reports', 'security-intel', `sbom-${result.sha256.slice(0, 12)}.cdx.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, result.serialized);

  const report = {
    generatedAt: discovery.generatedAt,
    status: result.validation.valid ? 'PASS' : 'FAIL',
    format: result.sbom.bomFormat,
    specVersion: result.specVersion,
    serialNumber: result.sbom.serialNumber,
    sha256: result.sha256,
    componentCount: result.componentCount,
    dependencyCount: (result.sbom.dependencies || []).length,
    validation: result.validation,
    artifactPath: path.relative(ROOT, outPath),
    snapshotId: result.snapshotId,
    persisted: result.persisted,
    coverage: discovery.coverage,
    unavailable: discovery.unavailable,
    declaredImages: declaredImages.length,
  };
  const reportPath = writeJsonReport('reports/security-intel-report.json', report);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return result.validation.valid ? 0 : 1;
  }

  console.log('=== SBOM (CycloneDX) ===');
  console.log(`validação .........: ${result.validation.valid ? 'VÁLIDO' : 'INVÁLIDO'}`);
  if (!result.validation.valid) {
    for (const issue of result.validation.issues.slice(0, 10)) console.log(`   ✗ ${issue.code}: ${issue.message}`);
  }
  console.log(`componentes .......: ${result.componentCount}`);
  console.log(`dependências ......: ${(result.sbom.dependencies || []).length} aresta(s) declarada(s)`);
  console.log(`serialNumber ......: ${result.sbom.serialNumber}`);
  console.log(`sha256 ............: ${result.sha256}`);
  console.log(`artefato ..........: ${path.relative(ROOT, outPath)}`);
  console.log(`persistido ........: ${result.persisted ? `sim (${result.snapshotId})` : 'não (use --persist)'}`);
  console.log(`relatório .........: ${path.relative(ROOT, reportPath)}`);
  return result.validation.valid ? 0 : 1;
}

async function commandInventory(args) {
  const { getInventorySummary, getLatestDiscoveryRun } = require('../api/services/securityIntel/inventoryStoreService');
  const tenantKey = args.tenant || 'system';
  const summary = await getInventorySummary({ tenantKey });
  const latest = await getLatestDiscoveryRun({ tenantKey });
  const payload = {
    tenantKey,
    summary,
    latestRun: latest
      ? {
        id: latest.id,
        status: latest.status,
        startedAt: latest.started_at,
        finishedAt: latest.finished_at,
        counts: latest.counts,
        coveragePercent: latest.coverage?.coveragePercent ?? null,
      }
      : null,
  };
  if (args.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else {
    console.log('=== Inventário persistido (Postgres) ===');
    console.log(`total de componentes: ${summary.total}`);
    console.log(`por classe .........: ${Object.entries(summary.byVersionClass).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    console.log(`por ecossistema ....: ${Object.entries(summary.byEcosystem).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    console.log(`por serviço ........: ${Object.entries(summary.byService).map(([k, v]) => `${k}=${v}`).join(' ')}`);
    console.log(`última coleta ......: ${payload.latestRun ? `${payload.latestRun.startedAt} (${payload.latestRun.status})` : 'nenhuma'}`);
  }
  return 0;
}

async function commandStatus(args) {
  const { getLatestDiscoveryRun } = require('../api/services/securityIntel/inventoryStoreService');
  const { getLatestSbomSnapshot, listSbomSnapshots } = require('../api/services/securityIntel/sbomService');
  const tenantKey = args.tenant || 'system';
  const [latestRun, latestSnapshot, snapshots] = await Promise.all([
    getLatestDiscoveryRun({ tenantKey }),
    getLatestSbomSnapshot({ tenantKey }),
    listSbomSnapshots({ tenantKey, limit: 5 }),
  ]);
  const ageHours = latestRun
    ? (Date.now() - new Date(latestRun.started_at).getTime()) / 3600000
    : null;
  const payload = {
    tenantKey,
    discovery: latestRun
      ? { id: latestRun.id, startedAt: latestRun.started_at, ageHours, coveragePercent: latestRun.coverage?.coveragePercent ?? null }
      : null,
    sbom: latestSnapshot
      ? {
        id: latestSnapshot.id,
        sha256: latestSnapshot.sha256,
        components: latestSnapshot.component_count,
        generatedAt: latestSnapshot.generated_at,
        valid: latestSnapshot.validation?.valid === true,
      }
      : null,
    sbomHistory: snapshots.map((snapshot) => ({
      sha256: snapshot.sha256,
      components: snapshot.component_count,
      generatedAt: snapshot.generated_at,
    })),
  };
  if (args.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else {
    console.log('=== Status da inteligência de versões/segurança ===');
    console.log(`coleta .............: ${payload.discovery ? `${payload.discovery.startedAt} (idade ${ageHours.toFixed(1)}h, cobertura ${payload.discovery.coveragePercent}%)` : 'NENHUMA — informação inexistente'}`);
    console.log(`sbom ...............: ${payload.sbom ? `${payload.sbom.sha256.slice(0, 12)} (${payload.sbom.components} componentes, válido=${payload.sbom.valid})` : 'NENHUM'}`);
    console.log(`histórico de SBOM ..: ${payload.sbomHistory.length} snapshot(s)`);
  }
  return 0;
}

const COMMANDS = {
  discover: commandDiscover,
  sbom: commandSbom,
  inventory: commandInventory,
  status: commandStatus,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || !COMMANDS[command]) {
    console.error('uso: node scripts/security-intel.js <discover|sbom|inventory|status> [--persist] [--json] [--no-docker] [--tenant <key>] [--out <path>]');
    return 2;
  }
  // Em modo `--json` o stdout é dado de máquina: todo log vai para stderr,
  // senão qualquer consumidor (jq, pipeline de gate) quebra na primeira linha.
  if (args.json) {
    const toStderr = (...chunks) => process.stderr.write(`${chunks.join(' ')}\n`);
    console.log = toStderr;
    console.info = toStderr;
    console.warn = toStderr;
    console.debug = toStderr;
  }
  loadEnvFile();
  try {
    return await COMMANDS[command](args);
  } catch (error) {
    if (error && error.code === 'persistence_required') {
      console.error('[security-intel] persistência indisponível (Postgres). Rode sem --persist ou suba o banco.');
      return 3;
    }
    console.error(`[security-intel] falha: ${error.message}`);
    if (process.env.SECURITY_INTEL_DEBUG === '1') console.error(error.stack);
    return 1;
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code)).catch((error) => {
    console.error(`[security-intel] erro fatal: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { loadEnvFile, parseArgs, collectDeclaredImages, runDiscovery };
