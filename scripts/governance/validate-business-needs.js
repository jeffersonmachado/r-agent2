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

const issues = [];

function addIssue(severity, category, message, detail = {}) {
  issues.push({ severity, category, message, ...detail });
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

  for (const journey of journeys) {
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
      addIssue('warning', 'business-journey-low-confidence',
        `Jornada "${journey.id}" com confiança baixa (${Math.round(journey.confidence * 100)}%) — validação de contrato fraca`,
        { journey: journey.id, confidence: journey.confidence }
      );
    }
    if (journey.missingCapabilities.length > 0) {
      addIssue('critical', 'business-journey-missing-caps',
        `Jornada "${journey.id}" com capabilities faltantes: ${journey.missingCapabilities.join(', ')}`,
        { journey: journey.id, missingCaps: journey.missingCapabilities }
      );
    }
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

module.exports = { run };
