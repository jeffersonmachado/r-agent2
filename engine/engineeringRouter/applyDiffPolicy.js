'use strict';

/**
 * engine/engineeringRouter/applyDiffPolicy.js
 *
 * FONTE ÚNICA da pergunta "QUAL texto de diff é realmente aplicado?".
 *
 * DEFEITO MEDIDO (2026-10-08, missão ca56cbdc / task 7fb9cf2a): o texto CANONICALIZADO era
 * calculado e usado no `git apply` do sandbox, mas **descartado** — só o patch CRU era persistido
 * e apenas o CRU era propagado adiante. A promoção declara no seu próprio contrato que recebe
 * "diff exato validado (o mesmo texto usado em applyPatch)" e, ao receber o cru, morreu com
 * `PROMOTION_EXPECTED_TREE_APPLY_FAILED: patch fragment without header at line 3` — a missão ficou
 * DEGRADED com REGRESSION **PASS** e GOVERNANCE **PASS**, ou seja, por um artefato de fiação entre
 * fases, nunca por mérito do patch.
 *
 * O caminho de RETOMADA já conhecia o problema (`canonicalizeMissingFileHeaders` antes do apply,
 * com o comentário de que a retomada precisa usar o MESMO texto canônico) — mas também propagava o
 * cru depois. Duas cópias da mesma regra, ambas incompletas: exatamente o que este módulo elimina.
 *
 * REGRA (fail-closed): a canonicalização só é ACEITA quando há uma revalidação estrutural
 * aprovada, OU quando o chamador declara explicitamente `assumeAlreadyApplied: true` — o caso da
 * retomada, em que a tentativa já está DONE e aquele texto já foi aplicado com sucesso uma vez.
 * Sem nenhuma das duas, o texto CRU é devolvido: na dúvida, nada é reparado.
 *
 * Módulo PURO: sem I/O, sem crypto, sem timers. Recebe a revalidação INJETADA (o chamador tem o
 * contrato da task; este módulo não precisa conhecer `validatePatch`).
 */

const { canonicalizeMissingFileHeaders } = require('./diffCanonicalizer');

/**
 * @param {string} rawDiff saída CRUA do coder
 * @param {Object} [options]
 * @param {(text:string)=>{ok:boolean, code?:string|null}} [options.revalidate] revalidação
 *   estrutural OBRIGATÓRIA sobre o texto canonicalizado.
 * @param {boolean} [options.assumeAlreadyApplied] declaração explícita de que o texto canônico já
 *   foi aplicado com sucesso nesta tentativa (retomada de attempt DONE). Nunca implícita.
 * @returns {{diff:string, applied:boolean, canonicalization:Object|null}}
 */
function resolveApplyDiff(rawDiff, { revalidate = null, assumeAlreadyApplied = false } = {}) {
  const raw = String(rawDiff || '');
  const candidate = canonicalizeMissingFileHeaders(raw);

  if (!candidate.applied) {
    return { diff: raw, applied: false, canonicalization: null };
  }

  const revalidation = typeof revalidate === 'function' ? (revalidate(candidate.text) || null) : null;
  const revalidationOk = revalidation
    ? revalidation.ok === true
    : assumeAlreadyApplied === true;

  return {
    diff: revalidationOk ? candidate.text : raw,
    applied: revalidationOk,
    canonicalization: {
      blocks: candidate.blocks,
      skipped: candidate.skipped,
      revalidationOk,
      revalidationCode: revalidation && revalidation.ok !== true ? (revalidation.code || null) : null,
      // Insumo para hashes/telemetria do chamador: este módulo não hasheia (permanece puro).
      canonicalizedText: candidate.text,
      rawText: raw,
    },
  };
}

module.exports = { resolveApplyDiff };
