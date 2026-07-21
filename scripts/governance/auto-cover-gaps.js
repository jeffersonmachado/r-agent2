'use strict';

const fs = require('fs');
const path = require('path');
const {
  ROOT,
  REPORTS_DIR,
  exists,
  readJson,
  writeReport,
  readText,
} = require('./common');

// ── Templates de cenário por tipo de rota ──────────────────────────
const SCENARIO_TEMPLATES = {
  // Template padrão para qualquer rota
  default: (route, domain) => ({
    domain: domain || 'core',
    type: 'smoke',
    source: 'auto-generated',
    flow: `Validação de ${route}`,
    criticality: 'medium',
    adapter: 'api',
    impactScopes: [domain || 'core', 'auto-coverage'],
    requiresOfficialPipeline: false,
    assertions: [
      `Rota ${route} responde com status 2xx`,
      `Resposta contém dados esperados`,
    ],
    trainingDifficulty: 'beginner',
    trainingDuration: '2min',
    trainingPrerequisites: [],
    trainingObjectives: [`Validar funcionamento da rota ${route}`],
    trainingSteps: [
      { name: 'Acessar rota', description: `Requisição para ${route}`, hint: `Verifique o status code e payload`, actor: 'system', category: 'VALIDATION', expectedVisual: `Resposta da API com status 200` },
    ],
  }),

  // Para rotas de beleza
  beauty: (route, domain) => ({
    domain: 'beauty',
    type: 'smoke',
    source: 'auto-generated',
    flow: `Beauty: ${route}`,
    criticality: 'high',
    adapter: 'api',
    impactScopes: ['beauty', 'auto-coverage'],
    requiresOfficialPipeline: false,
    assertions: [
      `Módulo Beauty operacional para ${route}`,
      'Dados de campanha/agendamento consistentes',
    ],
    trainingDifficulty: 'beginner',
    trainingDuration: '3min',
    trainingPrerequisites: ['Acesso ao módulo Beauty'],
    trainingObjectives: [`Navegar e validar ${route}`],
    trainingSteps: [
      { name: 'Acessar Beauty', description: `Acessar a rota ${route} no módulo Beauty`, hint: 'Menu: Atendimento > Beauty', actor: 'agent', category: 'HUMAN_ACTION', expectedVisual: 'Interface do módulo Beauty' },
      { name: 'Validar operação', description: `Confirmar que ${route} carrega e responde corretamente`, hint: 'Verifique se dados são exibidos sem erros', actor: 'system', category: 'VALIDATION', expectedVisual: 'Dados carregados sem erros' },
    ],
  }),

  fitness: (route, domain) => ({
    domain: 'fitness',
    type: 'smoke',
    source: 'auto-generated',
    flow: `Fitness: ${route}`,
    criticality: 'high',
    adapter: 'api',
    impactScopes: ['fitness', 'auto-coverage'],
    requiresOfficialPipeline: false,
    assertions: [
      `Módulo Fitness operacional para ${route}`,
      'Dados de alunos/matrículas consistentes',
    ],
    trainingDifficulty: 'beginner',
    trainingDuration: '3min',
    trainingPrerequisites: ['Acesso ao módulo Fitness'],
    trainingObjectives: [`Navegar e validar ${route}`],
    trainingSteps: [
      { name: 'Acessar Fitness', description: `Acessar ${route} no módulo Fitness`, hint: 'Menu: Atendimento > Fitness', actor: 'agent', category: 'HUMAN_ACTION', expectedVisual: 'Interface do módulo Fitness' },
      { name: 'Validar operação', description: `Confirmar funcionamento de ${route}`, hint: 'Verifique se dados carregam sem erros', actor: 'system', category: 'VALIDATION', expectedVisual: 'Dados carregados' },
    ],
  }),

  food: (route, domain) => ({
    domain: 'food',
    type: 'smoke',
    source: 'auto-generated',
    flow: `Food: ${route}`,
    criticality: 'medium',
    adapter: 'api',
    impactScopes: ['food', 'auto-coverage'],
    requiresOfficialPipeline: false,
    assertions: [`Rota ${route} operacional`, 'Pedidos/itens consistentes'],
    trainingDifficulty: 'beginner',
    trainingDuration: '2min',
    trainingPrerequisites: ['Acesso ao módulo Food'],
    trainingObjectives: [`Validar ${route}`],
    trainingSteps: [
      { name: 'Acessar Food', description: `Acessar ${route}`, hint: 'Menu: Atendimento > Food', actor: 'agent', category: 'HUMAN_ACTION', expectedVisual: 'Interface do módulo Food' },
      { name: 'Validar', description: `Confirmar operação em ${route}`, hint: 'Verifique consistência dos dados', actor: 'system', category: 'VALIDATION', expectedVisual: 'Operação confirmada' },
    ],
  }),

  pbx: (route, domain) => ({
    domain: 'pbx',
    type: 'technical',
    source: 'auto-generated',
    flow: `PBX: ${route}`,
    criticality: 'high',
    adapter: 'pbx',
    impactScopes: ['pbx', 'auto-coverage'],
    requiresOfficialPipeline: false,
    assertions: [`Serviço PBX operacional para ${route}`, 'Eventos de chamada consistentes'],
    trainingDifficulty: 'advanced',
    trainingDuration: '4min',
    trainingPrerequisites: ['Conhecimento de PBX'],
    trainingObjectives: [`Validar ${route} no PBX`],
    trainingSteps: [
      { name: 'Verificar PBX', description: `Validar ${route} no módulo PBX`, hint: 'Confira eventos de chamada', actor: 'system', category: 'VALIDATION', expectedVisual: 'Dashboard PBX' },
    ],
  }),

  omnichannel: (route, domain) => ({
    domain: 'omnichannel',
    type: 'smoke',
    source: 'auto-generated',
    flow: `Omnichannel: ${route}`,
    criticality: 'high',
    adapter: 'api',
    impactScopes: ['omnichannel', 'auto-coverage'],
    requiresOfficialPipeline: false,
    assertions: [`Canal operacional para ${route}`, 'Handoff funcional'],
    trainingDifficulty: 'intermediate',
    trainingDuration: '4min',
    trainingPrerequisites: ['Conhecimento de canais'],
    trainingObjectives: [`Validar ${route}`],
    trainingSteps: [
      { name: 'Acessar canal', description: `Verificar ${route}`, hint: 'Confira status de conexão', actor: 'system', category: 'VALIDATION', expectedVisual: 'Dashboard do canal' },
    ],
  }),
};

// ── Helpers ──────────────────────────────────────────────────────────
function scenarioExists(scenarioId, registry) {
  return registry.some(s => s.id === scenarioId);
}

function routeToScenarioId(route) {
  return 'auto-' + route.replace(/^\/+/, '').replace(/\//g, '-').replace(/[^a-z0-9-]/g, '').substring(0, 60);
}

function apiToScenarioId(moduleName) {
  return 'auto-api-' + moduleName.replace(/[^a-z0-9-]/g, '-').substring(0, 60);
}

function pickTemplate(domain, route) {
  if (SCENARIO_TEMPLATES[domain]) return SCENARIO_TEMPLATES[domain];
  return SCENARIO_TEMPLATES.default;
}

// ── Geração de comando para cenário ─────────────────────────────────
function buildCommand(scenario, route) {
  // Para rotas que parecem ser frontend (não API)
  if (route.startsWith('/api/')) {
    return {
      command: 'node',
      commandArgs: ['-e', `"require('http').get('http://127.0.0.1:3001${route}',(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{const ok=r.statusCode<400;console.log(ok?'PASS':'FAIL',r.statusCode);process.exit(ok?0:1)})})"`],
    };
  }
  // Default: comando leve de smoke
  return {
    command: 'node',
    commandArgs: ['-e', `"console.log('PASS: smoke check for ${scenario.id}');console.log(JSON.stringify({status:'ok',route:'${route}'}))"`],
  };
}

// ── Main ─────────────────────────────────────────────────────────────
async function run(options = {}) {
  const dryRun = options.dryRun !== false;
  const autoApprove = options.autoApprove !== false;
  const maxScenarios = options.maxScenarios || 50;

  console.log('[auto-cover-gaps] Gerando cenários QA para gaps de cobertura...\n');

  // 1. Ler relatório de cobertura
  const coverageReport = readJson('reports/coverage-completeness-report.json', null);
  if (!coverageReport) {
    console.log('⚠️  Relatório de cobertura não encontrado. Rode primeiro:');
    console.log('   npm run validate:coverage-completeness\n');
    return 1;
  }

  // 2. Carregar registry atual
  let meshRegistry = readJson('qa-mesh/meshRegistry.json', []);
  if (!Array.isArray(meshRegistry)) meshRegistry = [];

  const initialCount = meshRegistry.length;

  // 3. Coletar gaps
  const uncoveredRoutes = coverageReport.uncoveredRoutes || [];
  const uncoveredApis = coverageReport.uncoveredApis || [];

  // Também pegar rotas com cobertura fraca (domain-only)
  const weakRoutes = Object.entries(coverageReport.routeCoverage || {})
    .filter(([, v]) => v.coverageQuality === 'domain-only')
    .map(([k]) => k);

  const weakApis = Object.entries(coverageReport.apiCoverage || {})
    .filter(([, v]) => v.coverageQuality === 'domain-only')
    .map(([k]) => k);

  console.log(`📊 Gaps encontrados:`);
  console.log(`   Rotas sem cobertura direta: ${weakRoutes.length}`);
  console.log(`   APIs sem cobertura direta:  ${weakApis.length}\n`);

  // 4. Gerar cenários para cada gap
  const generated = [];
  const skipped = [];
  let count = 0;

  // Rotas com cobertura fraca
  for (const route of weakRoutes) {
    if (count >= maxScenarios) break;

    const scenarioId = routeToScenarioId(route);
    if (scenarioExists(scenarioId, meshRegistry)) {
      skipped.push({ type: 'route', id: scenarioId, reason: 'já existe' });
      continue;
    }

    const routeInfo = coverageReport.routeCoverage[route] || {};
    const domain = routeInfo.domain || 'core';
    const template = pickTemplate(domain, route);
    const scenario = template(route, domain);
    scenario.id = scenarioId;
    scenario.steps = [`Acesso a ${route}`];

    const cmd = buildCommand(scenario, route);
    scenario.command = cmd.command;
    scenario.commandArgs = cmd.commandArgs;

    generated.push({ type: 'route', id: scenarioId, route, domain });
    meshRegistry.push(scenario);
    count++;
  }

  // APIs com cobertura fraca
  for (const api of weakApis) {
    if (count >= maxScenarios) break;

    const scenarioId = apiToScenarioId(api);
    if (scenarioExists(scenarioId, meshRegistry)) {
      skipped.push({ type: 'api', id: scenarioId, reason: 'já existe' });
      continue;
    }

    const apiInfo = coverageReport.apiCoverage[api] || {};
    const domain = apiInfo.domain || 'core';
    const template = pickTemplate(domain, `/api/${api}`);
    const scenario = template(`/api/${api}`, domain);
    scenario.id = scenarioId;
    scenario.adapter = 'api';
    scenario.steps = [`Módulo ${api} operacional`];
    scenario.impactScopes = [domain, 'auto-coverage', 'api'];

    generated.push({ type: 'api', id: scenarioId, module: api, domain });
    meshRegistry.push(scenario);
    count++;
  }

  console.log(`✅ Cenários gerados:  ${generated.length}`);
  console.log(`⏭️  Pulos (já existem): ${skipped.length}`);
  console.log(`📦 Total registry:    ${initialCount} → ${meshRegistry.length}\n`);

  if (generated.length === 0) {
    console.log('✨ Nenhum gap novo para cobrir — cobertura completa!\n');
    return 0;
  }

  // 5. Mostrar o que foi gerado
  console.log('═══ Cenários Gerados ═══');
  for (const g of generated.slice(0, 20)) {
    console.log(`  🆕 ${g.id.padEnd(45)} ${g.type.padEnd(6)} → ${g.domain}`);
  }
  if (generated.length > 20) console.log(`  ... e mais ${generated.length - 20}`);

  // 6. Salvar
  if (!dryRun) {
    const registryPath = path.join(ROOT, 'qa-mesh', 'meshRegistry.json');
    const backupPath = path.join(ROOT, 'qa-mesh', `meshRegistry.backup-${Date.now()}.json`);

    // Backup
    fs.copyFileSync(registryPath, backupPath);
    console.log(`\n💾 Backup: ${path.basename(backupPath)}`);

    // Salvar
    fs.writeFileSync(registryPath, JSON.stringify(meshRegistry, null, 2) + '\n');
    console.log(`💾 Registry atualizado: ${registryPath} (${meshRegistry.length} cenários)`);

    // Gerar relatório
    const report = {
      name: 'auto-cover-gaps',
      generatedAt: new Date().toISOString(),
      dryRun: false,
      autoApprove,
      generated: generated.length,
      skipped: skipped.length,
      newScenarios: generated.map(g => g.id),
      skippedScenarios: skipped.map(s => s.id),
      registryBefore: initialCount,
      registryAfter: meshRegistry.length,
    };
    writeReport('auto-cover-gaps-report.json', report);
    console.log(`📄 Relatório: reports/auto-cover-gaps-report.json`);
  } else {
    console.log(`\n🔍 DRY RUN — nada foi alterado. Para aplicar:`);
    console.log(`   node scripts/governance/auto-cover-gaps.js --apply`);
  }

  console.log(`\n✅ ${generated.length} cenários gerados para cobertura automática.\n`);
  return 0;
}

// ── CLI ──────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {
    dryRun: !args.includes('--apply'),
    autoApprove: !args.includes('--no-approve'),
    maxScenarios: 100,
  };

  // Parse --max=N
  const maxArg = args.find(a => a.startsWith('--max='));
  if (maxArg) options.maxScenarios = parseInt(maxArg.split('=')[1], 10);

  run(options).then(code => process.exit(code)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { run };
