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
const governanceBaseline = require('../../../engine/engineeringMission/governanceBaseline');
const bugFindingService = require('./bugFindingService');
const engineeringTaskService = require('../engineeringRouter/engineeringTaskService');
const missionStore = require('./missionStoreService');
const missionSourceService = require('./missionSourceService');
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

/** Hash + tamanho de um arquivo, para o manifesto de conteúdo da autoridade. */
function contentEntry(relPath) {
  try {
    const abs = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(abs)) return { path: relPath, sha256: 'ABSENT', size: null };
    const buf = fs.readFileSync(abs);
    return { path: relPath, sha256: crypto.createHash('sha256').update(buf).digest('hex'), size: buf.length };
  } catch (err) {
    logger.warn('[bugTriageService] arquivo de autoridade ilegível', { file: relPath, error: err.message });
    return { path: relPath, sha256: 'UNREADABLE', size: null };
  }
}

/**
 * DESCOBERTA DOS ARTEFATOS AUTORITATIVOS.
 *
 * O CONJUNTO NÃO É UMA LISTA MANUAL. O diretório `scripts/governance/` É a lista: todo `.js`/`.sh`
 * ali — inclusive em subdiretórios como `lib/` — participa da cadeia de decisão, então todo ele entra
 * no manifesto com o HASH DO CONTEÚDO. Consequências deliberadas:
 *
 *   - um gate NOVO passa a ser protegido automaticamente (não depende de alguém lembrar de listá-lo);
 *   - um gate REMOVIDO aparece como remoção;
 *   - `validate-x.js` que continua existindo mas teve o corpo alterado (ex.: `if (failure) return
 *     'NO_GO'` virando `'GO'`) é detectado — que é exatamente o que proteção por NOME não pega.
 *
 * Caminhada determinística (ordenada) para que o manifesto seja reprodutível.
 */
function listGovernanceGateFiles(dirRel = GOVERNANCE_GATES_DIR, acc = []) {
  const abs = path.join(REPO_ROOT, dirRel);
  let entries = [];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch (err) {
    logger.warn('[bugTriageService] diretório de gates ilegível', { dir: dirRel, error: err.message });
    return acc;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRel = `${dirRel}/${entry.name}`;
    if (entry.isDirectory()) {
      listGovernanceGateFiles(childRel, acc);
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.sh'))) {
      acc.push(childRel);
    }
  }
  return acc;
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

  // GATES AUTORITATIVOS POR CONTEÚDO. Antes, `gates` era apenas a LISTA de nomes vinda de
  // `readdirSync` — e um gate cujo corpo mudou (`if (failure) return 'GO'`) continuava passando,
  // porque o nome não mudou. Agora cada arquivo entra com o sha256 do CONTEÚDO, e o manifesto é
  // montado pela classificação (o diretório é a lista, não uma tabela mantida à mão).
  const gatePaths = listGovernanceGateFiles();
  const gateEntries = gatePaths.map((relPath) => contentEntry(relPath));
  const contentManifest = governanceBaseline.buildContentManifest([
    ...gateEntries,
    ...GOVERNANCE_RULE_FILES.map((relPath) => contentEntry(relPath)),
  ]);
  // Mapa path→hash com TODOS os autoritativos (gates + configs): é o que `diffRuleBaseline` compara.
  const contentHashes = {};
  for (const [relPath, meta] of Object.entries(contentManifest.files)) contentHashes[relPath] = meta.sha256;

  const bugLoopManifest = readJsonOrNull('config/engineering-bug-loop-required-tests.json');
  const routerV2Manifest = readJsonOrNull('config/engineering-router-v2-required-tests.json');
  const testManifest = ((bugLoopManifest && bugLoopManifest.requiredTests) || []).map((t) => t.id).sort();
  const requirements = ((routerV2Manifest && routerV2Manifest.requiredTests) || []).map((t) => t.id).sort();

  return engine.captureRuleBaseline({
    mandatoryGates: gatePaths.sort(),
    testManifest,
    requirements,
    thresholds: { bugLoopRequiredTests: testManifest.length, routerV2RequiredTests: requirements.length },
    policies: { selfModificationAutoApproval: 'FORBIDDEN_ON_HIGH_CRITICAL' },
    // `files` carrega o CONTEÚDO de cada artefato autoritativo (gates incluídos).
    files: { ...files, ...contentHashes },
    contentManifest,
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

  // MISSION SOURCE AUTHORITY — A FIX TASK PERTENCE À MISSÃO E NASCE DA FONTE DELA.
  //
  // Sem estes dois vínculos, a correção era um trabalho AVULSO: (a) `mission_id` nulo ⇒ a task não
  // herdava a fonte da missão e `patchApplyService` materializava o worktree do HEAD da `main`, onde
  // o problema pode nem existir (ou existir de outra forma); (b) sem `source_commit`, o candidate do
  // fix nascia com pai na `main` e não tinha como voltar para a fonte da missão. Era aqui que o fix
  // se perdia.
  const missionId = triaged.mission_id || null;
  let sourceCommit = null;
  let sourceRef = null;
  let sourceMissionFence = null;
  if (missionId) {
    try {
      await missionSourceService.ensureMissionSource(missionId, { actor });
      const missionSource = await missionSourceService.resolveTaskSource(missionId);
      sourceCommit = missionSource.currentCommit;
      sourceRef = missionSource.integrationBranch;
      sourceMissionFence = missionSource.fence;
    } catch (err) {
      logger.warn('[bugTriageService] falha ao resolver a fonte da missão para a fix task', {
        findingId, missionId, error: err.message,
      });
    }
  }

  const task = await engineeringTaskService.createTask({
    ...contract,
    missionId,
    sourceCommit,
    sourceRef,
    sourceMissionFence,
  }, {
    createdBy: actor,
    idempotencyKey: `bugfix:${findingId}`,
  });  const linked = await bugFindingService.linkFixTask(findingId, task.id, { actor, taskContract: contract, tenantId });

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
async function approveSelfModification(findingId, { actor, actorType = null, authenticatedActorType = null, approvalRef = null, note = null, tenantId = null, hasSelfModificationPermission = false, governanceChangeApproved = false, governanceChangeReason = null, reviewer = null, requiresIndependentReviewer = false } = {}) {
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

  // RBAC GRANULAR: ser humano não basta. A alteração nas REGRAS QUE JULGAM o sistema exige a
  // permissão ESPECÍFICA (`engineering:approve_self_modification`) — a permissão genérica de
  // engenharia que aprova uma missão comum NÃO é autoridade para reescrever o critério. Fail-closed:
  // `hasSpecificPermission` só vale `true` estrito.
  const granular = engine.assessGranularApprovalAuthority({
    actor,
    actorType: authenticated || declared,
    hasSpecificPermission: hasSelfModificationPermission === true,
  });
  if (!granular.allowed) {
    const denied = Object.assign(new Error(granular.reason), {
      code: granular.code,
      stage: granular.stage,
      requiredPermission: granular.permission,
      actorType: granular.actorType,
    });
    logger.warn('[bugTriageService] aval de self-modification recusado por RBAC granular', {
      findingId, actor, actorType, stage: granular.stage, code: denied.code,
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
    // Consentimento ESPECÍFICO de mudança de governança. Aprovar a missão não é aprovar a
    // governança: sem estes campos o runtime de fechamento não tem como distinguir "mudança
    // legítima declarada" de "afrouxamento silencioso" e recusa as duas (finding travaria para
    // sempre). Persistir no ato da aprovação é o que torna o consentimento auditável depois.
    governanceChangeApproved: governanceChangeApproved === true,
    governanceChangeReason: typeof governanceChangeReason === 'string' ? governanceChangeReason.trim() : null,
    reviewer: reviewer || null,
    requiresIndependentReviewer: requiresIndependentReviewer === true,
    // Forma de checagem do RBAC granular no momento do aval: o fechamento reavalia a autoridade a
    // partir do que foi REALMENTE verificado aqui — nunca de um `true` presumido.
    hasSpecificPermission: hasSelfModificationPermission === true,
    actorTypeVerified: authenticated || declared,
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

  // ---- AUTORIZAÇÃO HUMANA DE MUDANÇA DE GOVERNANÇA (o elo que faltava no runtime) --------------
  // DEFEITO ELIMINADO (2026-10-03): esta função chamava `verifyRuleBaseline({ baseline, current })`
  // SEM autorização. Como o motor devolve `ok:false` sempre que o baseline muda, um fix que alterava
  // legitimamente um gate — mesmo com aval humano explícito e reviewer independente — era recusado
  // e o finding NUNCA fechava. O caminho de mudança legítima existia só no motor e em teste.
  const approval = (finding.triage && finding.triage.selfModificationApproval) || null;
  const hashOf = (value) => crypto.createHash('sha256').update(JSON.stringify(value || {})).digest('hex');
  const authorization = engine.assessGovernanceChangeAuthorization({
    actor: approval && approval.actor,
    actorType: approval && (approval.actorTypeVerified || approval.actorType),
    hasSpecificPermission: Boolean(approval && approval.hasSpecificPermission),
    policy: approval && approval.policy,
    governanceChangeApproved: Boolean(approval && approval.governanceChangeApproved),
    reason: approval && approval.governanceChangeReason,
    reviewer: approval && approval.reviewer,
    requiresIndependentReviewer: Boolean(approval && approval.requiresIndependentReviewer),
    // `diffRuleBaseline` devolve alterações ANINHADAS por classe (`files.modified`), não um
    // `modified` no topo: ler o campo errado devolvia lista vazia silenciosamente e a evidência
    // da autorização perdia QUAIS arquivos de regra foram enfraquecidos.
    filesChanged: (((engine.diffRuleBaseline(baseline, current) || {}).files) || {}).modified || [],
    beforeHash: hashOf(baseline),
    afterHash: hashOf(current),
    missionId: finding.mission_id || null,
    findingId,
  });

  // CONTRATO ENTRE AS DUAS FUNÇÕES (era aqui que o elo quebrava):
  // `assessGovernanceChangeAuthorization` devolve `{ allowed, code, stage, reason, authorization }`
  // onde `authorization` é a EVIDÊNCIA (principal, permissão, motivo, reviewer, hashes antes/depois)
  // — NÃO contém `allowed`. Já `verifyRuleBaseline` exige uma CONCESSÃO com `allowed === true`
  // explícito. Entregar a evidência crua faz o motor classificar a mudança legítima como
  // `GOVERNANCE_BASELINE_VIOLATION` e o finding voltaria a nunca fechar (medido, não suposto).
  // A concessão é montada AQUI, explicitamente, e só existe se `allowed` for verdadeiro.
  const humanAuthorization = authorization.allowed
    ? { allowed: true, code: authorization.code, ...(authorization.authorization || {}) }
    : null;

  const verdict = engine.verifyRuleBaseline({
    baseline,
    current,
    humanAuthorization,
  });
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
      ruleBaselineVerification: {
        ok: verdict.ok,
        checked: verdict.checked,
        code: verdict.code,
        reason: verdict.reason,
        diff: verdict.diff,
        checkedAt,
        actor,
        // Veredito de autorização persistido: o fechamento NÃO precisa reavaliar política — e a
        // evidência (principal, permissão, motivo, reviewer, hashes antes/depois) fica auditável
        // sem reconstrução por joins.
        authorized: verdict.authorized === true,
        authorizationAllowed: authorization.allowed,
        authorizationCode: authorization.code || null,
        authorizationStage: authorization.stage || null,
        authorizationReason: authorization.reason || null,
        authorization: authorization.authorization || null,
      },
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
