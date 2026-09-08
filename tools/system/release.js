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
  // GATE DE PROVENIÊNCIA: snapshot do worktree no INÍCIO do pipeline, antes de
  // qualquer geração. Os passos abaixo (platform-readiness, gates) regeneram
  // artefatos de governança rastreados — sem o snapshot antecipado, o gate
  // DIRTY_WORKTREE do empacotamento (two-pass-release.sh) falharia com as
  // pendências geradas pelo próprio pipeline. O two-pass honra
  // RAP_WORKTREE_SNAPSHOT_VALIDATED=1 e não repete o check. NUNCA commit
  // automático: worktree sujo aqui = NO_GO.
  run(
    'node scripts/governance/check-clean-worktree.js --root .',
    'GATE DIRTY_WORKTREE: snapshot do worktree no início do pipeline',
  );
  process.env.RAP_WORKTREE_SNAPSHOT_VALIDATED = '1';
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
