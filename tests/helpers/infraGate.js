'use strict';

/**
 * tests/helpers/infraGate.js — porta ÚNICA para dependência de infraestrutura em testes.
 *
 * Achado real da auditoria V2 (§11/§12): 22 arquivos faziam
 *
 *     function skipIfNoDatabase() { ... console.warn(...); return true; }
 *
 * e o teste simplesmente voltava. Em execução de desenvolvimento isso é razoável; em gate
 * AUTORITATIVO de release é greenwashing: banco indisponível produzia Jest verde, e o relatório
 * agregado contava como PASS. Nada distinguia "passou" de "não rodou".
 *
 * Esta porta separa os dois regimes explicitamente:
 *
 *   - `RELEASE_AUTHORITATIVE=1` (gate de release): infra ausente ⇒ ERRO `INFRA_ERROR`, o teste
 *     FALHA. Nunca existe PASS silencioso.
 *   - modo dev (default): infra ausente ⇒ pulo EXPLÍCITO, porém REGISTRADO (suite, requisito,
 *     motivo, horário) e exportável como evidência de `NOT_EXECUTED` — para o relatório nunca
 *     confundir "não rodou" com "passou".
 *
 * Vocabulário de estado usado em relatório (mesmo do §11):
 *   PASS | FAIL | BLOCKED | INFRA_ERROR | NOT_APPLICABLE | NOT_EXECUTED
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const skips = [];

function isAuthoritative() {
  return process.env.RELEASE_AUTHORITATIVE === '1' || process.env.RELEASE_AUTHORITATIVE === 'true';
}

/**
 * Decide entre seguir, pular-registrado (dev) ou falhar (release-authoritative).
 *
 * @returns {boolean} true quando o chamador deve pular o teste (modo dev apenas)
 */
function skipOrFail({ suite, available, reason = null, requirement = 'postgres' }) {
  if (available) return false;

  if (isAuthoritative()) {
    const error = new Error(
      `${requirement.toUpperCase()}_UNAVAILABLE em modo release-authoritative (suite ${suite}): ${reason || 'sem detalhe'} — gate obrigatório não pode passar com infraestrutura ausente`,
    );
    error.code = 'INFRA_ERROR';
    error.state = 'INFRA_ERROR';
    error.suite = suite;
    error.requirement = requirement;
    throw error;
  }

  skips.push({
    suite,
    requirement,
    reason: reason || 'sem detalhe',
    state: 'NOT_EXECUTED',
    at: new Date().toISOString(),
    host: os.hostname(),
    mode: 'developer',
  });
  console.warn(`[${suite}] NÃO EXECUTADO: ${requirement} indisponível (${reason || 'sem detalhe'}) — registrado como NOT_EXECUTED, nunca como PASS`);
  return true;
}

function recordedSkips() {
  return skips.map((entry) => ({ ...entry }));
}

function resetSkips() {
  skips.length = 0;
}

/**
 * Executa `fn` com PRAZO EXPLÍCITO.
 *
 * MEDIDO no CI (run 39585223390, commit ac92a70ab): `tests/unit/engineeringRouterQwenProvider.test.js`
 * reprovou o passo L0 com `Exceeded timeout of 60000 ms` em `connect()` — sem Postgres no runner,
 * a conexão do Sequelize fica pendurada e o teste NUNCA chega ao `skipOrFail` que registraria
 * `NOT_EXECUTED`. Resultado: a suíte ficava vermelha por AMBIENTE, indistinguível de defeito — e,
 * com `bail: 1`, derrubava a suíte oficial inteira.
 *
 * Aqui "infra não respondeu" vira erro `INFRA_TIMEOUT` em tempo limitado, então o chamador cai no
 * caminho explícito (`skipOrFail`: NOT_EXECUTED em dev, INFRA_ERROR em release-authoritative).
 * O prazo NÃO transforma falha em sucesso: só impede que a ausência de infra vire espera infinita.
 *
 * @param {() => Promise<any>} fn
 * @param {{ms?: number, requisito?: string}} [opcoes]
 */
async function comPrazo(fn, { ms = 8000, requisito = 'infra' } = {}) {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, rejeitar) => {
        timer = setTimeout(() => {
          const erro = new Error(`${requisito} não respondeu em ${ms} ms`);
          erro.code = 'INFRA_TIMEOUT';
          erro.requisito = requisito;
          erro.prazoMs = ms;
          rejeitar(erro);
        }, ms);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Evidência de execução: o que pulou e por quê. `verdict` é explícito — com pulos registrados o
 * veredito NUNCA é PASS pleno.
 */
function buildExecutionEvidence({ suite = 'engineering-mission', exitState = 'PASS' } = {}) {
  const skipped = recordedSkips();
  return {
    artifactType: 'engineering-mission-execution-evidence',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    suite,
    authoritativeMode: isAuthoritative(),
    verdict: skipped.length > 0 ? 'PASS_WITH_NOT_EXECUTED' : exitState,
    notExecuted: skipped,
    notExecutedCount: skipped.length,
  };
}

function writeExecutionEvidence(filePath, options) {
  const target = path.resolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const evidence = buildExecutionEvidence(options);
  fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return { file: target, evidence };
}

module.exports = {
  isAuthoritative,
  skipOrFail,
  comPrazo,
  recordedSkips,
  resetSkips,
  buildExecutionEvidence,
  writeExecutionEvidence,
};
