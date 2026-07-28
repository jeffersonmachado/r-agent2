'use strict';

/**
 * pageSurfaceWave — motor puro da Page Surface Wave (Security/Platform Wave).
 *
 * Sem I/O (nada de fs/rede): recebe os itens `page:` do inventário e os
 * resultados de probe coletados pelo runner
 * (`scripts/governance/page-surface-wave.js`, Playwright contra o frontend
 * vivo) e produz o estado de cobertura de cada página.
 *
 * Escopo da validação (espelha a API Surface Wave — ver
 * docs/qa/coverage-engine.md): enforcement de autenticação (página guardada
 * não renderiza para anônimo), enforcement da classificação de visibilidade
 * (PRODUCTION/SUPPORT/DEVELOPMENT) e carregamento são da página pelo papel
 * que deve acessá-la. A wave NÃO declara validação de negócio de uma página —
 * isso continua exigindo jornada/cenário de mesh ligado.
 *
 * Probes (coletados pelo runner com Chromium headless):
 *   - P1 anonymous:   contexto novo, sem credencial.
 *   - P2 production:  usuário operacional (role admin → PRODUCTION),
 *                     provisionado pelo mesmo fluxo RPA da API Surface Wave.
 *   - P3 development: super_admin (→ DEVELOPMENT). Só aplicável a páginas
 *                     SUPPORT/DEVELOPMENT.
 *   Páginas com `:param` no path recebem apenas P1 e P2 com o path bruto e
 *   ficam no máximo VISITED (sem assertiva pageLoads) — navegar para um path
 *   com parâmetro não resolvido não prova carregamento são.
 *
 * Assertivas por item:
 *   - authEnforced:           (apenas guarded=true) P1 anônimo NÃO renderizou
 *                             o conteúdo da página — exibiu a superfície de
 *                             login (ou redirect para /login). Falha = página
 *                             protegida renderiza sem credencial (falha de
 *                             segurança real).
 *   - classificationEnforced: (apenas SUPPORT/DEVELOPMENT) P2 (papel
 *                             PRODUCTION) foi bloqueado (tela "Acesso Negado"
 *                             ou superfície de login). Falha = usuário
 *                             operacional acessa superfície de engenharia/
 *                             suporte (violação de visibilidade).
 *   - pageLoads:              para o papel que DEVE acessar (P2 para páginas
 *                             PRODUCTION; P3 para SUPPORT/DEVELOPMENT; P1 para
 *                             páginas públicas), a página renderizou conteúdo
 *                             (sem tela de bloqueio), o documento principal
 *                             respondeu < 500 e não houve console.error nem
 *                             pageerror. Falha = página operacional quebrada
 *                             para o operador (ou engenharia bloqueada na
 *                             própria página).
 *
 * Estado final por item (precedência FAILED > VALIDATED > VISITED > BLOCKED):
 *   - qualquer assertiva avaliada falha                    → FAILED
 *   - todas as assertivas aplicáveis avaliadas e passando  → VALIDATED
 *   - probe executado mas ao menos uma assertiva aplicável
 *     não avaliada (probe pulado por política ou sessão
 *     indisponível)                                        → VISITED
 *   - nenhum probe executou com sucesso (frontend
 *     inalcançável / browser indisponível)                 → BLOCKED
 */

const { COVERAGE_STATES } = require('./coverageStates');

const WAVE_ID = 'page-surface-wave';

const PRIVILEGED_CLASSIFICATIONS = new Set(['SUPPORT', 'DEVELOPMENT']);

/**
 * Rotas públicas do frontend (espelha `publicRoutes` + /login de
 * frontend/src/main.jsx): não exigem autenticação por design. Para essas
 * páginas o probe de carregamento esperado é o anônimo (P1).
 */
const PUBLIC_PATHS = ['/', '/login', '/saas', '/storefront', '/kiosk', '/panel', '/station'];

function isPublicPath(pagePath) {
  const target = String(pagePath || '');
  return PUBLIC_PATHS.some((route) => {
    if (route === '/') return target === '/';
    return target === route || target.startsWith(`${route}/`) || target.startsWith(`${route}?`);
  });
}

function hasPathParam(pagePath) {
  return /(^|\/)[:*][^/]*/.test(String(pagePath || '')) || String(pagePath || '').includes('/:');
}

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

/**
 * Política de probe por item (mesma regra aplicada pelo runner).
 * Navegação GET de página é sempre segura (sem efeito colateral); o limite é
 * semântico: paths com `:param` não provam carregamento são.
 */
function probePolicy(item) {
  const privileged = PRIVILEGED_CLASSIFICATIONS.has(item.classification);
  const parameterized = hasPathParam(item.path);
  return {
    p1: true,
    p2: true,
    p3: privileged && !parameterized,
    pageLoads: !parameterized,
    expectedProbe: parameterized
      ? null
      : (privileged ? 'p3' : (isPublicPath(item.path) ? 'p1' : 'p2')),
    reason: parameterized
      ? 'path com :param — apenas P1/P2 com path bruto; pageLoads não avaliada (máx. VISITED)'
      : 'navegação de página (segura)',
  };
}

/**
 * Um probe é objeto {
 *   loginSurface:boolean, denied:boolean, rendered:boolean,
 *   docStatus:number, consoleErrors:number, pageErrors:number
 * } | null (não executado) | { error: true } (falha de navegação/rede).
 */
function probeRan(probe) {
  return Boolean(probe) && !probe.error;
}

/** P1 anônimo foi barrado: superfície de login exibida (ou redirect /login). */
function anonymousBlocked(probe) {
  return probeRan(probe) && probe.loginSurface === true && probe.rendered !== true;
}

/** Documento rejeitado pelo servidor (proxy/edge) por falta de credencial. */
function docRejected(probe) {
  return probeRan(probe) && (probe.docStatus === 401 || probe.docStatus === 403);
}

/** Papel autenticado foi barrado: tela de acesso negado ou superfície de login. */
function roleBlocked(probe) {
  return probeRan(probe) && (probe.denied === true || (probe.loginSurface === true && probe.rendered !== true));
}

/**
 * Avalia um item `page:` do inventário a partir dos probes coletados.
 *
 * @param {object} item item do inventário (kind==='page')
 * @param {object} probes { p1?, p2?, p3? } — cada um null | {error:true} | sinais do probe
 * @param {object} [exemption] isenção justificada (config/page-surface-exemptions.json)
 * @returns {{ id:string, state:string, assertions:object[], probes:object }}
 */
function evaluatePageItem(item, probes = {}, exemption = null) {
  const p1 = probes.p1 || null;
  const p2 = probes.p2 || null;
  const p3 = probes.p3 || null;
  const guarded = item.guarded === true;
  const privileged = PRIVILEGED_CLASSIFICATIONS.has(item.classification);
  const policy = probePolicy(item);

  const assertions = [];

  const anyProbeRan = [p1, p2, p3].some(probeRan);
  const anyProbeAttempted = [p1, p2, p3].some((probe) => Boolean(probe));

  // authEnforced (somente páginas guardadas)
  if (guarded) {
    if (!p1) {
      assertions.push(notEvaluated('authEnforced', `P1 não executado (${policy.reason})`));
    } else if (p1.error) {
      assertions.push(notEvaluated('authEnforced', 'P1 com erro de navegação'));
    } else if (p1.rendered === true) {
      assertions.push(assertion(
        'authEnforced',
        false,
        'anônimo renderizou o conteúdo da página protegida sem credencial',
      ));
    } else if (anonymousBlocked(p1) || docRejected(p1)) {
      assertions.push(assertion(
        'authEnforced',
        true,
        anonymousBlocked(p1)
          ? 'anônimo barrado (superfície de login exibida)'
          : `anônimo barrado pelo servidor (documento ${p1.docStatus})`,
      ));
    } else {
      assertions.push(notEvaluated(
        'authEnforced',
        `probe inconclusivo (docStatus=${p1.docStatus}, sem superfície de login nem conteúdo)`,
      ));
    }
  }

  // classificationEnforced (somente SUPPORT/DEVELOPMENT)
  if (privileged) {
    if (!p2) {
      assertions.push(notEvaluated('classificationEnforced', 'P2 não executado (sessão PRODUCTION indisponível)'));
    } else if (p2.error) {
      assertions.push(notEvaluated('classificationEnforced', 'P2 com erro de navegação'));
    } else if (p2.rendered === true) {
      assertions.push(assertion(
        'classificationEnforced',
        false,
        `papel PRODUCTION acessou página ${item.classification} — violação de visibilidade`,
      ));
    } else if (roleBlocked(p2) || docRejected(p2)) {
      assertions.push(assertion(
        'classificationEnforced',
        true,
        `papel PRODUCTION bloqueado em página ${item.classification}`,
      ));
    } else {
      assertions.push(notEvaluated(
        'classificationEnforced',
        `probe inconclusivo (docStatus=${p2.docStatus}, sem conteúdo nem bloqueio)`,
      ));
    }
  }

  // pageLoads (papel esperado; não avaliada em paths com :param)
  if (!policy.pageLoads) {
    assertions.push(notEvaluated('pageLoads', `não avaliada (${policy.reason})`));
  } else {
    const expected = policy.expectedProbe === 'p3' ? p3 : (policy.expectedProbe === 'p1' ? p1 : p2);
    const expectedLabel = policy.expectedProbe === 'p3'
      ? 'super_admin'
      : (policy.expectedProbe === 'p1' ? 'anônimo (página pública)' : 'papel PRODUCTION');
    if (!expected) {
      assertions.push(notEvaluated('pageLoads', `probe ${policy.expectedProbe} não executado (sessão indisponível)`));
    } else if (expected.error) {
      assertions.push(notEvaluated('pageLoads', `probe ${policy.expectedProbe} com erro de navegação`));
    } else {
      const docOk = typeof expected.docStatus === 'number' && expected.docStatus > 0 && expected.docStatus < 500;
      const noJsErrors = (expected.consoleErrors || 0) === 0 && (expected.pageErrors || 0) === 0;
      const isLoginPage = String(item.path) === '/login';
      // A própria /login renderiza a superfície de login como conteúdo — é o
      // comportamento correto da página, não bloqueio.
      const blocked = !isLoginPage && roleBlocked(expected);
      const rendered = expected.rendered === true || (isLoginPage && expected.loginSurface === true);
      const passed = rendered && !blocked && docOk && noJsErrors;
      const problems = [];
      if (!rendered) problems.push('conteúdo não renderizou');
      if (blocked) problems.push('tela de bloqueio (acesso negado/login)');
      if (!docOk) problems.push(`documento principal status=${expected.docStatus}`);
      if (!noJsErrors) {
        problems.push(`console.error=${expected.consoleErrors || 0} pageerror=${expected.pageErrors || 0}`);
      }
      assertions.push(assertion(
        'pageLoads',
        passed,
        passed
          ? `página carregou são para ${expectedLabel}`
          : `falha de carregamento para ${expectedLabel}: ${problems.join('; ')}`,
      ));
    }
  }

  // Isenção justificada (auditável) antes da resolução de estado
  const exemptionResult = applyExemption(assertions, exemption, item.id);
  const finalAssertions = exemptionResult.assertions;

  // Estado final
  const failed = finalAssertions.some((a) => !a.notEvaluated && a.passed === false);
  const probesDown = anyProbeAttempted && !anyProbeRan;
  const pendingEvaluation = finalAssertions.some((a) => a.notEvaluated === true);

  let state;
  if (failed && !probesDown) {
    state = COVERAGE_STATES.FAILED;
  } else if (probesDown || !anyProbeAttempted) {
    // frontend inalcançável / browser indisponível / probe não executado
    state = COVERAGE_STATES.BLOCKED;
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
  if (probe.error) return 'navigation-error';
  return {
    docStatus: probe.docStatus || 0,
    rendered: probe.rendered === true,
    loginSurface: probe.loginSurface === true,
    denied: probe.denied === true,
    ...(probe.viaSpa === true ? { viaSpa: true } : {}),
    consoleErrors: probe.consoleErrors || 0,
    pageErrors: probe.pageErrors || 0,
    ...(Array.isArray(probe.errorSamples) && probe.errorSamples.length > 0
      ? { errorSamples: probe.errorSamples }
      : {}),
  };
}

/**
 * Avalia todos os itens `page:` do inventário.
 *
 * @param {object[]} inventoryItems itens do inventário
 * @param {Map<string, object>} probesByItemId itemId → { p1?, p2?, p3? }
 * @param {object} [exemptions] mapa itemId → { assertion, reason, approvedBy, date }
 * @returns {{ perItem: object[], totals: object, exemptionsApplied: object[] }}
 */
function evaluatePageSurface(inventoryItems, probesByItemId, exemptions = {}) {
  const perItem = [];
  const byState = {};
  const exemptionsApplied = [];
  for (const item of inventoryItems || []) {
    if (!item || item.kind !== 'page') continue;
    const result = evaluatePageItem(
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
  PUBLIC_PATHS,
  isPublicPath,
  hasPathParam,
  probePolicy,
  evaluatePageItem,
  evaluatePageSurface,
  applyExemption,
};
