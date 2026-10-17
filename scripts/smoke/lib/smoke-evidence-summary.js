'use strict';

/**
 * Shape canônico do fan-in `qa/smoke-evidence.json`.
 *
 * Por que existe: o produtor original vivia como um `node -e` EMBUTIDO no
 * `scripts/system-autotest-stack.sh`, um script que sobe e derruba a stack inteira via
 * docker compose. Consequência medida (P1-13): a única forma de regenerar a prova era um
 * ciclo destrutivo, então a evidência envelhecia e o gate reprovava por staleness.
 *
 * Aqui o shape fica explícito e testável; o script destrutivo e o produtor não-destrutivo
 * compartilham a MESMA definição.
 */

const CHAVES = Object.freeze(['l01', 'l02', 'l03', 'l04', 'l05', 'l06']);

/**
 * @param {{geradoEm?:string, smokes:Object<string,{status:string, logPath?:string|null,
 *          evidencePath?:string|null, evidence?:object|null}>}} entrada
 * @returns {{generatedAt:string, smokes:Object}}
 */
function montarResumoSmoke({ geradoEm, smokes } = {}) {
  const fonte = smokes || {};
  const saida = {};
  for (const chave of CHAVES) {
    const item = fonte[chave] || {};
    saida[chave] = {
      status: typeof item.status === 'string' && item.status.trim() ? item.status.trim() : 'unknown',
      logPath: item.logPath || null,
      evidencePath: item.evidencePath || null,
      evidence: item.evidence && typeof item.evidence === 'object' ? item.evidence : null,
    };
  }
  return {
    generatedAt: geradoEm || new Date().toISOString(),
    smokes: saida,
  };
}

/** Todos os smokes com status `pass`? (um só `unknown`/`fail` derruba o agregado) */
function todosPassaram(resumo) {
  const smokes = (resumo && resumo.smokes) || {};
  return CHAVES.every((chave) => String((smokes[chave] || {}).status || '').toLowerCase() === 'pass');
}

module.exports = { CHAVES, montarResumoSmoke, todosPassaram };
