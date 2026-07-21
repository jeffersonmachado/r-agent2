#!/usr/bin/env node
'use strict';

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function run(command, label) {
  // eslint-disable-next-line no-console
  console.log(`[system:release] ${label}`);
  execSync(command, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
}

function main() {
  run('npm run system:validate', 'Validação oficial (backend + frontend + QA)');
  // A validação acima gera resíduos de runtime (ex.: frontend/test-results);
  // o cleanup oficial precisa rodar antes do readiness materializar o cleanup-proof.
  run('npm run runtime:clean', 'Limpando resíduos de runtime antes da prova de cleanup');
  run('npm run system:platform-readiness', 'Materializando proof reports e blockers antes do pacote');
  run('npm run zip:release:clean', 'Gerando artefato limpo e manifesto SHA-256');
  run('npm run system:package-validator', 'Validando o ZIP candidato contra o manifest de prova');
  run('npm run system:release-gate', 'Aplicando release gate sobre artefato aprovado');
  run('npm run system:go-no-go', 'Emitindo decisão GO/GO_DEGRADED/NO_GO');
  run('npm run system:release-manifest', 'Gerando manifesto sistêmico de release');
  run('npm run system:release-summary', 'Gerando resumo consolidado da release');
}

if (require.main === module) {
  try {
    main();
    process.exit(0);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[system:release] FAIL: ${error.message || error}`);
    process.exit(1);
  }
}
