'use strict';

/**
 * engine/engineeringMission/bugFinding/selfModification.js
 *
 * PROTEÇÃO DE SELF-MODIFICATION. Um bug que afeta o Engineer Router, o selo V2, aprovação, policy,
 * lease/fencing, governança, anti-greenwashing ou o pipeline de release é um bug no sistema que
 * ESTÁ JULGANDO o sistema. Corrigi-lo autonomamente com autoaprovação permitiria que o próprio
 * corrigido enfraquecesse o critério que o reprovava.
 *
 * Regra: detectado ⇒ `selfModification=true`, `humanApprovalRequired=true` e, por padrão,
 * `autoApprovalForbidden=true` (BUG-19, BUG-20). O aval só pode vir de uma política explícita que
 * AUTORIZE autoaprovação para self-modification de severidade não crítica — nunca por omissão.
 *
 * Módulo PURO.
 */

const {
  SELF_MODIFICATION_PATH_PREFIXES,
  SELF_MODIFICATION_SUBSYSTEMS,
  SELF_MODIFICATION_CATEGORIES,
} = require('./constants');
const { SEVERITY_RANK } = require('./constants');

/** Normaliza um caminho para comparação por prefixo (barras, sem `./`). */
function normalizePath(p) {
  return String(p || '')
    .replace(/\\+/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .trim();
}

/** Caminhos que caracterizam self-modification, com o prefixo que casou. */
function matchPaths(paths = []) {
  const list = Array.isArray(paths) ? paths : [];
  const matches = [];
  for (const raw of list) {
    const path = normalizePath(raw);
    if (path === '') continue;
    const prefix = SELF_MODIFICATION_PATH_PREFIXES.find((candidate) => path === candidate || path.startsWith(candidate));
    if (prefix) matches.push({ path, prefix });
  }
  return matches;
}

/**
 * O QUE CONTA COMO SELF-MODIFICATION (e o que NÃO conta).
 *
 * O risco que esta proteção existe para cobrir é UM só: o fix alterar as regras que julgam o
 * sistema. Três evidências o caracterizam, e a precisão importa nos dois sentidos — um detector
 * excessivo bloqueia correções legítimas e um detector frouxo deixa o sistema se auto-afrouxar:
 *
 *   1. CAMINHOS tocados (evidência mais forte): o patch mexe em `governance/`, `scripts/governance/`,
 *      `pipeline/`, router/missão, lease/fencing, policy, release, anti-greenwashing.
 *   2. SUBSISTEMA que É a própria maquinaria de julgamento (POLICY/GOVERNANCE/ANTI_GREENWASHING/
 *      APPROVAL/LEASE_FENCING/RELEASE_PIPELINE/QA_GATE/ENGINEER_ROUTER/ENGINEERING_MISSION) —
 *      porém apenas quando NÃO há caminhos declarados: com caminhos explícitos, quem decide é o
 *      raio de impacto REAL do fix, não onde o sintoma apareceu.
 *   3. CATEGORIA GOVERNANCE: um bug de governança é, por definição, nas regras de julgamento.
 *
 * DELIBERADAMENTE FORA: SECURITY e CONCURRENCY não caracterizam self-modification por si sós — a
 * missão exige revisor de segurança dedicado e revisor independente para esses casos, o que é um
 * controle adequado e NÃO deve impedir a correção autônoma. Já um finding cujo fix toca lease/
 * fencing (caminho ou subsistema) É self-modification, porque ali vive a posse e o fence.
 */
function isSensitiveSubsystem(subsystem) {
  return SELF_MODIFICATION_SUBSYSTEMS.includes(subsystem);
}

/**
 * Avalia self-modification.
 *
 * @param {object} params
 * @param {string[]} [params.paths]      caminhos que o FIX vai tocar (raio de impacto real)
 * @param {string[]} [params.subsystems] subsistemas afetados declarados no finding
 * @param {string}   [params.category]   categoria do finding
 * @param {string}   [params.severity]   severidade derivada
 * @param {object}   [params.policy]     política efetiva (autoridade única, nunca default amplo)
 */
function assessSelfModification({ paths = [], subsystems = [], category = null, severity = null, policy = null } = {}) {
  const declaredPaths = (Array.isArray(paths) ? paths : []).map(normalizePath).filter((p) => p !== '');
  const pathMatches = matchPaths(declaredPaths);
  const subsystemList = (Array.isArray(subsystems) ? subsystems : []).map((s) => String(s || '').toUpperCase());
  const subsystemMatches = subsystemList.filter(isSensitiveSubsystem);
  const categoryMatch = SELF_MODIFICATION_CATEGORIES.includes(String(category || '').toUpperCase());

  const selfModification = pathMatches.length > 0
    || categoryMatch
    || (declaredPaths.length === 0 && subsystemMatches.length > 0);

  // AUTOAPROVAÇÃO: proibida por padrão. A política pode autorizar apenas quando
  // `allowSelfModificationAutoApproval === true` E a severidade NÃO for HIGH/CRITICAL.
  const criticalSeverity = SEVERITY_RANK[severity] >= SEVERITY_RANK.HIGH;
  const policyAllows = policy && policy.allowSelfModificationAutoApproval === true;
  const autoApprovalForbidden = !(policyAllows && !criticalSeverity);

  return {
    selfModification,
    humanApprovalRequired: selfModification && autoApprovalForbidden,
    autoApprovalForbidden: selfModification ? autoApprovalForbidden : false,
    criticalSeverity,
    matched: {
      paths: pathMatches,
      subsystems: declaredPaths.length === 0 ? subsystemMatches : [],
      subsystemsWithoutImpact: declaredPaths.length > 0 ? subsystemMatches : [],
      category: categoryMatch ? String(category).toUpperCase() : null,
    },
    rationale: selfModification
      ? 'finding afeta as próprias regras de julgamento (router/governança/lease/policy/release) — autoaprovação não é autoridade legítima'
      : 'finding não toca as regras que julgam o sistema',
  };
}

/**
 * POLÍTICA DE AVAL DE SELF-MODIFICATION: HUMAN-ONLY.
 *
 * Um parecer de modelo, um worker automático ou uma conta de serviço NÃO são autoridade para
 * liberar uma alteração nas próprias regras que julgam o sistema — se fossem, a máquina poderia
 * afrouxar o critério que a reprovou, que é exatamente o que esta proteção existe para impedir.
 * A política é DECLARADA aqui (não inferida do ator) e o chamador não pode substituí-la por
 * omissão: `assessApprovalAuthority` é fail-closed.
 */
const HUMAN_ONLY_APPROVAL_POLICY = Object.freeze({
  allowedActorTypes: Object.freeze(['HUMAN']),
  forbiddenActorTypes: Object.freeze(['SERVICE', 'SERVICE_ACCOUNT', 'SYSTEM', 'AUTOMATION', 'AGENT', 'ROUTER', 'WORKER', 'CRON', 'MODEL', 'LLM', 'BOT']),
});

/** Prefixos de identificador que denunciam automação mesmo quando o ator se declara humano. */
const AUTOMATION_IDENTITY_PATTERN = /^(?:SYSTEM|SERVICE|SVC|AUTOMATION|AUTO|ROBOT|AGENT|ROUTER|WORKER|CRON|SCHEDULER|MODEL|LLM|BOT|CI|JEST|TEST)[:_-]/i;

/**
 * Quem pode aprovar a execução de um fix de self-modification? Fail-closed em três frentes:
 * tipo ausente, tipo não-humano e identidade que se anuncia como automação (defesa em
 * profundidade contra um ator que se declare HUMANO mas se apresente como `SYSTEM:*`).
 *
 * Módulo PURO: a decisão é determinística e auditável, nunca dependente de I/O.
 */
function assessApprovalAuthority({ actor = null, actorType = null, policy = null } = {}) {
  const effective = policy || HUMAN_ONLY_APPROVAL_POLICY;
  const allowed = (effective.allowedActorTypes || ['HUMAN']).map((t) => String(t).toUpperCase());
  const type = String(actorType || '').trim().toUpperCase();
  const identity = String(actor || '').trim();

  if (identity === '') {
    return { allowed: false, actorType: type || null, policy: 'HUMAN_ONLY', code: 'ACTOR_REQUIRED', reason: 'aprovação exige `actor` identificado — aval anônimo não é aval' };
  }
  if (type === '') {
    return {
      allowed: false,
      actorType: null,
      policy: 'HUMAN_ONLY',
      code: 'SELF_MODIFICATION_APPROVAL_ACTOR_NOT_HUMAN',
      reason: 'tipo de ator AUSENTE: aprovação de self-modification exige um HUMANO identificado (`actorType`) — ausência de dado não vira permissão',
    };
  }
  if (!allowed.includes(type)) {
    return {
      allowed: false,
      actorType: type,
      policy: 'HUMAN_ONLY',
      code: 'SELF_MODIFICATION_APPROVAL_ACTOR_NOT_HUMAN',
      reason: `tipo de ator "${type}" não é autoridade legítima para liberar alteração nas regras de julgamento (permitido: ${allowed.join(', ')})`,
    };
  }
  if (AUTOMATION_IDENTITY_PATTERN.test(identity)) {
    return {
      allowed: false,
      actorType: type,
      policy: 'HUMAN_ONLY',
      code: 'SELF_MODIFICATION_APPROVAL_ACTOR_NOT_HUMAN',
      reason: `identidade "${identity}" se anuncia como automação — um ator automático não pode se declarar humano para liberar o próprio critério`,
    };
  }
  return { allowed: true, actorType: type, policy: 'HUMAN_ONLY', code: null, reason: `aval humano explícito de ${identity}` };
}

/**
 * PERMISSÃO ESPECÍFICA DE SELF-MODIFICATION (RBAC GRANULAR).
 *
 * GAP QUE ISTO FECHA (confirmado no código em 2026-10-02): a aprovação de self-modification era
 * gated por `requirePermission(req, 'engineering', 'approve')` — a MESMA permissão genérica usada
 * para aprovar uma missão comum. Quem podia "aprovar engenharia" podia, sem nenhuma distinção,
 * liberar uma alteração nas REGRAS QUE JULGAM o sistema. Privilégio genérico não é autoridade para
 * reescrever o critério.
 *
 * A permissão é um par (resource, action) compatível com o RBAC existente:
 *   resource: 'engineering'
 *   action:   'approve_self_modification'     (equivalente a `engineering:self-modification`)
 *
 * DUAS CONDIÇÕES, AMBAS OBRIGATÓRIAS:
 *   1. principal HUMANO autenticado (regra já existente, fail-closed);
 *   2. a permissão ESPECÍFICA concedida.
 *
 * Os três casos que a política precisa distinguir, e que este módulo distingue:
 *   - service account com permissão de engenharia, sem principal humano   ⇒ DENIED
 *   - humano com permissão genérica de engenharia, sem a específica       ⇒ DENIED
 *   - humano COM a permissão específica                                   ⇒ ALLOWED
 *
 * FAIL-CLOSED: permissão ausente/indefinida NÃO é permissão concedida. Se o chamador não souber
 * dizer se a permissão existe, a resposta é NÃO.
 */
const SELF_MODIFICATION_APPROVAL_PERMISSION = Object.freeze({
  resource: 'engineering',
  action: 'approve_self_modification',
  label: 'engineering:self-modification',
});

function assessGranularApprovalAuthority({
  actor = null,
  actorType = null,
  hasSpecificPermission = false,
  policy = null,
  permission = null,
} = {}) {
  const required = permission || SELF_MODIFICATION_APPROVAL_PERMISSION;

  // 1. Autoridade humana (reaproveita a política única — nunca reimplementada aqui).
  const human = assessApprovalAuthority({ actor, actorType, policy });
  if (!human.allowed) {
    return {
      allowed: false,
      code: human.code,
      stage: 'HUMAN_PRINCIPAL',
      actorType: human.actorType,
      permission: required.label,
      reason: human.reason,
      human,
    };
  }

  // 2. Permissão ESPECÍFICA. `true` estrito: qualquer outro valor é ausência de permissão.
  if (hasSpecificPermission !== true) {
    return {
      allowed: false,
      code: 'SELF_MODIFICATION_APPROVAL_PERMISSION_REQUIRED',
      stage: 'SPECIFIC_PERMISSION',
      actorType: human.actorType,
      permission: required.label,
      reason: `aval de self-modification exige a permissão específica ${required.label} — permissão genérica de engenharia não é autoridade para alterar as regras que julgam o sistema`,
      human,
    };
  }

  return {
    allowed: true,
    code: null,
    stage: null,
    actorType: human.actorType,
    permission: required.label,
    reason: `aval humano (${actor}) com a permissão específica ${required.label}`,
    human,
  };
}

/**
 * Baseline de REGRAS antes de uma missão de self-engineering. Se o fix alterar o próprio critério,
 * a alteração precisa ser EXPLÍCITA e comparável — nunca silenciosa.
 *
 * `files` é o mapa path → hash do CONTEÚDO dos arquivos de regra (calculado pelo chamador, que tem
 * I/O): cobre o caso em que o enfraquecimento acontece DENTRO de um arquivo que continua existindo
 * — remover o gate da lista é visível na lista, mas editar o limiar dentro dele não seria.
 */
function captureRuleBaseline({ mandatoryGates = [], testManifest = [], thresholds = {}, policies = {}, requirements = [], files = {}, contentManifest = null } = {}) {
  return {
    capturedAt: null, // preenchido pelo chamador (engine é puro)
    mandatoryGates: [...mandatoryGates].sort(),
    testManifest: [...testManifest].sort(),
    thresholds: { ...thresholds },
    policies: { ...policies },
    requirements: [...requirements].sort(),
    files: { ...files },
    // MANIFESTO DE CONTEÚDO da autoridade de governança (path + sha256 + size + classification).
    // `files` responde "este arquivo mudou?"; o manifesto responde "QUAIS artefatos autoritativos
    // existem agora, e com que conteúdo" — é o que pega um gate NOVO entrando na cadeia de decisão
    // e um gate REMOVIDO, casos que um mapa de hashes de uma lista fixa não cobre.
    contentManifest,
  };
}

/** Diferença entre baseline e estado atual das regras, nas duas direções. */
function diffRuleBaseline(baseline = {}, current = {}) {
  const diffList = (before = [], after = []) => ({
    removed: (Array.isArray(before) ? before : []).filter((x) => !(Array.isArray(after) ? after : []).includes(x)),
    added: (Array.isArray(after) ? after : []).filter((x) => !(Array.isArray(before) ? before : []).includes(x)),
  });
  const thresholdChanges = [];
  const before = baseline.thresholds || {};
  const after = current.thresholds || {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[key] !== after[key]) thresholdChanges.push({ key, from: before[key], to: after[key] });
  }
  // ARQUIVOS DE REGRA: removido, acrescentado ou MODIFICADO (hash diferente). Modificação é a
  // forma mais discreta de enfraquecer um critério (editar o limiar dentro do arquivo), então ela
  // conta como violação do mesmo jeito.
  const filesBefore = baseline.files || {};
  const filesAfter = current.files || {};
  const files = {
    removed: Object.keys(filesBefore).filter((k) => !(k in filesAfter)),
    added: Object.keys(filesAfter).filter((k) => !(k in filesBefore)),
    modified: Object.keys(filesBefore).filter((k) => k in filesAfter && filesBefore[k] !== filesAfter[k]),
  };
  return {
    mandatoryGates: diffList(baseline.mandatoryGates, current.mandatoryGates),
    testManifest: diffList(baseline.testManifest, current.testManifest),
    requirements: diffList(baseline.requirements, current.requirements),
    thresholdChanges,
    files,
    changed: Boolean(
      diffList(baseline.mandatoryGates, current.mandatoryGates).removed.length
      || diffList(baseline.testManifest, current.testManifest).removed.length
      || diffList(baseline.requirements, current.requirements).removed.length
      || files.removed.length
      || files.modified.length
      || thresholdChanges.some((c) => typeof c.to === 'number' && typeof c.from === 'number' && c.to < c.from),
    ),
  };
}

/**
 * O fix alterou o próprio critério que o reprovava? Compara o baseline CAPTURADO antes da correção
 * com o estado atual e devolve um veredito explícito — nunca um booleano solto, porque a decisão do
 * chamador (bloquear o fechamento) depende do MOTIVO e do que mudou.
 */
function verifyRuleBaseline({ baseline = null, current = null } = {}) {
  if (!baseline || typeof baseline !== 'object') {
    return {
      ok: false,
      checked: false,
      code: 'GOVERNANCE_BASELINE_UNVERIFIED',
      reason: 'finding de self-modification sem baseline de regras capturado antes da correção — não há como provar que o critério não foi afrouxado',
      diff: null,
    };
  }
  const diff = diffRuleBaseline(baseline, current || {});
  if (!diff.changed) {
    return { ok: true, checked: true, code: null, reason: 'regras de julgamento inalteradas em relação ao baseline capturado antes da correção', diff };
  }
  return {
    ok: false,
    checked: true,
    code: 'GOVERNANCE_BASELINE_VIOLATION',
    reason: 'o fix alterou as PRÓPRIAS regras de julgamento (gate/limiar/manifesto/requisito removido ou modificado) — alteração exige aval humano explícito, nunca fechamento autônomo',
    diff,
  };
}

module.exports = {
  normalizePath,
  matchPaths,
  assessSelfModification,
  captureRuleBaseline,
  diffRuleBaseline,
  verifyRuleBaseline,
  assessApprovalAuthority,
  HUMAN_ONLY_APPROVAL_POLICY,
  SELF_MODIFICATION_APPROVAL_PERMISSION,
  assessGranularApprovalAuthority,
};
