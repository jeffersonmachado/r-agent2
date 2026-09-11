'use strict';

/**
 * Gate bloqueante: política de build local.
 *
 * Fonte canônica: `AI_MEMORY/deployment-rules.md`.
 * Invariante: imagens Docker são construídas SEMPRE localmente (workstation/CI)
 * e transferidas ao servidor; o host de produção nunca constrói.
 *
 * A doc sozinha não impede regressão, então este validador verifica os pontos
 * executáveis do caminho de deploy (script de deploy, scripts npm, orquestrador
 * `tools/system/deploy.js`) e a presença dos âncoras de documentação.
 */

const fs = require('fs');
const path = require('path');

const {
  analyzeDeployScript,
  analyzePackageScripts,
  analyzeDeployJs,
  analyzePolicyDoc,
  analyzeChecklist,
  analyzeCanonicalMemory,
} = require('./local-build-policy');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT, 'reports', 'local-build-policy-report.json');

const FILES = {
  deployScript: path.join(ROOT, 'scripts', 'docker-deploy.sh'),
  packageJson: path.join(ROOT, 'package.json'),
  deployJs: path.join(ROOT, 'tools', 'system', 'deploy.js'),
  policyDoc: path.join(ROOT, 'docs', 'deployment', 'local-build-policy.md'),
  checklist: path.join(ROOT, 'DEPLOYMENT_CHECKLIST.md'),
  canonicalMemory: path.join(ROOT, 'AI_MEMORY', 'deployment-rules.md'),
};

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

function main() {
  const violations = [];

  const checks = [
    { artifact: 'scripts/docker-deploy.sh', path: FILES.deployScript, analyze: analyzeDeployScript },
    { artifact: 'tools/system/deploy.js', path: FILES.deployJs, analyze: analyzeDeployJs },
    { artifact: 'docs/deployment/local-build-policy.md', path: FILES.policyDoc, analyze: analyzePolicyDoc },
    { artifact: 'DEPLOYMENT_CHECKLIST.md', path: FILES.checklist, analyze: analyzeChecklist },
    { artifact: 'AI_MEMORY/deployment-rules.md', path: FILES.canonicalMemory, analyze: analyzeCanonicalMemory },
  ];

  for (const check of checks) {
    const content = readIfExists(check.path);
    if (content === null) {
      violations.push({
        code: 'artifact_missing',
        artifact: check.artifact,
        detail: `arquivo obrigatório ausente: ${path.relative(ROOT, check.path)}`,
      });
      continue;
    }

    for (const reason of check.analyze(content)) {
      violations.push({ ...reason, artifact: check.artifact });
    }
  }

  const packageContent = readIfExists(FILES.packageJson);
  if (packageContent === null) {
    violations.push({ code: 'artifact_missing', artifact: 'package.json', detail: 'package.json ausente.' });
  } else {
    let scripts = {};
    try {
      scripts = JSON.parse(packageContent).scripts || {};
    } catch (error) {
      violations.push({
        code: 'package_json_invalid',
        artifact: 'package.json',
        detail: `package.json inválido: ${error.message}`,
      });
    }
    for (const reason of analyzePackageScripts(scripts)) {
      violations.push({ ...reason, artifact: 'package.json' });
    }
  }

  const report = {
    name: 'validate-local-build-policy',
    generatedAt: new Date().toISOString(),
    policy: 'Docker images are ALWAYS built locally (workstation/CI); the production host never builds.',
    canonicalSource: 'AI_MEMORY/deployment-rules.md',
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    violationCount: violations.length,
    violations,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  console.log(`[local-build-policy] status=${report.status} violations=${violations.length}`);
  for (const violation of violations) {
    console.log(`[local-build-policy] VIOLATION ${violation.code} (${violation.artifact}): ${violation.detail}`);
  }
  console.log(`[local-build-policy] relatório: ${path.relative(ROOT, REPORT_PATH)}`);

  process.exit(violations.length === 0 ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { main, FILES, REPORT_PATH };
