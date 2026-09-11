#!/usr/bin/env node
'use strict';

/**
 * validate-evo-contract.js — gate do CONTRATO EVO.
 *
 * Por que este gate existe: o contrato `config/integrations/evo-contract.json`
 * instruía rodar `npm run validate:evo-contract` no passo 4 do procedimento de
 * certificação — comando que NÃO EXISTIA. Política declarada sem enforcement é
 * a mesma classe de defeito do `criticalGates` sem consumidor: parece governada
 * e não é.
 *
 * O que este gate FALHA (exit 1):
 *  - contrato ausente/ilegível/estruturalmente incompleto;
 *  - `readOnly` deixar de ser verdadeiro (a integração é somente leitura);
 *  - status CERTIFIED sem as evidências de certificação (certifiedAt,
 *    certifiedBy, verifiedAgainst e `_officialDocsConsultation.verifiedAgainst`);
 *  - rótulo honesto que reivindique LIVE VERIFIED sem certificação;
 *  - guard declarado no contrato sem implementação executável no cliente HTTP;
 *  - recurso declarado no contrato que o provider não suporta (ou vice-versa);
 *  - dialeto de autenticação da API FINANCEIRO (client credentials) transportado
 *    para a API de INTEGRAÇÃO sem confirmação oficial (§21: não inventar);
 *  - rate limit declarado como documentado sem fonte oficial.
 *
 * O que este gate NÃO falha: contrato UNVERIFIED. Falta de credencial não é
 * fraude — é estado honesto, e é justamente o estado que este gate PROTEGE.
 *
 * Saída: `reports/evo-contract-report.json` (versionado).
 *
 * Uso: node scripts/governance/validate-evo-contract.js [--json]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..', '..');
const CONTRACT_PATH = path.join(ROOT_DIR, 'config', 'integrations', 'evo-contract.json');
const CLIENT_PATH = path.join(
  ROOT_DIR, 'api', 'services', 'integration', 'providers', 'evo', 'evoApiClient.js',
);
const ADAPTER_PATH = path.join(
  ROOT_DIR, 'api', 'services', 'integration', 'providers', 'evo', 'evoProviderAdapter.js',
);
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'evo-contract-report.json');

const CERTIFICATION_STATES = Object.freeze(['UNVERIFIED', 'CERTIFIED']);

const VIOLATION_CODES = Object.freeze({
  CONTRACT_MISSING: 'evo_contract_missing',
  CONTRACT_MALFORMED: 'evo_contract_malformed',
  READONLY_VIOLATED: 'evo_contract_readonly_violated',
  STRUCTURE_INCOMPLETE: 'evo_contract_structure_incomplete',
  GUARD_NOT_ENFORCED: 'evo_guard_declared_but_not_enforced',
  CERTIFICATION_CLAIM_WITHOUT_EVIDENCE: 'evo_certification_claim_without_evidence',
  UNVERIFIED_LABEL_DISHONEST: 'evo_unverified_label_claims_live_verified',
  DOCS_CONSULTATION_MISSING: 'evo_official_docs_consultation_missing',
  RESOURCE_NOT_SUPPORTED: 'evo_contract_resource_not_supported',
  AUTH_DIALECT_CONFLATED_WITH_FINANCE_API: 'evo_auth_dialect_conflated_with_finance_api',
  RATE_LIMIT_CLAIMED_WITHOUT_DOC: 'evo_rate_limit_claimed_as_documented_without_doc',
  // ── hardening final: dialetos e entidades por recurso ──
  GLOBAL_PAGINATION_DIALECT: 'evo_global_pagination_dialect_still_declared',
  RESOURCE_PAGINATION_MISSING: 'evo_resource_pagination_missing',
  RESOURCE_MAX_TAKE_MISSING: 'evo_resource_max_take_missing',
  RESOURCE_INCREMENTAL_MISSING: 'evo_resource_incremental_strategy_missing',
  GLOBAL_UPDATED_SINCE: 'evo_global_updated_since_dialect',
  ENTITY_AMBIGUOUS: 'evo_entity_roles_ambiguous',
  HOST_CLAIMED_OFFICIAL_WITHOUT_SOURCE: 'evo_host_claimed_official_without_official_source',
  SSRF_POLICY_MISSING: 'evo_ssrf_policy_missing',
  SSRF_POLICY_NOT_ENFORCED: 'evo_ssrf_policy_not_enforced_in_client',
  CONTRACT_STATE_TAXONOMY_MISSING: 'evo_contract_state_taxonomy_missing',
  WEBHOOK_SCHEME_CLAIMED_PROVIDER_DOCUMENTED: 'evo_webhook_scheme_claimed_as_provider_documented',
});

/** Papéis de entidade que NÃO podem ser confundidos (Membership ≠ MemberMembership). */
const ENTITY_ROLE_RULES = Object.freeze([
  {
    resource: 'plans',
    forbiddenRapTarget: /AccessMembership/,
    forbiddenEvoEntity: /^MemberMembership$/,
    expectedEvoEntity: 'Membership',
    why: 'EVO Membership é o CATÁLOGO de planos; tratá-lo como contrato do aluno cria matrícula fantasma.',
  },
  {
    resource: 'memberships',
    expectedEvoEntity: 'MemberMembership',
    expectedRapTarget: 'AccessMembership',
    why: 'EVO MemberMembership é o CONTRATO do aluno e é o único que pode virar AccessMembership.',
  },
]);

/** Parâmetros de paginação que NÃO podem existir como dialeto global. */
const LEGACY_PAGINATION_PARAMS = Object.freeze(['pageParam', 'sizeParam']);

/** Campos de eixo de paginação exigidos por recurso. */
const REQUIRED_PAGINATION_FIELDS = Object.freeze(['model', 'maxTake']);

const REQUIRED_CONTRACT_STATES = Object.freeze([
  'OFFICIAL_DOCS_VERIFIED', 'LOCAL_CONTRACT_TESTED', 'AWAITING_LIVE_CERTIFICATION', 'LIVE_CERTIFIED',
]);

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validação PURA do contrato (sem I/O): recebe o contrato, o fonte do cliente
 * HTTP e os recursos suportados pelo provider.
 */
function validateContract(contract, context = {}) {
  const violations = [];
  const push = (code, detail = {}) => violations.push({ code, ...detail });

  if (!contract || typeof contract !== 'object') {
    push(VIOLATION_CODES.CONTRACT_MALFORMED, { reason: 'contract_not_an_object' });
    return { violations };
  }

  const certification = contract._certification || {};
  const status = String(certification.status || '').toUpperCase();
  if (!CERTIFICATION_STATES.includes(status)) {
    push(VIOLATION_CODES.CERTIFICATION_CLAIM_WITHOUT_EVIDENCE, { reason: 'unknown_status', status });
  }

  // A integração é SOMENTE LEITURA: qualquer mudança aqui é regressão material.
  if (contract.readOnly !== true) {
    push(VIOLATION_CODES.READONLY_VIOLATED, { readOnly: contract.readOnly });
  }

  // Estrutura mínima: sem estes campos o cliente não tem como operar.
  const required = [
    ['provider', isNonEmptyString(contract.provider)],
    ['defaultBaseUrl', isNonEmptyString(contract.defaultBaseUrl) && contract.defaultBaseUrl.startsWith('https://')],
    ['auth.type', isNonEmptyString(contract.auth && contract.auth.type)],
    ['auth.usernameField', isNonEmptyString(contract.auth && contract.auth.usernameField)],
    ['auth.passwordField', isNonEmptyString(contract.auth && contract.auth.passwordField)],
    ['request.timeoutMs', Number.isFinite(Number(contract.request && contract.request.timeoutMs))],
    ['pagination.type', isNonEmptyString(contract.pagination && contract.pagination.type)],
    ['currency.allowed', Array.isArray(contract.currency && contract.currency.allowed) && contract.currency.allowed.length > 0],
  ];
  const missing = required.filter(([, ok]) => !ok).map(([field]) => field);
  const resources = contract.resources && typeof contract.resources === 'object' ? contract.resources : {};
  const resourceKeys = Object.keys(resources);
  if (resourceKeys.length === 0) missing.push('resources');
  for (const key of resourceKeys) {
    const resource = resources[key] || {};
    if (!isNonEmptyString(resource.path)) missing.push(`resources.${key}.path`);
    if (!isNonEmptyString(resource.detailPath)) missing.push(`resources.${key}.detailPath`);
    if (!resource.fields || !Array.isArray(resource.fields.externalId)) {
      missing.push(`resources.${key}.fields.externalId`);
    }
  }
  if (missing.length > 0) {
    push(VIOLATION_CODES.STRUCTURE_INCOMPLETE, { missing });
  }

  // Guard declarado precisa existir no cliente HTTP (enforcement executável).
  const clientSource = context.clientSource || '';
  const guardCode = certification.guards && certification.guards.errorCode;
  if (!isNonEmptyString(guardCode)) {
    push(VIOLATION_CODES.STRUCTURE_INCOMPLETE, { missing: ['_certification.guards.errorCode'] });
  } else if (clientSource && !clientSource.includes(guardCode)) {
    push(VIOLATION_CODES.GUARD_NOT_ENFORCED, { guardCode, expectedIn: 'api/services/integration/providers/evo/evoApiClient.js' });
  }
  if (isNonEmptyString(certification.guards && certification.guards.unverifiedHostPolicy) && clientSource) {
    const enforcesLoopbackOrOverride = clientSource.includes('allowUnverifiedEndpoints')
      && /isLoopbackHost|127\.0\.0\.1|localhost/.test(clientSource);
    if (!enforcesLoopbackOrOverride) {
      push(VIOLATION_CODES.GUARD_NOT_ENFORCED, { guard: 'unverifiedHostPolicy', reason: 'loopback_or_override_missing' });
    }
  }

  // §21 A consulta oficial precisa ficar registrada — inclusive quando o
  // resultado é NEGATIVO (foi o caso: a doc pública não cobre a integração).
  const consultation = contract._officialDocsConsultation || null;
  if (!consultation || !isNonEmptyString(consultation.consultedAt) || !Array.isArray(consultation.sources)
    || consultation.sources.length === 0 || !isNonEmptyString(consultation.conclusion)) {
    push(VIOLATION_CODES.DOCS_CONSULTATION_MISSING, {
      required: ['consultedAt', 'sources[]', 'conclusion'],
    });
  } else if (!consultation.sources.every((source) => isNonEmptyString(source.url) && isNonEmptyString(source.covers))) {
    push(VIOLATION_CODES.DOCS_CONSULTATION_MISSING, { reason: 'source_without_url_or_coverage' });
  }

  // Certificação exige evidência completa; UNVERIFIED exige rótulo honesto.
  if (status === 'CERTIFIED') {
    const missingEvidence = ['certifiedAt', 'certifiedBy', 'verifiedAgainst']
      .filter((field) => (field === 'verifiedAgainst'
        ? !Array.isArray(certification.verifiedAgainst) || certification.verifiedAgainst.length === 0
        : !isNonEmptyString(certification[field])));
    if (!consultation || !Array.isArray(consultation.verifiedAgainst) || consultation.verifiedAgainst.length === 0) {
      missingEvidence.push('_officialDocsConsultation.verifiedAgainst');
    }
    if (missingEvidence.length > 0) {
      push(VIOLATION_CODES.CERTIFICATION_CLAIM_WITHOUT_EVIDENCE, { status, missingEvidence });
    }
  } else if (status === 'UNVERIFIED') {
    if (!isNonEmptyString(certification.mustNotClaim)) {
      push(VIOLATION_CODES.STRUCTURE_INCOMPLETE, { missing: ['_certification.mustNotClaim'] });
    }
    const label = `${certification.honestLabel || ''}`.toUpperCase();
    if (label.includes('LIVE VERIFIED')) {
      push(VIOLATION_CODES.UNVERIFIED_LABEL_DISHONEST, { honestLabel: certification.honestLabel });
    }
    // Não transportar o dialeto da API FINANCEIRO para a API de INTEGRAÇÃO.
    const authType = String((contract.auth && contract.auth.type) || '').toLowerCase();
    const adoptsFinanceAuth = authType.includes('client_credentials')
      || isNonEmptyString(contract.auth && contract.auth.identityTokenPath);
    if (adoptsFinanceAuth) {
      push(VIOLATION_CODES.AUTH_DIALECT_CONFLATED_WITH_FINANCE_API, {
        authType: contract.auth && contract.auth.type,
        reason: 'finance_api_client_credentials_not_confirmed_for_integration_api',
      });
    }
    if (!isNonEmptyString(consultation && consultation.authModelFinding)) {
      push(VIOLATION_CODES.AUTH_DIALECT_CONFLATED_WITH_FINANCE_API, {
        reason: 'auth_model_finding_missing_from_docs_consultation',
      });
    }
  }

  // Recurso do contrato precisa ser suportado pelo provider (e vice-versa):
  // impede recurso inventado no contrato ou mapeado sem contrato.
  const supported = context.supportedResources || null;
  if (Array.isArray(supported) && supported.length > 0) {
    const declared = new Set(resourceKeys);
    const supportedSet = new Set(supported);
    const unsupported = resourceKeys.filter((key) => !supportedSet.has(key));
    const unmapped = supported.filter((key) => !declared.has(key));
    if (unsupported.length > 0 || unmapped.length > 0) {
      push(VIOLATION_CODES.RESOURCE_NOT_SUPPORTED, { unsupported, unmapped });
    }
  }

  // Limite de taxa sem fonte oficial não pode ser apresentado como documentado.
  const rateLimit = contract.rateLimit || {};
  if (rateLimit.documented === true && !isNonEmptyString(rateLimit.source)) {
    push(VIOLATION_CODES.RATE_LIMIT_CLAIMED_WITHOUT_DOC);
  }

  // ── Hardening final: dialetos e entidades POR RECURSO ────────────────────

  // Um dialeto global de paginação (page/size) aplicado a uma API com limites
  // resource-specific produz lote truncado silencioso. O dialeto tem de ser
  // declarado por recurso.
  const globalPagination = contract.pagination || {};
  const legacyParams = LEGACY_PAGINATION_PARAMS.filter((key) => isNonEmptyString(globalPagination[key]));
  if (legacyParams.length > 0) {
    push(VIOLATION_CODES.GLOBAL_PAGINATION_DIALECT, { declared: legacyParams });
  }
  const paginationModels = contract._paginationModels || {};
  for (const [resource, config] of Object.entries(resources)) {
    const declared = config.pagination;
    if (!declared || typeof declared !== 'object') {
      push(VIOLATION_CODES.RESOURCE_PAGINATION_MISSING, { resource });
      continue;
    }
    const missingPagination = REQUIRED_PAGINATION_FIELDS.filter((field) => !isNonEmptyString(String(declared[field] || '')));
    if (missingPagination.length > 0) {
      push(VIOLATION_CODES.RESOURCE_PAGINATION_MISSING, { resource, missing: missingPagination });
    }
    if (!Number.isFinite(Number(declared.maxTake)) || Number(declared.maxTake) <= 0) {
      push(VIOLATION_CODES.RESOURCE_MAX_TAKE_MISSING, { resource, maxTake: declared.maxTake ?? null });
    }
    if (!paginationModels[declared.model]) {
      push(VIOLATION_CODES.RESOURCE_PAGINATION_MISSING, { resource, reason: 'model_not_declared', model: declared.model || null });
    }
  }

  // `updatedSince` global: um filtro inventado, aplicado a recursos que
  // documentam filtros por data diferentes.
  const strategies = contract._incrementalStrategies || {};
  for (const [resource, config] of Object.entries(resources)) {
    const incremental = config.incremental;
    if (!incremental || !isNonEmptyString(incremental.strategy)) {
      push(VIOLATION_CODES.RESOURCE_INCREMENTAL_MISSING, { resource });
      continue;
    }
    if (!strategies[incremental.strategy]) {
      push(VIOLATION_CODES.RESOURCE_INCREMENTAL_MISSING, { resource, reason: 'strategy_not_declared', strategy: incremental.strategy });
    }
    if (String(config.incrementalParam || '') === 'updatedSince') {
      push(VIOLATION_CODES.GLOBAL_UPDATED_SINCE, { resource, incrementalParam: config.incrementalParam });
    }
  }

  // Membership (catálogo) vs MemberMembership (contrato do aluno): mapear os
  // dois no mesmo alvo RAP duplica ou fabrica matrícula.
  for (const rule of ENTITY_ROLE_RULES) {
    const config = resources[rule.resource];
    if (!config) continue;
    const evoEntity = String(config.evoEntity || '');
    const rapTarget = String(config.rapTarget || '');
    if (rule.expectedEvoEntity && evoEntity !== rule.expectedEvoEntity) {
      push(VIOLATION_CODES.ENTITY_AMBIGUOUS, { resource: rule.resource, expectedEvoEntity: rule.expectedEvoEntity, actual: evoEntity, why: rule.why });
    }
    if (rule.forbiddenEvoEntity && rule.forbiddenEvoEntity.test(evoEntity)) {
      push(VIOLATION_CODES.ENTITY_AMBIGUOUS, { resource: rule.resource, actual: evoEntity, why: rule.why });
    }
    if (rule.expectedRapTarget && rapTarget !== rule.expectedRapTarget) {
      push(VIOLATION_CODES.ENTITY_AMBIGUOUS, { resource: rule.resource, expectedRapTarget: rule.expectedRapTarget, actual: rapTarget, why: rule.why });
    }
    if (rule.forbiddenRapTarget && rule.forbiddenRapTarget.test(rapTarget) && !/NUNCA|never/i.test(rapTarget)) {
      push(VIOLATION_CODES.ENTITY_AMBIGUOUS, { resource: rule.resource, rapTarget, why: rule.why });
    }
  }

  // Host "oficial" só pode ser declarado com fonte oficial que o autorize.
  const hostPolicy = contract._hostPolicy || {};
  if (isNonEmptyString(hostPolicy.officialHost)) {
    const authorized = Array.isArray(hostPolicy.allowlist)
      && hostPolicy.allowlist.some((entry) => entry && entry.host === hostPolicy.officialHost && isNonEmptyString(entry.source));
    if (!authorized) {
      push(VIOLATION_CODES.HOST_CLAIMED_OFFICIAL_WITHOUT_SOURCE, { officialHost: hostPolicy.officialHost });
    }
  }

  // SSRF: `baseUrl` é configurável por tenant. Sem política declarada e
  // ENFORÇADA, o campo vira uma arma contra a rede interna e o metadata.
  const ssrf = contract._ssrfPolicy || {};
  if (ssrf.enabled !== true || !Array.isArray(ssrf.blockedRanges) || ssrf.blockedRanges.length === 0) {
    push(VIOLATION_CODES.SSRF_POLICY_MISSING, { enabled: ssrf.enabled ?? null });
  } else if (clientSource && !clientSource.includes(ssrf.errorCode || 'NO_ERROR_CODE')) {
    push(VIOLATION_CODES.SSRF_POLICY_NOT_ENFORCED, { errorCode: ssrf.errorCode || null });
  }

  // Estados de contrato separados: sem taxonomia, "testei local" vira "certifiquei".
  const contractStates = contract._contractStates || {};
  const declaredStates = Array.isArray(contractStates.states) ? contractStates.states : [];
  const missingStates = REQUIRED_CONTRACT_STATES.filter((state) => !declaredStates.includes(state));
  const currentStates = contractStates.current;
  if (missingStates.length > 0 || !currentStates || typeof currentStates !== 'object') {
    push(VIOLATION_CODES.CONTRACT_STATE_TAXONOMY_MISSING, { missingStates });
  }

  // Webhook: o esquema de assinatura não pode ser apresentado como documentado
  // pelo provedor quando a documentação oficial não o descreve.
  const webhook = contract.webhook || {};
  if (webhook.verificationStatus !== 'CERTIFIED' && webhook.providerDocumented === true) {
    push(VIOLATION_CODES.WEBHOOK_SCHEME_CLAIMED_PROVIDER_DOCUMENTED, {
      verificationStatus: webhook.verificationStatus || null,
      providerDocumented: webhook.providerDocumented,
    });
  }

  return { violations, status, resourceKeys };
}

function run() {
  const violations = [];
  let contract = null;

  if (!fs.existsSync(CONTRACT_PATH)) {
    violations.push({ code: VIOLATION_CODES.CONTRACT_MISSING, path: CONTRACT_PATH });
  } else {
    try {
      contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
    } catch (error) {
      violations.push({ code: VIOLATION_CODES.CONTRACT_MALFORMED, reason: error.message });
    }
  }

  let clientSource = '';
  if (fs.existsSync(CLIENT_PATH)) clientSource = fs.readFileSync(CLIENT_PATH, 'utf8');

  let supportedResources = null;
  if (fs.existsSync(ADAPTER_PATH)) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      supportedResources = require(ADAPTER_PATH).SUPPORTED_RESOURCES || null;
    } catch (error) {
      violations.push({ code: VIOLATION_CODES.STRUCTURE_INCOMPLETE, reason: 'adapter_not_loadable', detail: error.message });
    }
  }

  const result = contract
    ? validateContract(contract, { clientSource, supportedResources })
    : { violations: [] };

  const all = [...violations, ...result.violations];
  const report = {
    status: all.length === 0 ? 'PASS' : 'FAIL',
    gate: 'validate-evo-contract',
    generatedAt: new Date().toISOString(),
    commit: gitCommit(),
    contractPath: path.relative(ROOT_DIR, CONTRACT_PATH),
    certificationStatus: result.status || null,
    resources: result.resourceKeys || [],
    supportedResources: supportedResources || [],
    violationCodes: Object.values(VIOLATION_CODES),
    violations: all,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[evo-contract] status=${report.status} certificação=${report.certificationStatus} `
      + `recursos=${report.resources.length} violações=${all.length}\n`,
    );
    for (const violation of all) process.stdout.write(`  ! ${violation.code}: ${JSON.stringify(violation)}\n`);
  }

  process.exit(all.length === 0 ? 0 : 1);
}

if (require.main === module) {
  run();
}

module.exports = {
  run,
  validateContract,
  VIOLATION_CODES,
  CERTIFICATION_STATES,
  CONTRACT_PATH,
  CLIENT_PATH,
  ADAPTER_PATH,
  REPORT_PATH,
};
