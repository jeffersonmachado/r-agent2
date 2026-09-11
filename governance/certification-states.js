'use strict';

/**
 * certification-states.js — PRODUTOR CANÔNICO dos estados de certificação
 * separados (§37–§42, §46, §55 do hardening final).
 *
 * Problema que isto resolve: existem DOIS produtores de
 * `governance/final-readiness-report.json` —
 *
 *   1. `tools/system/platform-readiness.js` (relatório completo, offline);
 *   2. `governance/export-governance-artifacts.js` (projeção derivada do run
 *      persistido, executada pelo fixpoint de governança).
 *
 * Quando a separação de estados vive só em (1), a convergência de governança
 * sobrescreve o artefato com (2) e a distinção
 * CORE / VERTICAL-IMPLEMENTATION / VERTICAL-MARKET / INTEGRATION-CONTRACT /
 * LIVE-PROVIDER desaparece — o "100%" volta a ser uma afirmação sem sujeito.
 *
 * Por isso a construção é ÚNICA, pura e consumida pelos dois produtores.
 *
 * Invariante: nenhum estado é derivado de outro. `verticalImplementationReadiness`
 * alto NÃO melhora `verticalMarketCertification`; `LOCAL_CONTRACT_TESTED` NÃO é
 * `LIVE_CERTIFIED`.
 */

const fs = require('fs');
const path = require('path');

/** Certificação de mercado por vertical — estados do engine de suficiência. */
const MARKET_CERTIFIED_STATE = 'SAMPLE_SUFFICIENT';
const MARKET_UNRESEARCHED_STATE = 'NOT_RESEARCHED';

function readJsonIfExists(absPath) {
  try {
    if (!fs.existsSync(absPath)) return null;
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * @param {object} params
 * @param {string} [params.rootDir]
 * @param {string[]} params.requiredVerticals verticais exigidas pela plataforma
 * @param {Array<{vertical: string, implemented: boolean}>} [params.verticals]
 * @param {number|null} [params.verticalCoveragePercent]
 * @param {number|null} [params.readinessScore]
 * @param {boolean} [params.coreReady] resultado do núcleo (mesh/score)
 * @param {string[]} [params.coreDoesNotInclude]
 * @returns {object} bloco `certificationStates` pronto para persistir
 */
function buildCertificationStates({
  rootDir = process.cwd(),
  requiredVerticals = [],
  verticals = null,
  verticalCoveragePercent = null,
  readinessScore = null,
  coreReady = false,
  coreDoesNotInclude = ['market research', 'integração live com provedor', 'pesquisa de concorrentes'],
} = {}) {
  const benchmarkReport = readJsonIfExists(path.join(rootDir, 'reports', 'benchmark-sufficiency-report.json'));
  const evoReport = readJsonIfExists(path.join(rootDir, 'reports', 'evo-contract-report.json'));
  const evoContract = readJsonIfExists(path.join(rootDir, 'config', 'integrations', 'evo-contract.json'));

  const required = Array.isArray(requiredVerticals) ? requiredVerticals.slice() : [];
  // "não informado" ≠ "informado e vazio": sem a lista de verticais não existe
  // medição, e publicar 0/N seria uma AFIRMAÇÃO FALSA (o pior tipo, porque
  // parece um número). Sem fonte, os campos saem null.
  const hasVerticals = Array.isArray(verticals);
  const implemented = hasVerticals
    ? verticals.filter((item) => item && item.implemented).map((item) => item.vertical)
    : [];
  const denominator = required.length > 0 ? required.length : null;
  const numerator = !hasVerticals || denominator === null
    ? null
    : implemented.filter((vertical) => required.includes(vertical)).length;
  // ATENÇÃO: `Number(null) === 0` — coagir antes de checar nulidade publicaria
  // "0%" como se fosse medição. O guard de null/undefined vem PRIMEIRO.
  const declaredPercent = verticalCoveragePercent === null || verticalCoveragePercent === undefined
    ? null
    : Number(verticalCoveragePercent);
  const percent = Number.isFinite(declaredPercent)
    ? declaredPercent
    : (numerator !== null && denominator ? Math.round((numerator / denominator) * 100) : null);

  // 1. CORE PLATFORM READINESS — independe de pesquisa de mercado.
  const corePlatformReadiness = {
    state: coreReady ? 'CORE_GO' : 'CORE_NOT_GO',
    score: Number.isFinite(Number(readinessScore)) ? Number(readinessScore) : null,
    scope: 'plataforma (docs, QA mesh, QA waves, replay, verticais implementadas, validação production-like)',
    doesNotInclude: coreDoesNotInclude,
  };

  // 2. VERTICAL IMPLEMENTATION READINESS — implementação, NÃO cobertura de mercado.
  const verticalImplementationReadiness = {
    label: 'VERTICAL_IMPLEMENTATION_COVERAGE',
    legacyLabel: 'verticalCoverage',
    semanticNote: 'Cobertura de IMPLEMENTAÇÃO das verticais exigidas pela plataforma. NÃO é cobertura das necessidades de mercado das verticais.',
    numerator,
    denominator,
    percent,
    unit: 'verticals',
    coveredVerticals: hasVerticals ? implemented : null,
    requiredVerticals: required,
  };

  // 3. VERTICAL MARKET BENCHMARK CERTIFICATION — pesquisa de mercado real.
  const perVertical = {};
  for (const vertical of required) {
    const found = benchmarkReport && Array.isArray(benchmarkReport.verticals)
      ? benchmarkReport.verticals.find((item) => item.vertical === vertical)
      : null;
    perVertical[vertical] = found ? found.status : MARKET_UNRESEARCHED_STATE;
  }
  const certifiedVerticals = Object.values(perVertical).filter((state) => state === MARKET_CERTIFIED_STATE).length;
  const verticalMarketCertification = {
    state: denominator !== null && certifiedVerticals === denominator
      ? 'VERTICAL_MARKET_CERTIFIED'
      : 'VERTICAL_MARKET_NOT_CERTIFIED',
    certifiedVerticals,
    requiredVerticals: denominator,
    perVertical,
    source: 'reports/benchmark-sufficiency-report.json',
    semanticNote: 'Certificação de MERCADO exige amostra de benchmarks suficiente e holdout analisado. Cobertura de implementação NÃO substitui esta prova.',
  };

  // 4. INTEGRATION CONTRACT CERTIFICATION — dialeto/contrato, não integração live.
  const states = (evoContract && evoContract._contractStates && evoContract._contractStates.current) || {};
  const integrationContractCertification = {
    providers: {
      evo: {
        contractState: {
          OFFICIAL_DOCS_VERIFIED: states.OFFICIAL_DOCS_VERIFIED === true,
          LOCAL_CONTRACT_TESTED: states.LOCAL_CONTRACT_TESTED === true,
          AWAITING_LIVE_CERTIFICATION: states.AWAITING_LIVE_CERTIFICATION === true,
          LIVE_CERTIFIED: states.LIVE_CERTIFIED === true,
        },
        OFFICIAL_DOCS_VERIFIED: states.OFFICIAL_DOCS_VERIFIED === true,
        LOCAL_CONTRACT_TESTED: states.LOCAL_CONTRACT_TESTED === true,
        LIVE_CERTIFIED: states.LIVE_CERTIFIED === true,
        gate: evoReport ? evoReport.status : 'UNKNOWN',
        certificationStatus: evoReport
          ? evoReport.certificationStatus
          : ((evoContract && evoContract._certification && evoContract._certification.status) || 'UNKNOWN'),
        liveVerified: false,
        mustNotClaim: (evoContract && evoContract._certification && evoContract._certification.mustNotClaim) || 'LIVE VERIFIED',
      },
    },
    semanticNote: 'Contrato local testado NUNCA é certificação live. Sem credencial real, o estado máximo é AWAITING_LIVE_CERTIFICATION.',
  };

  // 5. LIVE PROVIDER CERTIFICATION — depende de credencial real e fluxo real.
  const liveCertified = integrationContractCertification.providers.evo.LIVE_CERTIFIED === true;
  const liveProviderCertification = {
    state: liveCertified ? 'CERTIFIED' : 'PENDING',
    providers: { evo: liveCertified ? 'CERTIFIED' : 'PENDING' },
    reason: liveCertified
      ? 'Certificação live registrada no contrato do provedor.'
      : 'Nenhuma credencial real de provedor foi fornecida: não existe certificação live possível.',
    requires: [
      'Credencial real do provedor (DNS da academia + Secret Key).',
      'Smoke de certificação com UMA pessoa real, executado duas vezes (idempotência).',
      'Sync inicial da unidade com 0 duplicados de attendance e 0 duplicados financeiros.',
    ],
  };

  return {
    corePlatformReadiness,
    verticalImplementationReadiness,
    verticalMarketCertification,
    integrationContractCertification,
    liveProviderCertification,
    _invariant: 'Estes cinco estados são INDEPENDENTES. Nenhum relatório pode consolidá-los em um único "100%".',
  };
}

module.exports = {
  buildCertificationStates,
  MARKET_CERTIFIED_STATE,
  MARKET_UNRESEARCHED_STATE,
};
