'use strict';

/**
 * pipeline/guard.js
 *
 * Guard do pipeline oficial — verifica se a execução ocorre dentro
 * do pipeline canônico (pipeline/runFullValidation.js).
 *
 * Os módulos que exigem execução oficial devem chamar:
 *   require('../pipeline/guard').assertInPipeline('nome-do-modulo');
 *
 * Para controle via env vars:
 *   PIPELINE_BYPASS=1  — ignora o guard (apenas para dev local)
 *   RUNNING_IN_PIPELINE=1 — sinaliza que estamos no pipeline oficial
 */

const BYPASS_ALLOWED = process.env.PIPELINE_BYPASS === '1';
const IN_PIPELINE = process.env.RUNNING_IN_PIPELINE === '1';

/**
 * Verifica se a execução está dentro do pipeline oficial.
 * Lança erro se PIPELINE_ENFORCEMENT=1 e não estiver no pipeline.
 */
function assertInPipeline(callerName = 'unknown') {
  if (BYPASS_ALLOWED) {
    console.warn(`[pipeline/guard] BYPASS ativo para "${callerName}" — para execução oficial use 'npm run pipeline'`);
    return;
  }

  if (!IN_PIPELINE && process.env.PIPELINE_ENFORCEMENT === '1') {
    throw new Error(
      `[pipeline/guard] Execução fora do pipeline oficial detectada em "${callerName}".\n` +
      `Execute via: npm run pipeline\n` +
      `Para bypass de desenvolvimento: PIPELINE_BYPASS=1 node <script>`,
    );
  }

  if (!IN_PIPELINE) {
    // Warning-only por padrão (não bloqueia)
    console.warn(
      `[pipeline/guard] ATENÇÃO: "${callerName}" executando fora do pipeline oficial.\n` +
      `Para execução oficial: npm run pipeline\n` +
      `Para enforcement: PIPELINE_ENFORCEMENT=1 npm run pipeline`,
    );
  }
}

/**
 * Retorna true se estamos no pipeline oficial.
 */
function isInPipeline() {
  return IN_PIPELINE || BYPASS_ALLOWED;
}

module.exports = { assertInPipeline, isInPipeline };
