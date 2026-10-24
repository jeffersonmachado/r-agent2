'use strict';

/**
 * resultClassification.js — CLASSIFICAÇÃO EXPLÍCITA do resultado de um passo (P1-E1).
 *
 * POR QUE EXISTE
 * --------------
 * O harness de checkout limpo tratava `exitCode === null` como prova de "não terminou em
 * sucesso" e marcava o cenário `db-unavailable` como PASS. `exitCode === null` acontece por
 * motivos MUITO diferentes: timeout, processo morto por sinal, spawn que falhou (binário
 * ausente), processo travado. Nenhum deles prova que a aplicação falhou PELO MOTIVO esperado.
 *
 * Este módulo separa as coisas que estavam misturadas:
 *
 *   EXPECTED_SUCCESS        exit 0 quando 0 era o esperado
 *   EXPECTED_FAILURE        exit != 0 esperado E com a ASSINATURA de falha declarada
 *   EXPECTED_FAILURE_SEM_ASSINATURA
 *                           falhou como esperado, mas pelo motivo ERRADO (ou sem comprovação)
 *   UNEXPECTED_SUCCESS      exit 0 quando != 0 era esperado
 *   UNEXPECTED_FAILURE      exit != 0 quando 0 era esperado
 *   TIMEOUT                 morto pelo orçamento de tempo — nunca é PASS
 *   SIGNALLED               morto por sinal — nunca é PASS (salvo contrato explícito do sinal)
 *   NOT_EXECUTED            não chegou a rodar (spawn falhou/binário inexistente)
 *   INFRASTRUCTURE_ERROR    falha do ambiente — não é veredito sobre a aplicação
 */

const CLASSES = Object.freeze({
  EXPECTED_SUCCESS: 'EXPECTED_SUCCESS',
  EXPECTED_FAILURE: 'EXPECTED_FAILURE',
  EXPECTED_FAILURE_SEM_ASSINATURA: 'EXPECTED_FAILURE_SEM_ASSINATURA',
  UNEXPECTED_SUCCESS: 'UNEXPECTED_SUCCESS',
  UNEXPECTED_FAILURE: 'UNEXPECTED_FAILURE',
  TIMEOUT: 'TIMEOUT',
  SIGNALLED: 'SIGNALLED',
  NOT_EXECUTED: 'NOT_EXECUTED',
  INFRASTRUCTURE_ERROR: 'INFRASTRUCTURE_ERROR',
});

/** Classes que PODEM ser aprovadas. Só duas: sucesso esperado e falha esperada comprovada. */
const CLASSES_APROVAVEIS = Object.freeze(new Set([
  CLASSES.EXPECTED_SUCCESS,
  CLASSES.EXPECTED_FAILURE,
]));

/** Assinaturas de falha de INFRAESTRUTURA (não são veredito sobre a aplicação). */
const ASSINATURAS_INFRA = [
  /ENOENT.*spawn/i,
  /command not found/i,
  /Could not resolve host/i,
  /EAI_AGAIN/,
  /Cannot connect to the Docker daemon/i,
];

/**
 * @param {object} entrada
 * @param {number|null} entrada.exitCode   exit code (null quando morto por sinal/timeout)
 * @param {string|null} [entrada.signal]   sinal que matou o processo
 * @param {boolean} [entrada.timedOut]     o orçamento de tempo estourou
 * @param {number} entrada.esperado        exit code esperado (0 para passos positivos)
 * @param {string[]} [entrada.assinaturasEsperadas] textos que comprovam a falha esperada
 * @param {string} [entrada.saida]         stdout+stderr do processo
 * @param {string[]} [entrada.sinaisAceitos] sinais aceitos por contrato negativo explícito
 * @returns {{classe:string, ok:boolean, motivo:string}}
 */
function classificarResultado({
  exitCode,
  signal = null,
  timedOut = false,
  esperado = 0,
  assinaturasEsperadas = [],
  saida = '',
  sinaisAceitos = [],
  aceitarQualquerFalha = false,
}) {
  const texto = String(saida || '');

  if (timedOut) {
    return { classe: CLASSES.TIMEOUT, ok: false, motivo: 'orçamento de tempo estourado — timeout nunca é sucesso' };
  }
  // Achado A2 da 2ª passada: a assinatura de infraestrutura só rebaixava quando `exitCode ===
  // null`. Uma falha de ambiente que sai com exit 1 ("Could not resolve host", "Cannot connect to
  // the Docker daemon") era aceita como "falha esperada" e o cenário negativo passava pelo motivo
  // errado. Agora infraestrutura vence SEMPRE, com ou sem exit code.
  const infra = ASSINATURAS_INFRA.find((re) => re.test(texto));
  if (infra) {
    return { classe: CLASSES.INFRASTRUCTURE_ERROR, ok: false, motivo: `falha de infraestrutura: ${infra}` };
  }
  if (exitCode === null && signal) {
    if (sinaisAceitos.includes(signal)) {
      return { classe: CLASSES.EXPECTED_FAILURE, ok: true, motivo: `sinal esperado por contrato: ${signal}` };
    }
    return { classe: CLASSES.SIGNALLED, ok: false, motivo: `morto por sinal ${signal} — não é falha comprovada da aplicação` };
  }
  if (exitCode === null) {
    return { classe: CLASSES.NOT_EXECUTED, ok: false, motivo: 'processo não chegou a executar (exitCode nulo sem sinal)' };
  }
  if (esperado === 0) {
    return exitCode === 0
      ? { classe: CLASSES.EXPECTED_SUCCESS, ok: true, motivo: 'exit 0' }
      : { classe: CLASSES.UNEXPECTED_FAILURE, ok: false, motivo: `exit ${exitCode} (esperado 0)` };
  }
  if (exitCode === 0) {
    return { classe: CLASSES.UNEXPECTED_SUCCESS, ok: false, motivo: `exit 0 (esperado ${esperado})` };
  }
  // Achado A2: sem assinatura declarada, QUALQUER exit != 0 passava — erro de sintaxe no teste,
  // dependência ausente ou bug de produto "provavam" o controle negativo. Cenário negativo agora
  // é fail-closed: exige a assinatura do motivo. Contrato explícito `aceitarQualquerFalha` só
  // quando a falha não tiver assinatura possível (ex.: processo que aborta sem mensagem).
  if (assinaturasEsperadas.length === 0 && !aceitarQualquerFalha) {
    return {
      classe: CLASSES.EXPECTED_FAILURE_SEM_ASSINATURA,
      ok: false,
      motivo: `exit ${exitCode} sem assinatura de falha declarada — falha pelo motivo errado não aprova`,
    };
  }
  if (assinaturasEsperadas.length > 0) {
    const casou = assinaturasEsperadas.some((assinatura) => texto.includes(assinatura));
    if (!casou) {
      return {
        classe: CLASSES.EXPECTED_FAILURE_SEM_ASSINATURA,
        ok: false,
        motivo: `exit ${exitCode} sem a assinatura de falha esperada (${assinaturasEsperadas.join(' | ')})`,
      };
    }
  }
  if (assinaturasEsperadas.length === 0 && exitCode !== esperado) {
    return { classe: CLASSES.UNEXPECTED_FAILURE, ok: false, motivo: `exit ${exitCode} (esperado ${esperado})` };
  }
  return {
    classe: CLASSES.EXPECTED_FAILURE,
    ok: true,
    motivo: assinaturasEsperadas.length > 0
      ? `exit ${exitCode} com assinatura de falha esperada`
      : `exit ${exitCode} como esperado (contrato aceitarQualquerFalha)`,
  };
}

/** BLOCKED tem precedência sobre FAIL; PASS exige todos os passos aprovados. */
function vereditoDoRun(passos) {
  // Achado A6: `[].every(...)` é `true`, então "nenhum passo" virava PASS.
  if (!Array.isArray(passos) || passos.length === 0) return 'BLOCKED';
  if (passos.some((p) => p.classe === CLASSES.INFRASTRUCTURE_ERROR || p.classe === CLASSES.NOT_EXECUTED)) return 'BLOCKED';
  return passos.every((p) => CLASSES_APROVAVEIS.has(p.classe)) ? 'PASS' : 'FAIL';
}

module.exports = { CLASSES, CLASSES_APROVAVEIS, classificarResultado, vereditoDoRun, ASSINATURAS_INFRA };
