'use strict';

/**
 * Set-based coverage — cálculo canônico de cobertura por INTERSEÇÃO de conjuntos.
 *
 * Regra: cobertura é sempre |required ∩ validated| / |required|.
 *   - Itens validados fora do conjunto requerido NUNCA aumentam a cobertura
 *     (extra é reportado, não contado).
 *   - Item requerido ausente SEMPRE reduz a cobertura (missing).
 *   - percent nunca excede 100 por construção — matched ⊆ required, portanto
 *     matched.size <= required.size. Não há clamp: se percent > 100 algum dia,
 *     é bug no chamador, não algo a esconder.
 *
 * Usada por: governance/proof-engine (replay/prod-like coverage),
 * tools/system/platform-readiness.js. Não existe mecanismo paralelo de
 * found/required — qualquer cálculo de cobertura found/required deve passar
 * por aqui.
 */

function toIdSet(values) {
  const list = Array.isArray(values) ? values : [];
  return new Set(
    list.map((value) => String(value || '').trim()).filter(Boolean),
  );
}

/**
 * @param {string[]} requiredIds ids obrigatórios (conjunto de referência)
 * @param {string[]} validatedIds ids validados/suportados
 * @returns {{
 *   required: number,
 *   matched: string[],
 *   missing: string[],
 *   extra: string[],
 *   percent: number,
 * }}
 */
function calculateSetCoverage(requiredIds, validatedIds) {
  const required = toIdSet(requiredIds);
  const validated = toIdSet(validatedIds);

  const matched = [...required].filter((id) => validated.has(id)).sort();
  const missing = [...required].filter((id) => !validated.has(id)).sort();
  const extra = [...validated].filter((id) => !required.has(id)).sort();

  const percent = required.size === 0
    ? 100
    : Number(((matched.length / required.size) * 100).toFixed(2));

  return { required: required.size, matched, missing, extra, percent };
}

module.exports = { calculateSetCoverage };
