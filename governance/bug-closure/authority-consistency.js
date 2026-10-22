'use strict';

/**
 * governance/bug-closure/authority-consistency.js — INVENTÁRIO x LIVRO x ROTEAMENTO.
 *
 * MISSÃO P0 (2026-10-22). Fechar um defeito exige prova (Camada B). Mas duas outras
 * adulterações produzem o mesmo efeito sem tocar no `state`:
 *
 *   a) APAGAR o defeito do inventário — a ausência não tem linha, e "não achei" passa a
 *      significar "não existe";
 *   b) REMOVER o defeito do roteamento `L1_BLOCKING` — ele deixa de ser exigido pela
 *      prontidão sem que ninguém tenha provado nada.
 *
 * Este módulo compara as três fontes e devolve violações nomeadas. É PURO: recebe os
 * dados já lidos, para poder ser provado sem tocar nos arquivos reais.
 */

const CODIGOS = Object.freeze({
  INVENTARIO_INCOMPLETO: 'INVENTARIO_INCOMPLETO',
  ROTEAMENTO_CONTRADIZ_AUTORIDADE: 'ROTEAMENTO_CONTRADIZ_AUTORIDADE',
  ROTEAMENTO_ITEM_DESCONHECIDO: 'ROTEAMENTO_ITEM_DESCONHECIDO',
  LIVRO_INCONSISTENTE: 'LIVRO_INCONSISTENTE',
});

/**
 * Um defeito que TEM evento de fechamento no livro não pode desaparecer do inventário.
 *
 * @param {object} entrada { defeitos: Array<{id,stateEfetivo}>, livro: {eventos, integridadeOk} }
 * @returns {{ok:boolean, violations:Array<{code:string, defectId:string, detail:string}>}}
 */
function verificarCompletudeDoInventario({ defeitos = [], livro = null } = {}) {
  const violations = [];
  if (!livro || !Array.isArray(livro.eventos)) return { ok: true, violations };
  if (livro.integridadeOk === false) {
    violations.push({ code: CODIGOS.LIVRO_INCONSISTENTE, defectId: null, detail: 'hash chain do livro rompida' });
  }
  const noInventario = new Set(defeitos.map((d) => d && d.id).filter(Boolean));
  const comEvento = new Set(livro.eventos.map((e) => e && e.defectId).filter(Boolean));
  for (const id of comEvento) {
    if (!noInventario.has(id)) {
      violations.push({
        code: CODIGOS.INVENTARIO_INCOMPLETO,
        defectId: id,
        detail: 'defeito com transição registrada no livro não existe no inventário — ausência não é fechamento',
      });
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * O roteamento `l1-scope-routing.json` existe para CLASSIFICAR defeitos BLOQUEADOS.
 * Duas adulterações produzem o mesmo efeito de "fechar sem provar":
 *
 *   - apagar a rota de um defeito que continua com status `blocked`/`blocked_external`
 *     (ausência de linha = "não exige nada");
 *   - manter rota `L1_BLOCKING` para um defeito já PROVADO como fechado (rota obsoleta,
 *     que faz o gate exigir para sempre o que já foi resolvido).
 *
 * Fechamento declarado SEM prova não entra nesta checagem: ele não é "rota", é bloqueio de
 * certificação — tratado por `eligibility.js` (FECHAMENTO_SEM_PROVA_VALIDA), que independe
 * do arquivo de roteamento. Assim o ataque "remover do roteamento" não concede nada.
 *
 * @param {object} entrada { defeitos, roteamento }
 */
function verificarConsistenciaDeRoteamento({ defeitos = [], roteamento = null } = {}) {
  const violations = [];
  if (!roteamento || typeof roteamento !== 'object') return { ok: true, violations };
  const itens = roteamento.items && typeof roteamento.items === 'object' ? roteamento.items : {};

  const porId = new Map(defeitos.map((d) => [d && d.id, d]));
  for (const [id, rota] of Object.entries(itens)) {
    const defeito = porId.get(id);
    if (!defeito) {
      violations.push({
        code: CODIGOS.ROTEAMENTO_ITEM_DESCONHECIDO,
        defectId: id,
        detail: 'roteamento cita defeito que não existe no inventário',
      });
      continue;
    }
    const efetivo = String(defeito.stateEfetivo || defeito.state || '').toUpperCase();
    const classe = String(rota && rota.class ? rota.class : '');
    const provadoFechado = ['VERIFIED', 'RESOLVED'].includes(efetivo) && defeito.fechamentoNaoProvado !== true;
    if (classe === 'L1_BLOCKING' && provadoFechado) {
      violations.push({
        code: CODIGOS.ROTEAMENTO_CONTRADIZ_AUTORIDADE,
        defectId: id,
        detail: `rota L1_BLOCKING obsoleta: defeito ${efetivo} com prova de fechamento válida`,
      });
    }
  }

  for (const d of defeitos) {
    if (!d) continue;
    const status = String(d.legacyStatus || '').toLowerCase();
    const bloqueado = status === 'blocked' || status === 'blocked_external';
    if (bloqueado && !Object.prototype.hasOwnProperty.call(itens, d.id)) {
      violations.push({
        code: CODIGOS.ROTEAMENTO_CONTRADIZ_AUTORIDADE,
        defectId: d.id,
        detail: `status ${status} sem rota declarada — remover do roteamento não fecha o defeito`,
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

module.exports = {
  CODIGOS,
  verificarCompletudeDoInventario,
  verificarConsistenciaDeRoteamento,
};
