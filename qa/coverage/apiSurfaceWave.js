'use strict';

/**
 * apiSurfaceWave — motor puro da API Surface Wave (Security/Platform Wave).
 *
 * Sem I/O (nada de fs/rede): recebe os itens `api:` do inventário e os
 * resultados de probe coletados pelo runner
 * (`scripts/governance/api-surface-wave.js`) e produz o estado de cobertura
 * de cada endpoint.
 *
 * Escopo da validação (Security Wave — ver docs/qa/coverage-engine.md):
 * existência da rota, enforcement de autenticação e enforcement da
 * classificação de visibilidade (PRODUCTION/SUPPORT/DEVELOPMENT). A wave NÃO
 * declara validação de negócio de um endpoint — isso continua exigindo
 * jornada/cenário de mesh ligado.
 *
 * Probes (coletados pelo runner contra um servidor real):
 *   - P1 anonymous:   sem Authorization.
 *   - P2 production:  token de papel operacional (admin → PRODUCTION).
 *   - P3 development: token super_admin (→ DEVELOPMENT). Só aplicável a
 *                     rotas SUPPORT/DEVELOPMENT.
 *   Métodos não-GET (POST/PUT/PATCH/DELETE) recebem apenas P1 e somente
 *   quando o inventário declara authRequired — probes autenticados em rotas
 *   mutáveis poderiam executar efeitos colaterais reais (política de probe
 *   seguro; itens assim ficam no máximo VALIDATED nas assertivas de P1).
 *
 * Assertivas por item:
 *   - routeRegistered:        ao menos um probe respondeu algo diferente do
 *                             404 de fallback do Express ({error:'not_found'}).
 *                             Falha = rota do inventário não existe no runtime
 *                             (drift inventário ↔ código).
 *   - authEnforced:           (apenas authRequired=true) P1 anônimo respondeu
 *                             401/403. Falha = endpoint protegido acessível
 *                             sem credencial (falha de segurança real).
 *   - classificationEnforced: (apenas SUPPORT/DEVELOPMENT) P2 (papel
 *                             PRODUCTION) respondeu 401/403. Falha = usuário
 *                             operacional acessa superfície de engenharia/
 *                             suporte (violação de visibilidade).
 *   - developmentReachable:   (apenas SUPPORT/DEVELOPMENT, rotas GET) P3
 *                             (super_admin) NÃO respondeu 401/403. Falha =
 *                             engenharia/suporte bloqueado na própria rota.
 *
 * Estado final por item (precedência FAILED > VISITED > VALIDATED > BLOCKED):
 *   - qualquer assertiva avaliada falha                    → FAILED
 *   - routeRegistered passa + todas as assertivas
 *     aplicáveis avaliadas e passando                      → VALIDATED
 *   - routeRegistered passa + ao menos uma assertiva
 *     aplicável não avaliada (probe pulado por segurança
 *     ou token indisponível)                               → VISITED
 *   - nenhum probe executou (servidor inalcançável)        → BLOCKED
 *
 * Rotas GET públicas (authRequired=false, PRODUCTION): VALIDATED exige apenas
 * routeRegistered — o contrato de auth não se aplica.
 */

const { COVERAGE_STATES } = require('./coverageStates');

const WAVE_ID = 'api-surface-wave';

const SAFE_METHODS = new Set(['GET', 'HEAD']);
const PRIVILEGED_CLASSIFICATIONS = new Set(['SUPPORT', 'DEVELOPMENT']);

function assertion(name, passed, detail, extra = {}) {
  return { name, passed: Boolean(passed), detail: detail || '', ...extra };
}

const EXEMPTION_REQUIRED_FIELDS = ['assertion', 'reason', 'approvedBy', 'date'];

/** Isenção válida: todos os campos obrigatórios presentes e não vazios. */
function isValidExemption(exemption) {
  return Boolean(exemption) && typeof exemption === 'object'
    && EXEMPTION_REQUIRED_FIELDS.every((field) => typeof exemption[field] === 'string' && exemption[field].trim() !== '');
}

/**
 * Aplica isenção justificada às assertivas de um item: a assertiva citada vira
 * NOT_APPLICABLE (passed=true, não conta contra VALIDATED) e fica registrada
 * no resultado (auditável). Isenção sem campos obrigatórios ou para assertiva
 * inexistente é IGNORADA — a assertiva continua valendo normalmente.
 * Retorna { assertions, applied } — applied=null quando não aplicada.
 */
function applyExemption(assertions, exemption, itemId) {
  if (!isValidExemption(exemption)) return { assertions, applied: null };
  const index = assertions.findIndex((a) => a.name === exemption.assertion);
  if (index === -1) return { assertions, applied: null };
  const updated = [...assertions];
  updated[index] = {
    ...updated[index],
    passed: true,
    notApplicable: true,
    detail: `${updated[index].detail} | NOT_APPLICABLE — isenção justificada: `
      + `${exemption.reason} (aprovada por ${exemption.approvedBy} em ${exemption.date})`,
  };
  return {
    assertions: updated,
    applied: {
      item: itemId,
      assertion: exemption.assertion,
      reason: exemption.reason,
      approvedBy: exemption.approvedBy,
      date: exemption.date,
    },
  };
}

function notEvaluated(name, detail) {
  return assertion(name, true, detail, { notEvaluated: true });
}

/** Política de probe seguro por item (mesma regra aplicada pelo runner). */
function probePolicy(item) {
  const method = String(item.method || 'GET').toUpperCase();
  const safe = SAFE_METHODS.has(method);
  const authRequired = item.authRequired === true;
  const privileged = PRIVILEGED_CLASSIFICATIONS.has(item.classification);
  return {
    p1: safe || authRequired,
    p2: safe,
    p3: safe && privileged,
    reason: safe
      ? 'método seguro (GET/HEAD)'
      : (authRequired
        ? 'método mutável: apenas P1 anônimo (401 esperado antes de qualquer efeito)'
        : 'método mutável sem auth declarada: probe pulado (risco de efeito colateral)'),
  };
}

/**
 * Um probe é objeto { status, notFoundFallback } | null (não executado) |
 * { error: true } (falha de rede).
 */
function probeReachedRoute(probe) {
  if (!probe || probe.error) return false;
  if (probe.status === 404 && probe.notFoundFallback) return false;
  return typeof probe.status === 'number' && probe.status > 0;
}

function probeRejected(probe) {
  return Boolean(probe) && !probe.error && (probe.status === 401 || probe.status === 403);
}

/**
 * Avalia um item `api:` do inventário a partir dos probes coletados.
 *
 * @param {object} item item do inventário (kind==='api')
 * @param {object} probes { p1?, p2?, p3? } — cada um null | {error:true} |
 *   { status:number, notFoundFallback?:boolean }
 * @param {object} [exemption] isenção justificada (config/api-surface-exemptions.json)
 * @returns {{ id:string, state:string, assertions:object[], probes:object }}
 */
function evaluateApiItem(item, probes = {}, exemption = null) {
  const p1 = probes.p1 || null;
  const p2 = probes.p2 || null;
  const p3 = probes.p3 || null;
  const authRequired = item.authRequired === true;
  const privileged = PRIVILEGED_CLASSIFICATIONS.has(item.classification);
  const policy = probePolicy(item);

  const assertions = [];

  const anyProbeRan = [p1, p2, p3].some((probe) => probe && !probe.error);
  const anyProbeAttempted = [p1, p2, p3].some((probe) => Boolean(probe));

  // routeRegistered
  if (!anyProbeAttempted) {
    assertions.push(notEvaluated('routeRegistered', `nenhum probe executado (${policy.reason})`));
  } else if (!anyProbeRan) {
    assertions.push(assertion('routeRegistered', false, 'todos os probes falharam com erro de rede (servidor inalcançável)'));
  } else {
    const reached = [p1, p2, p3].some(probeReachedRoute);
    assertions.push(assertion(
      'routeRegistered',
      reached,
      reached
        ? 'rota respondeu no runtime'
        : '404 de fallback do Express ({error:not_found}) em todos os probes — rota não registrada',
    ));
  }

  // authEnforced (somente rotas com auth declarada)
  if (authRequired) {
    if (!p1) {
      assertions.push(notEvaluated('authEnforced', `P1 não executado (${policy.reason})`));
    } else if (p1.error) {
      assertions.push(notEvaluated('authEnforced', 'P1 com erro de rede'));
    } else {
      assertions.push(assertion(
        'authEnforced',
        probeRejected(p1),
        probeRejected(p1)
          ? `anônimo rejeitado com ${p1.status}`
          : `anônimo recebeu ${p1.status} — endpoint protegido respondeu sem credencial`,
      ));
    }
  }

  // classificationEnforced (somente SUPPORT/DEVELOPMENT)
  if (privileged) {
    if (!p2) {
      assertions.push(notEvaluated('classificationEnforced', `P2 não executado (${policy.reason})`));
    } else if (p2.error) {
      assertions.push(notEvaluated('classificationEnforced', 'P2 com erro de rede'));
    } else {
      assertions.push(assertion(
        'classificationEnforced',
        probeRejected(p2),
        probeRejected(p2)
          ? `papel PRODUCTION rejeitado com ${p2.status} em rota ${item.classification}`
          : `papel PRODUCTION recebeu ${p2.status} em rota ${item.classification} — violação de visibilidade`,
      ));
    }

    // developmentReachable (somente quando P3 é seguro de executar)
    if (!p3) {
      assertions.push(notEvaluated('developmentReachable', `P3 não executado (${policy.reason})`));
    } else if (p3.error) {
      assertions.push(notEvaluated('developmentReachable', 'P3 com erro de rede'));
    } else {
      assertions.push(assertion(
        'developmentReachable',
        !probeRejected(p3),
        probeRejected(p3)
          ? `super_admin recebeu ${p3.status} em rota ${item.classification} — engenharia bloqueada`
          : `super_admin alcançou a rota (${p3.status})`,
      ));
    }
  }

  // Isenção justificada (auditável) antes da resolução de estado
  const exemptionResult = applyExemption(assertions, exemption, item.id);
  const finalAssertions = exemptionResult.assertions;

  // Estado final
  const failed = finalAssertions.some((a) => !a.notEvaluated && a.passed === false);
  const networkDown = anyProbeAttempted && !anyProbeRan;
  const pendingEvaluation = finalAssertions.some((a) => a.notEvaluated === true);

  let state;
  if (failed && !networkDown) {
    state = COVERAGE_STATES.FAILED;
  } else if (networkDown) {
    state = COVERAGE_STATES.BLOCKED;
  } else if (!anyProbeAttempted) {
    state = COVERAGE_STATES.VISITED; // política de probe seguro: nada executado, item apenas inspecionado
  } else if (pendingEvaluation) {
    state = COVERAGE_STATES.VISITED;
  } else {
    state = COVERAGE_STATES.VALIDATED;
  }

  return {
    id: item.id,
    state,
    assertions: finalAssertions,
    ...(exemptionResult.applied ? { exemption: exemptionResult.applied } : {}),
    probes: {
      p1: summarizeProbe(p1),
      p2: summarizeProbe(p2),
      p3: summarizeProbe(p3),
    },
  };
}

function summarizeProbe(probe) {
  if (!probe) return 'skipped';
  if (probe.error) return 'network-error';
  return { status: probe.status, notFoundFallback: probe.notFoundFallback === true };
}

/**
 * Avalia todos os itens `api:` do inventário.
 *
 * @param {object[]} inventoryItems itens do inventário
 * @param {Map<string, object>} probesByItemId itemId → { p1?, p2?, p3? }
 * @param {object} [exemptions] mapa itemId → { assertion, reason, approvedBy, date }
 * @returns {{ perItem: object[], totals: object, exemptionsApplied: object[] }}
 */
function evaluateApiSurface(inventoryItems, probesByItemId, exemptions = {}) {
  const perItem = [];
  const byState = {};
  const exemptionsApplied = [];
  for (const item of inventoryItems || []) {
    if (!item || item.kind !== 'api') continue;
    const result = evaluateApiItem(
      item,
      (probesByItemId && probesByItemId.get(item.id)) || {},
      exemptions ? exemptions[item.id] : null,
    );
    perItem.push(result);
    byState[result.state] = (byState[result.state] || 0) + 1;
    if (result.exemption) exemptionsApplied.push(result.exemption);
  }
  return {
    perItem,
    totals: {
      items: perItem.length,
      byState,
    },
    exemptionsApplied,
  };
}

module.exports = {
  WAVE_ID,
  probePolicy,
  evaluateApiItem,
  evaluateApiSurface,
  applyExemption,
};
