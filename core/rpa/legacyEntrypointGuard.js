'use strict';

const { isInPipeline } = require('../../pipeline/guard');

function assertLegacyEntrypointAllowed(entrypointName) {
  if (process.env.LEGACY_RPA_ENTRYPOINT_ALLOWED === '1') return;
  if (process.env.PIPELINE_BYPASS === '1') return;
  if (isInPipeline()) return;

  throw new Error(
    `[rpa] Execucao direta via legado bloqueada em "${entrypointName}".\n`
    + 'Use o entrypoint canonico em core/rpa ou execute o pipeline oficial: npm run pipeline\n'
    + 'Para uso local explicito: PIPELINE_BYPASS=1 <comando>'
  );
}

module.exports = {
  assertLegacyEntrypointAllowed,
};