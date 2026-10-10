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
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/**
 * Usuário que executa o CLI: é a identidade de aprovação no contexto de linha de
 * comando. `--approve`/`--authorized-by` deixaram de ser identidade
 * autodeclarada — se divergirem de quem executa, o comando é recusado.
 */
function currentOsUser() {
  try {
    const info = os.userInfo();
    if (info && info.username) return info.username;
  } catch (_) { /* plataforma sem userInfo (container mínimo) */ }
  return process.env.SUDO_USER || process.env.USER || process.env.LOGNAME || null;
}

/**
 * Resolve a identidade de aprovação do CLI (fail-closed).
 *
 * @returns {string|null} usuário do SO, ou `null` quando não é possível
 *   determiná-lo ou quando a identidade declarada diverge dele.
 */
function resolveCliApprover(declared, commandName) {
  const declaredValue = declared ? String(declared).trim() : null;
  const osUser = currentOsUser();
  if (!osUser) {
    console.error(`[security-intel] não foi possível determinar o usuário do SO que executa o comando; a identidade de aprovação não pode ser declarada (${commandName}).`);
    return null;
  }
  if (declaredValue && declaredValue !== osUser) {
    console.error(`[security-intel] identidade de aprovação não é declarada: "${declaredValue}" difere do usuário que executa (${osUser}).`);
    return null;
  }
  return osUser;
}

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
    else if (token === '--limit') args.limit = argv[++index];
    else if (token === '--rate') args.rate = argv[++index];
    else if (token === '--scope') args.scope = argv[++index];
    else if (token === '--service') args.service = argv[++index];
    else if (token === '--actor') args.actor = argv[++index];
    else if (token === '--candidate') args.candidate = argv[++index];
    else if (token === '--authorized-by') args.authorizedBy = argv[++index];
    else if (token === '--finding') args.finding = argv[++index];
    else if (token === '--waiver') args.waiver = argv[++index];
    else if (token === '--approve') args.approve = argv[++index];
    else if (token === '--days') args.days = argv[++index];
    else if (token === '--reason') args.reason = argv[++index];
    else if (token === '--control') args.control = argv[++index];
    else if (token === '--state') args.state = argv[++index];
    else if (token === '--blocking') args.blocking = true;
    else if (token === '--include-dev') args.includeDev = true;
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

async function commandAdvisories(args) {
  const { listDistinctPackages } = require('../api/services/securityIntel/inventoryStoreService');
  const { syncAdvisories } = require('../api/services/securityIntel/vulnerabilityScanService');
  const tenantKey = args.tenant || 'system';
  const limit = args.limit ? Number(args.limit) : 0;
  const packages = await listDistinctPackages({ tenantKey, scope: args.scope || 'direct', limit });
  if (packages.length === 0) {
    console.error('[security-intel] inventário vazio: rode `discover --persist` antes de sincronizar advisories.');
    return 3;
  }
  const startedMs = Date.now();
  const result = await syncAdvisories({
    packages,
    tenantKey,
    actor: args.actor || 'security-intel-cli',
    options: {
      rateLimitPerSecond: args.rate ? Number(args.rate) : 4,
      maxPackages: limit || undefined,
    },
  });
  const report = {
    generatedAt: new Date().toISOString(),
    status: result.failures.length === 0 ? 'PASS' : 'DEGRADED',
    durationMs: Date.now() - startedMs,
    scope: args.scope || 'direct',
    packages: packages.length,
    stats: result.stats,
    failures: result.failures,
    snapshotSha256: result.snapshotSha256,
    syncId: result.sync.id,
    advisoriesTotal: result.sync.advisories_total,
  };
  const reportPath = writeJsonReport('reports/security-intel-advisories-report.json', report);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }
  console.log('=== Sincronização de advisories (OSV + KEV + EPSS) ===');
  console.log(`pacotes consultados : ${result.stats.packagesQueried}/${packages.length}${result.stats.packagesTruncated ? ' (TRUNCADO)' : ''}`);
  console.log(`advisories gravados : ${result.sync.advisories_upserted} (base total: ${result.sync.advisories_total})`);
  console.log(`KEV casados ........: ${result.stats.kevMatches}  EPSS casados: ${result.stats.epssMatches}`);
  console.log(`catálogo KEV .......: ${result.stats.kevCatalogSize || 'indisponível'}`);
  console.log(`snapshot (sha256) ..: ${result.snapshotSha256}`);
  console.log(`duração ............: ${report.durationMs} ms`);
  if (result.failures.length > 0) {
    console.log(`FALHAS ..............: ${result.failures.length}`);
    for (const failure of result.failures.slice(0, 10)) console.log(`   ! ${failure.package || failure.source}: ${failure.reason}`);
    console.log('   (a base está PARCIAL: a análise não pode ser lida como completa)');
  }
  console.log(`relatório ..........: ${path.relative(ROOT, reportPath)}`);
  return 0;
}

async function commandScan(args) {
  const { scanComponents, getFindingSummary } = require('../api/services/securityIntel/vulnerabilityScanService');
  const tenantKey = args.tenant || 'system';
  const report = await scanComponents({
    tenantKey,
    scope: args.scope || null,
    limit: args.limit ? Number(args.limit) : null,
    services: args.service ? [args.service] : null,
    actor: args.actor || 'security-intel-cli',
  });
  const summary = await getFindingSummary({ tenantKey });
  const payload = { generatedAt: new Date().toISOString(), ...report, summary };
  const reportPath = writeJsonReport('reports/security-intel-scan-report.json', payload);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }
  console.log('=== Correlação inventário × advisories ===');
  console.log(`componentes varridos: ${report.componentsScanned}${report.componentsTruncated ? ' (TRUNCADO pelo teto da política)' : ''}`);
  console.log(`base de advisories .: ${report.advisoriesInBase} (${report.advisorySource ? `sincronizada há ${report.advisorySource.ageHours}h, status ${report.advisorySource.status}` : 'NENHUMA sincronização registrada'})`);
  if (report.advisoryBaseStale) {
    console.log('   ! BASE VENCIDA: a análise abaixo reflete informação antiga — não é prova de ausência de risco');
  }
  console.log(`achados com risco ..: ${report.findings} (KEV: ${report.kevFindings}, não comparáveis: ${report.unknownApplicability})`);
  console.log(`avaliações VEX .....: ${report.notAffected} NOT_AFFECTED/FALSE_POSITIVE registrados (total avaliado: ${report.evaluations})`);
  console.log(`por severidade .....: ${Object.entries(report.bySeverity).map(([k, v]) => `${k}=${v}`).join(' ') || '-'}`);
  console.log(`por estado .........: ${Object.entries(report.byStatus).map(([k, v]) => `${k}=${v}`).join(' ') || '-'}`);
  console.log(`eventos novos ......: ${report.events}  resolvidos: ${report.resolved}`);
  console.log(`achados abertos ....: ${summary.open}`);
  console.log(`relatório ..........: ${path.relative(ROOT, reportPath)}`);
  return 0;
}

async function commandVectorIndex(args) {
  const { checkVectorIndexHealth } = require('../api/services/securityIntel/vectorIndexProbe');
  const { loadPolicy } = require('../api/services/securityIntel/vulnerabilityScanService');
  const policy = loadPolicy({ reload: true });
  const result = await checkVectorIndexHealth({ policy });
  const report = {
    generatedAt: new Date().toISOString(),
    status: result.evaluation.verdict,
    verdict: result.evaluation.verdict,
    summary: result.evaluation.summary,
    findings: result.evaluation.findings,
    unmeasured: result.evaluation.unmeasured,
    essentialUnmeasured: result.evaluation.essentialUnmeasured,
    evidence: result.evaluation.evidence,
    policy: result.policy,
  };
  const reportPath = writeJsonReport('reports/security-intel-vector-index-report.json', report);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return result.evaluation.verdict === 'INVALID' ? 1 : 0;
  }
  console.log('=== Integridade do índice vetorial (RAG) ===');
  console.log(`veredito ...........: ${result.evaluation.verdict}`);
  console.log(`resumo .............: ${result.evaluation.summary}`);
  const ev = result.evaluation.evidence;
  if (ev.extension) console.log(`extensão ...........: ${ev.extension.name} ${ev.extension.version || '(sem versão)'} (mínimo recomendado: ${ev.recommendedMinVersion || 'não declarado'})`);
  if (ev.index) {
    console.log(`índice .............: ${ev.index.name} [${ev.index.method}] opclass=${ev.index.opclass || '-'}`);
    console.log(`  validade ..........: indisvalid=${ev.index.isValid} indisready=${ev.index.isReady} indislive=${ev.index.isLive} (scans=${ev.index.scans ?? '?'})`);
  }
  if (ev.embeddings) {
    console.log(`embeddings ........: ${ev.embeddings.total} linhas, ${ev.embeddings.nulls} nulo(s), ${ev.embeddings.wrongDimensions} com dimensão errada (esperada ${ev.embeddings.expectedDimensions ?? 'não declarada'})`);
  }
  if (ev.planner) console.log(`planner usa índice .: ${ev.planner.usesVectorIndex === true ? 'SIM' : 'NÃO'}`);
  for (const finding of result.evaluation.findings) {
    console.log(`   [${finding.severity}] ${finding.code}: ${finding.message}`);
  }
  if (result.evaluation.unmeasured.length > 0) {
    console.log(`   não medido: ${result.evaluation.unmeasured.join(', ')} (lacuna de evidência, não é "está tudo bem")`);
  }
  console.log(`relatório ..........: ${path.relative(ROOT, reportPath)}`);
  return result.evaluation.verdict === 'INVALID' ? 1 : 0;
}

async function commandPatches(args) {
  const { generatePatchPlans, listPatchCandidates, fingerprintPlans } = require('../api/services/securityIntel/patchPlanService');
  const tenantKey = args.tenant || 'system';
  const result = await generatePatchPlans({
    tenantKey,
    onlyBlocking: args.blocking === true,
    includeDevOnly: args.includeDev === true,
  });
  const listed = await listPatchCandidates({ tenantKey, limit: 50 });
  const payload = {
    generatedAt: new Date().toISOString(),
    status: 'PASS',
    tenantKey,
    findings: result.findings,
    candidates: result.candidates,
    summary: result.summary,
    fingerprint: fingerprintPlans(result.plans),
    plans: result.plans.map((plan) => ({
      candidateKey: plan.candidateKey,
      package: plan.packageName,
      service: plan.service,
      from: plan.currentVersion,
      to: plan.targetVersion,
      kind: plan.kind,
      updateRisk: plan.updateRisk,
      autonomy: plan.autonomy,
      requiresHumanApproval: plan.requiresHumanApproval,
      severity: plan.severity,
      kev: plan.kev,
      devOnly: plan.devOnly,
    })),
    persisted: listed.total,
  };
  const reportPath = writeJsonReport('reports/security-intel-patch-report.json', payload);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }
  console.log('=== Candidatos de correção (plano) ===');
  console.log(`achados considerados: ${result.findings}  candidatos: ${result.candidates}`);
  console.log(`por tipo ...........: ${Object.entries(result.summary.byKind).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`por risco de upd ...: ${Object.entries(result.summary.byRisk).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`por autonomia ......: ${Object.entries(result.summary.byAutonomy).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`sem correção .......: ${result.summary.withoutPatch}  exigem autorização: ${result.summary.requiringHumanApproval}`);
  const { consolidatePlansByPackage } = require('../engine/securityIntel/patchPlanner');
  const consolidated = consolidatePlansByPackage(result.plans);
  console.log('--- por pacote (versão recomendada limpa TODOS os advisories) ---');
  for (const group of consolidated.slice(0, 15)) {
    const target = group.recommendedVersion || '(sem versão corrigida publicada)';
    console.log(`  [${group.severity}${group.kev ? '/KEV' : ''}] ${group.packageName} ${group.currentVersion} -> ${target} | ${group.advisoriesTotal} advisorie(s), ${group.advisoriesWithoutFix} sem correção | ${group.fullyClearable ? 'limpo por bump' : 'REQUER AÇÃO HUMANA'} | ${group.autonomy}`);
  }
  for (const plan of result.plans.slice(0, 25)) {
    const target = plan.targetVersion || '(sem alvo)';
    console.log(`  [${plan.severity}${plan.kev ? '/KEV' : ''}] ${plan.packageName} ${plan.currentVersion} -> ${target} (${plan.kind}, risco ${plan.updateRisk}, ${plan.autonomy})`);
  }
  if (result.plans.length > 25) console.log(`  ... e ${result.plans.length - 25} outro(s)`);
  console.log(`relatório ..........: ${path.relative(ROOT, reportPath)}`);
  return 0;
}

async function commandPatchMission(args) {
  const { createPatchMission } = require('../api/services/securityIntel/patchPlanService');
  if (!args.candidate) {
    console.error('[security-intel] informe --candidate <candidateKey> (ver `patches`)');
    return 2;
  }
  const approver = resolveCliApprover(args.authorizedBy, 'patch-mission');
  if (!approver) return 2;
  const result = await createPatchMission({
    candidateKey: args.candidate,
    tenantKey: args.tenant || 'system',
    actor: args.actor || approver,
    // Autorização = quem executa o comando (identidade verificável do SO).
    authorizedBy: approver,
  });
  const payload = {
    generatedAt: new Date().toISOString(),
    status: result.created ? 'MISSION_CREATED' : 'MISSION_LINKED',
    candidateKey: result.candidateKey,
    missionId: result.missionId,
    created: result.created,
  };
  const reportPath = writeJsonReport('reports/security-intel-patch-mission-report.json', payload);
  if (args.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else {
    console.log('=== Missão de correção (Roteador Engenheiro) ===');
    console.log(`candidato ..........: ${payload.candidateKey}`);
    console.log(`missão .............: ${payload.missionId || 'não criada'}`);
    console.log(`criada agora .......: ${payload.created}`);
    console.log(`relatório ..........: ${path.relative(ROOT, reportPath)}`);
  }
  return 0;
}

/**
 * Waivers: listar / conceder / revogar.
 *
 * Conceder é uma DECISÃO HUMANA registrada: exige aprovador identificado, motivo
 * com substância e prazo em dias. Nada aqui isenta risco por conta própria — o
 * serviço recusa isenção perpétua, prazo acima do limite da política e achado que
 * não é risco aberto (estado VEX ou já resolvido).
 */
async function commandWaivers(args) {
  const { listWaivers } = require('../api/services/securityIntel/waiverService');
  const tenantKey = args.tenant || 'system';
  const result = await listWaivers({
    tenantKey,
    state: (args.state || 'ACTIVE').toUpperCase(),
    limit: args.limit ? Number(args.limit) : 100,
  });
  const payload = {
    generatedAt: new Date().toISOString(),
    tenantKey,
    state: (args.state || 'ACTIVE').toUpperCase(),
    total: result.total,
    waivers: result.items,
  };
  const reportPath = writeJsonReport('reports/security-intel-waivers-report.json', payload);
  if (args.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else {
    console.log('=== Waivers de risco (isenção formal com expiração) ===');
    console.log(`tenant .............: ${tenantKey} | estado: ${payload.state}`);
    console.log(`waivers ............: ${result.items.length}`);
    for (const waiver of result.items) {
      console.log(`  ${waiver.waiver_key} | ${waiver.finding_key} | expira ${waiver.expires_at} | aprovou ${waiver.approved_by} | ${waiver.state}`);
    }
    if (result.items.length === 0) console.log('  (nenhum risco isentado)');
    console.log(`relatório ..........: ${path.relative(ROOT, reportPath)}`);
  }
  return 0;
}

/**
 * SOLICITA a isenção. NÃO isenta: o waiver nasce PENDING_APPROVAL.
 *
 * Quem executa é o SOLICITANTE. A concessão exige outro ator
 * (`waive-approve`), por segregação de funções — declarar o aprovador aqui é
 * recusado (`--approve` só é aceito se coincidir com quem executa, e mesmo assim
 * não vale como aprovação).
 */
async function commandWaive(args) {
  const { requestWaiver } = require('../api/services/securityIntel/waiverService');
  const { loadPolicy } = require('../api/services/securityIntel/vulnerabilityScanService');
  const tenantKey = args.tenant || 'system';
  if (!args.finding) {
    console.error('[security-intel] informe --finding <findingKey> (veja `patches`/`findings`).');
    return 2;
  }
  const requester = args.actor || currentOsUser();
  if (!requester) {
    console.error('[security-intel] não foi possível determinar o usuário do SO que solicita a isenção; a identidade não pode ser declarada.');
    return 2;
  }
  const policy = loadPolicy({ reload: true });
  let result;
  try {
    result = await requestWaiver({
      tenantKey,
      findingKey: args.finding,
      reason: args.reason,
      requestedBy: requester,
      createdBy: requester,
      expiresInDays: args.days ? Number(args.days) : undefined,
      compensatingControl: args.control || null,
      maxWaiverDays: policy.releaseGate?.maxWaiverDays ?? undefined,
    });
  } catch (error) {
    console.error(`[security-intel] solicitação recusada: ${error.code || error.message}`);
    return 3;
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    tenantKey,
    waiverKey: result.waiverKey,
    findingKey: args.finding,
    created: result.created,
    status: result.status || result.waiver.status,
    expiresAt: result.waiver.expires_at,
    requestedBy: result.waiver.requested_by,
    approvedBy: null,
  };
  const reportPath = writeJsonReport('reports/security-intel-waiver-request-report.json', payload);
  if (args.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else {
    console.log('=== Isenção SOLICITADA (ainda NÃO vigente) ===');
    console.log(`achado .............: ${payload.findingKey}`);
    console.log(`waiver .............: ${payload.waiverKey} (novo: ${payload.created})`);
    console.log(`solicitado por .....: ${payload.requestedBy}`);
    console.log(`expira em ..........: ${payload.expiresAt}`);
    console.log('aprovar com ........: node scripts/security-intel.js waive-approve --waiver <chave>  # por OUTRO usuário');
    console.log(`relatório ..........: ${path.relative(ROOT, reportPath)}`);
  }
  return 0;
}

/**
 * APROVA a isenção solicitada — aqui, e somente aqui, o achado vira MITIGATED.
 *
 * O aprovador é quem executa o comando; se for o mesmo que solicitou, o serviço
 * recusa (`waiver_self_approval_forbidden`).
 */
async function commandWaiveApprove(args) {
  const { approveWaiver } = require('../api/services/securityIntel/waiverService');
  const tenantKey = args.tenant || 'system';
  if (!args.waiver) {
    console.error('[security-intel] informe --waiver <waiverKey> (veja `waivers --state PENDING_APPROVAL`).');
    return 2;
  }
  const approver = resolveCliApprover(args.approve, 'waive-approve');
  if (!approver) return 2;
  let result;
  try {
    result = await approveWaiver({ waiverKey: args.waiver, tenantKey, approvedBy: approver });
  } catch (error) {
    console.error(`[security-intel] aprovação recusada: ${error.code || error.message}`);
    return 3;
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    tenantKey,
    waiverKey: args.waiver,
    approved: result.approved === true,
    reason: result.reason || null,
    approvedBy: result.approvedBy || null,
    scopeHash: result.scopeHash || null,
  };
  const reportPath = writeJsonReport('reports/security-intel-waiver-approval-report.json', payload);
  if (args.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else {
    console.log('=== Isenção APROVADA (risco aceito formalmente, com prazo) ===');
    console.log(`waiver .............: ${payload.waiverKey}`);
    console.log(`aprovada agora .....: ${payload.approved}${payload.reason ? ` (${payload.reason})` : ''}`);
    console.log(`aprovada por .......: ${payload.approvedBy || '—'}`);
    console.log(`relatório ..........: ${path.relative(ROOT, reportPath)}`);
  }
  return 0;
}

async function commandRevokeWaiver(args) {
  const { revokeWaiver } = require('../api/services/securityIntel/waiverService');
  const tenantKey = args.tenant || 'system';
  if (!args.waiver) {
    console.error('[security-intel] informe --waiver <waiverKey> (veja `waivers --state ALL`).');
    return 2;
  }
  let result;
  try {
    result = await revokeWaiver({
      waiverKey: args.waiver,
      tenantKey,
      actor: args.actor || currentOsUser() || 'unknown',
      reason: args.reason || null,
    });
  } catch (error) {
    console.error(`[security-intel] revogação recusada: ${error.code || error.message}`);
    return 3;
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    tenantKey,
    waiverKey: args.waiver,
    revoked: result.revoked,
    reason: result.reason || null,
  };
  const reportPath = writeJsonReport('reports/security-intel-waiver-revoke-report.json', payload);
  if (args.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else {
    console.log('=== Waiver revogado (o achado volta a contar como risco aberto) ===');
    console.log(`waiver .............: ${payload.waiverKey}`);
    console.log(`revogado agora .....: ${payload.revoked}`);
    console.log(`relatório ..........: ${path.relative(ROOT, reportPath)}`);
  }
  return 0;
}

/**
 * Dossiê de triagem: fila de decisão com motivo e comando, a partir do que já foi
 * medido. Não decide nada — só ordena o que a decisão humana precisa cobrir.
 */
async function commandTriage(args) {
  const fs = require('fs');
  const { buildTriage } = require('../api/services/securityIntel/triageService');
  const { renderTriageMarkdown } = require('../engine/securityIntel/triageDossier');

  // A coleta vive no serviço (`triageService`), a MESMA fonte usada pela API:
  // duplicar aqui criaria duas filas que discordam.
  const tenantKey = args.tenant || 'system';
  const dossier = await buildTriage({ tenantKey });

  const jsonPath = writeJsonReport('reports/security-intel-triage.json', dossier);
  const markdownPath = path.join(ROOT, 'reports/security-intel-triage.md');
  fs.writeFileSync(markdownPath, renderTriageMarkdown(dossier));

  if (args.json) process.stdout.write(`${JSON.stringify(dossier, null, 2)}\n`);
  else {
    console.log('=== Triagem de segurança (fila de decisão; nada é aplicado aqui) ===');
    console.log(`gate ...............: ${dossier.measured.gateDecision || 'não executado'}`
      + `${dossier.measured.gateBlocking === null ? '' : ` (${dossier.measured.gateBlocking} bloqueios)`}`);
    console.log(`achados abertos ....: ${dossier.measured.findingsAtRisk ?? 'não medido'}`
      + ` | bloqueantes: ${dossier.measured.blockingFindings}`);
    console.log(`base advisories ....: ${dossier.measured.advisoryBaseAgeHours ?? 'não medida'} h${dossier.measured.advisoryBaseStale ? ' (VENCIDA)' : ''}`);
    console.log(`pacotes na fila ....: ${dossier.totals.groups}`
      + ` | isolados: ${dossier.totals.autoIsolated}`
      + ` | aprovação humana: ${dossier.totals.requiringHumanApproval}`
      + ` | sem correção publicada: ${dossier.totals.withoutPublishedFix}`);
    for (const group of dossier.groups.slice(0, 10)) {
      console.log(`  [${group.bucket}] ${group.packageName}@${group.currentVersion || '?'}`
        + ` → ${group.recommendedVersion || 'sem alvo'} (${group.severity || '?'}, advisories sem correção: ${group.advisoriesWithoutFix})`);
    }
    if (dossier.groups.length > 10) console.log(`  ... e ${dossier.groups.length - 10} outros (ver relatório)`);
    console.log(`json ...............: ${path.relative(ROOT, jsonPath)}`);
    console.log(`markdown ...........: ${path.relative(ROOT, markdownPath)}`);
  }
  return 0;
}

const COMMANDS = {
  discover: commandDiscover,
  sbom: commandSbom,
  inventory: commandInventory,
  status: commandStatus,
  advisories: commandAdvisories,
  scan: commandScan,
  'vector-index': commandVectorIndex,
  patches: commandPatches,
  'patch-mission': commandPatchMission,
  waivers: commandWaivers,
  waive: commandWaive,
  'waive-approve': commandWaiveApprove,
  revoke: commandRevokeWaiver,
  triage: commandTriage,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || !COMMANDS[command]) {
    console.error('uso: node scripts/security-intel.js <discover|sbom|inventory|status|advisories|scan|vector-index|patches|patch-mission|waivers|waive|revoke|triage> [--persist] [--json] [--no-docker] [--limit N] [--rate N] [--scope direct|installed|running] [--tenant <key>] [--out <path>] [--blocking] [--include-dev] [--candidate <key>] [--finding <findingKey>] [--waiver <waiverKey>] [--days N] [--reason <texto>] [--control <texto>] [--state ACTIVE|EXPIRED|REVOKED|ALL]');
    console.error('nota: a identidade de aprovação é o usuário do SO que executa o comando (--approve/--authorized-by só são aceitos se coincidirem com ele).');
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
