'use strict';

const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'reports');
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'screenshots', 'business-qa');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function slugify(value) {
  return String(value || 'scenario')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function createRunContext(meta = {}) {
  ensureDir(REPORTS_DIR);
  ensureDir(SCREENSHOTS_DIR);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    startedAt: new Date().toISOString(),
    stamp,
    meta,
    scenarios: [],
    summary: null,
  };
}

function startScenario(run, definition) {
  const scenario = {
    status: 'RUNNING',
    vertical: definition.vertical,
    type: definition.type,
    codigo: definition.code,
    nome: definition.name,
    criticidade: definition.criticality || 'medium',
    preCondicoes: definition.preconditions || [],
    criterios: definition.assertions || [],
    startedAt: new Date().toISOString(),
    duration_ms: 0,
    etapas: [],
    artefatos: [],
    ids: {},
    resumo: {
      resultadoFinal: 'RUNNING',
      causaRaiz: null,
      recomendacao: null,
    },
  };
  run.scenarios.push(scenario);
  return scenario;
}

async function executeStep(scenario, stepName, fn) {
  const startedAt = Date.now();
  const step = {
    nome: stepName,
    status: 'RUNNING',
    duracao_ms: 0,
    detalhe: null,
    evidencia: null,
  };
  scenario.etapas.push(step);
  try {
    const result = await fn();
    step.status = 'PASS';
    step.duracao_ms = Date.now() - startedAt;
    step.detalhe = result?.detail || null;
    step.evidencia = result?.evidence || null;
    if (result?.ids && typeof result.ids === 'object') {
      Object.assign(scenario.ids, result.ids);
    }
    if (Array.isArray(result?.artifacts)) {
      scenario.artefatos.push(...result.artifacts);
    }
    return result;
  } catch (error) {
    step.status = 'FAIL';
    step.duracao_ms = Date.now() - startedAt;
    step.detalhe = error.message || String(error);
    scenario.status = 'FAIL';
    scenario.resumo.resultadoFinal = 'FAIL';
    scenario.resumo.causaRaiz = step.detalhe;
    scenario.resumo.recomendacao = 'Inspecionar a etapa que falhou e os artefatos gerados.';
    throw error;
  }
}

function finalizeScenario(scenario, error = null) {
  scenario.finishedAt = new Date().toISOString();
  scenario.duration_ms = new Date(scenario.finishedAt).getTime() - new Date(scenario.startedAt).getTime();
  if (error) {
    scenario.status = 'FAIL';
    scenario.resumo.resultadoFinal = 'FAIL';
    scenario.resumo.causaRaiz = error.message || String(error);
    scenario.resumo.recomendacao = scenario.resumo.recomendacao || 'Corrigir o fluxo e reexecutar a jornada.';
    return scenario;
  }
  if (scenario.status !== 'FAIL') {
    scenario.status = 'PASS';
    scenario.resumo.resultadoFinal = 'PASS';
    scenario.resumo.causaRaiz = null;
    scenario.resumo.recomendacao = 'Manter no gate oficial e acompanhar regressões.';
  }
  return scenario;
}

function summarizeRun(run) {
  const total = run.scenarios.length;
  const passed = run.scenarios.filter((item) => item.status === 'PASS').length;
  const failed = total - passed;
  run.finishedAt = new Date().toISOString();
  run.duration_ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  run.summary = {
    total,
    passed,
    failed,
    status: failed === 0 ? 'PASS' : 'FAIL',
  };
  return run.summary;
}

function writeRunReport(run) {
  summarizeRun(run);
  const jsonPath = path.join(REPORTS_DIR, `business-qa-${run.stamp}.json`);
  const mdPath = path.join(REPORTS_DIR, `business-qa-${run.stamp}.md`);
  const latestJsonPath = path.join(REPORTS_DIR, 'business-qa-latest.json');
  const latestMdPath = path.join(REPORTS_DIR, 'business-qa-latest.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  fs.writeFileSync(latestJsonPath, `${JSON.stringify(run, null, 2)}\n`, 'utf8');

  const lines = [];
  lines.push('# Business QA');
  lines.push('');
  lines.push(`- Gerado em: ${run.finishedAt}`);
  lines.push(`- Status: ${run.summary.status}`);
  lines.push(`- Total: ${run.summary.total}`);
  lines.push(`- PASS: ${run.summary.passed}`);
  lines.push(`- FAIL: ${run.summary.failed}`);
  lines.push('');
  for (const scenario of run.scenarios) {
    lines.push(`## ${scenario.codigo} - ${scenario.nome}`);
    lines.push(`- status: ${scenario.status}`);
    lines.push(`- vertical: ${scenario.vertical}`);
    lines.push(`- tipo: ${scenario.type}`);
    lines.push(`- duracao_ms: ${scenario.duration_ms}`);
    if (Object.keys(scenario.ids || {}).length) {
      lines.push(`- ids: ${JSON.stringify(scenario.ids)}`);
    }
    lines.push('- etapas:');
    for (const step of scenario.etapas) {
      lines.push(`  - ${step.nome}: ${step.status} (${step.duracao_ms}ms) ${step.detalhe ? `- ${step.detalhe}` : ''}`);
    }
    if (scenario.artefatos.length) {
      lines.push('- artefatos:');
      for (const artifact of scenario.artefatos) {
        lines.push(`  - ${artifact.type || 'artifact'}: ${artifact.path || JSON.stringify(artifact)}`);
      }
    }
    lines.push(`- resumo: ${scenario.resumo.resultadoFinal}${scenario.resumo.causaRaiz ? ` | ${scenario.resumo.causaRaiz}` : ''}`);
    lines.push('');
  }
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');
  fs.writeFileSync(latestMdPath, `${lines.join('\n')}\n`, 'utf8');
  return {
    jsonPath,
    mdPath,
    latestJsonPath,
    latestMdPath,
  };
}

module.exports = {
  REPORTS_DIR,
  SCREENSHOTS_DIR,
  createRunContext,
  startScenario,
  executeStep,
  finalizeScenario,
  summarizeRun,
  writeRunReport,
  ensureDir,
  slugify,
};
