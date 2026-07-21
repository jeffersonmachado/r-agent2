'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MESH_EVIDENCE_DIR = path.join(ROOT, 'qa-mesh', 'meshEvidence');

// ── Failure pattern database ─────────────────────────────────────────
const FAILURE_PATTERNS = [
  {
    name: 'selector-not-found',
    regex: /(?:selector|element)[\s"']*([^\s"']+)[\s"']*not\s*(?:found|exist|visible)/i,
    severity: 'error',
    suggestion: (match) => `Seletor "${match[1]}" não encontrado. Verifique se a UI mudou — atualize o seletor no cenário QA Mesh. Rode o teste com --screenshots para ver o estado da tela.`,
  },
  {
    name: 'timeout',
    regex: /(?:timeout|timed?\s*out)[\s\S]*?(?:exceeded|after)\s*(\d+)/i,
    severity: 'error',
    suggestion: (match) => `Timeout após ${match[1]}ms. Possíveis causas: servidor lento, rede, ou elemento nunca aparece. Aumente o timeout ou verifique se a página carregou.`,
  },
  {
    name: 'auth-failure',
    regex: /(?:401|403|unauthorized|forbidden|auth.*fail|login.*fail|not authenticated)/i,
    severity: 'critical',
    suggestion: () => 'Falha de autenticação. Verifique: 1) credenciais no .env 2) token não expirou 3) tenant selection funcionando. Use tests/helpers/playwrightAuth.js.',
  },
  {
    name: 'network-failure',
    regex: /(?:ECONNREFUSED|ENOTFOUND|ERR_CONNECTION|network.*error|fetch.*fail|axios.*error)/i,
    severity: 'critical',
    suggestion: () => 'Falha de rede/conexão. O servidor está rodando? Verifique docker-compose, portas (3001 API, 5173 frontend), e DNS interno.',
  },
  {
    name: 'db-connection',
    regex: /(?:database|postgres|sequelize|connection.*refused|ECONNREFUSED.*5432)/i,
    severity: 'critical',
    suggestion: () => 'Falha de conexão com banco de dados. Verifique: 1) PostgreSQL rodando 2) DATABASE_URL correta 3) credenciais válidas.',
  },
  {
    name: 'assertion-failure',
    regex: /(?:assert.*fail|expected|actual|not.*equal|not.*match)/i,
    severity: 'error',
    suggestion: () => 'Falha de asserção. O valor retornado não corresponde ao esperado. Verifique a lógica do teste e se a API/UI mudou comportamento.',
  },
  {
    name: 'out-of-memory',
    regex: /(?:out\s*of\s*memory|OOM|heap|allocation.*fail|JavaScript heap)/i,
    severity: 'critical',
    suggestion: () => 'Memória insuficiente. Aumente --max-old-space-size ou reduza paralelismo do mesh.',
  },
  {
    name: 'disk-full',
    regex: /(?:ENOSPC|no\s*space|disk.*full)/i,
    severity: 'critical',
    suggestion: () => 'Disco cheio. Rode npm run validate:cleanup para liberar espaço de artefatos de runtime.',
  },
  {
    name: 'permission-denied',
    regex: /(?:EACCES|E PERM|permission.*denied|not.*permitted)/i,
    severity: 'error',
    suggestion: () => 'Permissão negada. Verifique permissões de arquivo/diretório. Pode ser root-owned files em runtime.',
  },
  {
    name: 'port-in-use',
    regex: /(?:EADDRINUSE|address.*in.*use|port.*already)/i,
    severity: 'error',
    suggestion: () => 'Porta em uso. Mate o processo que ocupa a porta ou mude a configuração.',
  },
  {
    name: 'module-not-found',
    regex: /(?:cannot\s*find\s*module|MODULE_NOT_FOUND|import.*error)/i,
    severity: 'critical',
    suggestion: (match) => 'Módulo não encontrado. Rode npm install. Se for módulo ESM/CJS mismatch, verifique convenções de camada.',
  },
  {
    name: 'esm-cjs-mismatch',
    regex: /(?:require.*import|import.*require|\.mjs|\.cjs|ESM|CommonJS).*error/i,
    severity: 'error',
    suggestion: () => 'Mismatch ESM/CommonJS. Backend deve usar require(), frontend deve usar import. Verifique validate:layer-conventions.',
  },
];

// ── Helpers ──────────────────────────────────────────────────────────
function findLatestMeshRun() {
  if (!fs.existsSync(MESH_EVIDENCE_DIR)) return null;

  const dirs = fs.readdirSync(MESH_EVIDENCE_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith('mesh-'))
    .map(d => ({ name: d.name, path: path.join(MESH_EVIDENCE_DIR, d.name) }))
    .sort((a, b) => b.name.localeCompare(a.name));

  return dirs.length > 0 ? dirs[0] : null;
}

function findMeshRunResults(meshDir) {
  const results = [];

  // Look for summary files
  const summaryPath = path.join(meshDir.path, 'summary.json');
  const goNoGoPath = path.join(meshDir.path, 'go-no-go.json');
  const resultsPath = path.join(meshDir.path, 'results.json');
  const reportPath = path.join(meshDir.path, 'mesh-report.json');

  for (const p of [summaryPath, goNoGoPath, resultsPath, reportPath]) {
    if (fs.existsSync(p)) {
      try {
        results.push({ file: path.basename(p), data: JSON.parse(fs.readFileSync(p, 'utf8')) });
      } catch (_) {}
    }
  }

  // Look for scenario-level results
  const scenariosDir = path.join(meshDir.path, 'scenarios');
  if (fs.existsSync(scenariosDir)) {
    const scenarioFiles = fs.readdirSync(scenariosDir).filter(f => f.endsWith('.json'));
    for (const sf of scenarioFiles) {
      try {
        results.push({ file: `scenarios/${sf}`, data: JSON.parse(fs.readFileSync(path.join(scenariosDir, sf), 'utf8')) });
      } catch (_) {}
    }
  }

  // Look for error logs
  const errorLogPath = path.join(meshDir.path, 'error.log');
  const stderrPath = path.join(meshDir.path, 'stderr.log');
  for (const p of [errorLogPath, stderrPath]) {
    if (fs.existsSync(p)) {
      results.push({ file: path.basename(p), text: fs.readFileSync(p, 'utf8').slice(0, 50000) });
    }
  }

  return results;
}

function diagnoseText(text, source) {
  const diagnoses = [];

  for (const pattern of FAILURE_PATTERNS) {
    const match = text.match(pattern.regex);
    if (match) {
      diagnoses.push({
        pattern: pattern.name,
        severity: pattern.severity,
        source,
        match: match[0].substring(0, 200),
        suggestion: pattern.suggestion(match),
      });
    }
  }

  return diagnoses;
}

function diagnoseResult(data, source) {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return diagnoseText(text, source);
}

function summarizeFailures(meshDir, results) {
  const allDiagnoses = [];
  let totalScenarios = 0;
  let failedScenarios = 0;
  let passedScenarios = 0;

  for (const result of results) {
    if (result.text) {
      allDiagnoses.push(...diagnoseText(result.text, result.file));
    } else if (result.data) {
      allDiagnoses.push(...diagnoseResult(result.data, result.file));

      // Extract scenario counts
      const d = result.data;
      if (d.summary) {
        totalScenarios = Math.max(totalScenarios, d.summary.total || d.summary.scenarios || 0);
        failedScenarios = Math.max(failedScenarios, d.summary.failed || d.summary.failures || 0);
        passedScenarios = Math.max(passedScenarios, d.summary.passed || d.summary.successes || 0);
      }
      if (d.totalScenarios) totalScenarios = Math.max(totalScenarios, d.totalScenarios);
      if (d.failedScenarios) failedScenarios = Math.max(failedScenarios, d.failedScenarios);
      if (d.passedScenarios) passedScenarios = Math.max(passedScenarios, d.passedScenarios);

      // Individual scenario results
      if (Array.isArray(d.results)) {
        for (const r of d.results) {
          if (r.status === 'failed' || r.status === 'error' || r.passed === false) {
            failedScenarios++;
            totalScenarios++;
            const errText = r.error || r.message || r.stack || '';
            allDiagnoses.push(...diagnoseText(errText, `scenario:${r.id || r.name || 'unknown'}`));
          } else if (r.status === 'passed' || r.passed === true || r.success === true) {
            passedScenarios++;
            totalScenarios++;
          }
        }
      }
    }
  }

  return { allDiagnoses, totalScenarios, failedScenarios, passedScenarios };
}

// ── Main ─────────────────────────────────────────────────────────────
function run() {
  console.log('🔍 Mesh Auto-Diagnosis\n');
  console.log('═══════════════════════\n');

  const latestMesh = findLatestMeshRun();

  if (!latestMesh) {
    console.log('⚠️  Nenhuma execução de mesh encontrada em qa-mesh/meshEvidence/');
    console.log('   Rode npm run qa:mesh primeiro.\n');
    return 1;
  }

  console.log(`📁 Última execução: ${latestMesh.name}`);
  console.log(`   Path: ${latestMesh.path}\n`);

  const results = findMeshRunResults(latestMesh);

  if (results.length === 0) {
    console.log('⚠️  Nenhum resultado encontrado no diretório do mesh.\n');
    return 1;
  }

  console.log(`📄 ${results.length} arquivos de evidência encontrados\n`);

  const { allDiagnoses, totalScenarios, failedScenarios, passedScenarios } = summarizeFailures(latestMesh, results);

  console.log('═══ Resumo da Execução ═══');
  console.log(`  Cenários total:    ${totalScenarios || '?'}`);
  console.log(`  Passaram:          ${passedScenarios || '?'}`);
  console.log(`  Falharam:          ${failedScenarios || '?'}`);
  console.log('');

  if (allDiagnoses.length === 0 && failedScenarios === 0) {
    console.log('✅ Nenhum problema detectado. Mesh executou limpo.\n');
    return 0;
  }

  // Group by pattern
  const byPattern = {};
  for (const d of allDiagnoses) {
    if (!byPattern[d.pattern]) byPattern[d.pattern] = [];
    byPattern[d.pattern].push(d);
  }

  console.log('═══ Diagnóstico ═══\n');

  for (const [pattern, diagnoses] of Object.entries(byPattern)) {
    const sev = diagnoses[0].severity;
    const icon = sev === 'critical' ? '🔴' : sev === 'error' ? '🟠' : '🟡';
    console.log(`${icon} ${pattern} (${diagnoses.length} ocorrência${diagnoses.length > 1 ? 's' : ''})`);
    console.log(`   → ${diagnoses[0].suggestion}`);
    console.log(`   Fontes: ${diagnoses.map(d => d.source).join(', ')}`);
    console.log('');
  }

  // Suggested actions
  console.log('═══ Ações Recomendadas ═══\n');

  const criticalPatterns = Object.keys(byPattern).filter(p => byPattern[p][0].severity === 'critical');
  const errorPatterns = Object.keys(byPattern).filter(p => byPattern[p][0].severity === 'error');

  if (criticalPatterns.includes('auth-failure')) {
    console.log('1. [CRÍTICO] Falha de auth — verifique .token.env e credenciais');
  }
  if (criticalPatterns.includes('network-failure')) {
    console.log('2. [CRÍTICO] Falha de rede — inicie docker-compose e verifique portas');
  }
  if (criticalPatterns.includes('db-connection')) {
    console.log('3. [CRÍTICO] Falha de DB — verifique PostgreSQL e DATABASE_URL');
  }
  if (errorPatterns.includes('selector-not-found')) {
    console.log('4. [ERRO] Seletores stale — atualize cenários QA Mesh com seletores novos');
  }
  if (errorPatterns.includes('timeout')) {
    console.log('5. [ERRO] Timeouts — aumente timeouts ou verifique performance do servidor');
  }
  if (errorPatterns.includes('assertion-failure')) {
    console.log('6. [ERRO] Asserções quebradas — verifique se API/UI mudou comportamento');
  }

  if (Object.keys(byPattern).length === 0) {
    console.log('  Nenhum padrão de falha identificado automaticamente.');
    console.log('  Inspecione manualmente os arquivos em:', latestMesh.path);
  }

  console.log(`\n📁 Evidência completa: ${latestMesh.path}`);
  console.log('');

  return failedScenarios > 0 || allDiagnoses.length > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exit(run());
}

module.exports = { run, FAILURE_PATTERNS };
