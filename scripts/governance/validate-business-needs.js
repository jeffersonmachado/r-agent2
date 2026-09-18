'use strict';

const fs = require('fs');
const path = require('path');
const {
  ROOT,
  REPORTS_DIR,
  exists,
  readJson,
  writeReport,
} = require('./common');

// Fórmula CANÔNICA da confiança — importada do gerador, nunca duplicada.
// Duas fórmulas seriam duas verdades; a do contrato é esta.
const { computeConfidenceFromCounts } = require('../qa-waves/generate-business-contracts');

const issues = [];

function addIssue(severity, category, message, detail = {}) {
  issues.push({ severity, category, message, ...detail });
}

/**
 * Cenários VINCULADOS explicitamente a cada jornada — a MESMA entrada da
 * fórmula canônica de confiança (`countJourneyScenarios` no gerador).
 *
 * Distinção que custou uma investigação inteira (2026-09-18): o validador casa
 * cenários também por DOMÍNIO, então uma jornada pode ter "259 cenários" no
 * match amplo e apenas 1 cenário vinculado ao contrato. Citar o número amplo ao
 * lado de "contrato fraco" é enganoso — o que a confiança mede é o vínculo
 * explícito.
 *
 * @returns {Record<string, number>} journeyId → quantidade de cenários vinculados
 */
function loadLinkedScenarioCounts() {
  const coverageDir = path.join(ROOT, 'qa-waves', 'journey-coverage');
  const counts = {};
  let files = [];
  try {
    files = fs.readdirSync(coverageDir).filter((name) => name.endsWith('.json'));
  } catch (_) {
    return counts;
  }
  for (const name of files) {
    const data = readJson(`qa-waves/journey-coverage/${name}`, null);
    for (const journey of (data && data.journeys) || []) {
      if (!journey || !journey.journey) continue;
      counts[journey.journey] = (counts[journey.journey] || 0) + (journey.scenarios || []).length;
    }
  }
  return counts;
}

/**
 * Jornadas de NEGÓCIO canônicas.
 *
 * `config/business-journey-catalog.json` declara-se a autoridade: "Catálogo
 * operacional de jornadas de negócio ... Nenhum identificador técnico (wave,
 * cenário, seed, replay, passo de RPA, rota interna) pertence a este arquivo".
 *
 * `config/journey-contracts.json`, porém, tem contratos para 97 ids — e a maioria
 * é DERIVADA de módulo/domínio/capability, cada uma com UM cenário placeholder
 * (ex.: `orders` → `business-core-cap-scheduling`, steps `["Tenant autenticado"]`).
 * Aplicar a regra de CONTRATO DE NEGÓCIO a essa população produzia avisos
 * permanentes que escondiam os casos reais: medido em 2026-09-18, 70 avisos de
 * baixa confiança dos quais só 2 eram jornadas de negócio (`campaigns`, `billing`)
 * e 68 eram entradas derivadas que nunca cruzarão 0,7 sem vínculo fabricado.
 *
 * @returns {Set<string>} ids canônicos de jornada de negócio
 */
function loadBusinessJourneyIds() {
  const catalog = readJson('config/business-journey-catalog.json', null);
  return new Set(Object.keys((catalog && catalog.journeys) || {}));
}

/**
 * Predicado PURO de escopo: a regra de negócio se aplica a esta jornada?
 * Exportado para prova por teste sem tocar o disco.
 */
function isBusinessJourneyId(journeyId, businessJourneyIds) {
  return Boolean(businessJourneyIds && businessJourneyIds.has && businessJourneyIds.has(String(journeyId)));
}

/**
 * Nomeia os DRIVERS medidos da baixa confiança.
 *
 * A mensagem anterior dizia só o veredito ("validação de contrato fraca") e
 * omitia a causa. Um aviso que não nomeia o driver não é acionável. Função PURA
 * (sem I/O), provada por teste sem tocar o disco.
 *
 * @param {{linkedScenarioCount?: (number|null), requiredCapabilities?: string[], hasDirectMatch?: boolean}} journey
 * @returns {string}
 */
function describeLowConfidenceDrivers(journey = {}) {
  const requiredCapabilities = Array.isArray(journey.requiredCapabilities) ? journey.requiredCapabilities : [];
  const linked = journey.linkedScenarioCount;
  const drivers = [];
  if (typeof linked === 'number' && linked < 5) drivers.push(`${linked}/5 cenários vinculados`);
  if (requiredCapabilities.length < 6) drivers.push(`${requiredCapabilities.length}/6 capabilities`);
  if (journey.hasDirectMatch === false) drivers.push('sem match direto de jornada');
  return drivers.length > 0 ? drivers.join(', ') : 'sem driver identificado';
}

// ── 1. Ler contratos de jornada ─────────────────────────────────────
function loadJourneyContracts() {
  const contracts = readJson('config/journey-contracts.json', null);
  if (!contracts || !contracts.journeys) return [];
  return Object.entries(contracts.journeys).map(([id, j]) => ({
    id,
    requiredCapabilities: j.requiredCapabilities || [],
    missingCapabilities: j.missingCapabilities || [],
    confidence: j.confidence || 0,
  }));
}

// ── 2. Ler precondições ─────────────────────────────────────────────
function loadPreconditions() {
  return readJson('config/journey-preconditions.json', null) || {};
}

// ── 3. Ler dependências de capabilities ─────────────────────────────
function loadCapabilityDeps() {
  const deps = readJson('config/capability-dependencies.json', null);
  return deps?.dependencies || {};
}

// ── 4. Ler cenários QA (meshRegistry + scenario-store) ──────────────
function loadQaScenarios() {
  const meshReg = readJson('qa-mesh/meshRegistry.json', null);
  const scenarioStore = readJson('qa/qa-waves/scenario-store.json', null);

  const scenarios = [];

  if (Array.isArray(meshReg)) {
    for (const s of meshReg) {
      scenarios.push({
        id: s.id,
        domain: s.domain || 'core',
        type: s.type || 'technical',
        adapter: s.adapter || 'api',
        flow: s.flow || s.id,
        assertions: s.assertions || [],
      });
    }
  }

  // scenario-store pode ser array direto ou { scenarios: [...] }
  const storeScenarios = Array.isArray(scenarioStore)
    ? scenarioStore
    : (scenarioStore?.scenarios || []);

  for (const s of storeScenarios) {
    scenarios.push({
      id: s.id,
      domain: s.vertical || s.domain || 'core',
      type: s.source?.includes('e2e') ? 'e2e' : (s.type || 'business'),
      adapter: s.steps?.[0]?.adapter || 'api',
      flow: s.name || s.id,
    });
  }

  return scenarios;
}

// ── 5. Mapear cenários QA para journeys de negócio ──────────────────
function mapScenariosToBusinessJourneys(qaScenarios, journeys) {
  const mapping = {};
  // Evidência VIVA do vínculo de contrato (mesma entrada da fórmula canônica).
  const linkedScenarioCounts = loadLinkedScenarioCounts();
  // Escopo da regra de NEGÓCIO (ver loadBusinessJourneyIds): só as jornadas do
  // catálogo são medidas pela régua de contrato de negócio.
  const businessJourneyIds = loadBusinessJourneyIds();
  const derivedLowConfidence = [];

  for (const journey of journeys) {
    const inBusinessScope = isBusinessJourneyId(journey.id, businessJourneyIds);
    const journeyCaps = new Set(journey.requiredCapabilities);
    const matchingScenarios = [];

    for (const scenario of qaScenarios) {
      const sId = (scenario.id || '').toLowerCase();
      const sFlow = (scenario.flow || '').toLowerCase();
      const sDomain = (scenario.domain || '').toLowerCase();
      const jId = journey.id.toLowerCase();

      // Match por nome da jornada no ID/flow do cenário
      const journeyKeywords = jId.replace(/_/g, ' ').split(' ');
      const nameMatch = journeyKeywords.some(kw => {
        const kwNorm = kw.replace(/_/g, '');
        return sId.replace(/_/g, '').includes(kwNorm) || sFlow.replace(/_/g, '').includes(kwNorm);
      });

      // Match por capabilities requeridas
      const sIdNormalized = sId.replace(/_/g, '');
      const sFlowNormalized = sFlow.replace(/_/g, '');
      const capMatch = journey.requiredCapabilities.some(cap => {
        const capLower = cap.toLowerCase().replace(/_/g, '');
        return sIdNormalized.includes(capLower) || sFlowNormalized.includes(capLower) ||
               (scenario.assertions || []).some(a =>
                 a.toLowerCase().replace(/_/g, '').includes(capLower)
               );
      });

      // Match por domínio
      const domainMap = {
        fitness_customer_checkin: 'fitness',
        omnichannel_engagement: 'omnichannel',
        support_ticket_flow: 'core',
        booking_flow: 'core',
        payment_charge_flow: 'core',
      };
      const domainMatch = sDomain === (domainMap[journey.id] || 'core');

      // E2E ou business scenarios são mais relevantes
      const isBusinessScenario = scenario.type === 'business' || scenario.type === 'e2e';

      if (nameMatch || capMatch) {
        matchingScenarios.push({
          id: scenario.id,
          type: scenario.type,
          adapter: scenario.adapter,
          isE2E: isBusinessScenario,
          matchType: nameMatch && capMatch ? 'both' : nameMatch ? 'name' : 'capability',
        });
      } else if (domainMatch && isBusinessScenario) {
        matchingScenarios.push({
          id: scenario.id,
          type: scenario.type,
          adapter: scenario.adapter,
          isE2E: true,
          matchType: 'domain',
        });
      }
    }

    // Determinar qualidade da cobertura
    const e2eScenarios = matchingScenarios.filter(s => s.isE2E);
    const hasE2E = e2eScenarios.length > 0;
    const hasDirectMatch = matchingScenarios.some(s => s.matchType === 'both' || s.matchType === 'name');

    // Verificar capabilities cobertas
    const coveredCaps = new Set();
    for (const s of matchingScenarios) {
      const sIdNorm = s.id.toLowerCase().replace(/_/g, '');
      const scenarioObj = qaScenarios.find(qs => qs.id === s.id);
      const sFlowNorm = (scenarioObj?.flow || '').toLowerCase().replace(/_/g, '');
      for (const cap of journey.requiredCapabilities) {
        const capLower = cap.toLowerCase().replace(/_/g, '');
        if (sIdNorm.includes(capLower) || sFlowNorm.includes(capLower)) {
          coveredCaps.add(cap);
        }
      }
    }
    const uncoveredCaps = journey.requiredCapabilities.filter(c => !coveredCaps.has(c));

    mapping[journey.id] = {
      journey: journey.id,
      isBusinessJourney: inBusinessScope,
      requiredCapabilities: journey.requiredCapabilities,
      confidence: journey.confidence,
      scenarioCount: matchingScenarios.length,
      e2eScenarioCount: e2eScenarios.length,
      hasE2E,
      hasDirectMatch,
      coveredCapabilities: [...coveredCaps],
      uncoveredCapabilities: uncoveredCaps,
      coverageQuality: hasE2E ? 'good' : (matchingScenarios.length > 0 ? 'partial' : 'none'),
      scenarios: matchingScenarios.map(s => s.id),
    };

    // Issues
    //
    // Guarda de INTEGRIDADE da confiança: ela é um CACHE derivado de (cenários
    // vinculados, capabilities). Se o cache diverge do que a cobertura atual
    // produz, o número que o gate usa está errado — e isso precisa aparecer.
    // Fica FORA do bloco de baixa confiança de propósito: o drift típico
    // aparece justamente em jornada BEM coberta (cache antigo, cobertura nova),
    // que nunca entraria naquele bloco. Enquanto isso foi aninhado, o guard não
    // via as 2 jornadas com drift real.
    const linkedScenarioCount = linkedScenarioCounts[journey.id];
    const hasLinkedEvidence = typeof linkedScenarioCount === 'number';
    const recomputedConfidence = hasLinkedEvidence
      ? computeConfidenceFromCounts(linkedScenarioCount, journey.requiredCapabilities)
      : null;
    if (recomputedConfidence !== null && Math.abs(recomputedConfidence - journey.confidence) > 0.005) {
      addIssue('warning', 'business-journey-confidence-drift',
        `Jornada "${journey.id}": confiança armazenada (${journey.confidence}) diverge da recalculada pela cobertura atual (${recomputedConfidence})`
        + ` [cenários vinculados: ${linkedScenarioCount}, capabilities: ${journey.requiredCapabilities.length}] — regenerar os contratos (npm run qa:business-contracts)`,
        {
          journey: journey.id,
          storedConfidence: journey.confidence,
          recomputedConfidence,
          linkedScenarioCount,
          requiredCapabilities: journey.requiredCapabilities.length,
        }
      );
    }

    if (!hasE2E) {
      addIssue('error', 'business-journey-no-e2e',
        `Jornada de negócio "${journey.id}" sem cenário E2E — ${journey.requiredCapabilities.length} capabilities sem validação fim-a-fim`,
        { journey: journey.id, requiredCaps: journey.requiredCapabilities.length, confidence: journey.confidence }
      );
    }
    if (uncoveredCaps.length > 0) {
      addIssue('warning', 'business-journey-cap-gap',
        `Jornada "${journey.id}": ${uncoveredCaps.length} capabilities sem cenário QA específico: ${uncoveredCaps.join(', ')}`,
        { journey: journey.id, uncoveredCaps }
      );
    }
    if (journey.confidence < 0.7) {
      if (!inBusinessScope) {
        // Entrada DERIVADA (módulo/domínio/capability): a confiança de contrato
        // de NEGÓCIO não é a régua dela. Reportada de forma AGREGADA logo abaixo
        // — o dado continua visível, o que sai é o ruído de 68 avisos que
        // escondia `campaigns`/`billing`.
        derivedLowConfidence.push({
          journey: journey.id,
          confidence: journey.confidence,
          linkedScenarioCount: hasLinkedEvidence ? linkedScenarioCount : null,
          requiredCapabilities: journey.requiredCapabilities.length,
        });
      } else {
        // O aviso de baixa confiança é sobre o VÍNCULO EXPLÍCITO do contrato —
        // nunca sobre o match amplo por domínio (que casa centenas de cenários e
        // não diz nada sobre a força do contrato).
        addIssue('warning', 'business-journey-low-confidence',
          `Jornada de negócio "${journey.id}" com confiança baixa (${Math.round(journey.confidence * 100)}%) — vínculo de contrato fraco`
          + ` [cenários VINCULADOS: ${hasLinkedEvidence ? linkedScenarioCount : 'n/d'}, capabilities: ${journey.requiredCapabilities.length}/6, match direto: ${hasDirectMatch ? 'sim' : 'não'}]`
          + ` — driver: ${describeLowConfidenceDrivers({ linkedScenarioCount: hasLinkedEvidence ? linkedScenarioCount : null, requiredCapabilities: journey.requiredCapabilities, hasDirectMatch })}`
          + ` | (match amplo por domínio: ${matchingScenarios.length} cenários — não é evidência de contrato)`,
          {
            journey: journey.id,
            confidence: journey.confidence,
            linkedScenarioCount: hasLinkedEvidence ? linkedScenarioCount : null,
            domainMatchCount: matchingScenarios.length,
            requiredCapabilities: journey.requiredCapabilities.length,
            hasDirectMatch,
          }
        );
      }
    }
    if (journey.missingCapabilities.length > 0) {
      addIssue('critical', 'business-journey-missing-caps',
        `Jornada "${journey.id}" com capabilities faltantes: ${journey.missingCapabilities.join(', ')}`,
        { journey: journey.id, missingCaps: journey.missingCapabilities }
      );
    }
  }

  // Um único registro AGREGADO para a população derivada: nada é escondido (o
  // número e os ids ficam no relatório), mas o sinal acionável — jornadas de
  // negócio reais com vínculo fraco — deixa de ser afogado.
  if (derivedLowConfidence.length > 0) {
    addIssue('info', 'business-journey-derived-scope',
      `${derivedLowConfidence.length} entradas DERIVADAS (módulo/domínio/capability, fora do catálogo de jornadas de negócio) com confiança de contrato < 70%`
      + ` — a régua de "contrato de negócio" não se aplica a elas; a regra é escopada por`
      + ` config/business-journey-catalog.json (autoridade: "nenhum identificador técnico pertence a este arquivo")`,
      { count: derivedLowConfidence.length, journeys: derivedLowConfidence.map((d) => d.journey) }
    );
  }

  return mapping;
}

// ── 6. Validar precondições de cada jornada ──────────────────────────
function validatePreconditions(journeys, preconditions, qaScenarios) {
  const precondReport = {};

  for (const journey of journeys) {
    const preconds = preconditions[journey.id];
    if (!preconds) {
      addIssue('warning', 'preconditions-missing',
        `Jornada "${journey.id}" sem precondições definidas`,
        { journey: journey.id }
      );
      precondReport[journey.id] = { defined: false, required: [], optional: [], covered: [] };
      continue;
    }

    const required = preconds.required || [];
    const optional = preconds.optional || [];
    const allPreconds = [...required, ...optional];

    // Verificar se há cenários QA que validam essas precondições
    const coveredPreconds = allPreconds.filter(pc => {
      const pcLower = pc.toLowerCase().replace(/_/g, '');
      return qaScenarios.some(s => {
        const sId = (s.id || '').toLowerCase().replace(/_/g, '');
        const sFlow = (s.flow || '').toLowerCase().replace(/_/g, '');
        return sId.includes(pcLower) || sFlow.includes(pcLower) ||
               (s.assertions || []).some(a => a.toLowerCase().replace(/_/g, '').includes(pcLower));
      });
    });

    const uncoveredRequired = required.filter(r => !coveredPreconds.includes(r));

    precondReport[journey.id] = {
      defined: true,
      required,
      optional,
      covered: coveredPreconds,
      uncoveredRequired,
      timeout: preconds.timeout || 30000,
    };

    if (uncoveredRequired.length > 0) {
      addIssue('error', 'preconditions-uncovered',
        `Jornada "${journey.id}": precondições obrigatórias sem validação QA: ${uncoveredRequired.join(', ')}`,
        { journey: journey.id, uncoveredRequired }
      );
    }
  }

  return precondReport;
}

// ── 7. Validar cadeia de dependências de capabilities ────────────────
function validateDependencyChain(journeys, capabilityDeps, qaScenarios) {
  const depReport = {};

  for (const journey of journeys) {
    const journeyDeps = [];
    const brokenDeps = [];

    for (const cap of journey.requiredCapabilities) {
      const deps = capabilityDeps[cap]?.dependsOn || [];
      for (const dep of deps) {
        journeyDeps.push({ capability: cap, dependsOn: dep });
        // Verificar se a dependência tem cenário QA
        const depCovered = qaScenarios.some(s => {
          const sId = (s.id || '').toLowerCase().replace(/_/g, '');
          return sId.includes(dep.toLowerCase().replace(/_/g, ''));
        });
        if (!depCovered) {
          brokenDeps.push({ capability: cap, missingDep: dep });
        }
      }
    }

    depReport[journey.id] = {
      totalDeps: journeyDeps.length,
      brokenDeps: brokenDeps.length,
      details: brokenDeps,
    };

    if (brokenDeps.length > 0) {
      addIssue('error', 'dependency-chain-broken',
        `Jornada "${journey.id}": ${brokenDeps.length} dependências de capability sem cenário QA`,
        { journey: journey.id, brokenDeps: brokenDeps.map(d => `${d.capability}→${d.missingDep}`) }
      );
    }
  }

  return depReport;
}

// ── 8. Análise de completude de negócio ──────────────────────────────
function analyzeBusinessCompleteness(journeyMapping, precondReport, depReport) {
  const analysis = {};

  for (const [journeyId, mapping] of Object.entries(journeyMapping)) {
    const preconds = precondReport[journeyId] || {};
    const deps = depReport[journeyId] || {};

    const scores = {
      scenarioCoverage: mapping.hasE2E ? 100 : (mapping.scenarioCount > 0 ? 50 : 0),
      capabilityCoverage: mapping.requiredCapabilities.length > 0
        ? Math.round((mapping.coveredCapabilities.length / mapping.requiredCapabilities.length) * 100)
        : 100,
      preconditionCoverage: preconds.required?.length > 0
        ? Math.round(((preconds.required.length - (preconds.uncoveredRequired?.length || 0)) / preconds.required.length) * 100)
        : 100,
      dependencyHealth: deps.totalDeps > 0
        ? Math.round(((deps.totalDeps - deps.brokenDeps) / deps.totalDeps) * 100)
        : 100,
    };

    const businessScore = Math.round(
      (scores.scenarioCoverage + scores.capabilityCoverage + scores.preconditionCoverage + scores.dependencyHealth) / 4
    );

    const risk = businessScore >= 80 ? 'low' : businessScore >= 50 ? 'medium' : 'high';
    const gaps = [];
    if (!mapping.hasE2E) gaps.push('sem cenário E2E');
    if (mapping.uncoveredCapabilities.length > 0) gaps.push(`${mapping.uncoveredCapabilities.length} caps sem cobertura`);
    if ((preconds.uncoveredRequired?.length || 0) > 0) gaps.push(`${preconds.uncoveredRequired.length} precondições sem validação`);
    if (deps.brokenDeps > 0) gaps.push(`${deps.brokenDeps} deps quebradas`);

    analysis[journeyId] = {
      journey: journeyId,
      businessScore,
      risk,
      scores,
      requiredCapabilities: mapping.requiredCapabilities.length,
      confidence: mapping.confidence,
      gaps,
      assessment: risk === 'low'
        ? 'Jornada bem coberta — cenários E2E + capabilities + precondições + dependências'
        : risk === 'medium'
          ? 'Jornada parcialmente coberta — gaps de validação de negócio'
          : 'Jornada com cobertura de negócio insuficiente — gaps críticos',
    };
  }

  return analysis;
}

// ── Main ─────────────────────────────────────────────────────────────
function run() {
  console.log('[business-needs] Validando cobertura de necessidades de negócio...\n');

  const journeys = loadJourneyContracts();
  const preconditions = loadPreconditions();
  const capabilityDeps = loadCapabilityDeps();
  const qaScenarios = loadQaScenarios();

  console.log(`📊 Fontes:`);
  console.log(`   Journeys de negócio:  ${journeys.length}`);
  console.log(`   Precondições:         ${Object.keys(preconditions).length} jornadas`);
  console.log(`   Dependências de caps: ${Object.keys(capabilityDeps).length} capabilities`);
  console.log(`   Cenários QA:          ${qaScenarios.length}\n`);

  // Mapear cenários para journeys
  const journeyMapping = mapScenariosToBusinessJourneys(qaScenarios, journeys);

  // Validar precondições
  const precondReport = validatePreconditions(journeys, preconditions, qaScenarios);

  // Validar cadeia de dependências
  const depReport = validateDependencyChain(journeys, capabilityDeps, qaScenarios);

  // Análise consolidada
  const businessAnalysis = analyzeBusinessCompleteness(journeyMapping, precondReport, depReport);

  // Estatísticas
  const goodJourneys = Object.values(businessAnalysis).filter(a => a.risk === 'low').length;
  const partialJourneys = Object.values(businessAnalysis).filter(a => a.risk === 'medium').length;
  const riskyJourneys = Object.values(businessAnalysis).filter(a => a.risk === 'high').length;
  const avgBusinessScore = journeys.length > 0
    ? Math.round(Object.values(businessAnalysis).reduce((sum, a) => sum + a.businessScore, 0) / journeys.length)
    : 0;

  const criticals = issues.filter(i => i.severity === 'critical').length;
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;

  console.log('═══ Necessidades de Negócio ═══');
  console.log(`   Score médio:       ${avgBusinessScore}%`);
  console.log(`   Journeys OK:       ${goodJourneys} ✅`);
  console.log(`   Journeys parciais: ${partialJourneys} ⚠️`);
  console.log(`   Journeys em risco: ${riskyJourneys} 🔴`);
  console.log(`   Issues:            ${criticals} críticos, ${errors} erros, ${warnings} avisos\n`);

  console.log('═══ Análise por Jornada de Negócio ═══');
  for (const [id, a] of Object.entries(businessAnalysis).sort((a, b) => a[1].businessScore - b[1].businessScore)) {
    const icon = a.risk === 'low' ? '✅' : a.risk === 'medium' ? '⚠️' : '🔴';
    console.log(`  ${icon} ${id.padEnd(32)} ${String(a.businessScore).padStart(3)}% | conf:${Math.round(a.confidence * 100)}% | caps:${a.requiredCapabilities} | E2E:${journeyMapping[id]?.e2eScenarioCount || 0}`);
    if (a.gaps.length > 0) {
      console.log(`     Gaps: ${a.gaps.join(' | ')}`);
    }
  }

  // Top issues
  if (issues.length > 0) {
    console.log(`\n═══ Issues de Negócio (${issues.length}) ═══`);
    for (const issue of issues.slice(0, 10)) {
      const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'error' ? '🟠' : '🟡';
      console.log(`  ${icon} [${issue.category}] ${issue.message}`);
    }
  }

  const status = criticals > 0 ? 'FAIL' : errors > 0 ? 'FAIL' : warnings > 3 ? 'WARN' : 'PASS';

  const report = {
    name: 'business-needs-validation',
    status,
    generatedAt: new Date().toISOString(),
    summary: {
      totalJourneys: journeys.length,
      goodJourneys,
      partialJourneys,
      riskyJourneys,
      averageBusinessScore: avgBusinessScore,
      criticals,
      errors,
      warnings,
    },
    businessAnalysis,
    journeyMapping,
    precondReport,
    depReport,
    issues: issues.slice(0, 100),
  };

  const outPath = writeReport('business-needs-report.json', report);
  console.log(`\n📄 Relatório: ${outPath}`);

  return status === 'FAIL' ? 1 : 0;
}

if (require.main === module) {
  process.exit(run());
}

module.exports = { run, describeLowConfidenceDrivers, loadLinkedScenarioCounts, loadBusinessJourneyIds, isBusinessJourneyId };
