'use strict';

/**
 * api/services/engineeringMission/bugTriageService.js
 *
 * TRIAGEM → WORK ITEM. Converte um finding CONFIRMADO em trabalho real no Engineer Router
 * EXISTENTE (`engineeringTaskService.createTask` + `runTask`), com roteamento declarado por
 * categoria/severidade — nunca escolhendo modelo ou provider (isso é do Router: capability fit +
 * saúde + custo + risco com credencial real).
 *
 * Duas regras de política são aplicadas aqui, e são o que impede o ciclo de virar auto-serviço:
 *
 *   1. INFRA/PROVIDER/CONFIGURATION não geram patch de aplicação (o problema não é código);
 *   2. SELF_MODIFICATION exige aprovação HUMANA antes da execução autônoma — a task é criada (o
 *      trabalho existe), mas NÃO é executada pelo loop enquanto `auto_approval_forbidden` estiver
 *      ativo para HIGH/CRITICAL (BUG-19/20).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const engine = require('../../../engine/engineeringMission/bugFinding');
const bugFindingService = require('./bugFindingService');
const engineeringTaskService = require('../engineeringRouter/engineeringTaskService');
const missionStore = require('./missionStoreService');
const logger = require('../../utils/logger');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

/**
 * ARQUIVOS QUE SÃO AS REGRAS DE JULGAMENTO. O baseline guarda o HASH do conteúdo de cada um: o
 * enfraquecimento mais discreto não é remover o gate da lista (isso a lista pega) — é editar o
 * limiar DENTRO do arquivo que continua existindo. Sem o hash, a alteração passaria em silêncio.
 */
const GOVERNANCE_RULE_FILES = Object.freeze([
  'config/engineering-bug-loop-required-tests.json',
  'config/engineering-router-v2-required-tests.json',
  'config/journey-criticality.json',
  'config/timeout-policy.json',
  'jest.config.cjs',
]);
const GOVERNANCE_GATES_DIR = 'scripts/governance';

function sha256OrAbsent(relPath) {
  try {
    const abs = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(abs)) return 'ABSENT';
    return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  } catch (err) {
    logger.warn('[bugTriageService] regra de governança ilegível', { file: relPath, error: err.message });
    return 'UNREADABLE';
  }
}

function readJsonOrNull(relPath) {
  try {
    const abs = path.join(REPO_ROOT, relPath);
    return fs.existsSync(abs) ? JSON.parse(fs.readFileSync(abs, 'utf8')) : null;
  } catch (err) {
    logger.warn('[bugTriageService] manifesto de regras ilegível', { file: relPath, error: err.message });
    return null;
  }
}

/**
 * SNAPSHOT DAS REGRAS DE JULGAMENTO, derivado do DISCO (nunca de uma cópia em código). É o que se
 * captura antes de um fix de self-modification e o que se compara depois: se o fix afrouxou o
 * próprio critério, a diferença aparece aqui de forma auditável.
 */
function captureGovernanceRuleSnapshot() {
  const files = {};
  for (const relPath of GOVERNANCE_RULE_FILES) files[relPath] = sha256OrAbsent(relPath);

  let gates = [];
  try {
    gates = fs.readdirSync(path.join(REPO_ROOT, GOVERNANCE_GATES_DIR))
      .filter((file) => file.endsWith('.js'))
      .sort();
  } catch (err) {
    logger.warn('[bugTriageService] diretório de gates ilegível', { error: err.message });
  }

  const bugLoopManifest = readJsonOrNull('config/engineering-bug-loop-required-tests.json');
  const routerV2Manifest = readJsonOrNull('config/engineering-router-v2-required-tests.json');
  const testManifest = ((bugLoopManifest && bugLoopManifest.requiredTests) || []).map((t) => t.id).sort();
  const requirements = ((routerV2Manifest && routerV2Manifest.requiredTests) || []).map((t) => t.id).sort();

  return engine.captureRuleBaseline({
    mandatoryGates: gates,
    testManifest,
    requirements,
    thresholds: { bugLoopRequiredTests: testManifest.length, routerV2RequiredTests: requirements.length },
    policies: { selfModificationAutoApproval: 'FORBIDDEN_ON_HIGH_CRITICAL' },
    files,
  });
}

/** Resolve o escopo de caminhos permitidos: arquivos do finding OU o escopo da MissionSpec. */
async function resolveAllowedPaths(finding, explicitPaths = null) {
  if (Array.isArray(explicitPaths) && explicitPaths.length > 0) return explicitPaths;
  if (Array.isArray(finding.affected_files) && finding.affected_files.length > 0) return finding.affected_files;
  if (!finding.mission_id) return [];
  try {
    const version = await missionStore.getCurrentVersion(finding.mission_id);
    const spec = version?.spec || {};
    return Array.isArray(spec.allowedPaths) ? spec.allowedPaths : [];
  } catch (err) {
    logger.warn('[bugTriageService] falha ao resolver allowedPaths da missão', { findingId: finding.id, error: err.message });
    return [];
  }
}

/**
 * Triagem: classifica, avalia self-modification, persiste o parecer e — se o finding está CONFIRMED
 * — cria a EngineeringTask de correção (idempotente por `bugfix:<findingId>`).
 */
async function triage(findingId, {
  actor = null, tenantId = null, allowedPaths = null, forbiddenPaths = [], explicitPolicyAuthorization = false,
  policy = null, maxIterations = undefined, createTask = true,
} = {}) {
  const finding = await bugFindingService.getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });

  const paths = await resolveAllowedPaths(finding, allowedPaths);
  const severity = finding.severity;
  const category = finding.category;

  const capabilities = engine.deriveCapabilities({ category, severity, paths, subsystems: finding.affected_subsystems });
  const selfModification = engine.assessSelfModification({
    paths,
    subsystems: finding.affected_subsystems,
    category,
    severity,
    policy,
  });
  const requiresApplicationFix = engine.requiresApplicationFix(category);

  // ENGINEERING MEMORY: consulta o histórico pela MESMA identidade antes de planejar a correção —
  // root cause anterior, task anterior e as regressões que já cobriram esta falha. Evita resolver do
  // zero e adiciona as regressões anteriores ao contrato da task nova (a correção de hoje não pode
  // quebrar o que já foi corrigido antes). A memória NÃO confirma nada: confirmação continua
  // exigindo base objetiva da ocorrência atual.
  const memory = await bugFindingService.getFindingMemory(finding.fingerprint, { excludeId: finding.id }).catch(() => ({ known: false, priorFindings: [], priorRegressionCommands: [] }));

  const assessment = {
    category,
    severity,
    capabilities,
    requiresApplicationFix,
    requiresIndependentReviewer: capabilities.requiresIndependentReviewer,
    requiresSecurityReviewer: capabilities.requiresSecurityReviewer,
    selfModification,
    allowedPaths: paths,
    priorKnowledge: memory.known
      ? {
        occurrences: memory.occurrences,
        lastKnownRootCause: memory.lastKnownRootCause,
        lastConfirmationBasis: memory.lastConfirmationBasis,
        lastFixTaskId: memory.lastFixTaskId,
        priorRegressionCommands: memory.priorRegressionCommands,
        priorFindings: memory.priorFindings,
      }
      : null,
    triagedAt: new Date().toISOString(),
    triagedBy: actor,
  };

  await bugFindingService.recordEvent(findingId, 'TRIAGED', assessment, { actor });

  const Model = require('../../db/models/EngineeringBugFinding')();
  const triagePatch = {
    triage: { ...(finding.triage || {}), ...assessment },
    self_modification: selfModification.selfModification,
    human_approval_required: selfModification.humanApprovalRequired,
    auto_approval_forbidden: selfModification.autoApprovalForbidden,
  };
  if (selfModification.selfModification) {
    // BASELINE das regras ANTES de qualquer correção de self-engineering: se o fix alterar o próprio
    // critério que o reprova, a alteração precisa ser explícita e comparável. O snapshot vem do
    // DISCO (gates existentes, IDs obrigatórios, hashes dos arquivos de regra) e é verificado no
    // fechamento — capturar e nunca comparar seria teatro.
    triagePatch.triage.ruleBaseline = {
      ...captureGovernanceRuleSnapshot(),
      capturedAt: new Date().toISOString(),
      capturedBy: actor || null,
      autoApprovalForbidden: selfModification.autoApprovalForbidden,
    };
  }
  await Model.update(triagePatch, { where: { id: findingId } });
  const triaged = await bugFindingService.getFinding(findingId);

  if (!requiresApplicationFix) {
    return {
      finding: triaged,
      assessment,
      fixTask: null,
      requiresNonApplicationAction: true,
      note: `${category} não é corrigível por patch de aplicação — a correção é de infraestrutura/provider/configuração`,
    };
  }

  const gate = engine.canGenerateFixTask(triaged);
  if (!gate.allowed || !createTask) {
    return { finding: triaged, assessment, fixTask: null, taskGenerationBlocked: !gate.allowed ? gate : null };
  }

  const contract = engine.buildFixTaskContract({
    // As regressões ANTERIORES desta mesma falha entram no contrato: a correção de hoje não pode
    // quebrar o que já foi corrigido antes (Engineering Memory aplicada, não apenas consultada).
    finding: memory.known && memory.priorRegressionCommands.length > 0
      ? { ...triaged, regressionCommands: memory.priorRegressionCommands }
      : triaged,
    allowedPaths: paths,
    forbiddenPaths,
    explicitPolicyAuthorization,
    maxIterations,
  });

  // A causa raiz de uma ocorrência ANTERIOR entra como PISTA explicitamente marcada — nunca como
  // causa raiz do bug atual, que só pode ser afirmada com evidência desta ocorrência.
  if (memory.known && memory.lastKnownRootCause && !triaged.root_cause) {
    contract.objective = `${contract.objective}\nPista (ocorrência anterior desta mesma falha, a CONFIRMAR): ${memory.lastKnownRootCause}`;
  }

  const task = await engineeringTaskService.createTask(contract, {
    createdBy: actor,
    idempotencyKey: `bugfix:${findingId}`,
  });
  const linked = await bugFindingService.linkFixTask(findingId, task.id, { actor, taskContract: contract, tenantId });

  logger.info('[bugTriageService] task de correção criada', {
    findingId, taskId: task.id, category, severity,
    selfModification: selfModification.selfModification, requiresHumanApproval: selfModification.humanApprovalRequired,
  });

  return {
    finding: linked,
    assessment,
    fixTask: task,
    taskContract: contract,
    requiresHumanApproval: selfModification.humanApprovalRequired,
    autoApprovalForbidden: selfModification.autoApprovalForbidden,
  };
}

/**
 * Um fix de self-modification pode ser EXECUTADO autonomamente? Fail-closed: enquanto o finding
 * exigir aprovação humana e ela não tiver sido registrada, não.
 */
async function canRunFixAutonomously(findingId) {
  const finding = await bugFindingService.getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });
  if (!finding.self_modification) return { allowed: true };
  if (finding.auto_approval_forbidden && finding.human_approval_required) {
    return {
      allowed: false,
      code: engine.BUG_FAILURE_CODES.SELF_MODIFICATION_HUMAN_APPROVAL_REQUIRED,
      reason: 'finding de self-modification: aprovação humana obrigatória antes da execução autônoma',
      minimumHumanAction: 'aprovar explicitamente a correção (POST /engineering/findings/:id/approve-self-modification)',
    };
  }
  return { allowed: true };
}

/**
 * APROVAÇÃO HUMANA explícita de um fix de self-modification. É a ação mínima que a policy exige —
 * nunca substituível por um parecer de modelo.
 */
async function approveSelfModification(findingId, { actor, actorType = null, authenticatedActorType = null, approvalRef = null, note = null, tenantId = null } = {}) {
  // AUTORIDADE DO AVAL: HUMANO, e só humano. Um `actor` string qualquer não basta — a aprovação
  // que libera alteração nas próprias regras de julgamento não pode vir de service account, de
  // worker automático nem de um modelo. A decisão é do motor puro (autoridade única).
  //
  // O tipo AUTENTICADO (do agente da requisição) prevalece sobre o declarado no corpo: declarar
  // "HUMAN" não transforma uma identidade automática em humana. Divergência entre os dois é
  // recusada explicitamente, nunca resolvida em favor do texto enviado.
  const declared = String(actorType || '').trim();
  const authenticated = String(authenticatedActorType || '').trim();
  if (authenticated !== '' && declared !== '' && authenticated.toUpperCase() !== declared.toUpperCase()) {
    const denied = Object.assign(
      new Error(`tipo de ator divergente: autenticado="${authenticated}" vs declarado="${declared}" — a identidade autenticada prevalece`),
      { code: engine.BUG_FAILURE_CODES.SELF_MODIFICATION_APPROVAL_ACTOR_NOT_HUMAN, actorType: authenticated, policy: 'HUMAN_ONLY' },
    );
    logger.warn('[bugTriageService] aval de self-modification recusado por divergência de identidade', { findingId, actor, authenticated, declared });
    throw denied;
  }
  const authority = engine.assessApprovalAuthority({ actor, actorType: authenticated || declared });
  if (!authority.allowed) {
    const denied = Object.assign(new Error(authority.reason), {
      code: authority.code,
      actorType: authority.actorType,
      policy: authority.policy,
    });
    logger.warn('[bugTriageService] aval de self-modification recusado', {
      findingId, actor, actorType, code: denied.code,
    });
    throw denied;
  }

  const finding = await bugFindingService.getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });
  if (!finding.self_modification) {
    return { finding, approved: false, reason: 'finding não é de self-modification — nenhuma aprovação adicional é exigida' };
  }
  const Model = require('../../db/models/EngineeringBugFinding')();
  const approval = {
    actor,
    actorType: authority.actorType,
    policy: authority.policy,
    approvalRef,
    note,
    tenantId,
    at: new Date().toISOString(),
  };
  await Model.update({
    human_approval_required: false,
    triage: {
      ...(finding.triage || {}),
      selfModificationApproval: approval,
    },
  }, { where: { id: findingId } });
  await bugFindingService.recordEvent(findingId, 'UNBLOCKED', { ...approval, kind: 'SELF_MODIFICATION_APPROVAL' }, { actor });
  const refreshed = await bugFindingService.getFinding(findingId);
  return { finding: refreshed, approved: true, authority };
}

/**
 * O fix de self-modification afrouxou o próprio critério? Compara o baseline capturado ANTES da
 * correção com o estado atual do disco e PERSISTE o veredito no finding — o fechamento consulta
 * esse veredito, e um finding sem verificação registrada não fecha (fail-closed).
 */
async function verifySelfModificationBaseline(findingId, { actor = null, currentRules = null } = {}) {
  const finding = await bugFindingService.getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });

  const baseline = (finding.triage && finding.triage.ruleBaseline) || null;
  const current = currentRules || captureGovernanceRuleSnapshot();
  const verdict = engine.verifyRuleBaseline({ baseline, current });
  const checkedAt = new Date().toISOString();

  await bugFindingService.recordEvent(findingId, 'COMMENT', {
    kind: 'GOVERNANCE_BASELINE_CHECK',
    ok: verdict.ok,
    checked: verdict.checked,
    code: verdict.code,
    reason: verdict.reason,
    diff: verdict.diff,
    checkedAt,
    actor,
  }, { actor });

  const Model = require('../../db/models/EngineeringBugFinding')();
  await Model.update({
    triage: {
      ...(finding.triage || {}),
      ruleBaselineVerification: { ok: verdict.ok, checked: verdict.checked, code: verdict.code, reason: verdict.reason, diff: verdict.diff, checkedAt, actor },
    },
  }, { where: { id: findingId } });

  if (!verdict.ok) {
    logger.warn('[bugTriageService] baseline de governança violado pelo próprio fix', {
      findingId, code: verdict.code, checked: verdict.checked,
    });
  }
  return verdict;
}

module.exports = {
  resolveAllowedPaths,
  triage,
  canRunFixAutonomously,
  approveSelfModification,
  verifySelfModificationBaseline,
  captureGovernanceRuleSnapshot,
  GOVERNANCE_RULE_FILES,
};
