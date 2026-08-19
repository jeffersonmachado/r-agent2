'use strict';

const fs = require('fs');
const path = require('path');
const {
  ROOT,
  REPORTS_DIR,
  exists,
  readText,
  readJson,
  listFiles,
  writeReport,
} = require('./common');

const issues = [];
const coverage = {};

// ── Helpers ──────────────────────────────────────────────────────────
function addIssue(severity, category, message, detail = {}) {
  issues.push({ severity, category, message, ...detail });
}

function normalizeId(str) {
  return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

// ── Domínios canônicos (HARD-009 / FASE 9) ──────────────────────────
// config/verticals.json é a fonte única de IDs de domínio/vertical.
// IDs legados/localizados (mercado, clinica, servicos, retail...) são
// resolvidos para o ID canônico via aliases — nunca convivem como
// domínios distintos neste relatório.
const VERTICALS_REGISTRY = readJson('config/verticals.json', null);
const DOMAIN_ALIAS_TO_CANONICAL = (() => {
  const map = new Map();
  if (VERTICALS_REGISTRY && VERTICALS_REGISTRY.domains) {
    for (const [canonical, def] of Object.entries(VERTICALS_REGISTRY.domains)) {
      map.set(canonical, canonical);
      for (const alias of (def.aliases || [])) {
        map.set(String(alias).toLowerCase(), canonical);
      }
    }
  }
  return map;
})();

function canonicalDomain(domain) {
  const key = String(domain || 'core').toLowerCase();
  return DOMAIN_ALIAS_TO_CANONICAL.get(key) || key;
}

// ── 1. Extrair rotas do frontend ────────────────────────────────────
function extractFrontendRoutes() {
  if (!exists('frontend/src/main.jsx')) return [];

  const content = readText('frontend/src/main.jsx');
  const routes = [];

  // Padrão: const isFoo = isRoute('/foo') ou const isFoo = currentPath === '/foo'
  const patterns = [
    /const\s+is([A-Z][a-zA-Z]+)\s*=\s*isRoute\(['"]([^'"]+)['"]\)/g,
    /const\s+is([A-Z][a-zA-Z]+)\s*=\s*currentPath\s*===\s*['"]([^'"]+)['"]/g,
    /const\s+is([A-Z][a-zA-Z]+)\s*=\s*currentPath\.startsWith\(['"]([^'"]+)['"]/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const varName = match[1];
      const routePath = match[2];
      // Pular sub-rotas de projetos (já cobertas por /projects)
      if (varName.startsWith('Project') && varName !== 'Projects') continue;
      if (varName === 'SaasLanding' || varName === 'SaasProducts' || varName === 'SaasSolutions' || varName === 'SaasPricing' || varName === 'SaasSignup') continue;
      // Pular aliases
      if (varName === 'RpaReplaysAlias' || varName === 'SystemStatusAlias') continue;
      // Pular login e saas
      if (varName === 'Login') continue;

      const id = normalizeId(routePath);
      if (!routes.find(r => r.id === id)) {
        routes.push({
          id,
          path: routePath,
          varName,
          area: routePath.split('/')[1] || 'root',
        });
      }
    }
  }

  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

// ── 2. Extrair módulos da API ───────────────────────────────────────
function extractApiModules() {
  const modules = [];

  // composition/ — cada diretório é um módulo com rotas
  if (exists('api/composition/')) {
    const dirs = fs.readdirSync(path.join(ROOT, 'api', 'composition'), { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    for (const dir of dirs) {
      modules.push({
        id: normalizeId(dir),
        name: dir,
        source: 'api/composition',
        routes: [],
      });

      // Verificar arquivos de rota dentro do módulo
      const modPath = path.join(ROOT, 'api', 'composition', dir);
      try {
        const files = listFiles(`api/composition/${dir}`).filter(f => f.endsWith('.js'));
        for (const file of files) {
          const base = path.basename(file, '.js');
          if (base === 'index') continue;
          modules[modules.length - 1].routes.push(`/api/${dir}/${base}`);
        }
      } catch (_) {}
    }
  }

  // modules/ — cada diretório tem rotas registradas
  if (exists('api/modules/')) {
    const dirs = fs.readdirSync(path.join(ROOT, 'api', 'modules'), { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    for (const dir of dirs) {
      const id = normalizeId(dir);
      if (!modules.find(m => m.id === id)) {
        modules.push({
          id,
          name: dir,
          source: 'api/modules',
          routes: [],
        });
      }
    }
  }

  // routes/ — arquivos de rota soltos
  if (exists('api/routes/')) {
    try {
      const files = listFiles('api/routes').filter(f => f.endsWith('.js'));
      for (const file of files) {
        const base = path.basename(file, '.js');
        modules.push({
          id: normalizeId(base),
          name: base,
          source: 'api/routes',
          routes: [],
        });
      }
    } catch (_) {}
  }

  return modules.sort((a, b) => a.name.localeCompare(b.name));
}

// ── 3. Extrair capabilities do registry ─────────────────────────────
function extractCapabilities() {
  const reg = readJson('config/capabilities-registry.json', null);
  if (!reg || !Array.isArray(reg.capabilities)) return [];

  return reg.capabilities.map(c => ({
    id: c.id,
    domain: canonicalDomain(c.domain || 'core'),
    type: c.type || 'operational',
    required: c.required !== false,
    confidence: c.confidence || 0,
    sources: c.sources || [],
    tags: c.tags || [],
  }));
}

// ── 4. Extrair cenários QA ──────────────────────────────────────────
function extractQaScenarios() {
  const reg = readJson('qa-mesh/meshRegistry.json', null);
  if (!Array.isArray(reg)) return [];

  return reg.map(s => ({
    id: s.id,
    domain: canonicalDomain(s.domain || 'core'),
    type: s.type || 'technical',
    adapter: s.adapter || 'api',
    criticality: s.criticality || 'medium',
    flow: s.flow || s.id,
    assertions: s.assertions || [],
  }));
}

// ── 5. Cruzamento: rota frontend → cenário QA ───────────────────────
function crossReferenceRoutesToScenarios(frontendRoutes, qaScenarios) {
  const routeCoverage = {};

  for (const route of frontendRoutes) {
    const routeDomain = mapPathToDomain(route.path);

    // Match direto: o ID do cenário contém o nome da rota (ex: "beauty-campaigns" ↔ "/beauty/campaigns")
    const directMatches = qaScenarios.filter(s => {
      const sId = normalizeId(s.id);
      const rId = normalizeId(route.id);
      // Match exato ou contido
      return sId === rId || sId.includes(rId) || rId.includes(sId);
    });

    // Match por domínio (mais fraco)
    const domainMatches = qaScenarios.filter(s => s.domain === routeDomain);

    const allMatches = [...new Set([...directMatches, ...domainMatches])];

    routeCoverage[route.path] = {
      path: route.path,
      domain: routeDomain,
      directScenarioCount: directMatches.length,
      domainScenarioCount: domainMatches.length,
      totalScenarioCount: allMatches.length,
      directScenarios: directMatches.map(s => s.id),
      covered: allMatches.length > 0,
      coverageQuality: directMatches.length > 0 ? 'direct' : (domainMatches.length > 0 ? 'domain-only' : 'none'),
    };

    if (directMatches.length === 0 && domainMatches.length <= 1) {
      addIssue('warning', 'route-weak-coverage',
        `Rota "${route.path}" (${routeDomain}) com cobertura fraca: ${domainMatches.length} cenário(s) de domínio, 0 diretos`,
        { route: route.path, domain: routeDomain, coverageQuality: routeCoverage[route.path].coverageQuality }
      );
    }
  }

  return routeCoverage;
}

// ── 6. Cruzamento: módulo API → cenário QA ──────────────────────────
function crossReferenceApiToScenarios(apiModules, qaScenarios) {
  const apiCoverage = {};

  for (const mod of apiModules) {
    const modDomain = mapModuleToDomain(mod.name);

    const directMatches = qaScenarios.filter(s => {
      const sId = normalizeId(s.id);
      const mId = normalizeId(mod.id);
      return sId === mId || sId.includes(mId) || mId.includes(sId);
    });

    const domainMatches = qaScenarios.filter(s => s.domain === modDomain);

    const allMatches = [...new Set([...directMatches, ...domainMatches])];

    apiCoverage[mod.name] = {
      module: mod.name,
      source: mod.source,
      domain: modDomain,
      directScenarioCount: directMatches.length,
      domainScenarioCount: domainMatches.length,
      totalScenarioCount: allMatches.length,
      directScenarios: directMatches.map(s => s.id),
      covered: allMatches.length > 0,
      coverageQuality: directMatches.length > 0 ? 'direct' : (domainMatches.length > 0 ? 'domain-only' : 'none'),
    };

    if (directMatches.length === 0 && domainMatches.length === 0) {
      addIssue('error', 'api-uncovered',
        `Módulo API "${mod.name}" (${mod.source}) sem cobertura QA`,
        { module: mod.name, source: mod.source }
      );
    } else if (directMatches.length === 0 && domainMatches.length <= 2) {
      addIssue('warning', 'api-weak-coverage',
        `Módulo API "${mod.name}" (${modDomain}) com cobertura fraca: ${domainMatches.length} cenário(s) de domínio, 0 diretos`,
        { module: mod.name, domain: modDomain }
      );
    }
  }

  return apiCoverage;
}

// ── 7. Cruzamento: capability → cenário QA ──────────────────────────
function crossReferenceCapabilitiesToScenarios(capabilities, qaScenarios) {
  const capCoverage = {};

  for (const cap of capabilities) {
    const matchingScenarios = qaScenarios.filter(s => {
      const sId = normalizeId(s.id);
      const sFlow = normalizeId(s.flow || '');
      const cId = normalizeId(cap.id);
      // Match por tags
      const tagMatch = (cap.tags || []).some(tag => {
        const tId = normalizeId(tag);
        return sId.includes(tId) || sFlow.includes(tId);
      });
      // Match por domínio
      const domainMatch = s.domain === cap.domain;
      return tagMatch || domainMatch || sId.includes(cId) || sFlow.includes(cId);
    });

    capCoverage[cap.id] = {
      capability: cap.id,
      domain: cap.domain,
      type: cap.type,
      required: cap.required,
      confidence: cap.confidence,
      scenarioCount: matchingScenarios.length,
      scenarios: matchingScenarios.map(s => s.id),
      covered: matchingScenarios.length > 0,
    };

    if (matchingScenarios.length === 0 && cap.required && cap.type === 'operational') {
      addIssue('error', 'capability-uncovered',
        `Capability operacional obrigatória "${cap.id}" (${cap.domain}) sem cenário QA`,
        { capability: cap.id, domain: cap.domain }
      );
    } else if (matchingScenarios.length === 0 && cap.required) {
      addIssue('warning', 'capability-uncovered',
        `Capability obrigatória "${cap.id}" (${cap.domain}) sem cenário QA`,
        { capability: cap.id, domain: cap.domain }
      );
    }
  }

  return capCoverage;
}

// ── 8. Análise de negócio — gaps por domínio ────────────────────────
function analyzeBusinessCoverage(routeCoverage, apiCoverage, capCoverage, qaScenarios) {
  const domains = {};
  const allScenarios = qaScenarios;

  // Agregar por domínio
  for (const route of Object.values(routeCoverage)) {
    const d = route.domain;
    if (!domains[d]) domains[d] = { routes: 0, routesCovered: 0, routesDirect: 0, apis: 0, apisCovered: 0, apisDirect: 0, capabilities: 0, capabilitiesCovered: 0, scenarios: 0 };
    domains[d].routes++;
    if (route.covered) domains[d].routesCovered++;
    if (route.coverageQuality === 'direct') domains[d].routesDirect++;
  }

  for (const api of Object.values(apiCoverage)) {
    const d = api.domain;
    if (!domains[d]) domains[d] = { routes: 0, routesCovered: 0, routesDirect: 0, apis: 0, apisCovered: 0, apisDirect: 0, capabilities: 0, capabilitiesCovered: 0, scenarios: 0 };
    domains[d].apis++;
    if (api.covered) domains[d].apisCovered++;
    if (api.coverageQuality === 'direct') domains[d].apisDirect++;
  }

  for (const cap of Object.values(capCoverage)) {
    const d = cap.domain;
    if (!domains[d]) domains[d] = { routes: 0, routesCovered: 0, apis: 0, apisCovered: 0, capabilities: 0, capabilitiesCovered: 0, scenarios: 0 };
    domains[d].capabilities++;
    if (cap.covered) domains[d].capabilitiesCovered++;
  }

  for (const s of allScenarios) {
    const d = s.domain;
    if (!domains[d]) domains[d] = { routes: 0, routesCovered: 0, apis: 0, apisCovered: 0, capabilities: 0, capabilitiesCovered: 0, scenarios: 0 };
    domains[d].scenarios++;
  }

  // Calcular score de completude por domínio
  const businessAnalysis = {};
  for (const [domain, stats] of Object.entries(domains)) {
    const routeScore = stats.routes > 0 ? Math.round((stats.routesDirect / stats.routes) * 100) : 100;
    const apiScore = stats.apis > 0 ? Math.round((stats.apisDirect / stats.apis) * 100) : 100;
    const capScore = stats.capabilities > 0 ? Math.round((stats.capabilitiesCovered / stats.capabilities) * 100) : 100;
    const completenessScore = Math.round((routeScore + apiScore + capScore) / 3);

    const risk = completenessScore >= 80 ? 'low' : completenessScore >= 50 ? 'medium' : 'high';
    const gaps = [];

    if (stats.routesCovered < stats.routes) gaps.push(`${stats.routes - stats.routesCovered} rotas sem cobertura`);
    if (stats.apisCovered < stats.apis) gaps.push(`${stats.apis - stats.apisCovered} módulos API sem cobertura`);
    if (stats.capabilitiesCovered < stats.capabilities) gaps.push(`${stats.capabilities - stats.capabilitiesCovered} capabilities sem cobertura`);

    businessAnalysis[domain] = {
      domain,
      completenessScore,
      risk,
      stats: { ...stats },
      scenarios: stats.scenarios,
      gaps,
      assessment: risk === 'low'
        ? 'Domínio bem coberto — jornadas QA cobrem rotas, APIs e capabilities'
        : risk === 'medium'
          ? 'Domínio parcialmente coberto — alguns gaps de cenários QA'
          : 'Domínio com cobertura insuficiente — gaps críticos de QA',
    };
  }

  return businessAnalysis;
}

// ── Helpers de mapeamento ───────────────────────────────────────────
function mapPathToDomain(routePath) {
  const domainMap = {
    '/support': 'core', '/workspace': 'core', '/inbox': 'core', '/config': 'core',
    '/dashboard': 'core', '/editor': 'core', '/bpmn-editor': 'bpmn',
    '/dev': 'core', '/dev-dashboard': 'core', '/generate-system': 'core',
    '/beauty': 'beauty', '/fitness': 'fitness',
    '/pbx': 'pbx', '/whatsapp': 'omnichannel', '/chat': 'omnichannel', '/chat-humano': 'omnichannel',
    '/orders': 'food', '/kitchen': 'food', '/dispatch': 'food',
    '/crm': 'core', '/marketing': 'core', '/solutions': 'services',
    '/qa': 'core', '/qa-mesh': 'core', '/dev/qa-waves': 'core',
    '/dev/rpa-replays': 'core', '/dev/rpa-test': 'core', '/rpa-seeds': 'core',
    '/channel-health': 'omnichannel', '/channel-accounts': 'omnichannel',
    '/access-control': 'core', '/operations-dashboard': 'core',
    '/storefront': 'food', '/kiosk': 'food', '/panel': 'core', '/station': 'core',
    '/node-marketplace': 'core', '/backup': 'core',
  };

  for (const [prefix, domain] of Object.entries(domainMap)) {
    if (routePath === prefix || routePath.startsWith(prefix + '/')) return domain;
  }

  // Fallback: extrair da primeira parte do path
  const segment = routePath.split('/')[1];
  const knownSegments = { beauty: 'beauty', fitness: 'fitness', pbx: 'pbx', crm: 'core', dev: 'core', qa: 'core', food: 'food' };
  return knownSegments[segment] || 'core';
}

function mapModuleToDomain(moduleName) {
  const name = moduleName.toLowerCase();
  if (name.includes('beauty') || name.includes('vertical')) return 'beauty';
  if (name.includes('fitness')) return 'fitness';
  if (name.includes('pbx') || name.includes('voice')) return 'pbx';
  if (name.includes('whatsapp') || name.includes('channel') || name.includes('omnichannel')) return 'omnichannel';
  if (name.includes('food') || name.includes('order') || name.includes('kitchen')) return 'food';
  if (name.includes('market')) return 'market';
  if (name.includes('clinic')) return 'clinic';
  if (name.includes('serv') || name.includes('solution')) return 'services';
  if (name.includes('bpmn') || name.includes('flow')) return 'bpmn';
  if (name.includes('workspace')) return 'workspace';
  return 'core';
}

// ── Main ─────────────────────────────────────────────────────────────
function run() {
  console.log('[coverage-completeness] Validando cobertura completa da plataforma...\n');

  // Coletar dados
  console.log('📊 Coletando fontes de verdade...');
  const frontendRoutes = extractFrontendRoutes();
  const apiModules = extractApiModules();
  const capabilities = extractCapabilities();
  const qaScenarios = extractQaScenarios();

  console.log(`  Frontend: ${frontendRoutes.length} rotas`);
  console.log(`  API:      ${apiModules.length} módulos`);
  console.log(`  Caps:     ${capabilities.length} capabilities`);
  console.log(`  QA:       ${qaScenarios.length} cenários\n`);

  // Cruzamentos
  console.log('🔀 Cruzando referências...');
  const routeCoverage = crossReferenceRoutesToScenarios(frontendRoutes, qaScenarios);
  const apiCoverage = crossReferenceApiToScenarios(apiModules, qaScenarios);
  const capCoverage = crossReferenceCapabilitiesToScenarios(capabilities, qaScenarios);
  const businessAnalysis = analyzeBusinessCoverage(routeCoverage, apiCoverage, capCoverage, qaScenarios);

  // Estatísticas
  const coveredRoutes = Object.values(routeCoverage).filter(r => r.covered).length;
  const directRoutes = Object.values(routeCoverage).filter(r => r.coverageQuality === 'direct').length;
  const coveredApis = Object.values(apiCoverage).filter(a => a.covered).length;
  const directApis = Object.values(apiCoverage).filter(a => a.coverageQuality === 'direct').length;
  const coveredCaps = Object.values(capCoverage).filter(c => c.covered).length;
  const requiredUncoveredCaps = Object.values(capCoverage).filter(c => !c.covered && c.required).length;

  const routePct = frontendRoutes.length > 0 ? Math.round((coveredRoutes / frontendRoutes.length) * 100) : 100;
  const routeDirectPct = frontendRoutes.length > 0 ? Math.round((directRoutes / frontendRoutes.length) * 100) : 0;
  const apiPct = apiModules.length > 0 ? Math.round((coveredApis / apiModules.length) * 100) : 100;
  const apiDirectPct = apiModules.length > 0 ? Math.round((directApis / apiModules.length) * 100) : 0;
  const capPct = capabilities.length > 0 ? Math.round((coveredCaps / capabilities.length) * 100) : 100;
  const overallPct = Math.round((routePct + apiPct + capPct) / 3);
  // Completude "real" = cobertura direta (não só domínio)
  const realPct = Math.round((routeDirectPct + apiDirectPct + capPct) / 3);

  const criticals = issues.filter(i => i.severity === 'critical').length;
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;

  console.log('═══ Cobertura da Plataforma ═══');
  console.log(`  Rotas frontend:    ${coveredRoutes}/${frontendRoutes.length} cobertas (${routePct}%) — ${directRoutes} diretas (${routeDirectPct}%)`);
  console.log(`  Módulos API:       ${coveredApis}/${apiModules.length} cobertos (${apiPct}%) — ${directApis} diretos (${apiDirectPct}%)`);
  console.log(`  Capabilities:      ${coveredCaps}/${capabilities.length} (${capPct}%)`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Completude nominal: ${overallPct}%`);
  console.log(`  Completude real:    ${realPct}% (cobertura direta por cenário)`);
  console.log(`  Cenários QA:        ${qaScenarios.length}`);
  console.log(`  Issues:             ${criticals} críticos, ${errors} erros, ${warnings} avisos\n`);

  // Status
  const status = criticals > 0 ? 'FAIL' : errors > 0 ? 'FAIL' : warnings > 20 ? 'WARN' : 'PASS';

  // Análise de negócio por domínio
  console.log('═══ Análise de Negócio por Domínio ═══');
  for (const [domain, analysis] of Object.entries(businessAnalysis).sort((a, b) => a[1].completenessScore - b[1].completenessScore)) {
    const icon = analysis.risk === 'low' ? '✅' : analysis.risk === 'medium' ? '⚠️' : '🔴';
    console.log(`  ${icon} ${domain.padEnd(15)} ${String(analysis.completenessScore).padStart(3)}% | ${analysis.stats.scenarios} cenários | ${analysis.stats.routes} rotas | ${analysis.stats.apis} APIs | ${analysis.stats.capabilities} caps`);
    if (analysis.gaps.length > 0) {
      console.log(`     Gaps: ${analysis.gaps.join(', ')}`);
    }
  }

  // Top issues
  if (issues.length > 0) {
    console.log(`\n═══ Top Issues (${Math.min(issues.length, 10)} de ${issues.length}) ═══`);
    for (const issue of issues.slice(0, 10)) {
      const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'error' ? '🟠' : '🟡';
      console.log(`  ${icon} [${issue.category}] ${issue.message}`);
    }
  }

  const report = {
    name: 'coverage-completeness',
    status,
    generatedAt: new Date().toISOString(),
    summary: {
      overallCompleteness: overallPct,
      routeCoverage: { total: frontendRoutes.length, covered: coveredRoutes, pct: routePct },
      apiCoverage: { total: apiModules.length, covered: coveredApis, pct: apiPct },
      capabilityCoverage: { total: capabilities.length, covered: coveredCaps, pct: capPct },
      qaScenarios: qaScenarios.length,
      criticals,
      errors,
      warnings,
    },
    businessAnalysis,
    routeCoverage,
    apiCoverage: Object.fromEntries(
      Object.entries(apiCoverage).map(([k, v]) => [k, { ...v, scenarios: undefined }])
    ),
    uncoveredRoutes: Object.values(routeCoverage).filter(r => !r.covered).map(r => r.path),
    uncoveredApis: Object.values(apiCoverage).filter(a => !a.covered).map(a => a.module),
    requiredUncoveredCapabilities: Object.values(capCoverage).filter(c => !c.covered && c.required).map(c => c.capability),
    issues: issues.slice(0, 100),
  };

  const outPath = writeReport('coverage-completeness-report.json', report);
  console.log(`\n📄 Relatório: ${outPath}`);

  return status === 'FAIL' ? 1 : 0;
}

if (require.main === module) {
  process.exit(run());
}

module.exports = { run };
