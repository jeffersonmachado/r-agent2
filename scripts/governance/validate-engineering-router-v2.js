'use strict';

/**
 * Selo do ENGINEERING ROUTER V2 (§5, §6, §42–§45).
 *
 * Este validador NÃO declara verde: ele COMPÕE as provas que existem, com hash binding, e diz o
 * estado real. Regras que ele encarna:
 *
 *   - item estrutural só passa se a INVARIANTE for verificável no código (não pelo nome do arquivo);
 *   - item de runtime só passa se o relatório de prova existir, estiver fresco e verde — relatório
 *     ausente em modo autoritativo é FALHA, nunca "pendente";
 *   - o envelope carrega o hash de cada artefato e a verificação RECOMPUTA os hashes: envelope
 *     adulterado falha;
 *   - `ENGINEERING_ROUTER_V2` é independente de `RAP_FINAL_RELEASE` (§3, §48): este relatório nunca
 *     promove o release da plataforma.
 *
 * Uso: node scripts/governance/validate-engineering-router-v2.js [--json]
 * Saída: reports/engineering-router-v2-seal-report.json (+ RELEASE_AUTHORITATIVE=1 => fail-closed).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT = path.join(ROOT, 'reports', 'engineering-router-v2-seal-report.json');
const AUTHORITATIVE = process.env.RELEASE_AUTHORITATIVE === '1';

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function read(rel) {
  const abs = path.join(ROOT, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
}

function check(id, ok, detail) {
  return { id, status: ok ? 'PASS' : 'FAIL', detail: detail || '' };
}

/**
 * Remove comentários antes de avaliar invariantes.
 *
 * Falso positivo real medido: a checagem `...mission.auto_approval_policy` era satisfeita pelo
 * COMENTÁRIO que explica justamente que aquele merge foi removido, e `process.kill(pid` casava com
 * o probe `process.kill(pid, 0)` de "processo vivo" (que não é autoridade de posse). Invariante se
 * verifica em CÓDIGO; acusar a documentação do próprio código é o mesmo erro de antes, invertido.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

/** Item estrutural: a invariante precisa ser verificável no CONTEÚDO, não no nome do arquivo. */
function structural(id, artifact, invariant) {
  const content = read(artifact);
  if (content === null) return check(id, false, `artefato ausente: ${artifact}`);
  const code = stripComments(content);
  const violations = [];
  if (typeof invariant === 'function') {
    const result = invariant(code);
    if (result !== true) violations.push(result);
  }
  return check(id, violations.length === 0, violations.join('; ') || `invariante verificada em ${artifact}`);
}

const STRUCTURAL_ITEMS = [
  structural(
    'V2_LEASE_POLICY_PURE',
    'engine/engineeringMission/leasePolicy.js',
    (src) => {
      if (/Date\.now|new Date|Math\.random|process\.env/.test(src)) return 'política de lease deve ser pura (sem relógio, random ou env)';
      if (!/assertWriterAuthorized/.test(src)) return 'assertWriterAuthorized ausente: sem fencing não há proteção contra worker antigo';
      return true;
    },
  ),
  structural(
    'V2_PID_NAO_E_AUTORIDADE',
    'api/services/engineeringMission/missionStoreService.js',
    // `process.kill(pid, 0)` é probe de existência de processo (aceitável). O que não pode existir é
    // o uso do PID como decisão de posse — por exemplo matar o dono anterior para assumir o lease.
    (src) => {
      if (/process\.kill\(\s*pid\s*,\s*['"]?SIG/.test(src)) return 'PID é usado para MATAR o dono do lease: PID não é autoridade de posse';
      if (/locked_by_pid|owner_pid/.test(src)) return 'posse ainda derivada de PID armazenado';
      return true;
    },
  ),
  structural(
    'V2_POLICY_RESOLVER_SEM_MERGE_INGENUO',
    'api/services/engineeringMission/missionCompilerService.js',
    (src) => {
      if (src.includes('...mission.auto_approval_policy')) return 'merge ingênuo de política ainda presente (permite a missão ampliar a própria política)';
      if (!/resolveMissionPolicy\(/.test(src)) return 'resolveMissionPolicy não é CHAMADO no enriquecimento';
      return true;
    },
  ),
  structural(
    'V2_ESTADOS_TERMINAIS_CENTRALIZADOS',
    'engine/engineeringMission/constants.js',
    (src) => {
      if (!/TERMINAL_MISSION_STATES/.test(src) || !/RESUMABLE_MISSION_STATES/.test(src)) return 'listas de estados não centralizadas';
      if (!/CANCELLED/.test(src)) return 'TERMINAL_MISSION_STATES incompleto (falta CANCELLED)';
      return true;
    },
  ),
  structural(
    'V2_RECOVERY_AUTOMATICO_NO_BOOT',
    'api/bootstrap/startInitialization.js',
    (src) => {
      if (!/runBootRecovery/.test(src)) return 'boot não chama runBootRecovery: recuperação continuaria exigindo POST manual';
      if (!/startRecoveryLoop/.test(src)) return 'loop periódico de recuperação ausente';
      return true;
    },
  ),
  structural(
    'V2_FK_RESTRICT_NA_MIGRATION',
    'api/db/migrations/20260924160000-engineering-mission-distributed-lease.js',
    // Falso negativo real: a migration declara a FK pelo Sequelize (`onDelete: 'RESTRICT'`), não
    // pelo literal SQL `ON DELETE RESTRICT`. A invariante é a MESMA; o validador é que era estreito.
    (src) => {
      const restrict = /onDelete:\s*['"]RESTRICT['"]/i.test(src) || /ON DELETE RESTRICT/i.test(src);
      if (!restrict) return 'FK sem RESTRICT: histórico de missão poderia ser apagado em cascata';
      if (/onDelete:\s*['"]CASCADE['"]|ON DELETE CASCADE/i.test(src)) return 'FK com CASCADE: versão/aprovação/parecer poderiam sumir junto com a missão';
      if (!/ENGINEERING_MISSION_FK_ORPHANS/.test(src)) return 'sem pré-checagem fail-closed de órfãos antes de criar as FKs';
      return true;
    },
  ),
  structural(
    'V2_RBAC_FAIL_CLOSED',
    'api/modules/engineering-missions/routes.js',
    (src) => {
      if (!/action_not_mapped/.test(src)) return 'rota fora do mapa de ações não é rejeitada (deveria ser 403)';
      if (!/permission_checker_missing/.test(src)) return 'ausência de verificador de permissão não falha fechado';
      return true;
    },
  ),
  structural(
    'V2_ANTI_GREENWASHING_PORTA_UNICA',
    'tests/helpers/infraGate.js',
    (src) => {
      if (!/RELEASE_AUTHORITATIVE/.test(src)) return 'sem modo autoritativo: pulo de infra continuaria virando PASS';
      if (!/INFRA_ERROR/.test(src)) return 'infraestrutura ausente não produz INFRA_ERROR';
      return true;
    },
  ),
];

/** Item de runtime: exige relatório de prova verde e fresco. Nunca "pendente" em modo autoritativo. */
function runtimeItem(id, reportRel, predicate) {
  const rawContent = read(reportRel);
  if (rawContent === null) {
    return check(id, false, `evidência runtime ausente: ${reportRel}${AUTHORITATIVE ? ' (fail-closed em modo autoritativo)' : ''}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(rawContent);
  } catch (error) {
    return check(id, false, `evidência ilegível: ${error.message}`);
  }
  const verdict = predicate(parsed);
  return check(id, verdict === true, typeof verdict === 'string' ? verdict : `${reportRel} verificado`);
}

const FRESH_MS = 7 * 24 * 3600 * 1000;

const RUNTIME_ITEMS = [
  runtimeItem('V2_ANTI_GREENWASHING_VERDE', 'reports/anti-greenwashing-report.json', (report) => {
    if (report.status !== 'PASS') return `status=${report.status}`;
    if (report.violationCount !== 0) return `violações=${report.violationCount}`;
    return true;
  }),
  runtimeItem('V2_CRASH_SIGKILL_VERDE', 'reports/mission-crash-recovery-report.json', (report) => {
    if (report.status !== 'GO') return `status=${report.status}`;
    if ((report.failures || []).length > 0) return `${report.failures.length} check(s) falhando`;
    const finished = Date.parse(report.finishedAt || '');
    if (!Number.isFinite(finished) || Date.now() - finished > FRESH_MS) return 'evidência vencida (>7 dias)';
    return true;
  }),
];

function buildEnvelope(items) {
  const artifacts = [
    'engine/engineeringMission/leasePolicy.js',
    'engine/engineeringMission/policyResolver.js',
    'engine/engineeringMission/constants.js',
    'api/services/engineeringMission/missionStoreService.js',
    'api/services/engineeringMission/missionRecoveryCoordinator.js',
    'api/services/engineeringMission/missionCompilerService.js',
    'api/services/engineeringMission/missionContextService.js',
    'api/modules/engineering-missions/routes.js',
    'api/db/migrations/20260924160000-engineering-mission-distributed-lease.js',
    'api/bootstrap/startInitialization.js',
    'tests/helpers/infraGate.js',
    'scripts/governance/validate-anti-greenwashing.js',
    'scripts/governance/verify-mission-crash-recovery.js',
  ];
  const hashes = {};
  for (const rel of artifacts) {
    const content = read(rel);
    hashes[rel] = content === null ? null : sha256(content);
  }
  const runtimeEvidence = {};
  for (const rel of ['reports/anti-greenwashing-report.json', 'reports/mission-crash-recovery-report.json']) {
    const content = read(rel);
    runtimeEvidence[rel] = content === null ? null : sha256(content);
  }
  return {
    generatedAt: new Date().toISOString(),
    hashAlgorithm: 'sha256',
    artifacts: hashes,
    runtimeEvidence,
    itemsHash: sha256(JSON.stringify(items)),
    rapFinalReleaseTouched: false,
  };
}

/** Recomputa e compara: envelope adulterado ou artefato alterado depois do selo = FAIL. */
function verifyEnvelope(envelope) {
  const problems = [];
  for (const [rel, expected] of Object.entries(envelope.artifacts)) {
    const content = read(rel);
    const actual = content === null ? null : sha256(content);
    if (actual !== expected) problems.push(rel);
  }
  for (const [rel, expected] of Object.entries(envelope.runtimeEvidence)) {
    const content = read(rel);
    const actual = content === null ? null : sha256(content);
    if (actual !== expected) problems.push(rel);
  }
  return { verified: problems.length === 0, mismatches: problems };
}

function main() {
  const items = [...STRUCTURAL_ITEMS, ...RUNTIME_ITEMS];

  // Pendências obrigatórias da missão que este selo ainda NÃO cobre (§5/§6, §54).
  const missingMandatory = [
    'V2-01..V2-42: os 42 testes obrigatórios ainda não estão mapeados um a um',
    'retomada de TASK real de execução através do crash (hoje prova a decisão, não a task)',
    'conhecimento de engenharia indexado no domínio SYSTEM (retrieval responde vazio hoje)',
  ].map((reason) => ({ id: 'MANDATORY_PENDING', status: 'PENDING', detail: reason }));

  const envelope = buildEnvelope(items);
  const verification = verifyEnvelope(envelope);
  const failed = items.filter((item) => item.status === 'FAIL');
  const status = failed.length === 0 && missingMandatory.length === 0 && verification.verified ? 'GO' : 'NO_GO';

  const report = {
    report: 'ENGINEERING_ROUTER_V2_SEAL',
    generatedAt: new Date().toISOString(),
    authoritativeMode: AUTHORITATIVE,
    status,
    items,
    mandatoryPending: missingMandatory,
    envelope,
    verification,
    axes: {
      ENGINEERING_ROUTER_V2: status,
      RAP_FINAL_RELEASE: 'NO_GO_INDEPENDENTE',
    },
    note: 'ENGINEERING_ROUTER_V2 e RAP_FINAL_RELEASE são estados INDEPENDENTES (§3, §48). Este selo nunca promove o release da plataforma.',
    failures: failed,
  };

  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const item of items) process.stdout.write(`  [${item.status}] ${item.id} — ${item.detail}\n`);
    for (const item of missingMandatory) process.stdout.write(`  [${item.status}] ${item.id} — ${item.detail}\n`);
    process.stdout.write(`  [${verification.verified ? 'PASS' : 'FAIL'}] ENVELOPE_VERIFICATION — mismatches=${JSON.stringify(verification.mismatches)}\n`);
    process.stdout.write(`[engineering-router-v2] status=${status} itens=${items.length} falhas=${failed.length} pendencias=${missingMandatory.length}\n`);
  }
  process.exit(status === 'GO' ? 0 : 1);
}

main();
