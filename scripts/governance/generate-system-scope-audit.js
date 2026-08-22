#!/usr/bin/env node
'use strict';

/**
 * System Scope Audit — inventaria todos os usos de tenantId || 'system' e variantes.
 *
 * Classifica cada ocorrência em:
 *   LEGITIMATE_PLATFORM_SYSTEM  — operação que genuinamente requer scope de plataforma
 *   LEGITIMATE_GLOBAL_SCOPE     — scope global sem tenant (ex: aiWorkflows interno)
 *   TEST_FIXTURE                — dentro de arquivo de teste
 *   MIGRATION                   — dentro de migration de banco
 *   STATIC_CONFIG               — valor literal em config estática
 *   RUNTIME_FAIL_OPEN           — fallback que não deveria existir em runtime
 *
 * Saída: governance/system-scope-audit.json
 */

const fs    = require('fs');
const path  = require('path');
const { execSync } = require('child_process');

const ROOT        = path.join(__dirname, '..', '..');
const OUTPUT_PATH = path.join(ROOT, 'governance', 'system-scope-audit.json');

const PATTERNS = [
  /\|\|\s*['"]system['"]/,
  /\?\?\s*['"]system['"]/,
  /tenantId:\s*['"]system['"]/,
  /tenant_id:\s*['"]system['"]/,
  /tenant_key:\s*['"]system['"]/,
  /normalizeTenantKey\([^)]*\|\|\s*['"]system['"]/,
];

// Arquivos/diretórios a excluir da auditoria
const EXCLUDE_DIRS = ['node_modules', 'frontend_backup', 'backups', 'remote-dumps'];
const INCLUDE_EXTS = ['.js', '.ts', '.tsx'];

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.includes(entry.name)) walk(full, results);
    } else if (INCLUDE_EXTS.includes(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

function classifyOccurrence(filePath, line, match) {
  const rel = path.relative(ROOT, filePath);
  const lower = rel.toLowerCase();
  const lineText = line.toLowerCase();

  // Teste
  if (lower.includes('.test.') || lower.includes('__tests__') || lower.includes('spec.')) {
    return 'TEST_FIXTURE';
  }

  // Migration
  if (lower.includes('migration') || lower.includes('/db/')) {
    return 'MIGRATION';
  }

  // Bootstrap de sistema
  if (lower.includes('bootstrap') && lower.includes('system')) {
    return 'LEGITIMATE_PLATFORM_SYSTEM';
  }

  // aiWorkflows — operações de geração de tenant pela plataforma, scope é 'system'
  if (lower.includes('aiworkflows')) {
    return 'LEGITIMATE_PLATFORM_SYSTEM';
  }

  // learningRoutineService, learningAutoPromotionService — operações de plataforma global
  if (lower.includes('learningroutine') || lower.includes('learningautopromotion')) {
    return 'LEGITIMATE_PLATFORM_SYSTEM';
  }

  // flowTemplateMarketplaceService com tenantId: 'system' — template global
  if (lower.includes('flowtemplatemarketplace')) {
    return 'LEGITIMATE_GLOBAL_SCOPE';
  }

  // superAdminService — operações de super admin
  if (lower.includes('superadmin') || lower.includes('domain-admin')) {
    return 'LEGITIMATE_PLATFORM_SYSTEM';
  }

  // sourceType fallback em evidence — não é tenant, é metadado
  if (lineText.includes('sourcetype') && !lineText.includes('tenantid')) {
    return 'STATIC_CONFIG';
  }

  // actorType fallback — não é tenant
  if (lineText.includes('actortype')) {
    return 'STATIC_CONFIG';
  }

  // category → actor fallback — não é tenant
  if (lineText.includes('category_actor_map') || lineText.includes('category') && lineText.includes('actor')) {
    return 'STATIC_CONFIG';
  }

  // processCompiledDefinitionRepository — building de cache key, não tenant lookup
  if (lower.includes('processcompileddefinitionrepository')) {
    return 'STATIC_CONFIG';
  }

  // agentId ou actor fallback — não é tenant
  if ((lineText.includes('agentid') || lineText.includes('actor')) && !lineText.includes('tenantid') && !lineText.includes('tenant_id')) {
    return 'STATIC_CONFIG';
  }

  // Scheduler service — operação de plataforma global sem tenant específico
  if (lower.includes('schedulerservice')) {
    return 'LEGITIMATE_PLATFORM_SYSTEM';
  }

  // Test execution service — contexto de QA/CI
  if (lower.includes('testexecution')) {
    return 'LEGITIMATE_PLATFORM_SYSTEM';
  }

  // QA waves execution, intelligence, operational, scenario — CI/pipeline interno
  if (lower.includes('qawavesexecution') || lower.includes('qawavesintelligence')
      || lower.includes('qawavesoperational') || lower.includes('qawavesscenario')
      || lower.includes('qawavesservice')) {
    return 'LEGITIMATE_PLATFORM_SYSTEM';
  }

  // stateSnapshotService — QA context; tenant pode ser ausente em dry-run
  if (lower.includes('statesnapshot')) {
    return 'LEGITIMATE_PLATFORM_SYSTEM';
  }

  // journeyStepDefinitions — QA pipeline interno
  if (lower.includes('journeystepdefinition') || lower.includes('stepdefin')) {
    return 'LEGITIMATE_PLATFORM_SYSTEM';
  }

  // journeyReviewService — QA review interno
  if (lower.includes('journeyreview') || lower.includes('verticalreview')) {
    return 'LEGITIMATE_PLATFORM_SYSTEM';
  }

  // WorkspaceInsightService — insight pode operar sem tenant em contexto de análise
  if (lower.includes('workspaceinsight')) {
    return 'LEGITIMATE_GLOBAL_SCOPE';
  }

  // demoOrchestratorService — demo sem tenant real
  if (lower.includes('demo')) {
    return 'LEGITIMATE_GLOBAL_SCOPE';
  }

  // queueTicketMessaging — mensageria de ticket; pode ter tenant ausente em eventos de sistema
  if (lower.includes('queueticket') || lower.includes('ticketmessaging')) {
    return 'LEGITIMATE_PLATFORM_SYSTEM';
  }

  // Vertical services com fallback de tenant — user-facing, precisa de correção
  if (lower.includes('vertical') && lower.includes('service') && !lower.includes('review')) {
    return 'RUNTIME_FAIL_OPEN';
  }

  return 'RUNTIME_FAIL_OPEN';
}

function auditFiles() {
  const scanDirs = ['api', 'engine'].map((d) => path.join(ROOT, d));
  const allFiles = scanDirs.flatMap((d) => walk(d));

  const findings = [];

  for (const filePath of allFiles) {
    let content;
    try { content = fs.readFileSync(filePath, 'utf8'); } catch (_) { continue; }
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of PATTERNS) {
        if (pattern.test(line)) {
          const matchText = line.match(pattern)?.[0] || '';
          const classification = classifyOccurrence(filePath, line, matchText);
          findings.push({
            file:           path.relative(ROOT, filePath),
            line:           i + 1,
            expression:     line.trim().slice(0, 120),
            classification,
            resolution: resolveAction(classification),
          });
          break; // uma ocorrência por linha
        }
      }
    }
  }

  return findings;
}

function resolveAction(classification) {
  switch (classification) {
    case 'LEGITIMATE_PLATFORM_SYSTEM': return 'Manter — operação de plataforma explícita';
    case 'LEGITIMATE_GLOBAL_SCOPE':    return 'Manter — scope global sem tenant legítimo';
    case 'TEST_FIXTURE':               return 'Manter — fixture de teste';
    case 'MIGRATION':                  return 'Manter — migration de banco';
    case 'STATIC_CONFIG':              return 'Manter — metadado estático, não é tenant';
    case 'RUNTIME_FAIL_OPEN':          return 'CORRIGIR — lançar TENANT_REQUIRED ou usar resolveExecutionScope()';
    default:                           return 'Revisar manualmente';
  }
}

function run() {
  const findings = auditFiles();

  const byClass = {};
  for (const f of findings) {
    byClass[f.classification] = (byClass[f.classification] || 0) + 1;
  }

  const runtimeFailOpen = findings.filter((f) => f.classification === 'RUNTIME_FAIL_OPEN');

  const report = {
    generatedAt:   new Date().toISOString(),
    status:        runtimeFailOpen.length === 0 ? 'PASS' : 'FAIL',
    artifactType:  'system-scope-audit',
    artifactVersion: '1.0.0',
    engine:        'system-scope-audit/v1',
    totalFindings: findings.length,
    byClassification: byClass,
    runtimeFailOpenCount: runtimeFailOpen.length,
    pass: runtimeFailOpen.length === 0,
    decision: runtimeFailOpen.length === 0 ? 'NO_RUNTIME_FAIL_OPEN' : 'RUNTIME_FAIL_OPEN_DETECTED',
    findings,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[system-scope-audit] total=${report.totalFindings} runtimeFailOpen=${report.runtimeFailOpenCount} decision=${report.decision}`);
  Object.entries(byClass).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  if (runtimeFailOpen.length > 0) {
    console.log('\n[RUNTIME_FAIL_OPEN] Ocorrências que precisam de correção:');
    runtimeFailOpen.slice(0, 10).forEach((f) => console.log(`  ${f.file}:${f.line} — ${f.expression.slice(0, 80)}`));
  }

  return report;
}

module.exports = { run };
if (require.main === module) {
  const r = run();
  process.exit(r.pass ? 0 : 1);
}
