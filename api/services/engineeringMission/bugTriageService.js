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

const engine = require('../../../engine/engineeringMission/bugFinding');
const bugFindingService = require('./bugFindingService');
const engineeringTaskService = require('../engineeringRouter/engineeringTaskService');
const missionStore = require('./missionStoreService');
const logger = require('../../utils/logger');

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
    // critério que o reprova, a alteração precisa ser explícita e comparável.
    triagePatch.triage.ruleBaseline = engine.captureRuleBaseline({
      mandatoryGates: engine.SELF_MODIFICATION_PATH_PREFIXES,
      policies: { autoApprovalForbidden: selfModification.autoApprovalForbidden },
    });
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
async function approveSelfModification(findingId, { actor, approvalRef = null, note = null, tenantId = null } = {}) {
  if (!actor) throw Object.assign(new Error('aprovação exige `actor` identificado'), { code: 'ACTOR_REQUIRED' });
  const finding = await bugFindingService.getFinding(findingId);
  if (!finding) throw Object.assign(new Error(`finding ${findingId} não encontrado`), { code: 'not_found' });
  if (!finding.self_modification) {
    return { finding, approved: false, reason: 'finding não é de self-modification — nenhuma aprovação adicional é exigida' };
  }
  const Model = require('../../db/models/EngineeringBugFinding')();
  await Model.update({
    human_approval_required: false,
    triage: {
      ...(finding.triage || {}),
      selfModificationApproval: { actor, approvalRef, note, at: new Date().toISOString() },
    },
  }, { where: { id: findingId } });
  await bugFindingService.recordEvent(findingId, 'UNBLOCKED', { actor, approvalRef, note, kind: 'SELF_MODIFICATION_APPROVAL' }, { actor });
  const refreshed = await bugFindingService.getFinding(findingId);
  void tenantId;
  return { finding: refreshed, approved: true };
}

module.exports = {
  resolveAllowedPaths,
  triage,
  canRunFixAutonomously,
  approveSelfModification,
};
